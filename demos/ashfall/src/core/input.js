/**
 * Ashfall — input.
 *
 * Pointer-lock mouse look plus edge-triggered keyboard state. Deltas accumulate between
 * ticks and are zeroed by `update()`, so a 240 Hz mouse feeding a 60 Hz sim loses nothing.
 */

const EDGE_CLEAR = [];

/**
 * Action -> key/button codes. Mouse buttons are ordinary codes here ("Mouse0".."Mouse4"), so
 * a playtester's "I have two buttons on my mouse for jump and crouch" is just a rebind, not a
 * special case. Every gameplay consumer reads ACTIONS, never raw codes; raw codes appear in
 * exactly two places — this table and the rebind capture in the menu.
 */
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  fire: ['Mouse0'],
  ads: ['Mouse2'],
  reload: ['KeyR'],
  inspect: ['KeyF'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weapon3: ['Digit3'],
};

const BINDINGS_KEY = 'ashfall.bindings';

function loadBindings() {
  const out = {};
  for (const k of Object.keys(DEFAULT_BINDINGS)) out[k] = DEFAULT_BINDINGS[k].slice();
  try {
    const stored = JSON.parse(localStorage.getItem(BINDINGS_KEY) || '{}');
    for (const k of Object.keys(stored)) {
      // Only actions this build knows, only well-formed code lists. A stale or hand-edited
      // entry must degrade to the default, never to a dead control.
      if (k in out && Array.isArray(stored[k]) && stored[k].every((c) => typeof c === 'string')) {
        if (stored[k].length) out[k] = stored[k].slice();
      }
    }
  } catch {
    /* corrupted storage reads as defaults */
  }
  return out;
}

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
    /* --- actions: what gameplay code reads ------------------------------- */
    bindings: loadBindings(),
    actionDown(name) {
      const b = this.bindings[name];
      if (!b) return false;
      for (let i = 0; i < b.length; i++) if (keys.has(b[i])) return true;
      return false;
    },
    actionPressed(name) {
      const b = this.bindings[name];
      if (!b) return false;
      for (let i = 0; i < b.length; i++) if (pressedThisFrame.has(b[i])) return true;
      return false;
    },
    actionReleased(name) {
      const b = this.bindings[name];
      if (!b) return false;
      for (let i = 0; i < b.length; i++) if (releasedThisFrame.has(b[i])) return true;
      return false;
    },
    /** Replace an action's binding and persist. Empty/invalid codes restore the default. */
    rebind(name, codes) {
      if (!(name in DEFAULT_BINDINGS)) return;
      const clean = (codes || []).filter((c) => typeof c === 'string' && c);
      this.bindings[name] = clean.length ? clean : DEFAULT_BINDINGS[name].slice();
      try {
        const store = {};
        for (const k of Object.keys(this.bindings)) store[k] = this.bindings[k];
        localStorage.setItem(BINDINGS_KEY, JSON.stringify(store));
      } catch {
        /* storage full/blocked: the live session still has the rebind */
      }
    },
    resetBindings() {
      for (const k of Object.keys(DEFAULT_BINDINGS)) this.bindings[k] = DEFAULT_BINDINGS[k].slice();
      try {
        localStorage.removeItem(BINDINGS_KEY);
      } catch {
        /* ignore */
      }
    },
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
    // Side buttons (3 = back, 4 = forward) navigate browser history by default; a jump that
    // also navigates away from the game is worse than no jump. Suppress regardless of lock,
    // because the navigation would fire even from the menu.
    if (e.button === 3 || e.button === 4) e.preventDefault();
    if (!input.locked) return;
    // Every button is also an ordinary bindable code, so "Mouse4 = jump" is just a binding.
    const code = `Mouse${e.button}`;
    if (!keys.has(code)) pressedThisFrame.add(code);
    keys.add(code);
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
    if (e.button === 3 || e.button === 4) e.preventDefault();
    const code = `Mouse${e.button}`;
    keys.delete(code);
    releasedThisFrame.add(code);
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  };

  // Chrome fires history navigation for the side buttons off auxclick, not mousedown.
  const onAuxClick = (e) => {
    if (e.button === 3 || e.button === 4) e.preventDefault();
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
  window.addEventListener('auxclick', onAuxClick);
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
    window.removeEventListener('auxclick', onAuxClick);
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('pointerlockchange', onLockChange);
    canvas.removeEventListener('contextmenu', onContextMenu);
  });

  return input;
}
