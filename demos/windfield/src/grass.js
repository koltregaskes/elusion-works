import * as THREE from '../vendor/three/build/three.module.js';
import { heightAt } from './terrain.js';
import { makeRng, makeSimplex, fbm, smoothstep } from './noise.js';
import { windUniforms, WIND_GLSL } from './wind.js';
import { fieldUniforms, FIELD_GLSL } from './field.js';

// Two layers of instanced grass, all bent on the GPU by the shared wind field.
//
//  near patch  A dense square of blades that travels with the camera. Each instance owns
//              a lattice point that repeats every patch-width, so as the camera moves a
//              blade leaving one side reappears on the other at its true world position.
//              Height, rotation and colour are hashed from that world position, so nothing
//              pops or repeats visibly. Wheat ears and wildflower heads ride on a shuffled
//              subset of these stalks.
//  far field   A lighter scatter over the whole field that fills the distance, fading out
//              where the near patch takes over.
//
// Both read the cut mask: a lane the combine has harvested drops to stubble, and the
// windrow behind it lies flat as straw.

export const grassUniforms = {
  uGrassHeight: { value: 0.8 },
  uHeightVar: { value: 0.5 },
  uDryness: { value: 0.1 },
  uSheen: { value: 0.5 },
  uTranslucency: { value: 1 },
  uGrassBase: { value: new THREE.Color() },
  uGrassTip: { value: new THREE.Color() },
  uGrassDry: { value: new THREE.Color() },
  uFlowerAmount: { value: 0.3 },
  uFlowerInstances: { value: 0 },
  uCrop: { value: 0 },
  uEarColor: { value: new THREE.Color('#d9b862') },
  uStubbleColor: { value: new THREE.Color('#b59a5a') },
  uStrawColor: { value: new THREE.Color('#d8bf78') },
  uStrawHeading: { value: 0 },
  uClear0: { value: new THREE.Vector4(0, 0, 1.4, 0) },
  uClear1: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSunViewDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunTint: { value: new THREE.Color() },
  uFieldRadius: { value: 100 },
  uPatch: { value: new THREE.Vector4(0, 0, 52, 26) }, // centre x, centre z, size, radius
};

const BEND_GLSL = /* glsl */ `
${WIND_GLSL}
${FIELD_GLSL}
uniform float uGrassHeight;
uniform float uHeightVar;
uniform vec4 uClear0;
uniform vec4 uClear1;
uniform float uFieldRadius;
uniform vec4 uPatch;
uniform float uCrop;
uniform float uStrawHeading;

float wfHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float clearing(vec2 p) {
  float c = 1.0;
  if (uClear0.z > 0.0) c *= smoothstep(uClear0.z * 0.55, uClear0.z, distance(p, uClear0.xy));
  if (uClear1.z > 0.0) c *= mix(1.0, smoothstep(uClear1.z * 0.4, uClear1.z, distance(p, uClear1.xy)), uClear1.w);
  return c;
}

// World root for a near-patch instance: the lattice point congruent to off * size that
// lies inside the patch around its centre.
vec2 patchRoot(vec2 off) {
  vec2 lo = uPatch.xy - 0.5 * uPatch.z;
  return lo + mod(off * uPatch.z - lo, uPatch.z);
}

// Bends a vertical strip (local x = across, t = 0..1 along) rooted at root.
// flatten lays it down along the windrow. Writes the normal and gust for shading.
vec3 bendBlade(vec4 root, float h, float width, float t, float across, float rnd, float flatten,
               out vec3 nrm, out float gust) {
  float ang = root.w;
  vec2 facing = vec2(cos(ang), sin(ang));
  vec2 side = vec2(-facing.y, facing.x);
  vec2 push = windPush(root.xz, rnd, gust);
  // Crops stand straighter than meadow grass.
  vec2 lean = facing * (0.12 + rnd * 0.32) * (1.0 - 0.75 * uCrop) + push * mix(1.15, 0.8, uCrop);
  float amt = min(length(lean), 1.45);
  vec2 dir = lean / max(length(lean), 1e-4);
  float sa = uStrawHeading + (rnd - 0.5) * 0.9;
  vec2 strawDir = vec2(cos(sa), sin(sa)) * (fract(rnd * 17.0) > 0.5 ? 1.0 : -1.0);
  amt = mix(amt, 1.5, flatten);
  dir = normalize(mix(dir, strawDir, flatten) + 1e-5);
  float bend = amt * pow(t, mix(1.5, 0.6, flatten));
  vec3 p;
  p.xz = root.xz + side * across * width + dir * h * t * sin(bend);
  p.y = root.y + h * t * cos(bend) + flatten * 0.03;
  vec3 T = normalize(vec3(dir.x * sin(bend), cos(bend), dir.y * sin(bend)));
  vec3 W = vec3(side.x, 0.0, side.y);
  vec3 N = normalize(cross(W, T));
  if (N.y < 0.0) N = -N;
  N = normalize(N + W * across * 0.9);
  nrm = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.45));
  return p;
}
`;

// Per-kind preamble: each sets root (xyz + angle), rnd, tuft, baseW and fade.
const ROOT_NEAR = /* glsl */ `
  vec2 rxz = patchRoot(aOff);
  float rnd = wfHash(rxz * 1.37 + 0.5);
  vec4 root = vec4(rxz.x, fieldHeight(rxz) - 0.04, rxz.y, wfHash(rxz * 3.11 + 7.0) * 6.2831);
  float tuft = smoothstep(0.2, 0.85, wf_snoise(rxz * 0.07) * 0.5 + 0.5);
  float baseW = 0.022 + wfHash(rxz * 5.3 + 1.0) * 0.02;
  float dPatch = distance(rxz, uPatch.xy);
  float fade = 1.0 - smoothstep(uPatch.w * 0.72, uPatch.w * 0.94, dPatch);
  fade *= 1.0 - smoothstep(uFieldRadius * 0.86, uFieldRadius, length(rxz));
  float pick = wfHash(rxz * 9.7 + 3.0);
`;

const ROOT_FAR = /* glsl */ `
  vec4 root = iRoot;
  float rnd = iData.z;
  float tuft = iData.x;
  float baseW = iData.y;
  float fade = 1.0 - smoothstep(0.86, 1.0, iData.w);
  fade *= smoothstep(uPatch.w * 0.72, uPatch.w * 0.94, distance(root.xz, uPatch.xy));
  float pick = 1.0;
`;

const SHARED_HEIGHT = /* glsl */ `
  vec2 cut = fieldCut(root.xz);
  float h = uGrassHeight * mix(1.0, 0.45 + tuft * 1.25, uHeightVar * (1.0 - uCrop * 0.8)) * (0.7 + rnd * 0.6) * mix(1.0, 0.82 + rnd * 0.2, uCrop);
  h *= clearing(root.xz) * fade;
  float stub = 0.06 + rnd * 0.08;
  float straw = cut.y;
  float hStanding = h;
  h = mix(h, min(h, stub), cut.x);
  h = mix(h, hStanding * 0.7, straw);
  float flatten = straw;
  float distCam = distance(root.xz, cameraPosition.xz);
`;

function bladeGeometry(segs) {
  const pos = [];
  const idx = [];
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const w = 1 - Math.pow(t, 1.35) * 0.93;
    pos.push(-0.5 * w, t, 0, 0.5 * w, t, 0);
  }
  pos.push(0, 1, 0);
  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const a = (segs - 1) * 2;
  idx.push(a, a + 1, a + 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

// A wheat ear: a tapered spindle along +y (0..1) with a few awns past the tip (aPart 1).
function earGeometry() {
  const pos = [];
  const part = [];
  const idx = [];
  const sides = 5;
  const rings = 5;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const rad = Math.pow(Math.sin(Math.PI * Math.min(0.98, 0.12 + t * 0.86)), 0.7);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      pos.push(Math.cos(a) * rad, t, Math.sin(a) * rad);
      part.push(0);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * sides + s;
      const b = r * sides + ((s + 1) % sides);
      idx.push(a, a + sides, b, b, a + sides, b + sides);
    }
  }
  // Awns: thin slivers fanning up from the top third.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    const base = pos.length / 3;
    const y0 = 0.6 + k * 0.08;
    pos.push(Math.cos(a) * 0.6, y0, Math.sin(a) * 0.6);
    pos.push(Math.cos(a + 0.5) * 0.6, y0 + 0.05, Math.sin(a + 0.5) * 0.6);
    pos.push(Math.cos(a) * 2.2, y0 + 0.9, Math.sin(a) * 2.2);
    part.push(1, 1, 1);
    idx.push(base, base + 1, base + 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((v, i) => (i % 3 === 1 ? 0 : v)), 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

// A flower head: a ten-point star disc with a raised centre.
function flowerHeadGeometry() {
  const pos = [0, 0.25, 0];
  const part = [1];
  const idx = [];
  const petals = 10;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : 0.55;
    pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    part.push(0);
  }
  for (let i = 0; i < petals; i++) idx.push(0, 1 + i, 1 + ((i + 1) % petals));
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

function scatterFar(count, radius, seed) {
  const rng = makeRng(seed);
  const patchNoise = makeSimplex(seed + 11);
  const roots = new Float32Array(count * 4);
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt(rng());
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    roots[i * 4] = x;
    roots[i * 4 + 1] = heightAt(x, z) - 0.04;
    roots[i * 4 + 2] = z;
    roots[i * 4 + 3] = rng() * Math.PI * 2;
    const patch = fbm(patchNoise, x * 0.07, z * 0.07, 3) * 0.5 + 0.5;
    data[i * 4] = smoothstep(0.2, 0.85, patch);
    data[i * 4 + 1] = 0.04 + rng() * 0.03;
    data[i * 4 + 2] = rng();
    data[i * 4 + 3] = r / radius;
  }
  return { roots, data };
}

// Stratified, then shuffled, so any prefix of the buffer is spread evenly over the patch.
function patchOffsets(count, seed) {
  const rng = makeRng(seed);
  const g = Math.ceil(Math.sqrt(count));
  const pts = [];
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      pts.push([(i + rng()) / g, (j + rng()) / g]);
    }
  }
  for (let i = pts.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1));
    [pts[i], pts[k]] = [pts[k], pts[i]];
  }
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) out.set(pts[i], i * 2);
  return out;
}

const COMMON_DECL = /* glsl */ `
  uniform float uDryness;
  uniform float uSheen;
  uniform float uFlowerAmount;
  uniform float uFlowerInstances;
  uniform vec3 uGrassBase;
  uniform vec3 uGrassTip;
  uniform vec3 uGrassDry;
  uniform vec3 uEarColor;
  uniform vec3 uStubbleColor;
  uniform vec3 uStrawColor;
  varying vec3 vGrassCol;
  varying float vT;
  varying float vGust;
`;

function bladeBody(kind) {
  const near = kind === 'near';
  return /* glsl */ `
  ${near ? ROOT_NEAR : ROOT_FAR}
  ${SHARED_HEIGHT}
  ${near ? `
  // Some stalks carry a flower head (see the flower mesh): make those a touch taller.
  float flowerStalk = float(gl_InstanceID) < uFlowerInstances ? step(pick, uFlowerAmount) : 0.0;
  h *= 1.0 + flowerStalk * 0.3 * (1.0 - cut.x);
  baseW *= 1.0 - flowerStalk * 0.55;
  ` : ''}
  float width = baseW * mix(1.0, 0.62, uCrop) * (1.0 + smoothstep(14.0, 60.0, distCam) * 1.8);
  float t = position.y;
  float across = position.x;
  vec3 grassNrm;
  float gust;
  vec3 grassPos = bendBlade(root, h, width, t, across, rnd, flatten, grassNrm, gust);
  vec3 objectNormal = grassNrm;
  vT = t;
  vGust = gust;
  vec3 col = mix(uGrassBase, uGrassTip, smoothstep(0.0, 1.0, t));
  float dryPick = fract(rnd * 7.13 + tuft * 3.1);
  float dryK = clamp((uDryness * 1.15 - dryPick) * 5.0, 0.0, 1.0);
  col = mix(col, uGrassDry * mix(0.55, 1.05, t), dryK);
  col *= 0.85 + fract(rnd * 91.7) * 0.3;
  col *= 1.0 + uSheen * gust * 0.7 * t;
  col *= mix(0.32, 1.0, smoothstep(0.0, 0.55, t));
  col = mix(col, uStubbleColor * (0.8 + rnd * 0.3) * mix(0.6, 1.0, t), cut.x * (1.0 - straw));
  col = mix(col, uStrawColor * (0.8 + rnd * 0.35), straw);
  vGrassCol = col;
  `;
}

function headBody(kind) {
  const ear = kind === 'ear';
  return /* glsl */ `
  ${ROOT_NEAR}
  ${SHARED_HEIGHT}
  ${ear ? `
  float vis = uCrop * (1.0 - cut.x) * (1.0 - straw);
  ` : `
  float vis = step(pick, uFlowerAmount) * (1.0 - cut.x) * (1.0 - straw);
  h *= 1.3;
  `}
  float width = 0.0;
  vec3 nTip, nLow;
  float gust, gLow;
  vec3 tip = bendBlade(root, h, width, 1.0, 0.0, rnd, flatten, nTip, gust);
  vec3 low = bendBlade(root, h, width, 0.93, 0.0, rnd, flatten, nLow, gLow);
  vec3 axis = normalize(tip - low + vec3(0.0, 1e-4, 0.0));
  ${ear ? 'axis = normalize(axis + vec3(0.0, -0.15, 0.0));' : 'axis = normalize(mix(axis, vec3(0.0, 1.0, 0.0), 0.5));'}
  vec3 refV = abs(axis.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 sideV = normalize(cross(axis, refV));
  vec3 otherV = cross(sideV, axis);
  ${ear ? `
  float earLen = (0.07 + rnd * 0.035) * vis;
  float earRad = 0.0105 * vis;
  vec3 grassPos = tip + axis * position.y * earLen + (sideV * position.x + otherV * position.z) * earRad;
  vec3 objectNormal = normalize(sideV * position.x + otherV * position.z + axis * 0.25);
  vec3 col = uEarColor * (0.82 + fract(rnd * 31.0) * 0.3);
  col = mix(col, col * 1.25, aPart);
  vT = 0.75 + position.y * 0.25;
  ` : `
  float size = (0.03 + fract(rnd * 13.1) * 0.028) * vis;
  vec3 grassPos = tip + (sideV * position.x + otherV * position.z) * size + axis * position.y * size;
  vec3 objectNormal = normalize(axis + (sideV * position.x + otherV * position.z) * 0.3);
  // Flowers grow in drifts: colour by position.
  float k = floor(fract((sin(root.x * 0.11) + cos(root.z * 0.09)) * 0.25 + 0.5 + rnd * 0.35) * 5.0);
  vec3 col = k < 1.0 ? vec3(0.78, 0.08, 0.05) : k < 2.0 ? vec3(0.92, 0.9, 0.84) : k < 3.0 ? vec3(0.25, 0.38, 0.85) : k < 4.0 ? vec3(0.95, 0.75, 0.12) : vec3(0.72, 0.42, 0.75);
  if (aPart > 0.5) col = k < 2.0 ? vec3(0.95, 0.75, 0.15) : col * 0.6;
  vT = 1.0;
  `}
  vGust = gust;
  vGrassCol = col;
  `;
}

function makeMaterial(kind) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
  const head = kind === 'ear' || kind === 'flower';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms, grassUniforms, fieldUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${BEND_GLSL}
        ${kind === 'far' ? 'attribute vec4 iRoot; attribute vec4 iData;' : 'attribute vec2 aOff;'}
        ${head ? 'attribute float aPart;' : ''}
        ${COMMON_DECL}`
      )
      .replace('#include <beginnormal_vertex>', head ? headBody(kind) : bladeBody(kind))
      .replace('#include <begin_vertex>', 'vec3 transformed = grassPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTranslucency;
        uniform vec3 uSunViewDir;
        uniform vec3 uSunTint;
        varying vec3 vGrassCol;
        varying float vT;
        varying float vGust;`
      )
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vGrassCol, 1.0 );')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize( vNormal );')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float back = pow(max(dot(normalize(-vViewPosition), uSunViewDir), 0.0), 4.0);
        totalEmissiveRadiance += uSunTint * vGrassCol * uTranslucency * back * vT * vT * 1.15;`
      );
  };
  mat.customProgramCacheKey = () => `windfield-grass-${kind}`;
  return mat;
}

const QUALITY = {
  low: { near: 110000, radius: 20, far: 45000, ears: 0.2, flowers: 0.1 },
  medium: { near: 230000, radius: 24, far: 80000, ears: 0.3, flowers: 0.1 },
  high: { near: 400000, radius: 27, far: 120000, ears: 0.4, flowers: 0.1 },
  ultra: { near: 720000, radius: 32, far: 180000, ears: 0.5, flowers: 0.1 },
};

export function buildGrass(quality) {
  const Q = QUALITY[quality] || QUALITY.medium;
  const fieldRadius = 100;
  grassUniforms.uFieldRadius.value = fieldRadius;
  grassUniforms.uPatch.value.z = Q.radius * 2;
  grassUniforms.uPatch.value.w = Q.radius;

  const group = new THREE.Group();
  const meshes = [];
  const add = (geo, kind, count) => {
    geo.instanceCount = count;
    const m = new THREE.Mesh(geo, makeMaterial(kind));
    m.frustumCulled = false;
    m.receiveShadow = true;
    m.userData.kind = kind;
    group.add(m);
    meshes.push(m);
    return m;
  };

  // Near patch: 6-segment blades, plus ears and flower heads sharing the same offsets.
  const offsets = new THREE.InstancedBufferAttribute(patchOffsets(Q.near, 99), 2);
  const nearGeo = bladeGeometry(6);
  nearGeo.setAttribute('aOff', offsets);
  add(nearGeo, 'near', Q.near);

  const earGeo = earGeometry();
  earGeo.setAttribute('aOff', offsets);
  const ears = add(earGeo, 'ear', Math.round(Q.near * Q.ears));

  const flowerGeo = flowerHeadGeometry();
  flowerGeo.setAttribute('aOff', offsets);
  const flowerCount = Math.round(Q.near * Q.flowers);
  add(flowerGeo, 'flower', flowerCount);
  grassUniforms.uFlowerInstances.value = flowerCount;

  // Far field: 4-segment blades over the whole field.
  const farGeo = bladeGeometry(4);
  const { roots, data } = scatterFar(Q.far, fieldRadius, 7);
  farGeo.setAttribute('iRoot', new THREE.InstancedBufferAttribute(roots, 4));
  farGeo.setAttribute('iData', new THREE.InstancedBufferAttribute(data, 4));
  add(farGeo, 'far', Q.far);

  group.userData.ears = ears;
  group.userData.dispose = () => {
    for (const m of meshes) {
      m.geometry.dispose();
      m.material.dispose();
    }
  };
  return group;
}

// Centre the near patch a little ahead of the camera, so most blades are in view.
const fwd = new THREE.Vector3();
export function updateGrassPatch(camera) {
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() > 1e-6) fwd.normalize();
  const r = grassUniforms.uPatch.value.w;
  grassUniforms.uPatch.value.x = camera.position.x + fwd.x * r * 0.45;
  grassUniforms.uPatch.value.y = camera.position.z + fwd.z * r * 0.45;
}
