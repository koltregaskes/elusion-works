import { SHIPS } from '../ships/catalog.js';

/* Sensors Manager — the strategic view.

   Homeworld's signature screen: the whole volume abstracted to blips, and the
   vertical stalks that finally make a 3D battlefield legible on a flat panel.
   Height above the reference plane is the one quantity a top-down map cannot
   express, so it gets its own line.

   This is drawn on a single 2D canvas rather than a second Three.js scene. It
   reuses the live camera projection, which means the schematic and the 3D view
   are always looking at the same thing — the camera rig can dolly between them
   and the blips stay welded to their hulls the whole way. */

const COL = {
  us: '#8fe8ff',
  usDim: 'rgba(143, 232, 255, 0.42)',
  them: '#ffb454',
  themDim: 'rgba(255, 180, 84, 0.42)',
  ore: '#d9c07a',
  grid: 'rgba(255, 255, 255, 0.055)',
  gridMajor: 'rgba(255, 255, 255, 0.11)',
  ring: 'rgba(255, 255, 255, 0.09)',
  stalk: 'rgba(255, 255, 255, 0.10)',
  sel: 'rgba(255, 255, 255, 0.92)',
  band: 'rgba(143, 232, 255, 0.9)',
};

/* Blip radius in CSS pixels, by role. A mothership must not read as a fighter. */
const BLIP = {
  fighter: 1.8,
  corvette: 2.4,
  frigate: 3.4,
  support: 3.2,
  capital: 5,
  structure: 6.5,
  resource: 2.4,
};

const VOLUME = 30000; // half-extent of the 60 km playable cube
const GRID_STEP = 5000;
const MAX_CONTACTS = 1400;

export class SensorsView {
  constructor({ root, ctx }) {
    this.ctx = ctx;
    this.open = false;
    this._contacts = [];
    this._nContacts = 0;
    this._band = null;
    this._order = null;
    this._pulse = 0;

    const el = document.createElement('section');
    el.className = 'vsh-sensors';
    el.setAttribute('aria-hidden', 'true');

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vsh-sensors__canvas';
    this.c2d = this.canvas.getContext('2d', { alpha: true, desynchronized: true });

    const head = document.createElement('div');
    head.className = 'vsh-sensors__head';
    const title = document.createElement('span');
    title.className = 'vsh-sensors__title';
    title.textContent = 'Sensors Manager';
    this.hint = document.createElement('span');
    this.hint.className = 'vsh-sensors__hint';
    this.hint.textContent = 'Drag to select · Right-drag to order · Tab to exit';
    head.append(title, this.hint);

    const legend = document.createElement('div');
    legend.className = 'vsh-sensors__legend';
    for (const [cls, text] of [
      ['us', 'Own fleet'],
      ['them', 'Hostile'],
      ['ore', 'Resource'],
    ]) {
      const row = document.createElement('div');
      row.className = `vsh-legend vsh-legend--${cls}`;
      const k = document.createElement('i');
      k.className = 'vsh-legend__k';
      const t = document.createElement('span');
      t.textContent = text;
      row.append(k, t);
      legend.appendChild(row);
    }

    el.append(this.canvas, head, legend);
    root.appendChild(el);
    this.el = el;

    this._onDown = (e) => this._down(e);
    this._onMove = (e) => this._move(e);
    this._onUp = (e) => this._up(e);
    this._onMenu = (e) => e.preventDefault();
    this.canvas.addEventListener('pointerdown', this._onDown);
    this.canvas.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    this.canvas.addEventListener('contextmenu', this._onMenu);

    this.resize();
  }

  setOpen(open) {
    if (this.open === open) return;
    this.open = open;
    this.el.classList.toggle('is-open', open);
    this.el.setAttribute('aria-hidden', String(!open));
    this._band = null;
    this._order = null;
    if (open) this.resize();
  }

  resize() {
    const { w, h, dpr } = this.ctx.view;
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== cw) this.canvas.width = cw;
    if (this.canvas.height !== ch) this.canvas.height = ch;
    this._dpr = dpr;
  }

  /* ------------------------------------------------------------ pointer */

  _local(ev) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  _down(ev) {
    if (!this.open) return;
    const p = this._local(ev);
    if (ev.button === 2) {
      const point = this.ctx.screenToPlane(p.x, p.y, 0);
      if (!point) return;
      this._order = { x: p.x, y: p.y, cur: p.y, point, alt: 0 };
      this.canvas.setPointerCapture(ev.pointerId);
    } else if (ev.button === 0) {
      this._band = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: ev.shiftKey };
      this.canvas.setPointerCapture(ev.pointerId);
    }
  }

  _move(ev) {
    if (!this.open) return;
    const p = this._local(ev);
    if (this._band) {
      this._band.x1 = p.x;
      this._band.y1 = p.y;
    } else if (this._order) {
      this._order.cur = p.y;
      // Vertical drag sets altitude. Scaling by the projected depth at the
      // destination keeps a pixel worth the same number of metres as the 3D view.
      const metresPerPx = this.ctx.metresPerPixelAt(this._order.point);
      this._order.alt = (this._order.y - p.y) * metresPerPx;
    }
  }

  _up() {
    if (this._band) {
      const b = this._band;
      this._band = null;
      if (Math.abs(b.x1 - b.x0) > 4 || Math.abs(b.y1 - b.y0) > 4) {
        this._commitBand(b);
      } else {
        this._commitPick(b);
      }
    } else if (this._order) {
      const o = this._order;
      this._order = null;
      const ids = Array.from(this.ctx.selection);
      if (ids.length) {
        const point = o.point.clone ? o.point.clone() : { x: o.point.x, y: o.point.y, z: o.point.z };
        point.y = o.alt;
        // The marker is drawn by whoever listens to cmd:move, so emitting is enough.
        this.ctx.emit('cmd:move', { ids, point, formation: this.ctx.formation });
      }
    }
  }

  _commitBand(b) {
    const x0 = Math.min(b.x0, b.x1);
    const x1 = Math.max(b.x0, b.x1);
    const y0 = Math.min(b.y0, b.y1);
    const y1 = Math.max(b.y0, b.y1);
    const ids = b.add ? Array.from(this.ctx.selection) : [];
    const seen = new Set(ids);
    for (let i = 0; i < this._nContacts; i++) {
      const c = this._contacts[i];
      if (c.team !== this.ctx.team) continue;
      if (c.sx < x0 || c.sx > x1 || c.sy < y0 || c.sy > y1) continue;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      ids.push(c.id);
    }
    this.ctx.select(ids);
  }

  _commitPick(b) {
    let best = -1;
    let bestD = 18 * 18;
    for (let i = 0; i < this._nContacts; i++) {
      const c = this._contacts[i];
      if (c.team !== this.ctx.team) continue;
      const dx = c.sx - b.x0;
      const dy = c.sy - b.y0;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = c.id;
      }
    }
    if (best >= 0) {
      const ids = b.add ? Array.from(this.ctx.selection) : [];
      if (!ids.includes(best)) ids.push(best);
      this.ctx.select(ids);
    } else if (!b.add) {
      this.ctx.select([]);
    }
  }

  /* --------------------------------------------------------------- draw */

  update(dt) {
    if (!this.open) return;
    this._pulse += dt;
    const g = this.c2d;
    if (!g) return;

    const { w, h } = this.ctx.view;
    const dpr = this._dpr || 1;
    if (this.canvas.width !== Math.round(w * dpr)) this.resize();

    g.setTransform(dpr, 0, 0, dpr, 0.5 * dpr, 0.5 * dpr);
    g.clearRect(-1, -1, w + 2, h + 2);

    // A soft wash rather than a hard curtain: the void stays readable behind it.
    const wash = g.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
    wash.addColorStop(0, 'rgba(3, 7, 12, 0.52)');
    wash.addColorStop(1, 'rgba(2, 5, 9, 0.86)');
    g.fillStyle = wash;
    g.fillRect(-1, -1, w + 2, h + 2);

    this._grid(g);
    this._rings(g);
    this._collect();
    this._resources(g);
    this._contactsDraw(g, w, h);
    this._overlays(g, w, h);
  }

  _grid(g) {
    g.lineWidth = 1;
    g.strokeStyle = COL.grid;
    g.beginPath();
    for (let i = -VOLUME; i <= VOLUME; i += GRID_STEP) {
      if (i === 0) continue; // the two centre lines get their own, brighter pass
      this._segment(g, -VOLUME, 0, i, VOLUME, 0, i);
      this._segment(g, i, 0, -VOLUME, i, 0, VOLUME);
    }
    g.stroke();

    g.strokeStyle = COL.gridMajor;
    g.beginPath();
    this._segment(g, -VOLUME, 0, 0, VOLUME, 0, 0);
    this._segment(g, 0, 0, -VOLUME, 0, 0, VOLUME);
    g.stroke();
  }

  /** Project a world-space segment. Skips anything crossing behind the eye. */
  _segment(g, ax, ay, az, bx, by, bz) {
    const proj = this.ctx.proj;
    if (!proj.project(ax, ay, az)) return;
    const sx = proj.sx;
    const sy = proj.sy;
    if (!proj.project(bx, by, bz)) return;
    g.moveTo(sx, sy);
    g.lineTo(proj.sx, proj.sy);
  }

  /** Range rings on the reference plane — instant sense of scale. */
  _rings(g) {
    const proj = this.ctx.proj;
    g.strokeStyle = COL.ring;
    g.lineWidth = 1;
    for (const r of [10000, 20000, 30000]) {
      g.beginPath();
      let started = false;
      for (let a = 0; a <= 64; a++) {
        const t = (a / 64) * Math.PI * 2;
        if (!proj.project(Math.cos(t) * r, 0, Math.sin(t) * r)) {
          started = false;
          continue;
        }
        if (!started) {
          g.moveTo(proj.sx, proj.sy);
          started = true;
        } else {
          g.lineTo(proj.sx, proj.sy);
        }
      }
      g.stroke();
    }
  }

  /** Snapshot every contact's screen position once; drawing and hit-testing
      both read this, so nothing is projected twice. */
  _collect() {
    const ctx = this.ctx;
    const proj = ctx.proj;
    const { w, h } = ctx.view;
    const list = this._contacts;
    let n = 0;

    for (const e of ctx.entities()) {
      if (e.alive === false) continue;
      if (n >= MAX_CONTACTS) break;
      const p = (e.object3D && e.object3D.position) || e.position;
      if (!p || !proj.project(p.x, p.y, p.z)) continue;
      const sx = proj.sx;
      const sy = proj.sy;
      if (sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) continue;

      let c = list[n];
      if (!c) {
        c = { id: 0, team: 0, role: 'fighter', sx: 0, sy: 0, bx: 0, by: 0, base: false, sel: false };
        list[n] = c;
      }
      c.id = e.id;
      c.team = e.team;
      c.role = (e.def && e.def.role) || (SHIPS[e.classId] && SHIPS[e.classId].role) || 'fighter';
      c.sx = sx;
      c.sy = sy;
      c.sel = ctx.selection.has(e.id);
      c.base = Math.abs(p.y) > 60 && proj.project(p.x, 0, p.z);
      if (c.base) {
        c.bx = proj.sx;
        c.by = proj.sy;
      }
      n++;
    }
    this._nContacts = n;
  }

  _resources(g) {
    const clusters = this.ctx.resourceClusters();
    if (!clusters || !clusters.length) return;
    const proj = this.ctx.proj;
    g.strokeStyle = 'rgba(217, 192, 122, 0.5)';
    g.fillStyle = 'rgba(217, 192, 122, 0.10)';
    g.lineWidth = 1;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const p = c.position || c;
      if (!proj.project(p.x, p.y, p.z)) continue;
      const r = Math.max(6, Math.min(70, ((c.radius || 1200) * proj.scaleK) / proj.cw));
      g.beginPath();
      g.arc(proj.sx, proj.sy, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  _contactsDraw(g, w, h) {
    const list = this._contacts;
    const n = this._nContacts;

    // Altitude stalks first, all in one path — this is the whole point of the view.
    g.strokeStyle = COL.stalk;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c.base) continue;
      g.moveTo(c.sx, c.sy);
      g.lineTo(c.bx, c.by);
      g.moveTo(c.bx - 3, c.by);
      g.lineTo(c.bx + 3, c.by);
    }
    g.stroke();

    // Blips, batched per team so the fill style is set twice, not 400 times.
    for (let team = 0; team < 2; team++) {
      const solid = team === this.ctx.team ? COL.us : COL.them;
      const dim = team === this.ctx.team ? COL.usDim : COL.themDim;

      g.fillStyle = dim;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const c = list[i];
        if (c.team !== team) continue;
        const r = BLIP[c.role] || 2;
        if (r >= 5) continue;
        g.rect(c.sx - r, c.sy - r, r * 2, r * 2);
      }
      g.fill();

      g.fillStyle = solid;
      g.strokeStyle = solid;
      for (let i = 0; i < n; i++) {
        const c = list[i];
        if (c.team !== team) continue;
        const r = BLIP[c.role] || 2;
        if (r < 5) continue;
        g.beginPath();
        g.arc(c.sx, c.sy, r, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.arc(c.sx, c.sy, r * 0.35, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Selection marks last so they sit on top of everything.
    g.strokeStyle = COL.sel;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c.sel) continue;
      const r = (BLIP[c.role] || 2) + 3.5;
      g.rect(c.sx - r, c.sy - r, r * 2, r * 2);
    }
    g.stroke();
  }

  _overlays(g, w, h) {
    if (this._band) {
      const b = this._band;
      const x = Math.min(b.x0, b.x1);
      const y = Math.min(b.y0, b.y1);
      const bw = Math.abs(b.x1 - b.x0);
      const bh = Math.abs(b.y1 - b.y0);
      g.fillStyle = 'rgba(143, 232, 255, 0.06)';
      g.fillRect(x, y, bw, bh);
      g.strokeStyle = COL.band;
      g.lineWidth = 1;
      g.strokeRect(x, y, bw, bh);
    }

    if (this._order) {
      const o = this._order;
      const proj = this.ctx.proj;
      const p = o.point;
      if (proj.project(p.x, o.alt, p.z)) {
        const tx = proj.sx;
        const ty = proj.sy;
        g.strokeStyle = COL.us;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(tx, ty, 9, 0, Math.PI * 2);
        g.stroke();
        if (proj.project(p.x, 0, p.z)) {
          g.strokeStyle = COL.usDim;
          g.beginPath();
          g.moveTo(tx, ty);
          g.lineTo(proj.sx, proj.sy);
          g.moveTo(proj.sx - 5, proj.sy);
          g.lineTo(proj.sx + 5, proj.sy);
          g.stroke();
        }
        g.fillStyle = COL.us;
        g.font = '500 10px "IBM Plex Mono", monospace';
        g.textAlign = 'left';
        g.fillText(`${(o.alt / 1000).toFixed(1)} km`, tx + 14, ty - 8);
      }
    }

    // Contact tally. Two numbers, no chrome.
    let us = 0;
    let them = 0;
    for (let i = 0; i < this._nContacts; i++) {
      if (this._contacts[i].team === this.ctx.team) us++;
      else them++;
    }
    g.font = '500 10px "IBM Plex Mono", monospace';
    g.textAlign = 'right';
    g.fillStyle = COL.us;
    g.fillText(`${us} OWN`, w - 26, 96);
    g.fillStyle = COL.them;
    g.fillText(`${them} HOSTILE`, w - 26, 112);

    // Scale bar: 5 km measured on the reference plane through the origin.
    const proj = this.ctx.proj;
    if (proj.project(0, 0, 0)) {
      const ax = proj.sx;
      const ay = proj.sy;
      if (proj.project(GRID_STEP, 0, 0)) {
        const px = Math.hypot(proj.sx - ax, proj.sy - ay);
        if (px > 24 && px < w * 0.6) {
          const x0 = 26;
          const y0 = h - 74;
          g.strokeStyle = 'rgba(255,255,255,0.28)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x0, y0 - 4);
          g.lineTo(x0, y0);
          g.lineTo(x0 + px, y0);
          g.lineTo(x0 + px, y0 - 4);
          g.stroke();
          g.fillStyle = 'rgba(255,255,255,0.4)';
          g.textAlign = 'left';
          g.fillText('5 KM', x0, y0 - 8);
        }
      }
    }
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    this.canvas.removeEventListener('contextmenu', this._onMenu);
    this.el.remove();
    this._contacts.length = 0;
  }
}
