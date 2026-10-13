import * as THREE from '../../vendor/three/build/three.module.js';
import { bus } from './events.js';
import { makeRng } from './rng.js';
import { rockFadeUniform, ROCK_FADE_SLOTS, ROCK_FADE_FAR } from '../render/rock-fade.js';

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

/* Trauma produced by a blast of `strength` 1.0 going off in the camera's lap.

   FX normalises `strength` so 1.0 is a destroyer's primary detonation. Measured
   off the bus after FX moved to `(L/380)^0.8`: interceptor 0.023, assault
   frigate 0.187, destroyer 1.000, cruiser 1.479, carrier 1.741, mothership
   3.624, ion lance 0.105-0.135. The rig therefore needs no ship-class table and
   no mirrored beat timings: it is handed the magnitude and the moment.

   Every class from the destroyer up saturates the clamp at point-blank range
   (1.0 x 1.8 already exceeds it), so at zero distance a destroyer and a
   mothership shove the camera identically and only the falloff separates them.
   That was equally true of the old scale, so it is not a regression — but it is
   the next thing to fix here if the ladder is ever judged too flat. */
const SHAKE_GAIN = 1.8;

/* FX's `radius` is the blast's *physical* reach — a destroyer's primary
   measures 684 m, which is the fireball, not the range over which the event is
   felt. Treating it as a hard cutoff meant the camera only shook when it was
   already inside the explosion. You feel a capital go up from well outside the
   fireball, so the felt range is a multiple of it, with a floor so that even a
   small, tight blast close by registers. */
const FELT_REACH = 10;
const MIN_FELT_REACH = 2500;

/* Below this a blast is a firework, not an event. It exists so that a dogfight
   on top of the camera cannot hold a permanent low tremor: trauma decays at
   1.05/s, so ten ungated fighter pops a second inside the felt reach would sit
   at 0.1-0.4 trauma indefinitely, which is 1-8 px of continuous wobble.

   Re-placed after FX rescaled to `(L/380)^0.8`. The old 0.010 was set when a
   fighter pop measured 0.002; a fighter now measures **0.023** and was clearing
   the gate on every kill. The band the gate has to thread, from FX's figures:

     interceptor        0.023   must not register
     frigate secondary  ~0.030  lost, and accepted — see below
     destroyer secondary ~0.07  must survive: an earlier 0.08 swallowed the
                                destroyer's entire hull-failure rumble
     ion lance          0.105   must register
     assault frigate    0.187   must register

   0.035 keeps a factor of 1.5 over a fighter and 2 under the destroyer's
   rumble. It costs the quietest beats of a frigate's sequence, which are a
   fifth of that frigate's own primary and are not the event.

   Honesty note: the primaries above are FX's measurements. The *secondary*
   figures are inferred from the within-sequence ratios of the old scale, on the
   grounds that the rescale changed the per-class normalisation and not the mix
   of beats inside a sequence. `.local/blastscale.mjs` was written to measure
   them directly and could not — `world.destroy()` removes an entity without
   running the death choreography, so only three stray 0.0204 beats came back
   across all thirteen classes. If FX ever publishes measured secondaries,
   re-check this number against them. */
const SHAKE_MIN_STRENGTH = 0.035;

/* Displacement goes as trauma^SHAKE_CURVE. Squaring is the usual choice, and it
   was right when this rig invented its own magnitudes — the curve supplied the
   dynamic range. FX now encodes that range in `strength` itself, so a steep
   curve double-counts it: at 1.7 a destroyer's secondaries came out 96x below
   its primary and vanished.

   1.3 was chosen against a 5,500:1 span and the span is now 178:1, so the
   argument for softening it further has weakened — but it has not reversed, and
   the ladder it produces on the new figures is still right: a frigate primary
   lands at roughly a quarter of a destroyer's, a destroyer's own rumble at a
   twentieth. Left alone deliberately; the flat top end is the clamp's doing,
   not the curve's, and `SHAKE_GAIN` is where that would be fixed. */
const SHAKE_CURVE = 1.3;

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
const _m1 = new THREE.Matrix4();
const _p1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _s1 = new THREE.Vector3();
const _try = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _sun = new THREE.Vector3();
const _axA = new THREE.Vector3();
const _axB = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _n1 = new THREE.Vector3();
const _nm = new THREE.Matrix3();

/* Anything smaller than this cannot hide a capital ship and is not worth
   orbiting around; the rock fields are full of them. Anything larger than the
   ceiling is scenery, not an obstacle — the nebula shells and dust volumes are
   tens of kilometres across and the camera lives *inside* them. The biggest
   landmark ENV builds is under 6 km. */
const OCCLUDER_MIN_RADIUS = 220;
const OCCLUDER_MAX_RADIUS = 12000;
const MAX_STATIC_OCCLUDERS = 192;
const MAX_SCANNED_INSTANCES = 4096;
const HARVEST_INTERVAL_MS = 2000;

/* An obstruction is not a distance, it is an angle. A three-kilometre gap
   sounds generous until the thing three kilometres away is a two-kilometre
   rock, at which point it is a close-up of a rock face. A body counts as being
   in the way when its angular radius from the camera exceeds this share of the
   frame's half-height *and* it overlaps the middle of the shot. */
const OCCLUSION_FRACTION = 0.25;

/* Behind the subject is a different question from in front of it.

   Round 3's close frames put a dark frigate against a wall of rock of exactly
   its own value, and nothing above objected: the wall was a dozen 60-200 m
   boulders, every one of them under OCCLUDER_MIN_RADIUS, none of them between
   the camera and the hull. The ship was perfectly visible and could not be
   seen. So a chosen framing also asks how much of the patch of frame around
   the subject is rock *behind* it, counting rocks down to BACKDROP_MIN_RADIUS,
   and prefers the nearest approach where that share is under BACKDROP_OK. A
   share is an angle, like everything else here, so it means the same at every
   zoom. Beyond BACKDROP_REACH shot-lengths a rock is scenery, not backdrop. */
const BACKDROP_MIN_RADIUS = 12;
const MAX_BACKDROP = 6000;
const BACKDROP_OK = 0.3;
const BACKDROP_REACH = 40;

/* Near-plane safety. The hard occluders stop at OCCLUDER_MIN_RADIUS, so a
   35 m rock between a 60 m close-up and its subject was invisible to every
   test here: the camera flew straight into it, the near plane sliced it, and
   the frame was a flat black polygon with ruler-straight edges (round 4,
   `R4-s99-first-contact-close`). Every frame the rig now sphere-casts from the
   subject toward the camera against the bounding sphere of every rock near
   the shot and pulls the camera in to just short of the first one it meets.

   Pull, not fade. Fading would need a per-instance opacity on the shared rock
   material, a transparent pass with its sorting problems, and a change on the
   render side — and a faded rock the near plane is inside still shows its cut.
   Pulling in is a few dozen ray-sphere tests on the CPU and cannot leave the
   camera inside anything it knows about.

   It comes in fast and gives the distance back slowly, so a small rock
   crossing the line costs one smooth dip rather than a pop or a flutter; a
   hard limit under the smoothing means no frame is ever inside a rock while
   the smoothing catches up. */
const NEAR_ROCK_MIN_RADIUS = 3;
const MAX_NEAR_ROCKS = 12000;
const NEAR_CANDIDATES = 64;
const PULL_IN_RATE = 14;     // 1/s: most of the way in within ~0.15 s
const PULL_OUT_RATE = 1.4;   // 1/s: gives the shot back over ~1.5 s

/* A hard guarantee, not a statistical one (R6 fix 2).

   Round 5 still put the camera inside rock on 3 moves in 10 on seed 13634,
   one of them a black frame. The cause was the sphere. A rock is a displaced
   sphere stretched by up to 3:1 (`shape.axis` 0.42-1.30), so a ship can fly
   inside its bounding sphere in open water; round 5 then cast against a sphere
   shrunk to the ship's height over the centre, and that sphere does not hold a
   flat rock's long axis. The camera orbited straight into the mesh.

   So every near-rock record now carries an ellipsoid built from the geometry's
   own vertices and the instance rotation and scale. It holds every vertex, so,
   being convex, it holds the mesh. Pull-in, push-out and the focus search all
   test that hull grown by the near-plane band, and the final camera position
   is checked against every hull in reach after sway and shake: a rock whose
   hull the near quad is inside, or within a short ramp of, is dither-faded by
   the rock shader, reaching zero before the quad touches it. A subject inside
   a rock's hull is the case this handles; nothing can frame it from outside.
   Fading was chosen over holding the camera because a held camera stops
   following a ship that loiters by a rock, and the player reads that as the
   camera breaking. Holding the last safe position remains as the fallback
   when more rocks than there are fade slots would need fading at once. */
const _hullHit = [0, 0];
const _mh = new THREE.Matrix4();

/* ------------------------------------------------------------ opening shot */

/* The first frame of a run is the single most-seen image in the demo, so the
   rig composes it rather than being handed a distance.

   Four numbers were measured on the same opening frame and they do not agree:
   a world-axis Box3 projects to 806 px, the oriented local box to 620 px, this
   rig's own report to 573 px, and the pixels actually painted to 455 px — 24%
   of a 1920 px frame. The Box3 figures are inflated because a 1,900 m hull
   yawed 30 degrees is not a brick; the honest number is the projection of the
   *geometry*, which measures 484 px on the same frame and is what `_spanAt`
   computes. Everything below is stated against that measure. */
/* Where a focus move leaves the key light (R5 fix 3).

   The opening is aimed into a sun band, but every later framing - F on a
   selection, a jump to an event, a script's focusOn - kept whatever yaw the
   camera already had. Measured in play on seed 13634, the R4 close recipe put
   the camera 21 degrees off the key (the key behind the lens): the whole
   visible side of an assault frigate was lit, p10/p90 of hull pixels 22/135,
   with the key alone accounting for p50 81 -> 4. Swept over bow headings the
   same recipe front-lit 130 of 360. Exposure was not it (1.13-1.22, and
   pinning it to 1.0 moved p90 by 8 per cent); neither was the indirect rig.
   The floor is 90, not 60: at 60 the same hull still measured p10/p90 0.20,
   at 97-123 it measured 0.087 - a shadow side only shows once the lens is at
   least square to the key.

   Angles here are between the camera offset (subject to lens) and the
   direction to the star, so 0 is front-lit and 180 is a silhouette. A focus
   move outside the band swings yaw only, by the least amount that lands on
   the nearer edge, so pitch survives; F on a selection also prefers the edge
   that keeps the biggest hull broadside. The opening composes through
   _composeOpening and is never touched. */
const KEY_QUARTER = {
  min: 90 * DEG,
  max: 130 * DEG,
};

const OPENING = {
  /* Share of frame the hero's projected geometry should span. The rubric asks
     for a painted silhouette of 45-55% of the width; the height cap is what
     stops the same solve cropping the masts off a hull that happens to present
     itself diagonally — measured at 1,200 px of a 1,080 px frame before it
     existed. Whichever axis binds first sets the distance. */
  fillW: 0.52,
  fillH: 0.88,
  /* Silhouette must stay inside this share of the frame once the composition
     offset is applied, which is what caps the offset on a big presentation. */
  margin: 0.97,
  /* And never further out than this, whatever the fill solve wants. Framing off
     hull length is the constraint that stops a wide hull being flown into and a
     narrow one being left as a speck. */
  hullMultipleMin: 1.0,
  hullMultipleMax: 1.2,

  /* Angle between the view direction and the direction to the star, at the
     subject. 90 degrees is pure side-light; 180 is the star directly behind the
     camera and a flat, shadowless hull. This band keeps a hard terminator with
     the lit flank facing the camera, and it is the constraint ENV asked for.

     Crucially the camera is aimed *from* the seeded sun rather than seeded
     independently, so the relative angle holds however ENV moves the star. The
     star's azimuth stays uniformly seeded and ENV must not close the loop by
     aiming it at the camera; only this end of the relationship is constrained.

     The band is deliberately *not* narrowed, and the two claims that used to
     argue about it here have both been retired by a re-measurement (29 Sep,
     post ENV's key:fill rig fix). 8 seeds x 4 bands x a boot each, one
     variable: `alpha` consumes exactly one `rng.range` draw whatever the band
     is, so every downstream seeded decision is unchanged. The bands were
     injected into the served module rather than written to disk, so the run
     could not leave a patched file behind. `.local/laneB-band.mjs` runs it,
     `.local/laneB-band.json` holds it, `.local/laneB-table.mjs` reads it.

     Both earlier claims were **between-seed**, and a seed sets the palette,
     the hull, the star's elevation and the angle all at once. Held one seed at
     a time, the answer changes:

       · The angle IS a discriminator, contrary to "not the discriminator it
         looks like". Area-weighted over camera-facing hull, the share of the
         visible hull that is lit rises with the angle on 7 of 8 seeds, mean
         -0.149 of terminator balance per +10 degrees. Raising the floor to
         116 — the exact edit the older paragraph reported as harmless — costs
         balance on 8 of 8, up to -0.67 on 13634 and -0.63 on nightbloom.
       · But it is a WEAK discriminator, contrary to "the three widest angles
         are the three weakest terminators". kharak reverses sign inside its
         own seed: 115.2 degrees scores 0.64, 111.4 degrees scores 0.32. The
         band sets the cone's half-angle; the phase *around* the cone is
         picked by the framing score below, and the phase is what decides
         which flank faces the key. On a 1,900 m slab that swamps the angle.

     And narrowing buys nothing. Mean terminator balance, worst seed, and the
     painted silhouette, over the same 8 seeds:

       104-134 (this)   bal 0.779  worst 0.464   painted 42.8-52.1%
       104-116          bal 0.767  worst 0.315   painted 34.3-52.1%
       100-112          bal 0.731  worst 0.210   painted 23.5-52.7%
       116-134          bal 0.537  worst 0.355   painted 42.1-53.4%

     The current band is the best of the four on the mean AND on the worst
     seed, and it is the only one that never drops a hero frame under 42% of
     frame width. Both narrow candidates fail on kharak, which under 100-112
     opens nose-on as a narrow tower at 23.5% — the earlier agent's "narrowing
     costs framing", and it is visible in `.local/shots/laneB-band/`, not just
     in the number. **Do not narrow this band.** If the wide end ever has to be
     policed, police it after the composition offset, not here — see below.

     Two instrument notes, because this question has now consumed three passes:

     · These two constants do not control the shipped angle. `_composeOpening`
       rotates the camera toward the star after the band has had its say, and
       that subtracts 0.8-11.7 degrees, per seed, unpredictably: 104-134 ships
       103.1-124.7, and 4242 draws 118.2 but ships 106.6. Any measurement of
       "view-to-key" taken off a frame is of the composed angle, not the drawn
       one. `.local/laneB-angle.mjs` prints all three.
     · Do not use hull quantiles for this. `shadowFraction`, `deepFraction`
       and `p25OverP75` are graded by the auto-exposure meter, so a flatter
       frame that meters brighter scores as having MORE shadow. Measured
       inversions: 13634 at 116-134 looks flat and scores shadow 0.025 ->
       0.157; emberfall at 104-116 visibly gains a terminator and scores
       0.025 -> 0.006. The area-weighted N.L split agrees with the crops on
       every seed checked; the quantiles do not. Also hide `.vst-root`, not
       just `#vs-hud`, before differencing a frame — the onboarding card is
       translucent and sits over the hull, and counting it doubled 13634's
       shadow fraction. */
  sunAngleMin: 104 * DEG,
  sunAngleMax: 134 * DEG,

  /* How hard a dim approach is penalised in the aim search, and the mean
     clamped-Lambert value over camera-facing hull samples at which a candidate
     stops being penalised at all. One-sided: a well-lit approach pays nothing,
     so this can only ever break the framing score's ties toward the light. */
  litWeight: 0.55,
  litTarget: 0.42,

  /* Elevation band. Slightly below the equator is allowed — a capital read from
     just under its belt line looms, which is the whole point of a hero shot. */
  pitchMin: -0.06,
  pitchMax: 0.46,

  /* Where the silhouette's centre sits, as a share of the frame away from the
     middle. Dead centre is tidy rather than arresting. */
  offsetX: 0.115,
  offsetY: 0.035,

  /* Phases tried around the sun cone, how many of those are actually framed and
     scored, and how many hull vertices the fill solve samples.

     The sample budget is shared out per mesh with a floor, not strided across
     the concatenation: at a flat 2,400 the 892k-vertex hull swallowed the whole
     budget and the four small meshes got single figures, which under-reported
     the vertical extent by 12% against a dense read and let a hull come in at
     94% of frame height while the solve believed it was at 84%. */
  phases: 36,
  candidates: 7,
  samples: 9000,
  samplesPerMesh: 64,
};

/* Candidate offsets, in radians, searched in order when the shot is blocked.
   Yaw first and in both directions, because swinging sideways preserves the
   composition; pitch is the fallback, and going over the top is the last
   resort. Nearest clear direction wins, so the camera moves as little as it
   can get away with. */
const CLEAR_SEARCH = (() => {
  const out = [[0, 0]];
  for (const yaw of [0.26, -0.26, 0.52, -0.52, 0.79, -0.79, 1.05, -1.05, 1.40, -1.40, 1.83, -1.83, 2.36, -2.36, 3.14]) {
    out.push([yaw, 0]);
  }
  for (const pitch of [0.26, -0.26, 0.52, -0.52, 0.87, -0.87]) {
    out.push([0, pitch]);
    for (const yaw of [0.52, -0.52, 1.05, -1.05, 1.83, -1.83, 3.14]) out.push([yaw, pitch]);
  }
  return out;
})();

/* Shot composition (R7 fix 3).

   Round 6 kept the near plane out of rock, and the close camera then parked
   hard against it: seed 99's engagement close was three-quarters faceted rock
   with the frigate cut by the frame edge, seed 13634's wide shot 60 % rock.
   Nothing scored the picture. The key-light swing, the backdrop test and the
   sight test each nudged the angle in turn, and none of them could see how
   much of the frame the rocks ate or whether the subject still fitted.

   So every framing the rig chooses - F, focusOn, and the follow camera's own
   re-framing - now scores candidate poses with one function, after the
   near-plane rules have had their say (a pose with rock on its line is marked,
   not trusted):
     - rock share: a 16 x 9 grid of rays from the candidate camera against the
       vertex-tight hull ellipsoids of the ~64 rocks that could matter;
     - the subject's projected silhouette, which must sit inside the frame with
       a margin and be bigger than a sliver;
     - the key-light band, the sight test and the backdrop share, as terms of
       the same score rather than overrides applied one after another;
     - the swing from the requested pose, so the nearest good shot wins.
   A pose that breaks a hard rule pays REJECT and loses to any that does not;
   if every pose does, the cheapest still wins and the rocks left between the
   lens and the subject are dithered out by the fade slots instead.

   The follow camera re-scores its own pose a few times a second while the
   player leaves it alone. It moves only when that pose breaks a hard rule and
   a candidate is clearly better, eases there on the orbit springs, and then
   holds for a cooldown, so it cannot flick between two near-equal shots.

   R8 fix 3, for frigates and capitals: every term is now scored where the
   pull-in actually leaves the lens, not at the distance asked for; rock is
   split into what stands in front of the subject and what stands behind it,
   and either over COMPOSE.rockMax is a hard rule; so is a hull under
   COMPOSE.minSize of the frame height, and frigates and capitals are pulled
   into a fill band of their own (FILL). When no pose is clean, the offending
   rocks are faded outright (`_forceFades`), and a faded rock is always faded
   to nothing — no 25 % ghosts. */
const COMPOSE = {
  rockMax: 0.40,       // share of the frame that may be rock in front of the subject, and again behind it
  margin: 0.04,        // NDC margin the subject keeps from every frame edge
  minSize: 0.08,       // the subject's larger screen extent, as a share of the frame HEIGHT (R8)
  fitTo: 0.82,         // the larger edge a clipped subject is pulled back to
  pathCost: 2,         // rock on the line the pull-in will cut the shot short at (scored where it lands)
  fillWeight: 1.2,     // per unit of |log| outside a class's fill band
  fadeSlots: 3,        // most rocks a framing may fade outright when nothing scores clean
  gridX: 16,
  gridY: 9,
  rocks: 64,           // rocks scored per shot, the biggest on screen first
  minAngle: 0.05,      // a rock that cannot subtend more than this is ignored
  reject: 20,
  keyWeight: 2.0,      // per radian outside KEY_QUARTER
  rockWeight: 1.5,
  backdropWeight: 1.0,
  swingYaw: 0.25,      // per radian of swing from the requested pose
  swingPitch: 0.4,
  distWeight: 0.6,     // per unit of |log| distance change
  subjectSamples: 360, // hull points kept per subject
  evalEvery: 0.4,      // s between follow re-scores
  idleBefore: 1.2,     // s the player must have left the camera alone
  switchGain: 1.5,     // how much better a new pose must score to move
  cooldown: 2.5,       // s held after a move
  /* A rock in the way is dithered all the way out, never parked at a partial
     opacity: R7's 0.25 read as a translucent ghost rock across the hull. */
  occludedW: 0,        // dither opacity of a rock between lens and subject
  fadeRate: 4,         // 1/s toward that, and back
  occludedHold: 1.0,   // s a faded occluder stays out after it leaves the subject's rays
  breakHold: 0.8,      // s after a move before a clipped or tiny subject may move it again
};
/* How much of the frame HEIGHT each kind of hull should fill, by role (R8 fix
   3). Strike craft keep R7's behaviour; a frigate or a capital that comes out
   a speck or overflowing the frame is pulled to `want`. */
const FILL = {
  frigate: { lo: 0.14, hi: 0.75, want: 0.30 },
  support: { lo: 0.14, hi: 0.75, want: 0.30 },
  capital: { lo: 0.22, hi: 0.85, want: 0.42 },
  structure: { lo: 0.22, hi: 0.90, want: 0.48 },
};
const FOLLOW_MAX_SPEED = 6000;   // m/s; anything faster is a jump
const FOLLOW_VEL_RATE = 8;       // 1/s smoothing of the measured velocity
const _ray = new THREE.Vector3();
const _span = { w: 0, h: 0, cx: 0, cy: 0 };
const _ocD = new THREE.Vector3();
const _ocR = new THREE.Vector3();
const _ocU = new THREE.Vector3();
const _ocT = new THREE.Vector3();
const _held = { yaw: 0, pitch: 0, dist: 0 };

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
    /* Near-plane safety: every rock worth a sphere test as x,y,z,r, the few
       near the current shot, and the smoothed pull-in as a share of the
       orbit distance (1 = no pull). */
    this._near = new Float32Array(MAX_NEAR_ROCKS * 4);
    this._hull = new Float32Array(MAX_NEAR_ROCKS * 12);   // rotation (9) + world semi-axes (3)
    this._fadeI = new Int32Array(ROCK_FADE_SLOTS);
    this._fadeW = new Float32Array(ROCK_FADE_SLOTS);
    this._fadeN = 0;            // rocks the near quad is inside this frame (all faded)
    this._safePos = new THREE.Vector3();
    this._safeOk = false;
    this._held = 0;             // frames the guard held the last safe position
    this._nearN = 0;
    this._nearGen = 0;
    this._cand = new Int32Array(NEAR_CANDIDATES);
    this._candN = 0;
    this._candAt = { x: 0, y: 0, z: 0, reach: -1, gen: -1 };
    this._candIdx = [];
    this._candKey = [];
    this._pullK = 1;
    this._pullSnap = true;

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
    this._static = [];          // big, immobile scene occluders (landmarks, planets)
    this._backdrop = [];        // every rock worth a pixel, for the backdrop test
    this._backdropN = 0;
    this._lastClear = null;     // what the last chosen framing decided, for probes
    /* Shot composition (R7 fix 3). */
    this._compI = new Int32Array(COMPOSE.rocks);   // near-rock indices scored this shot
    this._compN = 0;
    this._compKeep = new Int32Array(COMPOSE.rocks);
    this._compIdx = [];
    this._compKey = [];
    this._localHull = new WeakMap();               // entity -> hull points in its own frame
    this._subjPts = [];
    this._shot = { rock: 0, front: 0, back: 0, eff: 0, clip: false, size: -1, blocked: false, path: false, cover: 0, score: 0 };
    /* R8 fix 3: rays per kept rock in the last _rockShare (front, back), and
       the rocks the held framing fades outright because no pose scored clean. */
    this._compHitF = new Int16Array(COMPOSE.rocks);
    this._compHitB = new Int16Array(COMPOSE.rocks);
    this._compZ = new Float32Array(COMPOSE.rocks);
    this._forced = new Float32Array(COMPOSE.fadeSlots * 3);
    this._forcedN = 0;
    this._pb = { soft: 0, hard: 0, n: 0, band: 0 };
    this._recompT = 0;
    this._recompForce = false;
    this._followVel = new THREE.Vector3();      // smoothed velocity of the followed centroid
    this._followPrev = new THREE.Vector3();
    this._followPrevOk = false;
    this._followKey = null;
    this._recompHold = 0;
    /* Rocks faded for standing in the way: world centre, opacity, target. */
    this._occC = new Float32Array(ROCK_FADE_SLOTS * 3).fill(ROCK_FADE_FAR);
    this._occW = new Float32Array(ROCK_FADE_SLOTS).fill(1);
    this._occT = new Float32Array(ROCK_FADE_SLOTS).fill(1);
    this._occN = 0;             // rocks in the way this frame, for probes
    this._occHold = new Float32Array(ROCK_FADE_SLOTS);   // s an occluder stays out after it was last in the way
    /* Near-guard fades eased to nothing over time rather than parked part-way
       down the spatial ramp (R8 fix 3): near-rock index -> opacity, and the
       frame each was last touched. */
    this._ngW = new Map();
    this._ngStamp = new Map();
    this._ngFrame = 0;
    this._ngStep = 0;
    this._staticStamp = -1;
    this._staticAt = -1e9;

    /* Impact shake: trauma decays linearly, displacement goes as trauma^2, so
       a big hit hits hard and the tail vanishes instead of lingering. */
    this._trauma = 0;
    this._shakeDir = new THREE.Vector3(0, 1, 0);
    this._shakeSeed = 0;

    this._sensors = false;
    this._restore = null;
    this._trans = null;

    /* Opening shot. `_composed` latches the moment the rig either composes the
       hero frame or the player touches the camera, so a later `ui:focus` can
       never re-stage the boot shot mid-battle. The offset that takes the
       subject off dead centre lives on its own gain and slides back to a
       centred orbit as soon as the player takes over — an off-centre focus is
       a composition, not a control scheme. */
    this._composed = false;
    this._composeX = 0;
    this._composeY = 0;
    this._composeGain = new Spring(0, 1.8);
    this._openingReport = null;
    this._openingSkip = null;

    /* Reduced motion kills the two things that move without being asked to:
       idle sway and impact shake. Deliberate motion — orbit, zoom, focus, the
       sensors pull-out — still happens, because that is the player driving.
       Turning the preference on cuts the decorative motion dead rather than
       letting it glide out, which is the whole point of asking for it. */
    this._reduced = false;
    this._mq = null;
    if (typeof window !== 'undefined' && window.matchMedia) {
      this._mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this._reduced = this._mq.matches;
      this._onMq = (e) => {
        this._reduced = e.matches;
        if (e.matches) this._stillness();
      };
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._onMq);
      else if (this._mq.addListener) this._mq.addListener(this._onMq);
    }

    this._offs = [
      bus.on('ui:focus', (p) => {
        if (!p || !p.point) return;
        this.focusOn(p.point, p.distance, false);
      }),
      bus.on('ui:sensorsToggle', (p) => this.setSensorsMode(!!(p && p.open))),
      bus.on('fx:blast', (p) => this._onBlast(p)),
    ];

    /* Self-drive as a fallback. If main.js calls update() itself the guard in
       update() makes this a no-op for that frame, so main.js always wins. */
    this._offHook = engine.registerRenderHook((dt) => this.update(dt));

    this._apply(0);
  }

  /* --------------------------------------------------------------- accessors */

  get distance() {
    return Math.exp(this._logDist.value) * Math.min(1, this._pullK) + this._clear.value;
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
    /* The bootstrap asks for the hero frame by focusing the player's flagship
       with a distance derived from hull length. The rig takes that as the cue,
       not as the shot: composition is a camera concern, and the distance it
       needs depends on the approach angle, the aspect ratio and the dynamic
       FOV — none of which the bootstrap can see. */
    if (this._composeOpening(point, instant)) return;
    this._releaseCompose();
    this._cancelTransition();
    this._follow = null;
    this._focus.target.set(point.x, point.y, point.z);
    this._focusRadius = 0;
    if (typeof distance === 'number' && isFinite(distance)) {
      this._logDist.target = clamp(Math.log(Math.max(1e-3, distance)), this._logMin, this._logMax);
    }
    if (instant) this._focus.snap(this._focus.target);
    this._compose(instant, null, null);
    if (instant) {
      this._logDist.snap(this._logDist.target);
      this._clear.snap(0);
      this._pullSnap = true;
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
    this._releaseCompose();

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
    let hero = null;
    for (const e of list) if (e.quaternion && (!hero || (e.radius || 0) > (hero.radius || 0))) hero = e;

    if (instant) this._focus.snap(this._focus.target);
    this._compose(instant, hero, list);
    if (instant) {
      this._logDist.snap(this._logDist.target);
      this._apply(0);
    }
    this._idle = 0;
  }

  /* Swing yaw so the lens sits inside KEY_QUARTER of the key. With the pitch
     held, cos(angle) = cos(pitch) * h * cos(yaw - az) + sin(pitch) * sun.y,
     where h and az are the key's horizontal length and azimuth, so the edge
     yaw is solved directly. Of its two solutions the nearer is kept, unless a
     subject is given: then the one that shows more of its flank wins. */
  _keyQuarter(instant, subject) {
    if (!this._sunDir(_sun)) return;
    const yaw = this._yaw.target;
    const pitch = this._pitch.target;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const h = Math.sqrt(Math.max(0, 1 - _sun.y * _sun.y));
    const az = Math.atan2(_sun.x, _sun.z);
    const now = cp * h * Math.cos(yaw - az) + sp * _sun.y;
    const lo = Math.cos(KEY_QUARTER.max);
    const hi = Math.cos(KEY_QUARTER.min);
    if (now >= lo && now <= hi) return;
    const k = cp * h;
    if (k < 1e-4) return;                 // key overhead: yaw cannot move it
    const d = Math.acos(clamp(((now > hi ? hi : lo) - sp * _sun.y) / k, -1, 1));
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const d1 = wrap(az + d - yaw);
    const d2 = wrap(az - d - yaw);
    let pick = Math.abs(d1) <= Math.abs(d2) ? d1 : d2;
    if (subject && subject.quaternion) {
      _v2.set(0, 0, 1).applyQuaternion(subject.quaternion);
      const fl = Math.hypot(_v2.x, _v2.z);
      if (fl > 0.2) {
        const flank = (dy) => Math.abs(Math.sin(yaw + dy) * _v2.z - Math.cos(yaw + dy) * _v2.x) / fl
          - 0.15 * Math.abs(dy) / Math.PI;
        pick = flank(d1) >= flank(d2) ? d1 : d2;
      }
    }
    const next = yaw + pick;
    this._yaw.target = next;
    if (instant) this._yaw.snap(next);
  }

  /** Keep the focus glued to a moving group's centroid (what F should do). */
  follow(entities) {
    const list = this._toList(entities);
    this._follow = list.length ? list : null;
    /* Now the rig knows what it is framing: score the shot on the next frame,
       whatever the player was doing a moment ago. */
    this._recompT = 0;
    this._recompForce = !!this._follow;
  }

  clearFollow() {
    this._follow = null;
  }

  /** dx/dy in CSS pixels. Angular, so the feel is identical at every zoom. */
  orbitBy(dxPx, dyPx) {
    const s = this.options.orbitSensitivity;
    this._releaseCompose();
    this._cancelTransition();
    this._yaw.target -= dxPx * s;
    this._pitch.target = clamp(this._pitch.target + dyPx * s, -PITCH_LIMIT, PITCH_LIMIT);
    this._idle = 0;
  }

  /** Slide the focus across its horizontal plane, in screen pixels.
      +dx is screen-right, +dy is screen-down. */
  panScreen(dxPx, dyPx) {
    if (!dxPx && !dyPx) return;
    this._releaseCompose();
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
    this._releaseCompose();
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
    this._releaseCompose();
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

  /* --------------------------------------------------------- opening shot */

  /** The composed opening frame, for anyone measuring it. Null until it runs. */
  get openingShot() {
    return this._openingReport;
  }

  /** Why the hero framing declined, if it did. Null once it has succeeded. */
  get openingSkip() {
    return this._openingSkip;
  }

  _skipOpening(why) {
    this._openingSkip = why;
    return false;
  }

  /** Give the off-centre composition back and latch the opening as spent. */
  _releaseCompose() {
    this._composed = true;
    this._composeGain.target = 0;
    /* The player has the camera: a fallback fade belongs to the framing it
       was chosen for, so the rocks come back (dithered in) from here. */
    this._forcedN = 0;
  }

  /* The player's flagship, if the world can name it. `teams[0]` matches what
     the bootstrap frames; a rig handed no world simply has no hero. */
  _hero() {
    const w = this.world;
    if (!w || !w.entities || !w.teams || !w.teams[0]) return null;
    const e = w.entities.get ? w.entities.get(w.teams[0].baseId) : null;
    if (!e || e.alive === false || !e.object3D || !e.position) return null;
    return e;
  }

  /* Camera-space right/up for a view direction. `_basis` predates this and
     returns an up vector that points the other way — harmless where it is used
     (symmetric noise) and wrong everywhere composition matters, so anything
     that has to agree with the screen uses this one. Matches Three's `lookAt`:
     z = dir, x = up_world x z, y = z x x. */
  _camBasis(dir, right, up) {
    right.set(dir.z, 0, -dir.x);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(dir, right).normalize();
  }

  /* World-space sample of the hero's hull, taken once.

     Only the finest LOD level is walked — three copies of the same hull would
     triple the work for an identical extent — and **an LOD level's own
     `visible` flag is ignored when we descend into it.**

     That last clause is the whole of a bug that cost this lane a round, and it
     is the third instance of HANDOFF §5's "prove which code path actually
     runs". The previous comment here asserted that `THREE.LOD` leaves every
     level visible until its first `update()`, "which has not happened yet at
     boot". Measured in the running game, that is false: by the time
     `frameOpeningShot` fires, the rig is still at its default 2,600 m pose
     pointing at the origin, the mothership is far enough away that `LOD.update()`
     has already selected **level 1**, and `levels[0].object.visible` is
     therefore `false`. The walk's own `visible === false` guard — there to skip
     genuinely hidden decoration — then ate the finest level on its first line
     and returned zero meshes. `_composeOpening` saw a null and silently
     declined, so the hero framing never ran on any seed and the opening frame
     was the spring defaults: pitch 0.42 rad exactly, elevation -24.1 degrees.

     A hidden LOD level is a statement about what the renderer should draw this
     frame. It is not a statement about where the hull is, and the framing solve
     is asking the second question. So visibility gates ordinary children and
     nothing else. */
  _samplePoints(root) {
    const out = [];
    const nrm = [];
    const budget = OPENING.samples;
    const meshes = [];
    /* `forced` is set only for an LOD level we chose deliberately: it suppresses
       the visibility test for that subtree root, never for its children. */
    const walk = (node, forced) => {
      if (!node) return;
      if (!forced && node.visible === false) return;
      if (node.isLOD && node.levels && node.levels.length) {
        /* Three keeps `levels` sorted by ascending distance, so [0] is the
           finest — but take the minimum rather than trusting the ordering,
           because picking the wrong level here is invisible: it still returns a
           hull-shaped cloud, just the wrong size. */
        let finest = node.levels[0];
        for (let i = 1; i < node.levels.length; i++) {
          if (node.levels[i].distance < finest.distance) finest = node.levels[i];
        }
        walk(finest.object, true);
        return;
      }
      if (node.isMesh && node.geometry && node.geometry.attributes &&
          node.geometry.attributes.position) {
        meshes.push(node);
      }
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) walk(kids[i], false);
    };
    /* World matrices, not just visibility: an LOD level that has never been
       drawn still needs its `matrixWorld` current before its vertices mean
       anything. `updateWorldMatrix` descends regardless of visibility. */
    root.updateWorldMatrix(true, true);
    walk(root, false);
    if (!meshes.length) return null;

    let total = 0;
    for (const m of meshes) total += m.geometry.attributes.position.count;
    if (!total) return null;

    for (const m of meshes) {
      const pos = m.geometry.attributes.position;
      const nAttr = m.geometry.attributes.normal;
      /* Normals need the inverse-transpose, not the world matrix — a hull built
         with any non-uniform scale would otherwise report normals that are not
         perpendicular to it, and light the wrong flank. */
      if (nAttr) _nm.getNormalMatrix(m.matrixWorld);
      const want = Math.max(OPENING.samplesPerMesh, Math.round((budget * pos.count) / total));
      const stride = Math.max(1, Math.ceil(pos.count / want));
      for (let i = 0; i < pos.count; i += stride) {
        _p1.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (!Number.isFinite(_p1.x) || !Number.isFinite(_p1.y) || !Number.isFinite(_p1.z)) continue;
        if (nAttr) {
          _n1.fromBufferAttribute(nAttr, i).applyMatrix3(_nm);
          if (_n1.lengthSq() < 1e-12) _n1.set(0, 1, 0);
          _n1.normalize();
        } else {
          _n1.set(0, 0, 0);          // no normals: every sample reads unlit
        }
        out.push(_p1.x, _p1.y, _p1.z);
        nrm.push(_n1.x, _n1.y, _n1.z);
      }
    }
    if (out.length < 12) return null;
    out.n = nrm;
    return out;
  }

  /* Last resort: the hero as a sphere of its own bounding radius.

     The opening shot must not be an all-or-nothing bet on walking somebody
     else's scene graph. The LOD-visibility bug above is the second time a
     lane-external change to how hulls are represented has silently switched
     this solve off, and if hulls ever move fully into instanced batches the
     hero's `Object3D` really will carry no geometry — the diagnosis this task
     arrived with, which turned out to be wrong today and will be right the day
     `mothership` leaves the UNBATCHED set.

     With a sphere the *aim* is still fully solved: the lighting band, the
     elevation band, the seeded phase and the off-centre offset are all
     properties of the direction, not of the hull's outline. Only the fill is
     approximate, and it is approximated conservatively — a sphere circumscribes
     the hull, so the framing errs toward too far out rather than cropping.

     Deterministic by construction: a Fibonacci lattice, no RNG, so this is
     still reproducible per seed. */
  _spherePoints(centre, radius) {
    const n = 512;
    const r = Math.max(1, radius || 0);
    const out = [];
    const nrm = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const th = golden * i;
      const nx = Math.cos(th) * rad;
      const nz = Math.sin(th) * rad;
      out.push(centre.x + nx * r, centre.y + y * r, centre.z + nz * r);
      nrm.push(nx, y, nz);
    }
    out.n = nrm;
    return out;
  }

  /* Mean clamped Lambert over the hull samples that face the camera — a proxy
     for "how lit does this approach leave the visible hull", computed without
     rendering anything.

     It exists because the framing score alone cannot see lighting, and within
     the view-to-sun band that ENV constrained, the outcome still split: their
     measurement put well-placed seeds at hull medians of 0.31-0.43 and the
     worst at 0.138. Vertex samples are not area-weighted, so this is a
     monotonic proxy rather than a photometric prediction — which is all a
     comparison between candidate angles needs. */
  _litFraction(pts, focus, dir, dist) {
    const nrm = pts.n;
    if (!nrm || !this._sunDir(_sun)) return 1;      // nothing to choose between
    _cam.copy(focus).addScaledVector(dir, dist);

    let lit = 0;
    let seen = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const nx = nrm[i];
      const ny = nrm[i + 1];
      const nz = nrm[i + 2];
      const vx = _cam.x - pts[i];
      const vy = _cam.y - pts[i + 1];
      const vz = _cam.z - pts[i + 2];
      const vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      if ((nx * vx + ny * vy + nz * vz) / vl <= 0) continue;   // back-facing
      seen++;
      const ndl = nx * _sun.x + ny * _sun.y + nz * _sun.z;
      if (ndl > 0) lit += ndl;
    }
    return seen ? lit / seen : 0;
  }

  /* Direction from the battle toward the star, read off whichever directional
     light ENV installed. Returns false if the scene has no key light, in which
     case the opening simply falls back to a seeded absolute azimuth. */
  _sunDir(out) {
    const scene = this.engine && this.engine.scene;
    if (!scene) return false;
    let best = null;
    let bestI = -Infinity;
    for (let i = 0; i < scene.children.length; i++) {
      const o = scene.children[i];
      if (!o || !o.isDirectionalLight) continue;
      const inten = typeof o.intensity === 'number' ? o.intensity : 0;
      if (inten <= bestI) continue;
      bestI = inten;
      best = o;
    }
    if (!best) return false;
    out.copy(best.position);
    if (best.target && best.target.isObject3D) out.sub(best.target.position);
    if (out.lengthSq() < 1e-9) return false;
    out.normalize();
    return true;
  }

  /* FOV the rig will settle at for a given distance. Shared with `_apply` so a
     framing solved here cannot disagree with the frame that gets rendered. */
  _fovAt(dist) {
    const zt = clamp01(
      (Math.log(Math.max(1, dist)) - Math.log(600)) / (Math.log(60000) - Math.log(600)),
    );
    return clamp(this.baseFov - 3.5 * (1 - zt) + 6.0 * zt, 38, 62);
  }

  /* Screen extent of a point cloud from a candidate pose, in NDC. `w` and `h`
     come back as shares of the frame (1.0 = edge to edge), and `cx`/`cy` locate
     the silhouette's centre so the composition offset can be measured from the
     shape rather than from the entity's origin. */
  _spanAt(pts, focus, dir, dist, fovDeg, out) {
    const tanV = Math.tan(fovDeg * DEG * 0.5);
    const tanH = tanV * Math.max(0.2, this.camera.aspect);
    _cam.copy(focus).addScaledVector(dir, dist);
    this._camBasis(dir, _right, _up);

    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      _rel.set(pts[i] - _cam.x, pts[i + 1] - _cam.y, pts[i + 2] - _cam.z);
      /* Depth along the view axis; the camera looks down -dir. */
      const f = -(_rel.x * dir.x + _rel.y * dir.y + _rel.z * dir.z);
      if (f < 1) continue;
      const x = (_rel.x * _right.x + _rel.y * _right.y + _rel.z * _right.z) / (f * tanH);
      const y = (_rel.x * _up.x + _rel.y * _up.y + _rel.z * _up.z) / (f * tanV);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < x0) return null;
    out.w = (x1 - x0) * 0.5;
    out.h = (y1 - y0) * 0.5;
    out.cx = (x0 + x1) * 0.5;
    out.cy = (y0 + y1) * 0.5;
    return out;
  }

  /* Distance at which the hull just fills the target rectangle, held inside the
     hull-length band. Whichever axis binds first wins, so a hull presented
     diagonally is pushed out until it fits rather than cropped at 52% of the
     width. Span goes as 1/distance to first order, so a handful of secant steps
     converge; the FOV is re-derived each step because it rides the zoom and
     would otherwise be solved against the wrong lens. */
  _solveFill(pts, focus, dir, hullLength) {
    const lo = hullLength * OPENING.hullMultipleMin;
    const hi = hullLength * OPENING.hullMultipleMax;
    const span = { w: 0, h: 0, cx: 0, cy: 0 };
    let d = clamp(hullLength * 1.08, lo, hi);
    let w = 0;
    let h = 0;
    for (let i = 0; i < 8; i++) {
      const s = this._spanAt(pts, focus, dir, d, this._fovAt(d), span);
      if (!s || !(s.w > 1e-4)) break;
      w = s.w;
      h = s.h;
      const ratio = Math.max(s.w / OPENING.fillW, s.h / OPENING.fillH);
      const next = clamp(d * ratio, lo, hi);
      if (Math.abs(next - d) < 0.5) { d = next; break; }
      d = next;
    }
    /* How far off the ideal frame this approach lands once the band has had its
       say. 1.0 is exact; the aim search minimises |ln| of it. */
    const ratio = Math.max(w / OPENING.fillW, h / OPENING.fillH);
    return { dist: d, w, h, ratio: ratio > 0 ? ratio : 1 };
  }

  /* Aim the shot.

     The camera sits on a cone about the direction to the star, at a seeded
     half-angle inside the lighting band, and at a seeded phase around it. That
     is what makes the seed change the framing without ever changing the
     view-to-sun angle out of the band ENV needs — the two used to be randomised
     independently, which is how six seeds produced a byte-identical opening
     frame with a 7x spread in hull luminance. */
  _aimOpening(focus, hero, rng, pts, hullLength) {
    const haveSun = this._sunDir(_sun);
    const alpha = Math.PI - rng.range(OPENING.sunAngleMin, OPENING.sunAngleMax);

    if (!haveSun) {
      /* No key light to aim from: a seeded absolute approach, which at least
         still varies the shot. */
      _sun.set(Math.sin(rng.range(-Math.PI, Math.PI)), 0.3, Math.cos(rng.range(-Math.PI, Math.PI)))
        .normalize();
    }

    /* Orthonormal frame about the sun axis. */
    _axA.set(0, 1, 0);
    if (Math.abs(_sun.y) > 0.94) _axA.set(1, 0, 0);
    _axA.crossVectors(_sun, _axA).normalize();
    _axB.crossVectors(_sun, _axA).normalize();

    const sa = Math.sin(alpha);
    const ca = Math.cos(alpha);
    const n = OPENING.phases;
    const start = rng.int(0, n - 1);
    const step = rng.chance(0.5) ? 1 : n - 1;   // both directions round the cone

    const ok = [];
    for (let i = 0; i < n; i++) {
      const psi = (((start + i * step) % n) / n) * Math.PI * 2;
      const cp = Math.cos(psi);
      const sp = Math.sin(psi);
      _try.set(
        _sun.x * ca + (_axA.x * cp + _axB.x * sp) * sa,
        _sun.y * ca + (_axA.y * cp + _axB.y * sp) * sa,
        _sun.z * ca + (_axA.z * cp + _axB.z * sp) * sa,
      ).normalize();
      const pitch = Math.asin(clamp(_try.y, -1, 1));
      if (pitch < OPENING.pitchMin || pitch > OPENING.pitchMax) continue;
      ok.push({ yaw: Math.atan2(_try.x, _try.z), pitch });
    }
    if (!ok.length) {
      /* The star is close enough to the pole that no point on the cone lands in
         the elevation band. Take the shallowest candidate rather than refusing
         to compose — a slightly high shot beats no hero frame at all. */
      const psi = (start / n) * Math.PI * 2;
      _try.set(
        _sun.x * ca + (_axA.x * Math.cos(psi) + _axB.x * Math.sin(psi)) * sa,
        _sun.y * ca + (_axA.y * Math.cos(psi) + _axB.y * Math.sin(psi)) * sa,
        _sun.z * ca + (_axA.z * Math.cos(psi) + _axB.z * Math.sin(psi)) * sa,
      ).normalize();
      ok.push({
        yaw: Math.atan2(_try.x, _try.z),
        pitch: clamp(Math.asin(clamp(_try.y, -1, 1)), OPENING.pitchMin, OPENING.pitchMax),
      });
    }

    /* Frame a spread of the surviving phases and keep the one that composes
       best: the hull's projected aspect changes enormously round the cone —
       broadside against nose-on is the difference between filling the frame and
       being pushed to the far end of the distance band — so the approach is
       chosen on the picture it makes, not on the first angle that is legal. The
       seed still decides which phases are looked at and breaks every tie, so
       two seeds with different stars get visibly different shots. */
    const list = this._occluderList(focus, hullLength * 1.1);
    const stride = Math.max(1, Math.floor(ok.length / OPENING.candidates));
    const probes = [];
    let best = null;
    for (let i = 0; i < ok.length; i += stride) {
      const cand = ok[i];
      const cp = Math.cos(cand.pitch);
      _try.set(Math.sin(cand.yaw) * cp, Math.sin(cand.pitch), Math.cos(cand.yaw) * cp).normalize();
      const fit = this._solveFill(pts, focus, _try, hullLength);
      /* Scored on the achieved *width*, asymmetrically. Three objectives were
         measured across six seeds before this one; please do not re-derive them:

         · Combined width-or-height fit. Looks right and is not: a hull taken
           nose-on is tall and narrow, so it hits the height cap while only 40%
           of the frame wide, and a combined ratio scores that as a perfect fit.
           Measured 26-54% painted, with one seed opening on a tower.
         · Combined fit plus a bonus for landscape presentations. "Widest wins"
           also means "needs the most distance", so the 1.2x hull-length ceiling
           bound on five of six seeds and the silhouette went to 48-63%. Capping
           the bonus to break only near-ties was worse again — the cap let the
           nose-on candidate win outright.
         · Symmetric width error. Right shape, but when no approach can reach
           the target inside the distance band the nearest is always the widest,
           and that put emberfall at 62.5%.

         So: width, with overshoot weighted 2.5x. Undershooting reads as a hull
         with room around it; overshooting reads as a hull that has been flown
         into and cropped, and it is the failure the distance ceiling actively
         pushes towards. Weighting the two differently is what keeps the band at
         both ends without needing a separate aspect term — preferring the
         approach whose *width* lands on target already prefers the broadside
         read, which is what ARCHITECTURE §3.1 asks for. */
      const wr = fit.w / OPENING.fillW;
      let score = wr > 1 ? 2.5 * Math.log(wr) : -Math.log(Math.max(1e-6, wr));

      /* And how lit the shot is, which the framing score cannot see. One-sided
         and normalised, so a candidate at or above the target pays nothing and
         a black one pays `litWeight`. ENV owns the star's elevation and its
         azimuth stays uniformly seeded; this is the camera choosing where to
         stand relative to whatever star it was given. */
      const lit = this._litFraction(pts, focus, _try, fit.dist);
      score += OPENING.litWeight *
        Math.max(0, OPENING.litTarget - lit) / OPENING.litTarget;

      if (list.length && this._sightBlocked(focus, _try, fit.dist, list, hero.radius || 0)) {
        score += 10;   // a rock across the shot loses to any clear angle
      }
      probes.push({
        yaw: +cand.yaw.toFixed(3),
        pitch: +cand.pitch.toFixed(3),
        w: +fit.w.toFixed(3),
        lit: +lit.toFixed(3),
        score: +score.toFixed(3),
      });
      if (!best || score < best.score) {
        best = { yaw: cand.yaw, pitch: cand.pitch, score, fit, lit };
      }
    }
    this._probes = probes;
    return best || { yaw: ok[0].yaw, pitch: ok[0].pitch, score: 0, fit: null, lit: 0 };
  }

  /** Static plus entity occluders near a focus, as the flat records the sight
      test wants. Shared by `_shotContext` and the opening aim. */
  _occluderList(focus, dist) {
    this._colliderTick = 0;
    const world = this._collidersFor(focus, dist);
    const out = this._harvestStatic().slice();
    for (let i = 0; i < world.length; i++) {
      const e = world[i];
      const p = e.position || (e.object3D && e.object3D.position);
      if (!p) continue;
      /* The subject is not its own obstruction. */
      if (_v3.copy(p).sub(focus).lengthSq() < 1e-2) continue;
      out.push({ x: p.x, y: p.y, z: p.z, r: (e.radius || 0) * 1.1 });
    }
    return out;
  }

  /* Compose the hero frame. Returns false if this is not that call, in which
     case `focusOn` carries on as it always did. */
  _composeOpening(point, instant) {
    /* Every bail-out records *why*. HANDOFF §5 has this project losing two
       rounds to a correct function that was never reached, and this one made it
       three: the solve was silently declining and the only evidence was a pitch
       sitting on its spring default. A skip reason costs one string. */
    if (this._composed) return this._skipOpening('already-composed');
    if (!instant) return this._skipOpening('not-instant');
    const hero = this._hero();
    if (!hero) return this._skipOpening('no-hero');
    /* Only the boot framing of the flagship itself qualifies. */
    const reach = Math.max(200, (hero.radius || 0) * 1.5);
    if (_v3.copy(hero.position).sub(point).lengthSq() > reach * reach) {
      return this._skipOpening('point-not-hero');
    }

    const hullLength = (hero.def && hero.def.length) || (hero.radius || 900) * 2;
    let pts = this._samplePoints(hero.object3D);
    let sampledFrom = 'geometry';
    if (!pts) {
      /* Compose anyway. A degraded hero frame is a shot; a skipped one is the
         spring defaults, and nobody notices those for six seeds running. */
      pts = this._spherePoints(hero.position, hero.radius || hullLength * 0.5);
      sampledFrom = 'sphere';
    }

    const seed = (this.world && this.world.seed) || 1337;
    const rng = makeRng((seed ^ 0x5f3a91) >>> 0);
    const aim = this._aimOpening(hero.position, hero, rng, pts, hullLength);

    const cp = Math.cos(aim.pitch);
    _dir.set(Math.sin(aim.yaw) * cp, Math.sin(aim.pitch), Math.cos(aim.yaw) * cp).normalize();
    const solved = aim.fit || this._solveFill(pts, hero.position, _dir, hullLength);

    /* Put the lit flank into the open half of the frame: the star's screen-side
       decides which way the subject is pushed, so the shot always reads as the
       hull turning into the light rather than away from it. */
    this._camBasis(_dir, _right, _up);
    const sunRight = this._sunDir(_sun) ? _sun.dot(_right) : 0;
    const side = sunRight >= 0 ? -1 : 1;

    const span = { w: 0, h: 0, cx: 0, cy: 0 };
    const s = this._spanAt(pts, hero.position, _dir, solved.dist, this._fovAt(solved.dist), span);
    /* The offset is a composition, not a licence to push the subject off the
       edge — it gives back whatever the silhouette needs to stay in frame. */
    const offX = Math.min(OPENING.offsetX, Math.max(0, (OPENING.margin - solved.w) * 0.5));
    const offY = Math.min(OPENING.offsetY, Math.max(0, (OPENING.margin - solved.h) * 0.5));
    const wantX = side * offX * 2;
    const wantY = offY * 2;                  // NDC +y is up; sit a touch high
    this._composeX = wantX - (s ? s.cx : 0);
    this._composeY = wantY - (s ? s.cy : 0);
    this._composeGain.snap(1);
    this._composed = true;
    this._openingSkip = null;

    this._cancelTransition();
    this._follow = null;
    this._focus.target.copy(hero.position);
    this._focus.snap(this._focus.target);
    this._focusRadius = hero.radius || 0;
    this._yaw.snap(aim.yaw);
    this._pitch.snap(clamp(aim.pitch, -PITCH_LIMIT, PITCH_LIMIT));
    this._logDist.snap(clamp(Math.log(solved.dist), this._logMin, this._logMax));
    this._clear.snap(0);
    this._pullSnap = true;
    /* Snap the lens too, or the first second of the demo is spent gliding from
       the default FOV to the one the framing was solved against. */
    this._fov.snap(this._fovAt(solved.dist));
    this.camera.fov = this._fov.value;
    this.camera.updateProjectionMatrix();
    this._idle = 0;
    this._apply(0);

    this._openingReport = {
      seed,
      /* Which subject the fill was solved against. Anything other than
         'geometry' means the hull could not be walked and the framing is a
         circumscribing approximation — worth seeing in a capture report rather
         than discovering from a wide frame six months later. */
      sampledFrom,
      samples: pts.length / 3,
      yaw: aim.yaw,
      pitch: aim.pitch,
      distance: solved.dist,
      hullMultiple: solved.dist / hullLength,
      fillW: solved.w,
      fillH: solved.h,
      lit: typeof aim.lit === 'number' ? aim.lit : null,
      offsetX: wantX,
      offsetY: wantY,
      /* Every angle the search looked at, so a capture harness can show what
         was on offer rather than only what was taken. */
      candidates: this._probes || null,
    };
    return true;
  }

  /* ---------------------------------------------------------- sensors view */

  setSensorsMode(open) {
    const want = !!open;
    if (want === this._sensors) return;
    this._sensors = want;
    this._releaseCompose();

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

  /** Directional impulse from a blast. `reach` is the blast's range in metres
      and `strength` is FX's normalised magnitude (1.0 = destroyer primary). */
  addShake(point, reach = 3000, strength = 1) {
    if (this._reduced) return;
    if (!(strength > SHAKE_MIN_STRENGTH)) return;

    const camPos = this.camera.position;
    const d = Math.max(1, _v1.copy(camPos).sub(point).length());
    const r = Math.max(reach * FELT_REACH, MIN_FELT_REACH);
    if (d > r) return;

    /* Superlinear falloff, so the edge of the reach is genuinely nothing
       rather than a faint permanent tremor across the whole battle line. */
    const falloff = Math.pow(1 - d / r, 1.6);
    const amp = falloff * strength * SHAKE_GAIN;
    if (amp <= 0.002) return;

    this._shakeDir.copy(camPos).sub(point);
    if (this._shakeDir.lengthSq() < 1e-6) this._shakeDir.set(0, 1, 0);
    this._shakeDir.normalize();
    this._shakeSeed = (this._shakeSeed + 0.37) % 1;
    this._trauma = Math.min(1, this._trauma + amp);
  }

  /** Drop every undirected motion source to zero this instant. */
  _stillness() {
    this._trauma = 0;
    this._swayGain.snap(0);
  }

  /* FX owns the choreography of a death — which beats land, how far apart, and
     how hard. The rig used to mirror those tables and drifted out of sync the
     moment FX retimed anything; now it just listens. Every source that is
     allowed to shove the camera comes through this one channel, including
     ion-lance ignition. */
  _onBlast(p) {
    if (!p || !p.point) return;
    const s = typeof p.strength === 'number' ? p.strength : 1;
    const r = typeof p.radius === 'number' ? p.radius : 3000;
    if (!Number.isFinite(s) || !Number.isFinite(r)) return;
    this.addShake(p.point, r, s);
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

    if (this._follow && this._follow.length) this._trackFollow(dt);

    /* Follow re-framing (R7 fix 3): a few times a second, never mid-gesture. */
    if (this._recompHold > 0) this._recompHold -= dt;
    if (this._follow && !this._trans && !this._sensors && dt > 0) {
      this._recompT -= dt;
      if (this._recompT <= 0 && (this._recompForce || this._idle >= COMPOSE.idleBefore)) {
        this._recompT = COMPOSE.evalEvery;
        this._reframe(this._recompForce);
        this._recompForce = false;
      }
    }

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

    let dist = Math.exp(this._logDist.value);
    this._slideFocus(dist);
    const focus = this._focus.value;

    /* Never inside the thing you are looking at. */
    const floor = this._minDistance(this._focusRadius);
    if (dist < floor) dist = floor;

    const yaw = this._yaw.value;
    const pitch = this._pitch.value;
    const cp = Math.cos(pitch);
    _dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).normalize();

    /* Near-plane safety: come in short of any rock on the line to the subject. */
    dist = this._pullIn(focus, _dir, dist, floor, dt);

    /* Push out along the view vector if a hull swallowed the camera. */
    this._clear.target = Math.max(0, this._sweepClearance(focus, _dir, dist) - dist);
    this._clear.step(dt);
    const eff = dist + this._clear.value;

    _prevPos.copy(cam.position);
    _v1.copy(focus).addScaledVector(_dir, eff);
    _look.copy(focus);

    /* Opening composition. The subject is taken off dead centre by aiming past
       it rather than by moving the camera, so the framing distance the shot was
       solved for survives. It rides its own gain and slides back to a centred
       orbit the moment the player takes the camera — an off-centre pivot is a
       lovely still and a confusing thing to orbit around. */
    this._composeGain.step(dt);
    const cg = this._composeGain.value;
    if (cg > 0.001) {
      const tanV = Math.tan(cam.fov * DEG * 0.5);
      const tanH = tanV * Math.max(0.2, cam.aspect);
      this._camBasis(_dir, _right, _up);
      _look.addScaledVector(_right, -this._composeX * eff * tanH * cg);
      _look.addScaledVector(_up, -this._composeY * eff * tanV * cg);
    }

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
      const s = Math.pow(this._trauma, SHAKE_CURVE);
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

    /* Rocks between the lens and the subject are dithered out (R7 fix 3). */
    this._occluders(_v1, focus, dt);

    /* Near guard, after every offset: see the note at _hullHit. */
    {
      this._ngFrame++;
      this._ngStep = Math.max(0, dt) * COMPOSE.fadeRate * 2;
      for (const [i, f] of this._ngStamp) {
        if (f < this._ngFrame - 1) { this._ngStamp.delete(i); this._ngW.delete(i); }
      }
      const nq = clamp(eff * 0.006, 0.03, 140) * 1.03;
      const tv = Math.tan(cam.fov * DEG * 0.5) * 1.15;
      const quad = nq * Math.sqrt(1 + tv * tv * (1 + cam.aspect * cam.aspect)) + 0.02;
      if (this._nearGuard(_v1, quad, eff)) {
        this._safePos.copy(_v1);
        this._safeOk = true;
      } else if (this._safeOk) {
        _v1.copy(this._safePos);
        this._held++;
        this._nearGuard(_v1, quad, eff);
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
    const st = clamp01(this._moveSpeed / Math.max(1, eff * 1.6));
    this._fov.target = clamp(this._fovAt(eff) + 4.5 * st, 38, 62);
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

  /* The focus spring is critically damped, so it trails a subject moving at
     v by 2v/omega: at 6 rad/s a fighter at 150 m/s sat 50 m behind the focus,
     out of a 60 m shot entirely. R7's 50-move run measured the followed hull
     outside the frame on 30 moves of 50 for exactly that reason. So the
     target leads the centroid by its measured velocity times 2/omega, which
     takes the steady-state lag to zero. Velocity is measured from the
     centroid per real second, so sim speed and fixed-step jitter cannot
     skew it, and smoothed so one stepped tick does not kick the frame. */
  _trackFollow(dt) {
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
    _v2.divideScalar(n);
    const fv = this._followVel;
    if (dt > 0) {
      if (this._followPrevOk && this._followKey === list) {
        _v3.copy(_v2).sub(this._followPrev).divideScalar(dt);
        if (_v3.lengthSq() > FOLLOW_MAX_SPEED * FOLLOW_MAX_SPEED) fv.set(0, 0, 0);   // a jump, not motion
        else fv.lerp(_v3, 1 - Math.exp(-dt * FOLLOW_VEL_RATE));
      } else {
        fv.set(0, 0, 0);
      }
      this._followPrev.copy(_v2);
      this._followPrevOk = true;
      this._followKey = list;
    }
    this._focus.target.copy(_v2).addScaledVector(fv, 2 / Math.max(0.5, this._focus.omega));
    this._focusRadius = biggest;
  }

  /* ----------------------------------------------------- line of sight */

  /** Big immobile things in the scene that can stand between the camera and
      its subject. Cached: the asteroid field is built once and never moves,
      so this only re-runs when the scene graph gains or loses a child. */
  _harvestStatic() {
    const scene = this.engine && this.engine.scene;
    if (!scene) return this._static;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const stamp = scene.children.length;
    if (stamp === this._staticStamp && now - this._staticAt < HARVEST_INTERVAL_MS) return this._static;
    this._staticStamp = stamp;
    this._staticAt = now;

    const out = this._static;
    out.length = 0;
    this._backdropN = 0;
    this._nearN = 0;
    this._nearGen++;
    for (let i = 0; i < scene.children.length; i++) {
      const o = scene.children[i];
      if (!o || o.visible === false || !o.isMesh || !o.geometry) continue;
      /* Only gameplay-layer geometry can occlude gameplay. This also keeps the
         overlays out — they deliberately carry an infinite bounding sphere so
         they are never culled, and an infinite radius poisons every sum it
         reaches. */
      if (!o.layers.test(this.camera.layers) || !o.layers.isEnabled(0)) continue;

      const geo = o.geometry;
      if (!geo.boundingSphere) {
        try { geo.computeBoundingSphere(); } catch (err) { continue; }
      }
      const br = geo.boundingSphere ? geo.boundingSphere.radius : 0;
      if (!Number.isFinite(br) || br <= 0) continue;
      o.updateMatrixWorld();

      if (o.isInstancedMesh) {
        /* Every instance gets looked at, not just the short landmark batch:
           the cluster fields carry rocks well over a kilometre and one of those
           parked in front of the flagship is exactly the opening frame we are
           trying to stop. Instances below OCCLUDER_MIN_RADIUS fall out on their
           own, and this runs on a two-second cadence, not per frame.

           Only the top level of the scene is walked, and that is what keeps
           the fleet out: SIM's instanced batches hang under their own groups,
           and `_collidersFor` already tracks those from the entity list. Draw
           usage is deliberately *not* the discriminator — ENV marks its rock
           fields dynamic so it can stream LOD, and those are precisely the
           rocks that park themselves in front of the flagship. */
        const n = Math.min(o.count, MAX_SCANNED_INSTANCES);
        for (let k = 0; k < n; k++) {
          o.getMatrixAt(k, _m1);
          _m1.premultiply(o.matrixWorld);
          _m1.decompose(_p1, _q1, _s1);
          const rk = br * Math.max(_s1.x, _s1.y, _s1.z);
          this._pushOccluder(out, _p1, rk);
          this._pushBackdrop(_p1, rk);
          this._pushNear(_p1, _q1, _s1, geo);
        }
      } else {
        _m1.copy(o.matrixWorld).decompose(_p1, _q1, _s1);
        const rk = br * Math.max(_s1.x, _s1.y, _s1.z);
        this._pushOccluder(out, _p1, rk);
        this._pushBackdrop(_p1, rk);
        this._pushNear(_p1, _q1, _s1, geo);
      }
    }

    /* Keep the biggest: if the field is dense enough to overflow the budget,
       the ones that can actually hide a mothership are the ones that matter. */
    if (out.length > MAX_STATIC_OCCLUDERS) {
      out.sort((a, b) => b.r - a.r);
      out.length = MAX_STATIC_OCCLUDERS;
    }
    return out;
  }

  /** Accept a candidate occluder only if it is finite and in the size band
      where "it is in the way" is a meaningful statement. */
  _pushOccluder(out, pos, r) {
    if (!Number.isFinite(r) || r < OCCLUDER_MIN_RADIUS || r > OCCLUDER_MAX_RADIUS) return;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
    out.push({ x: pos.x, y: pos.y, z: pos.z, r });
  }

  /** Pooled record for the backdrop test. Runs on the harvest cadence over
      every rock instance, so it reuses its objects rather than allocating. */
  _pushBackdrop(pos, r) {
    if (!Number.isFinite(r) || r < BACKDROP_MIN_RADIUS || r > OCCLUDER_MAX_RADIUS) return;
    if (this._backdropN >= MAX_BACKDROP) return;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
    const list = this._backdrop;
    let o = list[this._backdropN];
    if (!o) list[this._backdropN] = o = { x: 0, y: 0, z: 0, r: 0 };
    o.x = pos.x; o.y = pos.y; o.z = pos.z; o.r = r;
    this._backdropN++;
  }

  /** Packed record for the near-plane tests: centre and the radius of the
      origin-centred sphere round the hull in `_near`, and in `_hull` the
      instance rotation and the world semi-axes of an ellipsoid that holds
      every vertex of the instance, so it holds the mesh. */
  _pushNear(pos, quat, scale, geo) {
    const e = this._hullOf(geo);
    if (!e) return;
    const ax = e[0] * Math.abs(scale.x);
    const ay = e[1] * Math.abs(scale.y);
    const az = e[2] * Math.abs(scale.z);
    const r = Math.max(ax, ay, az);
    if (!Number.isFinite(r) || r < NEAR_ROCK_MIN_RADIUS || r > OCCLUDER_MAX_RADIUS) return;
    if (this._nearN >= MAX_NEAR_ROCKS) return;
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return;
    const j = this._nearN * 4;
    const a = this._near;
    a[j] = pos.x; a[j + 1] = pos.y; a[j + 2] = pos.z; a[j + 3] = r;
    const m = _mh.makeRotationFromQuaternion(quat).elements;
    const h = this._hull;
    const k = this._nearN * 12;
    h[k] = m[0]; h[k + 1] = m[1]; h[k + 2] = m[2];
    h[k + 3] = m[4]; h[k + 4] = m[5]; h[k + 5] = m[6];
    h[k + 6] = m[8]; h[k + 7] = m[9]; h[k + 8] = m[10];
    h[k + 9] = ax; h[k + 10] = ay; h[k + 11] = az;
    this._nearN++;
  }

  /** Semi-axes, in geometry units, of an origin-centred ellipsoid holding
      every vertex. A rock is a displaced sphere stretched by `shape.axis`, so
      that ellipsoid is tight; anything else gets the origin-centred sphere.
      A convex body that holds every vertex holds every triangle. Once per
      geometry. */
  _hullOf(geo) {
    const ud = geo.userData || (geo.userData = {});
    if (ud._nearHull !== undefined) return ud._nearHull;
    const pos = geo.attributes && geo.attributes.position;
    let out = null;
    if (pos && pos.count) {
      const ax = ud.shape && ud.shape.axis ? ud.shape.axis : [1, 1, 1];
      let k = 0;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) / ax[0];
        const y = pos.getY(i) / ax[1];
        const z = pos.getZ(i) / ax[2];
        const l = x * x + y * y + z * z;
        if (l > k) k = l;
      }
      k = Math.sqrt(k) * 1.0005;
      if (k > 0 && Number.isFinite(k)) out = [ax[0] * k, ax[1] * k, ax[2] * k];
    }
    ud._nearHull = out;
    return out;
  }

  /** How far to grow each semi-axis of hull `k` (a `_hull` offset) so it
      holds everything within `grow` metres of it. A plain `+ grow` does not
      on a flat rock; scaling by longest over shortest does. */
  _hullGrow(k, grow) {
    const h = this._hull;
    const mx = Math.max(h[k + 9], h[k + 10], h[k + 11]);
    const mn = Math.min(h[k + 9], h[k + 10], h[k + 11]);
    return grow * mx / Math.max(mn, 1e-6);
  }

  /** Normalised radius of a world point in near-rock `i`'s hull grown by
      `grow` metres: under 1 is inside. */
  _hullRho(i, px, py, pz, grow) {
    const a = this._near;
    const h = this._hull;
    const j = i * 4;
    const k = i * 12;
    const g = this._hullGrow(k, grow);
    const dx = px - a[j];
    const dy = py - a[j + 1];
    const dz = pz - a[j + 2];
    const lx = (dx * h[k] + dy * h[k + 1] + dz * h[k + 2]) / (h[k + 9] + g);
    const ly = (dx * h[k + 3] + dy * h[k + 4] + dz * h[k + 5]) / (h[k + 10] + g);
    const lz = (dx * h[k + 6] + dy * h[k + 7] + dz * h[k + 8]) / (h[k + 11] + g);
    return Math.sqrt(lx * lx + ly * ly + lz * lz);
  }

  /** Where the ray `f + t * dir` enters and leaves near-rock `i`'s hull grown
      by `grow` metres, into `out`; false on a miss. */
  _hullRay(i, f, dir, grow, out) {
    const a = this._near;
    const h = this._hull;
    const j = i * 4;
    const k = i * 12;
    const g = this._hullGrow(k, grow);
    const sx = 1 / (h[k + 9] + g);
    const sy = 1 / (h[k + 10] + g);
    const sz = 1 / (h[k + 11] + g);
    const dx = f.x - a[j];
    const dy = f.y - a[j + 1];
    const dz = f.z - a[j + 2];
    const ox = (dx * h[k] + dy * h[k + 1] + dz * h[k + 2]) * sx;
    const oy = (dx * h[k + 3] + dy * h[k + 4] + dz * h[k + 5]) * sy;
    const oz = (dx * h[k + 6] + dy * h[k + 7] + dz * h[k + 8]) * sz;
    const vx = (dir.x * h[k] + dir.y * h[k + 1] + dir.z * h[k + 2]) * sx;
    const vy = (dir.x * h[k + 3] + dir.y * h[k + 4] + dir.z * h[k + 5]) * sy;
    const vz = (dir.x * h[k + 6] + dir.y * h[k + 7] + dir.z * h[k + 8]) * sz;
    const A = vx * vx + vy * vy + vz * vz;
    const B = ox * vx + oy * vy + oz * vz;
    const C = ox * ox + oy * oy + oz * oz - 1;
    const D = B * B - A * C;
    if (!(A > 0) || !(D > 0)) return false;
    const q = Math.sqrt(D);
    out[0] = (-B - q) / A;
    out[1] = (-B + q) / A;
    return true;
  }

  /** The last line of the guarantee. Tests the near quad, a ball of radius
      `quad` round `pos`, against every rock hull in reach and fills the rock
      shader's fade slots: 0 for a hull the quad is inside, rising to 1 over a
      short ramp outside it. False when more rocks hold the quad than there
      are slots, in which case nothing is written and the caller must move. */
  _nearGuard(pos, quad, eff) {
    this._harvestStatic();
    const near = this._near;
    const ramp = Math.max(1.5, eff * 0.08);
    const fi = this._fadeI;
    const fw = this._fadeW;
    let used = 0;
    let inside = 0;
    for (let i = 0, j = 0; i < this._nearN; i++, j += 4) {
      const dx = pos.x - near[j];
      const dy = pos.y - near[j + 1];
      const dz = pos.z - near[j + 2];
      const reach = near[j + 3] + this._hullGrow(i * 12, quad + ramp);
      if (dx * dx + dy * dy + dz * dz >= reach * reach) continue;
      const far = this._hullRho(i, pos.x, pos.y, pos.z, quad + ramp);
      if (far >= 1) continue;
      const rho = this._hullRho(i, pos.x, pos.y, pos.z, quad);
      const ws = rho <= 1 ? 0 : Math.min(1, (rho - 1) / Math.max(rho - far, 1e-6));
      if (ws === 0) inside++;
      /* The ramp only starts the fade; time finishes it. A lens parked inside
         the ramp used to hold the rock at a partial dither for as long as the
         shot lasted - a translucent ghost (R8 fix 3). */
      const prev = this._ngW.has(i) ? this._ngW.get(i) : ws;
      const w = this._ngStamp.get(i) === this._ngFrame ? Math.min(ws, prev) : Math.max(0, Math.min(ws, prev - this._ngStep));
      this._ngW.set(i, w);
      this._ngStamp.set(i, this._ngFrame);
      if (used < ROCK_FADE_SLOTS) {
        fi[used] = i; fw[used] = w; used++;
      } else {
        let worst = 0;
        for (let s = 1; s < used; s++) if (fw[s] > fw[worst]) worst = s;
        if (w < fw[worst]) { fi[worst] = i; fw[worst] = w; }
      }
    }
    if (inside > ROCK_FADE_SLOTS) return false;
    /* Free slots go to rocks standing between the lens and the subject. The
       near quad always outranks them: a rock the quad is in is already here. */
    const u = rockFadeUniform.value;
    let s = 0;
    for (; s < used; s++) {
      const j = fi[s] * 4;
      u[s].set(near[j], near[j + 1], near[j + 2], fw[s]);
    }
    const oc = this._occC;
    for (let e = 0; e < ROCK_FADE_SLOTS && s < ROCK_FADE_SLOTS; e++) {
      if (this._occW[e] >= 0.999) continue;
      const x = oc[e * 3];
      const y = oc[e * 3 + 1];
      const z = oc[e * 3 + 2];
      let dup = false;
      for (let q = 0; q < s; q++) {
        if (Math.abs(u[q].x - x) < 0.5 && Math.abs(u[q].y - y) < 0.5 && Math.abs(u[q].z - z) < 0.5) dup = true;
      }
      if (dup) continue;
      u[s++].set(x, y, z, this._occW[e]);
    }
    for (; s < ROCK_FADE_SLOTS; s++) u[s].set(ROCK_FADE_FAR, ROCK_FADE_FAR, ROCK_FADE_FAR, 1);
    this._fadeN = inside;
    return true;
  }

  /** The rocks that can matter to a shot `reach` around `focus`, nearest
      first, at most NEAR_CANDIDATES of them. Cached as a ball that contains
      the query ball, so a followed fighter rescans a few times a second and
      a still shot never does. */
  _nearCandidates(focus, reach) {
    this._harvestStatic();
    const a = this._candAt;
    const dx = focus.x - a.x;
    const dy = focus.y - a.y;
    const dz = focus.z - a.z;
    if (a.gen === this._nearGen && Math.sqrt(dx * dx + dy * dy + dz * dz) + reach <= a.reach) return this._candN;

    let R = reach * 1.6 + 40;
    const near = this._near;
    const idx = this._candIdx;
    const key = this._candKey;
    idx.length = 0;
    key.length = 0;
    for (let i = 0, j = 0; i < this._nearN; i++, j += 4) {
      const ox = near[j] - focus.x;
      const oy = near[j + 1] - focus.y;
      const oz = near[j + 2] - focus.z;
      const s = Math.sqrt(ox * ox + oy * oy + oz * oz) - near[j + 3];
      if (s < R) { idx.push(i); key.push(s); }
    }
    let n = idx.length;
    if (n > NEAR_CANDIDATES) {
      /* Keep the nearest, and shrink the cached ball to what is still whole. */
      const order = idx.map((_, k) => k).sort((p, q) => key[p] - key[q]);
      R = key[order[NEAR_CANDIDATES]];
      for (let k = 0; k < NEAR_CANDIDATES; k++) this._cand[k] = idx[order[k]];
      n = NEAR_CANDIDATES;
    } else {
      for (let k = 0; k < n; k++) this._cand[k] = idx[k];
    }
    this._candN = n;
    a.x = focus.x; a.y = focus.y; a.z = focus.z;
    a.reach = R;
    a.gen = this._nearGen;
    return n;
  }

  /** Clearance around a rock's bounding sphere for a camera `dist` out: the
      near plane sits at dist * 0.006 and its corners about as far again off
      axis, so this keeps the whole near quad outside the rock. */
  _nearBand(dist) {
    return dist * 0.012 + 0.5;
  }

  /** Orbit distance after pulling in short of every rock between the subject
      and the camera. `floor` is the closest the shot may come; a rock that
      starts inside it cannot be pulled in front of, so the camera is pushed
      out past that one instead — it then hides part of the subject, but the
      near plane is never inside it. */
  _pullIn(focus, dir, dist, floor, dt) {
    const pb = this._pullBounds(focus, dir, dist, floor);
    const softK = pb.soft / dist;
    if (this._pullSnap || !(dt > 0)) {
      this._pullK = softK;
      this._pullSnap = false;
    } else {
      const rate = softK < this._pullK ? PULL_IN_RATE : PULL_OUT_RATE;
      this._pullK += (softK - this._pullK) * (1 - Math.exp(-dt * rate));
    }
    let d = dist * Math.min(this._pullK, pb.hard / dist);
    const low = Math.min(floor, pb.hard, dist);
    if (d < low) d = low;
    d = this._pushOut(focus, dir, d, pb.n, pb.band);
    if (!Number.isFinite(d)) return dist;
    return Math.min(d, dist * 4 + 2000);
  }

  /** Where `_pullIn` comes to rest for a requested `dist`: the same
      geometry with the smoothing settled. The shot score is taken here, at the
      camera the player will actually get, not at the distance asked for —
      R7 scored the request and under-counted rock in tight pockets (R8 fix 3). */
  _settledDist(focus, dir, dist, floor) {
    if (dist < floor) dist = floor;
    const pb = this._pullBounds(focus, dir, dist, floor);
    let d = Math.min(pb.soft, pb.hard);
    const low = Math.min(floor, pb.hard, dist);
    if (d < low) d = low;
    d = this._pushOut(focus, dir, d, pb.n, pb.band);
    if (!Number.isFinite(d)) return dist;
    return Math.min(d, dist * 4 + 2000);
  }

  /** Rocks hugging the subject: out past them, never inside. */
  _pushOut(focus, dir, d, n, band) {
    const cand = this._cand;
    const hit = _hullHit;
    for (let pass = 0; pass < 2; pass++) {
      for (let c = 0; c < n; c++) {
        const i = cand[c];
        if (this._hullRho(i, focus.x, focus.y, focus.z, band) < 1) continue;
        if (!this._hullRay(i, focus, dir, band, hit)) continue;
        if (d > hit[0] && d < hit[1]) d = hit[1];
      }
    }
    return d;
  }

  /** The soft (sphere) and hard (hull) distances the pull-in may not pass. */
  _pullBounds(focus, dir, dist, floor) {
    const n = this._nearCandidates(focus, dist * 1.25 + 50);
    const band = this._nearBand(dist);
    const near = this._near;
    const cand = this._cand;
    /* The soft pull respects the shot floor; the hard limit may go under it,
       to just clear the subject, before it gives up and pushes out instead. */
    const hardFloor = Math.max((this._focusRadius || 0) * 1.05, 1.5);
    let hard = dist;
    let soft = dist;
    const hit = _hullHit;
    for (let c = 0; c < n; c++) {
      const i = cand[c];
      const j = i * 4;
      const r = near[j + 3];
      /* A subject inside a rock's hull cannot be framed from outside it on
         this line. Round 5 cast against a sphere shrunk to the subject's
         height here, and that sphere does not hold a stretched rock: the
         camera orbited into the mesh. The near guard fades that rock instead. */
      if (this._hullRho(i, focus.x, focus.y, focus.z, band) < 1) continue;
      const mx = focus.x - near[j];
      const my = focus.y - near[j + 1];
      const mz = focus.z - near[j + 2];
      const m2 = mx * mx + my * my + mz * mz;
      const b = dir.x * mx + dir.y * my + dir.z * mz;
      /* The soft sphere holds the grown hull, so missing it misses the hull. */
      const rs = Math.max(r * 1.1 + band * 2.5, r + this._hullGrow(i * 12, band)) + 1;
      const ds = b * b - (m2 - rs * rs);
      if (ds <= 0) continue;
      const ss = Math.sqrt(ds);
      const t1s = -b - ss;
      if (-b + ss <= 0 || t1s >= dist) continue;
      if (t1s > floor && t1s < soft) soft = t1s;
      if (!this._hullRay(i, focus, dir, band, hit) || hit[1] <= 0) continue;
      const t1 = hit[0];
      if (t1 > hardFloor && t1 < hard) hard = t1;
    }
    const pb = this._pb;
    pb.soft = soft; pb.hard = hard; pb.n = n; pb.band = band;
    return pb;
  }

  /** A focus gliding from one subject to the next goes round rocks, not
      through them. Mid-glide the focus is a point in empty space, and on a
      straight line between two ships it happily passes through a landmark;
      the pull-in cannot help then, because a camera orbiting a point inside
      a rock is inside it too. So the gliding focus is held on the surface of
      any rock sphere it enters and slides round it toward its target. A rock
      that contains the target itself is left alone — that is where the
      subject lives, and the glide has to arrive. */
  _slideFocus(dist) {
    const f = this._focus.value;
    const tg = this._trans ? this._trans.to.focus : this._focus.target;
    const gx = tg.x - f.x;
    const gy = tg.y - f.y;
    const gz = tg.z - f.z;
    if (gx * gx + gy * gy + gz * gz < 1) return;
    const n = this._nearCandidates(f, dist * 1.25 + 50);
    const band = this._nearBand(dist);
    const near = this._near;
    for (let pass = 0; pass < 2; pass++) {
      for (let c = 0; c < n; c++) {
        const j = this._cand[c] * 4;
        const cx = near[j];
        const cy = near[j + 1];
        const cz = near[j + 2];
        /* The soft sphere of _pullIn, so a sliding focus never sits inside
           the hard one and trips its push-out. */
        const R = near[j + 3] * 1.1 + band * 2.5 + 1;
        const tx = tg.x - cx;
        const ty = tg.y - cy;
        const tz = tg.z - cz;
        if (tx * tx + ty * ty + tz * tz < R * R) continue;
        const mx = f.x - cx;
        const my = f.y - cy;
        const mz = f.z - cz;
        const m2 = mx * mx + my * my + mz * mz;
        if (m2 >= R * R || m2 < 1e-6) continue;
        const m = Math.sqrt(m2);
        const k = R / m;
        f.set(cx + mx * k, cy + my * k, cz + mz * k);
        if (this._trans) continue;               // the transition re-lerps every frame
        /* Slide, do not stick: drop the velocity into the rock and keep a
           minimum speed round it toward the target, or a target almost
           straight behind the rock would leave the focus parked on its face. */
        const nx = mx / m;
        const ny = my / m;
        const nz = mz / m;
        const v = this._focus.velocity;
        const vn = v.x * nx + v.y * ny + v.z * nz;
        if (vn < 0) v.set(v.x - nx * vn, v.y - ny * vn, v.z - nz * vn);
        const wx = tg.x - f.x;
        const wy = tg.y - f.y;
        const wz = tg.z - f.z;
        const wn = wx * nx + wy * ny + wz * nz;
        _v3.set(wx - nx * wn, wy - ny * wn, wz - nz * wn);
        if (_v3.lengthSq() < 1e-6) _v3.set(-nz, 0, nx);   // dead behind: pick a side
        if (_v3.lengthSq() < 1e-6) _v3.set(1, 0, 0);
        _v3.normalize();
        const want = this._focus.omega * 0.35 * Math.sqrt(wx * wx + wy * wy + wz * wz);
        const vt = v.x * _v3.x + v.y * _v3.y + v.z * _v3.z;
        if (vt < want) v.addScaledVector(_v3, want - vt);
      }
    }
  }

  /** Would a camera `dist` out along `dir` have rock on its line to the
      subject, or sit inside one? The focus search treats that as blocked:
      the per-frame pull-in would otherwise shorten the very shot it chose. */
  _rockOnPath(focus, dir, dist, floor) {
    const n = this._nearCandidates(focus, dist * 1.25 + 50);
    const band = this._nearBand(dist);
    const hit = _hullHit;
    const cx = focus.x + dir.x * dist;
    const cy = focus.y + dir.y * dist;
    const cz = focus.z + dir.z * dist;
    for (let c = 0; c < n; c++) {
      const i = this._cand[c];
      /* A camera inside any rock's hull plus the near band is never a
         candidate, whatever the line to the subject does (R6 fix 2). */
      if (this._hullRho(i, cx, cy, cz, band) < 1) return true;
      if (this._hullRho(i, focus.x, focus.y, focus.z, band) < 1) continue;
      if (!this._hullRay(i, focus, dir, band, hit)) continue;
      if (hit[1] > floor && hit[0] < dist) return true;
    }
    return false;
  }

  /** Share, 0..1, of the patch of frame around the subject that is rock
      standing *behind* it, for a camera `dist` away along `dir`.

      The patch is the subject's own angular size with a margin, never less
      than about a third of the frame's half-height, because a hull smaller
      than that is read against whatever surrounds it rather than against the
      pixels it happens to cover. Overlap is a cheap disc-in-disc estimate and
      overlapping rocks may count twice; it is a ranking, capped at 1. */
  _backdropCover(focus, dir, dist, subjectRadius) {
    const n = this._backdropN;
    if (!n) return 0;
    const list = this._backdrop;
    const halfFov = this.camera.fov * DEG * 0.5;
    const subj = Math.max(subjectRadius || 0, dist * 0.12);
    const win = Math.max(Math.atan2(subj * 1.8, Math.max(dist, 1)), halfFov * 0.32);
    const winA = win * win;
    const camX = focus.x + dir.x * dist;
    const camY = focus.y + dir.y * dist;
    const camZ = focus.z + dir.z * dist;
    const reach = dist * BACKDROP_REACH + 4000;
    let cover = 0;
    for (let i = 0; i < n; i++) {
      const o = list[i];
      const fx = o.x - focus.x;
      const fy = o.y - focus.y;
      const fz = o.z - focus.z;
      if (fx * fx + fy * fy + fz * fz < o.r * o.r) continue; // we are inside it
      let ox = o.x - camX;
      let oy = o.y - camY;
      let oz = o.z - camZ;
      /* Depth along the view axis: only what sits past the subject's plane. */
      const depth = -(ox * dir.x + oy * dir.y + oz * dir.z);
      if (depth <= dist || depth > reach) continue;
      const dc = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const half = Math.asin(clamp(o.r / dc, 0, 1));
      ox /= dc; oy /= dc; oz /= dc;
      const off = Math.acos(clamp(-(ox * dir.x + oy * dir.y + oz * dir.z), -1, 1));
      if (off >= half + win) continue;
      const m = Math.min(half, win);
      cover += clamp((half + win - off) / (2 * m), 0, 1) * ((m * m) / winA);
      if (cover >= 1) return 1;
    }
    return cover;
  }

  /** Is the subject at `focus` hidden from a camera `dist` away along `dir`?

      Not a ray test: a five-kilometre rock that the centre line misses by a
      few hundred metres still eats half the frame. The subject has to be clear
      inside a corridor that widens with the shot, which is what "you can see
      the ship" actually means. */
  _sightBlocked(focus, dir, dist, list, subjectRadius) {
    /* Everything here is in angles, so it is independent of zoom, of the size
       of the subject, and of how far away the obstruction happens to be. */
    const halfFov = this.camera.fov * DEG * 0.5;
    const minHalf = halfFov * OCCLUSION_FRACTION;
    /* If the caller does not know how big the subject is, protect the middle
       of the frame instead — a shot of the flagship with a rock across the
       centre is a bad shot whatever the flagship measures. */
    const subjHalf = Math.atan2(Math.max(subjectRadius || 0, dist * 0.12), Math.max(dist, 1));

    const camX = focus.x + dir.x * dist;
    const camY = focus.y + dir.y * dist;
    const camZ = focus.z + dir.z * dist;

    for (let i = 0; i < list.length; i++) {
      const o = list[i];

      /* A volume we are standing inside is not an obstruction. */
      const fx = o.x - focus.x;
      const fy = o.y - focus.y;
      const fz = o.z - focus.z;
      if (fx * fx + fy * fy + fz * fz < o.r * o.r) continue;

      let ox = o.x - camX;
      let oy = o.y - camY;
      let oz = o.z - camZ;
      const dc = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (dc <= o.r) return true;               // the camera is inside it
      if (dc > dist * 4 + o.r) continue;        // genuinely backdrop, leave it

      /* Something behind the subject does not hide it, but a rock face filling
         the lower half of the frame still turns the flagship into a detail
         standing on a dune. Backdrop bodies therefore have to be much larger
         before they count — they have to be dominating the shot, not merely
         present in it. */
      const half = Math.asin(clamp(o.r / dc, 0, 1));
      if (half < (dc > dist ? halfFov * 0.85 : minHalf)) continue;

      /* How far off the centre of the shot it sits. */
      ox /= dc; oy /= dc; oz /= dc;
      const off = Math.acos(clamp(-(ox * dir.x + oy * dir.y + oz * dir.z), -1, 1));
      if (off < half + subjHalf * 0.9) return true;
    }
    return false;
  }

  /** Choose the shot for a framing the rig was asked for: boot, F,
      `ui:focus`, a script's focusOn. The key-light solve gives the search its
      origin (with its flank preference when there is a hull to show); every
      candidate pose round that is then scored by `_shotScore` and the
      cheapest wins. This replaces the key swing, `_clearView`'s sight and
      backdrop passes and its buried fallback, which used to run one after
      another and overrule each other (R7 fix 3). */
  _compose(instant, hero, list) {
    const yawIn = this._yaw.target;
    this._keyQuarter(false, hero);
    const yaw0 = this._yaw.target;
    this._yaw.target = yawIn;
    const pitch0 = this._pitch.target;
    const dist0 = Math.exp(this._logDist.target);
    /* A new framing earns its own fades: start from every rock solid, so the
       search prefers a pose that needs none. */
    this._forcedN = 0;
    const ctx = this._shotContext(this._focus.target, list);
    const best = this._bestShot(ctx, yaw0, pitch0, dist0);
    this._takeShot(best, instant);
    this._forceHeld(ctx, best);
    this._lastClear = {
      swing: best.i,
      score: +best.score.toFixed(3),
      rock: best.rock,
      front: best.front,
      back: best.back,
      eff: best.eff,
      forced: this._forcedN,
      clip: best.clip,
      size: best.size,
      cover: best.cover,
      path: best.path,
      blocked: best.blocked,
      dist: best.dist / dist0,
    };
    this._recompHold = list ? COMPOSE.cooldown : 0;
  }

  /** The follow camera's re-framing. Scores the pose it already has; moves
      only when that pose breaks a hard rule, a candidate beats it by
      `switchGain`, and the last move is a cooldown old. The springs ease it
      there. `force` skips the cooldown, for the first look at a new subject. */
  _reframe(force) {
    const list = this._follow;
    if (!list || !list.length) return;
    /* Only while the opening still holds its framing; once released, the
       slow ease of its gain must not shut re-framing out (R8: the first move
       after boot kept a capital overflowing the frame for seconds). */
    if (this._composeGain.target > 0 && this._composeGain.value > 0.01) return;
    const focus = this._focus.target;
    const ctx = this._shotContext(focus, list);
    const yaw = this._yaw.target;
    const pitch = this._pitch.target;
    const dist = Math.exp(this._logDist.target);
    const cp = Math.cos(pitch);
    _try.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).normalize();
    const cur = this._shotScore(ctx, _try, dist);
    const sh = this._shot;
    this._lastFrame = {
      cur: +cur.toFixed(3), rock: sh.rock, front: sh.front, back: sh.back, eff: sh.eff,
      clip: sh.clip, size: sh.size, moved: false, forced: this._forcedN,
    };
    /* The cooldown keeps it from flicking between near-equal shots; a subject
       cut by the frame edge or shrunk under COMPOSE.minSize is not near-equal,
       so that waits only COMPOSE.breakHold after the last move. */
    const broken = sh.clip || (sh.size >= 0 && sh.size < COMPOSE.minSize);
    const hold = broken ? this._recompHold - (COMPOSE.cooldown - COMPOSE.breakHold) : this._recompHold;
    if (cur < COMPOSE.reject || (!force && hold > 0)) {
      /* Held: the fades follow the subject through the rocks it passes. */
      _held.yaw = yaw; _held.pitch = pitch; _held.dist = dist;
      this._forceHeld(ctx, _held);
      this._lastFrame.forced = this._forcedN;
      return;
    }
    const best = this._bestShot(ctx, yaw, pitch, dist);
    if (!(best.score < cur - COMPOSE.switchGain)) {
      _held.yaw = yaw; _held.pitch = pitch; _held.dist = dist;
      this._forceHeld(ctx, _held);
      this._lastFrame.forced = this._forcedN;
      return;
    }
    this._takeShot(best, false);
    this._forceHeld(ctx, best);
    this._recompHold = COMPOSE.cooldown;
    this._lastFrame.moved = true;
    this._lastFrame.to = +best.score.toFixed(3);
    this._lastFrame.rockTo = best.rock;
    this._lastFrame.swing = best.i;
    this._lastFrame.forced = this._forcedN;
  }

  /** Fade outright whatever rock the pose about to be held still has over the
      line, front or back (the R8 fallback). */
  _forceHeld(ctx, pose) {
    const cp = Math.cos(pose.pitch);
    _try.set(Math.sin(pose.yaw) * cp, Math.sin(pose.pitch), Math.cos(pose.yaw) * cp).normalize();
    this._forceFades(ctx, _try, pose.dist);
  }

  _takeShot(best, instant) {
    this._yaw.target = best.yaw;
    this._pitch.target = best.pitch;
    this._logDist.target = clamp(Math.log(best.dist), this._logMin, this._logMax);
    if (instant) {
      this._yaw.snap(best.yaw);
      this._pitch.snap(best.pitch);
      this._logDist.snap(this._logDist.target);
    }
  }

  /** Everything a shot score needs that does not depend on the pose. */
  _shotContext(focus, list) {
    const dist = Math.exp(this._logDist.target);
    const ctx = this._ctx || (this._ctx = {
      focus: null, list: null, floor: 0, subjR: 0, pts: null, sun: new THREE.Vector3(), haveSun: false,
    });
    ctx.focus = focus;
    ctx.list = this._occluderList(focus, dist);
    ctx.floor = this._minDistance(this._focusRadius);
    ctx.subjR = this._focusRadius || 0;
    ctx.pts = list && list.length ? this._subjectPts(list) : null;
    ctx.fill = ctx.pts ? this._fillFor(list) : null;
    ctx.haveSun = this._sunDir(ctx.sun);
    /* Twice the distance: a clipped subject may be scored pulled back. */
    this._compRocks(focus, dist * 2);
    return ctx;
  }

  /** Search CLEAR_SEARCH round (yaw0, pitch0) for the cheapest pose. A pose
      whose subject is clipped or too small also gets one corrective distance,
      scored on its own merits plus the cost of the change. Swing cost alone
      only grows down the list, so the search stops paying once it passes the
      best score found. */
  _bestShot(ctx, yaw0, pitch0, dist0) {
    const out = this._bestOut || (this._bestOut = {
      yaw: 0, pitch: 0, dist: 0, score: 0, i: -1, rock: 0, clip: false, size: -1, cover: 0, path: false, blocked: false,
    });
    out.score = Infinity;
    out.i = -1;
    out.yaw = yaw0; out.pitch = pitch0; out.dist = dist0;
    const sh = this._shot;
    const lo = this._minDistance(this._focusRadius);
    const hi = this.options.maxDistance;
    for (let i = 0; i < CLEAR_SEARCH.length; i++) {
      const pitch = clamp(pitch0 + CLEAR_SEARCH[i][1], -PITCH_LIMIT, PITCH_LIMIT);
      const swing = Math.abs(CLEAR_SEARCH[i][0]) * COMPOSE.swingYaw + Math.abs(pitch - pitch0) * COMPOSE.swingPitch;
      if (swing >= out.score) continue;
      const yaw = yaw0 + CLEAR_SEARCH[i][0];
      const cp = Math.cos(pitch);
      _try.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).normalize();
      for (let pass = 0; pass < 3; pass++) {
        let d = dist0;
        if (pass > 0) {
          /* Projected size goes as 1 / distance, measured where the lens came
             to rest. A pass that changes nothing ends the corrections. */
          if (!ctx.pts || !(sh.edge < Infinity) || sh.size <= 0) break;
          const fill = ctx.fill;
          const eff = sh.eff;
          if (sh.clip) d = eff * sh.edge / COMPOSE.fitTo;
          else if (fill && (sh.size < fill.lo || sh.size > fill.hi)) d = eff * sh.size / fill.want;
          else if (sh.size < COMPOSE.minSize) d = eff * sh.size / (COMPOSE.minSize * 2);
          else break;
          d = clamp(d, lo, hi);
          if (Math.abs(d - eff) < eff * 0.02) break;
        }
        const s = swing + Math.abs(Math.log(d / dist0)) * COMPOSE.distWeight + this._shotScore(ctx, _try, d);
        if (s < out.score) {
          out.score = s; out.i = i; out.yaw = yaw; out.pitch = pitch; out.dist = d;
          out.rock = sh.rock; out.clip = sh.clip; out.size = sh.size; out.cover = sh.cover;
          out.path = sh.path; out.blocked = sh.blocked;
          out.front = sh.front; out.back = sh.back; out.eff = sh.eff;
        }
      }
      if (out.score < 0.05) break;          // clean, lit and unmoved: nothing to beat
    }
    return out;
  }

  /** Cost of a camera `dist` out from the focus along `dir`; lower is better.
      A hard rule broken costs COMPOSE.reject. Fills `this._shot`. */
  _shotScore(ctx, dir, dist) {
    const sh = this._shot;
    const focus = ctx.focus;
    let s = 0;
    /* Rock on the line, or a camera inside a hull, at the distance asked for:
       the pull-in will move the lens. That is a cost, not a rejection, now
       that everything below is scored where the lens comes to rest (R8). */
    sh.path = this._rockOnPath(focus, dir, dist, ctx.floor);
    if (sh.path) s += COMPOSE.pathCost;
    const eff = this._settledDist(focus, dir, dist, ctx.floor);
    sh.eff = eff;
    /* Pushed out past a rock the subject is tucked against: from there the
       hull is a speck behind a wall. Seed 99 put a 34 m corvette 900 m out. */
    if (eff > dist * 1.5 + 20) s += COMPOSE.reject;
    dist = eff;
    /* Something big across the shot from there. */
    sh.blocked = ctx.list.length > 0 && this._sightBlocked(focus, dir, dist, ctx.list, ctx.subjR);
    if (sh.blocked) s += COMPOSE.reject * 2;
    /* The key band, by how far outside it the lens sits. */
    if (ctx.haveSun) {
      const a = Math.acos(clamp(dir.x * ctx.sun.x + dir.y * ctx.sun.y + dir.z * ctx.sun.z, -1, 1));
      const off = a < KEY_QUARTER.min ? KEY_QUARTER.min - a : a > KEY_QUARTER.max ? a - KEY_QUARTER.max : 0;
      s += off * COMPOSE.keyWeight;
    }
    const fov = this._fovAt(dist);
    sh.rock = this._rockShare(focus, dir, dist, fov);
    s += sh.rock * COMPOSE.rockWeight;
    /* Rock in front of the subject and rock behind it are separate rules: a
       hull standing on a slab that fills the frame is as lost as one seen
       through a wall (R8 fix 3). */
    const over = Math.max(sh.front, sh.back) - COMPOSE.rockMax;
    if (over > 0) s += COMPOSE.reject + over * 10;
    /* Rock of the subject's own value right behind it (R4). */
    sh.cover = this._backdropCover(focus, dir, dist, ctx.subjR);
    s += Math.max(0, sh.cover - BACKDROP_OK) * COMPOSE.backdropWeight * 3;
    sh.clip = false;
    sh.size = -1;
    sh.edge = 0;
    if (ctx.pts) {
      const sp = this._spanAt(ctx.pts, focus, dir, dist, fov, _span);
      if (!sp) {
        sh.clip = true;
        sh.edge = Infinity;
      } else {
        /* Size in shares of the frame HEIGHT, whichever axis the hull lies on. */
        sh.size = Math.max(sp.w * Math.max(0.2, this.camera.aspect), sp.h);
        sh.edge = Math.max(Math.abs(sp.cx) + sp.w, Math.abs(sp.cy) + sp.h);
        sh.clip = sh.edge > 1 - COMPOSE.margin;
      }
      if (sh.clip) s += COMPOSE.reject;
      else if (sh.size < COMPOSE.minSize) s += COMPOSE.reject + (COMPOSE.minSize - sh.size) * 40;
      const fill = ctx.fill;
      if (fill && sh.size > 0) {
        if (sh.size < fill.lo) s += Math.log(fill.lo / sh.size) * COMPOSE.fillWeight;
        else if (sh.size > fill.hi) s += Math.log(sh.size / fill.hi) * COMPOSE.fillWeight;
      }
    }
    sh.score = s;
    return s;
  }

  /** The fill band for the biggest hull in `list`, by role; null for strike
      craft, which R7 already frames well. */
  _fillFor(list) {
    if (!list) return null;
    let big = null;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e && e.alive !== false && (!big || (e.radius || 0) > (big.radius || 0))) big = e;
    }
    if (!big) return null;
    const role = big.role || (big.def && big.def.role);
    return FILL[role] || null;
  }

  /** Fallback (R8 fix 3): when even the best pose leaves more than
      COMPOSE.rockMax of the frame rock in front of the subject or behind it,
      the rocks that cover most of the offending side are faded outright — a
      dither to nothing, never a ghost — until the share is back under the
      line or COMPOSE.fadeSlots rocks are used. Re-scores the held pose to fill
      the per-rock ray counts. */
  _forceFades(ctx, dir, dist) {
    this._forcedN = 0;
    this._shotScore(ctx, dir, dist);
    const sh = this._shot;
    const total = COMPOSE.gridX * COMPOSE.gridY;
    let front = Math.round(sh.front * total);
    let back = Math.round(sh.back * total);
    const lim = COMPOSE.rockMax * total;
    const F = this._compHitF;
    const B = this._compHitB;
    const near = this._near;
    const keep = this._compKeep;
    const m = this._compM || 0;
    while (this._forcedN < COMPOSE.fadeSlots && (front > lim || back > lim)) {
      const useF = front - lim >= back - lim;
      let best = -1;
      for (let k = 0; k < m; k++) if ((useF ? F[k] : B[k]) > 0 && (best < 0 || (useF ? F[k] > F[best] : B[k] > B[best]))) best = k;
      if (best < 0) break;
      const j = keep[best] * 4;
      const f = this._forcedN * 3;
      this._forced[f] = near[j]; this._forced[f + 1] = near[j + 1]; this._forced[f + 2] = near[j + 2];
      this._forcedN++;
      front -= F[best]; back -= B[best];
      F[best] = 0; B[best] = 0;
    }
    return this._forcedN;
  }

  _isForced(i) {
    const j = i * 4;
    const near = this._near;
    const fc = this._forced;
    for (let q = 0; q < this._forcedN; q++) {
      if (Math.abs(fc[q * 3] - near[j]) < 0.5 && Math.abs(fc[q * 3 + 1] - near[j + 1]) < 0.5 &&
          Math.abs(fc[q * 3 + 2] - near[j + 2]) < 0.5) return true;
    }
    return false;
  }

  /** Share, 0..1, of the frame that is rock for a camera `dist` out along
      `dir`: a COMPOSE.gridX x gridY grid of rays against the hull ellipsoids
      of the rocks `_compRocks` kept, after a sphere-against-frustum cull. The
      hulls hold every vertex, so this errs toward more rock, not less. */
  _rockShare(focus, dir, dist, fovDeg) {
    const sh = this._shot;
    sh.front = 0;
    sh.back = 0;
    this._compM = 0;
    const n = this._compN;
    if (!n) return 0;
    const tanV = Math.tan(fovDeg * DEG * 0.5);
    const tanH = tanV * Math.max(0.2, this.camera.aspect);
    _cam.copy(focus).addScaledVector(dir, dist);
    this._camBasis(dir, _right, _up);
    const near = this._near;
    const keep = this._compKeep;
    const ZK = this._compZ;
    const kh = 1 / Math.sqrt(1 + tanH * tanH);
    const kv = 1 / Math.sqrt(1 + tanV * tanV);
    let m = 0;
    for (let c = 0; c < n; c++) {
      const i = this._compI[c];
      const j = i * 4;
      const rx = near[j] - _cam.x;
      const ry = near[j + 1] - _cam.y;
      const rz = near[j + 2] - _cam.z;
      const r = near[j + 3];
      const z = -(rx * dir.x + ry * dir.y + rz * dir.z);
      if (z <= -r) continue;
      const x = rx * _right.x + ry * _right.y + rz * _right.z;
      const y = rx * _up.x + ry * _up.y + rz * _up.z;
      if ((Math.abs(x) - z * tanH) * kh > r) continue;
      if ((Math.abs(y) - z * tanV) * kv > r) continue;
      /* A rock this framing already fades outright draws nothing. */
      if (this._forcedN && this._isForced(i)) continue;
      /* Kept nearest first (by the depth the rock can start at), so a ray can
         stop as soon as no rock left could be nearer than the one it hit. */
      const z0 = z - r * 1.5;           // the hull ellipsoid may stand a little proud of r
      let q = m++;
      while (q > 0 && ZK[q - 1] > z0) { keep[q] = keep[q - 1]; ZK[q] = ZK[q - 1]; q--; }
      keep[q] = i;
      ZK[q] = z0;
    }
    this._compM = m;
    if (!m) return 0;
    const GX = COMPOSE.gridX;
    const GY = COMPOSE.gridY;
    const hit = _hullHit;
    const F = this._compHitF;
    const B = this._compHitB;
    F.fill(0, 0, m);
    B.fill(0, 0, m);
    let front = 0;
    let back = 0;
    for (let gy = 0; gy < GY; gy++) {
      const sy = (-1 + (2 * gy + 1) / GY) * tanV;
      for (let gx = 0; gx < GX; gx++) {
        const sx = (-1 + (2 * gx + 1) / GX) * tanH;
        _ray.set(
          -dir.x + _right.x * sx + _up.x * sy,
          -dir.y + _right.y * sx + _up.y * sy,
          -dir.z + _right.z * sx + _up.z * sy,
        );
        /* The ray's parameter is its depth along the view axis (its -dir
           component is 1), so the nearest entry against `dist` says whether
           the rock this pixel shows stands in front of the subject or behind. */
        let tMin = Infinity;
        let kMin = -1;
        for (let k = 0; k < m; k++) {
          if (ZK[k] >= tMin) break;
          if (!this._hullRay(keep[k], _cam, _ray, 0, hit) || hit[1] <= 0) continue;
          const t = Math.max(0, hit[0]);
          if (t < tMin) { tMin = t; kMin = k; }
        }
        if (kMin < 0) continue;
        if (tMin < dist) { front++; F[kMin]++; } else { back++; B[kMin]++; }
      }
    }
    const total = GX * GY;
    sh.front = front / total;
    sh.back = back / total;
    return (front + back) / total;
  }

  /** The rocks that could fill part of a frame taken from anywhere within
      `reach` of `focus`, biggest possible angular size first, at most
      COMPOSE.rocks of them, into `_compI`. */
  _compRocks(focus, reach) {
    this._harvestStatic();
    const near = this._near;
    const idx = this._compIdx;
    const key = this._compKey;
    idx.length = 0;
    key.length = 0;
    for (let i = 0, j = 0; i < this._nearN; i++, j += 4) {
      const r = near[j + 3];
      const dx = near[j] - focus.x;
      const dy = near[j + 1] - focus.y;
      const dz = near[j + 2] - focus.z;
      const dc = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const a = r / Math.max(dc - reach, r * 0.25, 1);
      if (a < COMPOSE.minAngle) continue;
      idx.push(i);
      key.push(a + 0.001 * r / Math.max(dc, 1));    // ties within reach: biggest from the subject
    }
    let n = idx.length;
    if (n > COMPOSE.rocks) {
      const order = idx.map((_, k) => k).sort((p, q) => key[q] - key[p]);
      for (let k = 0; k < COMPOSE.rocks; k++) this._compI[k] = idx[order[k]];
      n = COMPOSE.rocks;
    } else {
      for (let k = 0; k < n; k++) this._compI[k] = idx[k];
    }
    this._compN = n;
    return n;
  }

  /** World points on the subjects' hulls. A hull is sampled once per entity
      (finest LOD, `_samplePoints`), thinned and kept in the entity's own
      frame, then carried by its world matrix on every call. An entity with no
      walkable geometry stands in as six points on its bounding radius. */
  _subjectPts(list) {
    const out = this._subjPts;
    out.length = 0;
    let n = 0;
    for (let q = 0; q < list.length; q++) {
      const e = list[q];
      if (!e || e.alive === false) continue;
      if (++n > 24) break;
      const o = e.object3D;
      let loc = o ? this._localHull.get(e) : null;
      if (o && loc === undefined) {
        loc = null;
        const w = this._samplePoints(o);
        if (w) {
          _m1.copy(o.matrixWorld).invert();
          const cnt = w.length / 3;
          const stride = Math.max(1, Math.floor(cnt / COMPOSE.subjectSamples));
          const a = [];
          for (let i = 0; i < cnt; i += stride) {
            _p1.set(w[i * 3], w[i * 3 + 1], w[i * 3 + 2]).applyMatrix4(_m1);
            a.push(_p1.x, _p1.y, _p1.z);
          }
          loc = new Float32Array(a);
        }
        this._localHull.set(e, loc);
      }
      if (loc) {
        o.updateMatrixWorld();
        const mw = o.matrixWorld;
        for (let i = 0; i < loc.length; i += 3) {
          _p1.set(loc[i], loc[i + 1], loc[i + 2]).applyMatrix4(mw);
          out.push(_p1.x, _p1.y, _p1.z);
        }
      } else {
        const p = e.position || (o && o.position);
        if (!p) continue;
        const r = e.radius || (e.def && e.def.length ? e.def.length * 0.5 : 10);
        out.push(
          p.x + r, p.y, p.z, p.x - r, p.y, p.z,
          p.x, p.y + r * 0.5, p.z, p.x, p.y - r * 0.5, p.z,
          p.x, p.y, p.z + r, p.x, p.y, p.z - r,
        );
      }
    }
    return out.length >= 3 ? out : null;
  }

  /** Rocks standing between the lens at `cam` and the subject at `focus`:
      five rays, to the focus and to four points on the subject's radius,
      against the pull-in's shortlist. Each one found eases toward
      COMPOSE.occludedW in a fade slot the near guard has not taken, and eases
      back to solid once it is out of the way. Keyed by rock centre, which is
      what the shader matches, so a re-harvest cannot hand a fade to the
      wrong rock. */
  _occluders(cam, focus, dt) {
    const T = this._occT;
    const W = this._occW;
    const C = this._occC;
    for (let e = 0; e < ROCK_FADE_SLOTS; e++) T[e] = 1;
    /* The framing's own fallback fades first (R8 fix 3). */
    const fc = this._forced;
    for (let q = 0; q < this._forcedN; q++) {
      let e = -1;
      let free = -1;
      for (let s = 0; s < ROCK_FADE_SLOTS; s++) {
        if (Math.abs(C[s * 3] - fc[q * 3]) < 0.5 && Math.abs(C[s * 3 + 1] - fc[q * 3 + 1]) < 0.5 &&
            Math.abs(C[s * 3 + 2] - fc[q * 3 + 2]) < 0.5) { e = s; break; }
        if (free < 0 && W[s] >= 0.999 && T[s] === 1) free = s;
      }
      if (e < 0) {
        if (free < 0) continue;
        e = free;
        C[e * 3] = fc[q * 3]; C[e * 3 + 1] = fc[q * 3 + 1]; C[e * 3 + 2] = fc[q * 3 + 2];
        W[e] = 1;
      }
      T[e] = 0;
    }
    const n = this._candN;
    const R = this._focusRadius || 0;
    const near = this._near;
    const hit = _hullHit;
    let found = 0;
    _ocD.copy(focus).sub(cam);
    const len0 = _ocD.length();
    if (n && len0 > 1e-3) {
      _ocD.divideScalar(len0);
      this._camBasis(_ocD, _ocR, _ocU);
      const rays = R > 0 ? 5 : 1;
      for (let k = 0; k < rays && found < ROCK_FADE_SLOTS; k++) {
        const ox = k === 1 ? 0.6 : k === 2 ? -0.6 : 0;
        const oy = k === 3 ? 0.35 : k === 4 ? -0.35 : 0;
        _ocT.copy(focus).addScaledVector(_ocR, ox * R).addScaledVector(_ocU, oy * R).sub(cam);
        const len = _ocT.length();
        if (len < 1e-3) continue;
        _ocT.divideScalar(len);
        for (let c = 0; c < n && found < ROCK_FADE_SLOTS; c++) {
          const i = this._cand[c];
          if (!this._hullRay(i, cam, _ocT, 0, hit) || hit[1] <= 0 || hit[0] >= len - R * 0.25) continue;
          const j = i * 4;
          let e = -1;
          let free = -1;
          for (let q = 0; q < ROCK_FADE_SLOTS; q++) {
            if (Math.abs(C[q * 3] - near[j]) < 0.5 && Math.abs(C[q * 3 + 1] - near[j + 1]) < 0.5 &&
                Math.abs(C[q * 3 + 2] - near[j + 2]) < 0.5) { e = q; break; }
            if (free < 0 && W[q] >= 0.999 && T[q] === 1) free = q;
          }
          if (e >= 0 && T[e] !== 1) continue;      // already counted this frame
          if (e < 0) {
            if (free < 0) continue;
            e = free;
            C[e * 3] = near[j]; C[e * 3 + 1] = near[j + 1]; C[e * 3 + 2] = near[j + 2];
            W[e] = 1;
          }
          T[e] = COMPOSE.occludedW;
          this._occHold[e] = COMPOSE.occludedHold;
          found++;
        }
      }
    }
    const step = Math.max(0, dt) * COMPOSE.fadeRate;
    for (let e = 0; e < ROCK_FADE_SLOTS; e++) {
      /* A rock at the edge of the subject's rays flickers in and out of them
         as the ship moves; held out a moment, it fades once instead of
         hovering half-way (R8 fix 3). */
      if (T[e] === 1 && this._occHold[e] > 0) {
        this._occHold[e] -= Math.max(0, dt);
        if (W[e] < 0.999) T[e] = COMPOSE.occludedW;
      }
      const w = W[e];
      W[e] = w < T[e] ? Math.min(T[e], w + step) : Math.max(T[e], w - step);
      if (W[e] >= 0.999 && T[e] === 1) W[e] = 1;
    }
    this._occN = found;
  }

  /** Distance along `dir` at which the camera clears every nearby hull. */
  _sweepClearance(focus, dir, dist) {
    let out = dist;

    const ents = this._collidersFor(focus, dist);
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      const c = e.position || (e.object3D && e.object3D.position);
      if (!c) continue;
      out = this._pushPast(focus, dir, out, c.x, c.y, c.z, (e.radius || 0) * 1.18 + 3);
    }

    /* Rocks are not pushed past here any more. `_pullIn` has already brought
       the camera in short of every rock on the line, and pushing out past a
       landmark from there threw the camera through two kilometres of rock. */

    /* A push-out is a correction, never a teleport. If the arithmetic ever
       produces something absurd, the camera keeps the shot it had. */
    if (!Number.isFinite(out)) return dist;
    return Math.min(out, dist * 4 + 2000);
  }

  /** If `dist` along `dir` lands inside the sphere, return the exit distance. */
  _pushPast(focus, dir, dist, cx, cy, cz, R) {
    const mx = focus.x - cx;
    const my = focus.y - cy;
    const mz = focus.z - cz;
    const b = 2 * (dir.x * mx + dir.y * my + dir.z * mz);
    const cc = mx * mx + my * my + mz * mz - R * R;
    const disc = b * b - 4 * cc;
    if (disc <= 0) return dist;
    const s = Math.sqrt(disc);
    const t1 = (-b - s) * 0.5;
    const t2 = (-b + s) * 0.5;
    return dist > t1 && dist < t2 ? t2 : dist;
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
    this._static.length = 0;
    this._follow = null;
    this.camera.near = this._nearBase;
    this.camera.far = this._farBase;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }
}

export default CameraRig;
