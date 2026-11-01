// Walk (first person, collides with buildings) and Fly (free drone) controls.
// Mouse look uses pointer lock; touch gets a move pad on the left and drag-to-look on the right.
import * as THREE from '../vendor/three/build/three.webgpu.js';

export class Explorer {
  constructor(camera, dom, city) {
    this.camera = camera;
    this.dom = dom;
    this.city = city;
    this.mode = 'walk';
    this.yaw = 0;
    this.pitch = 0;
    this.pos = new THREE.Vector3(0, 1.7, 40);
    this.vel = new THREE.Vector3();
    this.keys = new Set();
    this.locked = false;
    this.touchMove = new THREE.Vector2();
    this.bob = 0;
    this.floor = 0;
    this.enabled = false;

    this._onMove = (e) => {
      if (!this.enabled || !this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.45, 1.45);
    };
    this._onKey = (e) => {
      const k = e.code;
      if (e.type === 'keydown') this.keys.add(k);
      else this.keys.delete(k);
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown'].includes(k)) e.preventDefault();
    };
    document.addEventListener('mousemove', this._onMove);
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      this.onLockChange?.(this.locked);
    });
    this._touch();
  }

  lock() {
    if (this.dom.requestPointerLock) {
      const p = this.dom.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _touch() {
    const look = { id: null, x: 0, y: 0 };
    const move = { id: null, x: 0, y: 0 };
    const el = this.dom;
    el.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        const left = t.clientX < window.innerWidth * 0.45;
        const s = left ? move : look;
        if (s.id === null) Object.assign(s, { id: t.identifier, x: t.clientX, y: t.clientY });
      }
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.identifier === look.id) {
          this.yaw -= (t.clientX - look.x) * 0.005;
          this.pitch = THREE.MathUtils.clamp(this.pitch - (t.clientY - look.y) * 0.005, -1.45, 1.45);
          look.x = t.clientX;
          look.y = t.clientY;
        }
        if (t.identifier === move.id) {
          this.touchMove.set(THREE.MathUtils.clamp((t.clientX - move.x) / 60, -1, 1), THREE.MathUtils.clamp((t.clientY - move.y) / 60, -1, 1));
        }
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
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  // Take over from wherever the camera currently is.
  start(mode) {
    this.mode = mode;
    this.enabled = true;
    const c = this.camera;
    const e = new THREE.Euler().setFromQuaternion(c.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = THREE.MathUtils.clamp(e.x, -1.45, 1.45);
    this.pos.copy(c.position);
    this.vel.set(0, 0, 0);
    if (mode === 'walk') {
      // drop to the street: find a free spot near the camera's ground point
      const p = this.freeSpot(this.pos.x, this.pos.z);
      this.pos.set(p.x, this.groundAt(p.x, p.z) + 1.7, p.y);
      this.pitch = 0;
    }
  }

  stop() {
    this.enabled = false;
  }

  groundAt(x, z) {
    for (const s of this.city.sidewalks) if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) return 0.15;
    return 0;
  }

  blocked(x, z, r = 0.35) {
    for (const b of this.city.colliders) if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r) return true;
    return Math.abs(x) > 118 || Math.abs(z) > 118;
  }

  freeSpot(x, z) {
    x = THREE.MathUtils.clamp(x, -110, 110);
    z = THREE.MathUtils.clamp(z, -110, 110);
    if (!this.blocked(x, z)) return new THREE.Vector2(x, z);
    // snap to the nearest street centreline
    const roads = [-64, 0, 64];
    let best = null;
    for (const c of roads) {
      for (const cand of [new THREE.Vector2(c + 2, z), new THREE.Vector2(x, c + 2)]) {
        if (this.blocked(cand.x, cand.y)) continue;
        const d = Math.hypot(cand.x - x, cand.y - z);
        if (!best || d < best.d) best = { d, p: cand };
      }
    }
    return best ? best.p : new THREE.Vector2(2, 40);
  }

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - this.touchMove.y;
    const strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.touchMove.x;
    const fast = k.has('ShiftLeft') || k.has('ShiftRight');
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    if (this.mode === 'walk') {
      const speed = fast ? 9 : 4.2;
      const tx = (-sy * fwd + cy * strafe) * speed;
      const tz = (-cy * fwd - sy * strafe) * speed;
      const a = 1 - Math.exp(-dt * 10);
      this.vel.x += (tx - this.vel.x) * a;
      this.vel.z += (tz - this.vel.z) * a;
      const nx = this.pos.x + this.vel.x * dt;
      if (!this.blocked(nx, this.pos.z)) this.pos.x = nx;
      else this.vel.x = 0;
      const nz = this.pos.z + this.vel.z * dt;
      if (!this.blocked(this.pos.x, nz)) this.pos.z = nz;
      else this.vel.z = 0;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      this.bob += sp * dt * 1.6;
      const target = this.groundAt(this.pos.x, this.pos.z);
      this.floor += (target - this.floor) * Math.min(1, dt * 12);
      this.pos.y = this.floor + 1.7 + Math.sin(this.bob) * 0.035 * Math.min(1, sp / 4);
    } else {
      const speed = fast ? 70 : 24;
      const up = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') || k.has('ControlLeft') || k.has('KeyC') ? 1 : 0);
      const cp = Math.cos(this.pitch);
      const dir = new THREE.Vector3(-sy * cp, Math.sin(this.pitch), -cy * cp);
      const right = new THREE.Vector3(cy, 0, -sy);
      const t = dir.multiplyScalar(fwd).add(right.multiplyScalar(strafe)).add(new THREE.Vector3(0, up, 0)).multiplyScalar(speed);
      const a = 1 - Math.exp(-dt * 4);
      this.vel.lerp(t, a);
      this.pos.addScaledVector(this.vel, dt);
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, -600, 600);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, -600, 600);
      this.pos.y = THREE.MathUtils.clamp(this.pos.y, 1.2, 420);
    }
    this.camera.position.copy(this.pos);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }
}
