// Shared keyboard/touch flight movement, independent of the renderer.
import * as THREE from '../../_shared/three-r187/build/three.webgpu.js';

export function updateFly(fly, camera, ground, dt) {
  const k = fly.keys;
  const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) - fly.touchMove.y;
  const r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + fly.touchMove.x;
  const u = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') || k.has('KeyC') ? 1 : 0);
  const sp = (k.has('ShiftLeft') ? 80 : 22) * dt;
  const cp = Math.cos(fly.pitch);
  fly.pos.add(new THREE.Vector3(-Math.sin(fly.yaw) * cp, Math.sin(fly.pitch), -Math.cos(fly.yaw) * cp).multiplyScalar(f * sp));
  fly.pos.add(new THREE.Vector3(Math.cos(fly.yaw), 0, -Math.sin(fly.yaw)).multiplyScalar(r * sp));
  fly.pos.y = Math.max(fly.pos.y + u * sp, ground.sample(fly.pos.x, fly.pos.z) + 1.5);
  camera.position.copy(fly.pos);
  camera.quaternion.setFromEuler(new THREE.Euler(fly.pitch, fly.yaw, 0, 'YXZ'));
}

export function lookFly(fly, dx, dy) {
  fly.yaw -= dx * 0.006;
  fly.pitch = THREE.MathUtils.clamp(fly.pitch - dy * 0.005, -1.45, 1.45);
}
