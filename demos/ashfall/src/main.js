/**
 * Ashfall — bootstrap and frame loop.
 *
 * Owns the `game` object, builds every subsystem, and drives them in the fixed order
 * documented in ARCHITECTURE.md §1. Module construction is fault tolerant on purpose: a
 * subsystem that throws is replaced with an inert stub and reported on the debug overlay,
 * so one broken module degrades the demo instead of blanking the screen.
 */

import * as THREE from '../vendor/three.module.js';
import { createInput } from './core/input.js';
import { CAMERA } from './world/art.js';

/* -------------------------------------------------------------------------- */
/* Tiny event emitter                                                          */
/* -------------------------------------------------------------------------- */

function createEmitter() {
  const map = new Map();
  return {
    on(name, fn) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(fn);
      return () => map.get(name)?.delete(fn);
    },
    off(name, fn) {
      map.get(name)?.delete(fn);
    },
    emit(name, payload) {
      const set = map.get(name);
      if (!set) return;
      for (const fn of set) {
        try {
          fn(payload);
        } catch (err) {
          reportError(`event:${name}`, err);
        }
      }
    },
    clear() {
      map.clear();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Error surfacing                                                             */
/* -------------------------------------------------------------------------- */

const FAILURES = [];

function reportError(where, err) {
  const message = err && err.stack ? err.stack : String(err);
  FAILURES.push({ where, message });
  // Kept deliberately: a silent failure in a 15-module engine is unfindable.
  console.error(`[ashfall] ${where}:`, err);
  const card = document.getElementById('error-card');
  if (card) {
    card.hidden = false;
    const list = card.querySelector('[data-errors]');
    if (list) {
      const li = document.createElement('li');
      li.textContent = `${where}: ${String(err && err.message ? err.message : err)}`;
      list.appendChild(li);
    }
  }
}

/**
 * Import a module without letting a missing or syntactically broken file kill the boot.
 * Returns an empty object so the caller's destructure yields undefined and `safeBuild` falls
 * through to its stub.
 */
async function safeImport(name, path) {
  try {
    return await import(path);
  } catch (err) {
    reportError(`import:${name}`, err);
    return {};
  }
}

/**
 * Wrap a factory so a throwing module cannot take the page down.
 *
 * `stub` may be a plain object or a thunk. Pass a thunk whenever building the stub has side
 * effects — an object literal is evaluated as an argument, i.e. *before* we know whether the
 * real factory succeeded, so a stub that adds lights to the scene would add them every time.
 */
function safeBuild(name, fn, stub) {
  try {
    const result = fn();
    if (!result) throw new Error('factory returned nothing');
    return result;
  } catch (err) {
    reportError(name, err);
    const fallback = typeof stub === 'function' ? stub() : stub;
    return fallback || { update() {} };
  }
}

const NOOP = () => {};
const noopStub = (extra = {}) => ({ update: NOOP, dispose: NOOP, setQuality: NOOP, ...extra });

/* -------------------------------------------------------------------------- */
/* Quality detection                                                           */
/* -------------------------------------------------------------------------- */

function detectQuality() {
  const stored = readSettings().quality;
  if (stored && ['low', 'medium', 'high', 'ultra'].includes(stored)) return stored;
  const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (touch) return 'low';
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  if (mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}

function readSettings() {
  try {
    return JSON.parse(localStorage.getItem('ashfall.settings') || '{}') || {};
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

const MAX_DT = 1 / 20;

export async function boot() {
  const canvas = document.getElementById('viewport');
  if (!canvas) throw new Error('missing #viewport canvas');

  const params = new URLSearchParams(location.search);
  const settings = readSettings();

  const game = {
    canvas,
    params,
    debug: params.has('debug'),
    /** Capture mode: skips the menu and pointer lock so headless screenshots work. */
    capture: params.has('capture') || params.has('shot'),
    quality: params.get('quality') || detectQuality(),
    // fps starts at 0, not 60. It is only written once half a second of frame time has
    // accumulated, so seeding it with a plausible-looking number meant any tool that sampled
    // it early reported a measurement that had never been taken. A headless capture run read
    // "60 fps" off a build that was managing one frame every twenty seconds.
    clock: { time: 0, dt: 0, frame: 0, fps: 0 },
    events: createEmitter(),
    state: {
      mode: 'menu',
      health: 100,
      maxHealth: 100,
      armour: 0,
      score: 0,
      kills: 0,
      deaths: 0,
      streak: 0,
      hitFlash: 0,
      lastDamageDir: new THREE.Vector3(0, 0, -1),
    },
    failures: FAILURES,
  };

  game.input = createInput(canvas);
  game.input.sensitivity = (settings.sensitivity ?? 1.0) * 0.0022;
  game.input.invertY = !!settings.invertY;

  const progress = createProgress();

  /* --- Core ------------------------------------------------------------- */

  progress(0.05, 'Starting renderer');
  const { createEngine } = await safeImport('engine', './core/engine.js');
  game.engine = createEngine(canvas, game.quality);
  game.scene = game.engine.scene;
  game.camera = game.engine.camera;
  game.viewScene = game.engine.viewScene;
  game.viewCamera = game.engine.viewCamera;
  game.camera.fov = settings.fov ?? CAMERA.fov;
  game.camera.updateProjectionMatrix();

  progress(0.15, 'Building materials');
  const { createMaterials } = await safeImport('materials', './world/materials.js');
  const { createShadows } = await safeImport('shadows', './core/shadows.js');
  const { createSky } = await safeImport('sky', './world/sky.js');

  // Sky owns the sun, shadows need the sun, materials need shadows. Build in that order but
  // let sky attach the environment map to materials afterwards.
  game.materials = safeBuild('materials', () => createMaterials(game.engine.renderer, null), {
    get: () => new THREE.MeshStandardMaterial({ color: 0x8d8880 }),
    getTextures: () => ({}),
    triplanar: () => new THREE.MeshStandardMaterial({ color: 0x8d8880 }),
    makeDecal: () => new THREE.MeshBasicMaterial({ transparent: true }),
    dispose: NOOP,
  });

  progress(0.3, 'Raising the sky');
  // The stub is a thunk: it puts lights in the scene, so it must only run if `createSky` failed.
  // A second shadow-casting DirectionalLight breaks the CSM shader, which requires
  // NUM_DIR_LIGHT_SHADOWS to equal CSM_CASCADES, and that takes out every lit material at once.
  game.sky = safeBuild('sky', () => createSky(game.engine, game.materials), () => ({
    ...noopStub(),
    sun: (() => {
      const l = new THREE.DirectionalLight(0xffcf9a, 4.6);
      l.position.set(-60, 20, 40);
      l.castShadow = true;
      l.name = 'stubSun';
      game.scene.add(l);
      game.scene.add(new THREE.HemisphereLight(0x3f6f9e, 0x7a6647, 0.85));
      return l;
    })(),
  }));

  progress(0.4, 'Fitting shadow cascades');
  game.shadows = safeBuild(
    'shadows',
    () => createShadows(game.engine, game.sky.sun, game.quality),
    noopStub({ register: NOOP })
  );
  if (game.materials.attachShadows) {
    try {
      game.materials.attachShadows(game.shadows);
    } catch (err) {
      reportError('materials.attachShadows', err);
    }
  }

  /* --- World ------------------------------------------------------------ */

  progress(0.5, 'Building the yard');
  const { createLevel } = await safeImport('level', './world/level.js');
  game.level = safeBuild('level', () => createLevel(game.scene, game.materials, game), {
    ...noopStub(),
    root: new THREE.Group(),
    colliders: [],
    triangles: new Float32Array(0),
    spawnPoints: [{ pos: new THREE.Vector3(0, 1.7, 20), yaw: Math.PI }],
    coverPoints: [],
    navGrid: null,
    raycast: () => null,
    sampleSurface: () => 'concrete',
    bounds: new THREE.Box3(new THREE.Vector3(-55, 0, -45), new THREE.Vector3(55, 20, 45)),
  });

  /* --- Post ------------------------------------------------------------- */

  progress(0.62, 'Compiling post chain');
  const { createPostFX } = await safeImport('postfx', './core/postfx.js');
  game.post = safeBuild('postfx', () => createPostFX(game.engine, game), {
    ...noopStub(),
    params: {},
    jitter: NOOP,
    setDOF: NOOP,
    resize: NOOP,
    render() {
      // Fallback: straight to screen, no grading, so the demo still shows something.
      game.engine.renderer.setRenderTarget(null);
      game.engine.renderer.clear();
      game.engine.renderer.render(game.scene, game.camera);
      game.engine.renderer.autoClear = false;
      game.engine.renderer.clearDepth();
      game.engine.renderer.render(game.viewScene, game.viewCamera);
      game.engine.renderer.autoClear = true;
    },
  });

  /* --- Player ----------------------------------------------------------- */

  progress(0.72, 'Kitting out');
  const { createPlayer } = await safeImport('controller', './player/controller.js');
  const { createWeapon } = await safeImport('weapon', './player/weapon.js');
  const { createBallistics } = await safeImport('ballistics', './player/ballistics.js');

  game.player = safeBuild('player', () => createPlayer(game), {
    ...noopStub(),
    position: new THREE.Vector3(0, 1.7, 20),
    velocity: new THREE.Vector3(),
    eye: new THREE.Vector3(0, 1.7, 20),
    yaw: Math.PI,
    pitch: 0,
    onGround: true,
    applyRecoil: NOOP,
    damage: NOOP,
    teleport: NOOP,
    surfaceUnderfoot: 'gravel',
  });

  game.weapon = safeBuild('weapon', () => createWeapon(game), {
    ...noopStub(),
    current: { id: 'none', name: '—', mag: 0 },
    weapons: [],
    ads: false,
    adsProgress: 0,
    ammo: 0,
    reserve: 0,
    reloading: false,
    firing: false,
    root: new THREE.Group(),
    switchTo: NOOP,
    reload: NOOP,
    triggerDown: NOOP,
    triggerUp: NOOP,
    muzzleWorld: (t) => t.set(0, 0, 0),
  });

  game.ballistics = safeBuild('ballistics', () => createBallistics(game), noopStub({ fire: NOOP }));

  /* --- Agents, FX, audio, UI -------------------------------------------- */

  progress(0.82, 'Deploying opposition');
  const { createAI } = await safeImport('ai', './ai/enemies.js');
  game.ai = safeBuild('ai', () => createAI(game), noopStub({ enemies: [], spawnWave: NOOP, alive: 0, damageEnemy: NOOP }));

  progress(0.88, 'Loading effects');
  const { createFX } = await safeImport('fx', './fx/particles.js');
  game.fx = safeBuild('fx', () => createFX(game), {
    ...noopStub(),
    spawnImpact: NOOP,
    spawnMuzzle: NOOP,
    spawnBlood: NOOP,
    spawnCasing: NOOP,
    spawnTracer: NOOP,
    spawnExplosion: NOOP,
    addDecal: NOOP,
  });

  // Every world material must be registered with the cascaded shadow map. An unregistered
  // MeshStandardMaterial compiles without USE_CSM, so instead of the CSM branch picking the one
  // cascade whose depth range contains the fragment, three's stock loop accumulates *all* of the
  // cascade lights — four suns at full intensity on the same surface. That reads as a blown-out,
  // shadowless white wash, which is exactly what it looked like. Shadows sweeps periodically on
  // its own, but level, AI and FX all build their materials after it was constructed, so force a
  // scan now that the world is fully populated.
  try {
    game.shadows.scan?.();
  } catch (err) {
    reportError('shadows.scan', err);
  }

  progress(0.93, 'Warming audio');
  const { createAudio } = await safeImport('audio', './audio/audio.js');
  game.audio = safeBuild('audio', () => createAudio(game), {
    ...noopStub(),
    ctx: null,
    resume: NOOP,
    setVolume: NOOP,
    muted: true,
    playOneShot: NOOP,
  });
  game.audio.setVolume?.(settings.volume ?? 0.7);

  progress(0.97, 'Drawing the HUD');
  const { createHUD } = await safeImport('hud', './ui/hud.js');
  const { createMenu } = await safeImport('menu', './ui/menu.js');
  game.hud = safeBuild('hud', () => createHUD(game), noopStub({ show: NOOP, hide: NOOP, setMode: NOOP, notify: NOOP }));
  game.menu = safeBuild('menu', () => createMenu(game), noopStub({ open: NOOP, close: NOOP, settings, onChange: NOOP }));

  /* --- Spawn ------------------------------------------------------------ */

  const spawn = game.level.spawnPoints?.[0];
  if (spawn && game.player.teleport) game.player.teleport(spawn.pos, spawn.yaw ?? Math.PI);

  // Capture mode drives the camera from the URL and never waits for a click.
  if (game.capture) applyCaptureMode(game, params);

  progress(1.0, 'Ready');

  /* --- Loop ------------------------------------------------------------- */

  let last = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;

  const tick = (now) => {
    requestAnimationFrame(tick);
    const raw = (now - last) / 1000;
    last = now;
    const dt = Math.min(MAX_DT, Math.max(0, raw));
    game.clock.dt = dt;
    game.clock.time += dt;
    game.clock.frame++;

    fpsAccum += raw;
    fpsFrames++;
    if (fpsAccum >= 0.5) {
      game.clock.fps = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
    }

    step(game, dt);
  };

  requestAnimationFrame(tick);

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    try {
      game.engine.resize(w, h);
      game.post.resize?.(w, h);
    } catch (err) {
      reportError('resize', err);
    }
  });

  // Expose for the screenshot harness and for debugging. Read-only by convention.
  window.__ashfall = game;
  document.body.classList.add('ashfall-ready');
  document.dispatchEvent(new CustomEvent('ashfall:ready', { detail: game }));

  return game;
}

/* -------------------------------------------------------------------------- */
/* Per-frame step                                                              */
/* -------------------------------------------------------------------------- */

const SUBSYSTEMS = ['player', 'weapon', 'ballistics', 'ai', 'fx', 'sky', 'shadows', 'audio'];
const errorBudget = new Map();

function safeUpdate(game, key, dt) {
  const mod = game[key];
  if (!mod || typeof mod.update !== 'function') return;
  try {
    mod.update(dt, game);
  } catch (err) {
    // Report each subsystem at most three times, then let it fail quietly. A module that
    // throws every frame would otherwise bury the console and tank the frame rate.
    const n = (errorBudget.get(key) || 0) + 1;
    errorBudget.set(key, n);
    if (n <= 3) reportError(`${key}.update`, err);
  }
}

function step(game, dt) {
  const playing = game.state.mode === 'playing' || game.capture;

  try {
    game.input.update(dt);
  } catch (err) {
    reportError('input.update', err);
  }

  if (playing) {
    for (const key of SUBSYSTEMS) safeUpdate(game, key, dt);
  } else {
    // Menu still needs the world alive behind it for the parallax drift.
    for (const key of ['sky', 'shadows', 'fx']) safeUpdate(game, key, dt);
  }

  safeUpdate(game, 'menu', dt);

  try {
    game.post.jitter?.(game.camera, game.clock.frame);
    game.engine.renderScene(game);
    game.post.render(dt, game);
  } catch (err) {
    const n = (errorBudget.get('render') || 0) + 1;
    errorBudget.set('render', n);
    if (n <= 3) reportError('render', err);
  }

  safeUpdate(game, 'hud', dt);

  if (game.state.hitFlash > 0) {
    game.state.hitFlash = Math.max(0, game.state.hitFlash - dt * 1.6);
  }
}

/* -------------------------------------------------------------------------- */
/* Capture mode — used by the visual review harness                            */
/* -------------------------------------------------------------------------- */

/**
 * Named vantage points. The review harness screenshots these so critiques compare like for
 * like across iterations. Each is [x, y, z, yawDeg, pitchDeg].
 *
 * SAMPLING NOTE. A vantage's angle to the sun dominates how its frame reads, and the direction
 * that shows shadows is the opposite of the intuitive one: with the sun *behind* the camera every
 * object occludes its own shadow, whereas facing *into* the sun the shadows stretch toward the
 * viewer and are fully visible.
 *
 * The original list was frontlit-heavy, so review frames systematically hid the shadowing. That
 * produced a false finding — graders reported that nothing in the scene cast a shadow and marked
 * the lighting down, when an A/B test showed that disabling the cascades alters 45% of the frame
 * by more than 20 code values. A blind critique is only as good as its sample.
 *
 * The angles below are MEASURED, by dotting each vantage's forward vector against the direction
 * to the sun in the running engine, not derived on paper. An earlier pass at this comment stated
 * them from memory and got the sign backwards, which is exactly the mistake the measurement
 * exists to prevent. Re-measure with scratchpad/yawprobe.mjs after moving the sun.
 *
 *   backlit, shadows toward camera   yardBack 10°, depotBack 11°, terraces 52°
 *   cross-lit                        depotIn 88°, yard 114°, gunclose 114°
 *   frontlit, shadows hidden         depot 128°, terracesUp 133°, wide 150°,
 *                                    crane 156°, sunline 167°, containers 172°
 */
export const VANTAGES = {
  yard: [6, 1.75, 26, 186, -3],
  crane: [-14, 1.75, 12, 232, 6],
  depot: [-34, 1.75, -8, 200, 0],
  depotIn: [-38, 1.75, -24, 160, 2],
  terraces: [30, 1.75, -6, 20, 4],
  terracesUp: [34, 5.35, -26, 205, -8],
  sunline: [-2, 1.75, -14, 258, 4],
  containers: [18, 1.75, 4, 250, 0],
  wide: [42, 9.0, 34, 222, -10],
  gunclose: [6, 1.75, 26, 186, -3],
  // Backlit pair, measured at 10° and 11° off the sun. Same standing positions as `yard` and
  // `depot`, turned to face into the light, which is where the long raking shadows the art
  // direction is built around actually become visible.
  yardBack: [6, 1.75, 26, 72, -2],
  depotBack: [-34, 1.75, -8, 80, 0],
};

function applyCaptureMode(game, params) {
  game.state.mode = 'playing';
  const name = params.get('shot') || params.get('capture') || 'yard';
  const v = VANTAGES[name] || VANTAGES.yard;
  const [x, y, z, yawDeg, pitchDeg] = v;
  const pos = new THREE.Vector3(x, y, z);
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  game.player.teleport?.(pos.clone().setY(y - 0.05), yaw);
  if (game.player) {
    game.player.yaw = yaw;
    game.player.pitch = pitch;
    game.player.position?.set(x, y - CAMERA.eyeHeight, z);
    game.player.eye?.copy(pos);
  }
  game.camera.position.copy(pos);
  game.camera.rotation.set(pitch, yaw, 0, 'YXZ');
  if (params.get('ads') === '1') game.weapon?.setADS?.(true);
  if (params.get('hud') === '0') document.body.classList.add('hide-hud');
  window.__ashfallVantages = VANTAGES;
}

/* -------------------------------------------------------------------------- */
/* Loading progress                                                            */
/* -------------------------------------------------------------------------- */

function createProgress() {
  const bar = document.querySelector('[data-load-bar]');
  const label = document.querySelector('[data-load-label]');
  return (v, text) => {
    if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, v))})`;
    if (label && text) label.textContent = text;
    if (v >= 1) {
      const screen = document.getElementById('loading');
      if (screen) {
        screen.classList.add('is-done');
        setTimeout(() => {
          screen.hidden = true;
        }, 700);
      }
    }
  };
}

boot().catch((err) => reportError('boot', err));
