import {decodedTextViews,MAX_DOCUMENT_DEPTH} from './privacy-data-documents.mjs';
import {decodeReferenceText} from './privacy-source-references.mjs';

// This sweep is deliberately independent of HTML/CSS/JS reference recognition.
// Keep every normalisation view: decoding must never erase an earlier token.
function normaliseEscapes(source,kind) {
    return source.replace(/\\(?:u\{([0-9a-f]{1,6})\}|u([0-9a-f]{4})|x([0-9a-f]{2})|([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|([\s\S]))/gi,(whole,braced,unicode,hex,css,char)=>{
        const digits=braced||unicode||hex||(kind==='css'?css:null);
        if(digits){const value=parseInt(digits,16);return value>0x10ffff||value===0?'\ufffd':String.fromCodePoint(value);}
        if(css)return whole;
        if(char==='\n'||char==='\r')return '';
        return ({t:'\t',n:'\n',r:'\r'})[char]??char;
    });
}

export function backstopHosts(source,{baseURL='https://elusionworks.com/',decodedText}={}) {
    // Without an entity opener, HTML entity decoding is the identity function.
    // Avoid starting Python for each vendor-code comment/context in that case.
    const decoded=decodedText??(/&(?:#|[a-z])/i.test(source)?decodeReferenceText(source):source);
    const views=new Set([decoded]);
    for(const kind of ['js','css']){
        let text=decoded;
        for(let depth=0;depth<8;depth++){
            const next=normaliseEscapes(text,kind);views.add(next);
            if(next===text)break;
            if(depth===7)throw Error('Backstop escape nesting exceeds the inspection limit');
            text=next;
        }
    }
    const queue=[...views].map(text=>({text,depth:0}));
    for(let index=0;index<queue.length;index++){
        const {text,depth}=queue[index];
        const candidates=[...decodedTextViews(text),normaliseEscapes(text,'js'),normaliseEscapes(text,'css')];
        if(/&(?:#|[a-z])/i.test(text))candidates.push(decodeReferenceText(text));
        for(const candidate of candidates){
            if(views.has(candidate))continue;
            if(depth>=MAX_DOCUMENT_DEPTH)throw Error('Data URL inspection exceeds the nesting limit');
            views.add(candidate);queue.push({text:candidate,depth:depth+1});
        }
    }
    const hosts=new Set();
    for(const view of views){
        const text=view.replace(/[\t\n\r]/g,'');
        const starts=/(?:(?<![A-Za-z0-9+.-])[a-z][a-z0-9+.-]*:[\\/]{2}|(?<![\w:/\\])\/\/(?=[^\s/\\"'`<>]*[.@:]|[?#]))/gi;
        for(const match of text.matchAll(starts)){
            let end=match.index+match[0].length;
            while(end<text.length&&!/[\s"'`<>]/.test(text[end]))end++;
            // Closing source punctuation is not part of a bare token. Internal
            // punctuation, notably semicolons/commas before @, remains intact.
            const candidate=text.slice(match.index,end).replace(/[)};,]+$/,'');
            try {
                const url=new URL(candidate,baseURL);
                if(!url.hostname){if(!/^(?:https?|wss?|ftp):/i.test(candidate))continue;throw Error('Empty network host');}
                // Bare source comment markers are not protocol-relative URLs.
                // Active single-label URLs are still checked by structured extraction.
                if(candidate.startsWith('//') && !/^(?:[a-z0-9-]+\.)+[a-z0-9-]+\.?$/i.test(url.hostname) && !url.hostname.startsWith('[')) continue;
                hosts.add(url.hostname);
            } catch {if(!candidate.startsWith('//')||/^\/\/[?#]/.test(candidate))throw Error('Cannot parse a backstop URL-like token');}
        }
    }
    return hosts;
}

export function validateMentions(value) {
    const exact=(object,keys)=>object!==null&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).sort().join('|')===[...keys].sort().join('|');
    if(!exact(value,['version','mentions'])||value.version!==1||!Array.isArray(value.mentions))throw Error('Invalid non-request mention allowlist');
    const seen=new Set();
    for(const entry of value.mentions){
        if(!exact(entry,['kind','file','host','reason'])||entry.kind!=='non-request mention'||typeof entry.file!=='string'||typeof entry.host!=='string'||typeof entry.reason!=='string'||!entry.reason.trim())throw Error('Invalid non-request mention entry');
        if(entry.file.startsWith('/')||entry.file.includes('\\')||entry.file.split('/').some(part=>!part||part==='.'||part==='..'||part.includes('*'))||!/\.(html|css|js|jsx|svg|json)$/.test(entry.file))throw Error('Invalid non-request mention file');
        try {if(new URL('https://'+entry.host).hostname!==entry.host||/[/:@?#\s]/.test(entry.host))throw Error();}catch{throw Error('Invalid non-request mention host');}
        const key=entry.file+'\0'+entry.host;if(seen.has(key))throw Error('Duplicate non-request mention entry');seen.add(key);
    }
    return value.mentions;
}
