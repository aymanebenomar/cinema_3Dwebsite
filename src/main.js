import 'lenis/dist/lenis.css';
import './style.css';
import Lenis from 'lenis';
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { createCinema, SCREEN, BALCONY_EYE, BALCONY_LOOK } from './cinema.js';
import { createProjector } from './projector.js';
import { TRAILERS } from './clips.js';
import { createTrailers, FRAME } from './trailers.js';
import { createProgramme } from './programme.js';

/* ---------- Tunables ---------- */

const START_FOV = 50; // camera lens while the film is fullscreen
const SEAT_FOV = 58; // camera lens once you're up in the balcony
const MIN_SEAT_HFOV = 60; // on narrow (phone) screens, widen the lens so the whole screen still fits
const ZOOM_SMOOTH = 0.22; // the camera trails the scroll by a touch, so it moves with weight
const BACK_TO_SEAT = 2; // seconds: picking a film glides you back down to your seat
const LOOK_SMOOTH = 0.7; // mouse look eases like a head turning
const CRANE_HEIGHT = 0.5; // a gentle extra lift mid-move, in metres, like a crane shot

/* ---------- Renderers ---------- */

const canvas = document.getElementById('scene');
let pixelRatio = Math.min(window.devicePixelRatio, 2);
const MIN_PIXEL_RATIO = Math.min(1.5, pixelRatio); // never drop below this, even on a slow GPU

// The canvas is transparent wherever the screen shows a YouTube trailer (it sits behind the canvas).
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight, false);
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.NoToneMapping;
// Seat shadows from the house lights. Nothing in the room moves, so they're rendered once, not every frame.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(START_FOV, innerWidth / innerHeight, 0.05, 120);

// Trailers are YouTube players, placed exactly on the 3D screen with CSS 3D, using the same camera.
const cssRenderer = new CSS3DRenderer();
cssRenderer.setSize(innerWidth, innerHeight);
cssRenderer.domElement.className = 'screen-layer';
document.body.insertBefore(cssRenderer.domElement, canvas);
const cssScene = new THREE.Scene();
const frameEl = document.createElement('div');
frameEl.className = 'screen-frame';
frameEl.style.width = `${FRAME.width}px`;
frameEl.style.height = `${FRAME.height}px`;
const screenObject = new CSS3DObject(frameEl);
frameEl.style.pointerEvents = 'none'; // the player must never react to the mouse
screenObject.position.set(0, SCREEN.centerY, SCREEN.z);
// Most of these videos carry black bars inside the picture. Zoomed in a little, the bars fall outside the
// screen, so every film fills it edge to edge and the screen never seems to change size.
const FILL_ZOOM = 1.12;
screenObject.scale.setScalar((SCREEN.width / FRAME.width) * FILL_ZOOM);
cssScene.add(screenObject);

/* ---------- Cinema + projector ---------- */

const ui = {
  loading: document.getElementById('loading'),
  play: document.getElementById('play'),
  hint: document.getElementById('hint'),
  sound: document.getElementById('sound'),
  soundLabel: document.getElementById('sound-label'),
  now: document.getElementById('now-showing'),
  nowTitle: document.getElementById('now-title'),
  nowNote: document.getElementById('now-note'),
  vignette: document.getElementById('vignette'),
  hintProgramme: document.getElementById('hint-programme'),
  nowLabel: document.getElementById('now-label'),
};

const startClip = Number.parseInt(new URLSearchParams(location.search).get('clip') ?? '0', 10) || 0;
const projector = createProjector({
  screenAspect: SCREEN.aspect,
  anisotropy: renderer.capabilities.getMaxAnisotropy(),
  startIndex: startClip,
  onClip: (clip) => showTitle(clip),
  onPlaying: () => {
    ui.loading.classList.add('is-done');
    ui.play.hidden = true;
  },
  onBlocked: () => {
    ui.loading.classList.add('is-done');
    ui.play.hidden = false;
  },
  onFail: (reason) => {
    ui.loading.textContent = reason === 'no-reel' ? 'No reel yet — run npm run reel' : 'Films unavailable — check your connection';
  },
});
const cinema = createCinema(scene, projector.material);

// The programme: the famous films, 10 seconds each, round and round. Until the first one is ready the screen
// stays dark, like a real cinema before the show. If YouTube can't load at all, the reel plays instead.
let trailerFailures = 0;
let showingIndex = -1; // which of TRAILERS is on screen
const trailers = TRAILERS.length
  ? createTrailers(frameEl, TRAILERS, {
      onShow: (film, index) => {
        trailerFailures = 0;
        showingIndex = index;
        ui.loading.classList.add('is-done');
        projector.setVisible(0); // the screen becomes a window onto the film
        projector.setGlow(film.light);
        showTitle(film);
      },
      onFail: () => {
        // Try again in a moment; after three misses in a row, YouTube is clearly blocked here.
        if (++trailerFailures >= 3) startReel();
        else setTimeout(() => trailers.play(), 4000);
      },
    })
  : null;

function startReel() {
  trailers?.stop();
  projector.setGlow(null);
  projector.setVisible(1);
  projector.start();
}

if (trailers) trailers.play();
else startReel();

// This week's programme, on the wall that rises over the cinema. Picking a film takes you back to your seat
// to watch it: it comes on as soon as it's ready.
const programme = createProgramme({
  onSelect: (index) => {
    if (trailers && index !== showingIndex) {
      trailers.jump(index);
      showTitle(TRAILERS[index], 'Up next');
    }
    programme.leave();
    glideTo(programme.stops().seat, BACK_TO_SEAT);
  },
});

ui.play.addEventListener('click', () => {
  ui.play.hidden = true;
  projector.resume();
});

let muted = true;
ui.sound.addEventListener('click', () => {
  muted = !muted;
  projector.enableAudio(); // the click lets the browser start the cinema sound
  projector.setMuted(muted);
  trailers?.setMuted(muted);
  ui.sound.setAttribute('aria-pressed', String(!muted));
  ui.soundLabel.textContent = muted ? 'Sound off' : 'Sound on';
});

let titleTimer = 0;
function showTitle(clip, label = 'Now showing') {
  ui.now.classList.add('is-swapping');
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => {
    ui.nowLabel.textContent = label;
    ui.nowTitle.textContent = clip.year ? `${clip.title} (${clip.year})` : clip.title;
    ui.nowNote.textContent = clip.credit ?? '';
    ui.now.classList.remove('is-swapping');
  }, 380);
}

/* ---------- Scrolling ---------- */

// Always begin fullscreen, even after a reload halfway down the page.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

// Smooth, weighted scrolling, the same with a mouse wheel, a trackpad or a finger.
const lenis = new Lenis({ lerp: 0.065, wheelMultiplier: 0.85, touchMultiplier: 1.4, syncTouch: true, syncTouchLerp: 0.065 });

// Everything follows the scroll, in order and never overlapping: first the camera pulls back from the film to your
// seat, then you sit for a moment, then the programme wall rises, then the cards slide along it. A little scroll
// moves things a little; scroll back and it all plays in reverse.
const zoomSpace = document.getElementById('scroll-zoom'); // its height is how far you scroll for the camera move
let zoomLength = zoomSpace.offsetHeight;

const glideEase = (t) => 0.5 - Math.cos(Math.PI * t) / 2; // eases in, eases out
let glideEnds = 0; // when a glide in progress is over, in performance.now() ms (0 = none)

/** Scroll smoothly to `y` by itself (the wheel waits until it's there). */
function glideTo(y, seconds) {
  glideEnds = performance.now() + seconds * 1000 + 500; // the extra half second covers an interrupted glide
  lenis.scrollTo(y, { duration: seconds, easing: glideEase, lock: true, force: true, onComplete: () => (glideEnds = 0) });
}

const pointerTarget = new THREE.Vector2();
addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  pointerTarget.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
});
document.documentElement.addEventListener('mouseleave', () => pointerTarget.set(0, 0));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  renderer.setSize(innerWidth, innerHeight, false);
  cssRenderer.setSize(innerWidth, innerHeight);

  // Stay where you were (in your seat, or at the same card) when the window changes size.
  const before = programme.stops();
  const y = lenis.scroll;
  programme.layout();
  zoomLength = zoomSpace.offsetHeight;
  lenis.resize();
  const after = programme.stops();
  let target = null;
  if (y < 1) target = 0;
  else if (before.top > before.seat + 1 && y >= before.top - 1) {
    const along = before.end > before.top ? (y - before.top) / (before.end - before.top) : 0;
    target = after.top + along * (after.end - after.top);
  } else if (Math.abs(y - before.seat) < 2) target = after.seat;
  if (target !== null && !glideEnds && Math.abs(target - y) > 1) lenis.scrollTo(target, { immediate: true, force: true });
});

/* ---------- Motion helpers ---------- */

const lerp = THREE.MathUtils.lerp;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Write a style only when its value changes, so a still page costs the browser nothing. */
const written = new WeakMap();
function setStyle(el, prop, value) {
  let props = written.get(el);
  if (!props) written.set(el, (props = {}));
  if (props[prop] === value) return;
  props[prop] = value;
  el.style.setProperty(prop, value);
}

/** Critically damped spring: eases in and out of every change and never overshoots. */
function spring(state, target, smoothTime, dt) {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const from = state.value;
  const change = from - target;
  const temp = (state.velocity + omega * change) * dt;
  state.velocity = (state.velocity - omega * temp) * decay;
  let next = target + (change + temp) * decay;
  if (target - from > 0 === next > target) {
    next = target;
    state.velocity = 0;
  }
  state.value = next;
  return next;
}

/** Vertical FOV that gives at least `hfov` degrees horizontally at this aspect ratio. */
function verticalFov(hfov, aspect) {
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov / 2)) / aspect));
}

/** Distance at which the screen exactly covers the viewport (like object-fit: cover). */
function coverDistance(fov, aspect) {
  const t = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  return Math.min(SCREEN.height / 2 / t, SCREEN.width / 2 / (t * aspect)) * 0.998;
}

/* ---------- Frame loop ---------- */

const progress = { value: 0, velocity: 0 }; // 0 = fullscreen film, 1 = sitting in the balcony
const lookX = { value: 0, velocity: 0 };
const lookY = { value: 0, velocity: 0 };
const lookAt = new THREE.Vector3();
let last = performance.now();
let perfTime = 0;
let perfFrames = 0;
let perfGrace = 4; // seconds to ignore while everything loads
let drawnOnce = false;

renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const time = now / 1000;

  lenis.raf(now);
  if (glideEnds && now > glideEnds) glideEnds = 0;
  const y = lenis.scroll;
  const p = spring(progress, clamp01(y / Math.max(1, zoomLength)), ZOOM_SMOOTH, dt);
  const px = spring(lookX, pointerTarget.x, LOOK_SMOOTH, dt);
  const py = spring(lookY, pointerTarget.y, LOOK_SMOOTH, dt);

  const e = p * p * (3 - 2 * p); // the move starts gently and settles softly, however fast you scroll

  const fullscreenZ = SCREEN.z + coverDistance(START_FOV, camera.aspect);
  camera.position.set(
    0,
    lerp(SCREEN.centerY, BALCONY_EYE.y, e) + Math.sin(Math.PI * e) * CRANE_HEIGHT + Math.sin(time * 0.45) * 0.015 * e,
    lerp(fullscreenZ, BALCONY_EYE.z, e),
  );
  // Once seated, the mouse lets you glance around the room.
  lookAt.set(px * 4.5 * e, lerp(SCREEN.centerY, BALCONY_LOOK.y, e) - py * 1.1 * e, BALCONY_LOOK.z);
  camera.fov = lerp(START_FOV, Math.max(SEAT_FOV, verticalFov(MIN_SEAT_HFOV, camera.aspect)), e);
  camera.updateProjectionMatrix();
  camera.lookAt(lookAt);

  projector.update(dt);
  const cover = programme.update(y); // how much the programme has taken over from the cinema
  // The cinema's own captions and sound button bow out as it does. (Set on those two only: a value set on
  // the whole page every frame would make the browser restyle everything, every frame.)
  setStyle(ui.now, '--cover', cover.toFixed(3));
  setStyle(ui.sound, '--cover', cover.toFixed(3));
  cinema.update({ glow: projector.glow });

  setStyle(ui.hint, 'opacity', (1 - smoothstep(0, 0.06, p)).toFixed(3));
  setStyle(ui.vignette, 'opacity', e.toFixed(3));
  projector.setRoom(e); // the further back you are, the more of the hall you hear
  trailers?.setDistance(e);
  projector.setMaster(1 - cover); // and as the programme comes in, the sound fades away
  trailers?.setMaster(1 - cover);
  setStyle(ui.hintProgramme, 'opacity', (smoothstep(0.92, 1, e) * (1 - smoothstep(0, 0.12, cover))).toFixed(3));

  // Once the programme has all but covered the cinema, stop drawing the room: what still shows through is a
  // still frame (the film itself keeps playing), and the tickets get the computer's full power for their entrance.
  // It resumes on the way back. (It's always drawn at least once: that's also what puts the film players on the page.)
  if (cover < 0.9 || !drawnOnce) {
    drawnOnce = true;
    renderer.render(scene, camera);
    cssRenderer.render(cssScene, camera);
  }

  // Keep it fluid on slower GPUs: if frames run long, render at a lower resolution.
  perfGrace -= dt;
  if (perfGrace < 0) {
    perfTime += dt;
    perfFrames++;
    if (perfTime > 2) {
      if (perfTime / perfFrames > 1 / 38 && pixelRatio > MIN_PIXEL_RATIO) {
        pixelRatio = Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.25);
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(innerWidth, innerHeight, false);
      }
      perfTime = 0;
      perfFrames = 0;
    }
  }
});
