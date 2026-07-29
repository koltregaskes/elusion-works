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
  regionOrigin,
  FAMILY_MACRO_SLOTS,
} from './textures.js';

/* Ship and structure materials.

   One `MeshStandardMaterial` per (team, family, hull length), patched through
   `onBeforeCompile`. Hull geometry needs no UVs and no tangents: the shader
   projects the atlas triplanarly in *object* space, which means a merged hull
   built by ships/ gets continuous plating across every greeble, and the panel
   density is set in metres rather than in UV units.

   The five things that make this read as Homeworld rather than as a shader toy:

     1. panel density derived from hull length, so a 14 m interceptor and a
        1,900 m mothership carry plates of physically plausible size;
     2. team colour restricted to trim stripes and painted bands — the hull
        itself stays grey, always;
     3. a hemispheric nebula bounce so the shadow side is lifted, never black;
     4. high-frequency detail fading out with texel footprint, which kills the
        shimmer that otherwise makes 1,000 distant ships crawl;
     5. bare metal where paint has worn, so metalness is a map, not a slider. */

/* ------------------------------------------------------------- team palettes */

const col = (hex) => new THREE.Color(hex);

export const TEAM_COLORS = [
  {
    // Player — cold steel, cyan trim, white-blue running lights.
    primary: col(0x9ba6ad),
    secondary: col(0x47606d),
    engine: col(0x6fccff),
    trim: col(0x2b9ed2),
    light: col(0xd6efff),
  },
  {
    // Enemy — warm bone, rust bands, amber drive glow.
    primary: col(0xa89b8b),
    secondary: col(0x6a3d2a),
    engine: col(0xff9a3c),
    trim: col(0xc0602a),
    light: col(0xffd6a6),
  },
];

/* Default nebula bounce. ENV overwrites these through `setNebulaBounce()` once
   the skybox knows what colour the sky actually is. */
const NEBULA = {
  key: new THREE.Color(0x4a6f9c),
  fill: new THREE.Color(0x2a2233),
  ambient: 0.17,
  rim: 0.62,
};

const FAMILY_TUNING = {
  lancer: { emissive: 0.30, trim: 1.00, plateExp: 0.61, plateK: 0.12 },
  bulwark: { emissive: 0.55, trim: 0.95, plateExp: 0.61, plateK: 0.12 },
  monolith: { emissive: 0.95, trim: 0.85, plateExp: 0.61, plateK: 0.12 },
};

/** Plate size in metres for a hull of `length` metres. Sub-linear: plates grow
    with the ship but nothing like proportionally, which is what sells scale. */
function plateSize(length, tune) {
  const l = Math.max(4, length || 40);
  return Math.min(24, Math.max(0.22, tune.plateK * Math.pow(l, tune.plateExp)));
}

/* ------------------------------------------------------------------- shaders */

const SHARED_TIME = { value: 0 };

const HULL_PARS = /* glsl */`
uniform sampler2D uAtlasMap;
uniform sampler2D uAtlasNormal;
uniform sampler2D uAtlasOrm;
uniform sampler2D uAtlasEmissive;
uniform vec2  uRegionOrigin;
uniform vec2  uMacroBase;
uniform vec4  uMacroSlots;
uniform float uAtlasTexels;
uniform float uRegionTexels;
uniform float uMacroTexels;
uniform float uMacroCell;
uniform float uBaseTiling;
uniform float uMacroTiling;
uniform float uBlendSharp;
uniform float uNormalStrength;
uniform float uMaxFootprint;
uniform vec2  uDetailFade;
uniform vec3  uFarAlbedo;
uniform vec2  uFarOrm;
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
uniform float uEmissiveGain;
uniform float uAoStrength;
uniform float uDamage;
uniform float uTime;
uniform vec3  uNebulaKey;
uniform vec3  uNebulaFill;
uniform vec2  uBounce;

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

/* Region-clamped tiled fetch. The region tiles seamlessly within itself, so
   fract() wraps it; explicit gradients keep the mip chain from smearing the
   neighbouring region across the seam. */
vec4 vsTile( sampler2D tex, vec2 uv, vec2 org, float texels, float lodScale ) {
  vec2 dx = dFdx( uv );
  vec2 dy = dFdy( uv );
  float sc = texels / uAtlasTexels;
  vec2 t = org + ( 0.5 + fract( uv ) * ( texels - 1.0 ) ) / uAtlasTexels;
  return textureGrad( tex, t, dx * sc * lodScale, dy * sc * lodScale );
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
`;

const HULL_BODY = /* glsl */`
{
  vec3 P = vObjPos;
  vec3 GN = normalize( vObjNormal );
  vec3 W = pow( abs( GN ), vec3( uBlendSharp ) );
  W /= max( 1e-4, W.x + W.y + W.z );

  /* U is aligned to the hull's +Z axis on both dominant planes, so the baked
     streak stains always trail along the ship rather than across it. */
  vec2 bX = P.zy * uBaseTiling;
  vec2 bY = P.zx * uBaseTiling;
  vec2 bZ = P.xy * uBaseTiling;

  float fp = vsFootprint( bX, uRegionTexels );
  float lod = min( 1.0, uMaxFootprint / max( fp, 1e-4 ) );
  float detail = 1.0 - smoothstep( uDetailFade.x, uDetailFade.y, fp );

  vec4 aX = vsTile( uAtlasMap, bX, uRegionOrigin, uRegionTexels, lod );
  vec4 aY = vsTile( uAtlasMap, bY, uRegionOrigin, uRegionTexels, lod );
  vec4 aZ = vsTile( uAtlasMap, bZ, uRegionOrigin, uRegionTexels, lod );
  vec4 A = aX * W.x + aY * W.y + aZ * W.z;

  vec4 oX = vsTile( uAtlasOrm, bX, uRegionOrigin, uRegionTexels, lod );
  vec4 oY = vsTile( uAtlasOrm, bY, uRegionOrigin, uRegionTexels, lod );
  vec4 oZ = vsTile( uAtlasOrm, bZ, uRegionOrigin, uRegionTexels, lod );
  vec4 O = oX * W.x + oY * W.y + oZ * W.z;

  vec3 tX = vsTile( uAtlasNormal, bX, uRegionOrigin, uRegionTexels, lod ).xyz * 2.0 - 1.0;
  vec3 tY = vsTile( uAtlasNormal, bY, uRegionOrigin, uRegionTexels, lod ).xyz * 2.0 - 1.0;
  vec3 tZ = vsTile( uAtlasNormal, bZ, uRegionOrigin, uRegionTexels, lod ).xyz * 2.0 - 1.0;

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
  vec3 emis = vec3( 0.0 );
  float emisTeam = 0.0;
  float trimMask = 0.0;

#ifdef VS_MACRO
  {
    float fv = uVariant;
  #ifdef VS_ATTRIBS
    fv = vAttr.z;
  #endif
    // Selected with steps rather than a dynamic index: HLSL codegen warns on
    // dynamically indexed vectors and the branchless form is free anyway.
    float si = mod( floor( fv ), 4.0 );
    vec4 sel = vec4( step( si, 0.5 ),
                     step( 0.5, si ) * step( si, 1.5 ),
                     step( 1.5, si ) * step( si, 2.5 ),
                     step( 2.5, si ) );
    float slot = dot( uMacroSlots, sel );
    vec2 mOrg = uMacroBase + vec2( mod( slot, 2.0 ), floor( slot * 0.5 ) ) * uMacroCell;

    vec2 mX = P.zy * uMacroTiling;
    vec2 mY = P.zx * uMacroTiling;
    vec2 mZ = P.xy * uMacroTiling;

    float mfp = vsFootprint( mX, uMacroTexels );
    float mlod = min( 1.0, uMaxFootprint / max( mfp, 1e-4 ) );
    float mdet = 1.0 - smoothstep( uDetailFade.x, uDetailFade.y * 1.6, mfp );

    vec4 mA = vsTile( uAtlasMap, mX, mOrg, uMacroTexels, mlod ) * W.x
            + vsTile( uAtlasMap, mY, mOrg, uMacroTexels, mlod ) * W.y
            + vsTile( uAtlasMap, mZ, mOrg, uMacroTexels, mlod ) * W.z;
    vec4 mO = vsTile( uAtlasOrm, mX, mOrg, uMacroTexels, mlod ) * W.x
            + vsTile( uAtlasOrm, mY, mOrg, uMacroTexels, mlod ) * W.y
            + vsTile( uAtlasOrm, mZ, mOrg, uMacroTexels, mlod ) * W.z;

    vec3 nX = vsTile( uAtlasNormal, mX, mOrg, uMacroTexels, mlod ).xyz * 2.0 - 1.0;
    vec3 nY = vsTile( uAtlasNormal, mY, mOrg, uMacroTexels, mlod ).xyz * 2.0 - 1.0;
    vec3 nZ = vsTile( uAtlasNormal, mZ, mOrg, uMacroTexels, mlod ).xyz * 2.0 - 1.0;
    nX = vec3( nX.xy * uNormalStrength + GN.zy, abs( nX.z ) * GN.x );
    nY = vec3( nY.xy * uNormalStrength + GN.zx, abs( nY.z ) * GN.y );
    nZ = vec3( nZ.xy * uNormalStrength + GN.xy, abs( nZ.z ) * GN.z );
    vec3 macroN = normalize( nX.zyx * W.x + nY.yzx * W.y + nZ.xyz * W.z );

    float cov = clamp( mA.a * mdet, 0.0, 1.0 );
    albedo = mix( albedo, mA.rgb, cov );
    rough = mix( rough, mO.g, cov );
    metal = mix( metal, mO.b, cov );
    ao = min( ao, mix( 1.0, mO.r, cov ) );
    objN = normalize( mix( objN, macroN, cov ) );
    trimMask = mO.a * cov;

  #ifdef VS_EMISSIVE
    vec4 E = vsTile( uAtlasEmissive, mX, mOrg, uMacroTexels, mlod ) * W.x
           + vsTile( uAtlasEmissive, mY, mOrg, uMacroTexels, mlod ) * W.y
           + vsTile( uAtlasEmissive, mZ, mOrg, uMacroTexels, mlod ) * W.z;
    emis = E.rgb * cov;
    emisTeam = E.a;
  #endif
  }
#endif

  /* Distance fade: once one texel covers more than a pixel the high-frequency
     detail is noise, so cross-fade to the region average instead of letting it
     crawl. Trim and lights are applied after, so faction reads at any range. */
  albedo = mix( uFarAlbedo, albedo, detail );
  rough = mix( uFarOrm.x, rough, detail );
  metal = mix( uFarOrm.y, metal, detail );
  ao = mix( 1.0, ao, detail );
  objN = normalize( mix( GN, objN, detail ) );

  /* Team colour, restricted to painted trim. */
  float team = uTeam;
  float dmg = uDamage;
#ifdef VS_ATTRIBS
  team = clamp( vAttr.y, 0.0, 1.0 );
  dmg = max( dmg, clamp( vAttr.x, 0.0, 1.0 ) );
#endif
  vec3 trimCol = mix( uTrimA, uTrimB, team );
  vec3 secCol = mix( uSecA, uSecB, team );
  vec3 lightCol = mix( uLightA, uLightB, team );

#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
  /* instanceColor tints the trim strongly and the hull only faintly — a whole
     hull swimming in faction colour is the single worst look in the genre. */
  trimCol *= vColor;
  lightCol *= vColor;
  albedo *= mix( vec3( 1.0 ), vColor, 0.12 );
#endif

  /* Trim is *colourised*, not replaced: scaling by the underlying luminance
     keeps panel lines, rivets and wear reading straight through the paint. A
     flat fill here is what makes team colour look like a decal sticker. */
  float luma = dot( albedo, vec3( 0.2126, 0.7152, 0.0722 ) );
  float primary = smoothstep( 0.78, 0.93, trimMask );
  float secondary = smoothstep( 0.30, 0.50, trimMask ) * ( 1.0 - primary );
  float painted = clamp( ( primary + secondary ) * uTrimStrength, 0.0, 1.0 );
  float tone = clamp( luma * 3.3, 0.22, 1.5 );
  albedo = mix( albedo, secCol * tone, secondary * uTrimStrength );
  albedo = mix( albedo, trimCol * tone, primary * uTrimStrength );
  // painted trim is matte enamel, never the wet gloss a low roughness gives it
  rough = mix( rough, mix( 0.54, rough, 0.4 ), painted );
  metal = mix( metal, 0.05, painted );

#ifdef VS_EMISSIVE
  /* The emissive alpha flags a team running light; everything else is warm
     interior glass. Gains sit deliberately below the bloom threshold — hulls
     do not bloom, only engines and weapons do. */
  vsEmissive = emis * mix( uWindowColour, lightCol * 1.3, emisTeam ) * uEmissiveGain;
#else
  vsEmissive = vec3( 0.0 );
#endif

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
  vsRough = clamp( rough, 0.035, 1.0 );
  vsMetal = clamp( metal, 0.0, 1.0 );
  vsAO = clamp( mix( 1.0, ao, uAoStrength ), 0.0, 1.0 );
  vsObjN = objN;
}
diffuseColor.rgb *= vsAlbedo;
`;

const HULL_BOUNCE = /* glsl */`
{
  /* Hemispheric nebula bounce. Without this the shadow side crushes to black
     and the ship stops reading as a solid object — the single most important
     Homeworld cue there is. viewMatrix is orthonormal, so a transposed multiply
     rotates view space back to world space for free.

     It doubles as a stand-in image-based light: bare metal has no diffuse
     term at all, so without a reflected-direction sky sample every worn panel
     would render black until ENV hands us a real env map. */
  vec3 wN = normalize( ( vec4( nonPerturbedNormal, 0.0 ) * viewMatrix ).xyz );
  vec3 wNp = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  vec3 wV = normalize( ( vec4( vViewPosition, 0.0 ) * viewMatrix ).xyz );
  float fres = pow( 1.0 - saturate( dot( wNp, wV ) ), 3.6 );

  vec3 hemiN = mix( uNebulaFill, uNebulaKey, wN.y * 0.5 + 0.5 );
  vec3 R = reflect( - wV, wNp );
  vec3 hemiR = mix( uNebulaFill, uNebulaKey, R.y * 0.5 + 0.5 );
  vec3 f0 = mix( vec3( 0.055 ), diffuseColor.rgb, vsMetal );
  float gloss = 1.0 - vsRough;

  outgoingLight += hemiN * diffuseColor.rgb * uBounce.x * ( 1.0 - vsMetal * 0.85 ) * vsAO;
  outgoingLight += hemiR * f0 * uBounce.x * ( 0.35 + 1.5 * gloss * gloss ) * vsAO;
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

let store = null;

function hullUniforms(team, family, opts) {
  const atlas = getHullAtlas();
  const avg = (getAtlasAverages() || {})[family] || { colour: [0.5, 0.5, 0.5], rough: 0.45, metal: 0.2 };
  const tune = FAMILY_TUNING[family] || FAMILY_TUNING.bulwark;
  const org = regionOrigin(family);
  const macro = regionOrigin('macro');
  const slots = FAMILY_MACRO_SLOTS[family] || FAMILY_MACRO_SLOTS.bulwark;

  const length = opts.length || 60;
  const ps = plateSize(length, tune);
  const baseTiling = 1 / (ATLAS.platesPerRegion * ps);

  const a = TEAM_COLORS[0];
  const b = TEAM_COLORS[1];

  return {
    uAtlasMap: { value: atlas.map },
    uAtlasNormal: { value: atlas.normalMap },
    uAtlasOrm: { value: atlas.roughnessMap },
    uAtlasEmissive: { value: atlas.emissiveMap },
    uRegionOrigin: { value: new THREE.Vector2(org[0], org[1]) },
    uMacroBase: { value: new THREE.Vector2(macro[0], macro[1]) },
    uMacroSlots: { value: new THREE.Vector4(slots[0], slots[1], slots[2], slots[3]) },
    uAtlasTexels: { value: atlas.size },
    uRegionTexels: { value: atlas.size * ATLAS.regionScale },
    uMacroTexels: { value: atlas.size * ATLAS.macroScale },
    uMacroCell: { value: ATLAS.macroScale },
    uBaseTiling: { value: baseTiling },
    uMacroTiling: { value: baseTiling / ATLAS.macroSpan },
    uBlendSharp: { value: 5.0 },
    uNormalStrength: { value: opts.normalStrength === undefined ? 1.0 : opts.normalStrength },
    uMaxFootprint: { value: 16.0 },
    uDetailFade: { value: new THREE.Vector2(2.0, 9.0) },
    uFarAlbedo: { value: new THREE.Color(avg.colour[0], avg.colour[1], avg.colour[2]) },
    uFarOrm: { value: new THREE.Vector2(avg.rough, avg.metal) },
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
    uEmissiveGain: { value: opts.emissive === undefined ? tune.emissive : opts.emissive },
    uAoStrength: { value: opts.ao === undefined ? 1.0 : opts.ao },
    uDamage: { value: opts.damage || 0 },
    uTime: SHARED_TIME,
    uNebulaKey: { value: NEBULA.key.clone() },
    uNebulaFill: { value: NEBULA.fill.clone() },
    uBounce: { value: new THREE.Vector2(NEBULA.ambient, NEBULA.rim) },
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
      .replace(
        '#include <aomap_fragment>',
        'reflectedLight.indirectDiffuse *= vsAO;\n'
        + 'reflectedLight.indirectSpecular *= mix( 1.0, vsAO, 0.6 );',
      )
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
    envMapIntensity: opts.envMapIntensity === undefined ? 0.55 : opts.envMapIntensity,
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
 * Build the shared texture atlas and prime the material caches. Call once.
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
    materials: [],
  };
}

const key = (team, family, opts) => `${team}|${family}|${Math.round(opts.length || 60)}`
  + `|${opts.variant === undefined ? '-' : opts.variant}`;

/**
 * Shared hull material. One instance per (team, family, hull length) — never
 * clone this, or the draw-call budget goes with it.
 * @param {number} team
 * @param {string} family 'lancer' | 'bulwark' | 'monolith'
 * @param {object} [opts] `{ length, modelScale, variant, damage, trim, emissive }`
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
  c = mix( c, vec3( 1.0 ), pow( clamp( heat * 1.15, 0.0, 1.0 ), 4.0 ) );

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
  const core = pal.engine.clone().lerp(new THREE.Color(0xffffff), 0.55);

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
    color: 0x0a0d11,
    roughness: 0.12,
    metalness: 0.35,
    emissive: 0x000000,
    envMapIntensity: 1.4,
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
  outgoingLight += uGlassRim * fres * 1.35;
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
 * @param {number} [ambient] flat term, 0.10–0.25 reads well
 * @param {number} [rim] fresnel term, 0.4–0.9
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

export function disposeMaterials() {
  if (!store) return;
  for (const mat of store.materials) mat.dispose();
  store.hull.clear();
  store.instanced.clear();
  store.engine.clear();
  store.glass.clear();
  store.materials.length = 0;
  store = null;
  disposeTextures();
}
