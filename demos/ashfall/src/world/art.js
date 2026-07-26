/**
 * Ashfall — art direction constants.
 *
 * This file is the single source of truth for the look. Every module that picks a colour,
 * a light intensity, a fog density or a material response reads it from here. Nothing else
 * in the codebase is allowed to hard-code a palette value.
 *
 * The look: a rail freight yard an hour before dusk. One low, hard, warm key light from the
 * west; everything out of it falls into cool sky-blue shadow. That warm/cool split is the
 * whole image. Saturation stays low so the handful of saturated hits — rust, hazard paint,
 * tracers, muzzle flash — carry every frame.
 */

/** Linear-space helper. Palette values below are authored in sRGB hex for readability. */
export const SRGB = (hex) => hex;

export const PALETTE = {
  // --- Light ---
  sun: '#ffcf9a', // low-elevation key, already reddened by atmosphere
  sunCore: '#fff1dd', // the disc itself, much hotter than the light it casts
  skyZenith: '#3f6f9e',
  skyHorizon: '#d8c3a4', // dust haze piles up at the horizon
  /**
   * Warm dirt bounce into shadowed undersides. Brightened and warmed from '#7a6647'.
   *
   * §4 authors bounce light as "warm off the ground", but it was never visible: measured in a
   * render, the shadowed face of the shed came out neutral-to-cool, i.e. the bounce was
   * contributing nothing the eye could find. Two causes, and this fixes one of them —
   * '#7a6647' is only 0.196/0.140/0.070 in linear, so even at full hemisphere weight it is a
   * fifth of a stop of fill. sky.js multiplies this by hemiGroundIntensity/hemiSkyIntensity
   * before it reaches the light, so the swatch has to carry real level, not just a hue.
   *
   * '#9a8058' is 0.323/0.216/0.098 linear — 1.65x brighter with the same warm ratio (R:B of
   * 3.3), so the hue the palette authored is unchanged and only the amount moves. Paired with
   * hemiGroundIntensity 0.80 this is what puts warmth back under the eaves and on the
   * undersides of the containers, which is the half of the warm/cool split that was missing.
   */
  groundBounce: '#9a8058',
  moonlessShadow: '#2a3644', // the coolest shadow the scene is allowed to reach

  // --- Surfaces ---
  concreteLit: '#8d8880',
  concreteShadow: '#4a5460',
  concreteStained: '#6f6a62',
  asphalt: '#3c3a38',
  brick: '#7a5548',
  brickPainted: '#8d8578',
  plaster: '#a89e8e',
  rust: '#8a4a28',
  rustDeep: '#5c2f1a',
  steelPainted: '#5a6159',
  steelBare: '#7d8288',
  railGreen: '#3d4a3f',
  tarpBlue: '#2d4a63',
  hazardYellow: '#c8a02c',
  woodWeathered: '#6b5a45',
  woodSplinter: '#b09a76',
  sandbag: '#8b7c5e',
  dirt: '#6b5a44',
  gravel: '#6e6963',
  weeds: '#5c6340',
  glass: '#8fa3aa',

  // --- Gun ---
  gunmetal: '#33363a',
  gunPolymer: '#2b2d2a',
  gunTan: '#8a7a5c',
  gunRubber: '#1d1e1f',
  brass: '#b08a3e',

  // --- FX ---
  muzzleCore: '#fff6d8',
  muzzleEdge: '#ff9a3c',
  tracer: '#ffb347',
  tracerEnemy: '#7fd4ff',
  blood: '#7a1512',
  smoke: '#b9b0a4',
  dust: '#c9bca6',
  spark: '#ffcf7a',
  ember: '#ff7a2c',

  // --- UI ---
  hudPrimary: '#e8e4dc',
  hudDim: 'rgba(232,228,220,0.55)',
  hudAccent: '#c8a02c',
  hudDanger: '#d64b3a',
  hudFriendly: '#6fb3d4',
};

/** Sun elevation in degrees. 8° is the golden-hour rake the whole scene is composed around. */
export const SUN_ELEVATION = 8.0;
/** Sun azimuth in degrees, measured from +Z clockwise. Puts the key over the west stacks. */
export const SUN_AZIMUTH = 252.0;

export const LIGHTING = {
  sunIntensity: 4.6, // physical-ish; post exposure does the rest
  sunAngularDiameter: 0.0093, // radians — real sun, drives soft shadow penumbra width
  /**
   * Sky hemisphere fill. This is the *only* thing that makes an unlit face read as cool, and
   * §4 makes that split the whole look, so it has to actually win against the other fills.
   *
   * At 0.85 against envIntensity 1.0 the near-white PMREM environment swamped it: shadow-side
   * concrete measured R-B between 0 and +7 in a render, i.e. neutral-to-warm, when the
   * authored target (PALETTE.concreteShadow) is R-B = -22. 1.20 puts the blue hemisphere back
   * in charge of the shadow fill. sky.js divides hemiGroundIntensity by this when it builds
   * the HemisphereLight, so the warm ground bounce stays at its authored absolute level and
   * only the sky side moves.
   *
   * Revised down from 1.20 once the real cause of the flat frame was found. 1.20 was chosen
   * while the ash shader chunk was being injected into every program twice, which broke six
   * materials outright and washed the whole image out; against that, dialling the blue fill
   * right up looked like it was helping. With the duplicate injection fixed and the exposure
   * calibrated, 1.20 renders every shadowed surface a saturated electric blue rather than a
   * cool grey. 0.55 restores the intended relationship: the sky tints the shade, the grade's
   * `lift` does the rest, and the sun stays overwhelmingly dominant at 4.6 : 0.55.
   */
  hemiSkyIntensity: 0.55,
  /**
   * Warm ground bounce, the other half of §4's "bounce is warm off the ground, cool from the
   * sky". Raised from 0.35.
   *
   * sky.js folds this into the HemisphereLight's groundColor as the ratio
   * hemiGroundIntensity / hemiSkyIntensity, so at 0.35 : 0.55 the bounce arrived at 0.64x of
   * an already-dark swatch and measured as nothing: the shadowed shed face in a render read
   * neutral-to-cool, with no trace of the dirt under it. 0.80 puts the ratio at 1.45x, which
   * together with the brighter PALETTE.groundBounce is roughly 2.6x more warm up-fill on
   * shadowed undersides. That is still well under the 4.6 sun, so the key stays dominant and
   * the bounce reads as bounce rather than as a second light.
   *
   * engine.js and weapon.js scale the viewmodel's bounce lamp off this same number, so the
   * gun's underside warms with the world instead of drifting out of the grade.
   */
  hemiGroundIntensity: 0.8,
  /**
   * Image-based lighting weight. The environment probe is a PMREM of the whole dome, so it is
   * close to achromatic — every extra unit of it is a neutral wash that cancels the hemisphere's
   * blue and flattens the frame toward one hue family. 0.70 keeps the specular response and
   * the sense of an open sky while leaving the diffuse shadow fill to the hemisphere.
   */
  envIntensity: 0.7,
  /** Practical lights are the only point lights and must have a visible fixture. */
  practicalIntensity: 12.0,
  practicalColour: '#ffb765',
  practicalRange: 14.0,
};

export const ATMOSPHERE = {
  /** Exponential height fog. Density is per metre at y = fogBase. */
  fogDensity: 0.0072,
  fogHeightFalloff: 0.055, // ash settles low, so it thins fast with altitude
  fogBase: 0.0,
  fogColourNear: '#c9b79c',
  fogColourFar: '#a8b3bd',
  /** How strongly fog brightens looking into the sun. This sells the dusty air. */
  inscatterStrength: 1.35,
  inscatterAnisotropy: 0.76, // Henyey-Greenstein g, forward scattering
  godrayStrength: 0.55,
  godrayDecay: 0.965,
  godrayDensity: 0.72,
  dustMoteDensity: 1.0,
  windDirection: [0.82, 0.04, -0.57],
  windSpeed: 1.9,
};

/** Post-processing look. `postfx.params` is seeded from this. */
export const GRADE = {
  /**
   * Scene-linear exposure into AgX. At 0.92 nothing in the frame ever crossed the tone curve's
   * shoulder: measured peak luminance sat at 228-244/255 with literally zero pixels at 254+, so
   * the whole image ran on AgX's linear mid-slope and read as a flat grey-box render. 1.15 puts
   * the sun disc, the specular hits on the rails and the scope objective over the knee, which is
   * where the filmic shoulder and the bloom threshold both start doing their job.
   *
   * Recalibrated to 3.4 by sweeping the live render at 2.2 / 3.6 / 5.5 and reading the frames
   * back. 1.15 was set while six materials were failing to compile and the depot light shafts
   * were painting additive white over the frame; with both fixed, the same number leaves the
   * ground several stops under and the scene reads as night rather than an hour before dusk.
   * At 3.4 the sunlit faces land in the upper mid-tones, the sun disc and the burning barrel
   * cross the bloom threshold, and the shadowed ground still has real density.
   */
  exposure: 3.4,
  /** Pivoted on 0.18 in postfx. 1.20 is what actually reaches display white and display black. */
  contrast: 1.2,
  /**
   * Still well under 1.0 — §4 wants the palette desaturated so the rust and hazard paint carry.
   * Nudged up from 0.88 only enough that the warm/cool split below survives to the display.
   */
  saturation: 0.94,
  /**
   * Split-tone, ASC-CDL order (slope, offset, power) — see postfx's composite pass.
   *
   * `gain` is a slope, so it owns the highlights: red above unity and blue below warms anything
   * the sun touches. `lift` is a constant offset, so its *relative* weight grows as the pixel
   * gets darker: it owns the shadows, and blue-positive / red-negative is what turns an unlit
   * plane cool. The previous [-0.006, 0, 0.014] was 1.4% of range and measured as nothing at
   * all in the render; this is roughly 3x that, which puts shadow-side concrete around
   * R-B = -15 in display codes. It is still an offset of a few percent, not a colour cast.
   */
  lift: [-0.018, 0.0, 0.03],
  gamma: [1.0, 0.995, 0.985],
  gain: [1.045, 1.0, 0.945],
  /**
   * Neutral black point, added to `lift` on all three channels by postfx (it defaults to -0.010
   * when this key is absent). Deepened because the darkest 5% of the frame was landing around
   * 66/255 — a fogged grey card, not a photograph. Negative offset clips to zero in the shader,
   * so this is a real toe rather than a gamma crush.
   */
  masterLift: -0.024,
  /**
   * Bloom. Threshold is in HDR scene-linear, *before* exposure. At 1.0 nothing in any frame
   * ever reached it, so the pass never fired and what looked like glow was fog inscatter.
   * 0.75 catches the sun disc, tracers, muzzle flash and metal speculars and nothing else;
   * strength goes up to match, because a threshold nobody crosses made 0.045 untestable.
   */
  bloomStrength: 0.14,
  bloomThreshold: 0.75,
  bloomSoftKnee: 0.55,
  ssaoIntensity: 0.85,
  ssaoRadius: 0.55,
  vignette: 0.34,
  chromatic: 0.0016,
  grainAmount: 0.028,
  sharpen: 0.32,
  motionBlurAmount: 0.55,
  taaFeedback: 0.91,
  lensDirtStrength: 0.22,
};

/** Map footprint in metres. The three combat spaces are laid out inside this. */
export const MAP = {
  width: 110,
  depth: 90,
  wallHeight: 9.0,
  /** Landmark heights — these carry the silhouette from anywhere on the map. */
  craneHeight: 22.0,
  waterTowerHeight: 18.0,
  adminFloors: 2,
  floorHeight: 3.6,
};

/** Named zones, used by the level builder, AI spawn logic and the minimap legend. */
export const ZONES = {
  yard: { label: 'The Yard', centre: [0, 0, 8], radius: 34 },
  depot: { label: 'The Depot', centre: [-36, 0, -22], radius: 22 },
  terraces: { label: 'The Terraces', centre: [34, 0, -26], radius: 20 },
};

/** Surface response table. Drives audio, impact FX, penetration and footsteps. */
export const SURFACES = {
  concrete: { hardness: 0.92, density: 2.4, penetrable: false, dustColour: '#c9c2b4', sparks: 0.15 },
  metal: { hardness: 1.0, density: 7.8, penetrable: 'thin', dustColour: '#9aa0a6', sparks: 1.0 },
  wood: { hardness: 0.42, density: 0.65, penetrable: true, dustColour: '#b09a76', sparks: 0.0 },
  dirt: { hardness: 0.22, density: 1.4, penetrable: true, dustColour: '#8b7758', sparks: 0.0 },
  gravel: { hardness: 0.38, density: 1.7, penetrable: true, dustColour: '#9c948a', sparks: 0.05 },
  glass: { hardness: 0.6, density: 2.5, penetrable: true, dustColour: '#cfe0e6', sparks: 0.0 },
  sandbag: { hardness: 0.18, density: 1.6, penetrable: true, dustColour: '#b3a281', sparks: 0.0 },
  flesh: { hardness: 0.1, density: 1.0, penetrable: true, dustColour: '#7a1512', sparks: 0.0 },
};

/** Camera. FOV is the hipfire vertical FOV; ADS values live on each weapon definition. */
export const CAMERA = {
  fov: 75,
  near: 0.05,
  far: 600,
  viewmodelFov: 60,
  viewmodelNear: 0.008,
  viewmodelFar: 12,
  eyeHeight: 1.65,
  crouchEyeHeight: 1.05,
};

export default {
  PALETTE,
  LIGHTING,
  ATMOSPHERE,
  GRADE,
  MAP,
  ZONES,
  SURFACES,
  CAMERA,
  SUN_ELEVATION,
  SUN_AZIMUTH,
};
