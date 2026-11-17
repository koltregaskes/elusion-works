// Elusion One: the page. camera.js builds the model, film.js holds the parts and the film's camera moves;
// this file lights the studio, turns the table, plays the film and answers the controls.
import * as THREE from 'three';
import { RoomEnvironment } from '../../_shared/three-r160/examples/jsm/environments/RoomEnvironment.js';
import { buildCamera } from './camera.js';
import { PARTS, SHOTS, STARTS, LENGTH, HOME, BODY, frame, place, orbit, towards, viewOf } from './film.js';

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const INSIDE_HOME = { round: -38, up: 16, dist: 36, target: [0.9, 0.2, 0.6], fov: 30 }; // where the camera stands when you first look inside

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas: $('stage'), antialias: true, powerPreference: 'high-performance' }); }
catch (err) { $('fallback').style.display = 'grid'; for (const id of ['stage', 'title', 'side', 'modes']) $(id).hidden = true; throw err; } // nothing that cannot work is left to be focused
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, matchMedia('(max-width: 900px)').matches ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x111315);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; // a soft-box studio, made in code, for the reflections
const eye = new THREE.PerspectiveCamera(30, 1, 1, 500);
// A key light with a soft shadow, and a rim light from behind to lift the edges off the dark.
{ const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(16, 30, 24); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 7; key.shadow.bias = -0.0005; Object.assign(key.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 90 }); scene.add(key);
  const rim = new THREE.DirectionalLight(0xdff5ea, 2.2); rim.position.set(-22, 12, -26); scene.add(rim); const fill = new THREE.DirectionalLight(0xffffff, 0.7); fill.position.set(-26, 8, 20); scene.add(fill); }
const floor = new THREE.Mesh(new THREE.CircleGeometry(160, 64), new THREE.MeshStandardMaterial({ color: 0x131517, roughness: 0.92, metalness: 0, envMapIntensity: 0.2 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -BODY.h / 2 - 0.62; floor.receiveShadow = true; scene.add(floor);
// The table turns; the camera stands on it.
const table = new THREE.Group(), model = buildCamera(); scene.add(table); table.add(model.group);
{ const disc = new THREE.Mesh(new THREE.CylinderGeometry(15, 15.4, 0.6, 96), new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.25, roughness: 0.78, envMapIntensity: 0.3 })); disc.position.y = -BODY.h / 2 - 0.3; // matt, so it does not throw the studio lights back at you; the camera stands on it disc.receiveShadow = true; table.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(14.1, 0.045, 8, 120), new THREE.MeshBasicMaterial({ color: 0x4a5258 })); ring.rotation.x = Math.PI / 2; ring.position.y = -BODY.h / 2 + 0.012; table.add(ring);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 1.3), new THREE.MeshBasicMaterial({ color: 0x3fe08a })); mark.position.set(0, -BODY.h / 2 + 0.012, 13.4); table.add(mark); } // a green tick on the rim, so you can see it turn

// ---- State ----
let mode = 'turntable', pose = { ...HOME }, goal = { ...HOME }, spin = 0, open = 0, filmT = 0, still = -1, selected = null, finish = 'black', dragging = false, idle = 9, glow = 0, last = null, shown = -1, turning = true, frozen = false;
const partOf = id => PARTS.find(p => p.id === id);
const say = text => { $('live').textContent = text; };

function describe() { const p = selected ? partOf(selected) : null; $('part-kind').textContent = p ? (p.inside ? 'Inside the body' : 'On the outside') : 'The parts'; $('part-name').textContent = p ? p.name : 'Eleven parts';
  $('says').textContent = p ? p.says : 'Choose a part to go and look at it. Eight are inside the body: choosing one of those fades the outside away.';
  for (const b of document.querySelectorAll('[data-part]')) b.setAttribute('aria-pressed', String(b.dataset.part === selected)); }
function buttons() { document.body.classList.toggle('near', mode === 'inside' || !!selected); $('m-turn').setAttribute('aria-pressed', String(mode === 'turntable')); $('m-film').setAttribute('aria-pressed', String(mode === 'film')); $('m-inside').setAttribute('aria-pressed', String(mode === 'inside'));
  const film = mode === 'film'; $('caption').hidden = !film; $('progress').hidden = !film || reduced; $('side').hidden = film; $('title').hidden = film; $('labels').hidden = mode !== 'inside'; }
function setMode(next) { if (next === 'film' && mode === 'film' && !reduced) next = 'turntable'; // pressing Film again stops it
  if (next === 'film') { selected = null; model.glow(null, 0); if (reduced) { still = mode === 'film' ? still + 1 : 0; if (still >= SHOTS.length) { still = -1; next = 'turntable'; } } else filmT = 0; spin = 0; }
  if (next === 'inside' && selected && !partOf(selected).inside) { selected = null; model.glow(null, 0); } /* a part of the outside cannot stay chosen once the outside has gone */
  const was = mode; mode = next; if (mode === 'turntable') { if (was !== 'turntable' || selected) goal = { ...HOME }; selected = null; model.glow(null, 0); still = -1; } if (mode === 'inside' && was !== 'inside' && !selected) goal = { ...INSIDE_HOME };
  if (mode === 'film' && reduced) { const s = SHOTS[still], f = frame(STARTS[still] + s.secs - 1e-6); pose = { ...f.pose }; goal = { ...pose }; open = f.open; caption(still); } // with motion kept down the film is seven stills: press again for the next
  if (mode !== 'film') shown = -1; describe(); buttons(); say(mode === 'film' ? (reduced ? `Still ${still + 1} of ${SHOTS.length}: ${SHOTS[still].name}. Press the film button for the next.` : 'The film is playing. Press the film button again, or Escape, to stop it.') : mode === 'inside' ? 'Looking inside. The outside has faded and eight parts are labelled.' : 'Turntable.'); }
function caption(i) { if (i === shown) return; shown = i; $('caption-n').textContent = `Shot ${i + 1} of ${SHOTS.length}`; $('caption-t').textContent = SHOTS[i].name; }
// Go and look at one part. Choosing the part you are already looking at lets go of it.
function select(id) { const p = partOf(id); if (!p) return; if (selected === id) { selected = null; model.glow(null, 0); goal = mode === 'inside' ? { ...INSIDE_HOME } : { ...HOME }; describe(); buttons(); say('Back to the whole camera.'); return; }
  mode = p.inside ? 'inside' : 'turntable'; selected = id; goal = viewOf(p); glow = 0; still = -1; describe(); buttons(); say(`${p.name}. ${p.says}`);
  if (innerWidth <= 900 && $('more').open) { const inList = $('list').contains(document.activeElement); $('more').open = false; if (inList) $('more').querySelector('summary').focus(); } $('side').scrollTop = 0; } /* on a small screen the list shuts, so the part and what it does can be seen */

// ---- Each moment ----
function advance(dt, real = dt) { if (frozen) return; idle += dt; const settle = k => (reduced ? 1 : 1 - Math.exp(-dt * k));
  if (mode === 'film' && !reduced) { filmT += real; const f = frame(filmT); pose = { ...f.pose }; goal = { ...pose }; open = f.open; caption(f.shot); $('progress').firstElementChild.style.width = (filmT / LENGTH * 100).toFixed(2) + '%'; if (f.done) { pose = { ...HOME }; setMode('turntable'); } return; }
  if (mode === 'film') return; // a still: nothing moves
  const want = mode === 'inside' ? 1 : 0; open += (want - open) * settle(4); if (Math.abs(want - open) < 0.002) open = want;
  pose = towards(pose, goal, settle(5));
  if (selected) { spin = Math.atan2(Math.sin(spin), Math.cos(spin)); spin += (0 - spin) * settle(5); glow = Math.min(glow + dt, 9); } // a chosen part is looked at with the table square on
  else if (turning && !reduced && !dragging && idle > 1.5 && !$('labels').contains(document.activeElement)) spin += dt * (mode === 'inside' ? 0.14 : 0.3); }
function draw() { table.rotation.y = spin; model.setOpen(open); if (selected) model.glow(selected, reduced ? 0.6 : 0.45 + 0.55 * Math.max(0, Math.cos(glow * 5)) * Math.exp(-glow * 1.2));
  const w = innerWidth, h = innerHeight, narrow = w <= 900, tall = w / h < 1.15, fit = tall ? Math.min(2, 1.15 / (w / h)) : 1, p = { ...pose, dist: pose.dist * fit }; // on a tall screen stand further back, so the whole camera fits across it
  eye.fov = pose.fov; eye.position.set(...place(p)); eye.lookAt(...pose.target);
  if (mode === 'film') eye.clearViewOffset(); else if (narrow) eye.setViewOffset(w, h, 0, Math.round(h * (h < 480 ? 0 : 0.13)), w, h); else eye.setViewOffset(w, h, 150, 0, w, h); // leave room for the panel: nudge the picture left on a wide screen, up on a narrow one
  eye.updateProjectionMatrix(); renderer.render(scene, eye); labels(); }
const spot = new THREE.Vector3();
function anchor(p) { spot.set(...p.at).applyAxisAngle(THREE.Object3D.DEFAULT_UP, spin).project(eye); return { x: (spot.x + 1) / 2 * innerWidth, y: (1 - spot.y) / 2 * innerHeight, ahead: spot.z < 1 }; }
// Can a part be seen from where the camera is, or is another part in front of it?
const ray = new THREE.Raycaster(), UP = THREE.Object3D.DEFAULT_UP, there = new THREE.Vector3(), way = new THREE.Vector3(), hits = [];
const blockers = PARTS.filter(p => p.inside).map(p => { const meshes = []; model.parts.get(p.id).traverse(o => { if (o.isMesh) meshes.push(o); }); return { id: p.id, meshes }; });
function seen(p) { there.set(...p.at).applyAxisAngle(UP, spin); way.copy(there).sub(eye.position); const far = way.length(); ray.set(eye.position, way.normalize()); ray.near = 0; ray.far = far - 0.3;
  for (const b of blockers) { if (b.id === p.id) continue; for (const m of b.meshes) { hits.length = 0; m.raycast(ray, hits); if (hits.length) return false; } } return true; }
function labels() { const on = mode === 'inside' && open > 0.5, vw = innerWidth, vh = innerHeight, cover = on ? ['side', 'modes'].map(id => $(id).getBoundingClientRect()).filter(r => r.width) : [], placed = [], focus = document.activeElement;
  const first = b => (b === focus) * 2 + (b.dataset.part === selected), all = [...$('labels').children].sort((x, y) => first(y) - first(x)); // the label with the focus, then the chosen part's, are placed first, so they are never the ones that give way
  for (const b of all) { const p = partOf(b.dataset.part), a = anchor(p), held = b === focus; let show = on && (held || (a.ahead && a.x > 12 && a.x < vw - 12 && a.y > 14 && a.y < vh - 14 && seen(p))); // a label is shown only where its part can be seen; one that has the focus stays, whatever happens
    if (show) { b.hidden = false; const wdt = b.offsetWidth, ax = Math.min(vw - 12, Math.max(12, a.x)), ay = Math.min(vh - 14, Math.max(14, a.y)), flip = ax - 11 + wdt > vw - 4, x = Math.round(flip ? Math.max(4, ax + 11 - wdt) : ax - 11), y = Math.round(ay - 13); // near the right-hand edge the words go to the left of the dot, so the label stays on the screen
      const hit = r => x < r.x + r.w + 3 && r.x < x + wdt + 3 && y < r.y + r.h + 3 && r.y < y + 29; // 26 high, and 3 apart
      if (!held) show = !placed.some(hit) && !cover.some(r => hit({ x: r.left, y: r.top, w: r.width, h: r.height })); // labels give way to each other and never lie on the panel or the buttons: the list still offers every part
      if (show) { placed.push({ x, y, w: wdt, h: 26 }); b.classList.toggle('flip', flip); b.style.transform = `translate(${x}px, ${y}px)`; } }
    b.hidden = !show; } }
function tick(now) { const real = last === null ? 0 : Math.max(0, (now - last) / 1000); last = now; if (!document.hidden) { advance(Math.min(0.1, real), Math.min(1, real)); draw(); } requestAnimationFrame(tick); } // easing takes small steps however slow the machine; the film keeps to the clock
let wide = null;
function resize() { renderer.setSize(innerWidth, innerHeight, false); eye.aspect = innerWidth / innerHeight;
  const w = innerWidth > 900; if (w !== wide) { wide = w; $('more').open = w; } // the list starts open on a wide screen and shut on a small one, and is left alone after that (a phone's address bar hiding is a resize too)
  document.documentElement.style.setProperty('--modes', $('modes').offsetHeight + 'px'); } // the row of buttons may wrap to two lines: whatever sits above it must know its height
addEventListener('resize', resize);

// ---- Controls ----
const stage = $('stage'), fingers = new Map(); let pinch = 0;
const hand = change => { if (mode === 'film') setMode('turntable'); goal = orbit(goal, change); idle = 0; };
stage.addEventListener('pointerdown', e => { e.preventDefault(); stage.focus({ preventScroll: true }); /* a click gives the model the arrow keys */ try { stage.setPointerCapture(e.pointerId); } catch (err) { /* works without */ } fingers.set(e.pointerId, [e.clientX, e.clientY]); dragging = true; stage.classList.add('drag'); if (fingers.size === 2) { const [a, b] = [...fingers.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
stage.addEventListener('pointermove', e => { const was = fingers.get(e.pointerId); if (!was) return; fingers.set(e.pointerId, [e.clientX, e.clientY]);
  if (fingers.size === 2) { const [a, b] = [...fingers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch > 0 && d > 0) hand({ zoom: pinch / d }); pinch = d; } else hand({ round: -(e.clientX - was[0]) * 0.32, up: (e.clientY - was[1]) * 0.22 }); });
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(ev, e => { fingers.delete(e.pointerId); pinch = 0; if (!fingers.size) { dragging = false; stage.classList.remove('drag'); } });
stage.addEventListener('wheel', e => { e.preventDefault(); hand({ zoom: Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.0022) }); }, { passive: false });
stage.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => { if (e.ctrlKey || e.metaKey || e.altKey) return; if (e.key === 'Escape') { if (mode === 'film') setMode('turntable'); else if (selected) select(selected); else if (mode === 'inside') setMode('turntable'); return; }
  if (document.activeElement !== stage) return; const move = { ArrowLeft: { round: -8 }, ArrowRight: { round: 8 }, ArrowUp: { up: 5 }, ArrowDown: { up: -5 }, '+': { zoom: 0.88 }, '=': { zoom: 0.88 }, '-': { zoom: 1.14 } }[e.key];
  if (move) { e.preventDefault(); hand(move); } else if (e.key === 'Home') { e.preventDefault(); goal = mode === 'inside' ? { ...INSIDE_HOME } : { ...HOME }; } });
addEventListener('blur', () => { fingers.clear(); dragging = false; stage.classList.remove('drag'); });
$('m-turn').addEventListener('click', () => setMode('turntable')); $('m-film').addEventListener('click', () => setMode('film')); $('m-inside').addEventListener('click', () => setMode(mode === 'inside' ? 'turntable' : 'inside'));
$('finish').addEventListener('click', () => { finish = finish === 'black' ? 'silver' : 'black'; model.setFinish(finish); $('finish').setAttribute('aria-pressed', String(finish === 'silver')); stage.setAttribute('aria-label', `A camera with a ${finish} top plate and a lens, standing on a turntable. Drag or use the arrow keys to turn it.`); say(`Top plate: ${finish}.`); });
$('hold').addEventListener('click', () => { turning = !turning; $('hold').setAttribute('aria-pressed', String(!turning)); say(turning ? 'The table turns again.' : 'The table is held still.'); });
// The parts, as a list to choose from and as labels pinned to the model.
{ const make = p => { const b = document.createElement('button'); b.type = 'button'; b.className = 'part'; b.dataset.part = p.id; b.textContent = p.name; b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', () => select(p.id)); return b; };
  const head = text => { const li = document.createElement('li'); li.className = 'group'; const h = document.createElement('h3'); h.textContent = text; li.append(h); return li; }, item = p => { const li = document.createElement('li'); li.append(make(p)); return li; };
  $('list').append(head('Inside'), ...PARTS.filter(p => p.inside).map(item), head('Outside'), ...PARTS.filter(p => !p.inside).map(item));
  $('labels').append(...PARTS.filter(p => p.inside).map(p => { const b = make(p); b.className = ''; b.hidden = true; return b; })); }

// ---- Go ----
if (reduced) { $('hold').hidden = true; $('hint').textContent = 'Drag to turn. Scroll or pinch to move closer. Arrow keys work too. The film is shown as seven stills.'; $('m-film').textContent = 'Film, as stills'; }
resize(); describe(); buttons(); requestAnimationFrame(tick);
window.elusionOne = { // for the automated checks
  state: () => ({ mode, selected, open, spin, turning, pose: { ...pose }, goal: { ...goal }, filmT, still, shot: mode === 'film' ? (reduced ? still : frame(filmT).shot) : -1, finish, reduced, eye: eye.position.toArray(), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  fast(n) { const was = frozen; frozen = false; for (let i = 0; i < n; i++) advance(1 / 60); frozen = was; draw(); return n; }, setMode, select,
  freeze(on, k) { frozen = !!on; if (on && k !== undefined) open = k; draw(); }, // hold everything still, optionally with the outside faded by a given amount
  seen(id) { return seen(partOf(id)); }, seenFrom(id, v) { const keep = [eye.position.clone(), spin]; spin = 0; table.rotation.y = 0; table.updateMatrixWorld(true); eye.position.set(...place(v)); const ok = seen(partOf(id)); eye.position.copy(keep[0]); spin = keep[1]; table.rotation.y = spin; table.updateMatrixWorld(true); return ok; },
  rear() { table.rotation.y = 0; table.updateMatrixWorld(true); const b = new THREE.Box3(); for (const m of model.rear) b.expandByObject(m); table.rotation.y = spin; return { min: b.min.toArray(), max: b.max.toArray() }; },
  where(id) { const a = anchor(partOf(id)); return { x: a.x, y: a.y, ahead: a.ahead }; },
  box(id) { table.rotation.y = 0; table.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(model.parts.get(id)); table.rotation.y = spin; return { min: b.min.toArray(), max: b.max.toArray() }; },
  whole() { table.rotation.y = 0; table.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(model.group); table.rotation.y = spin; return { min: b.min.toArray(), max: b.max.toArray() }; },
};
