/* Shield impacts.

   There is never a visible bubble and there is no lattice. The shield only
   exists in the instant it is hit: a soft hot point under the impact and one
   ripple running a short way out from it, local to the hit in metres and gone
   inside about a third of a second. */

import * as THREE from '../../vendor/three/build/three.module.js';

const S_STRIDE = 16;
/* 0..2 centre | 3 radius | 4..6 hitDir | 7..8 start,life | 9..11 rgb
   12 strength | 13 seed | 14 waveSpan | 15 pad */

const SHIELD_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 iCenter;
attribute float iRadius;
attribute vec3 iHit;
attribute vec2 iTime;
attribute vec3 iColor;
attribute float iStrength;
attribute float iSeed;
attribute float iSpan;

uniform float uTime;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vHit;
varying vec3 vColor;
varying float vAge;
varying float vStrength;
varying float vSeed;
varying float vSpan;
varying float vFragW;
varying float vFlick;

void main() {
  float age = clamp( ( uTime - iTime.x ) / max( iTime.y, 0.0001 ), 0.0, 1.0 );
  float alive = step( 0.0, uTime - iTime.x ) * step( age, 0.9999 );

  vec3 n = normalize( position );
  vec3 wp = iCenter + n * iRadius * alive;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );

  vNormal = n;
  vWorld = wp;
  vHit = normalize( iHit );
  vColor = iColor;
  vAge = age;
  vStrength = iStrength * alive;
  vSeed = iSeed;
  vSpan = iSpan;
  vFragW = gl_Position.w;
  // Per-hit shimmer, two incommensurate rates, so the cap breathes as it fades.
  vFlick = 0.72 + 0.28 * sin( uTime * 47.0 + iSeed * 91.0 ) * sin( uTime * 19.0 + iSeed * 37.0 );
  #include <logdepthbuf_vertex>
}
`;

const SHIELD_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vHit;
varying vec3 vColor;
varying float vAge;
varying float vStrength;
varying float vSeed;
varying float vSpan;
varying float vFragW;
varying float vFlick;

/* Round 6 fix 4: no lattice. The hex-cell shader this replaced was still the
   thing drawing a 600 px tiled bubble over half a capital, because its 50
   degree window was an ANGLE on a sphere the size of the whole hull - on a
   cruiser that is a patch most of a hull long. vSpan is now the patch's
   angular radius, worked out on the CPU from a size in metres, so the ripple
   is local in the world and not in the sphere's own terms. Inside it: a soft
   hot point and one ripple running out to the patch edge, both gone inside a
   third of a second. */
void main() {
  #include <logdepthbuf_fragment>
  if ( vStrength <= 0.0 ) discard;

  vec3 n = normalize( vNormal );
  float ang = acos( clamp( dot( n, vHit ), -1.0, 1.0 ) );
  float x = ang / max( vSpan, 1e-3 );
  float local = 1.0 - smoothstep( 0.55, 1.0, x );
  if ( local <= 0.0 ) discard;

  vec3 viewDir = normalize( cameraPosition - vWorld );
  float fres = pow( 1.0 - abs( dot( n, viewDir ) ), 2.0 );

  float fade = 1.0 - vAge;
  float front = 0.85 * ( 1.0 - pow( fade, 1.8 ) );
  float dr = ( x - front ) / 0.17;
  float ripple = exp( -dr * dr ) * fade;
  float hot = exp( -( x * x ) / 0.06 ) * pow( fade, 2.4 );

  float a = ( ripple * 0.36 * mix( 0.7, 1.0, fres ) + hot * 0.55 ) * local * vFlick * vStrength;
  a *= fxSoftFade( vFragW );
  if ( a <= 0.004 ) discard;

  // Held near the glow cut so the patch tints the hull rather than blooming
  // into a white ball of its own.
  vec3 col = mix( vColor, vec3( 1.0 ), clamp( hot * 0.30, 0.0, 1.0 ) );
  gl_FragColor = vec4( col * ( 0.6 + 0.5 * hot ) * uGain, clamp( a, 0.0, 1.0 ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SHIELD_ATTRS = [
  { name: 'iCenter', size: 3, offset: 0 },
  { name: 'iRadius', size: 1, offset: 3 },
  { name: 'iHit', size: 3, offset: 4 },
  { name: 'iTime', size: 2, offset: 7 },
  { name: 'iColor', size: 3, offset: 9 },
  { name: 'iStrength', size: 1, offset: 12 },
  { name: 'iSeed', size: 1, offset: 13 },
  { name: 'iSpan', size: 1, offset: 14 },
];

const WHITE = new THREE.Color(0xffffff);

/* Concurrent excitations allowed on one hull.

   A capital under sustained fire raises a `sim:damage` every few frames, and
   these instances blend additively over the same sphere: eight of them at once
   stop being a lattice lighting under an impact and become exactly the glowing
   bubble this effect exists to avoid — fresnel rim and all. Three is enough to
   read as several hits at once and not enough to saturate. */
const MAX_PER_ENTITY = 3;

export class ShieldFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.drawCalls = 1;

    /* Detail 4 (5120 faces), up from 2: at detail 2 the silhouette and the
       interpolated normals of a cruiser-sized bubble showed the facets. */
    this._sphere = new THREE.IcosahedronGeometry(1, ctx.quality === 'low' ? 3 : 4);
    this.batch = ctx.instanceBatch({
      name: 'shields',
      base: this._sphere,
      attributes: SHIELD_ATTRS,
      stride: S_STRIDE,
      capacity: ctx.budget.shields,
      vertexShader: SHIELD_VERT,
      fragmentShader: SHIELD_FRAG,
      side: THREE.FrontSide,
      renderOrder: 18,
      softness: 30,
      nearFade: 30,
    });

    this._hits = [];
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qi = new THREE.Quaternion();
    this._col = new THREE.Color();
  }

  get count() { return this._hits.length; }

  impact(p) {
    const ctx = this.ctx;
    const e = p.entity;
    if (!e) return;

    const centre = this._entityPos(e, this._v);
    const radius = (e.radius || (e.def && e.def.length ? e.def.length * 0.45 : 20)) * 1.12;

    const dir = new THREE.Vector3();
    if (p.point) dir.copy(p.point).sub(centre);
    if (dir.lengthSq() < 1e-6 && p.normal) dir.copy(p.normal).negate();
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();

    const quat = this._entityQuat(e, this._q);
    const local = dir.clone().applyQuaternion(this._qi.copy(quat).invert());

    if (this._hits.length >= this.batch.capacity) this._hits.shift();

    // Recycle this hull's oldest excitation rather than laying another one over
    // the top of it (see MAX_PER_ENTITY).
    let mine = 0;
    for (let i = 0; i < this._hits.length; i++) if (this._hits[i].entity === e) mine++;
    while (mine >= MAX_PER_ENTITY) {
      for (let i = 0; i < this._hits.length; i++) {
        if (this._hits[i].entity === e) {
          this._hits.splice(i, 1);
          break;
        }
      }
      mine--;
    }

    const amount = Math.max(1, p.amount || 10);
    const team = ctx.teamColour(e.team || 0);
    this._col.copy(team.trim).lerp(team.light, 0.35);
    // Ripple radius in metres: about a tenth of the bounding radius on a
    // capital, a third on a strike craft, never wider than 0.35 rad.
    const patchM = Math.min(radius * 0.35, Math.max(radius * 0.10, 8 + Math.sqrt(amount) * 1.6));

    this._hits.push({
      entity: e,
      local,
      dir: dir.clone(),
      centre: centre.clone(),
      radius,
      start: ctx.now,
      life: 0.24 + Math.min(0.12, amount * 0.0008),
      strength: Math.min(1.7, 0.5 + Math.sqrt(amount) * 0.075),
      seed: ctx.rng.next(),
      /* Angular radius of the ripple patch. Sized in metres first, then
         turned into an angle on this hull's sphere: a fixed angle is a patch
         most of a hull long on a capital (round 5's 600 px bubble). */
      span: patchM / radius,
      colour: this._col.clone(),
    });

    /* A shield hit still throws light and a little debris of its own — the
       energy has to go somewhere. */
    const f = ctx.fields;
    const px = centre.x + dir.x * radius;
    const py = centre.y + dir.y * radius;
    const pz = centre.z + dir.z * radius;
    const mag = Math.min(5.5, 1.0 + Math.sqrt(amount) * 0.24);
    /* Held inside the ripple patch and under the 8 px hit ceiling past focus
       (round 6 fix 4): at mag * 22 m the tinted flare alone was a 120 m disc. */
    const dCam = ctx.distTo(px, py, pz);
    const kf = Math.max(1, 900 / dCam);
    const fc = Math.min(patchM, ctx.px(dCam) * 8 * kf * kf);
    f.flare.spawn(px, py, pz, 0, 0, 0, 0.14, 0, Math.min(mag * 13, fc * 0.6), Math.min(mag * 3, fc * 0.3), WHITE, 4.6, 0, 0);
    f.flare.spawn(px, py, pz, 0, 0, 0, 0.32, 0, Math.min(mag * 5, fc * 0.5), Math.min(mag * 22, fc), this._col, 2.4, 0, 0);

    const rng = ctx.rng;
    const n = Math.round((7 + mag * 3) * ctx.qscale);
    for (let i = 0; i < n; i++) {
      // Skid the sparks along the shield surface rather than out of it.
      const u = rng.unitVector();
      const dot = u.x * dir.x + u.y * dir.y + u.z * dir.z;
      const tx = u.x - dot * dir.x;
      const ty = u.y - dot * dir.y;
      const tz = u.z - dot * dir.z;
      const s = (40 + amount * 0.6) * rng.range(0.5, 1.5);
      f.spark.spawn(px, py, pz,
        tx * s + dir.x * s * 0.25, ty * s + dir.y * s * 0.25, tz * s + dir.z * s * 0.25,
        rng.range(0.16, 0.45), 3.6, mag * 1.1, 0.2, this._col, 2.4, rng.range(3, 8), 0);
    }
  }

  cancel(entity) {
    for (let i = this._hits.length - 1; i >= 0; i--) {
      if (this._hits[i].entity === entity) this._hits[i].entity = null;
    }
  }

  _entityPos(e, out) {
    const o = e.object3D ? e.object3D.position : e.position;
    return o ? out.copy(o) : out.set(0, 0, 0);
  }

  _entityQuat(e, out) {
    const q = e.object3D ? e.object3D.quaternion : e.quaternion;
    return q ? out.copy(q) : out.identity();
  }

  update(dt, camera) {
    const now = this.ctx.now;
    const d = this.batch.data;
    let n = 0;
    for (let i = this._hits.length - 1; i >= 0; i--) {
      if (now > this._hits[i].start + this._hits[i].life) this._hits.splice(i, 1);
    }
    for (let i = 0; i < this._hits.length && n < this.batch.capacity; i++) {
      const h = this._hits[i];
      if (h.entity && h.entity.alive !== false) {
        this._entityPos(h.entity, h.centre);
        this._entityQuat(h.entity, this._q);
        h.dir.copy(h.local).applyQuaternion(this._q);
      }
      const o = n * S_STRIDE;
      d[o] = h.centre.x; d[o + 1] = h.centre.y; d[o + 2] = h.centre.z;
      d[o + 3] = h.radius;
      d[o + 4] = h.dir.x; d[o + 5] = h.dir.y; d[o + 6] = h.dir.z;
      d[o + 7] = h.start; d[o + 8] = h.life;
      d[o + 9] = h.colour.r; d[o + 10] = h.colour.g; d[o + 11] = h.colour.b;
      d[o + 12] = h.strength;
      d[o + 13] = h.seed;
      d[o + 14] = h.span;
      d[o + 15] = 0;
      n++;
    }
    this.batch.flush(n);
  }

  dispose() {
    this.batch.dispose();
    this._sphere.dispose();
    this._hits.length = 0;
  }
}
