import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createFilm } from './film.js';
import { createCinema, seatEye, SCREEN_Z } from './cinema.js';

/* ---------- Tunables ---------- */

const START_FOV = 50; // camera lens while the film is fullscreen
const SEAT_FOV = 52; // camera lens once you're sitting down
const MIN_SEAT_HFOV = 60; // on narrow (phone) screens, widen the lens so the whole screen still fits
const SEAT_LOOK_DROP = 1.8; // how far below the screen centre you look when seated (shows the rows in front)
const SEAT = seatEye(6); // which row you end up in (0 = front)
const SCROLL_DAMPING = 3.5; // higher = camera follows the scroll more tightly
const CRANE_HEIGHT = 0.7; // how much the camera lifts mid-move, in metres

/* ---------- Renderer ---------- */

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'high-performance' });
const pixelRatio = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.NoToneMapping; // keep the film's colours exactly as shot

const scene = new THREE.Scene();
scene.background = new THREE.Color('#000000');
const camera = new THREE.PerspectiveCamera(START_FOV, innerWidth / innerHeight, 0.05, 80);

/* ---------- Film + cinema ---------- */

const ui = {
  loading: document.getElementById('loading'),
  play: document.getElementById('play'),
  hint: document.getElementById('hint'),
  sound: document.getElementById('sound'),
  soundLabel: document.getElementById('sound-label'),
};

const film = createFilm({
  onTexture: (texture) => cinema.setFilmTexture(texture),
  onAspect: (aspect) => cinema.setScreenAspect(aspect),
  onPlaying: () => {
    ui.loading.classList.add('is-done');
    ui.play.hidden = true;
  },
  onBlocked: () => {
    ui.loading.classList.add('is-done');
    ui.play.hidden = false;
  },
});
const cinema = createCinema(scene, film.texture);
film.start();

ui.play.addEventListener('click', () => {
  ui.play.hidden = true;
  film.play();
});

ui.sound.addEventListener('click', () => {
  const turnOn = film.video.muted;
  film.setMuted(!turnOn);
  ui.sound.setAttribute('aria-pressed', String(turnOn));
  ui.soundLabel.textContent = turnOn ? 'Sound on' : 'Sound off';
});

/* ---------- Post-processing ---------- */

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, uStrength: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(1.0, 1.2);
      c.rgb *= mix(1.0, smoothstep(0.85, 0.15, length(d)), uStrength);
      gl_FragColor = c;
    }`,
};

const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }),
);
composer.setPixelRatio(pixelRatio);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0, 0.7, 0.82);
composer.addPass(bloom);
const vignette = new ShaderPass(VignetteShader);
composer.addPass(vignette);
composer.addPass(new OutputPass());

/* ---------- Scroll + pointer ---------- */

// Always begin fullscreen, even after a reload halfway down the page.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

let scrollTarget = 0;
let progress = 0; // 0 = fullscreen film, 1 = sitting in the cinema
function readScroll() {
  const max = document.documentElement.scrollHeight - innerHeight;
  scrollTarget = max > 0 ? THREE.MathUtils.clamp(window.scrollY / max, 0, 1) : 0;
}
addEventListener('scroll', readScroll, { passive: true });
readScroll();

const pointer = new THREE.Vector2();
const pointerTarget = new THREE.Vector2();
addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  pointerTarget.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
});
document.documentElement.addEventListener('mouseleave', () => pointerTarget.set(0, 0));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
  readScroll();
});

/* ---------- Animation ---------- */

const lerp = THREE.MathUtils.lerp;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Vertical FOV that gives at least `hfov` degrees horizontally at this aspect ratio. */
function verticalFov(hfov, aspect) {
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov / 2)) / aspect));
}

/** Distance at which the screen exactly covers the viewport (like object-fit: cover). */
function coverDistance(fov, aspect, w, h) {
  const t = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  return Math.min(h / 2 / t, w / 2 / (t * aspect)) * 0.998;
}

const lookAt = new THREE.Vector3();
let last = performance.now();

renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const time = now / 1000;

  progress += (scrollTarget - progress) * (1 - Math.exp(-dt * SCROLL_DAMPING));
  if (Math.abs(scrollTarget - progress) < 1e-4) progress = scrollTarget;
  pointer.lerp(pointerTarget, 1 - Math.exp(-dt * 2.5));

  const e = easeInOutCubic(progress);
  const drop = easeInOutCubic(clamp01((progress - 0.08) / 0.92)); // sit down slightly after pulling back
  const s = cinema.screen;

  // Pull back from "the screen fills your view" to "you're in row 7".
  const fullscreenZ = SCREEN_Z + coverDistance(START_FOV, camera.aspect, s.width, s.height);
  camera.position.set(
    lerp(0, SEAT.x, e),
    lerp(s.centerY, SEAT.y, drop) + Math.sin(Math.PI * e) * CRANE_HEIGHT + Math.sin(time * 0.5) * 0.012 * e,
    lerp(fullscreenZ, SEAT.z, e),
  );
  // Once seated, the mouse lets you glance around the room.
  lookAt.set(pointer.x * 3.2 * e, lerp(s.centerY, s.centerY - SEAT_LOOK_DROP, e) - pointer.y * 1.4 * e, SCREEN_Z);
  camera.fov = lerp(START_FOV, Math.max(SEAT_FOV, verticalFov(MIN_SEAT_HFOV, camera.aspect)), e);
  camera.updateProjectionMatrix();
  camera.lookAt(lookAt);

  film.update(dt, time);
  const pixelScale = (innerHeight * pixelRatio * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  cinema.update({ time, reveal: smoothstep(0.2, 0.9, e), glow: film.glow, pixelScale });

  bloom.strength = 0.6 * smoothstep(0.05, 0.7, e);
  bloom.enabled = bloom.strength > 0.001;
  vignette.uniforms.uStrength.value = 0.85 * e;

  ui.hint.style.opacity = String(1 - smoothstep(0, 0.06, progress));

  composer.render();
});
