/* R12 fix 3: 2x kill-frame crops for every take, and the cruiser-vs-carrier
   contact sheet. One headless page, closed at the end.
   Usage: node r12-fix3-sheet.mjs <shotsDir> <take> [<take> ...]  (take = e.g. fix3-carrier-t1) */
import { chromium } from '../../../node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

function findChromium() {
  const base = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  const b = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort((a, c) => Number(c.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of b) for (const r of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) { const p = path.join(base, d, r); if (fs.existsSync(p)) return p; }
}
const [dir, ...takes] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--headless=new'] });
const page = await browser.newPage();
const url = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const draw = async (spec) => page.evaluate(async (s) => {
  const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
  const c = document.createElement('canvas'); c.width = s.W; c.height = s.H; const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, s.W, s.H); x.imageSmoothingEnabled = false;
  for (const p of s.parts) {
    const im = await load(p.u);
    if (p.src) x.drawImage(im, p.src[0], p.src[1], p.src[2], p.src[3], p.dst[0], p.dst[1], p.dst[2], p.dst[3]);
    else x.drawImage(im, p.dst[0], p.dst[1]);
    if (p.label) { x.fillStyle = 'rgba(0,0,0,0.65)'; x.fillRect(p.dst[0], p.dst[1], 760, 26); x.fillStyle = '#fff'; x.font = '18px monospace'; x.fillText(p.label, p.dst[0] + 6, p.dst[1] + 19); }
  }
  return c.toDataURL('image/png');
}, spec);
const save = (f, d) => fs.writeFileSync(f, Buffer.from(d.split(',')[1], 'base64'));
for (const t of takes) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, t + '.json'), 'utf8'));
  const kill = j.saved.find((s) => /-kill\.png$/.test(s.file));
  if (!kill) continue;
  const hb = j.pre.hullBox; const side = Math.round(1.3 * Math.max(hb[2] - hb[0], hb[3] - hb[1]));
  const cx = (hb[0] + hb[2]) / 2; const cy = (hb[1] + hb[3]) / 2;
  const sx = Math.max(0, Math.round(cx - side / 2)); const sy = Math.max(0, Math.round(cy - side / 2));
  const d = await draw({ W: side * 2, H: side * 2, parts: [{ u: url(path.join(dir, kill.file)), src: [sx, sy, side, side], dst: [0, 0, side * 2, side * 2], label: `${t} kill frame +${kill.tMsFromKill} ms (2x)` }] });
  save(path.join(dir, t + '-kill-crop2x.png'), d);
}
const cr = path.join(dir, 'fix3-cruiser-strip.png'); const ca = path.join(dir, 'fix3-carrier-t1-strip.png');
if (fs.existsSync(cr) && fs.existsSync(ca)) {
  const d = await draw({ W: 1500, H: 1200, parts: [
    { u: url(cr), dst: [0, 0], label: 'CRUISER (620 m): chain walks the spine, sections let go as it passes' },
    { u: url(ca), dst: [0, 600], label: 'CARRIER (760 m): kill-frame burst, hangar flank, 4-way breakup' },
  ] });
  save(path.join(dir, 'fix3-sheet-cruiser-vs-carrier.png'), d);
}
await page.close();
await browser.close();
console.log('sheet done');
