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
  groundBounce: '#7a6647', // warm dirt bounce into shadowed undersides
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
  hemiSkyIntensity: 0.85,
  hemiGroundIntensity: 0.35,
  envIntensity: 1.0,
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
  exposure: 0.92,
  contrast: 1.09,
  saturation: 0.88,
  // Split-tone: cool the shadows, warm the highlights. Small numbers; this should be felt,
  // not seen.
  lift: [-0.006, 0.0, 0.014],
  gamma: [1.0, 0.995, 0.985],
  gain: [1.035, 1.0, 0.955],
  bloomStrength: 0.045,
  bloomThreshold: 1.0,
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
