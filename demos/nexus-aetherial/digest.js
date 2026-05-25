/* ============================================================
   Digest · sortable benchmark table + rail filter
   ============================================================ */
(function () {
  const data = window.NEXUS_DATA;
  const suiteList = document.getElementById('suite-list');
  const statusList = document.getElementById('status-list');
  const tbl = document.getElementById('digest-table');
  const thead = tbl.querySelector('thead');
  const tbody = tbl.querySelector('tbody');
  const meta = document.getElementById('digest-meta');
  const searchEl = document.getElementById('digest-search');
  const viewSeg = document.querySelector('[data-tweak="digest-view"]');

  let activeSuite = 'mmlu';
  let activeStatus = 'all';
  let sortCol = 'score';
  let sortDir = 'desc';
  let view = 'suite';
  let query = '';

  // status counts
  function counts() {
    return data.models.reduce((m, x) => {
      m[x.status] = (m[x.status] || 0) + 1; m.all++; return m;
    }, { all: 0 });
  }

  // populate suite rail
  suiteList.innerHTML = data.benchSuites.map(s => `
    <button class="rail-item" data-suite="${s.id}" aria-selected="${s.id === activeSuite}">
      ${s.name} <span class="n">${s.n.toLocaleString()}</span>
    </button>
  `).join('');

  // status counts into the list
  (function fillStatus() {
    const c = counts();
    statusList.querySelectorAll('.rail-item').forEach(b => {
      const s = b.dataset.status;
      const n = b.querySelector('.n');
      n.textContent = (s === 'all' ? c.all : (c[s] || 0));
    });
  })();

  /* ── header rendering ─────────────────────────────────── */
  function suiteHeaderCols() {
    return [
      { id: 'model',  label: 'MODEL',   align: 'left' },
      { id: 'family', label: 'FAMILY',  align: 'left' },
      { id: 'score',  label: data.benchSuites.find(s => s.id === activeSuite).name, align: 'left' },
      { id: 'reason', label: 'REASON',  align: 'left' },
      { id: 'cost',   label: '$/1M',    align: 'left' },
      { id: 'ctx',    label: 'CTX',     align: 'left' },
      { id: 'delta',  label: 'Δ 30D',   align: 'left' },
      { id: 'date',   label: 'UPDATED', align: 'left' },
    ];
  }
  function allHeaderCols() {
    return [
      { id: 'model',  label: 'MODEL' },
      { id: 'family', label: 'FAMILY' },
      { id: 'mmlu',   label: 'MMLU-PRO' },
      { id: 'gpqa',   label: 'GPQA' },
      { id: 'swe',    label: 'SWE-B' },
      { id: 'tau',    label: 'TAU-B' },
      { id: 'math',   label: 'MATH' },
      { id: 'reason', label: 'REASON' },
    ];
  }

  function renderHead() {
    const cols = view === 'suite' ? suiteHeaderCols() : allHeaderCols();
    thead.innerHTML = `<tr>${cols.map(c => {
      const arrow = (sortCol === c.id)
        ? `<span class="sort">▾</span>`
        : `<span class="sort">▾</span>`;
      const aria = sortCol === c.id
        ? (sortDir === 'desc' ? 'descending' : 'ascending')
        : 'none';
      return `<th data-col="${c.id}" aria-sort="${aria}">${c.label}${c.id !== 'model' && c.id !== 'family' && c.id !== 'date' ? arrow : ''}</th>`;
    }).join('')}</tr>`;
  }

  /* ── row computation ──────────────────────────────────── */
  function rowData(m) {
    return {
      id: m.id,
      model: m.name,
      version: m.version,
      family: m.family,
      score: m.benchmarks[activeSuite],
      mmlu: m.benchmarks.mmlu,
      gpqa: m.benchmarks.gpqa,
      swe: m.benchmarks.swe,
      tau: m.benchmarks.tau,
      math: m.benchmarks.math,
      reason: m.scores.reason,
      cost: m.costPerM,
      ctx: m.contextK,
      delta: m.delta30d,
      date: m.releaseDate,
      status: m.status,
    };
  }

  function sortRows(rows) {
    const dir = sortDir === 'desc' ? -1 : 1;
    return rows.slice().sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      if (typeof va === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }

  function filterRows(rows) {
    return rows.filter(r => {
      if (activeStatus !== 'all' && r.status !== activeStatus) return false;
      if (query && !`${r.model} ${r.version} ${r.family}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }

  function ctxStr(k) { return k >= 1000 ? `${(k/1000).toFixed(1)}M` : `${k}K`; }

  function renderBody() {
    const rows = sortRows(filterRows(data.models.map(rowData)));
    const maxBench = view === 'suite'
      ? Math.max(...rows.map(r => r.score))
      : 100;

    if (view === 'suite') {
      tbody.innerHTML = rows.map((r, i) => {
        const isLead = i === 0;
        const pct = (r.score / maxBench) * 100;
        return `
        <tr data-id="${r.id}">
          <td class="model-cell">${r.model} <span class="v">${r.version}</span></td>
          <td>${r.family.toUpperCase()}</td>
          <td class="num ${isLead ? 'lead' : ''}">${r.score.toFixed(1)}<span class="mini-bar" style="--w:${pct}%"></span></td>
          <td class="num">${r.reason}</td>
          <td class="num">$${r.cost.toFixed(2)}</td>
          <td class="num">${ctxStr(r.ctx)}</td>
          <td class="delta ${r.delta >= 0 ? 'pos' : 'neg'} num">${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(1)}</td>
          <td>${r.date}</td>
        </tr>`;
      }).join('');
    } else {
      tbody.innerHTML = rows.map(r => `
        <tr data-id="${r.id}">
          <td class="model-cell">${r.model} <span class="v">${r.version}</span></td>
          <td>${r.family.toUpperCase()}</td>
          <td class="num">${r.mmlu.toFixed(1)}</td>
          <td class="num">${r.gpqa.toFixed(1)}</td>
          <td class="num">${r.swe.toFixed(1)}</td>
          <td class="num">${r.tau.toFixed(1)}</td>
          <td class="num">${r.math.toFixed(1)}</td>
          <td class="num">${r.reason}</td>
        </tr>`).join('');
    }

    const suite = data.benchSuites.find(s => s.id === activeSuite);
    meta.textContent = view === 'suite'
      ? `${rows.length} MODELS · ${suite.name} · UPDATED 06:21 UTC`
      : `${rows.length} MODELS · ALL SUITES · UPDATED 06:21 UTC`;
  }

  function render() {
    renderHead();
    renderBody();
  }

  /* ── interactions ─────────────────────────────────────── */
  suiteList.addEventListener('click', e => {
    const b = e.target.closest('[data-suite]');
    if (!b) return;
    activeSuite = b.dataset.suite;
    suiteList.querySelectorAll('.rail-item').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    sortCol = 'score'; sortDir = 'desc';
    if (view !== 'suite') {
      view = 'suite';
      viewSeg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.val === 'suite' ? 'true' : 'false'));
    }
    render();
  });

  statusList.addEventListener('click', e => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    activeStatus = b.dataset.status;
    statusList.querySelectorAll('.rail-item').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    render();
  });

  thead.addEventListener('click', e => {
    const th = e.target.closest('th');
    if (!th) return;
    const col = th.dataset.col;
    if (col === 'model' || col === 'family' || col === 'date') {
      // string-sortable
      if (sortCol === col) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
      else { sortCol = col; sortDir = 'asc'; }
    } else {
      if (sortCol === col) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
      else { sortCol = col; sortDir = 'desc'; }
    }
    render();
  });

  viewSeg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    view = b.dataset.val;
    viewSeg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    sortCol = view === 'suite' ? 'score' : 'mmlu'; sortDir = 'desc';
    render();
  });

  searchEl.addEventListener('input', () => {
    query = searchEl.value.trim().toLowerCase();
    renderBody();
  });

  // initial select first suite item
  const first = suiteList.querySelector(`[data-suite="${activeSuite}"]`);
  if (first) first.setAttribute('aria-selected', 'true');
  render();

  // click row → load into matrix as model A
  tbody.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    if (window.NEXUS_MATRIX) window.NEXUS_MATRIX.setA(tr.dataset.id);
    document.getElementById('matrix').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();
