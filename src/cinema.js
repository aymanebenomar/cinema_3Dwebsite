import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

/*
 * The cinema. Units are metres.
 *
 * The screen hangs on the front wall (z = 0) facing +z. Every row is an arc around FOCUS, a point
 * behind the screen, so the seating wraps around the screen in a "C" — an amphitheatre. The stepped
 * floor follows the same arcs, and a curved balcony closes the back of the room; you end up standing
 * at its rail, looking down over every seat.
 */
export const ROOM = { halfWidth: 14.5, depth: 36, height: 17 };
export const SCREEN = { width: 22, height: 10, bottom: 2, z: 0.06 };
SCREEN.centerY = SCREEN.bottom + SCREEN.height / 2;
SCREEN.aspect = SCREEN.width / SCREEN.height;

const FOCUS = { x: 0, z: -6 }; // centre of the row arcs
const ROWS = { count: 14, firstRadius: 13.6, depth: 1.15, rise: 0.4 };
const SEAT_PITCH = 0.6;
const AISLE = 1.3; // width of the two radial aisles
const AISLE_ANGLE = 0.29; // radians either side of centre where the radial aisles run
const SIDE_AISLE = 1.6; // walkway kept clear along each side wall
const SEAT_MIN_Z = 5.4; // the ends of the front rows stop short of the stage
const STAGE = { halfWidth: ROOM.halfWidth - SIDE_AISLE, depth: 2.4, height: 0.8 };
const BALCONY = { radius: 34.5, floor: 9.8, railHeight: 0.95 };

const rowRadius = (i) => ROWS.firstRadius + i * ROWS.depth;
const rowHeight = (i) => i * ROWS.rise;
const polarX = (r, a) => FOCUS.x + r * Math.sin(a);
const polarZ = (r, a) => FOCUS.z + r * Math.cos(a);

/** Your eyes, leaning over the centre of the balcony rail (so the rail itself never blocks the view). */
export const BALCONY_EYE = new THREE.Vector3(0, BALCONY.floor + 1.5, FOCUS.z + BALCONY.radius + 0.05);
/** What you look at from there: the screen sits just above the middle of the view, every row below it. */
export const BALCONY_LOOK = new THREE.Vector3(0, SCREEN.centerY - 1.2, 0);

/** Angle (from centre) where the seats of an arc of radius r must end. */
function seatEnd(r) {
  const byWall = Math.asin(Math.min(1, (ROOM.halfWidth - SIDE_AISLE) / r));
  const byStage = Math.acos(Math.min(1, (SEAT_MIN_Z - FOCUS.z) / r));
  return Math.min(byWall, byStage);
}

/** Angle where the stepped floor of an arc of radius r ends: at the side wall, or one aisle past the seats. */
function stepEnd(r) {
  return Math.min(Math.asin(Math.min(1, ROOM.halfWidth / r)), seatEnd(r) + SIDE_AISLE / r);
}

export function createCinema(scene, screenMaterial) {
  RectAreaLightUniformsLib.init();

  const hw = ROOM.halfWidth;
  const { depth, height } = ROOM;
  const root = new THREE.Group();
  scene.add(root);

  const mats = {
    wall: new THREE.MeshStandardMaterial({ color: '#0b0608', roughness: 0.95 }),
    panel: new THREE.MeshStandardMaterial({ color: '#130a0d', roughness: 0.92 }),
    front: new THREE.MeshStandardMaterial({ color: '#030203', roughness: 1 }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#060405', roughness: 1 }),
    baffle: new THREE.MeshStandardMaterial({ color: '#0e0a0b', roughness: 0.95 }),
    carpet: new THREE.MeshStandardMaterial({ color: '#150709', roughness: 1 }),
    stage: new THREE.MeshStandardMaterial({ color: '#090506', roughness: 0.8 }),
    fascia: new THREE.MeshStandardMaterial({ color: '#100a0b', roughness: 0.6 }),
    curtain: new THREE.MeshStandardMaterial({ color: '#45060f', roughness: 0.82, side: THREE.DoubleSide }),
    velvet: new THREE.MeshPhysicalMaterial({
      color: '#86101d',
      roughness: 0.8,
      sheen: 1,
      sheenRoughness: 0.42,
      sheenColor: new THREE.Color('#ff6d7f'),
    }),
    frame: new THREE.MeshStandardMaterial({ color: '#141114', roughness: 0.42, metalness: 0.2 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b4893f', roughness: 0.3, metalness: 0.55 }),
    door: new THREE.MeshStandardMaterial({ color: '#150e0f', roughness: 0.7 }),
    black: new THREE.MeshBasicMaterial({ color: '#000000' }),
    amber: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.9, 0.38) }),
    sconce: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.62, 0.28) }),
  };

  const add = (mesh, { cast = false, receive = false } = {}) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    root.add(mesh);
    return mesh;
  };

  /* ---------- Room shell ---------- */

  const plane = (w, h, mat, x, y, z, rx = 0, ry = 0, receive = false) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    return add(m, { receive });
  };
  plane(2 * hw, depth, mats.carpet, 0, 0, depth / 2, -Math.PI / 2, 0, true);
  plane(2 * hw, depth, mats.ceiling, 0, height, depth / 2, Math.PI / 2);
  plane(depth, height, mats.wall, -hw, height / 2, depth / 2, 0, Math.PI / 2);
  plane(depth, height, mats.wall, hw, height / 2, depth / 2, 0, -Math.PI / 2);
  plane(2 * hw, height, mats.wall, 0, height / 2, depth, 0, Math.PI);
  plane(2 * hw, height, mats.front, 0, height / 2, 0);

  // Acoustic baffles across the ceiling.
  const baffleGeo = new THREE.BoxGeometry(2 * hw, 0.7, 1.1);
  for (let z = 5; z < depth; z += 5.2) {
    const b = new THREE.Mesh(baffleGeo, mats.baffle);
    b.position.set(0, height - 0.6, z);
    add(b);
  }

  // Side walls: fabric panels, with small warm sconces in the gaps between them.
  const panelGeo = new THREE.BoxGeometry(0.1, 9, 3.3);
  const sconceGeo = new THREE.BoxGeometry(0.05, 0.42, 0.14);
  for (const s of [-1, 1]) {
    for (let z = 4.6; z < depth - 2; z += 3.6) {
      const p = new THREE.Mesh(panelGeo, mats.panel);
      p.position.set(s * (hw - 0.05), 8, z + 1.8);
      add(p);
      if (z > 4.6 && z < 25) {
        const sconce = new THREE.Mesh(sconceGeo, mats.sconce);
        sconce.position.set(s * (hw - 0.03), 8.6, z);
        add(sconce);
      }
    }
  }

  // Exits beside the stage.
  const exitMat = new THREE.MeshBasicMaterial({ map: makeExitTexture(), color: new THREE.Color(1.3, 1.3, 1.3) });
  for (const s of [-1, 1]) {
    plane(1.4, 2.4, mats.door, s * (hw - 0.02), 1.2, 1.5, 0, -s * Math.PI / 2);
    plane(0.9, 0.32, exitMat, s * (hw - 0.03), 2.85, 1.5, 0, -s * Math.PI / 2);
  }

  // Stage under the screen, with a fine LED edge.
  const stage = new THREE.Mesh(new THREE.BoxGeometry(2 * STAGE.halfWidth, STAGE.height, STAGE.depth), mats.stage);
  stage.position.set(0, STAGE.height / 2, STAGE.depth / 2);
  add(stage, { receive: true });
  const stageEdge = new THREE.Mesh(new THREE.BoxGeometry(2 * STAGE.halfWidth - 0.3, 0.015, 0.02), mats.amber);
  stageEdge.position.set(0, STAGE.height - 0.01, STAGE.depth + 0.01);
  add(stageEdge);

  /* ---------- Curtains ---------- */

  const curtainInner = SCREEN.width / 2 + 0.6;
  const sideCurtainW = hw - curtainInner + 0.05;
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(curtainGeometry(sideCurtainW, 13.4, 6, 0.14), mats.curtain);
    c.position.set(s * (curtainInner + sideCurtainW / 2), 6.7, 0.35);
    add(c);
  }
  const valance = new THREE.Mesh(curtainGeometry(2 * hw, 1.6, 34, 0.07), mats.curtain);
  valance.position.set(0, 13.6, 0.5);
  add(valance);

  /* ---------- Curved stadium floor ---------- */

  const steps = [];
  for (let i = 1; i <= ROWS.count; i++) {
    const inner = rowRadius(i) - ROWS.depth / 2;
    const outer = i === ROWS.count ? BALCONY.radius : rowRadius(i) + ROWS.depth / 2;
    steps.push(arcStepGeometry(inner, outer, rowHeight(i), stepEnd(inner)));
  }
  add(new THREE.Mesh(mergeGeometries(steps), mats.carpet), { cast: true, receive: true });

  /* ---------- Seats ---------- */

  const dummy = new THREE.Object3D();
  const place = (list, r, a, y, offset = 0) => {
    dummy.position.set(polarX(r, a) + Math.cos(a) * offset, y, polarZ(r, a) - Math.sin(a) * offset);
    dummy.rotation.set(0, a, 0);
    dummy.updateMatrix();
    list.push(dummy.matrix.clone());
  };

  const seatMatrices = [];
  const armMatrices = [];
  const rowEndLights = [];
  const stepLights = [];
  for (let i = 0; i < ROWS.count; i++) {
    const r = rowRadius(i);
    const y = rowHeight(i);
    const step = SEAT_PITCH / r;
    const aisleHalf = AISLE / 2 / r;
    const blocks = [];
    const centre = Math.floor((2 * (AISLE_ANGLE - aisleHalf)) / step);
    blocks.push({ from: (-centre * step) / 2, count: centre });
    const sideFrom = AISLE_ANGLE + aisleHalf;
    const side = Math.floor((seatEnd(r) - sideFrom) / step);
    if (side > 0) {
      blocks.push({ from: sideFrom, count: side });
      blocks.push({ from: -sideFrom - side * step, count: side });
    }
    for (const b of blocks) {
      for (let k = 0; k < b.count; k++) place(seatMatrices, r, b.from + (k + 0.5) * step, y);
      for (let k = 0; k <= b.count; k++) place(armMatrices, r, b.from + k * step, y);
      // Little floor lights on the aisle side of every row end.
      place(rowEndLights, r, b.from, y + 0.1, -0.035);
      place(rowEndLights, r, b.from + b.count * step, y + 0.1, 0.035);
    }
  }
  // Step lights on every riser, in the radial aisles and the side aisles.
  for (let i = 1; i <= ROWS.count; i++) {
    const nose = rowRadius(i) - ROWS.depth / 2 + 0.06;
    const side = Math.min(seatEnd(rowRadius(i)) + SIDE_AISLE / 2 / rowRadius(i), stepEnd(nose) - 0.4 / nose);
    for (const a of [AISLE_ANGLE, -AISLE_ANGLE, side, -side]) place(stepLights, nose, a, rowHeight(i) + 0.006);
  }

  const seats = add(instanced(seatGeometry(), mats.velvet, seatMatrices), { cast: true, receive: true });
  // A whisper of variation between seats, like real upholstery.
  const tint = new THREE.Color();
  for (let i = 0; i < seats.count; i++) seats.setColorAt(i, tint.setScalar(0.9 + Math.random() * 0.14));
  add(instanced(armGeometry(), mats.frame, armMatrices), { cast: true, receive: true });
  add(instanced(new THREE.BoxGeometry(0.012, 0.03, 0.09), mats.amber, rowEndLights));
  add(instanced(new THREE.BoxGeometry(0.45, 0.012, 0.035), mats.amber, stepLights));

  /* ---------- Curved balcony ---------- */

  const balcony = new THREE.Mesh(balconyGeometry(hw, depth, BALCONY.radius, BALCONY.floor), mats.fascia);
  add(balcony, { receive: true });
  const edgeArc = Math.asin(Math.min(1, hw / BALCONY.radius));
  const arcCurve = (r, y) =>
    new THREE.CatmullRomCurve3(
      Array.from({ length: 33 }, (_, k) => {
        const a = -edgeArc + (2 * edgeArc * k) / 32;
        return new THREE.Vector3(polarX(r, a), y, polarZ(r, a));
      }),
    );
  add(new THREE.Mesh(new THREE.TubeGeometry(arcCurve(BALCONY.radius - 0.01, BALCONY.floor - 0.14), 96, 0.01, 6), mats.amber));
  const railR = BALCONY.radius + 0.15;
  add(new THREE.Mesh(new THREE.TubeGeometry(arcCurve(railR, BALCONY.floor + BALCONY.railHeight), 96, 0.035, 10), mats.brass));
  const posts = [];
  for (let a = -edgeArc + 0.02; a <= edgeArc - 0.02; a += 2 / railR) place(posts, railR, a, BALCONY.floor + BALCONY.railHeight / 2);
  add(instanced(new THREE.CylinderGeometry(0.018, 0.018, BALCONY.railHeight, 8), mats.brass, posts));

  /* ---------- Screen and light ---------- */

  const { width: W, height: H, centerY: cy } = SCREEN;
  const mask = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.6, H + 0.6), mats.black);
  mask.position.set(0, cy, 0.03);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), screenMaterial);
  screen.position.set(0, cy, SCREEN.z);
  add(mask);
  add(screen);

  // The film lights the room in its own colours.
  const screenLight = new THREE.RectAreaLight('#ffffff', 2, W, H);
  screenLight.position.set(0, cy, 0.15);
  screenLight.lookAt(0, cy, 30);
  root.add(screenLight);
  root.add(new THREE.HemisphereLight('#2b2638', '#0a0405', 0.35));

  // Dimmed house lights from above and behind: they model the seats and cast their shadows.
  const house = new THREE.DirectionalLight('#ffbf9a', 1.1);
  house.position.set(0, 46, 52);
  house.target.position.set(0, 0, 14);
  house.castShadow = true;
  house.shadow.mapSize.set(2048, 2048);
  Object.assign(house.shadow.camera, { left: -17, right: 17, top: 19, bottom: -19, near: 20, far: 110 });
  house.shadow.camera.updateProjectionMatrix();
  house.shadow.bias = -0.0004;
  house.shadow.normalBias = 0.025;
  house.shadow.radius = 3;
  root.add(house, house.target);

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

/* ---------- Geometry ---------- */

function instanced(geometry, material, matrices) {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  return mesh;
}

/**
 * One step of the curved floor: a ring sector from radius `inner` to `outer`, `height` tall,
 * spanning ±`end` radians — top, front (riser) and both end faces.
 */
function arcStepGeometry(inner, outer, height, end, segments = 64) {
  const pos = [];
  const nor = [];
  const quad = (a, b, c, d, n) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let k = 0; k < 6; k++) nor.push(...n);
  };
  const at = (r, a, y) => [polarX(r, a), y, polarZ(r, a)];
  for (let k = 0; k < segments; k++) {
    const a0 = -end + (2 * end * k) / segments;
    const a1 = -end + (2 * end * (k + 1)) / segments;
    const am = (a0 + a1) / 2;
    quad(at(inner, a0, height), at(outer, a0, height), at(outer, a1, height), at(inner, a1, height), [0, 1, 0]);
    quad(at(inner, a0, 0), at(inner, a0, height), at(inner, a1, height), at(inner, a1, 0), [-Math.sin(am), 0, -Math.cos(am)]);
  }
  for (const s of [-1, 1]) {
    const a = s * end;
    const n = [s * Math.cos(a), 0, -s * Math.sin(a)];
    if (s > 0) quad(at(inner, a, height), at(outer, a, height), at(outer, a, 0), at(inner, a, 0), n);
    else quad(at(inner, a, 0), at(outer, a, 0), at(outer, a, height), at(inner, a, height), n);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  return g;
}

/** The balcony seen in plan: everything between its curved front and the back wall, `floor` tall. */
function balconyGeometry(hw, backZ, radius, floor) {
  const shape = new THREE.Shape();
  const edge = Math.asin(Math.min(1, hw / radius));
  // Shape coordinates are (x, -z) so that, after rotating, the extrusion stands up along +y.
  shape.moveTo(-hw, -backZ);
  shape.lineTo(hw, -backZ);
  for (let k = 0; k <= 48; k++) {
    const a = edge - (2 * edge * k) / 48;
    shape.lineTo(polarX(radius, a), -polarZ(radius, a));
  }
  shape.lineTo(-hw, -backZ);
  const g = new THREE.ExtrudeGeometry(shape, { depth: floor, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * A side profile (x = forward toward the screen, y = up) turned into a solid of the given width with
 * softly rounded edges. The result faces -z, centred on x = 0.
 */
function profileSolid(shape, width, bevel = 0.018, curveSegments = 5) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 2,
    curveSegments,
  });
  g.rotateY(Math.PI / 2); // profile x → world -z, extrusion → world +x
  g.translate(-(width - 2 * bevel) / 2, 0, 0);
  return g.index ? g.toNonIndexed() : g;
}

function roundedProfile(x0, y0, x1, y1, r) {
  const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
  const s = new THREE.Shape();
  s.moveTo(x0 + bl, y0);
  s.lineTo(x1 - br, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + br);
  s.lineTo(x1, y1 - tr);
  s.quadraticCurveTo(x1, y1, x1 - tr, y1);
  s.lineTo(x0 + tl, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - tl);
  s.lineTo(x0, y0 + bl);
  s.quadraticCurveTo(x0, y0, x0 + bl, y0);
  return s;
}

/** A backrest cushion: flat at the back, the front bulging gently at the lumbar. */
function padProfile(h, tBottom, tTop, bulge, r) {
  const s = new THREE.Shape();
  s.moveTo(0, r);
  s.lineTo(0, h - r);
  s.quadraticCurveTo(0, h, r, h);
  s.lineTo(tTop - r, h);
  s.quadraticCurveTo(tTop, h, tTop, h - r);
  s.quadraticCurveTo(tTop + bulge, h * 0.45, tBottom, r);
  s.quadraticCurveTo(tBottom, 0, tBottom - r, 0);
  s.lineTo(r, 0);
  s.quadraticCurveTo(0, 0, 0, r);
  return s;
}

/** Upholstered parts of one seat: cushion with a rolled front, and a two-part reclined backrest. */
function seatGeometry() {
  const cushion = profileSolid(roundedProfile(-0.22, 0.33, 0.28, 0.465, [0.03, 0.065, 0.03, 0.025]), 0.5, 0.02);
  cushion.rotateX(-0.04);

  const lower = profileSolid(padProfile(0.36, 0.15, 0.12, 0.035, 0.03), 0.52, 0.022);
  const upper = profileSolid(padProfile(0.27, 0.12, 0.1, 0.012, 0.045), 0.5, 0.022);
  upper.translate(0, 0.375, 0.005);
  const back = mergeGeometries([lower, upper]);
  back.rotateX(0.24); // recline
  back.translate(0, 0.46, 0.36);

  return mergeGeometries([cushion, back]);
}

/** Side standard, padded armrest and cup holder; one between every two seats. */
function armGeometry() {
  const standard = profileSolid(roundedProfile(-0.2, 0, 0.24, 0.62, [0.04, 0.09, 0.01, 0.01]), 0.05, 0.01);
  const rest = profileSolid(roundedProfile(-0.25, 0.615, 0.27, 0.67, 0.022), 0.08, 0.015);
  const ring = new THREE.TorusGeometry(0.042, 0.009, 6, 18).toNonIndexed();
  ring.rotateX(Math.PI / 2);
  ring.translate(0, 0.668, -0.33);
  const cup = new THREE.CylinderGeometry(0.042, 0.034, 0.09, 18, 1, true).toNonIndexed();
  cup.translate(0, 0.623, -0.33);
  return mergeGeometries([standard, rest, ring, cup]);
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
