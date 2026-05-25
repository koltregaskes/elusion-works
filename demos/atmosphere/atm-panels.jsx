// Glass-panel components: cloud cross-section, telemetry cards, forecast strip.
// All driven by hour state so they update live with the dial scrub.

function GlassPanel({ children, style, className = '' }) {
  return (
    <div className={`glass-panel ${className}`} style={{
      position: 'relative',
      background: 'rgba(255, 255, 255, 0.06)',
      backdropFilter: 'blur(28px) saturate(140%)',
      WebkitBackdropFilter: 'blur(28px) saturate(140%)',
      border: '1px solid rgba(255, 255, 255, 0.14)',
      borderRadius: 18,
      boxShadow: '0 1px 0 rgba(255,255,255,0.18) inset, 0 30px 60px -30px rgba(0,0,0,0.45)',
      ...style,
    }}>{children}</div>
  );
}

function MonoLabel({ children, accent, style }) {
  return (
    <span style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10,
      letterSpacing: 1.6,
      textTransform: 'uppercase',
      color: accent ? 'var(--atm-accent)' : 'rgba(255,255,255,0.6)',
      ...style,
    }}>{children}</span>
  );
}

function BigNum({ value, unit, color = '#fff', size = 64 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{
        fontFamily: "'Geist', 'Geist Variable', system-ui, sans-serif",
        fontVariantNumeric: 'tabular-nums',
        fontSize: size, fontWeight: 500,
        color, lineHeight: 0.95, letterSpacing: '-0.03em',
      }}>{value}</span>
      {unit && (
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: Math.max(11, size * 0.18),
          color: 'rgba(255,255,255,0.55)',
          letterSpacing: 1.2,
        }}>{unit}</span>
      )}
    </div>
  );
}

// Cloud intercept — wide horizon cross-section, driven by hour
function CloudHorizon({ hour, accent }) {
  const W = 1280, H = 220;
  // Sun position high in scene at noon, near horizon at sunrise/sunset
  const alt = AtmData.altitude(hour);
  const az = AtmData.azimuth(hour);
  // Observer on the right side, ray goes left/up to sun
  const obsX = 180, obsY = H - 30;
  // Sun X moves across scene based on azimuth
  const sunNorm = (az - 90) / 180; // 0 at E, 1 at W
  const sunX = 320 + sunNorm * 880;
  const sunY = Math.max(20, H - 30 - Math.max(0, alt) * 2.5);

  const layers = [
    { name: 'CIRRUS', sub: '9–12 km', density: 12, y: 40 },
    { name: 'ALTOCUMULUS', sub: '2–6 km', density: 34, y: 90 },
    { name: 'STRATUS', sub: '0–2 km', density: 7, y: 140 },
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="rayGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={accent} stopOpacity="0.2" />
          <stop offset="100%" stopColor={accent} stopOpacity="1" />
        </linearGradient>
        <filter id="rayGlow">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* Layer bands */}
      {layers.map((L, i) => (
        <g key={i}>
          <line x1={20} y1={L.y} x2={W - 20} y2={L.y} stroke="rgba(255,255,255,0.18)" strokeWidth="0.6" strokeDasharray="2 5" />
          {/* cloud ellipses — density modulates opacity */}
          {Array.from({ length: 18 }, (_, j) => {
            const cx = 50 + j * (W - 100) / 17 + (i * 14);
            const rx = 30 + ((j + i) % 4) * 4;
            const ry = 8 + (i === 0 ? -2 : 0);
            const op = 0.18 + (L.density / 100) * 0.65;
            return (
              <ellipse key={j} cx={cx} cy={L.y + 10 + (j % 2) * 3} rx={rx} ry={ry}
                       fill="rgba(255,255,255,0.85)" opacity={op * 0.55}
                       style={{ mixBlendMode: 'screen' }} />
            );
          })}
          <text x={20} y={L.y - 6}
                fontFamily="'JetBrains Mono', monospace" fontSize="9"
                fill="rgba(255,255,255,0.55)" letterSpacing="1.4">{L.name} · {L.sub}</text>
          <text x={W - 20} y={L.y - 6} textAnchor="end"
                fontFamily="'JetBrains Mono', monospace" fontSize="11"
                fill="rgba(255,255,255,0.95)" fontWeight="600">{L.density}%</text>
        </g>
      ))}

      {/* Ground line */}
      <line x1={0} y1={H - 20} x2={W} y2={H - 20} stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" />

      {/* Observer */}
      <circle cx={obsX} cy={obsY} r="6" fill={accent} />
      <circle cx={obsX} cy={obsY} r="11" fill="none" stroke={accent} strokeWidth="1.2" opacity="0.5" />
      <text x={obsX} y={obsY + 22} textAnchor="middle"
            fontFamily="'JetBrains Mono', monospace" fontSize="9"
            fill="rgba(255,255,255,0.65)" letterSpacing="1.5">YOU</text>

      {/* Line-of-sight ray to sun */}
      <line x1={obsX} y1={obsY} x2={sunX} y2={sunY}
            stroke="url(#rayGrad)" strokeWidth="2.5" strokeLinecap="round" filter="url(#rayGlow)" />
      {/* Sun dot */}
      <circle cx={sunX} cy={sunY} r="14" fill="#fff7e0" opacity="0.95" />
      <circle cx={sunX} cy={sunY} r="22" fill="none" stroke={accent} strokeWidth="1" opacity="0.55" />
      <text x={sunX} y={sunY - 28} textAnchor="middle"
            fontFamily="'JetBrains Mono', monospace" fontSize="10"
            fill="rgba(255,255,255,0.85)" letterSpacing="1.4">SUN · {Math.round(Math.max(0, alt))}°</text>
    </svg>
  );
}

// 24-hour forecast strip — bar chart of altitude/intensity with current hour marker
function ForecastStripLive({ hour, accent }) {
  const W = 1280, H = 110;
  const blocks = 24;
  const bw = (W - 40) / blocks;
  const bars = Array.from({ length: blocks }, (_, i) => {
    const h = i + 0.5;
    const a = Math.max(0, AtmData.altitude(h));
    const r = AtmData.radiation(h);
    const height = (r / 960) * (H - 50);
    return { i, height, r, isCurrent: Math.floor(hour) === i };
  });
  const cursorX = 20 + hour * bw;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      <line x1={20} y1={H - 20} x2={W - 20} y2={H - 20} stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
      {bars.map(b => {
        const x = 20 + b.i * bw;
        const y = H - 20 - b.height;
        return (
          <g key={b.i}>
            <rect x={x + 2} y={y} width={bw - 4} height={b.height}
                  fill={b.isCurrent ? accent : 'rgba(255,255,255,0.55)'}
                  opacity={b.isCurrent ? 1 : 0.55}
                  rx="1" />
            {b.i % 3 === 0 && (
              <text x={x + bw / 2} y={H - 6} textAnchor="middle"
                    fontFamily="'JetBrains Mono', monospace" fontSize="9"
                    fill="rgba(255,255,255,0.5)" letterSpacing="1">{String(b.i).padStart(2, '0')}</text>
            )}
          </g>
        );
      })}
      {/* Cursor line */}
      <line x1={cursorX} y1={6} x2={cursorX} y2={H - 18} stroke={accent} strokeWidth="1.4" strokeDasharray="3 3" opacity="0.9" />
      <circle cx={cursorX} cy={6} r="4" fill={accent} />
    </svg>
  );
}

window.GlassPanel = GlassPanel;
window.MonoLabel = MonoLabel;
window.BigNum = BigNum;
window.CloudHorizon = CloudHorizon;
window.ForecastStripLive = ForecastStripLive;
