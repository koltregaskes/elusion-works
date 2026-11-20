// Checks the email as the built website would serve it. Usage: python3 scripts/build-site.py, then node built.test.mjs [built-site-folder]
// The website adds lines of its own to every page it serves. That is right for a page and wrong for an email, so the email a visitor copies is kept in files the build leaves alone.
// This reads the real built files, not a guess at what the build does, and holds them to the email the issue makes, byte for byte.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as E from '../js/email.js';
import { ISSUE } from '../js/issue.js';

const here = path.dirname(fileURLToPath(import.meta.url)), site = path.resolve(process.argv[2] || path.join(here, '../../../_site')), dir = path.join(site, 'demos/hub-digest');
const mail = E.render(ISSUE), sha = b => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
// Two lots of bytes are the same or they are not. If not: where they first differ, how long each is, and a fingerprint of each.
const differs = (got, want) => { if (got.equals(want)) return ''; let at = 0; while (at < got.length && at < want.length && got[at] === want[at]) at++; return `first differ at byte ${at}; ${got.length} bytes served, ${want.length} made; sha256 ${sha(got)} served, ${sha(want)} made`; };
const same = (name, want) => { const file = path.join(dir, name); assert.ok(fs.existsSync(file), `${name} is not in the built site at ${dir}: build it first with python3 scripts/build-site.py`); const why = differs(fs.readFileSync(file), Buffer.from(want, 'utf8')); assert.equal(why, '', `${name} as served is not what the issue makes: ${why}`); };

// The comparison itself is tried first on changes made here, so that a pass means something: one byte changed, another email of the same length, the end cut off, a line end added.
{ const want = Buffer.from(mail.html, 'utf8'), flip = Buffer.from(want); flip[1000] ^= 1; const swapped = Buffer.from(mail.html.replace('Lanternfile', 'Lanternfilf'), 'utf8');
  assert.equal(differs(want, want), ''); assert.match(differs(flip, want), /^first differ at byte 1000; /); assert.equal(swapped.length, want.length); assert.match(differs(swapped, want), /^first differ at byte \d+; /); assert.match(differs(want.subarray(0, want.length - 1), want), new RegExp(`^first differ at byte ${want.length - 1}; ${want.length - 1} bytes served, ${want.length} made`)); assert.match(differs(Buffer.concat([want, Buffer.from('\n')]), want), new RegExp(`^first differ at byte ${want.length}; ${want.length + 1} bytes served`)); }

// What a visitor copies or sends: the email and its plain text, exactly as made.
same('email.html.txt', mail.html); same('email.txt', mail.text);
// The email as a page to look at. It may differ from the email only by lines meant for web pages: the one this demo adds to keep it out of search, and the two the website adds to every page. With those three taken out it is the email again, to the byte. If the website starts adding something else, this says so.
{ const page = fs.readFileSync(path.join(dir, 'email.html'), 'utf8'), added = [E.WEB, /<meta http-equiv="Content-Security-Policy" content="[^"]*">\n/, '<meta name="referrer" content="strict-origin-when-cross-origin" />']; let rest = page;
  for (const a of added) { const before = rest; rest = rest.replace(a, ''); assert.notEqual(rest, before, `the page is missing a line this expects the website to add: ${a}`); }
  const why = differs(Buffer.from(rest, 'utf8'), Buffer.from(mail.html, 'utf8')); assert.equal(why, '', `email.html as served differs from the email by more than the three web lines: ${why}`);
  assert.ok(Buffer.byteLength(page) > Buffer.byteLength(mail.html), 'the page is no bigger than the email, so the web lines are not there'); assert.ok(!/Content-Security-Policy|name="referrer"|noindex/i.test(mail.html), 'the email itself carries a line meant for web pages'); }
// The preview page reads the email from the untouched file, and still shows the page in its frame.
{ const app = fs.readFileSync(path.join(dir, 'js/app.js'), 'utf8'), index = fs.readFileSync(path.join(dir, 'index.html'), 'utf8'); assert.ok(app.includes("['email.html.txt', 'email.txt']"), 'the preview page does not read the email from email.html.txt'); assert.ok(/<iframe id="mail" src="email\.html"/.test(index), 'the frame does not show email.html'); }
console.log(`ok  built: in ${path.relative(process.cwd(), dir) || dir}, email.html.txt (${Buffer.byteLength(mail.html)} bytes) and email.txt (${Buffer.byteLength(mail.text)} bytes) are the email the issue makes, byte for byte; email.html is that email plus three lines for the web and nothing else; the comparison rejects a changed byte, a same-length change, a cut and an added line end`);
