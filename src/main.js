import './style.css';
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
const ZOOM_SMOOTH = 0.75; // the pull-back is one smooth move of about two and a half seconds
const LOOK_SMOOTH = 0.7; // same, for mouse look
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
const trailers = TRAILERS.length
  ? createTrailers(frameEl, TRAILERS, {
      onShow: (film) => {
        trailerFailures = 0;
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

// This week's programme, on the wall that rises over the cinema. Picking a film takes you back to watch it.
const programme = createProgramme({
  onSelect: (index) => {
    trailers?.jump(index);
    window.scrollTo({ top: Math.round(window.innerHeight * 0.3), behavior: 'smooth' });
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

let zoomTarget = 0; // 0 = the film fullscreen, 1 = up in the balcony
function readScroll() {
  // A little scroll is enough: scrolling down from the top plays the whole move out, back to the top plays it in.
  if (window.scrollY > 24) zoomTarget = 1;
  else if (window.scrollY < 4) zoomTarget = 0;
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
  cssRenderer.setSize(innerWidth, innerHeight);
  readScroll();
});

/* ---------- Motion helpers ---------- */

const lerp = THREE.MathUtils.lerp;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

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

  const p = spring(progress, zoomTarget, ZOOM_SMOOTH, dt);
  const px = spring(lookX, pointerTarget.x, LOOK_SMOOTH, dt);
  const py = spring(lookY, pointerTarget.y, LOOK_SMOOTH, dt);

  const e = p; // the spring already starts gently and settles softly

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
  const cover = programme.update(dt); // how much of the cinema the programme wall hides
  document.documentElement.style.setProperty('--cover', cover.toFixed(3));
  cinema.update({ glow: projector.glow });

  ui.hint.style.opacity = String(1 - smoothstep(0, 0.06, p));
  ui.vignette.style.opacity = String(e);
  projector.setRoom(e); // the further back you are, the more of the hall you hear
  trailers?.setDistance(e);
  projector.setMaster(1 - cover); // and as the wall rises, the sound fades away
  trailers?.setMaster(1 - cover);
  ui.hintProgramme.style.opacity = String(smoothstep(0.92, 1, e) * (1 - smoothstep(0, 0.12, cover)));

  // Once the wall hides the cinema completely, stop drawing it (saves the battery); it resumes on the way back.
  if (cover < 0.999) {
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
