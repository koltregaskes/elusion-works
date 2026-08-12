import * as THREE from '../../vendor/three/build/three.module.js';
import { LAYER } from '../core/engine.js';
import { bus } from '../core/events.js';
import { makeRng, fbm2, fbm3, ridged3 } from '../core/rng.js';
import { buildSkybox } from './skybox.js';
import { setNebulaBounce, TEAM_COLORS } from './materials.js';
import { CONTROL } from '../sim/economy.js';
import {
  DEFAULT_SETUP,
  OPENING_ANGLE,
  OPENING_SHELL,
  SEAM_ANGLE,
  SHELL_GAP,
  clearOfStarts,
  clearOpening,
  generateResourceClusters,
  homePosition,
  markContested,
} from '../sim/spawn.js';

/* Everything that is not a ship.

   Two scenes are populated. `engine.farScene` gets the backdrop — the baked
   nebula cubemap, the key star's disc, a gas giant and its moon — all of it at
   10^7..10^9 metres, drawn by a camera that only ever rotates. `engine.scene`
   gets the near field: the lights, drifting dust sheets, asteroid fields and
   the depth haze that makes kilometres read as kilometres.

   The backdrop is the game's identity. It is also, deliberately, mostly empty:
   the nebula occupies one part of the sky, the star another, the planet a
   third, and the rest is black. Emptiness is the subject. */

/* `clusters` is a *rock* budget, not a field-layout decision.

   The seam layout is SIM's — `sim/spawn.js: generateResourceClusters` — and it
   is the same on every quality setting, because how many seams there are and
   how much ore is in them is balance, and a player who turns the detail down
   must not get a different game. What quality buys here is how densely each
   seam is populated: `_buildAsteroids` divides this budget by the number of
   seams SIM asked for, so `clusters * rocksPerCluster` rocks are attempted per
   tier however the field is laid out. Measured placed counts on seed 1337 are
   276 / 716 / 1347 / 2135 against attempts of 276 / 720 / 1404 / 2280 — the
   shortfall is the opening-shell and overlap rejections below, which have
   always dropped a handful. */
const QUALITY = {
  low: { clusters: 6, rocksPerCluster: 45, dust: 70, derelicts: 0, landmarks: 2, rockDetail: [1, 0] },
  medium: { clusters: 8, rocksPerCluster: 90, dust: 140, derelicts: 10, landmarks: 4, rockDetail: [2, 1] },
  /* The low LOD was an 80-face icosahedron, which is a faceted blob rather
     than a small rock — and since the high and low sets are on screen at the
     same time, the two read as different materials. 320 faces costs almost
     nothing instanced and keeps the field looking like one field. */
  high: { clusters: 10, rocksPerCluster: 140, dust: 230, derelicts: 14, landmarks: 6, rockDetail: [3, 2] },
  ultra: { clusters: 12, rocksPerCluster: 190, dust: 320, derelicts: 18, landmarks: 6, rockDetail: [4, 2] },
};

/* Gas-giant schemes. Restrained — bands are close in hue and separated by
   value, not by colour, which is what stops a procedural planet looking like a
   beach ball. */
const PLANET_SCHEMES = [
  {
    name: 'amber',
    a: [0.150, 0.082, 0.044],
    b: [0.560, 0.462, 0.340],
    c: [0.760, 0.690, 0.560],
    storm: [0.520, 0.205, 0.130],
    atmo: [0.42, 0.52, 0.86],
    warm: true,
  },
  {
    name: 'ice',
    a: [0.108, 0.150, 0.205],
    b: [0.400, 0.510, 0.610],
    c: [0.640, 0.720, 0.790],
    storm: [0.240, 0.400, 0.540],
    atmo: [0.40, 0.62, 0.98],
    warm: false,
  },
  {
    name: 'jade',
    a: [0.088, 0.128, 0.108],
    b: [0.320, 0.420, 0.360],
    c: [0.540, 0.590, 0.500],
    storm: [0.180, 0.330, 0.280],
    atmo: [0.40, 0.72, 0.72],
    warm: false,
  },
  {
    name: 'ash',
    a: [0.090, 0.090, 0.098],
    b: [0.300, 0.295, 0.288],
    c: [0.520, 0.505, 0.472],
    storm: [0.400, 0.255, 0.180],
    atmo: [0.52, 0.56, 0.70],
    warm: true,
  },
  {
    name: 'rust',
    a: [0.135, 0.062, 0.038],
    b: [0.470, 0.300, 0.205],
    c: [0.680, 0.540, 0.400],
    storm: [0.620, 0.290, 0.150],
    atmo: [0.62, 0.48, 0.72],
    warm: true,
  },
];

/* Opening-frame clearance.

   The single most important image in the demo (§3.9/P1) is also the one a
   scalar keep-out radius cannot protect: two kilometres of clearance is
   generous for a 300 m boulder and meaningless for a 3 km landmark, which at
   the same range still fills half the view. The rule has to be angular.

   That rule is SIM's — `sim/spawn.js` exports it, the same way it already
   exports `homePosition`, and both sides now test against the one definition
   rather than each keeping a private copy that can drift. ENV's job is to pass
   the radius of the thing that *actually blocks the view*: for an ore seam
   that is one rock, not the whole swarm, because a seam is porous and you fly
   through it, which is why `SEAM_ANGLE` is deliberately looser than
   `OPENING_ANGLE`. */

/* The opening-shell correction (`clearOpening`, `OPENING_SHELL`, `SHELL_GAP`)
   used to live here, because ENV placed the seams and had to apply it. SIM
   places them now, so the rule moved to `sim/spawn.js` with the rest of the
   clearance contract and ENV imports it for the landmarks and derelicts it
   still positions itself. */

/* --------------------------------------------------------------------------- */

const _invQ = new THREE.Quaternion();

const num = (v) => {
  if (!Number.isFinite(v)) return '0.0';
  const s = v.toFixed(6);
  return s.indexOf('.') >= 0 ? s : s + '.0';
};
const f3 = (c) => `${num(c[0])}, ${num(c[1])}, ${num(c[2])}`;
const col3 = (c) => `${num(c.r)}, ${num(c.g)}, ${num(c.b)}`;

/* Shared noise for the planet and rock shaders. Trimmed relative to the sky's:
   these are shaded every frame, so the octave counts are lower. */
const NOISE_GLSL = /* glsl */ `
vec3 hash33e(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}
float gnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dot(hash33e(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0)),
            dot(hash33e(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0)), u.x),
        mix(dot(hash33e(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0)),
            dot(hash33e(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(dot(hash33e(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0)),
            dot(hash33e(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0)), u.x),
        mix(dot(hash33e(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0)),
            dot(hash33e(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z) * 1.35;
}
const mat3 ME3 = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
float fbm3e(vec3 p) {
  float f = 0.5 * gnoise(p);
  p = ME3 * p * 2.02;
  f += 0.25 * gnoise(p);
  p = ME3 * p * 2.03;
  f += 0.125 * gnoise(p);
  return f / 0.875;
}
float fbm4e(vec3 p) {
  float f = 0.5 * gnoise(p);
  p = ME3 * p * 2.02;
  f += 0.25 * gnoise(p);
  p = ME3 * p * 2.03;
  f += 0.125 * gnoise(p);
  p = ME3 * p * 2.01;
  f += 0.0625 * gnoise(p);
  return f / 0.9375;
}
float ridge2e(vec3 p) {
  float n = 1.0 - abs(gnoise(p));
  float f = 0.5 * n * n;
  p = ME3 * p * 2.05;
  n = 1.0 - abs(gnoise(p));
  f += 0.25 * n * n;
  return f / 0.75;
}
`;

/* =========================================================================== */

export class Environment {
  /**
   * @param {object} args
   * @param {import('../core/engine.js').Engine} args.engine
   * @param {object|number} [args.rng]     seeded rng (or a raw seed)
   * @param {object} [args.textures]       optional [MAT] texture library
   * @param {number} [args.seed]
   * @param {object} [args.options]        { skySize, quality, dustIntensity, ... }
   */
  constructor({ engine, rng, textures, seed, options } = {}) {
    this.engine = engine;
    this.textures = textures || null;
    this.seed = seed !== undefined ? seed : rng && rng.seed !== undefined ? rng.seed : 1;
    this.rng = typeof rng === 'number' ? makeRng(rng) : rng || makeRng(this.seed);
    this.options = options || {};
    this.quality = this.options.quality || engine.quality || 'high';
    this.budget = QUALITY[this.quality] || QUALITY.high;

    this._disposables = [];
    this._lights = [];
    this._clusters = [];
    this._rockSets = [];
    this._landmarks = [];
    this._seams = null;
    this._seamList = [];
    this._aimed = false;
    this._time = 0;
    this._lodTimer = 0;
    this._lodKey = '';

    this._tmpV = new THREE.Vector3();

    const r = this.rng;

    /* --- geometry of the system: where the star, the planet and the nebula
       sit relative to one another. Chosen before anything is built so the
       lighting, the visible star and the planet's terminator all agree. ---

       The AZIMUTH is free and fully seeded, and it must stay that way: the
       camera rig aims its opening shot off this vector (`OPENING.sunAngleMin`
       /`Max` in `core/camera.js`, a 104-134 degree band between the view
       direction and the direction to the star) so that the relative angle is
       fixed however the star moves. If ENV also aimed the star at the camera
       the loop would close, the seed would stop mattering, and every match
       would open on the same frame. So ENV owns the star and only the star.

       The ELEVATION is not free. It ran +/-65 degrees, and a key 38 degrees
       *below* the battle plane against a camera whose pitch is clamped to
       -3..+26 lights the underside of every hull and leaves the decks — the
       surfaces actually facing the lens — in shadow. That is uplighting, and
       it is one of the two reasons hull luminance was a lottery. A key wants
       to be above its subject, and higher rather than lower: measured over the
       hero silhouette, moving the band from a mean of 23 degrees to 32 raised
       the median on the two worst seeds by 10-15% at no cost to the shadow
       floor, because the surface a camera pitched up at 15-26 degrees actually
       sees most of is the top deck. The band below keeps a little variety —
       a low, raking, near-horizon star is a good look — without ever going
       under the subject far enough to invert the read. */
    const sunAz = r.range(-Math.PI, Math.PI);
    const sunElev = Math.max(0.05, Math.min(0.92, r.gaussian(0.55, 0.18)));
    const ce = Math.cos(sunElev);
    const sunFrom = new THREE.Vector3(Math.sin(sunAz) * ce, Math.sin(sunElev), Math.cos(sunAz) * ce)
      .normalize();
    this.sunDirection = sunFrom.clone(); // from the battle *toward* the star

    this._buildSky();
    this._buildLights();
    this._buildStar();
    this._buildPlanet();
    this._buildDust();
    this._buildAsteroids();
    this._buildSeams();
    this._buildDerelicts();

    /* Compose the backdrop once the camera has framed its opening shot.

       Everything in `farScene` is placed before the world, the fleet or the
       camera exist — ENV is built at 60% of the load bar and the hero framing
       is solved at 84% — so at construction there is no view direction to
       compose against, and the result was measurable: over six seeds the gas
       giant sat 38 to 150 degrees off where the camera ended up looking and
       appeared in none of six gameplay frames.

       `ui:ready` is the first moment the answer exists. It is emitted at the
       end of the build, synchronously, after `frameOpeningShot`, and it is
       emitted again on a restart — which is what this wants, since a restart
       re-solves the framing. */
    this._offReady = bus.on('ui:ready', () => {
      try {
        this.aimBackdrop(this.engine.camera);
      } catch (err) {
        /* A backdrop in the wrong place is a worse frame, not a broken one. */
      }
    });
  }

  /* ------------------------------------------------------------------ sky */

  _buildSky() {
    const { engine } = this;
    this.sky = buildSkybox(engine.renderer, this.rng.fork(0x5117), {
      quality: this.quality,
      size: this.options.skySize,
      tiles: this.options.skyTiles,
      layers: this.options.skyLayers,
      // The gas has to know where the star is or it has no lit side.
      sunDirection: this.sunDirection,
    });

    engine.farScene.background = this.sky.texture;
    engine.farScene.backgroundIntensity = 1.0;

    /* Resolvable stars are geometry now, not texels — see `skybox.js`. They go
       in the backdrop scene at 2.2e9 m, behind the planet and the star quad but
       inside `farCamera`'s far plane, and they test depth without writing it so
       a backdrop body in front of one occludes it. */
    if (this.sky.starField) {
      this.sky.starField.layers.enable(LAYER.BACKDROP);
      engine.farScene.add(this.sky.starField);
    }

    /* The sky is also the environment probe. Hulls pick up a nebula-coloured
       bounce on their shadow side for free, which is exactly the "cold fill
       from the nebula" the visual direction asks for.

       Kept deliberately low. An IBL from a sky this saturated is an
       omnidirectional light, and omnidirectional light is precisely what
       destroys a terminator. The nebula's job is to tint the shadow side, not
       to fill it in.

       "Low" is not the same as "off", though, and the balance had drifted too
       far the other way: measured over the true painted silhouette of the hero
       mothership across seven seeds, the shadow side floored at 0.025-0.041 of
       sRGB. That is a hull disappearing into the void rather than turning away
       from the light, and on the four darkest seeds it took the *median* down
       with it. The floor wanted is 0.06-0.09 — read as black at a glance, but
       with the form still legible in it. */
    engine.scene.environment = this.sky.texture;
    engine.scene.environmentIntensity =
      this.options.environmentIntensity !== undefined ? this.options.environmentIntensity : 0.25;

    /* Depth haze. Deliberately a very dark, nebula-tinted colour: fog that
       tends toward grey turns the void into soup, fog that tends toward a dark
       tint just bleeds contrast out of things that are kilometres away.

       It is also pinned to the measured brightness of the sky behind it. The
       fill and nebula colours handed back by the bake are *hue* references —
       normalised so their brightest channel is 1 — so using them directly gave
       a haze three to six times brighter than the sky it is meant to be
       hiding things in. The visible result was that a rock twenty kilometres
       out washed to a pale pink and a rock five kilometres out stayed
       charcoal: the same material reading as two different ones in a single
       frame, which is worse than having no haze at all. */
    const fogColour = this.sky.fillColour.clone().lerp(this.sky.nebulaColour, 0.3);
    const fogLum = 0.2126 * fogColour.r + 0.7152 * fogColour.g + 0.0722 * fogColour.b;
    const skyLum = Math.max(1e-4, this.sky.averageLuminance);
    fogColour.multiplyScalar(Math.min(0.09, (skyLum * 0.85) / Math.max(1e-4, fogLum)));
    const density = this.options.fogDensity !== undefined ? this.options.fogDensity : 5.6e-5;
    this.fog = new THREE.FogExp2(fogColour, density);
    engine.scene.fog = this.fog;
  }

  /* ---------------------------------------------------------------- lights */

  _buildLights() {
    const { engine, sky } = this;
    const r = this.rng;

    /* One hard key star and a nebula-tinted fill (§3.2).

       The ratio is the whole game here. An earlier balance ran the key at 3.15
       against roughly 1.0 of combined fill, rim, ambient and IBL — a little
       over 3:1 — and at 3:1 there is no terminator on anything. Every hull
       came out evenly lit, which is exactly the flat CG look the visual
       direction exists to prevent. This runs closer to 12:1 of key against
       everything else, so the lit side is bright, the shadow side falls to a
       dark nebula-coloured bounce, and the edge between them is a hard line.

       The fill is tinted and *dim* rather than neutral and strong. A saturated
       fill at low intensity leaves a grey hull grey while still telling you
       what colour the sky behind it is; a bright one repaints the fleet.

       The numbers below are the second half of the opening-luminance fix. The
       key is up a little and the bounce is up rather more, which raises the
       shadow floor toward 0.06-0.09 sRGB and — because the seeds that were
       dark were dark in their *shadow* — compresses the spread across seeds
       without touching the terminator, whose ratio is set by key-over-fill and
       is roughly preserved (5.2 against ~1.15 of everything else, near enough
       4.5:1 in linear light, which is 2.0-2.5 stops of encoded separation). */
    const keyColour = sky.keyColour.clone();
    const key = new THREE.DirectionalLight(keyColour, this.options.keyIntensity || 5.2);
    key.position.copy(this.sunDirection).multiplyScalar(50000);
    key.target.position.set(0, 0, 0);
    key.castShadow = false; // a 60 km ortho frustum buys nothing but texels
    key.name = 'env:key';
    engine.scene.add(key);
    engine.scene.add(key.target);
    this.keyLight = key;

    /* Hemisphere fill tinted top-and-bottom by the two ends of the sky: bright
       nebula overhead, deep gas below. This is what stops the shadow side of a
       hull reading as a hole punched in the frame — and no more than that. */
    const hemi = new THREE.HemisphereLight(
      sky.nebulaColour.clone(),
      sky.fillColour.clone().multiplyScalar(0.45),
      this.options.fillIntensity || 0.42,
    );
    hemi.position.set(0, 1, 0);
    hemi.name = 'env:fill';
    engine.scene.add(hemi);
    this.fillLight = hemi;

    /* A cold rim from roughly the opposite side. One key light, one bounce —
       never a second key, so this stays well under a tenth of the key. */
    const rimDir = this.sunDirection
      .clone()
      .negate()
      .add(new THREE.Vector3(r.gaussian(0, 0.4), r.gaussian(0, 0.3), r.gaussian(0, 0.4)))
      .normalize();
    const rim = new THREE.DirectionalLight(
      sky.nebulaColour.clone(),
      this.options.rimIntensity || 0.30,
    );
    rim.position.copy(rimDir).multiplyScalar(50000);
    rim.name = 'env:rim';
    engine.scene.add(rim);
    engine.scene.add(rim.target);
    this.rimLight = rim;

    const amb = new THREE.AmbientLight(sky.ambientColour.clone(), 0.075);
    amb.name = 'env:ambient';
    engine.scene.add(amb);
    this.ambientLight = amb;

    this._lights = [key, hemi, rim, amb];

    /* Hand the same sky to the hull shader. Without this the whole fleet is
       lit by whatever bounce colour [MAT] shipped as a placeholder, no matter
       what the nebula behind it is doing. */
    try {
      setNebulaBounce(
        sky.bounceKey || sky.nebulaColour,
        sky.bounceFill || sky.fillColour,
        this.options.hullAmbient !== undefined ? this.options.hullAmbient : 0.20,
        this.options.hullRim !== undefined ? this.options.hullRim : 0.52,
      );
    } catch (err) {
      /* [MAT] may not have initialised; its own defaults are perfectly usable. */
    }
  }

  get lights() {
    return this._lights;
  }

  /* ------------------------------------------------------------ key star */

  _buildStar() {
    const { engine, sky } = this;
    const r = this.rng;

    const dist = 4.2e8;
    // ~0.55 degrees across, near enough our own sun from 1 AU.
    const coreAngle = r.range(0.0042, 0.0062);
    const half = dist * 0.075; // quad half-width in metres => ~8.6 deg of sky
    const coreR = (coreAngle * dist) / half;

    const tint = sky.keyColour.clone().lerp(new THREE.Color(1, 1, 1), 0.35);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColour: { value: tint },
        uCoreR: { value: coreR },
        uGlowR: { value: r.range(0.030, 0.055) },
        uSpike: { value: r.range(0.55, 0.9) },
        uAngle: { value: r.range(0, Math.PI) },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec2 vQ;
        void main() {
          vQ = uv * 2.0 - 1.0;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uColour;
        uniform float uCoreR;
        uniform float uGlowR;
        uniform float uSpike;
        uniform float uAngle;
        varying vec2 vQ;
        void main() {
          #include <logdepthbuf_fragment>
          float rr = length(vQ);
          /* Photosphere: a hard-edged disc, blown far past white so the post
             stack's bloom has something real to work with. */
          float core = smoothstep(uCoreR * 1.6, uCoreR * 0.55, rr);
          float inner = exp(-rr / (uGlowR * 0.28)) * 0.9;
          float glow = exp(-rr / uGlowR) * 0.34;
          float halo = exp(-rr / (uGlowR * 5.0)) * 0.055;
          float ca = cos(uAngle);
          float sa = sin(uAngle);
          vec2 q = vec2(vQ.x * ca - vQ.y * sa, vQ.x * sa + vQ.y * ca);
          /* A symmetric four-point flare. The arms used to differ in both
             length and weight, which reads as an anamorphic lens — and nothing
             else in the game, in the post stack or in the HUD supports one.
             The sky's own bright stars use the same symmetric cross. */
          float streak = exp(-abs(q.y) / 0.010) * exp(-abs(q.x) / 0.36) * 0.13
                       + exp(-abs(q.x) / 0.010) * exp(-abs(q.y) / 0.36) * 0.13;
          float a = core * 46.0 + inner + glow + halo + streak * uSpike;
          gl_FragColor = vec4(uColour * a, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const geo = new THREE.PlaneGeometry(half * 2, half * 2);
    const quad = new THREE.Mesh(geo, mat);
    quad.position.copy(this.sunDirection).multiplyScalar(dist);
    quad.lookAt(0, 0, 0);
    /* Drawn after the planet, its rings and its atmosphere, so a backdrop body
       in front of the star occludes it instead of the flare compositing over
       the rings. Everything in farScene that can stand in front of the star
       either writes depth or is ordered before this. */
    quad.renderOrder = 8;
    quad.layers.enable(LAYER.BACKDROP);
    engine.farScene.add(quad);

    this._star = quad;
    this._disposables.push(geo, mat);
  }

  /* ------------------------------------------------------------- hero body */

  _buildPlanet() {
    const { engine, sky } = this;
    const r = this.rng;

    const scheme =
      PLANET_SCHEMES[
        sky.palette.warm
          ? r.pick([0, 1, 2, 3, 4])
          : r.pick([1, 2, 3, 0, 4])
      ];
    this.planetScheme = scheme;

    /* Angular diameter 23..37 degrees. It was 17..27, which is a planet in the
       frame; this is a planet the frame is composed around. The critique's
       number is 20-40 and the reason to sit in the upper half of it is that
       the body is deliberately pushed off to one side and allowed to run off
       the top of the frame — a hero object that fits comfortably inside the
       picture reads as a prop, and one that is cropped reads as near. The void
       still dominates: at 30 degrees the planet covers about a twelfth of a
       16:9 frame. */
    const angular = r.range(0.40, 0.65);
    const radius = r.range(5.2e7, 8.4e7);
    const dist = radius / Math.tan(angular * 0.5);
    this._planetRadius = radius;

    /* Phase angle. `a` is the cosine between the direction to the planet and
       the direction to the star; the phase angle is its arccos measured the
       other way, so a = -1 is full-face and a = +1 is a black new moon.

       The previous window (-0.55 .. 0.35) allowed a nearly full disc, and a
       full disc has no terminator — which is why the hero object read as a
       flat sticker on several seeds. This window keeps the phase between about
       75 and 130 degrees: always a fat crescent to a little past half, so the
       terminator always crosses the visible disc and there is always a dark
       limb to read it against. */
    let dir;
    for (let i = 0; i < 32; i++) {
      dir = new THREE.Vector3(r.gaussian(0, 1), r.gaussian(0, 0.6), r.gaussian(0, 1)).normalize();
      const a = dir.dot(this.sunDirection);
      if (a > -0.26 && a < 0.64) break;
    }
    this.planetDirection = dir.clone();
    const centre = dir.clone().multiplyScalar(dist);

    const tiltAxis = new THREE.Vector3(r.gaussian(0, 1), 0, r.gaussian(0, 1)).normalize();
    const tiltQ = new THREE.Quaternion().setFromAxisAngle(tiltAxis, r.range(0.10, 0.55));

    const group = new THREE.Group();
    group.position.copy(centre);
    group.quaternion.copy(tiltQ);
    group.layers.enable(LAYER.BACKDROP);
    engine.farScene.add(group);
    this._planetGroup = group;

    const sunColour = sky.keyColour;
    const fill = sky.fillColour.clone().multiplyScalar(0.5);

    /* Ring geometry is decided before the body is built because the body needs
       it: a ringed gas giant with no ring shadow banding its cloud tops is the
       single most obvious tell that a planet is procedural. Both shaders read
       the same numbers so the shadow lands exactly where the ring is. */
    const hasRing = r.chance(0.62);
    const ring = {
      inner: radius * r.range(1.32, 1.55),
      outer: radius * r.range(2.05, 2.55),
      bandFreq: r.range(9, 15),
      fineFreq: r.range(48, 80),
      gap1: r.range(0.30, 0.45),
      gap2: r.range(0.60, 0.76),
    };
    /* Ring density as a function of normalised radius, in one expression both
       the ring shader and the body's shadow term can call. */
    const RING_DENSITY_GLSL = /* glsl */ `
      float ringDensity(float t) {
        if (t < 0.0 || t > 1.0) return 0.0;
        /* Broad bands, then hundreds of ringlets on top of them, then two
           hard gaps. It is the ringlets that stop a procedural ring reading as
           concentric grooves cut in vinyl. */
        float band = fbm4e(vec3(t * ${num(ring.bandFreq)}, 3.7, 1.1)) * 0.5 + 0.5;
        float fine = fbm3e(vec3(t * ${num(ring.fineFreq)}, 11.3, 5.2)) * 0.5 + 0.5;
        float lets = fbm3e(vec3(t * ${num(ring.fineFreq * 3.7)}, 27.1, 3.9)) * 0.5 + 0.5;
        float dens = smoothstep(0.26, 0.70, band);
        dens *= 0.30 + 0.70 * smoothstep(0.20, 0.86, fine);
        dens *= 0.52 + 0.48 * lets;
        dens *= smoothstep(0.0, 0.045, t) * (1.0 - smoothstep(0.86, 1.0, t));
        dens *= smoothstep(0.010, 0.030, abs(t - ${num(ring.gap1)}));
        dens *= smoothstep(0.006, 0.020, abs(t - ${num(ring.gap2)}));
        return dens;
      }`;

    /* ---- body ---- */
    const bodyMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: this.sunDirection.clone() },
        // Same direction expressed in the group's own frame, refreshed as the
        // planet turns, so the ring shadow tracks the light instead of the mesh.
        uSunLocal: { value: this.sunDirection.clone() },
        uSunColour: { value: new THREE.Color().copy(sunColour) },
        uFill: { value: fill },
        uSpin: { value: 0 },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vLocal;
        varying vec3 vWorld;
        void main() {
          vLocal = normalize(position);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${NOISE_GLSL}
        ${hasRing ? RING_DENSITY_GLSL : ''}
        uniform vec3 uSunDir;
        uniform vec3 uSunLocal;
        uniform vec3 uSunColour;
        uniform vec3 uFill;
        uniform float uSpin;
        varying vec3 vLocal;
        varying vec3 vWorld;

        const vec3 CA = vec3(${f3(scheme.a)});
        const vec3 CB = vec3(${f3(scheme.b)});
        const vec3 CC = vec3(${f3(scheme.c)});
        const vec3 CS = vec3(${f3(scheme.storm)});
        const vec3 ATMO = vec3(${f3(scheme.atmo)});

        float stormMask(vec3 lp, vec3 c0, float a, float b) {
          vec3 up0 = vec3(0.0, 1.0, 0.0);
          vec3 t1 = normalize(cross(up0, c0));
          vec3 t2 = cross(c0, t1);
          vec3 dl = lp - c0;
          float x = dot(dl, t1) / a;
          float y = dot(dl, t2) / b;
          return exp(-(x * x + y * y) * 2.0) * smoothstep(-0.1, 0.35, dot(lp, c0));
        }

        void main() {
          #include <logdepthbuf_fragment>
          vec3 lp = normalize(vLocal);
          /* Bands: latitude is the only ordering term. Everything else is
             turbulence stretched hard along longitude, which is what gives the
             sheared, curdled look instead of clean stripes. */
          vec3 q = vec3(lp.x, lp.y * 5.0, lp.z);
          float turb = fbm4e(q * ${num(r.range(1.6, 2.4))} + vec3(${f3([r.range(-20, 20), r.range(-20, 20), r.range(-20, 20)])}));
          float fine = ridge2e(vec3(lp.x, lp.y * 11.0, lp.z) * ${num(r.range(4.5, 7.0))});
          float lat = lp.y * ${num(r.range(5.5, 8.5))} + turb * ${num(r.range(0.55, 0.95))};

          float s1 = sin(lat * 3.14159265) * 0.5 + 0.5;
          float s2 = sin(lat * 1.13 + 2.1) * 0.5 + 0.5;
          vec3 albedo = mix(CA, CB, smoothstep(0.15, 0.85, s1));
          albedo = mix(albedo, CC, s2 * s2 * 0.55);
          albedo *= 0.86 + 0.28 * fine;
          // polar hoods read cooler and flatter
          float pol = smoothstep(0.62, 0.98, abs(lp.y));
          albedo = mix(albedo, mix(CB, CC, 0.5) * 0.82, pol * 0.55);

          float st = stormMask(lp, normalize(vec3(${f3([r.range(-1, 1), r.range(-0.45, 0.45), r.range(-1, 1)])})), ${num(r.range(0.10, 0.20))}, ${num(r.range(0.045, 0.08))})
                   + 0.7 * stormMask(lp, normalize(vec3(${f3([r.range(-1, 1), r.range(-0.5, 0.5), r.range(-1, 1)])})), ${num(r.range(0.06, 0.12))}, ${num(r.range(0.03, 0.055))});
          albedo = mix(albedo, CS, clamp(st, 0.0, 1.0) * 0.85);

          vec3 N = lp;
          vec3 V = normalize(cameraPosition - vWorld);
          float ndl = dot(N, uSunDir);
          float ndv = max(dot(N, V), 0.0);

          /* Terminator with real atmospheric wrap, then a night side that is
             genuinely night: a gas giant with no moonlight is lit only by
             whatever the nebula throws at it.

             The previous form multiplied a narrow smoothstep by clamp(ndl),
             and clamp() has a first derivative discontinuity at zero. On a
             disc this wide that showed as a crease along the terminator — a
             step rather than a gradient, which is what "1-px terminator" was
             describing. A Lambert wrap has no such corner: it is smooth
             through zero by construction, and WRAP sets how far past the
             geometric terminator the light carries. 0.085 is about five
             degrees, which is the right order for a deep hydrogen atmosphere
             and is what the twilight band below rides on. */
          const float WRAP = 0.085;
          float wrapped = clamp((ndl + WRAP) / (1.0 + WRAP), 0.0, 1.0);
          float lit = smoothstep(0.0, 0.055, wrapped);
          float shade = lit * (0.06 + 0.94 * wrapped * wrapped);
          shade *= mix(0.58, 1.0, pow(ndv, 0.40));   // limb darkening

          /* Ring shadow. March the local surface point toward the star and see
             whether it crosses the ring plane (group-local y = 0) inside the
             annulus. Cheap, exact, and it is what makes the rings feel like
             they are physically there rather than drawn behind. */
          float ringShade = 1.0;
          ${hasRing ? /* glsl */ `
          if (abs(uSunLocal.y) > 1.0e-4) {
            float tHit = -lp.y / uSunLocal.y;
            if (tHit > 0.0) {
              vec3 hit = lp + uSunLocal * tHit;
              float rr = length(hit.xz) * ${num(radius)};
              float tt = (rr - ${num(ring.inner)}) / ${num(ring.outer - ring.inner)};
              ringShade = 1.0 - 0.80 * clamp(ringDensity(tt), 0.0, 1.0);
            }
          }` : ''}

          /* Pulled back roughly a third now that the disc is half again as
             wide and reliably in frame. At the old exposure the lit cloud tops
             measured brighter than a lit hull, which inverts section 3.1: the
             backdrop is what the subject is read against, and the moment it
             out-reads the subject the fleet stops being the subject. It still
             wants to be the brightest large area in the frame — that is what
             gives a hull its silhouette — just not brighter than the hull. */
          vec3 col = albedo * uSunColour * shade * ringShade * ${num(r.range(1.15, 1.55))};
          col += albedo * uFill * 0.085;             // nebula bounce, night side included
          col += uFill * 0.010;

          /* Twilight: the last few degrees before the terminator run through
             the atmosphere at a grazing angle, so they redden. Without this the
             terminator is a clean arc and reads as a stencil. */
          float twi = lit * (1.0 - smoothstep(0.0, 0.30, ndl));
          col += albedo * ATMO.zyx * twi * 0.28;

          /* Thin atmospheric limb over the disc — forward-scattering haze that
             only shows where the air is edge-on *and* lit. Past the terminator
             it must go to zero, or the glow wraps the unlit limb and the whole
             thing reads as a sprite behind a ball.

             Desaturated, and that is not a taste call. ATMO is a Rayleigh blue
             by construction; laid at full chroma over amber or rust cloud tops
             it summed to a violet-magenta edge that exists nowhere in the
             palette and read as chromatic aberration on the lit limb. Real
             limb haze at this thickness is close to white with a blue bias —
             it is scattering *everything*, just the short end slightly more. */
          vec3 rimTint = mix(vec3(dot(ATMO, vec3(0.2126, 0.7152, 0.0722))), ATMO, 0.42);
          float rim = pow(1.0 - ndv, 3.4);
          col += rimTint * rim * smoothstep(-0.04, 0.34, ndl) * 0.50;

          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.FrontSide,
      toneMapped: false,
    });

    const bodyGeo = new THREE.SphereGeometry(radius, this.quality === 'low' ? 64 : 128, this.quality === 'low' ? 40 : 72);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.layers.enable(LAYER.BACKDROP);
    group.add(body);
    this._planet = body;
    this._planetMat = bodyMat;
    this._disposables.push(bodyGeo, bodyMat);

    /* ---- atmospheric shell: exponential limb glow, computed from the true
       impact parameter of the view ray so it is a real atmosphere profile and
       not a fresnel smear. ---- */
    const scaleH = radius * 0.030;
    const atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: this.sunDirection.clone() },
        uCentre: { value: centre.clone() },
        uR: { value: radius },
        uH: { value: scaleH },
        uColour: { value: new THREE.Color(scheme.atmo[0], scheme.atmo[1], scheme.atmo[2]) },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uSunDir;
        uniform vec3 uCentre;
        uniform float uR;
        uniform float uH;
        uniform vec3 uColour;
        varying vec3 vWorld;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 ro = cameraPosition;
          vec3 rd = normalize(vWorld - ro);
          vec3 oc = uCentre - ro;
          float tca = dot(oc, rd);
          float b = sqrt(max(dot(oc, oc) - tca * tca, 0.0));
          float h = (b - uR) / uH;
          if (h < 0.0) discard;
          vec3 limb = normalize((ro + rd * tca) - uCentre);
          float ndl = dot(limb, uSunDir);
          /* The shell must not glow past the terminator. An earlier version
             used a wide smoothstep that still returned ~0.3 on the night limb,
             so the halo ran right round the disc and the planet read as a
             sprite pasted behind a sphere. This falls to exactly zero a couple
             of degrees onto the dark side. */
          float lit = smoothstep(-0.02, 0.26, ndl);
          lit *= lit;
          float mu = max(dot(rd, -uSunDir), 0.0);
          /* Forward scattering only: the crescent nearest the star flares, the
             rest of the limb is a thin line. */
          float scat = 0.30 + 2.30 * pow(mu, 4.0);
          float a = exp(-h * 1.35) * (1.0 - smoothstep(2.2, 3.4, h));
          /* Grazing light reddens on its way through, so the few degrees at
             the terminator run warm before they go out. */
          vec3 tint = mix(uColour.zyx * 0.9, uColour, smoothstep(0.02, 0.32, ndl));
          gl_FragColor = vec4(tint * a * lit * scat * 0.80, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    const atmoGeo = new THREE.SphereGeometry(radius * 1.16, 64, 40);
    const atmo = new THREE.Mesh(atmoGeo, atmoMat);
    atmo.layers.enable(LAYER.BACKDROP);
    atmo.renderOrder = 2;
    group.add(atmo);
    /* Both of these carry the planet's world centre as a uniform, because they
       trace against the body rather than being shaded on it. Anything that
       moves the group has to move them too. */
    this._atmoMat = atmoMat;
    this._disposables.push(atmoGeo, atmoMat);

    /* ---- rings ---- */
    if (hasRing) {
      const rin = ring.inner;
      const rout = ring.outer;
      const ringMat = new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: { value: this.sunDirection.clone() },
          uCentre: { value: centre.clone() },
          uR: { value: radius },
          uIn: { value: rin },
          uOut: { value: rout },
          uSunColour: { value: new THREE.Color().copy(sunColour) },
          uFill: { value: fill },
        },
        vertexShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 vWorld;
          varying vec3 vLocal;
          void main() {
            vLocal = position;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_fragment>
          ${NOISE_GLSL}
          ${RING_DENSITY_GLSL}
          uniform vec3 uSunDir;
          uniform vec3 uCentre;
          uniform float uR;
          uniform float uIn;
          uniform float uOut;
          uniform vec3 uSunColour;
          uniform vec3 uFill;
          varying vec3 vWorld;
          varying vec3 vLocal;

          void main() {
            #include <logdepthbuf_fragment>
            float rad = length(vLocal.xy);
            float t = clamp((rad - uIn) / (uOut - uIn), 0.0, 1.0);

            /* Radial structure: a few broad bands cut by hard, narrow gaps —
               the gaps are what make a ring look like ice and not a decal.
               Shared verbatim with the body's shadow term. */
            float dens = ringDensity(t);
            float fine = fbm3e(vec3(t * ${num(ring.fineFreq)}, 11.3, 5.2)) * 0.5 + 0.5;
            if (dens < 0.004) discard;

            /* Planet shadow: the cylinder cast along the light direction. */
            vec3 pc = vWorld - uCentre;
            float along = dot(pc, uSunDir);
            vec3 perp = pc - uSunDir * along;
            float pr = length(perp);
            float shade = along < 0.0 ? smoothstep(uR * 0.94, uR * 1.10, pr) : 1.0;

            vec3 rd = normalize(vWorld - cameraPosition);
            float mu = dot(rd, -uSunDir);
            /* Ice forward-scatters hard when backlit, which is why Saturn's
               rings glow when the sun is behind them. */
            float phase = 0.42 + 1.55 * pow(max(mu, 0.0), 3.0);

            /* Ring particles are dirty water ice: near-neutral, and much
               darker than the cloud tops they orbit. Tinting them with the
               planet's own scheme made the rings compete with the planet. */
            vec3 ice = mix(vec3(${f3(scheme.c)}), vec3(${f3(scheme.b)}), fine);
            ice = mix(vec3(dot(ice, vec3(0.2126, 0.7152, 0.0722))), ice, 0.42) * 0.62;
            vec3 col = ice * uSunColour * shade * phase * 0.52 + uFill * 0.06;
            /* Opacity comes from optical depth, and from nothing else.

               It used to be a raw density scaled by the phase term and then
               capped at 0.70, which meant two things that were both wrong: the
               densest ringlet was never more than about half opaque, so the
               backdrop star field punched straight through the brightest part
               of the rings and read as being drawn in front of them; and the
               rings became *more* transparent as they turned away from the
               star, which is a brightness effect being applied to geometry.
               A real ring is genuinely opaque where it is thick — Saturn's B
               ring runs an optical depth of one to two — so Beer's law it is,
               and the phase term is left to do only its own job of saying how
               much light scatters back toward the camera. */
            float alpha = 1.0 - exp(-dens * 2.6);
            gl_FragColor = vec4(col, alpha);
          }`,
        transparent: true,
        /* A flat annulus seen from outside never overlaps itself, so writing
           depth here is free of the usual transparent-sorting trouble — and it
           is what stops the star's flare compositing straight through the
           rings, since the flare is ordered after them. */
        depthWrite: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const ringGeo = new THREE.RingGeometry(rin, rout, 256, 8);
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.layers.enable(LAYER.BACKDROP);
      ringMesh.renderOrder = 1;
      group.add(ringMesh);
      this._ring = ringMesh;
      this._ringMat = ringMat;
      this._disposables.push(ringGeo, ringMat);
    }

    /* ---- moon: a second body at a different scale to triangulate depth ---- */
    if (r.chance(0.75)) {
      const mr = r.range(6e6, 1.6e7);
      const mDist = r.range(2.4e8, 6.0e8);
      const mDir = new THREE.Vector3(r.gaussian(0, 1), r.gaussian(0, 0.7), r.gaussian(0, 1)).normalize();
      const mMat = new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: { value: this.sunDirection.clone() },
          uSunColour: { value: new THREE.Color().copy(sunColour) },
          uFill: { value: fill },
        },
        vertexShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec3 vLocal;
          varying vec3 vWorld;
          void main() {
            vLocal = normalize(position);
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_fragment>
          ${NOISE_GLSL}
          uniform vec3 uSunDir;
          uniform vec3 uSunColour;
          uniform vec3 uFill;
          varying vec3 vLocal;
          varying vec3 vWorld;
          void main() {
            #include <logdepthbuf_fragment>
            vec3 N = normalize(vLocal);
            float m = fbm4e(N * ${num(r.range(3.5, 6.0))} + vec3(${f3([r.range(-9, 9), r.range(-9, 9), r.range(-9, 9)])}));
            float cr = 1.0 - ridge2e(N * ${num(r.range(9, 16))});
            vec3 base = mix(vec3(0.128, 0.121, 0.112), vec3(0.300, 0.288, 0.268), m * 0.5 + 0.5);
            base *= 0.72 + 0.42 * cr;
            /* Bump the terminator with the same field so craters read at the
               edge of the light rather than as flat texture. */
            vec3 pert = normalize(N + vec3(m, cr - 0.5, m * 0.6) * 0.16);
            float ndl = dot(pert, uSunDir);
            /* An airless body gets a hard terminator, but not a discontinuous
               one: the same clamp() corner that creased the gas giant is worse
               here because the moon is only a couple of degrees across, so the
               whole terminator falls inside a handful of pixels. A narrow wrap
               keeps it hard and keeps it smooth. */
            float mw = clamp((ndl + 0.045) / 1.045, 0.0, 1.0);
            float lit = smoothstep(0.0, 0.03, mw) * (0.14 + 0.86 * mw);
            vec3 col = base * uSunColour * lit * 1.5 + base * uFill * 0.20 + uFill * 0.012;
            gl_FragColor = vec4(col, 1.0);
          }`,
        toneMapped: false,
      });
      const mGeo = new THREE.SphereGeometry(mr, 48, 32);
      const moon = new THREE.Mesh(mGeo, mMat);
      moon.position.copy(mDir).multiplyScalar(mDist);
      moon.layers.enable(LAYER.BACKDROP);
      this.engine.farScene.add(moon);
      this._moon = moon;
      this._disposables.push(mGeo, mMat);
    }
  }

  /* ------------------------------------------------------ backdrop framing */

  /**
   * Put the backdrop where the camera is looking.
   *
   * Two moves, and they are different in kind.
   *
   * The gas giant is simply repositioned. It is an object at 4e8 m; there is
   * nothing to preserve about where it was, and the only constraint is that it
   * must keep a terminator across its visible disc, which is why it is placed
   * on the star's side of the frame rather than the anti-star side. That also
   * puts it opposite the hero hull, which the camera rig pushes away from the
   * star for the same reason — so the two compose against each other for free.
   *
   * The sky is ROTATED ABOUT THE STAR AXIS, and only about the star axis. A
   * rotation about that axis leaves every dot(direction, star) in the bake
   * exactly as it was, so the lit side of the nebula, its forward-scattering
   * lobe and its self-shadowing all remain correct. Any other rotation would
   * be a lie about where the light comes from. The star quad itself sits on
   * that axis and is therefore invariant, which is what makes the trick free.
   *
   * The star cloud rotates by the inverse, as an object: its shader looks the
   * gas column up along its own un-rotated vertex position, which is the sky
   * map's frame, so occlusion follows the gas rather than the stars.
   *
   * This does not close the loop the camera rig warns about. The rig derives
   * its aim from the star; the star's azimuth stays uniformly seeded and is
   * chosen before anything here runs. Nothing in this method feeds back into
   * it. The seed still decides the whole picture.
   *
   * @param {THREE.Camera} camera
   */
  aimBackdrop(camera) {
    const cam = camera || this.engine.camera;
    if (!cam || this._aimed) return;
    const view = cam.getWorldDirection(new THREE.Vector3());
    if (!Number.isFinite(view.x) || view.lengthSq() < 0.5) return;
    this._aimed = true;

    const r = this.rng.fork(0xa1a3);
    const sun = this.sunDirection;

    /* Screen frame. Offsets below are tangents, which is exactly how a pinhole
       camera maps an angle to a position in the frame: an offset of t along
       `right` lands at t / tan(hfov/2) in normalised device x. */
    const up0 = Math.abs(view.y) > 0.94 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(view, up0).normalize();
    const up = new THREE.Vector3().crossVectors(right, view).normalize();

    const vHalf = Math.tan((cam.fov * Math.PI) / 360);
    const hHalf = vHalf * (cam.aspect || 16 / 9);

    /* Which side of the frame the star is on. The planet goes that way: it
       shortens the star-planet angle, which fattens the phase and guarantees
       the terminator stays on the visible disc. */
    const sunSide = sun.dot(right);
    const side = sunSide === 0 ? (r.chance(0.5) ? 1 : -1) : Math.sign(sunSide);

    const ndcX = side * r.range(0.34, 0.52);
    const ndcY = r.range(0.24, 0.42);
    const dir = view
      .clone()
      .addScaledVector(right, ndcX * hHalf)
      .addScaledVector(up, ndcY * vHalf)
      .normalize();

    this.planetDirection = dir.clone();
    if (this._planetGroup) {
      const dist = this._planetGroup.position.length();
      const centre = dir.clone().multiplyScalar(dist);
      this._planetGroup.position.copy(centre);
      this._planetGroup.updateMatrixWorld();
      if (this._atmoMat) this._atmoMat.uniforms.uCentre.value.copy(centre);
      if (this._ringMat) this._ringMat.uniforms.uCentre.value.copy(centre);
      /* The moon travels with it, or the pair stops reading as a system. */
      if (this._moon) {
        const md = this._moon.position.length();
        this._moon.position
          .copy(dir)
          .applyAxisAngle(up, r.range(0.18, 0.42) * (r.chance(0.5) ? 1 : -1))
          .applyAxisAngle(right, r.range(0.10, 0.30) * (r.chance(0.5) ? 1 : -1))
          .multiplyScalar(md);
      }
    }

    /* The gas goes to the other side of the frame from the planet, and high
       rather than low: the complaint the composition is answering is a black
       upper two thirds, and gas under the battle line does not fix that. */
    const want = view
      .clone()
      .addScaledVector(right, -side * r.range(0.28, 0.46) * hHalf)
      .addScaledVector(up, r.range(0.30, 0.58) * vHalf)
      .normalize();
    this._composeSky(want, sun);
  }

  /* How far the sky may be tilted OFF the star axis, in radians.

     Rotation about the star axis is exact: it moves the gas and changes
     nothing the bake believes about the light. It is also only one degree of
     freedom, and it cannot close the gap when the angle between the gas and
     the star differs from the angle between the view and the star — measured
     on seed 99 that gap was 55 degrees and left the only complex in the sky
     pointing at the floor.

     So a bounded tilt is allowed on top of it, and what it costs is stated
     plainly: the gas ends up believing the star is up to this far from where
     it is. The reason that is affordable rather than a lie is that the terms
     it perturbs are broad — a global lit-versus-shadow gradient measured in
     tens of degrees — while the term doing the actual work, the self-shadow,
     is internal to the cloud and does not reference the world star at all
     once baked. Twenty-two degrees is about where the lit side visibly stops
     agreeing with the terminator on a hull in the same frame. */
  static get SKY_TILT_MAX() {
    return 0.38;
  }

  /**
   * Bring one of the baked gas complexes to a chosen world direction.
   * @param {THREE.Vector3} want  where the gas should appear
   * @param {THREE.Vector3} sun   direction to the key star
   */
  _composeSky(want, sun) {
    const sky = this.sky;
    if (!sky || !sky.nebulaAnchor) return;

    /* Which complex to bring round. The primary is the big one and the better
       subject, so it wins unless the secondary can be placed a good deal more
       honestly — that is, with materially less tilt, because the tilt is the
       only part of this that costs anything. */
    const wantPolar = Math.acos(THREE.MathUtils.clamp(want.dot(sun), -1, 1));
    const polar = (v) => Math.acos(THREE.MathUtils.clamp(v.dot(sun), -1, 1));
    const primary = sky.nebulaAnchor;
    const secondary = sky.nebulaSecond;
    let src = primary;
    if (secondary) {
      const dp = Math.abs(polar(primary) - wantPolar);
      const ds = Math.abs(polar(secondary) - wantPolar);
      if (ds < dp - 0.26) src = secondary;
    }

    /* Work on the APPEARANCE side throughout: `qApp` is the rotation that
       takes a direction in the baked map to where it is drawn in the world.
       The background sampler wants its inverse, and the star cloud — whose
       shader looks the gas up along its own un-rotated vertices — wants
       exactly qApp. */
    const flatten = (v) => v.clone().addScaledVector(sun, -v.dot(sun));
    const a = flatten(src);
    const u = flatten(want);
    const qApp = new THREE.Quaternion();
    if (a.lengthSq() > 0.02 && u.lengthSq() > 0.02) {
      a.normalize();
      u.normalize();
      const cross = new THREE.Vector3().crossVectors(a, u);
      qApp.setFromAxisAngle(sun, Math.atan2(cross.dot(sun), a.dot(u)));
    }

    /* Whatever azimuth could not fix is polar, and polar is what the tilt is
       for. Clamped, and applied about the axis that moves the complex straight
       toward the target rather than round it. */
    const shown = src.clone().applyQuaternion(qApp);
    const axis = new THREE.Vector3().crossVectors(shown, want);
    if (axis.lengthSq() > 1e-8) {
      axis.normalize();
      const gap = Math.acos(THREE.MathUtils.clamp(shown.dot(want), -1, 1));
      const tilt = Math.min(gap, Environment.SKY_TILT_MAX);
      if (tilt > 1e-4) qApp.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, tilt));
    }

    const { engine } = this;
    engine.farScene.backgroundRotation.setFromQuaternion(qApp.clone().invert());
    engine.scene.environmentRotation.copy(engine.farScene.backgroundRotation);
    if (sky.starField) {
      sky.starField.quaternion.copy(qApp);
      sky.starField.updateMatrixWorld();
    }
    this._skyRotation = qApp;
  }

  /* --------------------------------------------------- contested seams (3D) */

  /* The primary victory condition, given a body.
     ---------------------------------------------------------------------
     Until now a contested seam existed on screen as ore rocks — which look
     exactly like the ore rocks of an uncontested seam — and as the HUD string
     "Seams 0/6". The one piece of ground the whole match is fought over had no
     representation in the world at all, which is both an art problem (every
     empty frame lacks a subject) and a design problem (the player cannot see
     the thing they are being asked to take).

     What is drawn is the capture volume the sim actually integrates over:
     `CONTROL.RADIUS` past the seam's own radius is the test `sim/economy.js`
     applies to decide who is standing on it, so the boundary a player sees is
     the boundary they are judged against rather than a decorative approximation
     of it. Ownership, control and the contested flag are all read from SIM's
     records — the same objects, by identity — and never recomputed here.

     `markContested` is called once from ENV because ENV builds before the
     world does and would otherwise have nothing to draw. It is SIM's own test,
     run on SIM's own records, and `sim/world.js` runs it again on the same
     objects a moment later and agrees by construction. */

  _buildSeams() {
    const { engine } = this;
    const clusters = this._clusters;
    if (!clusters || !clusters.length) return;

    const sep = this.options.separation || DEFAULT_SETUP.separation;
    try {
      if (clusters.some((c) => c && c.contested === undefined)) markContested(clusters, sep);
    } catch (err) {
      return;
    }

    const list = [];
    for (const c of clusters) if (c && c.contested) list.push(c);
    if (!list.length) return;
    this._seamList = list;

    const n = list.length;
    const iCentre = new Float32Array(n * 3);
    const iParam = new Float32Array(n * 3);   // field radius, boundary radius, phase
    const iTint = new Float32Array(n * 3);
    const iState = new Float32Array(n * 2);   // held 0..1, contested pulse 0..1
    const r = this.rng.fork(0x5EA9);
    for (let i = 0; i < n; i++) {
      const c = list[i];
      iCentre[i * 3] = c.position.x;
      iCentre[i * 3 + 1] = c.position.y;
      iCentre[i * 3 + 2] = c.position.z;
      /* Two radii, and the split matters.

         Drawing the volume at the capture radius was the obvious thing and it
         was wrong: `CONTROL.RADIUS` is 3.4 km past a seam that is already
         1.3-2 km across, so the shells came out ten kilometres wide on a
         twenty-two kilometre map and the fleet fought inside a row of glass
         domes. The volume is the seam — the gas and rubble you can see — and
         it is drawn just outside the ore so it contains what it claims to. The
         capture radius is a boundary, not a body, so it is drawn as one. */
      iParam[i * 3] = c.radius * 1.25;
      iParam[i * 3 + 1] = c.radius + CONTROL.RADIUS;
      iParam[i * 3 + 2] = r.range(0, Math.PI * 2);
      iTint[i * 3] = 1;
      iTint[i * 3 + 1] = 1;
      iTint[i * 3 + 2] = 1;
    }

    const common = (geo) => {
      geo.setAttribute('iCentre', new THREE.InstancedBufferAttribute(iCentre, 3));
      geo.setAttribute('iParam', new THREE.InstancedBufferAttribute(iParam, 3));
      const tint = new THREE.InstancedBufferAttribute(iTint, 3);
      const state = new THREE.InstancedBufferAttribute(iState, 2);
      tint.setUsage(THREE.DynamicDrawUsage);
      state.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iTint', tint);
      geo.setAttribute('iState', state);
      geo.instanceCount = n;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60000);
      return { tint, state };
    };

    /* ---- the volume ----
       A shell, drawn double-sided and additively, so the near and far walls
       both contribute and the silhouette — where both are grazing — is twice
       as bright as anything inside it. That is what makes a bounded volume out
       of what is otherwise a soft ball. */
    const shellSrc = new THREE.IcosahedronGeometry(1, 3);
    const shell = new THREE.InstancedBufferGeometry();
    shell.index = shellSrc.index;
    shell.setAttribute('position', shellSrc.attributes.position);
    const shellAttr = common(shell);

    const volMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 34000 } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 iCentre;
        attribute vec3 iParam;
        attribute vec3 iTint;
        attribute vec2 iState;
        uniform float uTime;
        uniform float uFade;
        varying vec3 vNrm;
        varying vec3 vWorld;
        varying vec3 vTint;
        varying float vAlpha;
        varying float vPhase;
        void main() {
          vec3 nrm = normalize(position);

          /* Not a sphere, for the same reason the ore inside it is not a
             sphere: a perfect one reads as blown glass, and the first capture
             with these in it looked like a row of soap bubbles over the
             battle. Three sinusoids give an organic lumpy envelope for four
             instructions and no noise texture, and the same 0.78 flattening
             the rocks already carry makes it a field rather than a ball.

             The normal is the ellipsoid's rather than the displaced surface's.
             That is exact for the flattening and approximate for the lumps,
             which is the right way round: the flattening is what tilts the
             limb, and a rim term cannot see a few degrees of error on top of
             it. */
          const float FLAT = 0.78;
          float lump = sin(nrm.x * 3.1 + iParam.z)
                     * sin(nrm.y * 2.7 - iParam.z * 1.3)
                     * sin(nrm.z * 3.5 + iParam.z * 0.7);
          vec3 shape = vec3(nrm.x, nrm.y * FLAT, nrm.z) * (1.0 + 0.17 * lump);
          vec3 world = iCentre + shape * iParam.x;
          vNrm = normalize(vec3(nrm.x, nrm.y / (FLAT * FLAT), nrm.z));
          vWorld = world;
          vTint = iTint;
          vPhase = iParam.z;

          /* A deadlocked seam breathes; a settled one is steady. The pulse is
             carried by how far the seam is from being anybody's, which is the
             one number that says "this is still being fought over". */
          float pulse = 0.80 + 0.20 * sin(uTime * 1.15 + iParam.z);
          float base = mix(0.20, 0.42, iState.x);
          vAlpha = base * mix(1.0, pulse, iState.y);

          /* Fade by how much of the FRAME this covers, not by range — the
             lesson the dust sheets in this file already carry, and the seams
             walked into it harder. A ten-kilometre shell at close quarters is
             not a marker, it is a wall across the picture, and the first
             capture with these in it had the fleet fighting inside a row of
             glass domes. What the volume is for is telling you where the
             ground is from somewhere else on the map; standing in it, the HUD
             has already told you.

             projectionMatrix[1][1] is 1/tan(fov/2), so the value below is the shell's
             radius as a fraction of the frame's half-height. */
          float d = length(cameraPosition - iCentre);
          float halfH = d / max(projectionMatrix[1][1], 1.0e-4);
          float cover = iParam.x / max(halfH, 1.0);
          vAlpha *= (1.0 - smoothstep(0.78, 1.90, cover))
                  * smoothstep(0.30, 0.95, d / iParam.x)
                  * (1.0 - smoothstep(uFade, uFade * 2.2, d));

          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uTime;
        varying vec3 vNrm;
        varying vec3 vWorld;
        varying vec3 vTint;
        varying float vAlpha;
        varying float vPhase;

        vec3 h33(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yxz + 33.33);
          return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
        }
        float gn(vec3 p) {
          vec3 i = floor(p);
          vec3 f = p - i;
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(dot(h33(i), f),
                    dot(h33(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0)), u.x),
                mix(dot(h33(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0)),
                    dot(h33(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0)), u.x), u.y),
            mix(mix(dot(h33(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0)),
                    dot(h33(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0)), u.x),
                mix(dot(h33(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0)),
                    dot(h33(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0)), u.x), u.y),
            u.z) * 1.35;
        }

        void main() {
          #include <logdepthbuf_fragment>
          vec3 V = normalize(cameraPosition - vWorld);
          float ndv = abs(dot(vNrm, V));
          /* Steep. At 2.6 the shell lit up over a wide band and read as blown
             glass; the wanted read is a limb — a bounded thing seen edge-on —
             which is a much narrower function of the viewing angle. */
          float rim = pow(1.0 - ndv, 3.6);
          float a = rim * vAlpha;
          /* Discard before the noise, not after. The shell is nearly invisible
             face-on by design, so this kills most of the fill of a volume that
             can cover a third of the frame — the difference between a cheap
             marker and eight kilometres of overdraw. */
          if (a < 0.0022) discard;

          float w = gn(vNrm * 2.7 + vec3(vPhase, uTime * 0.035, -vPhase));
          a *= 0.60 + 0.70 * (w * 0.5 + 0.5);

          vec3 col = vTint * (0.40 + 1.75 * rim);
          gl_FragColor = vec4(col * a, a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });

    const vol = new THREE.Mesh(shell, volMat);
    vol.frustumCulled = false;
    vol.renderOrder = 14;
    vol.name = 'env:seams';
    engine.scene.add(vol);

    /* ---- the boundary ----
       A flat annulus in the battle plane. The volume says "there is something
       here"; this says where it ends, and it is the part that survives being
       eight kilometres away, because a thin bright ellipse is legible long
       after a soft shell has faded into the haze. It also puts a horizontal
       plane in a game that otherwise has none, which is most of why the map
       reads as flat. */
    const ringSrc = new THREE.RingGeometry(0.88, 1.0, 160, 1);
    const ring = new THREE.InstancedBufferGeometry();
    ring.index = ringSrc.index;
    ring.setAttribute('position', ringSrc.attributes.position);
    const ringAttr = common(ring);

    const ringMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 46000 } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 iCentre;
        attribute vec3 iParam;
        attribute vec3 iTint;
        attribute vec2 iState;
        uniform float uTime;
        uniform float uFade;
        varying vec2 vLocal;
        varying vec3 vTint;
        varying float vAlpha;
        varying float vHeld;
        void main() {
          vLocal = position.xy;
          /* The ring geometry lies in XY; lay it flat in XZ. */
          vec3 world = iCentre + vec3(position.x, 0.0, position.y) * iParam.y;
          vTint = iTint;
          vHeld = iState.x;

          float pulse = 0.78 + 0.22 * sin(uTime * 1.15 + iParam.z);
          vAlpha = mix(0.56, 1.05, iState.x) * mix(1.0, pulse, iState.y);

          /* Edge-on it is a line one pixel high and would crawl, so it goes
             out rather than aliases. */
          vec3 toCam = normalize(cameraPosition - iCentre);
          vAlpha *= 0.18 + 0.82 * smoothstep(0.03, 0.32, abs(toCam.y));
          float d = length(cameraPosition - iCentre);
          float halfH = d / max(projectionMatrix[1][1], 1.0e-4);
          vAlpha *= (1.0 - smoothstep(1.15, 2.60, iParam.y / max(halfH, 1.0)))
                  * (1.0 - smoothstep(uFade, uFade * 2.0, d));

          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying vec2 vLocal;
        varying vec3 vTint;
        varying float vAlpha;
        varying float vHeld;
        void main() {
          #include <logdepthbuf_fragment>
          float t = (length(vLocal) - 0.88) / 0.12;
          /* A soft outward wash with one hard line in it: the wash reads at
             distance, the line reads as a boundary rather than as a glow. */
          float wash = smoothstep(0.0, 0.55, t) * (1.0 - smoothstep(0.62, 1.0, t));
          float edge = exp(-(t - 0.72) * (t - 0.72) * 900.0);

          /* Ticks, and only ticks — no numerals, no sweep, nothing that would
             turn a piece of the world into a HUD element. They are what makes
             a circle read as surveyed ground. */
          float ang = atan(vLocal.y, vLocal.x);
          float seg = fract(ang * 6.0 / 3.14159265);
          float tick = smoothstep(0.42, 0.50, seg) * (1.0 - smoothstep(0.50, 0.58, seg));

          float a = (wash * 0.22 + edge * (0.55 + 0.45 * vHeld) + tick * wash * 0.30) * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vTint * a * 1.05, a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });

    const ringMesh = new THREE.Mesh(ring, ringMat);
    ringMesh.frustumCulled = false;
    ringMesh.renderOrder = 15;
    ringMesh.name = 'env:seamRings';
    engine.scene.add(ringMesh);

    /* Neutral is bone rather than white: unclaimed ground should read as cold
       and unlit. The team hues are the trim colours the hulls already wear, so
       a seam and the fleet holding it are the same colour — but spent down
       toward the neutral, because trim is a fifth of a silhouette and this is
       a volume kilometres across. At full chroma the held seams came out as
       flat orange masses that owned the frame, which is section 3.3 exactly
       backwards: the colour belongs to the nebula and the engines, and a
       marker this large has to state its allegiance in hue rather than in
       saturation. */
    const neutral = new THREE.Color(0.50, 0.54, 0.58);
    this._seamColours = {
      neutral,
      team: [
        TEAM_COLORS[0].trim.clone().lerp(neutral, 0.42),
        TEAM_COLORS[1].trim.clone().lerp(neutral, 0.42),
      ],
    };
    this._seams = {
      vol,
      ring: ringMesh,
      tints: [shellAttr.tint, ringAttr.tint],
      states: [shellAttr.state, ringAttr.state],
      key: '',
    };
    this._disposables.push(shell, ring, shellSrc, ringSrc, volMat, ringMat);
    this._updateSeams(true);
  }

  /** Repaint the seams from SIM's live control values. */
  _updateSeams(force) {
    const s = this._seams;
    if (!s) return;
    const list = this._seamList;

    /* Quantised, because this rewrites two instance buffers and control moves
       continuously — a seam takes twenty-two seconds to flip, so thirty-two
       steps is finer than an eye can follow and a hundredth of the uploads. */
    let key = '';
    for (const c of list) key += Math.round((c.control || 0) * 32) + ',';
    if (!force && key === s.key) return;
    s.key = key;

    /* Both meshes wrap the same two arrays — the volume and its boundary are
       always painted with the same numbers, so there is one copy of them and
       two GL buffers filled from it. */
    const tint = s.tints[0].array;
    const state = s.states[0].array;
    const col = new THREE.Color();
    const { neutral, team } = this._seamColours;
    for (let i = 0; i < list.length; i++) {
      const ctl = Math.max(-1, Math.min(1, list[i].control || 0));
      const mag = Math.abs(ctl);
      col.copy(neutral).lerp(team[ctl < 0 ? 0 : 1], mag);
      tint[i * 3] = col.r;
      tint[i * 3 + 1] = col.g;
      tint[i * 3 + 2] = col.b;
      state[i * 2] = mag;
      /* Pulses hardest when the seam is genuinely nobody's. */
      state[i * 2 + 1] = 1 - mag;
    }
    for (const a of s.tints) a.needsUpdate = true;
    for (const a of s.states) a.needsUpdate = true;
  }

  /* ----------------------------------------------------------------- dust */

  _buildDust() {
    const { engine, sky } = this;
    const r = this.rng.fork(0xd057);
    const count = Math.round((this.budget.dust) * (this.options.dustScale || 1));
    if (count <= 0) return;

    const tex = makeDustTexture(r, 256);
    this._dustTexture = tex;

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('normal', base.attributes.normal);
    geo.setAttribute('uv', base.attributes.uv);

    const iPos = new Float32Array(count * 3);
    const iParam = new Float32Array(count * 4);
    const iTint = new Float32Array(count * 3);
    const iAtlas = new Float32Array(count * 2);

    // The dust is a body, not a uniform haze: sheets are drawn from a fbm
    // density field so the field has lanes and holes you can fly through.
    const spread = 17000;
    const tintA = sky.nebulaColour.clone();
    const tintB = sky.fillColour.clone();
    const off = [r.range(-30, 30), r.range(-30, 30), r.range(-30, 30)];

    let n = 0;
    let guard = 0;
    while (n < count && guard < count * 40) {
      guard++;
      const x = r.gaussian(0, spread * 0.55);
      const y = r.gaussian(0, spread * 0.30);
      const z = r.gaussian(0, spread * 0.55);
      const d = fbm3(x / 5200 + off[0], y / 3400 + off[1], z / 5200 + off[2], 4);
      if (r.next() > 0.18 + 0.82 * Math.max(0, d * 0.5 + 0.5) ** 1.6) continue;

      iPos[n * 3] = x;
      iPos[n * 3 + 1] = y;
      iPos[n * 3 + 2] = z;

      /* Smaller, and more of them survive to be seen.

         The old range topped out at 6.7 km, and the fade below only removed a
         sheet once it covered a quarter of the frame — so a 4 km sheet at
         eight kilometres was drawn at full strength across seventeen degrees.
         Individually invisible; collectively the veil that made the close pass
         unusable. Trading size for amplitude keeps the same amount of dust in
         the frame while making any one sheet too small to be read as a shape,
         which is the whole requirement: dust is a medium, and the moment you
         can see where one sprite ends it has stopped being one. */
      const size = r.range(700, 2400) * (r.chance(0.16) ? 1.5 : 1);
      iParam[n * 4] = size;
      iParam[n * 4 + 1] = r.range(0, Math.PI * 2);
      iParam[n * 4 + 2] = r.range(0.028, 0.092) * (size > 3000 ? 0.60 : 1);
      iParam[n * 4 + 3] = r.range(0, 100);

      const t = tintA.clone().lerp(tintB, r.range(0, 1));
      t.multiplyScalar(r.range(0.7, 1.25));
      iTint[n * 3] = t.r;
      iTint[n * 3 + 1] = t.g;
      iTint[n * 3 + 2] = t.b;

      iAtlas[n * 2] = r.int(0, 1) * 0.5;
      iAtlas[n * 2 + 1] = r.int(0, 1) * 0.5;
      n++;
    }

    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    geo.setAttribute('iParam', new THREE.InstancedBufferAttribute(iParam, 4));
    geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(iTint, 3));
    geo.setAttribute('iAtlas', new THREE.InstancedBufferAttribute(iAtlas, 2));
    geo.instanceCount = n;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), spread * 4);

    const mat = new THREE.ShaderMaterial({
      defines: {},
      uniforms: {
        uMap: { value: tex },
        uSunDir: { value: this.sunDirection.clone() },
        uSunColour: { value: sky.keyColour.clone() },
        uTime: { value: 0 },
        uIntensity: { value: this.options.dustIntensity !== undefined ? this.options.dustIntensity : 1.0 },
        uFar: { value: 46000 },
        uHaze: { value: 6.2e-5 },
        uDepth: { value: null },
        uSoft: { value: 900 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 iPos;
        attribute vec4 iParam;
        attribute vec3 iTint;
        attribute vec2 iAtlas;
        uniform float uTime;
        uniform float uFar;
        uniform float uIntensity;
        uniform float uHaze;
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vAlpha;
        varying vec3 vView;
        varying float vDist;
        void main() {
          float ph = iParam.w;
          /* Slow, incoherent drift. Sheets never travel far enough to leave the
             field; they just breathe. */
          vec3 drift = vec3(
            sin(uTime * 0.0121 + ph),
            cos(uTime * 0.0093 + ph * 1.7),
            sin(uTime * 0.0074 + ph * 0.6)) * 260.0;
          vec3 centre = iPos + drift;

          vec3 toCam = cameraPosition - centre;
          float dist = length(toCam);
          vec3 fwd = toCam / max(dist, 1.0);
          vec3 ref = abs(fwd.y) > 0.985 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
          vec3 right = normalize(cross(ref, fwd));
          vec3 up = cross(fwd, right);

          float c = cos(iParam.y);
          float s = sin(iParam.y);
          vec2 q = position.xy;
          vec2 rq = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
          vec3 world = centre + (right * rq.x + up * rq.y) * iParam.x;

          /* No depth buffer to soften against, so a sheet has to fade out
             before the camera can reach its plane.

             The fade must be driven by how much of the FRAME the sheet covers,
             not by a multiple of its own size. Keying it to its own size — a
             smoothstep from 0.30x to 1.25x of the sprite width — guaranteed
             precisely the wrong thing: every sheet reached full opacity at
             about the distance where it filled the screen, so the field's
             largest sprites were always drawn at maximum alpha and maximum
             screen area. That is what read as dozens of big soft discs and got
             mistaken for a depth-of-field artefact; POSTFX proved their pass
             was not touching those regions.

             projectionMatrix[1][1] is 1/tan(fov/2), so this is the sheet's
             half-width as a fraction of the frame's half-height.

             The window was 0.20 to 0.52, and stated in the units that matter
             that is: a sheet is drawn at full strength until it is TEN DEGREES
             across and is not fully gone until twenty-six. That is not a fade,
             it is a permit. Measured from the capture harness's own close
             camera, forty-one sheets were in front of the lens, twenty-eight of
             them subtending more than ten degrees, summing to 0.66 of additive
             alpha over a hull whose shadow side sits at 0.06-0.09 — which is
             the large translucent sheets the VFX lane bisected to this file,
             and the reason a close pass had no terminator on anything.

             The fault was never one bad sheet. Every instance obeyed a rule
             that governs sheets one at a time while nothing at all governed
             the sum. Fixing the sum by scaling the amplitude down would have
             thinned the far field too; fixing it here removes only the
             instances that were large enough to be seen as objects. Four
             degrees to thirteen. */
          float halfH = dist / max(projectionMatrix[1][1], 1.0e-4);
          float cover = (iParam.x * 0.5) / max(halfH, 1.0);
          float near = 1.0 - smoothstep(0.08, 0.26, cover);
          float far = 1.0 - smoothstep(uFar * 0.62, uFar, dist);
          float hz = exp(-dist * uHaze * 4.0);
          vAlpha = iParam.z * near * far * uIntensity * (0.45 + 0.55 * hz);

          vUv = uv * 0.5 + iAtlas;
          vTint = iTint;
          vView = -fwd;
          vDist = length(world - cameraPosition);

          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D uMap;
        uniform vec3 uSunDir;
        uniform vec3 uSunColour;
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vAlpha;
        varying vec3 vView;
        varying float vDist;
        #ifdef USE_SOFT_DEPTH
          uniform sampler2D uDepth;
          uniform float uSoft;
          uniform vec2 uResolution;
        #endif
        void main() {
          #include <logdepthbuf_fragment>
          float a = texture2D(uMap, vUv).a * vAlpha;
          #ifdef USE_SOFT_DEPTH
            /* Logarithmic depth: invert log2(1 + w) * logDepthBufFC * 0.5 back
               to view-space w, then fade over uSoft metres of separation. */
            float dz = texture2D(uDepth, gl_FragCoord.xy / uResolution).x;
            float sceneW = exp2(dz * 2.0 / logDepthBufFC) - 1.0;
            a *= smoothstep(0.0, uSoft, sceneW - vDist);
          #endif
          if (a < 0.0015) discard;
          /* Henyey-Greenstein: dust between the camera and the key star glows,
             dust behind it goes dark. This is the whole point of the layer. */
          float mu = dot(vView, uSunDir);
          float g = 0.58;
          float hg = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * mu, 1.0e-4), 1.5);
          vec3 c = vTint * 0.55 + uSunColour * hg * 0.30;
          gl_FragColor = vec4(c * a, a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    mesh.name = 'env:dust';
    engine.scene.add(mesh);

    this._dust = mesh;
    this._dustMat = mat;
    this._disposables.push(geo, mat, tex, base);
  }

  /* ------------------------------------------------------------ asteroids */

  _buildAsteroids() {
    const { engine, sky } = this;
    const r = this.rng.fork(0xa570);
    const b = this.budget;

    /* ---- cluster layout ----

       Not ENV's to decide. SIM adopts these records verbatim as the resource
       field (`sim/spawn.js: resolveResourceClusters`) — the same objects, by
       identity, so miners decrement the very `amount` the rocks fade from — and
       what a seam is worth, how many there are and above all *where the
       contested band sits* are balance, not dressing.

       ENV used to lay out its own field to the same written spec, and the two
       implementations drifted in the one place it mattered. ENV mirrored every
       seam through the origin and called the result symmetric. It is: the two
       starts are also reflections through the origin, so a seam and its twin
       have exactly swapped home distances. That makes the *pair* fair and every
       individual seam lopsided, and `markContested` — rightly — asks whether a
       single seam is equidistant, because a seam you can only hold by being
       nearer to it than your opponent is not no-man's land. Result: a contested
       band on three seeds in eight, no sovereignty clock on the other five, and
       one of the three victory conditions quietly unreachable. SIM's own
       generator, which builds the band as a ring in the plane perpendicularly
       bisecting the two starts, was correct the whole time and never ran.

       So it runs. ENV asks for the field and builds rocks around what it gets.
       There is now one definition and nothing left to drift.

       `separation` is passed through when SIM overrides the default; both
       sides read the same default from `DEFAULT_SETUP` when it does not. */
    const sep = this.options.separation || DEFAULT_SETUP.separation;
    const home = homePosition(0, sep, new THREE.Vector3());
    /* Its own fork. The rock stream below must not shift because the seam
       layout changed shape — and, more to the point, must not silently reshape
       the whole field the next time SIM tunes the economy. */
    const clusters = generateResourceClusters(this.rng.fork(0x5EA3), { separation: sep });
    for (const c of clusters) adoptClusterRecord(c);

    this._clusters = clusters;

    /* Quality buys rock density, not a different map (see QUALITY above), so
       the per-tier instance budget is divided by however many seams SIM asked
       for rather than multiplying a fixed count by them. */
    const rocksPerCluster = Math.max(
      8,
      Math.round((b.rocksPerCluster * b.clusters) / Math.max(1, clusters.length)),
    );

    /* ---- base shapes ----

       Four was not plenty. Per-instance rotation and non-uniform scale hide a
       repeated silhouette in a crowd and stop hiding it the moment two copies
       of the same rock are near each other at similar orientations, which in a
       fourteen-hundred-instance field happens constantly — a reviewer called
       the reuse visible, and it is. Six shapes is 50% more of the only thing
       that actually varies here, at the cost of four instanced draws that are
       only issued when they have something in them. */
    const shapes = 6;
    const [dHigh, dLow] = b.rockDetail;

    /* Rock albedo.

       Real asteroids are charcoal — C-types sit around 0.05 and even the
       bright S-types rarely clear 0.20. An earlier build ran them near #d8d8d8
       and they out-read every capital ship in the frame: two rocks were
       brighter, larger and higher-contrast than the whole fleet. Silhouette
       first (§3.1) means the rocks have to sit *under* the ships tonally, and
       that is an albedo decision, not a lighting one.

       The tint pulled from the sky is kept to a whisper. At 12% the rocks took
       a visible hue from whatever the nebula was doing and stopped reading as
       the same material from seed to seed; charcoal is charcoal. */
    const rockColour = new THREE.Color(0.034, 0.032, 0.029).lerp(sky.palette.body, 0.06);

    /* The shadow side of a rock is nebula-lit, not neutral.

       sky.bounceFill is the sky's own shadow-side colour, normalised to a hue
       by the bake, so this both tints the indirect term and — because it is
       applied as a colour rather than a grey — stops a field of charcoal
       reading as a field of putty. */
    const rockBounce = (sky.bounceFill || sky.fillColour).clone();
    {
      const m = Math.max(rockBounce.r, rockBounce.g, rockBounce.b, 1e-4);
      rockBounce.multiplyScalar(1 / m);
    }

    const material = new THREE.MeshStandardMaterial({
      color: rockColour,
      roughness: 0.95,
      metalness: 0.0,
      // Smooth normals plus a procedural bump, not flat shading. Flat facets on
      // a 320-tri icosahedron read as a low-poly blob at any distance; a bump
      // that scales with the rock's real size reads as rock.
      flatShading: false,
      envMapIntensity: 0.30,
      fog: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uRockBounce = { value: rockBounce };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vRockLocal;
           varying vec3 vRockView;
           varying float vRockSize;
           varying float vRockAo;
           attribute float aAo;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vRockLocal = position;
           vRockAo = aAo;
           /* Metres, recovered from the instance matrix, so surface detail can
              be specified in metres rather than in unit-sphere space. Without
              it a 12 m boulder and a 3 km landmark carry identical craters and
              the field has no sense of scale at all (§3.4). */
           #ifdef USE_INSTANCING
             vRockSize = length(instanceMatrix[0].xyz);
           #else
             vRockSize = 100.0;
           #endif
           /* The instance matrix MUST be applied here.

              three multiplies it in inside <project_vertex>, not
              <begin_vertex>, so 'modelViewMatrix * transformed' is the position
              on the *unit* rock — before any instance scale. The bump below
              divides a height in metres by the screen-space derivative of this
              position, so leaving the instance matrix out made the denominator
              smaller than the numerator's units by exactly the instance scale:
              a factor of ~2,800 on a 2.8 km landmark. The surface gradient
              saturated, every normal was randomised, and the rock came out as
              black-and-white dazzle at pixel frequency no matter what the band
              amplitudes were set to. Two passes of amplitude tuning could not
              fix it because amplitude was never the variable. */
           #ifdef USE_INSTANCING
             vRockView = (modelViewMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
           #else
             vRockView = (modelViewMatrix * vec4(transformed, 1.0)).xyz;
           #endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vRockLocal;
           varying vec3 vRockView;
           varying float vRockSize;
           varying float vRockAo;
           uniform vec3 uRockBounce;
           ${NOISE_GLSL}
           /* A detail band is only worth evaluating while the screen still has
              the pixels to resolve it. The foot argument is the angular
              footprint of one pixel on the unit sphere; once a band's period
              drops below a couple of footprints it is pure aliasing and gets
              faded out. A hand-rolled mip chain for a texture that does not
              exist. (No backticks in here — this string is a JS template
              literal and a stray one silently truncates the shader.) */
           float bandFade(float freq, float foot) {
             return 1.0 - smoothstep(0.22, 0.80, freq * foot);
           }

           /* Relief, in METRES.

              Two things here are load-bearing, and getting either wrong is what
              turned this surface into dazzle camouflage on the last pass.

              1. The height must come out in metres, the same space as
                 vRockView, or the Mikkelsen gradient below is not the gradient
                 of anything. A dimensionless height divided by a view-space
                 determinant scales with 1/size, so the identical field
                 perturbed a 15 m chip an order of magnitude harder than a 3 km
                 landmark — which is exactly why a speckled wall and a smooth
                 grey blob could appear in the same frame and not read as the
                 same material.

              2. Bands are specified by SLOPE, not by amplitude. Lambert sees
                 slope, and a band of amplitude a at angular frequency f has a
                 slope of about a*f whatever the rock's size. Specifying
                 amplitudes let the top band run at three times the slope of
                 the bottom one — every scale shouting at once, at uniform
                 spatial frequency, which is the definition of noise rather
                 than surface. Deriving a = slope/f forces the spectrum to fall
                 as the frequency climbs, so form reads first and grain last. */
           float slopeBand(float slope, float freq) { return slope / freq; }

           /* Basin frequency in cycles per unit sphere, anchored to a real
              wavelength. This is the band that carries the size cue.

              It used to be the constant 2.35, and that is why a 2.8 km
              landmark and a 200 m boulder wore identical speckle: every rock
              got the same number of basins across it whatever its diameter, so
              the only thing distinguishing the two on screen was how many
              pixels they covered. Anchoring the basins at roughly 240 m of
              wavelength gives a chip one smooth hollow and a landmark eight,
              which is the whole of what makes size read. */
           float basinFreq(float radius) { return clamp(radius / 240.0, 1.5, 8.0); }

           float rockRelief(vec3 n, float radius, float foot) {
             /* Basins. The contours of a smooth field, floored and given a low
                rim: round-ish, overlapping, of genuinely different sizes. The
                mesh carries the silhouette; this is what happens inside it, and
                it is deliberately the only band with real amplitude.

                The transfer functions are wide on purpose. A smoothstep
                multiplies the underlying field's gradient by the reciprocal of
                its width, so a band nominally specified at 0.13 of slope came
                out nearer 0.5 and drew a hard black-to-white edge round every
                basin. Wide windows keep the stated slope honest. */
             float fB = basinFreq(radius);
             float b = fbm3e(n * fB + 41.0);
             float basin = smoothstep(0.26, -0.46, b);
             float rim = exp(-(b - 0.24) * (b - 0.24) * 13.0);
             float h = (rim * 0.36 - basin * 0.92) * slopeBand(0.19, fB);

             /* A second, smaller crater population. Real fields are dominated
                by the small end of the size distribution; one band of craters
                all the same size is the giveaway of a procedural surface. */
             float fB2 = fB * 2.7;
             float b2 = fbm3e(n * fB2 + 88.0);
             float basin2 = smoothstep(0.22, -0.40, b2);
             float rim2 = exp(-(b2 - 0.21) * (b2 - 0.21) * 15.0);
             h += (rim2 * 0.34 - basin2 * 0.88) * slopeBand(0.115, fB2) * bandFade(fB2, foot);

             /* Broad undulation between the basins — mass wasting, slumped
                debris, the shallow stuff that gives a terminator something to
                travel across. */
             float fU = clamp(radius / 130.0, 2.2, 13.0);
             h += fbm4e(n * fU) * slopeBand(0.090, fU);

             /* Regolith, anchored at roughly 90 m of real wavelength so a
                landmark and a boulder are not one object at two zoom levels. */
             float fR = clamp(radius / 90.0, 2.0, 30.0);
             h += fbm3e(n * fR + 7.0) * slopeBand(0.050, fR) * bandFade(fR, foot);

             /* Grain, ~11 m. The first band to go and the last you should
                notice; it exists so a close pass has something to resolve. */
             float fG = clamp(radius / 11.0, 8.0, 140.0);
             h += gnoise(n * fG) * slopeBand(0.025, fG) * bandFade(fG, foot);

             return h * radius;
           }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
           {
             /* Tangent-free bump (Mikkelsen): build the surface gradient from
                screen-space derivatives of the height and of the view-space
                position. No tangent attribute, no normal map texture, and it
                costs one height evaluation.

                No fudge factor on the gradient. With the height in metres the
                formula is already exact, and it is exactness that makes the
                detail compress toward a grazing angle and flatten into shadow
                by itself, rather than sitting at the same contrast everywhere
                on the body. */
             vec3 rn = normalize(vRockLocal);
             float bh = rockRelief(rn, vRockSize, length(fwidth(rn)));
             vec3 dpx = dFdx(vRockView);
             vec3 dpy = dFdy(vRockView);
             vec3 rr1 = cross(dpy, normal);
             vec3 rr2 = cross(normal, dpx);
             float det = dot(dpx, rr1);
             if (abs(det) > 1.0e-12) {
               vec3 grad = (rr1 * dFdx(bh) + rr2 * dFdy(bh)) / det;
               normal = normalize(normal - grad);
             }
           }`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
           vec3 rkn3 = normalize(vRockLocal);
           float rkFoot = length(fwidth(rkn3));
           float rkn = fbm3e(rkn3 * 3.6) * 0.5 + 0.5;
           /* Basin floors collect fine, darker, better-sorted regolith and the
              exposed rims are brighter — the one albedo cue on a real airless
              body that is worth having. Reusing the relief field rather than a
              second independent noise is what keeps the colour agreeing with
              the shape instead of fighting it, so this must use the same
              size-anchored frequency the relief does. */
           float rkb = fbm3e(rkn3 * basinFreq(vRockSize) + 41.0);
           float rkFloor = smoothstep(0.06, -0.30, rkb);
           roughnessFactor *= 0.90 + 0.12 * rkn;
           /* Albedo variation stays very narrow. Rock is monotonous: the
              contrast in a real asteroid field comes from the terminator, not
              from patchwork colour, and this band used to be wide enough to
              read as camouflage all on its own. */
           diffuseColor.rgb *= (0.94 + 0.09 * rkn - 0.06 * rkFloor)
                             * (0.62 + 0.38 * vRockAo);`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `/* Indirect light, cut hard and tinted.

              A rock is a 4%-albedo body in vacuum: its shadow side is lit by
              the nebula and by nothing else, and the ratio between the two
              sides is the only thing that says "rock" rather than "putty".
              Measured before this, a boulder's lit side and its shadow side
              were 2.4:1 in *encoded* terms — sRGB compresses a 7:1 linear
              ratio to that — which is why the field read as uniformly mid-grey
              with no terminator and, on the seeds where the key raked away
              from the camera, as near-black with blown specks. The fix is not
              to relight it, it is to stop filling the shadow in.

              ROCK_INDIRECT is applied to the ambient, hemisphere and IBL terms
              only. Direct light from the key is untouched, so the terminator
              gets deeper without the lit side getting darker.

              vRockAo is the per-boulder occlusion from its neighbours, which
              is what gives a heap of rocks contact shading instead of a pile
              of independently-lit spheres. */
           {
             float ind = 0.42 * (0.35 + 0.65 * vRockAo);
             irradiance *= uRockBounce * ind;
             iblIrradiance *= uRockBounce * ind;
           }
           #include <lights_fragment_end>`,
        );
    };
    material.customProgramCacheKey = () => 'env-rock';
    this._rockMaterial = material;
    this._disposables.push(material);

    const totalPerShape = [];
    const perShapeInstances = [];
    for (let s = 0; s < shapes; s++) {
      perShapeInstances.push([]);
      totalPerShape.push(0);
    }

    // Distribute rocks; record which cluster each belongs to so LOD/culling can
    // work on contiguous ranges rather than per-instance.
    const m = new THREE.Matrix4();
    const qt = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const pos = new THREE.Vector3();

    /* A home seam sits 3.6–5.2 km out and the camera opens 4.6 km from the
       hull, so without this the opening shell passes straight through the
       field and the first frame is a boulder across the lens. The cluster
       record SIM reads is untouched — only the visible rocks move — so this
       costs nothing in economy terms. */
    /* True when the rock is not sitting on the sphere the camera opens on,
       around either start. */
    const mirrorHome = home.clone().negate();
    const clearOfShell = (p, radius) => {
      const gap = radius + SHELL_GAP;
      return (
        Math.abs(p.distanceTo(home) - OPENING_SHELL) > gap &&
        Math.abs(p.distanceTo(mirrorHome) - OPENING_SHELL) > gap
      );
    };

    for (let ci = 0; ci < clusters.length; ci++) {
      const c = clusters[ci];
      /* Everything already placed in this seam, so a new rock can be tested
         against it twice: once to stop it being buried inside a neighbour, and
         once afterwards to work out how much sky its neighbours take away. */
      const near = [];
      for (let i = 0; i < rocksPerCluster; i++) {
        const s = r.int(0, shapes - 1);
        /* Four size classes, drawn from explicitly rather than from one power
           curve.

           `pow(random, 3) * 430 + 11` is a smooth distribution and that is
           exactly its problem: it produces a continuum with no gaps, and a
           continuum of sizes reads as texture rather than as scale. Nothing in
           it is decisively bigger than anything else, so a 380 m destroyer
           flying through it has nothing to be measured against — which is the
           whole job the field is here to do (section 3.4) and the reason the
           reviewer read the rocks as one size class.

           Discrete classes with real gaps between them give the eye something
           to count. The monoliths are the point of the exercise: at 400-950 m
           roughly eight per seam are frigate-to-cruiser sized, so a capital
           passing one is unmistakably a capital. The grit at the bottom exists
           for the close pass and costs nothing at range, where the LOD and the
           seam fill already thin it out. */
        const cls = r.next();
        const size =
          cls < 0.34 ? r.range(9, 28)
          : cls < 0.68 ? r.range(32, 110)
          : cls < 0.94 ? r.range(130, 340)
          : r.range(400, 950);
        scl.set(size * r.range(0.7, 1.25), size * r.range(0.6, 1.1), size * r.range(0.75, 1.3));
        const bound = Math.max(scl.x, scl.y, scl.z);
        let placed = false;
        for (let attempt = 0; attempt < 6 && !placed; attempt++) {
          const dir = r.unitVector();
          const rr = c.radius * Math.cbrt(r.next()) * r.range(0.75, 1.15);
          pos.set(c.position.x + dir.x * rr, c.position.y + dir.y * rr * 0.55, c.position.z + dir.z * rr);
          placed = clearOfStarts(pos, bound, sep, SEAM_ANGLE) && clearOfShell(pos, bound);
          /* Rocks were free to sit inside one another, and at close range the
             intersection curve of two ellipsoids is a hard, obviously-analytic
             line across both of them. Half the sum of the bounds still allows
             a natural-looking overlap of contact and rubble without letting
             one boulder disappear into the next. */
          if (!placed) continue;
          for (let j = 0; j < near.length; j++) {
            const o = near[j];
            const dx = pos.x - o.x, dy = pos.y - o.y, dz = pos.z - o.z;
            const min = (bound + o.r) * 0.5;
            if (dx * dx + dy * dy + dz * dz < min * min) { placed = false; break; }
          }
        }
        // A rock that will not clear the opening shell is simply not drawn:
        // 140 per cluster means one fewer is invisible, and a rock in the lens
        // is not.
        if (!placed) continue;
        qt.set(r.gaussian(), r.gaussian(), r.gaussian(), r.gaussian()).normalize();
        m.compose(pos, qt, scl);
        // Narrow: rock is monotonous, and a wide per-instance tint reads as
        // putty rather than as a field of the same material.
        const tint = r.range(0.78, 1.22);
        const rec = { cluster: ci, matrix: m.clone(), tint, ao: 1, x: pos.x, y: pos.y, z: pos.z, r: bound };
        near.push(rec);
        perShapeInstances[s].push(rec);
        totalPerShape[s]++;
      }

      /* Per-boulder ambient occlusion, as an instance attribute.

         Without it a heap of rocks is a set of independently-lit spheres that
         happen to overlap: nothing darkens where two of them meet, so the
         crevices between boulders are as bright as the outsides and the heap
         reads as one flat mass. This is the cheapest honest approximation —
         the solid angle a neighbour subtends, summed — computed once at build
         and shipped as a float per instance. O(n^2) inside a seam is 140^2,
         which is nothing at load and saves a shadow map that §0 does not want.

         The term must be a real solid angle, not a proximity score. A sphere of
         radius R at distance d covers about R^2/(4 d^2) of the sky, and the
         first version left off the quarter and searched out to four times the
         summed radii — which in a 1.5 km seam is the whole seam. Every rock
         came back pinned at the 0.2 floor, so the field was uniformly darkened
         rather than shaded, which is the same mistake as having no AO at all
         with a brightness penalty attached.

         Occlusion is applied to the indirect term and a little to albedo, never
         to direct light: the key already does its own occlusion by facing
         away. */
      for (let i = 0; i < near.length; i++) {
        const a = near[i];
        let occ = 0;
        for (let j = 0; j < near.length; j++) {
          if (j === i) continue;
          const o = near[j];
          const dx = a.x - o.x, dy = a.y - o.y, dz = a.z - o.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          const reach = (a.r + o.r) * 3;
          if (d2 > reach * reach || d2 < 1) continue;
          occ += 0.25 * Math.min(1, (o.r * o.r) / d2);
        }
        a.ao = Math.max(0.35, 1 / (1 + occ * 1.0));
      }
    }

    const fieldCentre = new THREE.Vector3();
    for (const c of clusters) fieldCentre.add(c.position);
    fieldCentre.multiplyScalar(1 / Math.max(1, clusters.length));
    this._fieldCentre = fieldCentre;

    for (let s = 0; s < shapes; s++) {
      const list = perShapeInstances[s];
      if (!list.length) continue;
      // Group by cluster so each cluster is a contiguous run.
      list.sort((a, bb) => a.cluster - bb.cluster);
      const ranges = [];
      let start = 0;
      for (let ci = 0; ci < clusters.length; ci++) {
        let n = 0;
        while (start + n < list.length && list[start + n].cluster === ci) n++;
        ranges.push({ start, count: n });
        start += n;
      }

      const matrices = new Float32Array(list.length * 16);
      const colours = new Float32Array(list.length * 3);
      const aos = new Float32Array(list.length);
      for (let i = 0; i < list.length; i++) {
        list[i].matrix.toArray(matrices, i * 16);
        const t = list[i].tint;
        colours[i * 3] = t;
        colours[i * 3 + 1] = t * 0.985;
        colours[i * 3 + 2] = t * 0.96;
        aos[i] = list[i].ao;
      }

      const geoHigh = makeRockGeometry(r.fork(1000 + s), dHigh);
      const geoLow = makeRockGeometry(r.fork(1000 + s), dLow, geoHigh.userData.shape);

      const meshHigh = new THREE.InstancedMesh(geoHigh, material, list.length);
      const meshLow = new THREE.InstancedMesh(geoLow, material, list.length);
      const aoAttribs = [];
      for (const mesh of [meshHigh, meshLow]) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        /* The LOD pass repacks instances between the two meshes every time the
           camera crosses a distance band, so the occlusion attribute has to
           travel with the matrix rather than being indexed by slot. It lives on
           the geometry because that is the only place an instanced attribute
           can live, and each LOD level has its own geometry. */
        const ao = new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1);
        ao.setUsage(THREE.DynamicDrawUsage);
        mesh.geometry.setAttribute('aAo', ao);
        aoAttribs.push(ao);
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.visible = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.name = 'env:rocks';
        engine.scene.add(mesh);
      }

      this._rockSets.push({
        high: meshHigh, low: meshLow, matrices, colours, aos, ranges,
        aoHigh: aoAttribs[0], aoLow: aoAttribs[1],
      });
      this._disposables.push(geoHigh, geoLow);
    }

    /* ---- landmarks: a handful of genuinely multi-kilometre rocks. Nothing
       sells the scale of a 380 m destroyer like parking it beside a 3 km one,
       and nothing else in the near field is big enough to do that job.

       They are also, by a distance, the easiest thing in this file to ruin the
       game's single most important frame with. Placed only relative to a
       cluster, a landmark could and did land on top of a mothership: measured
       across four seeds the opening camera sat 3.5 km *inside* one on two of
       them, which is what produced the hard diagonal edge and the flat grey
       veil across half the first frame — the near plane slicing a rock the
       player is standing in — and on another seed one of these covered the
       production panel.

       A scalar clearance does not fix that, because the thing that matters is
       how much of the sky the rock covers, not how far away it is: at 2.7 km a
       2 km rock still fills the frame. So the test is the angle it subtends
       from the opening camera shell around each start, and it is applied to
       both starts because the field is mirrored. ---- */
    const lmCount = b.landmarks;
    /* Every landmark used to be the same rock.

       They shared one geometry from `r.fork(77)`, so the two-to-six largest
       and most photographed objects in the near field were literally one model
       at different scales and orientations — the single most visible instance
       of the reuse the reviewer picked up, because these are the things big
       enough for a silhouette to be memorised. Three shapes over at most six
       landmarks means no two neighbours need be twins, and it costs two
       instanced draws that are frustum-culled like the original. */
    const lmShapes = Math.max(1, Math.min(3, lmCount));
    const perShape = [];
    for (let s = 0; s < lmShapes; s++) perShape.push([]);
    for (let i = 0; i < lmCount; i++) {
      // Mirror them in pairs too — a 3 km landmark is cover, and cover on one
      // side of the map only is not a fair map.
      const c = clusters[(i * 2) % clusters.length];
      const size = r.range(900, 1900);
      scl.set(size * r.range(0.85, 1.2), size * r.range(0.6, 0.95), size * r.range(0.85, 1.3));
      const bound = Math.max(scl.x, scl.y, scl.z);
      const dir = r.unitVector();
      const rr = c.radius * r.range(1.2, 2.4) + bound * 1.4;
      pos.set(c.position.x + dir.x * rr, c.position.y + dir.y * rr * 0.4, c.position.z + dir.z * rr);
      if (i % 2 === 1) pos.negate();
      // Opaque, so the strict angle — you fly through ore, not through a monolith.
      clearOpening(pos, bound, sep, OPENING_ANGLE);
      qt.set(r.gaussian(), r.gaussian(), r.gaussian(), r.gaussian()).normalize();
      m.compose(pos, qt, scl);
      const t = r.range(0.86, 1.12);
      perShape[i % lmShapes].push({ matrix: m.clone(), tint: t });
    }

    this._landmarks = [];
    for (let s = 0; s < lmShapes; s++) {
      const list = perShape[s];
      if (!list.length) continue;
      const geo = makeRockGeometry(r.fork(77 + s * 31), Math.min(5, dHigh + 2));
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
      /* Landmarks share the rock material, so they must carry the occlusion
         attribute or it defaults to zero and every one of them renders black.
         They sit outside their seam by construction, so they are barely
         occluded. */
      const ao = new Float32Array(list.length);
      ao.fill(0.92);
      geo.setAttribute('aAo', new THREE.InstancedBufferAttribute(ao, 1));
      for (let i = 0; i < list.length; i++) {
        mesh.setMatrixAt(i, list[i].matrix);
        const t = list[i].tint;
        mesh.setColorAt(i, new THREE.Color(t, t * 0.985, t * 0.955));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = true;
      mesh.name = 'env:landmarks';
      engine.scene.add(mesh);
      this._landmarks.push(mesh);
      this._disposables.push(geo);
    }
  }

  /** Live cluster records. SIM may decrement `amount` in place. */
  get resourceClusters() {
    return this._clusters;
  }

  /* ------------------------------------------------------------ derelicts */

  _buildDerelicts() {
    const { engine, sky } = this;
    const r = this.rng.fork(0xdead);
    const count = this.budget.derelicts;
    if (!count) return;

    const geo = makeDerelictGeometry(r);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.040, 0.039, 0.038).lerp(sky.fillColour, 0.14),
      roughness: 0.88,
      metalness: 0.28,
      flatShading: true,
      envMapIntensity: 0.7,
      fog: true,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    /* Derelicts are placed on a ring about the origin, which says nothing
       about where the motherships are — one landed 756 m from the opening
       camera and filled 66 degrees of the first frame. Same treatment as the
       rocks; a dead hull is dressing and can go wherever it needs to. */
    const sep = this.options.separation || 22000;
    for (let i = 0; i < count; i++) {
      const ang = r.range(0, Math.PI * 2);
      const rad = r.range(9000, 30000);
      p.set(Math.cos(ang) * rad, r.gaussian(0, 3200), Math.sin(ang) * rad);
      q.set(r.gaussian(), r.gaussian(), r.gaussian(), r.gaussian()).normalize();
      const len = r.range(240, 1500);
      s.set(len, len, len);
      // The hull spans roughly 1.2 local units end to end, so 0.6 is its radius.
      clearOpening(p, len * 0.6, sep, OPENING_ANGLE);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      const t = 0.65 + r.range(0, 0.5);
      mesh.setColorAt(i, new THREE.Color(t, t * 0.98, t * 0.95));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.name = 'env:derelicts';
    engine.scene.add(mesh);
    this._derelicts = mesh;
    this._disposables.push(geo, mat);
  }

  /* --------------------------------------------------------------- update */

  update(dt, elapsed, camera) {
    this._time = elapsed;
    const cam = camera || this.engine.camera;

    /* The sky hands back a half-size map immediately and fills the full-size
       one from here, a tile per frame. Two references have to follow it when
       it swaps: the backdrop and the environment probe. */
    if (this.sky.refine && !this.sky.refined) {
      if (this.sky.refine(this.engine.renderer, 1)) {
        this.engine.farScene.background = this.sky.texture;
        this.engine.scene.environment = this.sky.texture;
      }
    }

    if (this._dustMat) this._dustMat.uniforms.uTime.value = elapsed;

    if (this._seams) {
      this._seams.vol.material.uniforms.uTime.value = elapsed;
      this._seams.ring.material.uniforms.uTime.value = elapsed;
      this._updateSeams(false);
    }

    // The gas giant turns; slowly enough that it reads as scale, not motion.
    if (this._planetGroup) {
      this._planetGroup.rotation.y += dt * 0.0022;
      if (this._planetMat) {
        /* The ring shadow is traced in the planet's own frame, so the light
           has to be re-expressed there every time the planet moves under it. */
        this._planetGroup.updateMatrixWorld();
        this._planetMat.uniforms.uSunLocal.value
          .copy(this.sunDirection)
          .applyQuaternion(_invQ.copy(this._planetGroup.quaternion).invert())
          .normalize();
      }
    }

    this._lodTimer -= dt;
    if (this._lodTimer <= 0 && cam) {
      this._lodTimer = 0.2;
      this._refreshRockLod(cam);
    }
  }

  _refreshRockLod(camera) {
    const clusters = this._clusters;
    if (!clusters.length || !this._rockSets.length) return;

    const cp = camera.position;
    let key = '';
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const d = this._tmpV.copy(c.position).sub(cp).length();
      c._visible = d < 42000 + c.radius;
      c._high = d < 9000 + c.radius * 3;
      /* Seams thin out as they are mined. SIM decrements `amount` on these
         very records — they are adopted in place, not copied — so the field
         can show its own state instead of a worked-out seam looking untouched
         for the whole match. Quantised to sixteenths so this rebuilds the
         instance buffers a handful of times over a seam's life rather than
         every time a collector delivers. */
      const frac = c.maxAmount > 0 ? Math.max(0, Math.min(1, c.amount / c.maxAmount)) : 1;
      c._fill = Math.round(frac * 16) / 16;
      key += c._visible ? (c._high ? 'H' : 'L') + c._fill.toFixed(2) : '-';
    }
    if (key === this._lodKey) return;
    this._lodKey = key;

    for (const set of this._rockSets) {
      let nH = 0;
      let nL = 0;
      const hM = set.high.instanceMatrix.array;
      const lM = set.low.instanceMatrix.array;
      const hC = set.high.instanceColor.array;
      const lC = set.low.instanceColor.array;
      const hA = set.aoHigh.array;
      const lA = set.aoLow.array;
      for (let ci = 0; ci < clusters.length; ci++) {
        const c = clusters[ci];
        if (!c._visible) continue;
        const range = set.ranges[ci];
        if (!range || !range.count) continue;
        /* A worked-out seam keeps a floor of rubble rather than vanishing:
           the ore is gone, the rock is not, and an empty patch of space where
           a landmark used to be would read as a culling bug. */
        const shown = Math.max(
          range.count > 0 ? 1 : 0,
          Math.ceil(range.count * (0.22 + 0.78 * (c._fill === undefined ? 1 : c._fill))),
        );
        const n = Math.min(range.count, shown);
        const mSlice = set.matrices.subarray(range.start * 16, (range.start + n) * 16);
        const cSlice = set.colours.subarray(range.start * 3, (range.start + n) * 3);
        const aSlice = set.aos.subarray(range.start, range.start + n);
        if (c._high) {
          hM.set(mSlice, nH * 16);
          hC.set(cSlice, nH * 3);
          hA.set(aSlice, nH);
          nH += n;
        } else {
          lM.set(mSlice, nL * 16);
          lC.set(cSlice, nL * 3);
          lA.set(aSlice, nL);
          nL += n;
        }
      }
      set.high.count = nH;
      set.low.count = nL;
      set.high.visible = nH > 0;
      set.low.visible = nL > 0;
      set.high.instanceMatrix.needsUpdate = true;
      set.low.instanceMatrix.needsUpdate = true;
      set.high.instanceColor.needsUpdate = true;
      set.low.instanceColor.needsUpdate = true;
      set.aoHigh.needsUpdate = true;
      set.aoLow.needsUpdate = true;
    }
  }

  /**
   * Opt-in soft particles. POSTFX owns the scene depth buffer; if it hands one
   * over, the dust fades where it intersects a hull instead of cutting against
   * it. Until then the sheets rely on low per-sheet alpha, which hides the cut
   * well enough that this is a refinement rather than a requirement.
   *
   * @param {THREE.DepthTexture|null} texture  depth attachment of the scene pass
   * @param {number} [softness]                fade distance in metres
   */
  setDepthTexture(texture, softness = 900) {
    if (!this._dustMat) return;
    const mat = this._dustMat;
    mat.uniforms.uDepth.value = texture || null;
    mat.uniforms.uSoft.value = softness;
    const want = texture ? '' : null;
    const has = mat.defines.USE_SOFT_DEPTH !== undefined;
    if (texture && !has) {
      mat.defines.USE_SOFT_DEPTH = want;
      mat.needsUpdate = true;
    } else if (!texture && has) {
      delete mat.defines.USE_SOFT_DEPTH;
      mat.needsUpdate = true;
    }
  }

  /** Keep the soft-particle pass in step with the render target size. */
  setResolution(w, h) {
    if (this._dustMat) this._dustMat.uniforms.uResolution.value.set(w, h);
  }

  /* -------------------------------------------------------------- dispose */

  dispose() {
    const { engine } = this;

    if (this._offReady) {
      this._offReady();
      this._offReady = null;
    }
    /* The rotation lives on the scenes, not on anything ENV owns, so it has to
       be put back or the next match inherits this one's composition. */
    engine.farScene.backgroundRotation.set(0, 0, 0);
    engine.scene.environmentRotation.set(0, 0, 0);

    const loose = [this._dust, this._derelicts];
    if (this._seams) loose.push(this._seams.vol, this._seams.ring);
    for (const m of loose.concat(this._landmarks || [])) {
      if (m && m.parent) m.parent.remove(m);
    }
    for (const m of this._landmarks || []) m.dispose();
    this._landmarks = [];
    this._seams = null;
    for (const set of this._rockSets) {
      if (set.high.parent) set.high.parent.remove(set.high);
      if (set.low.parent) set.low.parent.remove(set.low);
      set.high.dispose();
      set.low.dispose();
    }
    if (this._derelicts) this._derelicts.dispose();
    this._rockSets.length = 0;

    for (const l of this._lights) {
      if (l.target && l.target.parent) l.target.parent.remove(l.target);
      if (l.parent) l.parent.remove(l);
      if (l.dispose) l.dispose();
    }
    this._lights.length = 0;

    if (this._planetGroup && this._planetGroup.parent) this._planetGroup.parent.remove(this._planetGroup);
    if (this._moon && this._moon.parent) this._moon.parent.remove(this._moon);
    if (this._star && this._star.parent) this._star.parent.remove(this._star);
    // The star field's geometry and material belong to the sky; sky.dispose()
    // detaches and frees them. Only the parenting is ENV's to undo here.
    if (this.sky.starField && this.sky.starField.parent) {
      this.sky.starField.parent.remove(this.sky.starField);
    }

    for (const d of this._disposables) {
      if (d && d.dispose) d.dispose();
    }
    this._disposables.length = 0;

    engine.farScene.background = null;
    engine.scene.environment = null;
    if (engine.scene.fog === this.fog) engine.scene.fog = null;
    this.sky.dispose();
  }
}

/* ===========================================================================
   Procedural geometry helpers
   =========================================================================== */

/** Add ENV's render state to one of SIM's seam records.

    The record stays SIM's — position, radius and ore are its numbers, and it
    decrements `amount` in place as miners work the seam. All ENV keeps here is
    what it needs to draw it: culling, LOD tier and how much rock is left. */
function adoptClusterRecord(c) {
  c.amount = Math.round(c.amount);
  c.maxAmount = Math.round(c.maxAmount);
  c._visible = true;
  c._high = true;
  c._fill = 1;
  return c;
}

/** Deformed icosahedron: fBm lumps, ridged crags, a few impact craters. */
function makeRockGeometry(rng, detail, sharedShape) {
  const shape =
    sharedShape ||
    (() => {
      const craters = [];
      const nc = rng.int(2, 5);
      for (let i = 0; i < nc; i++) {
        const d = rng.unitVector();
        craters.push({
          x: d.x,
          y: d.y,
          z: d.z,
          cos: Math.cos(rng.range(0.25, 0.75)),
          depth: rng.range(0.10, 0.26),
        });
      }
      return {
        off: [rng.range(-30, 30), rng.range(-30, 30), rng.range(-30, 30)],
        axis: [rng.range(0.58, 1.18), rng.range(0.42, 0.92), rng.range(0.66, 1.30)],
        lump: rng.range(0.22, 0.40),
        crag: rng.range(0.07, 0.17),
        freq: rng.range(1.6, 2.6),
        craters,
      };
    })();

  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const px = v.x * shape.freq + shape.off[0];
    const py = v.y * shape.freq + shape.off[1];
    const pz = v.z * shape.freq + shape.off[2];
    let h = 1 + fbm3(px, py, pz, 4) * shape.lump;
    h += (ridged3(px * 2.3, py * 2.3, pz * 2.3, 3) - 0.5) * shape.crag;
    for (const c of shape.craters) {
      const dp = v.x * c.x + v.y * c.y + v.z * c.z;
      if (dp <= c.cos) continue;
      const t = (dp - c.cos) / (1 - c.cos); // 0 at rim, 1 at centre
      const u = Math.sqrt(t);
      h += c.depth * (0.30 * Math.exp(-Math.pow((u - 0.10) / 0.16, 2)) - 0.95 * u * u);
    }
    h = Math.max(0.35, h);
    pos.setXYZ(i, v.x * h * shape.axis[0], v.y * h * shape.axis[1], v.z * h * shape.axis[2]);
  }
  smoothNormals(geo);
  geo.computeBoundingSphere();
  geo.userData.shape = shape;
  return geo;
}

/* `IcosahedronGeometry` is a `PolyhedronGeometry`, and those are non-indexed:
   every triangle carries its own three vertices. `computeVertexNormals()` on
   one therefore produces *flat* normals however `flatShading` is set, and a
   1,280-face rock filling the screen shows every one of its facets — polygon
   edges across the silhouette and a visible crease inside it. That reads as
   low-poly, which is one of the loudest "browser demo" tells there is.

   Welding by position is safe here because the shared corners of a polyhedron
   are computed from the same source values and displaced by the same pure
   function of them, so the duplicates are bit-identical rather than merely
   close. Quantising guards the case where they are not. */
function smoothNormals(geo) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const acc = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key =
      Math.round(pos.getX(i) * 4096) + ',' +
      Math.round(pos.getY(i) * 4096) + ',' +
      Math.round(pos.getZ(i) * 4096);
    let e = acc.get(key);
    if (!e) acc.set(key, (e = [0, 0, 0]));
    e[0] += nrm.getX(i);
    e[1] += nrm.getY(i);
    e[2] += nrm.getZ(i);
  }
  for (let i = 0; i < pos.count; i++) {
    const key =
      Math.round(pos.getX(i) * 4096) + ',' +
      Math.round(pos.getY(i) * 4096) + ',' +
      Math.round(pos.getZ(i) * 4096);
    const e = acc.get(key);
    const l = Math.hypot(e[0], e[1], e[2]) || 1;
    nrm.setXYZ(i, e[0] / l, e[1] / l, e[2] / l);
  }
  nrm.needsUpdate = true;
}

/** A dead hull: a spine, a few blocks, a broken-off section. Silhouette only. */
function makeDerelictGeometry(rng) {
  const parts = [];
  const push = (w, h, d, x, y, z, rx, ry, rz) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    parts.push(g);
  };

  push(0.16, 0.13, 1.0, 0, 0, 0, 0, 0, 0);
  push(0.28, 0.09, 0.30, 0, 0.02, rng.range(-0.20, 0.05), 0, 0, rng.range(-0.1, 0.1));
  push(0.10, 0.22, 0.22, 0, 0.10, rng.range(0.10, 0.30), rng.range(-0.2, 0.2), 0, 0);
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) {
    push(
      rng.range(0.05, 0.14),
      rng.range(0.05, 0.12),
      rng.range(0.08, 0.26),
      rng.range(-0.13, 0.13),
      rng.range(-0.09, 0.09),
      rng.range(-0.45, 0.45),
      rng.range(-0.3, 0.3),
      rng.range(-0.3, 0.3),
      rng.range(-0.3, 0.3),
    );
  }
  // A torn-off tail, tumbling separately in the same instance.
  push(0.11, 0.09, 0.22, rng.range(-0.25, 0.25), rng.range(-0.1, 0.1), rng.range(0.55, 0.85),
    rng.range(-0.6, 0.6), rng.range(-0.6, 0.6), rng.range(-0.6, 0.6));

  // Merge by hand — no addon dependency, and these are all plain non-indexed
  // box geometries once their indices are expanded.
  let total = 0;
  const expanded = parts.map((g) => {
    const ng = g.toNonIndexed();
    g.dispose();
    total += ng.attributes.position.count;
    return ng;
  });
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  let o = 0;
  for (const g of expanded) {
    position.set(g.attributes.position.array, o * 3);
    normal.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.computeBoundingSphere();
  return out;
}

/** 2x2 atlas of soft, wispy dust puffs. Alpha only; colour comes per instance.

   Two things here are load-bearing and easy to get wrong:

   1. Every cell must reach *exactly* zero alpha at its border. An elliptical
      falloff alone does not: with `stretch < 1` the radial term is still
      positive where the cell is cut off, and the quad's own rectangle becomes
      visible as a hard edge across the sky. A separable border window fixes it
      independently of the ellipse.
   2. The mip chain must be generated per cell, not over the whole atlas.
      Averaging across the atlas seam smears neighbouring cells together, and
      by the coarse mips the sheet is a uniform grey rectangle — which is what
      a big distant dust sheet samples. We build the chain by hand so no filter
      tap ever crosses a cell boundary. */
function makeDustTexture(rng, size = 256) {
  const half = size >> 1;
  const cells = [];

  for (let cell = 0; cell < 4; cell++) {
    const nx = rng.range(-40, 40);
    const ny = rng.range(-40, 40);
    const warpScale = rng.range(2.2, 4.0);
    const stretch = rng.range(0.7, 1.5);
    const cellData = new Float32Array(half * half);

    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        // Cell-local coordinates in [-1,1]. `vs` is the stretched copy used for
        // the ellipse; the raw pair drives the border window.
        const u = (x / half) * 2 - 1;
        const v = (y / half) * 2 - 1;
        const vs = v * stretch;
        const rr = Math.sqrt(u * u + vs * vs);

        let a = Math.max(0, 1 - rr);
        a = a * a * (3 - 2 * a);
        const n = fbm2(u * warpScale + nx, vs * warpScale + ny, 5) * 0.5 + 0.5;
        const n2 = fbm2(u * warpScale * 3.1 + nx * 1.7, vs * warpScale * 3.1 + ny * 1.3, 3) * 0.5 + 0.5;
        a *= 0.20 + 1.15 * n * (0.55 + 0.45 * n2);

        // Separable border window — guarantees a hard zero at the cell edge.
        a *= (1 - smoothstep01(0.80, 1.0, Math.abs(u))) * (1 - smoothstep01(0.80, 1.0, Math.abs(v)));

        cellData[y * half + x] = Math.max(0, Math.min(1, a));
      }
    }
    cells.push(cellData);
  }

  /** Pack four equally-sized cell buffers into one RGBA atlas level. */
  const packLevel = (cellBufs, cellSize) => {
    const dim = cellSize * 2;
    const out = new Uint8Array(dim * dim * 4);
    for (let c = 0; c < 4; c++) {
      const ox = (c % 2) * cellSize;
      const oy = (c >> 1) * cellSize;
      const buf = cellBufs[c];
      for (let y = 0; y < cellSize; y++) {
        for (let x = 0; x < cellSize; x++) {
          const idx = ((oy + y) * dim + (ox + x)) * 4;
          out[idx] = 255;
          out[idx + 1] = 255;
          out[idx + 2] = 255;
          out[idx + 3] = Math.round(buf[y * cellSize + x] * 255);
        }
      }
    }
    return out;
  };

  /** Box-downsample a single cell. Taps never leave the cell. */
  const halveCell = (buf, cellSize) => {
    const n = cellSize >> 1;
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const s = y * 2 * cellSize + x * 2;
        out[y * n + x] = (buf[s] + buf[s + 1] + buf[s + cellSize] + buf[s + cellSize + 1]) * 0.25;
      }
    }
    return out;
  };

  const tex = new THREE.DataTexture(packLevel(cells, half), size, size, THREE.RGBAFormat);

  // Hand-built mip chain, cell-isolated all the way down to 1px per cell.
  const mips = [];
  let cur = cells;
  let curSize = half;
  while (curSize > 1) {
    cur = cur.map((b) => halveCell(b, curSize));
    curSize >>= 1;
    mips.push({ data: packLevel(cur, curSize), width: curSize * 2, height: curSize * 2 });
  }
  tex.mipmaps = mips;

  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'env:dust';
  return tex;
}

/** Scalar smoothstep — the CPU twin of the GLSL builtin. */
function smoothstep01(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
