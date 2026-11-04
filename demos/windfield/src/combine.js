import * as THREE from '../vendor/three/build/three.module.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';

// A procedural combine harvester, built from bevelled panels, lathed tyres with chevron
// lugs, a 9 m header with a turning reel and auger, a cab with real glass, and the small
// stuff that sells it: ladder, mirrors, grilles, beacon, exhaust, straw spreaders.
//
// Local frame: +X forward, +Y up, +Z to the machine's left. The front axle sits at x = 0.

const UP = new THREE.Vector3(0, 1, 0);

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// A box with rounded vertical edges and bevelled faces. Centre at (cx, cy, cz).
function panel(lenX, h, depthZ, cx, cy, cz, r = 0.12, bevel = 0.04) {
  const shape = roundedRectShape(lenX - bevel * 2, h - bevel * 2, Math.min(r, (Math.min(lenX, h) - bevel * 2) / 2.2));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, depthZ - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: 4,
  });
  g.translate(0, 0, -(depthZ - bevel * 2) / 2);
  g.translate(cx, cy, cz);
  return g;
}

function box(x, y, z, cx, cy, cz) {
  const g = new THREE.BoxGeometry(x, y, z);
  g.translate(cx, cy, cz);
  return g;
}

function cylZ(r, len, cx, cy, cz, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  g.translate(cx, cy, cz);
  return g;
}

function cylBetween(a, b, r, seg = 10) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function merge(list) {
  const clean = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    return n;
  });
  return mergeGeometries(clean, false);
}

// Grime: darken towards the ground and towards the front of the machine.
function dirtyPaint(mat, groundY = 1.6) {
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLocal;
        float dh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float dn(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(dh(i), dh(i+vec3(1,0,0)), f.x), mix(dh(i+vec3(0,1,0)), dh(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(dh(i+vec3(0,0,1)), dh(i+vec3(1,0,1)), f.x), mix(dh(i+vec3(0,1,1)), dh(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        float grime = smoothstep(${groundY.toFixed(2)}, 0.2, vLocal.y) * (0.55 + dn(vLocal * 3.0) * 0.45);
        grime += smoothstep(0.62, 0.9, dn(vLocal * 1.3 + 4.0)) * 0.25;
        vec3 dust = vec3(0.46, 0.40, 0.30);
        vec4 diffuseColor = vec4( mix(diffuse, dust, clamp(grime, 0.0, 0.85)), opacity );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.95, clamp(smoothstep(${groundY.toFixed(2)}, 0.2, vLocal.y), 0.0, 1.0));`);
  };
  return mat;
}

function tyre(radius, width, lugs) {
  // Lathe a rounded tyre section around Y, then turn it so the axle is along Z.
  const inner = radius * 0.62;
  const pts = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI;
    const bulge = Math.cos(a);
    pts.push(new THREE.Vector2(inner + (radius - inner) * (0.55 + 0.45 * Math.pow(Math.max(bulge, 0), 0.4)), Math.sin(a) * width / 2));
  }
  const parts = [new THREE.LatheGeometry(pts, 40)];
  // Chevron lugs, alternating sides.
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    for (const side of [-1, 1]) {
      const lug = new THREE.BoxGeometry(radius * 0.09, width * 0.42, radius * 0.12);
      lug.rotateX(side * 0.55);
      lug.translate(radius * 1.0, side * width * 0.22, 0);
      lug.rotateY(a + (side > 0 ? Math.PI / lugs : 0));
      parts.push(lug);
    }
  }
  const g = merge(parts);
  g.rotateX(Math.PI / 2);
  return g;
}

function rim(radius, width) {
  const parts = [
    cylZ(radius * 0.6, width * 0.82, 0, 0, 0, 28),
    cylZ(radius * 0.22, width * 0.95, 0, 0, 0, 18),
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(cylZ(radius * 0.035, width * 1.0, Math.cos(a) * radius * 0.15, Math.sin(a) * radius * 0.15, 0, 6));
  }
  return merge(parts);
}

export class Combine {
  constructor(paintColor = '#b23a1f') {
    this.group = new THREE.Group();
    this.body = new THREE.Group(); // pitches and rolls with the ground
    this.group.add(this.body);

    const paint = dirtyPaint(new THREE.MeshPhysicalMaterial({ color: paintColor, roughness: 0.42, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.35 }));
    const grey = dirtyPaint(new THREE.MeshStandardMaterial({ color: '#3b3e42', roughness: 0.6, metalness: 0.35 }), 1.2);
    const white = dirtyPaint(new THREE.MeshPhysicalMaterial({ color: '#e7e3da', roughness: 0.4, clearcoat: 0.4 }), 1.0);
    const dark = new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.7, metalness: 0.3 });
    const steel = new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.35, metalness: 0.85 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#1b1b1c', roughness: 0.92 });
    const rimMat = dirtyPaint(new THREE.MeshStandardMaterial({ color: '#d4b03a', roughness: 0.45, metalness: 0.2 }), 2.0);
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#1f2a30', roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.42,
      clearcoat: 1, envMapIntensity: 1.6, depthWrite: false,
    });
    this.lightMat = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#fff1d0', emissiveIntensity: 0 });
    this.beaconMat = new THREE.MeshStandardMaterial({ color: '#ff8a1a', emissive: '#ff7a00', emissiveIntensity: 0, transparent: true, opacity: 0.85 });

    const add = (geo, mat, cast = true, parent = this.body) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    // ---- main body, grain tank and engine bay
    add(merge([
      panel(5.0, 2.2, 2.3, -2.65, 2.05, 0, 0.25, 0.06), // threshing body, behind the cab
      panel(1.5, 1.3, 1.9, 0.75, 1.6, 0, 0.15, 0.05), // front frame under the cab
      panel(3.0, 0.55, 2.4, -3.6, 3.35, 0, 0.18, 0.05), // engine hood
      panel(3.1, 0.9, 3.0, -1.05, 3.55, 0, 0.12, 0.05), // grain tank
      panel(1.6, 0.9, 2.0, -5.3, 1.65, 0, 0.2, 0.05), // rear hood over the spreader
    ]), paint);
    // Tank extensions flare out at the top.
    for (const side of [-1, 1]) {
      const g = panel(3.1, 0.06, 0.55, 0, 0, 0, 0.02, 0.01);
      g.rotateX(side * 0.75);
      g.translate(-1.05, 4.12, side * 1.62);
      add(g, white);
    }
    add(panel(3.1, 0.06, 0.6, -1.05, 4.05, 0, 0.02, 0.01).rotateZ(0.0).translate(0, 0, 0), white);
    // Side grilles and service doors.
    const grilleParts = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) grilleParts.push(box(1.9, 0.045, 0.03, -3.6, 2.35 + i * 0.09, side * 1.17));
      grilleParts.push(box(2.1, 0.9, 0.02, -3.6, 2.7, side * 1.155));
    }
    add(merge(grilleParts), dark, false);
    const seams = [];
    for (const side of [-1, 1]) {
      for (const x of [-0.9, -2.2, -4.6]) seams.push(box(0.025, 1.8, 0.02, x, 2.0, side * 1.16));
      seams.push(box(5.8, 0.025, 0.02, -2.2, 1.15, side * 1.16));
    }
    add(merge(seams), dark, false);

    // Side stripes, rear grille, tail lights and a chevron plate on the straw hood.
    const stripes = [];
    for (const side of [-1, 1]) {
      stripes.push(box(4.9, 0.09, 0.012, -2.65, 2.78, side * 1.165));
      stripes.push(box(4.9, 0.03, 0.012, -2.65, 2.62, side * 1.165));
    }
    add(merge(stripes), white, false);
    const rearGrille = [box(0.03, 0.95, 1.9, -5.16, 2.55, 0)];
    for (let i = 0; i < 8; i++) rearGrille.push(box(0.06, 0.04, 1.8, -5.19, 2.15 + i * 0.11, 0));
    add(merge(rearGrille), dark, false);
    this.tailMat = new THREE.MeshStandardMaterial({ color: '#5a0a06', emissive: '#ff2a12', emissiveIntensity: 0.6 });
    const amber = new THREE.MeshStandardMaterial({ color: '#6a3a06', emissive: '#ff9a20', emissiveIntensity: 0.4 });
    add(merge([box(0.05, 0.16, 0.24, -5.2, 3.0, 1.0), box(0.05, 0.16, 0.24, -5.2, 3.0, -1.0)]), this.tailMat, false);
    add(merge([box(0.05, 0.12, 0.16, -5.2, 3.2, 1.0), box(0.05, 0.12, 0.16, -5.2, 3.2, -1.0)]), amber, false);
    const chev = document.createElement('canvas');
    chev.width = 256;
    chev.height = 64;
    const cg = chev.getContext('2d');
    cg.fillStyle = '#f2efe8';
    cg.fillRect(0, 0, 256, 64);
    cg.fillStyle = '#c8221a';
    for (let i = -2; i < 12; i++) {
      cg.beginPath();
      cg.moveTo(i * 32, 64);
      cg.lineTo(i * 32 + 16, 64);
      cg.lineTo(i * 32 + 48, 0);
      cg.lineTo(i * 32 + 32, 0);
      cg.fill();
    }
    const chevTex = new THREE.CanvasTexture(chev);
    chevTex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.42), new THREE.MeshStandardMaterial({ map: chevTex, roughness: 0.5 }));
    plate.position.set(-6.11, 1.75, 0);
    plate.rotation.y = -Math.PI / 2;
    this.body.add(plate);

    // ---- cab
    add(panel(1.75, 0.55, 2.0, 0.95, 2.35, 0, 0.12, 0.04), paint); // cab base
    const posts = [];
    for (const [x, z] of [[0.15, 0.95], [0.15, -0.95], [1.75, 0.95], [1.75, -0.95]]) {
      posts.push(box(0.07, 1.55, 0.07, x, 3.4, z));
    }
    add(merge(posts), dark);
    add(new THREE.BoxGeometry(1.62, 1.5, 1.86).translate(0.95, 3.38, 0), glass, false);
    add(panel(2.0, 0.16, 2.25, 0.95, 4.22, 0, 0.1, 0.04), white); // roof
    // Light bar and work lights on the roof edge.
    const lights = [];
    for (const z of [-0.85, -0.45, 0.45, 0.85]) lights.push(box(0.06, 0.12, 0.22, 1.98, 4.18, z));
    for (const z of [-1.0, 1.0]) lights.push(box(0.2, 0.12, 0.06, -0.05, 4.18, z));
    add(merge(lights), this.lightMat, false);
    // Seat and wheel silhouette inside the glass.
    add(merge([box(0.5, 0.6, 0.55, 0.65, 2.95, 0), cylBetween(new THREE.Vector3(1.2, 2.85, 0), new THREE.Vector3(1.4, 3.3, 0), 0.03)]), dark, false);
    // Mirrors.
    for (const side of [-1, 1]) {
      add(merge([
        cylBetween(new THREE.Vector3(1.6, 3.9, side * 0.95), new THREE.Vector3(1.75, 3.7, side * 1.45), 0.025),
        box(0.06, 0.35, 0.22, 1.76, 3.55, side * 1.48),
      ]), dark);
    }
    // Beacon.
    this.beacon = add(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 14).translate(0.2, 4.42, 0.7), this.beaconMat, false);

    // ---- ladder and platform
    const ladder = [
      cylBetween(new THREE.Vector3(0.5, 0.35, 1.3), new THREE.Vector3(0.75, 2.15, 1.15), 0.03),
      cylBetween(new THREE.Vector3(1.0, 0.35, 1.3), new THREE.Vector3(1.25, 2.15, 1.15), 0.03),
      box(1.9, 0.05, 0.5, 0.95, 2.1, 1.25),
    ];
    for (let i = 0; i < 6; i++) {
      const y = 0.45 + i * 0.3;
      const x = 0.52 + i * 0.04;
      ladder.push(box(0.5, 0.035, 0.08, x + 0.25, y, 1.3 - i * 0.025));
    }
    ladder.push(cylBetween(new THREE.Vector3(0.1, 2.1, 1.45), new THREE.Vector3(0.1, 2.95, 1.45), 0.025));
    ladder.push(cylBetween(new THREE.Vector3(1.8, 2.1, 1.45), new THREE.Vector3(1.8, 2.95, 1.45), 0.025));
    ladder.push(cylBetween(new THREE.Vector3(0.1, 2.95, 1.45), new THREE.Vector3(1.8, 2.95, 1.45), 0.025));
    add(merge(ladder), steel);

    // ---- unloading auger, folded along the left side
    add(merge([
      cylBetween(new THREE.Vector3(-2.4, 3.2, 1.35), new THREE.Vector3(-2.4, 4.0, 1.75), 0.19, 16),
      cylBetween(new THREE.Vector3(-2.4, 4.0, 1.75), new THREE.Vector3(2.3, 4.0, 1.75), 0.17, 16),
      cylBetween(new THREE.Vector3(2.3, 4.0, 1.75), new THREE.Vector3(2.55, 3.55, 1.75), 0.15, 12),
      box(0.25, 0.5, 0.25, -1.0, 3.75, 1.6),
    ]), paint);

    // ---- exhaust and pre-cleaner
    add(merge([
      cylBetween(new THREE.Vector3(-3.3, 3.5, -0.75), new THREE.Vector3(-3.3, 4.6, -0.75), 0.085, 12),
      new THREE.CylinderGeometry(0.11, 0.09, 0.12, 12).translate(-3.3, 4.62, -0.75),
    ]), dark);
    add(new THREE.CylinderGeometry(0.28, 0.28, 0.4, 20).translate(-4.2, 3.82, 0.5), dark);
    this.exhaustPoint = new THREE.Vector3(-3.3, 4.7, -0.75);

    // ---- feeder house (header to body)
    const feeder = panel(2.3, 0.85, 1.35, 1.95, 1.0, 0, 0.08, 0.04);
    feeder.rotateZ(-0.32);
    feeder.translate(0.5, 0.35, 0);
    add(feeder, paint);

    // ---- header
    this.header = new THREE.Group();
    this.header.position.set(3.25, 0, 0);
    this.body.add(this.header);
    const W = 9.0;
    this.headerWidth = W;
    add(merge([
      box(0.08, 1.15, W, -0.65, 0.85, 0), // back wall
      box(1.25, 0.06, W, 0.0, 0.3, 0), // pan
      box(0.7, 0.5, W, -0.35, 1.45, 0).rotateZ(0.0), // top beam
      box(1.6, 0.9, 0.08, -0.05, 0.75, W / 2), // end plates
      box(1.6, 0.9, 0.08, -0.05, 0.75, -W / 2),
    ]), grey, true, this.header);
    // Crop dividers: pointed noses at both ends.
    for (const z of [W / 2, -W / 2]) {
      const nose = new THREE.ConeGeometry(0.16, 1.3, 12);
      nose.rotateZ(-Math.PI / 2 - 0.12);
      nose.translate(1.15, 0.33, z);
      add(nose, paint, true, this.header);
    }
    // Cutter bar with knife guards.
    const guards = [box(0.12, 0.05, W, 0.62, 0.26, 0)];
    for (let i = 0; i < 120; i++) {
      const z = -W / 2 + (i + 0.5) * (W / 120);
      const gd = new THREE.ConeGeometry(0.022, 0.14, 4);
      gd.rotateZ(-Math.PI / 2);
      gd.translate(0.74, 0.26, z);
      guards.push(gd);
    }
    add(merge(guards), steel, false, this.header);
    // Cross auger with spiral flighting, turning.
    this.auger = new THREE.Group();
    this.auger.position.set(-0.2, 0.68, 0);
    this.header.add(this.auger);
    const flights = [cylZ(0.17, W - 0.4, 0, 0, 0, 18)];
    for (const dir of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 160; i++) {
        const t = i / 160;
        const a = t * Math.PI * 2 * 9;
        pts.push(new THREE.Vector3(Math.cos(a) * 0.3, Math.sin(a) * 0.3, dir * (0.5 + t * (W / 2 - 0.9))));
      }
      flights.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, 0.03, 5, false));
    }
    add(merge(flights), steel, true, this.auger);
    // Reel: six bats with tines on a central shaft, held by two arms.
    this.reel = new THREE.Group();
    this.reel.position.set(0.55, 1.55, 0);
    this.header.add(this.reel);
    const reelParts = [cylZ(0.06, W - 0.2, 0, 0, 0, 12)];
    const R = 0.78;
    for (let b = 0; b < 6; b++) {
      const a = (b / 6) * Math.PI * 2;
      const c = new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0);
      reelParts.push(cylZ(0.035, W - 0.3, c.x, c.y, 0, 8));
      for (const z of [-W / 2 + 0.5, -W / 4, 0, W / 4, W / 2 - 0.5]) {
        reelParts.push(cylBetween(new THREE.Vector3(0, 0, z), new THREE.Vector3(c.x, c.y, z), 0.025, 6));
      }
      for (let k = 0; k < 40; k++) {
        const z = -W / 2 + 0.3 + k * ((W - 0.6) / 39);
        const tip = c.clone().add(new THREE.Vector3(Math.cos(a + 1.2) * 0.28, Math.sin(a + 1.2) * 0.28, 0));
        reelParts.push(cylBetween(new THREE.Vector3(c.x, c.y, z), new THREE.Vector3(tip.x, tip.y, z), 0.008, 4));
      }
    }
    add(merge(reelParts), dark, true, this.reel);
    for (const z of [W / 2 - 0.2, -W / 2 + 0.2]) {
      add(cylBetween(new THREE.Vector3(-0.6, 1.4, z), new THREE.Vector3(0.6, 1.58, z), 0.06, 8), paint, true, this.header);
    }

    // ---- wheels (front drive, rear steer)
    const frontTyre = tyre(0.95, 0.72, 22);
    const rearTyre = tyre(0.62, 0.48, 16);
    const frontRim = rim(0.95, 0.72);
    const rearRim = rim(0.62, 0.48);
    this.wheels = [];
    const wheel = (x, z, r, tg, rg, steer) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, r, z);
      const spin = new THREE.Group();
      pivot.add(spin);
      add(tg, rubber, true, spin);
      add(rg, rimMat, true, spin);
      this.body.add(pivot);
      this.wheels.push({ pivot, spin, r, steer });
    };
    wheel(0, 1.55, 0.95, frontTyre, frontRim, false);
    wheel(0, -1.55, 0.95, frontTyre, frontRim, false);
    wheel(-3.7, 1.25, 0.62, rearTyre, rearRim, true);
    wheel(-3.7, -1.25, 0.62, rearTyre, rearRim, true);
    // Mudguards and the rear axle beam.
    add(merge([
      box(0.9, 0.06, 0.8, 0, 2.02, 1.55), box(0.9, 0.06, 0.8, 0, 2.02, -1.55),
      box(0.3, 0.3, 2.3, -3.7, 0.8, 0),
    ]), paint);

    // ---- straw spreader discs at the rear
    this.spreaders = [];
    for (const z of [-0.45, 0.45]) {
      const s = new THREE.Group();
      s.position.set(-5.95, 1.05, z);
      const parts = [new THREE.CylinderGeometry(0.38, 0.38, 0.03, 20)];
      for (let i = 0; i < 4; i++) parts.push(box(0.32, 0.1, 0.03, 0.16, 0.05, 0).rotateY((i / 4) * Math.PI * 2));
      add(merge(parts), dark, false, s);
      this.body.add(s);
      this.spreaders.push(s);
    }
    this.rearPoint = new THREE.Vector3(-6.0, 1.0, 0);
    this.headerPoint = new THREE.Vector3(4.0, 0.5, 0);

    // Headlights for dusk and night.
    this.headlights = [];
    for (const z of [-0.7, 0.7]) {
      const l = new THREE.SpotLight('#ffe9c4', 0, 60, 0.6, 0.6, 1.4);
      l.position.set(2.0, 4.15, z);
      l.target.position.set(9, 0, z * 2);
      this.body.add(l, l.target);
      this.headlights.push(l);
    }

    this.distance = 0;
  }

  // pose: world x, z, heading (radians, 0 = +X), ground heights at the axles for pitch.
  update(dt, t, { x, z, heading, speed, steer, groundFront, groundRear, groundLeft, groundRight, cutting, lights }) {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = -heading;
    const wheelbase = 3.7;
    const pitch = Math.atan2(groundFront - groundRear, wheelbase);
    const roll = Math.atan2(groundLeft - groundRight, 3.1);
    this.body.position.y = (groundFront + groundRear) / 2 + Math.sin(t * 9) * 0.006 * Math.min(1, Math.abs(speed));
    this.body.rotation.set(roll * 0.8, 0, pitch);
    this.distance += speed * dt;
    for (const w of this.wheels) {
      w.spin.rotation.z = -this.distance / w.r;
      w.pivot.rotation.y = w.steer ? -steer : 0;
    }
    const busy = cutting ? 1 : 0.35;
    this.reel.rotation.z -= dt * 2.6 * busy;
    this.auger.rotation.z -= dt * 6.0 * busy;
    for (const [i, s] of this.spreaders.entries()) s.rotation.y += dt * 18 * (i ? 1 : -1) * busy;
    // The header drops to cutting height while it works and lifts on the turns.
    const target = cutting ? 0 : 0.45;
    this.header.position.y += (target - this.header.position.y) * Math.min(1, dt * 2.5);
    this.header.rotation.z = this.header.position.y * -0.1;
    this.beaconMat.emissiveIntensity = (Math.sin(t * 7) > 0.2 ? 6 : 0.4) * lights.beacon;
    this.lightMat.emissiveIntensity = 0.3 + lights.work * 8;
    for (const l of this.headlights) l.intensity = lights.work * 90;
    this.tailMat.emissiveIntensity = 0.6 + lights.work * 3;
  }

  worldPoint(local, out = new THREE.Vector3()) {
    return out.copy(local).applyMatrix4(this.body.matrixWorld);
  }
}

// Drives lanes back and forth across a rectangle with U-turns on the headlands, or hands
// the wheel to the person. Lanes run along X; the header is 9 m wide and lanes are 8.4 m
// apart so each pass overlaps the last a little.
export class Harvester {
  constructor({ minX, maxX, minZ, maxZ, laneWidth = 8.4 }) {
    this.area = { minX, maxX, minZ, maxZ };
    this.laneWidth = laneWidth;
    this.mode = 'auto';
    this.speedScale = 1;
    this.buildPath();
    this.s = 0;
    this.x = this.path[0].x;
    this.z = this.path[0].z;
    this.heading = 0;
    this.speed = 0;
    this.steer = 0;
    this.cutting = false;
    this.finished = false;
    this.input = { throttle: 0, turn: 0 };
  }

  buildPath() {
    const { minX, maxX, minZ, maxZ } = this.area;
    const pts = [];
    const lanes = Math.max(1, Math.floor((maxZ - minZ) / this.laneWidth) + 1);
    const r = this.laneWidth / 2;
    for (let i = 0; i < lanes; i++) {
      const z = minZ + i * this.laneWidth;
      const fwd = i % 2 === 0;
      const x0 = fwd ? minX : maxX;
      const x1 = fwd ? maxX : minX;
      const n = Math.ceil(Math.abs(x1 - x0) / 0.5);
      for (let k = 0; k <= n; k++) pts.push({ x: x0 + ((x1 - x0) * k) / n, z, cut: true });
      if (i < lanes - 1) {
        // Run out past the crop edge, swing round, come back in.
        const ext = 5;
        const xe = x1 + (fwd ? ext : -ext);
        for (let k = 1; k <= 10; k++) pts.push({ x: x1 + ((xe - x1) * k) / 10, z, cut: false });
        for (let k = 1; k <= 24; k++) {
          const a = -Math.PI / 2 + (k / 24) * Math.PI;
          pts.push({ x: xe + (fwd ? Math.cos(a) : -Math.cos(a)) * r, z: z + r + Math.sin(a) * r, cut: false });
        }
        const zn = z + this.laneWidth;
        for (let k = 1; k <= 10; k++) pts.push({ x: xe + ((x1 - xe) * k) / 10, z: zn, cut: false });
      }
    }
    // Arc length.
    let s = 0;
    pts[0].s = 0;
    for (let i = 1; i < pts.length; i++) {
      s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      pts[i].s = s;
    }
    this.path = pts;
    this.length = s;
    this.cursor = 0;
  }

  sample(s) {
    const p = this.path;
    while (this.cursor < p.length - 2 && p[this.cursor + 1].s < s) this.cursor++;
    while (this.cursor > 0 && p[this.cursor].s > s) this.cursor--;
    const a = p[this.cursor];
    const b = p[Math.min(p.length - 1, this.cursor + 1)];
    const k = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, cut: a.cut && b.cut };
  }

  restart() {
    this.s = 0;
    this.cursor = 0;
    this.finished = false;
  }

  update(dt) {
    if (this.mode === 'auto') {
      const v = 2.6 * this.speedScale;
      this.speed = v;
      this.s = Math.min(this.length, this.s + v * dt);
      const p = this.sample(this.s);
      const ahead = this.sample(Math.min(this.length, this.s + 2.5));
      const h = Math.atan2(ahead.z - p.z, ahead.x - p.x);
      if (Math.hypot(ahead.x - p.x, ahead.z - p.z) > 0.01) {
        let d = h - this.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.steer = THREE.MathUtils.clamp(-d * 1.6, -0.6, 0.6);
        this.heading += d * Math.min(1, dt * 4);
      }
      this.x = p.x;
      this.z = p.z;
      this.cutting = p.cut;
      if (this.s >= this.length) this.finished = true;
    } else {
      const target = this.input.throttle * 4.5 * this.speedScale;
      this.speed += (target - this.speed) * Math.min(1, dt * 1.2);
      this.steer += (this.input.turn * 0.55 - this.steer) * Math.min(1, dt * 3);
      // Rear-wheel steering: the back swings out, which is what makes combines look odd.
      this.heading += (this.speed * Math.tan(this.steer)) / 3.7 * dt;
      this.x += Math.cos(this.heading) * this.speed * dt;
      this.z += Math.sin(this.heading) * this.speed * dt;
      const lim = 92;
      const r = Math.hypot(this.x, this.z);
      if (r > lim) {
        this.x *= lim / r;
        this.z *= lim / r;
      }
      this.cutting = this.speed > 0.3;
    }
  }
}
