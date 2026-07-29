import * as THREE from '../../vendor/three/build/three.module.js';
import { FullScreenQuad } from '../../vendor/three/addons/postprocessing/Pass.js';
import { SMAAPass } from '../../vendor/three/addons/postprocessing/SMAAPass.js';
import { LAYER } from '../core/engine.js';

/* Final-image pipeline.

   The engine draws two scenes (backdrop with its own camera and far plane, a
   depth clear, then gameplay). Everything here happens *after* that, in linear
   HDR: three disables tone mapping and forces linear output whenever a render
   target is bound, so the scene lands in a half-float buffer with real
   headroom — an engine plume at 60x white stays at 60x instead of being
   clipped to 1.0 by ACES before we ever see it.

   Order of operations, and why:
     scene -> TAA        temporal AA must run on the raw HDR frame, before any
                         effect that widens a bright pixel; otherwise bloom
                         feeds the history buffer and the image creeps.
     -> exposure         log-average luminance, reduced on the GPU and eased
                         into a 1x1 target. Never read back — a readPixels here
                         would stall the pipeline every frame.
     -> bloom            thresholded in *scene-referred* linear, with three
                         different cut points (see _renderBloom).
     -> streak           anamorphic smear off the brightest bloom mip only.
     -> DoF              far-field only, and never the backdrop. Blurring the
                         near field would smear ships the player is clicking;
                         blurring the backdrop would throw away the subject.
     -> composite        grade, tone map, vignette, aberration, grain, dither.
     -> SMAA             spatial AA for the tiers without TAA, run on the
                         tone-mapped LDR image where luma edge detection works.

   Nothing in here touches engine state permanently: the camera projection is
   jittered and restored inside a single render(), and the renderer's own tone
   mapping is left alone because it never sees our fullscreen quads. */

const HALTON = [
  [0.500000, 0.333333], [0.250000, 0.666667], [0.750000, 0.111111], [0.125000, 0.444444],
  [0.625000, 0.777778], [0.375000, 0.222222], [0.875000, 0.555556], [0.062500, 0.888889],
  [0.562500, 0.037037], [0.312500, 0.370370], [0.812500, 0.703704], [0.187500, 0.148148],
  [0.687500, 0.481481], [0.437500, 0.814815], [0.937500, 0.259259], [0.031250, 0.592593],
];

const TIERS = {
  low: {
    taa: false, smaa: true, msaa: 0, bloom: true, bloomMips: 5, glow: false,
    streak: false, dof: false, grain: false, aberration: false, vignette: true,
    exposure: true, grade: true, bloomScatter: 0.55, taaSharpen: 0.0,
  },
  medium: {
    taa: false, smaa: true, msaa: 4, bloom: true, bloomMips: 6, glow: true,
    streak: false, dof: false, grain: true, aberration: true, vignette: true,
    exposure: true, grade: true, bloomScatter: 0.58, taaSharpen: 0.0,
  },
  high: {
    taa: true, smaa: false, msaa: 0, bloom: true, bloomMips: 7, glow: true,
    streak: false, dof: true, grain: true, aberration: true, vignette: true,
    exposure: true, grade: true, bloomScatter: 0.62, taaSharpen: 0.0,
  },
  ultra: {
    taa: true, smaa: false, msaa: 0, bloom: true, bloomMips: 8, glow: true,
    streak: false, dof: true, grain: true, aberration: true, vignette: true,
    exposure: true, grade: true, bloomScatter: 0.66, taaSharpen: 0.0,
  },
};

/* The anamorphic streak is off in every tier on purpose, not because it does
   not work. It is a horizontal-only smear, which claims an anamorphic lens —
   and nothing else in this game supports that claim: the HUD is a thin vector
   overlay with no chrome or gloss, and the bloom, the flares and the shield
   hits are all radially symmetrical. One wide horizontal bar across the key
   star reads as a rendering fault rather than a lens. The pass and its params
   are kept so that `setEnabled('streak', true)` can switch it back on if the
   art direction ever commits to anamorphic across the board.

   Ownership note: the key star's flare is [ENV]'s — it is scene geometry and
   blooms correctly through this stack on its own. POSTFX does not draw one. */
const ORDER = ['low', 'medium', 'high', 'ultra'];

/* Fullscreen triangle. FullScreenQuad's geometry is already in clip space, so
   skip the matrix multiply entirely. */
const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/* Shared helpers. Kept as one string so every shader agrees on what luminance
   means — mismatched luma between the bloom threshold and the grade is how you
   end up with hulls that glow at some exposures and not others. */
const COMMON = `
float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
float maxc( vec3 c ) { return max( c.r, max( c.g, c.b ) ); }

vec3 rgb2ycocg( vec3 c ) {
  return vec3(
    0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
    0.5 * c.r - 0.5 * c.b,
    -0.25 * c.r + 0.5 * c.g - 0.25 * c.b );
}
vec3 ycocg2rgb( vec3 c ) {
  float t = c.x - c.z;
  return vec3( t + c.y, c.x + c.z, t - c.y );
}

/* Stephen Hill's fitted ACES RRT+ODT — the same curve three uses for
   ACESFilmicToneMapping, so toggling the stack on and off does not shift the
   overall look. */
vec3 acesFitted( vec3 color ) {
  const mat3 ACESInput = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777 );
  const mat3 ACESOutput = mat3(
     1.60475, -0.10208, -0.00327,
    -0.53108,  1.10813, -0.07276,
    -0.07367, -0.00605,  1.07602 );
  color = ACESInput * ( color / 0.6 );
  vec3 a = color * ( color + 0.0245786 ) - 0.000090537;
  vec3 b = color * ( 0.983729 * color + 0.4329510 ) + 0.238081;
  color = ACESOutput * ( a / b );
  return clamp( color, 0.0, 1.0 );
}

vec3 linearToSrgb( vec3 c ) {
  return mix( c * 12.92, 1.055 * pow( max( c, vec3( 0.0 ) ), vec3( 0.41666 ) ) - 0.055,
              step( vec3( 0.0031308 ), c ) );
}

/* Interleaved gradient noise — cheap, tiles badly on purpose, no texture. */
float ign( vec2 p ) {
  return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
}

float hash13( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}

/* Soft-knee highlight isolation, shared by all three bloom cut points so they
   cannot drift apart. */
float kneeCut( float br, float thr, float soft ) {
  float knee = max( thr * soft, 1e-4 );
  float s = clamp( br - thr + knee, 0.0, 2.0 * knee );
  s = s * s / ( 4.0 * knee );
  return max( s, br - thr ) / max( br, 1e-4 );
}
`;

/* Depth -> linear view distance. The engine runs a logarithmic depth buffer,
   so the stored value is log2(1+w)/log2(far+1); inverting that is exact and
   cheaper than reconstructing from a perspective divide. */
const DEPTH_GLSL = `
uniform float uLogFar;
uniform vec2 uNearFar;
float linearDepth( float d ) {
  #ifdef LOG_DEPTH
    return exp2( d * uLogFar ) - 1.0;
  #else
    float n = uNearFar.x;
    float f = uNearFar.y;
    return ( 2.0 * n * f ) / ( f + n - ( d * 2.0 - 1.0 ) * ( f - n ) );
  #endif
}
`;

/* Partial adaptation, not full. Metering a space frame to middle grey is
   wrong twice over: the frame is 90% empty so the meter runs away to the
   ceiling, and "space should be dark" is the whole art direction. Adaptation
   here is a safety valve — it stops a nebula core or a detonating capital from
   clipping, and otherwise leaves the artist-set exposure alone. The exponent
   is the strength of that valve; 1.0 would be full auto-exposure. */
const EXPOSURE_GLSL = `
uniform sampler2D tExposure;
uniform float uExposureComp;
uniform float uExposureRef;
uniform float uAdaptStrength;
uniform vec2 uExposureRange;
float sceneExposure() {
  float avg = max( texture2D( tExposure, vec2( 0.5 ) ).r, 1e-4 );
  float e = uExposureComp * pow( uExposureRef / avg, uAdaptStrength );
  return clamp( e, uExposureRange.x, uExposureRange.y );
}
`;

function fsMaterial(fragmentShader, uniforms, defines) {
  return new THREE.ShaderMaterial({
    uniforms,
    defines: defines || {},
    vertexShader: VERT,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
}

function makeTarget(w, h, opts) {
  const o = opts || {};
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: o.type || THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: o.filter || THREE.LinearFilter,
    magFilter: o.filter || THREE.LinearFilter,
    depthBuffer: !!o.depth,
    stencilBuffer: false,
    generateMipmaps: false,
    samples: o.samples || 0,
  });
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  rt.texture.wrapS = THREE.ClampToEdgeWrapping;
  rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  return rt;
}

/* WebGL2 timer queries, one scope per frame round-robin. Nesting is illegal
   (only one TIME_ELAPSED query may be active), hence the rotation rather than
   a real hierarchy. Silently degrades to null on drivers that hide it. */
class GpuTimer {
  constructor(renderer) {
    const gl = renderer.getContext();
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.results = Object.create(null);
    this._pending = [];
    this._active = null;
    this._scopes = [];
    this._cursor = 0;
  }

  frame(scopes) {
    if (!this.ext) return;
    this._scopes = scopes;
    this._cursor = (this._cursor + 1) % scopes.length;
    this._collect();
  }

  get target() {
    return this._scopes.length ? this._scopes[this._cursor] : null;
  }

  begin(name) {
    if (!this.ext || this._active || name !== this.target) return;
    const q = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this._active = { name, q };
  }

  end(name) {
    if (!this._active || this._active.name !== name) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this._pending.push(this._active);
    this._active = null;
  }

  _collect() {
    const gl = this.gl;
    for (let i = this._pending.length - 1; i >= 0; i--) {
      const p = this._pending[i];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) continue;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      if (!disjoint) {
        const ms = gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
        const prev = this.results[p.name];
        this.results[p.name] = prev === undefined ? ms : prev + (ms - prev) * 0.2;
      }
      gl.deleteQuery(p.q);
      this._pending.splice(i, 1);
    }
  }

  dispose() {
    for (const p of this._pending) this.gl.deleteQuery(p.q);
    this._pending.length = 0;
  }
}

export class PostFX {
  constructor(engine) {
    this.engine = engine;
    this.renderer = engine.renderer;
    this.enabled = true;
    this.quality = engine.quality || 'high';
    this.tier = Object.assign({}, TIERS[this.quality] || TIERS.high);

    this._quad = new FullScreenQuad(null);
    this._w = 1;
    this._h = 1;
    this._dpr = 1;
    this._frame = 0;
    this._historyValid = false;
    this._glowMode = 'both';
    this._split = -1;

    this._prevView = new THREE.Matrix4();
    this._reproj = new THREE.Matrix4();
    this._savedProj = new THREE.Matrix4();
    this._jitter = new THREE.Vector2();
    this._prevProj = new THREE.Vector2(1, 1);

    // 1x1 black stand-in so samplers are never left unbound.
    this._black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this._black.needsUpdate = true;

    this.params = {
      /* Bloom cut points are scene-referred (pre-exposure) on purpose. A cut
         that floats with adaptation cannot honour "hulls never bloom" (§3.6):
         exposure legitimately swings ~4x as the camera moves, and no single
         exposed threshold sits above the hull ceiling at one end and below the
         star cores at the other. Measured in-game: lit hull peaks at ~2.3,
         combat FX run 4–9+, so 2.8 sits in a real gap. */
      bloomThreshold: 2.8,      // near scene: above the hull ceiling
      bloomThresholdSky: 0.45,  // backdrop only: lets star cores bloom
      bloomThresholdGlow: 0.6,  // FX glow layer: authored emissives
      bloomSoftness: 0.55,
      bloomStrength: 0.5,
      bloomClamp: 48.0,
      bloomScatter: this.tier.bloomScatter,
      streakThreshold: 3.2,
      streakStrength: 0.05,
      streakLength: 1.0,
      streakAtten: 0.94,
      streakTint: new THREE.Color(0.55, 0.72, 1.0),
      exposureComp: 1.0,
      exposureRef: 0.1,
      adaptStrength: 0.5,
      exposureMin: 0.6,
      exposureMax: 2.4,
      exposureUpRate: 1.35,
      exposureDownRate: 0.5,
      vignette: 0.2,
      aberration: 0.55,
      grain: 0.026,
      contrast: 0.07,
      saturation: 1.02,
      /* Deliberately tiny. This is an *additive* floor, so it lands entirely on
         the darkest part of the image — which is the shadow side of every hull.
         Measured through the composite: at 0.02 it put true black at #0d1422
         and added ~20 8-bit codes below linear 0.02, i.e. it single-handedly
         turned the void navy and flattened the terminator §3.2 depends on. At
         0.004 the same measurement is ~3 codes: enough that space is not a dead
         flat zero, not enough to lift a shadow. */
      shadowLift: 0.004,
      splitTone: 0.09,
      highlightRolloff: 0.35,
      shadowTint: new THREE.Color(0.36, 0.52, 0.85),
      highlightTint: new THREE.Color(1.0, 0.86, 0.66),
      taaFeedback: 0.94,
      taaClampGamma: 1.25,
      taaFilter: 1.4,
      dofStrength: 0.35,
      dofRange: 9000,
      dofMaxRadius: 4.0,
      focusDistance: 1200,
      autoFocus: true,
      focusRate: 2.4,
    };

    this._timer = new GpuTimer(this.renderer);
    this._fpsAvg = 60;
    this._sagTimer = 0;
    this._headroomTimer = 0;

    this._buildMaterials();
    this._smaa = new SMAAPass();
    this._smaa.clear = true;
    this._smaa.renderToScreen = true;

    this.resize(engine.size.w, engine.size.h);
  }

  /* ---------------------------------------------------------------- public */

  /** Safe to call at any time after construction; rebuilds every target. */
  setQuality(q) {
    if (!TIERS[q] || q === this.quality) return;
    this.quality = q;
    this.tier = Object.assign({}, TIERS[q]);
    this.params.bloomScatter = this.tier.bloomScatter;
    this._syncDefines();
    this._allocate();
    this._historyValid = false;
  }

  resize(w, h) {
    const dpr = this.engine.size.dpr || 1;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (pw === this._w && ph === this._h && this._rtScene) return;
    this._w = pw;
    this._h = ph;
    this._dpr = dpr;
    this._allocate();
    this._historyValid = false;
  }

  /** Effect toggles that survive quality changes are set through the tier. */
  setEnabled(name, on) {
    if (!(name in this.tier)) return;
    this.tier[name] = !!on;
    this._syncDefines();
    if (name === 'glow') this._allocate();
    if (name === 'bloom' || name === 'taa') this._historyValid = false;
  }

  setParams(obj) {
    for (const k of Object.keys(obj)) {
      if (!(k in this.params)) continue;
      const cur = this.params[k];
      if (cur && cur.isColor) cur.set(obj[k]);
      else this.params[k] = obj[k];
    }
  }

  /** Lets the grade drift with the seeded nebula instead of a fixed teal.
      Both tints are luma-normalised in the shader, so these only ever change
      hue — never the level, and never a neutral surface. */
  setNebulaColours(key, fill) {
    if (key) this.params.highlightTint.set(key);
    if (fill) this.params.shadowTint.set(fill);
  }

  setFocus(opts) {
    this.setParams(opts || {});
  }

  /** 'threshold' | 'layer' | 'both'. 'both' (default) unions the scene-referred
      cut with the FX glow layer, so an authored emissive blooms even if the
      VFX pass later dials its absolute brightness down. */
  setGlowMode(mode) {
    if (mode !== 'threshold' && mode !== 'layer' && mode !== 'both') return;
    if (mode === this._glowMode) return;
    this._glowMode = mode;
    this._syncDefines();
    this._allocate();
  }

  /** Debug split: 0..1 shows the ungraded image left of that fraction. <0 off. */
  setSplitView(x) {
    const on = x >= 0;
    const was = this._split >= 0;
    this._split = x;
    if (on !== was) this._syncDefines();
  }

  /* Adaptive hook. Feed it a smoothed fps every frame; it returns the tier the
     main loop should be on. Hysteresis is deliberately lopsided — drop fast
     when frames are being missed, climb back slowly so the stack does not
     oscillate on a scene that only just fits. */
  suggestQuality(fps) {
    if (!(fps > 0)) return this.quality;
    this._fpsAvg += (fps - this._fpsAvg) * 0.08;
    const dt = 1 / Math.max(fps, 1);
    const i = ORDER.indexOf(this.quality);
    if (this._fpsAvg < 48) {
      this._sagTimer += dt;
      this._headroomTimer = 0;
      if (this._sagTimer > 2.5 && i > 0) {
        this._sagTimer = 0;
        return ORDER[i - 1];
      }
    } else if (this._fpsAvg > 58.5) {
      this._headroomTimer += dt;
      this._sagTimer = 0;
      if (this._headroomTimer > 12 && i < ORDER.length - 1) {
        this._headroomTimer = 0;
        return ORDER[i + 1];
      }
    } else {
      this._sagTimer = Math.max(0, this._sagTimer - dt);
      this._headroomTimer = Math.max(0, this._headroomTimer - dt);
    }
    return this.quality;
  }

  /** Smoothed per-pass GPU milliseconds, or null where unsupported. */
  getTimings() {
    return this._timer.ext ? Object.assign({}, this._timer.results) : null;
  }

  render(dt, elapsed) {
    if (!this.enabled || !this._rtScene) {
      this.renderer.setRenderTarget(null);
      this.engine.renderScenes();
      return;
    }

    this._frame++;
    this._timer.frame(this._scopeNames);

    const t = this._timer;
    t.begin('total');
    t.begin('scene'); this._drawScenes(); t.end('scene');

    let src = this._rtScene;
    if (this.tier.taa) {
      t.begin('taa'); src = this._resolveTaa(); t.end('taa');
    }

    if (this.tier.exposure) {
      t.begin('exposure'); this._updateExposure(src, dt); t.end('exposure');
    }
    if (this.tier.bloom) {
      t.begin('bloom'); this._renderBloom(src); t.end('bloom');
      if (this.tier.streak) { t.begin('streak'); this._renderStreak(); t.end('streak'); }
    }
    if (this.tier.dof && this.params.dofStrength > 0.001) {
      t.begin('dof'); this._renderDof(src, dt); t.end('dof');
    }

    t.begin('composite'); this._composite(src, elapsed); t.end('composite');

    if (this.tier.smaa) {
      t.begin('smaa');
      this._smaa.render(this.renderer, null, this._rtLdr);
      t.end('smaa');
    }
    t.end('total');

    this.renderer.setRenderTarget(null);
    this._storeHistory();
  }

  dispose() {
    this._timer.dispose();
    this._smaa.dispose();
    this._quad.dispose();
    this._black.dispose();
    this._freeTargets();
    for (const m of this._materials) m.dispose();
    this._materials.length = 0;
  }

  /* --------------------------------------------------------------- targets */

  _freeTargets() {
    const kill = (rt) => {
      if (!rt) return;
      if (rt.depthTexture) rt.depthTexture.dispose();
      rt.dispose();
    };
    // The glow target borrows the scene's depth texture; drop the reference
    // first so three does not free it twice.
    if (this._rtGlow) {
      this._rtGlow.depthTexture = null;
      this._rtGlow.dispose();
      this._rtGlow = null;
    }
    kill(this._rtScene);
    kill(this._rtLdr);
    const killAll = (list) => { if (list) for (const rt of list) kill(rt); };
    killAll(this._rtTaa);
    killAll(this._rtDown);
    killAll(this._rtUp);
    killAll(this._rtStreak);
    killAll(this._rtLum);
    killAll(this._rtExp);
    killAll(this._rtFocus);
    kill(this._rtDof);
    this._rtScene = null;
    this._rtLdr = null;
    this._rtDof = null;
    this._rtTaa = null;
    this._rtDown = null;
    this._rtUp = null;
    this._rtStreak = null;
    this._rtLum = null;
    this._rtExp = null;
    this._rtFocus = null;
    this._bloomTex = null;
    this._streakTex = null;
  }

  _allocate() {
    this._freeTargets();
    const w = this._w;
    const h = this._h;
    // MSAA and TAA together is wasted bandwidth, so they are mutually exclusive.
    const samples = this.tier.taa ? 0 : (this.tier.msaa || 0);

    // Scene target: half-float for headroom, depth texture for TAA + DoF and
    // as the read-only depth attachment the glow pass tests against.
    this._rtScene = makeTarget(w, h, { depth: true, samples });
    const depth = new THREE.DepthTexture(w, h);
    depth.type = THREE.UnsignedIntType;
    depth.format = THREE.DepthFormat;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    this._rtScene.depthTexture = depth;

    this._rtTaa = [makeTarget(w, h), makeTarget(w, h)];
    this._taaIndex = 0;

    const mips = Math.max(1, Math.min(this.tier.bloomMips, Math.floor(Math.log2(Math.min(w, h))) - 2));
    this._mips = mips;
    this._rtDown = [];
    this._rtUp = [];
    for (let i = 0; i < mips; i++) {
      this._rtDown.push(makeTarget(w >> (i + 1), h >> (i + 1)));
      if (i < mips - 1) this._rtUp.push(makeTarget(w >> (i + 1), h >> (i + 1)));
    }

    this._rtStreak = [
      makeTarget(Math.max(1, w >> 2), Math.max(1, h >> 3)),
      makeTarget(Math.max(1, w >> 2), Math.max(1, h >> 3)),
    ];

    // Luminance reduction: 128 -> 32 -> 8 -> 2 -> 1, four bilinear taps each.
    this._rtLum = [
      makeTarget(128, 128),
      makeTarget(32, 32),
      makeTarget(8, 8),
      makeTarget(2, 2),
    ];
    this._rtExp = [
      makeTarget(1, 1, { filter: THREE.NearestFilter }),
      makeTarget(1, 1, { filter: THREE.NearestFilter }),
    ];
    this._expIndex = 0;
    this._rtFocus = [
      makeTarget(1, 1, { filter: THREE.NearestFilter }),
      makeTarget(1, 1, { filter: THREE.NearestFilter }),
    ];
    this._focusIndex = 0;

    this._rtDof = makeTarget(w >> 1, h >> 1);
    this._rtLdr = makeTarget(w, h, { type: THREE.UnsignedByteType });
    this._rtLdr.texture.colorSpace = THREE.SRGBColorSpace;

    if (this._useGlow) {
      // Full res and sharing the scene depth: the glow layer must be occluded
      // by the hull in front of it, or an engine plume haloes straight through
      // the ship it belongs to.
      this._rtGlow = makeTarget(w, h, { depth: true });
      this._rtGlow.depthTexture = depth;
    }

    this._smaa.setSize(w, h);
    this._seedExposure();
  }

  get _useGlow() {
    return this._glowMode !== 'threshold' && !!this.tier.glow;
  }

  /* Prime the adaptation buffers so frame one is not a black flash. */
  _seedExposure() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    this._quad.material = this._mSeed;
    this._mSeed.uniforms.uValue.value = 0.12;
    for (const rt of this._rtExp) { r.setRenderTarget(rt); this._quad.render(r); }
    this._mSeed.uniforms.uValue.value = this.params.focusDistance;
    for (const rt of this._rtFocus) { r.setRenderTarget(rt); this._quad.render(r); }
    r.setRenderTarget(prev);
  }

  /* ------------------------------------------------------------- materials */

  _buildMaterials() {
    const V2 = () => new THREE.Vector2();
    this._materials = [];
    const keep = (m) => { this._materials.push(m); return m; };

    this._mSeed = keep(fsMaterial(
      'uniform float uValue; void main() { gl_FragColor = vec4( uValue ); }',
      { uValue: { value: 0.0 } },
    ));

    this._mTaa = keep(fsMaterial(TAA_FRAG, {
      tCurrent: { value: null },
      tHistory: { value: null },
      tDepth: { value: null },
      uTexel: { value: V2() },
      uJitterPx: { value: V2() },
      uProj: { value: V2() },
      uPrevProj: { value: V2() },
      uReproj: { value: new THREE.Matrix4() },
      uLogFar: { value: 1 },
      uNearFar: { value: V2() },
      uFeedback: { value: 0.94 },
      uClampGamma: { value: 1.25 },
      uFilter: { value: 1.4 },
      uSharpen: { value: 0.0 },
      uReset: { value: 1 },
    }));

    this._mLumSeed = keep(fsMaterial(LUM_SEED_FRAG, {
      tSource: { value: null },
      uTexel: { value: V2() },
      uRef: { value: 0.1 },
    }));
    this._mReduce = keep(fsMaterial(REDUCE_FRAG, {
      tSource: { value: null },
      uTexel: { value: V2() },
    }));
    this._mAdapt = keep(fsMaterial(ADAPT_FRAG, {
      tSource: { value: null },
      tPrev: { value: null },
      uRate: { value: new THREE.Vector2(1.35, 0.5) },
      uDt: { value: 0.016 },
    }));

    this._mPrefilter = keep(fsMaterial(PREFILTER_FRAG, {
      tSource: { value: null },
      tGlow: { value: this._black },
      tDepth: { value: null },
      uTexel: { value: V2() },
      uThreshold: { value: 2.8 },
      uSkyThreshold: { value: 0.45 },
      uGlowThreshold: { value: 0.6 },
      uSoftness: { value: 0.55 },
      uClamp: { value: 48 },
    }));
    this._mDown = keep(fsMaterial(DOWN_FRAG, {
      tSource: { value: null },
      uTexel: { value: V2() },
    }));
    this._mUp = keep(fsMaterial(UP_FRAG, {
      tSource: { value: null },
      tPrevMip: { value: null },
      uTexel: { value: V2() },
      uScatter: { value: 0.62 },
    }));

    this._mStreakSeed = keep(fsMaterial(STREAK_SEED_FRAG, {
      tSource: { value: null },
      uTexel: { value: V2() },
      uThreshold: { value: 3.2 },
    }));
    this._mStreak = keep(fsMaterial(STREAK_FRAG, {
      tSource: { value: null },
      uTexel: { value: V2() },
      uStride: { value: 1 },
      uAtten: { value: 0.94 },
    }));

    this._mFocus = keep(fsMaterial(FOCUS_FRAG, {
      tDepth: { value: null },
      tPrev: { value: null },
      uLogFar: { value: 1 },
      uNearFar: { value: V2() },
      uDt: { value: 0.016 },
      uRate: { value: 2.4 },
      uManual: { value: 1200 },
      uAuto: { value: 1 },
    }));
    this._mDof = keep(fsMaterial(DOF_FRAG, {
      tSource: { value: null },
      tDepth: { value: null },
      tFocus: { value: null },
      uTexel: { value: V2() },
      uLogFar: { value: 1 },
      uNearFar: { value: V2() },
      uRange: { value: 9000 },
      uRadius: { value: 4 },
    }));

    this._mComposite = keep(fsMaterial(COMPOSITE_FRAG, {
      tScene: { value: null },
      tBloom: { value: this._black },
      tStreak: { value: this._black },
      tDof: { value: this._black },
      tDepth: { value: null },
      tExposure: { value: null },
      tFocus: { value: null },
      uTexel: { value: V2() },
      uResolution: { value: V2() },
      uTime: { value: 0 },
      uBloomStrength: { value: 0.5 },
      uStreakStrength: { value: 0.05 },
      uStreakTint: { value: new THREE.Vector3(0.55, 0.72, 1.0) },
      uExposureComp: { value: 1 },
      uExposureRef: { value: 0.1 },
      uAdaptStrength: { value: 0.5 },
      uExposureRange: { value: new THREE.Vector2(0.6, 2.4) },
      uVignette: { value: 0.2 },
      uAberration: { value: 0.55 },
      uGrain: { value: 0.026 },
      uContrast: { value: 0.07 },
      uSaturation: { value: 1.02 },
      uShadowLift: { value: 0.004 },
      uSplitTone: { value: 0.09 },
      uHighlightRolloff: { value: 0.35 },
      uShadowTint: { value: new THREE.Vector3(0.36, 0.52, 0.85) },
      uHighlightTint: { value: new THREE.Vector3(1.0, 0.86, 0.66) },
      uDofStrength: { value: 0 },
      uDofRange: { value: 9000 },
      uLogFar: { value: 1 },
      uNearFar: { value: V2() },
      uSplit: { value: -1 },
    }));

    this._scopeNames = ['total', 'scene', 'taa', 'exposure', 'bloom', 'streak', 'dof', 'composite', 'smaa'];
    this._syncDefines();
  }

  _syncDefines() {
    const log = this.renderer.capabilities.logarithmicDepthBuffer ? 1 : 0;
    const set = (m, key, on) => {
      const has = m.defines[key] !== undefined;
      if (on && !has) { m.defines[key] = ''; m.needsUpdate = true; }
      else if (!on && has) { delete m.defines[key]; m.needsUpdate = true; }
    };
    for (const m of [this._mTaa, this._mDof, this._mFocus, this._mComposite]) set(m, 'LOG_DEPTH', log);
    set(this._mPrefilter, 'LOG_DEPTH', log);
    set(this._mPrefilter, 'USE_GLOW_LAYER', this._useGlow);
    set(this._mPrefilter, 'GLOW_LAYER_ONLY', this._glowMode === 'layer' && this._useGlow);
    set(this._mComposite, 'USE_BLOOM', this.tier.bloom);
    set(this._mComposite, 'USE_STREAK', this.tier.bloom && this.tier.streak);
    set(this._mComposite, 'USE_DOF', this.tier.dof);
    set(this._mComposite, 'USE_GRAIN', this.tier.grain);
    set(this._mComposite, 'USE_ABERRATION', this.tier.aberration);
    set(this._mComposite, 'USE_VIGNETTE', this.tier.vignette);
    set(this._mComposite, 'USE_GRADE', this.tier.grade);
    set(this._mComposite, 'USE_SPLIT', this._split >= 0);
  }

  /* ----------------------------------------------------------------- draws */

  _blit(material, target) {
    this._quad.material = material;
    this.renderer.setRenderTarget(target);
    this._quad.render(this.renderer);
  }

  /* Both scenes, backdrop first, depth cleared between, then the glow-layer
     pass. The glow pass runs while the jitter is still applied so it depth-
     tests against the depth buffer that was just written; restoring first
     would offset it by a sub-pixel and rim the plumes. */
  _drawScenes() {
    const e = this.engine;
    const r = this.renderer;
    const jittered = this.tier.taa;

    r.setRenderTarget(this._rtScene);

    if (!jittered) {
      this._jitter.set(0, 0);
      e.renderScenes();
    } else {
      const h = HALTON[this._frame % HALTON.length];
      const ox = (h[0] - 0.5) * 2.0 / this._w;
      const oy = (h[1] - 0.5) * 2.0 / this._h;
      this._jitter.set(ox, oy);

      this._savedProj.copy(e.camera.projectionMatrix);
      e.syncFarCamera();
      e.camera.projectionMatrix.elements[8] += ox;
      e.camera.projectionMatrix.elements[9] += oy;
      e.camera.projectionMatrixInverse.copy(e.camera.projectionMatrix).invert();
      e.farCamera.projectionMatrix.elements[8] += ox;
      e.farCamera.projectionMatrix.elements[9] += oy;

      r.clear(true, true, true);
      r.render(e.farScene, e.farCamera);
      r.clearDepth();
      r.render(e.scene, e.camera);
    }

    if (this._rtGlow) {
      const mask = e.camera.layers.mask;
      const depthBuf = r.state.buffers.depth;
      e.camera.layers.set(LAYER.GLOW);
      r.setRenderTarget(this._rtGlow);

      /* Colour only — the depth attachment here is the *scene's* depth texture,
         shared so the glow layer is occluded by the hull in front of it. That
         sharing means a single LAYER.GLOW material with depthWrite:true would
         silently corrupt the buffer that TAA, DoF and the bloom prefilter all
         read afterwards. FX currently sets depthWrite:false everywhere on this
         layer, but MAT and SHIPS are now adding emissive hull details to it as
         well, so relying on that convention is not good enough. Locking the
         depth mask off makes it impossible for any material to write, whatever
         it asks for. */
      depthBuf.setMask(false);
      depthBuf.setLocked(true);
      r.clear(true, false, false);
      r.render(e.scene, e.camera);
      depthBuf.setLocked(false);
      depthBuf.setMask(true);

      e.camera.layers.mask = mask;
    }

    if (jittered) {
      e.camera.projectionMatrix.copy(this._savedProj);
      e.camera.projectionMatrixInverse.copy(this._savedProj).invert();
      e.farCamera.updateProjectionMatrix();
    }
  }

  _resolveTaa() {
    const e = this.engine;
    const u = this._mTaa.uniforms;
    const prev = this._rtTaa[this._taaIndex];
    const next = this._rtTaa[1 - this._taaIndex];
    const px = e.camera.projectionMatrix.elements[0];
    const py = e.camera.projectionMatrix.elements[5];

    /* One matrix, composed on the CPU in double precision. Going via world
       space in the shader would build a float32 position of order 1e5 metres
       before subtracting the camera again, and the cancellation eats the
       sub-pixel accuracy the whole pass depends on. */
    this._reproj.multiplyMatrices(this._prevView, e.camera.matrixWorld);

    u.tCurrent.value = this._rtScene.texture;
    u.tHistory.value = prev.texture;
    u.tDepth.value = this._rtScene.depthTexture;
    u.uTexel.value.set(1 / this._w, 1 / this._h);
    // Jitter in pixels, for the reconstruction filter weight (see TAA_FRAG).
    u.uJitterPx.value.set(this._jitter.x * this._w * 0.5, this._jitter.y * this._h * 0.5);
    u.uProj.value.set(px, py);
    if (this._historyValid) u.uPrevProj.value.copy(this._prevProj);
    else u.uPrevProj.value.set(px, py);
    u.uReproj.value.copy(this._reproj);
    u.uLogFar.value = Math.log2(e.camera.far + 1);
    u.uNearFar.value.set(e.camera.near, e.camera.far);
    u.uFeedback.value = this.params.taaFeedback;
    u.uClampGamma.value = this.params.taaClampGamma;
    u.uFilter.value = this.params.taaFilter;
    u.uSharpen.value = this.tier.taaSharpen;
    u.uReset.value = this._historyValid ? 0 : 1;

    this._blit(this._mTaa, next);
    this._taaIndex = 1 - this._taaIndex;
    this._prevProj.set(px, py);
    return next;
  }

  _updateExposure(src, dt) {
    const u = this._mLumSeed.uniforms;
    u.tSource.value = src.texture;
    u.uTexel.value.set(1 / this._w, 1 / this._h);
    u.uRef.value = this.params.exposureRef;
    this._blit(this._mLumSeed, this._rtLum[0]);

    for (let i = 1; i < this._rtLum.length; i++) {
      const from = this._rtLum[i - 1];
      this._mReduce.uniforms.tSource.value = from.texture;
      this._mReduce.uniforms.uTexel.value.set(1 / from.width, 1 / from.height);
      this._blit(this._mReduce, this._rtLum[i]);
    }
    const last = this._rtLum[this._rtLum.length - 1];

    const prev = this._rtExp[this._expIndex];
    const next = this._rtExp[1 - this._expIndex];
    const a = this._mAdapt.uniforms;
    a.tSource.value = last.texture;
    a.tPrev.value = prev.texture;
    a.uRate.value.set(this.params.exposureUpRate, this.params.exposureDownRate);
    a.uDt.value = Math.min(dt, 0.1);
    this._blit(this._mAdapt, next);
    this._expIndex = 1 - this._expIndex;
  }

  get _exposureTex() {
    return this._rtExp[this._expIndex].texture;
  }

  _applyExposure(u) {
    const p = this.params;
    u.uExposureComp.value = p.exposureComp;
    u.uExposureRef.value = p.exposureRef;
    u.uAdaptStrength.value = this.tier.exposure ? p.adaptStrength : 0;
    u.uExposureRange.value.set(p.exposureMin, p.exposureMax);
  }

  _renderBloom(src) {
    const p = this.params;
    const pre = this._mPrefilter.uniforms;
    pre.tSource.value = src.texture;
    pre.tGlow.value = this._rtGlow ? this._rtGlow.texture : this._black;
    pre.tDepth.value = this._rtScene.depthTexture;
    pre.uTexel.value.set(1 / this._w, 1 / this._h);
    pre.uThreshold.value = p.bloomThreshold;
    pre.uSkyThreshold.value = p.bloomThresholdSky;
    pre.uGlowThreshold.value = p.bloomThresholdGlow;
    pre.uSoftness.value = p.bloomSoftness;
    pre.uClamp.value = p.bloomClamp;
    this._blit(this._mPrefilter, this._rtDown[0]);

    for (let i = 1; i < this._mips; i++) {
      const from = this._rtDown[i - 1];
      this._mDown.uniforms.tSource.value = from.texture;
      this._mDown.uniforms.uTexel.value.set(1 / from.width, 1 / from.height);
      this._blit(this._mDown, this._rtDown[i]);
    }

    for (let i = this._mips - 2; i >= 0; i--) {
      const smaller = i === this._mips - 2 ? this._rtDown[i + 1] : this._rtUp[i + 1];
      this._mUp.uniforms.tSource.value = smaller.texture;
      this._mUp.uniforms.tPrevMip.value = this._rtDown[i].texture;
      this._mUp.uniforms.uTexel.value.set(1 / smaller.width, 1 / smaller.height);
      this._mUp.uniforms.uScatter.value = p.bloomScatter;
      this._blit(this._mUp, this._rtUp[i]);
    }
    this._bloomTex = (this._mips > 1 ? this._rtUp[0] : this._rtDown[0]).texture;
  }

  _renderStreak() {
    const p = this.params;
    const src = this._mips > 2 ? this._rtUp[1] : this._rtDown[Math.min(1, this._mips - 1)];
    const s0 = this._rtStreak[0];
    const s1 = this._rtStreak[1];

    this._mStreakSeed.uniforms.tSource.value = src.texture;
    this._mStreakSeed.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
    this._mStreakSeed.uniforms.uThreshold.value = p.streakThreshold;
    this._blit(this._mStreakSeed, s0);

    const u = this._mStreak.uniforms;
    u.uTexel.value.set(1 / s0.width, 1 / s0.height);
    u.uAtten.value = p.streakAtten;
    let from = s0;
    let to = s1;
    for (let i = 0; i < 3; i++) {
      u.tSource.value = from.texture;
      u.uStride.value = Math.pow(7, i) * p.streakLength;
      this._blit(this._mStreak, to);
      const swap = from;
      from = to;
      to = swap;
    }
    this._streakTex = from.texture;
  }

  _renderDof(src, dt) {
    const e = this.engine;
    const p = this.params;
    const logFar = Math.log2(e.camera.far + 1);

    const prevF = this._rtFocus[this._focusIndex];
    const nextF = this._rtFocus[1 - this._focusIndex];
    const f = this._mFocus.uniforms;
    f.tDepth.value = this._rtScene.depthTexture;
    f.tPrev.value = prevF.texture;
    f.uLogFar.value = logFar;
    f.uNearFar.value.set(e.camera.near, e.camera.far);
    f.uDt.value = Math.min(dt, 0.1);
    f.uRate.value = p.focusRate;
    f.uManual.value = p.focusDistance;
    f.uAuto.value = p.autoFocus ? 1 : 0;
    this._blit(this._mFocus, nextF);
    this._focusIndex = 1 - this._focusIndex;

    const d = this._mDof.uniforms;
    d.tSource.value = src.texture;
    d.tDepth.value = this._rtScene.depthTexture;
    d.tFocus.value = this._rtFocus[this._focusIndex].texture;
    d.uTexel.value.set(2 / this._w, 2 / this._h);
    d.uLogFar.value = logFar;
    d.uNearFar.value.set(e.camera.near, e.camera.far);
    d.uRange.value = p.dofRange;
    d.uRadius.value = p.dofMaxRadius;
    this._blit(this._mDof, this._rtDof);
  }

  _composite(src, elapsed) {
    const e = this.engine;
    const p = this.params;
    const u = this._mComposite.uniforms;
    const dofOn = this.tier.dof && p.dofStrength > 0.001;

    u.tScene.value = src.texture;
    u.tBloom.value = this.tier.bloom ? (this._bloomTex || this._black) : this._black;
    u.tStreak.value = this.tier.bloom && this.tier.streak ? (this._streakTex || this._black) : this._black;
    u.tDof.value = dofOn ? this._rtDof.texture : this._black;
    u.tDepth.value = this._rtScene.depthTexture;
    u.tExposure.value = this._exposureTex;
    u.tFocus.value = this._rtFocus[this._focusIndex].texture;
    u.uTexel.value.set(1 / this._w, 1 / this._h);
    u.uResolution.value.set(this._w, this._h);
    u.uTime.value = elapsed;
    u.uBloomStrength.value = this.tier.bloom ? p.bloomStrength : 0;
    u.uStreakStrength.value = this.tier.streak ? p.streakStrength : 0;
    u.uStreakTint.value.set(p.streakTint.r, p.streakTint.g, p.streakTint.b);
    this._applyExposure(u);
    u.uVignette.value = p.vignette;
    u.uAberration.value = p.aberration;
    u.uGrain.value = p.grain;
    u.uContrast.value = p.contrast;
    u.uSaturation.value = p.saturation;
    u.uShadowLift.value = p.shadowLift;
    u.uSplitTone.value = p.splitTone;
    u.uHighlightRolloff.value = p.highlightRolloff;
    u.uShadowTint.value.set(p.shadowTint.r, p.shadowTint.g, p.shadowTint.b);
    u.uHighlightTint.value.set(p.highlightTint.r, p.highlightTint.g, p.highlightTint.b);
    u.uDofStrength.value = dofOn ? p.dofStrength : 0;
    u.uDofRange.value = p.dofRange;
    u.uLogFar.value = Math.log2(e.camera.far + 1);
    u.uNearFar.value.set(e.camera.near, e.camera.far);
    u.uSplit.value = this._split;

    this._blit(this._mComposite, this.tier.smaa ? this._rtLdr : null);
  }

  _storeHistory() {
    this._prevView.copy(this.engine.camera.matrixWorldInverse);
    this._historyValid = true;
  }
}

/* ============================================================== shaders === */

const TAA_FRAG = `
${COMMON}
${DEPTH_GLSL}
uniform sampler2D tCurrent;
uniform sampler2D tHistory;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uJitterPx;
uniform vec2 uProj;
uniform vec2 uPrevProj;
uniform mat4 uReproj;
uniform float uFeedback;
uniform float uClampGamma;
uniform float uFilter;
uniform float uSharpen;
uniform float uReset;
varying vec2 vUv;

/* Catmull-Rom history fetch. Bilinear history is what makes naive TAA look
   like vaseline after a second of motion. */
vec3 sampleHistory( vec2 uv ) {
  vec2 res = 1.0 / uTexel;
  vec2 samplePos = uv * res;
  vec2 tc1 = floor( samplePos - 0.5 ) + 0.5;
  vec2 f = samplePos - tc1;
  vec2 w0 = f * ( -0.5 + f * ( 1.0 - 0.5 * f ) );
  vec2 w1 = 1.0 + f * f * ( -2.5 + 1.5 * f );
  vec2 w2 = f * ( 0.5 + f * ( 2.0 - 1.5 * f ) );
  vec2 w3 = f * f * ( -0.5 + 0.5 * f );
  vec2 w12 = w1 + w2;
  vec2 tc0 = ( tc1 - 1.0 ) * uTexel;
  vec2 tc3 = ( tc1 + 2.0 ) * uTexel;
  vec2 tc12 = ( tc1 + w2 / w12 ) * uTexel;
  vec3 c =
      texture2D( tHistory, vec2( tc12.x, tc0.y ) ).rgb * ( w12.x * w0.y )
    + texture2D( tHistory, vec2( tc0.x, tc12.y ) ).rgb * ( w0.x * w12.y )
    + texture2D( tHistory, vec2( tc12.x, tc12.y ) ).rgb * ( w12.x * w12.y )
    + texture2D( tHistory, vec2( tc3.x, tc12.y ) ).rgb * ( w3.x * w12.y )
    + texture2D( tHistory, vec2( tc12.x, tc3.y ) ).rgb * ( w12.x * w3.y );
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max( c / wsum, vec3( 0.0 ) );
}

void main() {
  vec3 cur = texture2D( tCurrent, vUv ).rgb;

  /* 3x3 neighbourhood in YCoCg. Variance clipping (mean +/- gamma * sigma)
     beats a raw min/max box: the box is dominated by one hot pixel and lets
     ghosts through, the variance AABB tracks what the pixel actually is. */
  vec3 m1 = vec3( 0.0 );
  vec3 m2 = vec3( 0.0 );
  vec3 nmin = vec3( 1e9 );
  vec3 nmax = vec3( -1e9 );
  for ( int y = -1; y <= 1; y++ ) {
    for ( int x = -1; x <= 1; x++ ) {
      vec3 s = rgb2ycocg( texture2D( tCurrent, vUv + vec2( float( x ), float( y ) ) * uTexel ).rgb );
      m1 += s;
      m2 += s * s;
      nmin = min( nmin, s );
      nmax = max( nmax, s );
    }
  }
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt( max( m2 / 9.0 - mean * mean, vec3( 0.0 ) ) );
  /* Union of the raw box and the statistical range, not the intersection.
     Intersecting is the textbook version and it is wrong for star fields: an
     isolated bright texel makes the mean low and sigma modest, so the box
     excludes the converged value of the star's own pixel, the history is
     clipped every frame, and TAA degenerates into displaying the jittered
     frame — measurably worse than no AA at all. */
  vec3 lo = min( mean - uClampGamma * sigma, nmin );
  vec3 hi = max( mean + uClampGamma * sigma, nmax );

  /* Reproject from the *pixel centre*, not from the jittered sample position.
     The history buffer is a resolved image: texel n holds the converged colour
     of pixel n, indexed by pixel centre. Building the ray from the jittered
     NDC instead lands prevUv half a pixel off, every frame, in a direction
     that walks around the Halton sequence — the Catmull-Rom fetch then keeps
     resampling a moving target, the history drifts outside the neighbourhood
     box and gets clipped. Measured before this was fixed: 21-32% of the frame
     clipped per frame with a *static* camera, and ~0.45 px of phantom motion.
     Both go to ~0 with the jitter term removed. */
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 dirView = vec3( ndc.x / uProj.x, ndc.y / uProj.y, -1.0 );

  // Background pixels (depth cleared to 1.0 between the two scenes) are
  // infinitely far, so a direction-only transform is exact there — which is
  // precisely what keeps the star field from crawling as the camera orbits.
  float d = texture2D( tDepth, vUv ).x;
  vec4 pv = d >= 0.999999
    ? uReproj * vec4( dirView, 0.0 )
    : uReproj * vec4( dirView * linearDepth( d ), 1.0 );

  float pw = -pv.z;
  vec2 prevUv = vUv;
  float valid = 0.0;
  if ( pw > 1e-6 ) {
    prevUv = vec2( uPrevProj.x * pv.x, uPrevProj.y * pv.y ) / pw * 0.5 + 0.5;
    valid = step( 0.0, prevUv.x ) * step( prevUv.x, 1.0 ) * step( 0.0, prevUv.y ) * step( prevUv.y, 1.0 );
  }

  vec3 hist = sampleHistory( prevUv );
  vec3 histY = rgb2ycocg( hist );

  // Clip toward the neighbourhood centre rather than clamping per channel:
  // clamping shifts hue on strongly coloured plumes.
  vec3 centre = 0.5 * ( lo + hi );
  vec3 extent = max( 0.5 * ( hi - lo ), vec3( 1e-5 ) );
  vec3 offset = histY - centre;
  vec3 unit = abs( offset / extent );
  float maxUnit = max( unit.x, max( unit.y, unit.z ) );
  if ( maxUnit > 1.0 ) histY = centre + offset / maxUnit;
  hist = ycocg2rgb( histY );

  // Speed-aware feedback: a fast pan gets a shorter history so trails cannot
  // form behind an interceptor crossing the frame.
  vec2 velPx = ( vUv - prevUv ) / uTexel;
  float speed = clamp( length( velPx ) / 24.0, 0.0, 1.0 );
  float feedback = mix( uFeedback, 0.72, speed ) * valid * ( 1.0 - uReset );

  // Luminance weighting kills fireflies: a single 200x sample cannot dominate
  // the running average.
  float wc = 1.0 / ( 1.0 + luma( cur ) );
  float wh = 1.0 / ( 1.0 + luma( hist ) );

  /* Reconstruction filter weight. Accumulating jittered samples with equal
     weight reconstructs a *box* over the pixel, and a box is a poor filter —
     it is why untuned TAA reads as mush. Weighting each incoming sample by a
     Gaussian on its distance from the pixel centre concentrates the estimate
     where it belongs and buys back most of the sharpness for free. Measured:
     mean |laplacian| goes 1.20 -> 1.93 with no cost in temporal stability,
     against 2.92 for the aliased no-AA image. */
  float filt = exp( -uFilter * dot( uJitterPx, uJitterPx ) );

  float a = ( 1.0 - feedback ) * wc * filt;
  float b = feedback * wh;
  vec3 outc = ( cur * a + hist * b ) / max( a + b, 1e-6 );

  /* Resolve sharpening. Kept very low on purpose: this is an unsharp mask
     against the *jittered* current frame, so every unit of it injects that
     frame's jitter pattern into the output — and into the next frame's
     history. At 0.28 it measurably tripled the number of pixels that moved by
     more than 12/255 between frames (0.011% -> 0.125%), i.e. it manufactured
     exactly the star crawl this pass exists to remove. */
  if ( uSharpen > 0.0 ) {
    vec3 blur = (
      texture2D( tCurrent, vUv + vec2( uTexel.x, 0.0 ) ).rgb +
      texture2D( tCurrent, vUv - vec2( uTexel.x, 0.0 ) ).rgb +
      texture2D( tCurrent, vUv + vec2( 0.0, uTexel.y ) ).rgb +
      texture2D( tCurrent, vUv - vec2( 0.0, uTexel.y ) ).rgb ) * 0.25;
    outc += ( cur - blur ) * uSharpen * ( 1.0 - speed );
  }

  gl_FragColor = vec4( max( outc, vec3( 0.0 ) ), 1.0 );
}
`;

const LUM_SEED_FRAG = `
${COMMON}
uniform sampler2D tSource;
uniform vec2 uTexel;
uniform float uRef;
varying vec2 vUv;
void main() {
  /* Log luminance: the reduction chain then produces a geometric mean, which
     shrugs off a detonating capital ship instead of stopping down two stops.
     Centre-weighted, and off-centre samples decay toward the reference rather
     than toward zero — otherwise the empty edges of frame drag the mean into
     the floor and the meter opens all the way up. */
  vec3 c = vec3( 0.0 );
  c += texture2D( tSource, vUv + vec2( -1.0, -1.0 ) * uTexel * 24.0 ).rgb;
  c += texture2D( tSource, vUv + vec2(  1.0, -1.0 ) * uTexel * 24.0 ).rgb;
  c += texture2D( tSource, vUv + vec2( -1.0,  1.0 ) * uTexel * 24.0 ).rgb;
  c += texture2D( tSource, vUv + vec2(  1.0,  1.0 ) * uTexel * 24.0 ).rgb;
  float l = clamp( luma( c * 0.25 ), 0.012, 40.0 );
  vec2 d = vUv - 0.5;
  float w = mix( 0.15, 1.0, exp( -3.0 * dot( d, d ) * 4.0 ) );
  l = mix( uRef, l, w );
  gl_FragColor = vec4( vec3( log2( max( l, 1e-4 ) ) ), 1.0 );
}
`;

const REDUCE_FRAG = `
uniform sampler2D tSource;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  // Four bilinear taps = a 4x4 box, so each pass reduces by 4 in both axes.
  vec4 s = texture2D( tSource, vUv + vec2( -1.0, -1.0 ) * uTexel )
         + texture2D( tSource, vUv + vec2(  1.0, -1.0 ) * uTexel )
         + texture2D( tSource, vUv + vec2( -1.0,  1.0 ) * uTexel )
         + texture2D( tSource, vUv + vec2(  1.0,  1.0 ) * uTexel );
  gl_FragColor = s * 0.25;
}
`;

const ADAPT_FRAG = `
uniform sampler2D tSource;
uniform sampler2D tPrev;
uniform vec2 uRate;
uniform float uDt;
varying vec2 vUv;
void main() {
  float target = exp2( texture2D( tSource, vec2( 0.5 ) ).r );
  float prev = max( texture2D( tPrev, vec2( 0.5 ) ).r, 1e-5 );
  // Dark adaptation is deliberately slower than bright adaptation, as in an eye.
  float rate = target > prev ? uRate.x : uRate.y;
  float k = 1.0 - exp( -uDt * rate );
  gl_FragColor = vec4( vec3( prev + ( target - prev ) * k ), 1.0 );
}
`;

const PREFILTER_FRAG = `
${COMMON}
${DEPTH_GLSL}
uniform sampler2D tSource;
uniform sampler2D tGlow;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uSkyThreshold;
uniform float uGlowThreshold;
uniform float uSoftness;
uniform float uClamp;
varying vec2 vUv;

/* Karis average: weight each tap by 1/(1+luma) before averaging so a lone
   firefly pixel cannot seed a full-strength bloom blob. */
vec3 karis( vec3 a, vec3 b, vec3 c, vec3 d ) {
  float wa = 1.0 / ( 1.0 + luma( a ) );
  float wb = 1.0 / ( 1.0 + luma( b ) );
  float wc = 1.0 / ( 1.0 + luma( c ) );
  float wd = 1.0 / ( 1.0 + luma( d ) );
  return ( a * wa + b * wb + c * wc + d * wd ) / ( wa + wb + wc + wd );
}

void main() {
  vec2 t = uTexel;
  vec2 o0 = vec2( -1.0, -1.0 ) * t;
  vec2 o1 = vec2(  1.0, -1.0 ) * t;
  vec2 o2 = vec2( -1.0,  1.0 ) * t;
  vec2 o3 = vec2(  1.0,  1.0 ) * t;

  vec3 result = vec3( 0.0 );

  #ifndef GLOW_LAYER_ONLY
    vec3 c = karis(
      texture2D( tSource, vUv + o0 ).rgb,
      texture2D( tSource, vUv + o1 ).rgb,
      texture2D( tSource, vUv + o2 ).rgb,
      texture2D( tSource, vUv + o3 ).rgb );

    /* Two cut points, selected by depth. The backdrop is everything the far
       scene drew before the depth clear, so it still reads exactly 1.0: star
       cores and nebula hot spots live there and are dim in absolute terms, so
       they need a low cut to bloom at all. Hull surfaces are never at 1.0 and
       get a cut deliberately parked above the measured hull ceiling, which is
       what makes §3.6 structural rather than a lucky tuning. Taking the max of
       all four taps' depths means a hull silhouette can never be mistaken for
       sky along its own edge. */
    float dm = max(
      max( texture2D( tDepth, vUv + o0 ).x, texture2D( tDepth, vUv + o1 ).x ),
      max( texture2D( tDepth, vUv + o2 ).x, texture2D( tDepth, vUv + o3 ).x ) );
    float dn = min(
      min( texture2D( tDepth, vUv + o0 ).x, texture2D( tDepth, vUv + o1 ).x ),
      min( texture2D( tDepth, vUv + o2 ).x, texture2D( tDepth, vUv + o3 ).x ) );
    float sky = step( 0.999999, dn ) * step( 0.999999, dm );
    float thr = mix( uThreshold, uSkyThreshold, sky );

    result = c * kneeCut( maxc( c ), thr, uSoftness );
  #endif

  #ifdef USE_GLOW_LAYER
    /* The authored-emissive path. FX tag every plume, beam, muzzle flash and
       explosion sprite with LAYER.GLOW, and this pass is depth-tested against
       the scene, so it blooms exactly what the VFX system says should glow —
       independent of how bright that system decides to run. Union rather than
       sum: the same energy is already in tSource, and adding it twice is how
       a bloom stops conserving energy the moment 40 beams fire at once. */
    vec3 g = karis(
      texture2D( tGlow, vUv + o0 ).rgb,
      texture2D( tGlow, vUv + o1 ).rgb,
      texture2D( tGlow, vUv + o2 ).rgb,
      texture2D( tGlow, vUv + o3 ).rgb );
    result = max( result, g * kneeCut( maxc( g ), uGlowThreshold, uSoftness ) );
  #endif

  // Absolute ceiling. A single NaN or a 500x explosion texel would otherwise
  // propagate through every mip and fog the whole frame white.
  float m = maxc( result );
  if ( m > uClamp ) result *= uClamp / m;
  gl_FragColor = vec4( max( result, vec3( 0.0 ) ), 1.0 );
}
`;

const DOWN_FRAG = `
uniform sampler2D tSource;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  // Call of Duty 13-tap downsample: four inner quads plus a centre box, which
  // is stable under motion where a plain box filter pulses.
  vec2 t = uTexel;
  vec3 a = texture2D( tSource, vUv + vec2( -2.0, -2.0 ) * t ).rgb;
  vec3 b = texture2D( tSource, vUv + vec2(  0.0, -2.0 ) * t ).rgb;
  vec3 c = texture2D( tSource, vUv + vec2(  2.0, -2.0 ) * t ).rgb;
  vec3 d = texture2D( tSource, vUv + vec2( -1.0, -1.0 ) * t ).rgb;
  vec3 e = texture2D( tSource, vUv + vec2(  1.0, -1.0 ) * t ).rgb;
  vec3 f = texture2D( tSource, vUv + vec2( -2.0,  0.0 ) * t ).rgb;
  vec3 g = texture2D( tSource, vUv ).rgb;
  vec3 h = texture2D( tSource, vUv + vec2(  2.0,  0.0 ) * t ).rgb;
  vec3 i = texture2D( tSource, vUv + vec2( -1.0,  1.0 ) * t ).rgb;
  vec3 j = texture2D( tSource, vUv + vec2(  1.0,  1.0 ) * t ).rgb;
  vec3 k = texture2D( tSource, vUv + vec2( -2.0,  2.0 ) * t ).rgb;
  vec3 l = texture2D( tSource, vUv + vec2(  0.0,  2.0 ) * t ).rgb;
  vec3 m = texture2D( tSource, vUv + vec2(  2.0,  2.0 ) * t ).rgb;
  vec3 o = ( d + e + i + j ) * 0.125;
  o += ( a + b + g + f ) * 0.03125;
  o += ( b + c + h + g ) * 0.03125;
  o += ( f + g + l + k ) * 0.03125;
  o += ( g + h + m + l ) * 0.03125;
  gl_FragColor = vec4( o, 1.0 );
}
`;

const UP_FRAG = `
uniform sampler2D tSource;
uniform sampler2D tPrevMip;
uniform vec2 uTexel;
uniform float uScatter;
varying vec2 vUv;
void main() {
  // 3x3 tent upsample, then lerp against the matching down mip. The lerp is
  // what keeps this energy-conserving: the widest mip only ever contributes
  // scatter^levels of the result, so bloom cannot fog the whole frame.
  vec2 t = uTexel;
  vec3 s = texture2D( tSource, vUv + vec2( -1.0, -1.0 ) * t ).rgb * 1.0;
  s += texture2D( tSource, vUv + vec2(  0.0, -1.0 ) * t ).rgb * 2.0;
  s += texture2D( tSource, vUv + vec2(  1.0, -1.0 ) * t ).rgb * 1.0;
  s += texture2D( tSource, vUv + vec2( -1.0,  0.0 ) * t ).rgb * 2.0;
  s += texture2D( tSource, vUv ).rgb * 4.0;
  s += texture2D( tSource, vUv + vec2(  1.0,  0.0 ) * t ).rgb * 2.0;
  s += texture2D( tSource, vUv + vec2( -1.0,  1.0 ) * t ).rgb * 1.0;
  s += texture2D( tSource, vUv + vec2(  0.0,  1.0 ) * t ).rgb * 2.0;
  s += texture2D( tSource, vUv + vec2(  1.0,  1.0 ) * t ).rgb * 1.0;
  s /= 16.0;
  vec3 base = texture2D( tPrevMip, vUv ).rgb;
  gl_FragColor = vec4( mix( base, s, uScatter ), 1.0 );
}
`;

const STREAK_SEED_FRAG = `
${COMMON}
uniform sampler2D tSource;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D( tSource, vUv ).rgb;
  // Second, much higher cut: only genuine highlights get a lens streak.
  float br = maxc( c );
  float k = max( br - uThreshold, 0.0 ) / max( br, 1e-4 );
  gl_FragColor = vec4( c * k, 1.0 );
}
`;

const STREAK_FRAG = `
uniform sampler2D tSource;
uniform vec2 uTexel;
uniform float uStride;
uniform float uAtten;
varying vec2 vUv;
void main() {
  /* Kawase streak: three horizontal passes at strides 1, 7 and 49 with an
     exponential falloff. A plain two-pass Gaussian leaves visible gaps at the
     wide stride — the streak reads as a row of separate blobs, which is worse
     than no streak at all. Exponential weights tile cleanly at any stride. */
  vec3 acc = texture2D( tSource, vUv ).rgb;
  float wsum = 1.0;
  for ( int i = 1; i <= 3; i++ ) {
    float d = float( i ) * uStride;
    float w = pow( uAtten, d );
    float o = d * uTexel.x;
    acc += texture2D( tSource, vUv + vec2( o, 0.0 ) ).rgb * w;
    acc += texture2D( tSource, vUv - vec2( o, 0.0 ) ).rgb * w;
    wsum += w * 2.0;
  }
  gl_FragColor = vec4( acc / wsum, 1.0 );
}
`;

const FOCUS_FRAG = `
${DEPTH_GLSL}
uniform sampler2D tDepth;
uniform sampler2D tPrev;
uniform float uDt;
uniform float uRate;
uniform float uManual;
uniform float uAuto;
varying vec2 vUv;
void main() {
  // Focus pull off the centre of frame, eased in a 1x1 target. Sampling depth
  // here costs one texel; a CPU readback would cost a pipeline stall.
  float d = texture2D( tDepth, vec2( 0.5 ) ).x;
  float target = d >= 0.999999 ? 20000.0 : linearDepth( d );
  target = mix( uManual, target, uAuto );
  float prev = max( texture2D( tPrev, vec2( 0.5 ) ).r, 1.0 );
  float k = 1.0 - exp( -uDt * uRate );
  gl_FragColor = vec4( vec3( prev + ( target - prev ) * k ), 1.0 );
}
`;

/* Circle-of-confusion for the far field only, and never for the backdrop.
   Letting the sky blur would be doubly wrong: §3.5 makes the backdrop the
   subject of the shot, and it is the one part of frame with no parallax, so
   blurring it buys no depth cue and costs the star field its crispness. */
const COC_GLSL = `
float farCoc( float d, float focus, float range ) {
  if ( d >= 0.999999 ) return 0.0;
  return clamp( ( linearDepth( d ) - focus ) / range, 0.0, 1.0 );
}
`;

const DOF_FRAG = `
${DEPTH_GLSL}
${COC_GLSL}
uniform sampler2D tSource;
uniform sampler2D tDepth;
uniform sampler2D tFocus;
uniform vec2 uTexel;
uniform float uRange;
uniform float uRadius;
varying vec2 vUv;

const vec2 KERNEL[16] = vec2[16](
  vec2(  0.3252,  0.1548 ), vec2( -0.2160,  0.3585 ), vec2( -0.2312, -0.4235 ), vec2(  0.5245, -0.2814 ),
  vec2(  0.1170,  0.6534 ), vec2( -0.6612,  0.1497 ), vec2(  0.2996, -0.6753 ), vec2(  0.6702,  0.4059 ),
  vec2( -0.5460, -0.5936 ), vec2( -0.1046,  0.8624 ), vec2(  0.8608, -0.1305 ), vec2( -0.7900,  0.4644 ),
  vec2(  0.4004, -0.8641 ), vec2( -0.3213, -0.8749 ), vec2( -0.9265, -0.2555 ), vec2(  0.7554,  0.6260 )
);

void main() {
  float focus = max( texture2D( tFocus, vec2( 0.5 ) ).r, 1.0 );
  float cocC = farCoc( texture2D( tDepth, vUv ).x, focus, uRange );

  vec3 acc = texture2D( tSource, vUv ).rgb;
  float wsum = 1.0;
  for ( int i = 0; i < 16; i++ ) {
    vec2 off = KERNEL[i] * uRadius * cocC;
    vec2 uv = vUv + off * uTexel;
    float cocS = farCoc( texture2D( tDepth, uv ).x, focus, uRange );
    // Reject taps nearer than the centre, or a sharp foreground bleeds into
    // the blur and ships grow halos.
    float ok = step( cocC - 0.08, cocS );
    acc += texture2D( tSource, uv ).rgb * ok;
    wsum += ok;
  }
  gl_FragColor = vec4( acc / wsum, cocC );
}
`;

const COMPOSITE_FRAG = `
${COMMON}
${DEPTH_GLSL}
${COC_GLSL}
${EXPOSURE_GLSL}
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tStreak;
uniform sampler2D tDof;
uniform sampler2D tDepth;
uniform sampler2D tFocus;
uniform vec2 uTexel;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBloomStrength;
uniform float uStreakStrength;
uniform vec3 uStreakTint;
uniform float uVignette;
uniform float uAberration;
uniform float uGrain;
uniform float uContrast;
uniform float uSaturation;
uniform float uShadowLift;
uniform float uSplitTone;
uniform float uHighlightRolloff;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uDofStrength;
uniform float uDofRange;
uniform float uSplit;
varying vec2 vUv;

/* Normalise a tint to unit luminance. Everything the grade does with the
   nebula colours goes through this, so changing the key/fill can only ever
   rotate hue — it can never change the level of the image, and it can never
   put a cast on a neutral surface. That matters right now: the hulls are being
   re-authored because they read muddy, and a grade that quietly multiplies
   every highlight by a warm tint would make that impossible to judge. */
vec3 unitTint( vec3 c ) {
  return c / max( luma( c ), 1e-4 );
}

vec3 fetchScene( vec2 uv ) {
  #ifdef USE_ABERRATION
    // Transverse aberration only, scaled by r^2 so the centre of frame — where
    // the player is actually looking — is untouched.
    vec2 d = uv - 0.5;
    float r2 = dot( d, d );
    vec2 off = d * r2 * uAberration * 0.0016;
    return vec3(
      texture2D( tScene, uv + off ).r,
      texture2D( tScene, uv ).g,
      texture2D( tScene, uv - off ).b );
  #else
    return texture2D( tScene, uv ).rgb;
  #endif
}

void main() {
  vec3 scene = fetchScene( vUv );

  #ifdef USE_DOF
    if ( uDofStrength > 0.001 ) {
      float focus = max( texture2D( tFocus, vec2( 0.5 ) ).r, 1.0 );
      float coc = farCoc( texture2D( tDepth, vUv ).x, focus, uDofRange );
      coc = smoothstep( 0.0, 1.0, coc ) * uDofStrength;
      scene = mix( scene, texture2D( tDof, vUv ).rgb, coc );
    }
  #endif

  float exposure = sceneExposure();
  vec3 col = scene * exposure;
  vec3 plain = col;

  /* Bloom is thresholded scene-referred, so it has to be exposed here to stay
     in step with the image it is being added to. */
  #ifdef USE_BLOOM
    col += texture2D( tBloom, vUv ).rgb * uBloomStrength * exposure;
  #endif
  #ifdef USE_STREAK
    col += texture2D( tStreak, vUv ).rgb * uStreakTint * uStreakStrength * exposure;
  #endif

  #ifdef USE_VIGNETTE
    vec2 vd = ( vUv - 0.5 ) * vec2( uResolution.x / uResolution.y, 1.0 );
    float vig = 1.0 - uVignette * pow( clamp( length( vd ) / 0.72, 0.0, 1.0 ), 2.4 );
    col *= vig;
  #endif

  #ifdef USE_GRADE
    vec3 shadowN = unitTint( uShadowTint );
    vec3 highN = unitTint( uHighlightTint );
    float l = luma( col );

    /* Shadow lift tinted with the nebula fill: space is never truly black, and
       a flat 0,0,0 floor is the fastest way to look like a tech demo. The
       falloff is steep enough that anything at or above mid-grey receives
       essentially none of it. */
    col += shadowN * uShadowLift * exp( -l * 14.0 );

    /* Split tone, built so mid-grey is a fixed point. Both weights fall to
       zero at t = 0.5, so a neutral mid-grey card comes through the grade
       bit-for-bit neutral; only the deep shadows pick up the nebula fill and
       only the highlights pick up the key. Big split tone is the teal-and-
       orange trap, so this is deliberately a few percent. */
    float t = clamp( l * 1.6, 0.0, 1.0 );
    float wS = 1.0 - smoothstep( 0.0, 0.5, t );
    float wH = smoothstep( 0.5, 1.0, t );
    vec3 tone = vec3( 1.0 )
      + ( shadowN - 1.0 ) * ( wS * uSplitTone )
      + ( highN - 1.0 ) * ( wH * uSplitTone );
    col *= tone;

    /* Highlight roll-off. Real film loses saturation before it loses detail,
       so a bright ion beam should bleach toward white rather than clip to a
       flat slab of hue. Blending toward the max channel rather than toward
       luma keeps it a bleach and not a desaturation, and leaves any neutral
       value exactly where it was. */
    float m = maxc( col );
    col = mix( col, vec3( m ), smoothstep( 1.0, 6.0, m ) * uHighlightRolloff );
  #endif

  vec3 mapped = acesFitted( col );

  #ifdef USE_GRADE
    float ml = luma( mapped );
    mapped = mix( vec3( ml ), mapped, uSaturation );
    mapped = mix( mapped, mapped * mapped * ( 3.0 - 2.0 * mapped ), uContrast );
  #endif

  vec3 srgb = linearToSrgb( clamp( mapped, 0.0, 1.0 ) );

  #ifdef USE_GRAIN
    // Luminance-only: a multiplicative gain preserves hue, so grain reads as
    // film rather than as coloured noise. Strongest in the shadows.
    float n = hash13( vec3( gl_FragCoord.xy, floor( uTime * 24.0 ) ) ) - 0.5;
    float shade = luma( srgb );
    srgb *= 1.0 + n * uGrain * ( 0.25 + 0.75 * ( 1.0 - shade ) );
  #endif

  // Always-on ordered dither. Deep-space gradients band horribly at 8 bits and
  // this costs one instruction.
  float dith = ( ign( gl_FragCoord.xy + fract( uTime ) * 17.0 ) - 0.5 ) / 255.0;
  srgb += dith;

  #ifdef USE_SPLIT
    if ( uSplit >= 0.0 ) {
      vec3 raw = linearToSrgb( acesFitted( plain ) );
      float edge = step( vUv.x, uSplit );
      srgb = mix( srgb, raw, edge );
      float line = step( abs( vUv.x - uSplit ), uTexel.x );
      srgb = mix( srgb, vec3( 0.85 ), line );
    }
  #endif

  gl_FragColor = vec4( srgb, 1.0 );
}
`;

export default PostFX;
