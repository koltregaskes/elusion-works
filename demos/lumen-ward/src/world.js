// Sky, fog, environment lighting, wet streets, rain and steam.
import * as THREE from '../vendor/three/build/three.module.min.js';
import { Reflector } from '../vendor/three/addons/objects/Reflector.js';
import { shared } from './kit.js';
import { ROADS, EDGE, HALF_ROAD, PLAZA } from './city.js';

export const FOG = new THREE.Color().setRGB(0.06, 0.032, 0.08);

const NOISE = /* glsl */ `
float n2h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(n2h(i), n2h(i + vec2(1, 0)), u.x), mix(n2h(i + vec2(0, 1)), n2h(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }`;

export function addSky(scene) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: shared.time, uFog: { value: FOG } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uFog; varying vec3 vD;
      ${NOISE}
      void main() {
        float y = vD.y;
        vec3 zen = vec3(0.006, 0.006, 0.018);
        vec3 mid = vec3(0.03, 0.018, 0.06);
        vec3 c = mix(uFog * 1.25, mid, smoothstep(0.0, 0.18, y));
        c = mix(c, zen, smoothstep(0.18, 0.7, y));
        // low cloud deck lit from below by the city
        vec2 uv = vD.xz / max(0.08, y + 0.12) * 1.4;
        float cl = fbm(uv + vec2(uTime * 0.006, 0.0));
        float lit = smoothstep(0.45, 0.85, cl) * smoothstep(0.75, 0.05, y) * smoothstep(-0.05, 0.08, y);
        c += vec3(0.16, 0.05, 0.12) * lit * 0.8;
        c += vec3(0.02, 0.05, 0.09) * smoothstep(0.55, 0.9, cl) * smoothstep(0.9, 0.2, y) * 0.6;
        if (y < 0.0) c = uFog * 1.25;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), m);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  return sky;
}

// Small emissive room for glossy reflections: dark, with neon panels.
export function makeEnv(renderer) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x020205);
  const box = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: 0x07050c, side: THREE.BackSide }));
  s.add(box);
  const panel = (c, i, x, y, z, w, h, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    s.add(m);
  };
  panel(0xff2a8a, 3, -19, 3, 4, 10, 4, Math.PI / 2);
  panel(0x22e6ff, 3, 19, 4, -6, 12, 3, -Math.PI / 2);
  panel(0xffa040, 2, 4, 2, 19, 14, 3, Math.PI);
  panel(0x8a5cff, 2, -6, 5, -19, 10, 3, 0);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2a1a3a) }));
  top.position.y = 9.9;
  top.rotation.x = Math.PI / 2;
  s.add(top);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.04);
  pm.dispose();
  return rt.texture;
}

const GroundShader = {
  name: 'LumenWetGround',
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uTime: { value: 0 }, uRefl: { value: 1 } },
  ]),
  vertexShader: /* glsl */ `
    #include <common>
    #include <fog_pars_vertex>
    uniform mat4 textureMatrix;
    varying vec4 vUv; varying vec3 vW;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vW = (modelMatrix * vec4(position, 1.0)).xyz;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `
    #include <common>
    #include <fog_pars_fragment>
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uRefl;
    varying vec4 vUv; varying vec3 vW;
    ${NOISE}
    void main() {
      vec2 p = vW.xz;
      float grain = fbm(p * 0.9);
      float puddle = smoothstep(0.5, 0.58, fbm(p * 0.05 + 7.0) * 0.75 + fbm(p * 0.21) * 0.35);
      // road vs pavement tint
      vec3 base = vec3(0.012, 0.012, 0.016) * (0.7 + 0.6 * grain);
      // rain ripples
      vec2 rip = vec2(n2(p * 2.3 + uTime * 1.7), n2(p * 2.3 - uTime * 1.3 + 9.0)) - 0.5;
      vec2 sUv = vUv.xy / vUv.w;
      float d = mix(0.0035, 0.0012, puddle);
      vec2 o = rip * d;
      vec3 sharp = texture2D(tDiffuse, sUv + o).rgb;
      vec3 streak = vec3(0.0);
      float wsum = 0.0;
      for (int k = -3; k <= 3; k++) {
        float w = 1.0 - abs(float(k)) / 4.0;
        streak += texture2D(tDiffuse, sUv + o * 1.5 + vec2(0.0, float(k) * 0.006)).rgb * w;
        wsum += w;
      }
      streak /= wsum;
      vec3 refl = mix(streak * 0.42, sharp * 0.92, puddle);
      vec3 c = base * (1.0 - puddle * 0.6) + refl * uRefl;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
};

export function addGround(scene, city, { reflections, resScale }) {
  const geo = new THREE.PlaneGeometry(1400, 1400);
  let ground;
  if (reflections) {
    const w = Math.max(256, Math.floor(window.innerWidth * resScale));
    const h = Math.max(256, Math.floor(window.innerHeight * resScale));
    ground = new Reflector(geo, { textureWidth: w, textureHeight: h, clipBias: 0.003, shader: GroundShader, multisample: 0 });
    ground.material.uniforms.uTime = shared.time;
    ground.material.fog = true;
    ground.userData.resize = (W, H) => ground.getRenderTarget().setSize(Math.floor(W * resScale), Math.floor(H * resScale));
  } else {
    ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x07070a, roughness: 0.22, metalness: 0.3, envMapIntensity: 0.8 }));
  }
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // pavements: one instanced unit box per block, wet concrete
  const pave = new THREE.MeshStandardMaterial({ color: 0x1a1a20, roughness: 0.35, metalness: 0.1, envMapIntensity: 0.7 });
  const pv = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), pave, city.sidewalks.length);
  const m = new THREE.Matrix4();
  city.sidewalks.forEach((s, i) => {
    m.compose(new THREE.Vector3((s.x0 + s.x1) / 2, 0.075, (s.z0 + s.z1) / 2), new THREE.Quaternion(), new THREE.Vector3(s.x1 - s.x0, 0.15, s.z1 - s.z0));
    pv.setMatrixAt(i, m);
  });
  pv.computeBoundingSphere();
  scene.add(pv);
  // curb edge strip (lighter)
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.5 });
  const curbs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), curbMat, city.sidewalks.length * 4);
  let ci = 0;
  for (const s of city.sidewalks) {
    const w = s.x1 - s.x0;
    const d = s.z1 - s.z0;
    for (const [x, z, sx, sz] of [[(s.x0 + s.x1) / 2, s.z0, w, 0.3], [(s.x0 + s.x1) / 2, s.z1, w, 0.3], [s.x0, (s.z0 + s.z1) / 2, 0.3, d], [s.x1, (s.z0 + s.z1) / 2, 0.3, d]]) {
      m.compose(new THREE.Vector3(x, 0.08, z), new THREE.Quaternion(), new THREE.Vector3(sx, 0.17, sz));
      curbs.setMatrixAt(ci++, m);
    }
  }
  curbs.computeBoundingSphere();
  scene.add(curbs);

  // road markings: centre dashes and crossings
  const dashes = [];
  const cross = [];
  for (const c of ROADS) {
    for (const axis of ['x', 'z']) {
      for (let a = -EDGE - 30; a <= EDGE + 30; a += 6) {
        const nearX = ROADS.some((r) => Math.abs(a - r) < HALF_ROAD + 4);
        if (nearX) continue;
        if (Math.abs(a) < PLAZA + 2 && c === 0) continue;
        dashes.push(axis === 'x' ? [a, c, 3, 0.16] : [c, a, 0.16, 3]);
      }
      for (const r of ROADS) {
        for (const side of [-1, 1]) {
          const a = r + side * (HALF_ROAD + 5);
          if (c === 0 && Math.abs(a) < PLAZA + 2) continue;
          for (let k = -4; k <= 4; k++) {
            const lat = c + k * 1.1;
            cross.push(axis === 'x' ? [a, lat, 2.6, 0.55] : [lat, a, 0.55, 2.6]);
          }
        }
      }
    }
  }
  const markMat = new THREE.MeshStandardMaterial({ color: 0x8a8a90, roughness: 0.6, emissive: 0x202024 });
  const marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), markMat, dashes.length + cross.length);
  let mi = 0;
  for (const [x, z, sx, sz] of [...dashes, ...cross]) {
    m.compose(new THREE.Vector3(x, 0.012, z), new THREE.Quaternion(), new THREE.Vector3(sx, 1, sz));
    marks.setMatrixAt(mi++, m);
  }
  marks.computeBoundingSphere();
  scene.add(marks);

  // plaza rings
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.6, 0.9).multiplyScalar(1.4) });
  for (const r of [10.5, 19, 27]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 96).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.015;
    scene.add(ring);
  }
  return ground;
}

export function addRain(scene, count) {
  const base = new Float32Array(count * 2 * 3);
  const end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = Math.random();
    const y = Math.random();
    const z = Math.random();
    for (let k = 0; k < 2; k++) {
      base.set([x, y, z], (i * 2 + k) * 3);
      end[i * 2 + k] = k;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(base, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: shared.time, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(60, 40, 60) } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; attribute float aEnd; varying float vA;
      void main() {
        vec3 p = position * uBox;
        p.y -= uTime * 26.0;
        p.x -= uTime * 3.0;
        vec3 rel = mod(p - uCam, uBox) - uBox * 0.5;
        vec3 w = uCam + rel;
        w += vec3(0.11, 0.95, 0.0) * aEnd * 0.9;
        vA = (1.0 - smoothstep(10.0, 30.0, length(rel))) * (0.4 + 0.6 * aEnd);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(vec3(0.55, 0.62, 0.75) * vA * 0.2, 1.0); }`,
  });
  const rain = new THREE.LineSegments(g, m);
  rain.frustumCulled = false;
  rain.renderOrder = 5;
  scene.add(rain);
  return rain;
}

export function addSteam(scene, vents) {
  const per = 14;
  const n = vents.length * per;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  vents.forEach((v, i) => {
    for (let k = 0; k < per; k++) {
      pos.set([v.x, v.y, v.z], (i * per + k) * 3);
      seed[i * per + k] = k / per + Math.random() * 0.05;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uScale: { value: 600 } }]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime; uniform float uScale; attribute float aSeed; varying float vA;
      void main() {
        float t = fract(uTime * 0.12 + aSeed);
        vec3 p = position + vec3(sin(aSeed * 40.0 + uTime) * t * 1.5 + t * 2.0, t * 9.0, cos(aSeed * 33.0) * t * 1.5);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = (1.2 + t * 6.0) * uScale / -mvPosition.z;
        vA = smoothstep(0.0, 0.15, t) * (1.0 - t);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(c)) * vA * 0.16;
        gl_FragColor = vec4(vec3(0.55, 0.5, 0.6), a);
        #include <fog_fragment>
      }`,
  });
  m.uniforms.uTime = shared.time;
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  scene.add(pts);
  return pts;
}
