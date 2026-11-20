// Hall of Forever: a real web page, drawn into WebGL with HTML-in-Canvas, and eaten by a black hole.
(() => {
'use strict';

const canvas = document.getElementById('stage');
const page = document.getElementById('page');
const hud = document.getElementById('hud');
const note = document.getElementById('note');
const remainEl = document.querySelector('#remain b');
const sndBtn = document.getElementById('snd');
const reformBtn = document.getElementById('reform');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const live = !/[?&]snapshot/.test(location.search) && (() => { const t = document.createElement('canvas'); t.setAttribute('content', 'drawable'); return t.content === 'drawable'; })();
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
if (!gl) { // no WebGL2 at all: just show the page
  canvas.after(page); canvas.hidden = true; document.body.style.overflow = 'auto'; hud.hidden = true; return;
}
gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');

// ---------- the Andromeda drawing for card 002 ----------
(() => {
  const svg = document.getElementById('galaxy'); if (!svg) return;
  let s = '<g transform="translate(200 150) rotate(-24) scale(1 .46)">';
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let arm = 0; arm < 2; arm++) for (let i = 0; i < 230; i++) {
    const t = i / 230, a = arm * Math.PI + t * 9.5, r = 8 + t * 165;
    const x = Math.cos(a) * r + (rnd() - .5) * 18 * t, y = Math.sin(a) * r + (rnd() - .5) * 18 * t;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.6 + rnd() * 1.6 * (1 - t * .6)).toFixed(2)}" fill="${rnd() < .07 ? '#d8ff3c' : '#f4eedf'}" opacity="${(0.45 + rnd() * .55).toFixed(2)}"/>`;
  }
  s += '<ellipse rx="26" ry="20" fill="#f4eedf"/><ellipse rx="44" ry="34" fill="none" stroke="#f4eedf" stroke-width=".8" opacity=".5"/></g>';
  for (let i = 0; i < 60; i++) s += `<circle cx="${(rnd() * 400).toFixed(1)}" cy="${(rnd() * 300).toFixed(1)}" r="${(rnd() * .9 + .3).toFixed(2)}" fill="#f4eedf" opacity=".6"/>`;
  svg.innerHTML = s;
})();

// ---------- GL helpers ----------
function sh(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
  return s;
}
function prog(vs, fs) {
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}
function tex(w, h, internal, format, type, filter) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function fbo(texs) {
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
  gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  return f;
}
const hdrT = (w, h) => tex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);

const FSQ_VS = `#version 300 es
in vec2 aP; out vec2 vUv; void main(){ vUv = aP*.5+.5; gl_Position = vec4(aP,0.,1.); }`;

const NOISE = `
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p = p*2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
float pnoise(vec2 p, float per){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  float y0 = mod(i.y, per), y1 = mod(i.y+1., per);
  return mix(mix(hash(vec2(i.x,y0)), hash(vec2(i.x+1.,y0)), f.x), mix(hash(vec2(i.x,y1)), hash(vec2(i.x+1.,y1)), f.x), f.y); }
float pfbm(vec2 p, float per){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a*pnoise(p, per); p *= 2.; per *= 2.; a *= .5; } return s; }
`;

// ---------- shaders ----------
// 1. Ray tracer: Schwarzschild photon paths (units: horizon radius = 1), thin tilted accretion disc.
const TRACE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float uRt, uDp, uTime, uDiscIn, uDiscOut, uFeed, uRsPx, uSpin, uText;
uniform sampler2D uPage; uniform vec2 uPagePt, uPageSize;
uniform vec3 uNd, uE1, uE2;
layout(location=0) out vec4 oLens;
layout(location=1) out vec4 oDisc;
${NOISE}
vec3 ramp(float k){
  vec3 c = mix(vec3(.42,.10,.03), vec3(1.,.42,.10), smoothstep(.25,.6,k));
  c = mix(c, vec3(1.,.76,.38), smoothstep(.55,.9,k));
  c = mix(c, vec3(1.,.95,.86), smoothstep(.85,1.25,k));
  c = mix(c, vec3(.86,.93,1.08), smoothstep(1.25,1.8,k));
  return c;
}
vec4 disc(vec3 P, vec3 dir){
  float r = length(P);
  float x = dot(P,uE1), y = dot(P,uE2);
  float phi = atan(y,x);
  float om = uSpin*2.4*pow(r,-1.5);
  float T = 7.;
  float t1 = fract(uTime/T), t2 = fract(uTime/T + .5);
  float w1 = 1. - abs(t1*2. - 1.);
  float per = 9.;
  float a1 = (phi + om*t1*T)/6.2831853 + .5, a2 = (phi + om*t2*T)/6.2831853 + .5;
  vec2 q1 = vec2(r*3.6 + 3.1, a1*per), q2 = vec2(r*3.6 + 3.1, a2*per);
  float n = pfbm(q1, per)*w1 + pfbm(q2 + vec2(7.3,0.), per)*(1.-w1);
  vec2 q1b = vec2(r*7.5, a1*per*3.), q2b = vec2(r*7.5, a2*per*3.);
  float nb = pfbm(q1b, per*3.)*w1 + pfbm(q2b + vec2(3.1,0.), per*3.)*(1.-w1);
  float dens = smoothstep(.3, .82, n + (nb - .5)*.55);
  // the disc is made of the page it has eaten: its words, unrolled around the orbit and stretched thin
  float L = 6.2831853*r*uRsPx*1.9;
  float yp = uPagePt.y + (r - 6.5)*uRsPx*1.35;
  vec2 s1 = vec2(uPagePt.x + (a1 - .5)*L, yp), s2 = vec2(uPagePt.x + (a2 - .5)*L + 37., yp);
  vec3 c1 = textureLod(uPage, s1/uPageSize, .6).rgb, c2 = textureLod(uPage, s2/uPageSize, .6).rgb;
  float l1 = dot(c1, vec3(.3,.6,.1)), l2 = dot(c2, vec3(.3,.6,.1));
  float seam1 = sin(3.14159*a1), seam2 = sin(3.14159*a2);
  float tm = smoothstep(.5, .72, l1)*seam1*w1 + smoothstep(.5, .72, l2)*seam2*(1. - w1);
  tm *= uText;
  dens = clamp(dens*(1. - .3*uText) + tm*.9, 0., 1.);
  float edge = smoothstep(uDiscIn, uDiscIn*1.25, r) * (1. - smoothstep(uDiscOut*.45, uDiscOut, r));
  vec3 ph = normalize(P);
  vec3 tang = normalize(cross(uNd, ph));
  float v = min(sqrt(.5/max(r-1., .35)), .62);
  float g = sqrt(1.-v*v)/(1. - v*dot(tang, -dir));
  g = min(g, 1.28);
  g *= sqrt(max(1. - 1./r, .05));
  float temp = pow(uDiscIn/r, .7);
  float clump = smoothstep(.5, .85, n);
  float I = edge * (.08 + pow(dens, 1.2)*1.1) * (.45 + 1.5*clump) * pow(g, 1.3) * pow(uDiscIn/r, 1.2) * (3.3 + uFeed*2.5);
  vec3 col = ramp(temp*g*.88) * I;
  float a = clamp(edge*(.12 + dens*.8)*smoothstep(uDiscOut, uDiscOut*.55, r), 0., .97);
  return vec4(col, a);
}
void main(){
  vec2 o = (vUv*2. - 1.)*uRt;
  float z0 = uRt;
  vec3 pos = vec3(o, z0);
  vec3 vel = vec3(0., 0., -1.);
  vec3 cr = cross(pos, vel); float h2 = dot(cr, cr);
  vec3 col = vec3(0.); float acc = 0.; float vis = 1.;
  for (int i = 0; i < 220; i++){
    float r = length(pos);
    if (r < 1.0){ vis = 0.; break; }
    if (r > z0*1.02 && dot(pos, vel) > 0.) break;
    float dt = clamp(.075*r*r/(r+1.5), .012, 1.4);
    vec3 a = -1.5*h2*pos/pow(r, 5.);
    vec3 nv = vel + a*dt;
    vec3 np = pos + nv*dt;
    float s1 = dot(pos, uNd), s2 = dot(np, uNd);
    if (s1*s2 < 0. && acc < .995){
      vec3 P = mix(pos, np, s1/(s1 - s2));
      float rr = length(P);
      if (rr > uDiscIn && rr < uDiscOut){
        vec4 d = disc(P, normalize(nv));
        col += (1. - acc)*d.rgb;
        acc += (1. - acc)*d.a;
      }
    }
    float rn = length(np);
    pos = np; vel = nv;
    if (i == 219) vis = 0.;
  }
  vec2 land = vec2(0.);
  if (vis > 0.){
    vec3 dir = normalize(vel);
    if (dir.z < -.03){ float t = (-uDp - pos.z)/dir.z; land = pos.xy + dir.xy*t; }
    else land = normalize(pos.xy + 1e-4)*90.;
  }
  oLens = vec4(land*uRsPx, vis, 1.);
  oDisc = vec4(col, acc);
}`;

// 2. Composite: lensed page, tears, space, disc.
const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPage, uDamage, uLens, uDiscT;
uniform vec2 uRes, uView, uPageSize, uTiles, uHole;
uniform float uDpr, uTile, uScroll, uRt, uBE, uTime, uPull, uPullL, uSwirl, uShadow, uHasPage;
uniform vec4 uWave;
uniform float uShredR, uCurl, uShredDepth, uHot, uMaskR;
out vec4 o;
${NOISE}
vec3 space(vec2 p){
  vec3 c = vec3(.006,.009,.03);
  float neb = fbm(p*.0035 + 3.1), neb2 = fbm(p*.009 + 9.);
  c += vec3(.05,.06,.22)*smoothstep(.4,.9,neb)*(.6 + neb2) + vec3(.3,.12,.18)*smoothstep(.62,.95,neb2)*.35;
  for (int k = 0; k < 3; k++){
    float sc = k == 0 ? 7. : (k == 1 ? 15. : 31.);
    vec2 g = p/sc; vec2 id = floor(g); vec2 f = fract(g) - .5;
    float h = hash(id + float(k)*17.);
    if (h > .72){
      vec2 off = vec2(hash(id+3.1), hash(id+5.7)) - .5;
      float d = length(f - off*.7);
      float b = (h - .72)/.28;
      c += mix(vec3(1.,.85,.6), vec3(.7,.8,1.), hash(id+9.))*smoothstep(.14, 0., d)*(.5 + 3.*b*b*b)*(k == 2 ? 1.6 : 1.);
    }
  }
  return c;
}
void main(){
  vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y)/uDpr;
  vec2 d = css - uHole; d.y = -d.y;
  float b = length(d);
  // spaghettification: around the hole the (lensed) page is shredded into strips that narrow, stretch and curl inwards
  float gap = 0., stripShade = 1., fibre = 0., hot = 0., zone = 1., rim = 0., rimHot = 0.;
  vec2 dq = d;
  float inner = uShadow*.92;
  if (uShredR > inner && b < uShredR){
    float z = clamp((b - inner)/(uShredR - inner), 0., 1.);
    float th = atan(d.y, d.x);
    float curl = uCurl*(1. - z)*(1. - z) + .18*(fbm(vec2(cos(th), sin(th))*1.3 + vec2(z*1.4 - uTime*.04, 0.)) - .5);
    float N = 14.;
    float a0 = (th + curl)/6.2831853*N;
    // a few unequal ruptures: warp the angular partition monotonically
    float a = a0 + .5*sin(a0*6.2831853/7.) + .28*sin(a0*6.2831853/3.5 + 1.7);
    // torn, jagged boundaries between chunks
    a += (pnoise(vec2(z*9., a0*3. + N*3.), N*3.) - .5)*.22*(1. - z);
    float k = mod(floor(a), N), u = fract(a) - .5;
    float hk = hash(vec2(k, 7.1)), hl = hash(vec2(k, 3.3)), hb = hash(vec2(k, 9.4)) - .5, ho = hash(vec2(k, 5.6));
    u -= hb*.5*(1. - z)*(1. - z);                                  // each piece bends its own way
    float zOpen = .35 + .55*ho*uShredDepth;                        // each piece ruptures at its own depth
    float open = smoothstep(zOpen + .12, zOpen - .2, z);
    // whole chunks near the rupture, pulled into fine strands near the horizon
    float strand = smoothstep(.45, .05, z);
    float w = mix(1., mix(.55 + .35*hk, .07 + .1*hk, strand), open);
    w += (vnoise(vec2(k*5.1, z*16.)) - .5)*.18*open*(1. - strand);
    float tip = (.0 + .5*hl*hl*hl)*uShredDepth;
    float aw = fwidth(a)*1.2;
    gap = max(smoothstep(w*.5 - aw, w*.5 + aw, abs(u)), 1. - smoothstep(tip - .03, tip + .03, z))*smoothstep(1., .9, z);
    float uu = clamp(u/max(w, .05), -.5, .5);
    float thS = (k + .5 + uu)/N*6.2831853 - curl;
    float bs = uShredR - (uShredR - b)*mix(.62, .38, strand);
    dq = mix(d, vec2(cos(thS), sin(thS))*bs, smoothstep(1., .8, z));
    float sepr = clamp((1. - w)*2.2, 0., 1.)*open;
    stripShade = mix(1., .76 + .28*cos(uu*3.14159), sepr);
    fibre = 0.;
    float eLat = smoothstep(w*.5 - 2.5*aw - .03, w*.5 - aw, abs(u))*open;
    float eTip = smoothstep(tip + .08, tip + .01, z)*step(.001, uShredDepth);
    rim = clamp(max(eLat, eTip), 0., 1.);
    rimHot = smoothstep(.6, .12, z);
    hot = (pow(1. - z, 2.5) + .6*strand*smoothstep(.3, .5, abs(uu)))*uHot;
  }
  zone = smoothstep(uMaskR*.82, uMaskR, b);
  float bq = length(dq);
  vec2 analytic = dq*(1. - uBE*uBE/max(bq*bq, 1.)/(1. + bq*bq/(3.*uBE*uBE)));
  vec2 land = analytic; float vis = 1.; vec4 dc = vec4(0.);
  if (abs(d.x) < uRt && abs(d.y) < uRt){
    vec2 luv = d/uRt*.5 + .5;
    vec4 L = texture(uLens, luv);
    dc = texture(uDiscT, luv);
    float w = smoothstep(.72*uRt, .96*uRt, max(abs(d.x), abs(d.y)));
    vis = mix(L.z, 1., w); dc *= 1. - w;
    vec4 Lq = texture(uLens, dq/uRt*.5 + .5);
    float wq = smoothstep(.72*uRt, .96*uRt, max(abs(dq.x), abs(dq.y)));
    land = mix(Lq.xy, analytic, wq);
  }
  // the fabric of the page gets pulled and twisted towards the hole
  float rl = length(land);
  float pullR = rl + uPull*uPullL*exp(-rl/uPullL);
  float ang = uSwirl*exp(-rl/uPullL);
  vec2 dirl = rl > 1e-3 ? land/rl : vec2(1.,0.);
  float ca = cos(ang), sa = sin(ang);
  dirl = vec2(ca*dirl.x - sa*dirl.y, sa*dirl.x + ca*dirl.y);
  vec2 landP = dirl*pullR;
  vec2 pc = uHole + vec2(landP.x, -landP.y) + vec2(0., uScroll);
  float wd = 0.;
  if (uWave.w > 0.){
    vec2 wv = pc - uWave.xy; float wl = length(wv);
    wd = (wl - uWave.z)/60.;
    pc -= wv/max(wl, 1.)*uWave.w*16.*wd*exp(-wd*wd);
  }
  vec2 sp = uHole + vec2(land.x, -land.y) + vec2(0., uScroll*.12);
  vec3 col = space(sp);
  float lr = length(land)/uShadow;
  col += vec3(1.,.55,.2)*.05*exp(-lr*1.2) + vec3(.25,.35,1.)*.04*exp(-lr*.25);
  if (uHasPage > .5 && pc.x >= 0. && pc.y >= 0. && pc.x <= uPageSize.x && pc.y <= uPageSize.y){
    vec3 pg = texture(uPage, pc/uPageSize).rgb;
    vec2 dt = uTile/(uTiles*uTile)*.55;
    vec2 duv = pc/(uTiles*uTile);
    vec4 dm = texture(uDamage, duv)*.4 + (texture(uDamage, duv + vec2(dt.x, 0.)) + texture(uDamage, duv - vec2(dt.x, 0.)) + texture(uDamage, duv + vec2(0., dt.y)) + texture(uDamage, duv - vec2(0., dt.y)))*.15;
    float tear = 0.;
    pg *= stripShade;
    pg += vec3(1.,.55,.18)*hot*hot*.5;
    // torn edges: pale paper fibre out at the rim, incandescent where the strips are being consumed
    pg = mix(pg, vec3(.96,.92,.84), rim*(1. - rimHot)*.7);
    pg = mix(pg, vec3(1.,.62,.24)*(1.6 + 2.2*rimHot), rim*rimHot*.9);
    if (dm.r > .003){
      float n = fbm(pc*.022) - .5 + (vnoise(pc*.3) - .5)*.12;
      float f = dm.r + n*.6;
      tear = smoothstep(.5, .51, f)*zone;
      float edge = smoothstep(.43, .5, f)*(1. - tear)*zone;
      pg = mix(pg, vec3(.95,.92,.84), edge*.55);                  // torn paper: a pale fibrous edge
      pg *= 1. - .35*smoothstep(.3, .45, f)*(1. - edge)*(1. - tear); // with a soft shadow just behind it
      pg += vec3(1.,.6,.25)*edge*dm.g*.5;                        // warm only while it is fresh
    }
    col = mix(pg, col, max(tear, gap));
    col += vec3(1.,.72,.3)*dm.b*.5*(1. - tear);
  }
  if (uWave.w > 0.) col += vec3(1.,.78,.42)*uWave.w*.22*exp(-pow(wd*2.2 - .3, 2.));
  col *= vis;
  // a faint glow hugging the shadow
  float sh = b/uShadow;
  col += vec3(1.,.62,.25)*.05*exp(-(sh-1.)*3.)*step(1., sh);
  col = col*(1. - dc.a) + dc.rgb;
  o = vec4(col, 1.);
}`;

// 3. Torn fragments, falling in.
const PART_VS = `#version 300 es
in vec2 aP;
in vec4 iA; in vec4 iB; in vec4 iC;
uniform vec2 uView, uPageSize;
out vec2 vUv; out vec2 vC; out float vHeat; out float vAlpha; out float vSeed; out float vShade;
void main(){
  vec2 c = aP*.5;
  float ang = iA.z;
  float flip = cos(iB.w*40. + ang*2.3);
  float taper = mix(1., .3, smoothstep(0., 1., (c.x + .5))*clamp(iB.x/iC.z - 1., 0., 1.));
  vec2 l = vec2(c.x*iB.x, c.y*iB.y*(.55 + .45*abs(flip))*taper);
  vShade = .78 + .3*(flip*.5 + .5) + c.x*.12*sign(flip);
  vec2 p = iA.xy + vec2(cos(ang)*l.x - sin(ang)*l.y, sin(ang)*l.x + cos(ang)*l.y);
  vUv = (iC.xy + (c + .5)*iC.zw)/uPageSize;
  vC = c; vHeat = iB.z; vAlpha = iA.w; vSeed = iB.w;
  gl_Position = vec4(p.x/uView.x*2. - 1., 1. - p.y/uView.y*2., 0., 1.);
}`;
const PART_FS = `#version 300 es
precision highp float;
uniform sampler2D uPage;
in vec2 vUv; in vec2 vC; in float vHeat; in float vAlpha; in float vSeed; in float vShade;
out vec4 o;
${NOISE}
void main(){
  vec2 q = abs(vC)*2.;
  float rag = fbm(vC*vec2(5., 3.) + vSeed*31.)*.75 + vnoise(vC*22. + vSeed*7.)*.18;
  float m = smoothstep(1., .88, length(q*vec2(.85, 1.)) + rag*.55);
  vec3 c = texture(uPage, vUv).rgb*vShade;
  vec3 hot = mix(vec3(1.,.42,.08), vec3(1.,.7,.35), vHeat*vHeat)*(1. + vHeat*.6);
  c = mix(c, hot, smoothstep(.2, 1., vHeat));
  c += vec3(1.,.6,.2)*.25*vHeat;
  float rim = smoothstep(.72, .97, max(q.x, q.y) + rag*.5)*m;
  c = mix(c, vec3(.95,.92,.84), rim*.35*(1. - vHeat));
  c += vec3(1.,.5,.12)*rim*2.*vHeat;
  float a = m*vAlpha;
  o = vec4(c*a, a*(1. - vHeat*.6));
}`;

// 4. Bloom chain.
const BRIGHT_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uT; uniform vec2 uTx; out vec4 o;
void main(){
  vec3 c = vec3(0.);
  for (int i = 0; i < 4; i++){ vec2 off = vec2(i == 0 || i == 2 ? -1. : 1., i < 2 ? -1. : 1.)*uTx; c += texture(uT, vUv + off).rgb; }
  c *= .25;
  float l = max(c.r, max(c.g, c.b));
  float k = smoothstep(1.1, 3., l);
  o = vec4(c*k, 1.);
}`;
const DOWN_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uT; uniform vec2 uTx; out vec4 o;
void main(){
  vec3 c = texture(uT, vUv).rgb*4.;
  c += texture(uT, vUv + vec2(-1.,-1.)*uTx).rgb + texture(uT, vUv + vec2(1.,-1.)*uTx).rgb;
  c += texture(uT, vUv + vec2(-1.,1.)*uTx).rgb + texture(uT, vUv + vec2(1.,1.)*uTx).rgb;
  o = vec4(c/8., 1.);
}`;
const UP_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uT; uniform vec2 uTx; uniform float uK; out vec4 o;
void main(){
  vec3 c = vec3(0.);
  c += texture(uT, vUv + vec2(-1., 0.)*uTx*2.).rgb + texture(uT, vUv + vec2(1., 0.)*uTx*2.).rgb;
  c += texture(uT, vUv + vec2(0., -1.)*uTx*2.).rgb + texture(uT, vUv + vec2(0., 1.)*uTx*2.).rgb;
  c += (texture(uT, vUv + vec2(-1.,-1.)*uTx).rgb + texture(uT, vUv + vec2(1.,-1.)*uTx).rgb + texture(uT, vUv + vec2(-1.,1.)*uTx).rgb + texture(uT, vUv + vec2(1.,1.)*uTx).rgb)*2.;
  o = vec4(c/12.*uK, 1.);
}`;
// 5. Final grade.
const FINAL_FS = `#version 300 es
precision highp float; in vec2 vUv;
uniform sampler2D uScene, uBloom; uniform vec2 uHoleUv, uAspect; uniform float uTime, uShadowUv, uFlash;
out vec4 o;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)))*43758.5453); }
vec3 tm(vec3 x){ vec3 a = max(x - .78, 0.); return min(x, .78) + .22*(1. - exp(-a/.22)); }
void main(){
  vec2 d = (vUv - uHoleUv)*uAspect;
  float r = length(d);
  float ca = .0016*exp(-r/(uShadowUv*2.5))*(r/(uShadowUv*2.));
  vec2 dir = r > 0. ? d/r/uAspect : vec2(0.);
  vec3 c;
  c.r = texture(uScene, vUv + dir*ca).r;
  c.g = texture(uScene, vUv).g;
  c.b = texture(uScene, vUv - dir*ca).b;
  vec3 bl = texture(uBloom, vUv).rgb*smoothstep(.8, 1.15, r/uShadowUv);
  c += bl*.65 + vec3(1.,.9,.75)*uFlash*exp(-r/(uShadowUv*6.))*step(uShadowUv, r);
  c = tm(c);
  vec2 v = (vUv - .5)*uAspect;
  c *= 1. - .22*smoothstep(.35, 1.1, length(v));
  c += (h(vUv*1000. + fract(uTime)*91.) - .5)*.022;
  o = vec4(c, 1.);
}`;

const P = {
  trace: prog(FSQ_VS, TRACE_FS), comp: prog(FSQ_VS, COMP_FS), part: prog(PART_VS, PART_FS),
  bright: prog(FSQ_VS, BRIGHT_FS), down: prog(FSQ_VS, DOWN_FS), up: prog(FSQ_VS, UP_FS), fin: prog(FSQ_VS, FINAL_FS),
};

// geometry
const quadBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const fsVao = gl.createVertexArray(); gl.bindVertexArray(fsVao);
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
[P.trace, P.comp, P.bright, P.down, P.up, P.fin].forEach(q => gl.bindAttribLocation(q.p, 0, 'aP'));

const MAXP = 7000;
const pData = new Float32Array(MAXP * 12);
const pBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pBuf); gl.bufferData(gl.ARRAY_BUFFER, pData.byteLength, gl.DYNAMIC_DRAW);
const pVao = gl.createVertexArray(); gl.bindVertexArray(pVao);
const locP = gl.getAttribLocation(P.part.p, 'aP');
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf); gl.enableVertexAttribArray(locP); gl.vertexAttribPointer(locP, 2, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, pBuf);
['iA', 'iB', 'iC'].forEach((n, i) => { const l = gl.getAttribLocation(P.part.p, n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 48, i * 16); gl.vertexAttribDivisor(l, 1); });
gl.bindVertexArray(null);

// ---------- state ----------
let W = 1, H = 1, dpr = 1, RW = 1, RH = 1;
let scene, sceneT, bloom = [];
let lensT0, lensT1, lensF, lensN = 0;
let pageTex = null, pageTexW = 0, pageTexH = 0, pageW = 1, pageH = 1, hasPage = false;
let fallbackImg = null;
let tEat = null, tD = null;
let tileSize = 12, tilesX = 0, tilesY = 0, tState = null, tDmg = null, tHeat = null, tGlow = null, dmgTex = null, dmgDirty = true, totalTiles = 1, eatenTiles = 0;
const parts = [];
const ret = [];
const hole = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, mass: 1, hunger: .4, feed: 0, flash: 0, absorbed: 0, dragging: false };
let scroll = 0, scrollT = 0, scrollV = 0, lastInteract = -1e9, t0 = performance.now(), now = 0, last = 0;
let traceScale = 1.0, fpsAcc = 0, fpsN = 0, fpsShown = 0;
const keys = new Set();

function geom() {
  const R = Math.max(15, Math.min(42, Math.sqrt(W * H) * 0.027)) * Math.min(1.8, hole.mass) * (hole.shrink || 1);
  return { R, shadow: 2.598 * R, bE: 6.2 * R, Rt: 17 * R, Dp: 6.2 * 6.2 / 2, din: 3.0, dout: 13.5 };
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  RW = Math.round(W * dpr); RH = Math.round(H * dpr);
  canvas.width = RW; canvas.height = RH;
  page.style.width = W + 'px';
  [sceneT, ...bloom.map(b => b.t)].forEach(t => t && gl.deleteTexture(t));
  sceneT = hdrT(RW, RH); scene = fbo([sceneT]);
  bloom = [];
  let w = RW, h = RH;
  for (let i = 0; i < 6; i++) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); const t = hdrT(w, h); bloom.push({ t, f: fbo([t]), w, h }); }
  if (!hole.x) { hole.x = hole.tx = W * 0.64; hole.y = hole.ty = H * 0.47; }
  if (!live && fallbackImg && fallbackImg.naturalWidth) setupFallbackPage();
  needUpload = true;
}

function ensureLens(N) {
  if (N === lensN) return;
  lensN = N;
  if (lensT0) { gl.deleteTexture(lensT0); gl.deleteTexture(lensT1); gl.deleteFramebuffer(lensF); }
  lensT0 = hdrT(N, N); lensT1 = hdrT(N, N); lensF = fbo([lensT0, lensT1]);
}

// ---------- tiles: the page is cut into small pieces that can be torn away ----------
function setupTiles() {
  tileSize = Math.max(10, Math.round(Math.sqrt(W * H) / 80));
  tilesX = Math.ceil(pageW / tileSize); tilesY = Math.ceil(pageH / tileSize);
  const n = tilesX * tilesY; totalTiles = n; eatenTiles = 0;
  tState = new Uint8Array(n); tDmg = new Uint8Array(n * 4); tHeat = new Float32Array(n); tGlow = new Float32Array(n); tEat = new Float32Array(n); tD = new Float32Array(n);
  parts.length = 0; ret.length = 0;
  if (dmgTex) gl.deleteTexture(dmgTex);
  dmgTex = tex(tilesX, tilesY, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
  dmgDirty = true;
}

// ---------- the live page: HTML-in-Canvas ----------
let needUpload = true;
function uploadPage() {
  let s;
  try { s = canvas.getElementImageDefaultSize(page); } catch (e) { return false; }
  const cw = page.offsetWidth, ch = page.offsetHeight;
  if (!s || !s.width || !s.height || !cw) return false;
  const maxT = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (s.height > maxT) return false;
  const sw = Math.ceil(s.width), shh = Math.ceil(s.height);
  if (sw !== pageTexW || shh !== pageTexH || !pageTex) {
    if (pageTex) gl.deleteTexture(pageTex);
    pageTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, pageTex);
    const lv = Math.floor(Math.log2(Math.max(sw, shh))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, lv, gl.RGBA8, sw, shh);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    pageTexW = sw; pageTexH = shh;
  }
  gl.bindTexture(gl.TEXTURE_2D, pageTex);
  gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, page);
  gl.generateMipmap(gl.TEXTURE_2D);
  if (Math.abs(cw - pageW) > .5 || Math.abs(ch - pageH) > .5 || !tState) { pageW = cw; pageH = ch; setupTiles(); }
  hasPage = true;
  computeInk();
  return true;
}

let tInk = null;
function computeInk() {
  if (!tState || !pageTex) return;
  try {
    const scale = pageTexW / pageW; // texture px per css px
    const lv = Math.max(0, Math.min(Math.floor(Math.log2(tileSize * scale)), Math.floor(Math.log2(Math.max(pageTexW, pageTexH)))));
    const w = Math.max(1, pageTexW >> lv), h = Math.max(1, pageTexH >> lv);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pageTex, lv);
    const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(f);
    tInk = new Float32Array(tilesX * tilesY);
    const bg = [13, 43, 184];
    for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) {
      const sx = Math.min(w - 1, Math.floor((tx + .5) * tileSize * scale / (1 << lv))), sy = Math.min(h - 1, Math.floor((ty + .5) * tileSize * scale / (1 << lv)));
      const o = (sy * w + sx) * 4;
      const d = Math.abs(px[o] - bg[0]) + Math.abs(px[o + 1] - bg[1]) + Math.abs(px[o + 2] - bg[2]);
      tInk[ty * tilesX + tx] = Math.min(1, d / 160);
    }
  } catch (e) { tInk = null; }
}

function setupFallbackPage() {
  if (!pageTex) {
    pageTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, pageTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, fallbackImg);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  pageW = W; pageH = fallbackImg.naturalHeight * W / fallbackImg.naturalWidth;
  pageTexW = fallbackImg.naturalWidth; pageTexH = fallbackImg.naturalHeight;
  setupTiles(); hasPage = true; computeInk();
}

// ---------- simulation ----------
const rnd = Math.random;
function discBasis(g) {
  const inc = 73 * Math.PI / 180 + Math.sin(now * .00021) * .025 + hole.vy * 0.00012;
  const roll = -10 * Math.PI / 180 + Math.sin(now * .00013) * .02 - hole.vx * 0.00012;
  const n = [-Math.sin(roll) * Math.sin(inc), Math.cos(roll) * Math.sin(inc), Math.cos(inc)];
  const e1 = [Math.cos(roll), Math.sin(roll), 0];
  const e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
  return { n, e1, e2 };
}

function spawnBlock(tx0, ty0, g, basis) {
  // tear off an irregular chunk: a small block of neighbouring tiles leaves together
  const big = (hole.hunger > .7 ? 1 : 0) + (tInk && tInk[ty0 * tilesX + tx0] > .25 ? 1.2 : -1);
  const bw = 1 + Math.floor(rnd() * Math.max(1, 2.6 + big)), bh = 1 + Math.floor(rnd() * Math.max(1, 1.8 + big * .7));
  const tiles = [];
  for (let y = ty0; y < Math.min(tilesY, ty0 + bh); y++) for (let x = tx0; x < Math.min(tilesX, tx0 + bw); x++) {
    const j = y * tilesX + x; if (tState[j]) continue;
    tState[j] = 1; tDmg[j * 4] = 255; tD[j] = 1; tHeat[j] = 1; tEat[j] = now; eatenTiles++; tiles.push(j);
  }
  if (!tiles.length) return 0;
  dmgDirty = true;
  const rw = Math.min(bw, tilesX - tx0) * tileSize, rh = Math.min(bh, tilesY - ty0) * tileSize;
  const qx = tx0 * tileSize, qy = ty0 * tileSize;
  if (parts.length >= MAXP - 50) { tiles.forEach(j => tState[j] = 2); return tiles.length; }
  const px = qx + rw / 2, py = qy + rh / 2 - scroll;
  let bx = px - hole.x, by = -(py - hole.y);
  const beta = Math.hypot(bx, by) || 1;
  const th = (beta + Math.sqrt(beta * beta + 4 * g.bE * g.bE)) / 2;
  const ux = bx / beta, uy = by / beta;
  const x = hole.x + ux * th, y = hole.y - uy * th;
  // tangent around the disc normal (screen coords, y down)
  const n = basis.n; const rx = ux, ry = -uy, rz = 0; // radial in y-down frame
  const nx = n[0], ny = -n[1], nz = n[2];
  let tx3 = ny * rz - nz * ry, ty3 = nz * rx - nx * rz, tz3 = nx * ry - ny * rx;
  const tl = Math.hypot(tx3, ty3, tz3) || 1; tx3 /= tl; ty3 /= tl; tz3 /= tl;
  const G = 432 * g.R * g.R * g.R;
  const vc = Math.sqrt(G / th) * (.42 + rnd() * .22);
  let ink = 0; if (tInk) for (const j of tiles) ink = Math.max(ink, tInk[j]);
  if (tInk && ink < .15 && rnd() > .3) { tiles.forEach(j => tState[j] = 2); return tiles.length; }
  parts.push({ tiles, ink, rx: qx, ry: qy, rw, rh, x, y, z: (rnd() - .5) * 20, vx: tx3 * vc - ux * 90, vy: ty3 * vc + uy * 90, vz: tz3 * vc + (rnd() - .5) * 40, age: 0, a: 1, seed: rnd(), dead: false });
  return tiles.length;
}

function step(dt) {
  const g = geom();
  const basis = discBasis(g);
  // hole motion
  const idle = now - lastInteract > 3500 && !reduced;
  if (!hole.dragging) {
    if (idle) {
      const t = now * .001;
      if (hole.ax === undefined) { hole.ax = W * .62; hole.ay = H * .47; }
      hole.tx = hole.ax + W * .09 * Math.sin(t * .21); hole.ty = hole.ay + H * .07 * Math.sin(t * .29 + 1.3);
    }
    const k = idle ? 1.6 : 6;
    const ax = (hole.tx - hole.x) * k * k - hole.vx * 1.6 * k;
    const ay = (hole.ty - hole.y) * k * k - hole.vy * 1.6 * k;
    hole.vx += ax * dt; hole.vy += ay * dt;
    hole.x += hole.vx * dt; hole.y += hole.vy * dt;
    hole.x = Math.max(-W * .1, Math.min(W * 1.1, hole.x)); hole.y = Math.max(-H * .1, Math.min(H * 1.1, hole.y));
  }
  // keyboard
  if (keys.has('ArrowLeft') || keys.has('ArrowRight') || keys.has('ArrowUp') || keys.has('ArrowDown')) {
    const sp = 520 * dt;
    if (keys.has('ArrowLeft')) hole.tx -= sp; if (keys.has('ArrowRight')) hole.tx += sp;
    if (keys.has('ArrowUp')) hole.ty -= sp; if (keys.has('ArrowDown')) hole.ty += sp;
    hole.tx = Math.max(0, Math.min(W, hole.tx)); hole.ty = Math.max(0, Math.min(H, hole.ty)); hole.ax = hole.tx; hole.ay = hole.ty;
  }
  // scroll
  const maxS = Math.max(0, pageH - H);
  scrollT = Math.max(0, Math.min(maxS, scrollT));
  const ns = scroll + (scrollT - scroll) * Math.min(1, dt * 7);
  scrollV = (ns - scroll) / Math.max(dt, 1e-3); scroll = ns;
  const hs = Math.hypot(hole.vx, hole.vy);
  const hungerT = Math.min(1, .5 + Math.abs(scrollV) / 1800 + hs / 2600 + (keys.has(' ') ? .7 : 0));
  hole.hunger += (hungerT - hole.hunger) * Math.min(1, dt * (hungerT > hole.hunger ? 4 : 1.2));
  hole.mass += ((1 + Math.min(hole.absorbed / 5000, .55)) - hole.mass) * Math.min(1, dt * 1.5);
  hole.feed *= Math.exp(-dt * 2.5); hole.flash *= Math.exp(-dt * 3); hole.calm = Math.max(0, (hole.calm || 0) - dt); hole.shrink = (hole.shrink || 1) + (1 - (hole.shrink || 1)) * Math.min(1, dt * .28);

  if (!tState) return;
  // eat
  const Reat = g.bE * (.22 + .28 * hole.hunger * hole.hunger);
  const hx = hole.x, hy = hole.y + scroll;
  const x0 = Math.max(0, Math.floor((hx - Reat) / tileSize)), x1 = Math.min(tilesX - 1, Math.floor((hx + Reat) / tileSize));
  const y0 = Math.max(0, Math.floor((hy - Reat) / tileSize)), y1 = Math.min(tilesY - 1, Math.floor((hy + Reat) / tileSize));
  let budget = hole.calm > 0 ? 0 : (reduced ? 8 : 70);
  const rate = (reduced ? .5 : 4.5) * hole.hunger;
  const tq = now * .0004;
  for (let ty = y0; ty <= y1 && budget > 0; ty++) for (let tx = x0; tx <= x1 && budget > 0; tx++) {
    const i = ty * tilesX + tx; if (tState[i]) continue;
    const dx = (tx + .5) * tileSize - hx, dy = (ty + .5) * tileSize - hy;
    const s = Math.hypot(dx, dy) / Reat; if (s >= 1) continue;
    const ang = Math.atan2(dy, dx);
    const fing = .55 + .45 * Math.sin(ang * 7 + tq * 3 + Math.sin(ang * 3 - tq) * 2);
    const p = rate * Math.pow(1 - s, 1.4) * fing * dt * 3;
    if (rnd() < p) {
      budget -= spawnBlock(tx, ty, g, basis);
    }
  }
  // falling fragments
  const G = 432 * g.R * g.R * g.R;
  const n = basis.n; const nx = n[0], ny = -n[1], nz = n[2];
  let absorbedNow = 0;
  for (let k = parts.length - 1; k >= 0; k--) {
    const p = parts[k];
    p.age += dt;
    if (p.out) {
      p.out += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .97; p.vy *= .97;
      if (p.out > 1.1) { for (const j of p.tiles) if (tState[j] === 1) tState[j] = 3; parts.splice(k, 1); }
      continue;
    }
    const dx = hole.x - p.x, dy = hole.y - p.y, dz = -p.z;
    const r2 = dx * dx + dy * dy + dz * dz + g.R * g.R * .5, r = Math.sqrt(r2);
    const a = G / r2;
    p.vx += a * dx / r * dt; p.vy += a * dy / r * dt; p.vz += a * dz / r * dt;
    // settle into the disc plane and keep its sense of rotation
    const rx = -dx, ry = -dy, rz = -dz;
    const h = rx * nx + ry * ny + rz * nz, vn = p.vx * nx + p.vy * ny + p.vz * nz;
    const set = 2.2 * Math.min(1, g.Rt / r);
    p.vx -= (h * set * 1.5 + vn * set) * nx * dt; p.vy -= (h * set * 1.5 + vn * set) * ny * dt; p.vz -= (h * set * 1.5 + vn * set) * nz * dt;
    const drag = Math.exp(-dt * (.05 + .65 * Math.min(1, (5 * g.R / r) ** 2)));
    p.vx *= drag; p.vy *= drag; p.vz *= drag;
    const spd = Math.hypot(p.vx, p.vy, p.vz), vmax = 60 * g.R; if (spd > vmax) { p.vx *= vmax / spd; p.vy *= vmax / spd; p.vz *= vmax / spd; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (r < g.R * 1.15 || p.age > 18 || r > 30 * g.R) { absorbedNow += p.tiles.length; for (const j of p.tiles) if (tState[j] === 1) tState[j] = 2; parts.splice(k, 1); }
  }
  if (absorbedNow) { hole.absorbed += absorbedNow; hole.feed = Math.min(1.5, hole.feed + absorbedNow * .012); }
  stepWaves(dt);
  // cool the damage map; old tears away from the hole slowly knit themselves back together
  const healR2 = (Reat * 1.35 + tileSize * 2) ** 2;
  for (let ty = 0; ty < tilesY; ty++) {
    const rowY = ty * tileSize - scroll; if (rowY < -H || rowY > 2 * H) continue;
    for (let tx = 0; tx < tilesX; tx++) {
      const i = ty * tilesX + tx;
      if ((tState[i] === 2 || tState[i] === 4) && now - tEat[i] > 6500) {
        const dx = (tx + .5) * tileSize - hx, dy = (ty + .5) * tileSize - hy;
        if (dx * dx + dy * dy > healR2) {
          tState[i] = 4; tD[i] = Math.max(0, tD[i] - dt * .45); tDmg[i * 4] = tD[i] * 255; dmgDirty = true;
          tGlow[i] = Math.max(tGlow[i], .55 * Math.sin(Math.PI * tD[i]));
          if (tD[i] <= 0) { tState[i] = 0; eatenTiles--; }
        }
      }
      if (tHeat[i] > 0) { tHeat[i] = Math.max(0, tHeat[i] - dt * .09); tDmg[i * 4 + 1] = tHeat[i] * 255; dmgDirty = true; }
      if (tGlow[i] > 0) { tGlow[i] = Math.max(0, tGlow[i] - dt * .6); tDmg[i * 4 + 2] = tGlow[i] * tGlow[i] * 255; dmgDirty = true; }
    }
  }
}

const waves = [];
function reform(cx, cy, radius) {
  if (!tState) return;
  const local = !!radius;
  if (!local) { cx = hole.x; cy = hole.y + scroll; }
  let count = 0;
  for (let i = 0; i < tState.length; i++) if (tState[i] && tState[i] !== 3) count++;
  if (!count) return;
  // fragments in flight are thrown back out
  for (const p of parts) {
    if (local && Math.hypot(p.rx + p.rw / 2 - cx, p.ry + p.rh / 2 - cy) > radius * 1.6) continue;
    const dx = p.x - hole.x, dy = p.y - hole.y, d = Math.hypot(dx, dy) || 1;
    p.out = 1; p.vx = dx / d * (500 + rnd() * 600); p.vy = dy / d * (500 + rnd() * 600); p.vz *= .3;
  }
  waves.push({ x: cx, y: cy, r: 0, max: local ? radius : Math.hypot(W, pageH) , speed: local ? 600 : 950, amp: local ? .7 : 1 });
  hole.flash = local ? .12 : .35; hole.calm = local ? 1 : 3.5; if (!local) { hole.absorbed = 0; hole.shrink = .5; }
  audio.reform(count, local);
}

function stepWaves(dt) {
  for (let k = waves.length - 1; k >= 0; k--) {
    const w = waves[k]; const r0 = w.r; w.r += w.speed * dt;
    const R2a = r0 * r0, R2b = w.r * w.r;
    const y0 = Math.max(0, Math.floor((w.y - w.r) / tileSize)), y1 = Math.min(tilesY - 1, Math.floor((w.y + w.r) / tileSize));
    for (let ty = y0; ty <= y1; ty++) for (let tx = 0; tx < tilesX; tx++) {
      const i = ty * tilesX + tx; const st = tState[i]; if (!st || st === 3 || st === 1) continue;
      const dx = (tx + .5) * tileSize - w.x, dy = (ty + .5) * tileSize - w.y, d2 = dx * dx + dy * dy;
      if (d2 <= R2b && d2 <= w.max * w.max) { tState[i] = 3; }
    }
    if (w.r > w.max + 200) waves.splice(k, 1);
  }
  // knitting: fast regrowth with a gold seam
  for (let ty = 0; ty < tilesY; ty++) {
    const rowY = ty * tileSize - scroll; if (rowY < -H * 2 || rowY > 3 * H) continue;
    for (let tx = 0; tx < tilesX; tx++) {
      const i = ty * tilesX + tx; if (tState[i] !== 3) continue;
      tD[i] = Math.max(0, tD[i] - dt * 1.5); tDmg[i * 4] = tD[i] * 255; tHeat[i] = Math.max(tHeat[i], .85); tDmg[i * 4 + 1] = tHeat[i] * 255; tGlow[i] = Math.max(tGlow[i], .35); dmgDirty = true;
      if (tD[i] <= 0) { tState[i] = 0; eatenTiles--; tHeat[i] = 0; tDmg[i * 4 + 1] = 0; }
    }
  }
}

// ---------- drawing ----------
function writeParticles(g, basis) {
  let n = 0; const d = pData;
  const sh = g.shadow;
  for (const p of parts) {
    if (n >= MAXP) break;
    const dx = p.x - hole.x, dy = p.y - hole.y;
    const r2d = Math.hypot(dx, dy), r3 = Math.hypot(dx, dy, p.z);
    if ((p.z < 0 && r2d < sh * 1.6) || r2d < sh * 1.25) continue;
    const sp = Math.hypot(p.vx, p.vy);
    const tid = p.out ? .6 : Math.min(4.2, Math.max(0, sp - 160) / 260 + 22 * (g.R / Math.max(r3, g.R)) ** 2);
    const heat = Math.min(1, Math.max(0, (5.5 * g.R - r3) / (4 * g.R)) ** 1.6);
    const fade = Math.min(1, p.age * 6) * Math.min(1, Math.max(0, (r3 - g.R * 1.15) / (g.R * .8))) * (p.out ? Math.max(0, 1 - (p.out - 1) / .1) : 1);
    const o = n * 12;
    const al = Math.min(1, tid / 1.5); d[o] = p.x; d[o + 1] = p.y; d[o + 2] = Math.atan2(p.vy, p.vx) * al + (p.seed * 6.28 + p.age * (p.seed - .5) * 5) * (1 - al); d[o + 3] = fade;
    const pad = tileSize * .3, inkS = .45 + .55 * Math.min(1, p.ink * 1.6);
    d[o + 3] *= .35 + .65 * Math.min(1, p.ink * 2);
    d[o + 4] = (p.rw + pad) * (1 + tid) * inkS; d[o + 5] = (p.rh + pad) / Math.sqrt(1 + tid * .7) * inkS; d[o + 6] = heat; d[o + 7] = p.seed;
    d[o + 8] = p.rx - pad / 2; d[o + 9] = p.ry - pad / 2; d[o + 10] = p.rw + pad; d[o + 11] = p.rh + pad;
    n++;
  }
  return n;
}

function drawFS() { gl.bindVertexArray(fsVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }

function render() {
  const g = geom();
  const basis = discBasis(g);
  const time = (now - t0) / 1000;
  // 1. trace
  const N = Math.min(1100, Math.max(256, Math.round(2 * g.Rt * traceScale) & ~15));
  ensureLens(N);
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, lensF); gl.viewport(0, 0, N, N);
  gl.useProgram(P.trace.p);
  const u = P.trace.u;
  gl.uniform1f(u.uRt, g.Rt / g.R); gl.uniform1f(u.uDp, g.Dp); gl.uniform1f(u.uTime, time * (reduced ? .3 : 1));
  gl.uniform1f(u.uDiscIn, g.din); gl.uniform1f(u.uDiscOut, g.dout); gl.uniform1f(u.uFeed, hole.feed + hole.hunger * .3);
  gl.uniform1f(u.uRsPx, g.R); gl.uniform1f(u.uSpin, reduced ? .4 : 1);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pageTex); gl.uniform1i(u.uPage, 0);
  gl.uniform2f(u.uPagePt, hole.x, hole.y + scroll); gl.uniform2f(u.uPageSize, pageW, pageH); gl.uniform1f(u.uText, hasPage ? 1 : 0);
  gl.uniform3fv(u.uNd, basis.n); gl.uniform3fv(u.uE1, basis.e1); gl.uniform3fv(u.uE2, basis.e2);
  drawFS();
  // 2. composite
  if (dmgDirty && dmgTex) { gl.bindTexture(gl.TEXTURE_2D, dmgTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tilesX, tilesY, gl.RGBA, gl.UNSIGNED_BYTE, tDmg); dmgDirty = false; }
  gl.bindFramebuffer(gl.FRAMEBUFFER, scene); gl.viewport(0, 0, RW, RH);
  gl.useProgram(P.comp.p);
  const c = P.comp.u;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pageTex); gl.uniform1i(c.uPage, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, dmgTex); gl.uniform1i(c.uDamage, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, lensT0); gl.uniform1i(c.uLens, 2);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, lensT1); gl.uniform1i(c.uDiscT, 3);
  gl.uniform2f(c.uRes, RW, RH); gl.uniform2f(c.uView, W, H); gl.uniform2f(c.uPageSize, pageW, pageH);
  gl.uniform2f(c.uTiles, tilesX, tilesY); gl.uniform2f(c.uHole, hole.x, hole.y);
  gl.uniform1f(c.uDpr, dpr); gl.uniform1f(c.uTile, tileSize); gl.uniform1f(c.uScroll, scroll);
  gl.uniform1f(c.uRt, g.Rt); gl.uniform1f(c.uBE, g.bE); gl.uniform1f(c.uTime, time);
  gl.uniform1f(c.uPull, .15 * Math.min(1, .3 + hole.hunger * .7)); gl.uniform1f(c.uPullL, g.R * 3.);
  gl.uniform1f(c.uSwirl, (reduced ? .1 : .3) * (.6 + hole.hunger)); gl.uniform1f(c.uShadow, g.shadow);
  gl.uniform1f(c.uHasPage, hasPage && pageTex && tState ? 1 : 0);
  const shredR = hole.calm > 0 ? 0 : g.bE * (1.3 + .55 * hole.hunger * hole.hunger);
  const reat = g.bE * (.22 + .28 * hole.hunger * hole.hunger);
  gl.uniform1f(c.uMaskR, Math.max(shredR, (reat + Math.sqrt(reat * reat + 4 * g.bE * g.bE)) / 2 * 1.5));
  gl.uniform1f(c.uShredR, shredR); gl.uniform1f(c.uCurl, reduced ? .3 : .9); gl.uniform1f(c.uShredDepth, .35 + hole.hunger * .7); gl.uniform1f(c.uHot, .4 + hole.hunger * .4);
  const wv = waves[waves.length - 1];
  if (wv) gl.uniform4f(c.uWave, wv.x, wv.y, wv.r, wv.amp * Math.max(0, 1 - wv.r / (wv.max + 200))); else gl.uniform4f(c.uWave, 0, 0, 0, 0);
  drawFS();
  // 3. fragments
  const n = tState ? writeParticles(g, basis) : 0;
  if (n) {
    gl.bindBuffer(gl.ARRAY_BUFFER, pBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pData, 0, n * 12);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(P.part.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pageTex); gl.uniform1i(P.part.u.uPage, 0);
    gl.uniform2f(P.part.u.uView, W, H); gl.uniform2f(P.part.u.uPageSize, pageW, pageH);
    gl.bindVertexArray(pVao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.disable(gl.BLEND);
  }
  // 4. bloom
  gl.useProgram(P.bright.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, bloom[0].f); gl.viewport(0, 0, bloom[0].w, bloom[0].h);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneT); gl.uniform1i(P.bright.u.uT, 0);
  gl.uniform2f(P.bright.u.uTx, .5 / RW, .5 / RH); drawFS();
  gl.useProgram(P.down.p);
  for (let i = 1; i < bloom.length; i++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloom[i].f); gl.viewport(0, 0, bloom[i].w, bloom[i].h);
    gl.bindTexture(gl.TEXTURE_2D, bloom[i - 1].t); gl.uniform1i(P.down.u.uT, 0);
    gl.uniform2f(P.down.u.uTx, 1 / bloom[i - 1].w, 1 / bloom[i - 1].h); drawFS();
  }
  gl.useProgram(P.up.p); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  for (let i = bloom.length - 1; i > 0; i--) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloom[i - 1].f); gl.viewport(0, 0, bloom[i - 1].w, bloom[i - 1].h);
    gl.bindTexture(gl.TEXTURE_2D, bloom[i].t); gl.uniform1i(P.up.u.uT, 0);
    gl.uniform2f(P.up.u.uTx, 1 / bloom[i].w, 1 / bloom[i].h); gl.uniform1f(P.up.u.uK, i > 3 ? .55 : .85); drawFS();
  }
  gl.disable(gl.BLEND);
  // 5. final
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, RW, RH);
  gl.useProgram(P.fin.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneT); gl.uniform1i(P.fin.u.uScene, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloom[0].t); gl.uniform1i(P.fin.u.uBloom, 1);
  gl.uniform2f(P.fin.u.uHoleUv, hole.x / W, 1 - hole.y / H); gl.uniform2f(P.fin.u.uAspect, W / H, 1);
  gl.uniform1f(P.fin.u.uTime, time); gl.uniform1f(P.fin.u.uShadowUv, g.shadow / H); gl.uniform1f(P.fin.u.uFlash, hole.flash);
  drawFS();
}

// ---------- frame loop ----------
let prewarmed = false, frames = 0, timeShift = 0;
function frame(changed) {
  const t = performance.now();
  const rawDt = (t - (last || t)) / 1000;
  const dt = Math.min(1 / 20, rawDt); last = t; now = t + timeShift;
  if (live && (needUpload || changed)) { if (uploadPage()) needUpload = false; }
  if (hasPage && !prewarmed) { prewarmed = true; const n = reduced ? 0 : 150; for (let i = 0; i < n; i++) { now = t - (n - i) * 16.7; step(1 / 60); } now = t; }
  step(dt);
  render();
  if (live) try { canvas.updateElementGeometry(page, { canvasTransform: new DOMMatrix([1, 0, 0, 1, 0, -scroll]) }); } catch (e) {}
  // HUD + adaptive trace resolution
  frames++;
  if (rawDt < .05) { fpsAcc += rawDt; fpsN++; }
  if (fpsAcc > .75) {
    const fps = fpsN / fpsAcc; fpsShown = fps; fpsAcc = 0; fpsN = 0;
    if (fps < 52 && traceScale > .4) traceScale = Math.max(.4, traceScale - .08);
    else if (fps > 58.5 && traceScale < 1) traceScale = Math.min(1, traceScale + .04);
  }
  if (frames % 10 === 0 && totalTiles) remainEl.textContent = (100 * (1 - eatenTiles / totalTiles)).toFixed(1) + '%';
  audio.tick(dt);
}

if (live) {
  canvas.onpaint = (e) => {
    const changed = e && e.changedElements && [...e.changedElements].includes(page);
    try { frame(changed); } catch (err) { console.error(err); }
    canvas.requestPaint();
  };
  // a safety net if the paint loop ever stalls
  setInterval(() => { if (performance.now() - last > 600) canvas.requestPaint(); }, 500);
} else {
  canvas.after(page); page.setAttribute('style', 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap');
  note.hidden = false;
  note.textContent = 'This browser can’t draw live HTML into a canvas yet, so the hole is eating a snapshot. Open it in Chrome or Edge 157+ for the real page.';
  fallbackImg = new Image();
  fallbackImg.onload = () => { setupFallbackPage(); };
  fallbackImg.src = 'page-snapshot.webp';
  const loop = () => { try { frame(false); } catch (err) { console.error(err); } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

// ---------- input ----------
let hintTimer = 0;
function poke() {
  lastInteract = performance.now();
  if (!hintTimer) hintTimer = setTimeout(() => hud.classList.add('quiet'), 6000);
}
function overHole(x, y) { const g = geom(); return Math.hypot(x - hole.x, y - hole.y) < Math.max(g.shadow * 1.9, 60); }
let drag = null;
window.addEventListener('pointermove', (e) => {
  if (drag) {
    const x = e.clientX - drag.ox, y = e.clientY - drag.oy;
    const t = performance.now(); const dt = Math.max(1, t - drag.t) / 1000;
    const dt2 = Math.max(dt, 1 / 120);
    hole.vx = hole.vx * .6 + ((x - hole.x) / dt2) * .4; hole.vy = hole.vy * .6 + ((y - hole.y) / dt2) * .4;
    const sp = Math.hypot(hole.vx, hole.vy); if (sp > 2600) { hole.vx *= 2600 / sp; hole.vy *= 2600 / sp; }
    hole.x = hole.tx = x; hole.y = hole.ty = y; drag.t = t; poke();
  } else if (e.pointerType === 'mouse') {
    canvas.classList.toggle('grab', overHole(e.clientX, e.clientY));
  }
});
window.addEventListener('pointerdown', (e) => {
  audio.start();
  poke();
  if (e.target.closest && e.target.closest('#hud')) return;
  if (overHole(e.clientX, e.clientY)) {
    e.preventDefault();
    drag = { ox: e.clientX - hole.x, oy: e.clientY - hole.y, t: performance.now() };
    hole.dragging = true; canvas.classList.add('grabbing');
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    hud.style.opacity = .35;
  } else if (e.pointerType === 'touch') {
    drag = null; touchScroll = { y: e.clientY, s: scrollT };
  }
}, { passive: false });
let touchScroll = null;
window.addEventListener('pointermove', (e) => { if (touchScroll && !drag) { scrollT = touchScroll.s - (e.clientY - touchScroll.y) * 1.4; poke(); } });
window.addEventListener('pointerup', () => {
  if (drag) { hole.dragging = false; canvas.classList.remove('grabbing'); hole.tx = hole.x + hole.vx * .25; hole.ty = hole.y + hole.vy * .25; hole.tx = Math.max(0, Math.min(W, hole.tx)); hole.ty = Math.max(0, Math.min(H, hole.ty)); hole.ax = hole.tx; hole.ay = hole.ty; }
  drag = null; touchScroll = null;
});
window.addEventListener('wheel', (e) => { e.preventDefault(); scrollT += e.deltaY * (e.deltaMode === 1 ? 32 : 1); poke(); audio.start(); }, { passive: false });
window.addEventListener('dblclick', (e) => {
  if (overHole(e.clientX, e.clientY)) return;
  e.preventDefault(); poke();
  // the page point under the cursor (the lensed image means the hole's surroundings are mirrored, so pick the source point)
  const g = geom();
  let bx = e.clientX - hole.x, by = e.clientY - hole.y; const b = Math.hypot(bx, by) || 1;
  const k = 1 - g.bE * g.bE / (b * b);
  const sx = hole.x + bx * k, sy = hole.y + by * k + scroll;
  const s2 = window.getSelection && window.getSelection(); if (s2) s2.removeAllRanges();
  reform(sx, sy, 230);
});
window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) { keys.add(k); e.preventDefault(); poke(); audio.start(); }
  else if (k === 'PageDown') { scrollT += H * .85; e.preventDefault(); poke(); }
  else if (k === 'PageUp') { scrollT -= H * .85; e.preventDefault(); poke(); }
  else if (k === 'Home') { scrollT = 0; poke(); }
  else if (k === 'End') { scrollT = 1e9; poke(); }
  else if (k === 'r' || k === 'R') { reform(); poke(); }
  else if (k === 'm' || k === 'M') { audio.toggle(); }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));
reformBtn.addEventListener('click', () => { reform(); poke(); });
sndBtn.addEventListener('click', () => audio.toggle());
window.addEventListener('resize', resize);

// auto reform when left alone for a while with a lot eaten
setInterval(() => {
  if (performance.now() - lastInteract > 14000 && totalTiles && eatenTiles / totalTiles > .015 && !waves.length) reform();
}, 2000);

// ---------- sound ----------
const audio = (() => {
  let ac = null, master, drone, droneG, rumbleF, crackleBus, on = false, started = false, crackleBudget = 0;
  function noiseBuf(sec, brown) {
    const b = ac.createBuffer(1, ac.sampleRate * sec, ac.sampleRate), d = b.getChannelData(0);
    let l = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { l = (l + .02 * w) / 1.02; d[i] = l * 3.5; } else d[i] = w; }
    return b;
  }
  function init() {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
    const comp = ac.createDynamicsCompressor(); comp.connect(master);
    droneG = ac.createGain(); droneG.gain.value = .5; droneG.connect(comp);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; lp.connect(droneG);
    drone = [36.7, 55.1, 36.9 * 1.5].map((f, i) => { const o = ac.createOscillator(); o.type = i === 2 ? 'sine' : 'sawtooth'; o.frequency.value = f; const g = ac.createGain(); g.gain.value = i === 2 ? .25 : .16; o.connect(g); g.connect(lp); o.start(); return o; });
    const rn = ac.createBufferSource(); rn.buffer = noiseBuf(4, true); rn.loop = true;
    rumbleF = ac.createBiquadFilter(); rumbleF.type = 'bandpass'; rumbleF.frequency.value = 70; rumbleF.Q.value = .7;
    const rg = ac.createGain(); rg.gain.value = .9; rn.connect(rumbleF); rumbleF.connect(rg); rg.connect(comp); rn.start();
    crackleBus = ac.createGain(); crackleBus.gain.value = .5; crackleBus.connect(comp);
  }
  const nb = () => noiseBuf(.25, false);
  let crackBuf = null;
  function crackle(n) {
    if (!on || !ac) return;
    crackBuf = crackBuf || nb();
    const s = ac.createBufferSource(); s.buffer = crackBuf;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 3500; f.Q.value = 2 + Math.random() * 6;
    const g = ac.createGain(); const t = ac.currentTime;
    g.gain.setValueAtTime(Math.min(.5, .08 + n * .01), t); g.gain.exponentialRampToValueAtTime(.0001, t + .04 + Math.random() * .08);
    s.connect(f); f.connect(g); g.connect(crackleBus); s.start(t, Math.random() * .15, .15);
  }
  return {
    start() { if (started) return; started = true; try { init(); this.set(true); } catch (e) {} },
    set(v) { on = v; if (!ac) return; if (ac.state === 'suspended') ac.resume(); master.gain.setTargetAtTime(v ? .55 : 0, ac.currentTime, .3); sndBtn.textContent = v ? 'Sound on' : 'Sound off'; sndBtn.setAttribute('aria-pressed', String(v)); },
    toggle() { if (!started) { this.start(); return; } this.set(!on); },
    tick(dt) {
      if (!ac || !on) return;
      const t = ac.currentTime;
      const m = hole.mass, h = hole.hunger;
      drone.forEach((o, i) => o.frequency.setTargetAtTime([36.7, 55.1, 55.3][i] / Math.sqrt(m) * (1 + hole.feed * .04), t, .3));
      droneG.gain.setTargetAtTime(.35 + h * .45 + hole.feed * .3, t, .2);
      rumbleF.frequency.setTargetAtTime(55 + h * 90 + hole.feed * 60, t, .2);
      crackleBudget += parts.length > 0 ? dt * (6 + h * 30) : 0;
      while (crackleBudget > 1) { crackleBudget -= 1; crackle(Math.min(parts.length, 60)); }
    },
    reform(count, local) {
      if (!ac || !on) return;
      const t = ac.currentTime;
      const s = ac.createBufferSource(); s.buffer = noiseBuf(2.2, false);
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3; f.frequency.setValueAtTime(120, t); f.frequency.exponentialRampToValueAtTime(local ? 2400 : 5200, t + (local ? .7 : 1.6));
      const g = ac.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(local ? .35 : .6, t + (local ? .5 : 1.3)); g.gain.exponentialRampToValueAtTime(.0001, t + (local ? .9 : 2.1));
      s.connect(f); f.connect(g); g.connect(master); s.start(t);
      [220, 277.2, 329.6, 440, 554.4].forEach((fr, i) => {
        const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = fr * (local ? 2 : 1);
        const og = ac.createGain(); const st = t + (local ? .45 : 1.25) + i * .06;
        og.gain.setValueAtTime(.0001, t); og.gain.setValueAtTime(.0001, st); og.gain.exponentialRampToValueAtTime(.07, st + .03); og.gain.exponentialRampToValueAtTime(.0001, st + 2.4);
        o.connect(og); og.connect(master); o.start(t); o.stop(st + 2.5);
      });
    },
  };
})();

resize();
if (live) canvas.requestPaint();
})();
