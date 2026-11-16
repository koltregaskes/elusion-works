import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {referencedHosts,inspectPrivacyHosts} from './check-privacy-hosts.mjs';
import {sourceReferences,srcsetReferences,jsReferences,cssReferences} from './privacy-source-references.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const checker=path.join(root,'scripts/check-privacy-hosts.mjs');
const baseURL='https://site.invalid/nested/page.html';
const footer='<footer><a href="privacy.html">Privacy notice</a></footer>';
const attr=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const cssQuote=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\n','\\a ').replaceAll('\r','\\d ')+'"';
const contexts=[
    ['HTML attribute','page.html',value=>`<img src="${attr(value)}">${footer}`],
    ['HTML srcset','page.html',value=>`<img srcset="${attr(value)} 1x">${footer}`],
    ['CSS import','site.css',value=>`@import ${cssQuote(value)};`],
    ['CSS url()','site.css',value=>`a{background:url(${cssQuote(value)})}`],
    ['JS string','site.js',value=>`fetch(${JSON.stringify(value)})`],
];
async function fixture(file,source,base='https://site.invalid/') {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ktp-privacy-r3-'));
    await fs.writeFile(path.join(dir,'seo-config.json'),JSON.stringify({base}));
    await fs.writeFile(path.join(dir,'privacy.html'),'<code data-privacy-host="fonts.gstatic.com">fonts.gstatic.com</code>'+footer);
    await fs.writeFile(path.join(dir,file),source);
    return dir;
}
async function reject(file,source,host,base) {
    const dir=await fixture(file,source,base);
    const inspected=await inspectPrivacyHosts(dir);
    assert.ok(inspected.errors.length,'incomplete references must not pass');
    if(host)assert.ok(inspected.errors.some(error=>error.includes('unlisted external host '+host)));
    const cli=spawnSync(process.execPath,[checker,dir],{encoding:'utf8',timeout:15000});
    assert.equal(cli.status,1,cli.stdout+cli.stderr);
    assert.doesNotMatch(cli.stdout+cli.stderr,/https?:|\/\/|sample-reader|example-only|@/i);
}

for(const [label,reference,host] of [
    ['numeric tab','https://fonts.gstatic.com&#9;.surprise.invalid/image','fonts.gstatic.com.surprise.invalid'],
    ['hex tab','https://fonts.gstatic.com&#x09;.surprise.invalid/image','fonts.gstatic.com.surprise.invalid'],
    ['named tab','https://fonts.gstatic.com&Tab;.surprise.invalid/image','fonts.gstatic.com.surprise.invalid'],
    ['named newline','https://fonts.gstatic.com&NewLine;.surprise.invalid/image','fonts.gstatic.com.surprise.invalid'],
    ['numeric newline and CR','https://fonts.gstatic.com&#10;&#13;.surprise.invalid/image','fonts.gstatic.com.surprise.invalid'],
    ['numeric colon','https&#58;//evil.invalid/image','evil.invalid'],
    ['named colon','https&colon;//evil.invalid/image','evil.invalid'],
    ['numeric slash','https:&#47;&#x2f;evil.invalid/image','evil.invalid'],
    ['named slash','https:&sol;&sol;evil.invalid/image','evil.invalid'],
])test('HTML decodes the entire attribute before parsing: '+label,()=>reject('page.html',`<img src="${reference}">${footer}`,host));

for(const [label,value,host] of [
    ['semicolon in userinfo','https://fonts.gstatic.com;@surprise.invalid/image','surprise.invalid'],
    ['backslash authority',String.raw`https:\\evil.invalid`,'evil.invalid'],
    ['percent-encoded mixed case host','https://%65%76%49%4c.invalid/image','evil.invalid'],
    ['allowed host in userinfo','https://allowed.example@evil.invalid/image','evil.invalid'],
    ['allowed host in fragment','https://evil.invalid#@allowed.example','evil.invalid'],
    ['allowed host as a prefix','https://allowed.example.evil.invalid/image','allowed.example.evil.invalid'],
    ['trailing dot','https://evil.invalid./image','evil.invalid.'],
    ['undeclared trailing-dot spelling of allowed host','https://fonts.gstatic.com./image','fonts.gstatic.com.'],
])for(const [context,file,render] of contexts)test(`${context} rejects a complete ${label}`,()=>reject(file,render(value),host));

for(const bare of ['https://','//'])for(const [context,file,render] of contexts)test(`${context} fails an unparseable bare network reference ${JSON.stringify(bare)}`,()=>reject(file,render(bare)));

test('single-slash scheme resolution follows the actual page base',async()=>{
    assert.deepEqual([...referencedHosts('https:/evil.invalid',{baseURL})],['site.invalid']);
    assert.deepEqual([...referencedHosts('https:/evil.invalid',{baseURL:'http://site.invalid/page.html'})],['evil.invalid']);
    await reject('page.html','<img src="https:/evil.invalid">'+footer,'evil.invalid','http://site.invalid/');
});
test('relative references resolve against the first HTML base href',async()=>{
    const source='<base href="https://evil.invalid/nested/"><base href="https://fonts.gstatic.com/"><img src="../image">'+footer;
    assert.ok(referencedHosts(source,{kind:'html',baseURL}).has('evil.invalid'));
    await reject('page.html',source,'evil.invalid');
});
test('same-origin relative references remain allowed',async()=>{
    const dir=await fixture('page.html','<base href="/nested/"><img src="../image"><img srcset="one.png 1x, two.png 2x">'+footer);
    assert.deepEqual((await inspectPrivacyHosts(dir)).errors,[]);
});
test('URL parsing strips internal ASCII tab/newline and leading/trailing C0/space as a complete value',()=>{
    const value='\u0000 \tht\ntps://fonts.gstatic.com\t.\r\nsurprise.invalid/image \u001f';
    assert.deepEqual([...referencedHosts(value,{baseURL})],['fonts.gstatic.com.surprise.invalid']);
});
test('CSS and JS strings decode escapes before URL parsing',async()=>{
    await reject('site.js',String.raw`fetch("https://fonts.gstatic.com\t.surprise.invalid/image")`,'fonts.gstatic.com.surprise.invalid');
    await reject('site.js',String.raw`fetch("https\u003a\u002f\u002fevil.invalid/image")`,'evil.invalid');
    await reject('site.css',String.raw`a{background:url("https://fonts.gstatic.com\9 .surprise.invalid/image")}`,'fonts.gstatic.com.surprise.invalid');
    await reject('site.css',String.raw`@import "https\3a //evil.invalid/image";`,'evil.invalid');
});
test('userinfo delimiters are not cut inside quoted references',async()=>{
    for(const delimiter of [';',',',')','<','>','"',"'"]){
        const value='https://fonts.gstatic.com'+delimiter+'@evil.invalid/image';
        for(const [context,file,render] of contexts.filter(([name])=>name!=='HTML srcset')){
            const source=render(value),kind=path.extname(file).slice(1);
            assert.ok(referencedHosts(source,{kind,baseURL}).has('evil.invalid'),context+' '+delimiter);
        }
    }
    await reject('page.html','<img src="https://fonts.gstatic.com&quot;@evil.invalid/image">'+footer,'evil.invalid');
});
test('srcset parsing preserves internal commas and multiple candidate URLs',async()=>{
    const value='https://fonts.gstatic.com,@evil.invalid/image 1x, https://other.invalid/image 2x';
    assert.deepEqual(srcsetReferences(value),['https://fonts.gstatic.com,@evil.invalid/image','https://other.invalid/image']);
    await reject('page.html',`<img srcset="${value}">${footer}`,'evil.invalid');
});
test('HTML character references are decoded once in attribute context, without a partial-table fallback',()=>{
    const full=sourceReferences('<img src="https&colon;&sol;&sol;evil.invalid/">','html');
    assert.deepEqual(full.values,['https://evil.invalid/']);
    assert.deepEqual(sourceReferences('<img src="https://site.invalid/?x=&notit;&y=&not=1&z=&copy;">','html').values,['https://site.invalid/?x=&notit;&y=&not=1&z=\u00a9']);
    assert.deepEqual(sourceReferences('<img src="https://site.invalid/?x=&amp;Tab;">','html').values,['https://site.invalid/?x=&Tab;']);
});
test('HTML raw-text CSS and JS do not decode HTML entities',()=>{
    assert.deepEqual(sourceReferences('<script>fetch("https://site.invalid/?x=&Tab;")</script>','html').values,['https://site.invalid/?x=&Tab;']);
    assert.deepEqual(sourceReferences('<style>@import "https://site.invalid/?x=&Tab;";</style>','html').values,['https://site.invalid/?x=&Tab;']);
});
test('comments and URL-shaped regexp text are not string references',()=>{
    assert.deepEqual(jsReferences('// "https://evil.invalid"\nconst r=/["\']/; fetch("/local");'),['/local']);
    assert.deepEqual(cssReferences('/* url(https://evil.invalid) */ a{content:"https://evil.invalid";background:url(/local)}'),['/local']);
});
test('the first duplicate HTML attribute is the browser reference',()=>{
    assert.deepEqual(sourceReferences('<img src="/first" src="https://evil.invalid">','html').values,['/first']);
});
test('diagnostics never disclose malformed URLs or synthetic userinfo',async()=>{
    // These are synthetic fixture values, not an account or a real credential.
    await reject('page.html','<img src="https://sample-reader:example-only@evil.invalid/image">'+footer,'evil.invalid');
    await reject('page.html','<img src="https://sample-reader:example-only@">'+footer);
});
test('CSS escaped identifiers still extract the complete url or import argument',async()=>{
    await reject('site.css',String.raw`a{background:u\72l(https://fonts.gstatic.com;@evil.invalid/image)}`,'evil.invalid');
    await reject('site.css',String.raw`@im\70ort "https://fonts.gstatic.com;@evil.invalid/image";`,'evil.invalid');
});
test('String.raw preserves backslash authority spelling before WHATWG parsing',async()=>{
    await reject('site.js','fetch(String.raw`https:\\\\evil.invalid/image`)','evil.invalid');
});
test('protocol-comparison labels do not exempt an attempted malformed request',async()=>{
    assert.deepEqual(jsReferences("['http:','https:'].includes(url.protocol)"),[]);
    await reject('site.js','fetch("http:")');
});
test('fatal checker diagnostics are redacted as well as per-reference errors',async()=>{
    const dir=await fixture('page.html',footer,'https://sample-reader:example-only@');
    const result=spawnSync(process.execPath,[checker,dir],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,1);
    assert.doesNotMatch(result.stdout+result.stderr,/https?:|\/\/|sample-reader|example-only|@/i);
    assert.match(result.stderr,/cannot inspect public references/);
});
