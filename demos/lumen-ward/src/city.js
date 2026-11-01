// District layout: places the Blender kit into a small cyberpunk ward.
// Everything is seeded, so a seed always gives the same city.
import * as THREE from '../vendor/three/build/three.module.min.js';
import { Batch, hologramMaterial, shared } from './kit.js';

export const ROADS = [-64, 0, 64];
export const EDGE = 112;
export const HALF_ROAD = 5; // carriageway half width
export const RAIL_Y = 18.0; // deck top
export const PLAZA = 30.5;
const BLOCK_SPANS = [[-112, -72], [-56, -8], [8, 56], [72, 112]];
const SIDEWALK = 3;

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
function mat(x, y, z, rotY = 0, sx = 1, sy = sx, sz = sx) {
  _q.setFromAxisAngle(_y, rotY);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}
// rotation that turns local +z to face (nx, nz)
const faceZ = (nx, nz) => Math.atan2(nx, nz);
// rotation that turns local +x to point along (dx, dz)
const alongX = (dx, dz) => Math.atan2(-dz, dx);

const nearRoad = (v, pad) => ROADS.some((c) => Math.abs(v - c) < pad);
const inPlaza = (x, z, pad = 0) => Math.abs(x) < PLAZA + pad && Math.abs(z) < PLAZA + pad;

export function buildCity(scene, kitData, opts = {}) {
  const { kit, signMaterials } = kitData;
  const rand = mulberry32(opts.seed ?? 7);
  const R = (a, b) => a + (b - a) * rand();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const placements = new Map();
  const place = (name, m, tile = 0) => {
    if (!kit.has(name)) throw new Error('kit item missing: ' + name);
    if (!placements.has(name)) placements.set(name, []);
    placements.get(name).push({ m, tile });
  };
  const colliders = [];
  const addBox = (cx, cz, hx, hz) => colliders.push({ x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz });
  const sidewalks = [];
  const steam = [];
  const lights = [];

  // Roof height of a tower template: top of its facade geometry.
  for (const t of kit.values()) {
    if (!t.name.startsWith('tower_')) continue;
    let roof = 0;
    const v = new THREE.Vector3();
    for (const p of t.parts) {
      if (p.matName !== 'Facade' && p.matName !== 'FacadeGlass') continue;
      const pos = p.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) roof = Math.max(roof, v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix).y);
    }
    t.roof = roof;
    t.style = t.name.split('_')[1];
    t.fw = t.foot.max.x - t.foot.min.x;
    t.fd = t.foot.max.z - t.foot.min.z;
  }
  const towers = [...kit.values()].filter((t) => t.name.startsWith('tower_'));

  // ---------------------------------------------------------------- lots
  const lots = [];
  for (let bx = 0; bx < 4; bx++) {
    for (let bz = 0; bz < 4; bz++) {
      const [x0, x1] = BLOCK_SPANS[bx];
      const [z0, z1] = BLOCK_SPANS[bz];
      sidewalks.push({ x0: x0 - SIDEWALK, x1: x1 + SIDEWALK, z0: z0 - SIDEWALK, z1: z1 + SIDEWALK });
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      const xs = [[x0, mx - 1.5], [mx + 1.5, x1]];
      const zs = [[z0, mz - 1.5], [mz + 1.5, z1]];
      for (const [lx0, lx1] of xs) {
        for (const [lz0, lz1] of zs) {
          const lot = { x0: lx0, x1: lx1, z0: lz0, z1: lz1, cx: (lx0 + lx1) / 2, cz: (lz0 + lz1) / 2, w: lx1 - lx0, d: lz1 - lz0 };
          if (Math.abs(lot.cx) < 25 && Math.abs(lot.cz) < 25) continue; // plaza
          // which sides face a street (not an alley)
          lot.streets = [];
          if (lx0 === x0) lot.streets.push([-1, 0]);
          if (lx1 === x1) lot.streets.push([1, 0]);
          if (lz0 === z0) lot.streets.push([0, -1]);
          if (lz1 === z1) lot.streets.push([0, 1]);
          lot.nearPlaza = Math.abs(lot.cx) < 50 && Math.abs(lot.cz) < 50;
          lot.alleys = { x: mx, z: mz, block: { x0, x1, z0, z1 } };
          lots.push(lot);
        }
      }
    }
  }

  const FORCED = new Map([
    ['19.25,-44.75', 'tower_glass_a'],
    ['-44.75,44.75', 'tower_glass_b'],
    ['44.75,19.25', 'tower_cylinder_a'],
    ['-44.75,-19.25', 'tower_setback_a'],
    ['92.75,-92.75', 'tower_setback_b'],
    ['-19.25,44.75', 'tower_market_a'],
    ['44.75,-19.25', 'tower_market_b'],
    ['-92.75,92.75', 'tower_setback_b'],
  ]);
  const used = new Set(FORCED.values());
  const weights = (t, lot) => {
    if (t.style === 'glass' || t.style === 'cylinder') return 0;
    if (t.style === 'market') return lot.nearPlaza ? 0.5 : 0.15;
    if (t.style === 'setback') return used.has(t.name) ? 0.25 : 0.6;
    if (t.style === 'stack') return 1.4;
    if (t.style === 'slab') return 0.9;
    return 0.8;
  };

  const placedTowers = [];
  for (const lot of lots) {
    const key = `${lot.cx},${lot.cz}`;
    let t;
    let rot = 0;
    let s = 1;
    const fit = (cand) => {
      const opts2 = [];
      for (const r of [0, 1, 2, 3]) {
        const fw = r % 2 ? cand.fd : cand.fw;
        const fd = r % 2 ? cand.fw : cand.fd;
        const sc = Math.min(lot.w / fw, lot.d / fd) * 0.97;
        if (sc >= 0.8) opts2.push({ r, sc: Math.min(sc, 1.14) });
      }
      return opts2;
    };
    if (FORCED.has(key)) {
      t = kit.get(FORCED.get(key));
      const f = fit(t);
      const o = f.length ? f[Math.floor(rand() * f.length)] : { r: 0, sc: 0.8 };
      rot = o.r;
      s = o.sc;
    } else {
      const cands = [];
      for (const c of towers) {
        const w = weights(c, lot);
        if (!w) continue;
        for (const o of fit(c)) cands.push({ c, o, w });
      }
      let tot = cands.reduce((a, b) => a + b.w, 0);
      let k = rand() * tot;
      let ch = cands[0];
      for (const c of cands) {
        k -= c.w;
        if (k <= 0) {
          ch = c;
          break;
        }
      }
      t = ch.c;
      rot = ch.o.r;
      s = ch.o.sc;
    }
    const tallish = t.style === 'stack' || t.style === 'block' || t.style === 'slab';
    let sy = tallish ? s * R(0.85, 1.35) : s;
    if (!lot.nearPlaza && tallish && rand() < 0.3) sy *= 1.3;
    const angle = rot * Math.PI / 2;
    place(t.name, mat(lot.cx, 0.15, lot.cz, angle, s, sy, s));
    const hw = ((rot % 2 ? t.fd : t.fw) * s) / 2;
    const hd = ((rot % 2 ? t.fw : t.fd) * s) / 2;
    addBox(lot.cx, lot.cz, hw, hd);
    placedTowers.push({ lot, t, s, sy, hw, hd, roof: t.roof * sy + 0.15, angle });
  }

  // ---------------------------------------------------------------- signs, billboards, shop props
  let elusionPlaced = false;
  for (const P of placedTowers) {
    const { lot, t, hw, hd, roof } = P;
    const styleOk = t.style !== 'glass' && t.style !== 'cylinder';
    const inset = t.style === 'stack' ? 1.8 : t.style === 'setback' ? 0.9 : 0.75;
    for (const [nx, nz] of lot.streets) {
      const faceLen = nx ? hd * 2 : hw * 2;
      const fx = lot.cx + nx * hw;
      const fz = lot.cz + nz * hd;
      const tx = nz; // tangent along the face
      const tz = nx;
      const rotF = faceZ(nx, nz);
      const facesPlaza = (lot.cx * nx < 0 || lot.cz * nz < 0) && lot.nearPlaza && (Math.abs(lot.cx) < 50 && Math.abs(lot.cz) < 50) && (nx ? Math.abs(lot.cz) < PLAZA : Math.abs(lot.cx) < PLAZA);
      // wide fascia sign over the shops
      if (rand() < 0.75 || facesPlaza) {
        const a = R(-faceLen / 2 + 3.5, faceLen / 2 - 3.5);
        let tile = Math.floor(rand() * 16);
        if (facesPlaza && !elusionPlaced) {
          tile = 0;
          elusionPlaced = true;
        } else if (tile === 0) tile = 10;
        place('sign_wide', mat(fx + tx * a + nx * 0.02, 3.65, fz + tz * a + nz * 0.02, rotF), tile);
      }
      // blade signs up the facade
      if (styleOk) {
        const n = 1 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
          const end = k % 2 ? 1 : -1;
          const a = end * (faceLen / 2 - R(1.6, 4.5));
          const top = Math.min(roof - 6, 34);
          if (top < 7) break;
          const y = R(6.5, top);
          const d = 1.5 - inset;
          place('sign_blade', mat(fx + tx * a + nx * (d - 0.05), y, fz + tz * a + nz * (d - 0.05), rotF), Math.floor(rand() * 32));
        }
      }
      // rooftop billboard facing the street
      if (styleOk && t.style !== 'setback' && faceLen > 13 && rand() < 0.32) {
        const back = (nx ? hw : hd) - 3;
        place('billboard', mat(lot.cx + nx * back, roof, lot.cz + nz * back, rotF, 1));
      }
      // wall screen facing the plaza on tall towers
      if (facesPlaza && roof > 40 && rand() < 0.8) {
        const d = t.style === 'glass' ? 1.3 : inset;
        place('billboard', mat(fx - nx * d + nx * 0.6, R(18, Math.min(32, roof - 14)), fz - nz * d + nz * 0.6, rotF, 1.2));
      }
      // vending machines against the shopfront
      if (rand() < 0.55) {
        const a = R(-faceLen / 2 + 2, faceLen / 2 - 2);
        const x = fx + tx * a + nx * 0.45;
        const z = fz + tz * a + nz * 0.45;
        place('prop_vending', mat(x, 0.15, z, rotF));
        addBox(x, z, 0.55, 0.55);
      }
    }
  }

  // ---------------------------------------------------------------- streets
  const isCrossing = (along) => ROADS.some((c) => Math.abs(along - c) < HALF_ROAD + SIDEWALK + 2);
  for (const c of ROADS) {
    for (const axis of ['x', 'z']) {
      for (let along = -EDGE + 4; along <= EDGE - 4; along += 2) {
        const pos = (lat) => (axis === 'x' ? [along, lat] : [lat, along]);
        const dirAlong = axis === 'x' ? [1, 0] : [0, 1];
        if (isCrossing(along)) continue;
        for (const side of [-1, 1]) {
          const [x, z] = pos(c + side * (HALF_ROAD + 0.6));
          if (inPlaza(x, z, 2)) continue;
          // lamps every 20 m, staggered
          if (Math.abs(((along + 200 + (side > 0 ? 10 : 0)) % 20)) < 0.01) {
            const toRoad = axis === 'x' ? [0, -side] : [-side, 0];
            place('prop_lamp', mat(x, 0.15, z, alongX(toRoad[0], toRoad[1])));
            addBox(x, z, 0.3, 0.3);
            if (rand() < 0.2) lights.push({ x: x + toRoad[0] * 1.4, y: 6.0, z: z + toRoad[1] * 1.4, color: 0x9fd8ff, i: 18, d: 22 });
          }
          // parked cars every 7 m
          if (Math.abs((along + 203) % 7) < 0.01 && rand() < 0.4 && Math.abs(c) !== 64) {
            const [px, pz] = pos(c + side * (HALF_ROAD - 1.15));
            const flip = side > 0 ? 0 : Math.PI;
            place('prop_parked_car', mat(px, 0, pz, alongX(dirAlong[0], dirAlong[1]) + flip));
            addBox(px, pz, axis === 'x' ? 2.2 : 0.95, axis === 'x' ? 0.95 : 2.2);
          }
          // kiosks along the central streets
          if (c === 0 && Math.abs((along + 211) % 13) < 0.01 && rand() < 0.65) {
            const [kx, kz] = pos(c + side * (HALF_ROAD + 1.6));
            const toRoad = axis === 'x' ? [0, -side] : [-side, 0];
            place('prop_kiosk', mat(kx, 0.15, kz, faceZ(toRoad[0], toRoad[1])));
            addBox(kx, kz, axis === 'x' ? 1.7 : 1.2, axis === 'x' ? 1.2 : 1.7);
            if (rand() < 0.45) lights.push({ x: kx + toRoad[0] * 2, y: 2.6, z: kz + toRoad[1] * 2, color: 0xffa860, i: 10, d: 14 });
          }
          // manhole steam in the road
          if (Math.abs((along + 205) % 37) < 0.01 && rand() < 0.5) {
            const [vx, vz] = pos(c + side * R(0.5, 3));
            place('prop_vent', mat(vx, 0.0, vz, 0));
            steam.push(new THREE.Vector3(vx, 0.1, vz));
          }
        }
      }
    }
  }

  // alleys: dumpsters, crates, vents with steam
  const seenBlocks = new Set();
  for (const lot of lots) {
    const b = lot.alleys.block;
    const key = `${b.x0},${b.z0}`;
    if (seenBlocks.has(key)) continue;
    seenBlocks.add(key);
    for (const axis of ['x', 'z']) {
      const c = axis === 'x' ? lot.alleys.x : lot.alleys.z;
      const [a0, a1] = axis === 'x' ? [b.z0, b.z1] : [b.x0, b.x1];
      for (let k = 0; k < 3; k++) {
        const a = R(a0 + 2, a1 - 2);
        const [x, z] = axis === 'x' ? [c + R(-0.4, 0.4), a] : [a, c + R(-0.4, 0.4)];
        if (inPlaza(x, z, 1)) continue;
        const r = rand();
        const rot = axis === 'x' ? Math.PI / 2 : 0;
        if (r < 0.35) place('prop_dumpster', mat(x, 0.15, z, rot + (rand() < 0.5 ? Math.PI : 0), 0.9));
        else if (r < 0.65) place('prop_crates', mat(x, 0.15, z, R(0, 6.28)));
        else {
          place('prop_vent', mat(x, 0.15, z, rot));
          steam.push(new THREE.Vector3(x, 0.25, z));
        }
      }
    }
  }

  // ---------------------------------------------------------------- plaza
  place('holo_plinth', mat(0, 0, 0, 0));
  addBox(0, 0, 6.6, 6.6);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 16;
    const z = Math.sin(a) * 16;
    place('prop_tree', mat(x, 0, z, a));
    addBox(x, z, 1.5, 1.5);
    const b = a + Math.PI / 6;
    place('prop_bench', mat(Math.cos(b) * 13, 0, Math.sin(b) * 13, alongX(-Math.sin(b), Math.cos(b))));
  }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const x = Math.cos(a) * 24;
    const z = Math.sin(a) * 24;
    if (nearRoad(x, 6) || nearRoad(z, 6)) continue;
    place('prop_kiosk', mat(x, 0, z, faceZ(-x, -z)));
    addBox(x, z, 1.7, 1.7);
  }
  for (const [x, z] of [[-30, -6], [-30, 6], [30, -6], [30, 6], [-6, -30], [6, -30], [-6, 30], [6, 30]]) {
    for (let k = -1; k <= 1; k++) {
      const bx = Math.abs(x) === 30 ? x : x + k * 1.2;
      const bz = Math.abs(z) === 30 ? z : z + k * 1.2;
      place('prop_bollard', mat(Math.abs(x) === 30 ? bx : bx, 0, Math.abs(x) === 30 ? bz + k * 1.2 : bz, 0));
    }
  }
  lights.push({ x: 0, y: 6, z: 0, color: 0x40e8ff, i: 60, d: 40 });
  lights.push({ x: 18, y: 4, z: -18, color: 0xff3a9a, i: 30, d: 26 });
  lights.push({ x: -18, y: 4, z: 18, color: 0xff3a9a, i: 30, d: 26 });
  // barriers: a roadworks spot
  for (let k = 0; k < 4; k++) place('prop_barrier', mat(-30 - k * 2.1, 0, -64 + 3.4, 0));

  // ---------------------------------------------------------------- elevated rail
  const rc = 64;
  const cr = 14;
  const railPts = [];
  const pushArc = (cx, cz, a0) => {
    for (let k = 0; k <= 8; k++) {
      const a = a0 + (k / 8) * (Math.PI / 2);
      railPts.push(new THREE.Vector3(cx + Math.cos(a) * cr, RAIL_Y, cz + Math.sin(a) * cr));
    }
  };
  pushArc(rc - cr, rc - cr, 0);
  pushArc(-rc + cr, rc - cr, Math.PI / 2);
  pushArc(-rc + cr, -rc + cr, Math.PI);
  pushArc(rc - cr, -rc + cr, Math.PI * 1.5);
  const railCurve = new THREE.CatmullRomCurve3(railPts, true, 'centripetal');
  const railLen = railCurve.getLength();
  const nSeg = Math.round(railLen / 4);
  for (let i = 0; i < nSeg; i++) {
    const p0 = railCurve.getPointAt(i / nSeg);
    const p1 = railCurve.getPointAt(((i + 1) % nSeg) / nSeg);
    const d = p1.clone().sub(p0);
    const L = Math.hypot(d.x, d.z);
    place('rail_segment', mat(p0.x, RAIL_Y, p0.z, alongX(d.x, d.z), 1, 1, 1).multiply(new THREE.Matrix4().makeScale(L + 0.06, 1, 1)));
    if (i % 6 === 0 && !(nearRoad(p0.x, 12) && nearRoad(p0.z, 12))) {
      place('rail_pylon', mat(p0.x, 0, p0.z, alongX(-d.z, d.x)));
      addBox(p0.x, p0.z, 1.6, 1.6);
    }
  }

  // ---------------------------------------------------------------- skywalks across the ring roads
  const skyOk = (P) => ['block', 'slab', 'stack'].includes(P.t.style) && P.roof > 34;
  for (const A of placedTowers) {
    for (const B of placedTowers) {
      if (A === B || !skyOk(A) || !skyOk(B)) continue;
      // A on the low side of a ring road, B directly across
      for (const c of [-64, 64]) {
        const acrossX = A.lot.x1 === c - 8 && B.lot.x0 === c + 8 && Math.abs(A.lot.cz - B.lot.cz) < 1;
        const acrossZ = A.lot.z1 === c - 8 && B.lot.z0 === c + 8 && Math.abs(A.lot.cx - B.lot.cx) < 1;
        if (!(acrossX || acrossZ) || rand() > 0.5) continue;
        const y = R(24, 28);
        if (acrossX) {
          const x0 = A.lot.cx + A.hw - 2;
          const x1 = B.lot.cx - B.hw + 2;
          const z = A.lot.cz + R(-3, 3);
          place('skywalk', mat(x0, y, z, 0).multiply(new THREE.Matrix4().makeScale(x1 - x0, 1, 1)));
        } else {
          const z0 = A.lot.cz + A.hd - 2;
          const z1 = B.lot.cz - B.hd + 2;
          const x = A.lot.cx + R(-3, 3);
          place('skywalk', mat(x, y, z0, -Math.PI / 2).multiply(new THREE.Matrix4().makeScale(z1 - z0, 1, 1)));
        }
      }
    }
  }

  // ---------------------------------------------------------------- far skyline (not walkable)
  // High traffic lanes are fixed first so the skyline leaves gaps for them.
  const highLanes = [];
  for (let k = 0; highLanes.length < 6 && k < 40; k++) {
    const c = R(-320, 320);
    if (nearRoad(c, 70) || highLanes.some((l) => Math.abs(l.c - c) < 60)) continue;
    highLanes.push({ axis: highLanes.length % 2 ? 'x' : 'z', c, alt: R(120, 170), dir: rand() < 0.5 ? -1 : 1, len: 900 });
  }
  const nearHigh = (x, z) => highLanes.some((l) => Math.abs((l.axis === 'x' ? z : x) - l.c) < 34);
  const farNames = towers.filter((t) => t.style !== 'market').map((t) => t.name);
  let far = 0;
  for (let tries = 0; far < 170 && tries < 4000; tries++) {
    const x = R(-480, 480);
    const z = R(-480, 480);
    const r = Math.max(Math.abs(x), Math.abs(z));
    if (r < 150) continue;
    if (nearRoad(x, 34) || nearRoad(z, 34) || nearHigh(x, z)) continue;
    const n = pick(farNames);
    const s = R(1.1, 2.0) * (r > 300 ? 1.25 : 1);
    place(n, mat(x, 0, z, Math.floor(R(0, 4)) * Math.PI / 2, s, s * R(0.9, 1.4), s));
    far++;
  }
  place('tower_glass_a', mat(-330, 0, -400, 0.3, 3.2, 3.4, 3.2));
  place('tower_cylinder_a', mat(360, 0, -340, 0, 3, 3.6, 3));

  // ---------------------------------------------------------------- build static batches
  const batches = new Map();
  let instances = 0;
  for (const [name, list] of placements) {
    const isSign = name === 'sign_blade' || name === 'sign_wide';
    const b = new Batch(kit.get(name), list.length, scene, isSign
      ? { tiles: true, material: { match: 'SignFace', material: name === 'sign_blade' ? signMaterials.blade : signMaterials.wide } }
      : {});
    for (const p of list) b.add(p.m, p.tile);
    b.commit();
    batches.set(name, b);
    instances += list.length;
  }

  // ---------------------------------------------------------------- dynamic: train, hover cars, koi
  const trainCars = 4;
  const train = new Batch(kit.get('train_car'), trainCars, scene, { dynamic: true });
  for (let i = 0; i < trainCars; i++) train.add(new THREE.Matrix4());
  const trainState = { s: 0, speed: 15, pos: new THREE.Vector3(), dir: new THREE.Vector3() };

  const lanes = [];
  const alts = [36, 50, 66, 84];
  for (const c of ROADS) {
    for (const axis of ['x', 'z']) {
      const a2 = [...alts].sort(() => rand() - 0.5).slice(0, 2);
      for (const alt of a2) for (const dir of [-1, 1]) lanes.push({ axis, c: c + dir * 3.5, alt, dir, len: 760 });
    }
  }
  lanes.push(...highLanes);
  const carTypes = ['hover_car_a', 'hover_car_b', 'hover_van'];
  const cars = [];
  for (const lane of lanes) {
    const n = lane.alt > 100 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      cars.push({ lane, type: carTypes[Math.floor(rand() * (lane.alt > 60 ? 2 : 3))], s0: rand() * lane.len, speed: R(16, 32), bob: rand() * 6 });
    }
  }
  const carBatches = {};
  for (const t of carTypes) {
    const n = cars.filter((c) => c.type === t).length;
    carBatches[t] = new Batch(kit.get(t), n, scene, { dynamic: true });
    for (const c of cars) if (c.type === t) c.idx = carBatches[t].add(new THREE.Matrix4());
  }

  const koi = [];
  const koiTemplate = kit.get('holo_koi');
  const tints = [new THREE.Color(0.15, 0.85, 1.0), new THREE.Color(1.0, 0.35, 0.75), new THREE.Color(0.55, 0.4, 1.0)];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.Group();
    for (const p of koiTemplate.parts) {
      const m = new THREE.Mesh(p.geometry, hologramMaterial(tints[k]));
      m.applyMatrix4(p.matrix);
      g.add(m);
    }
    g.scale.setScalar(k === 0 ? 1.5 : 1.1);
    g.renderOrder = 10;
    scene.add(g);
    koi.push({ g, r: 6 + k * 3.2, h: 13 + k * 4, sp: 0.22 + k * 0.06, ph: k * 2.1 });
  }
  // holo beam
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: shared.time },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main(){ float a = (1.0 - vUv.y) * 0.16 * (0.8 + 0.2 * sin(vUv.x * 60.0 + uTime * 3.0));
      gl_FragColor = vec4(vec3(0.2, 0.75, 1.0) * a, 1.0); }`,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(9, 3.4, 34, 32, 1, true), beamMat);
  beam.position.y = 1.3 + 17;
  scene.add(beam);

  // ---------------------------------------------------------------- update
  const m4 = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();
  function update(dt, t) {
    // train
    trainState.s = (trainState.s + trainState.speed * dt) % railLen;
    for (let i = 0; i < trainCars; i++) {
      const s = ((trainState.s - i * 14.6) % railLen + railLen) % railLen;
      const u = s / railLen;
      const p = railCurve.getPointAt(u);
      const tan = railCurve.getTangentAt(u);
      train.set(i, m4.copy(mat(p.x, RAIL_Y, p.z, alongX(tan.x, tan.z))));
      if (i === 0) {
        trainState.pos.copy(p);
        trainState.dir.copy(tan);
      }
    }
    train.commit();
    // hover cars
    for (const c of cars) {
      const L = c.lane.len;
      const s = ((c.s0 + c.speed * t) % L) - L / 2;
      const along = s * c.lane.dir;
      const y = c.lane.alt + Math.sin(t * 0.8 + c.bob) * 0.4;
      const [x, z] = c.lane.axis === 'x' ? [along, c.lane.c] : [c.lane.c, along];
      const dx = c.lane.axis === 'x' ? c.lane.dir : 0;
      const dz = c.lane.axis === 'z' ? c.lane.dir : 0;
      carBatches[c.type].set(c.idx, m4.copy(mat(x, y, z, alongX(dx, dz))));
    }
    for (const b of Object.values(carBatches)) b.commit();
    // koi
    for (const k of koi) {
      const a = t * k.sp + k.ph;
      k.g.position.set(Math.cos(a) * k.r, k.h + Math.sin(t * 0.6 + k.ph) * 1.5, Math.sin(a) * k.r);
      // swim tangent to the circle
      tmpV.set(-Math.sin(a), 0, Math.cos(a));
      k.g.rotation.set(0, alongX(tmpV.x, tmpV.z), Math.sin(t * 0.6 + k.ph) * 0.12);
    }
    beam.rotation.y = t * 0.2;
  }

  // tallest landmark for the flyover
  const landmark = placedTowers.find((P) => P.t.name === 'tower_glass_a');

  return {
    colliders,
    sidewalks,
    steam,
    lights,
    railCurve,
    railLen,
    trainState,
    landmark,
    placedTowers,
    update,
    stats: { instances, kitItems: placements.size, towers: placedTowers.length, cars: cars.length },
  };
}
