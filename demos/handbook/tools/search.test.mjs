// Checks the handbook's search and code colouring without a browser. Usage: node search.test.mjs
import assert from 'node:assert/strict';
import { words, buildIndex, search, snippet, colour } from '../js/search.js';

const pages = [
  { id: 'claims', title: 'Claims', sections: [{ id: 'claims', heading: 'Claims', text: 'A claim is how two agents avoid doing the same work.' }, { id: 'claims-format', heading: 'What a claim looks like', text: 'A claim is a comment on the issue. It is signed.' }, { id: 'claims-stale', heading: 'Stale claims', text: 'A claim with no word after it for a working day is stale. Nobody takes it over quietly.' }] },
  { id: 'handovers', title: 'Handovers', sections: [{ id: 'handovers', heading: 'Handovers', text: 'A handover is written for an agent who knows nothing.' }, { id: 'handovers-test', heading: 'The test', text: 'Read it as a stranger. Could you start work in five minutes without opening the old conversation? A stale handover is worse than none.' }] },
  { id: 'evidence', title: 'Evidence', sections: [{ id: 'evidence', heading: 'Evidence', text: 'A report is only as good as what stands behind it.' }, { id: 'evidence-zero', heading: 'Exit code 0 is not proof', text: 'A command that finishes without an error has only proved that it finished. Look at the café menu, the file, the page.' }] },
], index = buildIndex(pages), ids = q => search(index, q).map(r => r.id);

// Words: lower case, accents folded, punctuation dropped.
assert.deepEqual(words('Exit code 0 is NOT proof, café!'), ['exit', 'code', '0', 'is', 'not', 'proof', 'cafe']); assert.deepEqual(words('  '), []);
// A word in a heading outranks the same word in the text; the page's own section comes first for its own name.
assert.deepEqual(ids('stale'), ['claims-stale', 'handovers-test']); assert.equal(ids('claims')[0], 'claims'); assert.equal(ids('handover')[0], 'handovers');
// Plurals, beginnings of words, capitals and accents.
assert.deepEqual(ids('claim').slice().sort(), ['claims', 'claims-format', 'claims-stale']); assert.ok(ids('hand').includes('handovers') && ids('hand').includes('handovers-test')); assert.deepEqual(ids('STALE'), ids('stale')); assert.deepEqual(ids('cafe'), ['evidence-zero']); assert.deepEqual(ids('café'), ['evidence-zero']);
// Every word asked for must be there, in any order. Little words are ignored unless they are all there is.
assert.deepEqual(ids('stale claim'), ['claims-stale']); assert.deepEqual(ids('claim stale'), ['claims-stale']); assert.deepEqual(ids('the stale claim'), ['claims-stale']); assert.deepEqual(ids('stale banana'), []); assert.ok(ids('is').length > 0, 'a search for a little word alone finds nothing');
assert.deepEqual(ids('exit code 0'), ['evidence-zero']); assert.deepEqual(ids('0'), ['evidence-zero']);
// Nothing asked, nothing found; nonsense finds nothing; odd input does no harm.
for (const q of ['', '   ', '!!!', 'zzzz', '<script>', '.*', '\\']) assert.deepEqual(ids(q), q.trim() && /[a-z0-9]/i.test(q) ? ids(q) : []); assert.deepEqual(ids('zzzz'), []); assert.deepEqual(ids('<script>'), []);
// A single letter does not match every word that begins with it.
assert.deepEqual(ids('s'), []); assert.ok(ids('st').length > 0);
// Results carry what the page needs, best first, and no more than asked.
{ const r = search(index, 'claim'); assert.ok(r.every((x, i) => i === 0 || r[i - 1].score >= x.score)); assert.deepEqual(Object.keys(r[0]).sort(), ['heading', 'id', 'page', 'pageTitle', 'score', 'snippet']); assert.equal(search(index, 'a', 2).length <= 2, true); }
// The snippet is a piece of the real text with the found words marked, and nothing else changed.
{ const text = pages[1].sections[1].text, parts = snippet(text, ['stale']), joined = parts.map(p => p.text).join(''); assert.deepEqual(parts.filter(p => p.hit).map(p => p.text), ['stale']); assert.ok(text.includes(joined.replace(/^… /, '').replace(/ …$/, '')), 'the snippet is not a piece of the text: ' + joined); assert.ok(joined.length <= 130);
  const none = snippet('Short text.', ['zebra']); assert.deepEqual(none, [{ text: 'Short text.', hit: false }]); const multi = snippet('Claim it, then release the claim.', ['claim']); assert.deepEqual(multi.filter(p => p.hit).map(p => p.text), ['Claim', 'claim']); assert.equal(multi.map(p => p.text).join(''), 'Claim it, then release the claim.'); }

// ---- Code colouring ----
const kinds = (code, lang) => colour(code, lang).filter(p => p.kind).map(p => [p.kind, p.text]);
// Whatever happens, the parts joined together are the sample exactly.
const samples = [['# post a claim\ngh issue comment 42 --body "CLAIM: the page checks."', 'bash'], ['goal: Check every page\nlimits:\n  - read only\nstop_if: more than 5 pages fail  # say so', 'yaml'], ['{\n  "lane": "WEBSITE CHECKS",\n  "issue": 42,\n  "may_publish": false\n}', 'json'], ['// look\nconst rows = await readRows(\'export.csv\');\nif (rows.length === 0) throw new Error(`ran ${1}`);', 'js'], ['plain text with "quotes" and 42', ''], ['', 'js'], ['"unclosed', 'js'], ['a\\"b "c\\"d"', 'js'], ['/* never closed', 'js']];
for (const [code, lang] of samples) { const parts = colour(code, lang); assert.equal(parts.map(p => p.text).join(''), code, `colouring changed a ${lang || 'plain'} sample`); assert.ok(parts.every(p => ['', 'comment', 'string', 'number', 'keyword', 'name'].includes(p.kind) && p.text.length > 0)); }
assert.deepEqual(colour('anything "at" all 42', ''), [{ text: 'anything "at" all 42', kind: '' }], 'a sample in no known language is left alone');
assert.deepEqual(kinds(samples[0][0], 'bash'), [['comment', '# post a claim'], ['name', 'gh'], ['number', '42'], ['string', '"CLAIM: the page checks."']]);
assert.deepEqual(kinds(samples[1][0], 'yaml'), [['name', 'goal'], ['name', 'limits'], ['name', 'stop_if'], ['number', '5'], ['comment', '# say so']]);
assert.deepEqual(kinds(samples[2][0], 'json'), [['name', '"lane"'], ['string', '"WEBSITE CHECKS"'], ['name', '"issue"'], ['number', '42'], ['name', '"may_publish"'], ['keyword', 'false']]);
assert.deepEqual(kinds(samples[3][0], 'js'), [['comment', '// look'], ['keyword', 'const'], ['keyword', 'await'], ['name', 'readRows'], ['string', "'export.csv'"], ['keyword', 'if'], ['number', '0'], ['keyword', 'new'], ['name', 'Error'], ['string', '`ran ${1}`']]);
// A hash inside a word or a string is not a comment; a number inside a name is not a number.
assert.deepEqual(kinds('echo "a # b" c#d', 'bash'), [['keyword', 'echo'], ['string', '"a # b"']]); assert.deepEqual(kinds('page2 = v1.2', 'js'), []);
// A shell string may run over several lines; a JavaScript one in plain quotes may not.
assert.deepEqual(kinds('gh issue comment 42 --body "CLAIM: one.\nRoom: A. Started 14:05."', 'bash'), [['name', 'gh'], ['number', '42'], ['string', '"CLAIM: one.\nRoom: A. Started 14:05."']]); assert.deepEqual(kinds('const a = "open\nnext(1)', 'js').map(k => k[0]), ['keyword', 'string', 'name', 'number']);
console.log('ok  search: words folded, headings outrank text, plurals and beginnings of words, every word required in any order, odd input harmless, snippets are pieces of the real text; colouring: nine samples in five languages come back exactly as they went in, with comments, strings, numbers, keywords and names picked out');
