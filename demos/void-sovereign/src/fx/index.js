/* FX facade + the shared GPU infrastructure every effect draws through.

   Two ideas carry the whole subsystem:

   1. Nothing is polled. Every effect starts life as a `sim:*` event. The FX
      layer holds no reference to the sim beyond the entity objects handed to
      it, which keeps a 1,000-unit battle from turning into a 1,000-unit
      per-frame scan.
   2. Motion lives on the GPU. A tracer, an ember, a smoke puff — all of them
      integrate their own position in the vertex shader from a spawn time and
      a velocity, so a frame with 4,000 live particles costs four buffer
      uploads and nothing else. The CPU only spawns and retires.

   Draw-call budget (peak): ~15. See `FXSystem.stats`. */

import * as THREE from '../../vendor/three/build/three.module.js';
import { bus } from '../core/events.js';
import { makeRng } from '../core/rng.js';
import { LAYER } from '../core/engine.js';
import { EngineFX } from './engines.js';
import { WeaponFX } from './weapons.js';
import { ExplosionFX } from './explosions.js';
import { ShieldFX } from './shields.js';
import { DebrisFX } from './debris.js';

/* ------------------------------------------------------------------ imports
   `render/textures.js` and `render/materials.js` belong to the MAT agent and
   may not exist yet. Probe with fetch first: a failed dynamic import writes a
   red line to the console, a 404 from fetch does not, and this module has to
   stay silent on the happy path of a standalone test page. */

async function optionalModule(rel) {
  try {
    const url = new URL(rel, import.meta.url).href;
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return null;
    return await import(url);
  } catch (e) {
    return null;
  }
}

const MOD_TEXTURES = await optionalModule('../render/textures.js');
const MOD_MATERIALS = await optionalModule('../render/materials.js');

/* ------------------------------------------------------------------ palette
   Fallback only. When `render/materials.js` lands, its TEAM_COLORS wins.
   Player reads cold cyan over bone; enemy reads amber over rust (§3.3). */

function makeFallbackTeamColors() {
  return [
    {
      primary: new THREE.Color(0xb8c4cf),
      secondary: new THREE.Color(0x67747f),
      engine: new THREE.Color(0x74e2ff),
      trim: new THREE.Color(0x36d2ff),
      light: new THREE.Color(0xdff4ff),
    },
    {
      primary: new THREE.Color(0xc9bcab),
      secondary: new THREE.Color(0x77644f),
      engine: new THREE.Color(0xff9330),
      trim: new THREE.Color(0xff5326),
      light: new THREE.Color(0xffd6a0),
    },
  ];
}

/* ----------------------------------------------------------------- sprites
   Canvas-drawn stand-ins for `getSpriteTexture(kind)`. Deliberately plain —
   they exist so the FX range boots with no MAT agent, not to compete with the
   real library. All are premultiplied-safe: RGB stays white, shape lives in
   alpha, so the per-particle colour multiply is the only tint. */

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function finishTexture(canvas, { wrap = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/* A point-source profile, not a disc.

   The alpha ramp is the effect. A flare whose alpha stays high out to half its
   radius is a *card*: at the additive gains an explosion core needs, every
   texel inside that plateau clears the tone curve and the result is a flat
   white circle with a rim. This falls away fast — half brightness by 8% of the
   radius — so the sprite reads as a hot point with a halo around it, and the
   thing that grows when you scale it up is the halo rather than the disc.

   RGB is flat white throughout: colour comes from the per-particle tint, so
   the same sprite serves a cyan muzzle flash and a deep orange fireball. */
function spriteFlare(size = 128) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const h = size / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.04, 'rgba(255,255,255,0.80)');
  grad.addColorStop(0.10, 'rgba(255,255,255,0.40)');
  grad.addColorStop(0.22, 'rgba(255,255,255,0.13)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.035)');
  grad.addColorStop(0.72, 'rgba(255,255,255,0.008)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // Faint anamorphic cross so big flares get a lens signature.
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 2; i++) {
    const lg = g.createLinearGradient(i ? 0 : h, i ? h : 0, i ? size : h, i ? h : size);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.28)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    if (i) g.fillRect(0, h - size * 0.012, size, size * 0.024);
    else g.fillRect(h - size * 0.012, 0, size * 0.024, size);
  }
  return finishTexture(c);
}

function spriteSpark(size = 64) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const h = size / 2;
  // A streak: hot along the vertical axis, falls off hard across it.
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - h) / h;
      const dy = (y - h) / h;
      const across = Math.exp(-dx * dx * 34);
      const along = Math.exp(-dy * dy * 2.4);
      const core = Math.exp(-(dx * dx + dy * dy) * 26);
      const a = Math.min(1, across * along * 0.95 + core * 0.8);
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return finishTexture(c);
}

function spriteSmoke(size = 128, rng) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const h = size / 2;
  const img = g.createImageData(size, size);
  // Sum of offset blobs — cheap billow without a noise library.
  const blobs = [];
  for (let i = 0; i < 9; i++) {
    blobs.push({
      x: rng.range(0.28, 0.72),
      y: rng.range(0.28, 0.72),
      r: rng.range(0.11, 0.27),
      w: rng.range(0.5, 1.0),
    });
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let a = 0;
      for (let b = 0; b < blobs.length; b++) {
        const bl = blobs[b];
        const dx = u - bl.x;
        const dy = v - bl.y;
        a += bl.w * Math.exp(-(dx * dx + dy * dy) / (bl.r * bl.r));
      }
      a = Math.min(1, a * 0.42);
      const dx = (x - h) / h;
      const dy = (y - h) / h;
      const disc = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      a *= disc * disc * (3 - 2 * disc);
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return finishTexture(c);
}

function spriteRing(size = 256) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const h = size / 2;
  const grad = g.createRadialGradient(h, h, h * 0.62, h, h, h);
  grad.addColorStop(0.0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.82, 'rgba(255,255,255,1)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(h, h, h, 0, Math.PI * 2);
  g.fill();
  return finishTexture(c);
}

function spriteBeamcap(size = 128) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const h = size / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.13)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return finishTexture(c);
}

function spritePlume(size = 128) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const v = y / (size - 1);
    // v=0 nozzle (hot, wide), v=1 tip (cold, pinched)
    const halfWidth = 0.5 * (1.0 - v) ** 0.62;
    const along = (1.0 - v) ** 1.35;
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1) - 0.5;
      const across = Math.max(0, 1 - Math.abs(u) / Math.max(halfWidth, 1e-3));
      const a = along * across * across;
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return finishTexture(c);
}

function noiseTexture(kind, size, rng) {
  const c = makeCanvas(size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const grid = 8;
  const lattice = new Float32Array(grid * grid * 4);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const at = (gx, gy, ch) => lattice[(((gy + grid) % grid) * grid + ((gx + grid) % grid)) * 4 + ch];
  const value = (u, v, ch, freq) => {
    const x = u * freq;
    const y = v * freq;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = fade(x - xi);
    const yf = fade(y - yi);
    const a = at(xi, yi, ch);
    const b = at(xi + 1, yi, ch);
    const cc = at(xi, yi + 1, ch);
    const d = at(xi + 1, yi + 1, ch);
    return (a + (b - a) * xf) + ((cc + (d - cc) * xf) - (a + (b - a) * xf)) * yf;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        let amp = 1;
        let norm = 0;
        let f = 2;
        for (let o = 0; o < 4; o++) {
          sum += amp * value(u, v, ch, f);
          norm += amp;
          amp *= 0.5;
          f *= 2;
        }
        let n = sum / norm;
        if (kind === 'curl') n = 1 - Math.abs(n * 2 - 1);
        img.data[i + ch] = Math.round(Math.min(1, Math.max(0, n)) * 255);
      }
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = finishTexture(c, { wrap: true });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/* --------------------------------------------------------------- shared GLSL
   Every FX material shares the same soft-particle block and the same log-depth
   handling, so they all clip against hulls the same way. `logarithmicDepthBuffer`
   is on, so a raw `gl_FragCoord.z` comparison against the scene depth buffer is
   meaningless — decode back to view-space W first. */

const SOFT_PARS = /* glsl */ `
uniform sampler2D uSceneDepth;
uniform vec4 uDepthCfg;   // hasDepth, logarithmic, near, far
uniform vec2 uViewport;
uniform vec2 uSoft;       // soften distance (m), near-camera fade (m)
uniform float uGain;      // global FX intensity, set once per frame

float fxSoftFade( float fragW ) {
  float near = smoothstep( uSoft.y * 0.2, uSoft.y, fragW );
  if ( uDepthCfg.x < 0.5 ) return near;
  vec2 duv = gl_FragCoord.xy / uViewport;
  float d = texture2D( uSceneDepth, duv ).x;
  if ( d >= 0.999999 ) return near;
  float sceneW;
  if ( uDepthCfg.y > 0.5 ) {
    sceneW = exp2( d * log2( uDepthCfg.w + 1.0 ) ) - 1.0;
  } else {
    float zn = d * 2.0 - 1.0;
    sceneW = ( 2.0 * uDepthCfg.z * uDepthCfg.w ) /
             ( uDepthCfg.w + uDepthCfg.z - zn * ( uDepthCfg.w - uDepthCfg.z ) );
  }
  return near * clamp( ( sceneW - fragW ) / max( uSoft.x, 0.001 ), 0.0, 1.0 );
}

float fxSharpen( float a, float clampAmt ) {
  return pow( clamp( a, 0.0, 1.0 ), mix( 1.0, 0.45, clampAmt ) );
}

/* Hard guarantee that a billboard fades out before its own edge, whatever the
   bound texture happens to contain. Without this, an opaque sprite renders as
   a square-cornered white card — and on a normal-blended field that card
   occludes everything behind it. */
float fxQuadMask( vec2 uv ) {
  vec2 d = uv * 2.0 - 1.0;
  return 1.0 - smoothstep( 0.72, 1.0, length( d ) );
}
`;

function softUniforms() {
  return {
    uSceneDepth: { value: null },
    uDepthCfg: { value: new THREE.Vector4(0, 1, 1, 400000) },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uSoft: { value: new THREE.Vector2(28, 26) },
    uGain: { value: 1 },
  };
}

/* ------------------------------------------------------------- screen floor
   The single most important idea in this subsystem.

   An RTS is played from 3–6 km. At 4 km and a 48° vertical FOV one screen
   pixel is 3.3 metres, so a 10 m muzzle flash is three pixels and a 0.3 m
   tracer is a tenth of one — it simply is not there. Every effect therefore
   carries a *minimum angular size*: the shader takes whichever is larger of the
   physical size and `distance * pixelScale * minPixels`, so nothing an effect
   does can drop it below a legible number of pixels.

   Forcing the size up alone gives a faint smudge, because the sprite's own
   alpha ramp still spreads over that whole area. `fxClamp` reports how hard the
   floor is biting; the fragment side uses it to sharpen the alpha curve and
   lift intensity, which is what turns a distant impact from a grey smear into
   a hot dot. `fxSharpen` lives in the SOFT_PARS block so every FX shader has
   it without a second include. */

/* ------------------------------------------------------------- InstanceBatch
   The generic "N copies of a mesh, driven by one interleaved instance buffer"
   batch that plumes, tracers, beams, missiles, rings, shields and debris all
   sit on. One of these is exactly one draw call. */

export function makeInstanceBatch(ctx, opts) {
  const {
    base,
    attributes,
    stride,
    capacity,
    vertexShader,
    fragmentShader,
    uniforms = {},
    blending = THREE.AdditiveBlending,
    layer = LAYER.GLOW,
    transparent = true,
    depthWrite = false,
    depthTest = true,
    side = THREE.DoubleSide,
    renderOrder = 10,
    name = 'batch',
    softness = 20,
    nearFade = 22,
  } = opts;

  const data = new Float32Array(capacity * stride);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  for (const key of Object.keys(base.attributes)) geo.setAttribute(key, base.attributes[key]);

  const ib = new THREE.InstancedInterleavedBuffer(data, stride, 1);
  ib.setUsage(THREE.DynamicDrawUsage);
  for (const a of attributes) {
    geo.setAttribute(a.name, new THREE.InterleavedBufferAttribute(ib, a.size, a.offset));
  }
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign(
      { uTime: { value: 0 }, uPixelScale: { value: 0.001 } },
      uniforms,
      softUniforms(),
    ),
    vertexShader,
    fragmentShader: fragmentShader.replace('#SOFT_PARS', SOFT_PARS),
    transparent,
    blending,
    depthTest,
    depthWrite,
    side,
  });
  mat.uniforms.uSoft.value.set(softness, nearFade);
  ctx.registerMaterial(mat);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.layers.set(layer);
  mesh.name = 'fx:' + name;
  ctx.scene.add(mesh);

  return {
    data,
    stride,
    capacity,
    buffer: ib,
    geometry: geo,
    material: mat,
    mesh,
    /** Upload `n` instances and draw them. */
    flush(n) {
      geo.instanceCount = n;
      if (n > 0) {
        ib.clearUpdateRanges();
        ib.addUpdateRange(0, n * stride);
        ib.needsUpdate = true;
      }
    },
    dispose() {
      if (mesh.parent) mesh.parent.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}

/* ------------------------------------------------------------- ParticleField
   One instanced quad batch = one draw call. Instance data lives in a single
   interleaved buffer so a spawn or a retire is one contiguous memcpy and the
   frame's upload is one dirty range rather than seven. */

const P_STRIDE = 20;
/* 0..2 pos | 3..5 vel | 6..9 spawn,life,drag,spin | 10..11 size0,size1
   12..14 colour | 15..18 rot0,brightness,stretch,seed | 19 pad */

const PARTICLE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iParams;
attribute vec2 iSize;
attribute vec3 iColor;
attribute vec4 iFade;

uniform float uTime;
uniform float uAlphaPow;
uniform float uPixelScale;
uniform float uMinPixels;

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vFragW;
varying float vSeed;
varying float vClamp;

void main() {
  float t = uTime - iParams.x;
  float life = max( iParams.y, 0.0001 );
  float age = clamp( t / life, 0.0, 1.0 );
  float alive = step( 0.0, t ) * step( age, 0.99995 );

  float k = iParams.z;
  float s = k > 0.0001 ? ( 1.0 - exp( -k * t ) ) / k : t;
  vec3 wp = iPos + iVel * max( s, 0.0 );

  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  float dist = max( -mv.z, 1.0 );

  float natural = mix( iSize.x, iSize.y, age );
  float floorSize = dist * uPixelScale * uMinPixels;
  float size = max( natural, floorSize );
  // 0 when the sprite is at its own size, 1 when the pixel floor is carrying it.
  vClamp = clamp( 1.0 - natural / max( size, 0.0001 ), 0.0, 1.0 );
  size *= alive;

  vec2 q;
  float stretch = iFade.z;
  if ( stretch > 0.001 ) {
    vec3 vv = ( viewMatrix * vec4( iVel, 0.0 ) ).xyz;
    vec2 d = length( vv.xy ) > 1e-5 ? normalize( vv.xy ) : vec2( 0.0, 1.0 );
    vec2 pp = vec2( -d.y, d.x );
    float decay = k > 0.0001 ? exp( -k * t ) : 1.0;
    q = d * ( position.y * size * ( 1.0 + stretch * decay ) ) + pp * ( position.x * size );
  } else {
    float rot = iFade.x + iParams.w * t;
    float c = cos( rot );
    float sn = sin( rot );
    q = vec2( position.x * c - position.y * sn, position.x * sn + position.y * c ) * size;
  }

  mv.xy += q;
  gl_Position = projectionMatrix * mv;

  vUv = uv;
  vColor = iColor * iFade.y;
  vAlpha = pow( 1.0 - age, uAlphaPow ) * alive;
  vSeed = iFade.w;
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const PARTICLE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SOFT_PARS}

uniform sampler2D uMap;
uniform float uOpacity;
uniform float uClampLift;

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vFragW;
varying float vSeed;
varying float vClamp;

void main() {
  #include <logdepthbuf_fragment>
  vec4 texel = texture2D( uMap, vUv );
  // Sharpen and hot up whatever the pixel floor had to rescue, so a distant
  // impact is a hot dot rather than a wide grey smudge.
  float a = fxSharpen( texel.a, vClamp ) * fxQuadMask( vUv )
          * vAlpha * uOpacity * fxSoftFade( vFragW );
  if ( a <= 0.0025 ) discard;
  gl_FragColor = vec4( vColor * texel.rgb * uGain * ( 1.0 + uClampLift * vClamp ), a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class ParticleField {
  constructor(ctx, opts) {
    const {
      name = 'particles',
      texture,
      blending = THREE.AdditiveBlending,
      capacity = 1024,
      layer = LAYER.GLOW,
      alphaPow = 1.4,
      minPixels = 0.0,
      opacity = 1.0,
      renderOrder = 10,
      softness = 28,
      // Emissive fields get an intensity lift when the pixel floor rescues
      // them; smoke must not, or distant soot glows.
      clampLift = blending === THREE.NormalBlending ? 0.0 : 1.35,
    } = opts;

    this.ctx = ctx;
    this.name = name;
    this.capacity = capacity;
    this.count = 0;
    this._data = new Float32Array(capacity * P_STRIDE);
    this._death = new Float32Array(capacity);
    this._evictCursor = 0;
    this._lo = capacity;
    this._hi = 0;

    // Hand-rolled unit quad: sharing attributes with a PlaneGeometry we then
    // dispose would tear the buffers out from under this geometry.
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
      0, 0, 1, 0, 1, 1, 0, 1,
    ]), 2));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

    const ib = new THREE.InstancedInterleavedBuffer(this._data, P_STRIDE, 1);
    ib.setUsage(THREE.DynamicDrawUsage);
    this._buffer = ib;
    geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    geo.setAttribute('iVel', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    geo.setAttribute('iParams', new THREE.InterleavedBufferAttribute(ib, 4, 6));
    geo.setAttribute('iSize', new THREE.InterleavedBufferAttribute(ib, 2, 10));
    geo.setAttribute('iColor', new THREE.InterleavedBufferAttribute(ib, 3, 12));
    geo.setAttribute('iFade', new THREE.InterleavedBufferAttribute(ib, 4, 15));
    geo.instanceCount = 0;
    // Particles move on the GPU, so a CPU bounding sphere is a lie. Never cull.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(
        {
          uMap: { value: texture },
          uTime: { value: 0 },
          uAlphaPow: { value: alphaPow },
          uPixelScale: { value: 0.001 },
          uMinPixels: { value: minPixels },
          uOpacity: { value: opacity },
          uClampLift: { value: clampLift },
        },
        softUniforms(),
      ),
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      blending,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    mat.uniforms.uSoft.value.set(softness, 26);
    ctx.registerMaterial(mat);

    this.geometry = geo;
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.layers.set(layer);
    this.mesh.name = 'fx:' + name;
    ctx.scene.add(this.mesh);
  }

  /** Positional args on purpose: this is called thousands of times a second. */
  spawn(px, py, pz, vx, vy, vz, life, drag, size0, size1, colour, brightness, stretch, spin) {
    let slot;
    if (this.count < this.capacity) {
      slot = this.count++;
    } else {
      // Oldest-first eviction, sampled. A full linear scan every spawn while
      // saturated costs more than the occasional slightly-wrong victim.
      let best = -1;
      let bestDeath = Infinity;
      for (let i = 0; i < 24; i++) {
        const j = (this._evictCursor + i * 37) % this.capacity;
        if (this._death[j] < bestDeath) {
          bestDeath = this._death[j];
          best = j;
        }
      }
      this._evictCursor = (this._evictCursor + 1) % this.capacity;
      slot = best;
    }

    const d = this._data;
    const o = slot * P_STRIDE;
    const now = this.ctx.now;
    d[o] = px; d[o + 1] = py; d[o + 2] = pz;
    d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = now;
    d[o + 7] = life;
    d[o + 8] = drag;
    d[o + 9] = spin || 0;
    d[o + 10] = size0;
    d[o + 11] = size1;
    d[o + 12] = colour.r; d[o + 13] = colour.g; d[o + 14] = colour.b;
    d[o + 15] = (slot * 2.399963) % 6.2831853;
    d[o + 16] = brightness;
    d[o + 17] = stretch || 0;
    d[o + 18] = (slot * 0.618034) % 1;
    this._death[slot] = now + life;
    this._touch(slot);
    return slot;
  }

  _touch(slot) {
    if (slot < this._lo) this._lo = slot;
    if (slot > this._hi) this._hi = slot;
  }

  update() {
    const now = this.ctx.now;
    const d = this._data;
    for (let i = 0; i < this.count; i++) {
      if (this._death[i] <= now) {
        const last = --this.count;
        if (i !== last) {
          d.copyWithin(i * P_STRIDE, last * P_STRIDE, last * P_STRIDE + P_STRIDE);
          this._death[i] = this._death[last];
          this._touch(i);
          i--;
        }
      }
    }
    this.geometry.instanceCount = this.count;
    if (this._hi >= this._lo) {
      this._buffer.clearUpdateRanges();
      this._buffer.addUpdateRange(this._lo * P_STRIDE, (this._hi - this._lo + 1) * P_STRIDE);
      this._buffer.needsUpdate = true;
      this._lo = this.capacity;
      this._hi = 0;
    }
  }

  clear() {
    this.count = 0;
    this.geometry.instanceCount = 0;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ---------------------------------------------------------------- RibbonField
   Camera-facing strips. Homeworld's light trails are the single strongest read
   in a fighter engagement, so this has to survive hundreds of them: one mesh,
   one static index buffer, and per-vertex birth times so a resting trail costs
   no upload at all. Only the head vertex pair is rewritten each frame. */

const R_STRIDE = 16;
/* 0..2 pos | 3 side | 4..6 dir | 7 birth | 8..10 colour | 11 life
   12 width | 13 alpha | 14 seed | 15 pad */

const RIBBON_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute float aSide;
attribute vec3 aDir;
attribute float aBirth;
attribute vec3 aColor;
attribute float aLife;
attribute float aWidth;
attribute float aAlpha;
attribute float aSeed;

uniform float uTime;
uniform float uPixelScale;
uniform float uMinPixels;
uniform float uTaper;

varying vec3 vColor;
varying float vAlpha;
varying float vFragW;
varying vec2 vUv;
varying float vClamp;

void main() {
  float age = uTime - aBirth;
  float k = clamp( 1.0 - age / max( aLife, 0.0001 ), 0.0, 1.0 );
  float live = step( 0.0, age ) * step( 0.0001, aAlpha );

  vec3 toCam = cameraPosition - position;
  float dist = max( length( toCam ), 1.0 );
  vec3 view = toCam / dist;
  vec3 side = cross( normalize( aDir ), view );
  float sl = length( side );
  side = sl > 1e-5 ? side / sl : vec3( 0.0 );

  float natural = aWidth * mix( 1.0, k, uTaper );
  float w = max( natural, dist * uPixelScale * uMinPixels );
  vClamp = clamp( 1.0 - natural / max( w, 0.0001 ), 0.0, 1.0 );
  w *= live;

  vec3 p = position + side * ( aSide * w * 0.5 );
  gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );

  vColor = aColor;
  vAlpha = aAlpha * k * k * live;
  vUv = vec2( aSide * 0.5 + 0.5, k );
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const RIBBON_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SOFT_PARS}

uniform float uOpacity;
uniform float uCore;
uniform float uClampLift;

varying vec3 vColor;
varying float vAlpha;
varying float vFragW;
varying vec2 vUv;
varying float vClamp;

void main() {
  #include <logdepthbuf_fragment>
  float across = abs( vUv.x * 2.0 - 1.0 );
  float shape = pow( 1.0 - across, mix( 1.5, 0.85, vClamp ) );
  float core = exp( -across * across * 18.0 ) * uCore;
  float a = vAlpha * uOpacity * ( shape + core ) * fxSoftFade( vFragW );
  if ( a <= 0.0025 ) discard;
  gl_FragColor = vec4( vColor * ( 1.0 + core * 1.4 ) * uGain * ( 1.0 + uClampLift * vClamp ), a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class RibbonField {
  constructor(ctx, opts) {
    const {
      name = 'ribbons',
      capacity = 256,
      segments = 32,
      blending = THREE.AdditiveBlending,
      layer = LAYER.GLOW,
      opacity = 1,
      core = 1,
      taper = 0.85,
      minPixels = 0,
      renderOrder = 9,
      softness = 24,
      clampLift = blending === THREE.NormalBlending ? 0.0 : 0.9,
    } = opts;

    this.ctx = ctx;
    this.name = name;
    this.capacity = capacity;
    this.segments = segments;

    const verts = capacity * segments * 2;
    this._data = new Float32Array(verts * R_STRIDE);
    this._slots = new Array(capacity);
    this._free = [];
    for (let i = capacity - 1; i >= 0; i--) {
      this._free.push(i);
      this._slots[i] = null;
    }
    this._live = [];
    this._lo = verts;
    this._hi = -1;

    const geo = new THREE.BufferGeometry();
    const ib = new THREE.InterleavedBuffer(this._data, R_STRIDE);
    ib.setUsage(THREE.DynamicDrawUsage);
    this._buffer = ib;
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    geo.setAttribute('aSide', new THREE.InterleavedBufferAttribute(ib, 1, 3));
    geo.setAttribute('aDir', new THREE.InterleavedBufferAttribute(ib, 3, 4));
    geo.setAttribute('aBirth', new THREE.InterleavedBufferAttribute(ib, 1, 7));
    geo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(ib, 3, 8));
    geo.setAttribute('aLife', new THREE.InterleavedBufferAttribute(ib, 1, 11));
    geo.setAttribute('aWidth', new THREE.InterleavedBufferAttribute(ib, 1, 12));
    geo.setAttribute('aAlpha', new THREE.InterleavedBufferAttribute(ib, 1, 13));
    geo.setAttribute('aSeed', new THREE.InterleavedBufferAttribute(ib, 1, 14));

    const quads = capacity * (segments - 1);
    const idx = verts > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
    let w = 0;
    for (let s = 0; s < capacity; s++) {
      const base = s * segments * 2;
      for (let j = 0; j < segments - 1; j++) {
        const a = base + j * 2;
        idx[w++] = a; idx[w++] = a + 1; idx[w++] = a + 2;
        idx[w++] = a + 1; idx[w++] = a + 3; idx[w++] = a + 2;
      }
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign(
        {
          uTime: { value: 0 },
          uOpacity: { value: opacity },
          uCore: { value: core },
          uTaper: { value: taper },
          uPixelScale: { value: 0.001 },
          uMinPixels: { value: minPixels },
          uClampLift: { value: clampLift },
        },
        softUniforms(),
      ),
      vertexShader: RIBBON_VERT,
      fragmentShader: RIBBON_FRAG,
      transparent: true,
      blending,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    mat.uniforms.uSoft.value.set(softness, 20);
    ctx.registerMaterial(mat);

    this.geometry = geo;
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.layers.set(layer);
    this.mesh.name = 'fx:' + name;
    ctx.scene.add(this.mesh);
  }

  /** Returns a handle or null when saturated. */
  acquire(colour, width, life, minStep) {
    const slot = this._free.pop();
    if (slot === undefined) return null;
    const r = {
      slot,
      n: 0,
      colour: new THREE.Color(colour),
      width,
      life,
      minStep: minStep || 6,
      last: new THREE.Vector3(),
      pts: new Float32Array(this.segments * 4),
      detached: false,
      dieAt: 0,
    };
    this._slots[slot] = r;
    this._live.push(r);
    this._blank(slot);
    return r;
  }

  _blank(slot) {
    const d = this._data;
    const base = slot * this.segments * 2;
    for (let v = 0; v < this.segments * 2; v++) {
      const o = (base + v) * R_STRIDE;
      d[o + 13] = 0;
      d[o + 12] = 0;
    }
    this._mark(base, this.segments * 2);
  }

  _mark(v0, count) {
    if (v0 < this._lo) this._lo = v0;
    const hi = v0 + count - 1;
    if (hi > this._hi) this._hi = hi;
  }

  /** Feed the trail. Pushes a new point only once the emitter has actually
      travelled, so a stationary ship does not chew through the buffer. */
  feed(r, x, y, z) {
    if (!r || r.detached) return;
    const now = this.ctx.now;
    if (r.n === 0) {
      this._push(r, x, y, z, now);
      this._push(r, x, y, z, now);
      return;
    }
    const p = r.pts;
    const prev = (r.n - 2) * 4;
    const dx = x - p[prev];
    const dy = y - p[prev + 1];
    const dz = z - p[prev + 2];
    if (dx * dx + dy * dy + dz * dz >= r.minStep * r.minStep) {
      this._push(r, x, y, z, now);
    } else {
      const head = (r.n - 1) * 4;
      p[head] = x; p[head + 1] = y; p[head + 2] = z; p[head + 3] = now;
      this._writeRange(r, Math.max(0, r.n - 2), r.n);
    }
  }

  _push(r, x, y, z, now) {
    const S = this.segments;
    const p = r.pts;
    if (r.n >= S) {
      p.copyWithin(0, 4);
      r.n = S - 1;
      const o = r.n * 4;
      p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = now;
      r.n++;
      this._writeRange(r, 0, r.n);
    } else {
      const o = r.n * 4;
      p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = now;
      r.n++;
      this._writeRange(r, Math.max(0, r.n - 3), r.n);
    }
  }

  _writeRange(r, from, to) {
    const d = this._data;
    const S = this.segments;
    const p = r.pts;
    const base = r.slot * S * 2;
    const col = r.colour;
    for (let j = from; j < to; j++) {
      const o4 = j * 4;
      const nx = j < r.n - 1 ? (j + 1) * 4 : o4;
      const px = j > 0 ? (j - 1) * 4 : o4;
      let dx = p[nx] - p[px];
      let dy = p[nx + 1] - p[px + 1];
      let dz = p[nx + 2] - p[px + 2];
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-5) { dx /= len; dy /= len; dz /= len; } else { dx = 0; dy = 0; dz = 1; }
      // Head is thin, body is full: a trail should look welded to the nozzle.
      const headFade = j === r.n - 1 ? 0.55 : 1;
      for (let s = 0; s < 2; s++) {
        const o = (base + j * 2 + s) * R_STRIDE;
        d[o] = p[o4]; d[o + 1] = p[o4 + 1]; d[o + 2] = p[o4 + 2];
        d[o + 3] = s === 0 ? -1 : 1;
        d[o + 4] = dx; d[o + 5] = dy; d[o + 6] = dz;
        d[o + 7] = p[o4 + 3];
        d[o + 8] = col.r; d[o + 9] = col.g; d[o + 10] = col.b;
        d[o + 11] = r.life;
        d[o + 12] = r.width * headFade;
        d[o + 13] = 1;
        d[o + 14] = (r.slot * 0.618034) % 1;
      }
    }
    this._mark(base + from * 2, (to - from) * 2);
  }

  /** Stop feeding but let the tail burn down naturally. */
  detach(r) {
    if (!r || r.detached) return;
    r.detached = true;
    r.dieAt = this.ctx.now + r.life + 0.1;
  }

  setColour(r, colour) {
    if (r) r.colour.set(colour);
  }

  update() {
    const now = this.ctx.now;
    for (let i = this._live.length - 1; i >= 0; i--) {
      const r = this._live[i];
      if (r.detached && now >= r.dieAt) {
        this._blank(r.slot);
        this._slots[r.slot] = null;
        this._free.push(r.slot);
        this._live.splice(i, 1);
      }
    }
    if (this._hi >= this._lo) {
      this._buffer.clearUpdateRanges();
      this._buffer.addUpdateRange(this._lo * R_STRIDE, (this._hi - this._lo + 1) * R_STRIDE);
      this._buffer.needsUpdate = true;
      this._lo = this.capacity * this.segments * 2;
      this._hi = -1;
    }
  }

  get live() {
    return this._live.length;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ------------------------------------------------------------------- budgets */

const QUALITY_SCALE = { low: 0.4, medium: 0.7, high: 1.0, ultra: 1.35 };

/* Caps are sized for the target machine (§0: RTX 40/50-class), not this dev
   box. Every one of these is a fixed allocation with oldest-first eviction, so
   the cost is bounded whatever the battle does. */
function scaleCaps(scale) {
  const s = (n) => Math.max(16, Math.round(n * scale));
  return {
    flare: s(2200),
    spark: s(7000),
    smoke: s(2400),
    ember: s(3200),
    tracers: s(2600),
    beams: Math.max(16, Math.round(128 * Math.min(1, scale + 0.3))),
    missiles: s(320),
    rings: Math.max(16, s(120)),
    shields: Math.max(8, s(96)),
    debris: s(900),
    trails: s(440),
    smokeTrails: s(220),
    plumes: s(4200),
    lights: s(9000),
  };
}

/* ---------------------------------------------------------------- FXSystem */

export class FXSystem {
  constructor({ engine, materials = null, textures = null, seed = 0x5eed17, quality = null, caps = null } = {}) {
    if (!engine) throw new Error('FXSystem needs an engine');

    this.engine = engine;
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.quality = quality || engine.quality || 'high';

    const rng = makeRng(seed);
    this._rng = rng;
    this._ownedTextures = [];

    const tex = textures || MOD_TEXTURES;
    const mat = materials || MOD_MATERIALS;

    /* Billboard sprites are generated here rather than taken from
       `render/textures.js`, deliberately.

       A particle billboard is an *alpha profile* first and a picture second:
       the shape of the falloff is the effect. The texture library's sprites
       are authored for surface use and do not satisfy what this system needs
       — its `flare` carries full alpha only inside the middle 16% of its
       radius, with a baked-in blue tint, anamorphic streak and six spikes, so
       an explosion drawn with it is 84% empty and cannot be tinted orange;
       its `spark` runs its streak along U with hard, un-feathered edges across
       V, which is 90 degrees from the axis this field stretches along and
       renders as a square-cornered white bar.

       These generators are procedural canvas draws (no binary assets, per §0)
       whose RGB is flat white so the per-particle tint is the only colour, and
       whose alpha reaches zero before the quad edge. The shaders additionally
       clamp alpha at the quad edge (`fxQuadMask`), so a square-cornered sprite
       cannot reach the screen by any route even if this changes. */
    const sprite = (kind, generate) => {
      const t = generate();
      this._ownedTextures.push(t);
      return t;
    };
    const noise = (kind, size) => {
      if (tex && typeof tex.getNoiseTexture === 'function') {
        try {
          const t = tex.getNoiseTexture(kind, size);
          if (t) return t;
        } catch (e) { /* fall through */ }
      }
      const t = noiseTexture(kind, size, rng.fork(kind.length + size));
      this._ownedTextures.push(t);
      return t;
    };

    const sprites = {
      flare: sprite('flare', () => spriteFlare()),
      smoke: sprite('smoke', () => spriteSmoke(128, rng.fork(11))),
      spark: sprite('spark', () => spriteSpark()),
      ring: sprite('ring', () => spriteRing()),
      beamcap: sprite('beamcap', () => spriteBeamcap()),
      plume: sprite('plume', () => spritePlume()),
    };
    const noises = {
      fbm: noise('fbm', 128),
      curl: noise('curl', 128),
    };

    let teamColors = mat && mat.TEAM_COLORS;
    if (!Array.isArray(teamColors) || !teamColors.length || !teamColors[0].engine) {
      teamColors = makeFallbackTeamColors();
    }

    const scale = QUALITY_SCALE[this.quality] || 1;
    const budget = Object.assign(scaleCaps(scale), caps || {});

    /* The context is the only thing sub-systems see. Mutable fields (`now`,
       `pixelScale`) are read at call time so nothing has to be re-plumbed. */
    const ctx = {
      THREE,
      engine,
      scene: engine.scene,
      camera: engine.camera,
      rng,
      quality: this.quality,
      qscale: scale,
      sprites,
      noises,
      teamColors,
      budget,
      layer: LAYER,
      now: 0,
      dt: 1 / 60,
      pixelScale: 0.001,
      gain: 1,
      camPos: new THREE.Vector3(),
      /* Metres subtended by one screen pixel at `dist`. CPU-side twin of the
         shader floor: sizes chosen here can be quoted in pixels too. */
      px(dist) {
        return Math.max(dist, 1) * ctx.pixelScale;
      },
      /** At least `px` pixels tall when viewed from `dist` metres. */
      atLeast(metres, dist, px) {
        return Math.max(metres, Math.max(dist, 1) * ctx.pixelScale * px);
      },
      /** Distance from the camera to a point, for CPU-side pixel floors. */
      distTo(x, y, z) {
        const c = ctx.camPos;
        return Math.max(1, Math.hypot(x - c.x, y - c.y, z - c.z));
      },
      keyLight: { dir: new THREE.Vector3(-0.45, 0.32, -0.83).normalize(), colour: new THREE.Color(0xfff2df) },
      fillLight: new THREE.Color(0x2b3f5c),
      softPars: SOFT_PARS,
      softUniforms,
      materials: [],
      registerMaterial(m) {
        ctx.materials.push(m);
        return m;
      },
      instanceBatch(opts) {
        return makeInstanceBatch(ctx, opts);
      },
      teamColour(team) {
        return ctx.teamColors[team] || ctx.teamColors[0];
      },
    };
    this.ctx = ctx;

    /* minPixels is the readability contract. These are the numbers that decide
       whether a battle four kilometres away is a fight or a smudge. */
    ctx.fields = {
      flare: new ParticleField(ctx, {
        name: 'flare', texture: sprites.flare, capacity: budget.flare,
        alphaPow: 1.15, minPixels: 5.0, renderOrder: 14, softness: 18,
      }),
      spark: new ParticleField(ctx, {
        name: 'spark', texture: sprites.spark, capacity: budget.spark,
        alphaPow: 1.9, minPixels: 2.4, renderOrder: 13, softness: 10,
      }),
      ember: new ParticleField(ctx, {
        name: 'ember', texture: sprites.flare, capacity: budget.ember,
        alphaPow: 2.2, minPixels: 2.2, renderOrder: 12, softness: 14,
      }),
      smoke: new ParticleField(ctx, {
        name: 'smoke', texture: sprites.smoke, capacity: budget.smoke,
        /* Vacuum. There is no atmosphere to hold a smoke column, and soot is
           the only thing in this system that *occludes* rather than adds — so
           it stays thin and sparse. Dense smoke over a fireball reads as a
           flat card laid across the battle, which is worse than no smoke. */
        blending: THREE.NormalBlending, layer: LAYER.DEFAULT,
        alphaPow: 1.5, opacity: 0.26, minPixels: 2.0, renderOrder: 6, softness: 60,
      }),
      /* Trails must not out-shout the guns. They are a motion cue for strike
         craft, not the loudest thing in a fleet action. */
      trail: new RibbonField(ctx, {
        name: 'trail', capacity: budget.trails, segments: 30,
        core: 0.85, taper: 0.95, minPixels: 1.4, opacity: 0.8,
        renderOrder: 11, softness: 16,
      }),
      smokeTrail: new RibbonField(ctx, {
        name: 'smokeTrail', capacity: budget.smokeTrails, segments: 24,
        blending: THREE.NormalBlending, layer: LAYER.DEFAULT,
        opacity: 0.45, core: 0, taper: 0.6, minPixels: 1.6, renderOrder: 5, softness: 45,
      }),
    };

    this.engines = new EngineFX(ctx);
    this.debris = new DebrisFX(ctx);
    this.explosions = new ExplosionFX(ctx, this.debris);
    this.weapons = new WeaponFX(ctx);
    this.shields = new ShieldFX(ctx);

    this._subsystems = [
      this.engines, this.weapons, this.explosions, this.shields, this.debris,
    ];

    this._entities = new Map();
    this._unsubs = [
      bus.on('sim:spawn', (p) => this._onSpawn(p)),
      bus.on('sim:death', (p) => this._onDeath(p)),
      bus.on('sim:damage', (p) => this._onDamage(p)),
      bus.on('sim:fire', (p) => this._onFire(p)),
    ];

    this._tmpV = new THREE.Vector3();
  }

  /* ------------------------------------------------------------- public API */

  attachEngines(entity, engineDefs) {
    if (!entity) return;
    this._entities.set(entity.id, entity);
    this.engines.attach(entity, engineDefs);
  }

  detachEntity(entity) {
    if (!entity) return;
    this._entities.delete(entity.id);
    this.engines.detach(entity);
    this.weapons.detachEntity(entity);
  }

  update(dt, elapsed, camera) {
    const step = Number.isFinite(dt) ? Math.min(dt, 0.1) : 1 / 60;
    this.ctx.dt = step;
    this.ctx.now += step;
    if (camera) {
      this.ctx.camera = camera;
      this.camera = camera;
    }
    const cam = this.ctx.camera;

    // World units per metre-of-distance per pixel: lets every shader hold a
    // minimum on-screen width so tracers and beams still read from 5 km.
    const h = Math.max(1, this.engine.size ? this.engine.size.h : 1080);
    this.ctx.pixelScale = (2 * Math.tan((cam.fov * Math.PI) / 360)) / h;
    this.ctx.camPos.copy(cam.position);

    const vw = this.engine.size ? this.engine.size.w * this.engine.size.dpr : 1920;
    const vh = this.engine.size ? this.engine.size.h * this.engine.size.dpr : 1080;

    // One place sets the frame-global uniforms for every FX material.
    const mats = this.ctx.materials;
    const gain = this.ctx.gain;
    for (let i = 0; i < mats.length; i++) {
      const u = mats[i].uniforms;
      if (u.uTime) u.uTime.value = this.ctx.now;
      if (u.uPixelScale) u.uPixelScale.value = this.ctx.pixelScale;
      if (u.uViewport) u.uViewport.value.set(vw, vh);
      if (u.uGain) u.uGain.value = gain;
    }

    for (let i = 0; i < this._subsystems.length; i++) this._subsystems[i].update(step, cam);
    for (const f of Object.values(this.ctx.fields)) f.update();
  }

  /** POSTFX: hand over the scene depth attachment and plumes stop hard-clipping
      against hulls. Without it the fields fall back to a near-camera fade. */
  setSceneDepth(texture, { logarithmic = true, near = 1, far = 400000 } = {}) {
    for (const m of this.ctx.materials) {
      const u = m.uniforms;
      if (!u.uSceneDepth) continue;
      u.uSceneDepth.value = texture || null;
      u.uDepthCfg.value.set(texture ? 1 : 0, logarithmic ? 1 : 0, near, far);
    }
  }

  /** ENV: match debris shading to the scene's single key light (§3.2). */
  setKeyLight(direction, colour, fill) {
    if (direction) this.ctx.keyLight.dir.copy(direction).normalize();
    if (colour) this.ctx.keyLight.colour.set(colour);
    if (fill) this.ctx.fillLight.set(fill);
    for (const s of this._subsystems) if (s.onKeyLight) s.onKeyLight();
  }

  get stats() {
    const f = this.ctx.fields;
    return {
      particles: f.flare.count + f.spark.count + f.ember.count + f.smoke.count,
      flare: f.flare.count,
      spark: f.spark.count,
      ember: f.ember.count,
      smoke: f.smoke.count,
      trails: f.trail.live,
      smokeTrails: f.smokeTrail.live,
      plumes: this.engines.plumeCount,
      runningLights: this.engines.lightCount,
      tracers: this.weapons.tracerCount,
      beams: this.weapons.beamCount,
      missiles: this.weapons.missileCount,
      rings: this.explosions.ringCount,
      sequences: this.explosions.sequenceCount,
      shields: this.shields.count,
      debris: this.debris.count,
      drawCalls: 6 + this._subsystems.reduce((n, s) => n + (s.drawCalls || 0), 0),
    };
  }

  dispose() {
    for (const off of this._unsubs) off();
    this._unsubs.length = 0;
    for (const s of this._subsystems) s.dispose();
    for (const f of Object.values(this.ctx.fields)) f.dispose();
    for (const t of this._ownedTextures) t.dispose();
    this._ownedTextures.length = 0;
    this._entities.clear();
  }

  /* -------------------------------------------------------------- listeners */

  _onSpawn(p) {
    const e = p && p.entity;
    if (!e) return;
    this._entities.set(e.id, e);
    // Ships built by ships/index.js carry their engine metadata somewhere on
    // the entity; take whichever the SHIPS agent settles on, else wait for an
    // explicit attachEngines().
    const defs = e.engines
      || (e.model && e.model.engines)
      || (e.object3D && e.object3D.userData && e.object3D.userData.engines);
    if (defs && defs.length) this.engines.attach(e, defs);
  }

  _onDeath(p) {
    const e = p && p.entity;
    if (!e) return;
    this.explosions.kill(e, p.killer);
    this.engines.detach(e);
    this.weapons.detachEntity(e);
    this.shields.cancel(e);
    this._entities.delete(e.id);
  }

  _onDamage(p) {
    if (!p || !p.entity) return;
    if (p.shield) this.shields.impact(p);
    else this.weapons.hullImpact(p);
  }

  _onFire(p) {
    if (!p || !p.weapon) return;
    this.weapons.fire(p);
  }
}

export default FXSystem;
