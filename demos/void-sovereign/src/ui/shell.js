import { bus } from '../core/events.js';

/* VOID SOVEREIGN — the game around the game.

   Everything outside a live match lives here: the title screen, the new-game
   setup, the briefing, the loading card, the pause menu and the end-of-match
   report. It owns the state machine and it owns Escape.

   It knows nothing about Three.js. Every engine-side operation — building a
   match, tearing one down, halting the fixed-step accumulator — arrives as the
   `game` interface handed in by `main.js`:

     game.start(setup, onProgress) -> Promise<{ seed, difficulty, quality }>
     game.stop()                    // tear the match down, keep the renderer
     game.setHalted(halted)         // freeze/unfreeze the sim, keep rendering
     game.stats()                   // { kills, losses, harvested, duration, ... }
     game.hud()                     // the live HUD, or null

   Lanes B and C attach their own screens through `registerPanel`. Panels are
   mounted lazily on first open so the title screen stays instant. */

export const STATES = ['title', 'setup', 'briefing', 'loading', 'playing', 'paused', 'gameOver'];

/* The legal graph, spelled out rather than inferred. `go()` refuses anything
   not listed, which is what stops a stray `sim:gameOver` during teardown from
   dragging the shell out of the title screen it just returned to. */
const LEGAL = {
  title: ['setup'],
  setup: ['briefing', 'title'],
  briefing: ['loading', 'setup'],
  loading: ['playing', 'title'],
  /* `playing -> loading` is not on the contract's diagram, which routes every
     restart through the pause menu. It is here because `__VS.restart()` and
     the soak harnesses restart from a live match, and a state machine that
     refuses that would only be worked around. */
  playing: ['paused', 'gameOver', 'loading', 'title'],
  paused: ['playing', 'loading', 'setup', 'title'],
  gameOver: ['loading', 'setup', 'title'],
};

/* Screens that sit over the game and must trap focus. `playing` is the only
   state where the shell gets out of the way entirely. */
const OVERLAY_STATES = new Set(['title', 'setup', 'briefing', 'loading', 'paused', 'gameOver']);

const DIFFICULTIES = [
  ['easy', 'Cautious', 'Handicapped, not blind. It still builds, still raids.'],
  ['normal', 'Even', 'Same economy as you, same build times. A fair fight.'],
  ['hard', 'Relentless', 'Earns 15% more and builds 15% faster than you do.'],
];

const QUALITIES = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['ultra', 'Ultra'],
];

/* The briefing. Terse on purpose: three ways to win, one first move, and the
   two words a stranger needs to know they are the cyan side. Kol's note was
   "it went straight into a game and I didn't quite understand what I'm doing",
   so this is the screen that answers it. */
const BRIEFING = {
  you: [
    'You command the cold blue fleet.',
    'Your Mothership is the 1.9 km hull at the centre of your formation. It builds '
      + 'everything else you will ever own, and nothing can rebuild it.',
  ],
  them: [
    'The amber fleet has the same Mothership, the same yards and its own commander.',
    'It mines, it builds and it attacks without waiting for you.',
  ],
  ends: [
    [
      'A Mothership dies',
      'Kill theirs and the skirmish ends there and then. Lose yours and it ends the same way.',
    ],
    [
      'Sovereignty runs out',
      'The ore seams across the middle of the field are contested. Hold more of them than '
        + 'your opponent and their sovereignty drains; at zero, they are finished. Nothing '
        + 'drains for the first four minutes, so the opening is still an opening.',
    ],
    [
      'A side is broken',
      'No yards, no miners and nothing left worth calling a fleet. The result is called '
        + 'rather than played out for another twenty minutes.',
    ],
  ],
  first: [
    'Drag a box over your ships, then right-click to send them.',
    'Select the Mothership to open the build menu.',
    'Space stops the battle without leaving it — orders you give while it is stopped are '
      + 'obeyed the moment it resumes. Escape opens this menu.',
  ],
};

/* Plain-English endings. `sim:gameOver` carries `base | sovereignty | attrition`
   and all three have to read as a sentence, not as a status code. */
const END_COPY = {
  base: {
    won: 'Their Mothership is gone.',
    lost: 'Your Mothership is gone.',
    draw: 'Both Motherships are gone.',
  },
  sovereignty: {
    won: 'You held the contested seams until their sovereignty ran out.',
    lost: 'They held the contested seams until your sovereignty ran out.',
    draw: 'Both sides ran their sovereignty out together.',
  },
  attrition: {
    won: 'They have no yards, no miners and no fleet left to rebuild with.',
    lost: 'You have no yards, no miners and no fleet left to rebuild with.',
    draw: 'Neither side has anything left to rebuild with.',
  },
};

const WORD_SEED_RE = /^[\w -]{0,40}$/;

/* The order the contract puts the front door in, used only to break ties
   between panels that asked for the same `order`. Unknown ids sort after. */
const MENU_ORDER = ['tutorial', 'options', 'codex', 'credits'];
const MENU_RANK = (id) => {
  const i = MENU_ORDER.indexOf(id);
  return i < 0 ? MENU_ORDER.length : i;
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

function button(cls, label) {
  const b = el('button', cls, label);
  b.type = 'button';
  return b;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (n) => n.offsetParent !== null || n === document.activeElement,
  );
}

function isTypingTarget(t) {
  if (!t || !t.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable === true;
}

/** A fresh random seed, as a decimal string. Never `Math.random()` in anything
    the sim consumes — this is the one place a seed is *chosen* rather than used. */
function rollSeed() {
  return String((Math.floor(Math.random() * 0xfffffff) + 1) >>> 0);
}

export class Shell {
  constructor({ root, hudEl = null, stageEl = null, game = {}, defaults = {} } = {}) {
    this.root = typeof root === 'string' ? document.getElementById(root) : root;
    if (!this.root) throw new Error('Shell: no root element');
    this.hudEl = hudEl;
    this.stageEl = stageEl;
    this.game = game;

    this.state = 'title';
    this._panels = new Map();
    this._panelOpen = null;
    this._listeners = new Map();
    this._busy = false;
    this._lastEnd = null;

    this.setup = {
      seed: defaults.seed === undefined ? rollSeed() : String(defaults.seed),
      difficulty: defaults.difficulty || 'normal',
      quality: defaults.quality || 'high',
    };

    this._screens = {};
    this._buildDom();
    this._wireKeys();
    this._registerBuiltins();
    this._paintMenus();

    this.root.classList.add('is-live');
    this._enter('title', null);
  }

  /* ------------------------------------------------------------ public API */

  /** Request a transition. Returns false if the move is not legal. */
  go(to, opts) {
    if (to === this.state) return true;
    const allowed = LEGAL[this.state];
    if (!allowed || allowed.indexOf(to) < 0) return false;
    const from = this.state;
    this.state = to;
    this._enter(to, from, opts || {});
    this.root.dataset.state = to;
    bus.emit('shell:state', { from, to });
    this._emit('stateChange', { from, to });
    return true;
  }

  pause(source) {
    if (this.state !== 'playing') return false;
    return this.go('paused', { source: source || 'menu' });
  }

  resume() {
    if (this.state !== 'paused') return false;
    return this.go('playing');
  }

  /**
   * Register a menu panel. Lanes B and C call this; the shell registers its
   * own How to play / Options / Credits the same way, so a lane that lands
   * later simply replaces the placeholder by re-using its id.
   */
  registerPanel(spec) {
    if (!spec || !spec.id) return () => {};
    const entry = {
      id: String(spec.id),
      title: spec.title || spec.id,
      where: Array.isArray(spec.where) && spec.where.length ? spec.where.slice() : ['title'],
      order: Number.isFinite(spec.order) ? spec.order : 100,
      mount: typeof spec.mount === 'function' ? spec.mount : null,
      onOpen: typeof spec.onOpen === 'function' ? spec.onOpen : null,
      onClose: typeof spec.onClose === 'function' ? spec.onClose : null,
      body: null,
    };
    const prev = this._panels.get(entry.id);
    if (prev && prev.body) prev.body.remove();
    this._panels.set(entry.id, entry);
    this._paintMenus();
    return () => {
      const cur = this._panels.get(entry.id);
      if (cur !== entry) return;
      if (this._panelOpen === entry.id) this.closePanel();
      if (entry.body) entry.body.remove();
      this._panels.delete(entry.id);
      this._paintMenus();
    };
  }

  openPanel(id) {
    const entry = this._panels.get(id);
    if (!entry) return false;
    if (this._panelOpen && this._panelOpen !== id) this.closePanel();

    if (!entry.body) {
      entry.body = el('div', 'vs-panel__body');
      this._panelBody.appendChild(entry.body);
      // Lazily mounted: the title screen must paint before any panel has run
      // a line of code. A panel that throws must not take the menu with it.
      try {
        if (entry.mount) entry.mount(entry.body);
      } catch (err) {
        entry.body.replaceChildren(
          el('p', 'vs-panel__fail', 'This panel failed to load.'),
        );
      }
    }

    for (const other of this._panels.values()) {
      if (other.body) other.body.hidden = other !== entry;
    }
    this._panelTitle.textContent = entry.title;
    this._panelOpen = id;
    this._panelEl.classList.add('is-open');
    this._panelEl.setAttribute('aria-hidden', 'false');
    this._syncInert();
    if (entry.onOpen) {
      try {
        entry.onOpen();
      } catch (err) {
        /* a panel that throws on open still opens */
      }
    }
    this._focusFirst(this._panelEl);
    bus.emit('shell:panel', { id, open: true });
    this._emit('panelOpen', { id });
    return true;
  }

  closePanel() {
    const id = this._panelOpen;
    if (!id) return false;
    const entry = this._panels.get(id);
    const active = document.activeElement;
    if (active && this._panelEl.contains(active) && active.blur) active.blur();
    this._panelOpen = null;
    this._panelEl.classList.remove('is-open');
    this._panelEl.setAttribute('aria-hidden', 'true');
    this._syncInert();
    if (entry && entry.onClose) {
      try {
        entry.onClose();
      } catch (err) {
        /* closing is not allowed to fail */
      }
    }
    bus.emit('shell:panel', { id, open: false });
    this._emit('panelClose', { id });
    const back = this._screens[this.state];
    if (back) this._focusFirst(back);
    return true;
  }

  on(type, fn) {
    if (typeof fn !== 'function') return () => {};
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  /** Progress for the loading card. `main.js` drives this per boot stage. */
  setProgress(value, label) {
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    this._loadFill.style.transform = `scaleX(${v.toFixed(3)})`;
    this._loadBar.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    if (label) this._loadStatus.textContent = String(label);
  }

  /**
   * Skip the front matter and drop straight into a match with the current
   * setup. This is the `?autostart=1` path and what the screenshot harnesses
   * drive, so every probe written against the old "boots straight into the
   * game" behaviour keeps working without pretending the menus are not there.
   */
  quickStart() {
    if (this.state !== 'title' && this.state !== 'setup' && this.state !== 'briefing') return false;
    if (this._panelOpen) this.closePanel();
    if (this.state === 'title') this.go('setup');
    if (this.state === 'setup') this.go('briefing');
    return this._launch();
  }

  /**
   * Rebuild the match with the current setup, from wherever we are. This is
   * "Restart match", "Play again" and `__VS.restart()`, and none of them
   * reload the page.
   */
  restart() {
    if (this.state === 'playing' || this.state === 'paused' || this.state === 'gameOver') {
      return this._launch();
    }
    return this.quickStart();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey, true);
    window.removeEventListener('keydown', this._onModalityKey, true);
    window.removeEventListener('pointerdown', this._onModalityPointer, true);
    this.root.removeEventListener('keydown', this._onTrap);
    this.root.removeEventListener('click', this._onClick);
    for (const off of this._offs) off();
    this._offs.length = 0;
    this._listeners.clear();
    this.root.replaceChildren();
  }

  /* --------------------------------------------------------------- screens */

  _buildDom() {
    const root = this.root;
    root.classList.add('vs-shell');
    root.dataset.state = 'title';

    /* The title screen is already in index.html so it paints before a single
       module has been fetched. Adopt it rather than rebuild it — a wordmark
       that appears 400 ms after the page is the first thing a visitor judges. */
    const title = root.querySelector('.vs-screen--title');
    this._screens.title = title || this._makeScreen('title');
    this._titleNav = this._screens.title.querySelector('.vs-menu');
    if (!this._titleNav) {
      this._titleNav = el('nav', 'vs-menu');
      this._screens.title.querySelector('.vs-screen__inner').appendChild(this._titleNav);
    }

    this._buildSetup();
    this._buildBriefing();
    this._buildLoading();
    this._buildPause();
    this._buildOver();
    this._buildPanelHost();
  }

  _makeScreen(id, opts = {}) {
    const s = el('section', `vs-screen vs-screen--${id}`);
    s.dataset.screen = id;
    s.setAttribute('aria-hidden', 'true');
    if (opts.modal !== false) {
      s.setAttribute('role', 'dialog');
      s.setAttribute('aria-modal', 'true');
    }
    const inner = el('div', 'vs-screen__inner');
    s.appendChild(inner);
    this.root.appendChild(s);
    this._screens[id] = s;
    return s;
  }

  _head(inner, eyebrow, heading, deck) {
    inner.appendChild(el('p', 'vs-eyebrow', eyebrow));
    inner.appendChild(el('h2', 'vs-heading', heading));
    if (deck) inner.appendChild(el('p', 'vs-deck', deck));
    return inner;
  }

  _buildSetup() {
    const s = this._makeScreen('setup');
    s.setAttribute('aria-label', 'New skirmish setup');
    const inner = s.querySelector('.vs-screen__inner');
    this._head(
      inner,
      'New skirmish · step 1 of 2',
      'Choose your universe',
      'Everything in the match — hulls, nebula, asteroid fields, the enemy commander’s '
        + 'opening — is generated from these three settings.',
    );

    const fields = el('div', 'vs-fields');

    // --- seed
    const seedField = el('div', 'vs-field');
    const seedLabel = el('label', 'vs-field__k', 'Seed');
    seedLabel.htmlFor = 'vs-seed';
    const seedRow = el('div', 'vs-field__row');
    this._seedInput = document.createElement('input');
    this._seedInput.type = 'text';
    this._seedInput.id = 'vs-seed';
    this._seedInput.className = 'vs-input';
    this._seedInput.autocomplete = 'off';
    this._seedInput.spellcheck = false;
    this._seedInput.setAttribute('aria-describedby', 'vs-seed-hint');
    this._seedInput.value = this.setup.seed;
    this._seedInput.addEventListener('input', () => {
      this.setup.seed = this._seedInput.value.trim();
    });
    const reroll = button('vs-btn vs-btn--ghost', 'Reroll');
    reroll.dataset.act = 'reroll';
    seedRow.append(this._seedInput, reroll);
    const seedHint = el(
      'p',
      'vs-hint',
      'A word or a number. The same seed rebuilds the same universe, every time.',
    );
    seedHint.id = 'vs-seed-hint';
    seedField.append(seedLabel, seedRow, seedHint);

    // --- opponent
    this._diffGroup = this._choice(
      'Opponent',
      DIFFICULTIES.map(([v, l]) => [v, l]),
      this.setup.difficulty,
      (v) => {
        this.setup.difficulty = v;
        this._paintDiffHint();
      },
    );
    this._diffHint = el('p', 'vs-hint', '');
    this._diffGroup.field.appendChild(this._diffHint);

    // --- detail
    this._qualGroup = this._choice(
      'Detail',
      QUALITIES,
      this.setup.quality,
      (v) => {
        this.setup.quality = v;
      },
    );
    this._qualGroup.field.appendChild(
      el('p', 'vs-hint', 'Higher tiers cost load time and frame rate, not gameplay.'),
    );

    fields.append(seedField, this._diffGroup.field, this._qualGroup.field);
    inner.appendChild(fields);

    const actions = el('div', 'vs-actions');
    const back = button('vs-btn vs-btn--ghost', 'Back');
    back.dataset.act = 'setup:back';
    const next = button('vs-btn vs-btn--primary', 'Continue');
    next.dataset.act = 'setup:next';
    next.dataset.autofocus = 'true';
    actions.append(back, next);
    inner.appendChild(actions);
    this._paintDiffHint();
  }

  _choice(label, options, current, onPick) {
    const field = el('div', 'vs-field');
    const id = `vs-grp-${label.toLowerCase().replace(/\W+/g, '')}`;
    const k = el('span', 'vs-field__k', label);
    k.id = id;
    const group = el('div', 'vs-choice');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', id);
    const buttons = options.map(([value, text]) => {
      const b = button('vs-choice__b', text);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(value === current));
      b.dataset.value = value;
      /* Roving tabindex: a radiogroup is one tab stop, and arrow keys move
         inside it. Without this a four-option group costs four Tab presses to
         walk past, which is exactly the keyboard trap this project already
         shipped once. */
      b.tabIndex = value === current ? 0 : -1;
      b.addEventListener('click', () => {
        this._paintChoice(group, value);
        onPick(value);
      });
      b.addEventListener('keydown', (ev) => {
        const dir = ev.key === 'ArrowRight' || ev.key === 'ArrowDown'
          ? 1
          : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
        if (!dir) return;
        ev.preventDefault();
        const list = Array.from(group.querySelectorAll('[role="radio"]'));
        const i = list.indexOf(ev.currentTarget);
        const nextEl = list[(i + dir + list.length) % list.length];
        this._paintChoice(group, nextEl.dataset.value);
        onPick(nextEl.dataset.value);
        nextEl.focus();
      });
      group.appendChild(b);
      return b;
    });
    field.append(k, group);
    return { field, group, buttons };
  }

  _paintChoice(group, value) {
    for (const b of group.querySelectorAll('[role="radio"]')) {
      const on = b.dataset.value === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  _paintDiffHint() {
    const row = DIFFICULTIES.find(([v]) => v === this.setup.difficulty);
    this._diffHint.textContent = row ? row[2] : '';
  }

  _buildBriefing() {
    const s = this._makeScreen('briefing');
    s.setAttribute('aria-label', 'Briefing');
    const inner = s.querySelector('.vs-screen__inner');
    this._head(inner, 'Briefing · step 2 of 2', 'Your orders');

    const cols = el('div', 'vs-brief');

    const who = el('section', 'vs-brief__block');
    who.appendChild(el('h3', 'vs-brief__k', 'You'));
    for (const line of BRIEFING.you) who.appendChild(el('p', 'vs-brief__p', line));
    who.appendChild(el('h3', 'vs-brief__k', 'Them'));
    for (const line of BRIEFING.them) who.appendChild(el('p', 'vs-brief__p', line));

    const ends = el('section', 'vs-brief__block');
    ends.appendChild(el('h3', 'vs-brief__k', 'Three ways this ends'));
    const list = el('ol', 'vs-brief__ends');
    for (const [k, d] of BRIEFING.ends) {
      const li = el('li', 'vs-brief__end');
      li.append(el('span', 'vs-brief__endk', k), el('span', 'vs-brief__endd', d));
      list.appendChild(li);
    }
    ends.appendChild(list);

    const first = el('section', 'vs-brief__block');
    first.appendChild(el('h3', 'vs-brief__k', 'Your first move'));
    for (const line of BRIEFING.first) first.appendChild(el('p', 'vs-brief__p', line));

    cols.append(who, ends, first);
    inner.appendChild(cols);

    const actions = el('div', 'vs-actions');
    const back = button('vs-btn vs-btn--ghost', 'Back');
    back.dataset.act = 'brief:back';
    const go = button('vs-btn vs-btn--primary', 'Take command');
    go.dataset.act = 'brief:launch';
    go.dataset.autofocus = 'true';
    this._briefSummary = el('p', 'vs-brief__seed', '');
    actions.append(this._briefSummary, back, go);
    inner.appendChild(actions);
  }

  _buildLoading() {
    const s = this._makeScreen('loading');
    s.setAttribute('aria-label', 'Building the universe');
    const inner = s.querySelector('.vs-screen__inner');
    this._head(inner, 'Elusion Works', 'Void Sovereign');
    this._loadSeedLine = el('p', 'vs-deck', '');
    inner.appendChild(this._loadSeedLine);

    this._loadBar = el('div', 'vs-progress');
    this._loadBar.setAttribute('role', 'progressbar');
    this._loadBar.setAttribute('aria-valuemin', '0');
    this._loadBar.setAttribute('aria-valuemax', '100');
    this._loadBar.setAttribute('aria-valuenow', '0');
    this._loadFill = el('div', 'vs-progress__fill');
    this._loadBar.appendChild(this._loadFill);
    this._loadStatus = el('p', 'vs-status', 'Waking the shipyard…');
    inner.append(this._loadBar, this._loadStatus);
  }

  _buildPause() {
    const s = this._makeScreen('paused');
    s.setAttribute('aria-label', 'Paused');
    const inner = s.querySelector('.vs-screen__inner');
    this._head(inner, 'Paused', 'Fleet command');
    this._pauseNav = el('nav', 'vs-menu');
    inner.appendChild(this._pauseNav);
    inner.appendChild(
      el(
        'p',
        'vs-hint vs-hint--wide',
        'Space is the fast tactical pause: the battle stops, the menu stays out of the way '
          + 'and orders you give still stand. Escape brings you here.',
      ),
    );
  }

  _buildOver() {
    const s = this._makeScreen('gameOver');
    s.setAttribute('aria-label', 'Skirmish complete');
    const inner = s.querySelector('.vs-screen__inner');
    this._overEyebrow = el('p', 'vs-eyebrow', 'Skirmish complete');
    this._overTitle = el('h2', 'vs-heading vs-heading--verdict', 'Skirmish complete');
    this._overReason = el('p', 'vs-deck', '');
    inner.append(this._overEyebrow, this._overTitle, this._overReason);

    this._overStats = el('div', 'vs-tally');
    inner.appendChild(this._overStats);

    const actions = el('div', 'vs-actions');
    const again = button('vs-btn vs-btn--primary', 'Play again');
    again.dataset.act = 'over:again';
    again.dataset.autofocus = 'true';
    const change = button('vs-btn vs-btn--ghost', 'Change setup');
    change.dataset.act = 'over:setup';
    const menu = button('vs-btn vs-btn--ghost', 'Main menu');
    menu.dataset.act = 'over:menu';
    actions.append(again, change, menu);
    inner.appendChild(actions);
  }

  _buildPanelHost() {
    const p = el('div', 'vs-panel');
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-modal', 'true');
    p.setAttribute('aria-hidden', 'true');
    const inner = el('div', 'vs-panel__inner');
    const head = el('div', 'vs-panel__head');
    this._panelTitle = el('h2', 'vs-panel__title', '');
    const close = button('vs-panel__close', 'Close · Esc');
    close.dataset.act = 'panel:close';
    head.append(this._panelTitle, close);
    this._panelBody = el('div', 'vs-panel__stack');
    inner.append(head, this._panelBody);
    p.appendChild(inner);
    this.root.appendChild(p);
    this._panelEl = p;
  }

  /* ----------------------------------------------------------- menu paints */

  /** Rebuild the title and pause menus from the registered panel list. */
  _paintMenus() {
    if (!this._titleNav || !this._pauseNav) return;
    /* `order` is a hint, and two lanes picking the same number is not a
       tie the alphabet should settle: Lane B and Lane C both chose 20, and
       "Options" sorting above "Tutorial" put settings in front of the thing a
       first-time player needs. Explicit orders still win; equal orders fall
       back to the front-door sequence the contract names. */
    const panels = Array.from(this._panels.values()).sort(
      (a, b) => a.order - b.order || MENU_RANK(a.id) - MENU_RANK(b.id)
        || a.title.localeCompare(b.title),
    );

    const titleItems = [{ act: 'new', label: 'New game', primary: true }];
    for (const p of panels) {
      if (p.where.indexOf('title') >= 0) titleItems.push({ act: `panel:${p.id}`, label: p.title });
    }
    this._titleNav.replaceChildren(
      ...titleItems.map((it, i) => this._menuItem(it, i === 0)),
      this._exitLink(),
    );

    const pauseItems = [
      { act: 'resume', label: 'Resume', primary: true },
      { act: 'restart', label: 'Restart match' },
    ];
    for (const p of panels) {
      if (p.where.indexOf('pause') >= 0) pauseItems.push({ act: `panel:${p.id}`, label: p.title });
    }
    pauseItems.push({ act: 'quit', label: 'Quit to main menu' });
    this._pauseNav.replaceChildren(...pauseItems.map((it, i) => this._menuItem(it, i === 0)));
  }

  _menuItem(it, first) {
    const b = button(`vs-menu__b${it.primary ? ' is-primary' : ''}`, it.label);
    b.dataset.act = it.act;
    if (first) b.dataset.autofocus = 'true';
    return b;
  }

  _exitLink() {
    const a = el('a', 'vs-menu__b vs-menu__b--exit', 'Back to the demo shelf');
    a.href = '../';
    return a;
  }

  /* ------------------------------------------------------------ built-ins */

  /* The shell ships How to play, Options and Credits itself so the menu is
     never a list of dead labels. Lanes B and C replace `tutorial` and `options`
     by registering the same ids; `codex` has no placeholder because a codex
     that says "coming soon" is worse than a menu without one. */
  _registerBuiltins() {
    this.registerPanel({
      id: 'tutorial',
      title: 'How to play',
      where: ['title', 'pause'],
      order: 10,
      mount: (host) => this._mountHowTo(host),
    });
    this.registerPanel({
      id: 'options',
      title: 'Options',
      where: ['title', 'pause'],
      order: 20,
      mount: (host) => this._mountOptions(host),
    });
    this.registerPanel({
      id: 'credits',
      title: 'Credits',
      where: ['title'],
      order: 90,
      mount: (host) => this._mountCredits(host),
    });
  }

  _mountHowTo(host) {
    const intro = el(
      'p',
      'vs-panel__lede',
      'A Homeworld-lineage skirmish. You command one fleet in a 60 km cube of space; '
        + 'movement is genuinely three-dimensional, so orders carry an altitude as well as '
        + 'a heading.',
    );
    host.appendChild(intro);

    const objective = el('section', 'vs-panel__sec');
    objective.appendChild(el('h3', 'vs-panel__k', 'What you are doing'));
    const list = el('ol', 'vs-brief__ends');
    for (const [k, d] of BRIEFING.ends) {
      const li = el('li', 'vs-brief__end');
      li.append(el('span', 'vs-brief__endk', k), el('span', 'vs-brief__endd', d));
      list.appendChild(li);
    }
    objective.appendChild(list);
    host.appendChild(objective);

    const keys = el('section', 'vs-panel__sec');
    keys.appendChild(el('h3', 'vs-panel__k', 'Controls'));
    const grid = el('div', 'vs-keys');
    for (const [k, d] of this._controlRows()) {
      const row = el('div', 'vs-keys__row');
      row.append(el('span', 'vs-keys__k', k), el('span', 'vs-keys__d', d));
      grid.appendChild(row);
    }
    keys.appendChild(grid);
    keys.appendChild(
      el(
        'p',
        'vs-hint',
        'The full reference, generated from the live key handlers, is on the H card in game.',
      ),
    );
    host.appendChild(keys);
  }

  /* Deliberately a short list rather than the whole scheme: the H card in game
     prints every row straight out of `core/input.js`, and a second full copy
     here would be a second thing to keep in step. These are the verbs a
     stranger needs in the first sixty seconds. */
  /* A deliberately short orientation list, not the full key card — H opens
     that, and Options is where keys are actually changed.

     These letters are the shipped defaults. They are written out rather than
     read from `CONTROL_SCHEME` because this list is curated prose, not one row
     per action, and the two do not map one to one. The cost is that a player
     who rebinds sees stale letters here until they look at the real card,
     which stays live. If this list grows any further, derive it instead —
     hard-coded key names drifting from their handlers is the exact failure
     this project has already paid for more than once. */
  _controlRows() {
    return [
      ['Drag', 'Select ships'],
      ['Right click', 'Move · drag up or down to set altitude'],
      ['Right click enemy', 'Attack'],
      ['A · G · P · S', 'Attack-move · guard · patrol · stop'],
      ['Shift + order', 'Queue it'],
      ['D', 'Clear the selection'],
      ['Space', 'Tactical pause — orders still stand'],
      ['Escape', 'This menu'],
      ['Right drag · wheel', 'Orbit · zoom'],
      ['F · Tab · H', 'Focus selection · sensors manager · full key card'],
    ];
  }

  _mountOptions(host) {
    host.appendChild(
      el(
        'p',
        'vs-panel__lede',
        'Detail applies to the next match you start. Sound applies immediately.',
      ),
    );

    const detail = this._choice('Detail', QUALITIES, this.setup.quality, (v) => {
      this.setup.quality = v;
      this._paintChoice(this._qualGroup.group, v);
      bus.emit('options:changed', { key: 'quality', value: v });
    });
    detail.field.appendChild(
      el('p', 'vs-hint', 'Changing this rebuilds the universe when the next match starts.'),
    );
    host.appendChild(detail.field);
    this._optQuality = detail.group;

    const sound = el('div', 'vs-field');
    sound.appendChild(el('span', 'vs-field__k', 'Sound'));
    const row = el('div', 'vs-field__row');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'vs-range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.02';
    slider.value = '0.8';
    slider.setAttribute('aria-label', 'Master volume');
    slider.addEventListener('input', () => {
      bus.emit('ui:audioVolume', { bus: 'master', value: Number(slider.value) });
    });
    const mute = button('vs-btn vs-btn--ghost', 'Mute');
    mute.setAttribute('aria-pressed', 'false');
    mute.addEventListener('click', () => {
      const next = mute.getAttribute('aria-pressed') !== 'true';
      mute.setAttribute('aria-pressed', String(next));
      mute.textContent = next ? 'Unmute' : 'Mute';
      bus.emit('ui:audioMute', { muted: next });
    });
    row.append(slider, mute);
    sound.appendChild(row);
    sound.appendChild(
      el('p', 'vs-hint', 'The full five-bus mixer is on the H card in game. M mutes from anywhere.'),
    );
    host.appendChild(sound);

    host.appendChild(
      el(
        'p',
        'vs-hint vs-hint--wide',
        'Key rebinding is not here yet. Panning is on the arrow keys, the screen edge and '
          + 'middle-drag, because A and S are attack-move and stop.',
      ),
    );
  }

  _mountCredits(host) {
    host.appendChild(
      el(
        'p',
        'vs-panel__lede',
        'Void Sovereign is a browser demo by Elusion Works. It runs on Three.js and WebGL 2 '
          + 'with no build step and no binary art assets whatsoever.',
      ),
    );
    const rows = [
      ['Hulls, nebulae, asteroids', 'Generated at runtime from the match seed'],
      ['Textures and sound', 'Procedural — canvas 2D, data textures and Web Audio'],
      ['Renderer', 'Three.js, vendored'],
      ['Typefaces', 'Inter and IBM Plex Mono'],
    ];
    const grid = el('div', 'vs-keys');
    for (const [k, d] of rows) {
      const row = el('div', 'vs-keys__row');
      row.append(el('span', 'vs-keys__k', k), el('span', 'vs-keys__d', d));
      grid.appendChild(row);
    }
    host.appendChild(grid);
  }

  /* ------------------------------------------------------------ transitions */

  _enter(to, from, opts = {}) {
    /* Drop focus before anything is marked `aria-hidden`.

       Chrome refuses to apply aria-hidden to an ancestor of the focused
       element and logs a warning instead — so leaving a screen while its
       "Continue" button still had focus left the screen behind fully exposed
       to assistive technology. Blur first, hide second, refocus third. */
    const active = document.activeElement;
    if (active && active !== document.body && this.root.contains(active) && active.blur) {
      active.blur();
    }

    for (const key of Object.keys(this._screens)) {
      const s = this._screens[key];
      const on = key === to && OVERLAY_STATES.has(to);
      s.classList.toggle('is-active', on);
      s.setAttribute('aria-hidden', String(!on));
    }
    if (to !== 'paused' && to !== 'title' && this._panelOpen) this.closePanel();

    // The sim runs in exactly one state. Everything else halts the accumulator
    // outright — not a time scale of zero, which the loop would still advance
    // through if anything ever set it back.
    if (this.game.setHalted) this.game.setHalted(to !== 'playing');
    if (to === 'paused' || from === 'paused') {
      bus.emit('shell:pause', { paused: to === 'paused', source: opts.source || 'menu' });
    }

    this._syncInert();

    if (to === 'briefing') this._paintBriefing();
    if (to === 'loading') this.setProgress(0, 'Waking the shipyard…');
    if (to === 'title' && from && from !== 'title') this._teardown();
    if (OVERLAY_STATES.has(to)) this._focusFirst(this._screens[to]);
  }

  /** Screens sit over a live canvas, so everything behind one has to leave the
      tab order as well as the accessibility tree. `inert` does both. */
  _syncInert() {
    const blocked = this._panelOpen !== null || OVERLAY_STATES.has(this.state);
    for (const node of [this.hudEl, this.stageEl]) {
      if (!node) continue;
      if (blocked) node.setAttribute('inert', '');
      else node.removeAttribute('inert');
    }
    // A screen underneath an open panel must not be tabbable either.
    for (const key of Object.keys(this._screens)) {
      const s = this._screens[key];
      if (!s.classList.contains('is-active')) continue;
      if (this._panelOpen) s.setAttribute('inert', '');
      else s.removeAttribute('inert');
    }
    this.root.classList.toggle('is-blocking', blocked);
  }

  _focusFirst(scope) {
    if (!scope) return;
    const target = scope.querySelector('[data-autofocus]') || focusables(scope)[0];
    if (target) target.focus({ preventScroll: true });
  }

  _paintBriefing() {
    const d = DIFFICULTIES.find(([v]) => v === this.setup.difficulty);
    this._briefSummary.textContent =
      `Seed ${this.setup.seed || 'random'} · ${d ? d[1] : this.setup.difficulty} opponent`;
  }

  _teardown() {
    if (this.game.stop) this.game.stop();
    this._lastEnd = null;
  }

  /* ------------------------------------------------------------- launching */

  async _launch() {
    if (this._busy) return false;
    if (!this.game.start) return false;
    this._busy = true;
    if (!this.setup.seed) this.setup.seed = rollSeed();
    if (!WORD_SEED_RE.test(this.setup.seed)) this.setup.seed = rollSeed();

    this._loadSeedLine.textContent =
      `Seed ${this.setup.seed} · building hulls, nebula and asteroid fields`;
    if (!this.go('loading')) {
      this._busy = false;
      return false;
    }

    try {
      const result = await this.game.start(
        { seed: this.setup.seed, difficulty: this.setup.difficulty, quality: this.setup.quality },
        (v, label) => this.setProgress(v, label),
      );
      this.setProgress(1, 'Ready.');
      this._syncUrl(result || {});
      bus.emit('shell:restart', {
        seed: this.setup.seed,
        difficulty: this.setup.difficulty,
        quality: this.setup.quality,
      });
      this._busy = false;
      return this.go('playing');
    } catch (err) {
      this._busy = false;
      this._loadStatus.textContent = 'The match failed to build. Returning to the menu.';
      this.go('title');
      bus.emit('ui:toast', { text: 'The match failed to build.', kind: 'error' });
      return false;
    }
  }

  /* Keep the address bar honest without ever reloading. A player who finds a
     seed worth keeping can copy the URL; nobody is thrown back to the boot
     sequence to apply a setting, which is what this whole lane replaced. */
  _syncUrl(result) {
    try {
      const url = new URL(location.href);
      url.searchParams.set('seed', String(result.seed || this.setup.seed));
      url.searchParams.set('difficulty', this.setup.difficulty);
      url.searchParams.set('quality', this.setup.quality);
      url.searchParams.delete('autostart');
      history.replaceState(null, '', url.toString());
    } catch (err) {
      /* a sandboxed history is not a reason to fail a launch */
    }
  }

  /* ------------------------------------------------------------- game over */

  /** Driven by `sim:gameOver`. `main.js` forwards the payload straight here. */
  showGameOver(payload) {
    // The sim cannot tick while paused, so this should only ever arrive from
    // `playing` — but a queued event landing one frame late must not be lost.
    if (this.state === 'paused') this.go('playing');
    if (this.state !== 'playing') return false;
    const p = payload || {};
    const team = Number.isFinite(p.humanTeam) ? p.humanTeam : 0;
    const winner = Number.isFinite(p.winner) ? p.winner : -1;
    const outcome = winner < 0 ? 'draw' : winner === team ? 'won' : 'lost';
    const reason = END_COPY[p.reason] ? p.reason : 'base';

    this._lastEnd = { winner, reason, outcome };
    this._overTitle.textContent =
      outcome === 'won' ? 'Victory' : outcome === 'lost' ? 'Defeat' : 'Mutual annihilation';
    this._overTitle.classList.toggle('is-won', outcome === 'won');
    this._overTitle.classList.toggle('is-lost', outcome === 'lost');
    this._overReason.textContent = END_COPY[reason][outcome];

    const stats = (this.game.stats && this.game.stats()) || {};
    const rows = [
      ['Hostiles destroyed', fmtInt(stats.kills)],
      ['Hulls lost', fmtInt(stats.losses)],
      ['Hulls commissioned', fmtInt(stats.built)],
      ['Resources harvested', fmtInt(stats.harvested)],
      ['Fleet remaining', `${fmtInt(stats.fleetHulls)} · ${fmtInt(stats.fleetValue)} RU`],
      ['Duration', fmtClock(stats.duration)],
    ];
    const frag = document.createDocumentFragment();
    for (const [k, v] of rows) {
      const row = el('div', 'vs-tally__row');
      row.append(el('span', 'vs-tally__k', k), el('span', 'vs-tally__v', v));
      frag.appendChild(row);
    }
    this._overStats.replaceChildren(frag);
    return this.go('gameOver');
  }

  /* ------------------------------------------------------------- keyboard */

  _wireKeys() {
    this._offs = [];

    /* Escape arbitration lives here and nowhere else.

       `core/input.js` claims Escape at window level to clear the selection and
       `ui/hud.js` used to claim it to close the key card. Three handlers on one
       key is how this project shipped a keyboard trap already, so the shell
       takes it in the CAPTURE phase at window level — which runs before any
       bubble-phase listener anywhere — and stops propagation whenever it acts.
       When the shell has nothing to do with the key it does not touch it, and
       the game keeps its own behaviour. */
    this._onKey = (ev) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented) return;
      const typing = isTypingTarget(ev.target);

      if (this._panelOpen) {
        ev.preventDefault();
        ev.stopPropagation();
        this.closePanel();
        return;
      }
      if (typing) {
        // Leave the field first; a second Escape then does the normal thing.
        ev.stopPropagation();
        if (ev.target.blur) ev.target.blur();
        return;
      }
      const hud = this.game.hud && this.game.hud();
      if (this.state === 'playing' && hud && hud.closeOverlays && hud.closeOverlays()) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      const handled =
        (this.state === 'playing' && this.pause('key'))
        || (this.state === 'paused' && this.resume())
        || (this.state === 'setup' && this.go('title'))
        || (this.state === 'briefing' && this.go('setup'));
      if (handled) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };
    window.addEventListener('keydown', this._onKey, true);

    /* Tab containment. `inert` behind the overlay already removes the HUD and
       the canvas from the tab order; this closes the loop at the ends of the
       active screen so focus cannot escape to the browser chrome mid-menu. */
    this._onTrap = (ev) => {
      if (ev.key !== 'Tab') return;
      const scope = this._panelOpen ? this._panelEl : this._screens[this.state];
      if (!scope) return;
      if (!this._panelOpen && !scope.classList.contains('is-active')) return;
      const list = focusables(scope);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      } else if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      }
    };
    this.root.addEventListener('keydown', this._onTrap);

    this._onClick = (ev) => this._click(ev);
    this.root.addEventListener('click', this._onClick);

    /* Focus-ring modality.

       Every screen focuses its primary control on entry, because the contract
       requires the whole shell to be usable from the keyboard alone. Chrome
       then treats that programmatic focus as `:focus-visible` and paints a
       cyan box round "New game" on a page nobody has touched yet, which reads
       as a rendering fault rather than as focus. So the ring is suppressed
       while the last input was a pointer — or while there has been no input at
       all — and comes back the instant anyone touches a key. It is never
       suppressed for someone actually navigating by keyboard. */
    this.root.classList.add('is-quietfocus');
    this._onModalityKey = () => this.root.classList.remove('is-quietfocus');
    this._onModalityPointer = () => this.root.classList.add('is-quietfocus');
    window.addEventListener('keydown', this._onModalityKey, true);
    window.addEventListener('pointerdown', this._onModalityPointer, true);
  }

  _click(ev) {
    const t = ev.target;
    if (!t || !t.closest) return;
    const hit = t.closest('[data-act]');
    if (!hit) return;
    const act = hit.dataset.act;

    if (act.startsWith('panel:')) {
      const id = act.slice(6);
      if (id === 'close') this.closePanel();
      else this.openPanel(id);
      return;
    }

    switch (act) {
      case 'new':
        this.go('setup');
        break;
      case 'reroll':
        this.setup.seed = rollSeed();
        this._seedInput.value = this.setup.seed;
        break;
      case 'setup:back':
        this.go('title');
        break;
      case 'setup:next':
        this.go('briefing');
        break;
      case 'brief:back':
        this.go('setup');
        break;
      case 'brief:launch':
        this._launch();
        break;
      case 'resume':
        this.resume();
        break;
      case 'restart':
        this._launch();
        break;
      case 'quit':
        this.go('title');
        break;
      case 'over:again':
        this._launch();
        break;
      case 'over:setup':
        this.go('setup');
        break;
      case 'over:menu':
        this.go('title');
        break;
      default:
        break;
    }
  }

  _emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (err) {
        /* a shell listener must not be able to wedge a transition */
      }
    }
  }
}

function fmtInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-GB');
}

function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export default Shell;
