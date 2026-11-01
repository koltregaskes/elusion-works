// Procedural sound: river roar, spillway rush, transformer hum, splashes, clicks.
// Off until the visitor turns it on.
export class Audio {
  constructor() { this.on = false; this.ctx = null; }

  init() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination); this.master = master;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    this.brown = buf;
    const wbuf = ctx.createBuffer(1, len, ctx.sampleRate), wd = wbuf.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    this.white = wbuf;
    const loop = (b, f, type, q) => {
      const s = ctx.createBufferSource(); s.buffer = b; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(fl).connect(g).connect(master); s.start();
      return { g, fl };
    };
    this.roar = loop(this.brown, 420, 'lowpass', 0.7);
    this.rush = loop(this.white, 900, 'bandpass', 0.6);
    const hum = ctx.createOscillator(); hum.frequency.value = 120; hum.type = 'sine';
    const hum2 = ctx.createOscillator(); hum2.frequency.value = 240; hum2.type = 'sine';
    this.humG = ctx.createGain(); this.humG.gain.value = 0;
    hum.connect(this.humG); hum2.connect(this.humG); this.humG.connect(master); hum.start(); hum2.start();
  }

  toggle() {
    this.on = !this.on;
    if (this.on && !this.ctx) this.init();
    if (this.ctx) (this.on ? this.ctx.resume() : this.ctx.suspend());
    return this.on;
  }

  update(out, camDist) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    const near = Math.max(0.15, Math.min(1, 700 / camDist));
    this.roar.g.gain.setTargetAtTime(Math.min(0.5, 0.04 + (out.totalQ || 0) / 90000) * near, t, 0.4);
    this.roar.fl.frequency.setTargetAtTime(260 + Math.min(900, (out.totalQ || 0) / 80), t, 0.4);
    this.rush.g.gain.setTargetAtTime(Math.min(0.35, (out.spillQ || 0) / 300000) * near, t, 0.3);
    this.humG.gain.setTargetAtTime(Math.min(0.03, (out.running || 0) * 0.0018) * near, t, 0.5);
  }

  splash(power = 1) {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.white;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * power, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 * power);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.8);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + 1.2 * power);
  }

  click() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.frequency.value = 1800; o.type = 'triangle';
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.06);
  }
}
