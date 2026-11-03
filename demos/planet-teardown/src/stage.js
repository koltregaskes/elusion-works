// Black studio: a near-black backdrop, a key light from the Sun's side, a turntable with an
// engraved degree ring, soft bloom and a vignette. Quality tiers drop bloom and pixel ratio.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    const scene = new THREE.Scene(); this.scene = scene;
    const bc = document.createElement('canvas'); bc.width = 1024; bc.height = 576; const g = bc.getContext('2d');
    const grd = g.createRadialGradient(540, 250, 30, 512, 300, 700);
    grd.addColorStop(0, '#121212'); grd.addColorStop(0.5, '#070707'); grd.addColorStop(1, '#000000');
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 576);
    // faint star dust
    let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 420; i++) { const b = Math.pow(rnd(), 3); g.fillStyle = `rgba(255,255,255,${0.08 + b * 0.5})`; g.fillRect(rnd() * 1024, rnd() * 576, b > 0.7 ? 1.4 : 0.8, b > 0.7 ? 1.4 : 0.8); }
    const bt = new THREE.CanvasTexture(bc); bt.colorSpace = THREE.SRGBColorSpace; scene.background = bt;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
    this.camera.position.set(3.4, 1.9, 5.6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.05, 0);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.6; this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.62;

    this.sunDir = new THREE.Vector3(-1, 0.32, 0.55).normalize();
    const key = new THREE.DirectionalLight(0xfff4e6, 2.6); key.position.copy(this.sunDir).multiplyScalar(10); scene.add(key); this.key = key;
    const fill = new THREE.DirectionalLight(0x8fa6c8, 0.35); fill.position.set(6, 2, -4); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(2, 4, -8); scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.12));

    // turntable: a dark disc with an engraved degree ring, lit only by its lines
    const tt = new THREE.Group(); const Y = -1.62;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.74, 0.04, 128), new THREE.MeshStandardMaterial({ color: 0x070707, roughness: 0.85, metalness: 0.0 }));
    disc.position.y = Y; tt.add(disc);
    const ticks = [];
    for (let i = 0; i < 360; i += 2) { const a = i / 180 * Math.PI, L = i % 30 === 0 ? 0.16 : i % 10 === 0 ? 0.09 : 0.045; ticks.push(new THREE.Vector3(Math.cos(a) * 2.62, Y + 0.022, Math.sin(a) * 2.62), new THREE.Vector3(Math.cos(a) * (2.62 - L), Y + 0.022, Math.sin(a) * (2.62 - L))); }
    tt.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 })));
    const ring = (rad, op) => new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 256 }, (_, i) => { const a = i / 256 * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * rad, Y + 0.022, Math.sin(a) * rad); })), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: op }));
    tt.add(ring(2.72, 0.35), ring(1.2, 0.08));
    // contact glow under the planet
    const glowC = document.createElement('canvas'); glowC.width = glowC.height = 128; const gg = glowC.getContext('2d');
    const rg = gg.createRadialGradient(64, 64, 0, 64, 64, 64); rg.addColorStop(0, 'rgba(255,255,255,0.10)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); gg.fillStyle = rg; gg.fillRect(0, 0, 128, 128);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(glowC), transparent: true, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = Y + 0.025; tt.add(glow);
    scene.add(tt); this.turntable = tt;
    this.pivot = new THREE.Group(); scene.add(this.pivot);

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.32, 0.55, 0.78);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; c.rgb *= 1.0 - dot(d, d) * 0.55; gl_FragColor = c; }',
    }));
    this.composer.addPass(new OutputPass());
    this.quality = 2;
    this.onResize(); addEventListener('resize', () => this.onResize());
  }
  onResize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false); this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  setQuality(q) {
    this.quality = q; const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 2 ? Math.min(2, dpr) : q === 1 ? Math.min(1.25, dpr) : 0.85);
    this.bloom.enabled = q >= 1; this.onResize();
  }
  render(dt) { this.composer.render(dt); }
}
