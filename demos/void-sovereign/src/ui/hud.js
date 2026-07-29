import * as THREE from '../../vendor/three/build/three.module.js';
import { bus } from '../core/events.js';
import { SHIPS, totalFleetValue } from '../ships/catalog.js';
import {
  CONTROL_SCHEME,
  FORMATIONS as SIM_FORMATIONS,
  STANCES as SIM_STANCES,
  SPEED_STEPS,
} from '../core/input.js';
import { SelectionRoster, WorldMarkers } from './select.js';
import { BuildMenu } from './build.js';
import { SensorsView } from './sensors.js';

/* VOID SOVEREIGN — HUD facade.

   Builds its own DOM into the container it is handed, wires every surface to
   the event bus, and drives one update pass per frame. It never mutates the
   world: it emits `cmd:*` and `ui:*` and reacts to `sim:*` and `sel:changed`.

   Layout, corner by corner:
     top-left      credits, income
     top-right     population, fleet value, hulls, hostiles, time scale
     bottom-left   toast stack, then the grouped selection roster
     bottom-centre stance / formation / utility palette
     bottom-right  production menu and queue
     over the void selection brackets, health pips, target reticles, orders
   The bottom deck stops short of the page shell's "← Demos" link.

   **The keyboard belongs to `core/input.js`.** That module is the single
   owner of the control scheme; every key the player presses arrives here as a
   bus event instead. The HUD binds exactly one key — Escape, to dismiss the
   controls card, which input.js knows nothing about. Anything else would be
   handled twice: two Tab handlers cancelled each other out and the Sensors
   Manager never opened. The palette buttons and the formation/stance/speed
   readouts mirror `cmd:*` / `ui:speed` so the surface always agrees with the
   keyboard, whichever one the player used. */

/* Ordered to match `core/input.js`: Shift+1 … Shift+6 walk this list. */
const FORMATION_LABELS = {
  delta: 'Delta',
  broad: 'Broad',
  claw: 'Claw',
  x: 'Cross',
  wall: 'Wall',
  sphere: 'Sphere',
};

const STANCE_LABELS = {
  evasive: 'Evasive',
  neutral: 'Neutral',
  aggressive: 'Aggressive',
};

const STANCE_KEYS = { evasive: 'Z', neutral: 'X', aggressive: 'C' };

/* A pause bar, two vulgar fractions and three multipliers. All six glyphs are
   in IBM Plex Mono, so the row stays on one baseline at one width. */
const SPEED_LABELS = { 0: '‖', 0.25: '¼', 0.5: '½', 1: '×1', 2: '×2', 4: '×4' };

const FORMATIONS = SIM_FORMATIONS.map((id, i) => ({
  id,
  label: FORMATION_LABELS[id] || id,
  key: `⇧${i + 1}`,
}));

const STANCES = SIM_STANCES.map((id) => ({
  id,
  label: STANCE_LABELS[id] || id,
  key: STANCE_KEYS[id] || '',
}));

const MAX_TOASTS = 5;
const TOAST_LIFE = 4.6;

/* `core/input.js` documents order queueing, but the simulation currently
   clears `orderQueue` unconditionally on every `cmd:move` / `cmd:attack`, so
   the promise is not kept. Rather than print a control the player cannot use,
   the card drops the row until the sim agent lands the fix — at which point
   this list goes back to empty and the row returns on its own.
   Match is on the description text, which is the stable half of the pair. */
const UNSHIPPED_CONTROLS = new Set(['Queue the order']);

/* First-run onboarding. Three steps, each ticked off by an event the player
   actually caused, then the rail retires itself for good. This is deliberately
   not a modal: the genre's chronic failure is dumping the whole scheme up
   front, which is exactly what the H card is for once you want it. */
/* `src/audio/index.js` publishes an event-driven control surface precisely so
   the HUD does not have to hold a reference to the AudioSystem: emit
   `ui:audioVolume` / `ui:audioMute`, listen for `ui:audioChanged`. It persists
   its own preferences, so this panel owns none of that.

   The panel stays hidden until audio announces itself — either by the `audio`
   constructor option or by the first `ui:audioChanged` — because a mixer that
   silently does nothing is worse than no mixer. */
const AUDIO_BUSES = [
  ['master', 'Master'],
  ['music', 'Music'],
  ['sfx', 'Effects'],
  ['ui', 'Interface'],
  ['voice', 'Comms'],
];

const ONBOARD_KEY = 'vs.onboarded.v1';
/* A hard ceiling as well as the event triggers: whatever the player is doing,
   a first-run rail has no business still being on screen a minute in. */
const ONBOARD_MAX_LIFE = 45;
const ONBOARD_STEPS = [
  { id: 'select', text: 'Drag a box to select your ships' },
  { id: 'order', text: 'Right-click to send them — drag to set altitude' },
  { id: 'build', text: 'Select the Mothership to build' },
];

/* Tactical pause is the best-kept secret in the build: the sim genuinely
   freezes and orders issued while frozen are obeyed. It gets said twice —
   once on the first-run rail and once at the top of the controls card —
   because a feature nobody finds may as well not exist. */
const PAUSE_LEDE =
  'Space pauses the battle. Orders you give while it is paused are obeyed the ' +
  'moment it resumes — a fleet engagement is meant to be commanded, not raced.';
const PAUSE_NOTE = 'Space pauses the battle — you can still give orders.';

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

/* Storage is a nice-to-have, never a dependency: private mode and blocked
   third-party contexts both throw on access rather than returning null. */
function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch (e) {
    return false;
  }
}

function writeFlag(key) {
  try {
    localStorage.setItem(key, '1');
  } catch (e) {
    /* no store, no memory — the rail simply returns next visit */
  }
}

const EMPTY = [];

/* ============================================================================ */

export class HUD {
  constructor({ engine, world, camera, container, team = 0, intro = 'auto', audio = null } = {}) {
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
    this.formation = SIM_FORMATIONS[0];
    this.stance = 'neutral';
    this.speed = 1;
    this.seed = null;

    this._offs = [];
    this._nodes = [];
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
    this._hostiles = 0;
    this._selDirty = false;
    this._buildDirty = false;
    this._sensorsSelf = false;
    this._audioLive = false;
    this._muted = false;
    this._helpOpen = false;
    this._overOpen = false;
    this._introDone = false;

    this._teamCache = { credits: 0, income: 0, pop: 0, popCap: 0, queued: 0, queue: [] };
    this._stats = { built: 0, lost: 0, kills: 0, earned: 0, start: performance.now() };

    this._hints = new Set();
    this._obLeft = ONBOARD_STEPS.length;
    this._obHold = 0;
    this._obLife = ONBOARD_MAX_LIFE;
    this._obDone = readFlag(ONBOARD_KEY);

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
    };

    this._buildDom();
    if (this._obDone) this.onboard.classList.add('is-gone');
    this.markers = new WorldMarkers({ root: this.layerHost, ctx: this.ctx });
    this.roster = new SelectionRoster({ root: this.leftCol, ctx: this.ctx });
    this.build = new BuildMenu({ root: this.rightCol, ctx: this.ctx });
    this.sensors = new SensorsView({ root: this.sensorHost, ctx: this.ctx });

    this._wire();
    this._measure();
    this._setIntro(intro);
    this._refreshStats(true);
    if (audio && typeof audio.getSettings === 'function') this._syncAudio(audio.getSettings());
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
    // The one warm readout in the bar. Amber is the enemy everywhere else in
    // the game, so the count of hostile contacts wears the same colour.
    this.statFoes = this._stat(fleet, 'Hostiles', '0');
    this.statFoes.root.classList.add('vsh-stat--foe');

    const speedStat = el('div', 'vsh-stat vsh-stat--speed');
    speedStat.append(el('span', 'vsh-stat__k', 'Time'));
    const speedRow = el('div', 'vsh-speed');
    this.speedBtns = SPEED_STEPS.map((s) => {
      const b = el('button', 'vsh-speed__b vsh-num', SPEED_LABELS[s] || `×${s}`);
      b.type = 'button';
      b.dataset.speed = String(s);
      b.setAttribute('aria-label', s === 0 ? 'Pause' : `Time scale ${s} times`);
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
    /* Centred, not docked. A 336 px side rail landed straight on top of the
       production menu at every width we ship at, and the key reference is a
       thing you stop and read rather than something you consult mid-battle —
       so it earns the whole screen and a scrim, like the game-over card. */
    const help = this._add(root, el('aside', 'vsh-help'));
    help.setAttribute('aria-label', 'Controls');
    help.setAttribute('aria-hidden', 'true');
    const hInner = el('div', 'vsh-help__inner');
    const hHead = el('div', 'vsh-help__head');
    hHead.append(el('p', 'vsh-help__eyebrow', 'Reference'));
    hHead.append(el('h2', 'vsh-help__title', 'Fleet command'));
    this.helpClose = el('button', 'vsh-help__close', 'Close · Esc');
    this.helpClose.type = 'button';
    hHead.appendChild(this.helpClose);
    // Promoted out of the "Groups & time" list, where it was one grey row.
    const hLede = el('p', 'vsh-help__lede', PAUSE_LEDE);

    // Straight from `core/input.js`, so the card cannot drift from the handlers.
    const hGrid = el('div', 'vsh-help__grid');
    for (const block of CONTROL_SCHEME) {
      const rows = block.rows.filter(([, d]) => !UNSHIPPED_CONTROLS.has(d));
      if (!rows.length) continue;
      const col = el('section', 'vsh-help__col');
      col.appendChild(el('p', 'vsh-help__grp', block.group));
      for (const [k, d] of rows) {
        const row = el('div', 'vsh-help__row');
        row.append(el('span', 'vsh-help__k', k), el('span', 'vsh-help__d', d));
        col.appendChild(row);
      }
      hGrid.appendChild(col);
    }

    /* ------------------------------------------------------------- audio */
    const audio = el('section', 'vsh-help__col vsh-audio');
    audio.appendChild(el('p', 'vsh-help__grp', 'Audio'));
    const muteRow = el('div', 'vsh-audio__row vsh-audio__row--mute');
    this.muteBtn = el('button', 'vsh-audio__mute', 'Sound on');
    this.muteBtn.type = 'button';
    this.muteBtn.setAttribute('aria-pressed', 'false');
    muteRow.append(el('span', 'vsh-audio__k', 'Mute'), this.muteBtn);
    audio.appendChild(muteRow);

    this.audioSliders = AUDIO_BUSES.map(([id, label]) => {
      const row = el('div', 'vsh-audio__row');
      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'vsh-audio__slider';
      input.min = '0';
      input.max = '1';
      input.step = '0.02';
      input.value = '0.8';
      input.dataset.bus = id;
      input.setAttribute('aria-label', `${label} volume`);
      row.append(el('span', 'vsh-audio__k', label), input);
      audio.appendChild(row);
      return { id, input };
    });
    hGrid.appendChild(audio);
    this.audioPanel = audio;

    hInner.append(hHead, hLede, hGrid);
    help.appendChild(hInner);
    this.help = help;

    /* ---------------------------------------------------------- onboarding */
    /* A thin strip under the top rule rather than a block in the middle of the
       frame. It is transient by design, so it must not own the composition
       while it is up — it sits in the one band of the screen nothing else
       uses, and leaves the void, the fleet and the bottom deck alone. */
    const ob = this._add(root, el('aside', 'vsh-onboard'));
    ob.setAttribute('aria-label', 'Getting started');
    const obHead = el('div', 'vsh-onboard__head');
    obHead.append(el('p', 'vsh-onboard__k', 'First orders'));
    this.obSkip = el('button', 'vsh-onboard__skip', 'Dismiss');
    this.obSkip.type = 'button';
    obHead.appendChild(this.obSkip);

    const obRows = el('div', 'vsh-onboard__rows');
    this.obSteps = ONBOARD_STEPS.map((s, i) => {
      const row = el('div', 'vsh-onboard__row');
      row.append(
        el('i', 'vsh-onboard__tick'),
        el('span', 'vsh-onboard__n vsh-num', String(i + 1)),
        el('span', 'vsh-onboard__t', s.text),
      );
      obRows.appendChild(row);
      return { id: s.id, row, done: false };
    });
    ob.append(obHead, obRows, el('p', 'vsh-onboard__note', PAUSE_NOTE));
    this.onboard = ob;

    /* --------------------------------------------------------- paused state */
    /* A frozen simulation with no indicator reads as a crash. Corner ticks and
       one word — no dimming, because the whole point is that you can still
       read the battlefield and command it while it is stopped. */
    const paused = this._add(root, el('div', 'vsh-paused'));
    paused.setAttribute('aria-hidden', 'true');
    for (const c of ['tl', 'tr', 'bl', 'br']) {
      paused.appendChild(el('i', `vsh-paused__c vsh-paused__c--${c}`));
    }
    const pTag = el('div', 'vsh-paused__tag');
    pTag.append(
      el('span', 'vsh-paused__word', 'Paused'),
      el('span', 'vsh-paused__sub', 'Orders still stand · Space to resume'),
    );
    paused.appendChild(pTag);
    this.pausedEl = paused;

    /* --------------------------------------------------------------- boot */
    /* Dormant unless something drives it with `ui:progress` — the page shell
       owns the real boot overlay in the shipped build. */
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
    over.setAttribute('aria-hidden', 'true');
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
    on('sim:spawn', () => { this._buildDirty = true; });
    on('sim:death', (p) => this._onDeath(p));
    on('sim:damage', (p) => {
      if (!p || !p.entity) return;
      this.markers.flagHit(p.entity.id);
      if (p.entity.team === this.team) {
        this._hint('stance', 'Under fire · Z, X and C set the fleet stance', 'warn');
      }
    });
    on('sim:gameOver', (p) => this._onGameOver(p));
    on('ui:toast', (p) => this._onToastEvent(p));
    on('cmd:move', (p) => {
      if (p && p.point) this.markers.addOrder(p.point, 'move');
      this._obTick('order');
    });
    on('cmd:attack', (p) => {
      if (p) this.markers.addAttackOn(p.targetId);
      this._obTick('order');
    });
    on('cmd:build', () => this._obTick('build'));

    /* Mirrors. The keyboard lives in `core/input.js`, so the palette learns
       what the player did from the same events the sim does. */
    on('cmd:stance', (p) => {
      if (p && p.stance && p.stance !== this.stance) {
        this.stance = p.stance;
        this._syncPalette();
      }
    });
    on('cmd:formation', (p) => {
      if (p && p.formation && p.formation !== this.formation) {
        this.formation = p.formation;
        this._syncPalette();
      }
    });
    on('ui:speed', (p) => {
      const s = num(p && p.scale, this.speed);
      if (s === this.speed) return;
      this.speed = s;
      this._syncSpeed();
    });
    on('ui:sensorsToggle', (p) => {
      if (this._sensorsSelf) return;
      this._setSensors(!!(p && p.open), true);
    });
    on('ui:audioChanged', (p) => this._syncAudio(p));
    on('ui:progress', (p) => p && this.setLoadProgress(p.value, p.label));
    on('ui:ready', (p) => {
      if (p && p.seed !== undefined) this.seed = p.seed;
      this.finishLoading();
    });

    /* Escape is the only key the HUD claims: it dismisses the controls card,
       which `core/input.js` has no idea exists. It deliberately does not
       preventDefault or touch the selection — input.js clears that. */
    this._onKey = (ev) => {
      if (ev.key !== 'Escape' || !this._helpOpen) return;
      const t = ev.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
      this.setHelp(false);
    };
    window.addEventListener('keydown', this._onKey);

    this._onClick = (ev) => this._click(ev);
    this.root.addEventListener('click', this._onClick);

    this._onSlide = (ev) => {
      const t = ev.target;
      if (!t || !t.dataset || !t.dataset.bus) return;
      bus.emit('ui:audioVolume', { bus: t.dataset.bus, value: Number(t.value) });
    };
    this.audioPanel.addEventListener('input', this._onSlide);

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
    if (t.closest('.vsh-onboard__skip')) {
      this._obRetire();
      return;
    }
    if (t.closest('.vsh-audio__mute')) {
      bus.emit('ui:audioMute', { muted: !this._muted });
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

  /* `core/input.js` answers H with a toast tagged `help` rather than reaching
     into the HUD. Catch that and open the card instead of printing a line. */
  _onToastEvent(p) {
    if (!p) return;
    if (p.kind === 'help') {
      this.setHelp(!this._helpOpen);
      return;
    }
    this.toast(p.text, p.kind);
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
    this._selDirty = false;
    this.roster.setSelection(ids);
    this.build.refresh();
    this._syncPalette();
    if (ids.length) this._obTick('select');
    if (ids.length >= 8) {
      this._hint('formation', 'Shift + 1 – 6 shapes the fleet into a formation', 'info');
    }
  }

  /* --------------------------------------------------------- onboarding */

  /* A step is ticked by the thing it asked for actually happening, never by a
     timer — an instruction that scrolls past before you have done it is worse
     than none.

     The rail retires the moment an order lands, not when all three steps are
     ticked. Someone who has selected a fleet and sent it somewhere is playing
     the game, and a first-run card still on screen during a fleet engagement
     is clutter. The third step survives as the contextual `yard` hint, which
     fires when it is actually relevant — sitting on unspent resources. */
  _obTick(id) {
    if (this._obDone) return;
    const step = this.obSteps.find((s) => s.id === id);
    if (!step || step.done) return;
    step.done = true;
    step.row.classList.add('is-done');
    this._obLeft--;
    if (id === 'order' || this._obLeft <= 0) {
      this._obHold = Math.min(this._obHold || Infinity, 1.5);
    }
  }

  _obRetire() {
    if (this._obDone) return;
    this._obDone = true;
    this.onboard.classList.add('is-gone');
    writeFlag(ONBOARD_KEY);
  }

  /** A one-line nudge, fired at most once per session per key. */
  _hint(key, text, kind) {
    if (this._hints.has(key)) return;
    this._hints.add(key);
    this.toast(text, kind || 'info');
  }

  /* ------------------------------------------------------------------ audio */

  /* Called with whatever `getSettings()` returns. The first call is also what
     reveals the panel — no audio system, no mixer. */
  _syncAudio(s) {
    if (!s || typeof s !== 'object') return;
    if (s.available === false) return;
    if (!this._audioLive) {
      this._audioLive = true;
      this.audioPanel.classList.add('is-live');
    }
    this._muted = !!s.muted;
    this.muteBtn.setAttribute('aria-pressed', String(this._muted));
    this.muteBtn.textContent = this._muted ? 'Muted' : 'Sound on';
    this.audioPanel.classList.toggle('is-muted', this._muted);
    for (const sl of this.audioSliders) {
      const v = num(s[sl.id], undefined);
      // Never fight the control the player is currently dragging.
      if (v !== undefined && document.activeElement !== sl.input) {
        sl.input.value = String(v);
      }
    }
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

  _syncSpeed() {
    for (const b of this.speedBtns) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === this.speed));
    }
    const paused = this.speed === 0;
    this.root.classList.toggle('is-paused', paused);
    this.pausedEl.classList.toggle('is-open', paused);
    this.pausedEl.setAttribute('aria-hidden', String(!paused));
  }

  setStance(id) {
    if (!SIM_STANCES.includes(id)) return;
    this.stance = id;
    this._syncPalette();
    if (!this.selection.size) return;
    bus.emit('cmd:stance', { ids: Array.from(this.selection), stance: id });
    this.toast(`Stance · ${STANCE_LABELS[id] || id}`, 'info');
  }

  setFormation(id) {
    if (!SIM_FORMATIONS.includes(id)) return;
    this.formation = id;
    this._syncPalette();
    if (!this.selection.size) return;
    bus.emit('cmd:formation', { ids: Array.from(this.selection), formation: id });
    this.toast(`Formation · ${FORMATION_LABELS[id] || id}`, 'info');
  }

  setSpeed(scale) {
    this.speed = scale;
    this._syncSpeed();
    bus.emit('ui:speed', { scale });
    this.toast(scale === 0 ? 'Paused' : `Time ×${scale}`, 'info');
  }

  toggleSensors() {
    this._setSensors(!this.sensors.open, false);
  }

  _setSensors(open, external) {
    if (this.sensors.open === open) return;
    this.sensors.setOpen(open);
    this.markers.setHidden(open);
    // The rail would sit on top of the schematic; the schematic wins.
    this.onboard.classList.toggle('is-mute', open);
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
    this.help.setAttribute('aria-hidden', String(!open));
    this._syncPalette();
    if (open) this.helpClose.focus({ preventScroll: true });
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
    this._buildDirty = true;
  }

  _onDeath(p) {
    if (!p || !p.entity) return;
    const e = p.entity;
    if (e.team === this.team) this._stats.lost++;
    else this._stats.kills++;
    // Re-publishing on every casualty would thrash a fleet battle, so the
    // corrected set goes out on the next stats beat instead.
    if (this.selection.delete(e.id)) this._selDirty = true;
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
    // Hulls already paid for but not yet hatched still occupy the cap, and the
    // build menu has to know or it will happily queue past it.
    s.queued = num(t && t.popQueued, 0);

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

  /** Population, fleet value and hostile count, a few times a second. */
  _refreshStats(force) {
    let pop = 0;
    let cap = 0;
    let hulls = 0;
    let value = 0;
    let foes = 0;
    for (const e of this.ctx.entities()) {
      if (e.alive === false) continue;
      if (e.team !== this.team) {
        foes++;
        continue;
      }
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
    this._hostiles = foes;

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
    this.statFoes.value.textContent = String(foes);

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
    this._obRetire();
    const won = p && p.winner === this.team;
    this.over.classList.add('is-open');
    this.over.setAttribute('aria-hidden', 'false');
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
    this.over.setAttribute('aria-hidden', 'true');
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

    if (!this._obDone) {
      this._obLife -= d;
      if (this._obHold > 0) this._obHold -= d;
      if (this._obLife <= 0 || (this._obHold !== 0 && this._obHold <= 0)) this._obRetire();
    }

    this._statAcc += d;
    if (this._statAcc >= 0.25) {
      this._statAcc = 0;
      this._refreshStats(false);
      // Sitting on a pile of ore with an empty yard is the commonest way a
      // first game stalls, so it earns one nudge and never mentions it again.
      if (this._creditsTarget > 900 && !this._teamCache.queue.length) {
        this._hint('yard', 'Resources idle · select the Mothership and lay down a hull', 'info');
      }
      if (this._selDirty) {
        this._selDirty = false;
        this.select(Array.from(this.selection));
      }
      if (this._buildDirty) {
        this._buildDirty = false;
        this.build.refresh();
      }
    }

    this.roster.update(d);
    this.markers.update(d);
    this.build.update(d);
    this.sensors.update(d);
    this._toastTick(d);
  }

  /* --------------------------------------------------------------- teardown */

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    window.removeEventListener('keydown', this._onKey);
    this.root.removeEventListener('click', this._onClick);
    this.audioPanel.removeEventListener('input', this._onSlide);
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
    this.root.classList.remove('vsh-root', 'is-paused');
    this.selection.clear();
  }
}

export default HUD;
