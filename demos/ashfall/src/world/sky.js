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
 * ABSOLUTE LEVELS — WHY THE SKY IS NOT "AS BRIGHT AS THE SKY"
 * ---------------------------------------------------------------------------------------
 * The composite pass tone maps with AgX. AgX's sigmoid desaturates hard above roughly 0.5 in
 * scene-linear: hand it a saturated blue at radiance 2.0 and it returns a pale grey-blue,
 * because every channel has been pushed onto the shoulder. The dome therefore has to be
 * authored at a radiance where the tone mapper still carries chroma, not at a radiance that
 * is physically defensible for a real sky.
 *
 * The anchor is: `zenithLuminance` is the *linear luminance of PALETTE.skyZenith*, so the
 * zenith resolves to the authored swatch through the grade rather than 2.6x above it. The
 * horizon haze then sits ~3.5x the zenith, which is the dusk ratio, and the solar disc sits
 * ~50x the horizon so it still clips to a hard white core. Everything else in the file is
 * expressed relative to those three numbers.
 *
 * ---------------------------------------------------------------------------------------
 * FOG OWNERSHIP
 * ---------------------------------------------------------------------------------------
 * `materials.js` evaluates the height-fog integral, but every uniform it reads is written from
 * here every frame, so this file — not art.js — is where the fog is actually tuned. The
 * `params.fog*` block below carries the working values; ATMOSPHERE seeds the concepts and any
 * value that has been re-tuned against a render says so at the site.
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
const _v3c = new THREE.Vector3();
const _colA = new THREE.Color();
const _colB = new THREE.Color();
const _colC = new THREE.Color();
const _clearSave = new THREE.Color();
const _black = new THREE.Color(0, 0, 0);

const DEG = Math.PI / 180;
/**
 * R2 (generalised golden ratio) low-discrepancy sequence, used to jitter the dither matrix.
 * A per-frame random offset clumps; R2 fills the 8x8 period evenly in the handful of frames
 * TAA actually integrates over.
 */
const R2_A = 0.7548776662466927;
const R2_B = 0.5698402909980532;
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
 * Relative Chappuis absorption at the RGB primaries, normalised to red.
 *
 * TAU_OZONE above is the *whole-column, band-integrated* ozone optical depth used for the beam
 * transmittance, and its green-heavy weighting is right for that job. The dome needs something
 * different: the shape of the Chappuis band itself as it appears along a long, low slant path.
 * That band is broad and peaks around 602 nm, which sits between the red and the green primary,
 * so it removes most from red, roughly half as much from green, and next to nothing from blue.
 * The residue is the cool green-blue that every clear dusk has between the warm horizon and the
 * blue zenith — the vertical structure a straight two-colour lerp cannot produce.
 */
const CHAPPUIS_WEIGHTS = [1.0, 0.46, 0.07];

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

/**
 * Ordered (Bayer) dither.
 *
 * A sky is the single most banding-prone surface in any renderer: it is the largest smooth
 * gradient on screen and the only one that covers hundreds of pixels per display code value.
 * The HDR target does not band, but the 8-bit present at the end of the composite does, and
 * TAA happily averages white noise back into a clean posterised staircase.
 *
 * An 8x8 ordered matrix is the right tool: its error is bounded and structured rather than
 * random, so a single frame is enough to break the contour, and it costs three fracts. The
 * matrix is translated by a low-discrepancy (R2) offset each frame so TAA's history cannot
 * converge on the pattern and undo it — that is the failure mode of a purely static Bayer.
 *
 * Written recursively rather than as a const array: dynamic indexing of a const array is not
 * guaranteed to compile under GLSL ES 1.00.
 */
const GLSL_DITHER = /* glsl */ `
  float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
  float bayer4(vec2 a) { return bayer2(a * 0.5) * 0.25 + bayer2(a); }
  float bayer8(vec2 a) { return bayer4(a * 0.5) * 0.25 + bayer2(a); }
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

  /* --- Vertical structure in the clear sky ---------------------------------
     Without these the dome is a two-colour lerp from haze to zenith, which is what a column
     read of the previous build measured. A real dusk sky is not monotonic in altitude. */

  /** Chappuis ozone absorption: (per-channel optical depth, already weighted). */
  uniform vec3 uChappuisTau;
  /** Altitude (in sin(alt)) where the ozone slant path peaks, and the band's width. */
  uniform float uChappuisAlt;
  uniform float uChappuisWidth;
  /** Sunward horizontal brightening — the sky is not a purely vertical ramp. */
  uniform vec2 uSunAzXZ;         // normalised sun azimuth in the ground plane
  uniform float uAzimuthGain;

  /* --- Boundary-layer haze slab -------------------------------------------- */
  uniform float uHazeTop;        // sin(alt) of the inversion
  uniform float uHazeEdge;       // half-width of that edge, in sin(alt)
  uniform float uHazeLoft;       // scale height of the thin stuff above the inversion
  uniform float uHazeLoftAmount;

  /* --- Aureole and horizon glow -------------------------------------------- */
  uniform vec3 uSunUpAxis;       // unit, perpendicular to uSunDir in the vertical plane
  uniform float uAureoleStrength;
  uniform float uAureoleWidth;   // radians, the broad lobe
  uniform float uAureoleCore;    // radians, the inner lobe
  uniform float uAureoleSquash;  // >1 stretches the glow along the horizon
  uniform float uHorizonGlow;
  uniform float uHorizonGlowHeight;
  uniform float uHorizonGlowFocus;

  /* --- Banding ------------------------------------------------------------- */
  uniform float uDither;         // relative amplitude, sized to one display code value
  uniform vec2 uDitherOffset;

  /* Horizon convergence. These mirror the height-fog uniforms world geometry uses so the two
     can be made to asymptote to the same radiance at zero elevation. */
  uniform vec3 uFogNear;
  uniform vec3 uFogFar;
  uniform float uFogFarMix;
  uniform float uFogInscatter;
  uniform float uFogAniso;
  uniform float uHorizonFogAmount;
  uniform float uHorizonFogAngle;

  ${GLSL_PHASE}
  ${GLSL_HASH}
  ${GLSL_DITHER}
  ${GLSL_XYZ}

  /**
   * The radiance a world surface converges to once its optical depth saturates.
   *
   * This is materials.js's FRAG_FOG expression evaluated at od -> infinity: the same near/far
   * blend, the same 0.7..1.0 phase gain, the same inscatter term. Ground and sky have to land
   * on *this* value at dir.y == 0 or they meet at a razor seam and the frame reads as a skybox
   * behind a floor rather than a world receding into air.
   *
   * uFogFarMix is deliberately < 1: the map is ~110 m across, so distant geometry saturates at
   * a partial near->far blend, not at pure fogColourFar. Matching that keeps the horizon warm.
   */
  vec3 saturatedFog(float cosGamma) {
    float g = clamp(uFogAniso, -0.95, 0.95);
    float denom = max(1.0 + g * g - 2.0 * g * cosGamma, 1e-4);
    float hgN = (1.0 - g * g) / (denom * sqrt(denom));
    // Same soft saturation materials.js applies: the raw lobe peaks near 30x and would blow
    // the horizon out completely down the sun line.
    float phase = 2.0 * hgN / (1.0 + hgN);
    vec3 c = mix(uFogNear, uFogFar, clamp(uFogFarMix, 0.0, 1.0));
    c *= mix(0.7, 1.0, clamp(phase, 0.0, 1.0));
    c += uSunTint * (uFogInscatter * 0.3 * phase * uSunVisibility);
    return c;
  }

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
    // Reaching full weight at sin(alt) 0.28 (~16 deg) rather than 0.80 (~53 deg): the top two
    // thirds of the dome must be saturated Rayleigh blue, not a slow ramp out of Preetham's
    // warm-drifted fit. The old ramp is why the upper sky measured as a neutral grey.
    float tintW = uZenithTintAmt * smoothstep(0.015, 0.28, up);
    // ...but never inside the aureole. Within ~13 deg of the sun the sky genuinely is Mie-white
    // and re-hueing it to blue would ring the key light in cold. Full tint past ~49 deg.
    tintW *= smoothstep(0.22, 0.85, gamma);
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 tinted = uZenithTint * (lum / max(dot(uZenithTint, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
    col = mix(col, tinted, tintW);

    /* ---- Chappuis absorption band -------------------------------------- */
    //
    // Preetham carries no ozone at all, and ozone is exactly what stops a dusk sky being a
    // straight lerp from a warm horizon to a blue zenith. The Chappuis band is a broad, weak
    // absorption centred near 602 nm — between the red and the green primary — so integrated
    // against sRGB it takes most out of red, some out of green and almost nothing out of blue.
    // What survives is the slightly green-blue mid-sky every photograph of a clear dusk has.
    //
    // Crucially it is *not* monotonic in altitude. The ozone layer sits around 25 km, so a ray
    // leaving the eye at 15-20 degrees traverses far more of it than one heading for the zenith,
    // while nearer the horizon the boundary-layer dust below has already taken the sky over.
    // That gives a band of maximum absorption partway up the dome — a Gaussian in sin(altitude)
    // is a perfectly adequate stand-in for the real slant-path integral at this scale.
    float chapT = (up - uChappuisAlt) / max(uChappuisWidth, 1e-3);
    vec3 chappuis = exp(-uChappuisTau * exp(-chapT * chapT));
    col *= chappuis;

    /* ---- Sunward azimuthal gradient ------------------------------------- */
    //
    // The other half of the answer to "a dusk sky is never a linear ramp": at 8 degrees of solar
    // elevation the whole forward-scattering half of the dome is measurably brighter than the
    // anti-solar half at the *same altitude*, because the aerosol phase function is broad. A
    // purely vertical ramp is the signature of a sky model with no azimuthal term at all.
    vec2 hxz = dir.xz;
    float hlen = length(hxz);
    float azCos = hlen > 1e-4 ? dot(hxz / hlen, uSunAzXZ) : 0.0;
    float azW = 0.5 + 0.5 * azCos;
    azW *= azW;                                    // concentrate it on the sun's half
    // Weighted toward the lower sky, where the slant path through the aerosol is longest, but
    // never zero at the zenith - the gradient has to run all the way across the dome.
    col *= 1.0 + uAzimuthGain * azW * (0.35 + 0.65 * (1.0 - up));

    /* ---- Dust haze: an ash layer Preetham knows nothing about ---------- */

    // A dusty industrial sky does not have an exponential aerosol profile. Ash and concrete
    // dust are mixed by convection up to the inversion at the top of the boundary layer and
    // then simply stop. Seen from inside, that inversion is a reasonably *sharp edge* a few
    // degrees above the horizon with cleaner air above it — and that edge is the single thing
    // that makes a sky read as dusty rather than merely hazy. A pure exponential smears the
    // transition over 20 degrees and reads as clean air with a wash over it.
    float slab = 1.0 - smoothstep(uHazeTop - uHazeEdge, uHazeTop + uHazeEdge, up);
    // Inside the slab the density still falls with altitude (the layer is not perfectly mixed);
    // above it a thin lofted tail survives so the edge is a step in gradient, not a hard cut.
    float inLayer = exp(-up / max(uHazeHeight, 1e-3));
    float lofted = uHazeLoftAmount * exp(-up / max(uHazeLoft, 1e-3));
    float hazeAmt = mix(lofted, max(inLayer, lofted), slab);

    // Quartic gate. Even the lofted tail must reach exactly zero at the zenith: a percent or two
    // of a term that is 3.5x the zenith's own radiance is enough to grey the blue out.
    float hazeGate = 1.0 - up;
    hazeGate *= hazeGate;
    hazeAmt *= hazeGate * hazeGate;

    // Real dusty air is stratified: settled layers of ash sit at slightly different heights
    // and read as horizontal banding. Three incommensurate frequencies in altitude, sheared by
    // a smooth pseudo-azimuth (dot with a fixed vector rather than atan, which has a seam),
    // and drifting slowly so the bands are not frozen. Gated by the slab so the strata live
    // inside the dust layer and stop at its top edge, which is what sells the edge as real.
    float alt = asin(clamp(dir.y, -1.0, 1.0));
    float az = dir.x * 1.9 + dir.z * 1.1;
    float bands =
        sin(alt * 34.0 + az * 0.35 + uTime * 0.021) * 0.50
      + sin(alt * 17.3 - az * 0.62 - uTime * 0.013) * 0.34
      + sin(alt * 71.0 + az * 1.90 + uTime * 0.037) * 0.16;
    hazeAmt *= 1.0 + uBandStrength * bands * slab;
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

    /* ---- Horizon: converge onto the same optical-depth integral as the ground ---- */

    // World geometry saturates toward saturatedFog(); the dome has to arrive at the same
    // radiance as dir.y -> 0 or the two meet at a hard cut. The band is an exponential in
    // sin(altitude) so it is invisible by ~15 degrees up and total at the horizon itself.
    vec3 fogSat = saturatedFog(cosGamma);
    float hz = exp(-up / max(uHorizonFogAngle, 1e-3)) * uHorizonFogAmount;
    col = mix(col, fogSat, clamp(hz, 0.0, 1.0));

    /* ---- Below the horizon --------------------------------------------- */
    // The dome is a full sphere; the level floor does not reach the far horizon. Below the
    // horizon *is* fully saturated fog, warmed slightly by the ground bounce, which is exactly
    // what an infinite fogged plane would resolve to, so the two sides of dir.y == 0 differ
    // by a few percent instead of the 64 code values the art review measured.
    // Written as -dir.y against a positive edge pair: smoothstep with edge0 > edge1 is
    // explicitly undefined in the spec, and some drivers do return garbage for it.
    float below = smoothstep(0.0, uHorizonSoftness, -dir.y);
    vec3 groundHaze = mix(fogSat, uGroundColour * uHazeLuminance, 0.22) * (0.90 + 0.28 * mie * uSunVisibility);
    col = mix(col, groundHaze, below);

    /* ---- Aureole -------------------------------------------------------- */
    //
    // The circumsolar aureole is not the disc's halo — it is tens of degrees wide, it is what
    // the eye actually reads as "the sun is there", and it is what buildings silhouette
    // against. Two things matter and neither falls out of a single HG lobe:
    //
    //  1. Reach. Two exponentials in angular distance, one over ~25 degrees and one over ~6,
    //     rather than a phase function that has collapsed to nothing by 12. The mie term above
    //     still owns the tight inner glow inside the dust; this owns the wide one.
    //  2. Anisotropy. The aerosol doing the scattering is a *layer*, so a ray offset
    //     horizontally from the sun stays inside the dust far longer than one offset vertically.
    //     The glow is therefore an ellipse lying on the horizon, not a circle. Measuring the
    //     angular distance in a frame squashed along the sun's local vertical is the cheapest
    //     honest way to get that, and it costs one dot product.
    //
    // The chord |dir - sunDir| stands in for the angle: they agree to better than 2% out to
    // 30 degrees, which is the whole range this term operates over.
    vec3 dch = dir - uSunDir;
    float dv = dot(dch, uSunUpAxis);
    float dh2 = max(dot(dch, dch) - dv * dv, 0.0);
    float gA = sqrt(dh2 / max(uAureoleSquash * uAureoleSquash, 1e-4) + dv * dv);
    float aureole = 0.62 * exp(-gA / max(uAureoleWidth, 1e-3)) + 0.38 * exp(-gA / max(uAureoleCore, 1e-3));
    // Faded out below the horizon: the level floor covers that hemisphere and a glow leaking
    // under it would read as light coming up through the ground.
    aureole *= 1.0 - below * 0.75;
    col += uSunTint * (aureole * uAureoleStrength * uHazeLuminance * uSunVisibility);

    /* ---- Horizon glow --------------------------------------------------- */
    //
    // Separate from the aureole and not redundant with it: this is the last few degrees above
    // the horizon on the sun's side, where the slant path through the dust is longest and the
    // inscattered radiance peaks. It is the band the container stacks and the crane read as
    // silhouettes against, so it is authored as a horizontal wash keyed to azimuth rather than
    // to angular distance from the disc.
    float glowAz = pow(max(azCos, 0.0), uHorizonGlowFocus);
    float glow = uHorizonGlow * glowAz * exp(-max(up, 0.0) / max(uHorizonGlowHeight, 1e-3));
    glow *= 1.0 - below * 0.55;
    col += uSunTint * (glow * uHazeLuminance * uSunVisibility);

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

    /* ---- Banding ---------------------------------------------------------
     * The HDR target does not band; the 8-bit present at the end of the composite does, and the
     * sky is by far the largest smooth gradient in the frame. The dither has to be *relative*,
     * not absolute, because everything between here and the display — exposure, AgX, the grade,
     * the sRGB transfer — is a monotone rescaling: a multiplicative perturbation survives all of
     * it at roughly constant size in display codes, an additive one does not.
     *
     * uDither is sized so the perturbation is about one display code value: the sRGB transfer's
     * local slope is ~1/2.2 in the mid-tones, so a relative step of 2.2/255 moves the output by
     * one code. Larger and it reads as grain (postfx already owns grain); smaller and the
     * contour survives.
     *
     * The 8x8 matrix is translated per frame so TAA cannot converge on it and average it away.
     */
    float dth = bayer8(gl_FragCoord.xy + uDitherOffset) - 0.5;
    col *= 1.0 + dth * uDither;

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
  uniform vec3 uAmbTop;         // cool zenith fill, for anything we see the top of
  uniform vec3 uAmbUnder;       // warm dust-band fill, for the undersides
  uniform vec3 uHazeColour;     // aerial perspective target
  uniform vec3 uCloudAlbedo;
  uniform vec2 uCamXZ;
  uniform float uCamY;
  uniform float uCloudHeight;
  uniform float uCloudScale;
  uniform vec2 uCloudDrift;     // metres, advected by the wind
  uniform vec2 uWindDir;        // unit, in the ground plane
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
  /** Domain anisotropy along the wind. >1 turns blobs into bands. */
  uniform float uStretch;
  /** Cross-wind displacement of the streaks, i.e. vertical wind shear. */
  uniform float uShear;
  /**
   * Cross-wind wander of the band axis, modulated *along* the band. A shear is a translation
   * along the band and so cannot change a band's width; this can, because its derivative in the
   * cross-wind coordinate locally spreads and pinches the pitch.
   */
  uniform float uWander;
  /** Zero-mean low-frequency density push along the band axis, so bands break up lengthwise. */
  uniform float uBreakup;
  /** Amplitude of the fibrous detail that runs *along* the streaks. */
  uniform float uFibre;
  uniform float uAerial;
  uniform float uHorizonStart;

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
    // than a texture stuck to a dome. Started much lower than before: the compressed bands in
    // the last couple of degrees above the horizon are the most valuable part of the deck and
    // the old 0.010..0.075 ramp threw exactly that away.
    float horizonFade = smoothstep(uHorizonStart, uHorizonStart + 0.030, up);
    if (horizonFade <= 0.001) discard;

    // Intersect the view ray with the cloud plane. Doing the perspective properly - rather
    // than UV-mapping a dome - is the single biggest reason this reads as sky and not wallpaper,
    // and it is also what compresses the bands into tight horizontal lines near the horizon
    // for free: t goes as 1/sin(altitude), so the ground-plane metres per screen pixel explode.
    float t = (uCloudHeight - uCamY) / max(up, 1e-3);
    vec2 ground = uCamXZ + dir.xz * t;
    // Subtracting the drift means a given noise feature *moves along* the wind vector, which is
    // the opposite of the naive sign and the difference between clouds blowing west and east.
    vec2 q = (ground - uCloudDrift) * uCloudScale;

    // Distance fade: past this the features are sub-pixel and would alias/crawl under TAA.
    float distFade = 1.0 - smoothstep(uFadeNear, uFadeFar, t);
    if (distFade <= 0.001) discard;

    /* ---- Anisotropic domain: bands, not blobs ---------------------------- */
    //
    // An isotropic fBm produces isotropic blobs. Every real high deck is combed out by the wind
    // into streaks many times longer than they are wide, so the noise domain is compressed
    // along the wind vector before it is sampled. Doing it here, in the *ground plane* rather
    // than in screen space, means perspective handles the foreshortening: a band that is 8 km
    // long overhead is a hairline at the horizon.
    vec2 wperp = vec2(-uWindDir.y, uWindDir.x);
    vec2 wq = vec2(dot(q, uWindDir), dot(q, wperp));
    // Vertical wind shear displaces each streak along the wind by a slow function of its
    // cross-wind position. Without it the bands are parallel rulings; with it they feather and
    // fan the way a sheared cirrus deck actually does.
    wq.x += noised(vec2(wq.y * 0.55, uTime * 0.004)).x * uShear;
    // ...but a shear is still a pure translation *along* the band, so every band keeps the same
    // width and the pitch stays even. That is the other half of why the deck measured as
    // evenly-spaced parallel rulings: a 1D compression of an isotropic field gives a comb.
    // Displacing the *cross-wind* coordinate by a field that varies slowly along the band gives
    // the widths back — where this displacement's cross-wind derivative is positive neighbouring
    // bands spread apart, where it is negative they pinch together and merge. Frequencies are
    // chosen in the pre-stretch frame: 0.055 along the wind is roughly three band-lengths, 0.20
    // across it is about five band-widths, so a handful of adjacent bands share a phase and
    // drift relative to each other rather than every band wobbling independently.
    // The amplitude is held below 1/0.375 so the map stays injective and the bands cannot fold
    // back through one another (quintic value noise has |d/dx| <= 1.875, hence 0.20 * 1.875).
    wq.y += (noised(vec2(wq.x * 0.055, wq.y * 0.20 + 11.7)).x - 0.5) * uWander;
    vec2 qs = vec2(wq.x / max(uStretch, 0.05), wq.y);

    #if CLOUD_WARP
      // Curl warp. The gradient of a scalar fBm rotated 90 degrees is divergence free, so the
      // domain distortion shears and swirls without pumping density in or out. The slow time
      // offset makes the deck *evolve* rather than slide past as a rigid printed sheet.
      // Applied in the stretched frame and with its along-wind component damped, so it curls
      // the bands rather than dissolving them back into blobs.
      vec3 w = fbmd3(qs * 0.62 + vec2(uTime * 0.0035, uTime * -0.0021));
      vec2 curl = vec2(w.z * 0.35, -w.y);
      qs += curl * uWarp;
    #endif

    float dens = fbmMain(qs);

    // Breakup along the band axis. Real sheared cirrus wastes away and re-forms down its length;
    // it does not run unbroken from one side of the dome to the other. The modulation is much
    // lower frequency than the band structure itself (0.38 along the stretched axis is ~2.6 band
    // lengths, 0.26 across it means a small group of bands rises and falls together) so it opens
    // and closes gaps rather than adding another octave of speckle - the fibre term below already
    // owns the fine detail.
    //
    // Authored as a *zero-mean additive push* rather than a multiplicative field on purpose:
    // value noise has mean 0.5, so (brk - 0.5) integrates to zero and the deck's average coverage
    // is untouched. The coverage threshold below is calibrated against the raw fBm's median
    // (0.48/0.14 puts that median at ~4% alpha) and that calibration has to survive this.
    float brk = noised(vec2(qs.x * 0.38, qs.y * 0.26) + 31.4).x;
    dens += uBreakup * (brk - 0.5);

    // Fibrous detail *along* the streaks only. Cirrus is combed: its fine structure runs
    // parallel to the bands. Making this detail isotropic collapses the whole effect straight
    // back into speckle, so the frequencies are deliberately lopsided.
    float fib = noised(vec2(qs.x * 2.7, qs.y * 9.0)).x;
    dens *= 1.0 - uFibre * 0.5 + uFibre * fib;

    // Coverage threshold. Softness controls the wispiness of the edges; a hard step here is
    // the classic "cotton wool cut out with scissors" tell. The transition widens with distance
    // — a poor man's mip bias, and what stops the compressed horizon bands crawling under TAA.
    // Capped: uncapped, the horizon bands - the whole point of the deck reaching that far -
    // widened their way straight back out of existence past ~15 km.
    float soft = uSoftness * (1.0 + min(t * 0.00040, 1.5));

    // ...and that softness alone is not enough, because it is authored in *density* units
    // while the artefact is a *screen-space* one. The rate at which dens changes per pixel is nowhere near
    // uniform over the deck: the ray-plane intersect puts ground metres per pixel up as
    // 1/sin(alt)^2, and the 6:1 wind compression makes the field change several times faster
    // across the bands than along them. Wherever that rate exceeds the authored half-width the
    // step resolves inside a single pixel and the deck reads as hard-edged rulings - a column
    // read of the previous build measured a step from (148,176,203) to warm tan with no gradient
    // between them. Dropping softness from 0.30 to 0.14 is what fixed the flat-veil look and
    // caused this; prefiltering analytically lets the low authored softness stay.
    //
    // The transition is kept centred exactly where it already was - half a softness above
    // uCoverage - and only *widened*. Widening symmetrically about uCoverage instead would drag
    // the fBm's median from ~4% alpha (clear) to ~50% and double the deck's apparent coverage.
    float hw = 0.5 * soft;
    float mid = uCoverage + hw;
    // fwidth() = |dFdx| + |dFdy|, so it already runs ~1.4x the true per-pixel step; 0.75 of it
    // as a half-width lands the edge at roughly one and a half pixels, which is soft enough to
    // read as cloud and tight enough not to blur the wisps away.
    //
    // Capped for the same reason the distance widening above is capped: once the transition
    // spans more than ~0.2 the step has resolved to the field's local mean, and widening further
    // only drags the far deck toward a flat 50% and greys out the horizon band the deck
    // reaching that far was for. max() is applied last, so a re-authored uSoftness always wins.
    //
    // fwidth is available here despite the note on the solar disc above: the ES 1.00 derivative
    // builtins are implicitly enabled in a WebGL2 context, and materials.js already ships dFdx
    // unguarded in a world material. The disc still uses uPixelAngle because there the footprint
    // genuinely is a constant angle per pixel, so a uniform is exact and free; no uniform can
    // express the footprint of this field.
    float e = max(hw, min(fwidth(dens) * 0.75, 0.20));
    float cov = smoothstep(mid - e, mid + e, dens);
    if (cov <= 0.002) discard;

    /* ---- Lighting ------------------------------------------------------- */

    // The sun is 8 degrees up, so its path through the layer is almost horizontal: the light
    // arrives from *upwind* along the sun's ground track and the undersides are what catch it.
    // Taps march in the *stretched* frame, along the sun's ground track projected into it, so
    // the self-shadowing runs down the length of a band instead of across it.
    vec2 sxz = normalize(uSunDir.xz + vec2(1e-4, 0.0));
    vec2 toSun = normalize(vec2(dot(sxz, uWindDir) / max(uStretch, 0.05), dot(sxz, wperp)) + vec2(1e-5, 0.0));
    float occl = 0.0;
    #if CLOUD_SHADOW_TAPS > 0
      occl += fbm3(qs + toSun * 0.30) * 0.6;
    #endif
    #if CLOUD_SHADOW_TAPS > 1
      occl += fbm3(qs + toSun * 0.85) * 0.4;
    #endif
    // Beer-Lambert along the light ray, relative to this column's own density so a thin wisp
    // in front of a thick bank still lights up.
    float trans = exp(-uAbsorb * max(occl - dens * 0.35, 0.0) * 4.0);

    float cosGamma = clamp(dot(dir, uSunDir), -1.0, 1.0);
    // Broad forward lobe: the silver lining on the sunward edge of every cloud. The isotropic
    // floor is deliberately low: at 0.55 every cloud in the sky got a bright fill regardless
    // of which way the sun was, which is what turned the deck into one flat cream sheet. At
    // 0.30 the anti-sunward banks fall into silhouette and the deck reads as lit from the side.
    float phase = 0.30 + 2.2 * hgPhase(cosGamma, 0.62);

    // Warm undersides, cool tops. The sun is 8 degrees up: it goes *under* the deck, so the
    // parts of it we look at edge-on near the horizon are lit almost entirely by the warm beam
    // and by the bright dust band bouncing back up, while the parts overhead are seen from
    // below with the beam raking past them and only the cool zenith filling the shadow. Keying
    // both terms off view altitude is a cheap stand-in for a real cloud normal, and it puts the
    // same warm-key/cool-shadow split on the deck that section 4 puts on the ground.
    float topness = smoothstep(0.06, 0.62, up);

    vec3 sunLit = uSunColour * (trans * phase * uSunVisibility * mix(1.35, 0.55, topness));
    vec3 ambient = mix(uAmbUnder, uAmbTop, topness) * (0.34 + 0.34 * up);
    vec3 col = uCloudAlbedo * (sunLit + ambient);

    // Aerial perspective. Without this the far clouds stay saturated and the deck looks flat;
    // with it, the compressed horizon bands dissolve into the dust layer, which is exactly what
    // they should do. Gentler than before because the deck now reaches much further out.
    float aerial = 1.0 - exp(-t * uAerial);
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
  /**
   * Ceiling on the fog blend factor, so a fully extinguished surface still contributes 10% of
   * its own radiance and never becomes pure fog colour. materials.js does not currently declare
   * a uniform under any of these names, so the write is inert — the alias exists so that the
   * moment FRAG_FOG's final `mix()` gains a clamp, this file is already driving it.
   */
  maxOpacity: ['uFogMaxOpacity', 'fogMaxOpacity', 'uFogOpacityMax', 'uFogClamp'],
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
    /**
     * Luminance of the zenith in HDR units — see the ABSOLUTE LEVELS note in the header.
     *
     * This is the linear luminance of PALETTE.skyZenith with 1.09x of headroom for
     * GRADE.exposure (0.92), so the zenith tone maps back onto the authored swatch instead of
     * landing 2.6x above it where AgX's shoulder strips the blue out. Assigned below, once
     * colZenith exists.
     */
    zenithLuminance: 0.185,
    /** How hard the zenith is pulled to PALETTE.skyZenith. 0 = pure Preetham. */
    zenithTint: 0.88,

    hazeDensity: 0.92,
    /** Angular scale height of the dust layer, in units of sin(altitude). */
    hazeHeight: 0.105,
    /**
     * Top of the boundary layer, in sin(altitude). 0.098 is ~5.6 degrees — the inversion an
     * industrial town in still evening air actually sits under. This is the edge that makes the
     * sky read as dusty; without it the aerosol profile is a pure exponential, which is a clean
     * sky with a wash over it.
     */
    hazeTop: 0.098,
    /** Half-width of that edge, in sin(altitude). ~1.7 degrees: sharp-ish, not a hard line. */
    hazeEdge: 0.030,
    /** Scale height of the thin ash that gets lofted above the inversion. */
    hazeLoft: 0.34,
    /** How much of the slab's density that lofted tail carries. Small, or the edge disappears. */
    hazeLoftAmount: 0.14,

    /**
     * Chappuis ozone absorption. The band peaks near 602 nm, between the red and green
     * primaries, so integrated against sRGB it takes most out of red, roughly half as much out
     * of green and almost nothing out of blue — which is what tips the mid-sky green-blue.
     * At 0.18 the band takes ~16% out of red and ~8% out of green where it peaks, for an ~8%
     * luminance dip around 17 degrees: unmistakable in a column read, and to the eye just the
     * cool step that stops the dome being monotonic. Pushed to 0.24 it starts reading as a
     * grey band rather than as air.
     */
    chappuisStrength: 0.18,
    /** Where the ozone slant path peaks, in sin(altitude). 0.30 is ~17 degrees. */
    chappuisAlt: 0.30,
    chappuisWidth: 0.30,
    /**
     * Sunward horizontal brightening. This is the term whose absence made a vertical column
     * read as a straight two-colour lerp: with only altitude in the model, every column is.
     */
    azimuthGain: 0.34,

    /**
     * Aureole. Much wider than the disc and much wider than the Mie lobe above: 0.44 rad is
     * 25 degrees of e-folding, so the glow is still doing measurable work 60 degrees out.
     */
    aureoleStrength: 0.45,
    aureoleWidth: 0.44,
    /** Inner lobe, ~6 degrees, so the glow has a bright heart rather than a flat disc of cream. */
    aureoleCore: 0.11,
    /**
     * Horizontal stretch of the aureole. The scattering aerosol is a *layer*, so a horizontal
     * offset from the sun stays in the dust far longer than a vertical one and the glow is an
     * ellipse lying on the horizon. 2.2 is roughly the ratio of the slab's horizontal to
     * vertical extent at this elevation.
     */
    aureoleSquash: 2.2,
    /**
     * The horizon glow proper — the band the container stacks and the crane silhouette against.
     * Keyed to azimuth, not to angular distance from the disc, so it runs along the horizon.
     */
    horizonGlow: 0.34,
    /** Scale height of that band, in sin(altitude). ~3 degrees. */
    horizonGlowHeight: 0.052,
    /** How tightly it hugs the sun's azimuth. 3.0 gives a ~90 degree wide wash. */
    horizonGlowFocus: 3.0,

    /**
     * Ordered-dither amplitude, relative. The sRGB transfer's local slope is ~1/2.2 through the
     * mid-tones, so 2.2/255 moves the display by about one code value — the smallest step that
     * can break a contour and the largest that is not grain. Everything between the dome and
     * the display is a monotone rescaling, so a *relative* perturbation stays this size.
     */
    dither: 2.2 / 255,
    /**
     * Horizon-haze gain, i.e. PALETTE.skyHorizon times this. 1.10 puts the dust band ~3.5x the
     * zenith's luminance — the dusk ratio — while staying under AgX's shoulder. At 1.65 it
     * clipped, and a clipped horizon is what erased the sun disc's contrast against it.
     */
    hazeLuminance: 1.10,
    /** Amplitude of the horizontal ash strata. Subtle: 0.2 is already visible. */
    bandStrength: 0.16,
    horizonSoftness: 0.055,
    mieG: ATMOSPHERE.inscatterAnisotropy,
    /**
     * Aureole gain. At 1.3 on top of a clipped haze the forward lobe painted a ~60 degree cream
     * smudge with no disc in it; 0.80 keeps the glow inside ~10 degrees where the two-lobe
     * phase function actually puts it.
     */
    mieStrength: 0.80,
    /**
     * Disc radiance multiplier on (PALETTE.sunCore x beam transmittance). Lands the core around
     * 50x the horizon haze: hard, small, unambiguously clipped, and cheap enough on the bloom
     * threshold that it flares rather than washes.
     */
    sunDiscIntensity: 120,
    skyScale: 1.0,

    /**
     * Deck altitude. Raised from 180 m: at 180 the plane intersect put every visible feature
     * inside 2.5 km, so the deck occupied a narrow strip and never reached the horizon. 620 m
     * pushes the same angular sizes out to where perspective can compress them, which is what
     * produces the tightening bands the horizon needs.
     */
    cloudHeight: 620,
    /**
     * Threshold, so *higher* is less cloud, paired with a *narrow* softness so the deck is
     * selective: clear sky where the field is thin, opaque bands where it is thick.
     *
     * The previous 0.54 / 0.30 pair did the opposite — a wide transition on a high threshold
     * gives a low-alpha veil over the entire dome and nothing that reads as a cloud, which is
     * why the deck measured as absent while still greying out the zenith. At 0.48 / 0.14 the
     * fBm's median lands at ~4% alpha (i.e. clear) and its upper third at 70-90% (i.e. cloud).
     */
    cloudCoverage: 0.48,
    cloudSoftness: 0.14,
    /** Raised: at 0.78, under aerial perspective, the deck was being swamped by the haze band. */
    cloudOpacity: 0.94,
    cloudWarp: 0.55,
    cloudAbsorb: 1.35,
    /**
     * Metres per fBm unit *across* the wind. With the 6:1 stretch below the along-wind features
     * run to ~9 km, which is the aspect ratio of a real sheared deck.
     */
    cloudFeatureSize: 1500,
    /** Domain compression along the wind. This is what makes bands instead of blobs. */
    cloudStretch: 6.0,
    /**
     * Cross-wind displacement of the streaks — vertical wind shear, so they feather and fan
     * instead of ruling the sky with parallel lines. In fBm units *before* the stretch, so 1.6
     * is ~2.4 km of along-wind offset across the deck.
     */
    cloudShear: 1.6,
    /**
     * Cross-wind wander of the band axis, in fBm units *before* the stretch, i.e. in band widths.
     *
     * The shear above fans the bands but cannot vary their width, because it slides them along
     * their own axis. This is what stops the deck being an evenly-pitched comb: 0.9 of a band
     * width of wander, varying over ~3 band lengths, spreads and pinches the pitch by about a
     * third either way. Above ~2.6 the domain map stops being injective and bands fold through
     * each other, which reads as a moire rather than as cloud.
     */
    cloudWander: 0.9,
    /**
     * Zero-mean low-frequency density push along the band axis, in raw fBm units.
     *
     * The coverage transition is 0.14 wide, so 0.17 (i.e. +-0.085) is enough to carry a band
     * across the threshold and back and make it terminate part way along its length, without
     * being so large it dissolves the band structure the stretch exists to create.
     */
    cloudBreakup: 0.17,
    /** Fibrous along-streak detail. Combed, not speckled. */
    cloudFibre: 0.40,
    /** Aerial-perspective rate, per metre. Gentler than before: the deck now reaches much further. */
    cloudAerial: 0.00011,
    /** Where the deck starts fading out near the horizon, in sin(altitude). ~0.2 degrees. */
    cloudHorizonStart: 0.004,
    /** Clouds ride faster than the ground wind. */
    cloudWindScale: 5.5,
    /** Pushed out to match the new deck altitude, or the horizon bands are culled before they read. */
    cloudFadeNear: 9000,
    cloudFadeFar: 42000,

    dustDensity: ATMOSPHERE.dustMoteDensity,
    dustAmbient: 0.055,
    dustForward: 0.34,
    dustPhaseG: 0.72,
    dustBox: 30,
    dustBoxY: 15,

    godrayStrength: ATMOSPHERE.godrayStrength,
    godrayDecay: ATMOSPHERE.godrayDecay,
    /**
     * Density of the participating medium — how much of the marched occlusion buffer survives
     * into the shaft. This is a *weight*, not a march length; see `godrayReach`.
     */
    godrayDensity: ATMOSPHERE.godrayDensity,
    /**
     * How far along the ray to the sun the radial march travels, as a fraction of the distance.
     *
     * This has to be 1.0. The march steps uv toward uSunUV by `reach * (uv - sunUV)` in total,
     * so at 0.72 every pixel stops 28% short of the sun and never samples the light source at
     * all: only pixels already within ~4% of screen width of the sun got any contribution,
     * which is exactly why nothing in any frame read as a shaft. ATMOSPHERE.godrayDensity used
     * to be wired here; it now feeds the weight above, where its name actually makes sense.
     */
    godrayReach: 1.0,
    /** Second-pass reach, as a fraction of the first pass's step. Fills the gaps between taps. */
    godrayRefine: 1.45,
    /**
     * Brightness of the occlusion-buffer sun relative to the beam tint. The blur normalises by
     * the sample count, so only the two or three taps that land inside the proxy contribute and
     * the shafts come out around a twentieth of this.
     */
    godrayProxyGain: 2.6,
    /**
     * postfx composites the buffer with ATMOSPHERE.godrayStrength (0.55) applied on top, and
     * the art direction (§4, "the dust in the air is what makes light visible") wants an
     * effective ~1.4. Make the difference up here so the shafts are right in the frame we can
     * actually render; if art.js is ever re-authored to 1.4 this collapses to 1.0 on its own.
     */
    godrayGain: 1.4 / Math.max(ATMOSPHERE.godrayStrength, 1e-3),

    /* --- Fog -------------------------------------------------------------
     * materials.js evaluates the integral but reads every one of these from here, so this is
     * where the ash is actually tuned. ATMOSPHERE seeds the concepts; the values below have
     * been re-tuned against a render and the deltas are called out individually.
     */

    /**
     * Per-metre extinction at fogBase. ATMOSPHERE's 0.0072 put ~33% opacity on a surface at
     * 60 m — and because the fog *colour* was also clipping (see fogLuminance), that 33% was
     * enough to erase all albedo and normal-map response from the mid-field. 0.0040 keeps a
     * measurable aerial-perspective ramp across the 20-80 m the map is played at while leaving
     * distant geometry at least 30% of its own radiance anywhere inside the level bounds.
     */
    fogDensity: 0.0040,
    /** Ash sits lower and thins faster with altitude than ATMOSPHERE's 0.055 implied. */
    fogHeightFalloff: 0.10,
    fogBase: ATMOSPHERE.fogBase,
    /**
     * Radiance scale on fogColourNear/Far. The palette entries are authored as *swatches*, and
     * materials.js uses them directly as radiance — at 1.0 the near colour plus the inscatter
     * term reached ~1.4 linear, i.e. clipping, roughly 7x brighter than the surfaces it was
     * being mixed over. That, not the opacity, is what made the mid-field a featureless wash.
     */
    fogLuminance: 0.62,
    /**
     * Inscatter gain handed to materials.js. ATMOSPHERE's 1.35 drove the sunward fog to a flat
     * clipped cream with no structure in it; 0.50 gives a strong warm gradient down the sun
     * line (~1.5x the away-from-sun radiance) that survives the tone mapper as a gradient.
     */
    fogInscatter: 0.50,
    /**
     * Ceiling on the fog blend, so distant geometry always keeps 10% of its own colour.
     * Published through FOG_ALIASES; inert until materials.js reads it (see the note there).
     */
    fogMaxOpacity: 0.90,
    /** Near->far blend the *dome* assumes distant geometry has reached. See saturatedFog(). */
    fogFarMix: 0.72,
    /** How completely the dome's bottom band becomes fog. 1.0 = a seamless join. */
    horizonFogAmount: 0.92,
    /**
     * Angular width of that band, in sin(altitude).
     *
     * Narrowed from 0.10 (~6 degrees) to 0.045 (~2.6). Its only job is to make the dome and a
     * fully extinguished world surface agree at dir.y == 0. At 0.10 it was a second smooth
     * exponential sitting on top of the haze's own, with almost the same scale height — two
     * near-identical ramps superimposed, which is precisely how a sky ends up measuring as a
     * straight two-colour lerp. Confined to the seam, it leaves the slab's edge visible.
     */
    horizonFogAngle: 0.045,

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
   * Anchor the dome's absolute level on the palette rather than on a hand-picked HDR number:
   * the zenith's radiance *is* PALETTE.skyZenith, plus 1/GRADE.exposure worth of headroom, so
   * "the zenith resolves to skyZenith" is a property of the code and not of a lucky constant.
   * Everything else in the dome is expressed as a ratio off this.
   */
  params.zenithLuminance = luminanceOf(colZenith) * 1.22;

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
    // Vertical + azimuthal structure in the clear sky.
    uChappuisTau: { value: new THREE.Vector3() },
    uChappuisAlt: { value: params.chappuisAlt },
    uChappuisWidth: { value: params.chappuisWidth },
    uSunAzXZ: { value: new THREE.Vector2(0, -1) },
    uAzimuthGain: { value: params.azimuthGain },
    // Boundary-layer haze slab.
    uHazeTop: { value: params.hazeTop },
    uHazeEdge: { value: params.hazeEdge },
    uHazeLoft: { value: params.hazeLoft },
    uHazeLoftAmount: { value: params.hazeLoftAmount },
    // Aureole + horizon glow.
    uSunUpAxis: { value: new THREE.Vector3(0, 1, 0) },
    uAureoleStrength: { value: params.aureoleStrength },
    uAureoleWidth: { value: params.aureoleWidth },
    uAureoleCore: { value: params.aureoleCore },
    uAureoleSquash: { value: params.aureoleSquash },
    uHorizonGlow: { value: params.horizonGlow },
    uHorizonGlowHeight: { value: params.horizonGlowHeight },
    uHorizonGlowFocus: { value: params.horizonGlowFocus },
    // Banding.
    uDither: { value: params.dither },
    uDitherOffset: { value: new THREE.Vector2() },
    // Horizon convergence — mirrors of the height-fog uniforms, written in recompute().
    uFogNear: { value: colFogNear.clone() },
    uFogFar: { value: colFogFar.clone() },
    uFogFarMix: { value: params.fogFarMix },
    uFogInscatter: { value: params.fogInscatter },
    uFogAniso: { value: ATMOSPHERE.inscatterAnisotropy },
    uHorizonFogAmount: { value: params.horizonFogAmount },
    uHorizonFogAngle: { value: params.horizonFogAngle },
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
    uAmbTop: { value: colZenith.clone() },
    uAmbUnder: { value: colHorizon.clone() },
    uHazeColour: { value: colHorizon.clone() },
    uCloudAlbedo: { value: colSmoke.clone().lerp(_colA.setRGB(1, 1, 1, THREE.LinearSRGBColorSpace), 0.35) },
    uCamXZ: { value: new THREE.Vector2() },
    uCamY: { value: 0 },
    uCloudHeight: { value: params.cloudHeight },
    uCloudScale: { value: 1 / params.cloudFeatureSize },
    uCloudDrift: { value: new THREE.Vector2() },
    uWindDir: { value: windXZ.clone() },
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
    uStretch: { value: params.cloudStretch },
    uShear: { value: params.cloudShear },
    uWander: { value: params.cloudWander },
    uBreakup: { value: params.cloudBreakup },
    uFibre: { value: params.cloudFibre },
    uAerial: { value: params.cloudAerial },
    uHorizonStart: { value: params.cloudHorizonStart },
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
    /** True once blurB has been cleared to black for the idle state — see parkGodrays(). */
    parked: false,
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

  /**
   * Proxy angular radius. The shafts are cast by the whole bright region around the sun, not by
   * the 0.53 deg disc, and the radial blur only integrates whatever taps land *inside* the
   * proxy — at 0.9 deg that was well under one tap per pixel at 16 samples, so the shafts were
   * arriving as noise rather than as beams. 2.2 deg gives two to three taps and a solid shaft.
   */
  const SUN_PROXY_ANGULAR_RADIUS = 2.2 * DEG;
  const SUN_PROXY_DISTANCE = 320;
  const SUN_PROXY_SIZE = 2 * SUN_PROXY_DISTANCE * Math.tan(SUN_PROXY_ANGULAR_RADIUS);
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
    // Freshly allocated targets hold undefined contents, so the idle clear must happen again.
    godray.parked = false;
  }

  function releaseGodrayTargets() {
    if (godray.occRT) godray.occRT.dispose();
    if (godray.blurA) godray.blurA.dispose();
    if (godray.blurB) godray.blurB.dispose();
    godray.occRT = godray.blurA = godray.blurB = null;
    godray.w = godray.h = 0;
    godray.parked = false;
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
    uFogDensity: { value: params.fogDensity },
    uFogHeightFalloff: { value: params.fogHeightFalloff },
    uFogBase: { value: params.fogBase },
    uInscatterStrength: { value: params.fogInscatter },
    uInscatterAnisotropy: { value: ATMOSPHERE.inscatterAnisotropy },
    /** See FOG_ALIASES.maxOpacity — published for materials.js, inert until it reads it. */
    uFogMaxOpacity: { value: params.fogMaxOpacity },
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
  const sceneFog = new THREE.FogExp2(0x000000, params.fogDensity);
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

    /* ---- Vertical + azimuthal structure -------------------------------- */

    // Ozone deepens as the path lengthens, so the band strengthens as the sun drops. Anchored
    // on the design elevation so the authored look is unchanged at SUN_ELEVATION.
    const chapScale = params.chappuisStrength * (0.55 + 0.45 * smoothstep(35, 2, elev));
    skyUniforms.uChappuisTau.value.set(
      CHAPPUIS_WEIGHTS[0] * chapScale,
      CHAPPUIS_WEIGHTS[1] * chapScale,
      CHAPPUIS_WEIGHTS[2] * chapScale
    );
    skyUniforms.uChappuisAlt.value = params.chappuisAlt;
    skyUniforms.uChappuisWidth.value = Math.max(params.chappuisWidth, 1e-3);

    // Sun azimuth projected into the ground plane, normalised. Degenerate only with the sun
    // exactly overhead, where an azimuthal gradient is meaningless anyway.
    const azLen = Math.hypot(sunDir.x, sunDir.z);
    if (azLen > 1e-4) skyUniforms.uSunAzXZ.value.set(sunDir.x / azLen, sunDir.z / azLen);
    // The gradient is a low-sun phenomenon: overhead there is no sunward half of the sky.
    skyUniforms.uAzimuthGain.value = params.azimuthGain * smoothstep(45, 6, elev);

    skyUniforms.uHazeTop.value = params.hazeTop;
    skyUniforms.uHazeEdge.value = Math.max(params.hazeEdge, 1e-3);
    skyUniforms.uHazeLoft.value = Math.max(params.hazeLoft, 1e-3);
    skyUniforms.uHazeLoftAmount.value = clamp(params.hazeLoftAmount, 0, 1);

    // Local vertical at the sun: world up with the component along the beam removed. This is the
    // axis the aureole is squashed along, so the glow lies on the horizon rather than ringing
    // the disc. Falls back to world up if the sun is within a degree of the zenith.
    _v3c.set(0, 1, 0).addScaledVector(sunDir, -sunDir.y);
    if (_v3c.lengthSq() < 1e-6) _v3c.set(0, 1, 0);
    skyUniforms.uSunUpAxis.value.copy(_v3c.normalize());
    skyUniforms.uAureoleStrength.value = Math.max(params.aureoleStrength, 0);
    skyUniforms.uAureoleWidth.value = Math.max(params.aureoleWidth, 1e-3);
    skyUniforms.uAureoleCore.value = Math.max(params.aureoleCore, 1e-3);
    skyUniforms.uAureoleSquash.value = Math.max(params.aureoleSquash, 0.05);
    // The horizon glow belongs to a low sun. By 25 degrees there is no glow band left, only
    // a bright sky, and leaving it in would put a warm stripe under a midday horizon.
    skyUniforms.uHorizonGlow.value = Math.max(params.horizonGlow, 0) * smoothstep(26, 3, elev);
    skyUniforms.uHorizonGlowHeight.value = Math.max(params.horizonGlowHeight, 1e-3);
    skyUniforms.uHorizonGlowFocus.value = Math.max(params.horizonGlowFocus, 0.1);
    skyUniforms.uDither.value = Math.max(params.dither, 0);

    // 0.42 of a 4.6-unit beam put the lit faces around 0.9 linear, i.e. on AgX's shoulder, and
    // the whole deck came back as one cream sheet with no form in it. 0.14 lands the lit faces
    // near 0.3 and the sunward rims near 1.0, which is where a cloud actually has shape.
    cloudUniforms.uSunColour.value.copy(sunRadiance).multiplyScalar(0.14);
    // Two separate ambients, not one blend: the top of the deck only ever sees the cool zenith,
    // the underside sees the bright warm dust band. Handing the shader a single averaged fill is
    // what made the deck one flat sheet with no warm/cool relationship in it.
    cloudUniforms.uAmbTop.value
      .copy(colZenith)
      .multiplyScalar(params.zenithLuminance * skyBrightnessScale)
      .lerp(_colC.copy(colHorizon).multiplyScalar(params.hazeLuminance * skyBrightnessScale), 0.10);
    cloudUniforms.uAmbUnder.value
      .copy(colHorizon)
      .multiplyScalar(params.hazeLuminance * skyBrightnessScale * 0.85)
      .lerp(_colC.copy(colGroundBounce).multiplyScalar(params.hazeLuminance * skyBrightnessScale), 0.22);
    cloudUniforms.uHazeLuminance.value = params.hazeLuminance * skyBrightnessScale;
    cloudUniforms.uStretch.value = Math.max(params.cloudStretch, 0.05);
    cloudUniforms.uShear.value = params.cloudShear;
    // Clamped at 2.6: past that the cross-wind warp folds and the deck moires (see cloudWander).
    cloudUniforms.uWander.value = clamp(params.cloudWander, 0, 2.6);
    cloudUniforms.uBreakup.value = clamp(params.cloudBreakup, 0, 0.45);
    cloudUniforms.uFibre.value = clamp(params.cloudFibre, 0, 1);
    cloudUniforms.uAerial.value = Math.max(params.cloudAerial, 0);
    cloudUniforms.uHorizonStart.value = Math.max(params.cloudHorizonStart, 1e-4);
    cloudUniforms.uWindDir.value.copy(windXZ);
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
    // params.fogLuminance brings the palette swatches down to a radiance that sits *between*
    // the surfaces it is mixed over and the sky it has to meet at the horizon. Without it the
    // fog is brighter than anything in the frame and every mid-field surface becomes fog.
    fogUniforms.uFogColourNear.value
      .copy(_colB)
      .multiplyScalar(params.fogLuminance * (0.35 + 0.65 * skyBrightnessScale));
    fogUniforms.uFogColourFar.value
      .copy(colFogFar)
      .multiplyScalar(params.fogLuminance * (0.30 + 0.70 * skyBrightnessScale));
    fogUniforms.uSunDirection.value.copy(sunDir);
    // Tint is normalised; colour carries the energy. materials.js adds its inscatter term as
    // tint * strength * phase, so handing it a 4.6x radiance there would blow the fog out.
    fogUniforms.uSunTint.value.copy(sunTint).multiplyScalar(sunVisibility);
    fogUniforms.uSunColour.value.copy(sunRadiance);

    sceneFog.color.copy(fogUniforms.uFogColourNear.value).lerp(fogUniforms.uFogColourFar.value, 0.45);

    /* ---- Hand the same air to the dome, so ground and sky meet ----------- */
    // These are copies of the *resolved* fog radiances above, which is the whole point: the
    // dome's bottom band and a fully extinguished world surface are now evaluating identical
    // numbers through identical maths.
    skyUniforms.uFogNear.value.copy(fogUniforms.uFogColourNear.value);
    skyUniforms.uFogFar.value.copy(fogUniforms.uFogColourFar.value);
    skyUniforms.uFogFarMix.value = clamp(params.fogFarMix, 0, 1);
    skyUniforms.uFogInscatter.value = params.fogInscatter;
    skyUniforms.uFogAniso.value = ATMOSPHERE.inscatterAnisotropy;
    skyUniforms.uHorizonFogAmount.value = clamp(params.horizonFogAmount, 0, 1);
    skyUniforms.uHorizonFogAngle.value = Math.max(params.horizonFogAngle, 1e-3);
  }

  recompute();
  buildEnvironment();

  /* ====================================================================== */
  /* God-ray pass                                                            */
  /* ====================================================================== */

  const sunUV = new THREE.Vector2(0.5, 0.5);

  /**
   * Hand postfx a valid, black shaft buffer while the effect is idle.
   *
   * The old contract was "godrayTexture is null while faded out", and it is what a probe caught
   * as `hasGodrayTex false`: at any vantage not looking within ~65 degrees of the sun — which is
   * three of the four review frames — the field is legitimately null, and from the outside that
   * is indistinguishable from the feature being dead. It also means postfx's composite has to
   * swap texture bindings, which recompiles nothing but does churn the uniform every time the
   * player turns past the sun.
   *
   * Parking instead: clear the output buffer to black *once* on the transition into idle and
   * keep publishing it. One clear of a half-res target on the frame the effect switches off,
   * versus a field that flickers between a texture and null several times a second. The
   * expensive part — the second world traversal — is still skipped entirely.
   */
  function parkGodrays() {
    if (!godray.blurB) {
      sky.godrayTexture = null;
      sky.godrayState = 'disabled';
      return;
    }
    if (!godray.parked) {
      const prevTarget = renderer.getRenderTarget();
      const prevAutoClear = renderer.autoClear;
      renderer.getClearColor(_clearSave);
      const prevAlpha = renderer.getClearAlpha();
      renderer.setRenderTarget(godray.blurB);
      renderer.setClearColor(_black, 1);
      renderer.clear(true, false, false);
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(_clearSave, prevAlpha);
      renderer.autoClear = prevAutoClear;
      godray.parked = true;
    }
    sky.godrayTexture = godray.blurB.texture;
    sky.godrayState = 'idle';
  }

  function updateGodrays(dt, game, camera) {
    if (!godray.enabled || !godray.occRT || !godray.blurB) {
      // Genuinely off (quality `low`, or the targets could not be allocated). Null is correct
      // here and postfx substitutes its own black texture.
      sky.godrayTexture = null;
      sky.godrayState = 'disabled';
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
      parkGodrays();
      return;
    }
    godray.parked = false;

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

    // Reach, not density: the march has to actually arrive at the sun or no pixel outside the
    // proxy ever samples the light source. The medium's density is a weight on the result.
    godrayUniforms.uDensity.value = clamp(params.godrayReach, 0.05, 1.0);
    godrayUniforms.uDecay.value = clamp(params.godrayDecay, 0.5, 0.9999);
    godrayUniforms.uSunUV.value.copy(sunUV);
    godrayUniforms.uTint.value.copy(sunTint);

    // postfx multiplies by ATMOSPHERE.godrayStrength itself; godrayGain makes up the shortfall
    // between that and the strength the art direction asks for. Only these two and the fade
    // belong on the output.
    const grOut = godray.fade * Math.max(params.godrayGain, 0);

    // Pass 1: full reach, coarse, jittered.
    godrayUniforms.tOcc.value = godray.occRT.texture;
    godrayUniforms.uStride.value = 1.0;
    godrayUniforms.uJitter.value = 1.0;
    godrayUniforms.uWeight.value = Math.max(params.godrayDensity, 0);
    godrayUniforms.uIntensity.value = preset.godrayPasses > 1 ? 1.0 : grOut;
    blit(godrayMaterial, preset.godrayPasses > 1 ? godray.blurA : godray.blurB);

    if (preset.godrayPasses > 1) {
      // Pass 2: short reach, no jitter. Its whole job is to fill the gaps between pass 1's
      // taps, which is what turns N samples into an effectively N-squared-quality sweep.
      godrayUniforms.tOcc.value = godray.blurA.texture;
      godrayUniforms.uStride.value = params.godrayRefine / preset.godraySamples;
      godrayUniforms.uJitter.value = 0.0;
      // Pass 2 is a mean over an already-weighted buffer, so it must not re-apply the density.
      godrayUniforms.uWeight.value = 1.0;
      // Decay compounds across the two passes; the short pass gets the per-step root so the
      // total falloff still matches ATMOSPHERE.godrayDecay.
      godrayUniforms.uDecay.value = Math.pow(clamp(params.godrayDecay, 0.5, 0.9999), 1 / preset.godraySamples);
      godrayUniforms.uIntensity.value = grOut;
      blit(godrayMaterial, godray.blurB);
    }

    /* ---- Restore -------------------------------------------------------- */

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(_clearSave, prevClearAlpha);
    renderer.autoClear = prevAutoClear;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.shadowMap.needsUpdate = prevShadowNeeds;

    sky.godrayTexture = godray.blurB.texture;
    sky.godrayState = 'active';
  }

  /* ====================================================================== */
  /* Frame                                                                   */
  /* ====================================================================== */

  let time = 0;
  let cloudTime = 0;
  let ditherFrame = 0;
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
    // Wrapped: the strata term takes fract()-scale differences of this, and after an hour of
    // play an unwrapped accumulator has lost enough mantissa that the pattern freezes.
    skyUniforms.uTime.value = time % 8192;

    // Translate the ordered-dither matrix each frame along an R2 low-discrepancy sequence. A
    // static Bayer pattern is exactly what TAA's history is best at averaging away, and once it
    // has, the contour it was hiding comes straight back. The period is the matrix's own 8 px.
    ditherFrame = (ditherFrame + 1) % 4096;
    skyUniforms.uDitherOffset.value.set((ditherFrame * R2_A) % 8, (ditherFrame * R2_B) % 8);

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

    // Sourced from `params`, not straight from ATMOSPHERE: this module owns the working fog
    // values (see the FOG OWNERSHIP note in the header) and `params` is what a settings slider
    // or the debug overlay can move.
    fogUniforms.uFogDensity.value = params.fogDensity;
    fogUniforms.uFogHeightFalloff.value = params.fogHeightFalloff;
    fogUniforms.uFogBase.value = params.fogBase;
    fogUniforms.uInscatterStrength.value = params.fogInscatter;
    fogUniforms.uInscatterAnisotropy.value = ATMOSPHERE.inscatterAnisotropy;
    fogUniforms.uFogMaxOpacity.value = params.fogMaxOpacity;
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
      writeUniform(target, FOG_ALIASES.maxOpacity, fogUniforms.uFogMaxOpacity.value);
      writeUniform(target, FOG_ALIASES.time, fogUniforms.uFogTime.value);
    }

    if (params.sceneFog) {
      // FogExp2 has no height term, so evaluate the height profile at the eye and hand it the
      // equivalent uniform density. Walking up the admin block stairwell genuinely thins it.
      const camY = camera.position.y - params.fogBase;
      sceneFog.density = params.fogDensity * Math.exp(-params.fogHeightFalloff * Math.max(camY, 0));
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
      sky.godrayState = 'disabled';
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

    /**
     * Consumed by postfx's composite pass. Non-null on every frame the effect is enabled — it
     * is a black buffer, not null, while the player is facing away from the sun. Null only when
     * god rays are genuinely off (quality `low`, or target allocation failed), which postfx
     * already handles by substituting its own black texture.
     */
    godrayTexture: null,
    /** 'disabled' | 'idle' | 'active'. Diagnostic; a probe should read this, not the texture. */
    godrayState: 'disabled',
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
