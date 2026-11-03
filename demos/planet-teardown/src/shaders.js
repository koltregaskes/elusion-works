// Procedural planet surfaces. One shader, six kinds, all in object space (no UV seams):
// 0 cratered rock, 1 cloud-wrapped (Venus), 2 ocean world (Earth), 3 rust desert (Mars),
// 4 banded gas giant (Jupiter, Saturn), 5 ice giant (Uranus, Neptune).
import * as THREE from 'three';

const NOISE = /* glsl */`
vec3 hash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return -1.0 + 2.0*fract(sin(p)*43758.5453123); }
float noise(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.0-2.0*f);
  return mix(mix(mix(dot(hash3(i+vec3(0,0,0)),f-vec3(0,0,0)), dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                 mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)), dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
             mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)), dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                 mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)), dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*noise(p); p *= 2.03; a *= 0.5; } return s; }
// distance to nearest feature point: crater rims
float cells(vec3 p){ vec3 i = floor(p), f = fract(p); float d = 8.0;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){ vec3 g = vec3(x,y,z); vec3 o = 0.5+0.5*hash3(i+g); d = min(d, length(g+o-f)); }
  return d; }
vec3 dirFromLatLon(float lat, float lon){ float la = radians(lat), lo = radians(lon); return vec3(cos(la)*cos(lo), sin(la), -cos(la)*sin(lo)); }
`;

export function surfaceMaterial(s, accentRef) {
  const u = {
    kind: { value: s.kind }, c1: { value: new THREE.Color(s.c1) }, c2: { value: new THREE.Color(s.c2) }, c3: { value: new THREE.Color(s.c3) },
    atm: { value: new THREE.Color(s.atm) }, atmK: { value: s.atmK }, bands: { value: s.bands || 6 }, spot: { value: s.spot || 0 }, hex: { value: s.hex || 0 },
    time: { value: 0 }, sunDir: { value: new THREE.Vector3(-1, 0.3, 0.5).normalize() }, glass: { value: 0 }, highlight: { value: 0 }, accent: accentRef,
  };
  return new THREE.ShaderMaterial({
    uniforms: u, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vP; varying vec3 vN; varying vec3 vW;
      void main(){ vP = normalize(position); vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: NOISE + /* glsl */`
      uniform float kind, atmK, bands, spot, hex, time, glass, highlight; uniform vec3 c1, c2, c3, atm, sunDir, accent;
      varying vec3 vP; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 p = vP; float lat = asin(clamp(p.y, -1.0, 1.0)); float lon = atan(-p.z, p.x);
        vec3 col;
        if (kind < 0.5) { // cratered rock
          float n = fbm(p*3.0);
          float c = cells(p*7.0); float c2v = cells(p*17.0 + 3.0);
          float rim = smoothstep(0.18, 0.0, abs(c - 0.42)) * 0.5 + smoothstep(0.12, 0.0, abs(c2v - 0.4)) * 0.25;
          float pit = smoothstep(0.38, 0.1, c) * 0.25;
          col = mix(c2, c1, 0.5 + n) + c3 * rim * 0.35 - pit * 0.2;
          // Caloris-like bright basin
          float bas = smoothstep(0.35, 0.2, distance(p, dirFromLatLon(30.5, 170.0)));
          col = mix(col, c3, bas * 0.25);
        } else if (kind < 1.5) { // Venus: thick sheared cloud
          vec3 q = vec3(p.x, p.y*2.6, p.z);
          float w = fbm(q*2.2 + vec3(time*0.02, 0.0, 0.0));
          float v = fbm(vec3(lat*3.0 + w*1.6, lon*0.6 + time*0.03, 0.0) + p*1.5);
          col = mix(c2, c1, 0.55 + v*1.2); col = mix(col, c3, smoothstep(0.1, 0.4, w) * 0.4);
        } else if (kind < 2.5) { // Earth
          float h = fbm(p*2.1 + 1.3) + 0.35*fbm(p*6.0);
          float land = smoothstep(0.04, 0.08, h);
          vec3 sea = mix(c1*0.55, c1, smoothstep(-0.4, 0.05, h));
          vec3 ground = mix(c2, c3, smoothstep(0.1, 0.35, h + 0.2*abs(p.y)));
          ground = mix(ground, vec3(0.78,0.72,0.55), smoothstep(0.15, 0.32, abs(fbm(p*4.0+7.0))) * (1.0 - abs(p.y)) * 0.6);
          col = mix(sea, ground, land);
          float ice = smoothstep(0.82, 0.9, abs(p.y) + 0.05*fbm(p*8.0));
          col = mix(col, vec3(0.93,0.96,1.0), ice);
          float cl = smoothstep(0.08, 0.38, fbm(p*3.2 + vec3(time*0.015, 0.0, time*0.01)) + 0.15*sin(lat*6.0));
          col = mix(col, vec3(1.0), cl * 0.75);
        } else if (kind < 3.5) { // Mars
          float n = fbm(p*2.6); float d = fbm(p*5.0 + 4.0);
          col = mix(c1, c3, 0.5 + n*0.8);
          float dark = smoothstep(0.02, 0.2, fbm(p*1.6 + 9.0)) * smoothstep(0.75, 0.2, abs(p.y));
          col = mix(col, c2, dark * 0.7);
          float c = cells(p*9.0); col -= smoothstep(0.25, 0.0, c) * 0.06;
          // Valles Marineris: a dark gash along the equator
          float vm = abs(lat - radians(-10.0) - 0.04*sin(lon*7.0)); float inLon = smoothstep(radians(-100.0), radians(-90.0), lon) * smoothstep(radians(-25.0), radians(-35.0), lon);
          col = mix(col, c2*0.7, smoothstep(0.035, 0.0, vm) * inLon);
          // Olympus Mons
          float om = distance(p, dirFromLatLon(18.65, -133.8)); col = mix(col, c3*1.05, smoothstep(0.12, 0.05, om) * 0.5); col -= smoothstep(0.03, 0.0, abs(om - 0.1)) * 0.12;
          float cap = smoothstep(0.88, 0.94, p.y + 0.03*d) + smoothstep(0.9, 0.96, -p.y + 0.03*d);
          col = mix(col, vec3(0.96,0.93,0.9), cap);
        } else if (kind < 4.5) { // banded giant
          float warp = fbm(p*vec3(3.0, 9.0, 3.0) + vec3(time*0.02, 0.0, 0.0)) * 0.35;
          float la2 = lat + warp*0.4; float b = sin(la2 * bands * 2.0) * 0.7 + sin(la2 * bands * 3.7 + 1.3) * 0.3;
          float fine = fbm(vec3(lat*28.0, lon*1.5 + time*0.05, 0.0) + p*2.0);
          col = mix(c2, c1, smoothstep(-0.3, 0.6, b));
          col = mix(col, c3, smoothstep(0.5, 1.0, -b) * 0.6);
          col += fine * 0.1; col = mix(col, c3 * 1.1, smoothstep(0.55, 0.9, fbm(p * vec3(6.0, 20.0, 6.0) + vec3(time*0.03, 0.0, 0.0))) * 0.35 * (1.0 - abs(b)));
          if (spot > 0.5) { // Great Red Spot at 22°S
            vec3 sc = dirFromLatLon(-22.0, 60.0); vec3 dp = p - sc; float e = length(vec2(dot(dp, normalize(cross(vec3(0,1,0), sc)))*0.62, dp.y));
            float sw = fbm(p*14.0 + vec3(0.0, 0.0, atan(dp.y, dp.x)*0.5));
            col = mix(col, vec3(0.78,0.36,0.22), smoothstep(0.11, 0.06, e + sw*0.02));
            col = mix(col, c1, smoothstep(0.02, 0.0, abs(e - 0.115)) * 0.6);
          }
          if (hex > 0.5) { // Saturn's north polar hexagon
            float a = atan(p.z, p.x); float k = cos(3.14159/6.0) / cos(mod(a, 3.14159/3.0) - 3.14159/6.0);
            float r = sqrt(1.0 - p.y*p.y) / k;
            col = mix(col, c3*0.9, smoothstep(0.012, 0.0, abs(r - 0.24)) * step(0.0, p.y));
            col = mix(col, vec3(0.45,0.5,0.6), smoothstep(0.22, 0.12, r) * step(0.0, p.y) * 0.5);
          }
        } else { // ice giant
          float b = sin(lat * bands * 2.0 + fbm(p*4.0)*0.6);
          col = mix(c2, c1, 0.55 + 0.25*b);
          col = mix(col, c3, smoothstep(0.75, 0.9, p.y) * 0.5);
          float streak = smoothstep(0.35, 0.6, fbm(vec3(lat*30.0, lon*2.0 + time*0.08, 1.0))) * smoothstep(0.5, 0.2, abs(lat + 0.6));
          col = mix(col, vec3(0.95), streak * 0.5 * spot);
          if (spot > 0.5) { vec3 sc = dirFromLatLon(-20.0, 60.0); float e = distance(p, sc); col = mix(col, c2*0.45, smoothstep(0.1, 0.05, e)); }
        }
        // light: lambert with a soft terminator, plus a coloured limb
        vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
        float d = dot(N, sunDir); float lit = smoothstep(-0.08, 0.35, d) * (0.35 + 0.75*max(d, 0.0));
        vec3 outc = col * (0.05 + lit * 1.15);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
        outc += atm * rim * atmK * (0.15 + 0.85*smoothstep(-0.3, 0.4, d));
        outc = mix(outc, accent, highlight * 0.25 + highlight * rim * 0.6);
        float a = 1.0 - glass * 0.82;
        if (!gl_FrontFacing) { outc *= 0.35; }
        gl_FragColor = vec4(outc, a);
      }`,
  });
}

// Thin atmosphere halo around the planet (additive, back faces).
export function haloMaterial(color, k) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, k: { value: k }, sunDir: { value: new THREE.Vector3(-1, 0.3, 0.5).normalize() } },
    vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform vec3 color; uniform float k; uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 V = normalize(cameraPosition - vW); float f = pow(1.0 - abs(dot(vN, V)), 3.0); float day = smoothstep(-0.4, 0.5, dot(vN, sunDir));
        gl_FragColor = vec4(color, f * k * (0.2 + 0.8*day)); }`,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// Rings: radial opacity profile from a canvas strip, the planet's shadow cut out.
export function ringMaterial(tex, inner, outer, tint) {
  return new THREE.ShaderMaterial({
    uniforms: { strength: { value: 1 }, map: { value: tex }, inner: { value: inner }, outer: { value: outer }, tint: { value: new THREE.Color(tint) }, sunDir: { value: new THREE.Vector3(-1, 0.3, 0.5).normalize() }, center: { value: new THREE.Vector3() }, radius: { value: 1 }, glass: { value: 0 } },
    vertexShader: 'varying vec3 vL; varying vec3 vW; void main(){ vL = position; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform sampler2D map; uniform float inner, outer, radius, glass, strength; uniform vec3 tint, sunDir, center; varying vec3 vL; varying vec3 vW;
      void main(){ float r = length(vL.xy); float t = (r - inner) / (outer - inner); if (t < 0.0 || t > 1.0) discard;
        vec4 s = texture2D(map, vec2(t, 0.5));
        vec3 rel = vW - center; float along = dot(rel, sunDir); float perp = length(rel - along*sunDir);
        float shadow = (along < 0.0 && perp < radius) ? 0.18 : 1.0;
        gl_FragColor = vec4(tint * s.rgb * shadow, s.a * strength * (1.0 - glass*0.5)); }`,
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
  });
}
