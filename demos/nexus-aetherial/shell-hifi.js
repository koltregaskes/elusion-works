/* ============================================================
   Shell · theme circle-wipe, tweaks panel, nav scrollspy
   ============================================================ */
(function () {
  /* ── theme circle-wipe ────────────────────────────────── */
  const themeBtn = document.getElementById('theme-btn');
  themeBtn.addEventListener('click', (e) => {
    const r = themeBtn.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    document.body.style.setProperty('--wipe-x', `${x}px`);
    document.body.style.setProperty('--wipe-y', `${y}px`);
    document.body.classList.add('theme-transitioning');
    setTimeout(() => {
      const m = document.body.dataset.mode === 'dark' ? 'light' : 'dark';
      document.body.dataset.mode = m;
      // sync tweaks
      document.querySelectorAll('[data-tweak="mode"] button').forEach(b =>
        b.setAttribute('aria-pressed', b.dataset.val === m ? 'true' : 'false')
      );
    }, 280);
    setTimeout(() => document.body.classList.remove('theme-transitioning'), 700);
  });

  /* ── tweaks panel ─────────────────────────────────────── */
  const tweaks = document.getElementById('tweaks');
  document.getElementById('tweaks-btn').addEventListener('click', () => {
    tweaks.dataset.open = tweaks.dataset.open === 'true' ? 'false' : 'true';
  });
  document.getElementById('tweaks-close').addEventListener('click', () => {
    tweaks.dataset.open = 'false';
  });

  // segmented controls
  document.querySelectorAll('.tweaks .seg').forEach(seg => {
    seg.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const key = seg.dataset.tweak;
      const val = btn.dataset.val;
      seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
      applyTweak(key, val);
    });
  });

  function applyTweak(key, val) {
    const root = document.documentElement;
    if (key === 'mode') {
      document.body.dataset.mode = val;
    }
    if (key === 'accent') {
      const palette = {
        plasma: { c: '#6f4cff', deep: '#4a26d6', soft: 'rgba(111,76,255,0.12)',  glow: 'rgba(111,76,255,0.35)' },
        signal: { c: '#1a9d6c', deep: '#0e7350', soft: 'rgba(26,157,108,0.14)',  glow: 'rgba(26,157,108,0.35)' },
        flame:  { c: '#e63946', deep: '#b81f2c', soft: 'rgba(230,57,70,0.14)',   glow: 'rgba(230,57,70,0.35)' },
        ink:    { c: 'var(--ink)', deep: 'var(--ink)', soft: 'rgba(13,15,23,0.08)', glow: 'rgba(13,15,23,0.18)' },
      };
      const dark = {
        plasma: { c: '#8a72ff', deep: '#6f4cff', soft: 'rgba(138,114,255,0.18)', glow: 'rgba(138,114,255,0.45)' },
        signal: { c: '#5cd5a3', deep: '#2fa97a', soft: 'rgba(92,213,163,0.18)',  glow: 'rgba(92,213,163,0.45)' },
        flame:  { c: '#ff7a7a', deep: '#e63946', soft: 'rgba(255,122,122,0.18)', glow: 'rgba(255,122,122,0.45)' },
        ink:    { c: 'var(--ink)', deep: 'var(--ink)', soft: 'rgba(240,242,248,0.08)', glow: 'rgba(240,242,248,0.18)' },
      };
      const p = (document.body.dataset.mode === 'dark' ? dark : palette)[val];
      root.style.setProperty('--plasma', p.c);
      root.style.setProperty('--plasma-deep', p.deep);
      root.style.setProperty('--plasma-soft', p.soft);
      root.style.setProperty('--plasma-glow', p.glow);
      // legacy aliases stay in sync
      root.style.setProperty('--copper', p.c);
      root.style.setProperty('--copper-deep', p.deep);
      root.style.setProperty('--copper-soft', p.soft);
    }
    if (key === 'display-font') {
      const ff = val === 'fraunces' ? "'Fraunces', serif" : "'Space Grotesk', sans-serif";
      root.style.setProperty('--ff-display', ff);
    }
    if (key === 'flap-rate') {
      if (window.NEXUS_FLAP_RATE) window.NEXUS_FLAP_RATE(val);
    }
    if (key === 'density') {
      const padMap = { cozy: '88px', default: '36px', dense: '20px' };
      document.querySelector('main').style.paddingTop = padMap[val];
      const gapMap = { cozy: 14, default: 14, dense: 8 };
      document.querySelectorAll('.cabinet').forEach(c => c.style.gap = `${gapMap[val]}px`);
      // section spacing
      const sectionSp = { cozy: '110px', default: '88px', dense: '52px' };
      document.querySelectorAll('.section').forEach(s => s.style.marginTop = sectionSp[val]);
    }
  }

  /* ── tweaks-via-host protocol (toolbar toggle) ────────── */
  window.addEventListener('message', (e) => {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type === '__activate_edit_mode') tweaks.dataset.open = 'true';
    if (e.data.type === '__deactivate_edit_mode') tweaks.dataset.open = 'false';
  });
  try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch {}

  /* ── nav scrollspy ────────────────────────────────────── */
  const navLinks = document.querySelectorAll('.nav a');
  const sections = ['console', 'matrix', 'anatomy', 'cabinet', 'digest'].map(id => document.getElementById(id)).filter(Boolean);
  function spy() {
    const top = window.scrollY + 140;
    let curr = sections[0];
    for (const s of sections) {
      if (s.offsetTop <= top) curr = s;
    }
    navLinks.forEach(a => {
      const match = a.getAttribute('href') === '#' + curr.id;
      if (match) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }
  spy();
  window.addEventListener('scroll', spy, { passive: true });
})();
