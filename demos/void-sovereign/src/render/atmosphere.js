import * as THREE from '../../vendor/three/build/three.module.js';

/* Aerial perspective: one shared atmosphere for everything solid in the world.

   Without it ships, rocks and wrecks keep the same value and saturation at
   every distance, so nothing reads as far away and a frame has no foreground
   or background order. This replaces three's `fog_fragment` chunk once, at
   import, so every material that takes scene fog (hulls at every LOD, the
   LOD3 impostor, glass, rocks, derelicts) runs the same function with the same
   distance bands. Emissive FX (engines, beams, impacts, glows, dust, seam
   haze) are ShaderMaterials without fog and stay exempt: light carries
   through the medium.

   The model is height-free, because there is no ground in space: in-scatter
   fraction F = 1 - exp(-(k * max(0, d - onset))^1.4), with d the view depth in
   metres. Beyond the onset:

   - saturation goes first (part of F pulls toward the pixel's own grey),
   - then value compresses toward the haze colour. Shadow sides take the full
     in-scatter; lit sides take less, so the shadow lifts more than the lit
     side drops and contrast falls without the terminator flipping,
   - and F is capped per family. Hulls cap lower than rocks, so a far hostile
     always keeps a fixed share of its contrast against the backdrop and the
     haze can never hide it; rocks are scenery and may recede further.

   R8: the onset moved from 1.5 km to 500 m. At 1.5 km every close frame sat
   wholly inside the clear band and every wide frame had its nearest and
   farthest rocks at the same charcoal value: the haze existed and changed no
   frame. At 500 m the subject of a close (150-400 m from the lens) is still
   untouched, but rocks a few kilometres behind it already sit visibly back.

   Also R8: scenery fades into the sky BEHIND it, not into one flat colour.
   A single haze colour pinned near the sky's mean is darker than a bright
   cloud and brighter than empty space, so a far rock in front of a cloud kept
   reading as a dark cut-out and the near/far order never formed. Scenery
   materials have the baked sky as their env map already (scene.environment),
   so the haze target is that sky, sampled blurred along the view ray, mixed
   with the flat haze colour and clamped to a band around it so a bright core
   cannot wash a rock white. Hulls (VS_HAZE_FLAT) keep the flat colour: the
   LOD3 impostor has no env map, and a hull must not change value as it swaps
   LOD, nor melt into a bright cloud; their cap already keeps them readable.

   The scene's FogExp2 is the carrier: its colour is the flat haze colour and
   its density is k, so the uniforms three already refreshes every frame drive
   this and no material needs new uniform plumbing. A material sets its own
   cap by defining VS_HAZE_CAP before this chunk. */

/** Metres of clear view before the haze starts. Beyond the close subject. */
export const HAZE_ONSET = 500;
/** Cap on F for hulls (every LOD and the impostor) so hostiles stay readable. */
export const HAZE_CAP_HULL = 0.4;
/** Cap on F for everything else that takes fog (rocks, derelicts). */
export const HAZE_CAP_SCENERY = 0.8;
/** How far the sky sample pulls the scenery haze hue off the flat colour. */
const HAZE_SKY_MIX = 0.6;
/** Luminance band, as multiples of the flat haze colour, for scenery haze.
    The floor sits above the flat value on purpose: in space the in-scatter
    is what lifts a far rock's shadow side off black, and at 1x a far cluster's
    shadows stayed as dark as a near one's and the order never formed. */
const HAZE_SKY_BAND = [2.0, 6.0];
/** Ramp shape: F = 1 - exp(-(k * d)^HAZE_SHAPE). Above 1 the ramp starts
    soft and steepens, so what is a few kilometres off stays near-clean while
    what is ten or more is well into the haze: the near/far ORDER inside one
    frame is what reads as depth, not the absolute amount. */
const HAZE_SHAPE = 1.4;
/** Share of the haze a fully lit texel takes. Lower keeps far terminators. */
const HAZE_LIT_KEEP = 0.5;

const f = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

export const ATMOSPHERE_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	{
		#ifndef VS_HAZE_CAP
		#define VS_HAZE_CAP ${f(HAZE_CAP_SCENERY)}
		#endif
		const vec3 vsW = vec3( 0.2126, 0.7152, 0.0722 );
		float vsD = max( vFogDepth - ${f(HAZE_ONSET)}, 0.0 );
		float vsF = min( 1.0 - exp( - pow( fogDensity * vsD, ${f(HAZE_SHAPE)} ) ), VS_HAZE_CAP );
		vec3 vsHz = fogColor;
		#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV ) && ! defined( VS_HAZE_FLAT )
		{
			/* Scenery: the hue between the flat haze and the blurred sky along
			   this view ray, at the sky's value held to a band above the flat
			   haze value. */
			vec3 vsRay = inverseTransformDirection( - vViewPosition, viewMatrix );
			vec3 vsSky = textureCubeUV( envMap, envMapRotation * vsRay, 0.55 ).rgb;
			float vsFL = max( dot( fogColor, vsW ), 1e-5 );
			float vsSL = dot( vsSky, vsW );
			vec3 vsT = mix( fogColor / vsFL, vsSky / max( vsSL, 1e-6 ), ${f(HAZE_SKY_MIX)} );
			vsT /= max( dot( vsT, vsW ), 1e-6 );
			vsHz = vsT * clamp( vsSL, vsFL * ${f(HAZE_SKY_BAND[0])}, vsFL * ${f(HAZE_SKY_BAND[1])} );
		}
		#endif
		vec3 vsC = gl_FragColor.rgb;
		float vsL = dot( vsC, vsW );
		float vsHL = max( dot( vsHz, vsW ), 1e-4 );
		/* Saturation first: distant plating greys before it fades. */
		vsC = mix( vsC, vec3( vsL ), vsF * 0.55 );
		/* Lit means well above the haze. Those texels keep more of themselves,
		   so the range compresses from the shadow end. */
		float vsLit = smoothstep( vsHL, vsHL * 8.0, vsL );
		gl_FragColor.rgb = mix( vsC, vsHz, vsF * mix( 1.0, ${f(HAZE_LIT_KEEP)}, vsLit ) );
	}
#endif
`;

THREE.ShaderChunk.fog_fragment = ATMOSPHERE_FRAGMENT;

/** Prefix for a hull fragment shader: hulls cap lower than scenery and keep
    the flat haze colour at every LOD. */
export const HULL_HAZE_DEFINE = `#define VS_HAZE_CAP ${f(HAZE_CAP_HULL)}\n#define VS_HAZE_FLAT\n`;

/* In-scatter coefficient k. With the 500 m onset and the 1.4 shape: a rock
   2 km out is at F ~0.08, one at 4.5 km at ~0.28, a hull at fleet range
   (about 5 km) at ~0.33 (cap 0.4), and a rock at 10 km at ~0.68. R7's 0.85e-4 from 1.5 km gave 0 inside every
   close and 0.26 at 5 km. Twice R7's value read as grey fog: rock clusters ten
   kilometres out flattened to one pale value and lost their terminator. */
export const HAZE_DENSITY = 1.15e-4;

/**
 * The haze colour for a baked sky. It must come from this seed's backdrop, not
 * a generic grey: the hue is the fill pulled halfway to the nebula, and the
 * value sits a little above the sky's mean so far hulls fade into the gas the
 * frame is lit by instead of into black. It stays well under the brightest gas
 * so a far silhouette against a bright cloud still reads dark. At 1.6x the
 * mean it out-shone the night side of the backdrop planet, and rocks in front
 * of the planet read lighter than the thing behind them.
 */
export function hazeColourFromSky(sky) {
  const hue = sky.fillColour.clone().lerp(sky.nebulaColour, 0.5);
  const lum = 0.2126 * hue.r + 0.7152 * hue.g + 0.0722 * hue.b;
  const skyLum = Math.max(1e-4, sky.averageLuminance || 0.02);
  const target = Math.min(0.1, skyLum * 1.15);
  return hue.multiplyScalar(target / Math.max(1e-4, lum));
}
