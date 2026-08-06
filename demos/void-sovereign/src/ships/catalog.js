/* The fleet roster.

   One table, read by three subsystems: `ships/` builds geometry from it,
   `sim/` reads combat and economy numbers, `ui/` reads names, costs and
   silhouettes. Both teams field the same roster — they differ in hull
   palette and team colour, the way Kushan and Taiidan did. Balance lives
   here and nowhere else. */

export const TEAM = { PLAYER: 0, ENEMY: 1 };

export const ROLE = {
  FIGHTER: 'fighter',
  CORVETTE: 'corvette',
  FRIGATE: 'frigate',
  CAPITAL: 'capital',
  SUPPORT: 'support',
  RESOURCE: 'resource',
  STRUCTURE: 'structure',
};

/* Hull design families — drives the procedural geometry style.
   lancer   : small craft. Delta planform, canopy, twin engines, knife-edged.
   bulwark  : line warships. Slab armour, spine trench, turret decks, blocky.
   monolith : fleet-scale. Architectural, layered decks, hangar mouths, towers. */
export const FAMILY = { LANCER: 'lancer', BULWARK: 'bulwark', MONOLITH: 'monolith' };

export const WEAPON_TYPE = {
  KINETIC: 'kinetic',
  BEAM: 'beam',
  MISSILE: 'missile',
  FLAK: 'flak',
  ION: 'ion',
};

export const SHIPS = {
  /* ------------------------------------------------------------------ small craft */
  scout: {
    id: 'scout',
    name: 'Probe',
    short: 'PRB',
    role: ROLE.FIGHTER,
    family: FAMILY.LANCER,
    length: 12,
    hull: 90,
    armour: 0.0,
    shield: 0,
    speed: 620,
    accel: 420,
    turnRate: 2.6,
    rollRate: 3.4,
    cost: 35,
    buildTime: 6,
    popCost: 1,
    sensorRange: 9000,
    squadSize: 3,
    modelSeed: 1101,
    description: 'Long-range sensor picket. Fast, blind-spot free, barely armed.',
    counteredBy: 'Anything that can catch it. It is not meant to fight.',
    silhouette: 'M12 2 L20 17 L12 14 L4 17 Z',
    weapons: [
      {
        id: 'lightPulse', type: WEAPON_TYPE.KINETIC, damage: 4, rate: 4.5, range: 900,
        spread: 0.02, projectileSpeed: 2600, arcDeg: 30, hardpoints: 1,
        preferredTargets: [ROLE.FIGHTER],
      },
    ],
    buildableBy: ['carrier', 'mothership'],
  },

  interceptor: {
    id: 'interceptor',
    name: 'Interceptor',
    short: 'INT',
    role: ROLE.FIGHTER,
    family: FAMILY.LANCER,
    length: 14,
    hull: 160,
    armour: 0.05,
    shield: 0,
    speed: 540,
    accel: 360,
    turnRate: 2.3,
    rollRate: 3.0,
    cost: 60,
    buildTime: 9,
    popCost: 1,
    sensorRange: 4500,
    squadSize: 5,
    modelSeed: 2203,
    description: 'Squadron fighter. Owns the space between capitals.',
    counteredBy: 'Flak. Assault frigates and corvette autocannon shred them.',
    silhouette: 'M12 2 L15 9 L22 15 L18 16 L12 12 L6 16 L2 15 L9 9 Z',
    weapons: [
      {
        id: 'massDriver', type: WEAPON_TYPE.KINETIC, damage: 9, rate: 6.0, range: 1100,
        spread: 0.016, projectileSpeed: 3000, arcDeg: 24, hardpoints: 2,
        preferredTargets: [ROLE.FIGHTER, ROLE.CORVETTE, ROLE.RESOURCE],
      },
    ],
    buildableBy: ['carrier', 'mothership'],
  },

  bomber: {
    id: 'bomber',
    name: 'Lance Bomber',
    short: 'BMB',
    role: ROLE.FIGHTER,
    family: FAMILY.LANCER,
    length: 20,
    hull: 340,
    armour: 0.18,
    shield: 0,
    speed: 430,
    accel: 250,
    turnRate: 1.5,
    rollRate: 1.9,
    cost: 120,
    buildTime: 15,
    popCost: 1,
    sensorRange: 4000,
    squadSize: 4,
    modelSeed: 3307,
    description: 'Torpedo bomber. Releases at stand-off range and turns away; the only strike craft that threatens a capital. Helpless against fighters.',
    counteredBy: 'Fighters, and any flak escort. Never send them unscreened.',
    silhouette: 'M12 3 L16 8 L21 10 L21 14 L14 13 L12 20 L10 13 L3 14 L3 10 L8 8 Z',
    weapons: [
      {
        id: 'plasmaLance', type: WEAPON_TYPE.MISSILE, damage: 96, rate: 0.8, range: 1900,
        spread: 0.01, projectileSpeed: 900, arcDeg: 14, hardpoints: 2,
        /* Stand-off ordnance. `releaseAt` is the fraction of reach at which the
           run breaks off: a torpedo bomber launches and turns, it does not fly
           down a capital's throat. See `attackRun` in sim/combat.js.

           0.65 is chosen against the flak envelope, not for comfort. It puts
           the release point inside every capital's flak reach but only for the
           run-in and the turn — so a lone capital still hurts a wing badly,
           and a capital with a screening frigate beside it still kills one. */
        releaseAt: 0.65,
        preferredTargets: [ROLE.FRIGATE, ROLE.CAPITAL, ROLE.STRUCTURE],
      },
    ],
    buildableBy: ['carrier', 'mothership'],
  },

  /* -------------------------------------------------------------------- corvettes */
  corvette: {
    id: 'corvette',
    name: 'Assault Corvette',
    short: 'ACV',
    role: ROLE.CORVETTE,
    family: FAMILY.LANCER,
    length: 34,
    hull: 720,
    armour: 0.22,
    shield: 0,
    speed: 330,
    accel: 170,
    turnRate: 1.15,
    rollRate: 1.4,
    cost: 175,
    buildTime: 20,
    popCost: 2,
    sensorRange: 5200,
    squadSize: 3,
    modelSeed: 4409,
    description: 'Gunship. Heavy autocannon, enough armour to sit in the fire.',
    counteredBy: 'Frigate batteries and anything with a heavy gun. It closes, so it eats them.',
    silhouette: 'M12 2 L15 6 L15 13 L19 16 L19 20 L5 20 L5 16 L9 13 L9 6 Z',
    weapons: [
      {
        id: 'twinAuto', type: WEAPON_TYPE.KINETIC, damage: 16, rate: 4.2, range: 1600,
        spread: 0.02, projectileSpeed: 2400, arcDeg: 45, hardpoints: 2,
        releaseAt: 0.45,
        preferredTargets: [ROLE.FIGHTER, ROLE.CORVETTE, ROLE.RESOURCE],
      },
    ],
    buildableBy: ['carrier', 'mothership'],
  },

  missileCorvette: {
    id: 'missileCorvette',
    name: 'Missile Corvette',
    short: 'MCV',
    role: ROLE.CORVETTE,
    family: FAMILY.LANCER,
    length: 32,
    hull: 620,
    armour: 0.18,
    shield: 0,
    speed: 300,
    accel: 150,
    turnRate: 1.0,
    rollRate: 1.2,
    cost: 210,
    buildTime: 24,
    popCost: 2,
    sensorRange: 6000,
    squadSize: 3,
    modelSeed: 5511,
    description: 'Stand-off salvo launcher. Outranges everything its own size and never closes; helpless once fighters are on top of it.',
    counteredBy: 'Interceptors. Anything fast enough to get inside 2.4 km beats it.',
    silhouette: 'M12 2 L14 7 L20 9 L20 19 L16 17 L12 21 L8 17 L4 19 L4 9 L10 7 Z',
    weapons: [
      {
        id: 'swarmPods', type: WEAPON_TYPE.MISSILE, damage: 15, rate: 1.7, range: 2400,
        spread: 0.06, projectileSpeed: 1100, arcDeg: 70, hardpoints: 4,
        releaseAt: 0.85,
        preferredTargets: [ROLE.CORVETTE, ROLE.FRIGATE, ROLE.CAPITAL],
      },
    ],
    buildableBy: ['carrier', 'mothership'],
  },

  /* --------------------------------------------------------------------- frigates */
  assaultFrigate: {
    id: 'assaultFrigate',
    name: 'Assault Frigate',
    short: 'AFG',
    role: ROLE.FRIGATE,
    family: FAMILY.BULWARK,
    length: 130,
    hull: 4200,
    armour: 0.38,
    shield: 400,
    speed: 175,
    accel: 60,
    turnRate: 0.42,
    rollRate: 0.34,
    cost: 550,
    buildTime: 45,
    popCost: 4,
    sensorRange: 6500,
    squadSize: 1,
    modelSeed: 6613,
    description: 'The line of battle, and the fleet\'s flak umbrella. A capital without one of these beside it is a target.',
    counteredBy: 'Ion frigates and capitals. It cannot out-range them.',
    silhouette: 'M12 2 L16 5 L17 12 L20 15 L20 21 L4 21 L4 15 L7 12 L8 5 Z',
    weapons: [
      {
        id: 'mainBattery', type: WEAPON_TYPE.KINETIC, damage: 38, rate: 1.6, range: 3000,
        spread: 0.012, projectileSpeed: 2200, arcDeg: 150, hardpoints: 3,
        preferredTargets: [ROLE.FRIGATE, ROLE.CORVETTE, ROLE.CAPITAL],
      },
      /* The escort's screen is deliberately denser per credit than anything a
         capital carries for itself. Screening is a job you bring a ship for. */
      {
        id: 'flakScreen', type: WEAPON_TYPE.FLAK, damage: 11, rate: 3.6, range: 1900,
        spread: 0.09, projectileSpeed: 1900, arcDeg: 200, hardpoints: 3,
        burstRadius: 135,
        preferredTargets: [ROLE.FIGHTER],
      },
    ],
    buildableBy: ['mothership'],
  },

  ionFrigate: {
    id: 'ionFrigate',
    name: 'Ion Beam Frigate',
    short: 'IFG',
    role: ROLE.FRIGATE,
    family: FAMILY.BULWARK,
    length: 140,
    hull: 3400,
    armour: 0.30,
    shield: 300,
    speed: 165,
    accel: 55,
    turnRate: 0.30,
    rollRate: 0.26,
    cost: 680,
    buildTime: 52,
    popCost: 4,
    sensorRange: 7200,
    squadSize: 1,
    modelSeed: 7717,
    description: 'A gun with a ship built behind it. Cuts capitals in half; cannot track fighters.',
    counteredBy: 'Fighters. Its lance cannot track them and it has nothing else.',
    silhouette: 'M12 1 L13 10 L16 13 L16 22 L8 22 L8 13 L11 10 Z',
    weapons: [
      /* The roster needs two answers to a capital or it has one, and a bomber
         wing was becoming the only one. At 220 damage this gun delivered 0.14
         raw dps per credit against a capital against the bomber's 1.66 — an
         order of magnitude adrift of the ship whose entire description is
         "cuts capitals in half". */
      {
        id: 'ionLance', type: WEAPON_TYPE.ION, damage: 300, rate: 0.32, range: 4800,
        spread: 0.0, projectileSpeed: 0, arcDeg: 18, hardpoints: 1, beamDuration: 1.6,
        /* Fights from the edge of its reach. 4,200 m against a destroyer's
           4,000 was not a range advantage, it was a rounding error. */
        releaseAt: 0.9,
        preferredTargets: [ROLE.CAPITAL, ROLE.FRIGATE, ROLE.STRUCTURE],
      },
    ],
    buildableBy: ['mothership'],
  },

  supportFrigate: {
    id: 'supportFrigate',
    name: 'Support Frigate',
    short: 'SFG',
    role: ROLE.SUPPORT,
    family: FAMILY.BULWARK,
    length: 115,
    hull: 3000,
    armour: 0.26,
    shield: 600,
    speed: 190,
    accel: 62,
    turnRate: 0.46,
    rollRate: 0.38,
    cost: 480,
    buildTime: 40,
    popCost: 3,
    sensorRange: 8000,
    squadSize: 1,
    repairRate: 90,
    repairRange: 1800,
    description: 'Keeps a fleet alive between engagements. Repair beams, no offence.',
    counteredBy: 'Everything. Escort it or lose it, and losing it costs the fleet.',
    silhouette: 'M12 3 L18 6 L18 13 L21 16 L21 20 L3 20 L3 16 L6 13 L6 6 Z',
    weapons: [
      {
        id: 'pointDefence', type: WEAPON_TYPE.FLAK, damage: 7, rate: 4.0, range: 1100,
        spread: 0.1, projectileSpeed: 1900, arcDeg: 260, hardpoints: 2,
        burstRadius: 110,
        preferredTargets: [ROLE.FIGHTER],
      },
    ],
    buildableBy: ['mothership'],
  },

  /* --------------------------------------------------------------------- capitals */
  destroyer: {
    id: 'destroyer',
    name: 'Destroyer',
    short: 'DST',
    role: ROLE.CAPITAL,
    family: FAMILY.BULWARK,
    length: 380,
    hull: 16000,
    armour: 0.52,
    shield: 2200,
    speed: 120,
    accel: 26,
    turnRate: 0.17,
    rollRate: 0.14,
    cost: 1650,
    buildTime: 110,
    popCost: 9,
    sensorRange: 8500,
    squadSize: 1,
    modelSeed: 8819,
    description: 'Fleet spine. Trades broadsides with anything short of a cruiser.',
    counteredBy: 'Ion frigates and massed bombers. Its own flak will not save it alone.',
    silhouette: 'M12 1 L15 4 L16 11 L19 14 L20 22 L4 22 L5 14 L8 11 L9 4 Z',
    weapons: [
      {
        id: 'heavyBattery', type: WEAPON_TYPE.KINETIC, damage: 95, rate: 0.9, range: 4000,
        spread: 0.008, projectileSpeed: 2000, arcDeg: 170, hardpoints: 4,
        releaseAt: 0.8,
        preferredTargets: [ROLE.CAPITAL, ROLE.FRIGATE, ROLE.STRUCTURE],
      },
      {
        id: 'flakCurtain', type: WEAPON_TYPE.FLAK, damage: 12, rate: 3.6, range: 1600,
        spread: 0.1, projectileSpeed: 1900, arcDeg: 300, hardpoints: 4,
        burstRadius: 150,
        preferredTargets: [ROLE.FIGHTER, ROLE.CORVETTE],
      },
    ],
    buildableBy: ['mothership'],
  },

  cruiser: {
    id: 'cruiser',
    name: 'Heavy Cruiser',
    short: 'HCR',
    role: ROLE.CAPITAL,
    family: FAMILY.MONOLITH,
    length: 620,
    hull: 42000,
    armour: 0.62,
    shield: 6000,
    speed: 95,
    accel: 16,
    turnRate: 0.10,
    rollRate: 0.08,
    cost: 3800,
    buildTime: 210,
    popCost: 18,
    sensorRange: 9500,
    squadSize: 1,
    modelSeed: 9923,
    description: 'The end of most arguments. Twin ion spinal mounts, wall of flak.',
    counteredBy: 'A committed bomber wing, or another cruiser. Nothing cheap.',
    silhouette: 'M12 1 L16 3 L17 9 L20 12 L21 23 L3 23 L4 12 L7 9 L8 3 Z',
    weapons: [
      {
        id: 'spinalIon', type: WEAPON_TYPE.ION, damage: 340, rate: 0.22, range: 4800,
        spread: 0, projectileSpeed: 0, arcDeg: 40, hardpoints: 2, beamDuration: 2.0,
        releaseAt: 0.88,
        preferredTargets: [ROLE.CAPITAL, ROLE.STRUCTURE, ROLE.FRIGATE],
      },
      {
        id: 'siegeBattery', type: WEAPON_TYPE.KINETIC, damage: 120, rate: 0.8, range: 4400,
        spread: 0.007, projectileSpeed: 2000, arcDeg: 200, hardpoints: 4,
        preferredTargets: [ROLE.CAPITAL, ROLE.FRIGATE],
      },
      {
        id: 'flakWall', type: WEAPON_TYPE.FLAK, damage: 13, rate: 4.0, range: 1800,
        spread: 0.11, projectileSpeed: 1900, arcDeg: 330, hardpoints: 4,
        burstRadius: 175,
        preferredTargets: [ROLE.FIGHTER, ROLE.CORVETTE],
      },
    ],
    buildableBy: ['mothership'],
  },

  /* -------------------------------------------------------- economy & fleet bases */
  collector: {
    id: 'collector',
    name: 'Resource Collector',
    short: 'RC',
    role: ROLE.RESOURCE,
    family: FAMILY.BULWARK,
    length: 46,
    hull: 900,
    armour: 0.2,
    shield: 0,
    speed: 240,
    accel: 90,
    turnRate: 0.8,
    rollRate: 0.6,
    cost: 150,
    buildTime: 18,
    popCost: 1,
    sensorRange: 4000,
    squadSize: 1,
    modelSeed: 3141,
    harvestRate: 32,
    capacity: 320,
    description: 'Cuts ore from asteroids and hauls it home. Defend it or lose the game.',
    counteredBy: 'Any warship at all. This is what raids are for.',
    silhouette: 'M6 4 H18 V10 L21 13 V19 H3 V13 L6 10 Z',
    weapons: [],
    buildableBy: ['carrier', 'mothership'],
  },

  carrier: {
    id: 'carrier',
    name: 'Carrier',
    short: 'CAR',
    role: ROLE.STRUCTURE,
    family: FAMILY.MONOLITH,
    length: 760,
    hull: 28000,
    armour: 0.48,
    shield: 3500,
    speed: 80,
    accel: 12,
    turnRate: 0.09,
    rollRate: 0.06,
    cost: 2600,
    buildTime: 165,
    popCost: 0,
    popProvided: 22,
    sensorRange: 11000,
    squadSize: 1,
    modelSeed: 2718,
    producer: true,
    description: 'Forward production. Extends your reach across the field.',
    counteredBy: 'Bombers and ion frigates. Kill the yards and the fleet stops.',
    silhouette: 'M3 6 H21 V11 H18 V18 H6 V11 H3 Z',
    weapons: [
      {
        id: 'defenceGrid', type: WEAPON_TYPE.FLAK, damage: 13, rate: 3.4, range: 1900,
        spread: 0.1, projectileSpeed: 1900, arcDeg: 340, hardpoints: 6,
        burstRadius: 170,
        preferredTargets: [ROLE.FIGHTER, ROLE.CORVETTE],
      },
    ],
    buildableBy: ['mothership'],
  },

  mothership: {
    id: 'mothership',
    name: 'Mothership',
    short: 'MS',
    role: ROLE.STRUCTURE,
    family: FAMILY.MONOLITH,
    length: 1900,
    hull: 150000,
    armour: 0.66,
    shield: 20000,
    speed: 42,
    accel: 5,
    turnRate: 0.04,
    rollRate: 0.02,
    cost: 0,
    buildTime: 0,
    popCost: 0,
    popProvided: 55,
    sensorRange: 15000,
    squadSize: 1,
    modelSeed: 1618,
    producer: true,
    isBase: true,
    description: 'Everything you have. Lose it and the fleet has nowhere to go.',
    counteredBy: 'A fleet. Nothing less has ever cracked one.',
    silhouette: 'M12 1 L17 4 V9 H21 V15 H17 V22 H7 V15 H3 V9 H7 V4 Z',
    weapons: [
      {
        id: 'bastionBattery', type: WEAPON_TYPE.KINETIC, damage: 150, rate: 0.7, range: 5200,
        spread: 0.006, projectileSpeed: 2100, arcDeg: 360, hardpoints: 6,
        preferredTargets: [ROLE.CAPITAL, ROLE.FRIGATE],
      },
      /* A mothership screens itself, but badly for its size: ten batteries that
         delete a strike wing in two seconds mean the anti-capital half of the
         affinity table never happens, and the game loses a whole verb. The
         bastion punishes anything that lingers; it is not a wing-eraser. */
      {
        id: 'bastionFlak', type: WEAPON_TYPE.FLAK, damage: 15, rate: 4.0, range: 2200,
        spread: 0.11, projectileSpeed: 1900, arcDeg: 360, hardpoints: 8,
        burstRadius: 210,
        preferredTargets: [ROLE.FIGHTER, ROLE.CORVETTE],
      },
    ],
    buildableBy: [],
  },
};

/* --------------------------------------------------------------------- helpers */

export const CLASS_IDS = Object.keys(SHIPS);

/** Build-menu contents for a producer. Ordered cheapest first. */
export function shipsBuildableBy(classId) {
  return CLASS_IDS
    .map((id) => SHIPS[id])
    .filter((s) => s.buildableBy.includes(classId))
    .sort((a, b) => a.cost - b.cost);
}

export function totalFleetValue(entities) {
  let sum = 0;
  for (const e of entities) sum += SHIPS[e.classId] ? SHIPS[e.classId].cost : 0;
  return sum;
}

/** Damage multiplier for weapon-vs-role matchups. Rock/paper/scissors lives here. */
const AFFINITY = {
  kinetic: { fighter: 0.55, corvette: 0.9, frigate: 1.0, capital: 1.0, support: 1.0, resource: 1.1, structure: 0.95 },
  flak: { fighter: 1.6, corvette: 1.1, frigate: 0.35, capital: 0.18, support: 0.35, resource: 0.5, structure: 0.15 },
  missile: { fighter: 0.7, corvette: 1.0, frigate: 1.25, capital: 1.3, support: 1.25, resource: 1.2, structure: 1.35 },
  ion: { fighter: 0.12, corvette: 0.4, frigate: 1.35, capital: 1.5, support: 1.35, resource: 0.8, structure: 1.6 },
  beam: { fighter: 0.3, corvette: 0.7, frigate: 1.2, capital: 1.25, support: 1.2, resource: 1.0, structure: 1.3 },
};

export function damageAffinity(weaponType, targetRole) {
  const row = AFFINITY[weaponType];
  if (!row) return 1;
  const v = row[targetRole];
  return v === undefined ? 1 : v;
}

/** The whole affinity table, for a UI that wants to show the matchup grid. */
export function affinityTable() {
  return AFFINITY;
}

/* ------------------------------------------------------------------ veterancy

   A hull that survives its fights gets better at them. This is the cheapest
   available answer to "a fight lost is a fleet lost": once a wing has history,
   withdrawing it is worth something, and the fleet a player is flying at minute
   25 is not the fleet they were flying at minute 5.

   Kept deliberately small. Veterancy is a reason to preserve ships, not a
   reason the first fight decides the match. */
export const VETERANCY = [
  { at: 0, name: '', damage: 1.00, hull: 1.00 },
  { at: 2, name: 'Blooded', damage: 1.08, hull: 1.06 },
  { at: 6, name: 'Veteran', damage: 1.16, hull: 1.12 },
  { at: 14, name: 'Elite', damage: 1.25, hull: 1.20 },
];

/** Veterancy tier index for a lifetime kill-value score. */
export function veterancyTier(score) {
  let t = 0;
  for (let i = VETERANCY.length - 1; i > 0; i--) {
    if (score >= VETERANCY[i].at) {
      t = i;
      break;
    }
  }
  return t;
}

/** Rough visual bounding radius, used before a model exists. */
export function approxRadius(classId) {
  const s = SHIPS[classId];
  return s ? s.length * 0.55 : 10;
}
