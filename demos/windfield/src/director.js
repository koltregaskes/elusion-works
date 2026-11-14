import * as THREE from '../vendor/three/build/three.module.js';
import { heightAt } from './terrain.js';

// Film mode: a self-directing short film through the field. Each shot sets a mood, a
// lens and a camera move (crane, dolly, trackside pass, aerial follow, orbit, push-in).
// Shots that change mood dip to black, so the mood swap and the cut happen in the dark;
// shots within one mood cut straight. The film loops.

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const v = (x, y, z) => new THREE.Vector3(x, y, z);

// Each shot: preset id, duration (s), lens (vertical fov), and camera(t, ctx) returning
// { pos, look } for t in 0..1. ctx.ground is the stage height under the oak.
const SHOTS = [
  {
    preset: 'dawn', duration: 11, fov: 42,
    // Crane up out of the dewy grass to find the oak in the mist.
    camera: (t, c) => ({
      pos: v(-7, c.ground + 0.6, 21).lerp(v(-12, c.ground + 4.8, 26), ease(t)),
      look: v(0, c.ground + 3.5 + t * 2.5, 0),
    }),
  },
  {
    preset: 'meadow', duration: 9, fov: 50,
    // Low lateral slide through the flowers, oak on the third.
    camera: (t, c) => ({
      pos: v(-26 + t * 14, c.ground + 1.6, 19),
      look: v(-4 + t * 6, c.ground + 4.8, 0),
    }),
  },
  {
    preset: 'golden', duration: 11, fov: 38,
    // Slow dolly into the low sun, the oak backlit and the grass glowing.
    camera: (t, c) => ({
      pos: v(26, c.ground + 1.4, 11).lerp(v(15, c.ground + 1.7, 6.5), ease(t)),
      look: v(0, c.ground + 5.5, 0),
    }),
  },
  {
    preset: 'harvest', duration: 9, fov: 34, harvestLead: 75,
    // Trackside: a fixed long lens beside the lane as the combine works past.
    enter: (c, shot) => {
      const { x, z, heading } = c.combine();
      const fx = Math.cos(heading);
      const fz = Math.sin(heading);
      const ax = x + fx * 22 - fz * 10;
      const az = z + fz * 22 + fx * 10;
      shot.anchor = v(ax, heightAt(ax, az) + 1.3, az);
    },
    camera: (t, c, shot) => {
      const { x, z } = c.combine();
      return { pos: shot.anchor, look: v(x, heightAt(x, z) + 2.2, z) };
    },
  },
  {
    preset: 'harvest', duration: 10, fov: 46, cut: true,
    // Aerial follow, high and to the side, the cut lanes striping the field below.
    camera: (t, c) => {
      const { x, z, heading } = c.combine();
      const fx = Math.cos(heading);
      const fz = Math.sin(heading);
      const side = 24 + t * 5;
      const pos = v(x - fx * 12 + fz * side, heightAt(x, z) + 15 + t * 4, z - fz * 12 - fx * side);
      return { pos, look: v(x + fx * 4, heightAt(x, z) + 1.5, z + fz * 4) };
    },
  },
  {
    preset: 'autumn', duration: 10, fov: 46,
    // Low beside the oak, tilting up into the turning canopy as the leaves come down.
    camera: (t, c) => {
      const a = 5.0 + t * 0.3;
      return {
        pos: v(Math.cos(a) * 17, c.ground + 1.4, Math.sin(a) * 17),
        look: v(0, c.ground + 6 + t * 1.2, 0),
      };
    },
  },
  {
    preset: 'storm', duration: 10, fov: 44,
    // Wide orbit around the oak as the gusts flatten the field.
    camera: (t, c) => {
      const a = 3.6 + t * 0.45;
      return {
        pos: v(Math.cos(a) * 30, c.ground + 3.2, Math.sin(a) * 30),
        look: v(0, c.ground + 6, 0),
      };
    },
  },
  {
    preset: 'night', duration: 11, fov: 40,
    // Push in low through the fireflies.
    camera: (t, c) => ({
      pos: v(15, c.ground + 0.9, 19).lerp(v(9, c.ground + 1.1, 12), ease(t)),
      look: v(0, c.ground + 4.5, 0),
    }),
  },
  {
    preset: 'bonfire', duration: 12, fov: 42,
    // Slow orbit through the gap in the stones towards the fire.
    camera: (t, c) => {
      const a = 4.05 + t * 0.35;
      const r = 17 - t * 3;
      return {
        pos: v(Math.cos(a) * r, c.ground + 2.0, Math.sin(a) * r),
        look: v(0, c.ground + 2.4, 0),
      };
    },
  },
];

const DIP = 0.9; // seconds of fade at each end of a mood change

export class FilmDirector {
  constructor({ presets, setPreset, advanceHarvest, combine, onShot, onFade }) {
    this.presets = presets;
    this.setPreset = setPreset;
    this.advanceHarvest = advanceHarvest;
    this.combine = combine;
    this.onShot = onShot;
    this.onFade = onFade;
    this.active = false;
    this.ctx = { ground: heightAt(0, 0), combine };
  }

  start() {
    this.active = true;
    this.index = -1;
    this.loops = 0;
    this.next();
  }

  stop() {
    this.active = false;
    this.onFade(0);
  }

  next() {
    if (this.index === SHOTS.length - 1) this.loops += 1;
    this.index = (this.index + 1) % SHOTS.length;
    const shot = SHOTS[this.index];
    this.shot = shot;
    this.t = 0;
    const presetIndex = this.presets.findIndex((p) => p.id === shot.preset);
    if (!shot.cut) this.setPreset(presetIndex);
    if (shot.harvestLead) this.advanceHarvest(shot.harvestLead);
    shot.enter?.(this.ctx, shot);
    this.onShot(this.presets[presetIndex], shot, this.index);
  }

  // Capture hook: jump to shot i, t seconds in.
  seek(i, t = 0) {
    this.index = ((i % SHOTS.length) + SHOTS.length - 1) % SHOTS.length;
    this.next();
    this.t = t;
  }

  // Moves the camera for this frame. Returns true when the lens changed. dt in seconds.
  apply(camera, dt, time) {
    if (!this.active) return false;
    this.t += dt;
    if (this.t >= this.shot.duration) this.next();
    const shot = this.shot;
    const u = Math.min(1, this.t / shot.duration);
    const { pos, look } = shot.camera(u, this.ctx, shot);
    // A touch of handheld breath so locked-off shots still feel shot, not rendered.
    look.x += Math.sin(time * 0.61) * 0.05;
    look.y += Math.sin(time * 0.83 + 1.3) * 0.04;
    camera.position.copy(pos);
    camera.lookAt(look);
    // The shots are framed for a wide screen; narrower screens get a wider lens so the
    // subject still fits side to side.
    const ref = 1.6;
    const fov = camera.aspect >= ref
      ? shot.fov
      : Math.min(70, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(shot.fov) / 2) * ref / camera.aspect)));
    let lensChanged = false;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
      lensChanged = true;
    }
    // Dip to black around mood changes; straight cuts within a mood.
    const nextShot = SHOTS[(this.index + 1) % SHOTS.length];
    const fadeIn = shot.cut ? 0 : 1 - Math.min(1, this.t / DIP);
    const fadeOut = nextShot.cut ? 0 : Math.max(0, 1 - (shot.duration - this.t) / DIP);
    this.onFade(Math.max(fadeIn, fadeOut));
    return lensChanged;
  }
}

export const FILM_LENGTH = SHOTS.reduce((a, s) => a + s.duration, 0);
