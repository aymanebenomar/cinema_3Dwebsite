import * as THREE from 'three';
import { CLIPS, CLIP_SECONDS } from './clips.js';

const FADE_SECONDS = 1.4; // crossfade between clips
const PRELOAD_SECONDS = 4; // start preparing the next clip this long before the cut
const READY_TIMEOUT = 20; // give up on a clip that hasn't buffered after this many seconds
const MAX_COVER_CROP = 0.25; // crop at most this much of a picture to fill the screen

/**
 * The projector: two video "decks" that take turns. While one plays, the other loads and seeks to the
 * next clip; at the cut it starts playing and the screen shader crossfades between them, so there is
 * never a black gap or a loading spinner.
 */
export function createProjector({ screenAspect, startIndex = 0, onClip, onPlaying, onBlocked, onFail } = {}) {
  const decks = [0, 1].map(createDeck);
  let live = null; // deck on screen
  let incoming = null; // deck being prepared
  let muted = true;
  let failures = 0;
  let mix = 0; // 0 = deck 0 visible, 1 = deck 1 visible
  let brightness = 0; // fades the very first clip in from black

  const uniforms = {
    uTex0: { value: null },
    uTex1: { value: null },
    uFit0: { value: new THREE.Vector2(1, 1) },
    uFit1: { value: new THREE.Vector2(1, 1) },
    uMix: { value: 0 },
    uBrightness: { value: 0 },
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
        gl_FragColor = vec4(c * uBrightness, 1.0);
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
      video.currentTime = pickStart(CLIPS[deck.index], video.duration);
    });
    video.addEventListener('seeked', () => {
      if (deck.state !== 'seeking') return;
      deck.state = 'buffering';
      checkReady(deck);
    });
    video.addEventListener('canplay', () => checkReady(deck));
    video.addEventListener('canplaythrough', () => checkReady(deck));
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
    deck.video.src = CLIPS[index].src;
    deck.video.load();
  }

  function checkReady(deck) {
    if (deck.state !== 'buffering' || deck.video.readyState < 3) return;
    // Random scenes sometimes land on a black frame or a fade; try another spot.
    if (typeof CLIPS[deck.index].start !== 'number' && deck.tries < 3 && frameLuminance(deck.video) < 0.035) {
      deck.tries++;
      deck.state = 'seeking';
      deck.video.currentTime = pickStart(CLIPS[deck.index], deck.video.duration);
      return;
    }
    deck.state = 'ready';
    deck.texture?.dispose();
    deck.texture = new THREE.VideoTexture(deck.video);
    deck.texture.colorSpace = THREE.SRGBColorSpace;
    deck.texture.minFilter = THREE.LinearFilter;
    deck.texture.magFilter = THREE.LinearFilter;
    deck.texture.generateMipmaps = false;
    uniforms[`uTex${deck.slot}`].value = deck.texture;
    uniforms[`uFit${deck.slot}`].value.copy(fitFor(deck.video.videoWidth / deck.video.videoHeight));
    if (!live) cut(deck);
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
    console.warn(`[cinema] Skipping "${CLIPS[deck.index]?.title}" — it couldn't be loaded.`);
    deck.state = 'idle';
    if (++failures >= CLIPS.length * 2) {
      onFail?.();
      return;
    }
    load(deck, (deck.index + 1) % CLIPS.length);
  }

  function cut(deck) {
    deck.state = 'starting';
    deck.video.muted = muted;
    deck.video.volume = live ? 0 : 1;
    deck.video
      .play()
      .then(() => {
        const previous = live;
        live = deck;
        incoming = null;
        failures = 0;
        deck.state = 'live';
        deck.liveSince = deck.video.currentTime;
        if (previous) previous.state = 'outgoing';
        onClip?.(CLIPS[deck.index], deck.index);
        onPlaying?.();
      })
      .catch((err) => {
        deck.state = 'ready';
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

    if (live) {
      const elapsed = live.video.currentTime - live.liveSince;
      const nextIndex = (live.index + 1) % CLIPS.length;
      if (!incoming && elapsed >= CLIP_SECONDS - PRELOAD_SECONDS) {
        incoming = decks.find((d) => d !== live);
        load(incoming, nextIndex);
      }
      if (incoming && incoming.state === 'ready' && (elapsed >= CLIP_SECONDS || live.video.ended)) cut(incoming);
      if (incoming && ['loading', 'seeking', 'buffering'].includes(incoming.state) && now - incoming.since > READY_TIMEOUT * 1000) {
        fail(incoming);
      }
    } else {
      const first = decks.find((d) => ['loading', 'seeking', 'buffering'].includes(d.state));
      if (first && now - first.since > READY_TIMEOUT * 1000) fail(first);
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
      if (sampleIn <= 0 && live.video.readyState >= 2) {
        sampleIn = 0.1;
        sampleFrame(live.video);
      }
    }
    uniforms.uMix.value = mix;
    uniforms.uBrightness.value = brightness * brightness * (3 - 2 * brightness);
    glow.lerp(sampled, 1 - Math.exp(-dt * 5));
  }

  function start() {
    const n = CLIPS.length;
    load(decks[0], ((startIndex % n) + n) % n);
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

  return { material, glow, start, update, setMuted, resume };
}
