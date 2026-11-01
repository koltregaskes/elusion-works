// The study model: a laser-cut canyon block in two halves (Nevada | Arizona),
// cut faces with strata, a glass lake, and the real dam geometry from the field
// lab re-dressed as a white study model with ink outlines. One accent colour
// marks whatever is working right now.
import * as THREE from 'three';
import { terrainHeight, DAM, damSection, elevToY, SPILL } from '../../src/scene/util.js';
import { buildStructures } from '../../src/scene/dam.js';
import { Tracers, Particles } from '../../src/scene/particles.js';
import { ELEV } from '../../src/model/data.js';
import { INK, ACCENT } from './stage.js';
import { addDetails, MAT } from './details.js';

export const BOX = { x: 300, z0: -400, z1: 380, base: -48, step: 9 };
const CELL = 2;

const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Laser-cut terraces: flat treads every STEP metres with short risers.
export function hq(x, z) {
  let h = terrainHeight(x, z);
  // a calmer mesa for the model: compress the rim noise so the sheets read cleanly
  if (h > 236) h = 236 + (h - 236) * 0.3;
  const t = h / BOX.step, L = Math.floor(t), f = t - L;
  return BOX.step * (L + sstep(0.74, 1, f));
}

function ink(mesh, threshold = 30, opacity = 0.55) {
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, threshold), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity }));
  e.userData.ink = true;
  e.raycast = () => {};
  mesh.add(e);
  return e;
}

// ---------------------------------------------------------------------------
const clayVert = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vP; varying vec3 vN;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position; vN = normal;');
};
function clayMaterial(color, cut) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0, side: THREE.FrontSide });
  m.onBeforeCompile = (sh) => {
    clayVert(sh);
    sh.uniforms.uStep = { value: BOX.step };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vP; varying vec3 vN; uniform float uStep;
        float hh(float n){ return fract(sin(n * 91.345) * 47453.21); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float t = vP.y / uStep;
          float lv = floor(t + 0.02);
          diffuseColor.rgb *= 0.95 + 0.06 * hh(lv);
          ${cut ? `
          // cut face: strata lines at every sheet
          float f = abs(fract(t) - 0.5);
          float w = fwidth(t) * 1.2;
          float line = 1.0 - smoothstep(0.5 - w, 0.5, f);
          float major = step(0.5, fract(lv / 3.0 + 0.01)) * 0.0 + (mod(lv, 3.0) < 0.5 ? 1.0 : 0.35);
          float fade = 1.0 - smoothstep(0.25, 0.6, w);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.17, 0.16), line * 0.5 * major * fade);
          diffuseColor.rgb *= 0.93 + 0.07 * hh(lv + 7.0);` : `
          // tread edges: ink where a riser meets the sheet above
          float ny = normalize(vN).y;
          float edge = smoothstep(0.5, 0.72, ny) * (1.0 - smoothstep(0.8, 0.95, ny));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.15, 0.14), edge * 0.7);
          diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.3, 0.9, ny));`}
        }`);
  };
  m.customProgramCacheKey = () => (cut ? 'clay-cut' : 'clay-top');
  return m;
}

function buildHalf(sign) {
  const g = new THREE.Group();
  g.name = sign < 0 ? 'nevada' : 'arizona';
  const x0 = sign < 0 ? -BOX.x : 0, x1 = sign < 0 ? 0 : BOX.x;
  const nx = Math.round((x1 - x0) / CELL) + 1, nz = Math.round((BOX.z1 - BOX.z0) / CELL) + 1;
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * CELL, z = BOX.z0 + j * CELL, k = (j * nx + i) * 3;
    pos[k] = x; pos[k + 1] = hq(x, z); pos[k + 2] = z;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const top = new THREE.Mesh(geo, clayMaterial(0xcfc2ac, false));
  top.castShadow = top.receiveShadow = true;
  top.userData.sys = 'rock';
  g.add(top);

  // cut faces around the half's boundary
  const cutMat = clayMaterial(0xbcae97, true);
  const strip = (pts) => {
    const p = [], ix = [];
    pts.forEach(([x, z], i) => { p.push(x, hq(x, z), z, x, BOX.base, z); if (i) { const a = (i - 1) * 2; ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); sg.setIndex(ix); sg.computeVertexNormals();
    const m = new THREE.Mesh(sg, cutMat); m.castShadow = m.receiveShadow = true; m.material.side = THREE.DoubleSide;
    m.userData.sys = 'rock';
    // ink along the top edge of the cut
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, hq(x, z) + 0.3, z))), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.7 }));
    line.userData.ink = true;
    g.add(m, line);
  };
  const along = (a, b, n, f) => Array.from({ length: n + 1 }, (_, i) => f(a + (b - a) * i / n));
  strip(along(x0, x1, 150, (x) => [x, BOX.z0]));
  strip(along(x1, x0, 150, (x) => [x, BOX.z1]));
  strip(along(BOX.z0, BOX.z1, 450, (z) => [sign < 0 ? x0 : x1, z]));
  strip(along(BOX.z1, BOX.z0, 450, (z) => [sign < 0 ? x1 : x0, z]));
  // bottom plate
  const bot = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 2, BOX.z1 - BOX.z0), new THREE.MeshStandardMaterial({ color: 0xb9ad9a, roughness: 0.9 }));
  bot.position.set((x0 + x1) / 2, BOX.base + 1, (BOX.z0 + BOX.z1) / 2);
  g.add(bot);
  return g;
}

// ---------------------------------------------------------------------------
function glassWater(color, opacity) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.04, metalness: 0, transparent: true, opacity, ior: 1.33, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false });
  return m;
}

export class StudyModel {
  constructor(stage) {
    this.stage = stage;
    const root = new THREE.Group();
    this.root = root;
    stage.pivot.add(root);
    this.uniforms = { uWaterY: { value: 150 }, uRingTop: { value: 210 }, uDamCz: { value: DAM.cz }, uDamR: { value: DAM.R }, uMode: { value: 0 }, uTime: { value: 0 } };

    this.nev = buildHalf(-1); this.ari = buildHalf(1);
    root.add(this.nev, this.ari);

    // structures from the field lab, re-dressed
    const S = buildStructures(this.uniforms);
    this.S = S;
    S.groups.bridge.visible = false;
    const white = () => MAT.shell();
    // panel decals: lift lines every 15 m, column joints every 15 m along the arc
    const dc = document.createElement('canvas'); dc.width = 256; dc.height = 128; const dg = dc.getContext('2d');
    dg.fillStyle = '#ffffff'; dg.fillRect(0, 0, 256, 128);
    dg.fillStyle = 'rgba(22,24,27,0.30)'; dg.fillRect(0, 0, 256, 6); dg.fillRect(0, 0, 5, 128); dg.fillStyle = 'rgba(22,24,27,0.16)'; dg.fillRect(128, 0, 4, 128);
    dg.fillStyle = 'rgba(22,24,27,0.10)'; dg.fillRect(0, 63, 256, 3);
    const dtex = new THREE.CanvasTexture(dc); dtex.wrapS = dtex.wrapT = THREE.RepeatWrapping; dtex.colorSpace = THREE.SRGBColorSpace; dtex.anisotropy = 8;
    const conc = new THREE.MeshPhysicalMaterial({ color: 0xc9c3b8, map: dtex, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4 });
    const graphite = MAT.graphite();
    this.mats = { conc, graphite };
    const dress = (group, sys, matFn, inkTh = 32) => {
      group.traverse((m) => {
        if (!m.isMesh) return;
        m.material = typeof matFn === 'function' ? matFn(m) : matFn;
        m.castShadow = true; m.receiveShadow = true;
        m.userData.sys = m.userData.kind === 'penstock' ? 'penstocks' : sys;
        if (inkTh) ink(m, inkTh, 0.5);
      });
    };
    dress(S.groups.dam, 'dam', (m) => (m.name === 'dam-body' ? conc : white()), 28);
    dress(S.groups.towers, 'towers', white, 40);
    dress(S.groups.spillways, 'spillways', (m) => (S.spill.some((sp) => sp.gates.includes(m)) ? new THREE.MeshPhysicalMaterial({ color: 0x1c1f23, roughness: 0.35, metalness: 0.2, clearcoat: 0.5 }) : white()), 30);
    dress(S.groups.powerhouse, 'powerhouse', (m) => (m.geometry.parameters?.height === 6 ? graphite : white()), 30);
    dress(S.groups.generators, 'powerhouse', (m) => (m.parent && S.ph.gens.some((g) => g.rotor === m.parent) ? MAT.steel() : m.geometry.type === 'TorusGeometry' ? new THREE.MeshStandardMaterial({ color: 0x9fb4c0, roughness: 0.45, metalness: 0.4 }) : new THREE.MeshPhysicalMaterial({ color: 0x1c1f23, roughness: 0.32, metalness: 0.25, clearcoat: 0.6, emissive: new THREE.Color(ACCENT), emissiveIntensity: 0 })), 0);
    for (const g of S.ph.gens) g.mat = g.group.children[0].material;
    const glass = (m) => new THREE.MeshPhysicalMaterial({ color: m.userData.kind === 'diversion' ? 0xc9b89c : m.userData.kind === 'penstock' ? 0x6fb3cc : 0x9cc9d8, roughness: 0.08, transparent: true, opacity: m.userData.kind === 'diversion' ? 0.28 : 0.5, depthWrite: false, clearcoat: 1, side: THREE.DoubleSide });
    dress(S.groups.tunnels, 'tunnels', glass, 0);
    S.groups.tunnels.traverse((m) => { if (m.isMesh && m.userData.kind === 'penstock') m.userData.sys = 'penstocks'; });
    // trim tunnels to the block so they end flush with the cut faces
    const trim = (c) => { const pts = c.getSpacedPoints(240).filter((p) => p.z > BOX.z0 + 1 && p.z < BOX.z1 - 1 && Math.abs(p.x) < BOX.x - 1); return new THREE.CatmullRomCurve3(pts); };
    for (const key of ['spill', 'diversion']) S.curves[key].forEach((cv) => { cv.c = trim(cv.c); });
    let si = 0, di = 0;
    S.groups.tunnels.traverse((m) => {
      if (!m.isMesh) return;
      if (m.userData.kind === 'spill') { m.geometry.dispose(); m.geometry = new THREE.TubeGeometry(S.curves.spill[si++].c, 90, 7.6, 16, false); }
      if (m.userData.kind === 'diversion') { m.geometry.dispose(); m.geometry = new THREE.TubeGeometry(S.curves.diversion[di++].c, 70, 8.5, 14, false); }
    });
    this.details = addDetails(S);
    for (const g of Object.values(S.groups)) root.add(g);
    S.groups.generators.visible = true;
    S.groups.tunnels.visible = true;

    // remember rest transforms for the explode
    this.rest = new Map();
    root.traverse((o) => this.rest.set(o, o.position.clone()));

    // glass lake surface (wave sim from the field lab is too heavy here; a gently animated sheet)
    this.lakeMat = glassWater(0x7fc6dc, 0.55);
    this.lakeMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uniforms.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vO; uniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vO = position;
          transformed.y += sin(position.x * 0.05 + uTime * 0.8) * 0.25 + sin(position.z * 0.07 - uTime * 0.6) * 0.25;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vO;')
        .replace('void main() {', `void main() {
          if (length(vO.xz - vec2(0.0, ${DAM.cz.toFixed(1)})) < ${DAM.R.toFixed(1)} + 1.0 || vO.z > 140.0) discard;
          if (abs(vO.x) > ${(SPILL.lip + 2).toFixed(1)} && vO.z > ${(SPILL.z0 - 12).toFixed(1)} && vO.z < ${(SPILL.z1 + 45).toFixed(1)}) discard;`);
    };
    this.lakeMat.customProgramCacheKey = () => 'study-lake';
    const lg = new THREE.PlaneGeometry(BOX.x * 2, 540, 120, 108); lg.rotateX(-Math.PI / 2); lg.translate(0, 0, BOX.z0 + 270);
    this.lake = new THREE.Mesh(lg, this.lakeMat); this.lake.renderOrder = 3; root.add(this.lake);
    this.river = new THREE.Mesh(new THREE.PlaneGeometry(BOX.x * 2, BOX.z1 - 60), glassWater(0x86cddd, 0.6));
    this.river.rotation.x = -Math.PI / 2; this.river.position.z = (60 + BOX.z1) / 2; this.river.renderOrder = 3; root.add(this.river);
    this.lakeFace = new THREE.Mesh(new THREE.BufferGeometry(), this.faceMaterial());
    this.riverFace = new THREE.Mesh(new THREE.BufferGeometry(), this.faceMaterial());
    this.lakeFace.renderOrder = this.riverFace.renderOrder = 4;
    root.add(this.lakeFace, this.riverFace);
    this.faceLevels = [null, null];

    // flow: penstock tracers in the accent, spill tracers white
    this.pen = new Tracers(S.curves.penstock.map((p) => p.c), 70, ACCENT, 12);
    this.spillT = new Tracers(S.curves.spill.map((p) => p.c), 80, 0x2f8fb0, 14);
    for (const t of [this.pen, this.spillT]) { t.points.material.blending = THREE.NormalBlending; t.points.material.opacity = 1; t.points.renderOrder = 8; }
    root.add(this.pen.points, this.spillT.points);
    this.spray = new Particles(3000);
    root.add(this.spray.points);

    this.buildCaps();
    this.e = 0; this.ev = 0; this.eTarget = 0;
    this.focus = null; this.mode = 'solid';
    this.collect();
  }

  faceMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { uTop: { value: 150 } },
      vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying float vY; uniform float uTop;
        void main(){ float d = clamp((uTop - vY) / 200.0, 0.0, 1.0);
          vec3 c = mix(vec3(0.62, 0.86, 0.92), vec3(0.10, 0.42, 0.55), pow(d, 0.7));
          float band = smoothstep(0.92, 1.0, fract((uTop - vY) / 15.24)) * 0.18;
          gl_FragColor = vec4(c + band, 0.72); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
  }

  rebuildFace(mesh, z, level, k) {
    if (this.faceLevels[k] !== null && Math.abs(this.faceLevels[k] - level) < 0.4) return;
    this.faceLevels[k] = level;
    const pts = [], ix = [];
    let i = 0;
    for (let x = -BOX.x; x <= BOX.x; x += 3) {
      const b = hq(x, z);
      const top = Math.max(b, level);
      pts.push(x, top, z, x, b, z);
      if (i) { const a = (i - 1) * 2; ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      i++;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setIndex(ix);
    mesh.geometry.dispose(); mesh.geometry = g;
    mesh.material.uniforms.uTop.value = level;
  }

  buildCaps() {
    // section through the crown cantilever, used in cut mode
    const sh = new THREE.Shape();
    const N = 40, prof = [];
    for (let j = 0; j <= N; j++) { const y = DAM.crestY * j / N; const { t, up } = damSection(y); const z0 = DAM.cz - (DAM.R - up); prof.push([z0, y, z0 + t]); }
    sh.moveTo(prof[0][0], 0);
    for (const [z0, y] of prof) sh.lineTo(z0, y);
    for (let j = N; j >= 0; j--) sh.lineTo(prof[j][2], prof[j][1]);
    for (const y of [10, 60, 110, 160, 200]) {
      const z0 = DAM.cz - (DAM.R - damSection(y).up) + 6, h = new THREE.Path();
      h.moveTo(z0, y); h.lineTo(z0 + 3, y); h.lineTo(z0 + 3, y + 3); h.lineTo(z0, y + 3); h.lineTo(z0, y); sh.holes.push(h);
    }
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#ece6da'; g.fillRect(0, 0, 64, 64); g.strokeStyle = 'rgba(29,32,36,.55)'; g.lineWidth = 1.5;
    for (let i = -64; i < 128; i += 10) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.ShapeGeometry(sh);
    const p = geo.attributes.position.array, uv = []; for (let i = 0; i < p.length; i += 3) uv.push(p[i] * 0.12, p[i + 1] * 0.12);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.cap = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    this.cap.rotation.y = -Math.PI / 2; this.cap.position.x = -0.05; this.cap.visible = false;
    const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([...prof.map(([z, y]) => new THREE.Vector2(z, y)), ...prof.slice().reverse().map(([, y, z]) => new THREE.Vector2(z, y))].map((v) => new THREE.Vector3(v.x, v.y, 0.1))), new THREE.LineBasicMaterial({ color: INK }));
    this.cap.add(outline);
    this.root.add(this.cap);
    this.waterCap = new THREE.Mesh(new THREE.BufferGeometry(), this.faceMaterial());
    this.waterCap.rotation.y = -Math.PI / 2; this.waterCap.position.x = -0.1; this.waterCap.visible = false; this.waterCap.renderOrder = 5;
    this.root.add(this.waterCap);
    this.capLevel = null;
    this.clip = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  }

  collect() {
    this.meshes = [];
    this.root.traverse((m) => {
      if (!(m.isMesh || m.isLine)) return;
      if (m === this.cap || m.parent === this.cap) return;
      const mat = m.material;
      if (!mat.userData.orig) mat.userData.orig = { opacity: mat.opacity, transparent: mat.transparent, depthWrite: mat.depthWrite, color: mat.color ? mat.color.clone() : null };
      let sys = m.userData.sys;
      if (!sys && m.parent) sys = m.parent.userData.sys;
      if (!sys) { let o = m; while (o && !sys) { if (o === this.nev || o === this.ari) sys = 'rock'; else if (o.name && this.S.groups[o.name]) sys = o.name === 'generators' ? 'powerhouse' : o.name; o = o.parent; } }
      m.userData.sys = sys;
      this.meshes.push(m);
    });
  }

  // ------------------------------------------------------------------------
  setMode(mode) {
    this.mode = mode;
    this.applyLook();
  }
  setFocus(sys) { this.focus = sys; this.applyLook(); }

  applyLook() {
    const glass = this.mode === 'glass', cut = this.mode === 'cut';
    const planes = cut ? [this.clipWorld()] : [];
    for (const m of this.meshes) {
      const mat = m.material, o = mat.userData.orig;
      let op = o.opacity, tr = o.transparent, dw = o.depthWrite;
      const sys = m.userData.sys;
      if (glass && (sys === 'rock' || sys === 'dam' || sys === 'powerhouse') && !(m.parent && this.S.ph.gens.some((g) => g.group === m.parent || g.rotor === m.parent))) {
        op = sys === 'rock' ? (m.isLine ? 0.25 : 0.14) : 0.3; tr = true; dw = false;
      }
      if (this.focus && sys !== this.focus && !(this.focus === 'penstocks' && sys === 'tunnels' && false)) {
        const keepGen = this.focus === 'penstocks' && m.parent && this.S.ph.gens.some((g) => g.group === m.parent || g.rotor === m.parent);
        if (!keepGen) { op = Math.min(op, m.isLine ? 0.12 : sys === 'rock' ? 0.16 : 0.1); tr = true; dw = false; }
      }
      mat.opacity = op; mat.transparent = tr; mat.depthWrite = dw;
      if (m.isLine && mat.userData.orig.color) mat.color.copy(this.focus && sys === this.focus ? new THREE.Color(ACCENT) : mat.userData.orig.color);
      if ('clippingPlanes' in mat) { mat.clippingPlanes = planes; }
      mat.needsUpdate = true;
    }
    this.cap.visible = cut;
    this.waterCap.visible = cut;
    // GTAO renders its own normal pass: it must be cut the same way or it shades what is not drawn
    if (this.stage.gtao?.normalMaterial) { this.stage.gtao.normalMaterial.clippingPlanes = planes; this.stage.gtao.normalMaterial.needsUpdate = true; }
    // the section is a flat diagram: ambient occlusion only adds artefacts across the open cut
    if (this.stage.gtao) this.stage.gtao.enabled = !cut && this.stage.quality === 2;
    // the Nevada half lies wholly on the cut side; drawing it would only fight the Arizona cut face
    this.nev.visible = !cut;
    this.pen.points.visible = true;
  }

  clipWorld() { return this.clip; }

  explode(on) { this.eTarget = on ? 1 : 0; }

  // ------------------------------------------------------------------------
  update(st, out, dt, time) {
    this.uniforms.uTime.value = time;
    // explode spring (slight overshoot on the way back: "snaps together")
    const k = 34, c = 7.2;
    this.ev += ((this.eTarget - this.e) * k - this.ev * c) * dt;
    this.e += this.ev * dt;
    const e = this.e;
    const R = this.rest;
    this.nev.position.set(-210 * e, -26 * e, 0);
    this.ari.position.set(210 * e, -26 * e, 0);
    const G = this.S.groups;
    G.dam.position.y = R.get(G.dam).y + 70 * e;
    G.towers.position.y = 34 * e;
    G.spillways.position.y = 24 * e;
    G.generators.position.y = 22 * e;
    G.tunnels.position.y = 0;
    for (const m of G.powerhouse.children) {
      const r = R.get(m); const s = Math.sign(r.x) || 1;
      m.position.x = r.x + s * 30 * e;
      m.position.y = r.y + (r.y > 85 ? 46 * e : 0);
    }
    const waterOp = Math.max(0, 1 - e * 1.6);
    this.lake.visible = this.river.visible = this.lakeFace.visible = this.riverFace.visible = waterOp > 0.02 && this.mode !== 'cut-hide';
    this.lakeMat.opacity = 0.55 * waterOp * (this.focus && this.focus !== 'lake' ? 0.35 : 1);
    this.river.material.opacity = 0.6 * waterOp;
    this.lakeFace.material.opacity = this.riverFace.material.opacity = waterOp;

    // water levels from the model
    const wy = elevToY(st.lake), ty = elevToY(out.tail);
    this.lake.position.y = wy;
    this.river.position.y = ty;
    this.rebuildFace(this.lakeFace, BOX.z0 + 0.2, wy, 0);
    this.rebuildFace(this.riverFace, BOX.z1 - 0.2, ty, 1);

    // drum gates and the accent on whatever is working
    const crestY = elevToY(ELEV.spillCrest);
    const spilling = out.spillQ > 1;
    for (const sp of this.S.spill) for (const g of sp.gates) {
      g.position.y = crestY - 2.44 + 4.88 * st.drum;
      g.material.color.set(spilling ? ACCENT : 0x1c1f23);
      g.material.emissive = g.material.emissive || new THREE.Color();
      g.material.emissive.set(spilling ? ACCENT : 0x000000); g.material.emissiveIntensity = spilling ? 0.25 : 0;
    }
    for (const g of this.S.ph.gens) {
      const u = st.units.find((uu) => uu.id === g.id);
      g.rotor.rotation.y += ((u?.rpm || 0) / 60) * Math.PI * 2 * dt / 12;
      g.mat.emissiveIntensity = Math.min(0.28, (u?.mw || 0) / 400);
    }
    let sideQ = { '-1': 0, '1': 0 };
    for (const u of st.units) sideQ[u.id[0] === 'N' ? '-1' : '1'] += u.q || 0;
    this.S.curves.penstock.forEach((p, i) => { this.pen.speed[i] = sideQ[String(p.s)] / 2 / 3000 * 0.12; });
    this.spillT.speed.fill(spilling ? 0.08 + Math.min(0.12, out.spillQ / 2e6) : 0);
    this.pen.update(dt); this.spillT.update(dt);

    if (spilling && waterOp > 0.2) {
      for (const sp of this.S.spill) for (let i = 0; i < 6; i++) {
        const z = SPILL.z0 + 10 + Math.random() * (SPILL.z1 - SPILL.z0 - 20);
        this.spray.emit(sp.x + sp.s * 3, crestY + 4.88 * st.drum + 1 + 24 * e, z, sp.s * (5 + Math.random() * 5), 1, 0, { life: 1.3, size: 2.5, floor: crestY - 16, drag: 0.3, color: [0.55, 0.8, 0.9] });
      }
    }
    this.spray.update(dt);

    if (this.mode === 'cut' && (this.capLevel === null || Math.abs(this.capLevel - wy) > 0.4)) {
      this.capLevel = wy;
      const zDam = DAM.cz - (DAM.R - damSection(wy).up);
      const pts = [], ix = []; let i = 0;
      for (let z = BOX.z0; z <= zDam; z += 4) {
        const b = Math.min(wy, hq(0.5, z));
        pts.push(z, wy, 0, z, b, 0);
        if (i) { const a = (i - 1) * 2; ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        i++;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setIndex(ix);
      this.waterCap.geometry.dispose(); this.waterCap.geometry = g; this.waterCap.material.uniforms.uTop.value = wy;
    }
    // keep the clip plane in world space as the turntable turns
    if (this.mode === 'cut') { this.clip.set(new THREE.Vector3(1, 0, 0), 0.5).applyMatrix4(this.root.matrixWorld); }
  }
}
