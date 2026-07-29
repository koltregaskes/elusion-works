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

export const FORMATIONS = ['delta', 'broad', 'claw', 'x', 'wall', 'sphere'];
export const STANCES = ['evasive', 'neutral', 'aggressive'];
export const SPEED_STEPS = [0, 0.25, 0.5, 1, 2, 4];

/** The full control scheme, as data, so ui/hud.js can render the help panel
    from the same source of truth the handlers are written against.

    Time comes first on purpose. Tactical pause is the single most valuable
    thing a new commander can be told about — you can pause the battle and
    still issue every order — and it is invisible unless something says so. */
export const CONTROL_SCHEME = [
  {
    group: 'Time',
    rows: [
      ['Space', 'Pause the battle — you can still select and give orders'],
      ['+ / −', 'Game speed: ¼, ½, ×1, ×2, ×4'],
      ['H', 'This panel'],
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
      ['Ctrl + A', 'Select your whole fleet'],
      ['Esc', 'Clear selection'],
    ],
  },
  {
    group: 'Orders',
    rows: [
      ['Right click', 'Move to the point under the cursor'],
      ['Right drag up / down', 'Set the move altitude (disc + stalk gizmo)'],
      ['Right click on enemy', 'Attack'],
      ['Shift + right click', 'Queue the order'],
      ['1 – 6 (Shift or numpad)', 'Formation: delta, broad, claw, X, wall, sphere'],
      ['Z / X / C', 'Stance: evasive, neutral, aggressive'],
    ],
  },
  {
    group: 'Camera',
    rows: [
      ['Right drag (nothing selected)', 'Orbit'],
      ['Middle drag', 'Orbit'],
      ['Alt + right drag', 'Orbit, even with a selection'],
      ['Wheel', 'Zoom (exponential; Shift for coarse)'],
      ['Page Up / Page Down', 'Zoom without the wheel'],
      ['W A S D / arrows', 'Pan across the focus plane'],
      ['Q / E', 'Swing the camera left / right'],
      ['Screen edge', 'Edge-scroll'],
      ['F', 'Focus and follow the selection'],
      ['Tab', 'Sensors manager'],
    ],
  },
  {
    group: 'Control groups',
    rows: [
      ['Ctrl + 0 – 9', 'Assign control group'],
      ['0 – 9', 'Recall group (press twice to focus it)'],
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

/* ------------------------------------------------------------------ helpers */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

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

const PAN_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight',
]);

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
    ];

    /* Self-drive as a fallback; main.js calling update() first wins the frame. */
    this._offHook = engine.registerRenderHook((dt) => this.update(dt));
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
        this.rig.orbitBy(dx, dy);
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
      this.rig.orbitBy(e.clientX - px, e.clientY - py);
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
         the other way. */
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

    if (code === 'Tab') {
      e.preventDefault();
      this._toggleSensors();
      return;
    }
    if (code === 'Escape') {
      this.setSelection([]);
      return;
    }
    if (code === 'Space') {
      e.preventDefault();
      this._togglePause();
      return;
    }
    if (code === 'KeyA' && mod) {
      e.preventDefault();
      this._selectAllOwn();
      return;
    }

    const digit = DIGIT_RE.test(code) ? Number(code.slice(5)) : -1;
    if (mod && digit < 0) return;   // leave every other browser shortcut alone

    switch (code) {
      case 'KeyF': this._focusSelection(); return;
      case 'KeyH': bus.emit('ui:toast', { text: 'Controls', kind: 'help' }); return;
      case 'KeyZ': this._setStance(STANCES[0]); return;
      case 'KeyX': this._setStance(STANCES[1]); return;
      case 'KeyC': this._setStance(STANCES[2]); return;
      case 'Equal': case 'NumpadAdd': this._nudgeSpeed(1); return;
      case 'Minus': case 'NumpadSubtract': this._nudgeSpeed(-1); return;
      case 'PageUp': e.preventDefault(); this.rig.zoomBy(2); return;
      case 'PageDown': e.preventDefault(); this.rig.zoomBy(-2); return;
      default: break;
    }

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

    if (PAN_KEYS.has(code) || code === 'KeyQ' || code === 'KeyE') {
      if (code.startsWith('Arrow')) e.preventDefault();
      this._keys.add(code);
    }
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

    this._applyKeyPan(step);
    this._applyEdgeScroll(step);
    this._refreshBand();
    this._refreshGizmo();
  }

  _applyKeyPan(dt) {
    if (!this._keys.size || dt <= 0) return;
    const k = this._keys;
    let x = 0;
    let y = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;

    if (x || y) {
      const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? this.options.boostMultiplier : 1;
      const s = this.options.panPixelsPerSecond * dt * boost * (x && y ? Math.SQRT1_2 : 1);
      this.rig.panScreen(x * s, y * s);
    }

    let spin = 0;
    if (k.has('KeyQ')) spin -= 1;
    if (k.has('KeyE')) spin += 1;
    if (spin) this.rig.orbitBy(spin * this.options.keyOrbitPixelsPerSecond * dt, 0);
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
    const s = this.options.panPixelsPerSecond * 0.85 * dt;
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

    this._clearLongPress();
    for (const off of this._offs) off();
    this._offs.length = 0;
    if (this._offHook) this._offHook();
    this._offHook = null;

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
