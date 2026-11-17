// The booster: original procedural model of a 71 m steel first stage.
// Local frame: base centre at the origin, +Y up the body.
import * as THREE from 'three';
import { SITE, ENGINES, engineLevel } from './flight.js';
import { canvasTexture, rng } from './world.js';

const R = SITE.boosterRadius;

export function makeBooster(mats) {
  const g = new THREE.Group();
  const add = (mesh, temp, shadow = true) => { mesh.castShadow = shadow; mesh.receiveShadow = shadow; mesh.userData.temp = temp; g.add(mesh); return mesh; };

  // Steel skin: stacked rings, each a slightly different finish, soot toward the engines.
  const rings = 37, rnd = rng(3);
  const tone = Array.from({ length: rings }, () => rnd());
  const skin = canvasTexture(1024, 2048, (c, w, h) => {
    for (let i = 0; i < rings; i++) {
      const y0 = h - ((i + 1) / rings) * h, v = 176 + Math.round(tone[i] * 44);
      c.fillStyle = `rgb(${v},${v + 2},${v + 6})`; c.fillRect(0, y0, w, h / rings + 1);
      c.fillStyle = 'rgba(40,42,48,0.55)'; c.fillRect(0, y0, w, 2);
      const seam = Math.floor(tone[i] * w); c.fillStyle = 'rgba(60,62,70,0.35)'; c.fillRect(seam, y0, 2, h / rings);
    }
    const soot = c.createLinearGradient(0, h, 0, h * 0.62); soot.addColorStop(0, 'rgba(34,26,20,0.85)'); soot.addColorStop(0.35, 'rgba(60,48,38,0.38)'); soot.addColorStop(1, 'rgba(60,48,38,0)');
    c.fillStyle = soot; c.fillRect(0, h * 0.6, w, h * 0.4);
    for (let i = 0; i < 90; i++) { const x = rnd() * w, len = 60 + rnd() * 420; const s = c.createLinearGradient(0, h, 0, h - len); s.addColorStop(0, `rgba(30,24,20,${0.10 + rnd() * 0.2})`); s.addColorStop(1, 'rgba(30,24,20,0)'); c.fillStyle = s; c.fillRect(x, h - len, 3 + rnd() * 14, len); }
  });
  const rough = canvasTexture(64, 512, (c, w, h) => {
    for (let i = 0; i < rings; i++) { const v = 62 + Math.round(tone[(i * 7) % rings] * 70); c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(0, h - ((i + 1) / rings) * h, w, h / rings + 1); }
    const s = c.createLinearGradient(0, h, 0, h * 0.7); s.addColorStop(0, 'rgba(215,215,215,0.9)'); s.addColorStop(1, 'rgba(215,215,215,0)'); c.fillStyle = s; c.fillRect(0, h * 0.7, w, h * 0.3);
  }, { linear: true });
  const glow = canvasTexture(8, 256, (c, w, h) => {
    const s = c.createLinearGradient(0, h, 0, 0); s.addColorStop(0, '#ff7a2a'); s.addColorStop(0.035, '#c2400f'); s.addColorStop(0.09, '#3a0d02'); s.addColorStop(0.16, '#000'); s.addColorStop(1, '#000'); c.fillStyle = s; c.fillRect(0, 0, w, h);
  });
  const bodyMat = new THREE.MeshStandardMaterial({ map: skin, roughnessMap: rough, roughness: 1, metalness: 0.96, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 0, envMapIntensity: 1.15 });
  const bodyH = 66.5;
  const body = add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, bodyH, 72, 1, true), bodyMat), 'body');
  body.position.y = bodyH / 2;

  // Top: staging interface and dome (the staging ring was dropped earlier in the flight)
  const top = add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.965, R, 1.6, 72, 1, true), mats.dark), 0.3); top.position.y = bodyH + 0.8;
  const dome = add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.965, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.steelPlain), 0.3); dome.scale.y = 0.5; dome.position.y = bodyH + 1.6;

  // Engine bay floor and 33 nozzles
  const floor = add(new THREE.Mesh(new THREE.CircleGeometry(R, 48), mats.dark), 'engine', false); floor.rotation.x = Math.PI / 2; floor.position.y = 0.6;
  const nozGeo = new THREE.CylinderGeometry(0.34, 0.66, 1.9, 16, 1, true);
  const nozzles = new THREE.InstancedMesh(nozGeo, mats.nozzle, 33), cores = new THREE.InstancedMesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 33);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  ENGINES.forEach((e, i) => {
    const x = Math.cos(e.a) * e.r, z = Math.sin(e.a) * e.r;
    nozzles.setMatrixAt(i, m4.makeTranslation(x, -0.35, z));
    cores.setMatrixAt(i, m4.compose(new THREE.Vector3(x, -1.25, z), q, new THREE.Vector3(1, 1, 1)));
    cores.setColorAt(i, new THREE.Color(0x050505));
  });
  nozzles.userData.temp = 'engine'; nozzles.castShadow = true; g.add(nozzles);
  cores.userData.kind = 'glow'; g.add(cores);

  // Chines along the lower body, and one cable raceway
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2, ch = add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 27, 1.9), mats.steelPlain), 0.4);
    ch.position.set(Math.cos(a) * (R + 0.35), 15.5, Math.sin(a) * (R + 0.35)); ch.rotation.y = -a;
  }
  const race = add(new THREE.Mesh(new THREE.BoxGeometry(0.35, 33, 0.7), mats.dark), 0.35); race.position.set(Math.cos(1.2) * (R + 0.1), 46, Math.sin(1.2) * (R + 0.1)); race.rotation.y = -1.2;

  // Catch pins: the two small posts the whole booster hangs from
  for (const s of [-1, 1]) {
    const pin = add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.5, 14), mats.dark), 0.4); pin.rotation.x = Math.PI / 2; pin.position.set(0, SITE.pinY + 0.34, s * (R + 0.6));
    const gus = add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 0.5), mats.steelPlain), 0.4); gus.position.set(0, SITE.pinY + 0.2, s * (R + 0.12));
  }

  // Grid fins: lattice plates on four hinges near the top
  const lattice = canvasTexture(256, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h); c.strokeStyle = '#fff'; c.lineWidth = 7;
    c.strokeRect(6, 6, w - 12, h - 12);
    c.lineWidth = 4; for (let i = -8; i <= 16; i++) { c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32 + h, h); c.moveTo(i * 32, h); c.lineTo(i * 32 + h, 0); c.stroke(); }
  });
  const finMat = new THREE.MeshStandardMaterial({ color: 0x8d9198, alphaMap: lattice, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.85, roughness: 0.5 });
  const fins = [];
  for (const deg of [35, 145, 215, 325]) {
    const a = (deg * Math.PI) / 180, hub = new THREE.Group(), fin = new THREE.Group();
    hub.position.set(Math.cos(a) * R, 63.6, Math.sin(a) * R); hub.rotation.y = -a; // local +X points outward
    for (const dy of [-0.2, 0, 0.2]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 6.4), finMat); p.rotation.x = -Math.PI / 2; p.position.set(2.95, dy, 0); p.castShadow = true; p.userData.temp = 0.5; fin.add(p); }
    const root = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.1, 3.2), mats.dark); root.position.x = 0.2; root.castShadow = true; root.userData.temp = 0.45; fin.add(root);
    hub.add(fin); g.add(hub); fins.push(fin);
  }

  // Inside (shown in blueprint view): tank domes and the transfer tube
  const inside = new THREE.Group(); inside.visible = false; g.add(inside);
  const domeGeo = new THREE.SphereGeometry(R * 0.97, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const [y, flip] of [[27.5, 1], [27.5, -1], [4.2, 1], [64.5, -1]]) { const d = new THREE.Mesh(domeGeo, mats.steelPlain); d.scale.y = 0.42 * flip; d.position.y = y; d.userData.temp = 0.1; inside.add(d); }
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 23, 16, 1, true), mats.steelPlain); tube.position.y = 15.5; tube.userData.temp = 0.1; inside.add(tube);

  const coreColor = new THREE.Color();
  function update(s) {
    for (let i = 0; i < 13; i++) {
      const l = engineLevel(i, s.t), rest = s.heat * 0.5 + s.fire * 0.25;
      coreColor.setRGB(0.02 + 5.5 * l + 0.9 * rest, 0.02 + 4.2 * l + 0.28 * rest, 0.02 + 5.0 * l + 0.05 * rest); cores.setColorAt(i, coreColor);
    }
    for (let i = 13; i < 33; i++) { coreColor.setRGB(0.02 + 0.7 * s.heat, 0.02 + 0.2 * s.heat, 0.02); cores.setColorAt(i, coreColor); }
    cores.instanceColor.needsUpdate = true;
    bodyMat.emissiveIntensity = 2.2 * s.heat + 0.5 * s.thrust + 0.3 * s.fire;
    fins.forEach((f, k) => { f.rotation.x = s.fins[k]; });
  }
  return { group: g, update, inside, bodyMat };
}
