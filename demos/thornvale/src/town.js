// Thornvale layout: walls, towers and gate around an elliptical hill-top
// plateau; an upper terrace with church and keep behind an arcaded retaining
// wall; a market square; houses along cobbled streets; forest outside.
import * as THREE from '../../_shared/three-r187/build/three.webgpu.js';
import { Batch, leafMaterial } from './kit.js';
import { TOWN, WORLD, townR, townHeight, distToPolyline, ROAD, fbm } from './terrain.js';

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _q = new THREE.Quaternion();
const _y = new THREE.Vector3(0, 1, 0);
const M4 = (x, y, z, yaw = 0, s = 1, sy = s) => {
  _q.setFromAxisAngle(_y, yaw);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(s, sy, s));
};
// yaw that turns local +z (a building's front) to face direction (dx, dz)
const faceYaw = (dx, dz) => Math.atan2(dx, dz);

export const SQUARE = { x: 0, z: 22, w: 46, d: 30 };
export const CHURCH_SQ = { x: -32, z: -30, w: 30, d: 12 };
export const GATE_ANGLE = Math.PI / 2; // south, +z

export function buildTown(scene, kitData, ground, opts = {}) {
  const { kit, foot, tex } = kitData;
  const rand = mulberry32(opts.seed ?? 11);
  const R = (a, b) => a + (b - a) * rand();
  const H = ground.sample;

  const placements = new Map();
  const place = (name, m, values = {}) => {
    if (!kit.has(name)) throw new Error('missing kit item ' + name);
    if (!placements.has(name)) placements.set(name, []);
    placements.get(name).push({ m, values });
  };
  const obbs = []; // {x, z, hw, hd, yaw}
  const circles = []; // {x, z, r}
  const lights = [];
  const addObb = (x, z, hw, hd, yaw) => obbs.push({ x, z, hw, hd, yaw, c: Math.cos(yaw), s: Math.sin(yaw) });
  const overlaps = (x, z, hw, hd, yaw, margin = 0.2) => {
    // separating-axis test between oriented rectangles (2D)
    const A = { x, z, hw: hw + margin, hd: hd + margin, c: Math.cos(yaw), s: Math.sin(yaw) };
    const axes = (o) => [[o.c, -o.s], [o.s, o.c]];
    const proj = (o, ax) => Math.abs(o.hw * (o.c * ax[0] - o.s * ax[1])) + Math.abs(o.hd * (o.s * ax[0] + o.c * ax[1]));
    for (const B of obbs) {
      const dx = B.x - A.x;
      const dz = B.z - A.z;
      if (dx * dx + dz * dz > (A.hw + A.hd + B.hw + B.hd) ** 2) continue;
      let sep = false;
      for (const ax of [...axes(A), ...axes(B)]) {
        if (Math.abs(dx * ax[0] + dz * ax[1]) > proj(A, ax) + proj(B, ax)) {
          sep = true;
          break;
        }
      }
      if (!sep) return true;
    }
    for (const C of circles) if (Math.hypot(C.x - x, C.z - z) < C.r + Math.max(hw, hd)) return true;
    return false;
  };

  // ------------------------------------------------------------------ walls, towers, gate
  const ell = (t) => [Math.cos(t) * TOWN.rx, Math.sin(t) * TOWN.rz];
  const perim = [];
  const N = 2000;
  let acc = 0;
  let prev = ell(0);
  for (let i = 1; i <= N; i++) {
    const p = ell((i / N) * Math.PI * 2);
    acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    perim.push({ t: (i / N) * Math.PI * 2, s: acc });
    prev = p;
  }
  const L = acc;
  const tAt = (s) => {
    const k = perim.findIndex((q) => q.s >= s);
    return perim[Math.max(0, k)].t;
  };
  const towerCount = 14;
  const towerT = [];
  for (let k = 0; k < towerCount; k++) towerT.push(tAt(((k + 0.5) / towerCount) * L));
  const gateGap = (t) => Math.abs(((t - GATE_ANGLE + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.075;
  const nearTower = (t) => towerT.some((tt) => Math.abs(((t - tt + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.034);
  const segs = Math.round(L / 4);
  for (let k = 0; k < segs; k++) {
    const t = tAt(((k + 0.5) / segs) * L);
    if (gateGap(t) || nearTower(t)) continue;
    const [x, z] = ell(t);
    const tangent = [-Math.sin(t) * TOWN.rx, Math.cos(t) * TOWN.rz];
    const n = [Math.cos(t) / TOWN.rx, Math.sin(t) / TOWN.rz];
    const nl = Math.hypot(n[0], n[1]);
    const yaw = faceYaw(n[0] / nl, n[1] / nl); // outer face outward
    const base = townHeight(x * 0.97, z * 0.97) - 4;
    // the wall module is 4 m along local x; centre it on the curve
    const m = M4(x, base, z, yaw).multiply(new THREE.Matrix4().makeTranslation(-2.1, 0, 0)).multiply(new THREE.Matrix4().makeScale(1.05, 1, 1));
    place('wall_seg', m);
  }
  towerT.forEach((t, k) => {
    if (gateGap(t)) return;
    const [x, z] = ell(t);
    const base = townHeight(x * 0.97, z * 0.97) - 4;
    place(k % 3 === 1 ? 'tower_round_roof' : 'tower_round', M4(x, base, z, t));
    circles.push({ x, z, r: 4.1 });
  });
  const [gx, gz] = ell(GATE_ANGLE);
  place('gatehouse', M4(gx, TOWN.base - 0.5, gz, 0)); // passage floor just under the street
  addObb(gx - 4.6, gz, 4.3, 5.5, 0);
  addObb(gx + 4.6, gz, 4.3, 5.5, 0);

  // ------------------------------------------------------------------ terrace: arcade wall, stair, church, keep
  const tz = TOWN.terraceZ;
  const xEdge = TOWN.rx * Math.sqrt(1 - (tz / TOWN.rz) ** 2) - 3;
  for (let x = -xEdge; x < xEdge - 6; x += 6) {
    if (x + 6 > -5 && x < 5) continue;
    place('arcade_wall', M4(x + 0, TOWN.base, tz, 0));
    addObb(x + 3, tz - 1.5, 3, 1.6, 0);
  }
  // the grand stair is built in main.js from boxes; it needs a gap in the colliders only

  place('church', M4(CHURCH_SQ.x, TOWN.base + TOWN.terraceRise, -56, 0));
  addObb(CHURCH_SQ.x, -58, 12.5, 20, 0);
  place('keep', M4(50, TOWN.base + TOWN.terraceRise, -52, 0.15));
  addObb(50, -52, 5.2, 5.2, 0.15);

  // ------------------------------------------------------------------ market square
  place('prop_fountain', M4(SQUARE.x, TOWN.base, SQUARE.z, 0));
  circles.push({ x: SQUARE.x, z: SQUARE.z, r: 4.6 });
  const stalls = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const x = SQUARE.x + Math.cos(a) * 13;
    const z = SQUARE.z + Math.sin(a) * 9;
    const yaw = faceYaw(SQUARE.x - x, SQUARE.z - z) + Math.PI;
    place(k % 2 ? 'stall_orange' : 'stall_blue', M4(x, TOWN.base, z, yaw));
    addObb(x, z, 1.8, 1.4, yaw);
    stalls.push([x, z]);
    // under the awning (2.2-2.6 m), above the counter, so it lights the produce rather than the fabric
    lights.push({ x, y: TOWN.base + 1.7, z, color: 0xffb070, i: 4, d: 9 });
  }
  for (const [x, z] of [[-17, 12], [17, 12], [-17, 32], [17, 32]]) {
    place('prop_planter', M4(SQUARE.x + x, TOWN.base, z, 0));
    addObb(SQUARE.x + x, z, 1.1, 0.7, 0);
    place('prop_bench', M4(SQUARE.x + x + (x < 0 ? 2.5 : -2.5), TOWN.base, z, x < 0 ? Math.PI / 2 : -Math.PI / 2));
  }
  place('prop_well', M4(SQUARE.x + 20, TOWN.base, SQUARE.z - 11, 0.3));
  circles.push({ x: SQUARE.x + 20, z: SQUARE.z - 11, r: 1.3 });
  for (const x of [-6, 6]) place('prop_banner_pole', M4(x, TOWN.base, SQUARE.z + 17, 0));

  // ------------------------------------------------------------------ streets and houses
  const ringPts = [];
  for (let k = 0; k <= 40; k++) {
    const t = 0.05 * Math.PI + (k / 40) * 0.9 * Math.PI; // the southern arc of the lower town
    ringPts.push([Math.cos(t) * TOWN.rx * 0.78, Math.sin(t) * TOWN.rz * 0.78]);
  }
  const streets = [
    { pts: [[0, TOWN.rz - 4], [0, SQUARE.z + SQUARE.d / 2]], w: 7 },
    { pts: [[-90, 8], [-50, 10], [-SQUARE.w / 2, SQUARE.z]], w: 6 },
    { pts: [[SQUARE.w / 2, SQUARE.z], [50, 8], [92, 4]], w: 6 },
    { pts: ringPts, w: 5 },
    { pts: [[-14, SQUARE.z - SQUARE.d / 2], [-30, -6], [-70, -12]], w: 5 },
    { pts: [[14, SQUARE.z - SQUARE.d / 2], [30, -6], [70, -12]], w: 5 },
    { pts: [[0, SQUARE.z - SQUARE.d / 2], [0, tz + 10]], w: 8 },
    // terrace lanes
    { pts: [[-95, tz - 10], [-55, tz - 12], [0, tz - 9], [30, tz - 10], [90, tz - 12]], w: 5 },
    { pts: [[18, tz - 10], [22, -70]], w: 4 },
  ];
  const squares = [SQUARE, CHURCH_SQ, { x: 0, z: tz - 4, w: 14, d: 8 }];
  const houseNames = [...kit.keys()].filter((n) => n.startsWith('house_'));
  const houses = [];
  const inSquare = (x, z, pad) => squares.some((q) => Math.abs(x - q.x) < q.w / 2 + pad && Math.abs(z - q.z) < q.d / 2 + pad);
  const tryHouse = (name, x, z, yaw) => {
    const f = foot[name];
    const hw = f.w / 2;
    const hd = f.d / 2;
    // footprint corners must stay well inside the walls and off the terrace edge
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const [a, b] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) {
      const px = x + a * c + b * s;
      const pz = z - a * s + b * c;
      if (townR(px, pz) > 0.9) return false;
      if (Math.abs(pz - tz) < 3.5 || (pz < tz) !== (z < tz)) return false;
      if (inSquare(px, pz, 1.0)) return false;
      if (Math.abs(px) < 6 && pz > tz && pz < tz + 12) return false; // stair approach
    }
    if (overlaps(x, z, hw, hd, yaw, 0.05)) return false;
    const y = townHeight(x, z);
    place(name, M4(x, y, z, yaw));
    addObb(x, z, hw, hd, yaw);
    houses.push({ name, x, z, y, yaw });
    // lantern beside the door
    const door = f.door;
    const lx = x + (door[0] + 0.95) * c + (door[2] + 0.3) * s;
    const lz = z - (door[0] + 0.95) * s + (door[2] + 0.3) * c;
    lights.push({ x: lx, y: y + 2.4, z: lz, color: 0xffa050, i: 4, d: 8 });
    return true;
  };
  for (const st of streets) {
    for (let i = 0; i < st.pts.length - 1; i++) {
      const [ax, az] = st.pts[i];
      const [bx, bz] = st.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dir = [(bx - ax) / len, (bz - az) / len];
      const nrm = [-dir[1], dir[0]];
      for (const side of [-1, 1]) {
        let s = R(0, 2);
        while (s < len) {
          const name = houseNames[Math.floor(rand() * houseNames.length)];
          const f = foot[name];
          const off = st.w / 2 + f.d / 2 + 0.6;
          const px = ax + dir[0] * (s + f.w / 2) + nrm[0] * side * off;
          const pz = az + dir[1] * (s + f.w / 2) + nrm[1] * side * off;
          const yaw = faceYaw(-nrm[0] * side, -nrm[1] * side);
          const ok = tryHouse(name, px, pz, yaw);
          s += ok ? f.w + (rand() < 0.2 ? R(1.5, 3) : 0.15) : 2.0;
        }
      }
    }
  }
  // fill the gaps further back from the streets
  for (let k = 0; k < 900; k++) {
    const t = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 0.86;
    const x = Math.cos(t) * TOWN.rx * r;
    const z = Math.sin(t) * TOWN.rz * r;
    const dStreet = Math.min(...streets.map((s) => distToPolyline(x, z, s.pts)));
    if (dStreet < 5) continue;
    let best = null;
    for (const s of streets) {
      const d = distToPolyline(x, z, s.pts);
      if (!best || d < best.d) best = { d, s };
    }
    // face the nearest street
    const pts = best.s.pts;
    let nx = 0;
    let nz = 0;
    let bd = 1e9;
    for (let i = 0; i < pts.length - 1; i++) {
      for (let u = 0; u <= 1; u += 0.05) {
        const qx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u;
        const qz = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u;
        const d = Math.hypot(qx - x, qz - z);
        if (d < bd) {
          bd = d;
          nx = qx - x;
          nz = qz - z;
        }
      }
    }
    const name = houseNames[Math.floor(rand() * houseNames.length)];
    tryHouse(name, x, z, faceYaw(nx, nz) + R(-0.15, 0.15));
  }

  // lamp posts along the main streets
  for (const st of streets.slice(0, 4)) {
    for (let i = 0; i < st.pts.length - 1; i++) {
      const [ax, az] = st.pts[i];
      const [bx, bz] = st.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 6; s < len; s += 16) {
        const u = s / len;
        const nrm = [-(bz - az) / len, (bx - ax) / len];
        const x = ax + (bx - ax) * u + nrm[0] * (st.w / 2 - 0.3);
        const z = az + (bz - az) * u + nrm[1] * (st.w / 2 - 0.3);
        if (overlaps(x, z, 0.3, 0.3, 0, 0)) continue;
        place('prop_lamppost', M4(x, townHeight(x, z), z, faceYaw(-nrm[0], -nrm[1])));
        circles.push({ x, z, r: 0.25 });
        lights.push({ x: x - nrm[0] * 0.45, y: townHeight(x, z) + 3.0, z: z - nrm[1] * 0.45, color: 0xffb060, i: 9, d: 14 });
      }
    }
  }
  // clutter by the houses
  for (const h of houses) {
    if (rand() > 0.35) continue;
    const f = foot[h.name];
    const side = rand() < 0.5 ? -1 : 1;
    const c = Math.cos(h.yaw);
    const s = Math.sin(h.yaw);
    const a = side * (f.w / 2 + 0.8);
    const b = f.d / 2 - 1.2;
    const x = h.x + a * c + b * s;
    const z = h.z - a * s + b * c;
    const what = ['prop_barrels', 'prop_crates', 'prop_cart', 'prop_hay'][Math.floor(rand() * 4)];
    if (overlaps(x, z, 1.0, 1.0, h.yaw, 0)) continue;
    place(what, M4(x, townHeight(x, z), z, h.yaw + R(-0.3, 0.3)));
    addObb(x, z, 0.9, 0.9, h.yaw);
  }

  // ------------------------------------------------------------------ trees
  const trees = { tree_oak_0: [], tree_oak_1: [], tree_oak_2: [], tree_cypress: [], tree_pine_0: [], tree_pine_1: [], bush_0: [], tree_far_pine: [], tree_far_oak: [] };
  const plantTree = (name, x, z, s, cell = 0) => {
    trees[name].push({ m: M4(x, H(x, z) - 0.2, z, rand() * Math.PI * 2, s), cell });
    circles.push({ x, z, r: 0.5 * s });
  };
  // inside the walls: cypresses and garden trees in the leftover space
  for (let k = 0; k < 500; k++) {
    const t = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 0.9;
    const x = Math.cos(t) * TOWN.rx * r;
    const z = Math.sin(t) * TOWN.rz * r;
    if (Math.abs(z - tz) < 4 || inSquare(x, z, 0.5)) continue;
    if (Math.min(...streets.map((s) => distToPolyline(x, z, s.pts))) < 4) continue;
    if (overlaps(x, z, 1.4, 1.4, 0, 0.3)) continue;
    const pick = rand();
    if (pick < 0.45) plantTree('tree_cypress', x, z, R(0.8, 1.15));
    else if (pick < 0.8) plantTree('bush_0', x, z, R(0.8, 1.4), Math.floor(rand() * 3));
    else plantTree(['tree_oak_0', 'tree_oak_1', 'tree_oak_2'][Math.floor(rand() * 3)], x, z, R(0.6, 0.85), Math.floor(rand() * 3));
  }
  // cypress avenue along the stair approach and church square
  for (let z = tz + 2; z < tz + 11; z += 3) for (const x of [-6, 6]) plantTree('tree_cypress', x, z, 1.0);
  for (let x = CHURCH_SQ.x - 13; x <= CHURCH_SQ.x + 13; x += 6.5) plantTree('tree_cypress', x, CHURCH_SQ.z + 7, 1.1);
  // outside: forest, meadows, autumn colour
  let planted = 0;
  for (let k = 0; k < 12000 && planted < 1600; k++) {
    const x = R(-260, 260);
    const z = R(-260, 260);
    const r = townR(x, z);
    if (r < 1.3) continue;
    if (distToPolyline(x, z, ROAD) < 9) continue;
    const dens = fbm(x * 0.008 + 7, z * 0.008 - 2);
    const far = Math.hypot(x, z);
    if (dens < 0.42 + (far < 250 ? 0.12 : 0)) continue;
    const y = H(x, z);
    const slope = Math.abs(H(x + 2, z) - H(x - 2, z)) + Math.abs(H(x, z + 2) - H(x, z - 2));
    if (slope > 6) continue;
    const pinesP = 0.3 + Math.min(0.6, (far - 150) / 600) + (y > 40 ? 0.2 : 0);
    if (rand() < pinesP) plantTree(rand() < 0.5 ? 'tree_pine_0' : 'tree_pine_1', x, z, R(0.8, 1.3));
    else {
      const cell = rand() < 0.45 ? 0 : rand() < 0.6 ? 1 : 2;
      plantTree(['tree_oak_0', 'tree_oak_1', 'tree_oak_2'][Math.floor(rand() * 3)], x, z, R(0.9, 1.35), cell);
    }
    planted++;
  }
  // the far forest: thousands of cheap trees in dense stands on the hills
  let farCount = 0;
  for (let k = 0; k < 60000 && farCount < (opts.lite ? 0 : 9000); k++) {
    const x = R(-WORLD / 2 + 10, WORLD / 2 - 10);
    const z = R(-WORLD / 2 + 10, WORLD / 2 - 10);
    const far = Math.hypot(x, z);
    if (far < 230 || townR(x, z) < 1.6) continue;
    if (distToPolyline(x, z, ROAD) < 10) continue;
    const dens = fbm(x * 0.006 + 7, z * 0.006 - 2);
    if (dens < 0.4) continue;
    const slope = Math.abs(H(x + 3, z) - H(x - 3, z)) + Math.abs(H(x, z + 3) - H(x, z - 3));
    if (slope > 9) continue;
    const s = R(0.8, 1.4);
    const pine = rand() < 0.45 + Math.min(0.45, (far - 230) / 700);
    const name = pine ? 'tree_far_pine' : 'tree_far_oak';
    trees[name].push({ m: M4(x, H(x, z) - 0.3, z, rand() * 6.28, s), cell: rand() < 0.4 ? 0 : rand() < 0.6 ? 1 : 2 });
    farCount++;
  }
  // cypress pairs along the road
  for (let i = 0; i < ROAD.length - 1; i++) {
    const [ax, az] = ROAD[i];
    const [bx, bz] = ROAD[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    for (let s = 8; s < len; s += 22) {
      const u = s / len;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      for (const side of [-1, 1]) {
        const x = ax + (bx - ax) * u + nx * side * 7;
        const z = az + (bz - az) * u + nz * side * 7;
        if (townR(x, z) > 1.15) plantTree('tree_cypress', x, z, R(0.9, 1.2));
      }
    }
  }

  // ------------------------------------------------------------------ batches
  // one leaf material for every tree: each batch carries its own 'cell'
  // attribute (green, orange, gold) on its geometry
  const leafMat = leafMaterial(tex.leaves, 'geometry');
  const materialFor = (p) => (p.matName === 'Leaves' ? leafMat : null);
  let instances = 0;
  for (const [name, list] of placements) {
    const b = new Batch(kit.get(name), list.length, scene);
    for (const p of list) b.add(p.m, p.values);
    b.commit();
    instances += list.length;
  }
  // the forest in square tiles, so whole tiles drop out of view and out of the
  // shadow cascades together. A near tile holds its detailed trees and a
  // matching set of cheap stand-ins (same place, colour and rough size); past
  // LOD_FAR the stand-ins show instead. Only tiles near the camera cast shadows.
  // Tiles are 100 m near the town and 250 m for the far forest.
  const STAND_IN = { tree_pine_0: ['tree_far_pine', 1.0], tree_pine_1: ['tree_far_pine', 1.29], tree_oak_0: ['tree_far_oak', 1.0], tree_oak_1: ['tree_far_oak', 1.2], tree_oak_2: ['tree_far_oak', 0.85] };
  const tileMap = new Map();
  const _tp = new THREE.Vector3();
  for (const [name, list] of Object.entries(trees)) {
    const farKind = name.startsWith('tree_far');
    const size = farKind ? 250 : 100;
    for (const t of list) {
      _tp.setFromMatrixPosition(t.m);
      const i = Math.floor(_tp.x / size);
      const j = Math.floor(_tp.z / size);
      const key = `${farKind ? 'f' : 'n'}:${i}:${j}`;
      if (!tileMap.has(key)) tileMap.set(key, { x: (i + 0.5) * size, z: (j + 0.5) * size, far: farKind, lists: {} });
      (tileMap.get(key).lists[name] ||= []).push(t);
    }
  }
  const treeBatch = (name, list) => {
    const b = new Batch(kit.get(name), list.length, scene, { attrs: ['cell'], geomAttrs: true, materialFor });
    for (const t of list) b.add(t.m, { cell: t.cell });
    b.commit();
    return b;
  };
  const forest = [];
  for (const tile of tileMap.values()) {
    const near = [];
    const stand = [];
    const always = [];
    const standLists = {};
    for (const [name, list] of Object.entries(tile.lists)) {
      instances += list.length;
      if (!STAND_IN[name]) {
        always.push(treeBatch(name, list));
        continue;
      }
      near.push(treeBatch(name, list));
      const [fname, sc] = STAND_IN[name];
      const sm = new THREE.Matrix4().makeScale(sc, sc, sc);
      (standLists[fname] ||= []).push(...list.map((t) => ({ m: t.m.clone().multiply(sm), cell: t.cell })));
    }
    for (const [fname, list] of Object.entries(standLists)) stand.push(treeBatch(fname, list));
    for (const b of stand) b.setVisible(false);
    forest.push({ x: tile.x, z: tile.z, far: tile.far, near, stand, all: [...near, ...stand, ...always], lod: null, shadow: null });
  }
  const LOD_FAR = 230; // metres from the camera to a tile's centre
  const HYST = 20;
  const updateForest = (cam) => {
    for (const t of forest) {
      const d = Math.hypot(cam.x - t.x, cam.y - TOWN.base, cam.z - t.z);
      const lod = t.lod ? d > LOD_FAR - HYST : d > LOD_FAR + HYST;
      if (lod !== t.lod) {
        t.lod = lod;
        for (const b of t.near) b.setVisible(!lod);
        for (const b of t.stand) b.setVisible(lod);
      }
      // to the far edge of the shadow cascades (420 m); past 230 m these are the cheap stand-ins
      const shadow = d < (t.far ? 320 : 420);
      if (shadow !== t.shadow) {
        t.shadow = shadow;
        for (const b of t.all) b.setShadow(shadow);
      }
    }
  };

  // every placed instance, for rebuilding the level elsewhere (Unreal)
  const layout = [];
  const _p = new THREE.Vector3();
  const _r = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const pushLayout = (name, m) => {
    m.decompose(_p, _r, _s);
    const e = new THREE.Euler().setFromQuaternion(_r, 'YXZ');
    layout.push({ name, p: [+_p.x.toFixed(3), +_p.y.toFixed(3), +_p.z.toFixed(3)], yaw: +e.y.toFixed(4), s: [+_s.x.toFixed(3), +_s.y.toFixed(3), +_s.z.toFixed(3)] });
  };
  for (const [name, list] of placements) for (const p of list) pushLayout(name, p.m);
  for (const [name, list] of Object.entries(trees)) for (const t of list) pushLayout(name, t.m);

  return {
    layout,
    streets,
    squares,
    obbs,
    circles,
    lights,
    houses,
    stalls,
    gate: { x: gx, z: gz },
    updateForest,
    stats: { instances, tiles: forest.length, houses: houses.length, trees: Object.values(trees).reduce((a, l) => a + l.length, 0), lights: lights.length },
  };
}
