import { SHIPS } from '../ships/catalog.js';

/* Sensors Manager — the strategic view.

   Homeworld's signature screen: the whole 60 km volume abstracted to blips,
   and the vertical stalks that finally make a 3D battlefield legible on a flat
   panel. Height above the reference plane is the one quantity a top-down map
   cannot express, so it gets its own line.

   Two decisions worth knowing about:

   1. **It is a reading layer, not an input layer.** The overlay never takes a
      pointer event. `core/input.js` owns the marquee, the pick radius and the
      move gizmo, and it keeps owning them here — so band-select, attack orders
      and the right-drag altitude gizmo behave in the Sensors Manager exactly
      as they do in the 3D view, and orbit, zoom and edge-scroll survive too.
      An earlier revision re-implemented selection on this canvas and quietly
      broke all of that.

   2. **It reuses the live camera projection** rather than running a second
      Three.js scene. The schematic and the 3D view are therefore always
      looking at the same thing; the camera rig dollies between them and the
      blips stay welded to their hulls the whole way. */

/* The same three hues DESIGN.md publishes and hud.css declares. Resource
   ochre is deliberately the quietest mark on the display: an ore field is
   terrain, and terrain must never shout louder than a contact. */
const COL = {
  us: '#7fd8e8',
  usDim: 'rgba(127, 216, 232, 0.62)',
  them: '#e8a44a',
  themDim: 'rgba(232, 164, 74, 0.62)',
  ore: 'rgba(196, 174, 118, 0.75)',
  oreFill: 'rgba(196, 174, 118, 0.045)',
  oreLine: 'rgba(196, 174, 118, 0.26)',
  grid: 'rgba(255, 255, 255, 0.085)',
  frame: 'rgba(255, 255, 255, 0.26)',
  ring: 'rgba(255, 255, 255, 0.16)',
  stalk: 'rgba(255, 255, 255, 0.2)',
  foot: 'rgba(255, 255, 255, 0.34)',
  sel: 'rgba(255, 255, 255, 0.95)',
  faint: 'rgba(255, 255, 255, 0.34)',
};

/* Blip radius in CSS pixels, by role, and the mark used to draw it. A
   mothership must never read as a fighter — size alone is not enough at this
   scale, so class also changes the shape. */
const MARK = {
  fighter: { r: 2.1, kind: 'dot' },
  corvette: { r: 2.7, kind: 'dot' },
  resource: { r: 2.7, kind: 'ore' },
  support: { r: 3.6, kind: 'diamond' },
  frigate: { r: 3.9, kind: 'diamond' },
  capital: { r: 6, kind: 'ring' },
  structure: { r: 8, kind: 'base' },
};
const DEFAULT_MARK = MARK.fighter;

const VOLUME = 30000; // half-extent of the 60 km playable cube
const GRID_STEP = 5000;
const MAX_CONTACTS = 1400;
const MAX_LABELS = 14;
const LEADER_PX = 9;

/* Above this many selected contacts the individual ticks collapse into one
   bracket, the same threshold logic the world-space marker layer uses. */
const SEL_MARK_CAP = 32;

/* A world-space epsilon in front of the eye. Segments are clipped to this
   rather than dropped, or every grid line crossing the near plane would
   vanish and the floor would come apart at exactly the angle you use it at. */
const NEAR_EPS = 40;

export class SensorsView {
  constructor({ root, ctx }) {
    this.ctx = ctx;
    this.open = false;
    this._contacts = [];
    this._nContacts = 0;
    this._dpr = 1;

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

    // Tally, drawn as DOM rather than canvas text so it inherits the HUD's
    // type stack and stays crisp at any device pixel ratio.
    const tally = document.createElement('div');
    tally.className = 'vsh-sensors__tally';
    this.tallyUs = document.createElement('span');
    this.tallyUs.className = 'vsh-tally vsh-tally--us vsh-num';
    this.tallyThem = document.createElement('span');
    this.tallyThem.className = 'vsh-tally vsh-tally--them vsh-num';
    tally.append(this.tallyUs, this.tallyThem);

    el.append(this.canvas, head, legend, tally);
    root.appendChild(el);
    this.el = el;

    this.resize();
  }

  setOpen(open) {
    if (this.open === open) return;
    this.open = open;
    this.el.classList.toggle('is-open', open);
    this.el.setAttribute('aria-hidden', String(!open));
    if (open) this.resize();
    else this._clear();
  }

  resize() {
    const { w, h, dpr } = this.ctx.view;
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== cw) this.canvas.width = cw;
    if (this.canvas.height !== ch) this.canvas.height = ch;
    this._dpr = dpr;
  }

  _clear() {
    const g = this.c2d;
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /* --------------------------------------------------------------- draw */

  update() {
    if (!this.open) return;
    const g = this.c2d;
    if (!g) return;

    const { w, h } = this.ctx.view;
    const dpr = this._dpr || 1;
    if (this.canvas.width !== Math.round(w * dpr)) this.resize();

    // The half-pixel offset lands every hairline on a device pixel centre.
    g.setTransform(dpr, 0, 0, dpr, 0.5 * dpr, 0.5 * dpr);
    g.clearRect(-1, -1, w + 2, h + 2);

    /* The 3D view has to recede far enough that the schematic is unambiguously
       the subject — a nebula this bright will win any fight it is allowed to
       have. A flat pull-down plus a vignette: hulls survive as silhouettes,
       the nebula does not survive as colour. */
    g.fillStyle = 'rgba(3, 7, 12, 0.74)';
    g.fillRect(-1, -1, w + 2, h + 2);
    const wash = g.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.12, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    wash.addColorStop(0, 'rgba(2, 5, 9, 0)');
    wash.addColorStop(1, 'rgba(1, 3, 6, 0.78)');
    g.fillStyle = wash;
    g.fillRect(-1, -1, w + 2, h + 2);

    this._grid(g);
    this._rings(g);
    this._collect();
    this._resources(g);
    this._stalks(g);
    this._blips(g);
    this._labels(g);
    this._selection(g);
    this._scale(g, w, h);
    this._tally();
  }

  /* Project a world-space segment, clipped to the near plane. */
  _seg(g, ax, ay, az, bx, by, bz) {
    const proj = this.ctx.proj;
    const m = proj.m;
    const wa = m[3] * ax + m[7] * ay + m[11] * az + m[15];
    const wb = m[3] * bx + m[7] * by + m[11] * bz + m[15];
    if (wa <= NEAR_EPS && wb <= NEAR_EPS) return;

    let x0 = ax; let y0 = ay; let z0 = az;
    let x1 = bx; let y1 = by; let z1 = bz;
    if (wa <= NEAR_EPS) {
      const t = (NEAR_EPS - wa) / (wb - wa);
      x0 = ax + (bx - ax) * t; y0 = ay + (by - ay) * t; z0 = az + (bz - az) * t;
    } else if (wb <= NEAR_EPS) {
      const t = (NEAR_EPS - wb) / (wa - wb);
      x1 = bx + (ax - bx) * t; y1 = by + (ay - by) * t; z1 = bz + (az - bz) * t;
    }

    if (!proj.project(x0, y0, z0)) return;
    const sx = proj.sx;
    const sy = proj.sy;
    if (!proj.project(x1, y1, z1)) return;
    g.moveTo(sx, sy);
    g.lineTo(proj.sx, proj.sy);
  }

  /** The 5 km lattice on the reference plane. This is the floor of the volume. */
  _grid(g) {
    g.lineWidth = 1;
    g.strokeStyle = COL.grid;
    g.beginPath();
    for (let i = -VOLUME; i <= VOLUME; i += GRID_STEP) {
      if (i === 0) continue; // the two axes get their own, brighter pass
      this._seg(g, -VOLUME, 0, i, VOLUME, 0, i);
      this._seg(g, i, 0, -VOLUME, i, 0, VOLUME);
    }
    g.stroke();

    g.strokeStyle = COL.ring;
    g.beginPath();
    this._seg(g, -VOLUME, 0, 0, VOLUME, 0, 0);
    this._seg(g, 0, 0, -VOLUME, 0, 0, VOLUME);
    g.stroke();
  }

  /* Range rings on the reference plane. The outermost is the 60 km volume
     boundary and is drawn brighter and labelled: a ring states the edge more
     honestly than a wireframe cube, which would read as a container — and the
     void is not supposed to feel contained. */
  _rings(g) {
    const proj = this.ctx.proj;
    g.lineWidth = 1;
    for (const r of [10000, 20000, VOLUME]) {
      const edge = r === VOLUME;
      g.strokeStyle = edge ? COL.frame : COL.ring;
      g.beginPath();
      let px = r;
      let pz = 0;
      for (let a = 1; a <= 96; a++) {
        const t = (a / 96) * Math.PI * 2;
        const nx = Math.cos(t) * r;
        const nz = Math.sin(t) * r;
        this._seg(g, px, 0, pz, nx, 0, nz);
        px = nx;
        pz = nz;
      }
      g.stroke();
    }

    if (proj.project(0, 0, -VOLUME)) {
      g.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';
      g.fillStyle = COL.frame;
      g.textAlign = 'center';
      g.fillText('60 KM VOLUME', proj.sx, proj.sy - 8);
    }
  }

  /** Snapshot every contact's screen position once; every later pass reads
      this, so nothing is projected twice. */
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
        c = {
          id: 0, team: 0, mark: DEFAULT_MARK, name: '', big: false,
          sx: 0, sy: 0, bx: 0, by: 0, lx: 0, ly: 0,
          base: false, lead: false, sel: false, hurt: 0,
        };
        list[n] = c;
      }
      const def = e.def || SHIPS[e.classId];
      c.id = e.id;
      c.team = e.team;
      c.mark = MARK[(def && def.role) || e.role] || DEFAULT_MARK;
      c.name = def ? def.short || def.name : '';
      c.big = c.mark.kind === 'ring' || c.mark.kind === 'base';
      c.sx = sx;
      c.sy = sy;
      c.sel = ctx.selection.has(e.id);
      c.hurt = e.maxHull > 0 ? e.hull / e.maxHull : 1;

      // Altitude stalk: only worth drawing once a hull is clear of the plane.
      c.base = Math.abs(p.y) > 60 && proj.project(p.x, 0, p.z);
      if (c.base) {
        c.bx = proj.sx;
        c.by = proj.sy;
      }

      /* Heading tick. Normalised to a fixed pixel length so a fighter and a
         mothership both read as "going that way" rather than the fighter
         drawing a streak across the display. */
      c.lead = false;
      const v = e.velocity;
      if (v && (v.x * v.x + v.y * v.y + v.z * v.z) > 400 &&
          proj.project(p.x + v.x * 2, p.y + v.y * 2, p.z + v.z * 2)) {
        const dx = proj.sx - sx;
        const dy = proj.sy - sy;
        const len = Math.hypot(dx, dy);
        if (len > 0.6) {
          const k = LEADER_PX / len;
          c.lx = sx + dx * k;
          c.ly = sy + dy * k;
          c.lead = true;
        }
      }
      n++;
    }
    this._nContacts = n;
  }

  /* Resource clusters read as ore fields with a depletion arc, because the
     thing a commander needs to know is not "there is rock there" but "there
     is rock left there". */
  _resources(g) {
    const clusters = this.ctx.resourceClusters();
    if (!clusters || !clusters.length) return;
    const proj = this.ctx.proj;

    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const p = c.position || c;
      if (!p || !proj.project(p.x, p.y, p.z)) continue;
      const sx = proj.sx;
      const sy = proj.sy;
      const r = Math.max(7, Math.min(46, ((c.radius || 1200) * proj.scaleK) / proj.cw));

      g.fillStyle = COL.oreFill;
      g.strokeStyle = COL.oreLine;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();

      const left = c.maxAmount > 0 ? Math.max(0, Math.min(1, c.amount / c.maxAmount)) : 1;
      if (left < 0.999) {
        g.strokeStyle = COL.ore;
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(sx, sy, r, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * left);
        g.stroke();
      }

      // Its own altitude stalk — a cluster 4 km off the plane is a different
      // proposition to one sitting on it.
      if (Math.abs(p.y) > 60 && proj.project(p.x, 0, p.z)) {
        g.strokeStyle = 'rgba(196, 174, 118, 0.16)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(proj.sx, proj.sy);
        g.moveTo(proj.sx - 4, proj.sy);
        g.lineTo(proj.sx + 4, proj.sy);
        g.stroke();
      }
    }
  }

  /** Every altitude stalk in one path. This is the whole point of the view. */
  _stalks(g) {
    const list = this._contacts;
    const n = this._nContacts;

    g.strokeStyle = COL.stalk;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c.base) continue;
      g.moveTo(c.sx, c.sy);
      g.lineTo(c.bx, c.by);
    }
    g.stroke();

    // A brighter foot only where the stalk is long enough to have earned one.
    g.strokeStyle = COL.foot;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c.base) continue;
      const w = c.big ? 5 : 3;
      if (Math.abs(c.by - c.sy) < 4) continue;
      g.moveTo(c.bx - w, c.by);
      g.lineTo(c.bx + w, c.by);
    }
    g.stroke();
  }

  /* Blips, batched by team so the fill style is set a handful of times rather
     than once per contact. Small marks go in one path; the big ones are few
     enough to draw individually. */
  _blips(g) {
    const list = this._contacts;
    const n = this._nContacts;
    const mine = this.ctx.team;

    for (let pass = 0; pass < 2; pass++) {
      const team = pass === 0 ? 1 - mine : mine; // ours painted last, on top
      const solid = team === mine ? COL.us : COL.them;
      const dim = team === mine ? COL.usDim : COL.themDim;

      // Heading ticks under everything else.
      g.strokeStyle = dim;
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const c = list[i];
        if (c.team !== team || !c.lead) continue;
        g.moveTo(c.sx, c.sy);
        g.lineTo(c.lx, c.ly);
      }
      g.stroke();

      // Small craft: filled squares, one path.
      g.fillStyle = solid;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const c = list[i];
        if (c.team !== team || c.mark.kind !== 'dot') continue;
        const r = c.mark.r;
        g.rect(c.sx - r, c.sy - r, r * 2, r * 2);
      }
      g.fill();

      // Collectors: a hollow square, so the economy is never mistaken for a wing.
      g.strokeStyle = solid;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const c = list[i];
        if (c.team !== team || c.mark.kind !== 'ore') continue;
        const r = c.mark.r;
        g.rect(c.sx - r, c.sy - r, r * 2, r * 2);
      }
      g.stroke();

      // Line ships: a diamond, one path.
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const c = list[i];
        if (c.team !== team || c.mark.kind !== 'diamond') continue;
        const r = c.mark.r;
        g.moveTo(c.sx, c.sy - r);
        g.lineTo(c.sx + r, c.sy);
        g.lineTo(c.sx, c.sy + r);
        g.lineTo(c.sx - r, c.sy);
        g.closePath();
      }
      g.stroke();

      // Capitals and bases: a ring with a core, and a cross for producers.
      for (let i = 0; i < n; i++) {
        const c = list[i];
        if (c.team !== team || !c.big) continue;
        const r = c.mark.r;
        g.lineWidth = c.mark.kind === 'base' ? 1.4 : 1;
        g.beginPath();
        g.arc(c.sx, c.sy, r, 0, Math.PI * 2);
        g.stroke();
        if (c.mark.kind === 'base') {
          g.beginPath();
          g.moveTo(c.sx - r - 3, c.sy);
          g.lineTo(c.sx + r + 3, c.sy);
          g.moveTo(c.sx, c.sy - r - 3);
          g.lineTo(c.sx, c.sy + r + 3);
          g.stroke();
        }
        g.fillStyle = solid;
        g.beginPath();
        g.arc(c.sx, c.sy, Math.max(1.2, r * 0.34), 0, Math.PI * 2);
        g.fill();
      }
      g.lineWidth = 1;
    }
  }

  /* Names on the things worth naming. Capitals and bases only, nearest first,
     hard-capped — a schematic with 200 labels is not a schematic. */
  _labels(g) {
    const list = this._contacts;
    const n = this._nContacts;
    const mine = this.ctx.team;
    g.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    let drawn = 0;
    for (let i = 0; i < n && drawn < MAX_LABELS; i++) {
      const c = list[i];
      if (!c.big || !c.name) continue;
      g.fillStyle = c.team === mine ? COL.usDim : COL.themDim;
      g.fillText(c.name, c.sx + c.mark.r + 7, c.sy - 0.5);
      drawn++;
    }
    g.textBaseline = 'alphabetic';
  }

  /* Selection marks last, so they sit on top of everything.

     Past a couple of dozen, per-contact ticks stop being marks and become a
     white blob — the schematic's version of the same problem the world layer
     solves with a group bracket, so it gets the same answer: one bracket
     round the lot, and the blips underneath speak for themselves. */
  _selection(g) {
    const list = this._contacts;
    const n = this._nContacts;
    let count = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c.sel) continue;
      count++;
      if (c.sx < minX) minX = c.sx;
      if (c.sx > maxX) maxX = c.sx;
      if (c.sy < minY) minY = c.sy;
      if (c.sy > maxY) maxY = c.sy;
    }
    if (!count) return;

    g.strokeStyle = COL.sel;
    g.lineWidth = 1;

    if (count > SEL_MARK_CAP) {
      const pad = 16;
      const x0 = minX - pad;
      const y0 = minY - pad;
      const x1 = maxX + pad;
      const y1 = maxY + pad;
      const t = Math.max(10, Math.min(26, (x1 - x0) * 0.08));
      g.beginPath();
      g.moveTo(x0, y0 + t); g.lineTo(x0, y0); g.lineTo(x0 + t, y0);
      g.moveTo(x1 - t, y0); g.lineTo(x1, y0); g.lineTo(x1, y0 + t);
      g.moveTo(x0, y1 - t); g.lineTo(x0, y1); g.lineTo(x0 + t, y1);
      g.moveTo(x1 - t, y1); g.lineTo(x1, y1); g.lineTo(x1, y1 - t);
      g.stroke();
      g.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';
      g.fillStyle = COL.sel;
      g.textAlign = 'left';
      g.fillText(`${count} SELECTED`, x0, y0 - 6);
      return;
    }

    g.beginPath();
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c.sel) continue;
      const r = c.mark.r + 4;
      // Corner ticks, the same language as the world-space bracket.
      const t = Math.max(2.5, r * 0.5);
      g.moveTo(c.sx - r, c.sy - r + t); g.lineTo(c.sx - r, c.sy - r); g.lineTo(c.sx - r + t, c.sy - r);
      g.moveTo(c.sx + r - t, c.sy - r); g.lineTo(c.sx + r, c.sy - r); g.lineTo(c.sx + r, c.sy - r + t);
      g.moveTo(c.sx - r, c.sy + r - t); g.lineTo(c.sx - r, c.sy + r); g.lineTo(c.sx - r + t, c.sy + r);
      g.moveTo(c.sx + r - t, c.sy + r); g.lineTo(c.sx + r, c.sy + r); g.lineTo(c.sx + r, c.sy + r - t);
    }
    g.stroke();
  }

  /** A 5 km rule measured on the reference plane through the origin. */
  _scale(g, w, h) {
    const proj = this.ctx.proj;
    if (!proj.project(0, 0, 0)) return;
    const ax = proj.sx;
    const ay = proj.sy;
    if (!proj.project(GRID_STEP, 0, 0)) return;
    const px = Math.hypot(proj.sx - ax, proj.sy - ay);
    if (px < 24 || px > w * 0.6) return;

    const x0 = 26;
    const y0 = h - 78;
    g.strokeStyle = COL.faint;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, y0 - 5);
    g.lineTo(x0, y0);
    g.lineTo(x0 + px, y0);
    g.lineTo(x0 + px, y0 - 5);
    g.stroke();
    g.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = COL.faint;
    g.textAlign = 'left';
    g.fillText('5 KM', x0, y0 - 9);
  }

  _tally() {
    let us = 0;
    let them = 0;
    for (let i = 0; i < this._nContacts; i++) {
      if (this._contacts[i].team === this.ctx.team) us++;
      else them++;
    }
    const a = `${us} OWN`;
    const b = `${them} HOSTILE`;
    if (this.tallyUs.textContent !== a) this.tallyUs.textContent = a;
    if (this.tallyThem.textContent !== b) this.tallyThem.textContent = b;
  }

  dispose() {
    this.el.remove();
    this._contacts.length = 0;
    this._nContacts = 0;
  }
}
