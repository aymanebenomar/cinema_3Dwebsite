import { CLIP_SECONDS } from './clips.js';

/** Pixel size of the player frame; it's placed on the 3D screen with a CSS 3D transform. */
// Laid out at 4K and scaled down onto the screen: YouTube streams its best quality to a player this size,
// and its own on-screen icons, which keep a fixed size inside the player, end up half as big.
export const FRAME = { width: 3840, height: 2160 };

const FADE_MS = 1000; // crossfade between trailers (keep in sync with .trailer in style.css)
const PRELOAD_MS = 8600; // start the next film right after the last crossfade, so every cut lands on time
const SETTLE_MS = 4500; // a player shows a pause icon for its first seconds; keep it out of sight until that's gone
const FIRST_SETTLE_MS = 2200; // the first film fades in from black, which covers the start
const JUMP_SETTLE_MS = 3000; // a film picked from the programme comes up a little sooner too
const TIMEOUT_MS = 25000; // skip a film that hasn't started playing after this long
const SOUND_IN_MS = 1800; // the incoming film's sound fades in over this long
const SOUND_OUT_MS = 900; // what's left of the outgoing film's sound fades out at the cut
const SOUND_TAIL_MS = 1500; // ...after easing down over the last moments before it

let apiPromise = null;
function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve(window.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        apiPromise = null;
        reject(new Error('YouTube player could not load'));
      };
      document.head.appendChild(script);
    });
  }
  return apiPromise;
}

/**
 * Official trailers played through YouTube's own embedded player. Two players take turns: while one
 * is on screen the other loads the next trailer, then fades in over it.
 *
 * play() runs the list round and round. If YouTube can't load (blocked, offline), onFail() is called so the
 * cinema can carry on with the reel instead.
 */
export function createTrailers(frameEl, list, { onShow, onFail } = {}) {
  const slots = [0, 1].map(() => {
    const wrap = document.createElement('div');
    wrap.className = 'trailer';
    const mount = document.createElement('div');
    wrap.appendChild(mount);
    frameEl.appendChild(wrap);
    return { wrap, mount, player: null, index: -1, waiting: false, timer: 0 };
  });

  let YT = null;
  let ready = null; // promise: both players created
  let running = false;
  let live = null;
  let liveSince = 0;
  let muted = true;
  let failures = 0;
  let nextTimer = 0;
  let firstAt = 0; // the first trailer may not appear before this moment (performance.now() ms)
  let level = 1; // volume scale: films sound further away from the balcony
  let master = 1; // volume scale: the programme wall rising over the cinema fades everything out
  let jumpTo = null; // a film picked from the programme, to cut to as soon as it's ready
  const loud = () => 100 * level * master;

  function init() {
    if (!ready) {
      // No time limit: the reel keeps playing meanwhile, so a slow YouTube just means the films cut in later.
      // Only the first player is made up front; the second is set up while the first film plays.
      ready = loadYouTubeAPI()
        .then((api) => {
          YT = api;
          return ensurePlayer(slots[0]);
        })
        .catch((err) => {
          ready = null; // try again next time round
          throw err;
        });
    }
    return ready;
  }

  function ensurePlayer(slot) {
    slot.ready ??= new Promise((resolve) => {
      slot.player = new YT.Player(slot.mount, {
        host: 'https://www.youtube-nocookie.com',
        width: FRAME.width,
        height: FRAME.height,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          playsinline: 1,
          rel: 0,
          mute: 1,
          cc_load_policy: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => resolve(),
          onStateChange: (e) => onState(slot, e.data),
          onError: () => skip(slot),
        },
      });
    });
    return slot.ready;
  }

  /** Run the trailers once. `at`: don't show the first one before this moment (performance.now() ms). */
  async function play({ at = 0 } = {}) {
    running = true;
    failures = 0;
    firstAt = at;
    try {
      await init();
    } catch {
      running = false;
      onFail?.();
      return;
    }
    if (running) load(slots[0], 0);
  }

  async function load(slot, index) {
    slot.index = index;
    slot.waiting = true;
    // The waiting film is fully drawn, just underneath the one on screen. Browsers pause videos they think
    // are invisible, and resuming one makes YouTube flash its play icon, so it's never made transparent.
    slot.wrap.className = 'trailer is-next';
    clearTimeout(slot.timer);
    slot.timer = setTimeout(() => slot.waiting && skip(slot), TIMEOUT_MS);
    await ensurePlayer(slot);
    if (!slot.waiting || slot.index !== index) return;
    slot.player.mute();
    slot.player.loadVideoById({ videoId: list[index].youtube, startSeconds: list[index].start });
  }

  function onState(slot, state) {
    if (state === YT.PlayerState.PLAYING && slot.waiting) {
      slot.waiting = false;
      clearTimeout(slot.timer);
      slot.player.unloadModule?.('captions'); // no subtitles on the big screen
      // The very first film comes up sooner: there's nothing on screen yet to wait behind.
      setTimeout(() => show(slot), !live ? FIRST_SETTLE_MS : slot.index === jumpTo ? JUMP_SETTLE_MS : SETTLE_MS);
    } else if (state === YT.PlayerState.ENDED && slot === live) {
      advance(); // trailer ran out early
    }
  }

  function show(slot) {
    if (!running) return;
    // Give the current trailer its full time on screen before cutting.
    const wait =
      live && live !== slot && slot.index !== jumpTo
        ? liveSince + CLIP_SECONDS * 1000 - performance.now()
        : firstAt - performance.now();
    if (wait > 50) {
      setTimeout(() => show(slot), wait);
      return;
    }
    // If the browser paused it, nudge it back and look again shortly. Buffering is fine: it catches up by itself.
    const state = slot.player.getPlayerState?.();
    if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) {
      slot.player.playVideo();
      setTimeout(() => show(slot), 1500);
      return;
    }
    const previous = live;
    live = slot;
    liveSince = performance.now();
    if (slot.index === jumpTo) jumpTo = null;
    slot.wrap.className = 'trailer is-live';
    if (!muted) {
      // The new film's sound eases in rather than starting at full volume mid-scene.
      slot.player.setVolume(0);
      slot.player.unMute();
      rampVolume(slot, 0, loud(), SOUND_IN_MS);
    }
    if (previous && previous !== slot) {
      previous.wrap.className = 'trailer is-leaving'; // fades out on top, uncovering the new film
      if (!muted) rampVolume(previous, previous.volume ?? loud(), 0, SOUND_OUT_MS);
      setTimeout(() => retire(previous), FADE_MS + 150);
    }
    // Let the sound tail off just before the cut, so a line trails away instead of being chopped.
    clearTimeout(slot.fadeTimer);
    slot.fadeTimer = setTimeout(() => {
      if (live === slot && !muted) rampVolume(slot, slot.volume ?? loud(), 0.3 * loud(), SOUND_TAIL_MS);
    }, CLIP_SECONDS * 1000 - SOUND_TAIL_MS);
    onShow?.(list[slot.index], slot.index);
    clearTimeout(nextTimer);
    nextTimer = setTimeout(advance, CLIP_SECONDS * 1000 - PRELOAD_MS);
  }

  function advance() {
    clearTimeout(nextTimer);
    if (!running || !live) return;
    load(
      slots.find((s) => s !== live),
      (live.index + 1) % list.length, // round and round: after the last film comes the first again
    );
  }

  function skip(slot) {
    if (!slot.waiting) return;
    slot.waiting = false;
    clearTimeout(slot.timer);
    console.warn(`[cinema] Skipping the "${list[slot.index]?.title}" trailer — it would not play here.`);
    if (++failures >= list.length) {
      stop();
      onFail?.();
      return;
    }
    load(slot, (slot.index + 1) % list.length);
  }

  function retire(slot) {
    if (live === slot || slot.waiting) return;
    slot.wrap.className = 'trailer';
    slot.rampToken = (slot.rampToken || 0) + 1; // cancel any fade still running
    clearTimeout(slot.fadeTimer);
    // A YT.Player only gains its methods once YouTube has finished setting it up.
    if (typeof slot.player?.pauseVideo !== 'function') return;
    slot.player.mute();
    slot.player.pauseVideo();
  }

  /** Fade the trailers out (the reel takes over) and pause both players. */
  function stop() {
    running = false;
    clearTimeout(nextTimer);
    const was = live;
    live = null;
    setTimeout(() => {
      for (const s of slots) {
        s.waiting = false;
        clearTimeout(s.timer);
        if (s === was || !live) retire(s);
      }
    }, FADE_MS + 150);
  }

  function setMuted(value) {
    muted = value;
    if (!live) return;
    if (muted) live.player.mute();
    else {
      live.rampToken = (live.rampToken || 0) + 1;
      live.volume = loud();
      live.player.unMute();
      live.player.setVolume(Math.round(live.volume));
    }
  }

  /** 0 = at the screen, 1 = up in the balcony. YouTube's audio can't be processed, so distance is just level. */
  function setDistance(amount) {
    const next = 1 - 0.3 * amount;
    if (Math.abs(next - level) < 0.02) return;
    level = next;
    if (live && !muted && !live.ramping && typeof live.player.setVolume === 'function') {
      live.volume = loud();
      live.player.setVolume(Math.round(live.volume));
    }
  }

  // Start fetching YouTube's player straight away so the first trailer is quick.
  init().catch(() => {});

  /** 0..1: the programme wall rising over the cinema fades the film's sound away. */
  function setMaster(value) {
    const next = Math.round(value * 50) / 50;
    if (next === master) return;
    master = next;
    if (live && !muted && !live.ramping && typeof live.player.setVolume === 'function') {
      live.volume = loud();
      live.player.setVolume(Math.round(live.volume));
    }
  }

  /** Cut to this film as soon as it's ready (a card picked in the programme). */
  function jump(index) {
    if (!running || !YT || live?.index === index) return;
    jumpTo = index;
    clearTimeout(nextTimer);
    load(slots.find((s) => s !== live) ?? slots[0], index);
  }

  return { play, stop, setMuted, setDistance, setMaster, jump };
}

/** Smoothly move a player's volume from one level to another. A newer fade on the same player wins. */
function rampVolume(slot, from, to, ms) {
  const token = (slot.rampToken = (slot.rampToken || 0) + 1);
  const t0 = performance.now();
  slot.ramping = true;
  const step = () => {
    if (slot.rampToken !== token || typeof slot.player?.setVolume !== 'function') return;
    const k = Math.min(1, (performance.now() - t0) / ms);
    slot.volume = from + (to - from) * k * k * (3 - 2 * k);
    slot.player.setVolume(Math.round(slot.volume));
    if (k < 1) setTimeout(step, 40);
    else slot.ramping = false;
  };
  step();
}
