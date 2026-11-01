// Procedural canvas textures (no image downloads).
import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Concrete with 5 ft lift lines and column joints. One tile = 30 m wide, 15 m tall.
export function concreteTexture() {
  const c = canvas(512, 256), g = c.getContext('2d');
  const r = rnd(7);
  g.fillStyle = '#cfc6b6'; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 190 + r() * 35 | 0;
    g.fillStyle = `rgba(${v},${v - 6},${v - 14},${0.06 + r() * 0.08})`;
    g.fillRect(r() * 512, r() * 256, 1 + r() * 3, 1 + r() * 3);
  }
  // water staining streaks
  for (let i = 0; i < 40; i++) {
    const x = r() * 512, w = 2 + r() * 10;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(90,80,66,0)'); grd.addColorStop(0.5, `rgba(90,80,66,${0.02 + r() * 0.035})`); grd.addColorStop(1, 'rgba(90,80,66,0)');
    g.fillStyle = grd; g.fillRect(x, 0, w, 256);
  }
  g.strokeStyle = 'rgba(70,62,52,0.13)'; g.lineWidth = 1.2;
  for (let y = 0; y <= 256; y += 25.6) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(512, y + 0.5); g.stroke(); }
  g.strokeStyle = 'rgba(60,52,44,0.16)'; g.lineWidth = 1.4;
  for (const x of [3, 256 + 3]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// Tall Art Deco window bays for the powerhouse. Also returns an emissive map.
export function powerhouseTextures() {
  const c = canvas(512, 256), g = c.getContext('2d');
  const e = canvas(512, 256), ge = e.getContext('2d');
  g.fillStyle = '#d6cdbd'; g.fillRect(0, 0, 512, 256);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 512, 256);
  const r = rnd(3);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(120,110,95,${r() * 0.15})`; g.fillRect(r() * 512, r() * 256, 2, 2); }
  for (let b = 0; b < 8; b++) {
    const x = 14 + b * 64;
    g.fillStyle = '#bfb5a3'; g.fillRect(x - 6, 0, 4, 256);
    g.fillStyle = '#2a3238'; g.fillRect(x + 6, 40, 36, 170);
    ge.fillStyle = r() > 0.25 ? '#ffcf8a' : '#5a4630'; ge.fillRect(x + 6, 40, 36, 170);
    g.fillStyle = 'rgba(200,190,170,0.9)';
    for (let k = 0; k < 6; k++) g.fillRect(x + 6, 40 + k * 28, 36, 2);
    g.fillRect(x + 23, 40, 2, 170);
    ge.fillStyle = '#000'; for (let k = 0; k < 6; k++) ge.fillRect(x + 6, 40 + k * 28, 36, 2);
  }
  g.fillStyle = '#b4aa98'; g.fillRect(0, 0, 512, 16); g.fillRect(0, 232, 512, 24);
  const map = new THREE.CanvasTexture(c), emi = new THREE.CanvasTexture(e);
  for (const t of [map, emi]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; }
  return { map, emi };
}

// Tiling ripple normal map from summed sines (seamless).
export function rippleNormal(size = 256) {
  const c = canvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const waves = [];
  const r = rnd(11);
  for (let i = 0; i < 14; i++) waves.push({ kx: (1 + (r() * 6 | 0)) * (r() > 0.5 ? 1 : -1), ky: (r() * 7 | 0) - 3, a: 0.4 + r(), p: r() * 6.28 });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let dx = 0, dy = 0;
    for (const w of waves) {
      const ph = (w.kx * x + w.ky * y) / size * Math.PI * 2 + w.p;
      const d = Math.cos(ph) * w.a;
      dx += d * w.kx; dy += d * w.ky;
    }
    const s = 0.035;
    let nx = -dx * s, ny = -dy * s, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Soft round sprite for particles and glows.
export function softDot() {
  const c = canvas(64, 64), g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

// Clock face for the intake towers. Redrawn when the sim minute changes.
export function clockFace() {
  const c = canvas(128, 128), g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  let last = -1;
  function draw(hour, label) {
    const m = Math.floor(hour * 60) % 1440;
    if (m === last) return; last = m;
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#e8dcc0'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a3226'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#3a3226';
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillRect(64 + Math.sin(a) * 48 - 2, 64 - Math.cos(a) * 48 - 2, 4, 4); }
    g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.fillText(label, 64, 94);
    const h = (m / 60) % 12, mm = m % 60;
    g.lineCap = 'round';
    g.lineWidth = 6; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.sin(h / 12 * 6.283) * 28, 64 - Math.cos(h / 12 * 6.283) * 28); g.stroke();
    g.lineWidth = 3.5; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.sin(mm / 60 * 6.283) * 42, 64 - Math.cos(mm / 60 * 6.283) * 42); g.stroke();
    tex.needsUpdate = true;
  }
  return { tex, draw };
}
