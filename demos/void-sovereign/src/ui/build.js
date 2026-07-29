import { SHIPS, shipsBuildableBy } from '../ships/catalog.js';
import { silhouetteIcon } from './select.js';

/* Production menu.

   Driven entirely by `shipsBuildableBy(producerClassId)` — the catalog decides
   what a mothership can lay down and what a forward carrier can. The menu never
   touches the world; it emits `cmd:build` / `cmd:cancelBuild` and waits to be
   told what happened.

   Everything is rebuilt only when the producer set changes. Per-frame work is
   limited to affordability classes and the queue rings, throttled to 10 Hz,
   because nobody can read a progress ring faster than that. */

const RING_R = 13;
const RING_C = 2 * Math.PI * RING_R;
const MAX_QUEUE_CHIPS = 6;

export class BuildMenu {
  constructor({ root, ctx }) {
    this.ctx = ctx;
    this.items = [];
    this.chips = [];
    this.tabs = [];
    this.producers = [];
    this.producerId = -1;
    this.producerClass = null;
    this._acc = 1;
    this._sig = '';

    const el = document.createElement('section');
    el.className = 'vsh-build';
    el.setAttribute('aria-label', 'Production');

    const head = document.createElement('div');
    head.className = 'vsh-build__head';
    const title = document.createElement('span');
    title.className = 'vsh-build__title';
    title.textContent = 'Production';
    this.tabBar = document.createElement('div');
    this.tabBar.className = 'vsh-build__tabs';
    head.append(title, this.tabBar);

    this.grid = document.createElement('div');
    this.grid.className = 'vsh-build__grid';

    this.queue = document.createElement('div');
    this.queue.className = 'vsh-build__queue';
    this.qEmpty = document.createElement('span');
    this.qEmpty.className = 'vsh-build__qempty';
    this.qEmpty.textContent = 'Yard idle';
    this.queue.appendChild(this.qEmpty);

    el.append(head, this.grid, this.queue);
    root.appendChild(el);
    this.el = el;

    this._onGrid = (ev) => {
      const btn = ev.target.closest('.vsh-item');
      if (!btn || btn.disabled) return;
      const classId = btn.dataset.classId;
      if (!classId) return;
      this.ctx.emit('cmd:build', { team: this.ctx.team, classId });
    };
    this._onQueue = (ev) => {
      const btn = ev.target.closest('.vsh-q');
      if (!btn) return;
      const index = Number(btn.dataset.index);
      if (Number.isNaN(index)) return;
      this.ctx.emit('cmd:cancelBuild', { team: this.ctx.team, index });
    };
    this._onTabs = (ev) => {
      const btn = ev.target.closest('.vsh-tab');
      if (!btn) return;
      this.producerId = Number(btn.dataset.id);
      this._sig = '';
      this.refresh();
    };

    this.grid.addEventListener('click', this._onGrid);
    this.queue.addEventListener('click', this._onQueue);
    this.tabBar.addEventListener('click', this._onTabs);
    this.refresh();
  }

  /** Every live friendly hull that can build something. */
  _scanProducers() {
    const ctx = this.ctx;
    const out = [];
    for (const e of ctx.entities()) {
      if (e.alive === false || e.team !== ctx.team) continue;
      const def = e.def || SHIPS[e.classId];
      if (!def || !def.producer) continue;
      out.push(e);
    }
    out.sort((a, b) => {
      const da = a.def || SHIPS[a.classId];
      const db = b.def || SHIPS[b.classId];
      return (db ? db.length : 0) - (da ? da.length : 0);
    });
    return out;
  }

  refresh() {
    const ctx = this.ctx;
    this.producers = this._scanProducers();

    // Prefer whatever the commander has actually selected.
    let active = this.producers.find((p) => ctx.selection.has(p.id));
    if (!active) active = this.producers.find((p) => p.id === this.producerId);
    if (!active) active = this.producers[0];

    this.producerId = active ? active.id : -1;
    this.producerClass = active ? active.classId : null;

    const sig = this.producers.map((p) => p.id + ':' + p.classId).join(',') + '|' + this.producerId;
    if (sig === this._sig) return;
    this._sig = sig;

    this.el.classList.toggle('is-live', !!active);
    this._tabs();
    this._grid();
    this._update(true);
  }

  _tabs() {
    const multi = this.producers.length > 1;
    for (let i = 0; i < this.producers.length; i++) {
      const p = this.producers[i];
      const def = p.def || SHIPS[p.classId] || {};
      let t = this.tabs[i];
      if (!t) {
        t = document.createElement('button');
        t.type = 'button';
        t.className = 'vsh-tab';
        this.tabBar.appendChild(t);
        this.tabs[i] = t;
      }
      t.hidden = !multi;
      t.dataset.id = String(p.id);
      t.textContent = def.short || def.name || p.classId;
      t.setAttribute('aria-pressed', String(p.id === this.producerId));
      t.setAttribute('aria-label', `Build from ${def.name || p.classId}`);
    }
    for (let i = this.producers.length; i < this.tabs.length; i++) this.tabs[i].hidden = true;
  }

  _grid() {
    const list = this.producerClass ? shipsBuildableBy(this.producerClass) : [];
    for (let i = 0; i < list.length; i++) {
      const def = list[i];
      let it = this.items[i];
      if (!it) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'vsh-item';
        const icon = silhouetteIcon(def.id, 'vsh-item__icon');
        const name = document.createElement('span');
        name.className = 'vsh-item__name';
        const cost = document.createElement('span');
        cost.className = 'vsh-item__cost vsh-num';
        const sub = document.createElement('span');
        sub.className = 'vsh-item__sub';
        el.append(icon.svg, name, cost, sub);
        this.grid.appendChild(el);
        it = { el, path: icon.path, name, cost, sub, classId: null, blocked: '' };
        this.items[i] = it;
      }
      if (it.classId !== def.id) {
        it.classId = def.id;
        it.el.dataset.classId = def.id;
        it.path.setAttribute('d', def.silhouette || '');
        it.name.textContent = def.name;
        it.cost.textContent = String(def.cost);
      }
      it.el.hidden = false;
    }
    for (let i = list.length; i < this.items.length; i++) this.items[i].el.hidden = true;
    this._list = list;
  }

  _update(force) {
    const ctx = this.ctx;
    const t = ctx.teamState();
    const list = this._list || [];

    for (let i = 0; i < list.length; i++) {
      const def = list[i];
      const it = this.items[i];
      if (!it || it.el.hidden) continue;

      let blocked = '';
      if (!this.producerClass) blocked = 'No producer';
      else if (t.credits < def.cost) blocked = `Short ${Math.ceil(def.cost - t.credits)} RU`;
      else if (def.popCost > 0 && t.pop + def.popCost > t.popCap) blocked = 'Population cap';

      if (force || blocked !== it.blocked) {
        it.blocked = blocked;
        it.el.disabled = !!blocked;
        it.sub.classList.toggle('is-blocked', !!blocked);
        it.sub.textContent = blocked
          ? blocked
          : `${def.buildTime}s · ${def.popCost} pop${def.squadSize > 1 ? ` · ×${def.squadSize}` : ''}`;
        it.el.setAttribute(
          'aria-label',
          blocked
            ? `${def.name}, unavailable: ${blocked}`
            : `Build ${def.name}, ${def.cost} resource units, ${def.buildTime} seconds`,
        );
      }
    }

    this._queue(t.queue);
  }

  _queue(entries) {
    const n = Math.min(entries.length, MAX_QUEUE_CHIPS);
    this.qEmpty.hidden = entries.length > 0;

    for (let i = 0; i < n; i++) {
      const q = entries[i];
      const def = SHIPS[q.classId] || {};
      let c = this.chips[i];
      if (!c) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'vsh-q';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'vsh-q__ring');
        svg.setAttribute('viewBox', '0 0 32 32');
        svg.setAttribute('aria-hidden', 'true');
        const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        track.setAttribute('class', 'vsh-q__track');
        track.setAttribute('cx', '16');
        track.setAttribute('cy', '16');
        track.setAttribute('r', String(RING_R));
        const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        arc.setAttribute('class', 'vsh-q__arc');
        arc.setAttribute('cx', '16');
        arc.setAttribute('cy', '16');
        arc.setAttribute('r', String(RING_R));
        arc.setAttribute('stroke-dasharray', String(RING_C));
        arc.setAttribute('stroke-dashoffset', String(RING_C));
        svg.append(track, arc);
        const code = document.createElement('span');
        code.className = 'vsh-q__code';
        el.append(svg, code);
        this.queue.insertBefore(el, this.qMore || null);
        c = { el, arc, code, p: -1, classId: null };
        this.chips[i] = c;
      }
      c.el.hidden = false;
      c.el.dataset.index = String(i);
      if (c.classId !== q.classId) {
        c.classId = q.classId;
        c.code.textContent = def.short || q.classId.slice(0, 3).toUpperCase();
      }
      const p = Math.max(0, Math.min(1, q.progress));
      if (Math.abs(p - c.p) > 0.004) {
        c.p = p;
        c.arc.setAttribute('stroke-dashoffset', (RING_C * (1 - p)).toFixed(2));
      }
      c.el.setAttribute(
        'aria-label',
        `${def.name || q.classId}, ${Math.round(p * 100)} per cent complete. Activate to cancel.`,
      );
    }
    for (let i = n; i < this.chips.length; i++) this.chips[i].el.hidden = true;

    if (entries.length > MAX_QUEUE_CHIPS) {
      if (!this.qMore) {
        this.qMore = document.createElement('span');
        this.qMore.className = 'vsh-q__more vsh-num';
        this.queue.appendChild(this.qMore);
      }
      this.qMore.hidden = false;
      this.qMore.textContent = `+${entries.length - MAX_QUEUE_CHIPS}`;
    } else if (this.qMore) {
      this.qMore.hidden = true;
    }
  }

  update(dt) {
    this._acc += dt;
    if (this._acc < 0.1) return;
    this._acc = 0;
    this.refresh();
    this._update(false);
  }

  dispose() {
    this.grid.removeEventListener('click', this._onGrid);
    this.queue.removeEventListener('click', this._onQueue);
    this.tabBar.removeEventListener('click', this._onTabs);
    this.el.remove();
    this.items.length = 0;
    this.chips.length = 0;
    this.tabs.length = 0;
  }
}
