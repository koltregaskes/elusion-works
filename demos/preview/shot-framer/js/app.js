// Shot Framer: the page. pano.js does the arithmetic and draws every pixel; this file holds the picture, listens to the controls and keeps the list of shots.
import * as P from './pano.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const blank = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
const view = $('view'), ctx = view.getContext('2d', { willReadFrequently: true }), frame = $('frame'), well = $('well');

let src = null, srcName = 'sample', view0 = { ...P.HOME }, shape = '16:9', shots = [], count = 0, frames = 0, sharp = null, busy = false, job = 0, asked = 0; /* asked counts the pictures asked for: a picture that finishes opening after a later one was asked for is thrown away */
const own = () => srcName !== 'sample'; /* your own picture has no north: its middle is called ahead */
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
function read() { const d = P.describe(view0, shape, own()), mm = Math.round(P.lens(view0.fov, ratio())), kind = mm <= 20 ? 'a very wide lens' : mm <= 35 ? 'a wide lens' : mm <= 60 ? 'a normal lens' : mm <= 105 ? 'a portrait lens' : 'a long lens';
  $('r-head').textContent = `${d.compass}, ${d.heading}`; $('r-tilt').textContent = d.tilt; $('r-lens').textContent = d.lens; $('r-shape').textContent = d.shape; $('lens-words').textContent = `${mm} mm, ${kind}`; $('fov').value = String(Math.round(view0.fov)); $('fov').setAttribute('aria-valuetext', `${mm} millimetres, ${kind}`);
  view.setAttribute('aria-label', `The frame: facing ${d.compass}, ${d.heading.replace('°', ' degrees')}, ${d.tilt.replace('°', ' degrees')}, ${d.lens.replace(' mm', ' millimetre')} lens, shape ${d.shape.replace(':', ' by ')}.`); }
function turn(change) { view0 = P.tidy({ yaw: view0.yaw + (change.yaw || 0), pitch: view0.pitch + (change.pitch || 0), fov: change.fov ?? view0.fov * (change.zoom || 1) }); paint(); }
/* Changing the shape keeps the lens, as turning a camera on its side does: the view is worked out again for the new shape from the same millimetres. Going to a saved shot takes that shot's view as it was saved.
   At the very ends of the lens range a shape cannot always have the lens the last one had (no 9:16 frame is as wide as the widest 16:9). Then it takes the nearest lens it has, and the page says so. */
function setShape(id, to = null) { const next = P.aspectOf(id).id, r = to ? null : P.reshape(view0, shape, next); shape = next; view0 = to ? P.tidy({ ...to }) : r.view; for (const i of document.querySelectorAll('input[name="shape"]')) i.checked = i.value === shape; fit(); return r; }
const shaped = r => { clearTimeout(telling); return shapeWords(r); }; /* a pending "Facing ..." from the keys would otherwise speak over this */
const shapeWords = r => `Shape ${shape.replace(':', ' by ')}.` + (r && !r.kept ? ` A ${shape.replace(':', ' by ')} frame cannot go as ${r.got > r.mm ? 'wide' : 'long'} as ${Math.round(r.mm)} mm, so the lens is now ${Math.round(r.got)} mm, the ${r.got > r.mm ? 'widest' : 'longest'} it has.` : '');

/* ---- The picture ---- */
/* The sample is worked out a direction at a time. A small one first, so there is something to look at straight away; then a large one, a slice at a time, swapped in when it is done. */
function useSample() { asked++; const mine = ++job, quick = blank(1024, 512); quick.sample = 'soft'; P.paintSample(quick); src = quick; srcName = 'sample'; $('pic').textContent = 'The sample: a sculpture park at night, drawn by this page. Sharpening it…'; $('sample').hidden = true; paint();
  const full = blank(4096, 2048); let row = 0; const slice = () => { if (mine !== job) return; const to = Math.min(full.height, row + 48); P.paintSample(full, [row, to]); row = to; if (row < full.height) { $('pic').textContent = `The sample: a sculpture park at night, drawn by this page. Sharpening it: ${Math.round(row / full.height * 100)}%`; setTimeout(slice, 0); } else { src = full; $('pic').textContent = 'The sample: a sculpture park at night, drawn by this page, 4096 by 2048.'; paint(); thumbs(); } }; setTimeout(slice, 60); list(); }
const kept = () => (shots.length ? ` Your ${shots.length === 1 ? 'saved shot is' : `${shots.length} saved shots are`} kept: a shot is a direction and a lens, so ${shots.length === 1 ? 'it' : 'each'} now frames this picture.` : '');
async function useFile(file) { if (!file) return; const mine = ++asked; if (!/^image\//.test(file.type)) { say('That is not a picture this page can open.'); return; } let bmp; try { bmp = await createImageBitmap(file); } catch (err) { if (mine === asked) say('That picture could not be opened.'); return; }
  if (mine !== asked) { bmp.close(); return; } /* another picture, or the sample, was asked for while this one was opening: the later choice stands */
  const bw = bmp.width, bh = bmp.height; if (bw < 64 || bh < 32) { bmp.close(); say(`That picture is ${bw} by ${bh}, which is too small to frame.`); return; }
  const k = Math.min(1, 8192 / bw, 4096 / bh), w = Math.max(2, Math.round(bw * k)), h = Math.max(1, Math.round(bh * k)); let img; try { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, w, h); img = g.getImageData(0, 0, w, h); } catch (err) { say('That picture is too large for this device to open.'); return; } finally { bmp.close(); }
  job++; src = { data: img.data, width: w, height: h }; srcName = file.name;
  const off = Math.abs(bw / bh - 2) > 0.03; $('pic').textContent = `Your picture, ${bw} by ${bh}${k < 1 ? `, used at ${w} by ${h}` : ''}.${off ? ' A 360 picture is twice as wide as it is tall. This one is not, so it may look stretched.' : ''} Its middle is taken as straight ahead.`; $('sample').hidden = false; view0 = { ...P.HOME }; paint(); list(); say((off ? 'Picture opened. It is not twice as wide as it is tall, so it may look stretched.' : 'Picture opened.') + kept()); }

/* ---- Shots ---- */
function thumb(canvas, shot) { const r = P.aspectOf(shot.shape), w = r.w >= r.h ? 152 : Math.round(152 * r.w / r.h), h = r.w >= r.h ? Math.round(152 * r.h / r.w) : 152; canvas.width = w; canvas.height = h; const g = canvas.getContext('2d'), img = g.createImageData(w, h); if (src) P.render(src, shot.view, img); g.putImageData(img, 0, 0); }
function thumbs() { for (const li of $('shots').children) thumb(li.querySelector('canvas'), shots.find(s => s.n === +li.dataset.n)); }
function goTo(s) { setShape(s.shape, s.view); say(`Showing shot ${s.n}.`); view.focus({ preventScroll: !stacked.matches }); if (stacked.matches) frame.scrollIntoView({ block: 'nearest' }); } /* on a phone the frame is brought back into sight: a shot shown where you cannot see it is no use */
function list() { $('shots').replaceChildren(...shots.map(s => { const c = el('canvas', { ariaHidden: 'true' }); thumb(c, s); const words = P.line(s.n, s.view, s.shape, own());
    const li = el('li', {}, c, el('div', {}, el('p', { textContent: words }), el('div', { className: 'row' }, el('button', { className: 'btn small', type: 'button', textContent: 'Go to', ariaLabel: `Go to shot ${s.n}`, onclick: () => goTo(s) }), el('button', { className: 'btn small out', type: 'button', textContent: 'Export', ariaLabel: `Export shot ${s.n}`, disabled: busy, onclick: () => save(s) }),
      el('button', { className: 'btn small', type: 'button', textContent: 'Remove', ariaLabel: `Remove shot ${s.n}`, onclick: () => { const at = shots.indexOf(s); shots = shots.filter(x => x !== s); list(); say(`Shot ${s.n} removed.`); const next = $('shots').children[Math.min(at, shots.length - 1)]; (next ? next.querySelector('button') : $('save')).focus(); } })))); li.dataset.n = s.n; return li; }));
  const any = shots.length > 0; $('none').hidden = any; $('all').disabled = busy || !any; $('copy').disabled = !any; $('text').hidden = !any; $('text').value = shots.map(s => P.line(s.n, s.view, s.shape, own())).join('\n'); }
function keep() { const s = { n: ++count, view: { ...view0 }, shape }; shots.push(s); list(); say(`Saved. ${P.line(s.n, s.view, s.shape, own())}.`); return s; }

/* ---- Exporting: the frame drawn again at full size from the whole picture, a slice at a time, and handed over as a PNG. ---- */
/* The picture is taken hold of once, at the start: whatever is loaded or finishes sharpening while a file is being drawn, that file is made from one picture, top to bottom. */
async function make(shot, long = +document.querySelector('input[name="size"]:checked').value, word = 'shot') { const pic = src, size = P.sizeFor(shot.shape, long), out = blank(size.w, size.h), step = Math.max(8, Math.floor(260000 / size.w));
  for (let r = 0; r < size.h; r += step) { P.render(pic, shot.view, out, [r, Math.min(size.h, r + step)]); $('progress').textContent = `Drawing ${size.w} by ${size.h}: ${Math.round(Math.min(size.h, r + step) / size.h * 100)}%`; await new Promise(res => setTimeout(res, 0)); }
  const c = document.createElement('canvas'); c.width = size.w; c.height = size.h; c.getContext('2d').putImageData(new ImageData(out.data, size.w, size.h), 0, 0); const blob = await new Promise(res => c.toBlob(res, 'image/png')); $('progress').textContent = ''; return { blob, size, name: P.fileName(shot.n, shot.shape, size, word), data: out.data, soft: pic.sample === 'soft' }; }
/* One export at a time. While one is being drawn, every export button is off, so that a second press cannot be lost without a word. */
function lock(on) { busy = on; $('export').disabled = on; $('all').disabled = on || shots.length === 0; for (const b of document.querySelectorAll('#shots .out')) b.disabled = on; }
async function put(shot, word = 'shot') { try { say(`Drawing ${word} ${shot.n}.`); const made = await make(shot, undefined, word), url = URL.createObjectURL(made.blob), a = el('a', { href: url, download: made.name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); say(`Exported ${made.name}, ${made.size.w} by ${made.size.h}${made.soft ? ', from the sample before it had finished sharpening' : ''}.`); return made; }
  catch (err) { $('progress').textContent = ''; say('That frame could not be exported. A smaller size may work.'); return null; } }
async function save(shot, word = 'shot') { if (!src) return null; if (busy) { say('Still exporting. Wait for it to finish.'); return null; } lock(true); const made = await put(shot, word); lock(false); return made; }

/* ---- Controls ---- */
$('shapes').append(...P.ASPECTS.map(a => el('label', { className: 'seg' }, el('input', { type: 'radio', name: 'shape', value: a.id, checked: a.id === shape, onchange: () => say(shaped(setShape(a.id))) }), el('span', {}, a.id, el('small', { textContent: a.name })))));
const fingers = new Map(); let spread = 0, grab = null;
const place = e => { const box = view.getBoundingClientRect(); return [(e.clientX - box.left) / box.width * 2 - 1, 1 - (e.clientY - box.top) / box.height * 2]; }; /* where in the frame a pointer is: -1 to 1 across, -1 to 1 up */
view.addEventListener('pointerdown', e => { e.preventDefault(); view.focus({ preventScroll: true }); try { view.setPointerCapture(e.pointerId); } catch (err) { /* works without */ } fingers.set(e.pointerId, [e.clientX, e.clientY]); view.classList.add('drag'); grab = fingers.size === 1 ? P.look(view0, ...place(e), ratio()) : null; if (fingers.size === 2) { const [a, b] = [...fingers.values()]; spread = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
view.addEventListener('pointermove', e => { if (!fingers.has(e.pointerId)) return; fingers.set(e.pointerId, [e.clientX, e.clientY]);
  if (fingers.size === 2) { const [a, b] = [...fingers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (spread > 0 && d > 0) turn({ zoom: spread / d }); spread = d; grab = null; }
  else { const [x, y] = place(e); if (!grab) grab = P.look(view0, x, y, ratio()); else { view0 = P.dragTo(view0, grab, x, y, ratio()); paint(); } } }); /* the picture follows the finger: the very place you took hold of stays under it, at any lens and any tilt */
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) view.addEventListener(type, e => { fingers.delete(e.pointerId); spread = 0; grab = null; if (!fingers.size) view.classList.remove('drag'); });
/* The wheel changes the lens. Where the page is one column and has to be scrolled past the picture, it does so only once the picture has been selected, so that scrolling down the page does not zoom by accident. */
view.addEventListener('wheel', e => { if (stacked.matches && document.activeElement !== view) return; e.preventDefault(); turn({ zoom: Math.exp(Math.max(-80, Math.min(80, e.deltaY)) * 0.0016) }); }, { passive: false });
const home = () => { view0 = shape === '16:9' ? { ...P.HOME } : P.tidy({ ...P.HOME, fov: P.fovFor(P.lens(P.HOME.fov, 16 / 9), ratio()) }); paint(); }; /* the start: straight ahead, a little up, through a 24 mm lens whatever the shape */
let telling = null; const tell = () => { clearTimeout(telling); telling = setTimeout(() => { const d = P.describe(view0, shape, own()); say(`Facing ${d.compass}, ${d.heading}, ${d.tilt}, ${d.lens} lens.`); }, 450); }; /* after the keys have moved the frame, say where it now looks, once they have stopped */
view.addEventListener('keydown', e => { if (e.ctrlKey || e.metaKey || e.altKey) return; const by = e.shiftKey ? 1 : 5, key = e.key.length === 1 ? e.key.toLowerCase() : e.key, move = { ArrowLeft: { yaw: -by }, ArrowRight: { yaw: by }, ArrowUp: { pitch: by }, ArrowDown: { pitch: -by }, '+': { zoom: 0.9 }, '=': { zoom: 0.9 }, '-': { zoom: 1.1 } }[key];
  if (move) { turn(move); tell(); e.preventDefault(); } else if (key === 'Home') { home(); tell(); e.preventDefault(); } else if (key === 's') keep(); else if (key === 'g') $('grid').click(); else if (/^[1-6]$/.test(key)) say(shaped(setShape(P.ASPECTS[+key - 1].id))); });
$('fov').addEventListener('input', e => turn({ fov: +e.target.value }));
/* Buttons that turn and tilt the frame by 10 degrees a press: a way to look round with one tap or click, for anyone who cannot drag. */
for (const b of document.querySelectorAll('#turns button')) b.addEventListener('click', () => { turn({ yaw: +(b.dataset.yaw || 0), pitch: +(b.dataset.pitch || 0) }); tell(); });
$('grid').addEventListener('click', () => { const on = $('thirds').hidden; $('thirds').hidden = !on; $('grid').setAttribute('aria-pressed', String(on)); });
$('home').addEventListener('click', () => { home(); say('Back to the start.'); });
$('save').addEventListener('click', keep); $('export').addEventListener('click', () => { if (!busy) frames++; save({ n: frames, view: { ...view0 }, shape }, 'frame'); }); /* the frame as it stands, without saving a shot: its files are numbered on their own, frame-01, frame-02 */
$('all').addEventListener('click', async () => { if (busy) { say('Still exporting. Wait for it to finish.'); return; } const todo = [...shots]; let done = 0; lock(true); for (const s of todo) { if (await put(s)) done++; await new Promise(res => setTimeout(res, 350)); } lock(false); say(done === todo.length ? `Exported ${done} ${done === 1 ? 'shot' : 'shots'}.` : `Exported ${done} of ${todo.length} shots. The others could not be drawn.`); });
$('copy').addEventListener('click', async () => { const text = $('text').value; try { await navigator.clipboard.writeText(text); say('The list is copied.'); } catch (err) { $('text').focus(); $('text').select(); say('Copying was not allowed. The list is selected: copy it with your keyboard.'); } });
$('file').addEventListener('change', e => useFile(e.target.files[0])); $('sample').addEventListener('click', () => { $('file').value = ''; view0 = { ...P.HOME }; useSample(); say('Back to the sample picture.' + kept()); });
const drop = $('drop'); for (const type of ['dragenter', 'dragover']) addEventListener(type, e => { e.preventDefault(); drop.classList.add('over'); }); for (const type of ['dragleave', 'drop']) addEventListener(type, e => { e.preventDefault(); drop.classList.remove('over'); }); addEventListener('drop', e => useFile(e.dataTransfer?.files?.[0]));
new ResizeObserver(fit).observe(well);

/* ---- Go ---- */
list(); useSample(); fit();
window.shotFramer = { /* for the checks in tools/ */
  state: () => ({ view: { ...view0 }, shape, shots: shots.map(s => ({ n: s.n, view: { ...s.view }, shape: s.shape })), src: src ? { width: src.width, height: src.height, name: srcName } : null, canvas: { w: view.width, h: view.height }, busy, frames, mm: P.lens(view0.fov, ratio()) }),
  set(v, id) { if (id) setShape(id, { ...view0, ...v }); else { view0 = P.tidy({ ...view0, ...v }); paint(); } paint(false); }, make: (shot, long) => make(shot, long).then(m => m.blob.arrayBuffer().then(b => { let sum = 0; for (let i = 0; i < m.data.length; i += 7) sum = (sum * 31 + m.data[i]) >>> 0; return { name: m.name, size: m.size, bytes: b.byteLength, head: [...new Uint8Array(b.slice(0, 26))], sum, soft: m.soft }; })),
  use(w, h, rgb) { asked++; job++; const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < data.length; i += 4) { data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; } src = { data, width: w, height: h }; srcName = 'test'; paint(); list(); }, /* swap in a plain picture of one colour: for checking that a file being drawn is not disturbed */
  pixels(w, h) { const img = blank(w, h); P.render(src, view0, img); return [...img.data]; }, shown() { clearTimeout(sharp); paint(false); const d = ctx.getImageData(0, 0, view.width, view.height).data; let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000)); return btoa(s); }, /* every pixel on screen, packed as text so that a large frame comes across quickly */
};
