// Clicks every teardown control at three viewport sizes, on the full page and the embed.
// A control fails the run when it does not move the model, or when the page throws.
//
//   node demos/hoover-dam/teardown/tools/smoke.mjs
//   node demos/hoover-dam/teardown/tools/smoke.mjs --sizes=1440x900 --layouts=full
//
// Uses the installed Chrome when Playwright has not downloaded its own browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const port = Number(arg('port', '4173'));
const sizes = arg('sizes', '1440x900,1280x720,390x844').split(',');
const layouts = arg('layouts', 'full,embed').split(',');

const TYPES = {
  html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  svg: 'image/svg+xml', json: 'application/json', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', webp: 'image/webp', woff2: 'font/woff2',
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (file.endsWith(path.sep)) file = path.join(file, 'index.html');
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file).slice(1)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const fails = [];
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok ' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) fails.push(name);
}

async function launch() {
  const args = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
  try { return await chromium.launch({ channel: 'chrome', args }); }
  catch { return await chromium.launch({ args }); }
}

async function open(browser, layout, size) {
  const [w, h] = size.split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const q = layout === 'embed' ? 'layout=embed&' : '';
  await page.goto(`http://127.0.0.1:${port}/demos/hoover-dam/teardown/?${q}t=0&notour&q=0`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.teardown?.ready, null, { timeout: 30000 });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('boot')).pointerEvents === 'none');
  // The study model is already compiled. Skipping the composer keeps the physics
  // loop at frame rate on a machine with no GPU; the checks read that loop.
  await page.evaluate(() => { window.teardown.stage.render = () => {}; });
  return { page, errs };
}

async function click(page, sel) {
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded();
  await loc.click({ timeout: 8000 });
}

const read = (page, expr) => page.evaluate((e) => {
  const { film, seq, st, S, audio } = window.teardown;
  const playing = window.teardown.playing;
  return eval(e);
}, expr);

async function pressRange(page, id, key) {
  const loc = page.locator(`#${id}`);
  await loc.scrollIntoViewIfNeeded();
  await loc.focus();
  await page.keyboard.press(key);
}

async function runLayout(browser, layout, size) {
  console.log(`\n[${layout} ${size}]`);
  const { page, errs } = await open(browser, layout, size);
  const ev = (expr) => read(page, expr);

  const t0 = await ev(`film.t`);
  await click(page, '#play');
  await page.waitForFunction((start) => window.teardown.playing && window.teardown.film.t > start + 0.05, t0, { timeout: 8000 });
  const t1 = await ev(`film.t`);
  check('play moves the log', t1 > t0 + 0.05, `${t0.toFixed(2)} -> ${t1.toFixed(2)}`);
  await click(page, '#play');
  await page.waitForTimeout(60);
  check('pause', await ev(`playing`) === false);

  const at = await ev(`film.t`);
  await click(page, '#next');
  const next = await ev(`film.t`);
  check('next beat', next > at + 0.5, `${at.toFixed(2)} -> ${next.toFixed(2)}`);
  await click(page, '#back');
  const back = await ev(`film.t`);
  check('back beat', back < next - 0.5, `${back.toFixed(2)}`);

  await click(page, '#slow button[data-s="200"]');
  check('slow 1/200', await ev(`seq.slow`) === 200);
  await click(page, '#slow button[data-s="60"]');
  check('slow 1/60', await ev(`seq.slow`) === 60);
  await click(page, '#slow button[data-s="12"]');
  check('slow 1/12', await ev(`seq.slow`) === 12);
  await click(page, '#slow button[data-s="12"]');
  check('slow returns to 1x', await ev(`seq.slow`) === 1);

  if (layout === 'full') {
    if (!(await page.locator('#ctl').evaluate((el) => el.open))) await click(page, '#ctl summary');
    const scenes = { normal: [1065, 11000], peak: [1065, 13000], flood: [1218, 70000], drought: [1041, 7000] };
    for (const [name, [lake, inflow]] of Object.entries(scenes)) {
      await click(page, `#scn button[data-scn="${name}"]`);
      const got = await ev(`[st.lake, st.inflow]`);
      check(`scenario ${name}`, got[0] === lake && got[1] === inflow, `${got[0]} ft, ${got[1]} cfs`);
    }
    const gate0 = await ev(`st.units[12].gate`);
    await pressRange(page, 'gate', 'End');
    await page.waitForTimeout(40);
    const gateSoon = await ev(`st.units[12].gate`);
    await page.waitForTimeout(500);
    const gateLater = await ev(`st.units[12].gate`);
    check('gate slider has inertia', gateSoon < 0.98 && gateLater > gateSoon + 0.05, `${gate0.toFixed(2)} -> ${gateSoon.toFixed(2)} -> ${gateLater.toFixed(2)}`);
    await pressRange(page, 'lake', 'Home');
    check('lake slider', await ev(`st.lake`) === 895);
    await pressRange(page, 'inflow', 'End');
    check('inflow slider', await ev(`st.inflow`) === 120000);
    await pressRange(page, 'drum', 'Home');
    check('drum slider', await ev(`st.drum`) === 0);
    await pressRange(page, 'units', 'Home');
    check('units slider', await ev(`st.units.every(u => !u.on)`));

    for (const id of ['hero', 'dam', 'towers', 'penstocks', 'turbine', 'spillways', 'tunnels']) {
      await click(page, `#asm button[data-asm="${id}"]`);
      const focus = await ev(`S.focus`);
      check(`assembly ${id}`, id === 'hero' ? focus === null : focus === id, String(focus));
    }
    for (const d of ['labels', 'exploded', 'turntable', 'glass', 'cut', 'flow']) {
      const was = await ev(`document.querySelector('#disp button[data-d="${d}"]').classList.contains('on')`);
      await click(page, `#disp button[data-d="${d}"]`);
      const now = await ev(`document.querySelector('#disp button[data-d="${d}"]').classList.contains('on')`);
      check(`display ${d}`, now !== was);
    }
    const sys = await page.locator('#sysList li').count();
    check('subsystems listed', sys >= 7, String(sys));
    await click(page, '#sysList li');
    check('subsystem click', await ev(`S.focus`) === 'towers', String(await ev(`S.focus`)));
    if (await page.locator('#ubars .ub').first().isVisible()) {
      await click(page, '#ubars .ub');
      check('unit bar follows', await ev(`seq.follow`) === 0);
    }
    const tach = await page.locator('#cvTach').boundingBox();
    check('tachometer', !!tach && tach.width > 20, tach ? `${tach.width.toFixed(0)}px` : 'hidden');
  }

  await click(page, '#seq button[data-seq="a5"]');
  await page.waitForFunction(() => window.teardown.seq.kind === 'a5' && window.teardown.seq.run?.built, null, { timeout: 20000 });
  if (await ev(`playing`)) await click(page, '#play');
  check('A5 starts at standstill', await ev(`seq.run.phaseAt(0, 12)`) === 'stand');
  const tau0 = await ev(`seq.run.tau`);
  await click(page, '#play');
  await page.waitForFunction((start) => window.teardown.seq.run.tau > start + 0.15, tau0, { timeout: 8000 });
  const tau1 = await ev(`seq.run.tau`);
  check('A5 play', tau1 > tau0 + 0.15, `${tau0.toFixed(2)} -> ${tau1.toFixed(2)}`);
  await click(page, '#play');
  const exact = await page.evaluate(() => {
    const r = window.teardown.seq.run;
    const tau = r.tau, lake = r.state.lake, spin = r.state.units[12].spin;
    r.seek(0);
    r.seek(tau);
    return Math.abs(r.state.lake - lake) < 1e-6 && Math.abs((r.state.units[12].spin || 0) - (spin || 0)) < 1e-6;
  });
  check('scrub matches play', exact);

  const chart = page.locator('#chart');
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  check('chart has a box', !!box && box.width > 80 && box.height > 40, box ? `${box.width.toFixed(0)}x${box.height.toFixed(0)}` : 'none');
  if (box) {
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.88, box.y + box.height * 0.5, { steps: 8 });
    await page.mouse.up();
    const frac = await ev(`seq.run.tau / seq.run.duration`);
    check('chart scrub', frac > 0.6, frac.toFixed(2));
  }
  await click(page, '#next');
  const stepped = await ev(`seq.run.tau`);
  check('next phase', stepped >= 0 && stepped < 68);

  if (layout === 'full') {
    const raised = await ev(`seq.run.bounds(12).find(p => p.id === 'spill').t0`);
    await pressRange(page, 'drum', 'Home');
    await page.waitForTimeout(100);
    const lowered = await ev(`seq.run.bounds(12).find(p => p.id === 'spill').t0`);
    check('drum moves the spill boundary', lowered < raised - 0.5, `${lowered.toFixed(1)}s < ${raised.toFixed(1)}s`);
  }

  const hill = await page.locator('#cvHill').boundingBox();
  check('hill chart', !!hill && hill.width > 40 && hill.height > 20);

  await click(page, '#seq button[data-seq="day"]');
  await page.waitForFunction(() => window.teardown.seq.kind === 'day' && window.teardown.seq.run?.built, null, { timeout: 20000 });
  check('dispatch night, A5 off', await ev(`seq.run.phaseAt(2 / 24 * seq.run.duration, 12)`) === 'stand');
  check('dispatch peak, A5 on', await ev(`seq.run.phaseAt(17 / 24 * seq.run.duration, 12)`) !== 'stand');
  if (box) {
    const dayBox = await chart.boundingBox();
    const before = await ev(`seq.follow`);
    const yFrac = before < 4 ? 0.72 : 0.12;
    await page.mouse.click(dayBox.x + 40, dayBox.y + dayBox.height * yFrac);
    const follow = await ev(`seq.follow`);
    check('chart row follows a unit', follow !== before, `${before} -> ${follow}`);
  }
  if (layout === 'full') {
    await click(page, '#scn button[data-scn="flood"]');
    check('scenario during a sequence', await ev(`seq.ov.lake0`) === 1218);
  } else {
    await page.evaluate(() => {
      const g = window.teardown.model.S.ph.gens.find((x) => x.id === 'A5');
      const p = window.teardown.stage.camera.position.clone();
      g.group.getWorldPosition(p);
      window.teardown.stage.controls.target.copy(p);
      window.teardown.stage.camera.position.set(p.x + 120, p.y + 70, p.z + 160);
    });
    await page.waitForTimeout(500);
    const tags = await ev(`[...document.querySelectorAll('#tags .tag')].filter(e => e.style.display !== 'none').length`);
    check('follow tags', tags >= 1, String(tags));
    const gate = await page.locator('#gate').boundingBox();
    check('embed keeps the gate slider', !!gate && gate.width > 30);
    if (gate) {
      await page.mouse.click(gate.x + gate.width * 0.2, gate.y + gate.height / 2);
      await page.waitForTimeout(50);
      check('embed gate reaches the sequence', await ev(`seq.ov.gate != null && seq.ov.gate < 0.5`));
    }
  }

  await click(page, '#sound');
  await page.waitForTimeout(80);
  check('sound on', await ev(`audio.on`) === true && await ev(`document.getElementById('sound').classList.contains('on')`));
  await click(page, '#sound');
  check('sound off', await ev(`audio.on`) === false);

  await click(page, '#seq button[data-seq="log"]');
  check('operator log returns', await ev(`seq.kind === 'log' && seq.run === null`));

  const noisy = errs.filter((e) => !/favicon|Failed to load resource|fonts\.googleapis|fonts\.gstatic/i.test(e));
  check('no page errors', noisy.length === 0, noisy.slice(0, 3).join(' | '));
  await page.close();
}

const server = await serve();
const browser = await launch();
try {
  for (const layout of layouts) for (const size of sizes) await runLayout(browser, layout, size);
} finally {
  await browser.close();
  server.close();
}
console.log(fails.length ? `\n${fails.length} failed` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
