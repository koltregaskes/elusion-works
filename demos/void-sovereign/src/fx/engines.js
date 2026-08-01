/* Thruster plumes and light trails.

   The plume is three things stacked: a hot inner shell, a soft outer shell —
   both in one geometry so the pair costs a single draw call — and a nozzle
   flare billboard that carries the read when a ship is coming straight at you.

   Trails are the Homeworld signature. A wing of interceptors crossing frame
   should leave the light-streaks before you can resolve the hulls, so they get
   their own ribbon batch with distance-priority so the ones nearest the camera
   always win the budget. */

import * as THREE from '../../vendor/three/build/three.module.js';

const QROT = /* glsl */ `
vec3 qrot( vec4 q, vec3 v ) {
  return v + 2.0 * cross( q.xyz, cross( q.xyz, v ) + q.w * v );
}
`;

/* 0..2 pos | 3..6 quat | 7..9 scale | 10..12 colour | 13..16 seed,throttle,capPx,flare */
const E_STRIDE = 17;

const PLUME_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${QROT}

attribute float aShell;
attribute vec3 iPos;
attribute vec4 iQuat;
attribute vec3 iScale;
attribute vec3 iColor;
attribute vec4 iMisc;

uniform float uTime;
uniform float uPixelScale;
uniform float uMinPixels;

varying vec2 vUv;
varying vec3 vColor;
varying float vShell;
varying float vFacing;
varying float vThrottle;
varying float vSeed;
varying float vFragW;
varying float vClamp;
varying float vSpread;

void main() {
  /* Screen floor on the plume radius, under a **per-class ceiling**.

     The floor exists because an interceptor nozzle is 0.64 m across, which at
     three kilometres is a fifth of a pixel — a whole fighter wing under full
     burn would show nothing at all. But a floor alone is a levelling device:
     it lifts every drive in the fleet to exactly the same number of pixels, so
     at 560 hulls a 14 m interceptor and a 130 m ion frigate painted the
     identical mark and the fleet read as ~250 clone teardrops with no
     silhouette anywhere in frame (§3.1, §3.4).

     iMisc.z carries the ceiling in pixels, derived on the CPU from hull
     length. Whichever of the two is smaller wins, so the floor still rescues
     the effect from invisibility but can never inflate a fighter past a couple
     of pixels. */
  vec3 scale = iScale;
  float camDist = max( distance( cameraPosition, iPos ), 1.0 );
  float floorR = camDist * uPixelScale * min( uMinPixels, iMisc.z );
  float k = max( 1.0, floorR / max( scale.x, 0.0001 ) );
  vClamp = clamp( 1.0 - 1.0 / k, 0.0, 1.0 );
  /* Energy, not just size. A point source smeared over a minimum disc has to
     lose peak radiance or the smallest hulls end up the brightest things in a
     fleet action. Exponent well below the physical 2.0 — full inverse-square
     would take a distant fighter back to nothing. */
  vSpread = pow( clamp( 1.0 / k, 0.03, 1.0 ), 0.52 );
  scale.xy *= k;
  // Was 0.35: with the ceiling in place the cone no longer needs as much
  // length compensation, and less of it keeps a fighter's plume short.
  scale.z *= mix( 1.0, k, 0.22 );

  vec3 local = position * scale;
  vec3 wp = qrot( iQuat, local ) + iPos;

  vec3 n = qrot( iQuat, normalize( normal / max( scale, vec3( 0.0001 ) ) ) );
  vec3 toCam = normalize( cameraPosition - wp );

  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );

  vUv = uv;
  vColor = iColor;
  vShell = aShell;
  vFacing = abs( dot( n, toCam ) );
  vThrottle = iMisc.y;
  vSeed = iMisc.x;
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const PLUME_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

uniform sampler2D uNoise;
uniform float uTime;
uniform vec3 uHot;

varying vec2 vUv;
varying vec3 vColor;
varying float vShell;
varying float vFacing;
varying float vThrottle;
varying float vSeed;
varying float vFragW;
varying float vClamp;
varying float vSpread;

void main() {
  #include <logdepthbuf_fragment>
  float t = vUv.y;

  /* Turbulence: two noise taps scrolling at different rates down the plume,
     plus a fast flicker. Steady enough to read as thrust, unsteady enough to
     never look like a cone of plastic. */
  float n1 = texture2D( uNoise, vec2( vUv.x * 1.6 + vSeed, t * 1.1 - uTime * 1.9 ) ).r;
  float n2 = texture2D( uNoise, vec2( vUv.x * 3.1 - vSeed * 2.0, t * 2.3 - uTime * 3.4 ) ).g;
  float turb = mix( 0.66, 1.34, n1 * 0.62 + n2 * 0.38 );
  float flick = 0.90 + 0.10 * sin( uTime * 41.0 + vSeed * 24.0 ) * sin( uTime * 17.3 + vSeed * 9.0 );

  float body = pow( max( 1.0 - t, 0.0 ), mix( 1.9, 1.25, vThrottle ) );
  float rim = 0.62 + 0.38 * pow( 1.0 - vFacing, 2.2 );

  float a;
  vec3 col;
  if ( vShell > 1.5 ) {
    /* The throat disc. vUv.y is the radius fraction here, not the axial one.
       Hottest in the middle of the bore and gone before the rim, so the flange
       stays hardware rather than becoming part of the flame. */
    float rr = vUv.y;
    float bore = pow( max( 1.0 - rr, 0.0 ), 1.4 );
    a = ( 0.30 + 0.70 * bore ) * ( 1.0 - smoothstep( 0.62, 1.0, rr ) )
      * mix( 0.45, 1.0, vThrottle ) * mix( 0.9, 1.1, turb ) * flick;
    col = mix( uHot, vColor, smoothstep( 0.10, 0.90, rr ) ) * ( 1.15 + 0.85 * bore );
  } else if ( vShell > 0.5 ) {
    // Inner shell: the hot choke. Short, near-white, barely turbulent.
    a = pow( max( 1.0 - t, 0.0 ), 2.4 ) * 1.35 * mix( 0.85, 1.0, flick );
    col = mix( uHot, vColor, smoothstep( 0.0, 0.48, t ) ) * 1.42;
  } else {
    a = body * rim * turb * flick * 0.55;
    col = mix( mix( uHot, vColor, 0.55 ), vColor * 0.75, smoothstep( 0.0, 0.7, t ) );
  }

  // Once the pixel floor is doing the work the cone is a smear a few pixels
  // across; concentrate it so it still reads as thrust — but scale radiance
  // back by the spread factor, or the fleet's smallest hulls burn brightest.
  a = fxSharpen( a, vClamp * 0.8 );
  col *= uGain * ( 1.0 + 1.1 * vClamp ) * vSpread;

  a *= smoothstep( 0.0, 0.02, vThrottle );
  a *= fxSoftFade( vFragW );
  if ( a <= 0.003 ) discard;
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const FLARE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${QROT}

attribute vec3 iPos;
attribute vec4 iQuat;
attribute vec3 iScale;
attribute vec3 iColor;
attribute vec4 iMisc;

uniform float uTime;
uniform float uPixelScale;
uniform float uMinPixels;

varying vec2 vUv;
varying vec3 vColor;
varying float vGain;
varying float vFragW;
varying float vClamp;
varying float vSpread;

void main() {
  vec3 axis = qrot( iQuat, vec3( 0.0, 0.0, 1.0 ) );
  vec3 wp = iPos + axis * iScale.z * 0.06;
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  float dist = max( -mv.z, 1.0 );

  float pulse = 0.92 + 0.08 * sin( uTime * 33.0 + iMisc.x * 19.0 );
  float natural = iScale.x * iMisc.w * pulse;
  /* Per-class ceiling on the screen floor (iMisc.z, pixels). Without it the
     nozzle flare is the single worst offender at fleet scale: it is a
     billboard, so the floor sets its *area*, and a 4 px floor on a 14 m hull
     that is itself only 1 px across at 16 km paints a glow eight times the
     size of the ship. The ceiling holds a fighter to ~2 px however far away it
     gets, which is what lets the silhouette outlive the glow. */
  float size = max( natural, dist * uPixelScale * min( uMinPixels, iMisc.z ) );
  vClamp = clamp( 1.0 - natural / max( size, 0.0001 ), 0.0, 1.0 );
  /* Exponent tuned against the backdrop, not in the abstract: ENV measures the
     nebula gas around a fleet at 12-94 of 255, and SHIPS lands its impostor at
     22 shadow / 75 lit inside that range. Anything brighter than the top of the
     band wins against the hull whatever size it is, so a heavily floored drive
     has to come down in radiance as well as in area. */
  vSpread = pow( clamp( natural / max( size, 0.0001 ), 0.03, 1.0 ), 0.52 );

  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;

  vUv = uv;
  vColor = iColor;
  // Facing the nozzle straight-on is where the flare should dominate.
  vGain = mix( 0.45, 1.0, pow( abs( dot( normalize( axis ), normalize( cameraPosition - wp ) ) ), 1.6 ) )
        * smoothstep( 0.0, 0.02, iMisc.y );
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const FLARE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

uniform sampler2D uMap;

varying vec2 vUv;
varying vec3 vColor;
varying float vGain;
varying float vFragW;
varying float vClamp;
varying float vSpread;

void main() {
  #include <logdepthbuf_fragment>
  vec4 texel = texture2D( uMap, vUv );
  float a = fxSharpen( texel.a, vClamp ) * fxQuadMask( vUv ) * vGain * fxSoftFade( vFragW );
  if ( a <= 0.003 ) discard;
  /* Mostly team colour with a white-hot centre, not the other way round: the
     drive is the strongest colour signal a ship gives at range (§3.3). */
  vec3 hot = mix( vColor, vec3( 1.0 ), 0.16 + 0.55 * pow( texel.a, 3.0 ) );
  gl_FragColor = vec4( hot * texel.rgb * 2.1 * uGain * ( 1.0 + 0.75 * vClamp ) * vSpread, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* Two concentric shells plus a throat disc, along +Z, mouth at z=0, tip at
   z=1, nominal radius 1.

   Two things about the profile matter, and both were wrong against the
   mothership's corrected bell:

   1. It is **necked at the mouth**. A cone that is widest exactly at z=0 has to
      be as wide as the bell to be visible at all, and anything that reads as
      thrust then overhangs the lip flange — fire round the outside of the
      nozzle rather than out of it. Starting at 62% and opening to full a short
      way aft puts the widest point clear of the hardware and gives the plume a
      throat, which is also what a real nozzle does once the flow is free.
   2. Ring spacing is **biased toward the mouth**, because that is where all the
      shape is. Eight evenly-spaced rings put one lonely vertex ring inside the
      whole neck.

   The throat disc is the third piece and it is the one that fixes the bell
   read from astern: a cone is a surface, so end-on you look straight down the
   bore and out the far side, and a mothership at station keeping showed eight
   bright rims round eight black holes. A flat lit disc at the mouth plane
   fills the bore and foreshortens away as the view goes tangential, which is
   exactly how a bore behaves. */
function buildPlumeGeometry(radial = 12, rings = 10) {
  const pos = [];
  const nrm = [];
  const uvs = [];
  const shell = [];
  const idx = [];
  const shells = [
    // exp drives the taper. Below ~0.7 the cone holds most of its width for
    // half its length and a capital's mains read as parallel searchlights.
    { r: 1.0, exp: 0.76, neck: 0.62, tag: 0 },
    { r: 0.46, exp: 0.98, neck: 0.70, tag: 1 },
  ];
  const smooth01 = (x) => {
    const c = x < 0 ? 0 : x > 1 ? 1 : x;
    return c * c * (3 - 2 * c);
  };
  let base = 0;
  for (const s of shells) {
    for (let i = 0; i <= rings; i++) {
      const t = Math.pow(i / rings, 1.25);
      const neck = s.neck + (1 - s.neck) * smooth01(t / 0.20);
      const r = s.r * neck * Math.pow(Math.max(0, 1 - t), s.exp);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        pos.push(cx * r, cy * r, t);
        nrm.push(cx, cy, 0.35);
        uvs.push(j / radial, t);
        shell.push(s.tag);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * (radial + 1) + j;
        const b = a + radial + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    base = pos.length / 3;
  }

  // Throat disc, tagged 2. uv.y is the radius fraction here, not the axial
  // one; the fragment stage branches on aShell and reads it that way.
  /* Held under the lip flange's inner radius (0.9 of the bell) for every
     throttle: the disc sits exactly on the mouth plane, and the flange's rear
     face is the same plane, so any overlap is coplanar and would z-fight. */
  const discR = 0.70;
  pos.push(0, 0, 0);
  nrm.push(0, 0, -1);
  uvs.push(0, 0);
  shell.push(2);
  for (let j = 0; j <= radial; j++) {
    const a = (j / radial) * Math.PI * 2;
    pos.push(Math.cos(a) * discR, Math.sin(a) * discR, 0);
    nrm.push(0, 0, -1);
    uvs.push(j / radial, 1);
    shell.push(2);
  }
  for (let j = 0; j < radial; j++) idx.push(base, base + 1 + j, base + 2 + j);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aShell', new THREE.Float32BufferAttribute(shell, 1));
  g.setIndex(idx);
  return g;
}

function quadGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  return g;
}

const PLUME_ATTRS = [
  { name: 'iPos', size: 3, offset: 0 },
  { name: 'iQuat', size: 4, offset: 3 },
  { name: 'iScale', size: 3, offset: 7 },
  { name: 'iColor', size: 3, offset: 10 },
  { name: 'iMisc', size: 4, offset: 13 },
];

/* ------------------------------------------------------------ running lights
   `buildShipModel()` hands back a `lights[]` array per the §2 contract and
   nothing was consuming it. They matter: a row of navigation lights at fixed
   spacing along a hull is the cheapest and strongest scale cue there is
   (§3.4). Twenty-four of them down a 1,900 m mothership say "this thing is
   enormous" before any greeble resolves; two on a 14 m interceptor say the
   opposite. They carry a screen floor so they survive at strategic range,
   which is exactly where the scale read matters most. */

const L_STRIDE = 12;
/* 0..2 pos | 3..5 rgb | 6 size | 7 phase | 8 period | 9 seed | 10 capPx | 11 pad */

const LIGHT_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 iPos;
attribute vec3 iColor;
attribute float iSize;
attribute float iPhase;
attribute float iPeriod;
attribute float iSeed;
attribute float iCap;

uniform float uTime;
uniform float uPixelScale;
uniform float uMinPixels;

varying vec2 vUv;
varying vec3 vColor;
varying float vGain;
varying float vFragW;

void main() {
  vec4 mv = viewMatrix * vec4( iPos, 1.0 );
  float dist = max( -mv.z, 1.0 );

  // period 0 => steady. Otherwise a short bright pulse, not a square wave.
  float blink = 1.0;
  if ( iPeriod > 0.001 ) {
    float ph = fract( ( uTime + iPhase ) / iPeriod );
    blink = 0.12 + 0.88 * exp( -ph * 7.0 ) + 0.35 * exp( -abs( ph - 0.5 ) * 26.0 );
  }

  /* Same per-class ceiling as the plume. Lamp *spacing* down a capital is the
     scale cue these exist for, so the floor has to hold for a mothership — but
     a 14 m interceptor carrying 2.2 px lamps at 16 km, where its whole hull is
     one pixel, is the scale cue running backwards. */
  float floorPx = min( uMinPixels, iCap );
  float natural = iSize;
  float size = max( natural, dist * uPixelScale * floorPx );
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;

  vUv = uv;
  vColor = iColor;
  vGain = blink * pow( clamp( natural / max( size, 0.0001 ), 0.06, 1.0 ), 0.30 );
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const LIGHT_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

varying vec2 vUv;
varying vec3 vColor;
varying float vGain;
varying float vFragW;

void main() {
  #include <logdepthbuf_fragment>
  vec2 d = vUv * 2.0 - 1.0;
  float r2 = dot( d, d );
  if ( r2 > 1.0 ) discard;
  float core = exp( -r2 * 12.0 );
  float halo = pow( max( 1.0 - sqrt( r2 ), 0.0 ), 2.2 ) * 0.30;
  float a = ( core + halo ) * vGain * fxSoftFade( vFragW );
  if ( a <= 0.004 ) discard;
  /* Radiance is held just clear of the glow layer's 0.6 cut, not far above it.
     These are two-pixel dots at strategic range: at the radiance they used to
     carry, the bloom bled each lamp into its neighbours and a 70 m strake of
     86 lamps down a mothership resolved into one continuous white bar — which
     destroys the countable-spacing scale cue they exist to give (§3.4). */
  gl_FragColor = vec4( mix( vColor, vec3( 1.0 ), core * 0.45 ) * ( 0.80 + 1.30 * core ) * uGain, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const LIGHT_ATTRS = [
  { name: 'iPos', size: 3, offset: 0 },
  { name: 'iColor', size: 3, offset: 3 },
  { name: 'iSize', size: 1, offset: 6 },
  { name: 'iPhase', size: 1, offset: 7 },
  { name: 'iPeriod', size: 1, offset: 8 },
  { name: 'iSeed', size: 1, offset: 9 },
  { name: 'iCap', size: 1, offset: 10 },
];

/* `hulls.js` sizes the strake pitch so a capital reads as a countable row of
   lamps at 20 km; cutting the pass at 16 km threw that away 4 km short of the
   distance it was built for. The batch is one draw call with a hard instance
   cap, so the reach costs fill rate on two-pixel quads and nothing else. */
const LIGHT_RANGE = 26000;

const TRAIL_RANGE = 9000;

/* Station-keeping glow floor. Small enough to read as "hot, idle", large
   enough that a parked mothership is not twelve dead holes. */
const IDLE_THROTTLE = 0.14;

/* Per-class screen ceiling for the drive glow, in pixels, from hull length.

   The pixel *floor* is what makes a distant effect legible; this is the
   companion ceiling that stops the floor levelling the fleet. Anchored so a
   14 m interceptor tops out at 2 px — beyond about 8 km the hull itself is
   under 2 px, so the glow stays the same order as the thing emitting it —
   and rising sub-linearly to ~14 px for a 1,900 m mothership, whose flare is
   carried by its own physical size long before the floor is in play.

     interceptor  14 m -> 2.0 px      frigate  130 m -> 4.9 px
     corvette     34 m -> 2.9 px      destroyer 380 m -> 7.5 px
     collector    46 m -> 3.2 px      mothership 1900 m -> 14.3 px */
function ceilingPixels(L) {
  return Math.min(16, Math.max(1.5, 2.0 * Math.pow(Math.max(L, 4) / 14, 0.40)));
}

/* Plume length and flare radius scale with the *bell*, and bells run roughly
   as L^0.8 — so a 130 m frigate's plume was only 5.9x an interceptor's when
   the hull is 9.3x longer. This closes the gap without touching the bell
   geometry, which the mothership's corrected lip flange depends on. Normalised
   at frigate scale and clamped at both ends so a capital does not grow a
   kilometre-long tail. */
function lengthGain(L) {
  return Math.min(1.55, Math.max(0.62, Math.pow(Math.max(L, 4) / 130, 0.22)));
}

export class EngineFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.drawCalls = 3;
    this._entries = new Map();

    this._plumeGeo = buildPlumeGeometry(12, 10);
    this._quadGeo = quadGeometry();

    this.core = ctx.instanceBatch({
      name: 'plume',
      base: this._plumeGeo,
      attributes: PLUME_ATTRS,
      stride: E_STRIDE,
      capacity: ctx.budget.plumes,
      vertexShader: PLUME_VERT,
      fragmentShader: PLUME_FRAG,
      uniforms: {
        uNoise: { value: ctx.noises.fbm },
        uHot: { value: new THREE.Color(0xdff2ff) },
        uMinPixels: { value: 2.6 },
      },
      renderOrder: 10,
      softness: 16,
    });

    this.flare = ctx.instanceBatch({
      name: 'plumeFlare',
      base: this._quadGeo,
      attributes: PLUME_ATTRS,
      stride: E_STRIDE,
      capacity: ctx.budget.plumes,
      vertexShader: FLARE_VERT,
      fragmentShader: FLARE_FRAG,
      uniforms: {
        uMap: { value: ctx.sprites.flare },
        uMinPixels: { value: 4.0 },
      },
      renderOrder: 11,
      softness: 12,
    });

    this.lights = ctx.instanceBatch({
      name: 'runningLights',
      base: this._quadGeo,
      attributes: LIGHT_ATTRS,
      stride: L_STRIDE,
      capacity: ctx.budget.lights,
      vertexShader: LIGHT_VERT,
      fragmentShader: LIGHT_FRAG,
      // A lamp needs to be a dot, not a spike: under ~2 px the bloom sees a
      // point source and smears it wider than the gap to the next lamp.
      uniforms: { uMinPixels: { value: 2.2 } },
      renderOrder: 12,
      softness: 6,
      nearFade: 8,
    });

    this.plumeCount = 0;
    this.lightCount = 0;
    this._lightCursor = 0;

    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._zAxis = new THREE.Vector3(0, 0, 1);
  }

  attach(entity, engineDefs) {
    if (!entity || !engineDefs || !engineDefs.length) return;
    const existing = this._entries.get(entity.id);
    if (existing) existing.entity = entity;

    const defs = [];
    for (const d of engineDefs) {
      if (!d || !d.pos) continue;
      const dir = d.dir ? new THREE.Vector3(d.dir.x, d.dir.y, d.dir.z) : new THREE.Vector3(0, 0, -1);
      if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
      dir.normalize();
      defs.push({
        pos: new THREE.Vector3(d.pos.x, d.pos.y, d.pos.z),
        dir,
        // Local +Z -> exhaust direction. Constant per hull, so bake it once.
        quat: new THREE.Quaternion().setFromUnitVectors(this._zAxis, dir),
        radius: d.radius > 0 ? d.radius : 1,
      });
    }
    if (!defs.length) return;

    const def = entity.def || {};
    const entry = existing || {
      entity,
      defs,
      trail: null,
      trailUrge: 0,
      seed: (entity.id * 0.6180339887) % 1,
      /* Fast movers streak; capitals never do. Corvettes and up read as mass
         moving, and a light-trail on a 380 m destroyer looks like a toy. */
      wantsTrail: (def.speed || 0) >= 220 && (def.length || 0) <= 60,
      centre: new THREE.Vector3(),
    };
    entry.defs = defs;
    entry.centre.set(0, 0, 0);
    for (const d of defs) entry.centre.add(d.pos);
    entry.centre.multiplyScalar(1 / defs.length);
    entry.lights = this._readLights(entity);

    /* Hull length drives both halves of the scale cue, so resolve it once per
       attach rather than per nozzle per frame. */
    const L = def.length || (entity.radius || 10) * 2.2;
    entry.L = L;
    entry.gain = lengthGain(L);
    const capPx = ceilingPixels(L);
    entry.flareCapPx = capPx;
    /* The cone is a solid, and its ceiling is a *radius* where the flare's is
       a full quad width, so the same number draws twice as wide. Half it, and
       the two effects cover the same span: an interceptor's drive is then
       about 2 px across at any range, against the 2.3 px hull that SHIPS
       floors its impostor to. */
    entry.plumeCapPx = capPx * 0.5;
    this._entries.set(entity.id, entry);
  }

  /** Running lights, per the `buildShipModel()` contract. Cheap if absent. */
  _readLights(entity) {
    const src = entity._lights
      || entity.lights
      || (entity.model && entity.model.lights)
      || (entity.object3D && entity.object3D.userData && entity.object3D.userData.lights);
    if (!Array.isArray(src) || !src.length) return null;

    const def = entity.def || {};
    const L = def.length || (entity.radius || 10) * 2.2;
    // Fixture size tracks hull size but sub-linearly: a mothership's lamps are
    // bigger than a fighter's, not 135x bigger, which is what sells the scale.
    const size = Math.min(4.2, Math.max(0.22, Math.pow(L, 0.62) * 0.055));
    // Lamps sit well under the drive glow's ceiling: they are navigation
    // fixtures, not emitters, and at fleet range a fighter should not carry
    // two-pixel lamps on a one-pixel hull.
    const capPx = ceilingPixels(L) * 0.45;
    const out = [];
    /* Take every lamp up to a generous cap. Running-light *spacing* is the
       scale cue (§3.4) — 86 lamps at 70 m pitch is what says "1.9 km" — so
       thinning them out is thinning out the thing they are there to do. The
       per-frame cost is bounded by the batch budget and the distance gate
       instead. */
    const step = Math.max(1, Math.ceil(src.length / 96));
    for (let i = 0; i < src.length; i += step) {
      const l = src[i];
      if (!l || !l.pos) continue;
      const c = l.colour || l.color;
      out.push({
        pos: new THREE.Vector3(l.pos.x, l.pos.y, l.pos.z),
        r: c ? c.r : 1, g: c ? c.g : 0.86, b: c ? c.b : 0.72,
        size,
        capPx,
        period: l.period > 0 ? l.period : 0,
        phase: ((entity.id * 0.6180339887 + i * 0.2393) % 1) * (l.period > 0 ? l.period : 1),
        seed: (i * 0.618034) % 1,
      });
    }
    return out.length ? out : null;
  }

  detach(entity) {
    if (!entity) return;
    const e = this._entries.get(entity.id);
    if (!e) return;
    if (e.trail) this.ctx.fields.trail.detach(e.trail);
    this._entries.delete(entity.id);
  }

  update(dt, camera) {
    const ctx = this.ctx;
    const core = this.core;
    const flare = this.flare;
    const cd = core.data;
    const fd = flare.data;
    const cap = ctx.budget.plumes;
    const q = this._q;
    const v = this._v;
    const centre = this._v2;
    const camPos = camera.position;
    const trails = ctx.fields.trail;

    const ld = this.lights.data;
    const lcap = ctx.budget.lights;
    let ln = 0;

    let n = 0;
    for (const entry of this._entries.values()) {
      const e = entry.entity;
      if (!e || e.alive === false) continue;
      const obj = e.object3D;
      const op = obj ? obj.position : e.position;
      const oq = obj ? obj.quaternion : e.quaternion;
      if (!op) continue;
      const scale = obj && obj.scale ? obj.scale.x : 1;

      const dx = op.x - camPos.x;
      const dy = op.y - camPos.y;
      const dz = op.z - camPos.z;
      const dist2 = dx * dx + dy * dy + dz * dz;

      if (entry.lights && ln < lcap && dist2 < LIGHT_RANGE * LIGHT_RANGE) {
        const ls = entry.lights;
        for (let i = 0; i < ls.length && ln < lcap; i++) {
          const l = ls[i];
          v.copy(l.pos).multiplyScalar(scale).applyQuaternion(oq).add(op);
          const o = ln * L_STRIDE;
          ld[o] = v.x; ld[o + 1] = v.y; ld[o + 2] = v.z;
          ld[o + 3] = l.r; ld[o + 4] = l.g; ld[o + 5] = l.b;
          ld[o + 6] = l.size * scale;
          ld[o + 7] = l.phase;
          ld[o + 8] = l.period;
          ld[o + 9] = l.seed;
          ld[o + 10] = l.capPx;
          ln++;
        }
      }

      /* Idle burn. A ship at station keeping still has hot bells — reactors do
         not switch off — and a fleet parked at zero throttle with dead engines
         is the single most lifeless thing this renderer can produce. The floor
         is enough to light the nozzle and put a stub of plume behind it. */
      const raw = Math.max(0, Math.min(1, e.throttle === undefined ? 1 : e.throttle));
      const throttle = Math.max(IDLE_THROTTLE, raw);
      const team = ctx.teamColour(e.team || 0);

      /* Trail bookkeeping. Distance-gated so the ribbon budget is spent on the
         fighters the camera can actually see streak. */
      if (entry.wantsTrail) {
        const want = raw > 0.12 && dist2 < TRAIL_RANGE * TRAIL_RANGE;
        if (want && !entry.trail) {
          /* Per-ship jitter. A wing flying formation with identical trails
             reads as one emitter's pattern rather than six pilots; ±25% on
             width and life is enough to break that up. */
          const j = 0.75 + 0.5 * entry.seed;
          const r = Math.max(2.0, Math.min(16, (e.radius || 8) * 0.44 * j));
          const life = (0.42 + 0.28 * ctx.qscale) * j;
          entry.trail = trails.acquire(team.engine, r, life, Math.max(5, r * 2.4));
        } else if (!want && entry.trail) {
          trails.detach(entry.trail);
          entry.trail = null;
        }
        if (entry.trail) {
          centre.copy(entry.centre).multiplyScalar(scale).applyQuaternion(oq).add(op);
          trails.feed(entry.trail, centre.x, centre.y, centre.z);
        }
      }

      // Beyond ~20 km a plume is a pixel; drop the geometry, keep the flare.
      const far = dist2 > 20000 * 20000;

      for (let i = 0; i < entry.defs.length; i++) {
        if (n >= cap) break;
        const d = entry.defs[i];
        v.copy(d.pos).multiplyScalar(scale).applyQuaternion(oq).add(op);
        q.copy(d.quat).premultiply(oq);

        const r = d.radius * scale;
        /* A fighter at full burn trails roughly its own length of flame; a
           capital's block runs proportionally further because its bells are
           proportionally larger. One formula covers a 45x span of nozzle size.

           `entry.gain` is the correction for bells running as L^0.8 rather
           than L: without it a 130 m frigate's plume was only 5.9x an
           interceptor's, against a 9.3x difference in hull length, and once
           the screen floor levelled what was left the two classes painted the
           same mark at fleet range. */
        const len = r * (3.0 + 22.0 * throttle) * entry.gain;
        /* Nominal radius, not the widest point: the necked profile peaks at
           0.87 of this a fifth of the way aft. Full burn therefore tops out at
           1.04 bell radii, just inside the 1.12 lip flange, so the plume fills
           the mouth without ever spilling round the outside of the hardware.
           The old 1.22 at full throttle overhung the flange by 9%, which read
           as fire leaking round the nozzle rather than leaving it. */
        const wid = r * (0.95 + 0.25 * throttle);
        const seed = (entry.seed + i * 0.317) % 1;

        const o = n * E_STRIDE;
        cd[o] = v.x; cd[o + 1] = v.y; cd[o + 2] = v.z;
        cd[o + 3] = q.x; cd[o + 4] = q.y; cd[o + 5] = q.z; cd[o + 6] = q.w;
        cd[o + 7] = far ? 0 : wid;
        cd[o + 8] = far ? 0 : wid;
        cd[o + 9] = far ? 0 : len;
        cd[o + 10] = team.engine.r; cd[o + 11] = team.engine.g; cd[o + 12] = team.engine.b;
        cd[o + 13] = seed;
        cd[o + 14] = throttle;
        cd[o + 15] = entry.plumeCapPx;
        cd[o + 16] = 0;

        for (let k = 0; k < E_STRIDE; k++) fd[o + k] = cd[o + k];
        // Trimmed now the throat disc carries the bore: the flare is the halo
        // around a lit nozzle, not the only thing lighting it.
        fd[o + 7] = r * (1.9 + 1.7 * throttle) * entry.gain;
        fd[o + 8] = fd[o + 7];
        fd[o + 9] = len;
        fd[o + 15] = entry.flareCapPx;
        fd[o + 16] = 1;
        n++;
      }
    }

    this.plumeCount = n;
    this.lightCount = ln;
    core.flush(n);
    flare.flush(n);
    this.lights.flush(ln);
  }

  dispose() {
    this.core.dispose();
    this.flare.dispose();
    this.lights.dispose();
    this._plumeGeo.dispose();
    this._quadGeo.dispose();
    this._entries.clear();
  }
}
