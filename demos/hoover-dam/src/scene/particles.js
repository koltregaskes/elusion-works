// CPU particle pool for spray, foam, splashes and flow tracers.
import * as THREE from 'three';
import { softDot } from './textures.js';

const vert = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying float vAlpha; varying vec3 vColor;
void main(){
  vAlpha = aAlpha; vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (900.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const frag = `
uniform sampler2D uTex; varying float vAlpha; varying vec3 vColor;
void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vColor, t.a * vAlpha); if (gl_FragColor.a < 0.01) discard; }`;

export class Particles {
  constructor(max = 9000, additive = false) {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ttl = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.floorY = new Float32Array(max);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: { uTex: { value: softDot() } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(x, y, z, vx, vy, vz, o = {}) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.ttl[i] = o.life ?? 2; this.life[i] = this.ttl[i];
    this.size0[i] = o.size ?? 3;
    this.drag[i] = o.drag ?? 0.6;
    this.grav[i] = o.grav ?? 9.8;
    this.floorY[i] = o.floor ?? -1e9;
    const c = o.color || [0.95, 0.97, 1];
    this.color[i * 3] = c[0]; this.color[i * 3 + 1] = c[1]; this.color[i * 3 + 2] = c[2];
    this.alpha[i] = o.alpha ?? 0.7;
  }

  update(dt) {
    const { p, vel } = this;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      vel[i * 3] *= k; vel[i * 3 + 2] *= k; vel[i * 3 + 1] = vel[i * 3 + 1] * k - this.grav[i] * dt;
      p[i * 3] += vel[i * 3] * dt; p[i * 3 + 1] += vel[i * 3 + 1] * dt; p[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (p[i * 3 + 1] < this.floorY[i]) { p[i * 3 + 1] = this.floorY[i]; vel[i * 3 + 1] = 0; vel[i * 3] *= 0.5; vel[i * 3 + 2] *= 0.5; }
      const t = this.life[i] / this.ttl[i];
      this.size[i] = this.size0[i] * (1.6 - t * 0.6);
      this.alpha[i] = Math.min(1, t * 2.2) * 0.75;
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = a.aColor.needsUpdate = true;
  }
}

// Tracers that ride along curves (penstocks, tunnels) in x-ray view.
export class Tracers {
  constructor(curves, perCurve, color, size) {
    this.curves = curves;
    this.n = curves.length * perCurve;
    this.per = perCurve;
    this.t = new Float32Array(this.n).map(() => Math.random());
    this.speed = new Float32Array(curves.length);
    const pos = new Float32Array(this.n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, map: softDot(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.tmp = new THREE.Vector3();
  }
  update(dt) {
    const pos = this.geo.attributes.position.array;
    for (let c = 0; c < this.curves.length; c++) {
      const sp = this.speed[c];
      for (let k = 0; k < this.per; k++) {
        const i = c * this.per + k;
        if (sp <= 0.0001) { pos[i * 3 + 1] = -9999; continue; }
        this.t[i] = (this.t[i] + dt * sp) % 1;
        this.curves[c].getPointAt(this.t[i], this.tmp);
        pos[i * 3] = this.tmp.x; pos[i * 3 + 1] = this.tmp.y; pos[i * 3 + 2] = this.tmp.z;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
