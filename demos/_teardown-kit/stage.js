// Studio stage: pale backdrop, soft key light, shadow-catcher floor, turntable,
// GTAO + bloom + gentle grade. Quality tiers drop the expensive passes.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const INK = 0x1d2024;
export const ACCENT = 0xff5a1f;

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.localClippingEnabled = true;
    this.renderer = r;

    const scene = new THREE.Scene();
    this.scene = scene;
    // paper backdrop: a soft radial gradient, drawn behind everything
    const bc = document.createElement('canvas'); bc.width = 1024; bc.height = 576;
    const bg = bc.getContext('2d');
    const grd = bg.createRadialGradient(560, 250, 40, 512, 300, 720);
    grd.addColorStop(0, '#fbfaf7'); grd.addColorStop(0.55, '#eceae5'); grd.addColorStop(1, '#d8d4cc');
    bg.fillStyle = grd; bg.fillRect(0, 0, 1024, 576);
    const btex = new THREE.CanvasTexture(bc); btex.colorSpace = THREE.SRGBColorSpace;
    scene.background = btex;
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(30, 1, 5, 20000);
    this.camera.position.set(1500, 1050, 1650);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 90, 20);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 120;
    this.controls.maxDistance = 4200;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    // key, fill, rim
    const key = new THREE.DirectionalLight(0xfff6ea, 2.25);
    key.position.set(-700, 1300, 600);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -900; sc.right = 900; sc.top = 900; sc.bottom = -900; sc.near = 100; sc.far = 4000;
    key.shadow.bias = -0.0002; key.shadow.normalBias = 1.2;
    key.shadow.radius = 6;
    this.key = key;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xe6eefc, 0.55);
    fill.position.set(900, 400, -500);
    scene.add(fill);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d3c9, 0.55));

    // shadow-catcher floor (invisible except for the shadow)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.ShadowMaterial({ opacity: 0.16, polygonOffset: true, polygonOffsetFactor: -1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -60.5; floor.receiveShadow = true;
    scene.add(floor);
    this.floor = floor;

    // turntable: a thin pale disc with an engraved degree ring
    const tt = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(700, 712, 12, 128), new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.6 }));
    disc.position.y = -54; disc.receiveShadow = true; disc.castShadow = true;
    tt.add(disc);
    const ticks = [];
    for (let i = 0; i < 360; i += 2) {
      const a = i / 180 * Math.PI, L = i % 30 === 0 ? 34 : i % 10 === 0 ? 20 : 10;
      ticks.push(new THREE.Vector3(Math.cos(a) * 690, -47.9, Math.sin(a) * 690), new THREE.Vector3(Math.cos(a) * (690 - L), -47.9, Math.sin(a) * (690 - L)));
    }
    tt.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.45 })));
    const rim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 256 }, (_, i) => { const a = i / 256 * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 712, -48, Math.sin(a) * 712); })), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.5 }));
    tt.add(rim);
    scene.add(tt);
    this.turntable = tt;
    this.pivot = new THREE.Group(); // the model rotates on this
    scene.add(this.pivot);

    // post
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.gtao = new GTAOPass(scene, this.camera, 512, 512);
    this.gtao.updateGtaoMaterial({ radius: 26, distanceExponent: 1.4, thickness: 6, scale: 1.1, samples: 12 });
    this.gtao.blendIntensity = 1.0;
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.22, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; c.rgb *= 1.0 - dot(d, d) * 0.22; gl_FragColor = c; }`,
    });
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.quality = 2;
    this.lock = false;

    this.onResize();
    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 2 ? Math.min(2, dpr) : q === 1 ? Math.min(1.25, dpr) : 0.85);
    this.gtao.enabled = q === 2 && !this.noAO;
    this.bloom.enabled = q >= 1;
    const s = q === 2 ? 2048 : q === 1 ? 1024 : 512;
    if (this.key.shadow.mapSize.x !== s) { this.key.shadow.mapSize.set(s, s); this.key.shadow.map?.dispose(); this.key.shadow.map = null; }
    this.onResize();
  }

  render(dt) { this.composer.render(dt); }
}
