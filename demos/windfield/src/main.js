import * as THREE from '../vendor/three/build/three.module.js';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from '../vendor/three/addons/postprocessing/ShaderPass.js';

import { PRESETS, PARAMS, COLOUR_KEYS, presetValues } from './presets.js';
import { windUniforms, cpuGust } from './wind.js';
import { buildGround, heightAt } from './terrain.js';
import { buildGrass, grassUniforms, updateGrassPatch } from './grass.js';
import { buildHeightTexture } from './field.js';
import { HarvestSystem } from './harvest.js';
import { buildHeroOak, buildBackgroundTrees, treeUniforms } from './tree.js';
import { buildSky, skyUniforms, buildMist, mistUniforms } from './sky.js';
import { buildParticles, particleUniforms, FallingLeaves, Birds } from './particles.js';
import { buildMonolith, buildStones, Bonfire } from './subjects.js';
import { CameraRig } from './controls.js';
import { StudioUI } from './ui.js';
import { WindAudio } from './audio.js';

const url = new URLSearchParams(location.search);
const MANUAL = url.has('manual'); // frame-stepped capture mode, driven from outside
const coarse = matchMedia('(pointer: coarse)').matches;
let quality = url.get('q') || (coarse ? 'low' : 'high');

// ---------------------------------------------------------------- renderer and scene
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  document.body.classList.add('no-webgl');
  throw err;
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#bcd3e6', 0.004);
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 6000);

const sky = buildSky();
scene.add(sky);

buildHeightTexture();
const ground = buildGround();
scene.add(ground);

let grass = buildGrass(quality);
scene.add(grass);

const oak = buildHeroOak();
scene.add(oak);
let bgTrees = buildBackgroundTrees(quality);
scene.add(bgTrees);
const monolith = buildMonolith();
scene.add(monolith);
const stones = buildStones();
scene.add(stones);
const bonfire = new Bonfire();
scene.add(bonfire.group);

const mist = buildMist();
scene.add(mist);
const particles = buildParticles();
scene.add(particles);
const leaves = new FallingLeaves(280);
scene.add(leaves.mesh);
const birds = new Birds(40);
scene.add(birds.mesh);
const harvest = new HarvestSystem(renderer, scene);
let driving = false;

const sun = new THREE.DirectionalLight('#ffffff', 3);
sun.castShadow = true;
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 260;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight('#a9c4e0', '#4a5a2a', 1);
scene.add(hemi);

// Environment map baked from the sky alone, refreshed while the sky is changing.
const envScene = new THREE.Scene();
const envSky = buildSky();
envSky.scale.setScalar(100);
envScene.add(envSky);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
let envDirty = true;
let envTimer = 0;
function refreshEnv() {
  const old = envRT;
  envRT = pmrem.fromScene(envScene, 0, 0.1, 200);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.35;
  if (old) old.dispose();
}

// ---------------------------------------------------------------- post
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
// Light shafts: radial blur of the bright sky towards the sun's screen position, so the
// oak and the grass cut dark gaps into the beams. Runs on HDR colour, before bloom.
const shafts = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0 },
    uTint: { value: new THREE.Color() },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength; uniform vec3 uTint;
    varying vec2 vUv;
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      if (uStrength <= 0.001) { gl_FragColor = base; return; }
      const int N = 40;
      vec2 delta = (uSun - vUv) / float(N) * 0.92;
      vec2 uv = vUv;
      float illum = 0.0;
      float decay = 1.0;
      for (int i = 0; i < N; i++) {
        uv += delta;
        vec2 c = clamp(uv, 0.001, 0.999);
        vec3 s = texture2D(tDiffuse, c).rgb;
        float l = max(dot(s, vec3(0.2126, 0.7152, 0.0722)) - 0.9, 0.0);
        illum += min(l, 6.0) * decay;
        decay *= 0.962;
      }
      illum /= float(N);
      float reach = 1.0 - smoothstep(0.15, 1.1, length((vUv - uSun) * vec2(1.6, 1.0)));
      gl_FragColor = vec4(base.rgb + uTint * illum * uStrength * reach, base.a);
    }`,
});
composer.addPass(shafts);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.55, 0.86);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const finish = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: windUniforms.uTime, uVignette: { value: 0.32 }, uGrain: { value: 0.035 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 3.1) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      float v = 1.0 - dot(q, q) * uVignette * 2.2;
      c.rgb *= v;
      c.rgb += (hash(vUv * 1000.0) - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
});
composer.addPass(finish);

// ---------------------------------------------------------------- state and tweening
const state = {};
const colours = {};
COLOUR_KEYS.forEach((k) => (colours[k] = new THREE.Color()));
let tween = null;
let presetIndex = Math.max(0, PRESETS.findIndex((p) => p.id === (url.get('preset') || 'harvest')));

function snapshot() {
  const s = {};
  for (const [k, v] of Object.entries(state)) if (typeof v === 'number') s[k] = v;
  const c = {};
  COLOUR_KEYS.forEach((k) => (c[k] = colours[k].clone()));
  return { s, c };
}

function setPreset(i, instant = false) {
  presetIndex = i;
  const p = PRESETS[i];
  const target = presetValues(p);
  rig.setFrame(p.camera);
  ui.setPreset(i);
  document.documentElement.style.setProperty('--accent', target.accent);
  if (instant || !state.subject) {
    for (const [k, v] of Object.entries(target)) {
      if (COLOUR_KEYS.includes(k)) colours[k].set(v);
      else state[k] = v;
    }
    tween = null;
    applyState();
    return;
  }
  const from = snapshot();
  const to = { s: {}, c: {} };
  for (const [k, v] of Object.entries(target)) {
    if (COLOUR_KEYS.includes(k)) to.c[k] = new THREE.Color(v);
    else if (typeof v === 'number') to.s[k] = v;
  }
  // Wind direction takes the short way round.
  if (to.s.windDir !== undefined) {
    let d = to.s.windDir - from.s.windDir;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    to.s.windDir = from.s.windDir + d;
  }
  tween = { from, to, t: 0, dur: 2.6, subject: target.subject, swapped: false };
}

function stepTween(dt) {
  if (!tween) return;
  tween.t = Math.min(1, tween.t + dt / tween.dur);
  const e = tween.t < 0.5 ? 4 * tween.t ** 3 : 1 - Math.pow(-2 * tween.t + 2, 3) / 2;
  for (const [k, v] of Object.entries(tween.to.s)) state[k] = tween.from.s[k] + (v - tween.from.s[k]) * e;
  for (const [k, v] of Object.entries(tween.to.c)) colours[k].copy(tween.from.c[k]).lerp(v, e);
  if (!tween.swapped && tween.t > 0.5) {
    setSubject(tween.subject);
    tween.swapped = true;
  }
  envDirty = true;
  if (tween.t >= 1) {
    state.windDir = ((state.windDir % 360) + 360) % 360;
    tween = null;
    ui.sync(state);
  }
}

function setSubject(id) {
  state.subject = id;
  subjectPop = 0;
}
let subjectPop = 1;

// ---------------------------------------------------------------- applying state
const tmpV = new THREE.Vector3();
const sunDir = new THREE.Vector3();
const flash = { level: 0, next: 4 };
const accent = new THREE.Color();

function firePosition() {
  if (state.subject === 'oak' || state.subject === 'combine') return [9, 6.5];
  if (state.subject === 'monolith') return [6.5, -6];
  return [0, 0];
}

function applyState() {
  const s = state;
  const rad = THREE.MathUtils.degToRad;
  // Wind direction is where the wind blows towards.
  windUniforms.uWindDir.value.set(Math.cos(rad(s.windDir)), Math.sin(rad(s.windDir)));
  windUniforms.uWindStrength.value = s.windStrength;
  windUniforms.uGustStrength.value = s.gustStrength;
  windUniforms.uGustScale.value = 1 / s.gustSize;
  windUniforms.uGustSpeed.value = s.gustSpeed;
  windUniforms.uTurbulence.value = s.turbulence;

  grassUniforms.uGrassHeight.value = s.grassHeight;
  grassUniforms.uHeightVar.value = s.heightVariation;
  grassUniforms.uDryness.value = s.dryness;
  grassUniforms.uSheen.value = s.sheen;
  grassUniforms.uTranslucency.value = s.translucency;
  grassUniforms.uFlowerAmount.value = s.flowers;
  grassUniforms.uGrassBase.value.copy(colours.grassBase);
  grassUniforms.uGrassTip.value.copy(colours.grassTip);
  grassUniforms.uGrassDry.value.copy(colours.grassDry);
  grassUniforms.uCrop.value = s.crop;
  grassUniforms.uEarColor.value.copy(colours.grassTip).lerp(colours.grassDry, 0.35).multiplyScalar(1.05);
  grassUniforms.uStubbleColor.value.copy(colours.grassDry).multiplyScalar(0.82);
  grassUniforms.uStrawColor.value.copy(colours.grassDry).lerp(colours.grassTip, 0.3);
  ground.userData.uniforms.uStubbleGround.value.copy(colours.grassDry).multiplyScalar(0.5);

  const el = rad(s.sunElevation);
  const az = rad(s.sunAzimuth);
  sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
  const above = THREE.MathUtils.smoothstep(s.sunElevation, -3, 3);
  sun.color.copy(colours.sunColor);
  sun.intensity = s.sunIntensity * above;
  hemi.color.copy(colours.hemiSky);
  hemi.groundColor.copy(colours.hemiGround);
  hemi.intensity = s.hemiIntensity;

  skyUniforms.uZenith.value.copy(colours.skyZenith);
  skyUniforms.uHorizon.value.copy(colours.skyHorizon);
  skyUniforms.uSunDir.value.copy(sunDir);
  skyUniforms.uSunColor.value.copy(colours.sunColor);
  skyUniforms.uSunDisc.value.copy(colours.sunDisc);
  skyUniforms.uSunSize.value = s.sunSize;
  skyUniforms.uGlow.value = s.glow;
  skyUniforms.uCloudCover.value = s.cloudCover;
  skyUniforms.uCloudDensity.value = s.cloudDensity;
  skyUniforms.uCloudLit.value.copy(colours.cloudLit);
  skyUniforms.uCloudShade.value.copy(colours.cloudShade);
  skyUniforms.uHighClouds.value = s.highClouds;
  skyUniforms.uStars.value = s.stars;
  skyUniforms.uHaze.value = s.haze;

  scene.fog.color.copy(colours.skyHorizon).lerp(colours.mistColor, s.mist * 0.4);
  scene.fog.density = 0.0012 + s.haze * 0.0085 + s.mist * 0.004;
  renderer.toneMappingExposure = s.exposure;
  bloom.strength = s.bloom;
  shafts.uniforms.uTint.value.copy(colours.sunColor);

  mistUniforms.uMist.value = s.mist;
  mistUniforms.uMistColor.value.copy(colours.mistColor);

  const tint = colours.sunColor.clone().multiplyScalar(Math.min(s.sunIntensity, 4) * 0.3 * (0.25 + above * 0.75));
  grassUniforms.uSunTint.value.copy(tint);
  treeUniforms.uSunTint.value.copy(tint);
  particleUniforms.uSunTint.value.copy(colours.sunColor).multiplyScalar(0.4 + s.sunIntensity * 0.25);

  treeUniforms.uLeafSummer.value.copy(colours.leafSummer);
  treeUniforms.uLeafAutumn.value.copy(colours.leafAutumn);
  treeUniforms.uSeason.value = s.leafSeason;
  treeUniforms.uCanopy.value = s.canopy;
  treeUniforms.uTranslucency.value = s.translucency * 0.7;
  leaves.mat.color.copy(colours.leafAutumn);
  leaves.amount = s.leafFall;

  particleUniforms.uPollen.value = s.pollen;
  particleUniforms.uFireflies.value = s.fireflies;
  particleUniforms.uEmbers.value = s.fire;
  particleUniforms.uRain.value = s.rain;
  birds.amount = s.birds;
  bonfire.amount = s.fire;

  const [fx, fz] = firePosition();
  bonfire.place(fx, fz);
  particleUniforms.uFirePos.value.copy(bonfire.group.position);
  grassUniforms.uClear1.value.set(fx, fz, 3.0, Math.min(1, s.fire * 1.5));
  const clearR = { oak: 1.9, combine: 1.9, monolith: 3.0, stones: 0, none: 0 }[s.subject] ?? 0;
  grassUniforms.uClear0.value.set(0, 0, clearR, 0);
  ground.userData.uniforms.uGroundA.value.copy(colours.groundA);
  ground.userData.uniforms.uGroundB.value.copy(colours.groundB);
  ground.userData.uniforms.uScorch.value.set(fx, fz, 3.4, Math.min(1, s.fire * 1.5));

  accent.copy(colours.accent);
  if (state.subject === 'oak' || state.subject === 'combine') {
    leaves.source.set(0, oak.position.y + 12, 0);
    leaves.sourceRadius = 9;
  } else {
    // No oak: leaves arrive on the wind from the hedgerows upwind.
    const wd = windUniforms.uWindDir.value;
    leaves.source.set(-wd.x * 40, 16, -wd.y * 40);
    leaves.sourceRadius = 30;
  }
}

function updateSubjects(dt, t) {
  subjectPop = Math.min(1, subjectPop + dt * 1.4);
  const pop = 1 - Math.pow(1 - subjectPop, 3);
  const setVis = (obj, on) => {
    obj.visible = on;
    if (on) obj.scale.setScalar((obj.userData.baseScale ??= obj.scale.x) * (0.85 + pop * 0.15));
  };
  setVis(oak, state.subject === 'oak' || state.subject === 'combine');
  harvest.setActive(state.subject === 'combine');
  if (driving && state.subject !== 'combine') setDriving(false);
  setVis(monolith, state.subject === 'monolith');
  setVis(stones, state.subject === 'stones');
  monolith.userData.update(t, accent);
  bonfire.update(t);
}

// ---------------------------------------------------------------- lightning
function updateLightning(dt) {
  flash.level *= Math.exp(-dt * 9);
  if (state.lightning > 0.02) {
    flash.next -= dt * state.lightning;
    if (flash.next <= 0) {
      flash.level = 1;
      flash.double = Math.random() < 0.5 ? 0.12 : -1;
      flash.next = 2.5 + Math.random() * 7;
    }
    if (flash.double > 0) {
      flash.double -= dt;
      if (flash.double <= 0) flash.level = 0.8;
    }
  }
  skyUniforms.uFlash.value = flash.level * state.lightning;
  hemi.intensity = state.hemiIntensity + flash.level * state.lightning * 2.5;
}

// ---------------------------------------------------------------- quality
const QUALITY = {
  low: { ratio: 1, shadow: 1024, bloomDiv: 2 },
  medium: { ratio: 1.25, shadow: 2048, bloomDiv: 2 },
  high: { ratio: 1.5, shadow: 2048, bloomDiv: 2 },
  ultra: { ratio: 2, shadow: 4096, bloomDiv: 2 },
};

function setQuality(q, rebuild = true) {
  quality = QUALITY[q] ? q : 'medium';
  const Q = QUALITY[quality];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.ratio));
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
  if (rebuild) {
    scene.remove(grass);
    grass.userData.dispose();
    grass = buildGrass(quality);
    scene.add(grass);
    scene.remove(bgTrees);
    bgTrees = buildBackgroundTrees(quality);
    scene.add(bgTrees);
  }
  ui?.setQuality(quality);
  resize();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  const div = QUALITY[quality].bloomDiv;
  bloom.resolution.set(w / div, h / div);
  camera.aspect = w / h;
  // Portrait screens get a wider lens so the subject still fits side to side.
  camera.fov = w / h < 1 ? 64 : 48;
  camera.updateProjectionMatrix();
  particleUniforms.uPixelRatio.value = renderer.getPixelRatio();
  harvest.setViewScale(camera, renderer);
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- UI, camera, audio
const rig = new CameraRig(camera, canvas);
const audio = new WindAudio();
let paused = false;
let shotRequested = false;

const ui = new StudioUI({
  onChange(key, v) {
    state[key] = v;
    if (tween) delete tween.to.s[key];
    envDirty = true;
    applyState();
  },
  onPreset(i) {
    setPreset(i);
  },
  onSubject(id) {
    setSubject(id);
    if (tween) tween.swapped = true;
    applyState();
    ui.sync(state);
  },
  onReset() {
    setPreset(presetIndex);
  },
  onQuality(q) {
    setQuality(q);
  },
  onPause() {
    paused = !paused;
    return paused;
  },
  onSound() {
    if (audio.on) audio.stop();
    else audio.start();
    return audio.on;
  },
  onCamera() {
    rig.mode === 'cinematic' ? rig.goFree() : rig.goCinematic();
  },
  onShot() {
    shotRequested = true;
  },
  onDrive() {
    if (state.subject !== 'combine') {
      setSubject('combine');
      applyState();
      ui.sync(state);
    }
    setDriving(!driving);
  },
});

function setDriving(on) {
  driving = on;
  harvest.setDriving(on);
  if (on) rig.goChase();
  else {
    rig.mode = 'free';
    rig.goCinematic();
  }
  ui.setDriving(on);
}

// Driving keys. WASD or the arrow keys; they only steer while you have the wheel.
const driveKeys = new Set();
function syncDriveInput() {
  const k = driveKeys;
  harvest.driver.input.throttle = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 0.6 : 0);
  harvest.driver.input.turn = (k.has('a') || k.has('arrowleft') ? 1 : 0) - (k.has('d') || k.has('arrowright') ? 1 : 0);
}
window.addEventListener('keydown', (e) => {
  if (!driving || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
    e.preventDefault();
    driveKeys.add(k);
    syncDriveInput();
  }
  if (k === 'escape') setDriving(false);
});
window.addEventListener('keyup', (e) => {
  driveKeys.delete(e.key.toLowerCase());
  syncDriveInput();
});
window.addEventListener('blur', () => {
  driveKeys.clear();
  syncDriveInput();
});
rig.onModeChange = (m) => ui.setCameraMode(m);
ui.setCameraMode(rig.mode);

// Narrow screens start with the panel tucked away.
document.body.classList.add(window.innerWidth < 960 ? 'panel-closed' : 'panel-open');

setQuality(quality, false);
setPreset(presetIndex, true);
rig.angle = PRESETS[presetIndex].camera.startAngle;
ui.sync(state);

// ---------------------------------------------------------------- frame
let time = 0;
let cloudX = 0;
let cloudY = 0;
let mistX = 0;
let fpsSmooth = 60;
let uiSyncTimer = 0;
let lowFpsTime = 0;
let autoDropped = !!url.get('q');

function frame(dt) {
  if (!paused) time += dt;
  windUniforms.uTime.value = time;
  const simDt = paused ? 0 : dt;

  stepTween(simDt || dt);
  if (tween) applyState();
  updateLightning(simDt);

  // Clouds and mist drift with the wind.
  const wd = windUniforms.uWindDir.value;
  cloudX += wd.x * state.cloudSpeed * simDt * 0.012;
  cloudY += wd.y * state.cloudSpeed * simDt * 0.012;
  skyUniforms.uCloudOffset.value.set(cloudX, cloudY);
  mistX += simDt * 0.02 * (0.3 + state.windStrength);
  mistUniforms.uMistOffset.value.set(wd.x * mistX, wd.y * mistX);

  harvest.update(simDt, time, {
    windDir: windUniforms.uWindDir.value,
    windStrength: state.windStrength,
    sunElevation: state.sunElevation,
    speedScale: state.combineSpeed ?? 1,
  });
  if (harvest.active) {
    rig.focus.lerp(harvest.position, rig.mode === 'chase' ? 1 : 1 - Math.exp(-dt * 3));
    rig.chase.heading = harvest.driver.heading;
  } else {
    rig.focus.lerp(new THREE.Vector3(), 1 - Math.exp(-dt * 2));
  }

  rig.update(dt, time);
  camera.updateMatrixWorld();
  updateGrassPatch(camera);
  sky.position.copy(camera.position);
  mist.position.set(0, heightAt(camera.position.x, camera.position.z) * 0.6 - 0.3, 0);

  // Shadow camera follows the subject but snaps to texels to stop shimmering.
  sun.target.position.set(rig.focus.x, heightAt(rig.focus.x, rig.focus.z), rig.focus.z);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 120);

  const sunScreen = tmpV.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
  const facing = camera.getWorldDirection(new THREE.Vector3()).dot(sunDir);
  const onScreen = THREE.MathUtils.smoothstep(facing, 0.35, 0.75) *
    (1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(sunScreen.x), Math.abs(sunScreen.y)), 1.0, 1.6));
  shafts.uniforms.uSun.value.set(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5);
  shafts.uniforms.uStrength.value = (state.shafts ?? 0) * onScreen * THREE.MathUtils.smoothstep(state.sunElevation, -2, 2) * 1.8;
  const sunView = tmpV.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  grassUniforms.uSunViewDir.value.copy(sunView);
  treeUniforms.uSunViewDir.value.copy(sunView);
  particleUniforms.uSunViewDir.value.copy(sunView);

  updateSubjects(simDt, time);
  if (!paused) {
    leaves.update(simDt, time);
    birds.update(time);
  }

  envTimer -= dt;
  if (envDirty && envTimer <= 0) {
    refreshEnv();
    envDirty = false;
    envTimer = 0.5;
  }

  if (audio.on) {
    const [fx, fz] = firePosition();
    audio.update({
      wind: state.windStrength,
      gust: cpuGust(camera.position.x, camera.position.z, time) * state.gustStrength,
      rain: state.rain,
      fire: state.fire,
      fireDistance: Math.hypot(camera.position.x - fx, camera.position.z - fz),
      engine: harvest.active ? 1 / (1 + camera.position.distanceTo(harvest.position) * 0.06) : 0,
      engineLoad: harvest.driver.cutting ? 1 : 0.4,
    });
  }

  composer.render(dt);

  if (shotRequested) {
    shotRequested = false;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `windfield-${PRESETS[presetIndex].id}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  if (dt > 0) fpsSmooth += (1 / dt - fpsSmooth) * 0.05;
  uiSyncTimer -= dt;
  if (uiSyncTimer <= 0) {
    ui.setFps(fpsSmooth);
    if (tween) ui.sync(state);
    uiSyncTimer = 0.25;
  }

  // If the default quality is too heavy for this machine, step down once, quietly.
  if (!autoDropped && !MANUAL && time > 3) {
    lowFpsTime = fpsSmooth < 34 ? lowFpsTime + dt : 0;
    if (lowFpsTime > 2.5) {
      autoDropped = true;
      if (quality !== 'low') setQuality(quality === 'medium' ? 'low' : 'medium');
    }
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frame(dt);
  requestAnimationFrame(loop);
}

document.body.classList.add('is-ready');
if (MANUAL) {
  // Capture hook: advance the scene in fixed steps and render on demand.
  window.__windfield = {
    step(dt = 1 / 30, n = 1) {
      for (let i = 0; i < n; i++) frame(dt);
    },
    preset(i, instant = false) {
      setPreset(i, instant);
      if (instant) rig.snapNext = true;
    },
    look(x, y, z, tx, ty, tz) {
      rig.mode = 'free';
      camera.position.set(x, y, z);
      camera.lookAt(tx, ty, tz);
      rig.syncAnglesFromCamera();
    },
    combineAt() {
      const p = harvest.position;
      return { x: p.x, z: p.z, heading: harvest.driver.heading };
    },
    drive(on, throttle = 0, turn = 0) {
      if (on !== driving) setDriving(on);
      harvest.driver.input.throttle = throttle;
      harvest.driver.input.turn = turn;
    },
    advanceCombine(seconds) {
      // Fast-forward the autopilot so captures can show a part-harvested field.
      const step = 1 / 15;
      for (let k = 0; k < seconds / step; k++) {
        harvest.update(step, time, { windDir: windUniforms.uWindDir.value, windStrength: state.windStrength, sunElevation: state.sunElevation, speedScale: state.combineSpeed ?? 1 });
      }
      rig.focus.copy(harvest.position);
      rig.snapNext = true;
    },
    ready: true,
  };
  frame(1 / 30);
} else {
  requestAnimationFrame(loop);
}
