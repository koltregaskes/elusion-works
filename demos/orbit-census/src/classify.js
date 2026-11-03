// Derived facts per object: orbit shape, regime, constellation, owner, colours.
const MU = 398600.4418; // km^3/s^2
const RE = 6378.137; // km, WGS-72 equatorial radius used by SGP4

export function orbitShape(nRevPerDay, e) {
  const n = (nRevPerDay * 2 * Math.PI) / 86400; // rad/s
  const a = Math.cbrt(MU / (n * n));
  return { a, apo: a * (1 + e) - RE, peri: a * (1 - e) - RE, period: 1440 / nRevPerDay };
}

export function regime(o, e) {
  if (e > 0.25) return 'HEO';
  if (o.period > 1400 && o.period < 1480 && e < 0.02) return 'GEO';
  if (o.apo < 2000) return 'LEO';
  if (o.peri > 36500) return 'Beyond GEO';
  return 'MEO';
}

// Constellations and families by name. Order matters: first match wins.
export const FAMILIES = [
  { id: 'starlink', label: 'Starlink', re: /^STARLINK/, color: '#5ad8ff' },
  { id: 'oneweb', label: 'OneWeb', re: /^ONEWEB/, color: '#b98cff' },
  { id: 'kuiper', label: 'Kuiper', re: /^KUIPER/, color: '#ffb347' },
  { id: 'qianfan', label: 'Qianfan', re: /^(QIANFAN|G60)/, color: '#ff6b8b' },
  { id: 'guowang', label: 'Guowang', re: /^(GUOWANG|SATNET)/, color: '#ff8f5a' },
  { id: 'iridium', label: 'Iridium', re: /^IRIDIUM(?!.*DEB)/, color: '#7cf0b4' },
  { id: 'globalstar', label: 'Globalstar', re: /^GLOBALSTAR/, color: '#e6e27a' },
  { id: 'orbcomm', label: 'Orbcomm', re: /^ORBCOMM/, color: '#9fb4c8' },
  { id: 'planet', label: 'Planet', re: /^(FLOCK|DOVE|SKYSAT|PELICAN)/, color: '#c7f464' },
  { id: 'spire', label: 'Spire', re: /^LEMUR/, color: '#f4a7d3' },
  { id: 'gps', label: 'GPS', re: /^(GPS|NAVSTAR)/, color: '#4fa3ff' },
  { id: 'glonass', label: 'GLONASS', re: /GLONASS/, color: '#ff5d5d' },
  { id: 'galileo', label: 'Galileo', re: /(GALILEO|^GSAT0)/, color: '#ffd84a' },
  { id: 'beidou', label: 'BeiDou', re: /^BEIDOU/, color: '#ff9a3d' },
  { id: 'qzss', label: 'QZSS', re: /^(QZS|MICHIBIKI)/, color: '#c39bff' },
  { id: 'navic', label: 'NavIC', re: /^(IRNSS|NVS)/, color: '#55e0c6' },
  { id: 'stations', label: 'Stations and crew', re: /^(ISS|CSS|TIANHE|WENTIAN|MENGTIAN|SOYUZ|PROGRESS|SHENZHOU|TIANZHOU|CREW DRAGON|DRAGON|CYGNUS|STARLINER|HTV)/, color: '#ffffff' },
];
export const NAV = new Set(['gps', 'glonass', 'galileo', 'beidou', 'qzss', 'navic']);
export const MEGA = new Set(['starlink', 'oneweb', 'kuiper', 'qianfan', 'guowang', 'iridium', 'globalstar', 'orbcomm']);

export function family(name) {
  const n = String(name).toUpperCase();
  for (const f of FAMILIES) if (f.re.test(n)) return f.id;
  return null;
}

// SATCAT owner codes for the ones that matter most; anything else shows its code.
export const OWNERS = {
  US: 'United States', PRC: 'China', CIS: 'Russia / USSR', UK: 'United Kingdom', FR: 'France', JPN: 'Japan',
  IND: 'India', ESA: 'European Space Agency', GER: 'Germany', IT: 'Italy', CA: 'Canada', SKOR: 'South Korea',
  ISRA: 'Israel', BRAZ: 'Brazil', ARGN: 'Argentina', AUS: 'Australia', SPN: 'Spain', LUXE: 'Luxembourg',
  ITSO: 'Intelsat', SES: 'SES', EUTE: 'Eutelsat', GLOB: 'Globalstar', ORB: 'Orbcomm', ISS: 'ISS partners',
  AB: 'Arabsat', IRAN: 'Iran', NKOR: 'North Korea', UAE: 'UAE', SAUD: 'Saudi Arabia', TURK: 'Türkiye',
  NOR: 'Norway', SWED: 'Sweden', FIN: 'Finland', NETH: 'Netherlands', TBD: 'Undetermined', UNK: 'Unknown',
  EUME: 'EUMETSAT', ASRA: 'Austria', SING: 'Singapore', INDO: 'Indonesia', TWN: 'Taiwan', THAI: 'Thailand',
  MEX: 'Mexico', SAFR: 'South Africa', EGYP: 'Egypt', NZ: 'New Zealand', O3B: 'O3b / SES', IM: 'Inmarsat',
};
export const ownerName = (c) => OWNERS[c] || c || 'Not listed';

// Colour sets. Type colours are the default and the legend everyone learns first.
export const TYPE_COLORS = { PAY: '#7fe3ff', 'R/B': '#ffb547', DEB: '#ff5277', UNK: '#9aa3ad' };
export const REGIME_COLORS = { LEO: '#7fe3ff', MEO: '#b59bff', GEO: '#ffd166', HEO: '#ff7a59', 'Beyond GEO': '#c0c6cf' };
export const OWNER_TOP = ['US', 'PRC', 'CIS', 'UK', 'JPN', 'IND', 'FR', 'ESA'];
export const OWNER_COLORS = { US: '#5aa9ff', PRC: '#ff5757', CIS: '#ffb04d', UK: '#b98cff', JPN: '#ff8fc7', IND: '#7ef0a0', FR: '#62e3e3', ESA: '#ffe066', other: '#8792a0' };

export const SITES = {
  AFETR: 'Cape Canaveral', AFWTR: 'Vandenberg', TYMSC: 'Baikonur', PKMTR: 'Plesetsk', JSC: 'Jiuquan', TSC: 'Taiyuan',
  XSC: 'Xichang', WSC: 'Wenchang', KYMSC: 'Kapustin Yar', FRGUI: 'Kourou', SRILR: 'Sriharikota', TNSTA: 'Tanegashima',
  KSCUT: 'Uchinoura', WLPIS: 'Wallops', RLLB: 'Rocket Lab, Mahia', VOSTO: 'Vostochny', SVOBO: 'Svobodny', SEAL: 'Sea Launch',
  OREN: 'Dombarovsky', NSC: 'Naro', SNMLP: 'San Marco', YAVNE: 'Palmachim', SEMLS: 'Semnan', YUN: 'Sohae', KODAK: 'Kodiak',
  ERAS: 'Air launch', SCSLC: 'Jiuquan sea launch', DLS: 'Dombarovsky', SMTS: 'Shahrud', RLKS: 'Rocket Lab, Wallops',
  STAR: 'Starbase', TAISC: 'Taiyuan', HGSTR: 'Hammaguira', WOMRA: 'Woomera', KWAJ: 'Kwajalein',
};
export const siteName = (c) => SITES[c] || c || '';

export const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
