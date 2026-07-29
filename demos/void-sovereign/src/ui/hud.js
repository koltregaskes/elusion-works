import * as THREE from '../../vendor/three/build/three.module.js';
import { bus } from '../core/events.js';
import { SHIPS, totalFleetValue } from '../ships/catalog.js';
import { SelectionRoster, WorldMarkers } from './select.js';
import { BuildMenu } from './build.js';
import { SensorsView } from './sensors.js';

/* VOID SOVEREIGN — HUD facade.

   Builds its own DOM into the container it is handed, wires every surface to
   the event bus, and drives one update pass per frame. It never mutates the
   world: it emits `cmd:*` and `ui:*` and reacts to `sim:*` and `sel:changed`.

   Layout, corner by corner:
     top-left      credits, income
     top-right     population, fleet value, hulls, time scale
     bottom-left   toast stack, then the grouped selection roster
     bottom-centre stance / formation / utility palette
     bottom-right  production menu and queue
     over the void selection brackets, health pips, target reticles, orders
   The bottom deck stops short of the page shell's "← Demos" link. */

const FORMATIONS = [
  { id: 'delta', label: 'Delta', key: '1' },
  { id: 'broad', label: 'Broad', key: '2' },
  { id: 'wall', label: 'Wall', key: '3' },
  { id: 'sphere', label: 'Sphere', key: '4' },
  { id: 'claw', label: 'Claw', key: '5' },
  { id: 'line', label: 'Line', key: '6' },
];

const STANCES = [
  { id: 'evasive', label: 'Evasive', key: 'Z' },
  { id: 'neutral', label: 'Neutral', key: 'X' },
  { id: 'aggressive', label: 'Aggressive', key: 'C' },
];

const SPEEDS = [0.5, 1, 2, 4];
const MAX_TOASTS = 5;
const TOAST_LIFE = 4.6;

const HELP = [
  ['Fleet', [
    ['LMB', 'Select a ship'],
    ['LMB drag', 'Band-select'],
    ['Shift + LMB', 'Add to selection'],
    ['RMB', 'Move order'],
    ['RMB drag ↕', 'Set destination altitude'],
    ['RMB on hostile', 'Attack'],
    ['Shift + order', 'Queue the order'],
  ]],
  ['Command', [
    ['1 – 6', 'Formation'],
    ['Z / X / C', 'Evasive · Neutral · Aggressive'],
    ['Ctrl + 1 – 9', 'Assign control group'],
    ['Alt + 1 – 9', 'Recall control group'],
    ['F', 'Focus the selection'],
  ]],
  ['View', [
    ['Tab', 'Sensors Manager'],
    ['+ / −', 'Time scale'],
    ['P', 'Pause'],
    ['H', 'This card'],
    ['Esc', 'Back out'],
  ]],
];

/* -------------------------------------------------------------- projection */

/* World → screen, without touching Three's per-object machinery. The
   view-projection is multiplied once per frame and every entity is then a
   handful of multiplies. Results land on the instance rather than in a new
   object, because this runs several hundred times a frame. */
class Projector {
  constructor() {
    this.m = new Float64Array(16);
    this._view = new THREE.Matrix4();
    this.w = 1;
    this.h = 1;
    this.hw = 0.5;
    this.hh = 0.5;
    this.scaleK = 1;
    this.sx = 0;
    this.sy = 0;
    this.cw = 1;
  }

  update(cam, w, h) {
    cam.updateMatrixWorld();
    this._view.copy(cam.matrixWorld).invert();
    const p = cam.projectionMatrix.elements;
    const v = this._view.elements;
    const m = this.m;
    for (let c = 0; c < 4; c++) {
      const b0 = v[c * 4];
      const b1 = v[c * 4 + 1];
      const b2 = v[c * 4 + 2];
      const b3 = v[c * 4 + 3];
      m[c * 4] = p[0] * b0 + p[4] * b1 + p[8] * b2 + p[12] * b3;
      m[c * 4 + 1] = p[1] * b0 + p[5] * b1 + p[9] * b2 + p[13] * b3;
      m[c * 4 + 2] = p[2] * b0 + p[6] * b1 + p[10] * b2 + p[14] * b3;
      m[c * 4 + 3] = p[3] * b0 + p[7] * b1 + p[11] * b2 + p[15] * b3;
    }
    this.w = w;
    this.h = h;
    this.hw = w * 0.5;
    this.hh = h * 0.5;
    // Pixels per world unit at unit depth — turns a hull radius into a bracket.
    this.scaleK = p[5] * 0.5 * h;
  }

  /** Writes sx/sy/cw. Returns false for anything at or behind the eye. */
  project(x, y, z) {
    const m = this.m;
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 1e-6) return false;
    const inv = 1 / cw;
    this.cw = cw;
    this.sx = (m[0] * x + m[4] * y + m[8] * z + m[12]) * inv * this.hw + this.hw;
    this.sy = this.hh - (m[1] * x + m[5] * y + m[9] * z + m[13]) * inv * this.hh;
    return true;
  }
}

/* ------------------------------------------------------------------- helpers */

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

const EMPTY = [];

/* ============================================================================ */

export class HUD {
  constructor({ engine, world, camera, container, team = 0, intro = 'auto' } = {}) {
    this.engine = engine || null;
    this.world = world || null;
    this.team = team;

    // `camera` may be the CameraRig or a bare Three camera; the engine's own
    // camera wins because that is what actually renders the frame.
    this.rig = camera && typeof camera.setSensorsMode === 'function' ? camera : null;
    this.camera =
      (engine && engine.camera) ||
      (camera && camera.isCamera ? camera : null) ||
      (this.rig && this.rig.camera) ||
      new THREE.PerspectiveCamera(48, 1, 1, 400000);

    const root = typeof container === 'string' ? document.getElementById(container) : container;
    if (!root) throw new Error('HUD: no container element');
    this.root = root;
    root.classList.add('vsh-root');

    this.reduceMotion =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.selection = new Set();
    this.proj = new Projector();
    this.view = { w: 1, h: 1, dpr: Math.min(2, window.devicePixelRatio || 1) };
    this.formation = 'delta';
    this.stance = 'neutral';
    this.speed = 1;
    this.seed = null;

    this._offs = [];
    this._nodes = [];
    this._groups = new Map();
    this._toasts = [];
    this._creditsShown = 0;
    this._creditsTarget = 0;
    this._creditsLast = -1;
    this._incomeAcc = 0;
    this._incomeWin = 0;
    this._income = 0;
    this._statAcc = 1;
    this._popUsed = 0;
    this._popCap = 0;
    this._fleetValue = 0;
    this._sensorsSelf = false;
    this._helpOpen = false;
    this._overOpen = false;
    this._introDone = false;
    this._tmpV = new THREE.Vector3();
    this._tmpO = new THREE.Vector3();

    this._teamCache = { credits: 0, income: 0, pop: 0, popCap: 0, queue: [] };
    this._stats = { built: 0, lost: 0, kills: 0, earned: 0, start: performance.now() };

    this.ctx = {
      bus,
      engine: this.engine,
      world: this.world,
      team: this.team,
      proj: this.proj,
      view: this.view,
      selection: this.selection,
      reduceMotion: this.reduceMotion,
      entities: () => (this.world && this.world.entities ? this.world.entities.values() : EMPTY),
      entity: (id) => (this.world && this.world.entities ? this.world.entities.get(id) : undefined),
      select: (ids) => this.select(ids),
      emit: (type, payload) => bus.emit(type, payload),
      toast: (text, kind) => this.toast(text, kind),
      teamState: () => this._readTeam(),
      resourceClusters: () => this._clusters(),
      screenToPlane: (px, py, planeY) => this.screenToPlane(px, py, planeY),
      metresPerPixelAt: (p) => this.metresPerPixelAt(p),
    };
    Object.defineProperty(this.ctx, 'formation', {
      get: () => this.formation,
      enumerable: true,
      configurable: true,
    });

    this._buildDom();
    this.markers = new WorldMarkers({ root: this.layerHost, ctx: this.ctx });
    this.roster = new SelectionRoster({ root: this.leftCol, ctx: this.ctx });
    this.build = new BuildMenu({ root: this.rightCol, ctx: this.ctx });
    this.sensors = new SensorsView({ root: this.sensorHost, ctx: this.ctx });

    this._wire();
    this._measure();
    this._setIntro(intro);
    this._refreshStats(true);
  }

  /* ------------------------------------------------------------------ DOM */

  _add(parent, node) {
    parent.appendChild(node);
    if (parent === this.root) this._nodes.push(node);
    return node;
  }

  _buildDom() {
    const root = this.root;

    this.scrim = this._add(root, el('div', 'vsh-root__scrim'));
    this.scrim.setAttribute('aria-hidden', 'true');

    // Two hosts, placed early so panels always paint above the overlays.
    this.layerHost = this._add(root, el('div', 'vsh-host vsh-host--markers'));
    this.layerHost.setAttribute('aria-hidden', 'true');
    this.sensorHost = this._add(root, el('div', 'vsh-host vsh-host--sensors'));

    /* ---------------------------------------------------------- top bar */
    const top = this._add(root, el('header', 'vsh-top'));
    top.setAttribute('aria-live', 'off');

    const res = el('div', 'vsh-res');
    res.append(el('span', 'vsh-res__mark'));
    this.creditsEl = el('span', 'vsh-res__credits', '0');
    const unit = el('span', 'vsh-res__unit', 'RU');
    this.rateEl = el('span', 'vsh-res__rate', '—');
    res.append(this.creditsEl, unit, this.rateEl);

    const fleet = el('div', 'vsh-fleet');
    this.statPop = this._stat(fleet, 'Population', '0 / 0');
    this.statValue = this._stat(fleet, 'Fleet value', '0');
    this.statHulls = this._stat(fleet, 'Hulls', '0');

    const speedStat = el('div', 'vsh-stat');
    speedStat.append(el('span', 'vsh-stat__k', 'Time'));
    const speedRow = el('div', 'vsh-speed');
    this.speedBtns = SPEEDS.map((s) => {
      const b = el('button', 'vsh-speed__b vsh-num', `×${s}`);
      b.type = 'button';
      b.dataset.speed = String(s);
      b.setAttribute('aria-label', `Time scale ${s} times`);
      b.setAttribute('aria-pressed', String(s === 1));
      speedRow.appendChild(b);
      return b;
    });
    speedStat.appendChild(speedRow);
    fleet.appendChild(speedStat);

    top.append(res, fleet);
    this._add(root, el('div', 'vsh-top__rule')).setAttribute('aria-hidden', 'true');

    /* -------------------------------------------------------- bottom deck */
    const bottom = this._add(root, el('div', 'vsh-bottom'));
    this.leftCol = el('div', 'vsh-bottom__col vsh-bottom__col--left');
    const midCol = el('div', 'vsh-bottom__col vsh-bottom__col--mid');
    this.rightCol = el('div', 'vsh-bottom__col vsh-bottom__col--right');
    bottom.append(this.leftCol, midCol, this.rightCol);

    this.toastEl = el('div', 'vsh-toasts');
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');
    this.leftCol.appendChild(this.toastEl);

    /* ------------------------------------------------------------ palette */
    const palette = el('div', 'vsh-palette');
    this.stanceRow = el('div', 'vsh-palette__row');
    this.stanceRow.append(el('span', 'vsh-palette__k', 'Stance'));
    this.stanceBtns = STANCES.map((s) => this._cmd(this.stanceRow, s.label, s.key, 'stance', s.id));

    this.formRow = el('div', 'vsh-palette__row');
    this.formRow.append(el('span', 'vsh-palette__k', 'Formation'));
    this.formBtns = FORMATIONS.map((f) =>
      this._cmd(this.formRow, f.label, f.key, 'formation', f.id));

    const util = el('div', 'vsh-palette__util');
    this.sensorBtn = this._cmd(util, 'Sensors', 'Tab', 'util', 'sensors');
    this.focusBtn = this._cmd(util, 'Focus', 'F', 'util', 'focus');
    this.helpBtn = this._cmd(util, 'Keys', 'H', 'util', 'help');

    palette.append(this.stanceRow, this.formRow, util);
    midCol.appendChild(palette);
    this.palette = palette;

    /* --------------------------------------------------------------- help */
    /* Centred rather than docked: a side rail at this width would sit on top
       of the production menu, and the key reference is a thing you stop and
       read, not something you consult mid-battle. */
    const help = this._add(root, el('aside', 'vsh-help'));
    help.setAttribute('aria-label', 'Controls');
    const hInner = el('div', 'vsh-help__inner');
    const hHead = el('div', 'vsh-help__head');
    hHead.append(el('span', 'vsh-help__title', 'Controls'));
    this.helpClose = el('button', 'vsh-help__close', 'Close · Esc');
    this.helpClose.type = 'button';
    hHead.appendChild(this.helpClose);
    const hGrid = el('div', 'vsh-help__grid');
    for (const [group, rows] of HELP) {
      const col = el('section', 'vsh-help__col');
      col.appendChild(el('p', 'vsh-help__grp', group));
      for (const [k, d] of rows) {
        const row = el('div', 'vsh-help__row');
        row.append(el('span', 'vsh-help__k', k), el('span', 'vsh-help__d', d));
        col.appendChild(row);
      }
      hGrid.appendChild(col);
    }
    hInner.append(hHead, hGrid);
    help.appendChild(hInner);
    this.help = help;

    /* --------------------------------------------------------------- boot */
    const boot = this._add(root, el('section', 'vsh-boot'));
    boot.hidden = true;
    const bi = el('div', 'vsh-boot__inner');
    bi.append(el('p', 'vsh-boot__eyebrow', 'Elusion Works'));
    bi.append(el('h1', 'vsh-boot__title', 'Void Sovereign'));
    bi.append(
      el(
        'p',
        'vsh-boot__sub',
        'Fleet command at universe scale. Every hull, nebula and asteroid in this ' +
          'skirmish is generated in your browser from a single seed.',
      ),
    );
    const bar = el('div', 'vsh-boot__bar');
    this.bootFill = el('i', 'vsh-boot__fill');
    bar.appendChild(this.bootFill);
    const foot = el('div', 'vsh-boot__foot');
    this.bootStep = el('span', 'vsh-boot__step', 'Waking the shipyard');
    this.bootPct = el('span', 'vsh-boot__pct vsh-num', '0%');
    foot.append(this.bootStep, this.bootPct);
    this.bootSkip = el('button', 'vsh-boot__skip', 'Begin →');
    this.bootSkip.type = 'button';
    bi.append(bar, foot, this.bootSkip);
    boot.appendChild(bi);
    this.boot = boot;

    /* ---------------------------------------------------------- game over */
    const over = this._add(root, el('section', 'vsh-over'));
    over.setAttribute('role', 'dialog');
    over.setAttribute('aria-modal', 'true');
    over.setAttribute('aria-label', 'Skirmish complete');
    const oi = el('div', 'vsh-over__inner');
    oi.append(el('p', 'vsh-over__eyebrow', 'Skirmish complete'));
    this.overTitle = el('h2', 'vsh-over__title', 'Fleet lost');
    this.overStats = el('div', 'vsh-over__stats');
    this.overRestart = el('button', 'vsh-over__restart', 'New skirmish');
    this.overRestart.type = 'button';
    oi.append(this.overTitle, this.overStats, this.overRestart);
    over.appendChild(oi);
    this.over = over;
  }

  _stat(parent, label, value) {
    const s = el('div', 'vsh-stat');
    s.append(el('span', 'vsh-stat__k', label));
    const v = el('span', 'vsh-stat__v vsh-num', value);
    s.appendChild(v);
    parent.appendChild(s);
    return { root: s, value: v };
  }

  _cmd(parent, label, key, kind, id) {
    const b = el('button', 'vsh-cmd');
    b.type = 'button';
    b.dataset.kind = kind;
    b.dataset.id = id;
    b.append(document.createTextNode(label), el('span', 'vsh-cmd__key', key));
    b.setAttribute('aria-label', `${label} (${key})`);
    b.setAttribute('aria-pressed', 'false');
    parent.appendChild(b);
    return b;
  }

  /* ----------------------------------------------------------------- wiring */

  _wire() {
    const on = (type, fn) => this._offs.push(bus.on(type, fn));

    on('sel:changed', (p) => this._onSelection((p && p.ids) || []));
    on('sim:resourceChanged', (p) => this._onCredits(p));
    on('sim:buildComplete', (p) => this._onBuilt(p));
    on('sim:spawn', () => this.build.refresh());
    on('sim:death', (p) => this._onDeath(p));
    on('sim:damage', (p) => {
      if (p && p.entity) this.markers.flagHit(p.entity.id);
    });
    on('sim:gameOver', (p) => this._onGameOver(p));
    on('ui:toast', (p) => p && this.toast(p.text, p.kind));
    on('cmd:move', (p) => p && p.point && this.markers.addOrder(p.point, 'move'));
    on('cmd:attack', (p) => p && this.markers.addAttackOn(p.targetId));
    on('ui:sensorsToggle', (p) => {
      if (this._sensorsSelf) return;
      this._setSensors(!!(p && p.open), true);
    });
    on('ui:progress', (p) => p && this.setLoadProgress(p.value, p.label));
    on('ui:ready', (p) => {
      if (p && p.seed !== undefined) this.seed = p.seed;
      this.finishLoading();
    });

    this._onKey = (ev) => this._key(ev);
    window.addEventListener('keydown', this._onKey);

    this._onClick = (ev) => this._click(ev);
    this.root.addEventListener('click', this._onClick);

    this._ro = null;
    if (typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(() => this._measure());
      this._ro.observe(this.root);
    } else {
      this._onResize = () => this._measure();
      window.addEventListener('resize', this._onResize);
    }
    this._syncPalette();
  }

  /** Every button in the HUD funnels through here, so there is one listener. */
  _click(ev) {
    const t = ev.target;
    if (!t || !t.closest) return;
    const speed = t.closest('.vsh-speed__b');
    if (speed) {
      this.setSpeed(Number(speed.dataset.speed));
      return;
    }
    if (t.closest('.vsh-help__close')) {
      this.setHelp(false);
      return;
    }
    if (t.closest('.vsh-over__restart')) {
      this._restart();
      return;
    }
    if (t.closest('.vsh-boot__skip')) {
      this.skipIntro();
      return;
    }
    const cmd = t.closest('.vsh-cmd');
    if (!cmd) return;
    const kind = cmd.dataset.kind;
    const id = cmd.dataset.id;
    if (kind === 'stance') this.setStance(id);
    else if (kind === 'formation') this.setFormation(id);
    else if (id === 'sensors') this.toggleSensors();
    else if (id === 'focus') this.focusSelection();
    else if (id === 'help') this.setHelp(!this._helpOpen);
  }

  _key(ev) {
    const t = ev.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;

    const k = ev.key;
    if (k === 'Tab') {
      ev.preventDefault();
      this.toggleSensors();
      return;
    }
    if (k === 'Escape') {
      if (this._helpOpen) this.setHelp(false);
      else if (this.sensors.open) this.toggleSensors();
      else if (this.selection.size) this.select([]);
      return;
    }
    if (k === 'F1' || k === '?' || k === 'h' || k === 'H') {
      ev.preventDefault();
      this.setHelp(!this._helpOpen);
      return;
    }
    if (k === 'f' || k === 'F') {
      this.focusSelection();
      return;
    }
    if (k === 'p' || k === 'P') {
      this.setSpeed(this.speed === 0 ? 1 : 0);
      return;
    }
    if (k === '+' || k === '=') {
      this._stepSpeed(1);
      return;
    }
    if (k === '-' || k === '_') {
      this._stepSpeed(-1);
      return;
    }

    const digit = k >= '1' && k <= '9' ? Number(k) : 0;
    if (digit) {
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        this._assignGroup(digit);
      } else if (ev.altKey) {
        ev.preventDefault();
        this._recallGroup(digit);
      } else if (digit <= FORMATIONS.length) {
        this.setFormation(FORMATIONS[digit - 1].id);
      }
      return;
    }

    const lower = k.toLowerCase();
    if (lower === 'z') this.setStance('evasive');
    else if (lower === 'x') this.setStance('neutral');
    else if (lower === 'c') this.setStance('aggressive');
  }

  /* ---------------------------------------------------------------- state */

  _measure() {
    const r = this.root.getBoundingClientRect();
    this.view.w = Math.max(1, Math.round(r.width));
    this.view.h = Math.max(1, Math.round(r.height));
    this.view.dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.sensors) this.sensors.resize();
  }

  select(ids) {
    const clean = [];
    const seen = new Set();
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (seen.has(id)) continue;
      const e = this.ctx.entity(id);
      if (!e || e.alive === false) continue;
      seen.add(id);
      clean.push(id);
    }
    bus.emit('sel:changed', { ids: clean });
  }

  _onSelection(ids) {
    this.selection.clear();
    for (let i = 0; i < ids.length; i++) this.selection.add(ids[i]);
    this.roster.setSelection(ids);
    this.build.refresh();
    this._syncPalette();
  }

  _syncPalette() {
    const live = this.selection.size > 0;
    this.stanceRow.classList.toggle('is-live', live);
    this.formRow.classList.toggle('is-live', live);
    for (let i = 0; i < this.stanceBtns.length; i++) {
      this.stanceBtns[i].setAttribute('aria-pressed', String(STANCES[i].id === this.stance));
    }
    for (let i = 0; i < this.formBtns.length; i++) {
      this.formBtns[i].setAttribute('aria-pressed', String(FORMATIONS[i].id === this.formation));
    }
    this.sensorBtn.setAttribute('aria-pressed', String(this.sensors ? this.sensors.open : false));
    this.helpBtn.setAttribute('aria-pressed', String(this._helpOpen));
  }

  setStance(id) {
    if (!STANCES.some((s) => s.id === id)) return;
    this.stance = id;
    this._syncPalette();
    if (!this.selection.size) return;
    bus.emit('cmd:stance', { ids: Array.from(this.selection), stance: id });
    this.toast(`Stance · ${id}`, 'info');
  }

  setFormation(id) {
    if (!FORMATIONS.some((f) => f.id === id)) return;
    this.formation = id;
    this._syncPalette();
    if (!this.selection.size) return;
    bus.emit('cmd:formation', { ids: Array.from(this.selection), formation: id });
    this.toast(`Formation · ${id}`, 'info');
  }

  setSpeed(scale) {
    this.speed = scale;
    for (const b of this.speedBtns) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === scale));
    }
    bus.emit('ui:speed', { scale });
    this.toast(scale === 0 ? 'Paused' : `Time ×${scale}`, 'info');
  }

  _stepSpeed(dir) {
    const i = SPEEDS.indexOf(this.speed);
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 1 : i) + dir))];
    this.setSpeed(next);
  }

  toggleSensors() {
    this._setSensors(!this.sensors.open, false);
  }

  _setSensors(open, external) {
    if (this.sensors.open === open) return;
    this.sensors.setOpen(open);
    this.markers.setHidden(open);
    this._syncPalette();
    if (!external) {
      this._sensorsSelf = true;
      bus.emit('ui:sensorsToggle', { open });
      this._sensorsSelf = false;
    }
  }

  setHelp(open) {
    this._helpOpen = open;
    this.help.classList.toggle('is-open', open);
    this._syncPalette();
  }

  focusSelection() {
    if (!this.selection.size) return;
    let x = 0;
    let y = 0;
    let z = 0;
    let n = 0;
    let spread = 0;
    for (const id of this.selection) {
      const e = this.ctx.entity(id);
      if (!e) continue;
      const p = (e.object3D && e.object3D.position) || e.position;
      if (!p) continue;
      x += p.x; y += p.y; z += p.z; n++;
    }
    if (!n) return;
    x /= n; y /= n; z /= n;
    for (const id of this.selection) {
      const e = this.ctx.entity(id);
      if (!e) continue;
      const p = (e.object3D && e.object3D.position) || e.position;
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (d > spread) spread = d;
    }
    bus.emit('ui:focus', {
      point: new THREE.Vector3(x, y, z),
      distance: Math.max(900, spread * 2.6 + 600),
    });
  }

  _assignGroup(n) {
    if (!this.selection.size) return;
    this._groups.set(n, Array.from(this.selection));
    this.toast(`Control group ${n} set · ${this.selection.size} hulls`, 'good');
  }

  _recallGroup(n) {
    const ids = this._groups.get(n);
    if (!ids || !ids.length) {
      this.toast(`Control group ${n} is empty`, 'warn');
      return;
    }
    this.select(ids);
  }

  /* --------------------------------------------------------------- economy */

  _onCredits(p) {
    if (!p || p.team !== this.team) return;
    this._creditsTarget = num(p.credits, this._creditsTarget);
    const d = num(p.delta, 0);
    if (d > 0) {
      this._incomeAcc += d;
      this._stats.earned += d;
    }
  }

  _onBuilt(p) {
    if (!p || p.team !== this.team) return;
    this._stats.built++;
    const def = SHIPS[p.classId];
    this.toast(`${def ? def.name : p.classId} ready`, 'good');
    this.build.refresh();
  }

  _onDeath(p) {
    if (!p || !p.entity) return;
    const e = p.entity;
    if (e.team === this.team) this._stats.lost++;
    else this._stats.kills++;
    if (this.selection.delete(e.id)) {
      this.roster.setSelection(Array.from(this.selection));
      this._syncPalette();
    }
  }

  /* Tolerant read of the team block. The economy module owns the real shape;
     this normalises the names it might plausibly use and falls back to
     counting entities, so the bar is never blank and never throws. */
  _readTeam() {
    const s = this._teamCache;
    const t = this.world && this.world.teams ? this.world.teams[this.team] : null;

    s.credits = num(t && (t.credits !== undefined ? t.credits : t.resources), this._creditsTarget);
    s.income = num(t && (t.income !== undefined ? t.income : t.incomeRate), this._income);

    const rawPop = t && (t.pop !== undefined ? t.pop : t.popUsed);
    const rawCap = t && (t.popCap !== undefined ? t.popCap : t.maxPop);
    // A zero cap means the economy has not published one yet, so fall back to
    // counting hulls rather than reporting a fleet that is 100% over cap.
    if (typeof rawPop === 'number' && typeof rawCap === 'number' && rawCap > 0) {
      s.pop = rawPop;
      s.popCap = rawCap;
    } else {
      s.pop = this._popUsed;
      s.popCap = this._popCap;
    }

    const raw = (t && (t.queue || t.buildQueue || t.production)) || EMPTY;
    const q = s.queue;
    q.length = 0;
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (!item) continue;
      const classId = item.classId || item.id || item.ship;
      if (!classId) continue;
      const def = SHIPS[classId];
      let progress = 0;
      if (typeof item.progress === 'number') {
        progress = item.progress > 1 && def ? item.progress / def.buildTime : item.progress;
      } else if (typeof item.elapsed === 'number') {
        const bt = num(item.buildTime, def ? def.buildTime : 1);
        progress = bt > 0 ? item.elapsed / bt : 0;
      } else if (typeof item.remaining === 'number' && def) {
        progress = 1 - item.remaining / def.buildTime;
      }
      q.push({ classId, progress: Math.max(0, Math.min(1, progress)) });
    }
    return s;
  }

  _clusters() {
    const w = this.world;
    if (!w) return null;
    const c = w.resourceClusters || w.resources || w.asteroidFields;
    return Array.isArray(c) ? c : null;
  }

  /** Population and fleet value, recomputed a few times a second. */
  _refreshStats(force) {
    let pop = 0;
    let cap = 0;
    let hulls = 0;
    let value = 0;
    for (const e of this.ctx.entities()) {
      if (e.alive === false || e.team !== this.team) continue;
      const def = e.def || SHIPS[e.classId];
      if (!def) continue;
      hulls++;
      pop += def.popCost || 0;
      cap += def.popProvided || 0;
      value += def.cost || 0;
    }
    this._popUsed = pop;
    this._popCap = cap;
    this._fleetValue = value;

    const t = this._readTeam();
    const usedCap = t.popCap || cap;
    const usedPop = t.pop || pop;
    this.statPop.value.replaceChildren(
      document.createTextNode(String(Math.round(usedPop))),
      el('em', null, ' / '),
      document.createTextNode(String(Math.round(usedCap))),
    );
    this.statPop.root.classList.toggle('is-warn', usedCap > 0 && usedPop / usedCap > 0.9);
    this.statValue.value.textContent = value.toLocaleString('en-GB');
    this.statHulls.value.textContent = String(hulls);

    if (force) {
      this._creditsTarget = t.credits;
      this._creditsShown = t.credits;
      this._creditsLast = Math.round(t.credits);
      this.creditsEl.textContent = this._creditsLast.toLocaleString('en-GB');
    }
  }

  /* ---------------------------------------------------------------- toasts */

  toast(text, kind) {
    if (!text) return;
    const t = {
      el: el('div', `vsh-toast${kind ? ` vsh-toast--${kind}` : ''}`, String(text)),
      life: TOAST_LIFE,
    };
    this.toastEl.appendChild(t.el);
    this._toasts.push(t);
    // One frame later, so the transition has something to run from.
    requestAnimationFrame(() => t.el.classList.add('is-live'));
    while (this._toasts.length > MAX_TOASTS) {
      const old = this._toasts.shift();
      old.el.remove();
    }
  }

  _toastTick(dt) {
    for (let i = this._toasts.length - 1; i >= 0; i--) {
      const t = this._toasts[i];
      t.life -= dt;
      if (t.life <= 0.4) t.el.classList.remove('is-live');
      if (t.life <= 0) {
        t.el.remove();
        this._toasts.splice(i, 1);
      }
    }
  }

  /* --------------------------------------------------------- boot / intro */

  /* 'auto' keeps the card dormant: the page shell has its own boot overlay,
     so ours only appears once something actually drives it with progress.
     Pass `intro: true` to own the whole boot sequence, `false` to disable. */
  _setIntro(mode) {
    this._introMode = mode;
    this._introShown = false;
    if (mode === true) this._showIntro();
  }

  _showIntro() {
    if (this._introShown || this._introDone) return;
    this._introShown = true;
    this.boot.hidden = false;
    this.boot.classList.remove('is-done');
  }

  setLoadProgress(value, label) {
    if (this._introDone || this._introMode === false) return;
    this._showIntro();
    const v = Math.max(0, Math.min(1, num(value, 0)));
    this.bootFill.style.transform = `scaleX(${v.toFixed(3)})`;
    this.bootPct.textContent = `${Math.round(v * 100)}%`;
    if (label) this.bootStep.textContent = String(label);
    this.bootSkip.classList.toggle('is-live', v >= 0.999);
  }

  finishLoading() {
    if (this._introDone) return;
    this._introDone = true;
    if (!this._introShown) {
      this.boot.hidden = true;
      return;
    }
    this.boot.classList.add('is-done');
    this._bootTimer = setTimeout(() => {
      this.boot.hidden = true;
    }, 800);
  }

  skipIntro() {
    this.finishLoading();
  }

  /* ------------------------------------------------------------- game over */

  _onGameOver(p) {
    if (this._overOpen) return;
    this._overOpen = true;
    const won = p && p.winner === this.team;
    this.over.classList.add('is-open');
    this.over.classList.toggle('vsh-over--won', !!won);
    this.over.classList.toggle('vsh-over--lost', !won);
    this.overTitle.textContent = won ? 'Sovereignty established' : 'Fleet lost';

    const mine = [];
    for (const e of this.ctx.entities()) {
      if (e.alive !== false && e.team === this.team) mine.push(e);
    }
    const secs = Math.max(0, (performance.now() - this._stats.start) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(Math.floor(secs % 60)).padStart(2, '0');

    const rows = [
      ['Hulls commissioned', String(this._stats.built)],
      ['Hulls lost', String(this._stats.lost)],
      ['Hostiles destroyed', String(this._stats.kills)],
      ['Resources gathered', Math.round(this._stats.earned).toLocaleString('en-GB')],
      ['Fleet remaining', `${mine.length} · ${totalFleetValue(mine).toLocaleString('en-GB')} RU`],
      ['Duration', `${mm}:${ss}`],
    ];
    const frag = document.createDocumentFragment();
    for (const [k, v] of rows) {
      const row = el('div', 'vsh-over__row');
      row.append(el('span', 'vsh-over__k', k), el('span', 'vsh-over__v vsh-num', v));
      frag.appendChild(row);
    }
    this.overStats.replaceChildren(frag);
    this.overRestart.focus({ preventScroll: true });
  }

  _restart() {
    const seed = (Math.random() * 0x7fffffff) | 0;
    this.over.classList.remove('is-open');
    this._overOpen = false;
    bus.emit('ui:restart', { seed });
  }

  /* ---------------------------------------------------------------- update */

  update(dt) {
    const d = num(dt, 1 / 60);
    this.proj.update(this.camera, this.view.w, this.view.h);

    // Credits ease toward the authoritative number, so a big payout reads as
    // a count-up rather than a jump.
    const diff = this._creditsTarget - this._creditsShown;
    if (Math.abs(diff) > 0.5) {
      this._creditsShown += diff * Math.min(1, d * 7);
    } else {
      this._creditsShown = this._creditsTarget;
    }
    const shown = Math.round(this._creditsShown);
    if (shown !== this._creditsLast) {
      this._creditsLast = shown;
      this.creditsEl.textContent = shown.toLocaleString('en-GB');
    }

    this._incomeWin += d;
    if (this._incomeWin >= 1.5) {
      this._income = this._incomeAcc / this._incomeWin;
      this._incomeAcc = 0;
      this._incomeWin = 0;
      const r = this._income;
      this.rateEl.textContent = r > 0.05 ? `+${r.toFixed(1)} /s` : '—';
      this.rateEl.classList.toggle('is-up', r > 0.05);
    }

    this._statAcc += d;
    if (this._statAcc >= 0.25) {
      this._statAcc = 0;
      this._refreshStats(false);
    }

    this.roster.update(d);
    this.markers.update(d);
    this.build.update(d);
    this.sensors.update(d);
    this._toastTick(d);
  }

  /* -------------------------------------------------------------- geometry */

  /** Screen pixel → a point on the horizontal plane at `planeY`. */
  screenToPlane(px, py, planeY) {
    const ndcX = (px / this.view.w) * 2 - 1;
    const ndcY = -((py / this.view.h) * 2 - 1);
    const dir = this._tmpV.set(ndcX, ndcY, 0.5).unproject(this.camera);
    const origin = this.camera.getWorldPosition(this._tmpO);
    dir.sub(origin).normalize();
    if (Math.abs(dir.y) < 1e-6) return null;
    let t = (planeY - origin.y) / dir.y;
    if (t <= 0) t = 12000; // looking away from the plane: park it out front
    return new THREE.Vector3(
      origin.x + dir.x * t,
      origin.y + dir.y * t,
      origin.z + dir.z * t,
    );
  }

  /** How many metres a screen pixel is worth at a given world point. */
  metresPerPixelAt(p) {
    if (p && this.proj.project(p.x, p.y, p.z)) return this.proj.cw / this.proj.scaleK;
    return 20;
  }

  /* --------------------------------------------------------------- teardown */

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    window.removeEventListener('keydown', this._onKey);
    this.root.removeEventListener('click', this._onClick);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    if (this._bootTimer) clearTimeout(this._bootTimer);

    this.roster.dispose();
    this.markers.dispose();
    this.build.dispose();
    this.sensors.dispose();

    for (const n of this._nodes) n.remove();
    this._nodes.length = 0;
    for (const t of this._toasts) t.el.remove();
    this._toasts.length = 0;
    this.root.classList.remove('vsh-root');
    this.selection.clear();
    this._groups.clear();
  }
}

export default HUD;
