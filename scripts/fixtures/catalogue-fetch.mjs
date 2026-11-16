// Extended from the PR 117 review fixture. No request leaves this process;
// scenario selection uses argv, without changing environment variables.
const scenario = process.argv[3];
globalThis.setTimeout = fn => { queueMicrotask(fn); return 0; };
const records = Array.from({ length: 2000 }, (_, i) => ({
  OBJECT_NAME: 'Fixture ' + i, NORAD_CAT_ID: i + 1, OBJECT_ID: '2000-001A',
  EPOCH: '2000-01-01T00:00:00', MEAN_MOTION: 15, ECCENTRICITY: 0.001,
  INCLINATION: 51.6, RA_OF_ASC_NODE: 10, ARG_OF_PERICENTER: 20, MEAN_ANOMALY: 30,
  BSTAR: 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
}));
if (scenario === 'invalid-gp') for (const row of records) delete row.EPOCH;
if (scenario === 'one-missing-epoch') delete records[0].EPOCH;
if (scenario.startsWith('non-finite:')) records[0][scenario.split(':')[1]] = Infinity;
if (scenario === 'out-of-range-gp') records[0].INCLINATION = 181;
if (scenario === 'missing-orbital-field') delete records[0].ECCENTRICITY;
const header = 'NORAD_CAT_ID,OBJECT_TYPE,DECAY_DATE,ORBIT_CENTER\n';
const types = ['PAY', 'R/B', 'DEB', 'UNK'];
const size = scenario === 'tiny-census' ? 1 : 10000;
let csv = header + Array.from({ length: size }, (_, i) => `${i + 1},"${types[i % 4]}",,EA\r\n`).join('');
// Exercise decayed and non-Earth exclusions in the actual census builder.
if (scenario === 'complete') csv += '10001,PAY,2000-01-01,EA\r\n10002,DEB,,SU\r\n';
if (scenario === 'invalid-satcat') csv = 'error\nbusy\n';
if (scenario === 'header-only') csv = header;
if (scenario === 'missing-header') csv = 'NORAD_CAT_ID,OBJECT_TYPE\n1,PAY\n';
if (scenario === 'bad-identifier') csv += 'no-id,PAY,,EA\n';
if (scenario === 'zero-identifier') csv += '0,PAY,,EA\n';
if (scenario === 'fractional-identifier') csv += '10000.5,PAY,,EA\n';
if (scenario === 'unsafe-identifier') csv += '9007199254740992,PAY,,EA\n';
if (scenario === 'unknown-type') csv += '10001,ALIEN,,EA\n';
if (scenario === 'inherited-type') csv += '10001,toString,,EA\n';
if (scenario === 'duplicate-identifier') csv += '1,PAY,,EA\n';
if (scenario === 'extra-column') csv += 'no-id,PAY,,EA,unexpected\n';
if (scenario === 'truncated-row') csv += '10001,PAY,\n';
if (scenario === 'unclosed-quote') csv += '10001,"PAY,,EA';
globalThis.fetch = async url => {
  const s = String(url);
  if (!s.startsWith('https://celestrak.org/')) throw Error('Unexpected fixture request');
  if (s.includes('gp.php')) {
    if (scenario === 'partial-gp' && new URL(s).searchParams.get('GROUP') === 'stations') throw Error('Fixture GP outage');
    if (scenario === 'all-gp-failed') throw Error('Fixture total GP outage');
    const fields = [...new Set(records.flatMap(Object.keys))];
    const body = fields.join(',')+'\n'+records.map(r=>fields.map(f=>r[f]??'').join(',')).join('\n');
    return { ok:true, status:200, text:async()=>body };
  }
  if (scenario === 'satcat-failed') throw Error('Fixture SATCAT outage');
  return { ok: true, status:200, text: async () => csv };
};
