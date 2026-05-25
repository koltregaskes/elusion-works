/* ============================================================
   Anatomy section — builds 5 interactive panels, syncs them
   to scroll position of the narrative column, and provides
   tab/click controls.
   ============================================================ */
(function () {
  const stage = document.getElementById('canvas-stage');
  const tabs  = document.querySelectorAll('.canvas-tab');
  const stations = document.querySelectorAll('.station');
  const progressFill = document.getElementById('canvas-progress-fill');
  const stepEl = document.getElementById('canvas-step');
  if (!stage) return;

  /* ── Build the five panels ──────────────────────────── */
  function buildPanels() {
    stage.innerHTML = `
      ${tokenizePanel()}
      ${attendPanel()}
      ${transformPanel()}
      ${trainPanel()}
      ${harnessPanel()}
    `;
  }

  /* ── 01 TOKENIZE ────────────────────────────────────── */
  function tokenizePanel() {
    const tokens = [
      ['Un', 'alt'], ['forget', 'alt'], ['table', 'alt'],
      [' ', 'spc'], ['memory', ''], [' ', 'spc'], ['gets', ''],
      [' ', 'spc'], ['encoded', ''], [' ', 'spc'], ['as', ''],
      [' ', 'spc'], ['vectors', 'alt'], ['.', ''],
    ];
    const tokensHTML = tokens.map((t, i) => {
      const cls = t[1];
      const label = t[0] === ' ' ? '·' : t[0];
      return `<span class="tk-token ${cls}" style="--i:${i}">${label}</span>`;
    }).join('');

    // small embedding grid
    const cells = Array.from({ length: 96 }).map((_, i) => {
      const opacity = 0.15 + Math.random() * 0.85;
      return `<span class="tk-embed-cell" style="--i:${i};opacity:${opacity.toFixed(2)}"></span>`;
    }).join('');

    return `
      <div class="canvas-panel is-active" data-panel="1">
        <div class="tk-canvas">
          <h4>Input → Tokens → Embeddings</h4>
          <div class="tk-sample">"<em>Unforgettable memory gets encoded as vectors.</em>"</div>
          <div class="tk-tokens">${tokensHTML}</div>
          <div class="tk-embed">
            <h4>VECTOR · 96 of typically 4096+ dimensions</h4>
            <div class="tk-embed-grid">${cells}</div>
          </div>
        </div>
      </div>`;
  }

  /* ── 02 ATTEND ──────────────────────────────────────── */
  function attendPanel() {
    const tokens = ['When', 'the', 'cat', 'sat', 'on', 'the', 'mat,', 'it'];
    // weights for each head (one row per head); idx 7 ("it") is the query
    const heads = {
      'syntax':   [10,  5,  5,  3,  8,  4, 12,  0],
      'entities': [ 4,  2, 70,  8,  3,  2, 18,  0],   // strongly references "cat"
      'position': [ 6, 10,  4,  8, 12, 10, 22,  0],
      'codeish':  [ 6,  6,  6,  6,  6,  6,  6,  0],
    };
    const labels = Object.keys(heads);

    const tokRow = (idx, weights) => {
      return tokens.map((t, i) => {
        const isQ = i === 7;
        const w = weights[i];
        return `<span class="at-tok ${isQ ? 'is-query' : ''}" data-w="${w}" style="--w:${w}">${t}</span>`;
      }).join('');
    };
    // initial: entities head
    const initialW = heads.entities;

    const headBtns = labels.map((l, i) =>
      `<button class="at-head" data-head="${l}" aria-selected="${i === 1 ? 'true' : 'false'}">${l}</button>`
    ).join('');

    // attention arrows from query (last token) to all others
    function svgFromWeights(weights) {
      const W = 8;
      const positions = weights.map((_, i) => (i + 0.5) / W * 100);
      const qx = positions[7];
      const lines = weights.slice(0, 7).map((w, i) => {
        const x = positions[i];
        const op = Math.min(1, w / 60);
        const width = 0.5 + (w / 30);
        return `<path d="M${qx},90 C${qx},20 ${x},20 ${x},10" fill="none" stroke="var(--plasma)" stroke-opacity="${op.toFixed(2)}" stroke-width="${width.toFixed(2)}"/>`;
      }).join('');
      return `<svg class="at-svg" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>`;
    }

    return `
      <div class="canvas-panel" data-panel="2">
        <div class="at-canvas">
          <h4>Self-attention · what does "it" refer to?</h4>
          <div style="display:flex;flex-direction:column;gap:8px;flex:1;min-height:0">
            <div class="at-row" id="at-row-top">${tokRow(0, initialW)}</div>
            <div id="at-svg-wrap" style="flex:1;display:flex;align-items:stretch">${svgFromWeights(initialW)}</div>
          </div>
          <div class="at-head-row">${headBtns}</div>
        </div>
      </div>`;
  }

  /* ── 03 TRANSFORM ───────────────────────────────────── */
  function transformPanel() {
    const N = 12;
    const layers = Array.from({ length: N }).map((_, i) => {
      const isMoe = i >= 4 && i <= 9;     // middle layers as MoE
      const attnAct = 35 + Math.floor(Math.random() * 50);
      const ffnAct  = 28 + Math.floor(Math.random() * 60);
      return `
        <div class="tr-layer ${isMoe ? 'is-moe' : ''}" data-layer="${i+1}">
          <span class="n">L${String(i+1).padStart(2,'0')}</span>
          <span class="blk attn" style="--act:${attnAct}%"></span>
          <span class="blk ffn"  style="--act:${ffnAct}%"></span>
          <span class="lbl">${isMoe ? 'MoE 8e' : 'dense'}</span>
        </div>`;
    }).join('');

    return `
      <div class="canvas-panel" data-panel="3">
        <div class="tr-canvas">
          <h4>Transformer stack · ${N} layers · attention → feed-forward</h4>
          <div class="tr-stack">${layers}</div>
        </div>
      </div>`;
  }

  /* ── 04 TRAIN ───────────────────────────────────────── */
  function trainPanel() {
    return `
      <div class="canvas-panel" data-panel="4">
        <div class="tn-canvas">
          <h4>Training pipeline · three stages, two orders of magnitude</h4>
          <div class="tn-stages">
            <div class="tn-stage" data-stage="pretrain">
              <div class="ord">01</div>
              <div class="body">
                <div class="name">Pretraining <span class="badge">15 TRILLION TOKENS</span></div>
                <div class="desc">Next-token prediction on the public internet, code, and licensed corpora. Months of compute. This is where world-model emerges.</div>
                <div class="meter"><span class="fill" style="--w:96%"></span></div>
              </div>
            </div>
            <div class="tn-stage" data-stage="sft">
              <div class="ord">02</div>
              <div class="body">
                <div class="name">SFT + DPO <span class="badge">~100K EXAMPLES</span></div>
                <div class="desc">Supervised fine-tuning on curated demonstrations, then preference optimisation. The assistant persona, instruction-following, formatting.</div>
                <div class="meter"><span class="fill" style="--w:42%"></span></div>
              </div>
            </div>
            <div class="tn-stage" data-stage="rlvr">
              <div class="ord">03</div>
              <div class="body">
                <div class="name">RLVR <span class="badge">VERIFIABLE REWARD</span></div>
                <div class="desc">Reinforcement learning where the reward is a checker, not a human rater. Used to teach reasoning, code correctness, and tool use.</div>
                <div class="meter"><span class="fill" style="--w:28%"></span></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ── 05 HARNESS ─────────────────────────────────────── */
  function harnessPanel() {
    return `
      <div class="canvas-panel" data-panel="5">
        <div class="hr-canvas">
          <h4>The model lives inside a harness — boxes shape behavior</h4>
          <div class="hr-stage">
            <div class="hr-cell sp">
              <span class="k">SYSTEM PROMPT</span>
              <span class="v">You are a helpful, harmless, honest assistant…</span>
            </div>
            <div class="hr-cell tools">
              <span class="k">TOOLS · 12</span>
              <span class="v">search · code · file · calc · render · 7 more</span>
            </div>
            <div class="hr-cell user">
              <span class="k">USER MESSAGE</span>
              <span class="v">"Compare these two models on reasoning per dollar."</span>
            </div>
            <div class="hr-cell core">
              <span class="k">MODEL WEIGHTS</span>
              <span class="v">Frontier LLM</span>
            </div>
            <div class="hr-cell mem">
              <span class="k">MEMORY</span>
              <span class="v">12 turns · 4 tool results · 1 RAG doc</span>
            </div>
            <div class="hr-cell out">
              <span class="k">RESPONSE</span>
              <span class="v">"Across MMLU-Pro, GPT-5 leads by 1.1 points…"</span>
            </div>
            <div class="hr-cell safety">
              <span class="k">SAFETY FILTER</span>
              <span class="v">in · out · refuse-list · 0 hits</span>
            </div>
          </div>
        </div>
      </div>`;
  }

  buildPanels();

  /* ── Wire attention head selector ───────────────────── */
  function rebuildAttention(headKey) {
    const heads = {
      'syntax':   [10,  5,  5,  3,  8,  4, 12,  0],
      'entities': [ 4,  2, 70,  8,  3,  2, 18,  0],
      'position': [ 6, 10,  4,  8, 12, 10, 22,  0],
      'codeish':  [ 6,  6,  6,  6,  6,  6,  6,  0],
    };
    const tokens = ['When', 'the', 'cat', 'sat', 'on', 'the', 'mat,', 'it'];
    const weights = heads[headKey];
    const row = document.getElementById('at-row-top');
    if (row) {
      row.innerHTML = tokens.map((t, i) => {
        const isQ = i === 7;
        const w = weights[i];
        return `<span class="at-tok ${isQ ? 'is-query' : ''}" data-w="${w}" style="--w:${w}">${t}</span>`;
      }).join('');
    }
    const svgWrap = document.getElementById('at-svg-wrap');
    if (svgWrap) {
      const W = 8;
      const positions = weights.map((_, i) => (i + 0.5) / W * 100);
      const qx = positions[7];
      const lines = weights.slice(0, 7).map((w, i) => {
        const x = positions[i];
        const op = Math.min(1, w / 60);
        const width = 0.5 + (w / 30);
        return `<path d="M${qx},90 C${qx},20 ${x},20 ${x},10" fill="none" stroke="var(--plasma)" stroke-opacity="${op.toFixed(2)}" stroke-width="${width.toFixed(2)}"/>`;
      }).join('');
      svgWrap.innerHTML = `<svg class="at-svg" viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>`;
    }
  }

  document.addEventListener('click', e => {
    const head = e.target.closest('.at-head');
    if (head) {
      document.querySelectorAll('.at-head').forEach(b => b.setAttribute('aria-selected', b === head ? 'true' : 'false'));
      rebuildAttention(head.dataset.head);
    }
  });

  /* ── Active panel switching ─────────────────────────── */
  let active = 1;
  function setActive(n) {
    if (n === active) return;
    active = n;
    stage.querySelectorAll('.canvas-panel').forEach(p => {
      p.classList.toggle('is-active', Number(p.dataset.panel) === n);
    });
    tabs.forEach(t => t.setAttribute('aria-selected', Number(t.dataset.tab) === n ? 'true' : 'false'));
    stations.forEach(s => s.classList.toggle('is-active', Number(s.dataset.station) === n));
    if (stepEl) stepEl.textContent = String(n).padStart(2, '0');
    if (progressFill) progressFill.style.width = `${(n / 5) * 100}%`;

    // panel-specific lifecycle hooks
    if (n === 3) flowTransformer();
    if (n === 4) animateTrainStages();
  }

  // tabs clickable → also scroll to that station
  tabs.forEach(t => t.addEventListener('click', () => {
    const n = Number(t.dataset.tab);
    setActive(n);
    const s = document.querySelector(`.station[data-station="${n}"]`);
    if (s) s.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));

  /* ── Scroll observer on stations ────────────────────── */
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      // pick the station nearest viewport center
      let best = null, bestDist = Infinity;
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const r = e.boundingClientRect;
        const center = r.top + r.height / 2;
        const dist = Math.abs(center - window.innerHeight / 2);
        if (dist < bestDist) { bestDist = dist; best = e.target; }
      });
      if (best) {
        const n = Number(best.dataset.station);
        setActive(n);
      } else {
        // fallback: pick whichever has any visible portion closest to center
        let near = null, nd = Infinity;
        stations.forEach(s => {
          const r = s.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) return;
          const center = r.top + r.height / 2;
          const d = Math.abs(center - window.innerHeight / 2);
          if (d < nd) { nd = d; near = s; }
        });
        if (near) setActive(Number(near.dataset.station));
      }
    }, {
      rootMargin: '-30% 0px -30% 0px',
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });
    stations.forEach(s => io.observe(s));
  }

  /* ── Periodic life: transformer flow + train stage cycle ─── */
  function flowTransformer() {
    const layers = stage.querySelectorAll('.tr-layer');
    if (!layers.length) return;
    let i = 0;
    if (flowTransformer.t) clearInterval(flowTransformer.t);
    flowTransformer.t = setInterval(() => {
      layers.forEach((l, idx) => l.classList.toggle('is-active', idx === i));
      i = (i + 1) % layers.length;
    }, 280);
    // cleanup if user leaves panel
    setTimeout(() => {
      if (active !== 3 && flowTransformer.t) {
        clearInterval(flowTransformer.t);
        layers.forEach(l => l.classList.remove('is-active'));
        flowTransformer.t = null;
      }
    }, 6000);
  }

  function animateTrainStages() {
    const stagesEl = stage.querySelectorAll('.tn-stage');
    if (!stagesEl.length) return;
    let i = 0;
    if (animateTrainStages.t) clearInterval(animateTrainStages.t);
    animateTrainStages.t = setInterval(() => {
      stagesEl.forEach((s, idx) => s.classList.toggle('is-active', idx === i));
      i = (i + 1) % stagesEl.length;
    }, 1400);
    setTimeout(() => {
      if (active !== 4 && animateTrainStages.t) {
        clearInterval(animateTrainStages.t);
        stagesEl.forEach(s => s.classList.remove('is-active'));
        animateTrainStages.t = null;
      }
    }, 8000);
  }

  // init: mark station 1 active
  stations[0]?.classList.add('is-active');
})();
