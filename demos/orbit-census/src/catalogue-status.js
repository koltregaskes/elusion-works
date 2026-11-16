import {ASSEMBLY_FRESHNESS_MS,GP_FRESHNESS_MS,SATCAT_FRESHNESS_MS,responseFreshnessLimit} from './freshness-policy.js';
import {GROUPS,FIELDS,TYPES} from './catalog.js';
import {orbitShape} from './classify.js';
const HOUR=3600000, DAY=24*HOUR;
// Gross consistency check using the same two-body mean-element model as the UI.
// A 50 km allowance below the model's reference surface avoids pretending these
// mean elements resolve the real surface/ellipsoid or re-entry trajectory.
// This is not an SGP4 viability, collision or operational-safety determination.
export const ORBIT_ALTITUDE_TOLERANCE_KM=50;
export function inspectCatalogue(doc,{now=Date.now(),requireComplete=false}={}) {
  const fail=message=>{throw Error(message);};
  if (!Array.isArray(doc?.rows) || !doc.rows.length) fail('empty catalogue.');
  if (doc.v!==1 || !Array.isArray(doc.fields) || FIELDS.some((field,i)=>doc.fields[i]!==field) || doc.fields.length!==FIELDS.length) fail('unexpected catalogue schema.');
const groupIds = new Set(GROUPS.map(g => g.id));
const ids = new Set();
const validEpoch = value => {
  // satellite.js treats an epoch without a timezone as UTC and appends Z.
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/);
  if (!parts) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month && date.getUTCDate() === day &&
    date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
};
// Rows are compact arrays matching FIELDS, consumed by main.js and rowToOmm.
// No malformed rows are allowed through publication, even if the worker could skip them.
for (const [index, row] of doc.rows.entries()) {
  const bad = reason => fail(`row ${index + 1}: ${reason}.`);
  if (!Array.isArray(row) || row.length !== FIELDS.length) bad('expected a complete compact row');
  if ([0, 2, 3, 4, 5, 6, 8, 9].some(i => typeof row[i] !== 'string') || !row[0].trim()) bad('invalid text fields');
  if (!Number.isSafeInteger(row[1]) || row[1] <= 0 || ids.has(row[1])) bad('invalid or duplicate NORAD identifier');
  ids.add(row[1]);
  if (!Object.hasOwn(TYPES, row[3]) || !groupIds.has(row[8])) bad('unknown type or GP group');
  if (row[7] !== null && (!Number.isFinite(row[7]) || row[7] < 0)) bad('invalid radar cross-section');
  if (!validEpoch(row[9])) bad('invalid epoch');
  if (row.slice(10).some(value => !Number.isFinite(value))) bad('non-finite orbital element');
  // Bound Earth orbits: mean motion in rev/day (20 allows margin above surface orbit),
  // eccentricity [0,1), inclination [0,180], and cyclic angles [0,360) degrees.
  // Drag and derivatives may be signed; require finite numbers without arbitrary caps.
  if (!(row[10] > 0 && row[10] <= 20) || row[11] < 0 || row[11] >= 1 ||
      row[12] < 0 || row[12] > 180 || [13, 14, 15].some(i => row[i] < 0 || row[i] >= 360)) bad('orbital element out of range');
  const geometry=orbitShape(row[10],row[11]);
  if (![geometry.a,geometry.peri,geometry.apo].every(Number.isFinite) || geometry.a<=0 ||
      geometry.peri < -ORBIT_ALTITUDE_TOLERANCE_KM || geometry.apo < -ORBIT_ALTITUDE_TOLERANCE_KM ||
      geometry.apo < geometry.peri) bad('combined orbit geometry inconsistent with the model surface tolerance');
}

  if (typeof doc.generated!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(doc.generated) || !validEpoch(doc.generated)) fail('invalid acquisition time.');
  if (/synthetic/i.test(doc.source||'')) fail('synthetic catalogue is not an acquired snapshot.');
  const acquired=Date.parse(doc.generated);
  if (acquired>now+5*60000) fail('acquisition time is in the future.');
  const missingGroups=GROUPS.filter(g=>!Number.isSafeInteger(doc.groups?.[g.id])||doc.groups[g.id]<=0).map(g=>g.id);
  const counts=Object.keys(TYPES).map(t=>doc.census?.[t]);
  const censusValid=doc.satcat===true && Number.isSafeInteger(doc.census?.total) && doc.census.total>=10000 && counts.every(n=>Number.isSafeInteger(n)&&n>=0) && counts.reduce((a,b)=>a+b,0)===doc.census.total;
  const epochs=doc.rows.map(r=>Date.parse(r[9].endsWith('Z')?r[9]:r[9]+'Z')).sort((a,b)=>a-b);
  const oldElements=epochs.filter(t=>now-t>10*DAY).length;
  const futureElements=epochs.filter(t=>t>now+DAY).length;
  // A cached response keeps its original acquisition date; regenerating a document
  // must not turn old upstream bytes into a fresh acquisition.
  const responses=Object.entries(doc.acquisition||{}).map(([url,metadata])=>{
    const value=metadata?.acquired;
    // #121 keeps each response's original acquisition date, even on cache hits.
    // Date.parse alone normalises nonexistent days; validate the calendar first.
    if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || !validEpoch(value)) fail('invalid response acquisition time.');
    const time=Date.parse(value);
    if(!Number.isFinite(time)||time>now+5*60000) fail('invalid response acquisition time.');
    // SATCAT's 24-hour cache must not force another provider download at 18 h.
    // GP and assembly retain the existing 18-hour application freshness limit.
    return {time,limit:responseFreshnessLimit(url)};
  });
  const oldestAcquisition=Math.min(acquired,...responses.map(r=>r.time));
  const staleAcquisition=now-acquired>ASSEMBLY_FRESHNESS_MS || responses.some(r=>now-r.time>r.limit);
  const partial=missingGroups.length>0 || !censusValid || doc.rows.length<2000;
  if(requireComplete){
    if(doc.rows.length<2000)fail('fewer than 2000 objects.');
    if(missingGroups.length)fail('GP group '+missingGroups[0]+' failed or was empty.');
    if(!censusValid)fail('SATCAT fetch failed or inconsistent census counts or census has fewer than 10000 objects.');
    if(staleAcquisition)fail('stale acquisition; keeping the previous deployment.');
  }
  return {acquired,oldestAcquisition,staleAcquisition,partial,missingGroups,censusValid,oldElements,futureElements,
    epochOldest:epochs[0],epochNewest:epochs.at(-1),epochMedian:epochs[epochs.length>>1]};
}
const date=ms=>new Date(ms).toISOString().replace('T',' ').replace(/\.\d+Z$/,' UTC');
export function catalogueNotice(doc,report) {
  const flags=[report.partial?'Partial coverage':'Selected-group coverage',report.staleAcquisition?'Stale acquisition':null,
    report.oldElements?report.oldElements+' element sets over 10 days old':null,report.futureElements?'Future-dated element sets':null].filter(Boolean);
  return flags.join(' · ')+'. Catalogue assembled '+date(report.acquired)+'. Oldest acquisition '+date(report.oldestAcquisition)+
    '. Element epochs '+date(report.epochOldest)+' to '+date(report.epochNewest)+'. Missing groups: '+(report.missingGroups.join(', ')||'none')+
    '. '+(doc.satcat===true?'SATCAT enrichment reported.':'SATCAT unavailable; object types inferred from names.')+
    ' Provider edition is unverified unless response metadata supplies it. Acquisition time is not element epoch. Positions are propagated estimates. '+`Freshness limits: assembly ${ASSEMBLY_FRESHNESS_MS/HOUR} hours; GP acquisition ${GP_FRESHNESS_MS/HOUR} hours; SATCAT acquisition ${SATCAT_FRESHNESS_MS/HOUR} hours.`;
}
