/**
 * Ashfall — src/fx/particles.js
 *
 * Every particle, decal, casing, tracer, flash and haze billboard in the game.
 *
 * ---------------------------------------------------------------------------------------
 * DESIGN
 * ---------------------------------------------------------------------------------------
 * One reusable particle system, instantiated twice: an alpha-blended pool (smoke, dust,
 * debris, blood, shards, sand) and an additive pool (sparks, muzzle lobes, embers, tracers,
 * fireball). Both are a single `THREE.Mesh` over an `InstancedBufferGeometry` sharing one
 * procedurally generated 4x4 texture atlas, so the entire particle budget costs **two draw
 * calls**. Simulation is CPU-side over structure-of-arrays `Float32Array`s; four `vec4`
 * instanced attributes are uploaded once per frame.
 *
 * Both materials write *premultiplied* alpha (`rgb * a, a`). That single convention lets the
 * same shader serve "over" blending (dst factor `1 - srcAlpha`) and additive blending (dst
 * factor `1`) with no branches, and it keeps HDR values above 1.0 intact so the bloom
 * threshold in postfx picks up muzzle flashes and tracer cores.
 *
 * ---------------------------------------------------------------------------------------
 * SOFT PARTICLES
 * ---------------------------------------------------------------------------------------
 * Hard intersections between a billboard and world geometry are the single loudest "this is
 * a hobby demo" tell, so every alpha particle fades out as it approaches the surface behind
 * it. The depth we compare against is `engine.targets.normal.depthTexture` — the prepass
 * depth — **not** `targets.hdr.depthTexture`. The HDR depth attachment is bound to the
 * framebuffer we are drawing into, and sampling a bound attachment is a feedback loop with
 * undefined results. The prepass target is a separate FBO written earlier in the same frame
 * and holds exactly what we want: opaque world depth without the viewmodel and without
 * transparent surfaces. At `low` the engine skips the prepass and leaves that depth cleared
 * to 1.0, which linearises to the far plane, which makes the fade a no-op. That is the
 * correct graceful degradation, not a bug.
 *
 * ---------------------------------------------------------------------------------------
 * SORTING
 * ---------------------------------------------------------------------------------------
 * The alpha pool is sorted back-to-front every frame with a 256-bucket counting sort over
 * squared camera distance — O(n) with preallocated scratch, no comparator, no allocation.
 * The additive pool is order independent and is not sorted.
 *
 * ---------------------------------------------------------------------------------------
 * ALLOCATION
 * ---------------------------------------------------------------------------------------
 * Nothing in `update()` or in any `spawn*` allocates. Emission goes through a single
 * module-scope descriptor (`EM`) that callers fill in and the pool reads; vectors,
 * quaternions and matrices are module-scope scratch. Pools are sized at the `ultra`
 * capacity once and the live budget is clamped per quality preset, so `setQuality` never
 * reallocates a GPU buffer mid-session.
 */

import * as THREE from '../../vendor/three.module.js';
import {
  PALETTE,
  ATMOSPHERE,
  SURFACES,
  LIGHTING,
  SUN_ELEVATION,
  SUN_AZIMUTH,
} from '../world/art.js';

/* -------------------------------------------------------------------------- */
/* Atlas layout                                                                */
/* -------------------------------------------------------------------------- */

const ATLAS_TILE = 256;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 4;

/** Tile indices into the particle atlas. Row-major from the top-left. */
const T_SMOKE_A = 0;
const T_SMOKE_B = 1;
const T_SMOKE_C = 2;
const T_SMOKE_D = 3;
const T_SPARK = 4;
const T_CHIP_A = 5;
const T_CHIP_B = 6;
const T_BLOOD_MIST = 7;
const T_BLOOD_SPLAT = 8;
const T_STAR = 9;
const T_SHARD_A = 10;
const T_SHARD_B = 11;
const T_GLOW = 12;
const T_EMBER = 13;
const T_STREAK = 14;
const T_CLOD = 15;

const SMOKE_TILES = [T_SMOKE_A, T_SMOKE_B, T_SMOKE_C, T_SMOKE_D];

/** Decal atlas: 4 x 2 tiles of 256 px. */
const DECAL_TILE = 256;
const DECAL_COLS = 4;
const DECAL_ROWS = 2;

const D_CONCRETE = 0;
const D_METAL = 1;
const D_WOOD = 2;
const D_GLASS = 3;
const D_DIRT = 4;
const D_SANDBAG = 5;
const D_BLOOD = 6;
const D_SCORCH = 7;

/** `addDecal(point, normal, kind, size)` kind strings -> atlas tile. */
const DECAL_KIND = {
  bulletConcrete: D_CONCRETE,
  concrete: D_CONCRETE,
  bulletMetal: D_METAL,
  metal: D_METAL,
  bulletWood: D_WOOD,
  wood: D_WOOD,
  bulletGlass: D_GLASS,
  glass: D_GLASS,
  bulletDirt: D_DIRT,
  dirt: D_DIRT,
  gravel: D_DIRT,
  bulletSandbag: D_SANDBAG,
  sandbag: D_SANDBAG,
  blood: D_BLOOD,
  scorch: D_SCORCH,
};

/* -------------------------------------------------------------------------- */
/* Particle flags                                                              */
/* -------------------------------------------------------------------------- */

const F_ALIGN = 1 << 0; // stretch the billboard along `axis`
const F_GROUND = 1 << 1; // bounce off `bounceY`
const F_TRACER = 1 << 2; // distance-based fade-in, hard tail-off
const F_TURB = 1 << 3; // curl-ish turbulence, for smoke
const F_AXIS_VEL = 1 << 4; // keep `axis` locked to the velocity direction
const F_SPIN_DAMP = 1 << 5; // angular velocity decays with linear drag

/* -------------------------------------------------------------------------- */
/* Quality (ARCHITECTURE.md §5)                                                */
/* -------------------------------------------------------------------------- */

/**
 * `particles` is the multiplier from the preset table; it scales both the live budget and
 * per-burst counts, so a `low` machine gets fewer *and* cheaper bursts rather than the same
 * burst clipped halfway through. `soft` gates the depth fetch in the fragment shader.
 */
const FX_QUALITY = {
  low: { particles: 0.35, decals: 64, casings: 20, lights: 2, motes: 0, columns: 0, soft: false, rings: 2 },
  medium: { particles: 0.6, decals: 128, casings: 40, lights: 2, motes: 150, columns: 1, soft: true, rings: 3 },
  high: { particles: 1.0, decals: 256, casings: 64, lights: 3, motes: 300, columns: 2, soft: true, rings: 4 },
  ultra: { particles: 1.4, decals: 256, casings: 96, lights: 3, motes: 460, columns: 2, soft: true, rings: 4 },
};

/** Absolute pool capacities — allocated once at the ultra figure, budget-clamped below. */
const CAP_ALPHA = 2000;
const CAP_ADD = 1700;
const CAP_MOTES = 480;
const CAP_DECALS = 256;
const CAP_CASINGS = 96;
const CAP_RINGS = 4;

const SORT_BUCKETS = 256;
const SORT_FAR = 170; // metres; anything beyond lands in the last bucket, which is fine

/* -------------------------------------------------------------------------- */
/* Module scratch — the hot path must not allocate                             */
/* -------------------------------------------------------------------------- */

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _m0 = new THREE.Matrix4();
const _c0 = new THREE.Color();
const _c1 = new THREE.Color();
const _scale = new THREE.Vector3(1, 1, 1);
const _audioOpts = { position: _v4, volume: 1, pitch: 1, surface: 'concrete' };

const UNIT_Z = new THREE.Vector3(0, 0, 1);
const UNIT_Y = new THREE.Vector3(0, 1, 0);

/* -------------------------------------------------------------------------- */
/* Random                                                                      */
/* -------------------------------------------------------------------------- */

/** Deterministic LCG for texture synthesis, so the atlas is byte-identical every run. */
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Runtime randomness. Cheap xorshift — `Math.random` is fine but this keeps it inlinable. */
let _rs = 0x9e3779b9;
function rnd() {
  _rs ^= _rs << 13;
  _rs ^= _rs >>> 17;
  _rs ^= _rs << 5;
  _rs >>>= 0;
  return _rs / 4294967296;
}
/** Symmetric noise in [-1, 1]. */
function rndS() {
  return rnd() * 2 - 1;
}
function rndR(a, b) {
  return a + (b - a) * rnd();
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/** Linear-space colour components for an sRGB hex from art.js. */
function lin(hex, out) {
  out.setStyle(hex, THREE.SRGBColorSpace);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Procedural atlas synthesis                                                  */
/* -------------------------------------------------------------------------- */

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Convert an accumulated luminance field into a soft alpha shape.
 *
 * `shade` bleeds density back into RGB so the interior of a smoke puff is not a flat white
 * card: dense cores read slightly darker, which is what gives a billowing volume its form
 * once the sun light term multiplies over it. `window` applies a circular falloff so nothing
 * can clip against the tile border and bleed into its neighbour.
 */
function lumaToAlpha(ctx, size, opts) {
  const shade = opts.shade || 0;
  const gain = opts.gain === undefined ? 1 : opts.gain;
  const bias = opts.bias || 0;
  const win = opts.window === undefined ? true : opts.window;
  const winStart = opts.winStart === undefined ? 0.66 : opts.winStart;
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const half = size * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) << 2;
      let a = (d[i] / 255) * gain + bias;
      if (a <= 0) {
        d[i] = 0;
        d[i + 1] = 0;
        d[i + 2] = 0;
        d[i + 3] = 0;
        continue;
      }
      if (win) {
        const dx = (x + 0.5 - half) / half;
        const dy = (y + 0.5 - half) / half;
        const r = Math.sqrt(dx * dx + dy * dy);
        let k = clamp((0.995 - r) / (0.995 - winStart), 0, 1);
        k = k * k * (3 - 2 * k);
        a *= k;
      }
      a = clamp(a, 0, 1);
      const v = clamp(1 - shade * a, 0, 1);
      const c = (v * 255) | 0;
      d[i] = c;
      d[i + 1] = c;
      d[i + 2] = c;
      d[i + 3] = (a * 255) | 0;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Additive soft blob. The workhorse for every accumulated shape below. */
function blob(ctx, x, y, r, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.45, `rgba(255,255,255,${a * 0.42})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * A billowing puff, not a radial gradient.
 *
 * Built from 3-5 *lobes*, each a cluster of soft blobs with a power-biased radial
 * distribution so mass piles up towards the lobe centre. A second pass of small blobs at low
 * alpha breaks the interior into the fine density variation real smoke has. `variant`
 * reshapes the lobe count and eccentricity so the four tiles read as genuinely different
 * shapes when a burst mixes them.
 */
function drawSmokeTile(ctx, size, rng, variant) {
  const c = size * 0.5;
  ctx.clearRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';

  const lobes = 3 + (variant % 3);
  const ecc = 0.72 + (variant % 2) * 0.34;
  const spin = rng() * Math.PI * 2;

  for (let l = 0; l < lobes; l++) {
    const la = spin + (l / lobes) * Math.PI * 2 + rng() * 0.9;
    const ld = (0.16 + rng() * 0.22) * size;
    const lx = c + Math.cos(la) * ld * ecc;
    const ly = c + Math.sin(la) * ld;
    const lr = size * (0.13 + rng() * 0.1);
    const n = 22 + ((rng() * 12) | 0);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.pow(rng(), 0.55) * lr * 1.6;
      const x = lx + Math.cos(a) * r;
      const y = ly + Math.sin(a) * r * 0.9;
      blob(ctx, x, y, size * (0.045 + rng() * 0.075), 0.17 + rng() * 0.1);
    }
  }

  // Core mass, so the puff has a centre of gravity rather than a ring of lobes.
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 0.5) * size * 0.17;
    blob(ctx, c + Math.cos(a) * r, c + Math.sin(a) * r, size * (0.07 + rng() * 0.08), 0.16);
  }

  // Fine internal structure. Small, dense, low alpha — this is the detail that stops the
  // puff reading as a blurred circle when it fills half the screen.
  for (let i = 0; i < 320; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 0.42) * size * 0.36;
    blob(ctx, c + Math.cos(a) * r * ecc, c + Math.sin(a) * r, size * (0.012 + rng() * 0.035), 0.09);
  }

  ctx.globalCompositeOperation = 'source-over';
  lumaToAlpha(ctx, size, { shade: 0.34, gain: 1.18, window: true, winStart: 0.6 });
}

/** A tapered spark streak: hot head, thin tail, drawn straight into the pixels. */
function drawSparkTile(ctx, size) {
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const cx = size * 0.5;
  for (let y = 0; y < size; y++) {
    // t = 0 at the tail (top of the tile), 1 at the head (bottom).
    const t = y / (size - 1);
    // Head-weighted envelope: mass concentrates in the last third, tail thins to nothing.
    const env = Math.pow(t, 1.7) * Math.pow(1 - t * 0.92, 0.35);
    const w = 1.1 + 5.4 * env * (size / 256);
    const peak = clamp(env * 2.35, 0, 1);
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - cx) / w;
      const g = Math.exp(-dx * dx * 1.6);
      let a = peak * g;
      // The head itself is a hot round point, brighter than the streak feeding it.
      const hy = (y - size * 0.84) / (size * 0.055);
      const hx = (x - cx) / (size * 0.05);
      a += Math.exp(-(hx * hx + hy * hy)) * 0.95;
      a = clamp(a, 0, 1);
      const i = (y * size + x) << 2;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = (a * 255) | 0;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Irregular angular polygon with a bevel gradient — a concrete chip or a wood splinter. */
function drawChipTile(ctx, size, rng, elongation) {
  ctx.clearRect(0, 0, size, size);
  const c = size * 0.5;
  const n = 5 + ((rng() * 3) | 0);
  const base = size * 0.33;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.35;
    const r = base * (0.5 + rng() * 0.75);
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r * elongation;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  // A directional gradient stands in for a lit facet: one edge catches the key, the opposite
  // edge falls away. Without it a chip is a flat silhouette and reads as a hole.
  const g = ctx.createLinearGradient(c - base, c - base, c + base, c + base);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.42, 'rgba(206,206,206,1)');
  g.addColorStop(1, 'rgba(104,104,104,1)');
  ctx.fillStyle = g;
  ctx.fill();
  // A crisp highlight along the top-left break line.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(1, size * 0.006);
  ctx.stroke();
}

/** Blood mist: a spray of droplets with a soft core, spikier and sparser than smoke. */
function drawBloodMistTile(ctx, size, rng) {
  const c = size * 0.5;
  ctx.clearRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 44; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 0.6) * size * 0.3;
    blob(ctx, c + Math.cos(a) * r, c + Math.sin(a) * r, size * (0.03 + rng() * 0.08), 0.26);
  }
  for (let i = 0; i < 150; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 0.32) * size * 0.42;
    blob(ctx, c + Math.cos(a) * r, c + Math.sin(a) * r, size * (0.006 + rng() * 0.02), 0.5);
  }
  ctx.globalCompositeOperation = 'source-over';
  lumaToAlpha(ctx, size, { shade: 0.2, gain: 1.3, window: true, winStart: 0.62 });
}

/** A wet splat: lobed central mass, radiating tendrils, satellite droplets. */
function drawBloodSplatTile(ctx, size, rng) {
  const c = size * 0.5;
  ctx.clearRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';

  // Lobed body via a polar radius with two noise harmonics.
  const p1 = rng() * 6.28;
  const p2 = rng() * 6.28;
  ctx.beginPath();
  const steps = 96;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r =
      size *
      (0.24 + 0.055 * Math.sin(a * 3 + p1) + 0.035 * Math.sin(a * 7 + p2) + 0.02 * Math.sin(a * 13));
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fill();

  // Tendrils: tapered spurs thrown out of the impact.
  for (let i = 0; i < 11; i++) {
    const a = rng() * Math.PI * 2;
    const len = size * (0.12 + rng() * 0.22);
    const w = size * (0.012 + rng() * 0.02);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a + 0.14) * size * 0.2, c + Math.sin(a + 0.14) * size * 0.2);
    ctx.quadraticCurveTo(
      c + Math.cos(a) * (size * 0.2 + len * 0.6),
      c + Math.sin(a) * (size * 0.2 + len * 0.6),
      c + Math.cos(a) * (size * 0.2 + len),
      c + Math.sin(a) * (size * 0.2 + len)
    );
    ctx.lineTo(c + Math.cos(a - 0.14) * size * 0.2, c + Math.sin(a - 0.14) * size * 0.2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
    // Terminal droplet — surface tension pulls a bead onto the end of every spur.
    blob(ctx, c + Math.cos(a) * (size * 0.2 + len), c + Math.sin(a) * (size * 0.2 + len), w, 0.9);
  }

  for (let i = 0; i < 46; i++) {
    const a = rng() * Math.PI * 2;
    const r = size * (0.24 + Math.pow(rng(), 0.7) * 0.22);
    blob(ctx, c + Math.cos(a) * r, c + Math.sin(a) * r, size * (0.005 + rng() * 0.016), 0.95);
  }

  ctx.globalCompositeOperation = 'source-over';
  lumaToAlpha(ctx, size, { shade: 0.42, gain: 1.4, window: true, winStart: 0.74 });
}

/**
 * Muzzle star. A hot core, six primary rays of alternating length, and a faint corona.
 * Deliberately not symmetric — a real flash is shaped by the crown of the muzzle device.
 */
function drawStarTile(ctx, size, rng) {
  const c = size * 0.5;
  ctx.clearRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';

  const rays = 6;
  const spin = rng() * 1.0;
  for (let i = 0; i < rays; i++) {
    const a = spin + (i / rays) * Math.PI * 2;
    const len = size * (i % 2 === 0 ? 0.42 + rng() * 0.06 : 0.24 + rng() * 0.06);
    const w = size * (0.045 + rng() * 0.03);
    const ex = c + Math.cos(a) * len;
    const ey = c + Math.sin(a) * len;
    const g = ctx.createLinearGradient(c, c, ex, ey);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a + Math.PI / 2) * w, c + Math.sin(a + Math.PI / 2) * w);
    ctx.lineTo(ex, ey);
    ctx.lineTo(c + Math.cos(a - Math.PI / 2) * w, c + Math.sin(a - Math.PI / 2) * w);
    ctx.closePath();
    ctx.fill();
  }

  // Irregular inner burst: the plume of unburnt powder immediately at the crown.
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 0.7) * size * 0.13;
    blob(ctx, c + Math.cos(a) * r, c + Math.sin(a) * r, size * (0.035 + rng() * 0.06), 0.5);
  }
  blob(ctx, c, c, size * 0.13, 1.0);
  blob(ctx, c, c, size * 0.3, 0.16);

  ctx.globalCompositeOperation = 'source-over';
  lumaToAlpha(ctx, size, { shade: 0, gain: 1.0, window: true, winStart: 0.82 });
}

/** A glass sliver: thin triangle, bright catching edge, faint internal facet. */
function drawShardTile(ctx, size, rng, slim) {
  ctx.clearRect(0, 0, size, size);
  const c = size * 0.5;
  const h = size * (slim ? 0.42 : 0.34);
  const w = size * (slim ? 0.075 : 0.17);
  const skew = rndFrom(rng, -0.35, 0.35) * w;

  const ax = c - w + skew;
  const ay = c + h;
  const bx = c + w + skew * 0.4;
  const by = c + h * 0.82;
  const tx = c + skew * 0.2;
  const ty = c - h;

  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(tx, ty);
  ctx.closePath();
  const g = ctx.createLinearGradient(ax, ay, bx, ty);
  g.addColorStop(0, 'rgba(150,150,150,1)');
  g.addColorStop(0.5, 'rgba(232,232,232,1)');
  g.addColorStop(1, 'rgba(96,96,96,1)');
  ctx.fillStyle = g;
  ctx.fill();

  // The catching edge. Glass reads as glass because one edge is a specular line.
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = Math.max(1.2, size * 0.009);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(tx, ty);
  ctx.stroke();

  // Internal facet line.
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(1, size * 0.005);
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(c + skew * 0.2, c - h * 0.35);
  ctx.stroke();
}

function rndFrom(rng, a, b) {
  return a + (b - a) * rng();
}

/** Plain gaussian glow — cores, flash bloom seeds, light kernels. */
function drawGlowTile(ctx, size) {
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const c = size * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - c) / (size * 0.46);
      const dy = (y + 0.5 - c) / (size * 0.46);
      const r2 = dx * dx + dy * dy;
      // Two lobes: a tight core over a broad halo. A single gaussian looks like a dot.
      const a = clamp(Math.exp(-r2 * 9.0) * 0.85 + Math.exp(-r2 * 1.7) * 0.35, 0, 1);
      const i = (y * size + x) << 2;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = (a * 255) | 0;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Ember: a hot centre with a soft, slightly ragged halo. */
function drawEmberTile(ctx, size, rng) {
  ctx.clearRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';
  const c = size * 0.5;
  blob(ctx, c, c, size * 0.085, 1.0);
  blob(ctx, c, c, size * 0.26, 0.2);
  for (let i = 0; i < 9; i++) {
    const a = rng() * 6.283;
    const r = size * (0.06 + rng() * 0.11);
    blob(ctx, c + Math.cos(a) * r, c + Math.sin(a) * r, size * (0.02 + rng() * 0.03), 0.28);
  }
  ctx.globalCompositeOperation = 'source-over';
  lumaToAlpha(ctx, size, { shade: 0, gain: 1.0, window: true, winStart: 0.8 });
}

/**
 * Tracer capsule, oriented along the tile's +Y so the shader's stretch axis lines up.
 * Bright thin core, gaussian cross-section, hot head at the bottom, tail fading to nothing.
 */
function drawStreakTile(ctx, size) {
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const cx = size * 0.5;
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1); // 0 tail, 1 head
    const along = Math.pow(t, 0.85) * (1 - Math.pow(Math.max(0, t - 0.94) / 0.06, 2));
    const w = size * (0.012 + 0.028 * along);
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - cx) / w;
      const core = Math.exp(-dx * dx * 2.2);
      const halo = Math.exp(-dx * dx * 0.18) * 0.28;
      let a = clamp((core + halo) * clamp(along, 0, 1), 0, 1);
      const hy = (y - size * 0.9) / (size * 0.05);
      a = clamp(a + Math.exp(-(dx * dx * 0.9 + hy * hy)) * 0.7, 0, 1);
      const i = (y * size + x) << 2;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = (a * 255) | 0;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Dirt clod / sand cluster: lumpy mass with grains shaken loose around it. */
function drawClodTile(ctx, size, rng) {
  ctx.clearRect(0, 0, size, size);
  const c = size * 0.5;
  const p1 = rng() * 6.28;
  ctx.beginPath();
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r =
      size * (0.2 + 0.05 * Math.sin(a * 4 + p1) + 0.03 * Math.sin(a * 9 + p1 * 2) + 0.02 * Math.sin(a * 15));
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(c - size * 0.09, c - size * 0.09, size * 0.02, c, c, size * 0.26);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(178,178,178,1)');
  g.addColorStop(1, 'rgba(88,88,88,1)');
  ctx.fillStyle = g;
  ctx.fill();

  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 24; i++) {
    const a = rng() * 6.283;
    const r = size * (0.22 + Math.pow(rng(), 0.6) * 0.18);
    blob(ctx, c + Math.cos(a) * r, c + Math.sin(a) * r, size * (0.006 + rng() * 0.016), 0.85);
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Assemble the 4x4 particle atlas. */
function buildParticleAtlas() {
  const size = ATLAS_TILE;
  const sheet = newCanvas(ATLAS_COLS * size, ATLAS_ROWS * size);
  const sctx = sheet.getContext('2d');
  if (!sctx) return null;
  sctx.clearRect(0, 0, sheet.width, sheet.height);

  const tile = newCanvas(size, size);
  const tctx = tile.getContext('2d');
  if (!tctx) return null;

  const rng = makeRng(0xa5f411);
  const put = (index) => {
    const col = index % ATLAS_COLS;
    const row = (index / ATLAS_COLS) | 0;
    sctx.clearRect(col * size, row * size, size, size);
    sctx.drawImage(tile, col * size, row * size);
  };

  for (let i = 0; i < 4; i++) {
    drawSmokeTile(tctx, size, rng, i);
    put(T_SMOKE_A + i);
  }
  drawSparkTile(tctx, size);
  put(T_SPARK);
  drawChipTile(tctx, size, rng, 1.0);
  put(T_CHIP_A);
  drawChipTile(tctx, size, rng, 0.5);
  put(T_CHIP_B);
  drawBloodMistTile(tctx, size, rng);
  put(T_BLOOD_MIST);
  drawBloodSplatTile(tctx, size, rng);
  put(T_BLOOD_SPLAT);
  drawStarTile(tctx, size, rng);
  put(T_STAR);
  drawShardTile(tctx, size, rng, true);
  put(T_SHARD_A);
  drawShardTile(tctx, size, rng, false);
  put(T_SHARD_B);
  drawGlowTile(tctx, size);
  put(T_GLOW);
  drawEmberTile(tctx, size, rng);
  put(T_EMBER);
  drawStreakTile(tctx, size);
  put(T_STREAK);
  drawClodTile(tctx, size, rng);
  put(T_CLOD);

  const tex = new THREE.CanvasTexture(sheet);
  tex.name = 'fx:particleAtlas';
  // No mipmaps: the atlas is tiled, and a coarse mip would blend neighbouring tiles into
  // each other. Particles are rarely minified enough for the aliasing to matter.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Last-resort atlas if 2D canvas is unavailable: soft radial tiles, no shapes. */
function buildFallbackAtlas() {
  const size = 64;
  const w = ATLAS_COLS * size;
  const h = ATLAS_ROWS * size;
  const data = new Uint8Array(w * h * 4);
  for (let ty = 0; ty < ATLAS_ROWS; ty++) {
    for (let tx = 0; tx < ATLAS_COLS; tx++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (x + 0.5) / size - 0.5;
          const dy = (y + 0.5) / size - 0.5;
          const r2 = (dx * dx + dy * dy) * 4;
          const a = clamp(1 - r2, 0, 1);
          const i = ((ty * size + y) * w + (tx * size + x)) * 4;
          data[i] = 255;
          data[i + 1] = 255;
          data[i + 2] = 255;
          data[i + 3] = (a * a * 255) | 0;
        }
      }
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.name = 'fx:particleAtlasFallback';
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* -------------------------------------------------------------------------- */
/* Decal atlas                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Bullet holes are drawn as *lit albedo*, not as a silhouette: the crater is near black, the
 * pulverised rim is near white, and the decal shader multiplies the whole thing by a cheap
 * N.L against the sun. That is what makes a hole sit in the surface instead of on it.
 */
function drawHoleConcrete(ctx, size, rng) {
  const c = size * 0.5;
  ctx.clearRect(0, 0, size, size);

  // Dust halo first, so the crater draws over it.
  const halo = ctx.createRadialGradient(c, c, size * 0.06, c, c, size * 0.44);
  halo.addColorStop(0, 'rgba(226,220,206,0.85)');
  halo.addColorStop(0.42, 'rgba(210,203,188,0.42)');
  halo.addColorStop(1, 'rgba(200,193,178,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.44, 0, 6.283);
  ctx.fill();

  // Spall: irregular chipped-out ring around the entry.
  for (let i = 0; i < 30; i++) {
    const a = rng() * 6.283;
    const r = size * (0.1 + Math.pow(rng(), 0.6) * 0.2);
    const rr = size * (0.012 + rng() * 0.03);
    ctx.fillStyle = `rgba(238,233,221,${0.25 + rng() * 0.35})`;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, rr, 0, 6.283);
    ctx.fill();
  }

  // Radial cracks.
  ctx.strokeStyle = 'rgba(24,22,20,0.6)';
  for (let i = 0; i < 7; i++) {
    const a = rng() * 6.283;
    const len = size * (0.14 + rng() * 0.24);
    ctx.lineWidth = Math.max(1, size * (0.004 + rng() * 0.006));
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.quadraticCurveTo(
      c + Math.cos(a + 0.3) * len * 0.55,
      c + Math.sin(a + 0.3) * len * 0.55,
      c + Math.cos(a) * len,
      c + Math.sin(a) * len
    );
    ctx.stroke();
  }

  // The crater. Off-centre bright lip on the upper-left reads as a lit bevel.
  const hole = ctx.createRadialGradient(c - size * 0.02, c - size * 0.02, 0, c, c, size * 0.115);
  hole.addColorStop(0, 'rgba(8,7,7,1)');
  hole.addColorStop(0.62, 'rgba(20,18,17,0.98)');
  hole.addColorStop(0.86, 'rgba(74,68,62,0.7)');
  hole.addColorStop(1, 'rgba(120,113,102,0)');
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.115, 0, 6.283);
  ctx.fill();

  ctx.strokeStyle = 'rgba(246,242,232,0.5)';
  ctx.lineWidth = Math.max(1, size * 0.008);
  ctx.beginPath();
  ctx.arc(c, c, size * 0.1, Math.PI * 0.85, Math.PI * 1.85);
  ctx.stroke();
}

function drawHoleMetal(ctx, size, rng) {
  const c = size * 0.5;
  ctx.clearRect(0, 0, size, size);

  // Paint blown off around the strike, exposing bare steel.
  const strip = ctx.createRadialGradient(c, c, size * 0.05, c, c, size * 0.3);
  strip.addColorStop(0, 'rgba(196,201,206,0.9)');
  strip.addColorStop(0.5, 'rgba(150,155,160,0.45)');
  strip.addColorStop(1, 'rgba(140,145,150,0)');
  ctx.fillStyle = strip;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.3, 0, 6.283);
  ctx.fill();

  // Torn petals of metal folded back out of the hole.
  for (let i = 0; i < 9; i++) {
    const a = rng() * 6.283;
    const r0 = size * 0.055;
    const r1 = size * (0.09 + rng() * 0.08);
    const w = 0.16 + rng() * 0.16;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a - w) * r0, c + Math.sin(a - w) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.lineTo(c + Math.cos(a + w) * r0, c + Math.sin(a + w) * r0);
    ctx.closePath();
    ctx.fillStyle = `rgba(${210 + ((rng() * 40) | 0)},${212 + ((rng() * 40) | 0)},214,0.85)`;
    ctx.fill();
  }

  // Gouges radiating from the strike.
  ctx.strokeStyle = 'rgba(230,234,238,0.42)';
  for (let i = 0; i < 12; i++) {
    const a = rng() * 6.283;
    ctx.lineWidth = Math.max(1, size * 0.004);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * size * 0.06, c + Math.sin(a) * size * 0.06);
    ctx.lineTo(c + Math.cos(a) * size * (0.12 + rng() * 0.16), c + Math.sin(a) * size * (0.12 + rng() * 0.16));
    ctx.stroke();
  }

  const hole = ctx.createRadialGradient(c, c, 0, c, c, size * 0.062);
  hole.addColorStop(0, 'rgba(4,4,5,1)');
  hole.addColorStop(0.7, 'rgba(10,11,12,1)');
  hole.addColorStop(1, 'rgba(30,32,34,0)');
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.062, 0, 6.283);
  ctx.fill();
}

function drawHoleWood(ctx, size, rng) {
  const c = size * 0.5;
  ctx.clearRect(0, 0, size, size);

  // Splinters lift along the grain, which runs horizontally on the tile.
  for (let i = 0; i < 22; i++) {
    const a = rng() * 6.283;
    const grain = Math.cos(a) * Math.cos(a); // bias the spread along X
    const len = size * (0.06 + rng() * 0.2) * (0.45 + grain);
    const w = 0.05 + rng() * 0.1;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a - w) * size * 0.05, c + Math.sin(a - w) * size * 0.05);
    ctx.lineTo(c + Math.cos(a) * (size * 0.05 + len), c + Math.sin(a) * (size * 0.05 + len));
    ctx.lineTo(c + Math.cos(a + w) * size * 0.05, c + Math.sin(a + w) * size * 0.05);
    ctx.closePath();
    const v = 150 + ((rng() * 80) | 0);
    ctx.fillStyle = `rgba(${v},${(v * 0.86) | 0},${(v * 0.62) | 0},${0.5 + rng() * 0.4})`;
    ctx.fill();
  }

  const hole = ctx.createRadialGradient(c, c, 0, c, c, size * 0.1);
  hole.addColorStop(0, 'rgba(12,9,7,1)');
  hole.addColorStop(0.68, 'rgba(28,21,15,0.95)');
  hole.addColorStop(1, 'rgba(70,55,38,0)');
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.1, 0, 6.283);
  ctx.fill();
}

function drawHoleGlass(ctx, size, rng) {
  const c = size * 0.5;
  ctx.clearRect(0, 0, size, size);

  // Radial fractures.
  const arms = 11;
  const angles = [];
  for (let i = 0; i < arms; i++) angles.push((i / arms) * 6.283 + rng() * 0.4);
  ctx.strokeStyle = 'rgba(238,246,248,0.75)';
  for (let i = 0; i < arms; i++) {
    const a = angles[i];
    const len = size * (0.2 + rng() * 0.24);
    ctx.lineWidth = Math.max(1, size * (0.004 + rng() * 0.005));
    ctx.beginPath();
    ctx.moveTo(c, c);
    let px = c;
    let py = c;
    const segs = 4;
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      const jitter = (rng() - 0.5) * 0.18 * (1 - t);
      px = c + Math.cos(a + jitter) * len * t;
      py = c + Math.sin(a + jitter) * len * t;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // Concentric fracture rings chaining between the radials.
  ctx.strokeStyle = 'rgba(226,238,242,0.4)';
  for (let ring = 1; ring <= 3; ring++) {
    const rr = size * (0.07 + ring * 0.07);
    ctx.lineWidth = Math.max(1, size * 0.003);
    ctx.beginPath();
    for (let i = 0; i <= arms; i++) {
      const a = angles[i % arms];
      const jr = rr * (0.82 + rng() * 0.36);
      const x = c + Math.cos(a) * jr;
      const y = c + Math.sin(a) * jr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Pulverised centre.
  const g = ctx.createRadialGradient(c, c, 0, c, c, size * 0.075);
  g.addColorStop(0, 'rgba(248,253,255,0.92)');
  g.addColorStop(0.55, 'rgba(206,224,230,0.6)');
  g.addColorStop(1, 'rgba(190,210,218,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.075, 0, 6.283);
  ctx.fill();
}

function drawHoleDirt(ctx, size, rng) {
  const c = size * 0.5;
  ctx.clearRect(0, 0, size, size);
  // Divot: soft dark depression with a raised, lighter lip.
  const lip = ctx.createRadialGradient(c, c, size * 0.09, c, c, size * 0.26);
  lip.addColorStop(0, 'rgba(150,133,104,0)');
  lip.addColorStop(0.35, 'rgba(168,150,118,0.5)');
  lip.addColorStop(1, 'rgba(150,133,104,0)');
  ctx.fillStyle = lip;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.26, 0, 6.283);
  ctx.fill();

  const pit = ctx.createRadialGradient(c - size * 0.02, c - size * 0.03, 0, c, c, size * 0.14);
  pit.addColorStop(0, 'rgba(30,24,17,0.95)');
  pit.addColorStop(0.6, 'rgba(52,42,30,0.8)');
  pit.addColorStop(1, 'rgba(80,66,48,0)');
  ctx.fillStyle = pit;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.14, 0, 6.283);
  ctx.fill();

  for (let i = 0; i < 60; i++) {
    const a = rng() * 6.283;
    const r = size * (0.13 + Math.pow(rng(), 0.55) * 0.26);
    ctx.fillStyle = `rgba(${58 + ((rng() * 50) | 0)},${48 + ((rng() * 40) | 0)},34,${0.25 + rng() * 0.5})`;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, size * (0.004 + rng() * 0.012), 0, 6.283);
    ctx.fill();
  }
}

function drawHoleSandbag(ctx, size, rng) {
  const c = size * 0.5;
  ctx.clearRect(0, 0, size, size);
  // Torn hessian: dark ragged mouth with frayed threads.
  ctx.beginPath();
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 6.283;
    const r = size * (0.08 + 0.028 * Math.sin(a * 5 + 1.1) + 0.02 * Math.sin(a * 11));
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(26,22,16,0.95)';
  ctx.fill();

  ctx.strokeStyle = 'rgba(150,133,100,0.6)';
  for (let i = 0; i < 16; i++) {
    const a = rng() * 6.283;
    ctx.lineWidth = Math.max(1, size * 0.0035);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * size * 0.07, c + Math.sin(a) * size * 0.07);
    ctx.lineTo(c + Math.cos(a) * size * (0.1 + rng() * 0.06), c + Math.sin(a) * size * (0.1 + rng() * 0.06));
    ctx.stroke();
  }

  // Sand spilling down and out of the tear. +Y in the tile maps downwards on a wall decal
  // only by chance, so keep the spill roughly radial with a downward bias.
  for (let i = 0; i < 220; i++) {
    const a = rng() * 6.283;
    const bias = 0.35 + 0.65 * Math.max(0, Math.sin(a));
    const r = size * (0.08 + Math.pow(rng(), 0.5) * 0.3 * bias);
    ctx.fillStyle = `rgba(${180 + ((rng() * 50) | 0)},${162 + ((rng() * 40) | 0)},120,${0.2 + rng() * 0.55})`;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r * 1.05, size * (0.003 + rng() * 0.009), 0, 6.283);
    ctx.fill();
  }
}

function drawBloodPool(ctx, size, rng) {
  const c = size * 0.5;
  ctx.clearRect(0, 0, size, size);
  const p1 = rng() * 6.28;
  const p2 = rng() * 6.28;
  ctx.beginPath();
  const steps = 128;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 6.283;
    const r =
      size * (0.31 + 0.06 * Math.sin(a * 2 + p1) + 0.04 * Math.sin(a * 5 + p2) + 0.022 * Math.sin(a * 11));
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r * 0.88;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  // Deep centre, slightly lighter drying rim — a flat disc reads as paint.
  const g = ctx.createRadialGradient(c, c, size * 0.05, c, c, size * 0.36);
  g.addColorStop(0, 'rgba(46,8,7,1)');
  g.addColorStop(0.62, 'rgba(66,12,10,0.98)');
  g.addColorStop(0.92, 'rgba(88,22,18,0.8)');
  g.addColorStop(1, 'rgba(96,28,22,0.0)');
  ctx.fillStyle = g;
  ctx.fill();

  for (let i = 0; i < 40; i++) {
    const a = rng() * 6.283;
    const r = size * (0.3 + Math.pow(rng(), 0.6) * 0.16);
    ctx.fillStyle = `rgba(72,14,11,${0.35 + rng() * 0.5})`;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r * 0.9, size * (0.005 + rng() * 0.02), 0, 6.283);
    ctx.fill();
  }
  // Wet specular sheen, offset from centre.
  const sheen = ctx.createRadialGradient(
    c - size * 0.08,
    c - size * 0.1,
    0,
    c - size * 0.08,
    c - size * 0.1,
    size * 0.14
  );
  sheen.addColorStop(0, 'rgba(190,120,110,0.18)');
  sheen.addColorStop(1, 'rgba(190,120,110,0)');
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(c - size * 0.08, c - size * 0.1, size * 0.14, 0, 6.283);
  ctx.fill();
}

function drawScorch(ctx, size, rng) {
  const c = size * 0.5;
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(c, c, size * 0.02, c, c, size * 0.46);
  g.addColorStop(0, 'rgba(8,7,6,0.96)');
  g.addColorStop(0.34, 'rgba(20,17,14,0.82)');
  g.addColorStop(0.66, 'rgba(38,32,26,0.42)');
  g.addColorStop(1, 'rgba(50,42,34,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.46, 0, 6.283);
  ctx.fill();

  // Soot streaks thrown outwards — a clean circle reads as a decal, streaks read as a blast.
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 26; i++) {
    const a = rng() * 6.283;
    const len = size * (0.2 + rng() * 0.26);
    const w = size * (0.01 + rng() * 0.035);
    const grd = ctx.createLinearGradient(c, c, c + Math.cos(a) * len, c + Math.sin(a) * len);
    grd.addColorStop(0, 'rgba(12,10,9,0.55)');
    grd.addColorStop(1, 'rgba(30,26,22,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a + 0.1) * size * 0.06, c + Math.sin(a + 0.1) * size * 0.06);
    ctx.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
    ctx.lineTo(c + Math.cos(a - 0.1) * size * 0.06, c + Math.sin(a - 0.1) * size * 0.06);
    ctx.closePath();
    ctx.fill();
  }
  // A hot residue core that has not gone fully to soot.
  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.1);
  core.addColorStop(0, 'rgba(56,34,20,0.5)');
  core.addColorStop(1, 'rgba(40,26,16,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.1, 0, 6.283);
  ctx.fill();
}

function buildDecalAtlas() {
  const size = DECAL_TILE;
  const sheet = newCanvas(DECAL_COLS * size, DECAL_ROWS * size);
  const sctx = sheet.getContext('2d');
  if (!sctx) return null;
  const tile = newCanvas(size, size);
  const tctx = tile.getContext('2d');
  if (!tctx) return null;

  const rng = makeRng(0x51d3c7);
  const put = (index) => {
    const col = index % DECAL_COLS;
    const row = (index / DECAL_COLS) | 0;
    sctx.clearRect(col * size, row * size, size, size);
    sctx.drawImage(tile, col * size, row * size);
  };

  drawHoleConcrete(tctx, size, rng);
  put(D_CONCRETE);
  drawHoleMetal(tctx, size, rng);
  put(D_METAL);
  drawHoleWood(tctx, size, rng);
  put(D_WOOD);
  drawHoleGlass(tctx, size, rng);
  put(D_GLASS);
  drawHoleDirt(tctx, size, rng);
  put(D_DIRT);
  drawHoleSandbag(tctx, size, rng);
  put(D_SANDBAG);
  drawBloodPool(tctx, size, rng);
  put(D_BLOOD);
  drawScorch(tctx, size, rng);
  put(D_SCORCH);

  const tex = new THREE.CanvasTexture(sheet);
  tex.name = 'fx:decalAtlas';
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* -------------------------------------------------------------------------- */
/* Tileable value noise (heat haze, shockwave)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Three channels of independent tileable fBm at 128 px. Written straight into a DataTexture
 * so it needs no 2D context and cannot fail.
 */
function buildNoiseTexture() {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  const rng = makeRng(0x2b17f5);

  const octave = (period) => {
    const grid = new Float32Array(period * period);
    for (let i = 0; i < grid.length; i++) grid[i] = rng();
    return (x, y) => {
      const fx = x * period;
      const fy = y * period;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      let tx = fx - x0;
      let ty = fy - y0;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const i0 = ((y0 % period) + period) % period;
      const i1 = (i0 + 1) % period;
      const j0 = ((x0 % period) + period) % period;
      const j1 = (j0 + 1) % period;
      const a = grid[i0 * period + j0];
      const b = grid[i0 * period + j1];
      const c = grid[i1 * period + j0];
      const d = grid[i1 * period + j1];
      return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    };
  };

  const chan = [];
  for (let ch = 0; ch < 3; ch++) {
    const o1 = octave(4);
    const o2 = octave(8);
    const o3 = octave(16);
    chan.push((x, y) => o1(x, y) * 0.55 + o2(x, y) * 0.3 + o3(x, y) * 0.15);
  }

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const i = (y * N + x) * 4;
      data[i] = clamp(chan[0](u, v), 0, 1) * 255;
      data[i + 1] = clamp(chan[1](u, v), 0, 1) * 255;
      data[i + 2] = clamp(chan[2](u, v), 0, 1) * 255;
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.name = 'fx:noise';
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/* -------------------------------------------------------------------------- */
/* Particle shader                                                             */
/* -------------------------------------------------------------------------- */

const PARTICLE_VERT = /* glsl */ `
attribute vec4 iPosSize;   // xyz world position, w world-space size (metres)
attribute vec4 iColour;    // rgb linear HDR, a alpha
attribute vec4 iRotTile;   // x roll, y atlas tile, z soft-fade depth, w stretch length
attribute vec4 iAxis;      // xyz world stretch axis, w unused

uniform vec2 uGrid;

varying vec2 vUv;
varying vec4 vCol;
varying float vViewZ;
varying float vSoft;

void main() {
  float s = iPosSize.w;
  vec2 c = position.xy;

  // The mesh sits at the world origin with identity transform, so the instance position is
  // already world space and viewMatrix alone takes it to view space.
  vec4 mv = viewMatrix * vec4(iPosSize.xyz, 1.0);

  vec2 off;
  if (iRotTile.w > 0.0001) {
    // Velocity-aligned stretch. Projecting the world axis into view space and taking the
    // length of its XY gives sin(angle to the view direction) for free, so a tracer coming
    // straight at the camera foreshortens into a dot instead of a fixed-length dash.
    vec3 av = (viewMatrix * vec4(iAxis.xyz, 0.0)).xyz;
    vec2 d = av.xy;
    float l = length(d);
    vec2 u = l > 1e-4 ? d / l : vec2(0.0, 1.0);
    vec2 p = vec2(-u.y, u.x);
    off = p * (c.x * s) + u * (c.y * (s + iRotTile.w * l));
  } else {
    float sr = sin(iRotTile.x);
    float cr = cos(iRotTile.x);
    off = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr) * s;
  }

  mv.xy += off;

  vViewZ = -mv.z;
  vCol = iColour;
  vSoft = iRotTile.z;

  float tile = iRotTile.y;
  float col = floor(mod(tile, uGrid.x));
  float row = floor(tile / uGrid.x);
  // Canvas rows run top-down, GL texture rows run bottom-up: flip the row index.
  vUv = (vec2(col, uGrid.y - 1.0 - row) + (position.xy + 0.5)) / uGrid;

  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uDepth;
uniform vec2 uInvRes;
uniform vec2 uNearFar;
uniform float uSoftEnabled;
uniform float uNearFade;

varying vec2 vUv;
varying vec4 vCol;
varying float vViewZ;
varying float vSoft;

/** Window depth (0..1) -> positive distance along the view axis, in metres. */
float linearDepth(float d, float n, float f) { return -((n * f) / ((f - n) * d - f)); }

void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vCol.a;
  if (a < 0.0025) discard;

  if (uSoftEnabled > 0.5 && vSoft > 0.0) {
    // Soft particles. Sampling the *prepass* depth, not the target we are drawing into.
    float d = texture2D(uDepth, gl_FragCoord.xy * uInvRes).x;
    float sceneZ = linearDepth(d, uNearFar.x, uNearFar.y);
    a *= clamp((sceneZ - vViewZ) / vSoft, 0.0, 1.0);
  }

  // Camera-proximity fade. Without it, walking through a smoke cloud fills the screen with
  // one enormous flat quad the instant the near plane crosses it.
  a *= smoothstep(uNearFade * 0.22, uNearFade, vViewZ);
  if (a < 0.0025) discard;

  // Premultiplied output: works for both "over" and additive by changing only the dst factor.
  gl_FragColor = vec4(vCol.rgb * tex.rgb * a, a);
}
`;

/* -------------------------------------------------------------------------- */
/* Emission descriptor                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One shared descriptor for every emission in the game. Callers reset it, set the fields
 * they care about and hand it to a pool. This is what keeps `spawnImpact` — the single
 * hottest allocation risk in the module, up to forty particles per bullet — at zero bytes.
 */
const EM = {
  px: 0, py: 0, pz: 0,
  vx: 0, vy: 0, vz: 0,
  life: 1,
  sz0: 0.2, sz1: 0.4,
  rot: 0, rotv: 0,
  tile: T_SMOKE_A,
  r0: 1, g0: 1, b0: 1,
  r1: 1, g1: 1, b1: 1,
  cpow: 1,
  a0: 1,
  fadeIn: 0.08,
  fadeOut: 1.35,
  drag: 0.6,
  grav: 0,
  wind: 0,
  soft: 0.55,
  stretch: 0,
  ax: 0, ay: 1, az: 0,
  aux0: 0,
  flags: 0,
  bounceY: -1e9,
  rest: 0.3,
  turb: 0,
};

function emReset() {
  EM.px = 0; EM.py = 0; EM.pz = 0;
  EM.vx = 0; EM.vy = 0; EM.vz = 0;
  EM.life = 1;
  EM.sz0 = 0.2; EM.sz1 = 0.4;
  EM.rot = rnd() * 6.283; EM.rotv = 0;
  EM.tile = T_SMOKE_A;
  EM.r0 = 1; EM.g0 = 1; EM.b0 = 1;
  EM.r1 = 1; EM.g1 = 1; EM.b1 = 1;
  EM.cpow = 1;
  EM.a0 = 1;
  EM.fadeIn = 0.08;
  EM.fadeOut = 1.35;
  EM.drag = 0.6;
  EM.grav = 0;
  EM.wind = 0;
  EM.soft = 0.55;
  EM.stretch = 0;
  EM.ax = 0; EM.ay = 1; EM.az = 0;
  EM.aux0 = 0;
  EM.flags = 0;
  EM.bounceY = -1e9;
  EM.rest = 0.3;
  EM.turb = 0;
}

/** Set EM's start colour from an art.js hex, scaled (values > 1 are HDR and will bloom). */
function emColour0(hex, mul) {
  lin(hex, _c0);
  EM.r0 = _c0.r * mul;
  EM.g0 = _c0.g * mul;
  EM.b0 = _c0.b * mul;
}
function emColour1(hex, mul) {
  lin(hex, _c1);
  EM.r1 = _c1.r * mul;
  EM.g1 = _c1.g * mul;
  EM.b1 = _c1.b * mul;
}
/** Both ends of the ramp from one colour — the common case. */
function emColourFlat(hex, mul0, mul1) {
  emColour0(hex, mul0);
  emColour1(hex, mul1 === undefined ? mul0 : mul1);
}

/* -------------------------------------------------------------------------- */
/* ParticlePool                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One instanced billboard system.
 *
 * Storage is structure-of-arrays: every field is its own `Float32Array`, and live particles
 * occupy `[0, count)`. Death is a swap with the last live element, so the live range stays
 * dense and the integration loop is a straight linear walk with no branches for holes.
 */
class ParticlePool {
  constructor(capacity, atlas, additive, renderOrder, quadGeo) {
    this.cap = capacity;
    this.count = 0;
    this.budget = capacity;
    this.additive = additive;

    const n = capacity;
    const f = () => new Float32Array(n);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f();
    this.sz0 = f(); this.sz1 = f();
    this.rot = f(); this.rotv = f();
    this.tile = f();
    this.r0 = f(); this.g0 = f(); this.b0 = f();
    this.r1 = f(); this.g1 = f(); this.b1 = f();
    this.cpow = f();
    this.a0 = f();
    this.fadeIn = f(); this.fadeOut = f();
    this.drag = f(); this.grav = f(); this.wind = f(); this.turb = f();
    this.soft = f(); this.stretch = f();
    this.ax = f(); this.ay = f(); this.az = f();
    this.aux0 = f();
    this.bounceY = f(); this.rest = f();
    this.flags = new Int32Array(n);
    this.seed = f();

    // --- GPU side -------------------------------------------------------
    this.aPosSize = new Float32Array(n * 4);
    this.aColour = new Float32Array(n * 4);
    this.aRotTile = new Float32Array(n * 4);
    this.aAxis = new Float32Array(n * 4);

    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quadGeo.index;
    geo.setAttribute('position', quadGeo.getAttribute('position'));
    geo.setAttribute('uv', quadGeo.getAttribute('uv'));

    const mk = (arr) => {
      const a = new THREE.InstancedBufferAttribute(arr, 4);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.attrPosSize = mk(this.aPosSize);
    this.attrColour = mk(this.aColour);
    this.attrRotTile = mk(this.aRotTile);
    this.attrAxis = mk(this.aAxis);
    geo.setAttribute('iPosSize', this.attrPosSize);
    geo.setAttribute('iColour', this.attrColour);
    geo.setAttribute('iRotTile', this.attrRotTile);
    geo.setAttribute('iAxis', this.attrAxis);
    geo.instanceCount = 0;
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uMap: { value: atlas },
        uDepth: { value: null },
        uInvRes: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
        uNearFar: { value: new THREE.Vector2(0.05, 600) },
        uSoftEnabled: { value: 0 },
        uNearFade: { value: additive ? 0.12 : 0.34 },
        uGrid: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      lights: false,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, // premultiplied: the shader already multiplied by alpha
      blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
    });
    this.material.name = additive ? 'fx:particlesAdd' : 'fx:particlesAlpha';

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = additive ? 'fx.particles.additive' : 'fx.particles.alpha';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();

    // Sorting scratch (alpha pool only, but cheap enough to always own).
    this.order = new Uint16Array(n);
    this.bucket = new Uint16Array(n);
    this.counts = new Int32Array(SORT_BUCKETS);
    this.starts = new Int32Array(SORT_BUCKETS);
  }

  get free() {
    return this.budget - this.count;
  }

  /**
   * Emit one particle from the shared `EM` descriptor.
   *
   * When the pool is full the *oldest-relative* particle is not evicted; instead the
   * emission is dropped. Evicting mid-life would pop a visible puff out of existence, and a
   * dropped particle in an over-budget burst is invisible.
   */
  emit() {
    const i = this.count;
    if (i >= this.budget) return -1;
    this.count = i + 1;

    this.px[i] = EM.px; this.py[i] = EM.py; this.pz[i] = EM.pz;
    this.vx[i] = EM.vx; this.vy[i] = EM.vy; this.vz[i] = EM.vz;
    this.age[i] = 0;
    this.life[i] = EM.life;
    this.sz0[i] = EM.sz0; this.sz1[i] = EM.sz1;
    this.rot[i] = EM.rot; this.rotv[i] = EM.rotv;
    this.tile[i] = EM.tile;
    this.r0[i] = EM.r0; this.g0[i] = EM.g0; this.b0[i] = EM.b0;
    this.r1[i] = EM.r1; this.g1[i] = EM.g1; this.b1[i] = EM.b1;
    this.cpow[i] = EM.cpow;
    this.a0[i] = EM.a0;
    this.fadeIn[i] = EM.fadeIn; this.fadeOut[i] = EM.fadeOut;
    this.drag[i] = EM.drag; this.grav[i] = EM.grav;
    this.wind[i] = EM.wind; this.turb[i] = EM.turb;
    this.soft[i] = EM.soft; this.stretch[i] = EM.stretch;
    this.ax[i] = EM.ax; this.ay[i] = EM.ay; this.az[i] = EM.az;
    this.aux0[i] = EM.aux0;
    this.bounceY[i] = EM.bounceY; this.rest[i] = EM.rest;
    this.flags[i] = EM.flags;
    this.seed[i] = rnd() * 100;
    return i;
  }

  /** Swap-remove. */
  kill(i) {
    const last = this.count - 1;
    if (i !== last) {
      this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
      this.age[i] = this.age[last]; this.life[i] = this.life[last];
      this.sz0[i] = this.sz0[last]; this.sz1[i] = this.sz1[last];
      this.rot[i] = this.rot[last]; this.rotv[i] = this.rotv[last];
      this.tile[i] = this.tile[last];
      this.r0[i] = this.r0[last]; this.g0[i] = this.g0[last]; this.b0[i] = this.b0[last];
      this.r1[i] = this.r1[last]; this.g1[i] = this.g1[last]; this.b1[i] = this.b1[last];
      this.cpow[i] = this.cpow[last];
      this.a0[i] = this.a0[last];
      this.fadeIn[i] = this.fadeIn[last]; this.fadeOut[i] = this.fadeOut[last];
      this.drag[i] = this.drag[last]; this.grav[i] = this.grav[last];
      this.wind[i] = this.wind[last]; this.turb[i] = this.turb[last];
      this.soft[i] = this.soft[last]; this.stretch[i] = this.stretch[last];
      this.ax[i] = this.ax[last]; this.ay[i] = this.ay[last]; this.az[i] = this.az[last];
      this.aux0[i] = this.aux0[last];
      this.bounceY[i] = this.bounceY[last]; this.rest[i] = this.rest[last];
      this.flags[i] = this.flags[last];
      this.seed[i] = this.seed[last];
    }
    this.count = last;
  }

  clear() {
    this.count = 0;
    this.geometry.instanceCount = 0;
  }

  /**
   * Integrate, then write the instance buffers.
   *
   * `windX/Y/Z` is the ambient wind *velocity*; particles relax towards it at a rate
   * proportional to their `wind` coefficient, which is the correct model for something with
   * no mass to speak of and gives smoke a lazy downwind lean instead of a linear slide.
   */
  update(dt, time, camX, camY, camZ, windX, windY, windZ, sorted) {
    let i = 0;
    while (i < this.count) {
      const a = this.age[i] + dt;
      if (a >= this.life[i]) {
        this.kill(i);
        continue;
      }
      this.age[i] = a;

      const fl = this.flags[i];
      let vx = this.vx[i];
      let vy = this.vy[i];
      let vz = this.vz[i];

      // Exponential drag — frame-rate independent by construction.
      const dk = this.drag[i];
      if (dk > 0) {
        const k = 1 - Math.exp(-dk * dt);
        vx -= vx * k;
        vy -= vy * k;
        vz -= vz * k;
      }

      vy -= this.grav[i] * dt;

      const w = this.wind[i];
      if (w > 0) {
        const k = 1 - Math.exp(-w * dt);
        vx += (windX - vx) * k;
        vy += (windY - vy) * k;
        vz += (windZ - vz) * k;
      }

      if (fl & F_TURB) {
        // Cheap divergence-light curl stand-in: three sines phase-shifted off position and
        // time. Real curl noise is not worth the cache misses for smoke this soft.
        const s = this.seed[i];
        const t = time * 0.55 + s;
        const tb = this.turb[i] * dt;
        vx += Math.sin(this.py[i] * 0.7 + t) * tb;
        vy += Math.sin(this.pz[i] * 0.6 + t * 1.21) * tb * 0.5;
        vz += Math.cos(this.px[i] * 0.7 + t * 0.83) * tb;
      }

      let px = this.px[i] + vx * dt;
      let py = this.py[i] + vy * dt;
      let pz = this.pz[i] + vz * dt;

      if (fl & F_GROUND) {
        const gy = this.bounceY[i];
        if (py < gy) {
          py = gy + (gy - py) * 0.25;
          const r = this.rest[i];
          vy = -vy * r;
          vx *= 0.62;
          vz *= 0.62;
          this.rotv[i] *= 0.5;
          // Below a threshold the bounce is not readable, so settle rather than jitter.
          if (Math.abs(vy) < 0.35) {
            py = gy;
            vy = 0;
            this.flags[i] = fl & ~F_GROUND;
            this.drag[i] = 9.0;
          }
        }
      }

      this.px[i] = px;
      this.py[i] = py;
      this.pz[i] = pz;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;

      let rv = this.rotv[i];
      if (fl & F_SPIN_DAMP) {
        rv -= rv * (1 - Math.exp(-dk * dt));
        this.rotv[i] = rv;
      }
      this.rot[i] += rv * dt;

      if (fl & F_AXIS_VEL) {
        const l = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (l > 1e-4) {
          const inv = 1 / l;
          this.ax[i] = vx * inv;
          this.ay[i] = vy * inv;
          this.az[i] = vz * inv;
        }
      }

      i++;
    }

    const n = this.count;
    this.geometry.instanceCount = n;
    if (n === 0) {
      this.attrPosSize.needsUpdate = true;
      return;
    }

    if (sorted) this.sortByDepth(camX, camY, camZ, n);

    const ps = this.aPosSize;
    const cl = this.aColour;
    const rt = this.aRotTile;
    const ax = this.aAxis;
    const order = this.order;

    for (let k = 0; k < n; k++) {
      const j = sorted ? order[k] : k;
      const t = this.age[j] / this.life[j];
      const o = k * 4;

      // Size eases out: fast expansion on birth, then a slow creep. Linear growth reads as
      // mechanical; this is what makes a dust puff bloom.
      const et = 1 - (1 - t) * (1 - t) * (1 - t);
      const size = this.sz0[j] + (this.sz1[j] - this.sz0[j]) * et;

      // Alpha: fade in over `fadeIn` of the lifetime, then a decaying tail.
      const fi = this.fadeIn[j];
      let alpha = this.a0[j];
      if (fi > 0 && t < fi) alpha *= t / fi;
      alpha *= Math.pow(1 - t, this.fadeOut[j]);

      const flj = this.flags[j];
      if (flj & F_TRACER) {
        // A tracer glued to the muzzle is the classic tell. Ramp in over the first 3 m of
        // flight and snap off at the end rather than fading over the whole life.
        const travelled = this.age[j] * this.aux0[j];
        alpha = this.a0[j] * clamp(travelled / 3.0, 0, 1) * clamp((1 - t) * 6, 0, 1);
      }

      ps[o] = this.px[j];
      ps[o + 1] = this.py[j];
      ps[o + 2] = this.pz[j];
      ps[o + 3] = size;

      const ct = this.cpow[j] === 1 ? t : Math.pow(t, this.cpow[j]);
      cl[o] = this.r0[j] + (this.r1[j] - this.r0[j]) * ct;
      cl[o + 1] = this.g0[j] + (this.g1[j] - this.g0[j]) * ct;
      cl[o + 2] = this.b0[j] + (this.b1[j] - this.b0[j]) * ct;
      cl[o + 3] = alpha;

      rt[o] = this.rot[j];
      rt[o + 1] = this.tile[j];
      rt[o + 2] = this.soft[j];
      rt[o + 3] = this.stretch[j];

      ax[o] = this.ax[j];
      ax[o + 1] = this.ay[j];
      ax[o + 2] = this.az[j];
      ax[o + 3] = 0;
    }

    this.attrPosSize.needsUpdate = true;
    this.attrColour.needsUpdate = true;
    this.attrRotTile.needsUpdate = true;
    this.attrAxis.needsUpdate = true;
  }

  /**
   * 256-bucket counting sort on squared camera distance, far to near. O(n), no comparator,
   * no allocation. Exact ordering inside a bucket is irrelevant at this quantisation.
   */
  sortByDepth(cx, cy, cz, n) {
    const counts = this.counts;
    const starts = this.starts;
    const bucket = this.bucket;
    counts.fill(0);
    const scale = SORT_BUCKETS / (SORT_FAR * SORT_FAR);
    for (let i = 0; i < n; i++) {
      const dx = this.px[i] - cx;
      const dy = this.py[i] - cy;
      const dz = this.pz[i] - cz;
      let b = ((dx * dx + dy * dy + dz * dz) * scale) | 0;
      if (b < 0) b = 0;
      else if (b >= SORT_BUCKETS) b = SORT_BUCKETS - 1;
      bucket[i] = b;
      counts[b]++;
    }
    let run = 0;
    for (let b = SORT_BUCKETS - 1; b >= 0; b--) {
      starts[b] = run;
      run += counts[b];
    }
    const order = this.order;
    for (let i = 0; i < n; i++) order[starts[bucket[i]]++] = i;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* -------------------------------------------------------------------------- */
/* Decals                                                                      */
/* -------------------------------------------------------------------------- */

const DECAL_VERT = /* glsl */ `
attribute vec4 iTint;      // rgb tint, a peak alpha
attribute vec4 iTileFade;  // x atlas tile, y live fade 0..1, z world normal packed? (unused), w unused
attribute vec3 iNormal;    // world normal of the host surface, for the lighting term

uniform vec2 uGrid;

varying vec2 vUv;
varying vec2 vLocal;
varying vec4 vTint;
varying float vFade;
varying vec3 vNormal;
varying float vViewZ;

void main() {
  vec4 wp = instanceMatrix * vec4(position, 1.0);
  vec4 mv = modelViewMatrix * wp;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;

  vLocal = position.xy + 0.5;
  float tile = iTileFade.x;
  float col = floor(mod(tile, uGrid.x));
  float row = floor(tile / uGrid.x);
  vUv = (vec2(col, uGrid.y - 1.0 - row) + vLocal) / uGrid;

  vTint = iTint;
  vFade = iTileFade.y;
  vNormal = normalize(iNormal);
}
`;

const DECAL_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uSunDir;      // direction the sunlight travels (from sun into the scene)
uniform vec3 uSunColour;
uniform vec3 uAmbient;
uniform float uFadeStart;  // metres; decals dissolve out at distance rather than pop

varying vec2 vUv;
varying vec2 vLocal;
varying vec4 vTint;
varying float vFade;
varying vec3 vNormal;
varying float vViewZ;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vTint.a * vFade;
  if (a < 0.004) discard;

  // Edge fade. A hard-edged quad is instantly readable as a sticker; feathering the last
  // 12% of the quad hides the boundary against the host surface.
  vec2 e = min(vLocal, 1.0 - vLocal);
  float edge = smoothstep(0.0, 0.12, min(e.x, e.y));
  a *= edge;

  // Distance dissolve so a wall of 256 bullet holes does not shimmer at 60 m.
  a *= 1.0 - smoothstep(uFadeStart, uFadeStart * 1.9, vViewZ);
  if (a < 0.004) discard;

  // Cheap direct lighting so the pulverised rim reacts to the key the way the wall does.
  // The crater is near-black in the atlas, so it darkens the host surface regardless.
  float ndl = max(dot(vNormal, -uSunDir), 0.0);
  vec3 lit = uAmbient + uSunColour * ndl;

  gl_FragColor = vec4(tex.rgb * vTint.rgb * lit, a);
}
`;

/**
 * Oriented-quad decal pool with FIFO recycling.
 *
 * Recycling is *pre-emptive*: whenever a slot is claimed, the slot `LOOKAHEAD` places ahead
 * in the ring — the one about to be reused — is put into a half-second fade. By the time the
 * ring reaches it, it is already invisible, so the oldest hole dissolves instead of popping.
 */
class DecalPool {
  constructor(atlas, cap) {
    this.cap = cap;
    this.activeCap = cap;
    this.head = 0;
    this.lookahead = 8;

    this.alpha = new Float32Array(cap); // peak alpha
    this.fade = new Float32Array(cap); // 0..1 live multiplier
    this.age = new Float32Array(cap);
    this.ttl = new Float32Array(cap);
    this.state = new Uint8Array(cap); // 0 dead, 1 growing-in, 2 live, 3 fading
    this.fadeRate = new Float32Array(cap);

    const geo = new THREE.PlaneGeometry(1, 1);
    this.quad = geo;

    const tint = new Float32Array(cap * 4);
    const tileFade = new Float32Array(cap * 4);
    const nrm = new Float32Array(cap * 3);
    this.aTint = tint;
    this.aTileFade = tileFade;
    this.aNormal = nrm;

    this.attrTint = new THREE.InstancedBufferAttribute(tint, 4);
    this.attrTileFade = new THREE.InstancedBufferAttribute(tileFade, 4);
    this.attrNormal = new THREE.InstancedBufferAttribute(nrm, 3);
    this.attrTint.setUsage(THREE.DynamicDrawUsage);
    this.attrTileFade.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iTint', this.attrTint);
    geo.setAttribute('iTileFade', this.attrTileFade);
    geo.setAttribute('iNormal', this.attrNormal);

    this.material = new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      uniforms: {
        uMap: { value: atlas },
        uGrid: { value: new THREE.Vector2(DECAL_COLS, DECAL_ROWS) },
        uSunDir: { value: new THREE.Vector3(0.94, -0.14, 0.31) },
        uSunColour: { value: new THREE.Color(1, 1, 1) },
        uAmbient: { value: new THREE.Color(0.2, 0.24, 0.3) },
        uFadeStart: { value: 42 },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false, // a decal must never write depth or it fights its own host face
      side: THREE.FrontSide,
      fog: false,
      lights: false,
      toneMapped: false,
      // Pull towards the eye in depth so the coplanar overlay wins the z-fight without a
      // geometric offset that would break at grazing angles.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
      blending: THREE.NormalBlending,
    });
    this.material.name = 'fx:decals';

    this.mesh = new THREE.InstancedMesh(geo, this.material, cap);
    this.mesh.name = 'fx.decals';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = cap;

    // Park every instance at the origin with zero scale so dead slots cost nothing but a
    // degenerate triangle.
    _m0.makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, _m0);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setCap(n) {
    const next = clamp(n | 0, 8, this.cap);
    if (next === this.activeCap) return;
    // Anything outside the new cap is retired immediately: quality changes happen in a menu,
    // never mid-firefight, so the pop is unobservable.
    for (let i = next; i < this.cap; i++) this.retire(i);
    this.activeCap = next;
    this.head = this.head % next;
  }

  retire(i) {
    this.state[i] = 0;
    this.fade[i] = 0;
    this.aTileFade[i * 4 + 1] = 0;
  }

  /**
   * @param {THREE.Vector3} point world hit point
   * @param {THREE.Vector3} normal world surface normal (unit)
   * @param {number} tile atlas tile index
   * @param {number} size world size in metres (quad edge)
   * @param {number} ttl seconds before the slow ambient fade begins
   */
  add(point, normal, tile, size, ttl, r, g, b, alpha) {
    const cap = this.activeCap;
    const i = this.head;
    this.head = (i + 1) % cap;

    // Pre-emptively dissolve the slot that is next in line for reuse.
    const doomed = (this.head + this.lookahead) % cap;
    if (this.state[doomed] === 1 || this.state[doomed] === 2) {
      this.state[doomed] = 3;
      this.fadeRate[doomed] = 2.2; // ~0.45 s
    }

    // Orient: the plane faces +Z, so rotate +Z onto the surface normal, then apply a random
    // roll about that normal. Without the roll, every hole on a wall is identically aligned
    // and the repetition is obvious within about six shots.
    _q0.setFromUnitVectors(UNIT_Z, normal);
    _q1.setFromAxisAngle(normal, rnd() * 6.283);
    _q0.premultiply(_q1);
    // Lift off the surface as well as using polygonOffset — belt and braces at grazing
    // angles where depth precision is worst.
    _v0.copy(normal).multiplyScalar(0.012).add(point);
    _scale.set(size, size, size);
    _m0.compose(_v0, _q0, _scale);
    this.mesh.setMatrixAt(i, _m0);
    this.mesh.instanceMatrix.needsUpdate = true;

    const o = i * 4;
    this.aTint[o] = r;
    this.aTint[o + 1] = g;
    this.aTint[o + 2] = b;
    this.aTint[o + 3] = alpha;
    this.aTileFade[o] = tile;
    this.aTileFade[o + 1] = 0;
    this.aNormal[i * 3] = normal.x;
    this.aNormal[i * 3 + 1] = normal.y;
    this.aNormal[i * 3 + 2] = normal.z;
    this.attrTint.needsUpdate = true;
    this.attrNormal.needsUpdate = true;

    this.alpha[i] = alpha;
    this.fade[i] = 0;
    this.age[i] = 0;
    this.ttl[i] = ttl;
    this.state[i] = 1;
    this.fadeRate[i] = 0;
    return i;
  }

  update(dt) {
    let dirty = false;
    const cap = this.activeCap;
    for (let i = 0; i < cap; i++) {
      const s = this.state[i];
      if (s === 0) continue;
      this.age[i] += dt;
      if (s === 1) {
        // Fast punch-in: a bullet hole should be there within ~60 ms of the shot landing.
        const f = this.fade[i] + dt * 18;
        this.fade[i] = f >= 1 ? 1 : f;
        if (f >= 1) this.state[i] = 2;
        dirty = true;
      } else if (s === 2) {
        if (this.age[i] > this.ttl[i]) {
          this.state[i] = 3;
          this.fadeRate[i] = 0.09; // slow ambient weathering, ~11 s
        }
      } else if (s === 3) {
        const f = this.fade[i] - dt * this.fadeRate[i];
        if (f <= 0) {
          this.retire(i);
        } else {
          this.fade[i] = f;
        }
        dirty = true;
      }
      this.aTileFade[i * 4 + 1] = this.fade[i];
    }
    if (dirty) this.attrTileFade.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.cap; i++) this.retire(i);
    this.head = 0;
    this.attrTileFade.needsUpdate = true;
  }

  dispose() {
    this.quad.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

/* -------------------------------------------------------------------------- */
/* Brass casings                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A 5.56-ish case profile, revolved. One `LatheGeometry` gives the closed base, the extractor
 * groove, the body taper, the shoulder, the neck and the open mouth in a single ~200 triangle
 * mesh — cheap enough to instance ninety-six of and still read as a cartridge case in the
 * two frames it spends near the camera.
 */
function buildCasingGeometry() {
  const p = [];
  const push = (x, y) => p.push(new THREE.Vector2(x, y));
  push(0.0, -0.0118);
  push(0.0046, -0.0118);
  push(0.0056, -0.0112);
  push(0.0056, -0.0098);
  push(0.0048, -0.0092); // extractor groove
  push(0.0048, -0.0086);
  push(0.0056, -0.008);
  push(0.0055, 0.0032); // body, very slight taper
  push(0.0051, 0.0058);
  push(0.0042, 0.0082); // shoulder
  push(0.004, 0.0106); // neck
  push(0.004, 0.0118); // mouth
  push(0.0033, 0.0116); // inner lip
  push(0.0033, 0.0);
  const geo = new THREE.LatheGeometry(p, 10);
  geo.computeVertexNormals();
  return geo;
}

class CasingPool {
  constructor(cap, materialColour) {
    this.cap = cap;
    this.count = 0;
    this.budget = cap;

    const f = () => new Float32Array(cap);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.qx = f(); this.qy = f(); this.qz = f(); this.qw = f();
    this.wx = f(); this.wy = f(); this.wz = f();
    this.age = f();
    this.groundY = f();
    this.bounces = new Uint8Array(cap);
    this.settled = new Uint8Array(cap);

    this.geometry = buildCasingGeometry();
    this.material = new THREE.MeshStandardMaterial({
      color: materialColour,
      metalness: 0.92,
      roughness: 0.33,
      envMapIntensity: LIGHTING.envIntensity,
    });
    this.material.name = 'fx:brass';

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, cap);
    this.mesh.name = 'fx.casings';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; // 12 mm of brass casts nothing worth a cascade slot
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  spawn(pos, vel, spin, groundY) {
    if (this.count >= this.budget) {
      // Recycle the oldest rather than dropping: brass is a feedback channel and a missing
      // case reads as a missing shot.
      let oldest = 0;
      let best = -1;
      for (let i = 0; i < this.count; i++) {
        if (this.age[i] > best) {
          best = this.age[i];
          oldest = i;
        }
      }
      this.remove(oldest);
    }
    const i = this.count++;
    this.px[i] = pos.x; this.py[i] = pos.y; this.pz[i] = pos.z;
    this.vx[i] = vel.x; this.vy[i] = vel.y; this.vz[i] = vel.z;

    // Random unit quaternion for the initial attitude.
    const u1 = rnd();
    const u2 = rnd() * 6.283;
    const u3 = rnd() * 6.283;
    const s1 = Math.sqrt(1 - u1);
    const s2 = Math.sqrt(u1);
    this.qx[i] = s1 * Math.sin(u2);
    this.qy[i] = s1 * Math.cos(u2);
    this.qz[i] = s2 * Math.sin(u3);
    this.qw[i] = s2 * Math.cos(u3);

    // Tumble mostly end-over-end about an axis perpendicular to the ejection velocity, which
    // is what brass actually does leaving a port.
    _v0.set(vel.x, vel.y, vel.z);
    if (_v0.lengthSq() < 1e-6) _v0.set(1, 0, 0);
    _v1.set(rndS(), rndS(), rndS());
    _v2.crossVectors(_v0, _v1);
    if (_v2.lengthSq() < 1e-8) _v2.set(0, 1, 0);
    _v2.normalize().multiplyScalar(spin);
    this.wx[i] = _v2.x + rndS() * spin * 0.25;
    this.wy[i] = _v2.y + rndS() * spin * 0.25;
    this.wz[i] = _v2.z + rndS() * spin * 0.25;

    this.age[i] = 0;
    this.groundY[i] = groundY;
    this.bounces[i] = 0;
    this.settled[i] = 0;
    return i;
  }

  remove(i) {
    const last = this.count - 1;
    if (i !== last) {
      const cp = (arr) => (arr[i] = arr[last]);
      cp(this.px); cp(this.py); cp(this.pz);
      cp(this.vx); cp(this.vy); cp(this.vz);
      cp(this.qx); cp(this.qy); cp(this.qz); cp(this.qw);
      cp(this.wx); cp(this.wy); cp(this.wz);
      cp(this.age); cp(this.groundY);
      this.bounces[i] = this.bounces[last];
      this.settled[i] = this.settled[last];
    }
    this.count = last;
  }

  clear() {
    this.count = 0;
    this.mesh.count = 0;
  }

  /** @returns number of casings that struck the ground this frame (for audio). */
  update(dt, life, onBounce) {
    const LIFE = life;
    let i = 0;
    while (i < this.count) {
      const a = this.age[i] + dt;
      if (a >= LIFE) {
        this.remove(i);
        continue;
      }
      this.age[i] = a;

      if (!this.settled[i]) {
        let vx = this.vx[i];
        let vy = this.vy[i];
        let vz = this.vz[i];
        vy -= 22 * dt; // matches the player controller's gravity, so brass falls "with" you
        const k = 1 - Math.exp(-0.35 * dt);
        vx -= vx * k;
        vy -= vy * k * 0.3;
        vz -= vz * k;

        let px = this.px[i] + vx * dt;
        let py = this.py[i] + vy * dt;
        let pz = this.pz[i] + vz * dt;

        const gy = this.groundY[i] + 0.006; // half the case's minor radius
        if (py <= gy && vy < 0) {
          py = gy;
          const n = ++this.bounces[i];
          // Restitution falls off per bounce: brass is not a superball, and a constant
          // coefficient makes it hop forever at low speeds.
          const rest = n === 1 ? 0.44 : n === 2 ? 0.3 : 0.18;
          const impact = -vy;
          vy = impact * rest;
          vx *= 0.55;
          vz *= 0.55;
          this.wx[i] *= 0.45;
          this.wy[i] *= 0.45;
          this.wz[i] *= 0.45;
          if (onBounce && impact > 0.8) onBounce(px, py, pz, clamp(impact / 5, 0.2, 1));
          if (impact < 0.7 || n >= 4) {
            this.settled[i] = 1;
            vx = 0; vy = 0; vz = 0;
            // Lay it flat: rotate the case's Y axis into the ground plane, keeping its yaw.
            _v0.set(this.qx[i], this.qy[i], this.qz[i]);
            const yaw = Math.atan2(_v0.x, _v0.z || 1e-6);
            _q0.setFromAxisAngle(UNIT_Y, yaw);
            _q1.setFromAxisAngle(UNIT_Z, Math.PI * 0.5);
            _q0.multiply(_q1);
            this.qx[i] = _q0.x; this.qy[i] = _q0.y; this.qz[i] = _q0.z; this.qw[i] = _q0.w;
          }
        }

        this.px[i] = px; this.py[i] = py; this.pz[i] = pz;
        this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;

        if (!this.settled[i]) {
          // Integrate the attitude: build a small-angle delta quaternion from the angular
          // velocity and premultiply. Exact enough at 60 Hz and far cheaper than a matrix.
          const wx = this.wx[i];
          const wy = this.wy[i];
          const wz = this.wz[i];
          const wl = Math.sqrt(wx * wx + wy * wy + wz * wz);
          if (wl > 1e-5) {
            const ang = wl * dt * 0.5;
            const s = Math.sin(ang) / wl;
            const dqx = wx * s;
            const dqy = wy * s;
            const dqz = wz * s;
            const dqw = Math.cos(ang);
            const x = this.qx[i];
            const y = this.qy[i];
            const z = this.qz[i];
            const w = this.qw[i];
            let nx = dqw * x + dqx * w + dqy * z - dqz * y;
            let ny = dqw * y - dqx * z + dqy * w + dqz * x;
            let nz = dqw * z + dqx * y - dqy * x + dqz * w;
            let nw = dqw * w - dqx * x - dqy * y - dqz * z;
            const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
            this.qx[i] = nx * inv;
            this.qy[i] = ny * inv;
            this.qz[i] = nz * inv;
            this.qw[i] = nw * inv;
          }
        }
      }

      // Scale down over the last 0.7 s so the despawn is a shrink, not a blink.
      const remain = LIFE - a;
      const sc = remain < 0.7 ? clamp(remain / 0.7, 0, 1) : 1;
      _v0.set(this.px[i], this.py[i], this.pz[i]);
      _q0.set(this.qx[i], this.qy[i], this.qz[i], this.qw[i]);
      _scale.set(sc, sc, sc);
      _m0.compose(_v0, _q0, _scale);
      this.mesh.setMatrixAt(i, _m0);

      i++;
    }
    this.mesh.count = this.count;
    if (this.count > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

/* -------------------------------------------------------------------------- */
/* Ambient dust motes                                                          */
/* -------------------------------------------------------------------------- */

const MOTE_VERT = /* glsl */ `
attribute vec4 iPosSize;   // xyz world position, w size
attribute vec2 iPhase;     // x phase, y base brightness

uniform vec3 uSunDir;      // direction the light travels
uniform float uTime;

varying vec2 vUv;
varying float vI;
varying float vViewZ;

void main() {
  vec3 wp = iPosSize.xyz;
  // A slow lissajous wobble on top of the wind advection: real motes never travel straight.
  wp.x += sin(uTime * 0.7 + iPhase.x) * 0.06;
  wp.y += sin(uTime * 0.53 + iPhase.x * 1.7) * 0.05;
  wp.z += cos(uTime * 0.61 + iPhase.x * 0.9) * 0.06;

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  mv.xy += position.xy * iPosSize.w;
  vViewZ = -mv.z;
  vUv = position.xy + 0.5;

  // Forward scattering. A mote between the eye and the sun is a hundred times brighter than
  // one lit from behind, and getting this right is most of why dust sells low sun.
  vec3 toMote = normalize(wp - cameraPosition);
  float f = max(dot(toMote, uSunDir), 0.0);
  vI = iPhase.y * (0.16 + 3.4 * pow(f, 10.0) + 0.5 * pow(f, 2.5));

  gl_Position = projectionMatrix * mv;
}
`;

const MOTE_FRAG = /* glsl */ `
uniform vec3 uColour;
varying vec2 vUv;
varying float vI;
varying float vViewZ;

void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = clamp(1.0 - r2, 0.0, 1.0);
  a *= a;
  // Do not draw motes inside the near plane or right on the lens.
  a *= smoothstep(0.25, 0.8, vViewZ);
  a *= vI;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColour * a, a);
}
`;

/**
 * Motes live in a box that follows the camera and wrap toroidally when they leave it, so a
 * fixed 300-particle budget always produces dust exactly where the player is looking. They
 * are never spawned or killed; the pool is static and the cost is constant.
 */
class MotePool {
  constructor(cap, quadGeo, colour) {
    this.cap = cap;
    this.live = 0;
    this.half = 13.0;
    this.halfY = 5.5;

    this.px = new Float32Array(cap);
    this.py = new Float32Array(cap);
    this.pz = new Float32Array(cap);

    this.aPosSize = new Float32Array(cap * 4);
    this.aPhase = new Float32Array(cap * 2);
    for (let i = 0; i < cap; i++) {
      this.aPosSize[i * 4 + 3] = rndR(0.007, 0.021);
      this.aPhase[i * 2] = rnd() * 100;
      this.aPhase[i * 2 + 1] = rndR(0.35, 1.0);
    }

    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quadGeo.index;
    geo.setAttribute('position', quadGeo.getAttribute('position'));
    geo.setAttribute('uv', quadGeo.getAttribute('uv'));
    this.attrPosSize = new THREE.InstancedBufferAttribute(this.aPosSize, 4);
    this.attrPosSize.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPosSize', this.attrPosSize);
    geo.setAttribute('iPhase', new THREE.InstancedBufferAttribute(this.aPhase, 2));
    geo.instanceCount = 0;
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0.94, -0.14, 0.31) },
        uTime: { value: 0 },
        uColour: { value: new THREE.Color(1, 1, 1) },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      fog: false,
      lights: false,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.material.name = 'fx:motes';

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'fx.motes';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.matrixAutoUpdate = false;
    this.seeded = false;
  }

  setLive(n) {
    this.live = clamp(n | 0, 0, this.cap);
    this.geometry.instanceCount = this.live;
  }

  seed(cx, cy, cz) {
    for (let i = 0; i < this.cap; i++) {
      this.px[i] = cx + rndS() * this.half;
      this.py[i] = cy + rndS() * this.halfY;
      this.pz[i] = cz + rndS() * this.half;
    }
    this.seeded = true;
  }

  update(dt, cx, cy, cz, wx, wy, wz) {
    const n = this.live;
    if (n === 0) return;
    if (!this.seeded) this.seed(cx, cy, cz);

    const h = this.half;
    const hy = this.halfY;
    const w2 = h * 2;
    const wy2 = hy * 2;
    // Motes drift at a fraction of the ambient wind — they are fine enough to be dragged but
    // slow enough to hang in the shafts.
    const dx = wx * 0.26 * dt;
    const dy = (wy * 0.26 + 0.035) * dt; // faint thermal rise off the warm ground
    const dz = wz * 0.26 * dt;

    const arr = this.aPosSize;
    for (let i = 0; i < n; i++) {
      let x = this.px[i] + dx;
      let y = this.py[i] + dy;
      let z = this.pz[i] + dz;
      // Toroidal wrap in camera-relative space.
      let r = x - cx;
      if (r > h) x -= w2;
      else if (r < -h) x += w2;
      r = y - cy;
      if (r > hy) y -= wy2;
      else if (r < -hy) y += wy2;
      r = z - cz;
      if (r > h) z -= w2;
      else if (r < -h) z += w2;
      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      const o = i * 4;
      arr[o] = x;
      arr[o + 1] = y;
      arr[o + 2] = z;
    }
    this.attrPosSize.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* -------------------------------------------------------------------------- */
/* Heat haze                                                                   */
/* -------------------------------------------------------------------------- */

const HAZE_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  // Vertex-level wobble, strongest towards the top of the column. This is what carries the
  // "the air itself is moving" read at a glance; the fragment noise carries it up close.
  float h = uv.y;
  p.x += sin(h * 9.0 + uTime * 3.4) * 0.045 * h;
  p.x += sin(h * 21.0 - uTime * 5.1) * 0.018 * h;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const HAZE_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uStrength;
uniform vec3 uWarm;
uniform vec3 uCool;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  float rise = uTime * 0.30;
  float n1 = texture2D(uNoise, uv * vec2(1.5, 0.85) + vec2(sin(uTime * 0.6) * 0.03, -rise)).r;
  float n2 = texture2D(uNoise, uv * vec2(3.1, 1.9) + vec2(-uTime * 0.05, -rise * 1.75)).g;
  float n3 = texture2D(uNoise, uv * vec2(6.3, 3.7) + vec2(uTime * 0.09, -rise * 2.6)).b;
  float shimmer = n1 * 0.5 + n2 * 0.34 + n3 * 0.16;

  // Column mask: strong up the middle, gone at the edges, thinning as it rises.
  float mx = smoothstep(0.0, 0.30, uv.x) * (1.0 - smoothstep(0.70, 1.0, uv.x));
  float my = smoothstep(0.0, 0.14, uv.y) * (1.0 - smoothstep(0.45, 1.0, uv.y));

  // Bands of alternating refraction. Turning the noise into thin ridges is what reads as
  // "air bending light" rather than "orange fog".
  float band = 1.0 - abs(shimmer - 0.5) * 2.0;
  float ridge = pow(clamp(band, 0.0, 1.0), 4.0);

  float a = mx * my * uStrength * (0.18 + 1.5 * ridge);
  if (a < 0.002) discard;
  vec3 tint = mix(uCool, uWarm, clamp(shimmer * 1.4, 0.0, 1.0));
  gl_FragColor = vec4(tint * a, a);
}
`;

/* -------------------------------------------------------------------------- */
/* Explosion shockwave ring                                                    */
/* -------------------------------------------------------------------------- */

const RING_VERT = /* glsl */ `
uniform float uInner;
uniform float uOuter;
varying float vR;
varying float vA;
void main() {
  float r = length(position.xy);
  vR = clamp((r - uInner) / max(uOuter - uInner, 1e-4), 0.0, 1.0);
  vA = atan(position.y, position.x);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RING_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uLife;      // 0..1 through the ring's life
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uOpacity;
varying float vR;
varying float vA;

void main() {
  // Angular noise breaks the perfect circle. A mathematically clean ring is the single most
  // artificial-looking thing an explosion can do.
  float n = texture2D(uNoise, vec2(vA * 0.1592 * 3.0, uTime * 0.5)).r;
  float warp = (n - 0.5) * 0.34;
  float r = clamp(vR + warp * (1.0 - uLife), 0.0, 1.0);

  // Three radially offset profiles read as a chromatic split, which is how a real pressure
  // front betrays itself on camera.
  float w = 0.16 + 0.42 * uLife;
  float pr = exp(-pow((r - 0.52) / w, 2.0) * 4.0);
  float pg = exp(-pow((r - 0.50) / w, 2.0) * 4.0);
  float pb = exp(-pow((r - 0.47) / w, 2.0) * 4.0);

  float fade = pow(1.0 - uLife, 1.6);
  vec3 col = mix(uHot, uCool, uLife) * vec3(pr, pg, pb);
  float a = pg * fade * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

//__APPEND__
