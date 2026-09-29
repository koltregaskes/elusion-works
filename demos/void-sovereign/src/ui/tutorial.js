import { bus } from '../core/events.js';
import { CONTROL } from '../sim/economy.js';
import { installCodex } from './codex.js';

/* The tutorial — staged objectives inside a real match.

   Kol's report was two sentences and they are the whole brief: *"I need a mini
   tutorial. Is there one there?"* and *"It went straight into a game and I
   didn't quite understand what I'm doing."* `CRITIQUE-RUBRIC.md` §3.7/O1 gives
   the target — a total novice selects something, moves it and understands the
   goal inside sixty seconds — and §6/G5 names the failure mode we are not
   allowed to ship: dumping the whole control scheme at once, which is what the
   H card is for once you *want* it.

   Three rules the implementation is built around:

   1. **Every step is ticked by the thing it asked for actually happening.**
      There is no Next button. Detection is off the canonical bus events in
      ARCHITECTURE §2 — `sel:changed`, `cmd:move`, `cmd:attackMove`,
      `cmd:stance`, `cmd:build`, `ui:speed`, `ui:sensorsToggle` — plus two
      things no event carries: camera motion, sampled off the live camera, and
      standing on a contested seam, read off the world. An instruction you can
      dismiss without doing is a walkthrough, not a tutorial.

   2. **Out of order is not wrong.** Satisfaction is recorded per step
      regardless of which step is showing, and the rail then skips forward over
      everything already done. A player who pauses before they select anything,
      or opens the codex first, must never be told to do a thing they have
      already done — and must never be able to wedge the rail by doing them in
      an order nobody predicted. This is the single most likely soft-lock in a
      staged tutorial and it is designed out rather than tested for.

   3. **It is skippable and replayable.** One button, always visible, and a
      `tutorial` panel on the shell so it can be run again deliberately.

   Emits `tutorial:step { index, id, done }` and `tutorial:complete { skipped }`
   per SHELL-CONTRACT.md. Owns nothing outside `src/ui/tutorial.js`,
   `src/ui/codex.js` and `styles/tutorial.css`. */

const STORE_KEY = 'vs.tutorial.v1';

/* The HUD ships its own three-step first-run rail (`.vsh-onboard`, keyed on
   `vs.onboarded.v1`). It teaches select / order / build — the first three
   things this does, in the band of the screen directly above this rail. Two
   tutorials at once is worse than either. `hud.js` is shared and contended, so
   this retires the rail the way the player would: by setting the flag it reads
   and adding the class it uses. */
const HUD_ONBOARD_KEY = 'vs.onboarded.v1';

/** Seconds on one step before the rail offers a stronger hint. */
const NUDGE_AFTER = 26;

/** How long the completion card stays up before retiring itself. */
const OUTRO_LIFE = 26;

/* Camera motion thresholds.

   Cumulative rather than measured against a fixed baseline, because the
   baseline version was index-gated — it only sampled while the camera step was
   the live one — and that is exactly the out-of-order soft-lock this file is
   supposed to be immune to. A player who orbits during step one has looked
   around, and the rail has to know it.

   Totals are summed per frame with a noise floor under them, so a settled rig
   contributes nothing at all and cannot creep over the line while the player
   does something else. One wheel notch is ln-distance 0.16, so the zoom total
   fires comfortably inside a single notch. */
const CAM_ROT = 0.06;      // summed |Δyaw| + |Δpitch|, radians — about 3.4°
const CAM_ZOOM = 0.10;     // summed |Δ ln(distance)|
const CAM_PAN = 0.05;      // summed focus travel, as a fraction of distance
const CAM_NOISE_ROT = 1e-5;
const CAM_NOISE = 1e-5;

/* ------------------------------------------------------------------ helpers */

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
    /* no store, no memory — the tutorial simply offers itself again next time */
  }
}

function clearFlag(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    /* ignore */
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

/** Inject our own stylesheet: `index.html` belongs to Lane A. */
function ensureStyles() {
  if (typeof document === 'undefined') return;
  const href = new URL('../../styles/tutorial.css', import.meta.url).href;
  if (document.querySelector(`link[data-vs-tutorial]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-vs-tutorial', '');
  document.head.appendChild(link);
}

/* -------------------------------------------------------------------- steps */

/* Numbers inside the copy are read from the modules that own them, never
   typed. `CONTROL.CAPTURE` is the seam capture time; if the balance moves, the
   sentence moves with it. */
const CAPTURE_S = Math.round(CONTROL.CAPTURE);

const STEPS = [
  {
    id: 'select',
    title: 'Take hold of a wing',
    text:
      'The Pale Meridian is one Mothership and whatever it can build. Start by ' +
      'picking something up: left-click a ship, or drag a box across several.',
    keys: ['Left click', 'Left drag'],
    nudge: 'Your ships are the cold, cyan-lit ones. Drag a box over a few of them.',
  },
  {
    id: 'move',
    title: 'Send them somewhere',
    text:
      'Right-click a point in the void. Keep the button down and drag up or ' +
      'down to set the altitude — nothing here is flat.',
    keys: ['Right click', 'Right drag = altitude'],
    nudge: 'Right-click anywhere in open space. The disc and stalk show where they are going.',
  },
  {
    id: 'camera',
    title: 'Look around',
    text:
      'Wheel to zoom, middle-drag to orbit, F to frame whatever you have ' +
      'selected. The playable volume is sixty kilometres across and the camera ' +
      'is the only way to see it.',
    keys: ['Wheel', 'Middle drag', 'F'],
    nudge: 'Roll the mouse wheel. Zoom is exponential, so it will not crawl.',
  },
  {
    id: 'pause',
    title: 'Stop time',
    text:
      'Press Space. The simulation genuinely freezes — and every order you give ' +
      'while it is frozen is obeyed the moment it resumes. Nothing in this game ' +
      'has to be clicked in a hurry.',
    keys: ['Space', '+ / − for speed'],
    nudge: 'Press Space. Press it again to let the battle run on.',
  },
  {
    id: 'attackMove',
    title: 'Advance under arms',
    text:
      'Press A to attack-move to the cursor. The wing goes where you point and ' +
      'fights whatever it meets on the way, instead of flying past it.',
    keys: ['A', 'G to guard', 'S to stop'],
    nudge: 'Keep some ships selected, point at open space and press A.',
  },
  {
    id: 'stance',
    title: 'Tell them how to fight',
    text:
      'Z evasive, X neutral, C aggressive. Stance is mechanical, not flavour: ' +
      'it changes how far a ship scans, how far it will chase, and how early it ' +
      'opens fire.',
    keys: ['Z', 'X', 'C'],
    nudge: 'With ships selected, press C to set them aggressive.',
  },
  {
    id: 'build',
    title: 'Open the yards',
    text:
      'Select your Mothership and queue a hull from the production menu, bottom ' +
      'right. Credits and population are committed the moment you queue it, so ' +
      'the yards can never promise a fleet the treasury cannot pay for.',
    keys: ['Click the Mothership'],
    nudge: 'The Mothership is the largest hull on your side. Click it, then click a class to build.',
  },
  {
    id: 'counters',
    title: 'Learn what beats what',
    text:
      'Open the Codex. Every class has one job and one thing that kills it — ' +
      'flak shreds a fighter wing and barely marks a capital; an ion lance opens ' +
      'a capital and cannot track a fighter at all. The whole roster is in there, ' +
      'with the multipliers the damage code actually applies.',
    keys: ['Codex'],
    nudge: 'The Codex button is at the bottom of this rail.',
  },
  {
    id: 'seam',
    title: 'Take the middle',
    text:
      'The contested seams straddle the midline — richest ground on the field ' +
      'and the least defensible. Send warships to one. Presence is armed hulls ' +
      `weighed by what they cost, and about ${CAPTURE_S} seconds of unopposed ` +
      'presence takes a neutral seam. Collectors do not take ground.',
    keys: ['Right click a contested seam'],
    nudge: 'Zoom out and look for the asteroid clusters halfway between the two fleets.',
  },
  {
    id: 'sensors',
    title: 'See the whole field',
    text:
      'Press Tab for the sensors manager: every contact, every seam, and who ' +
      'holds it — and you can select and give orders from inside it without ' +
      'coming back out.',
    keys: ['Tab'],
    nudge: 'Press Tab. Press it again to drop back to the tactical view.',
  },
];

/* The three endings, in plain English, shown on the completion card and again
   in the codex. Kept identical in both places by living here. */
const VICTORY = [
  ['Base', 'Their Mothership dies. The fastest ending, when you can take it.'],
  [
    'Sovereignty',
    'Both sides start at 100%. Hold more of the contested band than they do and ' +
      'theirs drains. At zero, the field is yours — whatever the kill ratio said.',
  ],
  [
    'Attrition',
    'No yards, no collectors, nothing left to rebuild with. The result is called ' +
      'rather than making you hunt the last hauler across an empty map.',
  ],
];

/* ------------------------------------------------------------------ the rail */

export class Tutorial {
  /**
   * @param {object} opts
   * @param {object} [opts.codex]  handle from `installCodex()`
   * @param {() => object|null} [opts.getVS] accessor for `window.__VS`
   */
  constructor(opts = {}) {
    this.getVS = opts.getVS || (() => window.__VS || null);
    this.codex = opts.codex || null;

    this.active = false;
    this.finished = false;
    this.index = 0;
    this.done = Object.create(null);

    this._offs = [];
    this._raf = 0;
    this._last = 0;
    this._stepAge = 0;
    this._announced = -1;
    this._outro = 0;
    this._cam = null;
    this._camRot = 0;
    this._camZoom = 0;
    this._camPan = 0;
    this._pollAcc = 0;
    this._retireTimer = 0;

    this.root = null;
    this._built = false;
  }

  /* ------------------------------------------------------------------ DOM */

  _build() {
    if (this._built) return;
    this._built = true;
    ensureStyles();

    const root = el('div', 'vst-root');
    root.id = 'vs-tutorial-root';

    const card = el('aside', 'vst-card');
    card.setAttribute('aria-label', 'Tutorial');
    card.hidden = true;

    const head = el('div', 'vst-card__head');
    this.elLabel = el('p', 'vst-k', 'First command');
    this.elCount = el('span', 'vst-card__count', '');
    head.append(this.elLabel, this.elCount);

    this.elTrack = el('div', 'vst-track');
    this.elTicks = STEPS.map(() => {
      const t = el('i', 'vst-track__t');
      this.elTrack.appendChild(t);
      return t;
    });

    const body = el('div', 'vst-body');
    /* Polite, not assertive: the rail must narrate progress to a screen reader
       without interrupting the toast channel mid-battle. */
    body.setAttribute('aria-live', 'polite');
    this.elTitle = el('h3', 'vst-step__title', '');
    this.elText = el('p', 'vst-step__text', '');
    this.elKeys = el('ul', 'vst-keys');
    this.elNudge = el('p', 'vst-step__nudge', '');
    this.elNudge.hidden = true;
    this.elList = el('ol', 'vst-list');
    this.elWin = el('dl', 'vst-win');
    this.elWin.hidden = true;
    body.append(this.elTitle, this.elText, this.elKeys, this.elNudge, this.elWin, this.elList);

    for (const [k, v] of VICTORY) {
      const r = el('div', 'vst-win__r');
      r.append(el('dt', 'vst-win__k', k), el('dd', 'vst-win__v', v));
      this.elWin.appendChild(r);
    }

    this.elRows = STEPS.map((s, i) => {
      const li = el('li', 'vst-list__r');
      li.append(el('span', 'vst-list__m', String(i + 1)), el('span', null, s.title));
      this.elList.appendChild(li);
      return li;
    });

    const actions = el('div', 'vst-actions');
    this.btnCodex = el('button', 'vst-btn vst-btn--go', 'Codex');
    this.btnCodex.type = 'button';
    this.btnCodex.addEventListener('click', () => {
      if (this.codex) this.codex.open();
      /* Belt and braces: the codex handle announces its own opens, but if a
         shell declined the transition the player still pressed the button and
         still asked the question. Do not leave them staring at a step that
         will not tick. */
      this._satisfy('counters');
    });

    this.btnSkip = el('button', 'vst-btn vst-btn--skip', 'Skip');
    this.btnSkip.type = 'button';
    this.btnSkip.addEventListener('click', () => this.skip());

    actions.append(this.btnCodex, this.btnSkip);
    card.append(head, this.elTrack, body, actions);
    root.appendChild(card);
    document.body.appendChild(root);

    this.root = root;
    this.card = card;
  }

  /* --------------------------------------------------------------- control */

  /** Begin. `replay` clears a previous completion so the rail runs again. */
  start(opts = {}) {
    if (this.active) return false;
    if (typeof document === 'undefined') return false;
    this._build();

    this.active = true;
    this.finished = false;
    this.index = 0;
    this.done = Object.create(null);
    this._announced = -1;
    this._stepAge = 0;
    this._outro = 0;
    this._camRot = 0;
    this._camZoom = 0;
    this._camPan = 0;
    this._cam = null;

    if (opts.replay) clearFlag(STORE_KEY);

    /* A replay can land inside the outro's retire timer. Cancel it, or the
       card the player just asked for hides itself half a second later. */
    if (this._retireTimer) clearTimeout(this._retireTimer);
    this._retireTimer = 0;

    this.elWin.hidden = true;
    this.elKeys.hidden = false;
    this.elTrack.hidden = false;
    this.elList.hidden = false;
    this.btnSkip.textContent = 'Skip';
    this.elLabel.textContent = 'First command';
    this.card.classList.remove('vst-done');
    this.card.hidden = false;
    /* Two frames of "hidden then live" so the fade actually plays. */
    requestAnimationFrame(() => {
      if (this.card) this.card.classList.add('is-live');
    });

    this._retireHudRail();
    this._listen();
    this._pump(true);
    this._tick(performance.now());
    return true;
  }

  skip() {
    if (!this.active) return;
    this._finish(true);
  }

  /** Tear the rail down without claiming completion — used by `dispose`. */
  stop() {
    this._unlisten();
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this.active = false;
    if (this.card) {
      this.card.classList.remove('is-live');
      this.card.hidden = true;
    }
  }

  dispose() {
    this.stop();
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
    this._built = false;
  }

  /** Progress, for a panel or a harness. */
  get state() {
    return {
      active: this.active,
      finished: this.finished,
      index: this.index,
      total: STEPS.length,
      id: this.index < STEPS.length ? STEPS[this.index].id : null,
      done: STEPS.filter((s) => this.done[s.id]).map((s) => s.id),
    };
  }

  /* ------------------------------------------------------------- detection */

  _listen() {
    this._unlisten();
    const on = (type, fn) => this._offs.push(bus.on(type, fn));
    const team = () => {
      const vs = this.getVS();
      const w = vs && vs.world;
      return w && w.humanTeam !== undefined ? w.humanTeam : 0;
    };

    on('sel:changed', (p) => {
      if (p && p.ids && p.ids.length) this._satisfy('select');
    });

    on('cmd:move', (p) => {
      this._satisfy('move');
      this._checkSeamOrder(p);
    });
    on('cmd:attackMove', (p) => {
      this._satisfy('attackMove');
      this._checkSeamOrder(p);
    });
    /* An explicit attack order is the same lesson as attack-move — commit the
       wing to a fight — and refusing to accept it would strand a player who
       right-clicked a hostile instead of pressing A. */
    on('cmd:attack', () => this._satisfy('attackMove'));
    on('cmd:guard', (p) => this._checkSeamOrder(p));
    on('cmd:patrol', (p) => this._checkSeamOrder(p));

    on('ui:speed', (p) => {
      if (p && p.scale === 0) this._satisfy('pause');
    });

    on('cmd:stance', () => this._satisfy('stance'));

    on('cmd:build', (p) => {
      if (!p || p.team === undefined || p.team === team()) this._satisfy('build');
    });
    on('sim:buildComplete', (p) => {
      if (p && p.team === team()) this._satisfy('build');
    });

    on('ui:sensorsToggle', (p) => {
      if (p && p.open) this._satisfy('sensors');
    });

    /* The camera step has no event to listen to — orbit, zoom and pan are
       handled entirely inside `core/camera.js` and nothing is emitted. F does
       reach the rig through `frameEntities`, which is also silent. So the
       camera is sampled in `_tick` instead; this is the one detector that is
       not a bus subscription, and it is still a genuine player action. */

    if (this.codex && typeof this.codex.onOpen === 'function') {
      this._offs.push(this.codex.onOpen(() => this._satisfy('counters')));
    }
  }

  _unlisten() {
    for (const off of this._offs) {
      try {
        off();
      } catch (e) {
        /* ignore */
      }
    }
    this._offs.length = 0;
  }

  /** True when an order point lands on the contested band. */
  _checkSeamOrder(p) {
    if (!p || !p.point) return;
    const vs = this.getVS();
    const world = vs && vs.world;
    const clusters = world && world.resourceClusters;
    if (!clusters || !clusters.length) return;
    const px = p.point.x;
    const py = p.point.y;
    const pz = p.point.z;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      if (!c || !c.contested || !c.position) continue;
      const rr = (c.radius || 0) + CONTROL.RADIUS;
      const dx = c.position.x - px;
      const dy = c.position.y - py;
      const dz = c.position.z - pz;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        this._satisfy('seam');
        return;
      }
    }
  }

  /**
   * Record a step as done, whenever it happens and whatever is on screen.
   *
   * This is the anti-soft-lock. Nothing here consults `this.index`, so a
   * player who pauses the game before selecting anything has simply completed
   * step four early — the rail will step over it when it gets there rather
   * than asking for it again.
   */
  _satisfy(id) {
    if (!this.active || this.finished) return;
    if (this.done[id]) return;
    this.done[id] = true;
    this._pump(false);
  }

  /* ---------------------------------------------------------------- render */

  _pump() {
    while (this.index < STEPS.length && this.done[STEPS[this.index].id]) {
      const s = STEPS[this.index];
      bus.emit('tutorial:step', { index: this.index, id: s.id, done: true });
      this.index++;
      this._stepAge = 0;
    }
    if (this.index >= STEPS.length) {
      this._finish(false);
      return;
    }
    if (this.index !== this._announced) {
      this._announced = this.index;
      this._stepAge = 0;
      const s = STEPS[this.index];
      bus.emit('tutorial:step', { index: this.index, id: s.id, done: false });
    }
    this._render();
  }

  _render() {
    if (!this._built || this.finished) return;
    const s = STEPS[this.index];
    if (!s) return;

    this.elCount.textContent = `${String(this.index + 1).padStart(2, '0')} / ${String(
      STEPS.length,
    ).padStart(2, '0')}`;
    this.elTitle.textContent = s.title;
    this.elText.textContent = s.text;

    this.elKeys.textContent = '';
    for (const k of s.keys || []) this.elKeys.appendChild(el('li', null, k));

    this.elNudge.hidden = true;

    for (let i = 0; i < this.elTicks.length; i++) {
      const t = this.elTicks[i];
      t.classList.toggle('is-done', !!this.done[STEPS[i].id]);
      t.classList.toggle('is-now', i === this.index);
    }
    for (let i = 0; i < this.elRows.length; i++) {
      const r = this.elRows[i];
      const isDone = !!this.done[STEPS[i].id];
      r.classList.toggle('is-done', isDone);
      r.classList.toggle('is-now', i === this.index);
      r.firstChild.textContent = isDone ? '✓' : String(i + 1);
    }
  }

  _finish(skipped) {
    if (this.finished) return;
    this.finished = true;
    this.active = false;
    this._unlisten();
    writeFlag(STORE_KEY);
    bus.emit('tutorial:complete', { skipped: !!skipped });

    if (!this._built) return;
    this.elLabel.textContent = skipped ? 'Tutorial skipped' : 'Command established';
    this.elCount.textContent = '';
    this.elTrack.hidden = true;
    this.elList.hidden = true;
    this.elKeys.hidden = true;
    this.elNudge.hidden = true;
    this.card.classList.add('vst-done');
    this.elTitle.textContent = skipped ? 'You are on your own, then' : 'You have the verbs';
    this.elText.textContent = skipped
      ? 'The Codex has the whole roster, the economy and the three ways this ends. ' +
        'The H card has every control.'
      : 'Three ways this ends. Everything else is where you choose to stand.';
    this.elWin.hidden = false;
    this.btnSkip.textContent = 'Dismiss';
    this._outro = OUTRO_LIFE;

    /* Keep the frame alive just long enough to retire the card, then stop. */
    if (!this._raf) this._tick(performance.now());
  }

  _retire() {
    this._outro = 0;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this.card) {
      this.card.classList.remove('is-live');
      const card = this.card;
      this._retireTimer = setTimeout(() => {
        this._retireTimer = 0;
        if (card && !this.active) card.hidden = true;
      }, 500);
    }
  }

  /* Retire the HUD's own three-step rail. See HUD_ONBOARD_KEY above. */
  _retireHudRail() {
    writeFlag(HUD_ONBOARD_KEY);
    const rail = document.querySelector('.vsh-onboard');
    if (rail) rail.classList.add('is-gone');
  }

  /* ------------------------------------------------------------------ tick */

  _tick(now) {
    this._raf = 0;
    const dt = this._last ? Math.min(0.25, (now - this._last) / 1000) : 0;
    this._last = now;

    if (this.finished) {
      if (this._outro > 0) {
        this._outro -= dt;
        if (this._outro <= 0) {
          this._retire();
          return;
        }
        this._raf = requestAnimationFrame((t) => this._tick(t));
      }
      return;
    }
    if (!this.active) return;

    this._stepAge += dt;
    const s = STEPS[this.index];
    if (s && s.nudge && this._stepAge > NUDGE_AFTER && this.elNudge.hidden) {
      this.elNudge.textContent = s.nudge;
      this.elNudge.hidden = false;
    }

    /* Sampled every frame, not only while the camera step is live. */
    this._sampleCamera();

    /* Six times a second is plenty for a state that changes over half a minute,
       and it keeps the rail off the frame budget. */
    this._pollAcc += dt;
    if (this._pollAcc > 0.16) {
      this._pollAcc = 0;
      this._pollWorld();
    }

    this._raf = requestAnimationFrame((t) => this._tick(t));
  }

  /**
   * Did the player move the camera?
   *
   * **Sampled off the rig's own state, never off `engine.camera`.** The rendered
   * camera is not the player's camera: `core/camera.js` adds handheld idle sway
   * after 1.15 s of no input and an impact shake on every `fx:blast`, both
   * written straight onto the camera position and roll in `_apply`. Watching
   * that would have ticked this step the first time anything exploded, which is
   * the same defect as a Next button wearing a disguise.
   *
   * The rig's `yaw`, `pitch`, `targetDistance` and `focusPoint` are all
   * deliberate-motion only — orbit, wheel, pan, F. Each is summed frame to
   * frame with a noise floor beneath it so a settled spring contributes an
   * exact zero and the totals cannot creep.
   */
  _sampleCamera() {
    const vs = this.getVS();
    const rig = vs && vs.cameraRig;
    const cam = vs && vs.engine && vs.engine.camera;
    if (!rig && !cam) return;

    const hasRig = rig && Number.isFinite(rig.yaw) && Number.isFinite(rig.targetDistance);
    const focus = hasRig ? rig.focusPoint : null;
    const dist = hasRig ? Math.max(1e-3, rig.targetDistance) : 0;

    /* Fallback for `main.js`'s minimal rig, which has no springs to read: the
       raw camera is all there is, and it has no sway or shake either. */
    const sample = hasRig
      ? {
          yaw: rig.yaw,
          pitch: rig.pitch,
          ln: Math.log(dist),
          fx: focus ? focus.x : 0,
          fy: focus ? focus.y : 0,
          fz: focus ? focus.z : 0,
          d: dist,
        }
      : {
          yaw: Math.atan2(cam.position.x, cam.position.z),
          pitch: 0,
          ln: 0,
          fx: cam.position.x,
          fy: cam.position.y,
          fz: cam.position.z,
          d: Math.max(1, cam.position.length()),
        };

    const b = this._cam;
    this._cam = sample;
    if (!b) return;

    const rot = Math.abs(sample.yaw - b.yaw) + Math.abs(sample.pitch - b.pitch);
    const zoom = Math.abs(sample.ln - b.ln);
    const dx = sample.fx - b.fx;
    const dy = sample.fy - b.fy;
    const dz = sample.fz - b.fz;
    /* Pan only means something relative to how far out we are — a metre of
       focus drift at 40 km is nothing, and at 400 m it is the whole frame. */
    const pan = b.d > 0 ? Math.sqrt(dx * dx + dy * dy + dz * dz) / b.d : 0;

    if (rot > CAM_NOISE_ROT) this._camRot += rot;
    if (zoom > CAM_NOISE) this._camZoom += zoom;
    if (pan > CAM_NOISE) this._camPan += pan;

    if (this._camRot > CAM_ROT || this._camZoom > CAM_ZOOM || this._camPan > CAM_PAN) {
      this._satisfy('camera');
    }
  }

  /** Things the bus does not say: seams held, and the game being over. */
  _pollWorld() {
    const vs = this.getVS();
    const world = vs && vs.world;
    if (!world || !world.teams) return;
    const me = world.humanTeam === undefined ? 0 : world.humanTeam;
    const t = world.teams[me];
    if (t && t.seams > 0) this._satisfy('seam');

    /* Some seeds place no genuinely contested cluster at all — `spawn.js`
       decides contestedness by how equidistant a cluster is from the two
       starts, so a lopsided field can produce none. Measured: a run on one of
       the shell's rolled seeds came back with `world.contestedSeams === 0`.
       Asking a player to stand on ground that does not exist is the one
       soft-lock a staged tutorial cannot argue its way out of, so the step
       retires itself before it is ever shown. */
    if (!this.done.seam) {
      const cl = world.resourceClusters;
      if (cl && cl.length) {
        let any = false;
        for (let i = 0; i < cl.length; i++) {
          if (cl[i] && cl[i].contested) {
            any = true;
            break;
          }
        }
        if (!any) this._satisfy('seam');
      }
    }

    /* A tutorial still asking for a stance change after the match has been
       decided is the definition of a rail that has lost the plot. */
    if (world.over) this._finish(true);
  }
}

/* ------------------------------------------------------------- installation */

/**
 * Wire the tutorial and the codex into whatever shell exists.
 *
 * Lane A's `window.__VS.shell` is built concurrently, so nothing here requires
 * it: both panels are registered the moment it appears and everything works
 * without it in the meantime. The poll is cheap, bounded, and stops the instant
 * it succeeds.
 */
export function installTutorial(opts = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const getVS = opts.getVS || (() => window.__VS || null);
  const codex = installCodex({ getWorld: () => (getVS() ? getVS().world : null) });
  const tutorial = new Tutorial({ getVS, codex });

  let panelRegistered = false;
  let started = false;
  let pollTimer = 0;
  let polls = 0;
  const offs = [];

  ensureStyles();

  function shell() {
    const vs = getVS();
    return vs && vs.shell && typeof vs.shell.registerPanel === 'function' ? vs.shell : null;
  }

  /** The `tutorial` panel: a place to run it again on purpose. */
  function registerPanel() {
    if (panelRegistered) return false;
    const sh = shell();
    if (!sh) return false;
    panelRegistered = true;
    try {
      sh.registerPanel({
        id: 'tutorial',
        title: 'Tutorial',
        where: ['title', 'pause'],
        order: 20,
        mount(container) {
          const wrap = el('div', 'vsc');
          wrap.append(
            el('p', 'vsc__eyebrow', 'Void Sovereign · Tutorial'),
            el('h2', 'vsc__title', 'Learn it by playing it'),
            el(
              'p',
              'vsc__lede',
              `${STEPS.length} objectives inside a real match, each one ticked off by ` +
                'doing it rather than by clicking Next. Skippable at any point, and ' +
                'it will not repeat itself if you get ahead of it.',
            ),
          );
          const list = el('ol', 'vsc__defs');
          for (const s of STEPS) {
            const d = el('div', 'vsc__def');
            d.append(el('dt', null, s.title), el('dd', null, s.text));
            list.appendChild(d);
          }
          const go = el('button', 'vsc__role', 'Run the tutorial');
          go.type = 'button';
          go.addEventListener('click', () => {
            const s = shell();
            if (s && typeof s.closePanel === 'function') {
              try {
                s.closePanel();
              } catch (e) {
                /* ignore */
              }
            }
            if (s && typeof s.resume === 'function' && s.state === 'paused') {
              try {
                s.resume();
              } catch (e) {
                /* ignore */
              }
            }
            tutorial.stop();
            tutorial.finished = false;
            tutorial.start({ replay: true });
          });
          const actions = el('div', 'vsc__roles');
          actions.appendChild(go);
          wrap.append(actions, list);
          container.appendChild(wrap);
        },
      });
    } catch (e) {
      panelRegistered = false;
      return false;
    }
    return true;
  }

  function tryRegisterAll() {
    const a = registerPanel();
    const b = codex.tryRegister();
    if (panelRegistered && codex.registeredWithShell && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = 0;
    }
    return a || b;
  }

  /* Poll for the shell for two minutes, then give up quietly: without it the
     panels are simply unreachable from a menu that does not exist yet, and the
     rail and the overlay carry on regardless. */
  pollTimer = setInterval(() => {
    if (++polls > 120) {
      clearInterval(pollTimer);
      pollTimer = 0;
      return;
    }
    tryRegisterAll();
  }, 1000);
  tryRegisterAll();

  /* ---------------------------------------------------------- auto-start */

  function maybeStart(delay) {
    if (started || opts.autoStart === false) return;
    if (readFlag(STORE_KEY)) return;   // already learned; the panel is the way back
    started = true;
    setTimeout(() => {
      if (tutorial.active || tutorial.finished) return;
      tutorial.start();
    }, delay === undefined ? 1200 : delay);
  }

  offs.push(
    bus.on('shell:state', (p) => {
      attach(handle);
      registerPanel();
      codex.tryRegister();
      /* The rail belongs to the match, not to the menus. Without this it
         stayed lit under the pause overlay and its body text read straight
         through the menu items — measured on the paused screen, where "or
         drag a box across several" sat behind "Resume".

         A class rather than `hidden`, because `hidden` is already the
         tutorial's own lifecycle flag for a step being inactive or the run
         being over; setting it here would resurrect a card that had
         deliberately retired itself on the way back to `playing`. */
      if (p && p.to && tutorial.card) {
        tutorial.card.classList.toggle('vst-offstage', p.to !== 'playing');
      }
      if (p && p.to === 'playing') maybeStart(600);
    }),
  );
  offs.push(
    bus.on('ui:ready', () => {
      attach(handle);
      maybeStart();
    }),
  );

  /* Boot may already have finished — a module imported late must not sit
     waiting for an event that has been and gone. */
  const vs0 = getVS();
  if (vs0 && vs0.ready) {
    const sh = shell();
    if (!sh || sh.state === 'playing' || sh.state === undefined) maybeStart(600);
  }

  const handle = {
    tutorial,
    codex,
    start: (o) => {
      tutorial.stop();
      tutorial.finished = false;
      return tutorial.start(o || { replay: true });
    },
    skip: () => tutorial.skip(),
    get state() {
      return tutorial.state;
    },
    openCodex: () => codex.open(),
    closeCodex: () => codex.close(),
    /** Wipe the "seen it" flag so the next load teaches again. */
    reset: () => clearFlag(STORE_KEY),
    dispose() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = 0;
      for (const off of offs) {
        try {
          off();
        } catch (e) {
          /* ignore */
        }
      }
      offs.length = 0;
      tutorial.dispose();
      codex.dispose();
    },
  };

  return handle;
}

/**
 * Publish the handle on the debug hook.
 *
 * Called more than once on purpose. `main.js` assigns `window.__VS = { … }`
 * *wholesale* inside `main()`, so a handle attached at any earlier moment is
 * simply discarded by the file that imported us. Re-asserting it on
 * `ui:ready` and on every `shell:state` costs nothing and means
 * `__VS.tutorial` is there however the import order lands.
 */
function attach(handle) {
  if (!handle || typeof window === 'undefined') return;
  const vs = window.__VS || (window.__VS = {});
  vs.tutorial = handle;
  vs.codex = handle.codex;
}

/* Self-installing on import.

   `src/main.js` and `index.html` belong to Lane A, so this lane cannot add
   itself to the boot sequence. A single `import './ui/tutorial.js';` in
   main.js is therefore all that is required of them — everything below runs
   itself, guards against a second install, and can never take the boot down
   with it.

   Deferred by one macrotask so it lands after `main()` has built `__VS`.
   `typeof window` keeps `.local/syntax-check.mjs`, which imports every module
   under Node, out of it entirely. */
let _installed = null;

function selfInstall() {
  if (_installed) return _installed;
  try {
    _installed = installTutorial();
    attach(_installed);
  } catch (e) {
    /* A tutorial that throws must not cost the player the game. */
    const vs = window.__VS || (window.__VS = {});
    if (!vs.loadErrors) vs.loadErrors = [];
    vs.loadErrors.push({ label: 'tutorial', error: String((e && e.message) || e) });
  }
  return _installed;
}

if (typeof window !== 'undefined') {
  setTimeout(selfInstall, 0);
}
