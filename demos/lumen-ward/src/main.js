// Lumen Ward: boot, render loop, modes and HUD.
import * as THREE from '../vendor/three/build/three.module.min.js';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';
import { loadKit, shared } from './kit.js';
import { buildCity } from './city.js';
import { addSky, makeEnv, addGround, addRain, addSteam, FOG } from './world.js';
import { Explorer } from './controls.js';
import { Flyover } from './flyover.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer: coarse)').matches;
const qName = params.get('q') === 'low' || params.get('q') === 'high' ? params.get('q') : coarse ? 'low' : 'high';
const QUALITY = {
  high: { dpr: 1.5, refl: true, reflScale: 0.5, rain: 9000, msaa: 4, bloomScale: 0.5 },
  low: { dpr: 1, refl: false, reflScale: 0, rain: 3500, msaa: 0, bloomScale: 0.35 },
}[qName];

const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.dpr));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG, 0.005);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000);
camera.position.set(-340, 118, 66);
camera.lookAt(0, 20, 0);

const loaderBar = $('#loader-bar');
const loaderText = $('#loader-text');
const setLoad = (f, msg) => {
  loaderBar.style.transform = `scaleX(${f})`;
  if (msg) loaderText.textContent = msg;
};

const state = { mode: 'flyover', ready: false, t: 0 };

async function boot() {
  setLoad(0.05, 'Loading the Blender kit');
  const kitData = await loadKit('assets/lumen-ward-kit.glb', (f) => setLoad(0.05 + f * 0.6));
  setLoad(0.7, 'Laying out the ward');
  await new Promise((r) => setTimeout(r, 0));

  scene.environment = makeEnv(renderer);
  addSky(scene);
  const seed = Number(params.get('seed')) || 7;
  const city = buildCity(scene, kitData, { seed });
  const ground = addGround(scene, city, { reflections: QUALITY.refl, resScale: QUALITY.reflScale });
  const rain = addRain(scene, QUALITY.rain);
  addSteam(scene, city.steam);

  scene.add(new THREE.HemisphereLight(0x463a78, 0x120a10, 0.55));
  const moon = new THREE.DirectionalLight(0x8fa0ff, 0.35);
  moon.position.set(-0.4, 1, 0.3);
  scene.add(moon);
  for (const L of city.lights.slice(0, 10)) {
    const p = new THREE.PointLight(L.color, L.i, L.d, 2);
    p.position.set(L.x, L.y, L.z);
    scene.add(p);
  }

  setLoad(0.85, 'Compiling shaders');
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: QUALITY.msaa });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    bloom.resolution.set(w * QUALITY.bloomScale, h * QUALITY.bloomScale);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    ground.userData.resize?.(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  };
  resize();
  window.addEventListener('resize', resize);

  const explorer = new Explorer(camera, canvas, city);
  const flyover = new Flyover(camera, city, $('#fade'), $('#caption'));

  const hint = $('#hint');
  const showHint = () => {
    const on = state.mode !== 'flyover' && !explorer.locked && !coarse;
    hint.classList.toggle('is-on', on);
  };
  explorer.onLockChange = showHint;

  const setMode = (m) => {
    state.mode = m;
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    document.body.dataset.mode = m;
    if (m === 'flyover') {
      explorer.stop();
      explorer.unlock();
      flyover.start(flyover.i);
    } else {
      flyover.stop();
      explorer.start(m);
      if (!coarse) explorer.lock();
    }
    showHint();
  };
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode(b.dataset.mode);
  }));
  canvas.addEventListener('click', () => {
    if (state.mode !== 'flyover' && !explorer.locked && !coarse) explorer.lock();
  });
  $('#next-shot').addEventListener('click', () => flyover.next());
  const help = $('#help');
  const toggleHelp = (force) => {
    const on = force ?? !help.classList.contains('is-on');
    help.classList.toggle('is-on', on);
    $('#help-toggle').setAttribute('aria-expanded', String(on));
  };
  $('#help-toggle').addEventListener('click', () => toggleHelp());
  $('#help-close').addEventListener('click', () => toggleHelp(false));
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Digit1') setMode('walk');
    if (e.code === 'Digit2') setMode('fly');
    if (e.code === 'Digit3') setMode('flyover');
    if (e.code === 'KeyH') toggleHelp();
    if (e.code === 'KeyN' && state.mode === 'flyover') flyover.next();
    if (e.code === 'KeyB' && state.mode === 'flyover') flyover.next(-1);
  });

  // compile everything before the first visible frame
  renderer.compile(scene, camera);
  setLoad(1, 'Ready');

  const startMode = ['walk', 'fly', 'flyover'].includes(params.get('mode')) ? params.get('mode') : 'flyover';
  const startShot = Number(params.get('shot')) || 0;
  flyover.i = startShot;
  setMode(startMode);

  const clock = new THREE.Clock();
  const fpsEl = $('#fps');
  let frames = 0;
  let acc = 0;
  let frozen = false;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!frozen) {
      state.t += dt;
      shared.time.value = state.t;
      city.update(dt, state.t);
      if (state.mode === 'flyover') flyover.update(dt);
      else explorer.update(dt);
    }
    rain.material.uniforms.uCam.value.copy(camera.position);
    composer.render();
    frames++;
    acc += dt;
    if (acc > 0.5) {
      fpsEl.textContent = `${Math.round(frames / acc)} fps`;
      frames = 0;
      acc = 0;
    }
  }
  renderer.setAnimationLoop(frame);

  $('#loader').classList.add('is-done');
  state.ready = true;

  // hooks for automated captures
  window.__LW = {
    state,
    stats: { ...city.stats, quality: qName },
    renderer,
    setMode,
    flyover,
    explorer,
    // Pose the camera at shot i, progress u, at scene time t, and hold there.
    pose(i, u, t = 12) {
      frozen = true;
      document.body.classList.add('is-capture');
      state.t = t;
      shared.time.value = t;
      city.update(0.016, t);
      if (flyover.shots[i].follow === 'train') {
        city.trainState.s = city.railLen - 118 + u * flyover.shots[i].dur * city.trainState.speed;
        city.update(0, t);
      }
      const { p, look } = flyover.pose(i, u);
      camera.position.copy(p);
      camera.lookAt(look);
      $('#fade').style.opacity = 0;
    },
    resume() {
      frozen = false;
    },
  };
}

boot().catch((err) => {
  console.error(err);
  loaderText.textContent = 'Could not start: ' + (err && err.message ? err.message : err);
  document.body.classList.add('has-error');
});
