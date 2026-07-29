/* Weapon fire: tracers, flak bursts, missiles, beams, muzzle flashes, impacts.

   One visual language per WEAPON_TYPE, because at 5 km the only information a
   player gets is colour, shape and cadence:

     kinetic  fast white-headed dart with a stretched tail — you can see it
              cross the gap, so you can read range and lead
     flak     short dart, then an orange airburst puff. Massed, it draws the
              umbrella over a capital
     missile  a physical body with a smoke ribbon that curves. Slow, seeking,
              obviously ordnance
     ion/beam a sustained lance with a white core, a coloured sheath, scrolling
              energy and a muzzle/impact bloom at both ends

   Tracers and beams both integrate their own geometry in the vertex shader, so
   400 tracers cost one buffer upload and one draw call. */

import * as THREE from '../../vendor/three/build/three.module.js';

/* ------------------------------------------------------------------ shaders */

const TRACER_STRIDE = 16;
/* 0..2 origin | 3..5 vel | 6..9 spawn,life,width,length | 10..13 rgb,bright | 14..15 head,seed */

const TRACER_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 iOrigin;
attribute vec3 iVel;
attribute vec4 iTime;
attribute vec4 iTint;
attribute vec2 iMisc;

uniform float uTime;
uniform float uPixelScale;

varying vec2 vUv;
varying vec3 vColor;
varying float vEnv;
varying float vBright;
varying float vFragW;
varying float vClamp;

void main() {
  float t = uTime - iTime.x;
  float life = max( iTime.y, 0.0001 );
  float age = clamp( t / life, 0.0, 1.0 );
  float alive = step( 0.0, t ) * step( age, 0.9999 );

  vec3 p = iOrigin + iVel * max( t, 0.0 );
  vec3 dirW = normalize( iVel );

  vec3 toCam = cameraPosition - p;
  float dist = max( length( toCam ), 1.0 );
  vec3 view = toCam / dist;
  vec3 side = cross( dirW, view );
  float sl = length( side );
  // Head-on the cross product collapses; any stable perpendicular will do,
  // the round head is all that is visible at that angle anyway.
  side = sl > 1e-4 ? side / sl : normalize( cross( dirW, vec3( 0.371, 0.664, 0.649 ) ) );

  /* Screen floor. A 0.5 m round at 4 km is a fifth of a pixel; without these
     two clamps a fleet action is an empty starfield with some noise in it. */
  float wFloor = dist * uPixelScale * 3.6;
  float width = max( iTime.z, wFloor );
  vClamp = clamp( 1.0 - iTime.z / max( width, 0.0001 ), 0.0, 1.0 );
  width *= alive;
  float len = max( iTime.w, dist * uPixelScale * 30.0 );

  vec3 wp = p - dirW * ( len * ( 1.0 - uv.y ) ) + side * ( ( uv.x - 0.5 ) * width );
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );

  vUv = uv;
  vColor = iTint.rgb;
  vBright = iTint.w;
  vEnv = alive * smoothstep( 0.0, 0.015, t ) * ( 1.0 - smoothstep( 0.88, 1.0, age ) );
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const TRACER_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

varying vec2 vUv;
varying vec3 vColor;
varying float vEnv;
varying float vBright;
varying float vFragW;
varying float vClamp;

void main() {
  #include <logdepthbuf_fragment>
  float along = vUv.y;
  float across = abs( vUv.x * 2.0 - 1.0 );
  float lat = max( 1.0 - across * across, 0.0 );

  /* Far away the round is a pixel wide, so the lateral falloff has to collapse
     into a solid bar — a soft gradient across three pixels is invisible. */
  float lateral = mix( lat, pow( lat, 0.35 ), vClamp );
  float tail = pow( along, mix( 2.8, 1.6, vClamp ) ) * lateral;
  float head = smoothstep( 0.74, 1.0, along ) * exp( -across * across * mix( 5.5, 2.2, vClamp ) );

  float a = clamp( tail * 0.55 + head * 1.35, 0.0, 1.0 ) * vEnv * fxSoftFade( vFragW );
  if ( a <= 0.004 ) discard;
  vec3 col = mix( vColor, vec3( 1.0 ), clamp( head * 1.25, 0.0, 1.0 ) )
           * vBright * uGain * ( 0.85 + 2.4 * head ) * ( 1.0 + 1.1 * vClamp );
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const BEAM_STRIDE = 16;
/* 0..2 from | 3..5 to | 6..9 start,duration,width,intensity | 10..13 rgb,seed | 14 kind | 15 pad */

/* The ion lance is the game's money shot (ARCHITECTURE §3), so it is built as
   three concentric shells rather than one ribbon:

     shell 0  halo     wide, dim, soft — the thing you see from five kilometres
     shell 1  sheath   team-coloured, carries the scrolling energy noise
     shell 2  core     near-white, thin, hard-edged — the thing that reads as
                       *hot* when the camera is 500 m away

   All three live in one base geometry, so a beam is still one instance and the
   whole batch is still one draw call. Each shell carries its own minimum pixel
   width, which is what keeps the lance legible across the whole camera range:
   at 4 km the halo is floored to 20 px and the core to 3, so the beam is a
   glowing bar with a white filament down it instead of a hairline. */

const BEAM_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute float aShell;
attribute vec3 iFrom;
attribute vec3 iTo;
attribute vec4 iTime;
attribute vec4 iTint;
attribute float iKind;

uniform float uTime;
uniform float uPixelScale;

varying vec2 vUv;
varying vec3 vColor;
varying float vEnv;
varying float vIntensity;
varying float vSeed;
varying float vKind;
varying float vShell;
varying float vFragW;
varying float vClamp;

void main() {
  float span = max( iTime.y, 0.0001 );
  float t = ( uTime - iTime.x ) / span;
  float alive = step( 0.0, t ) * step( t, 1.0 );

  /* Envelope: a fast strike-up, a long steady burn, a collapse. The width
     tracks it so the beam visibly snaps on and pinches out. */
  float charge = smoothstep( 0.0, 0.055, t );
  float decay = 1.0 - smoothstep( 0.86, 1.0, t );
  float env = charge * decay * alive;

  vec3 axis = iTo - iFrom;
  float len = length( axis );
  vec3 dirW = len > 1e-4 ? axis / len : vec3( 0.0, 0.0, 1.0 );

  // Overshoot both ends a little so the muzzle throat sits inside the barrel
  // and the impact bulb sits on the hull rather than short of it.
  float along = uv.y * 1.07 - 0.035;
  vec3 p = iFrom + dirW * ( along * len );

  vec3 toCam = cameraPosition - p;
  float dist = max( length( toCam ), 1.0 );
  vec3 side = cross( dirW, toCam / dist );
  float sl = length( side );
  side = sl > 1e-4 ? side / sl : vec3( 1.0, 0.0, 0.0 );

  float shellW = aShell < 0.5 ? 4.6 : ( aShell < 1.5 ? 1.75 : 0.52 );
  float shellPx = aShell < 0.5 ? 20.0 : ( aShell < 1.5 ? 8.0 : 3.0 );

  // Fatten toward the impact end: the beam is dumping into something.
  float belly = 1.0 + 0.55 * smoothstep( 0.55, 1.0, along ) + 0.25 * ( 1.0 - smoothstep( 0.0, 0.18, along ) );

  float natural = iTime.z * shellW * belly
                * mix( 0.18, 1.0, charge )
                * mix( 1.0, 0.10, smoothstep( 0.84, 1.0, t ) );
  float floorW = dist * uPixelScale * shellPx;
  float w = max( natural, floorW );
  vClamp = clamp( 1.0 - natural / max( w, 0.0001 ), 0.0, 1.0 );
  w *= step( 0.001, env );

  // Sub-metre instability. Enough to look like contained plasma, not enough
  // to break the "it is a straight lance" read.
  float swim = sin( along * 6.0 + uTime * 8.5 + iTint.w * 31.0 ) * 0.11
             + sin( along * 19.0 - uTime * 21.0 + iTint.w * 13.0 ) * 0.05;

  vec3 wp = p + side * ( ( uv.x - 0.5 ) * w + swim * w * 0.35 );
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );

  vUv = vec2( uv.x, along );
  vColor = iTint.rgb;
  vSeed = iTint.w;
  vKind = iKind;
  vShell = aShell;
  vIntensity = iTime.w * ( 1.0 + 3.4 * exp( -t * 34.0 ) );
  vEnv = env;
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const BEAM_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

uniform sampler2D uNoise;
uniform float uTime;

varying vec2 vUv;
varying vec3 vColor;
varying float vEnv;
varying float vIntensity;
varying float vSeed;
varying float vKind;
varying float vShell;
varying float vFragW;
varying float vClamp;

void main() {
  #include <logdepthbuf_fragment>
  float across = abs( vUv.x * 2.0 - 1.0 );
  float along = vUv.y;

  /* Two noise fields running down the beam at different speeds — the thing
     that stops it reading as a glowing tube. */
  float n1 = texture2D( uNoise, vec2( along * 2.1 - uTime * 2.9, vSeed ) ).r;
  float n2 = texture2D( uNoise, vec2( along * 6.4 + uTime * 1.7, vSeed * 0.37 + 0.21 ) ).g;
  float energy = mix( 0.72, 1.55, n1 * 0.6 + n2 * 0.4 );

  // Ends: the throat at the muzzle and the splash on the hull both run hot.
  float muzzle = pow( max( 1.0 - along * 4.0, 0.0 ), 2.0 );
  float splash = pow( max( ( along - 0.78 ) / 0.22, 0.0 ), 1.6 );
  float ends = muzzle * 1.3 + splash * 1.8;

  float shape;
  vec3 col;

  if ( vShell > 1.5 ) {
    // Core: a hard white filament. Barely modulated — this is the thing that
    // says "this is not a light, this is a hole being cut".
    shape = pow( max( 1.0 - across * across, 0.0 ), mix( 0.55, 0.22, vClamp ) );
    col = mix( vec3( 1.0 ), vColor, 0.14 ) * ( 2.6 + 5.0 * ends ) * mix( 0.92, 1.0, energy );
  } else if ( vShell > 0.5 ) {
    // Sheath: the colour, and where the plasma turbulence lives.
    shape = pow( max( 1.0 - across, 0.0 ), mix( 2.2, 1.1, vClamp ) ) * mix( 0.75, 1.25, energy );
    col = mix( vColor, vec3( 1.0 ), 0.30 ) * ( 1.5 + 3.2 * ends ) * energy;
  } else {
    // Halo: the long-range read. Soft, wide, cheap.
    shape = pow( max( 1.0 - across, 0.0 ), 2.8 ) * 0.55;
    col = vColor * ( 0.62 + 1.5 * ends );
  }

  float a = clamp( shape, 0.0, 1.0 ) * vEnv * fxSoftFade( vFragW );
  if ( a <= 0.004 ) discard;

  gl_FragColor = vec4( col * vIntensity * uGain, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const MISSILE_STRIDE = 14;
/* 0..2 pos | 3..6 quat | 7..8 lenScale,radScale | 9..11 rgb | 12 seed | 13 heat */

const QROT = /* glsl */ `
vec3 qrot( vec4 q, vec3 v ) {
  return v + 2.0 * cross( q.xyz, cross( q.xyz, v ) + q.w * v );
}
`;

const MISSILE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${QROT}

attribute vec3 iPos;
attribute vec4 iQuat;
attribute vec2 iScale;
attribute vec3 iColor;
attribute float iSeed;
attribute float iHeat;

varying vec3 vNormal;
varying vec3 vColor;
varying float vAxial;
varying float vHeat;
varying float vFragW;

void main() {
  /* Collapse the body as it approaches the lens. Without this a missile that
     flies through the camera fills the frame with a hard-edged prism — the
     silhouette of a 6 m object seen from two metres. */
  float camDist = distance( cameraPosition, iPos );
  float nearFade = smoothstep( iScale.x * 1.5, iScale.x * 9.0, camDist );

  float rad = max( iScale.y, 0.0 ) * nearFade;
  vec3 local = vec3( position.xy * rad, position.z * iScale.x * nearFade );
  vec3 wp = qrot( iQuat, local ) + iPos;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );

  vNormal = normalize( qrot( iQuat, normal ) );
  vColor = iColor;
  vAxial = uv.y;
  vHeat = iHeat;
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const MISSILE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uFill;

varying vec3 vNormal;
varying vec3 vColor;
varying float vAxial;
varying float vHeat;
varying float vFragW;

void main() {
  #include <logdepthbuf_fragment>
  float ndl = max( dot( vNormal, uKeyDir ), 0.0 );
  float wrap = max( dot( vNormal, -uKeyDir ), 0.0 );
  /* A back-lit missile must never resolve to pure black. A 6 m body passing
     close to the lens covers a third of the frame, and an unlit slab there
     reads as a rendering fault rather than ordnance. */
  vec3 col = vColor * ( uKeyColor * ( 0.10 + 0.92 * ndl ) + uFill * ( 0.30 + 0.45 * wrap ) );
  col = max( col, vColor * 0.055 );
  // Tail-end throat glow, so a missile reads as under power.
  float throat = pow( max( 1.0 - vAxial, 0.0 ), 6.0 );
  col += vec3( 1.0, 0.62, 0.30 ) * throat * 3.4 * vHeat;
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const EXHAUST_STRIDE = 8;
/* 0..2 pos | 3..5 rgb | 6 size | 7 seed */

const EXHAUST_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 iPos;
attribute vec3 iColor;
attribute float iSize;
attribute float iSeed;

uniform float uTime;
uniform float uPixelScale;

varying vec2 vUv;
varying vec3 vColor;
varying float vFragW;

void main() {
  vec4 mv = viewMatrix * vec4( iPos, 1.0 );
  float dist = max( -mv.z, 1.0 );
  float flick = 0.78 + 0.22 * sin( uTime * 47.0 + iSeed * 27.0 );
  float size = max( iSize * flick, dist * uPixelScale * 1.6 );
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vColor = iColor;
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const EXHAUST_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

uniform sampler2D uMap;

varying vec2 vUv;
varying vec3 vColor;
varying float vFragW;

void main() {
  #include <logdepthbuf_fragment>
  vec4 texel = texture2D( uMap, vUv );
  float a = texel.a * fxQuadMask( vUv ) * fxSoftFade( vFragW );
  if ( a <= 0.004 ) discard;
  gl_FragColor = vec4( vColor * texel.rgb * 2.2 * uGain, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ---------------------------------------------------------------- geometry */

function quadGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  return g;
}

/** `shells` stacked unit quads, tagged 0..n-1 on `aShell`. One draw, n layers. */
function shellQuadGeometry(shells) {
  const pos = [];
  const uvs = [];
  const tag = [];
  const idx = [];
  for (let s = 0; s < shells; s++) {
    const b = s * 4;
    pos.push(-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    tag.push(s, s, s, s);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aShell', new THREE.Float32BufferAttribute(tag, 1));
  g.setIndex(idx);
  return g;
}

/** Tapered hex body, +Z forward, unit length, unit radius. */
function missileGeometry() {
  const sides = 6;
  const rings = [
    { z: -0.5, r: 0.62 },
    { z: -0.25, r: 1.0 },
    { z: 0.22, r: 0.92 },
    { z: 0.5, r: 0.18 },
  ];
  const pos = [];
  const nrm = [];
  const uvs = [];
  const idx = [];
  for (let i = 0; i < rings.length; i++) {
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      pos.push(cx * rings[i].r, cy * rings[i].r, rings[i].z);
      nrm.push(cx, cy, 0.1);
      uvs.push(j / sides, (rings[i].z + 0.5));
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j;
      const b = a + sides + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/* ---------------------------------------------------------------- WeaponFX */

const TRACER_ATTRS = [
  { name: 'iOrigin', size: 3, offset: 0 },
  { name: 'iVel', size: 3, offset: 3 },
  { name: 'iTime', size: 4, offset: 6 },
  { name: 'iTint', size: 4, offset: 10 },
  { name: 'iMisc', size: 2, offset: 14 },
];

const BEAM_ATTRS = [
  { name: 'iFrom', size: 3, offset: 0 },
  { name: 'iTo', size: 3, offset: 3 },
  { name: 'iTime', size: 4, offset: 6 },
  { name: 'iTint', size: 4, offset: 10 },
  { name: 'iKind', size: 1, offset: 14 },
];

const MISSILE_ATTRS = [
  { name: 'iPos', size: 3, offset: 0 },
  { name: 'iQuat', size: 4, offset: 3 },
  { name: 'iScale', size: 2, offset: 7 },
  { name: 'iColor', size: 3, offset: 9 },
  { name: 'iSeed', size: 1, offset: 12 },
  { name: 'iHeat', size: 1, offset: 13 },
];

const EXHAUST_ATTRS = [
  { name: 'iPos', size: 3, offset: 0 },
  { name: 'iColor', size: 3, offset: 3 },
  { name: 'iSize', size: 1, offset: 6 },
  { name: 'iSeed', size: 1, offset: 7 },
];

const FLAK_BURST = new THREE.Color(0xffb264);
const FLAK_SMOKE = new THREE.Color(0x6b6259);
const HOT_WHITE = new THREE.Color(0xffffff);

/** Sim rate (ARCHITECTURE §0). Tracer length is quoted in sim ticks of travel. */
const SIM_HZ = 30;

export class WeaponFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.drawCalls = 4;

    this._quadGeo = quadGeometry();
    this._beamGeo = shellQuadGeometry(3);
    this._missileGeo = missileGeometry();

    this.tracers = ctx.instanceBatch({
      name: 'tracers',
      base: this._quadGeo,
      attributes: TRACER_ATTRS,
      stride: TRACER_STRIDE,
      capacity: ctx.budget.tracers,
      vertexShader: TRACER_VERT,
      fragmentShader: TRACER_FRAG,
      renderOrder: 15,
      softness: 8,
      nearFade: 14,
    });

    this.beams = ctx.instanceBatch({
      name: 'beams',
      base: this._beamGeo,
      attributes: BEAM_ATTRS,
      stride: BEAM_STRIDE,
      capacity: ctx.budget.beams,
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: { uNoise: { value: ctx.noises.curl } },
      renderOrder: 16,
      softness: 8,
      nearFade: 14,
    });

    this.missiles = ctx.instanceBatch({
      name: 'missiles',
      base: this._missileGeo,
      attributes: MISSILE_ATTRS,
      stride: MISSILE_STRIDE,
      capacity: ctx.budget.missiles,
      vertexShader: MISSILE_VERT,
      fragmentShader: MISSILE_FRAG,
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
      renderOrder: 2,
    });

    this.exhaust = ctx.instanceBatch({
      name: 'missileExhaust',
      base: this._quadGeo,
      attributes: EXHAUST_ATTRS,
      stride: EXHAUST_STRIDE,
      capacity: ctx.budget.missiles,
      vertexShader: EXHAUST_VERT,
      fragmentShader: EXHAUST_FRAG,
      uniforms: { uMap: { value: ctx.sprites.flare } },
      renderOrder: 14,
      softness: 8,
    });

    this._tracers = [];   // { slot, death, kind, x,y,z, dx,dy,dz, damage, team, colour }
    this._tracerFree = [];
    for (let i = ctx.budget.tracers - 1; i >= 0; i--) this._tracerFree.push(i);

    this._beams = [];
    this._missiles = [];

    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qi = new THREE.Quaternion();
    this._col = new THREE.Color();
    this._col2 = new THREE.Color();
    this._zAxis = new THREE.Vector3(0, 0, 1);
  }

  onKeyLight() {
    const u = this.missiles.material.uniforms;
    u.uKeyDir.value.copy(this.ctx.keyLight.dir);
    u.uKeyColor.value.copy(this.ctx.keyLight.colour);
    u.uFill.value.copy(this.ctx.fillLight);
  }

  get tracerCount() { return this._tracers.length; }
  get beamCount() { return this._beams.length; }
  get missileCount() { return this._missiles.length; }

  /* ------------------------------------------------------------------ entry */

  fire(p) {
    const w = p.weapon;
    if (!w || !p.from || !p.to) return;
    const team = this.ctx.teamColour((p.shooter && p.shooter.team) || 0);

    switch (w.type) {
      case 'ion':
      case 'beam':
        this._fireBeam(p, w, team);
        break;
      case 'missile':
        this._fireMissile(p, w, team);
        break;
      case 'flak':
        this._fireFlak(p, w, team);
        break;
      default:
        this._fireKinetic(p, w, team);
        break;
    }
  }

  /** `sim:damage` with shield:false — scorch and spall on the hull itself. */
  hullImpact(p) {
    const pt = p.point;
    if (!pt) return;
    const n = p.normal || this._v.set(0, 1, 0);
    const amount = Math.max(1, p.amount || 10);
    const mag = Math.min(6.0, 0.9 + Math.sqrt(amount) * 0.30);
    const f = this.ctx.fields;

    // White core, then an orange bloom: the difference between "hit" and
    // "nothing happened" at four kilometres.
    f.flare.spawn(pt.x, pt.y, pt.z, 0, 0, 0, 0.13, 0,
      mag * 11, mag * 2.4, HOT_WHITE, 4.2, 0, 0);
    f.flare.spawn(pt.x, pt.y, pt.z, 0, 0, 0, 0.30, 0,
      mag * 4, mag * 20, FLAK_BURST, 2.0, 0, 0);
    this._sparkBurst(pt, n, Math.round(8 + mag * 4), 0.55, 60 + amount * 0.9, mag * 2.0);

    if (amount > 25) {
      const rng = this.ctx.rng;
      for (let i = 0; i < 2; i++) {
        // No drag in vacuum: the ejecta keeps going and simply thins out.
        f.smoke.spawn(
          pt.x, pt.y, pt.z,
          n.x * 14 + rng.gaussian(0, 9), n.y * 14 + rng.gaussian(0, 9), n.z * 14 + rng.gaussian(0, 9),
          1.4 + rng.next() * 1.0, 0.12, mag * 4, mag * 20,
          FLAK_SMOKE, 0.8, 0, rng.gaussian(0, 1.2),
        );
      }
    }
  }

  detachEntity(entity) {
    if (!entity) return;
    for (let i = this._beams.length - 1; i >= 0; i--) {
      const b = this._beams[i];
      if (b.shooter === entity) this._beams.splice(i, 1);
      else if (b.target === entity) b.target = null;
    }
    for (let i = this._missiles.length - 1; i >= 0; i--) {
      const m = this._missiles[i];
      if (m.target === entity) m.target = null;
      if (m.shooter === entity) m.shooter = null;
    }
  }

  /* -------------------------------------------------------------- kinetic */

  _fireKinetic(p, w, team) {
    const from = p.from;
    const to = p.to;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.max(1, Math.hypot(dx, dy, dz));
    const speed = w.projectileSpeed || 2400;
    const life = dist / speed;

    const dmg = w.damage || 10;
    const width = Math.max(0.55, 0.28 + Math.sqrt(dmg) * 0.19);
    /* Tail length is two sim ticks of travel — the distance the round actually
       covers between frames, which is what motion blur would show. It must not
       depend on how far the target is: a shot at 3 km and a shot at 300 m are
       the same object. */
    const len = Math.max(26, speed * (2 / SIM_HZ) + dmg * 0.35);

    this._col.copy(team.trim).lerp(HOT_WHITE, 0.16);
    this._addTracer(
      from.x, from.y, from.z,
      (dx / dist) * speed, (dy / dist) * speed, (dz / dist) * speed,
      life, width, len, this._col, 2.1, 'kinetic', dmg, team,
    );
    this._muzzle(from, dx / dist, dy / dist, dz / dist, dmg, team, 1.0);
  }

  /* ------------------------------------------------------------------ flak */

  _fireFlak(p, w, team) {
    const rng = this.ctx.rng;
    const from = p.from;
    const to = p.to;
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let dz = to.z - from.z;
    const dist = Math.max(1, Math.hypot(dx, dy, dz));
    // Airburst short of the target: the puff is what kills, not the shell.
    const burst = dist * (0.80 + rng.next() * 0.16);
    const spread = (w.spread || 0.09) * 0.55;
    dx = dx / dist + rng.gaussian(0, spread);
    dy = dy / dist + rng.gaussian(0, spread);
    dz = dz / dist + rng.gaussian(0, spread);
    const l = Math.max(1e-4, Math.hypot(dx, dy, dz));
    dx /= l; dy /= l; dz /= l;

    const speed = w.projectileSpeed || 1900;
    const dmg = w.damage || 12;
    this._col.copy(team.trim).lerp(FLAK_BURST, 0.45);
    this._addTracer(
      from.x, from.y, from.z, dx * speed, dy * speed, dz * speed,
      burst / speed, 0.5, Math.max(20, speed * (1.4 / SIM_HZ)), this._col, 1.8, 'flak', dmg, team,
    );
    this._muzzle(from, dx, dy, dz, dmg, team, 0.8);
  }

  _flakBurst(x, y, z, dmg) {
    const rng = this.ctx.rng;
    const f = this.ctx.fields;
    const scale = 1.6 + Math.sqrt(dmg) * 0.34;

    f.flare.spawn(x, y, z, 0, 0, 0, 0.18, 0, 34 * scale, 7 * scale, HOT_WHITE, 5.0, 0, 0);
    f.flare.spawn(x, y, z, 0, 0, 0, 0.40, 0, 13 * scale, 48 * scale, FLAK_BURST, 2.4, 0, 0);

    const puffs = Math.round(3 + 2 * this.ctx.qscale);
    for (let i = 0; i < puffs; i++) {
      const u = rng.unitVector();
      const s = rng.range(14, 40);
      f.smoke.spawn(
        x + u.x * 3, y + u.y * 3, z + u.z * 3,
        u.x * s, u.y * s, u.z * s,
        rng.range(1.5, 2.6), 0.15,
        6 * scale, rng.range(34, 58) * scale,
        FLAK_SMOKE, 0.85, 0, rng.gaussian(0, 1.0),
      );
    }
    const sparks = Math.round((16 + dmg * 0.7) * this.ctx.qscale);
    this._col2.copy(FLAK_BURST).lerp(HOT_WHITE, 0.4);
    for (let i = 0; i < sparks; i++) {
      const u = rng.unitVector();
      const s = rng.range(60, 260);
      f.spark.spawn(
        x, y, z, u.x * s, u.y * s, u.z * s,
        rng.range(0.22, 0.55), 3.4,
        rng.range(1.4, 3.2) * scale, 0.3,
        this._col2, 2.4, rng.range(2.5, 7.0), 0,
      );
    }
  }

  /* --------------------------------------------------------------- missile */

  _fireMissile(p, w, team) {
    const ctx = this.ctx;
    if (this._missiles.length >= ctx.budget.missiles) {
      const old = this._missiles.shift();
      this._detonateMissile(old, false);
    }
    const rng = ctx.rng;
    const from = p.from;
    const to = p.to;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.max(1, Math.hypot(dx, dy, dz));
    const speed = w.projectileSpeed || 900;

    this._col.copy(team.engine).lerp(HOT_WHITE, 0.25);
    const m = {
      pos: new THREE.Vector3(from.x, from.y, from.z),
      dir: new THREE.Vector3(dx / dist, dy / dist, dz / dist),
      right: new THREE.Vector3(),
      speed: speed * 0.45,
      maxSpeed: speed,
      target: p.target || null,
      fallback: new THREE.Vector3(to.x, to.y, to.z),
      shooter: p.shooter || null,
      born: ctx.now,
      life: Math.min(9, (dist / speed) * 2.6 + 1.2),
      damage: w.damage || 20,
      seed: rng.next(),
      turn: 1.5 + rng.next() * 1.2,
      colour: new THREE.Color(this._col),
      body: new THREE.Color(0x9aa2a8),
      len: 3.4 + Math.sqrt(w.damage || 20) * 0.26,
      trail: ctx.fields.smokeTrail.acquire(0x8d8a86, 3.4, 1.5, 9),
      quat: new THREE.Quaternion(),
    };
    m.quat.setFromUnitVectors(this._zAxis, m.dir);
    this._missiles.push(m);
    this._muzzle(from, m.dir.x, m.dir.y, m.dir.z, w.damage || 20, team, 0.75);
  }

  _detonateMissile(m, hit) {
    const ctx = this.ctx;
    if (m.trail) ctx.fields.smokeTrail.detach(m.trail);
    m.trail = null;
    if (!hit) return;
    const rng = ctx.rng;
    const f = ctx.fields;
    const p = m.pos;
    const scale = 1 + Math.sqrt(m.damage) * 0.16;

    f.flare.spawn(p.x, p.y, p.z, 0, 0, 0, 0.2, 0, 34 * scale, 7 * scale, HOT_WHITE, 4.0, 0, 0);
    f.flare.spawn(p.x, p.y, p.z, 0, 0, 0, 0.5, 0, 12 * scale, 52 * scale, FLAK_BURST, 1.8, 0, 0);
    for (let i = 0; i < Math.round(4 * ctx.qscale) + 2; i++) {
      const u = rng.unitVector();
      f.smoke.spawn(
        p.x, p.y, p.z, u.x * 22, u.y * 22, u.z * 22,
        rng.range(1.8, 3.2), 1.2, 8 * scale, rng.range(48, 84) * scale,
        FLAK_SMOKE, 0.9, 0, rng.gaussian(0, 1),
      );
    }
    const sparks = Math.round((18 + m.damage * 0.35) * ctx.qscale);
    this._col2.copy(FLAK_BURST).lerp(HOT_WHITE, 0.45);
    for (let i = 0; i < sparks; i++) {
      const u = rng.unitVector();
      const s = rng.range(90, 380);
      f.spark.spawn(
        p.x, p.y, p.z, u.x * s, u.y * s, u.z * s,
        rng.range(0.3, 0.8), 3.0, rng.range(1.6, 4.0) * scale, 0.3,
        this._col2, 2.6, rng.range(3, 9), 0,
      );
    }
  }

  /* ------------------------------------------------------------------ beam */

  _fireBeam(p, w, team) {
    const ctx = this.ctx;
    if (this._beams.length >= ctx.budget.beams) this._beams.shift();

    const ion = w.type === 'ion';
    const dmg = w.damage || 100;
    this._col.copy(team.engine).lerp(HOT_WHITE, ion ? 0.16 : 0.32);

    const b = {
      shooter: p.shooter || null,
      target: p.target || null,
      from: new THREE.Vector3(p.from.x, p.from.y, p.from.z),
      to: new THREE.Vector3(p.to.x, p.to.y, p.to.z),
      localFrom: null,
      localTo: null,
      start: ctx.now,
      duration: w.beamDuration || (ion ? 1.6 : 0.7),
      /* Base radius, before the three shell multipliers (4.6 / 1.75 / 0.52).
         An ionLance at 220 damage therefore burns a ~25 m halo around a ~3 m
         white core — a lance, not a laser pointer. */
      width: (ion ? 2.2 : 1.2) + Math.sqrt(dmg) * (ion ? 0.22 : 0.13),
      intensity: ion ? 2.3 : 1.5,
      colour: new THREE.Color(this._col),
      seed: ctx.rng.next(),
      kind: ion ? 1 : 0,
      damage: dmg,
      ion,
      nextEmit: 0,
      team,
    };

    // Weld the muzzle to the hardpoint and the impact to the hull, so a two
    // second lance tracks both ships instead of hanging in space.
    if (b.shooter) {
      const sp = this._entityPos(b.shooter, this._v);
      const sq = this._entityQuat(b.shooter, this._q);
      b.localFrom = this._v2.copy(b.from).sub(sp).applyQuaternion(this._qi.copy(sq).invert()).clone();
    }
    if (b.target) {
      const tp = this._entityPos(b.target, this._v);
      const tq = this._entityQuat(b.target, this._q);
      b.localTo = this._v2.copy(b.to).sub(tp).applyQuaternion(this._qi.copy(tq).invert()).clone();
    }

    this._beams.push(b);

    /* Ignition. The muzzle has to announce itself half a second before the eye
       finds the far end of the beam, so this is deliberately over-sized: a
       white core that collapses, a coloured bloom that expands, and a cone of
       sparks blown forward out of the barrel. */
    const f = ctx.fields;
    const rng = ctx.rng;
    const scale = b.width * 4.6;
    this._v.copy(b.to).sub(b.from);
    const l = Math.max(1e-4, this._v.length());
    this._v.multiplyScalar(1 / l);
    const ax = this._v.x;
    const ay = this._v.y;
    const az = this._v.z;

    f.flare.spawn(b.from.x, b.from.y, b.from.z, 0, 0, 0, 0.32, 0,
      scale * 4.2, scale * 0.9, HOT_WHITE, 7.0, 0, 0);
    f.flare.spawn(b.from.x, b.from.y, b.from.z, 0, 0, 0, 0.62, 0,
      scale * 1.4, scale * 6.0, b.colour, 3.4, 0, 0);
    // Throat: a short hot stub pushed along the barrel line.
    f.flare.spawn(b.from.x + ax * scale, b.from.y + ay * scale, b.from.z + az * scale,
      ax * scale * 3, ay * scale * 3, az * scale * 3, 0.24, 3,
      scale * 1.8, scale * 0.4, HOT_WHITE, 5.0, 0, 0);

    const n = Math.round(14 * ctx.qscale) + 6;
    this._col2.copy(b.colour).lerp(HOT_WHITE, 0.55);
    for (let i = 0; i < n; i++) {
      const s = rng.range(160, 620);
      const j = s * 0.16;
      f.spark.spawn(b.from.x, b.from.y, b.from.z,
        ax * s + rng.gaussian(0, j), ay * s + rng.gaussian(0, j), az * s + rng.gaussian(0, j),
        rng.range(0.15, 0.42), 3.4, b.width * rng.range(0.5, 1.3), 0.2,
        this._col2, 3.0, rng.range(4, 11), 0);
    }
  }

  /* --------------------------------------------------------------- helpers */

  _entityPos(e, out) {
    const o = e.object3D ? e.object3D.position : e.position;
    return o ? out.copy(o) : out.set(0, 0, 0);
  }

  _entityQuat(e, out) {
    const q = e.object3D ? e.object3D.quaternion : e.quaternion;
    return q ? out.copy(q) : out.identity();
  }

  _addTracer(x, y, z, vx, vy, vz, life, width, len, colour, bright, kind, damage, team) {
    const slot = this._tracerFree.pop();
    if (slot === undefined) {
      // Saturated: drop the oldest so new fire always reads.
      const oldest = this._tracers.shift();
      if (oldest) this._tracerFree.push(oldest.slot);
      const again = this._tracerFree.pop();
      if (again === undefined) return;
      return this._writeTracer(again, x, y, z, vx, vy, vz, life, width, len, colour, bright, kind, damage, team);
    }
    return this._writeTracer(slot, x, y, z, vx, vy, vz, life, width, len, colour, bright, kind, damage, team);
  }

  _writeTracer(slot, x, y, z, vx, vy, vz, life, width, len, colour, bright, kind, damage, team) {
    const d = this.tracers.data;
    const o = slot * TRACER_STRIDE;
    const now = this.ctx.now;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = now; d[o + 7] = life; d[o + 8] = width; d[o + 9] = len;
    d[o + 10] = colour.r; d[o + 11] = colour.g; d[o + 12] = colour.b;
    d[o + 13] = bright;
    d[o + 14] = 1;
    d[o + 15] = slot * 0.618034 % 1;
    this._tracers.push({
      slot, death: now + life, kind, damage,
      ex: x + vx * life, ey: y + vy * life, ez: z + vz * life,
      dx: vx, dy: vy, dz: vz,
    });
  }

  _muzzle(from, dx, dy, dz, damage, team, gain) {
    const ctx = this.ctx;
    const rng = ctx.rng;
    const f = ctx.fields;
    const size = (5.0 + 4.4 * Math.sqrt(Math.max(1, damage))) * gain;

    this._col2.copy(team.trim).lerp(HOT_WHITE, 0.55);
    // Core flash, then a coloured cone blown down the barrel line.
    f.flare.spawn(from.x, from.y, from.z, 0, 0, 0, 0.085, 0,
      size, size * 0.3, HOT_WHITE, 5.0, 0, 0);
    f.flare.spawn(
      from.x + dx * size * 0.3, from.y + dy * size * 0.3, from.z + dz * size * 0.3,
      dx * 42, dy * 42, dz * 42, 0.17, 4, size * 0.8, size * 2.0, this._col2, 2.6, 0, 0,
    );
    const n = Math.max(3, Math.round(5 * ctx.qscale));
    for (let i = 0; i < n; i++) {
      const s = rng.range(90, 280) * gain;
      f.spark.spawn(
        from.x, from.y, from.z,
        dx * s + rng.gaussian(0, s * 0.22),
        dy * s + rng.gaussian(0, s * 0.22),
        dz * s + rng.gaussian(0, s * 0.22),
        rng.range(0.09, 0.24), 5.0, size * 0.18, 0.2, this._col2, 2.8, rng.range(3, 9), 0,
      );
    }
  }

  /** Sparks scattered into the hemisphere around a surface normal. */
  _sparkBurst(point, normal, count, spread, speed, size) {
    const rng = this.ctx.rng;
    const f = this.ctx.fields;
    const nx = normal.x;
    const ny = normal.y;
    const nz = normal.z;
    for (let i = 0; i < count; i++) {
      const u = rng.unitVector();
      // Push every sample onto the outward side of the surface.
      const dot = u.x * nx + u.y * ny + u.z * nz;
      const sx = u.x - (dot < 0 ? 2 * dot * nx : 0);
      const sy = u.y - (dot < 0 ? 2 * dot * ny : 0);
      const sz = u.z - (dot < 0 ? 2 * dot * nz : 0);
      const mx = nx * (1 - spread) + sx * spread;
      const my = ny * (1 - spread) + sy * spread;
      const mz = nz * (1 - spread) + sz * spread;
      const s = speed * rng.range(0.4, 1.6);
      f.spark.spawn(
        point.x, point.y, point.z, mx * s, my * s, mz * s,
        rng.range(0.18, 0.62), 3.2, size * rng.range(0.6, 1.4), 0.25,
        HOT_WHITE, 2.4, rng.range(2.5, 8.0), 0,
      );
    }
  }

  /* ----------------------------------------------------------------- update */

  update(dt, camera) {
    const ctx = this.ctx;
    const now = ctx.now;

    /* Tracers: the GPU already moved them, so all the CPU does is notice the
       ones that have arrived and hand off to an impact. */
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const t = this._tracers[i];
      if (t.death > now) continue;
      this._tracers.splice(i, 1);
      this._tracerFree.push(t.slot);
      const d = this.tracers.data;
      d[t.slot * TRACER_STRIDE + 7] = 0;
      if (t.kind === 'flak') {
        this._flakBurst(t.ex, t.ey, t.ez, t.damage);
      } else {
        const inv = 1 / Math.max(1e-4, Math.hypot(t.dx, t.dy, t.dz));
        this._v.set(-t.dx * inv, -t.dy * inv, -t.dz * inv);
        this._v2.set(t.ex, t.ey, t.ez);
        const mag = Math.min(5.0, 0.9 + Math.sqrt(t.damage) * 0.26);
        ctx.fields.flare.spawn(t.ex, t.ey, t.ez, 0, 0, 0, 0.11, 0,
          mag * 12, mag * 2.6, HOT_WHITE, 4.4, 0, 0);
        ctx.fields.flare.spawn(t.ex, t.ey, t.ez, 0, 0, 0, 0.26, 0,
          mag * 4, mag * 18, FLAK_BURST, 1.9, 0, 0);
        this._sparkBurst(this._v2, this._v, Math.round(8 + mag * 4), 0.6, 80 + t.damage * 1.2, mag * 1.9);
      }
    }
    this._writeTracerBuffer();

    /* Beams: track both endpoints, then drip muzzle bloom and impact splash. */
    const bd = this.beams.data;
    let bn = 0;
    for (let i = this._beams.length - 1; i >= 0; i--) {
      const b = this._beams[i];
      if (now > b.start + b.duration) {
        this._beams.splice(i, 1);
        continue;
      }
      if (b.shooter && b.localFrom && b.shooter.alive !== false) {
        const sp = this._entityPos(b.shooter, this._v);
        const sq = this._entityQuat(b.shooter, this._q);
        b.from.copy(b.localFrom).applyQuaternion(sq).add(sp);
      }
      if (b.target && b.localTo && b.target.alive !== false) {
        const tp = this._entityPos(b.target, this._v);
        const tq = this._entityQuat(b.target, this._q);
        b.to.copy(b.localTo).applyQuaternion(tq).add(tp);
      }
      if (now >= b.nextEmit) {
        b.nextEmit = now + (b.ion ? 0.032 : 0.05);
        this._beamSplash(b);
      }
    }
    for (let i = 0; i < this._beams.length && bn < this.beams.capacity; i++) {
      const b = this._beams[i];
      const o = bn * BEAM_STRIDE;
      bd[o] = b.from.x; bd[o + 1] = b.from.y; bd[o + 2] = b.from.z;
      bd[o + 3] = b.to.x; bd[o + 4] = b.to.y; bd[o + 5] = b.to.z;
      bd[o + 6] = b.start; bd[o + 7] = b.duration; bd[o + 8] = b.width; bd[o + 9] = b.intensity;
      bd[o + 10] = b.colour.r; bd[o + 11] = b.colour.g; bd[o + 12] = b.colour.b;
      bd[o + 13] = b.seed;
      bd[o + 14] = b.kind;
      bd[o + 15] = 0;
      bn++;
    }
    this.beams.flush(bn);

    this._updateMissiles(dt);
  }

  _writeTracerBuffer() {
    /* Slots come off a LIFO free list, so live tracers stay packed near zero.
       Draw and upload only up to the high-water mark rather than compacting —
       a dead slot is a zero-width quad and costs nothing to rasterise. */
    let hi = -1;
    for (let i = 0; i < this._tracers.length; i++) {
      if (this._tracers[i].slot > hi) hi = this._tracers[i].slot;
    }
    const n = hi + 1;
    this.tracers.geometry.instanceCount = n;
    if (n <= 0) return;
    const b = this.tracers.buffer;
    b.clearUpdateRanges();
    b.addUpdateRange(0, n * TRACER_STRIDE);
    b.needsUpdate = true;
  }

  /* Fired on a fixed cadence for the whole burn. Two seconds of ion has to look
     like two seconds of sustained work being done to a hull, not a line that
     switches on. */
  _beamSplash(b) {
    const ctx = this.ctx;
    const rng = ctx.rng;
    const f = ctx.fields;
    const t = (ctx.now - b.start) / b.duration;
    if (t > 0.94) return;
    const gain = Math.min(1, t / 0.08) * (1 - Math.max(0, (t - 0.86) / 0.14));

    // Muzzle throat, re-lit every emit so the barrel stays white for the burn.
    const ms = b.width * 7.0 * gain;
    f.flare.spawn(b.from.x, b.from.y, b.from.z, 0, 0, 0, 0.10, 0,
      ms, ms * 0.55, HOT_WHITE, 5.2, 0, 0);
    f.flare.spawn(b.from.x, b.from.y, b.from.z, 0, 0, 0, 0.22, 0,
      ms * 0.7, ms * 2.2, b.colour, 2.6, 0, 0);

    // Impact bulb: white core, coloured wash, both floored to a legible size.
    const is = b.width * 9.5 * gain;
    f.flare.spawn(b.to.x, b.to.y, b.to.z, 0, 0, 0, 0.12, 0,
      is, is * 0.45, HOT_WHITE, 6.4, 0, 0);
    f.flare.spawn(b.to.x, b.to.y, b.to.z, 0, 0, 0, 0.34, 0,
      is * 0.6, is * 3.0, b.colour, 3.0, 0, 0);

    // Back along the beam is the hull normal for a head-on cut; spall goes that
    // way, and a wide skirt of it sprays across the plating.
    this._v.copy(b.from).sub(b.to);
    const l = this._v.length();
    if (l > 1e-4) this._v.multiplyScalar(1 / l);
    else this._v.set(0, 1, 0);

    const hot = Math.round((10 + 8 * ctx.qscale) * (b.ion ? 1.6 : 1));
    this._sparkBurst(b.to, this._v, hot, 0.55,
      (220 + b.damage * 0.9) * gain, b.width * 1.5);
    // A second, flatter fan: molten metal running along the surface.
    this._sparkBurst(b.to, this._v, Math.round(hot * 0.6), 1.35,
      (110 + b.damage * 0.4) * gain, b.width * 1.1);

    for (let i = 0; i < (b.ion ? 2 : 1); i++) {
      const u = rng.unitVector();
      f.ember.spawn(
        b.to.x, b.to.y, b.to.z,
        this._v.x * 60 + u.x * 45, this._v.y * 60 + u.y * 45, this._v.z * 60 + u.z * 45,
        rng.range(0.7, 1.8), 0.25, b.width * 1.6, b.width * 0.3,
        FLAK_BURST, 2.4, 0, 0,
      );
    }
    if (rng.chance(0.6)) {
      const u = rng.unitVector();
      f.smoke.spawn(
        b.to.x, b.to.y, b.to.z,
        this._v.x * 34 + u.x * 22, this._v.y * 34 + u.y * 22, this._v.z * 34 + u.z * 22,
        1.6, 0.25, b.width * 3, b.width * 22, FLAK_SMOKE, 0.7, 0, rng.gaussian(0, 1),
      );
    }
  }

  _updateMissiles(dt) {
    const ctx = this.ctx;
    const md = this.missiles.data;
    const ed = this.exhaust.data;
    const tmpTarget = this._v;
    const tmpDesired = this._v2;
    const tmpAxis = this._v3;
    let n = 0;

    for (let i = this._missiles.length - 1; i >= 0; i--) {
      const m = this._missiles[i];
      const age = ctx.now - m.born;
      if (age > m.life) {
        this._detonateMissile(m, true);
        this._missiles.splice(i, 1);
        continue;
      }

      // Boost to cruise over the first half second, the way a launch reads.
      m.speed = Math.min(m.maxSpeed, m.speed + m.maxSpeed * 1.8 * dt);

      if (m.target && m.target.alive !== false) {
        this._entityPos(m.target, tmpTarget);
      } else {
        tmpTarget.copy(m.fallback);
      }
      tmpDesired.copy(tmpTarget).sub(m.pos);
      const range = tmpDesired.length();
      if (range > 1e-4) tmpDesired.multiplyScalar(1 / range);

      /* Wobble: a slow figure-of-eight around the seek vector. Missiles that
         fly a perfectly straight line look like tracers. */
      const wob = Math.max(0, Math.min(1, (range - 60) / 400)) * 0.16;
      // Stable perpendicular basis: cross against whichever world axis the
      // heading is least aligned with, so a straight-down-Z missile is fine.
      const ax = Math.abs(m.dir.x);
      const ay = Math.abs(m.dir.y);
      const az = Math.abs(m.dir.z);
      if (ax <= ay && ax <= az) tmpAxis.set(1, 0, 0);
      else if (ay <= az) tmpAxis.set(0, 1, 0);
      else tmpAxis.set(0, 0, 1);
      tmpAxis.crossVectors(m.dir, tmpAxis).normalize();
      m.right.crossVectors(m.dir, tmpAxis).normalize();
      const t = ctx.now + m.seed * 30;
      tmpDesired.addScaledVector(tmpAxis, Math.sin(t * 7.3) * wob);
      tmpDesired.addScaledVector(m.right, Math.cos(t * 5.1) * wob);
      tmpDesired.normalize();

      const maxTurn = m.turn * dt;
      const dot = Math.max(-1, Math.min(1, m.dir.dot(tmpDesired)));
      if (dot < -0.9999) {
        m.dir.copy(tmpAxis);
      } else {
        const angle = Math.acos(dot);
        if (angle > 1e-4) m.dir.lerp(tmpDesired, Math.min(1, maxTurn / angle)).normalize();
      }
      m.pos.addScaledVector(m.dir, m.speed * dt);
      m.quat.setFromUnitVectors(this._zAxis, m.dir);

      const hitR = m.target && m.target.alive !== false ? (m.target.radius || 10) + 4 : 8;
      if (range < hitR + m.speed * dt) {
        this._detonateMissile(m, true);
        this._missiles.splice(i, 1);
        continue;
      }

      if (m.trail) ctx.fields.smokeTrail.feed(m.trail, m.pos.x, m.pos.y, m.pos.z);

      if (n < this.missiles.capacity) {
        const o = n * MISSILE_STRIDE;
        md[o] = m.pos.x; md[o + 1] = m.pos.y; md[o + 2] = m.pos.z;
        md[o + 3] = m.quat.x; md[o + 4] = m.quat.y; md[o + 5] = m.quat.z; md[o + 6] = m.quat.w;
        md[o + 7] = m.len;
        md[o + 8] = m.len * 0.16;
        md[o + 9] = m.body.r; md[o + 10] = m.body.g; md[o + 11] = m.body.b;
        md[o + 12] = m.seed;
        md[o + 13] = 1;

        const eo = n * EXHAUST_STRIDE;
        ed[eo] = m.pos.x - m.dir.x * m.len * 0.6;
        ed[eo + 1] = m.pos.y - m.dir.y * m.len * 0.6;
        ed[eo + 2] = m.pos.z - m.dir.z * m.len * 0.6;
        ed[eo + 3] = m.colour.r; ed[eo + 4] = m.colour.g; ed[eo + 5] = m.colour.b;
        ed[eo + 6] = m.len * 1.5;
        ed[eo + 7] = m.seed;
        n++;
      }
    }

    this.missiles.flush(n);
    this.exhaust.flush(n);
  }

  dispose() {
    for (const m of this._missiles) {
      if (m.trail) this.ctx.fields.smokeTrail.detach(m.trail);
    }
    this._missiles.length = 0;
    this._beams.length = 0;
    this._tracers.length = 0;
    this.tracers.dispose();
    this.beams.dispose();
    this.missiles.dispose();
    this.exhaust.dispose();
    this._quadGeo.dispose();
    this._beamGeo.dispose();
    this._missileGeo.dispose();
  }
}
