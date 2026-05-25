/* ============================================================
   Cabinet · expandable drawer rows
   ============================================================ */
(function () {
  const data = window.NEXUS_DATA;
  const host = document.getElementById('cabinet-rows');
  if (!host) return;

  const statusTag = (s) => {
    const klass = s === 'stable' ? 'sage' : s === 'training' ? 'copper' : 'burgundy';
    return `<span class="tag ${klass}"><span class="dot"></span>${s.toUpperCase()}</span>`;
  };

  const ctxLabel = (k) => k >= 1000 ? `${(k/1000).toFixed(1)}M` : `${k}K`;

  const benchMax = {
    mmlu: 100, gpqa: 100, swe: 100, tau: 100, math: 100,
  };

  function rowHTML(m, i) {
    return `
      <article class="drawer" data-id="${m.id}">
        <button class="drawer-head" aria-expanded="false">
          <span class="num">#0${i+1}</span>
          <div class="ident">
            <div class="name">${m.name} <span class="v">${m.version}</span></div>
            <div class="fam">${m.family}</div>
          </div>
          <div class="summary">${m.summary}</div>
          <div class="stats">
            <div class="stat"><span class="k">REASON</span><span class="v">${m.scores.reason}</span></div>
            <div class="stat"><span class="k">CONTEXT</span><span class="v">${ctxLabel(m.contextK)}</span></div>
            <div class="stat"><span class="k">$/1M</span><span class="v">$${m.costPerM.toFixed(2)}</span></div>
          </div>
          <div>${statusTag(m.status)}</div>
          <span class="chev" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14m-7-7h14"/></svg>
          </span>
        </button>

        <div class="drawer-body">
          <div class="drawer-body-inner">
            <div class="drawer-pad">
              <div>
                <h4>Dossier · ${m.name} ${m.version}</h4>
                <p>${m.summary} The model is currently <b>${m.status.toUpperCase()}</b>${m.status !== 'stable' ? ' — recommended for evaluation rather than production routing.' : ' and recommended for production routing.'}</p>
                <div class="spec-grid">
                  <div class="spec"><span class="k">FAMILY</span><span class="v">${m.family}</span></div>
                  <div class="spec"><span class="k">PARAMETERS</span><span class="v">${m.params}</span></div>
                  <div class="spec"><span class="k">CONTEXT</span><span class="v">${ctxLabel(m.contextK)} tokens</span></div>
                  <div class="spec"><span class="k">THROUGHPUT</span><span class="v">${m.tps} tok/s</span></div>
                  <div class="spec"><span class="k">COST · INPUT</span><span class="v">$${m.costPerM.toFixed(2)} / 1M</span></div>
                  <div class="spec"><span class="k">RELEASE</span><span class="v">${m.releaseDate}</span></div>
                  <div class="spec" style="grid-column:span 2">
                    <span class="k">MODALITY</span>
                    <span class="modal-list">${m.modality.map(x => `<span class="tag">${x.toUpperCase()}</span>`).join('')}</span>
                  </div>
                </div>
                <div class="row gap-3" style="margin-top:18px">
                  <button class="btn primary" data-act="load-a">↳ LOAD AS MODEL A</button>
                  <button class="btn" data-act="load-b">↳ LOAD AS MODEL B</button>
                </div>
              </div>
              <div class="bench-side">
                <h4>Benchmark profile</h4>
                ${Object.entries(m.benchmarks).map(([k, v]) => {
                  const suite = data.benchSuites.find(s => s.id === k);
                  return `
                    <div class="bench-row">
                      <span class="name">${suite ? suite.name : k.toUpperCase()}</span>
                      <span class="meter"><span class="fill" style="--w:${(v/100)*100}%"></span></span>
                      <span class="val tabular">${v}</span>
                    </div>`;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
      </article>`;
  }

  host.innerHTML = data.models.map(rowHTML).join('');

  // expand/collapse — single open at a time
  host.addEventListener('click', (e) => {
    const head = e.target.closest('.drawer-head');
    if (head) {
      // don't trigger when clicking action buttons inside body
      if (e.target.closest('[data-act]')) return;
      const drawer = head.parentElement;
      const wasOpen = drawer.classList.contains('open');
      host.querySelectorAll('.drawer.open').forEach(d => {
        d.classList.remove('open');
        d.querySelector('.drawer-head').setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        drawer.classList.add('open');
        head.setAttribute('aria-expanded', 'true');
      }
      return;
    }

    // load buttons
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) {
      const id = actBtn.closest('.drawer').dataset.id;
      const act = actBtn.dataset.act;
      if (act === 'load-a' && window.NEXUS_MATRIX) window.NEXUS_MATRIX.setA(id);
      if (act === 'load-b' && window.NEXUS_MATRIX) window.NEXUS_MATRIX.setB(id);
      // scroll to matrix
      document.getElementById('matrix').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // open the first drawer for visual interest
  const first = host.querySelector('.drawer');
  if (first) {
    first.classList.add('open');
    first.querySelector('.drawer-head').setAttribute('aria-expanded', 'true');
  }
})();
