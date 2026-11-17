// Booster Catch: app shell. One clock drives the flight model, the scene,
// all eight cameras, the readout, the captions and the sound.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { sample, T_START, T_END, REF, EVENTS, SITE, ENGINES, engineLevel, fmtClock, directorCam, BPM } from './flight.js';
import { SUN, SKY_GLSL, shared, makeSky, makeGround, makeSite } from './world.js';
import { makeBooster } from './booster.js';
import { makePlumes, makeSmoke, makePath, makeCallouts } from './fx.js';

const $ = id => document.getElementById(id);
const canvas = $('stage');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(max-width: 820px), (pointer: coarse)').matches;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 missing'); }
catch (err) { $('fallback').style.display = 'grid'; throw err; }
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.86;
renderer.shadowMap.enabled = !small; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const quality = { dpr: Math.min(devicePixelRatio || 1, small ? 1.5 : 2), bloom: true, tier: small ? 'mid' : 'high' };

// ---- Scene --------------------------------------------------------------------
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc7a590, 0.000034);
const sky = makeSky(); scene.add(sky);
{ // steel reflects the same dawn sky
  const envScene = new THREE.Scene(); envScene.add(makeSky());
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(envScene, 0, 0.1, 10).texture; pm.dispose();
}
const std = (o) => new THREE.MeshStandardMaterial(o);
const mats = {
  steel: std({ color: 0x1c1f23, metalness: 0.55, roughness: 0.62, envMapIntensity: 0.7 }),
  steelSide: std({ color: 0x1c1f23, metalness: 0.55, roughness: 0.62, envMapIntensity: 0.7, side: THREE.DoubleSide }),
  steelLight: std({ color: 0x3b4047, metalness: 0.6, roughness: 0.5, envMapIntensity: 0.8 }),
  rail: std({ color: 0x121316, metalness: 0.2, roughness: 0.85 }),
  concrete: std({ color: 0x8b8883, roughness: 0.93 }),
  tank: std({ color: 0xaab0b6, roughness: 0.5, metalness: 0.1 }),
  building: std({ color: 0x8c867d, roughness: 0.86 }),
  lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.1, 2.8), toneMapped: false, fog: false }),
  dark: std({ color: 0x15161a, metalness: 0.5, roughness: 0.68, side: THREE.DoubleSide }),
  steelPlain: std({ color: 0xb7bbc2, metalness: 0.95, roughness: 0.36 }),
  nozzle: std({ color: 0x2b2724, metalness: 0.8, roughness: 0.5, side: THREE.DoubleSide }),
};
scene.add(makeGround());
const site = makeSite(mats); scene.add(site.group);
const booster = makeBooster(mats); scene.add(booster.group);
const plumes = makePlumes(); booster.group.add(plumes.mesh);
const smoke = makeSmoke(small ? 800 : 1500); scene.add(smoke.mesh);
const path = makePath(); scene.add(path);
const callouts = makeCallouts(booster.group); scene.add(callouts.world);

const sun = new THREE.DirectionalLight(0xffb37c, 3.5); sun.position.copy(SUN).multiplyScalar(1600).add(new THREE.Vector3(30, 60, 0)); sun.target.position.set(30, 60, 0);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = 0.5; sun.shadow.bias = -0.0004;
Object.assign(sun.shadow.camera, { left: -280, right: 280, top: 210, bottom: -70, near: 200, far: 3400 }); sun.shadow.camera.updateProjectionMatrix();
scene.add(sun, sun.target, new THREE.HemisphereLight(0xd6d8e2, 0x7d7166, 1.55));
const fire = new THREE.PointLight(0xffc49a, 0, 0, 2); scene.add(fire);

// ---- Blueprint and thermal looks: swap materials on every solid mesh ---------------
const VERT = `
  varying vec3 vN; varying vec3 vE; varying vec3 vW; varying vec2 vUv; varying float vY;
  void main(){
    vec4 lp = vec4(position, 1.0); vec3 n = normal;
    #ifdef USE_INSTANCING
      lp = instanceMatrix*lp; mat3 im = mat3(instanceMatrix); n = im*(n/vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])));
    #endif
    vec4 w = modelMatrix*lp; vW = w.xyz; vY = position.y; vUv = uv;
    vec4 mv = viewMatrix*w; vE = -mv.xyz; vN = normalize(normalMatrix*n); gl_Position = projectionMatrix*mv;
  }`;
const TAIL = `
#include <tonemapping_fragment>
#include <colorspace_fragment>`;
const makeBlueprint = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  vertexShader: VERT,
  fragmentShader: `varying vec3 vN; varying vec3 vE; varying vec2 vUv;
    void main(){
      float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vE))), 2.2);
      vec2 d = min(vUv, 1.0 - vUv), fw = fwidth(vUv)*1.3;
      float edge = 1.0 - min(smoothstep(0.0, fw.x, d.x), smoothstep(0.0, fw.y, d.y));
      float a = 0.035 + 0.5*rim + 0.42*edge;
      gl_FragColor = vec4(vec3(0.42, 0.76, 1.0)*a, a); ${TAIL}
    }`,
});
const blueprintMats = [makeBlueprint(), makeBlueprint()]; // [plain, instanced]: one shader program each, no switching per draw
const heat = { value: new THREE.Vector2(1, 0) };
const thermalCache = new Map();
function thermalMat(spec, src, instanced) {
  const side = src.side, key = [spec, side, instanced, src.polygonOffset].join('|'); if (thermalCache.has(key)) return thermalCache.get(key);
  const base = typeof spec === 'number' ? spec : spec === 'engine' ? 0.5 : 0.33;
  const m = new THREE.ShaderMaterial({
    side, fog: false, polygonOffset: src.polygonOffset, polygonOffsetFactor: src.polygonOffsetFactor, polygonOffsetUnits: src.polygonOffsetUnits, uniforms: { uBase: { value: base }, uKind: { value: spec === 'body' ? 1 : spec === 'engine' ? 2 : 0 }, uHeat: heat, uFire: shared.uFire, uSun: shared.uSun, uMode: shared.uMode },
    vertexShader: VERT,
    fragmentShader: `varying vec3 vN; varying vec3 vE; varying vec3 vW; varying float vY; uniform float uBase; uniform float uKind; uniform vec2 uHeat; uniform vec4 uFire; ${SKY_GLSL}
      void main(){
        float t = uBase;
        if (uKind > 0.5 && uKind < 1.5) t += (0.50*uHeat.x + 0.30*uHeat.y)*exp(-(vY + 33.0)/7.0) + 0.06*smoothstep(-6.0, -33.0, vY);
        if (uKind > 1.5) t += 0.38*max(uHeat.x, uHeat.y) + 0.10;
        t += uFire.w*1.6*exp(-length(vW - uFire.xyz)/26.0);
        t *= 0.84 + 0.16*abs(dot(normalize(vN), normalize(vE)));
        gl_FragColor = vec4(ironbow(t), 1.0); ${TAIL}
      }`,
  });
  thermalCache.set(key, m); return m;
}
const solids = [];
scene.traverse(o => {
  if (!o.isMesh || o.userData.kind) return;
  const inst = o.isInstancedMesh === true;
  solids.push({ o, visual: o.material, blueprint: blueprintMats[inst ? 1 : 0], thermal: thermalMat(o.userData.temp ?? 0.25, o.material, inst) });
});
const glowMeshes = []; scene.traverse(o => { if (o.userData.kind === 'glow') glowMeshes.push(o); });

let mode = 'visual', showPath = false;
function setMode(m) {
  mode = m; shared.uMode.value = m === 'visual' ? 0 : m === 'blueprint' ? 1 : 2;
  for (const s of solids) s.o.material = m === 'visual' ? s.visual : m === 'blueprint' ? s.blueprint : s.thermal;
  glowMeshes.forEach(g => { g.visible = m !== 'blueprint'; });
  booster.inside.visible = m === 'blueprint'; callouts.world.visible = callouts.onBooster.visible = m === 'blueprint';
  path.visible = showPath || m === 'blueprint'; $('path').setAttribute('aria-pressed', String(path.visible));
  bloom.strength = m === 'visual' ? 0.32 : m === 'blueprint' ? 0.55 : 0.3; bloom.threshold = m === 'visual' ? 1.7 : 0.55;
  renderer.shadowMap.enabled = !small && m === 'visual';
  document.querySelectorAll('.modes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  dirty = true;
}

// ---- Cameras -----------------------------------------------------------------------
const CAMS = [
  { id: 'tracker', name: 'Tracking' }, { id: 'pad', name: 'Pad' }, { id: 'onboard', name: 'Onboard' }, { id: 'drone', name: 'Drone' },
  { id: 'tower', name: 'Tower top' }, { id: 'arm', name: 'Catch arms' }, { id: 'shore', name: 'Shoreline' }, { id: 'free', name: 'Free look' },
];
const cam = new THREE.PerspectiveCamera(40, 1, 1, 90000);
const insetCams = [new THREE.PerspectiveCamera(40, 1, 1, 90000), new THREE.PerspectiveCamera(40, 1, 1, 90000)];
const controls = new OrbitControls(cam, canvas); controls.enabled = false; controls.enableDamping = false; controls.minDistance = 20; controls.maxDistance = 2500; controls.maxPolarAngle = Math.PI * 0.53;
controls.addEventListener('change', () => { dirty = true; });
const axis = new THREE.Vector3(), mid = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), qUp = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
const S = {}, S2 = {};
const along = (s, h, out) => out.set(s.x, s.y + SITE.pinY, s.z).addScaledVector(v2.set(s.leanX, 1, s.leanZ).normalize(), h - SITE.pinY);
const wob = (t, k) => reduced ? 0 : Math.sin(t * 1.31 + k) * 0.6 + Math.sin(t * 2.9 + k * 2.3) * 0.4;
const fitFov = (dist, frac, lo, hi) => clamp(2 * Math.atan(SITE.boosterHeight / (frac * 2 * dist)) * 180 / Math.PI, lo, hi);

function poseCamera(id, c, s) {
  const t = s.t; sample(t - 0.14, S2); along(S2, 34, mid); // operators lag a touch behind the vehicle
  const siteMix = 0.55 * smooth(398, 411, t);
  c.up.copy(UP); let near = 1, far = 90000, shake = 0;
  if (id === 'tracker') {
    c.position.set(-1950, 8, 880); const d = c.position.distanceTo(mid);
    mid.lerp(v1.set(14, 78, 0), siteMix); c.fov = fitFov(d, 0.30 - 0.07 * smooth(396, 412, t), 1.6, 9.5); near = 60; shake = 0.35;
    mid.x += wob(t, 1) * d * c.fov * 0.00006; mid.y += wob(t, 4) * d * c.fov * 0.00006;
  } else if (id === 'shore') {
    c.position.set(470, 2.4, 470); const d = c.position.distanceTo(mid);
    mid.lerp(v1.set(16, 74, 0), siteMix * 1.1); c.fov = fitFov(d, 0.17 + 0.08 * smooth(396, 412, t), 1.3, 30); near = 20; shake = 0.5;
  } else if (id === 'pad') {
    c.position.set(118, 3.2, 96); const d = c.position.distanceTo(mid);
    mid.lerp(v1.set(24, 70, 0), siteMix * 0.8); c.fov = fitFov(d, 0.2, 4, 52); near = 2; shake = 1;
  } else if (id === 'tower') {
    c.position.set(10.5, SITE.towerHeight + 5, 8.5); along(s, 52, mid); c.fov = 58; near = 1; shake = 0.6;
  } else if (id === 'arm') {
    c.position.set(SITE.hingeX + 2.6, SITE.armY + 5.2 - s.settle, 0); along(s, 50, mid); mid.y = Math.min(mid.y, SITE.armY + 260); c.fov = 74; near = 0.5; shake = 0.8;
  } else if (id === 'drone') {
    along(s, 34, mid); const ang = 0.55 + (t - T_START) * 0.035, rad = 150 - 45 * smooth(392, 412, t);
    c.position.set(mid.x + Math.cos(ang) * rad, Math.max(7, mid.y + 22 - 34 * smooth(396, 414, t)), mid.z + Math.sin(ang) * rad); c.fov = 42; near = 2;
  } else if (id === 'onboard') {
    booster.group.updateWorldMatrix(true, false); const m = booster.group.matrixWorld;
    c.position.set(-7.6, 58.5, 1.4).applyMatrix4(m); mid.set(-2.6, -22, 0.2).applyMatrix4(m);
    c.up.set(-1, 0.12, 0).transformDirection(m); c.fov = 82; near = 0.3; far = 60000;
  }
  if (id !== 'free') {
    c.near = near; c.far = far; c.lookAt(mid);
    if (shake && !reduced) { const k = shake * s.thrust * 0.0035; c.rotateX(Math.sin(t * 61) * k); c.rotateY(Math.sin(t * 47 + 1) * k); }
    c.updateProjectionMatrix();
  }
}

let camId = 'tracker', director = true, split = false;
const lastTarget = new THREE.Vector3();
function setCamera(id, fromUser = true) {
  if (fromUser && director) setDirector(false);
  if (id === 'free' && camId !== 'free') { // start free look from wherever we are
    sample(time, S); along(S, 34, mid); controls.target.copy(mid); lastTarget.copy(mid);
    if (cam.position.distanceTo(mid) > 1200 || camId === 'onboard') cam.position.set(mid.x + 150, Math.max(20, mid.y + 30), mid.z + 170);
    cam.fov = 42; cam.near = 2; cam.far = 90000; cam.up.copy(UP); cam.updateProjectionMatrix();
  }
  camId = id; controls.enabled = id === 'free';
  document.querySelectorAll('#camchips .chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cam === id)));
  dirty = true;
}
function setDirector(on) { director = on; $('director').setAttribute('aria-pressed', String(on)); dirty = true; }

// ---- Post-processing ---------------------------------------------------------------------
const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: small ? 0 : 4 });
const composer = new EffectComposer(renderer, target);
composer.addPass(new RenderPass(scene, cam));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 1.7); composer.addPass(bloom);
composer.addPass(new OutputPass());
// The picture is centred in the part of the screen the panels leave free, so the booster is never behind the controls.
const free = { top: 0, bottom: 0 };
function measureFree(w, h) {
  const rect = sel => { const e = document.querySelector(sel); return e && e.getClientRects().length ? e.getBoundingClientRect() : null; };
  const narrow = w <= 820, title = rect('.title'), dock = rect('.dock');
  free.top = narrow && title ? title.bottom + 6 : 0; free.bottom = dock ? dock.top : h;
  if (narrow) for (const sel of ['.telemetry', '.modes']) { const r = rect(sel); if (r && r.top > h * 0.3) free.bottom = Math.min(free.bottom, r.top); }
  if (free.bottom - free.top < 80) { free.top = 0; free.bottom = h; }
}
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setPixelRatio(quality.dpr); renderer.setSize(w, h, false); composer.setPixelRatio(quality.dpr); composer.setSize(w, h);
  measureFree(w, h);
  cam.aspect = w / h; cam.setViewOffset(w, h, 0, Math.round(h / 2 - (free.top + free.bottom) / 2), w, h); cam.updateProjectionMatrix(); dirty = true;
}
addEventListener('resize', resize);
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); playing = false; $('fallback').style.display = 'grid'; $('fallback').querySelector('p').innerHTML = '<strong>3D graphics were interrupted.</strong><br>Reload the page to carry on.'; });

// ---- The one clock --------------------------------------------------------------------------
let time = T_START, playing = false, rate = 1, dirty = true, firstFrameMs = null, lastEvent = null, dragging = false;
const vSize = new THREE.Vector2();

function apply(t) {
  sample(t, S);
  axis.set(S.leanX, 1, S.leanZ).normalize(); qUp.setFromUnitVectors(UP, axis);
  booster.group.quaternion.copy(qUp); booster.group.position.set(S.x, S.y + SITE.pinY, S.z).addScaledVector(axis, -SITE.pinY);
  booster.update(S); plumes.update(S); smoke.setClock(t);
  site.rig.position.y = SITE.armY - S.settle;
  for (const a of site.arms) a.group.rotation.y = -a.side * S.arm * Math.PI / 180;
  shared.uTime.value = t;
  const glowAmt = S.thrust + 0.05 * S.fire;
  fire.position.copy(booster.group.position).addScaledVector(axis, -9); fire.intensity = 42000 * glowAmt * (0.92 + 0.08 * Math.sin(t * 40));
  shared.uFire.value.set(fire.position.x, fire.position.y, fire.position.z, glowAmt);
  heat.value.set(S.heat, S.thrust);
}

function render() {
  apply(time);
  if (director) { const want = directorCam(time); if (want !== camId) setCamera(want, false); }
  if (camId === 'free') { along(S, 34, mid); cam.position.add(v1.copy(mid).sub(lastTarget)); controls.target.copy(mid); lastTarget.copy(mid); controls.update(); cam.position.y = Math.max(cam.position.y, 2); cam.lookAt(mid); }
  else poseCamera(camId, cam, S);
  renderer.getSize(vSize);
  if (quality.bloom) composer.render(); else { renderer.setViewport(0, 0, vSize.x, vSize.y); renderer.render(scene, cam); }
  if (split && !small) { // two more cameras, same instant, drawn straight over the frame
    const others = ['onboard', 'pad', 'tracker'].filter(i => i !== camId).slice(0, 2), tb = document.querySelector('.title').getBoundingClientRect();
    const room = free.bottom - tb.bottom - 36, h = Math.round(Math.min(vSize.x * 0.2 * 9 / 16, (room - 12) / 2)), w = Math.round(h * 16 / 9), show = h >= 64;
    renderer.autoClear = false; renderer.setScissorTest(true); renderer.shadowMap.autoUpdate = false; // shadows are already drawn for this instant
    insetLabels.forEach(l => { l.style.display = 'none'; });
    if (show) others.forEach((id, k) => {
      const x = 20, y = Math.round(vSize.y - tb.bottom - 14 - (k + 1) * (h + 12) + 12);
      insetCams[k].aspect = w / h; poseCamera(id, insetCams[k], S);
      renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h); renderer.clear(true, true, false); renderer.render(scene, insetCams[k]);
      insetLabels[k].textContent = CAMS.find(c => c.id === id).name; Object.assign(insetLabels[k].style, { display: 'block', left: x + 'px', bottom: y + 'px', width: w + 'px', height: h + 'px' }); insetLabels[k].dataset.cam = id;
    });
    renderer.setScissorTest(false); renderer.setViewport(0, 0, vSize.x, vSize.y); renderer.autoClear = true; renderer.shadowMap.autoUpdate = true;
  } else insetLabels.forEach(l => { l.style.display = 'none'; });
  hud();
  if (firstFrameMs === null) firstFrameMs = Math.round(performance.now());
}

// ---- Readout, captions, timeline ---------------------------------------------------------------
const el = { clock: $('clock'), phase: $('phase'), alt: $('alt'), spd: $('spd'), engn: $('engn'), cap: $('caption'), scrub: $('scrub'), play: $('play'), icon: $('playicon') };
const engDots = ENGINES.map(e => { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('cx', (Math.cos(e.a) * e.r).toFixed(2)); c.setAttribute('cy', (Math.sin(e.a) * e.r).toFixed(2)); c.setAttribute('r', e.ring === 2 ? 0.5 : 0.58); $('engmap').appendChild(c); return c; });
const insetLabels = [0, 1].map(() => { const b = document.createElement('button'); b.type = 'button'; b.style.cssText = 'position:fixed;display:none;padding:6px 8px;border:1px solid rgba(255,255,255,.35);border-radius:8px;background:none;color:#fff;font:600 10px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;text-align:left;display:none;align-items:flex-start;text-shadow:0 1px 4px #000'; b.addEventListener('click', () => setCamera(b.dataset.cam)); document.body.appendChild(b); return b; });
const marks = EVENTS.map(e => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'mark' + (e.cited ? ' cited' : ''); b.textContent = e.short; b.title = `${e.label}, ${fmtClock(e.t, false)}`;
  b.style.left = ((e.t - T_START) / (T_END - T_START)) * 100 + '%'; { const more = document.createElement('span'); more.className = 'sr'; more.textContent = `: jump to ${e.label.toLowerCase()}, ${fmtClock(e.t, false).replace('T+', 'T plus ')}`; b.appendChild(more); } // visible text stays inside the accessible name
  b.addEventListener('click', () => seek(e.t)); $('marks').appendChild(b); return { e, b };
});
const nf = new Intl.NumberFormat('en-GB');
let hudKey = '';
function hud() {
  el.clock.textContent = fmtClock(time);
  const altTxt = S.alt >= 1000 ? `${(S.alt / 1000).toFixed(2)}<small>km</small>` : `${Math.round(S.alt)}<small>m</small>`;
  const key = `${altTxt}|${Math.round(S.speed * 3.6)}|${S.lit}|${S.phase}`;
  if (key !== hudKey) {
    hudKey = key; el.alt.innerHTML = altTxt; el.spd.innerHTML = `${nf.format(Math.round(S.speed * 3.6))}<small>km/h</small>`;
    el.engn.textContent = `${S.lit} / 33`; el.phase.textContent = S.phase;
    for (let i = 0; i < 13; i++) engDots[i].classList.toggle('on', engineLevel(i, time) > 0.5);
  }
  if (!dragging) el.scrub.value = time;
  el.scrub.style.setProperty('--p', ((time - T_START) / (T_END - T_START)) * 100 + '%');
  el.scrub.setAttribute('aria-valuetext', valueText());
  let ev = null; for (const m of marks) { const passed = time >= m.e.t; m.b.classList.toggle('passed', passed); if (passed) ev = m.e; }
  const text = ev ? ev.text : 'A 71 metre booster falls back toward the tower it left six minutes ago.';
  if (text !== lastEvent) { lastEvent = text; el.cap.textContent = text; }
}
function setPlaying(on) {
  if (on && time >= T_END - 0.05) time = T_START;
  playing = on; el.play.setAttribute('aria-label', on ? 'Pause' : 'Play');
  el.icon.setAttribute('d', on ? 'M6 4.5h4.5v15H6zM13.5 4.5H18v15h-4.5z' : 'M7 4.5v15l13-7.5z');
  if (on) audio.resume(); else audio.silence();
  dirty = true;
}
const valueText = () => `${fmtClock(time, false).replace('T+', 'T plus ')}, ${sample(time, S2).phase}`;
function seek(t) { time = clamp(t, T_START, T_END); beatIndex = -1; dirty = true; el.scrub.setAttribute('aria-valuetext', valueText()); } // screen readers hear the new time at once

// ---- Sound: synthesised in the browser, off until asked for ------------------------------------
const audio = (() => {
  let ctx = null, on = false, rumble = null, master = null;
  function start() {
    ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.03 * (Math.random() * 2 - 1)) / 1.03; d[i] = last * 3.2; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180; rumble = ctx.createGain(); rumble.gain.value = 0;
    src.connect(lp).connect(rumble).connect(master); src.start(); rumble.lp = lp;
  }
  return {
    get on() { return on; },
    toggle() { on = !on; if (on && !ctx) start(); if (!on) { this.silence(); ctx.suspend(); } else this.resume(); return on; },
    resume() { if (on && ctx && ctx.state !== 'running') ctx.resume(); }, // also covers iOS 'interrupted'
    silence() { if (rumble) rumble.gain.setTargetAtTime(0, ctx.currentTime, 0.05); },
    frame(s, id) {
      if (!on || !ctx || !playing) return;
      const near = id === 'onboard' ? 1 : id === 'tracker' || id === 'shore' ? 0.45 : 0.8;
      rumble.gain.setTargetAtTime((0.1 * s.heat + 0.95 * Math.pow(s.thrust, 0.6) + 0.15 * s.fire) * near, ctx.currentTime, 0.06);
      rumble.lp.frequency.setTargetAtTime(120 + 520 * s.thrust, ctx.currentTime, 0.1);
    },
    beat(strong) {
      if (!on || !ctx || !playing) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime;
      o.frequency.setValueAtTime(strong ? 110 : 82, t0); o.frequency.exponentialRampToValueAtTime(38, t0 + 0.16);
      g.gain.setValueAtTime(strong ? 0.5 : 0.22, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
      o.connect(g).connect(master); o.start(t0); o.stop(t0 + 0.24);
    },
  };
})();
let beatIndex = -1;

// ---- Loop -------------------------------------------------------------------------------------------
let last = performance.now(), slow = 0, frames = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (playing) {
    time += dt * rate;
    if (time >= T_END) { time = T_END; setPlaying(false); }
    const b = Math.floor((time - T_START) / (60 / BPM)); if (b !== beatIndex) { beatIndex = b; if (director) audio.beat(b % 4 === 0); }
    audio.frame(S, camId);
    // keep phones inside their frame budget: drop resolution first, then bloom
    frames++; if (dt > 0.045) slow++; // slower than about 22 frames a second (a steady 30 is fine)
    if (frames >= 90) { if (slow > 45) { if (quality.dpr > 1) { quality.dpr = Math.max(1, quality.dpr - 0.25); resize(); } else if (quality.bloom) quality.bloom = false; quality.tier = 'reduced'; } frames = slow = 0; }
  }
  if (playing || dirty) { dirty = false; render(); }
  requestAnimationFrame(loop);
}

// ---- Controls ---------------------------------------------------------------------------------------
CAMS.forEach((c, i) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.cam = c.id; b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `<kbd aria-hidden="true">${i + 1}</kbd>${c.name}`; b.addEventListener('click', () => setCamera(c.id)); $('camchips').appendChild(b);
});
const toggle = (id, fn) => $(id).addEventListener('click', () => $(id).setAttribute('aria-pressed', String(fn())));
$('director').addEventListener('click', () => setDirector(!director));
toggle('split', () => { split = !split; dirty = true; return split; });
toggle('path', () => { showPath = !showPath; path.visible = showPath || mode === 'blueprint'; dirty = true; return showPath; });
toggle('sound', () => audio.toggle());
if (small) $('split').style.display = 'none';
document.querySelectorAll('.modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
el.play.addEventListener('click', () => setPlaying(!playing));
$('restart').addEventListener('click', () => { seek(T_START); setPlaying(true); });
$('rate').addEventListener('change', e => { rate = Number(e.target.value); });
el.scrub.addEventListener('input', () => seek(Number(el.scrub.value)));
el.scrub.addEventListener('pointerdown', () => { dragging = true; });
for (const ev of ['pointerup', 'pointercancel', 'blur']) el.scrub.addEventListener(ev, () => { dragging = false; });
$('about-open').addEventListener('click', () => $('about').showModal());
$('about-close').addEventListener('click', () => $('about').close());
addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || $('about').open) return;
  const tag = e.target.tagName, k = e.key.toLowerCase();
  if (tag === 'SELECT') return;
  if (tag === 'INPUT') { // the timeline: a second per press (five with Shift or Page keys), not the slider's fine step
    const step = { arrowleft: -1, arrowdown: -1, arrowright: 1, arrowup: 1, pagedown: -5, pageup: 5 }[k];
    if (step) { e.preventDefault(); seek(time + step * (e.shiftKey && Math.abs(step) === 1 ? 5 : 1)); return; }
    if (k === 'home' || k === 'end') { e.preventDefault(); seek(k === 'home' ? T_START : T_END); return; }
  }
  if (k === ' ' || k === 'k') { if (tag === 'BUTTON' && k === ' ') return; e.preventDefault(); setPlaying(!playing); }
  else if (k === 'arrowleft') seek(time - (e.shiftKey ? 5 : 1));
  else if (k === 'arrowright') seek(time + (e.shiftKey ? 5 : 1));
  else if (k === 'home') seek(T_START); else if (k === 'end') seek(T_END);
  else if (k >= '1' && k <= '8') setCamera(CAMS[Number(k) - 1].id);
  else if (k === 'd') setDirector(!director);
  else if (k === 'b') setMode('blueprint'); else if (k === 't') setMode('thermal'); else if (k === 'n') setMode('visual');
  else if (k === 'v') $('split').click(); else if (k === 'p') $('path').click(); else if (k === 'm') $('sound').click();
  else if (k === 'r') { seek(T_START); setPlaying(true); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) setPlaying(false); });

// ---- Go ------------------------------------------------------------------------------------------------
resize(); setMode('visual');
if (reduced) { setDirector(false); setCamera('tracker', false); seek(REF.catch - 1.6); } // a still frame, no motion until asked
else { setCamera(directorCam(T_START), false); setPlaying(true); }
requestAnimationFrame(loop);

// Hooks for the automated checks in tools/
window.__replay = {
  seek, setCamera, setMode, setDirector, setPlaying,
  state: () => ({ ...sample(time), cam: camId, mode, director, playing, quality: { ...quality } }),
  get firstFrameMs() { return firstFrameMs; },
  renderNow() { dirty = false; render(); },
  get free() { return { ...free }; },
};
