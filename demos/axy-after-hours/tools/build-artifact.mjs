// Builds the single-file version of this demo for a Claude artifact, from the same source.
// Run: node demos/axy-after-hours/tools/build-artifact.mjs <output.html>
// Differences from the site version, all mechanical: fonts come from Google Fonts (the only font host
// an artifact may use), the script is inlined, and the document wrapper is left to the artifact host.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(dir, 'index.html'), 'utf8'), js = readFileSync(join(dir, 'app.js'), 'utf8');
const pick = (re, what) => { const m = html.match(re); if (!m) throw new Error('Could not find ' + what); return m[1]; };
let css = pick(/<style>([\s\S]*?)<\/style>/, 'the style block');
const fontFaces = css.match(/^\s*@font-face[^\n]*\n/gm) || [];
if (fontFaces.length !== 3) throw new Error('Expected three @font-face rules, found ' + fontFaces.length);
for (const rule of fontFaces) css = css.replace(rule, '');
let body = pick(/<body>([\s\S]*?)<\/body>/, 'the body').replace(/<script type="module" src="app\.js"><\/script>/, '');
if (js.includes('</script')) throw new Error('The script cannot be inlined safely');
const out = `<title>Axy After Hours</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Outfit:wght@300;500;700;800&family=Plus+Jakarta+Sans:wght@400;500;700&display=swap">
<style>${css}</style>
${body.trim()}
<script type="module">
${js}
</script>
`;
writeFileSync(process.argv[2], out);
console.log(`wrote ${process.argv[2]} (${(out.length / 1024).toFixed(1)} KB)`);
