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
     top-right     population, fleet value, hulls, hostiles, match clock, speed
     bottom-left   toast stack, the grouped selection roster, and the
                   stance / formation palette docked underneath it
     bottom-centre the three utility verbs, and nothing else
     bottom-right  production strip, expanding to the full menu on demand
     over the void selection brackets, health pips, target reticles, orders
   The bottom deck stops short of the page shell's "← Demos" link.

   The palette used to float unanchored in the dead centre-bottom of the frame
   with keycap hints too small to read. It commands the selection, so round 1's
   fix #7 docks it to the selection roster: the two now share a block, a scrim
   and a live state, and the keycaps are set inline at a size a person can
   actually read. What is left in the centre is three verbs on one line.

   **The keyboard belongs to `core/input.js`.** That module is the single
   owner of the control scheme; every key the player presses arrives here as a
   bus event instead. The HUD binds **no** keys at all. It used to claim
   Escape to dismiss the controls card; Escape is now the pause key and it is
   arbitrated by `ui/shell.js`, which calls `closeOverlays()` here before it
   opens its own menu. Anything else would be handled twice: two Tab handlers
   cancelled each other out and the Sensors Manager never opened. The palette
   buttons and the formation/stance/speed readouts mirror `cmd:*` / `ui:speed`
   so the surface always agrees with the keyboard, whichever one the player
   used. */

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
/* Trouble stays up more than twice as long. A degraded-boot warning that
   scrolls away in four seconds is a warning nobody received. */
const TOAST_LIFE_ALERT = 11;

/* Emitters name a tone; the stylesheet ships three. Normalising here means a
   sender that says `warning` or `error` still gets the red treatment instead
   of falling through to plain grey — which is exactly how `main.js`'s
   degraded-run notice, the one signal that a subsystem failed to load, was
   arriving as an ordinary line of status text. */
const TOAST_KINDS = {
  warn: 'warn',
  caution: 'warn',
  alert: 'alert',
  warning: 'alert',
  error: 'alert',
  danger: 'alert',
  fail: 'alert',
  good: 'good',
  ok: 'good',
  success: 'good',
  info: '',
};

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
/* Third value is `AudioSystem`'s own DEFAULT_PREFS, mirrored so the bank can be
   shown before the first `ui:audioChanged` arrives without displaying a
   position that is simply wrong. See `_revealAudio` for why that matters. */
const AUDIO_BUSES = [
  ['master', 'Master', 0.8],
  ['music', 'Music', 0.7],
  ['sfx', 'Effects', 0.85],
  ['ui', 'Interface', 0.75],
  ['voice', 'Comms', 0.9],
];

/* If the mixer is shown optimistically and the player operates it, a working
   AudioSystem answers on the same tick. Nothing back inside this window means
   there is nothing listening, and the bank says so instead of pretending. */
const AUDIO_REPLY_MS = 500;

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
    this.audio = null;
    this._audioLive = false;
    this._audioOff = false;
    this._audioConfirmed = false;
    this._audioProbe = null;
    this._muted = false;
    this._helpOpen = false;
    this._overOpen = false;
    this._introDone = false;
    this._objLive = false;
    this._fleetHulls = 0;
    // Frozen at the whistle so the shell's end card reports the match, not the
    // world as it stands by the time somebody reads the card.
    this._final = null;

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
      panelRects: () => this._panelRects(),
    };

    this._buildDom();
    if (this._obDone) this.onboard.classList.add('is-gone');
    this.markers = new WorldMarkers({ root: this.layerHost, ctx: this.ctx });
    this.roster = new SelectionRoster({ root: this.rosterHost, ctx: this.ctx });
    this.build = new BuildMenu({ root: this.rightCol, ctx: this.ctx });
    this.sensors = new SensorsView({ root: this.sensorHost, ctx: this.ctx });

    this._wire();
    this._measure();
    this._setIntro(intro);
    this._refreshStats(true);
    this.setAudio(audio);
  }

  /* The mixer needs one of two things to appear: an AudioSystem handed in
     here, or a `ui:audioChanged` on the bus. `AudioSystem` only publishes that
     event when a setting changes, so a build that constructs audio but does
     not pass it has a working mix and no way to reach it — which is the state
     this was found in. Exposed as a method as well as a constructor option so
     the wiring can happen in either order. */
  setAudio(audio) {
    this.audio = audio && typeof audio.getSettings === 'function' ? audio : null;
    if (this.audio) this._syncAudio(this.audio.getSettings());
    else this._revealAudio();
  }

  /* Show the mixer without having been handed an AudioSystem.

     `main.js` constructs `AudioSystem` and constructs the HUD, and does not
     introduce them — so `audio` is null here in the shipped build and the
     original rule ("no mixer until audio announces itself") left the strongest
     system in the game with no surface at all. `AudioSystem` only publishes
     `ui:audioChanged` when something *changes*, so waiting for it is waiting
     for a control the player cannot reach to be used.

     Passing `audio` into the HUD is one line in `main.js` and is the right fix;
     it is not this module's file. Until then the bank is shown on the
     assumption that audio exists — true whenever `audio/index.js` loaded at all
     — seeded with that module's own defaults so the positions are right rather
     than invented, and corrected by the first real `ui:audioChanged`, which
     also carries any preference persisted from a previous session.

     If the assumption is wrong, `_expectAudioReply` finds out the first time
     the player touches anything and the bank relabels itself as unavailable. */
  _revealAudio() {
    if (this._audioLive) return;
    this._audioLive = true;
    this.audioPanel.classList.add('is-live');
    this.muteGlyph.classList.add('is-live');
  }

  /* Emitted a control event while still unconfirmed: give the bus one window to
     answer before believing there is anything on the other end. */
  _expectAudioReply() {
    if (this._audioConfirmed || this._audioProbe) return;
    this._audioProbe = setTimeout(() => {
      this._audioProbe = null;
      if (this._audioConfirmed) return;
      this._syncAudio({ available: false });
    }, AUDIO_REPLY_MS);
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

    /* The match clock. Round 1 found a `TIME` header sitting over the speed
       controls with no elapsed time under it, while the briefing describes a
       grace period the player is expected to race — so the header was naming a
       number that did not exist.

       Sim time, not wall-clock: `world.time` only advances on ticks the loop
       actually ran, so a match that spent four minutes in the pause menu does
       not report four minutes more, and it agrees with the duration on the
       end-of-match card, which is derived the same way. The speed control keeps
       its own header, now correctly called Speed. */
    this.statClock = this._stat(fleet, 'Time', '00:00');
    this.statClock.root.classList.add('vsh-stat--clock');
    this._clockShown = '';
    this._clockGrace = null;

    const speedStat = el('div', 'vsh-stat vsh-stat--speed');
    speedStat.append(el('span', 'vsh-stat__k', 'Speed'));
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

    /* Sound state, always on screen.

       The mixer lives on the H card because five sliders are a settings bank,
       not a HUD element — but mute is the control a player reaches for when
       someone walks into the room, and one they will not go hunting for. So the
       state is permanently legible and one click from changing, and the card
       keeps the detail. Hidden until audio announces itself, for the same
       reason the mixer is: a control that silently does nothing is worse than
       no control. */
    fleet.appendChild(this._buildMuteGlyph());

    top.append(res, this._buildObjective(), fleet);
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
    /* One block: the roster the `SelectionRoster` mounts into, then the two
       rows that command it. They appear and disappear together and share one
       scrim, because they are one idea — "here is what you have selected, and
       here is what you can tell it to do". */
    this.selBlock = el('div', 'vsh-selblock');
    this.rosterHost = el('div', 'vsh-selblock__roster');
    this.selBlock.appendChild(this.rosterHost);
    this.leftCol.appendChild(this.selBlock);

    const palette = el('div', 'vsh-palette');
    this.stanceRow = this._paletteRow('Stance');
    this.stanceBtns = STANCES.map((s) =>
      this._cmd(this.stanceRow.btns, s.label, s.key, 'stance', s.id));

    this.formRow = this._paletteRow('Formation');
    this.formBtns = FORMATIONS.map((f) =>
      this._cmd(this.formRow.btns, f.label, f.key, 'formation', f.id));

    palette.append(this.stanceRow.root, this.formRow.root);
    this.selBlock.appendChild(palette);
    this.palette = palette;

    /* The three verbs that have nothing to do with the selection stay in the
       centre. Three items on one line is not a panel and does not box in the
       void; the 470×340 grid that used to live beside them did. */
    const util = el('div', 'vsh-palette__util');
    this.sensorBtn = this._cmd(util, 'Sensors', 'Tab', 'util', 'sensors');
    this.focusBtn = this._cmd(util, 'Focus', 'F', 'util', 'focus');
    this.helpBtn = this._cmd(util, 'Keys', 'H', 'util', 'help');
    midCol.appendChild(util);

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

    /* Straight from `core/input.js`, so the card cannot drift from the
       handlers — every row it publishes is printed, including the four order
       verbs and the shift-to-queue modifier. There is deliberately no filter
       here: one used to suppress the queue row while the sim discarded the
       flag, and it outlived both the bug and the wording it matched on, which
       is the failure mode any such list has. If a control genuinely does not
       work, take it out of `CONTROL_SCHEME`, where the handler can be seen
       next to it. */
    const hGrid = el('div', 'vsh-help__grid');
    this.helpGrid = hGrid;
    this._fillControlGrid();

    /* ------------------------------------------------------------- audio */
    /* Above the reference grid, not inside it.

       As a column it flowed last in a newspaper layout of thirty-seven
       read-only rows, and below 1280x720 that put it entirely under the fold
       of a scroll box with no affordance — measured at 1280x720 and 1024x640.
       It is also the only thing on this card a player can actually operate,
       so it reads as a settings bank rather than another list. */
    const audio = el('section', 'vsh-audio');
    const aHead = el('div', 'vsh-audio__head');
    aHead.appendChild(el('p', 'vsh-help__grp', 'Audio'));
    this.muteBtn = el('button', 'vsh-audio__mute', 'Sound on');
    this.muteBtn.type = 'button';
    this.muteBtn.setAttribute('aria-pressed', 'false');
    aHead.appendChild(this.muteBtn);
    audio.appendChild(aHead);

    const bank = el('div', 'vsh-audio__bank');
    this.audioSliders = AUDIO_BUSES.map(([id, label, dflt]) => {
      const row = el('div', 'vsh-audio__row');
      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'vsh-audio__slider';
      input.min = '0';
      input.max = '1';
      input.step = '0.02';
      input.value = String(dflt);
      input.dataset.bus = id;
      input.setAttribute('aria-label', `${label} volume`);
      row.append(el('span', 'vsh-audio__k', label), input);
      bank.appendChild(row);
      return { id, input };
    });
    audio.appendChild(bank);

    this.audioNote = el('p', 'vsh-audio__note', 'This browser is not giving us an audio device.');
    this.audioNote.hidden = true;
    audio.appendChild(this.audioNote);
    this.audioPanel = audio;

    hInner.append(hHead, hLede, audio, hGrid);
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

    /* The end-of-match card used to be built here. It moved to `ui/shell.js`
       when the shell took ownership of the game lifecycle: it needs the three
       `sim:gameOver` reasons in plain English and a "Play again" that rebuilds
       the world in place, and neither is the HUD's business. */
  }

  /* The standing objective readout.

     `sim/economy.js` has run a seam-control tug-of-war and `sim/world.js` a
     sovereignty clock since they were written, and neither has ever appeared
     on screen. A second victory condition the player cannot see is not a
     victory condition — it is the game ending for a reason nobody can name.

     Three things, in the one gap the top bar had left: what the objective is
     right now in a sentence, how close each side is to losing, and how much of
     the contested band is actually yours. Styling lives in `styles/shell.css`
     because `styles/hud.css` is not this lane's file; the class names stay in
     this module's namespace so it can move back in one paste. */
  /* Rebuilt, not built once.

     `CONTROL_SCHEME` is derived from the live binding table in `core/input.js`
     and is rebuilt in place whenever a key is rebound. Printing it a single
     time at construction meant the card kept naming the old key for the rest
     of the session — measured showing `S` while the binding was already
     `KeyK`. It was correct again on the next reload, which is exactly the kind
     of defect that survives casual testing. Re-run on `options:changed`. */
  _fillControlGrid() {
    const grid = this.helpGrid;
    if (!grid) return;
    grid.textContent = '';
    for (const block of CONTROL_SCHEME) {
      const rows = block.rows;
      if (!rows.length) continue;
      const col = el('section', 'vsh-help__col');
      col.appendChild(el('p', 'vsh-help__grp', block.group));
      for (const [k, d] of rows) {
        const row = el('div', 'vsh-help__row');
        row.append(el('span', 'vsh-help__k', k), el('span', 'vsh-help__d', d));
        col.appendChild(row);
      }
      grid.appendChild(col);
    }
  }

  _buildObjective() {
    const wrap = el('div', 'vsh-obj');
    wrap.setAttribute('aria-live', 'off');
    wrap.append(el('span', 'vsh-obj__k', 'Objective'));
    this.objLine = el('span', 'vsh-obj__line', 'Take their Mothership, or take the middle.');
    wrap.appendChild(this.objLine);

    const meters = el('div', 'vsh-obj__meters');
    const meter = (side, label) => {
      const m = el('div', `vsh-obj__m vsh-obj__m--${side}`);
      m.append(el('span', 'vsh-obj__mk', label));
      const bar = el('div', 'vsh-obj__bar');
      const fill = el('i', 'vsh-obj__fill');
      bar.appendChild(fill);
      const n = el('span', 'vsh-obj__n vsh-num', '100');
      m.append(bar, n);
      m.setAttribute('aria-label', `${label} sovereignty`);
      meters.appendChild(m);
      return { root: m, fill, n };
    };
    this.objUs = meter('us', 'You');
    this.objThem = meter('them', 'Them');
    this.objSeams = el('span', 'vsh-obj__seams', '');
    meters.appendChild(this.objSeams);
    wrap.appendChild(meters);
    this.objEl = wrap;
    return wrap;
  }

  /* MM:SS of sim time, plus one piece of state the number alone cannot carry:
     whether the sovereignty clock has started yet. The briefing tells the
     player the opening is safe and the objective sentence counts it down, but
     that sentence is the first thing the top bar drops on a narrow viewport —
     so the tick beside the clock is the readout that survives to 1024. */
  _refreshClock() {
    if (!this.statClock) return;
    const w = this.world;
    const t = w && typeof w.time === 'number' && Number.isFinite(w.time) ? w.time : 0;
    const s = Math.max(0, Math.floor(t));
    const text = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    if (text !== this._clockShown) {
      this._clockShown = text;
      this.statClock.value.textContent = text;
    }
    const grace = t < this._objGrace() && !this._sovDraining();
    if (grace !== this._clockGrace) {
      this._clockGrace = grace;
      this.statClock.root.classList.toggle('is-grace', grace);
      this.statClock.root.setAttribute(
        'title',
        grace
          ? 'Elapsed match time. Nothing drains yet — the sovereignty clock has not started.'
          : 'Elapsed match time. The sovereignty clock is running.',
      );
    }
  }

  _sovDraining() {
    const teams = this.world && this.world.teams;
    if (!teams || teams.length < 2) return false;
    for (let i = 0; i < teams.length; i++) {
      if (num(teams[i] && teams[i].sovereignty, 100) < 99.99) return true;
    }
    return false;
  }

  /* Grace period before the sovereignty clock starts, mirrored from
     `SOVEREIGNTY_GRACE` in `sim/world.js`, which does not export it. The
     readout stops trusting this the moment it sees real drain, so a drift in
     the sim shows up as an early switch to "draining" rather than as a lie. */
  _objGrace() {
    return 240;
  }

  _refreshObjective() {
    if (!this.objEl) return;
    const w = this.world;
    const teams = w && w.teams;
    if (!teams || teams.length < 2) return;

    const us = teams[this.team];
    const them = teams[this.team ^ 1];
    if (!us || them === undefined) return;

    const sovUs = num(us.sovereignty, 100);
    const sovThem = num(them.sovereignty, 100);
    const seamsUs = num(us.seams, 0);
    const seamsThem = num(them.seams, 0);
    const total = num(w.contestedSeams, seamsUs + seamsThem);

    if (!this._objLive) {
      this._objLive = true;
      this.objEl.classList.add('is-live');
    }

    this.objUs.fill.style.transform = `scaleX(${(sovUs / 100).toFixed(3)})`;
    this.objThem.fill.style.transform = `scaleX(${(sovThem / 100).toFixed(3)})`;
    const nUs = String(Math.ceil(sovUs));
    const nThem = String(Math.ceil(sovThem));
    if (this.objUs.n.textContent !== nUs) this.objUs.n.textContent = nUs;
    if (this.objThem.n.textContent !== nThem) this.objThem.n.textContent = nThem;
    this.objUs.root.classList.toggle('is-alert', sovUs <= 25);

    const seamText = total > 0 ? `Seams ${seamsUs}/${total}` : '';
    if (this.objSeams.textContent !== seamText) {
      this.objSeams.replaceChildren();
      if (total > 0) {
        this.objSeams.append(
          document.createTextNode('Seams '),
          el('b', null, String(seamsUs)),
          document.createTextNode(`/${total}`),
        );
      }
    }

    const t = num(w.time, 0);
    const drained = sovUs < 99.99 || sovThem < 99.99;
    const left = Math.max(0, this._objGrace() - t);
    let line;
    if (!drained && left > 0) {
      const mm = Math.floor(left / 60);
      const ss = String(Math.floor(left % 60)).padStart(2, '0');
      line = `Sovereignty clock starts in ${mm}:${ss} — take the middle before it does`;
    } else if (seamsUs > seamsThem) {
      line = 'You hold the middle · their sovereignty is draining';
    } else if (seamsThem > seamsUs) {
      line = 'They hold the middle · your sovereignty is draining';
    } else {
      line = 'The middle is level · take a seam, or take their Mothership';
    }
    if (this.objLine.textContent !== line) this.objLine.textContent = line;
    this.objEl.setAttribute(
      'title',
      `Win by destroying their Mothership, by draining their sovereignty to zero, `
        + `or by breaking their fleet entirely. Your sovereignty ${nUs}%, theirs ${nThem}%.`,
    );
  }

  /* Drawn rather than typed: a glyph font would be a binary asset, and "MUTE"
     as a word reads as a button you press to mute rather than a state you are
     in. The cone is always there and the two arcs cross-fade to a slash, so the
     shape changes silhouette at a glance and does not depend on colour alone. */
  _buildMuteGlyph() {
    const NS = 'http://www.w3.org/2000/svg';
    const b = el('button', 'vsh-mute');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', 'Mute all sound (M)');

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const cone = document.createElementNS(NS, 'path');
    cone.setAttribute('d', 'M4 9.5h3.6L12 5.4v13.2L7.6 14.5H4z');
    cone.setAttribute('class', 'vsh-mute__cone');
    svg.appendChild(cone);

    const waves = document.createElementNS(NS, 'g');
    waves.setAttribute('class', 'vsh-mute__waves');
    for (const d of ['M15.4 9.1a4.1 4.1 0 0 1 0 5.8', 'M18 6.5a7.8 7.8 0 0 1 0 11']) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      waves.appendChild(p);
    }
    svg.appendChild(waves);

    const slash = document.createElementNS(NS, 'g');
    slash.setAttribute('class', 'vsh-mute__slash');
    for (const d of ['M15.6 9.6l5.2 5.2', 'M20.8 9.6l-5.2 5.2']) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      slash.appendChild(p);
    }
    svg.appendChild(slash);

    b.appendChild(svg);
    /* A live region rather than a tooltip: a screen reader has to be told the
       sound went off, and `aria-pressed` alone is only read on focus. */
    this.muteState = el('span', 'vsh-sr', 'Sound on');
    this.muteState.setAttribute('aria-live', 'polite');
    b.appendChild(this.muteState);
    this.muteGlyph = b;
    return b;
  }

  _stat(parent, label, value) {
    const s = el('div', 'vsh-stat');
    s.append(el('span', 'vsh-stat__k', label));
    const v = el('span', 'vsh-stat__v vsh-num', value);
    s.appendChild(v);
    parent.appendChild(s);
    return { root: s, value: v };
  }

  /* A labelled row whose buttons wrap on their own column rather than under
     the label — six formation names do not fit beside a caption at 1280. */
  _paletteRow(label) {
    const root = el('div', 'vsh-palette__row');
    root.append(el('span', 'vsh-palette__k', label));
    const btns = el('div', 'vsh-palette__btns');
    root.appendChild(btns);
    return { root, btns };
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
    on('sim:gameOver', () => this._onGameOver());
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
    /* A rebind changes what this card should say. `core/input.js` emits
       `bindings.<action>` for a single rebind and a bare `bindings` for a
       reset to defaults, so match the prefix and take both. */
    on('options:changed', (p) => {
      const key = p && p.key;
      if (typeof key === 'string' && key.indexOf('bindings') === 0) {
        this._fillControlGrid();
      }
    });
    on('ui:progress', (p) => p && this.setLoadProgress(p.value, p.label));
    on('ui:ready', (p) => {
      if (p && p.seed !== undefined) this.seed = p.seed;
      this.finishLoading();
    });

    this._onClick = (ev) => this._click(ev);
    this.root.addEventListener('click', this._onClick);

    this._onSlide = (ev) => {
      const t = ev.target;
      if (!t || !t.dataset || !t.dataset.bus) return;
      bus.emit('ui:audioVolume', { bus: t.dataset.bus, value: Number(t.value) });
      this._expectAudioReply();
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
    if (t.closest('.vsh-boot__skip')) {
      this.skipIntro();
      return;
    }
    if (t.closest('.vsh-onboard__skip')) {
      this._obRetire();
      return;
    }
    if (t.closest('.vsh-audio__mute') || t.closest('.vsh-mute')) {
      /* Before the mixer has heard from AudioSystem the HUD does not know the
         true state — a preference persisted from a previous session may say
         muted while this thinks otherwise. The payload-free form of the event
         is a toggle, which lets the system that owns the truth answer. */
      if (this._audioConfirmed) bus.emit('ui:audioMute', { muted: !this._muted });
      else bus.emit('ui:audioMute');
      this._expectAudioReply();
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
     reveals the panel — no audio system, no mixer.

     A system that reports `available: false` still gets the panel, greyed and
     labelled: a browser that refuses to give us an AudioContext is a fact the
     player is entitled to, and a silent game with no explanation reads as a
     bug in ours. Controls that cannot do anything are disabled rather than
     left live, which is the part that would actually be worse than nothing. */
  _syncAudio(s) {
    if (!s || typeof s !== 'object') return;
    this._revealAudio();
    /* Anything with a bus level in it came from a live AudioSystem, so the
       optimistic reveal is now confirmed and the probe can stand down. A
       `{ available: false }` from the probe itself must not confirm. */
    if (typeof s.master === 'number') {
      this._audioConfirmed = true;
      if (this._audioProbe) {
        clearTimeout(this._audioProbe);
        this._audioProbe = null;
      }
    }

    const off = s.available === false;
    if (off !== this._audioOff) {
      this._audioOff = off;
      this.audioPanel.classList.toggle('is-unavailable', off);
      this.audioNote.hidden = !off;
      this.muteBtn.disabled = off;
      this.muteGlyph.disabled = off;
      this.muteGlyph.classList.toggle('is-unavailable', off);
      for (const sl of this.audioSliders) sl.input.disabled = off;
    }
    if (off) {
      this.muteGlyph.setAttribute('aria-label', 'Audio unavailable in this browser');
      this.muteState.textContent = 'No audio device';
      return;
    }

    this._muted = !!s.muted;
    this.muteBtn.setAttribute('aria-pressed', String(this._muted));
    this.muteBtn.textContent = this._muted ? 'Muted' : 'Sound on';
    this.audioPanel.classList.toggle('is-muted', this._muted);
    this.muteGlyph.setAttribute('aria-pressed', String(this._muted));
    this.muteGlyph.setAttribute('aria-label',
      this._muted ? 'Unmute all sound (M)' : 'Mute all sound (M)');
    this.muteGlyph.classList.toggle('is-muted', this._muted);
    this.muteState.textContent = this._muted ? 'Sound muted' : 'Sound on';
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
    this.selBlock.classList.toggle('is-live', live);
    this.stanceRow.root.classList.toggle('is-live', live);
    this.formRow.root.classList.toggle('is-live', live);
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

  /* Where the opaque panels are, in root-relative CSS pixels.

     The Sensors Manager is one canvas laid over another, so it cannot know what
     is on top of it — and it was drawing blips and ore-field circles underneath
     the production list, which reads as a rendering bug rather than as a panel.
     It insets its chart by these rects instead.

     Only the two blocks with their own scrim are reported. The palette and the
     toast rail are hairline type over the void with nothing behind them, and
     cutting the lattice around those would invent an edge where there is none.
     `getBoundingClientRect` is not cheap enough for a per-frame call, so this is
     re-measured on a slow cadence and whenever the layout changes. */
  _panelRects() {
    const now = performance.now();
    if (this._rectsAt !== undefined && now - this._rectsAt < 250) return this._rects;
    this._rectsAt = now;
    const out = this._rects || (this._rects = []);
    out.length = 0;
    const base = this.root.getBoundingClientRect();
    for (const node of [this.build && this.build.el, this.selBlock]) {
      if (!node || !node.classList.contains('is-live')) continue;
      const r = node.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      /* Grown by the local scrim, which is what actually darkens the void
         behind the panel — the element box alone leaves marks sitting on the
         gradient's shoulder. */
      out.push({
        x: r.left - base.left - 18,
        y: r.top - base.top - 14,
        w: r.width + 40,
        h: r.height + 40,
      });
    }
    return out;
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
    this._fleetHulls = hulls;
    this._refreshClock();
    this._refreshObjective();

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
    const tone = kind ? TOAST_KINDS[kind] : '';
    const alert = tone === 'alert';
    const t = {
      el: el('div', `vsh-toast${tone ? ` vsh-toast--${tone}` : ''}`, String(text)),
      life: alert ? TOAST_LIFE_ALERT : TOAST_LIFE,
      alert,
    };
    // Polite for status, assertive for trouble — the toast rail is one live
    // region, so the urgent ones have to say so on the row itself.
    if (alert) t.el.setAttribute('role', 'alert');
    this.toastEl.appendChild(t.el);
    this._toasts.push(t);
    // One frame later, so the transition has something to run from.
    requestAnimationFrame(() => t.el.classList.add('is-live'));
    /* Over the cap, the oldest ordinary line goes first and trouble goes last.
       Otherwise the degraded-boot warning is the very thing evicted by the
       five routine "hull ready" notices that follow it. */
    while (this._toasts.length > MAX_TOASTS) {
      let i = this._toasts.findIndex((x) => !x.alert);
      if (i < 0) i = 0;
      this._toasts.splice(i, 1)[0].el.remove();
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

  /* The end-of-match card belongs to `ui/shell.js` now — it is the lifecycle
     owner, it has the three plain-English endings and it is what "Play again"
     has to talk to in order to rebuild without a page reload. All the HUD does
     here is retire the first-run rail and freeze the numbers it has been
     accumulating so `matchStats()` reports the state at the whistle rather
     than whatever the world has decayed to by the time the card is read. */
  _onGameOver() {
    if (this._overOpen) return;
    this._overOpen = true;
    this._obRetire();
    this._final = this.matchStats();
  }

  /**
   * Everything the end-of-match screen needs, in one plain object. Public
   * because the shell owns that screen and this module owns the counters.
   */
  matchStats() {
    if (this._final) return this._final;
    const mine = [];
    for (const e of this.ctx.entities()) {
      if (e.alive !== false && e.team === this.team) mine.push(e);
    }
    /* Sim time, not wall-clock. A match that spent four minutes in the pause
       menu did not last four minutes longer, and `world.time` only advances on
       ticks the loop actually ran. */
    const simTime = this.world && typeof this.world.time === 'number' ? this.world.time : null;
    const duration = simTime !== null
      ? simTime
      : Math.max(0, (performance.now() - this._stats.start) / 1000);
    return {
      built: this._stats.built,
      losses: this._stats.lost,
      kills: this._stats.kills,
      harvested: Math.round(this._stats.earned),
      fleetHulls: mine.length,
      fleetValue: totalFleetValue(mine),
      duration,
    };
  }

  /**
   * Close whatever the HUD has open, topmost first. Returns true if something
   * was closed. `ui/shell.js` calls this before it opens the pause menu, which
   * is the whole of the Escape arbitration the contract asks for.
   */
  closeOverlays() {
    if (this._helpOpen) {
      this.setHelp(false);
      return true;
    }
    if (this.sensors && this.sensors.open) {
      this._setSensors(false, false);
      return true;
    }
    return false;
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
    this.root.removeEventListener('click', this._onClick);
    this.audioPanel.removeEventListener('input', this._onSlide);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    if (this._bootTimer) clearTimeout(this._bootTimer);
    if (this._audioProbe) clearTimeout(this._audioProbe);

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
    this.audio = null;   // never outlive the AudioSystem we were handed
  }
}

export default HUD;
