import { bus } from '../core/events.js';
import {
  ACTIONS,
  ACTION_GROUPS,
  ACTION_BY_ID,
  SENSITIVITY_RANGE,
  bindingLabel,
  keyLabel,
  optionsStore,
} from '../core/input.js';

/* Options: controls, audio, gameplay.

   The panel exists because the first person to play the build asked "what are
   the controls and can I change them?" and the answer was no. It is a shell
   panel, not a second HUD surface: it registers itself with `__VS.shell` and
   the shell decides where and when it appears. If the shell has not landed yet
   the registration waits for it, so neither lane's landing order can break the
   other.

   Nothing here owns any state of its own. Bindings and the two camera
   preferences live in the store in `core/input.js` — which is where they have
   to live, because the dispatcher needs them before this module has loaded.
   Audio belongs to `audio/index.js` and is driven the way the HUD drives it,
   over `ui:audioVolume` / `ui:audioMute` / `ui:audioChanged`, so there is
   exactly one mixer with two faces rather than two mixers. */

/* ------------------------------------------------------------------ tuning */

/* The three the player actually reaches for. Interface and comms levels stay
   on the HUD's full five-fader bank; duplicating all five here would be two
   surfaces competing to describe one mixer. Third value is AudioSystem's own
   default, shown until the first `ui:audioChanged` arrives so the faders are
   never in a position that is simply wrong. */
const AUDIO_ROWS = [
  ['master', 'Master', 0.8],
  ['music', 'Music', 0.7],
  ['sfx', 'Effects', 0.85],
];

/* A bare modifier can never be a binding: it would fire every time the player
   held Shift to queue an order. Capture stays armed through them so holding a
   modifier on the way to a key is not an error. */
const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
]);

const TABS = [
  { id: 'controls', label: 'Controls' },
  { id: 'audio', label: 'Audio' },
  { id: 'gameplay', label: 'Gameplay' },
];

/* --------------------------------------------------------------- module state */

let installed = false;
let registered = false;
let root = null;
let capture = null;
let activeTab = 'controls';
let watchTimer = 0;
let watchOff = null;
let unregisterFromShell = null;
const keyButtons = new Map();
const rowMessages = new Map();
const audioControls = new Map();
const busOffs = [];

const audioState = { muted: false, available: true, confirmed: false };
const gameplayControls = {};
let statusEl = null;
/* What the shell was doing when a capture was armed, so an Escape that belongs
   to the rebind can be undone if the shell acts on it first. */
let shellPanelOpen = null;
let captureShell = null;

/* ---------------------------------------------------------------- utilities */

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function say(message) {
  if (statusEl) statusEl.textContent = message;
}

/* The same words, next to the row they are about. A conflict announced only at
   the top of a thirty-row card is a conflict the player has to go looking for;
   this puts it under the key they just pressed. */
function sayRow(id, message, kind) {
  for (const [otherId, node] of rowMessages) {
    if (otherId === id) continue;
    node.hidden = true;
    node.textContent = '';
  }
  const node = rowMessages.get(id);
  if (!node) return;
  node.textContent = message || '';
  node.className = `vso-row__msg${kind ? ` is-${kind}` : ''}`;
  node.hidden = !message;
}

function announce(id, message, kind) {
  say(message);
  sayRow(id, message, kind);
}

/* index.html belongs to the shell lane, so the panel brings its own stylesheet
   rather than waiting to be linked. `script-src 'self'` forbids inline script,
   not a same-origin stylesheet, and the URL is resolved from this module so it
   survives being served from any path. */
function ensureStylesheet() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('vs-options-css')) return;
  if (document.querySelector('link[href$="styles/options.css"]')) return;
  const link = document.createElement('link');
  link.id = 'vs-options-css';
  link.rel = 'stylesheet';
  link.href = new URL('../../styles/options.css', import.meta.url).href;
  document.head.appendChild(link);
}

/* ------------------------------------------------------------------ capture */

function getShell() {
  const vs = typeof window !== 'undefined' ? window.__VS : null;
  return (vs && vs.shell) || null;
}

/* Escape while a rebind is armed belongs to the rebind — but it cannot simply
   be stopped.

   The shell arbitrates Escape from a window-level capture listener registered
   when it was constructed, which is before this module is even imported.
   Listeners on the same node in the same phase run in registration order, so
   the shell always sees the key first, and `stopPropagation` cannot reach back
   to a listener that has already run. Worse, when the panel is open the shell's
   `closePanel()` calls this panel's own `onClose` *during* that dispatch, which
   tears the capture down before the local handler is ever reached — measured,
   not assumed.

   So rather than fight the order, put back what Escape moved, using the shell's
   own documented API. The player sees a cancelled rebind and a panel exactly
   where they left it. */
function snapshotShell() {
  const shell = getShell();
  if (!shell) return null;
  return { state: typeof shell.state === 'string' ? shell.state : null, panel: shellPanelOpen };
}

function restoreShell(id, message) {
  const shell = getShell();
  const before = captureShell;
  captureShell = null;

  if (!shell || !before) {
    if (message) announce(id, message);
    return;
  }

  /* Everything below is decided one microtask later, and deliberately not now:
     this runs from inside the shell's own `closePanel()`, which has not yet
     announced the close — reading "is the panel still open" at this instant
     gives the answer from before the key was pressed, and re-entering
     `openPanel()` here would strand focus behind an open panel. A microtask
     still lands before the next paint, so nothing flickers. */
  Promise.resolve().then(() => {
    /* It paused a running match: that Escape was not for the menu. */
    if (before.state === 'playing' && shell.state === 'paused' && typeof shell.resume === 'function') {
      shell.resume();
    }
    /* It closed the panel the player is standing in. Only put it back if
       nothing else moved — a panel that closed because the match resumed, or
       because the player left the menu, must stay closed. */
    if (before.panel && shell.state === before.state
      && shellPanelOpen !== before.panel && typeof shell.openPanel === 'function') {
      shell.openPanel(before.panel);
      /* openPanel puts focus on the panel's close button. The player was on a
         key cap and is still mid-task, so give it back. */
      const btn = keyButtons.get(id);
      if (btn && btn.isConnected) btn.focus({ preventScroll: true });
    }
    if (message) announce(id, message);
  });
}

function captureLabel(id) {
  const def = ACTION_BY_ID.get(id);
  return def ? def.label : id;
}

function paintKey(id) {
  const btn = keyButtons.get(id);
  if (!btn) return;
  const label = bindingLabel(id);
  btn.textContent = label;
  btn.setAttribute('aria-label', `${captureLabel(id)} — currently ${label}. Activate to rebind.`);
}

function paintAllKeys() {
  for (const id of keyButtons.keys()) paintKey(id);
}

/* Swallow the key-up that follows a captured key-down.

   Space and Enter activate a focused button on key-up, so binding an action to
   Space would immediately re-arm the very button that had just been satisfied.
   Preventing the key-down stops the synthesised click in every browser we
   target; this is the belt to that pair of braces, and it removes itself. */
function swallowNextKeyUp(code) {
  const onUp = (e) => {
    if (e.code !== code) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    window.removeEventListener('keyup', onUp, true);
  };
  window.addEventListener('keyup', onUp, true);
  setTimeout(() => window.removeEventListener('keyup', onUp, true), 1500);
}

function onCaptureKey(e) {
  if (!capture) return;
  /* Capture phase on `window` is the first stop on the propagation path, so
     stopping here is what keeps an armed rebind from also pausing the game,
     clearing the selection or opening the sensors manager. */
  e.preventDefault();
  e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();

  const code = e.code;
  /* Escape always cancels. It is the one key that must never be swallowed into
     a binding, because it is the only way out of this state. */
  if (code === 'Escape') {
    const id = capture.id;
    endCapture();
    restoreShell(id, `Rebinding cancelled — ${captureLabel(id)} is still ${bindingLabel(id)}.`);
    swallowNextKeyUp(code);
    return;
  }
  if (MODIFIER_CODES.has(code)) return;

  const id = capture.id;
  const result = optionsStore.setBinding(id, code);
  if (result.ok) {
    endCapture();
    paintKey(id);
    announce(id, `${captureLabel(id)} is now ${bindingLabel(id)}.`, 'ok');
    swallowNextKeyUp(code);
    return;
  }
  if (result.conflict) {
    /* Naming the other action is the whole value of the check: "already in
       use" sends the player hunting through five groups for it. Stay armed so
       the next key press is simply the next attempt. */
    announce(
      id,
      `${keyLabel(code)} already runs “${result.conflict.label}”. Press another key, or Escape to keep ${bindingLabel(id)}.`,
      'warn',
    );
    return;
  }
  announce(id, 'That key cannot be bound. Press another, or Escape to cancel.', 'warn');
}

function onCapturePointer(e) {
  if (!capture) return;
  if (capture.btn && capture.btn.contains(e.target)) return;
  const id = capture.id;
  endCapture();
  announce(id, `Rebinding cancelled — ${captureLabel(id)} is still ${bindingLabel(id)}.`);
}

function armCapture(id) {
  const btn = keyButtons.get(id);
  if (!btn || btn.disabled) return;
  if (capture) endCapture();
  capture = { id, btn };
  btn.classList.add('is-capturing');
  btn.setAttribute('aria-label', `Press a key for ${captureLabel(id)}. Escape cancels.`);
  btn.textContent = 'Press a key';
  captureShell = snapshotShell();
  announce(id, `Press a key for “${captureLabel(id)}”. Escape cancels.`);
  window.addEventListener('keydown', onCaptureKey, true);
  window.addEventListener('pointerdown', onCapturePointer, true);
}

function endCapture() {
  window.removeEventListener('keydown', onCaptureKey, true);
  window.removeEventListener('pointerdown', onCapturePointer, true);
  if (!capture) return;
  const { id, btn } = capture;
  capture = null;
  btn.classList.remove('is-capturing');
  paintKey(id);
}

/* -------------------------------------------------------------------- tabs */

function selectTab(id, focus) {
  if (!root) return;
  activeTab = id;
  for (const tab of TABS) {
    const btn = root.querySelector(`#vso-tab-${tab.id}`);
    const panel = root.querySelector(`#vso-panel-${tab.id}`);
    const on = tab.id === id;
    if (btn) {
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      if (on && focus) btn.focus({ preventScroll: true });
    }
    if (panel) panel.hidden = !on;
  }
  if (capture) endCapture();
}

function onTabKey(e) {
  const index = TABS.findIndex((t) => t.id === activeTab);
  let next = -1;
  if (e.key === 'ArrowRight') next = (index + 1) % TABS.length;
  else if (e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = TABS.length - 1;
  if (next < 0) return;
  e.preventDefault();
  e.stopPropagation();
  selectTab(TABS[next].id, true);
}

/* ---------------------------------------------------------------- controls */

function buildControls() {
  const panel = el('section', 'vso-panel vso-panel--wide');
  panel.id = 'vso-panel-controls';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', 'vso-tab-controls');
  panel.tabIndex = 0;

  panel.appendChild(el(
    'p',
    'vso-lede',
    'Choose a key, then press the key you want in its place. Escape cancels. ' +
    'Shift keeps its meaning everywhere — queue an order, hurry the camera — so it is never part of a binding.',
  ));

  for (const group of ACTION_GROUPS) {
    const rows = ACTIONS.filter((a) => a.group === group);
    if (!rows.length) continue;
    const block = el('div', 'vso-grp');
    block.appendChild(el('p', 'vso-grp__name', group));

    for (const def of rows) {
      const row = el('div', 'vso-row');
      const label = el('span', 'vso-row__label', def.label);
      row.appendChild(label);

      if (def.fixed) {
        const fixed = el('span', 'vso-key vso-key--fixed', def.fixed);
        fixed.title = 'Fixed — this is a family of keys, not a single binding.';
        row.appendChild(fixed);
      } else {
        const btn = el('button', 'vso-key');
        btn.type = 'button';
        btn.dataset.action = def.id;
        keyButtons.set(def.id, btn);
        paintKey(def.id);
        row.appendChild(btn);
      }

      if (def.note) row.appendChild(el('p', 'vso-row__note', def.note));
      if (!def.fixed) {
        const msg = el('p', 'vso-row__msg');
        msg.hidden = true;
        rowMessages.set(def.id, msg);
        row.appendChild(msg);
      }
      block.appendChild(row);
    }
    panel.appendChild(block);
  }

  const foot = el('div', 'vso-foot');
  const reset = el('button', 'vso-btn', 'Reset to defaults');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    if (capture) endCapture();
    optionsStore.resetBindings();
    paintAllKeys();
    sayRow(null, '');
    say('Every control is back to its default.');
  });
  foot.appendChild(reset);
  panel.appendChild(foot);

  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('.vso-key[data-action]');
    if (!btn || !panel.contains(btn)) return;
    armCapture(btn.dataset.action);
  });

  return panel;
}

/* ------------------------------------------------------------------- audio */

function buildAudio() {
  const panel = el('section', 'vso-panel vso-panel--single');
  panel.id = 'vso-panel-audio';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', 'vso-tab-audio');
  panel.tabIndex = 0;
  panel.hidden = true;

  panel.appendChild(el(
    'p',
    'vso-lede',
    'The mixer is live: every score cue, engine and gun runs through it, and your levels are remembered between visits.',
  ));

  const bank = el('div', 'vso-bank');
  for (const [id, label, dflt] of AUDIO_ROWS) {
    const row = el('div', 'vso-slider');
    const head = el('div', 'vso-slider__head');
    const name = el('label', 'vso-slider__k', label);
    name.htmlFor = `vso-audio-${id}`;
    const value = el('span', 'vso-slider__v', `${Math.round(dflt * 100)}%`);
    head.append(name, value);

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'vso-range';
    input.id = `vso-audio-${id}`;
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    input.value = String(dflt);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      value.textContent = `${Math.round(v * 100)}%`;
      bus.emit('ui:audioVolume', { bus: id, value: v });
      bus.emit('options:changed', { key: `audio.${id}`, value: v });
    });

    row.append(head, input);
    bank.appendChild(row);
    audioControls.set(id, { input, value });
  }
  panel.appendChild(bank);

  const mute = el('button', 'vso-switch', 'Sound on');
  mute.type = 'button';
  mute.setAttribute('role', 'switch');
  mute.setAttribute('aria-checked', 'false');
  mute.addEventListener('click', () => {
    /* `ui:audioMute` carries the state to move to, not a toggle. Until
       AudioSystem has answered once, this panel does not know what that state
       is — so send the payload-free form and let the module that owns it
       decide, exactly as the HUD does. */
    if (audioState.confirmed) bus.emit('ui:audioMute', { muted: !audioState.muted });
    else bus.emit('ui:audioMute');
    bus.emit('options:changed', { key: 'audio.muted', value: !audioState.muted });
  });
  audioControls.set('mute', { input: mute });

  const muteRow = el('div', 'vso-row vso-row--switch');
  muteRow.append(el('span', 'vso-row__label', 'Mute everything'), mute);
  panel.appendChild(muteRow);

  const note = el('p', 'vso-note', 'This browser is not giving us an audio device.');
  note.hidden = true;
  audioControls.set('note', { input: note });
  panel.appendChild(note);

  return panel;
}

function syncAudio(s) {
  if (!s || !root) return;
  if (typeof s.master === 'number') audioState.confirmed = true;
  if (typeof s.muted === 'boolean') audioState.muted = s.muted;
  const off = s.available === false;
  audioState.available = !off;

  for (const [id] of AUDIO_ROWS) {
    const ctl = audioControls.get(id);
    if (!ctl) continue;
    if (typeof s[id] === 'number') {
      ctl.input.value = String(s[id]);
      ctl.value.textContent = `${Math.round(s[id] * 100)}%`;
    }
    ctl.input.disabled = off;
  }

  const mute = audioControls.get('mute');
  if (mute) {
    mute.input.setAttribute('aria-checked', String(audioState.muted));
    mute.input.textContent = off
      ? 'No audio device'
      : audioState.muted ? 'Sound off' : 'Sound on';
    mute.input.disabled = off;
  }
  const note = audioControls.get('note');
  if (note) note.input.hidden = !off;
}

/* ---------------------------------------------------------------- gameplay */

function makeSwitch(labelText, key, describe) {
  const row = el('div', 'vso-row vso-row--switch');
  const btn = el('button', 'vso-switch');
  btn.type = 'button';
  btn.setAttribute('role', 'switch');
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-checked') !== 'true';
    optionsStore.setGameplay(key, next);
    paintGameplay();
  });
  row.append(el('span', 'vso-row__label', labelText), btn);
  const wrap = el('div', 'vso-field');
  wrap.appendChild(row);
  if (describe) wrap.appendChild(el('p', 'vso-note', describe));
  gameplayControls[key] = btn;
  return wrap;
}

function buildGameplay() {
  const panel = el('section', 'vso-panel vso-panel--single');
  panel.id = 'vso-panel-gameplay';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', 'vso-tab-gameplay');
  panel.tabIndex = 0;
  panel.hidden = true;

  panel.appendChild(el(
    'p',
    'vso-lede',
    'How the camera answers you. These take effect immediately — leave the panel open and try them.',
  ));

  const sens = el('div', 'vso-field');
  const row = el('div', 'vso-slider');
  const head = el('div', 'vso-slider__head');
  const name = el('label', 'vso-slider__k', 'Camera sensitivity');
  name.htmlFor = 'vso-sens';
  const value = el('span', 'vso-slider__v', '×1.00');
  head.append(name, value);

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'vso-range';
  input.id = 'vso-sens';
  input.min = String(SENSITIVITY_RANGE.min);
  input.max = String(SENSITIVITY_RANGE.max);
  input.step = String(SENSITIVITY_RANGE.step);
  input.addEventListener('input', () => {
    optionsStore.setGameplay('cameraSensitivity', Number(input.value));
    value.textContent = `×${Number(input.value).toFixed(2)}`;
  });
  row.append(head, input);
  sens.appendChild(row);
  sens.appendChild(el(
    'p',
    'vso-note',
    'Multiplies orbit and pan. A two-finger drag is unaffected — the ground stays under your fingers.',
  ));
  gameplayControls.cameraSensitivity = { input, value };
  panel.appendChild(sens);

  panel.appendChild(makeSwitch(
    'Invert vertical look',
    'invertY',
    'Drag down to look down, flight-stick style. Orbit only; panning keeps its direction.',
  ));
  panel.appendChild(makeSwitch(
    'Edge scrolling',
    'edgeScroll',
    'Pushes the camera when the pointer rests against the edge of the window.',
  ));

  const foot = el('div', 'vso-foot');
  const reset = el('button', 'vso-btn', 'Reset to defaults');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    optionsStore.resetGameplay();
    paintGameplay();
    say('Gameplay settings are back to their defaults.');
  });
  foot.appendChild(reset);
  panel.appendChild(foot);

  return panel;
}

function paintGameplay() {
  const g = optionsStore.gameplay;
  const sens = gameplayControls.cameraSensitivity;
  if (sens) {
    sens.input.value = String(g.cameraSensitivity);
    sens.value.textContent = `×${g.cameraSensitivity.toFixed(2)}`;
  }
  for (const key of ['invertY', 'edgeScroll']) {
    const btn = gameplayControls[key];
    if (!btn) continue;
    btn.setAttribute('aria-checked', String(!!g[key]));
    btn.textContent = g[key] ? 'On' : 'Off';
  }
}

/* ------------------------------------------------------------------- mount */

function build() {
  if (root) return root;

  /* No heading of its own: the shell prints the panel title from the spec, and
     a second "Options" underneath the first is the sort of chrome rule 8
     exists to prevent. */
  root = el('div', 'vso-root');

  const tablist = el('div', 'vso-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Options sections');
  for (const tab of TABS) {
    const btn = el('button', 'vso-tab', tab.label);
    btn.type = 'button';
    btn.id = `vso-tab-${tab.id}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', `vso-panel-${tab.id}`);
    btn.setAttribute('aria-selected', String(tab.id === activeTab));
    btn.tabIndex = tab.id === activeTab ? 0 : -1;
    btn.addEventListener('click', () => selectTab(tab.id, false));
    tablist.appendChild(btn);
  }
  tablist.addEventListener('keydown', onTabKey);
  root.appendChild(tablist);

  /* Directly under the tabs rather than at the foot: the host scrolls, and a
     message at the bottom of a thirty-row list is a message nobody reads. */
  statusEl = el('p', 'vso-status');
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  root.appendChild(statusEl);

  const body = el('div', 'vso-body');
  body.append(buildControls(), buildAudio(), buildGameplay());
  root.appendChild(body);

  paintAllKeys();
  paintGameplay();
  selectTab(activeTab, false);

  busOffs.push(bus.on('ui:audioChanged', (p) => syncAudio(p)));
  /* Which shell panel is open, observed rather than asked for — the shell
     broadcasts it and `restoreShell` needs to know what to put back. */
  busOffs.push(bus.on('shell:panel', (p) => {
    if (!p || !p.id) return;
    if (p.open) shellPanelOpen = p.id;
    else if (shellPanelOpen === p.id) shellPanelOpen = null;
  }));
  /* Someone else changing a binding — a reset, a future profile import — must
     redraw the caps rather than leave the panel lying about them. */
  busOffs.push(optionsStore.onChange((key) => {
    if (String(key).startsWith('bindings')) paintAllKeys();
    else if (String(key).startsWith('gameplay')) paintGameplay();
  }));

  return root;
}

function mount(container) {
  ensureStylesheet();
  const node = build();
  if (container && node.parentNode !== container) container.appendChild(node);
  return node;
}

/* ------------------------------------------------------- shell registration */

const panelSpec = {
  id: 'options',
  title: 'Options',
  where: ['title', 'pause'],
  order: 20,
  mount(container) {
    return mount(container);
  },
  onOpen() {
    paintAllKeys();
    paintGameplay();
    say('');
    sayRow(null, '');
    /* Only take focus if the shell has not already placed it inside the panel:
       fighting the overlay's own focus trap is how a menu ends up unreachable
       by keyboard. */
    const active = document.activeElement;
    if (root && (!active || active === document.body || !root.contains(active))) {
      const tab = root.querySelector(`#vso-tab-${activeTab}`);
      if (tab) tab.focus({ preventScroll: true });
    }
  },
  /* A close that arrives while a rebind is armed did not come from a pointer —
     `onCapturePointer` would have disarmed it first — so it is the shell acting
     on Escape, or on a state change. Cancel the rebind either way, and let
     `restoreShell` decide whether the panel should come straight back. */
  onClose() {
    if (!capture) {
      endCapture();
      captureShell = null;
      return;
    }
    const id = capture.id;
    endCapture();
    restoreShell(id, `Rebinding cancelled — ${captureLabel(id)} is still ${bindingLabel(id)}.`);
  },
};

function stopWatch() {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = 0;
  if (watchOff) watchOff();
  watchOff = null;
}

/** Register with the shell if it is there; report whether it took. */
function tryRegister() {
  if (registered) return true;
  const vs = typeof window !== 'undefined' ? window.__VS : null;
  const shell = vs && vs.shell;
  if (!shell || typeof shell.registerPanel !== 'function') return false;
  let off = null;
  try {
    off = shell.registerPanel(panelSpec);
  } catch (err) {
    return false;
  }
  unregisterFromShell = typeof off === 'function' ? off : null;
  registered = true;
  stopWatch();
  return true;
}

/* Hand the slot back rather than leaving a menu entry pointing at torn-down
   DOM. The shell hands out an unregister function for exactly this. */
function unregister() {
  if (unregisterFromShell) {
    try { unregisterFromShell(); } catch (err) { /* the shell may be gone */ }
  }
  unregisterFromShell = null;
  registered = false;
}

/* The shell is built by another lane and may land before or after this module.
   Watching for it costs one timer that stops the moment it succeeds, and it
   means neither landing order can produce a game with no options. */
function watchForShell() {
  if (registered || watchTimer) return;
  const deadline = Date.now() + 120000;
  watchTimer = setInterval(() => {
    if (tryRegister() || Date.now() > deadline) stopWatch();
  }, 150);
  watchOff = bus.on('shell:state', () => tryRegister());
}

export function installOptions() {
  if (installed || typeof document === 'undefined') return getApi();
  installed = true;
  ensureStylesheet();
  const vs = window.__VS || (window.__VS = {});
  vs.options = getApi();
  if (!tryRegister()) watchForShell();
  return vs.options;
}

let api = null;
function getApi() {
  if (api) return api;
  api = {
    panel: panelSpec,
    store: optionsStore,
    storageKey: optionsStore.storageKey,
    mount,
    element: () => root,
    register: tryRegister,
    /* Give the slot back and start watching again — the panel is no longer
       registered, so a shell that reappears should get it. */
    unregister: () => {
      unregister();
      watchForShell();
    },
    get registered() { return registered; },
    get capturing() { return capture ? capture.id : null; },
    rebind: (id) => armCapture(id),
    cancelRebind: () => endCapture(),
    open: () => {
      const shell = window.__VS && window.__VS.shell;
      return shell && shell.openPanel ? shell.openPanel('options') : false;
    },
    dispose,
  };
  return api;
}

export function dispose() {
  endCapture();
  unregister();
  stopWatch();
  for (const off of busOffs) off();
  busOffs.length = 0;
  keyButtons.clear();
  rowMessages.clear();
  audioControls.clear();
  if (root && root.parentNode) root.parentNode.removeChild(root);
  root = null;
  statusEl = null;
  installed = false;
}

/* Importing this module is enough to install it. `core/input.js` pulls it in
   because nothing else can — main.js and index.html belong to the shell lane. */
if (typeof document !== 'undefined') installOptions();

export default installOptions;
