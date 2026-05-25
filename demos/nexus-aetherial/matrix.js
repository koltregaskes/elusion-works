/* ============================================================
   Matrix · radar + dial + bars + A/B model swap
   ============================================================ */
(function () {
  const data = window.NEXUS_DATA;
  // All axes available — see data.js
  const ALL_AXES = data.axes || [
    { id: 'reason',     label: 'REASON' },
    { id: 'context',    label: 'CTX' },
    { id: 'speed',      label: 'SPEED' },
    { id: 'cost',       label: 'COST' },
    { id: 'tools',      label: 'TOOLS' },
    { id: 'multimodal', label: 'M·MODAL' },
  ];
  // Default: pick 6
  const DEFAULT_ACTIVE = ['reason', 'code', 'context', 'speed', 'tools', 'multimodal'];
  let active = new Set(DEFAULT_ACTIVE);
  function AXES() { return ALL_AXES.filter(a => active.has(a.id)); }

  // initial selection
  let aId = 'gpt-5';
  let bId = 'claude-opus-4-5';

  /* ── populate the slot dropdowns ──────────────────────── */
  ['a','b'].forEach(slot => {
    const sel = document.querySelector(`select[data-select="${slot}"]`);
    sel.innerHTML = data.models.map(m =>
      `<option value="${m.id}">${m.name} ${m.version}</option>`
    ).join('');
    sel.value = slot === 'a' ? aId : bId;
    sel.addEventListener('change', () => {
      if (slot === 'a') aId = sel.value; else bId = sel.value;
      // avoid same model in both slots
      if (aId === bId) {
        const fallback = data.models.find(m => m.id !== sel.value);
        if (slot === 'a') { bId = fallback.id; document.querySelector('select[data-select="b"]').value = bId; }
        else              { aId = fallback.id; document.querySelector('select[data-select="a"]').value = aId; }
      }
      render();
    });
  });

  /* ── swap button ──────────────────────────────────────── */
  document.getElementById('swap-btn').addEventListener('click', () => {
    [aId, bId] = [bId, aId];
    document.querySelector('select[data-select="a"]').value = aId;
    document.querySelector('select[data-select="b"]').value = bId;
    render();
  });

  /* ── render helpers ───────────────────────────────────── */
  function modelById(id) { return data.models.find(m => m.id === id); }

  function statusTagClass(s) {
    return s === 'stable' ? 'sage' :
           s === 'training' ? 'copper' :
           s === 'experimental' ? 'burgundy' : '';
  }

  function fillSlot(slot, model) {
    const root = document.querySelector(`.matrix-slot[data-slot="${slot}"]`);
    root.querySelector('[data-bind="name"]').textContent = model.name;
    root.querySelector('[data-bind="version"]').textContent = model.version;
    root.querySelector('[data-bind="family"]').textContent = model.family.toUpperCase();
    const ctx = root.querySelector('[data-bind="context"]');
    ctx.textContent = model.contextK >= 1000 ? `${(model.contextK/1000).toFixed(1)}M CTX` : `${model.contextK}K CTX`;
    const st = root.querySelector('[data-bind="status"]');
    st.textContent = model.status.toUpperCase();
    st.className = `tag ${statusTagClass(model.status)}`;

    // legend
    const leg = document.querySelector(`[data-leg="${slot}"]`);
    if (leg) leg.textContent = model.name;
  }

  /* ── radar ────────────────────────────────────────────── */
  const radar = document.getElementById('radar');
  const R = 130;
  const cx = 0, cy = 0;
  function ptAt(value, axisIdx, total) {
    const a = -Math.PI/2 + axisIdx * (2*Math.PI / total);
    return [
      (value/100) * R * Math.cos(a),
      (value/100) * R * Math.sin(a),
    ];
  }

  function buildRadarBackground() {
    radar.innerHTML = '';
    const svgNS = 'http://www.w3.org/2000/svg';
    const frag = document.createDocumentFragment();
    const axes = AXES();
    const total = axes.length;
    if (total < 3) {
      // not enough axes for a polygon
      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('y', '6');
      text.setAttribute('font-family', 'JetBrains Mono');
      text.setAttribute('font-size', '12');
      text.setAttribute('fill', 'currentColor');
      text.setAttribute('opacity', '0.55');
      text.textContent = 'Pick at least 3 axes';
      frag.appendChild(text);
      radar.appendChild(frag);
      polyA = polyB = null;
      return;
    }
    // rings
    [0.25, 0.5, 0.75, 1].forEach(v => {
      const pts = axes.map((_, i) => ptAt(v*100, i, total).map(n => n.toFixed(1)).join(',')).join(' ');
      const p = document.createElementNS(svgNS, 'polygon');
      p.setAttribute('points', pts);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', '1');
      p.setAttribute('opacity', v === 1 ? '0.5' : '0.18');
      frag.appendChild(p);
    });
    // spokes + axis labels
    axes.forEach((ax, i) => {
      const [x, y] = ptAt(100, i, total);
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', '0'); line.setAttribute('y1', '0');
      line.setAttribute('x2', x.toFixed(1)); line.setAttribute('y2', y.toFixed(1));
      line.setAttribute('stroke', 'currentColor');
      line.setAttribute('stroke-width', '1'); line.setAttribute('opacity', '0.18');
      frag.appendChild(line);
      const [lx, ly] = ptAt(125, i, total);
      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', lx); text.setAttribute('y', ly);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-family', 'JetBrains Mono');
      text.setAttribute('font-size', '10');
      text.setAttribute('letter-spacing', '0.15em');
      text.setAttribute('fill', 'currentColor');
      text.setAttribute('opacity', '0.7');
      text.textContent = ax.label;
      frag.appendChild(text);
    });
    radar.appendChild(frag);
    polyA = polyB = null;
  }

  let polyA = null, polyB = null;
  function renderRadar(a, b) {
    buildRadarBackground();
    const axes = AXES();
    const total = axes.length;
    if (total < 3) return;
    const svgNS = 'http://www.w3.org/2000/svg';
    const ptsA = axes.map((ax, i) => ptAt(a.scores[ax.id] || 0, i, total).map(n => n.toFixed(1)).join(',')).join(' ');
    const ptsB = axes.map((ax, i) => ptAt(b.scores[ax.id] || 0, i, total).map(n => n.toFixed(1)).join(',')).join(' ');

    polyA = document.createElementNS(svgNS, 'polygon');
    polyA.setAttribute('fill', 'var(--ink)');
    polyA.setAttribute('fill-opacity', '0.12');
    polyA.setAttribute('stroke', 'var(--ink)');
    polyA.setAttribute('stroke-width', '2');
    polyA.setAttribute('stroke-linejoin', 'round');
    polyA.style.transition = 'all 520ms cubic-bezier(.22,1,.36,1)';
    radar.appendChild(polyA);

    polyB = document.createElementNS(svgNS, 'polygon');
    polyB.setAttribute('fill', 'var(--plasma)');
    polyB.setAttribute('fill-opacity', '0.18');
    polyB.setAttribute('stroke', 'var(--plasma)');
    polyB.setAttribute('stroke-width', '2');
    polyB.setAttribute('stroke-linejoin', 'round');
    polyB.style.transition = 'all 520ms cubic-bezier(.22,1,.36,1)';
    radar.appendChild(polyB);

    polyA.setAttribute('points', ptsA);
    polyB.setAttribute('points', ptsB);

    axes.forEach((ax, i) => {
      const [xa, ya] = ptAt(a.scores[ax.id] || 0, i, total);
      const [xb, yb] = ptAt(b.scores[ax.id] || 0, i, total);
      [['a', xa, ya, 'var(--ink)'], ['b', xb, yb, 'var(--plasma)']].forEach(([slot, x, y, col]) => {
        const c = document.createElementNS(svgNS, 'circle');
        c.setAttribute('cx', x.toFixed(1)); c.setAttribute('cy', y.toFixed(1));
        c.setAttribute('r', '4');
        c.setAttribute('fill', col);
        c.setAttribute('data-vertex', slot);
        radar.appendChild(c);
      });
    });
  }

  /* ── dial ─────────────────────────────────────────────── */
  const dial = document.getElementById('dial');
  function renderDial(value) {
    const svgNS = 'http://www.w3.org/2000/svg';
    dial.innerHTML = '';
    const size = 160, cx = size/2, cy = size/2, r = 64;
    const c = 2 * Math.PI * r;
    // track
    const track = document.createElementNS(svgNS, 'circle');
    track.setAttribute('cx', cx); track.setAttribute('cy', cy); track.setAttribute('r', r);
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', 'var(--paper-3)');
    track.setAttribute('stroke-width', '10');
    dial.appendChild(track);
    // ticks every 10%
    for (let i = 0; i < 20; i++) {
      const a = -Math.PI/2 + i * (2*Math.PI/20);
      const x1 = cx + (r + 8) * Math.cos(a);
      const y1 = cy + (r + 8) * Math.sin(a);
      const x2 = cx + (r + 14) * Math.cos(a);
      const y2 = cy + (r + 14) * Math.sin(a);
      const t = document.createElementNS(svgNS, 'line');
      t.setAttribute('x1', x1); t.setAttribute('y1', y1);
      t.setAttribute('x2', x2); t.setAttribute('y2', y2);
      t.setAttribute('stroke', 'currentColor');
      t.setAttribute('stroke-width', '1');
      t.setAttribute('opacity', i % 5 === 0 ? '0.6' : '0.22');
      dial.appendChild(t);
    }
    // fill
    const fill = document.createElementNS(svgNS, 'circle');
    fill.setAttribute('cx', cx); fill.setAttribute('cy', cy); fill.setAttribute('r', r);
    fill.setAttribute('fill', 'none');
    fill.setAttribute('stroke', 'var(--copper)');
    fill.setAttribute('stroke-width', '10');
    fill.setAttribute('stroke-linecap', 'round');
    fill.setAttribute('stroke-dasharray', c);
    fill.setAttribute('stroke-dashoffset', c - (value/100) * c);
    fill.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    fill.style.transition = 'stroke-dashoffset 620ms cubic-bezier(.22,1,.36,1)';
    dial.appendChild(fill);
    // text
    const num = document.createElementNS(svgNS, 'text');
    num.setAttribute('x', cx); num.setAttribute('y', cy + 4);
    num.setAttribute('text-anchor', 'middle');
    num.setAttribute('dominant-baseline', 'middle');
    num.setAttribute('font-family', "'Fraunces', serif");
    num.setAttribute('font-weight', '500');
    num.setAttribute('font-size', '38');
    num.setAttribute('fill', 'currentColor');
    num.textContent = Math.round(value);
    dial.appendChild(num);
    const lbl = document.createElementNS(svgNS, 'text');
    lbl.setAttribute('x', cx); lbl.setAttribute('y', cy + 26);
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('font-family', 'IBM Plex Mono');
    lbl.setAttribute('font-size', '9');
    lbl.setAttribute('letter-spacing', '0.25em');
    lbl.setAttribute('fill', 'currentColor');
    lbl.setAttribute('opacity', '0.55');
    lbl.textContent = 'OF 100';
    dial.appendChild(lbl);
  }

  /* ── bars ─────────────────────────────────────────────── */
  const BAR_AXES = [
    { id: 'reason',  label: 'REASONING' },
    { id: 'context', label: 'CONTEXT' },
    { id: 'speed',   label: 'SPEED' },
    { id: 'cost',    label: 'COST EFFICIENCY' },
  ];

  function renderBars(a, b) {
    const bars = document.getElementById('bars');
    bars.innerHTML = BAR_AXES.map(ax => {
      const va = a.scores[ax.id], vb = b.scores[ax.id];
      const winnerCopper = vb >= va; // copper highlight when B wins
      return `
      <div class="bar" data-axis="${ax.id}">
        <div class="bar-head">
          <span class="axis">${ax.label}</span>
          <span class="nums tabular">
            <b>${va}</b>
            <span style="color:var(--ink-faint);margin:0 6px">·</span>
            <span class="copper">${vb}</span>
          </span>
        </div>
        <div class="bar-track">
          <div class="scale"></div>
          <div class="bar-fill a" style="width:${va}%"></div>
          <div class="bar-fill b" style="width:${vb}%"></div>
        </div>
      </div>`;
    }).join('');
  }

  /* ── verdict / dial labels ────────────────────────────── */
  function renderVerdict(a, b) {
    // value ratio = reasoning / cost-per-million; normalize to 0..100 over the field
    const score = m => m.scores.reason / m.costPerM;
    const all = data.models.map(score);
    const max = Math.max(...all);
    const aScore = (score(a) / max) * 100;
    const bScore = (score(b) / max) * 100;
    const winner = aScore >= bScore ? 'A' : 'B';
    const lead = Math.abs(aScore - bScore);
    const leader = winner === 'A' ? a : b;
    const loser = winner === 'A' ? b : a;

    renderDial(Math.round(Math.max(aScore, bScore)));

    document.getElementById('dial-winner').textContent =
      `${winner} LEADS · +${lead.toFixed(0)}%`;
    document.getElementById('dial-verdict').innerHTML =
      `<b>${leader.name}</b> offers <b>${Math.round((leader.scores.reason / (leader.costPerM * 12))*100)}%</b> reasoning capacity per dollar — <b>${(lead).toFixed(0)}%</b> ahead of ${loser.name}.`;
    document.getElementById('cost-a').textContent = `$${a.costPerM.toFixed(2)}`;
    document.getElementById('cost-b').textContent = `$${b.costPerM.toFixed(2)}`;
    const rd = b.scores.reason - a.scores.reason;
    const rdEl = document.getElementById('reason-delta');
    rdEl.textContent = (rd >= 0 ? '+' : '') + rd;
    rdEl.style.color = rd >= 0 ? 'var(--copper)' : 'var(--ink)';
  }

  /* ── one render pass ──────────────────────────────────── */
  function render() {
    const a = modelById(aId), b = modelById(bId);
    fillSlot('a', a);
    fillSlot('b', b);
    renderRadar(a, b);
    renderBars(a, b);
    renderVerdict(a, b);
  }

  buildRadarBackground();
  buildAxisToggles();
  render();

  // expose for cabinet (so clicking a drawer can load into matrix)
  window.NEXUS_MATRIX = {
    setA: (id) => { aId = id; document.querySelector('select[data-select="a"]').value = id; render(); },
    setB: (id) => { bId = id; document.querySelector('select[data-select="b"]').value = id; render(); },
  };

  /* ── axis toggles ────────────────────────────────────── */
  function buildAxisToggles() {
    const row = document.getElementById('axis-toggles-row');
    if (!row) return;
    row.innerHTML = ALL_AXES.map(ax => `
      <button class="axis-pill" data-axis="${ax.id}" aria-pressed="${active.has(ax.id) ? 'true' : 'false'}" title="${ax.desc || ''}">
        <span class="dot"></span>${ax.label}
      </button>
    `).join('');
    row.addEventListener('click', e => {
      const b = e.target.closest('.axis-pill');
      if (!b) return;
      const id = b.dataset.axis;
      if (active.has(id)) {
        if (active.size > 1) active.delete(id);
      } else {
        active.add(id);
      }
      b.setAttribute('aria-pressed', active.has(id) ? 'true' : 'false');
      render();
    }, { once: false });
    const reset = document.getElementById('axis-reset');
    if (reset) reset.addEventListener('click', () => {
      active = new Set(DEFAULT_ACTIVE);
      row.querySelectorAll('.axis-pill').forEach(p =>
        p.setAttribute('aria-pressed', active.has(p.dataset.axis) ? 'true' : 'false')
      );
      render();
    });
  }
})();
