// The Earth: a drawn map (Natural Earth coastlines, lakes, borders, graticule) on a sphere,
// lit by the real Sun for the current sim time, with an atmosphere rim and a star field.
// Scene units: 1 = 1000 km. Earth-fixed things (map, observer, ground track) live in `fixed`,
// which rotates by Greenwich sidereal time.
import * as THREE from 'three';

export const RE = 6.371;

function mapTexture(earth, renderer) {
  const W = 4096, H = 2048;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const q = earth.q;
  const X = (lon) => (lon + 180) / 360 * W, Y = (lat) => (90 - lat) / 180 * H;
  const path = (ring, close) => {
    g.beginPath(); let x = 0, y = 0;
    for (let i = 0; i < ring.length; i += 2) {
      x += ring[i]; y += ring[i + 1];
      const px = X(x / q), py = Y(y / q);
      i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    if (close) g.closePath();
  };
  // ocean
  const oc = g.createLinearGradient(0, 0, 0, H);
  oc.addColorStop(0, '#0a1626'); oc.addColorStop(0.5, '#0a1b30'); oc.addColorStop(1, '#0a1626');
  g.fillStyle = oc; g.fillRect(0, 0, W, H);
  // graticule under the land
  g.strokeStyle = 'rgba(120,170,220,0.10)'; g.lineWidth = 1.2;
  for (let lon = -180; lon <= 180; lon += 15) { g.beginPath(); g.moveTo(X(lon), 0); g.lineTo(X(lon), H); g.stroke(); }
  for (let lat = -75; lat <= 75; lat += 15) { g.beginPath(); g.moveTo(0, Y(lat)); g.lineTo(W, Y(lat)); g.stroke(); }
  g.strokeStyle = 'rgba(120,190,255,0.22)'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(W, Y(0)); g.stroke();
  // land
  g.fillStyle = '#263c54';
  for (const r of earth.land) { path(r, true); g.fill(); }
  g.fillStyle = '#0a1b30';
  for (const r of earth.lakes) { path(r, true); g.fill(); }
  // borders and coasts
  g.strokeStyle = 'rgba(150,190,230,0.22)'; g.lineWidth = 1.1;
  for (const r of earth.borders) { path(r, false); g.stroke(); }
  g.strokeStyle = 'rgba(160,215,255,0.95)'; g.lineWidth = 2;
  for (const r of earth.land) { path(r, true); g.stroke(); }
  g.strokeStyle = 'rgba(140,200,255,0.4)'; g.lineWidth = 1.2;
  for (const r of earth.lakes) { path(r, true); g.stroke(); }
  // land mask in alpha for the night side
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export class Globe {
  constructor(scene, renderer) {
    this.root = new THREE.Group(); scene.add(this.root);
    this.fixed = new THREE.Group(); this.root.add(this.fixed);
    this.inertial = new THREE.Group(); this.root.add(this.inertial); // swarm, orbits, stars
    this.sunDir = new THREE.Vector3(1, 0, 0);
    this.uniforms = { map: { value: null }, sunDir: { value: this.sunDir }, hasMap: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform vec3 sunDir; uniform float hasMap;
        varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 base = hasMap > 0.5 ? texture2D(map, vUv).rgb : vec3(0.04,0.08,0.13);
          float d = dot(normalize(vN), sunDir);
          float day = smoothstep(-0.12, 0.22, d);
          vec3 night = base * vec3(0.38, 0.45, 0.66);
          vec3 lit = base * (1.0 + 1.25 * max(d, 0.0));
          vec3 col = mix(night, lit, day);
          // a thin warm band along the terminator
          col += vec3(1.0, 0.6, 0.3) * 0.025 * exp(-pow(d / 0.1, 2.0)) * (0.5 + base.r * 4.0);
          // ocean glint
          vec3 V = normalize(cameraPosition - vW); vec3 H = normalize(V + sunDir);
          float spec = pow(max(dot(normalize(vN), H), 0.0), 60.0) * day;
          float sea = 1.0 - smoothstep(0.06, 0.11, base.r);
          col += vec3(0.35, 0.55, 0.8) * spec * 0.35 * sea;
          float rim = pow(1.0 - max(dot(normalize(vN), V), 0.0), 3.0);
          col += vec3(0.25, 0.5, 0.9) * rim * (0.15 + 0.4 * day);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(RE, 160, 96), mat);
    this.fixed.add(this.earth);

    // atmosphere shell
    const atm = new THREE.Mesh(new THREE.SphereGeometry(RE * 1.035, 96, 64), new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: this.sunDir } },
      vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
        void main(){ vec3 V = normalize(cameraPosition - vW); float f = pow(1.0 - abs(dot(vN, V)), 2.6);
          float day = smoothstep(-0.35, 0.4, dot(vN, sunDir));
          vec3 c = mix(vec3(0.12,0.22,0.5), vec3(0.4,0.7,1.0), day);
          gl_FragColor = vec4(c, f * (0.25 + 0.6 * day)); }`,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.root.add(atm);

    // reference rings in the equatorial plane: LEO ceiling, GEO
    const ring = (rad, color, opacity, dashed) => {
      const pts = []; for (let i = 0; i <= 256; i++) { const a = i / 256 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * rad, 0, Math.sin(a) * rad)); }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const m = dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.6, gapSize: 0.5 }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      const l = new THREE.Line(geo, m); if (dashed) l.computeLineDistances(); return l;
    };
    this.rings = new THREE.Group();
    this.rings.add(ring(RE + 35.786, 0xffd166, 0.22, true));
    this.rings.add(ring(RE + 2.0, 0x7fe3ff, 0.12, true));
    this.rings.add(ring(RE + 20.2, 0xb59bff, 0.10, true));
    this.root.add(this.rings);

    // stars (inertial)
    const sp = []; const sc = [];
    let s = 3; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 4500; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 1400;
      const k = Math.sqrt(1 - u * u); sp.push(Math.cos(th) * k * r, u * r, Math.sin(th) * k * r);
      const b = 0.25 + Math.pow(rnd(), 6) * 0.9; const w = rnd();
      sc.push(b * (0.85 + w * 0.15), b * 0.92, b * (0.9 + (1 - w) * 0.25));
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
    this.inertial.add(this.stars);

    // observer marker and ground track, both earth-fixed
    this.obs = new THREE.Group();
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.12, 40), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    this.obs.add(dot, halo); this.obsHalo = halo;
    this.fixed.add(this.obs);
    this.ground = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }));
    this.ground.frustumCulled = false;
    this.fixed.add(this.ground);
  }

  async load(url, renderer) {
    const res = await fetch(url); if (!res.ok) throw new Error(`earth map ${res.status}`);
    const earth = await res.json();
    this.uniforms.map.value = mapTexture(earth, renderer);
    this.uniforms.hasMap.value = 1;
    return earth.src;
  }

  static latLonToVec(lat, lon, r = RE) { // degrees -> earth-fixed scene coords
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
    return new THREE.Vector3(Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, -Math.cos(la) * Math.sin(lo) * r);
  }

  setObserver(lat, lon) {
    const p = Globe.latLonToVec(lat, lon, RE * 1.002);
    this.obs.position.copy(p);
    this.obs.lookAt(p.clone().multiplyScalar(2));
  }

  setGround(arr) { // lat, lon (radians), height (km) triples
    const pts = [];
    let prevLon = null;
    for (let i = 0; i < arr.length; i += 3) {
      const lat = arr[i] * 180 / Math.PI, lon = arr[i + 1] * 180 / Math.PI;
      if (prevLon !== null && Math.abs(lon - prevLon) > 180) pts.push(NaN);
      pts.push(Globe.latLonToVec(lat, lon, RE * 1.003));
      prevLon = lon;
    }
    // break the line at the antimeridian by splitting into segments
    const seg = []; let cur = [];
    for (const p of pts) { if (Number.isNaN(p)) { if (cur.length > 1) seg.push(cur); cur = []; } else cur.push(p); }
    if (cur.length > 1) seg.push(cur);
    const flat = [];
    for (const s of seg) for (let i = 0; i < s.length - 1; i++) flat.push(s[i], s[i + 1]);
    const g = new THREE.BufferGeometry().setFromPoints(flat);
    this.fixed.remove(this.ground); this.ground.geometry.dispose();
    this.ground = new THREE.LineSegments(g, this.ground.material); this.ground.frustumCulled = false;
    this.fixed.add(this.ground);
  }
  clearGround() { this.ground.visible = false; }
  showGround() { this.ground.visible = true; }

  update(gmst, sun, ecef) {
    // ECI view: the Earth turns under the swarm. ECEF view: the Earth holds still.
    this.fixed.rotation.y = ecef ? 0 : gmst;
    this.inertial.rotation.y = ecef ? -gmst : 0;
    this.sunDir.copy(sun).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.inertial.rotation.y);
    this.obsHalo.rotation.z += 0.01;
  }
}
