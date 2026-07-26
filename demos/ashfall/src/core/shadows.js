/**
 * Ashfall — cascaded shadow maps.  (ARCHITECTURE.md §3.3)
 *
 * One dominant key (the sun) rakes the yard at 8° of elevation. At that angle every shadow in
 * frame is ten times longer than the thing casting it, so the shadow solution *is* the image:
 * get the contact wrong and the whole warm-key / cool-shadow split falls apart.
 *
 * What this module owns
 * ---------------------
 *  - A `CSM` instance (vendored three addon) with 2/3/4 cascades by quality, `practical`
 *    splits at lambda 0.86, `maxFar` 140 m and cross-cascade fading so the seams are invisible.
 *  - Per-cascade bias tuning derived from the *measured* world size of a shadow texel rather
 *    than from magic numbers — see `applyCascadeTuning()` for the derivation.
 *  - An optional contact-hardening shadow filter (PCSS-flavoured, built out of hardware
 *    comparison taps only) whose penumbra width comes from `LIGHTING.sunAngularDiameter`.
 *  - A material registry, so materials created after boot still receive the CSM shader
 *    injection, and so a quality change can re-register everything.
 *
 * Things worth knowing before you edit this file
 * ----------------------------------------------
 *  1. **The cascade lights are the sun.** `CSM` creates one `DirectionalLight` per cascade and
 *     the injected shader treats `directionalLights[0..N)` as slices of a single light. A
 *     second shadow-casting directional light would push `NUM_DIR_LIGHT_SHADOWS` past
 *     `CSM_CASCADES` and index the cascade uniform out of range. So the sun handed in by
 *     `sky.js` is switched to `visible = false` and its colour/intensity/direction are mirrored
 *     onto the cascade lights every frame. `sky.js` keeps full authorship of the look; it just
 *     no longer emits the photons itself.
 *  2. **Three r185 deprecates `PCFSoftShadowMap`.** `WebGLShadowMap.render` silently rewrites
 *     it to `PCFShadowMap` on first use, which is the good path: a hardware `sampler2DShadow`
 *     with a 5-tap Vogel disc scaled by `light.shadow.radius`. We keep the contract's
 *     `PCFSoftShadowMap` assignment in engine.js and simply refuse to run on VSM/Basic.
 *  3. **CSM overwrites two global shader chunks** with copies that were forked before r185
 *     (old iridescence, no `USE_LIGHT_PROBES_GRID`, a point-shadow guard that assumes the old
 *     sampler types). We rebuild those chunks from the *live* r185 text plus CSM's cascade
 *     block, so the rest of the material system keeps working exactly as three intends.
 *  4. Nothing here throws. If `CSM` cannot be constructed, or the patched GLSL will not
 *     compile on this driver, the module degrades — single-light shadows, or plain PCF — and
 *     sets `usingCSM` / `contactHardening` accordingly.
 */

import * as THREE from '../../vendor/three.module.js';
import { CSM } from '../../vendor/CSM.js';
import { LIGHTING, PALETTE, SUN_AZIMUTH, SUN_ELEVATION, MAP } from '../world/art.js';

/* -------------------------------------------------------------------------- */
/* Module-scope scratch — nothing in the per-frame path may allocate.          */
/* -------------------------------------------------------------------------- */

const _sunDir = new THREE.Vector3(); // unit vector pointing *towards* the sun
const _lightDir = new THREE.Vector3(); // unit vector the light *travels* along
const _colour = new THREE.Color();
const _focus = new THREE.Vector3();
const _fwd = new THREE.Vector3();

const DEG = Math.PI / 180;
const clamp = THREE.MathUtils.clamp;

/**
 * Fallback key direction, straight from the art bible: azimuth measured from +Z, clockwise.
 * Used only when `sky.js` failed to build and there is no sun object to mirror.
 */
const DEFAULT_SUN_DIR = new THREE.Vector3(
  Math.cos(SUN_ELEVATION * DEG) * Math.sin(SUN_AZIMUTH * DEG),
  Math.sin(SUN_ELEVATION * DEG),
  Math.cos(SUN_ELEVATION * DEG) * Math.cos(SUN_AZIMUTH * DEG)
).normalize();

/* -------------------------------------------------------------------------- */
/* Quality presets (ARCHITECTURE.md §5)                                        */
/* -------------------------------------------------------------------------- */

const PRESETS = {
  //                cascades  map   taps  search  contact  maxPenumbra (texels)
  low: { cascades: 2, mapSize: 512, taps: 4, search: 4, contact: false, maxPenumbra: 1.6 },
  medium: { cascades: 3, mapSize: 1024, taps: 6, search: 5, contact: false, maxPenumbra: 2.0 },
  high: { cascades: 4, mapSize: 2048, taps: 8, search: 6, contact: true, maxPenumbra: 6.0 },
  ultra: { cascades: 4, mapSize: 2048, taps: 12, search: 8, contact: true, maxPenumbra: 8.0 },
};

const DEFAULT_QUALITY = 'high';

function presetOf(name) {
  return PRESETS[name] || PRESETS[DEFAULT_QUALITY];
}

/* -------------------------------------------------------------------------- */
/* Tuning constants — the "why" for every magic number lives here.             */
/* -------------------------------------------------------------------------- */

/**
 * Split lambda. 0 = uniform (even world coverage, wasteful up close), 1 = logarithmic
 * (perfect texel density, but with a 0.05 m camera near plane the first cascade collapses to
 * centimetres). 0.86 sits close to logarithmic without that collapse — see SPLIT_NEAR.
 */
const SPLIT_LAMBDA = 0.86;

/**
 * The logarithmic term is evaluated from here rather than `camera.near`. At near = 0.05 m the
 * log split puts break 1 at ~36 cm and burns an entire cascade on the player's own boots;
 * pretending the eye starts half a metre out costs nothing visible and buys a far better
 * distribution (with 4 cascades / 140 m: 7 m, 18 m, 46 m, 140 m).
 */
const SPLIT_NEAR = 0.5;

/** Shadow distance. Past this, fog owns the image anyway (ATMOSPHERE.fogDensity). */
const MAX_FAR = 140;

/**
 * How far *behind* the cascade the light is pulled back, in metres. This is the caster
 * capture range: a caster only shadows the ground under it if it still sits *in front* of the
 * shadow camera, and at 8° of elevation an object of height h is `h / sin(8°)` = 7.19·h metres
 * away from its own contact shadow *along the light ray*. The 22 m gantry crane therefore needs
 * 158 m of pull-back before its shadow reaches the tarmac, and the old 150 m clipped it — the
 * one caster whose shadow organises the whole yard was the one falling off the near plane.
 * 180 m covers the crane, the 18 m water tower and the 9 m walls with room to spare.
 */
const LIGHT_MARGIN = 180;

/**
 * Normal offset, in texels of the cascade, for the two filter paths.
 *
 * Normal-offset shadows (Holbert): displacing the receiver along its shading normal by
 * `k · texel · sinθ` (θ = angle between the normal and the light) removes the depth error a
 * filter kernel of `k` texels sees on a tilted plane. The `sinθ` is what makes it bounded —
 * the naive `1/cosθ` form explodes at the grazing angles this whole map is made of and is what
 * detached every shadow from its object.
 *
 * The cost of the offset is *lateral*: a receiver lifted `n` along its normal loses the shadow
 * of anything shorter than `n`, and slides the shadow edge `n / tan(elevation)` = 7.1·n metres
 * downsun. At 0.35 m that was 2.5 m of slide — the peter-panning the review saw. So the
 * filtered path keeps the offset tiny and pays for acne with the slope-scaled depth bias
 * inside `ashfallShadowCH` instead; the stock 5-tap path has no slope term available and has
 * to carry more.
 */
const NORMAL_BIAS_TEXELS = 1.25;
const NORMAL_BIAS_TEXELS_NOSLOPE = 3.2;

/**
 * Safety factor on the normal offset. The derivation assumes the shading normal is the
 * geometric one; interpolated vertex normals on curved rubble and the detail-normal blend in
 * materials.js both break that assumption.
 */
const NORMAL_BIAS_SAFETY = 1.25;

/** Hard floor/ceiling on the normal offset, in metres. Guards against absurd cascade extents. */
const NORMAL_BIAS_MIN = 0.008;
/**
 * 0.06 m is the ceiling the art direction can afford: it costs 0.43 m of shadow slide at an 8°
 * sun, which the screen-space contact trace below then covers. Anything larger and kerbs,
 * rubble and boots stop touching the ground.
 */
const NORMAL_BIAS_MAX = 0.06;

/**
 * Floor on sinθ. The key can be driven anywhere by `sky.setTimeOfDay`; with the sun overhead
 * the ground needs almost no offset but a 45° roof pitch still does, so never derive from a
 * sinθ below this.
 */
const SIN_THETA_FLOOR = 0.35;

/**
 * Slope-scaled depth bias, in texels, applied inside the contact filter (§3.3 asks for
 * "normal-offset + slope-scaled bias"). Across `k` texels of kernel a receiver tilted θ off the
 * light varies in light-space depth by `k · texel · tanθ`; unlike the normal offset this is
 * paid *along* the light, where at 8° it only unshadows casters shorter than `bias · sin(8°)` —
 * i.e. a 0.11 m bias costs contact only for things under 1.5 cm tall. That is the right place
 * to spend the acne budget at a raking sun.
 */
const SLOPE_BIAS_TEXELS = 1.6;
/** tan(86°). Past this the surface is edge-on to the key and unlit anyway. */
const SLOPE_MAX_TAN = 14.0;

/**
 * Screen-space contact shadow. The cascades cannot resolve the first half-metre of contact at
 * this sun angle no matter how the bias is tuned (one cascade-0 texel is already 10 mm and the
 * shadow slides 7.1x any offset), so the last 0.5 m is traced against the prepass depth buffer
 * instead. 0.5 m at 8° is the shadow of a 7 cm pebble — exactly the scale that was missing.
 */
const SSCS_DISTANCE = 0.5;
const SSCS_STEPS = 8;

/** Constant depth bias, expressed as a fraction of one texel of world-space depth slope. */
const DEPTH_BIAS_TEXELS = 0.5;
/** …clamped so it can still clear a 16-bit depth quantum but never reaches peter-panning. */
const DEPTH_BIAS_MIN = 2.5e-5;
const DEPTH_BIAS_MAX = 3.0e-4;

/**
 * Blocker-histogram bucket edges for the contact-hardening filter, in metres of separation
 * between receiver and caster. 0.35 m ≈ "resting on it" (crate on tarmac, boot on gravel),
 * 2.8 m ≈ "standing under it" (a wagon roof, the depot gantry). Past that the penumbra is
 * clamped by the search radius anyway.
 */
const CH_NEAR = 0.35;
const CH_FAR = 2.8;

/** How often the auto-registration sweep walks the scene graph, in frames. */
const SWEEP_INTERVAL = 24;

/* -------------------------------------------------------------------------- */
/* Live shader chunks, captured before CSM forks them                          */
/* -------------------------------------------------------------------------- */

// Captured at import time: CSM only overwrites these inside its constructor, so at this point
// they are guaranteed to be r185's own text.
const STOCK_LIGHTS_FRAGMENT = THREE.ShaderChunk.lights_fragment_begin;
const STOCK_LIGHTS_PARS = THREE.ShaderChunk.lights_pars_begin;
const STOCK_SHADOWMAP_PARS = THREE.ShaderChunk.shadowmap_pars_fragment;

/** Splice markers. Both texts are three's, so these are stable across the two files. */
const DIR_BLOCK_MARK = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const RECT_BLOCK_MARK = '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )';

/**
 * Where CSM's cascaded branch ends and the plain `!defined( USE_CSM )` branch begins. The two
 * emit *character-identical* shadow lookups, so the contact-hardening substitution has to stop
 * here: patching the second one would make every non-CSM lit material — the whole viewmodel
 * scene — call a function that only exists when `USE_CSM` is defined.
 */
const NON_CSM_BLOCK_MARK = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && !defined( USE_CSM )';

/** The exact directional shadow lookup CSM emits, in both its faded and unfaded branches. */
const CSM_GETSHADOW_CALL =
  'getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, ' +
  'directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, ' +
  'directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )';

/**
 * Our replacement. The three extra arguments are all in scope at both call sites: CSM's chunk
 * declares `geometryPosition` / `geometryNormal` at the top of `lights_fragment_begin`, and
 * `getDirectionalLightInfo()` has already filled `directLight.direction` (view space, pointing
 * *at* the light) on the line above each lookup. They give the filter the receiver slope it
 * needs for the slope-scaled bias, and the ray it needs for the contact trace.
 */
const CSM_CONTACT_CALL =
  'ashfallShadowCH( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, ' +
  'directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, ' +
  'directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ], ' +
  'ashfallCH[ UNROLLED_LOOP_INDEX ], geometryPosition, geometryNormal, directLight.direction )';

/** GLSL float literal — `1` is an int in GLSL and will not implicitly convert in ES 3.0. */
function glf(x) {
  const s = Number(x).toPrecision(8);
  return s.indexOf('.') === -1 && s.indexOf('e') === -1 ? `${s}.0` : s;
}

/**
 * Contact-hardening directional shadow filter.
 *
 * Real PCSS needs the blocker *depth*, and r185 binds directional shadow maps as
 * `sampler2DShadow` — a comparison sampler, from which raw depth cannot be read, and WebGL2
 * (GLSL ES 3.00) has no `textureGather` to work around it. So instead of reading the blocker
 * depth we *ask for it*: the comparison sampler will happily answer "is anything closer to the
 * light than `z - d`?" for any `d` we choose. Two extra probe depths turn that into a
 * three-bucket histogram of blocker distance, which is all the penumbra estimate needs.
 *
 * Penumbra width is then physical rather than tuned: for a light of angular diameter `a`, a
 * caster `d` metres from the receiver casts a penumbra `a * d` wide. `a` is
 * `LIGHTING.sunAngularDiameter` (0.0093 rad — the real sun), so a crate resting on the tarmac
 * gets a millimetre of softness and the crane 20 m up gets 19 cm of it.
 *
 * Cost: 7 taps for the overwhelming majority of pixels (fully lit or deep in umbra, both of
 * which early out), 7 + 14 + N on penumbra pixels only.
 */
function buildContactGLSL(preset, softnessTanScale, sscs) {
  const searchTaps = preset.search;
  const taps = preset.taps;
  return /* glsl */ `
#if defined( USE_SHADOWMAP ) && defined( USE_CSM ) && defined( CSM_CASCADES )

	#define ASHFALL_SEARCH_TAPS ${searchTaps}
	#define ASHFALL_TAPS ${taps}
	#define ASHFALL_SUN_TAN ${glf(softnessTanScale)}
	#define ASHFALL_CH_NEAR ${glf(CH_NEAR)}
	#define ASHFALL_CH_FAR ${glf(CH_FAR)}
	#define ASHFALL_SLOPE_TEXELS ${glf(SLOPE_BIAS_TEXELS)}
	#define ASHFALL_MAX_TAN ${glf(SLOPE_MAX_TAN)}
${sscs ? `	#define ASHFALL_SSCS\n	#define ASHFALL_SSCS_STEPS ${SSCS_STEPS}\n` : ''}

	// Jimenez's interleaved gradient noise. Screen-space and *static across frames* on purpose:
	// a per-frame rotation would hand TAA a new dither pattern every frame and read as boiling
	// on a still image, whereas a fixed pattern is resolved by the neighbourhood clamp and
	// buried under the film grain.
	float ashfallIGN( vec2 p ) {
		return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
	}

	// Vogel disc: golden-angle spiral, uniform area density, no clustering at the centre.
	vec2 ashfallVogel( int i, float invCount, float phi ) {
		float r = sqrt( ( float( i ) + 0.5 ) * invCount );
		float t = float( i ) * 2.3999632297286533 + phi;
		return vec2( cos( t ), sin( t ) ) * r;
	}

	#if defined( SHADOWMAP_TYPE_PCF )
		#define ASHFALL_SAMPLER sampler2DShadow
		#define ASHFALL_CMP( m, uv, z ) texture( m, vec3( uv, z ) )
	#else
		#define ASHFALL_SAMPLER sampler2D
		#define ASHFALL_CMP( m, uv, z ) step( z, texture2D( m, uv ).r )
	#endif

	#if defined( ASHFALL_SSCS )

		/** Window depth [0,1] -> view-space z (negative, metres). */
		float ashfallLinearZ( float d, float n, float f ) {
			return ( n * f ) / ( ( f - n ) * d - f );
		}

		/**
		 * Screen-space contact shadow.
		 *
		 * March the first ASHFALL_SSCS_DIST metres of the ray towards the sun through the
		 * prepass depth buffer (engine.targets.normal's DepthTexture: written this frame, with
		 * the same jittered projection, and *not* bound while the world pass runs, so there is
		 * no feedback hazard). Anything the ray runs into that close is a contact the cascade
		 * physically cannot resolve: one cascade-0 texel is already 10 mm across and any normal
		 * offset slides the shadow 7.1x itself downsun at this elevation.
		 *
		 * Fails safe in every direction: off-screen, behind the eye, back-facing or with no
		 * depth texture bound all return "lit" and leave the cascade term untouched.
		 */
		float ashfallContactTrace( vec3 vPos, vec3 vNrm, vec3 vLightDir, float ndl ) {
			if ( ashfallSSCS.w < 0.5 || ndl <= 0.03 ) return 1.0;

			float maxD = ashfallSSCS.z;
			// Lift off the receiver before the first tap, along the normal (clears its own
			// depth) and along the light (clears the texel the fragment itself wrote).
			vec3 lift = vNrm * ( maxD * 0.05 );
			vec3 p0 = vPos + lift + vLightDir * ( maxD * 0.05 );
			vec3 p1 = vPos + lift + vLightDir * maxD;

			// Depth-buffer precision falls off with distance, so the "is this in front of me"
			// threshold has to grow with it or the far field self-occludes.
			float zBias = 0.012 - vPos.z * 0.004;
			// Past this the hit is a different surface entirely, not the caster: accepting it
			// would paint a silhouette of every foreground object onto the background.
			float thick = maxD * 1.5 - vPos.z * 0.05;

			float dither = ashfallIGN( gl_FragCoord.xy );
			float invSteps = 1.0 / float( ASHFALL_SSCS_STEPS );
			float hit = 0.0;

			for ( int i = 0; i < ASHFALL_SSCS_STEPS; i ++ ) {
				float t = ( float( i ) + dither ) * invSteps;
				vec3 p = mix( p0, p1, t );
				vec4 clip = ashfallProj * vec4( p, 1.0 );
				if ( clip.w <= 1e-5 ) break;
				vec2 uv = ( clip.xy / clip.w ) * 0.5 + 0.5;
				if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) break;
				float sceneZ = ashfallLinearZ( texture2D( ashfallDepthTex, uv ).x, ashfallSSCS.x, ashfallSSCS.y );
				float diff = sceneZ - p.z; // > 0: the scene surface is nearer the eye than the ray
				if ( diff > zBias && diff < thick ) {
					// Ramp out over the last third so the hand-off to the cascade is not a ring.
					hit = 1.0 - smoothstep( 0.66, 1.0, t );
					break;
				}
			}
			return 1.0 - hit;
		}

	#endif

	// chParams.x = metres per unit of shadow-map depth (the cascade's ortho depth range)
	// chParams.y = shadow-map texels per metre across the cascade, times params.softness
	// chParams.z = metres per shadow-map texel across the cascade (no softness applied)
	float ashfallShadowCascade( ASHFALL_SAMPLER shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, vec4 chParams, float ndl ) {

		// A cascade whose uniform never arrived (a material set up behind our back) reports a
		// zero depth range. Degrade to the stock filter rather than divide by it.
		if ( chParams.x <= 0.0 ) {
			return getShadow( shadowMap, shadowMapSize, shadowIntensity, shadowBias, shadowRadius, shadowCoord );
		}

		vec3 sc = shadowCoord.xyz / shadowCoord.w;
		sc.z += shadowBias;

		// Slope-scaled receiver bias. See SLOPE_BIAS_TEXELS: this is the term that lets the
		// normal offset stay at a couple of centimetres on a map whose every ground plane is
		// 82 degrees off the key. Paid along the light, where it costs almost no contact.
		float tanT = min( sqrt( max( 1.0 - ndl * ndl, 0.0 ) ) / max( ndl, 0.07 ), ASHFALL_MAX_TAN );
		sc.z -= ( ASHFALL_SLOPE_TEXELS * chParams.z * tanT ) / chParams.x;

		if ( sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 ) return 1.0;

		vec2 texel = vec2( 1.0 ) / shadowMapSize;
		float phi = ashfallIGN( gl_FragCoord.xy ) * PI2;
		vec2 searchStep = texel * shadowRadius;
		float invSearch = 1.0 / float( ASHFALL_SEARCH_TAPS );
		float total = float( ASHFALL_SEARCH_TAPS ) + 1.0;

		// --- 1. Is there a blocker anywhere inside the widest penumbra we support? ---------
		float lit = ASHFALL_CMP( shadowMap, sc.xy, sc.z );
		for ( int i = 0; i < ASHFALL_SEARCH_TAPS; i ++ ) {
			lit += ASHFALL_CMP( shadowMap, sc.xy + ashfallVogel( i, invSearch, phi ) * searchStep, sc.z );
		}
		if ( lit > total - 0.001 ) return 1.0;                    // open ground, done in 7 taps
		if ( lit < 0.001 ) return 1.0 - shadowIntensity;          // deep umbra, done in 7 taps

		// --- 2. How far away are those blockers? ------------------------------------------
		// Probing at a reduced reference depth asks the comparison sampler "is the blocker at
		// least this far in front of me?", which buckets the occlusion by distance.
		float dzNear = ASHFALL_CH_NEAR / chParams.x;
		float dzFar = ASHFALL_CH_FAR / chParams.x;
		float litNear = ASHFALL_CMP( shadowMap, sc.xy, sc.z - dzNear );
		float litFar = ASHFALL_CMP( shadowMap, sc.xy, sc.z - dzFar );
		for ( int i = 0; i < ASHFALL_SEARCH_TAPS; i ++ ) {
			vec2 o = ashfallVogel( i, invSearch, phi ) * searchStep;
			litNear += ASHFALL_CMP( shadowMap, sc.xy + o, sc.z - dzNear );
			litFar += ASHFALL_CMP( shadowMap, sc.xy + o, sc.z - dzFar );
		}

		float occ = total - lit;
		float fN = clamp( max( total - litNear, 0.0 ) / occ, 0.0, 1.0 ); // share beyond CH_NEAR
		float fF = clamp( max( total - litFar, 0.0 ) / occ, 0.0, 1.0 );  // share beyond CH_FAR

		// Weighted mean of the three bucket midpoints. Weights sum to one by construction.
		float dist = ( 1.0 - fN ) * ( 0.5 * ASHFALL_CH_NEAR )
			+ max( fN - fF, 0.0 ) * ( 0.5 * ( ASHFALL_CH_NEAR + ASHFALL_CH_FAR ) )
			+ fF * ( ASHFALL_CH_FAR * 2.0 );

		// --- 3. Filter at the physical penumbra width -------------------------------------
		// 0.6 texels is the floor: below one texel the kernel degenerates into the aliased
		// single tap we are here to avoid.
		float pen = clamp( ASHFALL_SUN_TAN * dist * chParams.y, 0.6, shadowRadius );
		vec2 penStep = texel * pen;
		float invTaps = 1.0 / float( ASHFALL_TAPS );
		float sum = 0.0;
		for ( int i = 0; i < ASHFALL_TAPS; i ++ ) {
			// Rotated off the search pattern so the two sample sets do not correlate.
			sum += ASHFALL_CMP( shadowMap, sc.xy + ashfallVogel( i, invTaps, phi + 1.2 ) * penStep, sc.z );
		}
		return mix( 1.0, sum * invTaps, shadowIntensity );

	}

	/**
	 * The entry point CSM's cascade loop actually calls. Combines the cascaded term with the
	 * screen-space contact trace, so a contact survives whatever the cascade bias does to it.
	 */
	float ashfallShadowCH( ASHFALL_SAMPLER shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, vec4 chParams, vec3 vPos, vec3 vNrm, vec3 vLightDir ) {

	#if defined( USE_REVERSED_DEPTH_BUFFER )

		// Reversed depth flips every comparison above; not worth two code paths for a mode the
		// engine does not enable. Fall back to three's own filter.
		return getShadow( shadowMap, shadowMapSize, shadowIntensity, shadowBias, shadowRadius, shadowCoord );

	#else

		float ndl = clamp( dot( normalize( vNrm ), vLightDir ), 0.0, 1.0 );
		float s = ashfallShadowCascade( shadowMap, shadowMapSize, shadowIntensity, shadowBias, shadowRadius, shadowCoord, chParams, ndl );

		#if defined( ASHFALL_SSCS )
			// min(), not multiply: both terms describe the same occluder near a contact and
			// multiplying them would double-darken the metre where they overlap.
			s = min( s, mix( 1.0, ashfallContactTrace( vPos, vNrm, vLightDir, ndl ), shadowIntensity ) );
		#endif

		return s;

	#endif

	}

#endif
`;
}

/**
 * Rebuild `lights_fragment_begin` from r185's live text plus CSM's cascade block, instead of
 * letting CSM install its pre-r185 fork wholesale. Returns null if either text has moved on
 * far enough that the splice markers are gone, in which case the caller leaves CSM's own
 * chunks in place.
 */
function composeLightsFragment(csmText, contact) {
  const s0 = STOCK_LIGHTS_FRAGMENT.indexOf(DIR_BLOCK_MARK);
  const s1 = STOCK_LIGHTS_FRAGMENT.indexOf(RECT_BLOCK_MARK);
  const c0 = csmText.indexOf(DIR_BLOCK_MARK);
  const c1 = csmText.indexOf(RECT_BLOCK_MARK);
  if (s0 < 0 || s1 <= s0 || c0 < 0 || c1 <= c0) return null;

  // CSM's slice carries both the cascaded branch and the plain `!defined( USE_CSM )` branch,
  // which is what unregistered materials and the viewmodel scene fall through to.
  let dir = csmText.slice(c0, c1);

  if (contact) {
    const cut = dir.indexOf(NON_CSM_BLOCK_MARK);
    if (cut < 0) return null;
    const cascaded = dir.slice(0, cut);
    // Exactly two lookups live in the cascaded branch: one faded, one not. Any other count
    // means the addon has been revised underneath us and the substitution is no longer safe.
    const parts = cascaded.split(CSM_GETSHADOW_CALL);
    if (parts.length !== 3) return null;
    dir = parts.join(CSM_CONTACT_CALL) + dir.slice(cut);
  }

  return STOCK_LIGHTS_FRAGMENT.slice(0, s0) + dir + STOCK_LIGHTS_FRAGMENT.slice(s1);
}

/**
 * `lights_pars_begin` runs *before* `shadowmap_pars_fragment` in every material, so this is
 * where the filter's uniforms have to be declared for `ashfallShadowCH` to see them.
 */
function composeLightsPars(contact, sscs) {
  return (
    /* glsl */ `
#if defined( USE_CSM ) && defined( CSM_CASCADES )
uniform vec2 CSM_cascades[ CSM_CASCADES ];
uniform float cameraNear;
uniform float shadowFar;
${contact ? 'uniform vec4 ashfallCH[ CSM_CASCADES ];' : ''}
${sscs ? 'uniform sampler2D ashfallDepthTex;\nuniform mat4 ashfallProj;\nuniform vec4 ashfallSSCS;' : ''}
#endif
` + STOCK_LIGHTS_PARS
  );
}

/**
 * Compile the patched GLSL standalone before letting it anywhere near the material system.
 * A shader chunk that fails to compile takes out *every* lit material in the scene, so this
 * one-off check is the difference between "shadows are a bit hard" and a black screen.
 */
function validateContactGLSL(gl, glsl) {
  if (!gl || typeof gl.createShader !== 'function') return false;
  // GLSL ES 3.00 only. WebGL1 contexts get the plain path.
  if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return false;

  const variants = [true, false]; // sampler2DShadow (PCF) and sampler2D (basic) forms
  for (let v = 0; v < variants.length; v++) {
    const src =
      // Mirrors three's own GLSL3 fragment prefix: same precision statements and the same
      // ES1 -> ES3 sampler aliases, or the probe would reject code the real compile accepts.
      '#version 300 es\n' +
      'precision highp float;\nprecision highp int;\n' +
      'precision highp sampler2D;\nprecision highp sampler2DShadow;\n' +
      '#define texture2D texture\n' +
      '#define PI2 6.283185307179586\n' +
      '#define USE_SHADOWMAP\n#define USE_CSM\n#define CSM_CASCADES 4\n' +
      (variants[v] ? '#define SHADOWMAP_TYPE_PCF\n' : '') +
      (variants[v]
        ? 'float getShadow( sampler2DShadow m, vec2 s, float i, float b, float r, vec4 c );\n'
        : 'float getShadow( sampler2D m, vec2 s, float i, float b, float r, vec4 c );\n') +
      // The uniforms lights_pars_begin would have declared by the time this chunk is reached.
      'uniform sampler2D ashfallDepthTex;\nuniform mat4 ashfallProj;\nuniform vec4 ashfallSSCS;\n' +
      glsl +
      '\nuniform ASHFALL_SAMPLER uMap;\nuniform vec4 uCh;\nout vec4 oColour;\n' +
      'void main() { oColour = vec4( ashfallShadowCH( uMap, vec2( 2048.0 ), 1.0, -0.0001, 6.0, ' +
      'vec4( 0.5, 0.5, 0.5, 1.0 ), uCh, vec3( 0.0, 0.0, -5.0 ), vec3( 0.0, 1.0, 0.0 ), ' +
      'vec3( 0.0, 0.14, 0.99 ) ) ); }\n';

    let shader = null;
    let ok = false;
    try {
      shader = gl.createShader(gl.FRAGMENT_SHADER);
      if (!shader) return false;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true;
    } catch (err) {
      ok = false;
    } finally {
      if (shader) {
        try {
          gl.deleteShader(shader);
        } catch (err) {
          /* context already gone; nothing to clean up */
        }
      }
    }
    if (!ok) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Materials that actually run `lights_fragment_begin`, i.e. the ones CSM has to touch. */
function isLitMaterial(m) {
  return !!(
    m &&
    m.isMaterial &&
    (m.isMeshStandardMaterial ||
      m.isMeshPhysicalMaterial ||
      m.isMeshPhongMaterial ||
      m.isMeshLambertMaterial ||
      m.isMeshToonMaterial) &&
    !(m.userData && m.userData.noCSM)
  );
}

/* -------------------------------------------------------------------------- */
/* Factory                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} engine   from core/engine.js
 * @param {THREE.DirectionalLight} sun  from world/sky.js — mirrored, not used directly
 * @param {'low'|'medium'|'high'|'ultra'} quality
 */
export function createShadows(engine, sun, quality = DEFAULT_QUALITY) {
  const renderer = engine.renderer;
  const scene = engine.scene;
  const gl = engine.gl || (renderer.getContext ? renderer.getContext() : null);

  let qualityName = PRESETS[quality] ? quality : engine.quality && PRESETS[engine.quality] ? engine.quality : DEFAULT_QUALITY;
  let preset = presetOf(qualityName);

  /* --- Renderer state ---------------------------------------------------- */

  renderer.shadowMap.enabled = true;
  // §3.1 bans VSM (it leaks through the depot's thin walls) and Basic is a single aliased tap.
  // r185 rewrites PCFSoftShadowMap -> PCFShadowMap on the first shadow render, so we must not
  // re-assign it here or that migration (and its full material rebuild) fires every frame.
  if (
    renderer.shadowMap.type === THREE.VSMShadowMap ||
    renderer.shadowMap.type === THREE.BasicShadowMap
  ) {
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  const maxTextureSize = (renderer.capabilities && renderer.capabilities.maxTextureSize) || 2048;

  /* --- Live parameters --------------------------------------------------- */

  const params = {
    /**
     * Penumbra scale. 1.0 = physically correct for a sun of `LIGHTING.sunAngularDiameter`.
     * Push it up for a hazier, dustier key; the search radius clamps the result either way.
     */
    softness: 1.0,
    /** Multiplier on the derived per-cascade normal offset. */
    normalBiasScale: 1.0,
    /** Multiplier on the derived per-cascade constant depth bias. */
    depthBiasScale: 1.0,
    /** Shadow distance in metres. Cascades are refit when this changes. */
    maxFar: MAX_FAR,
    /** Caster capture distance behind each cascade, in metres. */
    lightMargin: LIGHT_MARGIN,
    /** Cross-cascade blend. Off makes the transition a visible hard line. */
    fade: true,
    /** Walk the scene periodically and CSM-register any lit material we have not seen. */
    autoRegister: true,
  };

  /* --- Fit camera -------------------------------------------------------- */

  /**
   * CSM fits cascades to a camera. It must not be the live one: postfx jitters
   * `camera.projectionMatrix` for TAA, and the weapon pulls the FOV from 75 to 58 during ADS.
   * Refitting on a jittered or narrowing frustum re-derives every cascade extent, which
   * re-quantises the texel snap and makes shadow edges crawl mid-transition. So we keep a
   * private camera pinned to the hip-fire FOV and copy only the world matrix each frame:
   * ADS then renders with cascades that are slightly wider than strictly needed — free, stable,
   * and correct — instead of ones that visibly resharpen as you aim.
   */
  const fitCam = new THREE.PerspectiveCamera(
    engine.camera.fov,
    engine.camera.aspect,
    engine.camera.near,
    engine.camera.far
  );
  fitCam.matrixAutoUpdate = false;
  fitCam.updateProjectionMatrix();

  let fitFov = fitCam.fov;
  let fitAspect = fitCam.aspect;
  let fitNear = fitCam.near;
  let fitFar = fitCam.far;

  /* --- State ------------------------------------------------------------- */

  /** @type {CSM|null} */
  let csm = null;
  let usingCSM = false;
  let contactActive = false;
  let sscsActive = false;
  let disposed = false;

  /**
   * Per-cascade (depthRangeMetres, texelsPerMetre * softness, metresPerTexel, 0) fed to the
   * contact filter. One shared array; the shader reads it in place, so nothing allocates.
   */
  let chArray = [];
  const chUniform = { value: chArray };

  /**
   * Screen-space contact trace uniforms. `ashfallProj` deliberately holds a *reference* to the
   * live `camera.projectionMatrix`: postfx applies the TAA jitter to that same object after
   * `shadows.update()` has run, and the prepass depth we sample was rasterised with the jitter
   * in place, so the reference is the only way the two stay aligned.
   */
  const _sscsParams = new THREE.Vector4(0.05, 600, SSCS_DISTANCE, 0);
  const sscsParamsUniform = { value: _sscsParams };
  const sscsProjUniform = { value: engine.camera ? engine.camera.projectionMatrix : new THREE.Matrix4() };
  const sscsDepthUniform = { value: null };

  /** The prepass depth buffer, when the engine has one. Null disables the trace at runtime. */
  function prepassDepth() {
    const t = engine.targets && engine.targets.normal;
    return t && t.depthTexture ? t.depthTexture : null;
  }

  /** material -> { userHook, wrapped, authorKey, keyFn, csm } */
  const registry = new Map();

  /** Fallback single-light path. `ownsFallback` is false when we borrowed the sun itself. */
  let fallbackLight = null;
  let ownsFallback = false;

  let frame = 0;
  let sweepFrame = 0;
  let cachedSoftness = params.softness;
  let cachedNormalScale = params.normalBiasScale;
  let cachedDepthScale = params.depthBiasScale;
  let cachedMaxFar = params.maxFar;
  let cachedGroundSin = 1;

  /* --- Sun mirroring ----------------------------------------------------- */

  let sunLight = sun && sun.isLight ? sun : null;
  let sunIntensity = LIGHTING.sunIntensity;
  _colour.setStyle(PALETTE.sun, THREE.SRGBColorSpace);

  /**
   * sin of the angle between an up-facing receiver and the key — the `sinθ` in the normal
   * offset. At the art-directed 8° this is 0.99, i.e. the ground is very nearly edge-on to the
   * sun, which is precisely why the offset has to be derived and not guessed.
   */
  let groundSin = 1;

  function readSun() {
    if (sunLight) {
      _sunDir.copy(sunLight.position);
      if (sunLight.target) _sunDir.sub(sunLight.target.position);
      if (_sunDir.lengthSq() < 1e-10) _sunDir.copy(DEFAULT_SUN_DIR);
      else _sunDir.normalize();
      sunIntensity = sunLight.intensity;
      _colour.copy(sunLight.color);

      // The cascade lights emit for it; two shadow-casting directional lights would overflow
      // the cascade uniform. Only assign when it is actually wrong: flipping `castShadow`
      // every frame would rebuild every program in the scene every frame.
      if (sunLight.castShadow && sunLight !== fallbackLight) sunLight.castShadow = false;
      if ((usingCSM || ownsFallback) && sunLight.visible) sunLight.visible = false;
    } else {
      _sunDir.copy(DEFAULT_SUN_DIR);
      sunIntensity = LIGHTING.sunIntensity;
      _colour.setStyle(PALETTE.sun, THREE.SRGBColorSpace);
    }

    // Ground normal is +Y, so cosθ is just the sun's elevation sine.
    const cosT = clamp(_sunDir.y, -1, 1);
    groundSin = Math.max(Math.sqrt(Math.max(0, 1 - cosT * cosT)), SIN_THETA_FLOOR);

    _lightDir.copy(_sunDir).negate();
    // A sun exactly overhead makes the light-orientation lookAt singular (dir parallel to up).
    // Cannot happen at the art-directed 8°, but sky.setTimeOfDay can drive anywhere.
    if (Math.abs(_lightDir.y) > 0.9995) {
      _lightDir.x += 0.02;
      _lightDir.normalize();
    }
  }

  readSun();

  /* --- Build ------------------------------------------------------------- */

  /**
   * `practical` split with the contract's lambda. The vendored addon hard-codes lambda 0.5 in
   * its own `practical` branch, so we drive the identical maths through `custom` instead —
   * same scheme, correct constant, plus the SPLIT_NEAR fix.
   */
  function practicalSplits(cascades, near, far, target) {
    const n = Math.max(near, SPLIT_NEAR);
    for (let i = 1; i < cascades; i++) {
      const log = n * Math.pow(far / n, i / cascades);
      const uni = n + (far - n) * (i / cascades);
      // Normalised against `far` to match how the addon feeds CSM_cascades to the shader.
      target.push(THREE.MathUtils.lerp(uni, log, SPLIT_LAMBDA) / far);
    }
    target.push(1);
  }

  function buildCSM() {
    const instance = new CSM({
      camera: fitCam,
      parent: scene,
      cascades: preset.cascades,
      maxFar: params.maxFar,
      mode: 'custom',
      customSplitsCallback: practicalSplits,
      shadowMapSize: Math.min(preset.mapSize, maxTextureSize),
      shadowBias: 0, // replaced per cascade by applyCascadeTuning()
      lightDirection: _lightDir.clone(),
      lightIntensity: sunIntensity,
      lightNear: 0.05,
      lightFar: params.lightMargin + 400,
      lightMargin: params.lightMargin,
    });
    // `fade` is not read from the constructor data by the addon, and it feeds both the shader
    // define and the shadow-bound margin, so it has to be set before the first refit.
    instance.fade = !!params.fade;
    instance.updateFrustums();
    return instance;
  }

  try {
    csm = buildCSM();
    usingCSM = true;
  } catch (err) {
    csm = null;
    usingCSM = false;
  }

  /* --- Shader chunk composition ------------------------------------------ */

  /**
   * CSM's forked `lights_fragment_begin`, read back off the ShaderChunk the addon just
   * installed rather than importing CSMShader separately, so we always splice the exact text
   * this build of the addon uses.
   */
  let csmFragmentSource = usingCSM ? THREE.ShaderChunk.lights_fragment_begin : '';

  function installChunks() {
    if (!usingCSM) return;
    contactActive = false;
    sscsActive = false;

    // CSM's constructor has already installed its own (pre-r185) fork of these two chunks.
    // Everything below either improves on that or leaves it exactly as it is.
    let wantContact = !!preset.contact;
    // The trace needs a depth buffer that is *not* the one being written. engine's prepass
    // target is exactly that. Compile it in whenever the engine has a targets bag at all and
    // let the runtime flag in `ashfallSSCS.w` switch it off if the texture is absent — the
    // targets can be rebuilt (resize, quality flip) long after the chunks were installed.
    let wantSSCS = wantContact && !!(engine.targets && typeof engine.targets === 'object');
    let glsl = '';

    if (wantContact) {
      glsl = buildContactGLSL(preset, LIGHTING.sunAngularDiameter, wantSSCS);
      let ok = validateContactGLSL(gl, glsl);
      if (!ok && wantSSCS) {
        // Retry without the trace before giving up on contact hardening altogether: the
        // penumbra filter is worth keeping even on a driver that chokes on the depth march.
        wantSSCS = false;
        glsl = buildContactGLSL(preset, LIGHTING.sunAngularDiameter, false);
        ok = validateContactGLSL(gl, glsl);
      }
      if (!ok) {
        wantContact = false;
        wantSSCS = false;
      }
    }

    let composed = null;
    try {
      composed = composeLightsFragment(csmFragmentSource, wantContact);
      if (!composed && wantContact) {
        // The splice failed with contact hardening on; try again without it before giving up,
        // since the plain splice still restores r185's current iridescence and light-probe
        // code that the addon's fork predates.
        wantContact = false;
        wantSSCS = false;
        composed = composeLightsFragment(csmFragmentSource, false);
      }
    } catch (err) {
      composed = null;
    }

    if (!composed) return; // leave the addon's own chunks in place — still a working scene

    THREE.ShaderChunk.lights_fragment_begin = composed;
    THREE.ShaderChunk.lights_pars_begin = composeLightsPars(wantContact, wantSSCS);
    THREE.ShaderChunk.shadowmap_pars_fragment = wantContact
      ? STOCK_SHADOWMAP_PARS + glsl
      : STOCK_SHADOWMAP_PARS;
    contactActive = wantContact;
    sscsActive = wantSSCS;
    if (sscsActive) {
      const depth = prepassDepth();
      sscsDepthUniform.value = depth;
      _sscsParams.set(engine.camera.near, engine.camera.far, SSCS_DISTANCE, depth ? 1 : 0);
    }
  }

  installChunks();

  // With the cascades live the sun itself must stop emitting (see the header note).
  if (usingCSM && sunLight) {
    sunLight.castShadow = false;
    sunLight.visible = false;
  }

  /* --- Cascade tuning ---------------------------------------------------- */

  function ensureChArray(n) {
    while (chArray.length < n) chArray.push(new THREE.Vector4(1, 1, 1, 0));
    chArray.length = n;
    chUniform.value = chArray;
  }

  /**
   * Per-cascade bias, filter radius and contact-filter constants, all derived from the
   * *measured* world size of one shadow texel rather than guessed.
   *
   * Normal offset (Holbert). A receiver plane whose normal sits θ off the light direction is
   * displaced along that normal by `k · t · sinθ`, where `t` is the cascade's texel in metres
   * and `k` the kernel it has to survive. The `sinθ` is the whole point: it is bounded, where
   * the `1/cosθ` form the old derivation collapsed into runs away at exactly the grazing
   * angles this map is made of and detaches every shadow from its object.
   *
   * At high (2048, cascade 0 ≈ 10 mm texels, 8° sun) that lands on 16 mm — 0.11 m of shadow
   * slide downsun, which the screen-space contact trace then covers. The wide cascades clamp
   * to NORMAL_BIAS_MAX and rely on the slope-scaled bias inside the filter instead; when the
   * filter is not available (low/medium, or a driver that rejected the patched GLSL) the
   * offset is scaled up to NORMAL_BIAS_TEXELS_NOSLOPE because nothing else is holding acne off.
   *
   * Depth bias. Half a texel of slope, expressed in the cascade's normalised depth units.
   * Clamped at the bottom so it still clears a 16-bit depth quantum and at the top so it can
   * never detach a shadow from its contact point.
   */
  function applyCascadeTuning() {
    if (!usingCSM || !csm) return;
    const size = csm.shadowMapSize;
    const n = csm.lights.length;
    ensureChArray(n);

    for (let i = 0; i < n; i++) {
      const light = csm.lights[i];
      const cam = light.shadow.camera;
      const width = cam.right - cam.left; // metres the cascade covers
      if (!(width > 0)) continue;
      const texel = width / size; // world size of one shadow texel

      // Tight depth range. The light sits `lightMargin` behind the cascade's light-space
      // bounding box and that box is never deeper than the cascade is wide, so anything past
      // `margin + width` is wasted precision — and precision is the unit the depth bias is
      // measured in.
      const near = 0.05;
      const far = params.lightMargin + width * 1.1 + 2.0;
      if (cam.near !== near || cam.far !== far) {
        cam.near = near;
        cam.far = far;
        cam.updateProjectionMatrix();
      }

      const offsetTexels = contactActive ? NORMAL_BIAS_TEXELS : NORMAL_BIAS_TEXELS_NOSLOPE;
      light.shadow.normalBias = clamp(
        offsetTexels * NORMAL_BIAS_SAFETY * texel * groundSin * params.normalBiasScale,
        NORMAL_BIAS_MIN,
        NORMAL_BIAS_MAX
      );
      light.shadow.bias = -clamp(
        (DEPTH_BIAS_TEXELS * texel * params.depthBiasScale) / (far - near),
        DEPTH_BIAS_MIN,
        DEPTH_BIAS_MAX
      );
      // Search radius for the contact filter; plain kernel radius for the stock 5-tap path.
      light.shadow.radius = contactActive
        ? preset.maxPenumbra
        : Math.max(1.0, preset.maxPenumbra * params.softness);
      light.shadow.intensity = 1.0;

      const ch = chArray[i];
      ch.x = far - near; // metres per unit of shadow depth
      ch.y = (size / width) * params.softness; // texels per metre
      ch.z = texel; // metres per texel — drives the slope-scaled bias
      ch.w = 0;
    }
  }

  applyCascadeTuning();

  /* --- Fallback: one well-configured directional light ------------------- */

  /** Half-width of the single fallback cascade, in metres. */
  const FALLBACK_HALF = 45;

  function configureFallbackShadow(light, size, half) {
    light.castShadow = true;
    light.shadow.mapSize.set(size, size);
    const cam = light.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 0.5;
    cam.far = LIGHT_MARGIN + 2 * half;
    cam.updateProjectionMatrix();

    // Same derivation as the cascaded path, one cascade wide. Always the no-slope constant:
    // the fallback runs three's stock filter, which has no slope term to lean on.
    const texel = (2 * half) / size;
    light.shadow.normalBias = clamp(
      NORMAL_BIAS_TEXELS_NOSLOPE * NORMAL_BIAS_SAFETY * texel * groundSin,
      NORMAL_BIAS_MIN,
      NORMAL_BIAS_MAX
    );
    light.shadow.bias = -clamp(
      (DEPTH_BIAS_TEXELS * texel) / (cam.far - cam.near),
      DEPTH_BIAS_MIN,
      DEPTH_BIAS_MAX
    );
    light.shadow.radius = Math.max(1.0, preset.maxPenumbra * 0.5);
    light.shadow.intensity = 1.0;
  }

  /**
   * No cascades. Fit one shadow to a 90 m window that tracks the player rather than to the
   * whole 110x90 m map — half the texel size, for the price of shadows stopping at the far
   * wall, which the fog is eating anyway.
   *
   * If a light of our own cannot be parented (a scene that rejects children, i.e. the same
   * failure that killed CSM in the first place) the sun itself is configured in place and left
   * emitting. Something always casts.
   */
  function buildFallback() {
    const size = Math.min(Math.max(preset.mapSize * 2, 1024), maxTextureSize);
    try {
      const light = new THREE.DirectionalLight(_colour.getHex(), sunIntensity);
      light.name = 'ashfallFallbackKey';
      configureFallbackShadow(light, size, FALLBACK_HALF);
      scene.add(light);
      scene.add(light.target);
      ownsFallback = true;
      if (sunLight) {
        sunLight.castShadow = false;
        sunLight.visible = false;
      }
      return light;
    } catch (err) {
      ownsFallback = false;
    }

    if (sunLight) {
      try {
        configureFallbackShadow(sunLight, size, FALLBACK_HALF);
        sunLight.visible = true;
        return sunLight;
      } catch (err) {
        /* nothing left to try */
      }
    }
    return null;
  }

  if (!usingCSM) fallbackLight = buildFallback();

  // The contract asks for the sun's own shadow map to be sized per preset. It never renders
  // one while CSM is live, but the value has to be right for the moment anything re-enables it.
  if (sunLight && sunLight.shadow) {
    const s = Math.min(preset.mapSize, maxTextureSize);
    sunLight.shadow.mapSize.set(s, s);
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = LIGHT_MARGIN + 200;
    sunLight.shadow.camera.updateProjectionMatrix();
  }

  /* --- Material registration --------------------------------------------- */

  /**
   * Wire a material into the cascade shader.
   *
   * Two things the addon gets wrong for a real codebase and this fixes:
   *  - `setupMaterial` *overwrites* `material.onBeforeCompile`, which would silently delete the
   *    fog inscattering and directional grunge that materials.js installs there. We chain.
   *  - Three keys its program cache on `customProgramCacheKey()`, whose default is
   *    `onBeforeCompile.toString()`. Every wrapped material would share one source string, so
   *    two materials with *different* chained hooks would be handed the same compiled program.
   *    We fold the wrapped hook's source into the key explicitly.
   *
   * The chaining has to survive *being chained in turn*. `world/materials.js` wraps whatever
   * `register()` leaves on the material and then calls its own hook again after it — the
   * vanilla-CSM contract, where `setupMaterial` simply clobbers the author's hook and the
   * caller is expected to restore it. Against our wrapper that ran the author's injection
   * twice, which duplicates its `varying`/`uniform` declarations and takes the material's
   * program out with `'vAshWorld' : redefinition`. Every world surface failed to link, which is
   * why not one frame had a shadow — or, for that matter, a ground plane. Two guards below:
   *  - `wrapped` only runs the author hook while it is still the material's *live*
   *    `onBeforeCompile`. If somebody has wrapped us, they own that call.
   *  - `register()` is idempotent per CSM instance, so a second registration (materials.js,
   *    then level.js on the same cached material) cannot capture a wrapper as the author hook.
   */
  function register(material) {
    if (disposed || !isLitMaterial(material)) return material;

    let entry = registry.get(material);
    if (!entry) {
      entry = { userHook: null, wrapped: null, authorKey: null, keyFn: null, csm: null };
      registry.set(material, entry);
    }
    if (!usingCSM || !csm) return material;

    // Already wired to this CSM instance. Re-wrapping would treat whatever is now on the
    // material — quite possibly a caller's chain around our own wrapper — as a fresh author
    // hook and nest the injections. Torn down and rebuilt on setQuality/dispose.
    if (entry.csm === csm && entry.wrapped) return material;

    // Pick up an author hook that was attached before us — or after a previous registration.
    const current = hasOwn(material, 'onBeforeCompile') ? material.onBeforeCompile : null;
    if (typeof current === 'function' && current !== entry.wrapped) entry.userHook = current;

    csm.setupMaterial(material);

    const csmHook = material.onBeforeCompile;
    const userHook = entry.userHook;
    const wantCH = contactActive;
    const wantSSCS = sscsActive;
    const wrapped = function (shader, rendererRef) {
      if (typeof csmHook === 'function') csmHook.call(this, shader, rendererRef);
      // One shared uniform object for every material: updating the arrays in place updates them
      // all, so the per-frame cost of the contact filter's constants is zero.
      if (wantCH) shader.uniforms.ashfallCH = chUniform;
      if (wantSSCS) {
        shader.uniforms.ashfallDepthTex = sscsDepthUniform;
        shader.uniforms.ashfallProj = sscsProjUniform;
        shader.uniforms.ashfallSSCS = sscsParamsUniform;
      }
      // Only ours to call while we are the live hook — see the note above.
      if (typeof userHook === 'function' && this && this.onBeforeCompile === wrapped) {
        userHook.call(this, shader, rendererRef);
      }
    };
    material.onBeforeCompile = wrapped;
    entry.wrapped = wrapped;
    entry.csm = csm;

    // Never chain our own key function into itself: register() may legitimately be called
    // twice on the same material (materials.js registering, then a quality flip re-registering).
    const liveKey = hasOwn(material, 'customProgramCacheKey') ? material.customProgramCacheKey : null;
    if (liveKey && liveKey !== entry.keyFn) entry.authorKey = liveKey;
    const authorKey = entry.authorKey;
    const userKey = typeof userHook === 'function' ? userHook.toString() : '';
    entry.keyFn = material.customProgramCacheKey = function () {
      return (authorKey ? String(authorKey.call(this)) : '') + '|ashfall-csm|' + userKey;
    };

    // setupMaterial mutates `defines` without flagging the material, so an already-compiled
    // material would keep its old, cascade-free program forever.
    material.needsUpdate = true;
    return material;
  }

  function registerAll(list) {
    if (!list) return;
    if (list.isMaterial) {
      register(list);
      return;
    }
    if (Array.isArray(list) || list instanceof Set) {
      for (const m of list) registerAll(m);
      return;
    }
    if (list instanceof Map) {
      list.forEach((m) => registerAll(m));
      return;
    }
    if (typeof list === 'object') {
      for (const key of Object.keys(list)) {
        const m = list[key];
        if (m && (m.isMaterial || Array.isArray(m))) registerAll(m);
      }
    }
  }

  /**
   * Hand every material back the hook its author gave it. Note that `CSM.dispose()` deletes
   * `onBeforeCompile` outright, so this has to cope with the property already being gone —
   * which is exactly what happens when it runs after `teardownCSM()`.
   */
  function unregisterAll() {
    registry.forEach((entry, material) => {
      const current = hasOwn(material, 'onBeforeCompile') ? material.onBeforeCompile : null;
      if (current === null || current === entry.wrapped) {
        if (typeof entry.userHook === 'function') material.onBeforeCompile = entry.userHook;
        else if (current !== null) delete material.onBeforeCompile;
      }
      entry.wrapped = null;
      entry.csm = null;
      if (hasOwn(material, 'customProgramCacheKey')) {
        if (typeof entry.authorKey === 'function') material.customProgramCacheKey = entry.authorKey;
        else delete material.customProgramCacheKey;
      }
      entry.keyFn = null;
      if (material.defines) {
        delete material.defines.USE_CSM;
        delete material.defines.CSM_CASCADES;
        delete material.defines.CSM_FADE;
      }
      material.needsUpdate = true;
    });
  }

  /**
   * Scene sweep. Level geometry, enemies, decals and debris are all built by other modules on
   * their own schedule, and a lit material that misses CSM registration is not a subtle bug:
   * without `USE_CSM` it is lit by *every* cascade light at once and reads four times too
   * bright. Cheap enough to run twice a second over a few thousand nodes.
   */
  const sweepVisit = (obj) => {
    const m = obj.material;
    if (!m) return;
    if (Array.isArray(m)) {
      for (let i = 0; i < m.length; i++) {
        const mi = m[i];
        if (isLitMaterial(mi) && !registry.has(mi)) register(mi);
      }
    } else if (isLitMaterial(m) && !registry.has(m)) {
      register(m);
    }
  };

  function sweep() {
    if (!params.autoRegister || !usingCSM) return;
    scene.traverse(sweepVisit);
  }

  // Anything already in the scene when we boot (main.js builds materials before shadows).
  sweep();

  /* --- Per-frame --------------------------------------------------------- */

  function refit() {
    if (!usingCSM || !csm) return;
    csm.maxFar = params.maxFar;
    csm.lightMargin = params.lightMargin;
    csm.fade = !!params.fade;
    csm.updateFrustums();
    applyCascadeTuning();
  }

  function maybeRefit(cam, game) {
    // ADS narrows the FOV; keep the hip-fire fit (see the fitCam comment above).
    const ads = game && game.weapon ? game.weapon.adsProgress || 0 : 0;
    const wantFov = ads > 0.02 && fitFov > 0 ? fitFov : cam.fov;

    if (
      Math.abs(wantFov - fitFov) > 0.05 ||
      Math.abs(cam.aspect - fitAspect) > 1e-4 ||
      cam.near !== fitNear ||
      cam.far !== fitFar
    ) {
      fitFov = wantFov;
      fitAspect = cam.aspect;
      fitNear = cam.near;
      fitFar = cam.far;
      fitCam.fov = fitFov;
      fitCam.aspect = fitAspect;
      fitCam.near = fitNear;
      fitCam.far = fitFar;
      fitCam.updateProjectionMatrix();
      refit();
      return true;
    }

    // Live-tweakable parameters: four float compares a frame, so the debug menu can drive
    // softness and bias without a dedicated dirty flag. `groundSin` is in there because
    // sky.setTimeOfDay moves the key, and the normal offset is derived from where it is.
    if (
      params.softness !== cachedSoftness ||
      params.normalBiasScale !== cachedNormalScale ||
      params.depthBiasScale !== cachedDepthScale ||
      Math.abs(groundSin - cachedGroundSin) > 0.01
    ) {
      cachedSoftness = params.softness;
      cachedNormalScale = params.normalBiasScale;
      cachedDepthScale = params.depthBiasScale;
      cachedGroundSin = groundSin;
      applyCascadeTuning();
    }
    if (params.maxFar !== cachedMaxFar) {
      cachedMaxFar = params.maxFar;
      refit();
    }
    return false;
  }

  function updateFallback(cam) {
    if (!fallbackLight) return;
    // Borrowed the sun: sky.js owns its transform and its colour. Only the shadow settings,
    // already applied at build time, are ours.
    if (!ownsFallback) return;
    fallbackLight.color.copy(_colour);
    fallbackLight.intensity = sunIntensity;

    // Centre the single cascade ahead of the eye and snap it to the shadow texel grid,
    // otherwise the whole shadow buffer swims by a texel every time the player walks.
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _focus.copy(cam.position).addScaledVector(_fwd, 25);
    _focus.y = 0;
    _focus.x = clamp(_focus.x, -MAP.width * 0.5, MAP.width * 0.5);
    _focus.z = clamp(_focus.z, -MAP.depth * 0.5, MAP.depth * 0.5);

    const size = fallbackLight.shadow.mapSize.x;
    const extent = fallbackLight.shadow.camera.right - fallbackLight.shadow.camera.left;
    const texel = extent / size;
    _focus.x = Math.floor(_focus.x / texel) * texel;
    _focus.z = Math.floor(_focus.z / texel) * texel;

    fallbackLight.target.position.copy(_focus);
    fallbackLight.position.copy(_focus).addScaledVector(_lightDir, -LIGHT_MARGIN * 0.6);
    fallbackLight.target.updateMatrixWorld();
  }

  /**
   * Called from the frame loop *after* the player has written the camera pose. main.js routes
   * every subsystem through `update(dt, game)`, while §3.3 documents `update(game)` — accept
   * both rather than depend on which one wins.
   */
  function update(a, b) {
    if (disposed) return;
    const game = b && b.camera ? b : a && a.camera ? a : null;
    const cam = (game && game.camera) || engine.camera;
    if (!cam) return;

    frame++;

    // player.update() has just written position/rotation; the renderer will not refresh the
    // world matrix until it draws, and fitting cascades to last frame's pose shows up as the
    // near cascade lagging behind fast turns.
    cam.updateMatrixWorld();

    readSun();
    maybeRefit(cam, game);

    if (sscsActive) {
      // Allocation-free: `.value` is either the engine's own DepthTexture or the live
      // projection matrix object, and the params are written into a preallocated Vector4.
      const depth = prepassDepth();
      sscsDepthUniform.value = depth;
      sscsProjUniform.value = cam.projectionMatrix;
      // The trace switches itself off rather than sample a buffer that is not there.
      _sscsParams.set(cam.near, cam.far, SSCS_DISTANCE, depth ? 1 : 0);
    }

    if (usingCSM && csm) {
      csm.lightDirection.copy(_lightDir);
      for (let i = 0; i < csm.lights.length; i++) {
        const light = csm.lights[i];
        light.color.copy(_colour);
        light.intensity = sunIntensity;
      }
      // CSM reads camera.matrixWorld only, so mirroring the transform is enough — and it keeps
      // the TAA jitter that postfx bakes into the live projection matrix out of the fit.
      fitCam.matrixWorld.copy(cam.matrixWorld);
      csm.update();

      if (params.autoRegister && frame - sweepFrame >= SWEEP_INTERVAL) {
        sweepFrame = frame;
        sweep();
      }
    } else {
      updateFallback(cam);
    }
  }

  /* --- Quality ----------------------------------------------------------- */

  function teardownCSM() {
    if (!csm) return;
    // Free the GPU side first: CSM.remove() drops the lights from the scene but never touches
    // their render targets, and a quality flip would otherwise leak four 2048² maps.
    for (let i = 0; i < csm.lights.length; i++) {
      const light = csm.lights[i];
      if (light.shadow) {
        if (light.shadow.map) {
          light.shadow.map.dispose();
          light.shadow.map = null;
        }
        if (typeof light.shadow.dispose === 'function') light.shadow.dispose();
      }
      if (typeof light.dispose === 'function') light.dispose();
    }
    try {
      csm.remove();
    } catch (err) {
      /* already detached */
    }
    try {
      csm.dispose(); // strips USE_CSM / onBeforeCompile from every material it set up
    } catch (err) {
      /* nothing to strip */
    }
    csm = null;
  }

  function restoreChunks() {
    THREE.ShaderChunk.lights_fragment_begin = STOCK_LIGHTS_FRAGMENT;
    THREE.ShaderChunk.lights_pars_begin = STOCK_LIGHTS_PARS;
    THREE.ShaderChunk.shadowmap_pars_fragment = STOCK_SHADOWMAP_PARS;
  }

  /** Release the single-light path. The sun is never removed — we only borrowed it. */
  function teardownFallback() {
    if (!fallbackLight) return;
    if (fallbackLight.shadow) {
      if (fallbackLight.shadow.map) {
        fallbackLight.shadow.map.dispose();
        fallbackLight.shadow.map = null;
      }
      if (typeof fallbackLight.shadow.dispose === 'function') fallbackLight.shadow.dispose();
    }
    if (ownsFallback) {
      scene.remove(fallbackLight.target);
      scene.remove(fallbackLight);
    } else {
      fallbackLight.castShadow = false;
    }
    fallbackLight = null;
    ownsFallback = false;
  }

  function setQuality(q) {
    if (disposed) return;
    const name = PRESETS[q] ? q : DEFAULT_QUALITY;
    if (name === qualityName) return;
    qualityName = name;
    preset = presetOf(name);

    // The registry itself is kept: its entries hold the authors' own `onBeforeCompile` hooks,
    // which is the only record of them once CSM.dispose() has deleted the live ones.
    const materials = Array.from(registry.keys());

    teardownCSM();
    unregisterAll();
    restoreChunks();

    teardownFallback();

    try {
      csm = buildCSM();
      usingCSM = true;
    } catch (err) {
      csm = null;
      usingCSM = false;
    }

    if (usingCSM) {
      csmFragmentSource = THREE.ShaderChunk.lights_fragment_begin;
      installChunks();
      applyCascadeTuning();
    } else {
      contactActive = false;
      sscsActive = false;
      fallbackLight = buildFallback();
    }

    if (sunLight && sunLight.shadow) {
      const s = Math.min(preset.mapSize, maxTextureSize);
      sunLight.shadow.mapSize.set(s, s);
    }

    // Re-register everything we were ever handed, chaining the *authors'* hooks, not ours.
    for (let i = 0; i < materials.length; i++) register(materials[i]);
    sweep();

    shadows.quality = qualityName;
    shadows.usingCSM = usingCSM;
    shadows.contactHardening = contactActive;
    shadows.screenContact = sscsActive;
    shadows.csm = csm;
    shadows.lights = usingCSM && csm ? csm.lights : fallbackLight ? [fallbackLight] : [];
    shadows.cascades = usingCSM && csm ? csm.cascades : 1;
    shadows.mapSize = usingCSM && csm ? csm.shadowMapSize : Math.min(preset.mapSize, maxTextureSize);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    teardownCSM(); // deletes onBeforeCompile, so it has to run before the hooks are restored
    unregisterAll();
    registry.clear();
    restoreChunks();
    teardownFallback();
    if (sunLight) sunLight.visible = true; // hand the key back to whoever wants it
    usingCSM = false;
    contactActive = false;
    sscsActive = false;
    sscsDepthUniform.value = null;
    _sscsParams.w = 0;
  }

  /* --- Public object ----------------------------------------------------- */

  const shadows = {
    csm,
    /** False when CSM could not be constructed and a single directional light took over. */
    usingCSM,
    /** False when the driver rejected the patched filter, or the preset does not ask for it. */
    contactHardening: contactActive,
    /** True when the half-metre screen-space contact trace is live. */
    screenContact: sscsActive,
    quality: qualityName,
    cascades: usingCSM && csm ? csm.cascades : 1,
    mapSize: Math.min(preset.mapSize, maxTextureSize),
    lights: usingCSM && csm ? csm.lights : fallbackLight ? [fallbackLight] : [],
    /** The private hip-fire camera the cascades are fitted to. Exposed for debug overlays. */
    fitCamera: fitCam,
    params,

    register,
    registerAll,
    /** Re-apply bias/softness after poking `params` from a debug menu. */
    refresh() {
      applyCascadeTuning();
    },
    /** Force a scene walk, e.g. straight after a wholesale level rebuild. */
    scan: sweep,
    update,
    setQuality,
    dispose,

    /** Cascade split distances in metres, for the debug overlay. */
    splits() {
      if (!usingCSM || !csm) return [params.maxFar];
      const far = Math.min(fitCam.far, params.maxFar);
      return csm.breaks.map((b) => b * far);
    },

    /**
     * Everything needed to answer "is the cascade actually covering the play space?" in one
     * call — view-depth range, ortho extent, texel size and the derived biases, per cascade.
     * Debug only; it allocates, so never call it from the frame loop.
     */
    cascadeBounds() {
      if (!usingCSM || !csm) return [];
      const far = Math.min(fitCam.far, params.maxFar);
      return csm.lights.map((light, i) => {
        const cam = light.shadow.camera;
        const width = cam.right - cam.left;
        return {
          cascade: i,
          viewNear: (i === 0 ? 0 : csm.breaks[i - 1] * far),
          viewFar: csm.breaks[i] * far,
          extent: width,
          texel: width / csm.shadowMapSize,
          lightNear: cam.near,
          lightFar: cam.far,
          normalBias: light.shadow.normalBias,
          bias: light.shadow.bias,
          castShadow: light.castShadow,
        };
      });
    },
  };

  return shadows;
}

export default createShadows;
