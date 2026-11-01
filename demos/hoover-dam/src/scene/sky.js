// Sky dome, sun and moon lighting, fog and a reflection environment that follows
// the time of day. +z is south (downstream), +x is east (Arizona).

import * as THREE from 'three';

const skyVert = `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix*vec4(position,1.0)).xyz - cameraPosition); gl_Position = projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0); gl_Position.z = gl_Position.w; }`;
const skyFrag = `
varying vec3 vDir; uniform vec3 uSun; uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGlow; uniform float uNight; uniform float uTime;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
float fb(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n2(p); p=p*2.03+vec2(3.1,1.7); a*=0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float y = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uTop, pow(y, 0.55));
  float sd = max(dot(d, normalize(uSun)), 0.0);
  col += uGlow * pow(sd, 6.0) * 0.55 + uGlow * pow(sd, 64.0) * 0.6;
  col += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9997, sd) * (1.0 - uNight) * 4.0;
  if (d.y < 0.0) col = mix(uHorizon, uHorizon * 0.6, min(1.0, -d.y * 4.0));
  // high desert cirrus and a few fair-weather clouds
  if (d.y > 0.0) {
    vec2 uv = d.xz / (d.y + 0.12);
    float c = fb(uv * 0.9 + vec2(uTime * 0.004, uTime * 0.002));
    float cov = smoothstep(0.52, 0.78, c) * smoothstep(0.0, 0.18, d.y);
    float streak = smoothstep(0.55, 0.9, fb(vec2(uv.x * 0.35 + uTime * 0.002, uv.y * 2.4))) * 0.5 * smoothstep(0.05, 0.3, d.y);
    vec3 lit = mix(vec3(1.0, 0.97, 0.92), uGlow * 1.2, 0.35) * (1.0 - uNight * 0.9);
    vec3 shade = mix(uHorizon, uTop, 0.4) * 0.85;
    vec3 cc = mix(shade, lit, 0.55 + 0.45 * pow(sd, 3.0));
    col = mix(col, cc, clamp(cov * 0.85 + streak * 0.6, 0.0, 0.9));
  }
  // stars
  vec3 q = floor(d * 380.0);
  float s = step(0.9965, h(q)) * uNight * smoothstep(0.02, 0.25, d.y);
  col += vec3(s) * 0.9;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const KEYS = [
  // hour, top, horizon, glow, sun intensity, hemi intensity, fog
  [0, 0x05070d, 0x0d1220, 0x1a2133, 0.0, 0.2, 0x0b0f1a],
  [5, 0x0b1022, 0x2a2a3a, 0x7a4a3a, 0.0, 0.16, 0x1d1d28],
  [6, 0x30508a, 0xe8a070, 0xff9a50, 1.2, 0.45, 0x8c7466],
  [8, 0x3d74c4, 0xbfd3e6, 0xffd9a0, 2.6, 0.8, 0xb8c4cf],
  [12, 0x3a78cf, 0xcfdcea, 0xfff1d6, 3.2, 0.95, 0xc6d0da],
  [17, 0x3f6fb8, 0xd8c8b0, 0xffcf8a, 2.6, 0.8, 0xc4b8a8],
  [19.3, 0x354a80, 0xf0905a, 0xff7a3a, 1.2, 0.5, 0xa07060],
  [20.3, 0x101833, 0x40304a, 0x803a3a, 0.0, 0.26, 0x2a2333],
  [24, 0x05070d, 0x0d1220, 0x1a2133, 0.0, 0.2, 0x0b0f1a],
];

function sample(hour) {
  for (let i = 1; i < KEYS.length; i++) {
    if (hour <= KEYS[i][0]) {
      const a = KEYS[i - 1], b = KEYS[i], t = (hour - a[0]) / (b[0] - a[0]);
      const c = (ia) => new THREE.Color(a[ia]).lerp(new THREE.Color(b[ia]), t);
      return { top: c(1), horizon: c(2), glow: c(3), sun: a[4] + (b[4] - a[4]) * t, hemi: a[5] + (b[5] - a[5]) * t, fog: c(6) };
    }
  }
  return sample(23.99);
}

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.uniforms = {
      uSun: { value: new THREE.Vector3(0, 1, 0) }, uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() }, uNight: { value: 0 }, uTime: { value: 0 },
    };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(6000, 48, 24), new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false }));
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -520; sc.right = 520; sc.top = 520; sc.bottom = -520; sc.near = 10; sc.far = 3000;
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 1.0;
    this.sun.target.position.set(0, 80, 60);
    scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x8aa0d0, 0.0);
    this.moon.position.set(-600, 900, -400);
    scene.add(this.moon);
    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x5a4636, 0.8);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xc6d0da, 0.00026);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.dome.material);
    this.envScene.add(this.envDome);
    this.envRT = null;
    this.lastEnvHour = -10;
    this.night = 0;
  }

  get envMap() { return this.envRT ? this.envRT.texture : null; }

  set(hour) {
    const k = sample(hour);
    // Summer sun over the Mojave: rises ~05:30 ENE, sets ~19:50 WNW, ~75° at 12:45.
    const t = (hour - 5.5) / (19.85 - 5.5);
    const el = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * 75 * Math.PI / 180 - (t < 0 || t > 1 ? 0.3 : 0);
    const az = (62 + 236 * t) * Math.PI / 180;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.uniforms.uSun.value.copy(dir);
    this.uniforms.uTop.value.copy(k.top); this.uniforms.uHorizon.value.copy(k.horizon); this.uniforms.uGlow.value.copy(k.glow);
    const night = 1 - Math.min(1, Math.max(0, k.sun / 1.2));
    this.night = night;
    this.uniforms.uNight.value = night;
    this.sun.position.copy(dir).multiplyScalar(1500).add(this.sun.target.position);
    this.sun.intensity = k.sun;
    this.sun.color.copy(k.glow).lerp(new THREE.Color(0xffffff), 0.55);
    this.moon.intensity = night * 0.9;
    this.hemi.intensity = k.hemi;
    this.hemi.color.copy(k.top).lerp(new THREE.Color(0xffffff), 0.5);
    this.scene.fog.color.copy(k.horizon).lerp(k.fog, 0.5);
    const nowMs = performance.now();
    if (Math.abs(hour - this.lastEnvHour) > 0.25 && nowMs - (this.lastEnvMs || -1e9) > 1500) {
      this.lastEnvHour = hour; this.lastEnvMs = nowMs;
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      return true; // env changed
    }
    return false;
  }
}
