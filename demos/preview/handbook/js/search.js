// The handbook's search, and the colouring of its code samples. Nothing here touches the page, so both can be checked in Node.

// ---- Search ----
// A page is { id, title, sections: [{ id, heading, text, code }] }. Searching returns sections, best first.
// Words are matched by their stem ("approved" finds "approval", "deleting" finds "delete"), by their beginning ("hand" finds "handover"),
// or when they are all but the same ("silent" finds "silence"). They may come in any order, and every word asked for must be somewhere in the section or its headings.
const STOP = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with']);
// A possessive is not a word of its own: "owner's" is "owner". A lone letter is not a word either.
export const words = text => (text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]s\b/g, '').replace(/['’]/g, '').match(/[a-z0-9]+/g) || []).filter(w => w.length > 1 || /[0-9]/.test(w));
// The stem of a word: its endings taken off, so that the forms of one word meet. Rough, and the same on both sides, which is all a search needs.
export function stem(w) { if (w.length <= 3 || /^[0-9]+$/.test(w)) return w; let s = w;
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3); else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2); else if (s.length > 4 && /(s|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2); else if (s.length > 3 && s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  if (s.length > 6 && s.endsWith('al')) s = s.slice(0, -2); if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1); if (s.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(s) && !/(ll|ss)$/.test(s)) s = s.slice(0, -1); if (s.length > 3 && s.endsWith('y')) s = s.slice(0, -1) + 'i'; return s; }
// How well a word of the text answers a word asked for: 1 the same, 0.6 it begins with it, 0.4 all but the same, 0 not at all.
const shared = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };
export const answers = (w, t) => (w === t ? 1 : t.length >= 2 && w.startsWith(t) ? 0.6 : shared(w, t) >= 5 && shared(w, t) >= Math.max(w.length, t.length) - 2 ? 0.4 : 0);

export function buildIndex(pages) { const entries = []; for (const page of pages) for (const s of page.sections) entries.push({ page: page.id, pageTitle: page.title, id: s.id, heading: s.heading, text: s.text, top: s.id === page.id, title: words(page.title).map(stem), head: words(s.heading).map(stem), body: words(s.text).map(stem), code: words(s.code || '').map(stem) }); return entries; }

// Returns up to `limit` sections, best first. The array also says how many more there were: results.more.
export function search(index, query, limit = 8) { const asked = [...new Set(words(query))].filter(w => !STOP.has(w)), terms = [...new Set(asked.map(stem))], none = Object.assign([], { more: 0 }); if (!terms.length) return none; // words too common to mean anything find nothing
  const hits = []; for (const e of index) { let score = 0, all = true; for (const t of terms) { const best = list => list.reduce((b, w) => Math.max(b, answers(w, t)), 0);
      const inHead = best(e.head) * 10, inTitle = best(e.title) * 5 + (e.top && best(e.title) === 1 ? 4 : 0), count = e.body.reduce((n, w) => n + answers(w, t), 0), inBody = count ? 1 + Math.min(3, Math.log2(1 + count)) : 0, inCode = best(e.code) ? 1 : 0, got = inHead + inTitle + inBody + inCode; if (!got) { all = false; break; } score += got; } // a word that is the page's own name puts that page first
    if (all) hits.push({ page: e.page, pageTitle: e.pageTitle, id: e.id, heading: e.heading, score: Math.round(score * 100) / 100, snippet: snippet(e.text, asked) }); }
  hits.sort((a, b) => b.score - a.score || a.pageTitle.localeCompare(b.pageTitle) || a.heading.localeCompare(b.heading)); return Object.assign(hits.slice(0, limit), { more: Math.max(0, hits.length - limit) }); }

// A short piece of the text round the first word found, as parts: [{ text, hit }]. The page marks the hits; nothing here writes HTML.
export function snippet(text, asked, span = 110) { const terms = asked.map(stem), re = /[A-Za-z0-9À-ɏ]+(?:['’][a-z]+)?/g, found = []; let m; while ((m = re.exec(text))) { const w = stem(words(m[0])[0] || ''); if (w && terms.some(t => answers(w, t) > 0)) found.push([m.index, m.index + m[0].length]); }
  let from = 0, to = Math.min(text.length, span); if (found.length) { from = Math.max(0, found[0][0] - 36); to = Math.min(text.length, from + span); if (from > 0) { const sp = text.indexOf(' ', from); if (sp > 0 && sp < found[0][0]) from = sp + 1; } } if (to < text.length) { const sp = text.lastIndexOf(' ', to); if (sp > from + 20) to = sp; }
  const parts = []; let at = from; for (const [a, b] of found) { if (a < from || b > to) continue; if (a > at) parts.push({ text: text.slice(at, a), hit: false }); parts.push({ text: text.slice(a, b), hit: true }); at = b; } if (at < to) parts.push({ text: text.slice(at, to), hit: false });
  if (from > 0 && parts.length) parts[0].text = '… ' + parts[0].text.replace(/^\s+/, ''); if (to < text.length && parts.length) parts[parts.length - 1].text = parts[parts.length - 1].text.replace(/\s+$/, '') + ' …'; return parts; }

// ---- Code colouring ----
// Splits a code sample into [{ text, kind }], where kind is one of: comment, string, number, keyword, name (something being called or set), or '' for the rest.
// It is deliberately small: enough to make shell commands, YAML, JSON and JavaScript easier on the eye. Joined back together, the parts are the sample exactly.
const KEYWORDS = { js: 'const let var function return if else for of in while do await async import from export new class extends throw try catch finally typeof instanceof switch case break continue default true false null undefined', sh: 'if then else fi for do done in while case esac export cd echo exit', json: 'true false null' };
const joiner = () => { const out = []; return { out, push(text, k) { if (!text) return; const last = out[out.length - 1]; if (last && last.kind === k) last.text += text; else out.push({ text, kind: k }); } }; };
// YAML is coloured a line at a time: a key before its colon, a comment after a hash, and a value only when the whole of it is a figure, a quoted string, or one of true, false, null, yes, no. A word such as "no" inside a sentence is a word.
function yaml(code) { const { out, push } = joiner(); code.split('\n').forEach((line, n) => { if (n) push('\n', ''); const m = /^(\s*(?:- )?)([A-Za-z_][\w-]*)(\s*:)(?=\s|$)/.exec(line); let rest = line; if (m) { push(m[1], ''); push(m[2], 'name'); push(m[3], ''); rest = line.slice(m[0].length); } else { const d = /^\s*- /.exec(line); if (d) { push(d[0], ''); rest = line.slice(d[0].length); } }
    let note = ''; const h = /(^|\s)#/.exec(rest.replace(/"[^"]*"|'[^']*'/g, s => ' '.repeat(s.length))); if (h) { note = rest.slice(h.index + h[1].length); rest = rest.slice(0, h.index + h[1].length); }
    const lead = /^\s*/.exec(rest)[0], trail = /\s*$/.exec(rest.slice(lead.length))[0], value = rest.slice(lead.length, rest.length - trail.length); push(lead, ''); push(value, /^(true|false|null|yes|no|~)$/.test(value) ? 'keyword' : /^-?\d[\d_]*(\.\d+)?$/.test(value) ? 'number' : /^("[^"]*"|'[^']*')$/.test(value) ? 'string' : ''); push(trail, ''); push(note, 'comment'); }); return out; }
export function colour(code, lang = '') { const kind = { javascript: 'js', js: 'js', bash: 'sh', sh: 'sh', shell: 'sh', yaml: 'yaml', yml: 'yaml', json: 'json' }[lang] || ''; if (kind === 'yaml') return yaml(code);
  const keys = new Set((KEYWORDS[kind] || '').split(' ').filter(Boolean)), { out, push } = joiner(), hash = kind === 'sh', slashes = kind === 'js'; let i = 0; while (i < code.length) { const rest = code.slice(i), c = code[i]; let m;
    if (hash && c === '#' && (i === 0 || /\s/.test(code[i - 1]))) { const end = code.indexOf('\n', i); push(code.slice(i, end < 0 ? code.length : end), 'comment'); i = end < 0 ? code.length : end; }
    else if (slashes && rest.startsWith('//')) { const end = code.indexOf('\n', i); push(code.slice(i, end < 0 ? code.length : end), 'comment'); i = end < 0 ? code.length : end; }
    else if (slashes && rest.startsWith('/*')) { const end = code.indexOf('*/', i + 2); push(code.slice(i, end < 0 ? code.length : end + 2), 'comment'); i = end < 0 ? code.length : end + 2; }
    else if (slashes && c === '`') { let j = i + 1, from = i; while (j < code.length && code[j] !== '`') { if (code[j] === '\\') { j += 2; continue; } if (code[j] === '$' && code[j + 1] === '{') { const end = code.indexOf('}', j); if (end < 0) break; push(code.slice(from, j), 'string'); push('${', ''); for (const p of colour(code.slice(j + 2, end), 'js')) push(p.text, p.kind); push('}', ''); j = end + 1; from = j; continue; } j++; } j = Math.min(code.length, j + 1); push(code.slice(from, j), 'string'); i = j; } // inside ${ } in a template is code, not string
    else if (kind && (c === '"' || c === "'")) { let j = i + 1; while (j < code.length && code[j] !== c && (kind === 'sh' || code[j] !== '\n')) j += code[j] === '\\' ? 2 : 1; /* a shell string may run over several lines */ j = Math.min(code.length, j + 1); const text = code.slice(i, j), isKey = kind === 'json' && /^\s*:/.test(code.slice(j)); push(text, isKey ? 'name' : 'string'); i = j; }
    else if (kind && (m = /^-?\d[\d_]*(\.\d+)?\b/.exec(rest)) && (i === 0 || !/[A-Za-z0-9_$.-]/.test(code[i - 1]))) { push(m[0], 'number'); i += m[0].length; }
    else if (kind && (m = /^[A-Za-z_$][\w$-]*/.exec(rest))) { const w = m[0], after = code.slice(i + w.length), first = /(^|\n)\s*$/.test(code.slice(0, i)) || /[|;&(]\s*$/.test(code.slice(0, i)); let k = '';
      if (keys.has(w)) k = 'keyword'; else if (kind === 'js' && /^\s*\(/.test(after)) k = 'name'; else if (kind === 'sh' && first) k = 'name'; push(w, k); i += w.length; }
    else { push(c, ''); i++; } }
  return out; }
