import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createAcquirer,RETRY_STATE,QUIET} from '../demos/orbit-census/tools/acquire.mjs';
const response=(status=200,headers={})=>({status,headers:new Headers(headers),text:async()=>'bytes'});
test('fetch-style rejected redirect is terminal, including its actual cause chain',async()=>{
  let calls=0;const cache=new Map();
  const get=createAcquirer({cache,fetcher:async(url,options)=>{calls++;assert.equal(options.redirect,'error');throw new TypeError('fetch failed',{cause:Error('unexpected redirect')});},sleep:async()=>assert.fail('redirect must not sleep')});
  await assert.rejects(get('https://fixture/a',1),/redirect rejected/);await assert.rejects(get('https://fixture/b',1),/stopped/);assert.equal(calls,1);
});
test('successful bytes survive a later failure and a JSON round trip',async()=>{
  const cache=new Map();let saved,calls=0;
  const get=createAcquirer({cache,now:()=>1000,persist:async map=>{saved=JSON.stringify([...map]);},fetcher:async()=>++calls===1?response():response(403)});
  await get('https://fixture/good',2000);await assert.rejects(get('https://fixture/bad',2000));
  const restored=new Map(JSON.parse(saved));assert.equal(restored.get('https://fixture/good').body,'bytes');
  const hit=await createAcquirer({cache:restored,now:()=>2000,fetcher:async()=>assert.fail('must reuse saved response')})('https://fixture/good',2000);
  assert.equal(hit.acquired,1000);
});
for(const retryAfter of ['7200','Thu, 01 Jan 1970 02:00:01 GMT'])test('long Retry-After survives restart and blocks concurrent acquirers: '+retryAfter,async()=>{
  const cache=new Map();let saved,calls=0,clock=1000;
  const options={cache,now:()=>clock,persist:async map=>{saved=JSON.stringify([...map]);},fetcher:async()=>{calls++;return response(503,{'Retry-After':retryAfter});},sleep:async()=>assert.fail('long pause ends the run')};
  const a=createAcquirer(options),b=createAcquirer(options);
  const results=await Promise.allSettled([a('https://fixture/a',1),b('https://fixture/b',1)]);
  assert.ok(results.every(x=>x.status==='rejected'));assert.equal(calls,1);assert.equal(cache.get(RETRY_STATE).retryUntil,7201000);
  const restored=new Map(JSON.parse(saved));
  await assert.rejects(createAcquirer({...options,cache:restored})('https://fixture/c',1),/paused until/);assert.equal(calls,1);
  clock=7201000;
  await createAcquirer({...options,cache:restored,fetcher:async()=>{calls++;return response();}})('https://fixture/c',1);assert.equal(calls,2);
});
test('concurrent same-URL acquirers share one request',async()=>{
  const cache=new Map();let calls=0;const options={cache,fetcher:async()=>{calls++;await Promise.resolve();return response();}};
  await Promise.all([createAcquirer(options)('https://fixture/a',1),createAcquirer(options)('https://fixture/a',1)]);assert.equal(calls,1);
});
test('ordinary network failures also persist their quiet period',async()=>{
  let clock=1000,saved;const cache=new Map();
  const get=createAcquirer({cache,now:()=>clock,persist:async map=>{saved=JSON.stringify([...map]);},fetcher:async()=>{throw Error('offline');},sleep:async ms=>{clock+=ms;}});
  await assert.rejects(get('https://fixture/a',1));assert.ok(new Map(JSON.parse(saved)).get(RETRY_STATE).retryUntil>clock);
});
test('workflow saves independently of later failure and serialises hosted runs',()=>{
  const workflow=fs.readFileSync('.github/workflows/pages.yml','utf8');
  assert.match(workflow,/uses: actions\/cache\/restore@v4/);assert.doesNotMatch(workflow,/uses: actions\/cache@/);
  assert.match(workflow,/if: \$\{\{ always\(\) && hashFiles\('\.local\/celestrak-cache.json'\) != '' \}\}\s+uses: actions\/cache\/save@v4/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.ok(workflow.indexOf('uses: actions/cache/save@v4')<workflow.indexOf('name: Validate Orbit Census'));
});

for(const sameAcquirer of [false,true])test('terminal errors cancel queued provider requests, same acquirer: '+sameAcquirer,async()=>{
  const cache=new Map();let calls=0;const options={cache,fetcher:async()=>{calls++;return response(403);}};
  const a=createAcquirer(options),b=sameAcquirer?a:createAcquirer(options);
  const results=await Promise.allSettled([a('https://fixture/a',1),b('https://fixture/b',1)]);
  assert.ok(results.every(r=>r.status==='rejected'));assert.equal(calls,1);
});
