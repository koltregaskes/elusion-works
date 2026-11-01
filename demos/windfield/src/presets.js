// Every tweakable number lives here once: its range, its label, which tab it sits on.
// Presets are sparse overrides on top of DEFAULTS, and switching preset tweens every
// numeric value and colour, so the field drifts from one mood to the next.

export const PARAMS = [
  // Wind
  { key: 'windStrength', tab: 'wind', section: 'Wind', label: 'Strength', min: 0, max: 1.6, step: 0.01, unit: '×' },
  { key: 'windDir', tab: 'wind', section: 'Wind', label: 'Direction', min: 0, max: 360, step: 1, unit: '°' },
  { key: 'gustStrength', tab: 'wind', section: 'Wind', label: 'Gusts', min: 0, max: 2, step: 0.01, unit: '×' },
  { key: 'gustSize', tab: 'wind', section: 'Wind', label: 'Gust size', min: 8, max: 90, step: 1, unit: 'm' },
  { key: 'gustSpeed', tab: 'wind', section: 'Wind', label: 'Gust speed', min: 0, max: 3, step: 0.01, unit: '×' },
  { key: 'turbulence', tab: 'wind', section: 'Wind', label: 'Flutter', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'pollen', tab: 'wind', section: 'Carried on it', label: 'Pollen', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'leafFall', tab: 'wind', section: 'Carried on it', label: 'Falling leaves', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'rain', tab: 'wind', section: 'Carried on it', label: 'Rain', min: 0, max: 1, step: 0.01, unit: '%', pct: true },

  // Grass
  { key: 'grassHeight', tab: 'grass', section: 'Field', label: 'Grass height', min: 0.25, max: 1.6, step: 0.01, unit: 'm' },
  { key: 'heightVariation', tab: 'grass', section: 'Field', label: 'Unevenness', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'flowers', tab: 'grass', section: 'Field', label: 'Wildflowers', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'dryness', tab: 'grass', section: 'Field', label: 'Dry grass', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'translucency', tab: 'grass', section: 'Light through blades', label: 'Backlight glow', min: 0, max: 2, step: 0.01, unit: '×' },
  { key: 'sheen', tab: 'grass', section: 'Light through blades', label: 'Gust sheen', min: 0, max: 1, step: 0.01, unit: '%', pct: true },

  // Sky
  { key: 'sunElevation', tab: 'sky', section: 'Light', label: 'Sun height', min: -8, max: 70, step: 0.1, unit: '°' },
  { key: 'sunAzimuth', tab: 'sky', section: 'Light', label: 'Sun bearing', min: 0, max: 360, step: 1, unit: '°' },
  { key: 'exposure', tab: 'sky', section: 'Light', label: 'Exposure', min: 0.2, max: 2, step: 0.01, unit: '×' },
  { key: 'bloom', tab: 'sky', section: 'Light', label: 'Bloom', min: 0, max: 1.5, step: 0.01, unit: '' },
  { key: 'cloudCover', tab: 'sky', section: 'Clouds', label: 'Cloud cover', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'cloudDensity', tab: 'sky', section: 'Clouds', label: 'Cloud density', min: 0.2, max: 1.6, step: 0.01, unit: '×' },
  { key: 'cloudSpeed', tab: 'sky', section: 'Clouds', label: 'Cloud speed', min: 0, max: 2, step: 0.01, unit: '×' },
  { key: 'highClouds', tab: 'sky', section: 'Clouds', label: 'High clouds', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'haze', tab: 'sky', section: 'Atmosphere', label: 'Haze', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'mist', tab: 'sky', section: 'Atmosphere', label: 'Ground mist', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'stars', tab: 'sky', section: 'Atmosphere', label: 'Stars', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'lightning', tab: 'sky', section: 'Atmosphere', label: 'Lightning', min: 0, max: 1, step: 0.01, unit: '%', pct: true },

  // Subject
  { key: 'leafSeason', tab: 'subject', section: 'The oak', label: 'Season', min: 0, max: 1, step: 0.01, unit: '', season: true },
  { key: 'canopy', tab: 'subject', section: 'The oak', label: 'Canopy', min: 0.2, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'fire', tab: 'subject', section: 'Fire', label: 'Bonfire', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'fireflies', tab: 'subject', section: 'Life', label: 'Fireflies', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
  { key: 'birds', tab: 'subject', section: 'Life', label: 'Birds', min: 0, max: 1, step: 0.01, unit: '%', pct: true },
];

export const TABS = [
  { id: 'wind', label: 'Wind' },
  { id: 'grass', label: 'Grass' },
  { id: 'sky', label: 'Sky' },
  { id: 'subject', label: 'Subject' },
];

export const SUBJECTS = [
  { id: 'oak', label: 'Oak' },
  { id: 'monolith', label: 'Monolith' },
  { id: 'stones', label: 'Stones' },
  { id: 'none', label: 'Open field' },
];

export const COLOUR_KEYS = [
  'skyZenith', 'skyHorizon', 'sunColor', 'sunDisc', 'hemiSky', 'hemiGround',
  'grassBase', 'grassTip', 'grassDry', 'groundA', 'groundB',
  'cloudLit', 'cloudShade', 'mistColor', 'leafSummer', 'leafAutumn', 'accent',
];

const DEFAULTS = {
  windStrength: 0.55, windDir: 35, gustStrength: 1, gustSize: 34, gustSpeed: 1, turbulence: 0.45,
  pollen: 0.4, leafFall: 0, rain: 0,
  grassHeight: 0.8, heightVariation: 0.55, flowers: 0.35, dryness: 0.15, translucency: 1, sheen: 0.5,
  sunElevation: 32, sunAzimuth: 210, sunIntensity: 3.2, hemiIntensity: 1.1, exposure: 1, bloom: 0.35,
  cloudCover: 0.42, cloudDensity: 0.9, cloudSpeed: 0.5, highClouds: 0.35,
  haze: 0.35, mist: 0, stars: 0, lightning: 0,
  leafSeason: 0, canopy: 1, fire: 0, fireflies: 0, birds: 0.6,
  sunSize: 1, glow: 1,
  subject: 'oak',
  skyZenith: '#3a6db5', skyHorizon: '#bcd3e6', sunColor: '#fff2dc', sunDisc: '#fff6e6',
  hemiSky: '#a9c4e0', hemiGround: '#4a5a2a',
  grassBase: '#24401a', grassTip: '#8fb24a', grassDry: '#c2a660',
  groundA: '#2b3a1a', groundB: '#3c4a22',
  cloudLit: '#ffffff', cloudShade: '#8d9aad', mistColor: '#dfe8ee',
  leafSummer: '#3f6a22', leafAutumn: '#b5561d',
  accent: '#d7a16f',
};

export const PRESETS = [
  {
    id: 'dawn', name: 'Dawn',
    eyebrow: 'First light',
    title: 'The field wakes slowly.',
    sub: 'Low mist, cold dew and a sun that has not made its mind up yet.',
    camera: { radius: 33, height: 2.2, speed: 0.012, startAngle: 2.6 },
    values: {
      windStrength: 0.18, gustStrength: 0.6, gustSpeed: 0.45, turbulence: 0.25, pollen: 0.15,
      sunElevation: 3.5, sunAzimuth: 95, sunIntensity: 2.2, hemiIntensity: 0.75, exposure: 1.05, bloom: 0.55,
      cloudCover: 0.35, cloudDensity: 0.7, cloudSpeed: 0.2, highClouds: 0.6, haze: 0.62, mist: 0.85,
      dryness: 0.05, translucency: 1.5, flowers: 0.2, birds: 0.35,
      skyZenith: '#46628f', skyHorizon: '#f2c7a2', sunColor: '#ffbf86', sunDisc: '#ffe3c2',
      hemiSky: '#8a9fbf', hemiGround: '#3b4030', grassBase: '#1e3520', grassTip: '#7da35a',
      groundA: '#26331d', groundB: '#33402a', cloudLit: '#ffd9bd', cloudShade: '#7b7f99', mistColor: '#f0d8cc',
      accent: '#e7a37a',
    },
  },
  {
    id: 'meadow', name: 'Meadow',
    eyebrow: 'High summer',
    title: 'Every blade is listening.',
    sub: 'Warm wind, loose pollen and absolutely nowhere you need to be.',
    camera: { radius: 31, height: 2.6, speed: 0.016, startAngle: 0.9 },
    values: {
      windStrength: 0.6, gustStrength: 1.1, pollen: 0.55, flowers: 0.6, sunElevation: 48, sunAzimuth: 200,
      cloudCover: 0.42, highClouds: 0.3, haze: 0.18, birds: 0.7, bloom: 0.3,
      skyZenith: '#2a5fb6', skyHorizon: '#a8c5e2',
      accent: '#a9c46a',
    },
  },
  {
    id: 'golden', name: 'Golden',
    eyebrow: 'Golden hour',
    title: 'Light you can almost hold.',
    sub: 'The sun slides behind the oak and the whole field lights up from the inside.',
    camera: { radius: 32, height: 1.7, speed: 0.014, startAngle: 0.35 },
    values: {
      windStrength: 0.48, gustStrength: 1.2, pollen: 0.75, dryness: 0.45, translucency: 1.9, sheen: 0.7,
      sunElevation: 6.5, sunAzimuth: 255, sunIntensity: 3.6, hemiIntensity: 0.8, exposure: 1.0, bloom: 0.75,
      cloudCover: 0.32, cloudDensity: 0.8, highClouds: 0.55, haze: 0.36, mist: 0.12, flowers: 0.3, birds: 0.5,
      skyZenith: '#40507f', skyHorizon: '#ffb26b', sunColor: '#ffb062', sunDisc: '#fff0cf',
      hemiSky: '#9a8f9a', hemiGround: '#4a3a1a', grassBase: '#2e3a14', grassTip: '#c3b24e', grassDry: '#e0b35a',
      groundA: '#33351a', groundB: '#46401f', cloudLit: '#ffc78a', cloudShade: '#8a6a74', mistColor: '#ffcf9a',
      leafSummer: '#4c6a1e', accent: '#f0a24a',
    },
  },
  {
    id: 'storm', name: 'Storm',
    eyebrow: 'Weather warning',
    title: 'The wind has opinions.',
    sub: 'Bruised sky, flattened grass and the first fat drops of rain.',
    camera: { radius: 29, height: 2.4, speed: 0.022, startAngle: 4.0 },
    values: {
      windStrength: 1.35, gustStrength: 1.8, gustSize: 26, gustSpeed: 2.2, turbulence: 0.9, pollen: 0, rain: 0.75,
      leafFall: 0.35, sunElevation: 22, sunAzimuth: 150, sunIntensity: 0.9, hemiIntensity: 0.9, exposure: 1.1, bloom: 0.25,
      cloudCover: 0.95, cloudDensity: 1.5, cloudSpeed: 1.8, highClouds: 0.2, haze: 0.65, mist: 0.25, lightning: 0.8,
      flowers: 0.15, birds: 0, translucency: 0.4, sheen: 0.9,
      skyZenith: '#22282f', skyHorizon: '#6b737a', sunColor: '#c5ccd6', sunDisc: '#b8c0c8',
      hemiSky: '#6f7a88', hemiGround: '#252b20', grassBase: '#1d2e18', grassTip: '#5f7a42',
      groundA: '#1e2717', groundB: '#26301d', cloudLit: '#7d858f', cloudShade: '#2b3036', mistColor: '#7e868c',
      accent: '#8fa6bf',
    },
  },
  {
    id: 'autumn', name: 'Autumn',
    eyebrow: 'Late October',
    title: 'The oak lets go.',
    sub: 'Copper leaves on a slow wind. Nothing out here is in a hurry.',
    camera: { radius: 28, height: 2.0, speed: 0.013, startAngle: 5.2 },
    values: {
      windStrength: 0.5, gustStrength: 1.3, pollen: 0.1, leafFall: 0.85, leafSeason: 0.92, canopy: 0.8,
      dryness: 0.7, flowers: 0.05, sunElevation: 14, sunAzimuth: 230, sunIntensity: 2.8, bloom: 0.4,
      cloudCover: 0.5, highClouds: 0.4, haze: 0.45, mist: 0.2, birds: 0.45, translucency: 1.3,
      skyZenith: '#4b6a95', skyHorizon: '#e3c9a8', sunColor: '#ffcf96',
      grassBase: '#2c3517', grassTip: '#9a9a45', grassDry: '#c18f4a', groundA: '#32301a', groundB: '#45381e',
      cloudLit: '#ffe8cc', cloudShade: '#8b8a96', mistColor: '#e8d6bd', accent: '#d9773a',
    },
  },
  {
    id: 'night', name: 'Night',
    eyebrow: 'After dark',
    title: 'The field keeps its own lights.',
    sub: 'Fireflies, a cold moon and the grass still breathing in the dark.',
    camera: { radius: 27, height: 1.8, speed: 0.01, startAngle: 1.8 },
    values: {
      windStrength: 0.25, gustStrength: 0.8, gustSpeed: 0.6, turbulence: 0.3, pollen: 0, fireflies: 1,
      sunElevation: 28, sunAzimuth: 140, sunIntensity: 0.55, hemiIntensity: 0.35, exposure: 1.25, bloom: 0.9,
      cloudCover: 0.3, cloudDensity: 0.6, cloudSpeed: 0.25, highClouds: 0.25, haze: 0.4, mist: 0.45, stars: 1,
      flowers: 0.2, birds: 0, translucency: 0.5, sunSize: 0.75, glow: 0.4,
      skyZenith: '#050913', skyHorizon: '#1a2638', sunColor: '#9fb6e0', sunDisc: '#e8eefc',
      hemiSky: '#2c3c5c', hemiGround: '#0c120c', grassBase: '#0d1a12', grassTip: '#2f4a3a',
      groundA: '#0b130d', groundB: '#101a12', cloudLit: '#56648a', cloudShade: '#0e1422', mistColor: '#3a4a66',
      accent: '#c7e86a',
    },
  },
  {
    id: 'bonfire', name: 'Bonfire',
    eyebrow: 'Fifth of November',
    title: 'Remember, remember.',
    sub: 'A fire inside the old stones, embers on the wind and smoke where the stars should be.',
    camera: { radius: 21, height: 2.3, speed: 0.012, startAngle: 4.05, lookY: 3.4 },
    values: {
      subject: 'stones',
      windStrength: 0.4, gustStrength: 1.1, turbulence: 0.5, pollen: 0, fire: 1, fireflies: 0,
      sunElevation: 9, sunAzimuth: 300, sunIntensity: 0.6, hemiIntensity: 0.35, exposure: 1.15, bloom: 1.0,
      cloudCover: 0.8, cloudDensity: 1.2, cloudSpeed: 0.6, highClouds: 0.5, haze: 0.7, mist: 0.35, stars: 0.25,
      flowers: 0, dryness: 0.5, birds: 0, translucency: 0.6, glow: 0.5, sunSize: 0.8,
      skyZenith: '#120608', skyHorizon: '#6b1f12', sunColor: '#ff6a3a', sunDisc: '#ffb08a',
      hemiSky: '#4a1d1a', hemiGround: '#140806', grassBase: '#1a1208', grassTip: '#5a3a18', grassDry: '#7a4a1e',
      groundA: '#140c08', groundB: '#1d120a', cloudLit: '#a2341c', cloudShade: '#1d0806', mistColor: '#5a2014',
      accent: '#ff5a2a',
    },
  },
];

export function presetValues(preset) {
  return { ...DEFAULTS, ...preset.values };
}

export function formatValue(def, v) {
  if (def.season) {
    if (v < 0.2) return 'Summer';
    if (v < 0.55) return 'Turning';
    if (v < 0.85) return 'Autumn';
    return 'Late autumn';
  }
  if (def.pct) return `${Math.round(v * 100)} %`;
  if (def.unit === '°') return `${Math.round(v)}°`;
  const digits = def.step >= 1 ? 0 : 2;
  return `${v.toFixed(digits)} ${def.unit}`.trim();
}
