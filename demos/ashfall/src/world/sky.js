/**
 * Ashfall — sky, sun, atmosphere (ARCHITECTURE.md §3.5).
 *
 * This module owns every photon in the scene. Everything downstream — the CSM cascades, the
 * PBR response of every material, the fog, the god rays, the dust in the air — is derived
 * from two numbers in `art.js`: SUN_ELEVATION and SUN_AZIMUTH. Nothing here hard-codes a
 * "golden hour" look; the golden hour is what 8° of elevation *does* to a spectrum after it
 * has crossed 6.9 air masses of atmosphere.
 *
 * ---------------------------------------------------------------------------------------
 * WHAT IS PHYSICAL AND WHAT IS ART-DIRECTED
 * ---------------------------------------------------------------------------------------
 * Physical:
 *   - Sun direction from elevation/azimuth.
 *   - Sun colour and intensity from Rayleigh + Mie + ozone extinction through a Kasten-Young
 *     air mass. At the art-directed 8° this lands within a few percent of PALETTE.sun on its
 *     own — that is the point of the exercise, and it means `setTimeOfDay` gives a correct
 *     spectrum at any elevation instead of a lerp between two hand-picked swatches.
 *   - Preetham/Perez sky luminance and chromaticity, evaluated per fragment.
 *   - Henyey-Greenstein forward scattering for the aureole, the haze, the clouds and the dust.
 *   - Eddington limb darkening on the solar disc, wavelength dependent.
 *
 * Art-directed (and flagged as such at every site):
 *   - The zenith is re-tinted toward PALETTE.skyZenith. Preetham's zenith chromaticity fit
 *     drifts warm below ~12° solar elevation — a known failure of the model — and a warm
 *     zenith destroys the entire warm-key/cool-shadow split the game is built on.
 *   - The horizon dust band is PALETTE.skyHorizon and is *added* to the model, because the
 *     yard is full of ash and concrete dust that Preetham's clean-air turbidity term does not
 *     describe.
 *
 * ---------------------------------------------------------------------------------------
 * AZIMUTH CONVENTION
 * ---------------------------------------------------------------------------------------
 * `art.js` says "measured from +Z clockwise". That resolves to
 *     dir = (sin(az) * cos(el), sin(el), cos(az) * cos(el))
 * i.e. az 0 -> +Z, az 90 -> +X. At az 252 the sun sits at (-0.94, 0.14, -0.31), which is the
 * direction `VANTAGES.sunline` in main.js is aimed at, and puts the key over the west stacks
 * exactly as §4 describes. Do not "fix" the sign; the whole map is composed around it.
 *
 * ---------------------------------------------------------------------------------------
 * COST
 * ---------------------------------------------------------------------------------------
 * The god-ray occlusion buffer re-renders WORLD-layer geometry with a single black override
 * material at half resolution. That is a second traversal of the world scene and it is the
 * one genuinely expensive thing in this file, which is why it is off at `low`, and why shadow
 * map auto-update is suppressed around it (otherwise every cascade would render twice).
 * Everything else is one sphere, one dome, one Points draw and three full-screen triangles.
 */

import * as THREE from '../../vendor/three.module.js';
import { PALETTE, LIGHTING, ATMOSPHERE, SUN_ELEVATION, SUN_AZIMUTH } from './art.js';

/* ========================================================================== */
/* Module-scope scratch — §6 forbids allocation in the hot path.              */
/* ========================================================================== */

const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _colA = new THREE.Color();
const _colB = new THREE.Color();
const _colC = new THREE.Color();
const _clearSave = new THREE.Color();
const _black = new THREE.Color(0, 0, 0);

const DEG = Math.PI / 180;
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential approach — §1 bans raw `* dt` lerps. */
function approach(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function luminanceOf(c) {
  return c.r * LUMA_R + c.g * LUMA_G + c.b * LUMA_B;
}

/* ========================================================================== */
/* Atmospheric maths (pure, exported so it can be unit-checked)               */
/* ========================================================================== */

/**
 * World-space unit vector pointing *toward* the sun.
 * @param {number} elevDeg  degrees above the horizon
 * @param {number} azDeg    degrees from +Z, clockwise (see the header note)
 */
export function sunDirectionFromAngles(elevDeg, azDeg, out = new THREE.Vector3()) {
  const el = elevDeg * DEG;
  const az = azDeg * DEG;
  const ce = Math.cos(el);
  return out.set(Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce).normalize();
}

/**
 * Kasten-Young (1989) relative air mass. The naive `1/sin(h)` diverges at the horizon and is
 * wrong by 10% by 10°; at 8° — exactly where this game lives — it is unusable. This fit is
 * accurate to ~0.1% down to the horizon, where it saturates near 38 air masses.
 */
export function airMass(elevDeg) {
  const h = Math.max(elevDeg, -1.5);
  const denom = Math.sin(h * DEG) + 0.50572 * Math.pow(h + 6.07995, -1.6364);
  return denom > 1e-4 ? 1 / denom : 40;
}

/**
 * Vertical optical depths at the RGB primaries' effective wavelengths (630 / 532 / 465 nm).
 *
 * Rayleigh: beta_R(lambda) * H_R with H_R = 8 km and Bruneton's sea-level coefficients gives
 * tau_R = (0.046, 0.108, 0.265). Those are the textbook values (tau_R ~ 0.097 at 550 nm).
 *
 * Mie: ash and concrete dust are *coarse* aerosol, so the Angstrom exponent is low (~0.6) and
 * the extinction is nearly grey. That matters: a fine-aerosol exponent of 1.3 would redden the
 * sun far too aggressively and the key light would go tomato at 8°.
 *
 * Ozone: pure absorption in the Chappuis band, i.e. it eats green-yellow. It is what keeps a
 * twilight zenith blue rather than grey, and it is why the shadowed side of the yard stays
 * cool. Its layer sits at 25 km, so its path length saturates far sooner than the troposphere's
 * — hence the separate, gentler air-mass exponent below.
 */
const TAU_RAYLEIGH = [0.0464, 0.1085, 0.2648];
const TAU_OZONE = [0.0043, 0.0121, 0.0006];
/** Angstrom-scaled Mie extinction relative to the 550 nm reference, alpha = 0.6. */
const MIE_SPECTRAL = [0.9217, 1.0201, 1.106];

/**
 * Beam transmittance of the atmosphere toward a sun at `elevDeg`, written into `out` as a
 * linear-space colour. Not normalised — the caller decides whether it wants the spectrum or
 * the irradiance.
 *
 * @param {number} elevDeg
 * @param {number} aerosolTau  Mie vertical optical depth at 550 nm. 0.18 is a hazy industrial
 *                             day with ash in the air; 0.02 is alpine. The yard is not alpine.
 * @param {number} msFill      Fraction of the scattered-out light that multiple scattering and
 *                             the circumsolar aureole return to the beam. Pure single-scatter
 *                             extinction over-reddens badly at high air mass — the eye (and a
 *                             camera) integrates the aureole together with the disc.
 */
/**
 * The fill has to die away again once the beam is nearly gone, or the model produces a grey
 * sun at 2 degrees instead of a red one: below that point the fill floor would exceed the
 * direct transmission in every channel at once. Weighting it by t^0.55 keeps it a *correction*
 * to the beam rather than a replacement for it.
 */
const MS_FILL_EXPONENT = 0.55;

export function atmosphericTransmittance(elevDeg, aerosolTau = 0.18, msFill = 0.37, out = new THREE.Color()) {
  const am = airMass(elevDeg);
  // Ozone lives at 25 km; its slant path grows much more slowly than the troposphere's.
  const amO3 = 1 + (am - 1) * 0.55;
  const ch = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const tau = TAU_RAYLEIGH[i] * am + aerosolTau * MIE_SPECTRAL[i] * am + TAU_OZONE[i] * amO3;
    const t = Math.exp(-tau);
    // Blue is removed most, so blue gets the largest absolute top-up — which is exactly why a
    // low sun is amber rather than the tomato red naive extinction predicts.
    ch[i] = t + msFill * (1 - t) * Math.pow(t, MS_FILL_EXPONENT);
  }
  return out.setRGB(ch[0], ch[1], ch[2], THREE.LinearSRGBColorSpace);
}

/**
 * Perez distribution coefficients for a given turbidity, packed per-channel as
 * (Y, x, y) so the shader can evaluate all three luminance/chromaticity fields with one
 * vectorised expression. Straight from Preetham et al. 1999, table A.2.
 */
export function perezCoefficients(T, out) {
  out.A.set(0.1787 * T - 1.463, -0.0193 * T - 0.2592, -0.0167 * T - 0.2608);
  out.B.set(-0.3554 * T + 0.4275, -0.0665 * T + 0.0008, -0.095 * T + 0.0092);
  out.C.set(-0.0227 * T + 5.3251, -0.0004 * T + 0.2125, -0.0079 * T + 0.2102);
  out.D.set(0.1206 * T - 2.5771, -0.0641 * T - 0.8989, -0.0441 * T - 1.6537);
  out.E.set(-0.067 * T + 0.3703, -0.0033 * T + 0.0452, -0.0109 * T + 0.0529);
  return out;
}

/** Preetham zenith chromaticity (x, y) as a function of solar zenith angle and turbidity. */
export function zenithChromaticity(thetaS, T, out = new THREE.Vector2()) {
  const t2 = thetaS * thetaS;
  const t3 = t2 * thetaS;
  const T2 = T * T;
  const x =
    (0.00166 * t3 - 0.00375 * t2 + 0.00209 * thetaS) * T2 +
    (-0.02903 * t3 + 0.06377 * t2 - 0.03202 * thetaS + 0.00394) * T +
    (0.11693 * t3 - 0.21196 * t2 + 0.06052 * thetaS + 0.25886);
  const y =
    (0.00275 * t3 - 0.0061 * t2 + 0.00317 * thetaS) * T2 +
    (-0.04214 * t3 + 0.0897 * t2 - 0.04153 * thetaS + 0.00516) * T +
    (0.15346 * t3 - 0.26756 * t2 + 0.0667 * thetaS + 0.26688);
  return out.set(x, y);
}

/* ========================================================================== */
/* Shared GLSL                                                                */
/* ========================================================================== */

/**
 * Henyey-Greenstein phase function, normalised over the sphere (the 1/4pi is included so the
 * energy stays comparable when `g` is tweaked from the settings menu).
 */
const GLSL_PHASE = /* glsl */ `
  #define PI 3.14159265359
  float hgPhase(float cosT, float g) {
    float g2 = g * g;
    float d = 1.0 + g2 - 2.0 * g * cosT;
    return (1.0 - g2) / (4.0 * PI * pow(max(d, 1e-4), 1.5));
  }
`;

/** Dave Hoskins' sin-free hash. A sin() hash drifts and banded once cloud time grows large. */
const GLSL_HASH = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
`;

/** CIE XYZ -> linear sRGB. Written as dot products so the column-major trap cannot bite. */
const GLSL_XYZ = /* glsl */ `
  vec3 xyzToLinearRGB(vec3 c) {
    return vec3(
      dot(c, vec3( 3.2404542, -1.5371385, -0.4985314)),
      dot(c, vec3(-0.9692660,  1.8760108,  0.0415560)),
      dot(c, vec3( 0.0556434, -0.2040259,  1.0572252)));
  }
`;

/* ========================================================================== */
/* Sky dome shaders                                                           */
/* ========================================================================== */

const SKY_VERT = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // The dome is re-centred on the camera every frame, so this is the view ray. Doing it
    // from cameraPosition rather than from the raw vertex also keeps the PMREM bake correct, where
    // the dome sits at the origin and the cube camera is at the origin too.
    vWorldDir = wp.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SKY_FRAG = /* glsl */ `
  precision highp float;

  varying vec3 vWorldDir;

  uniform vec3 uSunDir;

  // Perez coefficients, one component per (Y, x, y) field.
  uniform vec3 uPerezA;
  uniform vec3 uPerezB;
  uniform vec3 uPerezC;
  uniform vec3 uPerezD;
  uniform vec3 uPerezE;
  /** (zenith luminance, zenith x, zenith y). */
  uniform vec3 uZenith;
  /** F(theta = 0, gamma = thetaS) per field - the Preetham normaliser. */
  uniform vec3 uPerezDiv;

  uniform vec3 uZenithTint;      // PALETTE.skyZenith, linear
  uniform float uZenithTintAmt;
  uniform vec3 uHazeColour;      // PALETTE.skyHorizon, linear
  uniform vec3 uGroundColour;    // PALETTE.groundBounce, linear
  uniform vec3 uSunTint;         // extinguished sun spectrum, max channel == 1
  uniform vec3 uSunDisc;         // disc radiance, already extinguished
  uniform vec3 uLimbDarkening;   // Eddington u per channel

  uniform float uSunAngularRadius;
  uniform float uPixelAngle;     // radians subtended by one pixel - analytic AA, no fwidth
  uniform float uMieG;
  uniform float uMieStrength;
  uniform float uHazeDensity;
  uniform float uHazeHeight;
  uniform float uHazeLuminance;
  uniform float uBandStrength;
  uniform float uHorizonSoftness;
  uniform float uSkyScale;
  uniform float uSunVisibility;  // 0 once the disc has set, so it cannot glow from below
  uniform float uTime;

  ${GLSL_PHASE}
  ${GLSL_HASH}
  ${GLSL_XYZ}

  vec3 perez(float cosTheta, float gamma, float cosGamma) {
    // exp(B / cosTheta) explodes as the view ray approaches the horizon; Preetham is simply
    // not defined there. Clamping cosTheta to ~0.35 degrees keeps the model finite and the
    // dust-haze layer below covers the last sliver.
    float ct = max(cosTheta, 0.006);
    vec3 t1 = 1.0 + uPerezA * exp(uPerezB / ct);
    vec3 t2 = 1.0 + uPerezC * exp(uPerezD * gamma) + uPerezE * cosGamma * cosGamma;
    return t1 * t2;
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float cosTheta = dir.y;
    float cosGamma = clamp(dot(dir, uSunDir), -1.0, 1.0);
    float gamma = acos(cosGamma);

    /* ---- Preetham luminance + chromaticity ---------------------------- */

    vec3 F = perez(cosTheta, gamma, cosGamma);
    vec3 Yxy = uZenith * F / max(uPerezDiv, vec3(1e-5));

    // The near-sun Perez ratio runs to 20-40x the zenith at this elevation. That is real, but
    // it is also where the fit is least trustworthy, so it is capped before it can produce a
    // white blowout that the tone mapper then has to rescue.
    float Y = min(Yxy.x, uZenith.x * 42.0);
    float cx = Yxy.y;
    float cy = max(Yxy.z, 1e-4);

    vec3 XYZ = vec3(cx / cy * Y, Y, (1.0 - cx - cy) / cy * Y);
    vec3 col = max(xyzToLinearRGB(XYZ), 0.0);

    /* ---- Art-directed zenith correction -------------------------------- */
    // Preetham's zenith chromaticity polynomial was fitted for thetaS < ~75 deg. At the 82 deg
    // this scene lives at it drifts warm, which would collapse the warm-key/cool-shadow split
    // section 4 is built on. Replace the hue, keep the model's luminance, and only up high where the
    // Rayleigh single-scatter blue really should dominate.
    float up = max(dir.y, 0.0);
    float tintW = uZenithTintAmt * smoothstep(0.04, 0.80, up);
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 tinted = uZenithTint * (lum / max(dot(uZenithTint, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
    col = mix(col, tinted, tintW);

    /* ---- Dust haze: an ash layer Preetham knows nothing about ---------- */

    // Aerosol follows an exponential vertical profile, so the slant optical depth through it
    // goes as exp(-altitude / scaleAngle). This is what piles PALETTE.skyHorizon up against
    // the horizon instead of painting a flat gradient.
    float hazeAmt = exp(-up / max(uHazeHeight, 1e-3));

    // Real dusty air is stratified: settled layers of ash sit at slightly different heights
    // and read as horizontal banding. Three incommensurate frequencies in altitude, sheared by
    // a smooth pseudo-azimuth (dot with a fixed vector rather than atan, which has a seam),
    // and drifting slowly so the bands are not frozen.
    float alt = asin(clamp(dir.y, -1.0, 1.0));
    float az = dir.x * 1.9 + dir.z * 1.1;
    float bands =
        sin(alt * 34.0 + az * 0.35 + uTime * 0.021) * 0.50
      + sin(alt * 17.3 - az * 0.62 - uTime * 0.013) * 0.34
      + sin(alt * 71.0 + az * 1.90 + uTime * 0.037) * 0.16;
    hazeAmt *= 1.0 + uBandStrength * bands * exp(-up * 7.0);
    hazeAmt = clamp(hazeAmt * uHazeDensity, 0.0, 1.0);

    // Two-lobe Mie: a broad forward lobe for the general glow and a tight one for the aureole
    // hugging the disc. Real aerosol phase functions are strongly bimodal like this and a
    // single HG lobe reads as a soft airbrushed blob. The tight lobe peaks around 40x the
    // broad one, so it gets the small weight - 0.26 here would clip a 12 degree white hole
    // around the sun once AgX has had it.
    float mie = 0.82 * hgPhase(cosGamma, uMieG) + 0.18 * hgPhase(cosGamma, min(uMieG * 1.24, 0.965));
    vec3 haze = uHazeColour * uHazeLuminance + uSunTint * (uHazeLuminance * uMieStrength * mie * uSunVisibility);

    // Single-scatter composite: the haze attenuates what is behind it and adds its own
    // inscattering. Straight mix() would let the horizon go brighter than physics allows.
    col = col * (1.0 - hazeAmt * 0.88) + haze * hazeAmt;

    /* ---- Below the horizon --------------------------------------------- */
    // The dome is a full sphere; the level floor does not reach the far horizon. Fade into a
    // darker, dirtier version of the haze rather than letting Preetham's clamped horizon
    // colour wrap around underneath, and keep the transition soft so there is no hard line.
    // Written as -dir.y against a positive edge pair: smoothstep with edge0 > edge1 is
    // explicitly undefined in the spec, and some drivers do return garbage for it.
    float below = smoothstep(0.0, uHorizonSoftness, -dir.y);
    vec3 groundHaze = mix(uHazeColour, uGroundColour, 0.62) * uHazeLuminance * (0.34 + 0.5 * mie * uSunVisibility);
    col = mix(col, groundHaze, below);

    /* ---- Solar disc ----------------------------------------------------- */

    float r = gamma / max(uSunAngularRadius, 1e-5);
    // One-pixel-wide analytic edge. fwidth() would need the derivatives extension under
    // ESSL 1.00 and a failed compile means a black sky, so the pixel footprint arrives as a
    // uniform instead.
    float aa = max(uPixelAngle / max(uSunAngularRadius, 1e-5), 1e-3);
    float disc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
    if (disc > 0.0) {
      // Eddington linear limb darkening: I(mu)/I(0) = 1 - u(1 - mu), mu = cos of the angle
      // between the line of sight and the local photosphere normal. u rises toward the blue,
      // so the limb is not just dimmer, it is redder - which at 8 degrees, on top of the
      // atmospheric reddening, is what makes the disc read as a sun rather than a headlamp.
      float rr = min(r, 1.0);
      float mu = sqrt(max(1.0 - rr * rr, 0.0));
      vec3 limb = max(1.0 - uLimbDarkening * (1.0 - mu), 0.0);
      col += uSunDisc * limb * disc * uSunVisibility;
    }

    col *= uSkyScale;

    // A whisper of noise. The half-float target does not band, but TAA plus an 8-bit present
    // will find any perfectly smooth gradient, and the sky is the largest one on screen.
    float d = hash12(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5;
    col *= 1.0 + d * 0.0035;

    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

/* ========================================================================== */
/* Cloud shaders                                                              */
/* ========================================================================== */

const CLOUD_VERT = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldDir = wp.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const CLOUD_FRAG = /* glsl */ `
  precision highp float;

  varying vec3 vWorldDir;

  uniform vec3 uSunDir;
  uniform vec3 uSunColour;      // extinguished key, linear
  uniform vec3 uSkyColour;      // zenith fill
  uniform vec3 uHazeColour;     // aerial perspective target
  uniform vec3 uCloudAlbedo;
  uniform vec2 uCamXZ;
  uniform float uCamY;
  uniform float uCloudHeight;
  uniform float uCloudScale;
  uniform vec2 uCloudDrift;     // metres, advected by the wind
  uniform float uTime;
  uniform float uCoverage;
  uniform float uSoftness;
  uniform float uOpacity;
  uniform float uWarp;
  uniform float uAbsorb;
  uniform float uHazeLuminance;
  uniform float uSunVisibility;
  uniform float uFadeNear;
  uniform float uFadeFar;

  ${GLSL_PHASE}
  ${GLSL_HASH}

  /**
   * Value noise with analytic derivatives (quintic interpolant, so the derivative is C1).
   * The gradient is not a luxury here: rotating it by 90 degrees gives a divergence-free
   * field, and warping the domain by that field is what turns bland fBm blobs into sheared,
   * curled cloud banks for the price of one extra noise evaluation.
   */
  vec3 noised(vec2 x) {
    vec2 p = floor(x);
    vec2 f = fract(x);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    float a = hash12(p);
    float b = hash12(p + vec2(1.0, 0.0));
    float c = hash12(p + vec2(0.0, 1.0));
    float d = hash12(p + vec2(1.0, 1.0));
    float k1 = b - a;
    float k2 = c - a;
    float k3 = a - b - c + d;
    return vec3(
      a + k1 * u.x + k2 * u.y + k3 * u.x * u.y,
      du.x * (k1 + k3 * u.y),
      du.y * (k2 + k3 * u.x));
  }

  // Rotate between octaves so the lattice never lines up into visible grid streaks.
  const mat2 M2 = mat2(0.80, 0.60, -0.60, 0.80);

  // Loop bounds are preprocessor constants, never function parameters: GLSL ES 1.00 requires a
  // constant expression there, so the octave count arrives as a #define and the shadow taps get
  // their own fixed-depth variant.
  float fbmMain(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    float norm = 0.0;
    for (int i = 0; i < CLOUD_OCTAVES; i++) {
      sum += amp * noised(p).x;
      norm += amp;
      p = M2 * p * 2.03;
      amp *= 0.5;
    }
    return sum / max(norm, 1e-4);
  }

  float fbm3(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    float norm = 0.0;
    for (int i = 0; i < 3; i++) {
      sum += amp * noised(p).x;
      norm += amp;
      p = M2 * p * 2.03;
      amp *= 0.5;
    }
    return sum / max(norm, 1e-4);
  }

  /**
   * Three octaves carrying the accumulated gradient. The per-octave frequency factor is
   * deliberately left out of the derivative: this field is only used to warp the domain, and
   * the unweighted sum gives a smoother, lower-frequency swirl than the true gradient would.
   */
  vec3 fbmd3(vec2 p) {
    vec3 sum = vec3(0.0);
    float amp = 0.5;
    float norm = 0.0;
    for (int i = 0; i < 3; i++) {
      sum += amp * noised(p);
      norm += amp;
      p = M2 * p * 2.03;
      amp *= 0.5;
    }
    return sum / max(norm, 1e-4);
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float up = dir.y;

    // Below this the ray-plane intersection distance runs away and the layer is edge-on
    // anyway; fading it out here is what keeps the cloud deck reading as a *ceiling* rather
    // than a texture stuck to a dome.
    float horizonFade = smoothstep(0.010, 0.075, up);
    if (horizonFade <= 0.001) discard;

    // Intersect the view ray with the cloud plane. Doing the perspective properly - rather
    // than UV-mapping a dome - is the single biggest reason this reads as sky and not wallpaper.
    float t = (uCloudHeight - uCamY) / max(up, 1e-3);
    vec2 ground = uCamXZ + dir.xz * t;
    // Subtracting the drift means a given noise feature *moves along* the wind vector, which is
    // the opposite of the naive sign and the difference between clouds blowing west and east.
    vec2 q = (ground - uCloudDrift) * uCloudScale;

    // Distance fade: past this the features are sub-pixel and would alias/crawl under TAA.
    float distFade = 1.0 - smoothstep(uFadeNear, uFadeFar, t);
    if (distFade <= 0.001) discard;

    #if CLOUD_WARP
      // Curl warp. The gradient of a scalar fBm rotated 90 degrees is divergence free, so the
      // domain distortion shears and swirls without pumping density in or out. The slow time
      // offset makes the deck *evolve* rather than slide past as a rigid printed sheet.
      vec3 w = fbmd3(q * 0.62 + vec2(uTime * 0.0035, uTime * -0.0021));
      vec2 curl = vec2(w.z, -w.y);
      q += curl * uWarp;
    #endif

    float dens = fbmMain(q);

    // Coverage threshold. Softness controls the wispiness of the edges; a hard step here is
    // the classic "cotton wool cut out with scissors" tell.
    float cov = smoothstep(uCoverage, uCoverage + uSoftness, dens);
    if (cov <= 0.002) discard;

    /* ---- Lighting ------------------------------------------------------- */

    // The sun is 8 degrees up, so its path through the layer is almost horizontal: the light
    // arrives from *upwind* along the sun's ground track and the undersides are what catch it.
    vec2 toSun = normalize(uSunDir.xz + vec2(1e-4, 0.0));
    float occl = 0.0;
    #if CLOUD_SHADOW_TAPS > 0
      occl += fbm3(q + toSun * 0.30) * 0.6;
    #endif
    #if CLOUD_SHADOW_TAPS > 1
      occl += fbm3(q + toSun * 0.85) * 0.4;
    #endif
    // Beer-Lambert along the light ray, relative to this column's own density so a thin wisp
    // in front of a thick bank still lights up.
    float trans = exp(-uAbsorb * max(occl - dens * 0.35, 0.0) * 4.0);

    float cosGamma = clamp(dot(dir, uSunDir), -1.0, 1.0);
    // Broad forward lobe: the silver lining on the sunward edge of every cloud.
    float phase = 0.55 + 2.2 * hgPhase(cosGamma, 0.62);

    vec3 sunLit = uSunColour * (trans * phase * uSunVisibility);
    // Sky fill is stronger on the upper faces; the ambient gradient is what gives the deck
    // volume without a second scattering pass.
    vec3 ambient = uSkyColour * (0.28 + 0.42 * up);
    vec3 col = uCloudAlbedo * (sunLit + ambient);

    // Aerial perspective. Without this the far clouds stay saturated and the deck looks flat.
    float aerial = 1.0 - exp(-t * 0.00019);
    col = mix(col, uHazeColour * uHazeLuminance, aerial * 0.85);

    float alpha = cov * uOpacity * horizonFade * distFade;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

/* ========================================================================== */
/* Dust mote shaders                                                          */
/* ========================================================================== */

const DUST_VERT = /* glsl */ `
  precision highp float;

  attribute vec4 aMote;     // (radius m, phase, sway rate, brightness)

  uniform vec3 uCamPos;
  uniform vec3 uBox;        // full extent of the wrapping volume, metres
  uniform vec3 uSunDir;
  uniform vec3 uSunColour;
  uniform vec3 uDustColour;
  uniform vec3 uDrift;      // wind displacement, metres
  uniform float uTime;
  uniform float uProjScale; // pixels per metre at one metre
  uniform float uAmbient;
  uniform float uForward;
  uniform float uPhaseG;
  uniform float uSunVisibility;
  uniform float uDensityFade;

  varying vec3 vColour;

  ${GLSL_PHASE}

  void main() {
    // Deliberately not named "half" - that is a reserved word in GLSL ES 1.00 and the whole
    // shader would fail to compile.
    vec3 hb = uBox * 0.5;

    // Brownian sway, applied in the mote's own frame *inside* the wrap so it cannot fight it.
    vec3 sway = vec3(
      sin(uTime * aMote.z + aMote.y),
      sin(uTime * aMote.z * 0.61 + aMote.y * 2.3) * 0.55,
      cos(uTime * aMote.z * 0.83 + aMote.y * 1.7));

    // Toroidal wrap around the camera. GLSL mod() is floor-based, so this is correct for
    // negative operands. Critically the mote holds a *world* position between wraps, which is
    // what makes it parallax against the level instead of swimming with the camera.
    vec3 rel = position + uDrift + sway * 0.35 - uCamPos + hb;
    rel = mod(rel, uBox) - hb;
    vec3 world = uCamPos + rel;

    vec4 mv = viewMatrix * vec4(world, 1.0);
    float dist = max(-mv.z, 1e-3);
    gl_Position = projectionMatrix * mv;

    // Perspective-correct sprite size, clamped so a mote drifting through the near plane
    // cannot become a screen-filling disc.
    gl_PointSize = clamp(uProjScale * aMote.x / dist, 1.0, 18.0);

    /* ---- Lighting ------------------------------------------------------- */

    vec3 vdir = rel / max(length(rel), 1e-4);
    // Ash is a large particle: heavily forward scattering. Motes between the eye and the sun
    // light up hard, motes with the sun behind the eye barely register. That asymmetry is the
    // whole effect - a uniform brightness reads as falling snow.
    float phase = hgPhase(dot(vdir, uSunDir), uPhaseG);
    vec3 lit = uDustColour * uAmbient + uSunColour * (uForward * phase * uSunVisibility);

    // Fade in from the near plane (no giant blobs on the lens) and out at the wrap boundary
    // (no popping as motes teleport across the volume).
    float nearFade = smoothstep(0.30, 1.30, dist);
    float edge = max(max(abs(rel.x) / hb.x, abs(rel.y) / hb.y), abs(rel.z) / hb.z);
    float edgeFade = 1.0 - smoothstep(0.80, 1.0, edge);

    vColour = lit * aMote.w * nearFade * edgeFade * uDensityFade;
  }
`;

const DUST_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColour;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    // Gaussian-ish core. Motes are diffraction-limited points, not billiard balls.
    float a = exp(-r2 * 13.0) * 0.92;
    gl_FragColor = vec4(vColour, a);
  }
`;

/* ========================================================================== */
/* God-ray shaders                                                            */
/* ========================================================================== */

const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SUNPROXY_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uColour;
  void main() {
    vec2 d = (vUv - 0.5) * 2.0;
    float r = length(d);
    // A hot core plus the aureole. The shafts are cast by the *whole* bright region around the
    // sun, not by the 0.53 degree disc, so the proxy is deliberately wider than the disc.
    float core = exp(-r * r * 9.0);
    float halo = exp(-r * r * 2.1) * 0.55;
    float i = (core + halo) * (1.0 - smoothstep(0.82, 1.0, r));
    gl_FragColor = vec4(uColour * i, 1.0);
  }
`;

const GODRAY_FRAG = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D tOcc;
  uniform vec2 uSunUV;
  uniform float uDensity;
  uniform float uDecay;
  uniform float uWeight;
  uniform float uStride;
  uniform float uJitter;
  uniform vec3 uTint;
  uniform float uIntensity;

  ${GLSL_HASH}

  void main() {
    vec2 uv = vUv;
    vec2 delta = (uv - uSunUV) * (uDensity * uStride / float(GR_SAMPLES));

    // Jittering the march start by up to one step converts the ~SAMPLES concentric banding
    // artefacts of a cheap radial blur into noise, which TAA then eats for free.
    uv -= delta * (hash12(gl_FragCoord.xy) * uJitter);

    vec3 acc = vec3(0.0);
    float illum = 1.0;
    for (int i = 0; i < GR_SAMPLES; i++) {
      uv -= delta;
      acc += texture2D(tOcc, uv).rgb * illum;
      illum *= uDecay;
    }

    acc *= uWeight / float(GR_SAMPLES);
    gl_FragColor = vec4(acc * uTint * uIntensity, 1.0);
  }
`;

/* ========================================================================== */
/* Quality presets (ARCHITECTURE.md §5)                                       */
/* ========================================================================== */

const SKY_QUALITY = {
  low: { godray: 0, godraySamples: 10, godrayPasses: 1, cloudOctaves: 3, cloudWarp: 0, cloudShadow: 0, dust: 0.35, domeSeg: [48, 24] },
  medium: { godray: 0.5, godraySamples: 12, godrayPasses: 1, cloudOctaves: 4, cloudWarp: 1, cloudShadow: 1, dust: 0.6, domeSeg: [56, 28] },
  high: { godray: 0.5, godraySamples: 16, godrayPasses: 2, cloudOctaves: 5, cloudWarp: 1, cloudShadow: 2, dust: 1.0, domeSeg: [64, 32] },
  ultra: { godray: 1.0, godraySamples: 24, godrayPasses: 2, cloudOctaves: 6, cloudWarp: 1, cloudShadow: 2, dust: 1.4, domeSeg: [72, 36] },
};

const DEFAULT_QUALITY = 'high';
const DOME_RADIUS = 400;
const CLOUD_DOME_RADIUS = 372;
/** Own layer for the god-ray sun proxy — outside engine.LAYER (0..3) so no camera sees it. */
const GODRAY_LAYER = 6;

/* ========================================================================== */
/* Fog uniform plumbing                                                       */
/* ========================================================================== */

/**
 * `world/materials.js` is authored in parallel with this file, so the exact uniform names it
 * chose for the height-fog hook cannot be known here. Rather than guess once and be wrong,
 * every fog concept carries an alias list and the writer only touches keys that already
 * exist — so a matching name is picked up automatically and a mismatch is inert rather than
 * fatal. `sky.fogUniforms` is the canonical set and is installed on `materials` if it has none.
 */
const FOG_ALIASES = {
  colourNear: ['uFogColourNear', 'uFogColorNear', 'fogColourNear', 'fogColorNear', 'uFogNear', 'uFogNearColour'],
  colourFar: ['uFogColourFar', 'uFogColorFar', 'fogColourFar', 'fogColorFar', 'uFogFar', 'uFogFarColour'],
  density: ['uFogDensity', 'fogDensity', 'uDensity'],
  heightFalloff: ['uFogHeightFalloff', 'fogHeightFalloff', 'uFogFalloff', 'fogFalloff'],
  base: ['uFogBase', 'fogBase', 'uFogHeight', 'fogHeight'],
  inscatter: ['uInscatterStrength', 'inscatterStrength', 'uFogInscatter', 'fogInscatter'],
  anisotropy: ['uInscatterAnisotropy', 'inscatterAnisotropy', 'uFogAnisotropy', 'fogAnisotropy', 'uFogG', 'fogG'],
  sunDir: ['uFogSunDirection', 'uSunDirection', 'fogSunDirection', 'sunDirection', 'uSunDir', 'sunDir'],
  /** Normalised beam hue (max channel 1). This is what an inscattering *tint* wants. */
  sunTint: ['uSunTint', 'sunTint', 'uFogSunTint'],
  /** Full beam radiance (tint * intensity), for hooks that scale by it rather than tint with it. */
  sunColour: ['uFogSunColour', 'uFogSunColor', 'uSunColour', 'uSunColor', 'fogSunColour', 'sunColour'],
  time: ['uFogTime', 'fogTime'],
};

function writeUniform(store, aliases, value) {
  if (!store) return;
  for (let i = 0; i < aliases.length; i++) {
    const slot = store[aliases[i]];
    if (!slot || !('value' in slot)) continue;
    const v = slot.value;
    if (v && v.isColor && value && value.isColor) v.copy(value);
    else if (v && v.isVector3 && value && value.isVector3) v.copy(value);
    else if (typeof value === 'number') slot.value = value;
    else if (value && (value.isColor || value.isVector3)) slot.value = value;
  }
}

/* ========================================================================== */
/* Factory                                                                    */
/* ========================================================================== */

/**
 * @param {object} engine    from core/engine.js
 * @param {object} materials from world/materials.js — receives `.env` and drives `.fogUniforms`
 */
export function createSky(engine, materials) {
  const renderer = engine.renderer;
  const scene = engine.scene;

  let qualityName = SKY_QUALITY[engine.quality] ? engine.quality : DEFAULT_QUALITY;
  let preset = SKY_QUALITY[qualityName];

  const setLayer =
    typeof engine.setLayer === 'function'
      ? engine.setLayer
      : (obj, layer) => {
          obj.layers.set(layer);
        };
  const NOPREPASS = engine.LAYER ? engine.LAYER.NOPREPASS : 2;

  /* --- Live parameters --------------------------------------------------- */

  const params = {
    /** Solar geometry. `setTimeOfDay` writes these; everything else derives from them. */
    elevation: SUN_ELEVATION,
    azimuth: SUN_AZIMUTH,
    timeOfDay: 0.5,

    /**
     * Preetham turbidity. 2.0 is alpine, 6.0 is smog. 3.8 corresponds to the AOD 0.18 the
     * extinction model below is using — keep the two roughly in step or the sky and the key
     * light will disagree about how dirty the air is.
     */
    turbidity: 3.8,
    /** Aerosol vertical optical depth at 550 nm, feeding the extinction model. */
    aerosol: 0.18,
    /** Multiple-scattering / aureole fill fraction — see atmosphericTransmittance(). */
    msFill: 0.37,
    /** Luminance of the zenith in HDR units. Post exposure (GRADE.exposure) does the rest. */
    zenithLuminance: 1.15,
    /** How hard the zenith is pulled to PALETTE.skyZenith. 0 = pure Preetham. */
    zenithTint: 0.72,

    hazeDensity: 0.92,
    /** Angular scale height of the dust layer, in units of sin(altitude). */
    hazeHeight: 0.115,
    hazeLuminance: 1.65,
    /** Amplitude of the horizontal ash strata. Subtle: 0.2 is already visible. */
    bandStrength: 0.16,
    horizonSoftness: 0.055,
    mieG: ATMOSPHERE.inscatterAnisotropy,
    /** Aureole gain. Tuned so the clipped core stays inside ~3 degrees of the disc. */
    mieStrength: 1.3,
    sunDiscIntensity: 300,
    skyScale: 1.0,

    cloudHeight: 180,
    cloudCoverage: 0.46,
    cloudSoftness: 0.30,
    cloudOpacity: 0.86,
    cloudWarp: 0.55,
    cloudAbsorb: 1.35,
    /** Metres per fBm unit. ~760 m puts a cumulus bank in the right size bracket. */
    cloudFeatureSize: 760,
    /** Clouds ride faster than the ground wind. */
    cloudWindScale: 5.5,
    cloudFadeNear: 2600,
    cloudFadeFar: 11000,

    dustDensity: ATMOSPHERE.dustMoteDensity,
    dustAmbient: 0.055,
    dustForward: 0.34,
    dustPhaseG: 0.72,
    dustBox: 30,
    dustBoxY: 15,

    godrayStrength: ATMOSPHERE.godrayStrength,
    godrayDecay: ATMOSPHERE.godrayDecay,
    godrayDensity: ATMOSPHERE.godrayDensity,
    /** Second-pass reach, as a fraction of the first pass's step. Fills the gaps between taps. */
    godrayRefine: 1.45,
    /**
     * Brightness of the occlusion-buffer sun relative to the beam tint. The blur normalises by
     * the sample count, so the shafts land around a third of this; 1.4 gives shafts that read
     * without swamping the yard once postfx applies ATMOSPHERE.godrayStrength on top.
     */
    godrayProxyGain: 1.4,

    envIntensity: LIGHTING.envIntensity,
    /**
     * FogExp2 fallback for materials that do not carry the analytic height-fog hook. Decided
     * automatically below: on when nothing else owns the fog, off when materials.js does.
     */
    sceneFog: true,
  };

  /* --- Derived state (recomputed only when the sun or turbidity moves) ---- */

  const sunDir = new THREE.Vector3();
  const sunTint = new THREE.Color(1, 1, 1); // extinguished spectrum, max channel 1
  const sunRadiance = new THREE.Color(1, 1, 1); // sunTint * intensity, for fog/clouds/dust
  const perez = {
    A: new THREE.Vector3(),
    B: new THREE.Vector3(),
    C: new THREE.Vector3(),
    D: new THREE.Vector3(),
    E: new THREE.Vector3(),
  };
  const perezDiv = new THREE.Vector3();
  const zenithVec = new THREE.Vector3();
  const zenithXY = new THREE.Vector2();

  // Palette anchors, converted from authored sRGB into the linear working space once.
  const colZenith = new THREE.Color().setStyle(PALETTE.skyZenith, THREE.SRGBColorSpace);
  const colHorizon = new THREE.Color().setStyle(PALETTE.skyHorizon, THREE.SRGBColorSpace);
  const colGroundBounce = new THREE.Color().setStyle(PALETTE.groundBounce, THREE.SRGBColorSpace);
  const colSunCore = new THREE.Color().setStyle(PALETTE.sunCore, THREE.SRGBColorSpace);
  const colFogNear = new THREE.Color().setStyle(ATMOSPHERE.fogColourNear, THREE.SRGBColorSpace);
  const colFogFar = new THREE.Color().setStyle(ATMOSPHERE.fogColourFar, THREE.SRGBColorSpace);
  const colDust = new THREE.Color().setStyle(PALETTE.dust, THREE.SRGBColorSpace);
  const colSmoke = new THREE.Color().setStyle(PALETTE.smoke, THREE.SRGBColorSpace);

  /**
   * Normalising constant for the sun's intensity: whatever the extinction model returns at the
   * art-directed elevation *is* LIGHTING.sunIntensity by definition. Every other elevation is
   * then a physically-correct ratio off that anchor, so `setTimeOfDay` cannot break the
   * exposure the grade in art.js was authored against.
   */
  const REFERENCE_IRRADIANCE = (() => {
    atmosphericTransmittance(SUN_ELEVATION, params.aerosol, params.msFill, _colA);
    return Math.max(luminanceOf(_colA), 1e-4);
  })();

  /**
   * Sky brightness vs. solar elevation. Twilight is not "the same sky, dimmer": the zenith is
   * lit by multiply-scattered light and holds up far better than the direct beam, so this curve
   * is much gentler than the extinction curve above. Normalised to 1.0 at the art-directed
   * elevation so `params.zenithLuminance` means exactly what it says at the design point.
   */
  function skyScaleFor(elev) {
    return 0.1 + 0.9 * smoothstep(-7, 30, elev);
  }
  const REFERENCE_SKY_SCALE = Math.max(skyScaleFor(SUN_ELEVATION), 1e-4);

  /**
   * The beam's hue at the design elevation. Fog is tinted by the sun *relative* to this, not
   * absolutely: at 8 degrees the ratio is (1,1,1) and ATMOSPHERE.fogColourNear survives
   * untouched, which is the contract — art.js is the source of truth for the look and this
   * module only says how it changes as the sun moves.
   */
  const REFERENCE_SUN_TINT = (() => {
    atmosphericTransmittance(SUN_ELEVATION, params.aerosol, params.msFill, _colB);
    const m = Math.max(_colB.r, _colB.g, _colB.b, 1e-5);
    return new THREE.Color().setRGB(_colB.r / m, _colB.g / m, _colB.b / m, THREE.LinearSRGBColorSpace);
  })();
  const relativeTint = new THREE.Color(1, 1, 1);

  let sunVisibility = 1;
  let skyBrightnessScale = 1;
  let dirty = true;

  /* --- Lights ------------------------------------------------------------ */

  const sun = new THREE.DirectionalLight(0xffffff, LIGHTING.sunIntensity);
  sun.name = 'sunKey';
  sun.castShadow = true; // shadows.js takes this over and mirrors it onto the cascades
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 200;
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  // HemisphereLight has one intensity but art.js specifies sky and ground separately, so the
  // ground colour carries the ratio. Keeping the sky term as `intensity` means shadows.js and
  // anything else reading LIGHTING.hemiSkyIntensity sees the number it expects.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, LIGHTING.hemiSkyIntensity);
  hemi.name = 'skyFill';
  hemi.color.copy(colZenith);
  hemi.groundColor.copy(colGroundBounce).multiplyScalar(LIGHTING.hemiGroundIntensity / Math.max(LIGHTING.hemiSkyIntensity, 1e-4));
  scene.add(hemi);

  /* --- Sky dome ---------------------------------------------------------- */

  const domeGeometry = new THREE.SphereGeometry(DOME_RADIUS, preset.domeSeg[0], preset.domeSeg[1]);

  const skyUniforms = {
    uSunDir: { value: new THREE.Vector3(0, 0.14, -1) },
    uPerezA: { value: perez.A },
    uPerezB: { value: perez.B },
    uPerezC: { value: perez.C },
    uPerezD: { value: perez.D },
    uPerezE: { value: perez.E },
    uZenith: { value: zenithVec },
    uPerezDiv: { value: perezDiv },
    uZenithTint: { value: colZenith.clone() },
    uZenithTintAmt: { value: params.zenithTint },
    uHazeColour: { value: colHorizon.clone() },
    uGroundColour: { value: colGroundBounce.clone() },
    uSunTint: { value: new THREE.Color(1, 1, 1) },
    uSunDisc: { value: new THREE.Color(1, 1, 1) },
    // Eddington limb-darkening coefficients at 630 / 532 / 465 nm. Blue darkens most because
    // the shorter wavelength's optical depth unity surface sits higher and cooler.
    uLimbDarkening: { value: new THREE.Vector3(0.45, 0.6, 0.72) },
    uSunAngularRadius: { value: LIGHTING.sunAngularDiameter * 0.5 },
    uPixelAngle: { value: 0.001 },
    uMieG: { value: params.mieG },
    uMieStrength: { value: params.mieStrength },
    uHazeDensity: { value: params.hazeDensity },
    uHazeHeight: { value: params.hazeHeight },
    uHazeLuminance: { value: params.hazeLuminance },
    uBandStrength: { value: params.bandStrength },
    uHorizonSoftness: { value: params.horizonSoftness },
    uSkyScale: { value: params.skyScale },
    uSunVisibility: { value: 1 },
    uTime: { value: 0 },
  };

  const domeMaterial = new THREE.ShaderMaterial({
    name: 'AshfallSky',
    uniforms: skyUniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    // Drawn first (renderOrder -1000) and never depth tested: the classic skybox setup, and it
    // sidesteps any depth-precision argument about a 400 m sphere.
    depthTest: false,
    fog: false,
    toneMapped: false,
  });

  const dome = new THREE.Mesh(domeGeometry, domeMaterial);
  dome.name = 'skyDome';
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  dome.matrixAutoUpdate = true;
  setLayer(dome, NOPREPASS);
  scene.add(dome);

  /* --- Cloud deck -------------------------------------------------------- */

  // A shallow cap, not a full sphere: the shader ray-marches to a *plane*, so all the geometry
  // has to do is cover the upper part of the screen and reach slightly below the horizon so
  // the fade has somewhere to happen.
  const cloudGeometry = new THREE.SphereGeometry(CLOUD_DOME_RADIUS, 48, 20, 0, Math.PI * 2, 0, Math.PI * 0.56);

  const windXZ = new THREE.Vector2(ATMOSPHERE.windDirection[0], ATMOSPHERE.windDirection[2]);
  if (windXZ.lengthSq() < 1e-8) windXZ.set(1, 0);
  windXZ.normalize();

  const cloudUniforms = {
    uSunDir: { value: skyUniforms.uSunDir.value },
    uSunColour: { value: new THREE.Color(1, 1, 1) },
    uSkyColour: { value: colZenith.clone() },
    uHazeColour: { value: colHorizon.clone() },
    uCloudAlbedo: { value: colSmoke.clone().lerp(_colA.setRGB(1, 1, 1, THREE.LinearSRGBColorSpace), 0.35) },
    uCamXZ: { value: new THREE.Vector2() },
    uCamY: { value: 0 },
    uCloudHeight: { value: params.cloudHeight },
    uCloudScale: { value: 1 / params.cloudFeatureSize },
    uCloudDrift: { value: new THREE.Vector2() },
    uTime: { value: 0 },
    uCoverage: { value: params.cloudCoverage },
    uSoftness: { value: params.cloudSoftness },
    uOpacity: { value: params.cloudOpacity },
    uWarp: { value: params.cloudWarp },
    uAbsorb: { value: params.cloudAbsorb },
    uHazeLuminance: { value: params.hazeLuminance },
    uSunVisibility: { value: 1 },
    uFadeNear: { value: params.cloudFadeNear },
    uFadeFar: { value: params.cloudFadeFar },
  };

  const cloudMaterial = new THREE.ShaderMaterial({
    name: 'AshfallClouds',
    uniforms: cloudUniforms,
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    defines: {
      CLOUD_OCTAVES: preset.cloudOctaves,
      CLOUD_WARP: preset.cloudWarp,
      CLOUD_SHADOW_TAPS: preset.cloudShadow,
    },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    // Depth *test* stays on so the gantry crane and the water tower occlude the deck properly.
    depthTest: true,
    fog: false,
    toneMapped: false,
  });

  const clouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
  clouds.name = 'cloudDeck';
  clouds.renderOrder = -999;
  clouds.frustumCulled = false;
  setLayer(clouds, NOPREPASS);
  scene.add(clouds);

  /* --- Dust motes -------------------------------------------------------- */

  let dustPoints = null;
  let dustGeometry = null;
  let dustMaterial = null;
  let lastDustDensity = params.dustDensity;

  const dustUniforms = {
    uCamPos: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(params.dustBox, params.dustBoxY, params.dustBox) },
    uSunDir: { value: skyUniforms.uSunDir.value },
    uSunColour: { value: new THREE.Color(1, 1, 1) },
    uDustColour: { value: colDust.clone() },
    uDrift: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uProjScale: { value: 600 },
    uAmbient: { value: params.dustAmbient },
    uForward: { value: params.dustForward },
    uPhaseG: { value: params.dustPhaseG },
    uSunVisibility: { value: 1 },
    uDensityFade: { value: 1 },
  };

  function buildDust() {
    disposeDust();
    lastDustDensity = params.dustDensity;

    const target = Math.round(4200 * clamp(params.dustDensity, 0, 4) * preset.dust);
    const count = clamp(target, 0, 20000);
    if (count <= 0) return;

    const positions = new Float32Array(count * 3);
    const motes = new Float32Array(count * 4);
    const bx = params.dustBox;
    const by = params.dustBoxY;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const i4 = i * 4;
      positions[i3] = (Math.random() - 0.5) * bx;
      // Biased low: ash settles. Squaring a uniform pushes the distribution toward the floor,
      // which is also where the player's eye spends most of its time.
      positions[i3 + 1] = Math.pow(Math.random(), 1.7) * by - by * 0.18;
      positions[i3 + 2] = (Math.random() - 0.5) * bx;

      // Physical radius in metres. A wide spread matters more than the mean: a field of
      // identically sized motes reads as a particle system, a power-law spread reads as dust.
      const r = 0.004 + Math.pow(Math.random(), 3.0) * 0.030;
      motes[i4] = r;
      motes[i4 + 1] = Math.random() * 6.2831853;
      motes[i4 + 2] = 0.25 + Math.random() * 0.9;
      // Brightness correlates with size (bigger particle, more cross-section) but not exactly.
      motes[i4 + 3] = (0.35 + Math.random() * 0.65) * (0.5 + r * 22.0);
    }

    dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    dustGeometry.setAttribute('aMote', new THREE.BufferAttribute(motes, 4));
    // The wrap moves points far outside their authored bounds; culling would blink them out.
    dustGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    dustMaterial = new THREE.ShaderMaterial({
      name: 'AshfallDust',
      uniforms: dustUniforms,
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });

    dustPoints = new THREE.Points(dustGeometry, dustMaterial);
    dustPoints.name = 'dustMotes';
    dustPoints.frustumCulled = false;
    dustPoints.renderOrder = 12;
    setLayer(dustPoints, NOPREPASS);
    scene.add(dustPoints);
  }

  function disposeDust() {
    if (dustPoints) scene.remove(dustPoints);
    if (dustGeometry) dustGeometry.dispose();
    if (dustMaterial) dustMaterial.dispose();
    dustPoints = null;
    dustGeometry = null;
    dustMaterial = null;
  }

  buildDust();

  /* --- Full-screen pass plumbing ---------------------------------------- */

  // One oversized triangle, not two triangles: no diagonal seam, no redundant quad helper
  // invocations along it.
  const fsGeometry = new THREE.BufferGeometry();
  fsGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  fsGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  fsGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const fsMesh = new THREE.Mesh(fsGeometry, null);
  fsMesh.frustumCulled = false;
  const fsScene = new THREE.Scene();
  fsScene.add(fsMesh);
  const fsCamera = new THREE.Camera();

  function blit(material, target) {
    fsMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(fsScene, fsCamera);
  }

  /* --- God rays ---------------------------------------------------------- */

  const rtType = engine.hdrAvailable ? THREE.HalfFloatType : THREE.UnsignedByteType;

  function makeRT(w, h, depth) {
    const rt = new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
      type: rtType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: !!depth,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    rt.texture.generateMipmaps = false;
    return rt;
  }

  const godray = {
    enabled: preset.godray > 0,
    scale: preset.godray || 0.5,
    occRT: null,
    blurA: null,
    blurB: null,
    fade: 0,
    fadeTarget: 0,
    w: 0,
    h: 0,
  };

  const occMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, toneMapped: false });
  occMaterial.name = 'godrayOcclude';

  const sunProxyUniforms = { uColour: { value: new THREE.Color(1, 1, 1) } };
  const sunProxyMaterial = new THREE.ShaderMaterial({
    name: 'godraySunProxy',
    uniforms: sunProxyUniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: SUNPROXY_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true, // so the crane, the water tower and every container edge cut the shafts
    fog: false,
    toneMapped: false,
  });

  /** Proxy angular radius ~0.8 deg — the disc plus its aureole, which is what casts shafts. */
  const SUN_PROXY_DISTANCE = 320;
  const SUN_PROXY_SIZE = 2 * SUN_PROXY_DISTANCE * Math.tan(0.9 * DEG);
  const sunProxyGeometry = new THREE.PlaneGeometry(SUN_PROXY_SIZE, SUN_PROXY_SIZE);
  const sunProxy = new THREE.Mesh(sunProxyGeometry, sunProxyMaterial);
  sunProxy.name = 'godraySun';
  sunProxy.layers.set(GODRAY_LAYER);
  // Its own scene: rendering it needs a second renderer.render() into the same target, and a
  // one-object scene avoids re-traversing the whole world graph to find it.
  const proxyScene = new THREE.Scene();
  proxyScene.add(sunProxy);

  const godrayUniforms = {
    tOcc: { value: null },
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
    uDensity: { value: params.godrayDensity },
    uDecay: { value: params.godrayDecay },
    uWeight: { value: 1.0 },
    uStride: { value: 1.0 },
    uJitter: { value: 1.0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uIntensity: { value: 0 },
  };

  const godrayMaterial = new THREE.ShaderMaterial({
    name: 'AshfallGodrays',
    uniforms: godrayUniforms,
    vertexShader: FS_VERT,
    fragmentShader: GODRAY_FRAG,
    defines: { GR_SAMPLES: preset.godraySamples },
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });

  function allocateGodrayTargets() {
    if (!godray.enabled) {
      releaseGodrayTargets();
      return;
    }
    const w = Math.max(2, Math.round(engine.size.w * godray.scale));
    const h = Math.max(2, Math.round(engine.size.h * godray.scale));
    if (godray.occRT && godray.w === w && godray.h === h) return;
    releaseGodrayTargets();
    godray.occRT = makeRT(w, h, true);
    godray.blurA = makeRT(w, h, false);
    godray.blurB = makeRT(w, h, false);
    godray.w = w;
    godray.h = h;
  }

  function releaseGodrayTargets() {
    if (godray.occRT) godray.occRT.dispose();
    if (godray.blurA) godray.blurA.dispose();
    if (godray.blurB) godray.blurB.dispose();
    godray.occRT = godray.blurA = godray.blurB = null;
    godray.w = godray.h = 0;
  }

  allocateGodrayTargets();

  const removeResize =
    typeof engine.addResizeListener === 'function' ? engine.addResizeListener(() => allocateGodrayTargets()) : null;

  /* --- Fog --------------------------------------------------------------- */

  /**
   * The canonical height-fog uniform set. `materials.js` should reference these (or names in
   * FOG_ALIASES) from its `onBeforeCompile` hook so every world surface inscatters against the
   * same air the sky, the clouds and the dust are using.
   */
  const fogUniforms = {
    uFogColourNear: { value: colFogNear.clone() },
    uFogColourFar: { value: colFogFar.clone() },
    uFogDensity: { value: ATMOSPHERE.fogDensity },
    uFogHeightFalloff: { value: ATMOSPHERE.fogHeightFalloff },
    uFogBase: { value: ATMOSPHERE.fogBase },
    uInscatterStrength: { value: ATMOSPHERE.inscatterStrength },
    uInscatterAnisotropy: { value: ATMOSPHERE.inscatterAnisotropy },
    uSunDirection: { value: new THREE.Vector3(0, 0.14, -1) },
    /** Normalised beam hue, for tinting inscatter. */
    uSunTint: { value: new THREE.Color(1, 1, 1) },
    /** Beam radiance (tint * intensity), for anything that needs absolute energy. */
    uSunColour: { value: new THREE.Color(1, 1, 1) },
    uFogTime: { value: 0 },
  };

  const materialsOwnFog = !!(materials && materials.fogUniforms);
  if (materials && !materials.fogUniforms) materials.fogUniforms = fogUniforms;

  // §3.5 wants a matching scene.fog as well, for anything that never routes through the
  // materials hook (Three's own line/sprite materials, a debug helper, a module that forgot).
  // It is the same air, expressed in the one knob FogExp2 has.
  //
  // But three applies scene.fog to every material whose `fog` flag is true, and the analytic
  // height fog in materials.js is appended *after* that chunk on exactly those materials. With
  // both live the whole yard is fogged twice. So the fallback auto-disarms when materials.js
  // has published its own uniform block: whoever owns the fog owns it alone.
  // Flip `sky.params.sceneFog` at any time to override this decision.
  const sceneFog = new THREE.FogExp2(0x000000, ATMOSPHERE.fogDensity);
  sceneFog.color.copy(colFogNear).lerp(colFogFar, 0.45);
  params.sceneFog = !materialsOwnFog;
  if (params.sceneFog) scene.fog = sceneFog;

  /* --- PMREM environment ------------------------------------------------- */

  let pmrem = null;
  let envRT = null;
  let envScene = null;
  let envDome = null;
  let envClouds = null;

  function buildEnvironment() {
    // Degrade, never throw (§5): PMREM wants half-float render targets and a working blur
    // chain. On hardware that cannot provide them the scene simply keeps its analytic
    // hemisphere fill and the metals go a little flat.
    try {
      if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
      if (!envScene) {
        envScene = new THREE.Scene();
        // Separate meshes sharing the dome's geometry and material: the world dome rides the
        // camera, but PMREM renders a cube from the origin and needs the dome centred there.
        envDome = new THREE.Mesh(domeGeometry, domeMaterial);
        envDome.frustumCulled = false;
        envDome.renderOrder = -1000;
        envScene.add(envDome);
        envClouds = new THREE.Mesh(cloudGeometry, cloudMaterial);
        envClouds.frustumCulled = false;
        envClouds.renderOrder = -999;
        envScene.add(envClouds);
      }

      const prevTarget = renderer.getRenderTarget();
      const prevAutoClear = renderer.autoClear;
      renderer.getClearColor(_clearSave);
      const prevAlpha = renderer.getClearAlpha();

      const next = pmrem.fromScene(envScene, 0, 1, DOME_RADIUS * 2.5);

      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
      renderer.setClearColor(_clearSave, prevAlpha);

      if (envRT) envRT.dispose();
      envRT = next;

      scene.environment = envRT.texture;
      scene.environmentIntensity = params.envIntensity;
      if (materials) {
        materials.env = envRT.texture;
        if (typeof materials.setEnvironment === 'function') materials.setEnvironment(envRT.texture);
      }
    } catch (err) {
      // Deliberate: a missing IBL is a look regression, not a crash. Surfaced once.
      if (engine.debug) console.warn('[ashfall] sky: PMREM unavailable, running without IBL', err);
      scene.environment = null;
    }
  }

  /* ====================================================================== */
  /* Solar / atmospheric recompute                                           */
  /* ====================================================================== */

  function recompute() {
    dirty = false;

    const elev = params.elevation;
    sunDirectionFromAngles(elev, params.azimuth, sunDir);

    /* ---- Sun spectrum and irradiance ---------------------------------- */

    atmosphericTransmittance(elev, params.aerosol, params.msFill, _colA);

    // Below the horizon the direct beam is gone. Two degrees of civil twilight is enough of a
    // ramp that setTimeOfDay never snaps the key light off.
    sunVisibility = smoothstep(-2.2, 1.2, elev);

    const maxCh = Math.max(_colA.r, _colA.g, _colA.b, 1e-5);
    sunTint.setRGB(_colA.r / maxCh, _colA.g / maxCh, _colA.b / maxCh, THREE.LinearSRGBColorSpace);

    // Intensity carries the beam's luminance, colour carries its hue, so that at the design
    // elevation the pair is exactly (PALETTE.sun, LIGHTING.sunIntensity) and any other
    // elevation is a physically-derived ratio off it.
    const irradiance = luminanceOf(_colA);
    const intensity = LIGHTING.sunIntensity * (irradiance / REFERENCE_IRRADIANCE) * sunVisibility;

    sun.color.copy(sunTint);
    sun.intensity = Math.max(intensity, 0);
    sunRadiance.copy(sunTint).multiplyScalar(sun.intensity);

    // shadows.js reads position - target, so the distance only has to clear the map.
    sun.position.copy(sunDir).multiplyScalar(180);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();

    /* ---- Sky brightness follows the sun ------------------------------- */

    skyBrightnessScale = skyScaleFor(elev) / REFERENCE_SKY_SCALE;

    /* ---- Preetham ----------------------------------------------------- */

    const T = clamp(params.turbidity, 1.8, 10.0);
    perezCoefficients(T, perez);

    const thetaS = Math.acos(clamp(sunDir.y, -1, 1));
    // Preetham's zenith-chromaticity fit is only sane above the horizon; clamping the angle
    // rather than letting it run past pi/2 keeps the polynomials from diverging at night.
    zenithChromaticity(Math.min(thetaS, Math.PI * 0.5 - 0.001), T, zenithXY);

    zenithVec.set(params.zenithLuminance * skyBrightnessScale, zenithXY.x, zenithXY.y);

    // F(theta=0, gamma=thetaS): cos(theta) = 1, so exp(B / cos) = exp(B).
    const cosThetaS = Math.cos(thetaS);
    perezDiv.set(
      (1 + perez.A.x * Math.exp(perez.B.x)) * (1 + perez.C.x * Math.exp(perez.D.x * thetaS) + perez.E.x * cosThetaS * cosThetaS),
      (1 + perez.A.y * Math.exp(perez.B.y)) * (1 + perez.C.y * Math.exp(perez.D.y * thetaS) + perez.E.y * cosThetaS * cosThetaS),
      (1 + perez.A.z * Math.exp(perez.B.z)) * (1 + perez.C.z * Math.exp(perez.D.z * thetaS) + perez.E.z * cosThetaS * cosThetaS)
    );

    /* ---- Uniforms ------------------------------------------------------ */

    skyUniforms.uSunDir.value.copy(sunDir);
    skyUniforms.uSunTint.value.copy(sunTint);
    // The disc is the photosphere seen through the same air the light came through: its own
    // hot white multiplied by the beam transmittance, so it reddens as it sets without anyone
    // authoring a "sunset disc colour".
    skyUniforms.uSunDisc.value
      .copy(colSunCore)
      .multiply(_colA)
      .multiplyScalar(params.sunDiscIntensity * skyBrightnessScale);
    skyUniforms.uSunVisibility.value = sunVisibility;
    skyUniforms.uZenithTintAmt.value = params.zenithTint;
    skyUniforms.uMieG.value = params.mieG;
    skyUniforms.uMieStrength.value = params.mieStrength;
    skyUniforms.uHazeDensity.value = params.hazeDensity;
    skyUniforms.uHazeHeight.value = params.hazeHeight;
    skyUniforms.uHazeLuminance.value = params.hazeLuminance * skyBrightnessScale;
    skyUniforms.uBandStrength.value = params.bandStrength;
    skyUniforms.uHorizonSoftness.value = params.horizonSoftness;
    skyUniforms.uSkyScale.value = params.skyScale;
    skyUniforms.uSunAngularRadius.value = Math.max(LIGHTING.sunAngularDiameter * 0.5, 1e-5);

    cloudUniforms.uSunColour.value.copy(sunRadiance).multiplyScalar(0.42);
    cloudUniforms.uSkyColour.value.copy(colZenith).multiplyScalar(params.zenithLuminance * skyBrightnessScale * 0.9);
    cloudUniforms.uHazeLuminance.value = params.hazeLuminance * skyBrightnessScale;
    cloudUniforms.uSunVisibility.value = sunVisibility;
    cloudUniforms.uCloudHeight.value = params.cloudHeight;
    cloudUniforms.uCloudScale.value = 1 / Math.max(params.cloudFeatureSize, 1);
    cloudUniforms.uCoverage.value = params.cloudCoverage;
    cloudUniforms.uSoftness.value = Math.max(params.cloudSoftness, 1e-3);
    cloudUniforms.uOpacity.value = params.cloudOpacity;
    cloudUniforms.uWarp.value = params.cloudWarp;
    cloudUniforms.uAbsorb.value = params.cloudAbsorb;
    cloudUniforms.uFadeNear.value = params.cloudFadeNear;
    cloudUniforms.uFadeFar.value = params.cloudFadeFar;

    // Motes are lit by the direct beam only; the ambient term is their share of the sky.
    dustUniforms.uSunColour.value.copy(sunRadiance).multiplyScalar(0.30);
    dustUniforms.uSunVisibility.value = sunVisibility;
    dustUniforms.uAmbient.value = params.dustAmbient * (0.35 + 0.65 * skyBrightnessScale);
    dustUniforms.uForward.value = params.dustForward;
    dustUniforms.uPhaseG.value = params.dustPhaseG;
    dustUniforms.uBox.value.set(params.dustBox, params.dustBoxY, params.dustBox);

    // God rays inherit the beam colour so the shafts are the same amber as the key.
    godrayUniforms.uTint.value.copy(sunTint);
    sunProxyUniforms.uColour.value.copy(sunTint).multiplyScalar(params.godrayProxyGain);

    // Hemisphere fill tracks the sky's brightness so the shadows do not stay bright at night.
    hemi.intensity = LIGHTING.hemiSkyIntensity * (0.18 + 0.82 * skyBrightnessScale);

    /* ---- Fog ------------------------------------------------------------ */

    // The fog is lit by the same beam, so its near colour follows the sun as the day moves.
    // Relative to the design point, though — at SUN_ELEVATION this collapses to exactly the
    // colours authored in art.js, which stays the single source of truth for the look.
    relativeTint.setRGB(
      clamp(sunTint.r / Math.max(REFERENCE_SUN_TINT.r, 1e-4), 0.4, 2.2),
      clamp(sunTint.g / Math.max(REFERENCE_SUN_TINT.g, 1e-4), 0.4, 2.2),
      clamp(sunTint.b / Math.max(REFERENCE_SUN_TINT.b, 1e-4), 0.4, 2.2),
      THREE.LinearSRGBColorSpace
    );
    _colB.copy(colFogNear).lerp(_colC.copy(colFogNear).multiply(relativeTint), 0.65 * sunVisibility);
    fogUniforms.uFogColourNear.value.copy(_colB).multiplyScalar(0.35 + 0.65 * skyBrightnessScale);
    fogUniforms.uFogColourFar.value.copy(colFogFar).multiplyScalar(0.30 + 0.70 * skyBrightnessScale);
    fogUniforms.uSunDirection.value.copy(sunDir);
    // Tint is normalised; colour carries the energy. materials.js adds its inscatter term as
    // tint * strength * phase, so handing it a 4.6x radiance there would blow the fog out.
    fogUniforms.uSunTint.value.copy(sunTint).multiplyScalar(sunVisibility);
    fogUniforms.uSunColour.value.copy(sunRadiance);

    sceneFog.color.copy(fogUniforms.uFogColourNear.value).lerp(fogUniforms.uFogColourFar.value, 0.45);
  }

  recompute();
  buildEnvironment();

  /* ====================================================================== */
  /* God-ray pass                                                            */
  /* ====================================================================== */

  const sunUV = new THREE.Vector2(0.5, 0.5);

  function updateGodrays(dt, game, camera) {
    if (!godray.enabled || !godray.occRT) {
      sky.godrayTexture = null;
      return;
    }

    /* ---- Where is the sun on screen, and should the effect exist? ------ */

    // sky.update runs before engine.renderScene, so the camera's derived matrices still hold
    // last frame's pose. Project() needs both of these current or the sun's screen position —
    // and therefore every shaft in the frame — lags the camera by one frame while turning.
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    _v3a.copy(camera.position).addScaledVector(sunDir, 1000);
    _v3a.project(camera);
    sunUV.set(_v3a.x * 0.5 + 0.5, _v3a.y * 0.5 + 0.5);

    camera.getWorldDirection(_v3b);
    const facing = _v3b.dot(sunDir);

    // Three independent reasons the effect must not exist, each with its own soft ramp. The
    // `facing` gate also guards the projection above, which flips sign behind the eye.
    const faceFade = smoothstep(0.02, 0.40, facing);
    const dx = Math.max(0, Math.abs(sunUV.x - 0.5) - 0.5);
    const dy = Math.max(0, Math.abs(sunUV.y - 0.5) - 0.5);
    const screenFade = 1 - smoothstep(0.0, 0.42, Math.sqrt(dx * dx + dy * dy));
    const elevFade = smoothstep(-1.5, 3.0, params.elevation);

    godray.fadeTarget = faceFade * screenFade * elevFade;
    // One more temporal smoothing pass on top of the analytic ramps. Turning quickly past the
    // sun must never produce a step, and a hard pop here is the single most obvious failure.
    godray.fade = approach(godray.fade, godray.fadeTarget, 9.0, Math.max(dt, 1e-4));

    if (godray.fade <= 0.0015 && godray.fadeTarget <= 0.0015) {
      sky.godrayTexture = null;
      return;
    }

    /* ---- Sun proxy pose ------------------------------------------------ */

    sunProxy.position.copy(camera.position).addScaledVector(sunDir, SUN_PROXY_DISTANCE);
    sunProxy.quaternion.copy(camera.quaternion); // billboard
    sunProxy.updateMatrixWorld();

    /* ---- Save renderer / scene state ----------------------------------- */

    const worldScene = (game && game.scene) || scene;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevOverride = worldScene.overrideMaterial;
    const prevBackground = worldScene.background;
    const prevFog = worldScene.fog;
    const prevMask = camera.layers.mask;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevShadowNeeds = renderer.shadowMap.needsUpdate;
    renderer.getClearColor(_clearSave);
    const prevClearAlpha = renderer.getClearAlpha();

    // Without this every cascade renders twice per frame — the occlusion pass would silently
    // double the most expensive thing in the engine.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.autoClear = false;

    /* ---- 1. silhouettes ------------------------------------------------- */

    worldScene.overrideMaterial = occMaterial;
    worldScene.background = null;
    worldScene.fog = null; // fogged black is grey, and grey silhouettes leak light through walls
    // WORLD layer only: transparent glass, tarps, particles, decals and the sky dome all live
    // on NOPREPASS/DECAL and none of them should be casting a hard shadow shaft.
    camera.layers.mask = 1 << (engine.LAYER ? engine.LAYER.WORLD : 0);
    camera.updateMatrixWorld();

    renderer.setRenderTarget(godray.occRT);
    renderer.setClearColor(_black, 1);
    renderer.clear(true, true, false);
    renderer.render(worldScene, camera);

    worldScene.overrideMaterial = prevOverride;
    worldScene.background = prevBackground;
    worldScene.fog = prevFog;

    /* ---- 2. the light source itself, depth tested against those ---------- */

    camera.layers.mask = 1 << GODRAY_LAYER;
    renderer.render(proxyScene, camera);
    camera.layers.mask = prevMask;

    /* ---- 3. radial blur ------------------------------------------------- */

    godrayUniforms.uDensity.value = params.godrayDensity;
    godrayUniforms.uDecay.value = clamp(params.godrayDecay, 0.5, 0.9999);
    godrayUniforms.uSunUV.value.copy(sunUV);
    godrayUniforms.uTint.value.copy(sunTint);

    // Pass 1: full reach, coarse, jittered.
    godrayUniforms.tOcc.value = godray.occRT.texture;
    godrayUniforms.uStride.value = 1.0;
    godrayUniforms.uJitter.value = 1.0;
    godrayUniforms.uWeight.value = 1.0;
    // postfx multiplies by ATMOSPHERE.godrayStrength itself, so only the fade belongs here.
    godrayUniforms.uIntensity.value = preset.godrayPasses > 1 ? 1.0 : godray.fade;
    blit(godrayMaterial, preset.godrayPasses > 1 ? godray.blurA : godray.blurB);

    if (preset.godrayPasses > 1) {
      // Pass 2: short reach, no jitter. Its whole job is to fill the gaps between pass 1's
      // taps, which is what turns N samples into an effectively N-squared-quality sweep.
      godrayUniforms.tOcc.value = godray.blurA.texture;
      godrayUniforms.uStride.value = params.godrayRefine / preset.godraySamples;
      godrayUniforms.uJitter.value = 0.0;
      // Decay compounds across the two passes; the short pass gets the per-step root so the
      // total falloff still matches ATMOSPHERE.godrayDecay.
      godrayUniforms.uDecay.value = Math.pow(clamp(params.godrayDecay, 0.5, 0.9999), 1 / preset.godraySamples);
      godrayUniforms.uIntensity.value = godray.fade;
      blit(godrayMaterial, godray.blurB);
    }

    /* ---- Restore -------------------------------------------------------- */

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(_clearSave, prevClearAlpha);
    renderer.autoClear = prevAutoClear;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.shadowMap.needsUpdate = prevShadowNeeds;

    sky.godrayTexture = godray.blurB.texture;
  }

  /* ====================================================================== */
  /* Frame                                                                   */
  /* ====================================================================== */

  let time = 0;
  let cloudTime = 0;
  const cloudDrift = new THREE.Vector2();
  const dustDrift = new THREE.Vector3();

  function update(dt, game) {
    const d = Math.min(Math.max(dt || 0, 0), 0.05);
    time += d;
    if (dirty) recompute();

    const camera = (game && game.camera) || engine.camera;

    /* ---- Keep the sky centred on the eye ------------------------------- */

    dome.position.copy(camera.position);
    clouds.position.copy(camera.position);

    /* ---- Analytic AA width for the solar disc -------------------------- */

    // Radians per pixel of buffer height. The disc is ~8 px across at 1080p, so a fixed
    // smoothstep width would either alias it or blur it into a smudge.
    const fovRad = (camera.fov || 75) * DEG;
    const bufferH = Math.max(engine.size.h || 1080, 1);
    skyUniforms.uPixelAngle.value = (2 * Math.tan(fovRad * 0.5)) / bufferH;
    // Wrapped: the dither term takes fract() of this, and after an hour of play an unwrapped
    // accumulator has lost enough mantissa that the noise pattern freezes.
    skyUniforms.uTime.value = time % 8192;

    /* ---- Clouds -------------------------------------------------------- */

    // Clouds ride well above the ground wind. Drift is kept in metres and wrapped so the noise
    // domain never grows large enough to lose float precision in the hash.
    cloudTime += d;
    const cloudSpeed = ATMOSPHERE.windSpeed * params.cloudWindScale;
    cloudDrift.x = (cloudDrift.x + windXZ.x * cloudSpeed * d) % 262144;
    cloudDrift.y = (cloudDrift.y + windXZ.y * cloudSpeed * d) % 262144;
    cloudUniforms.uCloudDrift.value.copy(cloudDrift);
    cloudUniforms.uCamXZ.value.set(camera.position.x, camera.position.z);
    cloudUniforms.uCamY.value = camera.position.y;
    cloudUniforms.uTime.value = cloudTime % 8192;

    /* ---- Dust ----------------------------------------------------------- */

    if (dustPoints) {
      // Ground-level wind: heavily slowed by the yard's clutter, and with a slow settling term
      // so motes drift *and* fall rather than sliding sideways like snow. The modulo keeps the
      // drift bounded so the hash in the vertex path never loses float precision.
      const gust = ATMOSPHERE.windSpeed * 0.16;
      dustDrift.x = (dustDrift.x + ATMOSPHERE.windDirection[0] * gust * d) % 4096;
      dustDrift.y = (dustDrift.y + (ATMOSPHERE.windDirection[1] * gust - 0.035) * d) % 4096;
      dustDrift.z = (dustDrift.z + ATMOSPHERE.windDirection[2] * gust * d) % 4096;
      dustUniforms.uDrift.value.copy(dustDrift);
      dustUniforms.uCamPos.value.copy(camera.position);
      dustUniforms.uTime.value = time % 8192;
      // Pixels per metre at one metre — the sprite size term. Recomputed each frame because
      // ADS pulls the world FOV from 75 to 58 and the motes must not change apparent size.
      dustUniforms.uProjScale.value = bufferH / (2 * Math.tan(fovRad * 0.5));
    }

    /* ---- Fog ------------------------------------------------------------ */

    fogUniforms.uFogDensity.value = ATMOSPHERE.fogDensity;
    fogUniforms.uFogHeightFalloff.value = ATMOSPHERE.fogHeightFalloff;
    fogUniforms.uFogBase.value = ATMOSPHERE.fogBase;
    fogUniforms.uInscatterStrength.value = ATMOSPHERE.inscatterStrength;
    fogUniforms.uInscatterAnisotropy.value = ATMOSPHERE.inscatterAnisotropy;
    fogUniforms.uFogTime.value = time;

    const target = materials && materials.fogUniforms;
    if (target && target !== fogUniforms) {
      writeUniform(target, FOG_ALIASES.colourNear, fogUniforms.uFogColourNear.value);
      writeUniform(target, FOG_ALIASES.colourFar, fogUniforms.uFogColourFar.value);
      writeUniform(target, FOG_ALIASES.density, fogUniforms.uFogDensity.value);
      writeUniform(target, FOG_ALIASES.heightFalloff, fogUniforms.uFogHeightFalloff.value);
      writeUniform(target, FOG_ALIASES.base, fogUniforms.uFogBase.value);
      writeUniform(target, FOG_ALIASES.inscatter, fogUniforms.uInscatterStrength.value);
      writeUniform(target, FOG_ALIASES.anisotropy, fogUniforms.uInscatterAnisotropy.value);
      writeUniform(target, FOG_ALIASES.sunDir, fogUniforms.uSunDirection.value);
      writeUniform(target, FOG_ALIASES.sunTint, fogUniforms.uSunTint.value);
      writeUniform(target, FOG_ALIASES.sunColour, fogUniforms.uSunColour.value);
      writeUniform(target, FOG_ALIASES.time, fogUniforms.uFogTime.value);
    }

    if (params.sceneFog) {
      // FogExp2 has no height term, so evaluate the height profile at the eye and hand it the
      // equivalent uniform density. Walking up the admin block stairwell genuinely thins it.
      const camY = camera.position.y - ATMOSPHERE.fogBase;
      sceneFog.density = ATMOSPHERE.fogDensity * Math.exp(-ATMOSPHERE.fogHeightFalloff * Math.max(camY, 0));
      if (scene.fog !== sceneFog) scene.fog = sceneFog;
    } else if (scene.fog === sceneFog) {
      scene.fog = null;
    }

    if (scene.environmentIntensity !== params.envIntensity) {
      scene.environmentIntensity = params.envIntensity;
    }

    /* ---- God rays -------------------------------------------------------- */

    updateGodrays(d, game, camera);
  }

  /* ====================================================================== */
  /* Public API                                                              */
  /* ====================================================================== */

  /**
   * Remap a 0..1 settings slider onto a solar elevation.
   *
   * 0.5 lands exactly on SUN_ELEVATION so the default is bit-identical to the art direction.
   * The lower half runs down into civil twilight; the upper half is eased with a smoothstep so
   * most of the slider's travel is spent in the low, raking angles this map was composed for
   * rather than racing to a flat noon.
   */
  function setTimeOfDay(t01) {
    const t = clamp(typeof t01 === 'number' ? t01 : 0.5, 0, 1);
    params.timeOfDay = t;

    if (t < 0.5) {
      const k = t / 0.5;
      params.elevation = -7.5 + (SUN_ELEVATION + 7.5) * k * k; // slow near dark, quick into gold
    } else {
      const k = (t - 0.5) / 0.5;
      const eased = k * k * (3 - 2 * k);
      params.elevation = SUN_ELEVATION + (64 - SUN_ELEVATION) * eased;
    }

    // The sun swings south as the day climbs: a 70 degree sweep centred on the authored dusk
    // azimuth. Purely so the shadows rotate believably when the slider moves.
    params.azimuth = SUN_AZIMUTH + (t - 0.5) * 70;

    // Turbidity climbs as the sun drops — the boundary layer traps aerosol in the evening, and
    // it deepens the horizon banding exactly when it should.
    params.turbidity = 3.8 + smoothstep(20, 2, params.elevation) * 1.1;

    dirty = true;
    recompute();
    buildEnvironment();
    return params.elevation;
  }

  /** Direct control, for the debug overlay. Bypasses the timeOfDay curve. */
  function setSunAngles(elevDeg, azDeg, rebuildEnv = true) {
    params.elevation = elevDeg;
    if (typeof azDeg === 'number') params.azimuth = azDeg;
    dirty = true;
    recompute();
    if (rebuildEnv) buildEnvironment();
  }

  /**
   * Any change to `sky.params` needs this to take effect. Most parameters are plain uniforms
   * and land on the next frame; the mote count is geometry, so it is rebuilt here rather than
   * being re-checked every frame.
   */
  function invalidate() {
    dirty = true;
    if (params.dustDensity !== lastDustDensity) buildDust();
  }

  function setQuality(q) {
    const name = SKY_QUALITY[q] ? q : DEFAULT_QUALITY;
    if (name === qualityName) return;
    qualityName = name;
    preset = SKY_QUALITY[name];

    cloudMaterial.defines.CLOUD_OCTAVES = preset.cloudOctaves;
    cloudMaterial.defines.CLOUD_WARP = preset.cloudWarp;
    cloudMaterial.defines.CLOUD_SHADOW_TAPS = preset.cloudShadow;
    cloudMaterial.needsUpdate = true;

    godrayMaterial.defines.GR_SAMPLES = preset.godraySamples;
    godrayMaterial.needsUpdate = true;

    godray.enabled = preset.godray > 0;
    godray.scale = preset.godray || 0.5;
    if (!godray.enabled) {
      releaseGodrayTargets();
      sky.godrayTexture = null;
      godray.fade = 0;
    } else {
      allocateGodrayTargets();
    }

    buildDust();
    dirty = true;
  }

  function dispose() {
    if (removeResize) removeResize();
    scene.remove(dome);
    scene.remove(clouds);
    scene.remove(sun);
    scene.remove(sun.target);
    scene.remove(hemi);
    disposeDust();
    if (envScene) {
      envScene.remove(envDome);
      envScene.remove(envClouds);
    }
    domeGeometry.dispose();
    domeMaterial.dispose();
    cloudGeometry.dispose();
    cloudMaterial.dispose();
    fsGeometry.dispose();
    sunProxyGeometry.dispose();
    sunProxyMaterial.dispose();
    occMaterial.dispose();
    godrayMaterial.dispose();
    releaseGodrayTargets();
    if (envRT) envRT.dispose();
    if (pmrem) pmrem.dispose();
    envRT = null;
    pmrem = null;
    if (scene.environment) scene.environment = null;
    if (scene.fog === sceneFog) scene.fog = null;
    if (materials && materials.fogUniforms === fogUniforms) materials.fogUniforms = null;
  }

  /* --- The object main.js holds ------------------------------------------ */

  const sky = {
    dome,
    clouds,
    sun,
    hemi,
    /** Getter, not a field: `setQuality` rebuilds the mote system with a new count. */
    get dust() {
      return dustPoints;
    },

    /** Consumed by postfx's composite pass. Null while the effect is faded out or disabled. */
    godrayTexture: null,
    /** Canonical height-fog uniforms; materials.js should reference these. */
    fogUniforms,
    /** PMREM-filtered environment, also mirrored onto `materials.env`. */
    get environment() {
      return envRT ? envRT.texture : null;
    },
    /** World-space unit vector toward the sun. Read-only — copy it, do not mutate it. */
    sunDirection: sunDir,
    /** Extinguished beam spectrum, max channel 1. */
    sunColour: sunTint,

    params,
    get quality() {
      return qualityName;
    },

    update,
    setTimeOfDay,
    setSunAngles,
    setQuality,
    invalidate,
    rebuildEnvironment: buildEnvironment,
    dispose,
  };

  return sky;
}

export default createSky;
