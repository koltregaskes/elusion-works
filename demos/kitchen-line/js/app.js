// Kitchen Line: the page. rules.js plays the game; this file draws it, listens to the controls, keeps the scoreboard and makes the sounds.
import * as THREE from 'three';
import * as R from './rules.js';

const $ = id => document.getElementById(id);
const less = matchMedia('(prefers-reduced-motion: reduce)');
const STEP = 1 / 60, C = R.COURT;

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas: $('court'), antialias: true, powerPreference: 'high-performance' }); }
catch (err) { $('fallback').style.display = 'grid'; for (const id of ['court', 'start', 'board', 'tools', 'shots', 'hint', 'call']) $(id).hidden = true; throw err; }
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x111315); scene.fog = new THREE.Fog(0x111315, 30, 62);
const eye = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
scene.add(new THREE.HemisphereLight(0xffffff, 0x30383c, 1.5)); { const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-6, 14, 9); scene.add(sun); }

/* ---- Things drawn ---- */
/* Three flat tones and a dark outline: a comic-book look. */
const tones = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1); tones.minFilter = tones.magFilter = THREE.NearestFilter; tones.needsUpdate = true;
const toon = color => new THREE.MeshToonMaterial({ color, gradientMap: tones }), ink = new THREE.MeshBasicMaterial({ color: 0x0b0c0d, side: THREE.BackSide });
function part(geo, mat, pos, into, grow = 1.07) { const mesh = new THREE.Mesh(geo, mat); mesh.position.set(...pos); const edge = new THREE.Mesh(geo, ink); edge.scale.setScalar(grow); mesh.add(edge); into.add(mesh); return mesh; }
function drawn(w, h, paint) { const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

/* The court, painted to measure: 64 pixels to the metre, 14 by 26 metres of ground. */
{ const PX = 64, GW = 14, GL = 26, tex = drawn(GW * PX, GL * PX, (g, w, h) => { const X = x => (x + GW / 2) * PX, Z = z => (z + GL / 2) * PX; g.fillStyle = '#14171a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.035)'; g.lineWidth = 1; for (let i = 0; i <= GW; i++) { g.beginPath(); g.moveTo(i * PX, 0); g.lineTo(i * PX, h); g.stroke(); } for (let i = 0; i <= GL; i++) { g.beginPath(); g.moveTo(0, i * PX); g.lineTo(w, i * PX); g.stroke(); }
    g.fillStyle = '#1a5f45'; g.fillRect(X(-C.halfW), Z(-C.halfL), C.halfW * 2 * PX, C.halfL * 2 * PX); g.fillStyle = '#27855f'; g.fillRect(X(-C.halfW), Z(-C.kitchen), C.halfW * 2 * PX, C.kitchen * 2 * PX);
    g.strokeStyle = '#f4f5f3'; g.lineWidth = 4; g.strokeRect(X(-C.halfW), Z(-C.halfL), C.halfW * 2 * PX, C.halfL * 2 * PX); for (const z of [-C.kitchen, C.kitchen]) { g.beginPath(); g.moveTo(X(-C.halfW), Z(z)); g.lineTo(X(C.halfW), Z(z)); g.stroke(); }
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(X(0), Z(s * C.kitchen)); g.lineTo(X(0), Z(s * C.halfL)); g.stroke(); } });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GW, GL), new THREE.MeshBasicMaterial({ map: tex })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const far = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshBasicMaterial({ color: 0x14171a })); far.rotation.x = -Math.PI / 2; far.position.y = -0.01; scene.add(far); }
/* The net: lower in the middle than at the posts, as the rules have it. */
{ const geo = new THREE.PlaneGeometry(C.postX * 2, 1, 16, 1), at = geo.attributes.position; for (let i = 0; i < at.count; i++) at.setY(i, at.getY(i) > 0 ? R.netHeight(at.getX(i)) : 0.04); geo.computeVertexNormals();
  const tex = drawn(512, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(10,12,13,.42)'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(244,245,243,.3)'; g.lineWidth = 1; for (let x = 0; x <= w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (let y = 0; y <= h; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } g.fillStyle = '#f4f5f3'; g.fillRect(0, 0, w, 7); });
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }))); for (const s of [-1, 1]) part(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 12), toon(0x3a4146), [s * C.postX, 0.5, 0], scene, 1.25); }
/* A player: two legs that run, a body with shoulders and a neck, a head in a cap, and an arm that swings a paddle from the shoulder. Built facing the net from your end; the rival is turned round. */
function makePlayer(shirt, cap) { const g = new THREE.Group(), body = new THREE.Group(); g.add(body); const skin = toon(0xf1c9a5), dark = toon(0x23272b), top = toon(shirt), hat = toon(cap), legs = [];
  for (const s of [-1, 1]) { const leg = new THREE.Group(); leg.position.set(s * 0.11, 0.76, 0); body.add(leg); part(new THREE.CapsuleGeometry(0.08, 0.5, 4, 10), dark, [0, -0.34, 0], leg); const shoe = part(new THREE.SphereGeometry(0.09, 12, 8), toon(0xdfe4e7), [0, -0.68, -0.05], leg, 1.1); shoe.scale.set(1, 0.7, 1.6); legs.push(leg); }
  part(new THREE.CapsuleGeometry(0.2, 0.4, 4, 14), top, [0, 1.08, 0], body); for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.1, 12, 10), top, [s * 0.25, 1.32, 0], body, 1.1); part(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10), skin, [0, 1.48, 0], body, 1.12);
  part(new THREE.SphereGeometry(0.15, 18, 14), skin, [0, 1.62, 0], body); part(new THREE.SphereGeometry(0.158, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), hat, [0, 1.65, 0], body, 1.04); part(new THREE.CylinderGeometry(0.135, 0.135, 0.02, 20), hat, [0, 1.655, -0.13], body, 1.08); /* the brim: a disc under the front of the cap, which reads as a cap from above as well as from behind */
  const arm = new THREE.Group(); arm.position.set(0.27, 1.32, 0); body.add(arm); part(new THREE.CapsuleGeometry(0.052, 0.4, 4, 8), skin, [0, -0.25, 0], arm); part(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8), dark, [0, -0.56, 0], arm, 1.3);
  const face = part(new THREE.CylinderGeometry(0.125, 0.125, 0.022, 24), hat, [0, -0.78, 0], arm, 1.1); face.rotation.x = Math.PI / 2; face.scale.set(1, 1, 1.35); const off = new THREE.Group(); off.position.set(-0.27, 1.32, 0); body.add(off); part(new THREE.CapsuleGeometry(0.052, 0.4, 4, 8), skin, [0, -0.25, 0], off);
  const shade = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })); shade.rotation.x = -Math.PI / 2; shade.position.y = 0.012; g.add(shade); g.scale.setScalar(1.1); scene.add(g);
  return { g, body, arm, off, legs, run: 0, kind: 'drive', wound: 0, thru: 0, ax: 0.45, az: 0.3, turn: 0, lunge: { x: 0, z: 0 }, lungeT: 0 }; }
const figure = { p: makePlayer(0xf4f5f3, 0x3fe08a), r: makePlayer(0xff7a6d, 0x23272b) }; figure.r.g.rotation.y = Math.PI;
/* The wall behind the far baseline: charcoal, the game's name in white, one green line. */
{ const tex = drawn(2048, 384, (g, w, h) => { g.fillStyle = '#171a1d'; g.fillRect(0, 0, w, h); g.fillStyle = '#f4f5f3'; g.font = 'italic 900 150px "Helvetica Neue", "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('KITCHEN  LINE', w / 2, 96); g.fillStyle = '#3fe08a'; g.fillRect(w / 2 - 470, 178, 940, 10); g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, h - 6, w, 6); });
  const wall = new THREE.Group(); wall.add(new THREE.Mesh(new THREE.PlaneGeometry(17, 3.2), new THREE.MeshBasicMaterial({ map: tex }))); wall.position.set(0, 1.6, -10.4); scene.add(wall); for (const s of [-1, 1]) part(new THREE.CylinderGeometry(0.07, 0.07, 3.3, 10), toon(0x3a4146), [s * 8.5, 0.05, 0], wall, 1.2); scene.userData.wall = wall; }
/* The ball is drawn at twice its real size so that it can be seen from the back of the court; the game uses the real one. */
const ball = new THREE.Group(); part(new THREE.SphereGeometry(0.085, 20, 14), toon(0xe8ff4a), [0, 0, 0], ball, 1.16); scene.add(ball);
const ballShade = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })); ballShade.rotation.x = -Math.PI / 2; scene.add(ballShade);
const mark = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.27, 36), new THREE.MeshBasicMaterial({ color: 0xf4f5f3, transparent: true, opacity: 0.75 })); mark.rotation.x = -Math.PI / 2; mark.position.y = 0.015; mark.visible = false; scene.add(mark);
const trail = Array.from({ length: 7 }, (_, i) => { const t = new THREE.Mesh(new THREE.SphereGeometry(0.07 - i * 0.007, 10, 8), new THREE.MeshBasicMaterial({ color: 0xe8ff4a, transparent: true, opacity: 0.32 - i * 0.04 })); scene.add(t); return t; }), wake = [];

/* ---- Sound: every noise is made here, from a tone and a puff of hiss. Nothing is loaded. ---- */
let audio = null, soundOn = true, hush = false;
function noise(freq, len, gain, hiss = 0.5) { if (!audio || !soundOn || hush || audio.state !== 'running') return; const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + len); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len); o.connect(g).connect(audio.destination); o.start(t); o.stop(t + len + 0.02);
  if (hiss > 0) { const n = audio.createBufferSource(), buf = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.04), audio.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); n.buffer = buf; const f = audio.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq * 2; const ng = audio.createGain(); ng.gain.value = gain * hiss; n.connect(f).connect(ng).connect(audio.destination); n.start(t); } }
function wakeSound() { if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (err) { audio = null; } } if (audio && audio.state === 'suspended') audio.resume(); }

/* ---- The game in hand ---- */
let m = R.createMatch({ seed: 20261117, level: 'club', youLevel: 'club', toWin: 7 }), mode = 'menu', before = 'play', acc = 0, last = null, options = { level: 'club', toWin: 7 }, games = 0;
const input = { mx: 0, mz: 0, swing: null, aim: 0 }, keys = new Set(); let point = null, byPointer = false;
const names = { p: 'You', r: 'Your rival' }, say = text => { $('live').textContent = text; };
const CALLS = { net: 'NET!', out: 'OUT!', short: 'SHORT!', double: 'TWO BOUNCES', kitchen: 'KITCHEN!', twobounce: 'TOO SOON!', serve: 'FAULT!' }, WORDS = { drive: 'POK!', smash: 'SMASH!', dink: 'dink', lob: 'LOB!', serve: 'POK!' };
const coarse = matchMedia('(pointer: coarse)');
const running = () => mode === 'play' || mode === 'watch' || (mode === 'menu' && !less.matches);

function show() { const playing = mode === 'play' || mode === 'watch', hud = playing || mode === 'paused' || mode === 'over'; $('start').hidden = mode !== 'menu'; $('paused').hidden = mode !== 'paused'; $('over').hidden = mode !== 'over'; $('board').hidden = !hud; $('tools').hidden = !playing; $('shots').hidden = mode !== 'play'; $('hint').hidden = mode !== 'play'; $('call').hidden = !playing || !$('call').textContent;
  $('b-you').querySelector('.name').textContent = watching() || (mode === 'over' && $('over-eyebrow').textContent === 'Game over') ? 'White' : 'You'; $('b-rival').querySelector('.name').textContent = $('b-you').querySelector('.name').textContent === 'White' ? 'Coral' : 'Rival'; $('s-you').textContent = m.score.p; $('s-rival').textContent = m.score.r; $('b-you').classList.toggle('serving', m.server === 'p'); $('b-rival').classList.toggle('serving', m.server === 'r'); $('sound').setAttribute('aria-pressed', String(soundOn)); }
function call(text) { $('call').textContent = text; $('call').hidden = !text || !(mode === 'play' || mode === 'watch'); }
function begin(next, extra = {}) { games++; m = R.createMatch({ seed: extra.seed ?? ((Date.now() ^ (games * 7919)) >>> 0), level: options.level, toWin: options.toWin, youLevel: next === 'watch' ? 'club' : null }); mode = next; acc = 0; wake.length = 0; call(next === 'watch' ? 'Watching. The near player is in white.' : ''); show(); $('court').focus({ preventScroll: true }); say(next === 'watch' ? 'Watching a game. Press Pause to stop.' : `Game to ${options.toWin}. You serve first. Press Space to serve.`); }
function pause() { if (mode !== 'play' && mode !== 'watch') return; before = mode; mode = 'paused'; $('paused-score').textContent = `${tally()} ${watching() ? `${who(m.server)} is` : m.server === 'p' ? 'You are' : 'Your rival is'} serving.`; show(); $('resume').focus(); say('Paused.'); }
function resume() { if (mode !== 'paused') return; mode = before; last = null; show(); $('court').focus({ preventScroll: true }); say('Playing.'); }
function toMenu() { mode = 'menu'; m = R.createMatch({ seed: 20261117 + games, level: 'club', youLevel: 'club', toWin: 7 }); call(''); show(); $('play').focus(); }

/* What just happened, turned into words, noises and lettering. */
function pop(text, at, kind = '') { const v = new THREE.Vector3(at.x, at.y ?? 0.4, at.z).project(eye), el = document.createElement('span'), x = Math.round((v.x + 1) / 2 * innerWidth); let y = Math.round((1 - v.y) / 2 * innerHeight); for (const o of $('pops').children) if (Math.abs(o.at.x - x) < 110 && Math.abs(o.at.y - y) < 34) y = o.at.y - 40; /* two words in one place: the newer one goes above */
  el.at = { x, y }; el.className = 'pop ' + kind; el.textContent = text; el.style.transform = `translate(${x}px, ${Math.max(46, y)}px) translate(-50%, -100%) rotate(${less.matches ? 0 : (Math.random() * 14 - 7).toFixed(1)}deg)`; $('pops').append(el); setTimeout(() => el.remove(), 950); while ($('pops').children.length > 6) $('pops').firstChild.remove(); }
/* Who is who, in words. When you are playing they are you and your rival; when the game plays both sides they are White and Coral. */
const watching = () => mode === 'watch' || (mode === 'paused' && before === 'watch'), who = w => (watching() ? (w === 'p' ? 'White' : 'Coral') : w === 'p' ? 'you' : 'your rival'), tally = () => (watching() ? `White ${m.score.p}, Coral ${m.score.r}.` : `You ${m.score.p}, rival ${m.score.r}.`), up = t => t[0].toUpperCase() + t.slice(1);
function happened(events) { const quiet = mode === 'menu'; let again = false; for (const e of events) { const f = figure[e.by];
    if (e.type === 'swing') { f.wound = 0.4; f.thru = 0; f.kind = m.state === 'serve' ? 'serve' : e.shot === 'drive' && m.ball.y > 1.55 && !m.ball.held ? 'smash' : e.shot; }
    if (e.type === 'serve' || e.type === 'hit') { f.kind = e.shot; f.wound = 0; f.thru = 0.24; f.lunge = { x: e.x - m.who[e.by].x, z: e.z - m.who[e.by].z }; f.lungeT = e.type === 'serve' ? 0 : 0.24; if (!quiet) { noise(e.shot === 'dink' ? 620 : e.shot === 'smash' ? 1500 : e.shot === 'lob' ? 800 : 1150, 0.07, e.shot === 'dink' ? 0.12 : 0.24); pop(WORDS[e.shot], e, e.shot === 'smash' ? 'big' : e.shot === 'dink' ? 'soft' : ''); if (e.type === 'serve') call(''); } }
    if (e.type === 'bounce' && !quiet) noise(e.dead ? 260 : 380, 0.05, e.dead ? 0.05 : 0.11, 0.2);
    if (e.type === 'net' && !quiet) noise(140, 0.16, 0.2, 0.9);
    if (e.type === 'cord' && !quiet) { noise(210, 0.09, 0.16, 0.9); pop('tik!', { x: e.x, y: e.y + 0.25, z: 0 }, 'soft'); }
    if (e.type === 'miss') { f.wound = 0; f.thru = 0.24; f.lungeT = 0; if (e.by === 'p' && mode === 'play') pop('whiff', { x: m.who.p.x, y: 1.6, z: m.who.p.z }, 'soft'); }
    if (e.type === 'fault' && !quiet) { const server = m.server, point = events.some(x => x.type === 'point'), winner = e.by === 'p' ? 'r' : 'p', line = `${R.WHY[e.why]}, by ${who(e.by)}. ${point ? `Point to ${who(winner)}.` : `Side out: ${who(server)} ${server === 'p' && !watching() ? 'serve' : 'serves'}.`} ${tally()}`;
      pop(CALLS[e.why], { x: e.x, y: 0.9, z: e.z }, e.by === 'p' && !watching() ? 'bad' : 'big'); call(`${R.WHY[e.why]}. ${watching() ? (point ? `Point to ${who(winner)}` : `Side out: ${who(server)} to serve`) : point ? (e.by === 'p' ? 'Point to your rival' : 'Your point') : server === 'p' ? 'Side out: your serve' : 'Side out: rival to serve'}`); say(line); noise(point && e.by === 'r' ? 880 : 300, 0.22, 0.14, 0); }
    if (e.type === 'ready' && mode === 'play') call(e.server === 'p' ? (coarse.matches ? 'Your serve: tap a shot' : 'Your serve: press Space, or tap a shot') : 'Rival to serve');
    if (e.type === 'ready' && mode === 'watch') call(`${who(e.server)} to serve`);
    if (e.type === 'over' && quiet) again = true; /* the game behind the start card never stops: when one ends, another begins */
    if (e.type === 'over' && !quiet) { const won = e.winner === 'p', seen = mode === 'watch', mins = Math.round(m.t / 60) || 1; mode = 'over'; $('over-eyebrow').textContent = seen ? 'Game over' : won ? 'Game to you' : 'Game to your rival'; $('over-h').textContent = seen ? (won ? 'White wins' : 'Coral wins') : won ? 'You win' : 'Beaten'; $('over-line').textContent = `${Math.max(m.score.p, m.score.r)} to ${Math.min(m.score.p, m.score.r)}, ${seen ? 'with the game playing both sides' : `against ${options.level === 'easy' ? 'an' : 'a'} ${options.level} rival`}, in ${mins} ${mins > 1 ? 'minutes' : 'minute'}.`; show(); $('again').focus(); say(`${$('over-h').textContent}. ${$('over-line').textContent}`); noise(won ? 990 : 220, 0.4, 0.16, 0); } }
  if (again) m = R.createMatch({ seed: 20261117 + 31 * ++games, level: 'club', youLevel: 'club', toWin: 7 });
  if (events.some(e => e.type === 'point' || e.type === 'sideout' || e.type === 'ready')) show(); }

/* What you are asking for, this instant. */
function controls() { const k = c => keys.has(c); let mx = (k('ArrowRight') || k('d') ? 1 : 0) - (k('ArrowLeft') || k('a') ? 1 : 0), mz = (k('ArrowDown') || k('s') ? 1 : 0) - (k('ArrowUp') || k('w') ? 1 : 0), aim = mx;
  if (byPointer && point) { const dx = point.x - m.who.p.x, dz = point.z - m.who.p.z, d = Math.hypot(dx, dz), run = !point.stay && d > 0.12; mx = run ? dx / d * Math.min(1, d * 2.5) : 0; mz = run ? dz / d * Math.min(1, d * 2.5) : 0; aim = point.aim; } /* pointing across the net aims the shot and leaves you where you stand */
  return { mx, mz, aim, swing: input.swing }; }
function tick(given) { R.step(m, STEP, given || (mode === 'play' ? controls() : { auto: true })); input.swing = null; happened(m.events); }

/* ---- Drawing ---- */
function fit() { const w = innerWidth, h = innerHeight, a = w / h; renderer.setSize(w, h, false); eye.aspect = a;
  /* A wide window looks along the court from behind you. A tall one looks down on it, so that the whole length fits. Between the two, something in between. A very wide one comes down lower and closer, so that the court fills more of it. */
  const k = THREE.MathUtils.clamp((1.3 - a) / 0.75, 0, 1), wide = THREE.MathUtils.clamp((a - 1.8) / 0.7, 0, 1); eye.fov = 40 + k * 10; eye.userData = { y: 5.6 + k * 10.9 - wide * 1.3, z: 14.3 - k * 1.5 - wide * 1.0, lookZ: 1.3 + wide * 0.6 }; eye.updateProjectionMatrix(); scene.userData.wall.visible = k < 0.5; } /* seen from above, on a phone held upright, the wall would lie under the scoreboard: it is left out */
/* How the arm goes for each shot: [wound up, followed through], each as [swing forward and up, out to the side] in radians. A smash starts above and behind the head. */
const ARM = { serve: [[-0.9, 0.3], [1.2, 0.25]], drive: [[-0.8, 0.9], [1.4, 0.35]], dink: [[-0.3, 0.4], [0.8, 0.3]], lob: [[-0.7, 0.5], [2.2, 0.3]], smash: [[3.6, 0.2], [0.9, 0.1]] }, REST = [0.45, 0.3], mix = (a, b, t) => a + (b - a) * THREE.MathUtils.clamp(t, 0, 1);
function pose(f, me, s, dt) { const speed = Math.hypot(me.vx, me.vz), go = Math.min(1, speed / 3.2), b = m.ball, live = m.state === 'live' && !b.held; f.run += dt * (5 + speed * 2.2); f.g.position.set(me.x, 0, me.z);
  /* Legs: a stride when running up or back, a shuffle when going across, feet a little apart when waiting. */
  const along = speed > 0.2 ? Math.abs(me.vz) / speed : 0, across = speed > 0.2 ? Math.abs(me.vx) / speed : 0, sw = Math.sin(f.run) * 0.8 * go; f.legs[0].rotation.x = sw * along; f.legs[1].rotation.x = -sw * along; const open = 0.1 + Math.abs(Math.sin(f.run)) * 0.34 * go * across; f.legs[0].rotation.z = -open; f.legs[1].rotation.z = open;
  /* The body: bobs with each step, leans into a run, turns to face the ball, and reaches towards it as it is struck. */
  f.lungeT = Math.max(0, f.lungeT - dt); const u = f.lungeT / 0.24, lx = f.lunge.x * s, lz = f.lunge.z * s; f.body.position.set(lx * 0.42 * u, Math.abs(Math.sin(f.run)) * 0.06 * go + (live && go < 0.2 ? Math.sin(m.t * 7) * 0.012 : 0), lz * 0.42 * u);
  const dx = (b.x - me.x) * s, fwd = -(b.z - me.z) * s, want = live ? THREE.MathUtils.clamp(-Math.atan2(dx, Math.max(0.8, fwd)), -0.8, 0.8) : 0; f.turn += (want - f.turn) * Math.min(1, dt * 8); f.body.rotation.set(THREE.MathUtils.clamp(me.vz * 0.03 * s, -0.2, 0.2) - u * 0.12, f.turn, THREE.MathUtils.clamp(-me.vx * 0.045 * s, -0.25, 0.25) - THREE.MathUtils.clamp(lx, -1, 1) * 0.16 * u);
  /* The arm: winds up when you press, goes through the ball when it is struck, and comes back to the ready. */
  f.wound = Math.max(0, f.wound - dt); f.thru = Math.max(0, f.thru - dt); const [back, through] = ARM[f.kind] || ARM.drive; let to = REST; if (f.thru > 0) { const k = 1 - f.thru / 0.24; to = k < 0.5 ? [mix(back[0], through[0], k / 0.5), mix(back[1], through[1], k / 0.5)] : [mix(through[0], REST[0], (k - 0.5) / 0.5), mix(through[1], REST[1], (k - 0.5) / 0.5)]; } else if (f.wound > 0) to = back;
  const quick = Math.min(1, dt * 28); f.ax += (to[0] - f.ax) * quick; f.az += (to[1] + THREE.MathUtils.clamp(lx, -1, 0.9) * 0.75 * u - f.az) * quick; f.arm.rotation.set(f.ax, 0, f.az); f.off.rotation.set(f.thru > 0 || f.wound > 0 ? -0.35 : 0.25 + Math.sin(f.run) * 0.25 * go, 0, -0.22); }
function draw(dt) { pose(figure.p, m.who.p, 1, dt); pose(figure.r, m.who.r, -1, dt); const b = m.ball; ball.position.set(b.x, Math.max(b.y, 0.085), b.z); ballShade.position.set(b.x, 0.013, b.z); ballShade.scale.setScalar(1 + Math.min(1.5, b.y * 0.35)); ballShade.material.opacity = 0.42 / (1 + b.y * 0.5);
  wake.unshift(ball.position.clone()); wake.length = Math.min(wake.length, 16); trail.forEach((t, i) => { const p = wake[(i + 1) * 2]; t.visible = !!p && !b.held && m.state === 'live'; if (p) t.position.copy(p); });
  const mk = m.mark; mark.visible = !!mk && !mk.net && m.state === 'live' && mode !== 'menu'; if (mark.visible) { mark.position.set(mk.x, 0.015, mk.z); mark.material.color.set(mk.good ? 0xf4f5f3 : 0xff7a6d); }
  const follow = less.matches ? 0 : m.who.p.x; eye.position.set(follow * 0.3, eye.userData.y, eye.userData.z); eye.lookAt(follow * 0.14, 0.7, eye.userData.lookZ); renderer.render(scene, eye); }
function frame(now) { const dt = last === null ? 0 : Math.min(0.25, Math.max(0, (now - last) / 1000)); last = now; if (running() && !document.hidden) { acc += dt; let n = 0; while (acc >= STEP && n++ < 16) { tick(); acc -= STEP; } if (n > 16) acc = 0; } draw(running() ? Math.min(dt, 0.1) : 0); requestAnimationFrame(frame); } /* on a slow machine the game takes several steps for each picture drawn, so that it keeps its speed and only the picture stutters */

/* ---- Controls ---- */
const swing = shot => { if (mode === 'play') input.swing = shot; };
addEventListener('keydown', e => { if (e.ctrlKey || e.metaKey || e.altKey) return; const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 'Escape' || key === 'p') { if (mode === 'paused') resume(); else if (mode === 'play' || mode === 'watch') pause(); return; }
  if (mode !== 'play' || /^(INPUT|BUTTON|A|SUMMARY)$/.test(document.activeElement?.tagName || '') && key === ' ') return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(key)) { keys.add(key); byPointer = false; e.preventDefault(); } else if (key === ' ' || key === 'j') { swing('drive'); e.preventDefault(); } else if (key === 'k') swing('dink'); else if (key === 'l') swing('lob'); });
addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), spot = new THREE.Vector3();
function aimAt(e) { ndc.set(e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2); ray.setFromCamera(ndc, eye); if (!ray.ray.intersectPlane(ground, spot)) return; point = { x: THREE.MathUtils.clamp(spot.x, -4.4, 4.4), z: THREE.MathUtils.clamp(spot.z, 0.45, 9.2), aim: THREE.MathUtils.clamp(spot.z > 0.3 ? ndc.x * 1.6 : spot.x / 2.4, -1, 1), stay: spot.z <= 0.3 }; byPointer = true; }
const court = $('court'); court.addEventListener('pointermove', e => { if (mode === 'play' && (e.pointerType === 'mouse' || e.buttons)) aimAt(e); });
court.addEventListener('pointerdown', e => { if (mode !== 'play') return; court.focus({ preventScroll: true }); aimAt(e); if (e.pointerType === 'mouse') swing(e.button === 2 ? 'dink' : 'drive'); e.preventDefault(); });
court.addEventListener('contextmenu', e => e.preventDefault());
for (const [id, shot] of [['b-drive', 'drive'], ['b-dink', 'dink'], ['b-lob', 'lob']]) $(id).addEventListener('pointerdown', e => { e.preventDefault(); swing(shot); }), $(id).addEventListener('click', e => { if (e.detail === 0) swing(shot); });
addEventListener('blur', () => { keys.clear(); pause(); }); document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('resize', () => { fit(); $('pops').replaceChildren(); });
const chosen = name => document.querySelector(`input[name="${name}"]:checked`).value;
$('play').addEventListener('click', () => { options = { level: chosen('level'), toWin: +chosen('to') }; wakeSound(); begin('play'); });
$('watch').addEventListener('click', () => { options = { level: chosen('level'), toWin: +chosen('to') }; wakeSound(); begin('watch'); });
$('pause').addEventListener('click', pause); $('resume').addEventListener('click', resume); $('quit').addEventListener('click', toMenu); $('menu').addEventListener('click', toMenu); $('again').addEventListener('click', () => begin('play'));
$('sound').addEventListener('click', e => { soundOn = !soundOn; if (soundOn) wakeSound(); show(); if (e.detail > 0 && (mode === 'play' || mode === 'watch')) court.focus({ preventScroll: true }); }); /* after a click with the mouse the keys go back to the court, so that Space hits the ball and does not press Sound again */

/* ---- Go ---- */
$('hint').textContent = 'Move: arrows, WASD, or point on your side of the net. Space or a click drives, K dinks, L lobs. Aim by the way you are moving, or by pointing across the net.';
fit(); show(); if (less.matches) for (let i = 0; i < 90; i++) R.step(m, STEP, { auto: true }); requestAnimationFrame(frame);
window.kitchenLine = { /* for the checks in tools/ */
  state: () => ({ mode, score: { ...m.score }, server: m.server, phase: m.state, t: m.t, winner: m.winner, ball: { ...m.ball }, you: { ...m.who.p }, rival: { ...m.who.r }, rally: { ...m.rally }, mark: m.mark, sound: soundOn, audio: audio ? audio.state : 'none', triangles: renderer.info.render.triangles, options, asking: controls(), names: [$('b-you').querySelector('.name').textContent, $('b-rival').querySelector('.name').textContent] }),
  start(next, extra) { options = { level: extra?.level || options.level, toWin: extra?.toWin || options.toWin }; begin(next, extra); }, fast(n, given) { const seen = []; hush = true; for (let i = 0; i < n; i++) { tick(given ? (i === 0 ? given : { ...given, swing: null }) : null); seen.push(...m.events); if (mode === 'over' || mode === 'paused') break; } hush = false; return seen; }, /* many steps at once, with no drawing and no noise: the next frame draws where things have got to */
  arm(by, kind, secs) { const f = figure[by]; f.kind = kind; f.wound = 0.4; f.thru = 0; for (let i = 0; i < 12; i++) pose(f, m.who[by], by === 'p' ? 1 : -1, STEP); f.wound = 0; f.thru = 0.24; for (let t = 0; t < secs; t += STEP) pose(f, m.who[by], by === 'p' ? 1 : -1, STEP); scene.updateMatrixWorld(true); const at = o => { const v = new THREE.Vector3(); o.getWorldPosition(v); return { x: v.x, y: v.y, z: v.z }; }; return { paddle: at(f.arm.children[2]), shoulder: at(f.arm), feet: f.legs.map(l => at(l.children[1])) }; }, /* winds a player's arm up for a shot and takes it this many seconds through the swing: for checking how a swing looks */
  pop(text, at) { pop(text, at); return [...$('pops').children].map(o => o.at); },
  where(x, y, z) { const v = new THREE.Vector3(x, y, z).project(eye); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; }, match: () => m,
};
