import { SHIPS, CLASS_IDS, ROLE, affinityTable, VETERANCY } from '../ships/catalog.js';
import { CONTROL, refreshIncome } from '../sim/economy.js';
import { CONTROL_SCHEME } from '../core/input.js';

/* The codex — the reference the player can actually read.

   `CRITIQUE-RUBRIC.md` §6/G4 is blunt about the hole this fills: every one of
   the thirteen classes has carried a hand-written `description` and
   `counteredBy` since the roster was written, and nothing on screen had ever
   shown either of them. The rock-paper-scissors existed and could only be
   learned by losing.

   **Nothing in here is typed twice.** Every stat, name, weapon figure, counter
   line and affinity number is read out of `ships/catalog.js` at render time,
   and the economy figures are read out of `sim/economy.js` and the live
   `World`. A codex that drifts from the simulation is worse than no codex —
   §3.2/C4's "a help screen that lies" is an automatic blocker — so the only
   defence against drift is to never hold a second copy.

   Two of the economy constants (`UPKEEP_FREE_POP`, `UPKEEP_K`) are private to
   `economy.js` and there is no export to read them from. Rather than copy the
   numbers here and let them rot, `probeUpkeep()` below calls the module's own
   exported `refreshIncome()` against a throwaway team and reads the answer
   back. It is a strange-looking six lines and it is the honest version.

   Hosting: `installCodex()` registers a `codex` panel with `window.__VS.shell`
   the moment Lane A's shell exists, and mounts exactly the same DOM into a
   self-owned overlay when it does not — so the codex is reachable whether or
   not the shell has landed. */

/* --------------------------------------------------------------- formatting */

const ROLE_ORDER = [
  ROLE.FIGHTER,
  ROLE.CORVETTE,
  ROLE.FRIGATE,
  ROLE.CAPITAL,
  ROLE.SUPPORT,
  ROLE.RESOURCE,
  ROLE.STRUCTURE,
];

const ROLE_LABEL = {
  [ROLE.FIGHTER]: 'Strike craft',
  [ROLE.CORVETTE]: 'Corvettes',
  [ROLE.FRIGATE]: 'Frigates',
  [ROLE.CAPITAL]: 'Capitals',
  [ROLE.SUPPORT]: 'Support',
  [ROLE.RESOURCE]: 'Economy',
  [ROLE.STRUCTURE]: 'Yards',
};

const WEAPON_LABEL = {
  kinetic: 'Kinetic',
  beam: 'Beam',
  missile: 'Missile',
  flak: 'Flak',
  ion: 'Ion',
};

const fmt = (n, dp = 0) => {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
};

/** Ranges are metres in the table and kilometres in every sentence about them. */
const km = (m) => `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;

const times = (v) => `×${v.toFixed(2)}`;

let uid = 0;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

function svgEl(tag, attrs) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

/* --------------------------------------------------------------- economy probe */

/**
 * Recover the upkeep curve from `economy.js` without copying its constants.
 *
 * `refreshIncome()` is exported, pure, and touches nothing but `world.teams`,
 * so a one-element throwaway is a legal argument. Sweeping population until the
 * multiplier first leaves 1.0 gives the free allowance; two further samples
 * give the shape of the curve. If the formula is ever reworked into something
 * this cannot read, `free` comes back -1 and the panel says less rather than
 * saying something false.
 */
function probeUpkeep() {
  const probe = { teams: [{ popUsed: 0, seams: 0, incomeBase: 1 }] };
  const at = (pop) => {
    probe.teams[0].popUsed = pop;
    try {
      refreshIncome(probe);
    } catch (e) {
      return NaN;
    }
    return probe.teams[0].upkeepScale;
  };
  let free = -1;
  for (let p = 0; p <= 400; p++) {
    const s = at(p);
    if (!Number.isFinite(s)) return { free: -1, samples: [] };
    if (s < 0.9999) {
      free = p - 1;
      break;
    }
  }
  if (free < 0) return { free: -1, samples: [] };
  const samples = [free, free + 25, free + 50, free + 100].map((p) => ({ pop: p, scale: at(p) }));
  return { free, samples };
}

/* ------------------------------------------------------------------ sections */

function shipCard(def) {
  const card = el('article', 'vsc-ship');
  card.dataset.role = def.role;
  card.dataset.classId = def.id;

  const head = el('div', 'vsc-ship__head');
  if (def.silhouette) {
    const svg = svgEl('svg', { class: 'vsc-ship__icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    svg.appendChild(svgEl('path', { d: def.silhouette }));
    head.appendChild(svg);
  }

  const id = el('div', 'vsc-ship__id');
  id.append(
    el('h4', 'vsc-ship__name', def.name),
    el('p', 'vsc-ship__role', `${def.short} · ${ROLE_LABEL[def.role] || def.role}`),
  );
  head.appendChild(id);

  const cost = el('div', 'vsc-ship__cost');
  cost.append(
    document.createTextNode(def.cost > 0 ? fmt(def.cost) : '—'),
    el('span', null, def.cost > 0 ? 'credits' : 'flagship'),
  );
  head.appendChild(cost);
  card.appendChild(head);

  /* One dense mono line. Everything here is a number the sim actually reads. */
  const stats = el('p', 'vsc-ship__stats');
  const squad = Math.max(1, def.squadSize || 1);
  const bits = [
    ['LEN', `${fmt(def.length)} m`],
    ['HULL', fmt(def.hull)],
    ['SHLD', def.shield > 0 ? fmt(def.shield) : '—'],
    ['ARM', `${Math.round((def.armour || 0) * 100)}%`],
    ['SPD', `${fmt(def.speed)} m/s`],
    ['POP', String((def.popCost || 0) * squad || (def.popProvided ? `+${def.popProvided}` : '0'))],
  ];
  if (def.buildTime > 0) bits.push(['BUILD', `${fmt(def.buildTime)} s`]);
  if (squad > 1) bits.push(['WING', `${squad}`]);
  for (const [k, v] of bits) {
    const span = el('span', null, `${k} `);
    span.appendChild(el('b', null, v));
    stats.appendChild(span);
  }
  card.appendChild(stats);

  card.appendChild(el('p', 'vsc-ship__desc', def.description || ''));

  const rows = el('div', 'vsc-ship__rows');
  const row = (k, v, mod) => {
    const r = el('div', `vsc-ship__row${mod ? ` vsc-ship__row--${mod}` : ''}`);
    r.append(el('span', 'vsc-ship__k', k), el('span', 'vsc-ship__v', v));
    rows.appendChild(r);
  };

  if (def.weapons && def.weapons.length) {
    const guns = def.weapons
      .map((w) => {
        const label = WEAPON_LABEL[w.type] || w.type;
        const hp = w.hardpoints > 1 ? ` ×${w.hardpoints}` : '';
        return `${label}${hp} — ${fmt(w.damage)} dmg at ${fmt(w.rate, 1)}/s out to ${km(w.range)}`;
      })
      .join('. ');
    row('Guns', `${guns}.`);
  } else if (def.repairRate) {
    row('Repair', `${fmt(def.repairRate)} hull/s within ${km(def.repairRange || 0)}.`);
  } else {
    row('Guns', 'Unarmed.');
  }

  if (def.harvestRate) {
    row('Harvest', `${fmt(def.harvestRate)}/s, hold of ${fmt(def.capacity || 0)}.`);
  }

  /* The whole reason this panel exists. */
  if (def.counteredBy) row('Beaten by', def.counteredBy, 'weak');

  const from = (def.buildableBy || []).map((c) => (SHIPS[c] ? SHIPS[c].name : c));
  row('Built at', from.length ? from.join(', ') : 'Nothing. You start with it.');

  card.appendChild(rows);
  return card;
}

function affinitySection() {
  const wrap = el('div', 'vsc__scroll');
  const table = el('table', 'vsc-table');
  const caption = el(
    'caption',
    null,
    'Damage multiplier by weapon type against target role — the same table the ' +
      'combat code multiplies by. Above 1.00 is a counter; below 0.50 is a ' +
      'weapon being used on the wrong thing.',
  );
  table.appendChild(caption);

  const AFF = affinityTable();
  const types = Object.keys(AFF);
  const roles = ROLE_ORDER.filter((r) => Object.prototype.hasOwnProperty.call(AFF[types[0]], r));

  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', null, 'Weapon'));
  for (const r of roles) {
    const th = el('th', null, r);
    th.setAttribute('scope', 'col');
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const t of types) {
    const tr = el('tr');
    const th = el('th', null, WEAPON_LABEL[t] || t);
    th.setAttribute('scope', 'row');
    tr.appendChild(th);
    for (const r of roles) {
      const v = AFF[t][r];
      const td = el('td', null, Number.isFinite(v) ? v.toFixed(2) : '—');
      if (v >= 1.2) td.classList.add('is-strong');
      else if (v <= 0.5) td.classList.add('is-weak');
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/** The six verbs a new commander needs, lifted from `input.js`'s own table. */
function essentialKeys() {
  const wanted = new Set(['Space', 'Right click', 'A', 'G', 'S', 'Tab', 'F', 'Z / X / C']);
  const rows = [];
  for (const group of CONTROL_SCHEME) {
    for (const [k, d] of group.rows) {
      if (wanted.has(k)) rows.push([k, d]);
    }
  }
  const list = el('dl', 'vsc__defs');
  for (const [k, d] of rows) {
    const def = el('div', 'vsc__def');
    def.append(el('dt', null, k), el('dd', null, d));
    list.appendChild(def);
  }
  return list;
}

/* ---------------------------------------------------------------- the panel */

export class Codex {
  /**
   * @param {object} opts
   * @param {() => object|null} [opts.getWorld] live `World`, for the readouts
   */
  constructor(opts = {}) {
    this.getWorld = opts.getWorld || (() => (window.__VS ? window.__VS.world : null));
    /* Inside a shell panel the host already prints "Codex" in its own chrome,
       so ours would be the second one on screen. Only the standalone overlay
       has to introduce itself. */
    this.compact = !!opts.compact;
    this.id = `vsc${++uid}`;
    this.root = null;
    this._live = null;
    this._tabs = [];
    this._panels = [];
  }

  /** Build the DOM into `container`. Called once, lazily, by the host. */
  mount(container) {
    if (!container) return null;
    const root = el('div', 'vsc');
    if (!this.compact) root.appendChild(el('p', 'vsc__eyebrow', 'Void Sovereign · Codex'));
    root.appendChild(el('h2', 'vsc__title', 'How this is fought'));

    const tabs = el('div', 'vsc__tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Codex sections');
    root.appendChild(tabs);

    const sections = [
      ['brief', 'Briefing', () => this._briefing()],
      ['fleet', 'The fleet', () => this._fleet()],
      ['counters', 'Counters', () => this._counters()],
      ['economy', 'Economy', () => this._economy()],
    ];

    sections.forEach(([key, label, build], i) => {
      const tab = el('button', 'vsc__tab', label);
      tab.type = 'button';
      tab.id = `${this.id}-t-${key}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(i === 0));
      tab.setAttribute('aria-controls', `${this.id}-p-${key}`);
      tab.tabIndex = i === 0 ? 0 : -1;
      tabs.appendChild(tab);

      const panel = build();
      panel.classList.add('vsc__panel');
      panel.id = `${this.id}-p-${key}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.tabIndex = 0;
      if (i !== 0) panel.hidden = true;
      root.appendChild(panel);

      this._tabs.push(tab);
      this._panels.push(panel);
    });

    tabs.addEventListener('click', (e) => {
      const t = e.target instanceof Element ? e.target.closest('.vsc__tab') : null;
      if (t) this._select(this._tabs.indexOf(t));
    });
    /* Arrow keys inside a tablist are the accessible default, and getting them
       for free is worth eight lines. */
    tabs.addEventListener('keydown', (e) => {
      const i = this._tabs.indexOf(document.activeElement);
      if (i < 0) return;
      let next = -1;
      if (e.key === 'ArrowRight') next = (i + 1) % this._tabs.length;
      else if (e.key === 'ArrowLeft') next = (i - 1 + this._tabs.length) % this._tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = this._tabs.length - 1;
      if (next < 0) return;
      e.preventDefault();
      this._select(next);
      this._tabs[next].focus();
    });

    container.appendChild(root);
    this.root = root;
    this.refresh();
    return root;
  }

  _select(i) {
    if (i < 0 || i >= this._tabs.length) return;
    this._tabs.forEach((t, k) => {
      t.setAttribute('aria-selected', String(k === i));
      t.tabIndex = k === i ? 0 : -1;
      this._panels[k].hidden = k !== i;
    });
  }

  /** Host hook: called every time the panel is opened. */
  onOpen() {
    this.refresh();
  }

  onClose() {}

  /** Repaint everything that comes from the running match. */
  refresh() {
    if (!this._live) return;
    const world = this.getWorld ? this.getWorld() : null;
    const cells = this._live;
    const set = (key, value) => {
      if (cells[key]) cells[key].textContent = value;
    };

    if (!world || !world.teams) {
      for (const k in cells) set(k, '—');
      return;
    }
    const me = world.humanTeam === undefined ? 0 : world.humanTeam;
    const mine = world.teams[me];
    const theirs = world.teams[me ^ 1];
    if (!mine || !theirs) return;

    set('sovMine', `${Math.round(mine.sovereignty)}%`);
    set('sovTheirs', `${Math.round(theirs.sovereignty)}%`);
    set('seams', `${mine.seams || 0} / ${world.contestedSeams || 0}`);
    set('seamsTheirs', String(theirs.seams || 0));
    set('pop', `${Math.round(mine.popUsed || 0)} / ${Math.round(mine.popCap || 0)}`);
    set('upkeep', times(mine.upkeepScale === undefined ? 1 : mine.upkeepScale));
    set('control', times(mine.controlScale === undefined ? 1 : mine.controlScale));
    set('income', times(mine.incomeScale === undefined ? 1 : mine.incomeScale));
  }

  /* ------------------------------------------------------------- sections */

  _briefing() {
    const s = el('section');

    const lede = el('p', 'vsc__lede');
    lede.append(
      document.createTextNode('You command '),
      el('strong', null, 'the Pale Meridian'),
      document.createTextNode(
        ' — one Mothership and whatever it can still build. Sixty kilometres of ' +
          'drift away sits ',
      ),
      el('strong', null, 'the Ochre Reach'),
      document.createTextNode(
        ', flying the same thirteen classes off the same drawings. There is no ' +
          'hull you have that they do not. Everything that separates you is where ' +
          'you choose to stand.',
      ),
    );
    s.appendChild(lede);

    s.appendChild(el('h3', 'vsc__h', 'Three ways this ends'));
    const wins = el('dl', 'vsc__defs');
    const win = (k, v) => {
      const d = el('div', 'vsc__def');
      d.append(el('dt', null, k), el('dd', null, v));
      wins.appendChild(d);
    };
    win(
      'Base — their Mothership dies',
      'The fastest ending when you can take it. It is the largest object either ' +
        'side owns and the only one that cannot be rebuilt.',
    );
    win(
      'Sovereignty — their claim runs out',
      'Both sides start at 100%. Hold more of the contested band than they do ' +
        'and theirs drains, at a rate set by the size of your margin. At zero, ' +
        'the field recognises you and the match is over — whatever the kill ' +
        'ratio said.',
    );
    win(
      'Attrition — nothing left to rebuild with',
      'No yards, no collectors and no fleet worth the name. The result is ' +
        'called rather than making you hunt the last hauler across an empty map.',
    );
    s.appendChild(wins);

    s.appendChild(el('h3', 'vsc__h', 'The board, right now'));
    s.appendChild(this._liveBlock([
      ['sovMine', 'Your sovereignty'],
      ['sovTheirs', 'Theirs', 'foe'],
      ['seams', 'Contested seams held'],
      ['seamsTheirs', 'Held by them', 'foe'],
    ]));

    s.appendChild(el('h3', 'vsc__h', 'The verbs that matter'));
    s.appendChild(
      el(
        'p',
        'vsc__p',
        'The full control scheme is on the H card. These are the ones a new ' +
          'commander is most often missing.',
      ),
    );
    s.appendChild(essentialKeys());

    s.appendChild(el('h3', 'vsc__h', 'A fleet is a thing you keep'));
    const vet = el('p', 'vsc__p');
    const tiers = VETERANCY.filter((v) => v.name).map(
      (v) => `${v.name} at ${v.at} kill-value (+${Math.round((v.damage - 1) * 100)}% damage, ` +
        `+${Math.round((v.hull - 1) * 100)}% hull)`,
    );
    vet.textContent =
      'A hull that survives its fights gets measurably better at them — ' +
      `${tiers.join('; ')}. Withdrawing a mauled wing is worth something, and ` +
      'repairing one costs a fraction of replacing it.';
    s.appendChild(vet);

    return s;
  }

  _fleet() {
    const s = el('section');
    s.appendChild(
      el(
        'p',
        'vsc__lede',
        `All ${CLASS_IDS.length} classes, and both fleets field every one of them. ` +
          'Read the last two lines of each card before the numbers: what beats it, ' +
          'and where it is built.',
      ),
    );

    /* Filter rather than paginate — thirteen cards is not a lot, and hiding
       them behind a role tab makes "show me every frigate" a two-click job
       instead of a scroll-and-squint one. */
    const roles = el('div', 'vsc__roles');
    const grid = el('div', 'vsc__grid');
    const cards = [];

    const buttons = [];
    const setFilter = (role) => {
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.role === role));
      for (const c of cards) c.hidden = role !== 'all' && c.dataset.role !== role;
    };

    const mk = (role, label) => {
      const b = el('button', 'vsc__role', label);
      b.type = 'button';
      b.dataset.role = role;
      b.setAttribute('aria-pressed', String(role === 'all'));
      b.addEventListener('click', () => setFilter(role));
      buttons.push(b);
      roles.appendChild(b);
    };

    mk('all', 'Everything');
    for (const r of ROLE_ORDER) {
      if (CLASS_IDS.some((id) => SHIPS[id].role === r)) mk(r, ROLE_LABEL[r] || r);
    }

    const ordered = CLASS_IDS.slice().sort((a, b) => {
      const ra = ROLE_ORDER.indexOf(SHIPS[a].role);
      const rb = ROLE_ORDER.indexOf(SHIPS[b].role);
      if (ra !== rb) return ra - rb;
      return SHIPS[a].cost - SHIPS[b].cost;
    });
    for (const id of ordered) {
      const card = shipCard(SHIPS[id]);
      cards.push(card);
      grid.appendChild(card);
    }

    s.append(roles, grid);
    return s;
  }

  _counters() {
    const s = el('section');
    s.appendChild(
      el(
        'p',
        'vsc__lede',
        'Every class has one job and one thing that kills it. This is not flavour ' +
          'text — the numbers below are the multipliers the damage code applies, ' +
          'and you can watch them happen: flak visibly shreds a fighter wing and ' +
          'barely marks a capital, an ion lance opens a capital and cannot track a ' +
          'fighter at all.',
      ),
    );
    s.appendChild(affinitySection());

    s.appendChild(el('h3', 'vsc__h', 'What beats what'));
    const list = el('dl', 'vsc__defs');
    for (const id of CLASS_IDS) {
      const def = SHIPS[id];
      if (!def.counteredBy) continue;
      const d = el('div', 'vsc__def');
      d.append(el('dt', null, def.name), el('dd', null, def.counteredBy));
      list.appendChild(d);
    }
    s.appendChild(list);
    return s;
  }

  _economy() {
    const s = el('section');
    s.appendChild(
      el(
        'p',
        'vsc__lede',
        'Collectors cut ore from a seam and haul it to the nearest yard. That loop ' +
          'is the whole economy: a fleet that loses its collectors stops building ' +
          'about ninety seconds later, and theirs are exactly as exposed as yours.',
      ),
    );

    s.appendChild(el('h3', 'vsc__h', 'Seams, and the ones worth fighting for'));
    s.appendChild(
      el(
        'p',
        'vsc__p',
        'Home seams sit near your Mothership and are worth exactly their ore. The ' +
          'contested band straddles the midline, is placed the same distance from ' +
          'both starts, and is the only ground that pays a premium and runs a clock.',
      ),
    );

    const rules = el('dl', 'vsc__defs');
    const rule = (k, v) => {
      const d = el('div', 'vsc__def');
      d.append(el('dt', null, k), el('dd', null, v));
      rules.appendChild(d);
    };
    rule(
      'Standing on it',
      `Anything within ${km(CONTROL.RADIUS)} of the cluster edge counts. Presence ` +
        'is armed, mobile hulls weighed by what they cost — twenty Probes do not ' +
        'hold ground against a Destroyer. Collectors and yards do not count at all.',
    );
    rule(
      'Taking it',
      `About ${Math.round(CONTROL.CAPTURE)} seconds of unopposed presence takes a ` +
        'neutral seam. Contested, it is a tug-of-war: the seam swings toward ' +
        'whoever is genuinely winning the fight over it, and only deadlocks when ' +
        `the two sides are within ${Math.round(CONTROL.DEADZONE * 100)}% of matched.`,
    );
    rule(
      'Keeping it',
      'A seam stays yours until somebody pushes you off it — but one you walk ' +
        `away from drifts back to neutral at ${Math.round(CONTROL.DECAY * 100)}% of ` +
        'the capture rate. Ground you left is not ground you hold.',
    );
    rule(
      'What it pays',
      `Every contested seam you hold lifts your income by ` +
        `${Math.round(CONTROL.INCOME_PER_SEAM * 100)}%, and holding more of the band ` +
        'than they do drains their sovereignty.',
    );
    s.appendChild(rules);

    s.appendChild(el('h3', 'vsc__h', 'Upkeep — why the fiftieth fighter is worth less'));
    const up = probeUpkeep();
    const upP = el('p', 'vsc__p');
    if (up.free >= 0) {
      const rows = up.samples
        .map((x) => `${x.pop} pop → ${times(x.scale)}`)
        .join(', ');
      upP.textContent =
        `The first ${up.free} points of population earn at full rate. Above that, ` +
        `income falls off smoothly and continuously: ${rows}. Nothing is ever ` +
        'taken away from you — a lean fleet simply earns more per hull than a ' +
        'maxed one, which is the brake that stops a won fight from deciding the ' +
        'whole match.';
    } else {
      upP.textContent =
        'Income falls off smoothly as population rises above a free allowance. ' +
        'Nothing is ever taken away from you — a lean fleet earns more per hull ' +
        'than a maxed one.';
    }
    s.appendChild(upP);

    s.appendChild(el('h3', 'vsc__h', 'Your economy, right now'));
    s.appendChild(this._liveBlock([
      ['pop', 'Population'],
      ['upkeep', 'Upkeep multiplier'],
      ['control', 'Seam multiplier'],
      ['income', 'Income multiplier'],
    ]));
    s.appendChild(
      el(
        'p',
        'vsc__p',
        'The three terms are kept separate all the way to the payout so you can ' +
          'see why your income is what it is. An economy that silently halves ' +
          'itself is the same defect as an opponent that silently doubles theirs.',
      ),
    );

    return s;
  }

  /** A row of live readouts, registered so `refresh()` can repaint them. */
  _liveBlock(spec) {
    const wrap = el('dl', 'vsc__live');
    if (!this._live) this._live = {};
    for (const [key, label, mod] of spec) {
      const cell = el('div', `vsc__cell${mod ? ` vsc__cell--${mod}` : ''}`);
      const dd = el('dd', null, '—');
      cell.append(el('dt', null, label), dd);
      wrap.appendChild(cell);
      this._live[key] = dd;
    }
    return wrap;
  }

  dispose() {
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
    this._live = null;
    this._tabs.length = 0;
    this._panels.length = 0;
  }
}

/* ------------------------------------------------------------ shell hosting */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Make the codex reachable, with or without Lane A's shell.
 *
 * Returns a handle whose `open()` prefers `shell.openPanel('codex')` and falls
 * back to a self-owned overlay. The shell is polled for rather than required,
 * because the three lanes land independently and a codex that only exists once
 * another lane has shipped is a codex that does not exist.
 */
export function installCodex(opts = {}) {
  const getWorld = opts.getWorld || (() => (window.__VS ? window.__VS.world : null));
  const openListeners = new Set();

  let shellPanel = null;    // Codex instance mounted inside the shell
  let overlayPanel = null;  // Codex instance mounted inside our own overlay
  let overlay = null;
  let registered = false;
  let lastFocus = null;
  let disposed = false;

  const announce = () => {
    for (const fn of Array.from(openListeners)) {
      try {
        fn();
      } catch (e) {
        /* a listener must not be able to close the codex */
      }
    }
  };

  function shell() {
    const vs = window.__VS;
    return vs && vs.shell && typeof vs.shell.registerPanel === 'function' ? vs.shell : null;
  }

  function tryRegister() {
    if (registered || disposed) return false;
    const sh = shell();
    if (!sh) return false;
    registered = true;
    try {
      sh.registerPanel({
        id: 'codex',
        title: 'Codex',
        where: ['title', 'pause'],
        order: 30,
        mount(container) {
          shellPanel = new Codex({ getWorld, compact: true });
          shellPanel.mount(container);
        },
        onOpen() {
          if (shellPanel) shellPanel.onOpen();
          announce();
        },
        onClose() {
          if (shellPanel) shellPanel.onClose();
        },
      });
    } catch (e) {
      registered = false;
      return false;
    }
    if (typeof sh.on === 'function') {
      try {
        sh.on('panelOpen', (p) => {
          if (p && p.id === 'codex') announce();
        });
      } catch (e) {
        /* optional */
      }
    }
    return true;
  }

  /* ---------------------------------------------------------- own overlay */

  function buildOverlay() {
    if (overlay) return overlay;
    const root = document.createElement('div');
    root.className = 'vst-overlay';
    root.id = 'vs-codex-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Codex');

    const inner = el('div', 'vst-overlay__inner');
    const close = el('button', 'vst-overlay__close', 'Close ✕');
    close.type = 'button';
    close.addEventListener('click', () => closeOverlay());
    inner.appendChild(close);
    root.appendChild(inner);

    overlayPanel = new Codex({ getWorld });
    overlayPanel.mount(inner);

    /* Escape closes the topmost overlay — the shell contract's rule, applied
       to the one overlay this lane owns. Stopping propagation is the whole
       point: `core/input.js` and `ui/hud.js` both listen for keydown on
       window, and without this the same press would also clear the selection
       behind the panel. */
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeOverlay();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(root.querySelectorAll(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      e.stopPropagation();
    });

    document.body.appendChild(root);
    overlay = root;
    return root;
  }

  function openOverlay() {
    const root = buildOverlay();
    if (overlayPanel) overlayPanel.onOpen();
    lastFocus = document.activeElement;
    root.classList.add('is-open');
    const first = root.querySelector(FOCUSABLE);
    if (first) first.focus();
    announce();
  }

  function closeOverlay() {
    if (!overlay) return;
    overlay.classList.remove('is-open');
    if (overlayPanel) overlayPanel.onClose();
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
  }

  const handle = {
    /** True once the shell has taken the panel registration. */
    get registeredWithShell() {
      return registered;
    },

    tryRegister,

    open() {
      if (disposed) return false;
      const sh = shell();
      if (tryRegister() || registered) {
        if (sh && typeof sh.openPanel === 'function') {
          try {
            sh.openPanel('codex');
            /* `onOpen` announces; if the shell declines the transition it will
               not, and the fallback below is deliberately not taken — a shell
               that says "no" is answering for a reason. */
            return true;
          } catch (e) {
            /* fall through to the overlay */
          }
        }
      }
      openOverlay();
      return true;
    },

    close() {
      const sh = shell();
      if (registered && sh && typeof sh.closePanel === 'function') {
        try {
          sh.closePanel();
        } catch (e) {
          /* ignore */
        }
      }
      closeOverlay();
    },

    isOpen() {
      return !!(overlay && overlay.classList.contains('is-open'));
    },

    /** Fired whenever the codex is shown, however it was reached. */
    onOpen(fn) {
      if (typeof fn === 'function') openListeners.add(fn);
      return () => openListeners.delete(fn);
    },

    refresh() {
      if (shellPanel) shellPanel.refresh();
      if (overlayPanel) overlayPanel.refresh();
    },

    dispose() {
      disposed = true;
      openListeners.clear();
      if (overlayPanel) overlayPanel.dispose();
      if (shellPanel) shellPanel.dispose();
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
      overlayPanel = null;
      shellPanel = null;
    },
  };

  tryRegister();
  return handle;
}
