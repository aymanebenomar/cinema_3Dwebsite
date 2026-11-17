import './style.css';
import * as THREE from 'three';
import { createCinema, SCREEN, BALCONY_EYE, BALCONY_LOOK } from './cinema.js';
import { createProjector } from './projector.js';

/* ---------- Tunables ---------- */

const START_FOV = 50; // camera lens while the film is fullscreen
const SEAT_FOV = 58; // camera lens once you're up in the balcony
const MIN_SEAT_HFOV = 60; // on narrow (phone) screens, widen the lens so the whole screen still fits
const SCROLL_SMOOTH = 0.55; // seconds the camera takes to catch up with the scroll (spring)
const LOOK_SMOOTH = 0.7; // same, for mouse look
const CRANE_HEIGHT = 0.9; // extra lift mid-move, in metres, for a floaty crane shot

/* ---------- Renderers ---------- */

const canvas = document.getElementById('scene');
let pixelRatio = Math.min(window.devicePixelRatio, 2);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
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
};

const startClip = Number.parseInt(new URLSearchParams(location.search).get('clip') ?? '0', 10) || 0;
const projector = createProjector({
  screenAspect: SCREEN.aspect,
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
  onFail: () => {
    ui.loading.textContent = 'Films unavailable — check your connection';
  },
});
const cinema = createCinema(scene, projector.material);
projector.start();

ui.play.addEventListener('click', () => {
  ui.play.hidden = true;
  projector.resume();
});

let muted = true;
ui.sound.addEventListener('click', () => {
  muted = !muted;
  projector.setMuted(muted);
  ui.sound.setAttribute('aria-pressed', String(!muted));
  ui.soundLabel.textContent = muted ? 'Sound off' : 'Sound on';
});

let titleTimer = 0;
function showTitle(clip) {
  ui.now.classList.add('is-swapping');
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => {
    ui.nowTitle.textContent = clip.year ? `${clip.title} (${clip.year})` : clip.title;
    ui.nowNote.textContent = clip.credit ?? '';
    ui.now.classList.remove('is-swapping');
  }, 380);
}

/* ---------- Scroll + pointer ---------- */

// Always begin fullscreen, even after a reload halfway down the page.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

let scrollTarget = 0;
function readScroll() {
  const max = document.documentElement.scrollHeight - innerHeight;
  scrollTarget = max > 0 ? THREE.MathUtils.clamp(window.scrollY / max, 0, 1) : 0;
}
addEventListener('scroll', readScroll, { passive: true });
readScroll();

const pointerTarget = new THREE.Vector2();
addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  pointerTarget.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
});
document.documentElement.addEventListener('mouseleave', () => pointerTarget.set(0, 0));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  renderer.setSize(innerWidth, innerHeight, false);
  readScroll();
});

/* ---------- Motion helpers ---------- */

const lerp = THREE.MathUtils.lerp;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

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

renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const time = now / 1000;

  const p = spring(progress, scrollTarget, SCROLL_SMOOTH, dt);
  const px = spring(lookX, pointerTarget.x, LOOK_SMOOTH, dt);
  const py = spring(lookY, pointerTarget.y, LOOK_SMOOTH, dt);

  const e = easeInOutCubic(p); // pull back
  const lift = easeInOutCubic(clamp01(p * 1.3)); // rise slightly ahead of the pull back, to clear the balcony rail

  const fullscreenZ = SCREEN.z + coverDistance(START_FOV, camera.aspect);
  camera.position.set(
    0,
    lerp(SCREEN.centerY, BALCONY_EYE.y, lift) + Math.sin(Math.PI * e) * CRANE_HEIGHT + Math.sin(time * 0.45) * 0.015 * e,
    lerp(fullscreenZ, BALCONY_EYE.z, e),
  );
  // Once seated, the mouse lets you glance around the room.
  lookAt.set(px * 4.5 * e, lerp(SCREEN.centerY, BALCONY_LOOK.y, e) - py * 2.2 * e, BALCONY_LOOK.z);
  camera.fov = lerp(START_FOV, Math.max(SEAT_FOV, verticalFov(MIN_SEAT_HFOV, camera.aspect)), e);
  camera.updateProjectionMatrix();
  camera.lookAt(lookAt);

  projector.update(dt);
  cinema.update({ glow: projector.glow });

  ui.hint.style.opacity = String(1 - smoothstep(0, 0.06, p));
  ui.vignette.style.opacity = String(e);

  renderer.render(scene, camera);

  // Keep it fluid on slower GPUs: if frames run long, render at a lower resolution.
  perfGrace -= dt;
  if (perfGrace < 0) {
    perfTime += dt;
    perfFrames++;
    if (perfTime > 2) {
      if (perfTime / perfFrames > 1 / 45 && pixelRatio > 1) {
        pixelRatio = Math.max(1, pixelRatio - 0.25);
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(innerWidth, innerHeight, false);
      }
      perfTime = 0;
      perfFrames = 0;
    }
  }
});
