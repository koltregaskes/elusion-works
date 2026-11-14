// Thornvale: boot, render pipeline, loop, modes and HUD.
import * as THREE from '../../_shared/three-r187/build/three.webgpu.js';
import {
  pass, mrt, output, normalView, velocity, vec2, vec3, float, sample, packNormalToRGB, unpackRGBToNormal, renderOutput,
  screenUV, length, smoothstep, hash, mix, Fn,
} from '../../_shared/three-r187/build/three.tsl.js';
import { ao } from '../../_shared/three-r187/addons/tsl/display/GTAONode.js';
import { bloom } from '../../_shared/three-r187/addons/tsl/display/BloomNode.js';
import { traa } from '../../_shared/three-r187/addons/tsl/display/TRAANode.js';
import { fxaa } from '../../_shared/three-r187/addons/tsl/display/FXAANode.js';
import { loadKit, env } from './kit.js';
import { buildHeightmap, heightTexture, buildMasks, terrainGeometry, mountainGeometry } from './terrain.js';
import { buildTown } from './town.js';
import { Atmosphere, terrainMaterial, mountainMaterial, addGrass, addRain, addStair } from './world.js';
import { loadCharacter, ThirdPerson } from './character.js';
import { Flyover } from './flyover.js';
import { updateFly, lookFly } from './fly-controls.js';

const $ = (s) => document.querySelector(s);
// options come from the query string or the hash (#mode=fly&time=night), so they
// still work where query strings are stripped, such as an embedded copy
const params = new URLSearchParams(location.search);
for (const [k, v] of new URLSearchParams(location.hash.slice(1))) if (!params.has(k)) params.set(k, v);
const coarse = matchMedia('(pointer: coarse)').matches;
const qName = ['low', 'high', 'ultra'].includes(params.get('q')) ? params.get('q') : coarse ? 'low' : 'high';
const QUALITY = {
  ultra: { dpr: 2, ao: true, shadows: true, shadowSize: 4096, grass: 300, lights: 40 },
  high: { dpr: 1.5, ao: true, shadows: true, shadowSize: 2048, grass: 220, lights: 28 },
  low: { dpr: 1, ao: false, shadows: true, shadowSize: 1024, grass: 120, lights: 12 },
}[qName];
const AA = params.get('aa') === 'fxaa' || qName === 'low' ? 'fxaa' : 'traa';

const canvas = $('#scene');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.dpr));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = QUALITY.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.15, 30000);
camera.position.set(200, 150, 120);
camera.lookAt(0, 22, 0);

const setLoad = (f, msg) => {
  $('#loader-bar').style.transform = `scaleX(${f})`;
  if (msg) $('#loader-text').textContent = msg;
};
const state = { mode: 'flyover', ready: false, t: 0 };

async function boot() {
  await renderer.init();
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  setLoad(0.03, `Loading the Blender kit (${backend})`);
  const [kitData, character] = await Promise.all([
    loadKit('assets', (f) => setLoad(0.03 + f * 0.55)),
    loadCharacter('assets/characters'),
  ]);
  setLoad(0.62, 'Shaping the hills');
  await new Promise((r) => setTimeout(r, 0));
  const ground = buildHeightmap();
  const heightTex = heightTexture(ground.data);

  setLoad(0.7, 'Building the town');
  await new Promise((r) => setTimeout(r, 0));
  const atmo = new Atmosphere(renderer, scene, camera, { shadows: QUALITY.shadows, shadowSize: QUALITY.shadowSize });
  const lite = params.get('lite') === '1'; // test captures only: skip the far forest, thin the grass
  const town = buildTown(scene, kitData, ground, { seed: Number(params.get('seed')) || 11, lite });
  const masks = buildMasks(town.streets, town.squares);
  const terrain = new THREE.Mesh(terrainGeometry(ground.sample, 512), terrainMaterial(kitData.tex, masks.texture));
  terrain.receiveShadow = true;
  scene.add(terrain);
  const mountains = new THREE.Mesh(mountainGeometry(), mountainMaterial(kitData.tex));
  scene.add(mountains);
  addStair(scene, kitData.mats);
  const grass = addGrass(scene, heightTex, masks.texture, { side: lite ? 60 : QUALITY.grass });
  const rain = addRain(scene, 9000);
  scene.add(character.root);
  character.root.visible = false;

  // night lights: the nearest lanterns become real point lights
  const lightSrc = town.lights.map((l) => ({ pos: new THREE.Vector3(l.x, l.y, l.z), col: new THREE.Color(l.color), power: l.i, range: l.d, d2: 0 }));
  const pool = [];
  for (let i = 0; i < QUALITY.lights; i++) {
    const L = new THREE.PointLight(0xffaa66, 0, 10, 2);
    scene.add(L);
    pool.push(L);
  }
  let poolFrame = 0;
  const updatePool = (force) => {
    if (!force && poolFrame++ % 4) return;
    const n = env.night.value;
    const c = camera.position;
    for (const s of lightSrc) s.d2 = s.pos.distanceToSquared(c);
    lightSrc.sort((a, b) => a.d2 - b.d2);
    const far = Math.sqrt(lightSrc[Math.min(pool.length, lightSrc.length) - 1]?.d2 || 1);
    pool.forEach((L, i) => {
      const s = lightSrc[i];
      if (!s || n < 0.05) {
        L.intensity = 0;
        return;
      }
      L.position.copy(s.pos);
      L.color.copy(s.col);
      L.distance = s.range * 1.6;
      L.intensity = s.power * 1.5 * n * (1 - THREE.MathUtils.smoothstep(Math.sqrt(s.d2), far * 0.75, far));
    });
  };

  // ------------------------------------------------------------ post-processing
  setLoad(0.82, 'Building the render pipeline');
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView), velocity }));
  scenePass.getTexture('normal').type = THREE.UnsignedByteType;
  const col = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const normalTex = scenePass.getTextureNode('normal');
  const vel = scenePass.getTextureNode('velocity');
  const sceneNormal = sample((u) => unpackRGBToNormal(normalTex.sample(u)));
  let lit = col;
  if (QUALITY.ao) {
    const aoPass = ao(depth, sceneNormal, camera);
    aoPass.resolutionScale = 0.5;
    aoPass.radius.value = 1.0;
    lit = lit.mul(mix(float(1), aoPass.getTextureNode().r, 0.9));
  }
  // the sun disc is thousands of times brighter than anything else: cap what feeds the
  // bloom so it gives a glow around the sun, not a milky veil over the whole frame
  const glow = bloom(lit.min(vec3(5)), 0.18, 0.35, 1.1);
  const combined = lit.add(glow);
  const aa = AA === 'traa' ? traa(combined, depth, vel, camera) : combined;
  const display = renderOutput(aa);
  const graded = Fn(() => {
    const v = smoothstep(1.1, 0.35, length(screenUV.sub(0.5).mul(vec2(1.0, 0.85))));
    const g = hash(screenUV.x.mul(1913.0).add(screenUV.y.mul(7137.0)).add(env.time.mul(61.0))).sub(0.5).mul(0.018);
    // gentle filmic grade: lift shadows a touch, warm highlights
    const c = display.rgb;
    const graded = c.mul(vec3(1.02, 1.0, 0.97)).add(vec3(0.006, 0.006, 0.01));
    return vec3(graded.mul(v.mul(0.22).add(0.78)).add(g));
  })();
  pipeline.outputNode = AA === 'fxaa' ? fxaa(graded) : graded;
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // ------------------------------------------------------------ controls and modes
  const world = { sample: ground.sample, obbs: town.obbs, circles: town.circles };
  const hero = new ThirdPerson(camera, canvas, character, world);
  const flyover = new Flyover(camera, ground.sample, $('#fade'), $('#caption'));
  const fly = { yaw: 0, pitch: -0.2, pos: new THREE.Vector3(), keys: hero.keys, touchMove: hero.touchMove };
  hero.onTouchLook = (dx, dy) => {
    if (state.mode !== 'fly') return;
    lookFly(fly, dx, dy);
  };
  document.addEventListener('mousemove', (e) => {
    if (state.mode !== 'fly' || document.pointerLockElement !== canvas) return;
    fly.yaw -= e.movementX * 0.0022;
    fly.pitch = THREE.MathUtils.clamp(fly.pitch - e.movementY * 0.0022, -1.45, 1.45);
  });
  // pointer lock is a bonus: it can be refused (sandboxed or embedded pages), and
  // dragging with the mouse looks around either way
  let lockRefused = false;
  const tryLock = () => {
    if (coarse || lockRefused || document.pointerLockElement === canvas) return;
    const refuse = () => {
      lockRefused = true;
      showHint();
    };
    try {
      const p = canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(refuse);
    } catch {
      refuse();
    }
  };
  document.addEventListener('pointerlockerror', () => {
    lockRefused = true;
    showHint();
  });
  const hint = $('#hint');
  let hintTimer = 0;
  const showHint = () => {
    const locked = document.pointerLockElement === canvas;
    const on = state.mode !== 'flyover' && !locked;
    clearTimeout(hintTimer);
    if (on) {
      const move = state.mode === 'walk' ? '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk, <kbd>Shift</kbd> runs' : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly, <kbd>Space</kbd>/<kbd>Q</kbd> up and down';
      hint.innerHTML = coarse
        ? 'Drag the left side to move, the right side to look'
        : `Drag to look. ${move}${lockRefused ? '' : '. Click to lock the mouse'}`;
      hintTimer = setTimeout(() => hint.classList.remove('is-on'), 7000);
    }
    hint.classList.toggle('is-on', on);
  };
  document.addEventListener('pointerlockchange', showHint);
  const setMode = (m) => {
    state.mode = m;
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    document.body.dataset.mode = m;
    character.root.visible = m === 'walk';
    if (m === 'flyover') {
      hero.stop();
      if (document.pointerLockElement) document.exitPointerLock();
      flyover.start(flyover.i);
    } else {
      flyover.stop();
      if (m === 'walk') {
        hero.start();
        hero.camPos.set(0, 0, 0);
      } else {
        hero.stop();
        const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        fly.yaw = e.y;
        fly.pitch = e.x;
        fly.pos.copy(camera.position);
        hero.touchEnabled = true;
      }
      tryLock();
    }
    showHint();
  };
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode(b.dataset.mode);
  }));
  canvas.addEventListener('click', () => {
    if (state.mode !== 'flyover' && !hero.wasDrag()) tryLock();
  });
  const TIMES = [[6.6, 'Dawn'], [12.5, 'Midday'], [17.3, 'Golden hour'], [22.5, 'Night']];
  let timeIdx = 2;
  const setTime = (i) => {
    timeIdx = (i + TIMES.length) % TIMES.length;
    atmo.hours = TIMES[timeIdx][0];
    $('#time-btn').textContent = TIMES[timeIdx][1];
  };
  const WEATHER = [['clear', 'Clear'], ['cloudy', 'Cloudy'], ['rain', 'Rain'], ['mist', 'Mist']];
  let wIdx = 0;
  const setWeather = (i) => {
    wIdx = (i + WEATHER.length) % WEATHER.length;
    atmo.setWeather(WEATHER[wIdx][0]);
    $('#weather-btn').textContent = WEATHER[wIdx][1];
  };
  $('#time-btn').addEventListener('click', () => setTime(timeIdx + 1));
  $('#weather-btn').addEventListener('click', () => setWeather(wIdx + 1));
  $('#next-shot').addEventListener('click', () => flyover.next());
  const help = $('#help');
  const toggleHelp = (on) => {
    on = on ?? !help.classList.contains('is-on');
    help.classList.toggle('is-on', on);
  };
  $('#help-toggle').addEventListener('click', () => toggleHelp());
  $('#help-close').addEventListener('click', () => toggleHelp(false));
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Digit1') setMode('walk');
    if (e.code === 'Digit2') setMode('fly');
    if (e.code === 'Digit3') setMode('flyover');
    if (e.code === 'KeyT') setTime(timeIdx + 1);
    if (e.code === 'KeyR') setWeather(wIdx + 1);
    if (e.code === 'KeyH') toggleHelp();
    if (e.code === 'KeyN' && state.mode === 'flyover') flyover.next();
    if (e.code === 'KeyB' && state.mode === 'flyover') flyover.next(-1);
  });
  const startTime = { dawn: 0, midday: 1, golden: 2, night: 3 }[params.get('time')] ?? 2;
  setTime(startTime);
  setWeather({ clear: 0, cloudy: 1, rain: 2, mist: 3 }[params.get('weather')] ?? 0);
  atmo.apply(true);

  setLoad(0.9, 'Compiling shaders');
  await renderer.compileAsync(scene, camera);
  setLoad(1, 'Ready');
  flyover.i = Number(params.get('shot')) || 0;
  setMode(['walk', 'fly', 'flyover'].includes(params.get('mode')) ? params.get('mode') : 'flyover');

  const timer = new THREE.Timer();
  let frames = 0;
  let acc = 0;
  let frozen = false;
  const fpsEl = $('#fps');
  function frame() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    if (!frozen) {
      state.t += dt;
      env.time.value = state.t;
      if (state.mode === 'flyover') flyover.update(dt);
      else if (state.mode === 'walk') hero.update(dt);
      else {
        updateFly(fly, camera, ground, dt);
      }
    }
    atmo.apply();
    grass.update(camera);
    // blades are only drawn within ~35 m; from high up they are sub-pixel, so skip them
    grass.mesh.visible = camera.position.y - ground.sample(camera.position.x, camera.position.z) < 45;
    rain.cam.value.copy(camera.position);
    rain.amount.value = atmo.rain;
    updatePool();
    town.updateForest(camera.position);
    if (atmo.csm) atmo.csm.updateFrustums?.();
    pipeline.render();
    // reveal the town only once real frames are on screen, so the loader never
    // fades to a blank or half-built canvas
    if (++shown === 3) reveal();
    frames++;
    acc += dt;
    if (acc > 0.5) {
      fpsEl.textContent = `${Math.round(frames / acc)} fps · ${backend}`;
      frames = 0;
      acc = 0;
    }
  }
  let shown = 0;
  const title = $('#title');
  const reveal = () => {
    $('#loader').classList.add('is-done');
    if (state.mode === 'flyover' && title) {
      title.classList.add('is-on');
      const hide = () => title.classList.remove('is-on');
      setTimeout(hide, 6500);
      window.addEventListener('pointerdown', hide, { once: true });
      window.addEventListener('keydown', hide, { once: true });
    }
    state.ready = true;
  };
  renderer.setAnimationLoop(frame);

  window.__TV = {
    state,
    stats: { ...town.stats, quality: qName, backend, aa: AA },
    setMode,
    setTime,
    setWeather,
    flyover,
    hero,
    renderer,
    pose(i, u, t = 30) {
      frozen = true;
      document.body.classList.add('is-capture');
      env.time.value = t;
      const { p, look } = flyover.pose(i, u);
      camera.position.copy(p);
      camera.lookAt(look);
      $('#fade').style.opacity = 0;
      updatePool(true);
      town.updateForest(camera.position);
    },
    walkPose(x, z, heading, camYaw) {
      frozen = false;
      setMode('walk');
      hero.pos.set(x, ground.sample(x, z), z);
      hero.heading = heading;
      hero.yaw = camYaw;
      hero.camPos.set(0, 0, 0);
    },
    freeze(v = true) {
      frozen = v;
    },
    layout() {
      return { units: 'metres, y up, yaw about y (radians)', instances: town.layout };
    },
    info() {
      const r = renderer.info.render;
      return { calls: r.drawCalls ?? r.calls, triangles: r.triangles };
    },
  };
}

function canWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

boot().catch((err) => {
  console.error(err);
  const noGpu = !('gpu' in navigator) && !canWebGL2();
  $('#loader-text').textContent = noGpu
    ? 'This browser cannot draw 3D here: Thornvale needs WebGPU or WebGL 2.'
    : 'The town could not be built on this device.';
  const detail = $('#loader-detail');
  if (detail) {
    detail.textContent = noGpu
      ? 'Try an up-to-date Edge, Chrome, Firefox or Safari, and check that hardware acceleration is switched on in the browser settings.'
      : 'Reloading often helps. If it keeps happening, try #q=low at the end of the address. Detail: ' + (err && err.message ? err.message : String(err));
  }
  document.body.classList.add('has-error');
});
