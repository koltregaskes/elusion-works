/* Deaths.

   Three tiers, because a fighter dying and a cruiser dying are not the same
   event and must not read as the same event:

     pop      a fighter is gone inside a fifth of a second — one flash, a spray
              of sparks, four chunks
     break    a frigate comes apart: hit, vent, secondary, then the hull goes
     capital  a staged four-second sequence. Breaches walk the hull, atmosphere
              vents in hard white jets, secondaries chase each other down the
              spine, and only then does the primary go — flash, twin shockwave
              rings, a shower of hull sections and an ember cloud that hangs
              around for ten seconds afterwards.

   Everything is captured at the moment of death (position, heading, velocity)
   because SIM removes the entity immediately; the sequence then plays along
   the dead ship's drift so the wreck keeps its momentum. */

import * as THREE from '../../vendor/three/build/three.module.js';

const RING_STRIDE = 16;
/* 0..2 centre | 3..5 normal | 6..9 start,life,r0,r1 | 10..12 rgb | 13 thickness
   14 intensity | 15 seed */

const RING_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 iCenter;
attribute vec3 iNormal;
attribute vec4 iTime;
attribute vec3 iColor;
attribute float iThick;
attribute float iIntensity;
attribute float iSeed;

uniform float uTime;

varying vec2 vLocal;
varying vec3 vColor;
varying float vEnv;
varying float vThick;
varying float vIntensity;
varying float vSeed;
varying float vFragW;

void main() {
  float age = clamp( ( uTime - iTime.x ) / max( iTime.y, 0.0001 ), 0.0, 1.0 );
  float alive = step( 0.0, uTime - iTime.x ) * step( age, 0.9999 );

  // Fast out of the gate, then coasting — a blast front losing energy.
  float e = 1.0 - pow( 1.0 - age, 2.8 );
  float R = mix( iTime.z, iTime.w, e ) * alive;

  vec3 n = normalize( iNormal );
  vec3 t1 = abs( n.y ) < 0.9 ? normalize( cross( n, vec3( 0.0, 1.0, 0.0 ) ) )
                             : normalize( cross( n, vec3( 1.0, 0.0, 0.0 ) ) );
  vec3 t2 = cross( n, t1 );

  vec3 wp = iCenter + ( t1 * position.x + t2 * position.y ) * ( 2.8 * R );
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );

  vLocal = position.xy * 2.8;
  vColor = iColor;
  vThick = iThick;
  vIntensity = iIntensity;
  vSeed = iSeed;
  vEnv = alive * smoothstep( 0.0, 0.04, age ) * pow( 1.0 - age, 1.5 );
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const RING_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

uniform sampler2D uNoise;
uniform float uTime;

varying vec2 vLocal;
varying vec3 vColor;
varying float vEnv;
varying float vThick;
varying float vIntensity;
varying float vSeed;
varying float vFragW;

void main() {
  #include <logdepthbuf_fragment>
  float r = length( vLocal );
  if ( r > 1.34 ) discard;

  float ang = atan( vLocal.y, vLocal.x );
  // Break the perfect circle: a real front is ragged.
  float wobble = texture2D( uNoise, vec2( ang * 0.1592 + vSeed, vSeed * 3.1 ) ).b;
  float rr = r * ( 1.0 + ( wobble - 0.5 ) * 0.10 );

  float thick = max( vThick, 0.012 );
  /* Asymmetric: a hard leading edge with the energy piled against it and a
     long draining tail behind. A symmetric Gaussian reads as a smoke ring. */
  float d = rr - 1.0;
  float lead = exp( -pow( max( d, 0.0 ) / ( thick * 0.55 ), 2.0 ) );
  float trail = exp( -pow( max( -d, 0.0 ) / ( thick * 2.6 ), 1.35 ) );
  float band = max( lead, trail * 0.72 );
  float lip = exp( -pow( ( rr - 1.02 ) / ( thick * 0.30 ), 2.0 ) );
  float wash = smoothstep( 1.02, 0.35, rr ) * 0.09;

  float a = clamp( band * 0.95 + wash, 0.0, 1.0 ) * vEnv * fxSoftFade( vFragW );
  if ( a <= 0.004 ) discard;

  /* Cheap stand-in for refraction: the leading lip goes cold-blue while the
     body stays hot, which is what a compressed shell actually looks like. */
  vec3 col = mix( vColor, vec3( 0.60, 0.78, 1.0 ), clamp( lip, 0.0, 1.0 ) * 0.7 );
  col *= vIntensity * uGain * ( 0.45 + 4.4 * lip + 1.8 * band );
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const RING_ATTRS = [
  { name: 'iCenter', size: 3, offset: 0 },
  { name: 'iNormal', size: 3, offset: 3 },
  { name: 'iTime', size: 4, offset: 6 },
  { name: 'iColor', size: 3, offset: 10 },
  { name: 'iThick', size: 1, offset: 13 },
  { name: 'iIntensity', size: 1, offset: 14 },
  { name: 'iSeed', size: 1, offset: 15 },
];

function quadGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  return g;
}

const WHITE = new THREE.Color(0xffffff);
const CORE = new THREE.Color(0xfff2d8);
const FIRE = new THREE.Color(0xff9a42);
const EMBER = new THREE.Color(0xff6a1e);
const SOOT = new THREE.Color(0x4d453f);
const VENT = new THREE.Color(0xdfe9f2);

export class ExplosionFX {
  constructor(ctx, debris) {
    this.ctx = ctx;
    this.debris = debris;
    this.drawCalls = 1;

    this._quadGeo = quadGeometry();
    this.rings = ctx.instanceBatch({
      name: 'shockwaves',
      base: this._quadGeo,
      attributes: RING_ATTRS,
      stride: RING_STRIDE,
      capacity: ctx.budget.rings,
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: { uNoise: { value: ctx.noises.fbm } },
      renderOrder: 17,
      softness: 60,
      nearFade: 40,
    });

    this._rings = [];
    this._seqs = [];
    this._jets = [];
    this._lingers = [];
    this._glows = [];

    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._axis = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._col = new THREE.Color();
  }

  get ringCount() { return this._rings.length; }

  get sequenceCount() {
    return this._seqs.length + this._jets.length + this._lingers.length + this._glows.length;
  }

  /* ------------------------------------------------------------------ entry */

  /* Magnitude is keyed to hull mass, and only to hull mass.

     Mass goes as L^3 and a blast front goes as mass^(1/3), so the fireball
     radius is simply proportional to L and the *same* constant is used for a
     14 m interceptor and a 1,900 m mothership. Getting this wrong in either
     direction is what makes a fleet action read badly: a fighter pop that is
     scaled up to be visible ends up a disc bigger than a frigate, and a
     capital death scaled by the same rule as a fighter ends up smaller than
     the ship that just died.

     Visibility is a *separate* concern, handled separately: `minPx` raises an
     effect to a legible number of screen pixels at the camera's current
     distance without touching its world-space magnitude. So a fighter dying at
     4 km still reads, and it still reads as a small thing dying.

     Duration goes as the cube root of length — a big structure takes longer to
     come apart, but not 135 times longer. */
  _magnitude(L) {
    return {
      L,
      R: L * 0.95,                                            // fireball radius
      ring: L * 2.6,                                          // shock front
      T: Math.min(1.75, Math.max(0.4, Math.cbrt(L / 380))),   // timeline stretch
      N: Math.min(3.2, Math.max(0.35, Math.pow(L / 380, 0.55))), // particle mass
    };
  }

  kill(entity, killer) {
    const ctx = this.ctx;
    const def = entity.def || {};
    const radius = entity.radius || (def.length ? def.length * 0.4 : 10);
    const L = def.length || radius * 2.2;

    const o = entity.object3D;
    const pos = new THREE.Vector3().copy(o ? o.position : (entity.position || this._v.set(0, 0, 0)));
    const quat = new THREE.Quaternion().copy(o ? o.quaternion : (entity.quaternion || this._q.identity()));
    const vel = new THREE.Vector3();
    if (entity.velocity) vel.copy(entity.velocity);

    const seq = {
      pos,
      vel,
      axis: new THREE.Vector3(0, 0, 1).applyQuaternion(quat),
      side: new THREE.Vector3(1, 0, 0).applyQuaternion(quat),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(quat),
      L,
      radius,
      m: this._magnitude(L),
      t0: ctx.now,
      i: 0,
      rng: ctx.rng.fork((entity.id || 1) * 7919),
      team: ctx.teamColour(entity.team || 0),
      events: null,
    };

    if (L < 45) seq.events = this._scriptPop(seq);
    else if (L < 210) seq.events = this._scriptBreak(seq);
    else seq.events = this._scriptCapital(seq);

    // One place stretches the whole timeline by hull size.
    const T = seq.m.T;
    if (T !== 1) for (const e of seq.events) e.t *= T;

    this._seqs.push(seq);
  }

  /* --------------------------------------------------------------- scripts */

  /* A fighter is gone inside a fifth of a second: one flash, a spray, four
     chunks. `minPx` keeps it on screen at strategic range without inflating it
     into something that looks like a frigate dying. */
  _scriptPop(seq) {
    const { L, R, ring, N } = seq.m;
    return [
      { t: 0.00, k: 'flash', size: R * 2.4, minPx: 13, life: 0.22, bright: 11.0 },
      { t: 0.00, k: 'sparks', n: 44 * N, speed: L * 16, size: L * 0.13, minPx: 2.6 },
      { t: 0.00, k: 'ring', r0: R * 0.3, r1: ring, life: 0.46, thick: 0.11, intensity: 2.4 },
      { t: 0.00, k: 'smoke', n: 3, size: R * 2.4, speed: L * 2.2, life: 1.4 },
      { t: 0.02, k: 'debris', n: 5, scale: 0.30, speed: L * 4.5 },
      { t: 0.03, k: 'embers', n: 22 * N, speed: L * 3.5, life: 1.8 },
    ];
  }

  /* A frigate comes apart: hit, vent, two secondaries, then the hull goes. */
  _scriptBreak(seq) {
    const { L, R, ring, N } = seq.m;
    return [
      { t: 0.00, k: 'flash', size: R * 0.9, minPx: 20, life: 0.24, bright: 7.0 },
      { t: 0.00, k: 'sparks', n: 48 * N, speed: L * 5.0, size: L * 0.045, minPx: 2.4 },
      { t: 0.00, k: 'vent', n: 2, duration: 1.5, speed: L * 3.2 },
      { t: 0.00, k: 'smoke', n: 5, size: L * 0.8, speed: L * 1.0, life: 2.4 },
      { t: 0.22, k: 'secondary', at: -0.25, size: R * 0.42 },
      { t: 0.46, k: 'secondary', at: 0.30, size: R * 0.52 },
      { t: 0.50, k: 'debris', n: 6, scale: 0.22, speed: L * 1.4 },
      { t: 0.62, k: 'vent', n: 1, duration: 1.1, speed: L * 2.6 },
      { t: 0.70, k: 'hullglow', duration: 0.30, size: L, bright: 3.2 },
      { t: 0.84, k: 'flash', size: R * 1.9, minPx: 52, life: 0.42, bright: 15.0 },
      { t: 0.84, k: 'ring', r0: R * 0.3, r1: ring * 1.15, life: 0.9, thick: 0.075, intensity: 3.4 },
      { t: 0.84, k: 'sparks', n: 100 * N, speed: L * 7.0, size: L * 0.06, minPx: 2.6 },
      { t: 0.86, k: 'debris', n: 18, scale: 0.5, speed: L * 1.9 },
      { t: 0.86, k: 'embers', n: 70 * N, speed: L * 2.2, life: 3.6 },
      { t: 0.88, k: 'smoke', n: 14, size: L * 1.6, speed: L * 1.4, life: 4.0 },
      { t: 1.06, k: 'ring', r0: R * 0.8, r1: ring * 1.6, life: 1.6, thick: 0.05, intensity: 1.6 },
      { t: 0.90, k: 'linger', duration: 5.0, rate: 11, size: L * 0.5 },
    ];
  }

  _scriptCapital(seq) {
    const { L, R, ring, N } = seq.m;
    const rng = seq.rng;
    const ev = [];

    /* Act one: the hull starts failing. Small, contained, walking along the
       spine so the eye follows it. */
    ev.push({ t: 0.00, k: 'secondary', at: rng.range(-0.5, 0.1), size: R * 0.14 });
    ev.push({ t: 0.00, k: 'vent', n: 4, duration: 3.2, speed: L * 1.1 });
    ev.push({ t: 0.00, k: 'smoke', n: 6, size: L * 0.16, speed: L * 0.30, life: 4.5 });

    const beats = 12 + Math.round(rng.range(0, 4));
    for (let i = 0; i < beats; i++) {
      const t = 0.22 + (i / beats) * 2.35 + rng.range(-0.05, 0.05);
      ev.push({
        t,
        k: 'secondary',
        at: rng.range(-0.62, 0.62),
        size: R * (0.12 + 0.16 * (i / beats)),
        minPx: 14,
      });
      if (i % 3 === 1) ev.push({ t: t + 0.02, k: 'vent', n: 1, duration: 2.4, speed: L * 0.9 });
      if (i % 4 === 2) ev.push({ t: t + 0.04, k: 'debris', n: 3, scale: 0.18, speed: L * 0.35 });
    }

    /* Act two: the ship gives up. The buckle — the hull lights from the inside
       along its whole length, which is the beat that makes the primary land. */
    ev.push({ t: 2.20, k: 'hullglow', duration: 0.95, size: L, bright: 2.2 });
    ev.push({ t: 2.62, k: 'flash', size: R * 0.7, minPx: 34, life: 0.38, bright: 8.0 });
    ev.push({ t: 2.62, k: 'ring', r0: R * 0.2, r1: R * 1.2, life: 0.65, thick: 0.09, intensity: 2.4 });
    ev.push({ t: 2.64, k: 'sparks', n: 120 * N, speed: L * 1.6, size: L * 0.018, minPx: 2.6 });
    ev.push({ t: 2.66, k: 'hullglow', duration: 0.36, size: L * 1.05, bright: 5.5 });

    /* Act three: primary detonation. This is the frame that has to stop you.

       The flash is sized to bloom, not to cover. A billboard wide enough to
       fill the frame just greys the image out and drags auto-exposure down
       with it; a smaller, far hotter one blooms into the same area and keeps
       the nebula behind it. */
    ev.push({ t: 2.98, k: 'flash', size: R * 1.7, minPx: 150, life: 0.60, bright: 30.0 });
    ev.push({ t: 2.98, k: 'flash', size: R * 0.9, minPx: 80, life: 1.7, bright: 9.0, colour: FIRE });
    ev.push({ t: 3.00, k: 'flash', size: R * 2.7, minPx: 210, life: 0.26, bright: 3.0, colour: CORE });
    ev.push({ t: 2.98, k: 'ring', r0: R * 0.35, r1: ring * 1.55, life: 1.6, thick: 0.055, intensity: 4.6, axis: 'hull' });
    ev.push({ t: 3.02, k: 'ring', r0: R * 0.25, r1: ring * 1.05, life: 2.0, thick: 0.075, intensity: 3.2, axis: 'perp' });
    ev.push({ t: 2.99, k: 'sparks', n: 280 * N, speed: L * 3.4, size: L * 0.024, minPx: 3.0 });
    ev.push({ t: 3.00, k: 'debris', n: 48, scale: 1.0, speed: L * 0.75 });
    ev.push({ t: 3.02, k: 'embers', n: 240 * N, speed: L * 0.85, life: 8.0 });
    ev.push({ t: 3.04, k: 'smoke', n: 32, size: L * 0.9, speed: L * 0.5, life: 9.0 });
    ev.push({ t: 3.30, k: 'ring', r0: R * 1.1, r1: ring * 2.1, life: 2.8, thick: 0.035, intensity: 1.8 });
    ev.push({ t: 3.10, k: 'linger', duration: 14.0, rate: 20, size: L * 0.35 });

    ev.sort((a, b) => a.t - b.t);
    return ev;
  }

  /* ------------------------------------------------------------- executors */

  _at(seq, t, out) {
    return out.copy(seq.pos).addScaledVector(seq.vel, t);
  }

  _run(seq, ev) {
    const ctx = this.ctx;
    const rng = seq.rng;
    const f = ctx.fields;
    const q = ctx.qscale;
    const origin = this._at(seq, ev.t, this._v2);
    // World magnitude is fixed by hull mass; this only lifts it to a legible
    // number of screen pixels for the camera we actually have right now.
    const dist = ctx.distTo(origin.x, origin.y, origin.z);
    const px = (metres, minPx) => (minPx ? ctx.atLeast(metres, dist, minPx) : metres);

    switch (ev.k) {
      case 'flash': {
        const col = ev.colour || CORE;
        const V = seq.vel;
        const size = px(ev.size, ev.minPx);
        f.flare.spawn(origin.x, origin.y, origin.z, V.x, V.y, V.z, ev.life, 0,
          size * 0.35, size, col, ev.bright, 0, 0);
        f.flare.spawn(origin.x, origin.y, origin.z, V.x, V.y, V.z, ev.life * 0.45, 0,
          size * 0.55, size * 0.18, WHITE, ev.bright * 1.4, 0, 0);
        break;
      }

      case 'secondary': {
        this._v.copy(origin).addScaledVector(seq.axis, ev.at * seq.L * 0.5);
        this._v.addScaledVector(seq.side, rng.gaussian(0, seq.L * 0.06));
        this._v.addScaledVector(seq.up, rng.gaussian(0, seq.L * 0.05));
        const V = seq.vel;
        const size = px(ev.size, ev.minPx);
        f.flare.spawn(this._v.x, this._v.y, this._v.z, V.x, V.y, V.z, 0.22, 0,
          size * 0.4, size * 1.8, CORE, 7.0, 0, 0);
        f.flare.spawn(this._v.x, this._v.y, this._v.z, V.x, V.y, V.z, 0.5, 0,
          size * 0.5, size * 2.8, FIRE, 3.0, 0, 0);
        const n = Math.round(22 * q);
        for (let i = 0; i < n; i++) {
          const u = rng.unitVector();
          const s = ev.size * rng.range(3, 12);
          f.spark.spawn(this._v.x, this._v.y, this._v.z,
            V.x + u.x * s, V.y + u.y * s, V.z + u.z * s,
            rng.range(0.3, 0.9), 0.3, ev.size * 0.08, 0.2, CORE, 2.8, rng.range(3, 9), 0);
        }
        for (let i = 0; i < Math.round(3 * q) + 1; i++) {
          const u = rng.unitVector();
          const s = ev.size * rng.range(0.8, 2.4);
          f.smoke.spawn(this._v.x, this._v.y, this._v.z,
            V.x + u.x * s, V.y + u.y * s, V.z + u.z * s,
            rng.range(2.0, 3.6), 0.09, ev.size * 0.5, ev.size * 3.0, SOOT, 0.9, 0, rng.gaussian(0, 0.9));
        }
        break;
      }

      case 'ring': {
        const nrm = this._side;
        if (ev.axis === 'hull') nrm.copy(seq.axis);
        else if (ev.axis === 'perp') nrm.copy(seq.up);
        else {
          const u = rng.unitVector();
          nrm.set(u.x, u.y, u.z);
        }
        this._addRing(origin, nrm, ev.r0, ev.r1, ev.life, ev.thick, ev.intensity, seq);
        break;
      }

      /* Every ejecta case adds `seq.vel`. In vacuum a cloud keeps the momentum
         of what it came off; without this the wreck sails on and leaves its own
         debris behind like a stationary puff of smoke. Drag is likewise near
         zero — there is nothing to drag against — so the clouds expand
         isotropically and thin out rather than braking to a halt. */
      case 'sparks': {
        const n = Math.round(ev.n * q);
        const V = seq.vel;
        const ss = px(ev.size, ev.minPx);
        for (let i = 0; i < n; i++) {
          const u = rng.unitVector();
          const s = ev.speed * rng.range(0.25, 1.0);
          this._col.copy(CORE).lerp(EMBER, rng.next() * 0.7);
          f.spark.spawn(origin.x, origin.y, origin.z,
            V.x + u.x * s, V.y + u.y * s, V.z + u.z * s,
            rng.range(0.35, 1.5), 0.35, ss * rng.range(0.6, 1.6), 0.2,
            this._col, 2.8, rng.range(3, 10), 0);
        }
        break;
      }

      case 'embers': {
        const n = Math.round(ev.n * q);
        const V = seq.vel;
        for (let i = 0; i < n; i++) {
          const u = rng.ballPoint(1);
          const s = ev.speed * rng.range(0.1, 1.0);
          this._col.copy(FIRE).lerp(EMBER, rng.next());
          f.ember.spawn(origin.x, origin.y, origin.z,
            V.x + u.x * s, V.y + u.y * s, V.z + u.z * s,
            ev.life * rng.range(0.5, 1.4), 0.10,
            seq.L * 0.045, seq.L * 0.010, this._col, 2.4, 0, rng.gaussian(0, 0.6));
        }
        break;
      }

      case 'smoke': {
        const n = Math.round(ev.n * q);
        const V = seq.vel;
        for (let i = 0; i < n; i++) {
          const u = rng.unitVector();
          const s = ev.speed * rng.range(0.2, 1.0);
          f.smoke.spawn(origin.x, origin.y, origin.z,
            V.x + u.x * s, V.y + u.y * s, V.z + u.z * s,
            ev.life * rng.range(0.6, 1.3), 0.06,
            ev.size * 0.35, ev.size * rng.range(1.6, 3.2), SOOT, 0.95, 0, rng.gaussian(0, 0.7));
        }
        break;
      }

      /* The buckle. The hull cannot deform — SIM has already released the
         entity — so the failure is sold with light instead: a stretched
         envelope the length of the ship that lights from inside and pulses,
         with breaches punched through it. */
      case 'hullglow': {
        this._glows.push({
          seq,
          start: ctx.now,
          until: ctx.now + ev.duration,
          size: ev.size,
          bright: ev.bright,
          next: 0,
        });
        break;
      }

      case 'debris': {
        this.debris.burst({
          origin,
          velocity: seq.vel,
          axis: seq.axis,
          count: Math.round(ev.n * Math.min(1.2, q + 0.15)),
          size: seq.L * 0.035 * ev.scale,
          spread: seq.L * 0.30,
          speed: ev.speed,
          colour: seq.team.primary,
          rng,
        });
        break;
      }

      case 'vent': {
        for (let i = 0; i < ev.n; i++) {
          const u = rng.unitVector();
          this._jets.push({
            pos: new THREE.Vector3(origin.x, origin.y, origin.z)
              .addScaledVector(seq.axis, rng.range(-0.45, 0.45) * seq.L)
              .addScaledVector(seq.side, rng.gaussian(0, seq.L * 0.05)),
            dir: new THREE.Vector3(u.x, u.y, u.z),
            vel: seq.vel,
            until: ctx.now + ev.duration,
            speed: ev.speed,
            size: seq.L * 0.05,
            next: 0,
            rng,
          });
        }
        break;
      }

      case 'linger': {
        this._lingers.push({
          pos: new THREE.Vector3(origin.x, origin.y, origin.z),
          vel: seq.vel,
          until: ctx.now + ev.duration,
          rate: ev.rate,
          size: ev.size,
          spread: seq.L * 0.8,
          next: 0,
          rng,
        });
        break;
      }

      default:
        break;
    }
  }

  _addRing(centre, normal, r0, r1, life, thick, intensity, seq) {
    if (this._rings.length >= this.rings.capacity) this._rings.shift();
    this._rings.push({
      cx: centre.x, cy: centre.y, cz: centre.z,
      nx: normal.x, ny: normal.y, nz: normal.z,
      start: this.ctx.now, life, r0, r1, thick, intensity,
      r: 1.0, g: 0.92, b: 0.80,
      seed: seq ? seq.rng.next() : this.ctx.rng.next(),
      vx: seq ? seq.vel.x : 0, vy: seq ? seq.vel.y : 0, vz: seq ? seq.vel.z : 0,
    });
  }

  /* ----------------------------------------------------------------- update */

  update(dt, camera) {
    const ctx = this.ctx;
    const now = ctx.now;

    for (let i = this._seqs.length - 1; i >= 0; i--) {
      const seq = this._seqs[i];
      const rel = now - seq.t0;
      while (seq.i < seq.events.length && seq.events[seq.i].t <= rel) {
        this._run(seq, seq.events[seq.i]);
        seq.i++;
      }
      if (seq.i >= seq.events.length) this._seqs.splice(i, 1);
    }

    this._updateGlows();
    this._updateJets(dt);
    this._updateLingers(dt);
    this._writeRings(now);
  }

  /* The hull lighting up from inside before it lets go. Drawn as a chain of
     flares strung along the ship's axis rather than one billboard, so it keeps
     the silhouette's proportions from any angle. */
  _updateGlows() {
    const ctx = this.ctx;
    const now = ctx.now;
    const f = ctx.fields;
    for (let i = this._glows.length - 1; i >= 0; i--) {
      const g = this._glows[i];
      if (now >= g.until) {
        this._glows.splice(i, 1);
        continue;
      }
      if (now < g.next) continue;
      g.next = now + 0.045;

      const seq = g.seq;
      const rng = seq.rng;
      const span = Math.max(0.0001, g.until - g.start);
      // Ramp hard toward the end: the ship is losing the argument.
      const k = Math.pow((now - g.start) / span, 1.8);
      const beads = 7;
      this._at(seq, now - seq.t0, this._v2);
      for (let j = 0; j < beads; j++) {
        const u = (j / (beads - 1) - 0.5) * 0.92;
        this._v.copy(this._v2).addScaledVector(seq.axis, u * seq.L);
        this._v.addScaledVector(seq.side, rng.gaussian(0, g.size * 0.012));
        const flicker = 0.55 + 0.45 * rng.next();
        const s = g.size * (0.055 + 0.10 * k) * flicker;
        this._col.copy(FIRE).lerp(WHITE, k * 0.7);
        f.flare.spawn(this._v.x, this._v.y, this._v.z, seq.vel.x, seq.vel.y, seq.vel.z,
          0.12, 0, s * 1.6, s * 0.5, this._col, g.bright * (0.4 + k) * flicker, 0, 0);
      }
      // Seams: hot lines cracking open along the spine.
      if (rng.chance(0.7)) {
        const u = rng.range(-0.5, 0.5);
        this._v.copy(this._v2).addScaledVector(seq.axis, u * seq.L);
        const dir = rng.unitVector();
        const s = g.size * (0.5 + 1.4 * k);
        f.spark.spawn(this._v.x, this._v.y, this._v.z,
          seq.vel.x + dir.x * s, seq.vel.y + dir.y * s, seq.vel.z + dir.z * s,
          rng.range(0.35, 0.9), 0.3, g.size * 0.016, 0.2, CORE, 3.0, rng.range(4, 12), 0);
      }
    }
  }

  _updateJets(dt) {
    const ctx = this.ctx;
    const now = ctx.now;
    const f = ctx.fields;
    for (let i = this._jets.length - 1; i >= 0; i--) {
      const j = this._jets[i];
      if (now >= j.until) {
        this._jets.splice(i, 1);
        continue;
      }
      j.pos.addScaledVector(j.vel, dt);
      if (now < j.next) continue;
      j.next = now + 0.05;
      const rng = j.rng;
      const remain = (j.until - now);
      const gain = Math.min(1, remain * 1.4);

      /* Atmosphere venting: a hard white root, then the column cools to grey
         as the pressure drops. Narrow cone — this is escaping, not burning.
         The jet inherits the wreck's velocity and coasts: in vacuum a vent is
         a straight jet that thins out, never a column that rises and hangs. */
      const V = j.vel;
      f.flare.spawn(j.pos.x, j.pos.y, j.pos.z, V.x, V.y, V.z, 0.10, 0,
        j.size * 1.8 * gain, j.size * 0.5, VENT, 3.2 * gain, 0, 0);
      for (let k = 0; k < 2; k++) {
        const u = rng.unitVector();
        const dx = j.dir.x * 0.90 + u.x * 0.10;
        const dy = j.dir.y * 0.90 + u.y * 0.10;
        const dz = j.dir.z * 0.90 + u.z * 0.10;
        const s = j.speed * rng.range(0.7, 1.25) * gain;
        f.smoke.spawn(j.pos.x, j.pos.y, j.pos.z,
          V.x + dx * s, V.y + dy * s, V.z + dz * s,
          rng.range(1.1, 2.0), 0.08, j.size * 0.6, j.size * 5.5, VENT, 0.42, 0, rng.gaussian(0, 0.8));
      }
      if (rng.chance(0.55)) {
        const u = rng.unitVector();
        const s = j.speed * rng.range(1.4, 2.6);
        f.spark.spawn(j.pos.x, j.pos.y, j.pos.z,
          V.x + j.dir.x * s + u.x * s * 0.16,
          V.y + j.dir.y * s + u.y * s * 0.16,
          V.z + j.dir.z * s + u.z * s * 0.16,
          rng.range(0.3, 0.7), 0.25, j.size * 0.14, 0.2, CORE, 2.6, rng.range(4, 10), 0);
      }
    }
  }

  _updateLingers(dt) {
    const ctx = this.ctx;
    const now = ctx.now;
    const f = ctx.fields;
    for (let i = this._lingers.length - 1; i >= 0; i--) {
      const l = this._lingers[i];
      if (now >= l.until) {
        this._lingers.splice(i, 1);
        continue;
      }
      l.pos.addScaledVector(l.vel, dt);
      if (now < l.next) continue;
      l.next = now + 1 / Math.max(1, l.rate * ctx.qscale);
      const rng = l.rng;
      const u = rng.ballPoint(l.spread);
      const g = rng.unitVector();
      const V = l.vel;
      this._col.copy(EMBER).lerp(FIRE, rng.next() * 0.6);
      f.ember.spawn(l.pos.x + u.x, l.pos.y + u.y, l.pos.z + u.z,
        V.x + g.x * l.size * 0.2, V.y + g.y * l.size * 0.2, V.z + g.z * l.size * 0.2,
        rng.range(2.5, 6.0), 0.08, l.size * 0.16, l.size * 0.03, this._col, 2.2, 0, 0);
      if (rng.chance(0.55)) {
        const u2 = rng.ballPoint(l.spread * 1.1);
        f.smoke.spawn(l.pos.x + u2.x, l.pos.y + u2.y, l.pos.z + u2.z,
          V.x + g.x * l.size * 0.12, V.y + g.y * l.size * 0.12, V.z + g.z * l.size * 0.12,
          rng.range(4, 9), 0.05, l.size * 0.7, l.size * 3.0, SOOT, 0.55, 0, rng.gaussian(0, 0.4));
      }
    }
  }

  _writeRings(now) {
    const d = this.rings.data;
    let n = 0;
    for (let i = this._rings.length - 1; i >= 0; i--) {
      if (now > this._rings[i].start + this._rings[i].life) this._rings.splice(i, 1);
    }
    for (let i = 0; i < this._rings.length && n < this.rings.capacity; i++) {
      const r = this._rings[i];
      const age = now - r.start;
      const o = n * RING_STRIDE;
      d[o] = r.cx + r.vx * age;
      d[o + 1] = r.cy + r.vy * age;
      d[o + 2] = r.cz + r.vz * age;
      d[o + 3] = r.nx; d[o + 4] = r.ny; d[o + 5] = r.nz;
      d[o + 6] = r.start; d[o + 7] = r.life; d[o + 8] = r.r0; d[o + 9] = r.r1;
      d[o + 10] = r.r; d[o + 11] = r.g; d[o + 12] = r.b;
      d[o + 13] = r.thick;
      d[o + 14] = r.intensity;
      d[o + 15] = r.seed;
      n++;
    }
    this.rings.flush(n);
  }

  dispose() {
    this.rings.dispose();
    this._quadGeo.dispose();
    this._rings.length = 0;
    this._seqs.length = 0;
    this._jets.length = 0;
    this._lingers.length = 0;
    this._glows.length = 0;
  }
}
