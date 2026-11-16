import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=p=>fs.readFileSync('demos/atmosphere/'+p,'utf8');
test('legacy credential migration removes named values without ever reading them',()=>{
  const removed=[];const window={};vm.runInNewContext(source('atm-data.js'),{window,localStorage:{removeItem:k=>removed.push(k),getItem:()=>assert.fail('credential read')}});
  assert.deepEqual(removed,['atm.wu_api_key','atm.maps_api_key']);assert.equal(typeof window.AtmData.altitude,'function');
});
test('blocked storage does not prevent the simulation',()=>{const window={};vm.runInNewContext(source('atm-data.js'),{window,localStorage:{removeItem:()=>{throw Error('disabled');}}});assert.equal(window.AtmData.altitude(6),0);});
test('no inputs, reads or writes solicit or retain credentials',()=>{
  for(const name of ['index.html','atm-pages.jsx','atm-data.js']){
    const text=source(name);assert.doesNotMatch(text,/type="password"|station\.apiKey|setWuKey|setMapsKey/);
    assert.doesNotMatch(text,/(?:getItem|setItem)\(['"]atm\.(?:wu|maps)_api_key/);
  }
});
test('simulation and provider-free status are persistent and shared in metadata',()=>{
  const text=source('index.html');assert.match(text,/Simulated weather\. Replay, future scenarios and solar values are illustrative/);assert.match(text,/Weather is generated from your local date/);assert.match(text,/No weather or maps service is connected/);
  assert.doesNotMatch(source('atm-pages.jsx'),/FORECAST · ECMWF|HISTORY · STATION FEED|Google Maps API key|WU API key/);
  assert.match(source('atm-pages.jsx'),/disabled>Weather connection unavailable/);
  assert.match(source('atm-playback.jsx'),/ILLUSTRATIVE REPLAY/);
});
