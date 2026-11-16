import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sourceReferences} from './privacy-source-references.mjs';
import {backstopHosts,validateMentions} from './privacy-backstop.mjs';
function documentURL(value) {
  if(!/^data:/i.test(value))return null;
  const match=value.match(/^data:([^,]*),([\s\S]*)$/i);if(!match)return null; // A scheme/MIME prefix alone cannot embed a document.
  const mime=match[1].split(';')[0].toLowerCase();
  const kinds={'text/html':'html','image/svg+xml':'html','application/xhtml+xml':'html','text/css':'css','text/javascript':'js','application/javascript':'js'};
  if(!kinds[mime]){
    if(/^(?:image\/(?:png|jpeg|webp|gif|avif)|font\/|application\/(?:font-woff|x-font-ttf|vnd.ms-fontobject)|audio\/|video\/|application\/octet-stream)/.test(mime))return null;
    throw Error('Unclassified data document');
  }
  let source;
  if(/;base64$/i.test(match[1])){
    if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(match[2]))throw Error('Malformed base64 document');
    source=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(match[2],'base64'));
  }else {
    const bytes=[];
    for(let i=0;i<match[2].length;){const hex=match[2].slice(i).match(/^%([0-9a-f]{2})/i);if(hex){bytes.push(parseInt(hex[1],16));i+=3;}else{const char=String.fromCodePoint(match[2].codePointAt(i));bytes.push(...new TextEncoder().encode(char));i+=char.length;}}
    source=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(bytes));
  }
  return {source,kind:kinds[mime]};
}
function structured(references,baseURL,depth=0,result={loads:new Set(),navigation:new Set(),mentions:new Set()}) {
  if(depth>32)throw Error('Nested documents exceed inspection limit');
  const base=new URL(references.base??baseURL,baseURL);
  for(const [type,values] of [['loads',references.values],['navigation',references.navigation||[]]]){
    for(const value of values){
      const document=documentURL(value);
      if(document){structured(sourceReferences(document.source,document.kind),base.href,depth+1,result);continue;}
      const url=new URL(value,base);
      if(url.hostname){if(/\$\{|[{}]/.test(url.hostname))throw Error('Unresolved hostname');result[type].add(url.hostname);}
    }
  }
  for(const value of references.mentions||[])for(const host of backstopHosts(value,{baseURL:base.href}))result.mentions.add(host);
  for(const document of references.documents||[])structured(sourceReferences(document,'html'),base.href,depth+1,result);
  return result;
}
export function referencedHosts(source,{kind='url',baseURL='https://elusionworks.com/'}={}) {
  const r=structured(sourceReferences(source,kind),baseURL);return new Set([...r.loads,...r.navigation,...r.mentions]);
}
export async function inspectPrivacyHosts(root,{onFile=()=>{}}={}) {
  const privacy=await fs.readFile(path.join(root,'privacy.html'),'utf8');
  const listed=type=>new Set([...privacy.matchAll(new RegExp('<code\\b[^>]*data-privacy-'+type+'="([a-z0-9.-]+)"[^>]*>\\s*\\1\\s*<\\/code>','g'))].map(m=>m[1]));
  const allowed=listed('host'),navigation=listed('navigation');if(!allowed.size)throw Error('Privacy notice must visibly list its resource hosts');
  let siteBase;
  try {siteBase=new URL(JSON.parse(await fs.readFile(path.join(root,'seo-config.json'),'utf8')).base);}
  catch(error){if(error.code!=='ENOENT')throw error;siteBase=new URL('https://elusionworks.com/');}
  let mentions=[];
  try {mentions=validateMentions(JSON.parse(await fs.readFile(path.basename(path.resolve(root))==='_site'?fileURLToPath(new URL('../privacy-non-request-mentions.json',import.meta.url)):path.join(root,'privacy-non-request-mentions.json'),'utf8')));}
  catch(error){if(error.code!=='ENOENT')throw Error('Cannot validate non-request mention allowlist');}
  const files=[],errors=[],used=new Set(),observed={loads:new Set(),navigation:new Set(),mentions:new Set()};
  async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){
    if(e.name.startsWith('.')||e.name==='node_modules')continue;if(e.isSymbolicLink())throw Error('Unexpected symlink in public output');
    const f=path.join(dir,e.name);if(e.isDirectory())await walk(f);else if(/\.(?:html|css|js|jsx|svg|json)$/i.test(e.name))files.push(f);
  }}await walk(root);
  for(const file of files){
    onFile(path.relative(root,file));
    const relative=path.relative(root,file).split(path.sep).join('/'),source=await fs.readFile(file,'utf8');
    try {
      if (/serviceWorker\s*\.\s*register\s*\(/.test(source)) errors.push(relative+': service worker registration requires a demo-path and cache-prefix review');
      let kind=path.extname(file).slice(1).toLowerCase();const inertRecipe=kind==='jsx'; // Final compiled JS is checked separately.
      if (/type=["']text\/(?:babel|jsx)["']/.test(source)) errors.push(relative+': JSX compilation is incomplete; complete build required');if(kind==='svg')kind='html';if(kind==='json'){
        const data=JSON.parse(source),values=[],navigation=[];
        const walk=(v,key='')=>{if(typeof v==='string'&&/^(?:https?:|\/\/)/i.test(v))(key==='href'||key==='url'?navigation:values).push(v);else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v))walk(x,k);};walk(data);
        kind='json-data'; var jsonRefs={base:null,values,navigation};
      }
      const baseURL=new URL(relative,siteBase).href,extracted=inertRecipe?{base:null,values:[]}:kind==='json-data'?jsonRefs:sourceReferences(source,kind),refs=structured(extracted,baseURL);
      for(const key of Object.keys(observed))for(const h of refs[key])observed[key].add(h);
      for(const host of refs.loads)if(host!==siteBase.hostname&&!allowed.has(host))errors.push(relative+': unlisted external host '+host);
      for(const host of refs.navigation)if(host!==siteBase.hostname&&!navigation.has(host)&&!allowed.has(host))errors.push(relative+': unlisted navigation host '+host);
      for(const host of backstopHosts(source,{baseURL,decodedText:extracted.decodedText})){
        if(host===siteBase.hostname||allowed.has(host)||navigation.has(host)||refs.mentions.has(host))continue;
        const mention=mentions.find(m=>m.file===relative&&m.host===host);
        if(mention&&!refs.loads.has(host)&&!refs.navigation.has(host))used.add(mention);
        else if(!refs.loads.has(host)&&!refs.navigation.has(host))errors.push(relative+': backstop found unlisted host '+host);
      }
    }catch{errors.push(relative+': cannot parse complete public references');}
  }
  for(const m of mentions)if(!used.has(m))errors.push(m.file+': unused or active non-request mention entry');
  return {files:files.length,hosts:allowed.size,errors,observed:Object.fromEntries(Object.entries(observed).map(([k,v])=>[k,[...v].sort()]))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {const r=await inspectPrivacyHosts(path.resolve(process.argv[2]||path.join(path.dirname(fileURLToPath(import.meta.url)),'../_site')));
    console.log(`Privacy host check: ${r.files} public files, ${r.hosts} resource hosts, ${r.errors.length} failures`);
    if(r.errors.length){console.error(r.errors.join('\n'));process.exitCode=1;}
  }catch{console.error('Privacy host check failed: cannot inspect public references');process.exitCode=1;}
}
