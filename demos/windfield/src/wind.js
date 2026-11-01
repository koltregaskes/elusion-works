import * as THREE from '../vendor/three/build/three.module.js';
import { makeSimplex } from './noise.js';

// Single wind field shared by every swaying thing in the scene. The GPU version drives
// grass, flowers, trees and particles; the CPU mirror feeds audio and falling leaves so
// what you hear and what tumbles past matches the gust you can see rolling over the field.

export const windUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(1, 0) },
  uWindStrength: { value: 0.5 },
  uGustStrength: { value: 1 },
  uGustScale: { value: 1 / 30 },
  uGustSpeed: { value: 1 },
  uTurbulence: { value: 0.4 },
};

export const WIND_GLSL = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uGustStrength;
uniform float uGustScale;
uniform float uGustSpeed;
uniform float uTurbulence;

vec3 wf_permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float wf_snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = wf_permute(wf_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// 0..1 gust intensity at a world position. Bands are stretched across the wind so they
// read as waves rolling over the field rather than blotches.
float windGust(vec2 p) {
  vec2 d = normalize(uWindDir + 1e-5);
  vec2 perp = vec2(-d.y, d.x);
  vec2 q = vec2(dot(p, d), dot(p, perp) * 0.45) * uGustScale;
  q.x -= uTime * uGustSpeed * 0.55;
  float n = wf_snoise(q) * 0.5 + 0.5;
  float n2 = wf_snoise(q * 2.7 + vec2(13.1, -7.3) - vec2(uTime * uGustSpeed * 0.4, 0.0)) * 0.5 + 0.5;
  return smoothstep(0.32, 0.9, n * 0.72 + n2 * 0.28);
}

// Horizontal push (xz) at a point, scaled 0..~2. phase de-syncs neighbours.
vec2 windPush(vec2 p, float phase, out float gust) {
  gust = windGust(p);
  vec2 d = normalize(uWindDir + 1e-5);
  float steady = uWindStrength * (0.28 + gust * uGustStrength * 0.9);
  float flutter = sin(uTime * (3.1 + uWindStrength * 4.0) + phase * 6.2831 + dot(p, d) * 0.7);
  flutter += 0.5 * sin(uTime * 7.3 + phase * 17.0);
  vec2 perp = vec2(-d.y, d.x);
  vec2 push = d * steady + (d * 0.4 + perp) * flutter * uTurbulence * (0.05 + uWindStrength * 0.16);
  return push;
}
`;

const n = makeSimplex(4242);

// CPU mirror of windGust for a single point (approximate: one octave is enough for audio).
export function cpuGust(x, z, t) {
  const d = windUniforms.uWindDir.value;
  const len = Math.hypot(d.x, d.y) || 1;
  const dx = d.x / len;
  const dz = d.y / len;
  const s = windUniforms.uGustScale.value;
  const qx = (x * dx + z * dz) * s - t * windUniforms.uGustSpeed.value * 0.55;
  const qy = (x * -dz + z * dx) * 0.45 * s;
  const v = n(qx, qy) * 0.5 + 0.5;
  const k = Math.min(1, Math.max(0, (v - 0.32) / 0.58));
  return k * k * (3 - 2 * k);
}
