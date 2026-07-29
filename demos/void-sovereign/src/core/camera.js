import * as THREE from '../../vendor/three/build/three.module.js';
import { bus } from './events.js';

/* Focus-orbit camera rig.

   Homeworld's camera is the reason the game reads as *commanding a fleet*
   rather than driving a cursor: the world rotates around a point you chose,
   and the controls feel identical whether that point is a 14 m interceptor or
   a 60 km battle sphere. Three things make that work and all three are here:

   1. Zoom is exponential. The rig stores ln(distance), so one wheel notch is
      always the same *proportional* step. Everything derived from distance —
      pan rate, near plane, sway amplitude, gizmo scale — is therefore also
      scale-free.
   2. Every state variable is driven by a critically damped spring (implicit
      Euler, unconditionally stable, provably no overshoot). Never a lerp: a
      lerp has no memory, so it cannot carry momentum, and momentum is what
      reads as mass.
   3. The camera is a *derived* quantity. Yaw, pitch, distance and focus are
      the state; position is recomputed each frame. That keeps orbit exact at
      any zoom and makes collision push-out a one-line change to distance
      instead of a search through 3D space. */

const DEG = Math.PI / 180;

/* Just short of the pole. Going all the way to +/-90 makes `lookAt` pick an
   arbitrary roll and the view snaps a quarter turn — the classic gimbal flip. */
const PITCH_LIMIT = Math.PI * 0.5 - 0.035;

const DEFAULTS = {
  minDistance: 6,          // metres — an interceptor still fills the frame here
  maxDistance: 165000,     // the whole 60 km cube plus headroom
  orbitSensitivity: 0.0040, // radians per CSS pixel
  zoomStep: 0.16,          // ln(distance) per wheel notch => x1.174
  cursorZoom: 0.30,        // how much zoom-in drags the focus toward the cursor
  orbitOmega: 11.0,        // spring rates (rad/s); higher = tighter
  focusOmega: 6.0,
  zoomOmega: 8.0,
  fovOmega: 3.2,
  clearOmega: 9.0,
  swayPixels: 2.6,         // handheld sway amplitude, screen pixels
  shakePixels: 26,         // impact shake scale, screen pixels at full trauma
  idleDelay: 1.15,         // seconds of no input before sway fades in
  sensorsMs: 820,          // cinematic pull-out duration
  sensorsPitch: 1.16,      // ~66 degrees: schematic, but keeps some parallax
  sensorsMinDistance: 19000,
};

/* ------------------------------------------------------------------ springs */

/* Implicit-Euler critically damped spring. Solving the step implicitly rather
   than explicitly is what makes it stable at any dt and any omega — an
   explicit integrator explodes on a frame hitch, which is exactly when the
   camera must not. */
function springStep(state, dt) {
  const o = state.omega;
  const f = 1 + 2 * dt * o;
  const hoo = dt * o * o;
  const hhoo = dt * hoo;
  const detInv = 1 / (f + hhoo);
  const x = (f * state.value + dt * state.velocity + hhoo * state.target) * detInv;
  state.velocity = (state.velocity + hoo * (state.target - state.value)) * detInv;
  state.value = x;
  return x;
}

class Spring {
  constructor(value, omega) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.omega = omega;
  }

  step(dt) {
    return dt > 0 ? springStep(this, dt) : this.value;
  }

  snap(v) {
    this.value = v;
    this.target = v;
    this.velocity = 0;
  }
}

class Vec3Spring {
  constructor(omega) {
    this.value = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.omega = omega;
    this._axis = { value: 0, target: 0, velocity: 0, omega };
  }

  step(dt) {
    if (dt <= 0) return this.value;
    const a = this._axis;
    a.omega = this.omega;
    for (const k of ['x', 'y', 'z']) {
      a.value = this.value[k];
      a.target = this.target[k];
      a.velocity = this.velocity[k];
      springStep(a, dt);
      this.value[k] = a.value;
      this.velocity[k] = a.velocity;
    }
    return this.value;
  }

  snap(v) {
    this.value.copy(v);
    this.target.copy(v);
    this.velocity.set(0, 0, 0);
  }
}

/* ------------------------------------------------------------------- maths */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* Smootherstep: zero first *and* second derivative at both ends, so a scripted
   move starts and stops without a visible velocity step. */
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/* Band-limited pseudo-noise. Three octaves of sine beats white noise for
   camera shake: the spectrum has no high-frequency content, so the image
   never strobes and nobody gets motion sick. */
function noise1(t, seed) {
  return (
    Math.sin(t + seed * 12.9898) * 0.62 +
    Math.sin(t * 2.37 + seed * 37.719) * 0.27 +
    Math.sin(t * 4.91 + seed * 78.233) * 0.11
  );
}

/* Scratch — the rig runs every frame and must not allocate. */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _look = new THREE.Vector3();
const _prevPos = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/* ------------------------------------------------------------------ the rig */

export class CameraRig {
  constructor({ engine, domElement = null, world = null, options = null }) {
    this.engine = engine;
    this.camera = engine.camera;
    this.domElement = domElement || (engine.renderer && engine.renderer.domElement) || null;
    this.world = world || null;
    this.options = Object.assign({}, DEFAULTS, options || {});

    this.baseFov = this.camera.fov;
    this._nearBase = this.camera.near;
    this._farBase = this.camera.far;

    const o = this.options;

    /* State. Position is derived from these four every frame. */
    this._focus = new Vec3Spring(o.focusOmega);
    this._yaw = new Spring(0.55, o.orbitOmega);
    this._pitch = new Spring(0.42, o.orbitOmega);
    this._logDist = new Spring(Math.log(2600), o.zoomOmega);
    this._fov = new Spring(this.baseFov, o.fovOmega);
    this._clear = new Spring(0, o.clearOmega);

    this._logMin = Math.log(o.minDistance);
    this._logMax = Math.log(o.maxDistance);

    this._focusRadius = 0;      // bounding radius of whatever we are framing
    this._follow = null;        // entities whose centroid the focus tracks
    this._elapsed = 0;
    this._idle = 0;
    this._swayGain = new Spring(0, 1.6);
    this._moveSpeed = 0;
    this._lastUpdateMs = -1e9;
    this._colliderTick = 0;
    this._colliders = [];
    this._worldOk = true;

    /* Impact shake: trauma decays linearly, displacement goes as trauma^2, so
       a big hit hits hard and the tail vanishes instead of lingering. */
    this._trauma = 0;
    this._shakeDir = new THREE.Vector3(0, 1, 0);
    this._shakeSeed = 0;

    this._sensors = false;
    this._restore = null;
    this._trans = null;

    this._reduced = false;
    this._mq = null;
    if (typeof window !== 'undefined' && window.matchMedia) {
      this._mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this._reduced = this._mq.matches;
      this._onMq = (e) => { this._reduced = e.matches; };
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._onMq);
      else if (this._mq.addListener) this._mq.addListener(this._onMq);
    }

    this._offs = [
      bus.on('ui:focus', (p) => {
        if (!p || !p.point) return;
        this.focusOn(p.point, p.distance, false);
      }),
      bus.on('ui:sensorsToggle', (p) => this.setSensorsMode(!!(p && p.open))),
      bus.on('sim:death', (p) => this._onDeath(p)),
    ];

    /* Self-drive as a fallback. If main.js calls update() itself the guard in
       update() makes this a no-op for that frame, so main.js always wins. */
    this._offHook = engine.registerRenderHook((dt) => this.update(dt));

    this._apply(0);
  }

  /* --------------------------------------------------------------- accessors */

  get distance() {
    return Math.exp(this._logDist.value) + this._clear.value;
  }

  get targetDistance() {
    return Math.exp(this._logDist.target);
  }

  get focusPoint() {
    return this._focus.value;
  }

  get yaw() {
    return this._yaw.value;
  }

  get pitch() {
    return this._pitch.value;
  }

  get sensorsMode() {
    return this._sensors;
  }

  /** World metres covered by one CSS pixel at `dist`. The unit that makes
      every screen-space size in the game scale-invariant. */
  worldPerPixel(dist) {
    const d = dist === undefined ? this.distance : dist;
    const h = Math.max(1, (this.engine.size && this.engine.size.h) || 1);
    return (2 * d * Math.tan(this.camera.fov * DEG * 0.5)) / h;
  }

  setWorld(world) {
    this.world = world || null;
    this._colliders = [];
    this._worldOk = true;
  }

  /* ------------------------------------------------------------- navigation */

  focusOn(point, distance, instant = false) {
    if (!point) return;
    this._cancelTransition();
    this._follow = null;
    this._focus.target.set(point.x, point.y, point.z);
    this._focusRadius = 0;
    if (typeof distance === 'number' && isFinite(distance)) {
      this._logDist.target = clamp(Math.log(Math.max(1e-3, distance)), this._logMin, this._logMax);
    }
    if (instant) {
      this._focus.snap(this._focus.target);
      this._logDist.snap(this._logDist.target);
      this._clear.snap(0);
      this._apply(0);
    }
    this._idle = 0;
  }

  /** Dolly out until a bounding sphere of the given entities fits the frame,
      accounting for aspect: on a wide window the vertical FOV is the binding
      constraint, on a tall one it is the horizontal. */
  frameEntities(entities, instant = false) {
    const list = this._toList(entities);
    if (!list.length) return;

    _v1.set(0, 0, 0);
    for (const e of list) {
      const p = e.position || (e.object3D && e.object3D.position);
      if (p) _v1.add(p);
    }
    _v1.divideScalar(list.length);

    let radius = 0;
    let biggest = 0;
    for (const e of list) {
      const p = e.position || (e.object3D && e.object3D.position);
      if (!p) continue;
      const r = e.radius || (e.def ? e.def.length * 0.55 : 10);
      biggest = Math.max(biggest, r);
      radius = Math.max(radius, _v2.copy(p).sub(_v1).length() + r);
    }
    radius = Math.max(radius, 8);

    const vHalf = this.baseFov * DEG * 0.5;
    const hHalf = Math.atan(Math.tan(vHalf) * Math.max(0.2, this.camera.aspect));
    const half = Math.min(vHalf, hHalf);
    const dist = clamp((radius / Math.sin(half)) * 1.25, this._minDistance(biggest), this.options.maxDistance);

    this._cancelTransition();
    this._focus.target.copy(_v1);
    this._focusRadius = biggest;
    this._logDist.target = clamp(Math.log(dist), this._logMin, this._logMax);
    this._follow = list.length ? list : null;

    if (instant) {
      this._focus.snap(this._focus.target);
      this._logDist.snap(this._logDist.target);
      this._apply(0);
    }
    this._idle = 0;
  }

  /** Keep the focus glued to a moving group's centroid (what F should do). */
  follow(entities) {
    const list = this._toList(entities);
    this._follow = list.length ? list : null;
  }

  clearFollow() {
    this._follow = null;
  }

  /** dx/dy in CSS pixels. Angular, so the feel is identical at every zoom. */
  orbitBy(dxPx, dyPx) {
    const s = this.options.orbitSensitivity;
    this._cancelTransition();
    this._yaw.target -= dxPx * s;
    this._pitch.target = clamp(this._pitch.target + dyPx * s, -PITCH_LIMIT, PITCH_LIMIT);
    this._idle = 0;
  }

  /** Slide the focus across its horizontal plane, in screen pixels.
      +dx is screen-right, +dy is screen-down. */
  panScreen(dxPx, dyPx) {
    if (!dxPx && !dyPx) return;
    this._cancelTransition();
    this._follow = null;

    const wpp = this.worldPerPixel(Math.exp(this._logDist.target));
    const y = this._yaw.target;
    const sy = Math.sin(y);
    const cy = Math.cos(y);

    /* Screen-up maps onto the plane through the view direction, so the closer
       to horizontal the view gets the further a pixel of drag reaches. Divide
       by sin(pitch) to undo it, but floor the divisor or a near-horizon camera
       teleports across the map. */
    const fwdScale = 1 / Math.max(0.45, Math.abs(Math.sin(this._pitch.target)));

    const t = this._focus.target;
    t.x += cy * dxPx * wpp + -sy * -dyPx * wpp * fwdScale;
    t.z += -sy * dxPx * wpp + -cy * -dyPx * wpp * fwdScale;
    this._idle = 0;
  }

  /** Shift the focus by a world-space vector (used by touch two-finger pan). */
  panWorld(v) {
    this._cancelTransition();
    this._follow = null;
    this._focus.target.add(v);
    this._idle = 0;
  }

  /** `steps` is wheel notches: positive zooms in. `ndc` optionally anchors the
      zoom under the cursor, which is the single biggest modern improvement on
      the Homeworld camera. */
  zoomBy(steps, ndc = null) {
    if (!steps) return;
    this._cancelTransition();

    const before = this._logDist.target;
    const next = clamp(before - steps * this.options.zoomStep, this._logMin, this._logMax);
    this._logDist.target = next;

    const w = this.options.cursorZoom;
    if (ndc && w > 0 && next < before) {
      const off = Math.hypot(ndc.x, ndc.y);
      if (off > 0.08) {
        /* Pull the focus a fraction of the way toward whatever the cursor is
           over, on the focus plane. Zoom-out is deliberately not anchored:
           un-anchored out means repeated in/out cycles do not drift. */
        this.screenToWorldPlane(ndc, this._focus.target.y, _v3);
        const shift = (1 - Math.exp(next - before)) * w * clamp01((off - 0.08) / 0.6);
        this._focus.target.lerp(_v3, clamp01(shift));
        this._follow = null;
      }
    }
    this._idle = 0;
  }

  /* ---------------------------------------------------------- sensors view */

  setSensorsMode(open) {
    const want = !!open;
    if (want === this._sensors) return;
    this._sensors = want;

    if (want) {
      this._restore = {
        yaw: this._yaw.target,
        pitch: this._pitch.target,
        logDist: this._logDist.target,
        focus: this._focus.target.clone(),
      };
      const pulled = Math.max(
        Math.exp(this._logDist.target) * 2.6,
        this.options.sensorsMinDistance,
      );
      this._beginTransition(
        {
          yaw: this._yaw.target + 0.22,
          pitch: this.options.sensorsPitch,
          logDist: clamp(Math.log(pulled), this._logMin, this._logMax),
          focus: this._focus.target.clone(),
        },
        this.options.sensorsMs,
      );
    } else if (this._restore) {
      this._beginTransition(this._restore, this.options.sensorsMs * 0.85);
      this._restore = null;
    }
  }

  _beginTransition(to, ms) {
    this._follow = null;
    this._trans = {
      t: 0,
      dur: Math.max(1, ms) / 1000,
      from: {
        yaw: this._yaw.value,
        pitch: this._pitch.value,
        logDist: this._logDist.value,
        focus: this._focus.value.clone(),
      },
      to: {
        yaw: to.yaw,
        pitch: clamp(to.pitch, -PITCH_LIMIT, PITCH_LIMIT),
        logDist: clamp(to.logDist, this._logMin, this._logMax),
        focus: to.focus.clone ? to.focus.clone() : new THREE.Vector3().copy(to.focus),
      },
    };
  }

  _cancelTransition() {
    if (!this._trans) return;
    /* Hand the springs the pose we stopped at so there is no snap. */
    this._yaw.target = this._yaw.value;
    this._pitch.target = this._pitch.value;
    this._logDist.target = this._logDist.value;
    this._focus.target.copy(this._focus.value);
    this._trans = null;
  }

  /* ------------------------------------------------------------ projection */

  /** Ray through an NDC point, in world space. */
  rayFromNdc(ndc, out = new THREE.Ray()) {
    const cam = this.camera;
    out.origin.setFromMatrixPosition(cam.matrixWorld);
    out.direction.set(ndc.x, ndc.y, 0.5).unproject(cam).sub(out.origin).normalize();
    return out;
  }

  /** Unproject to the horizontal plane at height `planeY`. Always returns a
      usable point: when the ray runs away from the plane it falls back to a
      bounded point in the same compass direction rather than infinity. */
  screenToWorldPlane(ndc, planeY = 0, out = new THREE.Vector3()) {
    const cam = this.camera;
    const origin = _v1.setFromMatrixPosition(cam.matrixWorld);
    const dir = _dir.set(ndc.x, ndc.y, 0.5).unproject(cam).sub(origin).normalize();

    const limit = this.distance * 14 + 1000;
    let t = -1;
    if (Math.abs(dir.y) > 1e-7) t = (planeY - origin.y) / dir.y;

    if (t > 0 && t < limit) {
      out.copy(origin).addScaledVector(dir, t);
    } else {
      const fx = dir.x;
      const fz = dir.z;
      const len = Math.hypot(fx, fz) || 1;
      out.set(origin.x + (fx / len) * limit, planeY, origin.z + (fz / len) * limit);
    }
    out.y = planeY;
    return out;
  }

  /* ---------------------------------------------------------------- shake */

  /** Directional, distance-scaled impulse. Also called directly by tests. */
  addShake(point, radius = 100, strength = 1) {
    if (this._reduced) return;
    const camPos = this.camera.position;
    const d = Math.max(1, _v1.copy(camPos).sub(point).length());

    /* A mothership going up should be felt from ten kilometres; a corvette
       from a few hundred metres. Reach scales with the wreck, falloff is
       superlinear so the edge of the reach is genuinely nothing. */
    const reach = radius * 26 + 500;
    if (d > reach) return;
    const falloff = Math.pow(1 - d / reach, 1.35);
    const size = clamp(radius / 260, 0.12, 1);
    const amp = falloff * size * strength;
    if (amp <= 0.002) return;

    this._shakeDir.copy(camPos).sub(point);
    if (this._shakeDir.lengthSq() < 1e-6) this._shakeDir.set(0, 1, 0);
    this._shakeDir.normalize();
    this._shakeSeed = (this._shakeSeed + 0.37) % 1;
    this._trauma = Math.min(1, this._trauma + amp);
  }

  _onDeath(p) {
    const e = p && p.entity;
    if (!e || !e.position) return;
    const radius = e.radius || (e.def ? e.def.length * 0.55 : 10);
    if (radius < 40) return;  // fighters and corvettes do not move the camera
    this.addShake(e.position, radius, 1);
  }

  /* --------------------------------------------------------------- update */

  update(dt) {
    /* main.js may call this and the render hook will also fire. Two calls in
       one frame are microseconds apart; two frames are >= 4 ms apart even at
       240 Hz. */
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this._lastUpdateMs < 2) return;
    this._lastUpdateMs = now;

    const step = clamp(dt || 0, 0, 0.1);
    this._elapsed += step;
    this._idle += step;
    this._apply(step);
  }

  _apply(dt) {
    const cam = this.camera;
    const o = this.options;

    if (this._follow && this._follow.length) this._trackFollow();

    if (this._trans) {
      const tr = this._trans;
      tr.t += dt;
      const k = smoother(clamp01(tr.dur > 0 ? tr.t / tr.dur : 1));
      this._yaw.snap(tr.from.yaw + (tr.to.yaw - tr.from.yaw) * k);
      this._pitch.snap(tr.from.pitch + (tr.to.pitch - tr.from.pitch) * k);
      this._logDist.snap(tr.from.logDist + (tr.to.logDist - tr.from.logDist) * k);
      this._focus.snap(_v1.copy(tr.from.focus).lerp(tr.to.focus, k));
      if (tr.t >= tr.dur) this._trans = null;
    } else {
      this._pitch.target = clamp(this._pitch.target, -PITCH_LIMIT, PITCH_LIMIT);
      this._logDist.target = clamp(this._logDist.target, this._logMin, this._logMax);
      this._yaw.step(dt);
      this._pitch.step(dt);
      this._logDist.step(dt);
      this._focus.step(dt);
    }

    this._pitch.value = clamp(this._pitch.value, -PITCH_LIMIT, PITCH_LIMIT);

    const focus = this._focus.value;
    let dist = Math.exp(this._logDist.value);

    /* Never inside the thing you are looking at. */
    const floor = this._minDistance(this._focusRadius);
    if (dist < floor) dist = floor;

    const yaw = this._yaw.value;
    const pitch = this._pitch.value;
    const cp = Math.cos(pitch);
    _dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).normalize();

    /* Push out along the view vector if a hull swallowed the camera. */
    this._clear.target = Math.max(0, this._sweepClearance(focus, _dir, dist) - dist);
    this._clear.step(dt);
    const eff = dist + this._clear.value;

    _prevPos.copy(cam.position);
    _v1.copy(focus).addScaledVector(_dir, eff);
    _look.copy(focus);

    /* Idle life. Amplitude is in *pixels*, so it is exactly as subtle at 8 m
       as at 80 km. Fades in only once the player has stopped touching it. */
    let roll = 0;
    const swayWant = this._reduced ? 0 : this._idle > o.idleDelay ? 1 : 0;
    this._swayGain.target = swayWant;
    this._swayGain.step(dt);
    const sg = this._swayGain.value;
    if (sg > 0.001) {
      const wpp = this.worldPerPixel(eff);
      const t = this._elapsed;
      const amp = o.swayPixels * wpp * sg;
      const sx = (Math.sin(t * 0.31) * 0.55 + Math.sin(t * 0.74 + 1.9) * 0.3 + Math.sin(t * 1.63 + 0.4) * 0.15);
      const sy = (Math.sin(t * 0.27 + 2.6) * 0.5 + Math.sin(t * 0.61 + 0.8) * 0.32 + Math.sin(t * 1.41 + 2.2) * 0.18);
      const sz = (Math.sin(t * 0.23 + 4.1) * 0.6 + Math.sin(t * 0.55 + 3.3) * 0.4);
      this._basis(_dir, _v2, _v3);
      _v1.addScaledVector(_v2, sx * amp).addScaledVector(_v3, sy * amp);
      _v1.addScaledVector(_dir, sz * amp * 0.6);
      /* Nudge the look target by less than a pixel so the centre breathes too. */
      _look.addScaledVector(_v2, sx * wpp * 0.9 * sg).addScaledVector(_v3, sy * wpp * 0.9 * sg);
      roll += Math.sin(t * 0.19 + 1.1) * 0.0009 * sg;
    }

    /* Impact shake. */
    if (this._trauma > 0) {
      this._trauma = Math.max(0, this._trauma - dt * 1.05);
      const s = this._trauma * this._trauma;
      if (s > 0.0001) {
        const wpp = this.worldPerPixel(eff);
        const t = this._elapsed * 19;
        const seed = this._shakeSeed;
        this._basis(_dir, _v2, _v3);
        const push = o.shakePixels * wpp * s;
        _v1.addScaledVector(this._shakeDir, push * 0.55 * (0.6 + 0.4 * noise1(t * 0.7, seed)));
        _v1.addScaledVector(_v2, push * noise1(t, seed + 0.11));
        _v1.addScaledVector(_v3, push * 0.8 * noise1(t, seed + 0.53));
        roll += noise1(t * 0.8, seed + 0.77) * 0.010 * s;
      }
    }

    cam.position.copy(_v1);
    cam.up.set(0, 1, 0);
    cam.lookAt(_look);
    if (roll) cam.rotateZ(roll);

    /* Near plane rides the zoom. The log depth buffer carries the precision,
       so the only job here is to stop the near plane eating a fighter's nose
       when you are 8 m off it, and to stop it being absurdly tight at 100 km. */
    const near = clamp(eff * 0.006, 0.03, 140);
    let projDirty = false;
    if (Math.abs(cam.near - near) > near * 0.02) {
      cam.near = near;
      projDirty = true;
    }

    /* Dynamic FOV: a touch wider when the fleet is a diagram and when the
       camera is travelling, a touch tighter in close. Small numbers on
       purpose — this should be felt, not seen. */
    if (dt > 0) {
      const moved = _prevPos.distanceTo(cam.position);
      const inst = moved / Math.max(dt, 1e-4);
      this._moveSpeed += (inst - this._moveSpeed) * clamp01(dt * 6);
    }
    const zt = clamp01((Math.log(eff) - Math.log(600)) / (Math.log(60000) - Math.log(600)));
    const st = clamp01(this._moveSpeed / Math.max(1, eff * 1.6));
    this._fov.target = clamp(this.baseFov - 3.5 * (1 - zt) + 6.0 * zt + 4.5 * st, 38, 62);
    this._fov.step(dt);
    if (Math.abs(cam.fov - this._fov.value) > 0.01) {
      cam.fov = this._fov.value;
      projDirty = true;
    }
    if (projDirty) cam.updateProjectionMatrix();

    cam.updateMatrixWorld();
  }

  /* ------------------------------------------------------------- internals */

  _minDistance(radius) {
    return Math.max(this.options.minDistance, (radius || 0) * 1.25);
  }

  /** Orthonormal right/up for the current view direction. */
  _basis(dir, right, up) {
    right.set(dir.z, 0, -dir.x);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(right, dir).normalize();
  }

  _trackFollow() {
    const list = this._follow;
    _v2.set(0, 0, 0);
    let n = 0;
    let biggest = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || e.alive === false) continue;
      const p = e.position || (e.object3D && e.object3D.position);
      if (!p) continue;
      _v2.add(p);
      biggest = Math.max(biggest, e.radius || 0);
      n++;
    }
    if (!n) {
      this._follow = null;
      return;
    }
    this._focus.target.copy(_v2.divideScalar(n));
    this._focusRadius = biggest;
  }

  /** Distance along `dir` at which the camera clears every nearby hull. */
  _sweepClearance(focus, dir, dist) {
    const list = this._collidersFor(focus, dist);
    let out = dist;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const c = e.position || (e.object3D && e.object3D.position);
      if (!c) continue;
      const R = (e.radius || 0) * 1.18 + 3;
      const mx = focus.x - c.x;
      const my = focus.y - c.y;
      const mz = focus.z - c.z;
      const b = 2 * (dir.x * mx + dir.y * my + dir.z * mz);
      const cc = mx * mx + my * my + mz * mz - R * R;
      const disc = b * b - 4 * cc;
      if (disc <= 0) continue;
      const s = Math.sqrt(disc);
      const t1 = (-b - s) * 0.5;
      const t2 = (-b + s) * 0.5;
      if (out > t1 && out < t2) out = t2;
    }
    return out;
  }

  /* Only capitals can swallow a camera, and there are never many of them.
     Rescan on a slow cadence so a 1,000-unit battle costs nothing. */
  _collidersFor(focus, dist) {
    if (!this.world || !this._worldOk) return this._colliders;
    if (this._colliderTick-- > 0) return this._colliders;
    this._colliderTick = 10;

    const found = this._colliders;
    found.length = 0;
    const ents = this.world.entities;
    if (!ents || typeof ents.forEach !== 'function') {
      this._worldOk = false;
      return found;
    }
    const reach = dist * 2 + 4000;
    ents.forEach((e) => {
      if (found.length >= 48) return;
      if (!e || e.alive === false) return;
      const r = e.radius || 0;
      if (r < 40) return;
      const p = e.position || (e.object3D && e.object3D.position);
      if (!p) return;
      if (_v2.copy(p).sub(focus).lengthSq() > (reach + r) * (reach + r)) return;
      found.push(e);
    });
    return found;
  }

  _toList(entities) {
    if (!entities) return [];
    if (Array.isArray(entities)) return entities.filter(Boolean);
    if (typeof entities[Symbol.iterator] === 'function') return Array.from(entities).filter(Boolean);
    return [entities];
  }

  /* -------------------------------------------------------------- teardown */

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    if (this._offHook) this._offHook();
    this._offHook = null;
    if (this._mq && this._onMq) {
      if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._onMq);
      else if (this._mq.removeListener) this._mq.removeListener(this._onMq);
    }
    this._mq = null;
    this._colliders.length = 0;
    this._follow = null;
    this.camera.near = this._nearBase;
    this.camera.far = this._farBase;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }
}

export default CameraRig;
