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
import { bus } from '../core/events.js';
import { hullFloorPx } from '../ships/catalog.js';

/* ------------------------------------------------------------------ shaders */

const TRACER_STRIDE = 16;
/* 0..2 origin | 3..5 vel | 6..9 spawn,life,width,length | 10..13 rgb,bright | 14..15 head,seed */

/* A round is a bead and a wake, not a strip. (Critic round 3, fix 3.)

   The previous build drew each round as two stacked full-length strips, a
   wide team-coloured halo over a thin white filament, both floored to a few
   pixels. At play distance the floors won along the whole length, so every
   round was a strip of near-constant width and value: a drawn line. And
   because rounds were drawn for every shot, a gun firing ten or fifty a
   second laid its dashes end to end into one unbroken hairline from muzzle
   to target, which is exactly what an order line looks like.

   Now the two shells do different jobs:

     shell 0  wake   a short ribbon BEHIND the round, team tint held pale,
                     widest at the round and pinched to nothing at the tail,
                     with its opacity falling off steeply, so most of its
                     length is near-black. Length conveys speed, the fade
                     conveys direction.
     shell 1  bead   a screen-facing round head at the projectile itself,
                     white-hot in the middle with a tinted rim. It has its own
                     pixel floor, so at four kilometres a round is still a
                     bright dot with a smear behind it instead of a hairline.

   The wake grows out of the muzzle rather than appearing at full length
   behind the gun, and the CPU side caps how many rounds per second each
   shooter may draw (see TRACER_RATE), so a stream reads as beads with gaps.
   Still one instance per round and one draw call for the batch.
   (No backticks in this comment on purpose: it sits directly above a GLSL
   template literal, and a stray one here is the project's most expensive
   recurring bug, see HANDOFF section 5.) */
const TRACER_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute float aShell;
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
varying float vShell;
varying float vSpread;

void main() {
  float t = uTime - iTime.x;
  float life = max( iTime.y, 0.0001 );
  float age = clamp( t / life, 0.0, 1.0 );
  float alive = step( 0.0, t ) * step( age, 0.9999 );
  float tt = max( t, 0.0 );

  float speed = max( length( iVel ), 0.001 );
  vec3 dirW = iVel / speed;
  vec3 p = iOrigin + iVel * tt;

  vec3 toCam = cameraPosition - p;
  float dist = max( length( toCam ), 1.0 );
  vec3 view = toCam / dist;
  vec3 side = cross( dirW, view );
  float sl = length( side );
  // Head-on the cross product collapses; any stable perpendicular will do,
  // only the bead is visible at that angle anyway.
  side = sl > 1e-4 ? side / sl : normalize( cross( dirW, vec3( 0.371, 0.664, 0.649 ) ) );
  // The direction of travel as the screen sees it.
  vec3 up = cross( view, side );

  float mpp = dist * uPixelScale;
  float bead = step( 0.5, aShell );
  vec3 wp;

  if ( bead > 0.5 ) {
    /* Bead: about three bores across, never under 3.6 px, slightly long in
       the direction of travel so even a single still frame says which way
       it is going. */
    float natural = iTime.z * 3.2;
    float s = max( natural, mpp * 3.6 );
    vClamp = clamp( 1.0 - natural / s, 0.0, 1.0 );
    vSpread = 1.0;
    s *= alive;
    wp = p + side * ( ( uv.x - 0.5 ) * s ) + up * ( ( uv.y - 0.5 ) * s * 1.45 );
  } else {
    /* Wake: never shorter than 14 px so a far shot is still a dash, never
       longer than the distance actually flown so it leaves the barrel
       rather than hanging behind the gun. */
    float len = min( max( iTime.w, mpp * 14.0 ), speed * tt + 0.001 );
    float natural = iTime.z * 1.25;
    float w = max( natural, mpp * 1.8 );
    vClamp = clamp( 1.0 - natural / w, 0.0, 1.0 );
    vSpread = pow( clamp( natural / w, 0.05, 1.0 ), 0.40 );
    // Pinched to a point at the tail, full bore at the round.
    w *= pow( uv.y, 0.85 ) * alive;
    wp = p - dirW * ( len * ( 1.0 - uv.y ) ) + side * ( ( uv.x - 0.5 ) * w );
  }

  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );

  vUv = uv;
  vShell = aShell;
  vColor = iTint.rgb;
  vBright = iTint.w;
  vEnv = alive * smoothstep( 0.0, 0.012, t ) * ( 1.0 - smoothstep( 0.90, 1.0, age ) );
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
varying float vShell;
varying float vSpread;

void main() {
  #include <logdepthbuf_fragment>
  float a;
  vec3 col;
  if ( vShell > 0.5 ) {
    /* Bead. A white-hot core inside a tinted rim, round regardless of view
       angle. The floor carries it at range, so it is lifted a little rather
       than dimmed as the floor bites: this is the one part of a round that
       has to read at four kilometres. */
    vec2 q = ( vUv - 0.5 ) * 2.0;
    float r2 = dot( q, q );
    float core = exp( -r2 * 9.0 );
    float rim = exp( -r2 * 2.6 );
    a = ( core + rim * 0.55 ) * ( 1.0 - smoothstep( 0.62, 1.0, r2 ) );
    col = mix( vColor, vec3( 1.0 ), clamp( core * 1.25, 0.0, 1.0 ) )
        * ( 1.4 + 2.6 * core ) * mix( 1.0, 1.3, vClamp );
  } else {
    /* Wake. Opacity falls off steeply from the round, so the bright part is
       the front half and the rest is a fading smear: a comet, not a rod. */
    float along = vUv.y;
    float across = abs( vUv.x * 2.0 - 1.0 );
    float lateral = pow( max( 1.0 - across * across, 0.0 ), mix( 1.2, 0.6, vClamp ) );
    float fall = along * along;
    a = lateral * fall * 0.85;
    col = vColor * ( 0.35 + 0.95 * fall ) * vSpread;
  }

  a = clamp( a, 0.0, 1.0 ) * vEnv * fxSoftFade( vFragW );
  if ( a <= 0.004 ) discard;
  gl_FragColor = vec4( col * vBright * uGain, a );
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
varying float vSpread;

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
  /* Screen floors, cut hard from 20/8/3.

     Those were tuned on a hero shot where the lance is the subject and the
     frame holds two ships. In a 560-hull fleet action the same numbers draw a
     20 px halo round an 8 px white bar across the whole frame, and the beam
     becomes the brightest object in shot by a wide margin with no muzzle, no
     impact and no falloff to place it. Legible still, but a line rather than
     a scratch. */
  float shellPx = aShell < 0.5 ? 9.0 : ( aShell < 1.5 ? 4.0 : 1.6 );

  /* Taper along the length, then bulb at the impact: the lance leaves the
     barrel at full bore, thins over the run, and fattens where it is dumping
     into a hull. A constant-width beam is a scratch on the lens. */
  float lean = mix( 1.0, 0.68, smoothstep( 0.02, 0.72, along ) );
  float belly = lean + 0.55 * smoothstep( 0.60, 1.0, along ) + 0.25 * ( 1.0 - smoothstep( 0.0, 0.18, along ) );

  float natural = iTime.z * shellW * belly
                * mix( 0.18, 1.0, charge )
                * mix( 1.0, 0.10, smoothstep( 0.84, 1.0, t ) );
  float floorW = dist * uPixelScale * shellPx;
  float w = max( natural, floorW );
  vClamp = clamp( 1.0 - natural / max( w, 0.0001 ), 0.0, 1.0 );
  // Radiance falls as the floor spreads the beam over more pixels than it
  // physically occupies, so a distant lance reads as distant.
  vSpread = pow( clamp( natural / max( w, 0.0001 ), 0.05, 1.0 ), 0.35 );
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
  /* Brightness flicker: two incommensurate rates per beam, so a lance
     breathes like contained plasma rather than holding the flat value of a
     drawn line. Fifteen per cent either way, never enough to strobe. */
  float flick = 1.0 + 0.15 * sin( uTime * 41.0 + iTint.w * 57.0 ) * sin( uTime * 17.0 + iTint.w * 23.0 );
  vIntensity = iTime.w * ( 1.0 + 1.5 * exp( -t * 34.0 ) ) * flick;
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
varying float vSpread;

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
  float ends = muzzle * 1.6 + splash * 2.2;

  /* Opacity taper. A lance is not a uniform bar: it is brightest in the throat
     and at the point of contact, and the long run between them is the dim
     part. Without this the beam is a hard-edged white scratch of constant
     value from one edge of frame to the other, with nothing to say which end
     is the gun and which is the target. */
  float taper = mix( 1.0, 0.38, smoothstep( 0.03, 0.66, along ) )
              + 0.55 * smoothstep( 0.80, 1.0, along );

  float shape;
  vec3 col;

  /* Only the core is allowed to reach white. The sheath and halo are held
     below the point where the tone curve crushes them to white, because a
     lance that saturates on every shell is just a white bar — the colour is
     what tells you whose ion frigate is firing, and it has to survive both the
     bloom and the grade. */
  if ( vShell > 1.5 ) {
    // Core: a hard white filament. This is not a light, it is a hole being cut.
    shape = pow( max( 1.0 - across * across, 0.0 ), mix( 0.55, 0.22, vClamp ) );
    col = mix( vec3( 1.0 ), vColor, 0.12 ) * ( 1.9 + 3.0 * ends ) * mix( 0.92, 1.0, energy );
  } else if ( vShell > 0.5 ) {
    // Sheath: the colour, and where the plasma turbulence lives.
    shape = pow( max( 1.0 - across, 0.0 ), mix( 2.2, 1.1, vClamp ) ) * mix( 0.75, 1.25, energy );
    col = mix( vColor, vec3( 1.0 ), 0.06 ) * ( 0.60 + 1.15 * ends ) * energy;
  } else {
    // Halo: the long-range read. Soft, wide, cheap, and firmly coloured.
    shape = pow( max( 1.0 - across, 0.0 ), 2.8 ) * 0.55;
    col = vColor * ( 0.30 + 0.62 * ends );
  }

  float a = clamp( shape * taper, 0.0, 1.0 ) * vEnv * fxSoftFade( vFragW );
  if ( a <= 0.004 ) discard;

  gl_FragColor = vec4( col * vIntensity * uGain * vSpread * taper, a );
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

/* ------------------------------------------------------------------ flashes

   A gun going off and a round landing were, until now, the *same sprite at the
   same size with the same orientation*: one 4-point diffraction star, drawn
   from `ctx.sprites.flare`, whose baked-in cross reads identically on every
   muzzle and every impact in the frame. Massed, that is the single most
   recognisable particle-system-from-a-tutorial tell in real-time graphics —
   because no two real flashes are the same shape, and a viewer who cannot say
   why still sees a repeat.

   This is a family of four, in one 2x2 atlas and therefore still one texture
   and one draw call, with per-instance rotation, spin, scale and lifetime on
   top. Muzzle and impact draw from different halves of the family with
   different size and duration distributions, so they stop being interchangeable
   even before the colour and the ejecta differ.

   Mips are deliberately off. These are 2-11 px quads with an alpha profile that
   reaches zero well inside its own cell, so nothing needs minifying — and a
   generated mip chain on an atlas smears neighbouring cells together, which is
   the same trap the dust atlas fell into (HANDOFF §5). */

const FLASH_VARIANTS = 4;

/* Per-cell shape. `spikes` are one-sided rays so an odd count reads as
   genuinely irregular rather than as a rotated even star. */
const FLASH_SHAPES = [
  // 0 · classic four-point, thin and long. Still in the family — just no
  //     longer the *only* member.
  { core: 150, halo: 5.5, haloW: 0.30, rays: [0, 90, 180, 270], len: 0.94, w: 0.028, vary: 0.10 },
  // 1 · six-point, uneven arm lengths, fat soft centre.
  { core: 90, halo: 3.4, haloW: 0.44, rays: [12, 68, 131, 190, 251, 310], len: 0.62, w: 0.021, vary: 0.42 },
  // 2 · no rays at all: a pure bloom. The one that stops a carpet of impacts
  //     reading as a field of asterisks.
  { core: 60, halo: 2.6, haloW: 0.62, rays: [], len: 0, w: 0, vary: 0 },
  // 3 · three ragged arms, off-balance — an obviously asymmetric burst.
  { core: 110, halo: 4.2, haloW: 0.34, rays: [24, 150, 265], len: 0.84, w: 0.046, vary: 0.55 },
];

function flashAtlas(size = 256) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const half = size / 2;

  for (let cell = 0; cell < FLASH_VARIANTS; cell++) {
    const s = FLASH_SHAPES[cell];
    const ox = (cell % 2) * half;
    const oy = Math.floor(cell / 2) * half;
    // Arm amplitudes are a fixed irrational walk, so the atlas is identical on
    // every machine and every seed — this is geometry, not content.
    const amp = s.rays.map((_, i) => 1 - s.vary * ((i * 0.6180339887) % 1));
    const rad = s.rays.map((d) => (d * Math.PI) / 180);

    for (let y = 0; y < half; y++) {
      const ny = (y + 0.5) / half * 2 - 1;
      for (let x = 0; x < half; x++) {
        const nx = (x + 0.5) / half * 2 - 1;
        const r2 = nx * nx + ny * ny;
        let a = Math.exp(-r2 * s.core) + Math.exp(-r2 * s.halo) * s.haloW;
        for (let i = 0; i < rad.length; i++) {
          const ca = Math.cos(rad[i]);
          const sa = Math.sin(rad[i]);
          const along = nx * ca + ny * sa;
          if (along <= 0) continue;
          const across = -nx * sa + ny * ca;
          const fall = Math.max(0, 1 - along / s.len);
          a += Math.exp(-(across * across) / (s.w * s.w)) * fall * fall * amp[i] * 0.85;
        }
        /* Hard window to zero before the cell border. Without it a bright arm
           runs into the neighbouring cell and every variant grows a stub of the
           one beside it. */
        const r = Math.sqrt(r2);
        const win = r >= 1 ? 0 : (1 - r) * (1 - r) * (3 - 2 * Math.min(1, r));
        a = Math.min(1, a) * Math.min(1, win * 1.6);
        const o = ((oy + y) * size + (ox + x)) * 4;
        img.data[o] = 255;
        img.data[o + 1] = 255;
        img.data[o + 2] = 255;
        img.data[o + 3] = Math.round(a * 255);
      }
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const FLASH_STRIDE = 18;
/* 0..2 pos | 3..5 vel | 6..9 spawn,life,rot0,spin | 10..11 size0,size1
   12..15 rgb,bright | 16..17 variant,capPx */

const FLASH_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iTime;
attribute vec2 iSize;
attribute vec4 iTint;
attribute vec2 iMisc;

uniform float uTime;
uniform float uPixelScale;
uniform float uMinPixels;

varying vec2 vUv;
varying vec2 vQuad;
varying vec3 vColor;
varying float vBright;
varying float vAlpha;
varying float vFragW;
varying float vClamp;
varying float vSpread;
varying float vVariant;
varying float vPx;

void main() {
  float t = uTime - iTime.x;
  float life = max( iTime.y, 0.0001 );
  float age = clamp( t / life, 0.0, 1.0 );
  float alive = step( 0.0, t ) * step( age, 0.9999 );

  vec3 wp = iPos + iVel * max( t, 0.0 );
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  float dist = max( -mv.z, 1.0 );

  /* The impact star (variants 4 and 5) holds its quad for its whole life, so
     it fades as a shape instead of shrinking back into a dot. */
  float natural = iMisc.x > 3.5 ? iSize.x : mix( iSize.x, iSize.y, age );
  // Same per-event ceiling on the screen floor the flare field carries: a
  // carpet of muzzle flashes must not all paint the same disc (see shotCeiling).
  float capPx = iMisc.y > 0.0 ? min( uMinPixels, iMisc.y ) : uMinPixels;
  float size = max( natural, dist * uPixelScale * capPx );
  vClamp = clamp( 1.0 - natural / max( size, 0.0001 ), 0.0, 1.0 );
  vSpread = pow( clamp( natural / max( size, 0.0001 ), 0.04, 1.0 ), 0.32 );
  size *= alive;

  float rot = iTime.z + iTime.w * t;
  float c = cos( rot );
  float s = sin( rot );
  mv.xy += vec2( position.x * c - position.y * s, position.x * s + position.y * c ) * size;
  gl_Position = projectionMatrix * mv;

  // 2x2 atlas, inset a texel so no arm can bleed into the cell next door.
  float v = floor( iMisc.x + 0.5 );
  vec2 cellOrigin = vec2( mod( v, 2.0 ), floor( v * 0.5 ) ) * 0.5;
  vUv = cellOrigin + 0.008 + uv * 0.484;

  vQuad = uv;
  vColor = iTint.rgb;
  vBright = iTint.w;
  vAlpha = pow( 1.0 - age, 1.25 ) * alive;
  vFragW = gl_Position.w;
  vVariant = v;
  vPx = size / max( dist * uPixelScale, 1e-6 );
  #include <logdepthbuf_vertex>
}
`;

const FLASH_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

uniform sampler2D uMap;

varying vec2 vUv;
varying vec2 vQuad;
varying vec3 vColor;
varying float vBright;
varying float vAlpha;
varying float vFragW;
varying float vClamp;
varying float vSpread;
varying float vVariant;
varying float vPx;

/* The impact star. Critic round 3: at fleet range a hit and an engine were
   the same soft white smudge, because the impact half of the flash family led
   with the pure-bloom cell and an engine glow is a pure bloom too. A hit now
   has the one shape no drive has: a thin ring with short radial spikes
   standing off it, round a small hot point. Drawn analytically in pixel
   units, not sampled from the atlas, because at the 6-9 px a hit is floored to
   a minified texture smears a 1 px ring into the very disc this replaces.

   Four things keep it a shape rather than a blob, each found by looking:
   line widths are held to about a pixel at any size; the ring does not
   expand, because temporal AA integrates an expanding ring into a filled
   disc; the ring is dropped when the mark is too small to hold one; and the
   lines sit just under the glow layer's 0.6 bloom cut so the bloom pass
   cannot fill the shape in - only the hot point blooms. Returns alpha and
   the core's share of it. */
vec2 fxImpactStar( vec2 q, float px, float arms ) {
  vec2 d = q * 2.0 - 1.0;
  float r = length( d );
  float onePx = 2.0 / max( px, 1.0 );
  float ringR = 0.44;
  float ringW = max( 0.05, onePx * 0.7 );
  float rr = ( r - ringR ) / ringW;
  float ring = exp( -rr * rr );
  float ang = atan( d.y, d.x );
  float sector = 6.2831853 / arms;
  float off = mod( ang + sector * 0.5, sector ) - sector * 0.5;
  float perp = r * abs( sin( off ) );
  float armW = max( 0.04, onePx * 0.7 );
  float pp = perp / armW;
  /* Under ~14 px a ring and a hot point merge into one bright square, so the
     ring is only drawn once there is room for it, and below that the spikes
     run in close to the core instead: at fleet range the hit is a crisp cross,
     close up it is a ring with spikes standing off it. */
  float roomy = smoothstep( 13.0, 22.0, px );
  float armIn = mix( 0.26, ringR + ringW * 1.6, roomy );
  float arm = exp( -pp * pp )
            * smoothstep( armIn - 0.08, armIn + 0.04, r )
            * ( 1.0 - smoothstep( 0.84, 0.99, r ) );
  float coreW = max( 0.06, onePx * 0.5 );
  float core = exp( -( r * r ) / ( coreW * coreW ) );
  float line = max( ring * roomy, arm );
  float a = clamp( core + line, 0.0, 1.0 ) * ( 1.0 - step( 1.0, r ) );
  return vec2( a, core / max( core + line, 1e-4 ) );
}

void main() {
  #include <logdepthbuf_fragment>
  vec4 texel = texture2D( uMap, vUv );
  bool star = vVariant > 3.5;
  float coreShare = 1.0;
  if ( star ) {
    vec2 st = fxImpactStar( vQuad, vPx, vVariant > 4.5 ? 6.0 : 4.0 );
    texel = vec4( 1.0, 1.0, 1.0, st.x );
    coreShare = st.y;
  }
  /* The star is not sharpened and not quad-masked: sharpening is for a soft
     blob that has to read as a hot dot, and the mask would eat the spikes. It
     windows itself. */
  float a = fxSharpen( texel.a, star ? 0.0 : vClamp ) * ( star ? 1.0 : fxQuadMask( vQuad ) ) * vAlpha * fxSoftFade( vFragW );
  if ( a <= 0.0035 ) discard;
  vec3 lit = vColor * texel.rgb * vBright * uGain * ( 1.0 + 0.9 * vClamp ) * vSpread;
  if ( star ) lit = mix( vColor * 0.58 * uGain, lit, coreShare );
  gl_FragColor = vec4( lit, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const FLASH_ATTRS = [
  { name: 'iPos', size: 3, offset: 0 },
  { name: 'iVel', size: 3, offset: 3 },
  { name: 'iTime', size: 4, offset: 6 },
  { name: 'iSize', size: 2, offset: 10 },
  { name: 'iTint', size: 4, offset: 12 },
  { name: 'iMisc', size: 2, offset: 16 },
];

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
/* A hull hit is *matter* failing, and it must never be mistaken for a shield
   hit, which is *field* discharging. Shields get the team trim and skid their
   sparks tangentially across a lattice; a hull hit gets none of the livery —
   white-hot metal, molten orange spall thrown out along the surface normal,
   and a dirty soot puff that a shield can never produce. */
const HULL_HOT = new THREE.Color(0xfff1cf);
const HULL_MOLTEN = new THREE.Color(0xff7a24);
const HULL_SOOT = new THREE.Color(0x3a332e);

/* Distributions over the flash family. Muzzle runs spiky, bursts run
   bloom-led. Repeats are the weighting.

   Impacts no longer draw from the atlas at all (round 4, fix 5): 4 and 5 are
   the analytic impact star in FLASH_FRAG, four spikes and six. The bloom-led
   cells they used to draw were the same soft disc a distant drive is. */
const MUZZLE_SET = [0, 1, 3, 1];
const IMPACT_SET = [4, 5, 4, 4];
/* Radiance of one impact mark, before the floor lift. Was 4.0 on the soft
   bloom cell; the star is mostly 1 px lines, and at 4.0 a stacked volley blew
   out to white and lost its shape to the bloom pass. */
const IMPACT_BRIGHT = 2.6;
/* Screen floor for the near-field detail of a hit - spall sparks and molten
   gobbets. The comment on hullImpact always said these "carry no floor at all
   and simply stop resolving at range", but they inherited the spark and ember
   fields' 2.2-2.4 px floors, so at 5 km twenty floored sparks per hit stacked
   into the white bloom blob that round 3 could not tell from an engine - the
   impact star's shape was under it. Under a pixel they fade out with distance
   as intended and the star carries the hit. */
const IMPACT_DETAIL_CAP_PX = 0.7;
const BURST_SET = [1, 3, 2, 0];

/* Screen ceiling, in pixels, for the two effects that fire hundreds of times a
   second in a fleet action: a gun going off and a round landing.

   The flare field's 5 px floor is right for a one-off event and wrong for a
   carpet of them — at 560 hulls it painted every muzzle and every impact the
   same 10 px disc regardless of whether the gun was on a 14 m interceptor or a
   380 m destroyer, and the battle became an even wash of white with no
   silhouette left in it. Sized off weapon damage, which is the only proxy for
   calibre the FX layer is given. A 10-damage autocannon lands at 3.2 px, a
   220-damage lance at 10 px. */
function shotCeiling(damage) {
  return Math.min(11, Math.max(2.4, 1.4 + Math.sqrt(Math.max(1, damage)) * 0.58));
}

/* ------------------------------------------------- impacts that read at 6 px

   Critic round 2, fix 4: at the distance this game frames combat, hits are
   invisible. A frame with 24 hulls engaging 74 showed "about a dozen glyphs
   and two flares", and nothing on screen answered "am I winning" except the
   HUD bar.

   The two halves of the ask pull against each other. Raising every impact to a
   6 px floor recreates the exact failure `shotCeiling` was written to stop: a
   fleet action fires several hundred rounds a second, and several hundred 6 px
   discs is an even white carpet with no silhouette left in it. Lowering them
   again is where we came in.

   The way out is to spend the pixel budget on *fewer* marks rather than
   smaller ones. Two impacts that land within `IMPACT_CELL_PX` of each other on
   screen inside `IMPACT_WINDOW` seconds are one event as far as the player is
   concerned — the eye cannot separate them at that size — so they are painted
   as a single mark carrying their summed weight. A destroyer under fire from
   six mounts becomes a steady legible pulse at its own position instead of
   sixty invisible dots, and the aggregate rate of marks across the frame stays
   flat as the battle grows, because what grows is the weight per mark.

   Close up nothing changes: the cell is defined in *screen* pixels, so at
   200 m two hits a hull apart are far more than 14 px apart and each keeps its
   own mark, complete with its own spall, soot and gobbets — none of which
   carry a floor at all, which is what keeps a close-up from turning to
   confetti.

   The first hit into an empty cell paints immediately, so no hit is ever late;
   the summary mark fires when the window closes and only if more arrived. */
const IMPACT_WINDOW = 0.13;
const IMPACT_CELL_PX = 14;
/* 9.5, up from 6.4 (round 4, fix 5). The mark is now the impact star, a 1 px
   ring and spikes, and under about 9 px it closes up into the very dot it
   replaced. It is mostly empty space, so the extra pixels do not cost the
   carpet that the old 6 px disc would have at this size. */
const IMPACT_FLOOR_PX = 9.5;

/* Screen floor for one impact mark, in pixels.

   Calibre still matters — a lance strike is allowed more pixels than an
   autocannon round — but nothing may go below legibility, and nothing may
   exceed half its target's own screen height. That second clause is what keeps
   a 14 m interceptor three pixels tall from wearing a 6 px impact mark: at
   that size the mark would *become* the ship. A small hull's hit therefore
   reads by radiance rather than by area, which is the right answer anyway,
   since what the player needs from a fighter taking fire is *that* it was hit,
   not where. */
function impactFloorPx(amount, targetPx) {
  const want = Math.min(11, IMPACT_FLOOR_PX + Math.sqrt(Math.max(1, amount)) * 0.34);
  /* 1.2x the target, up from 0.5x, and the target is the hull as *drawn*
     (with the impostor's size floor), not the physical one. A disc that size
     would become the ship; the impact star is a 1 px ring and spikes, so on a
     small hull it rings the hull instead of covering it, and it needs the
     room to stay a ring. */
  return Math.min(want, Math.max(2.4, targetPx * 1.2));
}

/** Radius of whatever a shot was aimed at, for callers that only see the shot. */
function targetRadius(entity) {
  if (!entity) return 0;
  if (entity.radius) return entity.radius;
  if (entity.def && entity.def.length) return entity.def.length * 0.4;
  return 0;
}

/** Sim rate (ARCHITECTURE §0). Tracer length is quoted in sim ticks of travel. */
const SIM_HZ = 30;

/* Live missile smoke ribbons allowed at once, across the whole battle.

   The budget alone (220 at high quality) is not a cap on what the *eye* can
   take: a salvo exchange put ~30 ribbons across the middle of frame at once and
   they stopped reading as ordnance and started reading as scratches on a film
   print. Beyond about a dozen no additional information reaches the player —
   the thirteenth missile is already covered by the first twelve — so the ones
   that miss out simply fly on their exhaust flare, which is what a missile past
   the front of a salvo looks like anyway. */
const MAX_MISSILE_TRAILS = 12;

/* How many rounds per second one shooter is allowed to *draw*, as a token
   bucket: `rate` tokens a second, up to `burst` banked.

   Every round still lands — the impact path and the sim's own damage are
   untouched — but not every round gets a visible tracer, which is how real
   tracer ammunition works too. Without this an interceptor's twin mass
   drivers put 12 rounds a second down a 1 km lane, 250 m apart, and at x4
   game speed 48 a second, 60 m apart (FX time runs on the wall clock while
   the sim runs at the game speed). Rounds that close overlap into one
   unbroken line from muzzle to target, which is the "laser pointer" and
   "order line" read the critic kept naming. Capped, a stream is a row of
   beads with dark gaps between them at any game speed. */
const TRACER_RATE = { rate: 7, burst: 3 };
const MISSILE_RATE = { rate: 4, burst: 4 };

/* Fire is tinted by team, but held well off the UI palette. The HUD speaks
   saturated cyan and orange-red; a round carries the same hue at under half
   the saturation and high lightness, so friendly fire is pale ice and hostile
   fire pale amber — legible as a side, never as an interface line. */
const FIRE_HSL = { h: 0, s: 0, l: 0 };
function fireTint(src, out) {
  src.getHSL(FIRE_HSL);
  return out.setHSL(FIRE_HSL.h, Math.min(0.62, FIRE_HSL.s * 0.55), 0.74);
}

export class WeaponFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.drawCalls = 5;

    this._quadGeo = quadGeometry();
    this._tracerGeo = shellQuadGeometry(2);
    this._beamGeo = shellQuadGeometry(3);
    this._missileGeo = missileGeometry();
    this._flashTex = flashAtlas();

    this.tracers = ctx.instanceBatch({
      name: 'tracers',
      base: this._tracerGeo,
      attributes: TRACER_ATTRS,
      stride: TRACER_STRIDE,
      capacity: ctx.budget.tracers,
      vertexShader: TRACER_VERT,
      fragmentShader: TRACER_FRAG,
      renderOrder: 15,
      softness: 8,
      nearFade: 14,
    });

    /* Sized well under the flare field: a flash lives 0.08-0.35 s, so even at
       the several-hundred-rounds-a-second a fleet action fires, the live
       population sits in the low hundreds. */
    this._flashCap = Math.max(128, Math.round(ctx.budget.flare * 0.28));
    this.flashes = ctx.instanceBatch({
      name: 'weaponFlashes',
      base: this._quadGeo,
      attributes: FLASH_ATTRS,
      stride: FLASH_STRIDE,
      capacity: this._flashCap,
      vertexShader: FLASH_VERT,
      fragmentShader: FLASH_FRAG,
      /* 11 px, not 5.5, and every caller now states its own ceiling.
         `capPx` can only ever *lower* this floor (see FLASH_VERT), so while
         the batch floor sat at 5.5 no impact could be floored to the 6.4 px
         fix 4 asks for, however the event was authored — the readability
         contract was capped below the thing it was contracting for. The
         per-event ceilings are what keep the carpet down; this number only
         sets how high an event is *allowed* to ask. */
      uniforms: { uMap: { value: this._flashTex }, uMinPixels: { value: 11.0 } },
      renderOrder: 14,
      softness: 12,
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

    this._tracers = [];   // { slot (-1 = undrawn), death, kind, ex,ey,ez, dx,dy,dz, damage, tRadius }
    this._tracerFree = [];
    // Per-shooter draw budgets (TRACER_RATE / MISSILE_RATE). Weak, so a dead
    // ship's bucket goes with it.
    this._drawBudget = new WeakMap();
    for (let i = ctx.budget.tracers - 1; i >= 0; i--) this._tracerFree.push(i);

    // Same LIFO free-list pattern as the tracers, so live flashes stay packed
    // near zero and only the high-water mark is uploaded and drawn.
    this._flashes = [];
    this._flashFree = [];
    for (let i = this._flashCap - 1; i >= 0; i--) this._flashFree.push(i);

    this._beams = [];
    this._missiles = [];
    this._missileTrails = 0;
    /* Open impact windows, keyed by screen-space cell. Small and short-lived:
       one entry per distinguishable point of impact in the frame, cleared
       within IMPACT_WINDOW of the last hit into it. */
    this._hits = new Map();

    /* A missile's wake is two ribbons, and it has to be, because the two halves
       of "white-hot at the nozzle cooling to dark smoke" cannot live on one
       blend mode.

       The *smoke* is normal-blended — it occludes, which is what smoke does —
       and on that layer a genuinely cold tail over near-black space is
       invisible by construction. Ramping it to black therefore deletes the tail
       rather than cooling it, and what is left is a uniform pale hairline: the
       original complaint, unchanged. So the smoke ramp runs bright warm grey to
       dark warm grey and lets the width taper and the alpha do the vanishing.

       The *heat* is a second, much shorter additive ribbon on the glow layer.
       That is the only place white-hot can actually be white-hot — it clears
       the bloom threshold — and it is what carries the team hue a few tens of
       metres behind the nozzle before the smoke takes over. Both ribbons ride
       batches that already exist, so this is two more strips, not two more
       draw calls. */
    this._smokeRamps = ctx.teamColors.map(() => [
      new THREE.Color(0xe8ddcc),
      new THREE.Color(0x8a7f74),
      new THREE.Color(0x2a2724),
    ]);
    this._heatRamps = ctx.teamColors.map((t) => [
      new THREE.Color(0xfffaf0),
      new THREE.Color(t.engine),
      new THREE.Color(t.engine).multiplyScalar(0.18),
    ]);

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

  /** `sim:damage` with shield:false — scorch and spall on the hull itself.

      Deliberately built to be unmistakable against `shields.js`. A shield hit is
      clean, team-coloured, laterally spread across a hex lattice, and leaves
      nothing behind. A hull hit is dirty: no livery anywhere in it, a white-hot
      core over molten orange, spall thrown *out along the plate normal* as
      stretched streaks rather than dots, and a soot puff on every hit that a
      field discharge has no way to produce. Told apart in a single frame, at any
      range where either is legible at all. */
  hullImpact(p) {
    const pt = p.point;
    if (!pt) return;
    const n = p.normal || this._v.set(0, 1, 0);
    const amount = Math.max(1, p.amount || 10);
    const mag = Math.min(6.0, 0.9 + Math.sqrt(amount) * 0.30);
    const ctx = this.ctx;
    const f = ctx.fields;
    const rng = ctx.rng;
    const jitter = 0.74 + rng.next() * 0.56;

    /* The legible mark goes through the coalescing path, which decides its
       screen floor from the target's own size and folds neighbours together.
       Everything below it is near-field detail that carries no floor at all
       and simply stops resolving at range — that split is what lets the mark
       be raised to 6 px without the close-up becoming confetti. */
    this._impactMark(pt, n, amount, p.entity);

    const capPx = shotCeiling(amount);
    // Molten wash, blown a little way back out of the hole it just made.
    /* Its screen floor is held under the impact star's (0.7 of the shot
       ceiling, was 1.4): floored up to fleet range this round wash is
       another soft disc, and the hit has to read by the star's shape. */
    f.flare.spawn(pt.x + n.x * mag * 0.6, pt.y + n.y * mag * 0.6, pt.z + n.z * mag * 0.6,
      n.x * 26, n.y * 26, n.z * 26, 0.30, 2.2,
      mag * 4, mag * 19 * jitter, HULL_MOLTEN, 1.9, 0, 0, capPx * 0.7);
    /* Stretched, not round: `stretch` elongates the billboard along its own
       velocity, so spall reads as metal being thrown rather than as a spray of
       identical dots. */
    this._sparkBurst(pt, n, Math.round(9 + mag * 5), 0.42, 70 + amount * 1.1, mag * 1.9, IMPACT_DETAIL_CAP_PX);

    // Soot on every hit, not only the big ones — this is the tell that says
    // "the plate is open" and it is the half a shield can never fake.
    const puffs = amount > 25 ? 2 : 1;
    for (let i = 0; i < puffs; i++) {
      // No drag in vacuum: the ejecta keeps going and simply thins out.
      f.smoke.spawn(
        pt.x, pt.y, pt.z,
        n.x * 16 + rng.gaussian(0, 8), n.y * 16 + rng.gaussian(0, 8), n.z * 16 + rng.gaussian(0, 8),
        1.2 + rng.next() * 1.1, 0.12, mag * 3.4, mag * 17,
        HULL_SOOT, 0.85, 1.1, rng.gaussian(0, 1.2),
      );
    }
    // Two or three fat molten gobbets that outlive the flash and arc away.
    for (let i = 0; i < 2 + (amount > 40 ? 1 : 0); i++) {
      const u = rng.unitVector();
      const s = (34 + amount * 0.7) * rng.range(0.5, 1.4);
      f.ember.spawn(
        pt.x, pt.y, pt.z,
        n.x * s * 0.8 + u.x * s * 0.5, n.y * s * 0.8 + u.y * s * 0.5, n.z * s * 0.8 + u.z * s * 0.5,
        rng.range(0.5, 1.3), 0.2, mag * 1.1, mag * 0.2, HULL_MOLTEN, 2.2, 2.4, 0, IMPACT_DETAIL_CAP_PX,
      );
    }
  }

  /* --------------------------------------------------------- impact marks */

  /** One hit, coalesced. See the IMPACT_* block above for why. */
  _impactMark(pt, nrm, amount, entity, radiusHint) {
    const ctx = this.ctx;
    const mpp = ctx.px(ctx.distTo(pt.x, pt.y, pt.z));
    /* The cell is quantised in screen pixels, not metres, so the grouping
       follows the camera: pulled back to strategic range a whole capital falls
       in one cell, and at 200 m two hits on the same plate do not. Keying on
       the cell rather than on the entity also folds the tracer-arrival path in
       with the `sim:damage` path for free, and those two fire on the same hit
       within a frame of each other. */
    const cell = Math.max(1e-3, mpp * IMPACT_CELL_PX);
    const key = `${Math.round(pt.x / cell)}:${Math.round(pt.y / cell)}:${Math.round(pt.z / cell)}`;
    const radius = (entity && entity.radius)
      || (entity && entity.def && entity.def.length ? entity.def.length * 0.4 : 0)
      || radiusHint
      || 18;

    const open = this._hits.get(key);
    if (open) {
      // Fold in. Position is a weighted mean so the mark lands on the centre
      // of mass of the volley rather than on whichever round arrived first.
      const w = open.weight + amount;
      const k = amount / w;
      open.x += (pt.x - open.x) * k;
      open.y += (pt.y - open.y) * k;
      open.z += (pt.z - open.z) * k;
      open.nx += (nrm.x - open.nx) * k;
      open.ny += (nrm.y - open.ny) * k;
      open.nz += (nrm.z - open.nz) * k;
      open.weight = w;
      open.pending += amount;
      if (radius > open.radius) open.radius = radius;
      return;
    }

    this._paintImpact(pt.x, pt.y, pt.z, amount, radius, 1);
    this._hits.set(key, {
      x: pt.x, y: pt.y, z: pt.z,
      nx: nrm.x, ny: nrm.y, nz: nrm.z,
      weight: amount, pending: 0, radius,
      until: ctx.now + IMPACT_WINDOW,
    });
  }

  /** Close every window whose time is up, painting one summary mark each. */
  _flushHits(now) {
    if (!this._hits.size) return;
    for (const [key, h] of this._hits) {
      if (now < h.until) continue;
      this._hits.delete(key);
      if (h.pending <= 0) continue;
      /* One mark for the rest of the volley, weighted by what it carried. The
         `dwell` multiplier is what makes sustained fire read as sustained:
         a heavy volley leaves its mark on screen for twice as long as a single
         round does, which is the cue a player reads as "that one is losing". */
      this._paintImpact(h.x, h.y, h.z, h.pending, h.radius,
        1 + Math.min(1.1, h.pending / Math.max(1, h.weight)));
    }
  }

  /* The mark itself: a hot dot with a floor, a ceiling and enough dwell to
     survive at the size the floor gives it.

     Forcing size up alone gives a grey smudge, and the reason is in the
     fragment stage: `vSpread` deliberately *dims* a billboard in proportion to
     how hard the pixel floor is stretching it, so that a carpet of floored
     sprites cannot wash the frame out. Correct as a default, and fatal for the
     one effect that has to read at exactly that size. The lift below is
     computed from the same two quantities the shader uses, so a mark ends up
     at a known multiple of its authored radiance however hard the floor bites,
     and the frame's total floored area is still bounded by the coalescing. */
  _paintImpact(x, y, z, amount, radius, dwell) {
    const ctx = this.ctx;
    const rng = ctx.rng;
    const mpp = ctx.px(ctx.distTo(x, y, z));
    const mag = Math.min(7.0, 0.9 + Math.sqrt(Math.max(1, amount)) * 0.30);
    const jitter = 0.74 + rng.next() * 0.56;

    // Bounding radius is ~0.55 hull lengths (catalog approxRadius).
    const targetPx = Math.max((2 * radius) / mpp, hullFloorPx(radius / 0.55));
    const capPx = impactFloorPx(amount, targetPx);
    const natural = mag * 9 * jitter;
    const floored = Math.max(natural, mpp * capPx);
    // Mirrors FLASH_VERT/FLASH_FRAG: clamp amount, spread dimming, and the
    // 1 + 0.9 * clamp lift the fragment stage already applies.
    const ratio = Math.min(1, natural / floored);
    const clampAmt = 1 - ratio;
    const spread = Math.pow(Math.max(0.04, ratio), 0.32);
    const gain = (1 + 0.9 * clampAmt) * spread;
    // Target twice the authored radiance when the floor is fully carrying the
    // mark; unity when it is not biting at all.
    const lift = Math.min(3.6, (1 + clampAmt) / Math.max(0.2, gain));
    /* Dwell, not area. Three frames of a 6 px dot is not an event a player
       can see; nine is. Close up the floor is not biting, so the flash stays
       as crisp and short as it ever was. */
    const life = (0.10 + rng.next() * 0.06) * (1 + 1.4 * clampAmt) * dwell;

    const o = this._flash(x, y, z, 0, 0, 0, life,
      natural, mag * 2.0, HULL_HOT, IMPACT_BRIGHT * lift, capPx, IMPACT_SET);
    /* Squared to the screen and not spinning. A target under sustained fire
       stacks several marks inside one coalescing cell, and at random angles
       their spikes fill each other in until the stack is the same soft disc
       a drive is. Aligned, a stack is still one legible cross with rings
       opening through it. The random draw for the angle still happens in
       _flash, so the FX stream is unchanged. */
    if (o !== undefined) {
      const d = this.flashes.data;
      d[o + 8] = Math.PI * 0.25;
      d[o + 9] = 0;
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
    /* Wake length: an eighth of the shot, held between 50 and 240 m. Long
       enough that its fade shows direction and speed, short enough that it
       is a mark crossing the gap rather than a line spanning it — the
       visible, bright part is only the front third of this (see
       TRACER_FRAG). Heavier calibres run a little longer. */
    const len = Math.min(240, Math.max(50, dist / 8 + dmg * 0.4));

    fireTint(team.trim, this._col);
    this._addTracer(
      from.x, from.y, from.z,
      (dx / dist) * speed, (dy / dist) * speed, (dz / dist) * speed,
      life, width, len, this._col, 2.0, 'kinetic', dmg, team, targetRadius(p.target),
      this._mayDraw(p.shooter, w.id || w.type, TRACER_RATE),
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
    fireTint(team.trim, this._col).lerp(FLAK_BURST, 0.45);
    this._addTracer(
      from.x, from.y, from.z, dx * speed, dy * speed, dz * speed,
      burst / speed, 0.5, Math.max(20, speed * (1.4 / SIM_HZ)), this._col, 1.8, 'flak', dmg, team, 0,
      this._mayDraw(p.shooter, w.id || w.type, TRACER_RATE),
    );
    this._muzzle(from, dx, dy, dz, dmg, team, 0.8);
  }

  _flakBurst(x, y, z, dmg) {
    const rng = this.ctx.rng;
    const f = this.ctx.fields;
    const scale = 1.6 + Math.sqrt(dmg) * 0.34;

    const j = 0.76 + rng.next() * 0.52;
    // A flak puff is a real cloud a few tens of metres across, so it carries
    // its own ceiling rather than the batch's 11 px: a sky full of airburst
    // discs all floored to the same size is the carpet again.
    this._flash(x, y, z, 0, 0, 0, 0.15 + rng.next() * 0.09,
      30 * scale * j, 7 * scale, HOT_WHITE, 4.6, 6.0, BURST_SET);
    f.flare.spawn(x, y, z, 0, 0, 0, 0.40, 0, 13 * scale, 48 * scale * j, FLAK_BURST, 2.4, 0, 0);

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
    /* Same draw budget as the guns. A swarm-pod corvette launches ~7 rounds a
       second (28 at x4), and a dozen of them a hundred metres apart, each with
       its own flame ribbon, join into one continuous line from launcher to
       target — the R3 "hairline from mark to target". The sim owns the
       damage, and the hit paints through `hullImpact`, so a missile over
       budget simply is not drawn. */
    if (!this._mayDraw(p.shooter, w.id || 'missile', MISSILE_RATE)) return;
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

    /* Launch spread. Six missiles leaving one bay at one bearing fly six
       near-identical curves, and because they also share a wobble phase those
       curves land in a plane — which is the emitter's spline drawn on screen in
       smoke. Kicking each round onto its own initial bearing and letting the
       seeker pull it back in is what a salvo actually looks like, and it is the
       only fix that survives the missiles converging on the same target. */
    const dir = new THREE.Vector3(dx / dist, dy / dist, dz / dist);
    const ax = Math.abs(dir.x);
    const ay = Math.abs(dir.y);
    const az = Math.abs(dir.z);
    const perp = this._v3;
    if (ax <= ay && ax <= az) perp.set(1, 0, 0);
    else if (ay <= az) perp.set(0, 1, 0);
    else perp.set(0, 0, 1);
    perp.crossVectors(dir, perp).normalize();
    const perp2 = this._v2.crossVectors(dir, perp).normalize();
    const spread = 0.17 + rng.next() * 0.13;
    dir.addScaledVector(perp, rng.gaussian(0, spread));
    dir.addScaledVector(perp2, rng.gaussian(0, spread));
    dir.normalize();

    this._col.copy(team.engine).lerp(HOT_WHITE, 0.25);
    const m = {
      pos: new THREE.Vector3(from.x, from.y, from.z),
      dir,
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
      /* Per-missile wobble. Shared frequencies made a salvo breathe in unison
         however different its phases were; a spread of rates is what makes six
         ribbons diverge instead of nesting. */
      wobA: 0.16 + rng.next() * 0.22,
      wobF1: 5.4 + rng.next() * 4.4,
      wobF2: 3.6 + rng.next() * 3.6,
      // Metres of lateral offset fed to the ribbon, so the smoke wanders off
      // the flight path the way a real exhaust column does.
      jitA: 1.6 + rng.next() * 3.4,
      jitF: 2.1 + rng.next() * 2.8,
      colour: new THREE.Color(this._col),
      body: new THREE.Color(0x9aa2a8),
      len: 3.4 + Math.sqrt(w.damage || 20) * 0.26,
      trail: null,
      heat: null,
      quat: new THREE.Quaternion(),
    };
    if (this._missileTrails < MAX_MISSILE_TRAILS) {
      const ti = (p.shooter && p.shooter.team) || 0;
      /* Life was 1.5 s, which at 900 m/s laid 1.3 km of ribbon per missile and
         is why a dozen of them tiled the middle of the frame for the whole
         engagement. 0.55 s is roughly a hundred body-lengths of smoke — plainly
         ordnance, gone before it becomes scenery. Now 0.34 s: at fleet range
         a straight 500 m smoke ribbon was still the longest uniform line in
         a frozen engagement frame (R4 fix 3), and a third less is still
         plainly a missile's wake. */
      /* 9 m of column behind a 6 m body. Narrower than this and the ribbon is a
         one-pixel wire at any range a player actually watches from, which is
         the "drawn line" read however well it tapers or ramps — width is what
         makes it read as a volume of smoke rather than as ink. */
      m.trail = ctx.fields.smokeTrail.acquire(
        0x8d8a86, 9.0, 0.34, 11, this._smokeRamps[ti] || this._smokeRamps[0],
      );
      /* A third of the smoke's life: the flame is out long before the soot
         is. 0.12 s, down from 0.18, so at cruise it is ~130 m of flame, under
         the spacing the draw budget leaves between rounds of one salvo. */
      m.heat = ctx.fields.trail.acquire(
        team.engine, 2.4, 0.12, 8, this._heatRamps[ti] || this._heatRamps[0],
      );
      if (m.trail) this._missileTrails++;
    }
    m.quat.setFromUnitVectors(this._zAxis, m.dir);
    this._missiles.push(m);
    this._muzzle(from, m.dir.x, m.dir.y, m.dir.z, w.damage || 20, team, 0.75);
  }

  _detonateMissile(m, hit) {
    const ctx = this.ctx;
    if (m.trail) {
      ctx.fields.smokeTrail.detach(m.trail);
      this._missileTrails = Math.max(0, this._missileTrails - 1);
    }
    if (m.heat) ctx.fields.trail.detach(m.heat);
    m.trail = null;
    m.heat = null;
    if (!hit) return;
    const rng = ctx.rng;
    const f = ctx.fields;
    const p = m.pos;
    const scale = 1 + Math.sqrt(m.damage) * 0.16;

    const j = 0.76 + rng.next() * 0.52;
    /* A warhead landing on a hull also paints the impact star through
       hullImpact (sim:damage), so at fleet range the round burst is held
       small (round 4, fix 5): a missile volley used to put a carpet of 6-10 px
       white discs over its target, the same round smudge as a drive, and it
       buried the stars. Close up none of these floors bind. */
    this._flash(p.x, p.y, p.z, 0, 0, 0, 0.16 + rng.next() * 0.10,
      30 * scale * j, 7 * scale, HOT_WHITE, 4.0, 3.5, BURST_SET);
    f.flare.spawn(p.x, p.y, p.z, 0, 0, 0, 0.5, 0, 12 * scale, 52 * scale * j, FLAK_BURST, 1.8, 0, 0, 3.0);
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
        this._col2, 2.6, rng.range(3, 9), 0, IMPACT_DETAIL_CAP_PX,
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
      intensity: ion ? 1.25 : 0.95,
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

    /* An ion lance firing is worth a nudge — same channel as death blasts so
       the camera needs no bespoke listener (see ExplosionFX._blast).

       Normalised on that same scale, where 1.0 is a destroyer's primary
       detonation. A discharge is a recoil tap on the ship that fired it, so it
       sits an order of magnitude below that, and below a frigate's death
       (0.187): a gun going off must not outweigh a ship coming apart. The
       ionFrigate's 220-damage lance lands at 0.105, the cruiser's 340-damage
       spinalIon at 0.135 — above a fighter pop (0.023), below a frigate. */
    if (ion) {
      bus.emit('fx:blast', {
        point: b.from.clone(),
        radius: Math.max(600, b.width * 90),
        strength: 0.05 + dmg / 4000,
      });
    }

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

  /* Which members of the flash family each event draws from, and how often.

     A muzzle is a contained deflagration in a barrel and throws hard spikes; an
     impact is spall off a plate and is mostly bloom with the odd ragged arm. The
     lists overlap on purpose — they are two distributions over one family, not
     two disjoint sprites — but a frame full of both never resolves into a
     repeating asterisk, which is the whole complaint. */
  _flash(x, y, z, vx, vy, vz, life, size0, size1, colour, bright, capPx, set) {
    const rng = this.ctx.rng;
    let slot = this._flashFree.pop();
    if (slot === undefined) {
      const oldest = this._flashes.shift();
      if (!oldest) return;
      slot = oldest.slot;
    }
    const d = this.flashes.data;
    const o = slot * FLASH_STRIDE;
    const now = this.ctx.now;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = now;
    d[o + 7] = life;
    // Free rotation and a slow tumble. A star pinned to the screen axes is the
    // give-away even when its shape varies.
    d[o + 8] = rng.next() * Math.PI * 2;
    d[o + 9] = rng.gaussian(0, 2.6);
    d[o + 10] = size0;
    d[o + 11] = size1;
    d[o + 12] = colour.r; d[o + 13] = colour.g; d[o + 14] = colour.b;
    d[o + 15] = bright;
    d[o + 16] = set[rng.int(0, set.length - 1)];
    d[o + 17] = capPx || 0;
    this._flashes.push({ slot, death: now + life });
    return o;
  }

  _writeFlashBuffer() {
    const now = this.ctx.now;
    for (let i = this._flashes.length - 1; i >= 0; i--) {
      if (this._flashes[i].death > now) continue;
      this._flashFree.push(this._flashes[i].slot);
      this._flashes.splice(i, 1);
    }
    let hi = -1;
    for (let i = 0; i < this._flashes.length; i++) {
      if (this._flashes[i].slot > hi) hi = this._flashes[i].slot;
    }
    const n = hi + 1;
    this.flashes.geometry.instanceCount = n;
    if (n <= 0) return;
    const b = this.flashes.buffer;
    b.clearUpdateRanges();
    b.addUpdateRange(0, n * FLASH_STRIDE);
    b.needsUpdate = true;
  }

  _entityPos(e, out) {
    const o = e.object3D ? e.object3D.position : e.position;
    return o ? out.copy(o) : out.set(0, 0, 0);
  }

  _entityQuat(e, out) {
    const q = e.object3D ? e.object3D.quaternion : e.quaternion;
    return q ? out.copy(q) : out.identity();
  }

  /* Token bucket per shooter, in FX time. See TRACER_RATE. A shot with no
     known shooter always draws. */
  _mayDraw(shooter, key, cfg) {
    if (!shooter || typeof shooter !== 'object') return true;
    const now = this.ctx.now;
    let per = this._drawBudget.get(shooter);
    if (!per) {
      per = {};
      this._drawBudget.set(shooter, per);
    }
    // One bucket per weapon, so a ship's flak never starves its main guns.
    let b = per[key];
    if (!b) b = per[key] = { t: now, tokens: cfg.burst };
    b.tokens = Math.min(cfg.burst, b.tokens + Math.max(0, now - b.t) * cfg.rate);
    b.t = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  _addTracer(x, y, z, vx, vy, vz, life, width, len, colour, bright, kind, damage, team, tRadius, visible = true) {
    /* A round over its shooter's draw budget still flies and still lands —
       it simply has no GPU slot. */
    if (!visible) {
      this._tracers.push({
        slot: -1, death: this.ctx.now + life, kind, damage, tRadius,
        ex: x + vx * life, ey: y + vy * life, ez: z + vz * life,
        dx: vx, dy: vy, dz: vz,
      });
      return;
    }
    let slot = this._tracerFree.pop();
    if (slot === undefined) {
      // Saturated: drop the oldest drawn round so new fire always reads.
      const i = this._tracers.findIndex((t) => t.slot >= 0);
      if (i < 0) return;
      slot = this._tracers[i].slot;
      this._tracers.splice(i, 1);
    }
    return this._writeTracer(slot, x, y, z, vx, vy, vz, life, width, len, colour, bright, kind, damage, team, tRadius);
  }

  _writeTracer(slot, x, y, z, vx, vy, vz, life, width, len, colour, bright, kind, damage, team, tRadius) {
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
      slot, death: now + life, kind, damage, tRadius,
      ex: x + vx * life, ey: y + vy * life, ez: z + vz * life,
      dx: vx, dy: vy, dz: vz,
    });
  }

  _muzzle(from, dx, dy, dz, damage, team, gain) {
    const ctx = this.ctx;
    const rng = ctx.rng;
    const f = ctx.fields;
    /* Scale variation is not decoration. Two hundred flashes a second at
       *exactly* one size is what makes a fleet action read as a repeating
       stamp; +/-30% on size and +/-25% on duration is enough that no two in
       frame measure the same, and no single one looks wrong. */
    const jitter = 0.72 + rng.next() * 0.58;
    const size = (5.0 + 4.4 * Math.sqrt(Math.max(1, damage))) * gain * jitter;
    const capPx = shotCeiling(damage);

    this._col2.copy(team.trim).lerp(HOT_WHITE, 0.55);
    // Core flash from the family, then a coloured cone blown down the barrel.
    this._flash(from.x, from.y, from.z, 0, 0, 0,
      0.070 + rng.next() * 0.045, size, size * 0.26, HOT_WHITE, 4.6, capPx, MUZZLE_SET);
    f.flare.spawn(
      from.x + dx * size * 0.3, from.y + dy * size * 0.3, from.z + dz * size * 0.3,
      dx * 42, dy * 42, dz * 42, 0.17, 4, size * 0.8, size * 2.0, this._col2, 2.6, 0, 0,
      capPx * 1.3,
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
  _sparkBurst(point, normal, count, spread, speed, size, capPx) {
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
      /* Stretch capped at 4.5, down from 8.0. A spark billboard elongated nine
         times its own width is not a spark, it is a hairline — and a burst of
         thirty of them radiating from an impact draws a wire star that is the
         same tutorial tell as the flare sprite was. Long enough to read as
         moving metal, short enough to stay a particle. */
      f.spark.spawn(
        point.x, point.y, point.z, mx * s, my * s, mz * s,
        rng.range(0.18, 0.62), 3.2, size * rng.range(0.6, 1.4), 0.25,
        HOT_WHITE, 2.4, rng.range(1.6, 4.5), 0, capPx,
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
      if (t.slot >= 0) {
        this._tracerFree.push(t.slot);
        this.tracers.data[t.slot * TRACER_STRIDE + 7] = 0;
      }
      if (t.kind === 'flak') {
        this._flakBurst(t.ex, t.ey, t.ez, t.damage);
      } else {
        const inv = 1 / Math.max(1e-4, Math.hypot(t.dx, t.dy, t.dz));
        this._v.set(-t.dx * inv, -t.dy * inv, -t.dz * inv);
        this._v2.set(t.ex, t.ey, t.ez);
        const mag = Math.min(5.0, 0.9 + Math.sqrt(t.damage) * 0.26);
        const capPx = shotCeiling(t.damage);
        const jitter = 0.74 + ctx.rng.next() * 0.56;
        /* Same coalescing path as `hullImpact`. The round landing and the
           `sim:damage` it causes are one event to the player, and keying the
           accumulator on a screen cell is what folds them together without
           either path having to know about the other. `tRadius` is the
           target's radius captured at the muzzle, so the mark can be held
           under its target's own screen size. */
        this._impactMark(this._v2, this._v, t.damage, null, t.tRadius);
        ctx.fields.flare.spawn(t.ex, t.ey, t.ez, 0, 0, 0, 0.26, 0,
          mag * 4, mag * 17 * jitter, HULL_MOLTEN, 1.9, 0, 0, capPx * 1.4);
        this._sparkBurst(this._v2, this._v, Math.round(8 + mag * 4), 0.45, 80 + t.damage * 1.2, mag * 1.9, IMPACT_DETAIL_CAP_PX);
      }
    }
    this._writeTracerBuffer();
    this._flushHits(now);
    this._writeFlashBuffer();

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
    // A beam's landing point is an impact like any other, so it is floored and
    // coalesced by the same rule. The bulb below it is the beam's own wash.
    this._impactMark(b.to, this._v.copy(b.from).sub(b.to).normalize(),
      b.damage, b.target);
    this._flash(b.to.x, b.to.y, b.to.z, 0, 0, 0, 0.12,
      is * (0.8 + rng.next() * 0.5), is * 0.45, HULL_HOT, 6.0, 8.0, IMPACT_SET);
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
         fly a perfectly straight line look like tracers. Amplitude and both
         rates are per-missile (see `_fireMissile`) so a salvo diverges. */
      const wob = Math.max(0, Math.min(1, (range - 60) / 400)) * m.wobA;
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
      tmpDesired.addScaledVector(tmpAxis, Math.sin(t * m.wobF1) * wob);
      tmpDesired.addScaledVector(m.right, Math.cos(t * m.wobF2) * wob);
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

      /* Feed the ribbon a laterally-jittered point rather than the missile's
         exact position. Exhaust is not welded to the airframe — it is pushed
         about by its own instability — and without this every ribbon is a
         mathematically clean offset of its neighbour, which is what made a
         salvo's trails read as a ruled sheet. Metres, not degrees, so it
         perturbs the smoke without touching the flight path. */
      if (m.trail || m.heat) {
        const jt = ctx.now * m.jitF + m.seed * 17;
        const j1 = Math.sin(jt) * m.jitA;
        const j2 = Math.cos(jt * 0.73 + m.seed * 5) * m.jitA;
        const jx = m.pos.x + tmpAxis.x * j1 + m.right.x * j2;
        const jy = m.pos.y + tmpAxis.y * j1 + m.right.y * j2;
        const jz = m.pos.z + tmpAxis.z * j1 + m.right.z * j2;
        if (m.trail) ctx.fields.smokeTrail.feed(m.trail, jx, jy, jz);
        // The flame sits on the axis, not in the wander: it is still inside the
        // nozzle's flow when the smoke has already been pushed about.
        if (m.heat) ctx.fields.trail.feed(m.heat, m.pos.x, m.pos.y, m.pos.z);
      }

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
      if (m.heat) this.ctx.fields.trail.detach(m.heat);
    }
    this._missiles.length = 0;
    this._missileTrails = 0;
    this._beams.length = 0;
    this._tracers.length = 0;
    this._flashes.length = 0;
    this.tracers.dispose();
    this.beams.dispose();
    this.missiles.dispose();
    this.exhaust.dispose();
    this.flashes.dispose();
    this._quadGeo.dispose();
    this._tracerGeo.dispose();
    this._beamGeo.dispose();
    this._missileGeo.dispose();
    this._flashTex.dispose();
    this._hits.clear();
  }
}
