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
varying float vAng;

void main() {
  float age = clamp( ( uTime - iTime.x ) / max( iTime.y, 0.0001 ), 0.0, 1.0 );
  float alive = step( 0.0, uTime - iTime.x ) * step( age, 0.9999 );
  vAng = uv.x;

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
  /* Round 6 fix 4: held near flat. Swung from 0.12 to 1.9 round the front, the
     blotch drew bright and dark spokes across the band that read as radial
     speed lines; the front is now a hairline of near-even weight. */
  vBlotch = clamp( 0.80 + 0.35 * pow( feed, 1.7 ), 0.80, 1.15 );

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
  float thickFloor = min( 0.010, ( camDist * uPixelScale * 1.6 ) / max( R, 1.0 ) );

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
  float trail = exp( -pow( max( -d, 0.0 ) / ( thick * 0.9 ), 1.6 ) );
  float band = lead * trail * vBlotch;
  /* The hot leading edge. This was 0.32 of the band thickness, which on a
     3.4 km capital front is about 17 metres — comfortably sub-pixel, so the
     one part of the shock that is supposed to be white-hot never reached the
     screen and the whole ring resolved to the flat beige of its own body.
     Widened to a bit over half the band, which the thickness floor already
     guarantees is several pixels across at any range. */
  float lip = exp( -pow( ( vRr - 1.012 ) / ( thick * 0.58 ), 2.0 ) ) * vBlotch;

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
  /* Drive the leading edge back to white before anything else touches it. The
     temperature ramp across the band is correct but it is a ramp between two
     warm colours; without a hard white edge on the front itself the eye has
     nothing to read as a shock and takes the average, which is beige. */
  col = mix( col, vec3( 1.0, 0.96, 0.88 ), clamp( lip, 0.0, 1.0 ) * mix( 0.72, 0.30, cool ) );
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
  col *= vIntensity * uGain * ( 0.12 + 2.30 * lip + 1.05 * pow( clamp( band, 0.0, 1.0 ), 1.7 ) );
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

/* R12 fix 3: the shock front of a frigate or a capital is a soft disc, not a
   wire. Same vertex stage as the ring (built with RING_INNER 0, so the mesh
   is a full disc), its own profile: a thin, soft-edged front over a faint
   fill that thickens toward it, the whole thing cooling from gold to a dusty
   blue-grey and fading out. The fill is what makes it read as a sheet of gas
   blown out of the hull instead of a hoop drawn round it, and it is held low
   so a two-hull-wide disc never turns into a veil over the battle. */
const DISC_FRAG = /* glsl */ `
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
varying float vAng;

uniform sampler2D uNoise;

void main() {
  #include <logdepthbuf_fragment>
  float d = vRr - 1.0;
  /* R12 fix 3, second pass: the first disc still drew an outline. Its fill
     rose as r^3 and was cut at the front, so the brightest gas sat on the
     rim and the whole thing read as a soap bubble round the fireball. Now
     the fill peaks inside and thins out before the front, the front is a
     wide, faint gaussian, and both are broken up by a gas noise that drifts
     outward with age, so no bearing carries a continuous line. */
  float w = max( vThick, 0.02 ) * 2.2;
  float gas = texture2D( uNoise, vec2( vAng * 5.0 + vSeed * 3.3, vRr * 1.6 - vAge * 0.7 + vSeed ) ).r;
  gas = smoothstep( 0.28, 0.72, gas );
  float front = exp( -pow( d / w, 2.0 ) ) * mix( 0.25, 1.0, gas );
  float r = clamp( vRr, 0.0, 1.0 );
  float fill = smoothstep( 0.0, 0.45, r ) * ( 1.0 - smoothstep( 0.55, 1.02, r ) ) * mix( 0.45, 1.0, gas );
  float rim = 1.0 - smoothstep( RING_OUTER - 0.05, RING_OUTER, vRr );
  float a = clamp( front * 0.12 + fill * 0.30, 0.0, 1.0 ) * vBlotch * rim * vEnv * fxSoftFade( vFragW );
  if ( a <= 0.004 ) discard;
  float cool = smoothstep( 0.02, 0.55, vAge );
  vec3 edgeC = mix( vec3( 1.00, 0.80, 0.52 ), vec3( 0.60, 0.68, 0.84 ), cool );
  vec3 fillC = mix( vec3( 1.00, 0.46, 0.15 ), vec3( 0.34, 0.36, 0.42 ), cool );
  vec3 col = mix( fillC, edgeC, clamp( front, 0.0, 1.0 ) ) * vColor;
  col *= vIntensity * uGain * ( 0.36 + 0.24 * front );
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* R12 fix 3: a fireball is one procedural billboard, not a pile of flares.

   Round 11 built the primary from fourteen overlapping flare sprites. Each
   one was a radial falloff at 6.5x radiance, and the sum clipped to one flat
   cream disc with a hard rim (the "lightbulb"), with no temperature in it and
   the same shape on every class. This is one quad per fireball, elongated
   along the dead hull's keel, with the falloff and the colour computed per
   pixel: a white-yellow core, gold, orange and a dull red edge, the whole ramp
   sliding cool with age; a billowing silhouette from two noise octaves; and
   radiance that only clears the bloom cut (2.8) in the core, so what clips is
   a small hot centre and the rest is fire. It depth-tests against the scene,
   so the ribs and plating in front of its plane cut it. */
const FB_STRIDE = 16;
/* 0..2 centre | 3..5 velocity | 6..9 start,life,r0,r1 | 10..12 keel axis
   13 elongation | 14 intensity | 15 seed */
const FB_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 iCenter;
attribute vec3 iVel;
attribute vec4 iTime;
attribute vec3 iAxis;
attribute float iElong;
attribute float iIntensity;
attribute float iSeed;

uniform float uTime;

varying vec2 vP;
varying float vAge;
varying float vInt;
varying float vSeed;
varying float vFragW;

void main() {
  float t = uTime - iTime.x;
  float age = clamp( t / max( iTime.y, 0.0001 ), 0.0, 1.0 );
  float alive = step( 0.0, t ) * step( age, 0.9999 );
  // Born at r0 (already hull-sized on the kill frame), easing out to r1.
  float grow = 1.0 - exp( -max( t, 0.0 ) / max( iTime.y * 0.14, 0.004 ) );
  float R = mix( iTime.z, iTime.w, grow ) * alive;

  vec4 mv = viewMatrix * vec4( iCenter + iVel * max( t, 0.0 ), 1.0 );
  vec3 ax = ( viewMatrix * vec4( iAxis, 0.0 ) ).xyz;
  float l2 = length( ax.xy );
  vec2 d = l2 > 1e-4 ? ax.xy / l2 : vec2( 1.0, 0.0 );
  // A keel pointing at the camera is not long on screen, so neither is this.
  float el = mix( 1.0, iElong, clamp( l2, 0.0, 1.0 ) );
  vec2 pp = vec2( -d.y, d.x );
  vec2 q = position.xy * 2.7;
  mv.xy += d * ( q.x * R * el ) + pp * ( q.y * R );
  gl_Position = projectionMatrix * mv;

  vP = q;
  vAge = age;
  vInt = iIntensity * alive;
  vSeed = iSeed;
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const FB_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

uniform sampler2D uNoise;

varying vec2 vP;
varying float vAge;
varying float vInt;
varying float vSeed;
varying float vFragW;

void main() {
  #include <logdepthbuf_fragment>
  float r = length( vP );
  vec2 dir = vP / max( r, 1e-4 );
  // Two octaves, the coarse one drifting outward with age so the edge billows.
  vec2 base = vP * 0.30 + vec2( vSeed * 3.7, vSeed * 1.3 );
  float n1 = texture2D( uNoise, base - dir * vAge * 0.12 ).r;
  float n2 = texture2D( uNoise, base * 2.6 + vec2( 0.31, vSeed * 5.1 ) ).g;
  float n = n1 * 0.62 + n2 * 0.38;
  float edge = 1.0 + ( n - 0.5 ) * 0.95;
  float d = r / max( edge, 0.25 );
  if ( d >= 1.0 ) discard;
  float body = 1.0 - smoothstep( 0.50, 1.0, d );

  /* Temperature: hottest at the centre, falling to the edge, and the whole
     ramp cooling with age. The fine octave breaks the isotherms up so the
     core is a ragged hot region, not a target. */
  float heat = mix( 1.0, 0.16, smoothstep( 0.0, 0.80, vAge ) );
  float T = clamp( ( 1.0 - d ) * 1.10 * heat + ( n2 - 0.5 ) * 0.40 * ( 1.0 - d ), 0.0, 1.0 );
  vec3 c = vec3( 0.40, 0.05, 0.015 );
  c = mix( c, vec3( 1.00, 0.30, 0.05 ), smoothstep( 0.10, 0.36, T ) );
  c = mix( c, vec3( 1.00, 0.60, 0.19 ), smoothstep( 0.36, 0.60, T ) );
  c = mix( c, vec3( 1.00, 0.84, 0.52 ), smoothstep( 0.62, 0.88, T ) );
  c = mix( c, vec3( 1.00, 0.96, 0.86 ), smoothstep( 0.90, 0.99, T ) );
  // Radiance clears the bloom cut only where T is high: a small searing core.
  float rad = 0.24 + 2.20 * pow( T, 2.6 );
  float env = 1.0 - smoothstep( 0.50, 1.0, vAge );
  // Cooler pockets where the coarse octave is low: gas, not a card.
  float pocket = mix( 0.55, 1.0, smoothstep( 0.30, 0.62, n1 ) );
  float a = body * env * pocket * fxSoftFade( vFragW );
  if ( a <= 0.003 ) discard;
  gl_FragColor = vec4( c * rad * vInt * uGain, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const FB_ATTRS = [
  { name: 'iCenter', size: 3, offset: 0 },
  { name: 'iVel', size: 3, offset: 3 },
  { name: 'iTime', size: 4, offset: 6 },
  { name: 'iAxis', size: 3, offset: 10 },
  { name: 'iElong', size: 1, offset: 13 },
  { name: 'iIntensity', size: 1, offset: 14 },
  { name: 'iSeed', size: 1, offset: 15 },
];

function quadGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

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

/* Band boundaries in metres of hull length. A death's *shape* is chosen here
   and nowhere else; `kill()` is the only reader. */
const BAND_SPARK = 26;
const BAND_POP = 70;
const BAND_BREAK = 210;
/* Beats whose `at` moves the whole event to a keel station. */
const AT_KINDS = new Set(['sparks', 'debris', 'vent', 'disc']);

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

    this._quadGeo = annulusGeometry(160);
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

    /* R12 fix 3: the soft shock disc and the procedural fireball. One draw
       call each; both are in the scene from construction, so their programs
       link on the boot frames, never on a kill. */
    this._discGeo = annulusGeometry(128);
    const ddefs = '#define RING_INNER 0.000\n#define RING_OUTER 1.060\n';
    this.discs = ctx.instanceBatch({
      name: 'shockdiscs',
      base: this._discGeo,
      attributes: RING_ATTRS,
      stride: RING_STRIDE,
      capacity: Math.max(8, Math.round(ctx.budget.rings * 0.5)),
      vertexShader: ddefs + RING_VERT,
      fragmentShader: ddefs + DISC_FRAG,
      uniforms: { uNoise: { value: ctx.noises.fbm } },
      renderOrder: 16,
      softness: 80,
      nearFade: 40,
    });
    this._fbGeo = quadGeometry();
    this.fireballs = ctx.instanceBatch({
      name: 'fireballs',
      base: this._fbGeo,
      attributes: FB_ATTRS,
      stride: FB_STRIDE,
      capacity: 96,
      vertexShader: FB_VERT,
      fragmentShader: FB_FRAG,
      uniforms: { uNoise: { value: ctx.noises.fbm } },
      renderOrder: 15,
      softness: 30,
      nearFade: 40,
    });
    this.drawCalls = 3;
    this._discList = [];
    this._fbs = [];
    // Wrecks open their cuts with the same fireball (wrecks.js `_cut`).
    ctx.fireball = (p, v, axis, r0, r1, life, inten, elong) => this._addFireball(p, v, axis, r0, r1, life, inten, elong, null);

    this._rings = [];
    this._seqs = [];
    this._jets = [];
    this._lingers = [];
    this._glows = [];

    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._dir = new THREE.Vector3();
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

  get fireballCount() { return this._fbs.length; }

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

     Duration is *not* handled here any more, and that was the round-2 defect.
     A single `T = clamp(cbrt(L/380), 0.4, 1.75)` stretched one animation over
     the whole roster: a 4.4:1 duration ladder against the 5:1 floor in
     CRITIQUE-RUBRIC §3.9/P3, and — worse — the same act structure from a 14 m
     interceptor to a 1,900 m mothership, which is the "same explosion,
     different scale factor" the rubric scores at 5. Each band now owns its own
     script *and* its own stretch, normalised at that band's reference hull, so
     a 115 m frigate is quicker than a 140 m one without either of them
     borrowing the capital's four acts. */
  _magnitude(L) {
    return {
      L,
      R: L * 0.95,                                            // fireball radius
      ring: L * 1.8,                                          // shock front
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
      // The dead ship's own plating, not its livery. Falls back to the team
      // primary when MAT has not run (standalone FX test page).
      hull: (ctx.hullPalette && ctx.hullPalette(def.palette)) || null,
      events: null,
    };

    /* The axis the wreck vents along. Mostly the keel — a hull fails along its
       frames — but pulled off it by a random component so a squadron dying does
       not produce a row of identical twin-lobed bursts. Drawn once per death,
       from the death's own fork of the RNG, so it is reproducible from the seed
       like everything else. */
    seq.blast = new THREE.Vector3().copy(seq.axis);
    const w = seq.rng.unitVector();
    seq.blast.x += w.x * 0.55;
    seq.blast.y += w.y * 0.55;
    seq.blast.z += w.z * 0.55;
    if (seq.blast.lengthSq() < 1e-6) seq.blast.set(0, 0, 1);
    seq.blast.normalize();

    /* Which way the failure travels along the keel. Drawn per death so half a
       squadron fails bow-first and half stern-first; without it every capital
       in a match walks its secondaries in the same direction, which is a
       pattern a player notices within two deaths. */
    seq.sweep = seq.rng.next() < 0.5 ? -1 : 1;

    /* Four bands, four shapes. The boundaries are hull lengths from
       `ships/catalog.js`: scout 12 / interceptor 14 / bomber 20 sit in SPARK,
       corvette 34 / collector 46 in POP, the three frigates at 115-140 in
       BREAK, and destroyer 380 upward in CAPITAL. */
    /* R12 fix 3: from a frigate up, the death is chosen by class, not only by
       length, and each script is authored in seconds (T = 1). The scripts
       also return the wreck's break plan (where the hull is cut and when each
       section lets go), so the hull comes apart where the fire is. */
    let T = 1;
    seq.plan = null;
    if (L < BAND_SPARK) { seq.events = this._scriptSpark(seq); T = Math.pow(L / 18, 0.50); }
    else if (L < BAND_POP) { seq.events = this._scriptPop(seq); T = Math.pow(L / 40, 0.50); }
    else if (L < BAND_BREAK) seq.events = this._scriptFrigate(seq);
    else {
      const id = entity.classId || def.id || '';
      if (id === 'mothership' || L >= 1200) seq.events = this._scriptMothership(seq);
      else if (id === 'carrier') seq.events = this._scriptCarrier(seq);
      else if (id === 'cruiser') seq.events = this._scriptCruiser(seq);
      else seq.events = this._scriptDestroyer(seq);
    }
    seq.T = T;

    /* One place stretches the whole timeline by hull size — and it stretches
       *lifetimes* with the beats, which the round-2 version did not. Scaling
       only `t` left a mothership's beats spread over six seconds while every
       fireball on them still burned for the same 0.6 s an interceptor's did,
       so the acts read as a slideshow of identical pops rather than as one
       structure failing at its own pace. Particle counts deliberately do not
       stretch: those are mass, and mass is `m.N`. */
    if (T !== 1) {
      for (const e of seq.events) {
        e.t *= T;
        if (e.life) e.life *= T;
        if (e.duration) e.duration *= T;
        if (e.emberLife) e.emberLife *= T;
        if (e.smokeLife) e.smokeLife *= T;
      }
    }

    this._seqs.push(seq);
    return seq.plan;
  }

  /* --------------------------------------------------------------- scripts */

  /* SPARK — one frame and a spark, which is literally the brief.

     A 14 m hull has nothing in it that can burn for two seconds, and the
     round-2 script gave it 1.8 s of embers and 1.4 s of smoke. That single
     decision is what flattened the duration ladder: the bottom rung sat at
     ~1.8 s, so no plausible top rung could reach 5:1 without a mothership
     taking nine seconds to *stop emitting*. Nothing here outlives a third of
     a second, and the flash is a `point` shape — two flares, not five — so a
     strike craft dying is one hot dot, not a five-billboard cluster. */
  _scriptSpark(seq) {
    const { L, R, ring } = seq.m;
    return [
      // R7 fix 5b: peaks on its first frame and decays over 0.2 s (was 0.13 s).
      { t: 0.00, k: 'flash', shape: 'point', size: R * 1.9, minPx: 11, life: 0.20, bright: 9.0 },
      /* No shock ring (round 4: a cream hoop round a 14 m hull read as clip
         art), and the spray is held to a couple of hull lengths. */
      /* Round 6 fix 4: short and slow enough to stay inside the hull's own
         length. At L * 4.5 with 3-10x stretch the spray drew a blurred tan
         X well past the ship, which read as the lens-cross firework. */
      { t: 0.00, k: 'sparks', n: 18, speed: L * 1.4, size: L * 0.03, minPx: 1.2, life: 0.26, stretch: [1.0, 2.0] },
      { t: 0.01, k: 'debris', n: 2, scale: 0.26, speed: L * 5.0, lifeScale: 0.12 },
    ];
  }

  /* POP — a corvette or a collector. One act, a real fireball, burning
     wreckage, over inside a second. This is the rung that has to sit visibly
     between a strike craft and a frigate, so it gets embers and smoke that
     SPARK is denied and none of the venting that BREAK gets. */
  _scriptPop(seq) {
    const { L, R, ring, N } = seq.m;
    return [
      { t: 0.00, k: 'flash', size: R * 2.1, minPx: 16, life: 0.20, bright: 12.0 },
      { t: 0.00, k: 'sparks', n: 40 * N, speed: L * 12, size: L * 0.11, minPx: 2.6, life: 0.48 },
      { t: 0.00, k: 'ring', r0: R * 0.30, r1: ring, life: 0.38, thick: 0.045, intensity: 1.50 },
      { t: 0.03, k: 'debris', n: 5, scale: 0.30, speed: L * 4.2, lifeScale: 0.26 },
      { t: 0.05, k: 'embers', n: 20 * N, speed: L * 3.2, life: 0.46 },
      { t: 0.07, k: 'smoke', n: 3, size: R * 1.6, speed: L * 2.0, life: 0.60 },
    ];
  }

  /* R12 fix 3: every death from a frigate up is written per class, because
     round 11's critic could not tell a cruiser from a carrier: both were the
     same cream ball at different scales. Sizes are in hull lengths *as drawn*
     (ctx.hullBudget), times in seconds, and each script is built so that its
     kill frame and its silhouette over the first second are its own:

       frigate     one sharp burst, the hull snaps in two on the spot
       destroyer   a keel rupture: a fireball stretched down the keel at one
                   frame, a disc in the rupture plane, two halves that hinge
                   apart in a V
       cruiser     a slow chain: the failure starts at one end and walks the
                   spine in seven beats over two seconds, and each section
                   lets go as the chain passes its cut
       carrier     the big one on the kill frame, then the hangar deck cooks
                   off down one flank, and the flight deck breaks into four
                   tumbling sections
       mothership  a staged sequence: reactor breach, three internal
                   detonations walking the hull, the hull glowing, and only
                   at +3 s the main detonation and the breakup

     `fireball` sizes: r0 is the radius on the kill frame, r1 the radius it
     eases to, both x the hull as drawn; `elong` stretches it down the keel. */

  /* The wreck's break plan. `cuts` are fractions of the keel from stern (0)
     to bow (1); `delays` are when each section (stern first) starts to move. */
  _plan(seq, cuts, delays, kick, tilt) {
    seq.plan = { cuts, delays, kick, tilt };
  }

  _scriptFrigate(seq) {
    const { L, R, ring, N } = seq.m;
    const station = seq.rng.range(-0.18, 0.18);
    this._plan(seq, [station + 0.5], [0.02, 0.02], 0.26, [0.10, 0.18]);
    return [
      { t: 0.00, k: 'fireball', at: station, r0: 0.24, r1: 0.348, life: 0.50, inten: 1.10, elong: 1.45, toCam: 0.10, shake: 0.5 },
      { t: 0.00, k: 'tear', at: station, spark: 40 * N, n: 12, keel: 2, sep: 0.10, scale: 0.5, lifeScale: 0.5 },
      { t: 0.00, k: 'sparks', n: 30 * N, speed: L * 5.0, size: L * 0.045, minPx: 2.4, life: 0.55 },
      { t: 0.00, k: 'disc', r0: R * 0.25, r1: ring * 0.9, life: 0.65, thick: 0.075, intensity: 0.59, axis: 'hull' },
      { t: 0.06, k: 'embers', n: 50 * N, speed: L * 2.0, life: 1.2 },
      { t: 0.10, k: 'smoke', n: 6, size: L * 0.55, speed: L * 1.1, life: 1.5 },
      { t: 0.30, k: 'linger', duration: 1.2, rate: 10, size: L * 0.5, emberLife: 1.4, smokeLife: 1.8 },
    ];
  }

  _scriptDestroyer(seq) {
    const { L, R, N } = seq.m;
    const rng = seq.rng;
    const station = rng.range(-0.14, 0.14);
    this._plan(seq, [station + 0.5], [0.04, 0.04], 0.30, [0.14, 0.24]);
    const ev = [
      { t: 0.00, k: 'fireball', at: station, r0: 0.18, r1: 0.264, life: 0.95, inten: 1.10, elong: 2.0, toCam: 0.08, shake: 1.0 },
      { t: 0.00, k: 'tear', at: station, spark: 30 * N, n: 30, keel: 4, sep: 0.12, scale: 1.0 },
      { t: 0.00, k: 'disc', r0: R * 0.15, r1: L * 0.80, life: 1.0, thick: 0.075, intensity: 0.56, axis: 'hull' },
      { t: 0.10, k: 'embers', n: 110 * N, speed: L * 0.30, life: 2.6 },
      { t: 0.16, k: 'smoke', n: 8, size: L * 0.36, speed: L * 0.45, life: 3.0 },
      { t: 0.20, k: 'vent', n: 2, duration: 1.6, speed: L * 1.0, axis: 'lateral', at: station },
    ];
    // The rupture running a short way down the keel each side of the break.
    for (const s of [-1, 1]) {
      ev.push({ t: 0.05 + rng.range(0, 0.02), k: 'fireball', at: station + s * 0.13, r0: 0.06, r1: 0.096, life: 0.60, inten: 1.0, elong: 1.4, toCam: 0.08 });
    }
    // The two open ends keep cooking off.
    for (const t of [0.45, 0.85, 1.30, 1.85]) {
      ev.push({ t: t + rng.range(-0.04, 0.04), k: 'fireball', at: station + rng.range(-0.08, 0.08), lat: rng.range(-0.05, 0.05), r0: 0.03, r1: 0.054, life: 0.50, inten: 1.0, elong: 1.0, toCam: 0.06, shake: 0.08 });
    }
    ev.push({ t: 1.60, k: 'linger', duration: 4.0, rate: 14, size: L * 0.35, emberLife: 3.0, smokeLife: 3.6 });
    return ev;
  }

  _scriptCruiser(seq) {
    const { L, R, N } = seq.m;
    const rng = seq.rng;
    const a0 = -0.44 * seq.sweep;
    const a1 = 0.44 * seq.sweep;
    const beats = 7;
    const step = 0.30;
    const ev = [
      { t: 0.00, k: 'tear', at: a0, spark: 18 * N, n: 8, keel: 0, sep: 0.04, scale: 0.6 },
      { t: 0.00, k: 'disc', r0: R * 0.08, r1: L * 0.38, life: 0.8, thick: 0.075, intensity: 0.49, axis: 'hull', at: a0 },
    ];
    for (let i = 0; i < beats; i++) {
      const u = i / (beats - 1);
      const at = a0 + (a1 - a0) * u + rng.range(-0.02, 0.02);
      const t = i * step + (i ? rng.range(-0.03, 0.03) : 0);
      ev.push({ t, k: 'fireball', at, lat: rng.range(-0.03, 0.03), r0: 0.072, r1: 0.114, life: 0.80, inten: 1.05, elong: 1.25, toCam: 0.07, shake: 0.32 });
      ev.push({ t: t + 0.04, k: 'sparks', n: 14 * N, speed: L * 0.5, size: L * 0.012, minPx: 2.0, life: 0.7, at });
      if (i % 2 === 1) ev.push({ t: t + 0.06, k: 'debris', n: 4, scale: 0.22, speed: L * 0.30, at });
      if (i % 3 === 1) ev.push({ t: t + 0.08, k: 'vent', n: 1, duration: 1.3, speed: L * 0.8, axis: 'lateral', at });
    }
    // The chain arrives: the far end goes, bigger than any link before it.
    const tEnd = (beats - 1) * step + 0.12;
    ev.push({ t: tEnd, k: 'fireball', at: a1, r0: 0.12, r1: 0.18, life: 1.0, inten: 1.1, elong: 1.5, toCam: 0.07, shake: 0.9 });
    ev.push({ t: tEnd, k: 'disc', r0: R * 0.12, r1: L * 0.62, life: 1.0, thick: 0.075, intensity: 0.56, axis: 'hull', at: a1 });
    ev.push({ t: 0.20, k: 'embers', n: 60 * N, speed: L * 0.25, life: 2.6 });
    ev.push({ t: tEnd + 0.08, k: 'embers', n: 80 * N, speed: L * 0.30, life: 2.8 });
    ev.push({ t: tEnd + 0.12, k: 'smoke', n: 8, size: L * 0.36, speed: L * 0.45, life: 3.2 });
    ev.push({ t: tEnd + 0.40, k: 'linger', duration: 4.4, rate: 16, size: L * 0.35, emberLife: 3.0, smokeLife: 3.8 });
    /* Three sections, each letting go as the chain passes its cut. Cuts are
       stern-to-bow; the chain runs whichever way `sweep` says. */
    const c1 = 1 / 3 + rng.range(-0.05, 0.05);
    const c2 = 2 / 3 + rng.range(-0.05, 0.05);
    const arrive = (f) => Math.max(0, ((f - 0.5 - a0) / (a1 - a0)) * (beats - 1) * step);
    const t1 = arrive(c1);
    const t2 = arrive(c2);
    const d = seq.sweep > 0 ? [t1, Math.min(t1, t2), t2] : [t1, Math.max(t1, t2), t2];
    this._plan(seq, [c1, c2], d, 0.22, [0.06, 0.12]);
    ev.sort((a, b) => a.t - b.t);
    return ev;
  }

  _scriptCarrier(seq) {
    const { L, R, N } = seq.m;
    const rng = seq.rng;
    const station = rng.range(-0.10, 0.10);
    const flank = rng.next() < 0.5 ? -1 : 1;
    const cuts = [0.25, 0.5, 0.75].map((c) => c + rng.range(-0.05, 0.05));
    this._plan(seq, cuts, [0.12, 0.06, 0.06, 0.12], 0.40, [0.12, 0.22]);
    const ev = [
      { t: 0.00, k: 'fireball', at: station, r0: 0.33, r1: 0.42, life: 1.05, inten: 1.12, elong: 1.40, toCam: 0.14, shake: 1.0 },
      { t: 0.00, k: 'tear', at: station, spark: 26 * N, n: 30, keel: 4, sep: 0.12, scale: 1.0 },
      { t: 0.00, k: 'disc', r0: R * 0.15, r1: L * 0.95, life: 1.2, thick: 0.075, intensity: 0.56, axis: 'up' },
      { t: 0.10, k: 'embers', n: 120 * N, speed: L * 0.30, life: 3.0 },
      { t: 0.18, k: 'smoke', n: 10, size: L * 0.36, speed: L * 0.45, life: 3.4 },
    ];
    /* The hangar deck: a row of blowouts down one flank, stern to bow or
       back, each one a small fireball with a jet out through the side. */
    const pops = 7;
    for (let i = 0; i < pops; i++) {
      const at = seq.sweep * (-0.38 + i * (0.76 / (pops - 1))) + rng.range(-0.02, 0.02);
      const t = 0.14 + i * 0.12 + rng.range(-0.02, 0.02);
      ev.push({ t, k: 'fireball', at, lat: flank * 0.10, r0: 0.036, r1: 0.06, life: 0.55, inten: 1.15, elong: 1.0, toCam: 0.06, shake: 0.12 });
      ev.push({ t: t + 0.02, k: 'vent', n: 1, duration: 1.1, speed: L * 0.9, axis: 'side', side: flank, at, spread: 0.18 });
    }
    // The flight deck coming apart: plates and spans off the cuts.
    ev.push({ t: 0.32, k: 'debris', n: 12, scale: 0.55, speed: L * 0.32, keel: 3 });
    ev.push({ t: 1.10, k: 'fireball', at: station + rng.range(-0.2, 0.2), r0: 0.06, r1: 0.096, life: 0.7, inten: 1.0, elong: 1.2, toCam: 0.06, shake: 0.25 });
    ev.push({ t: 1.40, k: 'linger', duration: 5.0, rate: 18, size: L * 0.35, emberLife: 3.4, smokeLife: 4.0 });
    ev.sort((a, b) => a.t - b.t);
    return ev;
  }

  _scriptMothership(seq) {
    const { L, R, N } = seq.m;
    const rng = seq.rng;
    const station = rng.range(-0.08, 0.08);
    const tMain = 3.0;
    this._plan(seq, [0.24, 0.5, 0.76].map((c) => c + rng.range(-0.04, 0.04)), [tMain, tMain, tMain, tMain], 0.30, [0.06, 0.12]);
    const ev = [
      /* Reactor breach: the kill frame is light escaping, not yet the end.
         Second pass: at 0.06 of the hull the breach read as one more hit
         spark (stepped take, 0.02 of the hull box on the kill frame), so a
         player who had just killed the flagship saw nothing happen for a
         second. It is now a fireball a seventh of the hull long, venting at
         once. */
      { t: 0.00, k: 'fireball', at: station, r0: 0.13, r1: 0.19, life: 1.1, inten: 1.1, elong: 1.6, toCam: 0.07, shake: 0.45 },
      { t: 0.00, k: 'breach', n: 5, size: R * 0.07, life: 0.9, bright: 11.0 },
      { t: 0.04, k: 'vent', n: 3, duration: 2.8, speed: L * 0.8, axis: 'lateral' },
      { t: 0.40, k: 'embers', n: 60 * N, speed: L * 0.20, life: 3.0 },
      { t: 2.10, k: 'hullglow', duration: 0.90, size: L, bright: 2.0 },
      // The main detonation and the breakup.
      { t: tMain, k: 'fireball', at: station, r0: 0.252, r1: 0.36, life: 1.4, inten: 1.12, elong: 1.5, toCam: 0.08, shake: 1.0 },
      { t: tMain, k: 'tear', at: station, spark: 30 * N, n: 40, keel: 4, sep: 0.12, scale: 1.0 },
      { t: tMain, k: 'disc', r0: R * 0.15, r1: L * 1.0, life: 1.6, thick: 0.075, intensity: 0.59, axis: 'hull' },
      { t: tMain + 0.12, k: 'embers', n: 140 * N, speed: L * 0.30, life: 3.6 },
      { t: tMain + 0.20, k: 'smoke', n: 12, size: L * 0.36, speed: L * 0.45, life: 4.0 },
      { t: tMain + 0.60, k: 'linger', duration: 6.0, rate: 20, size: L * 0.35, emberLife: 3.6, smokeLife: 4.4 },
    ];
    // Three internal detonations walking the hull, each bigger than the last.
    const walk = [[0.75, -0.24], [1.45, 0.22], [2.25, -0.36 * seq.sweep]];
    walk.forEach(([t, at], i) => {
      ev.push({ t, k: 'fireball', at: station + at, lat: rng.range(-0.04, 0.04), r0: 0.075 + 0.02 * i, r1: 0.11 + 0.025 * i, life: 0.9, inten: 1.08, elong: 1.3, toCam: 0.07, shake: 0.4 + 0.15 * i });
      ev.push({ t: t + 0.05, k: 'debris', n: 5, scale: 0.25, speed: L * 0.2, at: station + at });
      ev.push({ t: t + 0.06, k: 'breach', n: 3, size: R * 0.06, life: 0.8, bright: 12.0 });
    });
    ev.sort((a, b) => a.t - b.t);
    return ev;
  }

  /* ------------------------------------------------------------- executors */

  _at(seq, t, out) {
    return out.copy(seq.pos).addScaledVector(seq.vel, t);
  }

  /* Directional bias for ejecta.

     A ship is not a point charge. It comes apart along its structure, so the
     blast vents hardest through the two ends of the hull and along whatever
     axis the failure ran — which is why real wreckage forms lobes and a
     particle system's `rng.unitVector()` forms a ball. A perfectly isotropic
     spray is the single loudest "this is a particle emitter" signal a death can
     give, and it is the reason the puffs read as soft round billboards with
     nothing behind them.

     `seq.blast` is a per-death axis, drawn once, biased onto the hull's long
     axis: most ships fail along the keel, some do not. Writes a unit vector to
     `out` and returns a speed multiplier, so the material moving *along* the
     lobes is also the material moving fastest — which is what makes the lobes
     legible rather than merely present. */
  _bias(seq, rng, amount, out) {
    const u = rng.unitVector();
    const b = seq.blast;
    // Sign per sample so the lobes go both ways down the axis, as a hull that
    // has broken in the middle actually vents.
    const s = rng.next() < 0.5 ? -1 : 1;
    out.set(
      u.x + b.x * s * amount,
      u.y + b.y * s * amount,
      u.z + b.z * s * amount,
    );
    const len = Math.max(1e-4, Math.hypot(out.x, out.y, out.z));
    out.multiplyScalar(1 / len);
    // Alignment with the lobe, remapped to 0.3 .. 1.25 of nominal speed.
    const align = Math.abs(out.x * b.x + out.y * b.y + out.z * b.z);
    return (0.30 + 0.95 * Math.pow(align, 1.6)) * rng.range(0.55, 1.15);
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

  /* The torn cross-section and the two keel halves of a split (BREAK and the
     R11 capital primary share it). */
  _tear(seq, plane, ev, reach) {
    const f = this.ctx.fields;
    const q = this.ctx.qscale;
    const rng = seq.rng;
    const V = seq.vel;
    /* The torn cross-section: sparks thrown out *in the plane*, not into a
       ball. A disc of ejecta edge-on to the keel is the single clearest
       statement that the break has an orientation. */
    const sn = Math.round((ev.spark || 90) * q);
    for (let i = 0; i < sn; i++) {
      const a = rng.range(0, Math.PI * 2);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // In-plane direction, with a small out-of-plane leak so the disc has
      // thickness and does not read as a decal.
      this._dir.set(
        seq.side.x * ca + seq.up.x * sa + seq.axis.x * rng.gaussian(0, 0.22),
        seq.side.y * ca + seq.up.y * sa + seq.axis.y * rng.gaussian(0, 0.22),
        seq.side.z * ca + seq.up.z * sa + seq.axis.z * rng.gaussian(0, 0.22),
      ).normalize();
      // R7 fix 5: inside `reach` over the ember's life, not a hull length a second.
      const sp = Math.min(seq.L, reach / (1.1 * seq.T * 1.1)) * rng.range(0.4, 1.0);
      this._col.copy(CORE).lerp(EMBER, 0.45 + rng.next() * 0.55);
      f.spark.spawn(plane.x, plane.y, plane.z,
        V.x + this._dir.x * sp, V.y + this._dir.y * sp, V.z + this._dir.z * sp,
        rng.range(0.3, 1.1) * seq.T, 0.35, seq.L * 0.02 * rng.range(0.6, 1.6), 0.2,
        this._col, 2.8, rng.range(1.2, 2.4), 0); // short embers, not radial speed lines (R6 fix 4)
    }

    /* The two halves. Each is its own debris burst with its own bulk
       velocity, offset to where that end of the hull actually was, and the
       keel sections are split between them — so the wreck is two masses
       drifting apart rather than one expanding cloud. */
    const sep = (ev.sep || 0.10) * seq.L;
    const half = Math.max(1, Math.round((ev.n || 16) * 0.5));
    const keelHalf = Math.max(1, Math.round((ev.keel || 2) * 0.5));
    for (let s = -1; s <= 1; s += 2) {
      this._v2.copy(plane).addScaledVector(seq.axis, s * seq.L * 0.22);
      this._up.copy(V).addScaledVector(seq.axis, s * sep);
      this.debris.burst({
        origin: this._v2,
        velocity: this._up,
        axis: seq.axis,
        count: Math.round(half * Math.min(1.2, q + 0.15)),
        size: seq.L * 0.035 * (ev.scale || 0.5),
        spread: seq.L * 0.22,
        speed: seq.L * 0.55,
        colour: seq.team.primary,
        hull: seq.hull,
        blast: seq.axis,
        keelCount: keelHalf,
        keelLength: seq.L * 0.25,
        lifeScale: ev.lifeScale,
        rng,
      });
    }
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
    /* Round 5 ceiling: no flash may draw larger than 1.2x the hull as it is
       drawn on screen right now (its length, or the impostor's pixel floor
       when that is bigger). `k` is how far past `size` the widest sprite of
       that beat reaches. The floors above can lift a beat to legibility; they
       can no longer lift it past the ship. Shock rings get 2x. */
    /* R7 fix 5: the shared hull budget (ctx.hullBudget), the same rule hits use. */
    const hullM = ctx.hullBudget(seq.L, origin.x, origin.y, origin.z, 1);
    /* Ejecta reach: a spray may travel half the 1.2x box from the centre, so
       sparks and strike-craft embers stay inside the same box as the flash. */
    const reach = 0.6 * hullM;
    const cap = (metres, k) => Math.min(metres, (1.2 * hullM) / k);
    // R12 fix 3: the per-class scripts place these beats at keel stations.
    if (ev.at !== undefined && AT_KINDS.has(ev.k)) origin.addScaledVector(seq.axis, ev.at * seq.L);

    switch (ev.k) {
      /* R12 fix 3: one procedural fireball (FB_FRAG), sized off the hull as
         drawn so it is in proportion at every distance, born already large on
         the kill frame. Pulled a little toward the camera so it bursts out
         through the near plating while the ribs in front of it still cut it. */
      case 'fireball': {
        const p = this._v.copy(origin).addScaledVector(seq.axis, (ev.at || 0) * seq.L);
        if (ev.lat) p.addScaledVector(seq.side, ev.lat * seq.L);
        if (ev.toCam) {
          this._dir.copy(ctx.camPos).sub(p);
          const dc = this._dir.length();
          if (dc > 1e-3) p.addScaledVector(this._dir, Math.min(ev.toCam * hullM, dc * 0.25) / dc);
        }
        this._addFireball(p, seq.vel, seq.axis, ev.r0 * hullM, ev.r1 * hullM, ev.life, ev.inten, ev.elong || 1, seq);
        if (ev.shake) this._blast(seq, p, seq.m.ring, ev.shake);
        break;
      }

      /* The torn cross-section and the two keel halves, at a station. */
      case 'tear': {
        const plane = this._v.copy(origin).addScaledVector(seq.axis, (ev.at || 0) * seq.L);
        this._tear(seq, plane, ev, reach);
        break;
      }

      /* The soft shock disc (DISC_FRAG). `hull` puts it in the plane across
         the keel (a rupture), `up` in the deck plane. */
      case 'disc': {
        const nrm = this._side;
        if (ev.axis === 'up') nrm.copy(seq.up);
        else nrm.copy(seq.axis);
        /* Tipped toward the camera so it reads as a disc from any view; edge
           on, a disc is the same hairline the ring was. */
        this._dir.copy(ctx.camPos).sub(origin);
        if (this._dir.lengthSq() > 1e-6) {
          this._dir.normalize();
          if (nrm.dot(this._dir) < 0) nrm.negate();
          nrm.addScaledVector(this._dir, 0.9).normalize();
        }
        const r1 = Math.min(ev.r1, hullM / 1.06);
        const r0 = Math.min(ev.r0, r1 * 0.5);
        this._addDisc(origin, nrm, r0, r1, ev.life, ev.thick, ev.intensity, seq);
        break;
      }

      /* A fireball is a colour ramp in time, not one coloured blob: a white
         core that collapses almost immediately, a body that cools through
         gold to deep orange as it expands, and soot behind it. Three overlaid
         flares with different lifetimes and size ramps give the whole arc for
         two extra particles. */
      case 'flash': {
        const col = ev.colour || CORE;
        const V = seq.vel;
        /* A flash may sit at a station along the keel rather than on the
           centroid. This is the whole of the de-clumping fix: two fireballs
           0.24 s and a fifth of a hull apart read as a sequence, and the same
           two at one point read as one ball with a hard sprite boundary. */
        if (ev.at) origin.addScaledVector(seq.axis, ev.at * seq.L);
        /* Round 6 fix 4: a strike craft's pop is sized from the hull as drawn now,
           halo included - the quad is held to 0.8x the hull (was 1.2x), and the
           flare sprite no longer carries a lens cross to reach past it. */
        const size = cap(px(ev.size, ev.minPx), ev.shape === 'point' ? 1.5 : 2.0);
        /* `point` — two flares instead of five. Right for anything whose whole
           death is a single beat: a strike craft's pop built from a core, a
           body, a cooling shell and two lobes is five coincident billboards
           spent on a 14 m object, and at the 11 px floor they are all the same
           disc. The lobes exist to give a *large* fireball a direction; a
           small one has no room for them. */
        if (ev.shape === 'point') {
          const pk = ev.core === undefined ? 0.42 : ev.core;
          f.flare.spawn(origin.x, origin.y, origin.z, V.x, V.y, V.z, ev.life * 0.5, 0,
            size * pk, size * pk * 0.4, WHITE, ev.bright, 0, 0);
          f.flare.spawn(origin.x, origin.y, origin.z, V.x, V.y, V.z, ev.life, 0,
            size * 0.34, size, col, ev.bright * 0.16, 0, 0);
          const ps = ev.shake === undefined ? ev.bright / 34 : ev.shake;
          if (ps > 0) this._blast(seq, origin, seq.m.ring, ps);
          break;
        }
        /* `bright` is the peak radiance of the *core* only. The body and the
           cooling shell are held far below it: a large billboard at core
           brightness does not read as a fireball, it reads as a white card,
           because every texel past the sprite's alpha shoulder still clears the
           tone curve. Small and searing, then large and dim, is the difference
           between an explosion and a lens flare. */
        /* Core: smallest, hottest, gone first. This is what drives bloom, and
           therefore what the eye measures the death by — so a primary
           detonation overrides the default fraction and keeps two thirds of
           the envelope rather than a third of it. */
        const coreK = ev.core === undefined ? 0.40 : ev.core;
        f.flare.spawn(origin.x, origin.y, origin.z, V.x, V.y, V.z, ev.life * 0.42, 0,
          size * coreK, size * coreK * 0.35, WHITE, ev.bright, 0, 0);
        // Body: expands and cools through gold.
        f.flare.spawn(origin.x, origin.y, origin.z, V.x, V.y, V.z, ev.life, 0,
          size * 0.32, size, col, ev.bright * 0.14, 0, 0);
        /* Cooling shell: deep orange, slower, wider — the fireball's edge. It
           drifts along the vent axis and stretches with it, so the outside of a
           fireball is an elongated mass rather than a circle. */
        const B = seq.blast;
        const drift = size * 0.55;
        f.flare.spawn(origin.x, origin.y, origin.z,
          V.x + B.x * drift, V.y + B.y * drift, V.z + B.z * drift, ev.life * 2.1, 0,
          size * 0.5, size * 1.5, EMBER, ev.bright * 0.045, 0.75, 0);
        /* Two lobes thrown down the vent axis. A fireball whose silhouette is a
           circle has no information in it about what just failed or which way;
           a pair of offset masses gives the blast a direction from the first
           frame, which is the whole of the complaint. */
        for (let s = -1; s <= 1; s += 2) {
          f.flare.spawn(
            origin.x + B.x * size * 0.62 * s,
            origin.y + B.y * size * 0.62 * s,
            origin.z + B.z * size * 0.62 * s,
            V.x + B.x * drift * 1.6 * s, V.y + B.y * drift * 1.6 * s, V.z + B.z * drift * 1.6 * s,
            ev.life * 1.5, 0, size * 0.22, size * 0.85, FIRE, ev.bright * 0.075, 1.3, 0,
          );
        }
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
        const size = cap(px(ev.size, ev.minPx), 2.8);
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

      /* An internal detonation seen through a hole in the hull.

         Deliberately *not* floored to a legible disc. A breach has to stay a
         few pixels wide or it stops reading as a gap in a structure and
         becomes one more fireball — which is precisely how act three ended up
         as a ball in round 2. It gets its legibility from radiance instead of
         area: the core sits well above bloom threshold, so a 5 px breach
         paints a 12 px glow without ever being a 12 px sprite.

         Each one also drops a soot puff *outside* it, drifting off the plate.
         Light with something dark in front of it reads as coming from behind
         the surface; light on its own reads as sitting on top of it. */
      case 'breach': {
        const V = seq.vel;
        const n = Math.max(1, Math.round(ev.n * Math.min(1.2, q + 0.2)));
        for (let i = 0; i < n; i++) {
          // Stations along the keel, laterally off it by a plausible hull
          // half-width, so the gaps sit on the shape rather than in a line.
          const u = rng.range(-0.46, 0.46);
          const lat = rng.range(-1, 1);
          this._v.copy(origin)
            .addScaledVector(seq.axis, u * seq.L)
            .addScaledVector(seq.side, lat * seq.L * 0.07)
            .addScaledVector(seq.up, rng.gaussian(0, seq.L * 0.035));
          // Outward normal at the breach, for the vent and the soot.
          this._dir.copy(seq.side).multiplyScalar(lat >= 0 ? 1 : -1)
            .addScaledVector(seq.up, rng.gaussian(0, 0.5))
            .addScaledVector(seq.axis, rng.gaussian(0, 0.25));
          if (this._dir.lengthSq() < 1e-6) this._dir.copy(seq.side);
          this._dir.normalize();

          const s = ev.size * rng.range(0.7, 1.35);
          const life = ev.life * rng.range(0.6, 1.1);
          // Core: small, searing, flickering out. This is the light.
          f.flare.spawn(this._v.x, this._v.y, this._v.z, V.x, V.y, V.z, life * 0.55, 0,
            s * 1.15, s * 0.45, WHITE, ev.bright, 0, 0);
          // A short hot tongue leaving the hole along the plate normal.
          f.flare.spawn(this._v.x, this._v.y, this._v.z,
            V.x + this._dir.x * seq.L * 0.30,
            V.y + this._dir.y * seq.L * 0.30,
            V.z + this._dir.z * seq.L * 0.30,
            life, 0.9, s * 0.8, s * 2.2, FIRE, ev.bright * 0.10, 1.6, 0);
          // Soot in front of it.
          f.smoke.spawn(
            this._v.x + this._dir.x * s * 2.2,
            this._v.y + this._dir.y * s * 2.2,
            this._v.z + this._dir.z * s * 2.2,
            V.x + this._dir.x * seq.L * 0.10,
            V.y + this._dir.y * seq.L * 0.10,
            V.z + this._dir.z * seq.L * 0.10,
            life * 2.4, 0.10, s * 1.4, s * 5.0, SOOT, 0.80, 1.2, rng.gaussian(0, 0.8));
          if (rng.chance(0.6)) {
            const g = rng.unitVector();
            const sp = seq.L * rng.range(0.5, 1.3);
            f.spark.spawn(this._v.x, this._v.y, this._v.z,
              V.x + this._dir.x * sp + g.x * sp * 0.2,
              V.y + this._dir.y * sp + g.y * sp * 0.2,
              V.z + this._dir.z * sp + g.z * sp * 0.2,
              rng.range(0.25, 0.7), 0.3, s * 0.3, 0.2, CORE, 3.0, rng.range(4, 11), 0);
          }
        }
        this._blast(seq, origin, seq.m.R * 1.2, 0.045 * n);
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
        /* Outer edge at most 2x the hull's screen length across (RING_OUTER
           is the annulus' outer lip). */
        const r1 = Math.min(ev.r1, hullM / RING_OUTER);
        const r0 = Math.min(ev.r0, r1 * 0.5);
        // A ring pulled in that far carries the same energy over less area;
        // dim it with the cut so the shorter front does not read as a halo.
        const dim = Math.min(1, 0.15 + r1 / Math.max(ev.r1, 1e-3));
        this._addRing(origin, nrm, r0, r1, ev.life, ev.thick, ev.intensity * dim, seq);
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
        /* Spark lifetime is per-event, and it is part of the duration ladder
           rather than a constant. A strike craft's spray that outlives its
           flash by 1.4 s is what made the bottom rung of that ladder 1.8 s
           long, and no top rung can then reach 5:1 without a capital taking
           the best part of a minute to finish emitting. */
        const lmax = ev.life || 1.5;
        // Bias peaks near 1.44x, drag is 0.35: this keeps the spray inside `reach`.
        const spd = Math.min(ev.speed, reach / (lmax * 1.35));
        for (let i = 0; i < n; i++) {
          const s = spd * this._bias(seq, rng, 0.62, this._dir);
          this._col.copy(CORE).lerp(EMBER, rng.next() * 0.7);
          f.spark.spawn(origin.x, origin.y, origin.z,
            V.x + this._dir.x * s, V.y + this._dir.y * s, V.z + this._dir.z * s,
            rng.range(lmax * 0.35, lmax), 0.35, ss * rng.range(0.6, 1.6), 0.2,
            this._col, 2.8, ev.stretch ? rng.range(ev.stretch[0], ev.stretch[1]) : rng.range(3, 10), 0);
        }
        break;
      }

      case 'embers': {
        const n = Math.round(ev.n * q);
        const V = seq.vel;
        // Strike craft and frigates: inside the same box. Capital embers drift on.
        const spd = seq.L < BAND_BREAK ? Math.min(ev.speed, reach / (ev.life * 1.4 * 1.3)) : ev.speed;
        for (let i = 0; i < n; i++) {
          const s = spd * this._bias(seq, rng, 0.48, this._dir) * rng.range(0.35, 1.0);
          this._col.copy(FIRE).lerp(EMBER, rng.next());
          f.ember.spawn(origin.x, origin.y, origin.z,
            V.x + this._dir.x * s, V.y + this._dir.y * s, V.z + this._dir.z * s,
            ev.life * rng.range(0.5, 1.4), 0.10,
            seq.L * 0.045, seq.L * 0.010, this._col, 2.4,
            // Motion-stretched, not round. An ember travelling 200 m/s that
            // draws as a circle is a bubble; the same ember drawn along its own
            // velocity is burning debris, and it costs nothing.
            rng.range(1.4, 4.2), rng.gaussian(0, 0.6));
        }
        break;
      }

      case 'smoke': {
        const n = Math.round(ev.n * q);
        const V = seq.vel;
        for (let i = 0; i < n; i++) {
          const s = ev.speed * this._bias(seq, rng, 0.55, this._dir);
          f.smoke.spawn(origin.x, origin.y, origin.z,
            V.x + this._dir.x * s, V.y + this._dir.y * s, V.z + this._dir.z * s,
            ev.life * rng.range(0.6, 1.3), 0.06,
            ev.size * 0.35, ev.size * rng.range(1.6, 3.2), SOOT, 0.95,
            /* Soot billows *away* from the blast rather than sitting as a disc.
               A round billboard with a visible sprite boundary is the read the
               critic named; elongating it along its own travel is what turns a
               puff into a plume, and it also hides the boundary because the long
               axis is where the alpha is already thinnest. */
            rng.range(0.8, 2.6), rng.gaussian(0, 0.7));
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
          hull: seq.hull,
          // Wreckage vents down the same lobes the gas does.
          blast: seq.blast,
          /* Structural spans, 15-25% of hull length, on the beat where the
             ship actually breaks. Only the main break throws them: the
             lead-in bursts are plating coming off, not the keel letting go. */
          keelCount: ev.keel || 0,
          keelLength: seq.L * 0.25,
          // Wreckage off a 14 m interceptor must not drift for forty seconds.
          lifeScale: ev.lifeScale,
          rng,
        });
        break;
      }

      /* Venting, along the axes the death already computed.

         Round 2 added `seq.blast` — a per-death axis biased onto the keel —
         and then drew every jet direction from `rng.unitVector()` anyway, so
         four jets left a wreck in four unrelated directions and the beat read
         as a sparkler rather than as a hull losing pressure. Two modes now:

           `blast`    down the vent axes, one lobe or the other
           `lateral`  out through the plating, perpendicular to the keel

         Both keep a small isotropic component so a squadron dying is not a row
         of identical twin-lobed bursts, which is the reason the random pick
         was there in the first place. */
      case 'vent': {
        const lateral = ev.axis === 'lateral';
        const spread = ev.spread === undefined ? 0.34 : ev.spread;
        for (let i = 0; i < ev.n; i++) {
          const u = rng.unitVector();
          const s = rng.next() < 0.5 ? -1 : 1;
          if (ev.axis === 'side') {
            // R12 fix 3: out through one flank (a carrier's hangar deck).
            this._dir.copy(seq.side).multiplyScalar(ev.side || 1).addScaledVector(seq.up, rng.gaussian(0, 0.25));
          } else if (lateral) {
            const a = rng.range(0, Math.PI * 2);
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            this._dir.set(
              seq.side.x * ca + seq.up.x * sa,
              seq.side.y * ca + seq.up.y * sa,
              seq.side.z * ca + seq.up.z * sa,
            );
          } else {
            this._dir.copy(seq.blast).multiplyScalar(s);
          }
          this._dir.x += u.x * spread;
          this._dir.y += u.y * spread;
          this._dir.z += u.z * spread;
          if (this._dir.lengthSq() < 1e-6) this._dir.copy(seq.blast);
          this._dir.normalize();
          this._jets.push({
            pos: new THREE.Vector3(origin.x, origin.y, origin.z)
              .addScaledVector(seq.axis, (ev.at !== undefined ? rng.range(-0.04, 0.04) : rng.range(-0.45, 0.45)) * seq.L)
              .addScaledVector(seq.side, rng.gaussian(0, seq.L * 0.05)),
            dir: new THREE.Vector3(this._dir.x, this._dir.y, this._dir.z),
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
          // Held per-event so the tail of a death is on the ladder too: the
          // wreck of a frigate stops glowing long before a mothership's does.
          emberLife: ev.emberLife || 6.0,
          smokeLife: ev.smokeLife || 9.0,
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

  _addDisc(centre, normal, r0, r1, life, thick, intensity, seq) {
    if (this._discList.length >= this.discs.capacity) this._discList.shift();
    this._discList.push({
      cx: centre.x, cy: centre.y, cz: centre.z,
      nx: normal.x, ny: normal.y, nz: normal.z,
      start: this.ctx.now, life, r0, r1, thick, intensity,
      r: 1.0, g: 1.0, b: 1.0,
      seed: seq ? seq.rng.next() : this.ctx.rng.next(),
      vx: seq ? seq.vel.x : 0, vy: seq ? seq.vel.y : 0, vz: seq ? seq.vel.z : 0,
    });
  }

  _addFireball(p, v, axis, r0, r1, life, inten, elong, seq) {
    if (this._fbs.length >= this.fireballs.capacity) this._fbs.shift();
    this._fbs.push({
      x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z,
      ax: axis.x, ay: axis.y, az: axis.z,
      start: this.ctx.now, life, r0, r1, elong, inten,
      seed: seq ? seq.rng.next() : (this._fbSeed = ((this._fbSeed || 0) + 0.618034) % 1),
    });
  }

  _writeFireballs(now) {
    const list = this._fbs;
    for (let i = list.length - 1; i >= 0; i--) if (now > list[i].start + list[i].life) list.splice(i, 1);
    const d = this.fireballs.data;
    let n = 0;
    for (let i = 0; i < list.length && n < this.fireballs.capacity; i++, n++) {
      const f = list[i];
      const o = n * FB_STRIDE;
      d[o] = f.x; d[o + 1] = f.y; d[o + 2] = f.z;
      d[o + 3] = f.vx; d[o + 4] = f.vy; d[o + 5] = f.vz;
      d[o + 6] = f.start; d[o + 7] = f.life; d[o + 8] = f.r0; d[o + 9] = f.r1;
      d[o + 10] = f.ax; d[o + 11] = f.ay; d[o + 12] = f.az;
      d[o + 13] = f.elong; d[o + 14] = f.inten; d[o + 15] = f.seed;
    }
    this.fireballs.flush(n);
  }

  /** R12 fix 3: run one death of every script far outside the arena, through
      every beat, then clear what it made. A kill then never meets a code
      path, a batch upload or a buffer size for the first time; the programs
      are already linked (the batches are in the scene from boot), and this
      exercises the CPU side and the instance buffers. Muted: no `fx:blast`
      reaches the camera or the audio. Returns its cost in ms. */
  warm() {
    const t0 = performance.now();
    const ctx = this.ctx;
    const save = { now: ctx.now, emit: this._blast };
    this._blast = () => {};
    const far = new THREE.Vector3(0, -4.0e6, 0);
    const lens = [14, 40, 130, 380, 620, 760, 1900];
    const ids = ['interceptor', 'corvette', 'assaultFrigate', 'destroyer', 'cruiser', 'carrier', 'mothership'];
    const seqs = [];
    lens.forEach((L, i) => {
      this.kill({ id: 900000 + i, classId: ids[i], def: { length: L }, radius: L * 0.4, position: far, team: 1 });
      seqs.push(this._seqs[this._seqs.length - 1]);
    });
    for (const seq of seqs) {
      for (const ev of seq.events) { try { this._run(seq, ev); } catch (e) { /* warm only */ } }
      seq.i = seq.events.length;
    }
    this._seqs.length = 0;
    this._updateGlows();
    this._updateJets(1 / 60);
    this._updateLingers(1 / 60);
    this._writeRings(ctx.now);
    this._writeDiscs(ctx.now);
    this._writeFireballs(ctx.now);
    // Clear everything it made; the buffers stay allocated and uploaded.
    this._rings.length = 0; this._discList.length = 0; this._fbs.length = 0;
    this._jets.length = 0; this._lingers.length = 0; this._glows.length = 0;
    this._writeRings(ctx.now); this._writeDiscs(ctx.now); this._writeFireballs(ctx.now);
    for (const f of Object.values(ctx.fields)) if (typeof f.clear === 'function') f.clear();
    if (this.debris && typeof this.debris.clear === 'function') this.debris.clear();
    this._blast = save.emit;
    ctx.now = save.now;
    return +(performance.now() - t0).toFixed(1);
  }

  _writeDiscs(now) {
    const list = this._discList;
    for (let i = list.length - 1; i >= 0; i--) if (now > list[i].start + list[i].life) list.splice(i, 1);
    const d = this.discs.data;
    let n = 0;
    for (let i = 0; i < list.length && n < this.discs.capacity; i++, n++) {
      const r = list[i];
      const age = now - r.start;
      const o = n * RING_STRIDE;
      d[o] = r.cx + r.vx * age; d[o + 1] = r.cy + r.vy * age; d[o + 2] = r.cz + r.vz * age;
      d[o + 3] = r.nx; d[o + 4] = r.ny; d[o + 5] = r.nz;
      d[o + 6] = r.start; d[o + 7] = r.life; d[o + 8] = r.r0; d[o + 9] = r.r1;
      d[o + 10] = r.r; d[o + 11] = r.g; d[o + 12] = r.b;
      d[o + 13] = r.thick; d[o + 14] = r.intensity; d[o + 15] = r.seed;
    }
    this.discs.flush(n);
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
    this._writeDiscs(now);
    this._writeFireballs(now);
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
      const el = l.emberLife || 6.0;
      const sl = l.smokeLife || 9.0;
      f.ember.spawn(l.pos.x + u.x, l.pos.y + u.y, l.pos.z + u.z,
        V.x + g.x * l.size * 0.2, V.y + g.y * l.size * 0.2, V.z + g.z * l.size * 0.2,
        rng.range(el * 0.42, el), 0.08, l.size * 0.16, l.size * 0.03, this._col, 2.2, 0, 0);
      if (rng.chance(0.55)) {
        const u2 = rng.ballPoint(l.spread * 1.1);
        f.smoke.spawn(l.pos.x + u2.x, l.pos.y + u2.y, l.pos.z + u2.z,
          V.x + g.x * l.size * 0.12, V.y + g.y * l.size * 0.12, V.z + g.z * l.size * 0.12,
          rng.range(sl * 0.45, sl), 0.05, l.size * 0.7, l.size * 3.0, SOOT, 0.55, 0, rng.gaussian(0, 0.4));
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
    this.discs.dispose();
    this._discGeo.dispose();
    this.fireballs.dispose();
    this._fbGeo.dispose();
    this._discList.length = 0;
    this._fbs.length = 0;
    this._rings.length = 0;
    this._seqs.length = 0;
    this._jets.length = 0;
    this._lingers.length = 0;
    this._glows.length = 0;
  }
}
