/**
 * Ashfall gameplay integration test, driven deterministically.
 *
 * The renderer runs at ~1.5 fps under SwiftShader and main.js clamps dt to 1/20 s, so simulated
 * time advances at about 7% of wall clock. Waiting on real time therefore tests almost nothing.
 * Instead this steps the subsystems directly, in the order main.js documents, at a fixed 1/60 s.
 * That decouples game logic from render speed and makes every assertion about simulated seconds.
 */
import { chromium } from 'playwright';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

await page.goto('http://127.0.0.1:8123/demos/ashfall/?capture=yard&quality=low', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => !!window.__ashfall, null, { timeout: 60000 });
await page.waitForTimeout(9000);

// Install a deterministic stepper that mirrors main.js's documented frame order.
await page.evaluate(() => {
  const g = window.__ashfall;
  g.input.locked = true;          // what pointer lock does after the player clicks Deploy
  g.state.mode = 'playing';
  window.__step = (frames, dt = 1 / 60) => {
    for (let i = 0; i < frames; i++) {
      g.clock.dt = dt;
      g.clock.time += dt;
      g.clock.frame++;
      for (const k of ['player', 'weapon', 'ballistics', 'ai', 'fx']) {
        try { g[k]?.update?.(dt, g); } catch (e) { window.__stepErr = k + ': ' + e.message; }
      }
      g.input.update?.(dt);       // consumes edge-triggered presses, as main.js does
    }
  };
});

const boot = await page.evaluate(() => {
  const g = window.__ashfall;
  return { failures: (g.failures || []).map((f) => f.where), enemies: g.ai?.enemies?.length ?? 0 };
});
check('no subsystem failures at boot', boot.failures.length === 0, boot.failures.join(', '));

/* --- movement: 1 simulated second of forward input ---------------------- */
const move = await page.evaluate(() => {
  const g = window.__ashfall;
  const s = g.player.position.clone();
  g.input.keys.add('KeyW');
  window.__step(60);
  g.input.keys.delete('KeyW');
  const e = g.player.position.clone();
  return { d: Math.hypot(e.x - s.x, e.z - s.z), speed: Math.hypot(g.player.velocity.x, g.player.velocity.z), err: window.__stepErr };
});
check('player walks at a plausible speed', move.d > 1.5 && move.d < 5.0,
  `${move.d.toFixed(2)} m in 1.0 s, terminal speed ${move.speed.toFixed(2)} m/s${move.err ? ' ERR ' + move.err : ''}`);

/* --- jump --------------------------------------------------------------- */
const jump = await page.evaluate(() => {
  const g = window.__ashfall;
  const y0 = g.player.position.y;
  // Jump reads the edge-triggered pressed() set, which only the real keydown handler in
  // input.js populates. Adding to input.keys directly never fires the edge, so an earlier
  // version of this test reported jump as broken for three runs when it was working fine.
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
  window.__step(1);
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
  let peak = y0;
  for (let i = 0; i < 40; i++) { window.__step(1); peak = Math.max(peak, g.player.position.y); }
  window.__step(90);
  return { rise: peak - y0, landed: g.player.onGround };
});
check('player jumps and lands', jump.rise > 0.4 && jump.landed, `rose ${jump.rise.toFixed(2)} m, onGround=${jump.landed}`);

/* --- firing ------------------------------------------------------------- */
const fire = await page.evaluate(() => {
  const g = window.__ashfall;
  let shots = 0, impacts = 0, hits = 0;
  const offs = [g.events.on('shot', () => shots++), g.events.on('impact', () => impacts++), g.events.on('hit', () => hits++)];
  const a0 = g.weapon.ammo;
  g.weapon.triggerDown();
  window.__step(60);             // 1.0 s of full-auto
  g.weapon.triggerUp();
  window.__step(30);
  offs.forEach((f) => f && f());
  return { a0, a1: g.weapon.ammo, shots, impacts, hits, err: window.__stepErr };
});
check('full-auto fires at a plausible rate', fire.shots >= 8 && fire.shots <= 20, `${fire.shots} rounds in 1.0 s (mk18 is 780 rpm = 13/s)`);
check('firing consumes ammo', fire.a1 < fire.a0, `${fire.a0} -> ${fire.a1}`);
check('rounds resolve against the world', fire.impacts + fire.hits > 0, `${fire.impacts} impacts, ${fire.hits} enemy hits`);

/* --- reload ------------------------------------------------------------- */
const reload = await page.evaluate(() => {
  const g = window.__ashfall;
  const phases = [];
  const off = g.events.on('reload', (p) => phases.push(p && p.phase));
  const before = g.weapon.ammo;
  g.weapon.reload();
  window.__step(240);            // 4 s, comfortably longer than the longest clip
  off && off();
  return { phases, before, after: g.weapon.ammo, reloading: g.weapon.reloading };
});
check('reload emits its phase sequence', reload.phases.length >= 2, reload.phases.join(' -> '));
check('reload refills the magazine', reload.after > reload.before, `${reload.before} -> ${reload.after}`);

/* --- weapon switching --------------------------------------------------- */
const swap = await page.evaluate(() => {
  const g = window.__ashfall;
  const first = g.weapon.current.id;
  const target = g.weapon.weapons.map((w) => w.id).find((i) => i !== first);
  g.weapon.switchTo(target);
  window.__step(180);
  return { first, target, now: g.weapon.current.id };
});
check('weapon switching works', swap.now === swap.target, `${swap.first} -> ${swap.now}`);

/* --- AI ----------------------------------------------------------------- */
const ai = await page.evaluate(() => {
  const g = window.__ashfall;
  const s = g.ai.enemies.map((e) => ({ x: e.position?.x ?? 0, z: e.position?.z ?? 0 }));
  window.__step(300);            // 5 s
  const e2 = g.ai.enemies.map((e) => ({ x: e.position?.x ?? 0, z: e.position?.z ?? 0, st: e.state }));
  let moved = 0;
  for (let i = 0; i < Math.min(s.length, e2.length); i++) if (Math.hypot(e2[i].x - s[i].x, e2[i].z - s[i].z) > 0.3) moved++;
  return { moved, total: e2.length, states: [...new Set(e2.map((e) => e.st))] };
});
check('enemies act under AI control', ai.moved > 0, `${ai.moved}/${ai.total} moved in 5 s; states: ${ai.states.join(', ')}`);

/* --- damage and death --------------------------------------------------- */
const dmg = await page.evaluate(() => {
  const g = window.__ashfall;
  const e = g.ai.enemies.find((x) => x.health > 0);
  if (!e) return { ok: false };
  const hp = e.health;
  let killed = 0;
  const off = g.events.on('kill', () => killed++);
  g.ai.damageEnemy(e, 500, e.position, true, { x: 0, y: 0, z: 1 });
  window.__step(120);
  off && off();
  return { ok: true, hp, after: e.health, killed };
});
check('lethal damage kills and emits kill', dmg.ok && dmg.after <= 0 && dmg.killed > 0, `${dmg.hp} -> ${dmg.after}, kill events ${dmg.killed}`);

const stepErr = await page.evaluate(() => window.__stepErr || null);
check('no exception thrown during simulation', !stepErr, stepErr || '');
const fatal = errs.filter((e) => !/ERR_CONNECTION_RESET|404|willReadFrequently|deprecated/i.test(e));
check('no console errors', fatal.length === 0, fatal.slice(0, 2).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
