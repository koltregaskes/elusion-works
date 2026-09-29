/* Thruster plumes and light trails.

   The plume is a camera-facing ribbon carrying two analytic profiles — a hot
   white core with exponential falloff, wrapped in a wide soft team-hued shell —
   plus a nozzle flare billboard that fills the bore and carries the read when a
   ship is coming straight at you.

   It used to be a pair of cone shells plus a throat disc, and that shape is
   what round 2's critic called the loudest amateur signal in the build: "solid
   straight-sided pale tubes with visible circular nozzle ends". Both halves of
   that were structural, not a tuning miss.

   A cone shell is a *surface*, and the old fragment stage set alpha from the
   axial coordinate and the facing angle only. Facing goes to zero exactly at
   the shell's silhouette and the rim term peaked there, so the brightest pixels
   in the whole effect were the two side edges — which is the definition of a
   tube. Nothing in the alpha curve depended on how far a fragment sat from the
   plume axis, so there was no way for the edge to fade. The circular ends were
   the same fault seen down the barrel: the mouth ring is where the axial term
   is at maximum, and the throat disc added a second hard rim on the same plane.

   A screen-facing ribbon with a radial profile cannot have either. Alpha is an
   exponential in the distance from the axis and reaches zero before the quad
   boundary, with an edge window guaranteeing it whatever the profiles do — so
   the plume has no silhouette at any angle, and no ring anywhere. It also costs
   14 triangles per nozzle instead of ~500.

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

/* The shell's characteristic radius, as a multiple of the nominal radius, at
   axial fraction t. Shared by both stages: the vertex stage widens the ribbon
   along its length so the quad follows the flare, and the fragment stage
   divides the shell's amplitude by the same number so spreading dims rather
   than brightens.

   Set from where the shell is last *visible*, not from where the quad ends,
   because those are very different things for a Gaussian. The shell is
   exp( -rho^2 * 0.95 ), down to a tenth of peak at rho = 1.56, so the painted
   half-width is 1.56x this number. 0.72 -> 1.05 therefore paints 1.12 nominal
   radii at the mouth — exactly the lip flange's outer radius — opening to 1.64
   at the tip. Against the old cone's 0.62 necked mouth and 1.04 widest point:
   wider, because a glow has to cover an aperture that a solid could not. */
const PLUME_SPREAD = /* glsl */ `
float plumeSpread( float t ) {
  return 0.72 + 0.33 * pow( max( t, 0.0 ), 0.72 );
}
`;

/* 0..2 pos | 3..6 quat | 7..9 scale | 10..12 colour
   13..16 seed,throttle,capPx,flare | 17 axial cap (m) */
const E_STRIDE = 18;

/* Quad half-width, in units of plumeSpread(). The shell profile is
   exp( -rho^2 * 0.95 ) and rho reaches this value at the quad edge, so at 2.4
   the edge sits at exp( -5.5 ) = 0.004 of peak — already invisible before the
   edge window closes it to exactly zero. Anything smaller and the window is
   trimming a live gradient, which is a soft-edged rectangle over the stern. */
const QUAD_W = 2.4;

/* How much of the radial screen floor is carried into the plume's length.
   Unchanged from round 2; what changed is that the result is now clamped (see
   PLUME_LEN_CAP), which is the part round 2 was missing. */
const LEN_FLOOR_MIX = 0.60;

/* The proportion ceiling, in hull lengths, at full burn.

   Round 1 said the plume was invisible at combat distance. Round 2 fixed that
   by carrying the radial screen floor into the axial scale, and shipped a
   frigate whose plume painted well over its own hull length — a 130 m ship
   reading as a model rocket. Both complaints are real and they pull opposite
   ways, so length now has a floor *and* a ceiling, and they are different kinds
   of number: the ceiling is proportional to the hull, the floor is in screen
   pixels.

   The ceiling binds whenever the hull is big enough for a viewer to judge
   proportion against; the floor binds only when the hull is a glyph, where
   there is no proportion left to read and the only job is to say which way the
   thing is pointed. Worked on the frigate at 4 km: the unclamped floored length
   is 129 m, the cap is 78 m, the axial pixel floor is 24 m — cap wins, plume is
   0.6 hulls. On a 14 m interceptor at the same range the cap is 8.4 m and the
   floor is 24 m — floor wins, and the drive is a 4 px streak rather than a
   2 px dot. */
const PLUME_LEN_CAP = 0.60;

/* Axial floor in pixels: the round-1 constraint, expressed as the one number it
   actually is. Down from the ~13 px the round-2 arithmetic handed a fighter at
   4 km, which is where the tube came from; still long enough to read as a
   streak with a direction rather than as a running light. */
const MIN_AXIAL_PX = 6.0;

const PLUME_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${QROT}
${PLUME_SPREAD}

attribute vec3 iPos;
attribute vec4 iQuat;
attribute vec3 iScale;
attribute vec3 iColor;
attribute vec4 iMisc;
attribute float iAxialCap;

uniform float uTime;
uniform float uPixelScale;
uniform float uMinPixels;
uniform float uMinAxialPx;
uniform float uQuadW;

varying vec3 vColor;
varying float vLat;
varying float vAxial;
varying float vThrottle;
varying float vSeed;
varying float vFragW;
varying float vClamp;
varying float vDim;
varying float vView;

void main() {
  vec3 axis = normalize( qrot( iQuat, vec3( 0.0, 0.0, 1.0 ) ) );

  /* Screen floor on the plume radius, under a per-class ceiling.

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
  float camDist = max( distance( cameraPosition, iPos ), 1.0 );
  float R = max( iScale.x, 0.0001 );
  float floorR = camDist * uPixelScale * min( uMinPixels, iMisc.z );
  float k = max( 1.0, floorR / R );
  vClamp = clamp( 1.0 - 1.0 / k, 0.0, 1.0 );
  /* Energy, not just size. A point source smeared over a minimum disc has to
     lose peak radiance or the smallest hulls end up the brightest things in a
     fleet action. The floor multiplies the radius by k, so it paints k-squared
     the area; radiance falls as k to the minus p and total emitted energy grows
     as k^(2-p). At p=0.70 energy grows as k^1.30 — still rising with distance,
     so the floor keeps doing the job it exists for, while the per-class ceiling
     above is what stops a fleet becoming equal white dots. p=0 at k=1 by
     construction: nothing about a close-up drive changes. */
  vDim = pow( clamp( 1.0 / k, 0.02, 1.0 ), 0.70 );
  float radius = R * k;

  /* Length: floor, then ceiling, in that order. See PLUME_LEN_CAP. */
  float len = iScale.z * mix( 1.0, k, ${LEN_FLOOR_MIX.toFixed(2)} );
  float axialFloor = camDist * uPixelScale * uMinAxialPx;
  len = min( len, max( iAxialCap, axialFloor ) );
  /* Guard, not a tuning knob: if the radial floor ever bound harder than the
     axial one the plume would become a disc wider than it is long, and a disc
     is the one failure mode that reads as a nozzle ring again. Measured across
     every class from 30 m to 60 km this never binds — the two floors are set so
     it cannot — so it is cheap to make impossible. */
  radius = min( radius, len * 0.42 );

  /* position.y is the profile coordinate: 0..1 along the plume, and -1 for the
     single upstream row that puts glow *inside* the bell mouth. The upstream
     band is measured in radii rather than in plume lengths, so a mothership
     does not push 160 m of quad into its own hull. */
  float y = position.y;
  float axialPos = y >= 0.0 ? y * len : y * ( 0.85 * radius );
  vec3 centre = iPos + axis * axialPos;

  vec3 toCam = cameraPosition - centre;
  float camLen = max( length( toCam ), 1.0 );
  toCam /= camLen;

  /* Perpendicular to both the exhaust axis and the view, so the ribbon always
     turns its face to the camera and its width is measured in the screen
     plane. Degenerate only when looking exactly down the bore, where any
     perpendicular will do and the ribbon is faded out anyway. */
  vec3 perp = cross( axis, toCam );
  float pl = length( perp );
  if ( pl > 1e-4 ) {
    perp /= pl;
  } else {
    vec3 alt = abs( axis.y ) < 0.9 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
    perp = normalize( cross( axis, alt ) );
  }

  float sp = plumeSpread( y );
  vec3 wp = centre + perp * ( position.x * radius * uQuadW * sp );
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );

  vColor = iColor;
  /* Signed, and only signed.

     The radial coordinate has to be interpolated before it is folded, never
     after. This quad's only x values are -1 and +1, so a per-vertex abs of
     position.x is 1 at *both* ends and a varying interpolates it to a constant
     1 across the entire surface — the fragment stage then sees the same radius
     everywhere, the Gaussian never falls off, and the edge window closing on
     that coordinate evaluates to exactly zero at every fragment. That is not a
     dim plume, it is no plume: measured at 30 hot pixels and 0.05% of the
     quadrant's luminance, against the flare's 3,300 in the same frame. The
     fragment stage folds it instead, which is the only place a fold can happen
     after interpolation.

     No backticks in this comment, and none in any other shader comment in this
     file. HANDOFF §5: a backtick inside a GLSL template literal truncates the
     shader and the parse error names an unrelated identifier. Writing this very
     note with them cost a round trip, which makes nine. */
  vLat = position.x * uQuadW;
  vAxial = y;
  vThrottle = iMisc.y;
  vSeed = iMisc.x;
  vFragW = gl_Position.w;
  /* End-on, the ribbon foreshortens to a bar, which is the one pose a
     screen-facing ribbon cannot serve. Hand the read to the flare there — it is
     at its brightest facing the nozzle straight on, by construction. */
  vView = mix( 1.0, 0.12, pow( abs( dot( axis, toCam ) ), 2.5 ) );
  #include <logdepthbuf_vertex>
}
`;

const PLUME_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS
${PLUME_SPREAD}

uniform sampler2D uNoise;
uniform float uTime;
uniform vec3 uHot;

uniform float uQuadW;

varying vec3 vColor;
varying float vLat;
varying float vAxial;
varying float vThrottle;
varying float vSeed;
varying float vFragW;
varying float vClamp;
varying float vDim;
varying float vView;

void main() {
  #include <logdepthbuf_fragment>

  /* Fold the interpolated lateral coordinate here, not in the vertex stage.
     See the note on vLat in PLUME_VERT: folding before interpolation collapses
     the whole radial profile to a constant. */
  float rho = abs( vLat );
  float edge = rho / uQuadW;

  float t = vAxial;
  float tt = max( t, 0.0 );
  /* Upstream rows, inside the bell. Fades forward so the glow is densest right
     at the mouth plane and thin by the time it reaches the throat — the
     aperture is washed out by its own plume instead of showing as a lit ring
     round a hole.

     The rate was 3.0, which left 5% of peak at the upstream row and did nothing
     at all for the bore. At 1.3 it is 27%, which is enough to sit in front of
     the bell's inner far wall and take the dark crescent off the flange from a
     three-quarter view, and still well under the mouth so the plume does not
     appear to start ahead of its own nozzle. */
  float mouth = t < 0.0 ? exp( t * 1.3 ) : 1.0;

  float sp = plumeSpread( t );
  float r2 = rho * rho;

  /* Turbulence: two noise taps scrolling at different rates down the plume,
     plus a fast flicker. Signed lateral coordinate so the two sides of the
     ribbon do not mirror each other. It modulates the shell only — the core
     stays a clean spine and the haze does the breathing, which is most of what
     keeps the pair separable to the eye. */
  float n1 = texture2D( uNoise, vec2( vLat * 0.26 + vSeed, tt * 0.85 - uTime * 1.7 ) ).r;
  float n2 = texture2D( uNoise, vec2( vLat * 0.53 - vSeed * 2.0, tt * 1.9 - uTime * 3.1 ) ).g;
  float turb = mix( 0.70, 1.30, n1 * 0.62 + n2 * 0.38 );
  float flick = 0.91 + 0.09 * sin( uTime * 41.0 + vSeed * 24.0 ) * sin( uTime * 17.3 + vSeed * 9.0 );

  /* Exponential axial falloff on both, a factor of three apart in rate: the
     core is a short choke that dies inside the first third, the shell carries
     the length. Throttle lengthens the burn rather than brightening it.

     The window is not decoration. exp( -2.6 ) still leaves 7% of peak at t=1,
     and a 7% additive tail ending on a straight line across the quad is a
     visible cut — the same mistake as the old cone's hard side. Closing it in
     space is what makes the painted length end before the geometry does. */
  float win = ( 1.0 - smoothstep( 0.70, 1.0, tt ) ) * ( 1.0 - smoothstep( 0.78, 1.0, edge ) );

  float axShell = exp( -tt * mix( 4.6, 2.60, vThrottle ) );
  float axCore = exp( -tt * mix( 12.0, 6.00, vThrottle ) );

  float shell = exp( -r2 * 0.95 ) * axShell * turb / sp;
  float core = exp( -r2 * 9.00 ) * axCore;

  /* Amplitudes chosen so the sum peaks a little over 1 at the throat and
     nowhere else. Additive blending clamps at the alpha curve, and a wide
     saturated plateau would reintroduce exactly the hard-edged solid this
     rebuild exists to remove: the only place allowed to blow out is the bore
     itself, which in a real drive is the one part that does. */
  float wS = shell * 0.62;
  float wC = core * 0.88;
  float a = ( wS + wC ) * win * mouth * flick * vView;

  /* Hue by contribution: near-white where the core dominates, team colour
     through the body. One mix, so the transition happens where the profiles
     cross rather than at an arbitrary axial station. */
  vec3 col = ( vColor * wS + mix( vColor, uHot, 0.92 ) * wC ) / max( wS + wC, 1e-4 );

  /* Once the pixel floor is doing the work the plume is a smear a few pixels
     across; concentrate it so it still reads as thrust. Sharpening the alpha
     curve is a *shape* operation and stays at full strength — it is what makes
     a distant drive a hot dot rather than a grey smudge. */
  a = fxSharpen( a, vClamp * 0.8 );
  /* Bleed the white-hot core out as the floor takes over. Two pixels across,
     white is wrong twice: it is the brightest a colour can be for a given
     magnitude, and it is the one colour that says nothing about whose fleet you
     are looking at — which is the read §3.3 asks the drive to carry at range.
     Rescaling to the team colour at the same magnitude drops luminance 46% for
     the player's cyan and 59% for the enemy's amber, and buys a fleet that is
     legibly two sides. */
  col = mix( col, vColor * dot( col, vec3( 0.3333 ) ), vClamp * 0.8 );
  col *= uGain * ( 1.0 + 0.25 * vClamp ) * vDim;

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
varying float vDim;

void main() {
  vec3 axis = qrot( iQuat, vec3( 0.0, 0.0, 1.0 ) );
  /* Stand off the mouth plane by just enough to clear the lip flange — a ring
     from 0.90 to 1.12 radii and 0.16 radii thick, sitting on the mouth plane —
     and not one bell radius more.

     This number was 1.65 radii and it is the whole reason the nozzle rings
     survived the rebuild. The standoff is a *world* offset along the exhaust,
     so at any three-quarter view it projects to a large *screen* offset: the
     disc that was supposed to cover the aperture painted a soft blob beside it
     instead, and left the flange rim and its dark bore untouched. Photographed
     with both plume batches hidden, those rings are the hull's own hardware, so
     covering them is the only lever this file has. At 0.30 radii the disc stays
     centred on the aperture from every angle, and still clears the flange by
     twice its thickness. */
  vec3 wp = iPos + axis * iScale.x * 0.075;
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
     has to come down in radiance as well as in area. Held at the same 0.70 as
     the ribbon so the two halves of one drive never disagree about how far away
     it is. */
  vDim = pow( clamp( natural / max( size, 0.0001 ), 0.02, 1.0 ), 0.70 );

  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;

  vUv = uv;
  vColor = iColor;
  /* Facing the nozzle straight-on is where the flare should dominate. The
     throttle term is separate and shallow: the bore still has to be covered at
     station keeping, so this dims a parked drive rather than switching it off.
     Without it the flare had no throttle response at all and an idling capital
     lit its engine block as hard as one under full burn, which is a value
     problem in the one frame section 3.2 cares most about. */
  vGain = mix( 0.45, 1.0, pow( abs( dot( normalize( axis ), normalize( cameraPosition - wp ) ) ), 1.6 ) )
        * mix( 0.62, 1.0, clamp( iMisc.y, 0.0, 1.0 ) )
        * smoothstep( 0.0, 0.02, iMisc.y );
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const FLARE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

varying vec2 vUv;
varying vec3 vColor;
varying float vGain;
varying float vFragW;
varying float vClamp;
varying float vDim;

void main() {
  #include <logdepthbuf_fragment>
  /* Analytic, not a sprite lookup, and flat-topped rather than Gaussian.

     This billboard's first job is to fill the bell bore. greeble.js says why in
     its own comment: the emitter cone is lit through dot( N, V ) instead of the
     axial ramp its UVs were built for, so the bell is bright at the lip and
     dead up the bore, and something has to paper over it from outside. That was
     the old throat disc — a flat lit disc on the mouth plane with a hard rim,
     and one of the three ring artefacts round 2 was pulled up for.

     A Gaussian cannot do this job: it is down to a quarter of peak by the time
     it reaches the flange, so twelve bells paint as twelve white rings round
     twelve dim holes, which is worse than what it replaced. The plateau holds
     full value out to 0.62 of the half-width — past the flange — then falls
     over a band twice that wide. Flat top, long soft edge, always facing the
     camera: it cannot ring, and it has no rim to catch light. */
  vec2 d = vUv * 2.0 - 1.0;
  float r2 = dot( d, d );
  if ( r2 > 1.0 ) discard;
  float bore = ( 1.0 - smoothstep( 0.62, 1.0, sqrt( r2 ) ) ) * 0.74;
  float core = exp( -r2 * 8.0 ) * 0.98;
  float a = fxSharpen( bore + core, vClamp ) * vGain * fxSoftFade( vFragW );
  if ( a <= 0.003 ) discard;
  /* Mostly team colour with a white-hot centre, not the other way round: the
     drive is the strongest colour signal a ship gives at range (§3.3). The
     white centre is retired as the screen floor takes over, for the same reason
     the ribbon's is — see PLUME_FRAG. */
  float white = clamp( core / max( core + bore, 1e-4 ), 0.0, 1.0 ) * ( 1.0 - 0.8 * vClamp );
  vec3 hot = mix( vColor, vec3( 1.0 ), white * 0.85 );
  gl_FragColor = vec4( hot * 1.38 * uGain * ( 1.0 + 0.25 * vClamp ) * vDim, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* The plume ribbon: one flared quad, mouth at y=0, tip at y=1, plus a single
   upstream row at y=-1 that carries glow into the bell mouth.

   The lateral half-width follows plumeSpread() so the quad hugs the cone the
   fragment stage draws inside it. That matters for exactly one reason: the
   shell profile has to have decayed to nothing by the time it reaches the quad
   boundary at *every* station along the length, or the edge window is trimming
   a live gradient and the trim is visible. A straight-sided quad wide enough
   for the tip is a third too wide at the mouth, which is both wasted fill and a
   soft-edged rectangle over the stern.

   Six axial segments, because the spread is a 0.72 power and two rows would cut
   the corner off it. Fourteen triangles per nozzle, against ~500 for the two
   cone shells and the throat disc it replaces. */
function buildPlumeGeometry(axial = 6) {
  const pos = [];
  const idx = [];
  const rows = [-1];
  for (let i = 0; i <= axial; i++) rows.push(i / axial);
  for (const y of rows) {
    pos.push(-1, y, 0);
    pos.push(1, y, 0);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
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
  { name: 'iAxialCap', size: 1, offset: 17 },
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
   enough that a parked mothership is not twelve dead holes — and, at 0.20
   rather than 0.14, enough that a ship holding station in a firefight still
   shows which way it is facing. */
const IDLE_THROTTLE = 0.20;

/* Per-class screen ceiling for the drive glow, in pixels, from hull length.

   The pixel *floor* is what makes a distant effect legible; this is the
   companion ceiling that stops the floor levelling the fleet. Rising
   sub-linearly with hull length, so a capital's flare is carried by its own
   physical size long before the floor is in play.

   The anchor is up from 2.0 px to 3.2 px. At 2.0 the ceiling was doing its job
   against the 560-hull stress case and simultaneously holding the drive under
   the threshold where a player sees it at all in an ordinary engagement: two
   pixels of glow on a hull that is itself two or three pixels is a rounding
   error, not a heading cue. The shape of the curve — the thing that keeps a
   fighter and a capital distinguishable — is unchanged; only the height moved.

     interceptor  14 m ->  3.2 px      frigate   130 m ->  7.8 px
     corvette     34 m ->  4.5 px      destroyer 380 m -> 12.0 px
     collector    46 m ->  5.0 px      mothership 1900 m -> 20.0 px (clamped) */
function ceilingPixels(L) {
  return Math.min(20, Math.max(2.2, 3.2 * Math.pow(Math.max(L, 4) / 14, 0.40)));
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

    /* Published so the measurement harness reproduces the vertex stage's
       arithmetic from the same numbers rather than from a copy of them. A
       harness that hard-codes 0.60 is a comment asserting runtime behaviour,
       and those go stale (HANDOFF §5). */
    this.E_STRIDE = E_STRIDE;
    this.LEN_FLOOR_MIX = LEN_FLOOR_MIX;
    this.QUAD_W = QUAD_W;
    this.PLUME_LEN_CAP = PLUME_LEN_CAP;
    this.MIN_AXIAL_PX = MIN_AXIAL_PX;

    this._plumeGeo = buildPlumeGeometry(6);
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
        /* Global floor on the *radius*, down from 5.0 because the shape it
           feeds changed. The old cone's widest point was 0.87 of its nominal
           radius and its alpha died at the mesh edge; the ribbon's shell is
           still readable out to 1.64 nominal radii at the tip. Scaling by
           0.87/1.64 keeps the painted footprint of a floored drive where round
           2 left it rather than inflating it by nearly double. */
        uMinPixels: { value: 2.7 },
        uMinAxialPx: { value: MIN_AXIAL_PX },
        uQuadW: { value: QUAD_W },
      },
      renderOrder: 10,
      /* Down from 16. The ribbon's first rows sit on and just inside the mouth
         plane, so a 16 m ramp against the ship's own bell deletes the part of
         the plume that covers the aperture — the same fault as the flare's,
         one order of magnitude further out. 6 m still softens the crossing
         where a capital's plume runs over a hull behind it. */
      softness: 6,
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
        // Same argument as the ribbon's: the ceiling should be what decides.
        uMinPixels: { value: 7.0 },
      },
      renderOrder: 11,
      /* Almost no fade band, which for this one batch is correct. The disc sits
         0.3 radii off the very surface it exists to cover, so a soft-particle
         ramp measured in metres deletes precisely the pixels that do the
         covering: at 12 m the bores stayed dark, at 4 m each bell kept a dark
         crescent where the flange's inner wall sat a few tens of centimetres
         behind the disc. The fade exists to stop a hard cut where an effect
         intersects a hull, and this effect's cut is coincident with the
         aperture rim, where there is nothing to give away. */
      softness: 1,
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

    /* Three-stop ramp for the light-trail, one per team, shared by reference.

       The age taper alone can never close a streak off, and measuring it says
       why: a 30-segment ribbon fed every ~8 m behind a 600 m/s fighter spans
       about 84% of its own lifetime, so the oldest vertex still sits at k=0.16
       and the strip ends on a square cut 20% of its head width. That cut is
       most of what "trails read as drawn lines" means — the eye reads the end,
       not the gradient. The ramp closes it in *space* instead, and carries the
       temperature with it: hot at the nozzle, team hue through the body, near
       dark where it dies. */
    this._trailRamps = ctx.teamColors.map((t) => [
      new THREE.Color(t.engine).lerp(new THREE.Color(0xffffff), 0.55),
      new THREE.Color(t.engine),
      new THREE.Color(t.engine).multiplyScalar(0.10),
    ]);

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
    /* The proportion ceiling, in metres, at full burn. Throttle shapes it on
       the CPU so the shader clamp is a single min() against a number that
       already knows how hard the drive is running. */
    entry.maxAxial = PLUME_LEN_CAP * L;
    const capPx = ceilingPixels(L);
    entry.flareCapPx = capPx;
    /* The ribbon's ceiling is a *nominal radius* where the flare's is a full
       quad width, and the ribbon's shell reads out to 1.64 nominal radii.
       0.265 = 0.5 (radius against width) x 0.53 (cone edge 0.87 against ribbon
       1.64), so an interceptor's drive still covers about 2 px at any range,
       against the 2.3 px hull that SHIPS floors its impostor to. */
    entry.plumeCapPx = capPx * 0.265;
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
          /* Was 0.42 + 0.28q, which at 600 m/s put 630 m of ribbon behind a
             14 m interceptor — forty-five hull lengths, and at fleet range a
             field of them reads as straight scratches across the frame rather
             than as ships moving. Twenty-odd hull lengths still streaks. */
          const life = (0.30 + 0.20 * ctx.qscale) * j;
          const ramp = this._trailRamps[e.team || 0] || this._trailRamps[0];
          entry.trail = trails.acquire(team.engine, r, life, Math.max(5, r * 2.4), ramp);
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

      /* Proportion ceiling for this frame's throttle. A ship at station keeping
         shows a stub, not a short version of full burn: 0.20 hull lengths at
         idle against 0.60 at full. */
      const axialCap = entry.maxAxial * (0.28 + 0.72 * throttle) * scale;

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
           same mark at fleet range.

           The cap is applied here as well as in the shader. The shader clamp is
           the one that matters — it is what catches the screen floor — but a
           bell whose *physical* plume already overshoots its hull should not be
           fed an overshooting number in the first place, or the floor gets a
           head start on the ceiling. */
        const len = Math.min(r * (3.0 + 22.0 * throttle) * entry.gain, axialCap);
        /* Nominal radius. The ribbon has no silhouette, so this is no longer
           constrained to stay inside the lip flange — a soft glow that spills a
           little past the flange is what hides the aperture rather than ringing
           it. It stays close to the bell so the drive is the size of its own
           hardware at close range.

           The floor here is set by the flange, not by taste. The lip is a ring
           from 0.90 to 1.12 radii on the mouth plane, so a ribbon narrower than
           1.12 leaves the rim standing proud of its own glow and the aperture
           reads as a lit circle with a dark arc on the lit side. The previous
           0.95 + 0.25t did clear it at full throttle (1.20) and did not at idle
           (1.00) — which is why the rings survived in every hero frame, where
           ships sit at idle, while looking fixed in capture frames of a fleet
           under way. Measured at 7x on laneH-hero-destroyer: six bores, six
           dark crescents, all on the flange side.

           1.30 at idle covers the flange by 0.18 radii, which is more than the
           lip is thick, so the rim has nothing to catch on from any angle. */
        const wid = r * (1.30 + 0.20 * throttle);
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
        cd[o + 17] = far ? 0 : axialCap;

        for (let k = 0; k < E_STRIDE; k++) fd[o + k] = cd[o + k];
        /* The flare is the only thing filling the bore now that the throat disc
           is gone, so it is sized from the *bell* and not from the plume: no
           `entry.gain`, which is a length correction and has no business
           setting how wide a bore is. Half-width 1.8 to 2.2 bell radii, and the
           fragment plateau holds full value out to 0.62 of that — past the 1.12
           flange.

           Throttle moves it, but only a little, and never below the width that
           does the covering: the plateau has to reach the 1.12 flange at *idle*
           too, or a parked capital gets its twelve rings back — and a parked
           capital is the first frame a player sees. 3.2 + 1.0 puts the plateau
           at 1.05 radii idle and 1.30 at full, against a bore of 0.90. */
        fd[o + 7] = r * (3.2 + 1.0 * throttle);
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
