// Live, draggable polar 3D-tilt dial.
// Sun puck rides an ellipse; user drags it around to set the hour.
// Emits hour changes via onChange.

function PolarDialLive({ hour, onChange, size = 460, accent = '#c2410c' }) {
  const cx = size / 2;
  const cy = size / 2 + 10;
  const rx = size * 0.42;
  const ry = size * 0.16;
  const altArcR = rx;
  const altArcRy = rx * 1.05;

  const dragging = React.useRef(false);
  const svgRef = React.useRef(null);

  // Map hour to point on ellipse (going counter-clockwise from west=hour 0/24)
  // Actually: hour 6 = east horizon (right, y=0 on ellipse), hour 12 = top of altitude arc, hour 18 = west.
  // We'll use the ellipse for *position around horizon* and lift the puck
  // up onto the altitude arc when sun is above horizon.
  // Approach: compute azimuth and altitude, then map to 3D-tilted projection.
  const az = AtmData.azimuth(hour); // 0..360, 180 = south (front)
  const alt = AtmData.altitude(hour); // -70..+70

  // Project: x by azimuth on ellipse (south=front bottom, north=back top)
  // azimuth 180 (S) → puck on front of ellipse (cy + ry)
  // azimuth 0 (N) → puck on back of ellipse (cy - ry)
  // azimuth 90 (E) → right; 270 (W) → left
  // We use parametric ellipse: x = cx + rx * sin(az), y = cy + ry * -cos(az - 180) ... let's just use sin/cos cleanly.
  // angle theta where theta=0 → south front, theta=90 → west left, etc.
  const theta = (az - 180) * Math.PI / 180; // 0 = south = front
  const horizonX = cx + rx * Math.sin(theta);
  const horizonY = cy + ry * Math.cos(theta) * -1; // negative so south = +ry (front, lower screen)... wait

  // Let me redo: standard ellipse parametric x = cx + rx*cos(a), y = cy + ry*sin(a).
  // I want: az=180 (S) → bottom of ellipse → y = cy + ry
  // az=0 (N) → top → y = cy - ry; az=90 (E) → right → x = cx + rx; az=270 (W) → left
  // Parametric a in radians: x = cx + rx*sin(rad(az)), y = cy - ry*cos(rad(az))
  const azRad = (az * Math.PI) / 180;
  const hx = cx + rx * Math.sin(azRad);
  const hy = cy - ry * Math.cos(azRad);

  // For altitude > 0, lift the puck along the altitude arc visually
  const altT = Math.max(0, alt) / 70; // 0..1
  // Lift vector goes upward (negative Y), more so at higher altitude
  const liftY = altT * altArcRy * 0.95;
  // The puck horizontal position also pinches toward center as it lifts
  const liftPinch = 1 - altT * 0.35;
  const sunX = cx + (hx - cx) * liftPinch;
  const sunY = hy - liftY;
  const belowHorizon = alt < 0;

  // Drag handling
  const handlePointer = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * size;
    const py = ((e.clientY - rect.top) / rect.height) * size;
    const dx = px - cx;
    const dy = py - cy;
    // Inverse parametric: we treat the position as if it were ON the ellipse,
    // map to azimuth, ignore vertical lift for simplicity (drag horizontally
    // around the horizon to scrub time).
    // Normalize: a = atan2(dx/rx, -dy/ry) → returns azimuth radians
    const a = Math.atan2(dx / rx, -dy / Math.max(ry, 1));
    let azDeg = (a * 180) / Math.PI;
    if (azDeg < 0) azDeg += 360;
    // Inverse of azimuth(hour): azimuth = (hour/24)*360
    // → hour = azDeg / 360 * 24
    const h = (azDeg / 360) * 24;
    onChange(h);
  };

  React.useEffect(() => {
    function move(e) { if (dragging.current) handlePointer(e); }
    function up() { dragging.current = false; document.body.style.cursor = ''; }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  });

  // Sun arc trail: from sunrise (hour 6) to current hour, follow the projected path
  const trailPath = React.useMemo(() => {
    const start = 6;
    const end = Math.max(start, Math.min(hour, 18));
    if (end <= start) return '';
    const steps = 60;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const h = start + ((end - start) * i) / steps;
      const a = AtmData.azimuth(h);
      const al = AtmData.altitude(h);
      const r = (a * Math.PI) / 180;
      const xx = cx + rx * Math.sin(r);
      const yy = cy - ry * Math.cos(r);
      const t = Math.max(0, al) / 70;
      const lift = t * altArcRy * 0.95;
      const pinch = 1 - t * 0.35;
      pts.push([cx + (xx - cx) * pinch, yy - lift]);
    }
    return 'M ' + pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ');
  }, [hour, cx, cy, rx, ry, altArcRy]);

  // Tick marks every hour
  const ticks = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * 360;
    const ar = (a * Math.PI) / 180;
    const x1 = cx + rx * Math.sin(ar);
    const y1 = cy - ry * Math.cos(ar);
    const big = i % 6 === 0;
    const len = big ? 14 : 6;
    // Outward normal of ellipse (approx)
    const nx = Math.sin(ar);
    const ny = -Math.cos(ar) * (ry / rx);
    const m = Math.sqrt(nx * nx + ny * ny);
    const x2 = x1 + (nx / m) * len;
    const y2 = y1 + (ny / m) * len;
    ticks.push(
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="rgba(255,255,255,0.55)" strokeWidth={big ? 1.5 : 0.7}
            opacity={big ? 1 : 0.5} />
    );
  }

  // Label positions for 6/12/18/0
  const labels = [
    { h: 0, txt: '00' }, { h: 6, txt: '06' }, { h: 12, txt: '12' }, { h: 18, txt: '18' },
  ];

  return (
    <svg ref={svgRef} viewBox={`0 0 ${size} ${size}`} width={size} height={size}
         style={{ display: 'block', userSelect: 'none', touchAction: 'none' }}>
      <defs>
        <radialGradient id="sunPuck">
          <stop offset="0%" stopColor="#fff7e0" />
          <stop offset="35%" stopColor="#ffd07a" />
          <stop offset="75%" stopColor={accent} />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="moonPuck">
          <stop offset="0%" stopColor="#f7f3e8" />
          <stop offset="60%" stopColor="#c2c8d0" />
          <stop offset="100%" stopColor="#9aa1aa" stopOpacity="0" />
        </radialGradient>
        <filter id="puckGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* Horizon plate — main ellipse */}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry}
               fill="rgba(255,255,255,0.04)"
               stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
      {/* Inner ellipse */}
      <ellipse cx={cx} cy={cy} rx={rx * 0.78} ry={ry * 0.78}
               fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.7" />
      {/* Innermost ellipse */}
      <ellipse cx={cx} cy={cy} rx={rx * 0.45} ry={ry * 0.45}
               fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" strokeDasharray="2 3" />

      {/* Altitude arc (vertical semicircle behind, foreshortened) */}
      <path d={`M ${cx - rx} ${cy} A ${rx} ${altArcRy} 0 0 1 ${cx + rx} ${cy}`}
            fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1" strokeDasharray="3 4" />

      {/* Tick marks */}
      {ticks}

      {/* Hour labels */}
      {labels.map(L => {
        const a = (L.h / 24) * 360;
        const ar = (a * Math.PI) / 180;
        const r = rx + 26;
        const x = cx + r * Math.sin(ar);
        const y = cy - (ry + 18) * Math.cos(ar);
        return (
          <text key={L.h} x={x} y={y + 4}
                textAnchor="middle"
                fontFamily="'JetBrains Mono', monospace"
                fontSize="11"
                fill="rgba(255,255,255,0.75)"
                letterSpacing="1.5">{L.txt}</text>
        );
      })}

      {/* Cardinal points */}
      <text x={cx} y={cy + ry + 32} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="11" fill="rgba(255,255,255,0.55)" letterSpacing="3">S</text>
      <text x={cx} y={cy - ry - 22} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="11" fill="rgba(255,255,255,0.55)" letterSpacing="3">N</text>
      <text x={cx + rx + 38} y={cy + 4} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="11" fill="rgba(255,255,255,0.55)" letterSpacing="3">E</text>
      <text x={cx - rx - 38} y={cy + 4} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="11" fill="rgba(255,255,255,0.55)" letterSpacing="3">W</text>

      {/* Sun arc trail */}
      {trailPath && (
        <path d={trailPath} fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
      )}

      {/* Observer pin (center) */}
      <circle cx={cx} cy={cy} r="3" fill="rgba(255,255,255,0.85)" />
      <circle cx={cx} cy={cy} r="8" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8" />

      {/* Sun/moon puck — large halo + core. Draggable. */}
      <g style={{ cursor: 'grab' }}
         onPointerDown={(e) => { dragging.current = true; document.body.style.cursor = 'grabbing'; handlePointer(e); }}>
        <circle cx={sunX} cy={sunY} r="38" fill={`url(#${belowHorizon ? 'moonPuck' : 'sunPuck'})`} opacity="0.65" filter="url(#puckGlow)" />
        <circle cx={sunX} cy={sunY} r="14"
                fill={belowHorizon ? '#e6e9ef' : '#fff'}
                stroke={belowHorizon ? '#9aa1aa' : accent}
                strokeWidth="2" />
        <circle cx={sunX} cy={sunY} r="22" fill="none" stroke={belowHorizon ? 'rgba(230,233,239,0.4)' : 'rgba(255,255,255,0.5)'} strokeWidth="0.7" strokeDasharray="2 3" />
        {/* invisible larger hit area for easier dragging */}
        <circle cx={sunX} cy={sunY} r="32" fill="transparent" />
      </g>
    </svg>
  );
}

window.PolarDialLive = PolarDialLive;
