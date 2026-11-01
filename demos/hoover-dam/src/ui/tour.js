// Self-driving tour. A ghost cursor walks to each control and presses it.
// Any real click, drag, wheel or key hands control to the visitor; after 25 s of
// quiet the tour comes back.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Tour {
  constructor(app) {
    this.app = app;
    this.ghost = document.getElementById('ghost');
    this.cap = document.getElementById('tourCap');
    this.text = document.getElementById('tourText');
    this.running = false;
    this.token = 0;
    this.idleMs = 25000;
    this.lastInput = performance.now();
    this.enabled = true;
    const stop = (e) => { if (e.isTrusted) this.interrupt(); };
    ['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach((t) => window.addEventListener(t, stop, { capture: true, passive: true }));
    setInterval(() => {
      if (!this.running && this.enabled && performance.now() - this.lastInput > this.idleMs && this.inView()) this.start();
    }, 1000);
  }

  inView() { const r = document.getElementById('stage').getBoundingClientRect(); return r.bottom > window.innerHeight * 0.6 && !document.hidden; }

  interrupt() {
    this.lastInput = performance.now();
    if (!this.running) return;
    this.running = false; this.token++;
    this.ghost.hidden = true; this.cap.hidden = true;
    this.app.onTourState(false);
  }

  async moveTo(el, tok, dx = 0, dy = 0) {
    if (tok !== this.token) throw 0;
    let x, y;
    if (Array.isArray(el)) [x, y] = el;
    else { const r = el.getBoundingClientRect(); x = r.left + r.width / 2 + dx; y = r.top + r.height / 2 + dy; }
    this.ghost.style.transform = `translate(${x}px, ${y}px)`;
    await sleep(950);
    if (tok !== this.token) throw 0;
    return [x, y];
  }
  async press(el, tok) {
    await this.moveTo(el, tok);
    this.ghost.classList.remove('click'); void this.ghost.offsetWidth; this.ghost.classList.add('click');
    el.click();
    this.app.audio.click();
    await sleep(350);
  }
  async drag(input, from, to, ms, tok) {
    const r = input.getBoundingClientRect();
    const min = +input.min, max = +input.max;
    const px = (v) => r.left + (v - min) / (max - min) * r.width;
    await this.moveTo([px(from), r.top + r.height / 2], tok);
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (tok !== this.token) throw 0;
      const k = (performance.now() - t0) / ms;
      const v = from + (to - from) * (k * k * (3 - 2 * k));
      input.value = v; input.dispatchEvent(new Event('input', { bubbles: true }));
      this.ghost.style.transition = 'none';
      this.ghost.style.transform = `translate(${px(v)}px, ${r.top + r.height / 2}px)`;
      await sleep(30);
    }
    this.ghost.style.transition = '';
  }
  async say(t, ms, tok) { if (tok !== this.token) throw 0; this.text.textContent = t; await sleep(ms); if (tok !== this.token) throw 0; }

  async start() {
    if (this.running) return;
    this.running = true;
    const tok = ++this.token;
    const a = this.app, $ = (s) => document.querySelector(s);
    a.onTourState(true);
    this.ghost.hidden = false; this.cap.hidden = false;
    this.ghost.style.transform = `translate(${window.innerWidth / 2}px, ${window.innerHeight / 2}px)`;
    try {
      while (tok === this.token) {
        a.tab('operate'); a.setMode('normal'); a.setFocus(null);
        a.engine.flyTo('overview', 2.4);
        await this.say('Hoover Dam in Black Canyon. Lake Mead behind it, the Colorado River below.', 2600, tok);
        await this.press($('[data-scn="peak"]'), tok);
        a.engine.flyTo('powerhouse', 2.2);
        await this.say('Summer peak: all 17 units on. Together they can make about 2,000 MW at a full lake.', 3200, tok);
        await this.drag($('#hour'), 17.5, 20.6, 2400, tok);
        await this.say('Dusk. The powerhouse lights come up and demand stays high.', 2000, tok);
        await this.press($('[data-tab="view"]'), tok);
        await this.press($('[data-mode="xray"]'), tok);
        a.engine.flyTo('xray', 2.2);
        await this.say('X-ray: the rock turns to glass. Water drops from the intake towers through 30 ft penstocks to the turbines.', 3800, tok);
        await this.press($('[data-mode="normal"]'), tok);
        await this.press($('[data-tab="operate"]'), tok);
        await this.press($('[data-scn="drought"]'), tok);
        a.engine.flyTo('upstream', 2.2);
        await this.say('2022 drought. The white bathtub ring shows how far Lake Mead has fallen.', 3000, tok);
        const handle = $('#railHandle');
        await this.moveTo(handle, tok);
        await a.tourDragLake(1041, 1215, 2600, (x, y) => { this.ghost.style.transition = 'none'; this.ghost.style.transform = `translate(${x}px, ${y}px)`; }, () => tok !== this.token);
        this.ghost.style.transition = '';
        await this.say('Raise the lake and every unit gains head. Same water, more power.', 2600, tok);
        await this.press($('[data-scn="flood"]'), tok);
        a.engine.flyTo('spillway', 2.2);
        await this.say('1983 flood. Inflow is far beyond what the turbines can pass, and the lake climbs toward the crest.', 3000, tok);
        await this.drag($('#drum'), 1, 0, 1800, tok);
        await this.say('Drum gates down: the spillways open and floodwater drops into 50 ft tunnels around the dam.', 3600, tok);
        await this.press($('[data-tab="view"]'), tok);
        await this.press($('[data-mode="pressure"]'), tok);
        a.engine.flyTo('pressure', 2);
        await this.say('Pressure view. Water pushes about 1 psi harder for every 2.3 ft of depth.', 3200, tok);
        await this.press($('[data-mode="section"]'), tok);
        a.engine.flyTo('section', 2.2);
        await this.say('Section through the crown: 45 ft thick at the top, 660 ft at the base.', 3400, tok);
        await this.press($('[data-mode="normal"]'), tok);
        a.engine.flyTo('upstream', 2);
        await sleep(2100);
        for (let i = 0; i < 3; i++) {
          const pt = a.lakeScreenPoint(-80 + i * 70, -340 - i * 60);
          if (pt) { await this.moveTo([pt.x, pt.y], tok); this.ghost.classList.remove('click'); void this.ghost.offsetWidth; this.ghost.classList.add('click'); a.engine.splash(pt.wx, pt.wz, 1.4); a.audio.splash(); }
          await sleep(500);
        }
        await this.say('Click the lake anywhere. The waves reflect off the dam and the canyon walls.', 2600, tok);
        await this.press($('[data-mode="build"]'), tok);
        a.engine.flyTo('overview', 2);
        await this.drag($('#year'), 1931.3, 1936.8, 7000, tok);
        await this.say('1931 to 1936: diversion tunnels, cofferdams, then columns of concrete rising in 5 ft lifts.', 2000, tok);
        await this.press($('[data-mode="normal"]'), tok);
        await this.press($('[data-tab="operate"]'), tok);
        await this.press($('[data-scn="normal"]'), tok);
        await this.say('Your turn. Drag, click, break it. The tour comes back after 25 seconds of quiet.', 3200, tok);
      }
    } catch (e) { if (e !== 0) console.error(e); }
  }
}
