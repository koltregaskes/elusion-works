# VOID SOVEREIGN — Architecture Contract

> **This file is the single source of truth for module boundaries.**
> Every sub-agent MUST read this before writing code, MUST only edit files it owns,
> and MUST NOT change any exported signature listed here without saying so in its report.

A Homeworld-lineage, universe-scale 3D space RTS running in the browser on Three.js.
Skirmish ("random") mode only. No mission/campaign layer.

---

## 0. Hard constraints

| Constraint | Rule |
|---|---|
| **Modules** | ES modules only. No bundler, no build step. Served as static files. |
| **Three.js** | Vendored at `vendor/three/`. Import via **relative paths only** — `import * as THREE from '../../vendor/three/build/three.module.js'`. There is **no importmap** (site CSP is `script-src 'self'`, which blocks inline importmaps). |
| **Assets** | **Zero binary art assets.** Every texture, normal map, mesh and sound must be generated procedurally at runtime (canvas 2D, data textures, GPU passes, or code-built `BufferGeometry`). This is a hard requirement. |
| **Target machine** | A **gaming laptop with a "380-class" discrete GPU, roughly 2–3 years old** (owner-reported; exact model to be confirmed). Treat as **RTX 3080/4080-Laptop class: ~12 GB VRAM, ~8 CPU cores, 1440p**. Budget to **1440p60**, and keep total VRAM for generated textures under **~2.5 GB** so there is headroom for the browser, the OS and the compositor. **This is what you design for.** The dev box for this repo is a mini-PC with an integrated Radeon 890M running at perhaps a third of target — **do not sacrifice visual quality to make the dev machine fast.** |
| **Optimisation order** | **Build the feature and the look first. Optimise last.** Correctness and visual quality now; profiling and cuts in a dedicated later pass on the target hardware. Do not pre-emptively lower texture sizes, particle counts, LOD distances or shader complexity to chase frames on the dev box. |
| **Perf budget** | 60 fps at 1440p on the target laptop with **1,000+ live units**. Instancing is mandatory for anything that appears more than ~20 times — that is an architectural rule, not an optimisation, so it still applies from day one. Likewise pooling, and disposing what you allocate. |
| **Roadmap** | Stage 1 (now): push the browser/WebGL 2 build as far as it will go. Stage 2 (later): a desktop executable once the browser is genuinely the limiting factor. Write nothing that assumes the browser is the final target forever, but do not build for Stage 2 yet. |
| **Units** | 1 world unit = 1 metre. Sim runs at a fixed 30 Hz; rendering interpolates. |
| **Determinism** | All procedural generation goes through a seeded RNG (`core/rng.js`). Never call bare `Math.random()` in generation code. |
| **No globals** | Except the debug hook `window.__VS` exposed by `main.js`. |

### Scale reference (drives camera, LOD, fog, bloom)

| Thing | Length |
|---|---|
| Interceptor | 14 m |
| Bomber | 20 m |
| Corvette | 34 m |
| Frigate | 130 m |
| Destroyer | 380 m |
| Carrier | 760 m |
| Mothership | 1,900 m |
| Battle radius | ~8 km |
| Playable volume | 60 km cube |
| Backdrop objects | 10^5 – 10^9 m, drawn on a separate far layer |

The renderer uses `logarithmicDepthBuffer: true`. Do not assume a linear depth
distribution in any custom shader that reads/writes depth.

---

## 1. Directory map & ownership

```
demos/void-sovereign/
  index.html              [CORE]   shell, canvas, HUD DOM skeleton
  DESIGN.md               [CORE]   design token doc (site convention)
  ARCHITECTURE.md         [CORE]   this file
  styles/hud.css          [UI]
  vendor/three/           [FROZEN] do not edit
  src/
    main.js               [CORE]   bootstrap + wiring
    core/
      engine.js           [CORE]   renderer, scene graph, layers, composer host
      loop.js             [CORE]   fixed-step scheduler
      events.js           [CORE]   event bus
      rng.js              [CORE]   seeded RNG + noise helpers
      pool.js             [CORE]   object pooling
      camera.js           [CAMERA] camera rig
      input.js            [CAMERA] mouse/keyboard/touch -> intents
    render/
      textures.js         [MAT]    procedural texture library
      materials.js        [MAT]    ship/structure material library
      postfx.js           [POSTFX] post-processing stack
      skybox.js           [ENV]    procedural deep-space cubemap
      environment.js      [ENV]    dust, asteroid fields, planets, god rays
    ships/
      catalog.js          [CORE]   ship class stat/geometry table (shared)
      index.js            [SHIPS]  buildShipModel() registry
      hulls.js            [SHIPS]  per-class hull construction
      greeble.js          [SHIPS]  panel/detail generators
    fx/
      index.js            [FX]     FXSystem facade
      engines.js          [FX]     thruster plumes + trails
      weapons.js          [FX]     beams, tracers, muzzle flashes
      explosions.js       [FX]     death blooms, shockwaves
      shields.js          [FX]     impact shields
      debris.js           [FX]     wreckage + sparks
    sim/
      world.js            [SIM]    entity store, spatial hash, tick
      movement.js         [SIM]    steering, flocking, formations
      combat.js           [SIM]    targeting, damage, weapon cooldowns
      ai.js               [SIM]    enemy commander
      economy.js          [SIM]    resourcing, production queue
      spawn.js            [SIM]    skirmish setup
    ui/
      hud.js              [UI]     HUD facade, wires DOM <-> events
      select.js           [UI]     selection band, unit chips
      build.js            [UI]     production menu
      sensors.js          [UI]     tactical/sensors-manager view
```

**A sub-agent may only create or edit files tagged with its own role.**
If you need a change in a file you do not own, put it in your report — do not edit it.

---

## 2. Core APIs (frozen — build against these)

### `core/rng.js`
```js
export function makeRng(seed: number): {
  next(): number;              // [0,1)
  range(a, b): number;
  int(a, b): number;           // inclusive
  pick(array): any;
  chance(p): boolean;
  gaussian(mean?, sd?): number;
  unitVector(): {x,y,z};
  fork(salt: number): Rng;     // independent stream
}
export function hash3(x, y, z): number;      // deterministic [0,1)
export function fbm2(x, y, octaves?, lacunarity?, gain?): number;   // [-1,1]
export function fbm3(x, y, z, octaves?, lacunarity?, gain?): number;
```

### `core/events.js`
```js
export const bus: {
  on(type, fn): () => void;    // returns unsubscribe
  once(type, fn): () => void;
  off(type, fn): void;
  emit(type, payload?): void;
}
```
**Event names** (canonical — do not invent variants):

| Event | Payload | Emitter → Listener |
|---|---|---|
| `sim:tick` | `{ tick, dt }` | SIM → all |
| `sim:spawn` | `{ entity }` | SIM → FX, UI |
| `sim:death` | `{ entity, killer }` | SIM → FX, UI |
| `sim:damage` | `{ entity, amount, point:Vector3, normal:Vector3, shield:boolean }` | SIM → FX |
| `sim:fire` | `{ shooter, target, weapon, from:Vector3, to:Vector3 }` | SIM → FX |
| `sim:resourceChanged` | `{ team, credits, delta }` | SIM → UI |
| `sim:buildComplete` | `{ team, classId, entity }` | SIM → UI |
| `sim:gameOver` | `{ winner }` | SIM → UI |
| `sel:changed` | `{ ids: number[] }` | CAMERA/UI → all |
| `cmd:move` | `{ ids, point:Vector3, formation? }` | CAMERA/UI → SIM |
| `cmd:attack` | `{ ids, targetId }` | CAMERA/UI → SIM |
| `cmd:stance` | `{ ids, stance }` | UI → SIM |
| `cmd:formation` | `{ ids, formation }` | UI → SIM |
| `cmd:build` | `{ team, classId }` | UI → SIM |
| `cmd:cancelBuild` | `{ team, index }` | UI → SIM |
| `ui:focus` | `{ point:Vector3, distance? }` | UI → CAMERA |
| `ui:sensorsToggle` | `{ open:boolean }` | UI ↔ CAMERA |
| `ui:speed` | `{ scale }` | UI → LOOP |
| `ui:toast` | `{ text, kind }` | any → UI |

### `core/engine.js`
```js
export class Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;         // near/gameplay content
  farScene: THREE.Scene;      // backdrop, rendered first, depth-cleared
  camera: THREE.PerspectiveCamera;
  clock, size:{w,h,dpr};
  quality: 'low'|'medium'|'high'|'ultra';
  registerRenderHook(fn: (dt, elapsed) => void): void;  // called pre-render
  setPostProcess(pp: PostFX|null): void;
  render(dt, elapsed): void;
  resize(): void;
}
export const LAYER = { DEFAULT:0, BACKDROP:1, GLOW:2, HUD3D:3, SENSORS:4 };
```

### `core/loop.js`
```js
export class Loop {
  constructor({ engine, world, hz = 30 });
  start(); stop();
  setTimeScale(s: number);    // 0 = paused
  alpha: number;              // render interpolation factor 0..1
}
```

### `core/pool.js`
```js
export class Pool { constructor(factory, reset, initial=0); acquire(); release(o); get size(); }
```

### `ships/catalog.js` (CORE-owned, read by SHIPS + SIM + UI)
```js
export const TEAM = { PLAYER: 0, ENEMY: 1 };
export const ROLE = { FIGHTER, CORVETTE, FRIGATE, CAPITAL, SUPPORT, RESOURCE, STRUCTURE };
export const SHIPS = {
  [classId]: {
    id, name, role, length,        // metres, drives model scale
    hull, armour, shield,          // hp
    speed, accel, turnRate, rollRate,
    cost, buildTime, popCost,
    sensorRange, squadSize,        // squadSize>1 => built as a wing
    weapons: [ { id, type:'kinetic'|'beam'|'missile'|'flak'|'ion', damage,
                 rate, range, spread, projectileSpeed, arcDeg, hardpoints:number,
                 preferredTargets:ROLE[] } ],
    buildableBy: classId[],        // producers
    silhouette: 'string',          // SVG path data for HUD icon, 0 0 24 24 viewBox
    modelSeed: number,             // stable seed for procedural hull
    palette: 'lancer'|'bulwark'|'monolith'  // hull design family
  }
}
export function shipsBuildableBy(classId): entry[];
export function totalFleetValue(entities): number;
```

### `render/materials.js` [MAT]
```js
export function initMaterials(renderer, opts): void;      // build texture atlases once
export function getHullMaterial(team:number, family:string, opts?): THREE.Material;
export function getInstancedHullMaterial(team, family, opts?): THREE.Material;
export function getEngineMaterial(team): THREE.Material;
export function getGlassMaterial(team): THREE.Material;
export function updateMaterials(elapsed: number): void;   // animate time uniforms
export const TEAM_COLORS: [{ primary, secondary, engine, trim, light }, ...]
```
Team colours are `THREE.Color`. Player = cold cyan/white; Enemy = amber/crimson.
Hull materials must accept per-instance colour via `instanceColor` when instanced.

### `render/textures.js` [MAT]
```js
export function initTextureLibrary(renderer, rng): void;
export function getHullAtlas(): { map, normalMap, roughnessMap, metalnessMap, emissiveMap, aoMap };
export function getNoiseTexture(kind:'blue'|'value'|'curl'|'fbm', size?): THREE.Texture;
export function getSpriteTexture(kind:'flare'|'smoke'|'spark'|'ring'|'beamcap'|'plume'): THREE.Texture;
export function getDecalTexture(kind): THREE.Texture;
export function disposeTextures(): void;
```

### `ships/index.js` [SHIPS]
```js
// Returns a fully-built, origin-centred, +Z-forward, Y-up model.
export function buildShipModel(classId: string, team: number, rng): {
  group: THREE.Group;               // LOD-wrapped
  radius: number;                   // bounding sphere
  hardpoints: THREE.Vector3[];      // local-space weapon muzzles
  engines: { pos: THREE.Vector3, dir: THREE.Vector3, radius: number }[];
  lights:  { pos: THREE.Vector3, colour: THREE.Color, period: number }[];
  dockPoints?: THREE.Vector3[];
}
export function buildInstancedBatch(classId, team, count, rng): {
  mesh: THREE.InstancedMesh | THREE.Group, setMatrixAt(i, m), setColorAt(i, c), commit()
}
export function warmShipCache(rng): void;   // pre-build all classes
```
Models must be **+Z forward, +Y up**, centred on the origin, and scaled so
bounding-box length == `SHIPS[classId].length`.

### Fleet rendering must be instanced — the batch contract [SHIPS + SIM]

Measured at iteration 2: **≈2.9 draw calls per unit**, a clean straight line
from 32 to 470 entities (93 → 1,356 calls). Extrapolated to the 1,000+ units
§0 requires, that is ~2,900 calls per frame. No WebGL 2 context holds that at
60 fps on any GPU — it is a CPU-side submission limit, so the target laptop
does not rescue it. This is the architectural instancing rule in §0, not a
Phase 4 optimisation, and the retrofit cost grows with every system that
assumes one `Object3D` per entity.

`ships/index.js` already exports `buildInstancedBatch()` and it has **zero
callers**. Make it real, and consume it.

**Division of work:**

- **[SHIPS]** owns the batch. Per `(classId, team)`, back each LOD level with a
  `THREE.InstancedMesh`. Expose:
  ```js
  export function getFleetBatch(classId, team): {
    reserve(): number;                 // returns an instance slot index
    release(slot: number): void;
    setMatrix(slot, matrix4): void;
    setLod(slot, level: number): void; // moves the instance between LOD meshes
    setColor(slot, color): void;
    setDamage(slot, value01): void;
    commit(): void;                    // flush dirty instance buffers, once per frame
    meshes: THREE.InstancedMesh[];     // added to engine.scene by the batch itself
  }
  export function commitAllBatches(): void;
  ```
  Slots must survive LOD changes. Capacity grows geometrically; never
  reallocate per frame.

- **[SIM]** consumes it. In `world.spawn()`, reserve a slot instead of adding a
  per-entity `Object3D` to the scene for any class that batches. Keep
  `entity.object3D` as a **detached** transform carrier so FX, HUD and camera
  keep working unchanged — just do not add it to `engine.scene`. In
  `syncTransforms(alpha)`, write the interpolated matrix into the slot, pick the
  LOD from camera distance, then call `commitAllBatches()` once.

- **Exempt from batching:** unique hulls that appear once or twice per side —
  `mothership`, `carrier`, `cruiser`. Keep those as ordinary `Object3D`s so
  they can carry per-ship damage state and bespoke detail. Everything else
  batches.

**Target: draw calls must be roughly flat in unit count.** 1,000 units should
cost tens of calls for the fleet, not thousands. Report measured calls at 100 /
500 / 1,000 entities.

### `fx/index.js` [FX]
```js
export class FXSystem {
  constructor({ engine, materials, textures });
  attachEngines(entity, engineDefs): void;
  detachEntity(entity): void;
  update(dt, elapsed, camera): void;
  // all other triggering happens by subscribing to the sim:* events above
  dispose(): void;
}
```

### `sim/world.js` [SIM]
```js
export class World {
  entities: Map<number, Entity>;
  teams: [TeamState, TeamState];
  constructor({ seed, engine, fx, options });
  tick(dt): void;                    // fixed 1/30
  spawn(classId, team, position, rotation?): Entity;
  destroy(id): void;
  query(sphere|box): Entity[];       // spatial hash
  raycastEntities(ray, teamFilter?): Entity|null;
  selectionAt(screenRect, camera, team): number[];
  syncTransforms(alpha: number): void;   // called by Loop each render frame
  dispose(): void;
}
```
`Entity` shape (frozen — FX/UI/CAMERA read these):
```js
{
  id, classId, team, role, def,          // def === SHIPS[classId]
  object3D,                              // THREE.Object3D in engine.scene
  position, velocity, quaternion,        // THREE.Vector3/Quaternion (sim truth)
  prevPosition, prevQuaternion,          // for render interpolation
  hull, maxHull, shield, maxShield,
  targetId, orderQueue, stance, formationSlot,
  alive, radius, throttle,               // throttle 0..1 drives engine FX
}
```

### `ui/hud.js` [UI]
```js
export class HUD { constructor({ engine, world, camera, container }); update(dt); dispose(); }
```

### `core/camera.js` [CAMERA]
```js
export class CameraRig {
  constructor({ engine, domElement });
  focusOn(point: THREE.Vector3, distance?: number, instant?: boolean): void;
  frameEntities(entities): void;
  setSensorsMode(open: boolean): void;
  update(dt): void;
  screenToWorldPlane(ndc, planeY): THREE.Vector3;
  get distance(): number;      // used for LOD + HUD scaling
}
```

### `render/postfx.js` [POSTFX]
```js
export class PostFX {
  constructor(engine);
  setQuality(q): void;
  resize(w, h): void;
  render(dt, elapsed): void;    // must render BOTH farScene and scene
  dispose(): void;
}
```

### `render/skybox.js` + `render/environment.js` [ENV]
```js
// skybox.js
export function buildSkybox(renderer, rng, opts): { texture: THREE.CubeTexture, dispose() };
// environment.js
export class Environment {
  constructor({ engine, rng, textures, seed });
  update(dt, elapsed, camera): void;
  get lights(): THREE.Light[];
  dispose(): void;
}
```

---

## 3. Visual direction (non-negotiable)

Homeworld's look, modernised. Every agent is judged against this.

1. **Silhouette first.** Ships read as distinct black shapes against the nebula
   before any detail resolves. Long, flat, asymmetric, purposeful.
2. **One key light.** A single strong directional star with a cold rim/fill
   bounce from the nebula. Hard terminator, deep shadow side — never flat.
3. **Colour discipline.** Desaturated hull greys/bone/rust; colour comes from
   the nebula, engines, and team trim. Never rainbow.
4. **Scale cues.** Panel lines, running lights, and hull greebles must shrink
   with ship size so a carrier reads as 50× a fighter. Atmospheric depth haze
   over kilometres. Fighters must look *tiny* next to capitals.
5. **Emptiness is the subject.** Vast negative space, a huge backdrop object,
   volumetric dust catching the light.
6. **Restraint in bloom.** Engines and beams bloom; hulls do not.
7. **Motion is heavy.** Capitals bank slowly with visible inertia; fighters
   snap. Nothing turns on a dime except interceptors.
8. **UI is a thin vector overlay** — hairlines, mono type, no chrome, no gloss.
   It sits *on* the void, never boxes it in.

## 4. Quality bar

Screenshots get compared blind against real Homeworld: Deserts of Kharak /
Homeworld 3 marketing stills. If a reviewer can pick ours out as "the browser
one", it is not done.

## 5. Conventions

- British English in all user-facing copy.
- 2-space indent, semicolons, single quotes.
- `const`/`let` only. No `var`.
- Dispose every geometry, material and texture you create in a `dispose()`.
- No `console.log` in shipped paths — use `bus.emit('ui:toast', …)` or nothing.
- Comment the *why*, not the *what*. Match existing density.
