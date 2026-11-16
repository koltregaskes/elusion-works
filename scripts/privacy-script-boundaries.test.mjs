import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectPrivacyHosts,referencedHosts} from './check-privacy-hosts.mjs';
const rows=JSON.parse(await fs.readFile(new URL('./fixtures/privacy-round4-review.json',import.meta.url),'utf8'));
const footer='<footer><a href="privacy.html">Privacy notice</a></footer>';
for(const row of rows)test('round-four independent review: '+row.name,async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ktp-script-boundary-'));
  await fs.writeFile(path.join(dir,'seo-config.json'),'{"base":"https://site.invalid/"}');
  await fs.writeFile(path.join(dir,'privacy.html'),'<code data-privacy-host="fonts.gstatic.com">fonts.gstatic.com</code><code data-privacy-navigation="github.com">github.com</code>'+footer);
  await fs.writeFile(path.join(dir,row.file),row.source+(row.file.endsWith('.html')?footer:''));
  assert.equal((await inspectPrivacyHosts(dir)).errors.length>0,row.expectedReject,'plain fixture');
  if(row.mentionHost){
    await fs.writeFile(path.join(dir,'privacy-non-request-mentions.json'),JSON.stringify({version:1,mentions:[{kind:'non-request mention',file:row.file,host:row.mentionHost,reason:'Reviewed inert fixture text.'}]}));
    assert.equal((await inspectPrivacyHosts(dir)).errors.length>0,row.expectedMentionReject,'active references must never borrow a mention');
  }
});
const mimes=['text/x-javascript','application/x-ecmascript','text/jscript','','application/octet-stream','image/png','audio/mpeg','video/mp4','font/woff','text/plain'];
for(const namespace of ['html','svg','math'])for(const attr of ['src','href','xlink:href']) {
  test(`every ${namespace} script ${attr} data load rejects independently of MIME or encoding`,()=>{
    for(const mime of mimes)for(const encoding of ['base64','percent']) {
      // No outbound URL is needed: rejection happens at the loading boundary.
      const url=encoding==='base64'?`data:${mime};base64,YWxlcnQoMSk=`:`data:${mime},alert%281%29`;
      const script=`<script ${attr}="${url}"></script>`;
      const source=namespace==='html'?script:`<${namespace}>${script}</${namespace}>`;
      assert.throws(()=>referencedHosts(source,{kind:'html',baseURL:'https://site.invalid/'}),`${mime}, ${encoding}`);
      const escaped=source.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
      assert.throws(()=>referencedHosts(`<iframe srcdoc="${escaped}"></iframe>`,{kind:'html',baseURL:'https://site.invalid/'}),`srcdoc: ${mime}, ${encoding}`);
    }
  });
}
for(const scheme of ['DATA:','\tdata:','da&#9;ta:','da&#10;ta:','da&#13;ta:'])test('URL scheme normalisation cannot hide script data: '+JSON.stringify(scheme),()=>{
  assert.throws(()=>referencedHosts(`<svg><script href="${scheme};base64,YQ=="></script></svg>`,{kind:'html',baseURL:'https://site.invalid/'}));
});
test('ordinary declared script resources retain their structured load role',()=>{
  for(const attr of ['src','href','xlink:href'])assert.ok(referencedHosts(`<svg><script ${attr}="https://fonts.gstatic.com/site.js"></script></svg>`,{kind:'html',baseURL:'https://site.invalid/'}).has('fonts.gstatic.com'));
});
