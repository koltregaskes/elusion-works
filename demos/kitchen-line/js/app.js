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
/* A player: legs, body, head, cap, and an arm that swings a paddle. Built facing the net from your end; the rival is turned round. */
function makePlayer(shirt, cap) { const g = new THREE.Group(), body = new THREE.Group(); g.add(body); const skin = toon(0xf1c9a5), dark = toon(0x23272b);
  for (const s of [-1, 1]) part(new THREE.CapsuleGeometry(0.08, 0.5, 4, 10), dark, [s * 0.11, 0.42, 0], body); part(new THREE.CapsuleGeometry(0.2, 0.4, 4, 14), toon(shirt), [0, 1.08, 0], body); part(new THREE.SphereGeometry(0.15, 18, 14), skin, [0, 1.6, 0], body);
  part(new THREE.SphereGeometry(0.158, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), toon(cap), [0, 1.63, 0], body, 1.04); part(new THREE.BoxGeometry(0.2, 0.025, 0.16), toon(cap), [0, 1.64, -0.19], body, 1.12);
  const arm = new THREE.Group(); arm.position.set(0.27, 1.3, 0); body.add(arm); part(new THREE.CapsuleGeometry(0.052, 0.4, 4, 8), skin, [0, -0.25, 0], arm); part(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8), dark, [0, -0.56, 0], arm, 1.3);
  const face = part(new THREE.CylinderGeometry(0.125, 0.125, 0.022, 24), toon(cap), [0, -0.78, 0], arm, 1.1); face.rotation.x = Math.PI / 2; face.scale.set(1, 1, 1.35); const off = new THREE.Group(); off.position.set(-0.27, 1.3, 0); body.add(off); part(new THREE.CapsuleGeometry(0.052, 0.4, 4, 8), skin, [0, -0.25, 0], off);
  const shade = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })); shade.rotation.x = -Math.PI / 2; shade.position.y = 0.012; g.add(shade); g.scale.setScalar(1.1); scene.add(g); return { g, body, arm, swing: 0, run: 0 }; }
const figure = { p: makePlayer(0xf4f5f3, 0x3fe08a), r: makePlayer(0xff7a6d, 0x23272b) }; figure.r.g.rotation.y = Math.PI;
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
const running = () => mode === 'play' || mode === 'watch' || (mode === 'menu' && !less.matches);

function show() { const playing = mode === 'play' || mode === 'watch', hud = playing || mode === 'paused' || mode === 'over'; $('start').hidden = mode !== 'menu'; $('paused').hidden = mode !== 'paused'; $('over').hidden = mode !== 'over'; $('board').hidden = !hud; $('tools').hidden = !playing; $('shots').hidden = mode !== 'play'; $('hint').hidden = mode !== 'play'; $('call').hidden = !playing || !$('call').textContent;
  $('s-you').textContent = m.score.p; $('s-rival').textContent = m.score.r; $('b-you').classList.toggle('serving', m.server === 'p'); $('b-rival').classList.toggle('serving', m.server === 'r'); $('sound').setAttribute('aria-pressed', String(soundOn)); }
function call(text) { $('call').textContent = text; $('call').hidden = !text || !(mode === 'play' || mode === 'watch'); }
function begin(next, extra = {}) { games++; m = R.createMatch({ seed: extra.seed ?? ((Date.now() ^ (games * 7919)) >>> 0), level: options.level, toWin: options.toWin, youLevel: next === 'watch' ? 'club' : null }); mode = next; acc = 0; wake.length = 0; call(next === 'watch' ? 'Watching. The near player is in white.' : ''); show(); $('court').focus({ preventScroll: true }); say(next === 'watch' ? 'Watching a game. Press Pause to stop.' : `Game to ${options.toWin}. You serve first. Press Space to serve.`); }
function pause() { if (mode !== 'play' && mode !== 'watch') return; before = mode; mode = 'paused'; $('paused-score').textContent = `You ${m.score.p}, rival ${m.score.r}. ${m.server === 'p' ? 'You are' : 'Your rival is'} serving.`; show(); $('resume').focus(); say('Paused.'); }
function resume() { if (mode !== 'paused') return; mode = before; last = null; show(); $('court').focus({ preventScroll: true }); say('Playing.'); }
function toMenu() { mode = 'menu'; m = R.createMatch({ seed: 20261117 + games, level: 'club', youLevel: 'club', toWin: 7 }); call(''); show(); $('play').focus(); }

/* What just happened, turned into words, noises and lettering. */
function pop(text, at, kind = '') { const v = new THREE.Vector3(at.x, at.y ?? 0.4, at.z).project(eye), el = document.createElement('span'); el.className = 'pop ' + kind; el.textContent = text; el.style.transform = `translate(${Math.round((v.x + 1) / 2 * innerWidth)}px, ${Math.round((1 - v.y) / 2 * innerHeight)}px) translate(-50%, -100%) rotate(${less.matches ? 0 : (Math.random() * 14 - 7).toFixed(1)}deg)`; $('pops').append(el); setTimeout(() => el.remove(), 950); while ($('pops').children.length > 6) $('pops').firstChild.remove(); }
function happened(events) { const quiet = mode === 'menu'; for (const e of events) {
    if (e.type === 'swing') figure[e.by].swing = 0.3;
    if (e.type === 'serve' || e.type === 'hit') { figure[e.by].swing = Math.max(figure[e.by].swing, 0.22); if (!quiet) { noise(e.shot === 'dink' ? 620 : e.shot === 'smash' ? 1500 : e.shot === 'lob' ? 800 : 1150, 0.07, e.shot === 'dink' ? 0.12 : 0.24); pop(WORDS[e.shot], e, e.shot === 'smash' ? 'big' : e.shot === 'dink' ? 'soft' : ''); if (e.type === 'serve') call(''); } }
    if (e.type === 'bounce' && !quiet) noise(e.dead ? 260 : 380, 0.05, e.dead ? 0.05 : 0.11, 0.2);
    if (e.type === 'net' && !quiet) noise(140, 0.16, 0.2, 0.9);
    if (e.type === 'miss' && e.by === 'p' && mode === 'play') pop('whiff', { x: m.who.p.x, y: 1.6, z: m.who.p.z }, 'soft');
    if (e.type === 'fault' && !quiet) { const server = m.server, point = events.some(x => x.type === 'point'), line = `${R.WHY[e.why]}, ${e.by === 'p' ? 'by you' : 'by your rival'}. ${point ? `Point to ${e.by === 'p' ? 'your rival' : 'you'}.` : `Side out: ${server === 'p' ? 'you serve' : 'your rival serves'}.`} You ${m.score.p}, rival ${m.score.r}.`;
      pop(CALLS[e.why], { x: e.x, y: 0.9, z: e.z }, e.by === 'p' ? 'bad' : 'big'); call(`${R.WHY[e.why]}. ${point ? (e.by === 'p' ? 'Point to your rival' : 'Your point') : server === 'p' ? 'Side out: your serve' : 'Side out: rival to serve'}`); say(line); noise(point && e.by === 'r' ? 880 : 300, 0.22, 0.14, 0); }
    if (e.type === 'ready' && mode === 'play') { call(e.server === 'p' ? 'Your serve: press Space, or tap a shot' : 'Rival to serve'); }
    if (e.type === 'over' && !quiet) { const won = e.winner === 'p', watching = mode === 'watch'; mode = 'over'; $('over-eyebrow').textContent = watching ? 'Game over' : won ? 'Game to you' : 'Game to your rival'; $('over-h').textContent = watching ? (won ? 'White wins' : 'Coral wins') : won ? 'You win' : 'Beaten'; $('over-line').textContent = `${Math.max(m.score.p, m.score.r)} to ${Math.min(m.score.p, m.score.r)}, against ${options.level === 'easy' ? 'an' : 'a'} ${options.level} rival, in ${Math.round(m.t / 60) || 1} ${Math.round(m.t / 60) > 1 ? 'minutes' : 'minute'}.`; show(); $('again').focus(); say(`${$('over-h').textContent}. ${$('over-line').textContent}`); noise(won ? 990 : 220, 0.4, 0.16, 0); } }
  if (events.some(e => e.type === 'point' || e.type === 'sideout' || e.type === 'ready')) show(); }

/* What you are asking for, this instant. */
function controls() { const k = c => keys.has(c); let mx = (k('ArrowRight') || k('d') ? 1 : 0) - (k('ArrowLeft') || k('a') ? 1 : 0), mz = (k('ArrowDown') || k('s') ? 1 : 0) - (k('ArrowUp') || k('w') ? 1 : 0), aim = mx;
  if (byPointer && point) { const dx = point.x - m.who.p.x, dz = point.z - m.who.p.z, d = Math.hypot(dx, dz); mx = d > 0.12 ? dx / d * Math.min(1, d * 2.5) : 0; mz = d > 0.12 ? dz / d * Math.min(1, d * 2.5) : 0; aim = point.aim; }
  return { mx, mz, aim, swing: input.swing }; }
function tick(given) { R.step(m, STEP, given || (mode === 'play' ? controls() : { auto: true })); input.swing = null; happened(m.events); }

/* ---- Drawing ---- */
function fit() { const w = innerWidth, h = innerHeight, a = w / h; renderer.setSize(w, h, false); eye.aspect = a;
  /* A wide window looks along the court from behind you. A tall one looks down on it, so that the whole length fits. Between the two, something in between. */
  const k = THREE.MathUtils.clamp((1.3 - a) / 0.75, 0, 1); eye.fov = 40 + k * 10; eye.userData = { y: 5.6 + k * 10.9, z: 14.3 - k * 1.5, lookZ: 1.3 }; eye.updateProjectionMatrix(); }
function pose(f, me, s, dt) { const speed = Math.hypot(me.vx, me.vz); f.run += dt * (4 + speed * 2.4); f.g.position.set(me.x, 0, me.z); f.body.position.y = speed > 0.4 ? Math.abs(Math.sin(f.run)) * 0.05 : 0; f.body.rotation.z = THREE.MathUtils.clamp(-me.vx * 0.045 * s, -0.25, 0.25); f.body.rotation.x = THREE.MathUtils.clamp(me.vz * 0.03 * s, -0.2, 0.2);
  f.swing = Math.max(0, f.swing - dt); const k = 1 - f.swing / 0.3; f.arm.rotation.x = f.swing > 0 ? (k < 0.3 ? 0.9 * (k / 0.3) : 0.9 - 3.2 * ((k - 0.3) / 0.7)) - 0.4 : -0.4 + Math.sin(f.run * 0.5) * 0.04; f.arm.rotation.z = f.swing > 0 ? -0.5 : -0.15; }
function draw(dt) { pose(figure.p, m.who.p, 1, dt); pose(figure.r, m.who.r, -1, dt); const b = m.ball; ball.position.set(b.x, Math.max(b.y, 0.085), b.z); ballShade.position.set(b.x, 0.013, b.z); ballShade.scale.setScalar(1 + Math.min(1.5, b.y * 0.35)); ballShade.material.opacity = 0.42 / (1 + b.y * 0.5);
  wake.unshift(ball.position.clone()); wake.length = Math.min(wake.length, 16); trail.forEach((t, i) => { const p = wake[(i + 1) * 2]; t.visible = !!p && !b.held && m.state === 'live'; if (p) t.position.copy(p); });
  const mk = m.mark; mark.visible = !!mk && !mk.net && m.state === 'live' && mode !== 'menu'; if (mark.visible) { mark.position.set(mk.x, 0.015, mk.z); mark.material.color.set(mk.good ? 0xf4f5f3 : 0xff7a6d); }
  const follow = less.matches ? 0 : m.who.p.x; eye.position.set(follow * 0.3, eye.userData.y, eye.userData.z); eye.lookAt(follow * 0.14, 0.7, eye.userData.lookZ); renderer.render(scene, eye); }
function frame(now) { const dt = last === null ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now; if (running() && !document.hidden) { acc += dt; let n = 0; while (acc >= STEP && n++ < 4) { tick(); acc -= STEP; } if (n > 4) acc = 0; } draw(dt); requestAnimationFrame(frame); }

/* ---- Controls ---- */
const swing = shot => { if (mode === 'play') input.swing = shot; };
addEventListener('keydown', e => { if (e.ctrlKey || e.metaKey || e.altKey) return; const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 'Escape' || key === 'p') { if (mode === 'paused') resume(); else if (mode === 'play' || mode === 'watch') pause(); return; }
  if (mode !== 'play' || /^(INPUT|BUTTON|A|SUMMARY)$/.test(document.activeElement?.tagName || '') && key === ' ') return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(key)) { keys.add(key); byPointer = false; e.preventDefault(); } else if (key === ' ' || key === 'j') { swing('drive'); e.preventDefault(); } else if (key === 'k') swing('dink'); else if (key === 'l') swing('lob'); });
addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), spot = new THREE.Vector3();
function aimAt(e) { ndc.set(e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2); ray.setFromCamera(ndc, eye); if (!ray.ray.intersectPlane(ground, spot)) return; point = { x: THREE.MathUtils.clamp(spot.x, -5, 5), z: THREE.MathUtils.clamp(spot.z, 0.45, 9.2), aim: THREE.MathUtils.clamp(ndc.x * 1.6, -1, 1) }; byPointer = true; }
const court = $('court'); court.addEventListener('pointermove', e => { if (mode === 'play' && (e.pointerType === 'mouse' || e.buttons)) aimAt(e); });
court.addEventListener('pointerdown', e => { if (mode !== 'play') return; court.focus({ preventScroll: true }); aimAt(e); if (e.pointerType === 'mouse') swing(e.button === 2 ? 'dink' : 'drive'); e.preventDefault(); });
court.addEventListener('contextmenu', e => e.preventDefault());
for (const [id, shot] of [['b-drive', 'drive'], ['b-dink', 'dink'], ['b-lob', 'lob']]) $(id).addEventListener('pointerdown', e => { e.preventDefault(); swing(shot); }), $(id).addEventListener('click', e => { if (e.detail === 0) swing(shot); });
addEventListener('blur', () => { keys.clear(); pause(); }); document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('resize', fit);
const chosen = name => document.querySelector(`input[name="${name}"]:checked`).value;
$('play').addEventListener('click', () => { options = { level: chosen('level'), toWin: +chosen('to') }; wakeSound(); begin('play'); });
$('watch').addEventListener('click', () => { options = { level: chosen('level'), toWin: +chosen('to') }; wakeSound(); begin('watch'); });
$('pause').addEventListener('click', pause); $('resume').addEventListener('click', resume); $('quit').addEventListener('click', toMenu); $('menu').addEventListener('click', toMenu); $('again').addEventListener('click', () => begin('play'));
$('sound').addEventListener('click', () => { soundOn = !soundOn; if (soundOn) wakeSound(); show(); });

/* ---- Go ---- */
$('hint').textContent = 'Move: arrows, WASD or the mouse. Space drives, K dinks, L lobs. Aim with the way you are moving.';
fit(); show(); if (less.matches) for (let i = 0; i < 90; i++) R.step(m, STEP, { auto: true }); requestAnimationFrame(frame);
window.kitchenLine = { /* for the checks in tools/ */
  state: () => ({ mode, score: { ...m.score }, server: m.server, phase: m.state, t: m.t, winner: m.winner, ball: { ...m.ball }, you: { ...m.who.p }, rival: { ...m.who.r }, rally: { ...m.rally }, mark: m.mark, sound: soundOn, audio: audio ? audio.state : 'none', triangles: renderer.info.render.triangles, options }),
  start(next, extra) { options = { level: extra?.level || options.level, toWin: extra?.toWin || options.toWin }; begin(next, extra); }, fast(n, given) { const seen = []; hush = true; for (let i = 0; i < n; i++) { tick(given ? (i === 0 ? given : { ...given, swing: null }) : null); seen.push(...m.events); if (mode === 'over' || mode === 'paused') break; } hush = false; return seen; }, /* many steps at once, with no drawing and no noise: the next frame draws where things have got to */
  where(x, y, z) { const v = new THREE.Vector3(x, y, z).project(eye); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; }, match: () => m,
};
