// Atmosphere playback control bar
// Floating subtle glass capsule at the bottom of the screen.
// Controls a "virtualOffset" (hours from now) and "playback" state.
//
// Modes:
//   Now      → jumps virtualOffset to 0
//   Today    → enters scrub mode bound to today (0..24 wall clock)
//   Play     → animates virtualOffset forward at a chosen rate for a chosen duration
//             (1h / 12h / 1d / 1w)
//   Scrub    → drag the slider directly

function PlaybackBar({ virtualOffset, setVirtualOffset, playing, setPlaying, accent }) {
  const [duration, setDuration] = React.useState('1d');
  const [showDurMenu, setShowDurMenu] = React.useState(false);
  const DURATIONS = { '1h': 1, '12h': 12, '1d': 24, '1w': 168 };

  // Animate when playing
  React.useEffect(() => {
    if (!playing) return;
    const startOffset = virtualOffset;
    const span = DURATIONS[duration];
    // animation lasts about 24 seconds regardless of span — feels good
    const animMs = 24000;
    const startT = performance.now();
    let raf = 0;
    function step() {
      const elapsed = performance.now() - startT;
      const t = Math.min(1, elapsed / animMs);
      const offset = startOffset + span * t;
      // clamp into [-24, +24]
      const clamped = Math.max(-24, Math.min(24, offset));
      setVirtualOffset(clamped);
      if (t < 1 && clamped > -24 && clamped < 24) {
        raf = requestAnimationFrame(step);
      } else {
        setPlaying(false);
      }
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, [playing, duration]);

  const isHistory = virtualOffset < -0.01;
  const isForecast = virtualOffset > 0.01;
  const isNow = !isHistory && !isForecast;

  return (
    <div className="playback-bar">
      <div className="playback-inner">
        {/* History/Now/Forecast indicator */}
        <div className="pb-stamp" style={{ borderColor: isNow ? accent : 'rgba(255,255,255,0.18)' }}>
          <span className="pb-stamp-dot" style={{ background: isNow ? accent : isHistory ? '#7ab0d8' : '#e8b04a' }} />
          <span className="pb-stamp-text">{isNow ? 'NOW' : isHistory ? 'HISTORY' : 'FORECAST'}</span>
          <span className="pb-stamp-offset">{virtualOffset >= 0 ? '+' : ''}{virtualOffset.toFixed(1)}H</span>
        </div>

        {/* Now button */}
        <button className="pb-btn" onClick={() => { setVirtualOffset(0); setPlaying(false); }} title="Jump to current time">
          <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="3" fill="currentColor" /><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
          Now
        </button>

        {/* Play / pause */}
        <button className="pb-btn pb-play" onClick={() => setPlaying(p => !p)} style={{ background: playing ? accent : undefined, color: playing ? '#fff' : undefined }}>
          {playing ? (
            <svg width="11" height="13" viewBox="0 0 11 13"><rect x="0" y="0" width="3.5" height="13" fill="currentColor" /><rect x="7.5" y="0" width="3.5" height="13" fill="currentColor" /></svg>
          ) : (
            <svg width="11" height="13" viewBox="0 0 11 13"><polygon points="0,0 11,6.5 0,13" fill="currentColor" /></svg>
          )}
          {playing ? 'Pause' : 'Play'}
        </button>

        {/* Duration menu */}
        <div className="pb-dur">
          <button className="pb-btn pb-dur-btn" onClick={() => setShowDurMenu(s => !s)}>
            {duration} <span style={{ opacity: 0.5 }}>▾</span>
          </button>
          {showDurMenu && (
            <div className="pb-dur-menu">
              {Object.keys(DURATIONS).map(d => (
                <button key={d} onClick={() => { setDuration(d); setShowDurMenu(false); }} className={d === duration ? 'active' : ''}>
                  <span className="pb-dur-label">{({ '1h': 'Next hour', '12h': 'Next 12 h', '1d': 'Next day', '1w': 'Next week' })[d]}</span>
                  <span className="pb-dur-key">{d}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Scrub slider */}
        <div className="pb-scrub">
          <div className="pb-scrub-track">
            {/* Now marker on the track */}
            <div className="pb-scrub-now" style={{ left: '50%' }} />
            <input
              type="range"
              min={-24} max={24} step={0.1}
              value={virtualOffset}
              onChange={(e) => { setPlaying(false); setVirtualOffset(parseFloat(e.target.value)); }}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                background: 'transparent', appearance: 'none', WebkitAppearance: 'none',
                accentColor: accent, cursor: 'pointer',
              }}
            />
          </div>
          <div className="pb-scrub-labels">
            <span>−24H</span>
            <span style={{ opacity: 0.4 }}>NOW</span>
            <span>+24H</span>
          </div>
        </div>
      </div>
    </div>
  );
}

window.PlaybackBar = PlaybackBar;
