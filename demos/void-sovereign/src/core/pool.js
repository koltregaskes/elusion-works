/* Object pools. Battles allocate thousands of tracers and impact sparks per
   second; without pooling the GC pauses show up as frame hitches. */

export class Pool {
  constructor(factory, reset, initial = 0) {
    this._factory = factory;
    this._reset = reset;
    this._free = [];
    this._created = 0;
    for (let i = 0; i < initial; i++) {
      this._free.push(this._make());
    }
  }

  _make() {
    this._created++;
    return this._factory();
  }

  acquire() {
    const o = this._free.length ? this._free.pop() : this._make();
    return o;
  }

  release(o) {
    if (this._reset) this._reset(o);
    this._free.push(o);
  }

  get size() {
    return this._created;
  }

  get available() {
    return this._free.length;
  }

  clear() {
    this._free.length = 0;
  }
}

/** Fixed-capacity ring of live particles/slots with O(1) add and swap-remove. */
export class SlotList {
  constructor(capacity, factory) {
    this.capacity = capacity;
    this.count = 0;
    this.items = new Array(capacity);
    for (let i = 0; i < capacity; i++) this.items[i] = factory(i);
  }

  /** Returns the next free item, or null when full. Caller initialises it. */
  add() {
    if (this.count >= this.capacity) return null;
    return this.items[this.count++];
  }

  /** Swap-remove: keeps the live range dense so update loops stay tight. */
  removeAt(i) {
    const last = --this.count;
    if (i !== last) {
      const tmp = this.items[i];
      this.items[i] = this.items[last];
      this.items[last] = tmp;
    }
  }

  clear() {
    this.count = 0;
  }
}
