import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectPrivacyHosts,referencedHosts} from './check-privacy-hosts.mjs';
import {backstopHosts} from './privacy-backstop.mjs';
import {decodeDataURL} from './privacy-data-documents.mjs';
const rows=JSON.parse(await fs.readFile(new URL('./fixtures/privacy-ew126-review.json',import.meta.url),'utf8'));
async function fixture(file,source,{mode='navigation',host='nav.invalid',allowed=['fonts.gstatic.com'],base='https://site.invalid/'}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ew-guard-parity-'));
  await fs.writeFile(path.join(dir,'privacy.html'),allowed.map(h=>`<code data-privacy-host="${h}">${h}</code>`).join('')+(mode==='navigation'?`<code data-privacy-navigation="${host}">${host}</code>`:''));
  await fs.writeFile(path.join(dir,'seo-config.json'),JSON.stringify({base}));
  await fs.writeFile(path.join(dir,file),source);
  if(mode==='mention')await fs.writeFile(path.join(dir,'privacy-non-request-mentions.json'),JSON.stringify({version:1,mentions:[{kind:'non-request mention',file,host,reason:'Reviewed inert control.'}]}));
  return dir;
}
for(const row of rows)for(const mode of ['navigation','mention'])test('EW independent review '+row.name+' / '+mode,async()=>{
  const dir=await fixture('page.html',row.source+'<!-- https://nav.invalid/reference -->',{mode});
  assert.equal((await inspectPrivacyHosts(dir)).errors.length>0,mode==='navigation'?row.expectedNavigationReject:row.expectedMentionReject);
});
const legacy=JSON.parse(await fs.readFile(new URL('./fixtures/privacy-review-regressions.json',import.meta.url),'utf8'));
for(const row of legacy.cases.filter(row=>row.expectedBeforeGuardParity))test('legacy inert source '+row.id+' retains explicit-mention acceptance',async()=>{
  const hosts=[...backstopHosts(row.source,{baseURL:row.base})];assert.equal(hosts.length,1);
  assert.deepEqual((await inspectPrivacyHosts(await fixture(row.file,row.source,{mode:'mention',host:hosts[0],allowed:row.allowedHosts,base:row.base}))).errors,[]);
});
test('normalisation artefacts need proven inert origins; active contexts remain checked',async()=>{
  const source='//\nexample.invalid.property;';
  assert.ok(backstopHosts(source).has('example.invalid.property'));
  assert.deepEqual((await inspectPrivacyHosts(await fixture('site.js',source,{mode:'mention',host:'example.invalid.property'}))).errors,[]);
  for(const suffix of ['\nfetch("https://example.invalid.property/x");','\nconst x="x_https://example.invalid.property/x";']){
    assert.ok((await inspectPrivacyHosts(await fixture('site.js',source+suffix,{mode:'mention',host:'example.invalid.property'}))).errors.length);
  }
});
test('metadata, navigation and a reviewed inert host never authorise a load',async()=>{
  for(const source of [
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://www.w3.org/x"/></svg>',
    '<script>const links={href:"https://nav.invalid/"};fetch("https://nav.invalid/x");</script>',
    '<a href="https://nav.invalid/"></a><div unknown-load="https://nav.invalid/x"></div>',
  ])assert.ok((await inspectPrivacyHosts(await fixture('page.html',source,{mode:'mention',host:source.includes('w3.org')?'www.w3.org':'nav.invalid'}))).errors.length);
});
test('WHATWG canonicalisation precedes data inspection for all loading roles',()=>{
  for(const scheme of [' data:','da\tta:','\r\ndata:'])for(const mime of ['text/css','text/ecmascript','application/x-javascript']){
    assert.throws(()=>referencedHosts(scheme+mime+',a',{kind:'url'}));
  }
});
test('nested encoded SVG script payloads reject binary MIME labels',()=>{
  const inner='<svg><script href=" data:image/png,alert%281%29"></script></svg>';
  const source='<iframe src="data:text/html;base64,'+Buffer.from(inner).toString('base64')+'"></iframe>';
  assert.throws(()=>referencedHosts(source,{kind:'html'}));
});
test('unclassified JSON strings cannot borrow a declared navigation host',async()=>{
  const source=JSON.stringify({href:'https://nav.invalid/',note:'x_https://nav.invalid/hidden'});
  assert.ok((await inspectPrivacyHosts(await fixture('data.json',source))).errors.some(error=>error.includes('unaccounted active host')));
});
test('prose diagnostics need inert review and cannot hide an active call',async()=>{
  const literal=' not found. https://nav.invalid';
  assert.ok((await inspectPrivacyHosts(await fixture('site.js','warn('+JSON.stringify(literal)+');'))).errors.length);
  assert.deepEqual((await inspectPrivacyHosts(await fixture('site.js','warn('+JSON.stringify(literal)+');',{mode:'mention'}))).errors,[]);
  assert.ok((await inspectPrivacyHosts(await fixture('site.js','fetch('+JSON.stringify(literal)+');',{mode:'mention'}))).errors.length);
});
test('shader comment proof excludes non-comment code and active calls',async()=>{
  const shader='precision highp float;\n// https://nav.invalid/reference\nvoid main(){gl_FragColor=vec4(1.0);}';
  assert.deepEqual((await inspectPrivacyHosts(await fixture('site.js','const shader='+JSON.stringify(shader)+';',{mode:'mention'}))).errors,[]);
  for(const source of ['fetch('+JSON.stringify(shader)+');','const shader='+JSON.stringify(shader+'\n"https://nav.invalid/unclassified";')+';']){
    assert.ok((await inspectPrivacyHosts(await fixture('site.js',source,{mode:'mention'}))).errors.length,source.slice(0,20));
  }
});
test('literal SVG percentages remain inspected; other malformed escapes fail closed',()=>{
  for(const quote of ["'",'"']){
    const source=`<svg width=${quote}100%${quote}></svg>`;
    assert.equal(decodeDataURL('data:image/svg+xml;utf8,'+source).source,source);
  }
  assert.throws(()=>decodeDataURL('data:image/svg+xml,%GG'));
  assert.ok(referencedHosts('<img src="data:image/svg+xml;utf8,<svg width=\'100%\'><image href=\'https://nav.invalid/x\'/></svg>">',{kind:'html'}).has('nav.invalid'));
});
test('long comments, whitespace and raw tags cannot hide active namespace requests',async()=>{
  for(const gap of [' '.repeat(1200),'/*'+'x'.repeat(1200)+'*/','// comment\n','/* first */\n// second\n'])for(const tag of ['', 'String.raw']){
    const source='const ns="http://www.w3.org/2000/svg";fetch('+gap+tag+'`http://www.w3.org/2000/svg`);';
    assert.ok((await inspectPrivacyHosts(await fixture('site.js',source,{mode:'mention',host:'www.w3.org'}))).errors.length);
  }
});
test('prefixed active XML and script href aliases fail closed without an external-host token',()=>{
  for(const source of [
    '<s:svg xmlns:s="http://www.w3.org/2000/svg"><s:script href="data:image/png,alert(1)"/></s:svg>',
    '<svg xmlns:xl="http://www.w3.org/1999/xlink"><script xl:href="data:image/png,alert(1)"/></svg>',
    '<svg><s:style xmlns:s="http://www.w3.org/2000/svg">@import "https://nav.invalid/x";</s:style></svg>',
  ])assert.throws(()=>referencedHosts(source,{kind:'html'}));
});
