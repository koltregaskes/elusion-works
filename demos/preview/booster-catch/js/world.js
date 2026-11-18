// The place: dawn sky, sea and coast, launch pad, tower and catch arms.
// All geometry is original and procedural. Nothing is traced from footage.
import * as THREE from 'three';
import { SITE } from './flight.js';

export const SUN = new THREE.Vector3(0.975, 0.105, 0.19).normalize(); // low in the east-south-east

// Shared GLSL: one sky function used by the sky dome, the sea reflections and the haze.
export const SKY_GLSL = /* glsl */`
uniform vec3 uSun;
uniform float uMode; // 0 visual, 1 blueprint, 2 thermal
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=0.5; } return s; }
vec3 skyColor(vec3 d){
  float up = clamp(d.y, 0.0, 1.0);
  float az = dot(normalize(d.xz + 1e-5), normalize(uSun.xz))*0.5 + 0.5;
  vec3 zen = vec3(0.085, 0.19, 0.42), mid = vec3(0.33, 0.50, 0.78);
  vec3 hor = mix(vec3(0.74, 0.60, 0.66), vec3(1.02, 0.62, 0.36), pow(az, 1.8));
  vec3 c = mix(mid, zen, pow(up, 0.55));
  c = mix(c, mix(vec3(0.52, 0.60, 0.80), hor, 0.55 + 0.45*az), pow(1.0 - up, 5.0));
  c = mix(c, hor, pow(1.0 - up, 22.0));
  c += vec3(0.30, 0.08, 0.10)*pow(1.0 - up, 14.0)*(1.0 - az);
  float sd = max(dot(d, uSun), 0.0);
  c += vec3(1.0, 0.60, 0.28)*(pow(sd, 8.0)*0.16 + pow(sd, 90.0)*0.55);
  if (d.y < 0.0) c = mix(c, hor*0.5, clamp(-d.y*12.0, 0.0, 1.0));
  return c;
}
vec3 hazed(vec3 col, vec3 wpos){
  vec3 v = wpos - cameraPosition; float dist = length(v);
  float k = max(cameraPosition.y, 1.0)/1500.0, thin = (1.0 - exp(-k))/k; // haze hugs the ground: far less of it looking down from altitude
  return mix(col, skyColor(normalize(vec3(v.x, dist*0.015, v.z))), 1.0 - exp(-dist*0.000042*thin));
}
vec3 ironbow(float t){
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.02,0.01,0.08), b = vec3(0.36,0.05,0.52), c = vec3(0.88,0.20,0.22), d = vec3(1.0,0.66,0.08), e = vec3(1.0,0.98,0.86);
  return t<0.25 ? mix(a,b,t*4.0) : t<0.5 ? mix(b,c,(t-0.25)*4.0) : t<0.75 ? mix(c,d,(t-0.5)*4.0) : mix(d,e,(t-0.75)*4.0);
}`;
const OUT = /* glsl */`
#include <tonemapping_fragment>
#include <colorspace_fragment>`;

export const shared = { // uniforms every custom shader reads
  uSun: { value: SUN }, uMode: { value: 0 }, uTime: { value: 0 },
  uFire: { value: new THREE.Vector4(0, -999, 0, 0) }, // xyz position of the engines, w brightness
};

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export { rng };

export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = opts.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

// ---- Sky ------------------------------------------------------------------
export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uSun: shared.uSun, uMode: shared.uMode },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `varying vec3 vDir; ${SKY_GLSL}
    void main(){
      vec3 d = normalize(vDir); vec3 c;
      if (uMode > 1.5) { c = mix(vec3(0.05,0.02,0.12), vec3(0.0,0.0,0.02), clamp(d.y*1.5,0.0,1.0)); }
      else if (uMode > 0.5) { c = mix(vec3(0.030,0.075,0.16), vec3(0.008,0.022,0.06), clamp(d.y*1.4+0.1,0.0,1.0)); }
      else {
        c = skyColor(d);
        float sd = max(dot(d, uSun), 0.0);
        c += vec3(1.0,0.80,0.58)*smoothstep(0.99990, 0.99997, sd)*14.0;
        // thin high cloud, lit from below by the low sun
        vec2 q = d.xz/(max(d.y, 0.0) + 0.16);
        float n = fbm(q*vec2(0.9, 2.6) + vec2(3.0, 1.0));
        float m = smoothstep(0.52, 0.80, n)*smoothstep(0.0, 0.10, d.y)*(1.0 - smoothstep(0.35, 0.8, d.y));
        vec3 lit = mix(vec3(0.78,0.68,0.74), vec3(1.45,0.80,0.52), pow(sd, 3.0));
        c = mix(c, lit, m*0.62);
        // long low streaks hugging the horizon
        float ang = atan(d.z, d.x);
        float band = fbm(vec2(ang*5.0 + 2.0, d.y*52.0))*fbm(vec2(ang*17.0, d.y*130.0 + 4.0));
        float bm = smoothstep(0.20, 0.42, band)*smoothstep(0.004, 0.03, d.y)*(1.0 - smoothstep(0.07, 0.17, d.y));
        vec3 under = mix(vec3(0.46,0.36,0.46), vec3(1.6,0.72,0.34), pow(sd, 2.0)*0.9 + 0.1);
        c = mix(c, under, bm*0.6);
      }
      gl_FragColor = vec4(c, 1.0); ${OUT}
    }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10; mesh.userData.kind = 'env';
  return mesh;
}

// ---- Sea and land in one plane ---------------------------------------------
export function makeGround() {
  const mat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: { uSun: shared.uSun, uMode: shared.uMode, uTime: shared.uTime, uFire: shared.uFire },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `varying vec3 vW; uniform float uTime; uniform vec4 uFire; ${SKY_GLSL}
    float coastX(float z){ return 540.0 + 70.0*sin(z*0.0011) + 26.0*sin(z*0.0043 + 1.3) + 9.0*sin(z*0.013); }
    float padMask(vec2 p){ vec2 q = abs(p - vec2(46.0, -6.0)) - vec2(205.0, 170.0); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
    float lineGrid(vec2 p, float cell){ vec2 g = abs(fract(p/cell - 0.5) - 0.5)/fwidth(p/cell); return 1.0 - min(min(g.x, g.y), 1.0); }
    void main(){
      vec2 p = vW.xz; float cx = coastX(p.y);
      vec3 V = normalize(cameraPosition - vW); float dist = length(cameraPosition - vW);
      float sea = smoothstep(cx - 2.0, cx + 2.0, p.x);
      float fireD = length(vW - uFire.xyz);
      vec3 c;
      if (uMode > 1.5) { // thermal: cold sea, cool ground, warm where the engines wash it
        float t = mix(0.24 + 0.05*fbm(p*0.004), 0.10, sea) + uFire.w*0.9*exp(-fireD/85.0);
        c = ironbow(t);
      } else if (uMode > 0.5) { // blueprint: drafting grid
        float fade = exp(-dist*0.00035);
        float g = lineGrid(p, 20.0)*0.16*fade + lineGrid(p, 100.0)*0.34*exp(-dist*0.00012);
        c = mix(vec3(0.016,0.045,0.11), vec3(0.010,0.030,0.085), sea) + vec3(0.35,0.72,1.0)*g;
        c += vec3(0.35,0.72,1.0)*0.5*(1.0 - smoothstep(0.0, 2.5*fwidth(p.x) + 1.5, abs(p.x - cx)));
      } else {
        // land
        float n1 = fbm(p*0.0016), n2 = fbm(p*0.011 + 40.0), n3 = vnoise(p*0.09);
        vec3 flat1 = vec3(0.36,0.31,0.25), scrub = vec3(0.19,0.21,0.13), sand = vec3(0.62,0.54,0.42);
        vec3 land = mix(flat1, scrub, smoothstep(0.42, 0.62, n1 + 0.25*n2));
        land *= 0.86 + 0.28*n3;
        land = mix(land, sand, smoothstep(cx - 150.0, cx - 20.0, p.x)*(0.7 + 0.3*n2));
        // one access road heading west
        float road = 1.0 - smoothstep(5.0, 6.5, abs(p.y - 60.0 - 40.0*sin(p.x*0.0009)));
        road *= step(p.x, -150.0);
        land = mix(land, vec3(0.13,0.13,0.14), road*0.9);
        // shallow lagoons inland
        float pool = smoothstep(0.60, 0.66, fbm(p*0.0007 + 9.0))*step(p.x, -700.0);
        vec3 light = vec3(0.30,0.36,0.50)*0.85 + vec3(1.0,0.66,0.40)*0.30;
        land *= light;
        land += land*vec3(1.0,0.72,0.5)*uFire.w*5200.0/(fireD*fireD + 900.0);
        // water (sea and lagoons): sky reflection, sun glitter
        float wAmt = max(sea, pool);
        vec2 wp = p*0.045; float ti = uTime*0.55;
        vec2 gn = vec2(vnoise(wp + vec2(ti, 0.3*ti)) - vnoise(wp + vec2(ti + 0.6, 0.3*ti)), vnoise(wp*1.7 - vec2(0.4*ti, ti)) - vnoise(wp*1.7 - vec2(0.4*ti, ti + 0.6)));
        vec3 N = normalize(vec3(gn.x, 1.0, gn.y)*vec3(0.55*exp(-dist*0.00022), 1.0, 0.55*exp(-dist*0.00022)));
        float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 water = mix(vec3(0.015,0.05,0.075), skyColor(R), 0.22 + 0.78*fres);
        water += vec3(1.0,0.72,0.42)*pow(max(dot(R, uSun), 0.0), 520.0)*14.0;
        float foam = smoothstep(0.55, 1.0, sin((p.x - cx)*0.16 - uTime*0.9 + 3.0*vnoise(p*0.02))*0.5 + 0.5)*exp(-max(p.x - cx, 0.0)*0.035)*sea;
        water = mix(water, vec3(0.80,0.74,0.70), foam*0.5);
        c = mix(land, water, wAmt);
        c = hazed(c, vW);
      }
      gl_FragColor = vec4(c, 1.0); ${OUT}
    }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(160000, 160000), mat);
  mesh.rotation.x = -Math.PI / 2; mesh.userData.kind = 'env'; mesh.renderOrder = -5;
  return mesh;
}

// ---- Instanced box beams ----------------------------------------------------
export class Beams {
  constructor() { this.m = []; }
  add(a, b, w, h = w) { // box beam from point a to point b
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.m.push(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, new THREE.Vector3(w, len, h)));
    return this;
  }
  box(cx, cy, cz, sx, sy, sz) { this.m.push(new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz))); return this; }
  build(material, shadow = true) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, this.m.length);
    this.m.forEach((mm, i) => mesh.setMatrixAt(i, mm));
    mesh.castShadow = shadow; mesh.receiveShadow = shadow; mesh.frustumCulled = false;
    return mesh;
  }
}

// ---- Launch site ------------------------------------------------------------
export function makeSite(mats) {
  const g = new THREE.Group();
  const H = SITE.towerHeight, R = 6; // tower half-width

  // Concrete pad
  const padTex = canvasTexture(2048, 2048, (c, w, h) => {
    const r = rng(7);
    c.fillStyle = '#8f877c'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { c.fillStyle = `rgba(${r() < 0.5 ? '40,38,36' : '170,166,160'},${0.03 + r() * 0.05})`; const s = 6 + r() * 60; c.fillRect(r() * w, r() * h, s, s * (0.3 + r())); }
    c.strokeStyle = 'rgba(30,30,30,0.13)'; c.lineWidth = 1.5;
    for (let i = 0; i <= 28; i++) { const p = (i / 28) * w; c.beginPath(); c.moveTo(p, 0); c.lineTo(p, h); c.moveTo(0, p); c.lineTo(w, p); c.stroke(); }
    const scorch = (x, y, rad, a) => { const gr = c.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(12,10,9,${a})`); gr.addColorStop(1, 'rgba(12,10,9,0)'); c.fillStyle = gr; c.fillRect(x - rad, y - rad, rad * 2, rad * 2); };
    const px = x => ((x - 46 + 205) / 410) * w, pz = z => ((z + 6 + 170) / 340) * h;
    // service roads, a paler slab under the mount, a painted keep-out ring under the catch point
    c.fillStyle = 'rgba(38,38,40,0.55)'; c.fillRect(0, pz(52), px(-20), 46); c.fillRect(px(-62), 0, 40, pz(-40)); c.fillRect(px(96), pz(60), 36, h);
    c.fillStyle = 'rgba(190,184,172,0.35)'; c.beginPath(); c.arc(px(15), pz(-19.5), 150, 0, 7); c.fill();
    c.strokeStyle = 'rgba(214,176,60,0.5)'; c.lineWidth = 5; c.setLineDash([26, 16]); c.beginPath(); c.arc(px(29), pz(0), 128, 0, 7); c.stroke(); c.setLineDash([]);
    scorch(px(15), pz(-19), 260, 0.75); scorch(px(29), pz(0), 200, 0.5); scorch(px(60), pz(8), 150, 0.25);
    // ragged, feathered edge so the pad sits in the ground instead of on it
    c.globalCompositeOperation = 'destination-out';
    const edge = (x0, y0, x1, y1, rx, ry, rw, rh) => { const gr = c.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = gr; c.fillRect(rx, ry, rw, rh); };
    edge(0, 0, 90, 0, 0, 0, 90, h); edge(w, 0, w - 90, 0, w - 90, 0, 90, h); edge(0, 0, 0, 90, 0, 0, w, 90); edge(0, h, 0, h - 90, 0, h - 90, w, 90);
    for (let i = 0; i < 520; i++) { const side = i % 4, u = r() * w, d = r() * 120, rad = 14 + r() * 46; c.fillStyle = `rgba(0,0,0,${0.25 + r() * 0.5})`; c.beginPath(); c.arc(side === 0 ? d : side === 1 ? w - d : u, side === 2 ? d : side === 3 ? h - d : u, rad, 0, 7); c.fill(); }
    c.globalCompositeOperation = 'source-over';
  });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(410, 340), new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.92, metalness: 0, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(46, 0.06, -6); pad.receiveShadow = true; pad.userData.temp = 0.27; pad.renderOrder = -4;
  g.add(pad);

  // Tower: four columns, ring beams and cross bracing
  const tb = new Beams();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tb.add([sx * R, 0, sz * R], [sx * R, H - 6, sz * R], 1.9);
  const bays = 14, bh = (H - 6) / bays;
  for (let i = 0; i <= bays; i++) {
    const y = i * bh;
    tb.add([-R, y, -R], [R, y, -R], 0.8); tb.add([-R, y, R], [R, y, R], 0.8); tb.add([-R, y, -R], [-R, y, R], 0.8); tb.add([R, y, -R], [R, y, R], 0.8);
    if (i === bays) break;
    const y2 = y + bh, f = i % 2 ? 1 : -1;
    tb.add([-R, y, -R * f], [-R, y2, R * f], 0.55); // west face
    tb.add([-R * f, y, -R], [R * f, y2, -R], 0.55); // north face
    tb.add([R * f, y, R], [-R * f, y2, R], 0.55); // south face
  }
  tb.add([R + 0.6, 4, -3.4], [R + 0.6, H - 8, -3.4], 0.9); tb.add([R + 0.6, 4, 3.4], [R + 0.6, H - 8, 3.4], 0.9); // carriage rails
  tb.box(0, H - 3, 0, 17, 6, 17); tb.box(2, H + 3, -2, 7, 6, 5); // crown and winch house
  tb.add([-5, H, 5], [-5, H + 20, 5], 0.35); // lightning mast
  tb.box(0, 3, 0, 19, 6, 19); // base
  tb.add([R, 124, -3], [R + 17, 124, -13], 2.2, 2.8); tb.box(R + 17, 124, -13, 4, 4.5, 4); // ship umbilical arm, parked
  const tower = tb.build(mats.steel); tower.userData.temp = 0.24; g.add(tower);

  // Carriage and the two catch arms ("chopsticks")
  const rig = new THREE.Group(); rig.position.y = SITE.armY; g.add(rig);
  const cb = new Beams();
  cb.box(R + 1.6, -3.5, 0, 3.4, 13, 15.5); cb.box(R + 3.4, -1.2, 0, 1.6, 2.4, 13.2);
  const carriage = cb.build(mats.steelLight); carriage.userData.temp = 0.26; rig.add(carriage);
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(SITE.hingeX, 0, side * SITE.hingeZ);
    const ab = new Beams(), L = SITE.armLength, w = 1.1;
    ab.box(L / 2, -0.35, 0, L, 0.7, 2.2); // landing rail on top
    ab.add([0, -4.6, 0], [L, -2.6, 0], 1.3, 1.9); // lower chord, tapering up to the tip
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * L, yb = -4.6 + (2.0 * i) / n;
      ab.add([x, -0.7, -w * 0.7], [x, yb, -w * 0.7], 0.4); ab.add([x, -0.7, w * 0.7], [x, yb, w * 0.7], 0.4);
      if (i < n) { const x2 = ((i + 1) / n) * L, yb2 = -4.6 + (2.0 * (i + 1)) / n; ab.add(i % 2 ? [x, -0.7, 0] : [x, yb, 0], i % 2 ? [x2, yb2, 0] : [x2, -0.7, 0], 0.45, 1.7); }
    }
    ab.box(1.2, -2.4, 0, 3.4, 5.6, 3.2); // hinge block
    ab.add([3, -5.2, -side * 0.2], [15, -3.6, 0], 0.9); // actuator strut
    const mesh = ab.build(mats.steelLight); mesh.userData.temp = 0.27; arm.add(mesh);
    const pad2 = new THREE.Mesh(new THREE.BoxGeometry(L - 4, 0.25, 1.5), mats.rail); pad2.position.set(L / 2 + 1, 0.02, -side * 0.25); pad2.castShadow = true; pad2.userData.temp = 0.3; arm.add(pad2);
    rig.add(arm); arms.push({ group: arm, side });
  }

  // Launch mount: ring table on six legs, north-east of the tower
  const lm = new THREE.Group(); lm.position.set(15, 0, -19.5); g.add(lm);
  const lb = new Beams();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; lb.add([Math.cos(a) * 8.2, 0, Math.sin(a) * 8.2], [Math.cos(a) * 7.4, 18, Math.sin(a) * 7.4], 2.4); }
  const legs = lb.build(mats.concrete); legs.userData.temp = 0.26; lm.add(legs);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(9.6, 9.6, 4.2, 40, 1, true), mats.steelSide); ring.position.y = 20; ring.castShadow = true; ring.userData.temp = 0.26; lm.add(ring);
  const deck = new THREE.Mesh(new THREE.RingGeometry(5.4, 9.6, 40), mats.steel); deck.rotation.x = -Math.PI / 2; deck.position.y = 22.1; deck.userData.temp = 0.26; lm.add(deck);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(12, 13, 1.2, 32), mats.steel); plate.position.y = 0.6; plate.receiveShadow = true; plate.userData.temp = 0.27; lm.add(plate);

  // Tank farm, low buildings, light masts, far-off build site
  const tanks = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 24), mats.tank, 11); const m4 = new THREE.Matrix4();
  for (let i = 0; i < 8; i++) tanks.setMatrixAt(i, m4.compose(new THREE.Vector3(-70 - (i % 4) * 17, 16, -90 - Math.floor(i / 4) * 19), new THREE.Quaternion(), new THREE.Vector3(6, 32, 6)));
  for (let i = 0; i < 3; i++) tanks.setMatrixAt(8 + i, m4.compose(new THREE.Vector3(-64 - i * 26, 5, -52), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2), new THREE.Vector3(4.4, 22, 4.4)));
  tanks.castShadow = true; tanks.receiveShadow = true; tanks.userData.temp = 0.1; g.add(tanks);
  const bb = new Beams(); const r = rng(11);
  bb.box(-120, 4, 60, 34, 8, 16).box(-128, 3, 96, 22, 6, 12).box(110, 2.5, -120, 18, 5, 10).box(150, 3, 110, 14, 6, 14).box(-20, 2, 120, 26, 4, 9);
  for (let i = 0; i < 14; i++) bb.box(-2300 - r() * 900, 0, -500 + r() * 900, 1, 1, 1); // placeholders replaced below
  for (let i = 0; i < 14; i++) { const hgt = 14 + r() * 90, sx = 30 + r() * 70; bb.m[bb.m.length - 14 + i].compose(new THREE.Vector3(-2300 - r() * 1100, hgt / 2, -700 + r() * 1300), new THREE.Quaternion(), new THREE.Vector3(sx, hgt, 26 + r() * 50)); }
  const bld = bb.build(mats.building); bld.userData.temp = 0.25; g.add(bld);
  const masts = new Beams(), lampPos = [];
  for (const [x, z] of [[150, -150], [150, 140], [-110, 140], [-140, -30], [230, -10]]) { masts.add([x, 0, z], [x, 34, z], 0.5); masts.box(x, 34.4, z, 3.2, 0.8, 1.2); lampPos.push([x, 33.7, z]); }
  const mastMesh = masts.build(mats.steel); mastMesh.userData.temp = 0.24; g.add(mastMesh);
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 8, 6), mats.lamp, lampPos.length);
  lampPos.forEach((p, i) => lamps.setMatrixAt(i, m4.makeTranslation(...p))); lamps.userData.temp = 0.62; g.add(lamps);

  return { group: g, arms, rig };
}
