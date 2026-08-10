import * as THREE from '../vendor/three/build/three.module.js';
import { Engine } from './core/engine.js';
import { Loop } from './core/loop.js';
import { bus } from './core/events.js';
import { makeRng } from './core/rng.js';
import { Shell } from './ui/shell.js';
/* Lane C's tutorial and codex. Side-effect import by design: it defers its own
   install by a macrotask so the `window.__VS = {…}` assignment below cannot
   discard its handle, injects its own stylesheet, and registers its `tutorial`
   and `codex` panels through `shell.registerPanel` when the shell appears —
   its `tutorial` panel replacing the placeholder this file's shell ships. */
import './ui/tutorial.js';

/* Bootstrap and match lifecycle.

   Two things live here. The first is the boot sequence, which is unchanged in
   spirit: each subsystem loads in its own stage so a failure is isolated and
   reportable rather than a blank canvas, and stages that can degrade do.

   The second is new, and it is the reason this file grew: **a match is built
   and torn down in place, without reloading the page.** Restart and quit used
   to be `location.href = …`, which threw away the warmed shader cache and cost
   5–13 s every time. The renderer, the canvas, the loop and — where the seed
   and detail tier have not changed — the texture atlases, the hull cache, the
   nebula and the audio graph all survive a restart now. Only the world, the FX
   pools, the camera, the input and the HUD are rebuilt.

   `ui/shell.js` owns the screens and the state machine. This file owns the
   engine-side operations the shell asks for, handed over as a small `game`
   interface. Nothing in the shell knows what Three.js is. */

const params = new URLSearchParams(location.search);

/* Quality presets, mirrored from `core/engine.js`, which does not export them.
   Duplicated deliberately and knowingly: changing the detail tier without a
   page reload means writing `engine.preset` from out here, and a wrong pixel
   ratio is a visible defect rather than a silent one. If engine.js ever
   exports the table, delete this. */
const QUALITY_PRESETS = {
  low: { dpr: 1.0, shadows: false, shadowSize: 1024, anisotropy: 2, samples: 0 },
  medium: { dpr: 1.25, shadows: true, shadowSize: 1536, anisotropy: 4, samples: 0 },
  high: { dpr: 1.5, shadows: true, shadowSize: 2048, anisotropy: 8, samples: 2 },
  ultra: { dpr: 2.0, shadows: true, shadowSize: 4096, anisotropy: 16, samples: 4 },
};

const QUALITIES = ['low', 'medium', 'high', 'ultra'];

/* Three never frees the PMREM it derives from a render-target environment map,
   and the sky is one.

   Measured, not guessed: hooking `renderer.properties.get` and listing every
   texture still holding a `__webglTexture` showed **one PMREM.cubeUv leaked per
   rebuild**, for ever. In `WebGLCubeUVMaps.get()` the `texture.isRenderTargetTexture`
   branch caches the generated PMREM and returns — it is the *other* branch that
   attaches the `dispose` listener which would free it. So a sky baked into a
   `WebGLRenderTarget` and assigned to `scene.environment` derives a PMREM that
   nothing in three will ever release; even `renderer.dispose()` only resets the
   WeakMap. The cache is a closure-local WeakMap, so the only handle on the
   render target is the generator call that produced it.

   Wrapping the prototype is deliberate and contained: `vendor/three` is frozen
   and stays untouched. The right long-term home is `render/skybox.js`, whose
   `dispose()` could free the PMREM its own render target caused — that is an
   ENV-owned change and is in this lane's report. */
const _pmremTargets = new Set();
if (THREE.PMREMGenerator && THREE.PMREMGenerator.prototype.fromEquirectangular) {
  const inner = THREE.PMREMGenerator.prototype.fromEquirectangular;
  THREE.PMREMGenerator.prototype.fromEquirectangular = function fromEquirectangular(tex, rt) {
    const out = inner.call(this, tex, rt);
    if (out && out.dispose) _pmremTargets.add(out);
    return out;
  };
}

/** Word seeds hash so `?seed=kharak` is stable and shareable. */
function normaliseSeed(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  if (text === '') return (Math.floor(Math.random() * 0xfffffff) + 1) >>> 0;
  const n = Number(text);
  if (Number.isFinite(n)) return Math.abs(Math.trunc(n)) || 1;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

/** Pick a starting tier from coarse device signals. */
function autoQuality() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  if (coarse || small || mem <= 2 || cores <= 2) return 'low';
  if (mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}

const SEED_TEXT = params.get('seed') || '';
const DIFFICULTY = (() => {
  const d = params.get('difficulty');
  return d && ['easy', 'normal', 'hard'].includes(d) ? d : 'normal';
})();
const QUALITY = (() => {
  const q = params.get('quality');
  return q && QUALITIES.includes(q) ? q : autoQuality();
})();

function fatal(message, detail) {
  const el = document.getElementById('vs-fatal');
  const d = document.getElementById('vs-fatal-detail');
  if (d) d.textContent = message;
  if (el) el.hidden = false;
  const shell = document.getElementById('vs-shell');
  if (shell) shell.remove();
  const vs = window.__VS || (window.__VS = {});
  vs.fatal = { message, detail: detail ? String(detail.stack || detail) : null };
}

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch (e) {
    return false;
  }
}

/** Load a module, returning null (and recording why) instead of throwing. */
const loadErrors = [];
async function tryImport(path, label) {
  try {
    return await import(path);
  } catch (e) {
    loadErrors.push({ label, path, error: String(e && e.message ? e.message : e) });
    return null;
  }
}

/* Give the browser a chance to paint between stages.

   Raced against a timer on purpose: a backgrounded or hidden tab throttles
   requestAnimationFrame to nearly nothing, and a boot that awaits rAF simply
   stops. Switching tabs while the sky bakes must not wedge the load. */
const yieldFrame = () =>
  new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 60);
  });

/* The live match, and the assets a match is built on. Split because the second
   group survives a restart whenever the seed and the detail tier have not
   changed, and that split is the whole of the "restart must not reload"
   requirement. */
const M = {
  world: null,
  fx: null,
  cameraRig: null,
  input: null,
  hud: null,
};

const A = {
  key: null,          // `${seed}|${quality}` the current assets were built for
  environment: null,
  audio: null,
  fallbackLights: null,
  textures: null,
  materials: null,
  ships: null,
};

/* The loop needs a world every frame. Between matches it gets this, so
   rendering — and therefore the warmed program cache, the resize handling and
   the frame clock — never stops. */
const NULL_WORLD = {
  tick() {},
  syncTransforms() {},
  entities: new Map(),
  teams: [],
  time: 0,
  dispose() {},
};

async function main() {
  if (!hasWebGL2()) {
    fatal('Void Sovereign needs WebGL 2, which this browser or device does not provide.');
    return;
  }

  const canvas = document.getElementById('vs-canvas');
  const vs = (window.__VS = {
    ready: false,
    THREE,
    bus,
    loadErrors,
    seed: normaliseSeed(SEED_TEXT),
    quality: QUALITY,
    bootTimings: [],
  });

  let engine;
  try {
    engine = new Engine({ canvas, quality: QUALITY });
  } catch (e) {
    fatal('The renderer failed to start on this device.', e);
    return;
  }
  vs.engine = engine;

  let post = null;
  let halted = true;               // nothing is running until a match is

  /* One loop for the life of the page.

     Halting is a property intercept rather than a time scale of zero, because
     the two must not be the same control: the player's own tactical pause and
     speed setting live in `timeScale`, and a shell pause that wrote 0 into it
     would be silently undone by the next `ui:speed` the HUD sends, or would
     forget which speed to restore. With this, `Loop._frame` reads 0 while the
     shell is halted, so the fixed-step accumulator genuinely does not advance
     — `_accum` is untouched, `world.tick()` is never called and `loop.tick`
     does not increment — while `world.syncTransforms()` and `engine.render()`
     carry on and the scene stays live behind the menu. The player's speed is
     underneath, unchanged, and comes back on resume. */
  const loop = new Loop({ engine, world: NULL_WORLD, hz: 30 });
  vs.loop = loop;
  let userTimeScale = loop.timeScale;
  Object.defineProperty(loop, 'timeScale', {
    configurable: true,
    get() {
      return halted ? 0 : userTimeScale;
    },
    set(v) {
      const n = Number(v);
      userTimeScale = Number.isFinite(n) ? Math.max(0, n) : 0;
    },
  });
  Object.defineProperty(loop, 'halted', {
    configurable: true,
    get() {
      return halted;
    },
  });

  /* One render hook for the life of the page, reading whatever is currently
     built. Registering a fresh hook per match leaked one closure per restart
     and left dead subsystems being ticked. */
  engine.registerRenderHook((dt, elapsed) => {
    if (M.cameraRig && M.cameraRig.update) M.cameraRig.update(dt);
    if (M.input && M.input.update) M.input.update(dt);
    // Must run every frame, not just on events: the listener frame, distance
    // attenuation, voice stealing and the score's scheduler all advance here.
    if (A.audio) A.audio.update(dt, elapsed, engine.camera);
    if (A.environment && A.environment.update) A.environment.update(dt, elapsed, engine.camera);
    if (A.materials && A.materials.updateMaterials) A.materials.updateMaterials(elapsed);
    if (M.fx) M.fx.update(dt, elapsed, engine.camera);
    if (M.hud) M.hud.update(dt);
  }, 'frame');

  engine.onFailure = (message, info) => {
    if (info && info.kind === 'contextlost') {
      vs.ready = false;
      loop.stop();
      fatal(message, null);
      return;
    }
    bus.emit('ui:toast', { text: message, kind: 'warning' });
  };

  loop.start();

  /* ------------------------------------------------------------- teardown */

  /** Tear the live match down. `deep` also frees the seed-scoped assets. */
  function teardown(deep) {
    /* Per-step GPU accounting, left in on purpose. "Restart does not leak" is
       a claim that has to be re-provable after any change to any of these
       modules, and a single before/after pair only tells you *that* something
       leaked. `__VS.lastTeardown` names which call did it. */
    const trace = [];
    const info = engine.renderer.info;
    let lastT = info.memory.textures;
    let lastG = info.memory.geometries;
    const note = (label) => {
      const t = info.memory.textures;
      const g = info.memory.geometries;
      trace.push({ label, textures: t - lastT, geometries: g - lastG });
      lastT = t;
      lastG = g;
    };
    vs.lastTeardown = trace;
    trace.push({ label: 'before', textures: lastT, geometries: lastG });

    loop.world = NULL_WORLD;
    if (M.hud) M.hud.dispose();
    if (M.input && M.input.dispose) M.input.dispose();
    if (M.cameraRig && M.cameraRig.dispose) M.cameraRig.dispose();
    // World teardown calls back into FX to detach entities, so FX outlives it.
    if (M.world) M.world.dispose();
    note('world');
    if (M.fx) M.fx.dispose();
    note('fx');
    M.world = null;
    M.fx = null;
    M.cameraRig = null;
    M.input = null;
    M.hud = null;

    /* Hull geometry and the fleet batches are shared across every entity of a
       class, so `World` deliberately does not free them — releasing them on
       one ship's death would delete the geometry every other ship of that
       class draws from. They belong to the ships module, so teardown is ours. */
    if (A.ships && A.ships.disposeFleetBatches) A.ships.disposeFleetBatches();
    note('fleetBatches');

    if (!deep) {
      /* Shallow restart keeps the nebula, but ENV's ore records are adopted by
         the sim *in place* and mined down over a match. Handing a worked-out
         field to a fresh skirmish is the kind of leak that survives ten
         restarts looking like a balance problem. */
      resetClusters(A.environment);
      return;
    }

    if (A.ships && A.ships.disposeShipCache) A.ships.disposeShipCache();
    note('shipCache');
    if (A.audio) A.audio.dispose();
    A.audio = null;

    /* Grab whatever the sky is wired into before ENV lets go of it. See the
       explicit dispose below — this pair is the leak. */
    const derived = [engine.scene.environment, engine.farScene.background].filter(
      (t) => t && t.isTexture,
    );

    if (A.environment && A.environment.dispose) A.environment.dispose();
    A.environment = null;
    note('environment');

    /* Measured, not guessed: **+1 CubeTexture and +1 PMREM.cubeUv leaked per
       rebuild** before this ran, found by hooking `renderer.properties.get` and
       listing every texture still holding a `__webglTexture`.

       The sky is an equirectangular *render target*. Three derives two more
       GPU textures from it — `WebGLCubeMaps` builds a CubeTexture for
       `scene.background`, `WebGLCubeUVMaps` builds a PMREM for
       `scene.environment` — and frees each of them from a `dispose` listener
       it attaches to the **source texture**. `WebGLRenderTarget.dispose()`
       dispatches on the render target, not on its texture, so that listener
       never fires and both derived maps outlive the sky that produced them.
       Disposing the texture object itself is what closes it. The GPU texture
       is already gone by this point, so this is only the notification. */
    for (const t of derived) {
      try {
        t.dispose();
      } catch (e) {
        /* already gone with its render target */
      }
    }
    /* The PMREM half of the same problem — see the prototype wrap at the top of
       this file. Safe here and only here: every sky that produced one of these
       has just been disposed, and the new one is generated after this returns. */
    for (const rt of _pmremTargets) {
      try {
        rt.dispose();
      } catch (e) {
        /* nothing to free */
      }
    }
    _pmremTargets.clear();
    note('skyDerivedMaps');
    if (A.fallbackLights) {
      for (const l of A.fallbackLights) engine.scene.remove(l);
      A.fallbackLights = null;
    }
    // disposeMaterials() frees the texture library as well.
    if (A.materials && A.materials.disposeMaterials) A.materials.disposeMaterials();
    else if (A.textures && A.textures.disposeTextures) A.textures.disposeTextures();
    note('materials+textures');
    A.key = null;
  }

  /** ENV's cluster records are shared with the sim; reset what a match mutates. */
  function resetClusters(environment) {
    if (!environment) return;
    let list = null;
    try {
      list = environment.resourceClusters;
    } catch (e) {
      list = null;
    }
    if (!list || !list.length) return;
    for (const c of list) {
      if (!c) continue;
      if (c.maxAmount > 0) c.amount = c.maxAmount;
      c.control = 0;
      c.owner = undefined;
      if (c.presence) {
        c.presence[0] = 0;
        c.presence[1] = 0;
      }
      c.miners = [0, 0];
      c.threat = [0, 0];
      c._fill = undefined;
    }
  }

  /* -------------------------------------------------------------- building */

  /** Detail tier without a page reload. */
  function applyQuality(q) {
    const preset = QUALITY_PRESETS[q] || QUALITY_PRESETS.high;
    engine.quality = q;
    engine.preset = preset;
    engine.renderer.shadowMap.enabled = preset.shadows;
    engine.maxAnisotropy = Math.min(
      preset.anisotropy,
      engine.renderer.capabilities.getMaxAnisotropy(),
    );
    engine.resize();
    if (post && post.setQuality) post.setQuality(q);
    vs.quality = q;
  }

  let building = false;

  /**
   * Build a match. Reuses everything it legitimately can: if the seed and the
   * detail tier are unchanged, the atlases, the hull cache, the nebula and the
   * audio graph are all kept and only the sim-side is rebuilt.
   */
  async function startMatch(setup, progress) {
    if (building) throw new Error('a match is already being built');
    building = true;
    const t0 = performance.now();
    const step = (v, label) => {
      if (progress) progress(v, label);
    };

    try {
      const seed = normaliseSeed(setup.seed);
      const quality = QUALITIES.includes(setup.quality) ? setup.quality : QUALITY;
      const difficulty = ['easy', 'normal', 'hard'].includes(setup.difficulty)
        ? setup.difficulty
        : 'normal';
      const key = `${seed}|${quality}`;
      const deep = A.key !== key;

      teardown(deep);
      if (quality !== engine.quality) applyQuality(quality);

      vs.seed = seed;
      const rng = makeRng(seed);
      vs.rng = rng;

      /* Stage timings and per-stage GPU allocation, both kept. The second half
         is the counterpart to the teardown trace: between them, any stage that
         allocates more than its dispose frees is named rather than inferred. */
      const timings = [];
      const mem = engine.renderer.info.memory;
      const mark = async (v, label, fn) => {
        step(v, label);
        await yieldFrame();
        const t = performance.now();
        const t0Tex = mem.textures;
        const t0Geo = mem.geometries;
        await fn();
        timings.push({
          label,
          ms: Math.round(performance.now() - t),
          dTex: mem.textures - t0Tex,
          dGeo: mem.geometries - t0Geo,
        });
        await yieldFrame();
      };

      if (deep) {
        await mark(0.08, 'Printing hull plating…', async () => {
          const mod = await tryImport('./render/textures.js', 'textures');
          A.textures = mod;
          if (mod && mod.initTextureLibrary) {
            try {
              mod.initTextureLibrary(engine.renderer, rng.fork(11), { quality });
            } catch (e) {
              loadErrors.push({ label: 'textures:init', error: String(e.message) });
            }
          }
        });

        await mark(0.18, 'Mixing paint and primer…', async () => {
          const mod = await tryImport('./render/materials.js', 'materials');
          A.materials = mod;
          if (mod && mod.initMaterials) {
            try {
              mod.initMaterials(engine.renderer, { quality, rng: rng.fork(12) });
            } catch (e) {
              loadErrors.push({ label: 'materials:init', error: String(e.message) });
            }
          }
        });

        await mark(0.32, 'Painting the nebula…', async () => {
          const mod = await tryImport('./render/environment.js', 'environment');
          A.environment = null;
          if (mod && mod.Environment) {
            try {
              A.environment = new mod.Environment({
                engine,
                rng: rng.fork(21),
                textures: A.textures,
                seed,
                quality,
              });
              for (const light of A.environment.lights || []) engine.scene.add(light);
            } catch (e) {
              loadErrors.push({ label: 'environment', error: String(e.stack || e.message) });
            }
          }
          if (!A.environment) A.fallbackLights = installFallbackLighting(engine);
        });

        await mark(0.48, 'Laying down keels…', async () => {
          const mod = await tryImport('./ships/index.js', 'ships');
          A.ships = mod;
          if (mod && mod.warmShipCache) {
            try {
              mod.warmShipCache(rng.fork(31));
            } catch (e) {
              loadErrors.push({ label: 'ships:warm', error: String(e.message) });
            }
          }
        });
      } else {
        step(0.5, 'Reusing the warmed universe…');
        await yieldFrame();
      }

      await mark(0.62, 'Priming the ordnance…', async () => {
        const mod = await tryImport('./fx/index.js', 'fx');
        if (mod && mod.FXSystem) {
          try {
            M.fx = new mod.FXSystem({
              engine,
              materials: A.materials,
              textures: A.textures,
              quality,
            });
          } catch (e) {
            loadErrors.push({ label: 'fx', error: String(e.stack || e.message) });
          }
        }
      });

      let worldMod = null;
      await mark(0.7, 'Reading the sailing orders…', async () => {
        worldMod = await tryImport('./sim/world.js', 'world');
      });
      if (!worldMod || !worldMod.World) throw new Error('the simulation failed to load');
      await mark(0.74, 'Deploying the fleets…', async () => {
        M.world = new worldMod.World({
          seed,
          engine,
          fx: M.fx,
          ships: A.ships,
          environment: A.environment,
          options: { difficulty },
        });
      });

      await mark(0.84, 'Handing you the bridge…', async () => {
        const cameraMod = await tryImport('./core/camera.js', 'camera');
        if (cameraMod && cameraMod.CameraRig) {
          try {
            M.cameraRig = new cameraMod.CameraRig({ engine, domElement: canvas, world: M.world });
          } catch (e) {
            loadErrors.push({ label: 'camera', error: String(e.stack || e.message) });
          }
        }
        if (!M.cameraRig) M.cameraRig = makeFallbackCamera(engine);
        frameOpeningShot(M.world, M.cameraRig);

        const inputMod = await tryImport('./core/input.js', 'input');
        if (inputMod && inputMod.InputController) {
          try {
            M.input = new inputMod.InputController({
              engine,
              domElement: canvas,
              camera: M.cameraRig,
              world: M.world,
            });
          } catch (e) {
            loadErrors.push({ label: 'input', error: String(e.stack || e.message) });
          }
        }
      });

      await mark(0.9, 'Opening the comms channel…', async () => {
        if (A.audio) {
          /* The soundscape is deterministic per seed and the graph is expensive
             — but the real reason this is re-pointed rather than rebuilt is
             that every `AudioSystem` opens an `AudioContext`, browsers cap the
             number of live contexts at around six, and `close()` is async. Ten
             restarts in a row would run out of them. */
          A.audio.world = M.world;
          A.audio.cameraRig = M.cameraRig;
          return;
        }
        const audioMod = await tryImport('./audio/index.js', 'audio');
        if (audioMod && audioMod.AudioSystem) {
          try {
            A.audio = new audioMod.AudioSystem({
              seed,
              engine,
              world: M.world,
              camera: M.cameraRig,
            });
          } catch (e) {
            // Never fatal. A browser that blocks AudioContext must still play.
            loadErrors.push({ label: 'audio', error: String(e.stack || e.message) });
          }
        }
      });

      await mark(0.95, 'Bringing the displays up…', async () => {
        const hudMod = await tryImport('./ui/hud.js', 'hud');
        if (hudMod && hudMod.HUD) {
          try {
            M.hud = new hudMod.HUD({
              engine,
              world: M.world,
              camera: M.cameraRig,
              container: document.getElementById('vs-hud'),
              audio: A.audio,
            });
          } catch (e) {
            loadErrors.push({ label: 'hud', error: String(e.stack || e.message) });
          }
        }
      });

      if (!post) {
        await mark(0.98, 'Grading the image…', async () => {
          const postMod = await tryImport('./render/postfx.js', 'postfx');
          if (postMod && postMod.PostFX) {
            try {
              post = new postMod.PostFX(engine);
              if (post.setQuality) post.setQuality(quality);
              engine.setPostProcess(post);
            } catch (e) {
              loadErrors.push({ label: 'postfx', error: String(e.stack || e.message) });
              engine.setPostProcess(null);
            }
          }
          vs.post = post;
          if (params.get('adaptive') === '1') installAdaptiveQuality(loop, engine, post);
        });
      }

      A.key = key;
      loop.world = M.world;
      // The HUD's boot card is dormant in the shipped build — the shell owns
      // loading — but anything listening for `ui:ready` still gets it.
      bus.emit('ui:ready', { seed, quality, difficulty });

      vs.bootTimings = timings;
      vs.lastBuildMs = Math.round(performance.now() - t0);
      vs.lastBuildDeep = deep;
      reportDegraded();
      return { seed, quality, difficulty };
    } finally {
      building = false;
    }
  }

  /* Open on the player's mothership.

     Framed off hull *length*, not bounding radius. Radius × 7.5 put the camera
     9.2 km out — 4.8 hull lengths — and the flagship came in at 324 px of a
     1920 px frame, one element among asteroids rather than the subject. */
  function frameOpeningShot(world, rig) {
    const playerBase = world.entities.get(world.teams[0].baseId);
    if (playerBase && rig.focusOn) {
      const hullLength = (playerBase.def && playerBase.def.length) || playerBase.radius * 2;
      rig.focusOn(playerBase.position, hullLength * 2.1, true);
      return;
    }
    // Seen on at least one seed: teams[0].baseId did not resolve to an entity.
    loadErrors.push({ label: 'camera:openingFrame', error: 'player base entity did not resolve' });
    const home = world.teams[0] && world.teams[0].homePosition;
    if (home && rig.focusOn) rig.focusOn(home, 4000, true);
  }

  /* Say so when a subsystem degraded. Per-stage isolation keeps a broken
     module from blanking the canvas, which is right — but it also means the
     game can run for hours quietly missing its lighting with only a
     console-free array to show for it. */
  let reportedErrors = 0;
  function reportDegraded() {
    if (loadErrors.length <= reportedErrors) return;
    reportedErrors = loadErrors.length;
    const labels = [...new Set(loadErrors.map((e) => String(e.label).split(':')[0]))];
    bus.emit('ui:toast', {
      text: `Running degraded — ${labels.join(', ')} failed to load. See __VS.loadErrors.`,
      kind: 'warning',
    });
  }

  /* ----------------------------------------------------------------- shell */

  const shell = new Shell({
    root: document.getElementById('vs-shell'),
    hudEl: document.getElementById('vs-hud'),
    stageEl: document.getElementById('vs-stage'),
    defaults: {
      seed: SEED_TEXT || String(vs.seed),
      difficulty: DIFFICULTY,
      quality: QUALITY,
    },
    game: {
      start: (setup, progress) => startMatch(setup, progress),
      stop: () => teardown(false),
      setHalted: (v) => {
        halted = !!v;
      },
      stats: () => (M.hud ? M.hud.matchStats() : {}),
      hud: () => M.hud,
    },
  });
  vs.shell = shell;

  /* Lane B's options panel, pulled in as soon as the shell exists.

     `core/input.js` also imports it, but input only exists once a match has
     been built — which meant Options on the title screen was still the shell's
     own placeholder, and the real panel only appeared after you had already
     played a match. Registering here makes "can I change the controls?"
     answerable before the first game rather than after it. The panel guards
     against double registration, so the import in `input.js` stays harmless.

     Dynamic so the boot path pays nothing for it and a panel that fails to
     load cannot take the game down with it. */
  if (typeof document !== 'undefined') {
    import('./ui/options.js')
      .then((m) => m && m.installOptions && m.installOptions())
      .catch(() => { /* the game does not depend on the panel existing */ });
  }

  shell.on('stateChange', ({ to }) => {
    if (to === 'playing') markReady();
  });

  /* The end screen is driven by the sim, not by a guess. `sim:gameOver` is the
     one event that decides a match is over, and it carries the reason. */
  bus.on('sim:gameOver', (p) => {
    shell.showGameOver({
      winner: p && p.winner,
      reason: p && p.reason,
      humanTeam: M.world ? M.world.humanTeam : 0,
    });
  });

  // Kept for compatibility: anything that emitted `ui:restart` used to get a
  // page reload. It now gets a real restart.
  bus.on('ui:restart', (p) => vs.restart(p && p.seed));

  /* -------------------------------------------------------- debug handles */

  Object.defineProperties(vs, {
    world: { get: () => M.world, configurable: true },
    fx: { get: () => M.fx, configurable: true },
    hud: { get: () => M.hud, configurable: true },
    input: { get: () => M.input, configurable: true },
    cameraRig: { get: () => M.cameraRig, configurable: true },
    environment: { get: () => A.environment, configurable: true },
    audio: { get: () => A.audio, configurable: true },
    ships: { get: () => A.ships, configurable: true },
    textures: { get: () => A.textures, configurable: true },
    materials: { get: () => A.materials, configurable: true },
    busErrors: { get: () => bus.errors, configurable: true },
    halted: { get: () => halted, configurable: true },
  });

  vs.restart = (seed) => {
    if (seed !== undefined && seed !== null && seed !== '') shell.setup.seed = String(seed);
    return shell.restart();
  };

  vs.skipIntro = () => {
    if (shell.state === 'title' || shell.state === 'setup' || shell.state === 'briefing') {
      return shell.quickStart();
    }
    bus.emit('ui:skipIntro');
    return true;
  };

  vs.dispose = () => {
    loop.dispose();
    teardown(true);
    shell.dispose();
    engine.dispose();
  };

  /* A listener that throws is contained by the bus rather than killing the
     fan-out, but contained is not the same as fine — it still means a feature
     is silently absent. Check once the game has settled and say so. */
  setTimeout(() => {
    if (!bus.errors.length) return;
    const types = [...new Set(bus.errors.map((e) => e.type))];
    bus.emit('ui:toast', {
      text: `Some event handlers are failing (${types.join(', ')}). See __VS.busErrors.`,
      kind: 'warning',
    });
  }, 8000);

  /* Mark ready only after a real frame of a live match has rendered — the
     screenshot harness and the perf tooling both key off this, and its meaning
     is unchanged from before the shell existed: there is a world, and it has
     been drawn at least once. Fall back to a timer so a hidden tab still
     reports ready rather than appearing to hang. */
  function markReady() {
    if (vs.ready) return;
    const arm = () => {
      if (vs.ready || !M.world) return;
      vs.ready = true;
    };
    requestAnimationFrame(() => requestAnimationFrame(arm));
    setTimeout(arm, 1500);
  }

  /* Straight into a match, no front matter. This is what the screenshot
     harnesses drive and what a deliberate `?autostart=1` link does; a plain
     visit gets the title screen, which is the entire point of this lane. */
  if (params.get('autostart') === '1') shell.quickStart();
}

/* --------------------------------------------------------------- fallbacks */

/** Enough light to see shapes if the environment module is unavailable. */
function installFallbackLighting(engine) {
  const key = new THREE.DirectionalLight(0xfff2e2, 3.2);
  key.position.set(-0.55, 0.42, 0.72).multiplyScalar(20000);
  engine.scene.add(key);
  const fill = new THREE.HemisphereLight(0x2a4a6e, 0x0a0d18, 0.55);
  engine.scene.add(fill);
  return [key, fill];
}

/** A minimal orbit rig so the game is still playable if camera.js is missing. */
function makeFallbackCamera(engine) {
  const focus = new THREE.Vector3();
  let distance = 6000;
  const yaw = 0.6;
  const pitch = 0.45;
  engine.camera.position.set(0, distance * 0.5, distance);
  return {
    focusOn(point, d) {
      focus.copy(point);
      if (d) distance = d;
    },
    frameEntities() {},
    setSensorsMode() {},
    screenToWorldPlane: () => focus.clone(),
    get distance() {
      return distance;
    },
    dispose() {},
    update() {
      const cp = Math.cos(pitch);
      engine.camera.position.set(
        focus.x + Math.sin(yaw) * cp * distance,
        focus.y + Math.sin(pitch) * distance,
        focus.z + Math.cos(yaw) * cp * distance,
      );
      engine.camera.lookAt(focus);
    },
  };
}

/** Nudge the post stack down a tier if the frame rate sags for a sustained run. */
function installAdaptiveQuality(loop, engine, post) {
  if (!post || !post.setQuality) return;

  /* Prefer the post stack's own policy when it exposes one — it knows its real
     per-pass costs and its own hysteresis, which is better informed than a
     frame counter out here. */
  if (typeof post.suggestQuality === 'function') {
    let cooldown = 300;
    engine.registerRenderHook(() => {
      if (cooldown > 0) {
        cooldown--;
        return;
      }
      const want = post.suggestQuality(loop.fps);
      if (want && want !== engine.quality) {
        post.setQuality(want);
        engine.quality = want;
        bus.emit('ui:toast', { text: `Detail set to ${want} to hold frame rate.`, kind: 'info' });
      }
    }, 'adaptive');
    return;
  }

  const tiers = ['low', 'medium', 'high', 'ultra'];
  let index = tiers.indexOf(engine.quality);
  let badFrames = 0;
  let cooldown = 300;

  engine.registerRenderHook(() => {
    if (cooldown > 0) {
      cooldown--;
      return;
    }
    if (loop.fps < 40 && index > 0) {
      if (++badFrames > 180) {
        index--;
        post.setQuality(tiers[index]);
        engine.quality = tiers[index];
        badFrames = 0;
        cooldown = 600;
        bus.emit('ui:toast', {
          text: `Detail reduced to ${tiers[index]} to hold frame rate.`,
          kind: 'info',
        });
      }
    } else {
      badFrames = Math.max(0, badFrames - 2);
    }
  }, 'adaptive');
}

main().catch((e) => fatal('Void Sovereign failed to start.', e));
