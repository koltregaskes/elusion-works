import * as THREE from '../../vendor/three/build/three.module.js';

/* Rock fade slots (R6 fix 2, reworked R9 fix 2).

   The camera rig writes here and the shared rock material reads it. Each slot
   is a rock's world centre in xyz and its opacity in w: 1 draws it as normal,
   0 discards every fragment of it. Anything between is a brief transition
   only (COMPOSE.fadeRate, about 0.2 s), and is never drawn as a dither: the
   opaque pass drops a rock the moment it leaves w = 1, and a small alpha-blended
   pass (`rockFadeState.blend`, a transparent twin of the rock material) draws
   just the transitioning rocks over the finished opaque frame. R8's ordered
   dither held mid-fade read as a screen-door stipple across a destroyer's hull;
   MSAA alpha-to-coverage would need MSAA (the low and high tiers have none) and
   a blue-noise dither would need TAA to resolve it (only the high tiers run
   it), so per-rock alpha blending is the one method that looks the same on
   every tier. An unused slot sits at a centre no rock can have, with w = 1. */
export const ROCK_FADE_SLOTS = 4;
export const ROCK_FADE_FAR = 1e9;
export const rockFadeUniform = {
  value: Array.from({ length: ROCK_FADE_SLOTS }, () => new THREE.Vector4(ROCK_FADE_FAR, ROCK_FADE_FAR, ROCK_FADE_FAR, 1)),
};

/* `blend` is the transparent twin material, registered by the environment.
   It is visible only while some slot is part-way, so a settled frame issues
   no extra draw. `partialFor` is how long, in seconds, some slot has been
   part-way without a break: a transition lasts about 0.2 s, so anything much
   longer is a held partial fade, which must not happen. */
export const rockFadeState = { blend: null, partial: 0, partialFor: 0 };

/** Called once a frame after the slots are final. */
export function syncRockFade(dt) {
  let n = 0;
  for (const v of rockFadeUniform.value) if (v.x < ROCK_FADE_FAR * 0.5 && v.w > 0.001 && v.w < 0.999) n++;
  rockFadeState.partial = n;
  rockFadeState.partialFor = n ? rockFadeState.partialFor + Math.max(0, dt || 0) : 0;
  if (rockFadeState.blend) rockFadeState.blend.visible = n > 0;
}
