// TSL (three.js shading language) materials for Lumen Ward. Runs on WebGPU,
// and on the WebGL2 fallback.
import * as THREE from '../../_shared/three-r187/build/three.webgpu.js';
import {
  Fn, vec2, vec3, vec4, float, uniform, texture, uv, positionWorld, positionLocal, cameraPosition, normalWorld,
  instancedBufferAttribute, mix, step, smoothstep, fract, floor, abs, min, max, dot, normalize, sin, cos, hash,
  select, mx_noise_float, normalMap, clamp, pow, length, exp, mrt, roughness,
} from '../../_shared/three-r187/build/three.tsl.js';

export const uTime = uniform(0);

// ------------------------------------------------------------------ textures
const TEX_SETS = ['concrete', 'cladding', 'asphalt', 'pavement', 'rustmetal', 'roof'];

export async function loadTextures(base, onProgress) {
  const loader = new THREE.TextureLoader();
  const out = {};
  let done = 0;
  const total = TEX_SETS.length * 3;
  await Promise.all(TEX_SETS.flatMap((name) => ['color', 'orm', 'normal'].map(async (kind) => {
    const t = await loader.loadAsync(`${base}/${name}_${kind}.webp`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    out[name] = out[name] || {};
    out[name][kind] = t;
    onProgress?.(++done / total);
  })));
  return out;
}

// PBR from a texture set on the mesh's own UVs (box-projected in metres in Blender).
export function texturedMaterial(set, { tint = 1, rough = 1, wet = 0.75, uvNode = null, normalScale = 1 } = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const u = uvNode || uv();
  const orm = texture(set.orm, u);
  m.colorNode = texture(set.color, u).rgb.mul(tint);
  m.roughnessNode = clamp(orm.g.mul(rough).mul(wet), 0.04, 1);
  m.metalnessNode = orm.b;
  m.aoNode = orm.r;
  m.normalNode = normalMap(texture(set.normal, u), vec2(normalScale));
  return m;
}

// ------------------------------------------------------------------ interior-mapped windows
// Fake rooms behind the glass. Each window instance carries its world yaw (the
// wall's facing) and a random seed; the ray from the camera is traced through a
// box room in the shader, so the room has depth and parallax.
const yawAttr = (attr) => instancedBufferAttribute(attr);

function roomPalette(seed) {
  const warm = vec3(1.0, 0.6, 0.32);
  const cool = vec3(0.5, 0.72, 1.0);
  const pink = vec3(1.0, 0.25, 0.65);
  const cyan = vec3(0.2, 0.9, 1.0);
  const h = hash(seed.add(3.1));
  const base = mix(warm, cool, step(0.62, h));
  return select(h.greaterThan(0.94), mix(pink, cyan, step(0.97, h)), base);
}

export function windowMaterial(yawAttribute, seedAttribute, { w = 1.5, h = 2.0, depth = 3.0, shop = false } = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const yaw = yawAttr(yawAttribute);
  const seed = yawAttr(seedAttribute);
  const interior = Fn(() => {
    const u0 = uv().x;
    const v0 = uv().y.oneMinus(); // glTF stores V flipped
    const T = vec3(cos(yaw), 0, sin(yaw).negate());
    const N = vec3(sin(yaw), 0, cos(yaw));
    const V = normalize(positionWorld.sub(cameraPosition));
    const rd = vec3(dot(V, T).div(w), V.y.div(h), dot(V, N).negate().div(depth).max(0.0005));
    const eps = float(0.0001);
    const rx = select(abs(rd.x).lessThan(eps), eps, rd.x);
    const ry = select(abs(rd.y).lessThan(eps), eps, rd.y);
    const tx = select(rx.greaterThan(0), u0.oneMinus().div(rx), u0.negate().div(rx));
    const ty = select(ry.greaterThan(0), v0.oneMinus().div(ry), v0.negate().div(ry));
    const tz = float(1).div(rd.z);
    const tmin = min(min(tx, ty), tz);
    const hit = vec3(u0, v0, 0).add(vec3(rx, ry, rd.z).mul(tmin));
    const back = step(tz, min(tx, ty));
    const yWall = back.oneMinus().mul(step(ty, tx));
    const isCeil = yWall.mul(step(0, ry));
    const isFloor = yWall.sub(isCeil);
    const side = back.oneMinus().mul(yWall.oneMinus());

    const epoch = floor(uTime.mul(0.02).add(seed.mul(7))); // rooms switch lights now and then
    const lit = step(shop ? 0.12 : 0.58, hash(seed.add(epoch)).mul(0.5).add(hash(seed.add(1.7)).mul(0.5)));
    const pal = shop ? mix(vec3(1.0, 0.85, 0.65), roomPalette(seed), 0.45) : roomPalette(seed);
    // depth falloff and ceiling lamp pool
    const fall = mix(float(1.0), float(0.3), hit.z).mul(mix(float(0.55), float(1.0), smoothstep(0.0, 0.25, hit.x.min(hit.x.oneMinus()))));
    const lamp = smoothstep(0.55, 0.0, length(hit.xz.sub(vec2(0.5, 0.45)))).mul(isCeil);
    // back wall details: a picture, a dark furniture block and shelves
    const hx = hit.x;
    const hy = hit.y;
    const sofa = step(0.15, hx).mul(step(hx, 0.75)).mul(step(hy, 0.22)).mul(back);
    const pic = step(0.58, hx).mul(step(hx, 0.86)).mul(step(0.45, hy)).mul(step(hy, 0.68)).mul(back);
    const shelfBand = shop ? step(0.5, fract(hy.mul(5))).mul(back).mul(step(0.12, hy)) : float(0);
    const goods = shop ? step(0.45, hash(floor(hx.mul(18)).add(floor(hy.mul(5)).mul(31)).add(seed))).mul(shelfBand) : float(0);
    const wallShade = back.mul(0.75).add(side.mul(0.55)).add(isFloor.mul(0.3)).add(isCeil.mul(0.9));
    let col = pal.mul(wallShade).mul(fall);
    col = col.mul(sofa.mul(-0.8).add(1));
    col = col.add(roomPalette(seed.add(5.0)).mul(pic).mul(0.6));
    col = col.add(roomPalette(seed.add(9.0)).mul(goods).mul(0.9));
    col = col.add(pal.mul(lamp).mul(1.4));
    // TV flicker in some dark rooms
    const tv = step(0.93, hash(seed.add(12.3))).mul(lit.oneMinus()).mul(sin(uTime.mul(9).add(seed.mul(40))).mul(0.3).add(0.5));
    const tvCol = vec3(0.25, 0.45, 1.0).mul(tv).mul(back.add(side.mul(0.6)));
    // blinds over part of some windows
    const hasBlind = step(0.62, hash(seed.add(21.0)));
    const blindLevel = hash(seed.add(4.4)).mul(0.7).add(0.25);
    const blindMask = hasBlind.mul(step(v0.oneMinus(), blindLevel)).mul(shop ? 0 : 1);
    const slats = smoothstep(0.3, 0.5, fract(v0.mul(38))).mul(0.25).add(0.75);
    const blindCol = pal.mul(0.55).mul(slats);
    const inside = mix(col.mul(lit), blindCol.mul(lit.mul(0.9).add(0.04)), blindMask).add(tvCol);
    const intensity = shop ? 1.15 : 0.7;
    return inside.mul(intensity);
  });
  m.colorNode = vec3(0.004, 0.005, 0.007);
  m.emissiveNode = interior();
  m.roughnessNode = float(0.06);
  m.metalnessNode = float(0.0);
  m.envMapIntensity = 1.0;
  // SSR reads reflectivity from the metal/rough target: glass reflects moderately
  m.mrtNode = mrt({ metalrough: vec2(0.3, 0.06) });
  return m;
}

// ------------------------------------------------------------------ far-skyline facades (flat towers, procedural windows)
export function farFacadeMaterial(base, { col = 2.1, floorH = 3.3, lit = 0.36, intensity = 1.0, cool = 0.3 } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ color: base.color, roughness: base.roughness, metalness: base.metalness });
  const em = Fn(() => {
    const n = normalWorld;
    const onX = step(abs(n.z), abs(n.x));
    const u = mix(positionWorld.x, positionWorld.z, onX);
    const g = vec2(u.div(col), positionWorld.y.sub(0.4).div(floorH));
    const cell = floor(g);
    const f = fract(g);
    const win = smoothstep(0.1, 0.16, f.x).mul(smoothstep(0.9, 0.84, f.x)).mul(smoothstep(0.18, 0.24, f.y)).mul(smoothstep(0.88, 0.82, f.y));
    const side = onX.mul(2).add(step(0, n.x.add(n.z)));
    const h1 = hash(cell.x.mul(17.0).add(cell.y.mul(131.0)).add(side.mul(7.0)).add(floor(positionWorld.x.div(40)).mul(3.0)));
    const isLit = step(float(1).sub(lit), h1);
    const wc = mix(vec3(1.0, 0.66, 0.36), vec3(0.55, 0.78, 1.0), step(float(1).sub(cool), hash(h1.add(4.0))));
    const vertical = step(abs(n.y), 0.5).mul(step(5.4, positionWorld.y));
    return wc.mul(isLit).mul(win).mul(vertical).mul(intensity).mul(hash(h1.add(9.0)).mul(0.8).add(0.5));
  });
  m.emissiveNode = em();
  return m;
}

// ------------------------------------------------------------------ signs (instanced, text atlas)
export function signMaterial(atlasTex, cols, rows, tileAttribute, boost) {
  const m = new THREE.MeshBasicNodeMaterial();
  const tile = instancedBufferAttribute(tileAttribute);
  const tc = tile.mod(cols);
  const tr = floor(tile.div(cols));
  const u = uv();
  const tuv = vec2(tc.add(u.x).div(cols), float(1).sub(tr.add(u.y).div(rows)));
  const fh = hash(tile.add(positionWorld.x.mul(0)).add(17.3));
  const flick = Fn(() => {
    const k = floor(uTime.mul(12).add(fh.mul(100)));
    const broken = step(0.85, fh);
    const off = step(0.6, sin(uTime.mul(0.7).add(fh.mul(30)))).mul(step(hash(k.add(fh)), 0.4));
    return float(1).sub(broken.mul(off).mul(0.92)).mul(sin(uTime.mul(3).add(fh.mul(20))).mul(0.06).add(0.94));
  });
  m.colorNode = texture(atlasTex, tuv).rgb.mul(boost).mul(flick());
  return m;
}

// ------------------------------------------------------------------ advert screens
export function screenMaterial(wideAtlas) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = Fn(() => {
    const p = uv();
    const v = p.y.oneMinus();
    const seed = hash(floor(positionWorld.x.mul(0.05)).add(floor(positionWorld.z.mul(0.05)).mul(13)).add(floor(positionWorld.y.mul(0.1)).mul(7)));
    const slot = floor(uTime.div(7).add(seed.mul(13)));
    const kind = slot.mod(3);
    const pal = (t) => vec3(0.5).add(vec3(0.5).mul(cos(vec3(t, t.add(0.33), t.add(0.67)).mul(6.2831))));
    const a = pal(seed.add(slot.mul(0.17)));
    const b = pal(seed.add(slot.mul(0.17)).add(0.45));
    // 0: gradient + word
    const tile = slot.mul(5).add(floor(seed.mul(16))).mod(16);
    const ty = v.mul(2.2).sub(0.6);
    const inText = step(0, ty).mul(step(ty, 1));
    const tuv = vec2(tile.mod(2).add(p.x).div(2), float(1).sub(floor(tile.div(2)).add(ty).div(8)));
    const k0 = mix(a, b, v.add(sin(p.x.mul(6).add(uTime)).mul(0.15))).mul(0.3).add(texture(wideAtlas, tuv).rgb.mul(inText).mul(1.5));
    // 1: rings
    const d = length(p.sub(0.5).mul(vec2(1.78, 1)));
    const r = sin(d.mul(30).sub(uTime.mul(4))).mul(0.5).add(0.5);
    const k1 = mix(a.mul(0.12), b, smoothstep(0.6, 1, r).mul(smoothstep(0.75, 0.1, d))).add(a.mul(smoothstep(0.08, 0, abs(d.sub(0.32)))).mul(1.4));
    // 2: equaliser
    const bx = floor(p.x.mul(24));
    const hgt = abs(sin(uTime.mul(fract(bx.mul(0.37)).mul(3).add(1.5)).add(bx))).mul(0.6).add(0.25);
    const bar = step(v, hgt).mul(step(0.15, fract(p.x.mul(24))));
    const k2 = mix(a.mul(0.06), mix(a, b, v), bar);
    const c = select(kind.lessThan(0.5), k0, select(kind.lessThan(1.5), k1, k2));
    return c.mul(sin(v.mul(420)).mul(0.12).add(0.88)).mul(1.25);
  })();
  return m;
}

// ------------------------------------------------------------------ hologram koi
export function hologramMaterial(tint) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const k = smoothstep(3.5, -6.0, positionLocal.x);
  m.positionNode = positionLocal.add(vec3(0, 0, sin(positionLocal.x.mul(0.75).add(uTime.mul(3.2))).mul(0.75).mul(k)));
  m.colorNode = Fn(() => {
    const V = normalize(cameraPosition.sub(positionWorld));
    const fr = pow(float(1).sub(abs(dot(normalWorld, V))), 2);
    const scan = sin(positionWorld.y.mul(9).sub(uTime.mul(6))).mul(0.4).add(0.6);
    const band = smoothstep(0, 0.05, abs(fract(positionWorld.y.mul(0.25).sub(uTime.mul(0.3))).sub(0.5)).sub(0.42));
    const flick = sin(uTime.mul(37)).mul(sin(uTime.mul(13))).mul(0.15).add(0.85);
    const c = mix(vec3(tint.r, tint.g, tint.b), vec3(1, 0.25, 0.7), uv().x.mul(0.6));
    const a = fr.mul(0.9).add(0.12).mul(scan).mul(flick).add(band.mul(0.3));
    return c.mul(a).mul(2.0);
  })();
  return m;
}

// ------------------------------------------------------------------ wet ground
// Asphalt (or pavement) at world scale, with puddles that go mirror-smooth and
// carry animated rain ripples. SSR provides the reflections.
export function wetGroundMaterial(set, scale, { puddles = 0.55, tint = 1 } = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const wuv = positionWorld.xz.div(scale);
  const orm = texture(set.orm, wuv);
  const pmask = smoothstep(puddles, puddles + 0.06, mx_noise_float(positionWorld.xz.mul(0.06)).mul(0.5).add(0.5).mul(0.75).add(mx_noise_float(positionWorld.xz.mul(0.23)).mul(0.5).add(0.5).mul(0.3)));
  m.colorNode = texture(set.color, wuv).rgb.mul(tint).mul(mix(float(0.75), float(0.35), pmask));
  m.roughnessNode = mix(orm.g.mul(0.62), float(0.02), pmask);
  m.metalnessNode = float(0.0);
  m.aoNode = orm.r;
  // ripples: a grid of drop sites, each with an expanding ring
  const ripple = Fn(() => {
    const g = positionWorld.xz.mul(1.6);
    const cell = floor(g);
    const f = fract(g).sub(0.5);
    const rnd = hash(cell.x.add(cell.y.mul(57.0)));
    const t = fract(uTime.mul(0.9).add(rnd));
    const off = vec2(hash(rnd.add(1.0)), hash(rnd.add(2.0))).sub(0.5).mul(0.5);
    const d = length(f.sub(off));
    const ring = sin(d.sub(t.mul(0.45)).mul(70)).mul(smoothstep(0.08, 0, abs(d.sub(t.mul(0.45))))).mul(float(1).sub(t));
    return ring;
  })();
  // blend in tangent space, then hand the result to normalMap as an encoded map
  const tn = texture(set.normal, wuv).rgb.mul(2).sub(1);
  const rip = ripple.mul(0.2);
  const mixed = normalize(mix(tn, vec3(rip, rip.mul(0.7), 1), pmask));
  m.normalNode = normalMap(mixed.mul(0.5).add(0.5));
  // reflectivity for SSR: puddles act as mirrors, wet asphalt faintly reflects
  m.mrtNode = mrt({ metalrough: vec2(mix(float(0.22), float(0.95), pmask), mix(orm.g.mul(0.62), float(0.02), pmask)) });
  return m;
}

export { THREE };
