// Catalogue shape, shared by the browser and by tools/build-catalog.mjs (Node).
// One row per tracked object, as plain arrays so 19,000 objects stay small on the wire.
// Orbital elements are CelesTrak GP (OMM) mean elements, ready for SGP4.

export const CELESTRAK_GP = 'https://celestrak.org/NORAD/elements/gp.php';
export const CELESTRAK_SATCAT = 'https://celestrak.org/pub/satcat.csv';

// GP groups pulled together into one catalogue. "active" is every operational payload;
// the four debris groups are the big fragmentation clouds; the rest add rocket bodies,
// stations and recent launches that are not in "active". Duplicates collapse by NORAD id.
export const GROUPS = [
  { id: 'active', label: 'Active payloads' },
  { id: 'stations', label: 'Space stations' },
  { id: 'visual', label: '100 brightest' },
  { id: 'last-30-days', label: 'Launched in the last 30 days' },
  { id: 'fengyun-1c-debris', label: 'Fengyun-1C debris' },
  { id: 'cosmos-2251-debris', label: 'Cosmos 2251 debris' },
  { id: 'iridium-33-debris', label: 'Iridium 33 debris' },
  { id: 'cosmos-1408-debris', label: 'Cosmos 1408 debris' },
];

export const FIELDS = ['name', 'norad', 'cospar', 'type', 'owner', 'launch', 'site', 'rcs', 'group',
  'epoch', 'n', 'e', 'i', 'raan', 'argp', 'ma', 'bstar', 'ndot', 'nddot'];

export const TYPES = {
  PAY: { label: 'Payload', short: 'PAY' },
  'R/B': { label: 'Rocket body', short: 'R/B' },
  DEB: { label: 'Debris', short: 'DEB' },
  UNK: { label: 'Unknown', short: 'UNK' },
};

// Name-based type when SATCAT is not available (browser live fallback).
export function typeFromName(name, group) {
  const n = String(name || '').toUpperCase();
  if (/\bDEB\b|\bDEBRIS\b|\bCOOLANT\b|\bFRAG/.test(n)) return 'DEB';
  if (/R\/B|\bAKM\b|\bPKM\b|\bROCKET\b|\bSTAGE\b/.test(n)) return 'R/B';
  if (/-debris$/.test(group || '')) return 'DEB';
  return 'PAY';
}

const num = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const r = (v, p) => { const k = 10 ** p; return Math.round(num(v) * k) / k; };

// GP (OMM JSON) record + optional SATCAT row -> compact row matching FIELDS.
export function toRow(gp, group, sc) {
  const name = String(gp.OBJECT_NAME || '').trim();
  const type = sc?.OBJECT_TYPE || typeFromName(name, group);
  return [
    name,
    num(gp.NORAD_CAT_ID),
    String(gp.OBJECT_ID || sc?.OBJECT_ID || ''),
    type,
    sc?.OWNER || '',
    sc?.LAUNCH_DATE || '',
    sc?.LAUNCH_SITE || '',
    sc?.RCS ? r(sc.RCS, 3) : null,
    group,
    String(gp.EPOCH || ''),
    num(gp.MEAN_MOTION),
    num(gp.ECCENTRICITY),
    num(gp.INCLINATION),
    num(gp.RA_OF_ASC_NODE),
    num(gp.ARG_OF_PERICENTER),
    num(gp.MEAN_ANOMALY),
    num(gp.BSTAR),
    num(gp.MEAN_MOTION_DOT),
    num(gp.MEAN_MOTION_DDOT),
  ];
}

// Merge several GP group responses into one row list (first group wins for the tag).
export function mergeGroups(byGroup, satcat) {
  const seen = new Map();
  for (const { id, records } of byGroup) {
    for (const gp of records || []) {
      const k = num(gp.NORAD_CAT_ID);
      if (!k || seen.has(k)) continue;
      if (!(num(gp.MEAN_MOTION) > 0)) continue;
      seen.set(k, toRow(gp, id, satcat?.get(k)));
    }
  }
  return [...seen.values()].sort((a, b) => a[1] - b[1]);
}

// Row -> the OMM object satellite.js json2satrec wants.
export function rowToOmm(row) {
  return {
    OBJECT_NAME: row[0], NORAD_CAT_ID: row[1], OBJECT_ID: row[2], EPOCH: row[9],
    MEAN_MOTION: row[10], ECCENTRICITY: row[11], INCLINATION: row[12], RA_OF_ASC_NODE: row[13],
    ARG_OF_PERICENTER: row[14], MEAN_ANOMALY: row[15], BSTAR: row[16], MEAN_MOTION_DOT: row[17], MEAN_MOTION_DDOT: row[18],
  };
}

// Minimal RFC 4180 CSV parser (SATCAT names can contain commas inside quotes).
export function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((x) => x.length === head.length).map((x) => Object.fromEntries(head.map((h, i) => [h, x[i]])));
}
