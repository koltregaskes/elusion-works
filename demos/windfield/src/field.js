import * as THREE from '../vendor/three/build/three.module.js';
import { heightAt } from './terrain.js';

// Shared field state on the GPU:
//  - a height texture, so grass that is positioned in the shader (the camera-following
//    near patch) can sit on the terrain without any CPU work;
//  - a cut mask the combine paints into as it drives. Red is "cut to stubble", green is
//    "straw lying in the windrow". Grass, wheat ears and the ground all read it, so a
//    lane the combine has harvested stays harvested.

const HEIGHT_SIZE = 512;
const HEIGHT_EXTENT = 520; // metres covered by the height texture, centred on the origin
const CUT_SIZE = 1024;
const CUT_EXTENT = 220; // metres covered by the cut mask, centred on the origin

export const fieldUniforms = {
  uHeightTex: { value: null },
  uHeightExtent: { value: new THREE.Vector4(-HEIGHT_EXTENT / 2, -HEIGHT_EXTENT / 2, HEIGHT_EXTENT, 0) },
  uCutTex: { value: null },
  uCutExtent: { value: new THREE.Vector4(-CUT_EXTENT / 2, -CUT_EXTENT / 2, CUT_EXTENT, 0) },
  uCutFade: { value: 1 },
};

export const FIELD_GLSL = /* glsl */ `
uniform sampler2D uHeightTex;
uniform vec4 uHeightExtent;
uniform sampler2D uCutTex;
uniform vec4 uCutExtent;
uniform float uCutFade;

float fieldHeight(vec2 p) {
  vec2 uv = (p - uHeightExtent.xy) / uHeightExtent.z;
  return texture2D(uHeightTex, uv).r;
}

// x = cut to stubble, y = straw in the windrow.
vec2 fieldCut(vec2 p) {
  vec2 uv = (p - uCutExtent.xy) / uCutExtent.z;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec2(0.0);
  return texture2D(uCutTex, uv).rg * uCutFade;
}
`;

export function buildHeightTexture() {
  const data = new Uint16Array(HEIGHT_SIZE * HEIGHT_SIZE);
  for (let j = 0; j < HEIGHT_SIZE; j++) {
    for (let i = 0; i < HEIGHT_SIZE; i++) {
      const x = -HEIGHT_EXTENT / 2 + ((i + 0.5) / HEIGHT_SIZE) * HEIGHT_EXTENT;
      const z = -HEIGHT_EXTENT / 2 + ((j + 0.5) / HEIGHT_SIZE) * HEIGHT_EXTENT;
      data[j * HEIGHT_SIZE + i] = THREE.DataUtils.toHalfFloat(heightAt(x, z));
    }
  }
  const tex = new THREE.DataTexture(data, HEIGHT_SIZE, HEIGHT_SIZE, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  fieldUniforms.uHeightTex.value = tex;
  return tex;
}

// The cut mask is a render target; the combine stamps soft-edged rectangles into it with
// MAX blending, so overlapping passes never double up and nothing has to be read back.
export class CutMask {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(CUT_SIZE, CUT_SIZE, {
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    this.scene = new THREE.Scene();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uChannel: { value: new THREE.Vector2(1, 0) }, uSoft: { value: 0.12 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform vec2 uChannel; uniform float uSoft; varying vec2 vUv;
        void main(){
          vec2 d = abs(vUv - 0.5) * 2.0;
          float a = (1.0 - smoothstep(1.0 - uSoft, 1.0, d.y)) * (1.0 - smoothstep(1.0 - uSoft * 0.5, 1.0, d.x));
          gl_FragColor = vec4(uChannel * a, 0.0, 1.0);
        }`,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.scene.add(this.quad);
    fieldUniforms.uCutTex.value = this.rt.texture;
    this.pending = [];
    this.needsClear = true;
  }

  // Queue a stamp: centre (x, z) in world metres, heading in radians (0 = +X),
  // length along the heading, width across it. channel 0 = cut, 1 = straw.
  stamp(x, z, heading, length, width, channel = 0, soft = 0.12) {
    this.pending.push({ x, z, heading, length, width, channel, soft });
  }

  clear() {
    this.needsClear = true;
  }

  flush() {
    if (!this.needsClear && this.pending.length === 0) return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.setRenderTarget(this.rt);
    if (this.needsClear) {
      r.setClearColor(0x000000, 1);
      r.clear(true, false, false);
      this.needsClear = false;
    }
    r.autoClear = false;
    const ext = fieldUniforms.uCutExtent.value;
    for (const s of this.pending) {
      this.quad.position.set((s.x - ext.x) / ext.z, (s.z - ext.y) / ext.z, 0);
      this.quad.rotation.set(0, 0, s.heading);
      this.quad.scale.set(s.length / ext.z, s.width / ext.z, 1);
      this.mat.uniforms.uChannel.value.set(s.channel === 0 ? 1 : 0, s.channel === 1 ? 1 : 0);
      this.mat.uniforms.uSoft.value = s.soft;
      r.render(this.scene, this.camera);
    }
    this.pending.length = 0;
    r.autoClear = prevAuto;
    r.setRenderTarget(prevTarget);
  }
}
