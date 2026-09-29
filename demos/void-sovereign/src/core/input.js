import * as THREE from '../../vendor/three/build/three.module.js';
import { bus } from './events.js';
import { LAYER } from './engine.js';

/* Raw pointer/key/touch events in, fleet intents out.

   Nothing downstream of here knows what a mouse is. This module owns the
   selection set, the screen-space marquee and the move-order gizmo, and it
   speaks to the rest of the game only through the canonical `cmd:*`,
   `sel:*` and `ui:*` events.

   Two pieces of 3D are drawn here rather than in the HUD, because both must
   sit in the world at the correct perspective and neither is DOM:
     - the band-select marquee, pinned to the near plane so it is pixel-exact;
     - the Homeworld move gizmo (disc, stalk, scale ticks, heading).
   Everything else on screen belongs to ui/hud.js. */

/* ------------------------------------------------------------------ tuning */

const DRAG_PX = 4;            // pointer travel before a click becomes a drag
const TOUCH_DRAG_PX = 11;
const PICK_PX = 17;           // generous: a 14 m interceptor at 4 km is 2 px
const TOUCH_PICK_PX = 28;
const DOUBLE_MS = 340;
const LONG_PRESS_MS = 460;
const GIZMO_VERTS = 1536;
const BAND_VERTS = 64;

const DEFAULTS = {
  team: 0,
  edgeScroll: true,
  edgeMargin: 16,             // CSS px
  panPixelsPerSecond: 950,
  boostMultiplier: 2.6,
  keyOrbitPixelsPerSecond: 340,
  colour: 0x86e9ff,
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const FORMATIONS = ['delta', 'broad', 'claw', 'x', 'wall', 'sphere'];
export const STANCES = ['evasive', 'neutral', 'aggressive'];
export const SPEED_STEPS = [0, 0.25, 0.5, 1, 2, 4];

/* ------------------------------------------------------ control bindings */

/* Every key this module answers to lives in one table, and the handlers switch
   on an *action*, never on a key code.

   It used to be a `switch (code)` of hand-written `case 'KeyZ'`, which made the
   honest answer to "what are the controls and can I change them?" — the first
   question the first player asked — "read the source, and no". With the scheme
   as data, rebinding is a data change and the help card, the options panel and
   the dispatcher cannot drift apart.

   Modifiers are deliberately *not* part of a binding. Shift means "queue this
   order" / "hurry" / "coarser" everywhere in the scheme, so folding it into
   bindings would break Shift+A queueing an attack-move the moment anyone
   rebound anything. Ctrl is a fixed property of the two actions that have
   always carried it — select-all and control-group assign — not something the
   player adds or removes. What is rebindable is exactly the key.

   `fixed` entries are families rather than single keys (the number row, the
   numpad). They are listed so the panel can show them, and they are not
   rebindable, because splitting "0 – 9" into ten rebindable rows is a redesign
   of the scheme rather than an answer to the question asked. */

export const ACTION_GROUPS = ['Time', 'Selection', 'Orders', 'Camera', 'Control groups'];

export const ACTIONS = [
  { id: 'time.pause', group: 'Time', label: 'Pause the battle', key: 'Space', prevent: true,
    note: 'Orders given while paused are obeyed the moment it resumes.' },
  { id: 'time.faster', group: 'Time', label: 'Game speed up', key: 'Equal', alt: ['NumpadAdd'] },
  { id: 'time.slower', group: 'Time', label: 'Game speed down', key: 'Minus', alt: ['NumpadSubtract'] },
  { id: 'ui.help', group: 'Time', label: 'Controls card', key: 'KeyH' },
  { id: 'audio.mute', group: 'Time', label: 'Mute or unmute all sound', key: 'KeyM' },

  { id: 'shell.menu', group: 'Time', label: 'Pause menu — and closes whatever is open',
    fixed: 'Esc' },

  { id: 'selection.all', group: 'Selection', label: 'Select your whole fleet', key: 'KeyA',
    ctrl: true, prevent: true },
  /* Clear-selection used to be Escape and is not any more: the shell owns
     Escape now (SHELL-CONTRACT §3), and two claimants on one key is how this
     project shipped its first keyboard trap. D for deselect — free, on the
     order hand, and rebindable like everything else. */
  { id: 'selection.clear', group: 'Selection', label: 'Clear selection', key: 'KeyD',
    note: 'Escape is the pause menu now, so deselecting moved to its own key.' },

  { id: 'orders.attackMove', group: 'Orders', label: 'Attack-move to the cursor', key: 'KeyA' },
  { id: 'orders.guard', group: 'Orders', label: 'Guard the hull or the position', key: 'KeyG' },
  { id: 'orders.patrol', group: 'Orders', label: 'Patrol out and back', key: 'KeyP' },
  { id: 'orders.stop', group: 'Orders', label: 'Stop — cancel all queued orders', key: 'KeyS' },
  { id: 'orders.stanceEvasive', group: 'Orders', label: 'Stance: evasive', key: 'KeyZ' },
  { id: 'orders.stanceNeutral', group: 'Orders', label: 'Stance: neutral', key: 'KeyX' },
  { id: 'orders.stanceAggressive', group: 'Orders', label: 'Stance: aggressive', key: 'KeyC' },
  { id: 'orders.formation', group: 'Orders', label: 'Formation: delta, broad, claw, X, wall, sphere',
    fixed: '1 – 6 (Shift or numpad)' },

  { id: 'camera.focus', group: 'Camera', label: 'Focus and follow the selection', key: 'KeyF' },
  { id: 'camera.panUp', group: 'Camera', label: 'Pan up', key: 'ArrowUp', hold: true, prevent: true },
  { id: 'camera.panDown', group: 'Camera', label: 'Pan down', key: 'ArrowDown', hold: true, prevent: true },
  { id: 'camera.panLeft', group: 'Camera', label: 'Pan left', key: 'ArrowLeft', hold: true, prevent: true },
  { id: 'camera.panRight', group: 'Camera', label: 'Pan right', key: 'ArrowRight', hold: true, prevent: true },
  { id: 'camera.orbitLeft', group: 'Camera', label: 'Swing the camera left', key: 'KeyQ', hold: true },
  { id: 'camera.orbitRight', group: 'Camera', label: 'Swing the camera right', key: 'KeyE', hold: true },
  { id: 'camera.zoomIn', group: 'Camera', label: 'Zoom in without the wheel', key: 'PageUp', prevent: true },
  { id: 'camera.zoomOut', group: 'Camera', label: 'Zoom out without the wheel', key: 'PageDown', prevent: true },
  { id: 'ui.sensors', group: 'Camera', label: 'Sensors manager', key: 'Tab', prevent: true },

  { id: 'groups.recall', group: 'Control groups', label: 'Recall group (press twice to focus it)',
    fixed: '0 – 9' },
  { id: 'groups.assign', group: 'Control groups', label: 'Assign control group',
    fixed: 'Ctrl + 0 – 9' },
];

export const ACTION_BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

export const DEFAULT_BINDINGS = Object.freeze(
  ACTIONS.reduce((out, a) => {
    if (!a.fixed) out[a.id] = a.key;
    return out;
  }, {}),
);

/* A bare modifier is never a binding — capturing one would produce an action
   that fires every time the player holds Shift to queue an order. */
const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
]);

const KEY_LABELS = {
  Space: 'Space', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace',
  Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End',
  PageUp: 'Page Up', PageDown: 'Page Down',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Equal: '+', Minus: '−', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  Semicolon: ';', Quote: '\'', BracketLeft: '[', BracketRight: ']', Backquote: '`',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num ×',
  NumpadDivide: 'Num ÷', NumpadEnter: 'Num Enter', NumpadDecimal: 'Num .',
  CapsLock: 'Caps Lock',
};

/** The key as a player would say it, not as the DOM spells it. */
export function keyLabel(code) {
  if (!code) return '—';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

/** What the panel prints on an action's key cap, Ctrl prefix and all. */
export function bindingLabel(id) {
  const def = ACTION_BY_ID.get(id);
  if (!def) return '—';
  if (def.fixed) return def.fixed;
  const label = keyLabel(optionsStore.binding(id));
  return def.ctrl ? `Ctrl + ${label}` : label;
}

/* ------------------------------------------------------------- persistence */

const STORAGE_KEY = 'vs.options.v1';

export const SENSITIVITY_RANGE = Object.freeze({ min: 0.4, max: 2.5, step: 0.05 });

const GAMEPLAY_DEFAULTS = Object.freeze({
  cameraSensitivity: 1,
  invertY: false,
  edgeScroll: true,
});

/* Storage can throw on *access*, not merely on read: a hardened profile or a
   third-party-cookie block makes `window.localStorage` itself a throwing
   getter. Everything here degrades to defaults rather than to a boot failure —
   a preference nobody can save is a small loss, a game that will not start is
   not. */
function safeStorage() {
  try {
    if (typeof window === 'undefined') return null;
    const s = window.localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch (err) {
    return null;
  }
}

class OptionsStore {
  constructor() {
    this.storageKey = STORAGE_KEY;
    this.defaults = { bindings: DEFAULT_BINDINGS, gameplay: GAMEPLAY_DEFAULTS };
    this._bindings = Object.assign({}, DEFAULT_BINDINGS);
    this._gameplay = Object.assign({}, GAMEPLAY_DEFAULTS);
    this._chords = new Map();
    this._listeners = new Set();
    this.storageAvailable = !!safeStorage();
    this._load();
    this._reindex();
  }

  get bindings() { return Object.assign({}, this._bindings); }

  get gameplay() { return Object.assign({}, this._gameplay); }

  binding(id) { return this._bindings[id] || ''; }

  /* What the dispatcher matches on: the key code, prefixed for the two actions
     that have always required Ctrl. */
  chord(code, ctrl) { return (ctrl ? 'Ctrl+' : '') + code; }

  lookup(code, ctrl) { return this._chords.get(this.chord(code, !!ctrl)) || null; }

  /** The action already holding `code` for this action's modifier, or null. */
  conflict(id, code) {
    const def = ACTION_BY_ID.get(id);
    if (!def || !code) return null;
    const hit = this._chords.get(this.chord(code, !!def.ctrl));
    return hit && hit.id !== id ? hit : null;
  }

  /** Returns `{ ok, conflict }` — refusing rather than silently unbinding the
      action the player already relies on. */
  setBinding(id, code) {
    const def = ACTION_BY_ID.get(id);
    if (!def || def.fixed) return { ok: false, conflict: null, reason: 'unknown' };
    if (!code || MODIFIER_CODES.has(code)) return { ok: false, conflict: null, reason: 'modifier' };
    if (this._bindings[id] === code) return { ok: true, conflict: null };
    const clash = this.conflict(id, code);
    if (clash) return { ok: false, conflict: clash, reason: 'conflict' };
    this._bindings[id] = code;
    this._reindex();
    this._save();
    this._emit(`bindings.${id}`, code);
    return { ok: true, conflict: null };
  }

  resetBindings() {
    this._bindings = Object.assign({}, DEFAULT_BINDINGS);
    this._reindex();
    this._save();
    this._emit('bindings', this.bindings);
  }

  setGameplay(key, value) {
    if (!(key in GAMEPLAY_DEFAULTS)) return false;
    let v = value;
    if (key === 'cameraSensitivity') {
      v = Number(v);
      if (!Number.isFinite(v)) return false;
      v = clamp(v, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max);
    } else {
      v = !!v;
    }
    if (this._gameplay[key] === v) return true;
    this._gameplay[key] = v;
    this._save();
    this._emit(`gameplay.${key}`, v);
    return true;
  }

  resetGameplay() {
    this._gameplay = Object.assign({}, GAMEPLAY_DEFAULTS);
    this._save();
    this._emit('gameplay', this.gameplay);
  }

  /** Local subscription for things that must react synchronously (the input
      controller). Everything else can listen for `options:changed` on the bus. */
  onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(key, value) {
    refreshControlScheme();
    for (const fn of this._listeners) {
      try { fn(key, value); } catch (err) { /* one bad listener is not a crash */ }
    }
    bus.emit('options:changed', { key, value });
  }

  _load() {
    const s = safeStorage();
    if (!s) return;
    let raw = null;
    try { raw = s.getItem(STORAGE_KEY); } catch (err) { return; }
    if (!raw) return;

    let data = null;
    try { data = JSON.parse(raw); } catch (err) { data = null; }
    /* Corrupt or hand-mangled JSON is simply not a preference: fall through on
       defaults. Throwing here would take the whole boot down with it. */
    if (!data || typeof data !== 'object') return;

    const b = data.bindings;
    if (b && typeof b === 'object') {
      for (const def of ACTIONS) {
        if (def.fixed) continue;
        const code = b[def.id];
        if (typeof code === 'string' && code && !MODIFIER_CODES.has(code)) {
          this._bindings[def.id] = code;
        }
      }
      /* Validate the finished set, never as it is being read: a straight swap
         of two keys is legal and looks like a collision half-way through. */
      const used = new Set();
      for (const def of ACTIONS) {
        if (def.fixed) continue;
        const chord = this.chord(this._bindings[def.id], !!def.ctrl);
        if (!used.has(chord)) {
          used.add(chord);
          continue;
        }
        const fallback = this.chord(DEFAULT_BINDINGS[def.id], !!def.ctrl);
        this._bindings[def.id] = used.has(fallback) ? '' : DEFAULT_BINDINGS[def.id];
        if (!used.has(fallback)) used.add(fallback);
      }
    }

    const g = data.gameplay;
    if (g && typeof g === 'object') {
      if (Number.isFinite(g.cameraSensitivity)) {
        this._gameplay.cameraSensitivity =
          clamp(g.cameraSensitivity, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max);
      }
      if (typeof g.invertY === 'boolean') this._gameplay.invertY = g.invertY;
      if (typeof g.edgeScroll === 'boolean') this._gameplay.edgeScroll = g.edgeScroll;
    }
  }

  _save() {
    const s = safeStorage();
    if (!s) return;
    try {
      s.setItem(STORAGE_KEY, JSON.stringify({
        v: 1,
        bindings: this._bindings,
        gameplay: this._gameplay,
      }));
    } catch (err) {
      /* Quota, private mode, a disabled origin. The session keeps its settings;
         only the memory of them is lost. */
    }
  }

  _reindex() {
    this._chords.clear();
    for (const def of ACTIONS) {
      if (def.fixed) continue;
      const code = this._bindings[def.id];
      if (code) {
        const chord = this.chord(code, !!def.ctrl);
        if (!this._chords.has(chord)) this._chords.set(chord, def);
      }
      /* Alternates are fixed alongside the rebindable primary — the numpad
         +/− have always worked and taking them away would be a regression —
         but they still occupy their chord so a rebind cannot land on top. */
      for (const extra of def.alt || []) {
        const chord = this.chord(extra, !!def.ctrl);
        if (!this._chords.has(chord)) this._chords.set(chord, def);
      }
    }
  }
}

export const optionsStore = new OptionsStore();

/* ------------------------------------------------------------ help scheme */

/** The full control scheme, as data, so ui/hud.js can render the help panel
    from the same source of truth the handlers are written against. Rebuilt in
    place whenever a binding changes, so the card is right at whatever moment
    it is built.

    Time comes first on purpose. Tactical pause is the single most valuable
    thing a new commander can be told about — you can pause the battle and
    still issue every order — and it is invisible unless something says so. */
export const CONTROL_SCHEME = [];

function buildControlScheme() {
  const K = (id) => bindingLabel(id);
  const arrowsAreDefault = ['camera.panUp', 'camera.panDown', 'camera.panLeft', 'camera.panRight']
    .every((id) => optionsStore.binding(id) === DEFAULT_BINDINGS[id]);
  const panKeys = arrowsAreDefault
    ? 'Arrow keys'
    : `${K('camera.panUp')} ${K('camera.panLeft')} ${K('camera.panDown')} ${K('camera.panRight')}`;

  return [
    {
      group: 'Time',
      rows: [
        [K('time.pause'), 'Pause the battle — you can still select and give orders'],
        [`${K('time.faster')} / ${K('time.slower')}`, 'Game speed: ¼, ½, ×1, ×2, ×4'],
        [K('ui.help'), 'This panel'],
        [K('audio.mute'), 'Mute or unmute all sound'],
        [K('shell.menu'), 'Pause menu — and closes whatever is open'],
      ],
    },
    {
      group: 'Selection',
      rows: [
        ['Left click', 'Select unit under the cursor'],
        ['Left drag', 'Band-select'],
        ['Shift + click / drag', 'Add to selection'],
        ['Ctrl + click / drag', 'Toggle in selection'],
        ['Double click', 'Select every ship of that class on screen'],
        [K('selection.all'), 'Select your whole fleet'],
        [K('selection.clear'), 'Clear selection'],
      ],
    },
    {
      group: 'Orders',
      rows: [
        ['Right click', 'Move to the point under the cursor'],
        ['Right drag up / down', 'Set the move altitude (disc + stalk gizmo)'],
        ['Right click on enemy', 'Attack'],
        ['Shift + any order', 'Queue it behind the current one'],
        [K('orders.attackMove'), 'Attack-move to the cursor — engage anything met on the way'],
        [K('orders.guard'), 'Guard the hull under the cursor, or hold that position'],
        [K('orders.patrol'), 'Patrol out to the cursor and back'],
        [K('orders.stop'), 'Stop — cancel all queued orders'],
        [K('orders.formation'), 'Formation: delta, broad, claw, X, wall, sphere'],
        [
          `${K('orders.stanceEvasive')} / ${K('orders.stanceNeutral')} / ${K('orders.stanceAggressive')}`,
          'Stance: evasive, neutral, aggressive',
        ],
      ],
    },
    {
      group: 'Camera',
      rows: [
        ['Right drag (nothing selected)', 'Orbit'],
        ['Middle drag', 'Orbit'],
        ['Alt + right drag', 'Orbit, even with a selection'],
        ['Wheel', 'Zoom (exponential; Shift for coarse)'],
        [`${K('camera.zoomIn')} / ${K('camera.zoomOut')}`, 'Zoom without the wheel'],
        [panKeys, 'Pan across the focus plane (Shift to hurry)'],
        [`${K('camera.orbitLeft')} / ${K('camera.orbitRight')}`, 'Swing the camera left / right'],
        ['Screen edge', 'Edge-scroll'],
        [K('camera.focus'), 'Focus and follow the selection'],
        [K('ui.sensors'), 'Sensors manager'],
      ],
    },
    {
      group: 'Control groups',
      rows: [
        [K('groups.assign'), 'Assign control group'],
        [K('groups.recall'), 'Recall group (press twice to focus it)'],
      ],
    },
    {
      group: 'Touch',
      rows: [
        ['One finger drag', 'Orbit'],
        ['Tap', 'Select'],
        ['Two-finger pinch', 'Zoom'],
        ['Two-finger drag', 'Pan'],
        ['Long press', 'Move gizmo (second finger sets altitude)'],
      ],
    },
  ];
}

/* Mutated in place rather than reassigned: `ui/hud.js` imports the binding, and
   an exported const array it already holds must stay the same array. */
function refreshControlScheme() {
  CONTROL_SCHEME.length = 0;
  for (const block of buildControlScheme()) CONTROL_SCHEME.push(block);
}

refreshControlScheme();

/* ------------------------------------------------------------------ helpers */

const NUMPAD_RE = /^Numpad([1-6])$/;
const DIGIT_RE = /^Digit([0-9])$/;

/** 1, 2 or 5 times a power of ten — the spacing a ruler would use. */
function niceStep(span, count, minimum) {
  const raw = Math.max(Math.abs(span) / Math.max(1, count), minimum, 1e-6);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return mult * mag;
}

function entityPosition(e) {
  return (e && e.position) || (e && e.object3D && e.object3D.position) || null;
}

/* Scratch. */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _ndc = new THREE.Vector2();
const _tip = new THREE.Vector3();
const _mid = { x: 0, y: 0 };
const _ptA = new THREE.Vector3();
const _ptB = new THREE.Vector3();

/* Letters give orders, arrows move the camera.

   WASD used to pan, but attack-move belongs on A in every RTS a player has
   touched, and stop belongs on S — the collision is unresolvable while WASD
   holds the camera. Panning keeps the arrows, the screen edge, Q/E and the
   middle-drag orbit, which in a camera this orbit-centric is no real loss;
   whereas an attack-move you cannot reach is a missing verb. All of that is
   now a default in ACTIONS rather than a rule here, and a player who wants
   WASD back can have it.

   Shift stays hard-wired: it is the "more" modifier across the whole scheme
   (queue, hurry, coarser) rather than a binding of its own. */
const BOOST_KEYS = new Set(['ShiftLeft', 'ShiftRight']);

const HOLD_IDS = [
  'camera.panUp', 'camera.panDown', 'camera.panLeft', 'camera.panRight',
  'camera.orbitLeft', 'camera.orbitRight',
];

function makeLineBuffer(vertexCount) {
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
  const col = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  col.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pos);
  geo.setAttribute('color', col);
  geo.setDrawRange(0, 0);
  /* The overlay is drawn without depth test and never culled, so a bounding
     sphere could only ever cost a wrong cull. */
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  return geo;
}

/* ---------------------------------------------------------------- controller */

export class InputController {
  constructor({ engine, domElement = null, camera = null, rig = null, world = null, options = null }) {
    this.engine = engine;
    this.rig = camera || rig;
    this.canvas = domElement || (engine.renderer && engine.renderer.domElement);
    this.world = world || null;
    /* A host that states its own edge-scroll policy keeps it: a probe harness
       that switched it off must not have it switched back on by a preference
       left behind by somebody else's session. */
    this._edgeScrollPinned = !!(options && Object.prototype.hasOwnProperty.call(options, 'edgeScroll'));
    this.options = Object.assign({}, DEFAULTS, options || {});
    this.team = this.options.team;

    if (!this.rig) throw new Error('InputController needs a CameraRig');

    /* Selection is owned here; `sel:changed` is the only way out. */
    this._selection = [];
    this._selSet = new Set();
    this._emitting = false;

    this.formation = null;
    this.stance = 'neutral';
    this._groups = new Map();
    this._lastRecall = { n: -1, t: 0 };
    this._speedIndex = SPEED_STEPS.indexOf(1);
    this._prevSpeedIndex = this._speedIndex;
    this._sensorsOpen = false;

    /* Pointer state machine. */
    this._mode = 'idle';
    this._activePointer = -1;
    this._downX = 0; this._downY = 0;
    this._lastX = 0; this._lastY = 0;
    this._downShift = false; this._downCtrl = false;
    this._hoverX = -1; this._hoverY = -1;
    this._pointerInside = false;
    this._lastClick = { t: 0, x: 0, y: 0, classId: null };
    this._attackId = -1;

    this._touches = new Map();
    this._longPress = 0;
    this._altPointer = -1;
    this._altStartY = 0;
    this._altBase = 0;
    this._pinchDist = 0;
    this._pinchMid = { x: 0, y: 0 };

    this._keys = new Set();
    this._rectCache = null;
    this._lastUpdateMs = -1e9;

    /* Bindings and the two camera preferences come from the options store and
       follow it live — a rebind must take effect on the next keystroke, not on
       the next reload. */
    this._sens = 1;
    this._invertY = 1;
    this._holdCodes = { up: '', down: '', left: '', right: '', orbitL: '', orbitR: '' };
    this._holdSet = new Set();
    this._applyOptions();
    this._offOptions = optionsStore.onChange(() => this._applyOptions());

    /* Gizmo state, in world units. */
    this._giz = {
      active: false,
      planeY: 0,
      plane: new THREE.Vector3(),
      from: new THREE.Vector3(),
      radius: 40,
      altitude: 0,
      anchorX: 0,
      anchorY: 0,
    };
    this._band = { active: false, x0: 0, y0: 0, x1: 0, y1: 0 };

    /* Mirrored from `ui:audioChanged`. Assumed unmuted until audio says
       otherwise: a build with no AudioSystem at all should still answer M with
       something honest rather than silently doing nothing. */
    this._muted = false;
    this._audioSeen = false;
    this._audioAvailable = true;

    this._buildOverlay();
    this._bind();

    this._offs = [
      bus.on('sel:changed', (p) => {
        if (this._emitting) return;
        const ids = (p && p.ids) || [];
        this._selection = ids.slice();
        this._selSet = new Set(this._selection);
      }),
      bus.on('ui:sensorsToggle', (p) => { this._sensorsOpen = !!(p && p.open); }),
      /* `ui:audioMute` carries the state to move to, not a toggle, so the one
         module that owns the keyboard has to track what the mixer is doing —
         whether the player last used M, the mute button or a slider. */
      bus.on('ui:audioChanged', (p) => {
        if (!p) return;
        if (typeof p.muted === 'boolean') this._muted = p.muted;
        if (typeof p.available === 'boolean') this._audioAvailable = p.available;
        if (typeof p.master === 'number') this._audioSeen = true;
      }),
    ];

    /* Self-drive as a fallback; main.js calling update() first wins the frame. */
    this._offHook = engine.registerRenderHook((dt) => this.update(dt));

    /* The options panel lives in `ui/` and nothing else can import it —
       `main.js` and `index.html` belong to the shell lane. Pulling it in from
       here is what makes "can I change the controls?" answerable at all. It is
       a dynamic import so the boot path pays nothing for it, so the two
       modules never form a static cycle, and so a panel that fails to load
       cannot take the game with it. */
    if (typeof document !== 'undefined') {
      import('../ui/options.js')
        .then((m) => m && m.installOptions && m.installOptions())
        .catch(() => { /* the game does not depend on the panel existing */ });
    }
  }

  /* --------------------------------------------------------------- options */

  _applyOptions() {
    const g = optionsStore.gameplay;
    this._sens = clamp(g.cameraSensitivity, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max);
    this._invertY = g.invertY ? -1 : 1;
    if (!this._edgeScrollPinned) this.options.edgeScroll = g.edgeScroll;

    const h = this._holdCodes;
    h.up = optionsStore.binding('camera.panUp');
    h.down = optionsStore.binding('camera.panDown');
    h.left = optionsStore.binding('camera.panLeft');
    h.right = optionsStore.binding('camera.panRight');
    h.orbitL = optionsStore.binding('camera.orbitLeft');
    h.orbitR = optionsStore.binding('camera.orbitRight');

    this._holdSet.clear();
    for (const id of HOLD_IDS) {
      const code = optionsStore.binding(id);
      if (code) this._holdSet.add(code);
    }
    /* A key that is no longer bound must not stay stuck down: rebinding pan-left
       mid-drag would otherwise pan the camera forever. */
    for (const code of Array.from(this._keys)) {
      if (!this._holdSet.has(code) && !BOOST_KEYS.has(code)) this._keys.delete(code);
    }
  }

  /* ------------------------------------------------------------- accessors */

  get selection() {
    return this._selection.slice();
  }

  get sensorsOpen() {
    return this._sensorsOpen;
  }

  attach(world) {
    this.world = world || null;
    if (this.rig && this.rig.setWorld) this.rig.setWorld(this.world);
  }

  /* ------------------------------------------------------------- listeners */

  _bind() {
    const c = this.canvas;
    this._prevTouchAction = c.style.touchAction;
    c.style.touchAction = 'none';

    /* The view is focusable, but deliberately out of the tab order.

       Tab is the sensors manager in this genre and the HUD, the tutorial and
       the sensors view all say so — so it stays. What it must never be is a
       key that eats focus movement. Making the canvas focusable at -1 gives
       the dispatcher an honest test for "is the player in the view or in the
       UI": a pointer press puts focus here, and Tab is ours; nothing else can
       ever put focus here, so a keyboard-only player starts on the body, Tab
       walks them into the HUD, and they reach the Sensors button the same way
       they reach everything else. */
    this._prevTabIndex = c.getAttribute('tabindex');
    if (this._prevTabIndex === null) c.setAttribute('tabindex', '-1');

    this._h = {
      down: (e) => this._onPointerDown(e),
      move: (e) => this._onPointerMove(e),
      up: (e) => this._onPointerUp(e),
      cancel: (e) => this._onPointerCancel(e),
      enter: () => { this._pointerInside = true; },
      leave: () => { this._pointerInside = false; },
      wheel: (e) => this._onWheel(e),
      context: (e) => { if (e.target === c) e.preventDefault(); },
      aux: (e) => { if (e.target === c) e.preventDefault(); },
      keyDown: (e) => this._onKeyDown(e),
      keyUp: (e) => this._keys.delete(e.code),
      blur: () => this._onBlur(),
      layout: () => { this._rectCache = null; },
    };

    const h = this._h;
    c.addEventListener('pointerdown', h.down);
    c.addEventListener('pointerenter', h.enter, { passive: true });
    c.addEventListener('pointerleave', h.leave, { passive: true });
    c.addEventListener('wheel', h.wheel, { passive: false });
    c.addEventListener('contextmenu', h.context);
    c.addEventListener('auxclick', h.aux);
    window.addEventListener('pointermove', h.move, { passive: true });
    window.addEventListener('pointerup', h.up, { passive: true });
    window.addEventListener('pointercancel', h.cancel, { passive: true });
    window.addEventListener('keydown', h.keyDown);
    window.addEventListener('keyup', h.keyUp, { passive: true });
    window.addEventListener('blur', h.blur, { passive: true });
    window.addEventListener('resize', h.layout, { passive: true });
    window.addEventListener('scroll', h.layout, { passive: true, capture: true });
  }

  _rect() {
    if (!this._rectCache) this._rectCache = this.canvas.getBoundingClientRect();
    return this._rectCache;
  }

  _toNdc(clientX, clientY, out = _ndc) {
    const r = this._rect();
    out.x = ((clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
    out.y = -((clientY - r.top) / Math.max(1, r.height)) * 2 + 1;
    return out;
  }

  /* ---------------------------------------------------------------- mouse */

  _onPointerDown(e) {
    /* A drag that starts on the HUD, the exit link, or anything else layered
       over the view must never reach the 3D scene. */
    if (e.target !== this.canvas) return;
    this._rectCache = null;
    this._pointerInside = true;

    if (e.pointerType === 'touch') {
      this._touchDown(e);
      return;
    }
    if (this._mode !== 'idle') return;

    e.preventDefault();
    /* preventDefault has just cancelled the focus the browser would have given
       the view, so take it explicitly. This is what makes Tab mean "sensors"
       for a player who is actually in the view. */
    this._focusView();
    if (this.canvas.setPointerCapture) {
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    }

    this._activePointer = e.pointerId;
    this._downX = this._lastX = e.clientX;
    this._downY = this._lastY = e.clientY;
    this._downShift = e.shiftKey;
    this._downCtrl = e.ctrlKey || e.metaKey;

    if (e.button === 0) {
      this._mode = 'select';
      this._band.x0 = this._band.x1 = e.clientX;
      this._band.y0 = this._band.y1 = e.clientY;
    } else if (e.button === 1) {
      this._mode = 'orbit';
    } else if (e.button === 2) {
      const ids = this._commandIds();
      if (!ids.length || e.altKey) {
        this._mode = 'orbit';
        return;
      }
      const enemy = this._pick(e.clientX, e.clientY, { notTeam: this.team, radiusPx: PICK_PX });
      if (enemy) {
        this._mode = 'attack';
        this._attackId = enemy.id;
      } else {
        this._mode = 'gizmo';
        this._beginGizmo(e.clientX, e.clientY);
      }
    }
  }

  _onPointerMove(e) {
    if (e.pointerType === 'touch') {
      this._touchMove(e);
      return;
    }

    this._hoverX = e.clientX;
    this._hoverY = e.clientY;

    if (this._mode === 'idle' || e.pointerId !== this._activePointer) return;

    const dx = e.clientX - this._lastX;
    const dy = e.clientY - this._lastY;
    this._lastX = e.clientX;
    this._lastY = e.clientY;

    switch (this._mode) {
      case 'select':
        if (Math.abs(e.clientX - this._downX) > DRAG_PX || Math.abs(e.clientY - this._downY) > DRAG_PX) {
          this._mode = 'band';
          this._band.active = true;
          this._band.x1 = e.clientX;
          this._band.y1 = e.clientY;
        }
        break;
      case 'band':
        this._band.x1 = e.clientX;
        this._band.y1 = e.clientY;
        break;
      case 'orbit':
        this.rig.orbitBy(dx * this._sens, dy * this._sens * this._invertY);
        break;
      case 'gizmo':
        this._updateGizmo(e.clientX, e.clientY);
        break;
      default:
        break;
    }
  }

  _onPointerUp(e) {
    if (e.pointerType === 'touch') {
      this._touchUp(e);
      return;
    }
    if (e.pointerId !== this._activePointer) return;
    this._releaseCapture(e.pointerId);

    const mode = this._mode;
    this._mode = 'idle';
    this._activePointer = -1;

    if (mode === 'select') this._clickSelect(e.clientX, e.clientY, e.shiftKey, e.ctrlKey || e.metaKey, PICK_PX);
    else if (mode === 'band') this._commitBand(e.shiftKey, e.ctrlKey || e.metaKey);
    else if (mode === 'gizmo') this._commitGizmo(e.shiftKey);
    else if (mode === 'attack') this._commitAttack(e.shiftKey);

    this._band.active = false;
    this._giz.active = false;
  }

  _onPointerCancel(e) {
    this._touches.delete(e.pointerId);
    if (e.pointerId === this._activePointer || !this._touches.size) {
      this._mode = 'idle';
      this._activePointer = -1;
      this._band.active = false;
      this._giz.active = false;
    }
    this._clearLongPress();
  }

  _releaseCapture(pointerId) {
    const c = this.canvas;
    if (c.releasePointerCapture && c.hasPointerCapture && c.hasPointerCapture(pointerId)) {
      c.releasePointerCapture(pointerId);
    }
  }

  _clearLongPress() {
    if (this._longPress) clearTimeout(this._longPress);
    this._longPress = 0;
  }

  _onWheel(e) {
    if (e.target !== this.canvas) return;
    e.preventDefault();

    let px = e.deltaY;
    if (e.deltaMode === 1) px *= 16;        // lines
    else if (e.deltaMode === 2) px *= 400;  // pages
    let notches = clamp(px / 100, -4, 4);
    if (e.shiftKey) notches *= 2.4;

    this._toNdc(e.clientX, e.clientY, _ndc);
    this.rig.zoomBy(-notches, _ndc);
  }

  _onBlur() {
    this._keys.clear();
    this._mode = 'idle';
    this._activePointer = -1;
    this._touches.clear();
    this._band.active = false;
    this._giz.active = false;
    this._pointerInside = false;
    this._clearLongPress();
  }

  /* ---------------------------------------------------------------- touch */

  _touchDown(e) {
    this._rectCache = null;
    this._focusView();
    if (this.canvas.setPointerCapture) {
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    this._touches.set(e.pointerId, {
      x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(),
    });

    const n = this._touches.size;
    if (n === 1) {
      this._mode = 'touchTap';
      this._longPress = setTimeout(() => this._beginTouchGizmo(), LONG_PRESS_MS);
    } else if (n === 2) {
      this._clearLongPress();
      if (this._mode === 'gizmo') {
        /* Second finger becomes the altitude slider — the vertical half of the
           mouse gesture, split onto its own contact. */
        this._altPointer = e.pointerId;
        this._altStartY = e.clientY;
        this._altBase = this._giz.altitude;
      } else {
        this._mode = 'pinch';
        this._pinchDist = this._touchSpread();
        this._touchMidpoint(this._pinchMid);
      }
    }
  }

  _touchMove(e) {
    const t = this._touches.get(e.pointerId);
    if (!t) return;
    const px = t.x;
    const py = t.y;
    t.x = e.clientX;
    t.y = e.clientY;

    if (this._mode === 'touchTap') {
      if (Math.hypot(e.clientX - t.sx, e.clientY - t.sy) > TOUCH_DRAG_PX) {
        this._clearLongPress();
        this._mode = 'orbit';
      }
      return;
    }

    if (this._mode === 'orbit' && this._touches.size === 1) {
      this.rig.orbitBy(
        (e.clientX - px) * this._sens,
        (e.clientY - py) * this._sens * this._invertY,
      );
      return;
    }

    if (this._mode === 'pinch' && this._touches.size >= 2) {
      const d = this._touchSpread();
      if (this._pinchDist > 4 && d > 4) {
        this.rig.zoomBy(Math.log(d / this._pinchDist) / this.rig.options.zoomStep);
        this._pinchDist = d;
      }
      this._touchMidpoint(_mid);
      /* Direct manipulation: the world follows the fingers, so the focus moves
         the other way. Camera sensitivity deliberately does not apply here —
         the whole point of a two-finger drag is that the ground stays under
         the fingers, and scaling it would break that contract. */
      this.rig.panScreen(-(_mid.x - this._pinchMid.x), -(_mid.y - this._pinchMid.y));
      this._pinchMid.x = _mid.x;
      this._pinchMid.y = _mid.y;
      return;
    }

    if (this._mode === 'gizmo') {
      if (e.pointerId === this._altPointer) {
        const dist = this.rig.camera.position.distanceTo(this._giz.plane);
        this._giz.altitude = this._altBase + (this._altStartY - e.clientY) * this.rig.worldPerPixel(dist);
      } else {
        this._toNdc(e.clientX, e.clientY, _ndc);
        this.rig.screenToWorldPlane(_ndc, this._giz.planeY, this._giz.plane);
      }
    }
  }

  _touchUp(e) {
    const t = this._touches.get(e.pointerId);
    this._touches.delete(e.pointerId);
    this._releaseCapture(e.pointerId);
    this._clearLongPress();

    if (this._mode === 'touchTap' && t) {
      const moved = Math.hypot(e.clientX - t.sx, e.clientY - t.sy);
      if (moved < TOUCH_DRAG_PX) {
        this._clickSelect(e.clientX, e.clientY, e.shiftKey, false, TOUCH_PICK_PX);
      }
    }

    if (e.pointerId === this._altPointer) this._altPointer = -1;

    if (this._touches.size === 0) {
      if (this._mode === 'gizmo') this._commitGizmo(false);
      this._mode = 'idle';
      this._giz.active = false;
    } else if (this._mode === 'pinch' && this._touches.size === 1) {
      this._mode = 'orbit';
    }
  }

  _touchSpread() {
    const it = this._touches.values();
    const a = it.next().value;
    const b = it.next().value;
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _touchMidpoint(out) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    this._touches.forEach((t) => { sx += t.x; sy += t.y; n++; });
    out.x = n ? sx / n : 0;
    out.y = n ? sy / n : 0;
    return out;
  }

  _beginTouchGizmo() {
    this._longPress = 0;
    if (!this._commandIds().length) return;
    const t = this._touches.values().next().value;
    if (!t) return;
    this._mode = 'gizmo';
    this._beginGizmo(t.x, t.y);
  }

  /* ------------------------------------------------------------- keyboard */

  _onKeyDown(e) {
    if (this._isTypingTarget(e.target)) return;
    const code = e.code;
    const mod = e.ctrlKey || e.metaKey;

    /* Tab, Space and Enter belong to whichever control has focus. Claiming them
       at window level made every HUD button unreachable by keyboard: Tab could
       never move focus off a speed button or the mute glyph, and Space
       activated the pause instead of the focused button. Game bindings apply
       only when focus is on the page body or the view.

       The canvas is explicitly excluded from the control test — it carries
       `tabindex="-1"` now, which `closest('[tabindex]')` would otherwise match,
       and that would silently kill tactical pause for anyone who had clicked
       the view. */
    const onControl =
      e.target instanceof Element &&
      e.target !== document.body &&
      e.target !== this.canvas &&
      e.target.closest('button, a, [role="button"], [role="radio"], [tabindex]');
    if (onControl && (code === 'Tab' || code === 'Space' || code === 'Enter')) return;

    /* Tab is the browser's focus key before it is ours.

       The first version of this handler claimed Tab at window level and made
       the HUD unreachable. The guard above fixed that for controls and
       over-corrected: from the page body — which is where a keyboard-only
       player starts — Tab was still swallowed, so focus could never enter the
       UI layer at all. Both traps close here. Tab reaches the sensors manager
       only when the player is in the view, and Shift+Tab never does, so there
       is always a way back out with the keyboard alone. */
    if (code === 'Tab' && (e.shiftKey || document.activeElement !== this.canvas)) return;

    /* Game bindings apply only while a match is actually being played.

       With the shell's menus up — the pause screen, the title, a panel — a
       keystroke belongs to the menu. Measured before this existed: reading the
       options card and pressing S issued a fleet-wide stop, and G a guard
       order, to ships the player could not see. That is the same class of
       defect as the Tab/Space trap, arriving from the opposite direction.
       Where there is no shell there is no menu, and nothing changes. */
    if (!this._gameKeysLive()) return;

    /* One lookup, one action. Nothing below this line compares a key code to a
       verb — that is the whole point of the binding table. */
    const action = optionsStore.lookup(code, mod);
    if (action && this._runAction(action, e)) return;

    const digit = DIGIT_RE.test(code) ? Number(code.slice(5)) : -1;
    if (mod && digit < 0) return;   // leave every other browser shortcut alone

    /* Numpad 1–6 and Shift+1–6 pick a formation; the bare number row stays
       with control groups, which is the muscle memory that matters. */
    if (NUMPAD_RE.test(code)) {
      this._setFormation(Number(code.slice(6)) - 1);
      return;
    }
    if (digit >= 0) {
      if (mod) {
        e.preventDefault();
        this._assignGroup(digit);
      } else if (e.shiftKey) {
        if (digit >= 1 && digit <= 6) this._setFormation(digit - 1);
      } else {
        this._recallGroup(digit);
      }
      return;
    }

    if (BOOST_KEYS.has(code)) this._keys.add(code);
  }

  /** Run a bound action. Returns false if it declined, so the caller can carry
      on down the handler rather than swallowing the key. */
  _runAction(def, e) {
    const handled = this._dispatchAction(def, e);
    if (handled && def.prevent) e.preventDefault();
    return handled;
  }

  _dispatchAction(def, e) {
    if (def.hold) {
      this._keys.add(e.code);
      return true;
    }
    switch (def.id) {
      case 'time.pause': this._togglePause(); return true;
      case 'time.faster': this._nudgeSpeed(1); return true;
      case 'time.slower': this._nudgeSpeed(-1); return true;
      case 'ui.help': bus.emit('ui:toast', { text: 'Controls', kind: 'help' }); return true;
      case 'audio.mute': this._toggleMute(); return true;

      case 'selection.all': this._selectAllOwn(); return true;
      case 'selection.clear': this.setSelection([]); return true;

      case 'orders.attackMove': this._issueAttackMove(e.shiftKey); return true;
      case 'orders.guard': this._issueGuard(e.shiftKey); return true;
      case 'orders.patrol': this._issuePatrol(e.shiftKey); return true;
      case 'orders.stop': this._issueStop(); return true;
      case 'orders.stanceEvasive': this._setStance(STANCES[0]); return true;
      case 'orders.stanceNeutral': this._setStance(STANCES[1]); return true;
      case 'orders.stanceAggressive': this._setStance(STANCES[2]); return true;

      case 'camera.focus': this._focusSelection(); return true;
      case 'camera.zoomIn': this.rig.zoomBy(2); return true;
      case 'camera.zoomOut': this.rig.zoomBy(-2); return true;
      case 'ui.sensors': this._toggleSensors(); return true;

      default: return false;
    }
  }

  /** Put focus on the view, so Tab is unambiguously a game key from here. */
  _focusView() {
    const c = this.canvas;
    if (!c || !c.focus || document.activeElement === c) return;
    try {
      c.focus({ preventScroll: true });
    } catch (err) {
      /* An inert or detached canvas simply refuses; nothing depends on it. */
    }
  }

  _shell() {
    const vs = typeof window !== 'undefined' ? window.__VS : null;
    return (vs && vs.shell) || null;
  }

  /** True when keystrokes belong to the fleet rather than to a menu. */
  _gameKeysLive() {
    const shell = this._shell();
    if (!shell || typeof shell.state !== 'string') return true;
    return shell.state === 'playing';
  }

  _isTypingTarget(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  }

  /* -------------------------------------------------------------- intents */

  _toggleSensors() {
    this._sensorsOpen = !this._sensorsOpen;
    bus.emit('ui:sensorsToggle', { open: this._sensorsOpen });
  }

  _togglePause() {
    if (this._speedIndex === 0) {
      this._speedIndex = this._prevSpeedIndex || SPEED_STEPS.indexOf(1);
    } else {
      this._prevSpeedIndex = this._speedIndex;
      this._speedIndex = 0;
    }
    bus.emit('ui:speed', { scale: SPEED_STEPS[this._speedIndex] });
  }

  /* Mute is the one audio control that has to be reachable without opening a
     panel — it is the key a player hits when someone walks into the room, and
     going looking for it is exactly the moment they close the tab instead.

     The event carries the target state rather than a toggle, so this sends the
     opposite of whatever the mixer last announced. `ui:audioChanged` comes back
     from AudioSystem and drives every surface, so the top-bar glyph and the
     mixer button agree however the player got here. */
  _toggleMute() {
    if (!this._audioAvailable) {
      bus.emit('ui:toast', { text: 'No audio device available', kind: 'warn' });
      return;
    }
    /* Until `ui:audioChanged` has been heard, `_muted` is an assumption and a
       preference persisted from a previous session may contradict it. The
       payload-free form of the event is a toggle, so the module that owns the
       state answers rather than being told something wrong. */
    if (this._audioSeen) bus.emit('ui:audioMute', { muted: !this._muted });
    else bus.emit('ui:audioMute');
  }

  _nudgeSpeed(dir) {
    const next = clamp(this._speedIndex + dir, 0, SPEED_STEPS.length - 1);
    if (next === this._speedIndex) return;
    this._speedIndex = next;
    if (next > 0) this._prevSpeedIndex = next;
    bus.emit('ui:speed', { scale: SPEED_STEPS[next] });
  }

  _setFormation(index) {
    const f = FORMATIONS[clamp(index, 0, FORMATIONS.length - 1)];
    this.formation = f;
    const ids = this._commandIds();
    if (ids.length) bus.emit('cmd:formation', { ids, formation: f });
  }

  _setStance(stance) {
    this.stance = stance;
    const ids = this._commandIds();
    if (ids.length) bus.emit('cmd:stance', { ids, stance });
  }

  _assignGroup(n) {
    if (!this._selection.length) {
      this._groups.delete(n);
      return;
    }
    this._groups.set(n, this._selection.slice());
    bus.emit('ui:toast', { text: `Group ${n} assigned — ${this._selection.length} ships.`, kind: 'info' });
  }

  _recallGroup(n) {
    const ids = this._groups.get(n);
    if (!ids || !ids.length) return;
    const live = this.world && this.world.entities
      ? ids.filter((id) => this.world.entities.has(id))
      : ids.slice();
    this.setSelection(live);

    /* Second tap inside the double-click window frames the group — the
       standard RTS shorthand, and it saves reaching for F. */
    const now = performance.now();
    if (this._lastRecall.n === n && now - this._lastRecall.t < DOUBLE_MS + 120) this._focusSelection();
    this._lastRecall.n = n;
    this._lastRecall.t = now;
  }

  _focusSelection() {
    const ents = this._selectedEntities();
    if (ents.length) {
      this.rig.frameEntities(ents);
      return;
    }
    if (!this.world || !this.world.entities) return;
    const own = [];
    this.world.entities.forEach((e) => {
      if (e && e.team === this.team && e.alive !== false) own.push(e);
    });
    if (own.length) this.rig.frameEntities(own);
  }

  _issueMove(point, queue) {
    const ids = this._commandIds();
    if (!ids.length) return;
    const payload = { ids, point: point.clone(), queue: !!queue };
    if (this.formation) payload.formation = this.formation;
    bus.emit('cmd:move', payload);
  }

  /** World point under the cursor, on the selection's own horizontal plane.

      The combat verbs are single keypresses rather than an armed cursor that
      waits for a click: one press, one order, at the place you are already
      looking. It is the faster half of the RTS idiom and it keeps the verb
      honest on the bus — pressing A does something, immediately. Altitude is
      the right-drag gizmo's job, and a plain move still gets you there. */
  _cursorPoint(out) {
    const r = this._rect();
    const x = this._hoverX >= 0 ? this._hoverX : r.left + r.width * 0.5;
    const y = this._hoverY >= 0 ? this._hoverY : r.top + r.height * 0.5;
    const anchor = this._selectionCentroid(_v3) || this.rig.focusPoint;
    const planeY = anchor.y;
    this._toNdc(x, y, _ndc);
    return this.rig.screenToWorldPlane(_ndc, planeY, out);
  }

  /** Emit a point-targeted order for the current selection. */
  _issuePointOrder(type, queue, extra) {
    const ids = this._commandIds();
    if (!ids.length) return false;
    const payload = { ids, point: this._cursorPoint(_v2).clone(), queue: !!queue };
    if (this.formation) payload.formation = this.formation;
    if (extra) Object.assign(payload, extra);
    bus.emit(type, payload);
    return true;
  }

  /* Move to the point, but fight anything met on the way — the helm goes to
     combat while a target is live and comes straight back afterwards. */
  _issueAttackMove(queue) {
    this._issuePointOrder('cmd:attackMove', queue);
  }

  /* Patrol. The sim builds the circuit from where the ships are now. */
  _issuePatrol(queue) {
    this._issuePointOrder('cmd:patrol', queue);
  }

  /* Guard a friendly hull if the cursor is over one, otherwise guard the
     ground — holding a seam is as common an order as escorting a carrier. */
  _issueGuard(queue) {
    const ids = this._commandIds();
    if (!ids.length) return;
    const friend = this._hoverX >= 0
      ? this._pick(this._hoverX, this._hoverY, { team: this.team, radiusPx: PICK_PX })
      : null;
    if (friend && !this._selSet.has(friend.id)) {
      bus.emit('cmd:guard', { ids, targetId: friend.id, queue: !!queue });
      return;
    }
    this._issuePointOrder('cmd:guard', queue);
  }

  _issueStop() {
    const ids = this._commandIds();
    if (!ids.length) return;
    bus.emit('cmd:stop', { ids });
  }

  _commitAttack(queue) {
    const ids = this._commandIds();
    if (!ids.length || this._attackId < 0) return;
    bus.emit('cmd:attack', { ids, targetId: this._attackId, queue: !!queue });
    this._attackId = -1;
  }

  /* ------------------------------------------------------------ selection */

  setSelection(ids, emit = true) {
    const next = Array.from(new Set(ids || []));
    const same = next.length === this._selection.length
      && next.every((id) => this._selSet.has(id));
    this._selection = next;
    this._selSet = new Set(next);
    if (same || !emit) return;
    this._emitting = true;
    bus.emit('sel:changed', { ids: next.slice() });
    this._emitting = false;
  }

  _applySelection(ids, shift, ctrl) {
    if (ctrl) {
      const set = new Set(this._selection);
      for (const id of ids) {
        if (set.has(id)) set.delete(id);
        else set.add(id);
      }
      this.setSelection(Array.from(set));
    } else if (shift) {
      this.setSelection(this._selection.concat(ids));
    } else {
      this.setSelection(ids);
    }
  }

  _selectAllOwn() {
    if (!this.world || !this.world.entities) return;
    const ids = [];
    this.world.entities.forEach((e) => {
      if (e && e.team === this.team && e.alive !== false) ids.push(e.id);
    });
    this.setSelection(ids);
  }

  _clickSelect(clientX, clientY, shift, ctrl, pickPx) {
    const ent = this._pick(clientX, clientY, { radiusPx: pickPx, preferTeam: this.team });
    const now = performance.now();
    const isDouble = !!ent
      && now - this._lastClick.t < DOUBLE_MS
      && Math.hypot(clientX - this._lastClick.x, clientY - this._lastClick.y) < 8
      && this._lastClick.classId === ent.classId;

    this._lastClick.t = now;
    this._lastClick.x = clientX;
    this._lastClick.y = clientY;
    this._lastClick.classId = ent ? ent.classId : null;

    if (isDouble) {
      this._applySelection(this._sameClassOnScreen(ent), shift, false);
      return;
    }
    if (!ent) {
      if (!shift && !ctrl) this.setSelection([]);
      return;
    }
    this._applySelection([ent.id], shift, ctrl);
  }

  _commitBand(shift, ctrl) {
    const r = this._bandRect();
    if (r.width < DRAG_PX && r.height < DRAG_PX) {
      this._clickSelect(this._band.x1, this._band.y1, shift, ctrl, PICK_PX);
      return;
    }
    this._applySelection(this._bandIds(r), shift, ctrl);
  }

  _bandRect() {
    const rect = this._rect();
    const b = this._band;
    const minX = Math.min(b.x0, b.x1) - rect.left;
    const maxX = Math.max(b.x0, b.x1) - rect.left;
    const minY = Math.min(b.y0, b.y1) - rect.top;
    const maxY = Math.max(b.y0, b.y1) - rect.top;
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    return {
      x: minX, y: minY, width: maxX - minX, height: maxY - minY,
      left: minX, top: minY, right: maxX, bottom: maxY,
      minX, minY, maxX, maxY,
      ndc: {
        minX: (minX / w) * 2 - 1,
        maxX: (maxX / w) * 2 - 1,
        minY: -((maxY / h) * 2 - 1),
        maxY: -((minY / h) * 2 - 1),
      },
    };
  }

  _bandIds(rect) {
    const world = this.world;
    if (world && typeof world.selectionAt === 'function') {
      try {
        /* Hand the sim an unambiguous NDC rect. A CSS-pixel rect carrying its
           own `width` invites a viewport-size heuristic to divide by the
           marquee's width instead of the canvas's, which silently returns an
           empty selection. `space` pins it beyond doubt. */
        const n = rect.ndc;
        const ids = world.selectionAt({
          space: 'ndc',
          x0: n.minX, y0: n.minY, x1: n.maxX, y1: n.maxY,
          left: n.minX, top: n.maxY, right: n.maxX, bottom: n.minY,
        }, this.rig.camera, this.team);
        /* An empty answer is indistinguishable from a broken one, and band
           select failing silently is unacceptable — verify it ourselves. */
        if (Array.isArray(ids) && ids.length) return ids;
      } catch (err) {
        /* Fall through to the local implementation. */
      }
    }
    return this._bandIdsLocal(rect);
  }

  /** Projection-based band select, used when the sim does not provide one. */
  _bandIdsLocal(rect) {
    const out = [];
    if (!this.world || !this.world.entities) return out;
    const cam = this.rig.camera;
    cam.getWorldDirection(_fwd);
    const n = rect.ndc;
    this.world.entities.forEach((e) => {
      if (!e || e.alive === false || e.team !== this.team) return;
      const p = entityPosition(e);
      if (!p) return;
      if (_v1.copy(p).sub(cam.position).dot(_fwd) <= 0) return;
      _v2.copy(p).project(cam);
      if (_v2.x < n.minX || _v2.x > n.maxX || _v2.y < n.minY || _v2.y > n.maxY) return;
      out.push(e.id);
    });
    return out;
  }

  _sameClassOnScreen(ent) {
    const out = [ent.id];
    if (!this.world || !this.world.entities) return out;
    const cam = this.rig.camera;
    cam.getWorldDirection(_fwd);
    this.world.entities.forEach((e) => {
      if (!e || e === ent || e.alive === false) return;
      if (e.classId !== ent.classId || e.team !== ent.team) return;
      const p = entityPosition(e);
      if (!p) return;
      if (_v1.copy(p).sub(cam.position).dot(_fwd) <= 0) return;
      _v2.copy(p).project(cam);
      if (_v2.x < -1 || _v2.x > 1 || _v2.y < -1 || _v2.y > 1) return;
      out.push(e.id);
    });
    return out;
  }

  /** Nearest entity to the cursor within a generous pixel radius. A 14 m
      interceptor at 5 km is under two pixels across; requiring a mesh hit
      would make fighters effectively unselectable. */
  _pick(clientX, clientY, opts) {
    const world = this.world;
    if (!world || !world.entities) return null;
    const cam = this.rig.camera;
    const rect = this._rect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const halfW = Math.max(1, rect.width) * 0.5;
    const halfH = Math.max(1, rect.height) * 0.5;
    const tol = opts.radiusPx || PICK_PX;
    cam.getWorldDirection(_fwd);

    let best = null;
    let bestScore = Infinity;
    world.entities.forEach((e) => {
      if (!e || e.alive === false) return;
      if (opts.team !== undefined && e.team !== opts.team) return;
      if (opts.notTeam !== undefined && e.team === opts.notTeam) return;
      const p = entityPosition(e);
      if (!p) return;
      const depth = _v1.copy(p).sub(cam.position).dot(_fwd);
      if (depth <= 0) return;
      _v2.copy(p).project(cam);
      const sx = (_v2.x + 1) * halfW;
      const sy = (1 - _v2.y) * halfH;
      const d = Math.hypot(sx - px, sy - py);
      const rPx = (e.radius || 10) / Math.max(1e-6, this.rig.worldPerPixel(depth));
      if (d > Math.max(tol, Math.min(rPx, 500))) return;
      /* Nearest to the cursor wins, ties break toward the nearer ship, and a
         friendly outranks an enemy sharing the same pixel. */
      let score = d + depth * 1e-7;
      if (opts.preferTeam !== undefined && e.team !== opts.preferTeam) score += tol * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    });

    if (!best && world.raycastEntities) {
      try {
        this._toNdc(clientX, clientY, _ndc);
        const hit = world.raycastEntities(this.rig.rayFromNdc(_ndc), opts.team);
        if (hit) best = hit;
      } catch (err) {
        /* Optional API. */
      }
    }
    return best;
  }

  _selectedEntities() {
    const out = [];
    if (!this.world || !this.world.entities) return out;
    for (const id of this._selection) {
      const e = this.world.entities.get(id);
      if (e && e.alive !== false) out.push(e);
    }
    return out;
  }

  _commandIds() {
    if (!this.world || !this.world.entities) return this._selection.slice();
    const out = [];
    for (const id of this._selection) {
      const e = this.world.entities.get(id);
      if (e && e.alive !== false && e.team === this.team) out.push(id);
    }
    return out;
  }

  _selectionCentroid(out = new THREE.Vector3()) {
    const ents = this._selectedEntities();
    if (!ents.length) return null;
    out.set(0, 0, 0);
    let n = 0;
    for (const e of ents) {
      const p = entityPosition(e);
      if (!p) continue;
      out.add(p);
      n++;
    }
    if (!n) return null;
    return out.divideScalar(n);
  }

  /* ----------------------------------------------------------- move gizmo */

  _beginGizmo(clientX, clientY) {
    const g = this._giz;
    const centroid = this._selectionCentroid(_v3);
    const anchor = centroid || this.rig.focusPoint;
    g.from.copy(anchor);
    g.planeY = anchor.y;

    /* Disc size = the footprint the formation will actually occupy. */
    const ents = this._selectedEntities();
    let radius = 30;
    for (const e of ents) {
      const p = entityPosition(e);
      if (!p) continue;
      radius = Math.max(radius, _v1.copy(p).sub(anchor).length() * 0.9, (e.radius || 0) * 2.2);
    }
    g.radius = radius;

    g.anchorX = clientX;
    g.anchorY = clientY;
    g.altitude = 0;
    this._toNdc(clientX, clientY, _ndc);
    this.rig.screenToWorldPlane(_ndc, g.planeY, g.plane);
    g.active = true;
  }

  _updateGizmo(clientX, clientY) {
    const g = this._giz;
    /* Horizontal cursor travel slides the disc across the reference plane;
       vertical travel raises the destination off it. Unprojecting at the
       anchor's screen row is what keeps those two axes independent — the same
       trick Homeworld used, and it puts the stalk tip under the cursor. */
    this._toNdc(clientX, g.anchorY, _ndc);
    this.rig.screenToWorldPlane(_ndc, g.planeY, g.plane);
    const dist = this.rig.camera.position.distanceTo(g.plane);
    g.altitude = (g.anchorY - clientY) * this.rig.worldPerPixel(dist);
  }

  _commitGizmo(queue) {
    const g = this._giz;
    _v1.copy(g.plane);
    _v1.y += g.altitude;
    this._issueMove(_v1, queue);
    g.active = false;
  }

  /* -------------------------------------------------------------- overlay */

  _buildOverlay() {
    this._colour = new THREE.Color(this.options.colour);

    this._material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    /* Additive light can only ever brighten, so a hairline crossing a sunlit
       asteroid adds a few percent and vanishes. Laying the identical geometry
       down first in near-black normal blending punches the background out to a
       known dark value, and the additive pass then reads as cyan against
       anything. Same buffers, same draw range — it costs one extra call. */
    this._materialDark = new THREE.LineBasicMaterial({
      color: 0x03060c,
      transparent: true,
      opacity: 0.88,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this._gizGeo = makeLineBuffer(GIZMO_VERTS);
    this._bandGeo = makeLineBuffer(BAND_VERTS);

    this._gizMesh = new THREE.LineSegments(this._gizGeo, this._material);
    this._bandMesh = new THREE.LineSegments(this._bandGeo, this._material);
    this._gizBack = new THREE.LineSegments(this._gizGeo, this._materialDark);
    this._bandBack = new THREE.LineSegments(this._bandGeo, this._materialDark);

    this._overlays = [this._gizBack, this._bandBack, this._gizMesh, this._bandMesh];
    for (const m of this._overlays) {
      m.frustumCulled = false;
      m.renderOrder = m.material === this._materialDark ? 9989 : 9990;
      m.layers.set(LAYER.HUD3D);
      m.visible = false;
      this.engine.scene.add(m);
    }
  }

  /** Append a segment. `b` is 0..1 brightness — the whole overlay is one draw
      call, so weight comes from vertex colour rather than extra materials. */
  _seg(geo, cursor, ax, ay, az, bx, by, bz, b) {
    const i = cursor.i;
    if (i + 2 > cursor.max) return;
    const p = geo.attributes.position.array;
    const c = geo.attributes.color.array;
    const o = i * 3;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az;
    p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz;
    const col = this._colour;
    for (let k = 0; k < 2; k++) {
      c[o + k * 3] = col.r * b;
      c[o + k * 3 + 1] = col.g * b;
      c[o + k * 3 + 2] = col.b * b;
    }
    cursor.i = i + 2;
  }

  _finish(geo, mesh, cursor, backing) {
    geo.setDrawRange(0, cursor.i);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    mesh.visible = cursor.i > 0;
    if (backing) backing.visible = mesh.visible;
  }

  /** NDC to a world point at a fixed camera-space depth — how the marquee
      stays pixel-exact without a second render pass. */
  _ndcAtDepth(nx, ny, depth, out) {
    const cam = this.rig.camera;
    out.set(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
    const denom = out.dot(_fwd);
    out.multiplyScalar(depth / (Math.abs(denom) < 1e-6 ? 1e-6 : denom)).add(cam.position);
    return out;
  }

  _refreshBand() {
    const geo = this._bandGeo;
    const cursor = { i: 0, max: BAND_VERTS };
    if (!this._band.active) {
      this._finish(geo, this._bandMesh, cursor, this._bandBack);
      return;
    }

    const rect = this._rect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const x0 = Math.min(this._band.x0, this._band.x1) - rect.left;
    const x1 = Math.max(this._band.x0, this._band.x1) - rect.left;
    const y0 = Math.min(this._band.y0, this._band.y1) - rect.top;
    const y1 = Math.max(this._band.y0, this._band.y1) - rect.top;

    this.rig.camera.getWorldDirection(_fwd);
    const depth = Math.max(this.rig.camera.near * 2.5, 1e-4);
    const at = (x, y, out) => this._ndcAtDepth((x / w) * 2 - 1, -((y / h) * 2 - 1), depth, out);

    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (let i = 0; i < 4; i++) {
      at(corners[i][0], corners[i][1], _ptA);
      at(corners[(i + 1) % 4][0], corners[(i + 1) % 4][1], _ptB);
      this._seg(geo, cursor, _ptA.x, _ptA.y, _ptA.z, _ptB.x, _ptB.y, _ptB.z, 0.38);
    }

    /* Corner brackets: it reads as an instrument rather than a drag box. */
    const arm = Math.min(15, Math.max(4, Math.min(x1 - x0, y1 - y0) * 0.28));
    const brackets = [
      [x0, y0, arm, 0], [x0, y0, 0, arm],
      [x1, y0, -arm, 0], [x1, y0, 0, arm],
      [x1, y1, -arm, 0], [x1, y1, 0, -arm],
      [x0, y1, arm, 0], [x0, y1, 0, -arm],
    ];
    for (let i = 0; i < brackets.length; i++) {
      const br = brackets[i];
      at(br[0], br[1], _ptA);
      at(br[0] + br[2], br[1] + br[3], _ptB);
      this._seg(geo, cursor, _ptA.x, _ptA.y, _ptA.z, _ptB.x, _ptB.y, _ptB.z, 1);
    }

    this._finish(geo, this._bandMesh, cursor, this._bandBack);
  }

  _refreshGizmo() {
    const geo = this._gizGeo;
    const cursor = { i: 0, max: GIZMO_VERTS };
    const g = this._giz;
    if (!g.active) {
      this._finish(geo, this._gizMesh, cursor, this._gizBack);
      return;
    }

    const cam = this.rig.camera;
    const centre = g.plane;
    const camDist = Math.max(1e-3, cam.position.distanceTo(centre));
    const wpp = this.rig.worldPerPixel(camDist);

    /* Everything below is authored in pixels and multiplied up, so the gizmo
       stays the same size on screen whether the fleet is 40 m or 40 km away.
       The disc tracks the formation footprint but is clamped at both ends: a
       lone interceptor still gets a readable target, a fleet spread over two
       kilometres does not get a disc that fills the screen. */
    const R = clamp(g.radius, 26 * wpp, 150 * wpp);
    const tick = 6 * wpp;

    /* Destination disc. */
    const SEGS = 72;
    let px0 = centre.x + R;
    let pz0 = centre.z;
    for (let i = 1; i <= SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      const x = centre.x + Math.cos(a) * R;
      const z = centre.z + Math.sin(a) * R;
      this._seg(geo, cursor, px0, centre.y, pz0, x, centre.y, z, 0.9);
      px0 = x;
      pz0 = z;
    }

    /* Rim graduations. */
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const inner = R - (i % 4 === 0 ? tick * 1.9 : tick);
      this._seg(
        geo, cursor,
        centre.x + ca * R, centre.y, centre.z + sa * R,
        centre.x + ca * inner, centre.y, centre.z + sa * inner,
        i % 4 === 0 ? 0.8 : 0.42,
      );
    }

    /* Centre mark. */
    this._seg(geo, cursor, centre.x - tick, centre.y, centre.z, centre.x + tick, centre.y, centre.z, 0.7);
    this._seg(geo, cursor, centre.x, centre.y, centre.z - tick, centre.x, centre.y, centre.z + tick, 0.7);

    /* Heading: a dashed run from where the fleet is to where it is going, with
       a chevron where it arrives. */
    _v1.copy(centre).sub(g.from);
    _v1.y = 0;
    const runLen = _v1.length();
    if (runLen > R * 0.6) {
      _v1.divideScalar(runLen);
      const dashes = 20;
      const seg = runLen / (dashes * 2 - 1);
      for (let i = 0; i < dashes; i++) {
        const t0 = i * seg * 2;
        const t1 = Math.min(runLen - R, t0 + seg);
        if (t1 <= t0) break;
        this._seg(
          geo, cursor,
          g.from.x + _v1.x * t0, g.planeY, g.from.z + _v1.z * t0,
          g.from.x + _v1.x * t1, g.planeY, g.from.z + _v1.z * t1,
          0.3,
        );
      }
      const head = 11 * wpp;
      const nx = -_v1.z;
      const nz = _v1.x;
      const bx = centre.x - _v1.x * R;
      const bz = centre.z - _v1.z * R;
      this._seg(
        geo, cursor, bx, centre.y, bz,
        bx - _v1.x * head + nx * head * 0.6, centre.y, bz - _v1.z * head + nz * head * 0.6, 0.85,
      );
      this._seg(
        geo, cursor, bx, centre.y, bz,
        bx - _v1.x * head - nx * head * 0.6, centre.y, bz - _v1.z * head - nz * head * 0.6, 0.85,
      );
    }

    /* Vertical stalk. */
    const alt = g.altitude;
    if (Math.abs(alt) > wpp * 2.5) {
      _tip.set(centre.x, centre.y + alt, centre.z);
      this._seg(geo, cursor, centre.x, centre.y, centre.z, _tip.x, _tip.y, _tip.z, 1);

      /* Bars face the camera so they never foreshorten to nothing. */
      _v2.copy(_tip).sub(cam.position).normalize();
      _right.crossVectors(_up, _v2);
      if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
      _right.normalize();

      const step = niceStep(Math.abs(alt), 10, wpp * 13);
      const sign = alt < 0 ? -1 : 1;
      const count = Math.min(40, Math.floor(Math.abs(alt) / step));
      for (let i = 1; i <= count; i++) {
        const y = centre.y + sign * step * i;
        const major = i % 5 === 0;
        const len = (major ? 10 : 5.5) * wpp;
        this._seg(
          geo, cursor,
          centre.x - _right.x * len, y, centre.z - _right.z * len,
          centre.x + _right.x * len, y, centre.z + _right.z * len,
          major ? 0.8 : 0.5,
        );
      }

      /* Destination marker: a small diamond in the view plane. */
      _v3.crossVectors(_v2, _right).normalize();
      const m = 7 * wpp;
      const pts = [
        [_right.x * m, _right.y * m, _right.z * m],
        [_v3.x * m, _v3.y * m, _v3.z * m],
        [-_right.x * m, -_right.y * m, -_right.z * m],
        [-_v3.x * m, -_v3.y * m, -_v3.z * m],
      ];
      for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        this._seg(
          geo, cursor,
          _tip.x + a[0], _tip.y + a[1], _tip.z + a[2],
          _tip.x + b[0], _tip.y + b[1], _tip.z + b[2],
          1,
        );
      }
    }

    this._finish(geo, this._gizMesh, cursor, this._gizBack);
  }

  /* --------------------------------------------------------------- update */

  update(dt) {
    const now = performance.now();
    if (now - this._lastUpdateMs < 2) return;
    this._lastUpdateMs = now;
    const step = clamp(dt || 0, 0, 0.1);

    /* A key held when the menu opened must not keep panning the camera behind
       it — the key-up will arrive on the menu, and until it does the held set
       is stale. */
    if (this._gameKeysLive()) {
      this._applyKeyPan(step);
      this._applyEdgeScroll(step);
    } else if (this._keys.size) {
      this._keys.clear();
    }
    this._refreshBand();
    this._refreshGizmo();
  }

  _applyKeyPan(dt) {
    if (!this._keys.size || dt <= 0) return;
    const k = this._keys;
    const h = this._holdCodes;
    let x = 0;
    let y = 0;
    if (h.left && k.has(h.left)) x -= 1;
    if (h.right && k.has(h.right)) x += 1;
    if (h.up && k.has(h.up)) y -= 1;
    if (h.down && k.has(h.down)) y += 1;

    if (x || y) {
      const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? this.options.boostMultiplier : 1;
      const s = this.options.panPixelsPerSecond * dt * boost * this._sens * (x && y ? Math.SQRT1_2 : 1);
      this.rig.panScreen(x * s, y * s);
    }

    let spin = 0;
    if (h.orbitL && k.has(h.orbitL)) spin -= 1;
    if (h.orbitR && k.has(h.orbitR)) spin += 1;
    if (spin) this.rig.orbitBy(spin * this.options.keyOrbitPixelsPerSecond * dt * this._sens, 0);
  }

  _applyEdgeScroll(dt) {
    if (!this.options.edgeScroll || dt <= 0) return;
    if (this._mode !== 'idle' || !this._pointerInside) return;
    if (this._hoverX < 0) return;
    if (typeof document !== 'undefined' && document.hasFocus && !document.hasFocus()) return;

    const r = this._rect();
    const m = this.options.edgeMargin;
    const px = this._hoverX - r.left;
    const py = this._hoverY - r.top;
    if (px < -m || py < -m || px > r.width + m || py > r.height + m) return;

    let x = 0;
    let y = 0;
    if (px < m) x = -(1 - Math.max(0, px) / m);
    else if (px > r.width - m) x = 1 - Math.max(0, r.width - px) / m;
    if (py < m) y = -(1 - Math.max(0, py) / m);
    else if (py > r.height - m) y = 1 - Math.max(0, r.height - py) / m;

    if (!x && !y) return;
    const s = this.options.panPixelsPerSecond * 0.85 * dt * this._sens;
    this.rig.panScreen(x * s, y * s);
  }

  /* ------------------------------------------------------------- teardown */

  dispose() {
    const c = this.canvas;
    const h = this._h;
    c.removeEventListener('pointerdown', h.down);
    c.removeEventListener('pointerenter', h.enter);
    c.removeEventListener('pointerleave', h.leave);
    c.removeEventListener('wheel', h.wheel);
    c.removeEventListener('contextmenu', h.context);
    c.removeEventListener('auxclick', h.aux);
    window.removeEventListener('pointermove', h.move);
    window.removeEventListener('pointerup', h.up);
    window.removeEventListener('pointercancel', h.cancel);
    window.removeEventListener('keydown', h.keyDown);
    window.removeEventListener('keyup', h.keyUp);
    window.removeEventListener('blur', h.blur);
    window.removeEventListener('resize', h.layout);
    window.removeEventListener('scroll', h.layout, { capture: true });
    c.style.touchAction = this._prevTouchAction || '';
    if (this._prevTabIndex === null) c.removeAttribute('tabindex');
    else if (this._prevTabIndex !== undefined) c.setAttribute('tabindex', this._prevTabIndex);

    this._clearLongPress();
    for (const off of this._offs) off();
    this._offs.length = 0;
    if (this._offHook) this._offHook();
    this._offHook = null;
    if (this._offOptions) this._offOptions();
    this._offOptions = null;

    for (const m of this._overlays) {
      if (m && m.parent) m.parent.remove(m);
    }
    this._overlays.length = 0;
    this._gizGeo.dispose();
    this._bandGeo.dispose();
    this._material.dispose();
    this._materialDark.dispose();

    this._keys.clear();
    this._touches.clear();
    this._groups.clear();
  }
}

export default InputController;
