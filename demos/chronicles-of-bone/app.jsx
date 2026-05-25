// app.jsx — root: film-strip controller, keyboard nav, tweaks panel
const { useEffect: useE, useRef: useR, useState: useS, useMemo: useM, useCallback: useC } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "cursor": true,
  "noise": true,
  "motion": true,
  "density": "default",
  "stackVariant": "periodic"
}/*EDITMODE-END*/;

function App() {
  const [idx, setIdx] = useS(0);
  const [muted, setMuted] = useS(false);
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const stripRef = useR(null);

  // wire body classes from tweaks
  useE(() => {
    const b = document.body;
    b.classList.toggle('no-cursor', !tweaks.cursor);
    b.classList.toggle('no-noise', !tweaks.noise);
    b.classList.toggle('no-motion', !tweaks.motion);
    b.classList.toggle('density-compact', tweaks.density === 'compact');
    b.classList.toggle('density-spacious', tweaks.density === 'spacious');
  }, [tweaks]);

  // keyboard nav
  useE(() => {
    const onKey = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        setIdx(i => Math.min(ACTS.length - 1, i + 1));
        e.preventDefault();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        setIdx(i => Math.max(0, i - 1));
        e.preventDefault();
      } else if (e.key === 'Home') {
        setIdx(0); e.preventDefault();
      } else if (e.key === 'End') {
        setIdx(ACTS.length - 1); e.preventDefault();
      } else if (/^[1-5]$/.test(e.key)) {
        setIdx(parseInt(e.key, 10) - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // wheel / trackpad — horizontal scroll mapping
  useE(() => {
    let cooldown = 0;
    const onWheel = (e) => {
      // ignore wheel when over scroll regions we want to keep
      const t = e.target;
      if (t && t.closest && t.closest('[data-scroll-allow]')) return;
      const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (Math.abs(delta) < 18) return;
      const now = performance.now();
      if (now - cooldown < 700) { e.preventDefault(); return; }
      cooldown = now;
      if (delta > 0) setIdx(i => Math.min(ACTS.length - 1, i + 1));
      else           setIdx(i => Math.max(0, i - 1));
      e.preventDefault();
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  // touch swipe
  useE(() => {
    let startX = 0;
    const onStart = (e) => { startX = e.touches[0].clientX; };
    const onEnd = (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 60) {
        if (dx < 0) setIdx(i => Math.min(ACTS.length - 1, i + 1));
        else        setIdx(i => Math.max(0, i - 1));
      }
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);

  useE(() => {
    if (stripRef.current) {
      const w = window.innerWidth;
      stripRef.current.style.transform = `translateX(-${idx * w}px)`;
    }
  }, [idx]);

  // recompute on resize
  useE(() => {
    const onResize = () => {
      if (stripRef.current) {
        const w = window.innerWidth;
        stripRef.current.style.transform = `translateX(-${idx * w}px)`;
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [idx]);

  const onLaunch = useC(() => {
    setIdx(1);
  }, []);

  const active = ACTS[idx];

  return (
    <React.Fragment>
      <div className="atmosphere" aria-hidden="true" />
      <div className="noise" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />

      <CursorRing />
      <TopBar activeNumeral={active.numeral} activeLabel={active.label.toUpperCase()} total={ACTS.length} />
      <SideRail activeIndex={idx} onJump={setIdx} muted={muted} onToggleMute={() => setMuted(m => !m)} />

      <div className="perf top" aria-hidden="true" />
      <div className="perf bot" aria-hidden="true" />

      <main className="stage">
        <div className="strip" ref={stripRef}>
          <ActHero onLaunch={onLaunch} />
          <ActDeconstruct />
          <ActUpscale />
          <ActStack variant={tweaks.stackVariant} />
          <ActCut />
        </div>
      </main>

      <button
        className="edge-nav prev"
        onClick={() => setIdx(i => Math.max(0, i - 1))}
        disabled={idx === 0}
        aria-label="Previous act"
        data-hot
      >
        <span className="ring" />
        <span className="chev" aria-hidden="true" />
        <span className="label">PREV · ACT {ACTS[Math.max(0, idx - 1)].numeral}</span>
      </button>
      <button
        className="edge-nav next"
        onClick={() => setIdx(i => Math.min(ACTS.length - 1, i + 1))}
        disabled={idx === ACTS.length - 1}
        aria-label="Next act"
        data-hot
      >
        <span className="ring" />
        <span className="chev" aria-hidden="true" />
        <span className="label">NEXT · ACT {ACTS[Math.min(ACTS.length - 1, idx + 1)].numeral}</span>
      </button>

      <div className="progress" role="navigation" aria-label="Act progress">
        <span>ACT <span className="lbl-act">{active.numeral}</span> / V</span>
        <span className="ticks">
          {ACTS.map((a, i) => (
            <button
              key={a.key}
              className={"tick" + (i === idx ? " is-active" : (i < idx ? " is-done" : ""))}
              onClick={() => setIdx(i)}
              aria-label={"Jump to act " + a.numeral}
              data-hot
            />
          ))}
        </span>
        <span className="hint">
          SCROLL · <span className="kbd">←</span> <span className="kbd">→</span>
        </span>
      </div>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Atmosphere">
          <TweakToggle  label="Copper cursor ring" value={tweaks.cursor} onChange={(v) => setTweak('cursor', v)} />
          <TweakToggle  label="Film grain noise"  value={tweaks.noise}  onChange={(v) => setTweak('noise', v)} />
          <TweakToggle  label="Motion + animation" value={tweaks.motion} onChange={(v) => setTweak('motion', v)} />
        </TweakSection>
        <TweakSection label="Layout">
          <TweakRadio
            label="Density"
            value={tweaks.density}
            onChange={(v) => setTweak('density', v)}
            options={[
              { value: 'compact',  label: 'Compact' },
              { value: 'default',  label: 'Default' },
              { value: 'spacious', label: 'Spacious' },
            ]}
          />
          <TweakSelect
            label="Act IV cabinet"
            value={tweaks.stackVariant}
            onChange={(v) => setTweak('stackVariant', v)}
            options={[
              { value: 'periodic', label: 'Periodic table (default)' },
              { value: 'bento',    label: 'Bento bento bento' },
              { value: 'drawers',  label: 'Cabinet drawers' },
            ]}
          />
        </TweakSection>
      </TweaksPanel>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
