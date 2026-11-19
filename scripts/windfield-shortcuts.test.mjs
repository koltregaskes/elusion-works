import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = process.argv.includes('--baseline')
  ? execFileSync('git', ['show', 'f922141c31524eb327c37df248ba04091e0c1cc8:demos/windfield/src/ui.js'], { encoding: 'utf8' })
  : readFileSync(new URL('../demos/windfield/src/ui.js', import.meta.url), 'utf8');

// Execute the real UI binding without a renderer or browser dependency.
function fixture() {
  let keydown;
  const clicks = [], presets = [], drives = [];
  const document = {
    body: { classList: { toggle() {} } },
    querySelector(selector) {
      return { addEventListener() {}, click() { clicks.push(selector); } };
    },
  };
  const context = {
    document,
    HTMLInputElement: class {}, HTMLSelectElement: class {},
    window: { addEventListener(type, fn) { if (type === 'keydown') keydown = fn; } },
  };
  vm.runInNewContext(source.replace(/^import .*;\s*$/m, '').replace('export class', 'class')
    + '\nglobalThis.StudioUI = StudioUI;', context);
  context.StudioUI.prototype.bindChrome.call({ h: {
    onPreset: (i) => presets.push(i), onDrive: () => drives.push(true),
  } });
  const send = (key, tag = 'div', options = {}) => {
    const target = tag === 'input' ? new context.HTMLInputElement()
      : tag === 'select' ? new context.HTMLSelectElement() : {};
    target.closest = (selector) => selector.split(', ').includes(options.parent || tag) ? target : null;
    const e = {
      key, defaultPrevented: !!options.prevented,
      target,
      preventDefault() { this.defaultPrevented = true; },
    };
    keydown(e);
    return e;
  };
  return { send, clicks, presets, drives };
}

for (const tag of ['button', 'a[href]', 'summary']) {
  test(`Space retains native activation on ${tag}`, () => {
    const f = fixture();
    assert.equal(f.send(' ', tag).defaultPrevented, false);
    assert.deepEqual(f.clicks, []);
  });
}
test('nested content retains its button activation', () => {
  const f = fixture();
  assert.equal(f.send(' ', 'span', { parent: 'button' }).defaultPrevented, false);
  assert.deepEqual(f.clicks, []);
});
for (const tag of ['input', 'select', 'textarea', '[contenteditable]']) {
  test(`editing ${tag} does not execute scene shortcuts`, () => {
    const f = fixture();
    for (const key of [' ', '1', 't']) assert.equal(f.send(key, tag).defaultPrevented, false);
    assert.deepEqual([...f.clicks, ...f.presets, ...f.drives], []);
  });
}
test('an already handled event stays handled', () => {
  const f = fixture();
  f.send(' ', 'div', { prevented: true });
  assert.deepEqual(f.clicks, []);
});
test('scene Space, mood and drive shortcuts remain available', () => {
  const f = fixture();
  assert.equal(f.send(' ').defaultPrevented, true);
  f.send('3'); f.send('t');
  assert.deepEqual(f.clicks, ['[data-pause]']);
  assert.deepEqual(f.presets, [2]);
  assert.deepEqual(f.drives, [true]);
});
