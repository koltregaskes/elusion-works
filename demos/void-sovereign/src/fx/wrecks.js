/* WRECKS - a dead capital stays on screen as its own broken hull.

   Critic round 4, fix 1: the kill used to delete the hull mesh and stage the
   death in its place, so a heavy cruiser was gone 0.1 s after the killing hit
   and its "wreck" was 52 debris chips too small and too dark to read from
   1.6 km. Here the hull itself is kept. At the kill the dead ship is re-drawn
   as 2-4 instances of its own class, each clipped to one slice of the keel
   (`aCut` in the hull material), charred to the damage shading's full value,
   and set drifting apart and tumbling slowly. Secondaries walk each section
   for the first part of its life, and at the end each section burns away from
   its two open ends instead of popping out.

   Cost: the sections live in the class's own instanced batch, so a wreck adds
   no draw call of its own. A class that is never batched in play (cruiser,
   carrier) gets its batch on its first death, once per class and team.

   Render-side only. Nothing here touches the sim; it is driven entirely off
   `sim:death` and the FX clock, and uses the death's own RNG fork, so it can
   neither perturb nor depend on simulation state. */
import * as THREE from '../../vendor/three/build/three.module.js';
import { getFleetBatch, wreckInfo, pickLod } from '../ships/index.js';
import { hullFloorPx } from '../ships/catalog.js';

/* Frigate size and up: assault, ion and support frigates are 115-140 m. */
const WRECK_MIN_LENGTH = 100;
/* Sections alive at once, across the battle. The oldest wreck goes first. */
const MAX_SECTIONS = 72;
/* The last seconds of a section, spent burning away from both cut ends. */
const BURN_OUT = 3.0;

const CORE = new THREE.Color(0xfff2d8);
const FIRE = new THREE.Color(0xff9a42);
const SOOT = new THREE.Color(0x4d453f);

const _m = new THREE.Matrix4();
const _o = new THREE.Vector3();
const _p = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _s = new THREE.Vector3();

export class WreckFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.drawCalls = 0;
    this._sections = [];
    this._batches = new Set();
  }

  get count() { return this._sections.length; }

  /** How long a dead hull of length L stays on screen, in seconds. Matched to
      the debris field's keel sections (40-58 s on a cruiser), so the hull and
      its chips leave together. */
  static lifeFor(L) {
    return Math.min(62, Math.max(30, 24 + 35 * Math.sqrt(L / 620)));
  }

  kill(entity) {
    const def = entity && entity.def;
    const L = (def && def.length) || 0;
    const o = entity && entity.object3D;
    if (L < WRECK_MIN_LENGTH || !o) return;
    const info = wreckInfo(entity.classId);
    if (!info || !(info.zMax > info.zMin)) return;
    let batch = null;
    try { batch = getFleetBatch(entity.classId, entity.team || 0); } catch (e) { batch = null; }
    if (!batch || typeof batch.setWreckSection !== 'function') return;
    this._batches.add(batch);

    o.updateMatrix();
    const p0 = new THREE.Vector3();
    const q0 = new THREE.Quaternion();
    const s0 = new THREE.Vector3();
    o.matrix.decompose(p0, q0, s0);
    const v0 = new THREE.Vector3();
    if (entity.velocity) v0.copy(entity.velocity);
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q0);

    const rng = this.ctx.rng.fork((entity.id || 1) * 104729);
    const n = L < 200 ? 2 : L < 500 ? 3 : 4;
    const span = info.zMax - info.zMin;
    const cuts = [info.zMin];
    for (let i = 1; i < n; i++) cuts.push(info.zMin + span * (i / n + rng.range(-0.07, 0.07)));
    cuts.push(info.zMax);

    const life = WreckFX.lifeFor(L);
    const popFor = 5 + 11 * Math.sqrt(L / 620);
    const damage0 = Math.min(0.95, Math.max(0.6, 1 - (entity.hull || 0) / (entity.maxHull || 1)));
    const zMid = (info.zMin + info.zMax) * 0.5;
    const scale = (s0.x + s0.y + s0.z) / 3;

    for (let i = 0; i < n; i++) {
      while (this._sections.length >= MAX_SECTIONS) this._retire(0);
      let slot = -1;
      try { slot = batch.reserve(); } catch (e) { slot = -1; }
      if (!(slot >= 0)) return;
      const lo = cuts[i];
      const hi = cuts[i + 1];
      const zc = (lo + hi) * 0.5;
      const local = new THREE.Vector3(0, 0, zc);
      const centre = local.clone().multiply(s0).applyQuaternion(q0).add(p0);
      /* Drift: away from the break along the keel, slowly - a twentieth of a
         hull length a second at most - plus a little lateral scatter. */
      const away = (zc - zMid) / Math.max(1e-3, span);
      const jit = rng.unitVector(); // plain {x, y, z}
      const jk = L * rng.range(0.002, 0.008);
      const vel = v0.clone()
        .addScaledVector(axis, L * (0.006 + 0.03 * Math.abs(away)) * Math.sign(away || 1))
        .add(new THREE.Vector3(jit.x * jk, jit.y * jk, jit.z * jk));
      const spin = rng.unitVector();
      const rate = rng.range(0.012, 0.05) * Math.sqrt(380 / Math.max(L, 100)) * (rng.next() < 0.5 ? -1 : 1);
      const sec = {
        batch, slot, classId: entity.classId, L,
        lo, hi, zc, local,
        len: (hi - lo) * scale,
        pos: centre, vel, q: q0.clone(), s: s0.clone(),
        spin: new THREE.Vector3(spin.x, spin.y, spin.z), rate,
        age: 0, life: life * rng.range(0.94, 1.0), popFor,
        nextPop: rng.range(0.15, 0.9),
        damage: damage0, shownDamage: -1, rng,
      };
      batch.setWreckSection(slot, lo, hi);
      this._place(sec);
      this._sections.push(sec);
    }
  }

  _place(sec) {
    // Rotate about the section's own centre, not the dead ship's origin.
    _o.copy(sec.local).multiply(sec.s).applyQuaternion(sec.q);
    _p.copy(sec.pos).sub(_o);
    _m.compose(_p, sec.q, sec.s);
    sec.batch.setMatrix(sec.slot, _m);
  }

  _retire(i) {
    const sec = this._sections[i];
    try { sec.batch.release(sec.slot); } catch (e) { /* batch gone */ }
    this._sections.splice(i, 1);
  }

  update(dt) {
    if (!this._sections.length) return;
    const ctx = this.ctx;
    const cam = ctx.camPos;
    for (let i = this._sections.length - 1; i >= 0; i--) {
      const sec = this._sections[i];
      sec.age += dt;
      if (sec.age >= sec.life) { this._retire(i); continue; }
      sec.pos.addScaledVector(sec.vel, dt);
      _dq.setFromAxisAngle(sec.spin, sec.rate * dt);
      sec.q.premultiply(_dq);
      this._place(sec);

      const d = cam.distanceTo(sec.pos);
      const want = pickLod(sec.classId, d, sec.batch.slotLevel[sec.slot]);
      sec.batch.setLod(sec.slot, Math.min(want, wreckInfo(sec.classId).maxLod));

      /* Char toward black over the first seconds: the fire goes out of the
         plating and what is left is the damage shading at full. */
      const dmg = Math.min(1, sec.damage + (1 - sec.damage) * (sec.age / 2.5));
      if (dmg - sec.shownDamage > 0.02 || (dmg >= 1 && sec.shownDamage < 1)) {
        sec.shownDamage = dmg;
        sec.batch.setDamage(sec.slot, dmg);
      }

      // Burn away from both open ends over the last seconds.
      const left = sec.life - sec.age;
      if (left < BURN_OUT) {
        const k = Math.max(0, left / BURN_OUT);
        const h = (sec.hi - sec.lo) * 0.5 * k;
        sec.batch.setWreckSection(sec.slot, sec.zc - Math.max(h, 1e-3), sec.zc + Math.max(h, 1e-3));
        if (sec.rng.next() < dt * 3) this._pop(sec, d, 0.5);
      } else if (sec.age < sec.popFor && sec.age >= sec.nextPop) {
        // Secondaries thin out as the section dies.
        const u = sec.age / sec.popFor;
        sec.nextPop = sec.age + sec.rng.range(0.35, 1.4) * (1 + 2.5 * u);
        this._pop(sec, d, 1 - 0.6 * u);
      }
    }
    for (const b of this._batches) b.commit();
  }

  /* One secondary somewhere along the section's own length. Small, short and
     capped at 1.2x the section's current screen size, so it reads as light
     escaping the wreck and never as a new explosion bigger than it. */
  _pop(sec, dist, weight) {
    const ctx = this.ctx;
    const f = ctx.fields;
    const rng = sec.rng;
    const z = rng.range(sec.lo, sec.hi);
    _p.set(rng.gaussian(0, sec.L * 0.025), rng.gaussian(0, sec.L * 0.025), z)
      .sub(sec.local).multiply(sec.s).applyQuaternion(sec.q).add(sec.pos);
    const mpp = ctx.px(dist);
    const drawn = Math.max(sec.len, mpp * hullFloorPx(sec.L) * (sec.len / sec.L));
    let size = ctx.atLeast(sec.L * 0.03 * rng.range(0.6, 1.4) * weight, dist, 5);
    size = Math.min(size, (1.2 * drawn) / 2.2);
    const V = sec.vel;
    f.flare.spawn(_p.x, _p.y, _p.z, V.x, V.y, V.z, 0.2, 0, size * 0.4, size * 1.2, CORE, 5.0 * weight, 0, 0);
    f.flare.spawn(_p.x, _p.y, _p.z, V.x, V.y, V.z, 0.5, 0, size * 0.5, size * 2.2, FIRE, 2.0 * weight, 0, 0);
    const n = Math.round(8 * ctx.qscale * weight);
    for (let i = 0; i < n; i++) {
      const u = rng.unitVector();
      const s = sec.L * rng.range(0.02, 0.08);
      f.spark.spawn(_p.x, _p.y, _p.z, V.x + u.x * s, V.y + u.y * s, V.z + u.z * s,
        rng.range(0.3, 0.9), 0.3, sec.L * 0.004, 0.2, CORE, 2.6, rng.range(3, 7), 0);
    }
    if (rng.next() < 0.6) {
      const u = rng.unitVector();
      const s = sec.L * 0.01;
      f.smoke.spawn(_p.x, _p.y, _p.z, V.x + u.x * s, V.y + u.y * s, V.z + u.z * s,
        rng.range(2.5, 4.0), 0.05, size * 0.6, size * 2.4, SOOT, 0.8, 0, rng.gaussian(0, 0.6));
    }
  }

  dispose() {
    while (this._sections.length) this._retire(this._sections.length - 1);
    this._batches.clear();
  }
}

export default WreckFX;
