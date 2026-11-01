// Lake Mead surface as a 2.5D height-field wave simulation (reflects off the
// canyon walls and the dam), a static far-lake plane, and the flowing river below.

import * as THREE from 'three';
import { DAM, terrainHeight, EXTENT, damSection, SPILL } from './util.js';
import { rippleNormal } from './textures.js';

const injectDamCut = (mat, uniforms, extra = '') => {
  // three.js caches programs by onBeforeCompile source; the near and far lake differ only in `extra`.
  mat.customProgramCacheKey = () => `lake:${extra}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDamCz = uniforms.uDamCz; sh.uniforms.uDamR = uniforms.uDamR; sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos2;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos2 = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos2; uniform float uDamCz; uniform float uDamR; uniform float uTime;')
      .replace('void main() {', `void main() {
        if (length(vWPos2.xz - vec2(0.0, uDamCz)) < uDamR || vWPos2.z > 150.0) discard;
        // the spillway channels sit behind the drum gates: lake water never fills them directly
        if (abs(vWPos2.x) > ${(SPILL.lip + 2).toFixed(1)} && abs(vWPos2.x) < ${(SPILL.lip + 60).toFixed(1)} && vWPos2.z > ${(SPILL.z0 - 12).toFixed(1)} && vWPos2.z < ${(SPILL.z1 + 45).toFixed(1)}) discard;
        ${extra}`);
  };
};

export class Lake {
  constructor(uniforms, envMap) {
    this.u = uniforms;
    this.x0 = -430; this.x1 = 430; this.z0 = -980; this.z1 = 120;
    this.cell = 5;
    this.nx = Math.round((this.x1 - this.x0) / this.cell) + 1;
    this.nz = Math.round((this.z1 - this.z0) / this.cell) + 1;
    const N = this.nx * this.nz;
    this.h = new Float32Array(N); this.v = new Float32Array(N);
    this.ground = new Float32Array(N); this.wall = new Uint8Array(N);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const x = this.x0 + i * this.cell, z = this.z0 + j * this.cell;
      this.ground[j * this.nx + i] = terrainHeight(x, z);
    }
    this.level = -1;

    const ripple = rippleNormal();
    ripple.repeat.set(26, 34);
    this.ripple = ripple;
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x0b4650, roughness: 0.06, metalness: 0, ior: 1.333, envMap, envMapIntensity: 1.1,
      normalMap: ripple, normalScale: new THREE.Vector2(0.25, 0.25), transparent: true, opacity: 0.9,
      specularIntensity: 1, clearcoat: 0.3, clearcoatRoughness: 0.1,
    });
    injectDamCut(mat, uniforms);
    this.mat = mat;
    const geo = new THREE.PlaneGeometry(this.x1 - this.x0, this.z1 - this.z0, this.nx - 1, this.nz - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate((this.x0 + this.x1) / 2, 0, (this.z0 + this.z1) / 2);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'lake';
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;

    const farMat = mat.clone();
    farMat.normalMap = ripple;
    injectDamCut(farMat, uniforms, `if (vWPos2.x > ${this.x0 + 2}.0 && vWPos2.x < ${this.x1 - 2}.0 && vWPos2.z > ${this.z0 + 2}.0 && vWPos2.z < ${this.z1 - 2}.0) discard;`);
    const far = new THREE.Mesh(new THREE.PlaneGeometry(EXTENT.x1 - EXTENT.x0, EXTENT.z1 - EXTENT.z0), farMat);
    far.rotation.x = -Math.PI / 2;
    far.position.set((EXTENT.x0 + EXTENT.x1) / 2, 0, (EXTENT.z0 + EXTENT.z1) / 2);
    far.renderOrder = 1;
    this.far = far;
    this.farMat = farMat;
    this.acc = 0;
    this.time = 0;
    this.sinks = [];
  }

  setLevel(y) {
    this.mesh.position.y = y;
    this.far.position.y = y - 0.02;
    if (Math.abs(y - this.level) < 0.4) return;
    this.level = y;
    const { nx, nz, cell } = this;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = this.x0 + i * cell, z = this.z0 + j * cell;
      const r = DAM.R - damSection(y).up;
      const inDam = Math.hypot(x, z - DAM.cz) < r + 1;
      const w = this.ground[k] > y + 0.3 || inDam ? 1 : 0;
      this.wall[k] = w;
      if (w) { this.h[k] = 0; this.v[k] = 0; }
    }
  }

  disturb(x, z, radius, amount) {
    const { nx, nz, cell } = this;
    const ci = (x - this.x0) / cell, cj = (z - this.z0) / cell, rc = radius / cell;
    const i0 = Math.max(1, Math.floor(ci - rc * 2)), i1 = Math.min(nx - 2, Math.ceil(ci + rc * 2));
    const j0 = Math.max(1, Math.floor(cj - rc * 2)), j1 = Math.min(nz - 2, Math.ceil(cj + rc * 2));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * nx + i;
      if (this.wall[k]) continue;
      const d2 = ((i - ci) ** 2 + (j - cj) ** 2) / (rc * rc);
      this.h[k] -= amount * Math.exp(-d2);
    }
  }

  isWater(x, z) {
    const i = Math.round((x - this.x0) / this.cell), j = Math.round((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return false;
    return !this.wall[j * this.nx + i];
  }

  step() {
    const { nx, nz, h, v, wall } = this;
    const c = 0.22, damp = 0.996;
    // intake dimples: pinned toward a fixed depression, so they never drain the lake
    for (const s of this.sinks) {
      const ci = Math.round((s.x - this.x0) / this.cell), cj = Math.round((s.z - this.z0) / this.cell), rc = Math.ceil(s.r / this.cell) * 2;
      for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
        if (i < 1 || j < 1 || i >= nx - 1 || j >= nz - 1) continue;
        const k = j * nx + i; if (wall[k]) continue;
        const d2 = ((i - ci) ** 2 + (j - cj) ** 2) * this.cell * this.cell / (s.r * s.r);
        const target = -s.a * Math.exp(-d2);
        h[k] += (target - h[k]) * 0.04;
      }
    }
    for (let j = 1; j < nz - 1; j++) {
      const row = j * nx;
      for (let i = 1; i < nx - 1; i++) {
        const k = row + i;
        if (wall[k]) continue;
        const hk = h[k];
        const l = wall[k - 1] ? hk : h[k - 1];
        const r = wall[k + 1] ? hk : h[k + 1];
        const u = wall[k - nx] ? hk : h[k - nx];
        const d = wall[k + nx] ? hk : h[k + nx];
        v[k] = (v[k] + (l + r + u + d - 4 * hk) * c) * damp;
      }
    }
    for (let k = 0; k < h.length; k++) h[k] += v[k];
    // keep the mean level at zero so splashes never drift the lake up or down
    if ((this.stepN = (this.stepN || 0) + 1) % 30 === 0) {
      let sum = 0, n = 0;
      for (let k = 0; k < h.length; k++) if (!wall[k]) { sum += h[k]; n++; }
      const m = n ? sum / n : 0;
      if (Math.abs(m) > 1e-4) for (let k = 0; k < h.length; k++) if (!wall[k]) h[k] -= m;
    }
    for (let k = 0; k < h.length; k++) if (!(h[k] > -50 && h[k] < 50)) { h[k] = 0; v[k] = 0; }
    // absorbing border
    for (let i = 0; i < nx; i++) { h[i] *= 0.8; h[(nz - 1) * nx + i] *= 0.8; h[nx + i] *= 0.92; }
    for (let j = 0; j < nz; j++) { h[j * nx] *= 0.8; h[j * nx + nx - 1] *= 0.8; h[j * nx + 1] *= 0.92; h[j * nx + nx - 2] *= 0.92; }
  }

  update(dt) {
    this.time += dt;
    this.ripple.offset.set(this.time * 0.004, this.time * 0.006);
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc > 1 / 60 && steps < 3) { this.step(); this.acc -= 1 / 60; steps++; }
    if (!steps) return;
    // gentle ambient life
    if (Math.random() < 0.08) {
      const x = this.x0 + Math.random() * (this.x1 - this.x0), z = this.z0 + Math.random() * (this.z1 - this.z0 - 200);
      if (this.isWater(x, z)) this.disturb(x, z, 8, 0.12);
    }
    const pos = this.geo.attributes.position, nrm = this.geo.attributes.normal;
    const { nx, nz, h, cell } = this;
    const pa = pos.array, na = nrm.array;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pa[k * 3 + 1] = h[k];
      const hl = h[j * nx + Math.max(0, i - 1)], hr = h[j * nx + Math.min(nx - 1, i + 1)];
      const hu = h[Math.max(0, j - 1) * nx + i], hd = h[Math.min(nz - 1, j + 1) * nx + i];
      let x = (hl - hr), y = 2 * cell, z = (hu - hd);
      const l = Math.hypot(x, y, z);
      na[k * 3] = x / l; na[k * 3 + 1] = y / l; na[k * 3 + 2] = z / l;
    }
    pos.needsUpdate = true; nrm.needsUpdate = true;
  }
}

export class River {
  constructor(uniforms, envMap) {
    const ripple = rippleNormal(256);
    ripple.repeat.set(10, 40);
    this.ripple = ripple;
    this.mat = new THREE.MeshPhysicalMaterial({
      color: 0x1f5a4f, roughness: 0.12, envMap, envMapIntensity: 0.9, normalMap: ripple,
      normalScale: new THREE.Vector2(0.6, 0.6), transparent: true, opacity: 0.93, ior: 1.333,
    });
    const g = new THREE.PlaneGeometry(700, 1110, 1, 1);
    g.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.position.set(0, 42, 40 + 555);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'river';
    this.t = 0;
    this.flow = 0.2;
  }
  setLevel(y) { this.mesh.position.y = y; }
  update(dt, totalQ) {
    const target = 0.02 + Math.min(1.5, totalQ / 30000) * 0.08;
    this.flow += (target - this.flow) * Math.min(1, dt);
    this.t += dt * this.flow;
    this.ripple.offset.set(Math.sin(this.t * 0.7) * 0.02, -this.t);
    const rough = Math.min(1, totalQ / 80000);
    this.mat.normalScale.set(0.5 + rough * 0.9, 0.5 + rough * 0.9);
  }
}
