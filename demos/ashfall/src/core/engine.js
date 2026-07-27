/**
 * Ashfall — core engine (ARCHITECTURE.md §3.1).
 *
 * Owns the renderer, the two scenes, the two cameras and the HDR/prepass render targets, and
 * drives the fixed per-frame render order:
 *
 *   1. view-space normal + linear roughness prepass  -> targets.normal   (RGBA8)
 *   2. world scene                                   -> targets.hdr      (RGBA16F + depth)
 *   3. viewmodel scene, depth cleared, colour kept   -> targets.hdr      (same target)
 *
 * Nothing here resolves to the screen. `postfx` owns the final image, which is why the
 * renderer keeps `NoToneMapping` and why every intermediate target is tagged
 * `LinearSRGBColorSpace` — a tone curve or an sRGB encode applied here would be applied twice.
 *
 * ---------------------------------------------------------------------------------------
 * LAYERS
 * ---------------------------------------------------------------------------------------
 * `engine.LAYER` is an *exclusive* classification, not a set of additive flags. Three tests
 * `object.layers.mask & camera.layers.mask`, so an object carrying both WORLD and NOPREPASS
 * would still be drawn by a prepass camera that only enables WORLD. Put each object on
 * exactly one of these:
 *
 *   WORLD (0)      Default. Opaque, prepass-visible world geometry. Contributes normals,
 *                  roughness and depth to the prepass, so SSAO and motion blur see it.
 *   VIEWMODEL (1)  Anything living in `viewScene`. Never rendered by the world camera.
 *   NOPREPASS (2)  Visible to the world camera, skipped by the prepass: transparent glass,
 *                  tarpaulins, particles, tracers, muzzle flashes, godray proxies, the sky
 *                  dome. Writing these into the normal buffer poisons SSAO.
 *   DECAL (3)      Bullet holes, scorch marks, blood. Same treatment as NOPREPASS — a decal
 *                  is a coplanar overlay and its normal is already in the buffer underneath.
 *
 * Use `engine.setLayer(object, engine.LAYER.NOPREPASS)` (recursive by default) rather than
 * touching `object.layers` directly. As a safety net the prepass also auto-excludes anything
 * whose material is transparent, sub-unit opacity or `allowOverride === false`; the scan is
 * cached and refreshed only when the scene changes, so it is not a per-frame cost.
 *
 * ---------------------------------------------------------------------------------------
 * MATRICES FOR TEMPORAL PASSES
 * ---------------------------------------------------------------------------------------
 * `currViewProj` / `prevViewProj` are **unjittered** — TAA's sub-pixel offset is removed
 * before the matrices are stored, so reprojected velocity contains scene and camera motion
 * only and does not smear the jitter pattern into the history. The jittered pair is exposed
 * as `currViewProjJittered` / `prevViewProjJittered` for passes that want raw clip space.
 * `prevViewProj` is rolled forward at the *top* of `renderScene`, which is exactly equivalent
 * to updating it at the end of the previous frame: while `post.render` runs, `prev` still
 * holds frame N-1 and `curr` holds frame N.
 *
 * ---------------------------------------------------------------------------------------
 * DEPTH
 * ---------------------------------------------------------------------------------------
 * `targets.hdr.depthTexture` is written by the world pass and then *re-written* by the
 * viewmodel pass (depth is cleared between them, per the contract, so the gun never
 * intersects the world). Viewmodel pixels therefore carry depth from `viewCamera`'s
 * projection — near 0.008, far 12 — not the world camera's. Linearising them with the world
 * camera's near/far puts the weapon at roughly 1.5–2.5 m, which is close enough for DOF and
 * motion blur to behave, but it is not a physically meaningful world distance. Passes that
 * care can read `engine.viewDepthParams`.
 *
 * `targets.normal.depthTexture` holds the *pre-viewmodel* world depth. SSAO should prefer it
 * so the weapon cannot cast ambient occlusion onto the world behind it.
 */

import * as THREE from '../../vendor/three.module.js';
import { CAMERA, PALETTE, LIGHTING, ATMOSPHERE } from '../world/art.js';

/* -------------------------------------------------------------------------- */
/* Module-scope scratch — the hot path must not allocate.                      */
/* -------------------------------------------------------------------------- */

const _v3a = new THREE.Vector3();
const _m3a = new THREE.Matrix3();
const _m4a = new THREE.Matrix4();
const _clearRead = new THREE.Color();

/* -------------------------------------------------------------------------- */
/* Quality table (ARCHITECTURE.md §5)                                          */
/* -------------------------------------------------------------------------- */

/**
 * `renderScale` is the internal-buffer multiplier from the preset table. `dprCap` bounds
 * `devicePixelRatio` so a 3x phone panel cannot ask for a 9-megapixel buffer.
 * `detailNormals` adds a normal-map fetch to the prepass: worth it on hardware that can
 * afford 16-tap SSAO, because AO that follows the bumps in the concrete is the difference
 * between a rendered surface and a painted one.
 */
const QUALITY = {
  low: { renderScale: 0.7, dprCap: 2, prepass: false, detailNormals: false, alphaTest: false },
  medium: { renderScale: 0.85, dprCap: 2, prepass: true, detailNormals: false, alphaTest: true },
  high: { renderScale: 1.0, dprCap: 2, prepass: true, detailNormals: true, alphaTest: true },
  ultra: { renderScale: 1.0, dprCap: 2, prepass: true, detailNormals: true, alphaTest: true },
};

const DEFAULT_QUALITY = 'high';

/** Contract fallback for objects whose material has no roughness of its own. */
const FALLBACK_ROUGHNESS = 0.6;

/** Rebuild the prepass exclusion cache at least this often, in frames. */
const PREPASS_SCAN_INTERVAL = 45;

function qualityOf(name) {
  return QUALITY[name] || QUALITY[DEFAULT_QUALITY];
}

/* -------------------------------------------------------------------------- */
/* Prepass material                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The shared override material for the normal/roughness prepass.
 *
 * Vertex side leans on Three's own chunks so instancing, batching, morphs and skinning all
 * keep working when `fx`/`ai` throw InstancedMesh or SkinnedMesh at it — `defaultnormal_vertex`
 * ends with `transformedNormal = normalMatrix * transformedNormal`, i.e. view space, which is
 * precisely what the buffer wants.
 *
 * Fragment side reconstructs a tangent frame from screen-space derivatives (the same trick as
 * Three's `normal_fragment_maps`) so a per-object normal map can be applied without needing a
 * tangent attribute. That matters: SSAO computed from interpolated vertex normals on merged
 * level geometry looks like AO on a smooth shell, and every crack and panel line vanishes.
 *
 * Per-object state (roughness, maps, UV transforms, alpha test) is pushed by
 * `material.onBeforeRender`, which Three calls immediately before `renderBufferDirect`.
 * `uniformsNeedUpdate = true` forces the upload — without it Three skips the uniform refresh
 * for consecutive draws that share a material id, and every object would get the first
 * object's roughness.
 */
function createPrepassMaterial() {
  // 1x1 neutral defaults so the samplers are always bound to something real. A flat tangent
  // normal is (0,0,1) -> (128,128,255); white keeps the roughness/alpha multiplies identities.
  const flatNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
  flatNormal.magFilter = THREE.NearestFilter;
  flatNormal.minFilter = THREE.NearestFilter;
  flatNormal.generateMipmaps = false;
  flatNormal.needsUpdate = true;

  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  white.magFilter = THREE.NearestFilter;
  white.minFilter = THREE.NearestFilter;
  white.generateMipmaps = false;
  white.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    name: 'AshfallPrepass',
    uniforms: {
      uRoughness: { value: FALLBACK_ROUGHNESS },
      uRoughnessMap: { value: white },
      uRoughnessUv: { value: new THREE.Matrix3() },
      uNormalMap: { value: flatNormal },
      uNormalUv: { value: new THREE.Matrix3() },
      // .xy scale of the tangent-space perturbation; 0 disables the fetch's effect entirely.
      uNormalScale: { value: new THREE.Vector2(1, 1) },
      uAlphaMap: { value: white },
      uAlphaUv: { value: new THREE.Matrix3() },
      // Channel selector: (0,0,0,1) reads .a from a colour map, (0,1,0,0) reads .g from an
      // alphaMap, matching Three's own conventions.
      uAlphaSwizzle: { value: new THREE.Vector4(0, 0, 0, 1) },
      uAlphaTest: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <batching_pars_vertex>
      #include <skinning_pars_vertex>
      #include <morphtarget_pars_vertex>

      uniform mat3 uNormalUv;
      uniform mat3 uRoughnessUv;
      uniform mat3 uAlphaUv;

      varying vec3 vViewNormal;
      varying vec3 vViewPos;
      varying vec2 vUvN;
      varying vec2 vUvR;
      varying vec2 vUvA;

      void main() {
        #include <batching_vertex>
        #include <beginnormal_vertex>
        #include <morphinstance_vertex>
        #include <morphnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <defaultnormal_vertex>

        // View-space normal straight out of Three's chunk (normalMatrix has already been
        // applied); instancing and batching scale-compensation are handled in there.
        vViewNormal = transformedNormal;

        #include <begin_vertex>
        #include <morphtarget_vertex>
        #include <skinning_vertex>
        #include <project_vertex>

        vViewPos = mvPosition.xyz;

        // The uv attribute is declared unconditionally by Three's vertex prefix, and an absent
        // attribute reads as (0,0) — safe on geometry that carries no texture coordinates,
        // which is also the case where the JS side has bound the neutral 1x1 maps.
        vUvN = ( uNormalUv * vec3( uv, 1.0 ) ).xy;
        vUvR = ( uRoughnessUv * vec3( uv, 1.0 ) ).xy;
        vUvA = ( uAlphaUv * vec3( uv, 1.0 ) ).xy;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uRoughness;
      uniform sampler2D uRoughnessMap;
      uniform sampler2D uNormalMap;
      uniform vec2 uNormalScale;
      uniform sampler2D uAlphaMap;
      uniform vec4 uAlphaSwizzle;
      uniform float uAlphaTest;

      varying vec3 vViewNormal;
      varying vec3 vViewPos;
      varying vec2 vUvN;
      varying vec2 vUvR;
      varying vec2 vUvA;

      /**
       * Cotangent frame from screen-space derivatives. q1perp/q0perp build the tangent and
       * bitangent that map the UV gradient onto the position gradient; the inversesqrt(det)
       * normalises them without needing an orthonormalisation pass. Guarded against degenerate
       * UVs (det == 0) which would otherwise produce NaNs on merged geometry with collapsed
       * texture coordinates.
       */
      vec3 perturbNormal( vec3 eyePos, vec3 surfNormal, vec3 mapN, vec2 texUv ) {
        vec3 q0 = dFdx( eyePos );
        vec3 q1 = dFdy( eyePos );
        vec2 st0 = dFdx( texUv );
        vec2 st1 = dFdy( texUv );

        vec3 q1perp = cross( q1, surfNormal );
        vec3 q0perp = cross( surfNormal, q0 );

        vec3 T = q1perp * st0.x + q0perp * st1.x;
        vec3 B = q1perp * st0.y + q0perp * st1.y;

        float det = max( dot( T, T ), dot( B, B ) );
        if ( det <= 0.0 ) return surfNormal;
        float scale = inversesqrt( det );

        return normalize( T * ( mapN.x * scale ) + B * ( mapN.y * scale ) + surfNormal * mapN.z );
      }

      void main() {
        // Cutout foliage, chain-link and grating must punch holes in the normal buffer or
        // SSAO grows a solid slab where the weeds are. Uniform branch, so it stays coherent.
        if ( uAlphaTest > 0.0 ) {
          vec4 texel = texture2D( uAlphaMap, vUvA );
          if ( dot( texel, uAlphaSwizzle ) < uAlphaTest ) discard;
        }

        vec3 N = normalize( vViewNormal );
        // Two-sided geometry (thin sheet metal, blown-out walls) must not report an inverted
        // hemisphere or AO inverts with it.
        if ( ! gl_FrontFacing ) N = -N;

        vec3 mapN = texture2D( uNormalMap, vUvN ).xyz * 2.0 - 1.0;
        mapN.xy *= uNormalScale;
        // A tangent normal can never point into the surface; the floor also stops normalize()
        // producing NaNs if a map texel happens to decode to a zero-length vector.
        mapN.z = max( mapN.z, 0.001 );
        N = perturbNormal( vViewPos, N, normalize( mapN ), vUvN );

        // Perceptual (linear, un-encoded) roughness — matches MeshStandardMaterial.roughness,
        // so SSAO/specular-occlusion consumers can use it directly. Floored so a mirror-smooth
        // texel never divides by zero downstream.
        float rough = clamp( uRoughness * texture2D( uRoughnessMap, vUvR ).g, 0.015, 1.0 );

        // Simple *0.5+0.5 encode rather than octahedral: 8 bits per axis is ~0.4 degrees of
        // quantisation, well below the noise floor of a hemisphere-kernel AO, and it keeps the
        // buffer trivially readable by every downstream pass (rgb*2-1).
        gl_FragColor = vec4( N * 0.5 + 0.5, rough );
      }
    `,
  });

  material.side = THREE.DoubleSide; // matched per draw from the source material, see below
  material.fog = false;
  material.lights = false;
  material.blending = THREE.NoBlending;
  material.depthTest = true;
  material.depthWrite = true;
  material.toneMapped = false;

  const u = material.uniforms;

  /** Copy a texture's repeat/offset/rotation into a mat3 uniform. */
  const applyUvTransform = (texture, target) => {
    if (texture && texture.matrixAutoUpdate === true) texture.updateMatrix();
    if (texture) target.value.copy(texture.matrix);
    else target.value.identity();
  };

  const state = {
    detailNormals: true,
    alphaTest: true,
  };

  material.onBeforeRender = function onBeforePrepassRender(renderer, scene, camera, geometry, object, group) {
    // `object.material` is the *source* material; `this` is the override. Multi-material
    // meshes hand us a group with the index into the array.
    let src = object.material;
    if (Array.isArray(src)) src = src[group ? group.materialIndex : 0] || src[0];
    if (!src) src = null;

    const hasUv = geometry && geometry.attributes && geometry.attributes.uv !== undefined;

    // Roughness. Contract: respect per-object roughness where it exists, else 0.6.
    u.uRoughness.value = src && typeof src.roughness === 'number' ? src.roughness : FALLBACK_ROUGHNESS;
    const rMap = hasUv && src && src.roughnessMap ? src.roughnessMap : null;
    u.uRoughnessMap.value = rMap || white;
    applyUvTransform(rMap, u.uRoughnessUv);

    // Detail normals.
    const wantNormal =
      state.detailNormals &&
      hasUv &&
      src &&
      src.normalMap &&
      !(src.userData && src.userData.prepassNoNormalMap === true);
    if (wantNormal) {
      u.uNormalMap.value = src.normalMap;
      applyUvTransform(src.normalMap, u.uNormalUv);
      if (src.normalScale) u.uNormalScale.value.copy(src.normalScale);
      else u.uNormalScale.value.set(1, 1);
    } else {
      u.uNormalMap.value = flatNormal;
      u.uNormalUv.value.identity();
      u.uNormalScale.value.set(0, 0);
    }

    // Alpha cutout.
    const at = state.alphaTest && src && src.alphaTest > 0 ? src.alphaTest : 0;
    if (at > 0 && hasUv) {
      u.uAlphaTest.value = at;
      if (src.alphaMap) {
        u.uAlphaMap.value = src.alphaMap;
        u.uAlphaSwizzle.value.set(0, 1, 0, 0); // Three reads alphaMap.g
        applyUvTransform(src.alphaMap, u.uAlphaUv);
      } else if (src.map) {
        u.uAlphaMap.value = src.map;
        u.uAlphaSwizzle.value.set(0, 0, 0, 1); // ...and map.a
        applyUvTransform(src.map, u.uAlphaUv);
      } else {
        u.uAlphaTest.value = 0;
      }
    } else {
      u.uAlphaTest.value = 0;
    }

    // Inherit sidedness so a single-sided wall does not get its back face rasterised into the
    // normal buffer. Changing `side` on a ShaderMaterial does not force a recompile.
    const side = src && src.side !== undefined ? src.side : THREE.FrontSide;
    if (this.side !== side) this.side = side;

    // Force the uniform upload: Three skips the material refresh for back-to-back draws that
    // share a material id, which is exactly our case.
    this.uniformsNeedUpdate = true;
  };

  return {
    material,
    state,
    dispose() {
      material.dispose();
      flatNormal.dispose();
      white.dispose();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Factory                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {'low'|'medium'|'high'|'ultra'} quality
 */
export function createEngine(canvas, quality = DEFAULT_QUALITY) {
  if (!canvas) throw new Error('createEngine: no canvas');

  const qualityName = QUALITY[quality] ? quality : DEFAULT_QUALITY;
  let preset = qualityOf(qualityName);

  /* --- Renderer --------------------------------------------------------- */

  // antialias:false — TAA does the anti-aliasing and MSAA on an HDR target would cost a
  // resolve per frame for edges TAA is about to re-solve anyway.
  // stencil:false — nothing in the chain stencils; dropping it lets the driver pick a plain
  // 24-bit depth attachment instead of packed D24S8 for the backbuffer.
  // preserveDrawingBuffer:false — the screenshot harness grabs the canvas inside the rAF that
  // drew it, so there is no reason to pay for a persistent copy.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    logarithmicDepthBuffer: false,
    premultipliedAlpha: false,
    failIfMajorPerformanceCaveat: false,
  });

  // Tone mapping and the sRGB transfer belong to the final composite pass. Leaving them here
  // would apply the curve twice — once into the HDR target, once on the way out.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  renderer.shadowMap.enabled = true;
  // VSM is banned by the contract: it light-leaks badly through the depot's thin walls.
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;

  // We own the internal resolution ourselves (render scale x capped dpr), so the renderer's
  // own pixel-ratio machinery must stay out of it.
  renderer.setPixelRatio(1);
  renderer.autoClear = false; // every pass clears explicitly; the viewmodel must not.
  renderer.sortObjects = true;
  renderer.info.autoReset = false; // accumulate across all passes, reset once per frame

  // r155+ default. Guarded because the property was removed in later revisions and assigning
  // to a non-existent setter would silently create a dead own-property.
  if ('useLegacyLights' in renderer) renderer.useLegacyLights = false;

  const gl = renderer.getContext();
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  /* --- HDR capability --------------------------------------------------- */

  // WebGL2 exposes RGBA16F as colour-renderable only through one of these. Without either we
  // degrade to RGBA8 rather than throwing; bloom thresholding then clips at 1.0 and the look
  // flattens, but the game runs.
  const hdrAvailable =
    renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const hdrType = hdrAvailable ? THREE.HalfFloatType : THREE.UnsignedByteType;

  /* --- Scenes and cameras ----------------------------------------------- */

  const scene = new THREE.Scene();
  scene.name = 'world';

  const viewScene = new THREE.Scene();
  viewScene.name = 'viewmodel';

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  camera.name = 'worldCamera';
  camera.rotation.order = 'YXZ'; // yaw then pitch — the controller writes euler angles directly

  // Its own near/far window keeps the weapon out of the world camera's near plane at any FOV.
  const viewCamera = new THREE.PerspectiveCamera(
    CAMERA.viewmodelFov,
    1,
    CAMERA.viewmodelNear,
    CAMERA.viewmodelFar
  );
  viewCamera.name = 'viewmodelCamera';

  const LAYER = { WORLD: 0, VIEWMODEL: 1, NOPREPASS: 2, DECAL: 3 };
  const MASK_WORLD = (1 << LAYER.WORLD) | (1 << LAYER.NOPREPASS) | (1 << LAYER.DECAL);
  const MASK_PREPASS = 1 << LAYER.WORLD;

  camera.layers.mask = MASK_WORLD;
  viewCamera.layers.enableAll(); // viewScene is isolated; nothing in it should ever be culled

  /* --- Viewmodel lighting ----------------------------------------------- */

  /**
   * `viewScene` is a photometric island. No CSM cascade reaches into it, no geometry shadows
   * anything in it, SSAO never sees it and the height fog never touches it. A light of a given
   * intensity placed here therefore lands on the weapon at *full* strength, while the identical
   * light in the world arrives attenuated by all four. That asymmetry is why viewmodels drift
   * brighter than the frame they sit in, and a viewmodel that is obviously brighter than the
   * world it is held in is one of the clearest tells of an amateur renderer.
   *
   * So none of the numbers below are absolutes. Every term is a *ratio* of the corresponding
   * `art.js` LIGHTING value, and `syncViewLights` re-applies those ratios each frame against
   * the live key and sky fill in `game.sky` — which sky.js itself derives from LIGHTING by
   * atmospheric extinction. Retune the yard (exposure, hemiSkyIntensity, envIntensity) and the
   * weapon follows automatically; drive the sun down with `sky.setTimeOfDay` and the weapon
   * goes to dusk with it. That coupling is the fix; the constants are only its shape.
   */

  /**
   * Key attenuation. Not an art choice — it stands in for the shadowing `viewScene` cannot
   * compute. The world's sun is behind a shadow map and at the art-directed 8° rake most of
   * what the weapon is judged against is *in* shadow; the shooter's own head, shoulders and
   * forward arm also sit between the beam and the receiver over much of the yaw range. An
   * unshadowed copy of the full 4.6-intensity key makes the gun the only object on screen
   * receiving 100% of the sun, which is exactly how it ended up reading as white blocks.
   */
  const VIEW_KEY_OCCLUSION = 0.7;

  /**
   * Sky-fill occlusion. The receiver hangs ~0.3 m off the player's chest with the head,
   * shoulders and both arms above and behind it: it sees roughly a third of the dome, not all
   * of it. World surfaces get that correction for free from SSAO and from the buildings.
   * Without it LIGHTING.hemiSkyIntensity — deliberately pushed to 1.2 so the *world's* shadows
   * stay sky-blue against the near-achromatic PMREM — lands undiluted on the gloved arms and
   * on every up-facing polymer face, which is what turned them into pale cyan blocks.
   */
  const VIEW_FILL_OCCLUSION = 0.34;

  /**
   * Rim strength, as a fraction of the sky fill it is a stand-in for. The rim is not physical;
   * it fakes the sky wrap `viewScene` has no geometry to bounce off, and its only job is to
   * keep the top edge of the receiver legible when the player faces away from the sun. It used
   * to run at `hemiGroundIntensity * 0.9` — nominally weak, but it is a *directional* light, so
   * on the roughness-0.15 barrel steel its GGX lobe peaks an order of magnitude above its
   * nominal intensity, and that peak is sky-blue. §4: everything that is not the sun is fill
   * and must stay subordinate. A fifth of an already-occluded fill cannot out-run the key.
   */
  const VIEW_RIM_OF_FILL = 0.2;

  const sunColour = new THREE.Color().setStyle(PALETTE.sun, THREE.SRGBColorSpace);
  const skyColour = new THREE.Color().setStyle(PALETTE.skyZenith, THREE.SRGBColorSpace);
  const groundColour = new THREE.Color().setStyle(PALETTE.groundBounce, THREE.SRGBColorSpace);

  // Same trick sky.js uses on the world hemisphere: a HemisphereLight has one intensity but
  // art.js authors the sky and ground terms separately, so the ground colour has to carry the
  // ratio. Without the divide the warm bounce comes in at the *sky* term's level — 3.4x its
  // authored strength — and the undersides of the handguard glow like a second key.
  groundColour.multiplyScalar(LIGHTING.hemiGroundIntensity / Math.max(LIGHTING.hemiSkyIntensity, 1e-4));

  // Warm key from the world sun's direction. Colour and intensity are replaced with the live
  // values off `game.sky.sun` on the first sync; these are the design-point values from art.js
  // so the very first frame is already in the right ballpark rather than blazing.
  const viewKey = new THREE.DirectionalLight(sunColour, LIGHTING.sunIntensity * VIEW_KEY_OCCLUSION);
  viewKey.name = 'viewmodelKey';
  viewKey.position.set(-0.6, 0.5, 0.62); // replaced on the first sync; a sane pose until then
  viewKey.castShadow = false;
  viewScene.add(viewKey);
  viewScene.add(viewKey.target);

  const viewHemi = new THREE.HemisphereLight(
    skyColour,
    groundColour,
    LIGHTING.hemiSkyIntensity * VIEW_FILL_OCCLUSION
  );
  viewHemi.name = 'viewmodelHemi';
  viewScene.add(viewHemi);

  // A weak cool rim from behind-camera-left. Not physical — see VIEW_RIM_OF_FILL above.
  const viewRim = new THREE.DirectionalLight(
    skyColour,
    LIGHTING.hemiSkyIntensity * VIEW_FILL_OCCLUSION * VIEW_RIM_OF_FILL
  );
  viewRim.name = 'viewmodelRim';
  viewRim.position.set(0.75, 0.35, -0.55);
  viewRim.castShadow = false;
  viewScene.add(viewRim);
  viewScene.add(viewRim.target);

  // Seed the IBL weight from art.js so the weapon's metal is never reflecting the environment
  // at Three's default 1.0 during the frames before sky.js has written the scene's value.
  viewScene.environmentIntensity = LIGHTING.envIntensity;

  const viewLights = { key: viewKey, hemi: viewHemi, rim: viewRim };

  /* --- Render targets --------------------------------------------------- */

  const targets = { hdr: null, normal: null };

  function makeDepthTexture(w, h) {
    // UnsignedIntType + DepthFormat maps to DEPTH_COMPONENT24 on WebGL2 — the "Depth24 if
    // available" the contract asks for. Nearest filtering is mandatory: a bilinear tap across
    // a depth discontinuity invents a surface that is not there, and SSAO haloes on it.
    const dt = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    dt.format = THREE.DepthFormat;
    dt.minFilter = THREE.NearestFilter;
    dt.magFilter = THREE.NearestFilter;
    dt.generateMipmaps = false;
    dt.compareFunction = null; // sampled as a value, never as a shadow comparison
    return dt;
  }

  function buildTargets(w, h) {
    const hdrDepth = makeDepthTexture(w, h);
    hdrDepth.name = 'hdrDepth';

    const hdr = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat,
      type: hdrType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      // Critical: the post chain, not the renderer, applies the sRGB transfer. Tagging the
      // target linear stops Three appending an encode to every world shader.
      colorSpace: THREE.LinearSRGBColorSpace,
      depthTexture: hdrDepth,
      samples: 0,
    });
    hdr.texture.name = 'hdrColour';

    const normalDepth = makeDepthTexture(w, h);
    normalDepth.name = 'prepassDepth';

    const normal = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType, // RGBA8: normal.xyz*0.5+0.5, linear roughness in .a
      minFilter: THREE.NearestFilter, // point-sampled; interpolating packed normals is wrong
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      colorSpace: THREE.LinearSRGBColorSpace, // packed data, never colour — no transfer
      depthTexture: normalDepth,
      samples: 0,
    });
    normal.texture.name = 'viewNormalRoughness';

    targets.hdr = hdr;
    targets.normal = normal;
  }

  function resizeTarget(target, w, h) {
    if (!target || (target.width === w && target.height === h)) return;
    // WebGLRenderTarget.setSize resizes its colour textures and disposes the framebuffer, but
    // it does not touch the attached depth texture — do that by hand or the depth attachment
    // keeps the old dimensions and the FBO comes back incomplete.
    const dt = target.depthTexture;
    if (dt) {
      dt.image.width = w;
      dt.image.height = h;
      dt.dispose();
    }
    // Identity of the target and of `target.texture` is preserved, so any uniform postfx has
    // already cached stays valid across a resize or a quality change.
    target.setSize(w, h);
  }

  function disposeTargets() {
    for (const key of Object.keys(targets)) {
      const t = targets[key];
      if (!t) continue;
      if (t.depthTexture) t.depthTexture.dispose();
      t.texture.dispose();
      t.dispose();
      targets[key] = null;
    }
  }

  /* --- Sizing ----------------------------------------------------------- */

  const size = { w: 1, h: 1, dpr: 1 };
  const cssSize = { w: 1, h: 1 };
  const resizeListeners = new Set();

  function resize(cssW, cssH) {
    const w = Math.max(1, Math.floor(cssW || canvas.clientWidth || window.innerWidth || 1));
    const h = Math.max(1, Math.floor(cssH || canvas.clientHeight || window.innerHeight || 1));

    // Internal resolution = css size x preset render scale x device pixel ratio (capped).
    const dpr = Math.min(window.devicePixelRatio || 1, preset.dprCap);
    const iw = Math.max(1, Math.round(w * preset.renderScale * dpr));
    const ih = Math.max(1, Math.round(h * preset.renderScale * dpr));

    cssSize.w = w;
    cssSize.h = h;
    size.w = iw;
    size.h = ih;
    size.dpr = dpr;

    // updateStyle=false: we set the CSS box ourselves because styles.css may not have loaded
    // a rule for the canvas, and a canvas with no CSS size falls back to its attribute size,
    // which at 0.7 render scale would letterbox the game.
    renderer.setSize(iw, ih, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const aspect = w / h;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    viewCamera.aspect = aspect;
    viewCamera.updateProjectionMatrix();

    if (!targets.hdr) buildTargets(iw, ih);
    else {
      resizeTarget(targets.hdr, iw, ih);
      resizeTarget(targets.normal, iw, ih);
    }

    // Listeners get the *internal* buffer size — that is what postfx allocates against.
    for (const fn of resizeListeners) {
      try {
        fn(iw, ih, engine);
      } catch (err) {
        if (engine.debug) console.warn('[engine] resize listener failed', err);
      }
    }
  }

  /* --- Prepass ---------------------------------------------------------- */

  const prepass = createPrepassMaterial();
  prepass.state.detailNormals = preset.detailNormals;
  prepass.state.alphaTest = preset.alphaTest;

  // Sky pixels want a normal facing the viewer and full roughness so a naive SSAO tap on the
  // horizon cannot produce a dark rim. Depth == 1 is still the real sky test.
  const prepassClear = new THREE.Color(0.5, 0.5, 1.0);
  // Linear-space clear for the HDR pass. Fog far colour rather than black so any seam in the
  // sky dome reads as haze instead of a hole.
  const worldClear = new THREE.Color().setStyle(ATMOSPHERE.fogColourFar, THREE.SRGBColorSpace);

  /**
   * Objects the prepass must skip even though they sit on the WORLD layer. Rebuilt lazily:
   * scene composition changes when the level streams in or a corpse is added, not per frame.
   */
  const skipList = [];
  const skipVisible = [];
  let skipScanFrame = -1e9;
  let skipTopCount = -1;

  function materialExcluded(m) {
    if (!m) return false;
    if (m.transparent === true) return true;
    if (m.opacity !== undefined && m.opacity < 1) return true;
    if (m.allowOverride === false) return true; // Three will not swap it, so it would draw albedo
    if (m.userData && m.userData.noPrepass === true) return true;
    return false;
  }

  // Hoisted so the traversal does not allocate a closure every time it runs.
  function collectExclusion(obj) {
    if (obj.isPoints === true || obj.isLine === true || obj.isSprite === true) {
      skipList.push(obj);
      return;
    }
    if (obj.isMesh !== true) return;
    if (obj.userData && obj.userData.noPrepass === true) {
      skipList.push(obj);
      return;
    }
    const m = obj.material;
    if (Array.isArray(m)) {
      for (let i = 0; i < m.length; i++) {
        if (materialExcluded(m[i])) {
          skipList.push(obj);
          return;
        }
      }
    } else if (materialExcluded(m)) {
      skipList.push(obj);
    }
  }

  function scanPrepassExclusions(root) {
    skipList.length = 0;
    root.traverse(collectExclusion);
    skipVisible.length = skipList.length;
  }

  /* --- Matrices --------------------------------------------------------- */

  const prevViewProj = new THREE.Matrix4();
  const currViewProj = new THREE.Matrix4();
  const prevViewProjJittered = new THREE.Matrix4();
  const currViewProjJittered = new THREE.Matrix4();
  const unjitteredProj = new THREE.Matrix4();
  let matricesPrimed = false;

  /**
   * Mirror the world camera's TAA jitter onto the viewmodel camera.
   *
   * For a symmetric perspective frustum, elements[8] and [9] (column-major: row 0/1 of column
   * 2) are zero. Whatever `post.jitter` leaves there — whether it edited the matrix directly
   * or went through setViewOffset — is precisely the NDC sub-pixel offset. Both cameras share
   * the viewport, so the same offset applies verbatim. Without this the weapon is the only
   * un-jittered object on screen and TAA sharpens it into a crawling, aliased mess.
   */
  function syncViewmodelJitter(activeCamera, activeViewCamera) {
    const e = activeCamera.projectionMatrix.elements;
    activeViewCamera.updateProjectionMatrix();
    const jx = e[8];
    const jy = e[9];
    // Sanity clamp: a genuine off-axis frustum (never used here) would blow past this.
    if (Math.abs(jx) < 0.05 && Math.abs(jy) < 0.05) {
      activeViewCamera.projectionMatrix.elements[8] = jx;
      activeViewCamera.projectionMatrix.elements[9] = jy;
      activeViewCamera.projectionMatrixInverse.copy(activeViewCamera.projectionMatrix).invert();
    }
  }

  function updateMatrices(activeCamera) {
    // Strip the jitter for the stored view-projections: velocity must describe scene motion,
    // not the Halton sequence.
    unjitteredProj.copy(activeCamera.projectionMatrix);
    unjitteredProj.elements[8] = 0;
    unjitteredProj.elements[9] = 0;

    currViewProj.multiplyMatrices(unjitteredProj, activeCamera.matrixWorldInverse);
    currViewProjJittered.multiplyMatrices(activeCamera.projectionMatrix, activeCamera.matrixWorldInverse);

    if (!matricesPrimed) {
      // Frame 0: a zero previous matrix would reproject everything to the origin and make the
      // first TAA resolve a full-screen ghost.
      prevViewProj.copy(currViewProj);
      prevViewProjJittered.copy(currViewProjJittered);
      matricesPrimed = true;
    }
  }

  /* --- Viewmodel light sync --------------------------------------------- */

  let viewLightSync = true;

  function syncViewLights(game, activeScene, activeCamera) {
    // Mirror the world IBL unconditionally, at the world's weight, so the gun's metal reflects
    // the same dusk sky as the level. Without this the viewmodel is the one object in frame
    // with no environment response and it reads as plastic; with it at a *different* weight it
    // is the one object whose speculars disagree with everything around them. Read the value
    // off the scene rather than from LIGHTING directly so a debug override or an environment
    // fade reaches the weapon too — LIGHTING.envIntensity is only the pre-sky.js fallback.
    if (viewScene.environment !== activeScene.environment) viewScene.environment = activeScene.environment;
    viewScene.environmentIntensity =
      typeof activeScene.environmentIntensity === 'number'
        ? activeScene.environmentIntensity
        : LIGHTING.envIntensity;

    if (!viewLightSync) return;
    const sky = game && game.sky ? game.sky : null;

    /* ---- Fill: proportional to the world's own sky fill ------------------ */
    // sky.js drives hemi.intensity with the sky's live luminance and pre-scales groundColor to
    // carry the authored sky:ground ratio, so copying the pair wholesale and applying one
    // occlusion factor keeps the weapon's fill exactly proportional to the yard's at any time
    // of day — including after sunset, when a hard-coded LIGHTING.hemiSkyIntensity would leave
    // the gun sitting in noon-strength blue while the world went dark.
    const worldHemi = sky && sky.hemi ? sky.hemi : null;
    if (worldHemi) {
      viewHemi.color.copy(worldHemi.color);
      viewHemi.groundColor.copy(worldHemi.groundColor);
      viewHemi.intensity = worldHemi.intensity * VIEW_FILL_OCCLUSION;
      // The rim is a stand-in for sky wrap, so it is a fraction of the sky fill actually
      // reaching the weapon, never a number of its own. Cool, and clearly weaker than the key.
      viewRim.color.copy(worldHemi.color);
      viewRim.intensity = viewHemi.intensity * VIEW_RIM_OF_FILL;
    }

    /* ---- Key: the world sun, attenuated, in view space ------------------- */
    const sun = sky && sky.sun ? sky.sun : null;
    if (!sun) return;

    // Colour and intensity come from the live key, never from PALETTE.sun /
    // LIGHTING.sunIntensity. sky.js re-derives both from atmospheric extinction every time the
    // sun moves and collapses to exactly the art.js pair at SUN_ELEVATION, so this is still
    // art.js-driven — but a hard-coded copy would keep blazing at the design value long after
    // the world's key had reddened and dimmed.
    viewKey.color.copy(sun.color);
    viewKey.intensity = sun.intensity * VIEW_KEY_OCCLUSION;

    // World-space direction the key light travels *from*.
    _v3a.copy(sun.position);
    if (sun.target) _v3a.sub(sun.target.position);
    if (_v3a.lengthSq() < 1e-8) return;
    _v3a.normalize();

    // Into view space. viewScene's space is the world camera's view space by construction —
    // viewCamera sits at the origin with identity rotation — so a direction rotated by the
    // view matrix's 3x3 is directly usable as a light position in viewScene. `activeCamera`'s
    // matrixWorldInverse is refreshed at the top of renderScene, immediately before this call,
    // so the rake tracks the turn on the same frame rather than one behind it.
    _m3a.setFromMatrix4(activeCamera.matrixWorldInverse);
    _v3a.applyMatrix3(_m3a).normalize();

    // Same direction relative to the eye as the world's key. Turning west must rake the
    // receiver the way it rakes the yard — that raking warm edge is the whole point of putting
    // the key here rather than parking a fixed three-point rig in front of the camera.
    viewKey.position.copy(_v3a).multiplyScalar(4);
    viewKey.target.position.set(0, 0, 0);
    // Rim sits opposite the key horizontally and slightly behind the weapon, so the silhouette
    // stays legible when the player faces away from the sun.
    viewRim.position.set(-_v3a.x * 2.5, 1.2, -Math.abs(_v3a.z) * 1.5 - 1.0);
    viewRim.target.position.set(0, 0, 0);
  }

  /* --- Frame ------------------------------------------------------------ */

  const stats = { drawCalls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0 };

  function collectStats() {
    const info = renderer.info;
    stats.drawCalls = info.render.calls;
    stats.triangles = info.render.triangles;
    stats.programs = info.programs ? info.programs.length : 0;
    stats.geometries = info.memory.geometries;
    stats.textures = info.memory.textures;
    info.reset();
  }

  function renderPrepass(activeScene, activeCamera) {
    const rt = targets.normal;
    if (!rt) return;

    renderer.setRenderTarget(rt);
    renderer.setClearColor(prepassClear, 1);
    renderer.clear(true, true, false);

    if (!preset.prepass) {
      // `low` disables SSAO, motion blur and DOF, so nothing reads this buffer. Keep it
      // allocated and cleared (consumers stay valid) but skip the geometry pass entirely.
      return;
    }

    // Refresh the exclusion cache when the scene has visibly changed, and periodically as a
    // backstop for in-place material edits.
    if (
      activeScene.children.length !== skipTopCount ||
      engine.frame - skipScanFrame > PREPASS_SCAN_INTERVAL
    ) {
      scanPrepassExclusions(activeScene);
      skipTopCount = activeScene.children.length;
      skipScanFrame = engine.frame;
    }

    for (let i = 0; i < skipList.length; i++) {
      skipVisible[i] = skipList[i].visible;
      skipList[i].visible = false;
    }

    const prevMask = activeCamera.layers.mask;
    const prevBackground = activeScene.background;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    const prevShadowNeeds = renderer.shadowMap.needsUpdate;
    const prevOverride = activeScene.overrideMaterial;

    activeCamera.layers.mask = MASK_PREPASS;
    activeScene.background = null; // a sky texture here would be written as if it were a normal
    activeScene.overrideMaterial = prepass.material;
    // The prepass evaluates no lights, so cascades must not be rendered here. Latching
    // needsUpdate off as well stops the prepass swallowing a one-shot shadow refresh that the
    // main pass is the one that actually needs.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;

    renderer.render(activeScene, activeCamera);

    activeScene.overrideMaterial = prevOverride;
    activeScene.background = prevBackground;
    activeCamera.layers.mask = prevMask;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.shadowMap.needsUpdate = prevShadowNeeds;

    for (let i = 0; i < skipList.length; i++) skipList[i].visible = skipVisible[i];
  }

  function renderScene(game) {
    const activeScene = (game && game.scene) || scene;
    const activeCamera = (game && game.camera) || camera;
    const activeViewScene = (game && game.viewScene) || viewScene;
    const activeViewCamera = (game && game.viewCamera) || viewCamera;

    // Read last frame's counters (which now include the post chain) before zeroing them.
    collectStats();
    engine.frame++;

    // Re-assert rather than trust: every pass below clears explicitly, and if anything else
    // in the frame left autoClear on, step 3 would wipe the world render out of the HDR
    // target instead of laying the viewmodel over it.
    renderer.autoClear = false;

    // Roll the history forward. Doing it here rather than at the end of the frame means that
    // while post.render runs, prev == frame N-1 and curr == frame N, which is what the
    // reprojection maths expects.
    if (matricesPrimed) {
      prevViewProj.copy(currViewProj);
      prevViewProjJittered.copy(currViewProjJittered);
    }

    activeCamera.updateMatrixWorld();
    activeCamera.matrixWorldInverse.copy(activeCamera.matrixWorld).invert();
    updateMatrices(activeCamera);

    syncViewmodelJitter(activeCamera, activeViewCamera);
    syncViewLights(game, activeScene, activeCamera);

    // ---- 1. normal + roughness prepass -> targets.normal
    renderPrepass(activeScene, activeCamera);

    // ---- 2. world -> targets.hdr (colour + depth cleared)
    renderer.setRenderTarget(targets.hdr);
    renderer.setClearColor(worldClear, 1);
    renderer.clear(true, true, false);
    renderer.render(activeScene, activeCamera);

    // ---- 3. viewmodel -> same target, depth cleared, colour kept.
    // Depth is still written so DOF and motion blur can reason about the weapon; the clear is
    // what stops the barrel poking through a wall the player is standing against.
    renderer.clearDepth();
    activeViewCamera.updateMatrixWorld();
    renderer.render(activeViewScene, activeViewCamera);

    renderer.setRenderTarget(null);
  }

  /* --- Quality ---------------------------------------------------------- */

  function setQuality(q) {
    const name = QUALITY[q] ? q : DEFAULT_QUALITY;
    if (name === engine.quality) return;
    engine.quality = name;
    preset = qualityOf(name);
    engine.renderScale = preset.renderScale;
    prepass.state.detailNormals = preset.detailNormals;
    prepass.state.alphaTest = preset.alphaTest;
    // Force the exclusion cache to rebuild — geometry may have been swapped with the preset.
    skipTopCount = -1;
    // Re-applies the render scale and reallocates both targets in place (setSize disposes the
    // old GPU allocation), so nothing leaks and postfx's cached texture references survive.
    resize(cssSize.w, cssSize.h);
  }

  /* --- Helpers ---------------------------------------------------------- */

  /**
   * Put an object (and by default its whole subtree) on exactly one engine layer. Exclusive
   * assignment — see the LAYERS note at the top of this file.
   */
  function setLayer(object, layer, recursive = true) {
    if (!object) return object;
    if (recursive) object.traverse((o) => o.layers.set(layer));
    else object.layers.set(layer);
    return object;
  }

  /** Pre-compile both scenes so the first frame after the menu does not hitch on shaders. */
  function warmup(game) {
    try {
      renderer.compile((game && game.scene) || scene, (game && game.camera) || camera);
      renderer.compile((game && game.viewScene) || viewScene, (game && game.viewCamera) || viewCamera);
    } catch (err) {
      if (engine.debug) console.warn('[engine] warmup failed', err);
    }
  }

  /* --- Context loss ------------------------------------------------------ */

  const onContextLost = (event) => {
    event.preventDefault(); // opt in to restoration
    engine.contextLost = true;
  };
  const onContextRestored = () => {
    engine.contextLost = false;
    // Targets are backed by the lost context; force a full reallocation at the current size.
    skipTopCount = -1;
    disposeTargets();
    buildTargets(size.w, size.h);
    for (const fn of resizeListeners) {
      try {
        fn(size.w, size.h, engine);
      } catch (err) {
        if (engine.debug) console.warn('[engine] restore listener failed', err);
      }
    }
  };
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);

  /* --- Dispose ---------------------------------------------------------- */

  function dispose() {
    canvas.removeEventListener('webglcontextlost', onContextLost, false);
    canvas.removeEventListener('webglcontextrestored', onContextRestored, false);
    resizeListeners.clear();
    skipList.length = 0;
    skipVisible.length = 0;
    disposeTargets();
    prepass.dispose();
    viewScene.clear();
    renderer.dispose();
  }

  /* --- Public object ---------------------------------------------------- */

  const engine = {
    renderer,
    gl,
    scene,
    camera,
    viewScene,
    viewCamera,
    viewLights,

    size,
    /** CSS pixel size of the canvas box. `size` is the internal buffer, which is what postfx wants. */
    cssSize,

    targets,
    /** False when EXT_color_buffer_float / _half_float were both missing and we fell back to RGBA8. */
    hdrAvailable,
    maxAnisotropy,

    LAYER,
    LAYER_MASK: { world: MASK_WORLD, prepass: MASK_PREPASS, view: viewCamera.layers.mask },

    prevViewProj,
    currViewProj,
    prevViewProjJittered,
    currViewProjJittered,
    /** Viewmodel pixels in the HDR depth texture were projected with these, not the world camera's. */
    viewDepthParams: { near: CAMERA.viewmodelNear, far: CAMERA.viewmodelFar },

    quality: qualityName,
    renderScale: preset.renderScale,
    frame: 0,
    contextLost: false,
    debug: false,

    stats,
    prepassMaterial: prepass.material,

    resize,
    setQuality,
    renderScene,
    setLayer,
    warmup,
    dispose,

    /** postfx (and anything else owning screen-sized resources) subscribes here. */
    addResizeListener(fn) {
      resizeListeners.add(fn);
      return () => resizeListeners.delete(fn);
    },
    removeResizeListener(fn) {
      resizeListeners.delete(fn);
    },

    /** Opt out of the automatic viewmodel key-light sync (weapon.js may want manual control). */
    setViewLightSync(enabled) {
      viewLightSync = !!enabled;
    },

    /** Force the prepass exclusion cache to rebuild after a wholesale scene edit. */
    invalidatePrepassCache() {
      skipTopCount = -1;
    },
  };

  const rect = canvas.getBoundingClientRect();
  resize(rect.width || window.innerWidth, rect.height || window.innerHeight);

  return engine;
}

export default createEngine;
