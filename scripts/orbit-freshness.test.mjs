import test from 'node:test';import assert from 'node:assert/strict';
import {GROUPS,FIELDS} from '../demos/orbit-census/src/catalog.js';
import {inspectCatalogue,catalogueNotice} from '../demos/orbit-census/src/catalogue-status.js';
const now=Date.parse('2026-11-16T08:00:00Z');
const row=['Fixture',1,'','PAY','','','',null,'active','2026-11-16T00:00:00',15,.01,51,1,2,3,0,0,0];
const fixture=()=>({v:1,fields:FIELDS,generated:'2026-11-16T07:00:00Z',rows:Array.from({length:2000},(_,i)=>{const r=[...row];r[1]=i+1;return r;}),groups:Object.fromEntries(GROUPS.map(g=>[g.id,1])),satcat:true,census:{total:10000,PAY:10000,'R/B':0,DEB:0,UNK:0}});
test('complete snapshot distinguishes acquisition and original element epoch',()=>{
  const d=fixture(),r=inspectCatalogue(d,{now,requireComplete:true});assert.equal(r.partial,false);assert.notEqual(r.acquired,r.epochOldest);assert.match(catalogueNotice(d,r),/2026-11-16 07:00:00 UTC.*2026-11-16 00:00:00 UTC/);
});
for(const [name,change] of [['empty',d=>d.rows=[]],['malformed row',d=>d.rows=[null]],['duplicate',d=>d.rows[1][1]=1],['bad date',d=>d.generated='2026-02-30T00:00:00Z'],['future',d=>d.generated='2027-01-01T00:00:00Z'],['no acquisition',d=>delete d.generated],['non-finite',d=>d.rows[0][10]=Infinity]])test('reject '+name,()=>{const d=fixture();change(d);assert.throws(()=>inspectCatalogue(d,{now}));});
test('partial coverage visible but cannot pass publication',()=>{
  const d=fixture();d.rows=[row];delete d.groups.stations;d.satcat=false;const r=inspectCatalogue(d,{now});
  assert.equal(r.partial,true);assert.match(catalogueNotice(d,r),/Partial coverage.*Missing groups: stations.*inferred/);assert.throws(()=>inspectCatalogue(d,{now,requireComplete:true}));
});
test('stale snapshot cannot pass publication; old epochs remain visibly dated',()=>{
  const d=fixture();d.generated='2026-11-10T00:00:00Z';d.rows[0][9]='2026-10-01T00:00:00';const r=inspectCatalogue(d,{now});
  assert.equal(r.staleAcquisition,true);assert.equal(r.oldElements,1);assert.match(catalogueNotice(d,r),/Stale acquisition.*over 10 days.*2026-10-01/);assert.throws(()=>inspectCatalogue(d,{now,requireComplete:true}));
});
test('cached response age survives fresh assembly',()=>{const d=fixture();d.acquisition={gp:{acquired:'2026-11-10T00:00:00Z'}};assert.equal(inspectCatalogue(d,{now}).staleAcquisition,true);});
