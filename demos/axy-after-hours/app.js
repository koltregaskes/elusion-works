// Axy Lusion After Hours. One real HTML page, two rooms.
// Where the browser has HTML-in-Canvas, the live page is drawn into a WebGL canvas and
// bent by a shader. Everywhere else the same page runs as ordinary HTML.
const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = matchMedia('(pointer: coarse), (max-width: 760px)').matches;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const page = $('page'), stage = $('stage');

// ---- Frames: generative tone studies standing in for archive images --------------------
// Refs, dates and tones are the archive's own records. No titles, as on the archive.
const FRAMES = [
  { ref: 'F0006', date: '13 Dec 2025', tone: '#1a3540', accent: '#c4851a', comic: true },
  { ref: 'F0005', date: '13 Dec 2025', tone: '#2a0d2e', accent: '#c4851a', comic: true },
  { ref: 'F0008', date: '13 Dec 2025', tone: '#2a0d2e', accent: '#c4851a', comic: true },
  { ref: 'F0007', date: '13 Dec 2025', tone: '#1c2a1a', accent: '#d4a03a', comic: true },
  { ref: 'F0002', date: '14 Dec 2025', tone: '#1a3540', accent: '#c4851a' },
  { ref: 'F0001', date: '14 Dec 2025', tone: '#3a1f10', accent: '#d4a03a' },
  { ref: 'F0012', date: '6 Dec 2025', tone: '#1f1024', accent: '#d4a03a' },
  { ref: 'F0013', date: '6 Dec 2025', tone: '#3a0d12', accent: '#d4a03a' },
];
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function study(f, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), r = rng(parseInt(f.ref.slice(1), 10) * 7919 + 13), [tr, tg, tb] = rgb(f.tone), [ar, ag, ab] = rgb(f.accent);
  const bg = g.createLinearGradient(0, 0, w * 0.35, h); bg.addColorStop(0, `rgb(${tr * 1.9 | 0},${tg * 1.9 | 0},${tb * 1.9 | 0})`); bg.addColorStop(1, '#060606');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const lx = w * (0.2 + 0.6 * r()), ly = h * (0.15 + 0.3 * r()), glow = g.createRadialGradient(lx, ly, 0, lx, ly, w * 0.95);
  glow.addColorStop(0, `rgba(${ar},${ag},${ab},0.6)`); glow.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
  g.globalCompositeOperation = 'lighter'; g.fillStyle = glow; g.fillRect(0, 0, w, h);
  // luminous threads following a flow field
  const s = 0.007 + 0.005 * r(), ph = r() * 10, cx = w * (0.3 + 0.4 * r()), cy = h * (0.42 + 0.25 * r()), n = small ? 420 : 760;
  g.lineWidth = 0.8;
  for (let i = 0; i < n; i++) {
    let x = r() * w, y = r() * h; const k = r();
    g.strokeStyle = k < 0.45 ? `rgba(${ar},${ag},${ab},0.12)` : k < 0.82 ? `rgba(${Math.min(255, tr * 3 + 50)},${Math.min(255, tg * 3 + 50)},${Math.min(255, tb * 3 + 50)},0.12)` : 'rgba(245,230,200,0.09)';
    g.beginPath(); g.moveTo(x, y);
    for (let j = 0; j < 46; j++) { const a = Math.sin(x * s + ph) * 1.7 + Math.cos(y * s * 1.3 - ph) * 1.7 + Math.atan2(y - cy, x - cx); x += Math.cos(a) * 3; y += Math.sin(a) * 3; g.lineTo(x, y); }
    g.stroke();
  }
  // a dark form with a lit rim: eclipse, arch or horizon
  g.globalCompositeOperation = 'source-over';
  const motif = Math.floor(r() * 3), rad = w * (0.22 + 0.08 * r());
  g.shadowColor = `rgba(${ar},${ag},${ab},0.9)`; g.shadowBlur = w * 0.08; g.fillStyle = '#050505';
  if (motif === 0) { g.beginPath(); g.arc(cx, cy, rad, 0, 7); g.fill(); }
  else if (motif === 1) { g.beginPath(); g.moveTo(cx - rad, h); g.lineTo(cx - rad, cy); g.arc(cx, cy, rad, Math.PI, 0); g.lineTo(cx + rad, h); g.closePath(); g.fill(); }
  else { g.fillRect(-20, cy + rad * 0.6, w + 40, h); g.beginPath(); g.arc(cx, cy + rad * 0.6, rad * 0.45, Math.PI, 0); g.fill(); }
  g.shadowBlur = 0;
  if (f.comic) { // halftone dots
    g.globalCompositeOperation = 'overlay'; g.fillStyle = 'rgba(245,230,200,0.22)';
    for (let y = 4; y < h; y += 8) for (let x = (y / 8) % 2 ? 4 : 8; x < w; x += 8) { const q = 0.5 + 0.5 * Math.sin(x * 0.012 + y * 0.009 + ph); g.beginPath(); g.arc(x, y, 0.6 + q * 2.4, 0, 7); g.fill(); }
  }
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < w * h * 0.004; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.10)'; g.fillRect(r() * w, r() * h, 1, 1); }
  return c;
}
const GALLERY = document.querySelector('.site a').href; // the archive address lives once, in the page's own navigation
function frameItem(f, cls) {
  const li = document.createElement('li'), a = document.createElement('a'), img = document.createElement('img'), ref = document.createElement('span');
  a.href = GALLERY; a.setAttribute('aria-label', `Frame ${f.ref}, ${f.date}. Open the gallery`);
  img.alt = ''; img.className = cls; img.draggable = false; a.draggable = false; img.style.setProperty('--t', f.tone); img.decoding = 'async'; img.width = 360; img.height = 450;
  ref.className = 'ref'; ref.textContent = f.ref; ref.setAttribute('aria-hidden', 'true');
  a.appendChild(img); li.append(a, ref); f.imgs = (f.imgs || []).concat(img);
  return li;
}
FRAMES.slice(0, 6).forEach(f => { const li = frameItem(f, 'frame'); li.classList.add('fall'); $('strip').appendChild(li); });
FRAMES.forEach(f => $('wall').appendChild(frameItem(f, '')));
let framesReady = 0;
(function paintNext(i) { // one study per frame so first paint is never blocked
  if (i >= FRAMES.length) return;
  const f = FRAMES[i];
  study(f, small ? 240 : 360, small ? 300 : 450).toBlob(b => { const u = URL.createObjectURL(b); f.imgs.forEach(im => { im.src = u; }); framesReady++; dirty = true; }, 'image/jpeg', 0.86);
  requestAnimationFrame(() => paintNext(i + 1));
})(0);

// Headline letters and lede words each become something that can fall.
{ const h = $('u-title'); 'AXY LUSION'.split('').forEach(ch => { const s = document.createElement('span'); if (ch === ' ') s.className = 'gap'; else { s.className = 'fall'; s.textContent = ch; } s.setAttribute('aria-hidden', 'true'); h.appendChild(s); });
  const lede = $('lede'), words = lede.textContent.trim().split(/\s+/); lede.textContent = '';
  words.forEach(w => { const s = document.createElement('span'); s.className = 'fall'; s.textContent = w; lede.append(s, ' '); }); }

// ---- State ---------------------------------------------------------------------------------------
let room = 'undertow', dirty = true, tier = 'html', W = innerWidth, H = innerHeight, time = 0, feeding = false, releaseR = 0, dragging = false;
const well = { x: W * 0.77, y: H * 0.56, tx: W * 0.77, ty: H * 0.56, mass: 0.55, rs: 50 };
const bodies = [...document.querySelectorAll('#undertow .fall')].map(el => ({ el, hx: 0, hy: 0, x: 0, y: 0, vx: 0, vy: 0, rot: 0, sx: 1, sy: 1, a: 1, mode: 'home', hold: 0, away: 0 }));
const lamps = [{ x: 0.18, y: 0.42, b: 0.85, w: 0.75, on: true }, { x: 0.52, y: 0.36, b: 0.8, w: 0.7, on: true }, { x: 0.82, y: 0.62, b: 0.7, w: 0.3, on: true }];
let house = 0.12, selected = 0;
const band = { top: 64, bottom: H - 40 }; // the wall sits between the header and the footer

function measure() { // home positions, read with transforms cleared
  W = innerWidth; H = innerHeight;
  const pr = page.getBoundingClientRect();
  for (const b of bodies) b.el.style.transform = '';
  for (const b of bodies) { const r = b.el.getBoundingClientRect(); b.hx = r.left - pr.left + r.width / 2; b.hy = r.top - pr.top + r.height / 2; b.vis = r.width > 0; }
  for (const b of bodies) applyBody(b);
  dirty = true;
}
function applyBody(b) {
  const still = Math.abs(b.x) + Math.abs(b.y) < 0.05 && Math.abs(b.rot) < 0.001 && Math.abs(b.sx - 1) < 0.001 && Math.abs(b.sy - 1) < 0.001;
  b.el.style.transform = still ? '' : `translate(${b.x.toFixed(2)}px,${b.y.toFixed(2)}px) rotate(${b.rot.toFixed(3)}rad) scale(${b.sx.toFixed(3)},${b.sy.toFixed(3)})`;
  b.el.style.opacity = b.a >= 0.999 ? '' : b.a.toFixed(3);
  b.el.style.pointerEvents = b.mode === 'falling' || b.mode === 'gone' ? 'none' : '';
}

// ---- Undertow: the page leans in, then falls in ------------------------------------------------------
const G = 6.2e7;
function stepUndertow(dt) {
  well.rs = (16 + 58 * well.mass) * (small ? 0.62 : 1);
  well.x += (well.tx - well.x) * Math.min(1, dt * 14); well.y += (well.ty - well.y) * Math.min(1, dt * 14);
  if (feeding) releaseR = Math.min(Math.hypot(W, H), releaseR + (110 + 190 * well.mass) * dt);
  const rs = well.rs;
  for (const b of bodies) {
    if (!b.vis) continue;
    const hd = Math.hypot(well.x - b.hx, well.y - b.hy), focused = b.el === document.activeElement || b.el.contains(document.activeElement);
    b.hold = Math.max(0, b.hold - dt);
    if (b.mode === 'home') {
      const dx = well.x - b.hx, dy = well.y - b.hy, r = Math.max(hd, 1), lean = Math.min(r * 0.42, 1.5 * well.mass * rs * rs / Math.max(r, rs));
      b.x += (dx / r * lean - b.x) * Math.min(1, dt * 9); b.y += (dy / r * lean - b.y) * Math.min(1, dt * 9);
      b.rot += (0 - b.rot) * Math.min(1, dt * 9); b.sx += (1 - b.sx) * Math.min(1, dt * 9); b.sy += (1 - b.sy) * Math.min(1, dt * 9); b.a = Math.min(1, b.a + dt * 3);
      if (!focused && b.hold <= 0 && (hd < rs * 1.15 || (feeding && hd < releaseR))) { // let go: start a decaying orbit
        b.mode = 'falling'; const v = Math.sqrt(G * well.mass / Math.max(r * r, 900)) * 0.11 * Math.sqrt(r); b.vx = -dy / r * v; b.vy = dx / r * v;
      }
    } else if (b.mode === 'falling') {
      const dx = well.x - (b.hx + b.x), dy = well.y - (b.hy + b.y), r = Math.max(Math.hypot(dx, dy), 1), acc = G * well.mass / (r * r + 2500);
      b.vx += dx / r * acc * dt; b.vy += dy / r * acc * dt; const drag = Math.exp(-0.9 * dt); b.vx *= drag; b.vy *= drag;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const near = smooth(rs * 6, rs * 1.4, r), stretch = 1 + 1.6 * near; // pulled long toward the hole, thin across it
      let want = Math.atan2(dy, dx); while (want - b.rot > Math.PI) want -= 2 * Math.PI; while (want - b.rot < -Math.PI) want += 2 * Math.PI;
      b.rot += (want - b.rot) * near * Math.min(1, dt * 10);
      const shrink = clamp(r / (rs * 3.2), 0.12, 1); b.sx = stretch * shrink; b.sy = shrink / Math.sqrt(stretch);
      b.a = smooth(rs * 0.85, rs * 1.7, r);
      if (r < rs * 0.9 || focused) { b.mode = focused ? 'returning' : 'gone'; b.a = focused ? b.a : 0; b.away = 0; }
    } else if (b.mode === 'gone') {
      b.away = hd > rs * 3 && !feeding ? b.away + dt : 0;
      if (b.away > 1.1 || focused) b.mode = 'returning';
    } else { // returning: a soft spring home
      const k = Math.min(1, dt * 5.5); b.x -= b.x * k; b.y -= b.y * k; b.rot -= b.rot * k; b.sx += (1 - b.sx) * k; b.sy += (1 - b.sy) * k; b.a = Math.min(1, b.a + dt * 2.2); b.vx = b.vy = 0;
      if (Math.abs(b.x) + Math.abs(b.y) < 0.6 && b.a > 0.98) { b.mode = 'home'; b.hold = 3.5; }
    }
    applyBody(b);
  }
}
function still() { // reduced motion: no travelling, things simply go and come back
  well.rs = (16 + 58 * well.mass) * (small ? 0.62 : 1); well.x = well.tx; well.y = well.ty;
  for (const b of bodies) {
    const hd = Math.hypot(well.x - b.hx, well.y - b.hy), focused = b.el === document.activeElement || b.el.contains(document.activeElement);
    const gone = !focused && (hd < well.rs * 1.15 || (feeding && hd < Math.hypot(W, H) * 0.42));
    b.mode = gone ? 'gone' : 'home'; b.a = gone ? 0 : 1; b.x = b.y = b.rot = 0; b.sx = b.sy = 1; applyBody(b);
  }
}
function setFeeding(on) { feeding = on; if (on) releaseR = well.rs * 1.5; $('feed').setAttribute('aria-pressed', String(on)); $('feed').textContent = on ? 'Stop feeding' : 'Feed the well'; dirty = true; if (reduced) still(); }
function restore() { setFeeding(false); for (const b of bodies) if (b.mode !== 'home') { b.mode = 'returning'; } if (reduced) still(); dirty = true; }

// Plain-HTML well: a dark disc and amber ring drawn behind the page.
const wellfx = $('wellfx'), wctx = wellfx.getContext('2d');
function drawWell2D() {
  const d = Math.min(devicePixelRatio || 1, 2); if (wellfx.width !== Math.round(W * d)) { wellfx.width = Math.round(W * d); wellfx.height = Math.round(H * d); }
  wctx.setTransform(d, 0, 0, d, 0, 0); wctx.clearRect(0, 0, W, H);
  if (room !== 'undertow') return;
  const { x, y, rs } = well, g = wctx.createRadialGradient(x, y, rs * 0.8, x, y, rs * 3.4);
  g.addColorStop(0, `rgba(212,150,40,${0.35 + 0.4 * well.mass})`); g.addColorStop(0.3, 'rgba(196,133,26,0.2)'); g.addColorStop(1, 'rgba(196,133,26,0)');
  wctx.fillStyle = g; wctx.beginPath(); wctx.arc(x, y, rs * 3.4, 0, 7); wctx.fill();
  wctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) { const a = time * (0.7 + i * 0.25) + i * 2.1; wctx.strokeStyle = `rgba(245,214,150,${0.3 - i * 0.07})`; wctx.lineWidth = rs * (0.1 - i * 0.02); wctx.beginPath(); wctx.arc(x, y, rs * (1.35 + i * 0.35), a, a + 1.5 + i * 0.4); wctx.stroke(); }
  wctx.fillStyle = '#000'; wctx.beginPath(); wctx.arc(x, y, rs, 0, 7); wctx.fill();
  wctx.strokeStyle = 'rgba(255,236,196,0.85)'; wctx.lineWidth = 1.5; wctx.beginPath(); wctx.arc(x, y, rs * 1.07, 0, 7); wctx.stroke();
}

// ---- Lamplight ---------------------------------------------------------------------------------------------
const lampColour = l => { const w = l.w; return [0.80 + 0.20 * w, 0.88 - 0.14 * w, 1.0 - 0.58 * w]; };
const lampRadius = l => (0.16 + 0.2 * l.b) * Math.min(W, H) * (small ? 1.25 : 1);
const lampsBox = $('lamps'), lampEls = lamps.map((l, i) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'lamp'; lampsBox.insertBefore(b, lampsBox.firstChild);
  let moved = 0, sx = 0, sy = 0;
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.focus(); b.setPointerCapture(e.pointerId); moved = 0; sx = e.clientX; sy = e.clientY; select(i); }); // preventDefault: never start a native drag of the picture underneath
  b.addEventListener('pointermove', e => { if (!b.hasPointerCapture(e.pointerId)) return; moved = Math.max(moved, Math.hypot(e.clientX - sx, e.clientY - sy)); l.x = clamp(e.clientX / W, 0.02, 0.98); l.y = clamp(e.clientY / H, 0.08, 0.95); placeLamps(); });
  b.addEventListener('click', e => { if (e.detail === 0) { l.on = !l.on; placeLamps(); } }); // Enter or Space switches it; a pointer click only selects
  b.addEventListener('dblclick', () => { l.on = !l.on; placeLamps(); });
  b.addEventListener('focus', () => select(i));
  b.addEventListener('keydown', e => { const s = e.shiftKey ? 0.06 : 0.02, k = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key]; if (!k) return; e.preventDefault(); l.x = clamp(l.x + k[0], 0.02, 0.98); l.y = clamp(l.y + k[1], 0.08, 0.95); placeLamps(); });
  return b;
});
{ const lab = document.createElement('label'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'lamp-on'; lab.htmlFor = 'lamp-on'; lab.append(cb, ' On'); $('lamp-bright').closest('label').before(lab);
  cb.addEventListener('change', () => { lamps[selected].on = cb.checked; placeLamps(); }); }
function select(i) { selected = i; const l = lamps[i]; $('lamp-name').textContent = `Lamp ${i + 1}`; $('lamp-bright').value = Math.round(l.b * 100); $('lamp-warm').value = Math.round(l.w * 100); $('lamp-on').checked = l.on; lampEls.forEach((b, k) => b.classList.toggle('sel', k === i)); }
function placeLamps() {
  lamps.forEach((l, i) => { const b = lampEls[i]; b.style.left = l.x * W + 'px'; b.style.top = l.y * H + 'px'; b.setAttribute('aria-pressed', String(l.on)); b.setAttribute('aria-label', `Lamp ${i + 1}, ${l.on ? 'on' : 'off'}. Arrow keys move it, Enter switches it on or off`); });
  $('lamp-on').checked = lamps[selected].on;
  const pr = page.getBoundingClientRect(); // frame shadows fall away from the nearest lit lamp
  for (const a of document.querySelectorAll('.wall a')) {
    const r = a.getBoundingClientRect(); if (!r.width) continue; const cx = r.left + r.width / 2, cy = r.top + r.height / 2; let best = null, bd = 1e9;
    for (const l of lamps) if (l.on) { const d = Math.hypot(l.x * W - cx, l.y * H - cy); if (d < bd) { bd = d; best = l; } }
    const dx = best ? cx - best.x * W : 0, dy = best ? cy - best.y * H : 1, m = Math.hypot(dx, dy) || 1, len = best ? Math.min(26, 6 + bd * 0.05) : 10;
    a.style.setProperty('--sx', (dx / m * len).toFixed(1) + 'px'); a.style.setProperty('--sy', (dy / m * len).toFixed(1) + 'px');
  }
  band.top = document.querySelector('.top').getBoundingClientRect().bottom - pr.top; band.bottom = document.querySelector('.foot').getBoundingClientRect().top - pr.top;
  dirty = true;
}
const dark = $('dark'), dctx = dark.getContext('2d');
function drawDark() { // plain-HTML lighting: darkness with pools cut out of it
  const d = Math.min(devicePixelRatio || 1, 2); if (dark.width !== Math.round(W * d)) { dark.width = Math.round(W * d); dark.height = Math.round(H * d); }
  dctx.setTransform(d, 0, 0, d, 0, 0); dctx.globalCompositeOperation = 'source-over'; dctx.clearRect(0, 0, W, H);
  if (room !== 'lamplight' || tier === 'canvas') return;
  dctx.fillStyle = `rgba(5,4,3,${clamp(0.97 - house * 1.5, 0.1, 0.97)})`; dctx.fillRect(0, 0, W, H);
  dctx.save(); dctx.beginPath(); dctx.rect(0, band.top, W, band.bottom - band.top); dctx.clip(); // only the wall is lit; the header and footer are signage
  dctx.globalCompositeOperation = 'destination-out';
  for (const l of lamps) if (l.on) { const R = lampRadius(l) * 1.9, g = dctx.createRadialGradient(l.x * W, l.y * H, 0, l.x * W, l.y * H, R); g.addColorStop(0, `rgba(0,0,0,${0.55 + 0.45 * l.b})`); g.addColorStop(0.45, `rgba(0,0,0,${0.35 * l.b})`); g.addColorStop(1, 'rgba(0,0,0,0)'); dctx.fillStyle = g; dctx.fillRect(0, 0, W, H); }
  dctx.globalCompositeOperation = 'source-over';
  for (const l of lamps) if (l.on) { const c = lampColour(l), R = lampRadius(l) * 1.6, g = dctx.createRadialGradient(l.x * W, l.y * H, 0, l.x * W, l.y * H, R); g.addColorStop(0, `rgba(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0},${0.16 * l.b})`); g.addColorStop(1, 'rgba(0,0,0,0)'); dctx.fillStyle = g; dctx.fillRect(0, 0, W, H); }
  dctx.restore(); dctx.clearRect(0, 0, W, band.top); dctx.clearRect(0, band.bottom, W, H - band.bottom);
}

// ---- Rooms ---------------------------------------------------------------------------------------------------
function setRoom(name, fromHash) {
  room = name === 'lamplight' ? 'lamplight' : 'undertow'; page.dataset.room = room;
  $('undertow').hidden = room !== 'undertow'; $('lamplight').hidden = room !== 'lamplight'; lampsBox.hidden = room !== 'lamplight';
  document.querySelectorAll('.rooms a').forEach(a => { if (a.dataset.room === room) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (!fromHash && location.hash.slice(1) !== room) history.replaceState(null, '', '#' + room);
  page.scrollTop = 0; $('room').scrollTop = 0; scrollTo(0, 0); // a hash in the address must not scroll the header away
  measure(); placeLamps(); drawWell2D(); drawDark(); dirty = true;
}

// ---- HTML-in-Canvas: draw the live page through a shader ---------------------------------------------------------
let gl = null, glass = null, prog = null, U = {}, uploadForm = -1, painted = false;
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uRes; uniform float uDpr, uTime, uRoom, uMass, uHouse;
uniform vec3 uWell; uniform vec4 uLamp[3]; uniform vec3 uLampCol[3]; uniform vec2 uBand;
out vec4 o;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f); return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
vec3 pageAt(vec2 q){ vec2 uv = q/uRes; if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.024); return texture(uTex, uv).rgb; }
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y); vec3 col;
  if (uRoom < 0.5) {
    vec2 d = p - uWell.xy; float r = length(d), rs = uWell.z; vec2 n = d/max(r, 0.001);
    float defl = rs*rs*(1.1 + 2.3*uMass)/max(r, rs*0.35);            // light from further out lands here
    float sw = (0.35 + 1.1*uMass)*rs*rs/(r*r + rs*rs);                // frame dragging: a twist near the hole
    float cs = cos(sw), sn = sin(sw); mat2 R = mat2(cs, -sn, sn, cs); vec2 bd = R*d, bn = R*n;
    col = vec3(pageAt(uWell.xy + bd + bn*defl*1.06).r, pageAt(uWell.xy + bd + bn*defl).g, pageAt(uWell.xy + bd + bn*defl*0.94).b);
    float ang = atan(d.y, d.x);
    float disc = exp(-pow((r - rs*1.9)/(rs*0.8), 2.0));
    float streak = 0.5 + 0.5*sin(ang*2.0 + uTime*0.9 + 7.0*fbm(vec2(ang*1.6, r/uDpr*0.02 - uTime*0.22)));
    col += vec3(0.86, 0.52, 0.10)*disc*streak*(0.62 + 0.38*cos(ang - 0.6))*(0.22 + 0.6*uMass);
    col += vec3(1.0, 0.87, 0.62)*exp(-pow((r - rs*1.12)/(rs*0.05), 2.0))*(0.45 + 0.55*uMass);
    col *= smoothstep(rs*0.93, rs*1.06, r);
  } else {
    vec2 e = vec2(1.5*uDpr, 0.0); vec3 alb = pageAt(p);
    float gx = lum(pageAt(p - e.xy)) - lum(pageAt(p + e.xy)), gy = lum(pageAt(p - e.yx)) - lum(pageAt(p + e.yx));
    vec2 q = p/uDpr*0.55; float g0 = fbm(q), g1 = fbm(q + vec2(1.1, 0.0)), g2 = fbm(q + vec2(0.0, 1.1));
    vec3 N = normalize(vec3(gx*2.4 + (g0 - g1)*1.1, gy*2.4 + (g0 - g2)*1.1, 1.0));       // paint and plaster catch the light
    alb *= 0.9 + 0.2*g0;
    vec3 light = uHouse*vec3(0.78, 0.84, 1.0);
    for (int i = 0; i < 3; i++) {
      vec2 dl = uLamp[i].xy - p; float R = uLamp[i].z, dist2 = dot(dl, dl);
      float att = uLamp[i].w/pow(1.0 + dist2/(R*R*0.4), 1.7);
      vec3 L = normalize(vec3(dl, R*0.55)); vec3 Hh = normalize(L + vec3(0.0, 0.0, 1.0));
      light += uLampCol[i]*att*(max(dot(N, L), 0.0)*1.5 + pow(max(dot(N, Hh), 0.0), 36.0)*0.45);
    }
    col = 1.0 - exp(-alb*light*1.35);
    float sign = 1.0 - smoothstep(uBand.x - 1.0, uBand.x + 1.0, p.y) + smoothstep(uBand.y - 1.0, uBand.y + 1.0, p.y); // header and footer stay lit
    col = mix(col, pageAt(p), clamp(sign, 0.0, 1.0));
  }
  o = vec4(col, 1.0);
}`;
function upload() { // three shapes of the same call, newest first; remember the one that works
  const forms = [
    () => gl.texElementImage2D(gl.TEXTURE_2D, gl.RGBA8, page),
    () => gl.texElementImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, page),
    () => { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, glass.width, glass.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, page); },
  ];
  if (uploadForm >= 0) return forms[uploadForm]();
  let last; for (let i = 0; i < forms.length; i++) { try { forms[i](); uploadForm = i; return; } catch (err) { last = err; } }
  throw last;
}
function paint() {
  if (!gl) return;
  try { upload(); } catch (err) { if (!painted) { leaveCanvas(); } return; }
  const d = glass.width / W;
  gl.viewport(0, 0, glass.width, glass.height);
  gl.uniform2f(U.uRes, glass.width, glass.height); gl.uniform1f(U.uDpr, d); gl.uniform1f(U.uTime, reduced ? 0 : time); gl.uniform1f(U.uRoom, room === 'undertow' ? 0 : 1);
  gl.uniform1f(U.uMass, well.mass); gl.uniform3f(U.uWell, well.x * d, well.y * d, well.rs * d); gl.uniform1f(U.uHouse, house);
  const lp = [], lc = []; for (const l of lamps) { lp.push(l.x * W * d, l.y * H * d, lampRadius(l) * d, l.on ? 0.55 + 1.5 * l.b : 0); lc.push(...lampColour(l)); }
  gl.uniform4fv(U.uLamp, lp); gl.uniform3fv(U.uLampCol, lc); gl.uniform2f(U.uBand, band.top * d, band.bottom * d);
  gl.drawArrays(gl.TRIANGLES, 0, 3); painted = true;
}
function sizeGlass() { if (!glass) return; const d = Math.min(devicePixelRatio || 1, small ? 1.5 : 2); glass.width = Math.round(W * d); glass.height = Math.round(H * d); }
function enterCanvas() {
  const probe = document.createElement('canvas'), pgl = probe.getContext('webgl2');
  if (!pgl || !('onpaint' in probe) || !(typeof pgl.texElementImage2D === 'function' || typeof pgl.texElementSubImage2D === 'function')) return false;
  glass = document.createElement('canvas'); glass.id = 'glass'; glass.setAttribute('layoutsubtree', ''); glass.setAttribute('content', 'drawable');
  gl = glass.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) { glass = null; return false; }
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){ vec2 v = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(v*2.0 - 1.0, 0.0, 1.0); }'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl = null; glass = null; return false; }
  gl.useProgram(prog);
  for (const n of ['uTex', 'uRes', 'uDpr', 'uTime', 'uRoom', 'uMass', 'uHouse', 'uWell', 'uLamp', 'uLampCol', 'uBand']) U[n] = gl.getUniformLocation(prog, n);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  stage.appendChild(glass); glass.appendChild(page); page.setAttribute('drawable', '');
  if ('layoutSubtree' in glass) glass.layoutSubtree = true;
  document.documentElement.classList.add('enhanced'); wellfx.style.display = 'none'; dark.style.display = 'none';
  sizeGlass(); tier = 'canvas';
  try { if (glass.updateElementGeometry) glass.updateElementGeometry(page, { canvasTransform: new DOMMatrix() }); } catch (err) { /* older builds place children themselves */ }
  glass.addEventListener('webglcontextlost', e => { e.preventDefault(); leaveCanvas(); });
  glass.onpaint = paint; glass.requestPaint();
  setTimeout(() => { if (tier === 'canvas' && !painted) leaveCanvas(); }, 1500); // nothing drew: give the page back
  return true;
}
function leaveCanvas() { // back to ordinary HTML, with the page exactly where it was
  if (tier !== 'canvas') return;
  tier = 'html'; glass.onpaint = null; page.removeAttribute('drawable'); stage.appendChild(page); glass.remove(); gl = null; glass = null;
  document.documentElement.classList.remove('enhanced'); wellfx.style.display = ''; dark.style.display = '';
  announceTier(); measure(); placeLamps(); dirty = true;
}
function announceTier() {
  $('tier').textContent = tier === 'canvas' ? 'HTML-in-Canvas: on. The page itself is bending.' : 'Plain HTML version: this browser has no HTML-in-Canvas.';
}

// ---- Loop -----------------------------------------------------------------------------------------------------------------
let last = null;
function frame(now) {
  const dt = last === null ? 0 : clamp((now - last) / 1000, 0, 0.05); last = now; // a frame stamp can precede the script's own clock
  if (!document.hidden) {
    const moving = !reduced && room === 'undertow';
    if (moving) { time += dt; stepUndertow(dt); }
    if (moving || dirty) {
      dirty = false;
      if (reduced && room === 'undertow') still();
      if (tier === 'canvas') glass.requestPaint(); else { drawWell2D(); drawDark(); }
    }
  }
  requestAnimationFrame(frame);
}

// ---- Wiring -----------------------------------------------------------------------------------------------------------------
document.querySelectorAll('.rooms a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); setRoom(a.dataset.room); }));
addEventListener('hashchange', () => setRoom(location.hash.slice(1), true));
$('mass').addEventListener('input', e => { well.mass = Number(e.target.value) / 100; dirty = true; });
$('feed').addEventListener('click', () => setFeeding(!feeding));
$('restore').addEventListener('click', restore);
$('wellkey').addEventListener('keydown', e => { const s = e.shiftKey ? 96 : 24, k = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key]; if (!k) return; e.preventDefault(); well.tx = clamp(well.tx + k[0], 0, W); well.ty = clamp(well.ty + k[1], 0, H); dirty = true; });
page.addEventListener('pointerdown', e => { if (room !== 'undertow' || e.button > 0 || e.target.closest('a,button,input,label')) return; e.preventDefault(); dragging = true; page.setPointerCapture(e.pointerId); well.tx = e.clientX; well.ty = e.clientY; dirty = true; });
page.addEventListener('pointermove', e => { if (!dragging) return; well.tx = clamp(e.clientX, 0, W); well.ty = clamp(e.clientY, 0, H); dirty = true; });
for (const ev of ['pointerup', 'pointercancel']) page.addEventListener(ev, () => { dragging = false; });
$('lamp-bright').addEventListener('input', e => { lamps[selected].b = Number(e.target.value) / 100; placeLamps(); });
$('lamp-warm').addEventListener('input', e => { lamps[selected].w = Number(e.target.value) / 100; placeLamps(); });
$('house').addEventListener('input', e => { house = Number(e.target.value) / 100; dirty = true; });
$('about-open').addEventListener('click', () => $('about').showModal());
$('about-close').addEventListener('click', () => $('about').close());
addEventListener('resize', () => { const fx = well.tx / W, fy = well.ty / H; W = innerWidth; H = innerHeight; well.tx = well.x = fx * W; well.ty = well.y = fy * H; sizeGlass(); measure(); placeLamps(); });
document.fonts && document.fonts.ready.then(() => { measure(); placeLamps(); });

// ---- Go -------------------------------------------------------------------------------------------------------------------------
if (small) { well.tx = well.x = W * 0.8; well.ty = well.y = H * 0.5; Object.assign(lamps[0], { x: 0.3, y: 0.17 }); Object.assign(lamps[1], { x: 0.72, y: 0.42 }); Object.assign(lamps[2], { x: 0.36, y: 0.62 }); house = 0.15; $('house').value = 15; }
const forcePlain = new URLSearchParams(location.search).has('plain'); // lets anyone compare the two versions
if (!forcePlain) enterCanvas();
announceTier(); select(0);
setRoom(location.hash.slice(1) || 'undertow', true);
requestAnimationFrame(frame);

window.__afterHours = {
  get tier() { return tier; }, get room() { return room; }, get framesReady() { return framesReady; }, get painted() { return painted; }, get uploadForm() { return uploadForm; },
  setRoom, setFeeding, restore, lamps, well,
  setWell(x, y) { well.tx = well.x = x; well.ty = well.y = y; dirty = true; },
  bodies: () => bodies.filter(b => b.vis).map(b => ({ text: b.el.textContent.trim().slice(0, 12), mode: b.mode, a: +b.a.toFixed(2), x: Math.round(b.x), y: Math.round(b.y) })),
};
