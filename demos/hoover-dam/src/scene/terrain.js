// Black Canyon terrain: one height-field mesh with vertex colours, a live
// "bathtub ring" and underwater tint injected into the standard material.

import * as THREE from 'three';
import { EXTENT, terrainHeight, fbm, clamp, smooth, elevToY } from './util.js';
import { ELEV } from '../model/data.js';

export function buildTerrain(uniforms) {
  const W = EXTENT.x1 - EXTENT.x0, D = EXTENT.z1 - EXTENT.z0;
  const SX = 300, SZ = 380;
  const geo = new THREE.PlaneGeometry(W, D, SX, SZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate((EXTENT.x0 + EXTENT.x1) / 2, 0, (EXTENT.z0 + EXTENT.z1) / 2);
  const pos = geo.attributes.position;
  // Denser sampling close to the dam: warp x/z toward the centre.
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    const ux = x / (W / 2), uz = (z - (EXTENT.z0 + EXTENT.z1) / 2) / (D / 2);
    x = Math.sign(ux) * Math.pow(Math.abs(ux), 1.35) * (W / 2);
    const zc = (EXTENT.z0 + EXTENT.z1) / 2;
    z = zc + Math.sign(uz) * Math.pow(Math.abs(uz), 1.12) * (D / 2);
    pos.setXYZ(i, x, terrainHeight(x, z), z);
  }
  geo.computeVertexNormals();

  const nrm = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const rockDark = new THREE.Color(0x2e221b), rockRed = new THREE.Color(0x6a3d2a), rockGrey = new THREE.Color(0x4f453f);
  const tan = new THREE.Color(0x7d6650), desert = new THREE.Color(0x927d61), silt = new THREE.Color(0x5e5548);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const slope = 1 - nrm.getY(i);
    const n = fbm(x * 0.02, z * 0.02, 3);
    const band = Math.sin(y * 0.32 + n * 3.5) * 0.5 + 0.5;
    c.copy(rockDark).lerp(rockRed, clamp(band * 0.7 + n * 0.4, 0, 1));
    c.lerp(rockGrey, clamp(fbm(x * 0.006 + 3, z * 0.006, 3) + 0.2, 0, 0.7));
    const flat = 1 - smooth(0.12, 0.42, slope);
    tmp.copy(tan).lerp(desert, clamp(0.5 + fbm(x * 0.004, z * 0.004, 3), 0, 1));
    // creosote speckle on flats
    if (fbm(x * 0.35, z * 0.35, 2) > 0.34) tmp.multiplyScalar(0.78);
    // desert varnish and darker volcanic outcrops on the mesa
    tmp.lerp(rockDark, clamp((fbm(x * 0.008 + 9, z * 0.008, 4) - 0.1) * 1.6, 0, 0.5));
    c.lerp(tmp, flat * smooth(150, 230, y));
    if (y < 45) c.lerp(silt, 0.55 * (1 - smooth(30, 45, y)));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  // Crevice occlusion from the height grid itself: how far each vertex sits below its neighbours.
  const NX = SX + 1, NZ = SZ + 1;
  const ao = new Float32Array(pos.count);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, y = pos.getY(k);
    let occ = 0, n = 0;
    for (const r of [2, 5, 11]) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const ii = i + di * r, jj = j + dj * r;
      if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
      const kk = jj * NX + ii;
      const dx = pos.getX(kk) - pos.getX(k), dz = pos.getZ(kk) - pos.getZ(k);
      const d = Math.hypot(dx, dz) || 1;
      occ += Math.max(0, Math.atan2(pos.getY(kk) - y, d)) / (Math.PI / 2); n++;
    }
    ao[k] = Math.max(0, 1 - 1.9 * occ / Math.max(1, n));
  }
  geo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, side: THREE.FrontSide });
  mat.customProgramCacheKey = () => 'terrain-v2';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWaterY = uniforms.uWaterY;
    sh.uniforms.uRingTop = uniforms.uRingTop;
    sh.uniforms.uDamCz = uniforms.uDamCz;
    sh.uniforms.uDamR = uniforms.uDamR;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAO; varying float vAO; varying vec3 vWPos; varying vec3 vWNorm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal); vAO = aAO;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNorm; varying float vAO;
        uniform float uWaterY; uniform float uRingTop; uniform float uDamCz; uniform float uDamR;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
        float fbm4(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*vn(p); p=p*2.07+vec2(1.7,9.2); a*=0.5; } return s; }
        vec3 bumpN(vec3 p, vec3 n, float h){
          vec3 dpx = dFdx(p), dpy = dFdy(p); float dhx = dFdx(h), dhy = dFdy(h);
          vec3 r1 = cross(dpy, n), r2 = cross(n, dpx); float det = dot(dpx, r1);
          vec3 g = sign(det) * (dhx * r1 + dhy * r2);
          return normalize(abs(det) * n - g);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float flatW = smoothstep(0.55, 0.85, vWNorm.y);
        vec2 wallUV = vec2(vWPos.x * 0.7 + vWPos.z * 0.7, vWPos.y);
        float nWall = fbm4(wallUV * vec2(0.09, 0.22));
        float strata = sin(vWPos.y * 1.35 + nWall * 5.0) * 0.5 + 0.5;
        float hWall = nWall * 1.6 + strata * 0.55 + fbm4(wallUV * 0.6) * 0.5;
        float nFlat = fbm4(vWPos.xz * 0.06);
        float hFlat = nFlat * 1.2 + fbm4(vWPos.xz * 0.55) * 0.45 + fbm4(vWPos.xz * 2.1) * 0.12;
        float hDetail = mix(hWall, hFlat, flatW);
        {
          // rock tone: dark volcanic breccia with rust bands on the walls; varnished gravel on the mesa
          vec3 band = mix(vec3(0.75, 0.42, 0.26), vec3(0.32, 0.22, 0.17), smoothstep(0.35, 0.75, strata));
          diffuseColor.rgb *= mix(mix(vec3(0.85), band * 1.25, 0.45 * (1.0 - flatW)), vec3(1.0), flatW * 0.4);
          diffuseColor.rgb *= 0.72 + 0.56 * mix(nWall, fbm4(vWPos.xz * 0.35), flatW);
          diffuseColor.rgb *= mix(0.42, 1.0, vAO);
          float up = step(length(vWPos.xz - vec2(0.0, uDamCz)), uDamR + 2.0) < 0.5 && vWPos.z < 140.0 ? 1.0 : 0.0;
          float streak = vn(vec2(vWPos.x*0.08 + vWPos.z*0.08, vWPos.y*0.9));
          float ring = up * step(uWaterY, vWPos.y) * (1.0 - smoothstep(uRingTop - 1.5, uRingTop + 0.5, vWPos.y));
          ring *= 0.75 + 0.25 * streak;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.86, 0.80) * (0.85 + 0.25 * nWall), ring * 0.92);
          float depth = (uWaterY - vWPos.y) * up;
          if (depth > 0.0) {
            float a = 1.0 - exp(-depth * 0.05);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.10, 0.12), a * 0.94);
          }
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = bumpN(-vViewPosition, normal, hDetail * mix(2.4, 1.1, flatW));`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(0.35, 1.0, vAO);`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';

  // Shared ring height: the highest level the lake has stood for decades (~1,220 ft).
  uniforms.uRingTop.value = elevToY(ELEV.drumTop - 1);
  return mesh;
}
