import * as THREE from 'three';
import { CLIPS, CLIP_SECONDS, REEL } from './clips.js';

const FADE_SECONDS = 1.4; // crossfade between clips
const PRELOAD_SECONDS = 4; // start preparing the next clip this long before the cut
const READY_TIMEOUT = 12; // give up on a clip that hasn't buffered after this many seconds
const MAX_COVER_CROP = 1; // always fill the screen edge to edge (crop rather than show bars)

/**
 * The projector: two video "decks" that take turns. While one plays, the other loads and seeks to the
 * next clip; at the cut it starts playing and the screen shader crossfades between them, so there is
 * never a black gap or a loading spinner.
 */
export function createProjector({
  screenAspect,
  startIndex = 0,
  holdReel = false, // wait for playReel() before starting the reel
  anisotropy = 1, // texture sharpness at grazing angles (renderer.capabilities.getMaxAnisotropy())
  onClip,
  onPlaying,
  onBlocked,
  onFail,
  onReelEnded,
} = {}) {
  const decks = [0, 1].map(createDeck);
  let live = null; // deck on screen
  let incoming = null; // deck being prepared
  let muted = true;
  let failures = 0;
  let cursor = -1; // last programme index handed to a deck
  let starting = false; // first clip is being started
  // With a pre-built reel, the programme is a single looping video and films are tracked by time.
  let programme = REEL
    ? [{ src: REEL.src, reel: true, start: (Math.max(0, startIndex) % REEL.films.length) * REEL.segmentSeconds }]
    : CLIPS;
  const reelMode = () => Boolean(programme[0]?.reel);
  let reelFilm = -1;
  const nextIndex = () => (cursor = (cursor + 1) % programme.length);
  let mix = 0; // 0 = deck 0 visible, 1 = deck 1 visible
  let brightness = 0; // fades the very first clip in from black
  let hold = holdReel;
  let opacity = holdReel ? 0 : 1; // 0 = the screen is a window onto the trailer layer behind the canvas
  let opacityTarget = opacity;
  let palette = null; // colours the room glows in while YouTube is on screen
  const paletteColor = new THREE.Color();

  const uniforms = {
    uTex0: { value: null },
    uTex1: { value: null },
    uFit0: { value: new THREE.Vector2(1, 1) },
    uFit1: { value: new THREE.Vector2(1, 1) },
    uMix: { value: 0 },
    uBrightness: { value: 0 },
    uOpacity: { value: opacity },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex0;
      uniform sampler2D uTex1;
      uniform vec2 uFit0;
      uniform vec2 uFit1;
      uniform float uMix;
      uniform float uBrightness;
      uniform float uOpacity;
      varying vec2 vUv;

      vec3 deck(sampler2D tex, vec2 fit) {
        vec2 uv = (vUv - 0.5) * fit + 0.5;
        vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
        return texture2D(tex, clamp(uv, 0.0, 1.0)).rgb * inside.x * inside.y;
      }

      void main() {
        float m = smoothstep(0.0, 1.0, uMix);
        vec3 c = vec3(0.0);
        if (m < 0.999) c += deck(uTex0, uFit0) * (1.0 - m);
        if (m > 0.001) c += deck(uTex1, uFit1) * m;
        gl_FragColor = vec4(c * uBrightness * uOpacity, uOpacity);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
  // Black 1×1 placeholders until real frames arrive.
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;
  uniforms.uTex0.value = black;
  uniforms.uTex1.value = black;

  // Average colour of the picture, used to light the room with the film.
  const glow = new THREE.Color(0.03, 0.03, 0.035);
  const sampled = glow.clone();
  const sampler = document.createElement('canvas');
  sampler.width = 16;
  sampler.height = 9;
  const sctx = sampler.getContext('2d', { willReadFrequently: true });
  let sampleIn = 0;

  function createDeck(slot) {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    const deck = { slot, video, texture: null, index: -1, start: 0, state: 'idle', since: 0, tries: 0 };

    video.addEventListener('loadedmetadata', () => {
      if (deck.state !== 'loading') return;
      deck.state = 'seeking';
      video.currentTime = pickStart(programme[deck.index], video.duration);
    });
    video.addEventListener('seeked', () => {
      if (deck.state !== 'seeking') return;
      deck.state = 'buffering';
      checkReady(deck);
    });
    video.addEventListener('canplay', () => checkReady(deck));
    video.addEventListener('canplaythrough', () => checkReady(deck));
    video.addEventListener('ended', () => {
      if (deck === live && reelMode()) onReelEnded?.();
    });
    video.addEventListener('error', () => {
      if (deck.state !== 'idle' && deck.state !== 'live') fail(deck);
    });
    return deck;
  }

  function pickStart(clip, duration) {
    const room = Number.isFinite(duration) ? duration - CLIP_SECONDS - 2 : 0;
    if (typeof clip.start === 'number') return Math.max(0, Math.min(clip.start, room));
    // A random scene, away from the opening titles and end credits.
    return room > 0 ? duration * 0.1 + Math.random() * (duration * 0.8 - CLIP_SECONDS) : 0;
  }

  function load(deck, index) {
    deck.index = index;
    deck.state = 'loading';
    deck.since = performance.now();
    deck.tries = 0;
    deck.video.pause();
    deck.video.muted = true;
    deck.video.loop = Boolean(programme[index].reel);
    deck.video.src = programme[index].src;
    deck.video.load();
  }

  function checkReady(deck) {
    if (deck.state !== 'buffering' || deck.video.readyState < 3) return;
    // Random scenes sometimes land on a black frame or a fade; try another spot.
    if (typeof programme[deck.index].start !== 'number' && deck.tries < 3 && frameLuminance(deck.video) < 0.035) {
      deck.tries++;
      deck.state = 'seeking';
      deck.video.currentTime = pickStart(programme[deck.index], deck.video.duration);
      return;
    }
    deck.state = 'ready';
    deck.texture?.dispose();
    deck.texture = new THREE.VideoTexture(deck.video);
    deck.texture.colorSpace = THREE.SRGBColorSpace;
    // Mipmaps + anisotropic filtering keep the picture crisp, without shimmer, when the screen is small.
    deck.texture.minFilter = THREE.LinearMipmapLinearFilter;
    deck.texture.magFilter = THREE.LinearFilter;
    deck.texture.generateMipmaps = true;
    deck.texture.anisotropy = anisotropy;
    uniforms[`uTex${deck.slot}`].value = deck.texture;
    uniforms[`uFit${deck.slot}`].value.copy(fitFor(deck.video.videoWidth / deck.video.videoHeight));
    if (!live && !starting && !hold) cut(deck);
  }

  /**
   * How the picture sits on the screen: crop up to MAX_COVER_CROP of it to fill the screen, and
   * letterbox / pillarbox whatever difference is left (like a cinema zooming an old 4:3 film).
   */
  function fitFor(v) {
    const s = screenAspect;
    if (v < s) {
      const shown = Math.min(s, v / (1 - MAX_COVER_CROP));
      return new THREE.Vector2(s / shown, v / shown);
    }
    const shown = Math.max(s, v * (1 - MAX_COVER_CROP));
    return new THREE.Vector2(shown / v, shown / s);
  }

  function fail(deck) {
    deck.state = 'idle';
    if (programme[deck.index]?.reel) {
      console.warn('[cinema] The reel could not be loaded — streaming the films instead.');
      programme = CLIPS;
      start();
      return;
    }
    console.warn(`[cinema] Skipping "${programme[deck.index]?.title}" — it couldn't be loaded.`);
    if (++failures >= programme.length * 2) {
      onFail?.();
      return;
    }
    load(deck, nextIndex());
  }

  function cut(deck) {
    if (!live) starting = true;
    deck.state = 'starting';
    deck.video.muted = muted;
    deck.video.volume = live ? 0 : 1;
    deck.video
      .play()
      .then(() => {
        const previous = live;
        live = deck;
        starting = false;
        failures = 0;
        // At start-up both decks load at once; the slower one simply becomes the next clip.
        const other = decks.find((d) => d !== deck);
        incoming = previous ? null : ['loading', 'seeking', 'buffering', 'ready'].includes(other.state) ? other : null;
        deck.state = 'live';
        deck.liveSince = deck.video.currentTime;
        if (previous) previous.state = 'outgoing';
        if (!reelMode()) onClip?.(programme[deck.index], deck.index);
        onPlaying?.();
      })
      .catch((err) => {
        deck.state = 'ready';
        starting = false;
        if (err?.name === 'NotAllowedError') onBlocked?.();
      });
  }

  function sampleFrame(video) {
    try {
      sctx.drawImage(video, 0, 0, sampler.width, sampler.height);
      const d = sctx.getImageData(0, 0, sampler.width, sampler.height).data;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      const n = (d.length / 4) * 255;
      sampled.setRGB(r / n, g / n, b / n, THREE.SRGBColorSpace);
    } catch {
      // Cross-origin video without CORS: keep the previous colour.
    }
  }

  function frameLuminance(video) {
    sampleFrame(video);
    return sampled.r * 0.2126 + sampled.g * 0.7152 + sampled.b * 0.0722;
  }

  function update(dt) {
    const now = performance.now();

    if (live && reelMode() && opacityTarget > 0) {
      // The reel carries its own crossfades; just keep the "Now showing" title in step with it.
      const k = Math.floor((live.video.currentTime - REEL.fadeSeconds / 2) / REEL.segmentSeconds);
      const film = Math.max(0, Math.min(REEL.films.length - 1, k));
      if (film !== reelFilm) {
        reelFilm = film;
        onClip?.(REEL.films[film], film);
      }
    } else if (live) {
      const elapsed = live.video.currentTime - live.liveSince;
      if (!incoming && elapsed >= CLIP_SECONDS - PRELOAD_SECONDS) {
        incoming = decks.find((d) => d !== live);
        load(incoming, nextIndex());
      }
      if (incoming && incoming.state === 'ready' && (elapsed >= CLIP_SECONDS || live.video.ended)) cut(incoming);
      if (incoming && ['loading', 'seeking', 'buffering'].includes(incoming.state) && now - incoming.since > READY_TIMEOUT * 1000) {
        fail(incoming);
      }
    } else {
      for (const d of decks) {
        if (['loading', 'seeking', 'buffering'].includes(d.state) && now - d.since > READY_TIMEOUT * 1000) fail(d);
      }
    }

    // Crossfade picture (and sound) toward the live deck.
    if (live) {
      const target = live.slot;
      mix += Math.sign(target - mix) * Math.min(Math.abs(target - mix), dt / FADE_SECONDS);
      brightness = Math.min(1, brightness + dt / 1.2);
      const outgoing = decks.find((d) => d !== live && d.state === 'outgoing');
      const k = live.slot === 1 ? mix : 1 - mix; // how far the live deck has faded in
      if (!muted) {
        live.video.volume = k;
        if (outgoing) outgoing.video.volume = 1 - k;
      }
      if (outgoing && k >= 1) {
        outgoing.video.pause();
        outgoing.state = 'idle';
      }
      sampleIn -= dt;
      if (palette) sampleIn = 1; // lit by the film's palette instead (see below)
      if (sampleIn <= 0 && live.video.readyState >= 2) {
        sampleIn = 0.1;
        sampleFrame(live.video);
      }
    }
    uniforms.uMix.value = mix;
    uniforms.uBrightness.value = brightness * brightness * (3 - 2 * brightness);
    opacity += Math.sign(opacityTarget - opacity) * Math.min(Math.abs(opacityTarget - opacity), dt / 1.1);
    uniforms.uOpacity.value = opacity * opacity * (3 - 2 * opacity);
    if (palette) {
      // YouTube doesn't let pages read its pixels, so the room glows in the film's own palette: drifting
      // slowly from colour to colour, with the uneven flicker of projected light.
      const t = performance.now() / 1000;
      const phase = (t / 3.4) % palette.length;
      const i = Math.floor(phase);
      const f = phase - i;
      paletteColor.copy(palette[i]).lerp(palette[(i + 1) % palette.length], f * f * (3 - 2 * f));
      const flicker = 0.5 + 0.25 * Math.sin(t * 1.3) + 0.15 * Math.sin(t * 2.7 + 1.1) + 0.1 * Math.sin(t * 6.1 + 0.4);
      sampled.copy(paletteColor).multiplyScalar(0.16 + 0.17 * flicker);
    }
    glow.lerp(sampled, 1 - Math.exp(-dt * 5));
  }

  function start() {
    const n = programme.length;
    if (!n) {
      onFail?.('no-reel');
      return;
    }
    cursor = reelMode() ? -1 : (((startIndex - 1) % n) + n) % n;
    load(decks[0], nextIndex());
    if (!reelMode()) load(decks[1], nextIndex()); // whichever is ready first plays first
  }

  function setMuted(value) {
    muted = value;
    for (const d of decks) d.video.muted = muted;
    if (live) live.video.volume = 1;
  }

  /** Call from a click handler if the browser refused to autoplay. */
  function resume() {
    const deck = decks.find((d) => d.state === 'ready');
    if (deck) cut(deck);
  }

  /** 1 shows the projected picture; 0 turns the screen into a window onto the trailer layer. */
  function setVisible(value) {
    opacityTarget = value;
  }

  /** Start the reel, or resume it where it was paused. */
  function playReel() {
    hold = false;
    reelFilm = -1;
    if (live && reelMode()) {
      live.video.play().catch(() => {});
      return;
    }
    const ready = decks.find((d) => d.state === 'ready');
    if (ready && !starting) cut(ready);
  }

  /** Light the room in these colours instead of from the picture (null to go back). */
  function setGlow(colors) {
    palette = colors ? [].concat(colors).map((c) => new THREE.Color(c)) : null;
  }

  function pauseReel() {
    if (live && reelMode()) live.video.pause();
  }

  /** Seconds until the playing reel comes round to its end, or null if no reel is playing. */
  function reelTimeLeft() {
    if (!live || !reelMode() || live.video.paused || !Number.isFinite(live.video.duration)) return null;
    return live.video.duration - live.video.currentTime;
  }

  /*
   * Cinema acoustics for the projected film: a big-hall echo that grows as you move back into the room.
   * Browsers only let a page start sound processing after a click, so this is set up from the sound button.
   */
  let audio = null;
  function enableAudio() {
    if (!audio) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      const ctx = new Context();
      const warmth = ctx.createBiquadFilter(); // a touch of extra low end, like big cinema speakers
      warmth.type = 'lowshelf';
      warmth.frequency.value = 140;
      warmth.gain.value = 0;
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      wet.gain.value = 0;
      const hall = ctx.createConvolver();
      hall.buffer = hallImpulse(ctx, 2.8);
      warmth.connect(dry);
      warmth.connect(hall);
      hall.connect(wet);
      const master = ctx.createGain(); // fades everything out as the programme wall rises
      dry.connect(master);
      wet.connect(master);
      master.connect(ctx.destination);
      for (const d of decks) ctx.createMediaElementSource(d.video).connect(warmth);
      audio = { ctx, dry, wet, warmth, master, room: -1 };
    }
    audio.ctx.resume();
  }

  /** 0..1: overall volume of the projected film (the programme wall fades it out). */
  function setMaster(value) {
    if (audio) audio.master.gain.setTargetAtTime(value, audio.ctx.currentTime, 0.08);
  }

  /** 0 = right at the screen (dry), 1 = up in the balcony (full hall sound). */
  function setRoom(amount) {
    if (!audio || Math.abs(amount - audio.room) < 0.01) return;
    audio.room = amount;
    const t = audio.ctx.currentTime;
    audio.dry.gain.setTargetAtTime(1 - 0.3 * amount, t, 0.08);
    audio.wet.gain.setTargetAtTime(0.7 * amount, t, 0.08);
    audio.warmth.gain.setTargetAtTime(4 * amount, t, 0.08);
  }

  return {
    material,
    glow,
    start,
    update,
    setMuted,
    resume,
    setVisible,
    playReel,
    pauseReel,
    reelTimeLeft,
    setGlow,
    enableAudio,
    setRoom,
    setMaster,
  };
}

/**
 * The sound of a big hall: a short pre-delay, a few early reflections off the walls, then a dense tail that
 * darkens as it fades, the way seats and fabric soak up the high frequencies.
 */
function hallImpulse(ctx, seconds) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let tone = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const k = 0.12 + 0.8 * Math.exp(-t * 2.2); // the tail loses its treble over time
      tone += k * (Math.random() * 2 - 1 - tone);
      const decay = Math.pow(1 - i / length, 2.4) * Math.exp(-t * 1.3);
      data[i] = t < 0.018 ? 0 : tone * decay;
    }
    for (const [ms, gain] of [
      [23, 0.5],
      [37, 0.35],
      [52, 0.3],
      [71, 0.22],
    ]) {
      data[Math.floor(((ms + ch * 3) / 1000) * rate)] += gain * (ch ? -1 : 1);
    }
  }
  return buffer;
}
