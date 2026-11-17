// Stem Studio: the page. All song changes go through model.js; all sound through audio.js.
import { demoProject, edit, applyPlan, interpret, briefFor, validate, rowsFor, STEPS, MAX_BARS } from './model.js';
import { Engine, renderOffline, wavFromBuffer, playNote, SR } from './audio.js';

const $ = id => document.getElementById(id);
const root = document.documentElement, KEY = 'stem-studio:v1';
const clone = x => JSON.parse(JSON.stringify(x));
const el = (tag, props = {}, kids = []) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'title' || k === 'type' || k === 'for') e.setAttribute(k, v); else e[k] = v; } for (const c of [].concat(kids)) if (c) e.append(c); return e; };
const SVGNS = 'http://www.w3.org/2000/svg';

// ---- State ----------------------------------------------------------------------------------
function stored() { try { const raw = localStorage.getItem(KEY); if (raw) return validate(JSON.parse(raw)); } catch (err) { /* storage can be off or stale: start from the demo */ } return null; }
let project = stored() || demoProject(), past = [], future = [], selected = null, cursor = 0, loopOn = false, tab = 'clip';
const engine = new Engine(() => project), peaks = new Map(), grid = { c: 0, r: 0 };
let warnedStore = false; // the page works without storage, but says so once rather than losing work quietly
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(project)); } catch (err) { if (!warnedStore) { warnedStore = true; toast('This browser is not keeping your changes between visits. Use More, then Save project file, to keep them.'); } } };
function commit(next) { // one undo step per real change; an edit that changes nothing is not a step
  if (!next || next === project) return false; const before = JSON.stringify(project); if (JSON.stringify(next) === before) return false;
  swap(next); past.push(before); if (past.length > 100) past.shift(); future.length = 0; $('undo').disabled = false; $('redo').disabled = true; return true;
}
function swap(next) { // draw first, save second: a project that cannot be drawn is never stored
  const prev = project, focused = document.activeElement && document.activeElement !== document.body; if (next.bpm !== project.bpm) engine.retime();
  project = next; if (selected && !project.clips.some(c => c.id === selected)) selected = null;
  try { renderAll(); } catch (err) { project = prev; renderAll(); throw err; }
  persist(); engine.refresh();
  if (focused && (document.activeElement === document.body || !document.activeElement)) $('scroll').focus({ preventScroll: true }); // the thing that had focus is gone: keep the keyboard in the arrangement
}
function undo() { if (!past.length) return; future.push(JSON.stringify(project)); swap(JSON.parse(past.pop())); toast('Undone'); }
function redo() { if (!future.length) return; past.push(JSON.stringify(project)); swap(JSON.parse(future.pop())); toast('Redone'); }
let toastTimer; function toast(msg) { $('toast').textContent = msg; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 3200); }
const barw = () => parseFloat(getComputedStyle(root).getPropertyValue('--barw')) || 44;
const track = id => project.tracks.find(t => t.id === id);
const clipOf = id => project.clips.find(c => c.id === id);
const hasSound = c => !!c.pattern || engine.stems.has(c.track);
const tint = kind => `--c:var(--${['drums', 'bass', 'keys', 'lead'].includes(kind) ? kind : 'audio'})`; // only ever one of five known colours

// ---- Drawing the arrangement ---------------------------------------------------------------------
function miniFor(c) { // a small picture of what is inside a clip
  const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', 'mini'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  const rect = (x, y, w, h) => { const r = document.createElementNS(SVGNS, 'rect'); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h); svg.append(r); };
  if (c.pattern) {
    const pat = project.patterns[c.pattern], rows = rowsFor(pat.kind), total = c.len * STEPS, loop = pat.bars * STEPS; svg.setAttribute('viewBox', `0 0 ${total} ${rows.length}`);
    for (let base = -((c.shift || 0) * STEPS) % loop - loop; base < total; base += loop) for (const n of pat.notes) { const x = base + n.t; if (x < 0 || x >= total) continue; const y = rows.findIndex(r => r.p === n.p); if (y >= 0) rect(x, y + 0.1, Math.max(0.6, Math.min(n.d, total - x) - 0.25), 0.8); }
  } else if (peaks.has(c.track)) {
    const pk = peaks.get(c.track), spb = 60 / project.bpm, secs = c.len * 4 * spb, buf = engine.stems.get(c.track), n = 120; svg.setAttribute('viewBox', `0 0 ${n} 2`);
    for (let i = 0; i < n; i++) { const t = ((c.shift || 0) * 4 * spb + (i / n) * secs) / buf.duration; if (t >= 1) break; const v = pk[Math.floor(t * pk.length)] || 0; rect(i, 1 - v, 0.8, Math.max(0.04, v * 2)); }
  }
  return svg;
}
function renderArrange() {
  root.style.setProperty('--bars', project.bars + 2);
  $('song').textContent = project.name; if (document.activeElement !== $('bpm')) $('bpm').value = project.bpm;
  $('heads').replaceChildren(...project.tracks.map(t => el('div', { class: 'head', style: tint(t.kind) }, [
    el('div', { class: 'name', title: t.name }, [el('i'), document.createTextNode(t.name)]),
    el('div', { class: 'btns' }, [
      el('button', { class: 'ms', type: 'button', text: 'M', 'aria-label': `Mute ${t.name}`, 'aria-pressed': String(t.mute), onclick: () => commit(edit.setTrack(project, t.id, { mute: !t.mute })) }), ' ',
      el('button', { class: 'ms solo', type: 'button', text: 'S', 'aria-label': `Solo ${t.name}`, 'aria-pressed': String(t.solo), onclick: () => commit(edit.setTrack(project, t.id, { solo: !t.solo })) })]),
    el('input', { type: 'range', min: 0, max: 100, value: Math.round(t.vol * 100), id: 'vol-' + t.id, 'aria-label': `${t.name} level`, oninput: e => liveLevel(t.id, e.target.value / 100), onchange: () => endLive() }),
  ])));
  const ruler = $('ruler'), bw = barw(); ruler.replaceChildren();
  for (const s of project.sections) ruler.append(el('button', { class: 'sect', type: 'button', text: s.name, title: `Go to ${s.name}, bar ${s.start + 1}`, style: `left:${s.start * bw}px;width:${s.len * bw - 2}px`, onclick: e => { e.stopPropagation(); setCursor(s.start * 4); } }));
  for (let b = 0; b < project.bars; b++) ruler.append(el('span', { class: 'barno' + (b % 4 === 0 ? ' strong' : ''), text: b % 4 === 0 || bw >= 40 ? String(b + 1) : '', style: `left:${b * bw}px` }));
  const focusId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
  $('lanes').replaceChildren(...project.tracks.map(t => {
    const lane = el('div', { class: 'lane', 'data-track': t.id, style: tint(t.kind) });
    for (const c of project.clips.filter(c => c.track === t.id).sort((a, b) => a.start - b.start)) {
      const name = c.pattern ? project.patterns[c.pattern].name : hasSound(c) ? t.name : 'Stem missing: load it again';
      lane.append(el('button', { class: 'clip' + (c.id === selected ? ' sel' : '') + (hasSound(c) ? '' : ' missing'), type: 'button', 'data-id': c.id, style: `left:${c.start * bw + 1}px;width:${c.len * bw - 2}px`,
        'aria-label': `${name} on ${t.name}, bars ${c.start + 1} to ${c.start + c.len}`, 'aria-pressed': String(c.id === selected) }, [el('span', { class: 'cname', text: name }), miniFor(c), el('span', { class: 'grip', 'aria-hidden': 'true' })]));
    }
    return lane;
  }));
  if (focusId) { const again = $('lanes').querySelector(`[data-id="${CSS.escape(focusId)}"]`); if (again) again.focus({ preventScroll: true }); }
  drawLoop(); $('undo').disabled = !past.length; $('redo').disabled = !future.length;
}

// ---- The clip panel and note grid -----------------------------------------------------------------
function renderClipPanel() {
  const c = selected && clipOf(selected); $('clip-none').hidden = !!c; $('clip-some').hidden = !c;
  const addSel = $('add-pattern'), keep = addSel.value; addSel.replaceChildren(...Object.values(project.patterns).map(p => el('option', { value: p.id, text: `${p.name} (${p.kind})` }))); if (keep && project.patterns[keep]) addSel.value = keep;
  if (!c) return;
  const t = track(c.track), pat = c.pattern && project.patterns[c.pattern];
  $('clip-title').textContent = `${pat ? pat.name : t.name} · ${t.name}, bars ${c.start + 1} to ${c.start + c.len}`;
  $('clip-pattern').hidden = $('note-len').hidden = $('clip-unique').hidden = $('editor').hidden = !pat; $('note-len').hidden = !pat || pat.kind === 'drums';
  $('clip-relink').hidden = !!pat || hasSound(c);
  if (!pat) { $('clip-note').textContent = hasSound(c) ? 'This is a loaded stem. It plays as recorded, at its own speed.' : 'This stem’s audio is not loaded. Press Load its audio and choose the same file: it goes back on this track, with your edits kept.'; return; }
  $('clip-pattern').replaceChildren(...Object.values(project.patterns).filter(p => p.kind === pat.kind).map(p => el('option', { value: p.id, text: p.name }))); $('clip-pattern').value = pat.id;
  const users = project.clips.filter(x => x.pattern === pat.id).length;
  $('clip-note').replaceChildren(...(users > 1 ? [el('b', { text: `Used by ${users} clips.` }), ' Editing these notes changes all of them. Make unique gives this clip its own copy.'] : ['Only this clip uses these notes.']));
  const rows = rowsFor(pat.kind); $('rows').replaceChildren(...rows.map(r => el('div', { class: /^A\d$/.test(r.label) ? 'root' : '', text: r.label })));
  $('grid').setAttribute('aria-label', `Note grid for ${pat.name}: ${rows.length} rows, ${pat.bars * STEPS} steps`);
  grid.c = Math.min(grid.c, pat.bars * STEPS - 1); grid.r = Math.min(grid.r, rows.length - 1); drawGrid();
}
function drawGrid() {
  const c = selected && clipOf(selected), pat = c && c.pattern && project.patterns[c.pattern]; if (!pat) return;
  const cv = $('grid'), rows = rowsFor(pat.kind), cell = parseFloat(getComputedStyle($('editor')).getPropertyValue('--cell')) || 22, cols = pat.bars * STEPS, d = Math.min(devicePixelRatio || 1, 2), w = cols * cell, h = rows.length * cell;
  cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.width = Math.round(w * d); cv.height = Math.round(h * d);
  const g = cv.getContext('2d'), css = getComputedStyle(root); g.setTransform(d, 0, 0, d, 0, 0);
  for (let r = 0; r < rows.length; r++) { g.fillStyle = r % 2 ? '#101214' : '#0d0f11'; g.fillRect(0, r * cell, w, cell); }
  for (let x = 0; x <= cols; x++) { g.fillStyle = x % 16 === 0 ? 'rgba(255,255,255,.34)' : x % 4 === 0 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.05)'; g.fillRect(x * cell, 0, 1, h); }
  g.fillStyle = css.getPropertyValue('--' + pat.kind).trim() || '#ccc';
  for (const n of pat.notes) { const r = rows.findIndex(x => x.p === n.p); if (r < 0) continue; g.globalAlpha = 0.45 + 0.55 * n.v; g.fillRect(n.t * cell + 1.5, r * cell + 2.5, n.d * cell - 2, cell - 4); }
  g.globalAlpha = 1;
  if (document.activeElement === cv) { g.strokeStyle = css.getPropertyValue('--accent').trim(); g.lineWidth = 2; g.strokeRect(grid.c * cell + 1, grid.r * cell + 1, cell - 1, cell - 1); }
}
function toggleAt(col, row, quiet) {
  const c = clipOf(selected), pat = project.patterns[c.pattern], rows = rowsFor(pat.kind), r = rows[row]; if (!r || col < 0 || col >= pat.bars * STEPS) return;
  const had = pat.notes.some(n => n.p === r.p && col >= n.t && col < n.t + n.d), len = pat.kind === 'drums' ? 1 : Number($('note-len').value);
  commit(edit.toggleNote(project, pat.id, col, r.p, len));
  $('grid-say').textContent = `${r.label}, bar ${Math.floor(col / STEPS) + 1} step ${col % STEPS + 1}, ${had ? 'removed' : 'added'}`;
  if (!had && !quiet) audition({ kind: pat.kind, p: r.p, v: 0.8, dur: len / 4, track: c.track });
}
function audition(ev) { try { auditionNow(ev); } catch (err) { /* no sound support: the edit still happened */ } }
function auditionNow(ev) { const ctx = engine.ensure(), mixer = engine.mixer || (engine.preview || (engine.preview = makePreview(ctx))); const out = mixer.input(ev.track) || mixer.input(project.tracks[0].id); if (out) playNote(ctx, out, ev, ctx.currentTime + 0.01, 60 / project.bpm); }
function makePreview(ctx) { const g = ctx.createGain(); g.gain.value = 0.5; g.connect(ctx.destination); return { input: () => g }; }

// ---- The arranger ---------------------------------------------------------------------------------
const MOVES = ['Drop the drums in the break', 'Double the chorus', 'Cut the intro', 'Keys only in the intro', 'No bass in bars 5 to 8', 'Faster'];
function logLine(title, lines, err) { const li = el('li', { class: err ? 'err' : '' }, [el('small', { text: title }), document.createTextNode(lines.join('. ') + (err ? '' : '.'))]); $('log').prepend(li); while ($('log').children.length > 5) $('log').lastChild.remove(); }
function runPlan(plan, title) { try { const r = applyPlan(project, plan); commit(r.project); logLine(title, r.said); toast(`${r.said.length} change${r.said.length > 1 ? 's' : ''} applied. Undo takes ${r.said.length > 1 ? 'them' : 'it'} back.`); return { ok: true, said: r.said }; } catch (err) { logLine(title, [err.message], true); return { ok: false, error: err.message }; } }
function ask(text) {
  text = text.trim(); if (!text) return;
  const plan = interpret(text, project);
  if (plan) runPlan(plan, `You asked: ${text}`);
  else logLine(`You asked: ${text}`, ['This page only knows a few moves itself (drop a track in a section, double or cut a section, one track only, faster, slower, a tempo). For this one, copy the brief for Claude and paste its plan on the right'], true);
}

// ---- Transport -----------------------------------------------------------------------------------------
function loopRange() { const c = selected && clipOf(selected); if (c) return [c.start * 4, (c.start + c.len) * 4]; const bar = Math.floor(cursor / 4), s = project.sections.find(x => bar >= x.start && bar < x.start + x.len); return s ? [s.start * 4, (s.start + s.len) * 4] : [0, project.bars * 4]; }
function drawLoop() { const lb = $('loopband'); lb.hidden = !loopOn; if (!loopOn) return; const [a, b] = engine.loop || loopRange(), bw = barw(); lb.style.left = a / 4 * bw + 'px'; lb.style.width = (b - a) / 4 * bw + 'px'; }
function play() { engine.loop = loopOn ? loopRange() : null; const from = engine.loop && (cursor < engine.loop[0] || cursor >= engine.loop[1]) ? engine.loop[0] : cursor >= project.bars * 4 ? 0 : cursor; try { engine.play(from); } catch (err) { engine.stop(); toast('This browser cannot play sound here. Editing, saving and plans still work.'); return; } setPlayUI(true); drawLoop(); }
function stop() { const at = engine.position(); engine.stop(); if (at !== null) cursor = Math.min(Math.floor(at), project.bars * 4); setPlayUI(false); }
function setPlayUI(on) { $('play').setAttribute('aria-label', on ? 'Stop' : 'Play'); $('playicon').setAttribute('d', on ? 'M6 5h12v14H6z' : 'M7 4.5v15l13-7.5z'); }
const playheadBar = () => Math.floor((engine.playing ? engine.position() : cursor) / 4); // where the playhead is now, moving or not, as a bar line
function setCursor(beat) { cursor = Math.max(0, Math.min(project.bars * 4, beat)); if (engine.playing) play(); tick(); }
engine.onstop = () => { cursor = 0; setPlayUI(false); };
function tick() {
  const at = engine.playing ? engine.position() : cursor, bw = barw(), x = at / 4 * bw;
  $('playhead').style.transform = `translateX(${x}px)`; const bar = Math.floor(at / 4), beat = Math.floor(at % 4), text = `${bar + 1}.${beat + 1}`; if ($('pos').textContent !== text) $('pos').textContent = text;
  $('meter').style.height = Math.min(100, engine.level() * 320) + '%';
  if (engine.playing) { const sc = $('scroll'); if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 60); }
}
(function loop() { tick(); requestAnimationFrame(loop); })();

// ---- Level sliders: move freely, one undo step ---------------------------------------------------------
let liveBefore = null;
function liveLevel(id, v) { if (!liveBefore) liveBefore = JSON.stringify(project); project = edit.setTrack(project, id, { vol: v }); engine.refresh(); }
function endLive() { if (!liveBefore) return; past.push(liveBefore); future.length = 0; liveBefore = null; persist(); $('undo').disabled = false; $('redo').disabled = true; }

// ---- Clips: pointer and keys ----------------------------------------------------------------------------
let drag = null;
function select(id, openEditor) { selected = id; if (openEditor) setTab('clip'); renderAll(); }
$('lanes').addEventListener('pointerdown', e => {
  const b = e.target.closest('.clip'); if (!b || e.button > 0) return;
  const c = clipOf(b.dataset.id);
  if (e.pointerType === 'touch' && selected !== c.id) { selected = c.id; renderAll(); return; } // on a phone the first touch selects, so a swipe can still scroll; a selected clip then drags
  e.preventDefault(); b.focus({ preventScroll: true }); if (selected !== c.id) { selected = c.id; renderAll(); }
  const live = $('lanes').querySelector(`[data-id="${CSS.escape(c.id)}"]`); live.setPointerCapture(e.pointerId);
  drag = { id: c.id, x: e.clientX, start: c.start, len: c.len, resize: !!e.target.closest('.grip'), el: live, by: 0 };
});
$('lanes').addEventListener('pointermove', e => {
  if (!drag) return; const bw = barw(), by = Math.round((e.clientX - drag.x) / bw); drag.by = by;
  if (drag.resize) drag.el.style.width = Math.max(1, Math.min(MAX_BARS - drag.start, drag.len + by)) * bw - 2 + 'px'; else drag.el.style.left = Math.max(0, Math.min(MAX_BARS - drag.len, drag.start + by)) * bw + 1 + 'px';
});
$('lanes').addEventListener('pointerup', () => { if (!drag) return; const d = drag; drag = null; if (d.by && !commit(d.resize ? edit.resizeClip(project, d.id, d.len + d.by) : edit.moveClip(project, d.id, d.start + d.by))) renderAll(); });
$('lanes').addEventListener('pointercancel', () => { if (!drag) return; drag = null; renderAll(); }); // a cancelled gesture puts the clip back
$('lanes').addEventListener('dblclick', e => {
  const b = e.target.closest('.clip'); if (b) { select(b.dataset.id, true); $('grid').focus(); return; }
  const lane = e.target.closest('.lane'); if (!lane) return; const t = track(lane.dataset.track), pat = Object.values(project.patterns).find(p => p.kind === t.kind); if (!pat) return;
  const bar = Math.floor((e.clientX - lane.getBoundingClientRect().left) / barw()); commit(edit.addClip(project, t.id, pat.id, bar, pat.bars));
});
$('lanes').addEventListener('keydown', e => {
  const b = e.target.closest('.clip'); if (!b || e.ctrlKey || e.metaKey || e.altKey) return; const c = clipOf(b.dataset.id), k = e.key;
  const done = next => { e.preventDefault(); selected = c.id; if (!commit(next)) renderAll(); };
  if (k === 'ArrowLeft' || k === 'ArrowRight') { const by = k === 'ArrowLeft' ? -1 : 1; done(e.shiftKey ? edit.resizeClip(project, c.id, c.len + by) : edit.moveClip(project, c.id, c.start + by)); }
  else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); const lane = b.parentElement, next = b.nextElementSibling || b.previousElementSibling; selected = null; commit(edit.deleteClip(project, c.id)); const to = next && $('lanes').querySelector(`[data-id="${CSS.escape(next.dataset.id)}"]`); (to || $('scroll')).focus(); void lane; }
  else if (k === 'd' || k === 'D') done(edit.duplicateClip(project, c.id));
  else if (k === 's' || k === 'S') done(edit.splitClip(project, c.id, playheadBar()));
  else if (k === 'Enter') { e.preventDefault(); select(c.id, true); $('grid').focus(); }
  else if (k === ' ') { e.preventDefault(); select(c.id); }
});
$('lanes').addEventListener('click', e => { const b = e.target.closest('.clip'); if (b && e.detail === 0) select(b.dataset.id); else if (!b && e.target.closest('.lane') && selected) { selected = null; renderAll(); } });
$('ruler').addEventListener('click', e => { setCursor(Math.floor((e.clientX - $('ruler').getBoundingClientRect().left) / barw()) * 4); });

// ---- Note grid: pointer and keys ----------------------------------------------------------------------
$('grid').addEventListener('click', e => { const r = $('grid').getBoundingClientRect(), cell = r.height / rowsFor(project.patterns[clipOf(selected).pattern].kind).length; grid.c = Math.floor((e.clientX - r.left) / cell); grid.r = Math.floor((e.clientY - r.top) / cell); toggleAt(grid.c, grid.r); });
$('grid').addEventListener('keydown', e => {
  const c = clipOf(selected), pat = c && project.patterns[c.pattern]; if (!pat) return; const rows = rowsFor(pat.kind), cols = pat.bars * STEPS, k = e.key;
  const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
  if (move) { e.preventDefault(); grid.c = Math.max(0, Math.min(cols - 1, grid.c + move[0])); grid.r = Math.max(0, Math.min(rows.length - 1, grid.r + move[1])); const on = pat.notes.some(n => n.p === rows[grid.r].p && grid.c >= n.t && grid.c < n.t + n.d); $('grid-say').textContent = `${rows[grid.r].label}, bar ${Math.floor(grid.c / STEPS) + 1} step ${grid.c % STEPS + 1}, ${on ? 'note' : 'empty'}`; drawGrid(); const cell = $('grid').getBoundingClientRect().width / cols, wrap = $('grid').parentElement; if (grid.c * cell < wrap.scrollLeft || (grid.c + 1) * cell > wrap.scrollLeft + wrap.clientWidth) wrap.scrollLeft = Math.max(0, grid.c * cell - wrap.clientWidth / 2); }
  else if (k === 'Enter' || k === ' ') { e.preventDefault(); toggleAt(grid.c, grid.r); $('grid').focus(); }
});
for (const ev of ['focus', 'blur']) $('grid').addEventListener(ev, drawGrid);

// ---- Panels, tabs, menu ------------------------------------------------------------------------------------
function setTab(name) { tab = name; for (const t of ['clip', 'arr']) { $('tab-' + t).setAttribute('aria-selected', String(t === name)); $('tab-' + t).tabIndex = t === name ? 0 : -1; $('panel-' + t).hidden = t !== name; } if (name === 'clip') drawGrid(); }
for (const t of ['clip', 'arr']) { $('tab-' + t).addEventListener('click', () => setTab(t)); $('tab-' + t).addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const o = t === 'clip' ? 'arr' : 'clip'; setTab(o); $('tab-' + o).focus(); } }); }
function renderAll() { renderArrange(); renderClipPanel(); }
function menu(open) { $('more-list').hidden = !open; $('more').setAttribute('aria-expanded', String(open)); if (open) $('more-list').querySelector('button').focus(); }
$('more').addEventListener('click', () => menu($('more-list').hidden));
document.addEventListener('click', e => { if (!e.target.closest('.menu')) menu(false); });
$('more-list').addEventListener('keydown', e => { if (e.key === 'Escape') { menu(false); $('more').focus(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const items = [...$('more-list').querySelectorAll('button')], i = items.indexOf(document.activeElement); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); } });
$('more-list').addEventListener('click', e => { if (e.target.closest('button')) menu(false); });

// ---- Files: export, stems, project ---------------------------------------------------------------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function zip(files) { // a plain, uncompressed zip: enough to hand several WAVs over as one file
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  for (const f of files) {
    let crc = 0xFFFFFFFF; for (let i = 0; i < f.data.length; i++) crc = CRC[(crc ^ f.data[i]) & 255] ^ (crc >>> 8); crc = (crc ^ 0xFFFFFFFF) >>> 0;
    const name = enc.encode(f.name), head = new DataView(new ArrayBuffer(30)), cd = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); head.setUint32(14, crc, true); head.setUint32(18, f.data.length, true); head.setUint32(22, f.data.length, true); head.setUint16(26, name.length, true);
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint32(16, crc, true); cd.setUint32(20, f.data.length, true); cd.setUint32(24, f.data.length, true); cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    parts.push(head.buffer, name, f.data); central.push(cd.buffer, name); offset += 30 + name.length + f.data.length;
  }
  const size = central.reduce((n, c) => n + c.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
function download(name, data, type) { const url = URL.createObjectURL(new Blob([data], { type })), a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }
const slug = (p = project) => p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song';
async function busy(btn, label, work) { const old = btn.textContent; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = label; try { return await work(); } catch (err) { toast('That did not work: ' + err.message); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = old; } }
$('export').addEventListener('click', () => busy($('export'), 'Rendering', async () => { const p = project, name = slug(p), r = await renderOffline(p, 0, p.bars, new Map(engine.stems)); download(`${name}.wav`, wavFromBuffer(r.buffer), 'audio/wav'); toast(`Exported ${Math.round(r.seconds)} seconds. Peak ${Math.round(r.peak * 100)}% of full scale.`); return r; }));
$('save-stems').addEventListener('click', () => busy($('more'), 'Rendering stems', async () => { // one zip, so the browser asks once
  const p = project, stems = new Map(engine.stems), name = slug(p), files = []; // one snapshot: an edit made while it renders cannot mix two versions in one zip
  for (const t of p.tracks) { if (!p.clips.some(c => c.track === t.id && (c.pattern || stems.has(c.track)))) continue; const r = await renderOffline(p, 0, p.bars, stems, { only: t.id }); files.push({ name: `${name}-${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'track'}.wav`, data: new Uint8Array(wavFromBuffer(r.buffer)) }); }
  download(`${name}-stems.zip`, zip(files), 'application/zip'); toast(`${files.length} stems in one zip file.`); return files.length; }));
// Audio goes back onto a track whose audio is missing (the one asked for, or one with the same name as the file);
// otherwise it becomes a new track from bar 1. Relinking changes no clips, levels or undo history: the edits stay as they were.
const missingStem = t => t && t.kind === 'audio' && !engine.stems.has(t.id);
async function addStem(name, bytes, target) {
  const buf = await new OfflineAudioContext(2, 1, SR).decodeAudioData(bytes.slice(0)), label = name.replace(/\.[a-z0-9]+$/i, '').slice(0, 28) || 'Stem';
  const back = missingStem(track(target)) ? track(target) : project.tracks.find(t => missingStem(t) && t.name === label), id = back ? back.id : 'stem-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  engine.stems.set(id, buf); const d = buf.getChannelData(0), pk = new Float32Array(400), step = Math.max(1, Math.floor(d.length / 400)); for (let i = 0; i < 400; i++) { let m = 0; for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j += 8) m = Math.max(m, Math.abs(d[j])); pk[i] = m; } peaks.set(id, pk);
  if (back) { renderAll(); engine.refresh(); return { id, seconds: buf.duration, bars: null, relinked: true }; }
  const p = clone(edit.addTrack(project, { id, name: label, kind: 'audio' })), len = Math.max(1, Math.min(MAX_BARS, Math.ceil(buf.duration / (240 / p.bpm))));
  p.clips.push({ id: 'c-' + id, track: id, pattern: null, start: 0, len }); p.bars = Math.max(p.bars, len); commit(p); return { id, seconds: buf.duration, bars: len, relinked: false };
}
let relinkTo = null;
$('load-stems').addEventListener('click', () => { relinkTo = null; $('file-stems').click(); });
$('clip-relink').addEventListener('click', () => { const c = clipOf(selected); relinkTo = c ? c.track : null; $('file-stems').click(); });
$('file-stems').addEventListener('change', async e => { let added = 0, back = 0, target = relinkTo; relinkTo = null; for (const f of e.target.files) { try { const r = await addStem(f.name, await f.arrayBuffer(), target); target = null; if (r.relinked) back++; else added++; } catch (err) { toast(`Could not read ${f.name} as audio.`); } } e.target.value = '';
  if (added || back) toast([back ? `${back} stem${back > 1 ? 's' : ''} back on ${back > 1 ? 'their' : 'its'} own track${back > 1 ? 's' : ''}, edits kept` : '', added ? `${added} stem${added > 1 ? 's' : ''} loaded as new track${added > 1 ? 's' : ''}` : ''].filter(Boolean).join('. ') + '.'); });
$('save-project').addEventListener('click', () => download(`${slug()}.stemstudio.json`, JSON.stringify(project, null, 1), 'application/json'));
$('open-project').addEventListener('click', () => $('file-project').click());
$('file-project').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { commit(validate(JSON.parse(await f.text()))); toast('Project opened.'); } catch (err) { toast(err.message.includes('Stem Studio') ? err.message : 'That file could not be read as a project.'); } });
$('reset').addEventListener('click', () => { selected = null; cursor = 0; commit(demoProject()); toast('Back to the demo song. Undo brings your version back.'); });

// ---- Buttons and keys -----------------------------------------------------------------------------------------
$('play').addEventListener('click', () => (engine.playing ? stop() : play()));
$('rewind').addEventListener('click', () => setCursor(0));
$('loop').addEventListener('click', () => { loopOn = !loopOn; $('loop').setAttribute('aria-pressed', String(loopOn)); if (engine.playing) play(); else drawLoop(); });
$('bpm').addEventListener('change', e => { commit(edit.setBpm(project, Number(e.target.value) || project.bpm)); e.target.value = project.bpm; }); // the box always shows the tempo the song is really using
$('bpm-down').addEventListener('click', () => commit(edit.setBpm(project, project.bpm - 1)));
$('bpm-up').addEventListener('click', () => commit(edit.setBpm(project, project.bpm + 1)));
$('undo').addEventListener('click', undo); $('redo').addEventListener('click', redo);
$('add-clip').addEventListener('click', () => { const pat = project.patterns[$('add-pattern').value], t = pat && project.tracks.find(x => x.kind === pat.kind); if (!t) return; const before = project; commit(edit.addClip(project, t.id, pat.id, Number($('add-bar').value) - 1, pat.bars)); if (project !== before) { selected = project.clips[project.clips.length - 1].id; renderAll(); } });
$('clip-pattern').addEventListener('change', e => { const p = clone(project); p.clips.find(c => c.id === selected).pattern = e.target.value; commit(p); });
$('clip-dup').addEventListener('click', () => commit(edit.duplicateClip(project, selected)) || toast('No room to duplicate that clip.'));
$('clip-split').addEventListener('click', () => commit(edit.splitClip(project, selected, playheadBar())) || toast('Move the playhead inside the clip, past its first bar, then split.'));
$('clip-unique').addEventListener('click', () => commit(edit.makeUnique(project, selected)));
$('clip-del').addEventListener('click', () => { const id = selected; selected = null; commit(edit.deleteClip(project, id)); });
$('ask-go').addEventListener('click', () => ask($('ask').value)); $('ask').addEventListener('keydown', e => { if (e.key === 'Enter') ask($('ask').value); });
$('chips').replaceChildren(...MOVES.map(m => el('button', { class: 'chip', type: 'button', text: m, onclick: () => { $('ask').value = m; ask(m); } })));
$('brief').addEventListener('click', async () => { const text = briefFor(project, $('ask').value.trim()); try { await navigator.clipboard.writeText(text); toast('Brief copied. Give it to Claude, then paste the plan it writes into the box.'); } catch (err) { $('plan').value = text; $('plan').select(); toast('Copying is blocked here, so the brief is in the box, selected.'); } });
$('plan-go').addEventListener('click', () => { let plan; try { plan = JSON.parse($('plan').value); } catch (err) { logLine('Plan', ['That is not valid JSON. A plan looks like {"ops":[{"op":"set_tempo","bpm":120}]}'], true); return; } runPlan(plan, 'Plan applied'); });
$('about-open').addEventListener('click', () => $('about').showModal()); $('about-close').addEventListener('click', () => $('about').close());
addEventListener('keydown', e => {
  if ($('about').open) return; const tag = e.target.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && tag !== 'TEXTAREA' && !(tag === 'INPUT' && e.target.type === 'text')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ' && tag !== 'BUTTON' && tag !== 'CANVAS') { e.preventDefault(); if (engine.playing) stop(); else play(); }
  else if (e.key === 'Home' && tag !== 'CANVAS') setCursor(0);
});
addEventListener('resize', renderAll);
document.addEventListener('visibilitychange', () => { if (document.hidden && engine.playing) stop(); });

// ---- For scripts and assistants -----------------------------------------------------------------------------------
window.stemStudio = {
  project: () => clone(project), brief: request => briefFor(project, request || ''), apply: plan => runPlan(plan, 'Plan applied by script'), ask, undo, redo,
  loadStem: (name, bytes, track) => addStem(name, bytes, track), render: async (fromBar = 0, toBar = project.bars, only = null) => { const r = await renderOffline(project, fromBar, toBar, engine.stems, { only }); return { seconds: r.seconds, samples: r.buffer.length, peak: r.peak, rawPeak: r.rawPeak, wav: wavFromBuffer(r.buffer) }; },
  state: () => ({ playing: engine.playing, position: engine.playing ? engine.position() : cursor, selected, loopOn, undo: past.length, redo: future.length, tab, stems: [...engine.stems.keys()] }),
};
renderAll();
