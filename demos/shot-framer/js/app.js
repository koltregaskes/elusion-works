// Shot Framer: the page. pano.js does the arithmetic and draws every pixel; this file holds the picture, listens to the controls and keeps the list of shots.
import * as P from './pano.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const blank = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
const view = $('view'), ctx = view.getContext('2d', { willReadFrequently: true }), frame = $('frame'), well = $('well');

let src = null, srcName = 'sample', view0 = { ...P.HOME }, shape = '16:9', shots = [], count = 0, sharp = null, busy = false, job = 0;
const ratio = () => { const a = P.aspectOf(shape); return a.w / a.h; };
const say = text => { $('status').textContent = text; };

/* ---- Drawing the frame ---- */
/* While you are moving it, the frame is drawn coarse, so that it keeps up. A moment after you stop, it is drawn at full sharpness. */
const small = document.createElement('canvas'), sctx = small.getContext('2d');
const stacked = matchMedia('(max-width: 860px)');
function fit() { const r = ratio(); if (stacked.matches) well.style.height = Math.round(Math.min(innerHeight * 0.6, well.clientWidth / r)) + 'px'; else well.style.height = ''; /* on a phone the well is as tall as the frame needs, and no taller */
  const bw = well.clientWidth, bh = well.clientHeight, w = Math.max(40, Math.floor(Math.min(bw, bh * r))), h = Math.max(40, Math.floor(w / r)); frame.style.width = w + 'px'; frame.style.height = h + 'px';
  const dpr = Math.min(devicePixelRatio || 1, 2), k = Math.min(1, Math.sqrt(2.2e6 / (w * h * dpr * dpr))); view.width = Math.max(2, Math.round(w * dpr * k)); view.height = Math.max(2, Math.round(h * dpr * k)); paint(); }
function paint(coarse = true) { if (!src) return; clearTimeout(sharp); const W = view.width, H = view.height;
  if (coarse) { const k = Math.min(1, Math.sqrt(150000 / (W * H))), w = Math.max(2, Math.round(W * k)), h = Math.max(2, Math.round(H * k)); small.width = w; small.height = h; const img = sctx.createImageData(w, h); P.render(src, view0, img); sctx.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(small, 0, 0, W, H); sharp = setTimeout(() => paint(false), 150); }
  else { const img = ctx.createImageData(W, H); P.render(src, view0, img); ctx.putImageData(img, 0, 0); }
  read(); }
function read() { const d = P.describe(view0, shape), mm = Math.round(P.lens(view0.fov, ratio())), kind = mm <= 20 ? 'a very wide lens' : mm <= 35 ? 'a wide lens' : mm <= 60 ? 'a normal lens' : mm <= 105 ? 'a portrait lens' : 'a long lens';
  $('r-head').textContent = `${d.compass}, ${d.heading}`; $('r-tilt').textContent = d.tilt; $('r-lens').textContent = d.lens; $('r-shape').textContent = d.shape; $('lens-words').textContent = `${mm} mm, ${kind}`; $('fov').value = String(Math.round(view0.fov)); $('fov').setAttribute('aria-valuetext', `${mm} millimetres, ${kind}`);
  view.setAttribute('aria-label', `The frame: facing ${d.compass}, ${d.heading.replace('°', ' degrees')}, ${d.tilt.replace('°', ' degrees')}, ${d.lens.replace(' mm', ' millimetre')} lens, shape ${d.shape.replace(':', ' by ')}.`); }
function turn(change) { view0 = P.tidy({ yaw: view0.yaw + (change.yaw || 0), pitch: view0.pitch + (change.pitch || 0), fov: change.fov ?? view0.fov * (change.zoom || 1) }); paint(); }
function setShape(id) { shape = P.aspectOf(id).id; for (const i of document.querySelectorAll('input[name="shape"]')) i.checked = i.value === shape; fit(); }

/* ---- The picture ---- */
/* The sample is worked out a direction at a time. A small one first, so there is something to look at straight away; then a large one, a slice at a time, swapped in when it is done. */
function useSample() { const mine = ++job, quick = blank(1024, 512); P.paintSample(quick); src = quick; srcName = 'sample'; $('pic').textContent = 'The sample: a sculpture park at night, drawn by this page. Sharpening it…'; $('sample').hidden = true; paint();
  const full = blank(4096, 2048); let row = 0; const slice = () => { if (mine !== job) return; const to = Math.min(full.height, row + 48); P.paintSample(full, [row, to]); row = to; if (row < full.height) { $('pic').textContent = `The sample: a sculpture park at night, drawn by this page. Sharpening it: ${Math.round(row / full.height * 100)}%`; setTimeout(slice, 0); } else { src = full; $('pic').textContent = 'The sample: a sculpture park at night, drawn by this page, 4096 by 2048.'; paint(); thumbs(); } }; setTimeout(slice, 60); }
async function useFile(file) { if (!file) return; if (!/^image\//.test(file.type)) { say('That is not a picture this page can open.'); return; } let bmp; try { bmp = await createImageBitmap(file); } catch (err) { say('That picture could not be opened.'); return; }
  job++; const k = Math.min(1, 8192 / bmp.width), w = Math.max(2, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k)), c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, w, h); const img = g.getImageData(0, 0, w, h); src = { data: img.data, width: w, height: h }; srcName = file.name;
  const off = Math.abs(bmp.width / bmp.height - 2) > 0.03; $('pic').textContent = `Your picture, ${bmp.width} by ${bmp.height}${k < 1 ? `, used at ${w} by ${h}` : ''}.${off ? ' A 360 picture is twice as wide as it is tall. This one is not, so it may look stretched.' : ''}`; $('sample').hidden = false; view0 = { ...P.HOME }; paint(); thumbs(); say(off ? 'Picture opened. It is not twice as wide as it is tall, so it may look stretched.' : 'Picture opened.'); }

/* ---- Shots ---- */
function thumb(canvas, shot) { const r = P.aspectOf(shot.shape), w = r.w >= r.h ? 152 : Math.round(152 * r.w / r.h), h = r.w >= r.h ? Math.round(152 * r.h / r.w) : 152; canvas.width = w; canvas.height = h; const g = canvas.getContext('2d'), img = g.createImageData(w, h); if (src) P.render(src, shot.view, img); g.putImageData(img, 0, 0); }
function thumbs() { for (const li of $('shots').children) thumb(li.querySelector('canvas'), shots.find(s => s.n === +li.dataset.n)); }
function list() { $('shots').replaceChildren(...shots.map(s => { const c = el('canvas', { ariaHidden: 'true' }); thumb(c, s); const words = P.line(s.n, s.view, s.shape);
    return el('li', {}, c, el('div', {}, el('p', { textContent: words }), el('div', { className: 'row' }, el('button', { className: 'btn small', type: 'button', textContent: 'Go to', ariaLabel: `Go to shot ${s.n}`, onclick: () => { view0 = { ...s.view }; setShape(s.shape); say(`Showing shot ${s.n}.`); view.focus({ preventScroll: true }); } }), el('button', { className: 'btn small', type: 'button', textContent: 'Export', ariaLabel: `Export shot ${s.n}`, onclick: () => save(s) }), el('button', { className: 'btn small', type: 'button', textContent: 'Remove', ariaLabel: `Remove shot ${s.n}`, onclick: () => { shots = shots.filter(x => x !== s); list(); say(`Shot ${s.n} removed.`); ($('shots').querySelector('button') || $('save')).focus(); } })))); }).map((li, i) => { li.dataset.n = shots[i].n; return li; }));
  const any = shots.length > 0; $('none').hidden = any; $('all').disabled = $('copy').disabled = !any; $('text').hidden = !any; $('text').value = shots.map(s => P.line(s.n, s.view, s.shape)).join('\n'); }
function keep() { const s = { n: ++count, view: { ...view0 }, shape }; shots.push(s); list(); say(`Saved. ${P.line(s.n, s.view, s.shape)}.`); return s; }

/* ---- Exporting: the frame drawn again at full size from the whole picture, a slice at a time, and handed over as a PNG. ---- */
async function make(shot, long = +document.querySelector('input[name="size"]:checked').value) { const size = P.sizeFor(shot.shape, long), out = blank(size.w, size.h), step = Math.max(8, Math.floor(260000 / size.w));
  for (let r = 0; r < size.h; r += step) { P.render(src, shot.view, out, [r, Math.min(size.h, r + step)]); say(`Drawing ${size.w} by ${size.h}: ${Math.round(Math.min(size.h, r + step) / size.h * 100)}%`); await new Promise(res => setTimeout(res, 0)); }
  const c = document.createElement('canvas'); c.width = size.w; c.height = size.h; c.getContext('2d').putImageData(new ImageData(out.data, size.w, size.h), 0, 0); const blob = await new Promise(res => c.toBlob(res, 'image/png')); return { blob, size, name: P.fileName(shot.n, shot.shape, size) }; }
async function save(shot) { if (busy || !src) return null; busy = true; for (const b of [$('export'), $('all')]) b.disabled = true; let made = null;
  try { made = await make(shot); const url = URL.createObjectURL(made.blob), a = el('a', { href: url, download: made.name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); say(`Exported ${made.name}, ${made.size.w} by ${made.size.h}${srcName === 'sample' && src.width < 4096 ? ', from the sample before it had finished sharpening' : ''}.`); }
  catch (err) { say('That frame could not be exported. A smaller size may work.'); }
  busy = false; $('export').disabled = false; $('all').disabled = shots.length === 0; return made; }

/* ---- Controls ---- */
$('shapes').append(...P.ASPECTS.map(a => el('label', { className: 'seg' }, el('input', { type: 'radio', name: 'shape', value: a.id, checked: a.id === shape, onchange: () => { setShape(a.id); say(`Shape ${a.id.replace(':', ' by ')}.`); } }), el('span', {}, a.id, el('small', { textContent: a.name })))));
const fingers = new Map(); let spread = 0;
view.addEventListener('pointerdown', e => { e.preventDefault(); view.focus({ preventScroll: true }); try { view.setPointerCapture(e.pointerId); } catch (err) { /* works without */ } fingers.set(e.pointerId, [e.clientX, e.clientY]); view.classList.add('drag'); if (fingers.size === 2) { const [a, b] = [...fingers.values()]; spread = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
view.addEventListener('pointermove', e => { const was = fingers.get(e.pointerId); if (!was) return; fingers.set(e.pointerId, [e.clientX, e.clientY]); const box = view.getBoundingClientRect();
  if (fingers.size === 2) { const [a, b] = [...fingers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (spread > 0 && d > 0) turn({ zoom: spread / d }); spread = d; }
  else turn({ yaw: -(e.clientX - was[0]) / box.width * P.fovAcross(view0.fov, ratio()), pitch: (e.clientY - was[1]) / box.height * view0.fov }); }); /* the picture follows the finger: what you took hold of stays under it */
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) view.addEventListener(type, e => { fingers.delete(e.pointerId); spread = 0; if (!fingers.size) view.classList.remove('drag'); });
view.addEventListener('wheel', e => { e.preventDefault(); turn({ zoom: Math.exp(Math.max(-80, Math.min(80, e.deltaY)) * 0.0016) }); }, { passive: false });
view.addEventListener('keydown', e => { if (e.ctrlKey || e.metaKey || e.altKey) return; const by = e.shiftKey ? 1 : 5, key = e.key.length === 1 ? e.key.toLowerCase() : e.key, move = { ArrowLeft: { yaw: -by }, ArrowRight: { yaw: by }, ArrowUp: { pitch: by }, ArrowDown: { pitch: -by }, '+': { zoom: 0.9 }, '=': { zoom: 0.9 }, '-': { zoom: 1.1 } }[key];
  if (move) { turn(move); e.preventDefault(); } else if (key === 'Home') { view0 = { ...P.HOME }; paint(); e.preventDefault(); } else if (key === 's') keep(); else if (key === 'g') $('grid').click(); else if (/^[1-6]$/.test(key)) { setShape(P.ASPECTS[+key - 1].id); say(`Shape ${shape.replace(':', ' by ')}.`); } });
$('fov').addEventListener('input', e => turn({ fov: +e.target.value }));
$('grid').addEventListener('click', () => { const on = $('thirds').hidden; $('thirds').hidden = !on; $('grid').setAttribute('aria-pressed', String(on)); });
$('home').addEventListener('click', () => { view0 = { ...P.HOME }; paint(); say('Back to the start.'); });
$('save').addEventListener('click', keep); $('export').addEventListener('click', () => save({ n: count + 1, view: { ...view0 }, shape }));
$('all').addEventListener('click', async () => { for (const s of [...shots]) { await save(s); await new Promise(res => setTimeout(res, 350)); } if (shots.length) say(`Exported ${shots.length} ${shots.length === 1 ? 'shot' : 'shots'}.`); });
$('copy').addEventListener('click', async () => { const text = $('text').value; try { await navigator.clipboard.writeText(text); say('The list is copied.'); } catch (err) { $('text').focus(); $('text').select(); say('Copying was not allowed. The list is selected: copy it with your keyboard.'); } });
$('file').addEventListener('change', e => useFile(e.target.files[0])); $('sample').addEventListener('click', () => { $('file').value = ''; view0 = { ...P.HOME }; useSample(); say('Back to the sample picture.'); });
const drop = $('drop'); for (const type of ['dragenter', 'dragover']) addEventListener(type, e => { e.preventDefault(); drop.classList.add('over'); }); for (const type of ['dragleave', 'drop']) addEventListener(type, e => { e.preventDefault(); drop.classList.remove('over'); }); addEventListener('drop', e => useFile(e.dataTransfer?.files?.[0]));
new ResizeObserver(fit).observe(well);

/* ---- Go ---- */
list(); useSample(); fit();
window.shotFramer = { /* for the checks in tools/ */
  state: () => ({ view: { ...view0 }, shape, shots: shots.map(s => ({ n: s.n, view: { ...s.view }, shape: s.shape })), src: src ? { width: src.width, height: src.height, name: srcName } : null, canvas: { w: view.width, h: view.height }, busy }),
  set(v, id) { view0 = P.tidy({ ...view0, ...v }); if (id) setShape(id); else paint(); paint(false); }, make: (shot, long) => make(shot, long).then(m => m.blob.arrayBuffer().then(b => ({ name: m.name, size: m.size, bytes: b.byteLength, head: [...new Uint8Array(b.slice(0, 26))] }))),
  pixels(w, h) { const img = blank(w, h); P.render(src, view0, img); return [...img.data]; }, shown() { clearTimeout(sharp); paint(false); return [...ctx.getImageData(0, 0, view.width, view.height).data.slice(0, 4000)]; },
};
