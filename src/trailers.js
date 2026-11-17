import { CLIP_SECONDS } from './clips.js';

/** Pixel size of the player frame; it's placed on the 3D screen with a CSS 3D transform. */
export const FRAME = { width: 1920, height: 1080 }; // big enough that YouTube streams 1080p and up

const FADE_MS = 1000; // crossfade between trailers (keep in sync with .trailer in style.css)
const PRELOAD_MS = 8000; // start the next film this long before the cut
const SETTLE_MS = 4500; // a player shows a pause icon for its first seconds; keep it hidden until that's gone
const TIMEOUT_MS = 25000; // skip a film that hasn't started playing after this long

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
 * play() runs the whole list once, then calls onDone(). If YouTube can't load (blocked, offline),
 * onFail() is called so the cinema can carry on with the reel.
 */
export function createTrailers(frameEl, list, { onShow, onDone, onFail } = {}) {
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

  function init() {
    if (!ready) {
      // No time limit: the reel keeps playing meanwhile, so a slow YouTube just means the films cut in later.
      ready = loadYouTubeAPI()
        .then((api) => {
          YT = api;
          return Promise.all(slots.map(createPlayer));
        })
        .catch((err) => {
          ready = null; // try again next time round
          throw err;
        });
    }
    return ready;
  }

  function createPlayer(slot) {
    return new Promise((resolve) => {
      if (slot.player) return resolve();
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

  function load(slot, index) {
    slot.index = index;
    slot.waiting = true;
    slot.player.mute();
    slot.player.loadVideoById({ videoId: list[index].youtube, startSeconds: list[index].start });
    clearTimeout(slot.timer);
    slot.timer = setTimeout(() => slot.waiting && skip(slot), TIMEOUT_MS);
  }

  function onState(slot, state) {
    if (state === YT.PlayerState.PLAYING && slot.waiting) {
      slot.waiting = false;
      clearTimeout(slot.timer);
      slot.player.unloadModule?.('captions'); // no subtitles on the big screen
      setTimeout(() => show(slot), SETTLE_MS);
    } else if (state === YT.PlayerState.ENDED && slot === live) {
      advance(); // trailer ran out early
    }
  }

  function show(slot) {
    if (!running) return;
    // Give the current trailer its full time on screen before cutting.
    const wait = live && live !== slot ? liveSince + CLIP_SECONDS * 1000 - performance.now() : firstAt - performance.now();
    if (wait > 50) {
      setTimeout(() => show(slot), wait);
      return;
    }
    const previous = live;
    live = slot;
    liveSince = performance.now();
    slot.wrap.style.zIndex = '2';
    slot.wrap.classList.add('is-live');
    if (!muted) {
      slot.player.unMute();
      rampVolume(slot.player, 0, 100);
    }
    if (previous && previous !== slot) {
      previous.wrap.style.zIndex = '1';
      if (!muted) rampVolume(previous.player, 100, 0);
      setTimeout(() => retire(previous), FADE_MS + 150);
    }
    onShow?.(list[slot.index], slot.index);
    clearTimeout(nextTimer);
    nextTimer = setTimeout(advance, CLIP_SECONDS * 1000 - PRELOAD_MS);
  }

  function advance() {
    clearTimeout(nextTimer);
    if (!running || !live) return;
    const next = live.index + 1;
    if (next < list.length) {
      load(slots.find((s) => s !== live), next);
    } else {
      nextTimer = setTimeout(finish, Math.max(0, liveSince + CLIP_SECONDS * 1000 - performance.now()));
    }
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
    if (slot.index + 1 < list.length) load(slot, slot.index + 1);
    else if (live) finish();
    else {
      stop();
      onFail?.();
    }
  }

  function finish() {
    if (!running) return;
    onDone?.();
  }

  function retire(slot) {
    if (live === slot) return;
    slot.wrap.classList.remove('is-live');
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
      live.player.unMute();
      live.player.setVolume(100);
    }
  }

  // Start fetching YouTube's player straight away so the first trailer is quick.
  init().catch(() => {});

  return { play, stop, setMuted };
}

function rampVolume(player, from, to, ms = FADE_MS) {
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    player.setVolume(Math.round(from + (to - from) * k));
    if (k < 1) setTimeout(step, 40);
  };
  step();
}
