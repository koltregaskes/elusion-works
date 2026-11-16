import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectPrivacyHosts,referencedHosts} from './check-privacy-hosts.mjs';
import {validateHtmlHelperOutput} from './privacy-source-references.mjs';
const rows=JSON.parse(await fs.readFile(new URL('./fixtures/privacy-round3-review.json',import.meta.url),'utf8'));
const footer='<footer><a href="privacy.html">Privacy notice</a></footer>';
async function fixture(file,source){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ktp-foreign-context-'));
  await fs.writeFile(path.join(dir,'seo-config.json'),'{"base":"https://site.invalid/"}');
  await fs.writeFile(path.join(dir,'privacy.html'),'<code data-privacy-host="fonts.gstatic.com">fonts.gstatic.com</code><code data-privacy-navigation="github.com">github.com</code><code data-privacy-navigation="schema.org">schema.org</code>'+footer);
  await fs.writeFile(path.join(dir,file),source+(file.endsWith('.html')?footer:''));
  return dir;
}
async function mention(dir,file,host){await fs.writeFile(path.join(dir,'privacy-non-request-mentions.json'),JSON.stringify({version:1,mentions:[{kind:'non-request mention',file,host,reason:'Reviewed inert fixture text.'}]}));}
for(const row of rows)test('round-three independent review: '+row.name,async()=>{
  const dir=await fixture(row.file,row.source);
  assert.equal((await inspectPrivacyHosts(dir)).errors.length>0,row.expectedReject,'plain fixture');
  if(row.mentionHost){
    await mention(dir,row.file,row.mentionHost);
    assert.equal((await inspectPrivacyHosts(dir)).errors.length>0,row.expectedMentionReject,'only proven inert text may use a mention');
  }
});
for(const namespace of ['svg','math'])for(const raw of ['style','script'])test(`${namespace}/${raw} exposes a foreign breakout resource load`,()=>{
  const source=`<${namespace}><${raw}><img src="https://github.com/x.png"></${raw}></${namespace}>`;
  assert.ok(referencedHosts(source,{kind:'html',baseURL:'https://site.invalid/'}).has('github.com'));
});
test('CDATA in HTML ends its bogus comment at the first greater-than character',()=>{
  assert.ok(referencedHosts('<![CDATA[ > <img src="https://github.com/x.png"> ]]>',{kind:'html',baseURL:'https://site.invalid/'}).has('github.com'));
});
test('CDATA in foreign content is inert and can receive a reviewed mention',async()=>{
  const source='<svg><![CDATA[ > <img src="https://github.com/x.png"> ]]></svg>';
  assert.ok(!referencedHosts(source,{kind:'html',baseURL:'https://site.invalid/'}).has('github.com'));
  const dir=await fixture('page.html',source);
  await mention(dir,'page.html','github.com');
  assert.deepEqual((await inspectPrivacyHosts(dir)).errors,[]);
});
test('CDATA tokenisation uses the foreign namespace even at an integration point',()=>{
  assert.ok(!referencedHosts('<svg><title><![CDATA[ > <img src="https://github.com/x.png"> ]]></title></svg>',{kind:'html',baseURL:'https://site.invalid/'}).has('github.com'));
});
for(const source of ['<svg><image><set attributeName="href" to="https://github.com/x.png"/></image></svg>',
  '<svg><use><animate attributeName="xlink:href" values="/local;https://github.com/x.png"/></use></svg>'])test('SVG animation candidates are resource loads: '+source.slice(0,20),async()=>{
  assert.ok(referencedHosts(source,{kind:'html',baseURL:'https://site.invalid/'}).has('github.com'));
  assert.ok((await inspectPrivacyHosts(await fixture('page.html',source))).errors.some(error=>error.includes('unlisted external host')));
});
for(const host of ['github.com','schema.org'])test('declared host text needs structured proof or a proven-inert exception: '+host,async()=>{
  const source=`<!-- https://${host}/x -->`;
  const dir=await fixture('page.html',source);
  assert.ok((await inspectPrivacyHosts(dir)).errors.length);
  await mention(dir,'page.html',host);
  assert.deepEqual((await inspectPrivacyHosts(dir)).errors,[]);
});
test('an unrelated anchor cannot account for an unknown active reference',async()=>{
  const dir=await fixture('page.html','<a href="https://github.com/">Source</a><div unknown-load="https://github.com/x.png"></div>');
  await mention(dir,'page.html','github.com');
  assert.ok((await inspectPrivacyHosts(dir)).errors.some(error=>error.includes('unaccounted active host')));
});
test('context-recovered JavaScript references keep their load role',async()=>{
  const source='const target=String.raw/* comment */`https:'+String.fromCharCode(92).repeat(2)+'github.com/x`;fetch(target);';
  assert.ok((await inspectPrivacyHosts(await fixture('site.js',source))).errors.some(error=>error.includes('unlisted external host')));
});
for(const [file,source] of [
  ['page.html','<script src="data:,fetch(1)"></script>'],
  ['page.html','<link rel="stylesheet" href="data: text/css;base64,YQ==">'],
  ['site.css','@import url("data: text/css;base64,YQ==");'],
  ['site.css','@import "data:;base64,YQ==";'],
])test('data import boundaries reject MIME variants: '+source,async()=>{
  assert.ok((await inspectPrivacyHosts(await fixture(file,source))).errors.length);
});
test('new helper context records are validated strictly',()=>{
  const valid={base:null,references:[],decodedText:'x',contexts:[]};
  assert.deepEqual(validateHtmlHelperOutput(valid),valid);
  for(const contexts of [null,{},[{kind:'inert',value:'x'}],[{kind:'unexpected',value:'x',decodedText:'x'}],[{kind:'url',value:'x',decodedText:false}]])assert.throws(()=>validateHtmlHelperOutput({...valid,contexts}));
});
