import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {CELESTRAK_GP,CELESTRAK_SATCAT,GROUPS} from '../demos/orbit-census/src/catalog.js';
import {GP_CACHE_MS,GP_FRESHNESS_MS,SATCAT_CACHE_MS,SATCAT_FRESHNESS_MS,HOUR_MS} from '../demos/orbit-census/src/freshness-policy.js';

const root=process.cwd(), now=Date.parse('2026-03-02T08:00:00Z');
const workflow=fs.readFileSync('.github/workflows/pages.yml','utf8');
const gate=workflow.match(/node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n          NODE/)[1]
  .split(/\r?\n/).map(s=>s.replace(/^          /,'')).join('\n');
fs.mkdirSync('.local',{recursive:true});
const preload=new URL('./fixtures/catalogue-reconciliation-fetch.mjs',import.meta.url).href;
const clock=new URL('./fixtures/catalogue-reconciliation-clock.mjs',import.meta.url).href;
function fixture(age) {
  const dir=fs.mkdtempSync(path.join(root,'.local/catalogue-reconciliation-'));
  fs.mkdirSync(path.join(dir,'demos/orbit-census/src'),{recursive:true});
  fs.mkdirSync(path.join(dir,'_site/demos/orbit-census/data'),{recursive:true});
  fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');
  for(const name of ['catalog.js','classify.js','catalogue-status.js','freshness-policy.js'])
    fs.copyFileSync('demos/orbit-census/src/'+name,path.join(dir,'demos/orbit-census/src',name));
  const out=path.join(dir,'_site/demos/orbit-census/data/catalog.json'),cache=path.join(dir,'cache.json');
  const build=spawnSync(process.execPath,['--import',preload,path.join(root,'demos/orbit-census/tools/build-catalog.mjs'),out,'complete',cache,String(age)],{cwd:dir,encoding:'utf8'});
  assert.equal(build.status,0,build.stdout+build.stderr);
  return {out,cache,doc:JSON.parse(fs.readFileSync(out)),runGate:()=>spawnSync(process.execPath,['--import',clock,'--input-type=module'],{cwd:dir,input:gate,encoding:'utf8'})};
}
test('cache-valid dataset ages fit publication limits',()=>{
  assert.ok(GP_CACHE_MS<=GP_FRESHNESS_MS);
  assert.equal(SATCAT_CACHE_MS,SATCAT_FRESHNESS_MS);
});
test('actual merged builder and workflow publish 20-hour cached SATCAT without another provider request',()=>{
  const f=fixture(20),result=f.runGate();
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.cache+'.requests.json')),[]);
  assert.equal(f.doc.acquisition[CELESTRAK_SATCAT].acquired,new Date(now-20*HOUR_MS).toISOString());
  for(const group of GROUPS)assert.equal(f.doc.acquisition[`${CELESTRAK_GP}?GROUP=${group.id}&FORMAT=csv`].acquired,new Date(now-HOUR_MS).toISOString());
  assert.deepEqual(Object.keys(f.doc.acquisition).sort(),[...GROUPS.map(g=>`${CELESTRAK_GP}?GROUP=${g.id}&FORMAT=csv`),CELESTRAK_SATCAT].sort());
  assert.equal(f.doc.acquisition[CELESTRAK_SATCAT].etag,'fixture-satcat');
});
test('over-24-hour SATCAT is refreshed; the exact workflow rejects its unrefreshed original date',()=>{
  const f=fixture(25),requests=JSON.parse(fs.readFileSync(f.cache+'.requests.json'));
  assert.equal(requests.length,1);assert.equal(requests[0].url,CELESTRAK_SATCAT);
  assert.match(requests[0].accept,/text\/csv.*\*\/\*/);assert.match(requests[0].userAgent,/ElusionWorks-OrbitCensus/);
  assert.equal(f.doc.acquisition[CELESTRAK_SATCAT].acquired,new Date(now).toISOString());
  let result=f.runGate();assert.equal(result.status,0,result.stdout+result.stderr);
  f.doc.acquisition[CELESTRAK_SATCAT].acquired=new Date(now-25*HOUR_MS).toISOString();
  fs.writeFileSync(f.out,JSON.stringify(f.doc));
  result=f.runGate();assert.equal(result.status,1);assert.match(result.stderr,/stale acquisition/);
});
test('reconciliation retains one acquisition path, source map, notice and main landmark',()=>{
  const builder=fs.readFileSync('demos/orbit-census/tools/build-catalog.mjs','utf8');
  assert.equal([...builder.matchAll(/^const acquisition =/gm)].length,1);
  assert.equal([...builder.matchAll(/^  acquisition,$/gm)].length,1);
  assert.doesNotMatch(builder,/FORMAT=json|async function get\(/);
  assert.match(workflow,/cache\/restore@v4/);assert.match(workflow,/always\(\)[\s\S]*cache\/save@v4/);
  const html=fs.readFileSync('demos/orbit-census/index.html','utf8');
  assert.equal([...html.matchAll(/<main\b/g)].length,1);assert.equal([...html.matchAll(/<\/main>/g)].length,1);
  assert.match(html,/<main id="orbit-main"[\s\S]*id="dataNotice"[\s\S]*<\/main>/);
  assert.doesNotMatch(fs.readFileSync('demos/orbit-census/src/main.js','utf8'),/loadLive|fetch\(`\$\{CELESTRAK_GP\}/);
});
