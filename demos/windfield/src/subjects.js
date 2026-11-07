import * as THREE from '../vendor/three/build/three.module.js';
import { heightAt } from './terrain.js';
import { makeRng, makeSimplex } from './noise.js';
import { windUniforms } from './wind.js';

// The things that stand in the middle of the field (besides the oak), and the bonfire.

export function buildMonolith() {
  const group = new THREE.Group();
  const y = heightAt(0, 0);
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 7.6, 0.8, 1, 1, 1),
    new THREE.MeshPhysicalMaterial({
      color: '#0b0c0e', metalness: 0.55, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.08,
    })
  );
  slab.position.y = 3.6;
  slab.castShadow = true;
  slab.receiveShadow = true;
  group.add(slab);

  // A copper seam down both faces, breathing slowly.
  const seamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#d7a16f').multiplyScalar(3) });
  for (const z of [0.405, -0.405]) {
    const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 7.0), seamMat);
    seam.position.set(0, 3.6, z);
    if (z < 0) seam.rotation.y = Math.PI;
    group.add(seam);
  }
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.6, 0.25, 48),
    new THREE.MeshStandardMaterial({ color: '#2a2a28', roughness: 0.9 })
  );
  plinth.position.y = -0.05;
  plinth.receiveShadow = true;
  group.add(plinth);
  group.position.y = y - 0.1;
  group.rotation.y = 0.5;
  group.userData.update = (t, accent) => {
    seamMat.color.copy(accent).multiplyScalar(2.2 + Math.sin(t * 0.9) * 0.9);
  };
  return group;
}

export function buildStones() {
  const group = new THREE.Group();
  const rng = makeRng(17);
  const noise = makeSimplex(23);
  const mat = new THREE.MeshStandardMaterial({ color: '#7d7a70', roughness: 0.95, flatShading: true });
  const count = 11;
  const radius = 7.2;
  for (let i = 0; i < count; i++) {
    if (i === 7) continue; // a gap, as if one fell long ago
    const a = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.12;
    const h = 2.2 + rng() * 1.6;
    const geo = new THREE.BoxGeometry(1.1 + rng() * 0.5, h, 0.55 + rng() * 0.3, 3, 6, 2);
    const p = geo.attributes.position;
    const col = [];
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v), yy = p.getY(v), z = p.getZ(v);
      const n = noise(x * 1.7 + i * 10, yy * 1.3 + z * 1.9);
      const taper = 1 - Math.max(0, yy / h) * 0.35;
      p.setXYZ(v, x * taper + n * 0.09, yy + (yy > h * 0.45 ? n * 0.25 : 0), z * taper + n * 0.07);
      const lichen = Math.max(0, noise(x * 3 + i, yy * 3) * 0.5 + 0.5 - 0.35);
      const base = 0.78 + n * 0.12;
      col.push(base + lichen * 0.15, base + lichen * 0.35, base - lichen * 0.1);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    mat.vertexColors = true;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    m.position.set(x, heightAt(x, z) + h / 2 - 0.35, z);
    m.rotation.set((rng() - 0.5) * 0.12, -a + Math.PI / 2 + (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.1);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  // The fallen one.
  const fallen = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.6, 1.0, 4, 1, 2), mat);
  const fa = (7 / count) * Math.PI * 2;
  const fx = Math.cos(fa) * (radius + 1.4);
  const fz = Math.sin(fa) * (radius + 1.4);
  fallen.position.set(fx, heightAt(fx, fz) + 0.05, fz);
  fallen.rotation.y = -fa + 0.3;
  fallen.castShadow = true;
  fallen.receiveShadow = true;
  group.add(fallen);
  return group;
}

export class Bonfire {
  constructor() {
    this.group = new THREE.Group();
    this.amount = 0;
    const logMat = new THREE.MeshStandardMaterial({ color: '#2a1d14', roughness: 1, emissive: '#ff4a10', emissiveIntensity: 0 });
    this.logMat = logMat;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 2.2, 7), logMat);
      log.position.set(Math.cos(a) * 0.45, 0.85, Math.sin(a) * 0.45);
      log.rotation.set(0, 0, 0);
      log.lookAt(0, 3.0, 0);
      log.rotateX(Math.PI / 2);
      log.castShadow = true;
      this.group.add(log);
    }
    this.flameMat = new THREE.ShaderMaterial({
      uniforms: { uTime: windUniforms.uTime, uAmount: { value: 0 }, uWindDir: windUniforms.uWindDir, uWindStrength: windUniforms.uWindStrength },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec2 uWindDir;
        uniform float uWindStrength;
        void main() {
          vUv = uv;
          vec3 p = position;
          vec4 w = modelMatrix * vec4(p, 1.0);
          w.xz += normalize(uWindDir + 1e-5) * uv.y * uv.y * (0.3 + uWindStrength * 0.9);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uAmount;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
        void main() {
          vec2 uv = vUv;
          float n = vn(vec2(uv.x * 5.0, uv.y * 4.0 - uTime * 3.2)) * 0.6 + vn(vec2(uv.x * 11.0, uv.y * 9.0 - uTime * 5.5)) * 0.4;
          float w = (1.0 - pow(uv.y, 0.8)) * 0.46 + 0.05;
          float shape = 1.0 - smoothstep(w * 0.3, w, abs(uv.x - 0.5) + (n - 0.5) * 0.4 * uv.y);
          shape *= smoothstep(1.0, 0.25, uv.y + n * 0.35) * smoothstep(0.0, 0.08, uv.y);
          vec3 col = mix(vec3(1.0, 0.7, 0.32), vec3(1.0, 0.22, 0.03), smoothstep(0.05, 0.6, uv.y + n * 0.2));
          gl_FragColor = vec4(col * shape * 1.8 * uAmount, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.2), this.flameMat);
      f.position.y = 2.0;
      f.rotation.y = (i / 4) * Math.PI;
      f.renderOrder = 9;
      this.group.add(f);
    }
    this.light = new THREE.PointLight('#ff7a2e', 0, 45, 1.6);
    this.light.position.y = 2.2;
    this.group.add(this.light);
  }

  place(x, z) {
    this.group.position.set(x, heightAt(x, z) - 0.1, z);
  }

  update(t) {
    const a = this.amount;
    this.group.visible = a > 0.01;
    this.flameMat.uniforms.uAmount.value = a;
    const flick = 0.75 + Math.sin(t * 13.0) * 0.1 + Math.sin(t * 7.3 + 1.2) * 0.1 + Math.sin(t * 23.0) * 0.05;
    this.light.intensity = a * 160 * flick;
    this.logMat.emissiveIntensity = a * (0.8 + flick * 0.4);
  }
}
