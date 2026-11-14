// HARROW TK-4, built procedurally in the teardown study style: glossy white shells,
// graphite joints, ink edges, and orange only on the parts doing work right now.
// Units: 1 m = 100. x points forward, y up, z to the machine's left.
import * as THREE from 'three';
import { INK, ACCENT } from 'kit/stage.js';
import { MAT, addInk } from 'kit/materials.js';

const Y = new THREE.Vector3(0, 1, 0);
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (t) => t * t * (3 - 2 * t);
export const GROUND = -38; // platform top, in stage space

// leg geometry (cm)
const L1 = 86, L2 = 80; // thigh, shin
const LIFT = 22; // body sits this much above its build height
const HIP = { LF: [96, 150, 40], RF: [96, 150, -40], LH: [-100, 152, 42], RH: [-100, 152, -42] };
const ANKLE = { front: [-6, 44], hind: [-22, 52] }; // ankle relative to foot (digitigrade)

export class Machine {
  constructor(stage) {
    this.stage = stage;
    this.root = new THREE.Group(); // turns with the turntable pivot
    stage.pivot.add(this.root);
    this.rig = new THREE.Group(); // tilts with the grade
    this.root.add(this.rig);
    this.body = new THREE.Group(); // bobs with the gait
    this.rig.add(this.body);

    this.reg = []; // every shaded mesh: { mesh, sys, glass }
    this.shells = {}; // one white material per subsystem, so focus can ghost by subsystem
    this.e = 0; this.eT = 0; // explode amount and target
    this.focus = null; this.mode = 'solid';
    this.sweepYaw = 0;

    this.mat = {
      graphite: new THREE.MeshPhysicalMaterial({ color: 0x15171a, roughness: 0.42, metalness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.32 }), steel: MAT.steel(), orange: MAT.orange(),
      core: new THREE.MeshPhysicalMaterial({ color: 0xff6a2a, emissive: ACCENT, emissiveIntensity: 0.6, roughness: 0.3, clearcoat: 0.8 }),
      lens: new THREE.MeshPhysicalMaterial({ color: 0x2a1408, emissive: ACCENT, emissiveIntensity: 1.2, roughness: 0.08, clearcoat: 1 }),
      ring: new THREE.MeshPhysicalMaterial({ color: 0x3a3f45, emissive: ACCENT, emissiveIntensity: 0, roughness: 0.35, clearcoat: 0.6 }),
      finTip: new THREE.MeshPhysicalMaterial({ color: 0x2b2f34, emissive: ACCENT, emissiveIntensity: 0, roughness: 0.4 }),
      band: new THREE.MeshPhysicalMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.1, roughness: 0.4, clearcoat: 0.6 }),
      print: new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.4, depthWrite: false }),
    };
    this.ghost = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.4, depthWrite: false });
    this.glass = new THREE.MeshPhysicalMaterial({ color: 0xf7fbff, transparent: true, opacity: 0.16, roughness: 0.1, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });
    this.cutPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

    this.buildPlatform();
    this.buildFrame();
    this.buildCarapace();
    this.buildCrest();
    this.buildCore();
    this.buildCells();
    this.buildHead();
    this.buildTail();
    this.buildDrill();
    this.legs = Object.keys(HIP).map((id, i) => this.buildLeg(id, i));
    this.buildPrints();
    this.anchors = this.makeAnchors();
  }

  white(sys) { return (this.shells[sys] ??= MAT.shell()); }
  add(parent, mesh, sys, { ink = true, glass = false, shadow = true, inkAt = 32, inkOp = 0.5 } = {}) {
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    if (ink) addInk(mesh, inkAt, inkOp);
    parent.add(mesh);
    this.reg.push({ mesh, sys, glass, orig: mesh.material });
    return mesh;
  }

  // ---------------------------------------------------------------------------
  // the test ramp it walks on: a white plank with a scrolling survey track
  buildPlatform() {
    const p = new THREE.Group();
    const plank = new THREE.Mesh(new THREE.BoxGeometry(700, 10, 200), new THREE.MeshPhysicalMaterial({ color: 0xf3f1ec, roughness: 0.55, clearcoat: 0.3 }));
    plank.position.y = -5; plank.receiveShadow = true; plank.castShadow = true; addInk(plank, 30, 0.4);
    p.add(plank);
    // fixed ruler along both edges
    const rule = [];
    for (let x = -340; x <= 340; x += 10) { const L = x % 100 === 0 ? 12 : x % 50 === 0 ? 8 : 4; for (const z of [-100, 100]) rule.push(v3(x, 0.4, z), v3(x, 0.4, z - Math.sign(z) * L)); }
    p.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(rule), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.45 })));
    // track marks that scroll backwards at the walking speed (so the machine walks in place)
    const n = 18, pos = new Float32Array(n * 2 * 2 * 3);
    this.track = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.3 }));
    this.track.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.trackN = n;
    p.add(this.track);
    this.platform = p;
    this.rig.add(p);
  }

  // ---------------------------------------------------------------------------
  // graphite chassis: belly keel, spine vertebrae, hip yokes
  buildFrame() {
    const g = new THREE.Group(); this.body.add(g); this.frame = g;
    const gm = this.mat.graphite;
    // graphite torso: the dark flanks the white plates sit on
    const keel = new THREE.Mesh(new THREE.CapsuleGeometry(40, 196, 8, 28), gm); keel.rotation.z = Math.PI / 2; keel.position.set(-6, 168, 0); keel.scale.set(0.96, 1, 1.06);
    this.add(g, keel, 'frame', { inkAt: 40 });
    // flank ribs and a ventral keel plate
    for (let i = 0; i < 7; i++) {
      const x = -96 + i * 30;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(43, 2.6, 8, 40, Math.PI * 1.25), gm); rib.rotation.set(0, Math.PI / 2, Math.PI * 0.12 + Math.PI); rib.position.set(x, 168, 0);
      this.add(g, rib, 'frame', { ink: false });
    }
    const vk = new THREE.Mesh(new THREE.BoxGeometry(170, 8, 26), this.mat.steel); vk.position.set(-6, 126, 0);
    this.add(g, vk, 'frame', { inkOp: 0.4 });
    for (let i = 0; i < 11; i++) {
      const x = -125 + i * 25;
      const v = new THREE.Mesh(new THREE.BoxGeometry(16, 12, 22), gm); v.position.set(x, 204 + Math.sin((i / 10) * Math.PI) * 6, 0); v.rotation.z = (i - 5) * 0.03;
      this.add(g, v, 'frame', { inkOp: 0.35 });
    }
    for (const [x, w] of [[96, 100], [-100, 104]]) {
      const yoke = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, w, 18), this.mat.steel); yoke.rotation.x = Math.PI / 2; yoke.position.set(x, 150, 0);
      this.add(g, yoke, 'frame');
    }
    // hydraulic manifold and lines to each hip
    const man = new THREE.Mesh(new THREE.BoxGeometry(40, 18, 30), this.mat.steel); man.position.set(-6, 128, 0);
    this.add(g, man, 'core', { inkOp: 0.4 });
    for (const [x, y, z] of Object.values(HIP)) {
      const c = new THREE.CatmullRomCurve3([v3(-6 + Math.sign(x) * 18, 128, Math.sign(z) * 8), v3(x * 0.5, 120, z * 0.6), v3(x * 0.92, y - 14, z * 0.8)]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(c, 24, 2.2, 8), this.mat.steel);
      this.add(g, tube, 'core', { ink: false });
    }
  }

  // overlapping arched plates over the back, like a pangolin's
  buildCarapace() {
    const g = new THREE.Group(); this.body.add(g); this.carapace = g; this.plates = [];
    const N = 7;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const x = -132 + u * 250;
      const rx = 48 + 13 * Math.sin(Math.PI * (0.18 + u * 0.72)), ry = rx * 0.8, t = 5;
      const sh = new THREE.Shape();
      const a0 = 0.34, a1 = Math.PI - 0.34;
      sh.absellipse(0, 0, rx, ry, a0, a1, false);
      sh.lineTo(Math.cos(a1) * (rx - t), Math.sin(a1) * (ry - t));
      sh.absellipse(0, 0, rx - t, ry - t, a1, a0, true);
      const len = 46 - Math.abs(u - 0.5) * 10;
      const geo = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: true, bevelThickness: 1.6, bevelSize: 1.4, bevelSegments: 2, curveSegments: 40 });
      geo.translate(0, 0, -len / 2); geo.rotateY(Math.PI / 2);
      const m = new THREE.Mesh(geo, this.white('carapace'));
      const holder = new THREE.Group(); holder.position.set(x, 166, 0); holder.rotation.z = (u - 0.5) * -0.12; g.add(holder);
      this.add(holder, m, 'carapace', { glass: true, inkAt: 28 });
      // a graphite seam rib under each plate's leading edge
      const rib = new THREE.Mesh(new THREE.TorusGeometry(rx - 6, 1.6, 6, 40, Math.PI - 0.68), this.mat.graphite);
      rib.rotation.y = Math.PI / 2; rib.rotation.z = 0.34; rib.position.x = len / 2 - 4; rib.scale.y = 0.78;
      this.add(holder, rib, 'carapace', { ink: false });
      this.plates.push({ holder, base: holder.position.clone(), i });
    }
  }

  // dorsal heat-sink crest: nine blades that fold flat when cool and rise as the core heats
  buildCrest() {
    const g = new THREE.Group(); this.body.add(g); this.crest = g; this.fins = [];
    for (let i = 0; i < 9; i++) {
      const x = -96 + i * 22, h = 40 + 16 * Math.sin((i / 8) * Math.PI);
      const sh = new THREE.Shape(); sh.moveTo(-12, 0); sh.lineTo(12, 0); sh.lineTo(6, h * 0.92); sh.quadraticCurveTo(0, h * 1.04, -5, h * 0.9); sh.lineTo(-12, 0);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 2.4, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 1 }); geo.translate(0, 0, -1.2);
      const hinge = new THREE.Group(); hinge.position.set(x, 222 + Math.sin((i / 8) * Math.PI) * 6, 0); g.add(hinge);
      const fin = new THREE.Mesh(geo, this.mat.graphite); this.add(hinge, fin, 'fins', { inkOp: 0.35 });
      const tip = new THREE.Mesh(new THREE.BoxGeometry(11, 3, 3.2), this.mat.finTip); tip.position.set(0.5, h * 0.93, 0); tip.rotation.z = 0.2;
      this.add(hinge, tip, 'fins', { ink: false });
      this.fins.push({ hinge, i });
    }
    // coolant lines from the core up to the crest
    for (const z of [-7, 7]) {
      const c = new THREE.CatmullRomCurve3([v3(20, 168, z), v3(0, 196, z * 1.6), v3(-40, 214, z), v3(-80, 216, z)]);
      this.add(g, new THREE.Mesh(new THREE.TubeGeometry(c, 30, 2.4, 8), this.mat.graphite), 'fins', { ink: false });
    }
  }

  // power core in the chest: glows with the load
  buildCore() {
    const g = new THREE.Group(); this.body.add(g); this.coreG = g;
    const core = new THREE.Mesh(new THREE.CapsuleGeometry(19, 54, 6, 24), this.mat.core); core.rotation.z = Math.PI / 2; core.position.set(18, 168, 0);
    this.add(g, core, 'core', { inkOp: 0.3 });
    for (const dx of [-26, 0, 26]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(20.5, 2.2, 8, 32), this.mat.graphite); r.rotation.y = Math.PI / 2; r.position.set(18 + dx, 168, 0);
      this.add(g, r, 'core', { ink: false });
    }
    this.coreMesh = core;
  }

  // four flank cells in saddles, each with a band that brightens under draw
  buildCells() {
    const g = new THREE.Group(); this.body.add(g); this.cellsG = g; this.cellParts = [];
    const body = new THREE.CapsuleGeometry(11.5, 26, 8, 28); body.rotateZ(Math.PI / 2);
    for (const s of [1, -1]) for (const x of [30, -40]) {
      const h = new THREE.Group(); h.position.set(x, 160, s * 44); g.add(h);
      this.add(h, new THREE.Mesh(body, this.white('cells')), 'cells', { glass: true, inkAt: 40 });
      const band = new THREE.Mesh(new THREE.TorusGeometry(12.2, 1.7, 8, 36), this.mat.band); band.rotation.y = Math.PI / 2;
      this.add(h, band, 'cells', { ink: false });
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 38, 18), this.mat.graphite); inner.rotation.z = Math.PI / 2;
      this.add(h, inner, 'cells', { ink: false });
      const saddle = new THREE.Mesh(new THREE.BoxGeometry(30, 5, 10), this.mat.steel); saddle.position.set(0, -12, -s * 4);
      this.add(h, saddle, 'cells');
      this.cellParts.push({ h, base: h.position.clone(), s });
    }
  }

  // neck chain and sensor head: graphite skull, white cranial cap, a visor with the lens array
  buildHead() {
    const base = new THREE.Group(); base.position.set(132, 200, 0); this.body.add(base); this.headBase = base;
    const W = this.white('head'), gm = this.mat.graphite;
    const ext = (pts, depth, bevel = 3) => {
      const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
      const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 3, curveSegments: 16 }); g.translate(0, 0, -depth / 2); return g;
    };
    this.neck = [];
    let parent = base;
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Group(); seg.position.set(i === 0 ? 0 : 26, i === 0 ? 0 : 13, 0); seg.rotation.z = 0; parent.add(seg);
      const j = new THREE.Mesh(new THREE.SphereGeometry(15 - i * 1.5, 22, 16), gm); this.add(seg, j, 'head', { ink: false });
      const core = new THREE.Mesh(new THREE.CylinderGeometry(10 - i, 11 - i, 28, 16), gm); core.rotation.z = -Math.PI / 2 + 0.45; core.position.set(13, 6, 0);
      this.add(seg, core, 'head', { ink: false });
      // a white plate over the top of each segment
      const sh = new THREE.Shape(); const rx = 19 - i * 1.5, ry = 15 - i, t = 3.5;
      sh.absellipse(0, 0, rx, ry, 0.3, Math.PI - 0.3, false); sh.lineTo(Math.cos(Math.PI - 0.3) * (rx - t), Math.sin(Math.PI - 0.3) * (ry - t)); sh.absellipse(0, 0, rx - t, ry - t, Math.PI - 0.3, 0.3, true);
      const pg = new THREE.ExtrudeGeometry(sh, { depth: 24, bevelEnabled: true, bevelThickness: 1.4, bevelSize: 1.2, bevelSegments: 2, curveSegments: 20 }); pg.translate(0, 0, -12); pg.rotateY(Math.PI / 2);
      const plate = new THREE.Mesh(pg, W); plate.position.set(12, 6, 0); plate.rotation.z = 0.45;
      this.add(seg, plate, 'head', { glass: true, inkAt: 28 });
      this.neck.push(seg); parent = seg;
    }
    const head = new THREE.Group(); head.position.set(28, 14, 0); parent.add(head); this.head = head;
    // graphite skull
    this.add(head, new THREE.Mesh(ext([[-8, -12], [50, -18], [84, -8], [90, 4], [74, 14], [12, 18], [-8, 8]], 32, 3), gm), 'head', { inkOp: 0.3 });
    // white cranial cap, longer than the skull, so the visor sits under its brow
    this.add(head, new THREE.Mesh(ext([[-6, 12], [40, 14], [92, 6], [96, 12], [80, 24], [20, 30], [-8, 22]], 44, 4), W), 'head', { glass: true, inkAt: 26 });
    // cheek plates
    for (const s of [1, -1]) {
      const ch = new THREE.Mesh(ext([[6, -8], [46, -14], [62, -4], [44, 8], [8, 8]], 3, 1.5), W); ch.position.z = s * 19;
      this.add(head, ch, 'head', { glass: true });
    }
    // lower jaw
    this.add(head, new THREE.Mesh(ext([[2, -14], [58, -22], [82, -18], [62, -30], [6, -24]], 24, 2), gm), 'head', { inkOp: 0.3 });
    // visor band and lens array, facing forward
    const visor = new THREE.Mesh(new THREE.BoxGeometry(6, 14, 40), gm); visor.position.set(91, 2, 0);
    this.add(head, visor, 'head', { inkOp: 0.3 });
    const lensG = new THREE.Group(); lensG.position.set(94.5, 2, 0); lensG.rotation.y = Math.PI / 2; head.add(lensG); this.lensG = lensG;
    const bez = new THREE.Mesh(new THREE.TorusGeometry(7, 2, 12, 36), this.mat.steel); this.add(lensG, bez, 'head', { ink: false });
    const eye = new THREE.Mesh(new THREE.CircleGeometry(6.2, 36), this.mat.lens); eye.position.z = 0.5; this.add(lensG, eye, 'head', { ink: false, shadow: false });
    for (const dx of [-13, 13]) {
      const e2 = new THREE.Mesh(new THREE.CircleGeometry(2.6, 20), this.mat.lens); e2.position.set(dx, 1, 0.4); this.add(lensG, e2, 'head', { ink: false, shadow: false });
    }
    // sensor vanes swept back from the crown
    for (const s of [1, -1]) {
      const vane = new THREE.Mesh(ext([[0, 0], [-58, 22], [-64, 18], [-4, -4]], 1.6, 0.6), gm); vane.position.set(36, 28, s * 18); vane.rotation.x = s * 0.3;
      this.add(head, vane, 'head', { inkOp: 0.3 });
    }
    // tiller tines under the jaw, orange tips that touch the soil when grazing
    for (const s of [1, -1]) {
      const c = new THREE.QuadraticBezierCurve3(v3(50, -24, s * 9), v3(76, -40, s * 11), v3(98, -38, s * 8));
      this.add(head, new THREE.Mesh(new THREE.TubeGeometry(c, 16, 2.6, 8), gm), 'head', { ink: false });
      const tip = new THREE.Mesh(new THREE.ConeGeometry(3.2, 10, 12), this.mat.orange); tip.position.set(101, -37.5, s * 8); tip.rotation.z = -Math.PI / 2 - 0.1;
      this.add(head, tip, 'head', { ink: false });
    }
    // scan fan: a faint wedge of light from the main lens
    const fan = new THREE.Mesh(new THREE.ConeGeometry(70, 240, 32, 1, true), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
    fan.rotation.z = Math.PI / 2; fan.position.set(95 + 120, 2, 0); head.add(fan); this.fan = fan;
    fan.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.ConeGeometry(70, 240, 8, 1, true), 1), new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.25 })));
  }

  buildTail() {
    const base = new THREE.Group(); base.position.set(-146, 186, 0); this.body.add(base); this.tail = [];
    let parent = base;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group(); seg.position.set(i === 0 ? 0 : -20 + i, 0, 0); seg.rotation.z = 0.12; parent.add(seg);
      this.add(seg, new THREE.Mesh(new THREE.SphereGeometry(8 - i, 16, 12), this.mat.graphite), 'tail', { ink: false });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(18 - i * 2, 6, 18 - i * 3), this.white('tail')); plate.position.set(-10, 7 - i, 0);
      this.add(seg, plate, 'tail', { glass: true });
      this.tail.push(seg); parent = seg;
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 44, 8), this.mat.graphite); mast.position.set(-6, 24, 0); mast.rotation.z = 0.3;
    this.add(parent, mast, 'tail', { ink: false });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 10), this.mat.band); bulb.position.set(-12.5, 45, 0);
    this.add(parent, bulb, 'tail', { ink: false });
    this.bulb = bulb;
  }

  // belly coring drill: housing, telescoping shaft, bit
  buildDrill() {
    const g = new THREE.Group(); g.position.set(-14, 122, 0); this.body.add(g); this.drillG = g;
    this.add(g, new THREE.Mesh(new THREE.CylinderGeometry(15, 13, 26, 28), this.mat.graphite), 'drill');
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 1, 16), this.mat.steel); this.shaft = shaft;
    this.add(g, shaft, 'drill', { ink: false });
    const bit = new THREE.Group(); g.add(bit); this.bit = bit;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 8, 20), this.mat.orange); this.add(bit, collar, 'drill', { ink: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(8, 30, 6), this.mat.steel); cone.rotation.x = Math.PI; cone.position.y = -19; this.add(bit, cone, 'drill');
  }

  // ---------------------------------------------------------------------------
  // a digitigrade leg: hip, thigh, knee, shin, ankle, metatarsal, foot, and a knee ram
  buildLeg(id, idx) {
    const front = id[1] === 'F', s = id[0] === 'L' ? 1 : -1;
    const [hx, hy, hz] = HIP[id];
    const g = new THREE.Group(); this.rig.add(g);
    const W = this.white('legs'), gm = this.mat.graphite;
    const seg = (len, r0, r1, plate) => {
      const grp = new THREE.Group(); g.add(grp);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 16), gm); core.position.y = len / 2;
      this.add(grp, core, 'legs', { ink: false });
      if (plate) {
        const sh = new THREE.Shape(); const w0 = plate[0], w1 = plate[1];
        sh.moveTo(-w0, 4); sh.lineTo(w0, 4); sh.quadraticCurveTo(w0 + 2, len * 0.5, w1, len - 6); sh.lineTo(-w1, len - 6); sh.quadraticCurveTo(-w0 - 3, len * 0.5, -w0, 4);
        const pg = new THREE.ExtrudeGeometry(sh, { depth: plate[2], bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 2, curveSegments: 10 });
        pg.translate(0, 0, -plate[2] / 2);
        const pm = new THREE.Mesh(pg, W); this.add(grp, pm, 'legs', { glass: true, inkAt: 30 });
      }
      return grp;
    };
    const joint = (r) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), gm); this.add(g, m, 'legs', { ink: false }); return m; };
    const hip = joint(16);
    // hip shield, fixed to the body
    const hs = new THREE.Shape(); hs.moveTo(0, 38); hs.quadraticCurveTo(34, 30, 30, -6); hs.quadraticCurveTo(20, -40, 0, -44); hs.quadraticCurveTo(-24, -36, -30, -4); hs.quadraticCurveTo(-32, 30, 0, 38);
    const hsg = new THREE.ExtrudeGeometry(hs, { depth: 6, bevelEnabled: true, bevelThickness: 2.5, bevelSize: 2.5, bevelSegments: 3, curveSegments: 32 });
    const shield = new THREE.Mesh(hsg, W); shield.position.set(hx, hy + 10, hz + s * 12 - (s < 0 ? 6 : 0)); shield.rotation.y = s * 0.1;
    this.add(this.body, shield, 'legs', { glass: true });
    const thigh = seg(L1, front ? 12 : 14, 8, [front ? 16 : 19, 9, 28]);
    const knee = joint(11);
    const ringMat = this.mat.ring.clone();
    const kneeRing = new THREE.Mesh(new THREE.TorusGeometry(11.5, 2.4, 10, 28), ringMat);
    this.add(g, kneeRing, 'legs', { ink: false });
    const shin = seg(L2, 7, 5.5, null);
    const ankle = joint(8);
    const meta = seg(10, 4.6, 4.6, null); // stretched to the ankle-foot distance each frame
    const foot = new THREE.Group(); g.add(foot);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(14, 16, 7, 24), W); pad.position.y = 3.5; this.add(foot, pad, 'legs', { glass: true });
    for (const a of [-0.45, 0, 0.45]) {
      const toe = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 6), gm); toe.position.set(Math.cos(a) * 16, 2.5, Math.sin(a) * 16); toe.rotation.y = -a;
      this.add(foot, toe, 'legs', { inkOp: 0.3 });
    }
    // knee ram: barrel on the thigh, rod into the shin
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 36, 14), this.mat.steel); barrel.geometry.translate(0, 18, 0);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1, 10), this.mat.orange); rod.geometry.translate(0, 0.5, 0);
    this.add(g, barrel, 'legs', { ink: false }); this.add(g, rod, 'legs', { ink: false });
    return {
      id, front, s, g, hip, thigh, knee, kneeRing, ringMat, shin, ankle, meta, foot, barrel, rod, shield,
      H: v3(hx, hy, hz + s * 2), K: v3(), A: v3(), F: v3(hx, 0, hz + s * 6), was: true, ringGlow: 0,
    };
  }

  buildPrints() {
    this.prints = [];
    const geo = new THREE.CircleGeometry(15, 24); geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(geo, this.mat.print.clone()); m.visible = false; m.position.y = 0.4; this.platform.add(m);
      this.prints.push({ m, age: 9 });
    }
    this.printI = 0;
  }

  // ---------------------------------------------------------------------------
  // console-facing controls
  setFocus(sys) {
    this.focus = sys;
    this.applyLook();
  }
  setMode(mode) { this.mode = mode; this.applyLook(); }
  explode(on) { this.eT = on ? 1 : 0; }
  applyLook() {
    const cut = this.mode === 'cut', glassy = this.mode === 'glass';
    const inFocus = (sys) => this.focus === null || sys === this.focus || (this.focus === 'core' && sys === 'frame');
    for (const r of this.reg) {
      const keep = inFocus(r.sys);
      let m = r.orig;
      if (!keep) m = this.ghost;
      else if (glassy && r.glass) m = this.glass;
      r.mesh.material = m;
      r.mesh.castShadow = keep && !(glassy && r.glass);
      for (const c of r.mesh.children) if (c.userData.ink) c.material.opacity = keep ? (glassy && r.glass ? 0.18 : 0.5) : 0.06;
    }
    const planes = cut ? [this.cutPlane] : null;
    this.root.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) if (m.clippingPlanes !== planes) { m.clippingPlanes = planes; m.clipShadows = true; m.needsUpdate = true; } });
    this.platform.traverse((o) => { if (o.material) { o.material.clippingPlanes = null; o.material.needsUpdate = true; } });
    this.stage.noAO = cut; this.stage.gtao.enabled = this.stage.quality === 2 && !cut;
  }

  // ---------------------------------------------------------------------------
  // per frame: pose from the sim output
  update(st, out, dt, T) {
    this.e += (this.eT - this.e) * (1 - Math.exp(-dt * 3.5));
    const e = smooth(Math.min(1, Math.max(0, this.e)));

    // grade: tilt the whole rig, lifted so the low end clears the turntable
    const th = out.theta;
    this.rig.rotation.z += (th - this.rig.rotation.z) * (1 - Math.exp(-dt * 2));
    this.rig.position.y = GROUND + 352 * Math.abs(Math.sin(this.rig.rotation.z));

    // body motion: bob twice per stride in a walk or trot, pitch in a bound
    const v = out.v, ph = st.phase * Math.PI * 2, k = Math.min(1, v / 0.6);
    let bob = 0, pitch = 0;
    if (out.gait === 'bound') { bob = -5 * Math.cos(ph * 2) * k; pitch = 0.045 * Math.sin(ph) * k; }
    else { bob = -(out.gait === 'trot' ? 4 : 2.2) * Math.cos(ph * 2) * k; pitch = 0.012 * Math.sin(ph * 2) * k; }
    const idle = (1 - k) * Math.sin(T * 1.3) * 1.2;
    this.body.position.y = LIFT + bob + idle - (out.mass - 840) * 0.012; // payload settles it a little
    this.body.rotation.z = pitch - this.rig.rotation.z * 0.25; // keep the head a little more level on slopes

    // legs
    this.body.updateMatrix();
    const sweep = Math.min(175, out.sweep * 100);
    const lift = (14 + 12 * Math.min(1.6, out.Fr)) * Math.min(1, v / 0.35);
    out.legs.forEach((L, i) => this.poseLeg(this.legs[i], L, sweep, lift, out, st, e, dt));

    // neck and head: graze sweep, look ahead when moving fast
    const scanning = st.scan && st.drillDepth < 0.05;
    this.sweepYaw += dt * (scanning ? 0.8 : 0);
    const yaw = scanning ? Math.sin(this.sweepYaw) * 0.42 : 0;
    const graze = Math.max(0, 1 - v / 1.4) * (scanning ? 0.16 : 0.05);
    const pitchH = -graze + 0.03 * Math.sin(ph * 2) * k + Math.min(0.12, v * 0.02);
    for (const n of this.neck) { n.rotation.y += (yaw / 3 - n.rotation.y) * (1 - Math.exp(-dt * 4)); n.rotation.z = pitchH / 3 - 0.03; }
    this.head.rotation.z = -pitch * 0.6 + this.rig.rotation.z * 0.15;
    this.fan.visible = scanning && this.mode !== 'cut';
    this.fan.material.opacity = 0.05 + 0.03 * Math.sin(T * 5);
    this.mat.lens.emissiveIntensity = scanning ? 1.2 + 0.4 * Math.sin(T * 6) : 0.35;
    this.headBase.position.set(132 + 70 * e, 200 + 40 * e, 0);

    // tail sways against the gait
    this.tail.forEach((s, i) => { s.rotation.y = Math.sin(ph + i * 0.6) * 0.06 * k + Math.sin(T * 0.7 + i) * 0.03; });
    this.tail[0].parent.position.set(-146 - 60 * e, 186, 0);
    this.mat.band.emissiveIntensity = 0.05 + Math.min(1.4, out.P / 26000) * (0.6 + 0.4 * Math.sin(T * 3));

    // crest: fins rise with st.fins; tips glow with heat
    this.fins.forEach((f) => { f.hinge.rotation.z = 1.18 * (1 - st.fins) + 0.04 * Math.sin(T * 2 + f.i) * st.fins; f.hinge.position.y = 222 + Math.sin((f.i / 8) * Math.PI) * 6 + 110 * e; });
    this.mat.finTip.emissiveIntensity = Math.max(0, (out.temp - 40) / 25) * 1.6;

    // core glows with load; carapace and cells lift away when exploded
    this.mat.core.emissiveIntensity = 0.25 + Math.min(1.8, out.load * 2.1);
    this.coreG.position.y = -78 * e; this.coreG.position.x = 10 * e;
    this.plates.forEach((p) => {
      if (p.i >= 0) p.holder.position.set(p.base.x + (p.i - 3) * 14 * e, p.base.y + (64 + p.i * 7) * e, 0);
      else p.holder.position.set(p.base.x, p.base.y - 10 * e, p.base.z + p.side * 70 * e);
    });
    this.cellParts.forEach((c) => c.h.position.set(c.base.x, c.base.y + 10 * e, c.base.z + c.s * 96 * e));

    // drill: the shaft telescopes down until the bit is 6 cm into the ground, and spins
    const d = st.drillDepth, reach = 116 * d; // stowed: bit inside the housing; full depth: tip 6 cm into the ground
    this.bit.position.y = 14 - reach; this.shaft.scale.y = Math.max(0.01, reach); this.shaft.position.y = -reach / 2; this.shaft.visible = reach > 1;
    this.drillG.position.y = 122 - 110 * e;
    this.bit.rotation.y += dt * (d > 0.02 ? 16 : 0);

    // survey track and footprints scroll back at the walking speed
    this.updateTrack(st);
    const dx = v * 100 * dt;
    for (const p of this.prints) {
      if (!p.m.visible) continue;
      p.age += dt; p.m.position.x -= dx;
      p.m.material.opacity = Math.max(0, 0.38 - p.age * 0.05);
      if (p.m.position.x < -340 || p.m.material.opacity <= 0) p.m.visible = false;
    }
    this.printsOn = this.printsOn ?? true;
  }

  poseLeg(leg, L, sweep, lift, out, st, e, dt) {
    const { front, s } = leg;
    // hip in ground (rig) space: the body carries the bob and pitch
    const Hr = leg.H.clone().applyMatrix4(this.body.matrix);
    // foot path, relative to a neutral point under the hip at rest
    const nx = leg.H.x + (front ? 8 : -6);
    let fx, fy;
    if (out.gait === 'stand') { fx = nx; fy = 0; }
    else if (L.stance) { fx = nx + sweep / 2 - sweep * L.s; fy = 0; }
    else { const u = smooth(L.s); fx = nx - sweep / 2 + sweep * u; fy = lift * Math.pow(Math.sin(Math.PI * L.s), 0.85); }
    leg.F.set(fx, fy, leg.H.z + s * 4);
    if (L.stance && !leg.was && out.v > 0.08 && this.printsOn) { // footprint at touchdown
      const p = this.prints[this.printI++ % this.prints.length];
      p.m.visible = true; p.age = 0; p.m.position.set(fx, 0.4 + (this.printI % 3) * 0.05, leg.F.z); p.m.material.opacity = 0.38;
    }
    leg.was = L.stance;

    // ankle above and behind the foot (digitigrade); 2-bone IK from hip to ankle
    const [ax, ay] = front ? ANKLE.front : ANKLE.hind;
    const tilt = L.stance ? 0 : Math.sin(Math.PI * L.s) * (front ? 10 : 14);
    const A = leg.A.set(fx + ax - tilt * 0.6, fy + ay + tilt * 0.2, leg.F.z);
    let dx = A.x - Hr.x, dy = A.y - Hr.y, d = Math.hypot(dx, dy);
    const maxd = L1 + L2 - 0.5;
    if (d > maxd) { A.x = Hr.x + (dx / d) * maxd; A.y = Hr.y + (dy / d) * maxd; dx = A.x - Hr.x; dy = A.y - Hr.y; d = maxd; }
    const base = Math.atan2(dy, dx);
    const alpha = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
    const ang = base + (front ? -alpha : alpha); // front elbows point back, hind knees forward
    const K = leg.K.set(Hr.x + Math.cos(ang) * L1, Hr.y + Math.sin(ang) * L1, leg.H.z + s * 3);

    // exploded: each leg slides out from its hip
    const off = v3((front ? 30 : -30) * e, 0, s * 58 * e);
    const Hb = Hr.clone().add(off), Kb = K.clone().add(off), Ab = A.clone().add(off), Fb = leg.F.clone().add(off);
    const orient = (grp, a, b) => { grp.position.copy(a); const dir = b.clone().sub(a); const len = dir.length(); grp.quaternion.setFromUnitVectors(Y, dir.normalize()); return len; };
    leg.hip.position.copy(Hb);
    orient(leg.thigh, Hb, Kb);
    leg.knee.position.copy(Kb); leg.kneeRing.position.copy(Kb);
    orient(leg.shin, Kb, Ab);
    leg.ankle.position.copy(Ab);
    const ml = orient(leg.meta, Ab, Fb); leg.meta.scale.y = ml / 10;
    leg.foot.position.copy(Fb); leg.foot.rotation.z = L.stance ? 0 : -Math.sin(Math.PI * L.s) * 0.35;
    leg.shield.position.set(leg.H.x + off.x, leg.H.y + 10, leg.H.z + s * 12 - (s < 0 ? 6 : 0) + off.z);
    // knee ram: barrel from a lug on the thigh, rod from a lug on the shin
    const lugA = Hb.clone().lerp(Kb, 0.22).add(v3(front ? -9 : 9, 0, s * 9));
    const lugB = Kb.clone().lerp(Ab, 0.3).add(v3(front ? -7 : 7, 0, s * 9));
    orient(leg.barrel, lugA, lugB);
    const rl = orient(leg.rod, lugB, lugA); leg.rod.scale.y = Math.max(1, rl - 30);
    // the knee ring glows while the leg carries load
    const glow = L.stance ? Math.min(1, L.F / 9000) : 0;
    leg.ringGlow += (glow - leg.ringGlow) * (1 - Math.exp(-dt * 12));
    leg.ringMat.emissiveIntensity = leg.ringGlow * 2.2;
  }

  updateTrack(st) {
    const pos = this.track.geometry.attributes.position.array;
    const step = 40, o = (st.odo * 100) % step;
    let j = 0;
    for (let i = 0; i < this.trackN; i++) {
      const x = 340 - i * step - o;
      for (const z of [-60, 60]) { pos[j++] = x; pos[j++] = 0.5; pos[j++] = z - 6; pos[j++] = x; pos[j++] = 0.5; pos[j++] = z + 6; }
    }
    this.track.geometry.attributes.position.needsUpdate = true;
  }

  // world-space anchor points for callouts (local to root)
  makeAnchors() {
    const w = (o, p) => () => o.localToWorld(p.clone());
    const L = Object.fromEntries(this.legs.map((l) => [l.id, l]));
    return {
      lens: w(this.lensG, v3(0, 0, 4)), head: w(this.head, v3(40, 26, 0)), tines: w(this.head, v3(96, -30, 9)), vane: w(this.head, v3(-10, 40, 16)),
      crest: () => this.fins[4].hinge.localToWorld(v3(0, 30, 0)), carapace: () => this.plates[2].holder.localToWorld(v3(0, 40, 30)),
      core: () => this.coreMesh.localToWorld(v3(0, 0, 0)), cells: () => this.cellParts[0].h.localToWorld(v3(0, 16, 10)),
      kneeLF: () => L.LF.knee.getWorldPosition(v3()), kneeLH: () => L.LH.knee.getWorldPosition(v3()), footRH: () => L.RH.foot.getWorldPosition(v3()),
      ramLH: () => L.LH.barrel.localToWorld(v3(0, 18, 0)), hipRF: () => L.RF.hip.getWorldPosition(v3()),
      drill: () => this.bit.localToWorld(v3(0, -10, 0)), drillHouse: () => this.drillG.localToWorld(v3(0, 0, 14)),
      tail: () => this.bulb.getWorldPosition(v3()), manifold: () => this.frame.localToWorld(v3(-6, 128, 16)), spine: () => this.frame.localToWorld(v3(-40, 198, 0)),
      fins0: () => this.fins[8].hinge.localToWorld(v3(0, 24, 0)), coolant: () => this.crest.localToWorld(v3(-20, 206, 8)),
    };
  }
}
