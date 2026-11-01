// Loads the Blender kits (detailed district kit + light far-skyline kit), the
// facade layout JSON and the texture sets, and turns each kit object into an
// instancing template with browser materials.
import * as THREE from '../../_shared/three-r187/build/three.webgpu.js';
import { GLTFLoader } from '../../_shared/three-r187/addons/loaders/GLTFLoader.js';
import { loadTextures, texturedMaterial, windowMaterial, farFacadeMaterial, signMaterial, screenMaterial } from './materials.js';

// Sign atlases drawn on a canvas.
const BLADE_WORDS = ['HOTEL', 'RAMEN', 'BAR', 'CLINIC', 'NOODLE', '24H', 'ARCADE', 'LUMEN', 'CYBER', 'KARAOKE', 'SUSHI', 'PAWN',
  'DENTAL', 'MODS', 'VOID', 'TEA', 'SAKE', 'OPEN', 'REPAIR', 'DOJO', 'NEON', 'KOI', 'LOANS', 'SYNTH', 'PHARMA', 'CAFE', 'IMPLANT', 'DATA',
  'CHROME', 'DUMPLING', 'RENT', 'GAMES'];
const WIDE_WORDS = ['ELUSION WORKS', 'NOODLE BAR', 'NIGHT MARKET', 'NEURO LINK', 'KOI KOI', 'REPAIRS 24H', 'PHARMACY', 'HOSTEL',
  'CHROME & CO', 'SYNTH WAVE', 'LUMEN WARD', 'DUMPLINGS', 'DATA BROKER', 'TEA HOUSE', 'PACHINKO', 'RAIN CITY'];
export const SIGN_COLS = ['#ff2a8a', '#22e6ff', '#ffa024', '#9b5cff', '#3dff8a', '#ff4040', '#fff3c4'];
export const tileColour = (i) => SIGN_COLS[(i * 5 + 3) % SIGN_COLS.length];

function drawAtlas(kind) {
  const cv = document.createElement('canvas');
  const blade = kind === 'blade';
  cv.width = 1024;
  cv.height = blade ? 2048 : 1024;
  const cols = blade ? 8 : 2;
  const rows = blade ? 4 : 8;
  const tw = cv.width / cols;
  const th = cv.height / rows;
  const g = cv.getContext('2d');
  const words = blade ? BLADE_WORDS : WIDE_WORDS;
  for (let i = 0; i < cols * rows; i++) {
    const cx = (i % cols) * tw;
    const cy = Math.floor(i / cols) * th;
    const col = tileColour(i);
    const dark = i % 3 === 0;
    g.fillStyle = dark ? '#07060c' : col;
    g.globalAlpha = dark ? 1 : 0.16;
    g.fillRect(cx, cy, tw, th);
    g.globalAlpha = 1;
    g.fillStyle = '#05040a';
    if (!dark) g.fillRect(cx + 6, cy + 6, tw - 12, th - 12);
    g.strokeStyle = col;
    g.lineWidth = blade ? 6 : 5;
    g.shadowColor = col;
    g.shadowBlur = 18;
    g.strokeRect(cx + 10, cy + 10, tw - 20, th - 20);
    g.fillStyle = i % 4 === 1 ? '#ffffff' : col;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = words[i % words.length];
    if (blade) {
      const letters = w.split('');
      const fs = Math.min(tw * 0.62, ((th - 40) / letters.length) * 0.9);
      g.font = `800 ${fs}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      letters.forEach((ch, k) => g.fillText(ch, cx + tw / 2, cy + 20 + ((th - 40) * (k + 0.5)) / letters.length));
    } else {
      let fs = th * 0.56;
      g.font = `800 ${fs}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      const mw = g.measureText(w).width;
      if (mw > tw * 0.86) fs *= (tw * 0.86) / mw;
      g.font = `800 ${fs}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      g.fillText(w, cx + tw / 2, cy + th / 2 + 2);
    }
    g.shadowBlur = 0;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, cols, rows };
}

const TEXTURED = {
  Concrete: ['concrete', {}],
  ConcreteDark: ['concrete', { tint: 0.45 }],
  Cladding: ['cladding', {}],
  Roof: ['roof', { wet: 0.6 }],
  Rust: ['rustmetal', {}],
  Pavement: ['pavement', {}],
};

function templatesFrom(gltf) {
  const kit = new Map();
  gltf.scene.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  for (const node of gltf.scene.children) {
    const parts = [];
    node.traverse((o) => {
      if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, matName: o.material.name, matrix: o.matrixWorld.clone() });
    });
    const box = new THREE.Box3();
    const foot = new THREE.Box3();
    for (const p of parts) {
      const pos = p.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix);
        box.expandByPoint(v);
        if (v.y < 3.0) foot.expandByPoint(v);
      }
    }
    kit.set(node.name, { name: node.name, parts, box, foot });
  }
  return kit;
}

export async function loadKits(base, onProgress) {
  const loader = new GLTFLoader();
  let pk = 0;
  let pf = 0;
  let pt = 0;
  const report = () => onProgress?.(pk * 0.55 + pf * 0.15 + pt * 0.3);
  const [gltf, far, layout, tex] = await Promise.all([
    loader.loadAsync(`${base}/lumen-ward-kit.glb`, (e) => { if (e.total) { pk = e.loaded / e.total; report(); } }),
    loader.loadAsync(`${base}/lumen-ward-far.glb`, (e) => { if (e.total) { pf = e.loaded / e.total; report(); } }),
    fetch(`${base}/lumen-ward-kit.json`).then((r) => r.json()),
    loadTextures(`${base}/tex`, (f) => { pt = f; report(); }),
  ]);
  const kit = templatesFrom(gltf);
  const farKit = templatesFrom(far);
  const atlases = { blade: drawAtlas('blade'), wide: drawAtlas('wide') };

  // shared browser materials by kit material name
  const shared = new Map();
  for (const [name, [set, opts]] of Object.entries(TEXTURED)) shared.set(name, texturedMaterial(tex[set], opts));
  const screen = screenMaterial(atlases.wide.tex);
  const fix = (mat) => {
    if (shared.has(mat.name)) return shared.get(mat.name);
    if (mat.name === 'Screen') return screen;
    if (mat.isMeshStandardMaterial) {
      const m = new THREE.MeshStandardNodeMaterial();
      m.color.copy(mat.color);
      m.roughness = mat.roughness;
      m.metalness = mat.metalness;
      m.emissive.copy(mat.emissive);
      m.emissiveIntensity = mat.emissiveIntensity;
      m.name = mat.name;
      m.side = mat.side;
      shared.set(mat.name, m);
      return m;
    }
    return mat;
  };
  for (const t of kit.values()) for (const p of t.parts) p.material = fix(p.material);
  const farMats = new Map();
  for (const t of farKit.values()) {
    for (const p of t.parts) {
      const n = p.material.name;
      if (!farMats.has(n)) {
        if (n === 'Facade') farMats.set(n, farFacadeMaterial(p.material, { col: 2.1, floorH: 3.3, lit: 0.36, intensity: 1.0, cool: 0.25 }));
        else if (n === 'FacadeGlass') farMats.set(n, farFacadeMaterial(p.material, { col: 1.6, floorH: 3.8, lit: 0.48, intensity: 0.95, cool: 0.6 }));
        else farMats.set(n, fix(p.material));
      }
      p.material = farMats.get(n);
    }
  }
  return { kit, farKit, layout, tex, atlases };
}

// One batch of instances of a template: one InstancedMesh per part, plus
// optional per-instance attributes (yaw, seed, tile) for the shaders.
export class Batch {
  constructor(template, capacity, scene, { dynamic = false, attrs = [], materialFor = null, castShadow = false } = {}) {
    this.t = template;
    this.count = 0;
    this.capacity = Math.max(1, capacity);
    this.attrs = {};
    for (const a of attrs) this.attrs[a] = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this.meshes = template.parts.map((p) => {
      const mat = (materialFor && materialFor(p, this.attrs, template)) || p.material;
      const m = new THREE.InstancedMesh(p.geometry, mat, this.capacity);
      m.count = 0;
      m.userData.local = p.matrix;
      m.castShadow = castShadow;
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
    this.set(i, matrix);
    for (const [k, v] of Object.entries(values)) if (this.attrs[k]) this.attrs[k].setX(i, v);
    for (const m of this.meshes) m.count = this.count;
    return i;
  }

  set(i, matrix) {
    for (const m of this.meshes) {
      this.tmp.multiplyMatrices(matrix, m.userData.local);
      m.setMatrixAt(i, this.tmp);
    }
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

// Materials that need per-batch instanced attributes.
export function materialForFactory(atlases) {
  return (p, attrs, template) => {
    if (p.matName === 'WindowGlass' && attrs.yaw) {
      const ribbon = template.name === 'cell_ribbon';
      return windowMaterial(attrs.yaw, attrs.seed, ribbon ? { w: 1.8, h: 2.85, depth: 3.2 } : { w: 1.5, h: 2.0, depth: 3.0 });
    }
    if (p.matName === 'ShopGlass' && attrs.yaw) return windowMaterial(attrs.yaw, attrs.seed, { w: 3.0, h: 2.9, depth: 4.5, shop: true });
    if (p.matName === 'SignFace' && attrs.tile) {
      const a = template.name === 'sign_blade' ? atlases.blade : atlases.wide;
      return signMaterial(a.tex, a.cols, a.rows, attrs.tile, 2.0);
    }
    return null;
  };
}
