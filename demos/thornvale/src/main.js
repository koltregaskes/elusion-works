// Thornvale: boot, render pipeline, loop, modes and HUD.
import * as THREE from '../../shared/three-r187/build/three.webgpu.js';
import {
  pass, mrt, output, normalView, velocity, vec2, vec3, float, sample, packNormalToRGB, unpackRGBToNormal, renderOutput,
  screenUV, length, smoothstep, hash, mix, Fn,
} from '../../shared/three-r187/build/three.tsl.js';
import { ao } from '../../shared/three-r187/addons/tsl/display/GTAONode.js';
import { bloom } from '../../shared/three-r187/addons/tsl/display/BloomNode.js';
import { traa } from '../../shared/three-r187/addons/tsl/display/TRAANode.js';
import { fxaa } from '../../shared/three-r187/addons/tsl/display/FXAANode.js';
import { loadKit, env } from './kit.js';
import { buildHeightmap, heightTexture, buildMasks, terrainGeometry, mountainGeometry } from './terrain.js';
import { buildTown } from './town.js';
import { Atmosphere, terrainMaterial, mountainMaterial, addGrass, addRain, addStair } from './world.js';
import { loadCharacter, ThirdPerson } from './character.js';
import { Flyover } from './flyover.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
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
  const town = buildTown(scene, kitData, ground, { seed: Number(params.get('seed')) || 11 });
  const masks = buildMasks(town.streets, town.squares);
  const terrain = new THREE.Mesh(terrainGeometry(ground.sample, 512), terrainMaterial(kitData.tex, masks.texture));
  terrain.receiveShadow = true;
  scene.add(terrain);
  const mountains = new THREE.Mesh(mountainGeometry(), mountainMaterial(kitData.tex));
  scene.add(mountains);
  addStair(scene, kitData.mats);
  const grass = addGrass(scene, heightTex, masks.texture, { side: QUALITY.grass });
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
      L.intensity = s.power * 2.2 * n * (1 - THREE.MathUtils.smoothstep(Math.sqrt(s.d2), far * 0.75, far));
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
  const glow = bloom(lit, 0.18, 0.5, 1.1);
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
  const fly = { yaw: 0, pitch: -0.2, pos: new THREE.Vector3(), keys: hero.keys };
  document.addEventListener('mousemove', (e) => {
    if (state.mode !== 'fly' || document.pointerLockElement !== canvas) return;
    fly.yaw -= e.movementX * 0.0022;
    fly.pitch = THREE.MathUtils.clamp(fly.pitch - e.movementY * 0.0022, -1.45, 1.45);
  });
  const hint = $('#hint');
  const showHint = () => hint.classList.toggle('is-on', state.mode !== 'flyover' && document.pointerLockElement !== canvas && !coarse);
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
      }
      if (!coarse) canvas.requestPointerLock?.()?.catch?.(() => {});
    }
    showHint();
  };
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode(b.dataset.mode);
  }));
  canvas.addEventListener('click', () => {
    if (state.mode !== 'flyover' && document.pointerLockElement !== canvas && !coarse) canvas.requestPointerLock?.()?.catch?.(() => {});
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
        const k = fly.keys;
        const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
        const r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
        const u = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') || k.has('KeyC') ? 1 : 0);
        const sp = (k.has('ShiftLeft') ? 80 : 22) * dt;
        const cp = Math.cos(fly.pitch);
        fly.pos.add(new THREE.Vector3(-Math.sin(fly.yaw) * cp, Math.sin(fly.pitch), -Math.cos(fly.yaw) * cp).multiplyScalar(f * sp));
        fly.pos.add(new THREE.Vector3(Math.cos(fly.yaw), 0, -Math.sin(fly.yaw)).multiplyScalar(r * sp));
        fly.pos.y = Math.max(fly.pos.y + u * sp, ground.sample(fly.pos.x, fly.pos.z) + 1.5);
        camera.position.copy(fly.pos);
        camera.quaternion.setFromEuler(new THREE.Euler(fly.pitch, fly.yaw, 0, 'YXZ'));
      }
    }
    atmo.apply();
    grass.update(camera);
    rain.cam.value.copy(camera.position);
    rain.amount.value = atmo.rain;
    updatePool();
    if (atmo.csm) atmo.csm.updateFrustums?.();
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

boot().catch((err) => {
  console.error(err);
  $('#loader-text').textContent = 'Could not start: ' + (err && err.message ? err.message : err);
  document.body.classList.add('has-error');
});
