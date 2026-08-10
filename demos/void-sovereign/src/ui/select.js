import { SHIPS, ROLE, approxRadius, damageAffinity } from '../ships/catalog.js';

/* Selection surfaces: the grouped roster along the bottom-left, and the
   world-space marker layer that draws brackets, health pips, target reticles
   and order markers over the 3D view.

   The marker layer is the hot path of the whole HUD — it runs every frame over
   the live selection. Four rules keep it inside budget:

     1. Nothing is created or destroyed per frame. Every element comes from a
        pool and is parked with `opacity: 0` when unused.
     2. Only `transform` and `opacity` are ever written, and only when the
        value has actually moved. Sizes are expressed by translating four
        corner ticks outward from a zero-size anchor rather than by setting
        width/height, so a bracket never triggers layout and its 1px stroke
        stays 1px whether it frames an interceptor or a mothership.
     3. Everything is culled off-screen, and a culled contact releases its
        pool slot to the next one — so the cost tracks what you can see, not
        what you have selected.
     4. Two pools, not one. A readable contact gets a nine-node bracket; a
        contact smaller than the ticks themselves gets a one-node pip. A
        200-ship fleet is therefore ~200 DOM nodes rather than ~2,000, and
        past the group threshold it collapses to a single bracket plus a
        constellation of pips. */

/* A full bracket is nine nodes; a pip is one. The caps are chosen so the
   worst case is a few hundred elements, all of them transform-only. */
const MAX_BRACKETS = 96;
const MAX_PIPS = 320;
const MAX_RETICLES = 14;
const MAX_ORDERS = 16;

/* Past this many selected hulls, individual brackets stop helping: you get one
   bracket around the whole formation and a pip per ship. */
const GROUP_AT = 140;

/* Below this half-size a bracket is visual noise, so it becomes a pip. This is
   what makes a 300-ship fleet at long range read as a constellation rather
   than a mess of overlapping boxes. */
const PIP_HALF = 8;
const CORNER = 9;
const SMALL_CORNER = 5;
const RET_CORNER = 6;
const GROUP_CORNER = 16;

const ROLE_ORDER = {
  structure: 0,
  capital: 1,
  frigate: 2,
  support: 3,
  corvette: 4,
  fighter: 5,
  resource: 6,
};

/** Render position. Falls back to sim truth before the first interpolation. */
function posOf(e) {
  return (e.object3D && e.object3D.position) || e.position;
}

function svgEl(name) {
  return document.createElementNS('http://www.w3.org/2000/svg', name);
}

/** Build a 24×24 silhouette icon from the catalog path data. */
export function silhouetteIcon(classId, className) {
  const svg = svgEl('svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) svg.setAttribute('class', className);
  const path = svgEl('path');
  const def = SHIPS[classId];
  path.setAttribute('d', (def && def.silhouette) || 'M12 3 L20 20 H4 Z');
  svg.appendChild(path);
  return { svg, path };
}

/** Collapse a selection into per-class groups with aggregate health. */
export function groupSelection(ids, ctx) {
  const byClass = new Map();
  for (let i = 0; i < ids.length; i++) {
    const e = ctx.entity(ids[i]);
    if (!e || e.alive === false) continue;
    let g = byClass.get(e.classId);
    if (!g) {
      g = {
        classId: e.classId,
        def: SHIPS[e.classId] || null,
        ids: [],
        hull: 0,
        maxHull: 0,
        shield: 0,
        maxShield: 0,
        value: 0,
      };
      byClass.set(e.classId, g);
    }
    g.ids.push(e.id);
    g.hull += e.hull || 0;
    g.maxHull += e.maxHull || (g.def ? g.def.hull : 0) || 1;
    g.shield += e.shield || 0;
    g.maxShield += e.maxShield || (g.def ? g.def.shield : 0) || 0;
    g.value += g.def ? g.def.cost : 0;
  }
  const out = Array.from(byClass.values());
  out.sort((a, b) => {
    const ra = a.def ? ROLE_ORDER[a.def.role] ?? 9 : 9;
    const rb = b.def ? ROLE_ORDER[b.def.role] ?? 9 : 9;
    if (ra !== rb) return ra - rb;
    return (b.def ? b.def.cost : 0) - (a.def ? a.def.cost : 0);
  });
  return out;
}

/* ========================================================================== */
/*  Ship detail card                                                           */
/* ========================================================================== */

/* The rock-paper-scissors in `catalog.js` is well shaped and, until now,
   completely invisible: the AFFINITY table and the hand-written `description`
   on all thirteen classes were never rendered anywhere. A player could only
   learn the counters by losing to them.

   This card is the fix. It reads the catalog and nothing else, so it cannot
   drift from the balance table, and the counter lines are *computed* from the
   same affinity multipliers combat.js applies — not written by hand. */

const COUNTER_ROLES = [
  [ROLE.FIGHTER, 'Fighters'],
  [ROLE.CORVETTE, 'Corvettes'],
  [ROLE.FRIGATE, 'Frigates'],
  [ROLE.CAPITAL, 'Capitals'],
  [ROLE.SUPPORT, 'Support'],
  [ROLE.STRUCTURE, 'Structures'],
];

const ROLE_NAME = {
  fighter: 'Strike craft',
  corvette: 'Corvette',
  frigate: 'Frigate',
  capital: 'Capital',
  support: 'Support',
  resource: 'Economy',
  structure: 'Fleet base',
};

/** Effective damage per second this class puts on each target role. */
function counterProfile(def) {
  const weapons = def && def.weapons;
  if (!weapons || !weapons.length) return null;
  const rows = [];
  let peak = 0;
  for (const [role, label] of COUNTER_ROLES) {
    let dps = 0;
    for (const w of weapons) {
      dps += (w.damage || 0) * (w.rate || 0) * (w.hardpoints || 1) * damageAffinity(w.type, role);
    }
    if (dps > peak) peak = dps;
    rows.push({ label, dps });
  }
  if (peak <= 0) return null;

  const strong = [];
  const weak = [];
  for (const r of rows) {
    const k = r.dps / peak;
    if (k >= 0.8) strong.push(r.label);
    else if (k <= 0.34) weak.push(r.label);
  }
  return { strong: strong.slice(0, 3), weak: weak.slice(0, 3) };
}

/* A hairline card, no fill — the same language as the rest of the HUD. It is
   absolutely positioned against its host so showing it never moves anything. */
export class ShipCard {
  constructor({ root, align = 'right' }) {
    const el = document.createElement('div');
    el.className = `vsh-card vsh-card--${align}`;
    el.setAttribute('role', 'tooltip');
    el.setAttribute('aria-hidden', 'true');

    const head = document.createElement('div');
    head.className = 'vsh-card__head';
    this.name = document.createElement('span');
    this.name.className = 'vsh-card__name';
    this.cost = document.createElement('span');
    this.cost.className = 'vsh-card__cost vsh-num';
    head.append(this.name, this.cost);

    this.meta = document.createElement('p');
    this.meta.className = 'vsh-card__meta';
    this.desc = document.createElement('p');
    this.desc.className = 'vsh-card__desc';

    this.counters = document.createElement('div');
    this.counters.className = 'vsh-card__counters';
    this.strong = this._counterRow('Strong', 'strong');
    this.weak = this._counterRow('Weak', 'weak');

    el.append(head, this.meta, this.desc, this.counters);
    root.appendChild(el);
    this.el = el;
    this.classId = null;
  }

  _counterRow(label, mod) {
    const row = document.createElement('div');
    row.className = `vsh-card__row vsh-card__row--${mod}`;
    const k = document.createElement('span');
    k.className = 'vsh-card__k';
    k.textContent = label;
    const v = document.createElement('span');
    v.className = 'vsh-card__v';
    row.append(k, v);
    this.counters.appendChild(row);
    return { row, v };
  }

  show(classId) {
    const def = SHIPS[classId];
    if (!def) return this.hide();
    if (this.classId !== classId) {
      this.classId = classId;
      this.name.textContent = def.name;
      this.cost.textContent = def.cost > 0 ? `${def.cost} RU` : '';
      const bits = [ROLE_NAME[def.role] || def.role, `${def.length} m`];
      if (def.buildTime > 0) bits.push(`${def.buildTime} s`);
      if (def.popCost > 0) bits.push(`${def.popCost} pop`);
      if (def.squadSize > 1) bits.push(`wing of ${def.squadSize}`);
      this.meta.textContent = bits.join(' · ');
      this.desc.textContent = def.description || '';

      const c = counterProfile(def);
      const has = !!(c && (c.strong.length || c.weak.length));
      this.counters.hidden = !has;
      if (has) {
        this.strong.row.hidden = !c.strong.length;
        this.weak.row.hidden = !c.weak.length;
        this.strong.v.textContent = c.strong.join(' · ');
        this.weak.v.textContent = c.weak.join(' · ');
      }
    }
    this.el.classList.add('is-live');
    this.el.setAttribute('aria-hidden', 'false');
  }

  hide() {
    this.el.classList.remove('is-live');
    this.el.setAttribute('aria-hidden', 'true');
  }

  dispose() {
    this.el.remove();
  }
}

/* ========================================================================== */
/*  Roster                                                                     */
/* ========================================================================== */

export class SelectionRoster {
  constructor({ root, ctx }) {
    this.ctx = ctx;
    this.groups = [];
    this.chips = [];
    this._acc = 0;
    this._activeClass = null;

    const el = document.createElement('div');
    el.className = 'vsh-roster';
    el.setAttribute('aria-label', 'Selected units');

    const head = document.createElement('div');
    head.className = 'vsh-roster__head';
    this.count = document.createElement('span');
    this.count.className = 'vsh-roster__n vsh-num';
    this.count.textContent = '0';
    const word = document.createElement('span');
    word.className = 'vsh-label';
    word.textContent = 'Selected';
    this.meta = document.createElement('span');
    this.meta.className = 'vsh-roster__meta';
    this.meta.textContent = '';
    head.append(this.count, word, this.meta);

    this.list = document.createElement('div');
    this.list.className = 'vsh-roster__list';

    el.append(head, this.list);
    root.appendChild(el);
    this.el = el;
    this.card = new ShipCard({ root: el, align: 'left' });

    this._onClick = (ev) => this._hit(ev, false);
    this._onDbl = (ev) => this._hit(ev, true);
    this._onOver = (ev) => this._peek(ev);
    this._onOut = () => this.card.hide();
    this.list.addEventListener('click', this._onClick);
    this.list.addEventListener('dblclick', this._onDbl);
    this.list.addEventListener('pointerover', this._onOver);
    this.list.addEventListener('pointerleave', this._onOut);
    this.list.addEventListener('focusin', this._onOver);
    this.list.addEventListener('focusout', this._onOut);
  }

  /* Hovering or tabbing to a class chip explains what the class is for. The
     counters are otherwise unlearnable except by losing. */
  _peek(ev) {
    const btn = ev.target.closest && ev.target.closest('.vsh-chip');
    if (!btn) return;
    const g = this.groups[Number(btn.dataset.i)];
    if (g) this.card.show(g.classId);
  }

  _hit(ev, all) {
    const btn = ev.target.closest('.vsh-chip');
    if (!btn) return;
    const idx = Number(btn.dataset.i);
    const g = this.groups[idx];
    if (!g) return;
    ev.preventDefault();
    if (all) {
      this.ctx.select(this._onScreenOfClass(g.classId));
      this.ctx.toast(`All ${g.def ? g.def.name : g.classId} on screen`, 'info');
    } else {
      this._activeClass = g.classId;
      this.ctx.select(g.ids.slice());
    }
  }

  /** Every friendly of this class currently inside the viewport. */
  _onScreenOfClass(classId) {
    const ctx = this.ctx;
    const proj = ctx.proj;
    const out = [];
    for (const e of ctx.entities()) {
      if (e.alive === false || e.team !== ctx.team || e.classId !== classId) continue;
      const p = posOf(e);
      if (!p) continue;
      if (!proj.project(p.x, p.y, p.z)) continue;
      if (proj.sx < 0 || proj.sx > proj.w || proj.sy < 0 || proj.sy > proj.h) continue;
      out.push(e.id);
    }
    return out;
  }

  setSelection(ids) {
    const ctx = this.ctx;
    this.groups = groupSelection(ids, ctx);
    if (this.groups.length && !this.groups.some((g) => g.classId === this._activeClass)) {
      this._activeClass = null;
    }

    const n = this.groups.reduce((s, g) => s + g.ids.length, 0);
    this.count.textContent = String(n);
    let value = 0;
    for (const g of this.groups) value += g.value;
    this.meta.textContent = n ? `${value.toLocaleString('en-GB')} RU` : '';
    this.el.classList.toggle('is-live', n > 0);

    for (let i = 0; i < this.groups.length; i++) {
      const chip = this._chip(i);
      const g = this.groups[i];
      if (chip.classId !== g.classId) {
        chip.classId = g.classId;
        chip.path.setAttribute(
          'd',
          (g.def && g.def.silhouette) || 'M12 3 L20 20 H4 Z',
        );
        chip.name.textContent = g.def ? g.def.name : g.classId;
      }
      chip.n.textContent = String(g.ids.length);
      chip.el.hidden = false;
      chip.el.setAttribute(
        'aria-label',
        `${g.ids.length} ${g.def ? g.def.name : g.classId}. Click to select this group, double-click to select all on screen.`,
      );
      chip.el.classList.toggle('is-active', g.classId === this._activeClass);
      chip.lastHull = -1;
      chip.lastShield = -1;
    }
    for (let i = this.groups.length; i < this.chips.length; i++) {
      this.chips[i].el.hidden = true;
    }
    this._bars();
  }

  _chip(i) {
    let c = this.chips[i];
    if (c) return c;

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'vsh-chip';
    el.dataset.i = String(i);

    const icon = silhouetteIcon('interceptor', 'vsh-chip__icon');
    const top = document.createElement('span');
    top.className = 'vsh-chip__top';
    const n = document.createElement('span');
    n.className = 'vsh-chip__n';
    const name = document.createElement('span');
    name.className = 'vsh-chip__name';
    top.append(n, name);

    const bars = document.createElement('span');
    bars.className = 'vsh-chip__bars';
    const hullBar = document.createElement('i');
    hullBar.className = 'vsh-bar vsh-bar--hull';
    const hullFill = document.createElement('i');
    hullFill.className = 'vsh-bar__fill';
    hullBar.appendChild(hullFill);
    const shBar = document.createElement('i');
    shBar.className = 'vsh-bar vsh-bar--shield';
    const shFill = document.createElement('i');
    shFill.className = 'vsh-bar__fill';
    shBar.appendChild(shFill);
    bars.append(hullBar, shBar);

    el.append(icon.svg, top, bars);
    this.list.appendChild(el);

    c = {
      el, path: icon.path, n, name, hullBar, hullFill, shBar, shFill,
      classId: null, lastHull: -1, lastShield: -1,
    };
    this.chips[i] = c;
    return c;
  }

  /** Aggregate bars. Cheap, but there is no point running it at 60 Hz. */
  _bars() {
    const ctx = this.ctx;
    for (let i = 0; i < this.groups.length; i++) {
      const g = this.groups[i];
      const chip = this.chips[i];
      if (!chip || chip.el.hidden) continue;

      let hull = 0;
      let maxHull = 0;
      let shield = 0;
      let maxShield = 0;
      let alive = 0;
      for (let k = 0; k < g.ids.length; k++) {
        const e = ctx.entity(g.ids[k]);
        if (!e || e.alive === false) continue;
        alive++;
        hull += e.hull || 0;
        maxHull += e.maxHull || 1;
        shield += e.shield || 0;
        maxShield += e.maxShield || 0;
      }
      if (alive !== Number(chip.n.textContent)) chip.n.textContent = String(alive);

      const h = maxHull > 0 ? Math.max(0, Math.min(1, hull / maxHull)) : 0;
      if (Math.abs(h - chip.lastHull) > 0.008) {
        chip.hullFill.style.transform = `scaleX(${h.toFixed(3)})`;
        chip.hullBar.classList.toggle('is-low', h < 0.34);
        chip.lastHull = h;
      }
      const s = maxShield > 0 ? Math.max(0, Math.min(1, shield / maxShield)) : 0;
      if (Math.abs(s - chip.lastShield) > 0.008) {
        chip.shFill.style.transform = `scaleX(${s.toFixed(3)})`;
        chip.shBar.style.opacity = maxShield > 0 ? '1' : '0.25';
        chip.lastShield = s;
      }
    }
  }

  update(dt) {
    this._acc += dt;
    if (this._acc < 0.12) return;
    this._acc = 0;
    if (this.groups.length) this._bars();
  }

  dispose() {
    this.list.removeEventListener('click', this._onClick);
    this.list.removeEventListener('dblclick', this._onDbl);
    this.list.removeEventListener('pointerover', this._onOver);
    this.list.removeEventListener('pointerleave', this._onOut);
    this.list.removeEventListener('focusin', this._onOver);
    this.list.removeEventListener('focusout', this._onOut);
    this.card.dispose();
    this.el.remove();
    this.chips.length = 0;
    this.groups.length = 0;
  }
}

/* ========================================================================== */
/*  World-space markers                                                        */
/* ========================================================================== */

export class WorldMarkers {
  constructor({ root, ctx }) {
    this.ctx = ctx;
    this.brackets = [];
    this.pips = [];
    this.reticles = [];
    this.orders = [];
    this._hits = new Map(); // entityId -> seconds of remaining "under fire" flash
    this._spin = 0;
    this._hidden = false;

    const el = document.createElement('div');
    el.className = 'vsh-layer vsh-layer--world';
    root.appendChild(el);
    this.el = el;

    // Pips paint under brackets, so they get their own host created first.
    this.pipHost = document.createElement('div');
    this.pipHost.className = 'vsh-layer__pips';
    el.appendChild(this.pipHost);

    this.group = this._makeBracket(true);
    this.group.el.classList.add('vsh-brk--group');
    this.group.count = document.createElement('i');
    this.group.count.className = 'vsh-brk__count vsh-num';
    this.group.el.appendChild(this.group.count);
  }

  setHidden(hidden) {
    if (this._hidden === hidden) return;
    this._hidden = hidden;
    this.el.hidden = hidden;
  }

  /* ------------------------------------------------------------- pools */

  _makeBracket(isGroup) {
    const el = document.createElement('div');
    el.className = 'vsh-brk';
    const corners = [];
    const names = ['tl', 'tr', 'bl', 'br'];
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('i');
      c.className = `vsh-brk__c vsh-brk__c--${names[i]}`;
      el.appendChild(c);
      corners.push(c);
    }
    const hp = document.createElement('i');
    hp.className = 'vsh-brk__hp';
    const hpf = document.createElement('i');
    hpf.className = 'vsh-brk__hpf';
    hp.appendChild(hpf);
    const sh = document.createElement('i');
    sh.className = 'vsh-brk__sh';
    const shf = document.createElement('i');
    shf.className = 'vsh-brk__shf';
    sh.appendChild(shf);
    el.append(hp, sh);
    this.el.appendChild(el);
    return {
      el, corners, hp, hpf, sh, shf,
      half: -1, hull: -1, shield: -1, live: false, low: false,
      small: false, hurt: false, enemy: false, isGroup: !!isGroup,
    };
  }

  _bracket(i) {
    let b = this.brackets[i];
    if (!b) {
      b = this._makeBracket(false);
      this.brackets[i] = b;
    }
    return b;
  }

  /* One node, one transform write. This is what keeps a 300-hull selection
     affordable — the bracket's nine elements would not be. */
  _pip(i) {
    let p = this.pips[i];
    if (!p) {
      const el = document.createElement('i');
      el.className = 'vsh-pip';
      this.pipHost.appendChild(el);
      p = { el, live: false, low: false, enemy: false };
      this.pips[i] = p;
    }
    return p;
  }

  /* A target lock is the same corner-tick language as a selection bracket,
     turned 45° and slowly rotating. Four loose dashes read as debris; four
     corners read as a lock. */
  _makeReticle() {
    const el = document.createElement('div');
    el.className = 'vsh-ret';
    const ticks = [];
    const names = ['tl', 'tr', 'bl', 'br'];
    for (let i = 0; i < 4; i++) {
      const t = document.createElement('i');
      t.className = `vsh-ret__c vsh-ret__c--${names[i]}`;
      el.appendChild(t);
      ticks.push(t);
    }
    this.el.appendChild(el);
    return { el, ticks, d: -1, live: false, threat: false };
  }

  _reticle(i) {
    let r = this.reticles[i];
    if (!r) {
      r = this._makeReticle();
      this.reticles[i] = r;
    }
    return r;
  }

  _makeOrder() {
    const el = document.createElement('div');
    el.className = 'vsh-ord';
    const ring = document.createElement('i');
    ring.className = 'vsh-ord__ring';
    const v = document.createElement('i');
    v.className = 'vsh-ord__cross';
    const h = document.createElement('i');
    h.className = 'vsh-ord__cross vsh-ord__cross--h';
    const stalk = document.createElement('i');
    stalk.className = 'vsh-ord__stalk';
    const base = document.createElement('i');
    base.className = 'vsh-ord__base';
    el.append(ring, v, h, stalk, base);
    this.el.appendChild(el);
    return { el, ring, stalk, base, life: 0, ttl: 1, x: 0, y: 0, z: 0, targetId: -1, attack: false };
  }

  /* ------------------------------------------------------------ triggers */

  /** A move order landed. Draw the destination with its altitude stalk. */
  addOrder(point, kind) {
    if (!point) return;
    const o = this._takeOrder();
    o.x = point.x;
    o.y = point.y;
    o.z = point.z;
    o.targetId = -1;
    o.attack = kind === 'attack';
    o.ttl = o.attack ? 1.6 : 2.6;
    o.life = o.ttl;
    o.el.classList.toggle('vsh-ord--attack', o.attack);
  }

  /** An attack order landed on a specific hull. The marker tracks it. */
  addAttackOn(targetId) {
    const e = this.ctx.entity(targetId);
    if (!e) return;
    const o = this._takeOrder();
    o.targetId = targetId;
    o.attack = true;
    o.ttl = 1.6;
    o.life = o.ttl;
    o.el.classList.add('vsh-ord--attack');
  }

  _takeOrder() {
    if (this.orders.length < MAX_ORDERS) {
      const o = this._makeOrder();
      this.orders.push(o);
      return o;
    }
    // Recycle the oldest.
    let oldest = this.orders[0];
    for (let i = 1; i < this.orders.length; i++) {
      if (this.orders[i].life < oldest.life) oldest = this.orders[i];
    }
    return oldest;
  }

  /** Something took a hit. Flash its bracket and earn it a threat reticle. */
  flagHit(id) {
    this._hits.set(id, 1.1);
  }

  /* -------------------------------------------------------------- update */

  update(dt) {
    if (this._hidden) return;
    const ctx = this.ctx;
    const proj = ctx.proj;
    const sel = ctx.selection;

    this._spin += dt * (ctx.reduceMotion ? 0 : 22);
    if (this._spin > 360) this._spin -= 360;

    for (const [id, t] of this._hits) {
      const left = t - dt;
      if (left <= 0) this._hits.delete(id);
      else this._hits.set(id, left);
    }

    /* Past the group threshold every contact drops to a pip and the formation
       gets one bracket around it. Below it, size decides: readable hulls get
       a bracket, distant ones a pip, and the two pools fill independently so
       a mixed fleet degrades smoothly instead of all at once. */
    const useGroup = sel.size > GROUP_AT;
    let nBrk = 0;
    let nPip = 0;

    if (useGroup) this._drawGroup();
    else this._park(this.group);

    for (const id of sel) {
      if (nPip >= MAX_PIPS) break;
      const e = ctx.entity(id);
      if (!e || e.alive === false) continue;
      const p = posOf(e);
      if (!p || !proj.project(p.x, p.y, p.z)) continue;

      const radius = e.radius || approxRadius(e.classId);
      const half = Math.min(220, ((radius * proj.scaleK) / proj.cw) * 1.5 + 5);
      const margin = half + 30;
      if (
        proj.sx < -margin || proj.sx > proj.w + margin ||
        proj.sy < -margin || proj.sy > proj.h + margin
      ) continue;

      if (!useGroup && half >= PIP_HALF && nBrk < MAX_BRACKETS) {
        this._drawBracket(this._bracket(nBrk), e, half, proj.sx, proj.sy);
        nBrk++;
      } else {
        this._drawPip(this._pip(nPip), e, proj.sx, proj.sy);
        nPip++;
      }
    }

    for (let i = nBrk; i < this.brackets.length; i++) this._park(this.brackets[i]);
    for (let i = nPip; i < this.pips.length; i++) this._parkPip(this.pips[i]);

    this._drawReticles(proj);
    this._drawOrders(dt, proj);
  }

  _park(b) {
    if (b.live) {
      b.live = false;
      b.el.classList.remove('is-live');
    }
  }

  _parkPip(p) {
    if (p.live) {
      p.live = false;
      p.el.classList.remove('is-live');
    }
  }

  _drawPip(p, e, sx, sy) {
    p.el.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`;

    const enemy = e.team !== this.ctx.team;
    if (enemy !== p.enemy) {
      p.enemy = enemy;
      p.el.classList.toggle('vsh-pip--enemy', enemy);
    }
    const low = (e.hull || 0) < (e.maxHull || 1) * 0.34 || this._hits.has(e.id);
    if (low !== p.low) {
      p.low = low;
      p.el.classList.toggle('vsh-pip--low', low);
    }
    if (!p.live) {
      p.live = true;
      p.el.classList.add('is-live');
    }
  }

  _drawBracket(b, e, half, sx, sy) {
    b.el.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`;

    const enemy = e.team !== this.ctx.team;
    if (enemy !== b.enemy) {
      b.enemy = enemy;
      b.el.classList.toggle('vsh-brk--enemy', enemy);
    }

    /* Two bracket sizes: short ticks in the middle band, full corners once a
       hull is big enough to carry them. Below the small band it is a pip and
       never reaches here. */
    const small = half < 19;
    if (small !== b.small) {
      b.small = small;
      b.el.classList.toggle('vsh-brk--sm', small);
      b.half = -1;
    }
    if (Math.abs(half - b.half) > 0.6) {
      b.half = half;
      this._layout(b, half, small ? SMALL_CORNER : CORNER);
    }

    const maxHull = e.maxHull || 1;
    const hull = Math.max(0, Math.min(1, (e.hull || 0) / maxHull));
    if (Math.abs(hull - b.hull) > 0.01) {
      b.hull = hull;
      b.hpf.style.transform = `scaleX(${hull.toFixed(3)})`;
      const low = hull < 0.34;
      if (low !== b.low) {
        b.low = low;
        b.el.classList.toggle('vsh-brk--low', low);
      }
    }
    const maxShield = e.maxShield || 0;
    const shield = maxShield > 0 ? Math.max(0, Math.min(1, (e.shield || 0) / maxShield)) : 0;
    if (Math.abs(shield - b.shield) > 0.01) {
      b.shield = shield;
      b.shf.style.transform = `scaleX(${shield.toFixed(3)})`;
      b.sh.style.opacity = maxShield > 0 ? '1' : '0';
    }

    const hurt = this._hits.has(e.id);
    if (hurt !== b.hurt) {
      b.hurt = hurt;
      b.el.classList.toggle('is-hit', hurt);
    }

    if (!b.live) {
      b.live = true;
      b.el.classList.add('is-live');
    }
  }

  /** Position the four corner ticks and the pips for a given half-size. */
  _layout(b, half, corner) {
    const h = Math.round(half);
    const c = b.corners;
    c[0].style.transform = `translate(${-h}px,${-h}px)`;
    c[1].style.transform = `translate(${h - corner}px,${-h}px)`;
    c[2].style.transform = `translate(${-h}px,${h - corner}px)`;
    c[3].style.transform = `translate(${h - corner}px,${h - corner}px)`;
    if (!b.isGroup) {
      // Pips grow with the bracket via scaleX, never via width — a width write
      // would be a layout, and the 1-2px bar height is untouched by scaleX.
      const k = Math.max(0.5, Math.min(3.6, half / 19));
      b.hp.style.transform = `translate(${(-15 * k).toFixed(1)}px,${h + 6}px) scaleX(${k.toFixed(2)})`;
      b.sh.style.transform = `translate(${(-15 * k).toFixed(1)}px,${h + 3}px) scaleX(${k.toFixed(2)})`;
    }
  }

  /** One bracket around the screen-space extent of a very large selection. */
  _drawGroup() {
    const ctx = this.ctx;
    const proj = ctx.proj;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let n = 0;

    for (const id of ctx.selection) {
      const e = ctx.entity(id);
      if (!e || e.alive === false) continue;
      const p = posOf(e);
      if (!p || !proj.project(p.x, p.y, p.z)) continue;
      n++;
      if (proj.sx < minX) minX = proj.sx;
      if (proj.sx > maxX) maxX = proj.sx;
      if (proj.sy < minY) minY = proj.sy;
      if (proj.sy > maxY) maxY = proj.sy;
    }

    const g = this.group;
    if (!n) {
      this._park(g);
      return;
    }
    /* Clamp to the viewport before sizing. A fleet spread past the edges of
       the screen would otherwise put its corner ticks — and the count label —
       somewhere the player cannot see them. */
    const pad = 26;
    minX = Math.max(pad, Math.min(proj.w - pad, minX));
    maxX = Math.max(pad, Math.min(proj.w - pad, maxX));
    minY = Math.max(pad + 20, Math.min(proj.h - pad, minY));
    maxY = Math.max(pad + 20, Math.min(proj.h - pad, maxY));

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const half = Math.max(36, Math.max(maxX - minX, maxY - minY) * 0.5 + 22);

    g.el.style.transform = `translate3d(${cx.toFixed(1)}px,${cy.toFixed(1)}px,0)`;
    if (Math.abs(half - g.half) > 1.5) {
      g.half = half;
      this._layout(g, half, GROUP_CORNER);
      g.count.style.transform = `translate(${Math.round(-half)}px,${Math.round(-half) - 16}px)`;
    }
    const label = `${ctx.selection.size} CONTACTS`;
    if (g.count.textContent !== label) g.count.textContent = label;
    if (!g.live) {
      g.live = true;
      g.el.classList.add('is-live');
    }
  }

  /* Reticles mark two things: what the selection is shooting at, and what is
     currently shooting at us. Both are what a commander actually needs. */
  _drawReticles(proj) {
    const ctx = this.ctx;
    const seen = new Set();
    let n = 0;

    for (const id of ctx.selection) {
      if (n >= MAX_RETICLES) break;
      const e = ctx.entity(id);
      if (!e || e.alive === false || e.targetId === undefined || e.targetId === null) continue;
      if (e.targetId < 0) continue;
      const t = ctx.entity(e.targetId);
      if (!t || t.alive === false || seen.has(t.id)) continue;
      seen.add(t.id);
      if (this._drawReticle(this._reticle(n), t, proj, false)) n++;
    }
    for (const id of this._hits.keys()) {
      if (n >= MAX_RETICLES) break;
      if (seen.has(id)) continue;
      const t = ctx.entity(id);
      if (!t || t.alive === false || t.team !== ctx.team) continue;
      seen.add(id);
      if (this._drawReticle(this._reticle(n), t, proj, true)) n++;
    }
    for (let i = n; i < this.reticles.length; i++) {
      const r = this.reticles[i];
      if (r.live) {
        r.live = false;
        r.el.classList.remove('is-live');
      }
    }
  }

  _drawReticle(r, e, proj, threat) {
    const p = posOf(e);
    if (!p || !proj.project(p.x, p.y, p.z)) return false;
    const radius = e.radius || approxRadius(e.classId);
    let d = (radius * proj.scaleK) / proj.cw;
    d = Math.max(9, Math.min(140, d * 1.7 + 7));
    if (
      proj.sx < -d - 20 || proj.sx > proj.w + d + 20 ||
      proj.sy < -d - 20 || proj.sy > proj.h + d + 20
    ) return false;

    r.el.style.transform =
      `translate3d(${proj.sx.toFixed(1)}px,${proj.sy.toFixed(1)}px,0) rotate(${(this._spin + 45).toFixed(1)}deg)`;

    if (Math.abs(d - r.d) > 0.8) {
      r.d = d;
      const t = r.ticks;
      const dd = Math.round(d);
      const c = RET_CORNER;
      t[0].style.transform = `translate(${-dd}px,${-dd}px)`;
      t[1].style.transform = `translate(${dd - c}px,${-dd}px)`;
      t[2].style.transform = `translate(${-dd}px,${dd - c}px)`;
      t[3].style.transform = `translate(${dd - c}px,${dd - c}px)`;
    }
    if (threat !== r.threat) {
      r.threat = threat;
      r.el.classList.toggle('vsh-ret--threat', threat);
    }
    if (!r.live) {
      r.live = true;
      r.el.classList.add('is-live');
    }
    return true;
  }

  _drawOrders(dt, proj) {
    for (let i = 0; i < this.orders.length; i++) {
      const o = this.orders[i];
      if (o.life <= 0) continue;
      o.life -= dt;
      if (o.life <= 0) {
        o.el.style.opacity = '0';
        continue;
      }

      let x = o.x;
      let y = o.y;
      let z = o.z;
      if (o.targetId >= 0) {
        const e = this.ctx.entity(o.targetId);
        if (!e || e.alive === false) {
          o.life = 0;
          o.el.style.opacity = '0';
          continue;
        }
        const p = posOf(e);
        x = p.x; y = p.y; z = p.z;
      }

      if (!proj.project(x, y, z)) {
        o.el.style.opacity = '0';
        continue;
      }
      const sx = proj.sx;
      const sy = proj.sy;
      o.el.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`;

      // The altitude stalk: a hairline dropped to the y=0 reference plane. It
      // is the only honest way to read height in a 3D field on a 2D screen.
      if (o.targetId < 0 && proj.project(x, 0, z)) {
        const dx = proj.sx - sx;
        const dy = proj.sy - sy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 2 && len < 4000) {
          const ang = Math.atan2(-dx, dy);
          o.stalk.style.transform = `rotate(${ang.toFixed(4)}rad) scaleY(${len.toFixed(1)})`;
          o.base.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
          o.stalk.style.opacity = '0.4';
          o.base.style.opacity = '0.55';
        } else {
          o.stalk.style.opacity = '0';
          o.base.style.opacity = '0';
        }
      } else {
        o.stalk.style.opacity = '0';
        o.base.style.opacity = '0';
      }

      /* Acknowledgement has to beat the ~85 ms perception threshold, so the
         marker is at full strength within about four frames of the click and
         the ring snaps down onto the point. This is drawn straight off the
         `cmd:*` event and never waits on the sim to agree. */
      const age = o.ttl - o.life;
      const rise = Math.min(1, age / 0.05);
      const fall = Math.min(1, o.life / 0.35);
      o.el.style.opacity = (rise * fall).toFixed(3);
      if (!this.ctx.reduceMotion) {
        const pop = age < 0.16 ? 1 + 0.75 * (1 - age / 0.16) : 1;
        if (pop !== o.pop) {
          o.pop = pop;
          o.ring.style.transform = `scale(${pop.toFixed(3)})`;
        }
      }
    }
  }

  dispose() {
    this.el.remove();
    this.brackets.length = 0;
    this.pips.length = 0;
    this.reticles.length = 0;
    this.orders.length = 0;
    this._hits.clear();
  }
}
