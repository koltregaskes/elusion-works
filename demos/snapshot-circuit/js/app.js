// Snapshot Circuit: the page. photo.js reads the picture, track.js lays the road, game.js runs the race;
// this file draws it, listens to the controls and makes the noises.
import * as THREE from 'three';
import { analyse } from './photo.js';
import { buildTrack, heading, normal, toPhoto, WORLD_W, HALF, LAPS } from './track.js';
import { newRace, step, standings, autopilot, rescue, DT } from './game.js';

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(pointer: coarse)').matches;
const small = touch || matchMedia('(max-width: 760px)').matches;
if (touch) document.documentElement.classList.add('touch');
const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const ORD = ['1st', '2nd', '3rd', '4th'];
const SAMPLE = { src: 'img/caps.jpg', key: 'caps', credit: 'Sample photograph: image 3 of the Kodak Lossless True Color Image Suite, released by Eastman Kodak for unrestricted use.' };

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas: $('stage'), antialias: true, powerPreference: 'high-performance' }); }
catch (err) { $('fallback').style.display = 'grid'; throw err; }
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0c0e10);
const camera = new THREE.PerspectiveCamera(58, 1, 0.5, 600);
scene.add(new THREE.HemisphereLight(0xffffff, 0x555566, 1.6)); const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(30, 60, 20); scene.add(sun);
const world = new THREE.Group(); scene.add(world);

// ---- State ----------------------------------------------------------------------------------
let photo = null, analysis = null, track = null, race = null, mode = 'menu', photoKey = SAMPLE.key, topView = reduced, paused = false, auto = false, soundOn = true;
let cutouts = [], tokens = [], kartMeshes = [], mapBase = null, sayTimer = 0;
const keys = { left: false, right: false, up: false, down: false };

// ---- Building the scene from a photograph -----------------------------------------------------------
function cutoutTexture(blob) { // the object, cut out of the photograph with a white sticker edge
  const W = photo.width, H = photo.height, x0 = Math.floor(blob.x0 * W), y0 = Math.floor(blob.y0 * H), sw = Math.max(2, Math.ceil((blob.x1 - blob.x0) * W)), sh = Math.max(2, Math.ceil((blob.y1 - blob.y0) * H));
  const k = 320 / Math.max(sw, sh), w = Math.round(sw * k), h = Math.round(sh * k), pad = 12; // drawn large, so the edge is a curve and not a staircase
  const aw = analysis.width, ah = analysis.height, mx0 = Math.round(blob.x0 * aw), my0 = Math.round(blob.y0 * ah), mw = Math.max(1, Math.round((blob.x1 - blob.x0) * aw)), mh = Math.max(1, Math.round((blob.y1 - blob.y0) * ah));
  const m = document.createElement('canvas'); m.width = mw; m.height = mh; const mg = m.getContext('2d'), md = mg.createImageData(mw, mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) { const on = analysis.labels[(my0 + y) * aw + mx0 + x] === blob.id; md.data.set([255, 255, 255, on ? 255 : 0], (y * mw + x) * 4); }
  mg.putImageData(md, 0, 0);
  const soft = document.createElement('canvas'); soft.width = w + pad * 2; soft.height = h + pad * 2; const sg = soft.getContext('2d'); sg.filter = `blur(${Math.max(2, Math.round(w / mw * 0.7))}px)`; sg.drawImage(m, pad, pad, w, h); sg.filter = 'none';
  const hard = sg.getImageData(0, 0, soft.width, soft.height); for (let q = 3; q < hard.data.length; q += 4) hard.data[q] = hard.data[q] > 110 ? 255 : 0; sg.putImageData(hard, 0, 0); // the blurred outline, made crisp again
  const cut = document.createElement('canvas'); cut.width = soft.width; cut.height = soft.height; const cg = cut.getContext('2d'); cg.imageSmoothingQuality = 'high'; cg.drawImage(photo, x0, y0, sw, sh, pad, pad, w, h); cg.globalCompositeOperation = 'destination-in'; cg.drawImage(soft, 0, 0);
  const out = document.createElement('canvas'); out.width = soft.width; out.height = soft.height; const g = out.getContext('2d');
  for (let a = 0; a < 20; a++) g.drawImage(soft, Math.cos(a / 20 * 6.283) * pad * 0.6, Math.sin(a / 20 * 6.283) * pad * 0.6); // white edge
  g.drawImage(cut, 0, 0);
  const tex = new THREE.CanvasTexture(out); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return { tex, scale: out.width / w };
}
function kartMesh(colour) {
  const g = new THREE.Group(), body = new THREE.MeshLambertMaterial({ color: colour }), dark = new THREE.MeshLambertMaterial({ color: 0x1b1e22 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.BoxGeometry(2.5, 0.45, 1.4), body, 0, 0.55, 0); add(new THREE.BoxGeometry(0.9, 0.3, 0.9), body, 1.35, 0.45, 0); add(new THREE.BoxGeometry(0.2, 0.12, 1.9), body, 1.75, 0.4, 0); // body, nose, front wing
  add(new THREE.BoxGeometry(0.3, 0.6, 0.9), dark, -0.75, 1.0, 0); add(new THREE.BoxGeometry(0.34, 0.1, 1.9), body, -1.3, 1.3, 0); // seat back, rear wing
  for (const z of [0.6, -0.6]) add(new THREE.BoxGeometry(0.12, 0.5, 0.1), dark, -1.3, 1.02, z);
  add(new THREE.SphereGeometry(0.4, 14, 10), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }), -0.3, 1.2, 0); // the driver's helmet
  for (const [x, z] of [[0.9, 0.85], [0.9, -0.85], [-0.9, 0.85], [-0.9, -0.85]]) { const w = add(new THREE.CylinderGeometry(0.42, 0.42, 0.36, 14), dark, x, 0.42, z); w.rotation.x = Math.PI / 2; }
  return g;
}
function buildScene() {
  world.clear(); cutouts = []; tokens = []; kartMeshes = [];
  const H = track.H, GW = small ? 2048 : 4096, GH = Math.round(GW * H / WORLD_W), u = GW / WORLD_W; // one picture for the ground: the photograph with the road painted on it
  const gc = document.createElement('canvas'); gc.width = GW; gc.height = GH; const g2 = gc.getContext('2d'); g2.imageSmoothingQuality = 'high'; g2.drawImage(photo, 0, 0, GW, GH);
  const path = () => { g2.beginPath(); track.pts.forEach((p, i) => { const x = (p[0] + WORLD_W / 2) * u, y = (p[1] + H / 2) * u; if (i) g2.lineTo(x, y); else g2.moveTo(x, y); }); g2.closePath(); };
  g2.lineJoin = 'round'; g2.lineCap = 'butt';
  path(); g2.strokeStyle = 'rgba(255,255,255,.95)'; g2.lineWidth = (HALF * 2 + 0.9) * u; g2.stroke(); // white edges
  { const road = document.createElement('canvas'); road.width = GW; road.height = GH; const rg = road.getContext('2d'); rg.imageSmoothingQuality = 'high'; rg.drawImage(photo, 0, 0, GW, GH); rg.fillStyle = 'rgba(14,16,18,.56)'; rg.fillRect(0, 0, GW, GH); // the road: the photograph, darkened
    g2.save(); path(); g2.lineWidth = HALF * 2 * u; g2.strokeStyle = g2.createPattern(road, 'no-repeat'); g2.stroke(); g2.restore(); }
  path(); g2.setLineDash([2.2 * u, 3.4 * u]); g2.strokeStyle = 'rgba(255,255,255,.6)'; g2.lineWidth = 0.28 * u; g2.stroke(); g2.setLineDash([]);
  { const p = track.pts[track.start], a = heading(track, track.start), sq = HALF * 2 / 8; g2.save(); g2.translate((p[0] + WORLD_W / 2) * u, (p[1] + H / 2) * u); g2.rotate(a); // the start line
    for (let r = 0; r < 2; r++) for (let c = 0; c < 8; c++) { g2.fillStyle = (r + c) % 2 ? '#111' : '#fff'; g2.fillRect((r - 1) * sq * u, (c - 4) * sq * u, sq * u + 0.5, sq * u + 0.5); } g2.restore(); }
  const tex = new THREE.CanvasTexture(gc); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const table = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W + 60, H + 60), new THREE.MeshBasicMaterial({ color: 0x17191c })); table.rotation.x = -Math.PI / 2; table.position.y = -0.05; world.add(table);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, H), new THREE.MeshBasicMaterial({ map: tex })); ground.rotation.x = -Math.PI / 2; world.add(ground);
  const flat = o => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, ...o });
  for (const hz of track.hazards) { // each object stands up from where it lies in the picture
    const blob = analysis.blobs[hz.blob], { tex: ct, scale } = cutoutTexture(blob), k = Math.min(0.5, 7 / hz.h), w = hz.w * scale * k, h = hz.h * scale * k; // smaller than life, so it never hides the road
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: ct, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide })); m.position.set(hz.x, h / 2, hz.z); world.add(m); cutouts.push(m);
    const sh = new THREE.Mesh(new THREE.CircleGeometry(1, 28), flat({ color: 0x000000, opacity: 0.38 })); sh.rotation.x = -Math.PI / 2; sh.scale.set(hz.r, hz.r, 1); sh.position.set(hz.x, 0.08, hz.z); sh.renderOrder = 4; world.add(sh);
  }
  for (const p of track.pickups) { const col = new THREE.Color(p.colour[0] / 255, p.colour[1] / 255, p.colour[2] / 255).lerp(new THREE.Color(1, 1, 1), 0.25), t = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.22, 24), new THREE.MeshBasicMaterial({ color: col })); disc.rotation.x = Math.PI / 2; const rim = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.12, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffffff })); t.add(disc, rim); t.position.set(p.x, 1.5, p.z); world.add(t); tokens.push(t);
    const mark = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.5, 28), flat({ color: col, opacity: 0.9 })); mark.rotation.x = -Math.PI / 2; mark.position.set(p.x, 0.09, p.z); mark.renderOrder = 4; world.add(mark); t.userData.mark = mark; } // a ring on the road, so a boost shows from above too
  for (const colour of [0x3fe08a, 0xffb347, 0x6aa9ff]) { const k = kartMesh(colour); world.add(k); kartMeshes.push(k); }
  // The map: the photograph itself, with the road drawn on it.
  mapBase = document.createElement('canvas'); mapBase.width = 336; mapBase.height = Math.round(336 * H / WORLD_W); const g = mapBase.getContext('2d'); g.drawImage(photo, 0, 0, mapBase.width, mapBase.height); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, mapBase.width, mapBase.height);
  g.lineJoin = 'round'; g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 5; g.beginPath(); track.pts.forEach((p, i) => { const [u, v] = toPhoto(p[0], p[1], H); if (i) g.lineTo(u * mapBase.width, v * mapBase.height); else g.moveTo(u * mapBase.width, v * mapBase.height); }); g.closePath(); g.stroke();
  $('map').height = mapBase.height;
}
function showFound() { // the start card: what was found in the picture
  const c = $('found'), g = c.getContext('2d'); c.height = Math.round(c.width * photo.height / photo.width); g.drawImage(photo, 0, 0, c.width, c.height); g.font = '700 22px ui-monospace, Menlo, Consolas, monospace'; g.textBaseline = 'middle'; g.textAlign = 'center';
  const items = analysis.blobs.map((b, i) => {
    const haz = track.hazards.some(h => h.blob === b.id), x = b.x0 * c.width, y = b.y0 * c.height, w = (b.x1 - b.x0) * c.width, h = (b.y1 - b.y0) * c.height;
    g.lineWidth = 4; g.strokeStyle = haz ? '#fff' : '#3fe08a'; g.strokeRect(x, y, w, h); g.fillStyle = '#111'; g.fillRect(b.x * c.width - 15, b.y * c.height - 15, 30, 30); g.fillStyle = '#fff'; g.fillText(String(i + 1), b.x * c.width, b.y * c.height + 1);
    const li = document.createElement('li'), sw = document.createElement('i'), num = document.createElement('b'); sw.style.background = `rgb(${b.colour})`; num.textContent = i + 1; li.append(num, sw, document.createTextNode(`${b.name[0].toUpperCase() + b.name.slice(1)} object: ${haz ? 'a hazard to drive round' : 'a boost to pick up'}`)); return li;
  });
  if (!items.length) { const li = document.createElement('li'); li.textContent = 'Nothing stood out in this picture, so the road runs a plain loop with boosts on it.'; items.push(li); }
  $('objects').replaceChildren(...items);
  const how = analysis.method === 'detail' ? 'No strong colours stood out, so the busiest patches were used instead. ' : '';
  $('credit').textContent = how + (photoKey === SAMPLE.key ? SAMPLE.credit : 'Your photograph. It stays on this device and is not uploaded.');
  $('sample').hidden = photoKey === SAMPLE.key;
}
async function usePhoto(source, key) { // source: anything a canvas can draw (an image, a bitmap, another canvas)
  const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height; if (!sw || !sh) throw new Error('That picture has no size');
  const k = Math.min(1, 1024 / Math.max(sw, sh)), c = document.createElement('canvas'); c.width = Math.max(64, Math.round(sw * k)); c.height = Math.max(64, Math.round(sh * k));
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(source, 0, 0, c.width, c.height);
  const a = analyse(g.getImageData(0, 0, c.width, c.height)), t = buildTrack(a); // both can throw; nothing changes unless both work
  photo = c; analysis = a; track = t; photoKey = key; buildScene(); showFound(); toMenu();
}

// ---- Sound: small synthesised noises, started by the Start button ----------------------------------------
const audio = (() => {
  let ctx = null, engine = null, eg = null;
  const tone = (f, d, type = 'sine', v = 0.12, to = f) => { if (!ctx || !soundOn) return; const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime; o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(to, t + d); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d); o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + d + 0.02); };
  return {
    start() { if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); engine = ctx.createOscillator(); engine.type = 'sawtooth'; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520; eg = ctx.createGain(); eg.gain.value = 0; engine.connect(f).connect(eg).connect(ctx.destination); engine.start(); } if (ctx.state !== 'running') ctx.resume(); },
    engine(v, on) { if (!ctx) return; eg.gain.setTargetAtTime(on && soundOn ? 0.035 : 0, ctx.currentTime, 0.05); engine.frequency.setTargetAtTime(55 + Math.abs(v) * 4.2, ctx.currentTime, 0.05); },
    beep: hi => tone(hi ? 880 : 440, hi ? 0.5 : 0.18, 'square', 0.07), bump: () => tone(120, 0.22, 'triangle', 0.3, 45), pick: () => { tone(660, 0.12, 'sine', 0.12); setTimeout(() => tone(990, 0.2, 'sine', 0.12), 90); }, lap: () => { tone(784, 0.25, 'sine', 0.14); setTimeout(() => tone(1175, 0.4, 'sine', 0.12), 160); },
  };
})();

// ---- Screens ------------------------------------------------------------------------------------------------
function say(text, ms = 2200) { $('say').textContent = text; clearTimeout(sayTimer); sayTimer = setTimeout(() => { $('say').textContent = ''; }, ms); }
function hud(show) { for (const id of ['status', 'tools', 'speed']) $(id).hidden = !show; for (const p of document.querySelectorAll('.pads')) p.hidden = !show; }
function toMenu() { mode = 'menu'; clearTimeout(sayTimer); $('say').textContent = ''; race = newRace(track); paused = false; $('start').hidden = false; $('finish').hidden = true; hud(false); $('count').textContent = ''; audio.engine(0, false); $('go').focus({ preventScroll: true }); }
function startRace() { audio.start(); race = newRace(track); mode = 'race'; paused = false; lastCount = 4; $('pause').setAttribute('aria-pressed', 'false'); $('start').hidden = true; $('finish').hidden = true; hud(true); $('stage').focus(); }
function finishRace() {
  mode = 'done'; const me = race.karts[0], place = race.order.indexOf(0), bestLap = Math.min(...me.laps); let best = null;
  if (photoKey === SAMPLE.key) { try { best = Number(localStorage.getItem('snapshot-circuit:best')) || null; if (!best || me.time < best) { best = me.time; localStorage.setItem('snapshot-circuit:best', String(best)); } } catch (err) { best = me.time; } }
  $('finish-h').textContent = `You finished ${ORD[place]}`; $('r-time').textContent = fmt(me.time); $('r-lap').textContent = fmt(bestLap); $('r-best').textContent = best ? fmt(best) : 'Not kept';
  $('finish').hidden = false; hud(false); clearTimeout(sayTimer); $('say').textContent = ''; audio.engine(0, false); $('again').focus({ preventScroll: true });
}

// ---- The frame loop: fixed steps for the race, one draw a frame ------------------------------------------------
let last = null, acc = 0, lastCount = 4, camPos = new THREE.Vector3(0, 60, 60), camLook = new THREE.Vector3();
function input() { if (auto) return autopilot(race, race.karts[0]); const steer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0); return { steer, throttle: keys.up || (touch && !keys.down) ? 1 : 0, brake: keys.down ? 1 : 0 }; }
function advance() {
  step(race, input());
  for (const e of race.events) {
    if (e.type === 'go') { $('count').textContent = 'Go'; setTimeout(() => { if ($('count').textContent === 'Go') $('count').textContent = ''; }, 700); audio.beep(true); }
    else if (e.kart !== 0) continue;
    else if (e.type === 'bump') { const hz = track.hazards.find(h => h.blob === e.hazard); say(`Hit the ${hz ? hz.name : ''} object`, 1400); audio.bump(); }
    else if (e.type === 'pickup') { say('Boost', 1000); audio.pick(); }
    else if (e.type === 'lap' && e.lap < LAPS) { say(`Lap ${e.lap} in ${fmt(e.time)}`); audio.lap(); }
    else if (e.type === 'finish') { audio.lap(); finishRace(); }
  }
  if (!race.go) { const c = Math.ceil(race.countdown); if (c !== lastCount && c >= 1 && c <= 3) { lastCount = c; $('count').textContent = String(c); audio.beep(false); } }
}
function draw(dt) {
  const me = race.karts[0];
  race.karts.forEach((k, i) => { const m = kartMeshes[i]; m.position.set(k.x, 0, k.z); m.rotation.y = -k.h; });
  tokens.forEach((t, i) => { t.visible = t.userData.mark.visible = race.picks[i] <= 0; t.rotation.y += dt * 3; });
  if (topView || mode === 'menu') { const d = Math.max(track.H * 0.78, (WORLD_W * 0.78) / camera.aspect) / Math.tan(camera.fov * Math.PI / 360); camPos.set(0, d * 0.94, d * 0.32); camLook.set(0, 0, 0); camera.position.copy(camPos); }
  else { const fx = Math.cos(me.h), fz = Math.sin(me.h), want = new THREE.Vector3(me.x - fx * 9.5, 5.4 + me.boost * 0.6, me.z - fz * 9.5), jump = reduced || camPos.distanceTo(want) > 30; // a cut, not a swoop, when the kart is suddenly somewhere else
    camPos.lerp(want, jump ? 1 : 1 - Math.exp(-dt * 9)); camLook.lerp(new THREE.Vector3(me.x + fx * 7, 1, me.z + fz * 7), jump ? 1 : 1 - Math.exp(-dt * 13)); camera.position.copy(camPos); if (me.bump > 0 && !reduced) camera.position.y += Math.sin(me.bump * 60) * 0.12; }
  camera.lookAt(camLook);
  for (const c of cutouts) { c.visible = !(topView || mode === 'menu'); const dx = camera.position.x - c.position.x, dz = camera.position.z - c.position.z; c.rotation.y = Math.atan2(dx, dz); c.material.opacity = Math.min(1, Math.max(0.28, (Math.hypot(dx, dz) - 7) / 9)); } // an object right beside the camera thins out, so it never hides the road
  renderer.render(scene, camera);
  if (mode === 'menu') return;
  $('lap').textContent = `${Math.min(LAPS, me.lap + 1)}/${LAPS}`; $('place').textContent = ORD[standings(race).indexOf(0)]; $('time').textContent = fmt(race.t);
  $('speedbar').style.width = Math.min(100, Math.abs(me.v) / 45 * 100) + '%'; $('speed').classList.toggle('boost', me.boost > 0);
  const mc = $('map'), g = mc.getContext('2d'); g.drawImage(mapBase, 0, 0);
  race.karts.forEach((k, i) => { const [u, v] = toPhoto(k.x, k.z, track.H); g.fillStyle = ['#3fe08a', '#ffb347', '#6aa9ff'][i]; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.arc(u * mc.width, v * mc.height, i ? 6 : 8, 0, 7); g.fill(); g.stroke(); });
  audio.engine(me.v, mode === 'race' && race.go && !paused);
}
function frame(now) {
  const dt = last === null ? 0 : Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
  if (mode === 'race' && !paused && !document.hidden) { acc += dt; let n = 0; while (acc >= DT && n < 6 && mode === 'race') { advance(); acc -= DT; n++; } if (n === 6) acc = 0; }
  if (track) draw(dt);
  requestAnimationFrame(frame);
}
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 76 : 58; /* a tall screen needs a wider look ahead */ camera.updateProjectionMatrix(); }
addEventListener('resize', resize);

// ---- Controls -------------------------------------------------------------------------------------------------------
const KEYMAP = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down' };
function setPaused(on) { if (mode !== 'race') return; paused = on; $('pause').setAttribute('aria-pressed', String(on)); $('pause').textContent = on ? 'Resume' : 'Pause'; if (on) say('Paused', 60000); else $('say').textContent = ''; }
function setTop(on) { topView = on; $('cam').setAttribute('aria-pressed', String(on)); }
function setSound(on) { soundOn = on; $('sound').setAttribute('aria-pressed', String(on)); try { localStorage.setItem('snapshot-circuit:sound', on ? '1' : '0'); } catch (err) { /* fine without */ } }
function backOnRoad() { if (mode === 'race' && race.go) { rescue(race, race.karts[0]); say('Back on the road', 1000); } }
addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, tag = e.target.tagName;
  if (KEYMAP[k] && mode === 'race') { keys[KEYMAP[k]] = true; e.preventDefault(); return; }
  if (tag === 'BUTTON' || tag === 'INPUT') return;
  if (k === 'c') setTop(!topView); else if (k === 'm') setSound(!soundOn); else if (k === 'p' || k === 'Escape') setPaused(!paused); else if (k === 'r') backOnRoad(); else if (k === 'Enter' && mode !== 'race') startRace();
});
addEventListener('keyup', e => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; if (KEYMAP[k]) keys[KEYMAP[k]] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
for (const [id, key] of [['pad-left', 'left'], ['pad-right', 'right'], ['pad-brake', 'down']]) { const b = $(id), set = on => { keys[key] = on; b.classList.toggle('down', on); };
  b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* still works without capture */ } set(true); }); for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => set(false));
  b.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); set(true); } }); b.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') set(false); }); b.addEventListener('contextmenu', e => e.preventDefault()); }
$('go').addEventListener('click', startRace); $('again').addEventListener('click', startRace); $('menu').addEventListener('click', toMenu);
$('cam').addEventListener('click', () => setTop(!topView)); $('sound').addEventListener('click', () => setSound(!soundOn)); $('pause').addEventListener('click', () => setPaused(!paused)); $('rescue').addEventListener('click', backOnRoad);
$('own').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; let url; try { url = URL.createObjectURL(f); const im = new Image(); im.src = url; await im.decode(); await usePhoto(im, 'own'); say('A new circuit from your photograph', 2600); } catch (err) { say('That file could not be read as a picture.', 3200); } finally { if (url) URL.revokeObjectURL(url); } });
$('sample').addEventListener('click', loadSample);
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'race' && race.go) setPaused(true); });
async function loadSample() { const im = new Image(); im.src = SAMPLE.src; await im.decode(); await usePhoto(im, SAMPLE.key); }

// ---- Go ---------------------------------------------------------------------------------------------------------------
try { soundOn = localStorage.getItem('snapshot-circuit:sound') !== '0'; } catch (err) { /* default on */ }
$('sound').setAttribute('aria-pressed', String(soundOn)); setTop(topView); resize(); hud(false);
window.snapshotCircuit = { // for the automated checks
  ready: loadSample().then(() => { requestAnimationFrame(frame); return true; }),
  state: () => ({ mode, paused, topView, soundOn, photoKey, method: analysis.method, t: race.t, go: race.go, lap: race.karts[0].lap, place: standings(race).indexOf(0) + 1, v: race.karts[0].v, done: race.karts.map(k => k.done), order: [...race.order],
    blobs: analysis.blobs.map(b => ({ x: b.x, y: b.y, name: b.name, role: b.role })), hazards: track.hazards.map(h => ({ x: h.x, z: h.z, r: h.r, photo: toPhoto(h.x, h.z, track.H) })), pickups: track.pickups.length, length: track.length }),
  start: startRace, autopilot: on => { auto = on; }, usePhoto,
  fast(n) { let i = 0; for (; i < n && mode === 'race'; i++) advance(); return i; }, // run the race ahead without waiting for frames
  place(x, z, h, v) { const k = race.karts[0]; Object.assign(k, { x, z, h, v }); },
  kart() { const k = race.karts[0], c = track.pts[k.i]; return { x: k.x, z: k.z, h: k.h, v: k.v, offCentre: Math.hypot(c[0] - k.x, c[1] - k.z) }; },
};
