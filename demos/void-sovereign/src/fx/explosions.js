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
import { bus } from '../core/events.js';

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
uniform float uPixelScale;
uniform sampler2D uNoise;

varying float vRr;
varying vec3 vColor;
varying float vEnv;
varying float vThick;
varying float vIntensity;
varying float vSeed;
varying float vAge;
varying float vBlotch;
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

  /* The base mesh is an annulus, not a quad.

     This used to be a billboard with the disc discarded in the fragment stage,
     and that was wrong twice over. It made an interior that has to be exactly
     zero — and at capital scale the quad is four kilometres across, so any
     residue at all became a screen-covering veil over the battle. It also paid
     full-disc overdraw for a shape that is 95% empty. An annulus cannot fill
     its own middle, and it rasterises about a tenth of the fragments.

     uv.y runs 0 at the inner edge to 1 at the outer, so the fragment stage gets
     its distance-from-front directly with no length() and no discard. */
  float rr = mix( RING_INNER, RING_OUTER, uv.y );

  /* Ragged front: a real blast is neither a perfect circle nor evenly fed
     round its circumference. One tap deforms the front radius, a second at a
     higher frequency modulates how much energy the front carries at that
     bearing. Without the second the ring resolves into a neon hoop the moment
     the band profile is tight enough to read as a front at all. Both taps tile
     in uv.x, so there is no seam at the join.

     The deformation multiplies the world radius and deliberately does NOT
     touch vRr. Folding it into vRr — which is what this used to do — pushed
     the front out past RING_OUTER wherever the wobble was positive, and the
     fragment stage's rim envelope, whose whole job is to hide the mesh edge,
     then punched holes in the brightest part of the front. Keeping the profile
     coordinate clean lets the raggedness go as deep as it likes. */
  float w1 = texture2D( uNoise, vec2( uv.x + iSeed, iSeed * 3.1 ) ).b;
  float w2 = texture2D( uNoise, vec2( uv.x * 3.0 - iSeed * 2.0, iSeed * 7.7 ) ).g;
  float w3 = texture2D( uNoise, vec2( uv.x * 7.0 + iSeed * 4.0, iSeed * 1.9 ) ).r;
  /* Three octaves, weighted so no single one dominates. Put the amplitude on
     the fundamental alone and the front stops being a circle at all — it turns
     into a five-petalled blob. The read wanted here is a front that is plainly
     circular and plainly not machined. */
  float ragged = 1.0 + ( w1 - 0.5 ) * 0.050
                     + ( w2 - 0.5 ) * 0.060
                     + ( w3 - 0.5 ) * 0.035;
  // Value noise clusters hard around 0.5, so it needs a gain and a curve or the
  // modulation is invisible.
  float feed = w2 * 0.6 + w1 * 0.4;
  vBlotch = clamp( 0.12 + 2.5 * pow( feed, 1.7 ), 0.12, 1.9 );

  float ang = uv.x * 6.2831853;
  vec3 wp = iCenter + ( t1 * cos( ang ) + t2 * sin( ang ) ) * ( rr * R * ragged );
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );

  /* Screen floor on the band, as a fraction of the front radius. A shock front
     one pixel wide is not a thin ring — it is a high-contrast line that the
     bloom smears into a 250-pixel white band, which is how a ring stops
     reading as a ring. Give it real width and less radiance instead. */
  float camDist = max( distance( cameraPosition, iCenter ), 1.0 );
  // Clamped: at small R the ratio explodes, and a floor that exceeds the
  // envelope would fill it edge to edge.
  float thickFloor = min( 0.018, ( camDist * uPixelScale * 5.0 ) / max( R, 1.0 ) );

  vRr = rr;
  vColor = iColor;
  vThick = max( iThick, thickFloor );
  vIntensity = iIntensity;
  vSeed = iSeed;
  vAge = age;
  vEnv = alive * smoothstep( 0.0, 0.04, age ) * pow( 1.0 - age, 1.5 );
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const RING_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

varying float vRr;
varying vec3 vColor;
varying float vEnv;
varying float vThick;
varying float vIntensity;
varying float vSeed;
varying float vAge;
varying float vBlotch;
varying float vFragW;

void main() {
  #include <logdepthbuf_fragment>
  float thick = max( vThick, 0.012 );

  /* Asymmetric: a hard leading edge with the energy piled against it and a
     long draining tail behind. A symmetric Gaussian reads as a smoke ring.
     vRr is the interpolated radius as a fraction of the front, straight off
     the annulus — there is no disc here to accidentally fill.

     The two profiles must MULTIPLY. Combining them with max(), which is what
     this did until now, pinned lead at 1 everywhere inside the front and trail
     at 1 everywhere outside it, so the band was the whole annulus at full
     alpha — a flat slab, and precisely the flat beige hoop the annulus shape
     was introduced to prevent. The envelope bounded the damage; it could not
     undo it. */
  float d = vRr - 1.0;
  float lead = exp( -pow( max( d, 0.0 ) / ( thick * 0.90 ), 2.0 ) );
  // Plateau then fall, not a Gaussian: the gas immediately behind the front is
  // still dense, and a front with no body behind it is a wireframe hoop.
  float trail = exp( -pow( max( -d, 0.0 ) / ( thick * 2.2 ), 1.6 ) );
  float band = lead * trail * vBlotch;
  float lip = exp( -pow( ( vRr - 1.015 ) / ( thick * 0.32 ), 2.0 ) ) * vBlotch;

  // Hard zero at both rims of the annulus so the mesh edge is never visible.
  float rim = smoothstep( RING_INNER, RING_INNER + 0.06, vRr )
            * ( 1.0 - smoothstep( RING_OUTER - 0.06, RING_OUTER, vRr ) );

  float a = clamp( band * 0.92 + lip * 0.5, 0.0, 1.0 ) * rim * vEnv * fxSoftFade( vFragW );
  if ( a <= 0.004 ) discard;

  /* Colour is a temperature ramp in two directions at once.

     Across the band: the shell piled against the leading edge is compressed
     and white-hot, the gas immediately behind it has already expanded and
     cooled through gold, and the drain-off at the back is soot. Along the
     front's life: the whole ramp slides cool as it loses energy, so a capital
     ring ends as grey smoke rather than holding one temperature for two full
     seconds. One flat colour across the band was the other half of why this
     read as beige. */
  float behind = clamp( -d / ( thick * 2.6 ), 0.0, 1.0 );
  float cool = smoothstep( 0.08, 0.80, vAge );

  vec3 hot = mix( vec3( 1.00, 0.98, 0.95 ), vec3( 1.00, 0.76, 0.40 ), cool );
  vec3 mid = mix( vec3( 1.00, 0.55, 0.18 ), vec3( 0.58, 0.28, 0.15 ), cool );
  vec3 tail = mix( vec3( 0.42, 0.27, 0.21 ), vec3( 0.24, 0.22, 0.22 ), cool );

  vec3 col = mix( hot, mid, smoothstep( 0.02, 0.30, behind ) );
  col = mix( col, tail, smoothstep( 0.34, 0.95, behind ) );
  // A trace of blue on the tip alone: gas compressed ahead of the flame front.
  col = mix( col, vec3( 0.74, 0.86, 1.0 ), clamp( lip, 0.0, 1.0 ) * 0.22 * ( 1.0 - cool ) );
  col *= vColor;

  /* Peak radiance is deliberately held near 4. The bloom prefilter cuts at 2.8
     scene-linear and the glow layer at 0.6, so this clears both and blooms —
     but a thin front at radiance 12 blooms into a 200-pixel white band and
     stops reading as a front at all. Bright enough to glow, dim enough to stay
     a line. The body term is what stops the band being a dim grey smear
     between two bright rims. */
  /* pow() on the body, not a linear term: it piles the radiance against the
     leading edge and lets the tail fall away, which is the difference between
     a shock front and a glowing tube. */
  col *= vIntensity * uGain * ( 0.12 + 1.45 * lip + 1.15 * pow( clamp( band, 0.0, 1.0 ), 1.7 ) );
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

/* Radial span of the annulus, as a fraction of the front radius.

   Deliberately tight. This bounds the worst case by construction: even if the
   band profile inside it were solid, the widest the front could ever draw is
   23% of its own radius. Shape and thickness are then modulated *within* that
   envelope, so no combination of distance, magnitude or thickness floor can
   turn a shock front back into a disc — which is the failure this whole shape
   exists to prevent. Shared with the shaders via #define. */
const RING_INNER = 0.86;
const RING_OUTER = 1.09;

/** Flat annulus in the XY plane. uv.x = angle 0..1, uv.y = 0 inner, 1 outer. */
function annulusGeometry(segments = 96) {
  const pos = [];
  const uvs = [];
  const idx = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    for (let j = 0; j < 2; j++) {
      // Position is unused — the vertex shader rebuilds the ring from uv so it
      // can apply the per-instance radius and wobble.
      pos.push(0, 0, 0);
      uvs.push(u, j);
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/* How blast strength on the `fx:blast` bus scales with hull length.

   Blast impulse goes as the cube root of yield, and yield goes as mass, so for
   hulls of roughly uniform density the felt shove is linear in length. This is
   pulled a little below linear so the 1,900 m mothership lands somewhere a
   camera can still use: at exactly 1.0 it would be 5x a destroyer, and at the
   L^1.5 this used to run at it was 11x, with a fighter at 0.002 — a 4,900:1
   ladder whose bottom two thirds sat under any sane noise gate. At 0.8 the
   whole fleet spans 178:1. See `_blast` for the measured table. */
const SHAKE_EXP = 0.8;

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

    this._quadGeo = annulusGeometry(96);
    const defs = `#define RING_INNER ${RING_INNER.toFixed(3)}\n`
      + `#define RING_OUTER ${RING_OUTER.toFixed(3)}\n`;
    this.rings = ctx.instanceBatch({
      name: 'shockwaves',
      base: this._quadGeo,
      attributes: RING_ATTRS,
      stride: RING_STRIDE,
      capacity: ctx.budget.rings,
      vertexShader: defs + RING_VERT,
      fragmentShader: defs + RING_FRAG,
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
      ring: L * 1.8,                                          // shock front
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
      { t: 0.00, k: 'ring', r0: R * 0.3, r1: ring, life: 0.46, thick: 0.045, intensity: 1.50 },
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
      { t: 0.84, k: 'ring', r0: R * 0.3, r1: ring * 1.15, life: 0.9, thick: 0.030, intensity: 1.77 },
      { t: 0.84, k: 'sparks', n: 100 * N, speed: L * 7.0, size: L * 0.06, minPx: 2.6 },
      { t: 0.86, k: 'debris', n: 18, scale: 0.5, speed: L * 1.9 },
      { t: 0.86, k: 'embers', n: 70 * N, speed: L * 2.2, life: 3.6 },
      { t: 0.88, k: 'smoke', n: 8, size: L * 0.7, speed: L * 1.4, life: 4.0 },
      { t: 1.06, k: 'ring', r0: R * 0.8, r1: ring * 1.6, life: 1.6, thick: 0.020, intensity: 0.88 },
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
    ev.push({ t: 0.00, k: 'smoke', n: 5, size: L * 0.12, speed: L * 0.30, life: 4.5 });

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
    ev.push({ t: 2.62, k: 'ring', r0: R * 0.2, r1: R * 1.2, life: 0.65, thick: 0.035, intensity: 1.09 });
    ev.push({ t: 2.64, k: 'sparks', n: 120 * N, speed: L * 1.6, size: L * 0.018, minPx: 2.6 });
    ev.push({ t: 2.66, k: 'hullglow', duration: 0.36, size: L * 1.05, bright: 5.5 });

    /* Act three: primary detonation. This is the frame that has to stop you.

       The flash is sized to bloom, not to cover. A billboard wide enough to
       fill the frame just greys the image out and drags auto-exposure down
       with it; a smaller, far hotter one blooms into the same area and keeps
       the nebula behind it. */
    ev.push({ t: 2.98, k: 'flash', size: R * 1.7, minPx: 110, life: 0.60, bright: 34.0 });
    // The next two are the same detonation seen through a slower, cooler shell.
    // They carry no impulse of their own — the beat is one shove, not three.
    ev.push({ t: 2.98, k: 'flash', size: R * 0.9, minPx: 60, life: 1.7, bright: 12.0, colour: FIRE, shake: 0 });
    ev.push({ t: 3.00, k: 'flash', size: R * 2.6, minPx: 150, life: 0.30, bright: 6.0, colour: CORE, shake: 0 });
    ev.push({ t: 2.98, k: 'ring', r0: R * 0.35, r1: ring * 1.55, life: 1.6, thick: 0.022, intensity: 1.63, axis: 'hull' });
    ev.push({ t: 3.02, k: 'ring', r0: R * 0.25, r1: ring * 1.05, life: 2.0, thick: 0.030, intensity: 1.16, axis: 'perp' });
    ev.push({ t: 2.99, k: 'sparks', n: 280 * N, speed: L * 3.4, size: L * 0.024, minPx: 3.0 });
    ev.push({ t: 3.00, k: 'debris', n: 48, scale: 1.0, speed: L * 0.75 });
    ev.push({ t: 3.02, k: 'embers', n: 240 * N, speed: L * 0.85, life: 8.0 });
    ev.push({ t: 3.04, k: 'smoke', n: 14, size: L * 0.42, speed: L * 0.5, life: 9.0 });
    ev.push({ t: 3.30, k: 'ring', r0: R * 1.1, r1: ring * 2.1, life: 2.8, thick: 0.016, intensity: 0.82 });
    ev.push({ t: 3.10, k: 'linger', duration: 14.0, rate: 20, size: L * 0.35 });

    ev.sort((a, b) => a.t - b.t);
    return ev;
  }

  /* ------------------------------------------------------------- executors */

  _at(seq, t, out) {
    return out.copy(seq.pos).addScaledVector(seq.vel, t);
  }

  /* `fx:blast` — the one channel anything that shoves the camera goes through.

     Emitted on the beats of a death sequence that should be *felt*: each
     secondary, the buckle, and the primary detonation. `radius` is the blast's
     reach in metres, for distance falloff. `strength` is dimensionless and
     normalised so **1.0 is a destroyer's primary detonation**; a listener never
     needs to know the ship class table.

     These are measured off the bus, not derived on paper — the previous doc
     comment quoted a fighter at 0.04 when the code produced 0.002, and a
     consumer set its noise gate on the strength of that figure and swallowed
     every capital rumble. Largest beat per class, and the range of the smaller
     beats that lead up to it:

       class             L(m)    peak    lead-in beats
       scout               12    0.020   —
       interceptor         14    0.023   —
       bomber              20    0.031   —
       corvette            34    0.047   —
       collector           46    0.081   0.013 - 0.038
       support frigate    115    0.170   0.027 - 0.079
       assault frigate    130    0.187   0.030 - 0.087
       ion frigate        140    0.198   0.031 - 0.093
       destroyer          380    1.000   0.064 - 0.235
       heavy cruiser      620    1.479   0.095 - 0.348
       carrier            760    1.741   0.111 - 0.410
       mothership       1,900    3.624   0.232 - 0.853

     An ion lance discharge is 0.105 and a cruiser's spinal ion 0.135 (see
     `weapons.js`). That is deliberately below a frigate's death and above a
     fighter's: a gun going off must not outweigh a ship coming apart, which is
     the one ordering this scale exists to assert. Everything else follows from
     hull mass; nothing else is hand-placed.

     Consumers: treat anything under ~0.02 as a tick that only matters within a
     few hundred metres, and expect the ladder to span roughly 180:1.

     This exists so `core/camera.js` does not have to mirror the beat timings
     here; if these tables change, the shake follows automatically. */
  _blast(seq, origin, radius, strength) {
    bus.emit('fx:blast', {
      point: origin.clone(),
      radius,
      strength: strength * Math.pow(seq.L / 380, SHAKE_EXP),
    });
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
      /* A fireball is a colour ramp in time, not one coloured blob: a white
         core that collapses almost immediately, a body that cools through
         gold to deep orange as it expands, and soot behind it. Three overlaid
         flares with different lifetimes and size ramps give the whole arc for
         two extra particles. */
      case 'flash': {
        const col = ev.colour || CORE;
        const V = seq.vel;
        const size = px(ev.size, ev.minPx);
        /* `bright` is the peak radiance of the *core* only. The body and the
           cooling shell are held far below it: a large billboard at core
           brightness does not read as a fireball, it reads as a white card,
           because every texel past the sprite's alpha shoulder still clears the
           tone curve. Small and searing, then large and dim, is the difference
           between an explosion and a lens flare. */
        // Core: smallest, hottest, gone first. This is what drives bloom.
        f.flare.spawn(origin.x, origin.y, origin.z, V.x, V.y, V.z, ev.life * 0.42, 0,
          size * 0.40, size * 0.14, WHITE, ev.bright, 0, 0);
        // Body: expands and cools through gold.
        f.flare.spawn(origin.x, origin.y, origin.z, V.x, V.y, V.z, ev.life, 0,
          size * 0.32, size, col, ev.bright * 0.14, 0, 0);
        // Cooling shell: deep orange, slower, wider — the fireball's edge.
        f.flare.spawn(origin.x, origin.y, origin.z, V.x, V.y, V.z, ev.life * 2.1, 0,
          size * 0.5, size * 1.5, EMBER, ev.bright * 0.045, 0, 0);
        /* Brightness is a good proxy for how hard a beat should hit — the
           destroyer's primary is `bright: 34`, which is what anchors the scale
           at 1.0. But a single beat built from three overlaid flares must put
           one impulse on the bus, not three, or the anchor is a lie by a factor
           of 1.5; `shake: 0` mutes the companions. */
        const shake = ev.shake === undefined ? ev.bright / 34 : ev.shake;
        if (shake > 0) this._blast(seq, origin, seq.m.ring, shake);
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
        this._blast(seq, this._v, seq.m.R * 1.5, 0.07);
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
        this._blast(seq, origin, seq.m.R * 2.0, 0.16 * (ev.bright / 5.5));
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
      // Per-ring tint hook, left neutral: the fragment stage owns the front's
      // temperature ramp, and a warm constant here fought it to beige.
      r: 1.0, g: 1.0, b: 1.0,
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
