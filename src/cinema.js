import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

/*
 * The cinema room. Units are metres.
 * The screen hangs on the front wall (z = 0) and faces +z; the audience sits at +z looking back toward it.
 */
export const ROOM = { halfWidth: 10.5, depth: 27, height: 13 };
export const SCREEN_Z = 0.06;
const SCREEN_MAX = { width: 16, height: 9.4, bottom: 2.2 };
const ROWS = { count: 11, startZ: 8.4, depth: 1.2, rise: 0.42 };
const SEAT_PITCH = 0.62;
const AISLE = 1.3;
const BLOCKS = [5, 13, 5]; // seats per block, left → right
const PROJECTOR = new THREE.Vector3(0, 10.6, ROOM.depth - 0.12);

const rowZ = (r) => ROWS.startZ + r * ROWS.depth;
const rowY = (r) => r * ROWS.rise;

/** Where your eyes are when you sit in the middle seat of a row. */
export function seatEye(row = 6) {
  return new THREE.Vector3(0, rowY(row) + 1.18, rowZ(row) + 0.12);
}

export function createCinema(scene, filmTexture) {
  RectAreaLightUniformsLib.init();

  const hw = ROOM.halfWidth;
  const { depth, height } = ROOM;
  const root = new THREE.Group();
  scene.add(root);

  const mats = {
    wall: new THREE.MeshStandardMaterial({ color: '#1c0d12', roughness: 0.95 }),
    panel: new THREE.MeshStandardMaterial({ color: '#33121b', roughness: 0.9 }),
    front: new THREE.MeshStandardMaterial({ color: '#070405', roughness: 1 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#0b0809', roughness: 1 }),
    carpet: new THREE.MeshStandardMaterial({ color: '#1a0a0e', roughness: 1 }),
    stage: new THREE.MeshStandardMaterial({ color: '#100a0c', roughness: 0.8 }),
    curtain: new THREE.MeshStandardMaterial({ color: '#7a0c17', roughness: 0.8, side: THREE.DoubleSide }),
    fabric: new THREE.MeshStandardMaterial({ color: '#8a0e1b', roughness: 0.78 }),
    frame: new THREE.MeshStandardMaterial({ color: '#141114', roughness: 0.45, metalness: 0.3 }),
    door: new THREE.MeshStandardMaterial({ color: '#241a1d', roughness: 0.7 }),
    black: new THREE.MeshBasicMaterial({ color: '#000000' }),
    amber: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.35, 0.55) }),
    projector: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.7, 3.2) }),
  };

  /* ---------- Room shell ---------- */

  const plane = (w, h, mat, x, y, z, rx = 0, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    root.add(m);
    return m;
  };
  plane(2 * hw, depth, mats.carpet, 0, 0, depth / 2, -Math.PI / 2);
  plane(2 * hw, depth, mats.ceiling, 0, height, depth / 2, Math.PI / 2);
  plane(depth, height, mats.wall, -hw, height / 2, depth / 2, 0, Math.PI / 2);
  plane(depth, height, mats.wall, hw, height / 2, depth / 2, 0, -Math.PI / 2);
  plane(2 * hw, height, mats.wall, 0, height / 2, depth, 0, Math.PI);
  plane(2 * hw, height, mats.front, 0, height / 2, 0);

  // Acoustic panels and up-lit wall sconces along both side walls.
  const sconceZ = [6.2, 11.8, 17.4, 23];
  const panelZ = [9, 14.6, 20.2];
  const panelGeo = new THREE.BoxGeometry(0.14, 8.6, 4.2);
  const sconceGeo = new THREE.BoxGeometry(0.08, 0.34, 0.22);
  for (const s of [-1, 1]) {
    for (const z of panelZ) {
      const p = new THREE.Mesh(panelGeo, mats.panel);
      p.position.set(s * (hw - 0.07), 6.9, z);
      root.add(p);
    }
    for (const z of sconceZ) {
      const sconce = new THREE.Mesh(sconceGeo, mats.amber);
      sconce.position.set(s * (hw - 0.04), 6.6, z);
      root.add(sconce);

      const spot = new THREE.SpotLight('#ffa860', 30, 14, 0.5, 0.95, 1.4);
      spot.position.set(s * (hw - 0.4), 6.4, z);
      spot.target.position.set(s * (hw - 0.02), 12, z);
      root.add(spot, spot.target);
    }
  }

  // Exit doors near the front.
  const exitTexture = makeExitTexture();
  for (const s of [-1, 1]) {
    const door = plane(1.5, 2.5, mats.door, s * (hw - 0.02), 1.25, 3.7, 0, -s * Math.PI / 2);
    door.renderOrder = 1;
    const sign = plane(
      0.9,
      0.32,
      new THREE.MeshBasicMaterial({ map: exitTexture, color: new THREE.Color(1.7, 1.7, 1.7) }),
      s * (hw - 0.03),
      3.0,
      3.7,
      0,
      -s * Math.PI / 2,
    );
    sign.renderOrder = 1;
  }

  // Stage under the screen, with a warm LED edge.
  const stage = new THREE.Mesh(new THREE.BoxGeometry(2 * hw, 0.75, 2.2), mats.stage);
  stage.position.set(0, 0.375, 1.1);
  root.add(stage);
  const stageEdge = new THREE.Mesh(new THREE.BoxGeometry(2 * hw - 0.4, 0.02, 0.03), mats.amber);
  stageEdge.position.set(0, 0.755, 2.21);
  root.add(stageEdge);

  // Projector port on the back wall.
  const port = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.06), mats.projector);
  port.position.set(PROJECTOR.x, PROJECTOR.y, depth - 0.03);
  root.add(port);

  /* ---------- Curtains ---------- */

  const sideCurtainW = hw - 8.25 + 0.05;
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(curtainGeometry(sideCurtainW, 12.2, 5, 0.13), mats.curtain);
    c.position.set(s * (8.25 + sideCurtainW / 2), 6.1, 0.35);
    root.add(c);
  }
  const valance = new THREE.Mesh(curtainGeometry(2 * hw, 1.4, 26, 0.07), mats.curtain);
  valance.position.set(0, height - 0.7, 0.5);
  root.add(valance);

  /* ---------- Stadium seating ---------- */

  const layout = seatLayout();

  // Risers: one stepped block per row, plus a platform behind the last row.
  const riserParts = [];
  for (let r = 1; r < ROWS.count; r++) {
    const g = new THREE.BoxGeometry(2 * hw, rowY(r), ROWS.depth);
    g.translate(0, rowY(r) / 2, rowZ(r));
    riserParts.push(g);
  }
  const platformFront = rowZ(ROWS.count) - ROWS.depth / 2;
  const platformY = rowY(ROWS.count);
  const platform = new THREE.BoxGeometry(2 * hw, platformY, depth - platformFront);
  platform.translate(0, platformY / 2, (platformFront + depth) / 2);
  riserParts.push(platform);
  root.add(new THREE.Mesh(mergeGeometries(riserParts), mats.carpet));

  // Seats (instanced: one draw call for upholstery, one for the arms).
  const fabricGeo = seatFabricGeometry();
  const armGeo = seatArmGeometry();
  const seatCount = ROWS.count * layout.seats.length;
  const armCount = ROWS.count * layout.arms.length;
  const seats = new THREE.InstancedMesh(fabricGeo, mats.fabric, seatCount);
  const arms = new THREE.InstancedMesh(armGeo, mats.frame, armCount);
  const dummy = new THREE.Object3D();
  let si = 0;
  let ai = 0;
  for (let r = 0; r < ROWS.count; r++) {
    for (const x of layout.seats) {
      dummy.position.set(x, rowY(r), rowZ(r));
      dummy.updateMatrix();
      seats.setMatrixAt(si++, dummy.matrix);
    }
    for (const x of layout.arms) {
      dummy.position.set(x, rowY(r), rowZ(r));
      dummy.updateMatrix();
      arms.setMatrixAt(ai++, dummy.matrix);
    }
  }
  root.add(seats, arms);

  // Little amber step lights in every aisle.
  const aisleX = [...layout.aisles, -(layout.halfSpan + hw) / 2, (layout.halfSpan + hw) / 2];
  const stepGeo = new THREE.BoxGeometry(0.5, 0.012, 0.035);
  const steps = new THREE.InstancedMesh(stepGeo, mats.amber, aisleX.length * (ROWS.count + 1));
  let k = 0;
  for (let r = 0; r <= ROWS.count; r++) {
    for (const x of aisleX) {
      dummy.position.set(x, rowY(r) + 0.007, rowZ(r) - ROWS.depth / 2 + 0.05);
      dummy.updateMatrix();
      steps.setMatrixAt(k++, dummy.matrix);
    }
  }
  root.add(steps);

  /* ---------- Fibre-optic star ceiling ---------- */

  const starCount = 460;
  const starPos = new Float32Array(starCount * 3);
  const starSeed = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    starPos[i * 3] = (Math.random() * 2 - 1) * (hw - 0.6);
    starPos[i * 3 + 1] = height - 0.02;
    starPos[i * 3 + 2] = 1 + Math.random() * (depth - 2);
    starSeed[i] = Math.random();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('aSeed', new THREE.BufferAttribute(starSeed, 1));
  const starMat = sparkleMaterial({ color: new THREE.Color(1.6, 1.45, 1.2), size: 0.05, opacity: 1, drift: 0 });
  root.add(new THREE.Points(starGeo, starMat));

  /* ---------- Screen, light from the screen, projector beam ---------- */

  const mask = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mats.black);
  const screenMat = new THREE.MeshBasicMaterial({ map: filmTexture, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), screenMat);
  root.add(mask, screen);

  const screenLight = new THREE.RectAreaLight('#ffffff', 4, 1, 1);
  root.add(screenLight);
  root.add(new THREE.HemisphereLight('#3b3550', '#140809', 0.6));
  // Faint warm spill from the back of the room so seat backs aren't pure silhouettes.
  const backFill = new THREE.DirectionalLight('#ff9a70', 0.25);
  backFill.position.set(0, 14, depth + 6);
  root.add(backFill);

  const beamMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aBeam;
      varying vec2 vBeam;
      void main() {
        vBeam = aBeam;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vBeam; // x: across a face, y: from projector (0) to screen (1)
      void main() {
        float across = smoothstep(0.0, 0.45, vBeam.x) * smoothstep(1.0, 0.55, vBeam.x);
        float along = smoothstep(0.0, 0.06, vBeam.y) * mix(1.0, 0.18, vBeam.y);
        float rays = 0.72 + 0.28 * sin(vBeam.x * 37.0 + sin(uTime * 0.4) * 2.0) * sin(vBeam.x * 11.0 - uTime * 0.25);
        gl_FragColor = vec4(uColor, across * along * rays * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const beam = new THREE.Mesh(new THREE.BufferGeometry(), beamMat);
  beam.frustumCulled = false;
  root.add(beam);

  const dustMat = sparkleMaterial({ color: new THREE.Color(1, 1, 1), size: 0.022, opacity: 0, drift: 0.12 });
  const dust = new THREE.Points(new THREE.BufferGeometry(), dustMat);
  dust.frustumCulled = false;
  root.add(dust);

  const screenInfo = { width: SCREEN_MAX.width, height: SCREEN_MAX.width / (16 / 9), centerY: 0 };

  /** Resize the screen (and everything aimed at it) to the film's aspect ratio. */
  function setScreenAspect(aspect) {
    let w = SCREEN_MAX.width;
    let h = w / aspect;
    if (h > SCREEN_MAX.height) {
      h = SCREEN_MAX.height;
      w = h * aspect;
    }
    const cy = SCREEN_MAX.bottom + h / 2;
    Object.assign(screenInfo, { width: w, height: h, centerY: cy });

    screen.scale.set(w, h, 1);
    screen.position.set(0, cy, SCREEN_Z);
    mask.scale.set(w + 0.6, h + 0.6, 1);
    mask.position.set(0, cy, 0.03);

    screenLight.width = w;
    screenLight.height = h;
    screenLight.position.set(0, cy, 0.15);
    screenLight.lookAt(0, cy, 30);

    const corners = [
      new THREE.Vector3(-w / 2, cy - h / 2, SCREEN_Z),
      new THREE.Vector3(w / 2, cy - h / 2, SCREEN_Z),
      new THREE.Vector3(w / 2, cy + h / 2, SCREEN_Z),
      new THREE.Vector3(-w / 2, cy + h / 2, SCREEN_Z),
    ];
    beam.geometry.dispose();
    beam.geometry = beamGeometry(PROJECTOR, corners);
    dust.geometry.dispose();
    dust.geometry = dustGeometry(PROJECTOR, new THREE.Vector3(0, cy, SCREEN_Z), w, h, 1100);
  }
  setScreenAspect(16 / 9);

  function setFilmTexture(texture) {
    screenMat.map = texture;
    screenMat.needsUpdate = true;
  }

  const hue = new THREE.Color();
  const white = new THREE.Color(1, 0.97, 0.92);

  /** reveal: 0 when the film is fullscreen, 1 when you are in your seat. */
  function update({ time, reveal, glow, pixelScale }) {
    const lum = glow.r * 0.2126 + glow.g * 0.7152 + glow.b * 0.0722;
    hue.copy(glow).multiplyScalar(1 / Math.max(glow.r, glow.g, glow.b, 1e-3));

    // The room is lit by the film: brighter scenes throw more light on the seats.
    screenLight.color.copy(white).lerp(hue, 0.75);
    screenLight.intensity = 1 + Math.min(lum, 0.6) * 10;

    beamMat.uniforms.uTime.value = time;
    beamMat.uniforms.uColor.value.copy(white).lerp(hue, 0.55);
    beamMat.uniforms.uOpacity.value = reveal * (0.02 + Math.min(lum, 0.6) * 0.08);

    dustMat.uniforms.uTime.value = time;
    dustMat.uniforms.uColor.value.copy(white).lerp(hue, 0.4).multiplyScalar(1.4);
    dustMat.uniforms.uOpacity.value = reveal * (0.25 + Math.min(lum, 0.6) * 1.2);

    starMat.uniforms.uTime.value = time;
    for (const m of [dustMat, starMat]) m.uniforms.uScale.value = pixelScale;
  }

  return { root, screen: screenInfo, setScreenAspect, setFilmTexture, update };
}

/* ---------- Geometry helpers ---------- */

function seatLayout() {
  const total = BLOCKS.reduce((sum, n) => sum + n * SEAT_PITCH, 0) + AISLE * (BLOCKS.length - 1);
  let x = -total / 2;
  const seats = [];
  const arms = [];
  const aisles = [];
  BLOCKS.forEach((n, bi) => {
    for (let i = 0; i <= n; i++) arms.push(x + i * SEAT_PITCH);
    for (let i = 0; i < n; i++) seats.push(x + (i + 0.5) * SEAT_PITCH);
    x += n * SEAT_PITCH;
    if (bi < BLOCKS.length - 1) {
      aisles.push(x + AISLE / 2);
      x += AISLE;
    }
  });
  return { seats, arms, aisles, halfSpan: total / 2 };
}

/** Cushion + backrest of one seat. Origin is on the floor, seat faces -z. */
function seatFabricGeometry() {
  const cushion = new RoundedBoxGeometry(0.52, 0.13, 0.5, 2, 0.045);
  cushion.translate(0, 0.44, -0.02);
  const back = new RoundedBoxGeometry(0.54, 0.66, 0.13, 2, 0.05);
  back.rotateX(0.16);
  back.translate(0, 0.8, 0.27);
  return mergeGeometries([cushion, back]);
}

/** One armrest with its side panel; placed between every pair of seats. */
function seatArmGeometry() {
  const rest = new RoundedBoxGeometry(0.07, 0.06, 0.54, 2, 0.02);
  rest.translate(0, 0.66, 0.02);
  const side = new RoundedBoxGeometry(0.05, 0.64, 0.46, 2, 0.015);
  side.translate(0, 0.32, 0.05);
  return mergeGeometries([rest, side]);
}

/** A flat plane with vertical folds, like hanging velvet. */
function curtainGeometry(w, h, folds, amp) {
  const g = new THREE.PlaneGeometry(w, h, Math.max(32, Math.round(folds * 14)), 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / w;
    p.setZ(i, Math.sin(u * folds * Math.PI * 2) * amp + Math.sin(u * folds * 5.1 + 1.7) * amp * 0.25);
  }
  g.computeVertexNormals();
  return g;
}

/** Open pyramid from the projector to the four corners of the screen. */
function beamGeometry(apex, corners, along = 28, across = 10) {
  const positions = [];
  const coords = [];
  const index = [];
  const edge = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let f = 0; f < 4; f++) {
    const a = corners[f];
    const b = corners[(f + 1) % 4];
    const base = positions.length / 3;
    for (let i = 0; i <= along; i++) {
      const t = i / along;
      for (let j = 0; j <= across; j++) {
        const s = j / across;
        edge.lerpVectors(a, b, s);
        p.lerpVectors(apex, edge, t);
        positions.push(p.x, p.y, p.z);
        coords.push(s, t);
      }
    }
    for (let i = 0; i < along; i++) {
      for (let j = 0; j < across; j++) {
        const q = base + i * (across + 1) + j;
        index.push(q, q + across + 1, q + 1, q + 1, q + across + 1, q + across + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aBeam', new THREE.Float32BufferAttribute(coords, 2));
  g.setIndex(index);
  return g;
}

/** Dust motes scattered inside the projector beam. */
function dustGeometry(apex, center, w, h, count) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const target = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const t = 0.06 + Math.pow(Math.random(), 0.85) * 0.86;
    target.set(center.x + (Math.random() * 2 - 1) * 0.92 * (w / 2), center.y + (Math.random() * 2 - 1) * 0.92 * (h / 2), center.z);
    p.lerpVectors(apex, target, t);
    pos.set([p.x, p.y, p.z], i * 3);
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  return g;
}

/** Soft, twinkling additive points (dust motes, ceiling stars). Size is in metres. */
function sparkleMaterial({ color, size, opacity, drift }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uOpacity: { value: opacity },
      uSize: { value: size },
      uScale: { value: 800 },
      uDrift: { value: drift },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uSize, uScale, uDrift, uTime;
      varying float vTwinkle;
      void main() {
        vec3 p = position + uDrift * vec3(
          sin(uTime * 0.13 + aSeed * 12.9),
          sin(uTime * 0.09 + aSeed * 7.3),
          cos(uTime * 0.11 + aSeed * 4.1));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(1.0, uSize * (0.6 + fract(aSeed * 17.0) * 0.8) * uScale / -mv.z);
        vTwinkle = 0.55 + 0.45 * sin(uTime * (0.6 + fract(aSeed * 31.0) * 1.6) + aSeed * 40.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vTwinkle;
      void main() {
        float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(uColor, a * a * vTwinkle * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function makeExitTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 92;
  const g = c.getContext('2d');
  g.fillStyle = '#06321a';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#5dffa0';
  g.lineWidth = 4;
  g.strokeRect(6, 6, c.width - 12, c.height - 12);
  g.fillStyle = '#7dffb4';
  g.font = 'bold 54px ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('EXIT', c.width / 2, c.height / 2 + 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
