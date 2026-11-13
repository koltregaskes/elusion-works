// Synthesised wind: filtered noise whose level and brightness follow the gust passing over
// the camera, plus soft rain hiss and a low crackle when the bonfire is lit. Off by default;
// browsers only allow audio after a click anyway.

export class WindAudio {
  constructor() {
    this.ctx = null;
    this.on = false;
  }

  start() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const ctx = new AC();
      this.ctx = ctx;
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        // Brown-ish noise: smoother, more like air than hiss.
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
      const white = ctx.createBuffer(1, len, ctx.sampleRate);
      const wd = white.getChannelData(0);
      for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'bandpass';
      this.filter.Q.value = 0.7;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      src.connect(this.filter).connect(this.windGain);

      const rainSrc = ctx.createBufferSource();
      rainSrc.buffer = white;
      rainSrc.loop = true;
      const rainF = ctx.createBiquadFilter();
      rainF.type = 'highpass';
      rainF.frequency.value = 2500;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      rainSrc.connect(rainF).connect(this.rainGain);

      const fireSrc = ctx.createBufferSource();
      fireSrc.buffer = white;
      fireSrc.loop = true;
      const fireF = ctx.createBiquadFilter();
      fireF.type = 'bandpass';
      fireF.frequency.value = 1800;
      fireF.Q.value = 1.5;
      this.fireGain = ctx.createGain();
      this.fireGain.gain.value = 0;
      fireSrc.connect(fireF).connect(this.fireGain);

      // Combine engine: two slightly detuned saws through a low-pass filter.
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 260;
      this.engineOsc = [ctx.createOscillator(), ctx.createOscillator()];
      this.engineOsc[0].type = 'sawtooth';
      this.engineOsc[1].type = 'sawtooth';
      this.engineOsc[0].frequency.value = 46;
      this.engineOsc[1].frequency.value = 46.7;
      for (const o of this.engineOsc) {
        o.connect(this.engineFilter);
        o.start();
      }
      this.engineFilter.connect(this.engineGain);

      this.master = ctx.createGain();
      this.master.gain.value = 0.0;
      this.windGain.connect(this.master);
      this.rainGain.connect(this.master);
      this.fireGain.connect(this.master);
      this.engineGain.connect(this.master);
      this.master.connect(ctx.destination);
      src.start();
      rainSrc.start();
      fireSrc.start();
    }
    this.ctx.resume();
    this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.4);
    this.on = true;
    return true;
  }

  stop() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
    this.on = false;
  }

  update({ wind, gust, rain, fire, fireDistance, engine = 0, engineLoad = 0.5 }) {
    if (!this.ctx || !this.on) return;
    const now = this.ctx.currentTime;
    const level = Math.min(1, 0.04 + wind * (0.12 + gust * 0.5));
    this.windGain.gain.setTargetAtTime(level * 0.55, now, 0.25);
    this.filter.frequency.setTargetAtTime(220 + wind * 260 + gust * 520, now, 0.3);
    this.rainGain.gain.setTargetAtTime(rain * 0.08, now, 0.5);
    const crackle = Math.random() < 0.25 ? 1 : 0.15;
    const near = fire / (1 + fireDistance * 0.08);
    this.fireGain.gain.setTargetAtTime(near * crackle * 0.12, now, 0.02);
    this.engineGain.gain.setTargetAtTime(engine * 0.09, now, 0.3);
    const rpm = 44 + engineLoad * 10;
    this.engineOsc[0].frequency.setTargetAtTime(rpm, now, 0.6);
    this.engineOsc[1].frequency.setTargetAtTime(rpm * 1.015, now, 0.6);
    this.engineFilter.frequency.setTargetAtTime(200 + engineLoad * 180, now, 0.6);
  }
}
