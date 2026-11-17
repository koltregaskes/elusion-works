// Checks the theme's colours and scene without a browser or the Claude apps. Usage: node palette.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from '../js/palette.js';
import { DEFINITION, SCENE, ROOMS, LIT, TURN, GLOW } from '../mod/hooks/house.js';

// The contrast sum itself, against values anyone can look up.
assert.ok(Math.abs(P.contrast('#000000', '#ffffff') - 21) < 1e-9); assert.ok(Math.abs(P.contrast('#777777', '#ffffff') - 4.478) < 0.005); assert.equal(P.contrast('#3fe08a', '#3fe08a'), 1); assert.equal(P.ratio('#777777', '#ffffff'), '4.4', 'a printed ratio is cut short, never rounded up');
// Worked a second way, by hand, for the house pair.
{ const ch = v => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4), L = (r, g, b) => 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b); const byHand = (L(0xf4, 0xf5, 0xf3) + 0.05) / (L(0x11, 0x13, 0x15) + 0.05); assert.ok(Math.abs(P.contrast('#f4f5f3', '#111315') - byHand) < 1e-9 && byHand > 16); }

// The house style is what the theme is built from.
assert.equal(DEFINITION.dark.gray.anchors['surface-0'], '#111315'); assert.equal(DEFINITION.dark.gray.anchors['text-primary'], '#f4f5f3'); assert.equal(DEFINITION.roles.accent, '#3fe08a'); assert.equal(DEFINITION.label, 'Rooms OS');
// Nothing the apps would refuse, nothing at all against the night half, and the day half's notes are all near misses.
assert.deepEqual(P.notes.refused, [], 'the apps would refuse this theme'); assert.deepEqual(P.notes.dark, [], 'the night half has contrast notes'); assert.equal(P.notes.dark.length + P.notes.light.length, P.problems.length);
for (const line of P.notes.light) { const m = /is ([\d.]+):1 in light mode; it needs ([\d.]+):1/.exec(line); assert.ok(m, 'a note in a form this check does not know: ' + line); assert.ok(+m[2] - +m[1] <= 0.12 + 1e-9, 'a day-mode pair is well short of its bar: ' + line); }
assert.ok(P.notes.light.length <= 12, `the day half has ${P.notes.light.length} notes`);
// The theme is the shape the apps read: version 1, both modes, about a hundred six-digit colours in each.
assert.equal(P.theme.v, 1); assert.deepEqual(Object.keys(P.theme.inputs).sort(), ['dark', 'light']); for (const mode of P.MODES) { const all = Object.values(P.theme.inputs[mode]); assert.ok(all.length >= 90 && all.every(c => /^#[0-9a-f]{6}$/.test(c))); }

for (const mode of P.MODES) { const c = P.colours(mode), a = DEFINITION[mode].gray.anchors;
  // Surfaces: the page is the darkest, each later one as light or lighter, and neighbours stay close.
  const steps = [c.page, c.card, c.panel, c.menu].map(P.light); for (let i = 1; i < steps.length; i++) assert.ok(steps[i] >= steps[i - 1] - 1e-9, `${mode}: a surface is darker than the page`); assert.ok(P.contrast(c.page, c.menu) < 1.25, `${mode}: the surfaces are too far apart to read as one material`);
  // Words come first: main ink at 7 to 1 or better on every surface, quiet ink at 4.5 to 1.
  for (const s of [c.page, c.card, c.panel, c.menu]) { assert.ok(P.contrast(c.ink, s) >= 7, `${mode}: main ink on ${s}`); assert.ok(P.contrast(c.ink2, s) >= 7, `${mode}: second ink on ${s}`); assert.ok(P.contrast(c.ink3, s) >= 4.5, `${mode}: quiet ink on ${s} is ${P.contrast(c.ink3, s).toFixed(2)}`); }
  // Each role: the ink on its fill reads, and the shade used for coloured words reads on every surface.
  for (const [id] of P.ROLES) { assert.ok(P.contrast(c[id + 'On'], c[id + 'Fill']) >= 4.5, `${mode}: ink on the ${id} fill is ${P.contrast(c[id + 'On'], c[id + 'Fill']).toFixed(2)}`); for (const s of [c.page, c.card, c.panel]) assert.ok(P.contrast(c[id + 'Text'], s) >= 4.5, `${mode}: ${id} words on ${s}`); assert.ok(Object.values(P.theme.inputs[mode]).includes(c[id + 'Text']), 'a shade the theme does not hold'); }
  assert.equal(c.page, a['surface-0']); assert.equal(c.ink, a['text-primary']); }
// Meaning is kept: danger is a red, success a green, warning an amber, and the five roles are five different hues.
{ const hue = hex => { const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; return (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60; }, h = Object.fromEntries(P.ROLES.map(([id]) => [id, hue(DEFINITION.roles[id])]));
  assert.ok(h.danger < 20 || h.danger > 340); assert.ok(h.success > 80 && h.success < 150); assert.ok(h.warning > 30 && h.warning < 55); assert.ok(h.accent > 130 && h.accent < 165); const hs = Object.values(h).sort((x, y) => x - y); for (let i = 1; i < hs.length; i++) assert.ok(hs[i] - hs[i - 1] >= 30, 'two roles share a hue'); }

// The scene: one small pure-vector drawing, slow, with nothing in the middle or along the foot, and finished when still.
assert.ok(SCENE.length < 131072 && SCENE.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">') && SCENE.endsWith('</svg>'));
for (const banned of ['<image', '<script', 'href', '@font-face', '<![CDATA[', '<foreignObject', '<text', 'url(http']) assert.ok(!SCENE.includes(banned), 'the scene holds ' + banned);
for (const comment of SCENE.match(/<!--[\s\S]*?-->/g)) assert.ok(/^<!-- [a-z ;,]+ -->$/.test(comment), 'a comment that is not plain words: ' + comment);
assert.equal((SCENE.match(/class="lamp"/g) || []).length, LIT.length); assert.equal((SCENE.match(/class="wall"/g) || []).length, ROOMS.length); assert.ok(TURN >= 6 && LIT.length * TURN >= 40, 'the lights change too fast');
for (const [x, y, w, h] of ROOMS) { assert.ok(x >= 0 && y >= 0 && x + w <= 1600 && y + h <= 1000); assert.ok(!(x < 1180 && x + w > 420 && y < 640 && y + h > 360), 'a room is drawn across the middle'); assert.ok(!(x < 1180 && x + w > 420 && y + h > 700), 'a room is drawn across the foot'); }
for (let i = 0; i < ROOMS.length; i++) for (let j = i + 1; j < ROOMS.length; j++) { const [a, b] = [ROOMS[i], ROOMS[j]]; assert.ok(!(a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]), `rooms ${i} and ${j} overlap`); }
assert.equal(new Set(LIT).size, LIT.length); assert.ok(LIT.every(i => ROOMS[i]));
assert.ok(!/\.lamp \{[^}]*opacity/.test(SCENE), 'a rule that sets every lamp dark would win over the one lamp that rests lit'); assert.ok(!P.scene.still.includes('animation') && P.scene.still.includes(`opacity="${GLOW}"`) && P.scene.still.length < SCENE.length, 'the still scene still moves'); assert.ok(P.scene.moving === SCENE);
// The lamps never flash: the brightest any room gets is a tenth, and it takes a second or more to get there.
{ const kf = /@keyframes turn \{([^@]+)\}\s*<\/style>/.exec(SCENE)[1], stops = [...kf.matchAll(/([\d.]+)% \{ opacity: ([\d.]+); \}/g)].map(m => [+m[1], +m[2]]); assert.ok(stops.length >= 4 && stops.every(([, o]) => o <= GLOW) && GLOW <= 0.15); const round = LIT.length * TURN; for (let i = 1; i < stops.length; i++) if (stops[i][1] !== stops[i - 1][1]) assert.ok((stops[i][0] - stops[i - 1][0]) / 100 * round >= 1, 'a lamp changes in under a second'); }

// The mod's own files are all there, and the colour maker is the one the toolkit ships, untouched.
const mod = new URL('../mod/', import.meta.url); for (const f of ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx', 'hooks/register.test.tsx', 'hooks/house.js', 'hooks/house.d.ts', 'hooks/make-colors.js', 'hooks/make-colors.d.ts']) assert.ok(fs.existsSync(new URL(f, mod)), f + ' is missing');
{ const src = fs.readFileSync(new URL('hooks/make-colors.js', mod), 'utf8'); assert.ok(src.startsWith('// make-colors.js: copy this file into your mod\'s hooks folder, and leave it as it is.')); assert.match(src, /\/\/ body-sha256: 02635c563d34d132931976ff56a5929ad1580699ad6f8045d90e0f8d00ec9bb3/); }
{ const m = JSON.parse(fs.readFileSync(new URL('.claude-plugin/plugin.json', mod), 'utf8')); assert.equal(m.name, 'rooms-os-theme'); assert.deepEqual(JSON.parse(fs.readFileSync(new URL('hooks/hooks.json', mod), 'utf8')), { modules: ['./register.tsx'] }); }
console.log(`ok  theme: nothing the apps would refuse; night half ${P.notes.dark.length} notes, day half ${P.notes.light.length}, all within 0.12 of their bars; main ink ${P.ratio('#f4f5f3', '#111315')} to 1 by night and ${P.ratio(DEFINITION.light.gray.anchors['text-primary'], DEFINITION.light.gray.anchors['surface-0'])} to 1 by day; five roles of five hues, each readable as words and as a fill in both modes; scene ${SCENE.length} characters, ${ROOMS.length} rooms, ${LIT.length} lamps, one round every ${LIT.length * TURN} s`);
