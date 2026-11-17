// Checks on the finished film and its page, run in Node: node demos/efficiency-catch/tools/check.mjs
// Needs ffprobe and ffmpeg. It reads files only; it does not render anything.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
const here = new URL('..', import.meta.url).pathname, read = f => fs.readFileSync(here + f, 'utf8'), film = here + 'efficiency-catch.mp4';
const plain = s => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, '’').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”').replace(/&times;/g, '×').replace(/&ndash;/g, '–').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const SCENES = [[1, 0, 7.2], [2, 7.2, 7.2], [3, 14.4, 12], [4, 26.4, 12], [5, 38.4, 12], [6, 50.4, 21.6], [7, 72, 21.6]], LENGTH = 93.6; // scene, start, length: every start is a multiple of the 2.4 s bar
const scene = n => read(`tools/film/compositions/s${n}.html`), bare = s => s.toLowerCase().replace(/[“”.?!]/g, '').replace(/\s+/g, ' ').trim(), sentences = text => text.split(/(?<=[.?!”])\s+/).map(p => p.replace(/^\d\.\s*/, '').trim()).filter(Boolean);

// 1. The film file: what it is, how long, how loud, and that the picture is alive.
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', film], { encoding: 'utf8' }));
const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.find(s => s.codec_type === 'audio'), secs = Number(probe.format.duration), size = fs.statSync(film).size;
assert.equal(v.codec_name, 'h264'); assert.equal(v.width, 1920); assert.equal(v.height, 1080); assert.equal(v.pix_fmt, 'yuv420p', 'plays everywhere'); assert.equal(v.avg_frame_rate, '30/1');
assert.ok(Math.abs(secs - LENGTH) < 0.15, `the film runs ${secs} s, not ${LENGTH}`); assert.ok(a && a.codec_name === 'aac', 'the film has its music'); assert.ok(size < 14e6, `the film is ${(size / 1e6).toFixed(1)} MB`);
{ const bytes = fs.readFileSync(film); assert.ok(bytes.indexOf('moov') < bytes.indexOf('mdat'), 'the index is not at the front of the file, so it would not start playing until fully downloaded'); }
const meter = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', film, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr, summary = meter.slice(meter.lastIndexOf('Summary:'));
const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)[1]), peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)[1]); assert.ok(lufs > -27 && lufs < -16, `the music sits at ${lufs} LUFS`); assert.ok(peak < -1, `the music peaks at ${peak} dBFS`);
const frame = t => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', film, '-frames:v', '1', '-vf', 'scale=96:54', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1e7 });
const shots = [2.5, 5, 13, 21, 30, 36.5, 44, 49, 53, 63, 70, 74, 78, 86, 92].map(frame); for (const f of shots) { assert.equal(f.length, 96 * 54); let lo = 255, hi = 0; for (const p of f) { lo = Math.min(lo, p); hi = Math.max(hi, p); } assert.ok(lo < 40 && hi > 150, `a frame is flat (${lo} to ${hi})`); }
for (let i = 1; i < shots.length; i++) { let diff = 0; for (let k = 0; k < shots[i].length; k++) diff += Math.abs(shots[i][k] - shots[i - 1][k]); assert.ok(diff / shots[i].length > 1.5, 'two frames from different moments are the same picture'); }

// 2. The transcript: the page shows exactly the lines in transcript.json, in order, with distinct time labels; every line's words are on screen in its scene;
//    every sentence on screen is in the transcript; and each line's time is the moment its words are told to appear.
const lines = JSON.parse(read('tools/transcript.json')), page = read('index.html');
const shown = [...page.matchAll(/<li><button class="t" type="button" data-at="([\d.]+)" aria-describedby="(l\d+)" disabled><span class="sr">Play from <\/span>([^<]*)<\/button><span id="(l\d+)">([\s\S]*?)<\/span><\/li>/g)].map(m => ({ at: Number(m[1]), stamp: m[3], same: m[2] === m[4], text: plain(m[5]) }));
assert.equal(shown.length, lines.length, 'the page and transcript.json disagree about how many lines there are'); assert.equal(new Set(shown.map(s => s.stamp)).size, shown.length, 'two transcript buttons carry the same time');
// When does each scene tell something to appear? Read the animation calls themselves: up(...), slam(...), pop(...), fromTo(...), and the four rule cards.
const entrances = n => { const src = scene(n), out = new Set(); for (const m of src.matchAll(/\b(?:up|slam|pop)\("[^"]+",\s*([\d.]+)/g)) out.add(Number(m[1])); for (const m of src.matchAll(/\bfromTo\((?:"[^"]+"|\w+), \{[^{}]*\}, \{[^{}]*\}, ([\d.]+)\)/g)) out.add(Number(m[1]));
  const cards = /\[([\d., ]+)\]\.forEach\(\(t, i\) => \{ const r = "#r"/.exec(src), lead = /\}, t \+ ([\d.]+)\);/.exec(src); if (cards) for (const t of cards[1].split(',').map(Number).slice(1)) out.add(Math.round((t + Number(lead[1])) * 1000) / 1000); return out; };
lines.forEach((l, i) => { assert.ok(shown[i].same); assert.equal(shown[i].at, l.at); assert.equal(shown[i].text, l.text); assert.equal(shown[i].stamp, `${Math.floor(l.at / 60)}:${String(Math.floor(l.at % 60)).padStart(2, '0')}`);
  assert.ok(i === 0 || l.at > lines[i - 1].at, 'transcript lines are out of order'); const [, from, len] = SCENES[l.scene - 1]; assert.ok(l.at >= from && l.at < from + len, `line "${l.text}" is timed outside scene ${l.scene}`);
  assert.ok(entrances(l.scene).has(l.at), `nothing is told to appear at ${l.at} s in scene ${l.scene}, where the transcript puts "${l.text.slice(0, 40)}"`);
  const on = bare(plain(scene(l.scene))); for (const part of sentences(l.text)) assert.ok(on.includes(bare(part)), `"${part}" is in the transcript but not on screen in scene ${l.scene}`); });
const said = lines.map(l => bare(l.text)).join(' | ');
for (const [n] of SCENES) { const html = scene(n), at = html.indexOf('<div id="root"'), body = html.slice(html.indexOf('>', at) + 1, html.indexOf('<script>', at));
  for (const m of body.matchAll(/<(h1|h2|h3|div|p)\b([^>]*)>((?:(?!<(?:div|p|h\d|svg|section)\b)[\s\S])*?)<\/\1>/g)) { /* only elements that hold words directly, not boxes of other elements */
    if (/eyebrow|id="(byline|credit|pace|expectedlabel|plusai|barlabel\d|m\dv)"|class="(n|dots|track|fill|meter|lines)"/.test(m[2])) continue; const text = plain(m[3]); if (text.length < 12 || /^(Your output|Your capacity|\d)/.test(text)) continue;
    for (const part of sentences(text)) if (bare(part).length > 8) assert.ok(said.includes(bare(part)), `"${part}" is on screen in scene ${n} but missing from the transcript`); } }

// 3. The timing the page claims, checked in the source and in the finished film's sound.
const onGrid = (t, step) => Math.abs(t / step - Math.round(t / step)) < 1e-6, root = read('tools/film/index.html');
for (const [n, start, len] of SCENES) { assert.ok(onGrid(start, 2.4), `scene ${n} starts at ${start} s, which is not on a bar`); assert.ok(root.includes(`data-composition-src="compositions/s${n}.html" data-start="${start}" data-duration="${len}"`), `scene ${n} is not mounted at ${start} s for ${len} s`); assert.ok(scene(n).includes(`const T0 = ${start},`)); }
assert.equal(SCENES[6][1] + SCENES[6][2], LENGTH);
const bed = read('tools/make-bed.mjs'), accents = [...bed.slice(bed.indexOf('// Accents')).split('\n')[1].matchAll(/\[([\d.]+), [\d.]+\]/g)].map(m => Number(m[1])); assert.equal(accents.length, 6);
const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', film, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-'], { maxBuffer: 1e8 }), wave = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length >> 2);
const level = t => { let s = 0; const from = Math.round(t * 8000), n = 2400; for (let i = 0; i < n; i++) s += wave[from + i] ** 2; return 10 * Math.log10(s / n + 1e-12); }; // loudness of the 0.3 s from t
const lifts = accents.map(t => { assert.ok(onGrid(t, 0.6), `the accent at ${t} s is off the beat`); const sc = SCENES.find(([, s, l]) => t >= s && t < s + l)[0]; assert.ok(entrances(sc).has(t), `nothing is told to appear at the accent at ${t} s`);
  const lift = level(t) - level(t - 2.4); assert.ok(lift > 2.5, `the accent at ${t} s is only ${lift.toFixed(1)} dB above the same beat a bar earlier: it cannot be heard`); return lift; });

// 4. The words are Kol's: every sentence in the film is word for word in the essay (a copy is kept beside this file).
const essay = bare(read('tools/essay.md').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[’']/g, '’').replace(/["*#]/g, ''));
let extracts = 0; for (const l of lines) for (const part of sentences(l.text)) { const w = bare(part.replace(/[’']/g, '’')); assert.ok(essay.includes(w), `"${part}" is not in the essay word for word`); extracts++; }
console.log(`ok  words: all ${extracts} sentences in the film are word-for-word extracts from the essay`);
console.log(`ok  timing: seven scenes on 2.4 s bars; ${lines.length} transcript times each match an entrance in the source; six accents on the beat, each ${Math.min(...lifts).toFixed(1)} dB or more above the bar before in the finished sound`);
console.log(`ok  film: h264 1920x1080 at 30 frames a second, ${secs.toFixed(1)} s, ${(size / 1e6).toFixed(1)} MB, index at the front, music at ${lufs} LUFS peaking ${peak} dBFS; ${shots.length} frames checked; transcript matches the page and the scenes both ways`);
