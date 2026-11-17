// Checks the email builder and its checks without a browser. Usage: node email.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as E from '../js/email.js';
import { ISSUE } from '../js/issue.js';
import { inbox, checks, between } from './build.mjs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), mail = E.render(ISSUE), failing = m => E.lint(m).filter(c => !c.ok).map(c => c.name);

// The email is the same each time it is made, and the files beside the page are the ones this issue makes.
assert.deepEqual(E.render(ISSUE), mail); assert.equal(read('email.html'), mail.html, 'email.html is not what the issue makes: run tools/build.mjs'); assert.equal(read('email.txt'), mail.text, 'email.txt is not what the issue makes: run tools/build.mjs');
{ const page = read('index.html'); for (const [name, make] of [['inbox', inbox], ['checks', checks]]) assert.equal(between(page, name).inside, make(mail), `the ${name} in the preview page is not what the issue makes: run tools/build.mjs`); }
// The preview page holds no bare outside address, which this site's own build refuses: the plain text is read from its file.
assert.ok(!/<pre[^>]*>[^<]*https:/.test(read('index.html')), 'the plain text is written into the preview page');
// The sample passes every check, and there are fourteen of them.
assert.deepEqual(failing(mail), []); assert.equal(E.lint(mail).length, 14);
// Each check fails when its fault is put in, and only that check. The faults are made by hand, not by the builder.
let faults = 0; const broken = (name, change, also = []) => { faults++; const m = change({ ...mail }); assert.deepEqual(failing(m).sort(), [name, ...also].sort(), name); };
broken('Small enough not to be cut off', m => ({ ...m, html: m.html.replace('</body>', `<p style="font-size:16px;">${'word '.repeat(21000)}</p></body>`) }));
broken('A subject that fits an inbox', m => ({ ...m, subject: 'x'.repeat(61), html: m.html.replace(/<title>.*<\/title>/, `<title>${'x'.repeat(61)}</title>`) }));
broken('A line to follow the subject', m => ({ ...m, preheader: 'Too short' })); broken('A line to follow the subject', m => ({ ...m, preheader: 'This line is the right length, but it is not the one that is hidden at the top of the email.' }));
broken('No pictures to be blocked', m => ({ ...m, html: m.html.replace('</body>', '<img alt="" width="1" height="1"></body>') })); broken('No pictures to be blocked', m => ({ ...m, html: m.html.replace('</body>', '<img src="https://example.com/pixel.gif" alt=""></body>') }), ['Nothing fetched from elsewhere']);
broken('No script, form or frame', m => ({ ...m, html: m.html.replace('</body>', '<script>1</script></body>') })); broken('No script, form or frame', m => ({ ...m, html: m.html.replace('<h1 ', '<h1 onclick="x()" ') }));
broken('Nothing fetched from elsewhere', m => ({ ...m, html: m.html.replace('</head>', '<link rel="stylesheet" href="https://example.com/a.css"></head>') }));
broken('Every link is secure or filled in by the sender', m => ({ ...m, html: m.html.replace('https://theairesourcehub.com/#new', 'http://theairesourcehub.com/#new'), text: m.text.replace('https://theairesourcehub.com/#new', 'http://theairesourcehub.com/#new') }));
broken('A way to stop the emails, and who sent them', m => ({ ...m, html: m.html.replaceAll(E.TAGS.address, 'somewhere') })); broken('A way to stop the emails, and who sent them', m => ({ ...m, html: m.html.replaceAll(E.TAGS.unsubscribe, 'https://example.com/keep'), text: m.text.replaceAll(E.TAGS.unsubscribe, 'https://example.com/keep') }));
broken('Layout by tables that screen readers skip', m => ({ ...m, html: m.html.replace('</body>', '<table><tr><td style="font-size:16px;">x</td></tr></table></body>') }));
broken('Only styling that Outlook and Gmail keep', m => ({ ...m, html: m.html.replace('<h1 class="h1" style="', '<h1 class="h1" style="display:flex;') })); broken('Only styling that Outlook and Gmail keep', m => ({ ...m, html: m.html.replace('<h1 class="h1" style="', '<h1 class="h1" style="position:absolute;') }));
broken('Text large enough to read on a phone', m => ({ ...m, html: m.html.replace('</body>', '<p style="font-size:11px;">small print</p></body>') }));
broken('Every colour pair is easy to read', m => ({ ...m, html: m.html.replace('</body>', '<p style="font-size:16px;color:#555555;">grey on charcoal</p></body>') }));
broken('Said in the right language, with a title', m => ({ ...m, html: m.html.replace('<html lang="en-GB"', '<html') }));
broken('A plain-text version that says the same', m => ({ ...m, text: m.text.replace('https://theairesourcehub.com/#lanternfile', '') })); broken('A plain-text version that says the same', m => ({ ...m, text: m.text + 'a line that runs on well past the seventy-eight characters that plain text keeps to\n' })); broken('A plain-text version that says the same', m => ({ ...m, text: m.text + '<b>bold</b>\n' }));

// Words that would break the email are made safe; the data cannot put markup in it.
{ const nasty = structuredClone(ISSUE); nasty.resources[0].name = '<script>alert("x")</script> & co'; nasty.lead.title = 'Tom & "Jerry" <b>'; const m = E.render(nasty); assert.ok(!m.html.includes('<script>alert') && m.html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co') && m.html.includes('Tom &amp; &quot;Jerry&quot; &lt;b&gt;')); assert.ok(m.text.includes('<script>alert("x")</script> & co (Tool)'), 'the plain text keeps the words as written'); assert.deepEqual(failing(m), ['A plain-text version that says the same'], 'markup in the words is caught in the plain text'); }
// A link that cannot be sent stops the build.
for (const url of ['http://example.com', 'javascript:alert(1)', '/hub/new', 'example.com', 'https://exa mple.com', 'https://example', 'mailto:a@example.com', '{{anything}}', '']) assert.throws(() => E.link(url), /not a link that can be sent/, url); for (const url of ['https://example.com', 'https://example.com/a/b?c=1&d=2#e', 'https://sub.example.co.uk/x', ...Object.values(E.TAGS)]) assert.equal(E.link(url), url);
{ const bad = structuredClone(ISSUE); bad.reading[1].url = 'http://example.com/read'; assert.throws(() => E.render(bad), /not a link that can be sent/); }
// Dates, reading time, wrapping and contrast, each against a value worked out by hand.
assert.deepEqual(['2026-11-17', '2027-01-01', '2026-02-28'].map(E.longDate), ['17 November 2026', '1 January 2027', '28 February 2026']); for (const d of ['17/11/2026', '2026-13-01', '2026-00-10', '2026-1-1', '']) assert.throws(() => E.longDate(d), /not a date/, d);
{ const all = [ISSUE.lead.title, ...ISSUE.lead.paragraphs, ...ISSUE.resources.flatMap(r => [r.name, r.what, r.goodFor]), ...ISSUE.reading.map(r => r.title), ISSUE.prompt.text, ISSUE.prompt.note].join(' ').split(/\s+/).filter(Boolean).length; assert.equal(E.minutes(ISSUE), Math.max(1, Math.round(all / 230))); assert.ok(all > 150 && all < 400, `${all} words`); assert.ok(mail.html.includes(`${E.minutes(ISSUE)} minute read`)); }
{ const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen', w = E.wrap(long, 30); assert.ok(w.split('\n').every(l => l.length <= 30)); assert.equal(w.replace(/\n/g, ' '), long); assert.equal(E.wrap('short'), 'short'); assert.equal(E.wrap('a-word-far-longer-than-the-width-allowed', 10), 'a-word-far-longer-than-the-width-allowed'); }
assert.equal(E.contrast('#ffffff', '#000000'), 21); assert.ok(Math.abs(E.contrast('#777777', '#ffffff') - 4.48) < 0.01); assert.ok(E.contrast(E.C.accentInk, E.C.accent) > 7); assert.equal(E.bytes('£'), 2);
// The shape of the email: one main heading, its parts in order, tables that close, and the hidden line first in the body.
{ const h = mail.html, n = re => (h.match(re) || []).length; assert.equal(n(/<h1\b/g), 1); assert.deepEqual([...h.matchAll(/<h2\b[^>]*>([^<]*)</g)].map(m => m[1]), ['This week', 'New on the Hub', 'In numbers', 'Worth your time', 'A prompt to try']); assert.equal(n(/<h3\b/g), ISSUE.resources.length);
  for (const tag of ['table', 'tr', 'td', 'p', 'a', 'h1', 'h2', 'h3', 'div']) assert.equal(n(new RegExp(`<${tag}\\b`, 'g')), n(new RegExp(`</${tag}>`, 'g')), `<${tag}> opened and closed a different number of times`); assert.ok(/<body[^>]*>\s*<div style="display:none;/.test(h)); assert.ok(h.includes('max-width:600px') && !/\swidth="600"(?![^>]*align="center"><tr><td><!\[endif\])/.test(h.replace(/<!--\[if mso\]>.*?<!\[endif\]-->/gs, '')), 'outside the part for Outlook, nothing is fixed at 600 wide'); }
// The plain text says what the email says.
for (const r of ISSUE.resources) assert.ok(mail.text.includes(`${r.name} (${r.kind})`) && mail.text.includes(r.url)); for (const n of ISSUE.numbers) assert.ok(mail.text.includes(`${n.figure} ${n.label}`)); assert.ok(mail.text.includes(E.wrap(ISSUE.prompt.text)) && mail.text.includes('This is a sample issue.')); assert.ok(mail.html.includes('This is a sample issue.'));
{ const quiet = E.render({ ...ISSUE, sample: false }); assert.ok(!quiet.html.includes('sample issue') && !quiet.text.includes('sample issue'), 'a real issue still says it is a sample'); assert.deepEqual(failing(quiet), []); }
for (const f of [mail.html, mail.text]) assert.ok(!/[\u2014\u2013]/.test(f), 'a dash crept into the email');
console.log(`ok  email: the files are the ones the issue makes; the sample passes all 14 checks; ${faults} faults put in by hand are each caught by the right check; markup in the words is made safe; a link that cannot be sent stops the build; dates, reading time, wrapping and contrast are right; the plain text says what the email says`);
