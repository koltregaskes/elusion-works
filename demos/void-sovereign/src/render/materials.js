import * as THREE from '../../vendor/three/build/three.module.js';
import { makeRng } from '../core/rng.js';
import { HULL_HAZE_DEFINE } from './atmosphere.js';
import {
  initTextureLibrary,
  getHullAtlas,
  getAtlasAverages,
  getNoiseTexture,
  getSpriteTexture,
  disposeTextures,
  ATLAS,
  familyLayer,
  FAMILY_MACRO_SLOTS,
  MACRO_TONE,
} from './textures.js';

/* Ship and structure materials.

   One `MeshStandardMaterial` per (team, family), patched through
   `onBeforeCompile`. Hull geometry needs no UVs and no tangents: the shader
   projects the surface arrays triplanarly in *object* space, which means a
   merged hull built by ships/ gets continuous plating across every greeble,
   and panel density is set in metres rather than in UV units.

   Five things make this read as Homeworld rather than as a shader toy:

     1. panel density derived from hull family, so a 14 m interceptor and a
        1,900 m mothership carry plates of physically plausible size;
     2. team colour restricted to painted livery — the hull itself stays grey,
        always — and that livery is cut analytically from the hull's own axes
        so it survives to twenty pixels;
     3. chroma discipline: the *illuminant's* colour is stripped out of the
        direct term, so a warm key star lights a grey ship rather than dyeing
        it, and the nebula owns the shadow side instead of the whole hull;
     4. a hemispheric nebula bounce so the shadow side is lifted, never black;
     5. bare metal where paint has worn, so metalness is a map, not a slider. */

/* ------------------------------------------------------------- team palettes */

const col = (hex) => new THREE.Color(hex);

/* Read these as a pair, not individually. The only job they have is to be
   unmistakable from each other at a glance across eight kilometres of void:
   the player is cold — cyan over steel — and the enemy is warm — amber over
   crimson-rust. Both sit at high chroma on purpose. They are painted onto a
   grey hull in bands that cover a fifth of the silhouette, and at that size a
   desaturated trim colour is the same as no trim colour at all. */
export const TEAM_COLORS = [
  {
    // Player — cold steel, cyan livery, white-blue running lights.
    primary: col(0x99a4ac),
    secondary: col(0x18628a),
    engine: col(0x6fccff),
    trim: col(0x2fb4e6),
    light: col(0xcdf0ff),
    // R7 hull plate hue (value comes from the atlas mean): cool gunmetal
    hull: col(0x8996a6),
  },
  {
    // Enemy — bone, crimson-rust, amber drive glow.
    primary: col(0xa69c8f),
    secondary: col(0x8e3417),
    engine: col(0xff8f30),
    trim: col(0xe2761f),
    light: col(0xffd2a0),
    // R7 hull plate hue: weathered bone
    hull: col(0xb5a284),
  },
];

/* Default nebula bounce. ENV overwrites these through `setNebulaBounce()` once
   the skybox knows what colour the sky actually is. */
const NEBULA = {
  key: new THREE.Color(0x4a6f9c),
  fill: new THREE.Color(0x2a2233),
  ambient: 0.085,
  rim: 0.46,
  /* World direction toward the key star. ENV hands over the real one through
     setHullKeyDirection(); the rim below needs it to know which side is dark. */
  keyDir: new THREE.Vector3(0.5, 0.6, 0.3).normalize(),
};

/* The rim's colour: cold blue-white at unit luminance, fixed rather than taken
   from the sky. §3.2 asks for a "cold rim/fill bounce from the nebula", and the
   one property of it that matters on screen is that it is cold and neutral.
   Taking the hue from the bake let a warm palette tint every silhouette amber,
   which is the enemy's hue family. It is also never a team colour: the edge is
   light, and paint is the livery's job. */
const RIM_COLD = new THREE.Color(0.80, 0.95, 1.30).multiplyScalar(
  1 / (0.2126 * 0.80 + 0.7152 * 0.95 + 0.0722 * 1.30),
);

/* The rim's strength. The term used to be weighted by f0, the dielectric
   Fresnel floor of 0.045, which made its contract weight (0.019 of the key,
   ENV's BOUNCE_RIM_OVER_KEY) worth about 0.005 in linear light at the very
   edge: below the dither. It never drew a pixel, and a dark hull on a dark rock
   read as one blob. The weight stays where the contract put it; this is what
   it now multiplies: a gain on the contract weight, not a reflectance, because
   the job is an edge that reads, not a physical floor. */
const RIM_GAIN = 1.6;

/* `ref` is the hull length a family is tuned around. ships/index.js asks for a
   material by (team, family) only, so without it every class from a 46 m
   collector to a 1,900 m mothership would carry identically sized plating and
   the fleet would lose its sense of scale entirely (§3.4). Pass `opts.length`
   and the exact figure is used instead. */
const FAMILY_TUNING = {
  lancer: { ref: 22, emissive: 0.55, trim: 1.00, plateExp: 0.61, plateK: 0.12 },
  bulwark: { ref: 150, emissive: 0.85, trim: 0.95, plateExp: 0.61, plateK: 0.12 },
  monolith: { ref: 950, emissive: 1.15, trim: 0.85, plateExp: 0.61, plateK: 0.12 },
};

/** Plate size in metres for a hull of `length` metres. Sub-linear: plates grow
    with the ship but nothing like proportionally, which is what sells scale. */
function plateSize(length, tune) {
  const l = Math.max(4, length || tune.ref);
  return Math.min(24, Math.max(0.22, tune.plateK * Math.pow(l, tune.plateExp)));
}

/** R7 analytic plate size in metres. Steeper than plateSize() on purpose: a
    fighter should carry a few big plates and a Mothership a hundred along
    its keel (14 m -> 1.4 m, 150 m -> 5.4 m, 1,900 m -> 24 m). */
function panelSize(length, tune) {
  const l = Math.max(4, length || tune.ref);
  return Math.min(40, Math.max(0.8, 0.30 * Math.pow(l, 0.58)));
}

/* Livery geometry, in girth units — see `vsLivery` in the shader. Every number
   is a ratio against the hull's own local cross-section, so one set serves an
   interceptor and a mothership without a per-class uniform:
     spine    [half-width, edge softness]        centre band on deck and keel
     flank    [centre height, half-height, soft] side stripe
     shoulder [centre, half-width, light width]  outboard pinstripe + run lights
     run                                         running-light pitch, in girths */
const LIVERY = {
  lancer: {
    spine: [0.34, 0.070], flank: [0.05, 0.11, 0.040],
    shoulder: [0.58, 0.045, 0.050], run: 2.6,
  },
  bulwark: {
    spine: [0.30, 0.060], flank: [0.02, 0.10, 0.035],
    shoulder: [0.55, 0.040, 0.045], run: 2.0,
  },
  monolith: {
    spine: [0.18, 0.045], flank: [0.00, 0.075, 0.026],
    shoulder: [0.42, 0.030, 0.034], run: 1.7,
  },
};

/* ------------------------------------------------------------------- shaders */

const SHARED_TIME = { value: 0 };

/* Hit-local damage store (R6). Damage used to be one per-instance fraction
   pushed through a noise threshold, so it landed uniformly over the whole
   hull: peach squiggles nose to tail at 50%, leopard print at 20%, and none
   of it on the side the shots came from (critic round 5). Now every batched
   hull owns one row of a small float texture holding its last eight hull hits
   in its own local space, and the scorch grows only around those. One texture
   for the whole fleet, shared by every hull material, so it costs no draw
   call and no per-material state; rows are handed out by the batches in
   ships/index.js. Width 9: eight hits, then the hull length. Row 0 is never
   handed out and stays empty, so an instance with no row reads clean. */
const HIT_W = 9;
const HIT_EMPTY = 1e5;
const HIT_TEX = { value: null };
let _hitData = null;
let _hitRows = 1;

function clearHitRows(from, count) {
  for (let r = from; r < from + count; r++) {
    const o = r * HIT_W * 4;
    for (let k = 0; k < 8; k++) {
      _hitData[o + k * 4] = HIT_EMPTY;
      _hitData[o + k * 4 + 1] = HIT_EMPTY;
      _hitData[o + k * 4 + 2] = HIT_EMPTY;
      _hitData[o + k * 4 + 3] = -1e4;
    }
    _hitData[o + 32] = 0;
    _hitData[o + 33] = 0;
    _hitData[o + 34] = 0;
    _hitData[o + 35] = 0;
  }
}

function ensureHitRows(rows) {
  const have = HIT_TEX.value ? HIT_TEX.value.image.height : 0;
  if (rows <= have) return;
  let h = Math.max(256, have);
  while (h < rows) h *= 2;
  const data = new Float32Array(HIT_W * 4 * h);
  const old = _hitData;
  _hitData = data;
  clearHitRows(0, h);
  if (old) data.set(old);
  const tex = new THREE.DataTexture(data, HIT_W, h, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const prev = HIT_TEX.value;
  HIT_TEX.value = tex;
  if (prev) prev.dispose();
}
ensureHitRows(256);

/** Hand out `count` consecutive hit rows, all empty, for hull length `length`. */
export function allocHitRows(count, length) {
  const base = _hitRows;
  _hitRows += count;
  ensureHitRows(_hitRows);
  clearHitRows(base, count);
  for (let r = base; r < base + count; r++) _hitData[r * HIT_W * 4 + 32] = length || 1;
  HIT_TEX.value.needsUpdate = true;
  return base;
}

/** Copy `count` rows (a batch growing keeps its slots' hits). */
export function copyHitRows(from, to, count) {
  const n = HIT_W * 4;
  _hitData.copyWithin(to * n, from * n, (from + count) * n);
  HIT_TEX.value.needsUpdate = true;
}

/** Empty one row's hits (a reused slot must not inherit a dead hull's scars). */
export function resetHitRow(row) {
  if (!(row > 0)) return;
  const len = _hitData[row * HIT_W * 4 + 32];
  clearHitRows(row, 1);
  _hitData[row * HIT_W * 4 + 32] = len;
  HIT_TEX.value.needsUpdate = true;
}

/** Read hit `k` of a row into `out` (x, y, z, time). */
export function readHit(row, k, out) {
  const o = (row * HIT_W + k) * 4;
  out[0] = _hitData[o]; out[1] = _hitData[o + 1]; out[2] = _hitData[o + 2]; out[3] = _hitData[o + 3];
  return out;
}

/** Store hit `k` of a row at hull-local (x, y, z), stamped with the shader clock. */
export function writeHit(row, k, x, y, z) {
  if (!(row > 0) || k < 0 || k > 7) return;
  const o = (row * HIT_W + k) * 4;
  _hitData[o] = x;
  _hitData[o + 1] = y;
  _hitData[o + 2] = z;
  _hitData[o + 3] = SHARED_TIME.value;
  HIT_TEX.value.needsUpdate = true;
}

const HULL_PARS = /* glsl */`
uniform sampler2DArray uPlateMap;
uniform sampler2DArray uPlateNormal;
uniform sampler2DArray uPlateOrm;
uniform sampler2DArray uPlateEmis;
uniform sampler2DArray uMacroMap;
uniform sampler2DArray uMacroNormal;
uniform sampler2DArray uMacroOrm;
uniform sampler2DArray uMacroEmis;
uniform float uPlateLayer;
uniform vec4  uMacroSlots;
/* Column i is the material tone for slot i: rgb = albedo multiplier on the
   plate layer, w = roughness offset. A mat4 times the one-hot selector below
   is exactly "pick column i", branchless and in one instruction. */
uniform mat4  uMacroTone;
uniform vec4  uMacroMetal;
uniform float uPlateTexels;
uniform float uPlateCell;
uniform vec2  uPlateJit;
uniform float uBaseTiling;
uniform float uMacroTiling;
uniform float uBlendSharp;
uniform float uNormalStrength;
uniform vec3  uTrimA;
uniform vec3  uTrimB;
uniform vec3  uSecA;
uniform vec3  uSecB;
uniform vec3  uLightA;
uniform vec3  uLightB;
uniform vec3  uWindowColour;
uniform vec3  uHotColour;
uniform float uTeam;
uniform float uVariant;
uniform float uTrimStrength;
uniform float uLiveryGain;
uniform float uEmissiveGain;
uniform float uRunGain;
uniform float uAoStrength;
uniform float uDamage;
uniform float uTime;
uniform vec2  uSpine;
uniform vec3  uFlank;
uniform vec3  uShoulder;
uniform float uRun;
uniform vec3  uNebulaKey;
uniform vec3  uNebulaFill;
uniform vec2  uBounce;
uniform vec2  uChroma;
uniform vec2  uTerm;
uniform vec3  uKeyDir;
uniform vec3  uRimCold;
uniform vec3  uHullA;
uniform vec3  uHullB;
uniform float uPanel;

varying vec3 vObjPos;
varying vec3 vObjNormal;
flat varying mat3 vObjToView;
#ifdef VS_ATTRIBS
  varying vec3 vCut;
  varying vec3 vAttr;
  /* x = hand-placed livery region, y = wear. Deliberately *not* folded into
     vAttr: vAttr.y is a team index and this is a paint mask, and the whole
     reason the region mask reached nothing for so long is that the two look
     interchangeable and are not. See the note above vsLivery. */
  varying vec2 vPaint;
  /* Hit-local damage (R6). Row vHitRow of uHitTex holds this instance's last
     eight hull hits: texels 0-7 are (hull-local xyz, uTime at the hit), texel
     8 is (hull keel length, 0, 0, 0). Row 0 is permanently empty. */
  uniform highp sampler2D uHitTex;
  flat varying float vHitRow;
#endif

vec3 vsAlbedo;
float vsRough;
float vsMetal;
float vsAO;
vec3 vsEmissive;
vec3 vsObjN;
vec3 vsHue;

const vec3 VS_LUMA = vec3( 0.2126, 0.7152, 0.0722 );

/* Triplanar fetch from an array layer. U is aligned to the hull's +Z axis on
   both dominant planes, so baked streak stains always trail along the ship
   rather than across it. Layers wrap and mip on their own, so this is a plain
   auto-LOD sample — no gradient juggling, no seam to dodge. */
vec4 vsTri( sampler2DArray tex, vec3 P, vec3 W, float k, float layer ) {
  return texture( tex, vec3( P.zy * k, layer ) ) * W.x
       + texture( tex, vec3( P.zx * k, layer ) ) * W.y
       + texture( tex, vec3( P.xy * k, layer ) ) * W.z;
}

float vsFootprint( vec2 uv, float texels ) {
  vec2 dx = dFdx( uv );
  vec2 dy = dFdy( uv );
  return sqrt( max( dot( dx, dx ), dot( dy, dy ) ) ) * texels;
}

float vsHash13( vec3 p ) {
  p = fract( p * 0.3183099 + vec3( 0.71, 0.113, 0.419 ) );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}

float vsNoise3( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( vsHash13( i ), vsHash13( i + vec3( 1, 0, 0 ) ), f.x ),
         mix( vsHash13( i + vec3( 0, 1, 0 ) ), vsHash13( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( vsHash13( i + vec3( 0, 0, 1 ) ), vsHash13( i + vec3( 1, 0, 1 ) ), f.x ),
         mix( vsHash13( i + vec3( 0, 1, 1 ) ), vsHash13( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}

/* R7 hull plating, built in the shader rather than read from the atlas.

   The round-6 critique called the atlas plating stucco on the Mothership and
   blotch camouflage on the fighters, and both are the same fault: a 2D texture
   tiled triplanarly has no idea which way the ship points, so its plates run
   any direction, its paint-cover alpha lands as random patches, and up close
   its texels show. This lays plates out along the hull's own axes instead.

   - The dominant face axis picks one plane, hard, so a seam never doubles up
     the way a blended triplanar seam does. On the flanks and deck the long
     side of a plate runs along +Z, the keel axis; end faces get square plates.
   - Plate size comes from uPanel, metres, sub-linear in hull length: a 14 m
     interceptor carries a handful of big plates and a 1,900 m Mothership
     carries a hundred along its keel.
   - Seams and bevels are analytic and filtered by the pixel footprint, and
     fade out before a pixel covers a fifth of a plate, so there is no texel
     to see and nothing to crawl.
   - The two shipyards differ in the layout itself, not just in colour. The
     player yard lays long strakes of plates whose lengths vary from one to
     eight cells, a third of them split again (R7 follow-up: the first pass
     was an even running bond and read as brickwork). The hostile yard builds in
     short segments that line up into rings, every third ring a heavier rib,
     with wider seams that hold grime.

   hostile is 0 or 1. Outputs: seam darkening, an object-space normal tilt for
   the plate bevel, per-plate value and roughness offsets, seam grime, a bright
   worn edge line, and the rib mask. */
void vsPanels( vec3 P, vec3 GN, float hostile, out float seam, out vec3 tilt,
    out float pv, out float pr, out float grime, out float edgeW, out float rib ) {
  vec3 aN = abs( GN );
  float fx = step( aN.y, aN.x ) * step( aN.z, aN.x );
  float fy = ( 1.0 - fx ) * step( aN.z, aN.y );
  float fz = clamp( 1.0 - fx - fy, 0.0, 1.0 );
  vec2 uv = P.zy * fx + P.zx * fy + P.xy * fz;
  vec3 tU = vec3( 0.0, 0.0, 1.0 ) * ( fx + fy ) + vec3( 1.0, 0.0, 0.0 ) * fz;
  vec3 tV = vec3( 0.0, 1.0, 0.0 ) * ( fx + fz ) + vec3( 1.0, 0.0, 0.0 ) * fy;
  float face = fx + fy * 2.0 + fz * 3.0;

  vec2 fwm = fwidth( uv );
  float fw = max( max( fwm.x, fwm.y ), 1e-5 );

  /* Base cell. A panel is a run of one to about eight base cells along the run
     axis; a boundary between two cells is a real seam only where a hash says
     so, so panel lengths vary strongly and no bond pattern can form. Player:
     runs go along the keel in long strakes. Hostile: the run axis is turned
     across the hull, so every cell boundary along the keel is a ring seam and
     the plates inside a ring are strips of varying height. */
  vec2 B = mix( vec2( 2.0, 1.8 ), vec2( 0.85, 1.0 ), hostile ) * uPanel;
  B = mix( B, vec2( 1.8 * uPanel ), fz );
  float lane0 = floor( uv.y / B.y );
  uv.x += vsHash13( vec3( lane0, face, 2.3 ) ) * B.x * ( 1.0 - hostile );
  vec2 g = uv / B;
  vec2 c = floor( g );
  vec2 f = g - c;

  vec2 cs = mix( c, c.yx, hostile );     // x = run index, y = lane index
  vec2 fs = mix( f, f.yx, hostile );
  vec2 Bs = mix( B, B.yx, hostile );
  vec3 tR = mix( tU, tV, hostile );
  vec3 tC = mix( tV, tU, hostile );
  float pRun = mix( 0.28, 0.40, hostile );
  float kf = face + 11.0;
  float aLo = step( vsHash13( vec3( cs.y, cs.x, kf ) ), pRun );
  float aHi = step( vsHash13( vec3( cs.y, cs.x + 1.0, kf ) ), pRun );
  float start = cs.x - 8.0;
  for ( int i = 0; i < 8; i++ ) {
    float k = cs.x - float( i );
    if ( vsHash13( vec3( cs.y, k, kf ) ) < pRun ) { start = k; break; }
  }
  vec3 pid = vec3( cs.y, start, face );
  float h1 = vsHash13( pid + 0.31 );
  float h2 = vsHash13( pid * 1.71 + 5.3 );
  float h3 = vsHash13( pid * 0.77 + 1.9 );

  float lod = 1.0 - smoothstep( 0.10, 0.30, fw / min( B.x, B.y ) );
  rib = hostile * step( 1.5, mod( c.x, 3.0 ) ) * ( 1.0 - fz );
  float w = uPanel * mix( 0.012, 0.020, hostile ) * ( 1.0 + rib * 0.8 );

  // distances in metres to the four sides of this base cell
  float dR0 = fs.x * Bs.x;
  float dR1 = ( 1.0 - fs.x ) * Bs.x;
  float dC0 = fs.y * Bs.y;
  float dC1 = ( 1.0 - fs.y ) * Bs.y;
  float eR0 = mix( 1e5, dR0, aLo );
  float eR1 = mix( 1e5, dR1, aHi );
  float dMaj = min( min( dC0, dC1 ), min( eR0, eR1 ) );

  /* Hierarchy: about a third of the primary panels are split into two to four
     smaller ones by thinner, shallower seams on the inactive cell boundaries
     and down the middle of the lane. */
  float sub = step( h3, 0.34 );
  float dMin = min( min( dR0, dR1 ), abs( fs.y - 0.5 ) * Bs.y );
  float wm = w * 0.6;

  float sMaj = 1.0 - smoothstep( w, w + fw * 1.5, dMaj );
  float sMin = ( 1.0 - smoothstep( wm, wm + fw * 1.5, dMin ) ) * sub * 0.55;

  /* Rule-placed detail, sparse: an access-hatch outline in about one base cell
     in eleven, and a rivet line beside the long seams of one lane in three. */
  vec2 q = abs( f - 0.5 ) * B;
  vec2 hs = B * vec2( 0.20, 0.26 );
  float he = max( q.x - hs.x, q.y - hs.y );
  float hatch = step( vsHash13( vec3( c, face + 5.0 ) ), 0.09 ) * ( 1.0 - fz )
              * ( 1.0 - smoothstep( wm, wm + fw * 1.5, abs( he ) ) ) * 0.7;
  float sp = uPanel * 0.22;
  float runCoord = mix( uv.x, uv.y, hostile );
  float rv = length( vec2( ( fract( runCoord / sp ) - 0.5 ) * sp, min( dC0, dC1 ) - w * 4.0 ) );
  float rivLod = 1.0 - smoothstep( 0.12, 0.35, fw / sp );
  float rivet = step( vsHash13( vec3( cs.y, face, 7.7 ) ), 0.33 ) * ( 1.0 - fz ) * rivLod
              * ( 1.0 - smoothstep( w * 0.9, w * 0.9 + fw, rv ) ) * 0.6;

  seam = max( max( sMaj, sMin ), max( hatch, rivet ) ) * lod;

  /* Recessed seam with a lip: only the plate side of a major seam is rolled,
     and narrowly, so the lit side catches a hairline and the shaded side drops
     into the groove. Nothing here brightens albedo. */
  float bw = w * 2.2 + fw;
  float bev = ( 1.0 - smoothstep( w, bw, dMaj ) ) * ( 1.0 - sMaj ) * lod;
  vec3 dir = -tC;
  float best = dC0;
  if ( dC1 < best ) { best = dC1; dir = tC; }
  if ( eR0 < best ) { best = eR0; dir = -tR; }
  if ( eR1 < best ) { best = eR1; dir = tR; }
  tilt = dir * bev * mix( 0.22, 0.34, hostile );

  pv = 1.0 + ( h1 - 0.5 ) * mix( 0.05, 0.16, hostile ) - rib * 0.12;
  pr = ( h2 - 0.5 ) * mix( 0.16, 0.18, hostile ) + rib * 0.07;

  float gn = vsNoise3( P / uPanel * 2.3 );
  grime = hostile * ( 1.0 - smoothstep( w, w + uPanel * 0.18, dMaj ) )
        * ( 0.40 + 0.60 * gn ) * mix( 0.35, 1.0, lod );
  edgeW = hostile * ( smoothstep( w, w * 1.5 + fw, dMaj ) - smoothstep( w * 1.6, w * 3.0 + fw, dMaj ) )
        * lod * smoothstep( 0.55, 0.85, gn );
}

/* Remove an illuminant's chroma while keeping the surface's own. The hue
   argument is the albedo normalised to unit luminance, so at k = 1 this is
   exactly what the fragment would look like under a white light of the same
   brightness. */
vec3 vsWhiten( vec3 c, vec3 hue, float k ) {
  return mix( c, hue * dot( c, VS_LUMA ), k );
}

/* Faction livery, cut from the hull's own axes rather than sampled from a map.
   Every term below is a ratio against the local cross-section radius, so the
   markings are the same *fraction* of an interceptor and of a mothership, and
   because there is not a texel involved they neither shimmer, mip away nor
   dissolve into the plate average. That is the whole point: a painted band has
   to be as legible on a twenty-pixel frigate at five kilometres as it is from
   fifty metres, and a band that lives in a texture never is.

   That property is also this function's failure mode, and it is what the
   round-1 critique reported as "trim decals cut straight across geometry edges
   without respecting the underlying panel breaks". A band that is a pure
   function of position cannot know a panel break exists. Two things fix it and
   neither gives up the scale-invariance:

   - blazon is the hand-placed region mask the hull builders have been writing
     all along (greeble.js::paintTeamMask -> aTeamMask). It is per-triangle,
     so its boundary is a *part* boundary: a hangar face, an armour belt, a
     stern plate. That is paint applied to a ship rather than to a mesh.
   - the analytic bands are now stepped by plate cell rather than run straight.
     The cell grid is at exactly the plate pitch the atlas is tiled at, so an
     edge that jitters cell by cell lands on the panel rhythm instead of
     slicing through it, and a fraction of plates take no paint at all — the
     replacement panel nobody got round to repainting.

   blazon is a paint mask and nothing else. It must never be routed into the
   team index: the shader reads that as "which faction", and a player hull whose
   painted regions resolved to team 1 would wear enemy amber on every one of
   them. The two channels stay separate all the way through.

   Returns the primary mask; the accent output carries the secondary. */
float vsLivery( vec3 P, vec3 GN, float blazon, float hostile, out float accent, out float fieldOut, out float runLight ) {
  float rho = max( length( P.xy ), 1e-3 );  // local girth radius, metres
  float ax = abs( P.x ) / rho;              // 0 on the centreline, ~1 at the beam
  float ay = P.y / rho;                     // -1 keel .. +1 spine

  /* Only strongly axis-aligned faces take paint. A loose threshold here puts a
     stripe on the top of every greeble box on the hull, which does not read as
     a painted band — it reads as a tinted ship, and that is the one thing the
     livery must never do. */
  float deck = smoothstep( 0.48, 0.80, abs( GN.y ) );
  float flank = smoothstep( 0.44, 0.78, abs( GN.x ) );

  /* One cell per plate, in object metres. uPlateCell is the reciprocal of the
     same plate size that sets uBaseTiling, so this grid and the plating in the
     atlas share a pitch by construction — which is the only reason a stepped
     edge reads as following a seam rather than as noise. */
  vec3 cid = floor( P * uPlateCell + 0.37 );
  float j0 = vsHash13( cid + 7.13 );
  float j1 = vsHash13( cid * 1.37 - 3.11 );

  float axj = ax + ( j0 - 0.5 ) * uPlateJit.x;
  float ayj = ay + ( j1 - 0.5 ) * uPlateJit.x;

  /* Everything here runs the full length of the hull, because a longitudinal
     band is the only marking whose position does not have to be worked out
     from a hull length this material is never told. It is also the strongest
     shape available: a stripe down the spine survives being twenty pixels tall
     in a way that a roundel or a stern flash never could. */

  // 1. dorsal and ventral spine stripe
  float spine = deck * ( 1.0 - smoothstep( uSpine.x - uSpine.y, uSpine.x + uSpine.y, axj ) );

  // 2. shoulder pinstripes, just outboard of the spine — a two-line livery
  //    reads as deliberate where a single band can read as a lighting accident
  float sh = abs( axj - uShoulder.x );
  float shoulder = deck * ( 1.0 - smoothstep( uShoulder.y * 0.6, uShoulder.y, sh ) );

  // 3. flank stripe at a fixed fraction of the hull's local height
  float side = flank
    * ( 1.0 - smoothstep( uFlank.y - uFlank.z, uFlank.y + uFlank.z, abs( ayj - uFlank.x ) ) );

  /* R7: the two yards paint by different rules, so livery is a shape cue as
     well as a hue. The player runs unbroken lines down the keel axis. The
     hostile yard breaks its spine stripe into segments and swaps the flank
     stripe for short transverse bars across the side, the way its plating is
     built in rings. Spacing is in girths, like everything else here. */
  float segZ = fract( P.z / max( rho * 1.5, 1e-3 ) );
  spine *= mix( 1.0, step( segZ, 0.55 ), hostile );
  shoulder *= 1.0 - hostile * 0.7;
  float barZ = fract( P.z / max( rho * 2.6, 1e-3 ) + 0.3 );
  float bars = flank * step( barZ, 0.13 ) * ( 1.0 - smoothstep( 0.45, 0.70, abs( ayj ) ) );
  side = mix( side, bars, hostile );

  /* Running lights ride just outboard of the shoulder stripe as dashes spaced
     by girth, which puts them exactly where the eye is already looking. They
     take the unjittered axis on purpose — a light is a fitting bolted to the
     hull, not paint sprayed on to it, so it has no reason to follow a seam. */
  float rim = 1.0 - smoothstep( 0.0, uShoulder.z, abs( ax - uShoulder.x - uShoulder.y * 1.9 ) );
  float ph = fract( P.z / max( rho * uRun, 1e-3 ) );
  float dash = smoothstep( 0.50, 0.55, ph ) * ( 1.0 - smoothstep( 0.70, 0.75, ph ) );
  runLight = deck * rim * dash;

  // A plate that never got its coat back. Applies to every painted mark alike.
  float skip = 1.0 - step( uPlateJit.y, j1 );

  /* The authored region joins the *secondary* channel, not the primary, and
     that is a colour decision rather than a plumbing one. The secondary is the
     deep teal / crimson-rust half of the faction pair; the primary is the
     bright trim. A large area of bright trim does not read as a warship, it
     reads as a toy — measured on the first pass of this change, where the
     destroyer came back more cyan than grey. A broad dark painted block with
     the bright stripe running across it is both the restrained option and the
     one the reference genre actually uses.

     The stripe keeps priority where the two overlap: HULL_BODY subtracts the
     primary from the secondary, so a band crossing a blazon stays bright. */
  /* R7: the field is handed back on its own so HULL_BODY can lay it on as a
     restrained wash rather than a solid coat. A whole wing in solid secondary
     was the toy-plane read the round-6 critique called out. */
  fieldOut = clamp( blazon, 0.0, 1.0 ) * skip;
  accent = clamp( max( side, shoulder ) * skip, 0.0, 1.0 );
  return clamp( spine * skip, 0.0, 1.0 );
}
`;

const HULL_BODY = /* glsl */`
{
  vec3 P = vObjPos;
  vec3 GN = normalize( vObjNormal );
  vec3 W = pow( abs( GN ), vec3( uBlendSharp ) );
  W /= max( 1e-4, W.x + W.y + W.z );

  vec4 A = vsTri( uPlateMap, P, W, uBaseTiling, uPlateLayer );
  vec4 O = vsTri( uPlateOrm, P, W, uBaseTiling, uPlateLayer );

  /* Faction, needed up front now: the plating itself is built per yard. */
  float teamP = uTeam;
#ifdef VS_ATTRIBS
  teamP = clamp( uTeam + vAttr.y, 0.0, 1.0 );
#endif
  float hostile = step( 0.5, teamP );
  float pSeam, pV, pR, pGrime, pEdge, pRib;
  vec3 pTilt;
  vsPanels( P, GN, hostile, pSeam, pTilt, pV, pR, pGrime, pEdge, pRib );

  vec3 tX = texture( uPlateNormal, vec3( P.zy * uBaseTiling, uPlateLayer ) ).xyz * 2.0 - 1.0;
  vec3 tY = texture( uPlateNormal, vec3( P.zx * uBaseTiling, uPlateLayer ) ).xyz * 2.0 - 1.0;
  vec3 tZ = texture( uPlateNormal, vec3( P.xy * uBaseTiling, uPlateLayer ) ).xyz * 2.0 - 1.0;

  /* The atlas normal is now fine detail under the analytic plating, so it is
     run at under half strength and faded out entirely once its texels drop
     below a couple of pixels: that is where the crawl came from. */
  float nk = uNormalStrength * 0.40
    * ( 1.0 - smoothstep( 1.5, 8.0, vsFootprint( P.zy * uBaseTiling, uPlateTexels ) ) );

  /* Whiteout triplanar normal blend — folds the geometric normal into every
     plane so curved hulls keep their curvature. */
  tX = vec3( tX.xy * nk + GN.zy, abs( tX.z ) * GN.x );
  tY = vec3( tY.xy * nk + GN.zx, abs( tY.z ) * GN.y );
  tZ = vec3( tZ.xy * nk + GN.xy, abs( tZ.z ) * GN.z );
  vec3 objN = normalize( tX.zyx * W.x + tY.yzx * W.y + tZ.xyz * W.z );
  objN = normalize( objN + pTilt );

  /* Albedo: the yard's own hull colour at the atlas's mean value (so the
     lighting contract, tuned on the atlas, still holds), varied per plate. The
     atlas survives only as a faint luminance modulation; at full strength it
     was the stucco and the camouflage. */
  vec3 aAvg = textureLod( uPlateMap, vec3( 0.5, 0.5, uPlateLayer ), 16.0 ).rgb;
  float aL = max( dot( aAvg, VS_LUMA ), 0.02 );
  vec3 hullC = mix( uHullA, uHullB, hostile );
  hullC = hullC / max( dot( hullC, VS_LUMA ), 1e-3 ) * aL * mix( 0.96, 1.20, hostile );
  float detail = clamp( dot( A.rgb, VS_LUMA ) / aL, 0.4, 1.8 );
  vec3 albedo = hullC * pV * mix( 1.0, detail, 0.18 );
  albedo *= 1.0 - pSeam * mix( 0.62, 0.66, hostile );
  albedo *= 1.0 - pGrime * 0.36;

  /* Hostile weathering: long rust-brown streaks that run aft with the keel
     axis, held dark and low in chroma so they read as age, not as team. */
  float rn = vsNoise3( vec3( P.x, P.y, P.z * 0.16 ) / uPanel * 0.8 );
  float rust = hostile * smoothstep( 0.55, 0.85, rn ) * 0.40;
  albedo = mix( albedo, vec3( 0.32, 0.20, 0.13 ) * ( aL / 0.215 ) * 0.70, rust );
  albedo *= 1.0 + pEdge * 0.12;

  /* Player plates are clean, smooth gunmetal; hostile plates are rough and
     dull. The atlas keeps a third of its say. */
  float rough = mix( mix( 0.40, 0.64, hostile ), O.g, 0.33 ) + pR + pGrime * 0.14 + rust * 0.12;
  float metal = mix( mix( 0.46, 0.22, hostile ), O.b, 0.33 ) + pEdge * 0.30;
  float ao = mix( 1.0, O.r, 0.5 ) * ( 1.0 - pSeam * 0.45 );
  rough += pSeam * 0.20;   // a groove holds no highlight
  /* Paint cover was the atlas alpha, laid down as random patches: the
     camouflage. Paint now only goes at a plate's worn edge. */
  float paintCover = mix( 1.0, A.a, 0.12 ) * ( 1.0 - pEdge * 0.7 );   // 1 = coat, 0 = bare
  vec3 emis = vec3( 0.0 );
  float emisTeam = 0.0;
  float accentMask = 0.0;

  /* Which of the four hull materials this fragment's *geometry* asked for.
     aVariant is written per part by greeble.js from PLATE.HULL/ARMOUR/
     PANEL/MECH, so the selector below is authored data, not a texture lookup —
     which is why the boundary between two materials always falls on a part
     boundary and never mid-plate. */
  float fv = uVariant;
#ifdef VS_ATTRIBS
  fv = uVariant + vAttr.z;   // offset, not replacement — see the team note
#endif
  // Selected with steps rather than a dynamic index: HLSL codegen warns on
  // dynamically indexed vectors and the branchless form is free anyway.
  float si = mod( floor( fv ), 4.0 );
  vec4 sel = vec4( step( si, 0.5 ),
                   step( 0.5, si ) * step( si, 1.5 ),
                   step( 1.5, si ) * step( si, 2.5 ),
                   step( 2.5, si ) );

  /* The macro layer only covers where it stamps, so on its own the four
     materials would differ only inside a hatch or a sub-panel and the metres of
     plating between them would stay one grey — which is what the round-1
     critique measured. This is the same four materials as a tone on the plate
     itself: bone superstructure, slate hull, dark matte belt armour, near-black
     machinery with bare alloy under the wear. Applied before the macro mixes
     over it, so the stamps land on top of a surface that already agrees with
     them. */
  vec4 matTone = uMacroTone * sel;   // not "tone" — that name is taken further down
  albedo *= mix( vec3( 1.0 ), matTone.rgb, 0.65 );
  rough = clamp( rough + matTone.w, 0.0, 1.0 );
  metal = clamp( metal + dot( uMacroMetal, sel ), 0.0, 1.0 );

#ifdef VS_MACRO
  {
    float ml = dot( uMacroSlots, sel );

    vec4 mA = vsTri( uMacroMap, P, W, uMacroTiling, ml );
    vec4 mO = vsTri( uMacroOrm, P, W, uMacroTiling, ml );

    vec3 nX = texture( uMacroNormal, vec3( P.zy * uMacroTiling, ml ) ).xyz * 2.0 - 1.0;
    vec3 nY = texture( uMacroNormal, vec3( P.zx * uMacroTiling, ml ) ).xyz * 2.0 - 1.0;
    vec3 nZ = texture( uMacroNormal, vec3( P.xy * uMacroTiling, ml ) ).xyz * 2.0 - 1.0;
    nX = vec3( nX.xy * uNormalStrength + GN.zy, abs( nX.z ) * GN.x );
    nY = vec3( nY.xy * uNormalStrength + GN.zx, abs( nY.z ) * GN.y );
    nZ = vec3( nZ.xy * uNormalStrength + GN.xy, abs( nZ.z ) * GN.z );
    vec3 macroN = normalize( nX.zyx * W.x + nY.yzx * W.y + nZ.xyz * W.z );

    /* The macro stamps (hatches, window rows, sub-panels) now modulate the
       yard's surface instead of replacing it, so a stamp keeps its shape
       without dropping the atlas's own grey into the middle of a hull. */
    float cov = clamp( mA.a, 0.0, 1.0 );
    albedo = mix( albedo, albedo * clamp( mA.rgb / max( aAvg, vec3( 0.02 ) ), 0.25, 2.2 ), cov * 0.85 );
    rough = mix( rough, mO.g, cov * 0.6 );
    metal = mix( metal, mO.b, cov );
    ao = min( ao, mix( 1.0, mO.r, cov ) );
    objN = normalize( mix( objN, macroN, cov ) );
    accentMask = mO.a * cov;

  #ifdef VS_EMISSIVE
    vec4 E = vsTri( uMacroEmis, P, W, uMacroTiling, ml );
    emis = E.rgb * cov;
    emisTeam = E.a;
  #endif
  }
#endif

  /* Per-vertex wear, written by greeble.js::applyWear around thruster mouths,
     along the leading edge and out at the extremities. It reached nothing until
     now — the attribute was never declared — which is the other half of the
     round-1 "no wear" finding. Shaped rather than used raw: the field carries a
     ~0.1 noise floor across the whole hull and taking that literally sands the
     entire ship evenly, which is the opposite of what wear is for. */
  float wear = 0.0;
#ifdef VS_ATTRIBS
  wear = smoothstep( 0.10, 0.85, clamp( vPaint.y, 0.0, 1.0 ) );
#endif
  paintCover *= 1.0 - wear * 0.85;
  albedo *= 1.0 + wear * 0.26;      // scoured back to the brighter alloy beneath
  rough = clamp( rough + wear * 0.13, 0.0, 1.0 );
  metal = clamp( metal + wear * 0.34, 0.0, 1.0 );

  /* Specular anti-aliasing. Mip-filtered normals flatten out with distance,
     which under-roughens the surface and makes a fleet of distant hulls
     sparkle. Widen the lobe to match what the normal map has lost. */
  float fp = vsFootprint( P.zy * uBaseTiling, uPlateTexels );
  rough = rough + smoothstep( 1.5, 30.0, fp ) * 0.18;

  /* Team colour. */
  /* Instanced parity. The per-instance attributes are *offsets*, never the
     whole truth: a batch whose geometry never supplied aTeam reads 0 for every
     instance, and taking that literally would render an entire enemy squadron
     in player colours. The material is already built per team, so the uniform
     is authoritative and the attribute only shifts a mixed batch off it. */
  float team = uTeam;
  float dmg = uDamage;
#ifdef VS_ATTRIBS
  team = clamp( team + vAttr.y, 0.0, 1.0 );
  dmg = max( dmg, clamp( vAttr.x, 0.0, 1.0 ) );
#endif
  vec3 trimCol = mix( uTrimA, uTrimB, team );
  vec3 secCol = mix( uSecA, uSecB, team );
  vec3 lightCol = mix( uLightA, uLightB, team );

#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
  /* instanceColor is per-instance *variation*, never identity. It is applied at
     a fraction on purpose: whatever SIM decides to put in there — a selection
     tint, a veterancy shade, a squadron marking — team colour has to survive it
     intact, because the player reads faction off these bands before anything
     else on screen. A straight multiply here would let a grey instance colour
     quietly wash the livery out. */
  vec3 iv = mix( vec3( 1.0 ), vColor, 0.30 );
  trimCol *= iv;
  secCol *= iv;
  lightCol *= iv;
  albedo *= mix( vec3( 1.0 ), vColor, 0.10 );
#endif

  /* The hand-placed livery regions. aTeamMask has been written by every hull
     builder in ships/ since the fleet was authored and was reaching nothing,
     because this material declared the attribute next to it under a different
     name. It is a *paint* mask and is kept well away from team above; routing
     it into the team index instead would have painted every marked region on a
     player hull in enemy amber, which is the one failure the livery may not
     have. */
  float blazon = 0.0;
#ifdef VS_ATTRIBS
  blazon = clamp( vPaint.x, 0.0, 1.0 );
#endif

  float runLight = 0.0;
  float accent = 0.0;
  float fieldM = 0.0;
  float livery = vsLivery( P, GN, blazon, hostile, accent, fieldM, runLight );

  /* Erode the paint edges. Multiplying a soft-edged mask by noise and
     re-thresholding leaves the middle of a band solid and chews the boundary,
     which is what a sprayed edge that has taken twenty years of micrometeorite
     does. Paint also cannot survive where the plate under it has already lost
     its coat, so the plate layer's own coverage gates the livery. */
  float chip = vsNoise3( P * uBaseTiling * 22.0 ) * 0.55 + vsNoise3( P * uBaseTiling * 64.0 ) * 0.45;
  float coat = mix( 0.55, 1.0, smoothstep( 0.05, 0.45, paintCover ) );
  livery = smoothstep( 0.40, 0.58, livery * ( 0.90 + mix( 0.12, 0.30, hostile ) * chip ) ) * coat;
  accent = smoothstep( 0.40, 0.58, accent * ( 0.90 + mix( 0.12, 0.30, hostile ) * chip ) ) * coat;
  accent = max( accent, smoothstep( 0.40, 0.58, fieldM * ( 0.90 + 0.10 * chip ) ) * coat * 0.42 );

  /* The atlas accent mask adds close-range pinstripes on top; it is detail, so
     it is allowed to disappear into the mip chain with everything else. */
  float fine = smoothstep( 0.74, 0.94, accentMask ) * 0.75;
  float fineSec = smoothstep( 0.34, 0.52, accentMask ) * ( 1.0 - fine ) * 0.6;

  float primary = clamp( max( livery, fine ) * uLiveryGain, 0.0, 1.0 );
  float secondary = clamp( max( accent, fineSec ) * uLiveryGain, 0.0, 1.0 ) * ( 1.0 - primary );
  float painted = clamp( primary + secondary, 0.0, 1.0 );

  /* Livery is *colourised*, not replaced: scaling by the underlying luminance
     keeps panel lines, rivets and wear reading straight through the paint. A
     flat fill here is what makes team colour look like a decal sticker. */
  /* A narrow tone window. Let it run wide and the paint picks up every plate's
     brightness variation and starts to look self-illuminated instead of
     painted; this keeps the enamel at a consistent value and lets the plating
     underneath modulate it only gently. */
  float luma = dot( albedo, VS_LUMA );
  float tone = clamp( 0.34 + luma * 1.9, 0.42, 1.02 );
  albedo = mix( albedo, secCol * tone, secondary * uTrimStrength );
  albedo = mix( albedo, trimCol * tone, primary * uTrimStrength );

  /* Enamel, not lacquer. A warship's markings are sprayed matte and then left
     in vacuum for a decade; the previous build's low-roughness trim was the
     glossy smear that gave the whole thing away. Weathering roughens it
     further, and it is a dielectric, so it never picks up a metal highlight. */
  rough = mix( rough, clamp( 0.52 + ( 1.0 - coat ) * 0.20 + chip * 0.05, 0.34, 0.88 ), painted );
  metal = mix( metal, 0.03, painted );

#ifdef VS_EMISSIVE
  /* The emissive alpha flags a team running light; everything else is warm
     interior glass. Gains sit deliberately below the bloom threshold — hulls
     do not bloom, only engines and weapons do (§3.6). */
  vsEmissive = emis * mix( uWindowColour, lightCol * 1.3, emisTeam ) * uEmissiveGain;
#else
  vsEmissive = vec3( 0.0 );
#endif
  vsEmissive += lightCol * runLight * coat * uRunGain;

  /* Damage: scorch, exposed hot metal, flickering cracks. */
  if ( dmg > 0.002 ) {
    float dn = vsNoise3( P * ( uBaseTiling * 1.6 ) + 11.3 );
    float dn2 = vsNoise3( P * ( uBaseTiling * 5.5 ) - 3.1 );
    float field = dn * 0.72 + dn2 * 0.28;
    /* Burned area must GROW with damage. It used to be
       smoothstep( 1.02 - dmg * 1.25, 0.72 - dmg * 1.25, field ): reversed
       edges, so it burned wherever field < 0.72 - 1.25 * dmg, a threshold
       that FALLS as damage rises. vsNoise3 is value noise in [0, 1], so past
       about 58% damage that threshold went below zero and the scorch vanished
       entirely - heavily damaged ships looked pristine, and lightly damaged
       ones carried the most hot emissive. That inversion, not the colour
       alone, is what put a lava pattern on a lightly hit friendly frigate in
       critic round 3. Now the burned share of the hull tracks the damage
       fraction, and the albedo never goes fully black, so even a dying hull
       keeps a readable form. */
    float burn = 1.0 - smoothstep( dmg * 1.05 - 0.12, dmg * 1.05 + 0.04, field );
    float heat = 0.5;
    float wreck = 0.0;
#ifdef VS_ATTRIBS
    /* R6: scorch only around the hull's own recorded hits. Each hit burns a
       zone whose radius grows with the damage fraction, and the noise field
       above bends its edge so a zone reads as a burn, not a circle. Eight
       distance tests and nine texel fetches; LOD3 is the unlit impostor and
       never gets here. heat is how recently the zone was hit: cracks are
       white-hot for the first few seconds and then cool to a dull red. */
    int hitRow = int( vHitRow + 0.5 );
    float hullLen = texelFetch( uHitTex, ivec2( 8, hitRow ), 0 ).x;
    float rad = max( hullLen * ( 0.055 + 0.10 * dmg ), 1e-3 );
    float edge = ( field - 0.5 ) * rad * 1.1;
    burn = 0.0;
    heat = 0.0;
    for ( int i = 0; i < 8; i++ ) {
      vec4 h = texelFetch( uHitTex, ivec2( i, hitRow ), 0 );
      float s = 1.0 - smoothstep( rad * 0.45, rad, distance( P, h.xyz ) + edge );
      burn = max( burn, s );
      heat = max( heat, s * exp( -max( uTime - h.w, 0.0 ) * 0.6 ) );
    }
    /* A wreck is charred all over and long cold: its own darker char, not the
       hot-crack look of a hull still in the fight. */
    wreck = ( vCut.y > vCut.x || dmg > 0.995 ) ? 1.0 : 0.0;
    burn = mix( burn, 0.72 + 0.28 * smoothstep( 0.3, 0.7, field ), wreck );
    heat *= 1.0 - wreck;
#endif
    albedo = mix( albedo, mix( vec3( 0.030, 0.026, 0.024 ), vec3( 0.011, 0.010, 0.009 ), wreck ), burn * 0.9 );
    rough = mix( rough, 0.93, burn );
    metal = mix( metal, 0.28, burn );
    ao = mix( ao, ao * 0.65, burn );
    objN = normalize( mix( objN, GN, burn * 0.45 ) );
    float flicker = 0.62 + 0.38 * sin( uTime * 7.3 + field * 41.0 )
      * ( 0.5 + 0.5 * sin( uTime * 2.1 + field * 13.0 ) );
    /* Hot metal shows only along thin cracks inside the burned area, never
       as a filled region. This used to drive the emissive from a broad
       smoothstep over the same field as the scorch, at 2.4x, so a damaged
       hull glowed orange over about a third of its surface: the enemy's hue
       family on a friendly ship, reading as paint rather than damage
       (critic round 3, first-contact close frame). A crack here is the zero
       crossing of a second, finer noise, kept only where the scorch is
       already heavy, and its colour is pushed toward white-hot so the read
       is heat rather than team. */
    float cn = vsNoise3( P * ( uBaseTiling * 9.0 ) + 5.7 );
    float crack = 1.0 - smoothstep( 0.0, 0.022, abs( cn - 0.5 ) );
    float hot = crack * smoothstep( 0.6, 0.95, burn );
    /* Fresh: white-hot. Cooled: a dull dark red, about a fifth as bright.
       A wreck keeps only the faintest embers. */
    vec3 hotCol = mix( vec3( 0.42, 0.05, 0.015 ), vec3( 1.0, 0.88, 0.72 ), heat );
    float hotGain = mix( 0.35, 2.4, heat ) * ( 1.0 - 0.8 * wreck );
    vsEmissive += hotCol * hot * max( dmg, 0.35 ) * flicker * hotGain;
  }

  vsAlbedo = albedo;
  vsRough = clamp( rough, 0.055, 1.0 );
  vsMetal = clamp( metal, 0.0, 1.0 );
  vsAO = clamp( mix( 1.0, ao, uAoStrength ), 0.0, 1.0 );
  vsObjN = objN;
  vsHue = albedo / max( dot( albedo, VS_LUMA ), 1e-4 );
}
diffuseColor.rgb *= vsAlbedo;
`;

/* ---------------------------------------------------------- terminator

   §3.2 asks for one key light with a *hard* terminator, and a Lambertian
   cosine does not give one. Measured on the hero mothership across seven
   seeds, the middle half of the hull spanned only 2.0-3.5x in encoded value
   and the ship read as a grey model under a softbox rather than as a solid
   object with a lit face and a dark one.

   The instinct is to blame the shadow-side lifts, and that instinct is wrong:
   killing every one of them at once — this material's hemispheric bounce, its
   fresnel rim, the env map, and ENV's own hemisphere and ambient lights —
   moved the interquartile ratio from 2.83 to 3.54 and the median by 0.02
   (`.local/matablate.mjs`). The flatness is not fill. It is that the opening
   camera sits 46-76 degrees off the key, so almost every visible face has a
   cosine somewhere between 0.3 and 0.8, and Lambert maps that whole band into
   a narrow, uniform mid-grey.

   So the cosine is shaped rather than the fill trimmed. `uTerm` is
   (gamma, gain): the incident light is scaled so that N.L behaves as
   pow(N.L, gamma) * gain, with gain chosen to hold a pivot cosine fixed.
   Faces above the pivot are pushed into the tone-map knee and settle into one
   even lit value; faces below it fall away fast, so the transition happens
   over a narrow band of angle instead of across the whole hull. Faces the key
   never reaches are untouched — the bounce still owns them, and "lifted,
   never black" survives intact.

   It is applied to the incident light rather than to the diffuse result on
   purpose. The specular lobe is shaped with it, which matters more than it
   sounds: at 46-76 degrees off-key a broad GGX lobe on a roughness-0.49 hull
   is a grazing wash across every surface at once, and it was flattening the
   image alongside the diffuse.

   gamma = 1 with gain = 1 is exactly stock Lambert, which is what makes this
   safe to dial from a probe. */
const HULL_TERMINATOR = /* glsl */`
void RE_Direct_VS( const in IncidentLight directLight, const in vec3 geometryPosition,
    const in vec3 geometryNormal, const in vec3 geometryViewDir,
    const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material,
    inout ReflectedLight reflectedLight ) {
  IncidentLight vsLight = directLight;
  float vsNdL = saturate( dot( geometryNormal, directLight.direction ) );
  vsLight.color *= vsNdL > 1e-4 ? pow( vsNdL, uTerm.x - 1.0 ) * uTerm.y : 0.0;
  RE_Direct_Physical( vsLight, geometryPosition, geometryNormal, geometryViewDir,
    geometryClearcoatNormal, material, reflectedLight );
}
#undef RE_Direct
#define RE_Direct RE_Direct_VS
`;

const HULL_AO = /* glsl */`
reflectedLight.indirectDiffuse *= vsAO;
reflectedLight.indirectSpecular *= mix( 1.0, vsAO, 0.6 );
{
  /* Chroma discipline (§3.3). The key star takes its colour from whichever sky
     palette the seed picked, and a 3.1-intensity coloured key does not light a
     grey hull — it dyes it. That is how both fleets ended up reading as the
     same warm tan mass. So the *illuminant's* chroma is stripped out of the
     direct term and only softened in the indirect one: the hull is bare steel
     wherever the star reaches it, and the nebula keeps the shadow side, which
     is precisely the brief. Whitening toward the surface's own hue rather than
     toward grey means painted livery is untouched — its colour is the paint's,
     not the light's, and it survives at full chroma. */
  vec3 hd = vsHue;
  vec3 hs = mix( vec3( 1.0 ), vsHue, vsMetal );
  reflectedLight.directDiffuse = vsWhiten( reflectedLight.directDiffuse, hd, uChroma.x );
  reflectedLight.directSpecular = vsWhiten( reflectedLight.directSpecular, hs, uChroma.x );
  reflectedLight.indirectDiffuse = vsWhiten( reflectedLight.indirectDiffuse, hd, uChroma.y );
  reflectedLight.indirectSpecular = vsWhiten( reflectedLight.indirectSpecular, hs, uChroma.y );
}
`;

const HULL_BOUNCE = /* glsl */`
{
  /* Hemispheric nebula bounce. Without this the shadow side crushes to black
     and the ship stops reading as a solid object — the single most important
     Homeworld cue there is. viewMatrix is orthonormal, so a transposed multiply
     rotates view space back to world space for free.

     It doubles as a stand-in image-based light: bare metal has no diffuse
     term at all, so without a reflected-direction sky sample every worn panel
     would render black until ENV hands us a real env map. This is added after
     the chroma pass on purpose — it is the one term that is *meant* to be
     nebula-coloured. */
  vec3 wN = normalize( ( vec4( nonPerturbedNormal, 0.0 ) * viewMatrix ).xyz );
  vec3 wNp = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  vec3 wV = normalize( ( vec4( vViewPosition, 0.0 ) * viewMatrix ).xyz );
  vec3 f0 = mix( vec3( 0.045 ), diffuseColor.rgb, vsMetal );
  float gloss = 1.0 - vsRough;

  /* Every term here is *directional*. There is deliberately no constant floor:
     an ambient offset added to all three lifts the shadow side into mid-grey
     and the hull stops reading as a solid object in hard sunlight — it starts
     reading as a model on a turntable. The diffuse term is weighted by how much
     of the bright half of the sky the normal actually sees, the reflected term
     is a real mirror lobe that vanishes as the surface roughens, and the rim is
     pure Fresnel, so all three go to zero on a face that is both away from the
     nebula and facing the camera square on. "Lifted, never black" has to mean
     0.02–0.05 in linear light, not 0.25. */
  float skyN = wN.y * 0.5 + 0.5;
  vec3 hemiN = mix( uNebulaFill, uNebulaKey, skyN );
  vec3 R = reflect( - wV, wNp );
  vec3 hemiR = mix( uNebulaFill, uNebulaKey, R.y * 0.5 + 0.5 );

  outgoingLight += hemiN * diffuseColor.rgb * uBounce.x
    * ( 0.35 + 0.65 * skyN ) * ( 1.0 - vsMetal * 0.85 ) * vsAO;
  outgoingLight += hemiR * f0 * uBounce.x * gloss * gloss * vsAO;

  /* Cold rim (§3.2, "cold rim/fill bounce from the nebula"). A thin edge
     line on the shadow side, which is what separates a dark gunmetal hull from
     a dark rock behind it and stops a hull in front of the planet reading as a
     flat black sticker.

     Three factors, and each one is there to keep it an edge rather than a
     glow:
       edge   - Fresnel on the *unperturbed* normal, cubed, so it fires where
                the hull turns away from the lens and is nothing on a face
                square to it. Hulls are faceted: a fifth power found almost no
                face oblique enough to light, and drew nothing. The
                panel-mapped normal would put a speckle of rim on every plate
                seam across the face of the hull.
       dark   - zero on any face the key reaches, so the lit side and the
                terminator are exactly what they were. It is not a fill: it
                cannot lift the shadow side, only outline it.
       facing - weighted toward the counter-key, where a nebula bounce would
                actually come from, but never to zero, so the edge survives
                when the camera itself sits on the counter-key side.
     Cold and neutral by construction (RIM_COLD), and added after the chroma
     pass so team paint does not tint it. */
  {
    float eV = 1.0 - saturate( dot( wN, wV ) );
    float edge = eV * eV * eV;
    float nk = dot( wN, uKeyDir );
    float dark = 1.0 - smoothstep( -0.04, 0.22, nk );
    float facing = 0.45 + 0.55 * saturate( - nk );
    outgoingLight += uRimCold * ( uBounce.y * ${RIM_GAIN.toFixed(3)} )
      * edge * dark * facing * mix( 1.0, 0.6, vsRough ) * vsAO;
  }
}
`;

const HULL_VERT_PARS = /* glsl */`
uniform float uModelScale;
varying vec3 vObjPos;
varying vec3 vObjNormal;
flat varying mat3 vObjToView;
#ifdef VS_ATTRIBS
  /* Two separate groups, and the split is load-bearing.

     aDamage and aTeam are *per-instance* channels SIM may supply on a batch
     to shift a subset of it off the material's own team and damage uniforms.
     Nothing writes them today and an absent attribute reads 0, which is the
     documented no-op.

     aTeamMask, aVariant and aWear are *per-vertex* and every part built by
     greeble.js writes all three. aVariant picks the hull material; aTeamMask
     is the hand-placed livery region; aWear is scouring near thrusters and
     leading edges. aTeamMask is emphatically not a team index — see vsLivery. */
  attribute float aDamage;
  attribute float aTeam;
  attribute float aVariant;
  attribute float aTeamMask;
  attribute float aWear;
  /* Wreck sections (R5). x..y is the slice of the hull's own keel (object z)
     this instance keeps; (0, 0), which is what an absent attribute reads, keeps
     all of it. One dead capital is drawn as 2-4 instances of its own class,
     each cut to a section, so a wreck costs no extra draw call. */
  attribute vec2 aCut;
  varying vec3 vCut;
  /* Row of the shared hit texture this instance reads, see uHitTex. */
  attribute float aHitRow;
  flat varying float vHitRow;
  varying vec3 vAttr;
  varying vec2 vPaint;
#endif
`;

const HULL_VERT_BODY = /* glsl */`
vObjPos = position * uModelScale;
vObjNormal = objectNormal;
{
  mat3 nm = normalMatrix;
  #ifdef USE_INSTANCING
    mat3 im = mat3( instanceMatrix );
    vec3 sq = vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
    nm = nm * mat3( im[ 0 ] / sq.x, im[ 1 ] / sq.y, im[ 2 ] / sq.z );
  #endif
  vObjToView = nm;
}
#ifdef VS_ATTRIBS
  vAttr = vec3( aDamage, aTeam, aVariant );
  vPaint = vec2( aTeamMask, aWear );
  vCut = vec3( aCut, position.z );
  vHitRow = aHitRow;
#endif
`;

/* ------------------------------------------------------------------- store */

/* How much of the illuminant's colour the hull refuses. `direct` is high — the
   key star is a searchlight, not a dye bath — and `indirect` is low, so the
   nebula fill keeps its hue where the star does not reach. */
const CHROMA = { direct: 0.86, indirect: 0.26 };

/* Terminator shaping — see HULL_TERMINATOR. `pivot` is the crossover cosine:
   faces above it are lifted, faces below it dropped, and it is held at its
   unshaped value so the pair reads as contrast rather than as exposure.

   Both numbers are measured, not chosen (.local/matablate.mjs, `pivot` set),
   and the pivot is the interesting one because it is not monotonic. Too high
   and the shaping only ever darkens: on the seeds where the key is lateral
   most of the visible hull sits below the crossover, so at 0.90 the darkest
   seed lost a fifth of its median *and* came out flatter than unshaped.
   Too low and the gain it implies drives the whole hull into the tone-map
   knee, which re-flattens it at the bright end instead of the dark one — at
   0.48 the most frontally lit seed measured an interquartile ratio of 2.22,
   worse than doing nothing. 0.62 is near the top of a shallow optimum that
   held on both the brightest and the darkest seed. */
const TERMINATOR = { gamma: 2.0, pivot: 0.62 };
const termGain = () => Math.pow(TERMINATOR.pivot, 1 - TERMINATOR.gamma);
const TERMINATOR_SHARED = { value: new THREE.Vector2(TERMINATOR.gamma, termGain()) };

let store = null;

function hullUniforms(team, family, opts) {
  const atlas = getHullAtlas();
  const tune = FAMILY_TUNING[family] || FAMILY_TUNING.bulwark;
  const liv = LIVERY[family] || LIVERY.bulwark;
  const slots = FAMILY_MACRO_SLOTS[family] || FAMILY_MACRO_SLOTS.bulwark;

  const ps = plateSize(opts.length, tune);
  const baseTiling = 1 / (ATLAS.platesPerRegion * ps);

  /* `slots` is indexed by `PLATE.*`; the shader indexes by the rotated slot
     index `si = (uVariant + aVariant) mod 4`. Those coincide only while
     uVariant is 0, which is the default below, and a caller that rotates the
     whole ship's palette with `opts.variant` gets the tone table rotated with
     the layer table because both are read through the same selector. */
  const tone = new THREE.Matrix4();
  const metalD = new THREE.Vector4();
  const te = [];
  for (let i = 0; i < 4; i++) {
    const t = MACRO_TONE[slots[i]] || MACRO_TONE[0];
    te.push(t.tint[0], t.tint[1], t.tint[2], t.rough);   // column i
    metalD.setComponent(i, t.metal);
  }
  tone.fromArray(te);   // Matrix4.fromArray is column-major, which is the layout above

  const a = TEAM_COLORS[0];
  const b = TEAM_COLORS[1];

  return {
    uPlateMap: { value: atlas.map },
    uPlateNormal: { value: atlas.normalMap },
    uPlateOrm: { value: atlas.roughnessMap },
    uPlateEmis: { value: atlas.emissiveMap },
    uMacroMap: { value: atlas.macroMap },
    uMacroNormal: { value: atlas.macroNormalMap },
    uMacroOrm: { value: atlas.macroRoughnessMap },
    uMacroEmis: { value: atlas.macroEmissiveMap },
    uPlateLayer: { value: familyLayer(family) },
    uMacroSlots: { value: new THREE.Vector4(slots[0], slots[1], slots[2], slots[3]) },
    uMacroTone: { value: tone },
    uMacroMetal: { value: metalD },
    uPlateTexels: { value: atlas.size },
    // One livery cell per plate. Same pitch as the plating, by construction.
    uPlateCell: { value: 1 / ps },
    // (band jitter in girth units, fraction of plates left unpainted)
    // y = 1: every plate keeps its paint. 0.86 left one plate in seven bare,
    // and on a painted field that patchwork was the R6 "blotch camouflage".
    uPlateJit: { value: new THREE.Vector2(0.075, 1.0) },
    uHullA: { value: a.hull.clone() },
    uHullB: { value: b.hull.clone() },
    uPanel: { value: panelSize(opts.length, tune) },
    uBaseTiling: { value: baseTiling },
    uMacroTiling: { value: baseTiling / ATLAS.macroSpan },
    uBlendSharp: { value: 5.0 },
    uNormalStrength: { value: opts.normalStrength === undefined ? 1.0 : opts.normalStrength },
    uTrimA: { value: a.trim.clone() },
    uTrimB: { value: b.trim.clone() },
    uSecA: { value: a.secondary.clone() },
    uSecB: { value: b.secondary.clone() },
    uLightA: { value: a.light.clone() },
    uLightB: { value: b.light.clone() },
    uWindowColour: { value: new THREE.Color(0xffd9ac) },
    uHotColour: { value: new THREE.Color(0xff5a1e) },
    uTeam: { value: team === 1 ? 1 : 0 },
    /* Zero by default, so `si` is exactly the `PLATE.*` value the geometry
       asked for and every family's slot table can be read in plain semantic
       order. It used to default to `team * 2 + 1`, which rotated the mapping
       per faction: the enemy's belt armour was drawn with the layer meant for
       superstructure skin and vice versa. Faction reads off trim colour, engine
       colour and running lights — never off which macro layer the armour belt
       happens to be using — so there was nothing to buy with the rotation and
       four correct material assignments to lose. */
    uVariant: { value: opts.variant === undefined ? 0 : opts.variant },
    uTrimStrength: { value: (opts.trim === undefined ? 1 : opts.trim) * tune.trim },
    uLiveryGain: { value: opts.livery === undefined ? 1 : opts.livery },
    uEmissiveGain: { value: opts.emissive === undefined ? tune.emissive : opts.emissive },
    // Running lights are emitters, so they are allowed over the bloom
    // threshold — they are half of what tells you whose ship this is at 5 km.
    uRunGain: { value: opts.runLights === undefined ? 1.9 : opts.runLights },
    uAoStrength: { value: opts.ao === undefined ? 1.0 : opts.ao },
    uDamage: { value: opts.damage || 0 },
    uTime: SHARED_TIME,
    uHitTex: HIT_TEX,
    uSpine: { value: new THREE.Vector2(liv.spine[0], liv.spine[1]) },
    uFlank: { value: new THREE.Vector3(liv.flank[0], liv.flank[1], liv.flank[2]) },
    uShoulder: { value: new THREE.Vector3(liv.shoulder[0], liv.shoulder[1], liv.shoulder[2]) },
    uRun: { value: liv.run },
    uNebulaKey: { value: NEBULA.key.clone() },
    uNebulaFill: { value: NEBULA.fill.clone() },
    uBounce: { value: new THREE.Vector2(NEBULA.ambient, NEBULA.rim) },
    uChroma: { value: new THREE.Vector2(CHROMA.direct, CHROMA.indirect) },
    uTerm: { value: new THREE.Vector2(TERMINATOR.gamma, termGain()) },
    uKeyDir: { value: NEBULA.keyDir.clone() },
    uRimCold: { value: RIM_COLD.clone() },
    uModelScale: { value: opts.modelScale === undefined ? 1 : opts.modelScale },
  };
}

/* Wreck-section clip, see aCut. Runs before any shading work. */
const HULL_CUT = /* glsl */`
#ifdef VS_ATTRIBS
  if ( vCut.y > vCut.x && ( vCut.z < vCut.x || vCut.z > vCut.y ) ) discard;
#endif
`;

function patchHull(material, uniforms, flags) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${HULL_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${HULL_VERT_BODY}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HULL_PARS}`)
      // After the physical chunk, so RE_Direct_Physical exists to delegate to
      // and the #define it installs is the one being overridden.
      .replace(
        '#include <lights_physical_pars_fragment>',
        `#include <lights_physical_pars_fragment>\n${HULL_TERMINATOR}`,
      )
      .replace('#include <map_fragment>', HULL_CUT + HULL_BODY)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vsRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vsMetal;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize( vObjToView * vsObjN );')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += vsEmissive;')
      .replace('#include <aomap_fragment>', HULL_AO)
      .replace('#include <opaque_fragment>', `${HULL_BOUNCE}\n#include <opaque_fragment>`)
      .replace('#include <fog_pars_fragment>', `${HULL_HAZE_DEFINE}#include <fog_pars_fragment>`);

    material.userData.shader = shader;
  };

  material.customProgramCacheKey = () => `vs-hull:${flags}`;
  material.userData.uniforms = uniforms;
  material.userData.bloom = false; // hulls never bloom
  return material;
}

function buildHullMaterial(team, family, opts, instanced) {
  const quality = store.quality;
  const useMacro = quality !== 'low';
  const useEmissive = quality !== 'low' || family === 'monolith';

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 1.0,
    emissive: 0x000000,
    /* Deliberately restrained. `scene.environment` is the nebula itself, and at
       a high intensity it paints the whole hull the colour of the sky — which
       is the same failure as a coloured key. The controlled hemispheric bounce
       below does the nebula's job with a dial we own. */
    envMapIntensity: opts.envMapIntensity === undefined ? 0.24 : opts.envMapIntensity,
    dithering: true,
    side: THREE.FrontSide,
    flatShading: false,
  });
  mat.name = `vs.hull.${family}.${team}${instanced ? '.inst' : ''}`;

  mat.defines = mat.defines || {};
  if (useMacro) mat.defines.VS_MACRO = '';
  if (useEmissive) mat.defines.VS_EMISSIVE = '';
  if (instanced) mat.defines.VS_ATTRIBS = '';

  const uniforms = hullUniforms(team, family, opts);
  const flags = `${family}|${team}|${useMacro ? 'm' : ''}${useEmissive ? 'e' : ''}${instanced ? 'a' : ''}`;
  patchHull(mat, uniforms, flags);
  store.materials.push(mat);
  return mat;
}

/* --------------------------------------------------------------- public API */

/**
 * Build the shared texture library and prime the material caches. Call once.
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} [opts] `{ quality, seed, maxAnisotropy, rng }`
 */
export function initMaterials(renderer, opts) {
  if (store) return;
  const o = opts || {};
  const rng = o.rng || makeRng(o.seed || 0x56534d);
  initTextureLibrary(renderer, rng, {
    quality: o.quality || 'high',
    maxAnisotropy: o.maxAnisotropy,
  });
  store = {
    quality: o.quality || 'high',
    hull: new Map(),
    instanced: new Map(),
    engine: new Map(),
    glass: new Map(),
    glow: new Map(),
    materials: [],
  };
  /* ENV normally hands us the real sky through setNebulaBounce(); accepting it
     here as well means a caller that builds the sky first can wire it in one
     step and never leave the shadow-side tint pinned to a guess. */
  const n = o.nebula;
  if (n) setNebulaBounce(n.key, n.fill, n.ambient, n.rim);
  if (o.chroma) setHullChroma(o.chroma.direct, o.chroma.indirect);
}

const key = (team, family, opts) => `${team}|${family}|${Math.round(opts.length || 0)}`
  + `|${opts.variant === undefined ? '-' : opts.variant}`;

/**
 * Shared hull material. One instance per (team, family) — or per hull length as
 * well, if the caller supplies `opts.length`. Never clone this, or the
 * draw-call budget goes with it.
 * @param {number} team
 * @param {string} family 'lancer' | 'bulwark' | 'monolith'
 * @param {object} [opts] `{ length, modelScale, variant, damage, trim, livery,
 *        emissive, runLights, envMapIntensity }`
 */
export function getHullMaterial(team, family, opts) {
  if (!store) throw new Error('materials: initMaterials() must run first');
  const o = opts || {};
  const k = key(team, family, o);
  const hit = store.hull.get(k);
  if (hit) return hit;
  const mat = buildHullMaterial(team, family, o, false);
  store.hull.set(k, mat);
  return mat;
}

/**
 * Instanced twin of `getHullMaterial`. Reads `instanceColor` plus five float
 * attributes, all of which default to 0 when the geometry does not supply them.
 *
 * Per-instance, supplied by SIM on a mixed batch:
 *   `aDamage`   additional damage on top of `opts.damage`
 *   `aTeam`     shifts this instance off the material's own team
 *
 * Per-vertex, written by every part greeble.js builds:
 *   `aVariant`  `PLATE.HULL|ARMOUR|PANEL|MECH` — picks the hull material
 *   `aTeamMask` hand-placed livery region (`paintTeamMask`). A paint mask, not
 *               a team index: it never touches faction colour selection.
 *   `aWear`     scouring near thrusters, leading edges and extremities
 */
export function getInstancedHullMaterial(team, family, opts) {
  if (!store) throw new Error('materials: initMaterials() must run first');
  const o = opts || {};
  const k = key(team, family, o);
  const hit = store.instanced.get(k);
  if (hit) return hit;
  const mat = buildHullMaterial(team, family, o, true);
  store.instanced.set(k, mat);
  return mat;
}

/* ------------------------------------------------------------ engine glow */

/* Fallback emitter, kept for the case where ships/ cannot reach
   `getGlowMaterial()`. The shipped path is `getGlowMaterial(team, 'bell')`
   below; this one differs only in that it drives its churn from the fragment's
   own local position rather than from the geometry's axial ramp.

   Historical note, because it caused a real defect: this material was written
   when the bell's UVs were hull-space — measured at -1.1 to 1.38 rather than
   0..1 — so reading `uv` as a position along the bore rendered the whole
   assembly at the hot end and it went flat white. That is no longer true.
   `greeble.js::engineNozzle()` now runs `axialV()` over both bell parts and
   the merged group carries a clean 0..1 ramp, 0 at the throat and 1 at the
   mouth. The shipped emitter takes its gradient from that; see the block above
   GLOW_FRAG. Do not reinstate the old belief from this comment.

   What has not changed: the bell is the largest piece of team colour on a ship
   seen from astern, so it is keyed to TEAM_COLORS[n].engine and only the very
   throat is allowed to reach white. A bell that blows out to white has no
   faction in it. */

const BELL_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNrm;
varying vec3 vVDir;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec3 n = normal;
  vec4 mv;
  #ifdef USE_INSTANCING
    mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
    n = mat3( instanceMatrix ) * n;
  #else
    mv = modelViewMatrix * vec4( position, 1.0 );
  #endif
  vNrm = normalize( normalMatrix * n );
  vVDir = normalize( - mv.xyz );
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const BELL_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uCurl;
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uTime;
uniform float uThrottle;
uniform float uIntensity;
uniform float uSharp;
varying vec3 vNrm;
varying vec3 vVDir;
varying vec3 vLocal;

void main() {
  float t = clamp( uThrottle, 0.0, 1.5 );
  float ndv = clamp( dot( normalize( vNrm ), normalize( vVDir ) ), 0.0, 1.0 );

  /* Combustion churn, sampled on the fragment's own position so it works on a
     cone, a ring or whatever else ships/ decides a bell is made of, and slow
     enough that a stationary fleet does not strobe. */
  vec2 q = vec2( vLocal.x + vLocal.z, vLocal.y - vLocal.z ) * 0.06;
  float n1 = texture2D( uCurl, q + vec2( 0.0, uTime * 0.11 ) ).r;
  float n2 = texture2D( uCurl, q * 2.7 - vec2( uTime * 0.23, 0.0 ) ).g;
  float churn = 0.78 + 0.44 * ( n1 * 0.6 + n2 * 0.4 );

  float heat = clamp( pow( ndv, uSharp ) * churn, 0.0, 1.0 );
  vec3 c = mix( uEdge, uCore, heat );
  /* White is rationed hard. The bell is built from two parts — an inward cone
     whose throat faces astern and a lip ring at the mouth — and both present a
     face-on normal to a camera behind the ship, so a generous white term turns
     the whole assembly into white discs. Since the drive is the largest piece
     of faction colour on a ship seen from astern, the exponent is steep and the
     mix is capped: the very centre of the throat goes hot, nothing else does. */
  c = mix( c, vec3( 1.0 ), pow( heat, 14.0 ) * 0.6 );

  // Idle still glows: a cold drive is a dead ship, and a fleet holding station
  // at zero throttle would lose its faction read at range.
  float level = mix( 0.30, 1.0, t );
  gl_FragColor = vec4( c * uIntensity * level, 1.0 );
  #include <logdepthbuf_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Engine-bell emitter, shared per team. Set `userData.uniforms.uThrottle` from
 * `entity.throttle` to make the drives respond to the sim.
 */
export function getEngineMaterial(team) {
  if (!store) throw new Error('materials: initMaterials() must run first');
  const t = team === 1 ? 1 : 0;
  const hit = store.engine.get(t);
  if (hit) return hit;

  const pal = TEAM_COLORS[t];
  const core = pal.engine.clone().lerp(new THREE.Color(0xffffff), 0.30);

  const uniforms = {
    uCurl: { value: getNoiseTexture('curl', 256) },
    uCore: { value: core },
    uEdge: { value: pal.engine.clone() },
    uTime: SHARED_TIME,
    uThrottle: { value: 1 },
    // comfortably over the 1.55 bloom threshold: drives are meant to flare
    uIntensity: { value: 3.4 },
    uSharp: { value: 3.0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: BELL_VERT,
    fragmentShader: BELL_FRAG,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  mat.name = `vs.engine.${t}`;
  mat.userData.bloom = true;
  mat.userData.uniforms = uniforms;

  store.engine.set(t, mat);
  store.materials.push(mat);
  return mat;
}

/* ------------------------------------------------------------- hull glow */

/* Unlit emitters bolted onto a hull: the inside of an engine bell, a running
   light, a lit window bay, a reactor vent. These are the *only* parts of a ship
   that are allowed past the bloom threshold (§3.6) — plating never is — and
   they are the third leg of faction identity, alongside painted livery and the
   drive plume. Team keying lives here so a bell and a spine light cannot drift
   apart from the trim they sit next to.

   Gains are quoted against a lit hull, which sits near 0.2 in linear light
   once the terminator gain above is included: a bell at 3.4 is roughly 17x
   that and blooms hard, a running light at 2.1 blooms softly, a window at 0.9
   does not bloom at all. */
const GLOW_KINDS = {
  /* Hot throat falling to the team's drive colour at the lip. `axial` is the
     one that takes its gradient from the geometry rather than from the view —
     see the note above GLOW_FRAG. `sharp` and `rim` are quoted against that
     ramp, not against a view-facing term, so they do not transfer to the
     others: the bore is meant to stay live well up its length, and the mouth
     is meant to be almost pure faction colour. `pull` is a mitigation for
     someone else's coincident surface, not a fix — see the block below. */
  bell: { core: 0xfff4e2, useEngine: true, gain: 3.4, sharp: 1.35, rim: 0.92, axial: true, pull: 0.002 },
  // faction running light: near-white centre, team colour off-axis
  light: { core: 0xffffff, useLight: true, gain: 2.1, sharp: 1.6, rim: 0.55 },
  // warm interior seen through a window bay — deliberately below bloom
  window: { core: 0xffd9ac, tint: 0xffbc78, gain: 0.90, sharp: 1.0, rim: 0.65 },
  // reactor glow behind a grille
  vent: { core: 0xffb070, tint: 0xd04a18, gain: 0.55, sharp: 1.8, rim: 0.40 },
};

/* ── Why the bell carries a depth pull, and who owns the real fix ──────────

   Giving the bell its axial ramp turned out not to be sufficient on its own,
   because the bore was never a shading problem in the first place. Measured
   end-on with FX hidden (.local/bellshot.mjs): flatten the bell material to
   one flat colour and it paints the lip ring and nothing else. Turn depth
   testing off and it paints the entire bore. Turn depth testing back on and
   hide only the hero's own hull group and it paints the entire bore again.

   So the emitter cone is present, front-facing and correctly shaded, and it
   is losing the depth test to hull geometry from its own nozzle.
   engineNozzle() builds a KIND.HULL recess cone (0.88r to 0.42r over z 0 to
   1.25r) and nests the KIND.BELL emitter cone inside it (0.80r to 0.42r over
   z 0.1r to 1.28r). Measured on the built buffers (.local/bellblock.mjs) the
   two surfaces are between 0.06 m and 1.31 m apart on a 14.2 m bell and they
   cross near half radius — textbook coincident surfaces, and the hull wins.

   A depth pull of 0.05% of view depth takes bore-over-lip luminance from 0.51
   to 0.82, and 0.2% reaches 0.88 and plateaus (.local/bellpull.mjs). That
   sub-metre knee is the confirmation: this is coincidence, not a hull slab in
   the way. So GLOW_KINDS.bell.pull is deliberately small — enough to win a
   tie, far too little to punch through anything real.

   The proper fix is in greeble.js and belongs to SHIPS: the emitter cone
   already provides the funnel surface, so the KIND.HULL recess cone is either
   redundant or wants pulling back by a metre. Until that lands this material
   is resolving someone else's tie, and FX's throat disc should stay. */

/* uDepthPull scales the view-space position toward the eye. Perspective
   projection is invariant under scaling along the eye ray, so the pixel does
   not move by even a subpixel — only its depth does. That is the only handle
   an emitter has for winning against the housing it is recessed into, and
   polygonOffset is not an alternative here: the log-depth chunk writes
   gl_FragDepth, and the rasteriser's offset is discarded when a shader does
   that. Quoted as a fraction of view depth so one value serves a 14 m bell at
   fifty metres and at five kilometres. */
const GLOW_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uDepthPull;
varying vec3 vGlowN;
varying vec3 vGlowV;
#ifdef VS_GLOW_AXIAL
  varying float vGlowT;
#endif
void main() {
  vec3 n = normal;
  vec4 mv;
  #ifdef USE_INSTANCING
    mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
    n = mat3( instanceMatrix ) * n;
  #else
    mv = modelViewMatrix * vec4( position, 1.0 );
  #endif
  vGlowN = normalize( normalMatrix * n );
  vGlowV = normalize( - mv.xyz );
  #ifdef VS_GLOW_AXIAL
    vGlowT = uv.y;
  #endif
  mv.xyz *= 1.0 - uDepthPull;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const GLOW_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCore;
uniform vec3 uRim;
uniform float uGain;
uniform float uSharp;
uniform float uRimMix;
uniform float uThrottle;
uniform float uTime;
uniform float uPhase;
uniform float uPeriod;
varying vec3 vGlowN;
varying vec3 vGlowV;
#ifdef VS_GLOW_AXIAL
  varying float vGlowT;
#endif

void main() {
#ifdef VS_GLOW_AXIAL
  /* The bell takes its heat gradient from the geometry, because the geometry
     ships one. greeble.js::engineNozzle() runs axialV() over the emitter cone
     and the lip ring, writing v = 0 at the throat and v = 1 at the mouth, and
     .local/bellramp.mjs measures that ramp surviving the merge on every class
     at every LOD — 0..1 exactly, mean 0.5.

     No backticks in this comment, and none in any other shader literal in this
     file: one inside a GLSL template terminates the string and silently
     truncates the shader. See HANDOFF.md §5 — it has cost this project four
     separate debugging sessions, and it cost this one a fifth.

     The view-facing term this replaces was not a weaker version of the same
     thing, it was a different gradient. Both bell parts present a nearly
     face-on normal to a camera astern, so dot(N,V) is near-constant up the
     whole bore: the emitter cone read flat and the lip ring — a true face-on
     annulus — read at full heat. End-on that is eight bright rims around eight
     dead bores, which is why FX had to paper the throat over with a sprite
     from outside. An axial ramp puts the hot core where the physics puts it,
     at the narrow end, and it holds up from every angle rather than only from
     dead astern. */
  float heat = pow( 1.0 - clamp( vGlowT, 0.0, 1.0 ), uSharp );
#else
  /* Everything that is not a bell is a flat emitter on the hull surface — a
     running light, a window bay, a vent grille — and for those the view-facing
     term is the right one: they are brightest looked at square on and fall off
     as they turn away, which is exactly what a recessed emitter does. */
  float ndv = clamp( dot( normalize( vGlowN ), normalize( vGlowV ) ), 0.0, 1.0 );
  float heat = pow( ndv, uSharp );
#endif
  vec3 c = mix( uRim, uCore, mix( heat, 1.0, 1.0 - uRimMix ) );
  float pulse = uPeriod > 0.0
    ? 0.35 + 0.65 * smoothstep( 0.55, 0.95, sin( ( uTime / uPeriod + uPhase ) * 6.2831853 ) * 0.5 + 0.5 )
    : 1.0;
  gl_FragColor = vec4( c * uGain * pulse * clamp( uThrottle, 0.0, 1.5 ), 1.0 );
  #include <logdepthbuf_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Shared unlit emitter for hull-mounted glow geometry.
 * @param {number} team 0 player, 1 enemy
 * @param {'bell'|'light'|'window'|'vent'} kind
 * @returns {THREE.ShaderMaterial} shared — never clone it. Live uniforms:
 *   `uThrottle` (0..1.5, drives bells from `entity.throttle`), `uPeriod`
 *   (seconds, 0 = steady) and `uPhase` (0..1) for blinking running lights.
 */
export function getGlowMaterial(team, kind) {
  if (!store) throw new Error('materials: initMaterials() must run first');
  const t = team === 1 ? 1 : 0;
  const k = GLOW_KINDS[kind] ? kind : 'light';
  const id = `${t}:${k}`;
  const hit = store.glow.get(id);
  if (hit) return hit;

  const spec = GLOW_KINDS[k];
  const pal = TEAM_COLORS[t];
  const rim = spec.useEngine ? pal.engine.clone()
    : spec.useLight ? pal.light.clone()
      : new THREE.Color(spec.tint === undefined ? spec.core : spec.tint);

  const mat = new THREE.ShaderMaterial({
    /* One define, not a uniform branch: the two gradients are compiled apart,
       and three folds `defines` into the program cache key on its own, so the
       bell and the running lights stay two programs and four materials rather
       than one program that tests a flag per fragment. */
    defines: spec.axial ? { VS_GLOW_AXIAL: '' } : {},
    uniforms: {
      uCore: { value: new THREE.Color(spec.core) },
      uRim: { value: rim },
      uGain: { value: spec.gain },
      uSharp: { value: spec.sharp },
      uRimMix: { value: spec.rim },
      uThrottle: { value: 1 },
      uTime: SHARED_TIME,
      uPhase: { value: 0 },
      uPeriod: { value: 0 },
      uDepthPull: { value: spec.pull || 0 },
    },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
    toneMapped: true,
  });
  mat.name = `vs.glow.${k}.${t}`;
  mat.userData.bloom = k === 'bell' || k === 'light';

  store.glow.set(id, mat);
  store.materials.push(mat);
  return mat;
}

/* ---------------------------------------------------------------- glass */

const GLASS_PARS = /* glsl */`
uniform vec3 uGlassInner;
uniform vec3 uGlassRim;
uniform float uGlassTime;
varying vec3 vGlassObj;
`;

/** Dark cockpit / bridge glass: strong fresnel, faint interior. */
export function getGlassMaterial(team) {
  if (!store) throw new Error('materials: initMaterials() must run first');
  const t = team === 1 ? 1 : 0;
  const hit = store.glass.get(t);
  if (hit) return hit;

  const pal = TEAM_COLORS[t];
  const mat = new THREE.MeshStandardMaterial({
    color: 0x080b0f,
    roughness: 0.10,
    // Armoured glass is a dielectric. The previous 0.35 gave it a metal
    // highlight, which is most of what made canopies look like plastic.
    metalness: 0.0,
    emissive: 0x000000,
    envMapIntensity: 1.25,
    side: THREE.FrontSide,
  });
  mat.name = `vs.glass.${t}`;
  mat.userData.bloom = false;

  const uniforms = {
    uGlassInner: { value: pal.light.clone().multiplyScalar(0.16) },
    uGlassRim: { value: NEBULA.key.clone() },
    uGlassTime: SHARED_TIME,
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGlassObj;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlassObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLASS_PARS}`)
      .replace('#include <fog_pars_fragment>', `${HULL_HAZE_DEFINE}#include <fog_pars_fragment>`)
      .replace('#include <opaque_fragment>', /* glsl */`
{
  vec3 wN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  vec3 wV = normalize( ( vec4( vViewPosition, 0.0 ) * viewMatrix ).xyz );
  float fres = pow( 1.0 - saturate( dot( wN, wV ) ), 4.2 );
  // faint cabin lighting, banded so it reads as decks behind the glass
  float band = 0.5 + 0.5 * sin( vGlassObj.y * 34.0 + vGlassObj.z * 3.0 );
  float pulse = 0.85 + 0.15 * sin( uGlassTime * 0.7 + vGlassObj.z * 0.4 );
  outgoingLight += uGlassInner * ( 0.35 + 0.65 * band ) * pulse;
  outgoingLight += uGlassRim * fres * 1.15;
}
#include <opaque_fragment>`);
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => `vs-glass:${t}`;
  mat.userData.uniforms = uniforms;

  store.glass.set(t, mat);
  store.materials.push(mat);
  return mat;
}

/* ------------------------------------------------------------- per-frame */

/** Advance every animated uniform. One shared object, so this is O(1). */
export function updateMaterials(elapsed) {
  SHARED_TIME.value = elapsed;
}

/* --------------------------------------------------------- ENV/FX hooks */

/**
 * Retune the hemispheric bounce to match the generated sky. ENV should call
 * this after `buildSkybox()` so the shadow side picks up the real nebula.
 * @param {THREE.Color} keyColour  light from the bright half of the sky
 * @param {THREE.Color} fillColour light from the dark half
 * @param {number} [ambient] flat term, 0.08–0.20 reads well
 * @param {number} [rim] fresnel term, 0.3–0.7
 */
export function setNebulaBounce(keyColour, fillColour, ambient, rim) {
  if (keyColour) NEBULA.key.copy(keyColour);
  if (fillColour) NEBULA.fill.copy(fillColour);
  if (ambient !== undefined) NEBULA.ambient = ambient;
  if (rim !== undefined) NEBULA.rim = rim;
  if (!store) return;
  for (const mat of store.materials) {
    const u = mat.userData.uniforms;
    if (!u) continue;
    if (u.uNebulaKey) u.uNebulaKey.value.copy(NEBULA.key);
    if (u.uNebulaFill) u.uNebulaFill.value.copy(NEBULA.fill);
    if (u.uBounce) u.uBounce.value.set(NEBULA.ambient, NEBULA.rim);
    if (u.uGlassRim) u.uGlassRim.value.copy(NEBULA.key);
  }
}

/**
 * Tell the hull shader where the key star is, so the cold rim lands on the
 * side the key does not reach. ENV calls this with the same vector it aims the
 * key light down; there is one key and everything reads it.
 * @param {THREE.Vector3} dir world direction from the battle toward the star
 */
export function setHullKeyDirection(dir) {
  if (!dir) return;
  NEBULA.keyDir.copy(dir).normalize();
  if (!store) return;
  for (const mat of store.materials) {
    const u = mat.userData.uniforms;
    if (u && u.uKeyDir) u.uKeyDir.value.copy(NEBULA.keyDir);
  }
}

/**
 * The live terminator shaping as a shared uniform, (gamma, gain), for
 * materials outside this module that sit under the same key — the asteroid
 * field. Handing out the object rather than a copy is the point: a
 * `setHullTerminator()` retune reaches the rocks in the same call.
 * @returns {{ value: THREE.Vector2 }}
 */
export function getTerminatorUniform() {
  return TERMINATOR_SHARED;
}

/**
 * How strongly hulls reject the illuminant's colour. 0 is physically literal
 * and turns every ship the colour of the sky; 1 renders as though the key were
 * white. Live-tunable so the look can be judged against a screenshot.
 * @param {number} direct   key and rim lights, 0..1
 * @param {number} indirect fill, ambient and IBL, 0..1
 */
export function setHullChroma(direct, indirect) {
  if (direct !== undefined) CHROMA.direct = Math.max(0, Math.min(1, direct));
  if (indirect !== undefined) CHROMA.indirect = Math.max(0, Math.min(1, indirect));
  if (!store) return;
  for (const mat of store.materials) {
    const u = mat.userData.uniforms;
    if (u && u.uChroma) u.uChroma.value.set(CHROMA.direct, CHROMA.indirect);
  }
}

/**
 * How hard the key's terminator is. `gamma` steepens the cosine falloff and
 * `pivot` is the cosine held at its unshaped value, so raising gamma trades
 * mid-tones for separation without moving the exposure of the lit face.
 * `setHullTerminator(1, p)` restores stock Lambert exactly.
 * @param {number} gamma 1 = off, 1.5–2.2 useful, clamped to 1..4
 * @param {number} [pivot] cosine held fixed, 0.35..0.95
 */
export function setHullTerminator(gamma, pivot) {
  if (gamma !== undefined) TERMINATOR.gamma = Math.max(1, Math.min(4, gamma));
  if (pivot !== undefined) TERMINATOR.pivot = Math.max(0.35, Math.min(0.95, pivot));
  const g = termGain();
  TERMINATOR_SHARED.value.set(TERMINATOR.gamma, g);
  if (!store) return;
  for (const mat of store.materials) {
    const u = mat.userData.uniforms;
    if (u && u.uTerm) u.uTerm.value.set(TERMINATOR.gamma, g);
  }
}

/** Set the material-wide damage level (instances should use `aDamage`). */
export function setMaterialDamage(material, value) {
  const u = material && material.userData && material.userData.uniforms;
  if (u && u.uDamage) u.uDamage.value = Math.max(0, Math.min(1, value));
}

/** Attach the scene environment map to every hull material at once. */
export function setEnvironmentMap(texture, intensity) {
  if (!store) return;
  for (const mat of store.materials) {
    if (!mat.isMeshStandardMaterial) continue;
    mat.envMap = texture || null;
    if (intensity !== undefined) mat.envMapIntensity = intensity;
    mat.needsUpdate = true;
  }
}

/** Per-family average albedo/roughness/metalness, in linear light. */
export function getFamilyAverages() {
  return getAtlasAverages();
}

export function disposeMaterials() {
  if (!store) return;
  for (const mat of store.materials) mat.dispose();
  store.hull.clear();
  store.instanced.clear();
  store.engine.clear();
  store.glass.clear();
  store.glow.clear();
  store.materials.length = 0;
  store = null;
  disposeTextures();
}
