// Loads the Blender kit and texture sets and builds the browser materials:
// textured PBR stone, plaster, timber and roofs; wind-blown leaf cards;
// window glass and lanterns that light up at night.
import * as THREE from '../../_shared/three-r187/build/three.webgpu.js';
import { GLTFLoader } from '../../_shared/three-r187/addons/loaders/GLTFLoader.js';
import {
  Fn, vec2, vec3, float, uniform, texture, uv, positionWorld, positionLocal, normalMap, clamp, mix, step, hash, floor,
  sin, instancedBufferAttribute, attribute, smoothstep, fract, dot, vec4,
} from '../../_shared/three-r187/build/three.tsl.js';

export const env = {
  time: uniform(0), // seconds, for wind and flicker
  night: uniform(0), // 0 day .. 1 night
  wet: uniform(0), // 0 dry .. 1 soaked
  wind: uniform(1),
};

const SETS = ['ashlar', 'rubble', 'plaster', 'timber', 'roofclay', 'roofslate', 'cobbles', 'flagstone', 'grass', 'dirt', 'rock', 'bark', 'planks'];

export async function loadTextures(base, onProgress) {
  const loader = new THREE.TextureLoader();
  const tex = {};
  const jobs = [];
  for (const n of SETS) for (const k of ['color', 'orm', 'normal']) jobs.push([n, k]);
  let done = 0;
  await Promise.all([
    ...jobs.map(async ([n, k]) => {
      const t = await loader.loadAsync(`${base}/${n}_${k}.webp`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.flipY = false;
      t.colorSpace = k === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      (tex[n] = tex[n] || {})[k] = t;
      onProgress?.(++done / (jobs.length + 1));
    }),
    loader.loadAsync(`${base}/leaves.webp`).then((t) => {
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      tex.leaves = t;
      onProgress?.(++done / (jobs.length + 1));
    }),
  ]);
  return tex;
}

// PBR from a texture set on the mesh UVs, darkened and glossier when wet.
export function pbr(set, { tint = [1, 1, 1], uvScale = 1, normalScale = 1, porous = 0.6 } = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const u = uv().mul(uvScale);
  const orm = texture(set.orm, u);
  const wetDarken = mix(float(1), float(1 - porous * 0.45), env.wet);
  m.colorNode = texture(set.color, u).rgb.mul(vec3(...tint)).mul(wetDarken);
  m.roughnessNode = clamp(mix(orm.g, orm.g.mul(0.55), env.wet), 0.05, 1);
  m.metalnessNode = orm.b;
  m.aoNode = orm.r;
  m.normalNode = normalMap(texture(set.normal, u), vec2(normalScale));
  return m;
}

const TEXTURED = {
  Ashlar: ['ashlar', {}],
  Rubble: ['rubble', {}],
  Plaster: ['plaster', { tint: [0.9, 0.87, 0.8], porous: 0.3 }],
  Plaster2: ['plaster', { tint: [0.92, 0.8, 0.6], porous: 0.3 }],
  Plaster3: ['plaster', { tint: [0.9, 0.74, 0.66], porous: 0.3 }],
  Timber: ['timber', {}],
  RoofClay: ['roofclay', { porous: 0.3 }],
  RoofSlate: ['roofslate', { porous: 0.2 }],
  Cobbles: ['cobbles', {}],
  Flagstone: ['flagstone', {}],
  Planks: ['planks', {}],
  Bark: ['bark', {}],
};

// Leaf cards: alpha-tested atlas, per-instance colour cell, wind sway, and a
// little light let through from behind.
// cellAttr: 'geometry' reads a per-instance 'cell' attribute from the mesh's own
// geometry, so one material serves every tree batch; an attribute object binds
// that attribute; nothing means green.
export function leafMaterial(atlas, cellAttr) {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.5, transparent: false });
  const cell = cellAttr === 'geometry' ? attribute('cell', 'float') : cellAttr ? instancedBufferAttribute(cellAttr) : float(0);
  // 0 green (no shift), 1 autumn orange (+u), 2 golden yellow (+v)
  const off = vec2(step(0.5, cell).mul(step(cell, 1.5)).mul(0.5), step(1.5, cell).mul(0.5));
  const isFir = step(0.5, uv().x).mul(step(0.5, uv().y)); // the fir cell never shifts
  const u = uv().add(off.mul(float(1).sub(isFir)));
  const c = texture(atlas, u);
  m.colorNode = c.rgb.mul(0.9);
  m.opacityNode = c.a;
  m.roughnessNode = float(0.75);
  m.metalnessNode = float(0);
  // wind: sway grows with height above the trunk base
  const h = positionLocal.y.max(0);
  const w = env.wind.mul(h.mul(0.012));
  const ph = positionWorld.x.mul(0.05).add(positionWorld.z.mul(0.04));
  const sway = vec3(sin(env.time.mul(1.3).add(ph)).mul(w), 0, sin(env.time.mul(1.1).add(ph.mul(1.3))).mul(w.mul(0.7)));
  const flutter = sin(env.time.mul(7).add(positionLocal.x.mul(3).add(positionLocal.z.mul(3)))).mul(0.03).mul(env.wind);
  m.positionNode = positionLocal.add(sway).add(vec3(flutter, flutter.mul(0.5), 0));
  m.emissiveNode = c.rgb.mul(0.06).mul(float(1).sub(env.night)); // faint translucency, daylight only
  return m;
}

function glassMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0.0 });
  m.colorNode = vec3(0.02, 0.025, 0.03);
  const cell = floor(positionWorld.mul(1.2));
  const r = hash(cell.x.add(cell.y.mul(31.0)).add(cell.z.mul(57.0)));
  const lit = step(0.45, r);
  const warm = mix(vec3(1.0, 0.62, 0.28), vec3(1.0, 0.8, 0.5), hash(r.add(3.0)));
  const flick = sin(env.time.mul(3.0).add(r.mul(40.0))).mul(0.06).add(0.94);
  m.emissiveNode = warm.mul(lit).mul(env.night).mul(flick).mul(2.2);
  return m;
}

function lanternMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x9a7a4a, roughness: 0.4 });
  const flick = sin(env.time.mul(11.0).add(positionWorld.x)).mul(sin(env.time.mul(7.3).add(positionWorld.z))).mul(0.12).add(0.9);
  m.emissiveNode = vec3(1.0, 0.62, 0.25).mul(mix(float(0.15), float(6.0), env.night)).mul(flick);
  return m;
}

function waterMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x0c1a1e, roughness: 0.03, metalness: 0.2 });
  const p = positionWorld.xz.mul(3.0);
  const n = sin(p.x.add(env.time.mul(1.7))).mul(sin(p.y.sub(env.time.mul(1.3)))).mul(0.15);
  m.normalNode = normalMap(vec3(n.mul(0.5).add(0.5), n.mul(-0.5).add(0.5), 1.0));
  return m;
}

function templatesFrom(gltf) {
  const kit = new Map();
  gltf.scene.updateMatrixWorld(true);
  for (const node of gltf.scene.children) {
    const parts = [];
    node.traverse((o) => {
      if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, matName: o.material.name, matrix: o.matrixWorld.clone() });
    });
    const box = new THREE.Box3();
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox.clone().applyMatrix4(p.matrix));
    }
    kit.set(node.name, { name: node.name, parts, box });
  }
  return kit;
}

export async function loadKit(base, onProgress) {
  const loader = new GLTFLoader();
  let pk = 0;
  let pt = 0;
  const report = () => onProgress?.(pk * 0.6 + pt * 0.4);
  const [gltf, foot, tex] = await Promise.all([
    loader.loadAsync(`${base}/thornvale-kit.glb`, (e) => { if (e.total) { pk = e.loaded / e.total; report(); } }),
    fetch(`${base}/thornvale-kit.json`).then((r) => r.json()),
    loadTextures(`${base}/tex`, (f) => { pt = f; report(); }),
  ]);
  const kit = templatesFrom(gltf);
  const shared = new Map();
  for (const [name, [set, opts]] of Object.entries(TEXTURED)) shared.set(name, pbr(tex[set], opts));
  shared.set('Glass', glassMaterial());
  shared.set('Lantern', lanternMaterial());
  shared.set('Water', waterMaterial());
  const fix = (mat) => {
    if (shared.has(mat.name)) return shared.get(mat.name);
    const m = new THREE.MeshStandardNodeMaterial();
    m.color.copy(mat.color);
    m.roughness = mat.roughness;
    m.metalness = mat.metalness;
    m.name = mat.name;
    shared.set(mat.name, m);
    return m;
  };
  for (const t of kit.values()) for (const p of t.parts) if (p.matName !== 'Leaves') p.material = fix(p.material);
  return { kit, foot, tex, mats: Object.fromEntries(shared) };
}

// One batch of instances of a template: one InstancedMesh per part.
// A geometry that shares the template's buffers and adds per-instance attributes.
function shareGeometry(src, attrs) {
  const g = new THREE.BufferGeometry();
  g.setIndex(src.index);
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
  for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, a);
  if (!src.boundingSphere) src.computeBoundingSphere();
  if (!src.boundingBox) src.computeBoundingBox();
  g.boundingSphere = src.boundingSphere;
  g.boundingBox = src.boundingBox;
  return g;
}

export class Batch {
  constructor(template, capacity, scene, { attrs = [], geomAttrs = false, materialFor = null, dynamic = false, shadows = true } = {}) {
    this.count = 0;
    this.capacity = Math.max(1, capacity);
    this.attrs = {};
    for (const a of attrs) this.attrs[a] = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.meshes = template.parts.map((p) => {
      const mat = (materialFor && materialFor(p, this.attrs)) || p.material;
      const geo = geomAttrs ? shareGeometry(p.geometry, this.attrs) : p.geometry;
      const m = new THREE.InstancedMesh(geo, mat, this.capacity);
      m.count = 0;
      m.userData.local = p.matrix;
      m.castShadow = shadows;
      m.receiveShadow = true;
      if (dynamic) {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
      }
      scene.add(m);
      return m;
    });
    this.tmp = new THREE.Matrix4();
  }

  add(matrix, values = {}) {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    for (const m of this.meshes) {
      this.tmp.multiplyMatrices(matrix, m.userData.local);
      m.setMatrixAt(i, this.tmp);
      m.count = this.count;
    }
    for (const [k, v] of Object.entries(values)) this.attrs[k]?.setX(i, v);
    return i;
  }

  setVisible(v) {
    for (const m of this.meshes) m.visible = v;
  }

  setShadow(v) {
    for (const m of this.meshes) m.castShadow = v;
  }

  commit() {
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.frustumCulled) {
        m.computeBoundingSphere();
        m.computeBoundingBox();
      }
    }
    for (const a of Object.values(this.attrs)) a.needsUpdate = true;
  }
}
