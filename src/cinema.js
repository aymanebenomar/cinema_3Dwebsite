import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

/*
 * The cinema. Units are metres.
 * The screen hangs on the front wall (z = 0) facing +z. Stadium seating rises toward the back, and a
 * balcony sits above the last row; you end up standing at its rail, looking down over every seat.
 */
export const ROOM = { halfWidth: 14.5, depth: 32, height: 16 };
export const SCREEN = { width: 22, height: 10, bottom: 2, z: 0.06 };
SCREEN.centerY = SCREEN.bottom + SCREEN.height / 2;
SCREEN.aspect = SCREEN.width / SCREEN.height;

const STALLS = { count: 14, startZ: 7.6, depth: 1.15, rise: 0.4 };
const BALCONY = { frontZ: 24, floor: 7, railHeight: 0.95 };
const SEAT_PITCH = 0.6;
const AISLE = 1.4;
const BLOCKS = [8, 18, 8]; // seats per block, left → right

const rowZ = (r) => STALLS.startZ + r * STALLS.depth;
const rowY = (r) => r * STALLS.rise;

/** Your eyes, at the balcony rail. */
export const BALCONY_EYE = new THREE.Vector3(0, BALCONY.floor + 1.5, BALCONY.frontZ + 0.6);
/** Where you look from there: down across all the seats to the screen. */
export const BALCONY_LOOK = new THREE.Vector3(0, 1.7, 0);

export function createCinema(scene, screenMaterial) {
  RectAreaLightUniformsLib.init();

  const hw = ROOM.halfWidth;
  const { depth, height } = ROOM;
  const root = new THREE.Group();
  scene.add(root);

  const mats = {
    wall: new THREE.MeshStandardMaterial({ color: '#0b0608', roughness: 0.95 }),
    panel: new THREE.MeshStandardMaterial({ color: '#140a0d', roughness: 0.9 }),
    front: new THREE.MeshStandardMaterial({ color: '#030203', roughness: 1 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#050404', roughness: 1 }),
    carpet: new THREE.MeshStandardMaterial({ color: '#100608', roughness: 1 }),
    stage: new THREE.MeshStandardMaterial({ color: '#080506', roughness: 0.8 }),
    fascia: new THREE.MeshStandardMaterial({ color: '#0e0809', roughness: 0.7 }),
    curtain: new THREE.MeshStandardMaterial({ color: '#45060f', roughness: 0.82, side: THREE.DoubleSide }),
    fabric: new THREE.MeshStandardMaterial({ color: '#7c0c19', roughness: 0.74 }),
    frame: new THREE.MeshStandardMaterial({ color: '#0d0b0d', roughness: 0.45, metalness: 0.3 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b4893f', roughness: 0.3, metalness: 0.5 }),
    door: new THREE.MeshStandardMaterial({ color: '#150e0f', roughness: 0.7 }),
    black: new THREE.MeshBasicMaterial({ color: '#000000' }),
    amber: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.9, 0.38) }),
    slit: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.42, 0.18) }),
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

  // Side walls: fabric panels separated by thin vertical light lines.
  const panelGeo = new THREE.BoxGeometry(0.12, 11, 3.6);
  const slitGeo = new THREE.BoxGeometry(0.03, 9, 0.05);
  for (const s of [-1, 1]) {
    for (let z = 5.6; z < depth - 2; z += 4.2) {
      const p = new THREE.Mesh(panelGeo, mats.panel);
      p.position.set(s * (hw - 0.06), 9, z + 2.1);
      root.add(p);
      const slit = new THREE.Mesh(slitGeo, mats.slit);
      slit.position.set(s * (hw - 0.02), 9.2, z);
      root.add(slit);
    }
  }

  // Exit doors at the front.
  const exitMat = new THREE.MeshBasicMaterial({ map: makeExitTexture(), color: new THREE.Color(1.3, 1.3, 1.3) });
  for (const s of [-1, 1]) {
    plane(1.6, 2.6, mats.door, s * (hw - 0.02), 1.3, 4.2, 0, -s * Math.PI / 2);
    plane(0.9, 0.32, exitMat, s * (hw - 0.03), 3.1, 4.2, 0, -s * Math.PI / 2);
  }

  // Stage under the screen, with a fine LED edge.
  const stage = new THREE.Mesh(new THREE.BoxGeometry(2 * hw, 0.8, 2.4), mats.stage);
  stage.position.set(0, 0.4, 1.2);
  root.add(stage);
  const stageEdge = new THREE.Mesh(new THREE.BoxGeometry(2 * hw - 0.4, 0.015, 0.02), mats.amber);
  stageEdge.position.set(0, 0.79, 2.41);
  root.add(stageEdge);

  /* ---------- Curtains ---------- */

  const curtainInner = SCREEN.width / 2 + 0.6;
  const sideCurtainW = hw - curtainInner + 0.05;
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(curtainGeometry(sideCurtainW, 13.4, 6, 0.14), mats.curtain);
    c.position.set(s * (curtainInner + sideCurtainW / 2), 6.7, 0.35);
    root.add(c);
  }
  const valance = new THREE.Mesh(curtainGeometry(2 * hw, 1.6, 34, 0.07), mats.curtain);
  valance.position.set(0, 13.6, 0.5);
  root.add(valance);

  /* ---------- Stadium seating ---------- */

  const layout = seatLayout();
  const aisleX = [...layout.aisles, -(layout.halfSpan + hw) / 2, (layout.halfSpan + hw) / 2];
  const dummy = new THREE.Object3D();
  const matrixAt = (x, y, z) => {
    dummy.position.set(x, y, z);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };

  const seatMatrices = [];
  const armMatrices = [];
  const stepMatrices = [];
  for (let r = 0; r < STALLS.count; r++) {
    for (const x of layout.seats) seatMatrices.push(matrixAt(x, rowY(r), rowZ(r)));
    for (const x of layout.arms) armMatrices.push(matrixAt(x, rowY(r), rowZ(r)));
  }
  for (let r = 0; r <= STALLS.count; r++) {
    for (const x of aisleX) stepMatrices.push(matrixAt(x, rowY(r) + 0.007, rowZ(r) - STALLS.depth / 2 + 0.05));
  }

  const risers = [];
  for (let r = 1; r < STALLS.count; r++) {
    const g = new THREE.BoxGeometry(2 * hw, rowY(r), STALLS.depth);
    g.translate(0, rowY(r) / 2, rowZ(r));
    risers.push(g);
  }
  const platformFront = rowZ(STALLS.count) - STALLS.depth / 2;
  const platformH = rowY(STALLS.count);
  const platform = new THREE.BoxGeometry(2 * hw, platformH, BALCONY.frontZ - platformFront);
  platform.translate(0, platformH / 2, (platformFront + BALCONY.frontZ) / 2);
  risers.push(platform);
  root.add(new THREE.Mesh(mergeGeometries(risers), mats.carpet));

  root.add(instanced(seatFabricGeometry(), mats.fabric, seatMatrices));
  root.add(instanced(seatArmGeometry(), mats.frame, armMatrices));
  root.add(instanced(new THREE.BoxGeometry(0.5, 0.012, 0.035), mats.amber, stepMatrices));

  /* ---------- Balcony ---------- */

  const balconyDepth = depth - BALCONY.frontZ;
  const balcony = new THREE.Mesh(new THREE.BoxGeometry(2 * hw, BALCONY.floor, balconyDepth), mats.fascia);
  balcony.position.set(0, BALCONY.floor / 2, BALCONY.frontZ + balconyDepth / 2);
  root.add(balcony);
  const balconyEdge = new THREE.Mesh(new THREE.BoxGeometry(2 * hw - 0.2, 0.015, 0.02), mats.amber);
  balconyEdge.position.set(0, BALCONY.floor - 0.12, BALCONY.frontZ - 0.01);
  root.add(balconyEdge);

  const railZ = BALCONY.frontZ + 0.15;
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2 * hw, 16), mats.brass);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, BALCONY.floor + BALCONY.railHeight, railZ);
  root.add(rail);
  const posts = [];
  for (let x = -hw + 0.8; x <= hw - 0.8; x += 2.1) posts.push(matrixAt(x, BALCONY.floor + BALCONY.railHeight / 2, railZ));
  root.add(instanced(new THREE.CylinderGeometry(0.018, 0.018, BALCONY.railHeight, 8), mats.brass, posts));

  /* ---------- Screen and its light ---------- */

  const { width: W, height: H, centerY: cy } = SCREEN;
  const mask = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.6, H + 0.6), mats.black);
  mask.position.set(0, cy, 0.03);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), screenMaterial);
  screen.position.set(0, cy, SCREEN.z);
  root.add(mask, screen);

  // The film lights the room in its own colours.
  const screenLight = new THREE.RectAreaLight('#ffffff', 2, W, H);
  screenLight.position.set(0, cy, 0.15);
  screenLight.lookAt(0, cy, 30);
  root.add(screenLight);
  root.add(new THREE.HemisphereLight('#2b2638', '#0a0405', 0.35));
  // Soft house light from behind, so the rows read from the balcony.
  const houseLight = new THREE.DirectionalLight('#ffb48c', 0.75);
  houseLight.position.set(0, 22, depth + 10);
  root.add(houseLight);

  const hue = new THREE.Color();
  const white = new THREE.Color(1, 0.97, 0.94);

  function update({ glow }) {
    const lum = glow.r * 0.2126 + glow.g * 0.7152 + glow.b * 0.0722;
    hue.copy(glow).multiplyScalar(1 / Math.max(glow.r, glow.g, glow.b, 1e-3));
    screenLight.color.copy(white).lerp(hue, 0.7);
    screenLight.intensity = 0.8 + Math.min(lum, 0.6) * 9;
  }

  return { root, update };
}

/* ---------- Geometry helpers ---------- */

function instanced(geometry, material, matrices) {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  return mesh;
}

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
  const cushion = new RoundedBoxGeometry(0.5, 0.13, 0.5, 2, 0.045);
  cushion.translate(0, 0.44, -0.02);
  const back = new RoundedBoxGeometry(0.52, 0.66, 0.13, 2, 0.05);
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
