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
      blips stay welded to their hulls the whole way.

   3. **The 3D view underneath is reference, not subject, and terrain is not
      even that.** Because this is one canvas over another it cannot hide what
      the renderer drew — it can only push it back. Ships are bright enough to
      survive the pull-down; a lit asteroid field was too, and a single rock
      then read as a solid pale mass the size of a formation, with the hostile
      fleet drawn on top of it and unreadable. Rock is therefore redrawn as a
      schematic mark instead of being left to the renderer: `_occluders` puts
      the void back under it, `_fields` states its extent by hatching. See
      those two for the reasoning. */

/* Exactly the two team hues DESIGN.md publishes, and white for everything
   else — the same language `hud.css` states at the top of the file: cyan is
   us, amber is them, red is trouble, white is the rest, held low.

   Terrain used to be drawn in an ochre of its own. Three warm marks then
   competed for one channel, and the ore rings out-read the hostile contacts
   they had circles drawn around. It is neutral now: an ore field is ground,
   and ground never out-shouts a contact. */
const COL = {
  us: '#7fd8e8',
  usDim: 'rgba(127, 216, 232, 0.62)',
  them: '#e8a44a',
  themDim: 'rgba(232, 164, 74, 0.62)',
  rockHatch: 'rgba(255, 255, 255, 0.06)',
  rockLine: 'rgba(255, 255, 255, 0.17)',
  rockStalk: 'rgba(255, 255, 255, 0.11)',
  rockArc: 'rgba(255, 255, 255, 0.4)',
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
const TAU = Math.PI * 2;

/* Asteroid-field footprints.

   `render/environment.js` scatters each rock at `cluster.radius * cbrt(u) *
   [0.75, 1.15]`, so 1.15 is the honest edge of a seam. Its handful of
   multi-kilometre landmarks sit further out again — roughly 1.2–2.4x the
   radius plus their own bound — which is why the knock-down behind the
   footprint fades out well past the hatched extent rather than stopping at
   it. The rocks themselves are plain instanced meshes on `LAYER.DEFAULT`
   with no schematic representation of their own; the cluster records are the
   right source for a footprint, and the only one that is cheap. */
const FOOT_SEAM = 1.15;
const FOOT_HAZE = 4.6;
const FOOT_MIN_PX = 7;
const HATCH_PX = 10;
/* Hatch lines per footprint. A field the camera is standing inside projects
   several screens wide, and an unbounded loop over it would be the one place
   this view could stall. */
const HATCH_MAX = 44;

/* The knock-down is composed at a quarter of display resolution and scaled up.

   It is nothing but soft radial gradients — there is no detail in it to lose.
   At a commander's distance six footprints each cover the whole viewport, so
   at 1:1 this is ~12 Mpx of fill per frame at 1920x1080 against 0.8 Mpx plus
   one upscale here. A/B on the dev box could not separate them because the
   sensors view sits on a ~30 fps ceiling either way; the point is the worst
   case on a machine that is not capped, with the camera inside a field.
   Compositing the group once also stops two overlapping fields darkening
   each other twice, which the per-footprint version did. */
const OCC_DIV = 4;

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
    this._foots = [];
    this._nFoots = 0;
    this._occ = null;   // quarter-scale knock-down buffer, built on first use
    this._occ2d = null;
    this._dpr = 1;
    this._fails = 0;    // consecutive draw failures; three retires the view
    this._dead = false;
    this._lastError = null;

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
      ['ore', 'Ore field'],
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

  /* This runs inside the engine's render hook on every single frame, so it is
     not allowed to throw. A transient mid-edit state once put a
     `this._footprints is not a function` through `HUD.update` into the hook and
     killed every subsequent frame: draw calls went to zero and the canvas
     stopped updating while the page still reported itself ready. The engine now
     detaches a hook that throws three times, so that particular failure can no
     longer take the game down — but a schematic that vanishes mid-battle is
     still a defect, and the reading layer is exactly the wrong place to find
     out that something upstream changed shape.

     So: one boundary here, and the view retires itself politely rather than
     spraying the same exception 60 times a second. */
  update() {
    if (!this.open || this._dead) return;
    const g = this.c2d;
    if (!g) return;
    try {
      this._draw(g);
      this._fails = 0;
    } catch (err) {
      this._onDrawFailure(err);
    }
  }

  _onDrawFailure(err) {
    this._fails = (this._fails || 0) + 1;
    if (this._fails < 3) return;
    this._dead = true;
    this._clear();
    const say = this.ctx && typeof this.ctx.toast === 'function' ? this.ctx.toast : null;
    if (say) say('Sensors Manager stopped — the 3D view is unaffected', 'alert');
    /* Kept for anyone with the console open; never printed. */
    this._lastError = String((err && err.stack) || err);
  }

  _draw(g) {
    const { w, h } = this.ctx.view;
    const dpr = this._dpr || 1;
    if (this.canvas.width !== Math.round(w * dpr)) this.resize();

    // The half-pixel offset lands every hairline on a device pixel centre.
    g.setTransform(dpr, 0, 0, dpr, 0.5 * dpr, 0.5 * dpr);
    g.clearRect(-1, -1, w + 2, h + 2);

    /* The 3D view has to recede far enough that the schematic is unambiguously
       the subject — a nebula this bright will win any fight it is allowed to
       have. A flat pull-down plus a vignette: hulls survive as silhouettes,
       the nebula does not survive as colour.

       0.80 rather than 0.74. The pull-down is effectively a brightness gate —
       whatever is left has to be bright enough to clear it — and at 0.74 a
       lit asteroid cleared it. Motherships, engine wash and beams still do. */
    g.fillStyle = 'rgba(3, 7, 12, 0.80)';
    g.fillRect(-1, -1, w + 2, h + 2);
    const wash = g.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.12, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    wash.addColorStop(0, 'rgba(2, 5, 9, 0)');
    wash.addColorStop(1, 'rgba(1, 3, 6, 0.78)');
    g.fillStyle = wash;
    g.fillRect(-1, -1, w + 2, h + 2);

    /* Everything from here to the matching restore is chart, and the chart does
       not run under the panels. */
    const clipped = this._chartClip(g, w, h);

    /* Terrain is knocked back before a single schematic mark is drawn, so the
       lattice and every contact sit on one flat ground. */
    this._footprints();
    this._occluders(g);
    this._grid(g);
    this._rings(g);
    this._fields(g);
    this._collect();
    this._stalks(g);
    this._blips(g);
    this._labels(g);
    this._selection(g);

    if (clipped) g.restore();
    /* The rule is the view's own furniture, not a contact, so it is drawn
       outside the inset — and lifted clear of whatever is in the bottom-left
       rather than clipped away by it. */
    this._scale(g, w, h);
    this._tally();
  }

  /* Inset the chart by the HUD's opaque panels.

     One canvas over another cannot hide what the renderer drew and it cannot
     hide what the DOM draws on top either: blips and ore-field circles were
     running underneath the PRODUCTION list, which reads as the schematic
     leaking rather than as a panel sitting over it.

     An even-odd path — the viewport, then each panel — clips to
     viewport-minus-panels in one call. The alternative, rescaling the schematic
     into the free area, was rejected: `core/input.js` owns the marquee and picks
     against the *live camera projection*, so moving a blip away from its hull's
     real screen position would make band-select in the Sensors Manager select
     the wrong ships. The weld to the projection is the whole design. */
  _chartClip(g, w, h) {
    const get = this.ctx && this.ctx.panelRects;
    const rects = typeof get === 'function' ? get() : null;
    if (!rects || !rects.length || typeof Path2D !== 'function') return false;

    const p = new Path2D();
    p.rect(-2, -2, w + 4, h + 4);
    let used = 0;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!r || !(r.w > 0) || !(r.h > 0)) continue;
      /* A panel that has grown to most of the screen is not an inset, it is a
         mistake; leave the chart whole rather than clip it to nothing. */
      if (r.w * r.h > w * h * 0.42) continue;
      p.rect(r.x, r.y, r.w, r.h);
      used++;
    }
    if (!used) return false;
    g.save();
    g.clip(p, 'evenodd');
    return true;
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

    /* `entities()` is the HUD's accessor over the live world; a torn-down or
       not-yet-attached world hands back something that is not iterable, and
       this pass runs every frame. */
    const src = typeof ctx.entities === 'function' ? ctx.entities() : null;
    if (!src || typeof src[Symbol.iterator] !== 'function') {
      this._nContacts = 0;
      return;
    }

    for (const e of src) {
      if (!e || e.alive === false) continue;
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
      c.sel = !!(ctx.selection && ctx.selection.has(e.id));
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

  /** Project every cluster once; the knock-down and the footprint both read
      this, and the radius no longer carries a pixel cap — a field the camera
      is standing in genuinely does fill the display, and a schematic that
      draws it as a 46 px token is lying about where the rock is. */
  _footprints() {
    /* The cluster records come from SIM by way of the HUD's tolerant reader, so
       the shape is not this module's to guarantee. Anything missing degrades to
       "no ore fields drawn", which is a duller schematic and not a dead one. */
    const src = this.ctx.resourceClusters;
    const clusters = typeof src === 'function' ? src() : null;
    const proj = this.ctx.proj;
    const { w, h } = this.ctx.view;
    const list = this._foots;
    const lim = Math.max(w, h) * 1.6;
    let n = 0;

    if (clusters && clusters.length) {
      for (let i = 0; i < clusters.length; i++) {
        const c = clusters[i];
        if (!c) continue;
        const p = c.position || c;
        if (!p || !Number.isFinite(p.x) || !proj.project(p.x, p.y, p.z)) continue;
        const sx = proj.sx;
        const sy = proj.sy;
        const px = ((c.radius || 1200) * FOOT_SEAM * proj.scaleK) / proj.cw;
        const seam = Math.max(FOOT_MIN_PX, Math.min(lim, px));
        const haze = Math.min(lim * 1.4, seam * (FOOT_HAZE / FOOT_SEAM));
        if (sx + haze < -2 || sx - haze > w + 2) continue;
        if (sy + haze < -2 || sy - haze > h + 2) continue;

        let f = list[n];
        if (!f) {
          f = { sx: 0, sy: 0, r: 0, haze: 0, left: 1, base: false, bx: 0, by: 0 };
          list[n] = f;
        }
        f.sx = sx;
        f.sy = sy;
        f.r = seam;
        f.haze = haze;
        f.left = c.maxAmount > 0 ? Math.max(0, Math.min(1, c.amount / c.maxAmount)) : 1;
        // Its own altitude stalk — a seam 4 km off the plane is a different
        // proposition to one sitting on it.
        f.base = Math.abs(p.y) > 60 && proj.project(p.x, 0, p.z);
        if (f.base) {
          f.bx = proj.sx;
          f.by = proj.sy;
        }
        n++;
      }
    }
    this._nFoots = n;
  }

  /* Put the void back under every rock field, before anything is drawn on it.

     The schematic is one canvas over another, so it cannot hide the 3D view —
     and a lit asteroid is the one object down there big and pale enough to
     survive the base wash as a solid mass. One rock swallowed most of a
     hostile fleet in a 353-contact capture: not by covering the blips, which
     are painted on top of it, but by replacing the flat ground they are read
     against with a textured grey shape the same size as the formation.

     A soft radial knock-down rather than a hard disc, because the seam record
     describes the ore, not the strays scattered a kilometre or two past it. */
  _occluders(g) {
    const list = this._foots;
    const n = this._nFoots;
    if (!n) return;
    const { w, h } = this.ctx.view;

    const cw = Math.max(1, Math.ceil(w / OCC_DIV));
    const ch = Math.max(1, Math.ceil(h / OCC_DIV));
    let off = this._occ;
    if (!off) {
      off = document.createElement('canvas');
      this._occ = off;
      this._occ2d = off.getContext('2d');
    }
    if (off.width !== cw || off.height !== ch) {
      off.width = cw;
      off.height = ch;
    }
    const o = this._occ2d;
    if (!o) return;
    o.clearRect(0, 0, cw, ch);

    for (let i = 0; i < n; i++) {
      const f = list[i];
      const sx = f.sx / OCC_DIV;
      const sy = f.sy / OCC_DIV;
      const haze = f.haze / OCC_DIV;
      const x0 = Math.max(0, sx - haze);
      const y0 = Math.max(0, sy - haze);
      const x1 = Math.min(cw, sx + haze);
      const y1 = Math.min(ch, sy + haze);
      if (x1 <= x0 || y1 <= y0) continue;

      const grad = o.createRadialGradient(sx, sy, (f.r * 0.5) / OCC_DIV, sx, sy, haze);
      grad.addColorStop(0, 'rgba(3, 7, 12, 0.92)');
      grad.addColorStop(0.3, 'rgba(3, 7, 12, 0.72)');
      grad.addColorStop(0.62, 'rgba(3, 7, 12, 0.34)');
      grad.addColorStop(1, 'rgba(3, 7, 12, 0)');
      o.fillStyle = grad;
      // A clipped rectangle rather than an arc: outside `haze` the gradient is
      // transparent anyway, and this bounds the work when a footprint is
      // several screens across.
      o.fillRect(x0, y0, x1 - x0, y1 - y0);
    }

    g.drawImage(off, 0, 0, w, h);
  }

  /* The field itself: hatched extent, hairline rim, and an arc for what is
     left in the seam.

     Hatching is the whole point. A filled disc asserts "solid — nothing
     behind this", which is false of a rock field and takes the ground out
     from under any contact drawn on it. A hatch asserts "occupied — read
     through it", which is what a commander actually needs: the rock is in the
     way of a hull, not of the display. */
  _fields(g) {
    const list = this._foots;
    const n = this._nFoots;
    if (!n) return;

    g.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const f = list[i];
      const span = f.r * 2;
      // Spacing opens up on a large footprint so the line count stays bounded.
      const step = Math.max(HATCH_PX, span / HATCH_MAX);
      g.save();
      g.beginPath();
      g.arc(f.sx, f.sy, f.r, 0, TAU);
      g.clip();
      g.strokeStyle = COL.rockHatch;
      g.beginPath();
      /* 45 degrees is the one angle neither the 5 km lattice nor a range ring
         runs at, so the hatch never doubles a line that is already there.

         A line offset `d` from the top-left corner clears the circle unless
         |r + d| < r*sqrt(2), so the sweep runs -2.5r to +0.5r. Anything
         narrower leaves an unhatched crescent on the lower-left rim. */
      for (let d = f.r * -2.5; d <= f.r * 0.5; d += step) {
        g.moveTo(f.sx + d, f.sy - f.r);
        g.lineTo(f.sx + d + span, f.sy + f.r);
      }
      g.stroke();
      g.restore();
    }

    g.strokeStyle = COL.rockLine;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const f = list[i];
      g.moveTo(f.sx + f.r, f.sy);
      g.arc(f.sx, f.sy, f.r, 0, TAU);
    }
    g.stroke();

    /* What is left in the seam, on the rim. A worked-out field quietly loses
       its arc and keeps its hatch — the ore runs out, the rock does not. */
    g.strokeStyle = COL.rockArc;
    g.lineWidth = 1.4;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const f = list[i];
      if (f.left >= 0.999 || f.left <= 0.002) continue;
      g.moveTo(f.sx, f.sy - f.r);
      g.arc(f.sx, f.sy, f.r, -Math.PI * 0.5, -Math.PI * 0.5 + TAU * f.left);
    }
    g.stroke();

    g.strokeStyle = COL.rockStalk;
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const f = list[i];
      if (!f.base) continue;
      g.moveTo(f.sx, f.sy);
      g.lineTo(f.bx, f.by);
      g.moveTo(f.bx - 4, f.by);
      g.lineTo(f.bx + 4, f.by);
    }
    g.stroke();
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
    /* Above whatever the HUD has parked in the bottom-left — the roster appears
       the moment anything is selected, and a scale bar sitting on its baseline
       reads as part of it. */
    let y0 = h - 78;
    const get = this.ctx && this.ctx.panelRects;
    const rects = typeof get === 'function' ? get() : null;
    if (rects) {
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (!r || r.x > w * 0.5) continue;      // left-hand furniture only
        y0 = Math.min(y0, r.y - 12);
      }
    }
    y0 = Math.max(60, y0);
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
    this._foots.length = 0;
    this._nFoots = 0;
    // Zeroing the backing store is the only way to hand a canvas's pixels back.
    if (this._occ) {
      this._occ.width = 0;
      this._occ.height = 0;
      this._occ = null;
      this._occ2d = null;
    }
  }
}
