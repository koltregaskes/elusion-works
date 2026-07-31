import * as THREE from '../vendor/three/build/three.module.js';
import { Engine } from './core/engine.js';
import { Loop } from './core/loop.js';
import { bus } from './core/events.js';
import { makeRng } from './core/rng.js';

/* Boot sequence.

   Each subsystem is loaded in its own stage so a failure is isolated and
   reportable rather than a blank canvas. Stages that can degrade (post-fx,
   environment, HUD) do; the ones the game cannot exist without (engine, world)
   are fatal. The boot overlay reports progress because procedural generation
   of the skybox and hull atlases genuinely takes a moment. */

const params = new URLSearchParams(location.search);

const SEED = (() => {
  const raw = params.get('seed');
  if (raw !== null && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.abs(Math.trunc(n)) || 1;
    // Allow word seeds — hash them so ?seed=kharak is stable and shareable.
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) || 1;
  }
  return (Math.floor(Math.random() * 0xfffffff) + 1) >>> 0;
})();

const QUALITY = (() => {
  const q = params.get('quality');
  if (q && ['low', 'medium', 'high', 'ultra'].includes(q)) return q;
  return autoQuality();
})();

/** Pick a starting tier from coarse device signals; the loop adapts from here. */
function autoQuality() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  if (coarse || small || mem <= 2 || cores <= 2) return 'low';
  if (mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}

const boot = {
  el: document.getElementById('vs-boot'),
  bar: document.getElementById('vs-boot-bar'),
  fill: document.getElementById('vs-boot-fill'),
  status: document.getElementById('vs-boot-status'),
  set(pct, text) {
    if (this.fill) this.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, pct))})`;
    if (this.bar) this.bar.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
    if (this.status && text) this.status.textContent = text;
  },
  dismiss() {
    if (!this.el) return;
    this.el.classList.add('is-done');
    const el = this.el;
    setTimeout(() => el.remove(), 900);
    this.el = null;
  },
};

/* Pre-match setup on the boot card.

   Deliberately does NOT gate the default path: generation starts immediately
   and the game launches itself the moment it is ready, exactly as before, so
   a visitor who wants to just look at it waits for nothing and every existing
   screenshot harness keeps working unchanged.

   It only waits for an explicit "Take command" if the player actually touches
   a control — at which point they have declared an interest in choosing, and
   auto-launching out from under them would be rude.

   Any change reloads with new parameters. Generation has already started by
   the time the card is on screen, and all three settings are consumed during
   it — the seed feeds every generator, quality sizes the atlases and the sky,
   and difficulty is read when `World` is constructed. Re-running the boot is
   the honest way to apply them, and it now costs a few seconds rather than
   the thirty it once did. */
const setup = {
  touched: false,
  seed: params.get('seed') || '',
  difficulty: params.get('difficulty') || 'normal',
  quality: params.get('quality') || '',
  _onLaunch: null,

  init(seedValue, qualityValue) {
    const root = document.getElementById('vs-setup');
    const launch = document.getElementById('vs-launch');
    if (!root || !launch) return;

    this.seed = String(this.seed || seedValue);
    this.quality = this.quality || qualityValue;

    const seedInput = document.getElementById('vs-setup-seed');
    if (seedInput) {
      seedInput.value = this.seed;
      seedInput.addEventListener('input', () => {
        this.seed = seedInput.value.trim();
        this._touch();
      });
    }

    const reroll = document.getElementById('vs-setup-reroll');
    if (reroll && seedInput) {
      reroll.addEventListener('click', () => {
        this.seed = String((Math.floor(Math.random() * 0xfffffff) + 1) >>> 0);
        seedInput.value = this.seed;
        this._touch();
      });
    }

    this._group('vs-setup-difficulty', this.difficulty, (v) => {
      this.difficulty = v;
      this._touch();
    });
    this._group('vs-setup-quality', this.quality, (v) => {
      this.quality = v;
      this._touch();
    });

    launch.addEventListener('click', () => this._launch());
    this._launchEl = launch;
  },

  _group(id, current, onPick) {
    const el = document.getElementById(id);
    if (!el) return;
    const buttons = Array.from(el.querySelectorAll('button[data-value]'));
    const paint = (value) => {
      for (const b of buttons) b.setAttribute('aria-checked', String(b.dataset.value === value));
    };
    paint(current);
    for (const b of buttons) {
      b.addEventListener('click', () => {
        paint(b.dataset.value);
        onPick(b.dataset.value);
      });
    }
  },

  _touch() {
    if (this.touched) return;
    this.touched = true;
    if (this._launchEl) this._launchEl.hidden = false;
  },

  /** Called once generation finishes. Returns true if it handled the launch. */
  onReady(fn) {
    this._onLaunch = fn;
    if (this._launchEl) this._launchEl.disabled = false;
    if (!this.touched) return false; // default path: caller auto-launches
    return true;
  },

  _launch() {
    const activeDifficulty = params.get('difficulty') || 'normal';
    const changed =
      this.seed !== String(SEED) ||
      (this.quality && this.quality !== QUALITY) ||
      this.difficulty !== activeDifficulty;

    if (changed) {
      const url = new URL(location.href);
      if (this.seed) url.searchParams.set('seed', this.seed);
      if (this.quality) url.searchParams.set('quality', this.quality);
      url.searchParams.set('difficulty', this.difficulty);
      location.href = url.toString();
      return;
    }
    if (this._onLaunch) this._onLaunch();
  },
};

function fatal(message, detail) {
  const el = document.getElementById('vs-fatal');
  const d = document.getElementById('vs-fatal-detail');
  if (d) d.textContent = message;
  if (el) el.hidden = false;
  if (boot.el) boot.el.remove();
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

/* Give the browser a chance to paint the boot bar between stages.

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

/* Announce a stage and let it actually paint BEFORE the work starts.

   Awaiting a dynamic import is not enough: a promise resolution is a microtask
   and does not guarantee a paint, so a label set immediately before a long
   synchronous block could be replaced by the next label before the user ever
   saw it. That is how the boot overlay came to read "Laying down keels…" while
   the sky was baking, which sent someone hunting a hang in the ships module
   that was actually 0 ms. Set, paint, then work. */
async function stage(pct, text) {
  boot.set(pct, text);
  await yieldFrame();
}

async function main() {
  if (!hasWebGL2()) {
    fatal('Void Sovereign needs WebGL 2, which this browser or device does not provide.');
    return;
  }

  setup.init(SEED, QUALITY);

  const canvas = document.getElementById('vs-canvas');
  const vs = (window.__VS = {
    ready: false,
    seed: SEED,
    quality: QUALITY,
    THREE,
    bus,
    loadErrors,
  });

  /* ---------------------------------------------------------------- engine */
  await stage(0.04, 'Spinning up the renderer…');
  let engine;
  try {
    engine = new Engine({ canvas, quality: QUALITY });
  } catch (e) {
    fatal('The renderer failed to start on this device.', e);
    return;
  }
  vs.engine = engine;
  const rng = makeRng(SEED);
  vs.rng = rng;
  await yieldFrame();

  /* -------------------------------------------------------------- textures */
  await stage(0.10, 'Printing hull plating…');
  const texturesMod = await tryImport('./render/textures.js', 'textures');
  if (texturesMod && texturesMod.initTextureLibrary) {
    try {
      texturesMod.initTextureLibrary(engine.renderer, rng.fork(11), { quality: QUALITY });
    } catch (e) {
      loadErrors.push({ label: 'textures:init', error: String(e.message) });
    }
  }
  vs.textures = texturesMod;
  await yieldFrame();

  await stage(0.20, 'Mixing paint and primer…');
  const materialsMod = await tryImport('./render/materials.js', 'materials');
  if (materialsMod && materialsMod.initMaterials) {
    try {
      materialsMod.initMaterials(engine.renderer, { quality: QUALITY, rng: rng.fork(12) });
    } catch (e) {
      loadErrors.push({ label: 'materials:init', error: String(e.message) });
    }
  }
  vs.materials = materialsMod;
  await yieldFrame();

  /* ----------------------------------------------------------- environment */
  await stage(0.30, 'Painting the nebula…');
  const envMod = await tryImport('./render/environment.js', 'environment');
  let environment = null;
  if (envMod && envMod.Environment) {
    try {
      environment = new envMod.Environment({
        engine,
        rng: rng.fork(21),
        textures: texturesMod,
        seed: SEED,
        quality: QUALITY,
      });
      for (const light of environment.lights || []) engine.scene.add(light);
    } catch (e) {
      loadErrors.push({ label: 'environment', error: String(e.stack || e.message) });
    }
  }
  if (!environment) installFallbackLighting(engine);
  vs.environment = environment;
  await yieldFrame();

  /* ----------------------------------------------------------------- ships */
  await stage(0.48, 'Laying down keels…');
  const shipsMod = await tryImport('./ships/index.js', 'ships');
  if (shipsMod && shipsMod.warmShipCache) {
    try {
      shipsMod.warmShipCache(rng.fork(31));
    } catch (e) {
      loadErrors.push({ label: 'ships:warm', error: String(e.message) });
    }
  }
  vs.ships = shipsMod;
  await yieldFrame();

  /* -------------------------------------------------------------------- fx */
  await stage(0.62, 'Priming the ordnance…');
  const fxMod = await tryImport('./fx/index.js', 'fx');
  let fx = null;
  if (fxMod && fxMod.FXSystem) {
    try {
      fx = new fxMod.FXSystem({
        engine,
        materials: materialsMod,
        textures: texturesMod,
        quality: QUALITY,
      });
    } catch (e) {
      loadErrors.push({ label: 'fx', error: String(e.stack || e.message) });
    }
  }
  vs.fx = fx;
  await yieldFrame();

  /* ----------------------------------------------------------------- world */
  await stage(0.72, 'Deploying the fleets…');
  const worldMod = await tryImport('./sim/world.js', 'world');
  if (!worldMod || !worldMod.World) {
    fatal('The simulation failed to load.', loadErrors[loadErrors.length - 1]);
    return;
  }
  let world;
  try {
    world = new worldMod.World({
      seed: SEED,
      engine,
      fx,
      ships: shipsMod,
      environment,
      options: { difficulty: params.get('difficulty') || 'normal' },
    });
  } catch (e) {
    fatal('The simulation failed to start.', e);
    return;
  }
  vs.world = world;
  await yieldFrame();

  /* -------------------------------------------------------- camera + input */
  await stage(0.82, 'Handing you the bridge…');
  const cameraMod = await tryImport('./core/camera.js', 'camera');
  let cameraRig = null;
  if (cameraMod && cameraMod.CameraRig) {
    try {
      cameraRig = new cameraMod.CameraRig({ engine, domElement: canvas, world });
    } catch (e) {
      loadErrors.push({ label: 'camera', error: String(e.stack || e.message) });
    }
  }
  if (!cameraRig) cameraRig = makeFallbackCamera(engine);
  vs.cameraRig = cameraRig;

  /* Open on the player's mothership.

     Framed off hull *length*, not bounding radius. Radius × 7.5 put the camera
     9.2 km out — 4.8 hull lengths — and the flagship came in at 324 px of a
     1920 px frame, one element among asteroids rather than the subject. This
     is the single most important image in the demo, so the hero fills it. */
  const playerBase = world.entities.get(world.teams[0].baseId);
  if (playerBase && cameraRig.focusOn) {
    const hullLength = (playerBase.def && playerBase.def.length) || playerBase.radius * 2;
    cameraRig.focusOn(playerBase.position, hullLength * 2.1, true);
  } else if (playerBase === undefined) {
    // Seen on at least one seed: teams[0].baseId did not resolve to an entity.
    // Fall back to the team's home position so the camera is never left at the
    // origin staring into empty space.
    loadErrors.push({ label: 'camera:openingFrame', error: 'player base entity did not resolve' });
    const home = world.teams[0] && world.teams[0].homePosition;
    if (home && cameraRig.focusOn) cameraRig.focusOn(home, 4000, true);
  }

  const inputMod = await tryImport('./core/input.js', 'input');
  let input = null;
  if (inputMod && inputMod.InputController) {
    try {
      input = new inputMod.InputController({
        engine,
        domElement: canvas,
        camera: cameraRig,
        world,
      });
    } catch (e) {
      loadErrors.push({ label: 'input', error: String(e.stack || e.message) });
    }
  }
  vs.input = input;
  await yieldFrame();

  /* ----------------------------------------------------------------- audio */
  await stage(0.88, 'Opening the comms channel…');
  const audioMod = await tryImport('./audio/index.js', 'audio');
  let audio = null;
  if (audioMod && audioMod.AudioSystem) {
    try {
      audio = new audioMod.AudioSystem({
        seed: SEED,
        engine,
        world,
        camera: cameraRig,
      });
    } catch (e) {
      // Never fatal. A browser that blocks AudioContext must still get a game.
      loadErrors.push({ label: 'audio', error: String(e.stack || e.message) });
    }
  }
  vs.audio = audio;
  await yieldFrame();

  /* ------------------------------------------------------------------- HUD */
  await stage(0.92, 'Bringing the displays up…');
  const hudMod = await tryImport('./ui/hud.js', 'hud');
  let hud = null;
  if (hudMod && hudMod.HUD) {
    try {
      hud = new hudMod.HUD({
        engine,
        world,
        camera: cameraRig,
        container: document.getElementById('vs-hud'),
      });
    } catch (e) {
      loadErrors.push({ label: 'hud', error: String(e.stack || e.message) });
    }
  }
  vs.hud = hud;
  await yieldFrame();

  /* ---------------------------------------------------------------- postfx */
  await stage(0.96, 'Grading the image…');
  const postMod = await tryImport('./render/postfx.js', 'postfx');
  let post = null;
  if (postMod && postMod.PostFX) {
    try {
      post = new postMod.PostFX(engine);
      if (post.setQuality) post.setQuality(QUALITY);
      engine.setPostProcess(post);
    } catch (e) {
      loadErrors.push({ label: 'postfx', error: String(e.stack || e.message) });
      engine.setPostProcess(null);
    }
  }
  vs.post = post;

  /* ------------------------------------------------------------- per-frame */
  engine.registerRenderHook((dt, elapsed) => {
    if (cameraRig && cameraRig.update) cameraRig.update(dt);
    if (input && input.update) input.update(dt);
    // Must run every frame, not just on events: the listener frame, distance
    // attenuation, voice stealing, coalesced weapon clusters and the score's
    // scheduler all advance here. Constructing it alone leaves it inert.
    if (audio) audio.update(dt, elapsed, engine.camera);
    if (environment && environment.update) environment.update(dt, elapsed, engine.camera);
    if (materialsMod && materialsMod.updateMaterials) materialsMod.updateMaterials(elapsed);
    if (fx) fx.update(dt, elapsed, engine.camera);
    if (hud) hud.update(dt);
  });

  const loop = new Loop({ engine, world, hz: 30 });
  vs.loop = loop;

  /* Opt-in only, via ?adaptive=1.

     It was on by default and silently walked high -> medium -> low within ~40 s
     on the dev mini-PC, which meant every screenshot and every art review was
     of a downgraded build without anyone being told. That directly contradicts
     the build-first/optimise-last policy in ARCHITECTURE §0: quality decisions
     belong to Phase 4, measured on the target laptop, not to a watchdog running
     on hardware we are explicitly not targeting. */
  if (params.get('adaptive') === '1') installAdaptiveQuality(loop, engine, post);

  vs.restart = (seed) => {
    const url = new URL(location.href);
    url.searchParams.set('seed', String(seed || Math.floor(Math.random() * 0xfffffff) + 1));
    location.href = url.toString();
  };
  bus.on('ui:restart', (p) => vs.restart(p && p.seed));

  vs.skipIntro = () => {
    boot.dismiss();
    bus.emit('ui:skipIntro');
  };

  vs.dispose = () => {
    loop.dispose();
    if (hud) hud.dispose();
    if (input && input.dispose) input.dispose();
    if (fx) fx.dispose();
    if (environment && environment.dispose) environment.dispose();
    world.dispose();
    /* World deliberately no longer frees these: hull geometry and the fleet
       batches are shared across every entity of a class, so releasing them on
       one ship's death deleted the geometry every other ship of that class was
       drawing from. They belong to the ships module, so teardown is ours. */
    if (shipsMod && shipsMod.disposeFleetBatches) shipsMod.disposeFleetBatches();
    if (shipsMod && shipsMod.disposeShipCache) shipsMod.disposeShipCache();
    if (audio) audio.dispose();
    engine.dispose();
  };

  /* Say so when a subsystem degraded.

     Per-stage isolation keeps a broken module from blanking the canvas, which
     is right — but it also means the game can run for hours quietly missing
     its lighting or its audio with only a console-free `__VS.loadErrors` array
     to show for it. That silence cost four iterations of chasing a nebula
     bounce that was being reverted to defaults by an unrelated parse error
     upstream. A degraded run must announce itself. */
  if (loadErrors.length) {
    const labels = [...new Set(loadErrors.map((e) => String(e.label).split(':')[0]))];
    bus.emit('ui:toast', {
      text: `Running degraded — ${labels.join(', ')} failed to load. See __VS.loadErrors.`,
      kind: 'warning',
    });
  }

  boot.set(1, 'Ready.');
  loop.start();

  // Mark ready only after a real frame has rendered — the screenshot harness
  // and any perf tooling both key off this. Fall back to a timer so a hidden
  // tab still reports ready rather than appearing to hang forever.
  const markReady = () => {
    if (vs.ready) return;
    vs.ready = true;
    // If the player has touched the setup controls, hold the card until they
    // say go. Otherwise launch straight in, as it always has.
    const held = setup.onReady(() => {
      boot.dismiss();
      bus.emit('ui:ready', { seed: SEED, quality: QUALITY });
    });
    if (!held) {
      boot.dismiss();
      bus.emit('ui:ready', { seed: SEED, quality: QUALITY });
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(markReady));
  setTimeout(markReady, 1500);
}

/* --------------------------------------------------------------- fallbacks */

/** Enough light to see shapes if the environment module is unavailable. */
function installFallbackLighting(engine) {
  const key = new THREE.DirectionalLight(0xfff2e2, 3.2);
  key.position.set(-0.55, 0.42, 0.72).multiplyScalar(20000);
  engine.scene.add(key);
  const fill = new THREE.HemisphereLight(0x2a4a6e, 0x0a0d18, 0.55);
  engine.scene.add(fill);
}

/** A minimal orbit rig so the game is still playable if camera.js is missing. */
function makeFallbackCamera(engine) {
  const focus = new THREE.Vector3();
  let distance = 6000;
  let yaw = 0.6;
  let pitch = 0.45;
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
     per-pass costs and its own hysteresis (drops after 2.5 s under 48 fps,
     climbs after 12 s over 58.5 fps), which is better informed than a frame
     counter out here. `setQuality()` is documented safe to call at any time
     and was verified leak-free across 20 tier changes. */
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
    });
    return;
  }

  const tiers = ['low', 'medium', 'high', 'ultra'];
  let index = tiers.indexOf(engine.quality);
  let badFrames = 0;
  let cooldown = 300; // let the first few seconds settle before judging

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
        bus.emit('ui:toast', { text: `Detail reduced to ${tiers[index]} to hold frame rate.`, kind: 'info' });
      }
    } else {
      badFrames = Math.max(0, badFrames - 2);
    }
  });
}

main().catch((e) => fatal('Void Sovereign failed to start.', e));
