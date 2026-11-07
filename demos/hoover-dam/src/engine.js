// Scene engine: builds the world once, then every frame reads the hydro model's
// state and poses the scene from it. Nothing in the scene is animated by hand.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildTerrain } from './scene/terrain.js';
import { buildStructures } from './scene/dam.js';
import { Lake, River } from './scene/water.js';
import { Sky } from './scene/sky.js';
import { Particles, Tracers } from './scene/particles.js';
import { Construction } from './scene/construction.js';
import { DAM, damSection, elevToY, terrainHeight, SPILL, smooth } from './scene/util.js';
import { ELEV } from './model/data.js';
import { createState, step } from './model/hydro.js';

export const VIEWS = {
  overview: { pos: [330, 640, 600], tgt: [0, 80, -10] },
  downstream: { pos: [70, 118, 560], tgt: [0, 140, 60] },
  upstream: { pos: [-210, 330, -720], tgt: [0, 150, -60] },
  towers: { pos: [40, 262, -360], tgt: [-84, 160, -130] },
  powerhouse: { pos: [190, 175, 540], tgt: [0, 60, 230] },
  spillway: { pos: [-60, 290, -300], tgt: [150, 200, -150] },
  bridge: { pos: [-470, 250, 820], tgt: [0, 230, 470] },
  crest: { pos: [-175, 246, 190], tgt: [40, 222, 30] },
  xray: { pos: [360, 320, 430], tgt: [0, 70, 90] },
  section: { pos: [-560, 175, 40], tgt: [0, 112, 10] },
  hero: { pos: [140, 345, 405], tgt: [0, 115, -40] },
  pressure: { pos: [-40, 340, -560], tgt: [0, 100, 0] },
};

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(42, 1, 2, 12000);
    this.camera.position.set(...VIEWS.overview.pos);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(...VIEWS.overview.tgt);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 40; this.controls.maxDistance = 2600;

    this.uniforms = {
      uWaterY: { value: 150 }, uRingTop: { value: 210 }, uDamCz: { value: DAM.cz }, uDamR: { value: DAM.R },
      uMode: { value: 0 }, uTime: { value: 0 },
    };

    this.sky = new Sky(scene, renderer);
    this.sky.set(11);

    this.terrain = buildTerrain(this.uniforms);
    scene.add(this.terrain);

    this.S = buildStructures(this.uniforms);
    for (const g of Object.values(this.S.groups)) scene.add(g);
    this.S.groups.generators.visible = false;

    this.lake = new Lake(this.uniforms, null);
    this.river = new River(this.uniforms, null);
    scene.add(this.lake.mesh, this.lake.far, this.river.mesh);

    this.spray = new Particles(9000);
    scene.add(this.spray.points);
    this.glow = new Particles(400, true);
    scene.add(this.glow.points);
    this.penTracers = new Tracers(this.S.curves.penstock.map((p) => p.c), 70, 0x6fe3ff, 10);
    this.spillTracers = new Tracers(this.S.curves.spill.map((p) => p.c), 90, 0xffffff, 13);
    this.penTracers.points.visible = this.spillTracers.points.visible = false;
    scene.add(this.penTracers.points, this.spillTracers.points);

    this.build = new Construction();
    this.build.group.visible = false;
    scene.add(this.build.group);

    this.buildSpillWater();
    this.buildSectionCaps();
    this.buildLights();
    this.rocks = [];

    // Post: soft bloom for sun glints and night lights, then a gentle grade and vignette.
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.32, 0.55, 0.88);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uVig: { value: 0.9 }, uSat: { value: 1.1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; uniform float uSat; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5;
          c.rgb *= 1.0 - dot(d, d) * uVig;
          float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          c.rgb = max(vec3(0.0), mix(vec3(l), c.rgb, uSat));
          gl_FragColor = c; }`,
    });
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.usePost = true;

    this.state = createState();
    this.out = step(this.state, 0);
    this.mode = 'normal';
    this.focus = null;
    this.buildYear = 1931.3;
    this.fly = null;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.listeners = [];
    this.frame = 0;
    this.fps = 60; this.fpsAcc = 0; this.fpsN = 0; this.quality = 2;
    this.collectMaterials();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    this.bindPointer();
  }

  onFrame(fn) { this.listeners.push(fn); }

  onResize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------------------
  buildSpillWater() {
    this.spillSheets = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0xe8f4f6, roughness: 0.3, transparent: true, opacity: 0, depthWrite: false });
    for (const sp of this.S.spill) {
      const len = SPILL.z1 - SPILL.z0 - 16;
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(len, 18, 1, 1), mat.clone());
      sheet.rotation.y = Math.PI / 2;
      sheet.rotation.x = 0;
      sheet.position.set(sp.x + sp.s * 5, sp.crestY - 6, (SPILL.z0 + SPILL.z1) / 2);
      sheet.rotation.z = 0;
      sheet.renderOrder = 3;
      this.scene.add(sheet);
      const chan = new THREE.Mesh(new THREE.PlaneGeometry(SPILL.chanW, SPILL.z1 + 30 - SPILL.z0), new THREE.MeshStandardMaterial({ color: 0xbfe6ea, roughness: 0.2, transparent: true, opacity: 0, depthWrite: false }));
      chan.rotation.x = -Math.PI / 2;
      const zc = (SPILL.z0 + SPILL.z1 + 30) / 2;
      chan.position.set(sp.chX, terrainHeight(sp.chX, zc) + 2, zc);
      // tilt to follow the channel's slope
      const zA = SPILL.z0, zB = SPILL.z1 + 30;
      chan.rotation.x = -Math.PI / 2 + Math.atan2(terrainHeight(sp.chX, zA) - terrainHeight(sp.chX, zB), zB - zA);
      chan.renderOrder = 3;
      this.scene.add(chan);
      this.spillSheets.push({ sp, sheet, chan });
    }
  }

  buildSectionCaps() {
    // Crown cantilever profile at x = 0, seen from the Nevada side.
    const sh = new THREE.Shape();
    const N = 40;
    const prof = [];
    for (let j = 0; j <= N; j++) { const y = DAM.crestY * j / N; const { t, up } = damSection(y); const z0 = DAM.cz - (DAM.R - up); prof.push([z0, y, z0 + t]); }
    sh.moveTo(prof[0][0], 0);
    for (const [z0, y] of prof) sh.lineTo(z0, y);
    for (let j = N; j >= 0; j--) sh.lineTo(prof[j][2], prof[j][1]);
    // inspection galleries and the drainage gallery near the heel
    const galleries = [[10, 8], [60, 40], [110, 90], [160, 140], [200, 185]];
    for (const [y] of galleries) {
      const { up } = damSection(y);
      const z0 = DAM.cz - (DAM.R - up) + 6;
      const hole = new THREE.Path();
      hole.moveTo(z0, y); hole.lineTo(z0 + 3, y); hole.lineTo(z0 + 3, y + 3); hole.lineTo(z0, y + 3); hole.lineTo(z0, y);
      sh.holes.push(hole);
    }
    const geo = new THREE.ShapeGeometry(sh);
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#c9c0ae'; g.fillRect(0, 0, 64, 64); g.strokeStyle = 'rgba(80,70,60,0.5)'; g.lineWidth = 2;
    for (let i = -64; i < 128; i += 12) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
    const hatch = new THREE.CanvasTexture(c); hatch.wrapS = hatch.wrapT = THREE.RepeatWrapping; hatch.repeat.set(0.08, 0.08); hatch.colorSpace = THREE.SRGBColorSpace;
    const uvs = geo.attributes.position.array, uv = [];
    for (let i = 0; i < uvs.length; i += 3) uv.push(uvs[i], uvs[i + 1]);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.damCap = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: hatch, color: 0xe2d8c6, side: THREE.DoubleSide }));
    this.damCap.rotation.y = -Math.PI / 2;
    this.damCap.position.x = -0.05;
    this.damCap.visible = false;
    this.scene.add(this.damCap);

    // rock cap: the canyon floor cut at x = 0
    const rs = new THREE.Shape();
    rs.moveTo(-1150, -90);
    for (let z = -1150; z <= 1140; z += 8) rs.lineTo(z, terrainHeight(0.5, z));
    rs.lineTo(1140, -90); rs.lineTo(-1150, -90);
    this.rockCap = new THREE.Mesh(new THREE.ShapeGeometry(rs), new THREE.MeshBasicMaterial({ color: 0x3a2c23, side: THREE.DoubleSide }));
    this.rockCap.rotation.y = -Math.PI / 2; this.rockCap.position.x = -0.02; this.rockCap.visible = false;
    this.scene.add(this.rockCap);

    this.waterCapMat = new THREE.ShaderMaterial({
      uniforms: { uWaterY: this.uniforms.uWaterY },
      vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying float vY; uniform float uWaterY;
        void main(){ float d = clamp((uWaterY - vY)/221.0, 0.0, 1.0);
          vec3 c = mix(vec3(0.25,0.75,0.85), vec3(0.03,0.10,0.35), d);
          float band = smoothstep(0.9, 1.0, fract((uWaterY - vY)/15.24));
          c = mix(c, vec3(0.8,0.95,1.0), band*0.25);
          gl_FragColor = vec4(c, 0.78); }`,
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    this.waterCap = new THREE.Mesh(new THREE.BufferGeometry(), this.waterCapMat);
    this.waterCap.rotation.y = -Math.PI / 2;
    this.waterCap.position.x = -0.1;
    this.waterCap.visible = false;
    this.waterCap.renderOrder = 4;
    this.scene.add(this.waterCap);
    this.waterCapLevel = -1;
    this.clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  }

  rebuildWaterCap(y) {
    if (Math.abs(y - this.waterCapLevel) < 0.3) return;
    this.waterCapLevel = y;
    const sh = new THREE.Shape();
    const { up } = damSection(y);
    const zDam = DAM.cz - (DAM.R - up);
    sh.moveTo(-1000, y);
    for (let z = -1000; z <= zDam; z += 10) { const g = Math.min(y, terrainHeight(0.5, z)); sh.lineTo(z, g); }
    sh.lineTo(zDam, Math.min(y, 0));
    sh.lineTo(zDam, y);
    this.waterCap.geometry.dispose();
    this.waterCap.geometry = new THREE.ShapeGeometry(sh);
  }

  buildLights() {
    // Night glows: crest lamps, tower tops, powerhouse floods.
    this.lampSprites = [];
    const pts = [...this.S.crest.lamps, ...this.S.towers.towerTops];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const tex = this.spray.points.material.uniforms.uTex.value;
    this.lampMat = new THREE.PointsMaterial({ color: 0xffd69a, size: 14, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.lamps = new THREE.Points(geo, this.lampMat);
    this.scene.add(this.lamps);
  }

  collectMaterials() {
    this.ghostable = [];
    const add = (obj, sub) => obj.traverse((m) => {
      if (!m.isMesh) return;
      const sys = m.userData.kind === 'penstock' ? 'penstocks' : sub;
      m.userData.sys = sys;
      const mat = m.material;
      if (!mat.userData.orig) mat.userData.orig = { transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite };
      this.ghostable.push(m);
    });
    const G = this.S.groups;
    add(G.dam, 'dam'); add(G.towers, 'towers'); add(G.spillways, 'spillways'); add(G.powerhouse, 'powerhouse');
    add(G.generators, 'powerhouse'); add(G.tunnels, 'tunnels'); add(G.bridge, 'bridge');
    G.generators.traverse((m) => { m.userData.gen = true; });
  }

  // ---------------------------------------------------------------------------
  setMode(mode) {
    this.mode = mode;
    const G = this.S.groups;
    const xray = mode === 'xray';
    const section = mode === 'section';
    const build = mode === 'build';
    this.uniforms.uMode.value = mode === 'pressure' ? 1 : 0;
    for (const m of [this.lake.mat, this.lake.farMat]) m.opacity = mode === 'pressure' ? 0.22 : xray ? 0.3 : 0.9;
    this.river.mat.opacity = xray ? 0.3 : 0.93;
    this.S.curves.mats?.forEach((m) => { m.emissiveIntensity = xray ? 0.9 : 0.25; });
    this.uniforms.uRingTop.value = build ? -100 : elevToY(ELEV.drumTop - 1);
    G.generators.visible = xray || this.focus === 'powerhouse' || this.focus === 'penstocks';
    // tunnels live inside the rock: only drawn when the rock is see-through or cut
    G.tunnels.visible = xray || section || this.focus === 'penstocks' || this.focus === 'tunnels';
    this.penTracers.points.visible = xray || this.focus === 'penstocks';
    this.spillTracers.points.visible = xray || this.focus === 'tunnels' || this.focus === 'spillways';
    this.damCap.visible = section; this.waterCap.visible = section; this.rockCap.visible = section;
    const clip = section ? [this.clipPlane] : [];
    const setClip = (o) => o.traverse((m) => { if (m.material && m !== this.damCap && m !== this.waterCap && m !== this.rockCap) { m.material.clippingPlanes = clip; m.material.needsUpdate = true; } });
    [this.terrain, G.dam, G.towers, G.tunnels, G.powerhouse, G.generators, G.spillways, this.lake.mesh, this.lake.far, this.river.mesh].forEach(setClip);
    this.terrain.material.side = section ? THREE.DoubleSide : THREE.FrontSide;
    // terrain transparency
    const tm = this.terrain.material;
    const ghostTerrain = xray || (this.focus && this.focus !== 'lake' && this.focus !== 'bridge');
    tm.transparent = !!ghostTerrain; tm.opacity = xray ? 0.13 : ghostTerrain ? 0.35 : 1; tm.depthWrite = !ghostTerrain;
    tm.needsUpdate = true;
    for (const m of this.ghostable) {
      const o = m.material.userData.orig;
      let ghost = false, op = 1;
      if (xray && (m.userData.sys === 'dam' || m.userData.sys === 'powerhouse') && !m.userData.gen) { ghost = true; op = m.userData.sys === 'dam' ? 0.3 : 0.22; }
      if (this.focus && m.userData.sys !== this.focus && !(this.focus === 'penstocks' && m.userData.gen)) { ghost = true; op = 0.1; }
      if (this.focus === 'powerhouse' && m.userData.sys === 'powerhouse' && !m.userData.gen) { ghost = true; op = 0.25; }
      m.material.transparent = ghost ? true : o.transparent;
      m.material.opacity = ghost ? op : o.opacity;
      m.material.depthWrite = ghost ? false : o.depthWrite;
    }
    // build mode swaps the finished dam for the rising columns
    this.build.group.visible = build;
    G.dam.visible = !build;
    G.bridge.visible = !build;
    if (build) this.setBuildYear(this.buildYear); else { G.towers.visible = true; G.powerhouse.visible = true; G.spillways.visible = true; }
  }

  setFocus(sys) {
    this.focus = sys || null;
    this.setMode(this.mode);
  }

  setBuildYear(year) {
    this.buildYear = year;
    if (this.mode !== 'build') return;
    const r = this.build.set(year);
    const G = this.S.groups;
    G.towers.visible = year > 1934.6;
    G.spillways.visible = year > 1934.2;
    G.powerhouse.visible = year > 1935.3;
    this.buildLake = r.lakeElev;
    this.buildProgress = r.f;
  }

  safePos(v) {
    const p = new THREE.Vector3(...v);
    p.y = Math.max(p.y, terrainHeight(p.x, p.z) + 40);
    return p;
  }

  flyTo(name, dur = 1.8) {
    const v = VIEWS[name]; if (!v) return;
    this.fly = { t: 0, dur, p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: this.safePos(v.pos), t1: new THREE.Vector3(...v.tgt) };
  }

  jumpTo(name) {
    const v = VIEWS[name]; if (!v) return;
    this.fly = null; this.camera.position.copy(this.safePos(v.pos)); this.controls.target.set(...v.tgt);
  }

  // ---------------------------------------------------------------------------
  bindPointer() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 5 && performance.now() - down.t < 450) this.clickAt(e.clientX, e.clientY);
      down = null;
    });
  }

  pick(clientX, clientY, objects) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.intersectObjects(objects, true)[0];
  }

  clickAt(x, y) {
    if (this.mode === 'xray' || this.focus === 'powerhouse') {
      const hit = this.pick(x, y, this.S.groups.generators.children);
      if (hit) {
        const g = this.S.ph.gens.find((gg) => gg.group === hit.object.parent || gg.group === hit.object.parent?.parent);
        if (g) { this.emit('unit', g.id); return; }
      }
    }
    const hit = this.pick(x, y, [this.lake.mesh, this.lake.far, this.terrain]);
    if (hit && (hit.object === this.lake.mesh || hit.object === this.lake.far)) {
      this.splash(hit.point.x, hit.point.z, 1);
      this.emit('splash', hit.point);
    }
  }

  emit(type, data) { for (const fn of this.listeners) if (fn.type === type) fn(data); }
  on(type, fn) { fn.type = type; this.listeners.push(fn); }

  splash(x, z, power = 1) {
    if (this.mode === 'build') return;
    this.lake.disturb(x, z, 10 * Math.sqrt(power), 2.6 * power);
    const y = this.uniforms.uWaterY.value;
    const n = Math.round(90 * power);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (4 + Math.random() * 14) * Math.sqrt(power);
      this.spray.emit(x + Math.cos(a) * 3, y + 0.5, z + Math.sin(a) * 3, Math.cos(a) * s, 10 + Math.random() * 22 * power, Math.sin(a) * s, { life: 1.4 + Math.random(), size: 2 + Math.random() * 3 * power, floor: y, drag: 0.4 });
    }
  }

  dropBoulder() {
    const y = this.uniforms.uWaterY.value;
    for (let tries = 0; tries < 40; tries++) {
      const s = Math.random() < 0.5 ? -1 : 1;
      const z = -140 - Math.random() * 420;
      // find the wall edge on that side at the waterline
      let x = 0;
      for (let k = 0; k < 400; k += 2) { if (terrainHeight(s * k, z) > y + 2) { x = s * k; break; } }
      if (!x) continue;
      const tx = x - s * 18;
      if (!this.lake.isWater(tx, z)) continue;
      const top = terrainHeight(x + s * 10, z) + 4;
      const geo = new THREE.DodecahedronGeometry(4 + Math.random() * 3, 0);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x4a3a2e, roughness: 1, flatShading: true }));
      m.position.set(x + s * 10, top, z); m.castShadow = true;
      this.scene.add(m);
      this.rocks.push({ m, v: new THREE.Vector3(-s * 9, 4, 0), spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()), hit: false });
      this.emit('boulder', m.position);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  update() {
    const dtReal = Math.min(0.05, this.clock.getDelta());
    this.frame++;
    this.uniforms.uTime.value += dtReal;
    const st = this.state;

    if (this.mode !== 'build') this.out = step(st, dtReal);
    const out = this.out;

    // Camera flight
    if (this.fly) {
      const f = this.fly; f.t += dtReal / f.dur;
      const k = f.t >= 1 ? 1 : 1 - Math.pow(1 - f.t, 3);
      this.camera.position.lerpVectors(f.p0, f.p1, k);
      this.controls.target.lerpVectors(f.t0, f.t1, k);
      if (f.t >= 1) this.fly = null;
    }
    this.controls.update();
    // keep the camera out of the rock
    const groundY = terrainHeight(this.camera.position.x, this.camera.position.z) + 12;
    if (this.camera.position.y < groundY) this.camera.position.y = groundY;

    // Sky
    if (this.sky.set(st.hour) || this.frame === 1) {
      for (const m of [this.lake.mat, this.lake.farMat, this.river.mat]) { if (!m.envMap) m.needsUpdate = true; m.envMap = this.sky.envMap; }
    }
    const night = this.sky.night;

    // Water levels
    const lakeElev = this.mode === 'build' ? (this.buildLake ?? ELEV.riverbed + 6) : st.lake;
    const wy = elevToY(lakeElev);
    this.uniforms.uWaterY.value = wy;
    this.lake.setLevel(wy);
    const tailY = elevToY(this.mode === 'build' ? ELEV.riverbed + 4 : out.tail);
    this.river.setLevel(tailY);
    this.lake.mesh.visible = this.lake.far.visible = !(this.mode === 'build' && this.buildYear < 1935.08);
    if (this.mode === 'section') this.rebuildWaterCap(wy);

    // Intake sinks near the towers when units draw water
    this.lake.sinks.length = 0;
    if (out.turbQ > 500 && this.mode !== 'build') for (const [, x, z] of this.S.towers.spots) this.lake.sinks.push({ x: x * 0.85, z: z + 14, r: 9, a: 1.2 * Math.min(1.5, out.turbQ / 40000) });
    this.lake.update(dtReal);
    this.river.update(dtReal, out.totalQ || 0);

    // Drum gates and spill water
    const crestY = elevToY(ELEV.spillCrest);
    for (const sp of this.S.spill) for (const g of sp.gates) g.position.y = crestY - 2.44 + 4.88 * st.drum + 0.0;
    const spillPer = (out.spillQ || 0) / 2;
    const sf = Math.min(1, spillPer / 60000);
    for (const s of this.spillSheets) {
      s.sheet.material.opacity = spillPer > 1 ? 0.35 + 0.5 * sf : 0;
      s.chan.material.opacity = spillPer > 1 ? 0.3 + 0.55 * sf : 0;
      s.sheet.visible = s.chan.visible = spillPer > 1 && this.mode !== 'build';
    }
    // Particles: spill, portals, tailrace boils
    if (this.mode !== 'build') {
      if (spillPer > 1) {
        const n = 4 + Math.round(30 * sf);
        for (const sp of this.S.spill) {
          for (let i = 0; i < n; i++) {
            const z = SPILL.z0 + 10 + Math.random() * (SPILL.z1 - SPILL.z0 - 20);
            this.spray.emit(sp.x + sp.s * 3, out.spill.top ? elevToY(out.spill.top) + 0.5 : crestY, z, sp.s * (6 + Math.random() * 6), 1, (Math.random() - 0.5) * 2, { life: 1.6, size: 3 + 4 * sf, floor: terrainHeight(sp.chX, z) + 0.5, drag: 0.3 });
          }
          for (let i = 0; i < n / 2; i++) {
            const pp = sp.shaftPos;
            this.spray.emit(pp.x + (Math.random() - 0.5) * 14, pp.y + 2, pp.z - 6 + Math.random() * 10, 0, 2 + Math.random() * 6 * sf, 4, { life: 1.2, size: 4 + 4 * sf, drag: 1 });
          }
        }
        // portal jets into the river downstream
        for (const sc of this.S.curves.spill) {
          const p = sc.c.getPoint(1), d = sc.c.getTangent(1);
          for (let i = 0; i < n; i++) this.spray.emit(p.x, p.y + 2, p.z, d.x * 30 * (0.5 + sf) + (Math.random() - 0.5) * 6, 6 + Math.random() * 10 * sf, d.z * 30 * (0.5 + sf) + (Math.random() - 0.5) * 6, { life: 1.8, size: 5 + 6 * sf, floor: tailY, drag: 0.5 });
        }
      }
      for (const g of this.S.ph.gens) {
        const u = st.units.find((uu) => uu.id === g.id);
        if (u && u.q > 50 && Math.random() < 0.5 * (u.q / 3000)) {
          const o = g.outlet;
          this.spray.emit(o.x - g.s * Math.random() * 10, tailY + 0.3, o.z + (Math.random() - 0.5) * 12, -g.s * (2 + Math.random() * 4), 1 + Math.random() * 2.5, 2 + Math.random() * 4, { life: 2.2, size: 3 + Math.random() * 3, floor: tailY + 0.2, drag: 0.8, grav: 3 });
        }
      }
      if (st.lake >= ELEV.crest) {
        for (let i = 0; i < 40; i++) {
          const phi = (Math.random() * 2 - 1) * this.S.crest.crestPm * 0.9;
          const r = DAM.R; const x = r * Math.sin(phi), z = DAM.cz - r * Math.cos(phi) + 14;
          this.spray.emit(x, DAM.crestY + 1, z, 0, 0, 10 + Math.random() * 6, { life: 4, size: 4, floor: tailY, drag: 0.05 });
        }
      }
    }

    // Generators: spin + glow from each unit's live output
    const gens = this.S.ph.gens;
    for (const g of gens) {
      const u = st.units.find((uu) => uu.id === g.id);
      if (!u) continue;
      // 180 rpm is 3 rev/s; show at 1/12 speed so the rotor reads instead of strobing
      g.rotor.rotation.y += (u.rpm / 60) * Math.PI * 2 * dtReal / 12;
      g.mat.emissiveIntensity = Math.min(1.6, (u.mw || 0) / 80);
    }
    this.penTracers.speed.fill(0);
    let sideQ = { '-1': 0, '1': 0 };
    for (const u of st.units) sideQ[u.id[0] === 'N' ? '-1' : '1'] += u.q || 0;
    this.S.curves.penstock.forEach((p, i) => { this.penTracers.speed[i] = sideQ[String(p.s)] / 2 / 3000 * 0.12; });
    this.spillTracers.speed.fill(spillPer > 1 ? 0.06 + 0.12 * sf : 0);
    if (this.penTracers.points.visible) this.penTracers.update(dtReal);
    if (this.spillTracers.points.visible) this.spillTracers.update(dtReal);

    // Boulders
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i];
      r.v.y -= 9.8 * dtReal * 2.2;
      if (r.hit) r.v.multiplyScalar(0.9);
      r.m.position.addScaledVector(r.v, dtReal * 2);
      r.m.rotation.x += r.spin.x * dtReal * 3; r.m.rotation.z += r.spin.z * dtReal * 3;
      if (!r.hit && r.m.position.y <= wy) { r.hit = true; this.splash(r.m.position.x, r.m.position.z, 3); this.emit('impact', r.m.position); }
      if (r.m.position.y < wy - 40) { this.scene.remove(r.m); r.m.geometry.dispose(); this.rocks.splice(i, 1); }
    }

    this.spray.update(dtReal);

    // Night: windows, lamps, clocks
    this.S.ph.mat.emissiveIntensity = night * 1.4;
    this.lampMat.opacity = night * 0.9;
    const dst = st.day > 69 && st.day < 307;
    for (const c of this.S.towers.clocks) c.cf.draw(c.tz === 'AZ' && !dst ? (st.hour + 1) % 24 : st.hour, c.label);

    if (this.mode === 'build') this.build.update(dtReal);

    // Adaptive quality: drop pixel ratio and shadow size if the frame rate sags.
    const nowMs = performance.now();
    if (!this.fpsT0) this.fpsT0 = nowMs;
    this.fpsN++;
    if (nowMs - this.fpsT0 > 2000) {
      this.fps = this.fpsN / ((nowMs - this.fpsT0) / 1000); this.fpsT0 = nowMs; this.fpsN = 0;
      this.lowFps = this.fps < 40 ? (this.lowFps || 0) + 1 : 0;
      if (!this.lockQuality && this.lowFps >= 2 && nowMs - this.startMs > 5000 && this.quality > 0) { this.setQuality(this.quality - 1); this.lowFps = 0; }
    }

    for (const fn of this.listeners) if (!fn.type) fn(dtReal);
    this.sky.uniforms.uTime.value += dtReal;
    if (this.usePost) this.composer.render(dtReal); else this.renderer.render(this.scene, this.camera);
  }

  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 2 ? Math.min(2, dpr) : q === 1 ? Math.min(1.25, dpr) : 0.85);
    const size = q === 2 ? 2048 : q === 1 ? 1024 : 512;
    this.usePost = q > 0;
    if (this.sky.sun.shadow.mapSize.x !== size) {
      this.sky.sun.shadow.mapSize.set(size, size);
      if (this.sky.sun.shadow.map) { this.sky.sun.shadow.map.dispose(); this.sky.sun.shadow.map = null; }
    }
    this.onResize();
    this.emit('quality', q);
  }

  project(v) {
    const p = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: (p.x * 0.5 + 0.5) * r.width, y: (-p.y * 0.5 + 0.5) * r.height, behind: p.z > 1 };
  }

  start() {
    // Warm every shader before the first visible frame.
    this.renderer.compile(this.scene, this.camera);
    this.startMs = performance.now();
    const loop = () => { this.update(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
