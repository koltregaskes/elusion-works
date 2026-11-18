// Browser check: the notice that this is a demo handbook with fictional sample rules is in view, above the words, wherever a reader arrives.
// Usage: node notice.mjs [base-url]
// It opens all nine pages and two section links, at 1280 and 390 wide, with scripts on and with scripts off, and also scrolled to the foot of the page.
// Each time it finds the words "fictional sample rules" on the screen and checks that they are inside the window, not covered, and above the heading the reader came for.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8780', url = base + '/demos/handbook/';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const PAGES = ['start', 'rooms', 'hub', 'claims', 'evidence', 'approvals', 'handovers', 'safety', 'reference'];
const LINKS = ['claims-stale', 'reference-glossary']; /* a section in the middle of the book, and the last section of the last page */
const failures = []; let seen = 0;

/* Where the notice is, and where the thing gone to is. The notice is found by its words, not by how it is built. */
const look = id => {
  let note = null; const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) { if (/fictional sample rules/i.test(walk.currentNode.textContent)) { const e = walk.currentNode.parentElement; const r = e.getBoundingClientRect(); if (r.width && r.height && e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) { note = e.closest('p, div, aside, section') || e; break; } } }
  const target = document.getElementById(id), head = target.tagName === 'ARTICLE' ? target.querySelector('h1') : target;
  const n = note && note.getBoundingClientRect(), h = head.getBoundingClientRect();
  /* Is anything drawn over the middle of the notice's words? */
  const hit = n ? document.elementFromPoint(Math.min(n.left + 40, innerWidth - 2), n.top + n.height / 2) : null;
  return { found: !!note, text: note ? note.textContent.replace(/\s+/g, ' ').trim() : '', top: n && n.top, bottom: n && n.bottom, covered: !!(note && hit && !note.contains(hit)), head: h.top, headBottom: h.bottom, vh: innerHeight };
};
function judge(where, s) {
  seen++;
  if (!s.found) return failures.push(`${where}: no notice on the screen`);
  if (!/demo handbook/i.test(s.text)) failures.push(`${where}: the notice does not say it is a demo handbook ("${s.text}")`);
  if (s.top < 0 || s.bottom > s.vh) failures.push(`${where}: the notice is out of the window (${Math.round(s.top)} to ${Math.round(s.bottom)})`);
  if (s.covered) failures.push(`${where}: something is drawn over the notice`);
  if (s.head !== null && s.headBottom > 0 && s.head < s.vh && s.bottom > s.head + 1) failures.push(`${where}: the notice is not above the heading (notice ends ${Math.round(s.bottom)}, heading starts ${Math.round(s.head)})`);
  return null;
}

for (const [w, h] of [[1280, 800], [390, 800]]) {
  for (const js of [true, false]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, javaScriptEnabled: js, colorScheme: 'dark', hasTouch: w < 700, isMobile: w < 700 }), p = await ctx.newPage();
    for (const id of [...PAGES, ...LINKS]) {
      const where = `${w}x${h} scripts ${js ? 'on' : 'off'} #${id}`;
      await p.goto('about:blank'); await p.goto(url + '#' + id); if (js) await p.waitForFunction(() => window.handbook); await p.waitForTimeout(150);
      const s = await p.evaluate(look, id);
      /* The heading gone to must itself be in the window: otherwise "above the heading" proves nothing. */
      if (!(s.head >= 0 && s.head < s.vh)) failures.push(`${where}: the heading gone to is not in the window (${Math.round(s.head)})`);
      judge(where, s);
      /* Read on to the foot of the page: the notice stays. */
      await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(100);
      const end = await p.evaluate(look, id); end.head = null; judge(where + ' at the foot', end);
    }
    await ctx.close();
  }
}
/* Text half as big again, on the narrowest phone: the notice takes two lines, and a section link still stops below it. */
{ const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true }), p = await ctx.newPage(); await p.addInitScript(() => { document.documentElement.style.fontSize = '150%'; });
  for (const id of ['claims', ...LINKS]) { const where = `320x568 text at 150% #${id}`; await p.goto('about:blank'); await p.goto(url + '#' + id); await p.waitForFunction(() => window.handbook); await p.waitForTimeout(200); const s = await p.evaluate(look, id); if (!(s.head >= 0 && s.head < s.vh)) failures.push(`${where}: the heading gone to is not in the window (${Math.round(s.head)})`); judge(where, s); }
  if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) failures.push('320x568 text at 150%: the page is wider than the window');
  /* On paper: the strip is not printed, and every page carries the words at its head instead. */
  await p.emulateMedia({ media: 'print' }); const paper = await p.evaluate(() => ({ strip: getComputedStyle(document.getElementById('demo-note')).display, heads: [...document.querySelectorAll('main article')].map(a => getComputedStyle(a, '::before').content) }));
  if (paper.strip !== 'none') failures.push('print: the strip under the bar is printed');
  if (paper.heads.length !== 9 || !paper.heads.every(c => /fictional sample rules/.test(c))) failures.push(`print: not every page is headed with the notice (${paper.heads.join(' | ')})`);
  await ctx.close(); }
await browser.close();
assert.deepEqual(failures, [], '\n' + failures.join('\n'));
console.log(`ok  the demo notice is in the window, uncovered and above the heading gone to: nine pages and two section links, at 1280 and 390, scripts on and off, and at the foot of each; with text at 150% on a 320 phone; and on paper every page is headed with it (${seen} views)`);
