import * as THREE from '../vendor/three/build/three.module.js';
import { heightAt } from './terrain.js';
import { makeRng, makeSimplex, fbm, smoothstep } from './noise.js';
import { windUniforms, WIND_GLSL } from './wind.js';

// Instanced grass. Every blade is one instance of a 5-segment tapered strip; all of the
// bending, colouring and gust sheen happens in the vertex shader, so the CPU does nothing
// per frame except bump the time uniform.

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
  uClear0: { value: new THREE.Vector4(0, 0, 1.4, 0) },
  uClear1: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSunViewDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunTint: { value: new THREE.Color() },
  uFieldRadius: { value: 70 },
};

const BEND_GLSL = /* glsl */ `
${WIND_GLSL}
uniform float uGrassHeight;
uniform float uHeightVar;
uniform vec4 uClear0;
uniform vec4 uClear1;
uniform float uFieldRadius;

float clearing(vec2 p) {
  float c = 1.0;
  if (uClear0.z > 0.0) c *= smoothstep(uClear0.z * 0.55, uClear0.z, distance(p, uClear0.xy));
  if (uClear1.z > 0.0) c *= mix(1.0, smoothstep(uClear1.z * 0.4, uClear1.z, distance(p, uClear1.xy)), uClear1.w);
  return c;
}

// Bends a vertical strip (local x = across, t = 0..1 along) rooted at root.
// Returns world position; writes the surface normal and gust for shading.
vec3 bendBlade(vec4 root, float h, float width, float t, float across, float rnd,
               out vec3 nrm, out float gust) {
  float ang = root.w;
  vec2 facing = vec2(cos(ang), sin(ang));
  vec2 side = vec2(-facing.y, facing.x);
  vec2 push = windPush(root.xz, rnd, gust);
  vec2 lean = facing * (0.12 + rnd * 0.32) + push * 1.15;
  float amt = min(length(lean), 1.45);
  vec2 dir = lean / max(length(lean), 1e-4);
  float bend = amt * pow(t, 1.5);
  vec3 p;
  p.xz = root.xz + side * across * width + dir * h * t * sin(bend);
  p.y = root.y + h * t * cos(bend);
  // Tangent along the blade and the across vector give the face normal.
  vec3 T = normalize(vec3(dir.x * sin(bend), cos(bend), dir.y * sin(bend)));
  vec3 W = vec3(side.x, 0.0, side.y);
  vec3 N = normalize(cross(W, T));
  if (N.y < 0.0) N = -N;
  // Fake a rounded blade and lean the normal towards the sky so the field reads soft.
  N = normalize(N + W * across * 0.9);
  nrm = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.45));
  return p;
}
`;

function bladeGeometry() {
  const segs = 5;
  const pos = [];
  const idx = [];
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const w = 1 - Math.pow(t, 1.4) * 0.92;
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

function flowerGeometry() {
  // A stem strip (part 0) plus a six-petal disc head (part 1).
  const pos = [];
  const part = [];
  const idx = [];
  const segs = 3;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pos.push(-0.5, t, 0, 0.5, t, 0);
    part.push(0, 0);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const c = pos.length / 3;
  pos.push(0, 1, 0);
  part.push(1);
  const petals = 10;
  for (let i = 0; i < petals; i++) {
    const ang = (i / petals) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : 0.62;
    pos.push(Math.cos(ang) * r, 1, Math.sin(ang) * r);
    part.push(1);
  }
  for (let i = 0; i < petals; i++) {
    idx.push(c, c + 1 + i, c + 1 + ((i + 1) % petals));
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

function scatter(count, radius, seed) {
  const rng = makeRng(seed);
  const patchNoise = makeSimplex(seed + 11);
  const roots = new Float32Array(count * 4);
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = radius * Math.pow(rng(), 0.58);
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    roots[i * 4] = x;
    roots[i * 4 + 1] = heightAt(x, z) - 0.02;
    roots[i * 4 + 2] = z;
    roots[i * 4 + 3] = rng() * Math.PI * 2;
    const patch = fbm(patchNoise, x * 0.07, z * 0.07, 3) * 0.5 + 0.5;
    data[i * 4] = smoothstep(0.2, 0.85, patch); // tall tuft mask
    data[i * 4 + 1] = 0.04 + rng() * 0.03; // width
    data[i * 4 + 2] = rng(); // random
    data[i * 4 + 3] = r / radius; // normalised radius, for edge fade
  }
  return { roots, data };
}

function makeMaterial(kind) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
  const isFlower = kind === 'flower';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms, grassUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${BEND_GLSL}
        attribute vec4 iRoot;
        attribute vec4 iData;
        ${isFlower ? 'attribute float aPart; attribute vec3 iColor;' : ''}
        uniform float uDryness;
        uniform float uSheen;
        uniform float uFlowerAmount;
        uniform vec3 uGrassBase;
        uniform vec3 uGrassTip;
        uniform vec3 uGrassDry;
        varying vec3 vGrassCol;
        varying float vT;
        varying float vGust;`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `float rnd = iData.z;
        float tuft = iData.x;
        float h = uGrassHeight * mix(1.0, 0.45 + tuft * 1.25, uHeightVar) * (0.7 + rnd * 0.6);
        h *= clearing(iRoot.xz);
        h *= 1.0 - smoothstep(0.86, 1.0, iData.w);
        float distCam = distance(iRoot.xz, cameraPosition.xz);
        float width = iData.y * (1.0 + smoothstep(12.0, 55.0, distCam) * 1.8);
        float t = position.y;
        float across = position.x;
        ${isFlower ? `
        float show = step(rnd, uFlowerAmount);
        h *= (1.05 + fract(rnd * 31.7) * 0.35) * show;
        width = 0.012;
        ` : ''}
        vec3 grassNrm;
        float gust;
        vec3 grassPos = bendBlade(iRoot, h, width, t, across, rnd, grassNrm, gust);
        ${isFlower ? `
        if (aPart > 0.5) {
          float headSize = (0.065 + fract(rnd * 13.1) * 0.055) * show;
          // Head sits on the stem tip, tilted with the wind.
          vec3 nTip; float gTip;
          vec3 tip = bendBlade(iRoot, h, width, 1.0, 0.0, rnd, nTip, gTip);
          grassPos = tip + vec3(position.x, 0.0, position.z) * headSize;
          grassNrm = vec3(0.0, 1.0, 0.0);
        }
        ` : ''}
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
        ${isFlower ? 'if (aPart > 0.5) col = iColor; else col = uGrassBase * 1.2;' : ''}
        vGrassCol = col;`
      )
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
  mat.customProgramCacheKey = () => `windfield-${kind}`;
  return mat;
}

export function buildGrass(quality) {
  const counts = { low: 95000, medium: 180000, high: 320000, ultra: 560000 };
  const radius = { low: 52, medium: 62, high: 72, ultra: 82 }[quality] || 62;
  const count = counts[quality] || counts.medium;
  grassUniforms.uFieldRadius.value = radius;

  const group = new THREE.Group();

  const bladeGeo = bladeGeometry();
  const { roots, data } = scatter(count, radius, 99);
  bladeGeo.setAttribute('iRoot', new THREE.InstancedBufferAttribute(roots, 4));
  bladeGeo.setAttribute('iData', new THREE.InstancedBufferAttribute(data, 4));
  bladeGeo.instanceCount = count;
  const blades = new THREE.Mesh(bladeGeo, makeMaterial('blade'));
  blades.frustumCulled = false;
  blades.receiveShadow = true;
  group.add(blades);

  const flowerCount = Math.round(count * 0.06);
  const flowerGeo = flowerGeometry();
  const f = scatter(flowerCount, radius * 0.92, 501);
  const fc = new Float32Array(flowerCount * 3);
  const palette = [
    [0.78, 0.08, 0.05], // poppy
    [0.92, 0.9, 0.84], // ox-eye daisy
    [0.25, 0.38, 0.85], // cornflower
    [0.95, 0.75, 0.12], // buttercup
    [0.72, 0.42, 0.75], // knapweed
  ];
  const rng = makeRng(77);
  for (let i = 0; i < flowerCount; i++) {
    // Flowers grow in drifts, so pick colour by position rather than pure chance.
    const x = f.roots[i * 4];
    const z = f.roots[i * 4 + 2];
    const k = Math.floor(((Math.sin(x * 0.11) + Math.cos(z * 0.09)) * 0.25 + 0.5 + rng() * 0.35) * palette.length) % palette.length;
    fc.set(palette[k], i * 3);
  }
  flowerGeo.setAttribute('iRoot', new THREE.InstancedBufferAttribute(f.roots, 4));
  flowerGeo.setAttribute('iData', new THREE.InstancedBufferAttribute(f.data, 4));
  flowerGeo.setAttribute('iColor', new THREE.InstancedBufferAttribute(fc, 3));
  flowerGeo.instanceCount = flowerCount;
  const flowers = new THREE.Mesh(flowerGeo, makeMaterial('flower'));
  flowers.frustumCulled = false;
  flowers.receiveShadow = true;
  group.add(flowers);

  group.userData.dispose = () => {
    bladeGeo.dispose();
    flowerGeo.dispose();
    blades.material.dispose();
    flowers.material.dispose();
  };
  return group;
}
