// Identity detail: glossy shells, graphite joints and orange rings on the parts that
// move water. Instanced where there are many, so the look costs little to draw.
import * as THREE from 'three';
import { ACCENT } from './stage.js';

export const MAT = {
  shell: () => new THREE.MeshPhysicalMaterial({ color: 0xf6f4f0, roughness: 0.34, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.22, envMapIntensity: 0.7 }),
  graphite: () => new THREE.MeshPhysicalMaterial({ color: 0x1c1f23, roughness: 0.32, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.6 }),
  orange: () => new THREE.MeshPhysicalMaterial({ color: ACCENT, roughness: 0.38, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.3, envMapIntensity: 0.6 }),
  steel: () => new THREE.MeshPhysicalMaterial({ color: 0xc8ccd1, roughness: 0.42, metalness: 0.75, envMapIntensity: 0.6 }),
};

function ringsAlong(curve, every, r, tube, mat, startT = 0.04, endT = 0.97) {
  const L = curve.getLength(), n = Math.max(2, Math.floor(L / every));
  const geo = new THREE.TorusGeometry(r, tube, 8, 28);
  const im = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), z = new THREE.Vector3(0, 0, 1), s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const t = startT + (endT - startT) * i / (n - 1);
    const p = curve.getPointAt(t), tg = curve.getTangentAt(t);
    q.setFromUnitVectors(z, tg);
    m.compose(p, q, s); im.setMatrixAt(i, m);
  }
  im.castShadow = true;
  return im;
}

export function addDetails(S) {
  const orange = MAT.orange(), graphite = MAT.graphite();
  const out = { penRings: [], towerRings: [], genRings: [] };

  // penstocks: alternating orange flanges and graphite collars
  for (const p of S.curves.penstock) {
    const a = ringsAlong(p.c, 26, 5.05, 0.75, orange); a.userData.kind = 'penstock'; a.userData.sys = 'penstocks';
    const b = ringsAlong(p.c, 26, 4.95, 1.1, graphite, 0.06, 0.99); b.userData.kind = 'penstock'; b.userData.sys = 'penstocks';
    S.groups.tunnels.add(a, b); out.penRings.push(a, b);
  }
  // spillway tunnels: graphite collars
  for (const p of S.curves.spill) {
    const c = ringsAlong(p.c, 34, 8.2, 0.8, graphite); c.userData.kind = 'spill'; c.userData.sys = 'tunnels';
    S.groups.tunnels.add(c);
  }

  // intake towers: an orange band under the crown, graphite bands at the gate levels
  for (const [, x, z] of S.towers.spots) {
    const top = S.towers.baseY;
    const H = 125;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(12.15, 12.15, 4.2, 48, 1, true), orange);
    band.position.set(x, top + H - 26, z); band.userData.sys = 'towers'; S.groups.towers.add(band);
    for (const f of [0.18, 0.52]) {
      const g = new THREE.Mesh(new THREE.TorusGeometry(12.6, 0.9, 8, 48), graphite);
      g.rotation.x = Math.PI / 2; g.position.set(x, top + H * f + 3.5, z); g.userData.sys = 'towers'; S.groups.towers.add(g);
    }
    const cap = new THREE.Mesh(new THREE.TorusGeometry(9.6, 0.7, 8, 40), orange);
    cap.rotation.x = Math.PI / 2; cap.position.set(x, top + H + 2.5, z); cap.userData.sys = 'towers'; S.groups.towers.add(cap);
  }

  // generators: orange top ring and graphite foot ring
  const gTop = new THREE.TorusGeometry(7.3, 0.55, 8, 40), gFoot = new THREE.TorusGeometry(8.1, 0.8, 8, 40);
  for (const g of S.ph.gens) {
    const t = new THREE.Mesh(gTop, orange); t.rotation.x = Math.PI / 2; t.position.y = 66.6; g.group.add(t);
    const f = new THREE.Mesh(gFoot, graphite); f.rotation.x = Math.PI / 2; f.position.y = 61.6; g.group.add(f);
  }

  // powerhouse: a graphite glazing band along each wing and orange unit marks
  for (const w of S.ph.wings) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.6, 9, w.L - 8), graphite);
    band.position.set(w.cx - w.s * 13.4, 72, w.z0 + w.L / 2); band.userData.sys = 'powerhouse'; S.groups.powerhouse.add(band);
    const n = w.s < 0 ? 8 : 9;
    for (let k = 0; k < n; k++) {
      const z = w.z0 + 14 + k * ((w.L - 28) / (n - 1));
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.4, 1.6), orange);
      mark.position.set(w.cx - w.s * 13.5, 81, z); mark.userData.sys = 'powerhouse'; S.groups.powerhouse.add(mark);
    }
  }

  // spillways: graphite gate bodies with orange hinge pins
  for (const sp of S.spill) {
    for (const g of sp.gates) {
      for (const dz of [-13, 13]) {
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 5.2, 12), orange);
        pin.rotation.z = Math.PI / 2; pin.position.set(0, -1.8, dz); g.add(pin);
      }
    }
  }
  return out;
}
