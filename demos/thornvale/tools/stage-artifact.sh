#!/usr/bin/env bash
# Stage Thornvale as a self-contained claude.ai artifact folder (page body, styles, src, assets).
# three.js r187 loads from jsDelivr (npm three@0.187.0) through an import map, and the
# .glb models ship as base64 text because the artifact host does not serve .glb files.
# Usage: demos/thornvale/tools/stage-artifact.sh /path/to/out
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT=${1:?usage: stage-artifact.sh OUT_DIR}
rm -rf "$OUT"; mkdir -p "$OUT"
cp -r "$REPO/demos/thornvale/src" "$REPO/demos/thornvale/assets" "$REPO/demos/thornvale/styles.css" "$OUT/"
# three.js r187 comes from jsDelivr (npm three@0.187.0, identical to the vendored copy) via an import map
sed -i -e "s#'\.\./\.\./_shared/three-r187/build/three\.webgpu\.js'#'three/webgpu'#g" \
       -e "s#'\.\./\.\./_shared/three-r187/build/three\.tsl\.js'#'three/tsl'#g" \
       -e "s#'\.\./\.\./_shared/three-r187/addons/#'three/addons/#g" "$OUT"/src/*.js
# the artifact host does not serve .glb: ship each model as base64 text and parse it in the page
find "$OUT/assets" -name '*.glb' | while read -r g; do base64 -w0 "$g" > "$g.b64.txt"; rm "$g"; done
python3 - "$OUT/src/kit.js" "$OUT/src/character.js" <<'PY'
import re, sys
HELPER = """// Artifact build: models ship as base64 text, since the host does not serve .glb files.
async function loadGlbText(loader, url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  const text = await res.text();
  onProgress?.(1);
  const bin = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  return loader.parseAsync(bin.buffer, '');
}

"""
kit, char = sys.argv[1], sys.argv[2]
s = open(kit).read()
s, n = re.subn(r"loader\.loadAsync\(`\$\{base\}/thornvale-kit\.glb`, \(e\) => \{ if \(e\.total\) \{ pk = e\.loaded / e\.total; report\(\); \} \}\)",
               "loadGlbText(loader, `${base}/thornvale-kit.glb.b64.txt`, (f) => { pk = f; report(); })", s)
assert n == 1, ('kit', n)
s = re.sub(r"^export ", HELPER + "export ", s, count=1, flags=re.M)
open(kit, 'w').write(s)
s = open(char).read()
s, n = re.subn(r"loader\.loadAsync\(`\$\{base\}/Soldier\.glb`\)", "loadGlbText(loader, `${base}/Soldier.glb.b64.txt`)", s)
assert n == 1, ('character', n)
s = re.sub(r"^export ", HELPER + "export ", s, count=1, flags=re.M)
open(char, 'w').write(s)
PY
python3 - "$REPO/demos/thornvale/index.html" "$OUT/index.html" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
body = re.search(r'<body[^>]*>(.*)</body>', src, re.S).group(1)
body = re.sub(r'\s*<a class="lw-back"[^>]*>.*?</a>', '', body)
head = '''<title>Thornvale</title>
<meta name="description" content="A walled medieval hill town you can explore as a third-person character, fly over, or watch as a flyover, with a day and night cycle and weather. Every asset was modelled in Blender by Claude and assembled live in three.js." />
<link rel="stylesheet" href="styles.css" />
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.webgpu.js","three/webgpu":"https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.webgpu.js","three/tsl":"https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.tsl.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/"}}</script>
<style>:root { color-scheme: dark; } body { background: #0e0b08; }</style>
<script>document.body ? document.body.dataset.mode = 'flyover' : document.addEventListener('DOMContentLoaded', () => { document.body.dataset.mode = document.body.dataset.mode || 'flyover'; });</script>
'''
open(sys.argv[2], 'w').write(head + body.strip() + '\n')
PY
grep -rn "_shared" "$OUT/src" && { echo "unrewritten imports"; exit 1; } || true
echo "files: $(find "$OUT" -type f | wc -l)  size: $(du -sh "$OUT" | cut -f1)"
