// Cinematic flyover for Thornvale: a loop of drone-style shots with fades.
import * as THREE from '../../_shared/three-r187/build/three.webgpu.js';
import { TOWN } from './terrain.js';
import { SQUARE, CHURCH_SQ } from './town.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = (t) => t * t * (3 - 2 * t);
const B = TOWN.base;
const T = TOWN.base + TOWN.terraceRise;

export function makeShots(sample) {
  const above = (x, z, h) => V(x, Math.max(sample(x, z) + h, h), z);
  return [
    {
      title: 'Thornvale',
      dur: 14,
      // the arrival: a slow arc from the north-west with the low sun behind the
      // camera, so the walls and roofs are lit and the sky and hills fill the top
      pos: { getPointAt: (t) => { const a = -2.25 + t * 0.85; return V(Math.cos(a) * (250 - t * 30), 105 - t * 30, Math.sin(a) * (250 - t * 30)); } },
      look: (t) => V(0, B + 10 - t * 4, 6),
    },
    {
      title: 'The south gate',
      dur: 13,
      pos: new THREE.CatmullRomCurve3([V(40, 70, 330), V(25, 48, 220), V(6, 34, 150), V(0, B + 9, 108)]),
      look: (t) => V(0, B + 6 - t * 2, TOWN.rz - 10),
    },
    {
      title: 'Market square',
      dur: 14,
      pos: { getPointAt: (t) => { const a = 1.2 + t * 1.6; return V(SQUARE.x + Math.cos(a) * 19, B + 5.5 + t * 3, SQUARE.z + Math.sin(a) * 14); } },
      look: () => V(SQUARE.x, B + 2.5, SQUARE.z),
    },
    {
      title: 'Up the grand stair',
      dur: 12,
      pos: new THREE.CatmullRomCurve3([V(0, B + 2.2, TOWN.terraceZ + 22), V(0, B + 4.5, TOWN.terraceZ + 9), V(0, T + 3.5, TOWN.terraceZ - 4), V(-12, T + 6, CHURCH_SQ.z + 2)]),
      look: (t, p) => V(CHURCH_SQ.x * t, T + 6 + t * 10, TOWN.terraceZ - 30),
    },
    {
      title: 'The church',
      dur: 12,
      pos: { getPointAt: (t) => V(CHURCH_SQ.x + 6 - t * 10, T + 3 + ease(t) * 46, CHURCH_SQ.z + 9 - t * 6) },
      look: (t, p) => V(CHURCH_SQ.x, p.y + 6 - t * 12, -56),
    },
    {
      title: 'Along the walls',
      dur: 14,
      pos: { getPointAt: (t) => { const a = 0.15 + t * 1.2; return V(Math.cos(a) * TOWN.rx * 1.12, B + 16, Math.sin(a) * TOWN.rz * 1.12); } },
      look: (t, p) => V(p.x * 0.6, B + 6, p.z * 0.6),
    },
    {
      title: 'The valley',
      dur: 15,
      pos: new THREE.CatmullRomCurve3([V(-260, 60, 300), V(-180, 85, 200), V(-120, 110, 120)]),
      look: (t) => V(0, B + 10, -40 - t * 60),
    },
  ];
}

export class Flyover {
  constructor(camera, sample, fadeEl, captionEl) {
    this.camera = camera;
    this.shots = makeShots(sample);
    this.i = 0;
    this.t = 0;
    this.fade = fadeEl;
    this.caption = captionEl;
    this.active = false;
    this._look = new THREE.Vector3();
  }

  start(i = 0) {
    this.active = true;
    this.i = ((i % this.shots.length) + this.shots.length) % this.shots.length;
    this.t = 0;
    if (this.caption) {
      const s = this.shots[this.i];
      this.caption.innerHTML = `<span>${String(this.i + 1).padStart(2, '0')} / ${String(this.shots.length).padStart(2, '0')}</span> ${s.title}`;
      this.caption.classList.add('is-on');
    }
  }

  stop() {
    this.active = false;
    if (this.fade) this.fade.style.opacity = 0;
    this.caption?.classList.remove('is-on');
  }

  next(d = 1) {
    this.start(this.i + d);
  }

  pose(i, u) {
    const s = this.shots[i];
    const p = s.pos.getPointAt(ease(u));
    return { p, look: s.look(u, p) };
  }

  update(dt) {
    if (!this.active) return;
    const s = this.shots[this.i];
    this.t += dt;
    const u = Math.min(1, this.t / s.dur);
    const { p, look } = this.pose(this.i, u);
    this.camera.position.copy(p);
    if (this.t < 0.05) this._look.copy(look);
    this._look.lerp(look, Math.min(1, dt * 3));
    this.camera.lookAt(this._look);
    const a = Math.max(1 - this.t / 0.7, 1 - (s.dur - this.t) / 0.7, 0);
    if (this.fade) this.fade.style.opacity = Math.min(1, a).toFixed(3);
    if (this.t >= s.dur) this.next();
  }
}
