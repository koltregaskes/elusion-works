import * as THREE from '../../vendor/three/build/three.module.js';
import { makeRng } from '../core/rng.js';

/* Procedural deep-space sky.

   Baked once, at load, into a single equirectangular WebGLRenderTarget by
   shading one full-screen quad with a generated fragment program. Nothing is
   loaded from disk; the whole sky is a string of GLSL assembled from a seeded
   palette and a handful of layer descriptors.

   Why bake instead of evaluating live in a sky shader: a dense star field is
   the highest-frequency content in the game and evaluating it per screen pixel
   guarantees a shimmering mess the moment the camera turns. Baked into a
   mipmapped map it is filtered by the hardware exactly like any other texture,
   and stars are splatted with a minimum sigma of ~0.6 texels so every star is
   band-limited before it is ever stored.

   Why equirectangular and not a cubemap: WebGL 2 has no seamless cube filtering
   (that is a desktop-GL feature), so bilinear taps at a face border clamp
   within their own face and every one of the twelve cube edges shows as a
   visible step. Against a nebula that reads as hard straight lines cutting
   across the sky. A lat/long map has no internal seams; the only join is the
   +/-180 wrap, which RepeatWrapping filters correctly.

   Composition is back-to-front with real absorption. Each gas layer both
   attenuates everything behind it (a per-channel extinction that reddens, as
   dust does) and adds its own emission, and every complex gets explicit dust
   lanes carved through it. That is what separates a nebula with depth from
   coloured smoke on a black JPEG.

   The density model per layer is deliberately three-part:

     halo   an unthresholded glow that reaches far outside the body, so gas
            fades into the void instead of ending at a contour;
     body   a soft-thresholded bulk that carries the dominant hue and does all
            of the absorbing;
     front  a ridged filament network multiplied *by* the body, so ionisation
            fronts can only brighten gas that is already there.

   An earlier version made the filaments the whole density. Ridge troughs then
   had no emission at all while the bed behind them was still being absorbed,
   which produced a black-celled coral texture rather than a nebula. Fronts
   must ride on the body; they must never be able to punch holes in it. */

/* ---------------------------------------------------------------------------
   Palettes. Two dominant hues plus one accent, never more. Values are
   linear-light and are allowed well past 1 on the hot cores — the renderer
   tone-maps with ACES on output, so anything that should read as *emitting*
   has to be given real headroom or it lands as mid grey.
   --------------------------------------------------------------------------- */

const PALETTES = [
  {
    name: 'cindervault', // indigo + teal, rust accent
    haze: [0.038, 0.055, 0.115],
    body: [0.088, 0.170, 0.255],
    core: [0.46, 0.86, 1.15],
    alt: [0.050, 0.150, 0.150],
    altCore: [0.34, 1.00, 0.94],
    accent: [0.300, 0.105, 0.052],
    accentCore: [1.25, 0.50, 0.20],
    band: [0.115, 0.132, 0.170],
    dustExt: [0.55, 0.86, 1.34],
    dustTint: [0.030, 0.050, 0.082],
    key: [0.80, 0.875, 1.00],
    fill: [0.10, 0.19, 0.26],
    warm: false,
  },
  {
    name: 'emberfall', // amber + violet, cyan accent
    haze: [0.062, 0.042, 0.098],
    body: [0.235, 0.125, 0.058],
    core: [1.35, 0.72, 0.26],
    alt: [0.110, 0.068, 0.180],
    altCore: [0.66, 0.46, 1.15],
    accent: [0.048, 0.170, 0.205],
    accentCore: [0.30, 0.96, 1.15],
    band: [0.150, 0.135, 0.118],
    dustExt: [0.48, 0.82, 1.42],
    dustTint: [0.070, 0.040, 0.032],
    key: [1.00, 0.905, 0.760],
    fill: [0.24, 0.13, 0.20],
    warm: true,
  },
  {
    name: 'coldwater', // grey-green + steel cyan, pale gold accent
    haze: [0.036, 0.064, 0.062],
    body: [0.070, 0.140, 0.185],
    core: [0.44, 0.98, 1.15],
    alt: [0.062, 0.125, 0.100],
    altCore: [0.44, 0.98, 0.72],
    accent: [0.250, 0.195, 0.085],
    accentCore: [1.20, 0.95, 0.52],
    band: [0.108, 0.126, 0.132],
    dustExt: [0.58, 0.88, 1.30],
    dustTint: [0.026, 0.048, 0.055],
    key: [0.855, 0.930, 1.00],
    fill: [0.09, 0.17, 0.20],
    warm: false,
  },
  {
    name: 'ironmoth', // steel blue + bruised magenta, ember accent
    haze: [0.034, 0.046, 0.086],
    body: [0.076, 0.108, 0.200],
    core: [0.52, 0.74, 1.20],
    alt: [0.155, 0.062, 0.120],
    altCore: [1.05, 0.44, 0.86],
    accent: [0.320, 0.135, 0.050],
    accentCore: [1.25, 0.54, 0.22],
    band: [0.118, 0.116, 0.145],
    dustExt: [0.52, 0.84, 1.36],
    dustTint: [0.042, 0.036, 0.066],
    key: [0.920, 0.900, 0.985],
    fill: [0.14, 0.12, 0.22],
    warm: false,
  },
  {
    name: 'ochrewake', // ochre + deep teal, bone accent
    haze: [0.085, 0.062, 0.034],
    body: [0.215, 0.150, 0.062],
    core: [1.30, 0.90, 0.42],
    alt: [0.045, 0.115, 0.128],
    altCore: [0.34, 0.98, 1.05],
    accent: [0.245, 0.230, 0.195],
    accentCore: [1.15, 1.08, 0.92],
    band: [0.150, 0.138, 0.114],
    dustExt: [0.50, 0.80, 1.34],
    dustTint: [0.062, 0.048, 0.028],
    key: [1.00, 0.945, 0.845],
    fill: [0.20, 0.17, 0.11],
    warm: true,
  },
  {
    name: 'nightbloom', // indigo + bruise purple, cold cyan accent
    haze: [0.034, 0.036, 0.092],
    body: [0.082, 0.070, 0.205],
    core: [0.60, 0.50, 1.25],
    alt: [0.130, 0.055, 0.145],
    altCore: [0.95, 0.40, 1.05],
    accent: [0.045, 0.175, 0.185],
    accentCore: [0.32, 0.98, 1.10],
    band: [0.112, 0.112, 0.148],
    dustExt: [0.56, 0.84, 1.30],
    dustTint: [0.034, 0.030, 0.064],
    key: [0.880, 0.885, 1.00],
    fill: [0.12, 0.11, 0.24],
    warm: false,
  },
  {
    name: 'saltmarsh', // grey-green + rust, pale cyan accent
    haze: [0.044, 0.058, 0.048],
    body: [0.090, 0.130, 0.108],
    core: [0.62, 1.02, 0.78],
    alt: [0.180, 0.082, 0.044],
    altCore: [1.25, 0.62, 0.28],
    accent: [0.105, 0.205, 0.235],
    accentCore: [0.48, 0.98, 1.15],
    band: [0.126, 0.130, 0.120],
    dustExt: [0.54, 0.84, 1.32],
    dustTint: [0.044, 0.044, 0.036],
    key: [0.960, 0.945, 0.900],
    fill: [0.15, 0.17, 0.15],
    warm: true,
  },
  {
    name: 'deepfathom', // near-monochrome slate blue, single ember accent
    haze: [0.028, 0.042, 0.078],
    body: [0.062, 0.108, 0.190],
    core: [0.50, 0.78, 1.20],
    alt: [0.048, 0.086, 0.155],
    altCore: [0.62, 0.86, 1.15],
    accent: [0.310, 0.130, 0.056],
    accentCore: [1.22, 0.52, 0.22],
    band: [0.104, 0.116, 0.140],
    dustExt: [0.58, 0.88, 1.32],
    dustTint: [0.024, 0.036, 0.060],
    key: [0.845, 0.900, 1.00],
    fill: [0.10, 0.15, 0.24],
    warm: false,
  },
];

/* Envelope cutoff for the gas-layer early-out. Layers fade to exactly zero as
   they approach it, so the branch is a pure performance win and never visible. */
const ENV_CUTOFF = 0.0016;

/* Map HEIGHT in texels; width is twice this. Sized for angular resolution, not
   memory: stars are splatted at ~0.6 texels, so texel size sets how big a star
   can be on screen. 2048 high gives 360/4096 = 0.088 deg per texel, which is
   about two screen pixels at 1080p/48deg FOV — the point where stars read as
   points rather than blobs. Ultra deliberately matches high; going further
   costs a lot of VRAM (a 4096x2048 RGBA16F map with mips is already ~89 MB)
   and buys nothing. */
const SIZE_BY_QUALITY = { low: 768, medium: 1024, high: 2048, ultra: 2048 };

/* --------------------------------------------------------------------------- */

const f3 = (a) => `${num(a[0])}, ${num(a[1])}, ${num(a[2])}`;

function num(v) {
  if (!Number.isFinite(v)) return '0.0';
  const s = v.toFixed(6);
  return s.indexOf('.') >= 0 ? s : s + '.0';
}

/** Orthonormal frame whose first axis is `a`. */
function frame(a) {
  const e0 = a.clone().normalize();
  const seed = Math.abs(e0.y) < 0.86 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(seed, e0).normalize();
  const e2 = new THREE.Vector3().crossVectors(e0, e1).normalize();
  return [e0, e1, e2];
}

function vecFrom(rng) {
  const u = rng.unitVector();
  return new THREE.Vector3(u.x, u.y, u.z);
}

const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/* ---------------------------------------------------------------------------
   Shared GLSL: hashes, gradient noise, fBm, ridged multifractal.
   --------------------------------------------------------------------------- */

const NOISE_GLSL = /* glsl */ `
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}

vec4 hash44(vec4 p) {
  p = fract(p * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p += dot(p, p.wzxy + 33.33);
  return fract((p.xxyz + p.yzzw) * p.zywx);
}

/* Gradient (Perlin-style) value noise, [-1,1]. Grid artefacts are broken up by
   rotating the domain between octaves rather than by using more octaves. */
float gnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = dot(hash33(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0));
  float n100 = dot(hash33(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(hash33(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(hash33(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(hash33(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(hash33(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(hash33(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(hash33(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z) * 1.35;
}

const mat3 M3 = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

float fbm3n(vec3 p) {
  float f = 0.5 * gnoise(p);
  p = M3 * p * 2.02;
  f += 0.25 * gnoise(p);
  p = M3 * p * 2.03;
  f += 0.125 * gnoise(p);
  return f / 0.875;
}

float fbm4n(vec3 p) {
  float f = 0.5 * gnoise(p);
  p = M3 * p * 2.02;
  f += 0.25 * gnoise(p);
  p = M3 * p * 2.03;
  f += 0.125 * gnoise(p);
  p = M3 * p * 2.01;
  f += 0.0625 * gnoise(p);
  return f / 0.9375;
}

float fbm5n(vec3 p) {
  float f = 0.5 * gnoise(p);
  p = M3 * p * 2.02;
  f += 0.25 * gnoise(p);
  p = M3 * p * 2.03;
  f += 0.125 * gnoise(p);
  p = M3 * p * 2.01;
  f += 0.0625 * gnoise(p);
  p = M3 * p * 2.04;
  f += 0.03125 * gnoise(p);
  return f / 0.96875;
}

/* Ridged multifractal — the sharp filament structure real emission nebulae
   have along their ionisation fronts. [0,1]. */
float ridge3(vec3 p) {
  float n = 1.0 - abs(gnoise(p));
  float f = 0.5 * n * n;
  p = M3 * p * 2.05;
  n = 1.0 - abs(gnoise(p));
  f += 0.25 * n * n;
  p = M3 * p * 2.02;
  n = 1.0 - abs(gnoise(p));
  f += 0.125 * n * n;
  return f / 0.875;
}

vec3 desat(vec3 c, float k) {
  return mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, k);
}

/* Rough black-body ramp. t = 0 hot blue-white .. 1 cool red. */
vec3 starTint(float t) {
  vec3 c = mix(vec3(0.70, 0.80, 1.00), vec3(1.00, 1.00, 0.99), smoothstep(0.00, 0.30, t));
  c = mix(c, vec3(1.00, 0.93, 0.80), smoothstep(0.30, 0.62, t));
  c = mix(c, vec3(1.00, 0.80, 0.55), smoothstep(0.62, 0.85, t));
  c = mix(c, vec3(1.00, 0.58, 0.40), smoothstep(0.85, 1.00, t));
  return c;
}
`;

/* ---------------------------------------------------------------------------
   Sky program assembly
   --------------------------------------------------------------------------- */

/* The sky is baked in two passes.

   Everything that is gas — the band, five nebula layers, three dust-lane sets,
   the foreground sheet — is low-frequency, so it is shaded at half the final
   height and upsampled. The star field is the highest-frequency content in the
   game and has to be shaded at full resolution or it aliases. Splitting them
   cuts the expensive half of the bake by 4x and buys the layer count back.

   The join is exact rather than approximate because every layer's extinction
   vector is the same palette `dustExt` scaled by a per-layer constant. The
   total optical depth is therefore a single scalar, and the gas pass can hand
   the star pass one number (alpha) plus the already-composited gas emission
   (rgb). No multiple render targets, no per-channel approximation. */

/** One gas layer: halo + body + ionisation fronts, with absorption. */
function buildLayerGlsl(L) {
  const bodyNoise = L.oct >= 5 ? 'fbm5n' : 'fbm4n';
  return /* glsl */ `
  {
    const vec3 e0 = vec3(${f3(L.e0)});
    const vec3 e1 = vec3(${f3(L.e1)});
    const vec3 e2 = vec3(${f3(L.e2)});
    float ca = dot(d, e0);
    float tx = dot(d, e1) * ${num(1 / L.a)};
    float ty = dot(d, e2) * ${num(1 / L.b)};
    /* Super-gaussian with an exponent under one: a fat core and a long, soft
       halo. A plain gaussian has neither, and the difference between the two
       is most of the difference between "nebula" and "airbrushed blob". */
    float env = exp(-pow(tx * tx + ty * ty + 1.0e-4, ${num(L.shape)}))
              * smoothstep(-0.42, 0.40, ca);
    /* The branch below is a performance early-out over the empty part of the
       sky, but it cannot be allowed to show, so the envelope is faded to
       exactly zero as it approaches the threshold. */
    env *= smoothstep(${num(ENV_CUTOFF)}, ${num(ENV_CUTOFF * 16)}, env);
    if (env > 0.0) {
      vec3 p = d * ${num(L.scale)} + vec3(${f3(L.off)});
      vec3 w = warp * ${num(L.warp)};
      float base = ${bodyNoise}(p + w) * 0.5 + 0.5;

      /* Bulk gas. This is the only term that absorbs. */
      float body = smoothstep(${num(L.thr)}, ${num(L.thr + L.soft)}, base);
      body = pow(body, ${num(L.contrast)});

      /* Ionisation fronts ride *on* the bulk — multiplied by it, never
         independent of it, so a ridge trough can never punch a hole. */
      float fil = ridge3(p * ${num(L.ridgeScale)} + w * 0.55);
      float front = smoothstep(${num(L.filThr)}, ${num(L.filThr + L.filSoft)}, fil)
                  * (0.16 + 0.84 * body);

      /* Unthresholded glow so the gas dissolves into the void. */
      float halo = base * base * base;

      float k = env * clarity;
      float dens = k * (halo * ${num(L.haloAmt)} + body * ${num(L.amount)}
                      + front * ${num(L.frontAmt)});

      vec3 emis = vec3(${f3(L.cool)});
      emis = mix(emis, vec3(${f3(L.mid)}), smoothstep(0.02, 0.80, body));
      emis = mix(emis, vec3(${f3(L.hot)}), clamp(front * front * ${num(L.hotAmt)}, 0.0, 1.0));
      emis = emis * sunLit + SUNCOL * sunFwd * ${num(L.scatterAmt)};

      float tk = k * body * ${num(L.extAmt)};
      emitted *= exp(-EXT * tk);
      tau += tk;
      emitted += emis * dens;
    }
  }`;
}

/** Absorption-only dust lane set: long sinuous filaments through a complex. */
function buildLaneGlsl(L) {
  return /* glsl */ `
  {
    const vec3 e0 = vec3(${f3(L.e0)});
    const vec3 e1 = vec3(${f3(L.e1)});
    const vec3 e2 = vec3(${f3(L.e2)});
    float ca = dot(d, e0);
    float tx = dot(d, e1) * ${num(1 / L.a)};
    float ty = dot(d, e2) * ${num(1 / L.b)};
    float env = exp(-pow(tx * tx + ty * ty + 1.0e-4, ${num(L.shape)}))
              * smoothstep(-0.42, 0.40, ca);
    env *= smoothstep(${num(ENV_CUTOFF)}, ${num(ENV_CUTOFF * 16)}, env);
    if (env > 0.0) {
      vec3 p = d * ${num(L.scale)} + vec3(${f3(L.off)});
      /* Lanes are the zero set of a smooth field, not a threshold on it. That
         is what gives long, sinuous, branching filaments instead of blobs. */
      float n = fbm3n(p + warp * ${num(L.warp)});
      float lane = 1.0 - smoothstep(0.0, ${num(L.width)}, abs(n));
      lane *= 0.35 + 0.65 * smoothstep(0.30, 0.72, ridge3(p * ${num(L.grain)}));
      float amt = env * clarity * lane * ${num(L.amount)};
      emitted *= exp(-EXT * amt);
      tau += amt;
      emitted += (vec3(${f3(L.tint)}) * sunLit + SUNCOL * sunFwd * 0.05) * amt * ${num(L.scatter)};
    }
  }`;
}

/** Pass A: all the gas, at reduced resolution. rgb = emission, a = optical depth. */
function buildGasFragment(P) {
  const on = P.enable;
  const layers = on.nebula ? P.layers.map(buildLayerGlsl).join('\n') : '';
  const lanes = on.nebula ? P.lanes.map(buildLaneGlsl).join('\n') : '';

  return /* glsl */ `
precision highp float;

varying vec2 vUv;

#define PI 3.141592653589793

${NOISE_GLSL}

const vec3 BAND_AXIS = vec3(${f3(P.bandAxis)});
const vec3 BAND_CORE = vec3(${f3(P.bandCore)});
const vec3 EXT = vec3(${f3(P.dustExt)});
const vec3 SUN = vec3(${f3(P.sunDir)});
const vec3 SUNCOL = vec3(${f3(P.sunCol)});

void main() {
  float lon = (vUv.x * 2.0 - 1.0) * PI;
  float lat = (vUv.y - 0.5) * PI;
  float cl = cos(lat);
  vec3 d = normalize(vec3(cl * sin(lon), sin(lat), cl * cos(lon)));

  vec3 emitted = vec3(0.0);
  float tau = 0.0;

  /* The key star lights the gas like it lights everything else. Without this
     the nebula has no lit side and no shadow side and reads as a flat matte
     behind the fleet. Two terms: a broad gradient toward the star, and a
     narrow forward-scattering lobe — dust scatters hard forward, which is why
     a reflection nebula near a bright star glows. */
  float sunMu = dot(d, SUN);
  float sunFwd = pow(max(sunMu, 0.0), 6.0);
  float sunLit = 0.62 + 0.62 * smoothstep(-0.70, 0.85, sunMu);

  /* Very large scale clarity mask: keeps a good part of the sky honestly
     empty instead of veiling the whole shell in gas. */
  float clarity = mix(0.02, 1.0,
    smoothstep(-0.08, 0.42, fbm3n(d * ${num(P.clarityScale)} + vec3(${f3(P.clarityOff)}))));

  /* ---- galactic band: emission first, then its own dust lane in front ---- */
  if (${on.band ? 'true' : 'false'}) {
    float blat = dot(d, BAND_AXIS);
    float g = exp(-(blat * blat) * ${num(1 / (2 * P.bandW * P.bandW))});
    float along = fbm3n(d * ${num(P.bandScale)} + vec3(${f3(P.bandOff)})) * 0.5 + 0.5;
    float mott = ridge3(d * ${num(P.bandScale * 2.6)} + vec3(${f3(P.bandOff)}));
    g *= 0.34 + 0.66 * along;
    float bulge = exp(-(1.0 - dot(d, BAND_CORE)) * ${num(P.bulgeK)});
    vec3 bandCol = vec3(${f3(P.bandCol)});
    emitted += bandCol * (g * ${num(P.bandAmt)} + bulge * ${num(P.bulgeAmt)});
    emitted += desat(bandCol, 0.4) * g * mott * ${num(P.bandAmt * 0.55)};

    float lo = blat - ${num(P.laneOff)};
    float lane = exp(-(lo * lo) * ${num(1 / (2 * P.laneW * P.laneW))});
    float laneN = ridge3(d * ${num(P.laneScale)} + vec3(${f3(P.laneNoiseOff)}));
    float laneD = lane * smoothstep(0.42, 0.86, laneN) * ${num(P.laneAmt)};
    emitted *= exp(-EXT * laneD);
    tau += laneD;
  }

  /* ---- gas layers, far to near ---- */
  vec3 warp = vec3(
    fbm3n(d * ${num(P.warpScale)} + vec3(11.31, 4.72, 27.10)),
    fbm3n(d * ${num(P.warpScale)} + vec3(47.71, 19.03, 3.55)),
    fbm3n(d * ${num(P.warpScale)} + vec3(83.11, 62.40, 91.72)));

${layers}

  /* ---- dust lanes carved through the complexes ---- */
${lanes}

  /* ---- foreground dust sheet: absorption only, plus a whisper of reflection */
  if (${on.nebula ? 'true' : 'false'}) {
    const vec3 f0 = vec3(${f3(P.dust.e0)});
    const vec3 f1 = vec3(${f3(P.dust.e1)});
    const vec3 f2 = vec3(${f3(P.dust.e2)});
    float ca = dot(d, f0);
    float tx = dot(d, f1) * ${num(1 / P.dust.a)};
    float ty = dot(d, f2) * ${num(1 / P.dust.b)};
    float env = exp(-(tx * tx + ty * ty)) * smoothstep(-0.20, 0.45, ca);
    env *= smoothstep(${num(ENV_CUTOFF)}, ${num(ENV_CUTOFF * 16)}, env);
    if (env > 0.0) {
      vec3 p = d * ${num(P.dust.scale)} + vec3(${f3(P.dust.off)});
      float nn = fbm4n(p + warp * 1.5) * 0.5 + 0.5;
      float rg = ridge3(p * 1.7 + warp * 0.8);
      float m = mix(nn, rg, 0.40);
      float dens = env * smoothstep(${num(P.dust.thr)}, ${num(P.dust.thr + 0.30)}, m) * ${num(P.dust.amount)};
      emitted *= exp(-EXT * dens);
      tau += dens;
      emitted += vec3(${f3(P.dustTint)}) * dens * 0.45;
    }
  }

  gl_FragColor = vec4(max(emitted, vec3(0.0)), tau);
}
`;
}

/** Pass B: stars at full resolution, absorbed by the gas pass, plus the gas. */
function buildSkyFragment(P) {
  const on = P.enable;

  return /* glsl */ `
precision highp float;

varying vec2 vUv;

#define PI 3.141592653589793

uniform float uStarSigma;   // minimum star sigma, in texels
uniform float uStarGain;
uniform sampler2D uGas;

${NOISE_GLSL}

const vec3 BAND_AXIS = vec3(${f3(P.bandAxis)});
const vec3 EXT = vec3(${f3(P.dustExt)});

/* ---- star fields ---------------------------------------------------------

   Stars live on a 3D lattice wrapped round the surface of the unit cube. A
   plain per-face 2D grid would tear at the cube seams; a 3D lattice does not,
   because the 3x3x3 neighbourhood is continuous across every edge and corner.
   Cells are kept only if their jittered point lands within 0.4 cells of the
   cube surface, which both bounds the neighbourhood search and keeps the
   surface density uniform. Acceptance is weighted by 1/|c|^3 so the cube-to-
   sphere distortion does not pile stars into the eight corners. */

vec3 starMain(vec3 d, float sig) {
  vec3 acc = vec3(0.0);
  vec3 c = d / max(abs(d.x), max(abs(d.y), abs(d.z)));
  vec3 gi = floor(c * ${num(P.starCells)});
  float sg2 = sig * sig;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 cell = gi + vec3(float(x), float(y), float(z));
        vec4 h = hash44(vec4(cell, ${num(P.starSalt)}));
        vec3 sp = (cell + h.yzw) * ${num(1 / P.starCells)};
        float mx = max(abs(sp.x), max(abs(sp.y), abs(sp.z)));
        if (abs(mx - 1.0) > ${num(0.4 / P.starCells)}) continue;
        float len = length(sp);
        vec3 sd = sp / len;
        float lat = dot(sd, BAND_AXIS);
        float conc = 0.42 + 1.30 * exp(-(lat * lat) * ${num(1 / (2 * P.starBandW * P.starBandW))});
        if (h.x * len * len * len > ${num(P.starDensity)} * conc) continue;
        vec4 g = hash44(vec4(cell, ${num(P.starSalt + 31.7)}));
        vec3 dl = d - sd;
        /* A wide magnitude range is what makes a field read as a sky rather
           than as a spray of identical dots: the top percentile has to be an
           order of magnitude above the median, not twice it. */
        float mag = ${num(P.starMag)} * (0.008 + pow(g.x, ${num(P.starMagPow)}) * 3.4);
        acc += starTint(pow(g.y, 1.9)) * mag * exp(-dot(dl, dl) / sg2);
      }
    }
  }
  return acc;
}

vec3 starBright(vec3 d, float sig) {
  vec3 acc = vec3(0.0);
  vec3 c = d / max(abs(d.x), max(abs(d.y), abs(d.z)));
  vec3 gi = floor(c * ${num(P.brightCells)});
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 cell = gi + vec3(float(x), float(y), float(z));
        vec4 h = hash44(vec4(cell, ${num(P.brightSalt)}));
        vec3 sp = (cell + h.yzw) * ${num(1 / P.brightCells)};
        float mx = max(abs(sp.x), max(abs(sp.y), abs(sp.z)));
        if (abs(mx - 1.0) > ${num(0.4 / P.brightCells)}) continue;
        float len = length(sp);
        vec3 sd = sp / len;
        if (h.x * len * len * len > ${num(P.brightDensity)}) continue;
        vec4 g = hash44(vec4(cell, ${num(P.brightSalt + 53.1)}));
        vec3 dl = d - sd;
        float r2 = dot(dl, dl);
        float bm = ${num(P.brightMag)} * (0.20 + pow(g.x, 3.4) * 3.2);
        float core = exp(-r2 / (sig * sig * 1.30));
        float halo = 0.030 * exp(-sqrt(r2) / (sig * 6.0));
        // Four-point diffraction, oriented per star so they do not all align.
        vec3 up0 = abs(sd.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 t1 = normalize(cross(up0, sd));
        vec3 t2 = cross(sd, t1);
        float a = g.z * 6.2831853;
        float ca = cos(a);
        float sa = sin(a);
        vec3 s1 = t1 * ca + t2 * sa;
        vec3 s2 = t2 * ca - t1 * sa;
        float p1 = dot(dl, s1);
        float p2 = dot(dl, s2);
        float wsp = sig * 0.46;
        float lsp = sig * 6.0;
        float spike = exp(-abs(p1) / lsp) * exp(-(p2 * p2) / (wsp * wsp))
                    + exp(-abs(p2) / lsp) * exp(-(p1 * p1) / (wsp * wsp));
        acc += starTint(pow(g.y, 2.6)) * bm * (core + halo + spike * ${num(P.spikeAmt)} * step(${num(P.spikeThresh)}, bm));
      }
    }
  }
  return acc;
}

void main() {
  /* Lat/long -> direction, per fragment. It has to be done here rather than
     interpolated: a direction lerped across the quad is not a unit vector and
     the whole sky would shear. Convention matches three's equirect sampler. */
  float lon = (vUv.x * 2.0 - 1.0) * PI;
  float lat = (vUv.y - 0.5) * PI;
  float cl = cos(lat);
  vec3 d = normalize(vec3(cl * sin(lon), sin(lat), cl * cos(lon)));

  /* Star sigma is derived from the local texel footprint, which on an equirect
     map stretches badly towards the poles. Taking the length of fwidth(d)
     keeps every star band-limited for the texels it actually occupies. */
  float texel = max(1.0e-7, length(fwidth(d)));
  float sig = texel * uStarSigma;

  /* Stars sit behind everything, so they pick up every layer's extinction —
     which the gas pass has already accumulated into one optical depth. */
  vec3 stars = ${on.stars ? '(starMain(d, sig) + starBright(d, sig)) * uStarGain' : 'vec3(0.0)'};

  vec4 gas = texture2D(uGas, vUv);
  vec3 col = stars * exp(-EXT * gas.a) + gas.rgb;

  /* A hair of ambient so the void is deep charcoal-blue rather than a dead
     zero — pure #000 reads as a hole punched in the frame. */
  col += vec3(${f3(P.voidCol)});

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;
}

const SKY_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/* ---------------------------------------------------------------------------
   Parameter generation
   --------------------------------------------------------------------------- */

function generateParams(rng, opts) {
  const pal = PALETTES[rng.int(0, PALETTES.length - 1)];

  /* Where the key star sits. ENV picks this before the sky is baked so the
     nebula, the visible star disc and every hull terminator agree. */
  const sd = opts && opts.sunDirection ? opts.sunDirection : null;
  const sunDir = sd ? [sd.x, sd.y, sd.z] : (() => { const u = vecFrom(rng); return [u.x, u.y, u.z]; })();

  const bandAxis = vecFrom(rng);
  // Keep the band off the horizon-ish plane so it cuts the frame at an angle.
  if (Math.abs(bandAxis.y) > 0.86) bandAxis.y *= 0.45;
  bandAxis.normalize();
  const bandFrame = frame(bandAxis);
  const coreAng = rng.range(0, Math.PI * 2);
  const bandCore = bandFrame[1]
    .clone()
    .multiplyScalar(Math.cos(coreAng))
    .addScaledVector(bandFrame[2], Math.sin(coreAng))
    .addScaledVector(bandAxis, rng.range(-0.06, 0.06))
    .normalize();

  /* Two complexes. The primary is a big three-layer emission region that owns
     one side of the sky; the secondary is a smaller, dimmer, differently-hued
     region well away from it, so the sky has a near and a far object rather
     than one smudge. Everything else stays empty on purpose. */
  /* Where the primary complex sits.

     Not uniform on the sphere. The camera rig orbits with its pitch clamped to
     roughly +/-70 degrees and spends nearly all of its time within 30 of the
     horizontal, so a nebula placed at the zenith is a nebula almost nobody
     sees — and on an earlier build most seeds opened on a sky with no gas in
     frame at all. Pull the anchor into the band the player actually looks
     through, without pinning it to the equator. */
  const anchor = vecFrom(rng);
  anchor.y *= 0.34;
  if (Math.abs(anchor.y) > 0.42) anchor.y = 0.42 * Math.sign(anchor.y);
  anchor.normalize();
  const anchorFrame = frame(anchor);
  const jitter = (spread) =>
    anchor
      .clone()
      .addScaledVector(anchorFrame[1], rng.gaussian(0, spread))
      .addScaledVector(anchorFrame[2], rng.gaussian(0, spread))
      .normalize();

  /* The secondary goes roughly opposite in yaw and also near the horizon, so
     whichever way the player turns there is something in the sky. The two are
     kept at least ~75 degrees apart so they never merge into one smear. */
  let second = vecFrom(rng);
  for (let i = 0; i < 48; i++) {
    second = vecFrom(rng);
    second.y *= 0.40;
    second.normalize();
    if (second.dot(anchor) < 0.22) break;
  }
  const secondFrame = frame(second);
  const jitter2 = (spread) =>
    second
      .clone()
      .addScaledVector(secondFrame[1], rng.gaussian(0, spread))
      .addScaledVector(secondFrame[2], rng.gaussian(0, spread))
      .normalize();

  const gain = rng.range(0.92, 1.18); // per-seed overall gas brightness

  const layerDefs = [
    /* --- primary: outer envelope, the dominant hue at its coolest --- */
    {
      centre: jitter(0.24),
      oct: 4,
      cool: mul(pal.haze, 0.9),
      mid: pal.body,
      hot: mul(pal.core, 0.42),
      ext: mul(pal.dustExt, rng.range(0.5, 0.8)),
      a: rng.range(0.78, 1.12),
      b: rng.range(0.56, 0.86),
      shape: rng.range(0.74, 0.92),
      scale: rng.range(1.3, 2.0),
      warp: rng.range(0.65, 1.05),
      ridgeScale: rng.range(1.4, 2.0),
      thr: rng.range(0.34, 0.44),
      soft: rng.range(0.26, 0.38),
      contrast: rng.range(1.00, 1.30),
      filThr: rng.range(0.56, 0.66),
      filSoft: rng.range(0.16, 0.26),
      haloAmt: rng.range(0.14, 0.24) * gain,
      amount: rng.range(1.15, 1.65) * gain,
      frontAmt: rng.range(0.30, 0.55) * gain,
      hotAmt: rng.range(0.45, 0.75),
      extAmt: rng.range(0.9, 1.4),
      scatterAmt: rng.range(0.10, 0.20),
    },
    /* --- primary: the body proper, where the colour lives --- */
    {
      centre: jitter(0.18),
      oct: 5,
      cool: mul(pal.body, 0.55),
      mid: pal.body,
      hot: pal.core,
      ext: mul(pal.dustExt, rng.range(1.0, 1.6)),
      a: rng.range(0.50, 0.76),
      b: rng.range(0.36, 0.60),
      shape: rng.range(0.80, 1.00),
      scale: rng.range(2.6, 3.9),
      warp: rng.range(0.48, 0.80),
      ridgeScale: rng.range(1.6, 2.3),
      thr: rng.range(0.42, 0.52),
      soft: rng.range(0.20, 0.30),
      contrast: rng.range(0.95, 1.25),
      filThr: rng.range(0.52, 0.62),
      filSoft: rng.range(0.13, 0.21),
      haloAmt: rng.range(0.12, 0.21) * gain,
      amount: rng.range(1.35, 1.95) * gain,
      frontAmt: rng.range(0.75, 1.15) * gain,
      hotAmt: rng.range(0.75, 1.05),
      extAmt: rng.range(1.0, 1.5),
      scatterAmt: rng.range(0.06, 0.13),
    },
    /* --- primary: the accent. Small, hot, and the only place the third hue
       is allowed to appear at strength. --- */
    {
      centre: jitter(0.30),
      oct: 5,
      cool: mul(pal.accent, 0.55),
      mid: pal.accent,
      hot: pal.accentCore,
      ext: mul(pal.dustExt, rng.range(0.45, 0.85)),
      a: rng.range(0.26, 0.44),
      b: rng.range(0.18, 0.34),
      shape: rng.range(0.80, 1.00),
      scale: rng.range(4.4, 6.6),
      warp: rng.range(0.30, 0.55),
      ridgeScale: rng.range(1.9, 2.7),
      thr: rng.range(0.44, 0.54),
      soft: rng.range(0.16, 0.26),
      contrast: rng.range(1.0, 1.3),
      filThr: rng.range(0.48, 0.58),
      filSoft: rng.range(0.10, 0.18),
      haloAmt: rng.range(0.08, 0.15) * gain,
      amount: rng.range(0.85, 1.35) * gain,
      frontAmt: rng.range(0.85, 1.35) * gain,
      hotAmt: rng.range(0.90, 1.25),
      extAmt: rng.range(0.7, 1.1),
      scatterAmt: rng.range(0.04, 0.09),
    },
    /* --- secondary complex: the second dominant hue, quieter --- */
    {
      centre: jitter2(0.22),
      oct: 4,
      cool: mul(pal.alt, 0.55),
      mid: pal.alt,
      hot: mul(pal.altCore, 0.72),
      ext: mul(pal.dustExt, rng.range(0.55, 0.95)),
      a: rng.range(0.50, 0.80),
      b: rng.range(0.32, 0.58),
      shape: rng.range(0.76, 0.96),
      scale: rng.range(2.0, 3.2),
      warp: rng.range(0.50, 0.85),
      ridgeScale: rng.range(1.5, 2.2),
      thr: rng.range(0.44, 0.54),
      soft: rng.range(0.24, 0.34),
      contrast: rng.range(0.95, 1.25),
      filThr: rng.range(0.56, 0.66),
      filSoft: rng.range(0.14, 0.22),
      haloAmt: rng.range(0.09, 0.16) * gain,
      amount: rng.range(0.75, 1.15) * gain,
      frontAmt: rng.range(0.40, 0.70) * gain,
      hotAmt: rng.range(0.55, 0.85),
      extAmt: rng.range(0.9, 1.3),
      scatterAmt: rng.range(0.07, 0.14),
    },
    /* --- secondary: a hot knot inside it so it is not a flat wash --- */
    {
      centre: jitter2(0.16),
      oct: 5,
      cool: mul(pal.alt, 0.7),
      mid: mul(pal.altCore, 0.30),
      hot: pal.altCore,
      ext: mul(pal.dustExt, rng.range(0.5, 0.9)),
      a: rng.range(0.20, 0.36),
      b: rng.range(0.14, 0.28),
      shape: rng.range(0.84, 1.04),
      scale: rng.range(4.0, 6.0),
      warp: rng.range(0.28, 0.52),
      ridgeScale: rng.range(2.0, 2.8),
      thr: rng.range(0.46, 0.56),
      soft: rng.range(0.15, 0.24),
      contrast: rng.range(1.0, 1.3),
      filThr: rng.range(0.50, 0.60),
      filSoft: rng.range(0.10, 0.18),
      haloAmt: rng.range(0.06, 0.12) * gain,
      amount: rng.range(0.55, 0.95) * gain,
      frontAmt: rng.range(0.60, 1.00) * gain,
      hotAmt: rng.range(0.85, 1.15),
      extAmt: rng.range(0.7, 1.1),
      scatterAmt: rng.range(0.04, 0.09),
    },
  ];

  const withFrame = (L) => {
    const [e0, e1, e2] = frame(L.centre);
    return {
      ...L,
      e0: [e0.x, e0.y, e0.z],
      e1: [e1.x, e1.y, e1.z],
      e2: [e2.x, e2.y, e2.z],
      off: [rng.range(-40, 40), rng.range(-40, 40), rng.range(-40, 40)],
    };
  };

  const layers = layerDefs.map(withFrame);

  /* Dust lanes. Two sets over the primary at different scales, one over the
     secondary. These are the single biggest contributor to a nebula reading as
     something with depth rather than a painted gradient. */
  const laneDefs = [
    {
      centre: jitter(0.20),
      a: rng.range(0.85, 1.25),
      b: rng.range(0.60, 0.95),
      shape: rng.range(0.70, 0.90),
      scale: rng.range(1.7, 2.6),
      warp: rng.range(0.55, 0.95),
      width: rng.range(0.10, 0.19),
      grain: rng.range(2.2, 3.4),
      amount: rng.range(1.3, 2.2),
      ext: pal.dustExt,
      tint: mul(pal.dustTint, 1.0),
      scatter: rng.range(0.10, 0.26),
    },
    {
      centre: jitter(0.26),
      a: rng.range(0.50, 0.80),
      b: rng.range(0.34, 0.58),
      shape: rng.range(0.78, 0.98),
      scale: rng.range(3.6, 5.4),
      warp: rng.range(0.35, 0.65),
      width: rng.range(0.055, 0.11),
      grain: rng.range(3.4, 5.0),
      amount: rng.range(1.1, 1.9),
      ext: pal.dustExt,
      tint: mul(pal.dustTint, 0.8),
      scatter: rng.range(0.08, 0.22),
    },
    {
      centre: jitter2(0.20),
      a: rng.range(0.55, 0.90),
      b: rng.range(0.36, 0.64),
      shape: rng.range(0.74, 0.94),
      scale: rng.range(2.4, 3.6),
      warp: rng.range(0.45, 0.80),
      width: rng.range(0.08, 0.15),
      grain: rng.range(2.6, 4.0),
      amount: rng.range(1.0, 1.8),
      ext: pal.dustExt,
      tint: mul(pal.dustTint, 0.9),
      scatter: rng.range(0.08, 0.20),
    },
  ];

  const lanes = laneDefs.map(withFrame);

  const dustCentre = jitter(0.55);
  const dustFrame = frame(dustCentre);

  const bandW = rng.range(0.075, 0.135);

  return {
    palette: pal,
    layers,
    lanes,
    bandAxis: [bandAxis.x, bandAxis.y, bandAxis.z],
    bandCore: [bandCore.x, bandCore.y, bandCore.z],
    bandW,
    bandScale: rng.range(2.2, 3.4),
    bandOff: [rng.range(-30, 30), rng.range(-30, 30), rng.range(-30, 30)],
    bandCol: pal.band,
    bandAmt: rng.range(0.14, 0.22),
    bulgeK: rng.range(9.0, 17.0),
    bulgeAmt: rng.range(0.18, 0.32),
    laneOff: rng.range(-0.045, 0.045),
    laneW: bandW * rng.range(0.34, 0.55),
    laneScale: rng.range(4.5, 7.0),
    laneNoiseOff: [rng.range(-30, 30), rng.range(-30, 30), rng.range(-30, 30)],
    laneAmt: rng.range(1.5, 2.6),

    warpScale: rng.range(1.1, 1.9),
    clarityScale: rng.range(0.72, 1.15),
    clarityOff: [rng.range(-25, 25), rng.range(-25, 25), rng.range(-25, 25)],

    dust: {
      e0: dustFrame[0].toArray(),
      e1: dustFrame[1].toArray(),
      e2: dustFrame[2].toArray(),
      a: rng.range(0.55, 0.95),
      b: rng.range(0.30, 0.60),
      scale: rng.range(2.6, 4.2),
      off: [rng.range(-40, 40), rng.range(-40, 40), rng.range(-40, 40)],
      thr: rng.range(0.50, 0.58),
      amount: rng.range(1.8, 3.0),
    },
    dustExt: pal.dustExt,
    dustTint: pal.dustTint,
    sunDir,
    sunCol: mul(pal.key, 0.42),

    /* Star budget. Deliberately far below what the field can carry: with a
       nebula this strong the stars are texture, not subject. Too many bright
       ones and the sky reads as confetti and the auto-exposure chases them
       instead of the gas. */
    starCells: 55,
    starSalt: rng.range(1, 900),
    starDensity: rng.range(0.20, 0.30),
    starBandW: bandW * rng.range(2.2, 3.2),
    starMag: rng.range(0.16, 0.24),
    starMagPow: rng.range(6.5, 8.5),
    brightCells: 4,
    brightSalt: rng.range(1, 900),
    brightDensity: rng.range(0.055, 0.095),
    brightMag: rng.range(0.85, 1.45),
    spikeAmt: rng.range(0.045, 0.085),
    spikeThresh: rng.range(2.6, 3.4),

    voidCol: [
      pal.haze[0] * 0.045 + 0.0009,
      pal.haze[1] * 0.045 + 0.0011,
      pal.haze[2] * 0.045 + 0.0016,
    ],
  };
}

/* --------------------------------------------------------------------------- */

/**
 * Bake a deep-space sky as an equirectangular map.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {object|number} rng            seeded rng from core/rng.js (or a raw seed)
 * @param {object}  [opts]
 * @param {number}  [opts.size]          map height in texels (width is 2x)
 * @param {string}  [opts.quality]       'low'|'medium'|'high'|'ultra'
 * @param {number}  [opts.tiles]         scissor tiles per axis (TDR safety)
 * @returns {{ texture: THREE.Texture, palette, keyColour, fillColour,
 *             ambientColour, nebulaColour, size, dispose(): void }}
 */
export function buildSkybox(renderer, rng, opts = {}) {
  const r = typeof rng === 'number' ? makeRng(rng) : rng;
  const quality = opts.quality || 'high';
  const size = Math.max(128, opts.size || SIZE_BY_QUALITY[quality] || 1024);
  const tiles = Math.max(1, opts.tiles || (size >= 2048 ? 6 : size >= 1024 ? 3 : 1));

  const P = generateParams(r, opts);
  P.enable = Object.assign({ nebula: true, stars: true, band: true }, opts.layers || {});

  const W = size * 2;
  const H = size;

  /* Two star maps, not one.

     The full 4096x2048 star pass is several seconds of fragment work even on
     the target machine, and it used to run as one synchronous block in the
     Environment constructor — the page simply stopped for the duration and the
     boot bar lied about which stage it was on. So: bake a half-size map
     synchronously, hand that back immediately so the game is playable, and
     fill the full-size map a tile at a time from the render loop. ENV swaps
     the texture over when it completes. The preview is a real sky, just with
     softer stars, and at half size it costs a quarter of the time. */
  const progressive = size >= 1024 && opts.progressive !== false;
  const PW = progressive ? W >> 1 : W;
  const PH = progressive ? H >> 1 : H;

  const makeSkyTarget = (w, h) => {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    rt.texture.mapping = THREE.EquirectangularReflectionMapping;
    rt.texture.name = 'skybox:' + P.palette.name;
    return rt;
  };

  const preview = makeSkyTarget(PW, PH);
  const target = progressive ? makeSkyTarget(W, H) : preview;

  /* Pass A target. A quarter of the final height: the gas has no feature finer
     than about a third of a degree, so at 1024 wide the sharpest ionisation
     front still spans ten texels. Shading it at full resolution was the single
     largest item in the bake, for detail that is below the resolution of the
     screen it ends up on. Bilinear on the way out also quietly removes the
     last of the noise aliasing. */
  const GW = Math.max(512, W >> 2);
  const GH = Math.max(256, H >> 2);
  const gasTarget = new THREE.WebGLRenderTarget(GW, GH, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
  gasTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;

  const gasMaterial = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: SKY_VERTEX,
    fragmentShader: buildGasFragment(P),
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const material = new THREE.ShaderMaterial({
    uniforms: {
      // Roughly one texel of standard deviation: below ~0.5 the splat stops
      // being band-limited and the field starts to crawl when the camera turns.
      uStarSigma: { value: 0.62 },
      uStarGain: { value: 1.0 },
      uGas: { value: gasTarget.texture },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: buildSkyFragment(P),
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.Camera();

  const prevTarget = renderer.getRenderTarget();
  const prevScissorTest = renderer.getScissorTest();
  const prevScissor = new THREE.Vector4();
  renderer.getScissor(prevScissor);

  /* Both passes are tiled. A whole-sky nebula is a few hundred million noise
     evaluations; splitting it means no single draw call can trip the display
     driver's watchdog on a weaker GPU. */
  const drawTiled = (mat, rt, w, h, n) => {
    quad.material = mat;
    renderer.setRenderTarget(rt);
    if (n <= 1) {
      renderer.setScissorTest(false);
      renderer.render(quadScene, quadCam);
      return;
    }
    const stepX = Math.ceil(w / (n * 2));
    const stepY = Math.ceil(h / n);
    renderer.setScissorTest(true);
    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n * 2; tx++) {
        renderer.setScissor(tx * stepX, ty * stepY, stepX, stepY);
        renderer.render(quadScene, quadCam);
      }
    }
    renderer.setScissorTest(false);
  };

  /** Mip chain is what actually stops the star field aliasing under rotation. */
  const buildMips = (rt) => {
    rt.texture.generateMipmaps = true;
    rt.texture.needsPMREMUpdate = true;
    const gl = renderer.getContext();
    const props = renderer.properties.get(rt.texture);
    if (props && props.__webglTexture) {
      renderer.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
  };

  drawTiled(gasMaterial, gasTarget, GW, GH, tiles);
  drawTiled(material, preview, PW, PH, tiles);
  quad.material = material;
  buildMips(preview);

  const probe = probeSky(renderer, preview.texture);

  renderer.setScissorTest(prevScissorTest);
  renderer.setScissor(prevScissor.x, prevScissor.y, prevScissor.z, prevScissor.w);
  renderer.setRenderTarget(prevTarget);

  /* ---- progressive refinement of the full-size map ---------------------- */

  /* One chunk per frame. The grid is sized so a chunk is a few milliseconds on
     the target machine — small enough that the frame it lands in is not
     visibly longer, large enough that the whole map finishes inside the first
     few seconds of play. */
  const REFINE_COLS = 24;
  const REFINE_ROWS = 12;
  const chunkTotal = progressive ? REFINE_COLS * REFINE_ROWS : 0;
  let chunkDone = 0;
  let swapped = !progressive;
  let torn = false;

  const releaseBakeKit = () => {
    if (torn) return;
    torn = true;
    gasTarget.dispose();
    gasMaterial.dispose();
    material.dispose();
    quad.geometry.dispose();
  };
  if (!progressive) {
    // The gas map has served its purpose the moment the star pass has read it.
    gasTarget.dispose();
    gasMaterial.dispose();
  }

  const pal = P.palette;
  const keyColour = new THREE.Color(pal.key[0], pal.key[1], pal.key[2]);
  keyColour.lerp(WHITE, 0.12);

  /* Lighting colours are pulled hard toward neutral on purpose.

     The sky is now genuinely saturated, and a fill light taken straight from
     it would push a bone-grey hull to whatever hue the nebula happens to be —
     which is exactly the "everything is brown" failure the visual direction
     forbids. Colour is meant to come from the nebula *behind* the ships, not
     from repainting them. So: take the hue from the sky, then spend almost all
     of the saturation. What survives is a tint, not a gel. */
  const fillColour = probe.mean.clone().lerp(new THREE.Color(pal.fill[0], pal.fill[1], pal.fill[2]), 0.45);
  lightingTint(fillColour, 0.52);

  const nebulaColour = probe.weighted.clone();
  lightingTint(nebulaColour, 0.62);

  const ambientColour = fillColour.clone().lerp(nebulaColour, 0.3);
  lightingTint(ambientColour, 0.44);

  /* What the hull shader wants for its own bounce term: a saturated rim hue
     from the bright side of the sky, and a dark, cool fill for the shadow
     side. These are ratios, not intensities — MAT scales them. */
  const bounceKey = probe.weighted.clone();
  lightingTint(bounceKey, 0.80);
  bounceKey.multiplyScalar(0.62);
  const bounceFill = probe.mean.clone().lerp(new THREE.Color(pal.fill[0], pal.fill[1], pal.fill[2]), 0.6);
  lightingTint(bounceFill, 0.72);
  bounceFill.multiplyScalar(0.20);

  const result = {
    texture: preview.texture,
    renderTarget: preview,
    /** 0..1. Reaches 1 the frame the full-size map is swapped in. */
    get refineProgress() {
      return chunkTotal ? chunkDone / chunkTotal : 1;
    },
    get refined() {
      return swapped;
    },
    /**
     * Shade the next `chunks` tiles of the full-size map. Returns true on the
     * frame the swap happens, so the caller knows to re-point anything holding
     * the old texture (scene.background, scene.environment).
     */
    refine(rr, chunks = 1) {
      if (swapped || torn) return false;
      const pTarget = rr.getRenderTarget();
      const pScissorTest = rr.getScissorTest();
      const pScissor = new THREE.Vector4();
      rr.getScissor(pScissor);

      const stepX = Math.ceil(W / REFINE_COLS);
      const stepY = Math.ceil(H / REFINE_ROWS);
      quad.material = material;
      rr.setRenderTarget(target);
      rr.setScissorTest(true);
      for (let i = 0; i < chunks && chunkDone < chunkTotal; i++, chunkDone++) {
        const tx = chunkDone % REFINE_COLS;
        const ty = (chunkDone / REFINE_COLS) | 0;
        rr.setScissor(tx * stepX, ty * stepY, stepX, stepY);
        rr.render(quadScene, quadCam);
      }
      rr.setScissorTest(pScissorTest);
      rr.setScissor(pScissor.x, pScissor.y, pScissor.z, pScissor.w);

      let flipped = false;
      if (chunkDone >= chunkTotal) {
        buildMips(target);
        result.texture = target.texture;
        result.renderTarget = target;
        swapped = true;
        flipped = true;
      }
      rr.setRenderTarget(pTarget);
      if (flipped) {
        preview.dispose();
        releaseBakeKit();
      }
      return flipped;
    },
    palette: {
      name: pal.name,
      warm: pal.warm,
      haze: new THREE.Color(...pal.haze),
      body: new THREE.Color(...pal.body),
      core: new THREE.Color(...pal.core),
      alt: new THREE.Color(...pal.alt),
      accent: new THREE.Color(...pal.accent),
      band: new THREE.Color(...pal.band),
    },
    keyColour,
    fillColour,
    ambientColour,
    nebulaColour,
    bounceKey,
    bounceFill,
    average: probe.mean.clone(),
    averageLuminance: probe.luminance,
    size,
    dispose() {
      target.dispose();
      if (preview !== target) preview.dispose();
      releaseBakeKit();
    },
  };

  return result;
}

const WHITE = new THREE.Color(1, 1, 1);

/**
 * Turn a measured sky colour into something safe to light grey hulls with:
 * normalise the brightest channel to 1 so it is a pure hue, then spend most of
 * the saturation. `sat` is how much chroma survives.
 */
function lightingTint(c, sat) {
  const m = Math.max(c.r, c.g, c.b, 1e-5);
  c.multiplyScalar(1 / m);
  c.lerp(WHITE, 1 - sat);
  return c;
}

/* ---------------------------------------------------------------------------
   Sky readback. Two texels: the plain mean (what the sky contributes as fill)
   and a luminance-weighted mean (the hue of the bright regions, which is what
   a rim light should be tinted with).
   --------------------------------------------------------------------------- */

const PROBE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uSky;
#define PI 3.141592653589793

vec3 sampleSky(vec3 dir) {
  vec2 uv = vec2(atan(dir.x, dir.z) / (2.0 * PI) + 0.5, asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5);
  return texture2D(uSky, uv).rgb;
}
varying vec2 vXy;

void main() {
  vec3 sum = vec3(0.0);
  vec3 wsum = vec3(0.0);
  float wtot = 0.0;
  for (int i = 0; i < 160; i++) {
    float t = (float(i) + 0.5) * (1.0 / 160.0);
    float z = 1.0 - 2.0 * t;
    float rr = sqrt(max(0.0, 1.0 - z * z));
    float ph = float(i) * 2.39996323;
    vec3 dir = vec3(rr * cos(ph), rr * sin(ph), z);
    vec3 c = sampleSky(dir);
    sum += c;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float w = l * l;
    wsum += c * w;
    wtot += w;
  }
  vec3 mean = sum * (1.0 / 160.0);
  vec3 wmean = wsum / max(wtot, 1.0e-6);
  vec3 outc = vXy.x < 0.0 ? mean * 8.0 : wmean / max(max(wmean.r, max(wmean.g, wmean.b)), 1.0e-5);
  gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
`;

function probeSky(renderer, skyTexture) {
  const rt = new THREE.WebGLRenderTarget(2, 1, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSky: { value: skyTexture } },
    vertexShader: `
      varying vec2 vXy;
      void main() {
        vXy = position.xy;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: PROBE_FRAG,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);

  renderer.setRenderTarget(rt);
  renderer.setScissorTest(false);
  renderer.render(scene, new THREE.Camera());

  const buf = new Uint8Array(8);
  let mean = new THREE.Color(0.05, 0.07, 0.10);
  let weighted = new THREE.Color(0.5, 0.7, 0.9);
  try {
    renderer.readRenderTargetPixels(rt, 0, 0, 2, 1, buf);
    mean = new THREE.Color((buf[0] / 255) / 8, (buf[1] / 255) / 8, (buf[2] / 255) / 8);
    weighted = new THREE.Color(buf[4] / 255, buf[5] / 255, buf[6] / 255);
  } catch (e) {
    /* Readback is a nicety; the palette fallbacks above are perfectly usable. */
  }

  rt.dispose();
  quad.geometry.dispose();
  mat.dispose();

  const luminance = 0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b;
  if (mean.r + mean.g + mean.b < 1e-4) mean.setRGB(0.05, 0.07, 0.1);
  if (weighted.r + weighted.g + weighted.b < 1e-4) weighted.setRGB(0.5, 0.7, 0.9);
  return { mean, weighted, luminance };
}
