/**
 * Ashfall — input.
 *
 * Pointer-lock mouse look plus edge-triggered keyboard state. Deltas accumulate between
 * ticks and are zeroed by `update()`, so a 240 Hz mouse feeding a 60 Hz sim loses nothing.
 */

const EDGE_CLEAR = [];

export function createInput(canvas) {
  const keys = new Set();
  const pressedThisFrame = new Set();
  const releasedThisFrame = new Set();

  const mouse = {
    dx: 0,
    dy: 0,
    left: false,
    right: false,
    leftPressed: false,
    rightPressed: false,
    wheel: 0,
  };

  const input = {
    keys,
    mouse,
    locked: false,
    enabled: true,
    sensitivity: 0.0022, // radians per raw mouse unit at 1.0 slider
    invertY: false,
    down: (code) => keys.has(code),
    pressed: (code) => pressedThisFrame.has(code),
    released: (code) => releasedThisFrame.has(code),
    /** Any of a list of codes is held — for WASD/arrow duality. */
    downAny: (...codes) => codes.some((c) => keys.has(c)),
    requestLock() {
      if (!document.pointerLockElement) canvas.requestPointerLock?.();
    },
    exitLock() {
      if (document.pointerLockElement) document.exitPointerLock?.();
    },
    update() {
      pressedThisFrame.clear();
      releasedThisFrame.clear();
      mouse.dx = 0;
      mouse.dy = 0;
      mouse.wheel = 0;
      mouse.leftPressed = false;
      mouse.rightPressed = false;
    },
    dispose() {
      for (const fn of EDGE_CLEAR) fn();
      EDGE_CLEAR.length = 0;
    },
  };

  const onKeyDown = (e) => {
    // Never swallow devtools or tab-away shortcuts.
    if (e.metaKey || e.ctrlKey) return;
    if (!keys.has(e.code)) pressedThisFrame.add(e.code);
    keys.add(e.code);
    // Space and the arrows scroll the page otherwise, which fights pointer lock.
    if (
      e.code === 'Space' ||
      e.code === 'Tab' ||
      e.code.startsWith('Arrow') ||
      (e.code.startsWith('Digit') && input.locked)
    ) {
      e.preventDefault();
    }
  };

  const onKeyUp = (e) => {
    keys.delete(e.code);
    releasedThisFrame.add(e.code);
  };

  const onMouseMove = (e) => {
    if (!input.locked || !input.enabled) return;
    // movementX/Y can spike on some drivers when lock engages; clamp to a sane per-event max.
    const dx = Math.max(-300, Math.min(300, e.movementX || 0));
    const dy = Math.max(-300, Math.min(300, e.movementY || 0));
    mouse.dx += dx;
    mouse.dy += dy;
  };

  const onMouseDown = (e) => {
    if (!input.locked) return;
    if (e.button === 0) {
      if (!mouse.left) mouse.leftPressed = true;
      mouse.left = true;
    }
    if (e.button === 2) {
      if (!mouse.right) mouse.rightPressed = true;
      mouse.right = true;
    }
  };

  const onMouseUp = (e) => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  };

  const onWheel = (e) => {
    if (!input.locked) return;
    mouse.wheel += Math.sign(e.deltaY);
    e.preventDefault();
  };

  const onLockChange = () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) {
      keys.clear();
      mouse.left = false;
      mouse.right = false;
    }
  };

  const onBlur = () => {
    keys.clear();
    mouse.left = false;
    mouse.right = false;
  };

  const onContextMenu = (e) => e.preventDefault();

  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('contextmenu', onContextMenu);

  EDGE_CLEAR.push(() => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('pointerlockchange', onLockChange);
    canvas.removeEventListener('contextmenu', onContextMenu);
  });

  return input;
}
