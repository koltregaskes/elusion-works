import * as THREE from '../../vendor/three/build/three.module.js';

/* Renderer + scene graph host.

   Two scenes, not one. `farScene` holds the backdrop — nebula shell, distant
   planet, star field — objects at 10^5..10^9 metres. Drawing them in the same
   depth range as a 14 m interceptor wrecks precision even with a logarithmic
   buffer, so the backdrop renders first with its own camera clone and its own
   near/far, then the depth buffer is cleared and gameplay draws on top. */

export const LAYER = {
  DEFAULT: 0,
  BACKDROP: 1,
  GLOW: 2,
  HUD3D: 3,
  SENSORS: 4,
};

const QUALITY_PRESETS = {
  low: { dpr: 1.0, shadows: false, shadowSize: 1024, anisotropy: 2, samples: 0 },
  medium: { dpr: 1.25, shadows: true, shadowSize: 1536, anisotropy: 4, samples: 0 },
  high: { dpr: 1.5, shadows: true, shadowSize: 2048, anisotropy: 8, samples: 2 },
  ultra: { dpr: 2.0, shadows: true, shadowSize: 4096, anisotropy: 16, samples: 4 },
};

export class Engine {
  constructor({ canvas, quality = 'high' }) {
    this.canvas = canvas;
    this.quality = quality;
    this._hooks = [];
    this._post = null;

    const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;
    this.preset = preset;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // handled by the post stack; MSAA on the composer target
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
      preserveDrawingBuffer: false,
    });
    this.renderer.autoClear = false;
    /* Accumulate render stats across every pass in a frame rather than letting
       three reset them per `render()` call. With a post stack installed the
       last call is a fullscreen quad, so the default behaviour reports "1 draw
       call, 1 triangle" for the whole game and the instancing budget in
       ARCHITECTURE §0 becomes unmeasurable. We reset once per frame instead. */
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.maxAnisotropy = Math.min(
      preset.anisotropy,
      this.renderer.capabilities.getMaxAnisotropy(),
    );

    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;

    this.farScene = new THREE.Scene();

    // Gameplay camera. Near is generous because the log depth buffer carries
    // the precision; far covers the 60 km playable cube plus slack.
    this.camera = new THREE.PerspectiveCamera(48, 1, 1, 400000);
    this.camera.layers.enable(LAYER.GLOW);
    this.camera.layers.enable(LAYER.HUD3D);

    // Backdrop camera: shares orientation + FOV, never translates.
    this.farCamera = new THREE.PerspectiveCamera(48, 1, 100, 1e10);

    this.clock = new THREE.Clock();
    this.size = { w: 1, h: 1, dpr: 1 };
    this.frame = 0;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize, { passive: true });
    this.resize();
  }

  registerRenderHook(fn) {
    this._hooks.push(fn);
    return () => {
      const i = this._hooks.indexOf(fn);
      if (i >= 0) this._hooks.splice(i, 1);
    };
  }

  setPostProcess(pp) {
    this._post = pp;
    if (pp && pp.resize) pp.resize(this.size.w, this.size.h);
  }

  resize() {
    const parent = this.canvas.parentElement || document.body;
    const w = Math.max(1, parent.clientWidth || window.innerWidth);
    const h = Math.max(1, parent.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.preset.dpr);

    this.size = { w, h, dpr };
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.farCamera.aspect = w / h;
    this.farCamera.updateProjectionMatrix();

    if (this._post && this._post.resize) this._post.resize(w, h);
  }

  /** Keep the backdrop camera locked to the gameplay camera's orientation. */
  syncFarCamera() {
    this.farCamera.quaternion.copy(this.camera.quaternion);
    this.farCamera.fov = this.camera.fov;
    this.farCamera.aspect = this.camera.aspect;
    this.farCamera.updateProjectionMatrix();
    this.farCamera.updateMatrixWorld();
  }

  /** Draw backdrop then gameplay into whatever target is currently bound. */
  renderScenes() {
    const r = this.renderer;
    this.syncFarCamera();

    r.clear(true, true, true);
    r.render(this.farScene, this.farCamera);
    r.clearDepth();
    r.render(this.scene, this.camera);
  }

  render(dt, elapsed) {
    this.frame++;
    this.renderer.info.reset();
    for (let i = 0; i < this._hooks.length; i++) this._hooks[i](dt, elapsed);

    if (this._post) {
      this._post.render(dt, elapsed);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderScenes();
    }
  }

  get info() {
    const m = this.renderer.info;
    return {
      calls: m.render.calls,
      triangles: m.render.triangles,
      geometries: m.memory.geometries,
      textures: m.memory.textures,
      programs: m.programs ? m.programs.length : 0,
    };
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    if (this._post && this._post.dispose) this._post.dispose();
    this.renderer.dispose();
  }
}

/** Recursively free GPU resources under a node. */
export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (!m) return;
    const mats = Array.isArray(m) ? m : [m];
    for (const mat of mats) {
      for (const key of Object.keys(mat)) {
        const v = mat[key];
        if (v && v.isTexture) v.dispose();
      }
      mat.dispose();
    }
  });
  if (root.parent) root.parent.remove(root);
}
