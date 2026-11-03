// A planet as a study model. Planet mean radius = 1 scene unit.
// Layers are nested shells with a 90° wedge cut out; each layer has two half-annulus
// section caps on the cut faces. Cutaway shows the section; Exploded slides the inner
// shells out through the opening on a spring, innermost furthest.
import * as THREE from 'three';
import { surfaceMaterial, haloMaterial, ringMaterial } from './shaders.js';
import { EARTH } from './data.js';

const WEDGE_START = Math.PI / 2, WEDGE_LEN = Math.PI * 1.5; // removes phi 0..90°, opening toward (-x, +z)
export const OPEN_DIR = new THREE.Vector3(-1, 0, 1).normalize();

function capMaterial(color, solid, accent) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, r0: { value: 0 }, r1: { value: 1 }, solid: { value: solid }, highlight: { value: 0 }, ghost: { value: 0 }, accent },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 color, accent; uniform float r0, r1, solid, highlight, ghost; varying vec2 vP;
      void main(){
        float r = length(vP); float t = (r - r0) / max(1e-4, r1 - r0);
        vec3 c = color * (0.78 + 0.32 * (1.0 - t));
        // section hatching: solid layers get 45° lines, fluid layers a fine stipple
        float h = solid > 0.5 ? step(0.82, fract((vP.x + vP.y) * 34.0)) : step(0.93, fract(vP.x * 50.0) ) * step(0.93, fract(vP.y * 50.0));
        c = mix(c, c * 0.62, h * 0.55);
        float px = fwidth(r) * 1.4;
        float edge = smoothstep(px, 0.0, abs(r - r1)) + smoothstep(px, 0.0, abs(r - r0)) * step(0.001, r0);
        c = mix(c, vec3(0.96), edge * 0.85);
        c = mix(c, accent, highlight * 0.55);
        c = mix(c, accent, edge * highlight);
        gl_FragColor = vec4(c, 1.0 - ghost * 0.85);
      }`,
    side: THREE.DoubleSide, transparent: true,
  });
}
function shellMaterial(color, accent) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide, transparent: true, emissive: new THREE.Color(color).multiplyScalar(0.12) });
}

function ringTexture(p, R) {
  const W = 1024; const c = document.createElement('canvas'); c.width = W; c.height = 4; const g = c.getContext('2d');
  const r0 = Math.min(...p.ringList.map((r) => r.r0)) / R, r1 = Math.max(...p.ringList.map((r) => r.r1)) / R;
  const X = (r) => (r / R - r0) / (r1 - r0) * W;
  g.clearRect(0, 0, W, 4);
  let s = p.no * 97; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (const ring of p.ringList) {
    if (ring.gap) continue;
    const a = X(ring.r0), b = Math.max(a + 1.5, X(ring.r1));
    for (let x = Math.floor(a); x < b; x++) {
      const k = ring.k * (0.75 + rnd() * 0.5);
      const tone = 0.75 + rnd() * 0.3;
      g.fillStyle = `rgba(${Math.round(235 * tone)},${Math.round(222 * tone)},${Math.round(196 * tone)},${Math.min(1, k)})`;
      g.fillRect(x, 0, 1, 4);
    }
  }
  if (p.id === 'saturn') { // Encke gap
    g.clearRect(X(133589 - 160), 0, Math.max(1, X(133589 + 160) - X(133589 - 160)), 4);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return { tex: t, inner: r0, outer: r1 };
}

export class PlanetModel {
  constructor(p, accent) {
    this.p = p; this.accent = accent;
    const R = p.phys.meanR;
    this.root = new THREE.Group();
    this.tilt = new THREE.Group(); this.tilt.rotation.z = -THREE.MathUtils.degToRad(Math.min(p.phys.tilt, 180));
    this.root.add(this.tilt);
    this.spin = new THREE.Group(); this.tilt.add(this.spin);
    const flat = p.phys.polR / p.phys.eqR, eq = p.phys.eqR / R;
    this.body = new THREE.Group(); this.body.scale.set(eq, eq * flat, eq); this.spin.add(this.body);

    // full surface for Surface mode
    this.surfMat = surfaceMaterial(p.surface, accent);
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), this.surfMat);
    this.body.add(this.surface);
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(1.025, 64, 48), haloMaterial(p.surface.atm, p.surface.atmK * (p.kind === 'Rocky planet' ? 1 : 0.6)));
    this.body.add(this.halo);

    // layers (centre -> surface)
    this.layers = p.layers.map((L, k) => {
      const g = new THREE.Group();
      const r0 = L.r0 / R, r1 = L.r1 / R;
      const outer = k === p.layers.length - 1;
      const shellMat = outer ? surfaceMaterial(p.surface, accent) : shellMaterial(L.color, accent);
      const shell = new THREE.Mesh(new THREE.SphereGeometry(r1, 96, 64, WEDGE_START, WEDGE_LEN), shellMat);
      const solid = /solid/i.test(L.state) && !/molten|liquid|fluid/i.test(L.state) ? 1 : 0;
      const caps = [0, 1].map((i) => {
        const m = capMaterial(L.color, solid, accent); m.uniforms.r0.value = r0; m.uniforms.r1.value = r1;
        const geo = r0 > 0.001 ? new THREE.RingGeometry(r0, r1, 96, 1, i === 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI) : new THREE.CircleGeometry(r1, 96, i === 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI);
        const mesh = new THREE.Mesh(geo, m);
        if (i === 1) mesh.rotation.y = -Math.PI / 2;
        return mesh;
      });
      g.add(shell, ...caps);
      this.body.add(g);
      return { L, k, g, shell, caps, r0, r1, outer, off: 0, vel: 0 };
    });

    // rings
    this.ringMesh = null;
    if (p.ringList.length) {
      const rt = ringTexture(p, R);
      const mat = ringMaterial(rt.tex, rt.inner, rt.outer, p.id === 'saturn' ? '#f2e6cc' : p.id === 'jupiter' ? '#c9a27a' : '#9aa4b0');
      mat.uniforms.strength = { value: { saturn: 1, jupiter: 0.22, uranus: 0.75, neptune: 0.45 }[p.id] ?? 0.5 };
      this.ringMesh = new THREE.Mesh(new THREE.RingGeometry(rt.inner, rt.outer, 256, 1), mat);
      this.ringMesh.rotation.x = -Math.PI / 2;
      this.ringMesh.renderOrder = 3;
      this.tilt.add(this.ringMesh);
      this.ringInfo = rt;
    }

    // moons on log-compressed orbits in the equatorial plane
    this.moons = p.moonList.map((m, i) => {
      const ar = m.a / R; const dist = 1.75 + 1.25 * Math.log10(ar);
      const rad = Math.max(0.028, Math.min(0.28, (m.r / R) * 0.9));
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(rad, 32, 24), new THREE.MeshStandardMaterial({ color: 0xc9c4bc, roughness: 0.85 }));
      const orbit = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 160 }, (_, j) => { const a = j / 160 * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * dist, 0, Math.sin(a) * dist); })), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 }));
      const w = (m.periodD < 0 ? -1 : 1) * 0.9 / Math.sqrt(Math.abs(m.periodD));
      const g = new THREE.Group(); g.add(orbit, mesh); this.tilt.add(g);
      return { m, mesh, orbit, g, dist, rad, w, a: i * 2.1 + 0.6 };
    });

    // spin axis and equator
    const axisGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -1.55, 0), new THREE.Vector3(0, 1.55, 0)]);
    this.axis = new THREE.Line(axisGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.05, gapSize: 0.04, transparent: true, opacity: 0.55 }));
    this.axis.computeLineDistances();
    const eqPts = Array.from({ length: 200 }, (_, j) => { const a = j / 200 * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 1.18, 0, Math.sin(a) * 1.18); });
    this.equator = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(eqPts), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.04, gapSize: 0.05, transparent: true, opacity: 0.3 }));
    this.equator.computeLineDistances();
    this.tilt.add(this.axis, this.equator);

    // Earth to scale, beside the planet
    const rE = EARTH.radius / R;
    this.ghost = new THREE.Group();
    const gm = new THREE.Mesh(new THREE.SphereGeometry(rE, 40, 28), new THREE.MeshBasicMaterial({ color: 0x8ab4ff, wireframe: true, transparent: true, opacity: 0.22 }));
    const gl = new THREE.Mesh(new THREE.SphereGeometry(rE, 40, 28), new THREE.MeshStandardMaterial({ color: 0x3a6fb0, roughness: 0.6, transparent: true, opacity: 0.55 }));
    this.ghost.add(gm, gl);
    this.ghost.position.set(1.0 + Math.max(0.35, rE) + 0.25, 0, 0.6);
    this.ghostR = rE;
    this.root.add(this.ghost);
    if (p.id === 'earth') this.ghost.visible = false;

    this.mode = 'surface'; this.focus = null; this.glass = false;
    this.show = { rings: true, moons: false, axis: true, compare: false };
    this.spinRate = (2 * Math.PI) / (Math.sign(p.phys.rotH) * Math.min(60, Math.max(8, Math.abs(p.phys.rotH) / 2.2))); // a readable spin, slow for slow planets
    this.apply();
  }

  setMode(m) { this.mode = m; this.apply(); }
  setFocus(k) { this.focus = k; this.apply(); }
  setGlass(v) { this.glass = v; this.apply(); }
  setShow(key, v) { this.show[key] = v; this.apply(); }

  apply() {
    const sect = this.mode !== 'surface';
    this.surface.visible = !sect;
    this.halo.visible = !sect && this.p.surface.atmK > 0;
    for (const l of this.layers) {
      l.g.visible = sect;
      const ghost = this.focus !== null && this.focus !== l.k;
      const hi = this.focus === l.k ? 1 : 0;
      for (const c of l.caps) { c.material.uniforms.highlight.value = hi; c.material.uniforms.ghost.value = ghost ? 1 : 0; c.material.depthWrite = !ghost; }
      const sm = l.shell.material;
      if (sm.uniforms) { sm.uniforms.highlight.value = hi; sm.uniforms.glass.value = ghost || this.glass ? 1 : 0; sm.transparent = true; sm.depthWrite = !(ghost || this.glass); }
      else { sm.opacity = ghost ? 0.12 : this.glass ? 0.3 : 1; sm.depthWrite = !(ghost || this.glass); sm.emissive.set(hi ? this.accent.value : new THREE.Color(l.L.color).multiplyScalar(0.12)); sm.emissiveIntensity = hi ? 0.45 : 1; }
    }
    this.surfMat.uniforms.glass.value = this.glass ? 1 : 0; this.surfMat.transparent = this.glass; this.surfMat.depthWrite = !this.glass;
    if (this.ringMesh) this.ringMesh.visible = this.show.rings;
    for (const mo of this.moons) mo.g.visible = this.show.moons;
    this.axis.visible = this.equator.visible = this.show.axis;
    this.ghost.visible = this.show.compare && this.p.id !== 'earth';
  }

  // anchors for callouts, in world space
  layerAnchor(k) {
    const l = this.layers[k]; const r = (l.r0 + l.r1) / 2 || l.r1 * 0.5;
    // the middle of this layer's band on the cap that faces the opening (plane z=0, x<0), upper half
    const v = new THREE.Vector3(-r * 0.62, r * 0.78, 0.0);
    return l.g.localToWorld(v);
  }
  featureAnchor(f) {
    const la = THREE.MathUtils.degToRad(f.lat), lo = THREE.MathUtils.degToRad(f.lon);
    const v = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)).multiplyScalar(1.0);
    return this.surface.localToWorld(v);
  }
  featureNormal(f) {
    const la = THREE.MathUtils.degToRad(f.lat), lo = THREE.MathUtils.degToRad(f.lon);
    return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)).transformDirection(this.surface.matrixWorld);
  }
  moonAnchor(i) { return this.moons[i].mesh.getWorldPosition(new THREE.Vector3()); }
  ringAnchor(r) { const R = this.p.phys.meanR; const d = ((r.r0 + r.r1) / 2) / R; return this.tilt.localToWorld(new THREE.Vector3(-d * 0.71, 0, d * 0.71)); }

  update(dt, t, sunDir) {
    // spring the layers toward their exploded offsets
    const n = this.layers.length; const ex = this.mode === 'exploded';
    for (const l of this.layers) {
      const target = ex ? (n - 1 - l.k) * (0.62 + 0.18 * (n > 3 ? 0 : 1)) : 0;
      const acc = (target - l.off) * 90 - l.vel * 13; l.vel += acc * dt; l.off += l.vel * dt;
      l.g.position.copy(OPEN_DIR).multiplyScalar(l.off).add(new THREE.Vector3(0, l.off * 0.28, 0));
    }
    if (this.mode === 'surface') { if (!this.hold) this.spin.rotation.y += dt * this.spinRate; }
    else { // ease the spin so the wedge faces the turntable's front
      let r = this.spin.rotation.y % (Math.PI * 2); if (r > Math.PI) r -= Math.PI * 2; if (r < -Math.PI) r += Math.PI * 2;
      this.spin.rotation.y = r + (0 - r) * Math.min(1, dt * 3);
    }
    for (const mo of this.moons) { mo.a += dt * mo.w; mo.mesh.position.set(Math.cos(mo.a) * mo.dist, 0, -Math.sin(mo.a) * mo.dist); }
    const u = this.surfMat.uniforms; u.time.value = t; u.sunDir.value.copy(sunDir);
    for (const l of this.layers) if (l.shell.material.uniforms) { l.shell.material.uniforms.time.value = t; l.shell.material.uniforms.sunDir.value.copy(sunDir); }
    this.halo.material.uniforms.sunDir.value.copy(sunDir);
    if (this.ringMesh) { const m = this.ringMesh.material.uniforms; m.sunDir.value.copy(sunDir); this.root.getWorldPosition(m.center.value); m.radius.value = this.root.getWorldScale(new THREE.Vector3()).x * (this.p.phys.eqR / this.p.phys.meanR); }
  }

  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { if (m.uniforms?.map?.value) m.uniforms.map.value.dispose(); m.dispose(); }); } });
    this.root.removeFromParent();
  }
}
