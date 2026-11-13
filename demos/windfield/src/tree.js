import * as THREE from '../vendor/three/build/three.module.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { heightAt } from './terrain.js';
import { makeRng } from './noise.js';
import { windUniforms, WIND_GLSL } from './wind.js';

// Procedural trees. Branches are tapered tubes merged into one mesh; leaves are alpha-cut
// cluster cards. Every vertex carries a sway weight so the wind bends trunk tips gently,
// limbs more, and makes the leaf cards shiver on top of that.

export const treeUniforms = {
  uLeafSummer: { value: new THREE.Color('#3f6a22') },
  uLeafAutumn: { value: new THREE.Color('#b5561d') },
  uSeason: { value: 0 },
  uCanopy: { value: 1 },
  uTreeBend: { value: 1 },
  uSunViewDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunTint: { value: new THREE.Color() },
  uTranslucency: { value: 1 },
};

const UP = new THREE.Vector3(0, 1, 0);

function leafTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rng = makeRng(5);
  g.clearRect(0, 0, size, size);
  // Twigs first, then many small lobed leaves, each with a stalk and a darker midrib.
  g.strokeStyle = 'rgba(70,55,40,1)';
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    g.lineWidth = 2 + rng() * 2;
    g.beginPath();
    g.moveTo(size / 2, size / 2);
    g.quadraticCurveTo(
      size / 2 + (rng() - 0.5) * size * 0.5, size / 2 + (rng() - 0.5) * size * 0.5,
      size / 2 + (rng() - 0.5) * size * 0.85, size / 2 + (rng() - 0.5) * size * 0.85
    );
    g.stroke();
  }
  for (let i = 0; i < 260; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 0.75) * size * 0.43;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    const len = 34 + rng() * 22;
    const v = 140 + Math.floor(rng() * 115);
    g.save();
    g.translate(x, y);
    g.rotate(rng() * Math.PI * 2);
    g.strokeStyle = 'rgba(80,70,50,1)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, len * 0.55);
    g.lineTo(0, len * 0.95);
    g.stroke();
    const grad = g.createLinearGradient(-len * 0.3, 0, len * 0.3, 0);
    grad.addColorStop(0, `rgb(${v - 25},${v - 25},${v - 25})`);
    grad.addColorStop(1, `rgb(${v},${v},${v})`);
    g.fillStyle = grad;
    // Oak-ish outline: five overlapping lobes tapering to the tip.
    for (let k = 0; k < 5; k++) {
      const t = k / 4 - 0.5;
      g.beginPath();
      g.ellipse(0, t * len * 0.85, len * (0.3 - Math.abs(t) * 0.22), len * 0.2, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = `rgba(${v - 60},${v - 60},${v - 60},0.9)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, -len * 0.42);
    g.lineTo(0, len * 0.5);
    g.stroke();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let sharedLeafTex = null;

function generate(seed, o) {
  const rng = makeRng(seed);
  const woodParts = [];
  const leafPos = [];
  const leafNrm = [];
  const leafUv = [];
  const leafSway = [];
  const leafPhase = [];
  const leafTint = [];
  const leafAO = [];
  const leafIdx = [];
  const crownCentre = new THREE.Vector3(0, o.trunkLen + o.crownLift, 0);
  let tips = 0;

  const addLeafCard = (centre, size, sway) => {
    const n = centre.clone().sub(crownCentre).normalize();
    n.lerp(UP, 0.3).normalize();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI));
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(size * 0.5);
    const ay = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(size * 0.5);
    const base = leafPos.length / 3;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const phase = rng();
    const tint = rng();
    const ao = centre.clone().sub(crownCentre).length();
    for (const [u, v] of corners) {
      const p = centre.clone().addScaledVector(ax, u).addScaledVector(ay, v);
      leafPos.push(p.x, p.y, p.z);
      leafNrm.push(n.x, n.y, n.z);
      leafUv.push((u + 1) / 2, (v + 1) / 2);
      leafSway.push(sway);
      leafPhase.push(phase);
      leafTint.push(tint);
      leafAO.push(ao);
    }
    leafIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const branch = (start, dir, len, radius, depth) => {
    const segs = depth === 0 ? 6 : depth < 3 ? 4 : 3;
    let p = start.clone();
    let d = dir.clone();
    let r = radius;
    const endR = radius * o.taper;
    for (let s = 0; s < segs; s++) {
      const segLen = len / segs;
      // Gnarl: wander a little each segment, with a slight upward pull.
      const gn = depth === 0 ? o.gnarl * 0.3 : o.gnarl;
      d.add(new THREE.Vector3((rng() - 0.5) * gn, (rng() - 0.3) * gn * 0.6, (rng() - 0.5) * gn)).normalize();
      const r1 = THREE.MathUtils.lerp(radius, endR, (s + 1) / segs);
      const geo = new THREE.CylinderGeometry(r1, r, segLen, depth < 2 ? 16 : depth < 4 ? 9 : 6, 1, true);
      const swayA = Math.pow((depth + s / segs) / (o.depth + 1), 2.0);
      const swayB = Math.pow((depth + (s + 1) / segs) / (o.depth + 1), 2.0);
      const sw = new Float32Array(geo.attributes.position.count);
      for (let i = 0; i < sw.length; i++) sw[i] = geo.attributes.position.getY(i) > 0 ? swayB : swayA;
      geo.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
      const ph = new Float32Array(sw.length).fill(rng());
      geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      const q = new THREE.Quaternion().setFromUnitVectors(UP, d);
      const mid = p.clone().addScaledVector(d, segLen / 2);
      geo.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
      woodParts.push(geo);
      // Side shoots along big limbs fill the crown.
      if (depth >= 1 && depth < o.depth && rng() < o.sideChance) {
        const sd = d.clone().applyAxisAngle(UP, rng() * Math.PI * 2);
        sd.lerp(new THREE.Vector3(sd.x, 0.2, sd.z).normalize(), 0.6).normalize();
        branch(p.clone().addScaledVector(d, segLen * 0.5), sd, len * 0.45, r * 0.45, depth + 2);
      }
      p = p.addScaledVector(d, segLen);
      r = r1;
    }
    if (depth >= o.depth - 1) {
      const sway = Math.pow((depth + 1) / (o.depth + 1), 2.0);
      const cards = depth >= o.depth ? o.leavesPerTip : Math.ceil(o.leavesPerTip * 0.4);
      for (let i = 0; i < cards; i++) {
        const off = new THREE.Vector3(rng() - 0.5, rng() - 0.55, rng() - 0.5).multiplyScalar(o.leafSpread);
        addLeafCard(p.clone().add(off), o.leafSize * (0.7 + rng() * 0.6), sway);
      }
      tips++;
    }
    if (depth >= o.depth) return;
    const kids = depth === 0 ? o.trunkKids : o.children + (rng() < 0.4 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const around = (k / kids) * Math.PI * 2 + (depth === 0 ? rng() * 0.3 : rng() * 0.9);
      const spread = (depth === 0 ? o.trunkSpread : o.spread) * (0.75 + rng() * 0.5);
      const axis = new THREE.Vector3(Math.cos(around), 0, Math.sin(around));
      const perp = new THREE.Vector3().crossVectors(d, axis).normalize();
      const nd = d.clone().applyAxisAngle(perp.lengthSq() > 0 ? perp : axis, spread);
      // Oaks reach outwards more than upwards.
      nd.y = THREE.MathUtils.lerp(nd.y, depth >= 3 ? o.upward - 0.3 : o.upward, 0.25);
      nd.normalize();
      branch(p, nd, len * o.lenDecay * (0.8 + rng() * 0.4), endR, depth + 1);
    }
  };

  branch(new THREE.Vector3(0, -0.4, 0), UP.clone(), o.trunkLen + 0.4, o.trunkRadius, 0);

  // Root flare so the trunk sits into the ground instead of on it.
  const flare = new THREE.CylinderGeometry(o.trunkRadius * 1.05, o.trunkRadius * 1.9, 0.9, 12, 1, true);
  flare.translate(0, 0.0, 0);
  flare.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(flare.attributes.position.count), 1));
  flare.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(flare.attributes.position.count), 1));
  woodParts.push(flare);

  for (const g of woodParts) {
    g.deleteAttribute('uv');
  }
  const wood = mergeGeometries(woodParts.map((g) => g.toNonIndexed()), false);
  wood.computeVertexNormals();
  woodParts.forEach((g) => g.dispose());

  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(leafPos, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(leafNrm, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(leafUv, 2));
  leaves.setAttribute('aSway', new THREE.Float32BufferAttribute(leafSway, 1));
  leaves.setAttribute('aPhase', new THREE.Float32BufferAttribute(leafPhase, 1));
  leaves.setAttribute('aTint', new THREE.Float32BufferAttribute(leafTint, 1));
  let maxAO = 0;
  for (const a of leafAO) maxAO = Math.max(maxAO, a);
  leaves.setAttribute('aAO', new THREE.Float32BufferAttribute(leafAO.map((a) => Math.pow(a / maxAO, 1.4)), 1));
  leaves.setIndex(leafIdx);
  leaves.computeBoundingSphere();
  wood.computeBoundingSphere();
  return { wood, leaves, tips };
}

function windInject(shader, isLeaf) {
  Object.assign(shader.uniforms, windUniforms, treeUniforms);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
      ${WIND_GLSL}
      attribute float aSway;
      attribute float aPhase;
      uniform float uTreeBend;
      uniform float uCanopy;
      ${isLeaf ? 'attribute float aTint; attribute float aAO; varying float vTint; varying float vLeafT; varying float vAO;' : ''}`
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        mat4 wfWM = modelMatrix * instanceMatrix;
      #else
        mat4 wfWM = modelMatrix;
      #endif
      vec3 wfRoot = (wfWM * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      mat3 wfIM = mat3(wfWM);
      float wfG = windGust(wfRoot.xz);
      vec2 wfWD = normalize(uWindDir + 1e-5);
      float wfSteady = uWindStrength * (0.3 + wfG * uGustStrength * 0.8);
      float wfPh = aPhase * 6.2831 + dot(wfRoot.xz, vec2(0.13, 0.07));
      vec3 wfD = vec3(wfWD.x, 0.0, wfWD.y) * wfSteady * 0.9;
      wfD += vec3(sin(uTime * 1.3 + wfPh), 0.0, cos(uTime * 1.05 + wfPh * 1.3)) * 0.35 * (0.25 + uWindStrength) * (0.4 + wfG);
      wfD *= aSway * uTreeBend;
      ${isLeaf ? `
      float wfFl = (0.15 + uWindStrength) * (0.35 + wfG) * 0.05;
      wfD += vec3(sin(uTime * 8.0 + aPhase * 40.0), sin(uTime * 10.5 + aPhase * 23.0), cos(uTime * 7.3 + aPhase * 31.0)) * wfFl;
      vTint = aTint;
      vAO = aAO;
      // Thin the canopy: cards whose tint id is above the canopy fraction are discarded.
      vLeafT = 1.0 - smoothstep(uCanopy - 0.12, uCanopy, aTint);
      ` : ''}
      wfD.y -= length(wfD.xz) * 0.3 * aSway;
      float wfS2 = max(dot(wfIM[0], wfIM[0]), 1e-4);
      transformed += transpose(wfIM) * wfD / wfS2;`
    );
}

function makeWoodMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: '#4a3f35', roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    windInject(s, false);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBark;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBark = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBark;
        float bh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float bn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(bh(i), bh(i + vec2(1, 0)), u.x), mix(bh(i + vec2(0, 1)), bh(i + vec2(1, 1)), u.x), u.y); }`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        float ang = atan(vBark.z, vBark.x);
        float ridges = bn(vec2(ang * 9.0, vBark.y * 1.4)) * 0.6 + bn(vec2(ang * 23.0, vBark.y * 4.0)) * 0.4;
        float moss = smoothstep(0.55, 0.8, bn(vec2(ang * 3.0, vBark.y * 0.8) + 7.0)) * smoothstep(3.0, 0.0, vBark.y);
        vec3 bark = diffuse * (0.55 + ridges * 0.75);
        bark = mix(bark, vec3(0.22, 0.27, 0.12), moss * 0.6);
        vec4 diffuseColor = vec4( bark, opacity );`);
  };
  mat.customProgramCacheKey = () => 'wf-wood';
  return mat;
}

function makeLeafMaterial(tex) {
  // Lambert, not Standard: leaves seen edge-on picked up Fresnel sky reflection and
  // read as pale grey cards, and the diffuse-only model is cheaper on a canopy of cards.
  const mat = new THREE.MeshLambertMaterial({
    map: tex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (s) => {
    windInject(s, true);
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uLeafSummer;
        uniform vec3 uLeafAutumn;
        uniform float uSeason;
        uniform float uTranslucency;
        uniform vec3 uSunViewDir;
        uniform vec3 uSunTint;
        varying float vTint;
        varying float vLeafT;
        varying float vAO;`
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `float turn = smoothstep(vTint * 0.7, vTint * 0.7 + 0.3, uSeason);
        vec3 leafCol = mix(uLeafSummer, uLeafAutumn * mix(0.75, 1.2, fract(vTint * 17.0)), turn);
        leafCol *= 0.8 + fract(vTint * 53.0) * 0.4;
        leafCol *= mix(0.35, 1.15, vAO) * 1.55;
        vec4 diffuseColor = vec4( leafCol, opacity );`
      )
      .replace(
        '#include <alphatest_fragment>',
        `if (vLeafT < 0.5) discard;
        #include <alphatest_fragment>`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float back = pow(max(dot(normalize(-vViewPosition), uSunViewDir), 0.0), 5.0);
        totalEmissiveRadiance += uSunTint * diffuseColor.rgb * back * uTranslucency * 1.4;`
      );
  };
  mat.customProgramCacheKey = () => 'wf-leaf';
  return mat;
}

function makeDepthMaterial(tex, isLeaf) {
  const mat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: isLeaf ? tex : null,
    alphaTest: isLeaf ? 0.5 : 0,
  });
  mat.onBeforeCompile = (s) => {
    windInject(s, isLeaf);
    if (isLeaf) {
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vTint;\nvarying float vLeafT;')
        .replace('#include <alphatest_fragment>', 'if (vLeafT < 0.5) discard;\n#include <alphatest_fragment>');
    }
  };
  mat.customProgramCacheKey = () => (isLeaf ? 'wf-leaf-depth' : 'wf-wood-depth');
  return mat;
}

const OAK = {
  trunkLen: 4.3, trunkRadius: 0.68, crownLift: 3.4, depth: 5, trunkKids: 4, children: 2,
  trunkSpread: 0.95, spread: 0.6, lenDecay: 0.76, taper: 0.6, gnarl: 0.34, upward: 0.42,
  sideChance: 0.45, leavesPerTip: 10, leafSpread: 1.7, leafSize: 1.5,
};

export function buildHeroOak() {
  if (!sharedLeafTex) sharedLeafTex = leafTexture();
  const t = generate(2024, { ...OAK });
  // Scale the branch lengths up: generator works in "trunk units".
  const group = new THREE.Group();
  const wood = new THREE.Mesh(t.wood, makeWoodMaterial());
  wood.castShadow = true;
  wood.receiveShadow = true;
  wood.customDepthMaterial = makeDepthMaterial(sharedLeafTex, false);
  const leaves = new THREE.Mesh(t.leaves, makeLeafMaterial(sharedLeafTex));
  leaves.castShadow = true;
  leaves.receiveShadow = true;
  leaves.customDepthMaterial = makeDepthMaterial(sharedLeafTex, true);
  group.add(wood, leaves);
  const s = 1.15;
  group.scale.setScalar(s);
  group.position.set(0, heightAt(0, 0) - 0.15, 0);
  group.userData.leafGeometry = t.leaves;
  return group;
}

const VARIANTS = [
  { ...OAK, trunkLen: 3.0, trunkRadius: 0.45, depth: 4, trunkKids: 3, leavesPerTip: 7, leafSize: 2.3, leafSpread: 2.0, sideChance: 0.3 },
  { ...OAK, trunkLen: 4.6, trunkRadius: 0.32, depth: 4, trunkKids: 3, trunkSpread: 0.45, spread: 0.45, upward: 0.8, lenDecay: 0.7, leavesPerTip: 6, leafSize: 1.8, leafSpread: 1.5, sideChance: 0.25 },
  { ...OAK, trunkLen: 2.2, trunkRadius: 0.38, depth: 4, trunkKids: 4, trunkSpread: 1.0, spread: 0.7, upward: 0.2, leavesPerTip: 7, leafSize: 2.4, leafSpread: 2.2, sideChance: 0.3 },
];

export function buildBackgroundTrees(quality) {
  if (!sharedLeafTex) sharedLeafTex = leafTexture();
  const total = { low: 50, medium: 90, high: 140, ultra: 200 }[quality] || 90;
  const rng = makeRng(808);
  const placements = [];
  // Hedgerow lines and loose copses, kept clear of the stage around the subject.
  const lines = [
    { a: [-150, -60], b: [40, -120] },
    { a: [60, -110], b: [190, 40] },
    { a: [-200, 80], b: [-60, 150] },
    { a: [90, 120], b: [-30, 190] },
  ];
  while (placements.length < total) {
    let x, z;
    if (rng() < 0.6) {
      const l = lines[Math.floor(rng() * lines.length)];
      const t = rng();
      x = THREE.MathUtils.lerp(l.a[0], l.b[0], t) + (rng() - 0.5) * 14;
      z = THREE.MathUtils.lerp(l.a[1], l.b[1], t) + (rng() - 0.5) * 14;
    } else {
      const a = rng() * Math.PI * 2;
      const r = 70 + rng() * 260;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    if (Math.hypot(x, z) < 48) continue;
    placements.push({ x, z, s: 1.0 + rng() * 0.9, ry: rng() * Math.PI * 2, v: Math.floor(rng() * VARIANTS.length) });
  }

  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  VARIANTS.forEach((o, vi) => {
    const t = generate(300 + vi * 17, o);
    const list = placements.filter((p) => p.v === vi);
    const wood = new THREE.InstancedMesh(t.wood, makeWoodMaterial(), list.length);
    const leaves = new THREE.InstancedMesh(t.leaves, makeLeafMaterial(sharedLeafTex), list.length);
    list.forEach((p, i) => {
      m.compose(
        new THREE.Vector3(p.x, heightAt(p.x, p.z) - 0.2, p.z),
        new THREE.Quaternion().setFromAxisAngle(UP, p.ry),
        new THREE.Vector3(p.s, p.s, p.s)
      );
      wood.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
    });
    wood.castShadow = leaves.castShadow = false;
    wood.receiveShadow = leaves.receiveShadow = true;
    wood.frustumCulled = leaves.frustumCulled = false;
    group.add(wood, leaves);
  });
  return group;
}

export { sharedLeafTex };
export function getLeafTexture() {
  if (!sharedLeafTex) sharedLeafTex = leafTexture();
  return sharedLeafTex;
}
