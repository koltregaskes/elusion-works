// The handbook's search, and the colouring of its code samples. Nothing here touches the page, so both can be checked in Node.

// ---- Search ----
// A page is { id, title, sections: [{ id, heading, text }] }. Searching returns sections, best first.
// Words are matched whole or by their beginning ("hand" finds "handover"), in any order, and every word asked for must be somewhere in the section or its headings.
const STOP = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with']);
export const words = text => (text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) || []);
const stem = w => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w); // "claims" finds "claim"

export function buildIndex(pages) { const entries = []; for (const page of pages) for (const s of page.sections) entries.push({ page: page.id, pageTitle: page.title, id: s.id, heading: s.heading, text: s.text, title: words(page.title).map(stem), head: words(s.heading).map(stem), body: words(s.text).map(stem) }); return entries; }

export function search(index, query, limit = 8) { const asked = [...new Set(words(query).map(stem))], terms = asked.filter(w => !STOP.has(w)).length ? asked.filter(w => !STOP.has(w)) : asked; if (!terms.length) return [];
  const hits = []; for (const e of index) { let score = 0, all = true; for (const t of terms) { const rate = (list, whole, begins) => { let best = 0; for (const w of list) { if (w === t) { best = whole; break; } if (t.length >= 2 && w.startsWith(t)) best = Math.max(best, begins); } return best; };
      const inHead = rate(e.head, 10, 6), inTitle = rate(e.title, 5, 3), count = e.body.reduce((n, w) => n + (w === t ? 1 : t.length >= 2 && w.startsWith(t) ? 0.5 : 0), 0), inBody = count ? 1 + Math.min(3, Math.log2(1 + count)) : 0, got = inHead + inTitle + inBody; if (!got) { all = false; break; } score += got; }
    if (all) hits.push({ page: e.page, pageTitle: e.pageTitle, id: e.id, heading: e.heading, score: Math.round(score * 100) / 100, snippet: snippet(e.text, terms) }); }
  return hits.sort((a, b) => b.score - a.score || a.pageTitle.localeCompare(b.pageTitle) || a.heading.localeCompare(b.heading)).slice(0, limit); }

// A short piece of the text round the first word found, as parts: [{ text, hit }]. The page marks the hits; nothing here writes HTML.
export function snippet(text, terms, span = 110) { const re = /[A-Za-z0-9À-ɏ]+/g, found = []; let m; while ((m = re.exec(text))) { const w = stem(words(m[0])[0] || ''); if (terms.some(t => w === t || (t.length >= 2 && w.startsWith(t)))) found.push([m.index, m.index + m[0].length]); }
  let from = 0, to = Math.min(text.length, span); if (found.length) { from = Math.max(0, found[0][0] - 36); to = Math.min(text.length, from + span); if (from > 0) { const sp = text.indexOf(' ', from); if (sp > 0 && sp < found[0][0]) from = sp + 1; } } if (to < text.length) { const sp = text.lastIndexOf(' ', to); if (sp > from + 20) to = sp; }
  const parts = []; let at = from; for (const [a, b] of found) { if (a < from || b > to) continue; if (a > at) parts.push({ text: text.slice(at, a), hit: false }); parts.push({ text: text.slice(a, b), hit: true }); at = b; } if (at < to) parts.push({ text: text.slice(at, to), hit: false });
  if (from > 0 && parts.length) parts[0].text = '… ' + parts[0].text.replace(/^\s+/, ''); if (to < text.length && parts.length) parts[parts.length - 1].text = parts[parts.length - 1].text.replace(/\s+$/, '') + ' …'; return parts; }

// ---- Code colouring ----
// Splits a code sample into [{ text, kind }], where kind is one of: comment, string, number, keyword, name (something being called or set), or '' for the rest.
// It is deliberately small: enough to make shell commands, YAML, JSON and JavaScript easier on the eye. Joined back together, the parts are the sample exactly.
const KEYWORDS = { js: 'const let var function return if else for of in while await async import from export new class true false null undefined', sh: 'if then else fi for do done in while case esac export cd echo exit', yaml: 'true false null yes no', json: 'true false null' };
export function colour(code, lang = '') { const kind = { javascript: 'js', js: 'js', bash: 'sh', sh: 'sh', shell: 'sh', yaml: 'yaml', yml: 'yaml', json: 'json' }[lang] || '', keys = new Set((KEYWORDS[kind] || '').split(' ').filter(Boolean)), out = [], push = (text, k) => { if (!text) return; const last = out[out.length - 1]; if (last && last.kind === k) last.text += text; else out.push({ text, kind: k }); };
  const hash = kind === 'sh' || kind === 'yaml', slashes = kind === 'js'; let i = 0; while (i < code.length) { const rest = code.slice(i), c = code[i]; let m;
    if (hash && c === '#' && (i === 0 || /\s/.test(code[i - 1]))) { const end = code.indexOf('\n', i); push(code.slice(i, end < 0 ? code.length : end), 'comment'); i = end < 0 ? code.length : end; }
    else if (slashes && rest.startsWith('//')) { const end = code.indexOf('\n', i); push(code.slice(i, end < 0 ? code.length : end), 'comment'); i = end < 0 ? code.length : end; }
    else if (slashes && rest.startsWith('/*')) { const end = code.indexOf('*/', i + 2); push(code.slice(i, end < 0 ? code.length : end + 2), 'comment'); i = end < 0 ? code.length : end + 2; }
    else if (kind && (c === '"' || c === "'" || (slashes && c === '`'))) { let j = i + 1; while (j < code.length && code[j] !== c && (c === '`' || kind === 'sh' || code[j] !== '\n')) j += code[j] === '\\' ? 2 : 1; /* a shell string may run over several lines */ j = Math.min(code.length, j + 1); const text = code.slice(i, j), isKey = (kind === 'json' || kind === 'yaml') && /^\s*:/.test(code.slice(j)); push(text, isKey ? 'name' : 'string'); i = j; }
    else if (kind && (m = /^-?\d[\d_]*(\.\d+)?\b/.exec(rest)) && (i === 0 || !/[A-Za-z0-9_$.-]/.test(code[i - 1]))) { push(m[0], 'number'); i += m[0].length; }
    else if (kind && (m = /^[A-Za-z_$][\w$-]*/.exec(rest))) { const w = m[0], after = code.slice(i + w.length), first = /(^|\n)\s*$/.test(code.slice(0, i)) || /[|;&(]\s*$/.test(code.slice(0, i)); let k = '';
      if (keys.has(w)) k = 'keyword'; else if (kind === 'yaml' && /^\s*:(\s|$)/.test(after) && /(^|\n)[\s-]*$/.test(code.slice(0, i))) k = 'name'; else if (kind === 'js' && /^\s*\(/.test(after)) k = 'name'; else if (kind === 'sh' && first) k = 'name'; push(w, k); i += w.length; }
    else { push(c, ''); i++; } }
  return out; }
