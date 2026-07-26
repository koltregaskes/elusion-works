/**
 * Ashfall — the post chain. This module IS the look.
 *
 * ARCHITECTURE.md §3.2. Every pass is a hand-written RawShaderMaterial (GLSL ES 3.00) drawn
 * over a single fullscreen *triangle*. A triangle rather than a quad because a quad's shared
 * diagonal makes the rasteriser run two triangles whose edge pixels are shaded twice and,
 * worse, breaks derivative continuity across the seam — dFdx/dFdy on the diagonal are wrong,
 * which shows up as a faint diagonal scar in any pass that uses derivatives (our SSAO
 * fallback normals do).
 *
 * Chain, in order, each stage skippable by quality:
 *
 *   HDR + depth (+ prepass normals) from engine.targets
 *     -> TAA          (Halton jitter, depth reprojection, Catmull-Rom history, YCoCg clip)
 *     -> SSAO         (hemisphere kernel over prepass normals, bilateral blur, indirect-only)
 *     -> Motion blur  (velocity reconstruction, 8 taps, shutter 0.5, depth-rejected)
 *     -> DOF          (ADS only, hexagonal bokeh, 3-direction 2-pass)
 *     -> Bloom        (13-tap Karis downsample x6, 3x3 tent upsample x5)
 *     -> Composite    (dirt, CA, exposure, AgX, grade, vignette, CAS, sRGB) -> LDR buffer
 *     -> FXAA 3.11    (spatial edge resolve, then grain + 8-bit dither)     -> screen
 *
 * The last stage is not skippable by quality. TAA is the temporal super-sampler and FXAA is
 * the spatial floor underneath it: TAA only antialiases what its jitter sequence happens to
 * walk across and its history survives, so on its own it leaves bare staircases wherever the
 * history is young or rejected, and it is off entirely at `low`. The two stack.
 *
 * Rules obeyed throughout:
 *   - Every intermediate target is HalfFloat / LinearSRGBColorSpace. The sRGB transfer is
 *     applied exactly once, in the very last fragment shader, writing to the default
 *     framebuffer. Nothing else encodes.
 *   - Zero allocation per frame. All scratch maths objects live at module scope; all uniform
 *     values are preallocated and mutated in place.
 *   - No float render targets? Degrade to RGBA8 and keep running.
 *   - No NaN may enter the chain: every HDR fetch goes through sanitise().
 *
 * Colour, intensity and grade values come from src/world/art.js. Nothing here hard-codes a
 * palette value; the only literals are shader maths constants, each commented.
 */

import * as THREE from '../../vendor/three.module.js';
import { GRADE, PALETTE, ATMOSPHERE } from '../world/art.js';

/* ========================================================================== */
/* Module-scope scratch — nothing below allocates during a frame.             */
/* ========================================================================== */

const _viewProj = new THREE.Matrix4();
const _invViewProj = new THREE.Matrix4();
const _prevViewProj = new THREE.Matrix4();
const _projNoJitter = new THREE.Matrix4();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _colour = new THREE.Color();
const _white = new THREE.Vector3(1, 1, 1);
/** Reused by currentSize(); returning a fresh array every frame would allocate in the loop. */
const _size = { x: 0, y: 0 };
const _drawSize = new THREE.Vector2();

/**
 * Halton(2,3), the standard TAA sequence: low-discrepancy, so 8 consecutive frames cover the
 * pixel footprint evenly instead of clumping the way white noise does. Centred on 0 and
 * scaled to +-0.5 of a pixel.
 */
function halton(index, base) {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

const JITTER_COUNT = 8;
const JITTER = new Float32Array(JITTER_COUNT * 2);
for (let i = 0; i < JITTER_COUNT; i++) {
  // Halton is 1-indexed; index 0 would give (0,0) which wastes a sample.
  JITTER[i * 2 + 0] = halton(i + 1, 2) - 0.5;
  JITTER[i * 2 + 1] = halton(i + 1, 3) - 0.5;
}

/**
 * The viewmodel is rasterised into the shared depth buffer with the *viewmodel* camera's
 * projection (near 0.008, far 12). Linearising those samples with the world camera's planes
 * therefore reports an apparent distance, not a real one. This computes where the far end of
 * the weapon lands in that apparent space, so DOF, motion blur and TAA can all leave the gun
 * alone without any of them hard-coding a magic metre value.
 *
 *   window depth of z under (n,f):  d = f (z - n) / (z (f - n))
 *   linear distance of d under (n,f): z = n f / (f - d (f - n))
 *
 * @param {number} extent  furthest viewmodel geometry from the eye, in metres
 */
function viewmodelApparentDepth(vmNear, vmFar, worldNear, worldFar, extent) {
  const z = Math.max(vmNear * 1.001, extent);
  const d = (vmFar * (z - vmNear)) / (z * (vmFar - vmNear));
  const denom = worldFar - d * (worldFar - worldNear);
  if (!(denom > 1e-6)) return worldFar;
  return (worldNear * worldFar) / denom;
}

/** Deterministic RNG so the AO kernel and the lens dirt are identical every run. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** sRGB hex from art.js -> linear THREE.Vector3, optionally normalised to unit luminance. */
function paletteVec(hex, target, unitLuminance = false) {
  _colour.setStyle(hex, THREE.SRGBColorSpace);
  target.set(_colour.r, _colour.g, _colour.b);
  if (unitLuminance) {
    const l = target.x * 0.2126 + target.y * 0.7152 + target.z * 0.0722;
    if (l > 1e-4) target.multiplyScalar(1 / l);
  }
  return target;
}

/* ========================================================================== */
/* Shared GLSL                                                                */
/* ========================================================================== */

/**
 * Fullscreen triangle. Clip-space positions are supplied directly — no camera matrices are
 * consulted, so the pass is immune to whatever the engine left in the camera.
 */
const VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  // The triangle spans (-1,-1) (3,-1) (-1,3); the visible third maps exactly to 0..1 UV.
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMMON = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;

const float EPS = 1e-5;

/** Rec.709 luminance — the working primaries of the whole chain. */
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

/**
 * NaN/Inf scrub. Argument order is deliberate: GLSL defines max(x,y) as "y < x ? x : y", and
 * every comparison against NaN is false, so max(0.0, NaN) evaluates to 0.0 whereas
 * max(NaN, 0.0) would propagate the NaN. One bad texel otherwise poisons the TAA history for
 * the rest of the session.
 */
vec3 sanitise(vec3 c) { return min(max(vec3(0.0), c), vec3(64000.0)); }

/** Window-space depth (0..1) -> view Z (negative, metres). Exact for a perspective frustum. */
float viewZFromDepth(float d, float n, float f) { return (n * f) / ((f - n) * d - f); }
/** Positive distance along the view axis, in metres. */
float linearDepth(float d, float n, float f) { return -viewZFromDepth(d, n, f); }

/**
 * YCoCg. TAA neighbourhood clipping is done in this space because chroma and luma decorrelate
 * cleanly here, so the clip box hugs the real distribution instead of a fat RGB cube — that is
 * the difference between "no ghosting" and "no ghosting but the edges wobble".
 */
vec3 rgb2ycocg(vec3 c) {
  return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
              0.5 * c.r - 0.5 * c.b,
             -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
vec3 ycocg2rgb(vec3 c) {
  float t = c.x - c.z;
  return vec3(t + c.y, c.x + c.z, t - c.y);
}

/** Karis' tonemap-for-averaging. Weighting by 1/(1+luma) makes a mean firefly-resistant. */
vec3 tonemapWeight(vec3 c) { return c / (1.0 + luma(c)); }
vec3 tonemapUnweight(vec3 c) { return c / max(1e-4, 1.0 - luma(c)); }

/** Dave Hoskins' hash. Cheap, no visible structure, and stable across drivers. */
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

/* -------------------------------------------------------------------------- */
/* 1. TAA                                                                      */
/* -------------------------------------------------------------------------- */

const FRAG_TAA = /* glsl */ `
${COMMON}

uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform mat4 uInvViewProj;   // current frame, JITTER REMOVED
uniform mat4 uPrevViewProj;  // previous frame, JITTER REMOVED
uniform vec2 uTexel;
uniform vec2 uResolution;
uniform vec2 uNearFar;
uniform float uFeedback;
uniform float uHistoryValid;
uniform float uClipGamma;
uniform float uNearCut;

/**
 * 5-tap optimised Catmull-Rom. A plain bilinear history fetch is a box filter applied every
 * frame; over a 0.9-feedback history that compounds into permanent softness. Catmull-Rom's
 * negative lobes put the high frequencies back. The 9-tap separable version is exact; the
 * 5-tap subset drops the corners (they carry ~1% of the weight) and renormalises.
 */
vec3 sampleHistoryCatmullRom(sampler2D tex, vec2 uv, vec2 texSize) {
  vec2 samplePos = uv * texSize;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;

  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);

  // Fold w1 and w2 into one bilinear tap positioned between the two texels.
  vec2 w12 = w1 + w2;
  vec2 offset12 = w2 / max(w12, vec2(EPS));

  vec2 invSize = 1.0 / texSize;
  vec2 texPos0 = (texPos1 - 1.0) * invSize;
  vec2 texPos3 = (texPos1 + 2.0) * invSize;
  vec2 texPos12 = (texPos1 + offset12) * invSize;

  vec3 result = vec3(0.0);
  float wSum = 0.0;
  float w;

  w = w12.x * w0.y;  result += texture(tex, vec2(texPos12.x, texPos0.y)).rgb * w;  wSum += w;
  w = w0.x * w12.y;  result += texture(tex, vec2(texPos0.x, texPos12.y)).rgb * w;  wSum += w;
  w = w12.x * w12.y; result += texture(tex, vec2(texPos12.x, texPos12.y)).rgb * w; wSum += w;
  w = w3.x * w12.y;  result += texture(tex, vec2(texPos3.x, texPos12.y)).rgb * w;  wSum += w;
  w = w12.x * w3.y;  result += texture(tex, vec2(texPos12.x, texPos3.y)).rgb * w;  wSum += w;

  // The dropped corners mean the weights no longer sum to 1; renormalising avoids a subtle
  // darkening ring that would otherwise pulse with sub-pixel motion.
  return sanitise(result / max(wSum, EPS));
}

/** Proper AABB *clipping* (move along the ray to the box) rather than clamping (per-channel
 *  snap). Clamping shifts hue on rejected history; clipping preserves it. */
vec3 clipToAABB(vec3 c, vec3 mn, vec3 mx) {
  vec3 centre = 0.5 * (mx + mn);
  vec3 extent = 0.5 * (mx - mn) + EPS;
  vec3 v = c - centre;
  vec3 unit = v / extent;
  vec3 a = abs(unit);
  float maxUnit = max(a.x, max(a.y, a.z));
  return maxUnit > 1.0 ? centre + v / maxUnit : c;
}

void main() {
  vec2 uv = vUv;
  vec3 cur = sanitise(texture(tCurrent, uv).rgb);

  if (uHistoryValid < 0.5) {
    // First frame after a resize or a quality change: seed the history from the current
    // frame. Blending against an uninitialised (black, or worse, garbage) target is the
    // classic "TAA flashes white/black on frame one" bug.
    fragColor = vec4(cur, 1.0);
    return;
  }

  float depth = texture(tDepth, uv).x;

  /* --- Reprojection ------------------------------------------------------
   * The world position is reconstructed with the JITTER-FREE inverse view-projection. Using
   * the jittered one is common but means a perfectly static camera still produces a sub-pixel
   * history offset every frame, which reads as a permanent shimmer. With both ends unjittered
   * a static camera reprojects exactly onto itself and the image converges rock solid. */
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 world = uInvViewProj * ndc;
  world /= world.w;
  vec4 prevClip = uPrevViewProj * vec4(world.xyz, 1.0);
  vec2 prevUV = prevClip.xy / max(prevClip.w, EPS) * 0.5 + 0.5;
  vec2 velocity = uv - prevUV;

  /* --- Current neighbourhood, in tonemapped YCoCg ------------------------
   * 3x3 plus the four 2-ring diagonals, 13 taps. A bare 3x3 around sub-pixel-thin geometry —
   * a mast, a fence post, a catenary wire — is almost entirely background, so the raw min/max
   * box never contains anything as dark as the feature itself and the feature's own history is
   * accepted forever. That is the classic TAA needle: a hard line dragged across the sky that
   * ends in mid-air. The extra ring costs four taps and is what bounds the drag. */
  vec3 curT = rgb2ycocg(tonemapWeight(cur));
  vec3 m1 = curT;
  vec3 m2 = curT * curT;

  // Unrolled rather than a loop over a const offset array: dynamic indexing of a local array is
  // legal ESSL 3.00 but lands in scratch memory on more than one driver, and this is a 13-tap
  // gather in the most bandwidth-sensitive pass of the chain.
  // (single physical line: a backslash continuation inside a JS template literal is eaten by JS
  // before the GLSL preprocessor ever sees it)
  #define NBH(ox, oy) { vec3 s = rgb2ycocg(tonemapWeight(sanitise(texture(tCurrent, uv + vec2(ox, oy) * uTexel).rgb))); m1 += s; m2 += s * s; }
  NBH(-1.0,  0.0) NBH( 1.0,  0.0) NBH( 0.0, -1.0) NBH( 0.0,  1.0)
  NBH(-1.0, -1.0) NBH( 1.0, -1.0) NBH(-1.0,  1.0) NBH( 1.0,  1.0)
  NBH(-2.0, -2.0) NBH( 2.0, -2.0) NBH(-2.0,  2.0) NBH( 2.0,  2.0)
  #undef NBH

  // Variance clipping (Salvi), *without* the old intersection against the raw neighbourhood
  // min/max. Intersecting with min/max can only ever widen the accepted set relative to the
  // statistics, and a single dark thin-geometry texel in the 3x3 was enough to open the box
  // wide enough to keep a ghost. mean +- gamma*sigma alone collapses correctly on low-contrast
  // content (the haze band), which is exactly where the comet trails were living.
  const float invN = 1.0 / 13.0;
  vec3 mu = m1 * invN;
  vec3 sigma = sqrt(max(vec3(0.0), m2 * invN - mu * mu));

  // Floor on the box half-extent. A perfectly flat neighbourhood gives sigma == 0, which makes
  // clipToAABB snap the history exactly onto the mean every frame; that is a hard reset of the
  // temporal accumulation and reads as a fizzing shimmer over smooth fog. A fraction of a code
  // value of slack keeps convergence without letting a real ghost through.
  vec3 boxHalf = max(uClipGamma * sigma, vec3(0.010, 0.006, 0.006));

  // The box must always contain the current sample, otherwise a legitimately new pixel can be
  // dragged toward stale history.
  vec3 boxMin = min(mu - boxHalf, curT);
  vec3 boxMax = max(mu + boxHalf, curT);

  /* --- History ----------------------------------------------------------- */
  vec3 hist = sampleHistoryCatmullRom(tHistory, prevUV, uResolution);
  vec3 histT = rgb2ycocg(tonemapWeight(hist));
  vec3 clipped = clipToAABB(histT, boxMin, boxMax);

  /* --- Blend weight ------------------------------------------------------ */
  float feedback = uFeedback;

  // Velocity in pixels. Fast movement means the history is a poor predictor (disocclusion,
  // shading changes, reprojection error all grow with speed), so lean on the current frame.
  // The ramp is deliberately steep: at 0.91 static feedback the history half-life is ~7 frames,
  // and anything moving even a couple of pixels per frame has therefore been smeared over a
  // dozen pixels by the time it decays. 0.60 by 4 px, 0.35 by 10 px — past that the current
  // frame owns the pixel and the only softening left is the motion blur's, which is intended.
  float velPixels = length(velocity * uResolution);
  feedback = mix(feedback, 0.60, clamp(velPixels * 0.25, 0.0, 1.0));
  feedback = mix(feedback, 0.35, clamp((velPixels - 4.0) / 6.0, 0.0, 1.0));

  // Near-field guard. The viewmodel is drawn with a *different* projection into the shared
  // depth buffer, so linearising its depth with the world camera's planes gives an apparent
  // distance rather than a real one, and its reprojected velocity is only approximate.
  // uNearCut is the apparent depth the weapon can reach (derived from engine.viewDepthParams);
  // inside it, shorten the history so the gun stays crisp instead of trailing.
  float viewDist = linearDepth(depth, uNearFar.x, uNearFar.y);
  float nearFade = smoothstep(uNearCut * 0.3, uNearCut, viewDist);
  feedback = mix(0.80, feedback, nearFade);

  // Reject anything that reprojects off-screen or behind the previous camera. There is no
  // history for it; using the edge-clamped texel is what smears a bright streak inwards
  // whenever the player turns.
  float onScreen = step(0.0, prevUV.x) * step(prevUV.x, 1.0) *
                   step(0.0, prevUV.y) * step(prevUV.y, 1.0) * step(EPS, prevClip.w);
  feedback *= onScreen;

  /* --- Disocclusion rejection by reprojected depth ------------------------
   * There is no history *depth* buffer in this chain, so compare this pixel's distance against
   * the current-frame distance at the place the history is being fetched from. If the geometry
   * that now sits at prevUV is at a markedly different range, whatever colour is stored there
   * belongs to something else and reusing it is precisely how a thin mast drags a needle
   * straight through the horizon line, and how sky leaks over the skyline as the camera turns.
   * 2%..8% relative, so ordinary slope and grazing-angle ground never trips it. Faded out by
   * nearFade over the viewmodel band: the weapon's depth was written with the *viewmodel*
   * projection, so its reprojected UV is approximate by construction and this test would fire
   * on it constantly, stripping the gun of its antialiasing for no gain. */
  vec2 prevUVc = clamp(prevUV, vec2(0.0), vec2(1.0));
  float prevDist = linearDepth(texture(tDepth, prevUVc).x, uNearFar.x, uNearFar.y);
  float depthRel = abs(prevDist - viewDist) / max(viewDist, 0.05);
  feedback *= 1.0 - nearFade * smoothstep(0.02, 0.08, depthRel);

  // How far the history had to be dragged to fit the box. Heavy clipping means the pixel is
  // genuinely new content, so trust it less. The old 1.6/0.55 pair still left a heavily-clipped
  // pixel on 45% of its stale history, which over a long feedback tail is a visible ghost;
  // 3.0/0.85 takes it down to 15% and the trail dies within a couple of frames.
  float clipDist = length(clipped - histT);
  feedback *= 1.0 - clamp(clipDist * 3.0, 0.0, 0.85);

  vec3 resolved = mix(curT, clipped, feedback);
  fragColor = vec4(sanitise(tonemapUnweight(ycocg2rgb(resolved))), 1.0);
}
`;

/* -------------------------------------------------------------------------- */
/* 2. SSAO                                                                     */
/* -------------------------------------------------------------------------- */

const FRAG_SSAO = /* glsl */ `
${COMMON}

uniform sampler2D tDepth;     // world-only depth (engine.targets.normal.depthTexture)
uniform sampler2D tDepthAll;  // world + viewmodel; identical to tDepth if unavailable
uniform sampler2D tNormal;
uniform sampler2D tNoise;
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform vec2 uNoiseScale;
uniform vec2 uNearFar;
uniform vec3 uKernel[KERNEL_SIZE];
uniform float uRadius;
uniform float uBias;
uniform float uMaxDistance;
uniform float uHasNormal;

vec3 viewPosFromDepth(vec2 uv, float d) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 v = uInvProj * ndc;
  return v.xyz / v.w;
}

void main() {
  float d = texture(tDepth, vUv).x;
  vec3 P = viewPosFromDepth(vUv, d);
  float dist = -P.z;

  // Sky (and anything past the AO range) is unoccluded. .g carries linear depth for the
  // bilateral blur that follows, so it does not have to re-fetch and re-linearise.
  if (d >= 0.999999 || dist > uMaxDistance) {
    fragColor = vec4(1.0, dist, 0.0, 1.0);
    return;
  }

  // The occlusion field is built from the world-only depth so the weapon cannot cast AO onto
  // the level behind it. The flip side is that the world's AO would otherwise show *through*
  // the weapon, so mask it out wherever the composited depth is markedly nearer — that is
  // exactly where the viewmodel covers the pixel.
  float distAll = linearDepth(texture(tDepthAll, vUv).x, uNearFar.x, uNearFar.y);
  if (distAll < dist * 0.85) {
    fragColor = vec4(1.0, dist, 0.0, 1.0);
    return;
  }

  vec3 N;
  vec4 nSample = texture(tNormal, vUv);
  vec3 nDecoded = nSample.xyz * 2.0 - 1.0;
  if (uHasNormal > 0.5 && dot(nDecoded, nDecoded) > 0.1) {
    N = normalize(nDecoded);
  } else {
    // Fallback for a machine/engine without the prepass: derivatives of the reconstructed
    // view position. Faceted at depth discontinuities but always better than no AO.
    N = normalize(cross(dFdx(P), dFdy(P)));
  }

  // 4x4 interleaved rotation. Nearest + Repeat, so each 4x4 screen block uses a different
  // kernel orientation; the bilateral blur below then averages the 16 orientations back into
  // a smooth field. Random per-pixel noise would need a much wider blur to converge.
  vec2 rnd = texture(tNoise, vUv * uNoiseScale).xy * 2.0 - 1.0;
  vec3 rvec = normalize(vec3(rnd, 0.0));
  vec3 T = normalize(rvec - N * dot(rvec, N));
  vec3 B = cross(N, T);
  mat3 TBN = mat3(T, B, N);

  // Shrink the world radius slightly with distance. A fixed world radius costs a full kernel
  // of cache misses on near geometry and vanishes below a texel at range.
  float radius = uRadius * clamp(4.0 / max(dist, 1.0), 0.55, 1.6);

  float occlusion = 0.0;
  for (int i = 0; i < KERNEL_SIZE; i++) {
    vec3 samplePos = P + TBN * uKernel[i] * radius;

    vec4 clip = uProj * vec4(samplePos, 1.0);
    if (clip.w <= EPS) continue;
    vec2 sUv = clip.xy / clip.w * 0.5 + 0.5;
    if (sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0) continue;

    // Only .z is needed, and jitter never touches the projection's z row, so the closed-form
    // linearisation is exact and cheaper than a full inverse-projection reconstruct.
    float sampleZ = viewZFromDepth(texture(tDepth, sUv).x, uNearFar.x, uNearFar.y);

    // View Z is negative going away from the camera: a *larger* value is nearer, so the
    // depth-buffer surface occludes our kernel point when sampleZ - samplePos.z > bias.
    float dz = sampleZ - samplePos.z;

    // Range check. Without it, a wall 40 m behind a railing occludes the railing and the
    // whole background picks up a dark halo. The smoothstep keeps the transition from
    // showing up as a hard ring.
    float rangeCheck = smoothstep(0.0, 1.0, radius / max(EPS, abs(P.z - sampleZ)));
    occlusion += step(uBias, dz) * rangeCheck;
  }

  float ao = 1.0 - occlusion / float(KERNEL_SIZE);

  // Fade the last 40% of the range so distant geometry never darkens; fog owns that depth.
  ao = mix(ao, 1.0, smoothstep(uMaxDistance * 0.6, uMaxDistance, dist));

  fragColor = vec4(clamp(ao, 0.0, 1.0), dist, 0.0, 1.0);
}
`;

const FRAG_AO_BLUR = /* glsl */ `
${COMMON}

uniform sampler2D tAO;
uniform vec2 uDirection;   // one texel along X or Y
uniform float uDepthSigma;

void main() {
  vec2 c = texture(tAO, vUv).rg;

  // 5-tap gaussian evaluated at linearly-filtered midpoints (Rastergrid weights), so 5 taps
  // give the quality of 9. Each tap is gated on depth similarity: a plain blur bleeds the
  // dark contact line off the object and onto whatever is behind it.
  const float offs[2] = float[2](1.3846153846, 3.2307692308);
  const float wts[2] = float[2](0.3162162162, 0.0702702703);

  float sum = c.r * 0.2270270270;
  float wsum = 0.2270270270;

  for (int i = 0; i < 2; i++) {
    for (int s = -1; s <= 1; s += 2) {
      vec2 uv = vUv + uDirection * offs[i] * float(s);
      vec2 t = texture(tAO, uv).rg;
      // Depth weight is relative, so the tolerance scales with distance instead of falling
      // apart at range.
      float dw = exp(-abs(t.g - c.g) / max(0.05, c.g * uDepthSigma));
      float w = wts[i] * dw;
      sum += t.r * w;
      wsum += w;
    }
  }

  fragColor = vec4(sum / max(wsum, EPS), c.g, 0.0, 1.0);
}
`;

const FRAG_AO_APPLY = /* glsl */ `
${COMMON}

uniform sampler2D tColour;
uniform sampler2D tAO;
uniform vec3 uAoTint;
uniform float uIntensity;

void main() {
  vec3 c = sanitise(texture(tColour, vUv).rgb);
  float ao = clamp(texture(tAO, vUv).r, 0.0, 1.0);

  // Power curve from GRADE.ssaoIntensity: shaping the response rather than lerping keeps the
  // deep creases dark while barely touching the broad, weakly-occluded areas.
  ao = pow(ao, uIntensity);

  /* AO occludes *indirect* light only. This is a post pass, so we have no split — approximate
   * it with a soft luminance mask: a pixel already blasted by the low sun is direct-lit and
   * must not be dimmed (that is what turns AAA AO into hobby AO — muddy, dirty-looking
   * sunlight), whereas a dim pixel is mostly sky/bounce fill and takes the AO in full. */
  float lum = luma(c);
  float indirect = 1.0 - smoothstep(0.12, 1.1, lum);
  float k = mix(0.22, 1.0, indirect);

  float shade = mix(1.0, ao, k);

  // Occluded pockets lose the warm key first and are left with sky fill, so they cool as they
  // darken. uAoTint is the art-directed shadow hue at unit luminance, so this shifts hue
  // without changing the amount of light removed.
  vec3 tint = mix(uAoTint, vec3(1.0), shade);

  fragColor = vec4(sanitise(c * shade * tint), 1.0);
}
`;

/* -------------------------------------------------------------------------- */
/* 3. Motion blur                                                              */
/* -------------------------------------------------------------------------- */

const FRAG_MOTION = /* glsl */ `
${COMMON}

uniform sampler2D tColour;
uniform sampler2D tDepth;
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform vec2 uResolution;
uniform vec2 uTexel;
uniform vec2 uNearFar;
uniform float uAmount;     // params.motionBlurAmount
uniform float uShutter;    // 0.5 — 180 degree shutter, the cinema default
uniform float uMaxPixels;  // ~10 px at 1600x900, scaled with resolution
uniform float uNearCut;    // apparent depth the viewmodel reaches, in metres

#define MB_TAPS 8

void main() {
  float depth = texture(tDepth, vUv).x;
  vec3 centre = sanitise(texture(tColour, vUv).rgb);

  /* Sky rejection. Depth-buffer velocity reconstruction is numerically worthless at the far
   * plane: the unprojected ray is enormously long, so a fraction of a degree of camera rotation
   * reconstructs as tens of pixels of "velocity", and the 8-tap gather turns the whole horizon
   * band and the cloud layer into flat ribbons. The sky has no parallax worth blurring anyway —
   * its apparent motion is pure rotation, which a real shutter smears far less than this. */
  if (depth >= 0.9999) { fragColor = vec4(centre, 1.0); return; }

  float centreDist = linearDepth(depth, uNearFar.x, uNearFar.y);

  vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 world = uInvViewProj * ndc;
  world /= world.w;
  vec4 prevClip = uPrevViewProj * vec4(world.xyz, 1.0);

  if (prevClip.w <= EPS) { fragColor = vec4(centre, 1.0); return; }

  vec2 prevUV = prevClip.xy / prevClip.w * 0.5 + 0.5;
  vec2 velocity = (vUv - prevUV) * uAmount * uShutter;

  // The viewmodel shares this depth buffer but not this projection, so its reconstructed
  // velocity is fiction. Fade the effect out in the near field: the weapon must stay sharp.
  // The cut is deliberately lower than the TAA one — smearing is far more visible than a
  // shortened history, but so is losing motion blur on nearby cover.
  velocity *= smoothstep(uNearCut * 0.35, uNearCut, centreDist);

  vec2 velPixels = velocity * uResolution;
  float len = length(velPixels);
  if (len < 0.6) { fragColor = vec4(centre, 1.0); return; }

  // Roughly a 10 px cap at 1600x900, scaled with the render height by the JS side. Beyond that
  // the gather stops reading as a shutter and starts reading as a bug: 8 taps spread over 40 px
  // are 5 px apart, so the "blur" is eight discrete ghosts, and any reconstruction error in the
  // velocity is multiplied by the same 40 px. This is the single most damaging clamp in the
  // chain — it is what was letting far geometry drag comet tails the width of the frame.
  if (len > uMaxPixels) velocity *= uMaxPixels / len;

  // Dither the tap positions per pixel, otherwise 8 taps show as 8 discrete ghosts.
  float jitter = hash12(gl_FragCoord.xy) - 0.5;

  vec3 sum = centre;
  float wsum = 1.0;

  for (int i = 1; i <= MB_TAPS; i++) {
    // Symmetric gather about the pixel: the blur straddles the shutter interval rather than
    // trailing behind it, which is what a real shutter does.
    float t = (float(i) + jitter) / float(MB_TAPS) - 0.5;
    vec2 uv = vUv + velocity * t;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;

    vec3 s = sanitise(texture(tColour, uv).rgb);
    float sDist = linearDepth(texture(tDepth, uv).x, uNearFar.x, uNearFar.y);

    // Depth-weighted rejection. A tap far *behind* the centre pixel belongs to the background
    // and must not be dragged into a moving foreground object — that is the halo artefact
    // that gives cheap motion blur away. Taps in front are legitimate: foreground genuinely
    // smears over what is behind it.
    float behind = max(0.0, sDist - centreDist) / max(centreDist, 1.0);
    float w = 1.0 - smoothstep(0.06, 0.35, behind);

    // Taper the weight along the vector so the smear fades rather than ending in a hard edge.
    w *= 1.0 - abs(t) * 0.6;

    sum += s * w;
    wsum += w;
  }

  fragColor = vec4(sanitise(sum / max(wsum, EPS)), 1.0);
}
`;

/* -------------------------------------------------------------------------- */
/* 4. DOF — ADS only, hexagonal bokeh                                          */
/* -------------------------------------------------------------------------- */

/** Half-res prefilter: colour down, signed circle of confusion into alpha. */
const FRAG_DOF_PREFILTER = /* glsl */ `
${COMMON}

uniform sampler2D tColour;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uNearFar;
uniform float uFocus;
uniform float uCoCScale;
uniform float uNearKeep;

float cocAt(vec2 uv) {
  float dist = linearDepth(texture(tDepth, uv).x, uNearFar.x, uNearFar.y);
  // Thin-lens: CoC is proportional to (1 - focus/z). Negative in front of the focal plane,
  // positive behind it, and it saturates for distant objects exactly as a real lens does.
  float coc = (1.0 - uFocus / max(dist, EPS)) * uCoCScale;
  // Keep the near field sharp. The viewmodel is rasterised with the viewmodel projection into
  // the shared depth buffer, so it lands in a ~0.3-3 m band when linearised with the world
  // camera's near/far. Anything nearer than uNearKeep is treated as "held by the player" and
  // gets zero CoC — the gun must never go soft while you are looking down the sight.
  coc *= smoothstep(uNearKeep * 0.45, uNearKeep, dist);
  return clamp(coc, -1.0, 1.0);
}

void main() {
  // 4-tap box downsample; the source is full res so this is a clean 2x2 average.
  vec2 o = uTexel * 0.5;
  vec3 c = sanitise(texture(tColour, vUv + vec2(-o.x, -o.y)).rgb)
         + sanitise(texture(tColour, vUv + vec2( o.x, -o.y)).rgb)
         + sanitise(texture(tColour, vUv + vec2(-o.x,  o.y)).rgb)
         + sanitise(texture(tColour, vUv + vec2( o.x,  o.y)).rgb);
  c *= 0.25;

  // Take the CoC with the largest magnitude of the four so thin silhouettes do not lose their
  // blur to a sharp neighbour.
  float c0 = cocAt(vUv + vec2(-o.x, -o.y));
  float c1 = cocAt(vUv + vec2( o.x, -o.y));
  float c2 = cocAt(vUv + vec2(-o.x,  o.y));
  float c3 = cocAt(vUv + vec2( o.x,  o.y));
  float coc = c0;
  if (abs(c1) > abs(coc)) coc = c1;
  if (abs(c2) > abs(coc)) coc = c2;
  if (abs(c3) > abs(coc)) coc = c3;

  fragColor = vec4(c, coc);
}
`;

/**
 * Directional bokeh blur. Mode 0 runs one direction from tSrc0; mode 1 runs the second pass of
 * McIntosh's hexagonal decomposition: two rhombi are formed by blurring the already-blurred
 * buffers along the remaining two axes, and their sum is the hexagon.
 */
const FRAG_DOF_BLUR = /* glsl */ `
${COMMON}

uniform sampler2D tSrc0;
uniform sampler2D tSrc1;
uniform vec2 uTexel;
uniform vec2 uDir0;
uniform vec2 uDir1;
uniform float uMaxRadius;
uniform int uMode;

#define DOF_TAPS 6

vec3 blurDir(sampler2D tex, vec2 dir, float coc) {
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i <= DOF_TAPS; i++) {
    float t = float(i) / float(DOF_TAPS);
    vec2 uv = vUv + dir * uTexel * t * coc * uMaxRadius;
    vec4 s = texture(tex, uv);
    // Scatter-as-gather: a tap only reaches us if its own CoC is at least as large as the
    // distance we travelled. Without this, sharp foreground bleeds outward onto blurred
    // background and the silhouette of the sight post grows a halo.
    float sw = clamp((abs(s.a) - t * coc) * 6.0 + 1.0, 0.0, 1.0);
    sum += s.rgb * sw;
    wsum += sw;
  }
  return sum / max(wsum, EPS);
}

vec3 blurDirSum(sampler2D a, sampler2D b, vec2 dir, float coc) {
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i <= DOF_TAPS; i++) {
    float t = float(i) / float(DOF_TAPS);
    vec2 uv = vUv + dir * uTexel * t * coc * uMaxRadius;
    vec4 sa = texture(a, uv);
    vec4 sb = texture(b, uv);
    float sw = clamp((abs(sa.a) - t * coc) * 6.0 + 1.0, 0.0, 1.0);
    sum += (sa.rgb + sb.rgb) * sw;
    wsum += sw;
  }
  return sum / max(wsum, EPS);
}

void main() {
  float coc = abs(texture(tSrc0, vUv).a);

  if (coc < 0.004) {
    // Nothing to do; pass the source through so the composite lerp stays exact.
    fragColor = texture(tSrc0, vUv);
    return;
  }

  if (uMode == 0) {
    fragColor = vec4(blurDir(tSrc0, uDir0, coc), texture(tSrc0, vUv).a);
  } else {
    // rhombus1 = A blurred along dir0; rhombus2 = (A+B) blurred along dir1. Their union is a
    // hexagon; the /3 accounts for rhombus2 carrying two rhombi worth of energy.
    vec3 r1 = blurDir(tSrc0, uDir0, coc);
    vec3 r2 = blurDirSum(tSrc0, tSrc1, uDir1, coc);
    fragColor = vec4((r1 + r2) / 3.0, texture(tSrc0, vUv).a);
  }
}
`;

const FRAG_DOF_COMPOSITE = /* glsl */ `
${COMMON}

uniform sampler2D tColour;
uniform sampler2D tBokeh;
uniform sampler2D tDepth;
uniform vec2 uNearFar;
uniform float uFocus;
uniform float uCoCScale;
uniform float uNearKeep;
uniform float uBlend;

void main() {
  vec3 sharp = sanitise(texture(tColour, vUv).rgb);
  vec3 blur = sanitise(texture(tBokeh, vUv).rgb);

  // CoC is recomputed at full resolution: reusing the half-res value leaks blur across
  // silhouettes by a full source texel, which is visible on the sight ring.
  float dist = linearDepth(texture(tDepth, vUv).x, uNearFar.x, uNearFar.y);
  float coc = (1.0 - uFocus / max(dist, EPS)) * uCoCScale;
  coc *= smoothstep(uNearKeep * 0.45, uNearKeep, dist);
  float k = clamp(abs(coc) * 1.6, 0.0, 1.0) * uBlend;

  fragColor = vec4(sanitise(mix(sharp, blur, k)), 1.0);
}
`;

/* -------------------------------------------------------------------------- */
/* 5. Bloom                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 13-tap partial Karis-average downsample (Jimenez, "Next Generation Post Processing in Call
 * of Duty: Advanced Warfare"). The five 2x2 groups are averaged with a 1/(1+luma) weight so a
 * single blown-out texel cannot dominate its group. This is the pass that kills fireflies;
 * without it, every specular glint on the rails strobes as a fat blob.
 * uKaris switches the weighting off for mips 2..N (only the first downsample needs it) and
 * uThreshold/uKnee apply the soft-knee prefilter on the first level.
 */
const FRAG_BLOOM_DOWN = /* glsl */ `
${COMMON}

uniform sampler2D tSrc;
uniform vec2 uTexel;       // texel size of the SOURCE
uniform float uKaris;
uniform float uPrefilter;
uniform float uThreshold;
uniform float uKnee;

vec3 prefilter(vec3 c) {
  if (uPrefilter < 0.5) return c;
  // Soft-knee threshold in HDR (Unity/Karis). A hard threshold makes bloom pop on and off as
  // a highlight crosses it; the quadratic knee ramps it in over a stop or so.
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * uKnee + EPS;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + EPS);
  float contribution = max(soft, br - uThreshold) / max(br, EPS);
  return c * contribution;
}

vec3 fetch(vec2 uv) { return prefilter(sanitise(texture(tSrc, uv).rgb)); }

float karis(vec3 c) { return uKaris > 0.5 ? 1.0 / (1.0 + luma(c)) : 1.0; }

void main() {
  vec2 t = uTexel;

  vec3 a = fetch(vUv + t * vec2(-2.0,  2.0));
  vec3 b = fetch(vUv + t * vec2( 0.0,  2.0));
  vec3 c = fetch(vUv + t * vec2( 2.0,  2.0));
  vec3 d = fetch(vUv + t * vec2(-2.0,  0.0));
  vec3 e = fetch(vUv);
  vec3 f = fetch(vUv + t * vec2( 2.0,  0.0));
  vec3 g = fetch(vUv + t * vec2(-2.0, -2.0));
  vec3 h = fetch(vUv + t * vec2( 0.0, -2.0));
  vec3 i = fetch(vUv + t * vec2( 2.0, -2.0));
  vec3 j = fetch(vUv + t * vec2(-1.0,  1.0));
  vec3 k = fetch(vUv + t * vec2( 1.0,  1.0));
  vec3 l = fetch(vUv + t * vec2(-1.0, -1.0));
  vec3 m = fetch(vUv + t * vec2( 1.0, -1.0));

  vec3 g0 = (a + b + d + e) * 0.25;
  vec3 g1 = (b + c + e + f) * 0.25;
  vec3 g2 = (d + e + g + h) * 0.25;
  vec3 g3 = (e + f + h + i) * 0.25;
  vec3 g4 = (j + k + l + m) * 0.25;

  // The centre group carries half the weight — that is the 13-tap kernel's shape.
  float w0 = 0.125 * karis(g0);
  float w1 = 0.125 * karis(g1);
  float w2 = 0.125 * karis(g2);
  float w3 = 0.125 * karis(g3);
  float w4 = 0.5 * karis(g4);
  float wsum = w0 + w1 + w2 + w3 + w4;

  fragColor = vec4(sanitise((g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / max(wsum, EPS)), 1.0);
}
`;

/** 3x3 tent upsample, additively blended into the next larger mip. */
const FRAG_BLOOM_UP = /* glsl */ `
${COMMON}

uniform sampler2D tSrc;
uniform vec2 uTexel;   // texel size of the SOURCE (the smaller mip)
uniform float uRadius;
uniform float uScale;

void main() {
  vec2 t = uTexel * uRadius;

  // Tent weights 1-2-1 / 2-4-2 / 1-2-1, normalised by 1/16. A box would make the chain look
  // blocky as it grows; the tent is what gives the halo its smooth, lens-like falloff.
  vec3 s = texture(tSrc, vUv + vec2(-t.x,  t.y)).rgb * 1.0;
  s += texture(tSrc, vUv + vec2( 0.0,  t.y)).rgb * 2.0;
  s += texture(tSrc, vUv + vec2( t.x,  t.y)).rgb * 1.0;
  s += texture(tSrc, vUv + vec2(-t.x,  0.0)).rgb * 2.0;
  s += texture(tSrc, vUv).rgb * 4.0;
  s += texture(tSrc, vUv + vec2( t.x,  0.0)).rgb * 2.0;
  s += texture(tSrc, vUv + vec2(-t.x, -t.y)).rgb * 1.0;
  s += texture(tSrc, vUv + vec2( 0.0, -t.y)).rgb * 2.0;
  s += texture(tSrc, vUv + vec2( t.x, -t.y)).rgb * 1.0;

  fragColor = vec4(sanitise(s * (1.0 / 16.0) * uScale), 1.0);
}
`;

/* -------------------------------------------------------------------------- */
/* 6. Composite                                                                */
/* -------------------------------------------------------------------------- */

const FRAG_COMPOSITE = /* glsl */ `
${COMMON}

uniform sampler2D tColour;
uniform sampler2D tBloom;
uniform sampler2D tDirt;
uniform sampler2D tGodray;

uniform vec2 uTexel;
uniform vec2 uResolution;
uniform float uTime;
uniform float uAspect;

uniform float uExposure;
uniform float uBloomStrength;
uniform float uDirtStrength;
uniform float uGodrayStrength;
uniform float uChromatic;
uniform float uVignette;
/** 1 only when the LDR handoff buffer is 8-bit; see the note at the end of main(). */
uniform float uDither;
uniform float uSharpen;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform vec3 uSplitShadow;
uniform vec3 uSplitHighlight;
uniform float uSplitStrength;
uniform float uLookSlope;
uniform float uLookOffset;
uniform float uLookPower;
uniform float uLookSaturation;

/* ---- AgX ----------------------------------------------------------------
 * Troy Sobotka's AgX: move to Rec.2020 primaries, rotate into a desaturating "inset" basis,
 * log2-encode the scene into a fixed EV window, run a per-channel sigmoid, then rotate back
 * out. The inset/outset pair is the whole trick — it makes the per-channel sigmoid *converge
 * to white* through a plausible hue path instead of clipping to a primary. That is why a
 * muzzle flash under AgX rolls off orange -> yellow -> white like film, while ACES-approx and
 * Reinhard both go pink or clip flat. The wide-gamut detour matters for the same reason: a
 * saturated ember has somewhere to desaturate *into* before it hits the sRGB boundary. This
 * scene is one hard warm key against cool shadows, so highlight hue behaviour is the single
 * most visible tone-mapping decision in the frame. */
const mat3 SRGB_TO_REC2020 = mat3(
  0.6274, 0.0691, 0.0164,
  0.3293, 0.9195, 0.0880,
  0.0433, 0.0113, 0.8956
);
const mat3 REC2020_TO_SRGB = mat3(
   1.6605, -0.1246, -0.0182,
  -0.5876,  1.1329, -0.1006,
  -0.0728, -0.0083,  1.1187
);
const mat3 AGX_INSET = mat3(
  0.8566271533, 0.1373189729, 0.1118982130,
  0.0951212405, 0.7612419906, 0.0767994186,
  0.0482516061, 0.1014390365, 0.8113023684
);
const mat3 AGX_OUTSET = mat3(
   1.1271005818, -0.1413297635, -0.1413297635,
  -0.1106066431,  1.1578237022, -0.1106066431,
  -0.0164939387, -0.0164939387,  1.2519364066
);
// The log window: -12.47 EV to +4.03 EV around mid grey. Fixed by the AgX spec.
const float AGX_MIN_EV = -12.47393;
const float AGX_MAX_EV = 4.026069;

/** 6th-order fit of the AgX sigmoid; matches the reference curve to well under a code value. */
vec3 agxSigmoid(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2
       - 40.14 * x4 * x
       + 31.96 * x4
       - 6.868 * x2 * x
       + 0.4298 * x2
       + 0.1191 * x
       - 0.00232;
}

/* ---- AgX look -----------------------------------------------------------
 * Base AgX is deliberately, contractually flat: it is a *neutral* transform whose job is to
 * get an unbounded scene into a display volume without breaking hue, and it is never shipped
 * naked. Every DCC and engine that offers it pairs it with a "look" — an ASC-CDL slope/offset/
 * power plus a saturation restore, applied to the sigmoid output while it is still in the AgX
 * inset basis (i.e. before AGX_OUTSET, so the outset rotation still does the hue-preserving
 * work on the graded values). Without it the toe never engages, the shoulder never engages,
 * and the whole frame lands inside about two stops around mid grey, which is what a viewer
 * reads as "washed out" before they can name it.
 *
 * power > 1 is what puts the black point back: it deepens the toe far more than it touches the
 * shoulder, so the shadow side of concrete drops toward 8-12% reflectance where a film camera
 * exposed for this scene would put it, and the sun-facing gravel rides up into the shoulder.
 * The saturation restore compensates for AgX's own inset desaturation, which is a tone-mapper
 * artefact rather than an art-direction decision and must not be left in the image. */
vec3 agxLook(vec3 c) {
  // Luminance is taken before the power so the curve cannot change the apparent exposure of a
  // saturated pixel differently from a neutral one of the same brightness.
  float l = luma(c);
  c = pow(max(c * uLookSlope + uLookOffset, vec3(0.0)), vec3(uLookPower));
  return max(vec3(l) + uLookSaturation * (c - vec3(l)), vec3(0.0));
}

vec3 agx(vec3 colour) {
  colour = max(colour, vec3(0.0));
  colour = SRGB_TO_REC2020 * colour;
  colour = AGX_INSET * colour;
  // 1e-10 rather than 0: log2(0) is -inf and would poison the whole pixel.
  colour = max(colour, vec3(1e-10));
  colour = log2(colour);
  colour = (colour - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
  colour = clamp(colour, 0.0, 1.0);
  colour = agxSigmoid(colour);
  colour = agxLook(colour);
  colour = AGX_OUTSET * colour;
  // The sigmoid output is display-encoded (~2.2 gamma). Undo it so everything downstream —
  // grade, vignette, sharpening — runs in display-LINEAR, and the sRGB OETF is applied once,
  // at the very end.
  colour = pow(max(colour, vec3(0.0)), vec3(2.2));
  colour = REC2020_TO_SRGB * colour;
  return clamp(colour, 0.0, 1.0);
}

/* ---- Scene fetch --------------------------------------------------------- */

vec3 addBloom(vec3 c, vec2 uv) {
  vec3 b = sanitise(texture(tBloom, uv).rgb);
  // Lens dirt only becomes visible where light is actually scattering off it, so it
  // *modulates the bloom* rather than being laid over the image as a texture.
  float dirt = texture(tDirt, uv).r;
  c += b * uBloomStrength * (1.0 + dirt * uDirtStrength * 5.0);
  // God rays are scene light: they belong in the HDR, before the tone map, so they roll off
  // with everything else instead of clipping to a flat white wedge.
  c += sanitise(texture(tGodray, uv).rgb) * uGodrayStrength;
  return c;
}

/**
 * Neighbour fetch for the sharpening kernel. Bloom is included because the centre tap has it
 * and a missing low-frequency term would read to CAS as a local maximum, but the lens dirt and
 * god-ray fetches are skipped: both are smooth over a one-pixel radius, so they cost four
 * texture reads each and change the sharpening weights by nothing.
 */
vec3 hdrNeighbour(vec2 uv) {
  vec3 c = sanitise(texture(tColour, uv).rgb);
  c += sanitise(texture(tBloom, uv).rgb) * uBloomStrength;
  return c;
}

vec3 hdrCentre(vec2 uv) {
  /* --- Lateral chromatic aberration, 3 taps -------------------------------
   * The previous curve was d * uChromatic * (0.35 + r2 * 4.0). Two things were wrong with
   * it and together they produced a full-saturation RGB moire grid over every corrugated
   * surface at a grazing angle (measured on wide.png row y=210, x=1200..1230: R, G and B
   * peaking one texel apart in sequence, which reads as a corrupted video stream rather than
   * as a lens).
   *
   * 1) The 0.35 floor meant the split grew *linearly* from the optical axis, so the aberration
   *    was already ~40% of its corner value halfway out. Real lateral CA is a field-height
   *    effect: it is identically zero on axis and only becomes measurable in the outer third
   *    of the image circle. pow(r, 2.5) with r normalised to 1.0 at the frame corner is the
   *    honest shape — 0.09 at half field, 0.35 at three-quarters, 1.0 in the extreme corner.
   * 2) The peak split was ~2.4 source texels at the corner. Anything past about half a texel
   *    stops being a fringe on a silhouette and starts *resampling* high-frequency texture
   *    detail at a different phase per channel, which is precisely how you manufacture colour
   *    moire. 0.47 = 2.35 * 0.2, i.e. the same corner magnitude cut to a fifth, landing at
   *    ~0.45 texel of red-blue separation in the corner and nothing at all inboard of it.
   *
   * Local-contrast damp. Even a sub-texel split reads as an artefact rather than as optics
   * when it lands on a surface whose detail already alternates every pixel — corrugated steel
   * seen edge-on, chain-link, the container ribs. A real lens fringes a *silhouette*, and a
   * silhouette is a step, not a comb. Measure the relative spread of a 4-neighbour luma cross
   * and fade the split out where that spread says "comb". The ratio form is scale-free, so it
   * behaves the same on the sunlit gravel and in the shadow under the wagons.
   * Gated on the falloff so the centre of the frame — which carries no aberration anyway —
   * never pays for the four extra taps. */
  vec2 d = uv - 0.5;
  float r = length(d) * 1.41421356;              // 0 on axis, 1.0 in the frame corner
  float falloff = r * r * sqrt(r);               // pow(r, 2.5) without the log2/exp2 pair
  vec2 off = d * (uChromatic * 0.47) * falloff;

  if (falloff > 0.02) {
    float l0 = luma(sanitise(texture(tColour, uv + vec2( uTexel.x, 0.0)).rgb));
    float l1 = luma(sanitise(texture(tColour, uv - vec2( uTexel.x, 0.0)).rgb));
    float l2 = luma(sanitise(texture(tColour, uv + vec2( 0.0, uTexel.y)).rgb));
    float l3 = luma(sanitise(texture(tColour, uv - vec2( 0.0, uTexel.y)).rgb));
    float mx = max(max(l0, l1), max(l2, l3));
    float mn = min(min(l0, l1), min(l2, l3));
    float contrast = (mx - mn) / (mx + mn + 1e-3);
    off *= 1.0 - 0.9 * smoothstep(0.18, 0.55, contrast);
  }

  vec3 c;
  c.r = texture(tColour, uv + off).r;
  c.g = texture(tColour, uv).g;
  c.b = texture(tColour, uv - off).b;
  return addBloom(sanitise(c), uv);
}

vec3 tone(vec3 hdr) { return agx(hdr * uExposure); }

void main() {
  vec3 e = tone(hdrCentre(vUv));
  vec3 c = e;

  /* --- AMD FidelityFX CAS ------------------------------------------------
   * Contrast-adaptive: the sharpening amount is derived from how much headroom the local
   * neighbourhood has, so flat areas get sharpened and already-contrasty edges do not ring.
   * Run in display-referred space (after the tone map) — sharpening HDR would put haloes
   * around every highlight, because a +8.0 neighbour dominates the kernel.
   * The branch is on a uniform, so it is dynamically uniform: the whole wavefront skips the
   * four extra tone-map evaluations when sharpening is off in the settings menu. */
  if (uSharpen > 0.001) {
    vec3 n = tone(hdrNeighbour(vUv + vec2(0.0, uTexel.y)));
    vec3 s = tone(hdrNeighbour(vUv - vec2(0.0, uTexel.y)));
    vec3 w = tone(hdrNeighbour(vUv - vec2(uTexel.x, 0.0)));
    vec3 ea = tone(hdrNeighbour(vUv + vec2(uTexel.x, 0.0)));

    vec3 mn = min(e, min(min(n, s), min(w, ea)));
    vec3 mx = max(e, max(max(n, s), max(w, ea)));
    // Headroom on both ends: how far the darkest neighbour is from black and the brightest
    // from white. Whichever is smaller limits how hard we may sharpen without clipping.
    vec3 amp = clamp(min(mn, 2.0 - mx) / max(mx, vec3(EPS)), 0.0, 1.0);
    amp = sqrt(amp);
    vec3 wgt = -amp * (uSharpen * 0.18 + 0.02);
    c = (e + (n + s + w + ea) * wgt) / (1.0 + 4.0 * wgt);
  }
  c = max(c, vec3(0.0));

  /* --- Grade: lift / gamma / gain ---------------------------------------- */
  // Slope, then offset, then power (ASC CDL order). art.js keeps these tiny on purpose: the
  // split is meant to be felt, not seen.
  c = pow(max(c * uGain + uLift, vec3(0.0)), vec3(1.0) / max(uGamma, vec3(1e-3)));

  /* --- Contrast about scene mid grey ------------------------------------- */
  // 0.18 is mid grey and AgX maps it near enough to itself in display-linear, so this pivots
  // where the eye expects it and does not crush the shadows.
  c = (c - 0.18) * uContrast + 0.18;
  c = max(c, vec3(0.0));

  /* --- Saturation --------------------------------------------------------- */
  float l = luma(c);
  c = mix(vec3(l), c, uSaturation);

  /* --- Split tone: cool shadows, warm highlights -------------------------- */
  // Both tints are normalised to unit luminance, so this rotates hue without changing
  // exposure. This is the warm-key / cool-shadow split of ARCHITECTURE.md §4 stated one last
  // time, at the very end of the pipe, so nothing downstream can undo it.
  float ls = clamp(l, 0.0, 1.0);
  vec3 shadowT = mix(vec3(1.0), uSplitShadow, uSplitStrength * (1.0 - smoothstep(0.0, 0.45, ls)));
  vec3 highT = mix(vec3(1.0), uSplitHighlight, uSplitStrength * smoothstep(0.35, 1.0, ls));
  c *= shadowT * highT;

  /* --- Vignette ----------------------------------------------------------- */
  vec2 vd = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(vd) * 1.41421356;   // ~1.0 at the corner of a 16:9 frame
  float vig = 1.0 - uVignette * smoothstep(0.30, 1.05, r);
  c *= vig * vig;   // squared: a gentler shoulder near the centre, faster corner falloff

  /* --- Display transfer ---------------------------------------------------- */
  c = clamp(c, 0.0, 1.0);
  vec3 srgb = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));

  /* --- Grain and dither have MOVED to the FXAA pass -------------------------
   * They used to be the last two things this shader did, back when this shader was the last
   * thing in the chain. It no longer is: FRAG_FXAA is now the final edge resolve and writes
   * the default framebuffer. Grain and dither must stay on the *far* side of that resolve —
   * grain applied before an edge filter gets smeared into streaks along every silhouette the
   * filter finds, and a dither is by definition the last operation before the 8-bit write.
   *
   * uDither is the one exception: on a machine with no float render targets at all the LDR
   * handoff buffer is RGBA8, so the quantisation happens here as well and needs breaking up.
   * On every normal machine the handoff is half-float and this is a no-op. */
  float dq1 = hash12(gl_FragCoord.xy * 0.7351 + vec2(uTime * 13.7 + 71.3, uTime * 7.9 + 41.1));
  float dq2 = hash12(gl_FragCoord.xy * 2.1137 + vec2(uTime * 23.3 + 5.9, uTime * 31.7 + 87.7));
  srgb += (dq1 + dq2 - 1.0) * (1.0 / 255.0) * uDither;

  fragColor = vec4(clamp(srgb, 0.0, 1.0), 1.0);
}
`;

/* -------------------------------------------------------------------------- */
/* 7. FXAA 3.11 — the final edge resolve                                       */
/* -------------------------------------------------------------------------- */

/**
 * Why a spatial pass at all when there is a TAA pass eleven hundred lines up.
 *
 * Because temporal accumulation is a *convergence* argument, and edge quality cannot be left
 * to an argument that has preconditions. TAA only antialiases an edge to the extent that the
 * Halton sequence actually walks across it and the history survives the neighbourhood clip;
 * every one of those has a failure mode that shows up as a bare staircase in the delivered
 * frame — the first eight frames after a spawn or a resize, a pixel whose history was rejected
 * by the depth or clip-distance tests, anything moving fast enough to drop feedback to 0.35,
 * and the entire `low` preset where TAA is off by design. Measured on sunline.png the container
 * roofline against the sky was a clean one-pixel staircase with no intermediate values at all.
 * So: TAA stays exactly as it was, running in HDR where it belongs and doing the temporal
 * super-sampling, and this runs unconditionally underneath it as a guaranteed floor on edge
 * quality. A shipped renderer never ships one without the other.
 *
 * This is FXAA 3.11's quality path (Lottes, NVIDIA) — the console-preset edge search: a 3x3
 * luma cross for the edge test, a 3x3 corner gather to pick the dominant axis, then an
 * end-of-edge search along that axis with the P0..P11 step schedule, and finally the
 * sub-pixel-aliasing term blended in. It runs after the tone map and the sRGB transfer,
 * which is not optional: FXAA's thresholds are perceptual, and feeding it linear light makes
 * it blind in the shadows and hysterical in the highlights.
 */
const FRAG_FXAA = /* glsl */ `
${COMMON}

uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uAmount;   // 1 = full resolve; a blend, not an on/off, so it can be tuned
uniform float uGrain;
uniform float uTime;

// Relative and absolute edge thresholds, FXAA 3.11 "quality" defaults. The absolute floor is
// what stops the filter chewing on film grain and dither in the deep shadows.
const float FXAA_EDGE_REL = 0.125;
const float FXAA_EDGE_ABS = 0.0312;
const float FXAA_SUBPIX = 0.75;
#define FXAA_SEARCH_STEPS 12

/**
 * Perceptual luma. The source is already sRGB-encoded display code values, so this is a plain
 * weighted sum — the sqrt() that appears in the common ports is there to approximate the
 * transfer function when the input is linear, and applying it here would double-encode.
 */
float fxaaLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

/** FXAA_QUALITY__P0..P11 for preset 12. Written as a select chain: dynamic indexing of a
 *  const array is legal ESSL 3.00 but spills to scratch memory on several drivers. */
float searchStep(int i) {
  if (i < 5) return 1.0;
  if (i == 5) return 1.5;
  if (i < 10) return 2.0;
  if (i == 10) return 4.0;
  return 8.0;
}

void main() {
  vec3 rgbM = texture(tSrc, vUv).rgb;
  float lumaM = fxaaLuma(rgbM);

  float lumaD = fxaaLuma(texture(tSrc, vUv + vec2(0.0, -uTexel.y)).rgb);
  float lumaU = fxaaLuma(texture(tSrc, vUv + vec2(0.0,  uTexel.y)).rgb);
  float lumaL = fxaaLuma(texture(tSrc, vUv + vec2(-uTexel.x, 0.0)).rgb);
  float lumaR = fxaaLuma(texture(tSrc, vUv + vec2( uTexel.x, 0.0)).rgb);

  float lumaMin = min(lumaM, min(min(lumaD, lumaU), min(lumaL, lumaR)));
  float lumaMax = max(lumaM, max(max(lumaD, lumaU), max(lumaL, lumaR)));
  float range = lumaMax - lumaMin;

  vec3 outRgb = rgbM;

  // Early out on flat neighbourhoods. This is the majority of the frame and is why FXAA costs
  // what it costs rather than what its worst case costs.
  if (range >= max(FXAA_EDGE_ABS, lumaMax * FXAA_EDGE_REL)) {
    float lumaDL = fxaaLuma(texture(tSrc, vUv + vec2(-uTexel.x, -uTexel.y)).rgb);
    float lumaUR = fxaaLuma(texture(tSrc, vUv + vec2( uTexel.x,  uTexel.y)).rgb);
    float lumaUL = fxaaLuma(texture(tSrc, vUv + vec2(-uTexel.x,  uTexel.y)).rgb);
    float lumaDR = fxaaLuma(texture(tSrc, vUv + vec2( uTexel.x, -uTexel.y)).rgb);

    float lumaDU = lumaD + lumaU;
    float lumaLR = lumaL + lumaR;
    float lumaLCorners = lumaDL + lumaUL;
    float lumaDCorners = lumaDL + lumaDR;
    float lumaRCorners = lumaDR + lumaUR;
    float lumaUCorners = lumaUR + lumaUL;

    // Second-derivative energy along each axis; the larger one is the direction the edge
    // *crosses*, so the blend must be applied perpendicular to it.
    float edgeH = abs(-2.0 * lumaL + lumaLCorners) + abs(-2.0 * lumaM + lumaDU) * 2.0
                + abs(-2.0 * lumaR + lumaRCorners);
    float edgeV = abs(-2.0 * lumaU + lumaUCorners) + abs(-2.0 * lumaM + lumaLR) * 2.0
                + abs(-2.0 * lumaD + lumaDCorners);
    bool horizontal = edgeH >= edgeV;

    float luma1 = horizontal ? lumaD : lumaL;
    float luma2 = horizontal ? lumaU : lumaR;
    float grad1 = luma1 - lumaM;
    float grad2 = luma2 - lumaM;
    bool steepest1 = abs(grad1) >= abs(grad2);
    // A quarter of the steeper gradient is the "we have left the edge" test for the search.
    float gradScaled = 0.25 * max(abs(grad1), abs(grad2));

    float stepLength = horizontal ? uTexel.y : uTexel.x;
    float lumaLocalAvg;
    if (steepest1) { stepLength = -stepLength; lumaLocalAvg = 0.5 * (luma1 + lumaM); }
    else           { lumaLocalAvg = 0.5 * (luma2 + lumaM); }

    // Walk from the middle of the edge, i.e. half a texel toward the darker/brighter side.
    vec2 currentUv = vUv;
    if (horizontal) currentUv.y += stepLength * 0.5;
    else            currentUv.x += stepLength * 0.5;

    vec2 offset = horizontal ? vec2(uTexel.x, 0.0) : vec2(0.0, uTexel.y);
    vec2 uv1 = currentUv - offset;
    vec2 uv2 = currentUv + offset;

    float end1 = fxaaLuma(texture(tSrc, uv1).rgb) - lumaLocalAvg;
    float end2 = fxaaLuma(texture(tSrc, uv2).rgb) - lumaLocalAvg;
    bool reached1 = abs(end1) >= gradScaled;
    bool reached2 = abs(end2) >= gradScaled;
    if (!reached1) uv1 -= offset;
    if (!reached2) uv2 += offset;

    if (!(reached1 && reached2)) {
      for (int i = 2; i < FXAA_SEARCH_STEPS; i++) {
        if (!reached1) end1 = fxaaLuma(texture(tSrc, uv1).rgb) - lumaLocalAvg;
        if (!reached2) end2 = fxaaLuma(texture(tSrc, uv2).rgb) - lumaLocalAvg;
        reached1 = abs(end1) >= gradScaled;
        reached2 = abs(end2) >= gradScaled;
        if (reached1 && reached2) break;
        // The accelerating step schedule is what lets 12 iterations reach ~24 texels, which is
        // long enough to resolve the near-horizontal rooflines and catenaries in this map.
        float q = searchStep(i);
        if (!reached1) uv1 -= offset * q;
        if (!reached2) uv2 += offset * q;
      }
    }

    float dist1 = horizontal ? (vUv.x - uv1.x) : (vUv.y - uv1.y);
    float dist2 = horizontal ? (uv2.x - vUv.x) : (uv2.y - vUv.y);
    bool direction1 = dist1 < dist2;
    float distFinal = min(dist1, dist2);
    float edgeLength = dist1 + dist2;

    // Position along the edge, 0.5 at the nearer end falling to 0 at the middle: the further
    // this pixel is from an end of the edge, the less it needs shifting.
    float pixelOffset = -distFinal / max(edgeLength, EPS) + 0.5;

    // Reject the case where the luma variation at the end of the edge disagrees with the
    // variation at this pixel; that means the search ran off onto a different edge.
    bool centreSmaller = lumaM < lumaLocalAvg;
    bool correct = ((direction1 ? end1 : end2) < 0.0) != centreSmaller;
    float finalOffset = correct ? pixelOffset : 0.0;

    // Sub-pixel aliasing term: a 3x3 low-pass against the centre tap, cubed-and-squared into a
    // gentle response. This is what catches single stray pixels and thin sub-texel geometry
    // (the fence wire, the crane cabling) that the edge search alone cannot see.
    float lumaAvg = (1.0 / 12.0) * (2.0 * (lumaDU + lumaLR) + lumaLCorners + lumaRCorners);
    float sub1 = clamp(abs(lumaAvg - lumaM) / max(range, EPS), 0.0, 1.0);
    float sub2 = (-2.0 * sub1 + 3.0) * sub1 * sub1;
    finalOffset = max(finalOffset, sub2 * sub2 * FXAA_SUBPIX);

    vec2 finalUv = vUv;
    if (horizontal) finalUv.y += finalOffset * stepLength;
    else            finalUv.x += finalOffset * stepLength;

    // The resolve is a single bilinear tap at a sub-texel offset — the filtering hardware does
    // the actual averaging, which is why this is a handful of ALU on top of the taps.
    outRgb = mix(rgbM, texture(tSrc, finalUv).rgb, clamp(uAmount, 0.0, 1.0));
  }

  /* --- Film grain, in display code values ----------------------------------
   * Two hashes summed give a triangular PDF; uniform noise leaves a visible DC floor. */
  float n1 = hash12(gl_FragCoord.xy + vec2(uTime * 91.7, uTime * 53.3));
  float n2 = hash12(gl_FragCoord.xy * 1.317 + vec2(uTime * 29.1, uTime * 17.9) + 19.0);
  float tri = n1 + n2 - 1.0;

  /* Silver halide grain is a *mid-tone* phenomenon. In the toe there is barely any developed
   * silver to be granular, and in the shoulder the emulsion saturates and the crystals merge,
   * so a real negative is cleanest at both ends and noisiest around mid grey. The previous
   * response curve was near its maximum in the toe, which is backwards: it put the coarsest
   * noise on the darkest, flattest surfaces in frame — the gun's polymer and receiver panels —
   * where it reads as compression dirt rather than film, and roughly 15% relative noise on a
   * luminance-42 panel is far past anything a shipped title tolerates.
   *
   * 4*L*(1-L) is the parabola that peaks at 1.0 on mid grey and falls to exactly zero at both
   * black and white. Against the old curve that is a 1.7x cut on the gun's receiver panel
   * (L ~ 0.16) and roughly 5x in the deep toe, while mid grey is untouched — so grainAmount
   * still means what art.js says it means.
   *
   * It lives here rather than in the composite because grain laid down *before* an edge filter
   * is grain the edge filter smears along every silhouette it finds; film grain is a property
   * of the final image, so it goes on last. */
  float ld = luma(outRgb);
  float response = 4.0 * ld * (1.0 - ld);
  outRgb += tri * uGrain * response;

  /* --- 8-bit dither, a separate job from grain -----------------------------
   * Quantising to 8 bits is what puts contours in a smooth sky gradient that steps one code
   * value every ~11 rows; grain cannot fix it because grain is luminance-weighted and the sky
   * gradient lives where we deliberately want *less* grain. A 1-LSB triangular-PDF dither
   * applied immediately before the write decorrelates the quantisation error from the signal
   * and turns the contour into noise below the visual threshold. Independent hashes so it does
   * not correlate with the grain and double its amplitude. */
  float d1 = hash12(gl_FragCoord.xy * 0.7351 + vec2(uTime * 13.7 + 71.3, uTime * 7.9 + 41.1));
  float d2 = hash12(gl_FragCoord.xy * 2.1137 + vec2(uTime * 23.3 + 5.9, uTime * 31.7 + 87.7));
  outRgb += (d1 + d2 - 1.0) * (1.0 / 255.0);

  fragColor = vec4(clamp(outRgb, 0.0, 1.0), 1.0);
}
`;

/* -------------------------------------------------------------------------- */
/* Debug views                                                                 */
/* -------------------------------------------------------------------------- */

const FRAG_DEBUG = /* glsl */ `
${COMMON}

uniform sampler2D tColour;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform sampler2D tAO;
uniform sampler2D tBloom;
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform vec2 uNearFar;
uniform vec2 uResolution;
uniform float uExposure;
uniform int uMode;   // 0 colour 1 depth 2 normal 3 ao 4 velocity 5 bloom

void main() {
  vec3 c;
  if (uMode == 1) {
    float dist = linearDepth(texture(tDepth, vUv).x, uNearFar.x, uNearFar.y);
    c = vec3(sqrt(clamp(dist / 120.0, 0.0, 1.0)));   // sqrt so near detail is readable
  } else if (uMode == 2) {
    c = texture(tNormal, vUv).xyz;
  } else if (uMode == 3) {
    c = vec3(texture(tAO, vUv).r);
  } else if (uMode == 4) {
    float d = texture(tDepth, vUv).x;
    vec4 world = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    world /= world.w;
    vec4 pc = uPrevViewProj * vec4(world.xyz, 1.0);
    vec2 prev = pc.xy / max(pc.w, EPS) * 0.5 + 0.5;
    vec2 v = (vUv - prev) * uResolution;
    // Sky is rejected here exactly as FRAG_MOTION rejects it, so this view shows the velocity
    // the chain actually consumes rather than the raw (and at the far plane, meaningless)
    // reconstruction. A correct far field reads flat mid-grey here.
    if (d >= 0.9999) v = vec2(0.0);
    c = vec3(0.5 + v.x * 0.02, 0.5 + v.y * 0.02, 0.5);
  } else if (uMode == 5) {
    c = sanitise(texture(tBloom, vUv).rgb) * 6.0;
  } else {
    // Raw HDR. This is also the emergency path when the chain has failed, so a cheap
    // Reinhard goes on rather than nothing: a blown-out white screen looks like a crash.
    c = sanitise(texture(tColour, vUv).rgb) * uExposure;
    c = c / (1.0 + luma(c));
  }
  c = clamp(c, 0.0, 1.0);
  fragColor = vec4(mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)), 1.0);
}
`;

/* ========================================================================== */
/* Factory                                                                    */
/* ========================================================================== */

const QUALITY_ORDER = { low: 0, medium: 1, high: 2, ultra: 3 };

/**
 * @param {object} engine  from core/engine.js
 * @param {object} [game]  the game object; optional, used for the `ads` event and autofocus
 */
export function createPostFX(engine, game) {
  const renderer = engine && engine.renderer;
  if (!renderer) return inertPost();

  /* --- Capabilities ------------------------------------------------------ */

  // Half-float colour attachments need EXT_color_buffer_float (or _half_float on some mobile
  // WebGL2 stacks). Without them we run the whole chain at 8 bits: banding and clipped
  // highlights, but a picture rather than a black screen.
  let hdrType = THREE.HalfFloatType;
  try {
    const ext = renderer.extensions;
    const hasFloat =
      !!ext &&
      (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    if (!hasFloat) hdrType = THREE.UnsignedByteType;
  } catch {
    hdrType = THREE.UnsignedByteType;
  }

  /* --- Live parameters, seeded from art.js ------------------------------- */

  const params = {
    exposure: GRADE.exposure,
    bloomStrength: GRADE.bloomStrength,
    bloomThreshold: GRADE.bloomThreshold,
    bloomSoftKnee: GRADE.bloomSoftKnee,
    lensDirtStrength: GRADE.lensDirtStrength,
    ssaoIntensity: GRADE.ssaoIntensity,
    ssaoRadius: GRADE.ssaoRadius,
    grainAmount: GRADE.grainAmount,
    vignette: GRADE.vignette,
    chromatic: GRADE.chromatic,
    sharpen: GRADE.sharpen,
    saturation: GRADE.saturation,
    contrast: GRADE.contrast,
    lift: GRADE.lift.slice(),
    gamma: GRADE.gamma.slice(),
    gain: GRADE.gain.slice(),
    motionBlurAmount: GRADE.motionBlurAmount,
    taaFeedback: GRADE.taaFeedback,
    godrayStrength: ATMOSPHERE.godrayStrength,
    /** Split-tone strength. Deliberately small; the palette does the work. */
    splitStrength: 0.16,

    /* --- AgX look ---------------------------------------------------------
     * Base AgX is a neutral transform and is never shipped naked; the look is the ASC-CDL that
     * goes on top of it, applied inside agx() between the sigmoid and the outset. These are
     * tone-curve constants rather than palette values, so they live here, but art.js may
     * override any of them by adding the matching GRADE key — do that rather than editing
     * these numbers if the look ever needs re-timing.
     * The "punchy" preset: unity slope, no offset, power > 1 to re-engage the toe, and a
     * saturation restore that undoes AgX's own inset desaturation. */
    lookSlope: GRADE.agxLookSlope ?? 1.0,
    lookOffset: GRADE.agxLookOffset ?? 0.0,
    lookPower: GRADE.agxLookPower ?? 1.35,
    lookSaturation: GRADE.agxLookSaturation ?? 1.4,
    /**
     * Master lift, added to GRADE.lift on all three channels. Small and negative so the toe
     * actually reaches near-zero: without it the darkest percent of the frame never gets below
     * roughly a third of full scale and the render reads as a fogged grey card rather than a
     * photographed place.
     */
    masterLift: GRADE.masterLift ?? -0.010,
    /**
     * Apparent depth, in metres, below which a pixel is assumed to be the weapon and is kept
     * sharp. Derived from the engine's viewmodel projection rather than guessed — see
     * viewmodelApparentDepth(). Overwritable, but do not lower it without checking the stock
     * of the rifle in ADS: it sits much further back in apparent depth than it looks.
     */
    dofNearKeep: 5.4,
    /** Peak bokeh radius in half-res texels. */
    dofRadius: 14.0,
    dofStrength: 1.0,
    taaEnabled: true,
    motionBlurEnabled: true,
    grainEnabled: true,
    /**
     * Blend weight of the FXAA resolve, not an on/off. The pass runs on every frame at every
     * quality preset — TAA is the temporal super-sampler and this is the spatial floor beneath
     * it, so the two stack rather than substitute. Below about 0.25 the staircase comes back,
     * which is why syncParams() clamps rather than trusts.
     */
    fxaaAmount: 1.0,
  };

  /* --- Feature flags per quality ----------------------------------------- */

  const features = {
    taa: true,
    ssaoTaps: 16,
    ssao: true,
    motionBlur: true,
    dof: true,
    bloomMips: 6,
    aoScale: 1.0,
  };

  function applyQuality(q) {
    const level = QUALITY_ORDER[q] ?? 2;
    features.taa = level >= 1;
    features.ssao = level >= 1;
    features.ssaoTaps = level >= 2 ? 16 : 8;
    features.motionBlur = level >= 2;
    features.dof = level >= 2;
    features.bloomMips = level === 0 ? 4 : level === 1 ? 5 : 6;
    // AO at half resolution below `high`: it is the cheapest big win available and the
    // bilateral blur hides the upsample.
    features.aoScale = level >= 2 ? 1.0 : 0.5;
  }
  applyQuality((game && game.quality) || engine.quality || 'high');

  /* --- Where the viewmodel lands in world-linearised depth ---------------- */

  {
    const vm = engine.viewDepthParams;
    const cam = (game && game.camera) || engine.camera;
    const wn = (cam && cam.near) || 0.05;
    const wf = (cam && cam.far) || 600;
    if (vm && vm.far > vm.near) {
      // 0.8 m covers the muzzle of a carbine held at a low ready plus the arms; beyond that
      // the mapping runs away towards the far plane and would sterilise the whole mid-ground.
      params.dofNearKeep = viewmodelApparentDepth(vm.near, vm.far, wn, wf, 0.8);
    }
  }

  /* --- Fullscreen triangle ------------------------------------------------ */

  const fsScene = new THREE.Scene();
  const fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsGeometry = new THREE.BufferGeometry();
  fsGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)
  );
  const fsMesh = new THREE.Mesh(fsGeometry, null);
  fsMesh.frustumCulled = false;
  fsMesh.matrixAutoUpdate = false;
  fsScene.add(fsMesh);

  function makeMaterial(fragmentShader, uniforms, defines) {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader,
      uniforms,
      defines: defines || {},
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
  }

  /* --- Small generated textures ------------------------------------------ */

  const rng = mulberry32(0x5eed17);

  /** 4x4 interleaved rotation noise for SSAO. */
  const noiseData = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2.0;
    noiseData[i * 4 + 0] = Math.round((Math.cos(a) * 0.5 + 0.5) * 255);
    noiseData[i * 4 + 1] = Math.round((Math.sin(a) * 0.5 + 0.5) * 255);
    noiseData[i * 4 + 2] = 0;
    noiseData[i * 4 + 3] = 255;
  }
  const noiseTexture = new THREE.DataTexture(noiseData, 4, 4, THREE.RGBAFormat);
  noiseTexture.magFilter = THREE.NearestFilter;
  noiseTexture.minFilter = THREE.NearestFilter;
  noiseTexture.wrapS = THREE.RepeatWrapping;
  noiseTexture.wrapT = THREE.RepeatWrapping;
  noiseTexture.colorSpace = THREE.LinearSRGBColorSpace;
  noiseTexture.generateMipmaps = false;
  noiseTexture.needsUpdate = true;

  /** 1x1 black — bound wherever an optional input (god rays) is absent. */
  const blackTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  blackTexture.colorSpace = THREE.LinearSRGBColorSpace;
  blackTexture.needsUpdate = true;

  const dirtTexture = createLensDirt(rng);

  /**
   * Cosine-weighted hemisphere kernel. Built at both tap counts up front so switching quality
   * never allocates mid-session and never leaves the shader's declared array size disagreeing
   * with the JS array length.
   */
  function makeKernel(count) {
    const out = [];
    const r2 = mulberry32(0xa0c1e5 + count);
    for (let i = 0; i < count; i++) {
      // Sample the unit disc uniformly and lift it onto the hemisphere: that is exactly a
      // cosine-weighted distribution, which is the response a diffuse surface actually has.
      const r = Math.sqrt(r2());
      const a = r2() * Math.PI * 2.0;
      const v = new THREE.Vector3(
        r * Math.cos(a),
        r * Math.sin(a),
        Math.sqrt(Math.max(0, 1 - r * r))
      );
      // Cluster samples toward the origin: contact occlusion carries the read, and it is the
      // far samples that produce halos.
      let scale = i / count;
      scale = 0.12 + 0.88 * scale * scale;
      v.multiplyScalar(scale);
      out.push(v);
    }
    return out;
  }
  const kernels = { 8: makeKernel(8), 16: makeKernel(16) };

  /* --- Uniform blocks (allocated once, mutated in place) ------------------ */

  const uTaa = {
    tCurrent: { value: null },
    tHistory: { value: null },
    tDepth: { value: null },
    uInvViewProj: { value: new THREE.Matrix4() },
    uPrevViewProj: { value: new THREE.Matrix4() },
    uTexel: { value: new THREE.Vector2() },
    uResolution: { value: new THREE.Vector2() },
    uNearFar: { value: new THREE.Vector2(0.05, 600) },
    uFeedback: { value: params.taaFeedback },
    uHistoryValid: { value: 0 },
    uClipGamma: { value: 1.0 },
    uNearCut: { value: 4.0 },
  };

  const uSsao = {
    tDepth: { value: null },
    tDepthAll: { value: null },
    tNormal: { value: null },
    tNoise: { value: noiseTexture },
    uProj: { value: new THREE.Matrix4() },
    uInvProj: { value: new THREE.Matrix4() },
    uNoiseScale: { value: new THREE.Vector2(1, 1) },
    uNearFar: { value: new THREE.Vector2(0.05, 600) },
    uKernel: { value: kernels[features.ssaoTaps] || kernels[16] },
    uRadius: { value: params.ssaoRadius },
    uBias: { value: 0.022 },
    uMaxDistance: { value: 45.0 },
    uHasNormal: { value: 0 },
  };

  const uAoBlur = {
    tAO: { value: null },
    uDirection: { value: new THREE.Vector2() },
    uDepthSigma: { value: 0.06 },
  };

  const uAoApply = {
    tColour: { value: null },
    tAO: { value: null },
    uAoTint: { value: new THREE.Vector3(1, 1, 1) },
    uIntensity: { value: 1.0 },
  };

  const uMotion = {
    tColour: { value: null },
    tDepth: { value: null },
    uInvViewProj: { value: new THREE.Matrix4() },
    uPrevViewProj: { value: new THREE.Matrix4() },
    uResolution: { value: new THREE.Vector2() },
    uTexel: { value: new THREE.Vector2() },
    uNearFar: { value: new THREE.Vector2(0.05, 600) },
    uAmount: { value: params.motionBlurAmount },
    uShutter: { value: 0.5 },
    /** Recomputed per frame from the render height — see runMotionBlur(). */
    uMaxPixels: { value: 10.0 },
    uNearCut: { value: 2.5 },
  };

  const uDofPre = {
    tColour: { value: null },
    tDepth: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uNearFar: { value: new THREE.Vector2(0.05, 600) },
    uFocus: { value: 12.0 },
    uCoCScale: { value: 1.0 },
    uNearKeep: { value: params.dofNearKeep },
  };

  const uDofBlur = {
    tSrc0: { value: null },
    tSrc1: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uDir0: { value: new THREE.Vector2(0, 1) },
    uDir1: { value: new THREE.Vector2(0, 1) },
    uMaxRadius: { value: params.dofRadius },
    uMode: { value: 0 },
  };

  const uDofComposite = {
    tColour: { value: null },
    tBokeh: { value: null },
    tDepth: { value: null },
    uNearFar: { value: new THREE.Vector2(0.05, 600) },
    uFocus: { value: 12.0 },
    uCoCScale: { value: 1.0 },
    uNearKeep: { value: params.dofNearKeep },
    uBlend: { value: 1.0 },
  };

  const uBloomDown = {
    tSrc: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uKaris: { value: 0 },
    uPrefilter: { value: 0 },
    uThreshold: { value: params.bloomThreshold },
    uKnee: { value: params.bloomSoftKnee },
  };

  const uBloomUp = {
    tSrc: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uRadius: { value: 1.0 },
    uScale: { value: 1.0 },
  };

  const uComposite = {
    tColour: { value: null },
    tBloom: { value: blackTexture },
    tDirt: { value: dirtTexture },
    tGodray: { value: blackTexture },
    uTexel: { value: new THREE.Vector2() },
    uResolution: { value: new THREE.Vector2() },
    uTime: { value: 0 },
    uAspect: { value: 16 / 9 },
    uExposure: { value: params.exposure },
    uBloomStrength: { value: params.bloomStrength },
    uDirtStrength: { value: params.lensDirtStrength },
    uGodrayStrength: { value: 0 },
    uChromatic: { value: params.chromatic },
    uVignette: { value: params.vignette },
    uDither: { value: hdrType === THREE.UnsignedByteType ? 1 : 0 },
    uSharpen: { value: params.sharpen },
    uSaturation: { value: params.saturation },
    uContrast: { value: params.contrast },
    uLift: { value: new THREE.Vector3() },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSplitShadow: { value: new THREE.Vector3(1, 1, 1) },
    uSplitHighlight: { value: new THREE.Vector3(1, 1, 1) },
    uSplitStrength: { value: params.splitStrength },
    uLookSlope: { value: params.lookSlope },
    uLookOffset: { value: params.lookOffset },
    uLookPower: { value: params.lookPower },
    uLookSaturation: { value: params.lookSaturation },
  };

  const uFxaa = {
    tSrc: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uAmount: { value: 1.0 },
    uGrain: { value: params.grainAmount },
    uTime: { value: 0 },
  };

  const uDebug = {
    tColour: { value: null },
    tDepth: { value: null },
    tNormal: { value: blackTexture },
    tAO: { value: blackTexture },
    tBloom: { value: blackTexture },
    uInvViewProj: { value: new THREE.Matrix4() },
    uPrevViewProj: { value: new THREE.Matrix4() },
    uNearFar: { value: new THREE.Vector2(0.05, 600) },
    uResolution: { value: new THREE.Vector2() },
    uExposure: { value: params.exposure },
    uMode: { value: 0 },
  };

  // Split tone from the palette: the shadows take the sky's zenith blue, the highlights take
  // the low sun. Normalised to unit luminance so this is a hue rotation, not an exposure
  // change. This is ARCHITECTURE.md §4's warm/cool split, enforced at the end of the pipe.
  paletteVec(PALETTE.skyZenith, uComposite.uSplitShadow.value, true);
  paletteVec(PALETTE.sun, uComposite.uSplitHighlight.value, true);
  // Occlusion cools toward the coolest shadow the scene is allowed to reach.
  paletteVec(PALETTE.moonlessShadow, uAoApply.uAoTint.value, true);
  // Pull the AO tint most of the way back to neutral: at full strength it reads as a blue
  // stain in every crevice.
  uAoApply.uAoTint.value.lerp(_white, 0.62);

  /* --- Materials ---------------------------------------------------------- */

  const matTaa = makeMaterial(FRAG_TAA, uTaa);
  const matSsao = makeMaterial(FRAG_SSAO, uSsao, { KERNEL_SIZE: features.ssaoTaps });
  const matAoBlur = makeMaterial(FRAG_AO_BLUR, uAoBlur);
  const matAoApply = makeMaterial(FRAG_AO_APPLY, uAoApply);
  const matMotion = makeMaterial(FRAG_MOTION, uMotion);
  const matDofPre = makeMaterial(FRAG_DOF_PREFILTER, uDofPre);
  const matDofBlur = makeMaterial(FRAG_DOF_BLUR, uDofBlur);
  const matDofComposite = makeMaterial(FRAG_DOF_COMPOSITE, uDofComposite);
  const matBloomDown = makeMaterial(FRAG_BLOOM_DOWN, uBloomDown);
  const matBloomUp = makeMaterial(FRAG_BLOOM_UP, uBloomUp);
  matBloomUp.blending = THREE.AdditiveBlending;
  const matComposite = makeMaterial(FRAG_COMPOSITE, uComposite);
  const matFxaa = makeMaterial(FRAG_FXAA, uFxaa);
  const matDebug = makeMaterial(FRAG_DEBUG, uDebug);

  const allMaterials = [
    matTaa, matSsao, matAoBlur, matAoApply, matMotion, matDofPre, matDofBlur,
    matDofComposite, matBloomDown, matBloomUp, matComposite, matFxaa, matDebug,
  ];

  /* --- Render targets ----------------------------------------------------- */

  let width = 0;
  let height = 0;
  const targets = {
    history: [null, null],
    chain: [null, null],
    ao: [null, null],
    bloom: [],
    dof: [null, null, null],
    /** LDR handoff between the composite and the FXAA resolve. Full res, always allocated. */
    ldr: null,
  };
  let historyIndex = 0;
  let historyValid = false;
  let chainIndex = 0;
  let sizeDirty = false;
  let built = false;

  function makeRT(w, h, filter) {
    const rt = new THREE.WebGLRenderTarget(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)), {
      type: hdrType,
      format: THREE.RGBAFormat,
      minFilter: filter,
      magFilter: filter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    // Every intermediate stays linear. The sRGB transfer happens once, in the composite.
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    rt.texture.generateMipmaps = false;
    return rt;
  }

  function disposeTarget(rt) {
    if (rt) rt.dispose();
  }

  function releaseTargets() {
    built = false;
    disposeTarget(targets.history[0]); targets.history[0] = null;
    disposeTarget(targets.history[1]); targets.history[1] = null;
    disposeTarget(targets.chain[0]); targets.chain[0] = null;
    disposeTarget(targets.chain[1]); targets.chain[1] = null;
    disposeTarget(targets.ao[0]); targets.ao[0] = null;
    disposeTarget(targets.ao[1]); targets.ao[1] = null;
    for (let i = 0; i < targets.bloom.length; i++) disposeTarget(targets.bloom[i]);
    targets.bloom.length = 0;
    for (let i = 0; i < 3; i++) { disposeTarget(targets.dof[i]); targets.dof[i] = null; }
    disposeTarget(targets.ldr); targets.ldr = null;
  }

  function buildTargets(w, h) {
    releaseTargets();
    width = Math.max(1, w | 0);
    height = Math.max(1, h | 0);

    // The ping-pong pair is only needed if something between TAA and bloom actually writes
    // colour. At `low` nothing does, and two full-res RGBA16F buffers is exactly the kind of
    // waste that costs the integrated-graphics target its frame budget.
    if (features.ssao || features.motionBlur || features.dof) {
      targets.chain[0] = makeRT(width, height, THREE.LinearFilter);
      targets.chain[1] = makeRT(width, height, THREE.LinearFilter);
    }

    if (features.taa) {
      // Nearest on the history is wrong: the Catmull-Rom fetch relies on bilinear taps.
      targets.history[0] = makeRT(width, height, THREE.LinearFilter);
      targets.history[1] = makeRT(width, height, THREE.LinearFilter);
    }

    // The composite no longer draws to the screen; it draws here and FXAA resolves this to the
    // default framebuffer. Allocated unconditionally and at every quality level — the whole
    // point of the pass is that edge quality never depends on a preset or on TAA converging.
    // LinearFilter is load-bearing: the FXAA resolve is a single bilinear tap at a sub-texel
    // offset, and with NearestFilter it would snap back to the unfiltered pixel and do nothing.
    targets.ldr = makeRT(width, height, THREE.LinearFilter);

    if (features.ssao) {
      const aw = Math.max(1, Math.floor(width * features.aoScale));
      const ah = Math.max(1, Math.floor(height * features.aoScale));
      targets.ao[0] = makeRT(aw, ah, THREE.LinearFilter);
      targets.ao[1] = makeRT(aw, ah, THREE.LinearFilter);
    }

    if (features.dof) {
      const dw = Math.max(1, width >> 1);
      const dh = Math.max(1, height >> 1);
      targets.dof[0] = makeRT(dw, dh, THREE.LinearFilter);
      targets.dof[1] = makeRT(dw, dh, THREE.LinearFilter);
      targets.dof[2] = makeRT(dw, dh, THREE.LinearFilter);
    }

    // Mip chain starts at half resolution — bloom never needs full-res detail and starting
    // one level down halves the cost of the most expensive filter in the chain.
    for (let i = 0; i < features.bloomMips; i++) {
      const mw = Math.max(1, width >> (i + 1));
      const mh = Math.max(1, height >> (i + 1));
      if (mw < 2 || mh < 2) break;
      targets.bloom.push(makeRT(mw, mh, THREE.LinearFilter));
    }

    historyValid = false;
    historyIndex = 0;
    chainIndex = 0;
    built = true;
  }

  /* --- Draw helper -------------------------------------------------------- */

  let savedAutoClear = true;

  function draw(material, target, clear) {
    fsMesh.material = material;
    renderer.setRenderTarget(target || null);
    if (clear !== false) renderer.clear(true, false, false);
    renderer.render(fsScene, fsCamera);
  }

  /* --- State -------------------------------------------------------------- */

  let jitterX = 0;
  let jitterY = 0;
  let appliedM02 = NaN;
  let appliedM12 = NaN;
  let baseM02 = 0;
  let baseM12 = 0;
  let jitterActive = false;

  let dofActive = false;
  let dofFocus = 12.0;
  let dofFocusTarget = 12.0;
  let dofBlend = 0.0;
  let autofocusCounter = 0;

  let debugMode = 0;
  let failed = false;
  let elapsed = 0;

  // Our own jitter-free previous view-projection. engine.prevViewProj is captured too (see
  // below) but the reprojection maths must not contain the sub-pixel offset, and we cannot
  // know whether the engine snapshotted its matrix before or after post.jitter ran.
  const prevViewProjOwn = new THREE.Matrix4();
  let prevViewProjValid = false;

  // The engine reallocates its targets on resize and tells its subscribers. syncSize() would
  // catch it a frame later anyway by polling the HDR target's dimensions, but subscribing
  // means the rebuild lands in the same frame and the history is invalidated before it can be
  // sampled at the wrong resolution.
  let unsubscribeResize = null;
  if (typeof engine.addResizeListener === 'function') {
    unsubscribeResize = engine.addResizeListener(() => {
      sizeDirty = true;
      historyValid = false;
    });
  }

  if (game && game.events && typeof game.events.on === 'function') {
    // ARCHITECTURE.md §2: `ads` is emitted by the weapon and consumed here for DOF.
    game.events.on('ads', (payload) => {
      post.setDOF(!!(payload && payload.active), dofFocusTarget);
    });
  }

  /* --- Parameter -> uniform sync (no allocation) -------------------------- */

  function syncParams() {
    uTaa.uFeedback.value = params.taaFeedback;
    // 1.0, not 1.25. The box is now a pure variance box with a floor rather than a variance box
    // intersected with the raw neighbourhood min/max, so the same gamma would be markedly more
    // permissive than before. 1.0 sigma is the standard Salvi width and is what keeps thin
    // geometry from surviving against a bright background.
    uTaa.uClipGamma.value = 1.0;

    uSsao.uRadius.value = params.ssaoRadius;
    // GRADE.ssaoIntensity is a 0..1 art value; map it onto a power curve exponent. 0.85 lands
    // near 2.1, a firm but not sooty contact shadow.
    uAoApply.uIntensity.value = 0.6 + params.ssaoIntensity * 1.75;

    uMotion.uAmount.value = params.motionBlurEnabled ? params.motionBlurAmount : 0.0;

    uBloomDown.uThreshold.value = params.bloomThreshold;
    uBloomDown.uKnee.value = params.bloomSoftKnee;

    uComposite.uExposure.value = params.exposure;
    uComposite.uBloomStrength.value = params.bloomStrength;
    uComposite.uDirtStrength.value = params.lensDirtStrength;
    uComposite.uChromatic.value = params.chromatic;
    uComposite.uVignette.value = params.vignette;
    uComposite.uSharpen.value = params.sharpen;
    uFxaa.uGrain.value = params.grainEnabled ? params.grainAmount : 0.0;
    // Clamped rather than gated: the settings menu may dial the resolve back, but there is no
    // path through this function that turns it off, because a shipped frame never has zero
    // spatial AA.
    uFxaa.uAmount.value = Math.max(0.25, Math.min(1, params.fxaaAmount));
    uComposite.uSaturation.value = params.saturation;
    uComposite.uContrast.value = params.contrast;
    uComposite.uSplitStrength.value = params.splitStrength;
    uComposite.uLookSlope.value = params.lookSlope;
    uComposite.uLookOffset.value = params.lookOffset;
    uComposite.uLookPower.value = params.lookPower;
    uComposite.uLookSaturation.value = params.lookSaturation;
    // Master lift folded into the CDL offset, so there is still exactly one offset term in the
    // shader. art.js keeps the per-channel lift for the split; this is the neutral black point.
    const ml = params.masterLift;
    uComposite.uLift.value.set(params.lift[0] + ml, params.lift[1] + ml, params.lift[2] + ml);
    uComposite.uGamma.value.set(params.gamma[0], params.gamma[1], params.gamma[2]);
    uComposite.uGain.value.set(params.gain[0], params.gain[1], params.gain[2]);

    uDebug.uExposure.value = params.exposure;
    uDofPre.uNearKeep.value = params.dofNearKeep;
    uDofComposite.uNearKeep.value = params.dofNearKeep;
    uDofBlur.uMaxRadius.value = params.dofRadius;

    // TAA can afford to guard the whole viewmodel band; motion blur only guards the front of
    // it, so nearby cover still smears when the player whips the camera round.
    uTaa.uNearCut.value = params.dofNearKeep;
    uMotion.uNearCut.value = params.dofNearKeep * 0.6;
  }

  /* --- Size sync ---------------------------------------------------------- */

  /**
   * The authoritative resolution is whatever the engine's HDR target actually is — the render
   * scale of the quality preset is applied there, not here. Writes into a shared object so
   * this can be called every frame without allocating.
   */
  function currentSize() {
    const hdr = engine.targets && engine.targets.hdr;
    if (hdr && hdr.width && hdr.height) {
      _size.x = hdr.width;
      _size.y = hdr.height;
      return _size;
    }
    if (engine.size && engine.size.w) {
      const dpr = engine.size.dpr || 1;
      _size.x = Math.round(engine.size.w * dpr);
      _size.y = Math.round(engine.size.h * dpr);
      return _size;
    }
    renderer.getDrawingBufferSize(_drawSize);
    _size.x = _drawSize.x;
    _size.y = _drawSize.y;
    return _size;
  }

  function syncSize() {
    const size = currentSize();
    if (size.x !== width || size.y !== height || !built || sizeDirty) {
      sizeDirty = false;
      buildTargets(size.x, size.y);
      return true;
    }
    return false;
  }

  /* --- The chain ---------------------------------------------------------- */

  function runTAA(hdrTexture, depthTexture) {
    const write = targets.history[historyIndex];
    const read = targets.history[1 - historyIndex];
    if (!write || !read) return hdrTexture;

    uTaa.tCurrent.value = hdrTexture;
    uTaa.tHistory.value = read.texture;
    uTaa.tDepth.value = depthTexture;
    uTaa.uHistoryValid.value = historyValid ? 1 : 0;
    uTaa.uTexel.value.set(1 / width, 1 / height);
    uTaa.uResolution.value.set(width, height);

    draw(matTaa, write);

    historyIndex = 1 - historyIndex;
    historyValid = true;
    return write.texture;
  }

  function runSSAO(colourTexture, depthTexture, normalTexture, worldDepthTexture) {
    const aoA = targets.ao[0];
    const aoB = targets.ao[1];
    if (!aoA || !aoB || !targets.chain[chainIndex]) return colourTexture;

    uSsao.tDepth.value = worldDepthTexture || depthTexture;
    uSsao.tDepthAll.value = depthTexture;
    uSsao.tNormal.value = normalTexture || blackTexture;
    uSsao.uHasNormal.value = normalTexture ? 1 : 0;
    uSsao.uNoiseScale.value.set(aoA.width / 4, aoA.height / 4);
    draw(matSsao, aoA);

    // Separable bilateral blur. Horizontal into B, vertical back into A.
    uAoBlur.tAO.value = aoA.texture;
    uAoBlur.uDirection.value.set(1 / aoA.width, 0);
    draw(matAoBlur, aoB);

    uAoBlur.tAO.value = aoB.texture;
    uAoBlur.uDirection.value.set(0, 1 / aoA.height);
    draw(matAoBlur, aoA);

    const out = targets.chain[chainIndex];
    uAoApply.tColour.value = colourTexture;
    uAoApply.tAO.value = aoA.texture;
    draw(matAoApply, out);
    chainIndex = 1 - chainIndex;
    return out.texture;
  }

  function runMotionBlur(colourTexture, depthTexture) {
    const out = targets.chain[chainIndex];
    if (!out) return colourTexture;
    uMotion.tColour.value = colourTexture;
    uMotion.tDepth.value = depthTexture;
    uMotion.uResolution.value.set(width, height);
    uMotion.uTexel.value.set(1 / width, 1 / height);
    // 10 px at a 900-line render, scaled so the blur is the same *fraction of the frame* at
    // every render scale rather than growing with resolution. Clamped so a 540p render scale
    // still gets a readable smear and a 4K one does not turn into a streak. 8 taps over 10 px
    // are ~1.2 px apart, which is dense enough to read as continuous rather than as ghosts.
    uMotion.uMaxPixels.value = Math.min(20, Math.max(6, height * (10 / 900)));
    draw(matMotion, out);
    chainIndex = 1 - chainIndex;
    return out.texture;
  }

  function runDOF(colourTexture, depthTexture) {
    const half = targets.dof[0];
    const rtA = targets.dof[1];
    const rtB = targets.dof[2];
    if (!half || !rtA || !rtB || !targets.chain[chainIndex]) return colourTexture;

    uDofPre.tColour.value = colourTexture;
    uDofPre.tDepth.value = depthTexture;
    uDofPre.uTexel.value.set(1 / width, 1 / height);
    uDofPre.uFocus.value = dofFocus;
    draw(matDofPre, half);

    const halfTexel = 1 / half.width;
    uDofBlur.uTexel.value.set(halfTexel, 1 / half.height);

    // Three axes 120 degrees apart. Blurring along a pair of them produces a rhombus; the
    // union of the three rhombi is the hexagonal aperture of a real iris.
    // A = up, B = down-left, C = down-right.
    uDofBlur.uMode.value = 0;
    uDofBlur.tSrc0.value = half.texture;
    uDofBlur.tSrc1.value = half.texture;
    uDofBlur.uDir0.value.set(0.0, 1.0);
    draw(matDofBlur, rtA);

    uDofBlur.uDir0.value.set(-0.8660254, -0.5);
    draw(matDofBlur, rtB);

    uDofBlur.uMode.value = 1;
    uDofBlur.tSrc0.value = rtA.texture;
    uDofBlur.tSrc1.value = rtB.texture;
    uDofBlur.uDir0.value.set(-0.8660254, -0.5);
    uDofBlur.uDir1.value.set(0.8660254, -0.5);
    draw(matDofBlur, half);

    const out = targets.chain[chainIndex];
    uDofComposite.tColour.value = colourTexture;
    uDofComposite.tBokeh.value = half.texture;
    uDofComposite.tDepth.value = depthTexture;
    uDofComposite.uFocus.value = dofFocus;
    uDofComposite.uBlend.value = dofBlend * params.dofStrength;
    draw(matDofComposite, out);
    chainIndex = 1 - chainIndex;
    return out.texture;
  }

  function runBloom(colourTexture) {
    const mips = targets.bloom;
    if (mips.length === 0) return blackTexture;

    // Downsample. Level 0 also applies the soft-knee threshold and the Karis average.
    for (let i = 0; i < mips.length; i++) {
      const srcW = i === 0 ? width : mips[i - 1].width;
      const srcH = i === 0 ? height : mips[i - 1].height;
      uBloomDown.tSrc.value = i === 0 ? colourTexture : mips[i - 1].texture;
      uBloomDown.uTexel.value.set(1 / srcW, 1 / srcH);
      uBloomDown.uKaris.value = i === 0 ? 1 : 0;
      uBloomDown.uPrefilter.value = i === 0 ? 1 : 0;
      draw(matBloomDown, mips[i]);
    }

    // Upsample, additively blended into the next larger mip. Each level contributes its own
    // scale of scatter, which is what makes the result read as a lens rather than a blur.
    uBloomUp.uRadius.value = 1.0;
    uBloomUp.uScale.value = 1.0;
    for (let i = mips.length - 1; i > 0; i--) {
      uBloomUp.tSrc.value = mips[i].texture;
      uBloomUp.uTexel.value.set(1 / mips[i].width, 1 / mips[i].height);
      draw(matBloomUp, mips[i - 1], false);   // additive: must not clear
    }

    return mips[0].texture;
  }

  /* --- Public ------------------------------------------------------------- */

  const post = {
    params,

    /**
     * TAA sub-pixel jitter. Offsets projectionMatrix[8]/[9] (the m02/m12 shear terms) by the
     * Halton offset expressed in NDC. Adding d to m02 moves clip.x by d*viewZ = -d*w, so the
     * image shifts by -d/2 in UV; the exact sign does not matter as long as the sequence
     * covers the pixel evenly, but the inverse must be kept in sync or every depth
     * reconstruction in the chain is wrong by a pixel.
     */
    jitter(camera, frame) {
      if (!camera || !camera.isCamera) return;
      const e = camera.projectionMatrix.elements;

      // Someone else may have rebuilt the projection (ADS FOV pull-in does, every frame it
      // animates). Detect that by comparing against what we last wrote and re-baseline.
      if (e[8] !== appliedM02 || e[9] !== appliedM12) {
        baseM02 = e[8];
        baseM12 = e[9];
      }

      const size = currentSize();
      const w = size.x || 1;
      const h = size.y || 1;

      if (!features.taa || !params.taaEnabled || debugMode !== 0) {
        e[8] = baseM02;
        e[9] = baseM12;
        jitterX = 0;
        jitterY = 0;
        jitterActive = false;
      } else {
        const i = (frame | 0) % JITTER_COUNT;
        jitterX = JITTER[i * 2 + 0];
        jitterY = JITTER[i * 2 + 1];
        e[8] = baseM02 + (jitterX * 2.0) / w;
        e[9] = baseM12 + (jitterY * 2.0) / h;
        jitterActive = true;
      }

      appliedM02 = e[8];
      appliedM12 = e[9];

      // projectionMatrixInverse is not recomputed by a direct element write, and three uses it
      // (and so does our SSAO) — keep it consistent.
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

      // The jitter-free projection, kept for reprojection maths.
      _projNoJitter.copy(camera.projectionMatrix);
      _projNoJitter.elements[8] = baseM02;
      _projNoJitter.elements[9] = baseM12;
    },

    /** ADS depth of field. focusDistance in metres; pass 0 to keep the current/auto focus. */
    setDOF(active, focusDistance) {
      dofActive = !!active && features.dof;
      if (typeof focusDistance === 'number' && focusDistance > 0.1) {
        dofFocusTarget = focusDistance;
      }
    },

    /** 'depth' | 'normal' | 'ao' | 'velocity' | 'bloom' | null */
    debugView(name) {
      const map = { colour: 0, color: 0, depth: 1, normal: 2, ao: 3, velocity: 4, bloom: 5 };
      debugMode = name ? map[name] ?? 0 : 0;
      // The jitter must stop while inspecting a buffer, otherwise every debug view crawls.
      if (debugMode !== 0) historyValid = false;
      return debugMode;
    },

    /**
     * main.js calls engine.resize() then post.resize() with CSS pixels. We deliberately do not
     * use those numbers: the engine's HDR target is the authority (render scale, device pixel
     * ratio and any clamping all land there). Flag a rebuild and let syncSize read the real
     * size on the next frame, by which point the engine has definitely reallocated.
     */
    resize() {
      sizeDirty = true;
      historyValid = false;
    },

    setQuality(q) {
      const before = JSON.stringify(features);
      applyQuality(q);
      if (JSON.stringify(features) === before) return;
      if (matSsao.defines.KERNEL_SIZE !== features.ssaoTaps) {
        matSsao.defines.KERNEL_SIZE = features.ssaoTaps;
        // The uniform array is declared at KERNEL_SIZE, so the JS array must match exactly.
        uSsao.uKernel.value = kernels[features.ssaoTaps] || kernels[16];
        matSsao.needsUpdate = true;
      }
      if (width && height) buildTargets(width, height);
    },

    render(dt, gameRef) {
      const g = gameRef || game;
      if (failed) { emergencyBlit(g); return; }
      try {
        renderFrame(dt || 0, g);
      } catch (err) {
        failed = true;
        // One report, then permanently degrade to a straight blit. A pass that throws every
        // frame would otherwise leave a black screen and bury the console.
        if (g && g.debug) console.error('[postfx] chain failed, degrading to blit', err);
        emergencyBlit(g);
      }
    },

    dispose() {
      if (unsubscribeResize) unsubscribeResize();
      releaseTargets();
      for (let i = 0; i < allMaterials.length; i++) allMaterials[i].dispose();
      fsGeometry.dispose();
      noiseTexture.dispose();
      blackTexture.dispose();
      if (dirtTexture) dirtTexture.dispose();
    },

    /** Exposed for debugging/tools; not part of the contract. */
    _targets: targets,
    _features: features,
  };

  /* --- Frame -------------------------------------------------------------- */

  function renderFrame(dt, g) {
    const hdr = engine.targets && engine.targets.hdr;
    if (!hdr) { emergencyBlit(g); return; }

    elapsed += dt;
    syncSize();
    syncParams();

    const camera = (g && g.camera) || engine.camera;
    const near = camera ? camera.near : 0.05;
    const far = camera ? camera.far : 600;

    const depthTexture = hdr.depthTexture || (engine.targets.depth || null);
    const normalTarget = engine.targets.normal;
    const normalTexture = normalTarget ? normalTarget.texture || normalTarget : null;
    // The prepass depth has no viewmodel in it, which is what SSAO wants.
    const worldDepthTexture = (normalTarget && normalTarget.depthTexture) || null;

    /* --- Matrices (jitter-free, for every reprojection in the chain) ------
     * The engine keeps an unjittered pair and rolls `prev` forward at the top of renderScene,
     * so during this call `prev` is frame N-1 and `curr` is frame N — exactly what
     * reprojection needs. We only fall back to computing our own if the engine has not
     * primed them (identity), because the sub-pixel offset must NOT be in these matrices: a
     * jittered reprojection makes a static camera wobble by half a pixel every frame. */
    if (camera) {
      const eCurr = engine.currViewProj;
      const ePrev = engine.prevViewProj;
      const primed =
        eCurr && eCurr.isMatrix4 && ePrev && ePrev.isMatrix4 &&
        !(eCurr.elements[0] === 1 && eCurr.elements[5] === 1 && eCurr.elements[15] === 1);

      if (primed) {
        _viewProj.copy(eCurr);
        _prevViewProj.copy(ePrev);
        prevViewProjValid = true;
      } else {
        if (!jitterActive) _projNoJitter.copy(camera.projectionMatrix);
        _viewProj.multiplyMatrices(_projNoJitter, camera.matrixWorldInverse);
        if (!prevViewProjValid) {
          // First frame: previous == current, so velocity is zero everywhere instead of a
          // full-screen streak.
          prevViewProjOwn.copy(_viewProj);
          prevViewProjValid = true;
        }
        _prevViewProj.copy(prevViewProjOwn);
      }
      _invViewProj.copy(_viewProj).invert();
    }

    const nfx = near;
    const nfy = far;

    uTaa.uInvViewProj.value.copy(_invViewProj);
    uTaa.uPrevViewProj.value.copy(_prevViewProj);
    uTaa.uNearFar.value.set(nfx, nfy);

    uMotion.uInvViewProj.value.copy(_invViewProj);
    uMotion.uPrevViewProj.value.copy(_prevViewProj);
    uMotion.uNearFar.value.set(nfx, nfy);

    if (camera) {
      // SSAO works in view space and samples the *jittered* depth buffer, so it uses the
      // jittered projection pair — that is what the depth values were rasterised with.
      uSsao.uProj.value.copy(camera.projectionMatrix);
      uSsao.uInvProj.value.copy(camera.projectionMatrixInverse);
    }
    uSsao.uNearFar.value.set(nfx, nfy);
    uDofPre.uNearFar.value.set(nfx, nfy);
    uDofComposite.uNearFar.value.set(nfx, nfy);

    uComposite.uTexel.value.set(1 / width, 1 / height);
    uComposite.uResolution.value.set(width, height);
    uComposite.uAspect.value = width / Math.max(1, height);
    // Wrapped: the grain hash multiplies time by ~90, and a float that has been accumulating
    // for an hour loses enough mantissa that the noise visibly freezes.
    uComposite.uTime.value = elapsed % 60;

    /* --- DOF focus ------------------------------------------------------- */
    updateFocus(dt, g);

    /* --- Renderer state -------------------------------------------------- */
    savedAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    let colour = hdr.texture;

    /* 1. TAA */
    if (features.taa && params.taaEnabled && depthTexture && debugMode === 0) {
      colour = runTAA(colour, depthTexture);
    } else {
      historyValid = false;
    }

    /* 2. SSAO */
    let aoTexture = null;
    if (features.ssao && depthTexture && params.ssaoIntensity > 0.001) {
      colour = runSSAO(colour, depthTexture, normalTexture, worldDepthTexture);
      aoTexture = targets.ao[0] ? targets.ao[0].texture : null;
    }

    /* 3. Motion blur */
    if (features.motionBlur && params.motionBlurEnabled && depthTexture &&
        params.motionBlurAmount > 0.001 && prevViewProjValid) {
      colour = runMotionBlur(colour, depthTexture);
    }

    /* 4. DOF */
    if (features.dof && depthTexture && dofBlend > 0.002) {
      colour = runDOF(colour, depthTexture);
    }

    /* 5. Bloom */
    let bloomTexture = blackTexture;
    if (params.bloomStrength > 0.0001) {
      bloomTexture = runBloom(colour);
    }

    /* 6. Composite -> LDR, 7. FXAA -> screen (or a debug view straight to the screen) */
    if (debugMode !== 0) {
      uDebug.tColour.value = colour;
      uDebug.tDepth.value = depthTexture || blackTexture;
      uDebug.tNormal.value = normalTexture || blackTexture;
      uDebug.tAO.value = aoTexture || blackTexture;
      uDebug.tBloom.value = bloomTexture;
      uDebug.uInvViewProj.value.copy(_invViewProj);
      uDebug.uPrevViewProj.value.copy(_prevViewProj);
      uDebug.uNearFar.value.set(nfx, nfy);
      uDebug.uResolution.value.set(width, height);
      uDebug.uMode.value = debugMode;
      draw(matDebug, null);
    } else {
      uComposite.tColour.value = colour;
      uComposite.tBloom.value = bloomTexture;

      // God rays are optional and may appear at any time once world/sky.js has built them.
      const godray = g && g.sky && g.sky.godrayTexture;
      if (godray) {
        uComposite.tGodray.value = godray.isTexture ? godray : (godray.texture || blackTexture);
        uComposite.uGodrayStrength.value = params.godrayStrength;
      } else {
        uComposite.tGodray.value = blackTexture;
        uComposite.uGodrayStrength.value = 0;
      }

      const ldr = targets.ldr;
      if (ldr) {
        draw(matComposite, ldr);
        uFxaa.tSrc.value = ldr.texture;
        uFxaa.uTexel.value.set(1 / width, 1 / height);
        uFxaa.uTime.value = uComposite.uTime.value;
        draw(matFxaa, null);
      } else {
        // Allocation failed. Better a slightly aliased, grainless frame than a black screen —
        // the composite's own dither is switched on for the direct-to-screen write.
        const savedDither = uComposite.uDither.value;
        uComposite.uDither.value = 1;
        draw(matComposite, null);
        uComposite.uDither.value = savedDither;
      }
    }

    /* --- Bookkeeping ----------------------------------------------------- */
    // Only used by the fallback path; the engine owns the real history when it is primed.
    if (camera) prevViewProjOwn.copy(_viewProj);

    renderer.setRenderTarget(null);
    renderer.autoClear = savedAutoClear;
  }

  /**
   * ADS autofocus. Focus rides a critically-damped-ish exponential toward the distance of
   * whatever is under the crosshair, so pulling into the sight racks focus the way a
   * cameraman would rather than snapping.
   */
  function updateFocus(dt, g) {
    if (dofActive) {
      autofocusCounter++;
      // A CPU raycast every frame is wasteful and allocates in level.raycast; every 6th frame
      // is far faster than the focus spring can move.
      if (g && g.level && typeof g.level.raycast === 'function' && autofocusCounter % 6 === 0) {
        const cam = g.camera || engine.camera;
        if (cam) {
          _rayOrigin.setFromMatrixPosition(cam.matrixWorld);
          _rayDir.set(0, 0, -1).applyQuaternion(cam.quaternion);
          const hit = g.level.raycast(_rayOrigin, _rayDir, 90);
          if (hit && hit.hit !== false && typeof hit.distance === 'number') {
            dofFocusTarget = Math.max(2.5, Math.min(90, hit.distance));
          } else {
            dofFocusTarget = 60;
          }
        }
      }
    }

    // 1 - exp(-k*dt) integration: frame-rate independent, per ARCHITECTURE.md §1.
    const kFocus = 1 - Math.exp(-6.0 * dt);
    dofFocus += (dofFocusTarget - dofFocus) * kFocus;

    const targetBlend = dofActive ? 1 : 0;
    const kBlend = 1 - Math.exp(-9.0 * dt);
    dofBlend += (targetBlend - dofBlend) * kBlend;

    // CoC scale: how many stops of blur at the far plane. Kept modest — a shooter needs the
    // background readable, this is a depth cue and not a portrait lens.
    const coc = 0.55;
    uDofPre.uCoCScale.value = coc;
    uDofComposite.uCoCScale.value = coc;
  }

  /** Last resort: tone map the raw HDR straight to the screen so the game is still playable. */
  function emergencyBlit(g) {
    const hdr = engine.targets && engine.targets.hdr;
    renderer.setRenderTarget(null);
    if (!hdr) {
      if (g && g.scene && g.camera) {
        renderer.autoClear = true;
        renderer.render(g.scene, g.camera);
      }
      return;
    }
    uDebug.tColour.value = hdr.texture;
    uDebug.tDepth.value = hdr.depthTexture || blackTexture;
    uDebug.uMode.value = 0;
    uDebug.uExposure.value = params.exposure;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    fsMesh.material = matDebug;
    renderer.render(fsScene, fsCamera);
    renderer.autoClear = auto;
  }

  // Build once up front so the first frame is not a stall.
  syncSize();
  syncParams();

  return post;
}

/* ========================================================================== */
/* Procedural lens dirt                                                       */
/* ========================================================================== */

/**
 * A real lens is never clean: fingerprints near the edge, dust specks, a couple of hairline
 * scratches. The texture is a *mask on the bloom*, never an overlay, so it only appears when
 * there is something bright enough to scatter — which is exactly how it behaves in a lens.
 */
function createLensDirt(rng) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  // Broad greasy smudges. Elongated, low contrast, clustered off-centre because the middle of
  // an optic gets wiped and the edges do not.
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 46; i++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const r = 26 + rng() * 120;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const a = 0.05 + rng() * 0.16;
    grad.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
    grad.addColorStop(0.55, `rgba(255,255,255,${(a * 0.35).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rng() * Math.PI);
    ctx.scale(1, 0.35 + rng() * 0.5);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }

  // Dust specks. Small, hard, plentiful — this is the high-frequency detail that keeps the
  // dirt from reading as a soft vignette.
  for (let i = 0; i < 900; i++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const r = 0.6 + rng() * rng() * 5.0;
    const a = 0.1 + rng() * 0.65;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hairline scratches, mostly radial as they come from wiping.
  ctx.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const ang = rng() * Math.PI * 2;
    const len = 40 + rng() * 220;
    ctx.strokeStyle = `rgba(255,255,255,${(0.04 + rng() * 0.1).toFixed(3)})`;
    ctx.lineWidth = 0.6 + rng() * 1.8;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    // A slight curve; a perfectly straight line reads as a rendering artefact.
    ctx.quadraticCurveTo(
      cx + Math.cos(ang) * len * 0.5 + (rng() - 0.5) * 30,
      cy + Math.sin(ang) * len * 0.5 + (rng() - 0.5) * 30,
      cx + Math.cos(ang) * len,
      cy + Math.sin(ang) * len
    );
    ctx.stroke();
  }

  // Dirt accumulates toward the barrel edge: darken the centre so the middle of the frame
  // stays clean and the effect never sits on top of the crosshair.
  ctx.globalCompositeOperation = 'multiply';
  const vg = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,1)');
  vg.addColorStop(0.35, 'rgba(90,90,90,1)');
  vg.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  // It is a mask, not colour: no transfer function should be applied on sampling.
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ========================================================================== */
/* Inert fallback                                                             */
/* ========================================================================== */

/** Returned when there is no renderer at all. Never throws, never draws. */
function inertPost() {
  return {
    params: { ...GRADE },
    resize() {},
    setQuality() {},
    jitter() {},
    render() {},
    setDOF() {},
    debugView() {},
    dispose() {},
  };
}

export default createPostFX;
