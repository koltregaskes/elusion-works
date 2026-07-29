/* Per-class hull construction.

   Every ship is lofted from cross-sections along the +Z spine, then dressed
   with the vocabulary in greeble.js. Three families share one design language
   so the fleet reads as one navy:

     lancer   — knife-edged deltas, canopy glass, outboard nacelles, small.
     bulwark  — slab armour with tumblehome, a belt band wrapping the flanks,
                a spine trench, turret decks and a blunt drive block.
     monolith — architecture. Terraced decks, buttressed flanks, hangar mouths
                sunk into the hull, lit window rows, docking arms.

   Shared throughout: a chamfer on every structural edge, one bridge tower
   offset off the centreline, and greeble whose absolute size grows far more
   slowly than the hull does, so a mothership carries roughly fifteen times
   finer relative detail than a fighter. */

import * as THREE from '../../vendor/three/build/three.module.js';
import { SHIPS } from './catalog.js';
import { makeRng } from '../core/rng.js';
import {
  Builder, KIND, PLATE,
  loft, decimateStations, rectSection, trenchSection, ngonSection,
  chamferBox, tube, ring, blip, wing, wingSection,
  pocket, engineNozzle, turret, radiator, dish, mast, catwalk, windowRow,
  windowBand, windowBay, hangarBay, truss, armourPlates, commsArray,
  greebleField, ribBand, partMatrix, triCount, applyWear,
} from './greeble.js';

/* --------------------------------------------------------------- palette */

const NAV = {
  port: 0xff2b1c,
  starboard: 0x25ff6a,
  beacon: 0xe6f0ff,
  deck: 0xffb347,
  hangar: 0x9fd8ff,
};

/* ------------------------------------------------------------- ctx helpers */

function hp(ctx, x, y, z) {
  ctx.hardpoints.push(new THREE.Vector3(x, y, z));
}

function light(ctx, x, y, z, hex, period, size) {
  ctx.lights.push({
    pos: new THREE.Vector3(x, y, z),
    colour: new THREE.Color(hex),
    period,
  });
  // The lamp housing is deliberately smaller than the light FX will be — the
  // glow comes from the bloom pass, not from a fat emissive gem.
  if (ctx.b.detail < 2) {
    ctx.b.add(blip(size * 0.5), { kind: KIND.GLOW, x, y, z, variant: PLATE.MECH });
  }
}

/** Half-width of a hull plan at a given z, for keeping greeble on the hull. */
function planWidth(plan, k = 0.46) {
  const sorted = plan.slice().sort((a, b) => a.z - b.z);
  return (z) => {
    if (z <= sorted[0].z) return sorted[0].w * k;
    for (let i = 1; i < sorted.length; i++) {
      if (z <= sorted[i].z) {
        const t = (z - sorted[i - 1].z) / Math.max(1e-6, sorted[i].z - sorted[i - 1].z);
        return (sorted[i - 1].w + (sorted[i].w - sorted[i - 1].w) * t) * k;
      }
    }
    return sorted[sorted.length - 1].w * k;
  };
}

/** Nav-light pair on the flanks plus a dorsal beacon — fleet-wide convention. */
function navSet(ctx, x, y, z, size, period) {
  light(ctx, -x, y, z, NAV.port, period, size);
  light(ctx, x, y, z, NAV.starboard, period, size);
}

/**
 * Drop an engine bell and record its mouth for the FX agent.
 *
 * `dir` is the direction the plume travels, and it must match the way the bell
 * is actually facing — the FX agent hangs a plume off it, so a mismatched pair
 * puts fire inside the hull. Bells default to facing aft.
 */
function thruster(ctx, x, y, z, r, opts = {}) {
  const n = engineNozzle(r, { sides: ctx.b.lod(12, 10, 8, 6), housing: opts.housing });
  const dir = opts.dir ? new THREE.Vector3(opts.dir[0], opts.dir[1], opts.dir[2]).normalize() : new THREE.Vector3(0, 0, -1);
  // The nozzle helper opens along -Z; rotate the whole fitting to match `dir`.
  const place = { x, y, z, variant: PLATE.MECH, wear: 0.6 };
  if (opts.dir) {
    place.rx = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    place.ry = Math.atan2(-dir.x, -dir.z);
  }
  ctx.b.addParts(n.parts, place);
  ctx.engines.push({ pos: new THREE.Vector3(x, y, z), dir, radius: r });
}

/** Turret, with its muzzles carried through the same placement as its mesh. */
function placeTurret(ctx, size, o = {}) {
  const t = turret(size, { ...o, sides: ctx.b.lod(10, 8, 6, 6), barrels: ctx.b.detail > 2 ? 0 : o.barrels });
  ctx.b.addParts(t.parts, o);
  const m = partMatrix(o);
  for (const mz of t.muzzles) {
    const v = new THREE.Vector3(mz[0], mz[1], mz[2]);
    if (m) v.applyMatrix4(m);
    hp(ctx, v.x, v.y, v.z);
  }
}

/** Absolute greeble size for a hull. Grows with length^0.45, which is what
    makes a carrier read as fifty fighters rather than one big fighter. */
export function greebleSize(len) {
  return 0.35 * Math.pow(len / 14, 0.45);
}

/**
 * Lit window band on a vertical face. Faces -Z locally; rotate at placement.
 *
 * `span` is the length of hull the band has to cover — passing the wrong axis
 * here is what sends a bow band shooting hundreds of metres off the flank, so
 * the count is derived from it rather than supplied.
 */
function windows(ctx, span, pitch, w, h, o = {}) {
  if (ctx.b.detail > 1) return;
  const count = Math.max(1, Math.round(span / pitch));
  const g = o.plain
    ? windowRow(count, pitch, w, h, { skip: o.skip })
    : windowBand(ctx.wrng, {
      count, pitch, w, h,
      rows: o.rows || 1,
      rowPitch: o.rowPitch,
      fill: o.fill,
      run: o.run,
    });
  if (!g) return;
  // The band faces -Z. One given no rotation of its own is sitting on a
  // forward face, so turn it round to look out over the bow.
  const face = o.ry === undefined && o.rx === undefined ? { ry: Math.PI } : null;
  ctx.b.add(g, { ...o, ...face, kind: KIND.GLOW, variant: PLATE.PANEL });
}

/** Recessed window gallery — same idea, but the strip is sunk behind a lip. */
function winBay(ctx, span, pitch, w, h, o = {}) {
  if (ctx.b.detail > 1) return;
  const count = Math.max(1, Math.round(span / pitch));
  const parts = windowBay(ctx.wrng, {
    count, pitch, w, h,
    rows: o.rows || 1,
    rowPitch: o.rowPitch,
    fill: o.fill,
    run: o.run,
    depth: o.depth,
  });
  const face = o.ry === undefined && o.rx === undefined ? { ry: Math.PI } : null;
  ctx.b.addParts(parts, { ...o, ...face });
}

/* ============================================================ small craft */

/* scout — a sensor dish with engines bolted on. Almost no hull. */
function buildScout(ctx) {
  const { b, rng } = ctx;
  const sec = (w, h, cy, c) => rectSection(w, h, { cy, chamfer: c, wTop: w * 0.7, wBot: w * 0.9 });
  const spine = [
    { z: -5.6, pts: sec(0.8, 0.7, 0, 0.18) },
    { z: -4.4, pts: sec(1.6, 1.3, 0, 0.3) },
    { z: -1.2, pts: sec(1.7, 1.45, 0.05, 0.32) },
    { z: 1.6, pts: sec(1.4, 1.2, 0.05, 0.28) },
    { z: 3.2, pts: sec(0.95, 0.85, 0, 0.22) },
    { z: 4.1, pts: sec(0.36, 0.32, 0, 0.09) },
  ];
  b.add(loft(decimateStations(spine, b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });

  // The dish is the ship. Offset and tilted so it never reads as a decal.
  b.addParts(dish(2.6, { sides: b.lod(16, 12, 8, 6), rows: b.lod(4, 3, 2, 1), mast: b.detail < 2 }), {
    x: 0.28, y: 0.5, z: 3.1, rx: -0.13, ry: 0.09, variant: PLATE.PANEL, wear: 0.3,
  });
  b.add(chamferBox(1.0, 1.0, 1.5, { chamfer: 0.22 }), {
    x: 0.28, y: 0.5, z: 2.0, variant: PLATE.MECH, wear: 0.35,
  });

  // Outboard nacelles on stub pylons — deliberately not a matched pair.
  const pods = [
    { s: 1, x: 2.2, z: -2.9, len: 4.0, r: 0.62 },
    { s: -1, x: -2.02, z: -2.6, len: 3.6, r: 0.58 },
  ];
  for (const p of pods) {
    b.add(chamferBox(Math.abs(p.x) - 0.5, 0.34, 1.9, { chamfer: 0.12, chamferZ: 0.3 }), {
      x: p.x * 0.55, y: -0.05, z: p.z + 1.1, rz: p.s * 0.06, variant: PLATE.PANEL, wear: 0.4,
    });
    b.add(tube(p.r * 0.8, p.r, p.len, b.lod(10, 8, 6, 5), { rot: Math.PI / 8, capStart: false }), {
      x: p.x, y: 0, z: p.z - p.len * 0.5, variant: PLATE.MECH, wear: 0.45,
    });
    thruster(ctx, p.x, 0, p.z - p.len * 0.5, p.r);
    if (b.detail < 2) {
      b.add(chamferBox(0.28, 0.5, 1.2, { chamfer: 0.1 }), {
        x: p.x, y: p.r * 0.85, z: p.z + 0.4, variant: PLATE.MECH, wear: 0.5,
      });
    }
  }

  // Team trim: a chevron band behind the dish.
  b.add(chamferBox(1.75, 0.14, 0.9, { chamfer: 0.05 }), {
    y: 0.62, z: 1.05, team: 1, variant: PLATE.PANEL, wear: 0.2,
  });

  b.add(chamferBox(0.9, 0.34, 1.4, { chamfer: 0.14, chamferZ: 0.3, taperFront: 0.6 }), {
    y: 0.72, z: 0.1, kind: KIND.GLASS, variant: PLATE.PANEL,
  });

  if (b.detail < 2) {
    b.addParts(mast(rng, 2.3, 0.09, { arms: 2 }), { x: -0.55, y: 0.55, z: -2.2, rz: 0.2, wear: 0.5 });
    b.addParts(mast(rng, 1.5, 0.07, { arms: 1 }), { x: 0.7, y: -0.62, z: -3.4, rx: Math.PI * 0.92, wear: 0.5 });
    b.addParts(greebleField(rng, {
      x0: -0.7, x1: 0.7, z0: -4.0, z1: 1.2, y: 0.6, size: greebleSize(12), count: 10,
      keep: b.lod(1, 0.4, 0, 0),
    }), {});
  }

  hp(ctx, 0, -0.62, 3.4);
  navSet(ctx, 2.2, 0.25, -2.4, 0.16, 1.6);
  light(ctx, 0.28, 1.1, 2.2, NAV.beacon, 2.4, 0.14);
}

/* interceptor — forward-swept delta, canopy, twin outboard engines. */
function buildInterceptor(ctx) {
  const { b, rng } = ctx;
  const sec = (w, h, cy, c) => rectSection(w, h, { cy, chamfer: c, wTop: w * 0.62, wBot: w * 0.94 });
  const spine = [
    { z: -6.6, pts: sec(1.5, 1.25, 0, 0.3) },
    { z: -5.0, pts: sec(2.05, 1.75, 0.05, 0.4) },
    { z: -1.6, pts: sec(2.2, 1.95, 0.1, 0.44) },
    { z: 1.8, pts: sec(1.75, 1.6, 0.1, 0.36) },
    { z: 4.6, pts: sec(1.0, 0.95, 0.02, 0.22) },
    { z: 6.4, pts: sec(0.42, 0.5, -0.05, 0.1) },
    { z: 7.0, pts: sec(0.1, 0.14, -0.06, 0.03) },
  ];
  b.add(loft(decimateStations(spine, b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });

  // Dorsal spine ridge — one long knife edge down the back.
  b.add(loft([
    { z: -5.2, pts: rectSection(0.5, 0.36, { cy: 1.0, chamfer: 0.13, wTop: 0.16 }) },
    { z: -1.0, pts: rectSection(0.62, 0.5, { cy: 1.12, chamfer: 0.16, wTop: 0.2 }) },
    { z: 3.4, pts: rectSection(0.4, 0.3, { cy: 0.9, chamfer: 0.1, wTop: 0.12 }) },
    { z: 5.4, pts: rectSection(0.12, 0.1, { cy: 0.62, chamfer: 0.03 }) },
  ], {}), { variant: PLATE.PANEL, wear: 0.25 });

  // Forward-swept wing: tip chord sits ahead of the root chord.
  const wingStations = [
    wingSection(1.0, 2.0, -3.6, 1.0, { chamfer: 0.3 }),
    wingSection(3.1, 3.0, -2.0, 0.72, { chamfer: 0.22 }),
    wingSection(5.4, 4.3, -0.4, 0.42, { chamfer: 0.13 }),
    wingSection(6.5, 4.7, 1.4, 0.16, { chamfer: 0.05 }),
  ];
  b.both((s) => {
    b.add(wing(wingStations), { mirrorX: s < 0, y: -0.1, variant: PLATE.HULL, wear: 0.35 });
    // Nacelle slung under the mid-span.
    b.add(tube(0.5, 0.62, 4.4, b.lod(10, 8, 6, 5), { rot: Math.PI / 8, capStart: false }), {
      x: s * 3.5, y: -0.55, z: -3.4, variant: PLATE.MECH, wear: 0.4,
    });
    b.add(chamferBox(0.9, 0.5, 2.2, { chamfer: 0.16, chamferZ: 0.3, taperFront: 0.7 }), {
      x: s * 3.5, y: -0.42, z: 1.4, variant: PLATE.PANEL, wear: 0.4,
    });
    thruster(ctx, s * 3.5, -0.55, -3.4, 0.62);
    // Team stripe on the wing shoulder.
    b.add(chamferBox(2.1, 0.1, 0.7, { chamfer: 0.04 }), {
      x: s * 3.0, y: 0.35, z: -0.4, rz: s * 0.05, team: 1, variant: PLATE.PANEL,
    });
  });

  // Canopy, set slightly to port so the ship never reads mirror-perfect.
  b.add(chamferBox(1.25, 0.6, 2.6, { chamfer: 0.24, chamferZ: 0.5, taperFront: 0.45, wTop: 0.8 }), {
    x: -0.1, y: 1.15, z: 1.3, kind: KIND.GLASS, variant: PLATE.PANEL,
  });
  b.add(chamferBox(1.5, 0.42, 3.2, { chamfer: 0.2, chamferZ: 0.6, taperFront: 0.5, wTop: 1.05 }), {
    x: -0.1, y: 0.95, z: 1.25, variant: PLATE.PANEL, wear: 0.2,
  });

  // Chin gun fairing + sensor blister, starboard only.
  b.add(chamferBox(0.8, 0.55, 2.6, { chamfer: 0.18, chamferZ: 0.4, taperFront: 0.6 }), {
    y: -0.95, z: 3.0, variant: PLATE.MECH, wear: 0.6,
  });
  if (b.detail < 2) {
    b.add(chamferBox(0.6, 0.4, 0.9, { chamfer: 0.15 }), {
      x: 0.85, y: 0.35, z: 2.6, variant: PLATE.MECH, wear: 0.5,
    });
    b.addParts(mast(rng, 1.6, 0.07, { arms: 2 }), { x: -0.45, y: 1.25, z: -3.2, rz: 0.25, wear: 0.5 });
    b.addParts(greebleField(rng, {
      x0: -1.0, x1: 1.0, z0: -5.0, z1: 0.5, y: 0.85, size: greebleSize(14), count: 12,
      keep: b.lod(1, 0.4, 0, 0),
    }), {});
  }

  hp(ctx, 0.42, -0.9, 4.3);
  hp(ctx, -0.42, -0.9, 4.3);
  navSet(ctx, 6.4, -0.02, 4.6, 0.18, 1.4);
  light(ctx, -0.1, 1.5, -1.2, NAV.beacon, 2.1, 0.15);
}

/* bomber — fat ordnance belly, heavy nose, stubby wings. */
function buildBomber(ctx) {
  const { b, rng } = ctx;
  // Deep asymmetric section: shallow deck, heavy belly.
  const sec = (w, h, drop, c) => rectSection(w, h, {
    wTop: w * 0.66, wBot: w * 1.0, chamfer: c, top: h * 0.42, bottom: -h * 0.42 - drop,
  });
  const spine = [
    { z: -9.4, pts: sec(3.2, 2.6, 0.5, 0.5) },
    { z: -7.0, pts: sec(4.3, 3.2, 1.5, 0.7) },
    { z: -2.4, pts: sec(4.8, 3.5, 2.4, 0.8) },
    { z: 2.2, pts: sec(4.6, 3.4, 2.2, 0.78) },
    { z: 5.6, pts: sec(3.6, 3.0, 1.2, 0.6) },
    { z: 8.2, pts: sec(2.2, 2.2, 0.4, 0.4) },
    { z: 9.6, pts: sec(0.9, 1.1, 0.1, 0.2) },
  ];
  b.add(loft(decimateStations(spine, b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });

  // Armoured nose cap — the bomber leads with its face.
  b.add(chamferBox(2.9, 2.4, 3.4, { chamfer: 0.55, chamferZ: 0.8, taperFront: 0.42, wTop: 2.1 }), {
    y: 0.15, z: 7.4, variant: PLATE.ARMOUR, wear: 0.55,
  });

  // Ordnance bay: two sunk trenches with the torpedo tubes inside.
  b.both((s) => {
    b.addParts(pocket(1.5, 6.6, 0.9, { chamfer: 0.28, taper: 0.8, variant: PLATE.MECH }), {
      mirrorX: s < 0, x: 1.15, y: -3.5, z: 0.2, rx: -Math.PI / 2,
    });
    b.add(tube(0.5, 0.44, 5.6, b.lod(10, 8, 6, 5), { rot: Math.PI / 8, capStart: false }), {
      mirrorX: s < 0, x: 1.15, y: -3.35, z: 1.0, variant: PLATE.MECH, wear: 0.7,
    });
    hp(ctx, s * 1.15, -3.35, 6.7);

    // Stubby wing with a tip nacelle.
    b.add(wing([
      wingSection(1.6, 1.2, -5.0, 1.4, { chamfer: 0.42, cy: -0.4 }),
      wingSection(3.4, 1.6, -4.2, 1.0, { chamfer: 0.3, cy: -0.4 }),
      wingSection(4.6, 1.4, -3.4, 0.5, { chamfer: 0.16, cy: -0.4 }),
    ]), { mirrorX: s < 0, variant: PLATE.HULL, wear: 0.4 });
    b.add(tube(0.72, 0.86, 4.6, b.lod(10, 8, 6, 5), { rot: Math.PI / 8, capStart: false }), {
      mirrorX: s < 0, x: 4.2, y: -0.55, z: -5.6, variant: PLATE.MECH, wear: 0.45,
    });
    thruster(ctx, s * 4.2, -0.55, -5.6, 0.86);
    b.add(chamferBox(1.5, 0.13, 1.1, { chamfer: 0.05 }), {
      mirrorX: s < 0, x: 3.2, y: 0.28, z: -1.4, team: 1, variant: PLATE.PANEL,
    });
  });

  // Dorsal engine pair on a raised block.
  b.add(chamferBox(3.6, 1.5, 4.4, { chamfer: 0.4, chamferZ: 0.7, taperFront: 0.7 }), {
    y: 1.6, z: -6.4, variant: PLATE.MECH, wear: 0.55,
  });
  b.both((s) => thruster(ctx, s * 1.05, 1.6, -9.0, 0.72));

  // Cockpit: armoured slit, offset to starboard.
  b.add(chamferBox(2.0, 0.75, 2.4, { chamfer: 0.3, chamferZ: 0.4, taperFront: 0.55, wTop: 1.4 }), {
    x: 0.35, y: 1.85, z: 4.2, variant: PLATE.ARMOUR, wear: 0.35,
  });
  b.add(chamferBox(1.4, 0.42, 1.3, { chamfer: 0.16, taperFront: 0.6 }), {
    x: 0.35, y: 2.0, z: 4.9, kind: KIND.GLASS, variant: PLATE.PANEL,
  });

  if (b.detail < 2) {
    b.addParts(mast(rng, 2.4, 0.1, { arms: 2 }), { x: -1.3, y: 1.5, z: -2.6, rz: 0.2, wear: 0.5 });
    b.addParts(greebleField(rng, {
      x0: -1.9, x1: 1.9, z0: -7.0, z1: 3.2, y: 1.5, size: greebleSize(20), count: 20,
      keep: b.lod(1, 0.4, 0, 0),
    }), {});
    b.addParts(greebleField(rng, {
      x0: -2.4, x1: 2.4, z0: -7.5, z1: 4.0, y: -4.2, size: greebleSize(20), count: 12, sink: 0.6,
      keep: b.lod(1, 0.4, 0, 0),
    }), {});
  }

  navSet(ctx, 4.6, -0.5, -3.6, 0.22, 1.9);
  light(ctx, 0.35, 2.4, 1.0, NAV.beacon, 2.6, 0.2);
}

/* corvette — gun-forward gunship, twin dorsal cannon, armoured cheeks. */
function buildCorvette(ctx) {
  const { b, rng } = ctx;
  const sec = (w, h, cy, c, nw) => trenchSection(w, h, {
    cy, chamfer: c, wTop: w * 0.74, wBot: w * 0.98,
    notchW: nw, notchDepth: h * 0.16, chamferNotch: c * 0.4,
  });
  const spine = [
    { z: -16.5, pts: sec(6.4, 5.6, 0, 0.85, 0) },
    { z: -13.0, pts: sec(7.6, 6.6, 0, 1.05, 1.6) },
    { z: -5.0, pts: sec(8.2, 7.0, 0.1, 1.15, 2.6) },
    { z: 3.5, pts: sec(8.0, 6.8, 0.1, 1.1, 2.6) },
    { z: 9.5, pts: sec(6.2, 5.6, 0, 0.85, 1.4) },
    { z: 14.0, pts: sec(3.6, 3.6, -0.2, 0.5, 0) },
    { z: 16.8, pts: sec(1.2, 1.5, -0.3, 0.2, 0) },
  ];
  b.add(loft(decimateStations(spine, b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });

  // Armoured cheeks — the bow carries the weight.
  b.both((s) => {
    b.add(chamferBox(2.2, 4.2, 9.0, { chamfer: 0.7, chamferZ: 1.1, taperFront: 0.4, wTop: 1.4 }), {
      mirrorX: s < 0, x: 3.6, y: 0.2, z: 6.0, rz: s * -0.06, variant: PLATE.ARMOUR, wear: 0.5,
    });
    b.add(chamferBox(0.9, 0.16, 5.0, { chamfer: 0.06, chamferZ: 0.4 }), {
      mirrorX: s < 0, x: 4.5, y: 1.5, z: 4.5, team: 1, variant: PLATE.PANEL,
    });
  });

  // Twin dorsal cannon on a shared raised mount.
  b.add(chamferBox(5.2, 1.6, 7.5, { chamfer: 0.5, chamferZ: 0.8, taperFront: 0.72 }), {
    y: 3.6, z: 1.0, variant: PLATE.ARMOUR, wear: 0.35,
  });
  b.both((s) => {
    b.add(tube(0.62, 0.5, 9.5, b.lod(10, 8, 6, 5), { rot: Math.PI / 8, capStart: false }), {
      x: s * 1.5, y: 4.3, z: 3.2, variant: PLATE.MECH, wear: 0.75,
    });
    b.add(ring(0.5, 0.95, 0.7, b.lod(10, 8, 6, 6)), { x: s * 1.5, y: 4.3, z: 11.4, variant: PLATE.MECH, wear: 0.9 });
    hp(ctx, s * 1.5, 4.3, 12.9);
  });

  // Drive block, four mouths.
  b.add(chamferBox(7.0, 5.8, 3.0, { chamfer: 0.9, chamferZ: 0.5, wTop: 5.4 }), {
    z: -15.6, variant: PLATE.MECH, wear: 0.6,
  });
  for (const [x, y] of [[-1.9, 1.5], [1.9, 1.5], [-1.9, -1.5], [1.9, -1.5]]) {
    thruster(ctx, x, y, -17.0, 1.2);
  }

  // Bridge blister, offset to port; sensor mast to starboard.
  b.add(chamferBox(2.6, 1.5, 3.6, { chamfer: 0.45, chamferZ: 0.6, taperFront: 0.6, wTop: 1.7 }), {
    x: -1.7, y: 3.9, z: -6.0, variant: PLATE.PANEL, wear: 0.3,
  });
  b.add(chamferBox(1.6, 0.5, 1.6, { chamfer: 0.2, taperFront: 0.7 }), {
    x: -1.7, y: 4.4, z: -4.9, kind: KIND.GLASS, variant: PLATE.PANEL,
  });
  if (b.detail < 2) {
    b.addParts(mast(rng, 5.0, 0.2, { arms: 3 }), { x: 2.1, y: 3.4, z: -8.5, rz: -0.15, wear: 0.5 });
    b.addParts(greebleField(rng, {
      x0: -3.2, x1: 3.2, z0: -12.0, z1: 6.0, y: 3.3, size: greebleSize(34), count: 26,
      keep: b.lod(1, 0.4, 0, 0),
    }), {});
    b.both((s) => b.addParts(greebleField(rng, {
      x0: 3.4, x1: 4.1, z0: -12.0, z1: 2.0, y: 0, size: greebleSize(34), count: 10, sink: 0.7,
      keep: b.lod(1, 0.4, 0, 0),
    }), { mirrorX: s < 0 }));
  }

  navSet(ctx, 4.4, 1.0, -10.0, 0.35, 1.7);
  light(ctx, -1.7, 4.9, -6.0, NAV.beacon, 2.2, 0.3);
  light(ctx, 0, 4.5, 12.0, NAV.deck, 1.1, 0.24);
}

/* missileCorvette — the launch cells are the design. */
function buildMissileCorvette(ctx) {
  const { b, rng } = ctx;
  const sec = (w, h, cy, c) => rectSection(w, h, { cy, chamfer: c, wTop: w * 0.86, wBot: w * 0.9 });
  const spine = [
    { z: -15.5, pts: sec(6.0, 5.0, 0, 0.8) },
    { z: -12.0, pts: sec(7.0, 5.8, 0, 0.95) },
    { z: -3.0, pts: sec(7.4, 6.0, 0.15, 1.0) },
    { z: 5.0, pts: sec(6.8, 5.4, 0.15, 0.9) },
    { z: 10.5, pts: sec(4.6, 4.0, 0, 0.6) },
    { z: 14.4, pts: sec(2.0, 2.2, -0.2, 0.32) },
    { z: 16.0, pts: sec(0.7, 0.9, -0.25, 0.14) },
  ];
  b.add(loft(decimateStations(spine, b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });

  // Honeycomb block: a real grid of sunk cells, four across, six deep.
  b.add(chamferBox(7.6, 2.4, 12.0, { chamfer: 0.5, chamferZ: 0.7, wTop: 6.8 }), {
    y: 3.5, z: -2.0, variant: PLATE.ARMOUR, wear: 0.35,
  });
  const cols = 4;
  const rows = b.lod(6, 6, 3, 0);
  const pitch = 1.68;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c - (cols - 1) * 0.5) * pitch;
      const cz = -2.0 + (r - (rows - 1) * 0.5) * (pitch * 1.55 * (6 / Math.max(1, rows)));
      b.addParts(pocket(1.34, 1.34, 1.9, {
        chamfer: 0.2, taper: 0.66, variant: PLATE.MECH, lit: (r + c) % 3 === 0,
      }), { x: cx, y: 4.7, z: cz, rx: Math.PI / 2, wear: 0.5 });
      if (r === 0 && c < 2) hp(ctx, cx, 4.7, cz);
    }
  }
  hp(ctx, -pitch * 0.5, 4.7, -2.0);
  hp(ctx, pitch * 1.5, 4.7, -2.0);

  // Side reload rails and armoured shoulder plates.
  b.both((s) => {
    b.add(chamferBox(1.1, 2.6, 14.0, { chamfer: 0.32, chamferZ: 0.9, taperFront: 0.65 }), {
      mirrorX: s < 0, x: 3.9, y: 1.4, z: -1.0, variant: PLATE.PANEL, wear: 0.4,
    });
    b.addParts(ribBand(b.lod(7, 5, 3, 0), -7.0, 5.0, 1.5, 2.9, 0.34, { variant: PLATE.MECH }), {
      mirrorX: s < 0, x: 3.9, y: 1.4,
    });
    b.add(chamferBox(0.7, 0.14, 4.2, { chamfer: 0.05, chamferZ: 0.4 }), {
      mirrorX: s < 0, x: 4.4, y: 2.7, z: 3.0, team: 1, variant: PLATE.PANEL,
    });
  });

  // Sharp fairing over the bow sensor.
  b.add(chamferBox(2.4, 1.9, 5.2, { chamfer: 0.4, chamferZ: 0.9, taperFront: 0.35, wTop: 1.5 }), {
    y: 0.6, z: 11.0, variant: PLATE.ARMOUR, wear: 0.5,
  });

  b.add(chamferBox(5.6, 4.6, 2.6, { chamfer: 0.7, chamferZ: 0.45 }), {
    z: -14.8, variant: PLATE.MECH, wear: 0.6,
  });
  b.both((s) => thruster(ctx, s * 1.7, 0.2, -16.2, 1.5));

  b.add(chamferBox(2.2, 1.3, 3.0, { chamfer: 0.4, chamferZ: 0.5, taperFront: 0.6, wTop: 1.4 }), {
    x: 1.9, y: 3.4, z: -9.0, variant: PLATE.PANEL, wear: 0.3,
  });
  b.add(chamferBox(1.3, 0.42, 1.3, { chamfer: 0.16, taperFront: 0.7 }), {
    x: 1.9, y: 3.8, z: -8.1, kind: KIND.GLASS, variant: PLATE.PANEL,
  });
  if (b.detail < 2) {
    b.addParts(mast(rng, 4.4, 0.18, { arms: 3 }), { x: -2.2, y: 3.2, z: -10.5, rz: 0.18, wear: 0.5 });
    b.addParts(greebleField(rng, {
      x0: -2.6, x1: 2.6, z0: -12.0, z1: 8.0, y: -2.9, size: greebleSize(32), count: 20, sink: 0.6,
      keep: b.lod(1, 0.4, 0, 0),
    }), {});
  }

  navSet(ctx, 4.5, 1.4, -8.0, 0.32, 1.8);
  light(ctx, 1.9, 4.2, -9.0, NAV.beacon, 2.3, 0.28);
}

/* =============================================================== frigates */

/** Belt band that wraps a bulwark hull's flanks — the family's signature. */
function armourBelt(ctx, stations, opts) {
  const { b } = ctx;
  const { out, top, bottom, chamfer, variant = PLATE.ARMOUR } = opts;
  const belt = stations.map((s) => {
    const w = s.w + out * 2;
    return { z: s.z, pts: rectSection(w, top - bottom, {
      wTop: w * (opts.tumble || 0.94), wBot: w, top, bottom, chamfer,
    }) };
  });
  b.add(loft(decimateStations(belt, b.lod(1, 1, 2, 3)), {}), { variant, wear: 0.4 });
}

/* assaultFrigate — slab-sided, turret deck, flak sponsons, spine trench. */
function buildAssaultFrigate(ctx) {
  const { b, rng } = ctx;
  const g = greebleSize(130);
  const plan = [
    { z: -64, w: 15, h: 14, n: 0 },
    { z: -56, w: 18.5, h: 16.5, n: 3.2 },
    { z: -34, w: 20.5, h: 17.5, n: 5.6 },
    { z: -6, w: 21.0, h: 17.8, n: 6.0 },
    { z: 16, w: 19.0, h: 16.2, n: 5.2 },
    { z: 34, w: 14.5, h: 13.0, n: 3.0 },
    { z: 50, w: 8.6, h: 9.2, n: 0 },
    { z: 60, w: 3.8, h: 5.0, n: 0 },
    { z: 65, w: 0.9, h: 1.6, n: 0 },
  ];
  const spine = plan.map((p) => ({
    z: p.z,
    pts: trenchSection(p.w, p.h, {
      wTop: p.w * 0.7, wBot: p.w * 0.99, chamfer: p.h * 0.1, chamferNotch: p.h * 0.04,
      notchW: p.n, notchDepth: p.h * 0.2, cy: 0,
    }),
  }));
  b.add(loft(decimateStations(spine, b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });
  armourBelt(ctx, plan.slice(0, 7), { out: 0.7, top: 1.5, bottom: -4.5, chamfer: 1.1 });

  // Turret deck: a raised armoured strip carrying the main battery.
  b.add(chamferBox(11.0, 2.2, 54.0, { chamfer: 0.9, chamferZ: 1.4, taperFront: 0.6, wTop: 9.0 }), {
    y: 8.4, z: -6.0, variant: PLATE.ARMOUR, wear: 0.3,
  });
  placeTurret(ctx, 3.5, { y: 9.6, z: 20.0, barrels: 2, barrelLen: 10.5 });
  placeTurret(ctx, 3.5, { y: 9.6, z: 4.0, barrels: 2, barrelLen: 10.5 });
  placeTurret(ctx, 3.2, { y: 9.6, z: -26.0, barrels: 2, barrelLen: 9.5, ry: Math.PI });

  // Flak sponsons, deliberately not opposite each other.
  placeTurret(ctx, 2.0, { x: 10.8, y: 0.5, z: 8.0, rz: -Math.PI / 2, barrels: 2, barrelLen: 4.0 });
  placeTurret(ctx, 2.0, { x: -10.8, y: 0.5, z: -18.0, rz: Math.PI / 2, barrels: 2, barrelLen: 4.0 });
  b.both((s) => {
    b.add(chamferBox(3.0, 4.0, 9.0, { chamfer: 0.7, chamferZ: 1.0, taperFront: 0.7 }), {
      mirrorX: s < 0, x: 10.0, y: 0.4, z: s > 0 ? 8.0 : -18.0, variant: PLATE.ARMOUR, wear: 0.45,
    });
  });

  // Bridge tower aft, offset to port. Layered, not a single block.
  const tz = -40;
  b.add(chamferBox(9.5, 6.0, 15.0, { chamfer: 1.0, chamferZ: 1.6, taperFront: 0.78, wTop: 7.2 }), {
    x: -1.4, y: 11.5, z: tz, variant: PLATE.PANEL, wear: 0.28,
  });
  b.add(chamferBox(6.6, 4.4, 9.5, { chamfer: 0.8, chamferZ: 1.2, taperFront: 0.7, wTop: 4.6 }), {
    x: -1.4, y: 16.4, z: tz + 1.5, variant: PLATE.PANEL, wear: 0.24,
  });
  b.add(chamferBox(4.2, 1.5, 4.0, { chamfer: 0.35, chamferZ: 0.6, taperFront: 0.62 }), {
    x: -1.4, y: 19.3, z: tz + 4.0, kind: KIND.GLASS, variant: PLATE.PANEL,
  });
  windows(ctx, 6.6, 0.95, 0.45, 0.55, { x: -1.4, y: 12.5, z: tz + 7.6, rows: 2, rowPitch: 1.5 });
  windows(ctx, 12.0, 0.95, 0.4, 0.5, { x: 4.8, y: 12.5, z: tz, ry: -Math.PI / 2, rows: 2, rowPitch: 1.4 });

  // Drive block: four mains and two verniers.
  b.add(chamferBox(17.0, 15.0, 6.0, { chamfer: 2.0, chamferZ: 1.2, wTop: 12.0 }), {
    z: -63.0, variant: PLATE.MECH, wear: 0.55,
  });
  for (const [x, y] of [[-4.6, 3.0], [4.6, 3.0], [-4.6, -3.2], [4.6, -3.2]]) {
    thruster(ctx, x, y, -66.5, 2.7);
  }
  b.both((s) => thruster(ctx, s * 8.2, 0, -65.5, 1.3));

  if (b.detail < 2) {
    b.addParts(mast(rng, 13.0, 0.42, { arms: 4 }), { x: 3.0, y: 12.0, z: tz - 7.0, rz: -0.1, wear: 0.5 });
    b.addParts(dish(2.6, { sides: b.lod(14, 10, 8, 6), rows: 3 }), {
      x: -5.4, y: 14.2, z: tz - 5.5, rx: -0.5, ry: -0.7, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(catwalk(30.0, 2.0, 0.28), { x: 7.4, y: 2.0, z: -12.0, wear: 0.5 });
    b.addParts(greebleField(rng, {
      x0: -8.0, x1: 8.0, z0: -56, z1: 34, y: 8.6, size: g, count: 70, keep: b.lod(1, 0.35, 0, 0),
    }), {});
    b.both((s) => b.addParts(greebleField(rng, {
      x0: 9.4, x1: 10.6, z0: -56, z1: 30, y: 3.0, size: g, count: 34, sink: 0.65,
      keep: b.lod(1, 0.35, 0, 0),
    }), { mirrorX: s < 0 }));
    b.addParts(greebleField(rng, {
      x0: -7.0, x1: 7.0, z0: -56, z1: 20, y: -8.6, size: g, count: 26, sink: 0.6,
      keep: b.lod(1, 0.35, 0, 0),
    }), {});
  }

  // Team band along the belt and around the prow.
  b.both((s) => {
    b.add(chamferBox(0.5, 1.1, 40.0, { chamfer: 0.16, chamferZ: 1.4 }), {
      mirrorX: s < 0, x: 10.6, y: -1.0, z: -14.0, team: 1, variant: PLATE.PANEL,
    });
  });
  b.add(chamferBox(6.5, 0.4, 3.2, { chamfer: 0.15, chamferZ: 0.5 }), {
    y: 6.4, z: 44.0, team: 1, variant: PLATE.PANEL,
  });

  navSet(ctx, 11.0, 1.2, -30.0, 0.7, 1.9);
  light(ctx, -1.4, 21.0, tz + 1.5, NAV.beacon, 2.4, 0.6);
  light(ctx, 0, 10.0, 52.0, NAV.deck, 1.3, 0.5);
}

/* ionFrigate — a gun with a ship built behind it. */
function buildIonFrigate(ctx) {
  const { b, rng } = ctx;
  const g = greebleSize(140);
  const bodyPlan = [
    { z: -70, w: 12.5, h: 11.0 },
    { z: -62, w: 15.0, h: 13.0 },
    { z: -40, w: 16.0, h: 13.6 },
    { z: -12, w: 15.0, h: 12.6 },
    { z: 6, w: 12.0, h: 10.4 },
    { z: 18, w: 8.0, h: 7.6 },
    { z: 24, w: 3.4, h: 4.0 },
  ];
  b.add(loft(decimateStations(bodyPlan.map((p) => ({
    z: p.z,
    pts: rectSection(p.w, p.h, { wTop: p.w * 0.6, wBot: p.w * 0.98, chamfer: p.h * 0.12, cy: -3.5 }),
  })), b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });

  // The barrel: 88 m of accelerator running past the bow. This is the ship.
  const bl = 88;
  const bz0 = -18;
  const sides = b.lod(14, 12, 8, 6);
  b.add(loft(decimateStations([
    { z: bz0, pts: ngonSection(5.0, sides) },
    { z: bz0 + 8, pts: ngonSection(6.2, sides) },
    { z: bz0 + 46, pts: ngonSection(6.0, sides) },
    { z: bz0 + 70, pts: ngonSection(6.6, sides) },
    { z: bz0 + bl - 3, pts: ngonSection(6.9, sides) },
    { z: bz0 + bl, pts: ngonSection(6.2, sides) },
  ], b.lod(1, 1, 2, 2)), {}), { y: 3.2, variant: PLATE.MECH, wear: 0.45 });

  // Accelerator coils, spaced tighter toward the muzzle.
  const coils = b.lod(9, 6, 3, 0);
  for (let i = 0; i < coils; i++) {
    const t = i / Math.max(1, coils - 1);
    const z = bz0 + 10 + Math.pow(t, 0.8) * (bl - 22);
    b.add(ring(6.2, 8.2 - t * 1.2, 1.5 + (1 - t) * 0.8, sides), {
      y: 3.2, z, variant: PLATE.MECH, wear: 0.4 + t * 0.3,
    });
  }
  // Muzzle: recessed emitter with a lit core.
  b.addParts(pocket(8.4, 8.4, 5.0, { chamfer: 1.6, taper: 0.55, lit: true, variant: PLATE.MECH }), {
    y: 3.2, z: bz0 + bl, ry: Math.PI, wear: 0.9,
  });
  b.add(ring(6.3, 8.0, 1.8, sides), { y: 3.2, z: bz0 + bl - 1.8, variant: PLATE.ARMOUR, wear: 0.85 });
  hp(ctx, 0, 3.2, bz0 + bl + 1.0);

  // Capacitor banks flanking the barrel, ribbed and exposed.
  b.both((s) => {
    b.add(tube(3.0, 2.6, 34.0, b.lod(10, 8, 6, 5), { rot: Math.PI / 10, capStart: false }), {
      mirrorX: s < 0, x: 8.2, y: 1.0, z: -34.0, variant: PLATE.MECH, wear: 0.5,
    });
    b.addParts(ribBand(b.lod(8, 5, 3, 0), -32, -4, 6.6, 6.6, 0.7, { variant: PLATE.MECH }), {
      mirrorX: s < 0, x: 8.2, y: 1.0,
    });
    b.add(chamferBox(2.4, 3.4, 26.0, { chamfer: 0.6, chamferZ: 1.2, taperFront: 0.6 }), {
      mirrorX: s < 0, x: 8.6, y: -6.0, z: -22.0, variant: PLATE.ARMOUR, wear: 0.5,
    });
    b.addParts(radiator(0.7, 22.0, 1.0, b.lod(7, 4, 0, 0)), {
      mirrorX: s < 0, x: 11.0, y: 4.0, z: -46.0, rz: s * -0.5, variant: PLATE.PANEL, wear: 0.35,
    });
    b.add(chamferBox(0.5, 0.9, 16.0, { chamfer: 0.16, chamferZ: 1.0 }), {
      mirrorX: s < 0, x: 8.4, y: -9.6, z: -18.0, team: 1, variant: PLATE.PANEL,
    });
  });

  // Spine bracing between body and barrel.
  b.addParts(ribBand(b.lod(6, 4, 2, 0), -14, 20, 5.0, 9.0, 1.1, { variant: PLATE.PANEL, y: 0.5 }), {});

  // Bridge, tucked low on the starboard quarter — the gun owns the centreline.
  b.add(chamferBox(6.0, 4.6, 11.0, { chamfer: 0.9, chamferZ: 1.4, taperFront: 0.7, wTop: 4.2 }), {
    x: 4.2, y: 3.6, z: -50.0, variant: PLATE.PANEL, wear: 0.3,
  });
  b.add(chamferBox(3.6, 1.3, 3.4, { chamfer: 0.3, taperFront: 0.6 }), {
    x: 4.2, y: 6.2, z: -46.5, kind: KIND.GLASS, variant: PLATE.PANEL,
  });
  windows(ctx, 4.6, 1.0, 0.4, 0.5, { x: 4.2, y: 4.0, z: -44.4, rows: 2, rowPitch: 1.4 });

  b.add(chamferBox(14.0, 12.0, 5.0, { chamfer: 1.8, chamferZ: 1.0, wTop: 9.0 }), {
    y: -3.5, z: -69.0, variant: PLATE.MECH, wear: 0.55,
  });
  for (const [x, y] of [[-4.0, -0.6], [4.0, -0.6], [0, -6.4]]) thruster(ctx, x, y, -72.0, 2.5);

  if (b.detail < 2) {
    b.addParts(mast(rng, 11.0, 0.4, { arms: 3 }), { x: -4.6, y: 3.0, z: -55.0, rz: 0.14, wear: 0.5 });
    b.addParts(greebleField(rng, {
      x0: -5.5, x1: 5.5, z0: -64, z1: 12, y: 2.2, size: g, count: 46, keep: b.lod(1, 0.35, 0, 0),
    }), {});
    b.addParts(greebleField(rng, {
      x0: -5.0, x1: 5.0, z0: -62, z1: 8, y: -9.4, size: g, count: 22, sink: 0.6,
      keep: b.lod(1, 0.35, 0, 0),
    }), {});
  }

  navSet(ctx, 9.0, -2.0, -40.0, 0.7, 2.0);
  light(ctx, 4.2, 6.9, -50.0, NAV.beacon, 2.4, 0.55);
  light(ctx, 0, 10.4, bz0 + bl - 12, NAV.deck, 0.9, 0.5);
}

/* supportFrigate — repair boom arms, radiator wings. */
function buildSupportFrigate(ctx) {
  const { b, rng } = ctx;
  const g = greebleSize(115);
  const plan = [
    { z: -55, w: 13.0, h: 12.0 },
    { z: -47, w: 16.0, h: 14.5 },
    { z: -24, w: 17.0, h: 15.0 },
    { z: 2, w: 16.0, h: 14.0 },
    { z: 20, w: 12.5, h: 11.5 },
    { z: 32, w: 8.0, h: 8.4 },
    { z: 39, w: 3.6, h: 4.4 },
  ];
  b.add(loft(decimateStations(plan.map((p) => ({
    z: p.z,
    pts: trenchSection(p.w, p.h, {
      wTop: p.w * 0.74, wBot: p.w * 0.96, chamfer: p.h * 0.11,
      notchW: p.w * 0.24, notchDepth: p.h * 0.16, chamferNotch: p.h * 0.04,
    }),
  })), b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });
  armourBelt(ctx, plan.slice(0, 5), { out: 0.6, top: 1.0, bottom: -3.6, chamfer: 0.9, variant: PLATE.PANEL });

  // Boom arms: two segments plus an emitter head, reaching forward and out.
  // The port arm is longer — support ships get rebuilt, not replaced.
  const arms = [
    { s: 1, len: 30, tilt: 0.26, yaw: 0.30, z: 22 },
    { s: -1, len: 36, tilt: 0.18, yaw: 0.36, z: 18 },
  ];
  for (const a of arms) {
    const root = { x: a.s * 7.0, y: 1.5, z: a.z };
    b.add(chamferBox(3.4, 3.0, a.len, { chamfer: 0.7, chamferZ: 1.0, taperFront: 0.55 }), {
      x: root.x + a.s * Math.sin(a.yaw) * a.len * 0.5,
      y: root.y + Math.sin(a.tilt) * a.len * 0.5,
      z: root.z + Math.cos(a.yaw) * a.len * 0.5,
      ry: -a.s * a.yaw, rx: -a.tilt, variant: PLATE.PANEL, wear: 0.4,
    });
    const tip = {
      x: root.x + a.s * Math.sin(a.yaw) * a.len,
      y: root.y + Math.sin(a.tilt) * a.len,
      z: root.z + Math.cos(a.yaw) * a.len,
    };
    b.addParts(dish(3.2, { sides: b.lod(14, 10, 8, 6), rows: b.lod(4, 3, 2, 1), mast: b.detail < 2 }), {
      x: tip.x, y: tip.y, z: tip.z, ry: -a.s * a.yaw, rx: -a.tilt, variant: PLATE.MECH, wear: 0.55,
    });
    b.addParts(ribBand(b.lod(6, 4, 2, 0), -a.len * 0.4, a.len * 0.4, 4.2, 3.8, 0.5, { variant: PLATE.MECH }), {
      x: root.x + a.s * Math.sin(a.yaw) * a.len * 0.5,
      y: root.y + Math.sin(a.tilt) * a.len * 0.5,
      z: root.z + Math.cos(a.yaw) * a.len * 0.5,
      ry: -a.s * a.yaw, rx: -a.tilt,
    });
    light(ctx, tip.x, tip.y, tip.z, NAV.hangar, 0.8, 0.5);
    hp(ctx, tip.x, tip.y, tip.z);
  }

  // Radiator wings: big, thin, angled off the dorsal deck.
  b.both((s) => {
    b.addParts(radiator(11.0, 30.0, 1.0, b.lod(9, 5, 0, 0), { taper: 0.7 }), {
      mirrorX: s < 0, x: 9.5, y: 12.0, z: -22.0, rz: s * -0.62, ry: s * 0.1,
      variant: PLATE.PANEL, wear: 0.3,
    });
    b.add(chamferBox(1.4, 3.0, 8.0, { chamfer: 0.4, chamferZ: 0.9 }), {
      mirrorX: s < 0, x: 5.0, y: 9.0, z: -22.0, rz: s * -0.62, variant: PLATE.MECH, wear: 0.45,
    });
  });

  // Cargo / repair modules clamped to the flanks.
  b.both((s) => {
    for (let i = 0; i < b.lod(3, 3, 1, 0); i++) {
      b.add(tube(2.4, 2.4, 12.0, b.lod(10, 8, 6, 5), { rot: Math.PI / 10 }), {
        mirrorX: s < 0, x: 9.4, y: -3.0 + i * 0.4, z: -34 + i * 14, rz: Math.PI / 2,
        variant: PLATE.MECH, wear: 0.5,
      });
    }
    b.add(chamferBox(0.5, 1.0, 24.0, { chamfer: 0.18, chamferZ: 1.2 }), {
      mirrorX: s < 0, x: 8.7, y: 2.2, z: -10.0, team: 1, variant: PLATE.PANEL,
    });
  });

  placeTurret(ctx, 1.8, { x: -6.2, y: 8.2, z: 6.0, barrels: 2, barrelLen: 3.4 });
  placeTurret(ctx, 1.8, { x: 6.2, y: 8.2, z: -12.0, barrels: 2, barrelLen: 3.4, ry: Math.PI });

  // Bridge forward and high — this ship needs to see, not to fight.
  b.add(chamferBox(8.0, 4.6, 10.0, { chamfer: 0.9, chamferZ: 1.4, taperFront: 0.62, wTop: 5.4 }), {
    x: -0.8, y: 9.6, z: 14.0, variant: PLATE.PANEL, wear: 0.28,
  });
  b.add(chamferBox(4.6, 1.5, 3.4, { chamfer: 0.35, taperFront: 0.55 }), {
    x: -0.8, y: 11.6, z: 17.4, kind: KIND.GLASS, variant: PLATE.PANEL,
  });
  windows(ctx, 6.0, 1.0, 0.4, 0.5, { x: -0.8, y: 9.4, z: 19.0, rows: 2, rowPitch: 1.4 });

  b.add(chamferBox(14.5, 13.0, 5.0, { chamfer: 1.8, chamferZ: 1.0, wTop: 10.5 }), {
    z: -54.0, variant: PLATE.MECH, wear: 0.55,
  });
  b.both((s) => {
    thruster(ctx, s * 3.8, 1.4, -57.5, 2.6);
    thruster(ctx, s * 6.4, -4.0, -56.5, 1.4);
  });

  if (b.detail < 2) {
    b.addParts(mast(rng, 9.0, 0.34, { arms: 3 }), { x: 3.6, y: 8.6, z: -40.0, rz: -0.16, wear: 0.5 });
    b.addParts(catwalk(24.0, 2.2, 0.26), { x: -6.6, y: 7.6, z: -14.0, wear: 0.5 });
    b.addParts(greebleField(rng, {
      x0: -6.4, x1: 6.4, z0: -48, z1: 24, y: 7.6, size: g, count: 54, keep: b.lod(1, 0.35, 0, 0),
    }), {});
    b.addParts(greebleField(rng, {
      x0: -6.0, x1: 6.0, z0: -46, z1: 16, y: -7.6, size: g, count: 22, sink: 0.6,
      keep: b.lod(1, 0.35, 0, 0),
    }), {});
  }

  navSet(ctx, 9.2, 1.0, -30.0, 0.65, 1.8);
  light(ctx, -0.8, 12.4, 14.0, NAV.beacon, 2.2, 0.5);
}

/* =============================================================== capitals */

/* destroyer — the classic line warship. */
function buildDestroyer(ctx) {
  const { b, rng } = ctx;
  const g = greebleSize(380);
  // Stepped, not tapered. Each pair of stations a few metres apart is a hard
  // machined ledge; a smooth curve down to a point reads as a boat, and that is
  // the fastest way to lose a Homeworld comparison.
  const plan = [
    { z: -190, w: 46, h: 42, n: 0 },
    { z: -184, w: 56, h: 50, n: 12 },
    { z: -150, w: 58, h: 52, n: 15 },
    { z: -144, w: 62, h: 54, n: 17 },
    { z: -30, w: 62, h: 54, n: 17 },
    { z: 40, w: 60, h: 52, n: 16 },
    { z: 46, w: 50, h: 46, n: 13 },
    { z: 104, w: 47, h: 44, n: 12 },
    { z: 110, w: 37, h: 36, n: 8 },
    { z: 152, w: 33, h: 33, n: 6 },
    { z: 158, w: 24, h: 26, n: 0 },
    { z: 182, w: 20, h: 23, n: 0 },
    { z: 190, w: 13, h: 16, n: 0 },
  ];
  const hw = planWidth(plan);
  b.add(loft(decimateStations(plan.map((p) => ({
    z: p.z,
    pts: trenchSection(p.w, p.h, {
      wTop: p.w * 0.84, wBot: p.w, chamfer: p.h * 0.13, chamferNotch: p.h * 0.035,
      notchW: p.n, notchDepth: p.h * 0.2,
    }),
  })), b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });

  // Layered armour: two belts at different heights, the lower one stepped out.
  armourBelt(ctx, plan.slice(0, 10), { out: 1.8, top: 4.0, bottom: -8.0, chamfer: 3.0 });
  armourBelt(ctx, plan.slice(0, 9), { out: 3.4, top: -9.0, bottom: -18.0, chamfer: 2.6, tumble: 1.0 });

  // Armoured ram: a blunt faceted wedge bolted over the bow, not a needle.
  b.add(chamferBox(26.0, 24.0, 54.0, { chamfer: 4.5, chamferZ: 9.0, taperFront: 0.5, wTop: 15.0 }), {
    y: 1.0, z: 168.0, variant: PLATE.ARMOUR, wear: 0.6,
  });
  b.add(chamferBox(17.0, 15.0, 20.0, { chamfer: 3.0, chamferZ: 5.0, taperFront: 0.62, wTop: 9.0 }), {
    y: 1.0, z: 196.0, variant: PLATE.ARMOUR, wear: 0.75,
  });

  // Superfiring forward pair, then two aft over the drive block.
  b.add(chamferBox(30.0, 6.0, 60.0, { chamfer: 2.4, chamferZ: 3.6, taperFront: 0.62, wTop: 24.0 }), {
    y: 26.0, z: 62.0, variant: PLATE.ARMOUR, wear: 0.32,
  });
  placeTurret(ctx, 9.5, { y: 30.5, z: 84.0, barrels: 2, barrelLen: 30.0 });
  b.add(chamferBox(23.0, 7.0, 30.0, { chamfer: 2.0, chamferZ: 3.0, taperFront: 0.75, wTop: 18.0 }), {
    y: 30.0, z: 48.0, variant: PLATE.ARMOUR, wear: 0.3,
  });
  placeTurret(ctx, 9.5, { y: 37.0, z: 50.0, barrels: 2, barrelLen: 30.0 });
  placeTurret(ctx, 9.0, { y: 29.0, z: -66.0, barrels: 2, barrelLen: 28.0, ry: Math.PI });
  placeTurret(ctx, 9.0, { y: 29.0, z: -104.0, barrels: 2, barrelLen: 28.0, ry: Math.PI });
  b.add(chamferBox(26.0, 6.0, 66.0, { chamfer: 2.2, chamferZ: 3.4, taperBack: 0.7, wTop: 21.0 }), {
    y: 25.5, z: -86.0, variant: PLATE.ARMOUR, wear: 0.32,
  });

  // Flak sponsons along the belt, staggered port and starboard.
  const flak = [[1, 96], [-1, 64], [1, 10], [-1, -34], [1, -84], [-1, -120]];
  for (const [s, z] of flak) {
    b.add(chamferBox(7.0, 8.0, 16.0, { chamfer: 1.6, chamferZ: 2.4, taperFront: 0.72 }), {
      mirrorX: s < 0, x: 27.0, y: -1.0, z, variant: PLATE.ARMOUR, wear: 0.45,
    });
    placeTurret(ctx, 3.4, { mirrorX: s < 0, x: 30.5, y: -1.0, z, rz: -Math.PI / 2, barrels: 2, barrelLen: 7.0 });
  }

  // Superstructure aft — tiered, offset to port, with a comms spine.
  const tz = -74;
  b.add(chamferBox(30.0, 14.0, 78.0, { chamfer: 3.0, chamferZ: 4.0, taperFront: 0.8, wTop: 24.0 }), {
    x: -1.5, y: 34.0, z: tz, variant: PLATE.PANEL, wear: 0.26,
  });
  b.add(chamferBox(22.0, 12.0, 52.0, { chamfer: 2.4, chamferZ: 3.4, taperFront: 0.78, wTop: 16.0 }), {
    x: -2.5, y: 45.0, z: tz + 6, variant: PLATE.PANEL, wear: 0.24,
  });
  b.add(chamferBox(14.0, 10.0, 30.0, { chamfer: 1.8, chamferZ: 2.6, taperFront: 0.72, wTop: 10.0 }), {
    x: -2.5, y: 54.5, z: tz + 12, variant: PLATE.PANEL, wear: 0.22,
  });
  b.add(chamferBox(10.0, 3.4, 9.0, { chamfer: 0.9, chamferZ: 1.4, taperFront: 0.6 }), {
    x: -2.5, y: 60.0, z: tz + 24, kind: KIND.GLASS, variant: PLATE.PANEL,
  });
  windows(ctx, 18, 2.1, 0.9, 1.1, { x: -1.5, y: 36.0, z: tz + 39.2 });
  windows(ctx, 14, 2.1, 0.9, 1.1, { x: -2.5, y: 47.0, z: tz + 32.2 });
  windows(ctx, 16, 2.3, 0.8, 1.0, { x: 13.4, y: 36.0, z: tz - 4, ry: -Math.PI / 2 });
  windows(ctx, 16, 2.3, 0.8, 1.0, { x: -16.4, y: 36.0, z: tz - 4, ry: Math.PI / 2 });

  // Drive block: six mouths in two rows, plus heat fins.
  b.add(chamferBox(46.0, 42.0, 16.0, { chamfer: 5.0, chamferZ: 3.0, wTop: 34.0 }), {
    z: -184.0, variant: PLATE.MECH, wear: 0.5,
  });
  for (const [x, y] of [[-15, 7], [0, 8.5], [15, 7], [-15, -8], [0, -9.5], [15, -8]]) {
    thruster(ctx, x, y, -193.0, 7.0);
  }
  b.both((s) => {
    b.addParts(radiator(3.0, 34.0, 1.4, b.lod(8, 5, 0, 0)), {
      mirrorX: s < 0, x: 26.0, y: 20.0, z: -150.0, rz: s * -0.7, variant: PLATE.PANEL, wear: 0.4,
    });
  });

  if (b.detail < 2) {
    b.addParts(mast(rng, 40.0, 1.2, { arms: 5 }), { x: 6.0, y: 40.0, z: tz - 26, rz: -0.08, wear: 0.5 });
    b.addParts(mast(rng, 26.0, 0.9, { arms: 3 }), { x: -9.0, y: 60.0, z: tz + 4, rz: 0.1, wear: 0.5 });
    b.addParts(dish(6.5, { sides: b.lod(16, 12, 8, 6), rows: 4 }), {
      x: 12.0, y: 44.0, z: tz - 14, rx: -0.55, ry: 0.9, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(dish(4.5, { sides: b.lod(14, 10, 8, 6), rows: 3 }), {
      x: -13.5, y: 42.0, z: tz - 8, rx: -0.4, ry: -1.1, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(catwalk(90.0, 5.0, 0.7), { x: 20.0, y: 5.0, z: -20.0, wear: 0.5 });
    b.addParts(catwalk(46.0, 4.2, 0.6), { x: -20.0, y: 5.0, z: 30.0, wear: 0.5 });
    b.addParts(greebleField(rng, {
      x0: -26, x1: 26, z0: -170, z1: 150, y: 25.0, size: g, count: 150,
      width: (z) => hw(z) * 0.8, keep: b.lod(1, 0.35, 0, 0),
    }), {});
    b.both((s) => b.addParts(greebleField(rng, {
      x0: 26, x1: 30, z0: -170, z1: 150, y: -4.0, size: g, count: 70, sink: 0.7,
      width: (z) => hw(z) * 1.06, keep: b.lod(1, 0.35, 0, 0),
    }), { mirrorX: s < 0 }));
    b.addParts(greebleField(rng, {
      x0: -22, x1: 22, z0: -170, z1: 130, y: -25.0, size: g, count: 60, sink: 0.6,
      width: (z) => hw(z) * 0.72, keep: b.lod(1, 0.35, 0, 0),
    }), {});
    b.addParts(greebleField(rng, {
      x0: -13, x1: 10, z0: tz - 30, z1: tz + 34, y: 41.0, size: g * 0.8, count: 60,
      keep: b.lod(1, 0.35, 0, 0),
    }), {});
  }

  // Team livery: belt stripe and a prow chevron.
  b.both((s) => {
    b.add(chamferBox(1.4, 3.2, 150.0, { chamfer: 0.5, chamferZ: 4.0 }), {
      mirrorX: s < 0, x: 30.4, y: -2.0, z: -30.0, team: 1, variant: PLATE.PANEL,
    });
  });
  b.add(chamferBox(16.0, 1.2, 10.0, { chamfer: 0.45, chamferZ: 1.6 }), {
    y: 15.5, z: 130.0, team: 1, variant: PLATE.PANEL,
  });

  navSet(ctx, 31.0, 2.0, -60.0, 2.0, 2.0);
  navSet(ctx, 26.0, 2.0, 60.0, 1.8, 2.0);
  light(ctx, -2.5, 62.5, tz + 12, NAV.beacon, 2.6, 1.8);
  light(ctx, 0, 30.0, 150.0, NAV.deck, 1.2, 1.4);
  light(ctx, 6.0, 81.0, tz - 26, NAV.beacon, 1.7, 1.2);
}

/* cruiser — twin spinal ion mounts, tiered decks, cathedral mass. */
function buildCruiser(ctx) {
  const { b, rng } = ctx;
  const g = greebleSize(620);
  const plan = [
    { z: -308, w: 74, h: 68, n: 0 },
    { z: -300, w: 92, h: 84, n: 20 },
    { z: -240, w: 96, h: 88, n: 24 },
    { z: -232, w: 104, h: 94, n: 28 },
    { z: -40, w: 104, h: 94, n: 28 },
    { z: 40, w: 100, h: 90, n: 26 },
    { z: 48, w: 84, h: 78, n: 20 },
    { z: 150, w: 80, h: 74, n: 18 },
    { z: 158, w: 62, h: 60, n: 12 },
    { z: 226, w: 56, h: 56, n: 9 },
    { z: 234, w: 40, h: 42, n: 0 },
    { z: 282, w: 34, h: 38, n: 0 },
    { z: 292, w: 22, h: 26, n: 0 },
  ];
  const hw = planWidth(plan);
  b.add(loft(decimateStations(plan.map((p) => ({
    z: p.z,
    pts: trenchSection(p.w, p.h, {
      wTop: p.w * 0.8, wBot: p.w, chamfer: p.h * 0.13, chamferNotch: p.h * 0.03,
      notchW: p.n, notchDepth: p.h * 0.22, cy: -6,
    }),
  })), b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });
  armourBelt(ctx, plan.slice(0, 11), { out: 2.6, top: 4.0, bottom: -14.0, chamfer: 5.0 });
  armourBelt(ctx, plan.slice(0, 10), { out: 5.0, top: -16.0, bottom: -32.0, chamfer: 4.0, tumble: 1.0 });
  // Blunt armoured prow block.
  b.add(chamferBox(40.0, 44.0, 76.0, { chamfer: 7.0, chamferZ: 13.0, taperFront: 0.56, wTop: 24.0 }), {
    y: -6.0, z: 268.0, variant: PLATE.ARMOUR, wear: 0.6,
  });

  // Twin spinal ion mounts, canted outward, reaching 45 m past the prow.
  const sides = b.lod(14, 12, 8, 6);
  b.both((s) => {
    const barrel = [
      { z: -80, r: 9.0 },
      { z: -50, r: 11.5 },
      { z: 120, r: 11.0 },
      { z: 280, r: 12.0 },
      { z: 322, r: 12.6 },
      { z: 330, r: 11.0 },
    ];
    b.add(loft(decimateStations(barrel.map((p) => ({ z: p.z, pts: ngonSection(p.r, sides) })), b.lod(1, 1, 2, 2)), {}), {
      mirrorX: s < 0, x: 25.0, y: 12.0, ry: s * -0.012, variant: PLATE.MECH, wear: 0.45,
    });
    const coils = b.lod(11, 7, 3, 0);
    for (let i = 0; i < coils; i++) {
      const t = i / Math.max(1, coils - 1);
      b.add(ring(11.6, 15.5 - t * 2.0, 3.0 + (1 - t) * 1.6, sides), {
        mirrorX: s < 0, x: 25.0, y: 12.0, z: -40 + t * 340,
        variant: PLATE.MECH, wear: 0.4 + t * 0.3,
      });
    }
    b.addParts(pocket(15.0, 15.0, 9.0, { chamfer: 3.0, taper: 0.55, lit: true, variant: PLATE.MECH }), {
      mirrorX: s < 0, x: 25.0, y: 12.0, z: 330, ry: Math.PI, wear: 0.9,
    });
    hp(ctx, s * 25.0, 12.0, 332.0);
    // Buttress tying each barrel back into the hull — cathedral, not sci-fi tube.
    for (let i = 0; i < b.lod(4, 3, 2, 0); i++) {
      const z = -20 + i * 62;
      b.add(chamferBox(3.6, 26.0, 12.0, { chamfer: 1.2, chamferZ: 2.0, wTop: 2.2 }), {
        mirrorX: s < 0, x: 25.0, y: -2.0, z, rz: s * 0.12, variant: PLATE.PANEL, wear: 0.4,
      });
    }
  });

  // Cathedral: four terraces stepping up toward the stern.
  const tiers = [
    { y: 46, w: 66, h: 24, d: 260, z: -70, wt: 52 },
    { y: 66, w: 52, h: 20, d: 200, z: -96, wt: 40 },
    { y: 84, w: 38, h: 18, d: 140, z: -118, wt: 28 },
    { y: 100, w: 24, h: 16, d: 84, z: -136, wt: 17 },
  ];
  for (const t of tiers) {
    b.add(chamferBox(t.w, t.h, t.d, {
      chamfer: t.h * 0.2, chamferZ: t.h * 0.34, taperFront: 0.74, taperBack: 0.9, wTop: t.wt,
    }), { x: -2.0, y: t.y, z: t.z, variant: PLATE.PANEL, wear: 0.24 });
    windows(ctx, Math.round(t.d / 12), 12.0, 3.4, 2.6, {
      x: -2.0, y: t.y + t.h * 0.1, z: t.z + t.d * 0.5 + 0.4,
    });
    b.both((s) => windows(ctx, Math.round(t.d / 14), 14.0, 3.0, 2.4, {
      mirrorX: s < 0, x: t.wt * 0.5 + 0.5, y: t.y + t.h * 0.1, z: t.z, ry: -Math.PI / 2,
    }));
  }
  b.add(chamferBox(16.0, 5.0, 14.0, { chamfer: 1.4, chamferZ: 2.2, taperFront: 0.6 }), {
    x: -2.0, y: 110.0, z: -100.0, kind: KIND.GLASS, variant: PLATE.PANEL,
  });

  // Flying buttresses off the flanks into the lower terrace.
  b.both((s) => {
    for (let i = 0; i < b.lod(5, 3, 0, 0); i++) {
      const z = -180 + i * 58;
      b.add(chamferBox(4.0, 46.0, 14.0, { chamfer: 1.4, chamferZ: 2.4, wTop: 2.5, wBot: 5.5 }), {
        mirrorX: s < 0, x: 40.0, y: 22.0, z, rz: s * 0.22, variant: PLATE.PANEL, wear: 0.38,
      });
    }
  });

  placeTurret(ctx, 15.0, { y: 40.0, z: 150.0, barrels: 2, barrelLen: 46.0 });
  placeTurret(ctx, 15.0, { y: 44.0, z: 96.0, barrels: 2, barrelLen: 46.0 });
  placeTurret(ctx, 14.0, { y: 40.0, z: -206.0, barrels: 2, barrelLen: 42.0, ry: Math.PI });
  placeTurret(ctx, 14.0, { y: 44.0, z: -252.0, barrels: 2, barrelLen: 42.0, ry: Math.PI });
  const flak = [[1, 170], [-1, 120], [1, 40], [-1, -30], [1, -140], [-1, -220]];
  for (const [s, z] of flak) {
    b.add(chamferBox(10.0, 12.0, 26.0, { chamfer: 2.4, chamferZ: 4.0, taperFront: 0.72 }), {
      mirrorX: s < 0, x: 46.0, y: -4.0, z, variant: PLATE.ARMOUR, wear: 0.45,
    });
    placeTurret(ctx, 5.0, { mirrorX: s < 0, x: 51.0, y: -4.0, z, rz: -Math.PI / 2, barrels: 2, barrelLen: 11.0 });
  }

  // Drive block: eight mouths, two rows, framed by heat towers.
  b.add(chamferBox(76.0, 68.0, 26.0, { chamfer: 8.0, chamferZ: 5.0, wTop: 56.0 }), {
    y: -6, z: -300.0, variant: PLATE.MECH, wear: 0.5,
  });
  for (const [x, y] of [[-30, 12], [-10, 14], [10, 14], [30, 12], [-30, -14], [-10, -16], [10, -16], [30, -14]]) {
    thruster(ctx, x, y - 6, -314.0, 9.0);
  }
  b.both((s) => {
    b.addParts(radiator(5.0, 66.0, 2.2, b.lod(10, 6, 0, 0)), {
      mirrorX: s < 0, x: 44.0, y: 40.0, z: -250.0, rz: s * -0.75, variant: PLATE.PANEL, wear: 0.4,
    });
  });

  if (b.detail < 2) {
    b.addParts(mast(rng, 62.0, 1.9, { arms: 5 }), { x: 9.0, y: 108.0, z: -150.0, rz: -0.07, wear: 0.5 });
    b.addParts(mast(rng, 40.0, 1.4, { arms: 4 }), { x: -13.0, y: 92.0, z: -60.0, rz: 0.1, wear: 0.5 });
    b.addParts(dish(11.0, { sides: b.lod(16, 12, 8, 6), rows: 4 }), {
      x: 20.0, y: 78.0, z: -172.0, rx: -0.5, ry: 0.9, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(dish(8.0, { sides: b.lod(14, 10, 8, 6), rows: 3 }), {
      x: -22.0, y: 74.0, z: -140.0, rx: -0.35, ry: -1.0, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(catwalk(200.0, 8.0, 1.1), { x: 34.0, y: 8.0, z: -40.0, wear: 0.5 });
    b.addParts(catwalk(120.0, 7.0, 1.0), { x: -34.0, y: 8.0, z: 60.0, wear: 0.5 });
    b.addParts(greebleField(rng, {
      x0: -44, x1: 44, z0: -290, z1: 250, y: 36.0, size: g, count: 220,
      width: (z) => hw(z) * 0.78, keep: b.lod(1, 0.35, 0, 0),
    }), {});
    b.both((s) => b.addParts(greebleField(rng, {
      x0: 44, x1: 50, z0: -290, z1: 250, y: -8.0, size: g, count: 110, sink: 0.7,
      width: (z) => hw(z) * 1.06, keep: b.lod(1, 0.35, 0, 0),
    }), { mirrorX: s < 0 }));
    b.addParts(greebleField(rng, {
      x0: -38, x1: 38, z0: -290, z1: 220, y: -42.0, size: g, count: 90, sink: 0.6,
      width: (z) => hw(z) * 0.7, keep: b.lod(1, 0.35, 0, 0),
    }), {});
    for (const t of tiers) {
      b.addParts(greebleField(rng, {
        x0: -t.wt * 0.42, x1: t.wt * 0.42, z0: t.z - t.d * 0.44, z1: t.z + t.d * 0.44,
        y: t.y + t.h * 0.5, size: g * 0.7, count: 60, keep: b.lod(1, 0.35, 0, 0),
      }), {});
    }
  }

  b.both((s) => {
    b.add(chamferBox(2.4, 5.0, 240.0, { chamfer: 0.8, chamferZ: 6.0 }), {
      mirrorX: s < 0, x: 50.5, y: -6.0, z: -50.0, team: 1, variant: PLATE.PANEL,
    });
  });
  b.add(chamferBox(26.0, 2.0, 18.0, { chamfer: 0.7, chamferZ: 2.6 }), {
    y: 22.0, z: 208.0, team: 1, variant: PLATE.PANEL,
  });

  navSet(ctx, 52.0, 2.0, -100.0, 3.2, 2.1);
  navSet(ctx, 44.0, 2.0, 100.0, 3.0, 2.1);
  light(ctx, -2.0, 113.0, -100.0, NAV.beacon, 2.7, 3.0);
  light(ctx, 9.0, 172.0, -150.0, NAV.beacon, 1.6, 2.4);
  light(ctx, 0, 40.0, 240.0, NAV.deck, 1.2, 2.2);
}

/* ========================================================= economy & base */

/* collector — industrial, ore hopper, mining arm, exposed machinery. */
function buildCollector(ctx) {
  const { b, rng } = ctx;
  const g = greebleSize(46);
  const plan = [
    { z: -22, w: 9.0, h: 8.5 },
    { z: -17, w: 11.5, h: 10.5 },
    { z: -2, w: 12.0, h: 11.0 },
    { z: 9, w: 10.5, h: 9.5 },
    { z: 15, w: 7.0, h: 7.0 },
  ];
  b.add(loft(decimateStations(plan.map((p) => ({
    z: p.z,
    pts: rectSection(p.w, p.h, { wTop: p.w * 0.9, wBot: p.w * 0.86, chamfer: p.h * 0.14, cy: -1.0 }),
  })), b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });

  // Ore hopper: an open box with ribbed walls sunk into the dorsal deck.
  b.addParts(pocket(9.0, 17.0, 6.4, { chamfer: 0.9, taper: 0.7, variant: PLATE.MECH }), {
    y: 6.0, z: -3.0, rx: Math.PI / 2, wear: 0.75,
  });
  b.add(loft([
    { z: -12.0, pts: rectSection(10.4, 7.6, { chamfer: 0.7, cy: 2.6 }) },
    { z: 6.0, pts: rectSection(10.4, 7.6, { chamfer: 0.7, cy: 2.6 }) },
  ], { capStart: false, capEnd: false }), { variant: PLATE.MECH, wear: 0.6 });
  b.both((s) => b.addParts(ribBand(b.lod(6, 4, 2, 0), -11.0, 5.0, 1.0, 8.0, 0.5, { variant: PLATE.MECH }), {
    mirrorX: s < 0, x: 5.4, y: 2.6,
  }));

  // Mining arm: three segments and a toothed cutter head.
  const armRoot = { x: -1.6, y: -1.6, z: 12.0 };
  b.add(chamferBox(3.0, 2.6, 9.0, { chamfer: 0.6, chamferZ: 0.9, taperFront: 0.8 }), {
    x: armRoot.x, y: armRoot.y, z: armRoot.z + 3.5, ry: 0.12, variant: PLATE.MECH, wear: 0.6,
  });
  b.add(chamferBox(2.4, 2.2, 8.0, { chamfer: 0.5, chamferZ: 0.8, taperFront: 0.85 }), {
    x: armRoot.x - 1.4, y: armRoot.y + 0.9, z: armRoot.z + 11.0, ry: 0.2, rx: -0.14,
    variant: PLATE.MECH, wear: 0.7,
  });
  const head = { x: armRoot.x - 3.1, y: armRoot.y + 2.1, z: armRoot.z + 15.4 };
  b.add(tube(3.2, 3.6, 2.6, b.lod(12, 10, 8, 6), { rot: Math.PI / 12 }), {
    x: head.x, y: head.y, z: head.z, variant: PLATE.MECH, wear: 0.95,
  });
  const teeth = b.lod(10, 8, 0, 0);
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    b.add(chamferBox(0.6, 0.6, 1.5, { chamfer: 0.18, chamferZ: 0.4, taperFront: 0.25 }), {
      x: head.x + Math.cos(a) * 3.2, y: head.y + Math.sin(a) * 3.2, z: head.z + 2.6,
      variant: PLATE.MECH, wear: 1.0,
    });
  }
  light(ctx, head.x, head.y, head.z + 2.0, NAV.deck, 0.5, 0.3);

  // Exposed machinery: tanks and pipe runs down the flanks.
  b.both((s) => {
    b.add(tube(1.5, 1.5, 14.0, b.lod(10, 8, 6, 5), { rot: Math.PI / 10 }), {
      mirrorX: s < 0, x: 6.4, y: -3.0, z: -6.0, variant: PLATE.MECH, wear: 0.6,
    });
    for (let i = 0; i < b.lod(3, 2, 0, 0); i++) {
      b.add(tube(1.1, 1.1, 3.6, b.lod(10, 8, 6, 5), { rot: Math.PI / 10 }), {
        mirrorX: s < 0, x: 6.6, y: 1.8, z: -14 + i * 5.2, rz: Math.PI / 2,
        variant: PLATE.MECH, wear: 0.65,
      });
    }
    b.add(chamferBox(0.5, 0.9, 9.0, { chamfer: 0.16, chamferZ: 0.7 }), {
      mirrorX: s < 0, x: 6.1, y: -6.0, z: -4.0, team: 1, variant: PLATE.PANEL,
    });
  });

  // Cab, high and to port, with a wraparound screen.
  b.add(chamferBox(4.2, 3.0, 4.6, { chamfer: 0.6, chamferZ: 0.9, taperFront: 0.7, wTop: 3.0 }), {
    x: -3.0, y: 6.6, z: 6.6, variant: PLATE.PANEL, wear: 0.35,
  });
  b.add(chamferBox(3.0, 1.4, 1.6, { chamfer: 0.3, taperFront: 0.6 }), {
    x: -3.0, y: 7.2, z: 8.6, kind: KIND.GLASS, variant: PLATE.PANEL,
  });

  b.add(chamferBox(10.0, 9.0, 3.0, { chamfer: 1.2, chamferZ: 0.6, wTop: 8.0 }), {
    y: -1.0, z: -21.5, variant: PLATE.MECH, wear: 0.6,
  });
  b.both((s) => thruster(ctx, s * 2.8, -0.6, -23.5, 2.1));

  if (b.detail < 2) {
    b.addParts(mast(rng, 4.0, 0.16, { arms: 2 }), { x: 3.4, y: 5.4, z: -12.0, rz: -0.2, wear: 0.5 });
    b.addParts(greebleField(rng, {
      x0: -5.0, x1: 5.0, z0: -20, z1: 12, y: -6.4, size: g, count: 22, sink: 0.6,
      keep: b.lod(1, 0.4, 0, 0),
    }), {});
    b.addParts(greebleField(rng, {
      x0: -5.6, x1: 5.6, z0: -20, z1: -13, y: 4.0, size: g, count: 12, keep: b.lod(1, 0.4, 0, 0),
    }), {});
  }

  ctx.dock.push(new THREE.Vector3(0, 5.0, -3.0));
  navSet(ctx, 6.4, 2.4, -14.0, 0.3, 1.6);
  light(ctx, -3.0, 8.4, 6.6, NAV.beacon, 2.0, 0.26);
}

/* carrier — flight decks with lit hangar mouths, control tower, launch rails. */
function buildCarrier(ctx) {
  const { b, rng } = ctx;
  const g = greebleSize(760);
  const plan = [
    { z: -380, w: 88, h: 58, n: 0 },
    { z: -370, w: 108, h: 66, n: 26 },
    { z: -300, w: 116, h: 70, n: 34 },
    { z: -290, w: 128, h: 76, n: 42 },
    { z: -20, w: 128, h: 76, n: 42 },
    { z: 120, w: 122, h: 72, n: 38 },
    { z: 130, w: 100, h: 64, n: 28 },
    { z: 250, w: 94, h: 60, n: 24 },
    { z: 260, w: 70, h: 50, n: 14 },
    { z: 340, w: 62, h: 46, n: 8 },
    { z: 350, w: 42, h: 34, n: 0 },
    { z: 380, w: 30, h: 28, n: 0 },
  ];
  const hw = planWidth(plan);
  b.add(loft(decimateStations(plan.map((p) => ({
    z: p.z,
    pts: trenchSection(p.w, p.h, {
      wTop: p.w * 0.86, wBot: p.w, chamfer: p.h * 0.18, chamferNotch: p.h * 0.05,
      notchW: p.n, notchDepth: p.h * 0.26, cy: -2,
    }),
  })), b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });
  armourBelt(ctx, plan.slice(0, 10), { out: 2.0, top: -4.0, bottom: -22.0, chamfer: 4.0, tumble: 1.0 });
  b.add(chamferBox(46.0, 34.0, 90.0, { chamfer: 7.0, chamferZ: 15.0, taperFront: 0.55, wTop: 28.0 }), {
    y: -2.0, z: 356.0, variant: PLATE.ARMOUR, wear: 0.6,
  });

  // Flight decks: two vast lit mouths sunk into the flanks, port set further
  // forward than starboard so the ship never reads as a mirrored slab.
  const bays = [{ s: 1, z: -40 }, { s: -1, z: 50 }];
  for (const bay of bays) {
    b.addParts(pocket(170.0, 40.0, 34.0, { chamfer: 6.0, taper: 0.86, lit: true, variant: PLATE.MECH }), {
      mirrorX: bay.s < 0, x: 65.0, y: 4.0, z: bay.z, ry: -Math.PI / 2, wear: 0.5,
    });
    // Deck lip and roof overhang — the frame is what makes a hole read as a
    // hangar rather than as a dark patch of hull.
    b.add(chamferBox(16.0, 12.0, 186.0, { chamfer: 2.6, chamferZ: 9.0, taperFront: 0.9 }), {
      mirrorX: bay.s < 0, x: 64.0, y: -22.0, z: bay.z, variant: PLATE.ARMOUR, wear: 0.55,
    });
    b.add(chamferBox(18.0, 13.0, 190.0, { chamfer: 3.0, chamferZ: 10.0, taperFront: 0.9 }), {
      mirrorX: bay.s < 0, x: 64.0, y: 30.0, z: bay.z, variant: PLATE.ARMOUR, wear: 0.35,
    });
    // Launch rails running forward out of the mouth, open truss.
    for (const dy of [-8, 14]) {
      b.add(chamferBox(4.0, 3.2, 110.0, { chamfer: 1.2, chamferZ: 4.0, taperFront: 0.45 }), {
        mirrorX: bay.s < 0, x: 68.0, y: dy, z: bay.z + 148.0, variant: PLATE.MECH, wear: 0.65,
      });
    }
    b.addParts(ribBand(b.lod(10, 6, 3, 0), bay.z + 100, bay.z + 198, 7.0, 28.0, 1.8, { variant: PLATE.MECH, y: 3.0 }), {
      mirrorX: bay.s < 0, x: 68.0,
    });
    windows(ctx, 20, 7.4, 2.2, 1.4, {
      mirrorX: bay.s < 0, x: 69.0, y: 26.0, z: bay.z, ry: -Math.PI / 2, skip: 5,
    });
    light(ctx, bay.s * 70.0, 28.0, bay.z + 84.0, NAV.hangar, 0.7, 2.0);
    light(ctx, bay.s * 70.0, 28.0, bay.z - 84.0, NAV.hangar, 0.7, 2.0);
    ctx.dock.push(new THREE.Vector3(bay.s * 84.0, 4.0, bay.z));
  }

  // Control tower, starboard side, well aft.
  const tx = 40;
  const tz = -150;
  b.add(chamferBox(40.0, 26.0, 96.0, { chamfer: 4.0, chamferZ: 6.0, taperFront: 0.82, wTop: 32.0 }), {
    x: tx, y: 44.0, z: tz, variant: PLATE.PANEL, wear: 0.26,
  });
  b.add(chamferBox(30.0, 24.0, 64.0, { chamfer: 3.2, chamferZ: 5.0, taperFront: 0.78, wTop: 22.0 }), {
    x: tx, y: 66.0, z: tz + 8, variant: PLATE.PANEL, wear: 0.24,
  });
  b.add(chamferBox(20.0, 20.0, 38.0, { chamfer: 2.4, chamferZ: 3.6, taperFront: 0.72, wTop: 14.0 }), {
    x: tx, y: 86.0, z: tz + 14, variant: PLATE.PANEL, wear: 0.22,
  });
  b.add(chamferBox(15.0, 6.0, 13.0, { chamfer: 1.4, chamferZ: 2.2, taperFront: 0.6 }), {
    x: tx, y: 96.0, z: tz + 30, kind: KIND.GLASS, variant: PLATE.PANEL,
  });
  windows(ctx, 12, 3.2, 1.4, 1.6, { x: tx, y: 48.0, z: tz + 48.4 });
  windows(ctx, 10, 3.2, 1.4, 1.6, { x: tx, y: 70.0, z: tz + 40.4 });
  windows(ctx, 16, 3.6, 1.3, 1.5, { x: tx + 20.2, y: 48.0, z: tz, ry: -Math.PI / 2 });
  windows(ctx, 16, 3.6, 1.3, 1.5, { x: tx - 20.2, y: 48.0, z: tz, ry: Math.PI / 2 });

  // Dorsal spine structures — production gantries down the trench.
  b.addParts(ribBand(b.lod(12, 7, 4, 0), -300, 240, 46.0, 8.0, 3.0, { variant: PLATE.MECH, y: 30.0 }), {});
  b.add(chamferBox(30.0, 10.0, 300.0, { chamfer: 3.0, chamferZ: 8.0, taperFront: 0.8 }), {
    x: -22.0, y: 34.0, z: -20.0, variant: PLATE.PANEL, wear: 0.3,
  });
  windows(ctx, 30, 9.0, 2.4, 1.8, { x: -22.0, y: 36.0, z: 130.4, skip: 6 });

  const flak = [[1, 250], [-1, 190], [-1, -120], [1, -250], [-1, -300], [1, 120]];
  for (const [s, z] of flak) {
    b.add(chamferBox(12.0, 14.0, 30.0, { chamfer: 2.6, chamferZ: 4.4, taperFront: 0.72 }), {
      mirrorX: s < 0, x: 54.0, y: -18.0, z, variant: PLATE.ARMOUR, wear: 0.45,
    });
    placeTurret(ctx, 5.5, { mirrorX: s < 0, x: 60.0, y: -18.0, z, rz: -Math.PI / 2, barrels: 2, barrelLen: 12.0 });
  }

  // Drive block: six mouths and a heat rack.
  b.add(chamferBox(88.0, 58.0, 30.0, { chamfer: 9.0, chamferZ: 6.0, wTop: 66.0 }), {
    y: -4, z: -364.0, variant: PLATE.MECH, wear: 0.5,
  });
  for (const [x, y] of [[-32, 8], [0, 10], [32, 8], [-32, -14], [0, -16], [32, -14]]) {
    thruster(ctx, x, y - 4, -380.0, 12.0);
  }
  b.both((s) => {
    b.addParts(radiator(6.0, 74.0, 2.6, b.lod(10, 6, 0, 0)), {
      mirrorX: s < 0, x: 52.0, y: 46.0, z: -300.0, rz: s * -0.8, variant: PLATE.PANEL, wear: 0.4,
    });
  });

  if (b.detail < 2) {
    b.addParts(mast(rng, 70.0, 2.0, { arms: 5 }), { x: tx + 12, y: 96.0, z: tz - 26, rz: -0.06, wear: 0.5 });
    b.addParts(dish(13.0, { sides: b.lod(16, 12, 8, 6), rows: 4 }), {
      x: tx - 22, y: 78.0, z: tz - 20, rx: -0.5, ry: -1.0, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(dish(9.0, { sides: b.lod(14, 10, 8, 6), rows: 3 }), {
      x: -46.0, y: 40.0, z: -230.0, rx: -0.4, ry: -1.3, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(catwalk(260.0, 9.0, 1.2), { x: 30.0, y: 26.0, z: 60.0, wear: 0.5 });
    b.addParts(catwalk(180.0, 8.0, 1.1), { x: -44.0, y: 24.0, z: -80.0, wear: 0.5 });
    b.addParts(greebleField(rng, {
      x0: -56, x1: 56, z0: -350, z1: 330, y: 32.0, size: g, count: 260,
      width: (z) => hw(z) * 0.76, keep: b.lod(1, 0.35, 0, 0),
    }), {});
    b.both((s) => b.addParts(greebleField(rng, {
      x0: 52, x1: 62, z0: -350, z1: 330, y: -30.0, size: g, count: 120, sink: 0.7,
      width: (z) => hw(z) * 1.02, keep: b.lod(1, 0.35, 0, 0),
    }), { mirrorX: s < 0 }));
    b.addParts(greebleField(rng, {
      x0: -48, x1: 48, z0: -350, z1: 300, y: -40.0, size: g, count: 110, sink: 0.6,
      width: (z) => hw(z) * 0.7, keep: b.lod(1, 0.35, 0, 0),
    }), {});
    b.addParts(greebleField(rng, {
      x0: tx - 16, x1: tx + 16, z0: tz - 44, z1: tz + 44, y: 58.0, size: g * 0.7, count: 70,
      keep: b.lod(1, 0.35, 0, 0),
    }), {});
  }

  b.both((s) => {
    b.add(chamferBox(3.0, 6.0, 300.0, { chamfer: 1.0, chamferZ: 7.0 }), {
      mirrorX: s < 0, x: 59.0, y: -30.0, z: -40.0, team: 1, variant: PLATE.PANEL,
    });
  });
  b.add(chamferBox(34.0, 2.4, 22.0, { chamfer: 0.8, chamferZ: 3.0 }), {
    y: 22.0, z: 300.0, team: 1, variant: PLATE.PANEL,
  });

  navSet(ctx, 61.0, -28.0, -160.0, 3.4, 2.2);
  navSet(ctx, 52.0, -24.0, 200.0, 3.2, 2.2);
  light(ctx, tx, 100.0, tz + 14, NAV.beacon, 2.8, 3.2);
  light(ctx, 0, 38.0, 330.0, NAV.deck, 1.2, 2.6);
}

/* mothership — everything you have. A city with engines. */
function buildMothership(ctx) {
  const { b, rng } = ctx;
  const g = greebleSize(1900);

  // Keel: a deep, narrow spine that runs the whole length and carries every
  // other mass. Read it as the hull the city was built on.
  const keel = [
    { z: -950, w: 190, h: 220, n: 0 },
    { z: -936, w: 236, h: 262, n: 44 },
    { z: -820, w: 250, h: 276, n: 60 },
    { z: -806, w: 274, h: 300, n: 74 },
    { z: -180, w: 280, h: 306, n: 78 },
    { z: 180, w: 274, h: 298, n: 74 },
    { z: 194, w: 236, h: 266, n: 58 },
    { z: 480, w: 226, h: 256, n: 52 },
    { z: 494, w: 184, h: 218, n: 36 },
    { z: 700, w: 172, h: 206, n: 28 },
    { z: 714, w: 126, h: 162, n: 0 },
    { z: 880, w: 112, h: 148, n: 0 },
    { z: 894, w: 74, h: 104, n: 0 },
    { z: 950, w: 58, h: 86, n: 0 },
  ];
  const hw = planWidth(keel);
  b.add(loft(decimateStations(keel.map((p) => ({
    z: p.z,
    pts: trenchSection(p.w, p.h, {
      wTop: p.w * 0.86, wBot: p.w, chamfer: p.h * 0.11, chamferNotch: p.h * 0.03,
      notchW: p.n, notchDepth: p.h * 0.16, cy: -20,
    }),
  })), b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });
  armourBelt(ctx, keel.slice(0, 12), { out: 6.0, top: 10.0, bottom: -40.0, chamfer: 14.0 });
  armourBelt(ctx, keel.slice(0, 11), { out: 12.0, top: -50.0, bottom: -110.0, chamfer: 11.0, tumble: 1.0 });

  // Terraced plate layers: five decks stepping up and aft, each narrower than
  // the one below, each with its own window band.
  const decks = [
    { y: 132, w: 200, h: 56, d: 1080, z: -120, wt: 168 },
    { y: 184, w: 172, h: 50, d: 900, z: -190, wt: 138 },
    { y: 232, w: 140, h: 46, d: 720, z: -250, wt: 110 },
    { y: 276, w: 106, h: 42, d: 540, z: -300, wt: 80 },
    { y: 316, w: 70, h: 38, d: 340, z: -340, wt: 50 },
  ];
  for (let i = 0; i < decks.length; i++) {
    const t = decks[i];
    b.add(chamferBox(t.w, t.h, t.d, {
      chamfer: t.h * 0.2, chamferZ: t.h * 0.5, taperFront: 0.7, taperBack: 0.86, wTop: t.wt,
    }), { x: -6.0, y: t.y, z: t.z, variant: PLATE.PANEL, wear: 0.22 });
    // Window bands: forward face, and long runs down each flank.
    windows(ctx, Math.round(t.d / 26), 26.0, 7.0, 5.0, {
      x: -6.0, y: t.y + t.h * 0.06, z: t.z + t.d * 0.5 + 0.6,
    });
    for (const row of [-0.22, 0.06, 0.3]) {
      b.both((s) => windows(ctx, Math.round(t.d / 22), 22.0, 6.0, 4.0, {
        mirrorX: s < 0, x: t.wt * 0.5 + 0.8, y: t.y + t.h * row, z: t.z, ry: -Math.PI / 2, skip: 7,
      }));
    }
    // Structural ribs across each terrace roof.
    b.addParts(ribBand(b.lod(9, 5, 3, 0), t.z - t.d * 0.42, t.z + t.d * 0.42, t.wt * 1.02, 10.0, 5.0, {
      variant: PLATE.MECH, y: t.y + t.h * 0.5,
    }), { x: -6.0 });
  }
  b.add(chamferBox(46.0, 14.0, 40.0, { chamfer: 4.0, chamferZ: 6.0, taperFront: 0.6 }), {
    x: -6.0, y: 340.0, z: -220.0, kind: KIND.GLASS, variant: PLATE.PANEL,
  });

  // Flank window cities on the keel itself — the sense of scale lives here.
  for (const row of [-70, -20, 40]) {
    b.both((s) => windows(ctx, 44, 32.0, 8.0, 4.5, {
      mirrorX: s < 0, x: 118.0, y: row, z: -60.0, ry: -Math.PI / 2, skip: 6,
    }));
  }

  // Forward docking arms. The port arm reaches further — this hull has been
  // rebuilt around whatever it lost.
  const armSpecs = [
    { s: 1, len: 468, out: 126, y: 34, z: 400, yaw: 0.085 },
    { s: -1, len: 536, out: 142, y: 18, z: 386, yaw: 0.095 },
  ];
  for (const a of armSpecs) {
    // The arms toe inward, so the pair closes on the centreline like a claw.
    const place = { mirrorX: a.s < 0, x: a.out, y: a.y, z: a.z, ry: -a.yaw };
    const along = (t) => ({
      x: a.out - Math.sin(a.yaw) * a.len * t,
      z: a.z + Math.cos(a.yaw) * a.len * t,
    });
    const stations = [
      { z: 0, w: 78, h: 96 },
      { z: a.len * 0.22, w: 68, h: 82 },
      { z: a.len * 0.62, w: 54, h: 64 },
      { z: a.len * 0.88, w: 42, h: 52 },
      { z: a.len, w: 28, h: 36 },
    ];
    b.add(loft(decimateStations(stations.map((p) => ({
      z: p.z,
      pts: rectSection(p.w, p.h, { wTop: p.w * 0.7, wBot: p.w * 0.92, chamfer: p.h * 0.16 }),
    })), b.lod(1, 1, 2, 3)), {}), { ...place, variant: PLATE.ARMOUR, wear: 0.35 });
    b.addParts(ribBand(b.lod(9, 6, 3, 0), 30, a.len - 40, 92.0, 104.0, 8.0, { variant: PLATE.MECH }), place);
    b.addParts(catwalk(a.len * 0.7, 12.0, 1.8, { z0: a.len * 0.5 }), {
      ...place, y: a.y + 50, wear: 0.5,
    });

    // Clamp head: a lit docking throat facing inboard, at the arm's tip.
    const tip = along(0.94);
    b.addParts(pocket(50.0, 50.0, 24.0, { chamfer: 6.0, taper: 0.7, lit: true, variant: PLATE.MECH }), {
      mirrorX: a.s < 0, x: tip.x - 16, y: a.y + 4, z: tip.z, ry: Math.PI / 2, wear: 0.6,
    });
    b.add(chamferBox(46.0, 62.0, 62.0, { chamfer: 9.0, chamferZ: 12.0, wTop: 30.0 }), {
      mirrorX: a.s < 0, x: tip.x + 8, y: a.y + 4, z: tip.z, variant: PLATE.ARMOUR, wear: 0.5,
    });
    ctx.dock.push(new THREE.Vector3(a.s * (tip.x - 34), a.y + 4, tip.z));
    light(ctx, a.s * (tip.x - 20), a.y + 34, tip.z, NAV.hangar, 0.9, 6.0);

    const mid = along(0.5);
    b.add(chamferBox(6.0, 14.0, a.len * 0.66, { chamfer: 2.0, chamferZ: 16.0 }), {
      mirrorX: a.s < 0, x: mid.x + 42, y: a.y - 40, z: mid.z, ry: -a.yaw,
      team: 1, variant: PLATE.PANEL,
    });
  }

  // Hangar mouths: four sunk bays with lit throats, staggered along the flanks.
  const bays = [{ s: 1, z: 240 }, { s: -1, z: 60 }, { s: 1, z: -300 }, { s: -1, z: -460 }];
  for (const bay of bays) {
    b.addParts(pocket(170.0, 66.0, 52.0, { chamfer: 9.0, taper: 0.86, lit: true, variant: PLATE.MECH }), {
      mirrorX: bay.s < 0, x: 116.0, y: -6.0, z: bay.z, ry: -Math.PI / 2, wear: 0.5,
    });
    b.add(chamferBox(18.0, 12.0, 186.0, { chamfer: 4.0, chamferZ: 14.0, taperFront: 0.9 }), {
      mirrorX: bay.s < 0, x: 120.0, y: -44.0, z: bay.z, variant: PLATE.ARMOUR, wear: 0.55,
    });
    b.add(chamferBox(20.0, 14.0, 192.0, { chamfer: 4.0, chamferZ: 16.0, taperFront: 0.9 }), {
      mirrorX: bay.s < 0, x: 120.0, y: 34.0, z: bay.z, variant: PLATE.ARMOUR, wear: 0.35,
    });
    windows(ctx, 20, 8.5, 3.0, 2.2, { mirrorX: bay.s < 0, x: 125.0, y: 28.0, z: bay.z, ry: -Math.PI / 2, skip: 5 });
    ctx.dock.push(new THREE.Vector3(bay.s * 140.0, -6.0, bay.z));
    light(ctx, bay.s * 124.0, 32.0, bay.z + 84.0, NAV.hangar, 0.8, 4.5);
    light(ctx, bay.s * 124.0, 32.0, bay.z - 84.0, NAV.hangar, 0.8, 4.5);
  }

  // Prow: an armoured wedge with a sensor crown, well forward of the decks.
  b.add(chamferBox(76.0, 66.0, 240.0, { chamfer: 12.0, chamferZ: 26.0, taperFront: 0.22, wTop: 44.0 }), {
    y: -6.0, z: 800.0, variant: PLATE.ARMOUR, wear: 0.55,
  });
  b.addParts(ribBand(b.lod(7, 4, 2, 0), 700, 880, 96.0, 90.0, 8.0, { variant: PLATE.ARMOUR, y: -6.0 }), {});

  // Bastion batteries — six mains on the terraces, ten flak on the belt.
  placeTurret(ctx, 28.0, { y: 176.0, z: 400.0, barrels: 2, barrelLen: 86.0 });
  placeTurret(ctx, 28.0, { x: -74.0, y: 176.0, z: 250.0, barrels: 2, barrelLen: 86.0 });
  placeTurret(ctx, 28.0, { x: 78.0, y: 176.0, z: 180.0, barrels: 2, barrelLen: 86.0 });
  placeTurret(ctx, 26.0, { y: 226.0, z: -560.0, barrels: 2, barrelLen: 80.0, ry: Math.PI });
  placeTurret(ctx, 26.0, { x: -66.0, y: 226.0, z: -440.0, barrels: 2, barrelLen: 80.0, ry: Math.PI });
  placeTurret(ctx, 26.0, { x: 70.0, y: 226.0, z: -380.0, barrels: 2, barrelLen: 80.0, ry: Math.PI });
  const flak = [[1, 700], [-1, 640], [1, 470], [-1, 330], [1, -80], [-1, -200], [1, -540], [-1, -640], [1, -780], [-1, -820]];
  for (const [s, z] of flak) {
    b.add(chamferBox(26.0, 30.0, 66.0, { chamfer: 6.0, chamferZ: 10.0, taperFront: 0.72 }), {
      mirrorX: s < 0, x: 112.0, y: -54.0, z, variant: PLATE.ARMOUR, wear: 0.45,
    });
    placeTurret(ctx, 11.0, { mirrorX: s < 0, x: 126.0, y: -54.0, z, rz: -Math.PI / 2, barrels: 2, barrelLen: 24.0 });
  }

  // Drive block: eight mouths in two banks with a heat rack above.
  b.add(chamferBox(220.0, 200.0, 76.0, { chamfer: 24.0, chamferZ: 16.0, wTop: 160.0 }), {
    y: -20, z: -920.0, variant: PLATE.MECH, wear: 0.5,
  });
  for (const [x, y] of [[-86, 40], [-30, 46], [30, 46], [86, 40], [-86, -50], [-30, -56], [30, -56], [86, -50]]) {
    thruster(ctx, x, y - 20, -962.0, 26.0);
  }
  b.both((s) => {
    b.addParts(radiator(16.0, 200.0, 7.0, b.lod(12, 7, 0, 0)), {
      mirrorX: s < 0, x: 116.0, y: 150.0, z: -740.0, rz: s * -0.82, variant: PLATE.PANEL, wear: 0.4,
    });
    b.add(chamferBox(30.0, 90.0, 60.0, { chamfer: 8.0, chamferZ: 12.0 }), {
      mirrorX: s < 0, x: 96.0, y: 96.0, z: -860.0, variant: PLATE.MECH, wear: 0.55,
    });
  });

  if (b.detail < 2) {
    b.addParts(mast(rng, 210.0, 6.0, { arms: 6 }), { x: 26.0, y: 336.0, z: -400.0, rz: -0.05, wear: 0.5 });
    b.addParts(mast(rng, 140.0, 4.4, { arms: 5 }), { x: -44.0, y: 296.0, z: -140.0, rz: 0.07, wear: 0.5 });
    b.addParts(mast(rng, 96.0, 3.2, { arms: 4 }), { x: 60.0, y: 256.0, z: 60.0, rz: -0.1, wear: 0.5 });
    b.addParts(dish(34.0, { sides: b.lod(18, 12, 8, 6), rows: 5 }), {
      x: 70.0, y: 258.0, z: -520.0, rx: -0.5, ry: 0.9, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(dish(24.0, { sides: b.lod(16, 12, 8, 6), rows: 4 }), {
      x: -76.0, y: 246.0, z: -420.0, rx: -0.35, ry: -1.0, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(dish(18.0, { sides: b.lod(14, 10, 8, 6), rows: 3 }), {
      x: 40.0, y: 300.0, z: -300.0, rx: -0.9, ry: 0.3, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(catwalk(700.0, 22.0, 3.0), { x: 86.0, y: 60.0, z: -60.0, wear: 0.5 });
    b.addParts(catwalk(460.0, 20.0, 2.8), { x: -92.0, y: 60.0, z: 200.0, wear: 0.5 });
    b.addParts(catwalk(380.0, 16.0, 2.4), { x: 54.0, y: 162.0, z: -300.0, wear: 0.5 });
    b.addParts(greebleField(rng, {
      x0: -96, x1: 96, z0: -860, z1: 760, y: 108.0, size: g, count: 420, keep: b.lod(1, 0.35, 0, 0),
    }), {});
    b.both((s) => b.addParts(greebleField(rng, {
      x0: 112, x1: 126, z0: -860, z1: 760, y: -60.0, size: g, count: 220, sink: 0.7,
      keep: b.lod(1, 0.35, 0, 0),
    }), { mirrorX: s < 0 }));
    b.addParts(greebleField(rng, {
      x0: -84, x1: 84, z0: -840, z1: 700, y: -136.0, size: g, count: 190, sink: 0.6,
      keep: b.lod(1, 0.35, 0, 0),
    }), {});
    for (const t of decks) {
      b.addParts(greebleField(rng, {
        x0: -t.wt * 0.42, x1: t.wt * 0.42, z0: t.z - t.d * 0.44, z1: t.z + t.d * 0.44,
        y: t.y + t.h * 0.5, size: g * 0.62, count: 130, keep: b.lod(1, 0.35, 0, 0),
      }), { x: -6.0 });
    }
  }

  b.both((s) => {
    b.add(chamferBox(7.0, 16.0, 900.0, { chamfer: 2.4, chamferZ: 20.0 }), {
      mirrorX: s < 0, x: 125.0, y: -70.0, z: -120.0, team: 1, variant: PLATE.PANEL,
    });
  });
  b.add(chamferBox(66.0, 6.0, 60.0, { chamfer: 2.0, chamferZ: 8.0 }), {
    y: 30.0, z: 830.0, team: 1, variant: PLATE.PANEL,
  });

  navSet(ctx, 128.0, -80.0, -400.0, 8.0, 2.4);
  navSet(ctx, 120.0, -80.0, 300.0, 8.0, 2.4);
  navSet(ctx, 104.0, -80.0, 700.0, 7.0, 2.4);
  light(ctx, -6.0, 344.0, -220.0, NAV.beacon, 2.9, 8.0);
  light(ctx, 26.0, 552.0, -400.0, NAV.beacon, 1.5, 7.0);
  light(ctx, 0, 40.0, 910.0, NAV.deck, 1.2, 6.0);
}

/* ---------------------------------------------------------------- registry */

const BUILDERS = {
  scout: buildScout,
  interceptor: buildInterceptor,
  bomber: buildBomber,
  corvette: buildCorvette,
  missileCorvette: buildMissileCorvette,
  assaultFrigate: buildAssaultFrigate,
  ionFrigate: buildIonFrigate,
  supportFrigate: buildSupportFrigate,
  destroyer: buildDestroyer,
  cruiser: buildCruiser,
  collector: buildCollector,
  carrier: buildCarrier,
  mothership: buildMothership,
};

export const HULL_CLASSES = Object.keys(BUILDERS);

/**
 * Build one LOD level of one class.
 *
 * `detail` 0..3 selects full / reduced / blockout / distant. Every level draws
 * from a stream seeded identically, and detail-dependent loops always consume
 * the same numbers, so a coarse level is a subset of the fine one rather than a
 * different ship.
 *
 * `xform` is the normalisation matrix derived from level 0. Passing it keeps
 * every level at exactly the same size — deriving it per level would make the
 * ship visibly jump as greebles drop out of the bounding box.
 */
export function buildHullLevel(classId, detail, xform) {
  const def = SHIPS[classId];
  if (!def || !BUILDERS[classId]) return null;
  const rng = makeRng(def.modelSeed);
  const b = new Builder(rng, detail);
  // Windows draw from their own stream. The coarse levels skip them entirely,
  // and a shared stream would then shift every greeble behind them, turning a
  // reduced LOD into a visibly different ship.
  const ctx = {
    b, rng, wrng: rng.fork(9001), def, detail,
    hardpoints: [], engines: [], lights: [], dock: [],
  };

  BUILDERS[classId](ctx);

  const sources = ctx.engines.map((e) => ({ x: e.pos.x, y: e.pos.y, z: e.pos.z, r: e.radius }));
  const geo = b.finish(null);

  // Union bounding box across all three material groups.
  const box = new THREE.Box3();
  let any = false;
  for (const k of ['hull', 'glass', 'glow']) {
    if (!geo[k]) continue;
    geo[k].computeBoundingBox();
    box.union(geo[k].boundingBox);
    any = true;
  }
  if (!any) return null;

  let m = xform;
  if (!m) {
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centre);
    const s = def.length / Math.max(1e-6, size.z);
    m = new THREE.Matrix4().makeScale(s, s, s);
    m.multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
  }

  for (const k of ['hull', 'glass', 'glow']) {
    if (!geo[k]) continue;
    geo[k].applyMatrix4(m);
    geo[k].computeBoundingBox();
    geo[k].computeBoundingSphere();
  }

  const scale = Math.cbrt(Math.abs(m.determinant()));

  // Wear is computed after normalisation so its distance falloffs are in the
  // same metres the rest of the game uses.
  if (geo.hull) {
    const nb = geo.hull.boundingBox;
    const sz = new THREE.Vector3();
    nb.getSize(sz);
    applyWear(geo.hull, {
      sources: sources.map((e) => {
        const v = new THREE.Vector3(e.x, e.y, e.z).applyMatrix4(m);
        return { x: v.x, y: v.y, z: v.z, r: e.r * scale };
      }),
      nose: nb.max.z,
      span: sz.z,
      radial: Math.max(sz.x, sz.y) * 0.5,
      noiseScale: 6 / Math.max(6, def.length * 0.08),
    });
  }

  const nm = new THREE.Matrix3().getNormalMatrix(m);
  for (const p of ctx.hardpoints) p.applyMatrix4(m);
  for (const e of ctx.engines) {
    e.pos.applyMatrix4(m);
    e.dir.applyMatrix3(nm).normalize();
    e.radius *= scale;
  }
  for (const l of ctx.lights) l.pos.applyMatrix4(m);
  for (const d of ctx.dock) d.applyMatrix4(m);

  const radius = new THREE.Sphere();
  box.applyMatrix4(m);
  box.getBoundingSphere(radius);

  return {
    geo,
    hardpoints: ctx.hardpoints,
    engines: ctx.engines,
    lights: ctx.lights,
    dock: ctx.dock,
    radius: radius.radius,
    xform: m,
    tris: triCount(geo.hull) + triCount(geo.glass) + triCount(geo.glow),
  };
}
