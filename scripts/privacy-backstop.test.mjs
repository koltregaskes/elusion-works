import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {referencedHosts,inspectPrivacyHosts} from './check-privacy-hosts.mjs';
import {backstopHosts,validateMentions} from './privacy-backstop.mjs';
import {validateHtmlHelperOutput} from './privacy-source-references.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const checker=path.join(root,'scripts/check-privacy-hosts.mjs');
const footer='<footer><a href="privacy.html">Privacy notice</a></footer>';
async function fixture(file,source,base='https://site.invalid/',allowedHosts=['fonts.gstatic.com']) {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ktp-privacy-r4-'));
    await fs.writeFile(path.join(dir,'seo-config.json'),JSON.stringify({base}));
    await fs.writeFile(path.join(dir,'privacy.html'),allowedHosts.map(host=>`<code data-privacy-host="${host}">${host}</code>`).join('')+footer);
    await fs.mkdir(path.dirname(path.join(dir,file)),{recursive:true});
    await fs.writeFile(path.join(dir,file),source);
    return dir;
}
function cli(dir,script=checker) {return spawnSync(process.execPath,[script,dir],{encoding:'utf8',timeout:20000});}
function assertRedacted(result) {assert.doesNotMatch(result.stdout+result.stderr,/https?:|\/\/|sample-reader|example-only|@/i);}

const active=[
    ['image-set','site.css','a{background:image-set("https://evil.invalid/x" 1x)}'],
    ['webkit-image-set','site.css','a{background:-webkit-image-set("https://evil.invalid/x" 1x)}'],
    ['inline image-set','page.html','<div style=\'background:image-set("https://evil.invalid/x" 1x)\'></div>'+footer],
    ['style image-set','page.html','<style>a{background:image-set("https://evil.invalid/x" 1x)}</style>'+footer],
    ['refresh','page.html','<meta http-equiv="refresh" content="0;url=https://evil.invalid/x">'+footer],
    ['encoded refresh','page.html','<meta http-equiv="Refresh" content="0;URL=&quot;https&#58;//evil.invalid/x&quot;">'+footer],
    ['srcdoc','page.html','<iframe srcdoc="&lt;img src=\'https://evil.invalid/x\'&gt;"></iframe>'+footer],
    ['template expression','site.js','const p = `result: ${fetch("https://evil.invalid/x")}`;'],
    ['nested template expression','site.js','const p = `result: ${`inner ${fetch("https://evil.invalid/x")}`}`;'],
];
for(const [name,file,source] of active)test('both layers detect '+name,async()=>{
    assert.ok(referencedHosts(source,{kind:path.extname(file).slice(1),baseURL:'https://site.invalid/'}).has('evil.invalid'));
    assert.ok(backstopHosts(source,{baseURL:'https://site.invalid/'}).has('evil.invalid'));
    const dir=await fixture(file,source),result=cli(dir);
    assert.equal(result.status,1);assertRedacted(result);
});
test('nested srcdoc uses the same HTML pass and nested base resolution',async()=>{
    const source='<iframe srcdoc="&lt;iframe srcdoc=&quot;&amp;lt;base href=&amp;quot;http://site.invalid/&amp;quot;&amp;gt;&amp;lt;img src=&amp;quot;https:/evil.invalid&amp;quot;&amp;gt;&quot;&gt;&lt;/iframe&gt;"></iframe>'+footer;
    assert.ok(referencedHosts(source,{kind:'html',baseURL:'https://site.invalid/'}).has('evil.invalid'));
    assert.ok((await inspectPrivacyHosts(await fixture('page.html',source))).errors.length);
});
test('interpolation evidence records an actual stubbed call without network access',()=>{
    const calls=[];vm.runInNewContext(active.find(([name])=>name==='template expression')[2],{fetch:value=>calls.push(value)},{timeout:1000});
    assert.deepEqual(calls,['https://evil.invalid/x']);
});
for(const [file,source] of [
    ['page.html','<!-- https://evil.invalid/x -->'+footer],
    ['page.html','<p>Reference text: https://evil.invalid/x</p>'+footer],
    ['site.css','/* https://evil.invalid/x */'],
    ['site.js','// https://evil.invalid/x'],
    ['site.js','const path="https://evil.invalid/" + suffix;'],
])test('the independent backstop catches an undeclared mention in '+file+' '+source.slice(0,8),async()=>{
    assert.ok(backstopHosts(source).has('evil.invalid'));
    const dir=await fixture(file,source),result=cli(dir);assert.equal(result.status,1);assertRedacted(result);
});
test('splitting a network prefix across strings cannot silently pass',async()=>{
    const source='const path="https://" + "evil.invalid/x";';
    assert.throws(()=>backstopHosts(source));
    assert.equal(cli(await fixture('site.js',source)).status,1);
});
for(const source of [
    '<!-- https&colon;&sol;&sol;evil.invalid/x -->',
    String.raw`// https:\/\/evil.invalid/x`,
    String.raw`// https:\x2f\x2fevil.invalid/x`,
    String.raw`// https:\u002f\u002fevil.invalid/x`,
    String.raw`/* https:\2f \2f evil.invalid/x */`,
    '<!-- HTTPS://sample-reader:example-only@evil.invalid/x -->',
    '<!-- //evil.invalid/x -->',
    '<!-- ftp://evil.invalid/x -->',
])test('backstop normalisation case '+[...source].reduce((n,c)=>n+c.codePointAt(0),0),()=>assert.ok(backstopHosts(source).has('evil.invalid')));

const valid={base:null,references:[{kind:'url',value:'/local'}],decodedText:'<img src="/local">'};
for(const [name,mutant] of [
    ['null',null],['array',[]],['missing base',{references:[],decodedText:'x'}],
    ['false base',{base:false,references:[],decodedText:'x'}],['missing references',{base:null,decodedText:'x'}],
    ['wrong references',{base:null,references:{},decodedText:'x'}],['missing decoded text',{base:null,references:[]}],
    ['wrong decoded text',{...valid,decodedText:false}],['extra root key',{...valid,unknown:[]}],
    ['unknown ref kind',{...valid,references:[{kind:'unknown',value:'x'}]}],
    ['missing ref value',{...valid,references:[{kind:'url'}]}],['wrong ref value',{...valid,references:[{kind:'url',value:false}]}],
    ['extra ref key',{...valid,references:[{kind:'url',value:'/local',unknown:'x'}]}],
    ['null ref',{...valid,references:[null]}],
])test('helper schema rejects '+name,()=>assert.throws(()=>validateHtmlHelperOutput(mutant)));
test('helper schema accepts exactly the supported shapes',()=>{
    assert.deepEqual(validateHtmlHelperOutput(valid),valid);
    assert.deepEqual(validateHtmlHelperOutput({decodedText:'x'},true),{decodedText:'x'});
    assert.throws(()=>validateHtmlHelperOutput({decodedText:'x',base:null},true));
});
for(const [name,payload] of [
    ['missing base',{references:[]}],['wrong base',{base:false,references:[]}],
    ['extra structure',{...valid,extra:{references:[]}}],['empty decoded output',{base:null,references:[],decodedText:''}],
])test('malformed helper output fails the actual checker: '+name,async()=>{
    const dir=await fixture('page.html','<img src="https://evil.invalid/x">'+footer);
    await fs.mkdir(path.join(dir,'scripts'));
    for(const name of ['check-privacy-hosts.mjs','privacy-source-references.mjs','privacy-backstop.mjs'])await fs.copyFile(path.join(root,'scripts',name),path.join(dir,'scripts',name));
    await fs.writeFile(path.join(dir,'scripts/privacy-html-references.py'),'import sys\nsys.stdout.write('+JSON.stringify(JSON.stringify(payload))+')\n');
    const result=cli(dir,path.join(dir,'scripts/check-privacy-hosts.mjs'));
    assert.equal(result.status,1);assertRedacted(result);
});

const mention={kind:'non-request mention',file:'site.js',host:'evil.invalid',reason:'Reviewed documentation comment; it does not make a request.'};
test('a reviewed file-and-host mention permits only inert backstop text',async()=>{
    const dir=await fixture('site.js','// https://evil.invalid/x');
    await fs.writeFile(path.join(dir,'privacy-non-request-mentions.json'),JSON.stringify({version:1,mentions:[mention]}));
    assert.deepEqual((await inspectPrivacyHosts(dir)).errors,[]);
    await fs.writeFile(path.join(dir,'site.js'),'fetch("https://evil.invalid/x")');
    assert.ok((await inspectPrivacyHosts(dir)).errors.length);
});
test('mention exceptions cannot silently move to another file or become unused',async()=>{
    const dir=await fixture('site.css','/* https://evil.invalid/x */');
    await fs.writeFile(path.join(dir,'privacy-non-request-mentions.json'),JSON.stringify({version:1,mentions:[mention]}));
    assert.ok((await inspectPrivacyHosts(dir)).errors.length);
});
for(const mutant of [{...mention,reason:''},{...mention,file:'*'},{...mention,file:'../site.js'},{...mention,host:'https://evil.invalid'},{...mention,extra:true}])test('mention schema rejects invalid entry '+Object.keys(mutant).join('-')+' '+JSON.stringify(mutant).length,()=>assert.throws(()=>validateMentions({version:1,mentions:[mutant]})));

const regressions=JSON.parse(await fs.readFile(new URL('./fixtures/privacy-review-regressions.json',import.meta.url),'utf8'));
for(const row of regressions.cases)test('retained independent-review case '+row.id,async()=>{
    const dir=await fixture(row.file,row.source,row.base,row.allowedHosts),result=await inspectPrivacyHosts(dir);
    assert.equal(result.errors.length>0,row.expected==='fail','Review case '+row.id);
    if(['000','005','294','295','301','302','304','307','308','313','314','321','333'].includes(row.id)){
        const processResult=cli(dir);assert.equal(processResult.status,row.expected==='fail'?1:0,'CLI case '+row.id);assertRedacted(processResult);
    }
});
