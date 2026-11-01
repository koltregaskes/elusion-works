// Lumen Ward: boot, render pipeline, loop, modes and HUD.
// WebGPU renderer (falls back to WebGL2), TSL post-processing: ambient
// occlusion, screen-space reflections, bloom, temporal anti-aliasing, grade.
import * as THREE from '../vendor/three/build/three.webgpu.js';
import {
  pass, mrt, output, normalView, metalness, roughness, velocity, vec2, vec3, float, sample, packNormalToRGB,
  unpackRGBToNormal, renderOutput, screenUV, length, smoothstep, hash, uniform, mix, Fn,
} from '../vendor/three/build/three.tsl.js';
import { ao } from '../vendor/three/addons/tsl/display/GTAONode.js';
import { ssr } from '../vendor/three/addons/tsl/display/SSRNode.js';
import { bloom } from '../vendor/three/addons/tsl/display/BloomNode.js';
import { traa } from '../vendor/three/addons/tsl/display/TRAANode.js';
import { fxaa } from '../vendor/three/addons/tsl/display/FXAANode.js';
import { loadKits } from './kit.js';
import { uTime } from './materials.js';
import { buildCity } from './city.js';
import { setSky, makeEnv, addGround, addRain, addSteam, addLightCones, LightPool, FOG } from './world.js';
import { Explorer } from './controls.js';
import { Flyover } from './flyover.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer: coarse)').matches;
const qParam = params.get('q');
const qName = ['low', 'high', 'ultra'].includes(qParam) ? qParam : coarse ? 'low' : 'high';
const QUALITY = {
  ultra: { dpr: 2, ssr: true, ao: true, rain: 14000, lights: 56, ssrScale: 1, aoScale: 0.75 },
  high: { dpr: 1.5, ssr: true, ao: true, rain: 10000, lights: 40, ssrScale: 0.5, aoScale: 0.5 },
  low: { dpr: 1, ssr: false, ao: false, rain: 4000, lights: 16, ssrScale: 0.5, aoScale: 0.5 },
}[qName];
const AA = params.get('aa') === 'fxaa' || qName === 'low' ? 'fxaa' : 'traa';

const canvas = $('#scene');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.dpr));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG, 0.0048);
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 3000);
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
  await renderer.init();
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  setLoad(0.04, `Loading the Blender kit (${backend})`);
  const kitData = await loadKits('assets', (f) => setLoad(0.04 + f * 0.6));
  setLoad(0.66, 'Laying out the ward');
  await new Promise((r) => setTimeout(r, 0));

  scene.environment = makeEnv(renderer);
  scene.environmentIntensity = 0.6;
  setSky(scene);
  const seed = Number(params.get('seed')) || 7;
  const city = buildCity(scene, kitData, { seed });
  addGround(scene, city, kitData.tex);
  const { cam: rainCam } = addRain(scene, QUALITY.rain);
  addSteam(scene, city.steam);
  addLightCones(scene, city.lampHeads);
  scene.add(new THREE.HemisphereLight(0x3a3060, 0x0a0608, 0.35));
  const moon = new THREE.DirectionalLight(0x8090ff, 0.25);
  moon.position.set(-0.4, 1, 0.3);
  scene.add(moon);
  const pool = new LightPool(scene, city.lights, QUALITY.lights);

  // ------------------------------------------------------------ post-processing
  setLoad(0.8, 'Building the render pipeline');
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView), metalrough: vec2(metalness, roughness), velocity }));
  scenePass.getTexture('normal').type = THREE.UnsignedByteType;
  scenePass.getTexture('metalrough').type = THREE.UnsignedByteType;
  const col = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const normalTex = scenePass.getTextureNode('normal');
  const mr = scenePass.getTextureNode('metalrough');
  const vel = scenePass.getTextureNode('velocity');
  const sceneNormal = sample((u) => unpackRGBToNormal(normalTex.sample(u)));

  let lit = col;
  if (QUALITY.ao) {
    const aoPass = ao(depth, sceneNormal, camera);
    aoPass.resolutionScale = QUALITY.aoScale;
    aoPass.radius.value = 1.2;
    lit = lit.mul(mix(float(1), aoPass.getTextureNode().r, 0.85));
  }
  if (QUALITY.ssr) {
    const ssrPass = ssr(col, depth, sceneNormal, { metalnessNode: mr.r, roughnessNode: mr.g });
    ssrPass.resolutionScale = QUALITY.ssrScale;
    ssrPass.maxDistance.value = 60;
    ssrPass.thickness.value = 0.6;
    ssrPass.quality.value = 0.6;
    lit = lit.add(ssrPass.rgb);
  }
  const glow = bloom(lit, 0.55, 0.45, 0.92);
  const combined = lit.add(glow);
  const aa = AA === 'traa' ? traa(combined, depth, vel, camera) : combined;
  // grade in display space: vignette and a little film grain
  const display = renderOutput(aa);
  const graded = Fn(() => {
    const v = smoothstep(1.05, 0.35, length(screenUV.sub(0.5).mul(vec2(1.0, 0.8))));
    const g = hash(screenUV.x.mul(1913.0).add(screenUV.y.mul(7137.0)).add(uTime.mul(61.0))).sub(0.5).mul(0.025);
    return vec3(display.rgb.mul(v.mul(0.25).add(0.75)).add(g));
  })();
  pipeline.outputNode = AA === 'fxaa' ? fxaa(graded) : graded;

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);

  // ------------------------------------------------------------ controls and modes
  const explorer = new Explorer(camera, canvas, city);
  const flyover = new Flyover(camera, city, $('#fade'), $('#caption'));
  const hint = $('#hint');
  const showHint = () => hint.classList.toggle('is-on', state.mode !== 'flyover' && !explorer.locked && !coarse);
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

  setLoad(0.9, 'Compiling shaders');
  await renderer.compileAsync(scene, camera);
  setLoad(1, 'Ready');

  const startMode = ['walk', 'fly', 'flyover'].includes(params.get('mode')) ? params.get('mode') : 'flyover';
  flyover.i = Number(params.get('shot')) || 0;
  setMode(startMode);

  const timer = new THREE.Timer();
  const fpsEl = $('#fps');
  let frames = 0;
  let acc = 0;
  let frozen = false;
  function frame() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    if (!frozen) {
      state.t += dt;
      uTime.value = state.t;
      city.update(dt, state.t);
      if (state.mode === 'flyover') flyover.update(dt);
      else explorer.update(dt);
    }
    pool.update(camera);
    rainCam.value.copy(camera.position);
    pipeline.render();
    frames++;
    acc += dt;
    if (acc > 0.5) {
      fpsEl.textContent = `${Math.round(frames / acc)} fps · ${backend}`;
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
    stats: { ...city.stats, quality: qName, backend, aa: AA },
    renderer,
    setMode,
    flyover,
    explorer,
    pose(i, u, t = 12) {
      frozen = true;
      document.body.classList.add('is-capture');
      state.t = t;
      uTime.value = t;
      city.update(0.016, t);
      if (flyover.shots[i].follow === 'train') {
        city.trainState.s = city.railLen - 118 + u * flyover.shots[i].dur * city.trainState.speed;
        city.update(0, t);
      }
      const { p, look } = flyover.pose(i, u);
      camera.position.copy(p);
      camera.lookAt(look);
      pool.update(camera, true);
      $('#fade').style.opacity = 0;
    },
    resume() {
      frozen = false;
    },
    info() {
      const r = renderer.info.render;
      return { calls: r.drawCalls ?? r.calls, triangles: r.triangles };
    },
  };
}

boot().catch((err) => {
  console.error(err);
  loaderText.textContent = 'Could not start: ' + (err && err.message ? err.message : err);
  document.body.classList.add('has-error');
});
