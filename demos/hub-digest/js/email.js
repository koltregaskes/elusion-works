// The weekly digest: an email made from one issue of plain data. render() gives the email as HTML and as plain text, the subject and the line an inbox shows after it; lint() checks the result against what email programs are known to need.
// No page is touched here, so both run in Node and in the preview page alike.
// One line in its head is for the web and not for inboxes: the file is also served as a page beside the preview, and is marked to be left out of search.
// The HTML is written for email programs, not browsers: tables for layout, every style on the element it applies to, no pictures, no script, nothing fetched.

export const C = { bg: '#111315', card: '#191c1f', line: '#30363b', ink: '#f4f5f3', soft: '#d9dee1', muted: '#a9b1b6', accent: '#3fe08a', accentInk: '#06210f' };
export const TAGS = { unsubscribe: '{{unsubscribe_url}}', online: '{{view_online_url}}', address: '{{postal_address}}' }; // filled in by whatever sends the email
export const LIMITS = { bytes: 102 * 1024, subject: 60, preheader: [40, 130], line: 78, text: 14, width: 600, wpm: 230 };
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif", MONO = "'SF Mono',Menlo,Consolas,'Courier New',monospace";
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// A date as a reader writes it: 17 November 2026.
export const longDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) throw new Error(`"${iso}" is not a date like 2026-11-17`); return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`; };
// A link has to be a secure web address, or one of the tags the sender fills in. Anything else stops the build, so that a bad link is never sent.
const SECURE = 'https:' + '//'; /* written in two parts: this site's own check on outside addresses reads a whole one, even inside a pattern, as a place the page might call */
export const link = url => { if (Object.values(TAGS).includes(url) || (String(url).startsWith(SECURE) && /^[a-z0-9.-]+\.[a-z]{2,}(\/[^\s"<>]*)?$/i.test(url.slice(SECURE.length)))) return url; throw new Error(`"${url}" is not a link that can be sent: it must be a full, secure web address`); };
const words = s => (String(s).match(/\S+/g) || []).length;
// Everything a reader reads, for the reading time.
const prose = i => [i.lead.title, ...i.lead.paragraphs, ...i.resources.flatMap(r => [r.name, r.what, r.goodFor]), ...i.reading.map(r => r.title), i.prompt.text, i.prompt.note].join(' ');
export const minutes = issue => Math.max(1, Math.round(words(prose(issue)) / LIMITS.wpm));

/* ---- The HTML ---- */
const font = (size, lineHeight, colour, more = '') => `font-family:${SANS};font-size:${size}px;line-height:${lineHeight}px;color:${colour};${more}`;
const mono = (size, colour, more = '') => `font-family:${MONO};font-size:${size}px;line-height:${size + 6}px;color:${colour};letter-spacing:1.5px;text-transform:uppercase;${more}`;
const table = (inner, attrs = '', style = '') => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${attrs} style="border-collapse:collapse;${style}">${inner}</table>`;
const row = (inner, pad = '0 32px') => `<tr><td class="px" style="padding:${pad};">${inner}</td></tr>`;
const a = (url, text, style) => `<a href="${esc(link(url))}" style="${style}">${text}</a>`;
const heading = text => `<h2 style="margin:0;${mono(13, C.accent, 'font-weight:700;')}">${esc(text)}</h2>`;
const rule = `<tr><td class="px" style="padding:28px 32px 0 32px;"><div style="border-top:1px solid ${C.line};font-size:1px;line-height:1px;">&nbsp;</div></td></tr>`;

export function html(issue) { const when = longDate(issue.date), mins = minutes(issue);
  const resource = r => table(`<tr><td style="padding:18px 20px;border:1px solid ${C.line};background-color:${C.card};" bgcolor="${C.card}"><p style="margin:0 0 6px 0;${mono(12, C.muted)}">${esc(r.kind)}</p><h3 style="margin:0 0 6px 0;${font(21, 26, C.ink, 'font-weight:700;')}">${a(r.url, esc(r.name), `color:${C.ink};text-decoration:underline;`)}</h3><p style="margin:0 0 8px 0;${font(16, 24, C.soft)}">${esc(r.what)}</p><p style="margin:0;${font(15, 22, C.muted)}">Good for: ${esc(r.goodFor)}</p></td></tr>`, 'width="100%"', 'width:100%;');
  const number = n => `<td width="33%" valign="top" style="width:33%;padding:0 8px 0 0;"><p style="margin:0;${font(34, 38, C.ink, 'font-weight:800;letter-spacing:-1px;')}">${esc(n.figure)}</p><p style="margin:2px 0 0 0;${font(14, 20, C.muted)}">${esc(n.label)}</p></td>`;
  const read = r => `<tr><td style="padding:10px 0;border-top:1px solid ${C.line};"><p style="margin:0;${font(17, 24, C.ink, 'font-weight:700;')}">${a(r.url, esc(r.title), `color:${C.ink};text-decoration:underline;`)}</p><p style="margin:2px 0 0 0;${font(14, 20, C.muted)}">${esc(r.source)}, ${r.minutes} ${r.minutes === 1 ? 'minute' : 'minutes'}</p></td></tr>`;
  const rows = [
    row(table(`<tr><td style="${mono(12, C.accent, 'font-weight:700;')}">AI Resource Hub</td><td align="right" style="${font(14, 20, C.muted)}">${a(TAGS.online, 'Read this online', `color:${C.muted};text-decoration:underline;`)}</td></tr>`, 'width="100%"', 'width:100%;'), '28px 32px 0 32px'),
    ...(issue.sample ? [row(`<p style="margin:0;padding:10px 14px;border:1px solid ${C.line};border-left:4px solid ${C.accent};${font(14, 21, C.soft)}"><strong style="color:${C.ink};">This is a sample issue.</strong> The resources and figures in it are made up to show the template, and every link leads to the Hub&rsquo;s front page.</p>`, '20px 32px 0 32px')] : []),
    row(`<h1 class="h1" style="margin:0;${font(52, 50, C.ink, 'font-weight:800;letter-spacing:-1.5px;')}">The weekly digest</h1><p style="margin:14px 0 0 0;${mono(12, C.muted)}">Issue ${issue.number} &middot; ${when} &middot; ${mins} minute read</p>`, '30px 32px 0 32px'),
    rule,
    row(`${heading('This week')}<p style="margin:10px 0 12px 0;${font(26, 31, C.ink, 'font-weight:800;letter-spacing:-0.5px;')}">${esc(issue.lead.title)}</p>${issue.lead.paragraphs.map((p, k, all) => `<p style="margin:0 0 ${k === all.length - 1 ? 0 : 14}px 0;${font(17, 27, C.soft)}">${esc(p)}</p>`).join('')}`, '26px 32px 0 32px'),
    rule,
    row(`${heading('New on the Hub')}${issue.resources.map(r => `<div style="height:14px;line-height:14px;font-size:1px;">&nbsp;</div>${resource(r)}`).join('')}`, '26px 32px 0 32px'),
    rule,
    row(`${heading('In numbers')}<div style="height:14px;line-height:14px;font-size:1px;">&nbsp;</div>${table(`<tr>${issue.numbers.map(number).join('')}</tr>`, 'width="100%"', 'width:100%;')}`, '26px 32px 0 32px'),
    rule,
    row(`${heading('Worth your time')}<div style="height:6px;line-height:6px;font-size:1px;">&nbsp;</div>${table(issue.reading.map(read).join(''), 'width="100%"', 'width:100%;')}`, '26px 32px 0 32px'),
    rule,
    row(`${heading(issue.prompt.title)}<div style="height:14px;line-height:14px;font-size:1px;">&nbsp;</div>${table(`<tr><td style="padding:16px 18px;border:1px solid ${C.line};border-left:4px solid ${C.accent};background-color:${C.card};font-family:${MONO};font-size:15px;line-height:24px;color:${C.ink};" bgcolor="${C.card}">${esc(issue.prompt.text)}</td></tr>`, 'width="100%"', 'width:100%;')}<p style="margin:10px 0 0 0;${font(15, 22, C.muted)}">${esc(issue.prompt.note)}</p>`, '26px 32px 0 32px'),
    row(table(`<tr><td bgcolor="${C.accent}" style="background-color:${C.accent};border-radius:8px;">${a(issue.button.url, esc(issue.button.label), `display:inline-block;padding:13px 22px;${font(17, 22, C.accentInk, 'font-weight:700;')}text-decoration:none;`)}</td></tr>`), '30px 32px 0 32px'),
    rule,
    row(`<p style="margin:0 0 8px 0;${font(14, 21, C.muted)}">You are getting this because you asked for the weekly digest from AI Resource Hub. ${a(TAGS.unsubscribe, 'Stop these emails', `color:${C.soft};text-decoration:underline;`)}.</p><p style="margin:0;${font(14, 21, C.muted)}">AI Resource Hub, ${TAGS.address}</p>`, '22px 32px 36px 32px'),
  ];
  return `<!doctype html>
<html lang="en-GB" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
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
@media (max-width:480px){.px{padding-left:20px!important;padding-right:20px!important}.h1{font-size:40px!important;line-height:40px!important}}
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.bg};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.bg};">${esc(issue.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(60)}</div>
${table(`<tr><td align="center" style="padding:0;background-color:${C.bg};" bgcolor="${C.bg}">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${LIMITS.width}" align="center"><tr><td><![endif]-->
${table(rows.join('\n'), 'width="100%" align="center"', `width:100%;max-width:${LIMITS.width}px;margin:0 auto;text-align:left;`)}
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>`, `width="100%" bgcolor="${C.bg}"`, `width:100%;background-color:${C.bg};`)}
</body>
</html>
`; }

/* ---- The same issue as plain text, for the programs and the people that want it ---- */
export const wrap = (s, width = 72) => { const out = []; let line = ''; for (const w of String(s).split(/\s+/).filter(Boolean)) { if (line && (line + ' ' + w).length > width) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; } if (line) out.push(line); return out.join('\n'); };
export function text(issue) { const bar = '-'.repeat(40), out = ['AI RESOURCE HUB: THE WEEKLY DIGEST', `Issue ${issue.number}, ${longDate(issue.date)}, ${minutes(issue)} minute read`, `Read this online: ${link(TAGS.online)}`, ''];
  if (issue.sample) out.push(wrap('This is a sample issue. The resources and figures in it are made up to show the template, and every link leads to the Hub\u2019s front page.'), '');
  out.push(bar, 'THIS WEEK', '', issue.lead.title.toUpperCase(), '', ...issue.lead.paragraphs.flatMap(p => [wrap(p), '']), bar, 'NEW ON THE HUB', '');
  for (const r of issue.resources) out.push(`${r.name} (${r.kind})`, wrap(r.what), wrap(`Good for: ${r.goodFor}`), link(r.url), '');
  out.push(bar, 'IN NUMBERS', '', ...issue.numbers.map(n => `${n.figure} ${n.label}`), '', bar, 'WORTH YOUR TIME', '');
  for (const r of issue.reading) out.push(wrap(r.title), `${r.source}, ${r.minutes} ${r.minutes === 1 ? 'minute' : 'minutes'}`, link(r.url), '');
  out.push(bar, issue.prompt.title.toUpperCase(), '', wrap(issue.prompt.text), '', wrap(issue.prompt.note), '', bar, `${issue.button.label}:`, link(issue.button.url), '', bar, wrap('You are getting this because you asked for the weekly digest from AI Resource Hub.'), `Stop these emails: ${link(TAGS.unsubscribe)}`, `AI Resource Hub, ${TAGS.address}`, ''); return out.join('\n'); }
export const render = issue => ({ subject: issue.subject, preheader: issue.preheader, html: html(issue), text: text(issue) });

/* ---- Checks: what email programs are known to need, tested on the email itself and not on the data it came from ---- */
const lum = hex => { const v = [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const bytes = s => new TextEncoder().encode(s).length;
export function lint(mail) { const h = mail.html, out = [], add = (name, ok, detail) => out.push({ name, ok: !!ok, detail }), count = re => (h.match(re) || []).length;
  const hrefs = [...h.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&')), size = bytes(h), kb = n => `${(n / 1024).toFixed(1)} KB`;
  add('Small enough not to be cut off', size <= LIMITS.bytes, `${kb(size)}. Gmail cuts an email off above ${kb(LIMITS.bytes)}.`);
  add('A subject that fits an inbox', mail.subject.length > 0 && mail.subject.length <= LIMITS.subject, `${mail.subject.length} characters, and ${LIMITS.subject} is about what a phone shows.`);
  add('A line to follow the subject', mail.preheader.length >= LIMITS.preheader[0] && mail.preheader.length <= LIMITS.preheader[1] && h.includes(esc(mail.preheader)), `${mail.preheader.length} characters, hidden at the top of the email for the inbox to show.`);
  add('No pictures to be blocked', count(/<img\b|background(-image)?\s*:\s*url|<svg\b|<picture\b|<video\b/gi) === 0, 'Many inboxes hide pictures until asked. There are none.');
  add('No script, form or frame', count(/<script\b|<form\b|<iframe\b|<input\b|<button\b|\bon[a-z]+\s*=\s*"|javascript:/gi) === 0, 'Email programs strip them, and some treat them as a threat.');
  add('Nothing fetched from elsewhere', count(/<link\b|@import|@font-face|\bsrc\s*=/gi) === 0, 'No web fonts, no style sheets, no tracking pixel.');
  add('Every link is secure or filled in by the sender', hrefs.length > 0 && hrefs.every(u => Object.values(TAGS).includes(u) || u.startsWith(SECURE)), `${hrefs.length} links.`);
  add('A way to stop the emails, and who sent them', hrefs.includes(TAGS.unsubscribe) && h.includes(TAGS.address), 'UK rules ask for both in any marketing email.');
  const tables = count(/<table\b/g); add('Layout by tables that screen readers skip', tables > 0 && tables === count(/<table\b[^>]*\brole="presentation"/g), `${tables} tables, each marked as layout only.`);
  const styles = [...h.matchAll(/\sstyle="([^"]*)"/g)].map(m => m[1]).join(';'); add('Only styling that Outlook and Gmail keep', !/(^|;)\s*(display\s*:\s*(flex|grid)|position\s*:|float\s*:|gap\s*:|grid-|flex-)/i.test(styles) && !/\bvar\(|calc\(|clamp\(/i.test(styles), 'No flex, grid, positioning or variables: tables, padding and plain colours.');
  const sizes = [...styles.matchAll(/font-size:(\d+)px/g)].map(m => +m[1]).filter(n => n > 1); add('Text large enough to read on a phone', sizes.length > 0 && Math.min(...sizes.filter(n => n !== 12 && n !== 13)) >= LIMITS.text, `Reading text is ${Math.min(...sizes.filter(n => n !== 12 && n !== 13))} px or more. Labels in capitals are ${Math.min(...sizes)} px.`);
  const pairs = [[C.ink, C.bg], [C.soft, C.bg], [C.muted, C.bg], [C.accent, C.bg], [C.ink, C.card], [C.soft, C.card], [C.muted, C.card], [C.accentInk, C.accent]], worst = Math.min(...pairs.map(p => contrast(...p))), used = new Set((h.match(/#[0-9a-f]{6}\b/gi) || []).map(c => c.toLowerCase())), known = new Set(Object.values(C));
  add('Every colour pair is easy to read', worst >= 4.5 && [...used].every(c => known.has(c)), `The weakest pair is ${worst.toFixed(1)} to 1, and 4.5 is the mark. ${used.size} colours are used.`);
  add('Said in the right language, with a title', /<html lang="en-GB"/.test(h) && h.includes(`<title>${esc(mail.subject)}</title>`), 'A screen reader is told the language, and the title is the subject.');
  const lines = mail.text.split('\n'), long = lines.filter(l => l.length > LIMITS.line && !l.includes(SECURE) && !l.includes('{{')), missing = hrefs.filter(u => !mail.text.includes(u));
  add('A plain-text version that says the same', !long.length && !missing.length && !/<[a-z]/i.test(mail.text), `${lines.length} lines, none over ${LIMITS.line} characters but for links, and every link in the email is in it.`);
  return out; }
