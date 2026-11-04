import * as THREE from '../vendor/three/build/three.module.js';
import { heightAt } from './terrain.js';
import { CutMask, fieldUniforms } from './field.js';
import { Combine, Harvester } from './combine.js';
import { makeRng } from './noise.js';

// Everything the combine does to the field: drive (by itself or by you), stamp the cut
// mask as the header passes, lay straw behind, throw chaff out of the spreaders, kick
// dust off the header and puff exhaust. When the field is done it regrows and starts again.

const KIND_CHAFF = 0;
const KIND_DUST = 1;
const KIND_SMOKE = 2;

class Debris {
  constructor(max = 2400) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max).fill(0);
    this.kind = new Float32Array(max);
    this.size = new Float32Array(max);
    this.cursor = 0;
    this.rng = makeRng(12);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAge = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aKind = new THREE.BufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aAge', this.aAge);
    geo.setAttribute('aKind', this.aKind);
    geo.setAttribute('aSize', this.aSize);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = {
      uScale: { value: 600 },
      uChaff: { value: new THREE.Color('#e2c67a') },
      uDust: { value: new THREE.Color('#bfae8a') },
      uSmoke: { value: new THREE.Color('#4a4846') },
      uLight: { value: 1 },
    };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute float aAge; attribute float aKind; attribute float aSize;
        varying float vAge; varying float vKind;
        void main() {
          vAge = aAge; vKind = aKind;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float grow = aKind > 0.5 ? (1.0 + aAge * 3.0) : 1.0;
          gl_PointSize = aAge >= 1.0 ? 0.0 : aSize * grow * uScale / max(-mv.z, 0.5);
          if (aAge >= 1.0) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uChaff; uniform vec3 uDust; uniform vec3 uSmoke; uniform float uLight;
        varying float vAge; varying float vKind;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a;
          vec3 col;
          if (vKind < 0.5) {
            // Chaff: small flecks with a hard-ish edge.
            a = smoothstep(0.5, 0.2, d) * 0.85 * (1.0 - smoothstep(0.6, 1.0, vAge));
            col = uChaff * uLight;
          } else if (vKind < 1.5) {
            a = smoothstep(0.5, 0.0, d) * 0.1 * (1.0 - vAge) * smoothstep(0.0, 0.1, vAge);
            col = uDust * uLight;
          } else {
            a = smoothstep(0.5, 0.0, d) * 0.3 * (1.0 - vAge) * smoothstep(0.0, 0.08, vAge);
            col = uSmoke * (0.6 + uLight * 0.4);
          }
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
  }

  emit(kind, p, v, life, size) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.kind[i] = kind;
    this.size[i] = size;
  }

  update(dt, wind) {
    const ages = this.aAge.array;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        ages[i] = 1;
        continue;
      }
      this.age[i] += dt;
      const k = this.age[i] / this.life[i];
      if (k >= 1) {
        this.life[i] = 0;
        ages[i] = 1;
        continue;
      }
      ages[i] = k;
      const kind = this.kind[i];
      const drag = kind === KIND_CHAFF ? 1.6 : 0.9;
      const lift = kind === KIND_SMOKE ? 0.8 : kind === KIND_DUST ? 0.25 : -0.55;
      const j = i * 3;
      this.vel[j] += (wind.x - this.vel[j]) * drag * dt;
      this.vel[j + 2] += (wind.z - this.vel[j + 2]) * drag * dt;
      this.vel[j + 1] += (lift - this.vel[j + 1]) * drag * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const g = heightAt(this.pos[j], this.pos[j + 2]) + 0.05;
      if (this.pos[j + 1] < g) {
        this.pos[j + 1] = g;
        this.vel[j] *= 0.2;
        this.vel[j + 2] *= 0.2;
      }
    }
    this.aPos.needsUpdate = true;
    this.aAge.needsUpdate = true;
    this.aKind.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }
}

export class HarvestSystem {
  constructor(renderer, scene) {
    this.mask = new CutMask(renderer);
    this.combine = new Combine();
    this.combine.group.visible = false;
    scene.add(this.combine.group);
    // Lanes run south of the oak, so it stands at the edge of the crop.
    this.driver = new Harvester({ minX: -46, maxX: 46, minZ: 11, maxZ: 62 });
    this.debris = new Debris();
    scene.add(this.debris.points);
    this.active = false;
    this.fade = 1;
    this.fadeTarget = 1;
    this.prevHeader = null;
    this.emitAcc = { chaff: 0, dust: 0, smoke: 0 };
    this.tmp = new THREE.Vector3();
    this.tmpV = new THREE.Vector3();
    this.wind = new THREE.Vector3();
  }

  get position() {
    return this.combine.group.position;
  }

  setActive(on) {
    if (on === this.active) return;
    this.active = on;
    this.combine.group.visible = on;
    if (on) {
      this.mask.clear();
      this.fade = 1;
      this.fadeTarget = 1;
      this.driver.restart();
      this.prevHeader = null;
    } else {
      // Let the field grow back while the combine is away.
      this.fadeTarget = 0;
    }
  }

  setDriving(on) {
    this.driver.mode = on ? 'drive' : 'auto';
    this.prevHeader = null;
    if (!on) {
      // Rejoin the autopilot from the nearest point on its route.
      let best = 0;
      let bestD = Infinity;
      for (const p of this.driver.path) {
        const d = Math.hypot(p.x - this.driver.x, p.z - this.driver.z);
        if (d < bestD) {
          bestD = d;
          best = p.s;
        }
      }
      this.driver.s = best;
      this.driver.cursor = 0;
    }
  }

  update(dt, t, { windDir, windStrength, sunElevation, speedScale }) {
    // Cut-mask fade: used both to regrow a finished field and when the combine leaves.
    this.fade += (this.fadeTarget - this.fade) * Math.min(1, dt * 0.9);
    if (this.fadeTarget === 0 && this.fade < 0.01) {
      this.mask.clear();
      this.fade = 1;
      this.fadeTarget = 1;
      if (this.active) {
        this.driver.restart();
        this.prevHeader = null;
      }
    }
    fieldUniforms.uCutFade.value = this.fade;
    this.wind.set(windDir.x, 0, windDir.y).multiplyScalar(0.6 + windStrength * 4.5);
    this.debris.uniforms.uLight.value = THREE.MathUtils.clamp(0.25 + sunElevation / 25, 0.2, 1.1);
    this.debris.update(dt, this.wind);
    if (!this.active) {
      this.mask.flush();
      return;
    }

    const d = this.driver;
    d.speedScale = speedScale;
    if (this.fadeTarget === 1) d.update(dt);
    if (d.mode === 'auto' && d.finished && this.fadeTarget === 1) this.fadeTarget = 0;

    const c = Math.cos(d.heading);
    const s = Math.sin(d.heading);
    const at = (fx, side) => heightAt(d.x + c * fx - s * side, d.z + s * fx + c * side);
    const dusk = 1 - THREE.MathUtils.smoothstep(sunElevation, 3, 14);
    this.combine.update(dt, t, {
      x: d.x, z: d.z, heading: d.heading, speed: d.speed, steer: d.steer,
      groundFront: at(0, 0), groundRear: at(-3.7, 0), groundLeft: at(-1.8, 1.5), groundRight: at(-1.8, -1.5),
      cutting: d.cutting, lights: { work: dusk, beacon: 1 },
    });
    this.combine.group.updateMatrixWorld(true);

    // Stamp the swath from where the header was to where it is now, so fast frames
    // never leave gaps; then the windrow of straw dropping out of the back.
    const hx = d.x + c * 3.9;
    const hz = d.z + s * 3.9;
    if (d.cutting && this.prevHeader) {
      const dx = hx - this.prevHeader.x;
      const dz = hz - this.prevHeader.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.001 && len < 6) {
        this.mask.stamp((hx + this.prevHeader.x) / 2, (hz + this.prevHeader.z) / 2, d.heading, len + 0.5, this.combine.headerWidth - 0.2, 0, 0.1);
        const rx = d.x - c * 7.0;
        const rz = d.z - s * 7.0;
        this.mask.stamp(rx, rz, d.heading, len + 0.5, 1.7, 1, 0.6);
      }
    }
    this.prevHeader = { x: hx, z: hz };
    this.mask.flush();

    // Debris.
    const rng = this.debris.rng;
    const work = d.cutting && Math.abs(d.speed) > 0.3 ? 1 : 0;
    this.emitAcc.chaff += dt * 180 * work;
    this.emitAcc.dust += dt * 16 * work;
    this.emitAcc.smoke += dt * (8 + 10 * work);
    const rear = this.combine.worldPoint(this.combine.rearPoint, this.tmp);
    while (this.emitAcc.chaff >= 1) {
      this.emitAcc.chaff--;
      const spread = (rng() - 0.5) * 2;
      this.tmpV.set(-c * (3 + rng() * 2) - s * spread * 4, 1 + rng() * 1.6, -s * (3 + rng() * 2) + c * spread * 4);
      this.debris.emit(KIND_CHAFF, rear, this.tmpV, 1.6 + rng() * 2.2, 0.018 + rng() * 0.03);
    }
    while (this.emitAcc.dust >= 1) {
      this.emitAcc.dust--;
      const side = (rng() - 0.5) * this.combine.headerWidth;
      const p = this.tmp.set(hx - s * side, heightAt(hx, hz) + 0.5 + rng() * 0.6, hz + c * side);
      this.tmpV.set(c * d.speed * 0.5, 0.4 + rng() * 0.5, s * d.speed * 0.5);
      this.debris.emit(KIND_DUST, p, this.tmpV, 2.5 + rng() * 2, 0.5 + rng() * 0.6);
    }
    const ex = this.combine.worldPoint(this.combine.exhaustPoint, this.tmp);
    while (this.emitAcc.smoke >= 1) {
      this.emitAcc.smoke--;
      this.tmpV.set((rng() - 0.5) * 0.3, 1.4 + rng(), (rng() - 0.5) * 0.3);
      this.debris.emit(KIND_SMOKE, ex, this.tmpV, 2.2 + rng() * 1.5, 0.35 + rng() * 0.2);
    }
  }

  setViewScale(camera, renderer) {
    const h = renderer.domElement.height;
    this.debris.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
}
