// Reactive sky backdrop — gradient + weather effects.
// Props: { hour, condition, intensity = 1 }
// Renders layered:
//   1. Time-of-day sky gradient (existing logic)
//   2. Sun-tracking radial bloom (sunny/partly-cloudy only)
//   3. Stars (night)
//   4. Cloud puffs (partly-cloudy / overcast / pre-rain) — CSS animated drift
//   5. Rain streaks (rain / heavy-rain / thunder) — canvas
//   6. Snow flakes (snow) — canvas
//   7. Fog haze bands (fog) — CSS animated soft blobs
//   8. Lightning flash (thunder) — random intermittent overlay
//   9. Grain (always)

(function () {
  const KEYS = [
    [0,    ['#05071a', '#0a0e24', '#161a34']],
    [4.5,  ['#0a0e28', '#1a1c3d', '#2c2348']],
    [6,    ['#162552', '#544066', '#a85a4a']],
    [7,    ['#28528c', '#7990b9', '#e0a87a']],
    [9,    ['#2972b8', '#75a8d4', '#cfe1ef']],
    [12,   ['#3a86d8', '#83b6e8', '#d0e3f4']],
    [15,   ['#3478c2', '#7eaeda', '#e6d2b6']],
    [17,   ['#3a4b8f', '#a55a55', '#e8924a']],
    [18.5, ['#1c2050', '#5a3a6a', '#9c3b58']],
    [20,   ['#0c1130', '#1e234c', '#3a2a50']],
    [22,   ['#06091e', '#0a0f2a', '#161a36']],
    [24,   ['#05071a', '#0a0e24', '#161a34']],
  ];
  function hexToRgb(h) { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  function rgbStr([r, g, b]) { return `rgb(${r|0}, ${g|0}, ${b|0})`; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpRgb(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  // Overcast & rain desaturate the sky; mix toward gray.
  function desaturate(rgb, amount) {
    const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
    return [lerp(rgb[0], avg, amount), lerp(rgb[1], avg, amount), lerp(rgb[2], avg, amount)];
  }
  function tint(rgb, target, amount) { return lerpRgb(rgb, target, amount); }

  function sample(hour, condition) {
    hour = ((hour % 24) + 24) % 24;
    let i = 0;
    while (i < KEYS.length - 1 && KEYS[i + 1][0] <= hour) i++;
    const [h0, c0] = KEYS[i];
    const [h1, c1] = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const t = h1 === h0 ? 0 : (hour - h0) / (h1 - h0);
    let layers = [0, 1, 2].map(k => lerpRgb(hexToRgb(c0[k]), hexToRgb(c1[k]), t));
    // Apply condition modulation
    if (condition === 'overcast') {
      layers = layers.map(c => desaturate(c, 0.7)).map(c => tint(c, [180, 185, 195], 0.4));
    } else if (condition === 'fog') {
      layers = layers.map(c => desaturate(c, 0.5)).map(c => tint(c, [210, 215, 220], 0.45));
    } else if (condition === 'rain') {
      layers = layers.map(c => desaturate(c, 0.55)).map(c => tint(c, [110, 120, 140], 0.3));
    } else if (condition === 'heavy-rain' || condition === 'thunder') {
      layers = layers.map(c => desaturate(c, 0.7)).map(c => tint(c, [60, 70, 95], 0.5));
    } else if (condition === 'snow') {
      layers = layers.map(c => desaturate(c, 0.6)).map(c => tint(c, [195, 210, 225], 0.45));
    } else if (condition === 'partly-cloudy') {
      layers = layers.map(c => desaturate(c, 0.18));
    }
    return layers;
  }

  function darkness(hour) {
    const h = ((hour % 24) + 24) % 24;
    const v = Math.cos(((h - 12) / 24) * Math.PI * 2);
    return Math.max(0, Math.min(1, (1 - v) / 2));
  }

  window.AtmSky = { sample, rgbStr, darkness };
})();

// ---------- React backdrop ----------

function SkyBackdrop({ hour, condition = 'sunny' }) {
  const colors = AtmSky.sample(hour, condition);
  const [zenith, mid, horizon] = colors.map(AtmSky.rgbStr);
  const dark = AtmSky.darkness(hour);
  const sunAngle = ((hour / 24) * Math.PI * 2) - Math.PI / 2;
  const sunX = 50 + Math.cos(sunAngle - Math.PI / 2) * 45;
  const sunY = 100 - Math.max(-10, Math.sin(((hour - 6) / 12) * Math.PI) * 110);
  const showSunBloom = (condition === 'sunny' || condition === 'partly-cloudy') && dark < 0.9;
  const bloomOpacity = (1 - dark) * (condition === 'partly-cloudy' ? 0.18 : 0.32);

  return (
    <div className="sky-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(180deg, ${zenith} 0%, ${mid} 55%, ${horizon} 100%)`,
        transition: 'background 240ms linear',
      }} />
      {showSunBloom && (
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(circle at ${sunX}% ${sunY}%, rgba(255, 200, 130, ${bloomOpacity}) 0%, transparent 38%)`,
          mixBlendMode: 'screen', transition: 'background 240ms linear',
        }} />
      )}
      <Stars opacity={dark * (condition === 'sunny' ? 1 : 0.4)} />

      {/* Condition layers */}
      {(condition === 'partly-cloudy' || condition === 'overcast') && <CloudDrift density={condition === 'overcast' ? 1 : 0.45} dark={dark} />}
      {condition === 'fog' && <FogHaze />}
      {(condition === 'rain' || condition === 'heavy-rain' || condition === 'thunder') && (
        <>
          <CloudDrift density={1} dark={dark} dark2 />
          <RainCanvas heavy={condition !== 'rain'} />
        </>
      )}
      {condition === 'thunder' && <LightningFlash />}
      {condition === 'snow' && <>
        <CloudDrift density={0.85} dark={dark} />
        <SnowCanvas />
      </>}

      {/* Grain */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.5'/></svg>`)}")`,
        opacity: 0.06, mixBlendMode: 'overlay', pointerEvents: 'none',
      }} />

      {/* Horizon glow */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: '12%', height: 1,
        background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,${0.12 + 0.08 * (1 - dark)}) 50%, transparent 100%)`,
      }} />
    </div>
  );
}

function Stars({ opacity }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current && !ref.current.dataset.seeded) {
      const stars = [];
      let s = 1234567;
      const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let i = 0; i < 180; i++) {
        stars.push(`<circle cx="${rnd() * 100}" cy="${rnd() * 70}" r="${rnd() * 1.4 + 0.3}" fill="white" opacity="${0.4 + rnd() * 0.6}"/>`);
      }
      ref.current.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">${stars.join('')}</svg>`;
      ref.current.dataset.seeded = '1';
    }
  }, []);
  return <div ref={ref} style={{ position: 'absolute', inset: 0, opacity, transition: 'opacity 400ms linear' }} />;
}

// Slow-drifting cloud puffs at multiple parallax depths.
function CloudDrift({ density = 0.5, dark = 0, dark2 = false }) {
  // Cache the cloud set on mount so it doesn't regenerate on each rerender.
  const cloudsRef = React.useRef(null);
  if (!cloudsRef.current) {
    let s = 314159;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const out = [];
    const n = Math.floor(8 + density * 14);
    for (let i = 0; i < n; i++) {
      out.push({
        x: rnd() * 110 - 5,    // %
        y: 5 + rnd() * 55,    // % (upper sky)
        scale: 0.5 + rnd() * 1.2,
        speed: 60 + rnd() * 120,
        depth: rnd(),
        delay: -rnd() * 200,
      });
    }
    cloudsRef.current = out;
  }
  const tint = dark2 ? 'rgba(50, 55, 70, 0.85)' : `rgba(245, 248, 255, ${0.7 - dark * 0.45})`;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {cloudsRef.current.map((c, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${c.x}%`, top: `${c.y}%`,
          width: 220 * c.scale, height: 70 * c.scale,
          transform: `translateZ(0)`,
          opacity: density * (0.55 + c.depth * 0.45),
          animation: `cloudDrift ${c.speed}s linear ${c.delay}s infinite`,
        }}>
          <CloudPuff color={tint} />
        </div>
      ))}
    </div>
  );
}

function CloudPuff({ color }) {
  // Soft blurred ellipse cluster — looks like a cloud without SVG slop
  return (
    <div style={{
      width: '100%', height: '100%',
      background: `radial-gradient(ellipse 60% 90% at 30% 60%, ${color} 0%, transparent 70%),
                   radial-gradient(ellipse 70% 80% at 55% 40%, ${color} 0%, transparent 75%),
                   radial-gradient(ellipse 50% 70% at 75% 65%, ${color} 0%, transparent 70%)`,
      filter: 'blur(2px)',
    }} />
  );
}

function FogHaze() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {[0, 1, 2, 3].map(i => (
        <div key={i} style={{
          position: 'absolute',
          left: '-20%', right: '-20%',
          top: `${20 + i * 22}%`, height: '35%',
          background: 'radial-gradient(ellipse 60% 100% at 50% 50%, rgba(220, 225, 232, 0.45) 0%, transparent 65%)',
          filter: 'blur(8px)',
          animation: `fogDrift ${80 + i * 30}s linear ${-i * 25}s infinite`,
          opacity: 0.6 + i * 0.05,
        }} />
      ))}
    </div>
  );
}

function RainCanvas({ heavy = false }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0; let drops = [];
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const count = heavy ? 280 : 130;
      drops = Array.from({ length: count }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        l: 8 + Math.random() * (heavy ? 18 : 10),
        v: 6 + Math.random() * (heavy ? 12 : 6),
        o: 0.25 + Math.random() * 0.5,
      }));
    }
    resize();
    window.addEventListener('resize', resize);
    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(180, 200, 230, 0.55)';
      ctx.lineWidth = 1;
      for (const d of drops) {
        ctx.globalAlpha = d.o;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 1.5, d.y + d.l);
        ctx.stroke();
        d.y += d.v;
        d.x -= 0.5;
        if (d.y > canvas.height) {
          d.y = -d.l;
          d.x = Math.random() * canvas.width + 50;
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    frame();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [heavy]);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
}

function SnowCanvas() {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0; let flakes = [];
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      flakes = Array.from({ length: 160 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: 1 + Math.random() * 2.5,
        v: 0.5 + Math.random() * 1.5,
        sw: Math.random() * Math.PI * 2,
        sa: 0.4 + Math.random() * 1.2,
        o: 0.5 + Math.random() * 0.5,
      }));
    }
    resize();
    window.addEventListener('resize', resize);
    function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const f of flakes) {
        ctx.globalAlpha = f.o;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
        f.y += f.v;
        f.sw += 0.02;
        f.x += Math.cos(f.sw) * f.sa;
        if (f.y > canvas.height + 5) {
          f.y = -5;
          f.x = Math.random() * canvas.width;
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    frame();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
}

function LightningFlash() {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    function next() {
      if (!alive) return;
      const wait = 4000 + Math.random() * 9000;
      setTimeout(() => {
        if (!alive) return;
        setOn(true);
        setTimeout(() => setOn(false), 90);
        setTimeout(() => { setOn(true); setTimeout(() => setOn(false), 60); }, 180);
        next();
      }, wait);
    }
    next();
    return () => { alive = false; };
  }, []);
  return <div style={{ position: 'absolute', inset: 0, background: 'rgba(220, 230, 255, 0.8)', opacity: on ? 1 : 0, transition: on ? 'none' : 'opacity 280ms ease-out', pointerEvents: 'none' }} />;
}

window.SkyBackdrop = SkyBackdrop;
