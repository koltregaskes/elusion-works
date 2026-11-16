#!/usr/bin/env node
import { createAcquirer } from "./acquire.mjs";
import { catalogueSource } from "../src/source-label.js";
// Builds data/catalog.json for Orbit Census from CelesTrak.
// Runs in Pages with a shared GP (2 h) / SATCAT (24 h) acquisition cache; can be
// run by hand: `node demos/orbit-census/tools/build-catalog.mjs`.
//
// Exit codes: 0 written; 2 fetched but too few objects (file left untouched); 1 network error.
// A failed provider run stops acquisition and leaves the previous catalogue untouched.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CELESTRAK_GP, CELESTRAK_SATCAT, GROUPS, FIELDS, TYPES, mergeGroups, parseCsv } from '../src/catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] || resolve(here, '../data/catalog.json'));
const cachePath = resolve(process.argv[4] || '.local/celestrak-cache.json');
let cache;
try { cache = new Map(JSON.parse(await readFile(cachePath, 'utf8'))); }
catch (error) { if(error.code !== 'ENOENT') throw error; cache = new Map(); }
const persist = async () => {
  await mkdir(dirname(cachePath), {recursive:true});
  await writeFile(cachePath, JSON.stringify([...cache]));
};
const get = createAcquirer({cache, persist});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const acquisition = {};
async function csvData(url, ttl) {
  try {
    const result = await get(url, ttl);
    acquisition[url] = {acquired: new Date(result.acquired).toISOString(), lastModified: result.lastModified, etag: result.etag};
    return result.body;
  } catch (error) { console.error('No GP group fetched: provider run stopped: ' + error.message); process.exit(1); }
}

const byGroup = [];
const counts = {};
const orbitalFields = ['MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'];
for (const g of GROUPS) {
  const recs = parseCsv(await csvData(`${CELESTRAK_GP}?GROUP=${g.id}&FORMAT=csv`, 2 * 3600000));
  // toRow's numeric defaults must not disguise corrupt orbital input as valid zeroes.
  if (Array.isArray(recs) && recs.some(rec => !rec || orbitalFields.some(field =>
    !['number', 'string'].includes(typeof rec[field]) || String(rec[field]).trim() === '' || !Number.isFinite(Number(rec[field]))))) {
    console.error(`GP ${g.id}: missing or non-finite orbital element; refusing to overwrite.`);
    process.exit(1);
  }
  counts[g.id] = Array.isArray(recs) ? recs.length : null;
  console.log(`GP ${g.id}: ${counts[g.id] ?? 'failed'}`);
  if (Array.isArray(recs)) byGroup.push({ id: g.id, records: recs });
  await sleep(1200);
}

let satcat = null; let census = null;
const csv = await csvData(CELESTRAK_SATCAT, 24 * 3600000);
if (csv) {
  let rows = [];
  try { rows = parseCsv(csv); }
  catch (error) { console.warn(`SATCAT CSV: ${error.message}`); }
  // Validate the columns used for enrichment/census and every catalogue id/type before
  // claiming SATCAT succeeded. Error pages and header-only CSV are failed acquisitions.
  const required = ['NORAD_CAT_ID', 'OBJECT_TYPE', 'DECAY_DATE', 'ORBIT_CENTER'];
  const ids = new Set();
  const valid = rows.length > 0 && rows.every(r => {
    const id = Number(r.NORAD_CAT_ID);
    if (!required.every(field => Object.hasOwn(r, field)) || !/^[1-9]\d*$/.test(r.NORAD_CAT_ID) ||
        !Number.isSafeInteger(id) || ids.has(id) || !Object.hasOwn(TYPES, r.OBJECT_TYPE)) return false;
    ids.add(id);
    return true;
  });
  if (valid) {
    satcat = new Map(rows.map((r) => [Number(r.NORAD_CAT_ID), r]));
    // The whole public catalogue still in Earth orbit, tracked or not, by type.
    census = { total: 0, PAY: 0, 'R/B': 0, DEB: 0, UNK: 0, decayed: 0 };
    for (const r of rows) {
      if (r.DECAY_DATE) { census.decayed++; continue; }
      if (r.ORBIT_CENTER && r.ORBIT_CENTER !== 'EA') continue;
      census.total++; census[r.OBJECT_TYPE] = (census[r.OBJECT_TYPE] || 0) + 1;
    }
    console.log(`SATCAT: ${rows.length} rows, ${census.total} on orbit`);
  } else console.warn('SATCAT failed: malformed CSV, invalid header, catalogue identifiers or object types, or no rows; types fall back to names');
} else console.warn('SATCAT failed: types fall back to names');

const rows = mergeGroups(byGroup, satcat);
console.log(`Merged: ${rows.length} objects`);
if (!byGroup.length) { console.error('No GP group fetched.'); process.exit(1); }
if (rows.length < 2000) { console.error(`Only ${rows.length} objects: refusing to overwrite.`); process.exit(2); }

const doc = {
  v: 1,
  generated: new Date().toISOString(),
  acquisition,
  source: catalogueSource(Boolean(satcat?.size)),
  groups: counts,
  satcat: Boolean(satcat?.size),
  census,
  fields: FIELDS,
  rows,
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(doc));
console.log(`Wrote ${out} (${rows.length} objects)`);
