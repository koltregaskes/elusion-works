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

varying vec2 vUv;
varying vec3 vColor;
varying float vShell;
varying float vFacing;
varying float vThrottle;
varying float vSeed;
varying float vFragW;

void main() {
  vec3 local = position * iScale;
  vec3 wp = qrot( iQuat, local ) + iPos;

  vec3 n = qrot( iQuat, normalize( normal / max( iScale, vec3( 0.0001 ) ) ) );
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

  a *= smoothstep( 0.0, 0.06, vThrottle );
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

varying vec2 vUv;
varying vec3 vColor;
varying float vGain;
varying float vFragW;

void main() {
  vec3 axis = qrot( iQuat, vec3( 0.0, 0.0, 1.0 ) );
  vec3 wp = iPos + axis * iScale.z * 0.06;
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  float dist = max( -mv.z, 1.0 );

  float pulse = 0.92 + 0.08 * sin( uTime * 33.0 + iMisc.x * 19.0 );
  float size = iScale.x * iMisc.w * pulse;
  size = max( size, dist * uPixelScale * 1.6 );

  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;

  vUv = uv;
  vColor = iColor;
  // Facing the nozzle straight-on is where the flare should dominate.
  vGain = mix( 0.45, 1.0, pow( abs( dot( normalize( axis ), normalize( cameraPosition - wp ) ) ), 1.6 ) )
        * smoothstep( 0.0, 0.08, iMisc.y );
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

void main() {
  #include <logdepthbuf_fragment>
  vec4 texel = texture2D( uMap, vUv );
  float a = texel.a * vGain * fxSoftFade( vFragW );
  if ( a <= 0.003 ) discard;
  gl_FragColor = vec4( mix( vColor, vec3( 1.0 ), 0.45 ) * texel.rgb * 1.6, a );
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

const TRAIL_RANGE = 9000;

export class EngineFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.drawCalls = 2;
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
      uniforms: { uMap: { value: ctx.sprites.flare } },
      renderOrder: 11,
      softness: 12,
    });

    this.plumeCount = 0;

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
      wantsTrail: (def.speed || 0) >= 260 && (def.length || 0) <= 60,
      centre: new THREE.Vector3(),
    };
    entry.defs = defs;
    entry.centre.set(0, 0, 0);
    for (const d of defs) entry.centre.add(d.pos);
    entry.centre.multiplyScalar(1 / defs.length);
    this._entries.set(entity.id, entry);
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

      const throttle = Math.max(0, Math.min(1, e.throttle === undefined ? 1 : e.throttle));
      const team = ctx.teamColour(e.team || 0);

      /* Trail bookkeeping. Distance-gated so the ribbon budget is spent on the
         fighters the camera can actually see streak. */
      if (entry.wantsTrail) {
        const want = throttle > 0.12 && dist2 < TRAIL_RANGE * TRAIL_RANGE;
        if (want && !entry.trail) {
          const r = Math.max(1.6, Math.min(16, (e.radius || 8) * 0.42));
          entry.trail = trails.acquire(team.engine, r, 0.85 + 0.5 * ctx.qscale, Math.max(5, r * 2.4));
        } else if (!want && entry.trail) {
          trails.detach(entry.trail);
          entry.trail = null;
        }
        if (entry.trail) {
          centre.copy(entry.centre).multiplyScalar(scale).applyQuaternion(oq).add(op);
          trails.feed(entry.trail, centre.x, centre.y, centre.z);
        }
      }

      if (throttle <= 0.015) continue;

      // Beyond ~14 km a plume is a pixel; drop the geometry, keep the flare.
      const far = dist2 > 14000 * 14000;

      for (let i = 0; i < entry.defs.length; i++) {
        if (n >= cap) break;
        const d = entry.defs[i];
        v.copy(d.pos).multiplyScalar(scale).applyQuaternion(oq).add(op);
        q.copy(d.quat).premultiply(oq);

        const r = d.radius * scale;
        const len = r * (2.6 + 10.5 * throttle);
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
    core.flush(n);
    flare.flush(n);
  }

  dispose() {
    this.core.dispose();
    this.flare.dispose();
    this._plumeGeo.dispose();
    this._quadGeo.dispose();
    this._entries.clear();
  }
}
