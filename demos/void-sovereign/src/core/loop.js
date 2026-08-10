import { bus } from './events.js';

/* Fixed-step simulation with interpolated rendering.

   The sim ticks at a constant 30 Hz so combat, steering and production are
   frame-rate independent and reproducible. Rendering runs as fast as the
   display allows and lerps entity transforms between the last two sim states,
   which is what makes capital ships glide instead of stutter. */

const MAX_CATCHUP = 5; // never simulate more than this many ticks in one frame

export class Loop {
  constructor({ engine, world, hz = 30 }) {
    this.engine = engine;
    this.world = world;
    this.hz = hz;
    this.step = 1 / hz;
    this.timeScale = 1;
    this.alpha = 0;
    this.elapsed = 0;
    this.tick = 0;
    this.running = false;
    this._accum = 0;
    this._last = 0;
    this._raf = 0;

    // Rolling frame-time average for the perf readout and adaptive quality.
    this._ftSamples = new Float32Array(60);
    this._ftIndex = 0;
    this.fps = 60;

    this._offSpeed = bus.on('ui:speed', ({ scale }) => this.setTimeScale(scale));
    this._frame = this._frame.bind(this);
  }

  setTimeScale(s) {
    this.timeScale = Math.max(0, s);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._frame);

    // Clamp: a backgrounded tab or a long GC must not trigger a sim avalanche.
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.25) dt = 0.25;

    this._ftSamples[this._ftIndex] = dt;
    this._ftIndex = (this._ftIndex + 1) % this._ftSamples.length;
    let sum = 0;
    for (let i = 0; i < this._ftSamples.length; i++) sum += this._ftSamples[i];
    this.fps = this._ftSamples.length / Math.max(1e-6, sum);

    this.elapsed += dt;

    if (this.timeScale > 0) {
      this._accum += dt * this.timeScale;
      let steps = 0;
      while (this._accum >= this.step && steps < MAX_CATCHUP) {
        this.world.tick(this.step);
        this.tick++;
        this._accum -= this.step;
        steps++;
      }
      if (steps === MAX_CATCHUP) this._accum = 0; // give up on the backlog
      this.alpha = this._accum / this.step;
    } else {
      this.alpha = 1;
    }

    this.world.syncTransforms(this.alpha);
    this.engine.render(dt, this.elapsed);
  }

  dispose() {
    this.stop();
    if (this._offSpeed) this._offSpeed();
  }
}
