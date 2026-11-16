import test from 'node:test';import assert from 'node:assert/strict';
import {GROUPS,FIELDS,CELESTRAK_GP,CELESTRAK_SATCAT} from '../demos/orbit-census/src/catalog.js';
import {orbitShape} from '../demos/orbit-census/src/classify.js';
import {inspectCatalogue,catalogueNotice,ORBIT_ALTITUDE_TOLERANCE_KM} from '../demos/orbit-census/src/catalogue-status.js';
const now=Date.parse('2026-03-02T08:00:00Z'),hour=3600000;
const fixture=()=>({v:1,fields:FIELDS,generated:'2026-03-02T07:00:00Z',rows:Array.from({length:2000},(_,i)=>['Fixture',i+1,'','PAY','','','',null,'active','2026-03-02T00:00:00',15,.001,51,1,2,3,0,0,0]),groups:Object.fromEntries(GROUPS.map(g=>[g.id,1])),satcat:true,census:{total:10000,PAY:10000,'R/B':0,DEB:0,UNK:0}});
for(const date of ['2026-02-30T07:00:00Z','2026-02-29T07:00:00Z','2026-04-31T07:00:00Z','2026-03-02T07:00:00','2026-03-02T08:00:00+01:00','2026-03-02','2026-03-02T24:00:00Z','2026-03-02T07:60:00Z',null,123])test('reject response acquisition date '+JSON.stringify(date),()=>{
  const d=fixture();d.acquisition={gp:{acquired:date}};
  for(const requireComplete of [false,true])assert.throws(()=>inspectCatalogue(d,{now,requireComplete}),/invalid response acquisition time/);
});
test('real leap-day response and fractional UTC timestamps are accepted',()=>{
  const d=fixture();d.generated='2024-02-29T07:00:00.123Z';d.acquisition={gp:{acquired:'2024-02-29T06:00:00.123456Z'}};for(const r of d.rows)r[9]='2024-02-29T00:00:00';
  assert.doesNotThrow(()=>inspectCatalogue(d,{now:Date.parse('2024-02-29T08:00:00Z'),requireComplete:true}));
});
test('review control passes but high eccentricity with low semi-major axis fails',()=>{
  const d=fixture();assert.doesNotThrow(()=>inspectCatalogue(d,{now,requireComplete:true}));d.rows[0][11]=.99;
  for(const requireComplete of [false,true])assert.throws(()=>inspectCatalogue(d,{now,requireComplete}),/combined orbit geometry/);
});
test('perigee tolerance is explicit and enforced on both sides',()=>{
  for(const [altitude,valid] of [[-ORBIT_ALTITUDE_TOLERANCE_KM+1,true],[-ORBIT_ALTITUDE_TOLERANCE_KM-1,false]]){
    const d=fixture(),r=d.rows[0],circular=orbitShape(r[10],0);r[11]=1-(circular.a-circular.peri+altitude)/circular.a;
    if(valid)assert.doesNotThrow(()=>inspectCatalogue(d,{now,requireComplete:true}));else assert.throws(()=>inspectCatalogue(d,{now,requireComplete:true}),/combined orbit geometry/);
  }
});
test('valid eccentric distant orbit passes, circular underground orbit and non-finite geometry fail',()=>{
  const d=fixture();d.rows[0][10]=2;d.rows[0][11]=.7;assert.doesNotThrow(()=>inspectCatalogue(d,{now,requireComplete:true}));
  d.rows[0][10]=20;d.rows[0][11]=0;assert.throws(()=>inspectCatalogue(d,{now}),/combined orbit geometry/);
  d.rows[0][10]=Number.MIN_VALUE;assert.throws(()=>inspectCatalogue(d,{now}),/combined orbit geometry/);
});
test('#121 URL-keyed cached acquisition metadata retains 20-hour SATCAT without a forced refresh',()=>{
  const d=fixture();d.acquisition={
    [`${CELESTRAK_GP}?GROUP=active&FORMAT=csv`]:{acquired:new Date(now-hour).toISOString(),lastModified:null,etag:null},
    [CELESTRAK_SATCAT]:{acquired:new Date(now-20*hour).toISOString(),lastModified:null,etag:'fixture-edition'}
  };
  const r=inspectCatalogue(d,{now,requireComplete:true});assert.equal(r.oldestAcquisition,now-20*hour);assert.equal(r.staleAcquisition,false);
  assert.match(catalogueNotice(d,r),/SATCAT acquisition 24 hours/);
  d.acquisition[CELESTRAK_SATCAT].acquired=new Date(now-25*hour).toISOString();assert.throws(()=>inspectCatalogue(d,{now,requireComplete:true}),/stale acquisition/);
});
test('stale GP and assembly limits remain 18 hours independently of SATCAT',()=>{
  const d=fixture();d.acquisition={[CELESTRAK_SATCAT]:{acquired:new Date(now-hour).toISOString()},[CELESTRAK_GP]:{acquired:new Date(now-19*hour).toISOString()}};
  assert.throws(()=>inspectCatalogue(d,{now,requireComplete:true}),/stale acquisition/);
  delete d.acquisition[CELESTRAK_GP];d.generated=new Date(now-19*hour).toISOString();assert.throws(()=>inspectCatalogue(d,{now,requireComplete:true}),/stale acquisition/);
});
