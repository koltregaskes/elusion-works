// The swarm: every object as one GPU point. Two SGP4 snapshots (position + velocity) sit in
// two slots; the vertex shader blends them with a cubic Hermite curve, so motion stays smooth
// and exact at the snapshot times whatever the time warp. Objects in Earth's shadow dim.
import * as THREE from 'three';

export class Swarm {
  constructor(n) {
    this.n = n;
    this.slots = [new Float32Array(n * 6), new Float32Array(n * 6)];
    this.slotT = [0, 0]; // seconds relative to base
    this.ok = new Uint8Array(n);
    this.bufs = this.slots.map((a) => new THREE.InterleavedBuffer(a, 6).setUsage(THREE.DynamicDrawUsage));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(this.bufs[0], 3, 0));
    g.setAttribute('p0', new THREE.InterleavedBufferAttribute(this.bufs[0], 3, 0));
    g.setAttribute('v0', new THREE.InterleavedBufferAttribute(this.bufs[0], 3, 3));
    g.setAttribute('p1', new THREE.InterleavedBufferAttribute(this.bufs[1], 3, 0));
    g.setAttribute('v1', new THREE.InterleavedBufferAttribute(this.bufs[1], 3, 3));
    this.color = new Float32Array(n * 4);
    this.colorAttr = new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aColor', this.colorAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geometry = g;
    this.uniforms = {
      t0: { value: 0 }, t1: { value: 1 }, t: { value: 0 },
      sunDir: { value: new THREE.Vector3(1, 0, 0) },
      scale: { value: 1 }, size: { value: 1 },
      sel: { value: -1 }, hov: { value: -1 },
      dimShadow: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec3 p0; attribute vec3 v0; attribute vec3 p1; attribute vec3 v1; attribute vec4 aColor;
        uniform float t0, t1, t, scale, size, sel, hov, dimShadow; uniform vec3 sunDir;
        varying vec4 vC; varying float vRing;
        void main(){
          float D = t1 - t0; float s = abs(D) < 1e-6 ? 0.0 : clamp((t - t0) / D, -0.25, 1.35);
          float s2 = s*s, s3 = s2*s;
          vec3 p = (2.0*s3 - 3.0*s2 + 1.0)*p0 + (s3 - 2.0*s2 + s)*D*v0 + (-2.0*s3 + 3.0*s2)*p1 + (s3 - s2)*D*v1;
          float vis = aColor.a;
          float id = float(gl_VertexID);
          bool isSel = abs(id - sel) < 0.5, isHov = abs(id - hov) < 0.5;
          if (isSel || isHov) vis = max(vis, 1.0);
          if (vis <= 0.0 || dot(p0, p0) < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vC = vec4(0.0); return; }
          // eclipse: inside the cylinder of Earth's shadow
          float along = dot(p, sunDir); float perp = length(p - along * sunDir);
          float lit = (along < 0.0 && perp < 6.371) ? mix(1.0, 0.32, dimShadow) : 1.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          float ps = size * vis * scale * clamp(24.0 / dist, 0.55, 3.2);
          vRing = 0.0;
          if (isSel) { ps = max(ps, 12.0) * 2.4; vRing = 1.0; }
          else if (isHov) { ps = max(ps, 9.0) * 2.0; vRing = 0.6; }
          gl_PointSize = ps;
          vC = vec4(aColor.rgb * lit, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec4 vC; varying float vRing;
        void main(){
          vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
          if (r > 1.0) discard;
          float a;
          if (vRing > 0.0) {
            float core = smoothstep(0.32, 0.18, r);
            float ring = smoothstep(0.12, 0.0, abs(r - 0.78)) * vRing;
            a = max(core, ring);
            gl_FragColor = vec4(mix(vC.rgb, vec3(1.0), ring), a);
            return;
          }
          a = smoothstep(1.0, 0.15, r);
          a = a * a * 0.9 + smoothstep(0.35, 0.0, r) * 0.6;
          gl_FragColor = vec4(vC.rgb * a, a);
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.oldest = 0; // slot to overwrite next
    this.have = 0;
  }

  // Write a fresh snapshot into the slot holding the older time.
  push(tSec, pv, ok) {
    let k = this.have < 2 ? this.have : (this.slotT[0] <= this.slotT[1] ? 0 : 1);
    if (this.have < 2) this.have++;
    this.slots[k].set(pv); this.slotT[k] = tSec; this.bufs[k].needsUpdate = true;
    this.ok.set(ok);
    if (this.have === 1) { this.slots[1].set(pv); this.slotT[1] = tSec + 1e-3; this.bufs[1].needsUpdate = true; }
    this.uniforms.t0.value = this.slotT[0]; this.uniforms.t1.value = this.slotT[1];
  }
  // Snap both slots to one time (after a jump), with the next one to follow.
  reset() { this.have = 0; }
  latestT() { return Math.max(this.slotT[0], this.slotT[1]); }
  earliestT() { return Math.min(this.slotT[0], this.slotT[1]); }

  // CPU twin of the vertex shader, for picking, labels and look angles.
  posAt(i, t, out) {
    const t0 = this.slotT[0], t1 = this.slotT[1], D = t1 - t0;
    let s = Math.abs(D) < 1e-6 ? 0 : (t - t0) / D; s = Math.min(1.35, Math.max(-0.25, s));
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = (s3 - 2 * s2 + s) * D, h01 = -2 * s3 + 3 * s2, h11 = (s3 - s2) * D;
    const a = this.slots[0], b = this.slots[1], o = i * 6;
    out.x = h00 * a[o] + h10 * a[o + 3] + h01 * b[o] + h11 * b[o + 3];
    out.y = h00 * a[o + 1] + h10 * a[o + 4] + h01 * b[o + 1] + h11 * b[o + 4];
    out.z = h00 * a[o + 2] + h10 * a[o + 5] + h01 * b[o + 2] + h11 * b[o + 5];
    return out;
  }
  velAt(i, out) { // latest snapshot's velocity is plenty for a readout
    const k = this.slotT[0] >= this.slotT[1] ? 0 : 1; const a = this.slots[k], o = i * 6;
    out.x = a[o + 3]; out.y = a[o + 4]; out.z = a[o + 5]; return out;
  }

  setColors(fn) { // fn(i) -> [r,g,b,vis]
    for (let i = 0; i < this.n; i++) { const c = fn(i); const o = i * 4; this.color[o] = c[0]; this.color[o + 1] = c[1]; this.color[o + 2] = c[2]; this.color[o + 3] = c[3]; }
    this.colorAttr.needsUpdate = true;
  }
}
