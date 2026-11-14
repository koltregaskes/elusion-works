import { PARAMS, TABS, SUBJECTS, PRESETS, formatValue } from './presets.js';

// Builds the control panel and preset bar from the PARAMS table, so adding a parameter
// is one line in presets.js and it appears, labelled and ranged, in the right tab.

export class StudioUI {
  constructor(handlers) {
    this.h = handlers;
    this.inputs = new Map();
    this.outputs = new Map();
    this.panel = document.querySelector('[data-panel-body]');
    this.tabsEl = document.querySelector('[data-tabs]');
    this.presetsEl = document.querySelector('[data-presets]');
    this.activeTab = 'wind';
    this.buildTabs();
    this.buildPanel();
    this.buildPresets();
    this.bindChrome();
  }

  buildTabs() {
    TABS.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wf-tab';
      b.textContent = t.label;
      b.dataset.tab = t.id;
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.showTab(t.id));
      this.tabsEl.append(b);
    });
  }

  buildPanel() {
    TABS.forEach((t) => {
      const pane = document.createElement('div');
      pane.className = 'wf-pane';
      pane.dataset.pane = t.id;
      pane.setAttribute('role', 'tabpanel');
      if (t.id === 'subject') pane.append(this.subjectPicker());
      let section = null;
      let sectionIndex = 0;
      PARAMS.filter((p) => p.tab === t.id).forEach((p) => {
        if (p.section !== section) {
          section = p.section;
          sectionIndex++;
          const h = document.createElement('div');
          h.className = 'wf-section';
          h.innerHTML = `<span>${p.section}</span><span class="wf-mono">0${sectionIndex}</span>`;
          pane.append(h);
        }
        pane.append(this.slider(p));
      });
      this.panel.append(pane);
    });
    this.showTab(this.activeTab);
  }

  subjectPicker() {
    const wrap = document.createElement('div');
    wrap.className = 'wf-subjects';
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-label', 'What stands in the middle');
    SUBJECTS.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wf-subject';
      b.dataset.subject = s.id;
      b.textContent = s.label;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => this.h.onSubject(s.id));
      wrap.append(b);
    });
    this.subjectWrap = wrap;
    const outer = document.createElement('div');
    outer.append(wrap);
    const drive = document.createElement('button');
    drive.type = 'button';
    drive.className = 'wf-drive';
    drive.dataset.drive = '';
    drive.innerHTML = '<span>Take the wheel</span><span class="wf-mono">T</span>';
    drive.setAttribute('aria-pressed', 'false');
    drive.hidden = true;
    drive.addEventListener('click', () => this.h.onDrive());
    outer.append(drive);
    this.driveButton = drive;
    return outer;
  }

  slider(def) {
    const row = document.createElement('label');
    row.className = 'wf-row';
    const top = document.createElement('span');
    top.className = 'wf-row-top';
    const name = document.createElement('span');
    name.textContent = def.label;
    const out = document.createElement('output');
    out.className = 'wf-mono';
    top.append(name, out);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = def.min;
    input.max = def.max;
    input.step = def.step;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      this.paintSlider(def, input, out, v);
      this.h.onChange(def.key, v);
    });
    row.append(top, input);
    this.inputs.set(def.key, input);
    this.outputs.set(def.key, out);
    return row;
  }

  paintSlider(def, input, out, v) {
    const p = ((v - def.min) / (def.max - def.min)) * 100;
    input.style.setProperty('--p', `${p}%`);
    out.textContent = formatValue(def, v);
  }

  sync(state) {
    PARAMS.forEach((def) => {
      const input = this.inputs.get(def.key);
      if (!input || document.activeElement === input) return;
      const v = state[def.key];
      input.value = v;
      this.paintSlider(def, input, this.outputs.get(def.key), v);
    });
    this.driveButton.hidden = state.subject !== 'combine';
    this.subjectWrap.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.subject === state.subject;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  showTab(id) {
    this.activeTab = id;
    this.tabsEl.querySelectorAll('.wf-tab').forEach((b) => {
      const on = b.dataset.tab === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    this.panel.querySelectorAll('.wf-pane').forEach((p) => {
      p.hidden = p.dataset.pane !== id;
    });
  }

  buildPresets() {
    PRESETS.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wf-preset';
      b.dataset.index = i;
      b.innerHTML = `<span class="wf-mono">0${i + 1}</span>${p.name}`;
      b.addEventListener('click', () => this.h.onPreset(i));
      this.presetsEl.append(b);
    });
  }

  setPreset(i) {
    const p = PRESETS[i];
    this.presetsEl.querySelectorAll('.wf-preset').forEach((b) => {
      const on = Number(b.dataset.index) === i;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelector('[data-preset-name]').textContent = p.name;
    const hero = document.querySelector('[data-hero]');
    hero.classList.add('is-swapping');
    clearTimeout(this.swapTimer);
    this.swapTimer = setTimeout(() => {
      document.querySelector('[data-eyebrow]').textContent = p.eyebrow;
      document.querySelector('[data-title]').textContent = p.title;
      document.querySelector('[data-sub]').textContent = p.sub;
      hero.classList.remove('is-swapping');
    }, 450);
  }

  bindChrome() {
    document.querySelector('[data-reset]').addEventListener('click', () => this.h.onReset());
    document.querySelector('[data-quality]').addEventListener('change', (e) => this.h.onQuality(e.target.value));
    document.querySelector('[data-toggle-panel]').addEventListener('click', () => {
      document.body.classList.toggle('panel-open');
      document.body.classList.toggle('panel-closed');
    });
    document.querySelector('[data-pause]').addEventListener('click', (e) => {
      const paused = this.h.onPause();
      e.currentTarget.setAttribute('aria-pressed', paused ? 'true' : 'false');
      e.currentTarget.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
    });
    document.querySelector('[data-sound]').addEventListener('click', (e) => {
      const on = this.h.onSound();
      e.currentTarget.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.querySelector('[data-camera]').addEventListener('click', () => this.h.onCamera());
    document.querySelector('[data-shot]').addEventListener('click', () => this.h.onShot());
    document.querySelector('[data-fullscreen]').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key.toLowerCase() === 'h') document.body.classList.toggle('ui-hidden');
      if (/^[1-8]$/.test(e.key)) this.h.onPreset(Number(e.key) - 1);
      if (e.key.toLowerCase() === 't') this.h.onDrive();
      if (e.key === ' ') {
        e.preventDefault();
        document.querySelector('[data-pause]').click();
      }
    });
  }

  setCameraMode(mode) {
    const b = document.querySelector('[data-camera]');
    b.setAttribute('aria-pressed', mode === 'cinematic' ? 'true' : 'false');
    b.title = mode === 'cinematic' ? 'Cinematic camera (F)' : 'Free camera, press F for cinematic';
  }

  setDriving(on) {
    this.driveButton.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.driveButton.querySelector('span').textContent = on ? 'Back to autopilot' : 'Take the wheel';
    document.body.classList.toggle('is-driving', on);
  }

  setQuality(q) {
    document.querySelector('[data-quality]').value = q;
  }

  setFps(fps) {
    document.querySelector('[data-fps]').textContent = `${Math.round(fps)} FPS`;
  }
}
