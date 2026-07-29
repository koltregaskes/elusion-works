import * as THREE from '../../vendor/three/build/three.module.js';
import { makeRng } from '../core/rng.js';
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
  },
  {
    // Enemy — bone, crimson-rust, amber drive glow.
    primary: col(0xa69c8f),
    secondary: col(0x8e3417),
    engine: col(0xff8f30),
    trim: col(0xe2761f),
    light: col(0xffd2a0),
  },
];

/* Default nebula bounce. ENV overwrites these through `setNebulaBounce()` once
   the skybox knows what colour the sky actually is. */
const NEBULA = {
  key: new THREE.Color(0x4a6f9c),
  fill: new THREE.Color(0x2a2233),
  ambient: 0.12,
  rim: 0.46,
};

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
uniform float uPlateTexels;
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

varying vec3 vObjPos;
varying vec3 vObjNormal;
flat varying mat3 vObjToView;
#ifdef VS_ATTRIBS
  varying vec3 vAttr;
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

   Returns the primary mask; the accent output carries the secondary. */
float vsLivery( vec3 P, vec3 GN, out float accent, out float runLight ) {
  float rho = max( length( P.xy ), 1e-3 );  // local girth radius, metres
  float ax = abs( P.x ) / rho;              // 0 on the centreline, ~1 at the beam
  float ay = P.y / rho;                     // -1 keel .. +1 spine

  /* Only strongly axis-aligned faces take paint. A loose threshold here puts a
     stripe on the top of every greeble box on the hull, which does not read as
     a painted band — it reads as a tinted ship, and that is the one thing the
     livery must never do. */
  float deck = smoothstep( 0.48, 0.80, abs( GN.y ) );
  float flank = smoothstep( 0.44, 0.78, abs( GN.x ) );

  /* Everything here runs the full length of the hull, because a longitudinal
     band is the only marking whose position does not have to be worked out
     from a hull length this material is never told. It is also the strongest
     shape available: a stripe down the spine survives being twenty pixels tall
     in a way that a roundel or a stern flash never could. */

  // 1. dorsal and ventral spine stripe
  float spine = deck * ( 1.0 - smoothstep( uSpine.x - uSpine.y, uSpine.x + uSpine.y, ax ) );

  // 2. shoulder pinstripes, just outboard of the spine — a two-line livery
  //    reads as deliberate where a single band can read as a lighting accident
  float sh = abs( ax - uShoulder.x );
  float shoulder = deck * ( 1.0 - smoothstep( uShoulder.y * 0.6, uShoulder.y, sh ) );

  // 3. flank stripe at a fixed fraction of the hull's local height
  float side = flank
    * ( 1.0 - smoothstep( uFlank.y - uFlank.z, uFlank.y + uFlank.z, abs( ay - uFlank.x ) ) );

  /* Running lights ride just outboard of the shoulder stripe as dashes spaced
     by girth, which puts them exactly where the eye is already looking. */
  float rim = 1.0 - smoothstep( 0.0, uShoulder.z, abs( ax - uShoulder.x - uShoulder.y * 1.9 ) );
  float ph = fract( P.z / max( rho * uRun, 1e-3 ) );
  float dash = smoothstep( 0.50, 0.55, ph ) * ( 1.0 - smoothstep( 0.70, 0.75, ph ) );
  runLight = deck * rim * dash;

  accent = clamp( max( side, shoulder ), 0.0, 1.0 );
  return clamp( spine, 0.0, 1.0 );
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

  vec3 tX = texture( uPlateNormal, vec3( P.zy * uBaseTiling, uPlateLayer ) ).xyz * 2.0 - 1.0;
  vec3 tY = texture( uPlateNormal, vec3( P.zx * uBaseTiling, uPlateLayer ) ).xyz * 2.0 - 1.0;
  vec3 tZ = texture( uPlateNormal, vec3( P.xy * uBaseTiling, uPlateLayer ) ).xyz * 2.0 - 1.0;

  /* Whiteout triplanar normal blend — folds the geometric normal into every
     plane so curved hulls keep their curvature. */
  tX = vec3( tX.xy * uNormalStrength + GN.zy, abs( tX.z ) * GN.x );
  tY = vec3( tY.xy * uNormalStrength + GN.zx, abs( tY.z ) * GN.y );
  tZ = vec3( tZ.xy * uNormalStrength + GN.xy, abs( tZ.z ) * GN.z );
  vec3 objN = normalize( tX.zyx * W.x + tY.yzx * W.y + tZ.xyz * W.z );

  vec3 albedo = A.rgb;
  float rough = O.g;
  float metal = O.b;
  float ao = O.r;
  float paintCover = A.a;   // 1 = plate still has its coat, 0 = bare alloy
  vec3 emis = vec3( 0.0 );
  float emisTeam = 0.0;
  float accentMask = 0.0;

#ifdef VS_MACRO
  {
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

    float cov = clamp( mA.a, 0.0, 1.0 );
    albedo = mix( albedo, mA.rgb, cov );
    rough = mix( rough, mO.g, cov );
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

  float runLight = 0.0;
  float accent = 0.0;
  float livery = vsLivery( P, GN, accent, runLight );

  /* Erode the paint edges. Multiplying a soft-edged mask by noise and
     re-thresholding leaves the middle of a band solid and chews the boundary,
     which is what a sprayed edge that has taken twenty years of micrometeorite
     does. Paint also cannot survive where the plate under it has already lost
     its coat, so the plate layer's own coverage gates the livery. */
  float chip = vsNoise3( P * uBaseTiling * 22.0 ) * 0.55 + vsNoise3( P * uBaseTiling * 64.0 ) * 0.45;
  float coat = mix( 0.55, 1.0, smoothstep( 0.05, 0.45, paintCover ) );
  livery = smoothstep( 0.40, 0.58, livery * ( 0.90 + 0.24 * chip ) ) * coat;
  accent = smoothstep( 0.40, 0.58, accent * ( 0.90 + 0.24 * chip ) ) * coat;

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
    float burn = smoothstep( 1.02 - dmg * 1.25, 0.72 - dmg * 1.25, field );
    float core = smoothstep( 0.86 - dmg * 1.25, 0.46 - dmg * 1.25, field );
    albedo = mix( albedo, vec3( 0.030, 0.026, 0.024 ), burn );
    rough = mix( rough, 0.93, burn );
    metal = mix( metal, 0.28, burn );
    ao = mix( ao, ao * 0.65, burn );
    objN = normalize( mix( objN, GN, burn * 0.45 ) );
    float flicker = 0.62 + 0.38 * sin( uTime * 7.3 + field * 41.0 )
      * ( 0.5 + 0.5 * sin( uTime * 2.1 + field * 13.0 ) );
    vsEmissive += uHotColour * core * dmg * flicker * 2.4;
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
  float fres = pow( 1.0 - saturate( dot( wNp, wV ) ), 4.2 );

  vec3 hemiN = mix( uNebulaFill, uNebulaKey, wN.y * 0.5 + 0.5 );
  vec3 R = reflect( - wV, wNp );
  vec3 hemiR = mix( uNebulaFill, uNebulaKey, R.y * 0.5 + 0.5 );
  vec3 f0 = mix( vec3( 0.045 ), diffuseColor.rgb, vsMetal );
  float gloss = 1.0 - vsRough;

  outgoingLight += hemiN * diffuseColor.rgb * uBounce.x * ( 1.0 - vsMetal * 0.85 ) * vsAO;
  outgoingLight += hemiR * f0 * uBounce.x * ( 0.30 + 0.85 * gloss * gloss ) * vsAO;
  outgoingLight += hemiN * f0 * uBounce.y * fres * mix( 1.0, 0.4, vsRough ) * vsAO;
}
`;

const HULL_VERT_PARS = /* glsl */`
uniform float uModelScale;
varying vec3 vObjPos;
varying vec3 vObjNormal;
flat varying mat3 vObjToView;
#ifdef VS_ATTRIBS
  attribute float aDamage;
  attribute float aTeam;
  attribute float aVariant;
  varying vec3 vAttr;
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
#endif
`;

/* ------------------------------------------------------------------- store */

/* How much of the illuminant's colour the hull refuses. `direct` is high — the
   key star is a searchlight, not a dye bath — and `indirect` is low, so the
   nebula fill keeps its hue where the star does not reach. */
const CHROMA = { direct: 0.86, indirect: 0.26 };

let store = null;

function hullUniforms(team, family, opts) {
  const atlas = getHullAtlas();
  const tune = FAMILY_TUNING[family] || FAMILY_TUNING.bulwark;
  const liv = LIVERY[family] || LIVERY.bulwark;
  const slots = FAMILY_MACRO_SLOTS[family] || FAMILY_MACRO_SLOTS.bulwark;

  const ps = plateSize(opts.length, tune);
  const baseTiling = 1 / (ATLAS.platesPerRegion * ps);

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
    uPlateTexels: { value: atlas.size },
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
    uVariant: { value: opts.variant === undefined ? (team * 2 + 1) : opts.variant },
    uTrimStrength: { value: (opts.trim === undefined ? 1 : opts.trim) * tune.trim },
    uLiveryGain: { value: opts.livery === undefined ? 1 : opts.livery },
    uEmissiveGain: { value: opts.emissive === undefined ? tune.emissive : opts.emissive },
    // Running lights are emitters, so they are allowed over the bloom
    // threshold — they are half of what tells you whose ship this is at 5 km.
    uRunGain: { value: opts.runLights === undefined ? 1.9 : opts.runLights },
    uAoStrength: { value: opts.ao === undefined ? 1.0 : opts.ao },
    uDamage: { value: opts.damage || 0 },
    uTime: SHARED_TIME,
    uSpine: { value: new THREE.Vector2(liv.spine[0], liv.spine[1]) },
    uFlank: { value: new THREE.Vector3(liv.flank[0], liv.flank[1], liv.flank[2]) },
    uShoulder: { value: new THREE.Vector3(liv.shoulder[0], liv.shoulder[1], liv.shoulder[2]) },
    uRun: { value: liv.run },
    uNebulaKey: { value: NEBULA.key.clone() },
    uNebulaFill: { value: NEBULA.fill.clone() },
    uBounce: { value: new THREE.Vector2(NEBULA.ambient, NEBULA.rim) },
    uChroma: { value: new THREE.Vector2(CHROMA.direct, CHROMA.indirect) },
    uModelScale: { value: opts.modelScale === undefined ? 1 : opts.modelScale },
  };
}

function patchHull(material, uniforms, flags) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${HULL_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${HULL_VERT_BODY}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HULL_PARS}`)
      .replace('#include <map_fragment>', HULL_BODY)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vsRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vsMetal;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize( vObjToView * vsObjN );')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += vsEmissive;')
      .replace('#include <aomap_fragment>', HULL_AO)
      .replace('#include <opaque_fragment>', `${HULL_BOUNCE}\n#include <opaque_fragment>`);

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
    envMapIntensity: opts.envMapIntensity === undefined ? 0.34 : opts.envMapIntensity,
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
 * Instanced twin of `getHullMaterial`. Reads `instanceColor` plus the optional
 * per-instance float attributes `aDamage`, `aTeam` and `aVariant`; all three
 * default to 0 when the geometry does not supply them.
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

const ENGINE_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUvE;
varying vec3 vNrm;
varying vec3 vVDir;
varying vec3 vLocal;
void main() {
  vUvE = uv;
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

const ENGINE_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uCurl;
uniform sampler2D uPlume;
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uTime;
uniform float uThrottle;
uniform float uIntensity;
uniform float uFlip;
varying vec2 vUvE;
varying vec3 vNrm;
varying vec3 vVDir;
varying vec3 vLocal;

void main() {
  float along = clamp( uFlip > 0.5 ? 1.0 - vUvE.y : vUvE.y, 0.0, 1.0 );
  float t = clamp( uThrottle, 0.0, 1.4 );

  /* Turbulence advected down the column. Two curl samples at different rates
     give the plume a churn that never repeats on a visible cycle. */
  vec2 f1 = texture2D( uCurl, vec2( vUvE.x * 1.7, along * 0.6 - uTime * 0.75 ) ).rg - 0.5;
  vec2 f2 = texture2D( uCurl, vec2( vUvE.x * 3.4 + 0.37, along * 1.3 - uTime * 1.9 ) ).rg - 0.5;
  float churn = ( f1.x * 0.62 + f2.y * 0.38 );
  vec2 warp = vec2( churn, f2.x * 0.5 ) * ( 0.02 + 0.16 * along );

  vec4 plume = texture2D( uPlume, clamp( vec2( vUvE.x, along ) + warp, vec2( 0.002 ), vec2( 0.998 ) ) );

  /* Volumetric shell: a hollow cone has more material along a grazing ray, so
     the silhouette rims up and it reads as a column of gas rather than a card.
     Shock diamonds ride the first third, where the flow is still choked. */
  float ndv = abs( dot( normalize( vNrm ), normalize( vVDir ) ) );
  float shell = mix( 0.22, 1.0, pow( 1.0 - ndv, 1.15 ) );

  float taper = pow( 1.0 - smoothstep( 0.0, 0.72 + 0.28 * t, along ), 1.5 );
  float shock = 1.0 + 0.42 * max( 0.0, sin( along * 30.0 - 0.6 ) )
    * ( 1.0 - smoothstep( 0.02, 0.34, along ) );

  float a = clamp( ( taper * 0.75 + plume.a * 0.55 ) * shell * shock * t, 0.0, 1.0 );
  a *= 0.55 + 0.45 * ( 0.5 + churn );

  float heat = clamp( taper * ( 0.55 + 0.75 * plume.r ) * shock, 0.0, 1.0 );
  vec3 c = mix( uEdge, uCore, heat * heat );
  /* The white core is kept to the very throat. A plume that blows out to white
     over most of its length is a plume with no faction in it — at two
     kilometres the drive glow is one of only three things still telling the
     player whose ship this is. */
  c = mix( c, vec3( 1.0 ), pow( clamp( heat * 1.05, 0.0, 1.0 ), 7.0 ) );

  gl_FragColor = vec4( c * uIntensity * a, a );
  #include <logdepthbuf_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Additive engine plume / nozzle glow. Shared per team. */
export function getEngineMaterial(team) {
  if (!store) throw new Error('materials: initMaterials() must run first');
  const t = team === 1 ? 1 : 0;
  const hit = store.engine.get(t);
  if (hit) return hit;

  const pal = TEAM_COLORS[t];
  const core = pal.engine.clone().lerp(new THREE.Color(0xffffff), 0.40);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCurl: { value: getNoiseTexture('curl', 256) },
      uPlume: { value: getSpriteTexture('plume') },
      uCore: { value: core },
      uEdge: { value: pal.engine.clone() },
      uTime: SHARED_TIME,
      uThrottle: { value: 1 },
      uIntensity: { value: 2.6 },
      // Plume cones are built nozzle-first, so V already runs the right way.
      // Kept as a uniform so a differently-wound cone can flip without a recompile.
      uFlip: { value: 0 },
    },
    vertexShader: ENGINE_VERT,
    fragmentShader: ENGINE_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  mat.name = `vs.engine.${t}`;
  mat.userData.bloom = true;

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

   Gains are quoted against a lit hull, which sits near 0.13 in linear light:
   a bell at 3.6 is roughly 28x that and blooms hard, a running light at 2.1
   blooms softly, a window at 0.9 does not bloom at all. */
const GLOW_KINDS = {
  // hot throat falling to the team's drive colour at the lip
  bell: { core: 0xfff4e2, useEngine: true, gain: 3.6, sharp: 2.6, rim: 0.30 },
  // faction running light: near-white centre, team colour off-axis
  light: { core: 0xffffff, useLight: true, gain: 2.1, sharp: 1.6, rim: 0.55 },
  // warm interior seen through a window bay — deliberately below bloom
  window: { core: 0xffd9ac, tint: 0xffbc78, gain: 0.90, sharp: 1.0, rim: 0.65 },
  // reactor glow behind a grille
  vent: { core: 0xffb070, tint: 0xd04a18, gain: 0.55, sharp: 1.8, rim: 0.40 },
};

const GLOW_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vGlowN;
varying vec3 vGlowV;
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

void main() {
  /* Looking straight down the axis of a bell means looking at the throat, so
     the view-facing term *is* the heat gradient — no UVs needed, which matters
     because hull geometry arrives merged and unwrapped. */
  float ndv = clamp( dot( normalize( vGlowN ), normalize( vGlowV ) ), 0.0, 1.0 );
  float heat = pow( ndv, uSharp );
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
