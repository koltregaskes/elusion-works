import * as THREE from '../vendor/three/build/three.module.js';
import { heightAt } from './terrain.js';

// Two camera modes. Cinematic: a slow, breathing orbit around the subject, framed per
// preset. Free: drag to look, WASD to walk, Q/E for height. Any input drops you into free
// mode; F hands control back to the cinematic camera, which eases in from wherever you are.

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.mode = 'cinematic';
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.frame = { radius: 30, height: 2.4, speed: 0.015, startAngle: 0.8, lookY: 8 };
    this.angle = 0.8;
    this.target = new THREE.Vector3(0, 6, 0);
    // What the cinematic camera orbits (the oak, or the combine while it works), and
    // the chase offset used while you drive.
    this.focus = new THREE.Vector3();
    this.chase = { heading: 0, yaw: 0 };
    this.snapNext = true;
    this.drag = null;
    this.onModeChange = () => {};

    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (this.mode === 'chase') {
        this.chase.yaw -= dx * 0.005;
        return;
      }
      if (Math.abs(dx) + Math.abs(dy) > 2) this.goFree();
      this.yaw -= dx * 0.0032;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0028, -1.2, 1.2);
    });
    const end = (e) => {
      if (this.drag && e.pointerId === this.drag.id) this.drag = null;
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.fov = THREE.MathUtils.clamp(this.camera.fov + Math.sign(e.deltaY) * 2.5, 22, 75);
      this.camera.updateProjectionMatrix();
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const k = e.key.toLowerCase();
      if (this.mode === 'chase' || this.driving) return; // the keys are driving the combine
      if (['w', 'a', 's', 'd', 'q', 'e', 'shift'].includes(k)) {
        this.keys.add(k);
        if (k !== 'shift') this.goFree();
      }
      if (k === 'f') this.mode === 'cinematic' ? this.goFree() : this.goCinematic();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setFrame(frame) {
    this.frame = { ...this.frame, ...frame };
  }

  syncAnglesFromCamera() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  }

  goFree() {
    if (this.mode === 'free') return;
    this.syncAnglesFromCamera();
    this.mode = 'free';
    this.onModeChange(this.mode);
  }

  goChase() {
    if (this.mode === 'chase') return;
    this.keys.clear();
    this.chase.yaw = 0;
    this.mode = 'chase';
    this.onModeChange(this.mode);
  }

  goCinematic() {
    if (this.mode === 'cinematic') return;
    const p = this.camera.position;
    this.angle = Math.atan2(p.z - this.focus.z, p.x - this.focus.x);
    this.mode = 'cinematic';
    this.onModeChange(this.mode);
  }

  update(dt, t) {
    const cam = this.camera;
    if (this.mode === 'cinematic') {
      const f = this.frame;
      this.angle += f.speed * dt * 6.0;
      const r = f.radius + Math.sin(t * 0.07) * 3;
      const x = this.focus.x + Math.cos(this.angle) * r;
      const z = this.focus.z + Math.sin(this.angle) * r;
      const y = heightAt(x, z) + f.height + Math.sin(t * 0.21) * 0.35;
      const goal = new THREE.Vector3(x, y, z);
      // Always ease towards the moving goal: smooth on entry, and the lag is negligible
      // once settled because the goal itself moves slowly.
      const snap = this.snapNext;
      this.snapNext = false;
      cam.position.lerp(goal, snap ? 1 : 1 - Math.exp(-dt * 1.6));
      const look = this.focus.clone();
      look.y = heightAt(this.focus.x, this.focus.z) + (this.frame.lookY ?? 8) + Math.sin(t * 0.13) * 0.4;
      const m = new THREE.Matrix4().lookAt(cam.position, look, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      cam.quaternion.slerp(q, snap ? 1 : 1 - Math.exp(-dt * 2.2));
      return;
    }
    if (this.mode === 'chase') {
      // Sit behind and above the machine, looking a little ahead of it.
      const h = this.chase.heading + Math.PI + this.chase.yaw;
      const goal = new THREE.Vector3(this.focus.x + Math.cos(h) * 17, 0, this.focus.z + Math.sin(h) * 17);
      goal.y = Math.max(heightAt(goal.x, goal.z) + 1.5, heightAt(this.focus.x, this.focus.z) + 7.5);
      cam.position.lerp(goal, 1 - Math.exp(-dt * 2.5));
      const look = new THREE.Vector3(
        this.focus.x + Math.cos(this.chase.heading) * 6,
        heightAt(this.focus.x, this.focus.z) + 2.2,
        this.focus.z + Math.sin(this.chase.heading) * 6
      );
      const m = new THREE.Matrix4().lookAt(cam.position, look, new THREE.Vector3(0, 1, 0));
      cam.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(m), 1 - Math.exp(-dt * 4));
      return;
    }
    const speed = (this.keys.has('shift') ? 16 : 5) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (this.keys.has('w')) cam.position.addScaledVector(fwd, speed);
    if (this.keys.has('s')) cam.position.addScaledVector(fwd, -speed);
    if (this.keys.has('d')) cam.position.addScaledVector(right, speed);
    if (this.keys.has('a')) cam.position.addScaledVector(right, -speed);
    if (this.keys.has('e')) cam.position.y += speed;
    if (this.keys.has('q')) cam.position.y -= speed;
    const floor = heightAt(cam.position.x, cam.position.z) + 0.45;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.position.y = Math.min(cam.position.y, 120);
    const lim = 380;
    cam.position.x = THREE.MathUtils.clamp(cam.position.x, -lim, lim);
    cam.position.z = THREE.MathUtils.clamp(cam.position.z, -lim, lim);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }
}
