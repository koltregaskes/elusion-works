#!/usr/bin/env node
import { catalogueSource } from "../src/source-label.js";
// Builds data/catalog.json for Orbit Census from CelesTrak.
// Runs in the Pages deploy (twice a day, matching CelesTrak's own update rhythm) and can be
// run by hand: `node demos/orbit-census/tools/build-catalog.mjs`.
//
// Exit codes: 0 written; 2 fetched but too few objects (file left untouched); 1 network error.
// A failed run never overwrites a good catalogue: the page then falls back to a live fetch.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CELESTRAK_GP, CELESTRAK_SATCAT, GROUPS, FIELDS, mergeGroups, parseCsv } from '../src/catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] || resolve(here, '../data/catalog.json'));
const UA = 'ElusionWorks-OrbitCensus/1.0 (+https://elusionworks.com/demos/orbit-census/)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, kind) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: kind === 'json' ? 'application/json' : 'text/csv' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = kind === 'json' ? await res.json() : await res.text();
      return body;
    } catch (e) {
      console.warn(`  ${url} attempt ${a + 1}: ${e.message}`);
      await sleep(2000 * (a + 1));
    }
  }
  return null;
}

const byGroup = [];
const counts = {};
for (const g of GROUPS) {
  const recs = await get(`${CELESTRAK_GP}?GROUP=${g.id}&FORMAT=json`, 'json');
  counts[g.id] = Array.isArray(recs) ? recs.length : null;
  console.log(`GP ${g.id}: ${counts[g.id] ?? 'failed'}`);
  if (Array.isArray(recs)) byGroup.push({ id: g.id, records: recs });
  await sleep(1200);
}

let satcat = null; let census = null;
const csv = await get(CELESTRAK_SATCAT, 'text');
if (csv) {
  const rows = parseCsv(csv);
  satcat = new Map(rows.map((r) => [Number(r.NORAD_CAT_ID), r]));
  // The whole public catalogue still in Earth orbit, tracked or not, by type.
  census = { total: 0, PAY: 0, 'R/B': 0, DEB: 0, UNK: 0, decayed: 0 };
  for (const r of rows) {
    if (r.DECAY_DATE) { census.decayed++; continue; }
    if (r.ORBIT_CENTER && r.ORBIT_CENTER !== 'EA') continue;
    census.total++; census[r.OBJECT_TYPE] = (census[r.OBJECT_TYPE] || 0) + 1;
  }
  console.log(`SATCAT: ${rows.length} rows, ${census.total} on orbit`);
} else console.warn('SATCAT failed: types fall back to names');

const rows = mergeGroups(byGroup, satcat);
console.log(`Merged: ${rows.length} objects`);
if (!byGroup.length) { console.error('No GP group fetched.'); process.exit(1); }
if (rows.length < 2000) { console.error(`Only ${rows.length} objects: refusing to overwrite.`); process.exit(2); }

const doc = {
  v: 1,
  generated: new Date().toISOString(),
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
