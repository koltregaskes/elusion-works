import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createAcquirer,QUIET} from '../demos/orbit-census/tools/acquire.mjs';
const response=(status=200)=>({status,text:async()=>'shared',headers:new Headers()});
for(const code of [301,400,401,403,404,406,429,501]) test('stops provider run on HTTP '+code,async()=>{
  let calls=0;const get=createAcquirer({fetcher:async()=>{calls++;return response(code);},sleep:async()=>assert.fail('must not retry')});
  await assert.rejects(get('https://fixture/a',1));await assert.rejects(get('https://fixture/b',1));assert.equal(calls,1);
});
for(const code of [500,502,503,504,'network']) test('bounded quiet retries: '+code,async()=>{
  let calls=0,clock=1000;const waits=[];const get=createAcquirer({now:()=>clock,fetcher:async()=>{calls++;if(code==='network')throw Error('offline');return response(code);},sleep:async ms=>{waits.push(ms);clock+=ms;}});
  await assert.rejects(get('https://fixture/a',1));assert.equal(calls,3);assert.deepEqual(waits,[QUIET,2*QUIET]);
});
test('shared requests and fresh persisted responses never redownload within the run',async()=>{
  let calls=0;const cache=new Map();const opts={cache,now:()=>1000,fetcher:async(url,options)=>{calls++;assert.match(options.headers['User-Agent'],/ElusionWorks/);assert.equal(options.redirect,'error');assert.ok(options.signal);return response();}};
  const get=createAcquirer(opts);const [a,b]=await Promise.all([get('https://fixture/a',2000),get('https://fixture/a',2000)]);
  assert.equal(a,b);assert.equal(calls,1);await createAcquirer(opts)('https://fixture/a',2000);assert.equal(calls,1);
  await createAcquirer({...opts,now:()=>4000})('https://fixture/a',2000);assert.equal(calls,2);
});
test('Retry-After extends quiet interval',async()=>{
  let calls=0,clock=1000;const waits=[];const get=createAcquirer({now:()=>clock,fetcher:async()=>++calls===1?{...response(503),headers:new Headers({'Retry-After':'1800'})}:response(),sleep:async ms=>{waits.push(ms);clock+=ms;}});
  await get('https://fixture/a',1);assert.deepEqual(waits,[1800000]);
});
test('browser cannot query provider as an automatic fallback',()=>{
  const code=fs.readFileSync('demos/orbit-census/src/main.js','utf8');assert.doesNotMatch(code,/loadLive|fetch\(`\$\{CELESTRAK_GP\}/);
});
