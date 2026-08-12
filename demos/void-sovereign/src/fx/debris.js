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

  /* Torn edges and seams glow; whole faces do not.

     This carried a flat 0.16 * vHeat over the entire surface, in a colour that
     ran to near-white at full heat, at up to 2.0 intensity — which is several
     times the hull albedo underneath it. The result was that every chunk in a
     capital's wreck was washed to the same pale warm tone for the first six
     seconds, whatever it was made of and however big it was: the "pale tan
     gravel" read. Cooling metal is incandescent, so the ramp now runs deep
     red through orange and never reaches white, the full-surface term is gone,
     and the heat curve is squared so the wash falls away rather than lingering. */
  float heat = pow( clamp( vHeat, 0.0, 1.0 ), 1.7 );
  float edge = pow( 1.0 - abs( dot( n, viewDir ) ), 2.6 );
  float seam = smoothstep( 0.62, 0.97, fract( length( vLocal ) * 5.3 + vSeed * 4.0 ) );
  float glow = heat * ( edge * 0.85 + seam * 0.55 * heat );
  vec3 hot = mix( vec3( 0.85, 0.13, 0.02 ), vec3( 1.0, 0.62, 0.24 ), heat );
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
/* Torn structure is not painted. Char, bare alloy and shadowed plate are what
   a hull section actually shows once it is off the ship, and mixing toward
   them per chunk is what stops a wreck field reading as one tin of paint. */
const CHAR = new THREE.Color(0x22201e);
const BARE = new THREE.Color(0x6a6660);

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
    this._col2 = new THREE.Color();
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

    /* Base tone is the hull's own average albedo where MAT can supply it, and
       the team livery only as a fallback. Held well down: wreckage is the
       darkest thing in a death sequence, and it has to stay under the embers
       and the flash or the whole wreck reads as pale gravel lit from nowhere. */
    const hull = opts.hull || opts.colour || ctx.teamColors[0].primary;
    const base = this._col2.copy(hull);

    /* A few large keel sections, then a heavy tail of smaller pieces. A hull
       does not shatter evenly — it breaks along frames, so the eye expects two
       or three recognisable structural spans among the rubble. Without them a
       capital's wreck is a uniform radial spray of identical chunks. */
    const keelCount = Math.max(0, Math.round(opts.keelCount || 0));
    const keelLength = opts.keelLength || 0;

    /* Vent axis from the death sequence. Wreckage leaves a hull along the same
       lobes the gas does — a radially uniform spray of chunks is the giveaway
       that this is an emitter rather than a structure failing. */
    const B = opts.blast || null;

    for (let i = 0; i < count; i++) {
      if (this._chunks.length >= cap) this._chunks.shift();
      const isKeel = i < keelCount && keelLength > 0;
      // Keel sections stay near the wreck's core and travel slowly; they carry
      // the mass, so they must not be flung out with the light debris.
      const p = rng.ballPoint(isKeel ? spread * 0.45 : spread);
      if (B) {
        // Stretch the spawn cloud along the axis: a broken hull is longer than
        // it is wide, and so is the volume its pieces start from.
        const s = rng.next() < 0.5 ? -1 : 1;
        const push = spread * 0.55 * s * rng.range(0.2, 1.0);
        p.x += B.x * push; p.y += B.y * push; p.z += B.z * push;
      }
      const dirLen = Math.max(1e-4, Math.hypot(p.x, p.y, p.z));
      // Pieces heading down a lobe are the ones the blast actually pushed, so
      // they leave faster; the rest tumble away off the sides.
      const align = B ? Math.abs((p.x * B.x + p.y * B.y + p.z * B.z) / dirLen) : 1;
      const lobe = B ? 0.45 + 0.85 * Math.pow(align, 1.5) : 1;
      const kick = speed * lobe * (isKeel ? rng.range(0.08, 0.30) : rng.range(0.25, 1.0));
      const jitter = speed * (isKeel ? 0.06 : 0.22);

      // Long thin sections read as hull plating; keep one axis dominant.
      let sx; let sy; let sz;
      if (isKeel) {
        // Scale is a radius on a roughly unit shard, so half the span.
        const long = keelLength * rng.range(0.62, 1.0) * 0.5;
        const thin = long * rng.range(0.11, 0.22);
        const axis = rng.int(0, 2);
        sx = axis === 0 ? long : thin * rng.range(0.7, 1.4);
        sy = axis === 1 ? long : thin * rng.range(0.7, 1.4);
        sz = axis === 2 ? long : thin * rng.range(0.7, 1.4);
      } else {
        /* Power-law rather than uniform: mostly small, occasionally large.
           A flat rng.range(0.55, 1.9) is why every chunk measured the same. */
        const s = size * (0.25 + 1.9 * Math.pow(rng.next(), 2.6));
        const stretch = rng.range(1.4, 3.4);
        const axis = rng.int(0, 2);
        sx = s * (axis === 0 ? stretch : rng.range(0.45, 1.0));
        sy = s * (axis === 1 ? stretch : rng.range(0.45, 1.0));
        sz = s * (axis === 2 ? stretch : rng.range(0.45, 1.0));
        /* Hold the tail clear of keel scale. Without this the largest ordinary
           fragment reached 60% of hull length and the keel sections had nothing
           to stand out against — the whole point of having them. */
        if (keelLength > 0) {
          /* Scale is a radius, so this caps the ordinary tail at about 11% of
             hull length end to end — comfortably under the 15-25% the keel
             sections occupy, which is what makes them read as structure rather
             than as the top of a continuous size distribution. */
          const lim = keelLength * 0.22;
          const longest = Math.max(sx, sy, sz);
          if (longest > lim) {
            const k = lim / longest;
            sx *= k; sy *= k; sz *= k;
          }
        }
      }

      /* Per-chunk tone. Scorched on one piece, bare alloy on the next, most of
         them simply dark. Biased low so the field sits below the embers. */
      const t = rng.next();
      this._col.copy(base);
      if (t < 0.34) this._col.lerp(CHAR, rng.range(0.35, 0.80));
      else if (t > 0.82) this._col.lerp(BARE, rng.range(0.25, 0.55));
      this._col.multiplyScalar(0.20 + 0.42 * Math.pow(rng.next(), 1.3));

      const spinAxis = rng.unitVector();
      // Big structure tumbles for longer than it burns.
      const life = isKeel ? rng.range(40, 58) : rng.range(24, 44);

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
        // Angular momentum per unit mass: a 300 m keel section rotates slowly,
        // a 4 m fragment cartwheels. Same rule, no special case.
        spin: rng.range(0.25, 2.4) * (3.5 / Math.max(1.2, Math.max(sx, sy, sz))),
        sx, sy, sz,
        r: this._col.r, g: this._col.g, b: this._col.b,
        birth: ctx.now,
        life,
        // Thermal mass: big sections stay hot along their torn edges far longer.
        cool: isKeel ? 9.0 : 3.2,
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
      c.heat = Math.exp(-age / (c.cool || 3.2));

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
