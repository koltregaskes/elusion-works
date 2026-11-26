// Frame-exact 60 fps recorder for the teardown.
//
// One virtual clock drives performance.now, requestAnimationFrame, setTimeout
// and CSS animations. Each frame steps that clock by 1/60 s and then takes a
// screenshot, so play, scrub and the lake land on the same state as a seek to
// that time. Pointer events are the browser's own events. A drawn cursor is
// composited into the frames because a screenshot does not include the system pointer.
//
// The virtual clock follows the approach in the MIT-licensed Inkworks recorder
// (Moh4696/inkworks-skill). This file is original.
//
//   node demos/hoover-dam/teardown/tools/record.mjs --check
//   node demos/hoover-dam/teardown/tools/record.mjs --frames 180 --out /tmp/hoover-a5.mp4
//
// --check plays one virtual second and checks the driver, the lake and the
// rotor against a fresh seek to the same time. It writes no video.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
function arg(name, fallback) {
  const flag = process.argv.indexOf(`--${name}`);
  if (flag >= 0 && process.argv[flag + 1]) return process.argv[flag + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : fallback;
}
const frames = Number(arg('frames', '60'));
const out = arg('out', '/tmp/hoover-a5.mp4');
const checkOnly = process.argv.includes('--check');
const port = Number(arg('port', '4174'));
const FPS = 60;
const DT = 1 / FPS;

const CLOCK = `(() => {
  let t = 0, n = 1;
  const queue = [];
  const timers = [];
  const tracked = new WeakMap();
  performance.now = () => t;
  const raf = (cb) => { const i = n++; queue.push({ i, cb }); return i; };
  const caf = (i) => { const k = queue.findIndex((q) => q.i === i); if (k >= 0) queue.splice(k, 1); };
  const later = (cb, ms, args, every) => {
    const i = n++;
    timers.push({ i, at: t + Math.max(0, ms || 0), cb, args, every: every || 0 });
    return i;
  };
  const cancel = (i) => { const k = timers.findIndex((x) => x.i === i); if (k >= 0) timers.splice(k, 1); };
  window.requestAnimationFrame = raf;
  window.cancelAnimationFrame = caf;
  window.setTimeout = (cb, ms, ...args) => later(cb, ms, args, 0);
  window.clearTimeout = cancel;
  window.setInterval = (cb, ms, ...args) => later(cb, ms, args, ms || 0);
  window.clearInterval = cancel;
  function syncAnims() {
    const boot = document.getElementById('boot');
    if (boot && !boot.classList.contains('done')) return;
    for (const a of document.getAnimations()) {
      if (a.effect && a.effect.target && a.effect.target.id === 'boot') continue;
      if (!tracked.has(a)) tracked.set(a, t);
      try { a.pause(); a.currentTime = Math.max(0, t - tracked.get(a)); } catch (e) {}
    }
  }
  window.__clock = {
    now: () => t,
    step(dt) {
      // performance.now and CSS animation time are milliseconds.
      t += dt * 1000;
      const due = timers.filter((x) => x.at <= t + 1e-9).sort((a, b) => a.at - b.at);
      for (const x of due) {
        const k = timers.indexOf(x);
        if (k < 0) continue;
        timers.splice(k, 1);
        try { x.cb(...x.args); } catch (e) { console.error(e); }
        if (x.every) { x.at = t + x.every; timers.push(x); }
      }
      const batch = queue.splice(0, queue.length);
      for (const f of batch) { try { f.cb(t); } catch (e) { console.error(e); } }
      syncAnims();
    },
  };
})();`;

const TYPES = {
  html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
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

async function launch() {
  const args = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
  try { return await chromium.launch({ channel: 'chrome', args }); }
  catch { return await chromium.launch({ args }); }
}

function ffmpeg(dir, file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', [
      '-y', '-framerate', String(FPS), '-i', path.join(dir, 'frame-%04d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file,
    ], { stdio: 'inherit' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

const server = await serve();
const browser = await launch();
const dir = checkOnly ? null : fs.mkdtempSync(path.join('/tmp', 'hoover-frames-'));
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.addInitScript(CLOCK);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/demos/hoover-dam/teardown/?layout=embed&seq=a5&notour&q=0`, { waitUntil: 'domcontentloaded' });
  let ready = false;
  for (let i = 0; i < 900 && !ready; i++) {
    ready = await page.evaluate(() => !!window.teardown?.ready);
    if (!ready) await page.evaluate((dt) => window.__clock.step(dt), DT);
  }
  if (!ready) throw new Error('teardown did not become ready under the virtual clock');
  for (let i = 0; i < 5; i++) await page.evaluate((dt) => window.__clock.step(dt), DT);
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'rec-cursor';
    d.style.cssText = 'position:fixed;z-index:80;width:18px;height:18px;pointer-events:none;background:center/contain no-repeat url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27%3E%3Cpath d=%27M3 2l7 19 2.6-7.4L20 11z%27 fill=%27%23ff5a1f%27 stroke=%27%23fff%27 stroke-width=%271.5%27/%3E%3C/svg%3E")';
    document.body.appendChild(d);
    window.__cursor = (x, y) => { d.style.transform = `translate(${x}px, ${y}px)`; };
  });
  await page.evaluate(() => {
    const t = window.teardown;
    if (t.playing) t.togglePlay();
    t.seq.run.seek(0);
  });
  const play = await page.locator('#play').boundingBox();
  await page.mouse.move(play.x + play.width / 2, play.y + play.height / 2);
  await page.evaluate((p) => window.__cursor(p.x, p.y), { x: play.x + 8, y: play.y + 8 });
  await page.mouse.click(play.x + play.width / 2, play.y + play.height / 2);

  const log = [];
  const n = checkOnly ? FPS : frames;
  for (let i = 0; i < n; i++) {
    await page.evaluate((dt) => window.__clock.step(dt), DT);
    if (i % 15 === 0 || i === n - 1) {
      log.push(await page.evaluate(() => ({
        frame: Math.round(window.__clock.now() / 1000 * 60),
        tau: window.teardown.seq.run.tau,
        lake: window.teardown.seq.run.state.lake,
        spin: window.teardown.seq.run.state.units[12].spin,
      })));
    }
    if (dir) {
      await page.evaluate((p) => window.__cursor(p.x, p.y), { x: 180 + i * 4, y: 520 });
      await page.screenshot({ path: path.join(dir, `frame-${String(i).padStart(4, '0')}.png`) });
    }
  }
  const sample = await page.evaluate(() => {
    const r = window.teardown.seq.run;
    const played = { tau: r.tau, lake: r.state.lake, spin: r.state.units[12].spin || 0 };
    r.seek(0);
    r.seek(played.tau);
    return {
      played,
      sought: { tau: r.tau, lake: r.state.lake, spin: r.state.units[12].spin || 0 },
    };
  });
  const tauErr = Math.abs(sample.played.tau - n * DT);
  const lakeErr = Math.abs(sample.played.lake - sample.sought.lake);
  const spinErr = Math.abs(sample.played.spin - sample.sought.spin);
  console.log(log.map((s) => `t=${(s.frame / 60).toFixed(2)} tau=${s.tau.toFixed(3)} lake=${s.lake.toFixed(3)}`).join('\n'));
  console.log(`tau error ${tauErr.toExponential(2)} s, lake error ${lakeErr.toExponential(2)} ft, spin error ${spinErr.toExponential(2)} rad`);
  if (errs.length) console.log('page errors:', errs.slice(0, 4).join(' | '));
  if (tauErr > 1e-4 || lakeErr > 1e-4 || spinErr > 1e-4 || errs.length) {
    throw new Error('recording is not frame-exact');
  }
  if (dir) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await ffmpeg(dir, out);
    console.log(`wrote ${out}`);
  } else console.log('check passed');
} finally {
  await browser.close();
  server.close();
}
