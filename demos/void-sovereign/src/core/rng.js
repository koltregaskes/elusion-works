/* Seeded deterministic randomness.
   Every procedural generator in the game draws from here so a given map seed
   always rebuilds the same nebula, the same hull greebles, the same asteroids. */

/** Mix a 32-bit seed into a well-distributed state (SplitMix32). */
function splitmix32(a) {
  return function () {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed = 1) {
  const next = splitmix32(seed >>> 0 || 1);
  let forkCount = 0;

  const rng = {
    seed,
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length) % arr.length],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),

    /** Box–Muller, cached second sample. */
    gaussian(mean = 0, sd = 1) {
      if (rng._spare !== undefined) {
        const v = rng._spare;
        rng._spare = undefined;
        return mean + sd * v;
      }
      let u = 0;
      let v = 0;
      let s = 0;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const mul = Math.sqrt((-2 * Math.log(s)) / s);
      rng._spare = v * mul;
      return mean + sd * (u * mul);
    },

    /** Uniform point on the unit sphere. */
    unitVector() {
      const z = next() * 2 - 1;
      const t = next() * Math.PI * 2;
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      return { x: r * Math.cos(t), y: r * Math.sin(t), z };
    },

    /** Uniform point inside the unit ball (cube-rejection free). */
    ballPoint(radius = 1) {
      const d = rng.unitVector();
      const r = radius * Math.cbrt(next());
      return { x: d.x * r, y: d.y * r, z: d.z * r };
    },

    /** Weighted pick. `weights` parallel to `arr`. */
    weighted(arr, weights) {
      let total = 0;
      for (let i = 0; i < weights.length; i++) total += weights[i];
      let r = next() * total;
      for (let i = 0; i < arr.length; i++) {
        r -= weights[i];
        if (r <= 0) return arr[i];
      }
      return arr[arr.length - 1];
    },

    /** Independent stream — lets a sub-generator advance without disturbing us. */
    fork(salt) {
      const s = salt === undefined ? ++forkCount : salt;
      return makeRng((Math.imul(seed ^ 0x85ebca6b, s + 0x9e3779b9) ^ (s << 13)) >>> 0);
    },
  };

  return rng;
}

/* ---------------------------------------------------------------------------
   Stateless hash noise. Used by shaders' CPU-side twins and by any generator
   that needs "random but reproducible from coordinates" without a stream.
   --------------------------------------------------------------------------- */

export function hash1(x) {
  let h = Math.imul(x ^ 0x2545f491, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export function hash2(x, y) {
  return hash1(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663));
}

export function hash3(x, y, z) {
  return hash1(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791));
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** Value noise, 2D, output [-1,1]. */
export function noise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const n00 = hash2(xi, yi);
  const n10 = hash2(xi + 1, yi);
  const n01 = hash2(xi, yi + 1);
  const n11 = hash2(xi + 1, yi + 1);
  return lerp(lerp(n00, n10, xf), lerp(n01, n11, xf), yf) * 2 - 1;
}

/** Value noise, 3D, output [-1,1]. */
export function noise3(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const zf = fade(z - zi);
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  const z0 = lerp(lerp(c(0, 0, 0), c(1, 0, 0), xf), lerp(c(0, 1, 0), c(1, 1, 0), xf), yf);
  const z1 = lerp(lerp(c(0, 0, 1), c(1, 0, 1), xf), lerp(c(0, 1, 1), c(1, 1, 1), xf), yf);
  return lerp(z0, z1, zf) * 2 - 1;
}

export function fbm2(x, y, octaves = 5, lacunarity = 2.0, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function fbm3(x, y, z, octaves = 5, lacunarity = 2.0, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal — the sharp filament look nebulae need. */
export function ridged3(x, y, z, octaves = 5, lacunarity = 2.1, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise3(x * freq, y * freq, z * freq));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Worley/cellular F1 distance in [0,1]. Cheap 3D variant for rock + panel wear. */
export function worley3(x, y, z, jitter = 1) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let best = 1e9;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const cz = zi + dz;
        const px = cx + jitter * hash3(cx, cy, cz);
        const py = cy + jitter * hash3(cx + 71, cy + 13, cz + 5);
        const pz = cz + jitter * hash3(cx + 3, cy + 97, cz + 41);
        const ddx = px - x;
        const ddy = py - y;
        const ddz = pz - z;
        const d = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d < best) best = d;
      }
    }
  }
  return Math.min(1, Math.sqrt(best));
}
