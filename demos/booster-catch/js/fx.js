// Engine plumes, smoke and dust, the flight path line and blueprint labels.
// Every effect is a closed-form function of the replay clock, so scrubbing
// backwards rebuilds exactly the same frame.
import * as THREE from 'three';
import { sample, ENGINES, engineLevel, REF, T_START, T_END, SITE } from './flight.js';
import { shared, rng, SKY_GLSL, canvasTexture } from './world.js';

const OUT = `
#include <tonemapping_fragment>
#include <colorspace_fragment>`;

// ---- Plumes: one stretched cone per landing engine, plus one soft sheath ----
export function makePlumes() {
  const geo = new THREE.CylinderGeometry(0.62, 1.0, 1, 14, 12, true); geo.translate(0, -0.5, 0); // hangs down from the nozzle
  const ig = new THREE.InstancedBufferGeometry().copy(geo); ig.instanceCount = 14;
  const off = new Float32Array(14 * 3), lvl = new Float32Array(14), kind = new Float32Array(14);
  for (let i = 0; i < 13; i++) { const e = ENGINES[i]; off.set([Math.cos(e.a) * e.r, -1.3, Math.sin(e.a) * e.r], i * 3); }
  off.set([0, -1.6, 0], 39); kind[13] = 1;
  ig.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
  const aLvl = new THREE.InstancedBufferAttribute(lvl, 1); aLvl.setUsage(THREE.DynamicDrawUsage); ig.setAttribute('aLvl', aLvl);
  ig.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: shared.uTime, uMode: shared.uMode },
    vertexShader: `attribute vec3 aOff; attribute float aLvl; attribute float aKind; uniform float uTime;
      varying float vV; varying float vL; varying float vK; varying vec3 vN; varying vec3 vE;
      void main(){
        float v = -position.y; vV = v; vL = aLvl; vK = aKind;
        float len = mix(34.0, 58.0, aKind)*(0.35 + 0.65*aLvl)*(1.0 + 0.05*sin(uTime*31.0 + aOff.x*3.0));
        float wide = mix(1.0 + 1.5*v, 4.6 + 4.4*v, aKind);
        vec3 p = vec3(position.x*wide, -v*len, position.z*wide) + aOff;
        p.xz += vec2(sin(uTime*23.0 + v*9.0 + aOff.z), cos(uTime*19.0 + v*7.0 + aOff.x))*0.10*v*len*0.06;
        vec4 mv = modelViewMatrix*vec4(p, 1.0); vE = -mv.xyz; vN = normalMatrix*vec3(position.x, 0.25, position.z);
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `varying float vV; varying float vL; varying float vK; varying vec3 vN; varying vec3 vE; uniform float uTime; uniform float uMode;
      void main(){
        if (vL < 0.004) discard;
        float facing = abs(dot(normalize(vN), normalize(vE)));
        float body = pow(facing, mix(1.6, 0.9, vK));
        float diamonds = 0.62 + 0.38*cos(vV*30.0 - uTime*5.0)*exp(-vV*3.2);
        float along = exp(-vV*mix(2.6, 2.0, vK))*(1.0 - smoothstep(0.82, 1.0, vV));
        vec3 hot = vec3(0.86, 0.90, 1.0), mid = vec3(0.74, 0.46, 1.0), cool = vec3(1.0, 0.44, 0.16);
        vec3 c = mix(mix(hot, mid, smoothstep(0.0, 0.3, vV)), cool, smoothstep(0.2, 0.95, vV));
        float a = body*along*diamonds*vL*mix(1.7, 0.30, vK);
        if (uMode > 1.5) c = vec3(1.0, 0.92, 0.7);
        if (uMode > 0.5 && uMode < 1.5) { c = vec3(0.45, 0.8, 1.0); a *= 0.35; }
        gl_FragColor = vec4(c*a, a); ${OUT}
      }`,
  });
  const mesh = new THREE.Mesh(ig, mat); mesh.frustumCulled = false; mesh.userData.kind = 'fx'; mesh.renderOrder = 5;
  function update(s) {
    let sum = 0; for (let i = 0; i < 13; i++) { lvl[i] = engineLevel(i, s.t); sum += lvl[i]; }
    lvl[13] = Math.min(1, sum / 7) * (0.55 + 0.45 * Math.min(1, sum / 13)); aLvl.needsUpdate = true;
  }
  return { mesh, update };
}

// ---- Smoke, dust, vapour and leftover flame: instanced billboards ----------
export function makeSmoke(maxCount = 1500) {
  const r = rng(21), P = [], s = {};
  const push = (birth, p, v, life, size, kind) => P.push({ birth, p, v, life, size, kind, seed: r() });
  // Dust and steam thrown outward where the exhaust meets the ground
  for (let t = 397.5; t < 416.5; t += 0.027) {
    sample(t, s); if (s.thrust < 0.02 && t < REF.catch) continue;
    const a = r() * Math.PI * 2, sp = 16 + r() * 44, rad = 3 + r() * 9, power = Math.min(1, 150 / Math.max(s.y, 30));
    if (r() > power) continue;
    push(t, [s.x - s.leanX * s.y + Math.cos(a) * rad, 0.8, s.z - s.leanZ * s.y + Math.sin(a) * rad], [Math.cos(a) * sp, 1.5 + r() * 6, Math.sin(a) * sp], 4 + r() * 4, 6 + r() * 10, 0);
  }
  // Thin exhaust haze left along the braking path
  for (let t = REF.burn; t < 400; t += 0.035) {
    sample(t, s); push(t, [s.x + (r() - 0.5) * 8, s.y - 20 - r() * 30, s.z + (r() - 0.5) * 8], [(r() - 0.5) * 8, -s.vDown * 0.25 - 10, (r() - 0.5) * 8], 3.5 + r() * 3, 12 + r() * 14, 1);
  }
  // After the catch: cold vapour venting near the top, dark smoke and flame at the base
  for (let t = REF.catch + 0.4; t < T_END; t += 0.03) {
    sample(t, s); const a = 2.2 + (r() - 0.5) * 0.5;
    push(t, [s.x + Math.cos(a) * 4.6, s.y + 56 + r() * 4, s.z + Math.sin(a) * 4.6], [Math.cos(a) * (9 + r() * 6), 1 + r() * 2, Math.sin(a) * (9 + r() * 6)], 2 + r() * 1.6, 2.5 + r() * 3, 2);
    if (r() < 0.6) push(t, [s.x + (r() - 0.5) * 6, s.y - 1, s.z + (r() - 0.5) * 6], [(r() - 0.5) * 3, 5 + r() * 5, (r() - 0.5) * 3], 3 + r() * 3, 4 + r() * 6, 3);
    if (r() < 0.75) push(t, [s.x + (r() - 0.5) * 5.5, s.y - 0.8, s.z + (r() - 0.5) * 5.5], [(r() - 0.5) * 2, 6 + r() * 7, (r() - 0.5) * 2], 0.5 + r() * 0.7, 2.2 + r() * 2.6, 4);
    if (r() < 0.5) push(t, [s.x + 4.9 + r() * 0.4, s.y + 6 + r() * 16, s.z + 3.4], [1 + r() * 2, 5 + r() * 6, (r() - 0.5) * 2], 0.45 + r() * 0.6, 1.4 + r() * 1.8, 4);
  }
  // Interleave so that a reduced count still covers the whole timeline
  const order = P.map((_, i) => i).sort((a, b) => P[a].seed - P[b].seed), n = Math.min(maxCount, P.length);
  const quad = new THREE.PlaneGeometry(1, 1), ig = new THREE.InstancedBufferGeometry().copy(quad); ig.instanceCount = n;
  const A = new Float32Array(n * 4), B = new Float32Array(n * 4), C = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) { const p = P[order[k]]; A.set([p.p[0], p.p[1], p.p[2], p.birth], k * 4); B.set([p.v[0], p.v[1], p.v[2], p.life], k * 4); C.set([p.size, p.kind, p.seed, 0], k * 4); }
  ig.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 4)); ig.setAttribute('aB', new THREE.InstancedBufferAttribute(B, 4)); ig.setAttribute('aC', new THREE.InstancedBufferAttribute(C, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uTime: shared.uTime, uMode: shared.uMode, uSun: shared.uSun, uFire: shared.uFire, uClock: { value: 0 } },
    vertexShader: `attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; uniform float uClock;
      varying vec2 vUv; varying float vAge; varying float vKind; varying float vSeed; varying vec3 vW;
      void main(){
        float age = uClock - aA.w, life = aB.w; vUv = uv; vKind = aC.y; vSeed = aC.z; vAge = age/life;
        if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float drag = aC.y < 0.5 ? 0.55 : aC.y < 1.5 ? 1.4 : 1.0;
        vec3 p = aA.xyz + aB.xyz*(1.0 - exp(-age*drag))/drag;
        p.y += (aC.y < 0.5 ? 2.2 : aC.y < 1.5 ? 0.5 : 1.0)*age; p.x -= 1.6*age; p.y = max(p.y, 0.6);
        float grow = aC.y > 3.5 ? 1.0 - 0.5*vAge : 0.55 + (aC.y < 0.5 ? 0.85 : 0.6)*age;
        float size = aC.x*grow;
        vec4 mv = viewMatrix*vec4(p, 1.0);
        float rot = aC.z*6.283 + age*(aC.z - 0.5)*0.8; vec2 q = position.xy*size;
        mv.xy += vec2(q.x*cos(rot) - q.y*sin(rot), q.x*sin(rot) + q.y*cos(rot));
        vW = p; gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `varying vec2 vUv; varying float vAge; varying float vKind; varying float vSeed; varying vec3 vW;
      uniform vec4 uFire; uniform float uTime; ${SKY_GLSL}
      void main(){
        vec2 q = vUv - 0.5; float rr = length(q)*2.0; if (rr > 1.0) discard;
        float n = fbm(q*3.2 + vSeed*31.0);
        float soft = smoothstep(1.0, 0.25, rr + (n - 0.5)*0.75);
        float fade = smoothstep(0.0, 0.10, vAge)*(1.0 - smoothstep(0.45, 1.0, vAge));
        vec3 c; float a;
        if (vKind > 3.5) { // flame
          c = mix(vec3(1.0, 0.82, 0.45), vec3(1.0, 0.30, 0.05), vAge)*3.2; a = soft*fade*0.85;
          if (uMode > 0.5 && uMode < 1.5) a = 0.0;
          gl_FragColor = vec4(c*a, a*0.25); ${OUT} return;
        }
        float fd = length(vW - uFire.xyz);
        vec3 lit = vec3(0.44,0.47,0.56)*0.75 + vec3(1.0,0.62,0.36)*0.55*(0.4 + 0.6*n);
        if (vKind < 0.5) { c = vec3(0.62,0.56,0.50)*lit; a = 0.17; }
        else if (vKind < 1.5) { c = vec3(0.80,0.80,0.84)*lit; a = 0.10; }
        else if (vKind < 2.5) { c = vec3(0.95,0.96,1.0)*lit*1.1; a = 0.20; }
        else { c = vec3(0.16,0.15,0.15)*lit; a = 0.40; }
        c += vec3(1.0,0.55,0.25)*uFire.w*2600.0/(fd*fd + 500.0)*(0.5 + 0.5*n);
        a *= soft*fade;
        if (uMode > 1.5) { c = ironbow(0.34 + 0.22*(1.0 - vAge) + uFire.w*30.0/(fd + 30.0)); a *= 0.45; }
        else if (uMode > 0.5) { c = vec3(0.35,0.7,1.0); a *= 0.12; }
        else c = hazed(c, vW);
        gl_FragColor = vec4(c*a, a); ${OUT}
      }`,
  });
  const mesh = new THREE.Mesh(ig, mat); mesh.frustumCulled = false; mesh.userData.kind = 'fx'; mesh.renderOrder = 6;
  return { mesh, setClock: t => { mat.uniforms.uClock.value = t; }, setCount: c => { ig.instanceCount = Math.min(n, c); }, total: n };
}

// ---- Flight path: the line the booster base follows, with one tick a second --
export function makePath() {
  const pts = [], col = [], s = {}, c = new THREE.Color();
  for (let t = T_START; t <= REF.catch; t += 0.1) { sample(t, s); pts.push(s.x, s.y, s.z); c.setHSL(0.08 + 0.48 * (1 - s.thrust), 0.9, 0.62); col.push(c.r, c.g, c.b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, fog: false, toneMapped: false }));
  const ticks = [];
  for (let t = T_START; t <= REF.catch; t += 1) { sample(t, s); const w = t % 6 === 0 ? 9 : 4; ticks.push(s.x - w, s.y, s.z, s.x + w, s.y, s.z); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  const group = new THREE.Group(); group.add(line, new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.7, fog: false, toneMapped: false })));
  group.traverse(o => { o.userData.kind = 'overlay'; o.frustumCulled = false; }); group.visible = false;
  return group;
}

// ---- Blueprint callouts ------------------------------------------------------
export function makeLabel(text, size = 5) {
  const tex = canvasTexture(512, 96, (c, w, h) => {
    c.font = '600 44px ui-monospace, "SF Mono", Menlo, Consolas, monospace'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(8,24,52,0.82)'; const tw = Math.min(w - 8, c.measureText(text).width + 36); c.fillRect(0, 12, tw, h - 24);
    c.strokeStyle = '#8fd0ff'; c.lineWidth = 3; c.strokeRect(1.5, 13.5, tw - 3, h - 27); c.fillStyle = '#d9f0ff'; c.fillText(text, 18, h / 2 + 2);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false, toneMapped: false }));
  sp.center.set(0, 0.5); sp.scale.set(size * 5.33, size, 1); sp.userData.kind = 'overlay'; sp.renderOrder = 20;
  return sp;
}
export function makeCallouts(boosterGroup) {
  const world = new THREE.Group(), onBooster = new THREE.Group();
  const put = (grp, text, x, y, z, size) => { const l = makeLabel(text, size); l.position.set(x, y, z); grp.add(l); };
  put(world, 'Tower 146 m', 12, SITE.towerHeight + 6, 0, 7); put(world, 'Catch arms, rails at 88 m', 30, SITE.armY + 7, 12, 6); put(world, 'Launch mount', 28, 26, -24, 5);
  put(onBooster, 'Booster 71 m x 9 m', 7, 69, 0, 6); put(onBooster, 'Grid fins (x4)', 9.5, 63.5, 3, 5); put(onBooster, 'Catch pins (x2)', 6.5, SITE.pinY, 6, 5);
  put(onBooster, 'Methane tank', 6, 46, 0, 5); put(onBooster, 'Liquid oxygen tank', 6, 16, 0, 5); put(onBooster, '33 engines, 13 relight to land', 6, -1, 0, 5);
  boosterGroup.add(onBooster); world.visible = false; onBooster.visible = false;
  return { world, onBooster };
}
