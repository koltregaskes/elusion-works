// Atmosphere — Map view, Weather view, Setup view
// All three pages share the same vertical narrative layout and glass palette.

// ============ MAP VIEW ============

function MapView({ snapshot, hour, accent, location }) {
  // Pretty satellite/terrain-style map mockup with sun-bearing overlay.
  // Replace this whole inner SVG block with a Google Maps embed when a key
  // is available — see comment in atm-weather.js for the integration steps.

  const az = AtmData.azimuth(hour);
  const alt = AtmData.altitude(hour);
  const azRad = (az * Math.PI) / 180;

  // Sun direction line — from center (observer) outward in bearing direction
  const cx = 480, cy = 380;
  const len = 280;
  const sunX = cx + len * Math.sin(azRad);
  const sunY = cy - len * Math.cos(azRad);

  return (
    <section className="page-section">
      <div className="section-head">
        <div>
          <div className="section-num">Section 02 · Map</div>
          <div className="section-title">Where the sun is, where you are.</div>
        </div>
        <div className="section-meta">{location.label} · {location.lat}°N · {location.lon}°E</div>
      </div>

      <GlassPanel style={{ padding: 0, overflow: 'hidden', height: 720, position: 'relative' }}>
        {/* Map mockup */}
        <svg viewBox="0 0 960 720" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ display: 'block', position: 'absolute', inset: 0 }}>
          <defs>
            <pattern id="terrain-grid" width="60" height="60" patternUnits="userSpaceOnUse">
              <rect width="60" height="60" fill="rgba(40, 60, 80, 0.15)" />
              <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
            </pattern>
            <radialGradient id="terrain-bowl" cx="50%" cy="50%">
              <stop offset="0%" stopColor="rgba(80, 100, 120, 0.5)" />
              <stop offset="100%" stopColor="rgba(20, 30, 50, 0.95)" />
            </radialGradient>
            <radialGradient id="sun-glow-map">
              <stop offset="0%" stopColor="#fff7e0" stopOpacity="1" />
              <stop offset="40%" stopColor={accent} stopOpacity="0.7" />
              <stop offset="100%" stopColor={accent} stopOpacity="0" />
            </radialGradient>
            <filter id="bloom-map" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="8" />
            </filter>
          </defs>

          {/* Map base */}
          <rect width="960" height="720" fill="url(#terrain-bowl)" />
          <rect width="960" height="720" fill="url(#terrain-grid)" />

          {/* Fake roads */}
          <path d="M 0 280 Q 200 240 400 320 T 960 280" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
          <path d="M 0 460 Q 250 440 480 480 T 960 440" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.4" />
          <path d="M 320 0 Q 360 200 420 380 T 500 720" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1.6" />
          <path d="M 640 0 Q 620 200 580 380 T 600 720" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.2" />

          {/* Fake water */}
          <path d="M 700 80 Q 820 120 880 200 Q 920 280 880 340 Q 800 380 720 320 Q 640 240 700 80 Z"
                fill="rgba(80, 120, 160, 0.4)" stroke="rgba(150, 200, 240, 0.4)" strokeWidth="1" />

          {/* Fake parks/green */}
          <path d="M 80 460 Q 180 440 240 500 Q 260 580 180 620 Q 100 600 80 460 Z"
                fill="rgba(80, 140, 90, 0.3)" />
          <path d="M 500 560 Q 600 540 660 600 Q 640 680 540 680 Q 470 640 500 560 Z"
                fill="rgba(80, 140, 90, 0.3)" />

          {/* Buildings */}
          {Array.from({ length: 40 }).map((_, i) => {
            let s = (i * 9301 + 49297) % 233280;
            const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
            const x = r() * 920 + 20;
            const y = r() * 680 + 20;
            const w = 6 + r() * 18;
            const h = 6 + r() * 18;
            return <rect key={i} x={x} y={y} width={w} height={h} fill="rgba(180, 180, 190, 0.18)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.4" />;
          })}

          {/* Sun bearing visualization */}
          {alt > 0 && (
            <>
              {/* Wedge — area of sky the sun is in */}
              <path d={`M ${cx} ${cy} L ${cx + len * 1.2 * Math.sin(azRad - 0.18)} ${cy - len * 1.2 * Math.cos(azRad - 0.18)} A ${len * 1.2} ${len * 1.2} 0 0 1 ${cx + len * 1.2 * Math.sin(azRad + 0.18)} ${cy - len * 1.2 * Math.cos(azRad + 0.18)} Z`}
                    fill={accent} opacity="0.18" />
              {/* Ray */}
              <line x1={cx} y1={cy} x2={sunX} y2={sunY} stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 4" opacity="0.8" />
              {/* Sun disk */}
              <circle cx={sunX} cy={sunY} r="40" fill="url(#sun-glow-map)" filter="url(#bloom-map)" />
              <circle cx={sunX} cy={sunY} r="16" fill="#fff7e0" stroke={accent} strokeWidth="2" />
              <text x={sunX} y={sunY - 26} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="11" fill="#fff" letterSpacing="1.5">
                {Math.round(az)}° · {AtmWeather.bearingLabel(az)}
              </text>
            </>
          )}

          {/* Compass rose */}
          <g transform="translate(840, 80)">
            <circle r="38" fill="rgba(0,0,0,0.4)" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
            <path d="M 0 -32 L 6 0 L 0 32 L -6 0 Z" fill="rgba(255,255,255,0.85)" />
            <path d="M -32 0 L 0 -6 L 32 0 L 0 6 Z" fill="rgba(255,255,255,0.35)" />
            <text x="0" y="-22" textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="#fff" fontWeight="600">N</text>
          </g>

          {/* Scale bar */}
          <g transform="translate(40, 680)">
            <line x1="0" y1="0" x2="100" y2="0" stroke="#fff" strokeWidth="2" />
            <line x1="0" y1="-4" x2="0" y2="4" stroke="#fff" strokeWidth="2" />
            <line x1="100" y1="-4" x2="100" y2="4" stroke="#fff" strokeWidth="2" />
            <text x="50" y="-8" textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="#fff" letterSpacing="1">500 m</text>
          </g>

          {/* Observer pin */}
          <g>
            <circle cx={cx} cy={cy} r="32" fill={accent} opacity="0.15" />
            <circle cx={cx} cy={cy} r="18" fill={accent} opacity="0.35" />
            <circle cx={cx} cy={cy} r="10" fill="#fff" stroke={accent} strokeWidth="3" />
            <text x={cx} y={cy + 36} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="#fff" letterSpacing="1.5" fontWeight="600">YOU · {location.label}</text>
          </g>
        </svg>

        {/* Map controls overlay */}
        <div style={{ position: 'absolute', top: 24, left: 24, display: 'flex', gap: 8 }}>
          {['Satellite', 'Terrain', 'Streets'].map((m, i) => (
            <div key={i} style={{
              padding: '8px 14px', fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
              fontFamily: "'JetBrains Mono', monospace",
              background: i === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.18)', borderRadius: 999,
              color: i === 0 ? '#fff' : 'rgba(255,255,255,0.65)',
              backdropFilter: 'blur(20px)',
              cursor: 'pointer',
            }}>{m}</div>
          ))}
        </div>

        {/* Sun stats overlay (bottom-right) */}
        <div style={{ position: 'absolute', right: 24, bottom: 24, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(28px)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 14, padding: '16px 20px', minWidth: 220 }}>
          <MonoLabel>Sun · right now</MonoLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 10 }}>
            <div>
              <div className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.2 }}>BEARING</div>
              <div className="display num" style={{ fontSize: 26, color: '#fff' }}>{Math.round(az)}°</div>
              <div className="mono" style={{ fontSize: 10, color: accent, letterSpacing: 1 }}>{AtmWeather.bearingLabel(az)}</div>
            </div>
            <div>
              <div className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', letterSpacing: 1.2 }}>ALTITUDE</div>
              <div className="display num" style={{ fontSize: 26, color: '#fff' }}>{alt >= 0 ? '+' : ''}{Math.round(alt)}°</div>
              <div className="mono" style={{ fontSize: 10, color: accent, letterSpacing: 1 }}>{alt > 0 ? 'ABOVE' : 'BELOW'}</div>
            </div>
          </div>
        </div>

        {/* Placeholder banner */}
        <div style={{ position: 'absolute', top: 24, right: 24, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(20px)', border: '1px dashed rgba(255,255,255,0.25)', borderRadius: 10, padding: '8px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 1.4, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' }}>
          Map preview · Google Maps wires in via API key
        </div>
      </GlassPanel>
    </section>
  );
}

// ============ WEATHER VIEW ============

function WeatherView({ snapshot, dataset, hour, virtualOffset, accent, station }) {
  const cond = snapshot.condition;
  const condLabel = AtmWeather.conditionLabel(cond);

  return (
    <>
      <section className="page-section">
        <div className="section-head">
          <div>
            <div className="section-num">Section 02 · Weather</div>
            <div className="section-title">{condLabel}.</div>
          </div>
          <div className="section-meta">STATION · {station.id} · {snapshot.isHistory ? 'HISTORY' : snapshot.isForecast ? 'FORECAST' : 'OBSERVED'}</div>
        </div>

        {/* Temp hero */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 18 }}>
          <GlassPanel style={{ padding: 32, minHeight: 280 }}>
            <MonoLabel>Air temperature</MonoLabel>
            <div className="display num" style={{ fontSize: 124, color: '#fff', marginTop: 12, letterSpacing: '-0.04em' }}>
              {snapshot.airTemp.toFixed(1)}<span style={{ fontSize: 56, color: 'var(--atm-text-faint)' }}>°C</span>
            </div>
            <div className="display" style={{ fontSize: 22, color: 'var(--atm-text-soft)', marginTop: 4 }}>{condLabel}</div>
            <div style={{ display: 'flex', gap: 28, marginTop: 22 }}>
              <div>
                <MonoLabel>Feels like</MonoLabel>
                <div className="display num" style={{ fontSize: 28, color: '#fff' }}>{(snapshot.airTemp - snapshot.wind.speed * 0.15).toFixed(1)}°</div>
              </div>
              <div>
                <MonoLabel>Humidity</MonoLabel>
                <div className="display num" style={{ fontSize: 28, color: '#fff' }}>{snapshot.humidity}<span style={{ fontSize: 14, color: 'var(--atm-text-faint)' }}>%</span></div>
              </div>
              <div>
                <MonoLabel>Pressure</MonoLabel>
                <div className="display num" style={{ fontSize: 28, color: '#fff' }}>{snapshot.pressure}<span style={{ fontSize: 14, color: 'var(--atm-text-faint)' }}>hPa</span></div>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel style={{ padding: 24, minHeight: 280, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <MonoLabel>In the sun</MonoLabel>
              <div className="display num" style={{ fontSize: 72, color: accent, marginTop: 12, letterSpacing: '-0.04em' }}>
                {snapshot.sunTemp.toFixed(1)}<span style={{ fontSize: 32, color: 'var(--atm-text-faint)' }}>°C</span>
              </div>
            </div>
            <div>
              <MonoLabel>Shade</MonoLabel>
              <div className="display num" style={{ fontSize: 42, color: 'rgba(255,255,255,0.7)', marginTop: 6 }}>
                {(snapshot.airTemp - 1.2).toFixed(1)}<span style={{ fontSize: 20, color: 'var(--atm-text-faint)' }}>°C</span>
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--atm-text-faint)', letterSpacing: 1.2, marginTop: 4 }}>Δ {(snapshot.sunTemp - snapshot.airTemp + 1.2).toFixed(1)}°C SUN VS SHADE</div>
            </div>
          </GlassPanel>

          <GlassPanel style={{ padding: 24, minHeight: 280 }}>
            <MonoLabel>Wind</MonoLabel>
            <WindCompass speed={snapshot.wind.speed} dir={snapshot.wind.dir} gust={snapshot.wind.gust} accent={accent} />
          </GlassPanel>
        </div>
      </section>

      {/* Stats grid */}
      <section className="page-section">
        <div className="section-head">
          <div>
            <div className="section-num">Section 03 · Station feed</div>
            <div className="section-title">All the numbers.</div>
          </div>
          <div className="section-meta">WU · {station.id}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <StatCard label="Rain rate" value={snapshot.rain.toFixed(2)} unit="MM/H" sub={snapshot.rain > 0.1 ? 'Active' : 'Dry'} />
          <StatCard label="Today total" value={(snapshot.rain * 4 + 0.3).toFixed(1)} unit="MM" sub="Since 00:00" />
          <StatCard label="Dew point" value={(snapshot.airTemp - (100 - snapshot.humidity) / 5).toFixed(1)} unit="°C" />
          <StatCard label="Wind gust" value={snapshot.wind.gust.toFixed(1)} unit="MPH" sub={AtmWeather.bearingLabel(snapshot.wind.dir)} />
          <StatCard label="UV index" value={AtmData.uv(snapshot.hourOfDay).toFixed(1)} unit={AtmData.uvBand(AtmData.uv(snapshot.hourOfDay))} accent />
          <StatCard label="Solar radiation" value={AtmData.radiation(snapshot.hourOfDay)} unit="W/m²" />
          <StatCard label="Illuminance" value={AtmData.illuminance(snapshot.hourOfDay).toFixed(1)} unit="KLX" />
          <StatCard label="Sky cover" value={Math.round(snapshot.cloudiness * 100)} unit="%" />
        </div>
      </section>

      {/* 48h timeline — history left, forecast right */}
      <section className="page-section">
        <div className="section-head">
          <div>
            <div className="section-num">Section 04 · 48-Hour Timeline</div>
            <div className="section-title">Yesterday → tomorrow.</div>
          </div>
          <div className="section-meta">DRAG TO SCRUB · NOW MARKED</div>
        </div>
        <GlassPanel style={{ padding: 28 }}>
          <TimelineChart dataset={dataset} virtualOffset={virtualOffset} accent={accent} />
        </GlassPanel>
      </section>

      {/* Sunrise / sunset and daylight */}
      <section className="page-section">
        <div className="section-head">
          <div>
            <div className="section-num">Section 05 · Daylight</div>
            <div className="section-title">Sunrise · noon · sunset.</div>
          </div>
        </div>
        <GlassPanel style={{ padding: 28 }}>
          <DaylightStrip hour={hour} accent={accent} />
        </GlassPanel>
      </section>
    </>
  );
}

function StatCard({ label, value, unit, sub, accent }) {
  return (
    <GlassPanel style={{ padding: 20, minHeight: 140, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderColor: accent ? 'rgba(194,65,12,0.4)' : undefined, background: accent ? 'rgba(194,65,12,0.08)' : undefined }}>
      <MonoLabel accent={accent}>{label}</MonoLabel>
      <div className="display num" style={{ fontSize: 44, color: accent ? 'var(--atm-accent)' : '#fff', marginTop: 6 }}>{value}<span style={{ fontSize: 14, color: 'var(--atm-text-faint)', marginLeft: 6 }}>{unit}</span></div>
      {sub && <div className="mono" style={{ fontSize: 10, color: accent ? 'var(--atm-accent)' : 'var(--atm-text-faint)', letterSpacing: 1.2 }}>{sub}</div>}
    </GlassPanel>
  );
}

function WindCompass({ speed, dir, gust, accent }) {
  const r = 78;
  const dirRad = (dir * Math.PI) / 180;
  const arrowX = r * Math.sin(dirRad);
  const arrowY = -r * Math.cos(dirRad);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 4 }}>
      <svg viewBox="-110 -110 220 220" width="180" height="180">
        <circle r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
        <circle r={r * 0.7} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" strokeDasharray="2 3" />
        {['N', 'E', 'S', 'W'].map((d, i) => {
          const a = (i * 90 * Math.PI) / 180;
          const x = (r + 14) * Math.sin(a);
          const y = -(r + 14) * Math.cos(a);
          return <text key={d} x={x} y={y + 4} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="rgba(255,255,255,0.5)" letterSpacing="2">{d}</text>;
        })}
        {/* Ticks */}
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i / 24) * Math.PI * 2;
          const x1 = r * Math.sin(a), y1 = -r * Math.cos(a);
          const x2 = (r + (i % 6 === 0 ? 6 : 3)) * Math.sin(a), y2 = -(r + (i % 6 === 0 ? 6 : 3)) * Math.cos(a);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.4)" strokeWidth="0.7" />;
        })}
        {/* Arrow showing wind FROM direction (rotates with dir) */}
        <line x1={0} y1={0} x2={arrowX} y2={arrowY} stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
        <polygon points={`${arrowX},${arrowY} ${arrowX - 6 * Math.sin(dirRad - Math.PI / 6)},${arrowY + 6 * Math.cos(dirRad - Math.PI / 6)} ${arrowX - 6 * Math.sin(dirRad + Math.PI / 6)},${arrowY + 6 * Math.cos(dirRad + Math.PI / 6)}`} fill={accent} />
        <circle r="3" fill={accent} />
      </svg>
      <div style={{ display: 'flex', gap: 14, marginTop: 12 }}>
        <div style={{ textAlign: 'center' }}>
          <div className="display num" style={{ fontSize: 32, color: '#fff' }}>{speed.toFixed(1)}</div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--atm-text-faint)', letterSpacing: 1.4 }}>MPH</div>
        </div>
        <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)' }} />
        <div style={{ textAlign: 'center' }}>
          <div className="display num" style={{ fontSize: 32, color: accent }}>{AtmWeather.bearingLabel(dir)}</div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--atm-text-faint)', letterSpacing: 1.4 }}>FROM</div>
        </div>
        <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)' }} />
        <div style={{ textAlign: 'center' }}>
          <div className="display num" style={{ fontSize: 32, color: '#fff' }}>{gust.toFixed(0)}</div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--atm-text-faint)', letterSpacing: 1.4 }}>GUST</div>
        </div>
      </div>
    </div>
  );
}

function TimelineChart({ dataset, virtualOffset, accent }) {
  // 48h chart: x = offset (-24..+24), draw temp, rain bars, cloudiness band.
  const W = 1280, H = 240;
  const pad = 36;
  const xFor = (off) => pad + ((off + 24) / 48) * (W - pad * 2);
  const temps = dataset.map(d => d.airTemp);
  const tMin = Math.floor(Math.min(...temps) - 2);
  const tMax = Math.ceil(Math.max(...temps) + 2);
  const yForT = (t) => H - 60 - ((t - tMin) / (tMax - tMin)) * (H - 100);
  const cursorX = xFor(virtualOffset);
  // Build temp line
  const linePts = dataset.map(d => `${xFor(d.offset).toFixed(1)},${yForT(d.airTemp).toFixed(1)}`).join(' ');
  // Cloudiness band as filled area
  const cloudFill = dataset.map(d => `${xFor(d.offset).toFixed(1)},${(H - 60 - d.cloudiness * 30).toFixed(1)}`).join(' ');

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        {/* History/forecast split */}
        <rect x={pad} y={20} width={xFor(0) - pad} height={H - 80} fill="rgba(255,255,255,0.03)" />
        <text x={pad + (xFor(0) - pad) / 2} y={36} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="10" letterSpacing="2" fill="rgba(255,255,255,0.45)">HISTORY · STATION FEED</text>
        <text x={xFor(0) + (W - pad - xFor(0)) / 2} y={36} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="10" letterSpacing="2" fill="rgba(255,255,255,0.45)">FORECAST · ECMWF</text>

        {/* Cloudiness band */}
        <polyline points={`${pad},${H - 60} ${cloudFill} ${W - pad},${H - 60}`} fill="rgba(255,255,255,0.07)" />

        {/* Rain bars */}
        {dataset.map((d, i) => {
          const x = xFor(d.offset);
          const w = (W - pad * 2) / 48 - 2;
          const h = Math.min(80, d.rain * 40);
          if (h < 1) return null;
          return <rect key={i} x={x - w / 2} y={H - 60 - h} width={w} height={h} fill="rgba(120, 170, 220, 0.35)" />;
        })}

        {/* Temp line */}
        <polyline points={linePts} fill="none" stroke={accent} strokeWidth="2" />
        {/* Temp dots at notable points */}
        {dataset.filter((_, i) => i % 3 === 0).map((d, i) => (
          <g key={i}>
            <circle cx={xFor(d.offset)} cy={yForT(d.airTemp)} r="3" fill={accent} />
            <text x={xFor(d.offset)} y={yForT(d.airTemp) - 8} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="9" fill="#fff" opacity="0.7">{d.airTemp.toFixed(0)}°</text>
          </g>
        ))}

        {/* X-axis labels (hours from now) */}
        {[-24, -12, 0, 12, 24].map(off => (
          <g key={off}>
            <line x1={xFor(off)} y1={H - 60} x2={xFor(off)} y2={H - 30} stroke="rgba(255,255,255,0.2)" strokeWidth="0.6" />
            <text x={xFor(off)} y={H - 12} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="rgba(255,255,255,0.5)" letterSpacing="1.4">
              {off === 0 ? 'NOW' : (off > 0 ? `+${off}H` : `${off}H`)}
            </text>
          </g>
        ))}

        {/* Now line */}
        <line x1={xFor(0)} y1={20} x2={xFor(0)} y2={H - 30} stroke="rgba(255,255,255,0.5)" strokeWidth="1" strokeDasharray="3 3" />

        {/* Cursor */}
        <line x1={cursorX} y1={20} x2={cursorX} y2={H - 30} stroke={accent} strokeWidth="1.5" />
        <circle cx={cursorX} cy={20} r="5" fill={accent} />
      </svg>
    </div>
  );
}

function DaylightStrip({ hour, accent }) {
  const W = 1280, H = 100;
  const xFor = (h) => (h / 24) * W;
  // Day arc
  const noon = 13;
  const sunrise = 6.2;
  const sunset = 19.8;
  const cursorX = xFor(hour);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="dayBand" x1="0" x2="1">
          <stop offset="0%" stopColor="#1a2548" />
          <stop offset={`${(sunrise / 24) * 100}%`} stopColor="#e0a87a" />
          <stop offset={`${(noon / 24) * 100}%`} stopColor="#83b6e8" />
          <stop offset={`${(sunset / 24) * 100}%`} stopColor="#c2410c" />
          <stop offset="100%" stopColor="#1a2548" />
        </linearGradient>
      </defs>
      <rect x={0} y={H / 2 - 6} width={W} height="12" fill="url(#dayBand)" rx="6" opacity="0.85" />
      {/* Markers */}
      {[
        { h: sunrise, l: 'SUNRISE', t: '06:14' },
        { h: noon, l: 'SOLAR NOON', t: '13:01' },
        { h: sunset, l: 'SUNSET', t: '19:48' },
      ].map((m, i) => (
        <g key={i}>
          <line x1={xFor(m.h)} y1={H / 2 - 16} x2={xFor(m.h)} y2={H / 2 + 16} stroke="rgba(255,255,255,0.45)" strokeWidth="1" />
          <text x={xFor(m.h)} y={H / 2 - 22} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="10" fill="rgba(255,255,255,0.7)" letterSpacing="1.5">{m.l}</text>
          <text x={xFor(m.h)} y={H / 2 + 32} textAnchor="middle" fontFamily="'JetBrains Mono', monospace" fontSize="11" fill="#fff">{m.t}</text>
        </g>
      ))}
      {/* Hour ticks */}
      {Array.from({ length: 24 }).map((_, i) => (
        <line key={i} x1={xFor(i)} y1={H / 2 + 7} x2={xFor(i)} y2={H / 2 + 10} stroke="rgba(255,255,255,0.25)" strokeWidth="0.5" />
      ))}
      {/* Cursor */}
      <circle cx={cursorX} cy={H / 2} r="9" fill={accent} stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

// ============ SETUP VIEW ============

function SetupView({ location, setLocation, station, setStation, accent }) {
  const [postcode, setPostcode] = React.useState(location.postcode || '');
  const [stationId, setStationId] = React.useState(station.id || 'IEDENB52');
  const [wuKey, setWuKey] = React.useState(station.apiKey || '');
  const [mapsKey, setMapsKey] = React.useState(localStorage.getItem('atm.maps_api_key') || '');
  const [units, setUnits] = React.useState(localStorage.getItem('atm.units') || 'metric');

  const save = () => {
    setLocation({ ...location, postcode, label: postcode || location.label });
    setStation({ id: stationId, apiKey: wuKey });
    localStorage.setItem('atm.maps_api_key', mapsKey);
    localStorage.setItem('atm.units', units);
  };

  return (
    <section className="page-section">
      <div className="section-head">
        <div>
          <div className="section-num">Section 02 · Setup</div>
          <div className="section-title">Point Atmosphere at your sky.</div>
        </div>
        <div className="section-meta">SAVED LOCALLY · NEVER LEAVES YOUR BROWSER</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <GlassPanel style={{ padding: 32 }}>
          <MonoLabel>Your location</MonoLabel>
          <div className="display" style={{ fontSize: 24, color: '#fff', marginTop: 6 }}>Postcode or place</div>
          <SetupInput value={postcode} onChange={setPostcode} placeholder="SW1A 1AA" big />
          <div className="mono" style={{ fontSize: 11, color: 'var(--atm-text-faint)', marginTop: 10, letterSpacing: 1.2, lineHeight: 1.5 }}>
            USED FOR LATITUDE/LONGITUDE LOOKUP · SUN POSITION CALCULATION · GOOGLE MAPS CENTRING
          </div>

          <div style={{ marginTop: 24 }}>
            <MonoLabel>Google Maps API key</MonoLabel>
            <SetupInput value={mapsKey} onChange={setMapsKey} placeholder="—" type="password" mono />
            <div className="mono" style={{ fontSize: 10, color: 'var(--atm-text-faint)', marginTop: 8, letterSpacing: 1.2, lineHeight: 1.5 }}>
              ⓘ PLACEHOLDER · CODE HANDOFF · agents wire this into the embed URL.
              <br />Until then, the Map page renders a beautiful mockup.
            </div>
          </div>
        </GlassPanel>

        <GlassPanel style={{ padding: 32 }}>
          <MonoLabel accent>Weather Underground</MonoLabel>
          <div className="display" style={{ fontSize: 24, color: '#fff', marginTop: 6 }}>Your weather station</div>

          <div style={{ marginTop: 18 }}>
            <MonoLabel>Station ID</MonoLabel>
            <SetupInput value={stationId} onChange={setStationId} placeholder="IEDENB52" mono big />
            <div className="mono" style={{ fontSize: 10, color: 'var(--atm-text-faint)', marginTop: 6, letterSpacing: 1.2 }}>
              DEFAULT · IEDENB52 · Replace with your PWS ID
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <MonoLabel>WU API key</MonoLabel>
            <SetupInput value={wuKey} onChange={setWuKey} placeholder="—" type="password" mono />
            <div className="mono" style={{ fontSize: 10, color: 'var(--atm-text-faint)', marginTop: 8, letterSpacing: 1.2, lineHeight: 1.5 }}>
              ⓘ PLACEHOLDER · CODE HANDOFF · agents wire this into
              <br /><code style={{ color: 'var(--atm-text-soft)' }}>api.weather.com/v2/pws/observations/current</code>
              <br />Until then, dummy hourly data drives the UI so the design is testable.
            </div>
          </div>
        </GlassPanel>
      </div>

      <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <GlassPanel style={{ padding: 24 }}>
          <MonoLabel>Units</MonoLabel>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {[['metric', 'Metric'], ['imperial', 'Imperial']].map(([k, l]) => (
              <button key={k} onClick={() => setUnits(k)} style={{
                flex: 1, padding: '14px 16px',
                background: units === k ? 'rgba(194,65,12,0.18)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${units === k ? accent : 'rgba(255,255,255,0.14)'}`,
                color: units === k ? accent : 'var(--atm-text)',
                fontFamily: 'Geist, system-ui, sans-serif', fontSize: 15, fontWeight: 500,
                borderRadius: 10, cursor: 'pointer', textAlign: 'left',
              }}>
                <div>{l}</div>
                <div className="mono" style={{ fontSize: 9, opacity: 0.7, letterSpacing: 1.2, marginTop: 4 }}>
                  {k === 'metric' ? '°C · MM · KM/H · HPA' : '°F · IN · MPH · INHG'}
                </div>
              </button>
            ))}
          </div>
        </GlassPanel>
        <GlassPanel style={{ padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <MonoLabel>Save settings</MonoLabel>
          <button onClick={save} style={{
            marginTop: 12, padding: '18px 24px',
            background: accent, color: '#fff',
            border: 'none', borderRadius: 10,
            fontFamily: 'Geist, system-ui, sans-serif', fontSize: 17, fontWeight: 500,
            cursor: 'pointer', letterSpacing: '-0.01em',
            boxShadow: '0 12px 32px -16px rgba(194,65,12,0.6)',
          }}>Save and apply →</button>
          <div className="mono" style={{ fontSize: 10, color: 'var(--atm-text-faint)', letterSpacing: 1.2, marginTop: 10 }}>
            ALL VALUES STORED IN LOCALSTORAGE
          </div>
        </GlassPanel>
      </div>
    </section>
  );
}

function SetupInput({ value, onChange, placeholder, type = 'text', big, mono }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%',
        marginTop: 10,
        padding: big ? '18px 18px' : '14px 16px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: 10,
        color: '#fff',
        fontFamily: mono ? "'JetBrains Mono', monospace" : 'Geist, system-ui, sans-serif',
        fontSize: big ? 22 : 16,
        letterSpacing: mono ? 1 : 0,
        outline: 'none',
      }}
    />
  );
}

window.MapView = MapView;
window.WeatherView = WeatherView;
window.SetupView = SetupView;
