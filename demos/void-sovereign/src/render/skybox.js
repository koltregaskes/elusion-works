import * as THREE from '../../vendor/three/build/three.module.js';
import { makeRng } from '../core/rng.js';

/* Procedural deep-space cubemap.

   Baked once, at load, into a WebGLCubeRenderTarget by shading six full-screen
   quads — one per face — with a single generated fragment program. Nothing is
   loaded from disk; the whole sky is a string of GLSL assembled from a seeded
   palette and a handful of layer descriptors.

   Why bake instead of evaluating the nebula live in a sky shader: a dense star
   field is the highest-frequency content in the game and evaluating it per
   screen pixel guarantees a shimmering mess the moment the camera turns. Baked
   into a mipmapped cubemap it is filtered by the hardware exactly like any
   other texture, and stars are splatted with a minimum sigma of ~0.6 texels so
   every star is band-limited before it is ever stored.

   Composition is back-to-front with real absorption — each gas layer both
   attenuates everything behind it (a per-channel extinction that reddens, as
   dust does) and adds its own emission. That is what separates a nebula with
   depth from coloured smoke on a black JPEG. */

/* ---------------------------------------------------------------------------
   Palettes. Two dominant hues plus one accent, never more. Mid-tones are
   desaturated in the shader; saturation is spent only on the hottest cores.
   Values are linear-light — the renderer tone-maps on output.
   --------------------------------------------------------------------------- */

const PALETTES = [
  {
    name: 'cindervault', // indigo + teal, rust accent
    deep: [0.052, 0.070, 0.150],
    mid: [0.070, 0.160, 0.168],
    hot: [0.62, 0.88, 0.98],
    accent: [0.44, 0.155, 0.070],
    accentHot: [1.00, 0.52, 0.22],
    band: [0.150, 0.168, 0.205],
    dustExt: [0.62, 0.85, 1.22],
    dustTint: [0.030, 0.052, 0.080],
    key: [0.80, 0.875, 1.00],
    fill: [0.10, 0.19, 0.26],
    warm: false,
  },
  {
    name: 'emberfall', // amber + violet, cyan accent
    deep: [0.082, 0.052, 0.128],
    mid: [0.185, 0.100, 0.042],
    hot: [1.00, 0.64, 0.26],
    accent: [0.30, 0.150, 0.44],
    accentHot: [0.74, 0.56, 1.00],
    band: [0.190, 0.172, 0.150],
    dustExt: [0.55, 0.80, 1.30],
    dustTint: [0.062, 0.036, 0.030],
    key: [1.00, 0.905, 0.760],
    fill: [0.24, 0.13, 0.20],
    warm: true,
  },
  {
    name: 'coldwater', // grey-green + steel cyan, pale gold accent
    deep: [0.050, 0.086, 0.082],
    mid: [0.056, 0.120, 0.162],
    hot: [0.56, 0.93, 0.99],
    accent: [0.40, 0.320, 0.145],
    accentHot: [1.00, 0.86, 0.52],
    band: [0.140, 0.160, 0.168],
    dustExt: [0.66, 0.86, 1.18],
    dustTint: [0.026, 0.046, 0.052],
    key: [0.855, 0.930, 1.00],
    fill: [0.09, 0.17, 0.20],
    warm: false,
  },
  {
    name: 'ironmoth', // steel blue + bruised magenta, ember accent
    deep: [0.046, 0.062, 0.104],
    mid: [0.126, 0.056, 0.092],
    hot: [0.86, 0.72, 0.98],
    accent: [0.50, 0.215, 0.078],
    accentHot: [1.00, 0.60, 0.28],
    band: [0.152, 0.150, 0.180],
    dustExt: [0.60, 0.84, 1.24],
    dustTint: [0.040, 0.036, 0.062],
    key: [0.920, 0.900, 0.985],
    fill: [0.14, 0.12, 0.22],
    warm: false,
  },
  {
    name: 'ochrewake', // ochre + deep teal, bone accent
    deep: [0.112, 0.082, 0.044],
    mid: [0.042, 0.100, 0.112],
    hot: [1.00, 0.79, 0.44],
    accent: [0.170, 0.400, 0.420],
    accentHot: [0.62, 0.95, 0.96],
    band: [0.196, 0.180, 0.150],
    dustExt: [0.58, 0.82, 1.26],
    dustTint: [0.058, 0.046, 0.028],
    key: [1.00, 0.945, 0.845],
    fill: [0.20, 0.17, 0.11],
    warm: true,
  },
  {
    name: 'nightbloom', // indigo + bruise purple, cold cyan accent
    deep: [0.042, 0.044, 0.098],
    mid: [0.100, 0.052, 0.122],
    hot: [0.72, 0.62, 1.00],
    accent: [0.120, 0.420, 0.440],
    accentHot: [0.52, 0.94, 0.96],
    band: [0.144, 0.146, 0.184],
    dustExt: [0.64, 0.82, 1.20],
    dustTint: [0.032, 0.030, 0.060],
    key: [0.880, 0.885, 1.00],
    fill: [0.12, 0.11, 0.24],
    warm: false,
  },
  {
    name: 'saltmarsh', // grey-green + rust, pale cyan accent
    deep: [0.058, 0.078, 0.064],
    mid: [0.150, 0.078, 0.046],
    hot: [1.00, 0.72, 0.40],
    accent: [0.150, 0.360, 0.400],
    accentHot: [0.58, 0.90, 0.98],
    band: [0.160, 0.166, 0.156],
    dustExt: [0.62, 0.84, 1.20],
    dustTint: [0.044, 0.042, 0.034],
    key: [0.960, 0.945, 0.900],
    fill: [0.15, 0.17, 0.15],
    warm: true,
  },
  {
    name: 'deepfathom', // near-monochrome slate blue, single ember accent
    deep: [0.038, 0.052, 0.086],
    mid: [0.052, 0.082, 0.130],
    hot: [0.66, 0.82, 1.00],
    accent: [0.46, 0.190, 0.086],
    accentHot: [1.00, 0.56, 0.26],
    band: [0.134, 0.146, 0.172],
    dustExt: [0.66, 0.88, 1.20],
    dustTint: [0.024, 0.036, 0.058],
    key: [0.845, 0.900, 1.00],
    fill: [0.10, 0.15, 0.24],
    warm: false,
  },
];

/* Envelope cutoff for the gas-layer early-out. Layers fade to exactly zero as
   they approach it, so the branch is a pure performance win and never visible. */
const ENV_CUTOFF = 0.0022;

/* Map HEIGHT in texels; width is twice this. Sized for angular resolution, not
   memory: stars are splatted at ~0.6 texels, so texel size sets how big a star
   can be on screen. 2048 high gives 360/4096 = 0.088 deg per texel, which is
   about two screen pixels at 1080p/48deg FOV — the same density the cubemap
   build had per face, and the point where stars read as points rather than
   blobs. Ultra deliberately matches high; going further costs a lot of VRAM
   (a 4096x2048 RGBA16F map with mips is already ~89 MB) and buys nothing. */
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

float fbm2n(vec3 p) {
  float f = 0.5 * gnoise(p);
  p = M3 * p * 2.03;
  f += 0.25 * gnoise(p);
  return f / 0.75;
}

float fbm3n(vec3 p) {
  float f = 0.5 * gnoise(p);
  p = M3 * p * 2.02;
  f += 0.25 * gnoise(p);
  p = M3 * p * 2.03;
  f += 0.125 * gnoise(p);
  return f / 0.875;
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

function buildLayerGlsl(L, index) {
  // A layer only exists inside its angular envelope; the branch buys back most
  // of the shading cost over the (deliberately large) empty half of the sky.
  return /* glsl */ `
  {
    const vec3 e0 = vec3(${f3(L.e0)});
    const vec3 e1 = vec3(${f3(L.e1)});
    const vec3 e2 = vec3(${f3(L.e2)});
    float ca = dot(d, e0);
    float tx = dot(d, e1) * ${num(1 / L.a)};
    float ty = dot(d, e2) * ${num(1 / L.b)};
    float env = exp(-(tx * tx + ty * ty)) * smoothstep(-0.10, 0.55, ca);
    /* The branch below is a performance early-out over the empty half of the
       sky, but it cannot be allowed to show. Raising dens to a contrast under
       one lifts small densities hard, so a plain cutoff leaves a visible
       clipped edge along the envelope. Fade the envelope to exactly zero as it
       approaches the threshold so the branch can never be seen. */
    env *= smoothstep(${num(ENV_CUTOFF)}, ${num(ENV_CUTOFF * 12)}, env);
    if (env > 0.0) {
      vec3 p = d * ${num(L.scale)} + vec3(${f3(L.off)});
      vec3 w = warp * ${num(L.warp)};
      float nn = fbm5n(p + w) * 0.5 + 0.5;
      float rg = ridge3(p * ${num(L.ridgeScale)} + w * 0.62);
      float m = mix(nn, rg, ${num(L.filament)});
      float dens = env * clarity * smoothstep(${num(L.thr)}, ${num(L.thr + L.soft)}, m);
      dens = pow(dens, ${num(L.contrast)}) * ${num(L.amount)};
      float heat = smoothstep(${num(L.hotThr)}, ${num(Math.min(0.995, L.hotThr + 0.30))}, m) * env;
      vec3 base = vec3(${f3(L.col)});
      vec3 emis = mix(desat(base, 0.55), base, smoothstep(0.015, 0.40, dens));
      emis = mix(emis, vec3(${f3(L.hotCol)}), heat * heat * ${num(L.hotAmt)});
      col *= exp(-vec3(${f3(L.ext)}) * dens);
      col += emis * dens;
      cover${index} = dens;
    }
  }`;
}

function buildSkyFragment(P) {
  const on = P.enable;
  const layers = on.nebula ? P.layers.map(buildLayerGlsl).join('\n') : '';
  const covers = P.layers.map((_, i) => `  float cover${i} = 0.0;`).join('\n');

  return /* glsl */ `
precision highp float;

varying vec2 vUv;

#define PI 3.141592653589793

uniform float uStarSigma;   // minimum star sigma, in texels
uniform float uStarGain;

${NOISE_GLSL}

const vec3 BAND_AXIS = vec3(${f3(P.bandAxis)});
const vec3 BAND_CORE = vec3(${f3(P.bandCore)});

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
        float mag = ${num(P.starMag)} * (0.03 + pow(g.x, ${num(P.starMagPow)}));
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
        float bm = ${num(P.brightMag)} * (0.35 + pow(g.x, 2.2) * 3.6);
        float core = exp(-r2 / (sig * sig * 1.45));
        float halo = 0.055 * exp(-sqrt(r2) / (sig * 8.0));
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
        float wsp = sig * 0.50;
        float lsp = sig * 7.0;
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

  /* Stars sit behind everything, so they pick up every layer's extinction. */
  vec3 col = ${on.stars ? '(starMain(d, sig) + starBright(d, sig)) * uStarGain' : 'vec3(0.0)'};

  /* Very large scale clarity mask: keeps well over a third of the sky honestly
     empty instead of veiling the whole shell in gas. */
  float clarity = mix(0.05, 1.0,
    smoothstep(-0.26, 0.30, fbm3n(d * ${num(P.clarityScale)} + vec3(${f3(P.clarityOff)}))));

  /* ---- galactic band: emission first, then its own dust lane in front ---- */
  if (${on.band ? 'true' : 'false'}) {
    float lat = dot(d, BAND_AXIS);
    float g = exp(-(lat * lat) * ${num(1 / (2 * P.bandW * P.bandW))});
    float along = fbm3n(d * ${num(P.bandScale)} + vec3(${f3(P.bandOff)})) * 0.5 + 0.5;
    float mott = ridge3(d * ${num(P.bandScale * 2.6)} + vec3(${f3(P.bandOff)}));
    g *= 0.34 + 0.66 * along;
    float bulge = exp(-(1.0 - dot(d, BAND_CORE)) * ${num(P.bulgeK)});
    vec3 bandCol = vec3(${f3(P.bandCol)});
    col += bandCol * (g * ${num(P.bandAmt)} + bulge * ${num(P.bulgeAmt)});
    col += desat(bandCol, 0.4) * g * mott * ${num(P.bandAmt * 0.55)};

    float lo = lat - ${num(P.laneOff)};
    float lane = exp(-(lo * lo) * ${num(1 / (2 * P.laneW * P.laneW))});
    float laneN = ridge3(d * ${num(P.laneScale)} + vec3(${f3(P.laneNoiseOff)}));
    float laneD = lane * smoothstep(0.42, 0.86, laneN) * ${num(P.laneAmt)};
    col *= exp(-vec3(${f3(P.dustExt)}) * laneD);
  }

  /* ---- gas layers, far to near ---- */
  vec3 warp = vec3(
    fbm3n(d * ${num(P.warpScale)} + vec3(11.31, 4.72, 27.10)),
    fbm3n(d * ${num(P.warpScale)} + vec3(47.71, 19.03, 3.55)),
    fbm3n(d * ${num(P.warpScale)} + vec3(83.11, 62.40, 91.72)));

${covers}
${layers}

  /* ---- foreground dust sheet: absorption only, plus a whisper of reflection */
  if (${on.nebula ? 'true' : 'false'}) {
    const vec3 f0 = vec3(${f3(P.dust.e0)});
    const vec3 f1 = vec3(${f3(P.dust.e1)});
    const vec3 f2 = vec3(${f3(P.dust.e2)});
    float ca = dot(d, f0);
    float tx = dot(d, f1) * ${num(1 / P.dust.a)};
    float ty = dot(d, f2) * ${num(1 / P.dust.b)};
    float env = exp(-(tx * tx + ty * ty)) * smoothstep(-0.20, 0.45, ca);
    env *= smoothstep(${num(ENV_CUTOFF)}, ${num(ENV_CUTOFF * 12)}, env);
    if (env > 0.0) {
      vec3 p = d * ${num(P.dust.scale)} + vec3(${f3(P.dust.off)});
      float nn = fbm5n(p + warp * 1.5) * 0.5 + 0.5;
      float rg = ridge3(p * 1.7 + warp * 0.8);
      float m = mix(nn, rg, 0.40);
      float dens = env * smoothstep(${num(P.dust.thr)}, ${num(P.dust.thr + 0.30)}, m) * ${num(P.dust.amount)};
      col *= exp(-vec3(${f3(P.dustExt)}) * dens);
      col += vec3(${f3(P.dustTint)}) * dens * 0.45;
    }
  }

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

function generateParams(rng) {
  const pal = PALETTES[rng.int(0, PALETTES.length - 1)];

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

  // Three gas layers: a broad deep bed, a mid body, and a filament structure.
  // Their centres are correlated so the nebula reads as one object with
  // internal structure rather than three unrelated smudges.
  const anchor = vecFrom(rng);
  const anchorFrame = frame(anchor);
  const jitter = (spread) =>
    anchor
      .clone()
      .addScaledVector(anchorFrame[1], rng.gaussian(0, spread))
      .addScaledVector(anchorFrame[2], rng.gaussian(0, spread))
      .normalize();

  const layerDefs = [
    {
      col: pal.deep,
      hotCol: pal.mid,
      ext: pal.dustExt.map((v) => v * rng.range(0.55, 0.85)),
      centre: jitter(0.30),
      a: rng.range(0.62, 0.95),
      b: rng.range(0.48, 0.80),
      scale: rng.range(1.5, 2.4),
      warp: rng.range(0.55, 0.95),
      ridgeScale: rng.range(1.5, 2.1),
      filament: rng.range(0.10, 0.24),
      thr: rng.range(0.36, 0.46),
      soft: rng.range(0.30, 0.44),
      contrast: rng.range(0.95, 1.30),
      amount: rng.range(1.5, 2.3),
      hotThr: rng.range(0.62, 0.72),
      hotAmt: rng.range(0.30, 0.50),
    },
    {
      col: pal.mid,
      hotCol: pal.hot,
      ext: pal.dustExt.map((v) => v * rng.range(0.9, 1.5)),
      centre: jitter(0.22),
      a: rng.range(0.34, 0.58),
      b: rng.range(0.26, 0.46),
      scale: rng.range(3.0, 4.6),
      warp: rng.range(0.42, 0.72),
      ridgeScale: rng.range(1.7, 2.4),
      filament: rng.range(0.30, 0.48),
      thr: rng.range(0.46, 0.55),
      soft: rng.range(0.20, 0.32),
      contrast: rng.range(1.05, 1.45),
      amount: rng.range(1.7, 2.6),
      hotThr: rng.range(0.60, 0.70),
      hotAmt: rng.range(0.55, 0.85),
    },
    {
      col: pal.accent,
      hotCol: pal.accentHot,
      ext: pal.dustExt.map((v) => v * rng.range(0.5, 0.9)),
      centre: jitter(0.34),
      a: rng.range(0.16, 0.32),
      b: rng.range(0.12, 0.26),
      scale: rng.range(5.5, 8.5),
      warp: rng.range(0.26, 0.50),
      ridgeScale: rng.range(2.0, 2.9),
      filament: rng.range(0.55, 0.78),
      thr: rng.range(0.50, 0.58),
      soft: rng.range(0.13, 0.22),
      contrast: rng.range(1.2, 1.7),
      amount: rng.range(1.3, 2.2),
      hotThr: rng.range(0.55, 0.65),
      hotAmt: rng.range(0.75, 1.05),
    },
  ];

  const layers = layerDefs.map((L) => {
    const [e0, e1, e2] = frame(L.centre);
    return {
      ...L,
      e0: [e0.x, e0.y, e0.z],
      e1: [e1.x, e1.y, e1.z],
      e2: [e2.x, e2.y, e2.z],
      off: [rng.range(-40, 40), rng.range(-40, 40), rng.range(-40, 40)],
    };
  });

  const dustCentre = jitter(0.55);
  const dustFrame = frame(dustCentre);

  const bandW = rng.range(0.075, 0.135);

  return {
    palette: pal,
    layers,
    bandAxis: [bandAxis.x, bandAxis.y, bandAxis.z],
    bandCore: [bandCore.x, bandCore.y, bandCore.z],
    bandW,
    bandScale: rng.range(2.2, 3.4),
    bandOff: [rng.range(-30, 30), rng.range(-30, 30), rng.range(-30, 30)],
    bandCol: pal.band,
    bandAmt: rng.range(0.16, 0.26),
    bulgeK: rng.range(9.0, 17.0),
    bulgeAmt: rng.range(0.22, 0.40),
    laneOff: rng.range(-0.045, 0.045),
    laneW: bandW * rng.range(0.34, 0.55),
    laneScale: rng.range(4.5, 7.0),
    laneNoiseOff: [rng.range(-30, 30), rng.range(-30, 30), rng.range(-30, 30)],
    laneAmt: rng.range(1.5, 2.6),

    warpScale: rng.range(1.1, 1.9),
    clarityScale: rng.range(0.75, 1.20),
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

    starCells: 55,
    starSalt: rng.range(1, 900),
    starDensity: rng.range(0.40, 0.58),
    starBandW: bandW * rng.range(2.2, 3.2),
    starMag: rng.range(0.34, 0.52),
    starMagPow: rng.range(4.6, 6.2),
    brightCells: 4,
    brightSalt: rng.range(1, 900),
    brightDensity: rng.range(0.17, 0.28),
    brightMag: rng.range(1.8, 3.0),
    spikeAmt: rng.range(0.055, 0.10),
    spikeThresh: rng.range(4.6, 6.2),

    voidCol: [
      pal.deep[0] * 0.030 + 0.0009,
      pal.deep[1] * 0.030 + 0.0011,
      pal.deep[2] * 0.030 + 0.0016,
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
  const tiles = Math.max(1, opts.tiles || (size >= 2048 ? 4 : size >= 1024 ? 2 : 1));

  const P = generateParams(r);
  P.enable = Object.assign({ nebula: true, stars: true, band: true }, opts.layers || {});

  /* Equirectangular, not a cubemap.

     WebGL 2 has no seamless cube filtering (that is a desktop-GL feature), so
     bilinear taps at a face border clamp within their own face and every one
     of the twelve cube edges shows as a visible step. Against a nebula this
     reads as hard straight lines cutting across the sky — measured here at
     3-5 luminance units on a sky whose range is only 1-25, i.e. glaring.
     A single lat/long map has no internal seams at all; the only join is the
     +/-180 wrap, which RepeatWrapping filters correctly. Pole stretching is
     the trade, and it is a good trade for a backdrop. */
  const W = size * 2;
  const H = size;

  const target = new THREE.WebGLRenderTarget(W, H, {
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
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  target.texture.mapping = THREE.EquirectangularReflectionMapping;
  target.texture.name = 'skybox:' + P.palette.name;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      // Roughly one texel of standard deviation: below ~0.5 the splat stops
      // being band-limited and the field starts to crawl when the camera turns.
      uStarSigma: { value: 0.62 },
      uStarGain: { value: 1.0 },
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

  renderer.setRenderTarget(target);

  if (tiles === 1) {
    renderer.setScissorTest(false);
    renderer.render(quadScene, quadCam);
  } else {
    // A 4096x2048 nebula is a couple of hundred million noise evaluations.
    // Split it so no single draw call can trip the display driver's watchdog.
    const stepX = Math.ceil(W / (tiles * 2));
    const stepY = Math.ceil(H / tiles);
    renderer.setScissorTest(true);
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles * 2; tx++) {
        renderer.setScissor(tx * stepX, ty * stepY, stepX, stepY);
        renderer.render(quadScene, quadCam);
      }
    }
    renderer.setScissorTest(false);
  }

  // Mip chain is what actually stops the star field aliasing under rotation.
  target.texture.generateMipmaps = true;
  target.texture.needsPMREMUpdate = true;
  const gl = renderer.getContext();
  const props = renderer.properties.get(target.texture);
  if (props && props.__webglTexture) {
    const state = renderer.state;
    state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  const probe = probeSky(renderer, target.texture);

  renderer.setScissorTest(prevScissorTest);
  renderer.setScissor(prevScissor.x, prevScissor.y, prevScissor.z, prevScissor.w);
  renderer.setRenderTarget(prevTarget);

  const pal = P.palette;
  const keyColour = new THREE.Color(pal.key[0], pal.key[1], pal.key[2]);

  // Fill is what the sky actually throws back at a hull: mostly the measured
  // average, nudged toward the palette's nominal fill so a very empty sky still
  // reads as "lit by this nebula" rather than by nothing at all.
  const fillColour = probe.mean.clone().lerp(new THREE.Color(pal.fill[0], pal.fill[1], pal.fill[2]), 0.45);
  normaliseChroma(fillColour);

  const nebulaColour = probe.weighted.clone();
  normaliseChroma(nebulaColour);

  const ambientColour = fillColour.clone().lerp(nebulaColour, 0.3);
  normaliseChroma(ambientColour);

  return {
    texture: target.texture,
    renderTarget: target,
    palette: {
      name: pal.name,
      warm: pal.warm,
      deep: new THREE.Color(...pal.deep),
      mid: new THREE.Color(...pal.mid),
      hot: new THREE.Color(...pal.hot),
      accent: new THREE.Color(...pal.accent),
      band: new THREE.Color(...pal.band),
    },
    keyColour,
    fillColour,
    ambientColour,
    nebulaColour,
    average: probe.mean.clone(),
    averageLuminance: probe.luminance,
    size,
    dispose() {
      target.dispose();
      quad.geometry.dispose();
      material.dispose();
    },
  };
}

/** Scale a colour so its brightest channel is 1 — a pure hue for lighting. */
function normaliseChroma(c) {
  const m = Math.max(c.r, c.g, c.b, 1e-5);
  c.multiplyScalar(1 / m);
  // Lighting colours that are too pure look like gels; pull a little to white.
  c.lerp(new THREE.Color(1, 1, 1), 0.18);
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
    vec3 cs = c;
    sum += c;
    float l = dot(cs, vec3(0.2126, 0.7152, 0.0722));
    float w = l * l;
    wsum += cs * w;
    wtot += w;
  }
  vec3 mean = sum * (1.0 / 160.0);
  vec3 wmean = wsum / max(wtot, 1.0e-6);
  vec3 outc = vXy.x < 0.0 ? mean * 8.0 : wmean / max(max(wmean.r, max(wmean.g, wmean.b)), 1.0e-5);
  gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
`;

function probeSky(renderer, cubeTexture) {
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
    uniforms: { uSky: { value: cubeTexture } },
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
