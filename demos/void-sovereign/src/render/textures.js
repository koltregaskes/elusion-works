import * as THREE from '../../vendor/three/build/three.module.js';
import { makeRng, fbm2, worley3, hash2 } from '../core/rng.js';

/* Procedural texture library.

   There are no binary art assets in this project, so every texel a ship shows
   is manufactured here at load time: canvas 2D rasterises the structural
   detail (plates, grooves, rivets, hatches, stencils) and a per-pixel pass
   derives albedo / normal / ORM / emissive from that height field.

   The hull atlas is one 2048² sheet per map, split into a 2x2 grid of 1024²
   regions:

       +-------------+-------------+
       |  lancer     |  bulwark    |   plate families — tiled at plate density
       +-------------+-------------+
       |  monolith   |  macro 2x2  |   macro = 4 independently-tileable 512²
       +-------------+-------------+   variants of hatches/stencils/windows

   Each region tiles seamlessly *within itself*; the shader picks a region and
   wraps with fract() + textureGrad(), so one texture serves every hull in the
   fleet without a single extra draw call.

   Channel plan (frozen — materials.js decodes exactly this):

     map        rgb = albedo (sRGB)
                a   = plate regions: paint coverage (1 painted, 0 bare metal)
                      macro regions: stamp coverage (blend weight over base)
     orm        r   = ambient occlusion
                g   = roughness
                b   = metalness
                a   = plate regions: 1
                      macro regions: team trim mask (0.5 secondary, 1 primary)
     normalMap  rgb = tangent-space normal
     emissive   rgb = emissive colour (sRGB), a = 1 for team running lights,
                      0 for warm interior windows                              */

/* --------------------------------------------------------------------- maths */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const TAU = Math.PI * 2;

/** Wrap any non-tileable field into a seamless one by cross-fading its four
    toroidal shifts. Costs 4 evaluations — only used on low-res mask buffers. */
function tileable2(fn, x, y, period) {
  const u = x / period;
  const v = y / period;
  const a = fn(x, y);
  const b = fn(x - period, y);
  const c = fn(x, y - period);
  const d = fn(x - period, y - period);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

/** Cheap value noise that is exactly periodic on `period` lattice cells. */
function vnoise(x, y, period) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = (a) => ((a % period) + period) % period;
  const x0 = w(xi);
  const x1 = w(xi + 1);
  const y0 = w(yi);
  const y1 = w(yi + 1);
  const a = hash2(x0, y0);
  const b = hash2(x1, y0);
  const c = hash2(x0, y1);
  const d = hash2(x1, y1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Toroidal separable box blur — the AO/cavity term needs a wide, cheap blur. */
function boxBlurWrap(src, S, radius) {
  const tmp = new Float32Array(S * S);
  const out = new Float32Array(S * S);
  const n = radius * 2 + 1;
  const inv = 1 / n;
  for (let y = 0; y < S; y++) {
    const row = y * S;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[row + ((k % S) + S) % S];
    for (let x = 0; x < S; x++) {
      tmp[row + x] = sum * inv;
      const out_ = src[row + ((x - radius) % S + S) % S];
      const in_ = src[row + ((x + radius + 1) % S + S) % S];
      sum += in_ - out_;
    }
  }
  for (let x = 0; x < S; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[((((k % S) + S) % S) * S) + x];
    for (let y = 0; y < S; y++) {
      out[y * S + x] = sum * inv;
      const out_ = tmp[((((y - radius) % S + S) % S) * S) + x];
      const in_ = tmp[((((y + radius + 1) % S + S) % S) * S) + x];
      sum += in_ - out_;
    }
  }
  return out;
}

/** Bilinear, wrapping upsample of a low-res mask to full region resolution. */
function upsampleWrap(small, MS, S) {
  const out = new Float32Array(S * S);
  const step = MS / S;
  for (let y = 0; y < S; y++) {
    const fy = y * step;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const r0 = (y0 % MS) * MS;
    const r1 = ((y0 + 1) % MS) * MS;
    for (let x = 0; x < S; x++) {
      const fx = x * step;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const c0 = x0 % MS;
      const c1 = (x0 + 1) % MS;
      const a = small[r0 + c0];
      const b = small[r0 + c1];
      const c = small[r1 + c0];
      const d = small[r1 + c1];
      out[y * S + x] = mix(mix(a, b, tx), mix(c, d, tx), ty);
    }
  }
  return out;
}

/* ------------------------------------------------------------ canvas helpers */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(canvas) {
  return canvas.getContext('2d', { willReadFrequently: true, alpha: true });
}

const grey = (v) => {
  const b = Math.round(clamp01(v) * 255);
  return `rgb(${b},${b},${b})`;
};

/** Run `fn` for every toroidal copy of a shape that could touch the canvas.
    Everything drawn into a region goes through this so the region tiles. */
function wrapDraw(S, x, y, w, h, fn) {
  const xs = [0];
  if (x < 0) xs.push(S);
  else if (x + w > S) xs.push(-S);
  const ys = [0];
  if (y < 0) ys.push(S);
  else if (y + h > S) ys.push(-S);
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < ys.length; j++) fn(x + xs[i], y + ys[j]);
  }
}

/* ------------------------------------------------------- plate decomposition */

/** n cyclic boundaries summing exactly to S, each jittered about S/n. */
function cyclicEdges(S, n, rng, jitter) {
  const w = new Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    w[i] = 1 + rng.range(-jitter, jitter);
    total += w[i];
  }
  const edges = new Array(n + 1);
  edges[0] = 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += (w[i] / total) * S;
    edges[i + 1] = Math.round(acc);
  }
  edges[n] = S;
  return edges;
}

/** Running-bond plate layout: rows of cyclic columns, each row phase-shifted.
    Sub-splits stay inside their parent cell so the whole field stays toroidal. */
function buildPlates(S, rng, cfg) {
  const plates = [];
  const rowEdges = cyclicEdges(S, cfg.rows, rng, cfg.rowJitter);

  for (let r = 0; r < cfg.rows; r++) {
    const y = rowEdges[r];
    const h = rowEdges[r + 1] - y;
    const cols = Math.max(2, Math.round(cfg.cols * rng.range(0.7, 1.35)));
    const colEdges = cyclicEdges(S, cols, rng, cfg.colJitter);
    const phase = Math.round(rng.range(0, S));

    for (let c = 0; c < cols; c++) {
      let x = (colEdges[c] + phase) % S;
      const w = colEdges[c + 1] - colEdges[c];
      if (w < 6 || h < 6) continue;
      subdivide(plates, x, y, w, h, rng, cfg, 0);
    }
  }
  return plates;
}

function subdivide(out, x, y, w, h, rng, cfg, depth) {
  const canSplit = depth < cfg.maxDepth && Math.max(w, h) > cfg.minPlate * 2.1;
  if (canSplit && rng.chance(cfg.splitChance * (1 - depth * 0.35))) {
    const along = w >= h;
    const span = along ? w : h;
    const cut = Math.round(span * rng.range(0.3, 0.7));
    if (cut > cfg.minPlate && span - cut > cfg.minPlate) {
      if (along) {
        subdivide(out, x, y, cut, h, rng, cfg, depth + 1);
        subdivide(out, x + cut, y, w - cut, h, rng, cfg, depth + 1);
      } else {
        subdivide(out, x, y, w, cut, rng, cfg, depth + 1);
        subdivide(out, x, y + cut, w, h - cut, rng, cfg, depth + 1);
      }
      return;
    }
  }
  out.push({ x, y, w, h, depth, k: rng.next(), tint: rng.gaussian(0, 0.34) });
}

/* -------------------------------------------------------------- surface kit */

/* Every primitive writes two canvases:
     H  — height, mid-grey is the hull datum
     M  — control: r = per-plate tint, g = paint coverage, b = machined metal,
                   a = emissive hint                                          */

function fillRectWrap(c, S, x, y, w, h, style) {
  c.fillStyle = style;
  wrapDraw(S, x, y, w, h, (px, py) => c.fillRect(px, py, w, h));
}

function strokeLineWrap(c, S, x0, y0, x1, y1, width, style) {
  c.strokeStyle = style;
  c.lineWidth = width;
  c.lineCap = 'butt';
  const bx = Math.min(x0, x1) - width;
  const by = Math.min(y0, y1) - width;
  const bw = Math.abs(x1 - x0) + width * 2;
  const bh = Math.abs(y1 - y0) + width * 2;
  wrapDraw(S, bx, by, bw, bh, (px, py) => {
    const dx = px - bx;
    const dy = py - by;
    c.beginPath();
    c.moveTo(x0 + dx, y0 + dy);
    c.lineTo(x1 + dx, y1 + dy);
    c.stroke();
  });
}

function circleWrap(c, S, cx, cy, r, style) {
  c.fillStyle = style;
  wrapDraw(S, cx - r, cy - r, r * 2, r * 2, (px, py) => {
    c.beginPath();
    c.arc(px + r, py + r, r, 0, TAU);
    c.fill();
  });
}

/** Recessed panel groove with a chamfer highlight on the lit side. */
function groove(H, S, x0, y0, x1, y1, width, depth) {
  strokeLineWrap(H, S, x0, y0, x1, y1, width, grey(0.5 - depth));
  if (width > 2) {
    const vert = Math.abs(x1 - x0) < Math.abs(y1 - y0);
    const o = width * 0.5 + 0.5;
    strokeLineWrap(
      H, S,
      x0 + (vert ? o : 0), y0 + (vert ? 0 : o),
      x1 + (vert ? o : 0), y1 + (vert ? 0 : o),
      1, grey(0.5 + depth * 0.32),
    );
  }
}

/** Fastener row along a seam: proud dome plus a contact-shadow ring. */
function rivetRow(H, M, S, x0, y0, x1, y1, spacing, r, rng) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const n = Math.max(2, Math.floor(len / spacing));
  const ux = dx / n;
  const uy = dy / n;
  for (let i = 0; i < n; i++) {
    const jx = rng.range(-0.4, 0.4);
    const cx = x0 + ux * (i + 0.5) + jx;
    const cy = y0 + uy * (i + 0.5) + jx;
    circleWrap(H, S, cx, cy, r + 0.9, grey(0.455));
    circleWrap(H, S, cx, cy, r, grey(0.58 + rng.range(-0.02, 0.02)));
    circleWrap(M, S, cx, cy, r, 'rgba(128,110,220,1)');
  }
}

/** Weld bead: overlapping proud blobs, slightly molten and rough. */
function weldBead(H, M, S, x0, y0, x1, y1, w, rng) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const n = Math.max(3, Math.floor(len / (w * 0.62)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const cx = x0 + dx * t;
    const cy = y0 + dy * t;
    const rr = w * rng.range(0.42, 0.62);
    circleWrap(H, S, cx, cy, rr, grey(0.545 + rng.range(-0.012, 0.012)));
    circleWrap(M, S, cx, cy, rr, 'rgba(128,150,190,1)');
  }
}

function roundRectPath(c, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.arcTo(x + w, y, x + w, y + rr, rr);
  c.lineTo(x + w, y + h - rr);
  c.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  c.lineTo(x + rr, y + h);
  c.arcTo(x, y + h, x, y + h - rr, rr);
  c.lineTo(x, y + rr);
  c.arcTo(x, y, x + rr, y, rr);
  c.closePath();
}

function roundRectWrap(c, S, x, y, w, h, r, style, stroke, lw) {
  wrapDraw(S, x - 2, y - 2, w + 4, h + 4, (px, py) => {
    roundRectPath(c, px + 2, py + 2, w, h, r);
    if (style) {
      c.fillStyle = style;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lw || 1;
      c.stroke();
    }
  });
}

/** Access hatch: recessed door, raised lip, corner fasteners, tool slot. */
function hatch(H, M, S, x, y, w, h, rng) {
  const r = Math.min(w, h) * rng.range(0.06, 0.2);
  roundRectWrap(H, S, x - 1, y - 1, w + 2, h + 2, r + 1, grey(0.545), null, 0);
  roundRectWrap(H, S, x, y, w, h, r, grey(0.44), grey(0.40), 2);
  // inner door face sits slightly proud of the recess floor
  roundRectWrap(H, S, x + 2.5, y + 2.5, w - 5, h - 5, Math.max(0, r - 1), grey(0.487), null, 0);
  roundRectWrap(M, S, x, y, w, h, r, 'rgba(128,255,40,1)', null, 0);

  const fr = Math.max(1.2, Math.min(w, h) * 0.045);
  const inset = fr + 3.5;
  const corners = [
    [x + inset, y + inset], [x + w - inset, y + inset],
    [x + inset, y + h - inset], [x + w - inset, y + h - inset],
  ];
  for (const [cx, cy] of corners) {
    circleWrap(H, S, cx, cy, fr + 0.8, grey(0.45));
    circleWrap(H, S, cx, cy, fr, grey(0.565));
    circleWrap(M, S, cx, cy, fr, 'rgba(128,120,230,1)');
  }
  // recessed handle slot
  if (w > 26 && h > 18 && rng.chance(0.7)) {
    const sw = w * 0.26;
    const sh = Math.max(2, h * 0.08);
    fillRectWrap(H, S, x + w * 0.5 - sw * 0.5, y + h * 0.5 - sh * 0.5, sw, sh, grey(0.40));
  }
}

/** Louvred vent / radiator grille. Fine parallel slats, machined metal. */
function vent(H, M, E, S, x, y, w, h, rng, warm) {
  const vertical = w > h;
  const span = vertical ? h : w;
  const pitch = Math.max(3, span / rng.int(5, 11));
  roundRectWrap(H, S, x - 1.5, y - 1.5, w + 3, h + 3, 2, grey(0.552), null, 0);
  fillRectWrap(H, S, x, y, w, h, grey(0.40));
  fillRectWrap(M, S, x, y, w, h, 'rgba(128,70,235,1)');

  const n = Math.floor(span / pitch);
  for (let i = 0; i < n; i++) {
    const t = i * pitch + pitch * 0.35;
    if (vertical) {
      fillRectWrap(H, S, x + 1, y + t, w - 2, pitch * 0.42, grey(0.512));
      fillRectWrap(H, S, x + 1, y + t + pitch * 0.42, w - 2, 1, grey(0.355));
    } else {
      fillRectWrap(H, S, x + t, y + 1, pitch * 0.42, h - 2, grey(0.512));
      fillRectWrap(H, S, x + t + pitch * 0.42, y + 1, 1, h - 2, grey(0.355));
    }
  }
  // A warm sliver of internal glow — never bright enough to reach the bloom
  // threshold, just enough to say "there is a reactor behind this".
  if (warm && E) {
    const g = Math.round(rng.range(34, 62));
    fillRectWrap(E, S, x + 1.5, y + 1.5, w - 3, h - 3,
      `rgb(${g},${Math.round(g * 0.42)},${Math.round(g * 0.16)})`);
  }
}

/** Raised greeble stamp — the little boxes that give scale to a big flat. */
function greeble(H, M, S, x, y, w, h, rng) {
  const up = rng.chance(0.72);
  const amp = rng.range(0.03, 0.085) * (up ? 1 : -1);
  fillRectWrap(H, S, x, y, w, h, grey(0.5 + amp));
  fillRectWrap(H, S, x, y + h - 1, w, 1, grey(0.5 + amp * 0.2 - 0.045));
  fillRectWrap(H, S, x, y, w, 1, grey(0.5 + amp + 0.03));
  fillRectWrap(M, S, x, y, w, h, 'rgba(128,205,170,1)');
  if (w > 9 && h > 9 && rng.chance(0.45)) {
    const iw = w * rng.range(0.22, 0.5);
    const ih = h * rng.range(0.22, 0.5);
    fillRectWrap(H, S, x + (w - iw) * 0.5, y + (h - ih) * 0.5, iw, ih, grey(0.5 + amp * 1.9));
  }
}

/** Pipe / conduit run with end brackets. */
function pipeRun(H, M, S, x, y, len, r, horiz, rng) {
  const w = horiz ? len : r * 2;
  const h = horiz ? r * 2 : len;
  fillRectWrap(H, S, x, y, w, h, grey(0.5));
  for (let i = 0; i < r * 2; i++) {
    const t = i / (r * 2 - 1);
    const v = 0.5 + 0.055 * Math.sin(t * Math.PI) - 0.02;
    if (horiz) fillRectWrap(H, S, x, y + i, w, 1, grey(v));
    else fillRectWrap(H, S, x + i, y, 1, h, grey(v));
  }
  fillRectWrap(M, S, x, y, w, h, 'rgba(128,140,225,1)');
  const bn = Math.max(2, Math.floor(len / rng.range(28, 54)));
  for (let i = 0; i <= bn; i++) {
    const t = (i / bn) * len;
    if (horiz) fillRectWrap(H, S, x + t, y - 1.5, 3, h + 3, grey(0.53));
    else fillRectWrap(H, S, x - 1.5, y + t, w + 3, 3, grey(0.53));
  }
}

/** Micrometeorite pitting — tiny craters with a raised rim. */
function pitting(H, S, count, rng) {
  for (let i = 0; i < count; i++) {
    const cx = rng.range(0, S);
    const cy = rng.range(0, S);
    const r = rng.range(0.9, 3.2) * (rng.chance(0.08) ? 2.6 : 1);
    circleWrap(H, S, cx, cy, r * 1.5, grey(0.516));
    circleWrap(H, S, cx, cy, r, grey(0.5 - rng.range(0.05, 0.13)));
  }
}

/* --------------------------------------------------------------- paint layer */

/* Stencils live on their own canvas so paint never disturbs the height field.
   rgb = paint colour, a = coverage. The team-trim mask is tracked separately
   because it must survive into orm.a. */

const STENCIL_INK = 'rgba(214,216,219,1)';
const STENCIL_DARK = 'rgba(28,30,33,1)';

function pickFont(px, weight) {
  return `${weight} ${Math.round(px)}px "Consolas","DejaVu Sans Mono","Liberation Mono",ui-monospace,monospace`;
}

function stencilText(P, S, x, y, px, text, rng, opts) {
  const o = opts || {};
  P.save();
  P.font = pickFont(px, o.weight || 700);
  P.textBaseline = 'middle';
  P.textAlign = o.align || 'left';
  P.fillStyle = o.colour || STENCIL_INK;
  P.globalAlpha = o.alpha === undefined ? rng.range(0.5, 0.78) : o.alpha;
  const w = P.measureText(text).width;
  wrapDraw(S, x - 4, y - px, w + 8, px * 2, (bx, by) => {
    P.fillText(text, bx + 4, by + px);
  });
  P.restore();
}

/** Warning chevrons — a short run of >>> arrows. */
function chevrons(P, S, x, y, w, h, rng, colour) {
  const n = Math.max(2, Math.floor(w / (h * 0.72)));
  const step = w / n;
  P.save();
  P.globalAlpha = rng.range(0.42, 0.66);
  P.strokeStyle = colour || STENCIL_INK;
  P.lineWidth = Math.max(1.5, h * 0.17);
  P.lineJoin = 'miter';
  wrapDraw(S, x, y, w, h, (bx, by) => {
    for (let i = 0; i < n; i++) {
      const sx = bx + i * step;
      P.beginPath();
      P.moveTo(sx, by);
      P.lineTo(sx + step * 0.62, by + h * 0.5);
      P.lineTo(sx, by + h);
      P.stroke();
    }
  });
  P.restore();
}

/** Hazard stripes inside a bounded strip. */
function hazardStripes(P, S, x, y, w, h, rng, colour) {
  const pitch = h * rng.range(0.75, 1.15);
  P.save();
  P.globalAlpha = rng.range(0.34, 0.5);
  P.fillStyle = colour || STENCIL_INK;
  wrapDraw(S, x, y, w, h, (bx, by) => {
    P.save();
    P.beginPath();
    P.rect(bx, by, w, h);
    P.clip();
    for (let sx = -h; sx < w + h; sx += pitch * 2) {
      P.beginPath();
      P.moveTo(bx + sx, by + h);
      P.lineTo(bx + sx + h, by);
      P.lineTo(bx + sx + h + pitch, by);
      P.lineTo(bx + sx + pitch, by + h);
      P.closePath();
      P.fill();
    }
    P.restore();
  });
  P.restore();
}

/* ------------------------------------------------------------ family recipes */

/* Hull greys are authored in sRGB and kept deliberately dark: a warship in
   vacuum under one hard star reads at roughly 0.35–0.5 on the lit side, and
   anything lighter turns into a white blob the moment ACES gets hold of it.
   `bare` is the F0 of the underlying alloy, so it sits higher than the paint. */
const HULL_PALETTES = {
  lancer: {
    base: [0.452, 0.462, 0.476], // pale bone-steel, small craft
    bare: [0.520, 0.528, 0.540],
    tint: 0.17,
    bareChance: 0.20,
    rough: 0.38,
    plates: { rows: 7, cols: 7, rowJitter: 0.34, colJitter: 0.42, splitChance: 0.42, maxDepth: 2, minPlate: 22 },
    grooveW: [1.6, 2.6],
    rivetChance: 0.42,
    weldChance: 0.12,
    hatches: 5,
    vents: 3,
    greebles: 26,
    pipes: 2,
    pits: 130,
    wearAmount: 0.80,
  },
  bulwark: {
    base: [0.352, 0.360, 0.374], // slate armour, line warships
    bare: [0.500, 0.506, 0.514],
    tint: 0.21,
    bareChance: 0.34,
    rough: 0.44,
    plates: { rows: 5, cols: 5, rowJitter: 0.30, colJitter: 0.38, splitChance: 0.55, maxDepth: 2, minPlate: 30 },
    grooveW: [2.2, 3.6],
    rivetChance: 0.58,
    weldChance: 0.36,
    hatches: 7,
    vents: 4,
    greebles: 34,
    pipes: 3,
    pits: 200,
    wearAmount: 1.0,
  },
  monolith: {
    base: [0.408, 0.400, 0.384], // warm stone-grey, fleet-scale architecture
    bare: [0.486, 0.488, 0.496],
    tint: 0.19,
    bareChance: 0.28,
    rough: 0.41,
    plates: { rows: 4, cols: 6, rowJitter: 0.26, colJitter: 0.46, splitChance: 0.62, maxDepth: 3, minPlate: 26 },
    grooveW: [2.6, 4.2],
    rivetChance: 0.30,
    weldChance: 0.22,
    hatches: 9,
    vents: 7,
    greebles: 44,
    pipes: 5,
    pits: 240,
    wearAmount: 0.72,
  },
};

export const FAMILY_KEYS = ['lancer', 'bulwark', 'monolith'];

/* Macro variants: sparse stamps at 4x the plate wavelength so hull numbers and
   window rows do not repeat every few metres.
     0 light greeble   1 armour/warning   2 industrial   3 architectural       */
const MACRO_RECIPES = [
  { hatches: 3, vents: 2, greebles: 9, panels: 3, stencils: 3, chevrons: 1, hazard: 0, windows: 0, strips: 2, trim: 2, plateBands: 1 },
  { hatches: 4, vents: 2, greebles: 12, panels: 4, stencils: 4, chevrons: 2, hazard: 2, windows: 0, strips: 2, trim: 3, plateBands: 2 },
  { hatches: 5, vents: 6, greebles: 16, panels: 5, stencils: 3, chevrons: 1, hazard: 1, windows: 1, strips: 1, trim: 2, plateBands: 2 },
  { hatches: 6, vents: 4, greebles: 14, panels: 6, stencils: 4, chevrons: 1, hazard: 1, windows: 4, strips: 4, trim: 4, plateBands: 3 },
];

/** Which macro variants each family is allowed to draw from (4 slots, weighted). */
export const FAMILY_MACRO_SLOTS = {
  lancer: [0, 0, 1, 0],
  bulwark: [1, 2, 1, 0],
  monolith: [3, 2, 3, 1],
};

const HULL_CODES = ['SV', 'KV', 'TR', 'DX', 'HN', 'AR', 'VK'];

/* ------------------------------------------------------- surface generation */

/** Rasterise the structural pass for a full-coverage plate family. */
function drawPlateSurface(S, rng, pal) {
  const hc = makeCanvas(S, S);
  const mc = makeCanvas(S, S);
  const pc = makeCanvas(S, S);
  const ec = makeCanvas(S, S);
  const H = ctx2d(hc);
  const M = ctx2d(mc);
  const P = ctx2d(pc);
  const E = ctx2d(ec);

  H.fillStyle = grey(0.5);
  H.fillRect(0, 0, S, S);
  M.fillStyle = 'rgba(128,255,0,1)'; // tint 0, painted, not machined
  M.fillRect(0, 0, S, S);
  E.fillStyle = '#000';
  E.fillRect(0, 0, S, S);
  P.clearRect(0, 0, S, S);

  const plates = buildPlates(S, rng, pal.plates);

  /* 1. Plate faces. A hair of height variance so neighbours separate, and a
     third of the plates left as raw alloy — mixed painted/bare plating is what
     makes a hull read as fabricated rather than moulded. */
  for (const p of plates) {
    const dh = p.tint * 0.014;
    p.bare = rng.chance(pal.bareChance);
    fillRectWrap(H, S, p.x, p.y, p.w, p.h, grey(0.5 + dh));
    const swap = rng.chance(0.14) ? rng.gaussian(0, 0.9) : 0; // replacement panel
    const t = Math.round(clamp01(0.5 + (p.tint + swap) * 0.3) * 255);
    fillRectWrap(M, S, p.x, p.y, p.w, p.h, `rgba(${t},${p.bare ? 0 : 255},0,1)`);
  }

  // 2. armour belts / long raised bands break the plate rhythm at a bigger scale
  const bands = rng.int(1, 3);
  for (let i = 0; i < bands; i++) {
    const bh = rng.range(S * 0.03, S * 0.075);
    const by = rng.range(0, S);
    fillRectWrap(H, S, 0, by, S, bh, grey(0.5 + rng.range(0.012, 0.03)));
    fillRectWrap(H, S, 0, by, S, 1.5, grey(0.545));
    fillRectWrap(H, S, 0, by + bh - 1.5, S, 1.5, grey(0.462));
  }

  // 3. grooves. Depth is drawn from three tiers so the field never reads as a
  //    uniform grid — the single biggest tell of a procedural panel texture.
  const depths = [0.105, 0.19, 0.31];
  for (const p of plates) {
    const tier = rng.weighted([0, 1, 2], [3, 4, 2]);
    const gw = rng.range(pal.grooveW[0], pal.grooveW[1]) * (p.depth > 0 ? 0.62 : 1);
    const d = depths[tier] * (p.depth > 0 ? 0.6 : 1);
    groove(H, S, p.x, p.y, p.x + p.w, p.y, gw, d);
    groove(H, S, p.x, p.y, p.x, p.y + p.h, gw, d);

    if (tier === 2 && rng.chance(pal.rivetChance)) {
      const r = rng.range(1.15, 1.9);
      rivetRow(H, M, S, p.x + 4, p.y - gw - r - 1.4, p.x + p.w - 4, p.y - gw - r - 1.4,
        rng.range(9, 15), r, rng);
    }
    if (tier === 2 && rng.chance(pal.weldChance)) {
      weldBead(H, M, S, p.x, p.y + p.h * 0.5, p.x + p.w, p.y + p.h * 0.5, rng.range(2.2, 3.6), rng);
    }
  }

  // 4. inset features, biased into the larger plates
  const big = plates.filter((p) => p.w > 44 && p.h > 34);
  const pool = big.length ? big : plates;
  const place = (n, fn) => {
    for (let i = 0; i < n; i++) {
      const p = rng.pick(pool);
      fn(p);
    }
  };

  place(pal.hatches, (p) => {
    const w = Math.min(p.w - 14, rng.range(20, 58));
    const h = Math.min(p.h - 12, rng.range(16, 46));
    if (w < 10 || h < 9) return;
    hatch(H, M, S, p.x + rng.range(6, p.w - w - 6), p.y + rng.range(5, p.h - h - 5), w, h, rng);
  });

  place(pal.vents, (p) => {
    const w = Math.min(p.w - 16, rng.range(18, 52));
    const h = Math.min(p.h - 14, rng.range(12, 34));
    if (w < 10 || h < 8) return;
    vent(H, M, E, S, p.x + rng.range(7, p.w - w - 7), p.y + rng.range(6, p.h - h - 6), w, h, rng,
      rng.chance(0.3));
  });

  place(pal.greebles, (p) => {
    const w = Math.min(p.w - 8, rng.range(4, 22));
    const h = Math.min(p.h - 8, rng.range(4, 18));
    if (w < 3 || h < 3) return;
    greeble(H, M, S, p.x + rng.range(4, p.w - w - 4), p.y + rng.range(4, p.h - h - 4), w, h, rng);
  });

  for (let i = 0; i < pal.pipes; i++) {
    const horiz = rng.chance(0.72);
    const len = rng.range(S * 0.2, S * 0.55);
    const r = rng.range(2, 4.5);
    pipeRun(H, M, S, rng.range(0, S), rng.range(0, S), len, r, horiz, rng);
  }

  pitting(H, S, pal.pits, rng);

  // 5. small painted marks — subtle, warship not livery
  const marks = rng.int(3, 6);
  for (let i = 0; i < marks; i++) {
    const px = rng.range(0, S);
    const py = rng.range(0, S);
    const size = rng.range(8, 15);
    const txt = rng.chance(0.5)
      ? `${rng.int(1, 9)}${rng.int(0, 9)}`
      : `${rng.pick(['A', 'B', 'C', 'D', 'E', 'F'])}-${rng.int(1, 9)}`;
    stencilText(P, S, px, py, size, txt, rng, { alpha: rng.range(0.22, 0.42) });
  }

  return { hc, mc, pc, ec };
}

/** Rasterise one sparse macro variant. Everything is stamped over transparent
    coverage so the plate layer beneath shows through. */
function drawMacroSurface(S, rng, recipe) {
  const hc = makeCanvas(S, S);
  const mc = makeCanvas(S, S);
  const pc = makeCanvas(S, S);
  const cc = makeCanvas(S, S); // coverage
  const tc = makeCanvas(S, S); // team trim mask
  const ec = makeCanvas(S, S); // emissive colour
  const lc = makeCanvas(S, S); // 1 where the emitter is a team running light
  const H = ctx2d(hc);
  const M = ctx2d(mc);
  const P = ctx2d(pc);
  const C = ctx2d(cc);
  const T = ctx2d(tc);
  const E = ctx2d(ec);
  const L = ctx2d(lc);

  H.fillStyle = grey(0.5);
  H.fillRect(0, 0, S, S);
  M.fillStyle = 'rgba(128,255,0,1)';
  M.fillRect(0, 0, S, S);
  for (const c of [C, T, E, L]) {
    c.fillStyle = '#000';
    c.fillRect(0, 0, S, S);
  }
  P.clearRect(0, 0, S, S);

  const cov = (x, y, w, h, soft) => {
    if (soft) {
      wrapDraw(S, x - soft, y - soft, w + soft * 2, h + soft * 2, (px, py) => {
        const g = C.createLinearGradient(0, py, 0, py + h + soft * 2);
        g.addColorStop(0, '#000');
        g.addColorStop(soft / (h + soft * 2), '#fff');
        g.addColorStop(1 - soft / (h + soft * 2), '#fff');
        g.addColorStop(1, '#000');
        C.fillStyle = g;
        C.fillRect(px, py, w + soft * 2, h + soft * 2);
      });
    } else {
      fillRectWrap(C, S, x, y, w, h, '#fff');
    }
  };

  // large sub-panels: a second, coarser plate scale layered over the fine one
  for (let i = 0; i < recipe.panels; i++) {
    const w = rng.range(S * 0.10, S * 0.30);
    const h = rng.range(S * 0.07, S * 0.21);
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const dh = rng.range(0.014, 0.042) * (rng.chance(0.6) ? 1 : -1);
    fillRectWrap(H, S, x, y, w, h, grey(0.5 + dh));
    groove(H, S, x, y, x + w, y, 3.2, 0.2);
    groove(H, S, x, y, x, y + h, 3.2, 0.2);
    groove(H, S, x, y + h, x + w, y + h, 3.2, 0.2);
    groove(H, S, x + w, y, x + w, y + h, 3.2, 0.2);
    cov(x - 2, y - 2, w + 4, h + 4);
    if (rng.chance(0.55)) {
      rivetRow(H, M, S, x + 6, y + 5, x + w - 6, y + 5, rng.range(11, 19), rng.range(1.4, 2.2), rng);
    }
  }

  for (let i = 0; i < recipe.plateBands; i++) {
    const bh = rng.range(S * 0.02, S * 0.05);
    const by = rng.range(0, S);
    fillRectWrap(H, S, 0, by, S, bh, grey(0.5 + rng.range(0.02, 0.04)));
    groove(H, S, 0, by, S, by, 3, 0.22);
    groove(H, S, 0, by + bh, S, by + bh, 3, 0.22);
    cov(0, by - 2, S, bh + 4);
    if (rng.chance(0.5)) weldBead(H, M, S, 0, by + bh, S, by + bh, 2.8, rng);
  }

  for (let i = 0; i < recipe.hatches; i++) {
    const w = rng.range(S * 0.028, S * 0.105);
    const h = rng.range(S * 0.022, S * 0.078);
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    hatch(H, M, S, x, y, w, h, rng);
    cov(x - 3, y - 3, w + 6, h + 6);
    if (rng.chance(0.6)) {
      stencilText(P, S, x, y - 6, Math.max(5, h * 0.3), `${rng.pick(HULL_CODES)}${rng.int(10, 99)}`,
        rng, { alpha: rng.range(0.26, 0.44) });
    }
  }

  for (let i = 0; i < recipe.vents; i++) {
    const w = rng.range(S * 0.032, S * 0.13);
    const h = rng.range(S * 0.018, S * 0.06);
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    vent(H, M, E, S, x, y, w, h, rng, rng.chance(0.4));
    cov(x - 3, y - 3, w + 6, h + 6);
  }

  for (let i = 0; i < recipe.greebles; i++) {
    const w = rng.range(S * 0.007, S * 0.032);
    const h = rng.range(S * 0.007, S * 0.028);
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    greeble(H, M, S, x, y, w, h, rng);
    cov(x - 2, y - 2, w + 4, h + 4);
  }

  // window rows — the strongest scale cue a capital ship has
  for (let i = 0; i < recipe.windows; i++) {
    const rows = rng.int(1, 3);
    const wpx = rng.range(S * 0.0055, S * 0.011);
    const hpx = wpx * rng.range(0.5, 0.85);
    const gap = wpx * rng.range(0.9, 1.7);
    const n = rng.int(6, 20);
    const x0 = rng.range(0, S);
    const y0 = rng.range(0, S);
    const recessH = rows * (hpx + gap) + gap;
    fillRectWrap(H, S, x0 - gap, y0 - gap, n * (wpx + gap) + gap, recessH, grey(0.478));
    groove(H, S, x0 - gap, y0 - gap, x0 - gap + n * (wpx + gap) + gap, y0 - gap, 2, 0.14);
    cov(x0 - gap - 2, y0 - gap - 2, n * (wpx + gap) + gap + 4, recessH + 4);
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < n; k++) {
        if (rng.chance(0.12)) continue; // dark cabins
        const wx = x0 + k * (wpx + gap);
        const wy = y0 + r * (hpx + gap);
        fillRectWrap(H, S, wx, wy, wpx, hpx, grey(0.44));
        fillRectWrap(M, S, wx, wy, wpx, hpx, 'rgba(128,40,250,1)');
        const g = Math.round(rng.range(120, 255));
        fillRectWrap(E, S, wx, wy, wpx, hpx,
          `rgb(${g},${Math.round(g * 0.82)},${Math.round(g * 0.58)})`);
      }
    }
  }

  // running-light strips: recessed channel + team-coloured emitter
  for (let i = 0; i < recipe.strips; i++) {
    const horiz = rng.chance(0.75);
    const len = rng.range(S * 0.18, S * 0.6);
    const thick = rng.range(2.5, 5);
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const w = horiz ? len : thick;
    const h = horiz ? thick : len;
    fillRectWrap(H, S, x - 2, y - 2, w + 4, h + 4, grey(0.522));
    fillRectWrap(H, S, x, y, w, h, grey(0.452));
    fillRectWrap(M, S, x, y, w, h, 'rgba(128,30,250,1)');
    cov(x - 3, y - 3, w + 6, h + 6);
    // dashes, not a continuous tube
    const dash = thick * rng.range(2.4, 5);
    const n = Math.floor(len / (dash * 1.6));
    for (let k = 0; k < n; k++) {
      const t = k * dash * 1.6;
      const dx = horiz ? x + t : x;
      const dy = horiz ? y : y + t;
      const dw = horiz ? dash : w;
      const dh = horiz ? h : dash;
      fillRectWrap(E, S, dx, dy, dw, dh, '#fff');
      fillRectWrap(L, S, dx, dy, dw, dh, '#fff'); // flag: tint by team light
    }
  }

  // team trim: bands and stripes that carry faction colour
  for (let i = 0; i < recipe.trim; i++) {
    const primary = rng.chance(0.45);
    const horiz = rng.chance(0.8);
    const len = rng.range(S * 0.25, S * 0.9);
    const thick = primary ? rng.range(S * 0.005, S * 0.012) : rng.range(S * 0.013, S * 0.030);
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const w = horiz ? len : thick;
    const h = horiz ? thick : len;
    fillRectWrap(T, S, x, y, w, h, primary ? '#fff' : 'rgb(128,128,128)');
    // trim paint is glossier and slightly proud
    fillRectWrap(M, S, x, y, w, h, 'rgba(128,255,0,1)');
    cov(x - 1, y - 1, w + 2, h + 2);
    if (primary && rng.chance(0.5)) {
      fillRectWrap(H, S, x, y, w, h, grey(0.508));
    }
  }

  for (let i = 0; i < recipe.chevrons; i++) {
    const w = rng.range(S * 0.05, S * 0.13);
    const h = rng.range(S * 0.011, S * 0.026);
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    chevrons(P, S, x, y, w, h, rng);
    cov(x - 2, y - 2, w + 4, h + 4);
  }

  for (let i = 0; i < recipe.hazard; i++) {
    const w = rng.range(S * 0.06, S * 0.17);
    const h = rng.range(S * 0.008, S * 0.019);
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    hazardStripes(P, S, x, y, w, h, rng);
    cov(x - 1, y - 1, w + 2, h + 2);
  }

  for (let i = 0; i < recipe.stencils; i++) {
    const size = rng.range(S * 0.012, S * 0.032);
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const kind = rng.next();
    let txt;
    if (kind < 0.34) txt = `${rng.pick(HULL_CODES)}-${rng.int(100, 999)}`;
    else if (kind < 0.6) txt = `${rng.int(1, 9)}${rng.int(0, 9)}`;
    else if (kind < 0.8) txt = rng.pick(['NO STEP', 'RESCUE', 'DANGER', 'INTAKE', 'GROUND HERE']);
    else txt = rng.pick(['A', 'B', 'C', 'D', 'E']) + rng.int(1, 9);
    stencilText(P, S, x, y, size, txt, rng, { alpha: rng.range(0.3, 0.62) });
    cov(x - 4, y - size, size * txt.length * 0.75 + 8, size * 1.6);
    if (rng.chance(0.3)) {
      stencilText(P, S, x, y + size * 0.95, size * 0.42, `${rng.int(1000, 9999)} KG`, rng,
        { alpha: 0.32, colour: STENCIL_DARK });
    }
  }

  pitting(H, S, Math.round(S * 0.06), rng);

  return { hc, mc, pc, cc, tc, ec, lc };
}

/* -------------------------------------------------------------- map assembly */

/** Fold a rasterised surface into albedo / normal / orm / emissive bytes. */
function deriveMaps(S, rng, opts) {
  const {
    hc, mc, pc, cc, tc, ec, lc, palette, macro, quality,
  } = opts;

  const hData = ctx2d(hc).getImageData(0, 0, S, S).data;
  const mData = ctx2d(mc).getImageData(0, 0, S, S).data;
  const pData = ctx2d(pc).getImageData(0, 0, S, S).data;
  const cData = cc ? ctx2d(cc).getImageData(0, 0, S, S).data : null;
  const tData = tc ? ctx2d(tc).getImageData(0, 0, S, S).data : null;
  const eData = ec ? ctx2d(ec).getImageData(0, 0, S, S).data : null;
  const lData = lc ? ctx2d(lc).getImageData(0, 0, S, S).data : null;

  const N = S * S;
  const raw = new Float32Array(N);
  const height = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    raw[i] = hData[i * 4] / 255;
    height[i] = raw[i];
  }

  // Two grades of machining grain over the rasterised structure: a coarse
  // roll in the plate itself and a fine tooling pattern near the texel limit.
  const g1 = 96 / S;
  const g2 = 384 / S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      height[i] += vnoise(x * g1, y * g1, 96) * 0.0070
        + vnoise(x * g2, y * g2, 384) * 0.0034;
    }
  }

  /* Low-res wear fields — the ones that genuinely want fbm/worley. Coordinates
     are normalised to [0,1) and cross-faded on a period of exactly 1, which is
     the only way these stay seamless when the region tiles. */
  const MS = Math.max(32, S >> 3);
  const wearS = new Float32Array(MS * MS);
  const streakS = new Float32Array(MS * MS);
  const grimeS = new Float32Array(MS * MS);
  const sootS = new Float32Array(MS * MS);
  const wo = rng.range(0, 400);
  const so = rng.range(0, 400);
  const go = rng.range(0, 400);
  for (let y = 0; y < MS; y++) {
    const v = y / MS;
    for (let x = 0; x < MS; x++) {
      const i = y * MS + x;
      const u = x / MS;
      const cell = tileable2((a, b) => worley3(a * 9 + wo, b * 9 + wo, 3.7, 1), u, v, 1);
      const broad = tileable2((a, b) => fbm2(a * 5 + wo, b * 5 + wo, 4), u, v, 1);
      wearS[i] = clamp01(sstep(0.25, 0.85, 1 - cell) * 0.85 + broad * 0.55 + 0.18);
      // streaks run along U, which the shader maps to the hull's long axis
      streakS[i] = clamp01(
        tileable2((a, b) => fbm2(a * 2.2 + so, b * 26 + so, 5), u, v, 1) * 1.1 + 0.35,
      );
      grimeS[i] = clamp01(tileable2((a, b) => fbm2(a * 11 + go, b * 11 + go, 3), u, v, 1) + 0.5);
      sootS[i] = clamp01(tileable2((a, b) => fbm2(a * 4 + go * 2, b * 4 + go * 2, 3), u, v, 1) * 0.9 + 0.42);
    }
  }
  const wear = upsampleWrap(wearS, MS, S);
  const streak = upsampleWrap(streakS, MS, S);
  const grime = upsampleWrap(grimeS, MS, S);
  const soot = upsampleWrap(sootS, MS, S);

  // Cavity = sharp height minus a wide blur. Drives AO and edge paint loss.
  // `near` is a 3x3 smooth only — anything wider and the panel lines go soft.
  const wide = boxBlurWrap(height, S, Math.max(4, Math.round(S / 64)));
  const near = boxBlurWrap(height, S, 1);

  const albedo = new Uint8Array(N * 4);
  const normal = new Uint8Array(N * 4);
  const orm = new Uint8Array(N * 4);
  const emis = new Uint8Array(N * 4);

  const base = palette ? palette.base : [0.5, 0.5, 0.5];
  const bare = palette ? palette.bare : [0.53, 0.535, 0.545];
  const tintAmt = palette ? palette.tint : 0.05;
  const roughBase = palette ? palette.rough : 0.44;
  const wearAmt = palette ? palette.wearAmount : 0.7;

  const nStrength = 2.35 * (S / 1024);
  let avgR = 0;
  let avgG = 0;
  let avgB = 0;
  let avgRough = 0;
  let avgMetal = 0;

  for (let y = 0; y < S; y++) {
    const ym = ((y - 1) + S) % S;
    const yp = (y + 1) % S;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const o = i * 4;
      const xm = ((x - 1) + S) % S;
      const xp = (x + 1) % S;

      /* ---- normal (Sobel on the lightly smoothed height) */
      const h00 = near[ym * S + xm];
      const h10 = near[ym * S + x];
      const h20 = near[ym * S + xp];
      const h01 = near[y * S + xm];
      const h21 = near[y * S + xp];
      const h02 = near[yp * S + xm];
      const h12 = near[yp * S + x];
      const h22 = near[yp * S + xp];
      const gx = (h20 + 2 * h21 + h22) - (h00 + 2 * h01 + h02);
      const gy = (h02 + 2 * h12 + h22) - (h00 + 2 * h10 + h20);
      const nx = -gx * nStrength;
      const ny = -gy * nStrength;
      const nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      normal[o] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      normal[o + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      normal[o + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      normal[o + 3] = 255;

      /* ---- control channels */
      const plateTint = mData[o] / 255 - 0.5;
      const painted = mData[o + 1] / 255;
      const machined = mData[o + 2] / 255;

      const cav = height[i] - wide[i];
      const convex = clamp01(cav * 26);
      const concave = clamp01(-cav * 26);

      /* ---- paint wear: corners and proud edges lose paint first */
      const bareM = clamp01(
        (1 - painted)
        + wear[i] * wearAmt * (0.10 + 2.3 * convex)
        + machined * 0.9,
      );

      /* ---- albedo */
      let r = base[0] * (1 + plateTint * tintAmt * 2);
      let g = base[1] * (1 + plateTint * tintAmt * 2);
      let b = base[2] * (1 + plateTint * tintAmt * 1.6);
      r = mix(r, bare[0] * (1 + plateTint * 0.09), bareM);
      g = mix(g, bare[1] * (1 + plateTint * 0.09), bareM);
      b = mix(b, bare[2] * (1 + plateTint * 0.07), bareM);

      // dirt in the recesses, stains trailing along the hull axis
      const dirt = clamp01(concave * 0.95 + grime[i] * 0.22 + streak[i] * 0.30);
      const dm = mix(1, 0.60, dirt);
      r *= dm;
      g *= dm * 0.994;
      b *= dm * 0.982;

      // Soot is a whisper here — real scorch is a decal or comes from uDamage.
      const scorch = clamp01(sstep(0.90, 1.0, soot[i]) * (macro ? 0.22 : 0.34));
      r = mix(r, 0.062, scorch);
      g = mix(g, 0.058, scorch);
      b = mix(b, 0.057, scorch);

      // painted stencils sit on top of everything but the wear
      const pa = (pData[o + 3] / 255) * (1 - bareM * 0.55);
      if (pa > 0.002) {
        r = mix(r, pData[o] / 255, pa);
        g = mix(g, pData[o + 1] / 255, pa);
        b = mix(b, pData[o + 2] / 255, pa);
      }

      // fine grain reads through the paint as a faint tonal roll
      const gr = 1 + (height[i] - raw[i]) * 1.6 + (raw[i] - near[i]) * 0.45;
      r *= gr;
      g *= gr;
      b *= gr;

      albedo[o] = Math.round(clamp01(r) * 255);
      albedo[o + 1] = Math.round(clamp01(g) * 255);
      albedo[o + 2] = Math.round(clamp01(b) * 255);
      albedo[o + 3] = macro
        ? (cData ? cData[o] : 255)
        : Math.round((1 - bareM) * 255);

      /* ---- orm */
      // Open surface stays at 1; only recesses and inside corners darken.
      const ao = clamp01(1 + Math.min(0, cav) * 4.6 - concave * 0.22);
      let rough = roughBase
        + plateTint * 0.05
        + bareM * 0.20
        + dirt * 0.10
        + scorch * 0.40
        - machined * 0.13;
      rough = clamp01(rough + (grime[i] - 0.5) * 0.06);
      const metal = clamp01(0.045 + bareM * 0.9 + machined * 0.5 - scorch * 0.35);

      orm[o] = Math.round(clamp01(ao) * 255);
      orm[o + 1] = Math.round(rough * 255);
      orm[o + 2] = Math.round(metal * 255);
      orm[o + 3] = tData ? tData[o] : 255;

      /* ---- emissive. a = 1 flags a team running light, 0 a warm interior. */
      if (eData) {
        const dim = 1 - scorch * 0.85;
        emis[o] = Math.round(eData[o] * dim);
        emis[o + 1] = Math.round(eData[o + 1] * dim);
        emis[o + 2] = Math.round(eData[o + 2] * dim);
        emis[o + 3] = lData ? lData[o] : 0;
      } else {
        emis[o] = 0;
        emis[o + 1] = 0;
        emis[o + 2] = 0;
        emis[o + 3] = 0;
      }

      avgR += albedo[o];
      avgG += albedo[o + 1];
      avgB += albedo[o + 2];
      avgRough += rough;
      avgMetal += metal;
    }
  }

  return {
    albedo,
    normal,
    orm,
    emis,
    average: {
      colour: [avgR / N / 255, avgG / N / 255, avgB / N / 255],
      rough: avgRough / N,
      metal: avgMetal / N,
    },
  };
}

/* ------------------------------------------------------------ atlas assembly */

function blit(dst, dstS, src, srcS, ox, oy) {
  for (let y = 0; y < srcS; y++) {
    const so = y * srcS * 4;
    const doff = ((oy + y) * dstS + ox) * 4;
    dst.set(src.subarray(so, so + srcS * 4), doff);
  }
}

function dataTexture(bytes, size, colorSpace, aniso) {
  const t = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = colorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------- noise library */

/** Void-and-cluster blue noise. Toroidal, so it tiles and dithers cleanly. */
function blueNoise(size, rng) {
  const N = size * size;
  const binary = new Uint8Array(N);
  const energy = new Float32Array(N);
  const sigma = 1.9;
  const R = 5;
  const kernel = [];
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      kernel.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))]);
    }
  }
  const splat = (idx, s) => {
    const x = idx % size;
    const y = (idx / size) | 0;
    for (let k = 0; k < kernel.length; k++) {
      const kx = (x + kernel[k][0] + size) % size;
      const ky = (y + kernel[k][1] + size) % size;
      energy[ky * size + kx] += kernel[k][2] * s;
    }
  };

  let ones = 0;
  const target = Math.max(8, Math.round(N * 0.1));
  while (ones < target) {
    const i = rng.int(0, N - 1);
    if (binary[i]) continue;
    binary[i] = 1;
    splat(i, 1);
    ones++;
  }

  const tightestCluster = () => {
    let best = -1;
    let bv = -Infinity;
    for (let i = 0; i < N; i++) if (binary[i] && energy[i] > bv) { bv = energy[i]; best = i; }
    return best;
  };
  const largestVoid = () => {
    let best = -1;
    let bv = Infinity;
    for (let i = 0; i < N; i++) if (!binary[i] && energy[i] < bv) { bv = energy[i]; best = i; }
    return best;
  };

  for (let guard = 0; guard < N; guard++) {
    const c = tightestCluster();
    binary[c] = 0;
    splat(c, -1);
    const v = largestVoid();
    if (v === c) { binary[c] = 1; splat(c, 1); break; }
    binary[v] = 1;
    splat(v, 1);
  }

  const rank = new Int32Array(N).fill(-1);
  const proto = binary.slice();

  // phase 1 — remove ones from the prototype, ranking downwards
  const work = proto.slice();
  energy.fill(0);
  for (let i = 0; i < N; i++) if (work[i]) splat(i, 1);
  let count = ones;
  for (let r = count - 1; r >= 0; r--) {
    let best = -1;
    let bv = -Infinity;
    for (let i = 0; i < N; i++) if (work[i] && energy[i] > bv) { bv = energy[i]; best = i; }
    work[best] = 0;
    splat(best, -1);
    rank[best] = r;
  }

  // phase 2 + 3 — fill the zeros upward
  work.set(proto);
  energy.fill(0);
  for (let i = 0; i < N; i++) if (work[i]) splat(i, 1);
  for (let r = count; r < N; r++) {
    let best = -1;
    let bv = Infinity;
    for (let i = 0; i < N; i++) if (!work[i] && energy[i] < bv) { bv = energy[i]; best = i; }
    work[best] = 1;
    splat(best, 1);
    rank[best] = r;
  }

  const bytes = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const v = Math.round((rank[i] / (N - 1)) * 255);
    bytes[i * 4] = v;
    bytes[i * 4 + 1] = v;
    bytes[i * 4 + 2] = v;
    bytes[i * 4 + 3] = 255;
  }
  return bytes;
}

function valueNoiseBytes(size, rng) {
  const bytes = new Uint8Array(size * size * 4);
  const o = rng.range(0, 500);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = (x / size);
      const v = (y / size);
      bytes[i] = Math.round(clamp01(vnoise(u * 8, v * 8, 8) * 0.5 + 0.5) * 255);
      bytes[i + 1] = Math.round(clamp01(vnoise(u * 16 + o, v * 16 + o, 16) * 0.5 + 0.5) * 255);
      bytes[i + 2] = Math.round(clamp01(vnoise(u * 32 - o, v * 32 - o, 32) * 0.5 + 0.5) * 255);
      bytes[i + 3] = Math.round(clamp01(vnoise(u * 4, v * 4, 4) * 0.5 + 0.5) * 255);
    }
  }
  return bytes;
}

function fbmBytes(size, rng) {
  const bytes = new Uint8Array(size * size * 4);
  const o = rng.range(0, 500);
  const oct = (u, v, base, n) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = base;
    for (let i = 0; i < n; i++) {
      sum += amp * vnoise(u * f, v * f, f);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = x / size;
      const v = y / size;
      bytes[i] = Math.round(clamp01(oct(u, v, 4, 6) * 0.5 + 0.5) * 255);
      bytes[i + 1] = Math.round(clamp01(oct(u + o, v + o, 8, 5) * 0.5 + 0.5) * 255);
      bytes[i + 2] = Math.round(clamp01(1 - Math.abs(oct(u - o, v - o, 6, 5)) * 1.8) * 255);
      bytes[i + 3] = Math.round(clamp01(oct(u, v, 2, 4) * 0.5 + 0.5) * 255);
    }
  }
  return bytes;
}

/** Divergence-free 2D flow in RG (curl of a scalar potential) plus a second,
    decorrelated flow component in B — enough for turbulent plume advection. */
function curlBytes(size, rng) {
  const bytes = new Uint8Array(size * size * 4);
  const o = rng.range(0, 500);
  const pot = (u, v, f, off) => {
    let s = 0;
    let a = 1;
    let n = 0;
    let ff = f;
    for (let i = 0; i < 4; i++) {
      s += a * vnoise(u * ff + off, v * ff + off, ff);
      n += a;
      a *= 0.5;
      ff *= 2;
    }
    return s / n;
  };
  const e = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = x / size;
      const v = y / size;
      const dpdy = (pot(u, v + e, 6, 0) - pot(u, v - e, 6, 0)) / (2 * e);
      const dpdx = (pot(u + e, v, 6, 0) - pot(u - e, v, 6, 0)) / (2 * e);
      const qdy = (pot(u, v + e, 11, o) - pot(u, v - e, 11, o)) / (2 * e);
      const k = 0.06;
      bytes[i] = Math.round(clamp01(dpdy * k * 0.5 + 0.5) * 255);
      bytes[i + 1] = Math.round(clamp01(-dpdx * k * 0.5 + 0.5) * 255);
      bytes[i + 2] = Math.round(clamp01(qdy * k * 0.5 + 0.5) * 255);
      bytes[i + 3] = Math.round(clamp01(pot(u, v, 4, o * 2) * 0.5 + 0.5) * 255);
    }
  }
  return bytes;
}

/* ----------------------------------------------------------- sprite textures */

function spriteFlare(size, rng) {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const h = size / 2;
  g.clearRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';

  // core: tight, hot, with a wide low-energy halo
  let rad = g.createRadialGradient(h, h, 0, h, h, h * 0.16);
  rad.addColorStop(0, 'rgba(255,255,255,1)');
  rad.addColorStop(0.42, 'rgba(226,240,255,0.72)');
  rad.addColorStop(1, 'rgba(150,190,255,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, size, size);

  rad = g.createRadialGradient(h, h, 0, h, h, h);
  rad.addColorStop(0, 'rgba(160,200,255,0.34)');
  rad.addColorStop(0.22, 'rgba(110,160,230,0.13)');
  rad.addColorStop(0.6, 'rgba(70,110,190,0.035)');
  rad.addColorStop(1, 'rgba(40,70,140,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, size, size);

  // anamorphic streak
  g.save();
  g.translate(h, h);
  const lin = g.createLinearGradient(-h, 0, h, 0);
  lin.addColorStop(0, 'rgba(90,150,255,0)');
  lin.addColorStop(0.28, 'rgba(130,180,255,0.16)');
  lin.addColorStop(0.5, 'rgba(235,245,255,0.85)');
  lin.addColorStop(0.72, 'rgba(130,180,255,0.16)');
  lin.addColorStop(1, 'rgba(90,150,255,0)');
  g.fillStyle = lin;
  for (let i = 0; i < 3; i++) {
    const t = 1 - i * 0.3;
    g.globalAlpha = 0.5 * t;
    g.fillRect(-h, -size * 0.011 / t, size, size * 0.022 / t);
  }
  g.globalAlpha = 1;

  // spikes
  const spikes = 6;
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI + rng.range(-0.05, 0.05);
    g.save();
    g.rotate(a);
    const len = h * rng.range(0.55, 0.95);
    const sl = g.createLinearGradient(-len, 0, len, 0);
    sl.addColorStop(0, 'rgba(120,170,255,0)');
    sl.addColorStop(0.5, 'rgba(210,230,255,0.42)');
    sl.addColorStop(1, 'rgba(120,170,255,0)');
    g.fillStyle = sl;
    g.fillRect(-len, -size * 0.0035, len * 2, size * 0.007);
    g.restore();
  }
  g.restore();
  return c;
}

function spriteSmoke(size, rng) {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const img = g.createImageData(size, size);
  const d = img.data;
  const off = rng.range(0, 300);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = (x / size - 0.5) * 2;
      const v = (y / size - 0.5) * 2;
      const r = Math.hypot(u, v);
      let n = 0;
      let a = 1;
      let f = 3;
      let nn = 0;
      for (let k = 0; k < 5; k++) {
        n += a * vnoise((x / size) * f + off, (y / size) * f + off, f);
        nn += a;
        a *= 0.55;
        f *= 2;
      }
      n = n / nn * 0.5 + 0.5;
      const falloff = clamp01(1 - sstep(0.15, 1.0, r));
      const alpha = clamp01(falloff * (n * 1.5 - 0.25)) * falloff;
      const lum = 0.62 + n * 0.3;
      d[i] = Math.round(lum * 190);
      d[i + 1] = Math.round(lum * 190);
      d[i + 2] = Math.round(lum * 196);
      d[i + 3] = Math.round(clamp01(alpha) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function spriteSpark(size) {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const h = size / 2;
  g.clearRect(0, 0, size, size);
  const lin = g.createLinearGradient(0, h, size, h);
  lin.addColorStop(0, 'rgba(255,120,40,0)');
  lin.addColorStop(0.35, 'rgba(255,168,80,0.55)');
  lin.addColorStop(0.72, 'rgba(255,236,200,1)');
  lin.addColorStop(0.88, 'rgba(255,255,255,1)');
  lin.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = lin;
  for (let i = 0; i < 4; i++) {
    const t = 1 - i * 0.24;
    g.globalAlpha = 0.45 * t;
    g.fillRect(0, h - (size * 0.05) / t, size, (size * 0.1) / t);
  }
  g.globalAlpha = 1;
  const rad = g.createRadialGradient(size * 0.86, h, 0, size * 0.86, h, size * 0.14);
  rad.addColorStop(0, 'rgba(255,255,255,1)');
  rad.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, size, size);
  return c;
}

function spriteRing(size, rng) {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const h = size / 2;
  const img = g.createImageData(size, size);
  const d = img.data;
  const off = rng.range(0, 300);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = (x - h) / h;
      const v = (y - h) / h;
      const r = Math.hypot(u, v);
      const ang = Math.atan2(v, u);
      const striate = 0.72 + 0.28 * (vnoise(Math.cos(ang) * 6 + off, Math.sin(ang) * 6 + off, 12) * 0.5 + 0.5);
      const shell = clamp01(1 - Math.abs(r - 0.82) / 0.2);
      const inner = clamp01(1 - sstep(0.0, 0.82, r)) * 0.10;
      const a = clamp01((shell * shell * shell * striate + inner) * (r < 1 ? 1 : 0));
      d[i] = Math.round(255 * clamp01(a * 1.3));
      d[i + 1] = Math.round(232 * clamp01(a * 1.1));
      d[i + 2] = Math.round(205 * clamp01(a * 0.9));
      d[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function spriteBeamCap(size) {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const h = size / 2;
  const rad = g.createRadialGradient(h, h, 0, h, h, h);
  rad.addColorStop(0, 'rgba(255,255,255,1)');
  rad.addColorStop(0.22, 'rgba(226,244,255,0.9)');
  rad.addColorStop(0.5, 'rgba(140,200,255,0.3)');
  rad.addColorStop(0.78, 'rgba(80,150,240,0.07)');
  rad.addColorStop(1, 'rgba(40,90,200,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Engine plume: v runs nozzle -> tail, u across the column. */
function spritePlume(w, h, rng) {
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  const img = g.createImageData(w, h);
  const d = img.data;
  const off = rng.range(0, 300);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1); // 0 at nozzle
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const u = (x / (w - 1) - 0.5) * 2;
      // the column necks down then flares
      const width = 0.34 + 0.62 * sstep(0, 0.35, t) - 0.30 * sstep(0.35, 1, t);
      const across = clamp01(1 - Math.abs(u) / Math.max(0.05, width));
      const turb = vnoise(u * 3 + off, t * 9 + off, 12) * 0.5 + 0.5;
      const life = (1 - sstep(0.5, 1.0, t));
      let a = across * across * life * (0.65 + 0.5 * turb);
      // shock diamonds near the throat
      a *= 1 + 0.35 * Math.max(0, Math.sin(t * 26)) * (1 - sstep(0.05, 0.4, t));
      a = clamp01(a);
      const hot = clamp01(across * (1 - sstep(0.0, 0.45, t)) * 1.25);
      d[i] = Math.round(clamp01(0.42 + hot * 0.58) * 255);
      d[i + 1] = Math.round(clamp01(0.60 + hot * 0.40) * 255);
      d[i + 2] = Math.round(clamp01(0.86 + hot * 0.14) * 255);
      d[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/* ------------------------------------------------------------ decal textures */

function decalScorch(size, rng) {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const img = g.createImageData(size, size);
  const d = img.data;
  const off = rng.range(0, 300);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = (x / size - 0.5) * 2;
      const v = (y / size - 0.5) * 2;
      let n = 0;
      let a = 1;
      let f = 3;
      let nn = 0;
      for (let k = 0; k < 5; k++) {
        n += a * vnoise((x / size) * f + off, (y / size) * f + off, f);
        nn += a;
        a *= 0.55;
        f *= 2;
      }
      n = n / nn;
      const r = Math.hypot(u, v * 0.72) + n * 0.34;
      const alpha = clamp01(1 - sstep(0.25, 0.95, r));
      const core = clamp01(1 - sstep(0.0, 0.5, r));
      d[i] = Math.round(mix(0.19, 0.06, core) * 255);
      d[i + 1] = Math.round(mix(0.15, 0.05, core) * 255);
      d[i + 2] = Math.round(mix(0.13, 0.05, core) * 255);
      d[i + 3] = Math.round(alpha * 235);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function decalImpact(size, rng) {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const h = size / 2;
  g.clearRect(0, 0, size, size);
  const rad = g.createRadialGradient(h, h, 0, h, h, h * 0.55);
  rad.addColorStop(0, 'rgba(14,12,11,0.95)');
  rad.addColorStop(0.55, 'rgba(38,32,28,0.6)');
  rad.addColorStop(1, 'rgba(52,46,40,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(20,17,15,0.6)';
  for (let i = 0; i < 14; i++) {
    const a = rng.range(0, TAU);
    const len = h * rng.range(0.3, 0.92);
    g.lineWidth = rng.range(0.6, 2.4);
    g.beginPath();
    g.moveTo(h, h);
    g.lineTo(h + Math.cos(a) * len, h + Math.sin(a) * len);
    g.stroke();
  }
  return c;
}

function decalHullNumber(size, rng) {
  const c = makeCanvas(size, size / 2);
  const g = ctx2d(c);
  g.clearRect(0, 0, size, size / 2);
  g.font = pickFont(size * 0.3, 700);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(220,222,226,0.82)';
  g.fillText(`${rng.pick(HULL_CODES)}-${rng.int(100, 999)}`, size / 2, size / 4);
  return c;
}

function decalChevron(size, rng) {
  const c = makeCanvas(size, size / 2);
  const g = ctx2d(c);
  g.clearRect(0, 0, size, size / 2);
  chevrons(g, size, size * 0.08, size * 0.08, size * 0.84, size * 0.34, rng, 'rgba(226,206,150,1)');
  return c;
}

function decalHazard(size, rng) {
  const c = makeCanvas(size, size / 4);
  const g = ctx2d(c);
  g.clearRect(0, 0, size, size / 4);
  hazardStripes(g, size, 0, 0, size, size / 4, rng, 'rgba(226,196,120,1)');
  return c;
}

function canvasTexture(canvas, colorSpace, aniso, repeat) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = colorSpace;
  t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/* --------------------------------------------------------------- public API */

/** Atlas geometry, read by materials.js to build region transforms. */
export const ATLAS = {
  cols: 2,
  rows: 2,
  regionScale: 0.5,
  macroVariants: 2, // 2x2 inside the macro region
  macroScale: 0.25,
  /** Region plates across one tile — drives the physical tiling maths. */
  platesPerRegion: 8,
  /** Macro tile is this many base regions across. */
  macroSpan: 3,
  index: { lancer: 0, bulwark: 1, monolith: 2, macro: 3 },
};

/** uv origin of a named plate-family region. */
export function regionOrigin(family) {
  const i = ATLAS.index[family] === undefined ? 0 : ATLAS.index[family];
  return [(i % 2) * 0.5, Math.floor(i / 2) * 0.5];
}

/** uv origin of macro sub-variant q (0..3) inside the macro region. */
export function macroOrigin(q) {
  const m = ATLAS.index.macro;
  const bx = (m % 2) * 0.5;
  const by = Math.floor(m / 2) * 0.5;
  return [bx + (q % 2) * 0.25, by + Math.floor(q / 2) * 0.25];
}

let state = null;

/**
 * Build every shared texture. Safe to call twice — the second call is a no-op.
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} rng  seeded stream from core/rng.js
 * @param {object} [opts] `{ quality, maxAnisotropy }`
 */
export function initTextureLibrary(renderer, rng, opts) {
  if (state) return;
  const o = opts || {};
  const quality = o.quality || 'high';
  const caps = renderer && renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 8;
  const aniso = Math.max(1, Math.min(o.maxAnisotropy || caps, caps));
  const base = rng || makeRng(0x5EED);

  const atlasSize = quality === 'low' ? 1024 : 2048;
  const regionS = atlasSize / 2;
  const macroS = regionS / 2;

  const albedoBytes = new Uint8Array(atlasSize * atlasSize * 4);
  const normalBytes = new Uint8Array(atlasSize * atlasSize * 4);
  const ormBytes = new Uint8Array(atlasSize * atlasSize * 4);
  const emisBytes = new Uint8Array(atlasSize * atlasSize * 4);

  const averages = {};

  // --- three plate families
  FAMILY_KEYS.forEach((family, i) => {
    const r = base.fork(0x100 + i);
    const pal = HULL_PALETTES[family];
    const drawn = drawPlateSurface(regionS, r, pal);
    const maps = deriveMaps(regionS, r, {
      hc: drawn.hc, mc: drawn.mc, pc: drawn.pc, ec: drawn.ec,
      cc: null, tc: null, lc: null,
      palette: pal, macro: false, quality,
    });
    const ox = (i % 2) * regionS;
    const oy = Math.floor(i / 2) * regionS;
    blit(albedoBytes, atlasSize, maps.albedo, regionS, ox, oy);
    blit(normalBytes, atlasSize, maps.normal, regionS, ox, oy);
    blit(ormBytes, atlasSize, maps.orm, regionS, ox, oy);
    blit(emisBytes, atlasSize, maps.emis, regionS, ox, oy);
    averages[family] = maps.average;
  });

  // --- four macro variants packed into the fourth region
  const mIdx = ATLAS.index.macro;
  const mox = (mIdx % 2) * regionS;
  const moy = Math.floor(mIdx / 2) * regionS;
  for (let q = 0; q < 4; q++) {
    const r = base.fork(0x200 + q);
    const drawn = drawMacroSurface(macroS, r, MACRO_RECIPES[q]);
    const maps = deriveMaps(macroS, r, {
      hc: drawn.hc, mc: drawn.mc, pc: drawn.pc,
      cc: drawn.cc, tc: drawn.tc, ec: drawn.ec, lc: drawn.lc,
      palette: HULL_PALETTES.bulwark, macro: true, quality,
    });
    const ox = mox + (q % 2) * macroS;
    const oy = moy + Math.floor(q / 2) * macroS;
    blit(albedoBytes, atlasSize, maps.albedo, macroS, ox, oy);
    blit(normalBytes, atlasSize, maps.normal, macroS, ox, oy);
    blit(ormBytes, atlasSize, maps.orm, macroS, ox, oy);
    blit(emisBytes, atlasSize, maps.emis, macroS, ox, oy);
  }

  const map = dataTexture(albedoBytes, atlasSize, THREE.SRGBColorSpace, aniso);
  const normalMap = dataTexture(normalBytes, atlasSize, THREE.NoColorSpace, aniso);
  const orm = dataTexture(ormBytes, atlasSize, THREE.NoColorSpace, aniso);
  const emissiveMap = dataTexture(emisBytes, atlasSize, THREE.SRGBColorSpace, aniso);

  map.name = 'vs.hull.albedo';
  normalMap.name = 'vs.hull.normal';
  orm.name = 'vs.hull.orm';
  emissiveMap.name = 'vs.hull.emissive';

  state = {
    quality,
    aniso,
    atlasSize,
    rng: base,
    atlas: {
      map,
      normalMap,
      // glTF ORM packing: r = AO, g = roughness, b = metalness. One texture,
      // three contract slots — three.js reads exactly these channels.
      roughnessMap: orm,
      metalnessMap: orm,
      aoMap: orm,
      emissiveMap,
      size: atlasSize,
      averages,
    },
    noise: new Map(),
    sprites: new Map(),
    decals: new Map(),
    owned: [map, normalMap, orm, emissiveMap],
  };
}

export function getHullAtlas() {
  if (!state) throw new Error('textures: initTextureLibrary() must run first');
  return state.atlas;
}

/** Per-family average albedo/rough/metal — used for the far-distance fade. */
export function getAtlasAverages() {
  return state ? state.atlas.averages : null;
}

export function getNoiseTexture(kind, size) {
  if (!state) throw new Error('textures: initTextureLibrary() must run first');
  const s = size || (kind === 'blue' ? 64 : 256);
  const key = `${kind}:${s}`;
  const cached = state.noise.get(key);
  if (cached) return cached;

  const rng = state.rng.fork(0x300 + key.length + s);
  let bytes;
  if (kind === 'blue') bytes = blueNoise(s, rng);
  else if (kind === 'value') bytes = valueNoiseBytes(s, rng);
  else if (kind === 'curl') bytes = curlBytes(s, rng);
  else bytes = fbmBytes(s, rng);

  const t = new THREE.DataTexture(bytes, s, s, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = kind === 'blue' ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = kind === 'blue' ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = kind !== 'blue';
  t.anisotropy = kind === 'blue' ? 1 : state.aniso;
  t.flipY = false;
  t.name = `vs.noise.${kind}`;
  t.needsUpdate = true;

  state.noise.set(key, t);
  state.owned.push(t);
  return t;
}

export function getSpriteTexture(kind) {
  if (!state) throw new Error('textures: initTextureLibrary() must run first');
  const cached = state.sprites.get(kind);
  if (cached) return cached;

  const lo = state.quality === 'low';
  const rng = state.rng.fork(0x400 + kind.length * 7 + kind.charCodeAt(0));
  let canvas;
  if (kind === 'flare') canvas = spriteFlare(lo ? 256 : 512, rng);
  else if (kind === 'smoke') canvas = spriteSmoke(lo ? 128 : 256, rng);
  else if (kind === 'spark') canvas = spriteSpark(lo ? 64 : 128);
  else if (kind === 'ring') canvas = spriteRing(lo ? 256 : 512, rng);
  else if (kind === 'beamcap') canvas = spriteBeamCap(lo ? 64 : 128);
  else if (kind === 'plume') canvas = spritePlume(lo ? 64 : 128, lo ? 128 : 256, rng);
  else canvas = spriteBeamCap(64);

  const t = canvasTexture(canvas, THREE.SRGBColorSpace, state.aniso, false);
  t.name = `vs.sprite.${kind}`;
  state.sprites.set(kind, t);
  state.owned.push(t);
  return t;
}

export function getDecalTexture(kind) {
  if (!state) throw new Error('textures: initTextureLibrary() must run first');
  const cached = state.decals.get(kind);
  if (cached) return cached;

  const lo = state.quality === 'low';
  const rng = state.rng.fork(0x500 + kind.length * 13 + kind.charCodeAt(0));
  let canvas;
  if (kind === 'scorch' || kind === 'burn') canvas = decalScorch(lo ? 128 : 256, rng);
  else if (kind === 'impact') canvas = decalImpact(lo ? 128 : 256, rng);
  else if (kind === 'hullNumber') canvas = decalHullNumber(lo ? 128 : 256, rng);
  else if (kind === 'chevron') canvas = decalChevron(lo ? 128 : 256, rng);
  else if (kind === 'hazard') canvas = decalHazard(lo ? 128 : 256, rng);
  else canvas = decalScorch(128, rng);

  const t = canvasTexture(canvas, THREE.SRGBColorSpace, state.aniso, false);
  t.name = `vs.decal.${kind}`;
  state.decals.set(kind, t);
  state.owned.push(t);
  return t;
}

/** Debug hook for the local material test page. Not used in shipped paths. */
export function getAtlasBytes() {
  return state ? state.atlas : null;
}

export function disposeTextures() {
  if (!state) return;
  for (const t of state.owned) {
    if (t && t.dispose) t.dispose();
    if (t && t.image && t.image.width) {
      // release the retained canvas / typed array backing store
      t.image = null;
      t.source.data = null;
    }
  }
  state.noise.clear();
  state.sprites.clear();
  state.decals.clear();
  state = null;
}
