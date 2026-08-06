import * as THREE from '../../vendor/three/build/three.module.js';
import { ROLE } from '../ships/catalog.js';

/* Formations.

   Offsets are generated in the group's local frame: +Z forward, +Y up, +X to
   the side, origin at the group anchor. `formationWorld` rotates that frame to
   the group's heading, so a wing that turns takes its shape with it.

   Spacing scales with the largest member so a wall of destroyers is not a wall
   of destroyers all inside one another, and shrinks for fighters so a wing
   still reads as a wing rather than a scatter. */

export const FORMATION = {
  DELTA: 'delta',
  WALL: 'wall',
  SPHERE: 'sphere',
  CLAW: 'claw',
  BROAD: 'broad',
  X: 'x',
};

export const FORMATION_IDS = [
  FORMATION.DELTA,
  FORMATION.WALL,
  FORMATION.SPHERE,
  FORMATION.CLAW,
  FORMATION.BROAD,
  FORMATION.X,
];

/* How tightly a class holds station. Fighters sit in the slot; capitals treat
   it as a suggestion, which stops a 1.9 km mothership shuffling forever. */
const TIGHTNESS = {
  [ROLE.FIGHTER]: 1.0,
  [ROLE.CORVETTE]: 0.9,
  [ROLE.FRIGATE]: 0.55,
  [ROLE.CAPITAL]: 0.35,
  [ROLE.SUPPORT]: 0.6,
  [ROLE.RESOURCE]: 0.7,
  [ROLE.STRUCTURE]: 0.25,
};

export function formationTightness(role) {
  const t = TIGHTNESS[role];
  return t === undefined ? 0.6 : t;
}

/* ------------------------------------------------------------------- effects

   Homeworld 1 gave formations real numbers and Homeworld 2 took them away;
   every retrospective names that as a loss. Six shapes that change where hulls
   sit but not what happens are six identical formations.

   Two rules govern these values:

     * They are small. A formation is a lean, not a win condition — the wrong
       shape should cost you an edge, never the engagement.
     * They are stated. `label` is the text the HUD shows, and it is the whole
       point: a bonus the player cannot read is indistinguishable from no bonus
       at all. Anything added here must be surfaced.

   `damage` scales outgoing fire, `incoming` scales damage taken, `speed`
   scales throttle. The geometry does its own work on top of these — a shape
   that spreads a wing genuinely eats fewer flak bursts — which is why the
   stated numbers can stay modest. */
const EFFECT = {
  [FORMATION.DELTA]: {
    damage: 1.0, incoming: 1.0, speed: 1.12,
    label: 'Delta · +12% closing speed',
  },
  [FORMATION.WALL]: {
    damage: 1.10, incoming: 0.96, speed: 0.94,
    label: 'Wall · +10% damage, −4% damage taken, slower',
  },
  [FORMATION.SPHERE]: {
    damage: 0.94, incoming: 0.86, speed: 0.96,
    label: 'Sphere · −14% damage taken, −6% damage',
  },
  [FORMATION.CLAW]: {
    damage: 1.14, incoming: 1.06, speed: 1.0,
    label: 'Claw · +14% damage, +6% damage taken',
  },
  [FORMATION.BROAD]: {
    damage: 1.06, incoming: 0.98, speed: 1.0,
    label: 'Broad · +6% damage, wide frontage',
  },
  [FORMATION.X]: {
    damage: 1.0, incoming: 0.94, speed: 1.06,
    label: 'X · −6% damage taken, +6% speed',
  },
};

const NEUTRAL_EFFECT = { damage: 1, incoming: 1, speed: 1, label: '' };

/** Stated combat modifiers for a formation. Never null. */
export function formationEffect(formation) {
  return EFFECT[formation] || NEUTRAL_EFFECT;
}

/** `{ id, label, damage, incoming, speed }` for every shape — for the HUD. */
export function formationEffects() {
  return FORMATION_IDS.map((id) => Object.assign({ id }, EFFECT[id] || NEUTRAL_EFFECT));
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Base spacing for a set of entities: big enough that nothing intersects. */
export function spacingFor(entities) {
  let maxR = 8;
  for (let i = 0; i < entities.length; i++) {
    const r = entities[i].radius || 8;
    if (r > maxR) maxR = r;
  }
  return maxR * 2.6 + 40;
}

/* Each generator writes into `out[i]` (a THREE.Vector3), local frame. */

function delta(n, s, out) {
  // Arrowhead. Rows fan back and outward, with a shallow vertical stagger so
  // the wing has depth instead of being a paper cut-out.
  let i = 0;
  let row = 0;
  while (i < n) {
    const inRow = row === 0 ? 1 : 2;
    for (let k = 0; k < inRow && i < n; k++, i++) {
      const side = k === 0 ? -1 : 1;
      const lateral = row === 0 ? 0 : side * row * s * 0.85;
      out[i].set(lateral, ((row % 3) - 1) * s * 0.22, -row * s * 0.72);
    }
    row++;
  }
}

function wall(n, s, out) {
  // A face-on slab: columns across X, rows up Y, one plane in Z.
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.7)));
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const rows = Math.ceil(n / cols);
    out[i].set(
      (c - (cols - 1) / 2) * s,
      (r - (rows - 1) / 2) * s * 0.8,
      -r * s * 0.12,
    );
  }
}

function sphere(n, s, out) {
  // Fibonacci shell — an even screen around whatever it is protecting.
  const radius = s * Math.max(1, Math.cbrt(n) * 0.95);
  if (n === 1) {
    out[0].set(0, 0, 0);
    return;
  }
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN * i;
    out[i].set(Math.cos(theta) * r * radius, y * radius * 0.8, Math.sin(theta) * r * radius);
  }
}

function claw(n, s, out) {
  // Two forward-swept pincer arms that curl inward ahead of the anchor.
  const per = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) {
    const arm = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const t = per <= 1 ? 0 : k / (per - 1);
    const sweep = t * Math.PI * 0.55;
    const reach = s * (1.0 + t * 2.6);
    out[i].set(
      arm * Math.sin(sweep + 0.35) * reach,
      Math.sin(t * Math.PI) * s * 0.55,
      Math.cos(sweep + 0.35) * reach - s * 0.6,
    );
  }
}

function broad(n, s, out) {
  // Line abreast. Overlong lines wrap into a second rank so a 40-ship broad
  // does not stretch for 20 km.
  const perRank = Math.max(1, Math.min(n, 12));
  for (let i = 0; i < n; i++) {
    const rank = Math.floor(i / perRank);
    const k = i % perRank;
    const wide = Math.min(perRank, n - rank * perRank);
    out[i].set((k - (wide - 1) / 2) * s, rank * s * 0.35, -rank * s * 1.1);
  }
}

function xshape(n, s, out) {
  // Four diagonal arms raked backwards — reads unmistakably from any angle.
  for (let i = 0; i < n; i++) {
    const arm = i % 4;
    const k = Math.floor(i / 4) + 1;
    const dx = arm === 0 || arm === 3 ? -1 : 1;
    const dy = arm < 2 ? 1 : -1;
    const reach = k * s * 0.95;
    out[i].set(dx * reach * 0.75, dy * reach * 0.6, -k * s * 0.3);
  }
}

const GENERATORS = {
  [FORMATION.DELTA]: delta,
  [FORMATION.WALL]: wall,
  [FORMATION.SPHERE]: sphere,
  [FORMATION.CLAW]: claw,
  [FORMATION.BROAD]: broad,
  [FORMATION.X]: xshape,
};

const _cache = [];
function scratch(n) {
  while (_cache.length < n) _cache.push(new THREE.Vector3());
  return _cache;
}

/**
 * Local-space slot offsets for `count` members.
 * Returns a shared scratch array — copy what you keep.
 */
export function formationOffsets(formation, count, spacing, out) {
  const gen = GENERATORS[formation] || GENERATORS[FORMATION.DELTA];
  const dst = out || scratch(count);
  while (dst.length < count) dst.push(new THREE.Vector3());
  gen(count, spacing, dst);
  return dst;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _alt = new THREE.Vector3(1, 0, 0);
const _f = new THREE.Vector3();
const _ZERO = new THREE.Vector3(0, 0, 0);

/** Rotate a local slot offset into world space for a group heading. */
export function formationWorld(anchor, heading, offset, out) {
  _f.copy(heading);
  if (_f.lengthSq() < 1e-6) _f.set(0, 0, 1);
  else _f.normalize();
  const up = Math.abs(_f.y) > 0.985 ? _alt : _up;
  _m.lookAt(_f, _ZERO, up);
  _q.setFromRotationMatrix(_m);
  out.copy(offset).applyQuaternion(_q).add(anchor);
  return out;
}

const ROLE_RANK = {
  [ROLE.STRUCTURE]: 0,
  [ROLE.CAPITAL]: 1,
  [ROLE.FRIGATE]: 2,
  [ROLE.SUPPORT]: 2,
  [ROLE.RESOURCE]: 3,
  [ROLE.CORVETTE]: 4,
  [ROLE.FIGHTER]: 5,
};

/**
 * Give every entity in `members` a slot index and record the shape on the
 * group. Sorted so heavy hulls take the core slots and fighters the flanks,
 * which keeps a mixed selection from putting a cruiser on the wingtip.
 */
export function assignFormation(members, formation) {
  const order = members.slice().sort((a, b) => {
    const ra = ROLE_RANK[a.role] || 3;
    const rb = ROLE_RANK[b.role] || 3;
    if (ra !== rb) return ra - rb;
    return a.id - b.id;
  });
  for (let i = 0; i < order.length; i++) {
    order[i].formationSlot = i;
    order[i].formation = formation;
    order[i].formationCount = order.length;
  }
  return order;
}
