import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sourceReferences,referenceContexts} from './privacy-source-references.mjs';
import {backstopHosts,validateMentions} from './privacy-backstop.mjs';
import {decodeDataURL,MAX_DOCUMENT_DEPTH} from './privacy-data-documents.mjs';
function referenceEvidence(references,{baseURL,sweep=false},depth=0) {
    if(depth>MAX_DOCUMENT_DEPTH)throw Error('Nested document exceeds the inspection limit');
    let base;
    try {base=new URL(references.base ?? baseURL,baseURL);} catch {throw Error('Cannot parse the page base reference');}
    const hosts = new Map(), backstop = new Set(), accounted = new Set(), inert = new Set(), unaccounted = new Set();
    const merge=child=>{
        for(const [host,roles] of child.hosts){if(!hosts.has(host))hosts.set(host,new Set());for(const role of roles)hosts.get(host).add(role);}
        for(const host of child.backstop)backstop.add(host);
        for(const host of child.accounted)accounted.add(host);
        for(const host of child.inert)inert.add(host);
        for(const host of child.unaccounted)unaccounted.add(host);
    };
    if(sweep&&references.decodedText!==undefined)for(const host of backstopHosts(references.decodedText,{baseURL:base.href,decodedText:references.decodedText}))backstop.add(host);
    for (const request of references.requests) {
        const {value,role}=request;
        // WHATWG URL handles internal ASCII tabs/newlines, C0/space trimming,
        // backslashes, userinfo, ports, IDNs and relative references as a unit.
        const clean=value.replace(/[\t\n\r]/g,'').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g,'');
        try {
            const url=new URL(value,base);
            if(!url.hostname&&/^(?:https?:|[\\/]{2})/i.test(clean))throw Error('Missing hostname');
            if(url.hostname){if(/\$\{|[{}]/.test(url.hostname))throw Error('Unresolved hostname');if(!hosts.has(url.hostname))hosts.set(url.hostname,new Set());hosts.get(url.hostname).add(role);}
            if(url.protocol==='data:'){
                const document=decodeDataURL(url.href,{required:request.document});
                if(document.kind)merge(referenceEvidence(sourceReferences(document.source,document.kind),{baseURL:base.href,sweep},depth+1));
            }
        } catch {
            throw Error('Cannot parse an external URL reference in public source');
        }
    }
    for(const document of references.documents||[]){
        merge(referenceEvidence(sourceReferences(document,'html'),{baseURL:base.href,sweep},depth+1));
    }
    if(sweep)for(const context of referenceContexts(references)){
        if(context.kind==='html')continue; // Recursed above as its own document.
        const hits=backstopHosts(context.value,{baseURL:base.href,decodedText:context.decodedText});
        for(const host of hits)backstop.add(host);
        if(context.inertMaskedSource){
            // Tokens present only before proven inert spans were masked are
            // normalisation artefacts (e.g. // + newline + code.property).
            // Every active masked context is still swept and validated below.
            for(const host of backstopHosts(context.inertMaskedSource,{baseURL:base.href}))if(!hits.has(host))inert.add(host);
        }
        if(context.kind==='recipe'){
            // Source recipes are not executable; compiled output is scanned.
            // Inline Babel/JSX separately makes the containing file fail.
            for(const host of hits){if(!hosts.has(host))hosts.set(host,new Set());hosts.get(host).add('metadata');accounted.add(host);}
            continue;
        }
        if(context.kind==='inert'){for(const host of hits)inert.add(host);continue;}
        if(context.kind==='unknown'){for(const host of hits)unaccounted.add(host);continue;}
        const primary=referenceEvidence(sourceReferences(context.value,context.kind),{baseURL:base.href},depth);
        merge(primary); // Recovered references must carry their roles into policy validation.
        for(const host of hits){
            // Matching roles are established within THIS source context, not by
            // an unrelated anchor or metadata reference elsewhere in the file.
            if(primary.hosts.has(host))accounted.add(host);
            else unaccounted.add(host);
        }
    }
    return {hosts,backstop,accounted,inert,unaccounted};
}
export function referencedHosts(source,{kind='url',baseURL='https://elusionworks.com/'}={}) {
  return new Set(referenceEvidence(sourceReferences(source,kind),{baseURL}).hosts.keys());
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
      if (/type=["']text\/(?:babel|jsx)["']/.test(source)) errors.push(relative+': JSX compilation is incomplete; complete build required');if(kind==='svg')kind='html';if(kind==='json')kind='json-data';
      const baseURL=new URL(relative,siteBase).href,extracted=sourceReferences(source,inertRecipe?'recipe':kind),refs=referenceEvidence(extracted,{baseURL,sweep:true});
      for(const [host,roles]of refs.hosts){
        if(roles.has('load'))observed.loads.add(host);
        if(roles.has('navigation'))observed.navigation.add(host);
        if(roles.has('metadata'))observed.mentions.add(host);
        if(host!==siteBase.hostname&&roles.has('load')&&!allowed.has(host))errors.push(relative+': unlisted external host '+host);
        if(host!==siteBase.hostname&&roles.has('navigation')&&!navigation.has(host)&&!allowed.has(host))errors.push(relative+': unlisted external host '+host);
      }
      for(const host of backstopHosts(source,{baseURL,decodedText:extracted.decodedText}))refs.backstop.add(host);
      for(const host of refs.backstop){
        const mention=mentions.find(m=>m.file===relative&&m.host===host);
        if(refs.unaccounted.has(host)||!refs.accounted.has(host)&&!refs.inert.has(host))errors.push(relative+': backstop found unaccounted active host '+host);
        else if(mention&&refs.inert.has(host))used.add(mention);
        else if(!refs.accounted.has(host))errors.push(relative+': backstop found unlisted host '+host);
      }
    }catch{errors.push(relative+': cannot parse complete public references');}
  }
  for(const m of mentions)if(!used.has(m))errors.push(m.file+': unused or active non-request mention entry '+m.host);
  return {files:files.length,hosts:allowed.size,errors,observed:Object.fromEntries(Object.entries(observed).map(([k,v])=>[k,[...v].sort()]))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {const r=await inspectPrivacyHosts(path.resolve(process.argv[2]||path.join(path.dirname(fileURLToPath(import.meta.url)),'../_site')));
    console.log(`Privacy host check: ${r.files} public files, ${r.hosts} resource hosts, ${r.errors.length} failures`);
    if(r.errors.length){console.error(r.errors.join('\n'));process.exitCode=1;}
  }catch{console.error('Privacy host check failed: cannot inspect public references');process.exitCode=1;}
}
