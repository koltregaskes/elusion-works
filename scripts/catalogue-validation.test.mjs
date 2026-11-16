// Reuses and extends the independent PR 117 review's 22-check harness.
// Run from the repository root. All generated files stay under .local/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { GROUPS, FIELDS, parseCsv } from '../demos/orbit-census/src/catalog.js';

const root = process.cwd();
const wf = fs.readFileSync('.github/workflows/pages.yml', 'utf8');
// Execute the actual workflow heredoc, not a separately maintained validator.
const script = wf.match(/node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n          NODE/)[1]
  .split(/\r?\n/).map(s => s.replace(/^          /, '')).join('\n');
fs.mkdirSync('.local', { recursive: true });
const fixture = fs.mkdtempSync(path.join(root, '.local/catalogue-validation-'));
fs.mkdirSync(path.join(fixture, 'demos/orbit-census/src'), { recursive: true });
fs.mkdirSync(path.join(fixture, '_site/demos/orbit-census/data'), { recursive: true });
fs.writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
fs.copyFileSync('demos/orbit-census/src/catalog.js', path.join(fixture, 'demos/orbit-census/src/catalog.js'));
fs.copyFileSync('demos/orbit-census/src/catalogue-status.js', path.join(fixture,'demos/orbit-census/src/catalogue-status.js'));
const catalogue = path.join(fixture, '_site/demos/orbit-census/data/catalog.json');
const row = ['Fixture', 1, '2000-001A', 'PAY', '', '', '', null, 'active',
  '2000-01-01T00:00:00', 15, 0.001, 51.6, 10, 20, 30, 0, 0, 0];
// Original valid fixtures used a one-object census. Raise only the population and
// its type counts to the new conservative floor; keep the original 2,000 GP rows.
const valid = () => ({ v: 1, generated: new Date().toISOString(), fields: FIELDS,
  rows: Array.from({ length: 2000 }, (_, i) => { const r = [...row]; r[1] = i + 1; return r; }),
  groups: Object.fromEntries(GROUPS.map(g => [g.id, 1])), satcat: true,
  census: { total: 10000, PAY: 10000, 'R/B': 0, DEB: 0, UNK: 0 },
});
const gate = () => spawnSync(process.execPath, ['--input-type=module'], { cwd: fixture, input: script, encoding: 'utf8' });
const validate = doc => { fs.writeFileSync(catalogue, typeof doc === 'string' ? doc : JSON.stringify(doc)); return gate(); };
test('valid minimum-size acquisition passes', () => {
  const r = validate(valid()); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /2000 objects/);
});
for (const [label, mutate] of [
  ['empty file', () => ''], ['malformed JSON', () => '{'], ['null document', () => null],
  ['short rows', d => { d.rows.pop(); return d; }], ['missing rows', d => { delete d.rows; return d; }],
  ['failed GP group', d => { d.groups.stations = null; return d; }],
  ['empty GP group', d => { d.groups.stations = 0; return d; }],
  ['missing GP group', d => { delete d.groups.stations; return d; }],
  ['failed SATCAT', d => { d.satcat = false; return d; }],
  ['empty census', d => { d.census.total = 0; return d; }],
  ['missing census', d => { delete d.census; return d; }],
  ['tiny census', d => { d.census.total = 1; return d; }],
  ['census below floor', d => { d.census.total = d.census.PAY = 9999; return d; }],
  ['inconsistent census', d => { d.census.PAY--; return d; }],
  ['negative type count', d => { d.census.UNK = -1; return d; }],
  ['missing type count', d => { delete d.census.DEB; return d; }],
  ['wrong fields', d => { d.fields = [...FIELDS].reverse(); return d; }],
  ['missing fields', d => { delete d.fields; return d; }],
  ['wrong version', d => { d.v = 2; return d; }],
]) test('validator rejects ' + label, () => {
  const r = validate(mutate(valid())); assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, /::error::Orbit Census/);
});
test('missing catalogue is rejected', () => {
  fs.renameSync(catalogue, catalogue + '.saved');
  const r = gate(); assert.equal(r.status, 1, r.stderr);
  fs.renameSync(catalogue + '.saved', catalogue);
});
test('malformed row content must fail validation', () => {
  const d = valid(); d.rows = Array(2000).fill(null);
  const r = validate(d); assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, /row 1/);
});
for (const [label, mutate] of [
  ['one null row', d => { d.rows[1999] = null; }],
  ['object instead of compact array', d => { d.rows[0] = Object.fromEntries(FIELDS.map((f, i) => [f, row[i]])); }],
  ['short row', d => { d.rows[0].pop(); }], ['long row', d => { d.rows[0].push(0); }],
  ['missing epoch', d => { d.rows[0][9] = ''; }], ['invalid epoch', d => { d.rows[0][9] = 'not-a-date'; }],
  ['offset epoch unsupported by satellite.js', d => { d.rows[0][9] = '2000-01-01T00:00:00+01:00'; }],
  ['duplicate identifier', d => { d.rows[1][1] = 1; }], ['invalid identifier', d => { d.rows[0][1] = 0; }],
  ['empty name', d => { d.rows[0][0] = ''; }], ['unknown type', d => { d.rows[0][3] = 'OTHER'; }],
  ['inherited type', d => { d.rows[0][3] = 'toString'; }], ['unknown group', d => { d.rows[0][8] = 'other'; }],
  ['negative RCS', d => { d.rows[0][7] = -1; }],
  ['zero mean motion', d => { d.rows[0][10] = 0; }], ['excess mean motion', d => { d.rows[0][10] = 21; }],
  ['negative eccentricity', d => { d.rows[0][11] = -0.1; }], ['unbound eccentricity', d => { d.rows[0][11] = 1; }],
  ['negative inclination', d => { d.rows[0][12] = -1; }], ['excess inclination', d => { d.rows[0][12] = 181; }],
  ...[13, 14, 15].flatMap(i => [
    [`negative ${FIELDS[i]}`, d => { d.rows[0][i] = -1; }], [`excess ${FIELDS[i]}`, d => { d.rows[0][i] = 360; }],
  ]),
  ...Array.from({ length: 9 }, (_, i) => [`non-finite ${FIELDS[i + 10]}`, d => { d.rows[0][i + 10] = Infinity; }]),
  ['numeric string', d => { d.rows[0][10] = '15'; }],
]) test('validator rejects ' + label, () => {
  const d = valid(); mutate(d); const r = validate(d);
  assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, /::error::Orbit Census: row/);
});
test('JSON exponent overflow is rejected as non-finite', () => {
  const d = valid(); d.rows[0][16] = 'OVERFLOW';
  const r = validate(JSON.stringify(d).replace('"OVERFLOW"', '1e309'));
  assert.equal(r.status, 1, r.stderr); assert.match(r.stderr, /non-finite/);
});
test('valid orbital boundaries, Z/fractional epoch and signed drag/derivatives pass', () => {
  const d = valid(); Object.assign(d.rows[0], { 7: 0, 9: '2000-01-01T00:00:00.123456Z', 10: 20, 11: 0, 12: 180,
    13: 0, 14: 359.999, 15: 0, 16: -0.001, 17: -0.01, 18: -0.001 });
  const r = validate(d); assert.equal(r.status, 0, r.stderr);
});
for (const [epoch, accepted] of [
  ['2000-02-31T00:00:00', false], ['2001-02-29T00:00:00', false],
  ['1900-02-29T00:00:00', false], ['2000-02-29T00:00:00', true],
  ['2024-02-29T23:59:59.123456Z', true], ['2000-13-01T00:00:00', false],
  ['2000-00-01T00:00:00', false], ['2000-01-00T00:00:00', false],
  ['2000-04-31T00:00:00', false], ['2000-01-01T24:00:00', false],
  ['2000-01-01T00:60:00', false], ['2000-01-01T00:00:60', false],
  ['0000-01-01T00:00:00', false], ['2000-01-01T00:00:00', true],
]) test(`epoch calendar and UTC round-trip: ${epoch}`, () => {
  const d = valid(); d.rows[0][9] = epoch;
  const r = validate(d); assert.equal(r.status, accepted ? 0 : 1, r.stdout + r.stderr);
  if (!accepted) assert.match(r.stderr, /row 1: invalid epoch/);
});
for (const ending of ['', '\n', '\r\n']) test('CSV preserves quoted commas, escaped quotes and CRLF with ending ' + JSON.stringify(ending), () => {
  assert.deepEqual(parseCsv('NAME,TYPE\r\n"Name, ""quoted""\r\ncontinued",PAY' + ending),
    [{ NAME: 'Name, "quoted"\r\ncontinued', TYPE: 'PAY' }]);
});
for (const tail of ['\n', '\r\n', '\n\n', '\r\n\r\n', '\n\r\n\n']) test('CSV tolerates trailing blank lines ' + JSON.stringify(tail), () => {
  assert.deepEqual(parseCsv('NAME,TYPE\r\nISS,PAY\r\n' + tail), [{ NAME: 'ISS', TYPE: 'PAY' }]);
});
test('CSV rejects a blank line inside the records', () => {
  assert.throws(() => parseCsv('NAME,TYPE\r\nISS,PAY\r\n\r\nHST,PAY\r\n'), /Blank line/);
});
test('CSV preserves an empty quoted final field', () => {
  assert.deepEqual(parseCsv('NAME\r\n""'), [{ NAME: '' }]);
});
for (const csv of ['NAME\npart"quoted"', 'NAME\n"quoted"text', 'NAME\n"']) test('CSV rejects malformed quoting: ' + JSON.stringify(csv), () => {
  assert.throws(() => parseCsv(csv), /quote|quoted/);
});
const preload = new URL('./fixtures/catalogue-fetch.mjs', import.meta.url).href;
function build(scenario) {
  return spawnSync(process.execPath, ['--import', preload, path.join(root, 'demos/orbit-census/tools/build-catalog.mjs'), catalogue, scenario], { cwd: fixture, encoding: 'utf8' });
}
for (const [scenario, expectedBuild, expectedGate] of [
  ['complete', 0, 0], ['partial-gp', 0, 1], ['satcat-failed', 0, 1], ['all-gp-failed', 1, null],
  ['invalid-satcat', 0, 1], ['invalid-gp', 0, 1], ['one-missing-epoch', 0, 1], ['header-only', 0, 1],
  ['tiny-census', 0, 1], ['missing-header', 0, 1], ['bad-identifier', 0, 1], ['zero-identifier', 0, 1],
  ['fractional-identifier', 0, 1], ['unsafe-identifier', 0, 1], ['unknown-type', 0, 1],
  ['inherited-type', 0, 1], ['duplicate-identifier', 0, 1], ['out-of-range-gp', 0, 1],
  ['extra-column', 0, 1], ['truncated-row', 0, 1], ['unclosed-quote', 0, 1],
  ['missing-orbital-field', 1, null],
  ...['MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER',
    'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'].map(f => ['non-finite:' + f, 1, null]),
]) test('actual builder and exact workflow gate: ' + scenario, () => {
  fs.writeFileSync(catalogue, 'previous good catalogue');
  const b = build(scenario); assert.equal(b.status, expectedBuild, b.stdout + b.stderr);
  if (expectedGate === null) {
    assert.equal(fs.readFileSync(catalogue, 'utf8'), 'previous good catalogue');
    assert.match(b.stdout + b.stderr, /No GP group fetched|non-finite orbital/);
    return;
  }
  const doc = JSON.parse(fs.readFileSync(catalogue, 'utf8'));
  const badSatcat = ['satcat-failed', 'invalid-satcat', 'header-only', 'missing-header', 'bad-identifier',
    'zero-identifier', 'fractional-identifier', 'unsafe-identifier', 'unknown-type', 'inherited-type', 'duplicate-identifier',
    'extra-column', 'truncated-row', 'unclosed-quote'].includes(scenario);
  assert.equal(doc.satcat, !badSatcat);
  if (badSatcat) { assert.equal(doc.census, null); assert.match(doc.source, /SATCAT unavailable/); }
  if (scenario === 'complete') assert.deepEqual(doc.census, { total: 10000, PAY: 2500, 'R/B': 2500, DEB: 2500, UNK: 2500, decayed: 1 });
  if (scenario === 'tiny-census') assert.equal(doc.census.total, 1);
  const r = gate(); assert.equal(r.status, expectedGate, 'Builder:\n' + b.stdout + b.stderr + 'Gate:\n' + r.stdout + r.stderr);
  if (expectedGate) assert.match(r.stderr, /::error::Orbit Census/);
});
test('all workflow jobs retain the expected dependency and failure conditions', () => {
  const jobs = [...wf.split(/^jobs:\r?\n/m)[1].matchAll(/^  ([\w-]+):\r?\n/gm)].map(m => m[1]);
  assert.deepEqual(jobs, ['build', 'deploy', 'catalogue-health']); assert.doesNotMatch(wf, /continue-on-error/);
  assert.match(wf, /deploy:\r?\n    needs: build\r?\n    if: needs.build.result == 'success'/);
  assert.match(wf, /catalogue-health:[\s\S]*?needs: build\r?\n    if: always\(\) && needs.build.result != 'cancelled'/);
  assert.match(wf, /steps.orbitcat.outcome == 'success' && steps.orbitcheck.outcome == 'success' && 'success' \|\| 'failure'/);
});
test('health code fails for unsuccessful or unavailable acquisition outcomes', () => {
  const code = fs.readFileSync('scripts/catalogue-health.mjs', 'utf8');
  for (const outcome of ['success', 'failure', 'skipped', undefined]) {
    const process = { env: { CATALOGUE_OUTCOME: outcome } };
    vm.runInNewContext(code, { process, console: { log() {}, error() {} } });
    assert.equal(process.exitCode ?? 0, outcome === 'success' ? 0 : 1);
  }
});
