// Data URL inspection only: never navigate, evaluate, fetch or load the bytes.
const MAX_BYTES=16*1024*1024;
export const MAX_DOCUMENT_DEPTH=32;

function percentBytes(value,svg=false) {
    for(const match of value.matchAll(/%(?![0-9a-f]{2})/gi)){
        // SVG percentage attributes such as width='100%' use a literal percent,
        // not a percent escape. Preserve that bounded valid XML spelling.
        if(!svg||!/[0-9]/.test(value[match.index-1]||'')||!/^(?:["']|%2[27])/i.test(value.slice(match.index+1)))throw Error('Malformed data URL escape');
    }
    const chunks=[];let start=0;
    for(const match of value.matchAll(/%([0-9a-f]{2})/gi)){
        chunks.push(Buffer.from(value.slice(start,match.index),'utf8'),Buffer.from([parseInt(match[1],16)]));
        start=match.index+3;
    }
    chunks.push(Buffer.from(value.slice(start),'utf8'));
    return Buffer.concat(chunks);
}

export function decodeDataURL(value,{required=false}={}) {
    let url;try{url=new URL(value);}catch{throw Error('Malformed data URL');}
    if(url.protocol!=='data:')return null;
    const path=url.pathname,comma=path.indexOf(',');
    if(comma<0||path.length>MAX_BYTES)throw Error('Malformed or oversized data URL');
    const parts=path.slice(0,comma).split(';').map(part=>part.trim().toLowerCase());
    const type=parts.shift()||'text/plain';
    if(type==='text/css'||/^(?:text|application)\/(?:x-)?(?:javascript(?:1\.[0-5])?|ecmascript|jscript|livescript)$/.test(type))throw Error('Data CSS and JavaScript documents are forbidden');
    const document=type==='text/html'||type==='image/svg+xml'||type==='application/xhtml+xml';
    if(required&&!document)throw Error('Unsupported data document type');
    const base64=parts.at(-1)==='base64';
    if(base64)parts.pop();
    if(parts.some(part=>part==='base64'))throw Error('Unsupported data URL encoding');
    if(document&&parts.some(part=>part!=='utf8'&&!/^charset\s*=\s*(?:"(?:utf-8|us-ascii)"|(?:utf-8|us-ascii))$/.test(part)))throw Error('Unsupported data document parameter');
    let bytes=percentBytes(path.slice(comma+1),type==='image/svg+xml'&&!base64);
    if(base64){
        const text=bytes.toString('ascii').replace(/[\t\n\f\r ]/g,'');
        const plain=text.replace(/=+$/,'');
        if(bytes.some(byte=>byte>127)||!/^[A-Za-z0-9+/]*={0,2}$/.test(text)||plain.length%4===1||text.includes('=')&&(text.length%4!==0||text.length-plain.length!==(4-plain.length%4)%4))throw Error('Undecodable base64 data URL');
        bytes=Buffer.from(text,'base64');
    }
    if(bytes.length>MAX_BYTES)throw Error('Oversized data document');
    if(document&&bytes.includes(0))throw Error('Unsupported data document encoding');
    if(document&&parts.some(part=>part.includes('us-ascii'))&&bytes.some(byte=>byte>127))throw Error('Non-ASCII data document');
    if(type==='text/html'&&!parts.some(part=>part.includes('utf-8'))&&bytes.some(byte=>byte>127))throw Error('Non-ASCII HTML needs an explicit UTF-8 charset');
    let source;try{source=new TextDecoder('utf-8',{fatal:document}).decode(bytes);}catch{throw Error('Undecodable data document');}
    if(document&&/<\?xml\b[^>]*\bencoding\s*=\s*['"](?!(?:utf-8|us-ascii)['"])/i.test(source))throw Error('Unsupported XML document encoding');
    return {source,kind:document?'html':null};
}

// Independent backstop views include percent escapes and data URL bodies even
// outside recognised request syntax. Keep originals, and bound recursive views.
export function decodedTextViews(source) {
    const views=[];
    const percent=source.replace(/(?:%[0-9a-f]{2})+/gi,part=>Buffer.from(part.match(/[0-9a-f]{2}/gi).map(byte=>parseInt(byte,16))).toString('utf8'));
    if(percent!==source)views.push(percent);
    const starts=/(?<![A-Za-z0-9+.-])data:[^,\s"'`<>]*,/gi;
    for(const match of source.matchAll(starts)){
        let end=match.index+match[0].length;
        while(end<source.length&&!/[\s"'`<>]/.test(source[end]))end++;
        // Never strip the required comma from an empty body or a normalisation
        // view whose decoded markup begins at the next source delimiter.
        const boundary=match.index+match[0].length;
        const value=source.slice(match.index,boundary)+source.slice(boundary,end).replace(/[)};,]+$/,'');
        views.push(decodeDataURL(value).source);
    }
    return views;
}
