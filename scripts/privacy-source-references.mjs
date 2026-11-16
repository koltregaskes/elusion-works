import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const htmlHelper=fileURLToPath(new URL('./privacy-html-references.py',import.meta.url));
const asciiSpace=char=>/[\t\n\f\r ]/.test(char || 'x');
const fail=()=>{throw Error('Cannot extract a complete source reference');};

function escapeValue(source, index, kind) {
    let i=index+1;
    if(i>=source.length)fail();
    const char=source[i];
    if(char==='\n')return ['',i+1];
    if(char==='\r')return ['',i+1+(source[i+1]==='\n'?1:0)];
    if(kind==='css') {
        const hex=source.slice(i).match(/^[0-9a-f]{1,6}/i)?.[0];
        if(hex){i+=hex.length;const point=parseInt(hex,16);return [point===0||point>0x10ffff||point>=0xd800&&point<=0xdfff?'\ufffd':String.fromCodePoint(point),i+(asciiSpace(source[i])?1:0)+(source[i]==='\r'&&source[i+1]==='\n'?1:0)];}
        return [char,i+1];
    }
    const simple={b:'\b',f:'\f',n:'\n',r:'\r',t:'\t',v:'\v','0':'\0'};
    if(Object.hasOwn(simple,char))return [simple[char],i+1];
    if(char==='x'||char==='u'){
        const braced=char==='u'&&source[i+1]==='{';
        const hex=braced?source.slice(i+2).match(/^[0-9a-f]+(?=})/i)?.[0]:source.slice(i+1,i+1+(char==='x'?2:4));
        if(!hex||!new RegExp('^[0-9a-f]{'+(braced?'1,6':char==='x'?'2':'4')+'}$','i').test(hex))fail();
        const point=parseInt(hex,16);if(point>0x10ffff)fail();
        return [String.fromCodePoint(point),i+1+hex.length+(braced?2:0)];
    }
    return [char,i+1];
}

function stringAt(source,start,kind) {
    const quote=source[start];let value='',i=start+1;
    while(i<source.length){
        if(source[i]===quote)return {value,end:i+1};
        if(source[i]==='\\'){
            if(kind==='raw'){value+=source.slice(i,i+2);i+=2;}
            else {const [part,end]=escapeValue(source,i,kind);value+=part;i=end;}
        }
        else value+=source[i++];
    }
    fail();
}

function skipCommentsAndSpace(source,start) {
    let i=start;
    while(i<source.length){
        if(/\s/.test(source[i]))i++;
        else if(source.startsWith('/*',i)){const end=source.indexOf('*/',i+2);if(end<0)fail();i=end+2;}
        else break;
    }
    return i;
}

function cssIdentifier(source,start) {
    let i=start,value='';
    while(i<source.length){
        if(source[i]==='\\'){const [part,end]=escapeValue(source,i,'css');value+=part;i=end;}
        else if(/[\w-]/.test(source[i])||source.charCodeAt(i)>=128)value+=source[i++];
        else break;
    }
    return {value,end:i};
}

function cssFunctionEnd(source,start) {
    let i=start,depth=1;
    while(i<source.length){
        if(source.startsWith('/*',i)){i=skipCommentsAndSpace(source,i);continue;}
        if(source[i]==='"'||source[i]==="'"){i=stringAt(source,i,'css').end;continue;}
        if(source[i]==='\\'){i=escapeValue(source,i,'css')[1];continue;}
        if(source[i]==='(')depth++;
        if(source[i]===')'&&!--depth)return i;
        i++;
    }
    fail();
}

function imageSetReferences(body) {
    const values=cssReferences(body);let start=0,i=0;
    while(i<=body.length){
        if(i===body.length||body[i]===','){
            const first=skipCommentsAndSpace(body,start);
            if(body[first]==='"'||body[first]==="'")values.push(stringAt(body,first,'css').value);
            start=++i;continue;
        }
        if(body[i]==='"'||body[i]==="'"){i=stringAt(body,i,'css').end;continue;}
        if(body[i]==='('){i=cssFunctionEnd(body,i+1)+1;continue;}
        if(body.startsWith('/*',i)){i=skipCommentsAndSpace(body,i);continue;}
        i++;
    }
    return values;
}

export function cssReferences(source) {
    const values=[];let i=0;
    while(i<source.length){
        i=skipCommentsAndSpace(source,i);if(i>=source.length)break;
        if(source[i]==='"'||source[i]==="'"){i=stringAt(source,i,'css').end;continue;}
        if(source[i]==='@'){
            const name=cssIdentifier(source,i+1);
            if(name.value.toLowerCase()==='import'){i=skipCommentsAndSpace(source,name.end);if(source[i]==='"'||source[i]==="'"){const part=stringAt(source,i,'css');values.push(part.value);i=part.end;continue;}}
        }
        const name=cssIdentifier(source,i),open=skipCommentsAndSpace(source,name.end);
        if(['image-set','-webkit-image-set'].includes(name.value.toLowerCase())&&source[open]==='('){
            const end=cssFunctionEnd(source,open+1);
            values.push(...imageSetReferences(source.slice(open+1,end)));i=end+1;continue;
        }
        if(name.value.toLowerCase()==='url'&&source[open]==='('){
            i=skipCommentsAndSpace(source,open+1);
            let value='';
            if(source[i]==='"'||source[i]==="'"){const part=stringAt(source,i,'css');value=part.value;i=skipCommentsAndSpace(source,part.end);}
            else {
                while(i<source.length&&source[i]!==')'){
                    if(source[i]==='\\'){const [part,end]=escapeValue(source,i,'css');value+=part;i=end;}
                    else value+=source[i++];
                }
                value=value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g,'');
            }
            if(source[i]!==')')fail();
            values.push(value);i++;continue;
        }
        i=name.end>i?name.end:i+1;
    }
    return values;
}

export function jsReferences(source,details=false) {
    const values=[];let i=0,canStartRegex=true;
    while(i<source.length){
        const char=source[i];
        if(/\s/.test(char)){i++;continue;}
        if(source.startsWith('//',i)){const end=source.indexOf('\n',i+2);i=end<0?source.length:end;continue;}
        if(source.startsWith('/*',i)){const end=source.indexOf('*/',i+2);if(end<0)fail();i=end+2;continue;}
        if(char==='"'||char==="'"||char==='`'){
            const raw=char==='`'&&/\bString\s*\.\s*raw\s*$/.test(source.slice(Math.max(0,i-256),i));
            const part=char==='`'?templateAt(source,i,raw):stringAt(source,i,raw?'raw':'js');
            for(const expression of part.expressions||[])values.push(...jsReferences(expression,details));
            // Protocol labels in an explicit URL.protocol comparison are data,
            // not attempted requests. Do not exempt the same literal in fetch().
            const protocolComparison=/^https?:$/i.test(part.value)
                && /\[\s*(?:(['"])https?:\1\s*,\s*)*$/.test(source.slice(Math.max(0,i-256),i))
                && /^(?:\s*,\s*(['"])https?:\1)*\s*\]\s*\.\s*includes\s*\(\s*[\w$.]+\.protocol\s*\)/.test(source.slice(part.end));
            if(!protocolComparison)values.push(details?{value:part.value,navigation:/\b(?:href|url)\s*:\s*$/.test(source.slice(Math.max(0,i-256),i)),passive:/\b(?:createElementNS|setAttributeNS)\s*\(\s*$/.test(source.slice(Math.max(0,i-256),i)),active:/\b(?:fetch|import|Worker|SharedWorker|EventSource|WebSocket|sendBeacon)\s*\(\s*$/.test(source.slice(Math.max(0,i-256),i))}:part.value);
            i=part.end;canStartRegex=false;continue;
        }
        if(char==='/'&&canStartRegex){
            let inClass=false;i++;
            while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i]==='[')inClass=true;if(source[i]===']')inClass=false;if(source[i++]==='/'&&!inClass)break;}
            while(/[a-z]/i.test(source[i]||''))i++;
            canStartRegex=false;continue;
        }
        const word=source.slice(i).match(/^[a-z_$][\w$]*/i)?.[0];
        if(word){i+=word.length;canStartRegex=['return','throw','case','delete','void','typeof','instanceof','in','of','yield','await'].includes(word);continue;}
        canStartRegex=!/[\w)\]}]/.test(char);i++;
    }
    return values;
}

function interpolationEnd(source,start) {
    let i=start,depth=1;
    while(i<source.length){
        if(source.startsWith('//',i)){const end=source.indexOf('\n',i+2);if(end<0)fail();i=end+1;continue;}
        if(source.startsWith('/*',i)){i=skipCommentsAndSpace(source,i);continue;}
        if(source[i]==='"'||source[i]==="'"){i=stringAt(source,i,'js').end;continue;}
        if(source[i]==='`'){i=templateAt(source,i,false).end;continue;}
        if(source[i]==='{')depth++;
        if(source[i]==='}'&&!--depth)return i;
        i++;
    }
    fail();
}

function templateAt(source,start,raw) {
    let i=start+1,value='';const expressions=[];
    while(i<source.length){
        if(source[i]==='`')return {value,end:i+1,expressions};
        if(source.startsWith('${',i)){
            const end=interpolationEnd(source,i+2);expressions.push(source.slice(i+2,end));value+='${}';i=end+1;continue;
        }
        if(source[i]==='\\'){
            if(raw){value+=source.slice(i,i+2);i+=2;}
            else {const [part,end]=escapeValue(source,i,'js');value+=part;i=end;}
        } else value+=source[i++];
    }
    fail();
}

export function srcsetReferences(source) {
    // HTML's candidate collection keeps internal commas in a URL. Only trailing
    // commas or descriptor separators end candidates; do not split URL userinfo.
    const values=[];let i=0;
    while(i<source.length){
        while(i<source.length&&(asciiSpace(source[i])||source[i]===','))i++;
        const start=i;while(i<source.length&&!asciiSpace(source[i]))i++;
        let value=source.slice(start,i);if(!value)break;
        if(value.endsWith(',')){values.push(value.replace(/,+$/,''));continue;}
        values.push(value);
        let parentheses=0;
        while(i<source.length){const char=source[i++];if(char==='(')parentheses++;else if(char===')')parentheses=Math.max(0,parentheses-1);else if(char===','&&!parentheses)break;}
    }
    return values;
}

export function sourceReferences(source,kind) {
    if(kind==='css')return {base:null,values:cssReferences(source)};
    if(kind==='js') {
      const values=jsReferences(source,true),navigation=[],mentions=[],documents=[];
      const requests=[];
      for(const entry of values){
        const value=entry.value;
        if(entry.passive || !entry.active && /^(?:http:\/\/www\.w3\.org\/(?:1999\/xhtml|2000\/svg|1998\/Math\/MathML|1999\/xlink|XML\/1998\/namespace)|https:\/\/react\.dev\/errors\/)/.test(value))mentions.push(value);
        else if(entry.navigation)navigation.push(value);
        else if(/<(?:a|iframe|script|img|style|link|source|object|embed|form|svg|div|span|button|input|p|footer|header|main)\b/i.test(value))documents.push(value);
        else if(entry.active || !/^[\t\n\r ]*\/\/(?:[\t\n\r ]|$|#)/.test(value))requests.push(value);
      }
      return {base:null,values:requests,navigation,mentions,documents};
    }
    if(kind==='navigation'||kind==='mention')return {base:null,values:[],[kind==='navigation'?'navigation':'mentions']:[source]};
    if(kind==='url')return {base:null,values:[source]};
    if(kind==='srcset')return {base:null,values:srcsetReferences(source)};
    if(kind!=='html')fail();
    const parsed=runHtmlHelper(source);
    const parts=parsed.references.filter(ref=>ref.kind!=='html').map(ref=>sourceReferences(ref.value,ref.kind));
    return {base:parsed.base,values:parts.flatMap(p=>p.values),navigation:parts.flatMap(p=>p.navigation||[]),mentions:parts.flatMap(p=>p.mentions||[]),
      documents:[...parsed.references.filter(ref=>ref.kind==='html').map(ref=>ref.value),...parts.flatMap(p=>p.documents||[])],decodedText:parsed.decodedText};
}

const exactKeys=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
export function validateHtmlHelperOutput(parsed,decodeOnly=false) {
    if(!exactKeys(parsed,decodeOnly?['decodedText']:['base','references','decodedText'])||typeof parsed.decodedText!=='string')fail();
    if(!decodeOnly){
        if(parsed.base!==null&&typeof parsed.base!=='string'||!Array.isArray(parsed.references))fail();
        for(const ref of parsed.references)if(!exactKeys(ref,['kind','value'])||!['url','srcset','css','js','html','navigation','mention'].includes(ref.kind)||typeof ref.value!=='string')fail();
    }
    return parsed;
}

const helperCache=new Map();
function runHtmlHelper(source,decodeOnly=false) {
    const key=(decodeOnly?'decode:':'html:')+source;
    if(helperCache.has(key))return helperCache.get(key);
    const result=spawnSync(process.platform==='win32'?'python':'python3',[htmlHelper,...(decodeOnly?['--decode-text']:[])],{input:source,encoding:'utf8',maxBuffer:16*1024*1024});
    if(result.status!==0)throw Error('Cannot extract HTML references; Python 3 is required');
    let parsed;try{parsed=JSON.parse(result.stdout);}catch{fail();}
    validateHtmlHelperOutput(parsed,decodeOnly);
    if(source.length&&parsed.decodedText.length===0)fail();
    if(helperCache.size>=64)helperCache.delete(helperCache.keys().next().value);
    helperCache.set(key,parsed);
    return parsed;
}

export const decodeReferenceText=source=>runHtmlHelper(source,true).decodedText;
