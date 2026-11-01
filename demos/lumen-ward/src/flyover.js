// Cinematic flyover: a loop of camera shots built from the city's landmarks,
// cut together with short fades.
import * as THREE from '../../_shared/three-r187/build/three.webgpu.js';
import { RAIL_Y } from './city.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = (t) => t * t * (3 - 2 * t);

export function makeShots(city) {
  const L = city.landmark;
  const lx = L.lot.cx;
  const lz = L.lot.cz;
  const top = L.roof;
  const shots = [];

  // 1. Approach from the skyline
  shots.push({
    title: 'Approach',
    dur: 11,
    pos: new THREE.CatmullRomCurve3([V(-340, 118, 66), V(-250, 96, 64), V(-160, 74, 62)]),
    look: (t) => V(0, 22 - t * 6, 10 - t * 10),
  });
  // 2. Down the boulevard into the plaza, clearing the rail
  shots.push({
    title: 'Boulevard',
    dur: 13,
    pos: new THREE.CatmullRomCurve3([V(-190, 62, 0.5), V(-110, 40, 0.5), V(-64, 28, 0.5), V(-44, 10, 0.5), V(-26, 6, 0.5)]),
    look: (t, p) => p.clone().add(V(30, -7 + t * 9, 0)),
  });
  // 3. Hologram orbit
  shots.push({
    title: 'Holo plaza',
    dur: 13,
    pos: { getPointAt: (t) => { const a = -0.6 + t * 1.9; return V(Math.cos(a) * 25, 8 + t * 9, Math.sin(a) * 25); } },
    look: () => V(0, 15, 0),
  });
  // 4. Street level along the market street (x = 0 runs north-south)
  shots.push({
    title: 'Market street',
    dur: 14,
    pos: new THREE.CatmullRomCurve3([V(-2.2, 2.4, 108), V(-2.2, 2.6, 75), V(-2.0, 2.8, 42)]),
    look: (t, p) => p.clone().add(V(Math.sin(t * 3.0) * 4, 0.6 + t * 2.5, -20)),
  });
  // 5. Crane up the tallest tower's face
  const side = lx > 0 ? -1 : 1;
  const camX = lx > 0 ? -1.5 : 1.5; // over the central road, clear of lamp arms
  shots.push({
    title: 'Glass tower',
    dur: 13,
    pos: { getPointAt: (t) => V(camX - side * 1.5 * t, 4 + ease(t) * (top + 26), lz + 6 - t * 14) },
    look: (t, p) => V(lx - side * 6, p.y + 10 - t * 26, lz - t * 4).lerp(V(0, 6, 0), ease(Math.max(0, (t - 0.55) / 0.45))),
  });
  // 6. The train sweeps round the north-east corner under a hovering camera
  shots.push({
    title: 'Overground',
    dur: 12,
    follow: 'train',
    pos: new THREE.CatmullRomCurve3([V(70.5, 29, 71), V(70, 27, 68.5), V(69, 25.5, 66)]),
    look: null,
  });
  // 7. Rise over the ward
  shots.push({
    title: 'Lumen Ward',
    dur: 14,
    pos: { getPointAt: (t) => { const a = 2.2 + t * 1.1; const r = 8 + t * 46; return V(Math.cos(a) * r, 34 + t * 200, Math.sin(a) * r); } },
    look: (t) => V(0, 0, 0),
  });
  return shots;
}

export class Flyover {
  constructor(camera, city, fadeEl, captionEl) {
    this.camera = camera;
    this.city = city;
    this.shots = makeShots(city);
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
    // cue the train so it reaches the corner mid-shot
    if (this.shots[this.i].follow === 'train') this.city.trainState.s = this.city.railLen - 118;
    this._setCaption();
  }

  stop() {
    this.active = false;
    if (this.fade) this.fade.style.opacity = 0;
    if (this.caption) this.caption.classList.remove('is-on');
  }

  next(d = 1) {
    this.start(this.i + d);
  }

  _setCaption() {
    if (!this.caption) return;
    const s = this.shots[this.i];
    this.caption.innerHTML = `<span>${String(this.i + 1).padStart(2, '0')} / ${String(this.shots.length).padStart(2, '0')}</span> ${s.title}`;
    this.caption.classList.add('is-on');
  }

  // Pose for shot i at local time u in [0,1]
  pose(i, u) {
    const s = this.shots[i];
    const p = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (s.follow === 'train') {
      // fixed-ish camera over the ring-road crossing, watching the second car
      const { trainState: st, railCurve: rc, railLen: L } = this.city;
      p.copy(s.pos.getPointAt(ease(u)));
      look.copy(rc.getPointAt((((st.s - 14.6) % L) + L) % L / L));
      look.y = RAIL_Y + 2;
    } else {
      p.copy(s.pos.getPointAt(ease(u)));
      look.copy(s.look(u, p));
    }
    return { p, look };
  }

  update(dt) {
    if (!this.active) return;
    const s = this.shots[this.i];
    this.t += dt;
    const u = Math.min(1, this.t / s.dur);
    const { p, look } = this.pose(this.i, u);
    this.camera.position.copy(p);
    this._look.lerp(look, this.t < 0.05 ? 1 : Math.min(1, dt * 3));
    if (this.t < 0.05) this._look.copy(look);
    this.camera.lookAt(this._look);
    const fin = 0.6;
    const a = Math.max(1 - this.t / fin, 1 - (s.dur - this.t) / fin, 0);
    if (this.fade) this.fade.style.opacity = Math.min(1, a).toFixed(3);
    if (this.t >= s.dur) this.next();
  }
}
