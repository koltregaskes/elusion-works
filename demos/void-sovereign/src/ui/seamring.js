import { CONTROL } from '../sim/economy.js';

/* The capture boundary around each contested seam, drawn as a HUD mark.

   Round 4, fix 2. Round 3 drew this boundary as world geometry: a ladder of
   upright ticks in the team hue, standing on the capture radius. The critic
   read the left half of the first-contact frame as "orange rain or scattered
   tracer", and every part of that read had a cause:

     - the hostile hue. The ticks wore the enemy's trim, which is the same
       amber family as the hostile contact marks and the hostile weapon fire,
       so "is that orange line a rule or a shot at me?" had no answer;
     - world geometry. As scene meshes the ticks took depth of field and
       bloom, so some were soft, and a soft bright rod is a laser bolt;
     - perspective. Uprights billboarded about the world vertical, seen down
       a perspective arc, alternated between radial and tangential on screen,
       and their apparent size changed with range, so they scattered.

   A rule is not a body, so this one is not in the world at all. It is a 2D
   canvas under the marker layer, which is why nothing in the post stack can
   touch it, and every quantity a reader uses to tell a mark from a shot is
   fixed in screen pixels:

     - one hairline dashed ellipse at the capture radius, with dashes of a
       constant screen length that restart at every tick, so the pattern
       cannot crawl round the ring as the camera moves;
     - twenty-four ticks of constant screen length (every fourth one longer,
       so the eye has a repeat to count), all perpendicular to the drawn arc
       and all pointing outward. Never mixed orientations;
     - white, the HUD's "everything else" ink, never amber. Ownership still
       reads, but through form rather than through the enemy's hue: hold
       progress is a solid arc that grows round the ring from a fixed bearing,
       cyan when it is ours and ink when it is theirs, and when the ring is
       large enough to carry one, a short label says which in words.

   The radius is c.radius + CONTROL.RADIUS, read off the same records
   sim/economy.js tests presence against, so the line a player sees is the
   line they are judged by. Control, ownership and the contested flag are
   SIM's and are never recomputed here.

   Cost: zero draw calls on the WebGL side (the 3D boundary mesh is gone), and
   a few hundred projections and three canvas strokes per visible seam.

   Round 5, fix 5. The critic's round 4 verdict was "verified, at a price":
   in most early frames the rings were the largest drawn shapes, swept half
   the frame in full-strength friendly cyan, sliced the planet as a hairline
   when seen edge-on, and printed "SEAM · THEIRS 9%" over an impact cloud. So:

     - the whole rule is drawn at about 35% of its old strength (RULE_A);
     - it fades with camera distance (DIST_NEAR..DIST_FAR, down to DIST_MIN)
       and fades sooner when the ring is larger than the frame (BIG_*);
     - edge-on it is culled, not thinned: below about 3.5 degrees of
       elevation nothing draws, and it is back in full by about 10;
     - every part of the ring is neutral bone. Ownership is one short, thin
       filled arc segment from the zero bearing whose length is the hold, cyan
       only when it is ours; theirs gets the same segment in bone. A seam we
       hold is no longer a cyan ellipse;
     - a label is dropped when an engaged hull (one with a target, and so
       with fire and impacts round it) projects inside or near its box. */

/* Samples round the circle. Four per tick pitch: the chord error at 3.75
   degrees is about a sixth of a pixel on a ring 300 px across. */
const TICKS = 24;
const PER_TICK = 4;
const SAMPLES = TICKS * PER_TICK;

/* Screen pixels, all of them. */
const TICK_PX = 5;
const RANK_PX = 9;
const DASH = [5, 4];
const LINE_PX = 1;
const HOLD_PX = 3;
/* The ownership segment covers at most this fraction of the ring at full hold. */
const HOLD_SPAN = 1 / 6;
/* Overall strength of the rule relative to round 4. */
const RULE_A = 0.35;

/* Range fades, carried over from the 3D boundary so the rule appears and
   leaves at the same moments it used to. Past 24 km a boundary is somewhere
   you are not fighting; and a ring much larger than the frame is one the
   camera is standing inside, where its near arc would sweep the screen. */
const FADE_NEAR = 24000;
const FADE_FAR = 48000;
const BIG_FROM = 0.8;
const BIG_TO = 2.0;
/* Distance fade inside the range above: a near ring is the one being decided
   about; one across the map keeps only DIST_MIN of its strength. */
const DIST_NEAR = 3000;
const DIST_FAR = 16000;
const DIST_MIN = 0.45;
/* Edge-on cull: sine of the camera's elevation over the ring's plane. */
const EDGE_OFF = 0.06;
const EDGE_ON = 0.17;
/* Keep-out round a label, in px, for engaged hulls (their fire and impacts). */
const LABEL_FX_PAD = 36;

/* Below these projected radii the ring is too small to carry all its marks:
   first the plain ticks go, then the label. The ticks never shrink, because
   a mark that changes size with range is the thing being fixed. */
const PLAIN_TICKS_PX = 90;
const LABEL_PX = 70;
const MAX_LABELS = 2;
const LABEL_FONT = '500 10px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/* Neutral bone: the rule's own ink, warm enough that it cannot be read as
   friendly cyan or as the HUD's cold white text. */
const BONE = '214, 206, 188';
const CYAN = '127, 216, 232';
const HALO = 'rgba(2, 6, 10, ';

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const COS = new Float64Array(SAMPLES + 1);
const SIN = new Float64Array(SAMPLES + 1);
for (let k = 0; k <= SAMPLES; k++) {
  const th = (k / SAMPLES) * Math.PI * 2;
  COS[k] = Math.cos(th);
  SIN[k] = Math.sin(th);
}

export class SeamRing {
  constructor({ root, ctx, camera }) {
    this.ctx = ctx;
    this.camera = camera;
    this._hidden = false;
    this._drew = false;
    this._w = 0;
    this._h = 0;
    this._dpr = 0;

    const cv = document.createElement('canvas');
    cv.className = 'vsh-seams';
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    cv.setAttribute('aria-hidden', 'true');
    /* First child of the marker host, so every contact mark and bracket paints
       over the ring rather than under it. */
    root.insertBefore(cv, root.firstChild);
    this.canvas = cv;
    this.g = cv.getContext('2d');
    this.hudRoot = root.parentElement || root;

    /* Where the ring must not draw: the top bar, the docked panels and the
       onboarding card. Under the markers is right for the battlespace, but a
       rule running through the objective text or a production price is the
       HUD talking over itself. Refreshed a few times a second, not per frame:
       it reads layout. */
    this._mask = [];
    this._maskAt = -1;

    /* Label requests, reused every frame. Only the largest rings are named:
       six labels over a fleet battle is the HUD talking over the picture, and
       the ring nearest the camera is the one the player is deciding about. */
    this._labels = [];
    this._labelN = 0;

    /* Per-seam scratch, reused every frame. */
    this._sx = new Float64Array(SAMPLES + 1);
    this._sy = new Float64Array(SAMPLES + 1);
    this._ok = new Uint8Array(SAMPLES + 1);
  }

  setHidden(hidden) {
    if (this._hidden === hidden) return;
    this._hidden = hidden;
    this.canvas.hidden = hidden;
  }

  _fit() {
    const v = this.ctx.view;
    const dpr = v.dpr || 1;
    if (v.w === this._w && v.h === this._h && dpr === this._dpr) return;
    this._w = v.w;
    this._h = v.h;
    this._dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(v.w * dpr));
    this.canvas.height = Math.max(1, Math.round(v.h * dpr));
    this._drew = true; // a resize clears; force the next pass to repaint
  }

  update() {
    if (this._hidden) return;
    this._fit();
    const g = this.g;
    if (this._drew) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this._drew = false;
    }

    const list = this.ctx.resourceClusters();
    if (!list || !list.length) return;
    const cam = this.camera;
    if (!cam) return;
    g.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

    const world = this.ctx.world;
    const human = world && typeof world.humanTeam === 'number' && world.humanTeam >= 0
      ? world.humanTeam
      : this.ctx.team || 0;
    /* SIM's sign convention: control runs -1 (team 0 holds it) to +1 (team 1). */
    const mineSign = human === 0 ? -1 : 1;

    this._refreshMask();
    this._labelN = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || !c.contested || !c.position) continue;
      if (this._drawSeam(c, mineSign)) this._drew = true;
    }
    this._drawLabels();

    /* Cut the panels out after the fact. Erasing copes with overlapping rects,
       which a single even-odd clip path would put back. */
    if (this._drew && this._mask.length) {
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      for (const r of this._mask) g.fillRect(r.x, r.y, r.w, r.h);
      g.globalCompositeOperation = 'source-over';
    }
  }

  _refreshMask() {
    const now = performance.now();
    if (this._maskAt >= 0 && now - this._maskAt < 250) return;
    this._maskAt = now;
    const out = this._mask;
    out.length = 0;
    const base = this.hudRoot.getBoundingClientRect();
    const push = (node, pad) => {
      if (!node || node.hidden) return;
      const r = node.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return;
      out.push({ x: r.left - base.left - pad, y: r.top - base.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 });
    };
    push(this.hudRoot.querySelector('.vsh-top'), 6);
    push(this.hudRoot.querySelector('.vsh-paused__tag'), 8);
    push(document.querySelector('.vst-card'), 10);
    const get = this.ctx.panelRects;
    const panels = typeof get === 'function' ? get() : null;
    if (panels) for (const r of panels) out.push({ x: r.x, y: r.y, w: r.w, h: r.h });
  }

  _masked(x0, y0, x1, y1) {
    for (const r of this._mask) {
      if (x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h) return true;
    }
    return false;
  }

  /** Returns true if anything was painted. */
  _drawSeam(c, mineSign) {
    const proj = this.ctx.proj;
    const cam = this.camera;
    const g = this.g;
    const R = c.radius + CONTROL.RADIUS;
    const cx = c.position.x;
    const cy = c.position.y;
    const cz = c.position.z;

    const dx = cam.position.x - cx;
    const dy = cam.position.y - cy;
    const dz = cam.position.z - cz;
    const dC = Math.hypot(dx, dy, dz) || 1;
    const p11 = Math.max(cam.projectionMatrix.elements[5], 1e-4);
    const halfC = dC / p11;
    let a = (1 - smoothstep(FADE_NEAR, FADE_FAR, dC)) * (1 - smoothstep(BIG_FROM, BIG_TO, R / Math.max(halfC, 1)));
    a *= 1 - (1 - DIST_MIN) * smoothstep(DIST_NEAR, DIST_FAR, dC);
    /* Edge-on, the ellipse collapses toward one line across the frame -- a
       hairline through the planet. It is culled rather than thinned. */
    const up = Math.abs(dy) / dC;
    a *= smoothstep(EDGE_OFF, EDGE_ON, up);
    if (a < 0.02) return false;

    /* Projected radius, for deciding how many marks the ring can carry. */
    if (!proj.project(cx, cy, cz)) return false;
    const rPx = (R * proj.scaleK) / proj.cw;
    if (rPx < 6) return false;

    const sx = this._sx;
    const sy = this._sy;
    const ok = this._ok;
    const W = this._w;
    const H = this._h;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k <= SAMPLES; k++) {
      if (proj.project(cx + COS[k] * R, cy, cz + SIN[k] * R)) {
        ok[k] = 1;
        sx[k] = proj.sx;
        sy[k] = proj.sy;
        if (proj.sx < minX) minX = proj.sx;
        if (proj.sx > maxX) maxX = proj.sx;
        if (proj.sy < minY) minY = proj.sy;
        if (proj.sy > maxY) maxY = proj.sy;
      } else {
        ok[k] = 0;
      }
    }
    if (maxX < -20 || minX > W + 20 || maxY < -20 || minY > H + 20) return false;

    const ra = a * RULE_A;

    const ctl = Math.max(-1, Math.min(1, c.control || 0));
    const hold = Math.abs(ctl);
    const ours = ctl * mineSign > 0;

    g.lineCap = 'butt';
    g.lineJoin = 'round';

    /* ---- the dashed rule, one sub-path per tick pitch so the dash phase
       restarts at every tick. Halo first, then ink. */
    g.beginPath();
    for (let t = 0; t < TICKS; t++) {
      let open = false;
      for (let j = 0; j <= PER_TICK; j++) {
        const k = t * PER_TICK + j;
        if (!ok[k]) {
          open = false;
          continue;
        }
        if (!open) {
          g.moveTo(sx[k], sy[k]);
          open = true;
        } else {
          g.lineTo(sx[k], sy[k]);
        }
      }
    }
    g.setLineDash(DASH);
    g.lineDashOffset = -2;
    g.lineWidth = LINE_PX + 2;
    g.strokeStyle = HALO + (0.32 * ra).toFixed(3) + ')';
    g.stroke();
    g.lineWidth = LINE_PX;
    g.strokeStyle = 'rgba(' + BONE + ', ' + (0.42 * ra).toFixed(3) + ')';
    g.stroke();
    g.setLineDash([]);

    /* ---- ticks: perpendicular to the drawn arc, outward, fixed length. */
    const allTicks = rPx >= PLAIN_TICKS_PX;
    g.beginPath();
    for (let t = 0; t < TICKS; t++) {
      const rank = t % 4 === 0;
      if (!rank && !allTicks) continue;
      const k = t * PER_TICK;
      const kp = k === 0 ? SAMPLES - 1 : k - 1;
      const kn = k + 1;
      if (!ok[k] || !ok[kp] || !ok[kn]) continue;
      let tx = sx[kn] - sx[kp];
      let ty = sy[kn] - sy[kp];
      const tl = Math.hypot(tx, ty);
      if (tl < 1e-3) continue;
      tx /= tl;
      ty /= tl;
      let nx = -ty;
      let ny = tx;
      /* Outward is decided in the world and only its sign is taken from the
         screen, so the tick stays perpendicular to the arc as drawn. */
      if (proj.project(cx + COS[k] * R * 1.04, cy, cz + SIN[k] * R * 1.04)) {
        if ((proj.sx - sx[k]) * nx + (proj.sy - sy[k]) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
      }
      const len = rank ? RANK_PX : TICK_PX;
      g.moveTo(sx[k], sy[k]);
      g.lineTo(sx[k] + nx * len, sy[k] + ny * len);
    }
    g.lineWidth = LINE_PX + 2;
    g.strokeStyle = HALO + (0.40 * ra).toFixed(3) + ')';
    g.stroke();
    g.lineWidth = LINE_PX;
    g.strokeStyle = 'rgba(' + BONE + ', ' + (0.66 * ra).toFixed(3) + ')';
    g.stroke();

    /* ---- ownership: one short, thin filled arc segment from the zero
       bearing, its length the hold. Cyan only when it is ours. */
    const col = ours ? CYAN : BONE;
    if (hold > 0.01) {
      const span = hold * HOLD_SPAN * SAMPLES;
      const whole = Math.floor(span);
      g.beginPath();
      let open = false;
      for (let k = 0; k <= whole && k <= SAMPLES; k++) {
        if (!ok[k]) {
          open = false;
          continue;
        }
        if (!open) {
          g.moveTo(sx[k], sy[k]);
          open = true;
        } else {
          g.lineTo(sx[k], sy[k]);
        }
      }
      const f = span - whole;
      if (open && f > 0 && whole < SAMPLES && ok[whole + 1]) {
        g.lineTo(sx[whole] + (sx[whole + 1] - sx[whole]) * f, sy[whole] + (sy[whole + 1] - sy[whole]) * f);
      }
      g.lineWidth = HOLD_PX + 2;
      g.strokeStyle = HALO + (0.5 * a).toFixed(3) + ')';
      g.stroke();
      /* A segment, never a ring: at full hold it is a sixth of the
         circumference. In round 4 a held seam was a cyan ellipse across half
         the frame. */
      g.lineWidth = HOLD_PX;
      g.strokeStyle = 'rgba(' + col + ', ' + ((ours ? 0.62 : 0.4) * a).toFixed(3) + ')';
      g.stroke();
    }

    /* ---- the label: words, so ownership never depends on a hue. It sits at
       an apex of the ellipse -- above the top one, or failing that below the
       bottom one -- because at an apex the line runs level and falls away from
       the text instead of through it. No apex clear of the panels, no label. */
    if (rPx >= LABEL_PX && a > 0.25) {
      let top = -1;
      let bot = -1;
      for (let k = 0; k < SAMPLES; k++) {
        if (!ok[k]) continue;
        if (top < 0 || sy[k] < sy[top]) top = k;
        if (bot < 0 || sy[k] > sy[bot]) bot = k;
      }
      let text;
      if (c.owner === 0 || c.owner === 1) text = ours ? 'SEAM · YOURS' : 'SEAM · THEIRS';
      else if (hold > 0.01) text = (ours ? 'SEAM · YOURS ' : 'SEAM · THEIRS ') + Math.round(hold * 100) + '%';
      else text = 'SEAM · CONTESTED';
      g.font = LABEL_FONT;
      if ('letterSpacing' in g) g.letterSpacing = '1.5px';
      const tw = g.measureText(text).width;
      const fits = (k, above) => {
        if (k < 0) return false;
        const x = sx[k];
        const y0 = above ? sy[k] - 21 : sy[k] + 7;
        if (x - tw / 2 < 8 || x + tw / 2 > W - 8 || y0 < 4 || y0 + 14 > H - 4) return false;
        if (this._masked(x - tw / 2 - 4, y0 - 2, x + tw / 2 + 4, y0 + 16)) return false;
        return !this._nearFx(x - tw / 2 - LABEL_FX_PAD, y0 - LABEL_FX_PAD, x + tw / 2 + LABEL_FX_PAD, y0 + 14 + LABEL_FX_PAD);
      };
      let k = -1;
      let above = true;
      if (fits(top, true)) k = top;
      else if (fits(bot, false)) {
        k = bot;
        above = false;
      }
      if (k >= 0) {
        const L = this._labels[this._labelN] || (this._labels[this._labelN] = {});
        this._labelN++;
        L.text = text;
        L.x = sx[k];
        L.y = above ? sy[k] - 7 : sy[k] + 7;
        L.y0 = above ? sy[k] - 21 : sy[k] + 7;
        L.w = tw;
        L.above = above;
        L.col = BONE;
        L.a = a;
        L.r = rPx;
      }
    }
    return true;
  }

  /** True if an engaged hull -- one with a target, so with fire and impacts
      round it -- projects inside the box. Labels only, a few per frame. */
  _nearFx(x0, y0, x1, y1) {
    const ents = typeof this.ctx.entities === 'function' ? this.ctx.entities() : null;
    if (!ents) return false;
    const proj = this.ctx.proj;
    for (const e of ents) {
      if (!e || e.alive === false || !(e.targetId >= 0)) continue;
      const p = (e.object3D && e.object3D.position) || e.position;
      if (!p || !proj.project(p.x, p.y, p.z)) continue;
      if (proj.sx > x0 && proj.sx < x1 && proj.sy > y0 && proj.sy < y1) return true;
    }
    return false;
  }

  _drawLabels() {
    const n = this._labelN;
    if (!n) return;
    const L = this._labels;
    /* Largest first; a handful of entries, so a plain insertion sort. */
    for (let i = 1; i < n; i++) {
      const t = L[i];
      let j = i - 1;
      while (j >= 0 && L[j].r < t.r) {
        L[j + 1] = L[j];
        j--;
      }
      L[j + 1] = t;
    }
    const g = this.g;
    g.font = LABEL_FONT;
    if ('letterSpacing' in g) g.letterSpacing = '1.5px';
    g.textAlign = 'center';
    g.lineWidth = 3;
    let drawn = 0;
    for (let i = 0; i < n && drawn < MAX_LABELS; i++) {
      const q = L[i];
      /* Two labels must not stack on each other either. */
      let clash = false;
      for (let j = 0; j < i; j++) {
        const p = L[j];
        if (!p.drawn) continue;
        if (Math.abs(p.x - q.x) < (p.w + q.w) / 2 + 12 && Math.abs(p.y0 - q.y0) < 20) clash = true;
      }
      q.drawn = !clash;
      if (clash) continue;
      g.textBaseline = q.above ? 'bottom' : 'top';
      g.strokeStyle = HALO + (0.75 * q.a).toFixed(3) + ')';
      g.strokeText(q.text, q.x, q.y);
      g.fillStyle = 'rgba(' + q.col + ', ' + (0.62 * q.a).toFixed(3) + ')';
      g.fillText(q.text, q.x, q.y);
      drawn++;
    }
  }

  dispose() {
    this.canvas.remove();
  }
}

export default SeamRing;
