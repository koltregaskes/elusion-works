import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {inspectPrivacyHosts,referencedHosts} from './check-privacy-hosts.mjs';
async function fixture(source){
  await fs.mkdir('.local',{recursive:true});
  const dir=await fs.mkdtemp(path.join('.local','ew-privacy-'));
  await fs.writeFile(path.join(dir,'privacy.html'),'<code data-privacy-host="fonts.gstatic.com">fonts.gstatic.com</code><code data-privacy-navigation="nav.invalid">nav.invalid</code>');
  await fs.writeFile(path.join(dir,'page.html'),source);return dir;
}
test('navigation permission never authorises a resource',async()=>{
  assert.deepEqual((await inspectPrivacyHosts(await fixture('<a href="https://nav.invalid/">Go</a>'))).errors,[]);
  const r=await inspectPrivacyHosts(await fixture('<a href="https://nav.invalid/">Go</a><script src="https://nav.invalid/x.js"></script>'));
  assert.ok(r.errors.some(e=>e.includes('unlisted external host nav.invalid')));
});
test('same JS literal in navigation data and fetch remains an active resource',async()=>{
  const dir=await fixture('');await fs.writeFile(path.join(dir,'script.js'),'const link={href:"https://nav.invalid/"}; fetch("https://nav.invalid/");');
  assert.ok((await inspectPrivacyHosts(dir)).errors.some(e=>e.includes('unlisted external host nav.invalid')));
});
test('passive namespace mention cannot exempt a fetch to the same host',async()=>{
  const dir=await fixture('');await fs.writeFile(path.join(dir,'script.js'),'const ns="http://www.w3.org/2000/svg"; fetch("http://www.w3.org/2000/svg");');
  assert.ok((await inspectPrivacyHosts(dir)).errors.some(e=>e.includes('unlisted external host www.w3.org')));
});
for(const mime of ['text/html','image/svg+xml','application/xhtml+xml'])test('nested data document '+mime,()=>{
  const data='data:'+mime+','+encodeURIComponent('<iframe srcdoc="&lt;img src=\'https://evil.invalid/x\'&gt;"></iframe>');
  assert.ok(referencedHosts('<iframe src="'+data+'"></iframe>',{kind:'html'}).has('evil.invalid'));
});
test('base64 data document and malformed document fail closed',()=>{
  const value='data:text/html;base64,'+Buffer.from('<img src="https://evil.invalid/x">').toString('base64');assert.ok(referencedHosts(value).has('evil.invalid'));
  assert.throws(()=>referencedHosts('data:text/html;base64,%%%'));
});
test('scheme backstop catches a URL after punctuation',async()=>{
  const {backstopHosts}=await import('./privacy-backstop.mjs');assert.ok(backstopHosts('<!-- (https://evil.invalid/x) -->').has('evil.invalid'));
});
test('notice, fictional demo label and excluded snippet match build inputs',async()=>{
  const notice=await fs.readFile('privacy.html','utf8');assert.match(notice,/Last updated: 16 November 2026/);assert.match(notice,/GitHub Pages/);assert.match(notice,/UK GDPR/);assert.match(notice,/ico.org.uk/);
  assert.match(await fs.readFile('index.html','utf8'),/href="privacy.html">Privacy notice/);
  const golden=await fs.readFile('demos/golden/privacy.html','utf8');assert.match(golden,/Fictional Golden/);assert.match(golden,/noindex,follow/);
  assert.match(await fs.readFile('scripts/build-site.py','utf8'),/demo-card-snippet.html/);
});
