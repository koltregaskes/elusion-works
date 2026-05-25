/* Solar System Field Lab — Planet Detail Page (DK spread, dark) */
/* eslint-disable */

const { useEffect, useRef, useState, useMemo } = React;

// ---------- single-planet 3D view ----------
const PlanetSphere = ({ planet, className = '', size = 1 }) => {
  const mountRef = useRef(null);
  const planetRef = useRef(planet);
  planetRef.current = planet;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !window.THREE) return;
    const THREE = window.THREE;

    const W = () => mount.clientWidth;
    const H = () => mount.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, W()/H(), 0.01, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W(), H());
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    // stars
    const starGeom = makeStarsField(1400, 40);
    const stars = new THREE.Points(starGeom, new THREE.PointsMaterial({
      size: 0.07, vertexColors: true, opacity: 0.7,
      transparent: true, sizeAttenuation: true, depthWrite: false,
    }));
    scene.add(stars);

    // planet
    const p = planetRef.current;
    const tex = makePlanetTexture(p.palette, p.family);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.85,
      metalness: 0.0,
    });
    const radius = 1.0;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 96), mat);
    const tilt = (p.axialDeg || 0) * Math.PI / 180;
    mesh.rotation.z = tilt;
    scene.add(mesh);

    // rings on saturn / uranus
    if (p.rings || p.key === 'uranus') {
      const inner = p.key === 'uranus' ? radius * 1.6 : radius * 1.45;
      const outer = p.key === 'uranus' ? radius * 2.0 : radius * 2.4;
      const ringGeom = new THREE.RingGeometry(inner, outer, 128);
      const uv = ringGeom.attributes.uv;
      const pos2 = ringGeom.attributes.position;
      for (let j = 0; j < uv.count; j++) {
        const x = pos2.getX(j), y = pos2.getY(j);
        const r = Math.sqrt(x*x + y*y);
        const t = (r - inner) / (outer - inner);
        uv.setXY(j, t, 0.5);
      }
      const ringMat = new THREE.MeshBasicMaterial({
        map: makeSaturnRingTexture(),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: p.key === 'uranus' ? 0.4 : 0.92,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.y = -0.4;
      mesh.add(ring);
    }

    // atmospheric halo
    const glowTex = makeGlowTexture(p.color);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: p.color, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(radius * 3.4);
    scene.add(glow);

    // lights — sun from upper-left
    scene.add(new THREE.AmbientLight(0x4a5a80, 0.4));
    const sunLight = new THREE.DirectionalLight(0xfff2c0, 1.25);
    sunLight.position.set(-3, 2, 4);
    scene.add(sunLight);

    // ---- interaction ----
    const state = {
      autoRot: 0,
      manualRot: 0,
      tiltRot: 0,
      dragging: false,
      lastPointer: null,
      lastInteract: 0,
      camDist: 3.4,
      camDistTarget: 3.4,
      camElev: 0.0,
    };

    camera.position.set(0, 0, state.camDist);
    camera.lookAt(0, 0, 0);

    const dom = renderer.domElement;
    dom.style.cursor = 'grab';
    dom.style.touchAction = 'none';

    const onDown = (e) => {
      state.dragging = true;
      state.lastPointer = { x: e.clientX, y: e.clientY };
      state.lastInteract = performance.now();
      dom.style.cursor = 'grabbing';
      try { dom.setPointerCapture(e.pointerId); } catch(_){}
    };
    const onUp = (e) => {
      state.dragging = false;
      dom.style.cursor = 'grab';
      try { dom.releasePointerCapture(e.pointerId); } catch(_){}
    };
    const onMove = (e) => {
      if (!state.dragging || !state.lastPointer) return;
      const dx = e.clientX - state.lastPointer.x;
      const dy = e.clientY - state.lastPointer.y;
      state.manualRot += dx * 0.008;
      state.tiltRot = Math.max(-0.7, Math.min(0.7, state.tiltRot - dy * 0.006));
      state.lastPointer = { x: e.clientX, y: e.clientY };
      state.lastInteract = performance.now();
    };
    const onLeave = () => { state.dragging = false; dom.style.cursor = 'grab';};
    const onWheel = (e) => {
      e.preventDefault();
      state.camDistTarget = Math.max(1.6, Math.min(8, state.camDistTarget * (1 + e.deltaY * 0.0012)));
      state.lastInteract = performance.now();
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerleave', onLeave);
    dom.addEventListener('pointercancel', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    let raf, lastT = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      const idleSince = now - state.lastInteract;
      if (!state.dragging && idleSince > 100) state.autoRot += dt * 0.12;

      // smooth zoom
      state.camDist += (state.camDistTarget - state.camDist) * 0.12;
      camera.position.set(0, Math.sin(state.tiltRot) * state.camDist, Math.cos(state.tiltRot) * state.camDist);
      camera.lookAt(0, 0, 0);

      // tilt + spin
      const totalY = state.autoRot + state.manualRot;
      mesh.rotation.y = totalY;
      // re-apply axial tilt on z
      mesh.rotation.z = tilt;

      // stars drift slightly
      stars.rotation.y += dt * 0.005;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      const w = W(), h = H();
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerleave', onLeave);
      dom.removeEventListener('pointercancel', onUp);
      dom.removeEventListener('wheel', onWheel);
      renderer.dispose();
      if (dom.parentNode === mount) mount.removeChild(dom);
    };
  }, [planet?.key]);

  return <div ref={mountRef} className={`pp-canvas-host ${className}`} style={{position:'absolute', inset:0}} />;
};

// ---------- moon ball (CSS) ----------
const moonStyle = (idx) => {
  const greys = ['#c9c2b0', '#a7a596', '#8e8a7d', '#bcb6a3', '#9b988a'];
  const c = greys[idx % greys.length];
  return {
    background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.6), transparent 38%),
                 radial-gradient(circle at 70% 75%, rgba(0,0,0,0.45), transparent 60%),
                 ${c}`,
  };
};

// ---------- comparison bubble ----------
const ComparisonStrip = ({ planet }) => {
  const { ratio, label, note } = planet.comparison;
  // size relative to Earth (1.0 = Earth size 50px reference)
  const ref = 60;
  const planetSize = Math.min(360, ref * ratio);
  return (
    <div className="compare">
      <div className="vs">
        <div className="lump">
          <div className="planet-ball" style={{ width: ref, height: ref }}>
            <div className="surface" style={ballGradient('#4a7bb6')} />
            <div className="glow" style={{ '--g': 'rgba(110,160,235,0.4)' }} />
          </div>
          <div className="lbl">Earth · ref</div>
        </div>
        <div className="lump">
          <div className="planet-ball" style={{ width: planetSize, height: planetSize }}>
            <div className="surface" style={ballGradient(planet.cssColor)} />
            <div className="glow" style={{ '--g': planet.glow }} />
            {planet.rings && <div className="rings" style={{ '--ring': '#e2c98a' }} />}
          </div>
          <div className="lbl">{planet.name}</div>
        </div>
      </div>
      <div className="compare-body">
        <div className="tele accent">{label}</div>
        <h3 className="serif" style={{ fontSize: 32, marginTop: 6, lineHeight: 1.1, color:'var(--ink)' }}>
          {ratio > 1 ? `${ratio.toFixed(1)}×` : `${(ratio).toFixed(2)}×`} <em style={{color:'var(--accent)', fontStyle:'italic'}}>Earth diameter</em>
        </h3>
        <p style={{ marginTop: 14 }}>{note}</p>
      </div>
    </div>
  );
};

const ballGradient = (color) => ({
  background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.55), transparent 38%), radial-gradient(circle at 70% 75%, rgba(0,0,0,0.45), transparent 60%), ${color}`,
});

// ---------- main page ----------
const PlanetPage = ({ planetKey, onClose, onNavigate }) => {
  const idx = PLANETS.findIndex(p => p.key === planetKey);
  const planet = PLANETS[idx];
  const prev = idx > 0 ? PLANETS[idx - 1] : null;
  const next = idx < PLANETS.length - 1 ? PLANETS[idx + 1] : null;

  // close on Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && prev) onNavigate(prev.key);
      if (e.key === 'ArrowRight' && next) onNavigate(next.key);
    };
    window.addEventListener('keydown', onKey);
    // lock body scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // scroll the page to top
    const el = document.querySelector('.planet-page');
    if (el) el.scrollTop = 0;
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [planetKey, prev, next, onClose, onNavigate]);

  if (!planet) return null;

  const yearLabel = (days) => {
    if (days < 365) return `${days.toFixed(0)} d`;
    return `${(days/365).toFixed(days < 3650 ? 1 : 0)} yr`;
  };
  const dayLabel = (h) => h > 100 ? `${(h/24).toFixed(0)} Earth days` : `${h.toFixed(1)} h`;

  return (
    <div className="planet-page">
      <div className="pp-top">
        <div className="crumbs">
          <a onClick={onClose}>← Field Lab</a>
          <span className="sep">/</span>
          <a onClick={onClose}>Planets</a>
          <span className="sep">/</span>
          <span className="cur">{planet.name}</span>
        </div>
        <div className="pp-nav">
          {prev && <button onClick={() => onNavigate(prev.key)}>← {prev.name}</button>}
          {next && <button onClick={() => onNavigate(next.key)}>{next.name} →</button>}
          <button onClick={onClose} aria-label="Close">✕ close</button>
        </div>
      </div>

      {/* HERO SPREAD */}
      <section className="pp-hero">
        <div className="pp-stage">
          <PlanetSphere planet={planet} />
        </div>
        <div className="pp-headline">
          <div className="num">PLANET · 0{planet.order} OF 08 &nbsp;·&nbsp; {planet.family.replace('-', ' ')}</div>
          <h1>{planet.name}</h1>
          <div className="epithet">"{planet.epithet}"</div>
          <p style={{ marginTop: 18, maxWidth: '46ch', color: 'var(--ink-2)', fontSize: 17, lineHeight: 1.55 }}>
            {planet.blurb}
          </p>
          <div className="pp-quickstats">
            <div className="qs">
              <div className="k">Distance from sun</div>
              <div className="v">{planet.realAU} <em>AU</em></div>
            </div>
            <div className="qs">
              <div className="k">Year</div>
              <div className="v">{yearLabel(planet.periodDays)}</div>
            </div>
            <div className="qs">
              <div className="k">Diameter</div>
              <div className="v">{(planet.diamKm/1000).toFixed(0)}<em>k km</em></div>
            </div>
          </div>
          <div className="pp-drag-hint">
            <span>↺ drag · spin</span>
            <span>⇕ scroll · zoom</span>
            <span>← →&nbsp; prev/next planet</span>
            <span>esc · close</span>
          </div>
        </div>
      </section>

      {/* KEY STATS */}
      <section className="pp-spread">
        <div className="spread-num">§ 01 · KEY STATS</div>
        <h2 className="spread-title">By the <em>numbers.</em></h2>
        <div className="keystats">
          <div className="ks">
            <div className="k">Diameter</div>
            <div className="v">{planet.diamKm.toLocaleString()} <em>km</em></div>
            <div className="sub">{planet.comparison.ratio > 1
              ? `About ${planet.comparison.ratio.toFixed(1)}× wider than Earth.`
              : `About ${(1/planet.comparison.ratio).toFixed(1)}× smaller than Earth.`}</div>
          </div>
          <div className="ks">
            <div className="k">Gravity</div>
            <div className="v">{planet.gravityG.toFixed(2)} <em>g</em></div>
            <div className="sub">{planet.gravityG > 1
              ? `A 70 kg person would weigh ~${Math.round(70 * planet.gravityG)} kg here.`
              : `A 70 kg person would weigh ~${Math.round(70 * planet.gravityG)} kg here.`}</div>
          </div>
          <div className="ks">
            <div className="k">Day length</div>
            <div className="v" style={{fontSize: planet.dayHours > 999 ? 30 : 42}}>
              {dayLabel(planet.dayHours)}
            </div>
            <div className="sub">Time for one full rotation about its axis.</div>
          </div>
          <div className="ks">
            <div className="k">Year length</div>
            <div className="v" style={{fontSize: planet.periodDays > 10000 ? 32 : 42}}>
              {yearLabel(planet.periodDays)}
            </div>
            <div className="sub">One full orbit around the sun.</div>
          </div>
          <div className="ks">
            <div className="k">Axial tilt</div>
            <div className="v">{planet.axialDeg.toFixed(1)}<em>°</em></div>
            <div className="sub">{planet.axialDeg > 90
              ? 'Tipped past vertical — rotates backwards.'
              : planet.axialDeg > 45
                ? 'Tipped extremely far — rolls along its orbit.'
                : 'Similar to Earth\'s 23.4°.'}</div>
          </div>
          <div className="ks">
            <div className="k">Moons</div>
            <div className="v">{planet.moonCount}</div>
            <div className="sub">{planet.moonCount === 0 ? 'No known moons.' : planet.moonCount === 1 ? 'A single companion.' : `Plus countless smaller bodies.`}</div>
          </div>
          {planet.facts.slice(0, 2).map((f, i) => (
            <div key={i} className="ks">
              <div className="k">{f[0]}</div>
              <div className="v" style={{fontSize: String(f[1]).length > 14 ? 24 : 32}}>{f[1]}</div>
              <div className="sub">{f[2]}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FACTS SPREAD (DK two-column with pullquote) */}
      <section className="pp-spread" style={{background:'var(--surface)'}}>
        <div className="spread-num">§ 02 · THE STORY</div>
        <h2 className="spread-title">Why {planet.name} is <em>strange.</em></h2>
        <div className="factspread">
          <div className="col">
            <p>{planet.twocol.left}</p>
            <div className="pullquote">
              "{planet.twocol.pull}"
              <span className="by">— Field Lab notebook</span>
            </div>
          </div>
          <div className="col">
            <p>{planet.twocol.right}</p>
            <h3 style={{marginTop: 24}}>Quick facts</h3>
            <ul style={{listStyle:'none', padding:0, margin:0}}>
              {planet.facts.slice(2).map((f, i) => (
                <li key={i} style={{
                  display:'grid', gridTemplateColumns: '160px 1fr', gap: 14,
                  padding: '10px 0', borderBottom: '1px dashed var(--line-2)'
                }}>
                  <span className="tele">{f[0]}</span>
                  <span style={{color:'var(--ink)', fontSize:14}}>{f[1]} <span style={{color:'var(--ink-3)'}}>— {f[2]}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* MOONS */}
      {planet.moons.length > 0 && (
        <section className="pp-spread">
          <div className="spread-num">§ 03 · MOONS</div>
          <h2 className="spread-title">
            {planet.moonCount === 1 ? 'One moon.' :
             planet.moonCount < 10 ? `${planet.moonCount} moons.` :
             `${planet.moonCount} moons.`}{' '}
            {planet.moons.length < planet.moonCount && <em>(The notable few.)</em>}
          </h2>
          <div className="moons-grid">
            {planet.moons.map((m, i) => (
              <article key={m.name} className="moon-card">
                <div className="mc-art" style={moonStyle(i)} />
                <div>
                  <div className="mc-name">{m.name}</div>
                  <div className="mc-meta">Ø {m.diamKm.toLocaleString()} km</div>
                </div>
                <div className="mc-blurb">{m.blurb}</div>
                <div className="mc-foot">Orbit · {m.period}</div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* COMPARISON */}
      <section className="pp-spread" style={{background:'var(--surface)'}}>
        <div className="spread-num">§ {planet.moons.length > 0 ? '04' : '03'} · TO SCALE</div>
        <h2 className="spread-title">Against <em>Earth.</em></h2>
        <ComparisonStrip planet={planet} />
      </section>

      {/* prev/next */}
      <div className="pp-next-row">
        {prev ? (
          <a onClick={() => onNavigate(prev.key)}>
            <div className="ball" style={ballGradient(prev.cssColor)} />
            <div>
              <div className="lbl">← previous · 0{prev.order}</div>
              <div className="pname">{prev.name}</div>
            </div>
          </a>
        ) : <span />}
        {next ? (
          <a className="next" onClick={() => onNavigate(next.key)}>
            <div className="ball" style={ballGradient(next.cssColor)} />
            <div>
              <div className="lbl">next · 0{next.order} →</div>
              <div className="pname">{next.name}</div>
            </div>
          </a>
        ) : <span />}
      </div>
    </div>
  );
};

Object.assign(window, { PlanetPage, ballGradient, moonStyle });
