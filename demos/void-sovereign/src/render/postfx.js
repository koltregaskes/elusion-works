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
     -> bloom            threshold is applied to *exposed* luminance, so the
                         cut point tracks adaptation instead of drifting when
                         the camera flies into a nebula.
     -> streak           anamorphic smear off the brightest bloom mip only.
     -> DoF              far-field only. Blurring the near field would smear
                         ships the player is trying to click.
     -> composite        grade, tone map, vignette, aberration, grain, dither.
     -> SMAA             spatial AA fallback, run on the tone-mapped LDR image
                         where its luma edge detection actually works.

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
    taa: false, smaa: true, bloom: true, bloomMips: 4, streak: false, dof: false,
    grain: false, aberration: false, vignette: true, exposure: true, grade: true,
    bloomScatter: 0.55, taaSharpen: 0.0,
  },
  medium: {
    taa: false, smaa: true, bloom: true, bloomMips: 5, streak: true, dof: false,
    grain: true, aberration: true, vignette: true, exposure: true, grade: true,
    bloomScatter: 0.58, taaSharpen: 0.0,
  },
  high: {
    taa: true, smaa: false, bloom: true, bloomMips: 6, streak: true, dof: true,
    grain: true, aberration: true, vignette: true, exposure: true, grade: true,
    bloomScatter: 0.62, taaSharpen: 0.35,
  },
  ultra: {
    taa: true, smaa: false, bloom: true, bloomMips: 7, streak: true, dof: true,
    grain: true, aberration: true, vignette: true, exposure: true, grade: true,
    bloomScatter: 0.66, taaSharpen: 0.5,
  },
};

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
    this._glowMode = 'threshold';
    this._split = -1;

    this._prevView = new THREE.Matrix4();
    this._savedProj = new THREE.Matrix4();
    this._jitter = new THREE.Vector2();

    // 1x1 black stand-in so samplers are never left unbound.
    this._black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this._black.needsUpdate = true;

    this.params = {
      bloomThreshold: 1.55,
      bloomSoftness: 0.55,
      bloomStrength: 0.62,
      bloomScatter: this.tier.bloomScatter,
      streakThreshold: 3.2,
      streakStrength: 0.055,
      streakLength: 1.0,
      streakAtten: 0.94,
      streakTint: new THREE.Color(0.55, 0.72, 1.0),
      exposureComp: 1.0,
      exposureRef: 0.1,
      adaptStrength: 0.5,
      exposureMin: 0.55,
      exposureMax: 2.1,
      exposureUpRate: 1.35,
      exposureDownRate: 0.5,
      vignette: 0.2,
      aberration: 0.55,
      grain: 0.028,
      contrast: 0.07,
      saturation: 1.02,
      shadowLift: 0.016,
      splitTone: 0.1,
      shadowTint: new THREE.Color(0.36, 0.52, 0.85),
      highlightTint: new THREE.Color(1.0, 0.86, 0.66),
      taaFeedback: 0.92,
      taaClampGamma: 1.15,
      dofStrength: 0.0,
      dofRange: 2600,
      dofMaxRadius: 5.0,
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

  setQuality(q) {
    if (!TIERS[q]) return;
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

  /** Lets the grade drift with the seeded nebula instead of a fixed teal. */
  setNebulaColours(key, fill) {
    if (key) this.params.highlightTint.set(key);
    if (fill) this.params.shadowTint.set(fill);
  }

  setFocus(opts) {
    this.setParams(opts || {});
  }

  /** 'threshold' | 'layer' | 'both'. 'layer' guarantees hulls cannot bloom but
      requires FX to tag emissive meshes with LAYER.GLOW. */
  setGlowMode(mode) {
    if (mode !== 'threshold' && mode !== 'layer' && mode !== 'both') return;
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
    kill(this._rtScene);
    kill(this._rtGlow);
    kill(this._rtLdr);
    if (this._rtTaa) for (const rt of this._rtTaa) kill(rt);
    if (this._rtDown) for (const rt of this._rtDown) kill(rt);
    if (this._rtUp) for (const rt of this._rtUp) kill(rt);
    if (this._rtStreak) for (const rt of this._rtStreak) kill(rt);
    if (this._rtLum) for (const rt of this._rtLum) kill(rt);
    if (this._rtExp) for (const rt of this._rtExp) kill(rt);
    if (this._rtFocus) for (const rt of this._rtFocus) kill(rt);
    kill(this._rtDof);
    this._rtScene = null;
  }

  _allocate() {
    this._freeTargets();
    const w = this._w;
    const h = this._h;
    const samples = this.tier.taa ? 0 : (this.engine.preset.samples || 0);

    // Scene target: half-float for headroom, depth texture for TAA + DoF.
    // MSAA and TAA together is wasted bandwidth, so they are mutually exclusive.
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

    if (this._glowMode !== 'threshold') {
      this._rtGlow = makeTarget(w >> 1, h >> 1, { depth: true });
    } else {
      this._rtGlow = null;
    }

    this._smaa.setSize(w, h);
    this._seedExposure();
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
      uJitter: { value: V2() },
      uProj: { value: V2() },
      uCamWorld: { value: new THREE.Matrix4() },
      uPrevView: { value: new THREE.Matrix4() },
      uLogFar: { value: 1 },
      uNearFar: { value: V2() },
      uFeedback: { value: 0.92 },
      uClampGamma: { value: 1.15 },
      uSharpen: { value: 0.35 },
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
      tExposure: { value: null },
      uTexel: { value: V2() },
      uThreshold: { value: 1.55 },
      uSoftness: { value: 0.55 },
      uExposureComp: { value: 1 },
      uExposureRef: { value: 0.1 },
      uAdaptStrength: { value: 0.5 },
      uExposureRange: { value: new THREE.Vector2(0.55, 2.1) },
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
      uRange: { value: 2600 },
      uRadius: { value: 5 },
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
      uBloomStrength: { value: 0.62 },
      uStreakStrength: { value: 0.055 },
      uStreakTint: { value: new THREE.Vector3(0.55, 0.72, 1.0) },
      uExposureComp: { value: 1 },
      uExposureRef: { value: 0.1 },
      uAdaptStrength: { value: 0.5 },
      uExposureRange: { value: new THREE.Vector2(0.55, 2.1) },
      uVignette: { value: 0.2 },
      uAberration: { value: 0.55 },
      uGrain: { value: 0.028 },
      uContrast: { value: 0.07 },
      uSaturation: { value: 1.02 },
      uShadowLift: { value: 0.016 },
      uSplitTone: { value: 0.1 },
      uShadowTint: { value: new THREE.Vector3(0.36, 0.52, 0.85) },
      uHighlightTint: { value: new THREE.Vector3(1.0, 0.86, 0.66) },
      uDofStrength: { value: 0 },
      uDofRange: { value: 2600 },
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
    set(this._mPrefilter, 'USE_GLOW_LAYER', this._glowMode !== 'threshold');
    set(this._mPrefilter, 'GLOW_LAYER_ONLY', this._glowMode === 'layer');
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

  /* Both scenes, backdrop first, depth cleared between. Delegates to the
     engine when there is no jitter so the sequence stays in one place. */
  _drawScenes() {
    const e = this.engine;
    const r = this.renderer;
    r.setRenderTarget(this._rtScene);

    if (!this.tier.taa) {
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
      e.farCamera.projectionMatrix.elements[8] += ox;
      e.farCamera.projectionMatrix.elements[9] += oy;

      r.clear(true, true, true);
      r.render(e.farScene, e.farCamera);
      r.clearDepth();
      r.render(e.scene, e.camera);

      e.camera.projectionMatrix.copy(this._savedProj);
      e.camera.projectionMatrixInverse.copy(this._savedProj).invert();
      e.farCamera.updateProjectionMatrix();
    }

    if (this._rtGlow) {
      const mask = e.camera.layers.mask;
      e.camera.layers.set(LAYER.GLOW);
      r.setRenderTarget(this._rtGlow);
      r.clear(true, true, false);
      r.render(e.scene, e.camera);
      e.camera.layers.mask = mask;
    }
  }

  _resolveTaa() {
    const e = this.engine;
    const u = this._mTaa.uniforms;
    const prev = this._rtTaa[this._taaIndex];
    const next = this._rtTaa[1 - this._taaIndex];

    u.tCurrent.value = this._rtScene.texture;
    u.tHistory.value = prev.texture;
    u.tDepth.value = this._rtScene.depthTexture;
    u.uTexel.value.set(1 / this._w, 1 / this._h);
    u.uJitter.value.copy(this._jitter);
    u.uProj.value.set(e.camera.projectionMatrix.elements[0], e.camera.projectionMatrix.elements[5]);
    u.uCamWorld.value.copy(e.camera.matrixWorld);
    u.uPrevView.value.copy(this._prevView);
    u.uLogFar.value = Math.log2(e.camera.far + 1);
    u.uNearFar.value.set(e.camera.near, e.camera.far);
    u.uFeedback.value = this.params.taaFeedback;
    u.uClampGamma.value = this.params.taaClampGamma;
    u.uSharpen.value = this.tier.taaSharpen;
    u.uReset.value = this._historyValid ? 0 : 1;

    this._blit(this._mTaa, next);
    this._taaIndex = 1 - this._taaIndex;
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
    this._mReduce.uniforms.tSource.value = last.texture;
    this._mReduce.uniforms.uTexel.value.set(1 / last.width, 1 / last.height);

    const prev = this._rtExp[this._expIndex];
    const next = this._rtExp[1 - this._expIndex];
    const a = this._mAdapt.uniforms;
    a.tSource.value = last.texture;
    a.tPrev.value = this._historyValid ? prev.texture : null;
    a.uRate.value.set(this.params.exposureUpRate, this.params.exposureDownRate);
    a.uDt.value = Math.min(dt, 0.1);
    if (!a.tPrev.value) a.tPrev.value = prev.texture;
    this._blit(this._mAdapt, next);
    this._expIndex = 1 - this._expIndex;
  }

  get _exposureTex() {
    return this._rtExp[this._expIndex].texture;
  }

  /* Both the bloom prefilter and the composite must agree on exposure to the
     last bit — a mismatch makes the bloom threshold float relative to the
     image, which is how hulls end up glowing on some frames. */
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
    pre.tExposure.value = this._exposureTex;
    pre.uTexel.value.set(1 / this._w, 1 / this._h);
    pre.uThreshold.value = p.bloomThreshold;
    pre.uSoftness.value = p.bloomSoftness;
    this._applyExposure(pre);
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
    u.tBloom.value = this.tier.bloom ? this._bloomTex : this._black;
    u.tStreak.value = this.tier.bloom && this.tier.streak ? this._streakTex : this._black;
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
uniform vec2 uJitter;
uniform vec2 uProj;
uniform mat4 uCamWorld;
uniform mat4 uPrevView;
uniform float uFeedback;
uniform float uClampGamma;
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

  // Reproject. Background pixels (depth cleared to 1.0 between the two scenes)
  // are infinitely far, so a direction-only transform is exact there — which is
  // precisely what keeps the star field from crawling as the camera orbits.
  float d = texture2D( tDepth, vUv ).x;
  /* uJitter is the offset added to projectionMatrix[2][0..1]. Because clip.w is
     -viewZ, that term shifts the rendered image by *minus* the offset in NDC,
     so undoing it means adding. Getting this sign backwards doubles the error
     into a ~1 px history misalignment and the whole frame crawls. */
  vec2 ndc = vUv * 2.0 - 1.0 + uJitter;
  vec3 dirView = vec3( ndc.x / uProj.x, ndc.y / uProj.y, -1.0 );
  vec3 prevView;
  if ( d >= 0.999999 ) {
    vec3 dirWorld = ( uCamWorld * vec4( dirView, 0.0 ) ).xyz;
    prevView = ( uPrevView * vec4( dirWorld, 0.0 ) ).xyz;
  } else {
    float w = linearDepth( d );
    vec4 world = uCamWorld * vec4( dirView * w, 1.0 );
    prevView = ( uPrevView * world ).xyz;
  }

  float pw = -prevView.z;
  vec2 prevUv = vec2( 0.5 );
  float valid = 0.0;
  if ( pw > 1e-6 ) {
    prevUv = vec2( uProj.x * prevView.x, uProj.y * prevView.y ) / pw * 0.5 + 0.5;
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
  float a = ( 1.0 - feedback ) * wc;
  float b = feedback * wh;
  vec3 outc = ( cur * a + hist * b ) / max( a + b, 1e-6 );

  #ifdef NOOP
  #endif
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
${EXPOSURE_GLSL}
uniform sampler2D tSource;
uniform sampler2D tGlow;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uSoftness;
varying vec2 vUv;

/* Karis average: weight each tap by 1/(1+luma) before averaging so a lone
   fireflies pixel cannot seed a full-strength bloom blob. */
vec3 karis( vec3 a, vec3 b, vec3 c, vec3 d ) {
  float wa = 1.0 / ( 1.0 + luma( a ) );
  float wb = 1.0 / ( 1.0 + luma( b ) );
  float wc = 1.0 / ( 1.0 + luma( c ) );
  float wd = 1.0 / ( 1.0 + luma( d ) );
  return ( a * wa + b * wb + c * wc + d * wd ) / ( wa + wb + wc + wd );
}

void main() {
  vec2 t = uTexel;
  vec3 c;
  #ifdef GLOW_LAYER_ONLY
    c = texture2D( tGlow, vUv ).rgb;
  #else
    vec3 a0 = texture2D( tSource, vUv + vec2( -1.0, -1.0 ) * t ).rgb;
    vec3 a1 = texture2D( tSource, vUv + vec2(  1.0, -1.0 ) * t ).rgb;
    vec3 a2 = texture2D( tSource, vUv + vec2( -1.0,  1.0 ) * t ).rgb;
    vec3 a3 = texture2D( tSource, vUv + vec2(  1.0,  1.0 ) * t ).rgb;
    c = karis( a0, a1, a2, a3 );
    #ifdef USE_GLOW_LAYER
      c = max( c, texture2D( tGlow, vUv ).rgb );
    #endif
  #endif

  // Threshold in exposed space so the cut point follows adaptation. A fixed
  // linear threshold drifts the moment the scene brightness changes, and that
  // is how lit hull starts glowing on one map and not another.
  c *= sceneExposure();

  float br = maxc( c );
  float knee = uThreshold * uSoftness;
  float soft = clamp( br - uThreshold + knee, 0.0, 2.0 * knee );
  soft = soft * soft / ( 4.0 * knee + 1e-4 );
  float contribution = max( soft, br - uThreshold ) / max( br, 1e-4 );
  gl_FragColor = vec4( c * contribution, 1.0 );
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

const DOF_FRAG = `
${DEPTH_GLSL}
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
  float dc = texture2D( tDepth, vUv ).x;
  float wc = dc >= 0.999999 ? 1e7 : linearDepth( dc );
  float cocC = clamp( ( wc - focus ) / uRange, 0.0, 1.0 );

  vec3 acc = texture2D( tSource, vUv ).rgb;
  float wsum = 1.0;
  for ( int i = 0; i < 16; i++ ) {
    vec2 off = KERNEL[i] * uRadius * cocC;
    vec2 uv = vUv + off * uTexel;
    float ds = texture2D( tDepth, uv ).x;
    float ws = ds >= 0.999999 ? 1e7 : linearDepth( ds );
    float cocS = clamp( ( ws - focus ) / uRange, 0.0, 1.0 );
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
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uDofStrength;
uniform float uDofRange;
uniform float uSplit;
varying vec2 vUv;

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
      float d = texture2D( tDepth, vUv ).x;
      float w = d >= 0.999999 ? 1e7 : linearDepth( d );
      float coc = clamp( ( w - focus ) / uDofRange, 0.0, 1.0 );
      coc = smoothstep( 0.0, 1.0, coc ) * uDofStrength;
      scene = mix( scene, texture2D( tDof, vUv ).rgb, coc );
    }
  #endif

  float exposure = sceneExposure();
  vec3 col = scene * exposure;
  vec3 plain = col;

  #ifdef USE_BLOOM
    col += texture2D( tBloom, vUv ).rgb * uBloomStrength;
  #endif
  #ifdef USE_STREAK
    col += texture2D( tStreak, vUv ).rgb * uStreakTint * uStreakStrength;
  #endif

  #ifdef USE_VIGNETTE
    vec2 vd = ( vUv - 0.5 ) * vec2( uResolution.x / uResolution.y, 1.0 );
    float vig = 1.0 - uVignette * pow( clamp( length( vd ) / 0.72, 0.0, 1.0 ), 2.4 );
    col *= vig;
  #endif

  #ifdef USE_GRADE
    // Shadow lift tinted with the nebula fill: space is never truly black,
    // and a flat 0,0,0 floor is the fastest way to look like a tech demo.
    float l = luma( col );
    col += uShadowTint * uShadowLift * exp( -l * 9.0 );
    // Split tone, kept small. Big split tone is the teal-and-orange trap.
    float t = clamp( l * 1.6, 0.0, 1.0 );
    vec3 tone = mix( uShadowTint, uHighlightTint, t );
    col = mix( col, col * tone, uSplitTone );
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
