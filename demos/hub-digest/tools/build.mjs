// Writes the email from the issue: email.html and email.txt beside the preview page, and the parts of the preview page that come from the issue (how an inbox shows it, and the checks), so that the page reads with scripts off.
// The plain text is not written into the page: it holds bare web addresses, and this site's own check lets a page hold an outside address only as a link. The page reads it from email.txt.
// Usage: node build.mjs   email.test.mjs fails if the files and the issue disagree.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render, lint, esc } from '../js/email.js';
import { ISSUE } from '../js/issue.js';

export const inbox = mail => `<p class="inbox"><span class="av" aria-hidden="true">AI</span><span class="who">AI Resource Hub</span><span class="subj">${esc(mail.subject)}</span><span class="pre">${esc(mail.preheader)}</span></p>`;
export const checks = mail => lint(mail).map(c => `<li class="${c.ok ? 'ok' : 'bad'}"><span class="mark" aria-hidden="true">${c.ok ? '✓' : '!'}</span><span class="what"><b>${esc(c.name)}</b><span class="sr"> (${c.ok ? 'passes' : 'fails'})</span><span class="detail">${esc(c.detail)}</span></span></li>`).join('\n');
export const between = (html, name) => { const a = `<!--${name}-->`, b = `<!--/${name}-->`, i = html.indexOf(a), j = html.indexOf(b); if (i < 0 || j < 0) throw new Error(`no ${name} markers in the page`); return { before: html.slice(0, i + a.length), inside: html.slice(i + a.length, j), after: html.slice(j) }; };
if (process.argv[1] === fileURLToPath(import.meta.url)) { const mail = render(ISSUE), bad = lint(mail).filter(c => !c.ok); if (bad.length) { console.error('not written: ' + bad.map(c => c.name).join('; ')); process.exit(1); }
  fs.writeFileSync(new URL('../email.html', import.meta.url), mail.html); fs.writeFileSync(new URL('../email.txt', import.meta.url), mail.text);
  const file = new URL('../index.html', import.meta.url); let html = fs.readFileSync(file, 'utf8'); for (const [name, make] of [['inbox', inbox], ['checks', checks]]) { const p = between(html, name); html = `${p.before}${make(mail)}${p.after}`; } fs.writeFileSync(file, html);
  console.log(`email.html (${mail.html.length} characters), email.txt (${mail.text.split('\n').length} lines) and the preview page written; every check passes`); }
