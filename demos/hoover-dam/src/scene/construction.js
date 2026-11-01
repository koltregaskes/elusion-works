// Construction view (1931-1936): the dam rises as interlocking concrete columns
// poured in 5 ft lifts, with cofferdams and cableways across the canyon.

import * as THREE from 'three';
import { DAM, damSection, elevToY, clamp, terrainHeight } from './util.js';
import { phiMax, arcPoint } from './dam.js';
import { ELEV, HISTORY } from '../model/data.js';

function rand(i) { const x = Math.sin(i * 127.1 + 31.7) * 43758.5453; return x - Math.floor(x); }

export class Construction {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'construction';
    const NU = 30, NK = 5;
    const items = [];
    const ys = [];
    for (let y = 0; y <= DAM.crestY; y += 1) ys.push(y);
    for (let i = 0; i < NU; i++) {
      const u0 = i / NU * 2 - 1, u1 = (i + 1) / NU * 2 - 1, uc = (u0 + u1) / 2;
      // phi range at crest; the column's angle is fixed
      const rTop = DAM.R - damSection(DAM.crestY).up;
      const pmTop = phiMax(DAM.crestY, rTop, 4);
      const phi = uc * pmTop, dphi = (u1 - u0) * pmTop;
      // lowest y where the canyon is wide enough for this column
      let ymin = DAM.crestY;
      for (const y of ys) { const r = DAM.R - damSection(y).up; if (phiMax(y, r, 4) >= Math.abs(phi)) { ymin = y; break; } }
      for (let k = 0; k < NK; k++) {
        const d0 = k * DAM.baseT / NK;
        let ymax = 0;
        for (const y of ys) if (damSection(y).t > d0 + 2) ymax = y;
        if (ymax <= ymin) continue;
        const t = damSection(ymin).t;
        const depth = Math.min(DAM.baseT / NK, t - d0) - 0.8;
        if (depth <= 1) continue;
        items.push({ phi, dphi, ymin, ymax, d0, depth, jitter: (rand(i * 7 + k) - 0.5) * 22 + (k === 0 ? 4 : 0) });
      }
    }
    this.items = items;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#d9d1c2'; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(80,70,60,0.35)';
    for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 64, 1.5);
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.85 });
    this.mesh = new THREE.InstancedMesh(geo, mat, items.length);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 });
    const rock = new THREE.MeshStandardMaterial({ color: 0x7a6650, roughness: 1 });
    this.cofferUp = new THREE.Mesh(new THREE.BoxGeometry(150, 30, 40), rock);
    this.cofferUp.position.set(0, 40, -380);
    this.cofferDn = new THREE.Mesh(new THREE.BoxGeometry(150, 20, 30), rock);
    this.cofferDn.position.set(0, 36, 420);
    this.group.add(this.cofferUp, this.cofferDn);

    // Cableways: towers on both rims and lines across the canyon.
    this.cables = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: 0x1b1b1b });
    for (let k = 0; k < 5; k++) {
      const z = -20 + k * 45;
      const a = new THREE.Vector3(-200, terrainHeight(-200, z) + 30, z), b = new THREE.Vector3(200, terrainHeight(200, z) + 30, z);
      const pts = [];
      for (let i = 0; i <= 30; i++) { const t = i / 30; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * 18; pts.push(p); }
      this.cables.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
      for (const p of [a, b]) {
        const tw = new THREE.Mesh(new THREE.BoxGeometry(3, 30, 3), wood); tw.position.copy(p).add(new THREE.Vector3(0, -15, 0)); this.cables.add(tw);
      }
      const bucket = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.6, roughness: 0.5 }));
      bucket.userData = { a, b, k };
      this.cables.add(bucket);
    }
    this.group.add(this.cables);
    this.dummy = new THREE.Object3D();
    this.year = 1931.3;
    this.time = 0;
  }

  progress(year) { return clamp((year - 1933.43) / (1935.41 - 1933.43), 0, 1); }

  lakeElevation(year) {
    if (year < 1935.08) return year > 1932.87 ? ELEV.riverbed + 18 : ELEV.riverbed + 6;
    for (let i = 1; i < HISTORY.length; i++) {
      if (year <= HISTORY[i][0]) {
        const [t0, e0] = HISTORY[i - 1], [t1, e1] = HISTORY[i];
        return Math.max(ELEV.riverbed + 18, e0 + (e1 - e0) * (year - t0) / (t1 - t0));
      }
    }
    return HISTORY[HISTORY.length - 1][1];
  }

  set(year) {
    this.year = year;
    const f = this.progress(year);
    const m = this.dummy;
    this.items.forEach((it, i) => {
      const top = f <= 0 ? 0 : clamp(f * DAM.crestY * 1.12 + it.jitter * Math.sin(f * Math.PI) - 6, 0, DAM.crestY);
      const yTop = Math.min(it.ymax, Math.max(it.ymin, top));
      const h = Math.max(0.001, yTop - it.ymin);
      const r = DAM.R - damSection(it.ymin).up;
      const p = arcPoint(it.phi, r, it.ymin);
      p.z += it.d0 + it.depth / 2;
      m.position.copy(p);
      m.rotation.set(0, -it.phi, 0);
      m.scale.set(r * it.dphi * 0.96 + 0.01, h, it.depth);
      m.updateMatrix();
      this.mesh.setMatrixAt(i, m.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    const coffer = year > 1932.6 && year < 1935.1;
    this.cofferUp.visible = coffer; this.cofferDn.visible = coffer;
    this.cables.visible = year > 1932.9 && year < 1936.2;
    return { f, lakeElev: this.lakeElevation(year) };
  }

  update(dt) {
    this.time += dt;
    for (const b of this.cables.children) {
      if (!b.userData.a) continue;
      const t = 0.5 + 0.45 * Math.sin(this.time * 0.25 + b.userData.k * 1.7);
      b.position.copy(b.userData.a).lerp(b.userData.b, t);
      b.position.y -= Math.sin(t * Math.PI) * 18 + 6;
    }
  }
}
