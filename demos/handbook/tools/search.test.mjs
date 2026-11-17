// Checks the handbook's search and code colouring without a browser. Usage: node search.test.mjs
import assert from 'node:assert/strict';
import { words, stem, answers, buildIndex, search, snippet, colour } from '../js/search.js';

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
// Every word asked for must be there, in any order. Little words are ignored, and on their own find nothing.
assert.deepEqual(ids('stale claim'), ['claims-stale']); assert.deepEqual(ids('claim stale'), ['claims-stale']); assert.deepEqual(ids('the stale claim'), ['claims-stale']); assert.deepEqual(ids('stale banana'), []); assert.deepEqual(ids('is'), [], 'a word too common to mean anything should find nothing'); assert.deepEqual(ids('the a of'), []);
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

// The forms of a word meet. Each pair has one stem, so a search for either finds the other.
for (const [a, b] of [['approve', 'approval'], ['approved', 'approvals'], ['verify', 'verified'], ['checking', 'checked'], ['archived', 'archive'], ['published', 'publishing'], ['statuses', 'status'], ['batches', 'batch'], ['delete', 'deleting'], ['claims', 'claim'], ['running', 'runs'], ['stopped', 'stop'], ['copies', 'copy'], ['pages', 'page']]) assert.equal(stem(a), stem(b), `${a} and ${b} do not meet: ${stem(a)}, ${stem(b)}`);
assert.equal(stem('class'), 'class'); assert.equal(stem('this'), 'this'); assert.equal(stem('42'), '42'); assert.ok(answers(stem('silence'), stem('silent')) > 0, 'silent does not find silence'); assert.equal(answers(stem('handover'), stem('handoff')), 0); assert.equal(answers('claim', 'banana'), 0);
{ const more = buildIndex([{ id: 'approvals', title: 'Approvals', sections: [{ id: 'approvals', heading: 'Approvals', text: 'Some things are the owner\u2019s to decide.' }, { id: 'approvals-what', heading: 'What needs a yes', text: 'Overwriting anything, or moving it to the archive. Publishing, deploying. Silence is not a yes.' }] },
    { id: 'safety', title: 'Safety', sections: [{ id: 'safety', heading: 'Safety', text: 'Short rules.' }, { id: 'safety-delete', heading: 'Never delete', text: 'Work is archived, not deleted.' }, { id: 'safety-people', heading: 'People\u2019s details stay private', text: 'Names and addresses.' }, { id: 'safety-code', heading: 'A sample', text: 'Here is one.', code: 'yaml goal: check the statuses of batches' }] }]), find = q => search(more, q).map(r => r.id);
  assert.equal(find('approve')[0], 'approvals'); assert.equal(find('approved')[0], 'approvals'); assert.deepEqual(find('archived').sort(), ['approvals-what', 'safety-delete']); assert.deepEqual(find('published'), ['approvals-what']); assert.deepEqual(find('silent'), ['approvals-what']); assert.deepEqual(find('deleting'), ['safety-delete']); assert.deepEqual(find('delete'), ['safety-delete']);
  // A possessive is its word: "owner's" finds the owner, and the stray "s" of "people's" is not a word that anything can find.
  assert.deepEqual(words('the owner\u2019s list, people\'s rooms, it\'s'), ['the', 'owner', 'list', 'people', 'rooms', 'it']); assert.deepEqual(find('owner\u2019s'), ['approvals']); assert.deepEqual(find("it's"), []); assert.deepEqual(find('s'), []); assert.deepEqual(find('people'), ['safety-people']);
  // Words that are only in a code sample, and the name of its language, still find the section. The snippet stays prose.
  assert.deepEqual(find('yaml'), ['safety-code']); assert.deepEqual(find('statuses'), ['safety-code']); assert.equal(search(more, 'batches')[0].snippet.map(p => p.text).join(''), 'Here is one.');
  // When there are more results than are shown, the count of the rest comes with them.
  const few = search(more, 'a', 1); assert.equal(few.length, 0); const cut = search(index, 'claim', 2); assert.equal(cut.length, 2); assert.equal(cut.more, 1); assert.equal(search(index, 'claim').more, 0); assert.equal(search(index, '').more, 0); }

// ---- Code colouring ----
const kinds = (code, lang) => colour(code, lang).filter(p => p.kind).map(p => [p.kind, p.text]);
// Whatever happens, the parts joined together are the sample exactly.
const samples = [['# post a claim\ngh issue comment 42 --body "CLAIM: the page checks."', 'bash'], ['goal: Check every page\nlimits:\n  - read only\nstop_if: more than 5 pages fail  # say so', 'yaml'], ['{\n  "lane": "WEBSITE CHECKS",\n  "issue": 42,\n  "may_publish": false\n}', 'json'], ['// look\nconst rows = await readRows(\'export.csv\');\nif (rows.length === 0) throw new Error(`ran ${1}`);', 'js'], ['plain text with "quotes" and 42', ''], ['', 'js'], ['"unclosed', 'js'], ['a\\"b "c\\"d"', 'js'], ['/* never closed', 'js']];
for (const [code, lang] of samples) { const parts = colour(code, lang); assert.equal(parts.map(p => p.text).join(''), code, `colouring changed a ${lang || 'plain'} sample`); assert.ok(parts.every(p => ['', 'comment', 'string', 'number', 'keyword', 'name'].includes(p.kind) && p.text.length > 0)); }
assert.deepEqual(colour('anything "at" all 42', ''), [{ text: 'anything "at" all 42', kind: '' }], 'a sample in no known language is left alone');
assert.deepEqual(kinds(samples[0][0], 'bash'), [['comment', '# post a claim'], ['name', 'gh'], ['number', '42'], ['string', '"CLAIM: the page checks."']]);
assert.deepEqual(kinds(samples[1][0], 'yaml'), [['name', 'goal'], ['name', 'limits'], ['name', 'stop_if'], ['comment', '# say so']]);
// In YAML a figure or a word such as "no" is coloured only when it is the whole value. Inside a sentence it is a word.
assert.deepEqual(kinds('limits:\n  - no changes to the live site\nissue: 42\nmay_publish: no\nnext: start at page 32\nwritten: "14:40"\nnote: a # b\ntag: "a # b"  # real', 'yaml'), [['name', 'limits'], ['name', 'issue'], ['number', '42'], ['name', 'may_publish'], ['keyword', 'no'], ['name', 'next'], ['name', 'written'], ['string', '"14:40"'], ['name', 'note'], ['comment', '# b'], ['name', 'tag'], ['string', '"a # b"'], ['comment', '# real']]);
assert.deepEqual(kinds(samples[2][0], 'json'), [['name', '"lane"'], ['string', '"WEBSITE CHECKS"'], ['name', '"issue"'], ['number', '42'], ['name', '"may_publish"'], ['keyword', 'false']]);
assert.deepEqual(kinds(samples[3][0], 'js'), [['comment', '// look'], ['keyword', 'const'], ['keyword', 'await'], ['name', 'readRows'], ['string', "'export.csv'"], ['keyword', 'if'], ['number', '0'], ['keyword', 'throw'], ['keyword', 'new'], ['name', 'Error'], ['string', '`ran '], ['number', '1'], ['string', '`']]);
// Inside ${ } in a template string is code, and is coloured as code.
assert.deepEqual(kinds('log(`verified: ${rows.length} rows`)', 'js'), [['name', 'log'], ['string', '`verified: '], ['string', ' rows`']]); assert.deepEqual(kinds('`a ${f(1)} b ${', 'js'), [['string', '`a '], ['name', 'f'], ['number', '1'], ['string', ' b $']]); assert.equal(colour('`a ${f(1)} b ${', 'js').map(p => p.text).join(''), '`a ${f(1)} b ${');
// A hash inside a word or a string is not a comment; a number inside a name is not a number.
assert.deepEqual(kinds('echo "a # b" c#d', 'bash'), [['keyword', 'echo'], ['string', '"a # b"']]); assert.deepEqual(kinds('page2 = v1.2', 'js'), []);
// A shell string may run over several lines; a JavaScript one in plain quotes may not.
assert.deepEqual(kinds('gh issue comment 42 --body "CLAIM: one.\nRoom: A. Started 14:05."', 'bash'), [['name', 'gh'], ['number', '42'], ['string', '"CLAIM: one.\nRoom: A. Started 14:05."']]); assert.deepEqual(kinds('const a = "open\nnext(1)', 'js').map(k => k[0]), ['keyword', 'string', 'name', 'number']);
console.log('ok  search: words folded, headings outrank text, 14 pairs of word forms meet, possessives are their words, code and its language are found, every word required in any order, odd input harmless, snippets are pieces of the real text; colouring: nine samples in five languages come back exactly as they went in, with comments, strings, numbers, keywords and names picked out');
