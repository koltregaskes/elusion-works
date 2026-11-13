// Head-to-head personality measurement for Void Sovereign (headless sim).
// usage (repo root): node demos/void-sovereign/tools/personality-h2h.mjs demos/void-sovereign <pA> <pB> <seeds,comma> [variant] [diffA] [diffB]
// Plays each seed twice (A as blue then A as amber). variant "noswarmbias"
// clears Swarm's build bias in-process. Unsupported variants are rejected.
import { pathToFileURL } from 'node:url';
const [gameDir, pA, pB, seedsArg, variant = 'base', dA = 'normal', dB = 'normal'] = process.argv.slice(2);
if (!['base', 'noswarmbias'].includes(variant) && !variant.startsWith('bias=') && !variant.startsWith('patch=')) {
  throw new Error(`Unsupported variant: ${variant}. Use base, noswarmbias, bias=<JSON> or patch=<JSON>.`);
}
const imp = (p) => import(pathToFileURL(`${gameDir}/${p}`).href);
const { World } = await imp('src/sim/world.js');
const { PERSONALITY } = await imp('src/sim/ai.js');
if (variant === 'noswarmbias') PERSONALITY.swarm.bias = {};
if (variant.startsWith('bias=')) PERSONALITY.swarm.bias = JSON.parse(variant.slice(5));
// patch={"swarm":{"collectors":0},"warden":{"knobs":{...}}} shallow-merges per personality
if (variant.startsWith('patch=')) {
  for (const [id, p] of Object.entries(JSON.parse(variant.slice(6)))) Object.assign(PERSONALITY[id], p);
}
const seeds = seedsArg.split(',').map(Number);
const STEP = 1 / 30, LIMIT = 30 * 60 * 75;
let aWins = 0, n = 0;
for (const seed of seeds) {
  for (const aTeam of [0, 1]) {
    const blue = aTeam === 0 ? [pA, dA] : [pB, dB];
    const amber = aTeam === 0 ? [pB, dB] : [pA, dA];
    const w = new World({ seed, options: { pace: 'standard', ai: {
      player: true, playerPersonality: blue[0], playerDifficulty: blue[1],
      personality: amber[0], difficulty: amber[1] } } });
    const got = w.commanders.map((c) => `${c.team}:${c.personality}/${c.difficulty}`).join(' ');
    let i = 0; const t0 = Date.now();
    while (!w.over && i < LIMIT) { w.tick(STEP); i++; }
    const win = w.winner === aTeam; if (win) aWins++; n++;
    console.log(`seed ${seed} A=${pA}/${dA} on team ${aTeam} [${got}] -> winner ${w.winner} ${win ? 'A' : 'B'} at ${(w.time / 60).toFixed(1)} min (${w.endReason}) ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    w.dispose();
  }
}
console.log(`RESULT variant=${variant} ${pA}/${dA} beats ${pB}/${dB}: ${aWins} of ${n}`);
