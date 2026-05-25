/* Solar System Field Lab — Hi-Fi page sections (dark-first) */
/* eslint-disable */

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ---------- helpers ----------
const yearLabel = (days) => {
  if (days < 365) return `${days.toFixed(0)} d`;
  return `${(days/365).toFixed(days < 3650 ? 1 : 0)} yr`;
};

// CSS planet ball
const PlanetBall = ({ planet, size = 80, glow = true }) => {
  const cssVars = { '--g': planet.glow || 'rgba(255,255,255,0.15)' };
  return (
    <div className="planet-ball" style={{ width: size, height: size, ...cssVars }}>
      <div className="surface" style={ballGradient(planet.cssColor, planet.palette)} />
      {glow && <div className="glow" />}
      {planet.rings && <div className="rings" style={{ '--ring': '#e2c98a' }} />}
      {planet.key === 'uranus' && <div className="rings" style={{ '--ring': '#8ec6cf', opacity: 0.4 }} />}
    </div>
  );
};

// extra: build a richer gradient using planet palette
const ballGradient = (color, palette) => {
  if (!palette || palette.length < 3) {
    return {
      background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.6), transparent 38%),
                   radial-gradient(circle at 70% 75%, rgba(0,0,0,0.5), transparent 60%),
                   ${color}`,
    };
  }
  return {
    background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.55), transparent 36%),
                 radial-gradient(circle at 75% 80%, rgba(0,0,0,0.55), transparent 60%),
                 radial-gradient(ellipse at 50% 40%, ${palette[2]}, transparent 60%),
                 radial-gradient(ellipse at 30% 70%, ${palette[0]}, transparent 60%),
                 ${palette[1]}`,
  };
};

// ---------- header ----------
const SECTIONS = [
  { id:'orbit',   label:'Orbit Lab' },
  { id:'explore', label:'Planets'   },
  { id:'scale',   label:'Scale'     },
  { id:'quiz',    label:'Quiz'      },
];
const Header = ({ theme, onToggleTheme }) => {
  const [active, setActive] = useState('');
  useEffect(() => {
    const els = SECTIONS.map(s => document.getElementById(s.id)).filter(Boolean);
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: '-30% 0px -55% 0px' });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <header className="page-header">
      <div className="container row">
        <a className="mark" href="#top">
          <span className="glyph" />
          <span>
            <div className="name">Field Lab</div>
            <div className="org">Elusion Works · demos</div>
          </span>
        </a>
        <nav>
          {SECTIONS.map(s => (
            <a key={s.id} href={`#${s.id}`}
               className={active === s.id ? 'active' : ''}>
              {s.label}
            </a>
          ))}
        </nav>
        <div className="right-tools">
          <button className="theme-toggle" onClick={onToggleTheme} aria-label="Toggle theme" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme === 'dark' ? '☼' : '☾'}
          </button>
        </div>
      </div>
    </header>
  );
};

// ---------- hero ----------
const Hero = ({ onFullscreen, onPlanetClick }) => {
  const [showOrbits, setShowOrbits] = useState(true); // visual chip toggle
  return (
    <section className="hero" id="top">
      <div className="canvas-host">
        <OrbitLab
          mode="compressed"
          speed={1.0}
          paused={false}
          cameraMode="idle"
          onPlanetClick={onPlanetClick}
        />
      </div>
      <div className="hero-grad" />
      <div className="top-bar">
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          <span className="chip"><span className="dot" style={{background:'var(--accent)'}} /> live · 60 fps</span>
          <span className="chip">8 planets &nbsp;·&nbsp; 1 star</span>
        </div>
        <div style={{display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end'}}>
          <button className="chip chip-btn" onClick={onFullscreen}>
            ⤢ fullscreen
          </button>
          <span className="chip">drag · spin · click planets</span>
        </div>
      </div>
      <div className="drag-hint">drag · spin the system</div>
      <div className="copy">
        <h1 className="display">
          Explore the solar<br/>system like a <em>mission<br/>scientist.</em>
        </h1>
        <div className="right">
          <p>A field lab for the sun and its eight neighbours. Real distances, real periods, real awkwardness of scale — laid out so you can grab them, spin them, and shrink them down to a desk.</p>
          <div className="ctas">
            <button className="btn accent" onClick={onFullscreen}>Enter fullscreen <span className="arr">⤢</span></button>
            <a className="btn ghost" href="#explore">Browse planets</a>
          </div>
        </div>
      </div>
      <div className="scroll-cue">
        <span>scroll · begin</span>
        <span className="line" />
      </div>
    </section>
  );
};

// ---------- orbit lab section ----------
const SPEEDS = [
  { v: 0,    lbl: '⏸' },
  { v: 0.25, lbl: '¼' },
  { v: 0.5,  lbl: '½' },
  { v: 1,    lbl: '1' },
  { v: 2,    lbl: '2' },
  { v: 5,    lbl: '5' },
];

const OrbitLabSection = ({ onFullscreen, onPlanetClick }) => {
  const [mode, setMode] = useState('compressed');
  const [speed, setSpeed] = useState(1);
  const paused = speed === 0;
  const modeNote = MODES[mode].note;

  const ruler = useMemo(() => {
    if (mode === 'honest') return [0, 1, 5, 10, 20, 30];
    if (mode === 'log')    return [0.4, 1, 5, 30];
    return null;
  }, [mode]);

  return (
    <section className="sec orbit-section" id="orbit">
      <div className="container">
        <div className="sec-head">
          <div className="num">§ 02</div>
          <div>
            <div className="kicker">Interactive · The orbit lab</div>
            <h2 className="title">The lanes <em>aren't</em> what they look like.</h2>
            <p className="blurb">Drag to spin. Click a planet to open its page. Pick a view to see the same eight worlds three different ways — and watch the lie of equal spacing dissolve when you switch to <em>Honest AU</em>.</p>
          </div>
        </div>
        <div className="orbit-stage">
          {/* control rail */}
          <aside className="control-rail">
            <div>
              <h4>Distance view</h4>
              <div className="seg">
                {Object.entries(MODES).map(([k, m]) => (
                  <button key={k} className={mode === k ? 'active' : ''}
                          onClick={() => setMode(k)}>
                    <span>{m.label}</span>
                    <span className="au">{k === 'compressed' ? 'equal' : k === 'log' ? 'log₁₀' : 'real'}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h4>Orbital speed</h4>
              <div className="slider-wrap">
                <div className="slider-row">
                  <input
                    type="range"
                    min="0" max="5" step="0.05"
                    value={speed}
                    onChange={e => setSpeed(parseFloat(e.target.value))}
                    style={{'--p': `${(speed/5)*100}%`}}
                  />
                  <span className="val">×{speed.toFixed(2)}</span>
                </div>
                <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
                  {SPEEDS.map(p => (
                    <button key={p.v}
                            className={`pill-btn ${Math.abs(speed - p.v) < 0.001 ? 'accent' : ''}`}
                            onClick={() => setSpeed(p.v)}
                            style={{padding:'6px 10px', fontSize:10}}>
                      {p.lbl}
                    </button>
                  ))}
                </div>
                <div className="tele sm">{paused ? 'paused' : 'earth · ~12 s per orbit at ×1'}</div>
              </div>
            </div>
            <div style={{borderTop: '1px dashed var(--line)', paddingTop:18}}>
              <h4>How to drive it</h4>
              <ul className="tele" style={{margin:0, paddingLeft:14, lineHeight:1.8, listStyle:'square'}}>
                <li>drag · rotate</li>
                <li>scroll · zoom</li>
                <li>click planet · open page</li>
                <li>⤢ button · fullscreen flyby</li>
              </ul>
            </div>
            <button className="btn accent" onClick={onFullscreen} style={{justifyContent:'center'}}>
              Enter fullscreen <span className="arr">⤢</span>
            </button>
          </aside>

          {/* canvas */}
          <div className="canvas-wrap">
            <OrbitLab
              mode={mode}
              speed={speed}
              paused={paused}
              cameraMode="idle"
              onPlanetClick={onPlanetClick}
            />
            <div className="grad" />
            <button className="fullscreen-btn" onClick={onFullscreen} aria-label="Fullscreen">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 10V4h6M14 4h6v6M20 14v6h-6M10 20H4v-6"/></svg>
              <span>Fullscreen</span>
            </button>
            <div className="overlay-top">
              <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                <span className="chip"><span className="dot" /> mode · {MODES[mode].label}</span>
              </div>
              <div style={{display:'flex', gap:6, flexWrap:'wrap', marginRight: 120}}>
                {paused
                  ? <span className="chip">⏸ paused</span>
                  : <span className="chip"><span className="dot" style={{background:'var(--accent)'}} /> ▶ ×{speed.toFixed(2)}</span>}
                <span className="chip">8 planets</span>
              </div>
            </div>
            <div className="overlay-bottom">
              <div className="readout-card">
                <div className="label">readout</div>
                <div className="body">{modeNote}</div>
              </div>
              {ruler && (
                <div style={{flexShrink:0, minWidth:220, maxWidth:'40%'}}>
                  <div className="au-ruler" style={{position:'relative'}}>
                    <div className="axis">
                      {ruler.map((au, i) => {
                        const pct = mode === 'honest'
                          ? (au / 30) * 100
                          : mode === 'log'
                            ? (Math.log10(au + 0.4) - Math.log10(0.4))/(Math.log10(30.4) - Math.log10(0.4)) * 100
                            : 0;
                        return (
                          <React.Fragment key={au}>
                            <span className="tick major" style={{left: `${pct}%`}} />
                            <span className="lbl" style={{left: `${pct}%`}}>{au === 0 ? '☉' : `${au} AU`}</span>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

// ---------- fullscreen orbit overlay ----------
const FullscreenOrbit = ({ onClose, onPlanetClick }) => {
  const [mode, setMode] = useState('compressed');
  const [speed, setSpeed] = useState(1);
  const [camMode, setCamMode] = useState('flyby'); // default flyby
  const [flybyTarget, setFlybyTarget] = useState('sun');
  const [elapsed, setElapsed] = useState(0); // seconds

  // tick elapsed
  useEffect(() => {
    let raf, last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setElapsed(e => e + dt * speed * (camMode === 'flyby' ? 1 : 1));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speed, camMode]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') { e.preventDefault(); setSpeed(s => s === 0 ? 1 : 0); }
      if (e.key === 'f') setCamMode(c => c === 'flyby' ? 'free' : 'flyby');
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const paused = speed === 0;
  // describe current view
  const flybyPlanet = useMemo(() => {
    if (camMode !== 'flyby') return null;
    if (flybyTarget === 'sun') return { name:'The Sun', blurb:'The star at the centre. ~109 Earth diameters across; ~330,000× Earth\'s mass.', meta:'☉ star · G-type' };
    const p = PLANETS.find(p => p.key === flybyTarget);
    return p ? { name: p.name, blurb: p.blurb, meta: `${p.realAU} AU · planet ${p.order}/8` } : null;
  }, [camMode, flybyTarget]);

  const fmtElapsed = (s) => {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  return (
    <div className="fs-overlay">
      <div className="fs-stage">
        <OrbitLab
          mode={mode}
          speed={speed}
          paused={paused}
          cameraMode={camMode}
          onFlybyChange={(k) => setFlybyTarget(k)}
          onPlanetClick={onPlanetClick}
          fullscreen
        />

        <div className="fs-top">
          <div className="fs-title">
            <span className="glyph" />
            <div>
              <div className="name">Solar System Field Lab</div>
              <div className="meta">Fullscreen · {camMode === 'flyby' ? 'auto flyby' : camMode === 'free' ? 'free fly' : camMode.startsWith('follow') ? `following ${camMode.split(':')[1]}` : 'idle'}</div>
            </div>
          </div>
          <div className="fs-mode-pills">
            {Object.entries(MODES).map(([k, m]) => (
              <button key={k} className={mode === k ? 'active' : ''} onClick={() => setMode(k)}>
                {m.label}
              </button>
            ))}
          </div>
          <button className="fs-close" onClick={onClose}>✕ exit fullscreen</button>
        </div>

        <div className="fs-dock">
          <div className="left">
            {flybyPlanet && (
              <div className="info-card">
                <div className="label">{flybyPlanet.meta}</div>
                <div className="body" style={{fontSize: 22, marginBottom: 4}}>{flybyPlanet.name}</div>
                <div style={{fontSize: 13, lineHeight: 1.5, color: 'rgba(238,242,251,0.78)'}}>
                  {flybyPlanet.blurb}
                </div>
                {flybyTarget !== 'sun' && (
                  <button className="pill-btn" style={{marginTop: 10, background:'transparent', color:'#eef2fb', borderColor:'rgba(238,242,251,0.3)'}}
                          onClick={() => onPlanetClick(flybyTarget)}>
                    Open {flybyPlanet.name} page →
                  </button>
                )}
              </div>
            )}
            {camMode === 'free' && (
              <div className="info-card">
                <div className="label">Free fly</div>
                <div className="body" style={{fontSize:18}}>You're at the controls.</div>
                <div style={{fontSize:12, color:'rgba(238,242,251,0.7)', marginTop:8, lineHeight: 1.55}}>
                  Drag to rotate · scroll to zoom · click a planet to open its page · 'F' to toggle flyby
                </div>
              </div>
            )}
          </div>

          <div className="center">
            <div className="group">
              <button className={`pill-btn ${camMode === 'flyby' ? 'accent' : ''}`} onClick={() => setCamMode('flyby')}
                      style={{padding:'8px 12px'}}>
                ⌖ Auto flyby
              </button>
              <button className={`pill-btn ${camMode === 'free' ? 'accent' : ''}`} onClick={() => setCamMode('free')}
                      style={{padding:'8px 12px'}}>
                🚀 Free fly
              </button>
            </div>
            <div className="divider" />
            <div className="group">
              <button className="pill-btn" onClick={() => setSpeed(s => s === 0 ? 1 : 0)}
                      style={{padding:'8px 12px'}}>
                {paused ? '▶ play' : '⏸ pause'}
              </button>
            </div>
            <div className="divider" />
            <div className="speed">
              <span>time</span>
              <input type="range" min="0" max="10" step="0.1" value={speed}
                     onChange={e => setSpeed(parseFloat(e.target.value))}
                     style={{'--p': `${(speed/10)*100}%`}} />
              <span style={{color:'#eef2fb', minWidth: 42, textAlign:'right'}}>×{speed.toFixed(1)}</span>
            </div>
            <div className="divider" />
            <div className="fs-clock">
              <span>elapsed</span>
              <span className="v">{fmtElapsed(elapsed)}</span>
            </div>
          </div>

          <div className="right">
            <div className="target-strip">
              <span className="lbl">target</span>
              {['sun', ...PLANETS.map(p => p.key)].map(k => {
                const p = k === 'sun' ? { cssColor:'#fac86a' } : PLANETS.find(pp => pp.key === k);
                return (
                  <button key={k}
                          className={`target-pill ${camMode === 'flyby' && flybyTarget === k ? 'active' : ''}`}
                          onClick={() => {
                            if (k === 'sun') { setCamMode('free'); return; }
                            setCamMode(`follow:${k}`);
                          }}>
                    <span className="pdot" style={{background: p.cssColor}} />
                    {k.charAt(0).toUpperCase() + k.slice(1)}
                  </button>
                );
              })}
            </div>
            <div className="info-card" style={{fontSize: 11, color:'rgba(238,242,251,0.7)'}}>
              <div className="label">controls</div>
              <div style={{lineHeight: 1.6}}>
                drag · rotate · scroll · zoom<br/>
                space · play/pause · F · toggle flyby<br/>
                click planet · open page · esc · exit
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------- planet explorer ----------
const FAMILIES = [
  { id:'all',         label:'All families' },
  { id:'terrestrial', label:'Terrestrial' },
  { id:'gas-giant',   label:'Gas giants'   },
  { id:'ice-giant',   label:'Ice giants'   },
];

const PlanetExplorer = ({ onPlanetClick }) => {
  const [family, setFamily] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('saturn');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PLANETS.filter(p => {
      if (family !== 'all' && p.family !== family) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) ||
             p.family.includes(q) ||
             p.epithet.toLowerCase().includes(q) ||
             p.blurb.toLowerCase().includes(q);
    });
  }, [family, query]);

  const feature = useMemo(() => PLANETS.find(p => p.key === selected) || PLANETS[5], [selected]);
  const others  = filtered.filter(p => p.key !== feature.key);

  return (
    <section className="sec explorer" id="explore">
      <div className="container">
        <div className="sec-head">
          <div className="num">§ 03</div>
          <div>
            <div className="kicker">Reference · Planet explorer</div>
            <h2 className="title">Eight neighbours, <em>one cabinet drawer.</em></h2>
            <p className="blurb">Click any card to open the full planet page — close-up 3D model, stats, story, and moons. Pin a featured planet, browse the rest.</p>
          </div>
        </div>
        <div className="filter-row">
          <div className="search">
            <span className="tele">🔍</span>
            <input
              type="text"
              placeholder="search 'rings', 'retrograde', 'ice', 'storm'…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button className="pill-btn" style={{padding:'4px 8px'}} onClick={()=>setQuery('')}>clear</button>
            )}
          </div>
          <div className="filter-chips">
            {FAMILIES.map(f => (
              <span key={f.id}
                    className={`chip chip-btn ${family === f.id ? 'active' : ''}`}
                    onClick={() => setFamily(f.id)}>
                {f.label}
              </span>
            ))}
          </div>
        </div>

        <div className="bento">
          <FeatureCard planet={feature} onOpen={() => onPlanetClick(feature.key)} onPin={k => setSelected(k)} />
          {others.map(p => (
            <PlanetCard key={p.key} planet={p}
                        onOpen={() => onPlanetClick(p.key)}
                        onPin={() => setSelected(p.key)} />
          ))}
          {filtered.length === 0 && (
            <div className="card" style={{gridColumn:'span 3', textAlign:'center', padding:48}}>
              <div className="tele">no matches</div>
              <div className="serif" style={{fontSize:28, marginTop:8, color:'var(--ink)'}}>Empty universe.</div>
              <button className="pill-btn" onClick={()=>{setQuery(''); setFamily('all');}} style={{marginTop:16}}>reset filters</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

const FeatureCard = ({ planet, onOpen, onPin }) => {
  const p = planet;
  return (
    <article className="card feature hov" onClick={onOpen} data-screen-label={`Featured · ${p.name}`}>
      <div className="card-art" style={{ minHeight: 260, padding: 30 }}>
        <PlanetBall planet={p} size={210} />
      </div>
      <div className="card-body" style={{padding:'26px 28px 28px'}}>
        <div className="tele accent">featured · {p.family.replace('-', ' ')}</div>
        <h3 className="name" style={{marginTop:6}}>{p.name}</h3>
        <p style={{maxWidth:'42ch', color:'var(--ink-2)', fontSize:15, lineHeight:1.55, marginTop:6, marginBottom: 4}}>
          {p.blurb}
        </p>
        <div className="stats" style={{marginTop:12}}>
          <div className="stat"><span className="k">Distance</span><span className="v">{p.realAU} <em>AU</em></span></div>
          <div className="stat"><span className="k">Diameter</span><span className="v">{p.diamKm.toLocaleString()} <em>km</em></span></div>
          <div className="stat"><span className="k">Year</span><span className="v">{yearLabel(p.periodDays)}</span></div>
          <div className="stat"><span className="k">Moons</span><span className="v">{p.moonCount}</span></div>
        </div>
        <div style={{marginTop: 16, display:'flex', gap: 8}}>
          <span className="chip accent" style={{cursor:'pointer'}}>Open page →</span>
        </div>
      </div>
    </article>
  );
};

const PlanetCard = ({ planet, onOpen, onPin }) => {
  const p = planet;
  return (
    <article className="card hov" onClick={onOpen} data-screen-label={`Card · ${p.name}`}>
      <span className="chip family-tag">{p.family.split('-')[0]}</span>
      <div className="card-art" style={{ minHeight: 130 }}>
        <PlanetBall planet={p} size={90} />
      </div>
      <div className="card-body">
        <div className="meta">{p.realAU} AU · 0{p.order}</div>
        <h3 className="name" style={{marginTop:2}}>{p.name}</h3>
        <div className="stats" style={{marginTop:8}}>
          <div className="stat"><span className="k">Ø</span><span className="v">{(p.diamKm/1000).toFixed(0)}k km</span></div>
          <div className="stat"><span className="k">Year</span><span className="v">{yearLabel(p.periodDays)}</span></div>
          <div className="stat"><span className="k">Moons</span><span className="v">{p.moonCount}</span></div>
        </div>
      </div>
      <div className="card-arrow">→</div>
    </article>
  );
};

// ---------- scale calculator ----------
const REAL_EARTH_DIAM_KM = 12742;
const REAL_SUN_DIAM_KM   = 1392700;
const REAL_AU_KM         = 149597871;

const ScaleCalc = ({ onPlanetClick }) => {
  const [earthCm, setEarthCm] = useState(2.0);
  const factor = (earthCm / 100) / (REAL_EARTH_DIAM_KM * 1000);

  const sunM = (REAL_SUN_DIAM_KM * 1000) * factor;
  const walkM = REAL_AU_KM * 1000 * factor;
  const neptuneKm = (REAL_AU_KM * 30.05 * 1000) * factor / 1000;

  const fmtMetres = m => {
    if (m < 1) return `${(m*100).toFixed(1)} cm`;
    if (m < 1000) return `${m.toFixed(m < 10 ? 2 : 0)} m`;
    return `${(m/1000).toFixed(2)} km`;
  };

  const pct = ((earthCm - 0.5) / (20 - 0.5)) * 100;

  return (
    <section className="sec scale-section" id="scale">
      <div className="container">
        <div className="sec-head">
          <div className="num">§ 04</div>
          <div>
            <div className="kicker">Calculator · Scale shock</div>
            <h2 className="title">Shrink Earth. <em>Watch the system stretch.</em></h2>
            <p className="blurb">Pick a marble for Earth — the rest of the system follows to scale, ruthlessly. Most classroom solar systems aren't to scale. This one is.</p>
          </div>
        </div>

        <div className="scale-card">
          <div className="scale-input">
            <div className="label">Model earth diameter</div>
            <div className="value">{earthCm.toFixed(1)}<span className="unit"> cm</span></div>
            <div className="sub">about {earthCm < 1 ? 'a pea' : earthCm < 2 ? 'a marble' : earthCm < 5 ? 'a ping-pong ball' : earthCm < 10 ? 'a tennis ball' : 'a small cantaloupe'}</div>
          </div>
          <div className="scale-slider">
            <input
              type="range"
              min="0.5" max="20" step="0.1"
              value={earthCm}
              onChange={e => setEarthCm(parseFloat(e.target.value))}
              style={{'--p': `${pct}%`}}
            />
            <div className="axis-labels">
              <span>0.5 cm</span>
              <span>5 cm</span>
              <span>10 cm</span>
              <span>20 cm</span>
            </div>
          </div>
          <div className="scale-stats">
            <div className="stat">
              <div className="k">Scaled sun · diameter</div>
              <div className="v accent">{fmtMetres(sunM)}</div>
              <div className="sub">a <em>{sunM < 5 ? 'beach ball' : sunM < 50 ? 'small car' : 'house'}</em>, basically</div>
            </div>
            <div className="stat">
              <div className="k">Walk to the sun (1 AU)</div>
              <div className="v">{fmtMetres(walkM)}</div>
              <div className="sub">{walkM < 100 ? 'across the room' : walkM < 1000 ? `≈ ${Math.round(walkM/100)} swimming pools` : `${(walkM/1000).toFixed(1)} km — pack a lunch`}</div>
            </div>
            <div className="stat">
              <div className="k">Out to Neptune</div>
              <div className="v">{neptuneKm < 1 ? `${Math.round(neptuneKm*1000)} m` : `${neptuneKm.toFixed(neptuneKm < 10 ? 2 : 1)} km`}</div>
              <div className="sub">{neptuneKm < 1 ? 'down the road' : neptuneKm < 10 ? 'cross-town errand' : 'leave the city'}</div>
            </div>
          </div>

          <div className="scale-table">
            <div className="head">
              <span>Planet</span>
              <span>Model Ø</span>
              <span>Model · from sun</span>
              <span>Real distance</span>
            </div>
            {PLANETS.map(p => {
              const modelD_m   = (p.diamKm * 1000) * factor;
              const modelDist_m = (p.realAU * REAL_AU_KM * 1000) * factor;
              return (
                <div key={p.key} className="row" onClick={() => onPlanetClick(p.key)}
                     title={`Open ${p.name} page`}>
                  <span className="pname">
                    <span className="dot" style={ballGradient(p.cssColor, p.palette)} />
                    {p.name}
                  </span>
                  <span className="num">{fmtMetres(modelD_m)}</span>
                  <span className="num">{fmtMetres(modelDist_m)}</span>
                  <span className="dist">{p.realAU} AU</span>
                </div>
              );
            })}
          </div>
          <div style={{textAlign:'center', marginTop:18, fontSize:12, color:'var(--ink-3)', fontFamily:'JetBrains Mono, monospace', letterSpacing:'0.16em', textTransform:'uppercase'}}>
            click any row · open planet page
          </div>
        </div>
      </div>
    </section>
  );
};

// ---------- quiz ----------
const QUESTIONS = [
  {
    q: 'Which planet rotates backwards relative to its orbit?',
    options: ['Mars', 'Venus', 'Uranus', 'Saturn'],
    answer: 1,
    feedback: <span><strong>Venus.</strong> A day on Venus is longer than its year, and its rotation runs the wrong way. Probably the legacy of an ancient collision.</span>,
  },
  {
    q: "What lies in the gap between Mars and Jupiter?",
    options: ['Empty space', 'A thin nebula', 'The asteroid belt', 'A dwarf planet'],
    answer: 2,
    feedback: <span>The <strong>asteroid belt</strong> — millions of rocky leftovers, never quite assembled into a planet thanks to Jupiter's gravity.</span>,
  },
  {
    q: 'Roughly how long does sunlight take to reach Neptune?',
    options: ['8 minutes', '40 minutes', '~4 hours', '2 days'],
    answer: 2,
    feedback: <span><strong>About 4 hours.</strong> Light is fast — distance is bigger. Sunlight needs 8 minutes for Earth, ~4 hours for Neptune at 30 AU.</span>,
  },
];

const QuizSection = () => {
  const [answers, setAnswers] = useState([null, null, null]);
  const submitted = answers.every(a => a !== null);
  const score = answers.reduce((acc, a, i) => acc + (a === QUESTIONS[i].answer ? 1 : 0), 0);
  const choose = (qi, oi) => {
    if (answers[qi] !== null) return;
    setAnswers(prev => prev.map((v,i) => i === qi ? oi : v));
  };
  const reset = () => setAnswers([null, null, null]);

  return (
    <section className="sec quiz-section" id="quiz">
      <div className="container">
        <div className="sec-head">
          <div className="num">§ 05</div>
          <div>
            <div className="kicker">Classroom mission · Quiz</div>
            <h2 className="title">Three questions. <em>Earn your mission patch.</em></h2>
            <p className="blurb">Designed for a 10-minute classroom slot. Pick an answer, lock it in, learn why. No timer, no shame.</p>
          </div>
        </div>
        <div className="quiz-grid">
          {QUESTIONS.map((Q, qi) => {
            const a = answers[qi];
            const ans = a !== null;
            return (
              <article key={qi} className="quiz-card" data-screen-label={`Q${qi+1}`}>
                <div className="q-num">Question · 0{qi+1} / 03</div>
                <h3 className="q-title">{Q.q}</h3>
                <div className="options">
                  {Q.options.map((o, oi) => {
                    let cls = 'opt';
                    if (ans) {
                      if (oi === Q.answer) cls += ' correct';
                      else if (oi === a)   cls += ' wrong';
                    } else if (oi === a) cls += ' selected';
                    return (
                      <button key={oi} className={cls} onClick={() => choose(qi, oi)}>
                        <span className="letter">{String.fromCharCode(65 + oi)}</span>
                        <span>{o}</span>
                      </button>
                    );
                  })}
                </div>
                {ans && <div className="feedback">{Q.feedback}</div>}
              </article>
            );
          })}
        </div>
        {submitted && (
          <div className="quiz-summary">
            <div className="score">
              <div>
                <div className="label">Score</div>
                <div className="val"><em>{score}</em> / {QUESTIONS.length}</div>
              </div>
              <div className="tele">
                {score === 3 ? 'mission scientist · gold patch' :
                 score === 2 ? 'cadet · keep pushing' :
                 score === 1 ? 'curious mortal' : 'try the orbit lab first'}
              </div>
            </div>
            <button className="btn accent" onClick={reset}>Retake quiz <span className="arr">↻</span></button>
          </div>
        )}
      </div>
    </section>
  );
};

// ---------- footer ----------
const Foot = () => (
  <footer className="page-foot">
    <div className="container">
      <div className="row">
        <div>
          <div className="mark">Solar System Field Lab</div>
          <div className="tele sm" style={{marginTop:6}}>Rendered live with maths, not magic.</div>
        </div>
        <div className="links">
          <a href="#orbit">orbit lab</a>
          <a href="#explore">planets</a>
          <a href="#scale">scale</a>
          <a href="#quiz">quiz</a>
          <a href="../">all demos</a>
          <a href="../../">Elusion Works</a>
          <a href="https://koltregaskes.com/">Kol's Korner</a>
          <a href="https://theairesourcehub.com/">AI Resource Hub</a>
          <a href="https://axylusion.com/">Axy Lusion</a>
          <a href="https://ghostinthemodels.com/">Ghost in the Models</a>
          <a href="https://koltregaskesphotography.com/">KT Photography</a>
        </div>
      </div>
      <div className="row" style={{marginTop:24, alignItems:'center'}}>
        <div className="tele sm">© Elusion Works / Kol Tregaskes · v0.2 · dark-mode</div>
        <div className="tele sm">data · NASA fact sheets · simplified Kepler · 2026</div>
      </div>
    </div>
  </footer>
);

// ---------- tweaks ----------
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accent": "#f3a14a"
}/*EDITMODE-END*/;

const ACCENT_PALETTES = {
  '#f3a14a': { a:'#f3a14a', a2:'#d97a3e', soft:'rgba(243,161,74,0.16)' },
  '#5e9bff': { a:'#5e9bff', a2:'#3a6db8', soft:'rgba(94,155,255,0.16)' },
  '#3fb48c': { a:'#3fb48c', a2:'#266049', soft:'rgba(63,180,140,0.16)' },
  '#ff7a59': { a:'#ff7a59', a2:'#c44a2b', soft:'rgba(255,122,89,0.16)' },
};

// ---------- routing (very small) ----------
const parseRoute = () => {
  const h = window.location.hash || '';
  // patterns: #/planet/saturn, #/orbit, #orbit (anchor)
  const m = h.match(/^#\/planet\/(\w+)/);
  if (m) return { kind: 'planet', key: m[1] };
  if (h === '#/orbit') return { kind: 'fullscreen' };
  return { kind: 'home' };
};

const App = () => {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = useState(parseRoute());

  // route + back button
  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // theme handling — apply to body
  useEffect(() => {
    document.body.setAttribute('data-theme', t.theme);
  }, [t.theme]);

  // accent
  useEffect(() => {
    const p = ACCENT_PALETTES[t.accent] || ACCENT_PALETTES['#f3a14a'];
    document.documentElement.style.setProperty('--accent', p.a);
    document.documentElement.style.setProperty('--accent-2', p.a2);
    document.documentElement.style.setProperty('--accent-soft', p.soft);
  }, [t.accent]);

  const openPlanet = useCallback((key) => {
    window.location.hash = `#/planet/${key}`;
  }, []);
  const closePlanet = useCallback(() => {
    history.replaceState(null, '', window.location.pathname);
    setRoute({ kind: 'home' });
  }, []);
  const openFullscreen = useCallback(() => {
    window.location.hash = '#/orbit';
  }, []);
  const closeFullscreen = useCallback(() => {
    history.replaceState(null, '', window.location.pathname);
    setRoute({ kind: 'home' });
  }, []);

  const toggleTheme = useCallback(() => {
    setTweak('theme', t.theme === 'dark' ? 'light' : 'dark');
  }, [t.theme, setTweak]);

  return (
    <>
      <Header theme={t.theme} onToggleTheme={toggleTheme} />
      <Hero onFullscreen={openFullscreen} onPlanetClick={openPlanet} />
      <OrbitLabSection onFullscreen={openFullscreen} onPlanetClick={openPlanet} />
      <PlanetExplorer onPlanetClick={openPlanet} />
      <ScaleCalc onPlanetClick={openPlanet} />
      <QuizSection />
      <Foot />

      {route.kind === 'planet' && (
        <PlanetPage planetKey={route.key} onClose={closePlanet} onNavigate={openPlanet} />
      )}
      {route.kind === 'fullscreen' && (
        <FullscreenOrbit onClose={closeFullscreen} onPlanetClick={openPlanet} />
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Theme">
          <TweakRadio
            value={t.theme}
            onChange={v => setTweak('theme', v)}
            options={[
              {value:'dark', label:'Dark'},
              {value:'light', label:'Light'},
            ]}
          />
        </TweakSection>
        <TweakSection label="Accent">
          <TweakColor
            label="Accent"
            value={t.accent}
            onChange={v => setTweak('accent', v)}
            options={['#f3a14a', '#5e9bff', '#3fb48c', '#ff7a59']}
          />
        </TweakSection>
        <TweakSection label="Notes">
          <div className="tele sm" style={{lineHeight:1.6, color:'var(--ink-3)'}}>
            v0.2 · dark-first space palette.<br/>
            Click any planet to open its page.<br/>
            Enter fullscreen for cinematic flyby + free-fly.
          </div>
        </TweakSection>
      </TweaksPanel>
    </>
  );
};

const root = document.getElementById('app-root');
ReactDOM.createRoot(root).render(<App />);
