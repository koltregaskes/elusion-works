#!/usr/bin/env node
/*
 * Turn This or That votes into a taste profile in Markdown.
 *
 * It runs the rater's own catalogue and scoring code, lifted from ../index.html,
 * so the profile always matches the "What it learned" tab.
 *
 * Usage:
 *   node taste-lab/tools/profile.mjs <votes> [--out profile.md] [--version N]
 *
 * <votes> is one of:
 *   - a JSON file holding an array of votes;
 *   - a directory of per-vote JSON files, for example the output of ArtifactData
 *     `list` with `out_dir`. Every *.json file below it is read, and a body
 *     wrapped as {data: {...}} is unwrapped.
 *
 * Kol's notes are personal, so write profiles somewhere private (Notion or
 * Linear), not into this public repo.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const out = flag("--out");
const version = flag("--version");
const src = args[0];
if (!src) { console.error("usage: profile.mjs <votes.json | votes-dir> [--out file] [--version N]"); process.exit(2); }

/* ---- Load votes ---- */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".json") ? [p] : [];
  });
}
const raw = fs.statSync(src).isDirectory()
  ? walk(src).map(f => JSON.parse(fs.readFileSync(f, "utf8")))
  : [].concat(JSON.parse(fs.readFileSync(src, "utf8")));
const votes = raw
  .map(v => (v && v.data && typeof v.data === "object" && v.data.cat ? { id: v.id, ...v.data } : v))
  .filter(v => v && v.cat && v.a && v.b && v.pick)
  .sort((x, y) => (x.at < y.at ? -1 : 1));
if (raw.length && !votes.length) { console.error(`Read ${raw.length} records but none look like votes.`); process.exit(1); }

/* ---- Lift the catalogue and scoring code out of the rater ---- */
const page = fs.readFileSync(path.join(here, "..", "index.html"), "utf8");
function slice(from, to) {
  const a = page.indexOf(from), b = page.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error(`index.html changed: cannot find "${from}" … "${to}"`);
  return page.slice(a, b);
}
const code = [
  slice("const THEME_TAGS", "/* ================= State"),
  slice("function score(catId)", "function allVotes()"),
  slice("function factorStats(catId)", "function renderTaste()"),
  "this.out = { CATS, score, factorStats, tasteMarkdown };"
].join("\n");
const ctx = { allVotes: () => votes, console };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const { CATS, tasteMarkdown } = ctx.out;

/* ---- Write the profile ---- */
const unknown = votes.filter(v => !CATS.some(c => c.id === v.cat));
let md = tasteMarkdown();
md = md.replace("# Taste profile from This or That", `# Taste profile from This or That${version ? `, version ${version}` : ""}`);
if (!votes.length) md += "\nNo votes yet. Nothing has been learned.\n";
if (unknown.length) md += `\nIgnored ${unknown.length} votes in categories this rater no longer has.\n`;
if (out) { fs.writeFileSync(out, md); console.error(`Wrote ${out} from ${votes.length} votes.`); }
else process.stdout.write(md);
