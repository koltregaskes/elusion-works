// Terrain for Thornvale: a hill-top town plateau with an upper terrace, a
// battered slope down to meadows, forested hills and a ring of snowy
// mountains. One height function feeds the terrain mesh, the grass and every
// placement, so everything sits on the same ground.
import * as THREE from '../../_shared/three-r187/build/three.webgpu.js';

export const WORLD = 1600; // metres covered by the main terrain
export const RES = 1024; // heightmap texels per side
export const TOWN = { rx: 105, rz: 85, base: 22, terraceZ: -22, terraceRise: 8 };

// --- deterministic value noise -------------------------------------------------
function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, oct = 5) {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f, z * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return s;
}
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Elliptical distance from the town centre: 1 on the wall line.
export const townR = (x, z) => Math.hypot(x / TOWN.rx, z / TOWN.rz);

// The road leaving the south gate and winding down to the valley.
export const ROAD = [
  [0, TOWN.rz - 2], [0, TOWN.rz + 30], [18, 140], [40, 190], [30, 250], [-10, 320], [-40, 420], [-30, 560], [0, 760],
];
export function distToPolyline(x, z, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) best = d;
  }
  return best;
}

// Ground level inside the walls: the lower town, the upper terrace, and the
// grand stair between them.
export function townHeight(x, z) {
  let h = TOWN.base;
  if (z < TOWN.terraceZ) h += TOWN.terraceRise;
  if (Math.abs(x) < 4.2 && z < TOWN.terraceZ + 10 && z >= TOWN.terraceZ) {
    h = TOWN.base + TOWN.terraceRise * (1 - (z - TOWN.terraceZ) / 10);
  }
  return h;
}

// Raw height (before rasterising): metres.
export function heightAt(x, z) {
  const r = townR(x, z);
  if (r <= 1.0) return townHeight(x, z);
  // rolling meadows and forested hills rising away from the town
  const far = Math.hypot(x, z);
  let h = fbm(x * 0.004 + 3.1, z * 0.004 - 1.7) * 26 + fbm(x * 0.015, z * 0.015) * 5 - 6;
  h += smooth(250, 750, far) * fbm(x * 0.002 - 4, z * 0.002 + 2) * 120;
  // the outside foot of the wall sits 4 m below the ground just inside it
  const foot = townHeight(x / r, z / r) - 4;
  const glacis = foot - (r - 1.0) * 60;
  const ground = Math.max(h, Math.min(foot, glacis));
  const out = smooth(1.0, 1.05, r);
  let y = foot * (1 - out) + ground * out;
  // the road from the gate, eased down into the valley
  const dr = distToPolyline(x, z, ROAD);
  if (dr < 12) {
    const along = smooth(TOWN.rz + 25, 330, z);
    let roadH = foot * (1 - along) + h * along;
    // ramp up to the gate passage, level with the town
    roadH += (TOWN.base - foot) * smooth(TOWN.rz + 30, TOWN.rz + 3, z);
    y += (roadH - y) * smooth(12, 4, dr);
  }
  return y;
}

// Rasterise the heightmap once. Also returns a sampler for placements.
export function buildHeightmap() {
  const data = new Float32Array(RES * RES);
  const step = WORLD / (RES - 1);
  for (let j = 0; j < RES; j++) {
    const z = -WORLD / 2 + j * step;
    for (let i = 0; i < RES; i++) {
      const x = -WORLD / 2 + i * step;
      data[j * RES + i] = heightAt(x, z);
    }
  }
  const sample = (x, z) => {
    const fx = ((x + WORLD / 2) / WORLD) * (RES - 1);
    const fz = ((z + WORLD / 2) / WORLD) * (RES - 1);
    if (fx < 0 || fz < 0 || fx >= RES - 1 || fz >= RES - 1) return heightAt(x, z);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = data[j * RES + i];
    const b = data[j * RES + i + 1];
    const c = data[(j + 1) * RES + i];
    const d = data[(j + 1) * RES + i + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  return { data, sample };
}

// Half-float height texture for shaders (grass), linear-filterable everywhere.
export function heightTexture(data) {
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const t = new THREE.DataTexture(half, RES, RES, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// Ground masks: R cobbled streets, G flagstone, B dirt path, A no-grass.
export function buildMasks(streets, squares) {
  const data = new Uint8Array(RES * RES * 4);
  const step = WORLD / (RES - 1);
  for (let j = 0; j < RES; j++) {
    const z = -WORLD / 2 + j * step;
    for (let i = 0; i < RES; i++) {
      const x = -WORLD / 2 + i * step;
      const o = (j * RES + i) * 4;
      const r = townR(x, z);
      let cob = 0;
      let flag = 0;
      let dirt = 0;
      if (r < 1.02) {
        for (const s of streets) {
          const d = distToPolyline(x, z, s.pts);
          cob = Math.max(cob, smooth(s.w / 2 + 1.2, s.w / 2 - 0.8, d));
        }
        for (const q of squares) {
          const dx = Math.abs(x - q.x) - q.w / 2;
          const dz = Math.abs(z - q.z) - q.d / 2;
          flag = Math.max(flag, smooth(1.5, -0.5, Math.max(dx, dz)));
        }
        dirt = 0.35 + fbm(x * 0.1, z * 0.1) * 0.3;
      }
      if (r > 0.98 && r < 4) {
        const dr = distToPolyline(x, z, ROAD);
        dirt = Math.max(dirt, smooth(5.5, 3.0, dr));
      }
      data[o] = cob * 255;
      data[o + 1] = flag * 255;
      data[o + 2] = Math.min(1, dirt) * 255;
      data[o + 3] = Math.max(cob, flag, smooth(0.6, 0.9, dirt)) * 255;
    }
  }
  const t = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  const sample = (x, z) => {
    const i = Math.round(((x + WORLD / 2) / WORLD) * (RES - 1));
    const j = Math.round(((z + WORLD / 2) / WORLD) * (RES - 1));
    if (i < 0 || j < 0 || i >= RES || j >= RES) return [0, 0, 0, 0];
    const o = (j * RES + i) * 4;
    return [data[o] / 255, data[o + 1] / 255, data[o + 2] / 255, data[o + 3] / 255];
  };
  return { texture: t, sample };
}

// Main terrain mesh: a regular grid displaced on the CPU.
export function terrainGeometry(sample, segs = 512) {
  const g = new THREE.PlaneGeometry(WORLD, WORLD, segs, segs);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, sample(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  return g;
}

// Distant mountains: a ring of ridged peaks with snow caps.
export function mountainGeometry() {
  const rings = 60;
  const segs = 320;
  const r0 = WORLD / 2 - 40;
  const r1 = 7000;
  const pos = [];
  const idx = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const r = r0 + (r1 - r0) * t * t;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const ridge = 1 - Math.abs(fbm(x * 0.0007 + 9, z * 0.0007 - 3, 6) * 2 - 1);
      const lift = smooth(0.0, 0.35, t) * (1 - smooth(0.85, 1.0, t) * 0.3);
      // tallest to the north, behind the citadel
      const north = 0.55 + 0.45 * smooth(0.3, -1.0, Math.sin(a));
      const h = j === 0 ? heightAt(x, z) - 1 : (ridge ** 2.2 * 1300 + fbm(x * 0.003, z * 0.003) * 160) * lift * north + heightAt(Math.cos(a) * r0, Math.sin(a) * r0) * (1 - lift);
      pos.push(x, h, z);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i;
      const b = a + segs + 1;
      // counter-clockwise seen from above, so the faces (and normals) point up
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uvs = [];
  for (let i = 0; i < pos.length; i += 3) uvs.push(pos[i] / 60, pos[i + 2] / 60);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
