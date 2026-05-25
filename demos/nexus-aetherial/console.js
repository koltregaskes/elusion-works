/* ============================================================
   Console · split-flap board
   Builds rows, animates character flips on rotation.
   ============================================================ */
(function () {
  const data = window.NEXUS_DATA;
  const container = document.getElementById('flap-rows');
  if (!container) return;

  const FLAP_W = 22; // visual budget per char including gap
  // headline cell width (px) — we cap at ~30 chars
  const CHAR_BUDGET = 30;

  const STATUS_TAG = {
    stable: 'STABLE',
    training: 'IN TRAINING',
    experimental: 'PREVIEW',
  };

  // pick the status from the model lookup
  function statusOf(code) {
    const m = data.models.find(m => code.startsWith(m.name));
    return m ? STATUS_TAG[m.status] || m.status.toUpperCase() : '—';
  }

  // pad/truncate headline to consistent width
  function pad(text, n) {
    if (text.length > n) return text.slice(0, n - 1) + '…';
    return text.padEnd(n, ' ');
  }

  function flapStripHTML(text) {
    return [...text].map(c => {
      if (c === ' ') return `<span class="flap space">&nbsp;</span>`;
      return `<span class="flap" data-c="${c}">${c}</span>`;
    }).join('');
  }

  function rowHTML(rel, i) {
    return `
      <div class="flap-board-row" data-row="${i}">
        <span class="num">#${String(i+1).padStart(2,'0')}</span>
        <div class="flap-row" data-headline>${flapStripHTML(pad(rel.headline, CHAR_BUDGET))}</div>
        <span class="family">${pad(rel.family.toUpperCase(), 14)}</span>
        <span class="status">${statusOf(rel.code)}</span>
        <span class="time">${rel.t}</span>
      </div>`;
  }

  // initial render
  container.innerHTML = data.releases.map(rowHTML).join('');

  /* ── rotation ─────────────────────────────────────────── */
  // Every N seconds: pick a random row, replace its headline with a new
  // plausible event line, animating each flap.

  const VERBS = [
    'CHECKPOINT EXPORTED',
    'TOOL CALLS API V3',
    'EVAL PASS COMPLETE',
    'CONTEXT EXTENSION SHIPPED',
    'VERIFIER ROUTER LIVE',
    'POST-TRAIN RECIPE PUBLISHED',
    'SCRATCHPAD MEMORY ENABLED',
    'MOE ROUTER REBALANCED',
    'LATENCY DROP · 18%',
    'WEIGHTS MIRRORED · HF',
    'AGENT BENCHMARK +5.4',
    'TRAINING DATA AUDIT PASSED',
    'RED-TEAM PHASE 02 BEGINS',
    'API VERSION DEPRECATED',
    'BENCH SUITE ADDED · TAU-2',
    'SAFETY REPORT FILED',
  ];

  const MODELS_FOR_FLAP = data.models.map(m => `${m.name} ${m.version}`.toUpperCase());

  let rate = 'med';
  const RATE_MS = { slow: 5200, med: 2800, fast: 1400 };
  let timer = null;

  function pickEvent() {
    const m = MODELS_FOR_FLAP[Math.floor(Math.random() * MODELS_FOR_FLAP.length)];
    const v = VERBS[Math.floor(Math.random() * VERBS.length)];
    return `${m} ${v}`;
  }

  function flipRow(rowEl, newText) {
    const headline = rowEl.querySelector('[data-headline]');
    const target = pad(newText, CHAR_BUDGET);
    const flaps = [...headline.querySelectorAll('.flap')];

    // ensure target length matches strip length (it should, both = CHAR_BUDGET)
    [...target].forEach((ch, idx) => {
      const f = flaps[idx];
      if (!f) return;
      const isSpace = ch === ' ';
      const wasSpace = f.classList.contains('space');
      // skip flip if char unchanged
      if (!isSpace && !wasSpace && f.dataset.c === ch) return;

      // stagger the flip per character
      setTimeout(() => {
        f.classList.remove('flip');
        // force reflow so animation restarts
        // eslint-disable-next-line no-unused-expressions
        f.offsetWidth;
        if (isSpace) {
          f.classList.add('space');
          f.innerHTML = '&nbsp;';
          f.removeAttribute('data-c');
        } else {
          f.classList.remove('space');
          f.textContent = ch;
          f.dataset.c = ch;
        }
        f.classList.add('flip');
      }, idx * 22);
    });
  }

  function tick() {
    const rows = container.querySelectorAll('.flap-board-row');
    if (!rows.length) return;
    const r = rows[Math.floor(Math.random() * rows.length)];
    flipRow(r, pickEvent());
    // also bump time stamp on the freshly-changed row
    const tCell = r.querySelector('.time');
    if (tCell) {
      tCell.textContent = 'NOW';
      // others age by a tick
      rows.forEach((other, i) => {
        if (other === r) return;
        const t = other.querySelector('.time');
        const cur = t.textContent;
        if (cur === 'NOW') t.textContent = 'T−1M';
        else if (cur.startsWith('T−') && cur.endsWith('M')) {
          const n = parseInt(cur.slice(2, -1), 10);
          if (!isNaN(n) && n < 99) t.textContent = `T−${n+1}M`;
        }
      });
    }
  }

  function setRate(r) {
    rate = r;
    if (timer) { clearInterval(timer); timer = null; }
    if (r === 'off') return;
    timer = setInterval(tick, RATE_MS[r] || RATE_MS.med);
  }

  setRate('med');

  // initial wake-up: do one flip after a beat so the page feels alive
  setTimeout(tick, 800);

  window.NEXUS_FLAP_RATE = setRate;
})();
