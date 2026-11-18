// Elusion One: the camera itself, built from boxes, cylinders and a few drawn textures. No model file is loaded.
// It is not any real camera: the layout is an ordinary mirrorless body, the details are made up.
// Units are centimetres; see film.js for the axes. buildCamera returns the group to draw and handles for the page.
import * as THREE from 'three';
import { RoundedBoxGeometry } from '../../../_shared/three-r160/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BODY, LENS, PARTS } from './film.js';

const FINISH = { black: { plate: 0x33363b, rough: 0.4 }, silver: { plate: 0xc3c6ca, rough: 0.3 } };
// Small drawn textures: a pebbled wrap, knurling, the live picture on the back, and the name plate.
function drawn(w, h, paint, repeat) { const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); } return t; }
const pebble = () => drawn(256, 256, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; for (let i = 0; i < 5200; i++) { const v = 90 + Math.floor(r() * 110); g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.arc(r() * w, r() * h, 1 + r() * 2.2, 0, 7); g.fill(); } }, [5, 3]);
const knurl = turns => drawn(64, 8, (g, w, h) => { for (let x = 0; x < w; x += 8) { g.fillStyle = '#d0d0d0'; g.fillRect(x, 0, 4, h); g.fillStyle = '#303030'; g.fillRect(x + 4, 0, 4, h); } }, [turns, 1]);
const liveView = () => { const t = drawn(512, 320, (g, w, h) => { const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#16324a'); sky.addColorStop(0.55, '#e0915a'); sky.addColorStop(0.56, '#20262b'); sky.addColorStop(1, '#0c0f11'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffd9a8'; g.beginPath(); g.arc(w * 0.68, h * 0.5, 26, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5; for (const x of [w / 3, 2 * w / 3]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (const y of [h / 3, 2 * h / 3]) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.strokeStyle = '#3fe08a'; g.lineWidth = 3; g.strokeRect(w * 0.6, h * 0.36, 82, 82); g.fillStyle = '#fff'; g.font = '600 20px ui-monospace, Menlo, monospace'; g.fillText('1/250   f/2.8   ISO 200', 16, h - 16); }); t.colorSpace = THREE.SRGBColorSpace; return t; };
// The reflections in the front glass, painted on: a soft window, and the violet and green of a coated lens. They sit where the sphere faces forward.
const glints = () => { const t = drawn(512, 256, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); const cx = 128, cy = 128; const ring = (r, wd, col, a0, a1) => { g.strokeStyle = col; g.lineWidth = wd; g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke(); };
  const halo = g.createRadialGradient(cx, cy, 20, cx, cy, 120); halo.addColorStop(0, 'rgba(10,14,40,0)'); halo.addColorStop(0.7, 'rgba(46,28,96,.55)'); halo.addColorStop(1, 'rgba(10,60,70,.5)'); g.fillStyle = halo; g.fillRect(0, 0, 256, 256);
  g.filter = 'blur(3px)'; ring(92, 9, 'rgba(120,255,190,.75)', -2.5, -1.2); ring(74, 6, 'rgba(190,140,255,.7)', 0.4, 1.7); ring(52, 4, 'rgba(120,200,255,.5)', 2.6, 3.7); g.filter = 'blur(2px)'; g.fillStyle = 'rgba(255,255,255,.9)'; g.save(); g.translate(cx - 44, cy - 50); g.rotate(-0.5); g.fillRect(-16, -9, 34, 20); g.restore(); g.filter = 'none'; }); t.colorSpace = THREE.SRGBColorSpace; return t; };
// The aperture scale engraved round the lens.
const scale = () => { const t = drawn(1024, 64, (g, w, h) => { g.fillStyle = '#23252a'; g.fillRect(0, 0, w, h); g.fillStyle = '#e8eae8'; g.font = '600 26px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; ['16', '11', '8', '5.6', '4', '2.8'].forEach((n, i) => g.fillText(n, 300 + i * 56, 26)); for (let x = 0; x < w; x += 14) g.fillRect(x, 50, 2, x % 56 === 0 ? 14 : 8); g.fillStyle = '#3fe08a'; g.fillRect(438, 44, 4, 20); }); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t; };
// The letters on top of the mode dial, and the ticks on the dial beside it.
const dialTop = letters => { const t = drawn(256, 256, (g, w, h) => { g.fillStyle = '#2b2d31'; g.fillRect(0, 0, w, h); g.translate(w / 2, h / 2); g.fillStyle = '#e8eae8'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 30px "Helvetica Neue", Arial, sans-serif';
  const n = letters ? letters.length : 24; for (let i = 0; i < n; i++) { g.save(); g.rotate(i / n * Math.PI * 2); if (letters) g.fillText(letters[i], 0, -88); else g.fillRect(-2, -112, 4, i % 3 === 0 ? 26 : 14); g.restore(); } g.fillStyle = '#3fe08a'; g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill(); }); t.colorSpace = THREE.SRGBColorSpace; return t; };
const namePlate = () => { const t = drawn(512, 96, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#f4f5f3'; g.font = '700 54px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ELUSION ONE', w / 2, h / 2 + 2); }); t.colorSpace = THREE.SRGBColorSpace; return t; };

export function buildCamera() {
  const group = new THREE.Group(), shell = [], outlines = [], parts = new Map(), glow = [];
  const std = o => new THREE.MeshStandardMaterial(o), phys = o => new THREE.MeshPhysicalMaterial(o);
  const M = { // what the outside is made of
    plate: phys({ color: FINISH.black.plate, metalness: 0.92, roughness: FINISH.black.rough, clearcoat: 0.25, clearcoatRoughness: 0.4, envMapIntensity: 1.5 }),
    wrap: std({ color: 0x202226, metalness: 0.05, roughness: 0.82, bumpMap: pebble(), bumpScale: 0.035 }),
    rubber: std({ color: 0x0e0f10, metalness: 0, roughness: 0.96 }), gloss: phys({ color: 0x0a0b0c, metalness: 0.2, roughness: 0.22, clearcoat: 0.8 }), steel: phys({ color: 0xa9adb2, metalness: 1, roughness: 0.28 }),
    barrel: phys({ color: 0x25272a, metalness: 0.9, roughness: 0.36, envMapIntensity: 1.4 }), ring: std({ color: 0x1d1f22, metalness: 0.1, roughness: 0.8, bumpMap: knurl(72), bumpScale: 0.12 }), marks: std({ map: scale(), metalness: 0.55, roughness: 0.45 }), dial: phys({ color: 0x2a2c30, metalness: 0.95, roughness: 0.36, bumpMap: knurl(44), bumpScale: 0.05 }),
    front: phys({ color: 0x0d1020, emissive: 0xffffff, emissiveMap: glints(), emissiveIntensity: 0.85, metalness: 0.85, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 420], envMapIntensity: 2.2 }), // coated glass: nearly a mirror, with a violet-green cast
    baffle: std({ color: 0x050506, metalness: 0.2, roughness: 0.7, side: THREE.DoubleSide }),
    screen: new THREE.MeshBasicMaterial({ map: liveView(), toneMapped: false }), name: new THREE.MeshBasicMaterial({ map: namePlate(), transparent: true, opacity: 0.85 }),
  };
  const I = { // what the inside is made of
    alloy: phys({ color: 0x9aa0a6, metalness: 1, roughness: 0.45 }), dark: std({ color: 0x1b1d20, metalness: 0.4, roughness: 0.6 }), board: std({ color: 0x0f3b2e, metalness: 0.2, roughness: 0.55 }), chip: std({ color: 0x0b0c0d, metalness: 0.3, roughness: 0.4 }),
    copper: phys({ color: 0xc27a3e, metalness: 1, roughness: 0.35 }), gold: phys({ color: 0xd9b25c, metalness: 1, roughness: 0.3 }), cell: std({ color: 0x24272b, metalness: 0.2, roughness: 0.7 }), label: std({ color: 0x565c63, metalness: 0.1, roughness: 0.85 }), stripe: std({ color: 0x3fe08a, metalness: 0.1, roughness: 0.5 }),
    sensor: phys({ color: 0x1f6f78, metalness: 0.6, roughness: 0.12, iridescence: 1, iridescenceIOR: 1.9, clearcoat: 1 }), card: std({ color: 0x4a6ea8, metalness: 0.2, roughness: 0.5 }), lit: new THREE.MeshBasicMaterial({ color: 0xffe2b0 }),
    glass: phys({ color: 0xa8dcff, metalness: 0, roughness: 0, clearcoat: 1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }), blade: std({ color: 0x08090a, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }),
  };
  // Helpers. out: part of the outside, which fades when you look inside. Each kind of shape also leaves a thin outline for that view.
  const add = (geo, mat, pos, into = group, rot) => { const m = new THREE.Mesh(geo, mat); m.position.set(...pos); if (rot) m.rotation.set(...rot); m.castShadow = true; m.receiveShadow = true; into.add(m); return m; };
  const line = (geo, pos, rot) => { const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0xbfe9d6, transparent: true, opacity: 0, depthWrite: false })); l.position.set(...pos); if (rot) l.rotation.set(...rot); l.visible = false; group.add(l); outlines.push(l); };
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9fe6c8, transparent: true, opacity: 0, depthWrite: false }), ghosts = [];
  const out = m => { shell.push(m); const g = new THREE.Mesh(m.geometry, ghostMat); g.position.copy(m.position); g.rotation.copy(m.rotation); g.scale.copy(m.scale); g.visible = false; g.renderOrder = 2; (m.parent || group).add(g); ghosts.push([m, g]); return m; };
  const block = (w, h, d, r, mat, pos) => { out(add(new RoundedBoxGeometry(w, h, d, 5, r), mat, pos)); line(new THREE.BoxGeometry(w, h, d), pos); };
  const drum = (r, len, mat, pos, axis = 'y') => { const rot = axis === 'z' ? [Math.PI / 2, 0, 0] : undefined; out(add(new THREE.CylinderGeometry(r, r, len, 56), mat, pos, group, rot)); line(new THREE.CylinderGeometry(r, r, len, 40), pos, rot); };
  const inside = (id, build) => { const g = new THREE.Group(), own = new Map(); g.name = id; build((geo, mat, pos, rot) => { if (!own.has(mat)) own.set(mat, mat.clone()); const m = add(geo, own.get(mat), pos, g, rot); m.castShadow = false; return m; }); group.add(g); parts.set(id, g); return g; }; // each part has its own copies of its materials, so one part can be lit up without lighting its neighbours
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), cyl = (r, len, seg = 40) => new THREE.CylinderGeometry(r, r, len, seg), Z = [Math.PI / 2, 0, 0];
  const { x: lx, y: ly } = LENS, top = BODY.h / 2; // the lens axis, and the top of the body

  // ---- Outside ----
  block(BODY.w - 0.12, 6.6, BODY.d - 0.12, 0.7, M.wrap, [0, -0.9, 0]); block(BODY.w, 1.9, BODY.d, 0.5, M.plate, [0, 3.25, 0]); // wrapped body, and a top plate that stands a hair proud of it, so there is a seam where they meet
  block(0.1, 3.9, 2.7, 0.04, M.rubber, [BODY.w / 2 - 0.06, -0.6, -0.35]); // the card door, on the side away from the grip, over the card slot
  block(4.0, 2.2, 3.6, 0.5, M.plate, [0, 5.0, -0.2]); block(1.9, 0.14, 1.9, 0.04, M.steel, [0, 6.17, -0.3]); for (const sx of [-1, 1]) { block(0.2, 0.2, 1.9, 0.03, M.steel, [sx * 0.85, 6.33, -0.3]); block(0.42, 0.06, 1.9, 0.02, M.steel, [sx * 0.74, 6.45, -0.3]); } block(1.5, 0.2, 0.16, 0.03, M.steel, [0, 6.33, -1.17]); // the shoe: a floor, two rails with lips, and a stop at the back
  for (const [x, z, r] of [[0, -0.3, 0.17], [-0.38, 0.15, 0.08], [0.38, 0.15, 0.08], [0, 0.32, 0.08]]) out(add(cyl(r, 0.02, 18), I.gold, [x, 6.25, z])); block(2.8, 2.0, 0.9, 0.35, M.rubber, [0, 4.9, -2.4]); // viewfinder hump, shoe, eyecup
  out(add(new THREE.PlaneGeometry(2.9, 0.54), M.name, [0, 5.0, 1.61]));
  block(3.3, 7.4, 2.8, 1.1, M.wrap, [-5.05, -0.5, 1.9]); // grip
  drum(0.9, 0.25, M.steel, [-5.1, top + 0.125, 2.0]); M.button = M.plate.clone(); const release = out(add(cyl(0.55, 0.35), M.button, [-5.1, top + 0.42, 2.0])); release.name = 'release'; parts.set('release', release);
  M.mode = M.dial.clone(); const dial = out(add(cyl(1.15, 0.75, 64), M.mode, [3.4, top + 0.375, 0.1])); dial.name = 'dial'; parts.set('dial', dial); line(cyl(1.15, 0.75), [3.4, top + 0.375, 0.1]); drum(0.9, 0.6, M.dial, [5.5, top + 0.3, 0.3]);
  out(add(new THREE.CircleGeometry(1.02, 40), std({ map: dialTop(['M', 'A', 'S', 'P', 'C1', 'C2', '\u25CF', 'B']), metalness: 0.6, roughness: 0.4 }), [3.4, top + 0.755, 0.1], group, [-Math.PI / 2, 0, 0])); out(add(new THREE.CircleGeometry(0.8, 36), std({ map: dialTop(null), metalness: 0.6, roughness: 0.4 }), [5.5, top + 0.605, 0.3], group, [-Math.PI / 2, 0, 0]));
  for (const sx of [-1, 1]) out(add(new THREE.TorusGeometry(0.34, 0.09, 10, 24), M.steel, [sx * (BODY.w / 2 + 0.12), 3.1, 0], group, [0, Math.PI / 2, 0])); // strap lugs
  out(add(cyl(0.38, 0.3), M.gloss, [4.5, -1.7, BODY.d / 2 + 0.05], group, Z)); out(add(new THREE.SphereGeometry(0.3, 20, 12), M.gloss, [-2.75, 2.95, BODY.d / 2 - 0.05])); // lens release on the far side of the mount; the lamp between the grip and the lens
  // Lens: mount, barrel, focus ring, aperture ring, front, and the glass you see from outside.
  drum(3.25, 0.5, M.steel, [lx, ly, 2.35], 'z'); drum(3.0, 1.3, M.barrel, [lx, ly, 3.25], 'z'); drum(LENS.r, 2.3, M.ring, [lx, ly, 5.05], 'z'); drum(3.05, 0.9, M.marks, [lx, ly, 6.65], 'z'); out(add(new THREE.CylinderGeometry(3.15, 3.15, 1.9, 56, 1, true), M.barrel, [lx, ly, 8.05], group, Z)); line(new THREE.CylinderGeometry(3.15, 3.15, 1.9, 40), [lx, ly, 8.05], Z); // the front of the barrel is a tube, open at the end, so you look down it to the glass
  out(add(cyl(2.44, 0.6, 48), M.gloss, [lx, ly, 8.1], group, Z));
  const frontGlass = out(add(new THREE.SphereGeometry(2.45, 48, 24), M.front, [lx, ly, 8.4])); frontGlass.scale.set(1, 1, 0.2);
  for (const [r0, r1, z, len] of [[3.15, 2.85, 8.86, 0.28], [2.85, 2.6, 8.62, 0.2], [2.6, 2.45, 8.46, 0.12]]) out(add(new THREE.CylinderGeometry(r0, r1, len, 56, 1, true), M.baffle, [lx, ly, z], group, Z)); // stepped rings leading down to the glass
  out(add(new THREE.TorusGeometry(3.15, 0.05, 8, 72), M.steel, [lx, ly, LENS.front]));
  // Back: screen, eyepiece glass, buttons.
  block(8.0, 5.2, 0.2, 0.08, M.gloss, [1.0, -0.9, -BODY.d / 2 - 0.06]); const screen = out(add(new THREE.PlaneGeometry(7.4, 4.62), M.screen, [1.0, -0.9, -BODY.d / 2 - 0.17], group, [0, Math.PI, 0])); screen.name = 'screen'; parts.set('screen', screen);
  out(add(new THREE.CircleGeometry(0.62, 28), M.gloss, [0, 4.9, -2.86], group, [0, Math.PI, 0]));
  // The controls are behind the grip, under the right thumb: seen from the back the grip is on the right.
  const rear = []; for (const [x, y, r] of [[-5.3, 0.9, 0.34], [-5.3, -0.1, 0.34], [-5.3, -3.4, 0.3], [-4.4, -3.4, 0.3]]) rear.push(out(add(cyl(r, 0.22, 24), M.gloss, [x, y, -BODY.d / 2 - 0.03], group, Z)));
  rear.push(out(add(new THREE.TorusGeometry(0.72, 0.16, 10, 36), M.plate, [-5.3, -1.75, -BODY.d / 2 - 0.05]))); rear.push(out(add(cyl(0.42, 0.2, 24), M.gloss, [-5.3, -1.75, -BODY.d / 2 - 0.03], group, Z))); block(1.5, 2.0, 0.35, 0.16, M.rubber, [-5.4, 2.4, -BODY.d / 2 - 0.02]); rear.push(shell[shell.length - 1]);

  // ---- Inside ----
  inside('sensor', a => { a(box(4.8, 3.6, 0.3), I.dark, [lx, ly, -0.4]); a(box(3.6, 2.4, 0.1), I.sensor, [lx, ly, -0.2]); a(box(3.9, 2.7, 0.05), I.glass, [lx, ly, -0.08]); for (const sx of [-1, 1]) a(box(0.25, 3.0, 0.08), I.gold, [lx + sx * 2.2, ly, -0.24]); });
  inside('stabiliser', a => { for (const [w, h, x, y] of [[6.4, 0.5, 0, 2.3], [6.4, 0.5, 0, -2.3], [0.5, 4.1, 2.95, 0], [0.5, 4.1, -2.95, 0]]) a(box(w, h, 0.45), I.alloy, [lx + x, ly + y, -0.6]); for (const [x, y] of [[2.1, -1.5], [-2.1, -1.5], [2.1, 1.5], [-2.1, 1.5]]) { a(box(1.2, 0.9, 0.3), I.copper, [lx + x, ly + y, -0.78]); a(box(0.9, 0.6, 0.2), I.dark, [lx + x, ly + y, -0.56]); } });
  inside('shutter', a => { for (const [w, h, x, y] of [[5.2, 0.45, 0, 1.9], [5.2, 0.45, 0, -1.9], [0.45, 3.4, 2.4, 0], [0.45, 3.4, -2.4, 0]]) a(box(w, h, 0.4), I.dark, [lx + x, ly + y, 0.75]); for (let k = 0; k < 4; k++) a(box(4.4, 0.42, 0.04), I.blade, [lx, ly + 1.45 - k * 0.1, 0.7 + k * 0.035]); /* drawn open: the blades are stacked at the top of the gate */ a(cyl(0.3, 0.5, 20), I.copper, [lx + 2.9, ly + 1.2, 0.75], Z); });
  inside('board', a => { a(box(9.0, 5.6, 0.12), I.board, [0.3, 0.2, -1.25]); a(box(2.0, 2.0, 0.22), I.chip, [3.6, 1.6, -1.12]); a(box(1.4, 0.9, 0.18), I.chip, [1.2, 2.2, -1.14]); a(box(1.1, 1.1, 0.18), I.chip, [-2.4, 1.7, -1.14]); a(box(2.6, 0.5, 0.2), I.dark, [-1.8, -2.1, -1.13]);
    for (let k = 0; k < 9; k++) a(box(0.22, 0.22, 0.1), I.gold, [-3.4 + k * 0.5, -1.2, -1.16]); for (const [x, y] of [[3.7, -0.4], [2.8, -1.6], [-3.6, 0.4]]) a(cyl(0.22, 0.3, 14), I.alloy, [x, y, -1.05], Z); a(box(2.2, 1.6, 0.2), I.chip, [2.6, -0.6, -1.4]); });
  inside('battery', a => { a(new RoundedBoxGeometry(2.4, 5.0, 1.8, 3, 0.22), I.cell, [-5.0, -1.2, 1.3]); a(box(1.7, 2.9, 0.03), I.label, [-5.0, -0.8, 2.205]); a(box(1.1, 0.1, 0.03), I.stripe, [-5.0, 0.35, 2.215]); for (const x of [-0.55, 0, 0.55]) a(box(0.34, 0.05, 0.7), I.gold, [-5.0 + x, -3.71, 1.3]); }); // a flat cell with a label on its face and its contacts at the bottom end
  inside('cards', a => { a(box(0.9, 3.8, 2.7), I.dark, [5.6, -0.6, -0.4]); for (const x of [5.42, 5.78]) { a(box(0.14, 3.2, 2.4), I.card, [x, -0.6, -0.4]); a(box(0.15, 0.5, 2.0), I.gold, [x, -2.0, -0.4]); } });
  inside('finder', a => { a(box(1.5, 1.05, 0.25), I.dark, [0, 4.6, 0.6]); a(box(1.3, 0.85, 0.06), I.lit, [0, 4.6, 0.44]); a(cyl(0.72, 1.3, 28), I.glass, [0, 4.6, -0.5], Z); a(cyl(0.78, 0.25, 28), I.alloy, [0, 4.6, -1.3], Z); a(cyl(0.6, 0.5, 28), I.glass, [0, 4.6, -1.8], Z); });
  inside('glass', a => { for (const [z, r, t] of [[3.0, 1.9, 0.3], [3.45, 2.0, 0.35], [4.4, 2.15, 0.5], [5.9, 2.3, 0.4], [6.45, 2.4, 0.45], [7.5, 2.55, 0.5], [8.25, 2.55, 0.35]]) { const e = a(new THREE.SphereGeometry(r, 36, 18), I.glass, [lx, ly, z]); e.scale.set(1, 1, t / (2 * r)); e.renderOrder = 1; a(new THREE.TorusGeometry(r, 0.035, 6, 48), I.alloy, [lx, ly, z]); }
    const iris = a(new THREE.RingGeometry(1.0, 2.3, 7, 1), I.blade, [lx, ly, 5.15]); iris.rotation.z = 0.3; a(new THREE.TorusGeometry(2.35, 0.1, 8, 40), I.alloy, [lx, ly, 5.15]); }); // seven pieces of glass in five groups, each in its mount, and the seven-sided iris between them

  for (const p of PARTS) if (!parts.has(p.id)) throw new Error(`The part list names "${p.id}" but the model has no such part`);
  const mats = [...new Set(shell.map(m => m.material))];
  for (const [m, g] of ghosts) { g.position.copy(m.position); g.rotation.copy(m.rotation); g.scale.copy(m.scale); } // a twin made before its mesh was moved or squashed must follow it
  return { group, parts,
    // How far the outside has faded away: 0 solid, 1 a ghost with its outlines drawn.
    setOpen(k) { const fade = Math.min(1, k / 0.6), solid = fade < 1, ghost = k > 0.002; // the solid outside fades over the first part of the change; a faint tinted shape and thin outlines are what is left
      for (const m of mats) { const see = ghost || m === M.name; if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; } m.opacity = (m === M.name ? 0.85 : 1) * (1 - fade); } // a material that turns see-through has to be rebuilt, or it goes on drawing solid. It keeps writing depth, so the outside never shows through itself
      ghostMat.opacity = 0.055 * k; for (const [m, g] of ghosts) { m.visible = solid; m.castShadow = k < 0.3; m.renderOrder = ghost ? 2 : 0; g.visible = ghost; g.position.copy(m.position); g.rotation.copy(m.rotation); g.scale.copy(m.scale); } for (const l of outlines) { l.visible = ghost; l.material.opacity = k * 0.5; l.renderOrder = 3; } },
    setFinish(name) { const f = FINISH[name] || FINISH.black; for (const m of [M.plate, M.button]) { m.color.setHex(f.plate); m.roughness = f.rough; } for (const m of [M.dial, M.mode]) m.color.setHex(name === 'silver' ? 0xaeb2b7 : 0x2a2c30); },
    // Light a part up for a moment, so the eye finds it.
    glow(id, k) { for (const g of parts.values()) g.traverse(o => { if (o.isMesh && o.material.emissive) o.material.emissive.setRGB(0, 0, 0); }); const g = parts.get(id); if (g && k > 0) g.traverse(o => { if (o.isMesh && o.material.emissive) o.material.emissive.setRGB(0.009 * k, 0.065 * k, 0.032 * k); }); }, rear,
  };
}
