// Fixed process-local test clock. Does not change the machine clock or environment.
export const FIXTURE_NOW = Date.parse('2026-03-02T08:00:00Z');
const NativeDate = Date;
globalThis.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [FIXTURE_NOW])); }
  static now() { return FIXTURE_NOW; }
};
