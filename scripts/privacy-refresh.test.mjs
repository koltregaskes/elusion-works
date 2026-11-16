import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {referencedHosts,inspectPrivacyHosts} from './check-privacy-hosts.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const checker=path.join(root,'scripts/check-privacy-hosts.mjs');
const footer='<footer><a href="privacy.html">Privacy notice</a></footer>';
const comment='<!-- https://evil.invalid/reference -->';
const mention={kind:'non-request mention',file:'page.html',host:'evil.invalid',reason:'Reviewed reference text in an HTML comment.'};
const attr=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;');
const page=content=>comment+`<meta http-equiv=refresh content="${attr(content)}">`+footer;
async function fixture(source,base='https://site.invalid/'){
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ktp-refresh-r5-'));
    await fs.writeFile(path.join(dir,'seo-config.json'),JSON.stringify({base}));
    await fs.writeFile(path.join(dir,'privacy.html'),'<code data-privacy-host="fonts.gstatic.com">fonts.gstatic.com</code>'+footer);
    await fs.writeFile(path.join(dir,'page.html'),source);
    await fs.writeFile(path.join(dir,'privacy-non-request-mentions.json'),JSON.stringify({version:1,mentions:[mention]}));
    return dir;
}
function cli(dir){return spawnSync(process.execPath,[checker,dir],{encoding:'utf8',timeout:20000});}
function redacted(result){assert.doesNotMatch(result.stdout+result.stderr,/https?:|\/\/|sample-reader|example-only|@/i);}
async function active(source,base='https://site.invalid/'){
    assert.ok(referencedHosts(source,{kind:'html',baseURL:base}).has('evil.invalid'),'structured extraction must see the active host');
    const dir=await fixture(source,base),result=await inspectPrivacyHosts(dir);
    assert.ok(result.errors.some(e=>e==='page.html: unlisted external host evil.invalid'));
    const processResult=cli(dir);assert.equal(processResult.status,1);redacted(processResult);
}

test('comma refresh cannot inherit an existing inert-comment exception',()=>active(page('0,url=https://evil.invalid/x')));
test('the comment exception is valid while it remains inert',async()=>{
    const dir=await fixture(comment+footer);assert.deepEqual((await inspectPrivacyHosts(dir)).errors,[]);
    const result=cli(dir);assert.equal(result.status,0);redacted(result);
});

for(const separator of [';',','])for(const marker of ['', 'url=', ' URL \t= '])for(const quote of ['',"'",'"']){
    const label=JSON.stringify({separator,marker,quote});
    test('structured refresh blocks an active undeclared host with an inert exception '+label,()=>active(page(` \t1.5 ${separator} \n${marker}${quote}https://evil.invalid/x${quote} \r`)));
    test('structured refresh allows a declared target and retains the inert exception '+label,async()=>{
        const source=page(`0${separator}${marker}${quote}https://fonts.gstatic.com/x${quote}`),dir=await fixture(source);
        assert.ok(referencedHosts(source,{kind:'html',baseURL:'https://site.invalid/'}).has('fonts.gstatic.com'));
        assert.deepEqual((await inspectPrivacyHosts(dir)).errors,[]);
        const result=cli(dir);assert.equal(result.status,0);redacted(result);
    });
}

for(const [label,content] of [
    ['bare url','0,url'],
    ['bare url with destination','0;url https://evil.invalid/x'],
    ['bare url with quoted destination','0,url "https://evil.invalid/x"'],
    ['missing equals without whitespace','0,urlhttps://evil.invalid/x'],
    ['missing delay',',url=https://evil.invalid/x'],
    ['invalid delay','later,url=https://evil.invalid/x'],
    ['invalid separator','0:url=https://evil.invalid/x'],
    ['missing separator','0 url=https://evil.invalid/x'],
    ['double comma','0,,url=https://evil.invalid/x'],
    ['double semicolon','0;;url=https://evil.invalid/x'],
    ['unclosed quote','0,url="https://evil.invalid/x'],
    ['trailing quote text','0,url="https://evil.invalid/x" trailing'],
])test('unsupported refresh syntax fails closed despite an inert exception: '+label,async()=>{
    const source=page(content);assert.throws(()=>referencedHosts(source,{kind:'html',baseURL:'https://site.invalid/'}));
    const dir=await fixture(source);assert.ok((await inspectPrivacyHosts(dir)).errors.length);
    const result=cli(dir);assert.equal(result.status,1);redacted(result);
});

test('quoted comma refresh preserves internal URL punctuation and userinfo',()=>active(page('0,url="https://fonts.gstatic.com;@evil.invalid/x?one=1,two=2"')));
test('HTML-decoded quotes and uppercase refresh marker remain active',()=>active(comment+'<meta HTTP-EQUIV="Refresh" content="0, URL=&quot;https&#58;//evil.invalid/x&quot;">'+footer));
test('refresh in srcdoc cannot inherit the outer document mention exception',()=>active(comment+'<iframe srcdoc="&lt;meta http-equiv=refresh content=\'0,url=https://evil.invalid/x\'&gt;"></iframe>'+footer));
test('a single-slash refresh target uses the page base before applying host policy',()=>active(page('0,url=https:/evil.invalid/x'),'http://site.invalid/'));
for(const content of ['0','1.5','0;','0,','0;url=','0,url=""'])test('a supported same-page refresh does not turn an inert exception into a failure '+JSON.stringify(content),async()=>{
    const dir=await fixture(page(content));assert.deepEqual((await inspectPrivacyHosts(dir)).errors,[]);
    const result=cli(dir);assert.equal(result.status,0);redacted(result);
});
