// Sky, fog, environment, wet streets and pavements, rain, steam, lamp light
// cones and the light pool.
import * as THREE from '../vendor/three/build/three.webgpu.js';
import {
  Fn, vec3, vec4, float, uv, positionWorld, positionLocal, cameraPosition, instanceIndex, hash, mix, step,
  smoothstep, fract, normalize, sin, cos, abs, max, mx_noise_float, uniform, pow, dot, length, positionWorldDirection,
  modelWorldMatrix, attribute,
} from '../vendor/three/build/three.tsl.js';
import { uTime, wetGroundMaterial } from './materials.js';
import { ROADS, EDGE, HALF_ROAD, PLAZA } from './city.js';

export const FOG = new THREE.Color().setRGB(0.05, 0.028, 0.07);

export function setSky(scene) {
  scene.backgroundNode = Fn(() => {
    const d = positionWorldDirection;
    const y = d.y;
    const fog = vec3(FOG.r, FOG.g, FOG.b).mul(1.3);
    const mid = vec3(0.025, 0.016, 0.05);
    const zen = vec3(0.004, 0.005, 0.014);
    const c0 = mix(fog, mid, smoothstep(0.0, 0.2, y));
    const c1 = mix(c0, zen, smoothstep(0.2, 0.75, y));
    const p = d.xz.div(max(y.add(0.12), 0.08)).mul(1.3);
    const cl = mx_noise_float(vec3(p.x, p.y, uTime.mul(0.01))).mul(0.35).add(0.35)
      .add(mx_noise_float(vec3(p.x.mul(3.1), p.y.mul(3.1), 2.0)).mul(0.15).add(0.15));
    const lit = smoothstep(0.5, 0.85, cl).mul(smoothstep(0.8, 0.05, y)).mul(smoothstep(-0.05, 0.1, y));
    const c2 = c1.add(vec3(0.15, 0.045, 0.11).mul(lit).mul(0.8))
      .add(vec3(0.02, 0.05, 0.09).mul(smoothstep(0.6, 0.9, cl)).mul(smoothstep(0.9, 0.2, y)).mul(0.5));
    return mix(fog, c2, step(0, y));
  })();
}

// A dark neon "room" captured to an environment map: glossy surfaces and
// window glass get something coloured to reflect.
export function makeEnv(renderer) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x020205);
  s.add(new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: 0x07050c, side: THREE.BackSide })));
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
  const top = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x2a1a3a }));
  top.position.y = 9.9;
  top.rotation.x = Math.PI / 2;
  s.add(top);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.04);
  pm.dispose();
  return rt.texture;
}

export function addGround(scene, city, tex) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), wetGroundMaterial(tex.asphalt, 8, { puddles: 0.5 }));
  scene.add(ground);

  // pavements: wet tiles, one instanced unit box per block
  const pave = wetGroundMaterial(tex.pavement, 4, { puddles: 0.62 });
  const pv = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), pave, city.sidewalks.length);
  const m = new THREE.Matrix4();
  city.sidewalks.forEach((s, i) => {
    m.compose(new THREE.Vector3((s.x0 + s.x1) / 2, 0.075, (s.z0 + s.z1) / 2), new THREE.Quaternion(), new THREE.Vector3(s.x1 - s.x0, 0.15, s.z1 - s.z0));
    pv.setMatrixAt(i, m);
  });
  pv.computeBoundingSphere();
  scene.add(pv);
  // granite kerbs
  const kerbs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardNodeMaterial({ color: 0x4a4a52, roughness: 0.35 }), city.sidewalks.length * 4);
  let ci = 0;
  for (const s of city.sidewalks) {
    const w = s.x1 - s.x0;
    const d = s.z1 - s.z0;
    for (const [x, z, sx, sz] of [[(s.x0 + s.x1) / 2, s.z0, w, 0.3], [(s.x0 + s.x1) / 2, s.z1, w, 0.3], [s.x0, (s.z0 + s.z1) / 2, 0.3, d], [s.x1, (s.z0 + s.z1) / 2, 0.3, d]]) {
      m.compose(new THREE.Vector3(x, 0.085, z), new THREE.Quaternion(), new THREE.Vector3(sx, 0.17, sz));
      kerbs.setMatrixAt(ci++, m);
    }
  }
  kerbs.computeBoundingSphere();
  scene.add(kerbs);

  // road markings: worn paint dashes and crossings
  const dashes = [];
  for (const c of ROADS) {
    for (const axis of ['x', 'z']) {
      for (let a = -EDGE - 30; a <= EDGE + 30; a += 6) {
        if (ROADS.some((r) => Math.abs(a - r) < HALF_ROAD + 4)) continue;
        if (Math.abs(a) < PLAZA + 2 && c === 0) continue;
        dashes.push(axis === 'x' ? [a, c, 3, 0.16] : [c, a, 0.16, 3]);
      }
      for (const r of ROADS) {
        for (const side of [-1, 1]) {
          const a = r + side * (HALF_ROAD + 5);
          if (c === 0 && Math.abs(a) < PLAZA + 2) continue;
          for (let k = -4; k <= 4; k++) dashes.push(axis === 'x' ? [a, c + k * 1.1, 2.6, 0.55] : [c + k * 1.1, a, 0.55, 2.6]);
        }
      }
    }
  }
  const markMat = new THREE.MeshStandardNodeMaterial({ color: 0x9a9aa0, roughness: 0.4, transparent: true });
  markMat.opacityNode = smoothstep(0.25, 0.6, mx_noise_float(positionWorld.xz.mul(2.5)).mul(0.5).add(0.5)).mul(0.85);
  const marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), markMat, dashes.length);
  dashes.forEach(([x, z, sx, sz], i) => {
    m.compose(new THREE.Vector3(x, 0.012, z), new THREE.Quaternion(), new THREE.Vector3(sx, 1, sz));
    marks.setMatrixAt(i, m);
  });
  marks.computeBoundingSphere();
  scene.add(marks);

  // plaza rings
  const ringMat = new THREE.MeshBasicNodeMaterial();
  ringMat.colorNode = vec3(0.16, 0.96, 1.44);
  for (const r of [10.5, 19, 27]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 128).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.015;
    scene.add(ring);
  }
  return ground;
}

// Rain: a camera-centred box of streaks, positioned entirely in the vertex stage.
export function addRain(scene, count) {
  const geo = new THREE.PlaneGeometry(0.018, 0.9);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const box = vec3(60, 40, 60);
  const cam = uniform(new THREE.Vector3());
  const i = float(instanceIndex);
  const base = vec3(hash(i), hash(i.add(0.37)), hash(i.add(0.71))).mul(box);
  const fallen = base.sub(vec3(uTime.mul(3), uTime.mul(26), 0));
  const rel = fallen.sub(cam).mod(box).sub(box.mul(0.5));
  const centre = cam.add(rel);
  const toCam = normalize(vec3(cam.x.sub(centre.x), 0.0001, cam.z.sub(centre.z)));
  const right = vec3(toCam.z, 0, toCam.x.negate());
  m.positionNode = centre.add(right.mul(positionLocal.x)).add(vec3(0.11, 1, 0).mul(positionLocal.y));
  const fade = float(1).sub(smoothstep(8, 28, length(rel)));
  m.colorNode = vec3(0.55, 0.62, 0.78).mul(fade).mul(0.26).mul(uv().y.add(0.3));
  const rain = new THREE.InstancedMesh(geo, m, count);
  rain.frustumCulled = false;
  rain.renderOrder = 5;
  scene.add(rain);
  return { rain, cam };
}

export function addSteam(scene, vents) {
  const per = 16;
  const n = Math.max(1, vents.length * per);
  const geo = new THREE.PlaneGeometry(1, 1);
  const ventAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  vents.forEach((v, i) => { for (let k = 0; k < per; k++) ventAttr.setXYZ(i * per + k, v.x, v.y, v.z); });
  geo.setAttribute('aVent', ventAttr);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const i = float(instanceIndex);
  const seed = i.mod(per).div(per).add(hash(i).mul(0.05));
  const t = fract(uTime.mul(0.11).add(seed));
  const vent = attribute('aVent', 'vec3');
  const centre = vent.add(vec3(sin(seed.mul(40).add(uTime)).mul(t).mul(1.5).add(t.mul(2.5)), t.mul(10), cos(seed.mul(33)).mul(t).mul(1.5)));
  const size = t.mul(5).add(0.8);
  const toCam = normalize(cameraPosition.sub(centre));
  const right = normalize(vec3(toCam.z, 0, toCam.x.negate()));
  const up = normalize(right.cross(toCam).negate());
  m.positionNode = centre.add(right.mul(positionLocal.x).mul(size)).add(up.mul(positionLocal.y).mul(size));
  const d = length(uv().sub(0.5));
  const puff = smoothstep(0.5, 0.0, d).mul(mx_noise_float(vec3(uv().mul(3), seed.mul(10))).mul(0.4).add(0.7));
  m.colorNode = vec3(0.6, 0.55, 0.68);
  m.opacityNode = puff.mul(smoothstep(0, 0.15, t)).mul(float(1).sub(t)).mul(0.13);
  const mesh = new THREE.InstancedMesh(geo, m, n);
  mesh.count = vents.length * per;
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  scene.add(mesh);
  return mesh;
}

// Soft additive cones under the street lamps: a cheap stand-in for light
// scattering in the rain.
export function addLightCones(scene, heads) {
  const geo = new THREE.CylinderGeometry(0.35, 3.2, 7.0, 24, 1, true).translate(0, -3.5, 0);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const v = uv().y; // 1 at the lamp, 0 at the ground
  const V = normalize(cameraPosition.sub(positionWorld));
  const axis = modelWorldMatrix.mul(vec4(0, positionLocal.y, 0, 1)).xyz;
  const n = normalize(positionWorld.sub(axis));
  const edge = pow(abs(dot(n, V)), 1.5);
  const shimmer = mx_noise_float(vec3(positionWorld.x.mul(0.8), positionWorld.y.mul(0.3).add(uTime.mul(1.5)), positionWorld.z.mul(0.8))).mul(0.25).add(0.85);
  m.colorNode = vec3(0.6, 0.78, 1.0).mul(pow(v, 1.6)).mul(edge).mul(shimmer).mul(0.09);
  const mesh = new THREE.InstancedMesh(geo, m, Math.max(1, heads.length));
  const mm = new THREE.Matrix4();
  heads.forEach((h, i) => mesh.setMatrixAt(i, mm.makeTranslation(h.x, h.y - 0.15, h.z)));
  mesh.count = heads.length;
  mesh.computeBoundingSphere();
  mesh.renderOrder = 7;
  scene.add(mesh);
  return mesh;
}

// Light pool: the city defines hundreds of light sources; the nearest few
// become real point lights each frame, faded by rank so they never pop.
export class LightPool {
  constructor(scene, sources, size = 40) {
    this.sources = sources.map((s) => ({ pos: new THREE.Vector3(s.x, s.y, s.z), col: new THREE.Color(s.color), power: s.i, range: s.d, dist2: 0 }));
    this.lights = [];
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      scene.add(l);
      this.lights.push(l);
    }
    this.frame = 0;
    this.gain = 1;
  }

  update(camera, force = false) {
    if (!force && this.frame++ % 3) return;
    const c = camera.position;
    const s = this.sources;
    for (const x of s) x.dist2 = x.pos.distanceToSquared(c);
    s.sort((a, b) => a.dist2 - b.dist2);
    const n = this.lights.length;
    const last = s[Math.min(n, s.length) - 1];
    const far = last ? Math.sqrt(last.dist2) : 1;
    for (let i = 0; i < n; i++) {
      const L = this.lights[i];
      const src = s[i];
      if (!src) {
        L.intensity = 0;
        continue;
      }
      const fade = 1 - THREE.MathUtils.smoothstep(Math.sqrt(src.dist2), far * 0.75, far);
      L.position.copy(src.pos);
      L.color.copy(src.col);
      L.distance = src.range;
      L.intensity = src.power * fade * this.gain;
    }
  }
}
