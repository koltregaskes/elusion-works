/* Minimal synchronous event bus.
   Systems never hold references to each other; they talk through here.
   Handlers are copied before dispatch so a listener can unsubscribe mid-emit. */

const listeners = new Map();

/* De-duplicated so a listener throwing on a 30 Hz event records once, not
   thirty times a second. */
const seenErrors = new Set();

function recordListenerError(type, err) {
  const message = String((err && err.message) || err);
  const key = `${type}::${message}`;
  const existing = seenErrors.has(key);
  if (existing) {
    const row = bus.errors.find((e) => e.type === type && e.message === message);
    if (row) row.count++;
    return;
  }
  seenErrors.add(key);
  bus.errors.push({
    type,
    message,
    count: 1,
    stack: String((err && err.stack) || ''),
  });
  if (bus.errors.length > 50) bus.errors.shift();
}

export const bus = {
  on(type, fn) {
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(fn);
    return () => bus.off(type, fn);
  },

  once(type, fn) {
    const off = bus.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  },

  off(type, fn) {
    const set = listeners.get(type);
    if (set) {
      set.delete(fn);
      if (set.size === 0) listeners.delete(type);
    }
  },

  /* Dispatch is guarded per listener, and that is load-bearing rather than
     defensive habit.

     Unguarded, one throwing subscriber aborts the whole fan-out, so **every
     listener registered after it silently never runs** — with no diagnostic,
     because the throw is swallowed by whatever called emit(). This has already
     happened once here: audio subscribed `fx:blast` to a handler it had not
     yet defined, and the camera's screen shake — registered later — simply
     stopped existing. Nothing logged, nothing crashed, a feature just quietly
     was not there.

     A throw in one listener must cost that listener, not the ones behind it.
     Errors are recorded on `bus.errors` and reported once per (type, message)
     so a per-frame event cannot flood anything. */
  emit(type, payload) {
    const set = listeners.get(type);
    if (!set || set.size === 0) return;
    // Snapshot: a handler may add or remove handlers for this same event.
    const snapshot = set.size === 1 ? [set.values().next().value] : Array.from(set);
    for (let i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](payload);
      } catch (err) {
        recordListenerError(type, err);
      }
    }
  },

  /** Recorded listener failures: `{ type, message, count, stack }`. */
  errors: [],

  clearErrors() {
    bus.errors.length = 0;
    seenErrors.clear();
  },

  clear() {
    listeners.clear();
    bus.clearErrors();
  },
};
