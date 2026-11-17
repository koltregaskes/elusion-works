// The weekly digest: an email made from one issue of plain data. render() gives the email as HTML and as plain text, the subject and the line an inbox shows after it; lint() checks the finished email.
// No page is touched here, so both run in Node and in the preview page alike.
// One line in the email's head is for the web and not for inboxes: the file is also served as a page beside the preview, and is marked to be left out of search.
// The HTML is written for email programs, not browsers: tables for layout, every style on the element it applies to, no pictures, no script, nothing fetched.

export const C = { bg: '#111315', card: '#191c1f', line: '#30363b', ink: '#f4f5f3', soft: '#d9dee1', muted: '#a9b1b6', accent: '#3fe08a', accentInk: '#06210f', caption: '#0b0c0d' };
export const TAGS = { unsubscribe: '{{unsubscribe_url}}', online: '{{view_online_url}}', address: '{{postal_address}}' }; // filled in by whatever sends the email
export const LIMITS = { bytes: 102 * 1024, subject: 60, preheader: [40, 130], line: 78, text: 14, label: 12, width: 600, wpm: 230, contrast: 4.5, figure: 7, numbers: [2, 4] };
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif", MONO = "'SF Mono',Menlo,Consolas,'Courier New',monospace";
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SECURE = 'https:' + '//'; /* written in two parts: this site's own check on outside addresses reads a whole one, even inside a pattern, as a place the page might call */

export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// A date as a reader writes it: 17 November 2026. A day that is not in the calendar, such as 31 February, is refused.
export const longDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso), d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); if (!m || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new Error(`"${iso}" is not a date like 2026-11-17`); return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`; };
// A link has to be a full, secure web address with a real host, or one of the tags the sender fills in. Anything else stops the build, so that a bad link is never sent.
export const isLink = url => { const u = String(url); if (Object.values(TAGS).includes(u)) return true; if (u.slice(0, SECURE.length).toLowerCase() !== SECURE || /[\s"'<>{}\\]/.test(u)) return false; try { const p = new URL(u); return p.protocol === 'https:' && !p.username && !p.password && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/i.test(p.hostname); } catch (err) { return false; } };
export const link = url => { if (isLink(url)) return String(url); throw new Error(`"${url}" is not a link that can be sent: it must be a full, secure web address`); };
const words = s => (String(s).match(/\S+/g) || []).length;
// Everything a reader reads, for the reading time.
const prose = i => [i.lead.title, ...i.lead.paragraphs, ...i.resources.flatMap(r => [r.name, r.what, r.goodFor]), ...i.reading.map(r => r.title), ...(i.prompt ? [i.prompt.text, i.prompt.note] : [])].join(' ');
export const minutes = issue => Math.max(1, Math.round(words(prose(issue)) / LIMITS.wpm));

// What an issue has to hold. A part left empty is left out of the email; a part filled in wrongly stops the build.
export function validate(i) { const bad = [], need = (ok, what) => { if (!ok) bad.push(what); }, str = v => typeof v === 'string' && v.trim().length > 0, list = v => Array.isArray(v), whole = v => Number.isInteger(v) && v > 0;
  need(i && typeof i === 'object', 'an issue'); if (bad.length) throw new Error('The issue needs: ' + bad.join('; '));
  need(str(i.subject), 'a subject'); need(str(i.preheader), 'a line to follow the subject'); need(whole(i.number), 'an issue number that is a whole number'); need(i.lead && str(i.lead.title) && list(i.lead.paragraphs) && i.lead.paragraphs.length > 0 && i.lead.paragraphs.every(str), 'a lead with a title and at least one paragraph');
  need(list(i.resources) && i.resources.every(r => r && [r.kind, r.name, r.what, r.goodFor, r.url].every(str)), 'resources that each have a kind, a name, what it is, who it is good for and a link');
  need(list(i.numbers) && (i.numbers.length === 0 || (i.numbers.length >= LIMITS.numbers[0] && i.numbers.length <= LIMITS.numbers[1])) && i.numbers.every(n => n && str(n.figure) && [...n.figure].length <= LIMITS.figure && str(n.label)), `no figures, or ${LIMITS.numbers[0]} to ${LIMITS.numbers[1]} of them, each of ${LIMITS.figure} characters or fewer with a label`);
  need(list(i.reading) && i.reading.every(r => r && [r.title, r.source, r.url].every(str) && whole(r.minutes)), 'things to read that each have a title, a source, a link and a whole number of minutes');
  need(!i.prompt || [i.prompt.title, i.prompt.text, i.prompt.note].every(str), 'a prompt with a title, its words and a note, or none'); need(!i.button || [i.button.label, i.button.url].every(str), 'a button with a label and a link, or none');
  if (bad.length) throw new Error('The issue needs: ' + bad.join('; ')); longDate(i.date); return i; }

/* ---- The HTML ---- */
const font = (size, lineHeight, colour, more = '') => `font-family:${SANS};font-size:${size}px;line-height:${lineHeight}px;mso-line-height-rule:exactly;color:${colour};word-break:break-word;overflow-wrap:anywhere;${more}`;
const mono = (size, colour, more = '') => `font-family:${MONO};font-size:${size}px;line-height:${size + 6}px;mso-line-height-rule:exactly;color:${colour};letter-spacing:1.5px;text-transform:uppercase;${more}`;
const table = (inner, attrs = '', style = '') => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${attrs} style="border-collapse:collapse;${style}">${inner}</table>`;
const row = (inner, pad = '0 32px') => `<tr><td class="px" style="padding:${pad};">${inner}</td></tr>`;
const a = (url, text, style) => `<a href="${esc(link(url))}" style="${style}">${text}</a>`;
const space = h => `<div style="height:${h}px;line-height:${h}px;mso-line-height-rule:exactly;font-size:1px;">&nbsp;</div>`;
// A section's name, as a caption in a comic: black on white.
const heading = text => `<h2 style="margin:0;font-size:12px;line-height:22px;mso-line-height-rule:exactly;"><span style="display:inline-block;padding:2px 8px;background-color:${C.ink};${mono(12, C.caption, 'font-weight:700;')}">${esc(text)}</span></h2>`;
const TOP = '34px 32px 0 32px';

export function html(issue) { validate(issue); const when = longDate(issue.date), mins = minutes(issue), lang = issue.lang || 'en-GB';
  const resource = r => table(`<tr><td style="padding:18px 20px;border:1px solid ${C.line};background-color:${C.card};" bgcolor="${C.card}"><p style="margin:0 0 6px 0;${mono(12, C.muted)}">${esc(r.kind)}</p><h3 style="margin:0 0 6px 0;${font(21, 26, C.ink, 'font-weight:700;')}">${a(r.url, esc(r.name), `color:${C.ink};text-decoration:underline;`)}</h3><p style="margin:0 0 8px 0;${font(16, 24, C.soft)}">${esc(r.what)}</p><p style="margin:0;${font(15, 22, C.muted)}">Good for: ${esc(r.goodFor)}</p></td></tr>`, 'width="100%"', 'width:100%;');
  const share = Math.floor(100 / Math.max(1, issue.numbers.length)), number = n => `<td width="${share}%" valign="top" style="width:${share}%;padding:14px 12px 12px 12px;border:2px solid ${C.ink};"><p class="fig" style="margin:0;${font(36, 38, C.ink, 'font-weight:800;letter-spacing:-1px;')}">${esc(n.figure)}</p><p style="margin:4px 0 0 0;${font(14, 19, C.soft)}">${esc(n.label)}</p></td>`;
  const read = (r, k) => `<tr><td style="padding:10px 0;${k ? `border-top:1px solid ${C.line};` : ''}"><p style="margin:0;${font(17, 24, C.ink, 'font-weight:700;')}">${a(r.url, esc(r.title), `color:${C.ink};text-decoration:underline;`)}</p><p style="margin:2px 0 0 0;${font(14, 20, C.muted)}">${esc(r.source)}, ${r.minutes} ${r.minutes === 1 ? 'minute' : 'minutes'}</p></td></tr>`;
  const rows = [
    row(table(`<tr><td style="${mono(12, C.accent, 'font-weight:700;')}">AI Resource Hub</td><td align="right" style="${font(14, 20, C.muted)}">${a(TAGS.online, 'Read this online', `color:${C.muted};text-decoration:underline;`)}</td></tr>`, 'width="100%"', 'width:100%;'), '28px 32px 0 32px'),
    /* the title in a panel of its own, as on the first page of a comic */
    row(table(`<tr><td style="padding:22px 22px 20px 22px;border:3px solid ${C.ink};"><h1 class="h1" style="margin:0;${font(52, 52, C.ink, 'font-weight:800;letter-spacing:-1.5px;')}">The weekly digest</h1><p style="margin:12px 0 0 0;${mono(12, C.muted)}">Issue ${issue.number} &middot; ${when} &middot; ${mins}&nbsp;minute&nbsp;read</p></td></tr>`, 'width="100%"', 'width:100%;'), '20px 32px 0 32px'),
    ...(issue.sample ? [row(table(`<tr><td style="padding:10px 14px;border:1px solid ${C.line};border-left:4px solid ${C.accent};${font(14, 21, C.soft)}"><strong style="color:${C.ink};">This is a sample issue.</strong> The resources and figures in it are made up to show the template. Its links lead to the Hub&rsquo;s front page, or are left for the sender to fill in.</td></tr>`, 'width="100%"', 'width:100%;'), '16px 32px 0 32px')] : []),
    row(`${heading('This week')}<h3 style="margin:12px 0 12px 0;${font(27, 32, C.ink, 'font-weight:800;letter-spacing:-0.5px;')}">${esc(issue.lead.title)}</h3>${issue.lead.paragraphs.map((p, k, all) => `<p style="margin:0 0 ${k === all.length - 1 ? 0 : 14}px 0;${font(17, 27, C.soft)}">${esc(p)}</p>`).join('')}`, TOP),
    ...(issue.resources.length ? [row(`${heading('New on the Hub')}${issue.resources.map(r => space(14) + resource(r)).join('')}`, TOP)] : []),
    ...(issue.numbers.length ? [row(`${heading('In numbers')}${space(14)}${table(`<tr>${issue.numbers.map(number).join('')}</tr>`, 'width="100%"', 'width:100%;table-layout:fixed;')}`, TOP)] : []),
    ...(issue.reading.length ? [row(`${heading('Worth your time')}${space(6)}${table(issue.reading.map(read).join(''), 'width="100%"', 'width:100%;')}`, TOP)] : []),
    ...(issue.prompt ? [row(`${heading(issue.prompt.title)}${space(14)}${table(`<tr><td style="padding:16px 18px;border:1px solid ${C.line};border-left:4px solid ${C.accent};background-color:${C.card};font-family:${MONO};font-size:15px;line-height:24px;mso-line-height-rule:exactly;color:${C.ink};word-break:break-word;overflow-wrap:anywhere;" bgcolor="${C.card}">${esc(issue.prompt.text).replace(/\n/g, '<br>')}</td></tr>`, 'width="100%"', 'width:100%;')}<p style="margin:10px 0 0 0;${font(15, 22, C.muted)}">${esc(issue.prompt.note)}</p>`, TOP)] : []),
    /* the button: its colour and its padding are on the table cell, which every email program keeps, so that it stays a button where the link's own padding is thrown away */
    ...(issue.button ? [row(table(`<tr><td class="btn" align="center" bgcolor="${C.accent}" style="padding:13px 22px;background-color:${C.accent};border-radius:8px;">${a(issue.button.url, esc(issue.button.label), `display:inline-block;${font(17, 22, C.accentInk, 'font-weight:700;')}text-decoration:none;`)}</td></tr>`), TOP)] : []),
    row(`<div style="border-top:1px solid ${C.line};font-size:1px;line-height:1px;mso-line-height-rule:exactly;">&nbsp;</div>`, '34px 32px 0 32px'),
    row(`<p style="margin:0 0 8px 0;${font(14, 21, C.muted)}">You are getting this because you asked for the weekly digest from AI Resource Hub. ${a(TAGS.unsubscribe, 'Stop these emails', `color:${C.soft};text-decoration:underline;`)}.</p><p style="margin:0;${font(14, 21, C.muted)}">AI Resource Hub, ${TAGS.address}</p>`, '20px 32px 36px 32px'),
  ];
  return `<!doctype html>
<html lang="${esc(lang)}" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="robots" content="noindex">
<title>${esc(issue.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
:root{color-scheme:dark light;supported-color-schemes:dark light}
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{mso-table-lspace:0;mso-table-rspace:0}
a:focus{outline:3px solid ${C.accent};outline-offset:2px}
[data-ogsc] .btn a{color:${C.accentInk}!important}
[data-ogsb] .btn{background-color:${C.accent}!important}
@media (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}.h1{font-size:40px!important;line-height:42px!important}.fig{font-size:26px!important;line-height:30px!important}}
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.bg};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.bg};">${esc(issue.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(60)}</div>
<div role="article" aria-roledescription="email" aria-label="${esc(issue.subject)}" lang="${esc(lang)}" dir="ltr">
${table(`<tr><td align="center" style="padding:0;background-color:${C.bg};" bgcolor="${C.bg}">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${LIMITS.width}" align="center"><tr><td><![endif]-->
${table(rows.join('\n'), 'width="100%" align="center"', `width:100%;max-width:${LIMITS.width}px;margin:0 auto;text-align:left;`)}
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>`, `width="100%" bgcolor="${C.bg}"`, `width:100%;background-color:${C.bg};`)}
</div>
</body>
</html>
`; }

/* ---- The same issue as plain text, for the programs and the people that want it ---- */
// Lines of 72 characters or fewer. Lines already in the words are kept, and a word too long for a line, as in a language written without spaces, is cut to fit. A link is never cut.
export const wrap = (s, width = 72) => String(s).split('\n').map(para => { const out = []; let line = ''; for (let w of para.split(/[ \t]+/).filter(Boolean)) { while ([...w].length > width && !isLink(w)) { if (line) { out.push(line); line = ''; } out.push([...w].slice(0, width).join('')); w = [...w].slice(width).join(''); }
  if (line && [...(line + ' ' + w)].length > width) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; } if (line) out.push(line); return out.join('\n'); }).join('\n');
export function text(issue) { validate(issue); const bar = '-'.repeat(40), out = ['AI RESOURCE HUB: THE WEEKLY DIGEST', `Issue ${issue.number}, ${longDate(issue.date)}, ${minutes(issue)} minute read`, `Read this online: ${link(TAGS.online)}`, ''];
  if (issue.sample) out.push(wrap('This is a sample issue. The resources and figures in it are made up to show the template. Its links lead to the Hub’s front page, or are left for the sender to fill in.'), '');
  out.push(bar, 'THIS WEEK', '', wrap(issue.lead.title.toUpperCase()), '', ...issue.lead.paragraphs.flatMap(p => [wrap(p), '']));
  if (issue.resources.length) { out.push(bar, 'NEW ON THE HUB', ''); for (const r of issue.resources) out.push(wrap(`${r.name} (${r.kind})`), wrap(r.what), wrap(`Good for: ${r.goodFor}`), link(r.url), ''); }
  if (issue.numbers.length) out.push(bar, 'IN NUMBERS', '', ...issue.numbers.map(n => wrap(`${n.figure} ${n.label}`)), '');
  if (issue.reading.length) { out.push(bar, 'WORTH YOUR TIME', ''); for (const r of issue.reading) out.push(wrap(r.title), wrap(`${r.source}, ${r.minutes} ${r.minutes === 1 ? 'minute' : 'minutes'}`), link(r.url), ''); }
  if (issue.prompt) out.push(bar, wrap(issue.prompt.title.toUpperCase()), '', wrap(issue.prompt.text), '', wrap(issue.prompt.note), '');
  if (issue.button) out.push(bar, wrap(`${issue.button.label}:`), link(issue.button.url), '');
  out.push(bar, wrap('You are getting this because you asked for the weekly digest from AI Resource Hub.'), `Stop these emails: ${link(TAGS.unsubscribe)}`, `AI Resource Hub, ${TAGS.address}`, ''); return out.join('\n'); }
export const render = issue => { validate(issue); return { subject: issue.subject, preheader: issue.preheader, html: html(issue), text: text(issue) }; };

/* ---- Reading the finished email: its tags, and every piece of text with the colour, the background and the size it ends up with ---- */
const VOID = new Set(['meta', 'br', 'img', 'link', 'hr', 'input', 'base', 'col', 'area', 'source', 'wbr']);
export function tokens(h) { const out = [], re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z][a-z0-9]*)\s*>|<([a-z][a-z0-9]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*\/?>|[^<]+|</gi; let m;
  while ((m = re.exec(h))) { if (m[0].startsWith('<!--')) out.push({ type: 'comment', value: m[0] }); else if (/^<!doctype/i.test(m[0])) continue; else if (m[1]) out.push({ type: 'close', tag: m[1].toLowerCase() }); else if (m[2]) { const attrs = {}; for (const at of m[3].matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g)) attrs[at[1].toLowerCase()] = at[2] ?? at[3] ?? at[4] ?? ''; out.push({ type: 'open', tag: m[2].toLowerCase(), attrs }); } else out.push({ type: 'text', value: m[0] }); } return out; }
export const decode = s => String(s).replace(/&nbsp;|&#160;/g, ' ').replace(/&#847;|&zwnj;|&#8204;/g, '').replace(/&middot;/g, '·').replace(/&rsquo;/g, '’').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const css = s => Object.fromEntries(String(s || '').split(';').map(d => { const k = d.indexOf(':'); return k < 0 ? null : [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim().toLowerCase()]; }).filter(Boolean));
// A colour as #rrggbb, or '?' if it is written some way this cannot weigh up.
const colourOf = v => { const s = String(v || '').trim().toLowerCase().split(/\s+(?![^(]*\))/)[0], m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s), rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s); if (/^#[0-9a-f]{6}$/.test(s)) return s; if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`; if (rgb) return '#' + rgb.slice(1, 4).map(n => Math.min(255, +n).toString(16).padStart(2, '0')).join(''); return '?'; };
export function read(h) { const toks = tokens(h), tags = [], runs = [], links = [], stack = [{ tag: '#root', colour: null, bg: null, size: NaN, upper: false, hidden: false }], out = { tags, runs, links, style: '', title: '', comments: [], first: null, bodySeen: false }; let raw = null;
  for (const t of toks) { const top = stack.at(-1);
    if (t.type === 'comment') { out.comments.push(t.value); continue; }
    if (raw) { if (t.type === 'close' && t.tag === raw) { raw = null; stack.pop(); } else if (t.type === 'text') { if (top.tag === 'style') out.style += t.value; if (top.tag === 'title') out.title += t.value; } continue; }
    if (t.type === 'text') { const words = decode(t.value); if (/[\p{L}\p{N}]/u.test(words)) { runs.push({ text: words.replace(/\s+/g, ' ').trim(), colour: top.colour, bg: top.bg, size: top.size, upper: top.upper, hidden: top.hidden, tag: top.tag }); for (const f of stack) if (f.link) f.link.text += words; if (out.first && stack.includes(out.first.frame)) out.first.text += words; } continue; }
    if (t.type === 'close') { const k = stack.map(f => f.tag).lastIndexOf(t.tag); if (k > 0) stack.length = k; continue; }
    const st = css(t.attrs.style), f = { tag: t.tag, colour: top.colour, bg: top.bg, size: top.size, upper: top.upper, hidden: top.hidden };
    if ('color' in st) f.colour = colourOf(st.color); const back = st['background-color'] ?? st.background ?? t.attrs.bgcolor; if (back !== undefined && back !== 'transparent' && back !== 'none') f.bg = colourOf(back);
    if ('font-size' in st) { const px = /^(\d+(?:\.\d+)?)px$/.exec(st['font-size']); f.size = px ? +px[1] : NaN; } if ('font' in st) f.size = NaN; if ('text-transform' in st) f.upper = st['text-transform'] === 'uppercase';
    if (st.display === 'none' || st.visibility === 'hidden' || 'mso-hide' in st || st.opacity === '0' || (st['max-height'] === '0' && st.overflow === 'hidden') || t.attrs.hidden !== undefined) f.hidden = true;
    tags.push({ tag: t.tag, attrs: t.attrs, style: st, hidden: f.hidden }); if (t.tag === 'a') { f.link = { href: decode(t.attrs.href ?? ''), has: 'href' in t.attrs, text: '', hidden: f.hidden }; links.push(f.link); }
    if (out.bodySeen && !out.first) out.first = { frame: f, hidden: f.hidden, text: '' }; if (t.tag === 'body') out.bodySeen = true;
    if (VOID.has(t.tag)) continue; stack.push(f); if (t.tag === 'style' || t.tag === 'title' || t.tag === 'script') raw = t.tag; }
  return out; }

/* ---- Checks. Each reads the finished email itself, and says what it tested, no more. ---- */
const lum = hex => { const v = [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const bytes = s => new TextEncoder().encode(s).length;
const plainWords = s => decode(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); /* letters and figures only, so that capitals, punctuation and where the lines break do not count as differences */
export function lint(mail) { const h = mail.html, doc = read(h), out = [], add = (name, ok, detail) => out.push({ name, ok: !!ok, detail }), kb = n => `${(n / 1024).toFixed(1)} KB`, size = bytes(h), seen = doc.runs.filter(r => !r.hidden), has = name => doc.tags.filter(t => t.tag === name), styles = doc.tags.map(t => t.attrs.style || '').join(';') + ';' + doc.style, some = list => list.length > 0;
  add('Small enough not to be cut off', size <= LIMITS.bytes, `${kb(size)} as written. Gmail cuts an email off above ${kb(LIMITS.bytes)}, and a sending service adds to it.`);
  add('A subject that fits an inbox', mail.subject.length > 0 && [...mail.subject].length <= LIMITS.subject, `${[...mail.subject].length} characters, and ${LIMITS.subject} is about what a phone shows.`);
  const first = doc.first, pre = first ? first.text.replace(/\s+/g, ' ').trim() : ''; add('A hidden line to follow the subject', first && first.hidden && pre === mail.preheader.replace(/\s+/g, ' ').trim() && [...mail.preheader].length >= LIMITS.preheader[0] && [...mail.preheader].length <= LIMITS.preheader[1] && !seen.some(r => r.text.includes(pre)), `${[...mail.preheader].length} characters, first in the email and hidden from the reader, for the inbox to show.`);
  add('No pictures', !some(doc.tags.filter(t => ['img', 'svg', 'picture', 'video', 'audio', 'canvas', 'object', 'embed'].includes(t.tag) || 'background' in t.attrs)) && !/url\s*\(/i.test(styles), 'Many inboxes hide pictures until asked. There are none, in the tags or the styles.');
  add('No script, form or frame', !some(doc.tags.filter(t => ['script', 'form', 'iframe', 'frame', 'input', 'button', 'select', 'textarea', 'object', 'embed', 'base', 'applet'].includes(t.tag) || Object.keys(t.attrs).some(k => /^on/.test(k)) || Object.values(t.attrs).some(v => /^\s*(javascript|vbscript|data):/i.test(v)) || (t.tag === 'meta' && /refresh/i.test(t.attrs['http-equiv'] || '')))), 'No tag that runs or collects anything, no handler on any tag, no link that runs code.');
  add('Nothing fetched from elsewhere', !some(doc.tags.filter(t => t.tag === 'link' || 'src' in t.attrs || 'srcset' in t.attrs || 'background' in t.attrs)) && !/@import|@font-face|url\s*\(/i.test(styles), 'No web fonts, no style sheets, no tracking pixel.');
  add('Every link is a full, secure address or left for the sender', some(doc.links) && doc.links.every(l => l.has && isLink(l.href) && l.text.trim() && !l.hidden), `${doc.links.length} links, each with words to press.`);
  const stop = doc.links.find(l => l.href === TAGS.unsubscribe); add('A way to stop the emails, and a place for who sent them', stop && !stop.hidden && stop.text.trim() && seen.some(r => r.text.includes(TAGS.address)), 'Both are in the words a reader sees. Whether a send meets the law is for the sender to check.');
  const tables = has('table'); add('Layout by tables that screen readers skip', some(tables) && tables.every(t => t.attrs.role === 'presentation'), `${tables.length} tables, each marked as layout only.`);
  add('No flex, grid or positioning', !/(^|[;{\s])(display\s*:\s*(inline-)?(flex|grid)|position\s*:|float\s*:|gap\s*:|grid-|flex-|inset\s*:)/i.test(styles) && !/\bvar\(|calc\(|clamp\(|min\(|max\(/i.test(styles), 'In the tags and the style block alike. Tables, padding and plain colours are what email programs share.');
  const sized = seen.filter(r => !(r.size >= (r.upper ? LIMITS.label : LIMITS.text))), block = [...doc.style.matchAll(/font-size\s*:\s*([^;}!]+)/gi)].map(m => m[1].trim()), small = seen.filter(r => !r.upper).map(r => r.size).filter(n => n > 0);
  add('Text large enough to read on a phone', some(seen) && !some(sized) && block.every(v => /^\d+(\.\d+)?px$/.test(v) && parseFloat(v) >= LIMITS.text), some(sized) ? `"${sized[0].text.slice(0, 40)}" is ${Number.isNaN(sized[0].size) ? 'given no size in px' : sized[0].size + ' px'}.` : `Every piece of text was measured: ${Math.min(...small)} px or more, and ${LIMITS.label} px for labels in capitals.`);
  const pairs = seen.map(r => ({ r, ratio: r.colour && r.bg && r.colour !== '?' && r.bg !== '?' ? contrast(r.colour, r.bg) : 0 })), worst = pairs.reduce((m, p) => (p.ratio < m.ratio ? p : m), { ratio: Infinity, r: null }), kinds = new Set(pairs.map(p => `${p.r.colour} on ${p.r.bg}`));
  add('Every piece of text is easy to read against what is behind it', some(pairs) && worst.ratio >= LIMITS.contrast, worst.ratio >= LIMITS.contrast ? `Worked out for each piece of text from its own colour and background: the weakest is ${worst.ratio.toFixed(1)} to 1, and ${LIMITS.contrast} is the mark. ${kinds.size} pairings are used.` : `"${worst.r.text.slice(0, 40)}" is ${worst.ratio ? worst.ratio.toFixed(1) + ' to 1' : 'in a colour this cannot weigh up'}.`);
  const html0 = has('html')[0], art = doc.tags.find(t => t.attrs.role === 'article'); add('The language is said twice, and the title is the subject', html0 && html0.attrs.lang && art && art.attrs.lang === html0.attrs.lang && decode(doc.title) === mail.subject, 'Once on the page and once on the email itself, because webmail throws the first away.');
  const lines = mail.text.split('\n'), long = lines.filter(l => [...l].length > LIMITS.line && !(isLink(l.trim().split(/\s+/).at(-1)) && [...l.trim()].length - [...l.trim().split(/\s+/).at(-1)].length <= 40)), flat = plainWords(mail.text), gone = seen.filter(r => !flat.includes(plainWords(r.text))), lost = doc.links.filter(l => !mail.text.includes(l.href));
  add('A plain-text version that says the same', !some(long) && !some(gone) && !some(lost), some(gone) ? `"${gone[0].text.slice(0, 40)}" is in the email and not in the plain text.` : `${lines.length} lines. Every piece of text and every link in the email is in it, and no line is over ${LIMITS.line} characters but for a link.`);
  return out; }
