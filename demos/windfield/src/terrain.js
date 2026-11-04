import * as THREE from '../vendor/three/build/three.module.js';
import { makeSimplex, fbm, smoothstep } from './noise.js';
import { fieldUniforms, FIELD_GLSL } from './field.js';

// One height function drives the ground mesh, grass roots, trees and the camera floor,
// so nothing ever floats or sinks.
const n = makeSimplex(1337);

export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  // Gentle rolling meadow.
  let h = fbm(n, x * 0.006, z * 0.006, 4) * 5.5;
  h += fbm(n, x * 0.03 + 40, z * 0.03 - 12, 3) * 0.55;
  // Flatten the stage around the subject, then lift it onto a soft rise.
  const stage = 1 - smoothstep(14, 55, r);
  h = h * (1 - stage * 0.85);
  h += 1.4 * Math.exp(-(r * r) / 520);
  // Bigger hills far away give the horizon a silhouette.
  const far = smoothstep(160, 420, r);
  h += far * (fbm(n, x * 0.0035 + 9, z * 0.0035 + 3, 4) * 0.5 + 0.55) * 46;
  return h;
}

export function buildGround(params) {
  const size = 1400;
  const seg = 260;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tint = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    // Pull vertices towards the centre so detail sits where the camera is.
    let x = pos.getX(i);
    let z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const k = Math.pow(r / (size * 0.5 * Math.SQRT2), 1.6) * (size * 0.5 * Math.SQRT2);
    if (r > 0) {
      x = (x / r) * k;
      z = (z / r) * k;
    }
    pos.setXYZ(i, x, heightAt(x, z), z);
    tint[i] = fbm(n, x * 0.05 + 100, z * 0.05, 3) * 0.5 + 0.5;
  }
  geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: false });
  const uniforms = {
    uGroundA: { value: new THREE.Color() },
    uGroundB: { value: new THREE.Color() },
    uScorch: { value: new THREE.Vector4(0, 0, 0, 0) },
    uStubbleGround: { value: new THREE.Color('#8a7448') },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, fieldUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;\nvarying float vTint;\nvarying vec3 vGWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = aTint;\nvGWorld = (modelMatrix * vec4(position,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' + FIELD_GLSL + '\nuniform vec3 uGroundA;\nuniform vec3 uGroundB;\nuniform vec4 uScorch;\nuniform vec3 uStubbleGround;\nvarying float vTint;\nvarying vec3 vGWorld;'
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `vec3 gcol = mix(uGroundA, uGroundB, smoothstep(0.25, 0.8, vTint));
         float sc = 1.0 - smoothstep(uScorch.z * 0.4, uScorch.z, distance(vGWorld.xz, uScorch.xy));
         gcol = mix(gcol, vec3(0.05, 0.035, 0.025), sc * uScorch.w);
         vec2 gc = fieldCut(vGWorld.xz);
         gcol = mix(gcol, uStubbleGround * (0.75 + vTint * 0.4), clamp(gc.x * 0.85 + gc.y * 0.3, 0.0, 1.0));
         vec4 diffuseColor = vec4( gcol, opacity );`
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.uniforms = uniforms;
  return mesh;
}
