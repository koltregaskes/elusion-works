// Loads the Blender-made kit (.glb) and turns each object into an instancing
// template. Also swaps the placeholder materials (Facade, FacadeGlass,
// SignFace, Screen, Hologram) for the browser's own shaders.
import * as THREE from '../vendor/three/build/three.module.min.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';

export const shared = {
  time: { value: 0 },
};

const HASH = /* glsl */ `
float lwHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}`;

// Procedural lit windows. Windows come from world position, so any tower,
// at any scale, gets a correct floor grid and a different pattern.
function facadeMaterial(base, opts) {
  const m = base.clone();
  m.envMapIntensity = opts.env;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.time;
    shader.uniforms.uCol = { value: opts.col };
    shader.uniforms.uFloor = { value: opts.floor };
    shader.uniforms.uLit = { value: opts.lit };
    shader.uniforms.uWin = { value: opts.intensity };
    shader.uniforms.uCool = { value: opts.cool };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vLwPos; varying vec3 vLwNrm; varying float vLwSeed;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vec4 lwWP = vec4(transformed, 1.0);
vec3 lwN = objectNormal;
#ifdef USE_INSTANCING
lwWP = instanceMatrix * lwWP;
lwN = mat3(instanceMatrix) * lwN;
// whole number + 0.5, so interpolation noise cannot reach the hash
vLwSeed = floor(fract(instanceMatrix[3].x * 0.0137 + instanceMatrix[3].z * 0.0291) * 50.0) + 0.5;
#else
vLwSeed = 3.5;
#endif
lwWP = modelMatrix * lwWP;
vLwPos = lwWP.xyz;
vLwNrm = normalize(mat3(modelMatrix) * lwN);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime; uniform float uCol; uniform float uFloor; uniform float uLit; uniform float uWin; uniform float uCool;
varying vec3 vLwPos; varying vec3 vLwNrm; varying float vLwSeed;
${HASH}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 an = abs(vLwNrm);
  if (an.y < 0.5 && vLwPos.y > 5.4) {
    bool onX = an.x > an.z;
    float side = onX ? (vLwNrm.x > 0.0 ? 1.0 : 2.0) : (vLwNrm.z > 0.0 ? 3.0 : 4.0);
    float u = onX ? vLwPos.z : vLwPos.x;
    vec2 g = vec2(u / uCol, (vLwPos.y - 0.4) / uFloor);
    vec2 cell = floor(g);
    vec2 f = fract(g);
    vec2 fw = fwidth(g);
    float mx = smoothstep(0.13 - fw.x, 0.13 + fw.x, f.x) * (1.0 - smoothstep(0.87 - fw.x, 0.87 + fw.x, f.x));
    float my = smoothstep(0.22 - fw.y, 0.22 + fw.y, f.y) * (1.0 - smoothstep(0.86 - fw.y, 0.86 + fw.y, f.y));
    float win = mx * my;
    // mullion between two panes, and a brighter ceiling band inside lit rooms
    float mull = smoothstep(0.015 + fw.x, 0.03 + fw.x, abs(f.x - 0.5));
    float seed = floor(vLwSeed) + side * 7.0;
    float h1 = lwHash(vec3(cell, seed));
    float flat_ = lwHash(vec3(floor(cell.x / 3.0), cell.y, seed + 19.7));
    float lit = step(1.0 - uLit, h1 * 0.5 + flat_ * 0.5);
    float h2 = lwHash(vec3(cell + 11.3, seed));
    vec3 warm = vec3(1.0, 0.66, 0.36);
    vec3 cool = vec3(0.55, 0.78, 1.0);
    vec3 wc = mix(warm, cool, step(1.0 - uCool, h2));
    float h3 = lwHash(vec3(cell + 4.7, seed));
    if (h3 > 0.965) wc = (h3 > 0.982) ? vec3(1.0, 0.15, 0.6) : vec3(0.1, 0.9, 1.0);
    // blinds: partly lit
    float blind = mix(1.0, smoothstep(0.35, 0.4, f.y), step(0.7, h2));
    float tv = step(0.985, lwHash(vec3(cell + 2.2, seed))) * (0.55 + 0.45 * sin(uTime * 9.0 + h1 * 60.0));
    float ceil_ = 0.65 + 0.55 * smoothstep(0.35, 0.85, f.y);
    vec3 emi = wc * lit * win * mull * blind * ceil_ * uWin * (0.5 + h2 * 0.9) + vec3(0.35, 0.55, 1.0) * tv * win * uWin;
    float far = smoothstep(0.3, 0.85, max(fw.x, fw.y));
    vec3 avg = mix(warm, cool, uCool) * uLit * 0.42 * uWin * 0.7;
    emi = mix(emi, avg, far);
    totalEmissiveRadiance += emi;
    float wk = win * (1.0 - far);
    diffuseColor.rgb = mix(diffuseColor.rgb * (0.8 + 0.4 * lwHash(vec3(cell.y, seed, 1.0))), vec3(0.008, 0.01, 0.014), wk);
    roughnessFactor = mix(roughnessFactor, 0.1, wk);
    metalnessFactor = mix(metalnessFactor, 0.7, wk);
  }
}`,
      );
  };
  m.customProgramCacheKey = () => 'lw-facade-' + opts.key;
  return m;
}

// Text atlases for signs, drawn once on a canvas.
const BLADE_WORDS = ['HOTEL', 'RAMEN', 'BAR', 'CLINIC', 'NOODLE', '24H', 'ARCADE', 'LUMEN', 'CYBER', 'KARAOKE', 'SUSHI', 'PAWN',
  'DENTAL', 'MODS', 'VOID', 'TEA', 'SAKE', 'OPEN', 'REPAIR', 'DOJO', 'NEON', 'KOI', 'LOANS', 'SYNTH', 'PHARMA', 'CAFE', 'IMPLANT', 'DATA',
  'CHROME', 'DUMPLING', 'RENT', 'GAMES'];
const WIDE_WORDS = ['ELUSION WORKS', 'NOODLE BAR', 'NIGHT MARKET', 'NEURO LINK', 'KOI KOI', 'REPAIRS 24H', 'PHARMACY', 'HOSTEL',
  'CHROME & CO', 'SYNTH WAVE', 'LUMEN WARD', 'DUMPLINGS', 'DATA BROKER', 'TEA HOUSE', 'PACHINKO', 'RAIN CITY'];
const SIGN_COLS = ['#ff2a8a', '#22e6ff', '#ffa024', '#9b5cff', '#3dff8a', '#ff4040', '#fff3c4'];

function drawAtlas(kind) {
  const cv = document.createElement('canvas');
  const blade = kind === 'blade';
  cv.width = blade ? 1024 : 1024;
  cv.height = blade ? 2048 : 1024;
  const cols = blade ? 8 : 2;
  const rows = blade ? 4 : 8;
  const tw = cv.width / cols;
  const th = cv.height / rows;
  const g = cv.getContext('2d');
  const words = blade ? BLADE_WORDS : WIDE_WORDS;
  for (let i = 0; i < cols * rows; i++) {
    const cx = (i % cols) * tw;
    const cy = Math.floor(i / cols) * th;
    const col = SIGN_COLS[(i * 5 + 3) % SIGN_COLS.length];
    const dark = i % 3 === 0;
    g.fillStyle = dark ? '#07060c' : col;
    g.globalAlpha = dark ? 1 : 0.18;
    g.fillRect(cx, cy, tw, th);
    g.globalAlpha = 1;
    g.fillStyle = '#05040a';
    if (!dark) g.fillRect(cx + 6, cy + 6, tw - 12, th - 12);
    g.strokeStyle = col;
    g.lineWidth = blade ? 6 : 5;
    g.shadowColor = col;
    g.shadowBlur = 18;
    g.strokeRect(cx + 10, cy + 10, tw - 20, th - 20);
    g.fillStyle = i % 4 === 1 ? '#ffffff' : col;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = words[i % words.length];
    if (blade) {
      const letters = w.split('');
      const n = letters.length;
      const fs = Math.min(tw * 0.62, (th - 40) / n * 0.9);
      g.font = `800 ${fs}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      letters.forEach((ch, k) => g.fillText(ch, cx + tw / 2, cy + 20 + (th - 40) * (k + 0.5) / n));
    } else {
      let fs = th * 0.56;
      g.font = `800 ${fs}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      const mw = g.measureText(w).width;
      if (mw > tw * 0.86) fs *= tw * 0.86 / mw;
      g.font = `800 ${fs}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
      g.fillText(w, cx + tw / 2, cy + th / 2 + 2);
    }
    g.shadowBlur = 0;
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  return { tex, cols, rows };
}

function signMaterial(atlas, boost) {
  const m = new THREE.MeshBasicMaterial({ map: atlas.tex });
  m.color.setScalar(boost);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.time;
    shader.uniforms.uGrid = { value: new THREE.Vector2(atlas.cols, atlas.rows) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aTile; uniform float uTime; uniform vec2 uGrid; varying float vFlick;
${HASH}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
float tCol = mod(aTile, uGrid.x);
float tRow = floor(aTile / uGrid.x);
// glTF stores V flipped relative to Blender, so Blender v = 1 - uv.y
vMapUv = vec2((tCol + uv.x) / uGrid.x, 1.0 - (tRow + uv.y) / uGrid.y);
float fh = lwHash(vec3(aTile, instanceMatrix[3].x, instanceMatrix[3].z));
float fl = 1.0;
if (fh > 0.82) {
  float k = floor(uTime * 12.0 + fh * 100.0);
  fl = mix(1.0, step(0.35, lwHash(vec3(k, fh, 2.0))), step(0.6, sin(uTime * 0.7 + fh * 30.0)));
}
vFlick = fl * (0.85 + 0.15 * sin(uTime * 3.0 + fh * 20.0));`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vFlick;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
diffuseColor.rgb *= mix(0.08, 1.0, vFlick);`);
  };
  m.customProgramCacheKey = () => 'lw-sign';
  return m;
}

// Animated advert screens. Per-instance seed from the instance position.
function screenMaterial(wide) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uMap: { value: null } }]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv; varying float vSeed;
      void main() {
        vUv = vec2(uv.x, 1.0 - uv.y); // undo glTF V flip
        vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
        p = instanceMatrix * p;
        vSeed = fract(instanceMatrix[3].x * 0.071 + instanceMatrix[3].z * 0.113 + instanceMatrix[3].y * 0.05);
        #else
        vSeed = 0.3;
        #endif
        vec4 mvPosition = modelViewMatrix * p;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime; uniform sampler2D uMap;
      varying vec2 vUv; varying float vSeed;
      vec3 pal(float t) { return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67))); }
      void main() {
        float slot = floor(uTime / 7.0 + vSeed * 13.0);
        float kind = mod(slot, 3.0);
        float tile = mod(slot * 5.0 + floor(vSeed * 16.0), 16.0);
        vec2 uv = vUv;
        vec3 c;
        vec3 a = pal(vSeed + slot * 0.17) ;
        vec3 b = pal(vSeed + slot * 0.17 + 0.45);
        if (kind < 0.5) {
          // gradient + big word
          c = mix(a, b, uv.y + 0.15 * sin(uv.x * 6.0 + uTime));
          c *= 0.35;
          vec2 tuv = vec2((mod(tile, 2.0) + uv.x) / 2.0, 1.0 - (floor(tile / 2.0) + 1.0 - (uv.y * 2.2 - 0.6)) / 8.0);
          float inside = step(0.0, uv.y * 2.2 - 0.6) * step(uv.y * 2.2 - 0.6, 1.0);
          vec3 t = texture2D(uMap, tuv).rgb * inside;
          c += t * 1.6;
        } else if (kind < 1.5) {
          // rings pulse
          float d = length((uv - 0.5) * vec2(1.78, 1.0));
          float r = sin(d * 30.0 - uTime * 4.0) * 0.5 + 0.5;
          c = mix(a * 0.15, b, smoothstep(0.6, 1.0, r) * smoothstep(0.75, 0.1, d));
          c += a * smoothstep(0.08, 0.0, abs(d - 0.32 - 0.03 * sin(uTime * 2.0))) * 1.5;
        } else {
          // equaliser bars
          float bx = floor(uv.x * 24.0);
          float h = 0.25 + 0.6 * abs(sin(uTime * (1.5 + fract(bx * 0.37) * 3.0) + bx));
          float bar = step(uv.y, h) * step(0.15, fract(uv.x * 24.0));
          c = mix(a * 0.08, mix(a, b, uv.y), bar);
        }
        // scanlines and edge falloff
        c *= 0.82 + 0.18 * sin(vUv.y * 420.0);
        c *= 1.15;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

export function hologramMaterial(tint) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: shared.time, uTint: { value: tint } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec2 vUv;
      void main() {
        vec3 p = position;
        float k = smoothstep(3.5, -6.0, p.x);
        p.z += sin(p.x * 0.75 + uTime * 3.2) * 0.75 * k;
        vUv = uv;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uTint;
      varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec2 vUv;
      void main() {
        float fr = pow(1.0 - abs(dot(normalize(vN), vV)), 2.0);
        float scan = 0.6 + 0.4 * sin(vW.y * 9.0 - uTime * 6.0);
        float band = smoothstep(0.0, 0.05, abs(fract(vW.y * 0.25 - uTime * 0.3) - 0.5) - 0.42);
        float flick = 0.85 + 0.15 * sin(uTime * 37.0) * sin(uTime * 13.0);
        vec3 c = mix(uTint, vec3(1.0, 0.25, 0.7), vUv.x * 0.6) ;
        float a = (0.12 + fr * 0.9) * scan * flick + band * 0.3;
        gl_FragColor = vec4(c * a * 2.2, 1.0);
      }`,
  });
}

// Each kit object -> { name, parts: [{ geometry, material, matrix }], box }
export async function loadKit(url, onProgress) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url, (e) => {
    if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
  });
  const blade = drawAtlas('blade');
  const wide = drawAtlas('wide');
  const swapped = new Map();
  const swap = (mat) => {
    if (swapped.has(mat)) return swapped.get(mat);
    let out = mat;
    switch (mat.name) {
      case 'Facade':
        out = facadeMaterial(mat, { key: 'a', col: 2.1, floor: 3.3, lit: 0.36, intensity: 1.05, cool: 0.25, env: 0.5 });
        break;
      case 'FacadeGlass':
        out = facadeMaterial(mat, { key: 'b', col: 1.6, floor: 3.8, lit: 0.48, intensity: 0.95, cool: 0.6, env: 1.0 });
        break;
      case 'Screen': {
        const s = screenMaterial();
        s.uniforms.uTime = shared.time;
        s.uniforms.uMap.value = wide.tex;
        out = s;
        break;
      }
      default:
        if (mat.isMeshStandardMaterial) {
          mat.envMapIntensity = mat.metalness > 0.5 ? 0.9 : 0.45;
        }
    }
    swapped.set(mat, out);
    return out;
  };
  const kit = new Map();
  gltf.scene.updateMatrixWorld(true);
  for (const node of gltf.scene.children) {
    const parts = [];
    node.traverse((o) => {
      if (!o.isMesh) return;
      parts.push({ geometry: o.geometry, material: swap(o.material), matrix: o.matrixWorld.clone(), matName: o.material.name });
    });
    const box = new THREE.Box3();
    const foot = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const p of parts) {
      const pos = p.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix);
        box.expandByPoint(v);
        if (v.y < 3.0) foot.expandByPoint(v);
      }
    }
    kit.set(node.name, { name: node.name, parts, box, foot });
  }
  return {
    kit,
    signMaterials: { blade: signMaterial(blade, 1.9), wide: signMaterial(wide, 1.8) },
    atlases: { blade, wide },
  };
}

// A batch of instances of one template: one InstancedMesh per part.
export class Batch {
  constructor(template, capacity, scene, { dynamic = false, material = null, tiles = false } = {}) {
    this.t = template;
    this.count = 0;
    this.capacity = capacity;
    this.meshes = template.parts.map((p) => {
      const mat = material && p.matName === material.match ? material.material : p.material;
      const m = new THREE.InstancedMesh(p.geometry, mat, capacity);
      m.count = 0;
      m.userData.local = p.matrix;
      m.userData.matName = p.matName;
      if (dynamic) {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
      }
      scene.add(m);
      return m;
    });
    this.tmp = new THREE.Matrix4();
    if (tiles) {
      this.tileAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      for (const m of this.meshes) {
        if (m.material.map) {
          m.geometry = m.geometry.clone();
          m.geometry.setAttribute('aTile', this.tileAttr);
        }
      }
    }
  }
  add(matrix, tile = 0) {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.set(i, matrix);
    if (this.tileAttr) this.tileAttr.setX(i, tile);
    for (const m of this.meshes) m.count = this.count;
    return i;
  }
  set(i, matrix) {
    for (const m of this.meshes) {
      this.tmp.multiplyMatrices(matrix, m.userData.local);
      m.setMatrixAt(i, this.tmp);
    }
  }
  commit() {
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (!m.frustumCulled) continue;
      m.computeBoundingSphere();
      m.computeBoundingBox();
    }
    if (this.tileAttr) this.tileAttr.needsUpdate = true;
  }
}
