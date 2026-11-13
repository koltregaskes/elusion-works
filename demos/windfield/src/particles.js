import * as THREE from '../vendor/three/build/three.module.js';
import { heightAt, heightAtFast } from './terrain.js';
import { makeRng } from './noise.js';
import { windUniforms, cpuGust } from './wind.js';

// GPU particle systems: every point's motion is a pure function of its seed and time, so
// nothing is simulated on the CPU. Each system has an amount uniform; points whose seed is
// above the amount simply vanish, which is how presets fade them in and out.

export const particleUniforms = {
  uPixelRatio: { value: 1 },
  uPollen: { value: 0 },
  uFireflies: { value: 0 },
  uEmbers: { value: 0 },
  uRain: { value: 0 },
  uFirePos: { value: new THREE.Vector3() },
  uSunViewDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunTint: { value: new THREE.Color() },
};

const COMMON = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uPixelRatio;
attribute vec4 aSeed;
vec3 wrapAround(vec3 p, vec3 box) {
  vec3 rel = p - cameraPosition;
  rel = mod(rel + box * 0.5, box) - box * 0.5;
  return cameraPosition + rel;
}
`;

function points(count, seed, extra = (geo, rng, i) => {}) {
  const rng = makeRng(seed);
  const geo = new THREE.BufferGeometry();
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    seeds.set([rng(), rng(), rng(), rng()], i * 4);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  extra(geo, rng);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return geo;
}

function system(geo, vertexBody, fragmentBody, opts = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...windUniforms, ...particleUniforms },
    vertexShader: `${COMMON}\n${opts.vertexHead || ''}\nvoid main() {\n${vertexBody}\n}`,
    fragmentShader: `${opts.fragmentHead || ''}\nvoid main() {\n${fragmentBody}\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`,
    transparent: true,
    depthWrite: false,
    blending: opts.blending ?? THREE.AdditiveBlending,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  p.renderOrder = 8;
  return p;
}

export function buildParticles() {
  const group = new THREE.Group();

  // Pollen and seed fluff, glinting when you look towards the sun.
  group.add(system(
    points(2600, 3),
    `
    vec3 box = vec3(70.0, 12.0, 70.0);
    vec2 wd = normalize(uWindDir + 1e-5);
    vec3 drift = vec3(wd.x, 0.0, wd.y) * uTime * (0.6 + uWindStrength * 3.5);
    vec3 p = (aSeed.xyz - 0.5) * box + drift;
    p += vec3(sin(uTime * 0.7 + aSeed.w * 30.0), sin(uTime * 0.5 + aSeed.x * 20.0) * 0.6, cos(uTime * 0.6 + aSeed.y * 25.0)) * 0.8;
    p = wrapAround(p, box);
    p.y = cameraPosition.y + (aSeed.y - 0.35) * 8.0 + sin(uTime * 0.4 + aSeed.z * 9.0) * 0.6;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float on = step(aSeed.w, uPollen);
    vec3 v = normalize(mv.xyz);
    vGlint = 0.15 + pow(max(dot(v, uSunViewDir), 0.0), 8.0) * 1.6;
    vFade = smoothstep(32.0, 6.0, -mv.z) * smoothstep(0.4, 1.5, -mv.z);
    gl_PointSize = on * (1.0 + aSeed.x * 1.6) * uPixelRatio * (13.0 / -mv.z);
    if (on < 0.5) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    `,
    `
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(c));
    gl_FragColor = vec4(uSunTint * vGlint * a * vFade * 0.35, 1.0);
    `,
    {
      vertexHead: 'uniform float uPollen; uniform vec3 uSunViewDir; varying float vGlint; varying float vFade;',
      fragmentHead: 'uniform vec3 uSunTint; varying float vGlint; varying float vFade;',
    }
  ));

  // Fireflies: hover low over the grass around the stage and blink out of sync.
  const ffCount = 500;
  group.add(system(
    points(ffCount, 9, (geo, rng) => {
      const base = new Float32Array(ffCount * 3);
      for (let i = 0; i < ffCount; i++) {
        const a = rng() * Math.PI * 2;
        const r = 4 + Math.pow(rng(), 0.7) * 48;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        base.set([x, heightAt(x, z), z], i * 3);
      }
      geo.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
    }),
    `
    vec3 p = aBase;
    float t = uTime * (0.25 + aSeed.x * 0.3) + aSeed.y * 40.0;
    p += vec3(sin(t) * 1.8 + sin(t * 2.3) * 0.5, 0.0, cos(t * 0.9) * 1.8 + cos(t * 1.7) * 0.5);
    p.y += 0.35 + aSeed.z * 1.6 + sin(t * 1.3) * 0.3;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float on = step(aSeed.w, uFireflies);
    float blink = pow(max(sin(uTime * (0.8 + aSeed.z * 1.4) + aSeed.w * 60.0), 0.0), 5.0);
    vBlink = blink * on;
    gl_PointSize = on * uPixelRatio * (30.0 / -mv.z) * (3.5 + blink * 4.5);
    if (on < 0.5) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    `,
    `
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.12, 0.0, d);
    vec3 col = vec3(0.75, 1.0, 0.35) * (a * a * 0.6 + core * 1.6) * vBlink * 1.3;
    gl_FragColor = vec4(col, 1.0);
    `,
    {
      vertexHead: 'uniform float uFireflies; attribute vec3 aBase; varying float vBlink;',
      fragmentHead: 'varying float vBlink;',
    }
  ));

  // Embers from the bonfire, carried downwind as they rise and cool.
  group.add(system(
    points(700, 21),
    `
    float life = fract(uTime * (0.16 + aSeed.x * 0.14) + aSeed.y);
    vec2 wd = normalize(uWindDir + 1e-5);
    vec3 p = uFirePos;
    float spread = 1.2 + life * 6.0;
    vec2 jit = vec2(fract(aSeed.z * 7.31 + aSeed.x), fract(aSeed.w * 3.77 + aSeed.y)) - 0.5;
    p += vec3(jit.x * spread, 0.6 + life * (6.0 + aSeed.w * 8.0), jit.y * spread);
    p.xz += wd * life * life * (4.0 + uWindStrength * 14.0);
    p += vec3(sin(uTime * 2.0 + aSeed.z * 30.0), 0.0, cos(uTime * 1.7 + aSeed.y * 30.0)) * life * 0.9;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float on = step(aSeed.w, uEmbers);
    vLife = life;
    vFlick = 0.6 + 0.4 * sin(uTime * 14.0 + aSeed.x * 90.0);
    gl_PointSize = on * uPixelRatio * (30.0 / -mv.z) * (2.0 + aSeed.z * 3.0) * (1.0 - life * 0.6);
    if (on < 0.5) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    `,
    `
    vec2 c = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.05, length(c));
    vec3 hot = vec3(1.0, 0.75, 0.35);
    vec3 cool = vec3(0.8, 0.12, 0.02);
    vec3 col = mix(hot, cool, smoothstep(0.0, 0.7, vLife)) * (1.0 - smoothstep(0.6, 1.0, vLife));
    gl_FragColor = vec4(col * a * vFlick * 3.0, 1.0);
    `,
    {
      vertexHead: 'uniform float uEmbers; uniform vec3 uFirePos; varying float vLife; varying float vFlick;',
      fragmentHead: 'varying float vLife; varying float vFlick;',
    }
  ));

  // Rain streaks, slanted by the wind.
  group.add(system(
    points(7000, 33),
    `
    vec3 box = vec3(46.0, 26.0, 46.0);
    vec2 wd = normalize(uWindDir + 1e-5);
    float fall = uTime * (16.0 + aSeed.w * 6.0);
    vec3 p = (aSeed.xyz - 0.5) * box;
    p.y -= fall;
    p.xz += wd * fall * 0.18 * (0.3 + uWindStrength);
    p = wrapAround(p, box);
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float on = step(aSeed.w, uRain);
    vec4 clipD = projectionMatrix * viewMatrix * vec4(p + vec3(wd.x, -5.0, wd.y) * 0.1, 1.0);
    vSlant = clamp((clipD.x / clipD.w - gl_Position.x / gl_Position.w) / max(abs(clipD.y / clipD.w - gl_Position.y / gl_Position.w), 1e-4), -2.0, 2.0);
    vFade = smoothstep(26.0, 3.0, -mv.z);
    gl_PointSize = on * uPixelRatio * (40.0 / -mv.z) * 10.0;
    if (on < 0.5) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    `,
    `
    vec2 c = gl_PointCoord - 0.5;
    float x = c.x + c.y * vSlant;
    float a = smoothstep(0.035, 0.0, abs(x)) * smoothstep(0.5, 0.2, abs(c.y));
    gl_FragColor = vec4(vec3(0.75, 0.8, 0.88) * a * vFade * 0.35, a * vFade * 0.35);
    `,
    {
      vertexHead: 'uniform float uRain; varying float vSlant; varying float vFade;',
      fragmentHead: 'varying float vSlant; varying float vFade;',
      blending: THREE.NormalBlending,
    }
  ));

  return group;
}

// Falling leaves are few enough (and need tumbling rotation) to simulate on the CPU.
function singleLeafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.translate(32, 32);
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    g.ellipse(0, (k - 1) * 9, 12 - Math.abs(k - 1) * 3, 10, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillRect(-1, 10, 2, 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FallingLeaves {
  constructor(max = 260) {
    this.max = max;
    this.amount = 0;
    this.source = new THREE.Vector3(0, 14, 0);
    this.sourceRadius = 8;
    const geo = new THREE.PlaneGeometry(0.16, 0.16);
    this.mat = new THREE.MeshStandardMaterial({
      map: singleLeafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, color: '#b5561d',
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.rng = makeRng(61);
    this.leaves = [];
    for (let i = 0; i < max; i++) this.leaves.push(this.spawn({}, true));
    this.dummy = new THREE.Object3D();
  }

  spawn(l, initial = false) {
    const r = this.rng;
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * this.sourceRadius;
    l.p = new THREE.Vector3(
      this.source.x + Math.cos(a) * rad,
      this.source.y + (r() - 0.5) * 6 - (initial ? r() * this.source.y : 0),
      this.source.z + Math.sin(a) * rad
    );
    l.v = new THREE.Vector3();
    l.rot = new THREE.Euler(r() * 6, r() * 6, r() * 6);
    l.spin = new THREE.Vector3((r() - 0.5) * 6, (r() - 0.5) * 6, (r() - 0.5) * 6);
    l.phase = r() * 10;
    l.id = r();
    l.rest = 0;
    return l;
  }

  update(dt, t) {
    const wd = windUniforms.uWindDir.value;
    const ws = windUniforms.uWindStrength.value;
    const len = Math.hypot(wd.x, wd.y) || 1;
    const d = this.dummy;
    for (let i = 0; i < this.max; i++) {
      const l = this.leaves[i];
      const active = l.id < this.amount;
      if (!active) {
        d.position.set(0, -999, 0);
        d.scale.setScalar(0.0001);
        d.updateMatrix();
        this.mesh.setMatrixAt(i, d.matrix);
        continue;
      }
      const g = cpuGust(l.p.x, l.p.z, t);
      const push = ws * (0.4 + g * 1.4) * 3.2;
      const target = new THREE.Vector3((wd.x / len) * push, -0.9 + Math.sin(t * 2 + l.phase) * 0.5, (wd.y / len) * push);
      target.x += Math.sin(t * 1.7 + l.phase) * 0.8;
      target.z += Math.cos(t * 1.3 + l.phase) * 0.8;
      l.v.lerp(target, Math.min(1, dt * 1.5));
      const ground = heightAtFast(l.p.x, l.p.z) + 0.05;
      if (l.p.y > ground) {
        l.p.addScaledVector(l.v, dt);
        l.rot.x += l.spin.x * dt;
        l.rot.y += l.spin.y * dt;
        l.rot.z += l.spin.z * dt;
      } else {
        l.rest += dt;
        l.p.y = ground;
        if (l.rest > 2.5 || Math.hypot(l.p.x, l.p.z) > 120) this.spawn(l);
      }
      if (Math.hypot(l.p.x - this.source.x, l.p.z - this.source.z) > 140) this.spawn(l);
      d.position.copy(l.p);
      d.rotation.copy(l.rot);
      d.scale.setScalar(1 + (l.id * 7) % 0.6);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// A loose flock wheeling over the far side of the field. Wings flap in the vertex shader.
export class Birds {
  constructor(max = 36) {
    this.max = max;
    this.amount = 0;
    const pos = [
      // body
      0, 0, 0.32, -0.05, 0, -0.1, 0.05, 0, -0.1,
      0, 0, 0.32, 0.05, 0, -0.1, 0, -0.04, -0.3,
      0, 0, 0.32, 0, -0.04, -0.3, -0.05, 0, -0.1,
      // left wing
      -0.04, 0, 0.12, -0.04, 0, -0.08, -0.62, 0, -0.02,
      // right wing
      0.04, 0, 0.12, 0.62, 0, -0.02, 0.04, 0, -0.08,
    ];
    const wing = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.1, 1, 0.1, 1, 0.1];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    geo.computeVertexNormals();
    const phases = new Float32Array(max);
    const rng = makeRng(3);
    for (let i = 0; i < max; i++) phases[i] = rng() * 10;
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    this.mat = new THREE.MeshBasicMaterial({ color: '#1a1d22', side: THREE.DoubleSide });
    this.mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = windUniforms.uTime;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aWing;\nattribute float aPhase;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float flap = sin(uTime * 9.0 + aPhase * 6.0);
          float glide = smoothstep(0.2, 0.8, sin(uTime * 0.6 + aPhase));
          transformed.y += flap * aWing * 0.38 * (1.0 - glide * 0.8);`
        );
    };
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.frustumCulled = false;
    this.offsets = [];
    for (let i = 0; i < max; i++) {
      this.offsets.push(new THREE.Vector3((rng() - 0.5) * 22, (rng() - 0.5) * 6, (rng() - 0.5) * 22));
    }
    this.dummy = new THREE.Object3D();
    this.prev = [];
  }

  pathAt(t, i) {
    const o = this.offsets[i];
    const tt = t * 0.045 + i * 0.002;
    const c = new THREE.Vector3(Math.cos(tt) * 95, 34 + Math.sin(tt * 2.3) * 6, Math.sin(tt * 1.3) * 80);
    const swirl = t * 0.3 + i;
    return c.add(new THREE.Vector3(
      o.x + Math.sin(swirl) * 3,
      o.y + Math.sin(swirl * 1.3) * 1.5,
      o.z + Math.cos(swirl * 0.8) * 3
    ));
  }

  update(t) {
    const d = this.dummy;
    for (let i = 0; i < this.max; i++) {
      const on = i / this.max < this.amount;
      const p = this.pathAt(t, i);
      const ahead = this.pathAt(t + 0.15, i);
      d.position.copy(p);
      d.lookAt(ahead);
      d.scale.setScalar(on ? 1.6 : 0.0001);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
