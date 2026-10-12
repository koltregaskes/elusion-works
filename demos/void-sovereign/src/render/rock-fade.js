import * as THREE from '../../vendor/three/build/three.module.js';

/* Rock fade slots (R6 fix 2).

   The camera rig writes here and the shared rock material reads it. Each slot
   is a rock's world centre in xyz and its opacity in w: 1 draws it as normal,
   0 discards every fragment of it, and anything between is an ordered dither.
   The rig fills a slot when the camera's near quad is inside, or about to be
   inside, the hull of a rock it cannot frame around, so the frame never shows
   the inside of a rock or a near plane slicing one. An unused slot sits at a
   centre no rock can have, with w = 1. */
export const ROCK_FADE_SLOTS = 4;
export const ROCK_FADE_FAR = 1e9;
export const rockFadeUniform = {
  value: Array.from({ length: ROCK_FADE_SLOTS }, () => new THREE.Vector4(ROCK_FADE_FAR, ROCK_FADE_FAR, ROCK_FADE_FAR, 1)),
};
