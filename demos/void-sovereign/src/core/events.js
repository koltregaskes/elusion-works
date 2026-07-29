/* Minimal synchronous event bus.
   Systems never hold references to each other; they talk through here.
   Handlers are copied before dispatch so a listener can unsubscribe mid-emit. */

const listeners = new Map();

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

  emit(type, payload) {
    const set = listeners.get(type);
    if (!set || set.size === 0) return;
    // Snapshot: a handler may add or remove handlers for this same event.
    const snapshot = set.size === 1 ? [set.values().next().value] : Array.from(set);
    for (let i = 0; i < snapshot.length; i++) {
      snapshot[i](payload);
    }
  },

  clear() {
    listeners.clear();
  },
};
