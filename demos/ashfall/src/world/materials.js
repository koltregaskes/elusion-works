/**
 * Ashfall — procedural PBR material library.  (ARCHITECTURE.md §3.4)
 *
 * Everything here is synthesised at runtime. No image files, no fetches, no canvases loaded
 * from disk. The pipeline for every surface is the same and deliberately physical:
 *
 *      seeded noise fields  ->  height field  ->  Sobel normal
 *                           ->  albedo (painted from art.js palette, driven by the height)
 *                           ->  roughness (a FUNCTION of height and albedo, never a constant)
 *                           ->  AO (multi-direction horizon sweep + high-frequency cavity)
 *
 * Channel packing is ORM, the industry standard, so one texture serves three map slots:
 *      R = ambient occlusion   G = roughness   B = metalness   A = height
 * Three.js reads exactly those channels for `aoMap`, `roughnessMap` and `metalnessMap`, so
 * a hero surface costs three textures (albedo / normal / ORM), not five.
 *
 * On top of the maps, every material is patched via `onBeforeCompile` with four things that
 * do the heavy lifting for cohesion:
 *
 *   1. A detail normal blended at 8x UV with *reoriented normal mapping* (Barré-Brisebois &
 *      Hill), distance-faded so it dies before it can alias.
 *   2. A world-space up-facing ash/dust term. Ash settles on horizontal faces, tints them
 *      towards PALETTE.dust, roughens them, and — critically — kills the metallic response,
 *      because a dust film is a dielectric. This is the single strongest cohesion trick in
 *      the whole renderer and it is what makes the map read as one place. It is built from
 *      two bounded parts, never from a lerp towards a bright colour — that is what turned
 *      the yard into a snowfield: a MULTIPLICATIVE, luminance-neutral hue rotation that
 *      cannot change any surface's level, plus a small coverage term towards the deposit's
 *      OWN albedo, which is authored dark (0.23 linear luminance) so it lifts a substrate
 *      darker than ash and can never bleach one that is brighter.
 *   3. Low-frequency world-space macro variation, which breaks tiling on large planes in a
 *      way no amount of texture-space work can (texture-space blotches tile with the texture;
 *      this does not). It is sampled from a MIPPED tileable noise texture at world scale, not
 *      evaluated analytically — an analytic noise has no screen-space footprint, so its
 *      sub-pixel octaves alias into fixed-size speckle at every distance at once.
 *   4. Analytic exponential height fog with Henyey-Greenstein inscattering, driven from a
 *      SHARED uniform block (`materials.fogUniforms`) so `world/sky.js` mutates one object
 *      and every surface in the scene follows in lockstep.
 *
 * Plus specular anti-aliasing (Kaplanyan-style normal-variance roughness widening), which is
 * the difference between "sparkly crawling mess in motion" and "solid".
 */

import * as THREE from '../../vendor/three.module.js';
import { PALETTE, LIGHTING, ATMOSPHERE, SUN_ELEVATION, SUN_AZIMUTH } from './art.js';

/* ========================================================================== */
/* 0. Module-scope scratch — nothing in this file allocates per frame.        */
/* ========================================================================== */

const _sunDir = new THREE.Vector3();

/* ========================================================================== */
/* 1. Deterministic PRNG + colour helpers                                     */
/* ========================================================================== */

/** mulberry32 — tiny, fast, well-distributed. Determinism matters: the art must not drift. */
function mulberry32(a) {
  let s = a | 0;
  return function rnd() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a stable 32-bit seed so surface names alone fix the look. */
function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** '#rrggbb' -> [r,g,b] in 0..255 sRGB. Albedo authoring happens in sRGB, like a painter. */
function hex2rgb(hex) {
  const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Parsed palette, cached once. Nothing below is allowed to write a literal colour. */
const C = (() => {
  const out = {};
  for (const k of Object.keys(PALETTE)) {
    const v = PALETTE[k];
    if (typeof v === 'string' && v.charAt(0) === '#') out[k] = hex2rgb(v);
  }
  return out;
})();

function mixc(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function shade(a, f) {
  return [a[0] * f, a[1] * f, a[2] * f];
}
/** Push a colour towards or away from its own mean. Useful for authoring worn variants. */
function sat(a, f) {
  const m = (a[0] + a[1] + a[2]) / 3;
  return [m + (a[0] - m) * f, m + (a[1] - m) * f, m + (a[2] - m) * f];
}

/* ========================================================================== */
/* 2. Field maths — every generator writes into a Float32Array height field.  */
/*    These are flat typed-array loops on purpose; per-pixel canvas calls are  */
/*    two orders of magnitude slower and would blow the load budget.           */
/* ========================================================================== */

const OP_ADD = 0;
const OP_RIDGE = 1;
const OP_BILLOW = 2;
const OP_MUL = 3;

/**
 * One octave of tileable value noise on an fx x fy lattice, accumulated into `out`.
 *
 * The lattice is periodic, so any integer frequency tiles seamlessly. Interpolation uses the
 * quintic 6t^5-15t^4+10t^3 (Perlin's improved fade) rather than smoothstep: it is C2
 * continuous, so the derivative — and therefore the Sobel normal map derived from it later —
 * has no visible lattice creases. Cubic smoothstep leaves faint grid ridges in normal maps.
 */
function noiseOctave(out, res, fx, fy, amp, seed, op) {
  const lx = Math.max(1, fx | 0);
  const ly = Math.max(1, fy | 0);
  const lat = new Float32Array(lx * ly);
  const rnd = mulberry32(seed);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();

  // Per-column lattice indices and fade weights, hoisted out of the inner loop.
  const x0a = new Int32Array(res);
  const x1a = new Int32Array(res);
  const txa = new Float32Array(res);
  const sx = lx / res;
  for (let x = 0; x < res; x++) {
    const u = x * sx;
    const i0 = u | 0;
    const t = u - i0;
    x0a[x] = i0 % lx;
    x1a[x] = (i0 + 1) % lx;
    txa[x] = t * t * t * (t * (t * 6 - 15) + 10);
  }

  // The op branch is hoisted to the row loop rather than tested per pixel: at 1024x1024
  // that is one branch per 1024 samples instead of one per sample, and it measured ~25%.
  const sy = ly / res;
  for (let y = 0; y < res; y++) {
    const v = y * sy;
    const j0 = v | 0;
    const t = v - j0;
    const ty = t * t * t * (t * (t * 6 - 15) + 10);
    const r0 = (j0 % ly) * lx;
    const r1 = ((j0 + 1) % ly) * lx;
    const row = y * res;
    if (op === OP_ADD) {
      for (let x = 0; x < res; x++) {
        const tx = txa[x];
        const a = lat[r0 + x0a[x]];
        const b = lat[r0 + x1a[x]];
        const c = lat[r1 + x0a[x]];
        const d = lat[r1 + x1a[x]];
        const top = a + (b - a) * tx;
        const bot = c + (d - c) * tx;
        out[row + x] += (top + (bot - top) * ty) * amp;
      }
    } else if (op === OP_RIDGE) {
      // Ridged: fold the noise about 0.5 and square it. Sharp crests, flat valleys — this is
      // what makes cracks and rust flakes read as broken rather than lumpy.
      for (let x = 0; x < res; x++) {
        const tx = txa[x];
        const a = lat[r0 + x0a[x]];
        const b = lat[r0 + x1a[x]];
        const c = lat[r1 + x0a[x]];
        const d = lat[r1 + x1a[x]];
        const top = a + (b - a) * tx;
        const bot = c + (d - c) * tx;
        let n = 1 - Math.abs((top + (bot - top) * ty) * 2 - 1);
        n *= n;
        out[row + x] += n * amp;
      }
    } else if (op === OP_BILLOW) {
      for (let x = 0; x < res; x++) {
        const tx = txa[x];
        const a = lat[r0 + x0a[x]];
        const b = lat[r0 + x1a[x]];
        const c = lat[r1 + x0a[x]];
        const d = lat[r1 + x1a[x]];
        const top = a + (b - a) * tx;
        const bot = c + (d - c) * tx;
        out[row + x] += Math.abs((top + (bot - top) * ty) * 2 - 1) * amp;
      }
    } else {
      for (let x = 0; x < res; x++) {
        const tx = txa[x];
        const a = lat[r0 + x0a[x]];
        const b = lat[r0 + x1a[x]];
        const c = lat[r1 + x0a[x]];
        const d = lat[r1 + x1a[x]];
        const top = a + (b - a) * tx;
        const bot = c + (d - c) * tx;
        out[row + x] *= 1 - amp + amp * (top + (bot - top) * ty);
      }
    }
  }
}

/**
 * Bilinear wrapped upscale. Every working resolution in this file is a power of two, which
 * is what lets the wrap be a mask rather than a modulo.
 */
function upsampleField(src, sres, dres) {
  const out = new Float32Array(dres * dres);
  const s = sres / dres;
  for (let y = 0; y < dres; y++) {
    const sy = (y + 0.5) * s - 0.5;
    const row = y * dres;
    for (let x = 0; x < dres; x++) out[row + x] = sampleWrap(src, sres, (x + 0.5) * s - 0.5, sy);
  }
  return out;
}

/**
 * Fractional Brownian motion.
 *
 * `stretch` controls anisotropy: > 1 lowers the Y frequency, elongating features vertically;
 * < 1 raises it, elongating them horizontally. Wood grain, board-form marks and weld wander
 * all need the horizontal form, so they pass reciprocals.
 *
 * If the finest octave is well below the target Nyquist — which is true for every blotch,
 * warp and macro-variation field in this file — the whole stack is built at a reduced
 * resolution and upscaled once. The result is bit-for-bit indistinguishable because the
 * missing frequencies do not exist, and it turns three or four full-resolution passes into
 * one. This alone accounts for a large fraction of the load-time budget.
 */
function fbmField(res, o) {
  const octaves = o.octaves ?? 5;
  const lac = o.lacunarity ?? 2.0;
  const gain = o.gain ?? 0.5;
  const stretch = o.stretch ?? 1.0;
  const op = o.op ?? OP_ADD;
  const baseF = o.freq ?? 4;
  // The finest lattice frequency across BOTH axes — anisotropic fields put their detail on
  // whichever axis was not squashed, and getting this wrong would blur them away.
  const maxF = baseF * Math.max(1, 1 / stretch) * Math.pow(lac, octaves - 1);

  let wres = res;
  // 12 samples per lattice cell of the finest octave is far more than quintic value noise
  // needs; below that the bilinear upscale would start to show.
  while (wres > 64 && wres * 0.5 >= maxF * 12) wres >>= 1;

  // Pre-normalise the amplitudes instead of rescaling the field afterwards. The normalising
  // sum is known in closed form, so this removes one full-resolution pass per fBm call —
  // and there are several fBm calls in every surface.
  let norm = 0;
  for (let i = 0, a = 1; i < octaves; i++, a *= gain) norm += a;
  const inv = norm > 0 ? 1 / norm : 1;

  const out = new Float32Array(wres * wres);
  let fx = baseF;
  let fy = baseF / stretch;
  let amp = inv;
  for (let i = 0; i < octaves; i++) {
    noiseOctave(out, wres, Math.max(1, Math.round(fx)), Math.max(1, Math.round(fy)), amp, o.seed + i * 1013 + 7, op);
    fx *= lac;
    fy *= lac;
    amp *= gain;
  }
  // Balanced before the upscale: cheaper, and identical in result. Opt out with
  // `balance: false` where the raw Gaussian falloff is what is wanted.
  if (o.balance !== false) balanceField(out, o.spread ?? 2.0);
  return wres === res ? out : upsampleField(out, wres, res);
}

/**
 * Tileable Worley / cellular noise on a jittered grid.
 *   mode 0 = F1 (distance to nearest feature — domes, pebbles, blooms)
 *   mode 1 = F2 - F1 (small at cell borders — crack networks, grain boundaries)
 * `ids` optionally receives a stable per-cell random value, which is how gravel gets a
 * different tint per stone instead of one flat pebble colour.
 */
function worleyField(res, o) {
  const cx = Math.max(1, o.cx | 0);
  const cy = Math.max(1, (o.cy ?? o.cx) | 0);
  const jitter = o.jitter ?? 1.0;
  const mode = o.mode ?? 0;
  const rnd = mulberry32(o.seed);
  const px = new Float32Array(cx * cy);
  const py = new Float32Array(cx * cy);
  const pid = new Float32Array(cx * cy);
  for (let j = 0; j < cy; j++) {
    for (let i = 0; i < cx; i++) {
      const k = j * cx + i;
      px[k] = (i + 0.5 + (rnd() - 0.5) * jitter) / cx;
      py[k] = (j + 0.5 + (rnd() - 0.5) * jitter) / cy;
      pid[k] = rnd();
    }
  }
  const ids = o.ids || null;
  // F1 with sparse cells has no detail near the target Nyquist, so build it small and
  // upscale. Skipped when a cell-id field is requested: ids must not be interpolated, and
  // skipped for F2-F1, whose cell borders are a genuinely high-frequency feature.
  let wres = res;
  if (mode === 0 && !ids) {
    const need = Math.max(cx, cy) * 10;
    while (wres > 64 && wres * 0.5 >= need) wres >>= 1;
  }

  const out = new Float32Array(wres * wres);
  // Normalising by the mean cell size keeps F1 roughly in 0..1 whatever the cell count.
  const norm = Math.max(cx, cy);
  // Row-neighbour bases and wrap offsets, hoisted out of the pixel loop.
  const rowBase = new Int32Array(3);
  const rowOff = new Float32Array(3);
  for (let y = 0; y < wres; y++) {
    const v = (y + 0.5) / wres;
    const cj = (v * cy) | 0;
    const row = y * wres;
    for (let dj = -1; dj <= 1; dj++) {
      let jj = cj + dj;
      let w = 0;
      if (jj < 0) {
        jj += cy;
        w = -1;
      } else if (jj >= cy) {
        jj -= cy;
        w = 1;
      }
      rowBase[dj + 1] = jj * cx;
      rowOff[dj + 1] = w;
    }
    for (let x = 0; x < wres; x++) {
      const u = (x + 0.5) / wres;
      const ci = (u * cx) | 0;
      // Compare squared distances and take the root once at the end — three sqrt per pixel
      // saved out of nine, and sqrt is the single most expensive op in this loop.
      let f1 = 1e18;
      let f2 = 1e18;
      let bid = 0;
      for (let dj = 0; dj < 3; dj++) {
        const rb = rowBase[dj];
        const ro = rowOff[dj];
        for (let di = -1; di <= 1; di++) {
          let ii = ci + di;
          let wx = 0;
          if (ii < 0) {
            ii += cx;
            wx = -1;
          } else if (ii >= cx) {
            ii -= cx;
            wx = 1;
          }
          const k = rb + ii;
          const dx = px[k] + wx - u;
          const dy = py[k] + ro - v;
          const d = dx * dx + dy * dy;
          if (d < f1) {
            f2 = f1;
            f1 = d;
            bid = pid[k];
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
      const i = row + x;
      const d1 = Math.sqrt(f1) * norm;
      out[i] = mode === 1 ? Math.min(1, Math.sqrt(f2) * norm - d1) : Math.min(1, d1);
      if (ids) ids[i] = bid;
    }
  }
  return wres === res ? out : upsampleField(out, wres, res);
}

/**
 * Bilinear wrapped sample at fractional pixel coordinates.
 * Every working resolution in this file is a power of two, so the wrap is a mask; the
 * `% res` first keeps it correct for arbitrarily negative inputs.
 */
function sampleWrap(f, res, x, y) {
  const m = res - 1;
  let x0 = Math.floor(x);
  let y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  x0 = ((x0 % res) + res) & m;
  y0 = ((y0 % res) + res) & m;
  const x1 = (x0 + 1) & m;
  const y1 = (y0 + 1) & m;
  const r0 = y0 * res;
  const r1 = y1 * res;
  const a = f[r0 + x0];
  const b = f[r0 + x1];
  const c = f[r1 + x0];
  const d = f[r1 + x1];
  const top = a + (b - a) * tx;
  const bot = c + (d - c) * tx;
  return top + (bot - top) * ty;
}

/**
 * Domain warping: resample `src` with an offset taken from two low-frequency noise fields.
 * This is what turns "obviously procedural" into "organic" — straight cracks become wandering
 * cracks, circular rust blooms become ragged ones.
 */
function warpField(src, res, wx, wy, amountPx) {
  const out = new Float32Array(res * res);
  for (let y = 0; y < res; y++) {
    const row = y * res;
    for (let x = 0; x < res; x++) {
      const i = row + x;
      out[i] = sampleWrap(src, res, x + (wx[i] - 0.5) * amountPx, y + (wy[i] - 0.5) * amountPx);
    }
  }
  return out;
}

/**
 * Separable wrapped box blur with a running sum, run twice for a near-Gaussian kernel.
 * O(1) per pixel regardless of radius. Used to spread rust haloes. Never mutates `f`.
 */
function blurField(f, res, radius, passes) {
  if (radius < 1) return f;
  const m = res - 1; // power-of-two wrap mask
  const r = radius | 0;
  const inv = 1 / (r * 2 + 1);
  const tmp = new Float32Array(res * res);
  let src = f;
  let dst = null;
  const n = passes || 2;
  for (let p = 0; p < n; p++) {
    for (let y = 0; y < res; y++) {
      const row = y * res;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[row + ((k + res) & m)];
      for (let x = 0; x < res; x++) {
        tmp[row + x] = acc * inv;
        acc += src[row + ((x + r + 1 + res) & m)] - src[row + ((x - r + res) & m)];
      }
    }
    if (dst === null) dst = new Float32Array(res * res);
    for (let x = 0; x < res; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[(((k + res) & m) * res) + x];
      for (let y = 0; y < res; y++) {
        dst[y * res + x] = acc * inv;
        acc += tmp[((y + r + 1 + res) & m) * res + x] - tmp[((y - r + res) & m) * res + x];
      }
    }
    src = dst;
  }
  return dst;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Rescale a field so mean +- `spread` standard deviations spans 0..1.
 *
 * This matters more than it looks. Summed-octave fBm is close to Gaussian: its values pile
 * up around 0.5 with a standard deviation of roughly 0.1, so a `lerp(0.9, 1.1, noise)` tint
 * only ever varies by about +-2%, and the surface comes out looking flat no matter how many
 * octaves went into it. Balancing the distribution first is what makes the authored
 * amplitudes mean what they say.
 */
function balanceField(f, spread) {
  const n = f.length;
  let m = 0;
  for (let i = 0; i < n; i++) m += f[i];
  m /= n;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = f[i] - m;
    s += d * d;
  }
  s = Math.sqrt(s / n);
  if (s < 1e-6) return f;
  const k = 1 / (2 * (spread || 2.0) * s);
  for (let i = 0; i < n; i++) f[i] = clamp01(0.5 + (f[i] - m) * k);
  return f;
}

/** Rescale a field so its full range spans 0..1. Keeps contrast predictable. */
function normaliseField(f) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < f.length; i++) {
    const v = f[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const inv = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) * inv;
  return f;
}

/* ========================================================================== */
/* 3. Feature generators — the vocabulary each surface is authored from.      */
/* ========================================================================== */

/**
 * Anisotropic streaks (scratches, machining marks, brushed metal). Splats short soft-edged
 * strokes along a preferred direction with a controllable spread, wrapping at the borders so
 * the result tiles. Real scratches are not uniform: length, brightness and curvature all
 * vary, so each stroke gets its own.
 */
function scratchField(res, o) {
  const out = new Float32Array(res * res);
  const rnd = mulberry32(o.seed);
  const count = o.count ?? 400;
  const baseAngle = o.angle ?? 0;
  const spread = o.spread ?? 0.12;
  const lenMin = (o.lenMin ?? 0.02) * res;
  const lenMax = (o.lenMax ?? 0.16) * res;
  const width = Math.max(0.6, (o.width ?? 0.0012) * res);
  const curve = o.curve ?? 0.4;
  const wr = Math.ceil(width * 1.8);
  for (let s = 0; s < count; s++) {
    let x = rnd() * res;
    let y = rnd() * res;
    const len = lerp(lenMin, lenMax, Math.pow(rnd(), 2.2));
    let ang = baseAngle + (rnd() - 0.5) * Math.PI * 2 * spread;
    const dAng = (rnd() - 0.5) * curve * 0.02;
    const strength = lerp(0.25, 1.0, Math.pow(rnd(), 1.6));
    const w = width * lerp(0.6, 1.5, rnd());
    const steps = Math.max(2, len | 0);
    for (let t = 0; t < steps; t++) {
      ang += dAng;
      x += Math.cos(ang);
      y += Math.sin(ang);
      // Taper the ends — a scratch that starts and stops abruptly reads as a drawn line.
      const taper = Math.sin((t / steps) * Math.PI);
      const amp = strength * taper;
      const ix = Math.round(x);
      const iy = Math.round(y);
      for (let oy = -wr; oy <= wr; oy++) {
        const yy = (((iy + oy) % res) + res) % res;
        const row = yy * res;
        for (let ox = -wr; ox <= wr; ox++) {
          const d = Math.sqrt(ox * ox + oy * oy);
          if (d > w * 1.8) continue;
          const g = Math.exp(-(d * d) / (2 * w * w));
          const xx = (((ix + ox) % res) + res) % res;
          const i = row + xx;
          const v = amp * g;
          if (v > out[i]) out[i] = v;
        }
      }
    }
  }
  return out;
}

/**
 * Water streaks running downward from ledges. v increases upward in our textures (row 0 is
 * v=0), so "down" means marching towards decreasing y. Each streak starts high, wanders
 * horizontally under a noise field, and fades out along its length — dirt washes down and
 * runs out of dirt as it goes.
 */
function streakField(res, o) {
  const out = new Float32Array(res * res);
  const rnd = mulberry32(o.seed);
  const count = o.count ?? 40;
  const wobbleField = fbmField(res, { seed: o.seed + 991, freq: 3, octaves: 3, stretch: 6 });
  const startBand = o.startBand ?? [0.55, 1.0];
  for (let s = 0; s < count; s++) {
    let x = rnd() * res;
    let y = lerp(startBand[0], startBand[1], rnd()) * res;
    const len = lerp(o.lenMin ?? 0.15, o.lenMax ?? 0.7, Math.pow(rnd(), 1.5)) * res;
    const w = lerp(o.widthMin ?? 0.004, o.widthMax ?? 0.018, Math.pow(rnd(), 2)) * res;
    const strength = lerp(0.3, 1.0, rnd());
    const wobble = o.wobble ?? 2.2;
    const wr = Math.ceil(w * 1.6);
    const steps = Math.max(2, len | 0);
    for (let t = 0; t < steps; t++) {
      const f = t / steps;
      // Fade in fast at the top (the ledge) then decay — the classic teardrop stain profile.
      const amp = strength * smoothstep(0, 0.06, f) * (1 - f) * (1 - f * 0.4);
      const iy = Math.round(y);
      const drift = (sampleWrap(wobbleField, res, x, y) - 0.5) * wobble;
      x += drift;
      y -= 1;
      const ix = Math.round(x);
      for (let oy = -1; oy <= 1; oy++) {
        const yy = (((iy + oy) % res) + res) % res;
        const row = yy * res;
        for (let ox = -wr; ox <= wr; ox++) {
          const d = Math.abs(ox) / w;
          if (d > 1.6) continue;
          const g = Math.exp(-d * d * 1.6);
          const xx = (((ix + ox) % res) + res) % res;
          const i = row + xx;
          const v = amp * g;
          if (v > out[i]) out[i] = v;
        }
      }
    }
  }
  return out;
}

/**
 * Rust blooms. Real corrosion nucleates at a point and creeps outward along the metal, so:
 * Worley F1 gives the nucleation sites, a warped fBm eats into the boundary to stop them
 * looking like circles, a blur spreads a soft halo of light oxide, and a hard threshold on
 * the core gives the flaking scale that sits proud of the surface.
 */
function rustField(res, o) {
  const seed = o.seed;
  const f1 = worleyField(res, { cx: o.cells ?? 5, seed: seed + 3, jitter: 1.0, mode: 0 });
  const wx = fbmField(res, { seed: seed + 11, freq: 4, octaves: 4 });
  const wy = fbmField(res, { seed: seed + 29, freq: 4, octaves: 4 });
  const warped = warpField(f1, res, wx, wy, (o.warp ?? 0.09) * res);
  const detail = fbmField(res, { seed: seed + 47, freq: 12, octaves: 5, gain: 0.55 });
  const fine = fbmField(res, { seed: seed + 53, freq: 44, octaves: 4, gain: 0.5 });
  const core = new Float32Array(res * res);
  const halo = new Float32Array(res * res);
  const coverage = o.coverage ?? 0.45;
  /*
   * `bias` steers WHERE the oxide front gets going. Corrosion does not start at random: it
   * starts wherever the mill scale or the coating was broken and wherever water is held —
   * cut edges, weld heat-affected zones, fixings, and the paths water runs down. Feeding
   * those masks in as a local shift of the coverage threshold is the difference between
   * "rust with a reason" and orange amoebas scattered over a plate.
   */
  const bias = o.bias || null;
  const biasAmt = o.biasAmt ?? 0.5;
  for (let i = 0; i < core.length; i++) {
    // Bias the distance by noise at two more scales so the bloom edge is ragged all the way
    // down to the pixel. A clean distance threshold gives soft round blobs, which is the
    // single most common way procedural rust gives itself away.
    const cov = bias ? coverage * (1 + (bias[i] - 0.35) * biasAmt) : coverage;
    const d = warped[i] * 0.9 + (0.5 - detail[i]) * 0.36 + (0.5 - fine[i]) * 0.16;
    // Narrow transition band = crisp, flaky edge where the oxide front has eaten in.
    core[i] = 1 - smoothstep(cov * 0.82, cov * 1.0, d);
    halo[i] = 1 - smoothstep(cov * 1.0, cov * 1.9, d);
  }
  const spread = blurField(halo, res, Math.max(1, (res * 0.005) | 0), 2);
  // Re-roughen the blurred halo edge. A pure blur gives an airbrushed transition, which is
  // the second-most-common rust tell after round blobs.
  for (let i = 0; i < spread.length; i++) {
    spread[i] = clamp01(spread[i] * (0.65 + fine[i] * 0.8) + (detail[i] - 0.5) * 0.25 * spread[i] * 4);
  }
  const scale = new Float32Array(res * res);
  for (let i = 0; i < scale.length; i++) {
    // Flaking scale only forms where the core is well established and the fine noise peaks.
    scale[i] = clamp01((core[i] - 0.45) * 2.2) * smoothstep(0.5, 0.78, detail[i]);
  }
  return { core, halo: spread, scale, detail, fine };
}

/**
 * Paint chipping. A warped fBm is the "failure potential"; where it peaks, the coating has
 * come off. Eroding the threshold once more gives the raised lip of paint that has lifted
 * but not yet flaked away, which is what actually sells a chip in the normal map.
 *
 * `field` is returned raw so a surface can bias the threshold locally — paint fails first on
 * arrises and over mortar joints, and that has to be driven by the surface, not by this
 * function.
 */
function chipField(res, o) {
  const base = fbmField(res, { seed: o.seed, freq: o.freq ?? 7, octaves: 5, gain: 0.52 });
  const wx = fbmField(res, { seed: o.seed + 17, freq: 9, octaves: 3 });
  const wy = fbmField(res, { seed: o.seed + 31, freq: 9, octaves: 3 });
  const warped = warpField(base, res, wx, wy, (o.warp ?? 0.03) * res);
  const th = o.threshold ?? 0.62;
  const chip = new Float32Array(res * res);
  const lip = new Float32Array(res * res);
  for (let i = 0; i < chip.length; i++) {
    // Hard edge: paint does not fade off, it stops. A soft ramp here reads as a stain.
    chip[i] = smoothstep(th, th + 0.015, warped[i]);
    lip[i] = smoothstep(th - 0.05, th - 0.015, warped[i]) * (1 - smoothstep(th - 0.015, th, warped[i]));
  }
  return { chip, lip, field: warped };
}

/**
 * Cracks.
 *
 * A Voronoi F2-F1 network looks like a crack diagram, not like cracks: every cell is closed,
 * every line is the same width, and the eye reads the tessellation instantly. Ridged fBm
 * gives what concrete actually does — wandering lines that branch, vary in width, taper out
 * and stop. A separate low-frequency density field then confines them to patches, because a
 * wall that is evenly cracked everywhere reads as a pattern.
 */
function crackField(res, o) {
  const cells = o.cells ?? 9;
  // F2-F1 is genuinely a line network — the trap is using it raw, which gives a textbook
  // Voronoi diagram: closed cells, constant width, instantly readable as a tessellation.
  const raw = worleyField(res, { cx: cells, seed: o.seed, jitter: 1, mode: 1 });
  const wx = fbmField(res, { seed: o.seed + 11, freq: o.warpFreq ?? 8, octaves: 4 });
  const wy = fbmField(res, { seed: o.seed + 23, freq: o.warpFreq ?? 8, octaves: 4 });
  const warped = warpField(raw, res, wx, wy, res * (o.warp ?? 0.05));
  // Segment breaker: real cracks start, run, taper and stop. Multiplying the line field by
  // an independent mid-frequency noise turns a closed network into open, wandering fractures
  // of varying depth — which is the whole difference between "cracked" and "crazy paving".
  const seg = fbmField(res, { seed: o.seed + 37, freq: o.segFreq ?? 14, octaves: 4 });
  const density = fbmField(res, { seed: o.seed + 331, freq: o.densityFreq ?? 3, octaves: 3 });
  const out = new Float32Array(res * res);
  const w = o.width ?? 0.02; // in Worley cell units, so it scales with `cells`
  const lo = o.densityLo ?? 0.34;
  const hi = o.densityHi ?? 0.66;
  const segLo = o.segLo ?? 0.36;
  const segHi = o.segHi ?? 0.64;
  for (let i = 0; i < out.length; i++) {
    const line = 1 - smoothstep(w * 0.3, w, warped[i]);
    out[i] = line * smoothstep(segLo, segHi, seg[i]) * smoothstep(lo, hi, density[i]);
  }
  return out;
}

/**
 * Pits, blow holes and pock marks.
 *
 * Thresholding a Worley F1 directly gives a perfectly even field of identical discs — the
 * polka-dot look that instantly reads as procedural. Using the cell id both to kill most of
 * the cells outright and to set each surviving pit's radius turns the same field into an
 * irregular scatter of differently sized holes.
 */
function pitField(res, o) {
  const ids = new Float32Array(res * res);
  const cells = o.cells ?? 40;
  const f1 = worleyField(res, { cx: cells, seed: o.seed, jitter: 1, mode: 0, ids });
  // Warp the distance field so pit outlines are irregular. Perfect discs are as much of a
  // giveaway as a Voronoi crack diagram, and cheaper to fix.
  const wx = fbmField(res, { seed: o.seed + 61, freq: cells, octaves: 3 });
  const wy = fbmField(res, { seed: o.seed + 79, freq: cells, octaves: 3 });
  const amt = res * (o.warp ?? 0.6) / cells;
  const d = warpField(f1, res, wx, wy, amt);
  const wid = warpField(ids, res, wx, wy, amt);
  // Blow holes cluster where the pour was badly vibrated, corrosion pits cluster where the
  // coating failed first. An evenly scattered field still reads as procedural, so a
  // low-frequency mask thins them out over most of the surface.
  const cluster = fbmField(res, { seed: o.seed + 97, freq: o.clusterFreq ?? 4, octaves: 3 });
  const clusterLo = o.clusterLo ?? 0.3;
  const clusterHi = o.clusterHi ?? 0.62;
  const out = new Float32Array(res * res);
  const density = o.density ?? 0.35;
  const rMin = o.sizeMin ?? 0.07;
  const rMax = o.sizeMax ?? 0.28;
  for (let i = 0; i < out.length; i++) {
    const id = wid[i];
    if (id >= density) continue; // most cells simply have no pit
    // Remap the surviving ids to 0..1 and bias small, so a few big pits sit among many
    // little ones rather than everything being mid-sized.
    const t = id / density;
    const r = rMin + (rMax - rMin) * t * t;
    out[i] = (1 - smoothstep(r * 0.45, r, d[i])) * smoothstep(clusterLo, clusterHi, cluster[i]);
  }
  return out;
}

/**
 * Grid / panel / brick lines from a cell SDF with a chamfered shoulder.
 * Returns the joint groove (1 deep in the joint), the chamfer band (for edge wear and
 * highlight), a stable per-cell random id (for per-brick tone variation), and the sub-cell
 * vertical fraction — which is what lets a caller cut a *struck* joint, deep at the top of
 * the course and flush at the bottom, rather than a symmetrical machined slot.
 */
function gridField(res, o) {
  const cols = Math.max(1, o.cols | 0);
  const rows = Math.max(1, o.rows | 0);
  const stagger = o.stagger ?? 0;
  const gapPx = (o.gap ?? 0.004) * res;
  const chamferPx = (o.chamfer ?? 0.006) * res;
  const cellW = res / cols;
  const cellH = res / rows;
  const groove = new Float32Array(res * res);
  const chamfer = new Float32Array(res * res);
  const id = new Float32Array(res * res);
  const sv = new Float32Array(res * res);
  const idr = mulberry32(o.seed);
  const ids = new Float32Array(cols * rows);
  for (let i = 0; i < ids.length; i++) ids[i] = idr();
  // Optional per-row vertical jitter so wood planks and bricks are not machine-perfect.
  const rowJit = new Float32Array(rows);
  for (let r = 0; r < rows; r++) rowJit[r] = (idr() - 0.5) * (o.jitter ?? 0);

  // Optional wobble: laid courses and timber shuttering are never dead straight, and a
  // pixel-perfect grid is one of the loudest "this is procedural" signals there is.
  const wob = o.wobble
    ? fbmField(res, { seed: o.seed + 77, freq: o.wobbleFreq ?? 6, octaves: 3, stretch: 1 / 6 })
    : null;
  const wobAmp = (o.wobble ?? 0) * res;

  for (let y = 0; y < res; y++) {
    const outRow = y * res;
    for (let x = 0; x < res; x++) {
      const i = outRow + x;
      const yy = wob ? y + (wob[i] - 0.5) * wobAmp : y;
      const v = (yy / res) * rows;
      const rj = Math.floor(v);
      let row = rj % rows;
      if (row < 0) row += rows;
      const fv = v - rj;
      const u = (x / res) * cols + (row & 1) * stagger + rowJit[row];
      const cj = Math.floor(u);
      let col = cj % cols;
      if (col < 0) col += cols;
      const fu = u - cj;
      const dx = Math.min(fu, 1 - fu) * cellW;
      const dy = Math.min(fv, 1 - fv) * cellH;
      const d = Math.min(dx, dy);
      groove[i] = 1 - smoothstep(gapPx, gapPx + chamferPx, d);
      chamfer[i] = smoothstep(gapPx, gapPx + chamferPx * 0.6, d) * (1 - smoothstep(gapPx + chamferPx * 0.6, gapPx + chamferPx * 2.0, d));
      id[i] = ids[row * cols + col];
      sv[i] = fv;
    }
  }
  return { groove, chamfer, id, sv };
}

/** Aggregate pebbles for concrete/asphalt/gravel: overlapping inverted Worley domes. */
function pebbleField(res, o) {
  const out = new Float32Array(res * res);
  const scales = o.scales || [
    { cells: 26, amp: 0.6, jitter: 1.0 },
    { cells: 48, amp: 0.28, jitter: 1.0 },
    { cells: 90, amp: 0.12, jitter: 1.0 },
  ];
  let s = 0;
  for (const sc of scales) {
    // The coarsest scale can hand back its cell ids so the surface can tint each aggregate
    // stone individually — without that, exposed aggregate is one flat colour and reads as
    // a lumpy blanket rather than stones.
    const w = worleyField(res, {
      cx: sc.cells,
      seed: o.seed + s * 137 + 5,
      jitter: sc.jitter ?? 1,
      mode: 0,
      ids: s === 0 ? o.ids || null : null,
    });
    for (let i = 0; i < out.length; i++) {
      // 1 - F1 with a shoulder gives a dome that flattens near the feature point instead of
      // coming to a cone tip, which is what an aggregate stone actually looks like.
      const d = clamp01(w[i] * 1.35);
      out[i] += (1 - d * d) * sc.amp;
    }
    s++;
  }
  return normaliseField(out);
}

/**
 * Large-scale blotch at ~1/8 texture frequency. The first line of defence against visible
 * tiling: every albedo gets one, so the surface reads as varying long before the eye can
 * find the repeat. Built entirely at a reduced resolution — there is no high-frequency
 * content in it by definition — and upscaled once.
 */
function blotchField(res, seed, freq) {
  const w = Math.min(res, 256);
  const f = fbmField(w, { seed: seed + 613, freq: freq ?? 2, octaves: 3, gain: 0.62 });
  const wx = fbmField(w, { seed: seed + 811, freq: 3, octaves: 2 });
  const wy = fbmField(w, { seed: seed + 907, freq: 3, octaves: 2 });
  const warped = normaliseField(warpField(f, w, wx, wy, w * 0.06));
  return w === res ? warped : upsampleField(warped, w, res);
}

/**
 * The macro layer: ONE feature at roughly 1/16 of the surface's own detail frequency.
 *
 * Every other field in a generator lives between 8 and 200 cycles per tile, so this is the
 * only band that says anything about *where on the wall* a texel is — which half of the panel
 * stayed dry, which end of the slab the traffic ran over. It is also the single loudest tell
 * of a tiling texture: without it every copy of the tile carries an identical distribution of
 * light and dark and the eye finds the repeat in one glance.
 *
 * The contrast push at the end is deliberate. A gentle low-frequency gradient reads as a
 * lighting artefact and the viewer discounts it; a patchwork with real edges reads as a
 * surface with a history. Every caller applies it at a swing you can actually see (±20% of
 * albedo, ±0.2 of roughness) rather than the ±3% that a raw fBm's Gaussian would give.
 */
function macroField(res, seed) {
  const w = Math.min(res, 128);
  const f = fbmField(w, { seed: seed + 4409, freq: 2, octaves: 3, gain: 0.62, spread: 1.5 });
  const wx = fbmField(w, { seed: seed + 4421, freq: 3, octaves: 2 });
  const wy = fbmField(w, { seed: seed + 4423, freq: 3, octaves: 2 });
  const out = normaliseField(warpField(f, w, wx, wy, w * 0.14));
  for (let i = 0; i < out.length; i++) out[i] = clamp01(0.5 + (out[i] - 0.5) * 1.5);
  return w === res ? out : upsampleField(out, w, res);
}

/**
 * Propagating fracture network.
 *
 * A crack is not a noise field. It starts at a defect, runs, forks, narrows and stops, and
 * every branch is finer than its parent. Growing them as walkers is the only way to get that
 * lineage: a thresholded noise field gives lines of uniform width with no beginning and no
 * end, which is what makes procedural concrete read as marble. The wander comes from a noise
 * field rather than a random step so the path is smooth — a random walk gives a jittery line
 * that reads as a scribble.
 *
 * The stack is explicit rather than recursive, and both the branch depth and the total pop
 * count are capped: branch counts are data-dependent, and a runaway here would be a load-time
 * hang rather than a visual bug.
 */
function fractureField(res, o) {
  const out = new Float32Array(res * res);
  const rnd = mulberry32(o.seed);
  const drift = fbmField(res, { seed: o.seed + 313, freq: o.driftFreq ?? 6, octaves: 3 });
  // Confinement: cracking clusters where the slab is restrained or the sub-base moved. A wall
  // that is evenly cracked over its whole face reads as a pattern, not as damage.
  const gate = fbmField(res, { seed: o.seed + 331, freq: o.gateFreq ?? 3, octaves: 3 });
  const gateLo = o.gateLo ?? 0.32;
  const gateHi = o.gateHi ?? 0.64;
  const branchP = o.branch ?? 0.01;
  const maxGen = o.gens ?? 2;
  const baseW = (o.width ?? 0.0024) * res;
  const baseLen = (o.length ?? 0.45) * res;
  const wander = o.wander ?? 0.5;
  const stack = [];
  const n = o.count ?? 10;
  for (let s = 0; s < n; s++) {
    stack.push({
      x: rnd() * res,
      y: rnd() * res,
      a: rnd() * Math.PI * 2,
      w: baseW * lerp(0.75, 1.35, rnd()),
      life: baseLen * lerp(0.55, 1.45, rnd()),
      gen: 0,
    });
  }
  let guard = 0;
  while (stack.length > 0 && guard++ < 1024) {
    const c = stack.pop();
    let x = c.x;
    let y = c.y;
    let a = c.a;
    const steps = Math.max(2, c.life | 0);
    for (let t = 0; t < steps; t++) {
      a += (sampleWrap(drift, res, x, y) - 0.5) * wander;
      x += Math.cos(a);
      y += Math.sin(a);
      const f = t / steps;
      // Taper: a fracture opens near its origin and closes as the stress runs out of it.
      const ww = c.w * (1 - f * 0.7) * (0.55 + 0.45 * Math.sin(f * Math.PI));
      if (ww < 0.4) break;
      const g = smoothstep(gateLo, gateHi, sampleWrap(gate, res, x, y));
      if (g <= 0.002) continue;
      const amp = g * (1 - f * 0.45);
      const ix = Math.round(x);
      const iy = Math.round(y);
      const wr = Math.ceil(ww * 1.8);
      const inv2 = 1 / (2 * ww * ww);
      for (let oy = -wr; oy <= wr; oy++) {
        const yy = ((((iy + oy) % res) + res) % res) * res;
        for (let ox = -wr; ox <= wr; ox++) {
          const v = amp * Math.exp(-(ox * ox + oy * oy) * inv2);
          if (v <= 0.004) continue;
          const i = yy + ((((ix + ox) % res) + res) % res);
          if (v > out[i]) out[i] = v;
        }
      }
      if (c.gen < maxGen && rnd() < branchP) {
        stack.push({
          x,
          y,
          a: a + (rnd() < 0.5 ? -1 : 1) * lerp(0.45, 1.05, rnd()),
          w: ww * 0.6,
          life: (steps - t) * lerp(0.25, 0.6, rnd()),
          gen: c.gen + 1,
        });
      }
    }
  }
  return out;
}

/**
 * Regularly set-out round features: form-tie holes, rivets, roofing screws, bolt heads.
 *
 * These are the details that identify a *manufactured* surface, and they are the one thing
 * noise can never produce. Real fixings sit on a setting-out grid with a fitter's tolerance
 * on it and the occasional one missing, so the grid is jittered and thinned. Returns the
 * feature itself and the rim around it, which is where the corrosion starts.
 */
function discField(res, o) {
  const mask = new Float32Array(res * res);
  const rim = new Float32Array(res * res);
  const cols = Math.max(1, o.cols | 0);
  const rows = Math.max(1, o.rows | 0);
  const rnd = mulberry32(o.seed);
  const r0 = (o.radius ?? 0.012) * res;
  const jit = (o.jitter ?? 0.2) * (res / Math.max(cols, rows));
  const drop = o.dropout ?? 0.0;
  const rimK = o.rim ?? 2.0;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const keep = rnd();
      const cx = ((rx + 0.5) / cols) * res + (rnd() - 0.5) * jit;
      const cy = ((ry + 0.5) / rows) * res + (rnd() - 0.5) * jit;
      const rr = r0 * lerp(0.78, 1.24, rnd());
      if (keep < drop) continue;
      const R = Math.ceil(rr * (rimK + 0.4));
      for (let dy = -R; dy <= R; dy++) {
        const yy = ((((cy + dy) | 0) % res) + res) % res;
        const row = yy * res;
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy) / rr;
          const i = row + ((((cx + dx) | 0) % res) + res) % res;
          const m = 1 - smoothstep(0.76, 1.04, d);
          const rm = smoothstep(0.88, 1.12, d) * (1 - smoothstep(rimK * 0.72, rimK, d));
          if (m > mask[i]) mask[i] = m;
          if (rm > rim[i]) rim[i] = rm;
        }
      }
    }
  }
  return { mask, rim };
}

/**
 * Downward bleed from a source mask.
 *
 * Salt bloom out of a crack, rust out of a fixing, dirt off a ledge: all three do the same
 * thing. The source leaks, gravity takes it down the face, and it runs out as it goes. This
 * is what ties a stain to the feature that caused it — a stain that floats free of its source
 * is the most common way procedural weathering gives itself away.
 *
 * v increases upward in these textures (row 0 is v = 0), so "down" is decreasing y. `run` is
 * the e-folding length as a fraction of the tile. Two passes down the tile so a source near
 * the bottom still wraps correctly into the top.
 *
 * Marched a row at a time with a whole row of accumulators rather than a column at a time
 * with one, which is the same result and an order of magnitude quicker: a column-major sweep
 * of a 1024-square field touches a different cache line on every single read, and there are
 * five of these in the library at hero resolution.
 */
function bleedField(src, res, o) {
  const decay = Math.exp(-1 / Math.max(1, (o.run ?? 0.08) * res));
  const spread = o.spread ?? 0;
  const out = new Float32Array(res * res);
  const cur = new Float32Array(res);
  const prev = new Float32Array(res);
  const mask = res - 1;
  // Lateral wander, so a run wobbles as it falls instead of being a plumb line. Built small
  // and looked up nearest-neighbour: the drift is only a few pixels and everything that
  // consumes this blurs it afterwards, so a bilinear fetch per texel would buy nothing.
  let wob = null;
  let wx = null;
  const wres = 64;
  if (spread > 0) {
    wob = fbmField(wres, { seed: (o.seed ?? 17) + 55, freq: 4, octaves: 3, stretch: 8 });
    wx = new Int32Array(res);
    for (let x = 0; x < res; x++) wx[x] = ((x * wres) / res) | 0;
  }
  for (let p = 0; p < 2; p++) {
    for (let k = 0; k < res; k++) {
      const y = res - 1 - k;
      const row = y * res;
      const wrow = wob ? (((y * wres) / res) | 0) * wres : 0;
      for (let x = 0; x < res; x++) {
        let a = prev[x] * decay;
        if (wob) {
          const off = ((wob[wrow + wx[x]] - 0.5) * spread) | 0;
          const b = prev[(x + off) & mask] * decay;
          if (b > a) a = b;
        }
        const s = src[row + x];
        if (s > a) a = s;
        cur[x] = a;
        if (p === 1 && a > out[row + x]) out[row + x] = a;
      }
      prev.set(cur);
    }
  }
  return out;
}

/* ========================================================================== */
/* 4. Height -> normal, height -> AO, and 8-bit packing                       */
/* ========================================================================== */

/**
 * Sobel-derived tangent-space normal map, OpenGL convention (+Y up in UV space, matching
 * three.js's derivative tangent frame). `relief` is the physical height of the field
 * expressed as a fraction of the tile width; it is what makes a 1024 map and a 512 map of
 * the same surface produce the same-looking bumps.
 */
function heightToNormal(h, res, relief, out) {
  const dst = out || new Uint8Array(res * res * 4);
  // Sobel returns 8x the average gradient per pixel; the extra 1/8 keeps `relief` physical.
  const k = relief * res * 0.125;
  for (let y = 0; y < res; y++) {
    const ym = ((y - 1 + res) % res) * res;
    const y0 = y * res;
    const yp = ((y + 1) % res) * res;
    for (let x = 0; x < res; x++) {
      const xm = (x - 1 + res) % res;
      const xp = (x + 1) % res;
      const tl = h[ym + xm];
      const tc = h[ym + x];
      const tr = h[ym + xp];
      const ml = h[y0 + xm];
      const mr = h[y0 + xp];
      const bl = h[yp + xm];
      const bc = h[yp + x];
      const br = h[yp + xp];
      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      let nx = -gx * k;
      let ny = -gy * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= inv;
      ny *= inv;
      const nz = inv;
      const i = (y0 + x) * 4;
      dst[i] = (nx * 127.5 + 127.5) | 0;
      dst[i + 1] = (ny * 127.5 + 127.5) | 0;
      dst[i + 2] = (nz * 127.5 + 127.5) | 0;
      dst[i + 3] = 255;
    }
  }
  return dst;
}

function downsample(f, res, target) {
  const step = res / target;
  const out = new Float32Array(target * target);
  const s = step | 0;
  const inv = 1 / (s * s);
  for (let y = 0; y < target; y++) {
    const sy = y * s;
    for (let x = 0; x < target; x++) {
      const sx = x * s;
      let acc = 0;
      for (let j = 0; j < s; j++) {
        const row = ((sy + j) % res) * res;
        for (let i = 0; i < s; i++) acc += f[row + ((sx + i) % res)];
      }
      out[y * target + x] = acc * inv;
    }
  }
  return out;
}

/**
 * Ambient occlusion from the height field.
 *
 * Two terms, because one is never enough:
 *   - A horizon sweep at low resolution: march N directions, track the maximum elevation
 *     angle the terrain reaches, and accumulate sin(horizon). This is the real occlusion of
 *     large forms — the shadowed side of an aggregate stone, the inside of a panel groove.
 *   - A high-frequency cavity term (height minus a blurred height) at full resolution, which
 *     catches the hairline cracks and mortar joints the low-res sweep cannot see.
 *
 * Never returns a flat field: even a mirror-smooth surface picks up the cavity term.
 */
function heightToAO(h, res, o) {
  const aw = Math.min(256, Math.max(64, res >> 1));
  const small = aw === res ? h : downsample(h, res, aw);
  const dirs = o.dirs ?? 8;
  const steps = o.steps ?? 5;
  const strength = o.strength ?? 1.0;
  const reliefPx = (o.relief ?? 0.05) * aw;
  const radius = (o.radius ?? 0.07) * aw;
  const dxs = new Float32Array(dirs);
  const dys = new Float32Array(dirs);
  for (let d = 0; d < dirs; d++) {
    // 0.37 rad offset stops the sample directions aligning with the pixel grid, which would
    // print a faint star pattern into the AO on axis-aligned features.
    const a = (d / dirs) * Math.PI * 2 + 0.37;
    dxs[d] = Math.cos(a);
    dys[d] = Math.sin(a);
  }
  const dist = new Float32Array(steps);
  for (let s = 0; s < steps; s++) dist[s] = Math.max(1, radius * Math.pow((s + 1) / steps, 1.45));

  const lowAO = new Float32Array(aw * aw);
  const mask = aw - 1;
  const pow2 = (aw & mask) === 0;
  for (let y = 0; y < aw; y++) {
    for (let x = 0; x < aw; x++) {
      const h0 = small[y * aw + x];
      let occ = 0;
      for (let d = 0; d < dirs; d++) {
        let maxSlope = 0;
        for (let s = 0; s < steps; s++) {
          const fx = x + dxs[d] * dist[s] + aw;
          const fy = y + dys[d] * dist[s] + aw;
          const sx = pow2 ? (fx | 0) & mask : (fx | 0) % aw;
          const sy = pow2 ? (fy | 0) & mask : (fy | 0) % aw;
          const slope = ((small[sy * aw + sx] - h0) * reliefPx) / dist[s];
          if (slope > maxSlope) maxSlope = slope;
        }
        // sin(atan(slope)) without the trig — the fraction of the hemisphere this direction
        // blocks.
        occ += maxSlope / Math.sqrt(1 + maxSlope * maxSlope);
      }
      lowAO[y * aw + x] = 1 - (occ / dirs) * strength;
    }
  }

  // High-frequency cavity, full resolution. One box pass is enough: this is a difference
  // mask, not a filter whose shape anyone will see.
  const blurred = blurField(h, res, Math.max(1, (res * 0.006) | 0), 1);
  const out = new Float32Array(res * res);
  const cavityAmt = o.cavity ?? 0.55;
  const scaleUp = aw / res;
  for (let y = 0; y < res; y++) {
    const sy = y * scaleUp;
    for (let x = 0; x < res; x++) {
      const i = y * res + x;
      const low = sampleWrap(lowAO, aw, x * scaleUp, sy);
      const cav = clamp01((blurred[i] - h[i]) * 6.0) * cavityAmt;
      out[i] = clamp01(low * (1 - cav));
    }
  }
  return out;
}

/**
 * Quantise 0..1 to a byte with a cheap hashed dither. 8-bit roughness and AO ramps band
 * badly on smooth surfaces once bloom and a filmic curve are applied on top; a sub-LSB of
 * noise before rounding removes it for free and TAA averages the noise away.
 */
function q8(v, i) {
  const d = (((Math.imul(i, 1103515245) + 12345) >>> 16) & 255) / 255 - 0.5;
  const x = v * 255 + d;
  return x < 0 ? 0 : x > 255 ? 255 : x | 0;
}

/* ========================================================================== */
/* 5. Surface authoring context                                               */
/* ========================================================================== */

function makeCtx(res, seed) {
  const N = res * res;
  return {
    res,
    N,
    seed,
    rnd: mulberry32(seed),
    h: new Float32Array(N), // height, 0..1
    ar: new Float32Array(N), // albedo r, 0..255 sRGB
    ag: new Float32Array(N),
    ab: new Float32Array(N),
    rg: new Float32Array(N), // roughness 0..1
    mt: new Float32Array(N), // metalness 0..1
  };
}

function fillC(ctx, c) {
  ctx.ar.fill(c[0]);
  ctx.ag.fill(c[1]);
  ctx.ab.fill(c[2]);
}
function paint(ctx, i, c, t) {
  if (t <= 0) return;
  const k = t > 1 ? 1 : t;
  ctx.ar[i] += (c[0] - ctx.ar[i]) * k;
  ctx.ag[i] += (c[1] - ctx.ag[i]) * k;
  ctx.ab[i] += (c[2] - ctx.ab[i]) * k;
}
function tint(ctx, i, f) {
  ctx.ar[i] *= f;
  ctx.ag[i] *= f;
  ctx.ab[i] *= f;
}
/** Perceptual-ish luminance of the authored albedo, 0..1. Roughness is a function of this. */
function lum(ctx, i) {
  return (ctx.ar[i] * 0.2126 + ctx.ag[i] * 0.7152 + ctx.ab[i] * 0.0722) / 255;
}

/* ========================================================================== */
/* 6. The surfaces. Twenty recipes, no two alike.                             */
/* ========================================================================== */

/* --- concreteRough: poured, weathered, aggregate showing through ---------- */
function bConcreteRough(ctx) {
  const { res, N, seed } = ctx;
  const grain = fbmField(res, { seed, freq: 10, octaves: 6, gain: 0.52 });
  const aggIds = new Float32Array(N);
  const pebbles = pebbleField(res, {
    seed: seed + 5,
    ids: aggIds,
    scales: [
      { cells: 30, amp: 0.55 },
      { cells: 56, amp: 0.28 },
      { cells: 104, amp: 0.14 },
    ],
  });
  const blotch = blotchField(res, seed + 71, 2);
  const macro = blotchField(res, seed + 133, 4);
  // Cracks are a garnish on cast concrete, not its defining motif. Held to a low density and
  // a narrow width so they stay wandering fractures in a few patches: a crack field turned up
  // far enough to cover the surface is a Worley diagram again however hard it is warped, and
  // it reads as dried mud or marble rather than as a poured slab.
  // Fatigue cracks grown as walkers rather than thresholded out of a Voronoi: they start,
  // run, fork into finer branches and stop, and they cluster where the slab was restrained.
  const cracks = fractureField(res, {
    seed: seed + 211,
    count: 9,
    width: 0.0026,
    length: 0.42,
    branch: 0.012,
    gens: 2,
    wander: 0.5,
    driftFreq: 6,
    gateFreq: 3,
    gateLo: 0.36,
    gateHi: 0.68,
  });
  const pits = pitField(res, { cells: 46, seed: seed + 307, density: 0.3, sizeMin: 0.09, sizeMax: 0.34 });
  const streaks = streakField(res, { seed: seed + 401, count: 26, lenMin: 0.2, lenMax: 0.8, widthMin: 0.006, widthMax: 0.03 });
  const fine = fbmField(res, { seed: seed + 503, freq: 80, octaves: 4, gain: 0.5 });
  const speck = fbmField(res, { seed: seed + 601, freq: 190, octaves: 2, gain: 0.5 });
  // What actually identifies concrete, none of which a noise-plus-crack recipe contains:
  //   - the timber shuttering's grain, printed into the face,
  //   - the ~0.6 m board bands and the cold joint between one pour and the next,
  //   - form-tie holes on a setting-out grid, weeping rust down the face,
  //   - spalling, where the skin has come off and the aggregate is exposed in the raw,
  //   - efflorescence: lime carried out of the slab by water and left as salt at the crack.
  const board = fbmField(res, { seed: seed + 821, freq: 5, octaves: 4, gain: 0.55, stretch: 1 / 9 });
  const boardLines = gridField(res, { cols: 1, rows: 4, gap: 0.0018, chamfer: 0.005, seed: seed + 823, wobble: 0.004, wobbleFreq: 7 });
  const seams = gridField(res, { cols: 2, rows: 1, gap: 0.002, chamfer: 0.009, seed: seed + 827, wobble: 0.003, wobbleFreq: 5 });
  const spallF = blotchField(res, seed + 829, 5);
  const macroL = macroField(res, seed + 937);
  const ties = discField(res, { cols: 3, rows: 3, radius: 0.0105, jitter: 0.34, dropout: 0.22, rim: 2.2, seed: seed + 941 });

  /*
   * Cold joints. A wall is poured in lifts, and the line where one lift met the next is a
   * permanent feature: a slight ledge, a tone step between two batches of cement, and a
   * horizon for every stain on the face. Two lines per tile — one mid-tile and one *on* the
   * tile seam — so the vertical repeat lands on a modelled joint instead of an unexplained
   * tone step, which is what a single lift line would have produced.
   */
  const jointWob = fbmField(res, { seed: seed + 833, freq: 7, octaves: 3, stretch: 1 / 10 });
  const cold = new Float32Array(N);
  const liftTone = new Float32Array(N);
  const coldB = res * 0.47;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x;
      const w = (jointWob[i] - 0.5) * res * 0.018;
      const y1 = w;
      const y2 = coldB - w * 0.7;
      const d1 = Math.abs(((((y - y1) % res) + res + res * 0.5) % res) - res * 0.5);
      const d2 = Math.abs(((((y - y2) % res) + res + res * 0.5) % res) - res * 0.5);
      const k = res * 0.0055;
      cold[i] = Math.max(1 - smoothstep(0.45, 1.35, d1 / k), 1 - smoothstep(0.45, 1.35, d2 / k));
      const rel = (((y - y1) % res) + res) % res;
      const span = (((y2 - y1) % res) + res) % res;
      liftTone[i] = rel < span ? 1 : 0;
    }
  }
  // Efflorescence weeps out of whatever lets water through — the cracks, the cold joint and
  // the tie holes — and runs down the face below it. It has to be *tied* to those features:
  // salt bloom floating free of a source is the loudest weathering mistake there is.
  const weepSrc = new Float32Array(N);
  for (let i = 0; i < N; i++) weepSrc[i] = clamp01(cracks[i] * 1.1 + cold[i] * 0.55 + ties.mask[i] * 0.5);
  const efflo = blurField(bleedField(weepSrc, res, { run: 0.055, spread: res * 0.01, seed: seed + 947 }), res, Math.max(1, (res * 0.004) | 0), 1);
  const tieWeep = bleedField(ties.mask, res, { run: 0.045, spread: res * 0.008, seed: seed + 953 });

  const lit = C.concreteLit;
  const stained = C.concreteStained;
  const cool = C.concreteShadow;
  const dustC = C.dust;
  // Lime bloom is a pale chalky salt, not white paint: it is the dust colour pushed towards
  // the plaster tone and desaturated, so it still belongs to the palette.
  const saltC = sat(mixc(dustC, C.plaster, 0.5), 0.35);
  const rustC = C.rust;

  for (let i = 0; i < N; i++) {
    const crack = cracks[i];
    const pit = pits[i];
    const bandJoint = boardLines.groove[i];
    const seam = seams.groove[i];
    const coldJ = cold[i];
    const tie = ties.mask[i];
    const mL = macroL[i];
    // Spalling: the skin has failed in patches and the raw aggregate is out. Gated on the
    // aggregate field so the exposed stones are the same stones that were under the skin,
    // and on the macro layer so whole regions of the face have failed rather than a scatter.
    const spall = smoothstep(0.62, 0.9, spallF[i]) * smoothstep(0.3, 0.75, pebbles[i]) * (0.35 + smoothstep(0.4, 0.8, mL));

    // Height: broad form from blotch, aggregate lumps, board grain, then carve the joints,
    // cracks, pits, tie holes and spalled patches out.
    //
    // The aggregate lives UNDER the trowelled skin, so it can only show in the *height* field
    // where the skin has gone. Running the pebble field ungated across the whole face at a
    // flat 0.36 was the single cause of the "cottage cheese" read: one isotropic blob field
    // at one scale with no direction and no macro structure, identical on the terraces upper
    // band, the lintels, the yard perimeter panels and the slabs, so four substances read as
    // one substance. The albedo already gates its aggregate on `spall`/`exposed` (below); the
    // height field simply was not using the same gate.
    //
    // The residual is 0.07 rather than 0 on purpose. concreteRough is also the floor-slab
    // surface (SLAB_ZONES in level.js), and a power-floated slab with a literally flat height
    // field loses the burnished/`traffic` roughness response further down, which is the thing
    // that makes a walking lane read at all.
    const skin = 1 - clamp01(spall * 1.4 + pit * 0.8);
    let hv =
      0.5 +
      (blotch[i] - 0.5) * 0.26 +
      (pebbles[i] - 0.5) * lerp(0.34, 0.07, skin) +
      (grain[i] - 0.5) * 0.2 +
      (fine[i] - 0.5) * 0.08;
    // The mould face, not the mix, is what the eye should read on a cast wall. `board` is fBm
    // at freq 5 stretched 1/9, i.e. correctly horizontal — it just never had the authority to
    // beat the isotropic terms. At 0.22 it becomes the dominant signal, which is what gives
    // the surface an axis and lets the cold joint, the seams, the tie holes and the cracks
    // stay legible against it instead of being lost in blob noise.
    hv += (board[i] - 0.5) * 0.22;
    hv += (mL - 0.5) * 0.1; // whole regions of the face sit slightly proud or shy
    hv -= bandJoint * 0.1;
    hv -= seam * 0.16;
    hv -= coldJ * 0.2;
    hv -= crack * 0.34;
    hv -= pit * 0.3;
    hv -= tie * 0.5;
    hv += ties.rim[i] * 0.05; // the tie cone leaves a proud collar of grout around the hole
    hv -= spall * 0.16;
    hv += efflo[i] * 0.03; // salt is a deposit: it sits ON the face
    ctx.h[i] = clamp01(hv);

    // Albedo: a light trowelled skin, stained where water has sat, cooler in the recesses.
    const wear = clamp01(blotch[i] * 0.75 + macro[i] * 0.45 - 0.2);
    ctx.ar[i] = lit[0];
    ctx.ag[i] = lit[1];
    ctx.ab[i] = lit[2];
    // The decisive macro layer, applied at a swing the eye can actually read. This is the one
    // term that stops a 2.5 m tile repeated across a 40 m wall from looking like wallpaper.
    tint(ctx, i, lerp(0.79, 1.2, mL));
    // Two lifts, two batches of cement, and now that the height field is board-form rather
    // than blob noise the band has to carry its share of the macro read. At 1.045/0.965 the
    // swing was 8% peak to peak, which measured as nothing on a 40 m elevation seen from the
    // yard. 1.07/0.94 is ~14% — still inside what two batches of the same mix plausibly
    // differ by, but visible at gameplay distance, which is the whole point of a lift line.
    tint(ctx, i, liftTone[i] > 0.5 ? 1.07 : 0.94);
    paint(ctx, i, stained, wear * 0.75);
    // Board-form grain: the shuttering timber prints its own grain into the face, which is a
    // strongly horizontal signal and the fastest way to tell cast concrete from grey noise.
    tint(ctx, i, lerp(0.88, 1.1, board[i]));
    paint(ctx, i, shade(stained, 0.86), bandJoint * 0.5);
    paint(ctx, i, shade(cool, 0.8), seam * 0.55);
    paint(ctx, i, shade(cool, 0.72), coldJ * 0.6);
    paint(ctx, i, shade(cool, 1.05), streaks[i] * 0.55);
    // Exposed aggregate: each stone gets its own tone from the Worley cell id, so the
    // aggregate reads as stones rather than as a single grey crust.
    const exposed = smoothstep(0.6, 0.93, pebbles[i]);
    paint(ctx, i, sat(shade(lit, lerp(0.58, 1.16, aggIds[i])), lerp(0.42, 1.0, aggIds[i])), exposed * 0.66);
    // Spalled patches read as the raw mix: paler matrix, much more stone showing.
    paint(ctx, i, mixc(shade(lit, 0.92), sat(shade(C.gravel, lerp(0.62, 1.2, aggIds[i])), 0.8), 0.6), spall * 0.75);
    // Dust collects in the low frequencies of the surface, lightening it.
    paint(ctx, i, dustC, clamp01(macro[i] - 0.45) * 0.3);
    // Cement matrix speckle. Fine, high-contrast, and the main reason the surface still has
    // something to look at from half a metre away.
    tint(ctx, i, lerp(0.8, 1.16, grain[i]));
    tint(ctx, i, lerp(0.9, 1.1, speck[i]));
    paint(ctx, i, shade(cool, 0.68), crack * 0.6);
    // Efflorescence: pale, chalky, strongest right at the source and fading down the run.
    paint(ctx, i, saltC, clamp01(efflo[i] * 1.35) * 0.62);
    // The tie is a hole with a plug of grout in it, and the reinforcement behind it weeps
    // rust down the face.
    paint(ctx, i, shade(cool, 0.55), tie * 0.85);
    paint(ctx, i, mixc(rustC, stained, 0.45), clamp01(tieWeep[i] * 1.25 - tie * 0.6) * 0.55);
    // Pits stay subtle in the albedo — the AO and the normal do the work. Painting them
    // dark as well double-counts the occlusion and prints polka dots.
    paint(ctx, i, shade(cool, 0.85), pit * 0.4);

    // Roughness as a function of the height and the albedo, over a range wide enough to see.
    // Trowelled high points and traffic lanes are burnished nearly smooth; broken aggregate,
    // spall and crack interiors are as rough as the format allows. A near-constant here is
    // what produces one global sheen across a whole map.
    const l = lum(ctx, i);
    const damp = smoothstep(0.55, 0.95, macro[i]);
    const traffic = smoothstep(0.52, 0.9, blotch[i]);
    // Standing water. Where a low patch of a damp region has not drained, the surface is a
    // near-mirror — and under an 8-degree key that is worth more than any albedo detail in
    // the file, because it is the only thing in frame that returns the sun at full strength.
    const puddle = smoothstep(0.68, 0.95, mL) * (1 - smoothstep(0.3, 0.55, ctx.h[i]));
    let r = 0.92;
    r -= smoothstep(0.45, 0.92, ctx.h[i]) * 0.26; // burnished highs
    r -= damp * 0.28; // standing damp
    r -= traffic * 0.16; // polished walking lane
    r += (mL - 0.5) * 2.0 * 0.11; // the macro layer drives roughness as well as albedo
    r += crack * 0.1;
    r += pit * 0.12;
    r += spall * 0.1;
    r += coldJ * 0.08;
    r += clamp01(efflo[i] * 1.3) * 0.16; // salt crust is chalk: as matte as the surface gets
    r -= exposed * 0.16; // polished stone faces
    r += (fine[i] - 0.5) * 0.14;
    r -= (l - 0.42) * 0.2; // darker = damp-stained = glossier
    r -= streaks[i] * 0.14;
    r = lerp(r, 0.075, puddle * 0.9);
    ctx.rg[i] = clamp01(r);
    // Water darkens what it sits on, and it does it after every other albedo term.
    tint(ctx, i, lerp(1.0, 0.74, puddle));
    ctx.mt[i] = 0;
  }
}

/* --- concretePanel: precast shuttered panels with form-tie holes ---------- */
function bConcretePanel(ctx) {
  const { res, N, seed } = ctx;
  const grid = gridField(res, { cols: 2, rows: 2, gap: 0.006, chamfer: 0.014, seed: seed + 3 });
  // Board-form marks: the timber shuttering leaves horizontal grain in the face.
  const board = fbmField(res, { seed: seed + 19, freq: 6, octaves: 5, stretch: 1 / 14 });
  const boardLines = gridField(res, { cols: 1, rows: 14, gap: 0.0016, chamfer: 0.004, seed: seed + 23, wobble: 0.006, wobbleFreq: 9 });
  const grain = fbmField(res, { seed: seed + 41, freq: 16, octaves: 5, gain: 0.5 });
  const speck = fbmField(res, { seed: seed + 43, freq: 180, octaves: 2 });
  const mottle = fbmField(res, { seed: seed + 47, freq: 26, octaves: 4 });
  const blotch = blotchField(res, seed + 67, 2);
  const stains = blotchField(res, seed + 71, 4);
  const chips = chipField(res, { seed: seed + 89, freq: 20, threshold: 0.81, warp: 0.02 });
  const streaks = streakField(res, { seed: seed + 97, count: 34, lenMin: 0.1, lenMax: 0.5, widthMin: 0.004, widthMax: 0.016, startBand: [0.2, 0.95] });
  const pebbles = pebbleField(res, { seed: seed + 113, scales: [{ cells: 60, amp: 0.5 }, { cells: 110, amp: 0.2 }] });

  // Form-tie holes on a regular sub-grid — the giveaway detail of precast concrete.
  const ties = new Float32Array(N);
  const tieCols = 4;
  const tieRows = 4;
  const rTie = res * 0.014;
  for (let ty = 0; ty < tieRows; ty++) {
    for (let tx = 0; tx < tieCols; tx++) {
      const cx = ((tx + 0.5) / tieCols) * res;
      const cy = ((ty + 0.5) / tieRows) * res;
      const r0 = Math.ceil(rTie * 2.2);
      for (let dy = -r0; dy <= r0; dy++) {
        const yy = ((((cy + dy) | 0) % res) + res) % res;
        const row = yy * res;
        for (let dx = -r0; dx <= r0; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy) / rTie;
          if (d > 2.2) continue;
          const xx = ((((cx + dx) | 0) % res) + res) % res;
          const v = 1 - smoothstep(0.72, 1.02, d);
          const i = row + xx;
          if (v > ties[i]) ties[i] = v;
        }
      }
    }
  }
  // Rust bleeds out of the tie holes and runs down the face — tied to the holes themselves,
  // not scattered as free-floating streaks, because a stain without a source reads as paint.
  const tieBleed = bleedField(ties, res, { run: 0.05, spread: res * 0.009, seed: seed + 151 });
  const macroL = macroField(res, seed + 157);
  // Lime weeps out of the panel joints and the tie holes and dries as salt on the face below.
  const weepSrc = new Float32Array(N);
  for (let i = 0; i < N; i++) weepSrc[i] = clamp01(grid.groove[i] * 0.7 + ties[i] * 0.6);
  const efflo = blurField(bleedField(weepSrc, res, { run: 0.04, spread: res * 0.008, seed: seed + 163 }), res, Math.max(1, (res * 0.004) | 0), 1);

  const lit = C.concreteLit;
  const stained = C.concreteStained;
  const cool = C.concreteShadow;
  const rust = C.rust;
  const saltC = sat(mixc(C.dust, C.plaster, 0.5), 0.35);

  for (let i = 0; i < N; i++) {
    const joint = grid.groove[i];
    const boardJoint = boardLines.groove[i] * 0.35;
    const mL = macroL[i];
    let hv = 0.6 + (blotch[i] - 0.5) * 0.16 + (board[i] - 0.5) * 0.1 + (grain[i] - 0.5) * 0.07 + (pebbles[i] - 0.5) * 0.05;
    hv += (mL - 0.5) * 0.08;
    hv -= joint * 0.5;
    hv -= boardJoint * 0.25;
    hv -= ties[i] * 0.55;
    hv -= chips.chip[i] * 0.18;
    hv += chips.lip[i] * 0.05;
    hv += efflo[i] * 0.025;
    ctx.h[i] = clamp01(hv);

    ctx.ar[i] = lit[0];
    ctx.ag[i] = lit[1];
    ctx.ab[i] = lit[2];
    // Panels are cast in batches, so each panel carries a slightly different cement tone.
    const panelTone = grid.id[i];
    tint(ctx, i, lerp(0.88, 1.09, panelTone));
    // Macro layer at ~1/16 the detail frequency: which end of the panel run stayed dry.
    tint(ctx, i, lerp(0.82, 1.17, mL));
    // Cement is a mottled, speckled material at every scale. A precast panel that is one
    // flat grey is the most obviously fake thing a scene can contain, so all four scales of
    // variation go into the albedo, not just the height.
    tint(ctx, i, lerp(0.88, 1.1, mottle[i]));
    tint(ctx, i, lerp(0.94, 1.06, grain[i]));
    tint(ctx, i, lerp(0.95, 1.05, speck[i]));
    tint(ctx, i, lerp(0.9, 1.06, board[i]));
    paint(ctx, i, stained, clamp01(blotch[i] * 0.85 - 0.1) * 0.7);
    paint(ctx, i, shade(stained, 0.82), clamp01(stains[i] - 0.5) * 0.55);
    paint(ctx, i, sat(shade(lit, 0.82), 0.6), smoothstep(0.7, 0.95, pebbles[i]) * 0.4);
    paint(ctx, i, shade(cool, 1.0), streaks[i] * 0.45);
    paint(ctx, i, mixc(rust, stained, 0.45), clamp01(tieBleed[i] * 1.3 - ties[i] * 0.5) * 0.6);
    paint(ctx, i, saltC, clamp01(efflo[i] * 1.3) * 0.55);
    paint(ctx, i, shade(cool, 0.7), joint * 0.85);
    paint(ctx, i, shade(cool, 0.6), ties[i] * 0.9);
    // Chipped corners expose the raw, paler aggregate core — which is itself aggregate, so
    // it inherits the pebble field rather than being a flat cut-out.
    paint(ctx, i, mixc(lit, C.gravel, lerp(0.25, 0.7, pebbles[i])), chips.chip[i] * 0.8);

    const l = lum(ctx, i);
    // A precast mould face is genuinely smooth, so this surface carries the widest roughness
    // spread in the library: 0.35 on an intact face against 0.95 in a blown-out chip.
    let r = 0.62;
    r -= smoothstep(0.6, 0.95, ctx.h[i]) * 0.2; // the mould face is smooth
    r -= smoothstep(0.55, 0.95, mL) * 0.14; // the sheltered half of the run never weathered
    r += smoothstep(0.45, 0.05, mL) * 0.12; // the exposed half is etched matte
    r += joint * 0.2;
    r += chips.chip[i] * 0.28;
    r += ties[i] * 0.14;
    r += clamp01(efflo[i] * 1.3) * 0.16;
    r -= streaks[i] * 0.16; // a washed panel is polished where the water runs
    r += (l - 0.45) * 0.08;
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* --- asphalt: bitumen matrix, dense aggregate, oil, cracks ---------------- */
function bAsphalt(ctx) {
  const { res, N, seed } = ctx;
  const aggIds = new Float32Array(N);
  // Four grades of aggregate, not one. A wearing course is a graded mix: the odd 20 mm stone
  // sitting proud, a dense 10 mm skeleton, and fines filling between them. A single Worley
  // scale gives one stone size everywhere, which is the tell of procedural tarmac.
  const agg = pebbleField(res, {
    seed: seed + 7,
    ids: aggIds,
    scales: [
      { cells: 16, amp: 0.3 },
      { cells: 34, amp: 0.5 },
      { cells: 62, amp: 0.28 },
      { cells: 120, amp: 0.15 },
    ],
  });
  const grain = fbmField(res, { seed: seed + 23, freq: 40, octaves: 4 });
  const blotch = blotchField(res, seed + 43, 2);
  const wear = blotchField(res, seed + 59, 3);
  const macroL = macroField(res, seed + 61);
  // Primary fatigue cracking: walkers that run, fork and stop. Roads crack from a defect
  // outwards, and the branches are always finer than the trunk.
  const cracks = fractureField(res, {
    seed: seed + 71,
    count: 11,
    width: 0.0032,
    length: 0.5,
    branch: 0.016,
    gens: 2,
    wander: 0.42,
    driftFreq: 5,
    gateFreq: 3,
    gateLo: 0.3,
    gateHi: 0.6,
  });
  // Alligator cracking, the one place a cell network is the *correct* model: once a wheel
  // path has fatigued through, the surface really does break into interlocking blocks. Held
  // to the wheel path by its own density mask so it never covers the whole slab.
  const gator = crackField(res, {
    seed: seed + 73,
    cells: 13,
    width: 0.05,
    warp: 0.05,
    segFreq: 16,
    segLo: 0.3,
    segHi: 0.6,
    densityFreq: 4,
    densityLo: 0.66,
    densityHi: 0.9,
  });
  const oil = blotchField(res, seed + 149, 5);

  /*
   * A patched repair. Utilities dig a road up and the gang lays a fresh square of wearing
   * course back in it: darker, finer, smoother, and — the part that actually sells it — cut
   * off along a hard edge with a bead of sealant tar run along the joint. Every real yard has
   * one, and no amount of noise will ever produce a straight-ish cut.
   */
  // Built at a quarter resolution and upscaled BEFORE the threshold, not after: the field is
  // low frequency by construction, and thresholding the interpolated field is what keeps the
  // cut edge one texel wide at full resolution instead of a stair.
  const pres = Math.min(res, 256);
  const patchLo = warpField(
    blotchField(pres, seed + 181, 2),
    pres,
    fbmField(pres, { seed: seed + 183, freq: 9, octaves: 3 }),
    fbmField(pres, { seed: seed + 187, freq: 9, octaves: 3 }),
    pres * 0.02
  );
  const patchF = pres === res ? patchLo : upsampleField(patchLo, pres, res);
  const patch = new Float32Array(N);
  const patchSeam = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const d = patchF[i] - 0.6;
    patch[i] = smoothstep(0.0, 0.012, d);
    // The sealant bead straddles the cut, proud of both surfaces.
    patchSeam[i] = 1 - smoothstep(0.006, 0.03, Math.abs(d));
  }

  const base = C.asphalt;
  const stone = C.gravel;
  const dustC = C.dust;

  for (let i = 0; i < N; i++) {
    const crack = clamp01(cracks[i] + gator[i] * 0.75);
    const pat = patch[i];
    const seam = patchSeam[i];
    const mL = macroL[i];
    const tarRich = pat; // fresh patch: smoother, blacker, finer aggregate
    let hv = 0.5 + (agg[i] - 0.5) * (0.5 - tarRich * 0.32) + (grain[i] - 0.5) * 0.1 + (blotch[i] - 0.5) * 0.1;
    hv += (mL - 0.5) * 0.12;
    hv += seam * 0.1; // the bead stands proud
    hv -= crack * 0.45;
    ctx.h[i] = clamp01(hv);

    ctx.ar[i] = base[0];
    ctx.ag[i] = base[1];
    ctx.ab[i] = base[2];
    // The macro layer: bleached, oxidised bitumen at one end of the tile against black,
    // fatter binder at the other. Asphalt greys as it ages, so this is a large swing.
    tint(ctx, i, lerp(0.72, 1.28, mL));
    // Aggregate pokes through where the bitumen has worn away. Tight threshold so only the
    // stone crowns show, per-stone tone from the cell id, and never brighter than a wet
    // pebble — pale clumps here read as spilled cement, not as a road.
    const exposed = smoothstep(0.74, 0.96, agg[i]) * (1 - tarRich * 0.85) * (0.3 + wear[i] * 0.8) * (0.45 + mL * 0.9);
    paint(ctx, i, shade(sat(stone, 0.5), lerp(0.5, 0.92, aggIds[i])), clamp01(exposed) * 0.62);
    paint(ctx, i, dustC, clamp01(wear[i] - 0.62) * 0.26);
    paint(ctx, i, shade(base, 0.62), tarRich * 0.55);
    paint(ctx, i, shade(base, 0.4), seam * 0.8); // sealant is blacker than the road
    paint(ctx, i, shade(base, 0.5), crack * 0.8);
    tint(ctx, i, lerp(0.9, 1.1, grain[i]));

    const l = lum(ctx, i);
    // Oil: dark, and much smoother than the surrounding aggregate. Reads as wet.
    const oily = smoothstep(0.78, 0.95, oil[i]);
    paint(ctx, i, shade(base, 0.42), oily * 0.85);
    // Water stands in the rut a lorry has pressed into the wearing course. Near-mirror, and
    // under a raking key it is the brightest thing on the ground.
    const rut = smoothstep(0.72, 0.96, wear[i]) * (1 - smoothstep(0.34, 0.6, ctx.h[i]));
    let r = 0.9;
    r -= tarRich * 0.26;
    r -= oily * 0.5;
    r -= seam * 0.3; // fresh sealant tar is glossy
    r -= smoothstep(0.6, 0.95, wear[i]) * 0.14; // tyre-polished bands
    r += (0.5 - mL) * 2.0 * 0.14; // oxidised bitumen is chalk, fresh binder is satin
    r += crack * 0.06;
    r += (l - 0.2) * 0.2; // paler exposed stone is rougher than the bitumen
    r = lerp(r, 0.06, rut * 0.85);
    tint(ctx, i, lerp(1.0, 0.66, rut));
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* --- rubble: shattered concrete chunks with dust and dirt fill ------------ */
function bRubble(ctx) {
  const { res, N, seed } = ctx;
  const chunkIds0 = new Float32Array(N);
  const chunks0 = worleyField(res, { cx: 9, seed: seed + 3, jitter: 1, mode: 0, ids: chunkIds0 });
  const edges0 = worleyField(res, { cx: 9, seed: seed + 3, jitter: 1, mode: 1 });
  // Heavy domain warp on the chunk field. Raw Worley cells are convex polygons of similar
  // size, which reads as crazy paving; warping breaks them into the concave, wildly uneven
  // lumps that a slab actually shatters into.
  const rwx = fbmField(res, { seed: seed + 5, freq: 7, octaves: 4 });
  const rwy = fbmField(res, { seed: seed + 9, freq: 7, octaves: 4 });
  const chunks = warpField(chunks0, res, rwx, rwy, res * 0.075);
  const edges = warpField(edges0, res, rwx, rwy, res * 0.075);
  const chunkIds = warpField(chunkIds0, res, rwx, rwy, res * 0.075);
  const sub = worleyField(res, { cx: 22, seed: seed + 17, jitter: 1, mode: 0 });
  const grain = fbmField(res, { seed: seed + 31, freq: 24, octaves: 5 });
  const dustF = blotchField(res, seed + 47, 3);
  const dirt = fbmField(res, { seed: seed + 61, freq: 6, octaves: 4 });
  // A fracture face through concrete cuts the aggregate as well as the matrix, so the broken
  // faces have to show stone. Without it a shattered slab has clean unbroken edges and reads
  // as laser-cut rather than broken.
  const aggIds = new Float32Array(N);
  const agg = pebbleField(res, { seed: seed + 83, ids: aggIds, scales: [{ cells: 64, amp: 0.55 }, { cells: 122, amp: 0.22 }] });
  const macroL = macroField(res, seed + 97);

  const lit = C.concreteLit;
  const stained = C.concreteStained;
  const dirtC = C.dirt;
  const dustC = C.dust;
  const cool = C.concreteShadow;

  for (let i = 0; i < N; i++) {
    // Chunks are faceted, not rounded: hold the height nearly flat across the cell then drop
    // hard at the boundary. Broken concrete has planar fracture faces.
    const facet = 1 - smoothstep(0.0, 0.55, chunks[i]);
    const seam = 1 - smoothstep(0.0, 0.09, edges[i]);
    let hv = 0.3 + facet * 0.45 + (1 - smoothstep(0.1, 0.6, sub[i])) * 0.14 + (grain[i] - 0.5) * 0.12;
    hv -= seam * 0.36;
    ctx.h[i] = clamp01(hv);

    const mL = macroL[i];
    const tone = lerp(0.78, 1.12, chunkIds[i]);
    ctx.ar[i] = lit[0] * tone;
    ctx.ag[i] = lit[1] * tone;
    ctx.ab[i] = lit[2] * tone;
    // Macro layer: one part of a rubble pile is fresh and pale, the next has been rained on
    // for months. Without it a big pile is one grey mass however varied the chunks are.
    tint(ctx, i, lerp(0.76, 1.22, mL));
    paint(ctx, i, stained, dirt[i] * 0.5);
    paint(ctx, i, dirtC, clamp01(seam * 1.1 + (dirt[i] - 0.6)) * 0.55);
    paint(ctx, i, dustC, clamp01(dustF[i] - 0.35) * 0.5);
    paint(ctx, i, shade(cool, 0.75), seam * 0.5);
    tint(ctx, i, lerp(0.88, 1.1, grain[i]));
    // Cut aggregate on the fracture faces: brighter, per-stone toned, only where the chunk
    // has actually broken (the seam band), never on the cast top face.
    const cut = smoothstep(0.45, 0.9, agg[i]) * smoothstep(0.15, 0.6, seam);
    paint(ctx, i, sat(shade(lit, lerp(0.72, 1.22, aggIds[i])), lerp(0.5, 1.0, aggIds[i])), cut * 0.6);

    const l = lum(ctx, i);
    // Three distinct sheens, not one: the surviving cast skin is comparatively smooth, the
    // fresh fracture face is raw aggregate and as rough as concrete gets, and the dust that
    // has settled between the chunks is rougher again.
    const castFace = smoothstep(0.5, 0.92, facet);
    let r = 0.98;
    r -= castFace * 0.3;
    r -= smoothstep(0.5, 0.9, ctx.h[i]) * 0.16;
    r += seam * 0.05;
    r += cut * 0.08;
    r -= smoothstep(0.55, 0.95, dustF[i]) * 0.16;
    r += (0.5 - mL) * 2.0 * 0.12;
    r += (grain[i] - 0.5) * 0.12;
    r -= (l - 0.4) * 0.18;
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* --- brickPainted: running bond, painted over, paint failing -------------- */
function bBrickPainted(ctx) {
  const { res, N, seed } = ctx;
  // ~208 x 69 mm bricks at a 2.5 m tile. 12 x 36 keeps the bond period exact so it tiles.
  const bond = gridField(res, { cols: 12, rows: 36, stagger: 0.5, gap: 0.0022, chamfer: 0.0035, seed: seed + 3, jitter: 0.008, wobble: 0.0022, wobbleFreq: 11 });
  const brickTex = fbmField(res, { seed: seed + 19, freq: 40, octaves: 4 });
  const mortarTex = fbmField(res, { seed: seed + 29, freq: 80, octaves: 3 });
  const brickSpeck = fbmField(res, { seed: seed + 31, freq: 170, octaves: 2 });
  const paintNoise = fbmField(res, { seed: seed + 37, freq: 5, octaves: 4 });
  const chips = chipField(res, { seed: seed + 53, freq: 9, threshold: 0.66, warp: 0.045 });
  const chips2 = chipField(res, { seed: seed + 59, freq: 22, threshold: 0.74, warp: 0.02 });
  const streaks = streakField(res, { seed: seed + 67, count: 30, lenMin: 0.12, lenMax: 0.6, widthMin: 0.005, widthMax: 0.022 });
  const efflor = fbmField(res, { seed: seed + 79, freq: 7, octaves: 4 });
  const blotch = blotchField(res, seed + 97, 2);
  const spall = worleyField(res, { cx: 14, seed: seed + 103, jitter: 1, mode: 0 });
  const macroL = macroField(res, seed + 107);
  // Where the pointing has gone. Lime mortar erodes in patches — a wall does not lose its
  // joints uniformly, it loses them on the weather side and around anything that drips.
  const mortarLoss = fbmField(res, { seed: seed + 109, freq: 5, octaves: 4 });
  /*
   * Salt bloom. Ground water rises through a wall and dries out of the face, leaving lime on
   * the brick — always heaviest low down and always strongest at the joints, because the
   * mortar is the porous path. The low-v bias is deliberately soft rather than a hard band:
   * the tile repeats vertically up the elevation, and a hard rising-damp line would print a
   * visible stripe every 2.5 m.
   */
  const bloomSrc = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = ((i / res) | 0) / res;
    bloomSrc[i] = clamp01(bond.groove[i] * smoothstep(0.25, 0.72, efflor[i])) * lerp(1.0, 0.42, v);
  }
  const bloom = blurField(bleedField(bloomSrc, res, { run: 0.05, spread: res * 0.012, seed: seed + 113 }), res, Math.max(1, (res * 0.005) | 0), 2);

  const paintC = C.brickPainted;
  const brickC = C.brick;
  const mortarC = mixc(C.plaster, C.concreteStained, 0.45);
  const dustC = C.dust;
  const cool = C.concreteShadow;
  const saltC = sat(mixc(dustC, C.plaster, 0.55), 0.3);

  for (let i = 0; i < N; i++) {
    const joint = bond.groove[i];
    const mL = macroL[i];
    /*
     * A struck joint is a wedge, not a slot: the bricklayer cuts the mortar back under the
     * brick above and irons it flush at the brick below so the course sheds water. Driving
     * the depth off the sub-cell vertical fraction gives that asymmetry, and it is the
     * difference between brickwork and a grid of tiles with grout lines.
     */
    const struck = joint * lerp(0.55, 1.3, bond.sv[i]);
    // Then take the pointing out altogether in patches. A raked-out joint is a deep shadow
    // line and the strongest read on any old wall under a low sun.
    const raked = joint * smoothstep(0.58, 0.86, mortarLoss[i]) * (0.4 + mL * 0.9);
    // Paint survives on the flat faces and fails first at the arrises and over the mortar,
    // so the failure threshold is lowered locally rather than the chip mask being scaled —
    // scaling a hard-edged mask just makes it grey, biasing the threshold makes it spread.
    const failBias = joint * 0.5 + bond.chamfer[i] * 0.4 + clamp01(1 - blotch[i]) * 0.3;
    const th = 0.68 - failBias * 0.1;
    const chip = clamp01(
      smoothstep(th, th + 0.015, chips.field[i]) + smoothstep(0.76 - failBias * 0.06, 0.78, chips2.field[i]) * 0.55
    );
    const spallMask = (1 - smoothstep(0.05, 0.3, spall[i])) * smoothstep(0.62, 0.86, paintNoise[i]);

    let hv = 0.62 + (brickTex[i] - 0.5) * 0.1 + (blotch[i] - 0.5) * 0.08;
    hv += (mL - 0.5) * 0.07;
    hv -= struck * 0.46;
    hv -= raked * 0.3; // the pointing has gone entirely here
    hv += bond.chamfer[i] * 0.03;
    hv -= chip * 0.06; // paint film is thin: the chip is a shallow step, not a crater
    hv += chips.lip[i] * 0.035;
    hv -= spallMask * 0.22; // spalled brick face is a real crater
    hv += (mortarTex[i] - 0.5) * joint * 0.12;
    hv += bloom[i] * 0.02; // salt is a deposit and sits proud of the face
    // Slight per-brick height variation so the wall is not a perfect plane.
    hv += (bond.id[i] - 0.5) * 0.045 * (1 - joint);
    ctx.h[i] = clamp01(hv);

    // Substrate first: brick + mortar, then paint over the top, then take the paint away.
    // Fired clay varies hugely brick to brick and within a brick — flat bricks are the tell.
    const brickTone = lerp(0.7, 1.22, bond.id[i]);
    let base = shade(brickC, brickTone);
    base = mixc(base, sat(brickC, 0.45), brickTex[i] * 0.55);
    base = shade(base, lerp(0.9, 1.1, brickSpeck[i]));
    // A few bricks in any wall are badly over- or under-fired.
    if (bond.id[i] > 0.93) base = mixc(base, shade(C.gunRubber, 1.5), 0.35);
    else if (bond.id[i] < 0.07) base = mixc(base, C.sandbag, 0.4);
    // Mortar is a different material from the brick, and where it has weathered back it goes
    // paler, sandier and coarser as the fines wash out of it.
    let mort = mortarC;
    mort = mixc(mort, sat(shade(mortarC, 1.08), 0.55), smoothstep(0.5, 0.9, mortarLoss[i]));
    const sub = mixc(base, mort, joint);
    ctx.ar[i] = sub[0];
    ctx.ag[i] = sub[1];
    ctx.ab[i] = sub[2];
    // The macro layer: which end of the elevation caught the weather. On a painted wall this
    // is mostly a bleaching of the topcoat, so it is applied before the paint and again after.
    tint(ctx, i, lerp(0.85, 1.14, mL));
    // Paint layer.
    const paintCover = clamp01(1 - chip) * (1 - spallMask * 0.85) * lerp(0.72, 1.0, mL);
    paint(ctx, i, mixc(paintC, shade(paintC, lerp(0.9, 1.08, paintNoise[i])), 0.8), paintCover * 0.94);
    // Weathering on top of the paint.
    paint(ctx, i, shade(cool, 1.0), streaks[i] * 0.45 * paintCover);
    // Salt bloom: out of the joints, running down the face, heaviest at the base of the wall.
    paint(ctx, i, saltC, clamp01(bloom[i] * 1.5) * 0.6);
    paint(ctx, i, dustC, clamp01(efflor[i] - 0.62) * 0.4);
    paint(ctx, i, shade(cool, 0.72), joint * 0.35);
    paint(ctx, i, shade(cool, 0.6), raked * 0.5); // a raked joint is mostly shadow
    tint(ctx, i, lerp(0.93, 1.05, mortarTex[i]));

    const l = lum(ctx, i);
    // Paint is smoother than what is under it; where it has gone, roughness jumps.
    let r = lerp(0.86, 0.48, paintCover);
    r += joint * 0.12;
    r += raked * 0.14; // weathered mortar is the roughest thing on the wall
    r += spallMask * 0.16;
    r += clamp01(bloom[i] * 1.4) * 0.16; // salt crust is chalk
    r -= streaks[i] * 0.12; // washed paint is polished where the water runs
    r += (0.5 - mL) * 2.0 * 0.1; // the weather side has lost its sheen
    r += (l - 0.5) * 0.1;
    r += (brickTex[i] - 0.5) * 0.06;
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* --- metalPainted: industrial enamel over steel, scratched and chipped ---- */
function bMetalPainted(ctx) {
  const { res, N, seed } = ctx;
  const orange = fbmField(res, { seed: seed + 3, freq: 60, octaves: 4, gain: 0.5 }); // orange peel
  const dents = fbmField(res, { seed: seed + 13, freq: 5, octaves: 3 });
  const chips = chipField(res, { seed: seed + 23, freq: 11, threshold: 0.7, warp: 0.035 });
  const chipsFine = chipField(res, { seed: seed + 29, freq: 30, threshold: 0.76, warp: 0.015 });
  const scratches = scratchField(res, { seed: seed + 41, count: 320, angle: 0.35, spread: 0.5, lenMin: 0.02, lenMax: 0.22, width: 0.0016 });
  const scratchesFine = scratchField(res, { seed: seed + 43, count: 700, angle: 1.1, spread: 0.9, lenMin: 0.006, lenMax: 0.05, width: 0.0009 });
  // Mill grain telegraphs through a thin industrial enamel — one coat of paint does not
  // fill a rolled finish, and the directional sheen is what says "steel" under the colour.
  const mill = scratchField(res, { seed: seed + 47, count: 420, angle: 0.0, spread: 0.03, lenMin: 0.25, lenMax: 0.95, width: 0.001 });
  const grime = blotchField(res, seed + 61, 3);
  const streaks = streakField(res, { seed: seed + 71, count: 18, lenMin: 0.1, lenMax: 0.45, widthMin: 0.004, widthMax: 0.014 });
  const macroL = macroField(res, seed + 73);
  // A weld seam running across the plate — a proper fabricated-steel tell.
  const weld = new Float32Array(N);
  const weldY = res * 0.62;
  const weldWob = fbmField(res, { seed: seed + 83, freq: 12, octaves: 3, stretch: 1 / 8 });
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x;
      const yy = weldY + (weldWob[i] - 0.5) * res * 0.012;
      let d = Math.abs(y - yy);
      d = Math.min(d, res - d) / (res * 0.012);
      // Stacked-dime bead ripple along the seam.
      const ripple = 0.5 + 0.5 * Math.sin((x / res) * Math.PI * 2 * 46 + weldWob[i] * 6);
      weld[i] = (1 - smoothstep(0.6, 1.0, d)) * (0.72 + ripple * 0.28);
    }
  }

  const paintC = C.steelPainted;
  const primer = mixc(C.rust, C.hazardYellow, 0.35);
  const bare = C.steelBare;
  const dirtC = C.dirt;

  for (let i = 0; i < N; i++) {
    const mL = macroL[i];
    // Paint fails first where the weather got at it. Biasing the chip threshold by the macro
    // layer means one half of the plate is intact and the other is going, which is what a
    // painted structure actually looks like — never an even scatter of chips.
    const failBias = smoothstep(0.3, 0.8, mL) * 0.06 + weld[i] * 0.05;
    const chip = clamp01(
      smoothstep(0.7 - failBias, 0.715 - failBias, chips.field[i]) * 0.85 + chipsFine.chip[i] * 0.5
    );
    // Only the middle of the larger chips has taken the primer off as well as the topcoat.
    const chipCore = smoothstep(0.8, 0.82, chips.field[i]);
    const scr = clamp01(scratches[i] * 0.9 + scratchesFine[i] * 0.6);
    const deep = clamp01(scr - 0.55) * 2.2; // only the hard scratches cut to bare metal
    // Corrosion creeps out from under the coating at the chip edge and at the weld, which is
    // where the film is thinnest. It never starts in the middle of an intact panel.
    const creep = clamp01(chips.lip[i] * 1.3 + chipCore * 0.8 + weld[i] * 0.35) * smoothstep(0.35, 0.85, mL);

    let hv = 0.55 + (dents[i] - 0.5) * 0.34 + (orange[i] - 0.5) * 0.12;
    hv += weld[i] * 0.16;
    hv += mill[i] * 0.01;
    hv += (mL - 0.5) * 0.06;
    hv -= chip * 0.05;
    hv += chips.lip[i] * 0.03;
    hv -= scr * 0.02;
    ctx.h[i] = clamp01(hv);

    ctx.ar[i] = paintC[0];
    ctx.ag[i] = paintC[1];
    ctx.ab[i] = paintC[2];
    tint(ctx, i, lerp(0.94, 1.05, dents[i]));
    // Sun-chalked on one side of the panel run, still saturated in the lee. Enamel loses its
    // pigment long before it loses its film.
    paint(ctx, i, sat(shade(paintC, 1.16), 0.55), smoothstep(0.42, 0.95, mL) * 0.42);
    tint(ctx, i, lerp(0.88, 1.1, mL));
    // Chip reveals primer first, then bare metal in the middle of the bigger chips.
    paint(ctx, i, primer, chip * 0.8);
    paint(ctx, i, bare, chipCore * 0.7);
    paint(ctx, i, shade(bare, 1.05), deep * 0.75);
    paint(ctx, i, shade(bare, 1.16), mill[i] * 0.18); // the lay reads through the film
    paint(ctx, i, shade(paintC, 0.88), weld[i] * 0.5);
    paint(ctx, i, mixc(C.rust, C.rustDeep, 0.4), creep * 0.6);
    paint(ctx, i, dirtC, clamp01(grime[i] - 0.5) * 0.35);
    paint(ctx, i, shade(dirtC, 0.7), streaks[i] * 0.4);

    const l = lum(ctx, i);
    // Worn HIGH points on metal go smoother (burnished), painted areas stay satin, chips and
    // primer are matte. This is the single most legible material cue on painted steel.
    let r = 0.46;
    r += (orange[i] - 0.5) * 0.1;
    r -= deep * 0.26;
    r -= mill[i] * 0.06;
    r -= smoothstep(0.72, 0.95, ctx.h[i]) * 0.1;
    r -= smoothstep(0.55, 0.05, mL) * 0.14; // the sheltered half still has its gloss
    r += smoothstep(0.45, 0.95, mL) * 0.16; // the weather side has chalked right off
    r += chip * 0.24;
    r += creep * 0.2;
    r += clamp01(grime[i] - 0.5) * 0.18;
    r -= streaks[i] * 0.05; // rain-washed runs are polished, not roughened
    r -= (l - 0.35) * 0.06;
    ctx.rg[i] = clamp01(r);
    // Only the exposed steel is metallic. Paint is a dielectric — getting this wrong is the
    // fastest way to make painted metal look like foil — and so is the oxide creeping out of
    // the chip edges, so the creep has to take the metalness back off again.
    ctx.mt[i] = clamp01((deep * 0.9 + chipCore * 0.85) * (1 - creep * 0.8));
  }
}

/* --- metalRust: the hero corrosion surface -------------------------------- */
function bMetalRust(ctx) {
  const { res, N, seed } = ctx;
  const grain = fbmField(res, { seed: seed + 149, freq: 30, octaves: 5, gain: 0.55 });
  const speck = fbmField(res, { seed: seed + 151, freq: 150, octaves: 2 });
  // Mill grain: hot-rolled plate carries a strong directional lay from the rolls, and it is
  // the reason bare steel has an anisotropic sheen instead of reading as grey plastic. Two
  // passes, a fine one and a coarser scored one, both along the rolling direction.
  const mill = scratchField(res, { seed: seed + 163, count: 900, angle: 0.0, spread: 0.035, lenMin: 0.2, lenMax: 0.95, width: 0.0007 });
  const millCoarse = scratchField(res, { seed: seed + 167, count: 160, angle: 0.0, spread: 0.05, lenMin: 0.3, lenMax: 1.0, width: 0.0022 });
  const streaks = streakField(res, { seed: seed + 179, count: 36, lenMin: 0.15, lenMax: 0.75, widthMin: 0.004, widthMax: 0.02 });
  const blotch = blotchField(res, seed + 191, 2);
  const grime = blotchField(res, seed + 193, 5);
  const dents = fbmField(res, { seed: seed + 197, freq: 4, octaves: 3 });
  const macroL = macroField(res, seed + 199);

  /*
   * Fabrication first, corrosion second — because corrosion is a *consequence* of the
   * fabrication. A plate has cut edges, a weld across it, and a line of bolts through it, and
   * every one of those is where the mill scale is broken and the water is held. Building the
   * fixings and the seams up front lets the rust field be told where to nucleate instead of
   * being scattered at random, which is the whole difference between rust and orange stains.
   */
  const rivets = discField(res, { cols: 6, rows: 2, radius: 0.0125, jitter: 0.22, dropout: 0.12, rim: 2.1, seed: seed + 211 });
  const weld = new Float32Array(N);
  const weldWob = fbmField(res, { seed: seed + 223, freq: 12, octaves: 3, stretch: 1 / 8 });
  const plateEdge = new Float32Array(N);
  const weldY = res * 0.34;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x;
      const yy = weldY + (weldWob[i] - 0.5) * res * 0.014;
      let d = Math.abs(y - yy);
      d = Math.min(d, res - d) / (res * 0.011);
      // Stacked-dime bead ripple along the seam: a weld is a row of overlapping puddles.
      const ripple = 0.5 + 0.5 * Math.sin((x / res) * Math.PI * 2 * 52 + weldWob[i] * 6);
      weld[i] = (1 - smoothstep(0.55, 1.0, d)) * (0.7 + ripple * 0.3);
      // The plate's own cut edges, i.e. the tile borders. A 2 m tile is one plate module, so
      // this reads as the sheared edge of the plate — exactly where rust starts on real steel.
      const eu = Math.min(x, res - 1 - x) / res;
      const ev = Math.min(y, res - 1 - y) / res;
      plateEdge[i] = 1 - smoothstep(0.0, 0.045, Math.min(eu, ev));
    }
  }
  // Water paths: whatever runs down the plate carries the oxide with it and keeps the steel
  // under it wet, so the run is both a stain and a nucleation site.
  const waterPath = bleedField(streaks, res, { run: 0.14, spread: res * 0.006, seed: seed + 227 });
  const nucleate = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    nucleate[i] = clamp01(
      plateEdge[i] * 0.9 + weld[i] * 0.7 + rivets.mask[i] * 0.8 + rivets.rim[i] * 0.9 + waterPath[i] * 0.55 + smoothstep(0.4, 0.85, macroL[i]) * 0.35
    );
  }
  const rust = rustField(res, { seed, cells: 6, coverage: 0.42, warp: 0.1, bias: nucleate, biasAmt: 1.15 });
  const rust2 = rustField(res, { seed: seed + 777, cells: 13, coverage: 0.28, warp: 0.06, bias: nucleate, biasAmt: 0.9 });
  const pitting = pitField(res, { cells: 52, seed: seed + 131, density: 0.45, sizeMin: 0.1, sizeMax: 0.4 });

  // Weathered structural steel is darker and more neutral than bright mill stock.
  const bare = mixc(C.steelBare, C.gunmetal, 0.22);
  const rustC = C.rust;
  const deepC = C.rustDeep;
  const dustC = C.dust;
  const dirtC = C.dirt;

  for (let i = 0; i < N; i++) {
    const core = clamp01(rust.core[i] * 0.85 + rust2.core[i] * 0.55);
    const halo = clamp01(rust.halo[i] * 0.9 + rust2.halo[i] * 0.5);
    const scale = clamp01(rust.scale[i] + rust2.scale[i] * 0.6);
    const pit = pitting[i] * core;
    const run = clamp01(clamp01(streaks[i] * 0.8 + waterPath[i] * 0.5) * (0.35 + halo * 0.9));
    const rivet = rivets.mask[i];
    const wl = weld[i];
    const millAll = clamp01(mill[i] * 0.85 + millCoarse[i] * 0.5);

    // Rust occupies more volume than the steel it came from — the scale stands proud, the
    // pits it leaves behind eat in. Both, not one or the other.
    let hv = 0.55 + (dents[i] - 0.5) * 0.18 + (grain[i] - 0.5) * 0.08;
    hv += wl * 0.14; // the bead stands proud of the parent plate
    hv += rivet * 0.16 - rivets.rim[i] * 0.02; // dome head, slight draw-in around it
    hv += scale * 0.2;
    hv += core * 0.06;
    hv -= pit * 0.3;
    hv += millAll * 0.014;
    ctx.h[i] = clamp01(hv);

    ctx.ar[i] = bare[0];
    ctx.ag[i] = bare[1];
    ctx.ab[i] = bare[2];
    // Bare steel is never a flat swatch: rolling grain, mill scoring, airborne grime. Get
    // this wrong and the clean areas read as untextured plastic next to the rust.
    tint(ctx, i, lerp(0.86, 1.1, blotch[i]));
    tint(ctx, i, lerp(0.88, 1.09, grain[i]));
    tint(ctx, i, lerp(0.95, 1.05, speck[i]));
    tint(ctx, i, lerp(0.84, 1.16, macroL[i])); // the macro layer, decisive on a big plate
    paint(ctx, i, shade(bare, 1.2), millAll * 0.4);
    paint(ctx, i, shade(bare, 0.88), wl * 0.45); // weld metal is darker than the parent
    paint(ctx, i, shade(bare, 1.12), rivet * 0.5);
    paint(ctx, i, mixc(dirtC, bare, 0.45), clamp01(grime[i] - 0.45) * 0.4);
    paint(ctx, i, mixc(bare, rustC, 0.55), halo * 0.6); // light oxide bloom

    // Rust is never one colour. Build the oxide tone per pixel across three scales of noise
    // — bright ochre where it is thin and fresh, red-brown in the body, near-black where the
    // scale has built up and burnt — then lay that in with the coverage mask. Painting a
    // flat rust colour and dusting noise on top is what produced orange amoebas.
    const fineD = clamp01(rust.detail[i] * 0.55 + rust.fine[i] * 0.45);
    const midD = clamp01(grain[i] * 0.7 + speck[i] * 0.3);
    let rc = mixc(mixc(rustC, C.hazardYellow, 0.22), deepC, fineD);
    rc = shade(rc, lerp(0.78, 1.22, midD));
    rc = mixc(rc, deepC, clamp01(scale * 1.2) * 0.8);
    paint(ctx, i, rc, core * 0.95);
    paint(ctx, i, shade(deepC, 0.6), pit * 0.55);
    paint(ctx, i, mixc(rustC, deepC, 0.4), run * 0.6); // rust runs stain the clean steel
    paint(ctx, i, dustC, clamp01(blotch[i] - 0.72) * 0.22);

    const l = lum(ctx, i);
    // The full spread runs 0.14 on a wiped, rain-washed plate to 0.98 on flaking scale. That
    // range is the material: a metal held near one roughness reads as painted MDF whatever
    // the albedo does.
    let r = 0.28;
    r += (grain[i] - 0.5) * 0.08;
    r -= millAll * 0.13; // rolled mill finish is directional and smooth
    r += (0.5 - macroL[i]) * 2.0 * 0.09;
    r -= smoothstep(0.55, 0.95, blotch[i]) * (1 - core) * 0.14; // rain-washed, wiped clean
    r += wl * 0.24; // weld metal and its heat tint are matte
    r -= rivet * 0.12; // a bolt head is a hammered, polished dome
    r = lerp(r, 0.82, halo * 0.6);
    r = lerp(r, 0.9, core);
    r = lerp(r, 0.96, scale);
    r += pit * 0.06;
    r += (l - 0.3) * 0.05;
    ctx.rg[i] = clamp01(r);
    // Corrosion product is an oxide, i.e. a dielectric. Metalness must fall off with rust
    // coverage or the rust will glint like chrome and the whole material collapses.
    ctx.mt[i] = clamp01(1 - core * 0.82 - scale * 0.25 - halo * 0.22);
  }
}

/* --- corrugatedSteel: profiled sheet, rust in the valleys, fixings -------- */
function bCorrugatedSteel(ctx) {
  const { res, N, seed } = ctx;
  const RIBS = 8;
  const dents = fbmField(res, { seed: seed + 7, freq: 5, octaves: 4 });
  const grain = fbmField(res, { seed: seed + 23, freq: 40, octaves: 4 });
  const grime = blotchField(res, seed + 37, 3);
  const streaks = streakField(res, { seed: seed + 43, count: 40, lenMin: 0.2, lenMax: 0.9, widthMin: 0.003, widthMax: 0.01 });
  const macroL = macroField(res, seed + 47);

  // Fixings: two rows of hex screws with washers, each with a rust run beneath it. Built
  // before the corrosion so the corrosion can be told to start at them — a screw through a
  // galvanised sheet breaks the coating, and that penetration is where every real sheet
  // starts to go.
  const screws = new Float32Array(N);
  const washers = new Float32Array(N);
  const srnd = mulberry32(seed + 61);
  const rS = res * 0.009;
  for (let rrow = 0; rrow < 2; rrow++) {
    const cy = (rrow === 0 ? 0.24 : 0.76) * res;
    for (let k = 0; k < RIBS; k++) {
      const cx = ((k + 0.5) / RIBS) * res + (srnd() - 0.5) * 2;
      const rr = Math.ceil(rS * 4);
      for (let dy = -rr; dy <= rr; dy++) {
        const yy = ((((cy + dy) | 0) % res) + res) % res;
        const row = yy * res;
        for (let dx = -rr; dx <= rr; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy) / rS;
          const xx = ((((cx + dx) | 0) % res) + res) % res;
          const i = row + xx;
          const s = 1 - smoothstep(0.85, 1.15, d);
          const w = (1 - smoothstep(2.4, 2.8, d)) * smoothstep(0.9, 1.3, d);
          if (s > screws[i]) screws[i] = s;
          if (w > washers[i]) washers[i] = w;
        }
      }
    }
  }
  // The end lap where one sheet overlaps the next: a hard shadow line, and a capillary trap
  // that holds water between the two sheets for days after it rains.
  const lap = new Float32Array(N);
  const lapWob = fbmField(res, { seed: seed + 67, freq: 9, octaves: 3, stretch: 1 / 12 });
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x;
      const yy = res * 0.5 + (lapWob[i] - 0.5) * res * 0.006;
      const d = Math.abs(y - yy);
      lap[i] = 1 - smoothstep(res * 0.004, res * 0.012, Math.min(d, res - d));
    }
  }
  /*
   * The water line. This is the one thing a real weathered sheet has that this map did not:
   * the bottom ~300 mm of a panel sits in whatever ran down it and whatever splashed up off
   * the ground, so that is where the coating goes first and where the sheet eventually rots
   * through. It is also the strongest *horizontal* event available, which is what breaks the
   * purely vertical, purely periodic read the panel had.
   *
   * V orientation: level.js `corrugated()` emits v = 0 at y0 (the panel's bottom edge) and
   * v = h at y1, `gv` passes UVs straight through, and the maps are DataTextures (flipY is
   * false), so data row 0 IS the bottom of the panel. streakField and bleedField agree — both
   * start high in y and march towards y = 0, i.e. downhill. So the soak lives at LOW v.
   *
   * Made wrap-safe rather than one-sided. V repeats every `tile` = 2.4 m and the taller
   * panels (level.js builds a 6.4 m one) wrap ~2.7 times, so a band that is 1 at v = 0 and 0
   * at v = 1 would print a hard albedo step across every tile seam. The signed distance form
   * below feathers the top edge of the band over 1.4% of V (~34 mm) so the function is
   * continuous around the wrap and reads as the wet line under a sheet lap.
   */
  const soak = new Float32Array(N);
  for (let y = 0; y < res; y++) {
    const v = y / res;
    const d0 = v < 0.5 ? v : v - 1;
    for (let x = 0; x < res; x++) {
      const i = y * res + x;
      // Wobbled per column by the dent field so the line is a tide mark, not a ruled edge.
      const d = d0 + (dents[i] - 0.5) * 0.03;
      soak[i] = (1 - smoothstep(0, 0.16, d)) * smoothstep(-0.014, 0, d);
    }
  }

  // Nucleation map: fixings, their washers, the lap, the water paths running off them, and
  // the standing water at the foot of the sheet.
  const screwRun = bleedField(screws, res, { run: 0.11, spread: res * 0.005, seed: seed + 71 });
  const nucleate = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    nucleate[i] = clamp01(
      screws[i] * 0.6 + washers[i] * 1.0 + lap[i] * 0.85 + screwRun[i] * 0.6 + smoothstep(0.45, 0.9, macroL[i]) * 0.3 + soak[i] * 0.7,
    );
  }
  const rust = rustField(res, { seed: seed + 13, cells: 9, coverage: 0.3, warp: 0.07, bias: nucleate, biasAmt: 1.25 });

  const bare = C.steelBare;
  const painted = C.steelPainted;
  const rustC = C.rust;
  const deepC = C.rustDeep;
  const dustC = C.dust;

  for (let i = 0; i < N; i++) {
    const x = i % res;
    // Trapezoidal profile: a smoothed square wave reads as pressed sheet, a pure sine reads
    // as a wobbly blob. Blend the two.
    const ph = (x / res) * Math.PI * 2 * RIBS;
    const s = Math.sin(ph);
    const trap = clamp01(s * 1.9) * 0.5 + 0.5;
    const profile = lerp(0.5 + s * 0.5, trap, 0.65);
    const valley = 1 - profile; // rust and dirt collect in the valleys

    /*
     * Height. The rib used to own this channel (0.2 + profile * 0.62), and that was wrong
     * twice over.
     *
     * First, the rib is MODELLED — level.js `corrugated()` builds it as real geometry on
     * every panel that has one — so putting it in the height map re-states it at a pitch
     * (tile / RIBS = 2.4 / 8 = 0.30 m) that cannot match the geometry's 0.24 / 0.26 /
     * 0.28-0.30 m, which is where the moire in the wide shot comes from.
     *
     * Second, the shared ash pass consumes this channel: FRAG_ASH derives ashEdge from
     * smoothstep(0.52, 0.86, height) and its comment budgets that term at 4-30% of texels.
     * A trapezoidal wave sitting between 0.2 and 0.82 put the whole crown of every rib over
     * 0.52 — measured at 31.7% of texels firing the term at better than a quarter strength,
     * 27.9% at better than half — so edge wear stopped being wear and became a second base
     * albedo painted in vertical stripes.
     *
     * Centred near 0.5 with the manufactured detail — the fixings, the lap, the dents — as
     * the dominant signal, ashEdge now fires on those highs only. SURFACES.corrugatedSteel
     * keeps relief 0.125 / normal 1.1: the visible rib comes from the mesh, and the faint
     * 0.10 term here is only for the few panels that use this material flat.
     *
     * Measured, because the budget is the whole point of the change. With the rib removed and
     * the dent amplitude left where it was, ashEdge collapsed to 0.4% of texels and ashCavity
     * to 2.7% — i.e. the panel lost its edge wear and cavity grime outright, which is as much
     * a regression as the stripe was. The height field has to keep real *aperiodic* contrast,
     * so the dent and grain amplitudes come up to carry what the rib was carrying. At the
     * numbers below: ashEdge 31.7% -> 12.3% of texels, ashCavity 18.5% -> 8.8%, gradX
     * 0.0133 -> 0.0072 and the Y/X gradient ratio 0.17 -> 1.01, i.e. the map no longer has a
     * preferred axis at all and the ribs the eye sees are the ones the mesh actually has.
     */
    let hv = 0.51 + (profile - 0.5) * 0.1 + (dents[i] - 0.5) * 0.44 + (grain[i] - 0.5) * 0.12;
    hv += screws[i] * 0.26;
    hv -= washers[i] * 0.09;
    hv += lap[i] * 0.13; // the upper sheet stands off by its own thickness
    ctx.h[i] = clamp01(hv);

    /*
     * Wetness. Everything that weathers this sheet used to be gated on `valley`, which is a
     * pure vertical square wave — so the rust, the deep rust, the streaks, the grime, the
     * roughness and the metalness all ran as continuous full-height stripes that never broke,
     * and the panel read as a barcode rather than as steel.
     *
     * Water does collect in the valleys, but it collects far harder in a dent that holds it
     * and in the dirt film that wicks it, and it pools at the foot of the sheet. Those three
     * are aperiodic, so the mask they make has no period the eye can find, while still being
     * valley-biased where the valleys matter.
     */
    const wet = clamp01(valley * 0.4 + smoothstep(0.32, 0.8, dents[i]) * 0.45 + smoothstep(0.5, 0.9, grime[i]) * 0.25);

    const rustAmt = clamp01(rust.core[i] * (0.35 + wet * 1.1) + rust.halo[i] * wet * 0.6 + screwRun[i] * 0.35);
    const base = mixc(painted, bare, 0.35);
    ctx.ar[i] = base[0];
    ctx.ag[i] = base[1];
    ctx.ab[i] = base[2];
    tint(ctx, i, lerp(0.9, 1.08, dents[i]));
    tint(ctx, i, lerp(0.85, 1.15, macroL[i])); // one end of the run has weathered harder
    paint(ctx, i, rustC, rustAmt * 0.85);
    paint(ctx, i, deepC, clamp01(rust.scale[i] * wet * 1.4) * 0.7);
    // Rotted through at the water line. This is the horizontal event the panel was missing:
    // it terminates every vertical run at a specific height instead of letting them fall off
    // the bottom of the sheet. Weighted by the same macro band that decides which end of a
    // run weathered harder, so the rot is a tide mark with a history rather than a ruled line.
    paint(ctx, i, deepC, soak[i] * 0.45 * (0.55 + 0.45 * macroL[i]));
    paint(ctx, i, mixc(rustC, C.dirt, 0.5), streaks[i] * wet * 0.55);
    paint(ctx, i, shade(bare, 1.1), screws[i] * 0.65);
    paint(ctx, i, mixc(rustC, deepC, 0.5), washers[i] * 0.6);
    paint(ctx, i, mixc(rustC, deepC, 0.6), lap[i] * 0.5); // the capillary trap rots first
    paint(ctx, i, C.dirt, clamp01(grime[i] - 0.5) * wet * 0.5);
    // Dust settles on whatever stands proud — but keyed to the aperiodic dent field, not to
    // `profile`. The rib crowns are modelled geometry at a pitch this map cannot match, so an
    // albedo band locked to the texture's own rib is exactly the beat that made the unrusted
    // sheet in the depot read as a venetian blind. The rib survives in the height term above
    // and, softened, in the roughness below; it no longer paints a stripe.
    paint(ctx, i, dustC, clamp01(dents[i] - 0.6) * 0.5);

    const l = lum(ctx, i);
    let r = 0.4;
    r += (grain[i] - 0.5) * 0.08;
    r = lerp(r, 0.94, rustAmt);
    // Rain-washed rib crowns, broken along the rib by the dent field. Left as a roughness-only
    // cue: it is the last thing carrying the rib on the flat panels, and a gloss band reads far
    // more weakly than an albedo band, so it can stay periodic as long as it is not continuous.
    r -= smoothstep(0.55, 0.95, profile) * (0.35 + 0.65 * dents[i]) * (1 - rustAmt) * 0.16;
    r += clamp01(grime[i] - 0.5) * wet * 0.2;
    r += (0.5 - macroL[i]) * 2.0 * 0.08;
    r -= screws[i] * 0.16;
    r += (l - 0.35) * 0.06;
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = clamp01(1 - rustAmt * 0.85 - clamp01(grime[i] - 0.5) * wet * 0.4);
  }
}

/* --- woodPlank: weathered sleeper / hoarding timber ----------------------- */
function bWoodPlank(ctx) {
  const { res, N, seed } = ctx;
  const planks = gridField(res, { cols: 1, rows: 6, gap: 0.0035, chamfer: 0.007, seed: seed + 3, wobble: 0.004, wobbleFreq: 7 });
  // Grain: heavily stretched fBm along the plank, plus ridged rings for the growth pattern.
  const grainA = fbmField(res, { seed: seed + 11, freq: 6, octaves: 5, stretch: 1 / 26 });
  const grainB = fbmField(res, { seed: seed + 17, freq: 22, octaves: 4, stretch: 1 / 22, op: OP_RIDGE });
  const rings = fbmField(res, { seed: seed + 19, freq: 3, octaves: 3, stretch: 1 / 20 });
  const fibre = fbmField(res, { seed: seed + 23, freq: 70, octaves: 3, stretch: 1 / 30 });
  const knots = worleyField(res, { cx: 7, cy: 3, seed: seed + 31, jitter: 0.9, mode: 0 });
  const splits = scratchField(res, { seed: seed + 41, count: 90, angle: 0, spread: 0.02, lenMin: 0.05, lenMax: 0.35, width: 0.0014 });
  const weather = blotchField(res, seed + 53, 3);
  const streaks = streakField(res, { seed: seed + 59, count: 16, lenMin: 0.08, lenMax: 0.4, widthMin: 0.004, widthMax: 0.014 });
  const macroL = macroField(res, seed + 61);

  const wood = C.woodWeathered;
  const splinter = C.woodSplinter;
  const dirtC = C.dirt;
  const cool = C.concreteShadow;

  for (let i = 0; i < N; i++) {
    const joint = planks.groove[i];
    const knot = 1 - smoothstep(0.02, 0.16, knots[i]);
    const knotHalo = 1 - smoothstep(0.1, 0.45, knots[i]);
    // Ring pattern: modulate the stretched noise into bands.
    const ring = 0.5 + 0.5 * Math.sin((grainA[i] * 2.1 + rings[i] * 1.1) * Math.PI * 2);
    const grain = clamp01(ring * 0.55 + grainB[i] * 0.5 + (fibre[i] - 0.5) * 0.3);

    let hv = 0.58 + (grain - 0.5) * 0.2 + (weather[i] - 0.5) * 0.1;
    hv -= joint * 0.55;
    hv += planks.chamfer[i] * 0.02;
    hv -= splits[i] * 0.16; // splits open along the grain
    hv += knot * 0.06 - knotHalo * 0.04;
    hv += (planks.id[i] - 0.5) * 0.05 * (1 - joint); // planks sit at slightly different depths
    ctx.h[i] = clamp01(hv);

    const mL = macroL[i];
    const tone = lerp(0.8, 1.15, planks.id[i]);
    ctx.ar[i] = wood[0] * tone;
    ctx.ag[i] = wood[1] * tone;
    ctx.ab[i] = wood[2] * tone;
    // Macro layer: the end of a timber that sat in the wet against the end that stayed dry.
    tint(ctx, i, lerp(0.78, 1.2, mL));
    // Late wood is darker than early wood — the grain must be in the albedo, not just bump.
    paint(ctx, i, shade(wood, 0.62), grain * 0.55);
    paint(ctx, i, splinter, clamp01(1 - grain - 0.25) * 0.35);
    // UV-silvered surface: weathered timber goes grey, and it goes grey unevenly.
    paint(ctx, i, sat(mixc(splinter, cool, 0.35), 0.45), clamp01(weather[i] - 0.3) * 0.55);
    paint(ctx, i, shade(wood, 0.42), knot * 0.85);
    paint(ctx, i, shade(wood, 0.7), knotHalo * 0.35);
    paint(ctx, i, shade(wood, 0.45), joint * 0.8);
    paint(ctx, i, shade(wood, 0.55), splits[i] * 0.6);
    paint(ctx, i, dirtC, streaks[i] * 0.4);

    const l = lum(ctx, i);
    let r = 0.82;
    r += (1 - grain) * 0.06; // soft early wood erodes rougher than the hard late wood
    r -= smoothstep(0.6, 0.95, ctx.h[i]) * 0.08;
    r += joint * 0.08;
    r += splits[i] * 0.08;
    r -= knot * 0.24; // knots are resinous and noticeably glossier
    r += (0.5 - mL) * 2.0 * 0.12; // silvered where it weathered, sound where it did not
    r -= (l - 0.35) * 0.1;
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* --- sandbag: coarse hessian weave over a lumpy fill ---------------------- */
function bSandbag(ctx) {
  const { res, N, seed } = ctx;
  const WEAVE = 46;
  const lumps = fbmField(res, { seed: seed + 7, freq: 4, octaves: 4 });
  const fill = worleyField(res, { cx: 5, seed: seed + 13, jitter: 1, mode: 0 });
  const fibre = fbmField(res, { seed: seed + 19, freq: 120, octaves: 3 });
  const dirtF = blotchField(res, seed + 29, 3);
  const wear = fbmField(res, { seed: seed + 37, freq: 12, octaves: 4 });
  const fray = scratchField(res, { seed: seed + 41, count: 260, angle: 0, spread: 1.0, lenMin: 0.004, lenMax: 0.03, width: 0.0008 });
  // Cloth stretched over a lumpy fill does not hold a perfect grid: the weave shears and
  // wanders. Perturbing the thread phase by a low-frequency field is what stops this looking
  // like graph paper.
  const shearU = fbmField(res, { seed: seed + 47, freq: 5, octaves: 3 });
  const shearV = fbmField(res, { seed: seed + 53, freq: 5, octaves: 3 });
  const macroL = macroField(res, seed + 59);

  const bagC = C.sandbag;
  const dirtC = C.dirt;
  const dustC = C.dust;

  for (let i = 0; i < N; i++) {
    const x = i % res;
    const y = (i / res) | 0;
    // Plain weave: warp over weft, alternating. The phase term is what makes it interlock
    // rather than read as a checkerboard.
    const u = (x / res) * Math.PI * 2 * WEAVE + (shearU[i] - 0.5) * 4.5;
    const v = (y / res) * Math.PI * 2 * WEAVE + (shearV[i] - 0.5) * 4.5;
    const warp = Math.sin(u);
    const weft = Math.sin(v);
    const over = warp * warp > weft * weft ? 1 : 0;
    const thread = over ? 0.5 + 0.5 * Math.cos(v) : 0.5 + 0.5 * Math.cos(u);
    const weave = lerp(0.35, 1.0, thread) * (0.7 + 0.3 * (over ? 1 : 0.75));

    const bulge = (1 - smoothstep(0.0, 0.62, fill[i])) * 0.62 + lumps[i] * 0.38;
    let hv = 0.22 + bulge * 0.62 + weave * 0.14 + (fibre[i] - 0.5) * 0.05;
    hv += fray[i] * 0.03;
    ctx.h[i] = clamp01(hv);

    const mL = macroL[i];
    ctx.ar[i] = bagC[0];
    ctx.ag[i] = bagC[1];
    ctx.ab[i] = bagC[2];
    tint(ctx, i, lerp(0.82, 1.12, weave));
    tint(ctx, i, lerp(0.9, 1.08, lumps[i]));
    // Macro layer: bags nearer the ground are soaked and dark, the ones on top are bleached.
    tint(ctx, i, lerp(0.76, 1.2, mL));
    paint(ctx, i, dirtC, clamp01(dirtF[i] - 0.35) * 0.55);
    // Sun-bleached crowns, dirt in the hollows.
    paint(ctx, i, dustC, smoothstep(0.6, 0.95, bulge) * clamp01(wear[i]) * 0.4);
    paint(ctx, i, shade(dirtC, 0.7), (1 - smoothstep(0.15, 0.5, bulge)) * 0.3);
    paint(ctx, i, mixc(bagC, dustC, 0.6), fray[i] * 0.5);

    const l = lum(ctx, i);
    // Hessian is uniformly matte; the only variance is dirt (rougher) and polish on the
    // handled crowns (marginally smoother).
    let r = 0.93;
    r -= smoothstep(0.7, 0.98, bulge) * 0.08;
    r += clamp01(dirtF[i] - 0.5) * 0.05;
    r -= smoothstep(0.55, 0.95, 1 - mL) * 0.16; // sodden hessian is dark and slick
    r -= (l - 0.45) * 0.05;
    r += (fibre[i] - 0.5) * 0.04;
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* --- glassDirty: mostly smooth, dust film, grime runs, impact cracks ------ */
function bGlassDirty(ctx) {
  const { res, N, seed } = ctx;
  const film = blotchField(res, seed + 7, 3);
  const dustF = fbmField(res, { seed: seed + 13, freq: 18, octaves: 5 });
  const streaks = streakField(res, { seed: seed + 19, count: 44, lenMin: 0.2, lenMax: 0.9, widthMin: 0.003, widthMax: 0.014 });
  const spatter = worleyField(res, { cx: 60, seed: seed + 23, jitter: 1, mode: 0 });
  const macroL = macroField(res, seed + 29);

  // Two impact stars with radial and concentric cracking.
  const cracks = new Float32Array(N);
  const crnd = mulberry32(seed + 31);
  for (let k = 0; k < 2; k++) {
    const cx = crnd() * res;
    const cy = crnd() * res;
    const arms = 7 + ((crnd() * 6) | 0);
    const phase = crnd() * Math.PI * 2;
    const maxR = res * (0.16 + crnd() * 0.2);
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        let dx = x - cx;
        let dy = y - cy;
        if (dx > res / 2) dx -= res;
        if (dx < -res / 2) dx += res;
        if (dy > res / 2) dy -= res;
        if (dy < -res / 2) dy += res;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > maxR) continue;
        const a = Math.atan2(dy, dx);
        const radial = Math.abs(Math.sin((a - phase) * arms * 0.5));
        const rad = (1 - smoothstep(0.0, 0.06, radial)) * (1 - d / maxR);
        // Concentric ring cracks, denser near the impact point.
        const ringPhase = Math.sqrt(d / maxR) * 5.5;
        const ring = 1 - smoothstep(0.0, 0.1, Math.abs(ringPhase - Math.round(ringPhase)));
        const ringAmt = ring * (1 - d / maxR) * 0.6;
        const v = Math.max(rad, ringAmt);
        const i = y * res + x;
        if (v > cracks[i]) cracks[i] = v;
      }
    }
  }

  const glassC = C.glass;
  const dustC = C.dust;
  const dirtC = C.dirt;

  for (let i = 0; i < N; i++) {
    // The macro layer matters more here than anywhere: a filthy window is filthy in patches,
    // and the patch that is still clear is what makes the rest read as dirt on glass rather
    // than as a translucent grey material.
    const grime = clamp01(
      (film[i] * 0.7 + (dustF[i] - 0.4) * 0.6 + streaks[i] * 0.5 + clamp01(1 - spatter[i] * 3) * 0.3) * lerp(0.35, 1.45, macroL[i])
    );
    // Glass is flat. Almost all of the relief comes from the cracks and the dried spatter.
    let hv = 0.62 + (dustF[i] - 0.5) * 0.02;
    hv -= cracks[i] * 0.35;
    hv += clamp01(1 - spatter[i] * 3) * 0.03;
    ctx.h[i] = clamp01(hv);

    ctx.ar[i] = glassC[0];
    ctx.ag[i] = glassC[1];
    ctx.ab[i] = glassC[2];
    paint(ctx, i, dustC, clamp01(grime) * 0.7);
    paint(ctx, i, dirtC, streaks[i] * 0.35);
    paint(ctx, i, shade(dustC, 1.12), cracks[i] * 0.8); // fractured glass scatters, goes white

    // Clean glass is near-mirror; every bit of roughness here is dirt. That contrast is the
    // whole read of a filthy window.
    let r = 0.06 + grime * 0.5 + cracks[i] * 0.35 + streaks[i] * 0.12;
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
    // Opacity rides in the height alpha for the alphaMap: dirt and cracks are opaque.
    ctx.h[i] = ctx.h[i];
    ctx.op = ctx.op || new Float32Array(N);
    ctx.op[i] = clamp01(0.12 + grime * 0.75 + cracks[i] * 0.8);
  }
}

/* --- plaster: skim coat, trowel swirl, blown patches ---------------------- */
function bPlaster(ctx) {
  const { res, N, seed } = ctx;
  const base = fbmField(res, { seed: seed + 7, freq: 5, octaves: 5, gain: 0.55 });
  const swirlW = fbmField(res, { seed: seed + 11, freq: 3, octaves: 3 });
  const swirl = warpField(fbmField(res, { seed: seed + 13, freq: 9, octaves: 3, stretch: 3 }), res, swirlW, base, res * 0.09);
  const fine = fbmField(res, { seed: seed + 17, freq: 70, octaves: 3 });
  const hair = fbmField(res, { seed: seed + 23, freq: 14, octaves: 5, op: OP_RIDGE });
  const blown = chipField(res, { seed: seed + 29, freq: 6, threshold: 0.75, warp: 0.05 });
  const dirtF = blotchField(res, seed + 37, 3);
  const streaks = streakField(res, { seed: seed + 41, count: 20, lenMin: 0.1, lenMax: 0.5, widthMin: 0.005, widthMax: 0.02 });
  const brickPeek = gridField(res, { cols: 12, rows: 36, stagger: 0.5, gap: 0.0025, chamfer: 0.004, seed: seed + 43 });
  const macroL = macroField(res, seed + 47);

  const plasterC = C.plaster;
  const brickC = C.brick;
  const cool = C.concreteShadow;
  const dustC = C.dust;

  for (let i = 0; i < N; i++) {
    const crack = smoothstep(0.72, 0.93, hair[i]);
    const off = blown.chip[i];
    let hv = 0.68 + (base[i] - 0.5) * 0.1 + (swirl[i] - 0.5) * 0.07 + (fine[i] - 0.5) * 0.03;
    hv -= crack * 0.14;
    hv -= off * 0.3; // blown patch: the skim has come away, revealing masonry behind
    hv += blown.lip[i] * 0.06;
    hv -= off * brickPeek.groove[i] * 0.25;
    ctx.h[i] = clamp01(hv);

    const mL = macroL[i];
    ctx.ar[i] = plasterC[0];
    ctx.ag[i] = plasterC[1];
    ctx.ab[i] = plasterC[2];
    tint(ctx, i, lerp(0.93, 1.05, base[i]));
    tint(ctx, i, lerp(0.97, 1.03, swirl[i]));
    // Macro layer: a rendered wall is never one tone, it is patches of damp and dry render.
    tint(ctx, i, lerp(0.8, 1.18, mL));
    paint(ctx, i, shade(cool, 1.1), crack * 0.55);
    paint(ctx, i, shade(brickC, lerp(0.85, 1.1, brickPeek.id[i])), off * 0.85);
    paint(ctx, i, mixc(plasterC, cool, 0.4), off * brickPeek.groove[i] * 0.6);
    paint(ctx, i, C.dirt, clamp01(dirtF[i] - 0.55) * 0.4);
    paint(ctx, i, shade(cool, 1.0), streaks[i] * 0.35);
    paint(ctx, i, dustC, clamp01(base[i] - 0.7) * 0.25);

    const l = lum(ctx, i);
    // Polished skim is smooth; the exposed brick behind a blown patch is not.
    let r = 0.6;
    r -= smoothstep(0.6, 0.95, swirl[i]) * 0.12;
    r += crack * 0.14;
    r += off * 0.26;
    r += (0.5 - mL) * 2.0 * 0.14; // weathered render is chalk, sheltered render keeps a skin
    r += (fine[i] - 0.5) * 0.07;
    r -= (l - 0.6) * 0.12;
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* --- gravel: track ballast, per-stone tint ------------------------------- */
function bGravel(ctx) {
  const { res, N, seed } = ctx;
  const ids1 = new Float32Array(N);
  const ids2 = new Float32Array(N);
  const s1 = worleyField(res, { cx: 18, seed: seed + 7, jitter: 1, mode: 0, ids: ids1 });
  const s2 = worleyField(res, { cx: 34, seed: seed + 13, jitter: 1, mode: 0, ids: ids2 });
  const s3 = worleyField(res, { cx: 70, seed: seed + 19, jitter: 1, mode: 0 });
  const fines = fbmField(res, { seed: seed + 23, freq: 50, octaves: 4 });
  const dirtF = blotchField(res, seed + 29, 3);
  const facet = fbmField(res, { seed: seed + 31, freq: 26, octaves: 3, op: OP_RIDGE });
  const macroL = macroField(res, seed + 37);

  const gravelC = C.gravel;
  const dirtC = C.dirt;
  const dustC = C.dust;
  const cool = C.concreteShadow;

  for (let i = 0; i < N; i++) {
    // Three stone sizes, largest wins. Track ballast is angular, so bias towards flat facets
    // with a hard shoulder rather than smooth domes.
    const d1 = clamp01(s1[i] * 1.1);
    const d2 = clamp01(s2[i] * 1.15);
    const d3 = clamp01(s3[i] * 1.2);
    const h1 = (1 - d1 * d1) * 0.62;
    const h2 = (1 - d2 * d2) * 0.34;
    const h3 = (1 - d3 * d3) * 0.16;
    const stone = Math.max(h1, Math.max(h2, h3));
    const big = h1 >= h2 && h1 >= h3;
    let hv = 0.16 + stone + (fines[i] - 0.5) * 0.07 + (facet[i] - 0.5) * 0.05 * (stone > 0.2 ? 1 : 0.3);
    ctx.h[i] = clamp01(hv);

    const id = big ? ids1[i] : ids2[i];
    // Ballast is a mix of granite, limestone and the odd bit of red brick.
    let stoneC = shade(sat(gravelC, lerp(0.45, 1.15, id)), lerp(0.5, 1.34, id));
    if (id > 0.9) stoneC = mixc(stoneC, C.brick, 0.45);
    else if (id < 0.12) stoneC = mixc(stoneC, cool, 0.35);
    ctx.ar[i] = stoneC[0];
    ctx.ag[i] = stoneC[1];
    ctx.ab[i] = stoneC[2];
    tint(ctx, i, lerp(0.8, 1.18, facet[i]));
    // The macro layer. Ballast is dirtier where it has been walked and cleaner where it was
    // last topped up, and that is a metre-scale story, not a per-stone one.
    const mL = macroL[i];
    tint(ctx, i, lerp(0.76, 1.24, mL));
    // Fines and dust wash into the gaps between the stones.
    const gap = 1 - smoothstep(0.05, 0.4, stone);
    // Ballast sheds water off the crowns and holds it in the fines, so the shoulder is a
    // patchwork of damp and dry rather than one uniform matte.
    const damp = smoothstep(0.55, 0.95, dirtF[i]);
    paint(ctx, i, dirtC, gap * 0.7 * (0.5 + mL * 0.9));
    paint(ctx, i, shade(dirtC, 0.62), gap * clamp01(dirtF[i] - 0.4) * 0.7);
    paint(ctx, i, dustC, smoothstep(0.5, 0.9, stone) * clamp01(dirtF[i] - 0.3) * 0.36);
    paint(ctx, i, shade(gravelC, 0.6), damp * 0.3);
    // Water stands in the fines between the stones long after the crowns have dried.
    const pool = gap * smoothstep(0.62, 0.94, mL) * smoothstep(0.6, 0.95, dirtF[i]);
    paint(ctx, i, shade(dirtC, 0.42), pool * 0.7);

    const l = lum(ctx, i);
    let r = 0.98;
    r -= smoothstep(0.45, 0.92, stone) * 0.32; // wet-polished stone crowns
    r -= damp * 0.3;
    r += gap * 0.05;
    r += (0.5 - mL) * 2.0 * 0.12;
    r += (fines[i] - 0.5) * 0.12;
    r -= (l - 0.4) * 0.16;
    r = lerp(r, 0.08, pool * 0.9); // standing water: near-mirror, and it catches the key
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* --- dirt: compacted soil, small stones, dried cracks, weeds -------------- */
function bDirt(ctx) {
  const { res, N, seed } = ctx;
  const clods = fbmField(res, { seed: seed + 7, freq: 10, octaves: 5, gain: 0.55 });
  const macro = blotchField(res, seed + 11, 2);
  const stones = worleyField(res, { cx: 40, seed: seed + 13, jitter: 1, mode: 0 });
  const stoneIds = new Float32Array(N);
  worleyField(res, { cx: 40, seed: seed + 13, jitter: 1, mode: 0, ids: stoneIds });
  const dryRaw = worleyField(res, { cx: 11, seed: seed + 19, jitter: 1, mode: 1 });
  const dwx = fbmField(res, { seed: seed + 23, freq: 14, octaves: 3 });
  const dwy = fbmField(res, { seed: seed + 29, freq: 14, octaves: 3 });
  const dry = warpField(dryRaw, res, dwx, dwy, res * 0.015);
  const dryMask = fbmField(res, { seed: seed + 31, freq: 4, octaves: 3 });
  const weeds = fbmField(res, { seed: seed + 37, freq: 8, octaves: 4 });
  const scuff = scratchField(res, { seed: seed + 41, count: 140, angle: 0.6, spread: 1.0, lenMin: 0.02, lenMax: 0.14, width: 0.003 });
  const fine = fbmField(res, { seed: seed + 43, freq: 60, octaves: 3 });
  const macroL = macroField(res, seed + 47);

  const dirtC = C.dirt;
  const dustC = C.dust;
  const weedC = C.weeds;
  const gravelC = C.gravel;

  for (let i = 0; i < N; i++) {
    const crackMask = smoothstep(0.5, 0.8, dryMask[i]);
    const crack = (1 - smoothstep(0.01, 0.09, dry[i])) * crackMask;
    const stone = (1 - smoothstep(0.12, 0.45, stones[i])) * smoothstep(0.35, 0.6, clods[i]);
    const mL = macroL[i];
    let hv = 0.46 + (clods[i] - 0.5) * 0.34 + (macro[i] - 0.5) * 0.2 + (fine[i] - 0.5) * 0.06;
    // Ground is not a plane with bumps on it: it dishes and mounds at the metre scale, and
    // that is where water ends up. The macro layer drives the form as well as the tone.
    hv += (mL - 0.5) * 0.26;
    hv += stone * 0.14;
    hv -= crack * 0.3;
    hv -= scuff[i] * 0.06;
    ctx.h[i] = clamp01(hv);

    // Damp ground and dry ground are two different materials, not one material at two
    // brightnesses: damp is darker AND markedly glossier. Without both halves the ground has
    // a single sheen and reads as one sheet of plastic however much albedo detail it carries.
    const damp = smoothstep(0.52, 0.95, macro[i]) * (1 - crackMask);
    const traffic = clamp01(scuff[i] * 1.4); // ruts and boot-polished lanes

    ctx.ar[i] = dirtC[0];
    ctx.ag[i] = dirtC[1];
    ctx.ab[i] = dirtC[2];
    // Wide, because this is the largest surface in every frame and it is what the player
    // looks at while moving. Timid tinting here is what makes ground read as untextured.
    tint(ctx, i, lerp(0.62, 1.34, clods[i]));
    tint(ctx, i, lerp(0.84, 1.16, macro[i]));
    // The macro layer, at the widest swing in the file. This is the surface the player stares
    // at while moving, so a visible repeat here costs more than anywhere else in the map.
    tint(ctx, i, lerp(0.7, 1.3, mL));
    tint(ctx, i, lerp(0.93, 1.07, fine[i]));
    // Dried-out crust goes pale, the crack interiors stay damp and dark.
    paint(ctx, i, dustC, crackMask * clamp01(macro[i]) * 0.55);
    paint(ctx, i, shade(dirtC, 0.44), crack * 0.9);
    paint(ctx, i, shade(dirtC, 0.58), damp * 0.5);
    paint(ctx, i, shade(sat(gravelC, 0.7), lerp(0.62, 1.28, stoneIds[i])), stone * 0.78);
    paint(ctx, i, weedC, clamp01(weeds[i] - 0.68) * 0.85);
    paint(ctx, i, shade(dirtC, 0.72), traffic * 0.45);
    // Standing water in the dishes the ground has settled into. Nothing else on the ground
    // returns the low sun at full strength, and one puddle catching the key is worth more
    // than any amount of albedo detail around it.
    const puddle = (1 - smoothstep(0.26, 0.5, ctx.h[i])) * smoothstep(0.5, 0.86, mL) * (1 - crackMask);
    paint(ctx, i, shade(dirtC, 0.34), puddle * 0.8);

    const l = lum(ctx, i);
    // Target range across one texture is roughly 0.08..0.98, driven by the damp, traffic and
    // puddle masks rather than by a near-constant with a rounding error's worth of noise.
    let r = 0.97;
    r -= stone * 0.24;
    r -= damp * 0.34; // standing damp is the glossiest thing on the ground
    r -= traffic * 0.26; // compacted, polished wheel and boot lanes
    r += crack * 0.03;
    r += (0.5 - mL) * 2.0 * 0.13;
    r -= clamp01(weeds[i] - 0.68) * 0.22; // foliage is waxier than soil
    r -= (l - 0.4) * 0.18;
    r += (fine[i] - 0.5) * 0.09;
    r = lerp(r, 0.06, puddle * 0.92);
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* --- tarpaulin: woven PE sheet, folds, UV bleaching ---------------------- */
function bTarpaulin(ctx) {
  const { res, N, seed } = ctx;
  const WEAVE = 62;
  const foldW = fbmField(res, { seed: seed + 7, freq: 3, octaves: 3 });
  const folds = warpField(fbmField(res, { seed: seed + 11, freq: 4, octaves: 4, stretch: 5, op: OP_RIDGE }), res, foldW, fbmField(res, { seed: seed + 13, freq: 3, octaves: 2 }), res * 0.08);
  const creases = fbmField(res, { seed: seed + 17, freq: 9, octaves: 4, op: OP_RIDGE, stretch: 2.5 });
  const bleach = blotchField(res, seed + 23, 3);
  const dirtF = blotchField(res, seed + 29, 4);
  const streaks = streakField(res, { seed: seed + 31, count: 24, lenMin: 0.1, lenMax: 0.55, widthMin: 0.004, widthMax: 0.018 });
  const scuffs = scratchField(res, { seed: seed + 37, count: 220, angle: 0.9, spread: 1.0, lenMin: 0.01, lenMax: 0.08, width: 0.001 });
  const macroL = macroField(res, seed + 41);

  const tarpC = C.tarpBlue;
  const dustC = C.dust;
  const dirtC = C.dirt;

  for (let i = 0; i < N; i++) {
    const x = i % res;
    const y = (i / res) | 0;
    const u = (x / res) * Math.PI * 2 * WEAVE;
    const v = (y / res) * Math.PI * 2 * WEAVE;
    const weave = (0.5 + 0.5 * Math.sin(u)) * 0.5 + (0.5 + 0.5 * Math.sin(v)) * 0.5;

    let hv = 0.5 + (folds[i] - 0.4) * 0.42 + creases[i] * 0.12 + (weave - 0.5) * 0.07;
    ctx.h[i] = clamp01(hv);

    const mL = macroL[i];
    ctx.ar[i] = tarpC[0];
    ctx.ag[i] = tarpC[1];
    ctx.ab[i] = tarpC[2];
    tint(ctx, i, lerp(0.85, 1.15, weave));
    tint(ctx, i, lerp(0.82, 1.16, mL)); // macro layer: the half that faced the sun
    // Sun-bleached crests: PE tarp loses saturation before it loses value.
    const exposure = clamp01(smoothstep(0.5, 0.95, folds[i]) * 0.7 + clamp01(bleach[i] - 0.35) * 0.8 + smoothstep(0.5, 0.95, mL) * 0.5);
    const bleached = sat(shade(tarpC, 1.35), 0.42);
    paint(ctx, i, bleached, exposure * 0.6);
    paint(ctx, i, dustC, clamp01(bleach[i] - 0.62) * 0.3);
    paint(ctx, i, dirtC, clamp01(dirtF[i] - 0.5) * 0.5 * (1 - smoothstep(0.6, 0.95, folds[i])));
    paint(ctx, i, shade(dirtC, 0.7), streaks[i] * 0.4);
    paint(ctx, i, mixc(bleached, dustC, 0.4), scuffs[i] * 0.5);

    const l = lum(ctx, i);
    // Plastic sheet: fairly smooth, but abraded crests and ground-in dirt roughen it. The
    // crest highlight is what makes a tarp read as plastic rather than cloth.
    let r = 0.55;
    r -= smoothstep(0.55, 0.95, folds[i]) * 0.16;
    r += clamp01(dirtF[i] - 0.5) * 0.24;
    r += scuffs[i] * 0.22;
    r += exposure * 0.1;
    r += (weave - 0.5) * 0.06;
    r -= (l - 0.2) * 0.05;
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* --- gunmetal: parkerised steel, machining marks, edge wear -------------- */
function bGunmetal(ctx) {
  const { res, N, seed } = ctx;
  const blast = fbmField(res, { seed: seed + 7, freq: 150, octaves: 3, gain: 0.5 }); // bead blast
  const micro = worleyField(res, { cx: 130, seed: seed + 11, jitter: 1, mode: 0 });
  const mill = scratchField(res, { seed: seed + 13, count: 520, angle: 0, spread: 0.035, lenMin: 0.2, lenMax: 0.9, width: 0.0009 });
  const millX = scratchField(res, { seed: seed + 17, count: 180, angle: Math.PI * 0.5, spread: 0.04, lenMin: 0.1, lenMax: 0.5, width: 0.0008 });
  const handling = scratchField(res, { seed: seed + 19, count: 260, angle: 0.4, spread: 1.0, lenMin: 0.01, lenMax: 0.1, width: 0.0011 });
  const wearF = blotchField(res, seed + 23, 4);
  const wearFine = fbmField(res, { seed: seed + 29, freq: 20, octaves: 4 });
  const oil = blotchField(res, seed + 31, 5);
  const carbon = blotchField(res, seed + 37, 6);
  const macroL = macroField(res, seed + 41);

  const gm = C.gunmetal;
  const bright = mixc(C.steelBare, C.hudPrimary, 0.1); // polished steel showing through
  const rubber = C.gunRubber;

  for (let i = 0; i < N; i++) {
    const millAll = clamp01(mill[i] * 0.8 + millX[i] * 0.45);
    // Phosphate finish is matte and slightly porous; the tooling marks are shallow.
    let hv = 0.58 + (blast[i] - 0.5) * 0.1 + (1 - clamp01(micro[i] * 2)) * 0.05;
    hv += millAll * 0.02;
    hv -= handling[i] * 0.015;
    ctx.h[i] = clamp01(hv);

    // Edge wear. Two masks multiplied, not added: the low-frequency field says WHERE on the
    // part the hand and the holster touch, the mid-frequency field breaks that into the
    // speckled, patchy way phosphate actually rubs off. A single soft blotch field on its
    // own produces white clouds, which is what this looked like before.
    const wear = clamp01(smoothstep(0.6, 0.9, wearF[i]) * smoothstep(0.42, 0.88, wearFine[i]) + handling[i] * 0.3);

    ctx.ar[i] = gm[0];
    ctx.ag[i] = gm[1];
    ctx.ab[i] = gm[2];
    tint(ctx, i, lerp(0.84, 1.14, blast[i]));
    tint(ctx, i, lerp(0.93, 1.07, wearFine[i]));
    // Macro layer. Held tighter than the world surfaces: a receiver is one part with one
    // finish, and a big tonal swing across it would read as a badly refinished gun.
    tint(ctx, i, lerp(0.91, 1.09, macroL[i]));
    paint(ctx, i, shade(gm, 0.72), clamp01(carbon[i] - 0.55) * 0.5); // carbon fouling
    // Worn phosphate brightens, but only a little — most of the read is in roughness, and
    // an albedo that jumps to bright steel looks like paint stripper, not use.
    paint(ctx, i, bright, wear * 0.42);
    paint(ctx, i, shade(bright, 1.05), clamp01(handling[i] - 0.55) * 2.0 * 0.35);
    paint(ctx, i, rubber, clamp01(oil[i] - 0.72) * 0.25); // oil film darkens

    const l = lum(ctx, i);
    // The rule for metal: worn HIGH points are SMOOTHER, because wear polishes. Phosphate is
    // matte at 0.45, burnished contact faces drop to near 0.12.
    let r = 0.46;
    r += (blast[i] - 0.5) * 0.12;
    r -= millAll * 0.1;
    r -= wear * 0.3;
    r -= clamp01(oil[i] - 0.6) * 0.14; // oil fills the pores and slicks the surface
    r += clamp01(carbon[i] - 0.55) * 0.14;
    r += (1 - clamp01(micro[i] * 2)) * 0.06;
    r -= (l - 0.16) * 0.1;
    ctx.rg[i] = clamp01(r);
    // Fully metallic everywhere except where fouling has built up into a dielectric crust.
    ctx.mt[i] = clamp01(1 - clamp01(carbon[i] - 0.62) * 0.4);
  }
}

/* --- gunPolymer: moulded stipple, mould seam, scuffs --------------------- */
function bGunPolymer(ctx) {
  const { res, N, seed } = ctx;
  const STIP = 58;
  const micro = fbmField(res, { seed: seed + 7, freq: 110, octaves: 3 });
  const macro = fbmField(res, { seed: seed + 11, freq: 7, octaves: 4 });
  const scuffs = scratchField(res, { seed: seed + 13, count: 300, angle: 0.7, spread: 1.0, lenMin: 0.008, lenMax: 0.07, width: 0.001 });
  const wearF = blotchField(res, seed + 17, 5);
  const dustF = blotchField(res, seed + 19, 4);
  const macroL = macroField(res, seed + 23);

  const poly = C.gunPolymer;
  const tan = C.gunTan;
  const dustC = C.dust;

  for (let i = 0; i < N; i++) {
    const x = i % res;
    const y = (i / res) | 0;
    // Pyramidal stipple: an offset lattice of little pyramids, the standard grip texture.
    const row = Math.floor((y / res) * STIP);
    const u = (x / res) * STIP + (row & 1) * 0.5;
    const v = (y / res) * STIP;
    const fu = u - Math.floor(u) - 0.5;
    const fv = v - Math.floor(v) - 0.5;
    const pyr = clamp01(1 - (Math.abs(fu) + Math.abs(fv)) * 2.1);
    const stipple = pyr * pyr;

    // Mould seam: a single fine parting line down the part.
    const seamX = res * 0.5 + (macro[i] - 0.5) * res * 0.01;
    let sd = Math.abs(x - seamX);
    sd = Math.min(sd, res - sd) / (res * 0.0025);
    const seam = 1 - smoothstep(0.7, 1.4, sd);

    let hv = 0.5 + stipple * 0.34 + (micro[i] - 0.5) * 0.06 + (macro[i] - 0.5) * 0.05;
    hv += seam * 0.05;
    hv -= scuffs[i] * 0.02;
    ctx.h[i] = clamp01(hv);

    ctx.ar[i] = poly[0];
    ctx.ag[i] = poly[1];
    ctx.ab[i] = poly[2];
    tint(ctx, i, lerp(0.9, 1.1, macro[i]));
    // Macro layer: moulded polymer sinks and gasses off unevenly across a large part.
    tint(ctx, i, lerp(0.9, 1.1, macroL[i]));
    // Polymer scuffs go lighter — the surface goes chalky where it has been abraded.
    const wear = clamp01(scuffs[i] * 0.9 + smoothstep(0.62, 0.9, wearF[i]) * stipple * 0.7);
    paint(ctx, i, mixc(poly, tan, 0.5), wear * 0.55);
    paint(ctx, i, dustC, clamp01(dustF[i] - 0.62) * 0.22);

    const l = lum(ctx, i);
    // Injection-moulded polymer: matte, with the stipple tips slightly glossier where the
    // mould surface was polished, and the scuffs distinctly rougher.
    let r = 0.66;
    r -= smoothstep(0.5, 0.95, stipple) * 0.12;
    r += wear * 0.2;
    r += (micro[i] - 0.5) * 0.06;
    r += (0.5 - macroL[i]) * 2.0 * 0.07;
    r -= seam * 0.08;
    r -= (l - 0.15) * 0.08;
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* --- gunWood: oiled walnut furniture ------------------------------------ */
function bGunWood(ctx) {
  const { res, N, seed } = ctx;
  const grainA = fbmField(res, { seed: seed + 7, freq: 5, octaves: 5, stretch: 1 / 30 });
  const figure = fbmField(res, { seed: seed + 11, freq: 3, octaves: 4, stretch: 1 / 8 });
  const pore = fbmField(res, { seed: seed + 13, freq: 90, octaves: 3, stretch: 1 / 24 });
  const handling = blotchField(res, seed + 17, 5);
  const dings = scratchField(res, { seed: seed + 19, count: 90, angle: 0.5, spread: 1.0, lenMin: 0.006, lenMax: 0.04, width: 0.0014 });
  const macroL = macroField(res, seed + 23);

  // A dark oiled walnut derived from the palette rather than invented.
  const walnut = mixc(C.woodWeathered, C.gunRubber, 0.42);
  const light = mixc(C.woodSplinter, C.gunTan, 0.4);

  for (let i = 0; i < N; i++) {
    // Ring figure: fold the stretched noise into bands and add the cross-grain figure.
    const band = 0.5 + 0.5 * Math.sin((grainA[i] * 2.4 + figure[i] * 1.0) * Math.PI * 2);
    const grain = clamp01(band * 0.7 + (pore[i] - 0.5) * 0.5);

    // Oil finish fills the grain, so relief is subtle — mostly open pores and handling dings.
    let hv = 0.66 + (grain - 0.5) * 0.06 + (pore[i] - 0.5) * 0.05;
    hv -= dings[i] * 0.12;
    ctx.h[i] = clamp01(hv);

    ctx.ar[i] = walnut[0];
    ctx.ag[i] = walnut[1];
    ctx.ab[i] = walnut[2];
    // Macro layer: heartwood against sapwood down the length of the blank.
    tint(ctx, i, lerp(0.86, 1.14, macroL[i]));
    paint(ctx, i, light, clamp01(1 - grain - 0.15) * 0.45);
    paint(ctx, i, shade(walnut, 0.62), grain * 0.5);
    // Handling darkens and polishes the wrist and forend.
    paint(ctx, i, shade(walnut, 0.8), clamp01(handling[i] - 0.5) * 0.4);
    paint(ctx, i, light, dings[i] * 0.35); // a fresh ding shows pale wood

    const l = lum(ctx, i);
    // Oiled, not lacquered: satin, glossier where handled, rougher in the open pores.
    let r = 0.36;
    r += (pore[i] - 0.5) * 0.16;
    r += grain * 0.08;
    r += (0.5 - macroL[i]) * 2.0 * 0.08; // the oil has worn thin at one end of the furniture
    r -= clamp01(handling[i] - 0.5) * 0.14;
    r += dings[i] * 0.3;
    r -= (l - 0.22) * 0.1;
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* --- fabric: cordura / webbing, twill weave ------------------------------ */
function bFabric(ctx) {
  const { res, N, seed } = ctx;
  const THREADS = 84;
  const fuzz = fbmField(res, { seed: seed + 7, freq: 130, octaves: 3 });
  const macro = blotchField(res, seed + 11, 3);
  const dirtF = blotchField(res, seed + 13, 4);
  const wearF = fbmField(res, { seed: seed + 17, freq: 9, octaves: 4 });
  const pills = worleyField(res, { cx: 90, seed: seed + 19, jitter: 1, mode: 0 });
  const macroL = macroField(res, seed + 23);

  const cloth = mixc(C.gunTan, C.steelPainted, 0.35);
  const dustC = C.dust;
  const dirtC = C.dirt;

  for (let i = 0; i < N; i++) {
    const x = i % res;
    const y = (i / res) | 0;
    // 2/1 twill: the float offset shifts by one thread per row, giving the diagonal wale.
    const col = (x / res) * THREADS;
    const row = (y / res) * THREADS;
    const ci = Math.floor(col);
    const ri = Math.floor(row);
    const over = ((ci + ri) % 3) < 2 ? 1 : 0;
    const along = over ? row - ri : col - ci;
    const thread = Math.sin(along * Math.PI);
    const weave = 0.35 + 0.65 * thread * thread * (over ? 1.0 : 0.72);

    const pill = (1 - smoothstep(0.15, 0.5, pills[i])) * smoothstep(0.55, 0.85, wearF[i]);
    let hv = 0.46 + weave * 0.3 + (fuzz[i] - 0.5) * 0.08 + (macro[i] - 0.5) * 0.12;
    hv += pill * 0.1;
    ctx.h[i] = clamp01(hv);

    ctx.ar[i] = cloth[0];
    ctx.ag[i] = cloth[1];
    ctx.ab[i] = cloth[2];
    tint(ctx, i, lerp(0.82, 1.12, weave));
    tint(ctx, i, lerp(0.92, 1.06, macro[i]));
    // Macro layer: sun-faded across the panel, still dark in the shadow of a pouch flap.
    tint(ctx, i, lerp(0.86, 1.14, macroL[i]));
    paint(ctx, i, dustC, clamp01(wearF[i] - 0.78) * 0.7); // abraded, sun-faded high wear
    paint(ctx, i, dirtC, clamp01(dirtF[i] - 0.62) * 0.5);
    paint(ctx, i, shade(dustC, 1.05), pill * 0.35);

    const l = lum(ctx, i);
    // Textile: rough everywhere, marginally less so on the thread crowns where the fibres
    // lie flat and catch a sheen.
    let r = 0.88;
    r -= smoothstep(0.6, 1.0, weave) * 0.1;
    r += pill * 0.08;
    r += clamp01(dirtF[i] - 0.5) * 0.06;
    r += (fuzz[i] - 0.5) * 0.05;
    r -= (l - 0.4) * 0.06;
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* --- skin: hands and faces ---------------------------------------------- */
function bSkin(ctx) {
  const { res, N, seed } = ctx;
  const pores = worleyField(res, { cx: 150, seed: seed + 7, jitter: 1, mode: 0 });
  const pores2 = worleyField(res, { cx: 70, seed: seed + 11, jitter: 1, mode: 0 });
  const creaseRaw = worleyField(res, { cx: 40, seed: seed + 13, jitter: 1, mode: 1 });
  const cwx = fbmField(res, { seed: seed + 17, freq: 18, octaves: 3 });
  const cwy = fbmField(res, { seed: seed + 19, freq: 18, octaves: 3 });
  const creases = warpField(creaseRaw, res, cwx, cwy, res * 0.008);
  const mottle = fbmField(res, { seed: seed + 23, freq: 9, octaves: 4 });
  const macro = blotchField(res, seed + 29, 3);
  const oilF = fbmField(res, { seed: seed + 31, freq: 14, octaves: 4 });
  const grime = blotchField(res, seed + 37, 4);
  const macroL = macroField(res, seed + 41);

  // Derived from the palette so the skin sits in the same family as everything else.
  const base = mixc(mixc(C.woodSplinter, C.gunTan, 0.35), C.brick, 0.18);
  const shadowTone = mixc(base, C.blood, 0.28);
  const highlight = mixc(base, C.hudPrimary, 0.3);
  const dirtC = C.dirt;

  for (let i = 0; i < N; i++) {
    const pore = (1 - smoothstep(0.1, 0.55, pores[i])) * 0.6 + (1 - smoothstep(0.15, 0.6, pores2[i])) * 0.4;
    const crease = (1 - smoothstep(0.0, 0.07, creases[i])) * smoothstep(0.3, 0.75, macro[i]);

    let hv = 0.62 + (mottle[i] - 0.5) * 0.08;
    hv -= pore * 0.09;
    hv -= crease * 0.14;
    ctx.h[i] = clamp01(hv);

    ctx.ar[i] = base[0];
    ctx.ag[i] = base[1];
    ctx.ab[i] = base[2];
    // Blotchy subsurface: the red channel varies more than the others, which is the cheap
    // read of skin without any actual subsurface scattering.
    ctx.ar[i] *= lerp(0.9, 1.12, mottle[i]);
    ctx.ag[i] *= lerp(0.95, 1.05, mottle[i]);
    ctx.ab[i] *= lerp(0.97, 1.03, mottle[i]);
    // Macro layer: weathered on the back of the hand, pale where a glove has covered it.
    // Kept to a tan rather than a value shift, because a big luminance swing on skin reads
    // as dirt rather than as sun.
    ctx.ar[i] *= lerp(1.06, 0.94, macroL[i]);
    ctx.ag[i] *= lerp(1.02, 0.97, macroL[i]);
    ctx.ab[i] *= lerp(0.98, 1.02, macroL[i]);
    paint(ctx, i, shadowTone, crease * 0.4);
    paint(ctx, i, shadowTone, clamp01(macro[i] - 0.55) * 0.3);
    paint(ctx, i, highlight, clamp01(0.5 - macro[i]) * 0.25);
    paint(ctx, i, dirtC, clamp01(grime[i] - 0.62) * 0.35); // soldier's hands are not clean

    const l = lum(ctx, i);
    // Skin has an oily sheen on the raised areas and is much rougher in the creases.
    let r = 0.56;
    r -= smoothstep(0.45, 0.85, oilF[i]) * 0.16;
    r += crease * 0.18;
    r += pore * 0.08;
    r += clamp01(grime[i] - 0.62) * 0.12;
    r -= (l - 0.45) * 0.06;
    ctx.rg[i] = clamp01(r);
    ctx.mt[i] = 0;
  }
}

/* ========================================================================== */
/* 7. Surface table                                                           */
/* ========================================================================== */

const HERO = 1024;
const STD = 512;

/*
 * Per-surface shader parameters, on top of the map set:
 *   macro/macroR  low-frequency (~15 m) world albedo / roughness swing
 *   meso/mesoR    ~1.7 m world albedo / roughness swing — the band that survives mipping
 *   grime         AO-driven cavity dirt
 *   streak        gravity streak strength on vertical faces
 *   edge/edgeR    convex edge wear: albedo lift / roughness drop
 *   oxide         curvature-driven warm oxide on convex metal
 *   metalKeep     fraction of the ash film a fully metallic texel still receives
 *   envBoost      envMapIntensity multiplier — metals need the sun disc to carry
 *   triBlend      weight of the coarse triplanar albedo octave
 *
 * The ground surfaces (dirt, gravel, asphalt, concreteRough, rubble) carry the largest meso
 * and macro values in the table: the ground is the biggest thing on screen in every frame and
 * the only surface the player looks at continuously while moving.
 *
 * `relief` and `normal` were both raised across the board. At eight degrees of key elevation
 * the shading of every surface in frame is dominated by the dot product of a very shallow
 * light against the normal map, so a normal map authored for a lamp overhead produces almost
 * no modulation at all here and the surface reads as a flat shaded polygon with a photograph
 * on it. The specular-AA term in FRAG_ASH is what makes the higher amplitude affordable.
 */
const SURFACES = {
  concreteRough: { res: HERO, relief: 0.072, build: bConcreteRough, normal: 1.2, ao: 1.05, ash: 1.05, detail: 0.8, tile: 2.5, macro: 0.2, macroR: 0.22, meso: 0.15, mesoR: 0.22, grime: 0.5, streak: 0.6, edge: 0.45, edgeR: 0.24, triBlend: 0.42, aoOpts: { dirs: 8, steps: 5, cavity: 0.6 } },
  concretePanel: { res: HERO, relief: 0.082, build: bConcretePanel, normal: 1.15, ao: 1.05, ash: 1.0, detail: 0.68, tile: 2.5, macro: 0.17, macroR: 0.19, meso: 0.11, mesoR: 0.17, grime: 0.55, streak: 0.7, edge: 0.5, edgeR: 0.26, aoOpts: { dirs: 8, steps: 6, cavity: 0.7 } },
  asphalt: { res: HERO, relief: 0.05, build: bAsphalt, normal: 1.15, ao: 1.05, ash: 0.85, detail: 0.75, tile: 3.0, macro: 0.2, macroR: 0.24, meso: 0.14, mesoR: 0.24, grime: 0.4, streak: 0.2, edge: 0.3, edgeR: 0.2, triBlend: 0.42, aoOpts: { dirs: 8, steps: 5, cavity: 0.55 } },
  rubble: { res: STD, relief: 0.108, build: bRubble, normal: 1.15, ao: 1.2, ash: 1.15, detail: 0.8, tile: 1.6, macro: 0.19, macroR: 0.2, meso: 0.15, mesoR: 0.2, grime: 0.6, streak: 0.35, edge: 0.55, edgeR: 0.26, triBlend: 0.45, aoOpts: { dirs: 8, steps: 6, cavity: 0.6 } },
  brickPainted: { res: HERO, relief: 0.062, build: bBrickPainted, normal: 1.2, ao: 1.15, ash: 0.9, detail: 0.6, tile: 2.5, macro: 0.16, macroR: 0.17, meso: 0.09, mesoR: 0.15, grime: 0.5, streak: 0.75, edge: 0.45, edgeR: 0.22, aoOpts: { dirs: 8, steps: 6, cavity: 0.75 } },
  metalPainted: { res: STD, relief: 0.05, build: bMetalPainted, normal: 1.1, ao: 1.0, ash: 0.85, detail: 0.5, tile: 2.0, macro: 0.13, macroR: 0.16, meso: 0.065, mesoR: 0.13, grime: 0.45, streak: 0.6, edge: 0.6, edgeR: 0.26, oxide: 0.5, metalKeep: 0.2, envBoost: 1.45, aoOpts: { dirs: 8, steps: 5, cavity: 0.6 } },
  metalRust: { res: HERO, relief: 0.05, build: bMetalRust, normal: 1.15, ao: 1.05, ash: 0.9, detail: 0.65, tile: 2.0, macro: 0.14, macroR: 0.18, meso: 0.075, mesoR: 0.14, grime: 0.45, streak: 0.7, edge: 0.55, edgeR: 0.3, oxide: 0.55, metalKeep: 0.12, envBoost: 1.8, aoOpts: { dirs: 8, steps: 5, cavity: 0.65 } },
  corrugatedSteel: { res: STD, relief: 0.125, build: bCorrugatedSteel, normal: 1.1, ao: 1.05, ash: 0.9, detail: 0.55, tile: 2.4, macro: 0.14, macroR: 0.18, meso: 0.075, mesoR: 0.14, grime: 0.5, streak: 0.8, edge: 0.5, edgeR: 0.28, oxide: 0.5, metalKeep: 0.14, envBoost: 1.7, aoOpts: { dirs: 8, steps: 6, cavity: 0.45 } },
  woodPlank: { res: STD, relief: 0.05, build: bWoodPlank, normal: 1.15, ao: 1.05, ash: 0.85, detail: 0.68, tile: 2.0, macro: 0.16, macroR: 0.18, meso: 0.095, mesoR: 0.17, grime: 0.55, streak: 0.45, edge: 0.45, edgeR: 0.2, aoOpts: { dirs: 8, steps: 5, cavity: 0.6 } },
  sandbag: { res: STD, relief: 0.088, build: bSandbag, normal: 1.1, ao: 1.2, ash: 1.05, detail: 0.7, tile: 1.2, macro: 0.15, macroR: 0.13, meso: 0.1, mesoR: 0.13, grime: 0.55, streak: 0.25, edge: 0.3, edgeR: 0.1, aoOpts: { dirs: 8, steps: 5, cavity: 0.7 } },
  glassDirty: { res: STD, relief: 0.014, build: bGlassDirty, normal: 0.75, ao: 0.5, ash: 1.3, detail: 0.24, tile: 2.0, macro: 0.08, macroR: 0.07, meso: 0.05, mesoR: 0.07, grime: 0.3, streak: 0.9, edge: 0.15, edgeR: 0.05, envBoost: 1.6, aoOpts: { dirs: 6, steps: 4, cavity: 0.35 } },
  plaster: { res: STD, relief: 0.036, build: bPlaster, normal: 1.05, ao: 1.0, ash: 0.95, detail: 0.65, tile: 2.5, macro: 0.17, macroR: 0.18, meso: 0.1, mesoR: 0.16, grime: 0.55, streak: 0.8, edge: 0.45, edgeR: 0.2, aoOpts: { dirs: 8, steps: 5, cavity: 0.6 } },
  gravel: { res: STD, relief: 0.095, build: bGravel, normal: 1.15, ao: 1.25, ash: 0.9, detail: 0.8, tile: 1.6, macro: 0.22, macroR: 0.26, meso: 0.16, mesoR: 0.26, grime: 0.5, streak: 0.1, edge: 0.3, edgeR: 0.18, triBlend: 0.45, aoOpts: { dirs: 8, steps: 6, cavity: 0.7 } },
  dirt: { res: STD, relief: 0.075, build: bDirt, normal: 1.15, ao: 1.15, ash: 0.8, detail: 0.8, tile: 2.4, macro: 0.23, macroR: 0.26, meso: 0.17, mesoR: 0.26, grime: 0.5, streak: 0.1, edge: 0.25, edgeR: 0.15, triBlend: 0.45, aoOpts: { dirs: 8, steps: 5, cavity: 0.6 } },
  tarpaulin: { res: STD, relief: 0.062, build: bTarpaulin, normal: 1.1, ao: 1.0, ash: 1.0, detail: 0.55, tile: 2.0, macro: 0.13, macroR: 0.12, meso: 0.075, mesoR: 0.11, grime: 0.45, streak: 0.5, edge: 0.3, edgeR: 0.12, aoOpts: { dirs: 8, steps: 5, cavity: 0.55 } },
  /*
   * Viewmodel surfaces skip the world-space bands (they would swim as the weapon moves) but
   * keep edge wear, which is most of what sells a used firearm.
   *
   * `tile` on these three was 0.35 / 0.30 / 0.35, and that was a world-scale number sitting on
   * a viewmodel-scale part. `tile` is METRES PER TEXTURE PERIOD — level.js scales metre UVs by
   * `1 / tileMetres(name)` and `materials.tileMetres()` is the contract every consumer reads —
   * so 0.35 stretches ONE period of a 1024px map across 350 mm. An mk18 handguard is about
   * 260 mm and a receiver about 220 mm, so every part of the weapon was getting a fraction of
   * a period: the handguard rendered as one flat pale gradient and the receiver as a single
   * mid-tone, with the bead blast, the mill marks, the mould stipple and the walnut pore all
   * stretched past the point of being features at all.
   *
   * These are set at the scale the generators were actually authored for, checked at
   * viewmodel distance (0.25-0.45 m from the view camera) rather than world distance:
   *   gunmetal   0.050 m — bGunmetal's mill scratches are 0.0009 of a tile, so 45 microns:
   *                        tooling marks. A 220 mm receiver now carries 4.4 periods.
   *   gunPolymer 0.045 m — bGunPolymer lays 58 stipple pyramids across the tile, so 0.78 mm
   *                        pitch, which is real moulded grip texture. At 0.30 it was 5.2 mm,
   *                        i.e. chequer plate. A 260 mm handguard now carries 5.8 periods.
   *   gunWood    0.075 m — bGunWood's pore field is 90 periods per tile, so 0.83 mm: open
   *                        walnut grain. The ring figure lands at roughly 15 mm, which is
   *                        about right for furniture cut from a small blank.
   * `relief` is a fraction of the tile width, so it follows the tile down automatically and
   * the normal maps keep the slopes they had; only the physical reading changes, from a
   * 5 mm-deep bead blast (absurd) to 0.75 mm (right).
   */
  gunmetal: { res: HERO, relief: 0.015, build: bGunmetal, normal: 0.8, ao: 0.7, ash: 0.22, detail: 0.34, tile: 0.05, view: true, edge: 0.7, edgeR: 0.22, metalKeep: 0.1, envBoost: 1.5, aoOpts: { dirs: 6, steps: 4, cavity: 0.45 } },
  gunPolymer: { res: STD, relief: 0.026, build: bGunPolymer, normal: 1.05, ao: 0.8, ash: 0.22, detail: 0.34, tile: 0.045, view: true, edge: 0.45, edgeR: 0.2, aoOpts: { dirs: 8, steps: 5, cavity: 0.55 } },
  gunWood: { res: STD, relief: 0.014, build: bGunWood, normal: 0.85, ao: 0.7, ash: 0.2, detail: 0.32, tile: 0.075, view: true, edge: 0.4, edgeR: 0.16, aoOpts: { dirs: 6, steps: 4, cavity: 0.5 } },
  fabric: { res: STD, relief: 0.036, build: bFabric, normal: 1.05, ao: 1.0, ash: 0.35, detail: 0.45, tile: 0.6, view: true, edge: 0.25, edgeR: 0.08, aoOpts: { dirs: 8, steps: 5, cavity: 0.6 } },
  skin: { res: STD, relief: 0.02, build: bSkin, normal: 0.8, ao: 0.85, ash: 0.12, detail: 0.35, tile: 0.35, view: true, edge: 0.1, edgeR: 0.04, aoOpts: { dirs: 8, steps: 5, cavity: 0.55 } },
};

/* ========================================================================== */
/* 8. Shader injection                                                        */
/* ========================================================================== */

/** Shared declarations. Injected into <common> in both stages, so the varyings match. */
const PRELUDE_COMMON = /* glsl */ `
varying vec3 vAshWorld;
varying vec3 vAshNormalW;
`;

const PRELUDE_FRAG = /* glsl */ `
uniform vec3  uFogColourNear;
uniform vec3  uFogColourFar;
uniform float uFogDensity;
uniform float uFogHeightFalloff;
uniform float uFogBase;
uniform vec3  uSunDirection;
uniform vec3  uSunTint;
uniform float uInscatterStrength;
uniform float uInscatterAnisotropy;

uniform sampler2D uDetailNormal;
uniform float uDetailScale;
uniform float uDetailMicro;
uniform float uDetailStrength;
uniform float uDetailFadeNear;
uniform float uDetailFadeFar;

// The luminance-normalised ash tint. See FRAG_ASH: the dust film MULTIPLIES the substrate,
// so this must not carry level of its own or it bleaches whatever it lands on.
uniform vec3  uDustTint;
// The deposit's own diffuse albedo, in linear. Deliberately DARK (0.22 luminance) — this is
// the one term allowed to move a surface towards a fixed colour, so its level is the ceiling
// on anything the ash can do to the frame. 0.263/0.226/0.172, luminance 0.23. See FRAG_ASH.
uniform vec3  uDustAlbedo;
uniform float uAshAmount;
uniform float uAshSharpness;
uniform float uAshRoughness;
uniform float uAshMetalKeep;

/**
 * The world-space breakup sampler — the single source of every non-texture-space grunge band
 * in FRAG_ASH (ash drift, meso, macro, wide, gravity streaks).
 *
 * This was three calls to an analytic hash fBm, and that was the single worst artefact in the
 * shipped build. An analytic noise has no derivatives the hardware can act on, so its finest
 * octave — 0.38 m for the meso band, 0.15 m for the streak band — kept its world size all the
 * way to the horizon. Past the distance where that octave falls under a pixel it stops being
 * a surface and becomes per-pixel hash: a high-frequency tan speckle, drawn at the same
 * SCREEN size on the ballast at 4 m and the warehouse facade at 120 m, on every material in
 * the frame at once, because FRAG_ASH is on every material in the frame at once.
 *
 * A texture fetch fixes it for free. vAshWorld is a varying, uBreakScale a uniform, so
 * the product goes through exactly the same derivative chain as vUv does: the hardware
 * computes the footprint, picks a mip, and the octaves that fall below a pixel are averaged
 * away by the mip chain instead of aliasing. The bands the eye can actually resolve are
 * untouched — that is the whole point of band-limiting rather than fading out.
 *
 * Channel layout, authored in breakupNoise below (all tileable, all balanced to the same
 * distribution the analytic fBm had, so the authored strengths below still mean what they
 * said):
 *   R  fBm, 6 periods per tile, 3 octaves  — the fine band AND the macro band
 *   G  fBm, 32 periods per tile, 2 octaves — the fine band's incommensurate companion
 *   B  2 periods per tile, 1 octave        — the widest band
 *   A  fBm, 10 periods per tile, 3 octaves — the gravity-streak band
 * R is read at BOTH sampling scales — 10.2 m per tile and 90 m per tile — which is what lets
 * two fetches carry four bands.
 */
uniform sampler2D uBreakup;
uniform float uBreakScale;
uniform float uStreakScale;

uniform float uMacroStrength;
uniform float uMacroScale;
uniform float uMacroRough;
uniform float uMesoStrength;
uniform float uMesoRough;
uniform vec3  uGrimeColour;
uniform float uGrimeStrength;
uniform float uStreakStrength;
uniform float uEdgeWear;
uniform float uEdgeRough;
uniform vec3  uOxideColour;
uniform float uOxideStrength;
uniform float uFogAmount;
uniform float uSpecAAStrength;

// Reoriented normal mapping (Barré-Brisebois & Hill, 2012). Rotates the detail normal into
// the base normal's frame instead of adding the two, which is why detail survives on steep
// base slopes instead of being flattened out.
vec3 ashRNM( vec3 base, vec3 detail ) {
  vec3 t = base + vec3( 0.0, 0.0, 1.0 );
  vec3 u = detail * vec3( -1.0, -1.0, 1.0 );
  return normalize( t * dot( t, u ) - u * t.z );
}
`;

const PRELUDE_FRAG_TRI = /* glsl */ `
uniform float uTriScale;
uniform float uTriScale2;
uniform float uTriBlend;
uniform float uTriSharpness;

vec3 ashTriWeights() {
  vec3 w = pow( abs( vAshNormalW ), vec3( uTriSharpness ) );
  return w / max( w.x + w.y + w.z, 1e-4 );
}

vec4 ashTriSample( sampler2D tex, vec3 wp, vec3 w, float s ) {
  vec4 cx = texture2D( tex, wp.zy * s );
  vec4 cy = texture2D( tex, wp.xz * s );
  vec4 cz = texture2D( tex, wp.xy * s );
  return cx * w.x + cy * w.y + cz * w.z;
}
`;

const VERTEX_INJECT = /* glsl */ `
  #include <project_vertex>
  // World position and geometric world normal for the fog, the ash term, the macro
  // variation and the triplanar path. Computed once here rather than reconstructed from
  // depth in every consumer.
  //
  // The batching and instancing matrices have to be applied in the same order that
  // <project_vertex> applies them, or every instanced decal, casing and rubble piece gets
  // its fog and its dust from wherever the source mesh happens to sit at the origin.
  {
    vec4 ashObj = vec4( transformed, 1.0 );
    mat3 ashNrm = mat3( 1.0 );
    #ifdef USE_BATCHING
      ashObj = batchingMatrix * ashObj;
      ashNrm = mat3( batchingMatrix ) * ashNrm;
    #endif
    #ifdef USE_INSTANCING
      ashObj = instanceMatrix * ashObj;
      ashNrm = mat3( instanceMatrix ) * ashNrm;
    #endif
    vAshWorld = ( modelMatrix * ashObj ).xyz;
    vAshNormalW = normalize( mat3( modelMatrix ) * ashNrm * objectNormal );
  }
`;

/**
 * ORM is one texture serving three map slots, so three.js samples the same image three times
 * per fragment. Fetch it once into `ashORM` instead and drive roughness, metalness and the
 * grunge terms from that — it saves two fetches on the UV path and six on the triplanar one,
 * and it is the only way the packed height (.a) reaches the fragment at all, which is what
 * the edge-wear and cavity-grime terms are built on.
 *
 * `<roughnessmap_fragment>` runs before `<normal_fragment_maps>` in three's fragment chain,
 * so declaring it here makes it available to FRAG_ASH.
 */
const FRAG_ORM_STD = /* glsl */ `
  vec4 ashORM = vec4( 1.0, 1.0, 0.0, 0.5 );
  float roughnessFactor = roughness;
  #ifdef USE_ROUGHNESSMAP
    ashORM = texture2D( roughnessMap, vRoughnessMapUv );
    roughnessFactor *= ashORM.g;
  #endif
`;

const FRAG_METAL_STD = /* glsl */ `
  float metalnessFactor = metalness;
  #ifdef USE_METALNESSMAP
    metalnessFactor *= ashORM.b;
  #endif
`;

/** The block that replaces <normal_fragment_maps> on the standard (UV) path. */
const FRAG_NORMAL_STD = /* glsl */ `
  #ifdef USE_NORMALMAP_TANGENTSPACE

    vec3 ashBaseN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
    ashBaseN.xy *= normalScale;

    // Detail normal at 8x UV plus a micro octave several times finer again, both faded out
    // with distance. Without the fade high-frequency normals are the number one source of
    // shimmer once TAA and a sharpen pass are in the chain.
    //
    // The fade is FLOORED at grazing angles rather than run to zero. A surface seen edge-on
    // is exactly where its micro-relief is most visible — the texel projects long in one
    // axis and the key rakes straight across it — so fading it out there is what makes the
    // far half of a ground plane read as a flat shaded polygon. Grazing texels are also
    // where the mip chain has already thrown the base normal away, so this is the only
    // relief left at that angle.
    float ashViewDist = length( vViewPosition );
    float ashNV = clamp( abs( dot( normalize( vViewPosition ), normal ) ), 0.0, 1.0 );
    float ashGraze = 1.0 - smoothstep( 0.10, 0.72, ashNV );
    float ashDetailFade = 1.0 - smoothstep( uDetailFadeNear, uDetailFadeFar, ashViewDist );
    ashDetailFade = max( ashDetailFade, ashGraze * 0.8 );

    vec3 ashDetN = texture2D( uDetailNormal, vNormalMapUv * uDetailScale ).xyz * 2.0 - 1.0;
    // Swizzled so the micro octave is not a scaled copy of the same pattern: two octaves of
    // the identical tile stacked in register read as one octave with a beat in it.
    vec3 ashMicN = texture2D( uDetailNormal, vNormalMapUv * uDetailScale * uDetailMicro ).yxz * 2.0 - 1.0;
    ashDetN.xy *= uDetailStrength * ashDetailFade;
    ashMicN.xy *= uDetailStrength * 0.6 * ashDetailFade * ashDetailFade;
    vec3 ashN = ashRNM( ashBaseN, normalize( ashDetN ) );
    ashN = ashRNM( ashN, normalize( ashMicN ) );

    normal = normalize( tbn * ashN );

  #endif

  // The ORM has already been fetched for roughness; its .r is the same AO texel, so reuse it
  // rather than paying for a second sample of the identical image.
  float ashAO = 1.0;
  #ifdef USE_ROUGHNESSMAP
    ashAO = ashORM.r;
  #elif defined( USE_AOMAP )
    ashAO = texture2D( aoMap, vAoMapUv ).r;
  #endif
`;

/** The block that replaces <normal_fragment_maps> on the triplanar path. */
const FRAG_NORMAL_TRI = /* glsl */ `
  #ifdef USE_NORMALMAP_TANGENTSPACE

    vec3 ashW3 = ashTriWeights();
    vec3 ashWP = vAshWorld;
    float ashS = uTriScale;

    vec3 tnX = texture2D( normalMap, ashWP.zy * ashS ).xyz * 2.0 - 1.0;
    vec3 tnY = texture2D( normalMap, ashWP.xz * ashS ).xyz * 2.0 - 1.0;
    vec3 tnZ = texture2D( normalMap, ashWP.xy * ashS ).xyz * 2.0 - 1.0;

    float ashViewDist = length( vViewPosition );
    float ashNV = clamp( abs( dot( normalize( vViewPosition ), normal ) ), 0.0, 1.0 );
    float ashGraze = 1.0 - smoothstep( 0.10, 0.72, ashNV );
    float ashDetailFade = 1.0 - smoothstep( uDetailFadeNear, uDetailFadeFar, ashViewDist );
    // Floored at grazing angles: see FRAG_NORMAL_STD. This matters most here, because the
    // triplanar path is the ground, and the ground is almost entirely grazing.
    ashDetailFade = max( ashDetailFade, ashGraze * 0.8 );
    float ashDS = ashS * uDetailScale;
    vec3 dnX = texture2D( uDetailNormal, ashWP.zy * ashDS ).xyz * 2.0 - 1.0;
    vec3 dnY = texture2D( uDetailNormal, ashWP.xz * ashDS ).xyz * 2.0 - 1.0;
    vec3 dnZ = texture2D( uDetailNormal, ashWP.xy * ashDS ).xyz * 2.0 - 1.0;
    float ashDStr = uDetailStrength * ashDetailFade;
    dnX.xy *= ashDStr; dnY.xy *= ashDStr; dnZ.xy *= ashDStr;
    tnX.xy *= normalScale; tnY.xy *= normalScale; tnZ.xy *= normalScale;
    tnX = ashRNM( tnX, normalize( dnX ) );
    tnY = ashRNM( tnY, normalize( dnY ) );
    tnZ = ashRNM( tnZ, normalize( dnZ ) );
    // One micro octave, on the up-facing projection only. Three would triple the fetch cost
    // of the path for detail that would be invisible on the two vertical projections, so it
    // is weighted straight out by the up weight instead.
    vec3 dnM = texture2D( uDetailNormal, ashWP.xz * ashDS * uDetailMicro ).yxz * 2.0 - 1.0;
    dnM.xy *= ashDStr * 0.6 * ashDetailFade;
    tnY = ashRNM( tnY, normalize( dnM ) );

    // Whiteout blend: keep the tangent-space XY perturbation, take the geometric normal for
    // the projection axis. Cheaper than a full per-axis TBN and visually indistinguishable
    // on the terrain and rubble this is used for.
    vec3 gn = vAshNormalW;
    vec3 nx = vec3( tnX.xy + gn.zy, abs( tnX.z ) * gn.x );
    vec3 ny = vec3( tnY.xy + gn.xz, abs( tnY.z ) * gn.y );
    vec3 nz = vec3( tnZ.xy + gn.xy, abs( tnZ.z ) * gn.z );
    vec3 triN = normalize( nx.zyx * ashW3.x + ny.xzy * ashW3.y + nz.xyz * ashW3.z );

    normal = normalize( ( viewMatrix * vec4( triN, 0.0 ) ).xyz );

  #endif
`;

/**
 * Ash / world-space breakup / grunge / edge-wear / specular-AA block.
 * Runs after the normal is final, before lighting.
 *
 * Everything in here is deliberately WORLD-space. Texture-space detail is a fixed number of
 * texels per metre, so on a 100 m ground plane it is entirely gone by five metres out — the
 * mip chain has averaged it to its own mean and the surface reads as a flat shaded polygon
 * from the mid-ground to the horizon. The bands below (wide ~45 m, macro ~15 m, meso ~1.7 m,
 * plus the streak/grime/edge terms) are tied to WORLD scale rather than to UV scale, so a
 * surface twenty metres away still has a metre-scale story on it.
 *
 * They are no longer analytic. World-scale and un-mippable are two different things, and the
 * shipped build conflated them: the bands were sampled from a hash fBm, which cannot be
 * band-limited, so every octave that fell under a pixel aliased into per-pixel speckle. They
 * now come from `uBreakup`, a mipped tileable noise texture sampled at world scale — same
 * wavelengths, same amplitudes, but the hardware can pick a mip. See the uniform's comment.
 */
const FRAG_ASH = /* glsl */ `
  {
    // View-space normal back to world space. viewMatrix's upper 3x3 is orthonormal, so the
    // inverse is the transpose, and v * M is exactly transpose(M) * v in GLSL.
    vec3 ashWN = normalize( normal * mat3( viewMatrix ) );

    float ashUp = max( ashWN.y, 0.0 );
    float ashSide = 1.0 - abs( ashWN.y );

    // Packed height (ORM.a) and AO (ORM.r) are the only two channels needed to reconstruct a
    // usable convexity signal, which is why no extra curvature map is generated:
    //   - a convex arris is HIGH in the height field and UNOCCLUDED in the AO,
    //   - a cavity is LOW in the height field and OCCLUDED.
    // That gives edge wear and cavity grime for the cost of two smoothsteps.
    float ashH = ashORM.a;
    float ashAOc = clamp( ashAO, 0.0, 1.0 );
    // Thresholds chosen against the actual height/AO distributions the generators produce:
    // they put the edge term on 4-30% of texels depending on the surface (most on rolled
    // steel and ballast, least on a cast face), which is roughly where real wear sits. A term
    // that covers half the surface is not wear, it is a second base albedo.
    float ashEdge = smoothstep( 0.52, 0.86, ashH ) * smoothstep( 0.58, 0.94, ashAOc );
    float ashCavity = ( 1.0 - smoothstep( 0.10, 0.60, ashH ) ) * ( 1.0 - smoothstep( 0.42, 0.90, ashAOc ) );

    // Two fetches carry four bands. Both UVs are (varying * uniform), so both get real
    // derivatives and therefore a real mip level; see uBreakup's comment.
    //
    // ashNearF: the tile spans ~10.2 m, so channel R's three octaves land on 1.7 / 0.85 /
    //   0.43 m — the meso band, which is what the eye reads as "surface" while moving. The
    //   vAshWorld.y term shifts the sample per storey so stacked floors of the admin block
    //   do not get the identical dirt.
    // ashWideF: the tile spans 90 m, about the depth of the whole map, so the SAME channel R
    //   lands on 15 / 7.5 / 3.75 m (the macro band), channel B on 45 m (the wide band) and
    //   channel G on 2.8 / 1.4 m.
    // The vAshWorld.y offsets stay at a FIFTH of their own fetch's xz scale, as they were
    // against the old analytic scales. Any larger and the band varies faster up a wall than
    // along it, which prints vertical stripes on every facade in the map.
    vec4 ashNearF = texture2D( uBreakup, vAshWorld.xz * uBreakScale + vAshWorld.y * 0.019 );
    vec4 ashWideF = texture2D( uBreakup, vAshWorld.xz * uMacroScale + vAshWorld.y * 0.005 );

    // A tiled texture repeats where an analytic hash did not, so the meso band is the sum of
    // two fields of about the same wavelength read at INCOMMENSURATE tile sizes (10.2 m and
    // 90 m). Neither period divides the other, so the sum has no period the eye can find —
    // the same argument the two macro bands below have always used.
    float ashBreak = clamp( ashNearF.r * 0.62 + ashWideF.g * 0.38, 0.0, 1.0 );
    // Macro band, ~15 m, plus a wide band three times coarser again (45 m). One band alone
    // still repeats: it beats against itself at its own wavelength and the eye finds *that*
    // period instead. Two incommensurate bands do not.
    float ashMacro = clamp( ashWideF.r * 0.6 + ashWideF.b * 0.4, 0.0, 1.0 );

    // Hoisted out of the branch it is used in. A texture fetch under non-uniform control flow
    // has undefined derivatives, and the derivatives ARE the fix — inside the branch the driver
    // would be free to hand back mip 0 and put the speckle straight back on every vertical
    // face in the frame. The fetch is cheap; the branch below still skips the maths.
    float ashStreakN = texture2D(
      uBreakup,
      vec2( ( vAshWorld.x - vAshWorld.z ) * uStreakScale, vAshWorld.y * uStreakScale * 0.15 )
    ).a;

    /* ---- 1. ash / dust film -------------------------------------------------- */

    // Fallout does not settle evenly. It drifts: heaped where the air was still, scoured
    // where it was not, and the edge between the two is what makes a horizontal face read as
    // *covered in ash* rather than merely tinted grey. Thresholding the coverage against the
    // two world bands is what produces that edge.
    float ashDrift = smoothstep( 0.14, 0.76, ashBreak * 0.6 + ashMacro * 0.4 );
    float ashMask = pow( ashUp, uAshSharpness ) * uAshAmount;
    // Hard gate through vertical. Ash sits on horizontal faces and on nothing else, and a
    // wall that carries any of it at all immediately reads as a tinted material rather than
    // as a dusted one. Below about 12 degrees off vertical there is none.
    ashMask *= smoothstep( 0.02, 0.32, ashWN.y );
    // Floor well below the old flat 0.40 and peak above the old 1.30: the mean coverage is
    // about what it was, but it is now nearly all in the drifts instead of spread as an even
    // wash, and an even wash is exactly what reads as a tint rather than as fallout.
    ashMask *= 0.26 + 1.05 * ashDrift;
    // Crevices trap more dust than exposed faces.
    ashMask *= mix( 1.3, 0.82, ashAOc );
    // Bare polished metal does not hold a dust film the way oxide, paint and concrete do, and
    // contact faces are wiped clean by traffic. Without this gate the up-facing rail head —
    // the one mirror-polished surface in a rail yard — has its metalness zeroed, and with it
    // every glancing highlight in the frame. The gate is strongest exactly where the surface
    // is both metallic and convex, i.e. on the wear band.
    ashMask *= mix( 1.0, uAshMetalKeep, metalnessFactor * ( 0.45 + 0.55 * ashEdge ) );
    ashMask = clamp( ashMask, 0.0, 1.0 );

    // MULTIPLICATIVE, not a lerp towards a pale colour.
    //
    // This was mix( albedo, dustColour, ashMask * 0.84 ) plus an additive dust term, and
    // that is what turned the yard into a snowfield. PALETTE.dust is 0.50 in linear
    // luminance; ballast is 0.12 and dirt 0.12. Lerping 84% of the way from 0.12 to 0.50 does
    // not dust the ground, it REPLACES it — measured albedo came out at 0.37 linear, three
    // times what the palette authored, which under a 4.6 key at exposure 5.0 sits far enough
    // up the AgX shoulder that the curve's own desaturation flattens the hue as well. Hence a
    // wide render measuring R132 G125 B125 — luminance 127 and R-B of +7, i.e. a cold
    // blue-white, on FULL-SUN ground under a #ffcf9a key.
    //
    // A dust film is a few microns of pale grey-brown powder lying ON a surface. It re-tints
    // what is underneath and lifts it slightly; it cannot make dark ballast bright. uDustTint
    // is PALETTE.dust divided by its own luminance — (1.14, 0.98, 0.75) — so at full coverage
    // it rotates hue towards the ash and is arithmetically incapable of bleaching anything.
    // On ballast that lands the sunlit ground at ~0.14 linear with R:B of 1.75 against the
    // substrate's 1.28: warm ash-dusted ballast, which is what §4 asks for.
    vec3 ashFilm = mix( vec3( 1.0 ), uDustTint, ashMask );
    // The one term that is allowed to add level: powder does scatter more than the damp
    // ballast under it. Squared in the mask so only properly drifted texels lift, and an
    // order of magnitude smaller than the additive term it replaces — this is a deposit
    // reading brighter, not an exposure change.
    ashFilm *= 1.0 + ashMask * ashMask * 0.16;
    diffuseColor.rgb *= ashFilm;

    // COVERAGE. A pure hue rotation is safe but it is not the whole physical story: where the
    // powder has genuinely drifted it stops being a film over the substrate and starts being
    // the surface the light actually sees, so the albedo has to move towards the deposit's own
    // rather than merely being tinted by it. Without this the ash can only ever scale what is
    // underneath, which means dark ballast stays ballast-dark however deep the drift, and no
    // per-surface ash scalar can reach the ~0.20 linear the art direction authors for the
    // dusted ground — the knob has no range in the direction it is needed.
    //
    // It cannot reintroduce the snowfield, and that is a property of the target rather than of
    // the weight: uDustAlbedo is 0.263/0.226/0.172 linear (luminance 0.23), DARKER than every
    // substrate in the frame except the ballast, the dirt and the asphalt. Mixing towards it
    // is therefore a lift only for surfaces that are darker than real ash and a slight
    // darkening for everything above it — the exact opposite of lerping 84% of the way to a
    // 0.50-luminance emission swatch, which is what bleached the yard. Bounded at 0.45 and
    // squared in the mask so it lands in the drifts and stays out of the thin dusting: on
    // ballast that is 0.163 linear at the mean coverage and 0.183 at full, warm at R-B +0.08.
    diffuseColor.rgb = mix( diffuseColor.rgb, uDustAlbedo, ashMask * ashMask * 0.45 );

    roughnessFactor = mix( roughnessFactor, uAshRoughness, ashMask * 0.9 );
    // A dust film is a dielectric.
    metalnessFactor *= ( 1.0 - ashMask * 0.94 );

    /* ---- 2. three-scale world breakup, albedo AND roughness ------------------ */

    // Pushed towards the ends of the range before it is applied. A raw fBm spends most of its
    // life near its mean, so a ±20% swing authored against it delivers ±4% in practice and
    // the tiling it exists to hide survives intact.
    float ashMacroS = ( ashMacro - 0.5 ) * 2.0;
    ashMacroS = sign( ashMacroS ) * pow( abs( ashMacroS ), 0.7 );
    diffuseColor.rgb *= 1.0 + ashMacroS * uMacroStrength;
    roughnessFactor += ashMacroS * uMacroRough;

    // Roughness has to vary with the same fields the albedo varies with, or the frame ends up
    // with one global sheen no matter how much albedo detail is present.
    float ashMeso = ashBreak - 0.5;
    diffuseColor.rgb *= 1.0 + ashMeso * 2.0 * uMesoStrength;
    roughnessFactor += ashMeso * 2.0 * uMesoRough;

    /* ---- 3. grunge with a direction ----------------------------------------- */

    // (a) Occlusion-driven grime: dirt accumulates in cavities and where an object meets the
    //     ground, which is what stops every prop reading as newly placed.
    diffuseColor.rgb = mix( diffuseColor.rgb, uGrimeColour, ashCavity * uGrimeStrength );
    roughnessFactor = mix( roughnessFactor, 0.95, ashCavity * uGrimeStrength * 0.65 );

    // (b) Gravity streaks. Vertically stretched world-space noise so the runs are continuous
    //     down a face and independent of UV layout; gated on verticality, so the ground plane
    //     and the whole horizontal half of the map skip it entirely.
    if ( uStreakStrength > 0.0 && ashSide > 0.08 ) {
      // Streaks start under a ledge and run out of dirt as they fall, so bias them into the
      // recesses of the height field and fade them with height above the run's origin.
      float streak = smoothstep( 0.50, 0.94, ashStreakN ) * ashSide * ashSide * uStreakStrength;
      streak *= mix( 0.35, 1.0, 1.0 - ashH );
      diffuseColor.rgb *= 1.0 - streak * 0.40;
      roughnessFactor = min( 1.0, roughnessFactor + streak * 0.22 );
    }

    /* ---- 4. edge wear ------------------------------------------------------- */

    // Convex arrises are rubbed back towards the substrate: lighter, and markedly smoother.
    // The roughness drop is the part that matters — a worn edge reads as a bright line on the
    // silhouette, which is the highest-value-per-pixel material work there is.
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 1.30 + 0.025, ashEdge * uEdgeWear );
    roughnessFactor -= ashEdge * uEdgeRough;

    // Curvature-driven oxide: corrosion starts on convex metal edges, joints and fixings.
    float ashOxide = ashEdge * metalnessFactor * uOxideStrength * smoothstep( 0.30, 0.78, ashMacro );
    diffuseColor.rgb = mix( diffuseColor.rgb, uOxideColour, ashOxide );
    roughnessFactor = mix( roughnessFactor, 0.86, ashOxide );
    metalnessFactor *= 1.0 - ashOxide * 0.75;

    roughnessFactor = clamp( roughnessFactor, 0.035, 1.0 );

    // Specular anti-aliasing: widen the NDF by the sub-pixel normal variance so a
    // high-frequency normal map cannot produce sparkle that TAA then smears into crawl. The
    // cap is deliberately tight: a generous one drags every rough surface to the same value
    // and reintroduces the single global sheen this block exists to break.
    vec3 ashNdx = dFdx( normal );
    vec3 ashNdy = dFdy( normal );
    float ashVar = uSpecAAStrength * ( dot( ashNdx, ashNdx ) + dot( ashNdy, ashNdy ) );
    roughnessFactor = min( 1.0, sqrt( roughnessFactor * roughnessFactor + min( 0.16, ashVar ) ) );
  }
`;

/** Height fog + Henyey-Greenstein inscattering, applied after lighting resolves. */
const FRAG_FOG = /* glsl */ `
  {
    vec3 ashToFrag = vAshWorld - cameraPosition;
    float ashDist = length( ashToFrag );
    vec3 ashViewW = ashToFrag / max( ashDist, 1e-4 );

    // Analytic optical depth through an exponential height profile
    //   rho(y) = D * exp( -k * (y - base) )
    // integrated along the camera->fragment segment. The closed form avoids ray marching
    // and, more importantly, is stable when the camera climbs the gantry crane.
    float k = max( uFogHeightFalloff, 1e-4 );
    float yC = cameraPosition.y - uFogBase;
    float yF = vAshWorld.y - uFogBase;
    float dy = yF - yC;
    float od;
    if ( abs( dy ) < 1e-3 ) {
      od = uFogDensity * ashDist * exp( -k * yC );
    } else {
      od = uFogDensity * ashDist * ( exp( -k * yC ) - exp( -k * yF ) ) / ( k * dy );
    }
    od = max( od, 0.0 );
    float ashTrans = exp( -od );

    // Henyey-Greenstein, normalised so isotropic == 1, then soft-saturated to 0..2. The raw
    // phase function peaks near 30x at g = 0.76 and would blow the highlight out completely
    // when looking down the sun line; x/(1+x) keeps the forward glow strong but bounded.
    float g = clamp( uInscatterAnisotropy, -0.95, 0.95 );
    float cosT = dot( ashViewW, uSunDirection );
    float denom = max( 1.0 + g * g - 2.0 * g * cosT, 1e-4 );
    float hgN = ( 1.0 - g * g ) / ( denom * sqrt( denom ) );
    float phase = 2.0 * hgN / ( 1.0 + hgN );

    // Near tint close in (warm ash), far tint at depth (cool sky haze).
    vec3 fogCol = mix( uFogColourNear, uFogColourFar, clamp( od * 0.6, 0.0, 1.0 ) );
    fogCol *= mix( 0.7, 1.0, clamp( phase, 0.0, 1.0 ) );
    fogCol += uSunTint * ( uInscatterStrength * 0.3 * phase );

    gl_FragColor.rgb = mix( fogCol, gl_FragColor.rgb, mix( 1.0, ashTrans, uFogAmount ) );
  }
`;

/* ========================================================================== */
/* 9. Factory                                                                 */
/* ========================================================================== */

/**
 * @param {THREE.WebGLRenderer} renderer  used only for anisotropy / texture-size limits
 * @param {object|null} shadows           may be null; call attachShadows() later
 */
export function createMaterials(renderer, shadows) {
  /* ---- capability probing, all defensive ---- */
  let maxAniso = 1;
  let maxTex = 4096;
  try {
    maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
    maxTex = renderer?.capabilities?.maxTextureSize ?? 4096;
  } catch {
    maxAniso = 1;
  }
  const aniso = Math.min(16, Math.max(1, maxAniso | 0));

  // Halve every map on modest hardware. Better a soft map than a blown texture budget.
  const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 8;
  const shrink = maxTex < 4096 || mem <= 4 ? 2 : 1;

  const state = {
    shadows: shadows || null,
    env: null,
    disposed: false,
  };

  /* ---- shared fog uniforms — sky.js mutates these and every material follows ---- */
  const el = (SUN_ELEVATION * Math.PI) / 180;
  const az = (SUN_AZIMUTH * Math.PI) / 180;
  // Azimuth is measured from +Z clockwise, so +X is 90 degrees. This is the direction
  // TOWARDS the sun, which is what the phase function needs.
  _sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();

  const fogUniforms = {
    uFogColourNear: { value: new THREE.Color(ATMOSPHERE.fogColourNear) },
    uFogColourFar: { value: new THREE.Color(ATMOSPHERE.fogColourFar) },
    uFogDensity: { value: ATMOSPHERE.fogDensity },
    uFogHeightFalloff: { value: ATMOSPHERE.fogHeightFalloff },
    uFogBase: { value: ATMOSPHERE.fogBase },
    uSunDirection: { value: _sunDir.clone() },
    uSunTint: { value: new THREE.Color(PALETTE.sun) },
    uInscatterStrength: { value: ATMOSPHERE.inscatterStrength },
    uInscatterAnisotropy: { value: ATMOSPHERE.inscatterAnisotropy },
  };

  /**
   * PALETTE.dust, divided by its own Rec.709 luminance.
   *
   * The ash film is applied multiplicatively (see FRAG_ASH), which means the swatch must
   * carry HUE ONLY. PALETTE.dust is 0.573 / 0.492 / 0.377 in linear, luminance 0.501; divided
   * through, that is 1.14 / 0.98 / 0.75 — a pure warm rotation that leaves a surface's own
   * level exactly where the generator put it. Every gram of level the dust adds is now in the
   * one explicit lift term in the shader, where it can be read and bounded, instead of being
   * smuggled in by lerping towards a bright colour.
   */
  const dustTint = new THREE.Color(PALETTE.dust);
  {
    const dl = dustTint.r * 0.2126 + dustTint.g * 0.7152 + dustTint.b * 0.0722;
    dustTint.multiplyScalar(1 / Math.max(dl, 1e-4));
  }
  /**
   * The ash deposit's own albedo — the target of FRAG_ASH's coverage mix, and the only colour
   * in the block that carries level.
   *
   * PALETTE.dust is authored as a particle/smoke EMISSION colour: 0.573/0.492/0.377 linear,
   * luminance 0.50, which is brighter than fresh snow and roughly four times what any surface
   * in a rail yard reflects. Used unscaled as a diffuse target it does not dust the ground, it
   * replaces it. Scaled to 0.45 it is 0.263/0.226/0.172 — the reflectance of real settled ash
   * over ballast, still warm at R-B +0.09, and the same shader-side idiom grimeColour uses two
   * lines below. The CPU texture generators keep using the full-strength C.dust from the linear
   * palette table, so nothing baked into an albedo map changes.
   */
  const dustAlbedo = new THREE.Color(PALETTE.dust).multiplyScalar(0.45);
  // Grime and oxide are palette colours like everything else — nothing here invents a hue.
  const grimeColour = new THREE.Color(PALETTE.dirt).multiplyScalar(0.55);
  const oxideColour = new THREE.Color(PALETTE.rust);

  /* ---- registries ---- */
  const textureCache = new Map(); // name -> {map, normalMap, ormMap, ...}
  const materialCache = new Map(); // key -> material
  const decalCache = new Map(); // key -> material
  const allTextures = new Set();
  const allMaterials = new Set();

  /* ------------------------------------------------------------------ */
  /* Texture construction                                                */
  /* ------------------------------------------------------------------ */

  function makeTexture(data, res, srgb) {
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = aniso;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.needsUpdate = true;
    allTextures.add(tex);
    return tex;
  }

  /**
   * The 8x detail normal shared by every material. One 256px tile of very high frequency
   * relief; it never appears on its own, only reoriented on top of a base normal, so it can
   * be tiny and still carry the whole close-range micro-surface read.
   *
   * Three ingredients rather than two, because a surface's micro-relief is not one thing:
   * an fBm for the general roughness of the substrate, an inverted Worley for the grain that
   * sits proud of it, and a ridged octave for the scratch-and-fracture component that is what
   * actually catches a low key. The relief is nearly double what it was — at 8 degrees of sun
   * elevation a weak micro-normal produces no highlight at all and the surface reads as
   * shaded plastic, and this tile is sampled at two octaves now, so it has to hold up under
   * magnification.
   */
  const detailNormal = (() => {
    const res = 256;
    const a = fbmField(res, { seed: 0x51ee, freq: 24, octaves: 4, gain: 0.55 });
    const b = worleyField(res, { cx: 46, seed: 0x9a13, jitter: 1, mode: 0 });
    const c = fbmField(res, { seed: 0x2c77, freq: 34, octaves: 3, gain: 0.5, op: OP_RIDGE });
    const h = new Float32Array(res * res);
    for (let i = 0; i < h.length; i++) {
      h[i] = a[i] * 0.5 + (1 - clamp01(b[i] * 1.4)) * 0.32 + c[i] * 0.18;
    }
    const data = heightToNormal(h, res, 0.105);
    const tex = makeTexture(data, res, false);
    return tex;
  })();

  /**
   * The world-space breakup noise, shared by every material. Four tileable, decorrelated
   * fields packed one per channel; FRAG_ASH reads it twice at two incommensurate world scales
   * and once more for the streaks, and those three fetches replace every analytic noise call
   * the fragment shader used to make.
   *
   * Why a texture at all, when the fields it holds are the definition of "procedural": because
   * a sampler is the only thing in the pipeline that knows how big a texel is on screen.
   * `makeTexture` gives it `generateMipmaps = true`, `LinearMipmapLinearFilter` minification
   * and the hardware anisotropy cap (8 or 16 on anything this game will run on), so every
   * octave that falls below a pixel is averaged out by the mip chain rather than aliasing into
   * the orange confetti that was being drawn over the whole frame. The same fields evaluated
   * in ALU cannot do this at any price.
   *
   * Frequencies are chosen so that channel R is useful at both sampling scales — see the
   * layout note on the `uBreakup` uniform — and so that no channel's finest octave is under
   * about six texels, below which the tile would be aliased before the sampler ever sees it.
   *
   * The `spread` values are not decoration. They set each field's standard deviation
   * (balanceField spans mean +- spread sigma across 0..1), and every authored strength
   * downstream — uMacroStrength, uMesoStrength, the ashDrift thresholds, the streak
   * smoothstep — was tuned against the ~0.124 sigma of the three-octave value-noise fBm this
   * replaces. 3.4 on the two fine channels and 2.6 on the single-octave wide channel put the
   * *combined* sigma of ashBreak at 0.109 and of ashMacro at 0.118, both within 15% of what
   * the analytic version delivered, so nothing downstream needs re-tuning.
   */
  const breakupNoise = (() => {
    const res = 256;
    const fine = fbmField(res, { seed: 0x4b17, freq: 6, octaves: 3, gain: 0.5, spread: 3.4 });
    const companion = fbmField(res, { seed: 0x8d31, freq: 32, octaves: 2, gain: 0.5, spread: 3.4 });
    const wide = fbmField(res, { seed: 0x1f6a, freq: 2, octaves: 1, spread: 2.6 });
    const streak = fbmField(res, { seed: 0xc903, freq: 10, octaves: 3, gain: 0.5, spread: 4.0 });
    const data = new Uint8Array(res * res * 4);
    for (let i = 0; i < res * res; i++) {
      const j = i * 4;
      // Dithered: the macro band drives albedo by a few percent, and an 8-bit ramp read
      // across sixty metres of ground would otherwise print visible contour steps.
      data[j] = q8(fine[i], i);
      data[j + 1] = q8(companion[i], i + 1);
      data[j + 2] = q8(wide[i], i + 2);
      data[j + 3] = q8(streak[i], i + 3);
    }
    // Linear data, not colour: no sRGB transfer, or the balanced 0..1 distributions this file
    // depends on come back through the sampler bent into a curve.
    return makeTexture(data, res, false);
  })();

  /* ------------------------------------------------------------------ */
  /* Surface generation                                                  */
  /* ------------------------------------------------------------------ */

  function generate(name) {
    const def = SURFACES[name];
    const res = Math.max(128, def.res / shrink);
    const ctx = makeCtx(res, hashSeed(name) ^ 0x5f3a);
    def.build(ctx);

    const N = ctx.N;
    const ao = heightToAO(ctx.h, res, {
      relief: def.relief,
      strength: def.ao ?? 1.0,
      dirs: def.aoOpts?.dirs ?? 8,
      steps: def.aoOpts?.steps ?? 5,
      cavity: def.aoOpts?.cavity ?? 0.55,
      radius: 0.075,
    });

    const alb = new Uint8Array(N * 4);
    const orm = new Uint8Array(N * 4);
    const { ar, ag, ab, rg, mt, h } = ctx;
    const op = ctx.op;
    // Dither state, advanced per pixel. Inlined because at 1024x1024 this loop runs eight
    // million times and a function call per channel is measurable.
    let ds = 0x2545f491;
    for (let i = 0; i < N; i++) {
      const j = i * 4;
      // Energy conservation: keep albedo out of the physically implausible extremes. Nothing
      // real reflects less than ~2% or more than ~90%, and violating that flattens the
      // lighting response at both ends.
      let v;
      ds = (Math.imul(ds, 1103515245) + 12345) | 0;
      const d0 = ((ds >>> 16) & 255) / 255 - 0.5;
      ds = (Math.imul(ds, 1103515245) + 12345) | 0;
      const d1 = ((ds >>> 16) & 255) / 255 - 0.5;
      ds = (Math.imul(ds, 1103515245) + 12345) | 0;
      const d2 = ((ds >>> 16) & 255) / 255 - 0.5;

      v = ar[i] + d0;
      alb[j] = v < 7 ? 7 : v > 232 ? 232 : v;
      v = ag[i] + d1;
      alb[j + 1] = v < 7 ? 7 : v > 232 ? 232 : v;
      v = ab[i] + d2;
      alb[j + 2] = v < 7 ? 7 : v > 232 ? 232 : v;
      if (op) {
        v = op[i] * 255 + d0;
        alb[j + 3] = v < 0 ? 0 : v > 255 ? 255 : v;
      } else {
        alb[j + 3] = 255;
      }

      v = ao[i] * 255 + d1;
      orm[j] = v < 0 ? 0 : v > 255 ? 255 : v;
      // Clamp roughness away from 0: a perfectly smooth microfacet lobe aliases into a
      // single blinding pixel under a low sun.
      v = rg[i];
      v = (v < 0.035 ? 0.035 : v > 1 ? 1 : v) * 255 + d2;
      orm[j + 1] = v < 0 ? 0 : v > 255 ? 255 : v;
      v = mt[i] * 255 + d0;
      orm[j + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
      v = h[i] * 255 + d1;
      orm[j + 3] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    const nrm = heightToNormal(ctx.h, res, def.relief);

    const set = {
      map: makeTexture(alb, res, true),
      normalMap: makeTexture(nrm, res, false),
      ormMap: makeTexture(orm, res, false),
      res,
      relief: def.relief,
      hasAlpha: !!ctx.op,
      // Metres per texture period, published on the set as well as on `materials.tileMetres`
      // so that a consumer holding only the textures can retile them correctly. player/
      // weapon.js clones these maps and sets its own `repeat`, and that repeat is only right
      // if it is derived from the part's span in metres over this number — a hard-coded
      // repeat gives a 20 mm screw and a 260 mm handguard the same number of periods.
      tile: def.tile ?? 2.0,
    };
    set.roughnessMap = set.ormMap;
    set.metalnessMap = set.ormMap;
    set.aoMap = set.ormMap;
    set.heightMap = set.ormMap; // height lives in .a
    return set;
  }

  function getTextures(name) {
    if (!SURFACES[name]) name = 'concreteRough';
    let set = textureCache.get(name);
    if (!set) {
      set = generate(name);
      textureCache.set(name, set);
    }
    return set;
  }

  /* ------------------------------------------------------------------ */
  /* Shader patching                                                     */
  /* ------------------------------------------------------------------ */

  function buildUniforms(def, triplanar, scale) {
    const u = {
      uDetailNormal: { value: detailNormal },
      uDetailScale: { value: triplanar ? 8.0 : 8.0 },
      // The micro octave's frequency multiplier. Deliberately not an integer: an integer
      // ratio puts the two octaves back in register every few tiles and prints a beat.
      uDetailMicro: { value: 3.7 },
      uDetailStrength: { value: def.detail ?? 0.5 },
      uDetailFadeNear: { value: def.view ? 0.4 : 9.0 },
      // Held out to 30 m rather than 22. Inside the fade the surface has micro-relief; beyond
      // it there is nothing but the mip-averaged base normal, and the transition used to land
      // squarely in the middle of the yard, where the eye reads it as the ground going flat.
      uDetailFadeFar: { value: def.view ? 1.6 : 30.0 },
      uBreakup: { value: breakupNoise },
      // Tiles of `breakupNoise` per metre. 0.098 puts one tile across 10.2 m, and channel R
      // carries six periods per tile, so its three octaves land on 1.7 / 0.85 / 0.43 m —
      // exactly the meso band the ground was missing, and the same band the analytic fBm this
      // replaces was authored for.
      uBreakScale: { value: 0.098 },
      // Horizontal tiles per metre for the gravity streaks; the vertical axis is 0.15x that,
      // which is the same 0.62 m across / 4.2 m down stretch the streaks always had.
      uStreakScale: { value: 0.16 },
      uDustTint: { value: dustTint },
      // Shared by reference like every other palette colour here — one Color for the whole
      // material set, so nothing is allocated per material and nothing per frame.
      uDustAlbedo: { value: dustAlbedo },
      uAshAmount: { value: def.ash ?? 1.0 },
      uAshSharpness: { value: 2.8 },
      uAshRoughness: { value: 0.95 },
      uAshMetalKeep: { value: def.metalKeep ?? 0.15 },
      uMacroStrength: { value: def.view ? 0.0 : (def.macro ?? 0.075) },
      // One tile across 90 m, about the depth of the whole map. Channel R gives the 15 m
      // macro band at this scale and channel B the 45 m wide band, so the two incommensurate
      // macro octaves cost one fetch rather than two.
      uMacroScale: { value: 0.0111 },
      uMacroRough: { value: def.view ? 0.0 : (def.macroR ?? 0.06) },
      uMesoStrength: { value: def.view ? 0.0 : (def.meso ?? 0.075) },
      uMesoRough: { value: def.view ? 0.0 : (def.mesoR ?? 0.09) },
      uGrimeColour: { value: grimeColour },
      uGrimeStrength: { value: def.view ? 0.0 : (def.grime ?? 0.4) },
      uStreakStrength: { value: def.view ? 0.0 : (def.streak ?? 0.45) },
      uEdgeWear: { value: def.edge ?? 0.35 },
      uEdgeRough: { value: def.edgeR ?? 0.2 },
      uOxideColour: { value: oxideColour },
      uOxideStrength: { value: def.oxide ?? 0.0 },
      uFogAmount: { value: def.view ? 0.0 : 1.0 },
      uSpecAAStrength: { value: 0.6 },
    };
    if (triplanar) {
      // The caller's scale is the fine octave. The coarse octave is derived from the surface's
      // own authored tile size, so two surfaces that happen to be drawn at the same world
      // scale still break at different frequencies.
      const fine = Math.max(0.05, scale || def.tile || 2);
      const coarse = Math.max(fine * 2.0, def.tile ?? 2.0) * 2.6;
      u.uTriScale = { value: 1 / fine };
      u.uTriScale2 = { value: fine / coarse }; // multiplies uTriScale, so < 1 == coarser
      u.uTriBlend = { value: def.triBlend ?? 0.4 };
      u.uTriSharpness = { value: 5.0 };
    }
    // Shared by reference: sky.js mutates fogUniforms and every material sees it.
    for (const k of Object.keys(fogUniforms)) u[k] = fogUniforms[k];
    return u;
  }

  function makeHook(uniforms, triplanar) {
    return function ashOnBeforeCompile(shader) {
      // Idempotence guard. `registerShadow` chains this hook after `shadows.register`, but
      // shadows.js *also* chains the author's hook when it wraps `onBeforeCompile`, so without
      // this the hook runs twice against the same shader object and injects the whole ash
      // prelude twice — every varying, uniform and function is redefined and the program fails
      // to compile. Three calls the entire chain with one shader object per program, so a flag
      // on that object is enough, and it stays correct whatever order the wrappers end up in.
      if (shader.__ashPatched) return;
      shader.__ashPatched = true;

      for (const k of Object.keys(uniforms)) shader.uniforms[k] = uniforms[k];

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + PRELUDE_COMMON)
        .replace('#include <project_vertex>', VERTEX_INJECT);

      let frag = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\n' + PRELUDE_COMMON + PRELUDE_FRAG + (triplanar ? PRELUDE_FRAG_TRI : '')
      );

      if (triplanar) {
        // Replace every UV-space sample with a world-space triplanar one.
        frag = frag.replace(
          '#include <map_fragment>',
          /* glsl */ `
  vec3 ashTW = ashTriWeights();
  float ashAO = 1.0;
  vec4 ashORM = vec4( 1.0, 1.0, 0.0, 0.5 );
  // No manual EOTF: the albedo texture is uploaded as SRGB8_ALPHA8, so the sampler already
  // returns linear. Decoding again here would crush the midtones.
  #ifdef USE_MAP
    // Two projections of the same albedo at different world scales, blended. Triplanar
    // mapping ties feature size to world scale, so a 40 m ground plane and a 3 m slab sharing
    // a material otherwise show the identical motif at the identical size and read as one
    // object. Mixing (not adding) two samples of the same distribution is energy neutral, and
    // the coarse octave puts albedo content at a metre-plus wavelength — the only content
    // that survives the mip chain more than a few metres from the camera.
    diffuseColor *= mix(
      ashTriSample( map, vAshWorld, ashTW, uTriScale ),
      ashTriSample( map, vAshWorld, ashTW, uTriScale * uTriScale2 ),
      uTriBlend
    );
  #endif
  #ifdef USE_ROUGHNESSMAP
    ashORM = ashTriSample( roughnessMap, vAshWorld, ashTW, uTriScale );
    ashAO = ashORM.r;
  #endif
`
        );
        frag = frag.replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `
  float roughnessFactor = roughness;
  #ifdef USE_ROUGHNESSMAP
    roughnessFactor *= ashORM.g;
  #endif
`
        );
        frag = frag.replace('#include <metalnessmap_fragment>', FRAG_METAL_STD);
        frag = frag.replace('#include <normal_fragment_maps>', FRAG_NORMAL_TRI + FRAG_ASH);
        frag = frag.replace(
          '#include <aomap_fragment>',
          /* glsl */ `
  #ifdef USE_AOMAP
    float ambientOcclusion = ( ashAO - 1.0 ) * aoMapIntensity + 1.0;
    reflectedLight.indirectDiffuse *= ambientOcclusion;
    #if defined( USE_ENVMAP ) && defined( STANDARD )
      float ashDotNV = saturate( dot( geometryNormal, geometryViewDir ) );
      reflectedLight.indirectSpecular *= computeSpecularOcclusion( ashDotNV, ambientOcclusion, material.roughness );
    #endif
  #endif
`
        );
      } else {
        frag = frag.replace('#include <roughnessmap_fragment>', FRAG_ORM_STD);
        frag = frag.replace('#include <metalnessmap_fragment>', FRAG_METAL_STD);
        frag = frag.replace('#include <normal_fragment_maps>', FRAG_NORMAL_STD + FRAG_ASH);
      }

      frag = frag.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + FRAG_FOG);
      shader.fragmentShader = frag;
    };
  }

  /**
   * CSM's setupMaterial *overwrites* onBeforeCompile. Chain rather than clobber, and only
   * once per material.
   */
  function registerShadow(mat) {
    const s = state.shadows;
    if (!s || typeof s.register !== 'function') return;
    if (mat.userData.ashShadowed) return;
    const mine = mat.userData.ashHook;
    try {
      s.register(mat);
    } catch {
      return;
    }
    const theirs = mat.onBeforeCompile;
    if (theirs && theirs !== mine) {
      mat.onBeforeCompile = function chained(shader, r) {
        theirs.call(this, shader, r);
        if (mine) mine.call(this, shader, r);
      };
    } else if (mine) {
      mat.onBeforeCompile = mine;
    }
    mat.userData.ashShadowed = true;
    mat.needsUpdate = true;
  }

  function configure(mat, name, def, triplanar, scale) {
    const uniforms = buildUniforms(def, triplanar, scale);
    const hook = makeHook(uniforms, triplanar);
    mat.userData.ashHook = hook;
    mat.userData.ashUniforms = uniforms;
    mat.userData.surface = name;
    mat.userData.tileMetres = def.tile ?? 2.0;
    mat.onBeforeCompile = hook;
    // Two source variants only, so programs are still shared across the twenty surfaces.
    mat.customProgramCacheKey = () => (triplanar ? 'ashfall-tri' : 'ashfall-std');
    mat.userData.envBoost = def.envBoost ?? 1.0;
    mat.envMapIntensity = LIGHTING.envIntensity * mat.userData.envBoost;
    if (state.env) mat.envMap = state.env;
    allMaterials.add(mat);
    registerShadow(mat);
    return mat;
  }

  function buildMaterial(name, opts) {
    const def = SURFACES[name];
    const tex = getTextures(name);
    const triplanar = !!opts?.triplanar;

    const mat = new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.ormMap,
      metalnessMap: tex.ormMap,
      aoMap: tex.ormMap,
      // Everything the maps say is authoritative; these are the multipliers on top.
      color: 0xffffff,
      roughness: 1.0,
      metalness: 1.0,
      aoMapIntensity: 1.0,
      envMapIntensity: LIGHTING.envIntensity,
    });
    mat.name = `ash:${name}${triplanar ? ':tri' : ''}`;
    mat.normalScale = new THREE.Vector2(def.normal ?? 1, def.normal ?? 1);

    if (name === 'glassDirty') {
      // Dirty glass: mostly see-through, opaque where the grime and cracks are. The opacity
      // ramp rides in the albedo texture's alpha channel — `map_fragment` multiplies the
      // whole vec4 into diffuseColor, so no separate alphaMap (and no second texture) is
      // needed. Depth write stays on so blown-out window frames still occlude correctly.
      mat.transparent = true;
      mat.opacity = 1.0;
      mat.side = THREE.DoubleSide;
      mat.depthWrite = true;
    }

    if (opts?.repeat) {
      // A per-material UV scale without cloning the texture is not possible in three, so
      // clone the texture views. The GPU image is shared via Texture.source.
      const r = opts.repeat;
      const cloneRepeat = (t) => {
        const c = t.clone();
        c.wrapS = THREE.RepeatWrapping;
        c.wrapT = THREE.RepeatWrapping;
        c.repeat.set(r[0], r[1]);
        c.needsUpdate = true;
        allTextures.add(c);
        return c;
      };
      mat.map = cloneRepeat(tex.map);
      mat.normalMap = cloneRepeat(tex.normalMap);
      const orm = cloneRepeat(tex.ormMap);
      mat.roughnessMap = orm;
      mat.metalnessMap = orm;
      mat.aoMap = orm;
    }

    return configure(mat, name, def, triplanar, opts?.scale);
  }

  /* ------------------------------------------------------------------ */
  /* Decals                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * A 2x2 atlas of four variants in one texture. Every decal kind gets its own recipe; a
   * bullet hole in concrete does not look like one in sheet metal and must not share art.
   */
  function buildDecalAtlas(kind) {
    const res = 512 / shrink;
    const half = res >> 1;
    const rgba = new Uint8Array(res * res * 4);
    const nrm = new Uint8Array(res * res * 4);
    const seedBase = hashSeed('decal:' + kind);

    for (let v = 0; v < 4; v++) {
      const ox = (v & 1) * half;
      const oy = (v >> 1) * half;
      const seed = seedBase + v * 7919;
      const rnd = mulberry32(seed);

      // Per-variant fields at the tile resolution.
      const noise = fbmField(half, { seed: seed + 3, freq: 10, octaves: 5, gain: 0.55 });
      const rad = fbmField(half, { seed: seed + 11, freq: 5, octaves: 4 });
      const rays = fbmField(half, { seed: seed + 23, freq: 16, octaves: 4, op: OP_RIDGE });
      const fleck = fbmField(half, { seed: seed + 29, freq: 34, octaves: 4 });
      const h = new Float32Array(half * half);

      const cx = half * 0.5;
      const cy = half * 0.5;
      // Cast-off droplets for the blood kind, generated once rather than per pixel.
      const DROPS = 26;
      const dropX = new Float32Array(DROPS);
      const dropY = new Float32Array(DROPS);
      const dropR = new Float32Array(DROPS);
      const coreR = half * (kind === 'scorch' ? 0.2 : kind === 'blood' ? 0.16 : 0.09) * (0.8 + rnd() * 0.5);
      const outerR = half * (kind === 'scorch' ? 0.36 : kind === 'blood' ? 0.34 : 0.28) * (0.8 + rnd() * 0.45);

      if (kind === 'blood') {
        const drnd = mulberry32(seed + 555);
        for (let k = 0; k < DROPS; k++) {
          const ang = drnd() * Math.PI * 2;
          const dist = outerR * (0.6 + drnd() * 1.5);
          dropR[k] = half * (0.006 + drnd() * 0.022);
          dropX[k] = cx + Math.cos(ang) * dist;
          dropY[k] = cy + Math.sin(ang) * dist;
        }
      }

      for (let y = 0; y < half; y++) {
        for (let x = 0; x < half; x++) {
          const i = y * half + x;
          const dx = x - cx;
          const dy = y - cy;
          const a = Math.atan2(dy, dx);
          let d = Math.sqrt(dx * dx + dy * dy);
          // Distort the radius by angle so no decal is a circle.
          const wob = 1 + (rad[i] - 0.5) * 0.55 + Math.sin(a * (3 + (v % 3)) + seed) * 0.08;
          d /= wob;

          const core = 1 - smoothstep(coreR * 0.7, coreR, d);
          const ring = 1 - smoothstep(coreR, outerR, d);
          const rough = ring * (0.35 + noise[i] * 0.9);

          let alpha = 0;
          let r = 0;
          let g = 0;
          let b = 0;
          let hh = 0.5;

          if (kind === 'bulletConcrete') {
            // A dark crater, an irregular collar of freshly broken pale cement, and a faint
            // dust halo. The spall must be driven by radial noise, not by a Worley disc
            // field, or it comes out as a neat ring of identical dots.
            const crater = 1 - smoothstep(coreR * 0.55, coreR * 1.05, d);
            const collar = (1 - smoothstep(coreR * 0.95, outerR, d)) * smoothstep(coreR * 0.7, coreR * 1.35, d);
            const chip = collar * smoothstep(0.4, 0.72, noise[i] * 0.55 + rays[i] * 0.65);
            const dust = (1 - smoothstep(outerR * 0.65, outerR * 1.6, d)) * clamp01(fleck[i] - 0.35) * 0.8;
            alpha = clamp01(crater * 1.35 + chip * 0.95 + dust * 0.55);
            let c = mixc(shade(C.concreteShadow, 0.4), C.dust, clamp01(chip * 1.25 + dust));
            c = mixc(c, C.concreteLit, clamp01(chip - 0.4) * 1.4);
            r = c[0];
            g = c[1];
            b = c[2];
            hh = 0.5 - crater * 0.5 + chip * 0.14;
          } else if (kind === 'bulletMetal') {
            // Small bright crater with a torn, everted lip and radial scoring.
            const lip = smoothstep(coreR * 0.9, coreR * 1.25, d) * (1 - smoothstep(coreR * 1.25, coreR * 2.0, d));
            const scoring = rays[i] * ring * 0.7;
            alpha = clamp01(core * 1.3 + lip * 0.9 + scoring * 0.5);
            const c = mixc(shade(C.gunmetal, 0.5), C.steelBare, clamp01(lip * 1.4 + scoring * 0.6));
            r = c[0];
            g = c[1];
            b = c[2];
            hh = 0.5 - core * 0.5 + lip * 0.3;
          } else if (kind === 'bulletWood') {
            // Splintered, elongated along the grain.
            const grainD = Math.sqrt(dx * dx * 0.25 + dy * dy * 2.4) / wob;
            const sp = 1 - smoothstep(coreR * 0.8, outerR * 1.2, grainD);
            const splinter = sp * smoothstep(0.45, 0.85, rays[i]);
            alpha = clamp01(core * 1.2 + splinter * 0.95);
            const c = mixc(shade(C.woodWeathered, 0.4), C.woodSplinter, clamp01(splinter * 1.5));
            r = c[0];
            g = c[1];
            b = c[2];
            hh = 0.5 - core * 0.4 + splinter * 0.1;
          } else if (kind === 'blood') {
            // Central pool plus directional cast-off droplets.
            let drops = 0;
            for (let k = 0; k < DROPS; k++) {
              const ex = x - dropX[k];
              const ey = y - dropY[k];
              const rr = dropR[k];
              const dd2 = ex * ex + ey * ey;
              if (dd2 > rr * rr) continue;
              const v2 = 1 - smoothstep(rr * 0.7, rr, Math.sqrt(dd2));
              if (v2 > drops) drops = v2;
            }
            alpha = clamp01(core * 1.3 + ring * (0.5 + noise[i] * 0.8) + drops);
            const c = mixc(C.blood, shade(C.blood, 0.55), clamp01(1 - ring));
            r = c[0];
            g = c[1];
            b = c[2];
            hh = 0.5 + core * 0.06;
          } else {
            // scorch: soot, no crater, ragged sooty edge with lighter ash at the rim.
            const soot = clamp01(core * 1.1 + ring * (0.4 + noise[i] * 1.0));
            alpha = clamp01(soot * 0.95);
            const c = mixc(shade(C.gunRubber, 0.9), C.dust, clamp01((1 - ring) * noise[i] * 1.2));
            r = c[0];
            g = c[1];
            b = c[2];
            hh = 0.5;
          }

          h[i] = clamp01(hh);
          const o = ((oy + y) * res + (ox + x)) * 4;
          rgba[o] = Math.min(255, Math.max(0, r | 0));
          rgba[o + 1] = Math.min(255, Math.max(0, g | 0));
          rgba[o + 2] = Math.min(255, Math.max(0, b | 0));
          // Feather a wide margin at the tile border. A few pixels is not enough: at high
          // mip levels a decal that reaches its tile edge bleeds into the neighbouring
          // variant, and bullet holes acquire a ghost of the blood splat next door.
          const bx = Math.min(x, half - 1 - x);
          const by = Math.min(y, half - 1 - y);
          const border = smoothstep(0, half * 0.1, Math.min(bx, by));
          rgba[o + 3] = q8(alpha * border, i + v);
        }
      }

      const tileN = heightToNormal(h, half, kind === 'scorch' || kind === 'blood' ? 0.01 : 0.09);
      for (let y = 0; y < half; y++) {
        for (let x = 0; x < half; x++) {
          const s = (y * half + x) * 4;
          const o = ((oy + y) * res + (ox + x)) * 4;
          nrm[o] = tileN[s];
          nrm[o + 1] = tileN[s + 1];
          nrm[o + 2] = tileN[s + 2];
          nrm[o + 3] = 255;
        }
      }
    }

    const map = makeTexture(rgba, res, true);
    const normalMap = makeTexture(nrm, res, false);
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    normalMap.wrapS = normalMap.wrapT = THREE.ClampToEdgeWrapping;
    return { map, normalMap, res };
  }

  const decalAtlases = new Map();
  function getDecalAtlas(kind) {
    let a = decalAtlases.get(kind);
    if (!a) {
      a = buildDecalAtlas(kind);
      decalAtlases.set(kind, a);
    }
    return a;
  }

  /**
   * @param {string} kind    'bulletConcrete'|'bulletMetal'|'bulletWood'|'blood'|'scorch'
   * @param {number} [variant] 0..3; omit for variant 0. Each variant shares the GPU image.
   */
  function makeDecal(kind, variant) {
    const k = kind in DECAL_ROUGH ? kind : 'bulletConcrete';
    const v = Math.max(0, Math.min(3, variant | 0));
    const cacheKey = `${k}#${v}`;
    const hit = decalCache.get(cacheKey);
    if (hit) return hit;

    const atlas = getDecalAtlas(k);
    const uv = decalTile(v);
    const clone = (t) => {
      const c = t.clone();
      c.wrapS = THREE.ClampToEdgeWrapping;
      c.wrapT = THREE.ClampToEdgeWrapping;
      c.repeat.set(uv.s, uv.s);
      c.offset.set(uv.ox, uv.oy);
      c.anisotropy = aniso;
      c.needsUpdate = true;
      allTextures.add(c);
      return c;
    };

    const mat = new THREE.MeshStandardMaterial({
      map: clone(atlas.map),
      normalMap: clone(atlas.normalMap),
      transparent: true,
      depthWrite: false, // decals must never write depth or they fight the surface they sit on
      depthTest: true,
      polygonOffset: true,
      // Pull the decal towards the camera in depth so it wins the z-fight with its host face
      // without needing a geometric offset that would break at grazing angles.
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -6,
      side: THREE.FrontSide,
      roughness: DECAL_ROUGH[k],
      metalness: DECAL_METAL[k],
      envMapIntensity: LIGHTING.envIntensity,
      alphaTest: 0.01,
      color: 0xffffff,
    });
    mat.name = `ash:decal:${k}:${v}`;
    mat.normalScale = new THREE.Vector2(0.9, 0.9);

    // Decals get the ash and fog treatment too — a bullet hole that ignores the fog reads as
    // a sticker the moment it is more than twenty metres away.
    // Decals carry their own weathering in the atlas, and every world-space term below would
    // double-count it (or, worse, streak a bullet hole). Ash and fog only.
    const def = { detail: 0.15, ash: 0.5, tile: 0.4, macro: 0, macroR: 0, meso: 0, mesoR: 0, grime: 0, streak: 0, edge: 0, edgeR: 0, oxide: 0 };
    configure(mat, `decal:${k}`, def, false, 0);
    mat.userData.atlas = { cols: 2, rows: 2, variants: 4, tile: uv.s, offset: [uv.ox, uv.oy] };

    decalCache.set(cacheKey, mat);
    return mat;
  }

  /* ------------------------------------------------------------------ */
  /* Public surface                                                      */
  /* ------------------------------------------------------------------ */

  function get(name, opts) {
    if (state.disposed) return null;
    const key = opts?.repeat ? `${name}@${opts.repeat[0]}x${opts.repeat[1]}` : name;
    let mat = materialCache.get(key);
    if (!mat) {
      const safe = SURFACES[name] ? name : 'concreteRough';
      mat = buildMaterial(safe, opts);
      materialCache.set(key, mat);
    }
    return mat;
  }

  function triplanar(name, scale) {
    const safe = SURFACES[name] ? name : 'concreteRough';
    const s = scale || SURFACES[safe].tile || 2.0;
    const key = `${safe}#tri@${s}`;
    let mat = materialCache.get(key);
    if (!mat) {
      mat = buildMaterial(safe, { triplanar: true, scale: s });
      materialCache.set(key, mat);
    }
    return mat;
  }

  function attachShadows(next) {
    if (next) state.shadows = next;
    for (const mat of allMaterials) registerShadow(mat);
  }

  function setEnv(env) {
    state.env = env || null;
    for (const mat of allMaterials) {
      mat.envMap = state.env;
      // Metals live or die on their environment reflection: with the map at parity with the
      // dielectrics there is no glancing highlight anywhere and steel reads as grey paint.
      mat.envMapIntensity = LIGHTING.envIntensity * (mat.userData.envBoost ?? 1.0);
      mat.needsUpdate = true;
    }
  }

  function dispose() {
    state.disposed = true;
    for (const t of allTextures) {
      try {
        t.dispose();
      } catch {
        /* already gone */
      }
    }
    for (const m of allMaterials) {
      try {
        m.dispose();
      } catch {
        /* already gone */
      }
    }
    allTextures.clear();
    allMaterials.clear();
    textureCache.clear();
    materialCache.clear();
    decalCache.clear();
    decalAtlases.clear();
  }

  const materials = {
    get,
    getTextures,
    triplanar,
    makeDecal,
    decalTile,
    attachShadows,
    setEnvironment: setEnv,
    fogUniforms,
    detailNormal,
    list: () => Object.keys(SURFACES),
    surfaces: SURFACES,
    /** Metres per texture tile for a surface — level.js should scale UVs by this. */
    tileMetres: (name) => SURFACES[name]?.tile ?? 2.0,
    dispose,
  };

  // `materials.env = pmremTexture` must propagate to every cached material, so it is an
  // accessor rather than a plain field.
  Object.defineProperty(materials, 'env', {
    get: () => state.env,
    set: (v) => setEnv(v),
    enumerable: true,
  });

  return materials;
}

/* -------------------------------------------------------------------------- */
/* Decal constants and helpers                                                 */
/* -------------------------------------------------------------------------- */

const DECAL_ROUGH = {
  bulletConcrete: 0.92,
  bulletMetal: 0.4,
  bulletWood: 0.85,
  blood: 0.34, // wet blood is glossy; the FX layer can lerp this up as it dries
  scorch: 0.96,
};

const DECAL_METAL = {
  bulletConcrete: 0.0,
  bulletMetal: 0.85,
  bulletWood: 0.0,
  blood: 0.0,
  scorch: 0.0,
};

/** UV transform for one variant of a 2x2 decal atlas. */
function decalTile(variant) {
  const v = Math.max(0, Math.min(3, variant | 0));
  return { ox: (v & 1) * 0.5, oy: (v >> 1) * 0.5, s: 0.5 };
}

export default createMaterials;
