// Third-person character: Michelle (Mixamo) driven by the idle/walk/run clips
// from the Xbot file (same Mixamo skeleton), with a follow camera, terrain
// following and collisions against buildings, trees, walls and the terrace.
import * as THREE from '../../_shared/three-r187/build/three.webgpu.js';
import { GLTFLoader } from '../../_shared/three-r187/addons/loaders/GLTFLoader.js';
import { TOWN, townR } from './terrain.js';

export async function loadCharacter(base) {
  const loader = new GLTFLoader();
  const [body, anims] = await Promise.all([loader.loadAsync(`${base}/Michelle.glb`), loader.loadAsync(`${base}/Xbot.glb`)]);
  const model = body.scene;
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });
  // normalise to 1.7 m tall, feet at y = 0
  const box = new THREE.Box3().setFromObject(model);
  const s = 1.7 / (box.max.y - box.min.y);
  model.scale.multiplyScalar(s);
  model.position.y -= box.min.y * s;
  const root = new THREE.Group();
  root.add(model);
  // Michelle's hips carry a -90 degree X rest rotation that Xbot's don't:
  // rotate the hips track into her frame, and drop root translation.
  let hipsRest = null;
  model.traverse((o) => {
    if (o.name === 'mixamorigHips' || o.name === 'mixamorig:Hips') hipsRest = o.quaternion.clone();
  });
  const fix = (clip) => {
    const c = clip.clone();
    c.tracks = c.tracks.filter((t) => !t.name.endsWith('.position') && !t.name.endsWith('.scale'));
    for (const t of c.tracks) {
      if (/Hips\.quaternion$/.test(t.name) && hipsRest) {
        const q = new THREE.Quaternion();
        for (let i = 0; i < t.values.length; i += 4) {
          q.fromArray(t.values, i).premultiply(hipsRest);
          q.toArray(t.values, i);
        }
      }
    }
    return c;
  };
  const byName = (n) => anims.animations.find((a) => a.name.toLowerCase() === n);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const n of ['idle', 'walk', 'run']) {
    const clip = byName(n);
    if (!clip) continue;
    actions[n] = mixer.clipAction(fix(clip));
    actions[n].play();
    actions[n].setEffectiveWeight(n === 'idle' ? 1 : 0);
  }
  return { root, mixer, actions };
}

export class ThirdPerson {
  constructor(camera, dom, char, world) {
    this.camera = camera;
    this.dom = dom;
    this.char = char;
    this.world = world; // { sample, obbs, circles }
    this.pos = new THREE.Vector3(0, TOWN.base, 60);
    this.heading = Math.PI; // facing -z (towards the square)
    this.vel = new THREE.Vector2();
    this.yaw = 0; // camera orbit: 0 puts the camera behind a character facing -z
    this.pitch = 0.22;
    this.dist = 4.2;
    this.keys = new Set();
    this.enabled = false;
    this.locked = false;
    this.camPos = new THREE.Vector3();
    this.speed = 0;
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || !this.locked) return;
      this.yaw -= e.movementX * 0.0025;
      this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.0022, -0.35, 1.2);
    });
    window.addEventListener('wheel', (e) => {
      if (this.enabled) this.dist = THREE.MathUtils.clamp(this.dist + e.deltaY * 0.004, 2.5, 14);
    }, { passive: true });
    const key = (e) => {
      if (e.type === 'keydown') this.keys.add(e.code);
      else this.keys.delete(e.code);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      this.onLockChange?.(this.locked);
    });
    // touch: left half moves, right half looks
    this.touchMove = new THREE.Vector2();
    const look = { id: null, x: 0, y: 0 };
    const move = { id: null, x: 0, y: 0 };
    dom.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        const s = t.clientX < innerWidth * 0.45 ? move : look;
        if (s.id === null) Object.assign(s, { id: t.identifier, x: t.clientX, y: t.clientY });
      }
      e.preventDefault();
    }, { passive: false });
    dom.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.identifier === look.id) {
          this.yaw -= (t.clientX - look.x) * 0.006;
          this.pitch = THREE.MathUtils.clamp(this.pitch + (t.clientY - look.y) * 0.005, -0.35, 1.2);
          look.x = t.clientX;
          look.y = t.clientY;
        }
        if (t.identifier === move.id) this.touchMove.set((t.clientX - move.x) / 60, (t.clientY - move.y) / 60).clampScalar(-1, 1);
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === look.id) look.id = null;
        if (t.identifier === move.id) {
          move.id = null;
          this.touchMove.set(0, 0);
        }
      }
    };
    dom.addEventListener('touchend', end);
    dom.addEventListener('touchcancel', end);
  }

  lock() {
    const p = this.dom.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  start() {
    this.enabled = true;
    this.char.root.visible = true;
  }

  stop() {
    this.enabled = false;
  }

  blocked(x, z) {
    const r = 0.38;
    const { obbs, circles } = this.world;
    for (const o of obbs) {
      const dx = x - o.x;
      const dz = z - o.z;
      const lx = dx * o.c - dz * o.s;
      const lz = dx * o.s + dz * o.c;
      if (Math.abs(lx) < o.hw + r && Math.abs(lz) < o.hd + r) return true;
    }
    for (const c of circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2) return true;
    // town wall, with the gate open to the south
    const r0 = townR(this.pos.x, this.pos.z);
    const r1 = townR(x, z);
    const inGate = Math.abs(x) < 2.6 && z > 0;
    if (!inGate && ((r0 < 0.985 && r1 >= 0.985) || (r0 > 1.03 && r1 <= 1.03))) return true;
    // terrace edge, except over the stair
    const tz = TOWN.terraceZ;
    if (r1 < 1 && Math.abs(x) > 4.0 && (this.pos.z - tz) * (z - tz) <= 0) return true;
    return Math.abs(x) > 760 || Math.abs(z) > 760;
  }

  update(dt) {
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - this.touchMove.y;
    const str = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.touchMove.x;
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const len = Math.min(1, Math.hypot(fwd, str));
    const target = len > 0.05 ? (run ? 5.6 : 1.9) * len : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 6);
    if (len > 0.05) {
      // move relative to the camera's view direction
      const cy = Math.cos(this.yaw);
      const sy = Math.sin(this.yaw);
      const mx = -sy * fwd + cy * str;
      const mz = -cy * fwd - sy * str;
      const want = Math.atan2(mx, mz);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 10);
    }
    const nx = this.pos.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.pos.z + Math.cos(this.heading) * this.speed * dt;
    if (!this.blocked(nx, this.pos.z)) this.pos.x = nx;
    if (!this.blocked(this.pos.x, nz)) this.pos.z = nz;
    const gy = this.world.sample(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 14);
    const { root, mixer, actions } = this.char;
    root.position.copy(this.pos);
    root.rotation.y = this.heading;
    // blend idle / walk / run by speed
    const s = this.speed;
    const wIdle = THREE.MathUtils.clamp(1 - s / 1.2, 0, 1);
    const wRun = THREE.MathUtils.clamp((s - 2.2) / 2.6, 0, 1);
    const wWalk = Math.max(0, 1 - wIdle - wRun);
    actions.idle?.setEffectiveWeight(wIdle);
    actions.walk?.setEffectiveWeight(wWalk);
    actions.run?.setEffectiveWeight(wRun);
    if (actions.walk) actions.walk.timeScale = THREE.MathUtils.clamp(s / 1.6, 0.6, 1.4);
    if (actions.run) actions.run.timeScale = THREE.MathUtils.clamp(s / 5.2, 0.7, 1.2);
    mixer.update(dt);
    // camera orbit behind the shoulder
    const head = this.pos.clone().add(new THREE.Vector3(0, 1.55, 0));
    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.dist);
    const want = head.clone().add(off);
    want.y = Math.max(want.y, this.world.sample(want.x, want.z) + 0.5);
    if (this.camPos.lengthSq() === 0) this.camPos.copy(want);
    this.camPos.lerp(want, Math.min(1, dt * 8));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(head.x, head.y - 0.1, head.z);
  }
}
