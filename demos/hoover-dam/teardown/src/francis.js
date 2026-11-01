// One Hoover generating unit as a magnified study piece: glass spiral case,
// 20 stay vanes, 24 wicket gates that turn with the governor, a 13-blade Francis
// runner, the shaft and a 40-pole generator. Proportions are representative.
import * as THREE from 'three';
import { INK, ACCENT } from './stage.js';
import { MAT } from './details.js';

const ink = (m, th = 35, op = 0.5) => { const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, th), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: op })); l.raycast = () => {}; m.add(l); return m; };

function spiralCase() {
  const segT = 90, segR = 22, pos = [], idx = [];
  for (let i = 0; i <= segT; i++) {
    const th = i / segT * Math.PI * 1.9;
    const rc = 0.35 + 1.75 * (1 - th / (Math.PI * 2));
    const Rc = 3.55 + rc * 0.9;
    const cx = Math.cos(th) * Rc, cz = Math.sin(th) * Rc;
    for (let j = 0; j <= segR; j++) {
      const a = j / segR * Math.PI * 2;
      const rr = Rc + Math.cos(a) * rc;
      pos.push(Math.cos(th) * rr, Math.sin(a) * rc * 0.85, Math.sin(th) * rr);
    }
  }
  for (let i = 0; i < segT; i++) for (let j = 0; j < segR; j++) {
    const a = i * (segR + 1) + j, b = a + segR + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function blade(i, n) {
  const pos = [], idx = [], U = 10, V = 8;
  const base = i / n * Math.PI * 2;
  for (let a = 0; a <= U; a++) for (let b = 0; b <= V; b++) {
    const u = a / U, v = b / V;
    const r = 0.75 + u * 1.5 - v * 0.35 * u;
    const y = 0.75 - v * 1.6 + u * 0.15;
    const ph = base + 0.85 * u + 0.55 * v;
    pos.push(Math.cos(ph) * r, y, Math.sin(ph) * r);
  }
  for (let a = 0; a < U; a++) for (let b = 0; b < V; b++) {
    const p = a * (V + 1) + b, q = p + V + 1;
    idx.push(p, q, p + 1, q, q + 1, p + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export class FrancisUnit {
  constructor() {
    const root = new THREE.Group();
    this.root = root;
    const white = MAT.shell();
    const steel = MAT.steel();
    const graphite = MAT.graphite();
    const orange = MAT.orange();
    const copper = new THREE.MeshStandardMaterial({ color: 0xb06a3c, roughness: 0.5, metalness: 0.6 });
    this.glass = new THREE.MeshPhysicalMaterial({ color: 0x9fd0e0, roughness: 0.06, transparent: true, opacity: 0.2, depthWrite: false, clearcoat: 1, side: THREE.DoubleSide });
    this.accent = new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.45, metalness: 0.2, emissive: new THREE.Color(ACCENT), emissiveIntensity: 0.15 });
    this.parts = {};
    const part = (name) => { const g = new THREE.Group(); g.name = name; root.add(g); this.parts[name] = g; return g; };

    // spiral case + inlet
    const sc = part('spiral');
    const scase = ink(new THREE.Mesh(spiralCase(), this.glass), 60, 0.25); sc.add(scase);
    const inlet = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 6, 28, 1, true), this.glass);
    inlet.rotation.x = Math.PI / 2; inlet.position.set(3.55 + 2.1 * 0.9, 0, -3); sc.add(inlet);

    // stay ring
    const stay = part('stay');
    const ringTop = ink(new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.18, 64, 1, false), white)); ringTop.position.y = 0.95; stay.add(ringTop);
    const ringBot = ringTop.clone(); ringBot.position.y = -0.95; stay.add(ringBot);
    const sr = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.12, 6, 64), orange); sr.rotation.x = Math.PI / 2; sr.position.y = 1.05; stay.add(sr);
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2;
      const v = ink(new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.7, 0.9), white));
      v.position.set(Math.cos(a) * 3.25, 0, Math.sin(a) * 3.25); v.rotation.y = -a + 0.7; stay.add(v);
    }

    // wicket gates (the control surface: accent)
    const wg = part('wicket');
    this.gates = [];
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      const piv = new THREE.Group(); piv.position.set(Math.cos(a) * 2.72, 0, Math.sin(a) * 2.72);
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 0.95), this.accent); v.position.x = 0; piv.add(v);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), steel); piv.add(stem);
      piv.userData.a = a; wg.add(piv); this.gates.push(piv);
    }

    // runner: crown, band, 13 blades, hub cone
    const run = part('runner');
    const crown = ink(new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.2, 0.32, 48), steel), 40); crown.position.y = 0.9; run.add(crown);
    const band = ink(new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.25, 0.5, 48, 1, true), steel), 40); band.position.y = -0.75; run.add(band);
    for (let i = 0; i < 13; i++) run.add(new THREE.Mesh(blade(i, 13), steel));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 24), steel); cone.rotation.x = Math.PI; cone.position.y = -0.2; run.add(cone);
    this.runner = run;

    // draft tube
    const dt = part('draft');
    const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(2.05 + t * 1.0, -1.0 - t * 4.2)); }
    dt.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 40), this.glass));

    // shaft
    const sh = part('shaft');
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 9.5, 20), steel); shaft.position.y = 5.6; sh.add(shaft);
    this.shaft = sh;

    // generator: stator, rotor with 40 poles, exciter
    const st = part('stator');
    graphite.side = THREE.DoubleSide;
    const stator = ink(new THREE.Mesh(new THREE.CylinderGeometry(7.0, 7.0, 3.2, 80, 1, true, 0.6, Math.PI * 1.45), graphite), 50); stator.position.y = 11.6; st.add(stator);
    const statorIn = new THREE.Mesh(new THREE.CylinderGeometry(6.35, 6.35, 3.0, 80, 1, true, 0.6, Math.PI * 1.45), copper); statorIn.material.side = THREE.BackSide; statorIn.position.y = 11.6; st.add(statorIn);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(7.05, 0.28, 8, 80, Math.PI * 1.45), orange); rim.rotation.x = -Math.PI / 2; rim.rotation.z = -0.6; rim.position.y = 13.25; st.add(rim);
    const foot = new THREE.Mesh(new THREE.TorusGeometry(7.05, 0.28, 8, 80, Math.PI * 1.45), orange); foot.rotation.x = -Math.PI / 2; foot.rotation.z = -0.6; foot.position.y = 9.95; st.add(foot);
    const lid = ink(new THREE.Mesh(new THREE.RingGeometry(1.2, 7.0, 80, 1, 0.6, Math.PI * 1.45), white), 40); lid.rotation.x = -Math.PI / 2; lid.position.y = 13.25; st.add(lid);
    const rotorG = part('rotor');
    const spider = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 2.6, 48), graphite); spider.position.y = 11.6; rotorG.add(spider);
    this.poleMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.45, metalness: 0.5, emissive: new THREE.Color(ACCENT), emissiveIntensity: 0 });
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.62, 2.5, 0.42), this.poleMat);
      p.position.set(Math.cos(a) * 5.9, 11.6, Math.sin(a) * 5.9); p.rotation.y = -a; rotorG.add(p);
    }
    const exc = ink(new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.6, 32), white), 40); exc.position.y = 14.4; rotorG.add(exc);
    this.rotor = rotorG;
    root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

    this.e = 0; this.ev = 0; this.eTarget = 0; this.gateAngle = 0;
    // explode offsets (metres, before the inset scale)
    this.offsets = { stator: 4.6, rotor: 2.9, shaft: 1.6, runner: -2.0, draft: -4.0, spiral: -0.4, stay: 0, wicket: 0 };
  }

  explode(on) { this.eTarget = on ? 1 : 0; }

  update(unit, dt) {
    const k = 30, c = 7;
    this.ev += ((this.eTarget - this.e) * k - this.ev * c) * dt;
    this.e += this.ev * dt;
    for (const [n, off] of Object.entries(this.offsets)) this.parts[n].position.y = off * this.e;
    this.parts.spiral.position.x = -2.5 * this.e;
    // wicket gates: closed = vanes tangential and overlapping; open = turned toward radial
    const gate = unit ? (unit.on ? unit.gate : 0) : 0;
    this.gateAngle += (gate - this.gateAngle) * Math.min(1, dt * 3);
    for (const p of this.gates) p.rotation.y = -p.userData.a + Math.PI / 2 - this.gateAngle * 0.95;
    const rpm = unit?.rpm || 0;
    const w = rpm / 60 * Math.PI * 2 / 12; // shown at 1/12 speed
    this.runner.rotation.y += w * dt; this.rotor.rotation.y += w * dt; this.shaft.rotation.y += w * dt;
    const on = Math.min(1, (unit?.mw || 0) / 60);
    this.poleMat.color.set(0x8a8f96).lerp(this.accentCol || (this.accentCol = new THREE.Color(ACCENT)), on);
    this.poleMat.emissiveIntensity = on * 0.25;
  }
}
