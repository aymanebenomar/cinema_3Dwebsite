import * as THREE from 'three';

/**
 * The film that plays on the screen.
 *
 * To use your own film, put it at `public/film.mp4` — it is picked up automatically.
 * Until then a placeholder streams in: "Sintel" © Blender Foundation (durian.blender.org),
 * licensed CC BY 3.0, served by Wikimedia Commons. Both hosts send CORS headers,
 * which WebGL needs to use a video as a texture.
 */
const LOCAL_FILM = '/film.mp4';
const PLACEHOLDER_FILMS = [
  {
    src: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/f/f1/Sintel_movie_4K.webm/Sintel_movie_4K.webm.1080p.vp9.webm',
    type: 'video/webm',
  },
  // Small MP4 fallback for browsers without VP9 WebM.
  { src: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/sintel.mp4', type: 'video/mp4' },
];

async function hasLocalFilm() {
  try {
    const res = await fetch(LOCAL_FILM, { method: 'HEAD' });
    return res.ok && (res.headers.get('content-type') || '').startsWith('video/');
  } catch {
    return false;
  }
}

export function createFilm({ onTexture, onAspect, onPlaying, onBlocked } = {}) {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true; // browsers only autoplay muted video
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  // Average colour of the current frame, used to light the room with the film.
  const glow = new THREE.Color(0.05, 0.05, 0.06); // smoothed, linear
  const sampled = glow.clone();
  const sampler = document.createElement('canvas');
  sampler.width = 16;
  sampler.height = 9;
  const sctx = sampler.getContext('2d', { willReadFrequently: true });
  let sampleIn = 0;
  let canSample = true;

  let leader = null; // procedural fallback if no film can load

  video.addEventListener('loadedmetadata', () => {
    if (video.videoWidth && video.videoHeight) onAspect?.(video.videoWidth / video.videoHeight);
  });
  video.addEventListener('playing', () => onPlaying?.());

  function play() {
    if (leader) return Promise.resolve();
    return video.play().catch((err) => {
      if (err && err.name === 'NotAllowedError') onBlocked?.();
    });
  }

  function useLeader() {
    if (leader) return;
    console.warn('[cinema] No film could be loaded — showing a countdown leader instead.');
    leader = createLeader();
    canSample = false;
    onTexture?.(leader.texture);
    onAspect?.(leader.aspect);
    onPlaying?.();
  }

  async function start() {
    const sources = (await hasLocalFilm()) ? [{ src: LOCAL_FILM }, ...PLACEHOLDER_FILMS] : PLACEHOLDER_FILMS;
    sources.forEach(({ src, type }, i) => {
      const el = document.createElement('source');
      el.src = src;
      if (type) el.type = type;
      if (i === sources.length - 1) el.addEventListener('error', useLeader);
      video.appendChild(el);
    });
    video.load();
    play();
  }

  function sampleFrame() {
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
      canSample = false; // tainted canvas — keep the last colour
    }
  }

  function update(dt, time) {
    if (leader) {
      leader.draw(time);
      sampled.setRGB(0.62, 0.58, 0.5, THREE.SRGBColorSpace);
    } else if (canSample && video.readyState >= 2) {
      sampleIn -= dt;
      if (sampleIn <= 0) {
        sampleIn = 0.1;
        sampleFrame();
      }
    }
    glow.lerp(sampled, 1 - Math.exp(-dt * 5));
  }

  function setMuted(muted) {
    video.muted = muted;
    if (!muted && video.paused) play();
  }

  return { video, texture, glow, start, play, update, setMuted };
}

/** An old-school film countdown, drawn on a canvas. Only used if no video loads. */
function createLeader() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const { width: w, height: h } = canvas;
  const cx = w / 2;
  const cy = h / 2;
  const r = h * 0.36;

  return {
    texture,
    aspect: w / h,
    draw(t) {
      const n = 8 - (Math.floor(t) % 8);
      const f = t % 1;
      g.fillStyle = '#cfc6b2';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#8f8673';
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, Math.hypot(w, h), -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
      g.closePath();
      g.fill();
      g.strokeStyle = '#1b1712';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(0, cy);
      g.lineTo(w, cy);
      g.moveTo(cx, 0);
      g.lineTo(cx, h);
      g.stroke();
      for (const k of [1, 0.82]) {
        g.beginPath();
        g.arc(cx, cy, r * k, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#1b1712';
      g.font = `bold ${Math.round(r * 1.25)}px Georgia, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n), cx, cy + r * 0.06);
      g.fillStyle = 'rgba(20, 16, 12, 0.35)';
      for (let i = 0; i < 220; i++) {
        g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
      }
      if (Math.random() < 0.3) g.fillRect(Math.random() * w, 0, 1.5, h);
      texture.needsUpdate = true;
    },
  };
}
