/* Wreckage.

   Chunks inherit the dead ship's velocity plus a radial kick, tumble on a
   fixed axis (nothing damps them out here), and cool from white-hot torn metal
   to cold grey over a few seconds while shedding sparks. They persist for the
   best part of a minute so a long engagement leaves a field of hulks drifting
   through it rather than a clean board.

   One geometry, one draw call, hard cap with oldest-first eviction. Shape
   variety comes from per-instance non-uniform scale — a shard stretched 3:1 on
   one axis reads as a hull section, not a rock. */

import * as THREE from '../../vendor/three/build/three.module.js';

const D_STRIDE = 16;
/* 0..2 pos | 3..6 quat | 7..9 scale | 10..12 rgb | 13 birth | 14 seed | 15 heat */

const QROT = /* glsl */ `
vec3 qrot( vec4 q, vec3 v ) {
  return v + 2.0 * cross( q.xyz, cross( q.xyz, v ) + q.w * v );
}
`;

const DEBRIS_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${QROT}

attribute vec3 iPos;
attribute vec4 iQuat;
attribute vec3 iScale;
attribute vec3 iColor;
attribute float iBirth;
attribute float iSeed;
attribute float iHeat;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vColor;
varying float vHeat;
varying float vSeed;
varying vec3 vLocal;

void main() {
  vec3 local = position * iScale;
  vec3 wp = qrot( iQuat, local ) + iPos;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );

  vNormal = normalize( qrot( iQuat, normalize( normal / max( iScale, vec3( 0.001 ) ) ) ) );
  vWorld = wp;
  vColor = iColor;
  vHeat = iHeat;
  vSeed = iSeed;
  vLocal = position;
  #include <logdepthbuf_vertex>
}
`;

const DEBRIS_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uFill;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vColor;
varying float vHeat;
varying float vSeed;
varying vec3 vLocal;

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize( vNormal );
  vec3 viewDir = normalize( cameraPosition - vWorld );

  /* One key light, hard terminator, cold bounce for the shadow side (§3.2).
     Nothing here writes to the glow layer: hulls do not bloom. */
  float ndl = max( dot( n, uKeyDir ), 0.0 );
  float wrap = max( dot( n, -uKeyDir ), 0.0 );
  vec3 col = vColor * ( uKeyColor * ( 0.045 + 0.95 * ndl ) + uFill * ( 0.16 + 0.30 * wrap ) );

  // Torn edges glow longest: grazing angles keep the heat.
  float edge = pow( 1.0 - abs( dot( n, viewDir ) ), 2.2 );
  float seam = smoothstep( 0.55, 0.95, fract( length( vLocal ) * 5.3 + vSeed * 4.0 ) );
  float glow = vHeat * ( 0.16 + edge * 1.5 + seam * 0.45 * vHeat );
  vec3 hot = mix( vec3( 1.0, 0.30, 0.05 ), vec3( 1.0, 0.93, 0.78 ), vHeat );
  col += hot * glow;

  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const DEBRIS_ATTRS = [
  { name: 'iPos', size: 3, offset: 0 },
  { name: 'iQuat', size: 4, offset: 3 },
  { name: 'iScale', size: 3, offset: 7 },
  { name: 'iColor', size: 3, offset: 10 },
  { name: 'iBirth', size: 1, offset: 13 },
  { name: 'iSeed', size: 1, offset: 14 },
  { name: 'iHeat', size: 1, offset: 15 },
];

/** Irregular shard: an icosahedron with direction-hashed radii, flat shaded. */
function shardGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.getAttribute('position');
  const hash = (x, y, z) => {
    let h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791);
    h = Math.imul(h ^ (h >>> 15), 0x2545f491);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    // Quantise first so shared corners get identical radii and stay welded.
    const r = 0.48 + 0.80 * hash(Math.round(v.x * 64), Math.round(v.y * 64), Math.round(v.z * 64));
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

const SPARK = new THREE.Color(0xffb070);

export class DebrisFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.drawCalls = 1;

    this._geo = shardGeometry();
    this.batch = ctx.instanceBatch({
      name: 'debris',
      base: this._geo,
      attributes: DEBRIS_ATTRS,
      stride: D_STRIDE,
      capacity: ctx.budget.debris,
      vertexShader: DEBRIS_VERT,
      fragmentShader: DEBRIS_FRAG,
      uniforms: {
        uKeyDir: { value: ctx.keyLight.dir.clone() },
        uKeyColor: { value: ctx.keyLight.colour.clone() },
        uFill: { value: ctx.fillLight.clone() },
      },
      blending: THREE.NormalBlending,
      layer: ctx.layer.DEFAULT,
      transparent: false,
      depthWrite: true,
      side: THREE.FrontSide,
      renderOrder: 1,
    });

    this._chunks = [];
    this._q = new THREE.Quaternion();
    this._axis = new THREE.Vector3();
    this._col = new THREE.Color();
  }

  get count() { return this._chunks.length; }

  onKeyLight() {
    const u = this.batch.material.uniforms;
    u.uKeyDir.value.copy(this.ctx.keyLight.dir);
    u.uKeyColor.value.copy(this.ctx.keyLight.colour);
    u.uFill.value.copy(this.ctx.fillLight);
  }

  /** Hand-off from `explosions.js`. All lengths in metres. */
  burst(opts) {
    const ctx = this.ctx;
    const rng = opts.rng || ctx.rng;
    const cap = this.batch.capacity;
    const origin = opts.origin;
    const inherit = opts.velocity;
    const count = Math.max(1, Math.round(opts.count));
    const size = Math.max(0.4, opts.size || 2);
    const spread = opts.spread || size * 4;
    const speed = opts.speed || 30;
    this._col.copy(opts.colour || ctx.teamColors[0].primary).multiplyScalar(0.55);

    for (let i = 0; i < count; i++) {
      if (this._chunks.length >= cap) this._chunks.shift();
      const p = rng.ballPoint(spread);
      const dirLen = Math.max(1e-4, Math.hypot(p.x, p.y, p.z));
      const kick = speed * rng.range(0.25, 1.0);
      const jitter = speed * 0.22;

      // Long thin sections read as hull plating; keep one axis dominant.
      const s = size * rng.range(0.55, 1.9);
      const stretch = rng.range(1.4, 3.4);
      const axis = rng.int(0, 2);
      const sx = s * (axis === 0 ? stretch : rng.range(0.55, 1.0));
      const sy = s * (axis === 1 ? stretch : rng.range(0.55, 1.0));
      const sz = s * (axis === 2 ? stretch : rng.range(0.55, 1.0));

      const spinAxis = rng.unitVector();
      const life = rng.range(24, 44);

      this._chunks.push({
        px: origin.x + p.x,
        py: origin.y + p.y,
        pz: origin.z + p.z,
        vx: (inherit ? inherit.x : 0) + (p.x / dirLen) * kick + rng.gaussian(0, jitter),
        vy: (inherit ? inherit.y : 0) + (p.y / dirLen) * kick + rng.gaussian(0, jitter),
        vz: (inherit ? inherit.z : 0) + (p.z / dirLen) * kick + rng.gaussian(0, jitter),
        quat: new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(spinAxis.x, spinAxis.y, spinAxis.z), rng.range(0, Math.PI * 2),
        ),
        ax: spinAxis.x, ay: spinAxis.y, az: spinAxis.z,
        spin: rng.range(0.25, 2.4) * (3.5 / Math.max(1.2, s)),
        sx, sy, sz,
        r: this._col.r, g: this._col.g, b: this._col.b,
        birth: ctx.now,
        life,
        seed: rng.next(),
        heat: 1,
        nextSpark: ctx.now + rng.range(0, 0.4),
      });
    }
  }

  update(dt, camera) {
    const ctx = this.ctx;
    const now = ctx.now;
    const d = this.batch.data;
    const cap = this.batch.capacity;
    const f = ctx.fields;
    const rng = ctx.rng;
    const q = this._q;
    const axis = this._axis;
    // Cap the spark spend so a field of 600 hot chunks cannot starve weapons.
    let emit = Math.round(24 * ctx.qscale);
    let n = 0;

    for (let i = this._chunks.length - 1; i >= 0; i--) {
      const c = this._chunks[i];
      const age = now - c.birth;
      if (age >= c.life) {
        this._chunks.splice(i, 1);
        continue;
      }

      c.px += c.vx * dt;
      c.py += c.vy * dt;
      c.pz += c.vz * dt;
      q.setFromAxisAngle(axis.set(c.ax, c.ay, c.az), c.spin * dt);
      c.quat.premultiply(q);
      c.heat = Math.exp(-age / 3.2);

      if (c.heat > 0.34 && emit > 0 && now >= c.nextSpark) {
        c.nextSpark = now + rng.range(0.25, 0.9);
        emit--;
        const u = rng.unitVector();
        const s = rng.range(2, 14);
        f.spark.spawn(c.px, c.py, c.pz,
          c.vx + u.x * s, c.vy + u.y * s, c.vz + u.z * s,
          rng.range(0.4, 1.1), 1.2, Math.max(0.5, c.sx * 0.22), 0.15,
          SPARK, 2.0, rng.range(2, 6), 0);
        if (rng.chance(0.3)) {
          f.ember.spawn(c.px, c.py, c.pz, c.vx, c.vy, c.vz,
            rng.range(1.5, 3.5), 0.4, c.sx * 0.5, c.sx * 0.1, SPARK, 1.4, 0, 0);
        }
      }

      if (n >= cap) continue;
      // Shrink out over the last couple of seconds: no alpha, no sorting.
      const k = age > c.life - 2.2 ? Math.max(0, (c.life - age) / 2.2) : 1;
      const o = n * D_STRIDE;
      d[o] = c.px; d[o + 1] = c.py; d[o + 2] = c.pz;
      d[o + 3] = c.quat.x; d[o + 4] = c.quat.y; d[o + 5] = c.quat.z; d[o + 6] = c.quat.w;
      d[o + 7] = c.sx * k; d[o + 8] = c.sy * k; d[o + 9] = c.sz * k;
      d[o + 10] = c.r; d[o + 11] = c.g; d[o + 12] = c.b;
      d[o + 13] = c.birth;
      d[o + 14] = c.seed;
      d[o + 15] = c.heat;
      n++;
    }

    this.batch.flush(n);
  }

  clear() {
    this._chunks.length = 0;
    this.batch.flush(0);
  }

  dispose() {
    this.batch.dispose();
    this._geo.dispose();
    this._chunks.length = 0;
  }
}
