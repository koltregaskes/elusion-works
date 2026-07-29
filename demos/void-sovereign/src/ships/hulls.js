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

  b.paint({ x0: -0.9, x1: 1.4, y0: 0.5, y1: 1.2, z0: -1.8, z1: 2.0, n: [0, 1, 0], nMin: 0.45 });
  b.paint({ x0: 1.8, x1: 2.8, y0: -0.7, y1: 0.7, z0: -4.4, z1: -2.0, mirror: true });

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

  // Livery: a wing flash across most of each wing panel and a spine stripe.
  // At 14 m the ship is a handful of pixels in a furball, so the mask has to
  // be most of a surface or it is nothing at all.
  b.paint({ x0: 2.6, x1: 6.2, y0: -0.5, y1: 0.6, z0: -2.2, z1: 3.4, n: [0, 1, 0], nMin: 0.45, mirror: true });
  b.paint({ x0: -0.5, x1: 0.5, y0: 0.9, y1: 1.5, z0: -4.6, z1: 2.6 });

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

  b.paint({ x0: 2.2, x1: 5.2, y0: -1.4, y1: 0.6, z0: -5.6, z1: 2.2, n: [0, 1, 0], nMin: 0.3, mirror: true });
  b.paint({ x0: -2.0, x1: 2.0, y0: 2.0, y1: 2.6, z0: -8.8, z1: -4.0 });
  b.paint({ x0: -1.6, x1: 1.6, y0: -1.4, y1: 1.5, z0: 6.4, z1: 9.4, n: [0, 0, 1], nMin: 0.3 });

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

  b.paint({ x0: 3.0, x1: 5.4, y0: -1.6, y1: 2.4, z0: 1.0, z1: 10.6, n: [1, 0, 0], nMin: 0.35, mirror: true });
  b.paint({ x0: -2.8, x1: 2.8, y0: 4.2, y1: 4.8, z0: -3.0, z1: 4.8 });
  b.paint({ x0: -3.8, x1: 3.8, y0: -3.4, y1: 3.4, z0: -17.4, z1: -14.4, n: [0, 0, -1], nMin: 0.4 });

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

  b.paint({ x0: 3.2, x1: 5.0, y0: -0.4, y1: 3.2, z0: -8.0, z1: 6.0, n: [1, 0, 0], nMin: 0.35, mirror: true });
  b.paint({ x0: -4.0, x1: 4.0, y0: 4.4, y1: 5.0, z0: -8.4, z1: 4.4 });
  b.paint({ x0: -3.2, x1: 3.2, y0: -2.8, y1: 2.8, z0: -16.2, z1: -13.6, n: [0, 0, -1], nMin: 0.4 });

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

  b.paint({ x0: 9.4, x1: 13.0, y0: -5.0, y1: 1.8, z0: -34.0, z1: 26.0, n: [1, 0, 0], nMin: 0.4, mirror: true });
  b.paint({ x0: 9.4, x1: 13.0, y0: -5.0, y1: 1.8, z0: -60.0, z1: -46.0, n: [1, 0, 0], nMin: 0.4, mirror: true });
  b.paint({ x0: -6.4, x1: 3.6, y0: 13.0, y1: 20.0, z0: tz - 5, z1: tz + 6, n: [1, 0, 0], nMin: 0.3, mirror: true });
  b.paint({ x0: -6.0, x1: 6.0, y0: 8.0, y1: 11.0, z0: 30.0, z1: 56.0, n: [0, 1, 0], nMin: 0.3 });
  b.paint({ x0: -10.0, x1: 10.0, y0: -9.0, y1: 9.0, z0: -66.5, z1: -60.5, n: [0, 0, -1], nMin: 0.4 });

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

  b.paint({ x0: 6.6, x1: 11.4, y0: -12.0, y1: -2.0, z0: -40.0, z1: 4.0, n: [1, 0, 0], nMin: 0.4, mirror: true });
  b.paint({ x0: 6.6, x1: 11.4, y0: -12.0, y1: -2.0, z0: -66.0, z1: -50.0, n: [1, 0, 0], nMin: 0.4, mirror: true });
  b.paint({ x0: -8.0, x1: 8.0, y0: 7.0, y1: 11.0, z0: bz0 + 14, z1: bz0 + 54, n: [0, 1, 0], nMin: 0.3 });
  b.paint({ x0: -8.0, x1: 8.0, y0: -10.0, y1: 4.0, z0: -72.0, z1: -66.0, n: [0, 0, -1], nMin: 0.4 });

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

  b.paint({ x0: 7.6, x1: 11.0, y0: -4.0, y1: 3.4, z0: -30.0, z1: 14.0, n: [1, 0, 0], nMin: 0.4, mirror: true });
  b.paint({ x0: 7.6, x1: 11.0, y0: -4.0, y1: 3.4, z0: -52.0, z1: -40.0, n: [1, 0, 0], nMin: 0.4, mirror: true });
  b.paint({ x0: -5.0, x1: 3.4, y0: 11.0, y1: 13.0, z0: 9.0, z1: 19.0, n: [0, 1, 0], nMin: 0.3 });
  b.paint({ x0: -9.0, x1: 9.0, y0: -8.0, y1: 8.0, z0: -57.0, z1: -51.5, n: [0, 0, -1], nMin: 0.4 });

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
  windows(ctx, 22.0, 2.1, 0.9, 1.1, { x: -1.5, y: 35.0, z: tz + 39.2, rows: 3, rowPitch: 3.4 });
  windows(ctx, 15.0, 2.1, 0.9, 1.1, { x: -2.5, y: 46.0, z: tz + 32.2, rows: 2, rowPitch: 3.2 });
  windows(ctx, 62.0, 2.3, 0.8, 1.0, { x: 13.4, y: 35.0, z: tz - 4, ry: -Math.PI / 2, rows: 3, rowPitch: 3.2 });
  windows(ctx, 62.0, 2.3, 0.8, 1.0, { x: -16.4, y: 35.0, z: tz - 4, ry: Math.PI / 2, rows: 3, rowPitch: 3.2 });

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

  // Livery: belt blazons fore and aft, a cap stripe over the superstructure,
  // a prow chevron and a collar round the drive block. Painted on to the hull
  // skin so the colour survives the ship being a few pixels wide.
  b.paint({ x0: 27.0, x1: 42.0, y0: -16.0, y1: 8.0, z0: -70.0, z1: 90.0, n: [1, 0, 0], nMin: 0.4, mirror: true });
  b.paint({ x0: 27.0, x1: 42.0, y0: -16.0, y1: 8.0, z0: -178.0, z1: -118.0, n: [1, 0, 0], nMin: 0.4, mirror: true });
  b.paint({ x0: -20.0, x1: 16.0, y0: 38.0, y1: 66.0, z0: tz - 24, z1: tz + 30, n: [1, 0, 0], nMin: 0.3, mirror: true });
  b.paint({ x0: -16.0, x1: 16.0, y0: 8.0, y1: 24.0, z0: 138.0, z1: 200.0, n: [0, 1, 0], nMin: 0.3 });
  b.paint({ x0: -26.0, x1: 26.0, y0: -26.0, y1: 24.0, z0: -192.0, z1: -177.0, n: [0, 0, -1], nMin: 0.45 });

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

  // Twin spinal ion mounts. These are the ship — a cruiser is identified by
  // its guns at ranges where the hull is a smudge — so they are set well
  // outboard of the belt, run two thirds of the length, and finish 55 m past
  // the prow. Anything slimmer disappears into the superstructure.
  // Set outboard of the belt with real daylight between gun and hull. Tucked
  // in close they simply merge into the hull mass and the ship becomes one
  // blob; held out on pylons they read as two guns with a ship between them,
  // which is what a Heavy Cruiser is.
  const sides = b.lod(14, 12, 8, 6);
  const gunX = 84.0;
  const gunY = 8.0;
  b.both((s) => {
    const barrel = [
      { z: -96, r: 15.0 },
      { z: -60, r: 20.0 },
      { z: 120, r: 19.0 },
      { z: 280, r: 20.5 },
      { z: 326, r: 22.0 },
      { z: 340, r: 18.0 },
    ];
    b.add(loft(decimateStations(barrel.map((p) => ({ z: p.z, pts: ngonSection(p.r, sides) })), b.lod(1, 1, 2, 2)), {}), {
      mirrorX: s < 0, x: gunX, y: gunY, ry: s * -0.012, variant: PLATE.MECH, wear: 0.45,
    });
    // Breech housing: the guns have to come from somewhere, and a bare tube
    // running into the hull reads as a pipe.
    b.add(chamferBox(52.0, 58.0, 110.0, { chamfer: 10.0, chamferZ: 17.0, taperFront: 0.82, wTop: 34.0 }), {
      mirrorX: s < 0, x: gunX, y: gunY - 2, z: -136.0, variant: PLATE.ARMOUR, wear: 0.5,
    });
    const coils = b.lod(11, 7, 3, 0);
    for (let i = 0; i < coils; i++) {
      const t = i / Math.max(1, coils - 1);
      b.add(ring(20.0, 27.0 - t * 3.4, 4.8 + (1 - t) * 2.4, sides), {
        mirrorX: s < 0, x: gunX, y: gunY, z: -50 + t * 350,
        variant: PLATE.MECH, wear: 0.4 + t * 0.3,
      });
    }
    b.addParts(pocket(26.0, 26.0, 15.0, { chamfer: 5.0, taper: 0.55, lit: true, variant: PLATE.MECH }), {
      mirrorX: s < 0, x: gunX, y: gunY, z: 340, ry: Math.PI, wear: 0.9,
    });
    b.add(ring(21.0, 27.0, 6.0, sides), { mirrorX: s < 0, x: gunX, y: gunY, z: 322, variant: PLATE.ARMOUR, wear: 0.85 });
    hp(ctx, s * gunX, gunY, 344.0);
    // Pylons carrying each gun off the flank. Short, deep and few, so the gap
    // between gun and hull stays open all the way down the ship.
    for (let i = 0; i < b.lod(4, 3, 2, 0); i++) {
      const z = -80 + i * 108;
      b.add(chamferBox(34.0, 22.0, 46.0, { chamfer: 5.0, chamferZ: 8.0, taperFront: 0.78, wTop: 24.0 }), {
        mirrorX: s < 0, x: gunX - 21, y: gunY - 4, z, rz: s * 0.06, variant: PLATE.PANEL, wear: 0.44,
      });
    }
    b.addParts(radiator(4.0, 90.0, 1.8, b.lod(9, 5, 0, 0)), {
      mirrorX: s < 0, x: gunX + 20, y: 26.0, z: 40.0, rz: s * -0.5, variant: PLATE.PANEL, wear: 0.4,
    });
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

  // Livery: belt blazons, terrace cap stripe, a band round each spinal mount
  // and a drive collar. The nacelle bands are the boldest of them — a ship
  // this size is identified by its guns long before its hull.
  b.paint({ x0: 46.0, x1: 72.0, y0: -34.0, y1: 6.0, z0: -130.0, z1: 170.0, n: [1, 0, 0], nMin: 0.4, mirror: true });
  b.paint({ x0: 46.0, x1: 72.0, y0: -34.0, y1: 6.0, z0: -296.0, z1: -196.0, n: [1, 0, 0], nMin: 0.4, mirror: true });
  b.paint({ x0: 14.0, x1: 40.0, y0: 0.0, y1: 26.0, z0: -60.0, z1: -4.0, mirror: true });
  b.paint({ x0: -36.0, x1: 32.0, y0: 56.0, y1: 96.0, z0: -180.0, z1: -20.0, n: [1, 0, 0], nMin: 0.35, mirror: true });
  b.paint({ x0: -30.0, x1: 30.0, y0: 14.0, y1: 36.0, z0: 180.0, z1: 300.0, n: [0, 1, 0], nMin: 0.3 });
  b.paint({ x0: -46.0, x1: 46.0, y0: -48.0, y1: 36.0, z0: -316.0, z1: -292.0, n: [0, 0, -1], nMin: 0.45 });

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

  b.paint({ x0: 4.6, x1: 7.0, y0: -5.0, y1: 3.0, z0: -14.0, z1: 6.0, n: [1, 0, 0], nMin: 0.35, mirror: true });
  b.paint({ x0: -5.4, x1: 5.4, y0: 5.6, y1: 6.6, z0: -12.0, z1: 6.0, n: [0, 1, 0], nMin: 0.3 });

  ctx.dock.push(new THREE.Vector3(0, 5.0, -3.0));
  navSet(ctx, 6.4, 2.4, -14.0, 0.3, 1.6);
  light(ctx, -3.0, 8.4, 6.6, NAV.beacon, 2.0, 0.26);
}

/* carrier — flight decks with lit hangar mouths, control tower, launch rails.

   The carrier's whole job is to look like somewhere fighters come from, so the
   two bays are the design and everything else defers to them: the belt steps
   round them, the tower sits off to starboard to keep the deck clear, and the
   launch rails run forward out of each mouth as open truss so you can see the
   path a fighter takes. Beam is deliberately generous — a narrow carrier reads
   as a destroyer with holes in it. */
function buildCarrier(ctx) {
  const { b, rng } = ctx;
  const g = greebleSize(760);
  const plan = [
    { z: -380, w: 138, h: 62, n: 0 },
    { z: -370, w: 170, h: 72, n: 40 },
    { z: -300, w: 182, h: 78, n: 52 },
    { z: -290, w: 200, h: 84, n: 64 },
    { z: -20, w: 200, h: 84, n: 64 },
    { z: 120, w: 192, h: 80, n: 58 },
    { z: 130, w: 158, h: 70, n: 42 },
    { z: 250, w: 148, h: 66, n: 36 },
    { z: 260, w: 110, h: 54, n: 20 },
    { z: 340, w: 98, h: 50, n: 12 },
    { z: 350, w: 66, h: 38, n: 0 },
    { z: 380, w: 46, h: 32, n: 0 },
  ];
  const hw = planWidth(plan);
  b.add(loft(decimateStations(plan.map((p) => ({
    z: p.z,
    pts: trenchSection(p.w, p.h, {
      wTop: p.w * 0.86, wBot: p.w, chamfer: p.h * 0.18, chamferNotch: p.h * 0.05,
      notchW: p.n, notchDepth: p.h * 0.26, cy: -2,
    }),
  })), b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });
  armourBelt(ctx, plan.slice(0, 10), { out: 2.6, top: -4.0, bottom: -26.0, chamfer: 4.6, tumble: 1.0 });
  armourBelt(ctx, plan.slice(0, 9), { out: 1.2, top: 30.0, bottom: 12.0, chamfer: 3.4, tumble: 0.92, variant: PLATE.PANEL });
  b.add(chamferBox(66.0, 40.0, 94.0, { chamfer: 9.0, chamferZ: 17.0, taperFront: 0.52, wTop: 38.0 }), {
    y: -2.0, z: 356.0, variant: PLATE.ARMOUR, wear: 0.6,
  });

  // Flight decks: two lit mouths sunk into the flanks, the port bay further
  // forward than the starboard one so the ship never reads as a mirrored slab.
  const bays = [{ s: 1, z: -50 }, { s: -1, z: 60 }];
  for (const bay of bays) {
    b.addParts(hangarBay(rng, 196.0, 52.0, 48.0, {
      chamfer: 6.0, frame: 11.0,
      ribs: b.lod(6, 4, 2, 0), sideRibs: b.lod(4, 3, 0, 0), lamps: b.lod(11, 7, 0, 0),
    }), { mirrorX: bay.s < 0, x: 102.0, y: 2.0, z: bay.z, ry: -Math.PI / 2 });

    // Launch rails: open truss running forward out of the mouth. A fighter's
    // path out of the ship should be visible from outside it.
    for (const dy of [-11, 13]) {
      b.addParts(truss(104.0, 9.0, 7.0, b.lod(6, 4, 2, 1), {
        thickness: 2.0, variant: PLATE.MECH, wear: 0.65, diagonals: b.detail < 2,
      }), { mirrorX: bay.s < 0, x: 106.0, y: dy, z: bay.z + 152.0 });
    }
    b.addParts(ribBand(b.lod(9, 6, 3, 0), bay.z + 104, bay.z + 196, 9.0, 34.0, 2.2, { variant: PLATE.MECH, y: 3.0 }), {
      mirrorX: bay.s < 0, x: 106.0,
    });
    winBay(ctx, 166.0, 7.6, 2.6, 2.0, {
      mirrorX: bay.s < 0, x: 105.0, y: 40.0, z: bay.z, ry: -Math.PI / 2,
      rows: 2, rowPitch: 5.6, fill: 0.68, depth: 2.8,
    });
    light(ctx, bay.s * 112.0, 34.0, bay.z + 92.0, NAV.hangar, 0.7, 2.4);
    light(ctx, bay.s * 112.0, 34.0, bay.z - 92.0, NAV.hangar, 0.7, 2.4);
    ctx.dock.push(new THREE.Vector3(bay.s * 130.0, 2.0, bay.z));
  }

  // Control tower, starboard side, well aft so it never overhangs a deck.
  const tx = 56;
  const tz = -150;
  b.add(chamferBox(46.0, 30.0, 104.0, { chamfer: 5.0, chamferZ: 7.0, taperFront: 0.84, wTop: 38.0 }), {
    x: tx, y: 48.0, z: tz, variant: PLATE.PANEL, wear: 0.26,
  });
  b.add(chamferBox(36.0, 26.0, 70.0, { chamfer: 4.0, chamferZ: 6.0, taperFront: 0.8, wTop: 27.0 }), {
    x: tx, y: 72.0, z: tz + 8, variant: PLATE.PANEL, wear: 0.24,
  });
  b.add(chamferBox(24.0, 22.0, 42.0, { chamfer: 3.0, chamferZ: 4.4, taperFront: 0.74, wTop: 17.0 }), {
    x: tx, y: 94.0, z: tz + 14, variant: PLATE.PANEL, wear: 0.22,
  });
  b.add(chamferBox(18.0, 7.0, 15.0, { chamfer: 1.7, chamferZ: 2.6, taperFront: 0.6 }), {
    x: tx, y: 105.0, z: tz + 32, kind: KIND.GLASS, variant: PLATE.PANEL,
  });
  winBay(ctx, 34.0, 3.4, 1.4, 1.5, { x: tx, y: 50.0, z: tz + 52.4, rows: 3, rowPitch: 4.4, fill: 0.66, depth: 1.8 });
  winBay(ctx, 26.0, 3.4, 1.4, 1.5, { x: tx, y: 74.0, z: tz + 43.4, rows: 2, rowPitch: 4.2, fill: 0.66, depth: 1.8 });
  b.both((s) => winBay(ctx, 92.0, 3.6, 1.3, 1.4, {
    mirrorX: s < 0, x: tx + s * 23.2, y: 50.0, z: tz, ry: -s * Math.PI / 2,
    rows: 3, rowPitch: 4.2, fill: 0.6, depth: 1.8,
  }));

  // Dorsal spine: production gantries running the length of the trench.
  b.addParts(ribBand(b.lod(12, 7, 4, 0), -300, 240, 68.0, 9.0, 3.4, { variant: PLATE.MECH, y: 34.0 }), {});
  b.add(chamferBox(40.0, 12.0, 310.0, { chamfer: 3.6, chamferZ: 9.0, taperFront: 0.8 }), {
    x: -32.0, y: 38.0, z: -20.0, variant: PLATE.PANEL, wear: 0.3,
  });
  winBay(ctx, 270.0, 9.0, 2.6, 2.0, { x: -32.0, y: 40.0, z: 136.0, rows: 2, rowPitch: 5.4, fill: 0.62, depth: 2.6 });

  const flak = [[1, 250], [-1, 190], [-1, -120], [1, -250], [-1, -300], [1, 120]];
  for (const [s, z] of flak) {
    b.add(chamferBox(14.0, 16.0, 32.0, { chamfer: 3.0, chamferZ: 5.0, taperFront: 0.72 }), {
      mirrorX: s < 0, x: 92.0, y: -22.0, z, variant: PLATE.ARMOUR, wear: 0.45,
    });
    placeTurret(ctx, 6.0, { mirrorX: s < 0, x: 99.0, y: -22.0, z, rz: -Math.PI / 2, barrels: 2, barrelLen: 13.0 });
  }

  // Drive block: six mouths and a heat rack.
  b.add(chamferBox(134.0, 64.0, 32.0, { chamfer: 10.0, chamferZ: 6.5, wTop: 100.0 }), {
    y: -4, z: -364.0, variant: PLATE.MECH, wear: 0.5,
  });
  b.addParts(pocket(112.0, 50.0, 12.0, { chamfer: 6.0, taper: 0.9, variant: PLATE.MECH }), {
    y: -4, z: -378.0, wear: 0.8,
  });
  for (const [x, y] of [[-48, 9], [0, 11], [48, 9], [-48, -15], [0, -17], [48, -15]]) {
    thruster(ctx, x, y - 4, -375.0, 12.5);
  }
  b.both((s) => {
    b.addParts(radiator(7.0, 78.0, 2.8, b.lod(10, 6, 0, 0)), {
      mirrorX: s < 0, x: 76.0, y: 50.0, z: -300.0, rz: s * -0.8, variant: PLATE.PANEL, wear: 0.4,
    });
  });

  if (b.detail < 2) {
    b.addParts(mast(rng, 54.0, 2.0, { arms: 5 }), { x: tx + 13, y: 104.0, z: tz - 28, rz: -0.06, wear: 0.5 });
    b.addParts(dish(14.0, { sides: b.lod(16, 12, 8, 6), rows: 4 }), {
      x: tx - 25, y: 82.0, z: tz - 20, rx: -0.5, ry: -1.0, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(dish(9.5, { sides: b.lod(14, 10, 8, 6), rows: 3 }), {
      x: -70.0, y: 42.0, z: -230.0, rx: -0.4, ry: -1.3, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(commsArray(22.0, 30.0, { rows: 5, thickness: 2.4 }), {
      x: -66.0, y: 46.0, z: -120.0, ry: Math.PI / 2 + 0.3, wear: 0.3,
    });
    b.addParts(catwalk(280.0, 9.0, 1.2), { x: 44.0, y: 30.0, z: 60.0, wear: 0.5 });
    b.addParts(catwalk(190.0, 8.0, 1.1), { x: -62.0, y: 26.0, z: -80.0, wear: 0.5 });

    b.addParts(armourPlates(rng, {
      x0: -78, x1: 78, z0: -350, z1: 320, y: 36.0, size: g * 6.5, count: 58,
      variant: PLATE.ARMOUR, width: (z) => hw(z) * 0.74, keep: b.lod(1, 0.4, 0, 0),
    }), {});
    b.both((s) => b.addParts(armourPlates(rng, {
      x0: 92, x1: 100, z0: -350, z1: 320, y: -34.0, size: g * 5.5, count: 44,
      variant: PLATE.ARMOUR, keep: b.lod(1, 0.4, 0, 0), aspect: 3.2, rzBase: s * Math.PI * 0.5,
    }), { mirrorX: s < 0 }));

    b.addParts(greebleField(rng, {
      x0: -84, x1: 84, z0: -350, z1: 330, y: 36.0, size: g, count: 300,
      width: (z) => hw(z) * 0.74, keep: b.lod(1, 0.35, 0, 0),
    }), {});
    b.both((s) => b.addParts(greebleField(rng, {
      x0: 92, x1: 102, z0: -350, z1: 330, y: -34.0, size: g, count: 140, sink: 0.7,
      width: (z) => hw(z) * 1.0, keep: b.lod(1, 0.35, 0, 0),
    }), { mirrorX: s < 0 }));
    b.addParts(greebleField(rng, {
      x0: -74, x1: 74, z0: -350, z1: 300, y: -44.0, size: g, count: 130, sink: 0.6,
      width: (z) => hw(z) * 0.7, keep: b.lod(1, 0.35, 0, 0),
    }), {});
    b.addParts(greebleField(rng, {
      x0: tx - 18, x1: tx + 18, z0: tz - 48, z1: tz + 48, y: 63.0, size: g * 0.7, count: 80,
      keep: b.lod(1, 0.35, 0, 0),
    }), {});

    // Fourth tier: rivets and vents, sized so the deck reads as walkable.
    const stud = g * 0.3;
    b.addParts(greebleField(rng, {
      x0: -84, x1: 84, z0: -350, z1: 330, y: 36.0, size: stud, count: 520, tall: 1.1,
      width: (z) => hw(z) * 0.74, keep: b.lod(1, 0.25, 0, 0), simple: true,
    }), {});
    b.both((s) => b.addParts(greebleField(rng, {
      x0: 94, x1: 102, z0: -350, z1: 330, y: -30.0, size: stud, count: 300, sink: 0.7, tall: 1.1,
      keep: b.lod(1, 0.25, 0, 0), simple: true,
    }), { mirrorX: s < 0 }));
  }

  // Livery: belt blazons, the tower flank, a dorsal gantry stripe, a prow
  // chevron and a drive collar.
  b.paint({ x0: 88.0, x1: 120.0, y0: -42.0, y1: -6.0, z0: -100.0, z1: 190.0, n: [1, 0, 0], nMin: 0.4, mirror: true });
  b.paint({ x0: 88.0, x1: 120.0, y0: -42.0, y1: -6.0, z0: -340.0, z1: -210.0, n: [1, 0, 0], nMin: 0.4, mirror: true });
  b.paint({ x0: 30.0, x1: 82.0, y0: 60.0, y1: 112.0, z0: tz - 44, z1: tz + 44, n: [1, 0, 0], nMin: 0.3, mirror: true });
  b.paint({ x0: -54.0, x1: -10.0, y0: 40.0, y1: 48.0, z0: -172.0, z1: 130.0, n: [0, 1, 0], nMin: 0.45 });
  b.paint({ x0: -30.0, x1: 30.0, y0: 10.0, y1: 30.0, z0: 250.0, z1: 386.0, n: [0, 1, 0], nMin: 0.3 });
  b.paint({ x0: -76.0, x1: 76.0, y0: -42.0, y1: 36.0, z0: -376.0, z1: -352.0, n: [0, 0, -1], nMin: 0.45 });

  navSet(ctx, 99.0, -30.0, -160.0, 3.4, 2.2);
  navSet(ctx, 88.0, -26.0, 200.0, 3.2, 2.2);
  light(ctx, tx, 110.0, tz + 14, NAV.beacon, 2.8, 3.2);
  light(ctx, 0, 40.0, 330.0, NAV.deck, 1.2, 2.6);
}

/* mothership — everything you have. A city with engines.

   The hero asset, and the one place the design language has to hold at four
   distances at once:

     20 km   silhouette only — two peaks, the arch between them, the bow shield,
             the chasm. Read as a shape, in one glance, with no detail at all.
      4 km   primary masses separate: citadel deck, sail posts, dock tower,
             hangar frames, drive housing, prow spars
       800 m secondary structure — buttresses, belt armour, turret decks,
             radiator fins, gantry runs, the lit mouths of the bays
       200 m surface: plate layers, panel seams, window galleries, handrails

   The massing exists to beat one specific failure. A long hull with a stepped
   superstructure on top is a battleship whatever you bolt to it, and a
   battleship at 20 km is indistinguishable from a destroyer at 4 km. So the
   silhouette is built round things a warship cannot have: a 300 m void through
   the dorsal sail, an open chasm down the forward spine, a bow shield far
   wider than the hull behind it, and a plan roughly three lengths to one beam
   rather than five. Negative space is the subject.

   Greeble is the finest in the fleet in absolute metres — ~3.2 m fittings on a
   1,900 m hull is what makes this 135 interceptors rather than one big one. */
function buildMothership(ctx) {
  const { b, rng } = ctx;
  const g = greebleSize(1900);

  /* ---------------------------------------------------------------- keel */

  // The spine stops well short of the bow: the shield out front is carried on
  // spars, and the daylight between them is half the silhouette. Stepped
  // rather than tapered — each pair of stations a few metres apart is a
  // machined ledge, and a smooth curve to a point is how a hull starts looking
  // like a boat. `nd` deepens the dorsal trench into an open chasm forward of
  // the citadel, where there is no deck over it.
  const keel = [
    { z: -820, w: 342, h: 278, n: 0, nd: 0.14 },
    { z: -804, w: 404, h: 324, n: 90, nd: 0.16 },
    { z: -700, w: 422, h: 340, n: 112, nd: 0.16 },
    { z: -684, w: 430, h: 350, n: 132, nd: 0.17 },
    { z: -120, w: 430, h: 350, n: 138, nd: 0.18 },
    { z: 16, w: 424, h: 346, n: 190, nd: 0.36 },
    { z: 240, w: 414, h: 338, n: 190, nd: 0.38 },
    { z: 256, w: 380, h: 314, n: 168, nd: 0.36 },
    { z: 300, w: 372, h: 308, n: 152, nd: 0.3 },
    { z: 430, w: 360, h: 302, n: 150, nd: 0.22 },
    { z: 446, w: 306, h: 266, n: 120, nd: 0.2 },
    { z: 580, w: 284, h: 250, n: 90, nd: 0.18 },
    { z: 596, w: 242, h: 210, n: 0, nd: 0.14 },
    { z: 716, w: 222, h: 196, n: 0, nd: 0.14 },
  ];
  const hw = planWidth(keel);
  b.add(loft(decimateStations(keel.map((p) => ({
    z: p.z,
    pts: trenchSection(p.w, p.h, {
      wTop: p.w * 0.88, wBot: p.w * 0.94, chamfer: p.h * 0.1, chamferNotch: p.h * 0.026,
      notchW: p.n, notchDepth: p.h * p.nd, cy: -20,
    }),
  })), b.lod(1, 1, 2, 3)), {}), { variant: PLATE.HULL });

  // Three belts at three heights. Layered armour is the difference between a
  // slab and something that was assembled.
  armourBelt(ctx, keel.slice(0, 12), { out: 8.0, top: 36.0, bottom: -28.0, chamfer: 17.0 });
  armourBelt(ctx, keel.slice(0, 11), { out: 15.0, top: -40.0, bottom: -110.0, chamfer: 14.0, tumble: 1.0 });
  armourBelt(ctx, keel.slice(0, 10), { out: 5.0, top: 104.0, bottom: 56.0, chamfer: 12.0, tumble: 0.9, variant: PLATE.PANEL });

  // Ventral engineering pod: the mass that stops the hull reading as a plank
  // from the side, and the reason the drive block has somewhere to come from.
  const pod = [
    { z: -764, w: 274, h: 126 },
    { z: -748, w: 326, h: 150 },
    { z: -240, w: 344, h: 158 },
    { z: 140, w: 320, h: 146 },
    { z: 156, w: 254, h: 118 },
    { z: 380, w: 226, h: 102 },
    { z: 420, w: 142, h: 64 },
  ];
  b.add(loft(decimateStations(pod.map((p) => ({
    z: p.z,
    pts: rectSection(p.w, p.h, { wTop: p.w, wBot: p.w * 0.8, chamfer: p.h * 0.22, cy: -256 }),
  })), b.lod(1, 1, 2, 3)), {}), { variant: PLATE.ARMOUR, wear: 0.45 });
  b.addParts(ribBand(b.lod(13, 8, 4, 0), -730, 340, 356.0, 28.0, 10.0, {
    variant: PLATE.MECH, y: -256,
  }), {});

  /* -------------------------------------------------------- forward chasm */

  // The trench forward of the citadel is left open — a 190 m canyon with the
  // ship's innards at the bottom of it, spanned by three spars. This is the
  // void that stops the hull reading as one extruded mass.
  for (const z of [56, 148, 240]) {
    const wide = hw(z) * 2 * 0.5;
    b.add(chamferBox(wide, 26.0, 40.0, { chamfer: 7.0, chamferZ: 11.0, wTop: wide * 0.68 }), {
      y: 122.0, z, variant: PLATE.ARMOUR, wear: 0.4,
    });
    if (b.detail < 2) {
      b.addParts(catwalk(wide * 0.88, 16.0, 2.4), { y: 140.0, z, ry: Math.PI / 2, wear: 0.5 });
    }
  }
  b.both((s) => {
    b.add(chamferBox(16.0, 34.0, 250.0, { chamfer: 5.0, chamferZ: 13.0 }), {
      mirrorX: s < 0, x: 84.0, y: 34.0, z: 150.0, variant: PLATE.MECH, wear: 0.6,
    });
    winBay(ctx, 224.0, 15.0, 5.0, 4.0, {
      mirrorX: s < 0, x: 92.0, y: 66.0, z: 150.0, ry: -Math.PI / 2,
      rows: 3, rowPitch: 11.0, fill: 0.66, depth: 4.4,
    });
  });
  if (b.detail < 2) {
    b.addParts(greebleField(rng, {
      x0: -80, x1: 80, z0: 34, z1: 268, y: 14.0, size: g * 1.4, count: 80,
      keep: b.lod(1, 0.4, 0, 0),
    }), {});
  }

  /* ---------------------------------------------------------- citadel deck */

  // One broad deck, not a wedding cake. The vertical drama is the sail; a
  // stack of thin terraces here would only rebuild the battleship.
  const deck = { y: 218, w: 396, wt: 322, h: 140, d: 680, z: -324 };
  b.add(chamferBox(deck.w, deck.h, deck.d, {
    chamfer: deck.h * 0.16, chamferZ: deck.h * 0.4, taperFront: 0.82, taperBack: 0.9, wTop: deck.wt,
  }), { x: -8.0, y: deck.y, z: deck.z, variant: PLATE.PANEL, wear: 0.22 });
  b.add(chamferBox(deck.w * 1.05, deck.h * 0.14, deck.d * 1.02, {
    chamfer: deck.h * 0.05, chamferZ: deck.h * 0.16, taperFront: 0.84, taperBack: 0.92, wTop: deck.w * 1.02,
  }), { x: -8.0, y: deck.y - deck.h * 0.5, z: deck.z, variant: PLATE.ARMOUR, wear: 0.34 });

  winBay(ctx, deck.wt * 0.84, 16.0, 5.2, 4.2, {
    x: -8.0, y: deck.y + deck.h * 0.04, z: deck.z + deck.d * 0.5 + 1.0,
    rows: 3, rowPitch: 13.0, fill: 0.66, depth: 5.0,
  });
  for (const row of [-0.28, 0.0, 0.28]) {
    b.both((s) => winBay(ctx, deck.d * 0.86, 14.0, 4.6, 3.6, {
      mirrorX: s < 0, x: deck.wt * 0.5 + 1.0, y: deck.y + deck.h * row, z: deck.z,
      ry: -Math.PI / 2, rows: 2, rowPitch: 9.0, fill: 0.6, depth: 4.4,
    }));
  }
  b.addParts(ribBand(b.lod(11, 6, 3, 0), deck.z - deck.d * 0.42, deck.z + deck.d * 0.42, deck.wt * 1.04, 14.0, 6.0, {
    variant: PLATE.MECH, y: deck.y + deck.h * 0.5,
  }), { x: -8.0 });

  /* ----------------------------------------------------------- dorsal sail */

  // The hero shape. A vast plate standing on the citadel with a 300 m arch cut
  // through it — built as members round a hole rather than as a slab, because
  // the hole is the point. The forward post is much heavier than the aft one
  // and the top beam slopes: a symmetrical frame reads as a suitcase handle.
  const sail = { x: -8.0, base: 288, top: 716, tk: 96 };
  const member = (z, d, y0, y1, tk, wear, o = {}) => {
    b.add(chamferBox(tk, y1 - y0, d, {
      chamfer: tk * 0.24, chamferZ: tk * 0.4, taperFront: o.taperFront || 0.92, wTop: tk * 0.82,
    }), { x: sail.x, y: (y0 + y1) * 0.5, z, variant: PLATE.PANEL, wear, ...o });
  };
  member(-344, 600, sail.base, 400, sail.tk, 0.26); // bottom slab
  member(-134, 180, 400, sail.top, 78, 0.24); // forward post
  member(-582, 116, 400, 648, 66, 0.26); // aft post
  b.add(chamferBox(66.0, 76.0, 556.0, { chamfer: 16.0, chamferZ: 24.0, wTop: 50.0 }), {
    x: sail.x, y: sail.top - 44, z: -348.0, rx: -0.062, variant: PLATE.PANEL, wear: 0.25,
  });
  // Diagonal brace inside the arch: the one member that stops the void from
  // being a rectangle.
  b.add(chamferBox(56.0, 34.0, 268.0, { chamfer: 12.0, chamferZ: 16.0 }), {
    x: sail.x, y: 470.0, z: -300.0, rx: 0.62, variant: PLATE.MECH, wear: 0.45,
  });
  // Arch soffit and jamb linings — the void needs edges to read as cut.
  b.add(chamferBox(90.0, 18.0, 288.0, { chamfer: 6.0, chamferZ: 9.0 }), {
    x: sail.x, y: 410.0, z: -368.0, variant: PLATE.MECH, wear: 0.45,
  });
  b.add(chamferBox(62.0, 16.0, 274.0, { chamfer: 5.0, chamferZ: 9.0 }), {
    x: sail.x, y: 638.0, z: -366.0, variant: PLATE.MECH, wear: 0.4,
  });
  b.addParts(ribBand(b.lod(7, 4, 2, 0), -478, -252, 96.0, 12.0, 8.0, { variant: PLATE.MECH, y: 418.0 }), { x: sail.x });

  // Sail skin: window cities on both faces, arrays, plate layers.
  b.both((s) => {
    winBay(ctx, 520.0, 19.0, 6.5, 5.0, {
      mirrorX: s < 0, x: sail.x + sail.tk * 0.5 + 1.0, y: 336.0, z: -344.0,
      ry: -Math.PI / 2, rows: 3, rowPitch: 16.0, fill: 0.62, depth: 5.0,
    });
    winBay(ctx, 152.0, 16.0, 5.5, 4.4, {
      mirrorX: s < 0, x: sail.x + 40.0, y: 540.0, z: -134.0,
      ry: -Math.PI / 2, rows: 6, rowPitch: 34.0, fill: 0.58, depth: 4.4,
    });
    winBay(ctx, 100.0, 16.0, 5.5, 4.4, {
      mirrorX: s < 0, x: sail.x + 34.0, y: 512.0, z: -582.0,
      ry: -Math.PI / 2, rows: 5, rowPitch: 34.0, fill: 0.5, depth: 4.4,
    });
    b.addParts(commsArray(96.0, 132.0, { rows: 6, thickness: 8.0 }), {
      mirrorX: s < 0, x: sail.x + 40.0, y: 556.0, z: -600.0, ry: -Math.PI / 2, wear: 0.3,
    });
  });

  // Bridge: a wide armoured visor on the forward face of the sail, high up.
  b.add(chamferBox(108.0, 50.0, 56.0, { chamfer: 10.0, chamferZ: 14.0, taperFront: 0.5, wTop: 66.0 }), {
    x: sail.x, y: 630.0, z: -34.0, variant: PLATE.ARMOUR, wear: 0.24,
  });
  b.add(chamferBox(88.0, 26.0, 34.0, { chamfer: 6.0, chamferZ: 9.0, taperFront: 0.55, wTop: 52.0 }), {
    x: sail.x, y: 632.0, z: -16.0, kind: KIND.GLASS, variant: PLATE.PANEL,
  });
  winBay(ctx, 76.0, 12.0, 4.0, 3.2, {
    x: sail.x, y: 572.0, z: -48.0, rows: 3, rowPitch: 11.0, fill: 0.72, depth: 4.0,
  });

  /* -------------------------------------------------------- forward tower */

  // The second peak. Two tall masses with a long low span between them reads
  // as a city skyline; one tall mass on a long hull reads as a warship.
  // Squared off and buttressed down into the keel, not a stalk with a head on
  // it: a narrow waist under a wider cap reads as a control tower on a pier,
  // which is the one silhouette a flying city must not have.
  const tower = { y: 300, w: 268, wt: 226, h: 300, d: 232, z: 384 };
  b.add(chamferBox(tower.w, tower.h, tower.d, {
    chamfer: 24.0, chamferZ: 36.0, taperFront: 0.88, taperBack: 0.94, wTop: tower.wt,
  }), { x: 6.0, y: tower.y, z: tower.z, variant: PLATE.PANEL, wear: 0.26 });
  b.add(chamferBox(tower.w * 1.06, 30.0, tower.d * 1.04, {
    chamfer: 10.0, chamferZ: 16.0, taperFront: 0.9, wTop: tower.w * 1.02,
  }), { x: 6.0, y: tower.y - tower.h * 0.5 + 6, z: tower.z, variant: PLATE.ARMOUR, wear: 0.38 });
  b.add(chamferBox(206.0, 104.0, 176.0, { chamfer: 18.0, chamferZ: 26.0, taperFront: 0.82, wTop: 158.0 }), {
    x: 6.0, y: 496.0, z: tower.z + 4, variant: PLATE.PANEL, wear: 0.24,
  });
  b.add(chamferBox(96.0, 28.0, 40.0, { chamfer: 7.0, chamferZ: 10.0, taperFront: 0.55, wTop: 58.0 }), {
    x: 6.0, y: 522.0, z: tower.z + 74, kind: KIND.GLASS, variant: PLATE.PANEL,
  });
  b.addParts(ribBand(b.lod(7, 4, 2, 0), tower.z - 74, tower.z + 74, tower.wt * 1.06, 15.0, 6.0, {
    variant: PLATE.MECH, y: tower.y + tower.h * 0.5,
  }), { x: 6.0 });
  winBay(ctx, 140.0, 15.0, 5.0, 4.0, {
    x: 6.0, y: 330.0, z: tower.z + tower.d * 0.5 + 1.0,
    rows: 5, rowPitch: 26.0, fill: 0.66, depth: 4.6,
  });
  b.both((s) => {
    winBay(ctx, 150.0, 15.0, 5.0, 4.0, {
      mirrorX: s < 0, x: tower.wt * 0.5 + 7.0, y: 330.0, z: tower.z,
      ry: -Math.PI / 2, rows: 6, rowPitch: 30.0, fill: 0.62, depth: 4.6,
    });
    b.add(chamferBox(30.0, 168.0, 54.0, { chamfer: 8.0, chamferZ: 12.0, wTop: 16.0, wBot: 40.0 }), {
      mirrorX: s < 0, x: 132.0, y: 200.0, z: tower.z - 20, rz: s * 0.2,
      variant: PLATE.PANEL, wear: 0.4,
    });
  });

  /* --------------------------------------------------------- bow structure */

  // A shield far wider than the hull behind it, carried on spars with daylight
  // between them. Deliberately architecture, not a ram.
  b.add(chamferBox(196.0, 182.0, 176.0, { chamfer: 24.0, chamferZ: 28.0, taperFront: 0.84, wTop: 128.0 }), {
    y: -6.0, z: 764.0, variant: PLATE.ARMOUR, wear: 0.4,
  });
  // Built as a shallow chevron out of two canted halves rather than one slab.
  // A flat rectangle this size is a billboard: it has no profile from the
  // side, no terminator across its face, and nothing for the key light to do.
  const shieldZ = 876;
  b.both((s) => {
    b.add(chamferBox(300.0, 440.0, 150.0, {
      chamfer: 26.0, chamferZ: 30.0, taperFront: 0.72, wTop: 196.0, wBot: 248.0,
    }), { mirrorX: s < 0, x: 132.0, y: 16.0, z: shieldZ - 34, ry: -s * 0.34, variant: PLATE.ARMOUR, wear: 0.62 });
    // Wing cap: the outboard edge steps back and down, so the top line of the
    // shield is a slope rather than a ruled edge.
    b.add(chamferBox(96.0, 150.0, 112.0, {
      chamfer: 18.0, chamferZ: 22.0, taperFront: 0.68, wTop: 52.0,
    }), { mirrorX: s < 0, x: 250.0, y: -66.0, z: shieldZ - 70, ry: -s * 0.5, rz: s * 0.22, variant: PLATE.ARMOUR, wear: 0.72 });
    b.addParts(ribBand(b.lod(6, 4, 2, 0), shieldZ - 96, shieldZ + 16, 44.0, 330.0, 15.0, {
      variant: PLATE.ARMOUR,
    }), { mirrorX: s < 0, x: 236.0, y: 6.0, ry: -s * 0.34 });
  });
  // Centre spine and ram boss where the two halves meet. The spine runs high
  // and low past the keel line on purpose — it is the only thing giving the
  // bow any profile from broadside, where the chevron is edge-on.
  b.add(chamferBox(96.0, 500.0, 176.0, { chamfer: 22.0, chamferZ: 30.0, taperFront: 0.66, wTop: 58.0 }), {
    y: 16.0, z: shieldZ - 26, variant: PLATE.ARMOUR, wear: 0.7,
  });
  b.add(chamferBox(52.0, 150.0, 132.0, { chamfer: 13.0, chamferZ: 22.0, taperFront: 0.6, wTop: 26.0 }), {
    y: 300.0, z: shieldZ - 54, variant: PLATE.PANEL, wear: 0.4,
  });
  b.add(chamferBox(70.0, 120.0, 116.0, { chamfer: 16.0, chamferZ: 20.0, taperFront: 0.7, wTop: 34.0 }), {
    y: -256.0, z: shieldZ - 48, variant: PLATE.ARMOUR, wear: 0.66,
  });
  b.add(chamferBox(150.0, 196.0, 76.0, { chamfer: 20.0, chamferZ: 22.0, taperFront: 0.42, wTop: 84.0 }), {
    y: 6.0, z: shieldZ + 66, variant: PLATE.ARMOUR, wear: 0.9,
  });
  b.addParts(ribBand(b.lod(7, 4, 2, 0), shieldZ - 70, shieldZ + 30, 116.0, 356.0, 14.0, {
    variant: PLATE.ARMOUR, y: 6.0,
  }), {});
  b.both((s) => {
    b.add(chamferBox(30.0, 70.0, 210.0, { chamfer: 8.0, chamferZ: 15.0, taperFront: 0.7 }), {
      mirrorX: s < 0, x: 164.0, y: 2.0, z: 786.0, ry: -s * 0.46, variant: PLATE.PANEL, wear: 0.45,
    });
    b.add(chamferBox(26.0, 48.0, 186.0, { chamfer: 7.0, chamferZ: 13.0, taperFront: 0.75 }), {
      mirrorX: s < 0, x: 146.0, y: -84.0, z: 790.0, ry: -s * 0.4, rz: s * 0.3,
      variant: PLATE.PANEL, wear: 0.5,
    });
    winBay(ctx, 260.0, 13.0, 4.4, 3.4, {
      mirrorX: s < 0, x: 236.0, y: 104.0, z: shieldZ - 4, ry: -Math.PI / 2,
      rows: 2, rowPitch: 9.0, fill: 0.6, depth: 4.0,
    });
    b.addParts(dish(30.0, { sides: b.lod(16, 12, 8, 6), rows: 4 }), {
      mirrorX: s < 0, x: 216.0, y: 206.0, z: shieldZ - 20, rx: -0.3, ry: s * 0.5,
      variant: PLATE.PANEL, wear: 0.4,
    });
  });
  winBay(ctx, 300.0, 14.0, 5.0, 4.0, {
    y: 132.0, z: shieldZ + 56, rows: 3, rowPitch: 12.0, fill: 0.66, depth: 4.6,
  });

  /* ---------------------------------------------------------- docking arms */

  // Two arms sweeping forward from the tower shoulders, toed inward so the
  // pair closes on the centreline like a claw. The port arm reaches further:
  // this hull has been rebuilt round whatever it lost, and a matched pair
  // reads as a CAD default.
  const armSpecs = [
    { s: 1, len: 420, out: 250, y: 72, z: 340, yaw: 0.11 },
    { s: -1, len: 496, out: 268, y: 38, z: 320, yaw: 0.124 },
  ];
  for (const a of armSpecs) {
    const place = { mirrorX: a.s < 0, x: a.out, y: a.y, z: a.z, ry: -a.yaw };
    const along = (t) => ({
      x: a.out - Math.sin(a.yaw) * a.len * t,
      z: a.z + Math.cos(a.yaw) * a.len * t,
    });

    b.add(chamferBox(126.0, 148.0, 168.0, { chamfer: 20.0, chamferZ: 28.0, wTop: 84.0 }), {
      mirrorX: a.s < 0, x: a.out - 30, y: a.y, z: a.z - 48, variant: PLATE.ARMOUR, wear: 0.45,
    });
    b.add(chamferBox(120.0, 52.0, 146.0, { chamfer: 14.0, chamferZ: 22.0, taperFront: 0.8 }), {
      mirrorX: a.s < 0, x: a.out - 62, y: a.y - 84, z: a.z - 36, rz: a.s * 0.4,
      variant: PLATE.PANEL, wear: 0.5,
    });

    // Solid for the first stretch, open truss beyond. The change of
    // construction is what tells you how long the thing is.
    const solid = a.len * 0.4;
    b.add(loft(decimateStations([
      { z: 0, w: 104, h: 126 },
      { z: solid * 0.5, w: 90, h: 106 },
      { z: solid, w: 72, h: 86 },
    ].map((p) => ({
      z: p.z,
      pts: rectSection(p.w, p.h, { wTop: p.w * 0.72, wBot: p.w * 0.9, chamfer: p.h * 0.17 }),
    })), b.lod(1, 1, 2, 3)), {}), { ...place, variant: PLATE.ARMOUR, wear: 0.35 });
    b.addParts(ribBand(b.lod(7, 4, 2, 0), 26, solid - 22, 116.0, 136.0, 10.0, { variant: PLATE.MECH }), place);

    const trussLen = a.len * 0.46;
    const mid = along((solid + trussLen * 0.5) / a.len);
    b.addParts(truss(trussLen, 58.0, 74.0, b.lod(7, 5, 3, 1), {
      thickness: 12.0, variant: PLATE.MECH, wear: 0.5, diagonals: b.detail < 2,
    }), { ...place, x: mid.x, z: mid.z });
    b.addParts(catwalk(trussLen * 0.9, 17.0, 2.6), {
      ...place, x: mid.x, y: a.y + 44, z: mid.z, wear: 0.5,
    });

    // Clamp head: a lit docking throat facing inboard at the arm's tip.
    const tip = along(0.93);
    b.add(chamferBox(66.0, 104.0, 112.0, { chamfer: 14.0, chamferZ: 19.0, wTop: 42.0 }), {
      mirrorX: a.s < 0, x: tip.x + 13, y: a.y + 6, z: tip.z, variant: PLATE.ARMOUR, wear: 0.5,
    });
    b.addParts(pocket(70.0, 70.0, 32.0, { chamfer: 9.0, taper: 0.7, lit: true, variant: PLATE.MECH }), {
      mirrorX: a.s < 0, x: tip.x - 24, y: a.y + 6, z: tip.z, ry: Math.PI / 2, wear: 0.6,
    });
    for (const dz of [-1, 1]) {
      b.add(chamferBox(40.0, 28.0, 24.0, { chamfer: 7.0, chamferZ: 7.0, taperFront: 0.6 }), {
        mirrorX: a.s < 0, x: tip.x - 13, y: a.y + 6, z: tip.z + dz * 48, rx: dz * 0.3,
        variant: PLATE.MECH, wear: 0.7,
      });
    }
    ctx.dock.push(new THREE.Vector3(a.s * (tip.x - 48), a.y + 6, tip.z));
    light(ctx, a.s * (tip.x - 28), a.y + 50, tip.z, NAV.hangar, 0.9, 6.0);
    light(ctx, a.s * (tip.x - 28), a.y - 36, tip.z, NAV.hangar, 0.9, 5.0);
  }

  /* ----------------------------------------------------------- hangar bays */

  // Four flank mouths, staggered so neither side matches the other. 220 m
  // across and 100 m tall: a 130 m frigate flies in without ducking.
  const bays = [{ s: 1, z: 150 }, { s: -1, z: -40 }, { s: 1, z: -412 }, { s: -1, z: -580 }];
  for (const bay of bays) {
    b.addParts(hangarBay(rng, 220.0, 100.0, 86.0, {
      chamfer: 10.0, frame: 19.0,
      ribs: b.lod(6, 4, 2, 0), sideRibs: b.lod(4, 3, 0, 0), lamps: b.lod(11, 7, 0, 0),
    }), { mirrorX: bay.s < 0, x: 216.0, y: -14.0, z: bay.z, ry: -Math.PI / 2 });
    winBay(ctx, 190.0, 9.5, 3.4, 2.6, {
      mirrorX: bay.s < 0, x: 220.0, y: 62.0, z: bay.z, ry: -Math.PI / 2,
      rows: 2, rowPitch: 7.0, fill: 0.7, depth: 3.4,
    });
    ctx.dock.push(new THREE.Vector3(bay.s * 280.0, -14.0, bay.z));
    light(ctx, bay.s * 234.0, 48.0, bay.z + 114.0, NAV.hangar, 0.8, 4.5);
    light(ctx, bay.s * 234.0, 48.0, bay.z - 114.0, NAV.hangar, 0.8, 4.5);
  }

  // Main ventral bay: the one the capital ships use, cut up into the pod.
  b.addParts(hangarBay(rng, 300.0, 128.0, 100.0, {
    chamfer: 13.0, frame: 24.0,
    ribs: b.lod(7, 4, 2, 0), sideRibs: b.lod(4, 3, 0, 0), lamps: b.lod(13, 8, 0, 0),
  }), { y: -322.0, z: 20.0, rx: -Math.PI / 2 });
  ctx.dock.push(new THREE.Vector3(0, -410.0, 20.0));
  light(ctx, 0, -330.0, 176.0, NAV.hangar, 0.7, 7.0);

  /* --------------------------------------------------------------- batteries */

  // Six bastion mains flanking the sail and the chasm, ten flak along the belt.
  placeTurret(ctx, 32.0, { x: 120.0, y: 296.0, z: -100.0, barrels: 2, barrelLen: 98.0 });
  placeTurret(ctx, 32.0, { x: -132.0, y: 296.0, z: -206.0, barrels: 2, barrelLen: 98.0 });
  placeTurret(ctx, 30.0, { x: 126.0, y: 296.0, z: -430.0, barrels: 2, barrelLen: 90.0, ry: Math.PI });
  placeTurret(ctx, 30.0, { x: -128.0, y: 296.0, z: -546.0, barrels: 2, barrelLen: 90.0, ry: Math.PI });
  placeTurret(ctx, 28.0, { x: 148.0, y: 152.0, z: 208.0, barrels: 2, barrelLen: 84.0 });
  placeTurret(ctx, 28.0, { x: -152.0, y: 152.0, z: 96.0, barrels: 2, barrelLen: 84.0 });
  const flak = [[1, 640], [-1, 560], [1, 300], [-1, 60], [1, -160], [-1, -290], [1, -500], [-1, -640], [1, -716], [-1, -772]];
  for (const [s, z] of flak) {
    b.add(chamferBox(34.0, 38.0, 80.0, { chamfer: 8.0, chamferZ: 13.0, taperFront: 0.72 }), {
      mirrorX: s < 0, x: 208.0, y: -64.0, z, variant: PLATE.ARMOUR, wear: 0.45,
    });
    placeTurret(ctx, 13.0, { mirrorX: s < 0, x: 226.0, y: -64.0, z, rz: -Math.PI / 2, barrels: 2, barrelLen: 28.0 });
  }

  /* ------------------------------------------------------------ drive block */

  // A recessed engineering bay rather than a flat plate: eight mains in two
  // banks sunk into a housing, four verniers outboard, heat towers above.
  b.add(chamferBox(376.0, 316.0, 104.0, { chamfer: 32.0, chamferZ: 19.0, wTop: 272.0 }), {
    y: -74, z: -890.0, variant: PLATE.MECH, wear: 0.5,
  });
  // The recess opens astern and the bells sit just inside its lip. Rotating
  // the pocket to face forward buries every engine mouth behind 16 m of hull,
  // which kills the stern glow outright — the bloom pass can only work with
  // emissive surfaces it can actually see.
  b.addParts(pocket(320.0, 262.0, 38.0, { chamfer: 18.0, taper: 0.9, variant: PLATE.MECH }), {
    y: -74, z: -940.0, wear: 0.8,
  });
  for (const [x, y] of [[-138, 66], [-46, 74], [46, 74], [138, 66], [-138, -46], [-46, -54], [46, -54], [138, -46]]) {
    thruster(ctx, x, y - 74, -936.0, 34.0);
  }
  for (const [x, y] of [[-186, 8], [186, 8], [-72, -158], [72, -158]]) {
    thruster(ctx, x, y - 74, -922.0, 15.0);
  }
  b.both((s) => {
    b.addParts(radiator(22.0, 250.0, 9.0, b.lod(14, 8, 0, 0)), {
      mirrorX: s < 0, x: 208.0, y: 212.0, z: -662.0, rz: s * -0.86, variant: PLATE.PANEL, wear: 0.4,
    });
    // Swept outboard rather than straight down: a vertical fin under the keel
    // hangs off the hull like a rake and snags the ventral silhouette.
    b.addParts(radiator(14.0, 116.0, 6.5, b.lod(9, 5, 0, 0)), {
      mirrorX: s < 0, x: 206.0, y: -186.0, z: -520.0, rz: s * -0.46, variant: PLATE.PANEL, wear: 0.45,
    });
    b.add(chamferBox(44.0, 134.0, 88.0, { chamfer: 11.0, chamferZ: 15.0, wTop: 28.0 }), {
      mirrorX: s < 0, x: 172.0, y: 122.0, z: -818.0, variant: PLATE.MECH, wear: 0.55,
    });
    b.addParts(ribBand(b.lod(6, 4, 2, 0), -852, -784, 50.0, 142.0, 7.0, { variant: PLATE.MECH, y: 122.0 }), {
      mirrorX: s < 0, x: 172.0,
    });
  });

  /* ------------------------------------------------------------ fine detail */

  if (b.detail < 2) {
    // Masts are kept short. A 200 m whisker adds a third of the ship's height
    // to the silhouette and contributes nothing to it but fuzz.
    b.addParts(mast(rng, 138.0, 6.4, { arms: 6 }), { x: 44.0, y: sail.top - 24, z: -570.0, rz: -0.05, wear: 0.5 });
    b.addParts(mast(rng, 96.0, 4.6, { arms: 5 }), { x: -56.0, y: sail.top - 30, z: -178.0, rz: 0.07, wear: 0.5 });
    b.addParts(mast(rng, 74.0, 3.6, { arms: 4 }), { x: 62.0, y: 544.0, z: tower.z - 50, rz: -0.1, wear: 0.5 });
    b.addParts(dish(38.0, { sides: b.lod(18, 12, 8, 6), rows: 5 }), {
      x: 118.0, y: 306.0, z: -636.0, rx: -0.5, ry: 0.9, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(dish(26.0, { sides: b.lod(16, 12, 8, 6), rows: 4 }), {
      x: -124.0, y: 302.0, z: -300.0, rx: -0.35, ry: -1.0, variant: PLATE.PANEL, wear: 0.35,
    });
    // Hung off the tower's flank, not planted on its roof: a dish on top turns
    // any block into a mushroom.
    b.addParts(dish(24.0, { sides: b.lod(14, 10, 8, 6), rows: 3 }), {
      x: -122.0, y: 452.0, z: tower.z + 30, rx: -0.25, ry: -1.1, variant: PLATE.PANEL, wear: 0.35,
    });
    b.addParts(catwalk(720.0, 26.0, 3.4), { x: 176.0, y: 94.0, z: -240.0, wear: 0.5 });
    b.addParts(catwalk(470.0, 24.0, 3.2), { x: -182.0, y: 94.0, z: 170.0, wear: 0.5 });
    b.addParts(catwalk(560.0, 20.0, 2.8), { x: 118.0, y: 290.0, z: -330.0, wear: 0.5 });
    b.addParts(catwalk(420.0, 18.0, 2.6), { x: -126.0, y: 290.0, z: -300.0, wear: 0.5 });

    // Plate layers: a mid-scale pass between the belts and the fine greeble.
    b.addParts(armourPlates(rng, {
      x0: -180, x1: 180, z0: -800, z1: 580, y: 156.0, size: g * 7.0, count: 150,
      variant: PLATE.ARMOUR, width: (z) => hw(z) * 0.8, keep: b.lod(1, 0.4, 0, 0),
    }), {});
    b.both((s) => b.addParts(armourPlates(rng, {
      x0: 204, x1: 218, z0: -800, z1: 620, y: -100.0, size: g * 6.0, count: 110,
      variant: PLATE.ARMOUR, keep: b.lod(1, 0.4, 0, 0), aspect: 3.4, rzBase: s * Math.PI * 0.5,
    }), { mirrorX: s < 0 }));
    b.addParts(armourPlates(rng, {
      x0: -deck.wt * 0.44, x1: deck.wt * 0.44, z0: deck.z - deck.d * 0.45, z1: deck.z + deck.d * 0.45,
      y: deck.y + deck.h * 0.5, size: g * 5.0, count: 46, variant: PLATE.PANEL,
      keep: b.lod(1, 0.4, 0, 0),
    }), { x: -8.0 });

    // Fine greeble. Deliberately the smallest absolute fittings in the fleet.
    b.addParts(greebleField(rng, {
      x0: -170, x1: 170, z0: -800, z1: 580, y: 156.0, size: g, count: 620,
      width: (z) => hw(z) * 0.76, keep: b.lod(1, 0.35, 0, 0),
    }), {});
    b.both((s) => b.addParts(greebleField(rng, {
      x0: 206, x1: 222, z0: -800, z1: 620, y: -80.0, size: g, count: 330, sink: 0.7,
      keep: b.lod(1, 0.35, 0, 0),
    }), { mirrorX: s < 0 }));
    b.addParts(greebleField(rng, {
      x0: -150, x1: 150, z0: -740, z1: 380, y: -330.0, size: g, count: 260, sink: 0.6,
      keep: b.lod(1, 0.35, 0, 0),
    }), {});
    b.addParts(greebleField(rng, {
      x0: -deck.wt * 0.42, x1: deck.wt * 0.42, z0: deck.z - deck.d * 0.44, z1: deck.z + deck.d * 0.44,
      y: deck.y + deck.h * 0.5, size: g * 0.7, count: 210, keep: b.lod(1, 0.35, 0, 0),
    }), { x: -8.0 });
    b.both((s) => b.addParts(greebleField(rng, {
      x0: 34, x1: 52, z0: -640, z1: -50, y: 340.0, size: g * 0.75, count: 130, sink: 0.72,
      keep: b.lod(1, 0.35, 0, 0),
    }), { mirrorX: s < 0, x: sail.x }));
    b.addParts(greebleField(rng, {
      x0: -70, x1: 70, z0: tower.z - 80, z1: tower.z + 80, y: 462.0, size: g * 0.7, count: 90,
      keep: b.lod(1, 0.35, 0, 0),
    }), { x: 6.0 });
    b.addParts(greebleField(rng, {
      x0: -220, x1: 220, z0: shieldZ - 40, z1: shieldZ + 30, y: 178.0, size: g * 0.9, count: 90,
      keep: b.lod(1, 0.35, 0, 0),
    }), {});

    // Fourth tier: rivets, vents and conduit boxes at ~0.9 m. Invisible past a
    // kilometre by design — this tier exists purely for the 200 m read, and it
    // is what carries the jump from "big model" to "structure you could walk
    // on". A fighter has no equivalent tier; that gap is the scale cue.
    const stud = g * 0.28;
    b.addParts(greebleField(rng, {
      x0: -170, x1: 170, z0: -800, z1: 560, y: 156.0, size: stud, count: 900, tall: 1.1,
      width: (z) => hw(z) * 0.74, keep: b.lod(1, 0.25, 0, 0), simple: true,
    }), {});
    b.both((s) => b.addParts(greebleField(rng, {
      x0: 208, x1: 222, z0: -800, z1: 620, y: -60.0, size: stud, count: 520, sink: 0.7, tall: 1.1,
      keep: b.lod(1, 0.25, 0, 0), simple: true,
    }), { mirrorX: s < 0 }));
    b.addParts(greebleField(rng, {
      x0: -deck.wt * 0.44, x1: deck.wt * 0.44, z0: deck.z - deck.d * 0.46, z1: deck.z + deck.d * 0.46,
      y: deck.y + deck.h * 0.5, size: stud, count: 420, tall: 1.1,
      keep: b.lod(1, 0.25, 0, 0), simple: true,
    }), { x: -8.0 });
    b.both((s) => b.addParts(greebleField(rng, {
      x0: 36, x1: 54, z0: -640, z1: -50, y: 300.0, size: stud, count: 260, sink: 0.7, tall: 1.1,
      keep: b.lod(1, 0.25, 0, 0), simple: true,
    }), { mirrorX: s < 0, x: sail.x }));
    b.addParts(greebleField(rng, {
      x0: -110, x1: 110, z0: -740, z1: 380, y: -330.0, size: stud, count: 380, sink: 0.6, tall: 1.1,
      keep: b.lod(1, 0.25, 0, 0), simple: true,
    }), {});
  }

  /* ------------------------------------------------------------ team livery */

  // Bold graphic areas painted straight on to the hull skin, not applied trim.
  // Each has to survive the ship being twenty pixels tall at five kilometres,
  // so the smallest of them is still ~150 m across.
  b.paint({ // flank blazon on the keel, forward block
    x0: 180, x1: 300, y0: -140, y1: 30, z0: -180, z1: 300,
    n: [1, 0, 0], nMin: 0.4, mirror: true,
  });
  b.paint({ // matching block well aft, so the two read as one long stripe
    x0: 180, x1: 300, y0: -140, y1: 30, z0: -800, z1: -620,
    n: [1, 0, 0], nMin: 0.4, mirror: true,
  });
  b.paint({ // the sail: the single boldest area on the ship, both faces
    x0: -110, x1: 94, y0: 300, y1: 386, z0: -650, z1: -40,
    n: [1, 0, 0], nMin: 0.3, mirror: true,
  });
  b.paint({ // sail top beam — a cap stripe read from above and from the side
    x0: -110, x1: 94, y0: 668, y1: 736, z0: -630, z1: -60,
  });
  b.paint({ // dock tower crown
    x0: -120, x1: 130, y0: 440, y1: 560, z0: tower.z - 100, z1: tower.z + 100,
    n: [1, 0, 0], nMin: 0.3, mirror: true,
  });
  b.paint({ // bow shield chevron
    x0: -280, x1: 280, y0: 60, y1: 200, z0: shieldZ - 60, z1: shieldZ + 40,
    n: [0, 1, 0], nMin: 0.25,
  });
  b.paint({ // drive-block collar
    x0: -300, x1: 300, y0: -250, y1: 110, z0: -884, z1: -838,
    n: [0, 0, -1], nMin: 0.45,
  });
  b.paint({ // docking-arm flashes
    x0: 170, x1: 400, y0: -30, y1: 150, z0: 270, z1: 480,
    n: [0, 1, 0], nMin: 0.4, mirror: true,
  });

  navSet(ctx, 224.0, -92.0, -360.0, 8.0, 2.4);
  navSet(ctx, 224.0, -92.0, 200.0, 8.0, 2.4);
  navSet(ctx, 258.0, 30.0, shieldZ, 8.0, 2.4);
  light(ctx, sail.x, sail.top + 18, -34.0, NAV.beacon, 2.9, 8.0);
  light(ctx, 44.0, sail.top + 194, -570.0, NAV.beacon, 1.5, 7.0);
  light(ctx, 6.0, 556.0, tower.z + 6, NAV.beacon, 2.2, 7.0);
  light(ctx, 0, 190.0, shieldZ + 74, NAV.deck, 1.2, 6.0);
  light(ctx, 0, -402.0, -880.0, NAV.deck, 2.0, 6.0);
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
