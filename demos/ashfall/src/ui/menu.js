/**
 * Ashfall — front end: title, settings, pause, death, and pointer lock.
 *
 * Binds to the DOM contract in index.html. This module never creates top-level structure and
 * never writes a stylesheet: it toggles classes, sets custom properties, fills text, and
 * builds the settings rows inside the empty `[data-settings]` grid the page already provides.
 *
 * Responsibilities, in the order they matter:
 *
 *  1. **Pointer lock is owned here and nowhere else.** `Deploy` locks the canvas; losing the
 *     lock pauses; `Esc` pauses and releases; a click on the canvas from pause resumes.
 *     `core/input.js` only mirrors the lock state — it never requests or exits it.
 *  2. **The title screen is a live scene.** The camera flies a closed, arc-length
 *     parameterised Catmull-Rom spline over the yard with a sprung look-at, so the background
 *     is the real map at a real time of day rather than a still. When play starts the drift
 *     keeps running and is *cross-faded* into the pose the player controller writes, which is
 *     why the handover has no snap: both poses are live, only the weight moves.
 *  3. **Settings apply on the frame they change** and persist to `localStorage` under
 *     `ashfall.settings`, merged rather than overwritten so keys other modules stash there
 *     survive. Every row is built from one declarative table.
 *
 * Zero allocation in the per-frame path: every vector, quaternion and matrix is preallocated
 * at module scope, and the only strings built at runtime are the settings readouts and the
 * throttled performance note, both of which are quantised and skipped when unchanged.
 *
 * ---------------------------------------------------------------------------
 * CSS CONTRACT — what this module writes. styles.css owns every visual decision.
 *
 *   on [data-menu]        classes is-open / is-closed / is-title / is-settings /
 *                         is-controls / is-pause / is-dead
 *                         attribute data-mode = menu|playing|paused|dead
 *                         attribute data-menu-page = title|settings|controls|pause|dead
 *                         (never `data-page`: the sections own that selector)
 *                         --menu-accent --menu-danger --menu-primary --menu-dim
 *                         --menu-fade (0..1, 1 while the overlay is up)
 *   on <body>             classes menu-open / menu-closed
 *   on [data-page]        class is-active, plus the `hidden` attribute for the rest
 *
 *   Rows built inside [data-settings]:
 *     div.setting[data-setting=<key>][data-kind=<kind>]   class is-unavailable when the
 *                                                          active preset disables it
 *       div.setting-text > label.setting-label + p.setting-hint
 *       output.setting-value.mono[data-value]
 *       div.setting-control  (one of)
 *         div.segment[role=radiogroup] > button.segment-opt[role=radio]   --index --count
 *         input.slider[type=range]                                        --fill (0..1)
 *         button.switch[role=switch] > span.switch-track > span.switch-knob   --on (0|1)
 *         div.swatches[role=radiogroup] > button.swatch[role=radio]       --swatch (colour)
 *                                          > span.swatch-dot + span.swatch-name
 *     div.setting-group > h3.setting-group-title
 *
 *   Selected radio/segment buttons carry `is-selected`; switches carry `is-on`.
 * ---------------------------------------------------------------------------
 */

import * as THREE from '../../vendor/three.module.js';
import { PALETTE, CAMERA, MAP, ZONES } from '../world/art.js';

/* ========================================================================== */
/* Maths helpers                                                              */
/* ========================================================================== */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** Zero first *and* second derivative at both ends — the only easing a camera should use. */
const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

const STORAGE_KEY = 'ashfall.settings';
const QUALITIES = ['low', 'medium', 'high', 'ultra'];
const QUALITY_RANK = { low: 0, medium: 1, high: 2, ultra: 3 };

/* ========================================================================== */
/* Title flythrough — spline definition                                       */
/* ========================================================================== */

/**
 * Camera stations, metres, laid out as a closed loop around the playable box
 * (`MAP.width` x `MAP.depth`) so the drift always has parallax: near cover slides past fast
 * while the crane and the water tower barely move.
 *
 * Every height clears `MAP.wallHeight` (9 m) with room for container stacks and the depot roof,
 * and stays under `MAP.craneHeight` (22 m) so the landmarks keep breaking the skyline. The
 * clearance is deliberate rather than measured: this module never sees the level's geometry, so
 * the flight path must be safe against any layout that respects the numbers in `art.js`.
 */
const CAM_STATIONS = new Float32Array([
  MAP.width * 0.31, 12.0, MAP.depth * 0.44,
  MAP.width * 0.02, 11.5, MAP.depth * 0.40,
  -MAP.width * 0.28, 13.0, MAP.depth * 0.30,
  -MAP.width * 0.44, 15.5, -MAP.depth * 0.06,
  -MAP.width * 0.22, 19.0, -MAP.depth * 0.40,
  MAP.width * 0.14, 15.0, -MAP.depth * 0.46,
  MAP.width * 0.44, 12.0, -MAP.depth * 0.20,
  MAP.width * 0.46, 16.0, MAP.depth * 0.20,
]);

/**
 * Where each station looks, keyed off the three combat spaces in `art.js`.
 *
 * Each target sits 30 to 50 m *ahead* of its station rather than beneath it. That is the whole
 * trick: aiming a flying camera at the landmark it is about to pass over forces the pitch
 * towards vertical as it arrives, and a top-down view of a rail yard is a map screen, not a
 * title. Holding the aim out ahead keeps the depression angle in the 8-20° band, which is
 * where the low sun rakes across the ground plane and the crane and water tower still break
 * the skyline.
 */
const CAM_TARGETS = new Float32Array([
  ZONES.yard.centre[0], 4.0, ZONES.yard.centre[2],
  ZONES.yard.centre[0] - 30, 5.0, ZONES.yard.centre[2] - 3,
  ZONES.depot.centre[0], 4.0, ZONES.depot.centre[2] + 2,
  ZONES.depot.centre[0] + 16, 4.0, ZONES.depot.centre[2] - 8,
  ZONES.terraces.centre[0] - 14, 5.0, ZONES.terraces.centre[2] + 6,
  ZONES.terraces.centre[0] + 10, 5.0, ZONES.terraces.centre[2] + 12,
  ZONES.yard.centre[0] + 25, 4.0, ZONES.yard.centre[2] - 10,
  ZONES.yard.centre[0], 5.0, ZONES.yard.centre[2] + 2,
]);

const STATION_COUNT = CAM_STATIONS.length / 3;
/** Metres per second along the arc. Slow enough to read as a hold, fast enough to live. */
const DRIFT_SPEED = 2.55;
/**
 * Seconds of cross-fade out of the title camera into the player's, and back again. Long
 * enough that the insertion reads as a deliberate drop into the yard rather than a cut: with
 * a smootherstep weight the peak speed lands around 40 m/s, which is the same order as a
 * console shooter's spawn descent, and both ends have zero velocity.
 */
const HANDOFF_OUT = 1.6;
const HANDOFF_IN = 1.1;
/** Samples per segment used to build the arc-length table. */
const ARC_SAMPLES = 24;

/**
 * Scratch — module scope, never reallocated.
 *
 * `_sp` carries the spline parameter between the arc-length lookup and the two evaluations
 * instead of being passed and returned. That looks fussy and is not: a JavaScript call passes
 * tagged values, so a `double` handed to a function the optimiser chose not to inline is boxed
 * into a fresh HeapNumber on every call. Routing the value through a field of a long-lived
 * object (which V8 stores unboxed once the field is double-representation) is what takes the
 * title path from "a few tens of bytes a frame" to nothing at all. The same reasoning governs
 * `t.dt` further down.
 */
const _sp = { u: 0.5, d: 0.5 };
const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _lookSmooth = new THREE.Vector3();
const _frozenPos = new THREE.Vector3();
const _driftPos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qFrozen = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

/** Uniform Catmull-Rom on a closed loop of packed xyz triples, at `_sp.u`. Writes into `out`. */
function sampleClosed(arr, count, out) {
  const t = _sp.u;
  const seg = Math.floor(t);
  const f = t - seg;
  const i1 = ((seg % count) + count) % count;
  const i0 = (i1 - 1 + count) % count;
  const i2 = (i1 + 1) % count;
  const i3 = (i1 + 2) % count;
  const f2 = f * f;
  const f3 = f2 * f;
  for (let c = 0; c < 3; c++) {
    const p0 = arr[i0 * 3 + c];
    const p1 = arr[i1 * 3 + c];
    const p2 = arr[i2 * 3 + c];
    const p3 = arr[i3 * 3 + c];
    const v =
      0.5 *
      (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
    if (c === 0) out.x = v;
    else if (c === 1) out.y = v;
    else out.z = v;
  }
  return out;
}

/**
 * Arc-length table so the drift moves at a constant metres-per-second instead of speeding up
 * through the tight corners, which is the classic tell of a hand-rolled spline.
 */
function buildArcTable() {
  const n = STATION_COUNT * ARC_SAMPLES;
  const table = new Float32Array(n + 1);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  _sp.u = 0;
  sampleClosed(CAM_STATIONS, STATION_COUNT, a);
  let total = 0;
  table[0] = 0;
  for (let i = 1; i <= n; i++) {
    _sp.u = (i / n) * STATION_COUNT;
    sampleClosed(CAM_STATIONS, STATION_COUNT, b);
    total += a.distanceTo(b);
    table[i] = total;
    a.copy(b);
  }
  return { table, total: total || 1 };
}

const ARC = buildArcTable();

/** `_sp.d` metres along the loop -> `_sp.u`, the spline parameter in [0, STATION_COUNT). */
function tFromDistance() {
  const n = ARC.table.length - 1;
  let d = _sp.d % ARC.total;
  if (d < 0) d += ARC.total;
  let lo = 0;
  let hi = n;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (ARC.table[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = ARC.table[lo + 1] - ARC.table[lo];
  const f = span > 1e-6 ? (d - ARC.table[lo]) / span : 0;
  _sp.u = ((lo + f) / n) * STATION_COUNT;
}

/* ========================================================================== */
/* Settings schema                                                            */
/* ========================================================================== */

const CROSSHAIR_COLOURS = [
  { value: PALETTE.hudPrimary, label: 'Bone' },
  { value: PALETTE.hudAccent, label: 'Amber' },
  { value: PALETTE.hudFriendly, label: 'Ice' },
  { value: PALETTE.hudDanger, label: 'Signal' },
  { value: PALETTE.tracer, label: 'Tracer' },
];

const pct = (v) => `${Math.round(v * 100)}%`;

/**
 * The single declarative table every control is generated from. `apply` runs the instant the
 * value changes; `available` (optional) decides whether the active quality preset can honour
 * it at all. Order here is the order on screen.
 */
const SETTINGS_SPEC = [
  { group: 'Display' },
  {
    key: 'quality',
    kind: 'segment',
    label: 'Quality preset',
    hint: 'Render scale, shadow cascades, ambient occlusion, bloom and particle budget.',
    def: 'high',
    options: QUALITIES.map((q) => ({ value: q, label: q[0].toUpperCase() + q.slice(1) })),
    format: (v) => String(v).toUpperCase(),
    apply(v, game) {
      game.quality = v;
      game.engine?.setQuality?.(v);
      game.post?.setQuality?.(v);
      game.shadows?.setQuality?.(v);
      // Not in the written contract, but every one of these ships a setQuality and it would
      // be odd for the preset to move the pixels and not the particle or voice budget.
      game.fx?.setQuality?.(v);
      game.ai?.setQuality?.(v);
      game.audio?.setQuality?.(v);
      game.materials?.setQuality?.(v);
    },
  },
  {
    key: 'fov',
    kind: 'range',
    label: 'Field of view',
    hint: 'Vertical, hipfire. Sights pull in from here.',
    def: CAMERA.fov,
    min: 65,
    max: 110,
    step: 1,
    format: (v) => `${Math.round(v)}°`,
    apply(v, game) {
      const cam = game.camera;
      if (!cam) return;
      cam.fov = v;
      cam.updateProjectionMatrix();
    },
  },

  { group: 'Control' },
  {
    key: 'sensitivity',
    kind: 'range',
    label: 'Look sensitivity',
    hint: 'Multiplier on the raw mouse delta. 1.00 is the house setting.',
    def: 1.0,
    min: 0.2,
    max: 3.0,
    step: 0.05,
    format: (v) => v.toFixed(2),
    apply(v, game) {
      // Matches the base radians-per-count in main.js so a stored value round-trips exactly.
      if (game.input) game.input.sensitivity = v * 0.0022;
    },
  },
  {
    key: 'invertY',
    kind: 'switch',
    label: 'Invert vertical look',
    hint: 'Pull down to look up.',
    def: false,
    apply(v, game) {
      if (game.input) game.input.invertY = v;
    },
  },

  { group: 'Audio' },
  {
    key: 'volume',
    kind: 'range',
    label: 'Master volume',
    hint: 'Everything is synthesised at runtime. Nothing is streamed.',
    def: 0.7,
    min: 0,
    max: 1,
    step: 0.01,
    format: pct,
    apply(v, game) {
      game.audio?.setVolume?.(v);
    },
  },

  { group: 'Image' },
  {
    key: 'grain',
    kind: 'switch',
    label: 'Film grain',
    hint: 'Per-pixel animated grain in the composite pass.',
    def: true,
    apply(v, game) {
      const p = game.post?.params;
      if (p) p.grainEnabled = v;
    },
  },
  {
    key: 'motionBlur',
    kind: 'switch',
    label: 'Motion blur',
    hint: 'Velocity-buffer directional blur.',
    def: true,
    available: (q) => QUALITY_RANK[q] >= 2,
    requires: 'High preset',
    apply(v, game) {
      const p = game.post?.params;
      if (p) p.motionBlurEnabled = v;
    },
  },
  {
    key: 'taa',
    kind: 'switch',
    label: 'Temporal anti-aliasing',
    hint: 'Eight-sample jitter with neighbourhood clipping. Off means aliased edges.',
    def: true,
    available: (q) => QUALITY_RANK[q] >= 1,
    requires: 'Medium preset',
    apply(v, game) {
      const p = game.post?.params;
      if (p) p.taaEnabled = v;
    },
  },
  {
    key: 'dof',
    kind: 'switch',
    label: 'Depth of field',
    hint: 'Hexagonal bokeh while aiming down the sight.',
    def: true,
    available: (q) => QUALITY_RANK[q] >= 2,
    requires: 'High preset',
    apply(v, game) {
      const p = game.post?.params;
      if (p) {
        p.dofEnabled = v;
        // The composite blend is scaled by dofStrength, so zeroing it is the honest off.
        p.dofStrength = v ? 1.0 : 0.0;
      }
      if (!v) game.post?.setDOF?.(false);
    },
  },

  { group: 'Interface' },
  {
    key: 'crosshairColour',
    kind: 'swatch',
    label: 'Crosshair colour',
    hint: 'Hit and kill feedback ramps from this towards amber and red.',
    def: PALETTE.hudPrimary,
    options: CROSSHAIR_COLOURS,
    format: (v) => {
      const found = CROSSHAIR_COLOURS.find((c) => c.value === v);
      return found ? found.label.toUpperCase() : String(v).toUpperCase();
    },
    apply(v, game) {
      game.hud?.setCrosshairColour?.(v);
    },
  },
];

/** Rows only (no group headings), for lookups. */
const SETTINGS_ROWS = SETTINGS_SPEC.filter((s) => s.key);

/* ========================================================================== */
/* Factory                                                                    */
/* ========================================================================== */

export function createMenu(game) {
  const doc = document;
  const canvas = game?.canvas || doc.getElementById('viewport');

  const el = {
    menu: doc.querySelector('[data-menu]'),
    settings: doc.querySelector('[data-settings]'),
    deathNote: doc.querySelector('[data-death-note]'),
    perfNote: doc.querySelector('[data-perf-note]'),
  };

  const pages = new Map();
  if (el.menu) {
    for (const node of el.menu.querySelectorAll('[data-page]')) {
      pages.set(node.getAttribute('data-page'), node);
    }
  }

  /* --- Persisted settings ------------------------------------------------ */

  const stored = readStored();
  const settings = {};
  for (const row of SETTINGS_ROWS) settings[row.key] = coerce(row, stored[row.key]);
  // The boot path may have picked a preset from the hardware when nothing was stored.
  if (stored.quality === undefined && typeof game?.quality === 'string') {
    settings.quality = coerce(
      SETTINGS_ROWS.find((r) => r.key === 'quality'),
      game.quality
    );
  }

  const changeListeners = new Set();
  let saveTimer = 0;

  function readStored() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function coerce(row, raw) {
    if (row.kind === 'switch') return raw === undefined ? !!row.def : !!raw;
    if (row.kind === 'range') {
      const n = typeof raw === 'number' && isFinite(raw) ? raw : row.def;
      return quantise(row, clamp(n, row.min, row.max));
    }
    if (row.kind === 'segment' || row.kind === 'swatch') {
      const ok = row.options.some((o) => o.value === raw);
      return ok ? raw : row.def;
    }
    return raw === undefined ? row.def : raw;
  }

  function quantise(row, v) {
    const step = row.step || 0.01;
    const snapped = Math.round((v - row.min) / step) * step + row.min;
    // Kill float dust so 0.7000000000000001 never reaches localStorage or a readout.
    return Math.round(snapped * 1e4) / 1e4;
  }

  function persist() {
    if (saveTimer) return;
    // Coalesce a slider drag into one write; localStorage is synchronous and on the main thread.
    saveTimer = setTimeout(() => {
      saveTimer = 0;
      try {
        const raw = readStored();
        for (const key of Object.keys(settings)) raw[key] = settings[key];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
      } catch {
        /* private mode, quota, or no storage at all — the session still works */
      }
    }, 220);
  }

  /* --- State ------------------------------------------------------------- */

  const captureMode = !!game?.capture;
  let page = 'title';
  let overlayVisible = true;
  let mode = game?.state?.mode || 'menu';
  let lastSeenMode = mode;
  let disposed = false;

  /** Pointer-lock bookkeeping. */
  let pendingLock = false;
  let intentionalUnlock = false;
  let wasLocked = false;
  let lockRetries = 0;

  /**
   * Every mutable *fractional* number the frame path touches lives in this one preallocated
   * object rather than in closure variables. That is not style: a double written to a
   * captured `let` is boxed into a fresh HeapNumber on every assignment, so six timers
   * ticking at 60 Hz quietly allocate about a hundred bytes a frame. Object fields of double
   * representation are stored unboxed, which brings the steady state to exactly zero.
   *
   *   dt         this frame's clamped delta, handed to the camera path without boxing
   *   guard      seconds left suppressing Esc/Enter after a transition (one key, one toggle)
   *   distance   metres travelled along the title spline
   *   time       seconds of title drift, for the handheld float
   *   out / in   seconds left cross-fading title -> player and player -> title
   *   cineFov    the title screen's narrower, more filmic field of view
   *   perf       countdown to the next footer readout refresh
   *   retry      countdown to the next pointer-lock retry
   */
  const t = {
    dt: 0,
    guard: 0,
    distance: ARC.total * 0.06,
    time: 0,
    out: 0,
    in: 0,
    cineFov: 55,
    perf: 0,
    retry: 0,
  };

  let lookSeeded = false;
  let perfFpsQ = -1;
  let perfW = -1;

  /** Last damage taken, for the death card. */
  const lastDamage = { from: '', distance: 0, headshot: false, valid: false };

  /* --- DOM: settings rows ------------------------------------------------ */

  const controls = new Map();

  function buildSettings() {
    if (!el.settings) return;
    el.settings.textContent = '';
    for (const spec of SETTINGS_SPEC) {
      if (spec.group) {
        const g = doc.createElement('div');
        g.className = 'setting-group';
        const h = doc.createElement('h3');
        h.className = 'setting-group-title';
        h.textContent = spec.group;
        g.appendChild(h);
        el.settings.appendChild(g);
        continue;
      }
      el.settings.appendChild(buildRow(spec));
    }
    refreshAvailability();
  }

  function buildRow(spec) {
    const row = doc.createElement('div');
    row.className = `setting is-${spec.kind}`;
    row.setAttribute('data-setting', spec.key);
    row.setAttribute('data-kind', spec.kind);

    const text = doc.createElement('div');
    text.className = 'setting-text';

    const label = doc.createElement('label');
    label.className = 'setting-label';
    label.id = `set-${spec.key}-label`;
    label.textContent = spec.label;
    text.appendChild(label);

    if (spec.hint) {
      const hint = doc.createElement('p');
      hint.className = 'setting-hint';
      hint.textContent = spec.hint;
      text.appendChild(hint);
    }

    const value = doc.createElement('output');
    value.className = 'setting-value mono';
    value.setAttribute('data-value', '');
    value.setAttribute('aria-live', 'off');

    const control = doc.createElement('div');
    control.className = 'setting-control';

    const entry = { spec, row, label, value, control, nodes: [], input: null, note: null };

    if (spec.kind === 'segment' || spec.kind === 'swatch') buildRadioGroup(entry);
    else if (spec.kind === 'range') buildRange(entry);
    else if (spec.kind === 'switch') buildSwitch(entry);

    if (spec.requires) {
      const note = doc.createElement('p');
      note.className = 'setting-note';
      note.textContent = `Requires the ${spec.requires}.`;
      note.hidden = true;
      text.appendChild(note);
      entry.note = note;
    }

    row.appendChild(text);
    row.appendChild(value);
    row.appendChild(control);
    controls.set(spec.key, entry);
    paint(spec.key);
    return row;
  }

  function buildRadioGroup(entry) {
    const { spec, control } = entry;
    const group = doc.createElement('div');
    group.className = spec.kind === 'swatch' ? 'swatches' : 'segment';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', entry.label.id);
    group.style.setProperty('--count', String(spec.options.length));

    spec.options.forEach((opt, i) => {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = spec.kind === 'swatch' ? 'swatch' : 'segment-opt';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('data-option', String(opt.value));
      btn.style.setProperty('--index', String(i));
      if (spec.kind === 'swatch') {
        btn.style.setProperty('--swatch', opt.value);
        const dot = doc.createElement('span');
        dot.className = 'swatch-dot';
        const name = doc.createElement('span');
        name.className = 'swatch-name';
        name.textContent = opt.label;
        btn.appendChild(dot);
        btn.appendChild(name);
        btn.setAttribute('aria-label', `${opt.label} crosshair`);
      } else {
        btn.textContent = opt.label;
      }
      btn.addEventListener('click', () => set(spec.key, opt.value));
      btn.addEventListener('keydown', (e) => onRadioKey(e, entry, i));
      group.appendChild(btn);
      entry.nodes.push(btn);
    });

    control.appendChild(group);
    entry.group = group;
  }

  /** Arrow keys move and select, Home/End jump — the standard radiogroup pattern. */
  function onRadioKey(e, entry, index) {
    const n = entry.nodes.length;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    set(entry.spec.key, entry.spec.options[next].value);
    entry.nodes[next].focus({ preventScroll: true });
  }

  function buildRange(entry) {
    const { spec, control } = entry;
    const input = doc.createElement('input');
    input.type = 'range';
    input.className = 'slider';
    input.id = `set-${spec.key}`;
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.setAttribute('aria-labelledby', entry.label.id);
    entry.label.setAttribute('for', input.id);
    input.addEventListener('input', () => set(spec.key, parseFloat(input.value)));
    // Arrow keys already work natively; stop them bubbling into the Esc/Enter handler.
    input.addEventListener('keydown', (e) => e.stopPropagation());
    control.appendChild(input);
    entry.input = input;
  }

  function buildSwitch(entry) {
    const { spec, control } = entry;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'switch';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-labelledby', entry.label.id);
    const track = doc.createElement('span');
    track.className = 'switch-track';
    const knob = doc.createElement('span');
    knob.className = 'switch-knob';
    track.appendChild(knob);
    btn.appendChild(track);
    btn.addEventListener('click', () => set(spec.key, !settings[spec.key]));
    control.appendChild(btn);
    entry.input = btn;
    entry.nodes.push(btn);
  }

  /** Push the current value of one setting into its DOM. No side effects on the game. */
  function paint(key) {
    const entry = controls.get(key);
    if (!entry) return;
    const spec = entry.spec;
    const v = settings[key];

    if (spec.format) entry.value.textContent = spec.format(v);

    if (spec.kind === 'range') {
      const t = clamp01((v - spec.min) / (spec.max - spec.min || 1));
      if (entry.input && entry.input.value !== String(v)) entry.input.value = String(v);
      entry.input?.setAttribute('aria-valuetext', spec.format ? spec.format(v) : String(v));
      entry.row.style.setProperty('--value', t.toFixed(3));
      entry.input?.style.setProperty('--fill', t.toFixed(3));
      return;
    }

    if (spec.kind === 'switch') {
      const on = !!v;
      entry.input?.setAttribute('aria-checked', on ? 'true' : 'false');
      entry.input?.classList.toggle('is-on', on);
      entry.row.classList.toggle('is-on', on);
      entry.row.style.setProperty('--on', on ? '1' : '0');
      if (!spec.format) entry.value.textContent = on ? 'ON' : 'OFF';
      return;
    }

    // Radio groups: selection class, aria state and a roving tabindex.
    for (let i = 0; i < entry.nodes.length; i++) {
      const node = entry.nodes[i];
      const on = spec.options[i].value === v;
      node.classList.toggle('is-selected', on);
      node.setAttribute('aria-checked', on ? 'true' : 'false');
      node.tabIndex = on ? 0 : -1;
    }
    // Nothing selected (a stale stored value) would trap the keyboard, so keep one entry point.
    if (!entry.nodes.some((n) => n.tabIndex === 0) && entry.nodes[0]) entry.nodes[0].tabIndex = 0;
    entry.row.style.setProperty('--index', String(spec.options.findIndex((o) => o.value === v)));
  }

  /** Grey out post effects the active preset cannot run, rather than lying about them. */
  function refreshAvailability() {
    const q = settings.quality;
    for (const entry of controls.values()) {
      const spec = entry.spec;
      if (!spec.available) continue;
      const ok = !!spec.available(q);
      entry.row.classList.toggle('is-unavailable', !ok);
      if (entry.note) entry.note.hidden = ok;
      if (entry.input) {
        entry.input.disabled = !ok;
        entry.input.setAttribute('aria-disabled', ok ? 'false' : 'true');
      }
      if (!ok) entry.value.textContent = 'OFF';
      else paint(spec.key);
    }
  }

  /* --- Settings mutation ------------------------------------------------- */

  function applyOne(key) {
    const row = SETTINGS_ROWS.find((r) => r.key === key);
    if (!row || !row.apply) return;
    try {
      row.apply(settings[key], game);
    } catch (err) {
      if (game?.debug) console.warn(`[menu] setting ${key} failed to apply`, err);
    }
  }

  function set(key, raw) {
    const row = SETTINGS_ROWS.find((r) => r.key === key);
    if (!row) return;
    const value = coerce(row, raw);
    if (settings[key] === value) {
      paint(key);
      return;
    }
    settings[key] = value;
    paint(key);
    applyOne(key);
    if (key === 'fov') refreshCineFov();
    if (key === 'quality') {
      refreshAvailability();
      // The preset may have just switched an effect back on; re-assert the user's choice.
      applyOne('taa');
      applyOne('motionBlur');
      applyOne('dof');
    }
    persist();
    for (const fn of changeListeners) {
      try {
        fn(key, value, settings);
      } catch (err) {
        if (game?.debug) console.warn('[menu] onChange listener threw', err);
      }
    }
  }

  /**
   * The title screen's field of view: 0.72x the player's, clamped to a filmic range. Derived
   * once per change rather than per frame, so the drift path calls nothing at all.
   */
  function refreshCineFov() {
    t.cineFov = clamp(settings.fov * 0.72, 38, 70);
  }

  function applyAll() {
    for (const row of SETTINGS_ROWS) {
      // Quality is already live: main.js built every subsystem with the stored preset, and
      // re-running it here would rebuild the shadow cascades during the loading screen.
      if (row.key === 'quality') continue;
      applyOne(row.key);
    }
  }

  /* --- Pages ------------------------------------------------------------- */

  const PAGE_FOR_MODE = { menu: 'title', paused: 'pause', dead: 'dead', playing: null };

  function showPage(name) {
    page = name;
    for (const [key, node] of pages) {
      const active = key === name;
      node.classList.toggle('is-active', active);
      node.hidden = !active;
    }
    if (el.menu) {
      // Deliberately not `data-page`: the sections already own that attribute, and a root that
      // answered to the same selector would shadow every `[data-page="…"]` lookup in the page.
      el.menu.setAttribute('data-menu-page', name || '');
      for (const key of pages.keys()) el.menu.classList.toggle(`is-${key}`, key === name);
    }
    focusFirst(name);
  }

  function focusFirst(name) {
    // Focus into a closed (inert) overlay is discarded by the browser and, worse, would steal
    // the keyboard from the game in capture mode. Only ever move focus onto a visible page.
    if (!overlayVisible) return;
    const node = pages.get(name);
    if (!node) return;
    const target = node.querySelector('.btn-primary, .btn, button, input');
    // preventScroll matters: the overlay is fixed and a scroll would shift the canvas box.
    try {
      target?.focus({ preventScroll: true });
    } catch {
      target?.focus();
    }
  }

  function setOverlay(visible) {
    overlayVisible = visible;
    if (!el.menu) return;
    el.menu.classList.toggle('is-open', visible);
    el.menu.classList.toggle('is-closed', !visible);
    el.menu.style.setProperty('--menu-fade', visible ? '1' : '0');
    // Self-sufficient fallbacks: the overlay must be dismissable even before styles.css lands,
    // and both properties transition normally if the stylesheet animates them.
    el.menu.style.opacity = visible ? '1' : '0';
    el.menu.style.pointerEvents = visible ? 'auto' : 'none';
    el.menu.setAttribute('aria-hidden', visible ? 'false' : 'true');
    // Keeps hidden buttons out of the tab order without fighting a CSS transition.
    if ('inert' in el.menu) el.menu.inert = !visible;
    doc.body.classList.toggle('menu-open', visible);
    doc.body.classList.toggle('menu-closed', !visible);
  }

  /* --- Mode ------------------------------------------------------------- */

  function applyMode(next) {
    const m = next === 'playing' || next === 'paused' || next === 'dead' ? next : 'menu';
    mode = m;
    if (game?.state) game.state.mode = m;
    lastSeenMode = m;
    t.guard = 0.28;

    el.menu?.setAttribute('data-mode', m);
    game.hud?.setMode?.(m);

    const target = PAGE_FOR_MODE[m];
    if (target) {
      // Overlay first, page second: the root is `inert` while closed, and a focus() call into
      // an inert subtree is discarded, which would leave the keyboard stranded on the body.
      setOverlay(true);
      showPage(target);
    } else {
      // No page is showing while the game has the screen. Clearing it (rather than leaving
      // the last page named) is what keeps the footer readout and the Esc routing out of the
      // gameplay frame entirely.
      page = null;
      el.menu?.setAttribute('data-menu-page', '');
      for (const key of pages.keys()) el.menu?.classList.remove(`is-${key}`);
      setOverlay(false);
      // A held Space or Enter must not keep firing the button we just left.
      if (doc.activeElement && doc.activeElement !== doc.body) doc.activeElement.blur?.();
    }
  }

  /* --- Pointer lock ------------------------------------------------------ */

  function requestLock() {
    if (!canvas || captureMode) return;
    if (doc.pointerLockElement === canvas) return;
    pendingLock = true;
    try {
      // Raw device input where the browser offers it: OS pointer acceleration ruins a
      // sensitivity setting that is supposed to mean the same thing on every machine.
      const p = canvas.requestPointerLock?.({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          try {
            canvas.requestPointerLock?.();
          } catch {
            pendingLock = false;
          }
        });
      }
    } catch {
      try {
        canvas.requestPointerLock?.();
      } catch {
        pendingLock = false;
      }
    }
  }

  function releaseLock() {
    pendingLock = false;
    t.retry = 0;
    lockRetries = 0;
    // Only claim the next unlock event when there is actually a lock to drop. Setting the flag
    // unconditionally would leave it armed and swallow the *following* genuine lock loss.
    if (!doc.pointerLockElement) return;
    intentionalUnlock = true;
    try {
      doc.exitPointerLock?.();
    } catch {
      /* already gone */
    }
  }

  function onLockChange() {
    const locked = doc.pointerLockElement === canvas;
    if (locked) {
      pendingLock = false;
      wasLocked = true;
      // A fresh lock retires any stale "this next unlock is mine" claim.
      intentionalUnlock = false;
      t.retry = 0;
      lockRetries = 0;
      return;
    }
    const deliberate = intentionalUnlock;
    intentionalUnlock = false;
    if (mode !== 'playing' || pendingLock || deliberate || !wasLocked) {
      wasLocked = false;
      return;
    }
    wasLocked = false;
    // Esc, alt-tab, or the browser taking the pointer back: all of them mean pause.
    pause();
  }

  function onLockError() {
    pendingLock = false;
    if (mode !== 'playing') return;
    // Chrome refuses a re-lock for about a second after an Esc exit. Try once more before
    // giving up and dropping into pause, which is what the player would do by hand anyway.
    if (lockRetries < 1) {
      lockRetries++;
      t.retry = 1.35;
      return;
    }
    game.hud?.notify?.('Pointer lock refused. Click to try again.', 'warn');
    pause();
  }

  /* --- Transitions ------------------------------------------------------- */

  function deploy() {
    if (captureMode) return;
    const from = mode;
    if (from === 'playing') {
      requestLock();
      return;
    }
    if (from === 'menu') {
      // Freeze nothing: the drift keeps running and is cross-faded out, so the first frame of
      // gameplay starts exactly where the title camera was.
      t.out = HANDOFF_OUT;
      t.in = 0;
      if (game.state) {
        game.state.hitFlash = 0;
        game.state.streak = 0;
      }
    }
    game.audio?.resume?.();
    applyMode('playing');
    requestLock();
  }

  function pause() {
    if (captureMode) return;
    if (mode !== 'playing') return;
    // Drop the trigger, otherwise a held mouse button resumes into a burst nobody asked for.
    game.weapon?.triggerUp?.();
    releaseLock();
    applyMode('paused');
    // Duck rather than mute: the ambience carries through the pause the way a console shooter's does.
    game.audio?.setVolume?.(settings.volume * 0.35);
  }

  function resume() {
    if (captureMode) return;
    if (mode !== 'paused') return;
    game.audio?.setVolume?.(settings.volume);
    game.audio?.resume?.();
    applyMode('playing');
    requestLock();
  }

  function die() {
    if (mode === 'dead') return;
    game.weapon?.triggerUp?.();
    releaseLock();
    if (game.state) {
      game.state.deaths = (game.state.deaths || 0) + 1;
      game.state.streak = 0;
    }
    writeDeathNote();
    applyMode('dead');
    game.audio?.setVolume?.(settings.volume * 0.5);
  }

  function writeDeathNote() {
    if (!el.deathNote) return;
    const kills = game.state?.kills || 0;
    const bits = [];
    if (lastDamage.valid) {
      const who = lastDamage.from ? `a ${lastDamage.from}` : 'contact';
      const range = lastDamage.distance > 0.5 ? ` at ${Math.round(lastDamage.distance)} m` : '';
      bits.push(`Killed by ${who}${range}${lastDamage.headshot ? '. Headshot.' : '.'}`);
    } else {
      bits.push('Killed in action.');
    }
    bits.push(kills === 1 ? '1 confirmed this life.' : `${kills} confirmed this life.`);
    el.deathNote.textContent = bits.join(' ');
  }

  /**
   * Redeploy: pick the spawn point furthest from anything still breathing, weighted against
   * the place we just died, then refill and hand control back.
   */
  function respawn() {
    const spawn = pickSafeSpawn();
    if (spawn && game.player?.teleport) {
      game.player.teleport(spawn.pos, spawn.yaw ?? Math.PI);
    }
    // respawn() clears the controller's internal dead flag and restores health; teleport above
    // has already moved its stored spawn point, so this lands where we chose.
    game.player?.respawn?.();
    if (game.state) {
      game.state.health = game.state.maxHealth ?? 100;
      game.state.hitFlash = 0;
      game.state.streak = 0;
    }
    if (game.weapon?.resetLoadout) game.weapon.resetLoadout();
    else game.weapon?.resupply?.();
    lastDamage.valid = false;
    game.audio?.setVolume?.(settings.volume);
    applyMode('playing');
    requestLock();
    game.hud?.notify?.('Redeployed', 'info');
  }

  const _spawnScratch = { pos: null, yaw: 0 };

  function pickSafeSpawn() {
    const points = game.level?.spawnPoints;
    if (!points || !points.length) return null;
    const enemies = game.ai?.enemies;
    const death = game.player?.position;
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!p || !p.pos) continue;
      let nearest = 1e6;
      if (enemies) {
        for (let k = 0; k < enemies.length; k++) {
          const e = enemies[k];
          if (!e || !e.active || e.dead || !e.position) continue;
          const d = p.pos.distanceTo(e.position);
          if (d < nearest) nearest = d;
        }
      }
      // Cap the reward at 45 m: past that the spawn is safe and the only thing left worth
      // optimising is not dropping the player back on the spot that just killed them.
      let score = Math.min(nearest, 45);
      if (death) score += Math.min(p.pos.distanceTo(death), 30) * 0.35;
      // Tiny jitter so repeated deaths do not loop the same corner of the map.
      score += Math.random() * 3.0;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) return null;
    _spawnScratch.pos = best.pos;
    _spawnScratch.yaw = best.yaw ?? Math.PI;
    return _spawnScratch;
  }

  function quit() {
    releaseLock();
    game.weapon?.triggerUp?.();
    game.audio?.setVolume?.(settings.volume);
    if (game.state) {
      game.state.score = 0;
      game.state.kills = 0;
      game.state.deaths = 0;
      game.state.streak = 0;
      game.state.health = game.state.maxHealth ?? 100;
      game.state.hitFlash = 0;
    }
    const spawn = pickSafeSpawn();
    if (spawn && game.player?.teleport) game.player.teleport(spawn.pos, spawn.yaw);
    game.player?.respawn?.();
    if (game.weapon?.resetLoadout) game.weapon.resetLoadout();
    lastDamage.valid = false;
    // Blend from wherever the player was standing back onto the flythrough.
    _frozenPos.copy(game.camera?.position || _frozenPos);
    if (game.camera) _qFrozen.copy(game.camera.quaternion);
    t.in = HANDOFF_IN;
    t.out = 0;
    applyMode('menu');
  }

  /* --- Keyboard ---------------------------------------------------------- */

  function onEscape() {
    if (page === 'settings' || page === 'controls') {
      showPage(mode === 'paused' ? 'pause' : 'title');
      t.guard = 0.2;
      return;
    }
    if (mode === 'playing') pause();
    else if (mode === 'paused') resume();
  }

  function onConfirm() {
    if (page === 'settings' || page === 'controls') {
      showPage(mode === 'paused' ? 'pause' : 'title');
      t.guard = 0.2;
      return;
    }
    if (mode === 'menu') deploy();
    else if (mode === 'paused') resume();
    else if (mode === 'dead') respawn();
  }

  function onKeyDown(e) {
    if (captureMode || disposed) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Escape') {
      // Chrome swallows the Esc that breaks pointer lock, so this only fires when unlocked.
      if (t.guard > 0) return;
      e.preventDefault();
      onEscape();
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      // Let a focused control answer for itself; only handle the ambient case.
      const active = doc.activeElement;
      if (active && active !== doc.body && el.menu?.contains(active)) return;
      if (t.guard > 0) return;
      e.preventDefault();
      onConfirm();
    }
  }

  /* --- Pointer ----------------------------------------------------------- */

  function onCanvasClick() {
    if (captureMode || disposed) return;
    if (mode === 'paused') resume();
    else if (mode === 'menu') deploy();
    else if (mode === 'playing' && doc.pointerLockElement !== canvas) requestLock();
  }

  /** Anything a click could plausibly be aimed at. A hit on one of these is not a backdrop click. */
  const INTERACTIVE = 'button, input, select, textarea, a, label, [data-action], [role="radio"], [role="switch"]';

  function onMenuClick(e) {
    // "Click the canvas to resume" cannot rely on the canvas: the overlay is a full-screen
    // fixed layer and swallows the event. So the overlay honours the same gesture, but only
    // on the two pages where it is unambiguous, and only when the click missed every control.
    if (page !== 'pause' && page !== 'title') return;
    const target = e.target;
    if (target && target.closest && target.closest(INTERACTIVE)) return;
    if (page === 'pause') resume();
    else deploy();
  }

  function onAction(e) {
    const btn = e.target.closest?.('[data-action]');
    if (!btn || !el.menu?.contains(btn)) return;
    const action = btn.getAttribute('data-action');
    e.preventDefault();
    switch (action) {
      case 'play':
        deploy();
        break;
      case 'resume':
        resume();
        break;
      case 'settings':
        if (mode === 'playing') pause();
        showPage('settings');
        break;
      case 'controls':
        if (mode === 'playing') pause();
        showPage('controls');
        break;
      case 'back':
        showPage(mode === 'paused' ? 'pause' : 'title');
        break;
      case 'respawn':
        respawn();
        break;
      case 'quit':
        quit();
        break;
      default:
        break;
    }
  }

  /* --- Title camera ------------------------------------------------------ */

  /**
   * Advance and evaluate the flythrough into `_driftPos` / `_q`.
   *
   * The look point is smoothed with an exponential filter rather than sampled directly: the
   * spline's own tangent swings hard through the corners, and a camera that snaps its gaze is
   * the difference between a title screen and a debug orbit.
   */
  function evaluateDrift() {
    const dt = t.dt;
    t.time += dt;
    t.distance += DRIFT_SPEED * dt;
    _sp.d = t.distance;
    tFromDistance();

    sampleClosed(CAM_STATIONS, STATION_COUNT, _pos);
    sampleClosed(CAM_TARGETS, STATION_COUNT, _look);

    // Handheld float: two incommensurate frequencies so the loop never reads as a loop.
    const bx = Math.sin(t.time * 0.21) * 0.34 + Math.sin(t.time * 0.37 + 1.7) * 0.16;
    const by = Math.sin(t.time * 0.17 + 0.9) * 0.22 + Math.sin(t.time * 0.44) * 0.08;
    _pos.x += bx;
    _pos.y += by;
    _pos.z += Math.sin(t.time * 0.13 + 2.4) * 0.28;

    if (!lookSeeded) {
      _lookSmooth.copy(_look);
      lookSeeded = true;
    } else {
      // 1 - exp(-k dt) so the smoothing is identical at 30 and 240 fps. Written out rather
      // than calling Vector3.lerp for the boxing reason given at the top of the file.
      const a = 1 - Math.exp(-1.1 * dt);
      _lookSmooth.x += (_look.x - _lookSmooth.x) * a;
      _lookSmooth.y += (_look.y - _lookSmooth.y) * a;
      _lookSmooth.z += (_look.z - _lookSmooth.z) * a;
    }

    _driftPos.copy(_pos);
    _m.lookAt(_driftPos, _lookSmooth, _up);
    _q.setFromRotationMatrix(_m);
    // A whisper of roll, under a degree, to break the perfectly level horizon. Post-multiplied
    // by hand rather than via setFromAxisAngle + multiply: for a rotation about the local Z the
    // quaternion product collapses to four terms with p = (0, 0, sin(a/2), cos(a/2)), and this
    // keeps the last double out of a call argument (see the boxing note by `_sp`).
    const half = Math.sin(t.time * 0.15) * 0.00525;
    const rs = Math.sin(half);
    const rc = Math.cos(half);
    const qx = _q.x;
    const qy = _q.y;
    const qz = _q.z;
    const qw = _q.w;
    _q.x = qx * rc + qy * rs;
    _q.y = qy * rc - qx * rs;
    _q.z = qw * rs + qz * rc;
    _q.w = qw * rc - qz * rs;
  }

  function updateCamera() {
    const dt = t.dt;
    const cam = game.camera;
    if (!cam) return;

    const wantDrift = mode === 'menu' || t.out > 0;
    if (!wantDrift) return;

    evaluateDrift();

    let fov;
    if (mode === 'menu') {
      // Title: the drift owns the camera outright, optionally easing in from the last
      // gameplay pose after a quit.
      cam.position.copy(_driftPos);
      cam.quaternion.copy(_q);
      fov = t.cineFov;
      if (t.in > 0) {
        t.in = Math.max(0, t.in - dt);
        const w = smootherstep(clamp01(t.in / HANDOFF_IN));
        cam.position.lerp(_frozenPos, w);
        cam.quaternion.slerp(_qFrozen, w);
        fov = lerp(t.cineFov, settings.fov, w);
      }
    } else {
      // Playing: the controller has already written its pose this frame. Fade the drift out
      // over the top of it, so neither camera ever teleports.
      t.out = Math.max(0, t.out - dt);
      const w = smootherstep(clamp01(t.out / HANDOFF_OUT));
      cam.position.lerp(_driftPos, w);
      cam.quaternion.slerp(_q, w);
      fov = lerp(settings.fov, t.cineFov, w);
      if (t.out <= 0) {
        // Land exactly on the player's field of view so weapon.js and controller.js rebaseline
        // onto the right number rather than a blended one. Forced, not epsilon-gated: a stray
        // tenth of a degree here becomes the permanent hipfire baseline downstream.
        cam.fov = settings.fov;
        cam.updateProjectionMatrix();
        return;
      }
    }

    if (Math.abs(cam.fov - fov) > 1e-4) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /* --- Footer readout ---------------------------------------------------- */

  function updatePerfNote() {
    if (!el.perfNote || page !== 'title') return;
    t.perf -= t.dt;
    if (t.perf > 0) return;
    t.perf = 0.5;
    const fpsQ = Math.round((game.clock?.fps || 60) / 2) * 2;
    const w = game.engine?.size?.w | 0;
    if (fpsQ === perfFpsQ && w === perfW) return;
    perfFpsQ = fpsQ;
    perfW = w;
    const h = game.engine?.size?.h | 0;
    const q = String(settings.quality).toUpperCase();
    el.perfNote.textContent = w ? `${q} / ${w}x${h} / ${fpsQ} fps` : q;
  }

  /* --- Frame ------------------------------------------------------------- */

  function update(dt, gameRef) {
    if (disposed || captureMode) return;
    const g = gameRef || game;
    const step = typeof dt === 'number' && isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    if (t.guard > 0) t.guard = Math.max(0, t.guard - step);

    if (t.retry > 0) {
      t.retry -= step;
      if (t.retry <= 0 && mode === 'playing') requestLock();
    }

    // Death is detected here rather than pushed by the AI: health is the only authority, and
    // this way a scripted or explosive kill lands on the same screen.
    const st = g.state;
    if (st) {
      if (st.mode !== lastSeenMode && st.mode !== mode) {
        // Someone else moved the state machine. Mirror it rather than fight it.
        applyMode(st.mode);
      }
      if (mode === 'playing' && (st.health ?? 100) <= 0) die();
    }

    // Edge-triggered keys, for the paths where the browser did deliver the keydown.
    if (t.guard <= 0) {
      const inp = g.input;
      if (inp?.pressed?.('Escape')) onEscape();
      else if (inp?.pressed?.('Enter') || inp?.pressed?.('NumpadEnter')) {
        const active = doc.activeElement;
        if (!(active && active !== doc.body && el.menu?.contains(active))) onConfirm();
      }
    }

    // Handed over on the scratch object, not as an argument: see the note by `_sp`.
    t.dt = step;
    updateCamera();
    updatePerfNote();
  }

  /* --- Events ------------------------------------------------------------ */

  const unbind = [];

  function bind(target, type, fn, opts) {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    unbind.push(() => target.removeEventListener(type, fn, opts));
  }

  bind(el.menu, 'click', onAction);
  bind(el.menu, 'click', onMenuClick);
  bind(canvas, 'click', onCanvasClick);
  bind(doc, 'pointerlockchange', onLockChange);
  bind(doc, 'pointerlockerror', onLockError);
  bind(window, 'keydown', onKeyDown, { passive: false });
  bind(window, 'blur', () => {
    if (mode === 'playing') pause();
  });
  bind(doc, 'visibilitychange', () => {
    if (doc.hidden && mode === 'playing') pause();
  });

  // Remember who put us down, for the death card.
  const offDamage = game.events?.on?.('damage', (p) => {
    if (!p) return;
    lastDamage.valid = true;
    lastDamage.headshot = !!p.headshot;
    lastDamage.distance = typeof p.distance === 'number' ? p.distance : 0;
    const from = p.from;
    lastDamage.from = from?.archetype?.label || from?.archetype?.id || from?.name || 'a soldier';
  });
  if (typeof offDamage === 'function') unbind.push(offDamage);

  /* --- Init -------------------------------------------------------------- */

  buildSettings();
  applyAll();
  refreshCineFov();

  if (el.menu) {
    // Palette handles for styles.css, so the overlay is tinted from art.js like everything else.
    const s = el.menu.style;
    s.setProperty('--menu-primary', PALETTE.hudPrimary);
    s.setProperty('--menu-dim', PALETTE.hudDim);
    s.setProperty('--menu-accent', PALETTE.hudAccent);
    s.setProperty('--menu-danger', PALETTE.hudDanger);
  }

  if (captureMode) {
    // The screenshot harness drives the camera itself and must never see the overlay.
    setOverlay(false);
    showPage('title');
    mode = 'playing';
  } else {
    applyMode(game?.state?.mode || 'menu');
    // Seed the flythrough so the very first rendered frame is already the title composition.
    t.dt = 0;
    updateCamera();
  }

  /* --- Public API -------------------------------------------------------- */

  function open(name) {
    if (!name || name === 'pause') {
      if (mode === 'playing') pause();
      else showPage(name || (mode === 'dead' ? 'dead' : 'title'));
      return;
    }
    if (mode === 'playing' && name !== 'title') pause();
    if (name === 'title' && mode !== 'menu') quit();
    else showPage(pages.has(name) ? name : 'title');
  }

  function close() {
    if (mode === 'paused') resume();
    else if (mode === 'menu') deploy();
    else setOverlay(false);
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    changeListeners.add(fn);
    return () => changeListeners.delete(fn);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const fn of unbind) {
      try {
        fn();
      } catch {
        /* listener already gone */
      }
    }
    unbind.length = 0;
    changeListeners.clear();
    if (saveTimer) {
      // Flush rather than drop: a slider moved in the last 220 ms is still the player's choice.
      clearTimeout(saveTimer);
      saveTimer = 0;
      try {
        const raw = readStored();
        for (const key of Object.keys(settings)) raw[key] = settings[key];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
      } catch {
        /* no storage — nothing to flush to */
      }
    }
    controls.clear();
  }

  return {
    settings,
    open,
    close,
    update,
    onChange,
    set,
    /** Explicit transitions, exposed for the debug console and anything scripted. */
    deploy,
    pause,
    resume,
    respawn,
    quit,
    dispose,
    get page() {
      return page;
    },
    get mode() {
      return mode;
    },
    get locked() {
      return doc.pointerLockElement === canvas;
    },
  };
}

export default createMenu;
