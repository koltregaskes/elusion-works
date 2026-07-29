/* Thruster plumes and light trails.

   The plume is three things stacked: a hot inner shell, a soft outer shell —
   both in one geometry so the pair costs a single draw call — and a nozzle
   flare billboard that carries the read when a ship is coming straight at you.

   Trails are the Homeworld signature. A wing of interceptors crossing frame
   should leave the light-streaks before you can resolve the hulls, so they get
   their own ribbon batch with distance-priority so the ones nearest the camera
   always win the budget. */

import * as THREE from '../../vendor/three/build/three.module.js';

const QROT = /* glsl */ `
vec3 qrot( vec4 q, vec3 v ) {
  return v + 2.0 * cross( q.xyz, cross( q.xyz, v ) + q.w * v );
}
`;

/* 0..2 pos | 3..6 quat | 7..9 scale | 10..12 colour | 13..16 seed,throttle,hot,flare */
const E_STRIDE = 17;

const PLUME_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${QROT}

attribute float aShell;
attribute vec3 iPos;
attribute vec4 iQuat;
attribute vec3 iScale;
attribute vec3 iColor;
attribute vec4 iMisc;

uniform float uTime;
uniform float uPixelScale;
uniform float uMinPixels;

varying vec2 vUv;
varying vec3 vColor;
varying float vShell;
varying float vFacing;
varying float vThrottle;
varying float vSeed;
varying float vFragW;
varying float vClamp;

void main() {
  /* Screen floor on the plume radius. An interceptor nozzle is 0.64 m across;
     at three kilometres that is a fifth of a pixel, so a whole fighter wing
     under full burn would show nothing at all. Scale the cone up — length with
     it, so the shape stays a cone rather than a disc — until it is at least a
     couple of pixels wide. */
  vec3 scale = iScale;
  float camDist = max( distance( cameraPosition, iPos ), 1.0 );
  float floorR = camDist * uPixelScale * uMinPixels;
  float k = max( 1.0, floorR / max( scale.x, 0.0001 ) );
  vClamp = clamp( 1.0 - 1.0 / k, 0.0, 1.0 );
  scale.xy *= k;
  scale.z *= mix( 1.0, k, 0.35 );

  vec3 local = position * scale;
  vec3 wp = qrot( iQuat, local ) + iPos;

  vec3 n = qrot( iQuat, normalize( normal / max( scale, vec3( 0.0001 ) ) ) );
  vec3 toCam = normalize( cameraPosition - wp );

  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );

  vUv = uv;
  vColor = iColor;
  vShell = aShell;
  vFacing = abs( dot( n, toCam ) );
  vThrottle = iMisc.y;
  vSeed = iMisc.x;
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const PLUME_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

uniform sampler2D uNoise;
uniform float uTime;
uniform vec3 uHot;

varying vec2 vUv;
varying vec3 vColor;
varying float vShell;
varying float vFacing;
varying float vThrottle;
varying float vSeed;
varying float vFragW;
varying float vClamp;

void main() {
  #include <logdepthbuf_fragment>
  float t = vUv.y;

  /* Turbulence: two noise taps scrolling at different rates down the plume,
     plus a fast flicker. Steady enough to read as thrust, unsteady enough to
     never look like a cone of plastic. */
  float n1 = texture2D( uNoise, vec2( vUv.x * 1.6 + vSeed, t * 1.1 - uTime * 1.9 ) ).r;
  float n2 = texture2D( uNoise, vec2( vUv.x * 3.1 - vSeed * 2.0, t * 2.3 - uTime * 3.4 ) ).g;
  float turb = mix( 0.66, 1.34, n1 * 0.62 + n2 * 0.38 );
  float flick = 0.90 + 0.10 * sin( uTime * 41.0 + vSeed * 24.0 ) * sin( uTime * 17.3 + vSeed * 9.0 );

  float body = pow( max( 1.0 - t, 0.0 ), mix( 1.9, 1.25, vThrottle ) );
  float rim = 0.62 + 0.38 * pow( 1.0 - vFacing, 2.2 );

  float a;
  vec3 col;
  if ( vShell > 0.5 ) {
    // Inner shell: the hot choke. Short, near-white, barely turbulent.
    a = pow( max( 1.0 - t, 0.0 ), 2.4 ) * 1.35 * mix( 0.85, 1.0, flick );
    col = mix( uHot, vColor, smoothstep( 0.0, 0.55, t ) ) * 1.55;
  } else {
    a = body * rim * turb * flick * 0.55;
    col = mix( mix( uHot, vColor, 0.55 ), vColor * 0.75, smoothstep( 0.0, 0.7, t ) );
  }

  // Once the pixel floor is doing the work the cone is a smear a few pixels
  // across; concentrate it and drive it harder so it still reads as thrust.
  a = fxSharpen( a, vClamp * 0.8 );
  col *= uGain * ( 1.0 + 1.1 * vClamp );

  a *= smoothstep( 0.0, 0.02, vThrottle );
  a *= fxSoftFade( vFragW );
  if ( a <= 0.003 ) discard;
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const FLARE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${QROT}

attribute vec3 iPos;
attribute vec4 iQuat;
attribute vec3 iScale;
attribute vec3 iColor;
attribute vec4 iMisc;

uniform float uTime;
uniform float uPixelScale;
uniform float uMinPixels;

varying vec2 vUv;
varying vec3 vColor;
varying float vGain;
varying float vFragW;
varying float vClamp;

void main() {
  vec3 axis = qrot( iQuat, vec3( 0.0, 0.0, 1.0 ) );
  vec3 wp = iPos + axis * iScale.z * 0.06;
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  float dist = max( -mv.z, 1.0 );

  float pulse = 0.92 + 0.08 * sin( uTime * 33.0 + iMisc.x * 19.0 );
  float natural = iScale.x * iMisc.w * pulse;
  float size = max( natural, dist * uPixelScale * uMinPixels );
  vClamp = clamp( 1.0 - natural / max( size, 0.0001 ), 0.0, 1.0 );

  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;

  vUv = uv;
  vColor = iColor;
  // Facing the nozzle straight-on is where the flare should dominate.
  vGain = mix( 0.45, 1.0, pow( abs( dot( normalize( axis ), normalize( cameraPosition - wp ) ) ), 1.6 ) )
        * smoothstep( 0.0, 0.02, iMisc.y );
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const FLARE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

uniform sampler2D uMap;

varying vec2 vUv;
varying vec3 vColor;
varying float vGain;
varying float vFragW;
varying float vClamp;

void main() {
  #include <logdepthbuf_fragment>
  vec4 texel = texture2D( uMap, vUv );
  float a = fxSharpen( texel.a, vClamp ) * fxQuadMask( vUv ) * vGain * fxSoftFade( vFragW );
  if ( a <= 0.003 ) discard;
  /* Mostly team colour with a white-hot centre, not the other way round: the
     drive is the strongest colour signal a ship gives at range (§3.3). */
  vec3 hot = mix( vColor, vec3( 1.0 ), 0.16 + 0.55 * pow( texel.a, 3.0 ) );
  gl_FragColor = vec4( hot * texel.rgb * 2.1 * uGain * ( 1.0 + 0.75 * vClamp ), a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Two concentric shells along +Z, nozzle at z=0, tip at z=1, radius 1. */
function buildPlumeGeometry(radial = 12, rings = 8) {
  const pos = [];
  const nrm = [];
  const uvs = [];
  const shell = [];
  const idx = [];
  const shells = [
    { r: 1.0, exp: 0.62, tag: 0 },
    { r: 0.44, exp: 0.9, tag: 1 },
  ];
  let base = 0;
  for (const s of shells) {
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      const r = s.r * Math.pow(Math.max(0, 1 - t), s.exp);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        pos.push(cx * r, cy * r, t);
        nrm.push(cx, cy, 0.35);
        uvs.push(j / radial, t);
        shell.push(s.tag);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * (radial + 1) + j;
        const b = a + radial + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    base = pos.length / 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aShell', new THREE.Float32BufferAttribute(shell, 1));
  g.setIndex(idx);
  return g;
}

function quadGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  return g;
}

const PLUME_ATTRS = [
  { name: 'iPos', size: 3, offset: 0 },
  { name: 'iQuat', size: 4, offset: 3 },
  { name: 'iScale', size: 3, offset: 7 },
  { name: 'iColor', size: 3, offset: 10 },
  { name: 'iMisc', size: 4, offset: 13 },
];

/* ------------------------------------------------------------ running lights
   `buildShipModel()` hands back a `lights[]` array per the §2 contract and
   nothing was consuming it. They matter: a row of navigation lights at fixed
   spacing along a hull is the cheapest and strongest scale cue there is
   (§3.4). Twenty-four of them down a 1,900 m mothership say "this thing is
   enormous" before any greeble resolves; two on a 14 m interceptor say the
   opposite. They carry a screen floor so they survive at strategic range,
   which is exactly where the scale read matters most. */

const L_STRIDE = 12;
/* 0..2 pos | 3..5 rgb | 6 size | 7 phase | 8 period | 9 seed | 10..11 pad */

const LIGHT_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 iPos;
attribute vec3 iColor;
attribute float iSize;
attribute float iPhase;
attribute float iPeriod;
attribute float iSeed;

uniform float uTime;
uniform float uPixelScale;
uniform float uMinPixels;

varying vec2 vUv;
varying vec3 vColor;
varying float vGain;
varying float vFragW;

void main() {
  vec4 mv = viewMatrix * vec4( iPos, 1.0 );
  float dist = max( -mv.z, 1.0 );

  // period 0 => steady. Otherwise a short bright pulse, not a square wave.
  float blink = 1.0;
  if ( iPeriod > 0.001 ) {
    float ph = fract( ( uTime + iPhase ) / iPeriod );
    blink = 0.12 + 0.88 * exp( -ph * 7.0 ) + 0.35 * exp( -abs( ph - 0.5 ) * 26.0 );
  }

  float size = max( iSize, dist * uPixelScale * uMinPixels );
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;

  vUv = uv;
  vColor = iColor;
  vGain = blink;
  vFragW = gl_Position.w;
  #include <logdepthbuf_vertex>
}
`;

const LIGHT_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#SOFT_PARS

varying vec2 vUv;
varying vec3 vColor;
varying float vGain;
varying float vFragW;

void main() {
  #include <logdepthbuf_fragment>
  vec2 d = vUv * 2.0 - 1.0;
  float r2 = dot( d, d );
  if ( r2 > 1.0 ) discard;
  float core = exp( -r2 * 12.0 );
  float halo = pow( max( 1.0 - sqrt( r2 ), 0.0 ), 2.2 ) * 0.30;
  float a = ( core + halo ) * vGain * fxSoftFade( vFragW );
  if ( a <= 0.004 ) discard;
  gl_FragColor = vec4( mix( vColor, vec3( 1.0 ), core * 0.45 ) * ( 1.4 + 2.2 * core ) * uGain, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const LIGHT_ATTRS = [
  { name: 'iPos', size: 3, offset: 0 },
  { name: 'iColor', size: 3, offset: 3 },
  { name: 'iSize', size: 1, offset: 6 },
  { name: 'iPhase', size: 1, offset: 7 },
  { name: 'iPeriod', size: 1, offset: 8 },
  { name: 'iSeed', size: 1, offset: 9 },
];

const LIGHT_RANGE = 16000;

const TRAIL_RANGE = 9000;

/* Station-keeping glow floor. Small enough to read as "hot, idle", large
   enough that a parked mothership is not twelve dead holes. */
const IDLE_THROTTLE = 0.14;

export class EngineFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.drawCalls = 3;
    this._entries = new Map();

    this._plumeGeo = buildPlumeGeometry(12, 8);
    this._quadGeo = quadGeometry();

    this.core = ctx.instanceBatch({
      name: 'plume',
      base: this._plumeGeo,
      attributes: PLUME_ATTRS,
      stride: E_STRIDE,
      capacity: ctx.budget.plumes,
      vertexShader: PLUME_VERT,
      fragmentShader: PLUME_FRAG,
      uniforms: {
        uNoise: { value: ctx.noises.fbm },
        uHot: { value: new THREE.Color(0xdff2ff) },
        uMinPixels: { value: 2.6 },
      },
      renderOrder: 10,
      softness: 16,
    });

    this.flare = ctx.instanceBatch({
      name: 'plumeFlare',
      base: this._quadGeo,
      attributes: PLUME_ATTRS,
      stride: E_STRIDE,
      capacity: ctx.budget.plumes,
      vertexShader: FLARE_VERT,
      fragmentShader: FLARE_FRAG,
      uniforms: {
        uMap: { value: ctx.sprites.flare },
        uMinPixels: { value: 4.0 },
      },
      renderOrder: 11,
      softness: 12,
    });

    this.lights = ctx.instanceBatch({
      name: 'runningLights',
      base: this._quadGeo,
      attributes: LIGHT_ATTRS,
      stride: L_STRIDE,
      capacity: ctx.budget.lights,
      vertexShader: LIGHT_VERT,
      fragmentShader: LIGHT_FRAG,
      uniforms: { uMinPixels: { value: 1.9 } },
      renderOrder: 12,
      softness: 6,
      nearFade: 8,
    });

    this.plumeCount = 0;
    this.lightCount = 0;
    this._lightCursor = 0;

    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._zAxis = new THREE.Vector3(0, 0, 1);
  }

  attach(entity, engineDefs) {
    if (!entity || !engineDefs || !engineDefs.length) return;
    const existing = this._entries.get(entity.id);
    if (existing) existing.entity = entity;

    const defs = [];
    for (const d of engineDefs) {
      if (!d || !d.pos) continue;
      const dir = d.dir ? new THREE.Vector3(d.dir.x, d.dir.y, d.dir.z) : new THREE.Vector3(0, 0, -1);
      if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
      dir.normalize();
      defs.push({
        pos: new THREE.Vector3(d.pos.x, d.pos.y, d.pos.z),
        dir,
        // Local +Z -> exhaust direction. Constant per hull, so bake it once.
        quat: new THREE.Quaternion().setFromUnitVectors(this._zAxis, dir),
        radius: d.radius > 0 ? d.radius : 1,
      });
    }
    if (!defs.length) return;

    const def = entity.def || {};
    const entry = existing || {
      entity,
      defs,
      trail: null,
      trailUrge: 0,
      seed: (entity.id * 0.6180339887) % 1,
      /* Fast movers streak; capitals never do. Corvettes and up read as mass
         moving, and a light-trail on a 380 m destroyer looks like a toy. */
      wantsTrail: (def.speed || 0) >= 220 && (def.length || 0) <= 60,
      centre: new THREE.Vector3(),
    };
    entry.defs = defs;
    entry.centre.set(0, 0, 0);
    for (const d of defs) entry.centre.add(d.pos);
    entry.centre.multiplyScalar(1 / defs.length);
    entry.lights = this._readLights(entity);
    this._entries.set(entity.id, entry);
  }

  /** Running lights, per the `buildShipModel()` contract. Cheap if absent. */
  _readLights(entity) {
    const src = entity._lights
      || entity.lights
      || (entity.model && entity.model.lights)
      || (entity.object3D && entity.object3D.userData && entity.object3D.userData.lights);
    if (!Array.isArray(src) || !src.length) return null;

    const def = entity.def || {};
    const L = def.length || (entity.radius || 10) * 2.2;
    // Fixture size tracks hull size but sub-linearly: a mothership's lamps are
    // bigger than a fighter's, not 135x bigger, which is what sells the scale.
    const size = Math.min(4.2, Math.max(0.22, Math.pow(L, 0.62) * 0.055));
    const out = [];
    // 48 is plenty to describe a 1.9 km spine and bounds the per-frame write.
    const step = Math.max(1, Math.ceil(src.length / 48));
    for (let i = 0; i < src.length; i += step) {
      const l = src[i];
      if (!l || !l.pos) continue;
      const c = l.colour || l.color;
      out.push({
        pos: new THREE.Vector3(l.pos.x, l.pos.y, l.pos.z),
        r: c ? c.r : 1, g: c ? c.g : 0.86, b: c ? c.b : 0.72,
        size,
        period: l.period > 0 ? l.period : 0,
        phase: ((entity.id * 0.6180339887 + i * 0.2393) % 1) * (l.period > 0 ? l.period : 1),
        seed: (i * 0.618034) % 1,
      });
    }
    return out.length ? out : null;
  }

  detach(entity) {
    if (!entity) return;
    const e = this._entries.get(entity.id);
    if (!e) return;
    if (e.trail) this.ctx.fields.trail.detach(e.trail);
    this._entries.delete(entity.id);
  }

  update(dt, camera) {
    const ctx = this.ctx;
    const core = this.core;
    const flare = this.flare;
    const cd = core.data;
    const fd = flare.data;
    const cap = ctx.budget.plumes;
    const q = this._q;
    const v = this._v;
    const centre = this._v2;
    const camPos = camera.position;
    const trails = ctx.fields.trail;

    const ld = this.lights.data;
    const lcap = ctx.budget.lights;
    let ln = 0;

    let n = 0;
    for (const entry of this._entries.values()) {
      const e = entry.entity;
      if (!e || e.alive === false) continue;
      const obj = e.object3D;
      const op = obj ? obj.position : e.position;
      const oq = obj ? obj.quaternion : e.quaternion;
      if (!op) continue;
      const scale = obj && obj.scale ? obj.scale.x : 1;

      const dx = op.x - camPos.x;
      const dy = op.y - camPos.y;
      const dz = op.z - camPos.z;
      const dist2 = dx * dx + dy * dy + dz * dz;

      if (entry.lights && ln < lcap && dist2 < LIGHT_RANGE * LIGHT_RANGE) {
        const ls = entry.lights;
        for (let i = 0; i < ls.length && ln < lcap; i++) {
          const l = ls[i];
          v.copy(l.pos).multiplyScalar(scale).applyQuaternion(oq).add(op);
          const o = ln * L_STRIDE;
          ld[o] = v.x; ld[o + 1] = v.y; ld[o + 2] = v.z;
          ld[o + 3] = l.r; ld[o + 4] = l.g; ld[o + 5] = l.b;
          ld[o + 6] = l.size * scale;
          ld[o + 7] = l.phase;
          ld[o + 8] = l.period;
          ld[o + 9] = l.seed;
          ln++;
        }
      }

      /* Idle burn. A ship at station keeping still has hot bells — reactors do
         not switch off — and a fleet parked at zero throttle with dead engines
         is the single most lifeless thing this renderer can produce. The floor
         is enough to light the nozzle and put a stub of plume behind it. */
      const raw = Math.max(0, Math.min(1, e.throttle === undefined ? 1 : e.throttle));
      const throttle = Math.max(IDLE_THROTTLE, raw);
      const team = ctx.teamColour(e.team || 0);

      /* Trail bookkeeping. Distance-gated so the ribbon budget is spent on the
         fighters the camera can actually see streak. */
      if (entry.wantsTrail) {
        const want = raw > 0.12 && dist2 < TRAIL_RANGE * TRAIL_RANGE;
        if (want && !entry.trail) {
          /* Per-ship jitter. A wing flying formation with identical trails
             reads as one emitter's pattern rather than six pilots; ±25% on
             width and life is enough to break that up. */
          const j = 0.75 + 0.5 * entry.seed;
          const r = Math.max(2.0, Math.min(16, (e.radius || 8) * 0.44 * j));
          const life = (0.42 + 0.28 * ctx.qscale) * j;
          entry.trail = trails.acquire(team.engine, r, life, Math.max(5, r * 2.4));
        } else if (!want && entry.trail) {
          trails.detach(entry.trail);
          entry.trail = null;
        }
        if (entry.trail) {
          centre.copy(entry.centre).multiplyScalar(scale).applyQuaternion(oq).add(op);
          trails.feed(entry.trail, centre.x, centre.y, centre.z);
        }
      }

      // Beyond ~20 km a plume is a pixel; drop the geometry, keep the flare.
      const far = dist2 > 20000 * 20000;

      for (let i = 0; i < entry.defs.length; i++) {
        if (n >= cap) break;
        const d = entry.defs[i];
        v.copy(d.pos).multiplyScalar(scale).applyQuaternion(oq).add(op);
        q.copy(d.quat).premultiply(oq);

        const r = d.radius * scale;
        // A fighter at full burn trails roughly its own length of flame; a
        // capital's block runs proportionally further because its bells are
        // proportionally larger. One formula covers a 45x span of nozzle size.
        const len = r * (3.0 + 22.0 * throttle);
        const wid = r * (0.92 + 0.30 * throttle);
        const seed = (entry.seed + i * 0.317) % 1;

        const o = n * E_STRIDE;
        cd[o] = v.x; cd[o + 1] = v.y; cd[o + 2] = v.z;
        cd[o + 3] = q.x; cd[o + 4] = q.y; cd[o + 5] = q.z; cd[o + 6] = q.w;
        cd[o + 7] = far ? 0 : wid;
        cd[o + 8] = far ? 0 : wid;
        cd[o + 9] = far ? 0 : len;
        cd[o + 10] = team.engine.r; cd[o + 11] = team.engine.g; cd[o + 12] = team.engine.b;
        cd[o + 13] = seed;
        cd[o + 14] = throttle;
        cd[o + 15] = 0;
        cd[o + 16] = 0;

        for (let k = 0; k < E_STRIDE; k++) fd[o + k] = cd[o + k];
        fd[o + 7] = r * (2.2 + 1.9 * throttle);
        fd[o + 8] = fd[o + 7];
        fd[o + 9] = len;
        fd[o + 16] = 1;
        n++;
      }
    }

    this.plumeCount = n;
    this.lightCount = ln;
    core.flush(n);
    flare.flush(n);
    this.lights.flush(ln);
  }

  dispose() {
    this.core.dispose();
    this.flare.dispose();
    this.lights.dispose();
    this._plumeGeo.dispose();
    this._quadGeo.dispose();
    this._entries.clear();
  }
}
