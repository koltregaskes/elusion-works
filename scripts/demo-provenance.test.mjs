import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const read=p=>fs.readFileSync('demos/'+p,'utf8');
test('four outer-planet counts and visible fact cards agree with checked JPL edition',()=>{
  const window={};vm.runInNewContext(read('solar-system-field-lab/planet-data.jsx'),{window});
  for(const [key,n] of Object.entries({jupiter:115,saturn:293,uranus:29,neptune:16})){
    const p=window.PLANETS.find(p=>p.key===key);assert.equal(p.moonCount,n);assert.match(p.facts.find(f=>f[0]==='Moons')[1],new RegExp('^'+n+' IAU-recognised$'));
  }
});
test('direct provenance and limited verification scope appear in both views',()=>{
  for(const name of ['field-lab.jsx','planet-detail.jsx']){const s=read('solar-system-field-lab/'+name);assert.match(s,/https:\/\/ssd.jpl.nasa.gov\/sats\/discovery.html/);assert.match(s,/16 November 2026/);assert.match(s,/unverified/);}
});
test('Nexus has no freshness promise or relative release timestamps',()=>{
  const html=read('nexus-aetherial/index.html');assert.match(html,/Illustrative static dataset/);assert.match(html,/without primary citations/);assert.match(html,/The dataset is static and unverified; it does not track current releases\./);
  assert.doesNotMatch(html,/LIVE FEED|ROLLING ·|EVERY 6 HOURS|UPDATED 06:21|live benchmark/);
  assert.doesNotMatch(html,/digested in real time|see the field move|before the press release lands/i);
  assert.doesNotMatch(read('nexus-aetherial/digest.js'),/UPDATED 06:21/);
  assert.doesNotMatch(read('nexus-aetherial/data.js'),/t: '(?:NOW|T\\u2212)/);
});
