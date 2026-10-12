import * as THREE from '../../vendor/three/build/three.module.js';

/* Aerial perspective: one shared atmosphere for everything solid in the world.

   Without it ships, rocks and wrecks keep the same value and saturation at
   every distance, so nothing reads as far away and a frame has no foreground
   or background order. This replaces three's `fog_fragment` chunk once, at
   import, so every material that takes scene fog (hulls at every LOD, the
   LOD3 impostor, glass, rocks, derelicts) runs the same function with the same
   haze colour and the same distance bands. Emissive FX (engines, beams,
   impacts, glows, dust, seam haze) are ShaderMaterials without fog and stay
   exempt: light carries through the medium.

   The model is height-free, because there is no ground in space: in-scatter
   fraction F = 1 - exp(-k * max(0, d - onset)), with d the view depth in
   metres. Nothing nearer than the onset is touched, so the focus band (a
   subject hull at 100-1500 m) stays crisp and the lighting contract measured
   there still holds. Beyond it:

   - saturation goes first (part of F pulls toward the pixel's own grey),
   - then value compresses toward the haze colour. Shadow sides take the full
     in-scatter; lit sides take less, so the shadow lifts more than the lit
     side drops and contrast falls without the terminator flipping,
   - and F is capped per family. Hulls cap lower than rocks, so a far hostile
     always keeps a fixed share of its contrast against the backdrop and the
     haze can never hide it; rocks are scenery and may recede further.

   The scene's FogExp2 is the carrier: its colour is the haze colour and its
   density is k, so the uniforms three already refreshes every frame drive
   this and no material needs new uniform plumbing. A material sets its own
   cap by defining VS_HAZE_CAP before this chunk. */

/** Metres of clear view before the haze starts. Beyond the focus band. */
export const HAZE_ONSET = 1500;
/** Cap on F for hulls (every LOD and the impostor) so hostiles stay readable. */
export const HAZE_CAP_HULL = 0.4;
/** Cap on F for everything else that takes fog (rocks, derelicts). */
export const HAZE_CAP_SCENERY = 0.75;

const f = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

export const ATMOSPHERE_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	{
		#ifndef VS_HAZE_CAP
		#define VS_HAZE_CAP ${f(HAZE_CAP_SCENERY)}
		#endif
		float vsD = max( vFogDepth - ${f(HAZE_ONSET)}, 0.0 );
		float vsF = min( 1.0 - exp( - fogDensity * vsD ), VS_HAZE_CAP );
		vec3 vsC = gl_FragColor.rgb;
		const vec3 vsW = vec3( 0.2126, 0.7152, 0.0722 );
		float vsL = dot( vsC, vsW );
		float vsHL = max( dot( fogColor, vsW ), 1e-4 );
		/* Saturation first: distant plating greys before it fades. */
		vsC = mix( vsC, vec3( vsL ), vsF * 0.55 );
		/* Lit means well above the haze. Those texels keep more of themselves,
		   so the range compresses from the shadow end. */
		float vsLit = smoothstep( vsHL, vsHL * 8.0, vsL );
		gl_FragColor.rgb = mix( vsC, fogColor, vsF * mix( 1.0, 0.72, vsLit ) );
	}
#endif
`;

THREE.ShaderChunk.fog_fragment = ATMOSPHERE_FRAGMENT;

/** Prefix for a hull fragment shader: hulls cap lower than scenery. */
export const HULL_HAZE_DEFINE = `#define VS_HAZE_CAP ${f(HAZE_CAP_HULL)}\n`;

/* In-scatter coefficient k. A hull at fleet range (about 5 km) is visibly
   lifted, F ~0.26; a rock at 10 km is halfway into the haze; the far field
   reaches the caps past 15 km. Twice this read as grey fog: rock clusters ten
   kilometres out flattened to one pale value and lost their terminator. */
export const HAZE_DENSITY = 0.85e-4;

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
