import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import vm from'node:vm';import babel from'@babel/standalone';
const root=path.resolve('_site');const hash=s=>crypto.createHash('sha256').update(s).digest('base64');
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):e.name.endsWith('.html')?[path.join(d,e.name)]:[]);}
let compiled=0,policies=0;
for(const file of walk(path.join(root,'demos'))){let html=fs.readFileSync(file,'utf8'),index=0;
 if(/type=["']text\/(babel|jsx)["']/i.test(html)){
  html=html.replace(/<script\b[^>]*src=["']https:\/\/unpkg\.com\/@babel\/standalone[^"']*["'][^>]*>[\s\S]*?<\/script>/gi,'');
  html=html.replace(/<script\b([^>]*type=["']text\/(?:babel|jsx)["'][^>]*)>([\s\S]*?)<\/script>/gi,(_,attrs,inline)=>{
   const src=attrs.match(/\bsrc=["']([^"']+)["']/i)?.[1];let code=inline;
   if(src){const input=path.resolve(path.dirname(file),src);if(!input.startsWith(root+path.sep))throw Error('JSX source outside public build');code=fs.readFileSync(input,'utf8');}
   const output=babel.transform(code,{presets:['react','env'],sourceType:'script',comments:false}).code;
   new vm.Script(output);const name='ew-compiled-'+(++index)+'.js';fs.writeFileSync(path.join(path.dirname(file),name),output+'\n');compiled++;
   return '<script src="'+name+'"></script>';
  });
 }
 // Keep the printable prototype working without injecting executable inline script into a new document.
 html=html.replace('<script>window.onload=()=>window.print();<\\/script>','').replace('    w.document.close();',"    w.addEventListener('load', () => w.print(), {once:true});\n    w.document.close();");
 if(!/http-equiv=["']Content-Security-Policy["']/i.test(html)){
  const origins=new Set(),hashes=[];
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   const src=m[1].match(/\bsrc=["']([^"']+)["']/i)?.[1];
   if(src&&/^https:/.test(src))origins.add(new URL(src).origin);
   if(!src&&m[2].trim()){hashes.push("'sha256-"+hash(m[2])+"'");
    if(/type=["']importmap["']/.test(m[1]))for(const value of Object.values(JSON.parse(m[2]).imports||{}))if(/^https:/.test(value))origins.add(new URL(value).origin);
    for(const imp of m[2].matchAll(/(?:from\s*|import\s*\(?\s*)["'](https:\/\/[^"']+)["']/g))origins.add(new URL(imp[1]).origin);
   }
  }
  for(const origin of origins)if(!['https://unpkg.com','https://cdn.jsdelivr.net'].includes(origin))throw Error('Unreviewed demo script origin '+origin);
  const orbit=file.split(path.sep).includes('orbit-census')?' https://celestrak.org':'';
  const policy=["default-src 'self'","script-src 'self' "+[...origins,...hashes].join(' '),"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com","font-src 'self' data: https://fonts.gstatic.com","img-src 'self' data: blob: https:","media-src 'self' data: blob:","connect-src 'self' "+[...origins].join(' ')+orbit,"worker-src 'self' blob:","frame-src 'self'","object-src 'none'","base-uri 'self'","form-action 'none'","upgrade-insecure-requests"].join('; ');
  const tag='<meta http-equiv="Content-Security-Policy" content="'+policy+'">';
  html=/<meta\s+charset=[^>]+>/i.test(html)?html.replace(/(<meta\s+charset=[^>]+>)/i,'$1\n'+tag):html.replace(/(<head[^>]*>)/i,'$1\n'+tag);policies++;
 }
 fs.writeFileSync(file,html);
}
console.log('Demo CSP: '+policies+' missing policies supplied; '+compiled+' JSX entries compiled ahead of time. No script unsafe-inline, unsafe-eval or fixed nonce added.');
