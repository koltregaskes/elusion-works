// shell.jsx — chrome: cursor, ambient atmosphere, side rail, ticker, top bar
const { useEffect, useRef, useState, useCallback, useMemo } = React;

/* ---------- CursorRing ---------- */
function CursorRing() {
  const ringRef = useRef(null);
  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;
    let raf = 0;
    let tx = window.innerWidth / 2, ty = window.innerHeight / 2;
    let cx = tx, cy = ty;
    const onMove = (e) => {
      tx = e.clientX; ty = e.clientY;
      const target = e.target;
      const interactive = target && target.closest && target.closest('[data-hot]');
      const textEl = target && target.closest && target.closest('[data-text]');
      ring.classList.toggle('is-hot', !!interactive);
      ring.classList.toggle('is-text', !!textEl && !interactive);
      document.documentElement.style.setProperty('--mx', tx + 'px');
      document.documentElement.style.setProperty('--my', ty + 'px');
    };
    const loop = () => {
      cx += (tx - cx) * 0.55;
      cy += (ty - cy) * 0.55;
      ring.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener('pointermove', onMove);
    raf = requestAnimationFrame(loop);
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
  }, []);
  return <div className="cursor-ring" ref={ringRef} aria-hidden="true" />;
}

/* ---------- Side Rail ---------- */
const ACTS = [
  { key: 'hero',      numeral: 'I',   label: 'The Opening Title' },
  { key: 'blade',     numeral: 'II',  label: 'Anatomy of a Shot' },
  { key: 'upscale',   numeral: 'III', label: 'Before / After' },
  { key: 'stack',     numeral: 'IV',  label: "The Director's Toolkit" },
  { key: 'cut',       numeral: 'V',   label: "Director's Cut" },
];

function SideRail({ activeIndex, onJump, muted, onToggleMute }) {
  return (
    <aside className="rail" aria-label="Acts navigation">
      <div className="brand" data-hot>
        <div className="brand-mark" aria-hidden="true" />
        <div className="brand-name">CHRONICLES OF BONE</div>
      </div>

      <div className="rail-acts">
        {ACTS.map((a, i) => (
          <button key={a.key}
            className={"rail-act" + (i === activeIndex ? " is-active" : "")}
            onClick={() => onJump(i)}
            data-hot
            aria-label={"Jump to act " + a.numeral + " — " + a.label}
          >
            <span className="tick" />
            <span className="rail-numeral">{a.numeral}</span>
            <span className="rail-label">{a.label}</span>
          </button>
        ))}
      </div>

      <div className="rail-foot">
        <button
          className={"cinema-toggle" + (muted ? " muted" : "")}
          onClick={onToggleMute}
          data-hot
          aria-label={muted ? "Unmute ambient soundscape" : "Mute ambient soundscape"}
        >
          <span className="bars">
            <span /><span /><span /><span />
          </span>
          <span className="lbl">{muted ? "MUTED" : "AMBIENT"}</span>
        </button>
      </div>
    </aside>
  );
}

/* ---------- Top bar ---------- */
function TopBar({ activeNumeral, activeLabel, total }) {
  const now = useMemo(() => new Date(), []);
  const dateStr = now.toUTCString().slice(5, 16).toUpperCase();
  return (
    <div className="topbar">
      <span><span className="dot" /> ON SET · {dateStr}</span>
      <span className="sep" />
      <span>ACT {activeNumeral} / V — {activeLabel}</span>
      <span className="sep" />
      <span style={{ color: 'var(--copper)' }}>21:9 · DCI 4K</span>
    </div>
  );
}

/* ---------- Ticker ---------- */
const TICKER = [
  { kind: 'live',  text: 'SCENE 04 · COLOSSUS RISING · LOCKED PICTURE', strong: true },
  { kind: 'plain', text: 'EDIT BAY 02 · CONFORMING DAILIES' },
  { kind: 'warn',  text: 'COLOUR SUITE · MASTER GRADE @ 84%' },
  { kind: 'plain', text: 'SOUND DESIGN · COLOSSUS BREATH PASS' },
  { kind: 'live',  text: 'PIPELINE · 4K → 8K FINISHING' },
  { kind: 'plain', text: 'SHOT MANIFEST · 142 / 142 DELIVERED' },
  { kind: 'warn',  text: 'FINAL DELIVERY · 06:42:31 REMAINING' },
  { kind: 'plain', text: 'KEY LIGHT · GOLDEN-HOUR LUT APPLIED' },
  { kind: 'live',  text: 'IMMERSIVE MIX · DOLBY ATMOS 7.1.4' },
];

function Ticker() {
  const items = [...TICKER, ...TICKER, ...TICKER];
  return (
    <div className="ticker" data-text>
      <div className="ticker-track">
        {items.map((t, i) => (
          <span key={i} className="ticker-item">
            <span className={"marker " + (t.kind === 'live' ? 'live' : t.kind === 'warn' ? 'warn' : '')} />
            <span className={t.strong ? "copper" : ""}>{t.text}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- Magnetic CTA ---------- */
function MagneticButton({ children, onClick }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${x * 0.18}px, ${y * 0.18}px)`;
      el.style.setProperty('--bmx', ((e.clientX - r.left) / r.width * 100) + '%');
      el.style.setProperty('--bmy', ((e.clientY - r.top) / r.height * 100) + '%');
    };
    const onLeave = () => {
      el.style.transform = '';
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, []);
  return (
    <button ref={ref} className="launch" onClick={onClick} data-hot>
      <span>{children || "Enter the Film"}</span>
      <span className="arrow" aria-hidden="true" />
    </button>
  );
}

Object.assign(window, { CursorRing, SideRail, TopBar, Ticker, MagneticButton, ACTS });
