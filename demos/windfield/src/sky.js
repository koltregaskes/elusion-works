import * as THREE from '../vendor/three/build/three.module.js';
import { windUniforms } from './wind.js';

// Sky dome: gradient, sun or moon disc with glow, two procedural cloud layers projected
// onto flat decks (so they foreshorten towards the horizon like real clouds), stars and
// lightning. A matching dome is used to bake the environment map for reflections.

export const skyUniforms = {
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color() },
  uSunDisc: { value: new THREE.Color() },
  uSunSize: { value: 1 },
  uGlow: { value: 1 },
  uCloudCover: { value: 0.4 },
  uCloudDensity: { value: 1 },
  uCloudLit: { value: new THREE.Color() },
  uCloudShade: { value: new THREE.Color() },
  uCloudOffset: { value: new THREE.Vector2() },
  uHighClouds: { value: 0.3 },
  uStars: { value: 0 },
  uFlash: { value: 0 },
  uHaze: { value: 0.3 },
};

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const frag = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSunDisc;
uniform float uSunSize;
uniform float uGlow;
uniform float uCloudCover;
uniform float uCloudDensity;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec2 uCloudOffset;
uniform float uHighClouds;
uniform float uStars;
uniform float uFlash;
uniform float uHaze;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  float sunDot = dot(d, normalize(uSunDir));

  // Base gradient, with a warm band hugging the horizon on the sun side.
  float hgt = clamp(up, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(hgt, 0.45));
  float sunSide = pow(max(sunDot, 0.0), 2.0);
  col = mix(col, mix(uHorizon, uSunColor, 0.35), sunSide * (1.0 - hgt) * 0.6);
  // Below the horizon: haze colour, so distant hills dissolve into it.
  col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.08, up));

  // Stars.
  if (uStars > 0.0 && up > 0.0) {
    float h =hash(floor(d.xz * 600.0 / (0.4 + up)) + floor(d.y * 600.0));
    float star = smoothstep(0.9965, 1.0, h) * (0.6 + 0.4 * sin(uTime * 2.0 + h * 400.0));
    col += vec3(0.85, 0.9, 1.0) * star * uStars * smoothstep(0.0, 0.25, up) * 1.6;
  }

  // Sun or moon disc and glow.
  float disc = smoothstep(0.99985 - 0.00012 * uSunSize, 0.99995 - 0.00006 * uSunSize, sunDot);
  float glow = pow(max(sunDot, 0.0), 220.0) * 1.4 + pow(max(sunDot, 0.0), 22.0) * 0.32 + pow(max(sunDot, 0.0), 4.0) * 0.12;
  col += uSunColor * glow * uGlow;

  // Clouds: a low cumulus deck and a high cirrus deck.
  float cloudMask = 0.0;
  if (up > 0.003) {
    float t = 1.0 / up;
    vec2 p = d.xz * t * 0.9 + uCloudOffset;
    float n = fbm(p * 0.9);
    float detail = fbm(p * 3.7 + 5.0);
    float cover = uCloudCover;
    float thr = 0.78 - cover * 0.48;
    float c = smoothstep(thr, thr + 0.14, n + (detail - 0.5) * 0.12);
    // Self-shadow: sample towards the sun; denser there means this side is in shade.
    vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.18;
    float n2 = fbm((p + toSun) * 0.9);
    float lit = clamp(0.6 + (n - n2) * 4.5 - (c - 0.5) * 0.25, 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    // Silver lining when looking towards the sun through thin edges.
    cc += uSunColor * pow(max(sunDot, 0.0), 6.0) * (1.0 - c) * 1.4 * uGlow;
    float fade = smoothstep(0.0, 0.12, up);
    float a = clamp(c * uCloudDensity, 0.0, 1.0) * fade;
    col = mix(col, cc, a);
    cloudMask = a;

    vec2 hp = d.xz * t * 0.35 + uCloudOffset * 0.35 + vec2(40.0, 7.0);
    float hn = fbm(vec2(hp.x * 0.6, hp.y * 2.2));
    float hc = smoothstep(0.45, 0.85, hn) * uHighClouds * smoothstep(0.02, 0.2, up);
    vec3 hcol = mix(uCloudLit, uSunColor, 0.35 + sunSide * 0.5);
    col = mix(col, hcol, hc * 0.55 * (1.0 - a));
  }

  // Haze lifts the horizon.
  col = mix(col, uHorizon, uHaze * (1.0 - smoothstep(0.0, 0.35, abs(up))) * 0.6);

  // Lightning lights the clouds from inside.
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.25 + cloudMask * 1.5);

  // Disc is drawn last so clouds can cover it.
  col = mix(col, uSunDisc * 6.0, disc * (1.0 - cloudMask * 0.92));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms, uTime: windUniforms.uTime },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
  mesh.scale.setScalar(4000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// Ground mist: stacked translucent noise layers that drift with the wind.
export const mistUniforms = {
  uMist: { value: 0 },
  uMistColor: { value: new THREE.Color() },
  uMistOffset: { value: new THREE.Vector2() },
};

export function buildMist() {
  const group = new THREE.Group();
  const layers = 7;
  for (let i = 0; i < layers; i++) {
    const h = 0.25 + i * 0.55;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...mistUniforms,
        uLayer: { value: i / (layers - 1) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uMist;
        uniform vec3 uMistColor;
        uniform vec2 uMistOffset;
        uniform float uLayer;
        varying vec3 vW;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
        void main() {
          vec2 p = vW.xz * 0.025 + uMistOffset * (1.0 + uLayer * 0.6) + uLayer * 3.7;
          float n = vn(p) * 0.55 + vn(p * 2.3) * 0.3 + vn(p * 5.1) * 0.15;
          float d = distance(vW.xz, cameraPosition.xz);
          float near = smoothstep(2.0, 14.0, d);
          float far = 1.0 - smoothstep(220.0, 420.0, d);
          float a = smoothstep(0.35, 0.85, n) * uMist * near * far * (1.0 - uLayer * 0.75) * 0.22;
          gl_FragColor = vec4(uMistColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = h;
    plane.frustumCulled = false;
    plane.renderOrder = 5;
    plane.userData.baseHeight = h;
    group.add(plane);
  }
  return group;
}
