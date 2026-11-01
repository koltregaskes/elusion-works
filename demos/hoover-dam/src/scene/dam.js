// Built structures: the arch-gravity dam, intake towers, spillways, powerhouse wings,
// penstock and spillway tunnels, and the Memorial Bridge. Each subsystem is its own
// group so the UI can isolate, ghost or x-ray it.

import * as THREE from 'three';
import { DAM, damSection, damHalfWidthAt, elevToY, terrainHeight, SPILL, clamp } from './util.js';
import { ELEV } from '../model/data.js';
import { UNIT_IDS } from '../model/hydro.js';
import { concreteTexture, powerhouseTextures, clockFace } from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Rectangular sweep along a horizontal-ish polyline. Returns BufferGeometry.
export function sweepBox(points, width, height) {
  const pos = [], idx = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    const t = b.clone().sub(a); t.y = 0; t.normalize();
    const s = V(-t.z, 0, t.x).multiplyScalar(width / 2);
    const c = [p.clone().add(s), p.clone().sub(s), p.clone().sub(s).setY(p.y + height), p.clone().add(s).setY(p.y + height)];
    for (const q of c) pos.push(q.x, q.y, q.z);
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < 4; k++) {
      const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = (i + 1) * 4 + (k + 1) % 4, d = (i + 1) * 4 + k;
      idx.push(a, b, c, a, c, d);
    }
  }
  idx.push(0, 1, 2, 0, 2, 3);
  const e = (n - 1) * 4; idx.push(e, e + 2, e + 1, e, e + 3, e + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function arcPoint(phi, r, y) {
  return V(r * Math.sin(phi), y, DAM.cz - r * Math.cos(phi));
}
export function phiMax(y, r, embed = 16) {
  return Math.asin(clamp((damHalfWidthAt(y) + embed) / r, 0, 0.999));
}

function buildDamMesh(uniforms) {
  const NY = 56, NU = 72;
  const pos = [], uv = [], face = [], idx = [];
  const rows = [];
  for (let j = 0; j <= NY; j++) {
    const y = DAM.crestY * j / NY;
    const { t, up } = damSection(y);
    const r = DAM.R - up;
    const pm = phiMax(y, r);
    rows.push({ y, t, r, pm });
  }
  // Upstream face, downstream face.
  const grid = (side) => {
    const base = pos.length / 3;
    for (let j = 0; j <= NY; j++) {
      const { y, t, r, pm } = rows[j];
      for (let i = 0; i <= NU; i++) {
        const u = i / NU * 2 - 1, phi = u * pm;
        const p = arcPoint(phi, r, y);
        if (side === 1) p.z += t;
        pos.push(p.x, p.y, p.z);
        uv.push((phi * r) / 30, y / 15);
        face.push(side === 0 ? 1 : 0);
      }
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NU; i++) {
      const a = base + j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
      if (side === 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  };
  grid(0); grid(1);
  // Crest top strip.
  const base = pos.length / 3;
  const top = rows[NY];
  for (let i = 0; i <= NU; i++) {
    const phi = (i / NU * 2 - 1) * top.pm;
    const p = arcPoint(phi, top.r, top.y), q = p.clone(); q.z += top.t;
    pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
    uv.push(phi * top.r / 30, 0, phi * top.r / 30, 0.5);
    face.push(0, 0);
  }
  for (let i = 0; i < NU; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 1));
  g.setIndex(idx);
  g.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ map: concreteTexture(), color: 0xc4bcae, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWaterY = uniforms.uWaterY;
    sh.uniforms.uMode = uniforms.uMode;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFace; varying float vFace; varying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFace = aFace; vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vFace; varying vec3 vWPos; uniform float uWaterY; uniform float uMode;
        vec3 heat(float t){ t = clamp(t,0.0,1.0);
          return mix(mix(vec3(0.10,0.25,0.65), vec3(0.15,0.75,0.70), smoothstep(0.0,0.35,t)),
                     mix(vec3(0.98,0.80,0.25), vec3(0.95,0.25,0.15), smoothstep(0.65,1.0,t)), smoothstep(0.35,0.7,t)); }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += hdGlow;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 hdGlow = vec3(0.0);
        {
          float wet = vFace * step(vWPos.y, uWaterY);
          diffuseColor.rgb *= 1.0 - wet * 0.35;
          if (uMode > 0.5 && uMode < 1.5) {
            float d = max(0.0, uWaterY - vWPos.y);
            float t = d / 221.0;
            vec3 h = heat(t);
            float lines = smoothstep(0.92, 1.0, fract(d / 15.24));
            vec3 up = mix(h, vec3(1.0), lines * 0.35) * step(0.001, d) + vec3(0.25) * step(d, 0.001);
            // downstream face: compression proxy, highest at base and abutments
            float comp = clamp((1.0 - vWPos.y / 221.0) * (0.55 + 0.45 * abs(vWPos.x) / 120.0) * (uWaterY / 221.0) * 1.2, 0.0, 1.0);
            vec3 dn = mix(diffuseColor.rgb * 0.8, mix(vec3(0.98,0.80,0.25), vec3(0.95,0.25,0.15), smoothstep(0.45,1.0,comp)), smoothstep(0.1, 0.6, comp));
            diffuseColor.rgb = mix(dn, up, vFace);
            hdGlow = diffuseColor.rgb * mix(0.25, 0.55, vFace);
          }
        }`);
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.name = 'dam-body';
  return mesh;
}

function buildCrest(group) {
  const top = (() => { const { t, up } = damSection(DAM.crestY); return { t, r: DAM.R - up }; })();
  const pm = phiMax(DAM.crestY, top.r, 2);
  const pts = (off) => { const a = []; for (let i = 0; i <= 64; i++) { const phi = (i / 64 * 2 - 1) * pm; const p = arcPoint(phi, top.r, DAM.crestY); p.z += off; a.push(p); } return a; };
  const conc = new THREE.MeshStandardMaterial({ color: 0xb9b0a1, roughness: 0.8 });
  const road = new THREE.MeshStandardMaterial({ color: 0x3b3b3d, roughness: 0.9 });
  const parA = new THREE.Mesh(sweepBox(pts(0.6), 1.0, 1.4), conc);
  const parB = new THREE.Mesh(sweepBox(pts(top.t - 0.6), 1.0, 1.4), conc);
  const rd = new THREE.Mesh(sweepBox(pts(top.t / 2), top.t - 4.5, 0.12), road);
  for (const m of [parA, parB, rd]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  // Lamp posts with glow sprites (night).
  const lamps = [];
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 5, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2f3134, roughness: 0.6, metalness: 0.5 });
  for (let i = 0; i <= 14; i++) {
    const phi = (i / 14 * 2 - 1) * pm * 0.95;
    for (const off of [0.6, top.t - 0.6]) {
      const p = arcPoint(phi, top.r, DAM.crestY + 1.4); p.z += off;
      const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.copy(p).add(V(0, 2.5, 0)); group.add(pole);
      lamps.push(p.clone().add(V(0, 5.2, 0)));
    }
  }
  // State-line marker at the crown, plus the Winged Figures plinth on the Nevada end.
  const nevadaEnd = arcPoint(-pm * 0.98, top.r, DAM.crestY);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), conc);
  plinth.position.copy(nevadaEnd).add(V(-6, 2, 22)); group.add(plinth);
  const bronze = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.35, metalness: 0.9 });
  for (const sx of [-1.4, 1.4]) {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.9, 9, 4), bronze);
    wing.position.copy(plinth.position).add(V(sx, 6.5, 0)); group.add(wing);
  }
  const flag = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 42, 6), poleMat);
  flag.position.copy(plinth.position).add(V(0, 21, 4)); group.add(flag);
  return { lamps, crestPm: pm, top };
}

function buildTowers(group, uniforms) {
  const conc = new THREE.MeshStandardMaterial({ color: 0xbdb3a2, roughness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.6, metalness: 0.4 });
  const baseY = elevToY(837), topY = DAM.crestY + 4;
  const prof = [];
  prof.push(new THREE.Vector2(0, 0));
  for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(12.5 - 2.2 * t, t * (topY - baseY - 12))); }
  prof.push(new THREE.Vector2(11.8, topY - baseY - 10), new THREE.Vector2(11.8, topY - baseY - 3), new THREE.Vector2(9.2, topY - baseY - 1), new THREE.Vector2(7.5, topY - baseY + 4), new THREE.Vector2(0, topY - baseY + 6));
  const lathe = new THREE.LatheGeometry(prof, 40);
  const finGeo = new THREE.BoxGeometry(1.4, topY - baseY - 16, 2.4);
  const spots = [[-1, -84, -112], [-1, -94, -172], [1, 84, -112], [1, 94, -172]];
  const clocks = [];
  const towerTops = [];
  spots.forEach(([s, x, z], k) => {
    const t = new THREE.Group();
    const body = new THREE.Mesh(lathe, conc); body.castShadow = true; body.receiveShadow = true; t.add(body);
    for (let f = 0; f < 16; f++) {
      const a = f / 16 * Math.PI * 2;
      const fin = new THREE.Mesh(finGeo, conc);
      fin.position.set(Math.cos(a) * 11.6, (topY - baseY - 16) / 2 + 2, Math.sin(a) * 11.6);
      fin.rotation.y = -a; fin.castShadow = true; t.add(fin);
    }
    // screened intake openings: dark bands at two levels
    for (const yy of [0.18, 0.52]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(11.9, 12.1, 6, 40, 1, true), dark);
      band.position.y = (topY - baseY) * yy; t.add(band);
    }
    t.position.set(x, baseY, z);
    group.add(t);
    // access bridge to the canyon rim
    const rimX = s * (damHalfWidthAt(DAM.crestY) + 6);
    const br = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(rimX - x) - 8, 2, 4), conc);
    br.position.set((rimX + x) / 2 + s * 4, DAM.crestY + 0.5, z); br.castShadow = true; group.add(br);
    towerTops.push(V(x, topY + 6, z));
    if (k === 0 || k === 2) {
      const cf = clockFace();
      const disc = new THREE.Mesh(new THREE.CircleGeometry(3.4, 32), new THREE.MeshBasicMaterial({ map: cf.tex, toneMapped: false }));
      // face the dam crest (toward +z and the canyon centre)
      disc.position.set(x - s * 3.5, topY - 6, z + 10.6);
      disc.rotation.y = -s * 0.32;
      group.add(disc);
      clocks.push({ cf, label: s < 0 ? 'NEVADA' : 'ARIZONA', tz: s < 0 ? 'NV' : 'AZ' });
    }
  });
  return { clocks, towerTops, spots, baseY };
}

function buildSpillways(group, uniforms) {
  const conc = new THREE.MeshStandardMaterial({ color: 0xb3aa99, roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x5d6a72, roughness: 0.45, metalness: 0.7 });
  const crestY = elevToY(ELEV.spillCrest);
  const sides = [];
  for (const s of [-1, 1]) {
    const x = s * SPILL.lip;
    const len = SPILL.z1 - SPILL.z0;
    const weir = new THREE.Mesh(new THREE.BoxGeometry(5, crestY - 180, len), conc);
    weir.position.set(x + s * 1.5, (crestY + 180) / 2, (SPILL.z0 + SPILL.z1) / 2);
    weir.castShadow = weir.receiveShadow = true; group.add(weir);
    // channel floor and outer wall
    const chX = s * (SPILL.lip + 4 + SPILL.chanW / 2);
    const floorPts = [];
    for (let i = 0; i <= 12; i++) { const z = SPILL.z0 + (SPILL.z1 + 30 - SPILL.z0) * i / 12; floorPts.push(V(chX, terrainHeight(chX, z) - 0.6, z)); }
    // Floor runs along z; build as a sweep with the width across x.
    const fl = new THREE.Mesh(sweepBox(floorPts, SPILL.chanW + 2, 0.8), conc); fl.receiveShadow = true; group.add(fl);
    const outerPts = floorPts.map((p) => V(s * (SPILL.lip + 6 + SPILL.chanW), p.y, p.z));
    const ow = new THREE.Mesh(sweepBox(outerPts, 3, 26), conc); ow.castShadow = ow.receiveShadow = true; group.add(ow);
    // piers and drum gates (4 per side, 100 ft each)
    const gates = [];
    const gl = 30.48, gap = (len - 4 * gl) / 5;
    for (let g = 0; g < 5; g++) {
      const pz = SPILL.z0 + gap / 2 + g * (gl + gap) - (g === 0 ? 0 : 0);
      const pier = new THREE.Mesh(new THREE.BoxGeometry(7, 14, Math.max(2.5, gap)), conc);
      pier.position.set(x + s * 1.5, crestY + 6, pz); pier.castShadow = true; group.add(pier);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(8, 1.6, Math.max(3.2, gap + 0.8)), conc);
      cap.position.set(x + s * 1.5, crestY + 13.6, pz); group.add(cap);
      if (g < 4) {
        const gate = new THREE.Mesh(new THREE.BoxGeometry(4, 4.88, gl - 0.4), steel);
        gate.position.set(x + s * 1.5, crestY, pz + gap / 2 + gl / 2);
        gate.castShadow = true; group.add(gate); gates.push(gate);
      }
    }
    // bridge deck over the piers
    const deck = new THREE.Mesh(new THREE.BoxGeometry(9, 1.2, len), conc);
    deck.position.set(x + s * 1.5, crestY + 15, (SPILL.z0 + SPILL.z1) / 2); deck.castShadow = true; group.add(deck);
    // shaft mouth at the downstream end of the channel
    const shaftZ = SPILL.z1 + 24;
    const shaft = new THREE.Mesh(new THREE.CircleGeometry(8, 32), new THREE.MeshBasicMaterial({ color: 0x080808 }));
    shaft.rotation.x = -Math.PI / 2; shaft.position.set(chX, terrainHeight(chX, shaftZ) + 0.3, shaftZ); group.add(shaft);
    sides.push({ s, x, gates, chX, shaftPos: shaft.position.clone(), crestY, len });
  }
  return sides;
}

function buildPowerhouse(group, xrayGroup) {
  const { map, emi } = powerhouseTextures();
  const L = 198, H = 56, W = 26;
  const wings = [];
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map, emissiveMap: emi, emissive: new THREE.Color(0xffd29a), emissiveIntensity: 0, roughness: 0.78 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x9f9788, roughness: 0.9 });
  const transMat = new THREE.MeshStandardMaterial({ color: 0x55605a, roughness: 0.6, metalness: 0.3 });
  const units = [];
  for (const s of [-1, 1]) {
    const z0 = 160, cx = s * 66;
    map.repeat.set(L / 40, 1);
    emi.repeat.set(L / 40, 1);
    const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, L), mat);
    box.position.set(cx, 32 + H / 2, z0 + L / 2);
    box.castShadow = box.receiveShadow = true; group.add(box);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 1.5, L + 1), roofMat);
    roof.position.set(cx, 32 + H + 0.75, z0 + L / 2); roof.receiveShadow = true; group.add(roof);
    const n = s < 0 ? 8 : 9;
    for (let k = 0; k < n; k++) {
      const z = z0 + 14 + k * ((L - 28) / (n - 1));
      const tr = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 9), transMat);
      tr.position.set(cx + s * 4, 32 + H + 4.5, z); tr.castShadow = true; group.add(tr);
      units.push({ s, z, x: cx - s * 2 });
    }
    wings.push({ s, box, cx, z0, L });
  }
  // Generators (seen in x-ray). Order matches UNIT_IDS: N8..N1 then A1..A9.
  const genGeo = new THREE.CylinderGeometry(7.2, 7.2, 5, 36);
  const rotorGeo = new THREE.CylinderGeometry(5.6, 5.6, 0.6, 36);
  const scrollGeo = new THREE.TorusGeometry(8, 2.6, 10, 36);
  const genMat = () => new THREE.MeshStandardMaterial({ color: 0x8a1f1f, roughness: 0.45, metalness: 0.4, emissive: new THREE.Color(0xff8a3c), emissiveIntensity: 0 });
  const rotorMat = new THREE.MeshStandardMaterial({ color: 0xd6d6d6, roughness: 0.4, metalness: 0.8 });
  const scrollMat = new THREE.MeshStandardMaterial({ color: 0x4f6a7a, roughness: 0.45, metalness: 0.6 });
  const nev = units.filter((u) => u.s < 0).sort((a, b) => b.z - a.z); // N8 downstream-most .. N1 nearest dam
  const ari = units.filter((u) => u.s > 0).sort((a, b) => a.z - b.z); // A1 nearest dam .. A9
  const ordered = [...nev.reverse().reverse(), ...ari];
  const gens = [];
  ordered.forEach((u, i) => {
    const g = new THREE.Group();
    const m = genMat();
    const gen = new THREE.Mesh(genGeo, m); gen.position.y = 64; g.add(gen);
    const rotor = new THREE.Group(); rotor.position.y = 66.9;
    const disc = new THREE.Mesh(rotorGeo, rotorMat); rotor.add(disc);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.7, 1), new THREE.MeshBasicMaterial({ color: 0x111111 })); mark.position.set(2.6, 0.1, 0); rotor.add(mark);
    g.add(rotor);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 18, 12), rotorMat); shaft.position.y = 53; g.add(shaft);
    const scroll = new THREE.Mesh(scrollGeo, scrollMat); scroll.rotation.x = Math.PI / 2; scroll.position.y = 44; g.add(scroll);
    g.position.set(u.x, 0, u.z);
    xrayGroup.add(g);
    gens.push({ id: UNIT_IDS[i], group: g, rotor, mat: m, pos: V(u.x, 70, u.z), outlet: V(u.s * 52, elevToY(ELEV.tailwater), u.z), s: u.s });
  });
  return { wings, gens, mat };
}

function buildTunnels(group, towerSpots, spillSides) {
  const curves = { penstock: [], spill: [], diversion: [] };
  const pen = new THREE.MeshStandardMaterial({ color: 0x6f8fa0, roughness: 0.35, metalness: 0.7, emissive: new THREE.Color(0x1d5f7a), emissiveIntensity: 0.25 });
  const spillM = new THREE.MeshStandardMaterial({ color: 0x8c8679, roughness: 0.7, emissive: new THREE.Color(0x3a5a6a), emissiveIntensity: 0.2 });
  const divM = new THREE.MeshStandardMaterial({ color: 0x8a6f52, roughness: 0.8, transparent: true, opacity: 0.85 });
  for (const [s, x, z] of towerSpots) {
    const base = elevToY(837) + 4;
    const c = new THREE.CatmullRomCurve3([V(x, base, z), V(x + s * 18, base - 30, z + 40), V(s * 112, 58, -10), V(s * 108, 50, 100), V(s * 92, 48, 165), V(s * 90, 48, 350)]);
    curves.penstock.push({ s, c });
    const m = new THREE.Mesh(new THREE.TubeGeometry(c, 90, 4.6, 14, false), pen); m.userData.kind = 'penstock'; group.add(m);
  }
  // branch pipes to each wing (headers)
  for (const s of [-1, 1]) {
    for (let k = 0; k < 9; k++) {
      const z = 174 + k * 21;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 22, 10), pen);
      b.rotation.z = Math.PI / 2; b.position.set(s * 79, 46, z); b.userData.kind = 'penstock'; group.add(b);
    }
  }
  for (const sp of spillSides) {
    const s = sp.s;
    const c = new THREE.CatmullRomCurve3([sp.shaftPos.clone().add(V(0, -2, 0)), V(sp.chX, 130, -30), V(s * 150, 80, 60), V(s * 142, 48, 240), V(s * 70, 44, 440)]);
    curves.spill.push({ s, c });
    { const m = new THREE.Mesh(new THREE.TubeGeometry(c, 90, 7.6, 16, false), spillM); m.userData.kind = 'spill'; group.add(m); }
  }
  for (const s of [-1, 1]) {
    const c = new THREE.CatmullRomCurve3([V(s * 52, 34, -420), V(s * 96, 34, -150), V(s * 100, 34, 120), V(s * 70, 34, 400)]);
    curves.diversion.push({ s, c });
    const m = new THREE.Mesh(new THREE.TubeGeometry(c, 70, 8.5, 14, false), divM); m.userData.kind = 'diversion'; group.add(m);
  }
  curves.mats = [pen, spillM];
  return curves;
}

function buildBridge(group) {
  const conc = new THREE.MeshStandardMaterial({ color: 0xbcb4a5, roughness: 0.75 });
  const z = 470, deckY = 296, spring = 150, crown = 282, half = 178;
  const ribs = [];
  for (const dz of [-8, 8]) {
    const pts = [];
    for (let i = 0; i <= 40; i++) { const x = -half + 2 * half * i / 40; const y = spring + (crown - spring) * (1 - Math.pow(x / half, 2)); pts.push(V(x, y, z + dz)); }
    // rib runs along x; sweepBox's side vector is perpendicular in xz, which is z here.
    const rib = new THREE.Mesh(sweepBox(pts, 6, 7), conc); rib.castShadow = true; group.add(rib); ribs.push(pts);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(600, 3.2, 26), conc);
  deck.position.set(0, deckY, z); deck.castShadow = true; deck.receiveShadow = true; group.add(deck);
  for (let x = -290; x <= 290; x += 22) {
    const inArch = Math.abs(x) < half;
    const yb = inArch ? spring + (crown - spring) * (1 - Math.pow(x / half, 2)) + 6 : Math.max(spring, terrainHeight(x, z) - 4);
    const h = deckY - yb;
    if (h < 2) continue;
    for (const dz of [-8, 8]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(3.4, h, 3.4), conc);
      col.position.set(x, yb + h / 2, z + dz); col.castShadow = true; group.add(col);
    }
  }
  return { z, deckY };
}

export function buildStructures(uniforms) {
  const groups = {
    dam: new THREE.Group(), towers: new THREE.Group(), spillways: new THREE.Group(),
    powerhouse: new THREE.Group(), generators: new THREE.Group(), tunnels: new THREE.Group(), bridge: new THREE.Group(),
  };
  for (const [k, g] of Object.entries(groups)) g.name = k;
  const dam = buildDamMesh(uniforms);
  groups.dam.add(dam);
  const crest = buildCrest(groups.dam);
  const towers = buildTowers(groups.towers, uniforms);
  const spill = buildSpillways(groups.spillways, uniforms);
  const ph = buildPowerhouse(groups.powerhouse, groups.generators);
  const curves = buildTunnels(groups.tunnels, towers.spots, spill);
  const bridge = buildBridge(groups.bridge);

  const anchors = {
    dam: V(0, 150, 48),
    towers: V(-84, DAM.crestY + 12, -112),
    penstocks: V(-110, 62, 40),
    powerhouse: V(66, 92, 262),
    spillways: V(SPILL.lip + 2, elevToY(ELEV.spillCrest) + 18, -160),
    tunnels: V(150, 82, 60),
    lake: V(0, 200, -520),
    tailrace: V(0, 46, 330),
    bridge: V(0, 302, 470),
    crest: V(-30, DAM.crestY + 4, 4),
  };
  return { groups, dam, crest, towers, spill, ph, curves, bridge, anchors };
}
