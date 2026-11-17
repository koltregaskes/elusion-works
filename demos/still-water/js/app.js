// Still Water: the page. world.js knows the rooms and how to walk them, build.js makes the walls and the light;
// this file draws them, listens to the controls and makes the sound.
import * as THREE from 'three';
import { makeWorld, newWalker, walk, follow, route, viewPoint, facing, floorAt, clear, CELL, WATER_Y, EYE } from './world.js';
import { buildRooms } from './build.js';
import { PHOTOS } from './photos.js';

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const small = coarse || matchMedia('(max-width: 760px)').matches;
const two = n => String(n).padStart(2, '0');
const HAZE = [0.83, 0.91, 0.91]; // the pale air the far rooms fade into

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas: $('stage'), antialias: true, powerPreference: 'high-performance' }); }
catch (err) { $('fallback').style.display = 'grid'; $('start').hidden = true; throw err; }
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
const scene = new THREE.Scene(); scene.background = new THREE.Color().setRGB(HAZE[0], HAZE[1], HAZE[2], THREE.SRGBColorSpace);
const camera = new THREE.PerspectiveCamera(62, 1, 0.08, 120); camera.rotation.order = 'YXZ';

const world = makeWorld(), rooms = buildRooms(world), me = newWalker(world);
const uTime = { value: 0 }, uHaze = { value: new THREE.Vector3(...HAZE) }, uMe = { value: new THREE.Vector3(me.x, me.z, 0) };

// ---- The rooms: one mesh. Tiles, grout, sheen and the moving light off the water are all drawn by this shader. ----
const CAUSTIC = /* glsl */`
  float caustic(vec2 p, float t) { vec2 q = p; float a = 0.0; // bright threads where bent ripples cross
    for (int i = 0; i < 3; i++) { float f = float(i); q += 0.35 * vec2(sin(q.y * 1.7 + t * 0.9 + f * 1.3), cos(q.x * 1.9 - t * 0.7 + f * 2.1)); a += abs(sin(q.x * 2.3 + f) + sin(q.y * 2.1 - f * 0.7)); }
    return pow(clamp(1.0 - a / 3.0 * 0.78, 0.0, 1.0), 3.0); }`;
{ const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(rooms.position, 3)); g.setAttribute('normal', new THREE.BufferAttribute(rooms.normal, 3)); g.setAttribute('aLight', new THREE.BufferAttribute(rooms.light, 3)); g.setAttribute('aKind', new THREE.BufferAttribute(rooms.kind, 1)); g.setAttribute('aWet', new THREE.BufferAttribute(rooms.wet, 1)); g.setIndex(new THREE.BufferAttribute(rooms.index, 1));
  const m = new THREE.ShaderMaterial({ uniforms: { uTime, uHaze, uWater: { value: WATER_Y } },
    vertexShader: /* glsl */`attribute vec3 aLight; attribute float aKind; attribute float aWet; varying vec3 vW; varying vec3 vN; varying vec3 vL; varying float vKind; varying float vWet;
      void main() { vW = position; vN = normal; vL = aLight; vKind = aKind; vWet = aWet; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uHaze; uniform float uWater; varying vec3 vW; varying vec3 vN; varying vec3 vL; varying float vKind; varying float vWet;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      ${CAUSTIC}
      void main() {
        vec3 n = normalize(vN), an = abs(n), toEye = cameraPosition - vW; float dist = length(toEye); vec3 V = toEye / dist;
        vec2 uv = an.y > 0.6 ? vW.xz : (an.x > an.z ? vW.zy : vW.xy); vec3 col;
        if (vKind > 3.5) col = vec3(1.0, 0.99, 0.95); // the pane of a skylight
        else {
          vec3 base = vec3(0.90, 0.93, 0.92); float gloss = 0.0;
          if (vKind < 2.5) { float size = vKind > 1.5 ? 0.125 : (vKind > 0.5 ? 0.5 : 0.25); vec2 t = uv / size + 0.5, cell = abs(fract(t) - 0.5); // pool mosaic, floor slabs, wall tiles
            float aa = max(fwidth(t.x), fwidth(t.y)), line = smoothstep(0.455 - aa, 0.455 + aa, max(cell.x, cell.y)) * clamp(1.0 - aa * 1.5, 0.0, 1.0); // grout, fading out where tiles are too small to see
            float v = hash(floor(t));
            vec3 tile = vKind > 1.5 ? mix(vec3(0.40, 0.76, 0.79), vec3(0.56, 0.87, 0.87), v) : mix(vec3(0.90, 0.94, 0.93), vec3(0.97, 0.98, 0.97), v);
            vec3 grout = vKind > 1.5 ? vec3(0.28, 0.58, 0.63) : vec3(0.66, 0.73, 0.73);
            base = mix(tile, grout, line); gloss = 1.0 - line; }
          vec3 lit = 1.12 * (1.0 - exp(-vL * 1.05)); // bright places roll off gently instead of burning out to white
          col = base * lit;
          float glance = pow(1.0 - max(dot(n, V), 0.0), 4.0); col += gloss * glance * 0.2 * vec3(0.86, 0.96, 0.96) * (0.35 + lit.g); // glazed tiles pick up the room at a glancing angle
          float above = vW.y - uWater, reach = above > 0.0 ? exp(-above * 0.45) : 1.0;
          col += vWet * reach * caustic(uv * 2.1 + vW.y * 0.6, uTime) * vec3(0.50, 0.72, 0.70) * (above > 0.0 ? 0.5 : 0.85);
          if (above < 0.0) col *= mix(vec3(1.0), vec3(0.62, 0.93, 0.95), clamp(-above * 2.2, 0.0, 1.0)); // seen through the water
        }
        col = mix(col, uHaze, 1.0 - exp(-dist * dist * 0.0009));
        gl_FragColor = vec4(col, 1.0); }` });
  scene.add(new THREE.Mesh(g, m)); }

// ---- The water: nearly still, mirroring the skylights, a little rougher round you when you wade. ----
{ const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(rooms.water.position, 3)); g.setIndex(new THREE.BufferAttribute(rooms.water.index, 1));
  const sky = Array.from({ length: 12 }, (_, i) => { const s = world.skylights[i]; return s ? new THREE.Vector3(s.x, s.y + 0.7, s.z) : new THREE.Vector3(0, -99, 0); });
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime, uHaze, uMe, uSky: { value: sky }, uSkyN: { value: Math.min(12, world.skylights.length) } },
    vertexShader: /* glsl */`varying vec3 vW; void main() { vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uHaze; uniform vec3 uMe; uniform vec3 uSky[12]; uniform int uSkyN; varying vec3 vW;
      float height(vec2 p) { float t = uTime, h = 0.012 * sin(dot(p, vec2(1.3, 0.7)) * 1.9 + t * 0.9) + 0.009 * sin(dot(p, vec2(-0.6, 1.4)) * 2.7 - t * 1.1) + 0.006 * sin(dot(p, vec2(1.9, -1.1)) * 4.1 + t * 1.6) + 0.004 * sin(dot(p, vec2(0.4, 2.3)) * 6.3 - t * 2.1);
        float d = length(p - uMe.xy); return h + uMe.z * 0.03 * sin(d * 7.0 - t * 5.0) * exp(-d * 0.55); }
      void main() {
        vec2 p = vW.xz; float e = 0.05; vec3 n = normalize(vec3(height(p - vec2(e, 0.0)) - height(p + vec2(e, 0.0)), 2.0 * e, height(p - vec2(0.0, e)) - height(p + vec2(0.0, e))));
        vec3 toEye = cameraPosition - vW; float dist = length(toEye); vec3 V = toEye / dist, R = reflect(-V, n);
        float F = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0), glow = 0.0;
        for (int i = 0; i < 12; i++) { if (i >= uSkyN) break; float t = (uSky[i].y - vW.y) / max(R.y, 0.05); vec2 hit = vW.xz + R.xz * t; vec2 d = abs(hit - uSky[i].xz); glow += smoothstep(1.25, 0.85, max(d.x, d.y)); } // the skylights, mirrored
        vec3 mirror = mix(vec3(0.70, 0.82, 0.82), vec3(1.0, 0.99, 0.95), clamp(glow, 0.0, 1.0)), deep = vec3(0.13, 0.50, 0.55);
        vec3 col = mix(deep, mirror, F); float alpha = mix(0.38, 0.97, F);
        col = mix(col, uHaze, 1.0 - exp(-dist * dist * 0.0009));
        gl_FragColor = vec4(col, alpha); }` });
  const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 2; scene.add(mesh); }

// ---- Daylight falling from each skylight ----
{ const pos = [], fade = [], idx = [], w = CELL * 0.46;
  for (const s of world.skylights) { const cell = world.cell(s.r, s.c), low = cell.pool ? WATER_Y : 0; for (const [ax, az, bx, bz] of [[-w, -w, w, -w], [w, -w, w, w], [w, w, -w, w], [-w, w, -w, -w]]) { const b = pos.length / 3; pos.push(s.x + ax, s.y, s.z + az, s.x + bx, s.y, s.z + bz, s.x + ax * 1.25, low, s.z + az * 1.25, s.x + bx * 1.25, low, s.z + bz * 1.25); fade.push(1, 1, 0, 0); idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1)); g.setIndex(idx);
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`attribute float aFade; varying float vF; void main() { vF = aFade; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`varying float vF; void main() { gl_FragColor = vec4(vec3(1.0, 0.98, 0.9) * 0.055 * (0.15 + 0.85 * vF * vF), 1.0); }` });
  const mesh = new THREE.Mesh(g, m); mesh.renderOrder = 3; scene.add(mesh); }

// ---- The photographs: a dark frame, a white mount, the picture, and a numbered plate ----
const loaded = { ok: 0, failed: 0 };
const hung = world.photos.map((p, i) => { const info = PHOTOS[i], w = info.portrait ? 0.95 : 1.5, h = info.portrait ? 1.425 : 1.0; return { ...p, ...info, w, h }; });
const ready = Promise.all(hung.map(async p => {
  const group = new THREE.Group(); group.position.set(p.x + p.nx * 0.03, p.y, p.z + p.nz * 0.03); group.rotation.y = Math.atan2(p.nx, p.nz);
  const plane = (w, h, mat, z, x = 0, y = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); group.add(m); return m; };
  const frame = new THREE.Mesh(new THREE.BoxGeometry(p.w + 0.2, p.h + 0.2, 0.05), new THREE.MeshBasicMaterial({ color: 0x1a1d20 })); group.add(frame);
  plane(p.w + 0.12, p.h + 0.12, new THREE.MeshBasicMaterial({ color: 0xeef1f0 }), 0.027);
  let tex; try { tex = await new THREE.TextureLoader().loadAsync(p.file); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); loaded.ok++; } catch (err) { loaded.failed++; }
  plane(p.w, p.h, new THREE.MeshBasicMaterial(tex ? { map: tex, color: 0xf2f2f2 } : { color: 0x8a9296 }), 0.03);
  const c = document.createElement('canvas'); c.width = 160; c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#1a1d20'; g.fillRect(0, 0, 160, 64); g.fillStyle = '#f4f5f3'; g.font = '700 38px ui-monospace, Menlo, Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(two(p.plate), 80, 34);
  const label = new THREE.CanvasTexture(c); label.colorSpace = THREE.SRGBColorSpace; plane(0.2, 0.08, new THREE.MeshBasicMaterial({ map: label }), 0.005, p.w / 2 + 0.0, -p.h / 2 - 0.2);
  scene.add(group);
}));

// ---- State ----
let mode = 'start', path = null, pathYaw = 0, target = -1, shown = null, touring = false, pause = 0, still = reduced, soundOn = false, stir = 0, walked = 0, bob = 0, last = null;
const keys = new Set(), stick = { id: null, x: 0, y: 0, ox: 0, oy: 0 }, look = { id: null, x: 0, y: 0 };

function viewDist(p) { const v = Math.tan(camera.fov * Math.PI / 360), hgt = (p.h / 2) / v, wid = (p.w / 2) / (v * camera.aspect); return Math.max(hgt, wid) * 2.3 + 0.2; } // far enough back to see all of it
function showPlate(p) { if (p === shown) return; shown = p; $('plate-n').textContent = p ? `Plate ${two(p.plate)} of ${hung.length}` : 'Still Water'; $('plate-t').textContent = p ? hung[p.plate - 1].alt : 'Walk up to a photograph, or press Next.'; }
function veil() { if (reduced) return; const v = $('veil'); v.classList.add('on'); setTimeout(() => v.classList.remove('on'), 260); }
function stand(v) { me.x = v.x; me.z = v.z; me.yaw = v.yaw; me.pitch = 0; me.y = floorAt(world, v.x, v.z) + EYE; path = null; }
// Go and stand in front of a plate: a walk there, or a cut if motion is to be kept down.
function goTo(i, cut = reduced) { i = ((i % hung.length) + hung.length) % hung.length; const p = hung[i], v = viewPoint(world, world.photos[i], viewDist(p)); target = i;
  const r = cut ? null : route(world, me.x, me.z, v.x, v.z); if (!r) { veil(); stand(v); } else { path = r.slice(1); pathYaw = v.yaw; } }
function step(by) { const from = shown ? shown.plate - 1 : target; goTo(from < 0 ? (by > 0 ? 0 : hung.length - 1) : from + by); }
function setTour(on) { touring = on; $('tour').setAttribute('aria-pressed', String(on)); if (on) { pause = 0; if (!path) goTo(shown ? shown.plate % hung.length : 0); } }
function enter(tour) { mode = 'walk'; $('start').hidden = true; $('tools').hidden = false; $('plate').hidden = false; me.yaw = -Math.PI / 2; $('stage').focus({ preventScroll: true }); if (tour) setTour(true); }

function input() { const k = c => (keys.has(c) ? 1 : 0); return { forward: k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') - stick.y, strafe: k('KeyD') - k('KeyA') + stick.x, turn: (k('ArrowLeft') + k('KeyQ') - k('ArrowRight') - k('KeyE')) * 1.9 }; }
function advance(dt) {
  if (!still) uTime.value += dt;
  if (mode !== 'walk') return;
  const inp = input(), hands = inp.forward || inp.strafe || inp.turn || look.id !== null, x0 = me.x, z0 = me.z;
  if (hands && (path || touring)) { path = null; if (touring) setTour(false); } // touch the controls and you are walking yourself again
  if (path) { if (follow(world, me, path, pathYaw, dt)) { path = null; pause = 6; } } else walk(world, me, inp, dt);
  if (touring && !path) { pause -= dt; if (pause <= 0) { if (target >= hung.length - 1) setTour(false); else goTo(target + 1); } }
  const moved = Math.hypot(me.x - x0, me.z - z0); walked += moved; stir += ((me.wade > 0.15 && moved > 0.002 ? 1 : 0) - stir) * Math.min(1, dt * 2);
  bob += ((moved > 0.002 && !reduced ? 1 : 0) - bob) * Math.min(1, dt * 6);
  showPlate(facing(world, me)); audio.move(moved, me.wade, dt);
}
function draw() {
  camera.position.set(me.x, me.y + Math.sin(walked * 4.6) * 0.022 * bob, me.z); camera.rotation.set(me.pitch, me.yaw + (mode === 'start' && !reduced ? Math.sin(performance.now() / 5200) * 0.1 : 0), 0);
  uMe.value.set(me.x, me.z, stir); renderer.render(scene, camera); drawMap();
}
function frame(now) { const dt = last === null ? 0 : Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; if (!document.hidden) { advance(dt); draw(); } requestAnimationFrame(frame); }
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 78 : 62; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);

// ---- The plan in the corner ----
const mapBase = document.createElement('canvas'); { const u = 12; mapBase.width = world.cols * u; mapBase.height = world.rows * u; const g = mapBase.getContext('2d'); g.fillStyle = '#0c0e10'; g.fillRect(0, 0, mapBase.width, mapBase.height);
  for (const c of world.cells) { if (!c.open && !c.pillar) continue; g.fillStyle = c.pool ? '#2f8f97' : '#d9e2e1'; g.fillRect(c.c * u, c.r * u, u, u); if (c.sky) { g.fillStyle = '#ffffff'; g.fillRect(c.c * u + 3, c.r * u + 3, u - 6, u - 6); } if (c.pillar) { g.fillStyle = '#0c0e10'; g.beginPath(); g.arc((c.c + 0.5) * u, (c.r + 0.5) * u, 3, 0, 7); g.fill(); } } }
function drawMap() { if (mode !== 'walk') return; const c = $('map'), g = c.getContext('2d'), u = 12, X = x => (x / CELL + world.cols / 2) * u, Z = z => (z / CELL + world.rows / 2) * u; g.drawImage(mapBase, 0, 0);
  for (const p of world.photos) { g.fillStyle = shown === p ? '#3fe08a' : '#1a1d20'; g.strokeStyle = '#f4f5f3'; g.lineWidth = 1.5; g.beginPath(); g.arc(X(p.x + p.nx * 0.5), Z(p.z + p.nz * 0.5), shown === p ? 5 : 3.5, 0, 7); g.fill(); g.stroke(); }
  g.save(); g.translate(X(me.x), Z(me.z)); g.rotate(-me.yaw); g.fillStyle = '#3fe08a'; g.strokeStyle = '#06210f'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3.5); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke(); g.restore(); }

// ---- Sound: the hush of a big tiled room, a drip now and then, your steps, the water round your legs ----
const audio = (() => { let ctx = null, out = null, hush = null, slosh = null, since = 0, timer = 0;
  const noise = seconds => { const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), d = b.getChannelData(0); let v = 0; for (let i = 0; i < d.length; i++) { v = (v + (Math.random() * 2 - 1) * 0.06) * 0.985; d[i] = v * 6; } const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; return s; };
  const drip = () => { if (!ctx || !soundOn) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), f = 900 + Math.random() * 1100; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.05); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(g).connect(out); o.start(t); o.stop(t + 0.35); timer = setTimeout(drip, 2500 + Math.random() * 6000); };
  return {
    set(on) { soundOn = on; $('sound').setAttribute('aria-pressed', String(on)); clearTimeout(timer);
      if (on && !ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); out = ctx.createGain(); out.gain.value = 0; const echo = ctx.createDelay(1), back = ctx.createGain(); echo.delayTime.value = 0.31; back.gain.value = 0.42; out.connect(ctx.destination); out.connect(echo); echo.connect(back).connect(echo); back.connect(ctx.destination); // a long tiled echo
        hush = ctx.createGain(); hush.gain.value = 0.06; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; const n = noise(4); n.connect(lp).connect(hush).connect(out); n.start();
        slosh = ctx.createGain(); slosh.gain.value = 0; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.7; const n2 = noise(3); n2.connect(bp).connect(slosh).connect(out); n2.start(); }
      if (ctx) { if (on) ctx.resume(); out.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.15); if (on) timer = setTimeout(drip, 1500); } },
    hush(hidden) { if (ctx && soundOn) out.gain.setTargetAtTime(hidden ? 0 : 1, ctx.currentTime, 0.1); },
    move(moved, wade, dt) { if (!ctx || !soundOn) return; slosh.gain.setTargetAtTime(Math.min(0.5, wade * (moved / Math.max(dt, 1e-3)) * 0.16), ctx.currentTime, 0.12);
      since += wade < 0.1 ? moved : 0; if (since > 0.72) { since = 0; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.07); g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1); o.connect(g).connect(out); o.start(t); o.stop(t + 0.12); } } }; })();

// ---- Controls ----
const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
addEventListener('keydown', e => { if (e.ctrlKey || e.metaKey || e.altKey || $('all').open) return; const onButton = e.target.tagName === 'BUTTON';
  if (mode === 'start') { if (e.code === 'Enter' && !onButton) enter(false); return; }
  if (MOVE.has(e.code)) { keys.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); return; }
  if (e.code === 'PageDown' || e.code === 'KeyN') { e.preventDefault(); step(1); } else if (e.code === 'PageUp' || e.code === 'KeyP') { e.preventDefault(); step(-1); }
  else if (e.code === 'KeyT') setTour(!touring); else if (e.code === 'KeyM') audio.set(!soundOn); else if (e.code === 'KeyL') openList(); else if (e.code === 'Escape' && (touring || path)) { path = null; setTour(false); } });
addEventListener('keyup', e => keys.delete(e.code)); addEventListener('blur', () => { keys.clear(); stick.id = look.id = null; stick.x = stick.y = 0; $('stick').hidden = true; });
const stage = $('stage');
stage.addEventListener('pointerdown', e => { if (mode !== 'walk') return; e.preventDefault(); try { stage.setPointerCapture(e.pointerId); } catch (err) { /* works without */ }
  if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.45 && stick.id === null) { stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.x = stick.y = 0; const s = $('stick'); s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px'; s.firstElementChild.style.transform = ''; s.hidden = false; }
  else if (look.id === null) { look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; stage.classList.add('drag'); } });
stage.addEventListener('pointermove', e => {
  if (e.pointerId === stick.id) { let dx = (e.clientX - stick.ox) / 52, dy = (e.clientY - stick.oy) / 52; const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; } stick.x = dx; stick.y = dy; $('stick').firstElementChild.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`; }
  else if (e.pointerId === look.id) { const k = 0.0042 * (e.pointerType === 'touch' ? 1.4 : 1); me.yaw -= (e.clientX - look.x) * k; me.pitch = Math.max(-0.7, Math.min(0.7, me.pitch - (e.clientY - look.y) * k)); look.x = e.clientX; look.y = e.clientY; } });
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(ev, e => { if (e.pointerId === stick.id) { stick.id = null; stick.x = stick.y = 0; $('stick').hidden = true; } if (e.pointerId === look.id) { look.id = null; stage.classList.remove('drag'); } });
stage.addEventListener('contextmenu', e => e.preventDefault());
$('enter').addEventListener('click', () => enter(false)); $('enter-tour').addEventListener('click', () => enter(true));
$('next').addEventListener('click', () => step(1)); $('prev').addEventListener('click', () => step(-1)); $('tour').addEventListener('click', () => setTour(!touring)); $('sound').addEventListener('click', () => audio.set(!soundOn));
$('still').addEventListener('click', () => { still = !still; $('still').setAttribute('aria-pressed', String(still)); });
// Every plate as a list, for anyone who would sooner choose than walk.
function openList() { for (const b of $('plates').querySelectorAll('button')) b.setAttribute('aria-current', String(!!shown && Number(b.dataset.i) === shown.plate - 1)); $('all').showModal(); }
$('plates').append(...hung.map((p, i) => { const li = document.createElement('li'), b = document.createElement('button'), im = document.createElement('img'), s = document.createElement('span'); b.type = 'button'; b.dataset.i = i; im.src = p.file; im.alt = p.alt; im.loading = 'lazy'; im.width = 150; im.height = 104; s.textContent = `Plate ${two(p.plate)}`; b.append(im, s); b.addEventListener('click', () => { $('all').close(); if (touring) setTour(false); goTo(i); $('next').focus({ preventScroll: true }); }); li.append(b); return li; }));
$('list').addEventListener('click', openList); $('all-close').addEventListener('click', () => $('all').close());
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); last = null; } audio.hush(document.hidden); }); // a hidden tab makes no sound

// ---- Go ----
if (coarse) { document.documentElement.classList.add('touch'); $('touch-note').hidden = false; }
$('still').setAttribute('aria-pressed', String(still)); resize();
window.stillWater = { // for the automated checks
  ready: ready.then(() => { requestAnimationFrame(frame); return true; }),
  state: () => ({ mode, x: me.x, z: me.z, y: me.y, yaw: me.yaw, pitch: me.pitch, wade: me.wade, plate: shown ? shown.plate : 0, target, gliding: !!path, touring, still, soundOn, time: uTime.value, loaded: loaded.ok, failed: loaded.failed, clear: clear(world, me.x, me.z), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fov: camera.fov }),
  plates: () => hung.map(p => ({ plate: p.plate, x: p.x, z: p.z, w: p.w, h: p.h, alt: p.alt, view: viewPoint(world, world.photos[p.plate - 1], viewDist(p)) })),
  enter, goTo, place(x, z, yaw) { stand({ x, z, yaw }); }, fast(n) { for (let i = 0; i < n; i++) advance(1 / 60); draw(); return n; },
};
