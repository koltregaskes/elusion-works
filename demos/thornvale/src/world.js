// Sky, sun, shadows, day/night and weather; terrain, mountains and grass; rain.
import * as THREE from '../../shared/three-r187/build/three.webgpu.js';
import {
  Fn, vec2, vec3, vec4, float, uniform, texture, uv, positionWorld, positionLocal, normalWorld, cameraPosition, instanceIndex,
  hash, mix, step, smoothstep, clamp, sin, cos, normalize, length, normalMap, abs, floor, fract, mx_noise_float, max, min, varying,
} from '../../shared/three-r187/build/three.tsl.js';
import { SkyMesh } from '../../shared/three-r187/addons/objects/SkyMesh.js';
import { CSMShadowNode } from '../../shared/three-r187/addons/csm/CSMShadowNode.js';
import { env } from './kit.js';
import { WORLD, RES, TOWN } from './terrain.js';

// ------------------------------------------------------------------ sky, sun, time of day, weather
export class Atmosphere {
  constructor(renderer, scene, camera, { shadows = true, shadowSize = 2048 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.sky = new SkyMesh();
    this.sky.scale.setScalar(20000);
    scene.add(this.sky);
    // a separate scene holding only the sky, captured for image-based lighting
    this.skyScene = new THREE.Scene();
    this.skyForEnv = new SkyMesh();
    this.skyForEnv.scale.setScalar(1000);
    this.skyScene.add(this.skyForEnv);
    this.cubeRT = new THREE.CubeRenderTarget(128, { type: THREE.HalfFloatType });
    this.cubeCam = new THREE.CubeCamera(1, 5000, this.cubeRT);
    scene.environment = this.cubeRT.texture;
    scene.environmentIntensity = 0.55;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 2000;
      this.sun.shadow.bias = -0.0002;
      this.sun.shadow.normalBias = 0.6;
      const csm = new CSMShadowNode(this.sun, { cascades: 3, maxFar: 420, mode: 'practical', lightMargin: 120 });
      csm.fade = true;
      this.sun.shadow.shadowNode = csm;
      this.csm = csm;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.moon = new THREE.DirectionalLight(0x8899cc, 0);
    scene.add(this.moon);
    this.hemi = new THREE.HemisphereLight(0x9fb4d8, 0x5a4a38, 0.25);
    scene.add(this.hemi);

    this.fog = new THREE.FogExp2(0xaabbcc, 0.00028);
    scene.fog = this.fog;
    this.hours = 16.5;
    this.weather = 'clear';
    this.rain = 0; // eased
    this.wetTarget = 0;
    this.cloud = 0.3;
    this.lastEnvUpdate = -1;
    this.sunDir = new THREE.Vector3();
    this.apply(true);
  }

  setWeather(w) {
    this.weather = w;
  }

  apply(force = false) {
    const h = this.hours;
    // sun path: rises in the east (+x), sets in the west, south-facing arc
    const dayT = (h - 6) / 12; // 0 sunrise .. 1 sunset
    const elev = Math.sin(dayT * Math.PI) * THREE.MathUtils.degToRad(52);
    const az = Math.PI * (0.5 + dayT); // east -> south -> west
    const dir = this.sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    if (dayT < 0 || dayT > 1) dir.set(Math.cos(az), -0.25, Math.sin(az)).normalize();
    const day = THREE.MathUtils.smoothstep(dir.y, -0.08, 0.12);
    const golden = 1 - THREE.MathUtils.smoothstep(dir.y, 0.05, 0.35);
    const W = { clear: [0.22, 1.0, 0.00028, 0], cloudy: [0.78, 0.45, 0.0004, 0], rain: [0.97, 0.22, 0.0009, 1], mist: [0.55, 0.5, 0.0045, 0.3] }[this.weather];
    this.cloud += (W[0] - this.cloud) * (force ? 1 : 0.02);
    this.rain += (W[3] - this.rain) * (force ? 1 : 0.01);
    for (const s of [this.sky, this.skyForEnv]) {
      s.sunPosition.value.copy(dir);
      s.turbidity.value = 2.5 + this.cloud * 6;
      s.rayleigh.value = 1.2 + golden * 1.5;
      s.mieCoefficient.value = 0.004 + this.cloud * 0.01;
      s.mieDirectionalG.value = 0.8;
      s.cloudCoverage.value = this.cloud;
      s.cloudDensity.value = 0.35 + this.cloud * 0.5;
      s.cloudElevation.value = 0.55;
    }
    const sunCol = new THREE.Color().setRGB(1.0, 0.92 - golden * 0.32, 0.82 - golden * 0.5);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 3.4 * day * W[1];
    this.sun.position.copy(dir).multiplyScalar(400);
    this.sun.target.position.set(0, 0, 0);
    const night = 1 - day;
    env.night.value = THREE.MathUtils.smoothstep(night, 0.35, 0.9);
    this.moon.intensity = 0.35 * night;
    this.moon.position.set(-dir.x, Math.abs(dir.y) + 0.6, -dir.z).multiplyScalar(400);
    this.hemi.intensity = 0.12 + 0.25 * day * (1 - this.cloud * 0.4) + 0.08 * night;
    this.hemi.color.setRGB(0.6 + 0.2 * day, 0.68 + 0.18 * day, 0.85);
    const fogDay = new THREE.Color().setRGB(0.6, 0.68, 0.78).lerp(new THREE.Color().setRGB(0.86, 0.66, 0.46), golden * day);
    const fogNight = new THREE.Color().setRGB(0.025, 0.03, 0.05);
    this.fog.color.copy(fogNight).lerp(fogDay, day);
    if (this.weather === 'rain' || this.weather === 'mist') this.fog.color.lerp(new THREE.Color().setRGB(0.5, 0.53, 0.56).multiplyScalar(0.25 + 0.75 * day), 0.6);
    this.fog.density = W[2];
    this.renderer.toneMappingExposure = 0.55 + night * 0.9;
    this.scene.environmentIntensity = 0.25 + 0.4 * day;
    this.wetTarget = this.rain;
    env.wet.value += (this.wetTarget - env.wet.value) * (force ? 1 : 0.003);
    env.wind.value = 0.7 + this.cloud * 0.8 + this.rain * 1.2;
    // refresh the lighting environment now and then
    const key = Math.round(this.hours * 4) + ':' + this.weather + ':' + Math.round(this.cloud * 10);
    if (force || key !== this.lastEnvUpdate) {
      this.cubeCam.update(this.renderer, this.skyScene);
      this.lastEnvUpdate = key;
    }
  }
}

// ------------------------------------------------------------------ terrain material
export function terrainMaterial(tex, maskTex) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld.xz;
  const muv = p.add(WORLD / 2).div(WORLD);
  const M = texture(maskTex, muv);
  const slope = float(1).sub(normalWorld.y);
  const macro = mx_noise_float(p.mul(0.02)).mul(0.5).add(0.5);
  const fine = mx_noise_float(p.mul(0.12)).mul(0.5).add(0.5);
  const lay = (set, scale) => {
    const u = p.div(scale);
    return { c: texture(set.color, u).rgb, o: texture(set.orm, u), n: texture(set.normal, u).rgb };
  };
  const g = lay(tex.grass, 5.0);
  const d = lay(tex.dirt, 3.5);
  const r = lay(tex.rock, 10.0);
  const cb = lay(tex.cobbles, 2.4);
  const fl = lay(tex.flagstone, 4.0);
  const wDirt = clamp(M.b.add(smoothstep(0.55, 0.8, macro.mul(0.6).add(fine.mul(0.4))).mul(0.25)), 0, 1);
  const wRock = smoothstep(0.28, 0.5, slope);
  const wCob = M.r;
  const wFlag = M.g;
  const mixL = (a, b, w) => ({ c: mix(a.c, b.c, w), o: mix(a.o, b.o, w), n: mix(a.n, b.n, w) });
  let L = mixL(g, d, wDirt);
  L = mixL(L, r, wRock);
  L = mixL(L, cb, wCob);
  L = mixL(L, fl, wFlag);
  const tint = mix(vec3(0.82, 0.9, 0.7), vec3(1.12, 1.0, 0.82), macro);
  const grassy = float(1).sub(wDirt).mul(float(1).sub(wRock)).mul(float(1).sub(wCob)).mul(float(1).sub(wFlag));
  const wet = env.wet;
  m.colorNode = L.c.mul(mix(vec3(1), tint, grassy)).mul(mix(float(1), float(0.62), wet));
  m.roughnessNode = clamp(mix(L.o.g, L.o.g.mul(0.3), wet.mul(float(1).sub(grassy.mul(0.6)))), 0.04, 1);
  m.aoNode = L.o.r;
  m.metalnessNode = float(0);
  m.normalNode = normalMap(L.n);
  return m;
}

export function mountainMaterial(tex) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld.xz;
  const rockC = texture(tex.rock.color, p.div(60)).rgb;
  const grassC = texture(tex.grass.color, p.div(40)).rgb.mul(vec3(0.55, 0.62, 0.45));
  const up = normalWorld.y;
  const h = positionWorld.y;
  const n = mx_noise_float(p.mul(0.004)).mul(120);
  const snow = smoothstep(380, 520, h.add(n)).mul(smoothstep(0.45, 0.75, up));
  const forest = smoothstep(260, 120, h.add(n)).mul(smoothstep(0.55, 0.8, up));
  const c = mix(mix(rockC, grassC, forest), vec3(0.92, 0.94, 0.98), snow);
  m.colorNode = c;
  m.roughnessNode = mix(float(0.9), float(0.6), snow);
  m.normalNode = normalMap(texture(tex.rock.normal, p.div(60)));
  return m;
}

// ------------------------------------------------------------------ grass
// Blades on a grid that follows the camera; height from the heightmap texture,
// thinned on streets and squares by the mask, swaying in the wind.
export function addGrass(scene, heightTex, maskTex, { side = 220, cell = 0.32 } = {}) {
  const count = side * side;
  const geo = new THREE.BufferGeometry();
  // tapered blade, 4 segments, facing +z
  const pos = [];
  const uvs = [];
  const idx = [];
  const segs = 4;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = 0.045 * (1 - t * 0.85);
    pos.push(-w, t, 0, w, t, 0);
    uvs.push(0, t, 1, t);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const camCell = uniform(new THREE.Vector2());
  const i = float(instanceIndex);
  const gx = i.mod(side).sub(side / 2);
  const gz = floor(i.div(side)).sub(side / 2);
  const cellXZ = camCell.add(vec2(gx, gz).mul(cell));
  const h1 = hash(i.mul(1.31).add(camCell.x.mul(0.017)).add(camCell.y.mul(0.031)));
  const jitter = vec2(hash(cellXZ.x.mul(12.9).add(cellXZ.y.mul(78.2))), hash(cellXZ.x.mul(39.3).add(cellXZ.y.mul(11.1)))).sub(0.5).mul(cell * 1.6);
  const xz = cellXZ.add(jitter);
  const muv = xz.add(WORLD / 2).div(WORLD);
  const y0 = texture(heightTex, muv).r;
  const mk = texture(maskTex, muv);
  const rnd = hash(xz.x.mul(3.7).add(xz.y.mul(5.3)));
  const dist = length(xz.sub(cameraPosition.xz));
  const radius = side * cell * 0.5;
  const keep = float(1).sub(mk.a).mul(smoothstep(radius, radius * 0.6, dist));
  const height = rnd.mul(0.5).add(0.45).mul(keep).mul(step(0.08, keep));
  const yaw = rnd.mul(6.283);
  const t = positionLocal.y;
  const windPh = xz.x.mul(0.21).add(xz.y.mul(0.17)).add(env.time.mul(1.6));
  const bend = sin(windPh).mul(0.25).add(0.3).mul(env.wind).mul(t.mul(t));
  const lx = positionLocal.x.mul(cos(yaw));
  const lz = positionLocal.x.mul(sin(yaw));
  m.positionNode = vec3(xz.x.add(lx).add(bend.mul(0.6)), y0.add(t.mul(height)), xz.y.add(lz).add(bend.mul(0.3)));
  const xzV = varying(xz);
  const rndV = varying(rnd);
  const dry = smoothstep(0.55, 0.8, mx_noise_float(xzV.mul(0.05)).mul(0.5).add(0.5));
  const base = mix(vec3(0.07, 0.13, 0.03), vec3(0.24, 0.2, 0.08), dry);
  const tip = mix(vec3(0.32, 0.45, 0.12), vec3(0.72, 0.6, 0.26), dry);
  m.colorNode = mix(base, tip, uv().y).mul(rndV.mul(0.35).add(0.8));
  m.roughnessNode = float(0.7);
  m.normalNode = null;
  const mesh = new THREE.InstancedMesh(geo, m, count);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return {
    mesh,
    update(camera) {
      camCell.value.set(Math.floor(camera.position.x / cell) * cell, Math.floor(camera.position.z / cell) * cell);
    },
  };
}

// ------------------------------------------------------------------ rain
export function addRain(scene, count) {
  const geo = new THREE.PlaneGeometry(0.016, 0.85);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const box = vec3(50, 30, 50);
  const cam = uniform(new THREE.Vector3());
  const amount = uniform(0);
  const i = float(instanceIndex);
  const base = vec3(hash(i), hash(i.add(0.37)), hash(i.add(0.71))).mul(box);
  const fallen = base.sub(vec3(env.time.mul(2.5), env.time.mul(22), 0));
  const rel = fallen.sub(cam).mod(box).sub(box.mul(0.5));
  const centre = cam.add(rel);
  const toCam = normalize(vec3(cam.x.sub(centre.x), 0.0001, cam.z.sub(centre.z)));
  const right = vec3(toCam.z, 0, toCam.x.negate());
  m.positionNode = centre.add(right.mul(positionLocal.x)).add(vec3(0.1, 1, 0).mul(positionLocal.y));
  const fade = varying(float(1).sub(smoothstep(6, 24, length(rel))).mul(step(hash(i.add(9.0)), amount)));
  m.colorNode = vec3(0.7, 0.75, 0.82).mul(fade).mul(0.18).mul(uv().y.add(0.3));
  const rain = new THREE.InstancedMesh(geo, m, count);
  rain.frustumCulled = false;
  rain.renderOrder = 5;
  scene.add(rain);
  return { rain, cam, amount };
}

// ------------------------------------------------------------------ the grand stair to the terrace
export function addStair(scene, pbr) {
  const tz = TOWN.terraceZ;
  const steps = 40;
  const geos = [];
  for (let k = 0; k < steps; k++) {
    const z0 = tz + 10 - (k + 1) * 0.25;
    const y = TOWN.base + (k + 1) * (TOWN.terraceRise / steps);
    const g = new THREE.BoxGeometry(8.2, y - TOWN.base + 0.4, 0.25 + 0.02);
    g.translate(0, TOWN.base + (y - TOWN.base + 0.4) / 2 - 0.4, z0 + 0.125);
    geos.push(g);
  }
  const mergeBoxes = (list) => {
    const out = new THREE.BufferGeometry();
    const attrs = ['position', 'normal', 'uv'];
    const arrays = attrs.map(() => []);
    const index = [];
    let off = 0;
    for (const g of list) {
      attrs.forEach((a, ai) => arrays[ai].push(...g.attributes[a].array));
      for (const v of g.index.array) index.push(v + off);
      off += g.attributes.position.count;
    }
    out.setAttribute('position', new THREE.Float32BufferAttribute(arrays[0], 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(arrays[1], 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(arrays[2], 2));
    out.setIndex(index);
    return out;
  };
  const stair = new THREE.Mesh(mergeBoxes(geos), pbr.Flagstone);
  stair.castShadow = stair.receiveShadow = true;
  scene.add(stair);
  // balustrades either side
  const side = [];
  for (const x of [-4.5, 4.5]) {
    for (let k = 0; k < 10; k++) {
      const z0 = tz + 10 - (k + 1);
      const y = TOWN.base + ((k + 1) / 10) * TOWN.terraceRise;
      const g = new THREE.BoxGeometry(0.7, y - TOWN.base + 1.1, 1.0);
      g.translate(x, TOWN.base + (y - TOWN.base + 1.1) / 2, z0 + 0.5);
      side.push(g);
    }
  }
  const bal = new THREE.Mesh(mergeBoxes(side), pbr.Ashlar);
  bal.castShadow = bal.receiveShadow = true;
  scene.add(bal);
}
