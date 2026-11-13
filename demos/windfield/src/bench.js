// ?bench: a one-click frame-rate test for real hardware. It steps through every quality
// level, lets each settle, measures it, then shows a card with the numbers, a
// recommendation, and a one-line summary to copy and paste back.

const LEVELS = ['low', 'medium', 'high', 'ultra'];
const WARM_MS = 2000;
const MEASURE_MS = 5000;
const SMOOTH_FPS = 50;
const PLAYABLE_FPS = 32;
const fmt = (v) => (v < 10 ? v.toFixed(1) : String(Math.round(v)));

export class Bench {
  constructor({ setQuality, renderer, getQuality }) {
    this.setQuality = setQuality;
    this.getQuality = getQuality;
    this.renderer = renderer;
    this.results = [];
    this.index = -1;
    this.phase = 'idle';
    // Browsers stop animation frames in a hidden tab, so the frame after returning
    // would carry the whole hidden gap. Restart the current level's warm-up whenever
    // visibility changes, and let the next frame set the clock.
    document.addEventListener('visibilitychange', () => {
      if (this.phase === 'warm' || this.phase === 'measure') {
        this.phase = 'warm';
        this.phaseStart = null;
        this.frames = [];
      }
    });
    this.banner = document.createElement('div');
    this.banner.className = 'wf-bench-banner wf-mono';
    this.banner.setAttribute('role', 'status');
    document.body.append(this.banner);
  }

  start(now) {
    this.next(now);
  }

  next(now) {
    this.index++;
    if (this.index >= LEVELS.length) {
      this.finish();
      return;
    }
    const q = LEVELS[this.index];
    this.setQuality(q);
    this.phase = 'warm';
    this.phaseStart = now;
    this.frames = [];
    this.last = now;
    this.banner.textContent = `Benchmark: ${q} (${this.index + 1} of ${LEVELS.length})`;
  }

  onFrame(now) {
    if (this.phase === 'idle' || this.phase === 'done') return;
    if (this.phaseStart === null) {
      this.phaseStart = now;
      this.last = now;
      return;
    }
    const dt = now - this.last;
    this.last = now;
    if (this.phase === 'warm') {
      if (now - this.phaseStart >= WARM_MS) {
        this.phase = 'measure';
        this.phaseStart = now;
        this.frames = [];
      }
      return;
    }
    this.frames.push(dt);
    if (now - this.phaseStart >= MEASURE_MS && this.frames.length >= 3) {
      const total = this.frames.reduce((a, b) => a + b, 0);
      const sorted = [...this.frames].sort((a, b) => a - b);
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || total;
      this.results.push({
        level: LEVELS[this.index],
        fps: this.frames.length / (total / 1000),
        low: 1000 / p95,
        frames: this.frames.length,
      });
      this.next(now);
    }
  }

  gpuName() {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)).slice(0, 120);
    } catch {
      return 'unknown GPU';
    }
  }

  finish() {
    this.phase = 'done';
    this.banner.remove();
    const smooth = this.results.filter((r) => r.fps >= SMOOTH_FPS).map((r) => r.level);
    const playable = this.results.filter((r) => r.fps >= PLAYABLE_FPS).map((r) => r.level);
    const pick = smooth.at(-1) || playable.at(-1) || 'low';
    const verdict = smooth.length ? 'smooth' : playable.length ? 'playable' : 'struggling';
    const size = `${window.innerWidth}x${window.innerHeight}@${(window.devicePixelRatio || 1).toFixed(2)}`;
    const line = `Windfield bench: ${this.results.map((r) => `${r.level} ${fmt(r.fps)}`).join(' / ')} fps, recommend ${pick} (${verdict}), ${this.gpuName()}, ${size}`;
    this.summary = { results: this.results, pick, verdict, line };
    window.__windfieldBench = this.summary;
    this.setQuality(pick);
    this.showCard();
  }

  showCard() {
    const { results, pick, verdict, line } = this.summary;
    const card = document.createElement('section');
    card.className = 'wf-bench-card';
    card.setAttribute('aria-label', 'Benchmark result');
    const rows = results
      .map((r) => `<tr${r.level === pick ? ' class="is-pick"' : ''}><td>${r.level}</td><td>${fmt(r.fps)}</td><td>${fmt(r.low)}</td></tr>`)
      .join('');
    card.innerHTML = `
      <span class="wf-eyebrow wf-mono">Benchmark</span>
      <h2>${verdict === 'struggling' ? 'This machine finds it heavy.' : `${pick[0].toUpperCase()}${pick.slice(1)} runs ${verdict}.`}</h2>
      <table>
        <thead><tr><th>Quality</th><th>Average fps</th><th>Slow frames</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="wf-bench-line wf-mono"></p>
      <div class="wf-bench-actions">
        <button type="button" data-copy>Copy result</button>
        <button type="button" data-close>Close</button>
      </div>`;
    card.querySelector('.wf-bench-line').textContent = line;
    const copyButton = card.querySelector('[data-copy]');
    // Keep the button reference: event.currentTarget is cleared once dispatch ends,
    // which is before the clipboard promise settles.
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(line);
        copyButton.textContent = 'Copied';
      } catch {
        copyButton.textContent = 'Select the line above to copy';
      }
    });
    card.querySelector('[data-close]').addEventListener('click', () => card.remove());
    document.body.append(card);
  }
}
