/* DAMAGE STAGES - a hurt capital has to look hurt, and worse as it gets worse.

   R11 fix 3. Since round 6 the hull carries hit-local scorch (the hull
   material reads the last eight hits per instance from the shared hit
   texture), but scorch alone grows smoothly and a stranger could not tell
   50% from 20% (critic rounds 6-10, R3 "health at a glance"). This adds
   stages on top, driven only by the hull fraction and the hit records that
   already exist:

     above ~70%   scorch only (the material, unchanged);
     ~50%         1-2 small fires at the oldest hit zones with thin smoke,
                  running lights flickering and some out (lights: here and
                  in engines.js; hull lamps: the material);
     ~20%         2-4 bigger fires, breaches (dark holes with glowing rims,
                  drawn by the material at hit zones 0-2) that vent short
                  bright gas jets, a heavy smoke trail, sparks and arcs,
                  most lights out and a sputtering engine (engines.js).

   Every element stays under 0.3 of the hull (round 7 hullBudget). Cost is
   bounded three ways: only frigate-size hulls and up burn; at most
   MAX_FULL of them, by priority (R12), draw full effects; the rest, and anything
   past FULL_RANGE hull lengths, get the far version - one or two embers and
   the smoke - and past MAX_BURNING nothing at all. Flames, vents and sparks
   ride the shared flare, spark and ember fields; the smoke has its own
   field (one draw call) because the shared one is tuned thin for explosions
   and vanished at fleet range.

   Render-side only: it reads entity hull, transform and the hit texture,
   uses its own RNG fork, and never writes back, so the sim stays
   deterministic. */
import * as THREE from '../../vendor/three/build/three.module.js';
import { readHit } from '../render/materials.js';

/* Frigates and up: the classes that leave a wreck (wrecks.js). */
const MIN_LENGTH = 100;
/* Above this hull fraction nothing here runs; scorch only. */
const STAGE1_HF = 0.66;
/* At or below this hull fraction the ship is in the critical stage. */
const STAGE2_HF = 0.34;
/* Burning hulls that draw the full set: the ones nearest the camera focus,
   hulls under PRIORITY_HF first (R12 fix 1). */
const MAX_FULL = 6;
const PRIORITY_HF = 0.5;
const byKey = (a, b) => a.key - b.key;
/* Burning hulls drawn at all; the rest are skipped, farthest first. */
const MAX_BURNING = 32;
/* Beyond this many hull lengths a burning ship gets the far version. */
const FULL_RANGE = 9;
/* Hit texture sentinel (materials.js HIT_EMPTY is 1e5). */
const EMPTY = 1e4;

const FIRE = new THREE.Color(0xff8a34);
const FIRE_HOT = new THREE.Color(0xffd9a0);
const EMBER = new THREE.Color(0xff5a18);
const SMOKE = new THREE.Color(0x8a8178);
const SMOKE_DARK = new THREE.Color(0x58514b);
const VENT = new THREE.Color(0xd8e8ff);
const ARC = new THREE.Color(0xa9c8ff);
const SPARK = new THREE.Color(0xffe2b0);

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class DamageFX {
  constructor(ctx, entities) {
    this.ctx = ctx;
    this.entities = entities;
    this.rng = ctx.rng.fork(0xda3a9e);
    this._state = new Map();
    this._list = [];
    this._sites = [];
    for (let i = 0; i < 4; i++) this._sites.push({ p: new THREE.Vector3(), n: new THREE.Vector3(), ok: false });
    this._h = [0, 0, 0, 0];
    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
    this._box = new THREE.Box3();
    this.burning = 0;
    this.full = 0;
    this.drawCalls = 1;
  }

  _stateFor(e) {
    let s = this._state.get(e.id);
    if (!s) {
      s = { seed: this.rng.next(), fire: 0, smoke: 0, vent: 0, ember: 0, nextArc: 0, seen: 0, stage: 0 };
      this._state.set(e.id, s);
    }
    return s;
  }

  /* The burning sites in world space: the first `n` recorded hit zones of
     the hull (zones 0-2 are also where the material cuts its breaches), each
     with an outward normal off the keel. A hull with no row, or fewer hits,
     falls back to fixed stations along its own length. */
  _readSites(e, n) {
    const o = e.object3D;
    const sites = this._sites;
    const rec = e._batchRec;
    const b = rec && rec.batch;
    const row = b && b.hitBase > 0 && e._slot >= 0 ? b.hitBase + e._slot : 0;
    let box = null;
    if (b && typeof b.hullBox === 'function') {
      try { box = b.hullBox(); } catch (err) { box = null; }
    }
    const L = e.def.length;
    const cx = box ? (box.min.x + box.max.x) * 0.5 : 0;
    const cy = box ? (box.min.y + box.max.y) * 0.5 : 0;
    const zMin = box ? box.min.z : -L * 0.5;
    const zMax = box ? box.max.z : L * 0.5;
    const h = this._h;
    let got = 0;
    for (let k = 0; k < n; k++) {
      const s = sites[k];
      s.ok = false;
      if (row) readHit(row, k, h);
      if (!row || !(Math.abs(h[0]) < EMPTY)) {
        // Fallback station: aft half first, alternating sides.
        const t = 0.18 + 0.2 * k;
        h[0] = cx + (k % 2 ? -1 : 1) * (box ? (box.max.x - box.min.x) * 0.32 : L * 0.05);
        h[1] = cy + (box ? (box.max.y - box.min.y) * 0.12 : 0);
        h[2] = zMin + (zMax - zMin) * t;
      }
      s.n.set(h[0] - cx, h[1] - cy, 0);
      if (s.n.lengthSq() < 1e-6) s.n.set(0, 1, 0);
      s.n.normalize();
      s.p.set(h[0], h[1], h[2]);
      if (o) {
        s.p.applyMatrix4(o.matrix);
        s.n.applyQuaternion(o.quaternion);
      }
      // Off the skin a little so the flame is not half inside the plating.
      s.p.addScaledVector(s.n, L * 0.012);
      s.ok = true;
      got++;
    }
    return got;
  }

  update(dt, camera) {
    const ctx = this.ctx;
    const cam = camera.position;
    const list = this._list;
    list.length = 0;
    const now = ctx.now;
    /* R12 fix 1: priority, not proximity. Round 11 gave the full set to the
       nearest six burning hulls, which in a played fight were whichever
       half-scratched frigates sat by the lens - and no played frame showed a
       ship in trouble. The key is now distance to the camera's focus point
       (where the player is looking), with hulls under half weighted to the
       front, and a hull still has to be inside FULL_RANGE of the lens to draw
       the full set. Same caps, same cost. */
    const rig = ctx.focusRig;
    const focus = (rig && rig.focusPoint) || cam;

    for (const e of this.entities.values()) {
      if (!e || e.alive === false || !e.def || !(e.maxHull > 0)) continue;
      if ((e.def.length || 0) < MIN_LENGTH) continue;
      const hf = e.hull / e.maxHull;
      if (!(hf < STAGE1_HF)) continue;
      const p = e.object3D ? e.object3D.position : e.position;
      if (!p) continue;
      const d = p.distanceTo(cam);
      const inRange = d < FULL_RANGE * e.def.length;
      const key = (inRange ? 0 : 1e9) + p.distanceTo(focus) * (hf < PRIORITY_HF ? 0.3 : 1);
      list.push({ e, hf, d, key });
    }
    list.sort(byKey);
    if (list.length > MAX_BURNING) list.length = MAX_BURNING;

    // Forget ships that have healed, died or left.
    for (const [id, s] of this._state) {
      if (now - s.seen > 2) this._state.delete(id);
    }

    const f = ctx.fields;
    const q = ctx.qscale || 1;
    const rng = this.rng;
    const v = this._v;
    const c = this._c;
    let full = 0;

    for (let i = 0; i < list.length; i++) {
      const { e, hf, d } = list[i];
      const s = this._stateFor(e);
      s.seen = now;
      const L = e.def.length;
      const crit = hf <= STAGE2_HF;
      const stage = crit ? 2 : 1;
      /* 0 at the top of stage 1 (66%), 1 by 52%; and the critical ramp. */
      const k1 = smooth(STAGE1_HF, 0.52, hf);
      const k2 = smooth(0.40, 0.24, hf);
      const isFull = full < MAX_FULL && d < FULL_RANGE * L;
      if (isFull) full++;
      const nFire = crit ? 4 : (hf < 0.58 ? 2 : 1);
      const got = this._readSites(e, nFire);
      if (!got) continue;
      const vel = e.velocity || v.set(0, 0, 0);
      const vx = vel.x || 0;
      const vy = vel.y || 0;
      const vz = vel.z || 0;
      /* Hard ceiling for any one element: 0.3 of the hull as drawn. */
      const cap = ctx.hullBudget(L, e.position.x, e.position.y, e.position.z, 0.3);

      if (isFull) {
        /* Fires. Flickering flame tongues: short-lived additive flares that
           ride the hull's own velocity, so they stay on the wound. */
        const fireSize = Math.min(cap * 0.5, L * (0.03 + 0.022 * k1));
        const fireRate = (16 + 14 * k2) * q;
        s.fire += fireRate * dt;
        while (s.fire >= 1) {
          s.fire -= 1;
          const si = this._sites[(rng.next() * got) | 0];
          // The two oldest zones burn hardest; later ones are smaller.
          const big = si === this._sites[0] || si === this._sites[1] ? 1 : 0.7;
          const u = rng.ballPoint(fireSize * 0.35);
          const sp = fireSize * rng.range(1.5, 3.5);
          const lift = fireSize * 0.5;
          c.copy(FIRE).lerp(FIRE_HOT, rng.next() * 0.5);
          f.flare.spawn(si.p.x + u.x + si.n.x * lift, si.p.y + u.y + si.n.y * lift, si.p.z + u.z + si.n.z * lift,
            vx + si.n.x * sp, vy + si.n.y * sp, vz + si.n.z * sp,
            rng.range(0.22, 0.42), 0.6, fireSize * rng.range(0.8, 1.25) * big, fireSize * 0.3 * big,
            c, rng.range(1.3, 2.2), 0, rng.gaussian(0, 2), 0);
        }
        /* Embers shed off the fires and drifting clear of the hull, so a fire
           on the far side still shows round the silhouette. */
        s.ember += (4 + 4 * k2) * q * dt;
        while (s.ember >= 1) {
          s.ember -= 1;
          const si = this._sites[(rng.next() * got) | 0];
          const g = rng.unitVector();
          const sp = L * rng.range(0.03, 0.08);
          c.copy(EMBER).lerp(FIRE, rng.next() * 0.7);
          f.ember.spawn(si.p.x, si.p.y, si.p.z,
            vx + (si.n.x + g.x * 0.6) * sp, vy + (si.n.y + g.y * 0.6) * sp, vz + (si.n.z + g.z * 0.6) * sp,
            rng.range(1.2, 2.2), 0.1, L * 0.01, L * 0.004, c, 2.4, 0, 0, 0);
        }
        /* Smoke off the fires: thin at stage 1, heavy when critical. It keeps
           only a fifth of the hull's velocity, so a ship under way leaves a
           trail and a parked one a drifting plume. */
        const smokeRate = (3 + 5 * k1 + 8 * k2) * q;
        const smokeSize = Math.min(cap, L * (0.15 + 0.1 * k2));
        /* Entering a stage blows out a puff, so the new state reads at once
           rather than after the smoke has had seconds to build. */
        if (stage > s.stage) s.smoke += stage === 2 ? 14 : 9;
        s.smoke += smokeRate * dt;
        while (s.smoke >= 1) {
          s.smoke -= 1;
          const si = this._sites[(rng.next() * got) | 0];
          const out = L * rng.range(0.03, 0.07);
          const g = rng.unitVector();
          c.copy(SMOKE).lerp(SMOKE_DARK, rng.next() * (0.3 + 0.5 * k2));
          f.dmgSmoke.spawn(si.p.x, si.p.y, si.p.z,
            vx * 0.2 + si.n.x * out + g.x * out * 0.4,
            vy * 0.2 + si.n.y * out + g.y * out * 0.4,
            vz * 0.2 + si.n.z * out + g.z * out * 0.4,
            rng.range(4.5, 7.5), 0.04, smokeSize * 0.3, smokeSize * rng.range(0.7, 1.0),
            c, rng.range(0.7, 0.95), 0, rng.gaussian(0, 0.35), 0);
        }

        if (crit) {
          /* Venting: breaches 0-2 blow short bright gas jets in pulses, each
             on its own phase. Under 0.2 of the hull long. */
          const nVent = Math.min(3, got);
          s.vent += 30 * q * dt;
          while (s.vent >= 1) {
            s.vent -= 1;
            const vi = (rng.next() * nVent) | 0;
            const ph = (now * 0.62 + s.seed * 3.1 + vi * 0.37) % 1;
            if (ph > 0.45) continue;
            const si = this._sites[vi];
            const u = rng.unitVector();
            const sp = L * rng.range(0.30, 0.50);
            const dx = si.n.x * 0.88 + u.x * 0.14;
            const dy = si.n.y * 0.88 + u.y * 0.14;
            const dz = si.n.z * 0.88 + u.z * 0.14;
            f.flare.spawn(si.p.x, si.p.y, si.p.z,
              vx + dx * sp, vy + dy * sp, vz + dz * sp,
              rng.range(0.22, 0.36), 1.2, L * 0.02, Math.min(cap * 0.4, L * 0.07),
              VENT, rng.range(1.4, 2.2), 0, 0, 0);
            if (rng.chance(0.6)) {
              f.spark.spawn(si.p.x, si.p.y, si.p.z,
                vx + dx * sp * 1.3, vy + dy * sp * 1.3, vz + dz * sp * 1.3,
                rng.range(0.2, 0.36), 0.8, L * 0.006, 0.2, VENT, 2.4, rng.range(4, 8), 0);
            }
          }
          /* Sparks and arcs: a shower and a blue-white flash at a random
             wound every half second or so. */
          if (now >= s.nextArc) {
            s.nextArc = now + rng.range(0.25, 0.8);
            const si = this._sites[(rng.next() * got) | 0];
            const j = rng.ballPoint(L * 0.04);
            v.set(si.p.x + j.x, si.p.y + j.y, si.p.z + j.z);
            f.flare.spawn(v.x, v.y, v.z, vx, vy, vz, rng.range(0.06, 0.12), 0,
              L * 0.05, L * 0.02, ARC, 3.2, 0, 0, 0);
            const nS = 6 + ((rng.next() * 6) | 0);
            for (let k = 0; k < nS; k++) {
              const g = rng.unitVector();
              const dot = g.x * si.n.x + g.y * si.n.y + g.z * si.n.z;
              const sg = dot < 0 ? -1 : 1;
              const sp = L * rng.range(0.08, 0.2);
              f.spark.spawn(v.x, v.y, v.z,
                vx + g.x * sg * sp, vy + g.y * sg * sp, vz + g.z * sg * sp,
                rng.range(0.3, 0.7), 0.5, L * 0.004, 0.2, k & 1 ? ARC : SPARK, 2.6, rng.range(3, 7), 0);
            }
          }
        }
      } else {
        /* Far version: an ember or two on the worst wounds and the smoke
           trail. The flare field's pixel floor keeps an ember readable as a
           point of fire at fleet range. */
        const nEmber = crit ? 2 : 1;
        s.ember += (crit ? 9 : 6) * q * dt;
        while (s.ember >= 1) {
          s.ember -= 1;
          const si = this._sites[(rng.next() * Math.min(nEmber, got)) | 0];
          c.copy(EMBER).lerp(FIRE, rng.next() * 0.6);
          f.flare.spawn(si.p.x, si.p.y, si.p.z, vx, vy, vz,
            rng.range(0.3, 0.5), 0, L * (crit ? 0.06 : 0.05), L * 0.025, c, rng.range(2.0, 2.8), 0, 0, 0);
        }
        /* R12 fix 1: at half hull this plume is what says "hurt" at 4 km, and
           round 11 drew it as a grey wisp a stranger missed. Denser, longer
           lived and kept light (lit smoke reads on the void), so a 50% hull
           trails a column at fleet range; still under 0.3 of the hull a puff. */
        const smokeSize = Math.min(cap, L * (0.27 + 0.03 * k2));
        if (stage > s.stage) s.smoke += stage === 2 ? 10 : 8;
        s.smoke += (3.6 + 3.4 * k1 + 3 * k2) * q * dt;
        while (s.smoke >= 1) {
          s.smoke -= 1;
          const si = this._sites[(rng.next() * Math.min(nEmber, got)) | 0];
          const out = L * rng.range(0.03, 0.05);
          c.copy(SMOKE).lerp(SMOKE_DARK, rng.next() * (crit ? 0.4 : 0.2));
          f.dmgSmoke.spawn(si.p.x, si.p.y, si.p.z,
            vx * 0.2 + si.n.x * out, vy * 0.2 + si.n.y * out, vz * 0.2 + si.n.z * out,
            rng.range(7.0, 10.5), 0.03, smokeSize * 0.3, smokeSize,
            c, rng.range(0.8, 1.0), 0, rng.gaussian(0, 0.3), 0);
        }
      }
      s.stage = stage;
    }
    this.burning = list.length;
    this.full = full;
  }

  dispose() {
    this._state.clear();
    this._list.length = 0;
  }
}
