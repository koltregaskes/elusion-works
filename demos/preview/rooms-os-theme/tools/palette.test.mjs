// Checks the theme's colours and scene without a browser or the Claude apps. Usage: node palette.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from '../js/palette.js';
import { DEFINITION, SCENE, ROOMS, LIT, TURN, GLOW, PLAN } from '../mod/hooks/house.js';

// The contrast sum itself, against values anyone can look up.
assert.ok(Math.abs(P.contrast('#000000', '#ffffff') - 21) < 1e-9); assert.ok(Math.abs(P.contrast('#777777', '#ffffff') - 4.478) < 0.005); assert.equal(P.contrast('#3fe08a', '#3fe08a'), 1); assert.equal(P.ratio('#777777', '#ffffff'), '4.4', 'a printed ratio is cut short, never rounded up');
// Worked a second way, by hand, for the house pair.
{ const ch = v => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4), L = (r, g, b) => 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b); const byHand = (L(0xf4, 0xf5, 0xf3) + 0.05) / (L(0x11, 0x13, 0x15) + 0.05); assert.ok(Math.abs(P.contrast('#f4f5f3', '#111315') - byHand) < 1e-9 && byHand > 16); }

// The house style is what the theme is built from.
assert.equal(DEFINITION.dark.gray.anchors['surface-0'], '#111315'); assert.equal(DEFINITION.dark.gray.anchors['text-primary'], '#f4f5f3'); assert.equal(DEFINITION.roles.accent, '#3fe08a'); assert.equal(DEFINITION.label, 'Rooms OS');
// Nothing the apps would refuse, nothing at all against the night half, and the day half's notes are all near misses.
assert.deepEqual(P.notes.refused, [], 'the apps would refuse this theme'); assert.deepEqual(P.notes.dark, [], 'the night half has contrast notes'); assert.equal(P.notes.dark.length + P.notes.light.length, P.problems.length);
for (const line of P.notes.light) { const m = /is ([\d.]+):1 in light mode; it needs ([\d.]+):1/.exec(line); assert.ok(m, 'a note in a form this check does not know: ' + line); assert.ok(+m[2] - +m[1] <= 0.12 + 1e-9, 'a day-mode pair is well short of its bar: ' + line); }
assert.ok(P.notes.light.length <= 12, `the day half has ${P.notes.light.length} notes`); for (const line of P.notes.light) assert.match(line, /^(border|fill|switch|slider|ring)[a-z-]* on /, 'a day-mode note about words, not about a line or a fill: ' + line);
// The theme is the shape the apps read: version 1, both modes, about a hundred six-digit colours in each.
assert.equal(P.theme.v, 1); assert.deepEqual(Object.keys(P.theme.inputs).sort(), ['dark', 'light']); for (const mode of P.MODES) { const all = Object.values(P.theme.inputs[mode]); assert.ok(all.length >= 90 && all.every(c => /^#[0-9a-f]{6}$/.test(c))); }

for (const mode of P.MODES) { const c = P.colours(mode), a = DEFINITION[mode].gray.anchors;
  // Surfaces: the page is the darkest, each later one as light or lighter, and neighbours stay close.
  const steps = [c.page, c.card, c.panel, c.menu].map(P.light); for (let i = 1; i < steps.length; i++) assert.ok(steps[i] >= steps[i - 1] - 1e-9, `${mode}: a surface is darker than the page`); assert.ok(P.contrast(c.page, c.menu) < 1.25, `${mode}: the surfaces are too far apart to read as one material`); assert.ok(P.contrast(c.page, c.card) >= 1.03 && P.contrast(c.card, c.panel) >= 1.03, `${mode}: a card cannot be told from the page`);
  // Words come first: main ink at 7 to 1 or better on every surface, quiet ink at 4.5 to 1.
  for (const s of [c.page, c.card, c.panel, c.menu]) { assert.ok(P.contrast(c.ink, s) >= 7, `${mode}: main ink on ${s}`); assert.ok(P.contrast(c.ink2, s) >= 7, `${mode}: second ink on ${s}`); assert.ok(P.contrast(c.ink3, s) >= 4.5, `${mode}: quiet ink on ${s} is ${P.contrast(c.ink3, s).toFixed(2)}`); }
  // Each role: the ink on its fill reads, and the shade used for coloured words reads on every surface.
  for (const [id] of P.ROLES) { assert.ok(P.contrast(c[id + 'On'], c[id + 'Fill']) >= 4.5, `${mode}: ink on the ${id} fill is ${P.contrast(c[id + 'On'], c[id + 'Fill']).toFixed(2)}`); for (const s of [c.page, c.card, c.panel]) assert.ok(P.contrast(c[id + 'Text'], s) >= 4.5, `${mode}: ${id} words on ${s}`); assert.ok(Object.values(P.theme.inputs[mode]).includes(c[id + 'Text']), 'a shade the theme does not hold'); }
  assert.equal(c.page, a['surface-0']); assert.equal(c.ink, a['text-primary']); }
// Meaning is kept: danger is a red, success a green, warning an amber. And the five roles can be told apart as words in code:
// measured on the shades the theme actually yields, in a colour space built to match the eye (OKLCH), every pair is at least 30 degrees of hue apart.
{ const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), hue = hex => { const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16) / 255)), l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b); return (Math.atan2(0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q) * 180 / Math.PI + 360) % 360; };
  const seed = Object.fromEntries(P.ROLES.map(([id]) => [id, hue(P.seedOf(DEFINITION.roles[id]))])); assert.ok(seed.danger > 15 && seed.danger < 40, 'danger is not a red'); assert.ok(seed.success > 105 && seed.success < 145, 'success is not a green'); assert.ok(seed.warning > 60 && seed.warning < 95, 'warning is not an amber'); assert.ok(seed.accent > 145 && seed.accent < 165, 'the accent is not the house green');
  for (const mode of P.MODES) { const c = P.colours(mode), hs = P.ROLES.map(([id]) => [id, hue(c[id + 'Text'])]); for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) { const gap = Math.abs(hs[i][1] - hs[j][1]), apart = Math.min(gap, 360 - gap); assert.ok(apart >= 30, `${mode}: ${hs[i][0]} and ${hs[j][0]} words are only ${apart.toFixed(0)} degrees of hue apart`); } } }

// The scene: one small pure-vector drawing that needs no telling which half of the day it is, slow, finished when still.
assert.ok(SCENE.length < 131072 && SCENE.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">') && SCENE.endsWith('</svg>'));
for (const banned of ['<image', '<script', 'href', '@font-face', '<![CDATA[', '<foreignObject', '<text', 'url(http', '@media', 'light-dark', '/*']) assert.ok(!SCENE.includes(banned), 'the scene holds ' + banned);
for (const comment of SCENE.match(/<!--[\s\S]*?-->/g)) assert.ok(/^<!-- [a-z ;,]+ -->$/.test(comment), 'a comment that is not plain words: ' + comment);
assert.equal((SCENE.match(/class="lamp"/g) || []).length, LIT.length); assert.equal(LIT.length, ROOMS.length); assert.deepEqual([...LIT].sort(), ROOMS.map((_, i) => i)); assert.ok(TURN >= 6 && LIT.length * TURN >= 40, 'the lights change too fast');
// The rooms tile the plan exactly: none overlaps another, none sticks out, and together they cover it.
{ let area = 0; for (const [x, y, w, h] of ROOMS) { assert.ok(x >= 0 && y >= 0 && x + w <= PLAN.width && y + h <= PLAN.height); area += w * h; } assert.equal(area, PLAN.width * PLAN.height); for (let i = 0; i < ROOMS.length; i++) for (let j = i + 1; j < ROOMS.length; j++) { const [a, b] = [ROOMS[i], ROOMS[j]]; assert.ok(!(a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]), `rooms ${i} and ${j} overlap`); } }
// Every wall and door stays inside the plan, and every door's swing is a true quarter circle of the door's own width.
{ const d = SCENE.match(/class="wall"[^>]* d="([^"]+)"/)[1], nums = d.match(/-?\d+(\.\d+)?/g).map(Number); assert.ok(nums.every(n => n >= 0 && n <= 300)); const doors = SCENE.match(/class="door"[^>]* d="([^"]+)"/)[1].split(' M').length; assert.equal(doors, 8); assert.equal((SCENE.match(/a25 25 0 0 [01] -?25 -?25/g) || []).length, 8); }
// Where the plan lands on real screens. It is pinned to the top right of the largest square that fits, so: on a wide window it is clear of a column of words 768 wide in the middle;
// on any window it is in the top quarter; and it is never over the foot, where the message box is. A phone held upright sees all six rooms.
for (const [w, h] of [[390, 844], [844, 390], [1280, 800], [1440, 900], [1920, 1080], [2560, 1080], [768, 1024], [320, 568]]) { const k = Math.min(w, h) / 1000, x0 = w - k * (1000 - PLAN.x), x1 = x0 + k * PLAN.width * PLAN.scale, y0 = k * PLAN.y, y1 = y0 + k * PLAN.height * PLAN.scale;
  assert.ok(x0 >= 0 && x1 <= w && y0 >= 0, `${w}x${h}: the plan is cut off`); assert.ok(y1 <= h * 0.26, `${w}x${h}: the plan comes ${Math.round(y1)} px down a ${h} px screen`); assert.ok(x1 > w - 20 * Math.max(1, k * 2), `${w}x${h}: the plan is not in the corner`); assert.ok(x1 - x0 >= 70, `${w}x${h}: the plan is only ${Math.round(x1 - x0)} px wide`);
  if (w >= 1280) assert.ok(x0 >= (w + 768) / 2, `${w}x${h}: the plan starts at ${Math.round(x0)}, inside a middle column that ends at ${(w + 768) / 2}`); }
assert.ok(!/\.lamp \{[^}]*opacity/.test(SCENE), 'a rule that sets every lamp dark would win over the one lamp that rests lit'); assert.ok(!P.scene.still.includes('animation') && P.scene.still.includes(`opacity="${GLOW}"`) && P.scene.still.length < SCENE.length, 'the still scene still moves'); assert.ok(P.scene.moving === SCENE);
// The scene's grey and green show on both grounds without being told which it is on: lines at 1.25 to 1 or better once their opacity is counted, by night and by day.
{ const mix = (top, a, under) => '#' + [1, 3, 5].map(i => Math.round(parseInt(top.slice(i, i + 2), 16) * a + parseInt(under.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join(''); for (const mode of P.MODES) { const page = DEFINITION[mode].gray.anchors['surface-0']; assert.ok(P.contrast(mix('#8f989d', 0.55, page), page) >= 1.25, `${mode}: the walls do not show`); assert.ok(P.contrast(mix('#2fbf7c', GLOW, page), page) >= 1.08, `${mode}: a lit room does not show`); assert.ok(P.contrast(DEFINITION[mode].gray.anchors['text-primary'], mix('#2fbf7c', GLOW, page)) >= 7, `${mode}: words over a lit room`); } }
// The lamps never flash: the brightest any room gets is the glow, and it takes a second or more to get there.
{ const kf = /@keyframes turn \{([^@]+)\}\s*<\/style>/.exec(SCENE)[1], stops = [...kf.matchAll(/([\d.]+)% \{ opacity: ([\d.]+); \}/g)].map(m => [+m[1], +m[2]]); assert.ok(stops.length >= 4 && stops.every(([, o]) => o <= GLOW) && GLOW <= 0.25); const round = LIT.length * TURN; for (let i = 1; i < stops.length; i++) if (stops[i][1] !== stops[i - 1][1]) assert.ok((stops[i][0] - stops[i - 1][0]) / 100 * round >= 1, 'a lamp changes in under a second'); }

// Strict, and independent of the colour maker's own check: that check lowers its bar to the design system's own figure where that falls short of 4.5 to 1,
// so "no notes" from it does not mean every pair of words reads. Here the bar is 4.5 to 1 for every pair, worked out with a second copy of the sum.
// Covered: the seven git state colours as words on every surface and on their own tint (20% of the colour laid over each surface, as the apps lay it),
// and the ink on every role's fill, at rest and on hover. Surfaces are the stops the apps paint them with: surface-0 to surface-3.
{ const ch = v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }, rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), lum = c => 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]), cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }, tint = (c, a, under) => c.map((v, i) => v * a + under[i] * (1 - a));
  // The second copy of the sum agrees with figures worked out by hand and with the outside review's figure for the toolkit's own day-mode git green.
  assert.ok(Math.abs(cr([0, 0, 0], [255, 255, 255]) - 21) < 1e-9); assert.equal(cr(rgbOf('#1e9e3c'), rgbOf('#f6f8fa')).toFixed(2), '3.28');
  const SURFACES = { light: ['gray-20', 'gray-10', 'gray-0', 'gray-0'], dark: ['gray-900', 'gray-850', 'gray-830', 'gray-800'] }, short = [];
  for (const mode of P.MODES) { const t = P.theme.inputs[mode], grounds = SURFACES[mode].map(k => rgbOf(t[k]));
    for (const key of ['added', 'removed', 'modified', 'merged', 'closed', 'conflicting', 'draft']) { const ink = rgbOf(t['text-git-' + key]); for (const g of grounds) { const plain = cr(ink, g), tinted = cr(ink, tint(ink, 0.2, g)); if (plain < 4.5) short.push(`${mode}: git ${key} words on a surface, ${plain.toFixed(2)}`); if (tinted < 4.5) short.push(`${mode}: git ${key} words on its own tint, ${tinted.toFixed(2)}`); } }
    for (const [id] of P.ROLES) for (const f of ['fill', 'fill-hover']) { const r = cr(rgbOf(t[`role-${id}-on`]), rgbOf(t[`role-${id}-${f}`])); if (r < 4.5) short.push(`${mode}: ink on the ${id} ${f}, ${r.toFixed(2)}`); } }
  assert.deepEqual([...new Set(short)], [], 'pairs of words below 4.5 to 1'); }

// The same strictness over every pair the colour maker itself checks: its own table of pairs, read from a copy held in memory with its bar fixed at the
// full figure (4.5 to 1 for words) instead of the design system's own. No pair of words may fall short in either half of the day.
{ const src = fs.readFileSync(new URL('../mod/hooks/make-colors.js', import.meta.url), 'utf8'), relaxed = 'floor = Math.min(TARGET_RATIO[target], oneDecimalDown(stock))';
  assert.equal(src.split(relaxed).length, 2, 'the colour maker no longer lowers its bar the way this check expects; look at it again');
  const strict = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(src.replace(relaxed, 'floor = TARGET_RATIO[target]')));
  const words = strict.makeColors(DEFINITION).problems.filter(p => /it needs 4\.5:1/.test(p)); assert.deepEqual(words, [], 'pairs of words under 4.5 to 1 in the colour maker\'s own table'); }

// The mod's own files are all there, and the colour maker is the one the toolkit ships, untouched.
const mod = new URL('../mod/', import.meta.url); for (const f of ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx', 'hooks/register.test.tsx', 'hooks/house.js', 'hooks/house.d.ts', 'hooks/make-colors.js', 'hooks/make-colors.d.ts']) assert.ok(fs.existsSync(new URL(f, mod)), f + ' is missing');
{ const src = fs.readFileSync(new URL('hooks/make-colors.js', mod), 'utf8'); assert.ok(src.startsWith('// make-colors.js: copy this file into your mod\'s hooks folder, and leave it as it is.')); assert.match(src, /\/\/ body-sha256: 02635c563d34d132931976ff56a5929ad1580699ad6f8045d90e0f8d00ec9bb3/); }
{ const m = JSON.parse(fs.readFileSync(new URL('.claude-plugin/plugin.json', mod), 'utf8')); assert.equal(m.name, 'rooms-os-theme'); assert.deepEqual(JSON.parse(fs.readFileSync(new URL('hooks/hooks.json', mod), 'utf8')), { modules: ['./register.tsx'] }); }
console.log(`ok  theme: nothing the apps would refuse; night half ${P.notes.dark.length} notes, day half ${P.notes.light.length}, all within 0.12 of their bars; main ink ${P.ratio('#f4f5f3', '#111315')} to 1 by night and ${P.ratio(DEFINITION.light.gray.anchors['text-primary'], DEFINITION.light.gray.anchors['surface-0'])} to 1 by day; five roles of five hues, each readable as words and as a fill in both modes; with the bar held at 4.5 to 1, every pair of words in the colour maker's own table reads, and so do the git state colours and the ink on every fill at rest and on hover; scene ${SCENE.length} characters, ${ROOMS.length} rooms, ${LIT.length} lamps, one round every ${LIT.length * TURN} s`);
