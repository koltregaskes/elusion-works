import * as THREE from '../../vendor/three/build/three.module.js';
import { LAYER } from '../core/engine.js';
import { makeRng, fbm2, fbm3, ridged3 } from '../core/rng.js';
import { buildSkybox } from './skybox.js';
import { setNebulaBounce } from './materials.js';

/* Everything that is not a ship.

   Two scenes are populated. `engine.farScene` gets the backdrop — the baked
   nebula cubemap, the key star's disc, a gas giant and its moon — all of it at
   10^7..10^9 metres, drawn by a camera that only ever rotates. `engine.scene`
   gets the near field: the lights, drifting dust sheets, asteroid fields and
   the depth haze that makes kilometres read as kilometres.

   The backdrop is the game's identity. It is also, deliberately, mostly empty:
   the nebula occupies one part of the sky, the star another, the planet a
   third, and the rest is black. Emptiness is the subject. */

/* Cluster counts are rounded up to an even number in `_buildAsteroids`: the
   field is mirrored through the origin, so seams always come in pairs. */
const QUALITY = {
  low: { clusters: 6, rocksPerCluster: 45, dust: 70, derelicts: 0, landmarks: 2, rockDetail: [1, 0] },
  medium: { clusters: 8, rocksPerCluster: 90, dust: 140, derelicts: 10, landmarks: 4, rockDetail: [2, 1] },
  high: { clusters: 10, rocksPerCluster: 140, dust: 230, derelicts: 14, landmarks: 6, rockDetail: [3, 1] },
  ultra: { clusters: 12, rocksPerCluster: 190, dust: 320, derelicts: 18, landmarks: 6, rockDetail: [3, 2] },
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
    this._time = 0;
    this._lodTimer = 0;
    this._lodKey = '';

    this._tmpV = new THREE.Vector3();

    const r = this.rng;

    /* --- geometry of the system: where the star, the planet and the nebula
       sit relative to one another. Chosen before anything is built so the
       lighting, the visible star and the planet's terminator all agree. --- */
    const sunFrom = new THREE.Vector3(
      r.gaussian(0, 1),
      r.gaussian(0, 0.55),
      r.gaussian(0, 1),
    ).normalize();
    if (Math.abs(sunFrom.y) < 0.10) sunFrom.y += 0.14 * (sunFrom.y >= 0 ? 1 : -1);
    sunFrom.normalize();
    this.sunDirection = sunFrom.clone(); // from the battle *toward* the star

    this._buildSky();
    this._buildLights();
    this._buildStar();
    this._buildPlanet();
    this._buildDust();
    this._buildAsteroids();
    this._buildDerelicts();
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

    /* The sky is also the environment probe. Hulls pick up a nebula-coloured
       bounce on their shadow side for free, which is exactly the "cold fill
       from the nebula" the visual direction asks for.

       Kept deliberately low. An IBL from a sky this saturated is an
       omnidirectional light, and omnidirectional light is precisely what
       destroys a terminator. The nebula's job is to tint the shadow side, not
       to fill it in. */
    engine.scene.environment = this.sky.texture;
    engine.scene.environmentIntensity =
      this.options.environmentIntensity !== undefined ? this.options.environmentIntensity : 0.16;

    /* Depth haze. Deliberately a very dark, nebula-tinted colour: fog that
       tends toward grey turns the void into soup, fog that tends toward a dark
       tint just bleeds contrast out of things that are kilometres away. */
    const fogColour = this.sky.fillColour.clone().multiplyScalar(0.085);
    fogColour.lerp(this.sky.nebulaColour, 0.25).multiplyScalar(0.85);
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
       what colour the sky behind it is; a bright one repaints the fleet. */
    const keyColour = sky.keyColour.clone();
    const key = new THREE.DirectionalLight(keyColour, this.options.keyIntensity || 4.6);
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
      this.options.fillIntensity || 0.19,
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

    const amb = new THREE.AmbientLight(sky.ambientColour.clone(), 0.022);
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
        this.options.hullAmbient !== undefined ? this.options.hullAmbient : 0.085,
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

    // Angular diameter 17..27 degrees. Big enough to be the scale cue, small
    // enough that the void still dominates the frame.
    const angular = r.range(0.30, 0.47);
    const radius = r.range(5.2e7, 8.4e7);
    const dist = radius / Math.tan(angular * 0.5);

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

          /* Hard terminator with a couple of degrees of atmospheric wrap, then
             a night side that is genuinely night: a gas giant with no moonlight
             is lit only by whatever the nebula throws at it. */
          float lit = smoothstep(-0.075, 0.085, ndl);
          float shade = lit * (0.10 + 0.90 * clamp(ndl, 0.0, 1.0));
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

          vec3 col = albedo * uSunColour * shade * ringShade * ${num(r.range(1.7, 2.3))};
          col += albedo * uFill * 0.085;             // nebula bounce, night side included
          col += uFill * 0.010;

          /* Twilight: the last couple of degrees before the terminator run
             through the atmosphere at a grazing angle, so they redden. Without
             this the terminator is a clean arc and reads as a stencil. */
          float twi = lit * (1.0 - smoothstep(0.0, 0.30, ndl));
          col += albedo * ATMO.zyx * twi * 0.28;

          /* Thin atmospheric limb over the disc — forward-scattering haze that
             only shows where the air is edge-on *and* lit. Past the terminator
             it must go to zero, or the glow wraps the unlit limb and the whole
             thing reads as a sprite behind a ball. */
          float rim = pow(1.0 - ndv, 3.4);
          col += ATMO * rim * smoothstep(-0.04, 0.34, ndl) * 0.62;

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
            float alpha = clamp(dens * (0.50 + 0.50 * phase), 0.0, 1.0) * 0.70;
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
            float lit = smoothstep(-0.06, 0.09, ndl) * (0.18 + 0.82 * clamp(ndl, 0.0, 1.0));
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

      const size = r.range(1400, 6200) * (r.chance(0.16) ? 1.9 : 1);
      iParam[n * 4] = size;
      iParam[n * 4 + 1] = r.range(0, Math.PI * 2);
      iParam[n * 4 + 2] = r.range(0.020, 0.070) * (size > 8000 ? 0.55 : 1);
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

          /* No depth buffer to soften against, so fade a sheet out before the
             camera can reach its plane. Also attenuates with the same haze law
             the near-field fog uses, so dust and fog agree. */
          float near = smoothstep(iParam.x * 0.30, iParam.x * 1.25, dist);
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

       SIM adopts these verbatim as the resource field when ENV provides them
       (`sim/spawn.js: resolveResourceClusters`), so the layout is a balance
       decision, not a dressing one. It has to satisfy the same contract SIM's
       own fallback does:

         - mirror-symmetric through the origin, so neither side gets a better
           opening from the seed;
         - two rich seams within a short haul of each mothership;
         - expansion seams further out that cost a warship to hold;
         - a contested band straddling the midline to fight over.

       The two motherships sit at +/- (separation/2) along X (see
       `sim/spawn.js: homePosition`). `separation` is passed through when SIM
       overrides the default. */
    const sep = this.options.separation || 22000;
    const home = new THREE.Vector3(-sep * 0.5, -900, -sep * 0.12);
    const clusters = [];

    const pushPair = (x, y, z, radius, amount) => {
      clusters.push(makeClusterRecord(x, y, z, radius, amount));
      clusters.push(makeClusterRecord(-x, -y, -z, radius, amount));
    };

    // Two rich home seams per side, so the opening is never a dice roll.
    for (let i = 0; i < 2; i++) {
      const a = (i / 2) * Math.PI * 2 + r.range(0, Math.PI);
      const d = r.range(3600, 5200);
      pushPair(
        home.x + Math.cos(a) * d,
        home.y + r.range(-900, 900),
        home.z + Math.sin(a) * d,
        r.range(950, 1500),
        r.range(22000, 26000),
      );
    }

    // Everything is built in mirrored pairs, so the budget is spent in pairs.
    const pairs = Math.max(3, Math.round(b.clusters / 2));
    const contested = Math.max(1, Math.floor((pairs - 2) / 2));
    const expansions = Math.max(0, pairs - 2 - contested);

    for (let i = 0; i < expansions; i++) {
      const a = r.range(0, Math.PI * 2);
      const d = r.range(8000, 12500);
      pushPair(
        home.x * 0.55 + Math.cos(a) * d,
        r.range(-2600, 2600),
        home.z * 0.55 + Math.sin(a) * d,
        r.range(1200, 1900),
        r.range(19000, 23000),
      );
    }

    // Contested band on the midline. Symmetric by construction: each is
    // generated in one half and mirrored, so the pair straddles the middle.
    for (let i = 0; i < contested; i++) {
      const a = (i / contested) * Math.PI + r.range(-0.25, 0.25);
      const d = r.range(2500, 7000);
      pushPair(
        Math.cos(a) * d * 0.35,
        Math.sin(a) * d * 0.55,
        Math.sin(a * 1.7) * d,
        r.range(1400, 2100),
        r.range(28000, 32000),
      );
    }

    this._clusters = clusters;

    /* ---- base shapes. Four is plenty: per-instance rotation and non-uniform
       scale do most of the work of making a field look varied. ---- */
    const shapes = 4;
    const [dHigh, dLow] = b.rockDetail;

    /* Rock albedo.

       Real asteroids are charcoal — C-types sit around 0.05 and even the
       bright S-types rarely clear 0.20. An earlier build ran them near #d8d8d8
       and they out-read every capital ship in the frame: two rocks were
       brighter, larger and higher-contrast than the whole fleet. Silhouette
       first (§3.1) means the rocks have to sit *under* the ships tonally, and
       that is an albedo decision, not a lighting one. */
    const rockColour = new THREE.Color(0.050, 0.046, 0.041).lerp(sky.palette.body, 0.12);

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
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vRockLocal;\nvarying vec3 vRockView;\nvarying float vRockSize;',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vRockLocal = position;
           /* Metres, recovered from the instance matrix, so surface detail can
              be specified in metres rather than in unit-sphere space. Without
              it a 12 m boulder and a 3 km landmark carry identical craters and
              the field has no sense of scale at all (§3.4). */
           #ifdef USE_INSTANCING
             vRockSize = length(instanceMatrix[0].xyz);
           #else
             vRockSize = 100.0;
           #endif
           vRockView = (modelViewMatrix * vec4(transformed, 1.0)).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vRockLocal;
           varying vec3 vRockView;
           varying float vRockSize;
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
           /* Height field. Three bands: regolith mottling, ~100 m craters,
              ~15 m boulders. The frequencies come from the rock's own radius,
              so a 3 km landmark and a 15 m chip are not the same object at
              different zoom levels (§3.4). */
           float rockHeight(vec3 n, float radius, float foot) {
             float h = fbm4e(n * 3.1) * 0.55;
             float fC = clamp(radius / 110.0, 1.2, 26.0);
             h += (ridge2e(n * fC) - 0.5) * 0.42 * bandFade(fC * 2.5, foot);
             float fB = clamp(radius / 15.0, 4.0, 72.0);
             h += gnoise(n * fB) * 0.22 * bandFade(fB, foot);
             return h;
           }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
           {
             /* Tangent-free bump (Mikkelsen): build the surface gradient from
                screen-space derivatives of the height and of the view-space
                position. No tangent attribute, no normal map texture, and it
                costs one height evaluation. */
             vec3 rn = normalize(vRockLocal);
             float bh = rockHeight(rn, vRockSize, length(fwidth(rn)));
             vec3 dpx = dFdx(vRockView);
             vec3 dpy = dFdy(vRockView);
             vec3 rr1 = cross(dpy, normal);
             vec3 rr2 = cross(normal, dpx);
             float det = dot(dpx, rr1);
             if (abs(det) > 1.0e-12) {
               vec3 grad = (rr1 * dFdx(bh) + rr2 * dFdy(bh)) / det;
               normal = normalize(normal - grad * 0.55);
             }
           }`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
           vec3 rkn3 = normalize(vRockLocal);
           float rkFoot = length(fwidth(rkn3));
           float rkn = fbm3e(rkn3 * 4.2) * 0.5 + 0.5;
           float rkf = clamp(vRockSize / 22.0, 5.0, 48.0);
           float rkm = (gnoise(rkn3 * rkf) * 0.5 + 0.5 - 0.5) * bandFade(rkf, rkFoot) + 0.5;
           roughnessFactor *= 0.84 + 0.22 * rkn;
           /* Albedo variation stays narrow. Rock is monotonous; the contrast
              in a real asteroid field comes from the terminator, not from
              patchwork colour. */
           diffuseColor.rgb *= 0.84 + 0.26 * mix(rkn, rkm, 0.40);`,
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

    for (let ci = 0; ci < clusters.length; ci++) {
      const c = clusters[ci];
      for (let i = 0; i < b.rocksPerCluster; i++) {
        const s = r.int(0, shapes - 1);
        const dir = r.unitVector();
        const rr = c.radius * Math.cbrt(r.next()) * r.range(0.75, 1.15);
        pos.set(c.position.x + dir.x * rr, c.position.y + dir.y * rr * 0.55, c.position.z + dir.z * rr);
        qt.set(r.gaussian(), r.gaussian(), r.gaussian(), r.gaussian()).normalize();
        const size = Math.pow(r.next(), 3.0) * 430 + 11;
        scl.set(size * r.range(0.7, 1.25), size * r.range(0.6, 1.1), size * r.range(0.75, 1.3));
        m.compose(pos, qt, scl);
        // Narrow: rock is monotonous, and a wide per-instance tint reads as
        // putty rather than as a field of the same material.
        const tint = r.range(0.78, 1.22);
        perShapeInstances[s].push({ cluster: ci, matrix: m.clone(), tint });
        totalPerShape[s]++;
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
      for (let i = 0; i < list.length; i++) {
        list[i].matrix.toArray(matrices, i * 16);
        const t = list[i].tint;
        colours[i * 3] = t;
        colours[i * 3 + 1] = t * 0.985;
        colours[i * 3 + 2] = t * 0.96;
      }

      const geoHigh = makeRockGeometry(r.fork(1000 + s), dHigh);
      const geoLow = makeRockGeometry(r.fork(1000 + s), dLow, geoHigh.userData.shape);

      const meshHigh = new THREE.InstancedMesh(geoHigh, material, list.length);
      const meshLow = new THREE.InstancedMesh(geoLow, material, list.length);
      for (const mesh of [meshHigh, meshLow]) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.count = 0;
        mesh.visible = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.name = 'env:rocks';
        engine.scene.add(mesh);
      }

      this._rockSets.push({ high: meshHigh, low: meshLow, matrices, colours, ranges });
      this._disposables.push(geoHigh, geoLow);
    }

    /* ---- landmarks: a handful of genuinely multi-kilometre rocks. Nothing
       sells the scale of a 380 m destroyer like parking it beside a 4 km one,
       and nothing else in the near field is big enough to do that job. ---- */
    const lmGeo = makeRockGeometry(r.fork(77), Math.min(4, dHigh + 1));
    const lmCount = b.landmarks;
    const lm = new THREE.InstancedMesh(lmGeo, material, lmCount);
    lm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(lmCount * 3), 3);
    for (let i = 0; i < lmCount; i++) {
      // Mirror them in pairs too — a 5 km landmark is cover, and cover on one
      // side of the map only is not a fair map.
      const c = clusters[(i * 2) % clusters.length];
      const dir = r.unitVector();
      const rr = c.radius * r.range(1.2, 2.4);
      pos.set(c.position.x + dir.x * rr, c.position.y + dir.y * rr * 0.4, c.position.z + dir.z * rr);
      if (i % 2 === 1) pos.negate();
      qt.set(r.gaussian(), r.gaussian(), r.gaussian(), r.gaussian()).normalize();
      const size = r.range(1800, 5200);
      scl.set(size * r.range(0.8, 1.2), size * r.range(0.55, 0.95), size * r.range(0.8, 1.3));
      m.compose(pos, qt, scl);
      lm.setMatrixAt(i, m);
      const t = r.range(0.80, 1.16);
      lm.setColorAt(i, new THREE.Color(t, t * 0.985, t * 0.955));
    }
    lm.instanceMatrix.needsUpdate = true;
    lm.instanceColor.needsUpdate = true;
    lm.frustumCulled = true;
    lm.name = 'env:landmarks';
    engine.scene.add(lm);
    this._landmarks = lm;
    this._disposables.push(lmGeo);
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
    for (let i = 0; i < count; i++) {
      const ang = r.range(0, Math.PI * 2);
      const rad = r.range(9000, 30000);
      p.set(Math.cos(ang) * rad, r.gaussian(0, 3200), Math.sin(ang) * rad);
      q.set(r.gaussian(), r.gaussian(), r.gaussian(), r.gaussian()).normalize();
      const len = r.range(240, 1500);
      s.set(len, len, len);
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
      key += c._visible ? (c._high ? 'H' : 'L') : '-';
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
      for (let ci = 0; ci < clusters.length; ci++) {
        const c = clusters[ci];
        if (!c._visible) continue;
        const range = set.ranges[ci];
        if (!range || !range.count) continue;
        const mSlice = set.matrices.subarray(range.start * 16, (range.start + range.count) * 16);
        const cSlice = set.colours.subarray(range.start * 3, (range.start + range.count) * 3);
        if (c._high) {
          hM.set(mSlice, nH * 16);
          hC.set(cSlice, nH * 3);
          nH += range.count;
        } else {
          lM.set(mSlice, nL * 16);
          lC.set(cSlice, nL * 3);
          nL += range.count;
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

    for (const m of [this._dust, this._landmarks, this._derelicts]) {
      if (m && m.parent) m.parent.remove(m);
    }
    for (const set of this._rockSets) {
      if (set.high.parent) set.high.parent.remove(set.high);
      if (set.low.parent) set.low.parent.remove(set.low);
      set.high.dispose();
      set.low.dispose();
    }
    if (this._landmarks) this._landmarks.dispose();
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

/** One resource seam. SIM reads `position`, `radius` and `amount` and may
    decrement `amount` in place as miners work it. */
function makeClusterRecord(x, y, z, radius, amount) {
  return {
    position: new THREE.Vector3(x, y, z),
    radius,
    amount: Math.round(amount),
    maxAmount: Math.round(amount),
    _visible: true,
    _high: true,
  };
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
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.userData.shape = shape;
  return geo;
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
