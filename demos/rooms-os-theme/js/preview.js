// The preview page: paints the specimen and the table from palette.js, which reads the mod's own files.
import { MODES, MODE_NAME, ROLES, colours, ratio, contrast, notes, scene, asImage } from './palette.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const less = matchMedia('(prefers-reduced-motion: reduce)');
let mode = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark', held = less.matches;

// The specimen takes its colours as custom properties, one for each job, and tells the scene which half of the day it is.
function paint() { const c = colours(mode), spec = $('spec'); for (const [k, v] of Object.entries(c)) spec.style.setProperty('--t-' + k, v); spec.style.colorScheme = mode; spec.dataset.mode = mode;
  $('scene').src = asImage(held ? scene.still : scene.moving); for (const m of MODES) $('m-' + m).setAttribute('aria-pressed', String(m === mode)); $('still').setAttribute('aria-pressed', String(held)); }

// One swatch with its code, and how it reads against a ground.
const chip = (hex, on) => el('span', { className: 'chip' }, Object.assign(el('i', on ? { className: 'on', textContent: 'Aa' } : {}), { style: `background:${hex};${on ? `color:${on}` : ''}` }), hex);
const reads = (a, b) => `${ratio(a, b)} to 1`;
function table() { const C = Object.fromEntries(MODES.map(m => [m, colours(m)])), rows = [];
  const row = (name, what, cell) => rows.push(el('tr', {}, el('th', { scope: 'row' }, name, ...(what ? [el('small', { textContent: what })] : [])), ...MODES.flatMap(m => { const [a, b] = cell(C[m]); return [el('td', {}, a), el('td', { textContent: b })]; })));
  row('Page', 'the ground everything sits on', c => [chip(c.page), 'the ground itself']);
  for (const [key, name, what] of [['card', 'Card', 'code blocks, side bar'], ['panel', 'Panel', 'your messages, the message box'], ['menu', 'Menu', 'menus and pop-ups']]) row(name, what, c => [chip(c[key]), `${reads(c[key], c.page)} against the page`]);
  for (const [key, name, what] of [['ink', 'Main ink', 'what you read'], ['ink2', 'Second ink', 'supporting words'], ['ink3', 'Quiet ink', 'times, small print']]) row(name, what, c => [chip(c[key]), reads(c[key], c.page)]);
  for (const [id, name, what] of ROLES) { row(`${name}, as words`, what, c => [chip(c[id + 'Text']), reads(c[id + 'Text'], c.page)]); row(`${name}, as a fill`, 'with the ink that goes on it', c => [chip(c[id + 'Fill'], c[id + 'On']), `${reads(c[id + 'On'], c[id + 'Fill'])} for the ink on it`]); }
  $('rows').replaceChildren(...rows); }

// What the apps' own colour maker said about the theme.
function said() { const d = notes.dark.length, l = notes.light.length, plural = n => (n === 1 ? 'note' : 'notes'), worst = Math.max(0, ...notes.light.map(t => { const m = /is ([\d.]+):1 in light mode; it needs ([\d.]+):1/.exec(t); return m ? +m[2] - +m[1] : 0; }));
  $('said').textContent = notes.refused.length ? `The colour maker says the apps would refuse this theme: ${notes.refused[0]}` : `The apps’ colour maker checks every pairing against the design system’s own bar. It finds nothing that would stop the apps painting this theme. Night half: ${d === 0 ? 'no notes' : `${d} ${plural(d)}`}. Day half: ${l === 0 ? 'no notes' : `${l} ${plural(l)}, each a near miss (the widest falls ${worst.toFixed(2)} short) against a bar the design system’s own colours only just clear`}.`;
  if (l) { $('notes').hidden = false; $('notes-list').replaceChildren(...notes.light.map(t => el('li', { textContent: t }))); } }

$('m-dark').addEventListener('click', () => { mode = 'dark'; paint(); }); $('m-light').addEventListener('click', () => { mode = 'light'; paint(); });
$('still').addEventListener('click', () => { held = !held; paint(); });
less.addEventListener('change', () => { if (less.matches) { held = true; paint(); } });
table(); said(); paint();
window.housePreview = { state: () => ({ mode, held, colours: colours(mode), notes: { dark: notes.dark.length, light: notes.light.length, refused: notes.refused.length } }), contrast }; // for the checks in tools/
