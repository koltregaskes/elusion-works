import fs from 'node:fs';
import {FIXTURE_NOW} from './catalogue-reconciliation-clock.mjs';
import {CELESTRAK_GP,CELESTRAK_SATCAT,GROUPS} from '../../demos/orbit-census/src/catalog.js';
import {RETRY_STATE} from '../../demos/orbit-census/tools/acquire.mjs';

// Seed only synthetic data, reusing the repository's existing mocked CSV fixture.
await import('./catalogue-fetch.mjs');
const fixtureFetch = globalThis.fetch;
const cache = new Map(), hour = 3600000, cachePath = process.argv[4];
const satcatAgeHours = Number(process.argv[5]);
for (const group of GROUPS) {
  const url = `${CELESTRAK_GP}?GROUP=${group.id}&FORMAT=csv`;
  cache.set(url, {body:await (await fixtureFetch(url)).text(), acquired:FIXTURE_NOW-hour,
    lastModified:null, etag:'fixture-gp'});
}
cache.set(CELESTRAK_SATCAT, {body:await (await fixtureFetch(CELESTRAK_SATCAT)).text(),
  acquired:FIXTURE_NOW-satcatAgeHours*hour, lastModified:null, etag:'fixture-satcat'});
cache.set(RETRY_STATE, {retryUntil:FIXTURE_NOW-1});
fs.writeFileSync(cachePath,JSON.stringify([...cache]));
const requests=[];
globalThis.fetch = async (url,options) => {
  requests.push({url:String(url),accept:options.headers.Accept,userAgent:options.headers['User-Agent']});
  return fixtureFetch(url);
};
process.on('exit',()=>fs.writeFileSync(cachePath+'.requests.json',JSON.stringify(requests)));
