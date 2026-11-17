// Kitchen Line: the game itself. The court, the ball, the rules of pickleball singles, the scoring and both players' brains.
// Nothing here draws or touches the page, so whole matches can be played and checked in Node.
// Units are metres and seconds. The net is at z = 0. You play at z > 0, facing the net; your rival is at z < 0. x runs across the court.

export const COURT = { halfW: 3.048, halfL: 6.706, kitchen: 2.134, netMid: 0.864, netPost: 0.914, postX: 3.35 }; // 20 by 44 feet, a 7 foot kitchen, a 34 to 36 inch net
export const BALL_R = 0.037, G = 9.81, REACH = 1.25, BOUNCE = 0.62, SKID = 0.8;
export const LEVELS = { easy: { speed: 3.5, react: 0.38, wild: 0.95, leave: 0.35 }, club: { speed: 4.4, react: 0.26, wild: 0.55, leave: 0.7 }, pro: { speed: 5.3, react: 0.16, wild: 0.28, leave: 0.93 } };
export const YOU = { speed: 5.4 };
export const ERR = { across: 0.9, along: 1.3, lift: 1.0 }; // how far a shot strays for each unit of wildness: metres across, metres along, metres a second of lift
export const WHY = { net: 'Into the net', out: 'Out', short: 'Did not cross the net', double: 'Two bounces', kitchen: 'Volley in the kitchen', twobounce: 'Volley before the ball had bounced on each side', serve: 'Serve missed the service court' };
export const netHeight = x => COURT.netMid + (COURT.netPost - COURT.netMid) * Math.min(1, Math.abs(x) / COURT.halfW);
const side = who => (who === 'p' ? 1 : -1), other = who => (who === 'p' ? 'r' : 'p'), clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// Random numbers from a seed, so a match can be played again exactly.
function seeded(seed) { let a = seed >>> 0; const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; next.bell = () => (next() + next() + next() + next() - 2) * 0.87; return next; } // bell: roughly a normal spread of 1

// Where each player stands for a serve. The server serves from their right-hand court when their own score is even, the left when odd, and the receiver stands opposite on the diagonal.
export function serveSpots(server, score) { const s = side(server), x = s * (score[server] % 2 === 0 ? 1 : -1) * 1.5; return { [server]: { x, z: s * (COURT.halfL + 0.35) }, [other(server)]: { x: -x, z: -s * (COURT.halfL + 0.3) } }; }

export function createMatch({ seed = 1, toWin = 11, level = 'club', youLevel = null, first = 'p' } = {}) {
  const m = { rng: seeded(seed), toWin, level, youLevel, score: { p: 0, r: 0 }, server: first, state: 'dead', timer: 1.2, t: 0, winner: null, call: null, events: [], mark: null, plan: {},
    ball: { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, held: true }, rally: { hits: 0, last: null, bounces: 0, serve: false, since: 0, volleys: 0 },
    who: { p: { x: 0, z: COURT.halfL, vx: 0, vz: 0, swing: 0, shot: null, aim: 0, cool: 0, think: 0 }, r: { x: 0, z: -COURT.halfL, vx: 0, vz: 0, swing: 0, shot: null, aim: 0, cool: 0, think: 0 } } };
  const spots = serveSpots(m.server, m.score); for (const w of ['p', 'r']) Object.assign(m.who[w], spots[w]); return m;
}

// ---- Shots ----
// A shot is a landing place and a flight time: the slowest ball that still clears the net by the margin the shot wants.
const SHOT = { smash: { depth: 4.3, wide: 2.3, clear: 0.12, pace: 19 }, drive: { depth: 5.0, wide: 2.3, clear: 0.26, pace: 15 }, dink: { depth: 1.25, wide: 2.2, clear: 0.2, pace: 6 }, lob: { depth: 5.6, wide: 2.0, clear: 2.6, pace: 9 }, serve: { depth: 4.9, wide: 0.95, clear: 0.5, pace: 12 } };
export function launch(from, to, shot) { const dx = to.x - from.x, dz = to.z - from.z, dist = Math.hypot(dx, dz), k = from.z / (from.z - to.z), xn = from.x + dx * k; // k: how far along its flight the ball crosses the net
  let T = Math.max(0.25, dist / shot.pace); for (; T < 3.2; T += 0.02) { const vy = (BALL_R - from.y + 0.5 * G * T * T) / T, tn = T * k; if (from.y + vy * tn - 0.5 * G * tn * tn >= netHeight(xn) + BALL_R + shot.clear) break; }
  return { vx: dx / T, vy: (BALL_R - from.y + 0.5 * G * T * T) / T, vz: dz / T, T }; }

function strike(m, who, kind, aim, wild) { const b = m.ball, s = side(who), shot = SHOT[kind], rally = m.rally, me = m.who[who];
  const from = { x: b.held ? me.x - s * 0.35 : b.x, y: b.held ? 0.8 : clamp(b.y, 0.25, 2.4), z: b.held ? me.z : b.z };
  const tx = kind === 'serve' ? -Math.sign(me.x) * 1.52 + clamp(aim, -1, 1) * shot.wide : clamp(aim, -1, 1) * shot.wide; // a serve goes to the middle of the court on the diagonal, give or take the aim
  const to = { x: tx + m.rng.bell() * wild * ERR.across, z: -s * (shot.depth + m.rng.bell() * wild * ERR.along) }, v = launch(from, to, shot);
  Object.assign(b, from, { vx: v.vx, vy: v.vy + m.rng.bell() * wild * ERR.lift, vz: v.vz, held: false }); rally.hits++; rally.last = who; rally.bounces = 0; rally.since = 0; rally.serve = kind === 'serve'; if (rally.serve) rally.half = -Math.sign(me.x); /* which half of the far court the serve must land in: fixed when it is struck, wherever the server runs afterwards */ me.cool = 0.45; me.swing = 0;
  m.plan = {}; m.mark = landing(m); m.events.push({ type: kind === 'serve' ? 'serve' : 'hit', by: who, shot: kind, x: from.x, y: from.y, z: from.z }); }

// Where the ball will next touch the court, if nothing hits it and the net does not stop it.
export function landing(m) { const b = { ...m.ball }; for (let i = 0; i < 480; i++) { const z0 = b.z; fly(b, 1 / 120); if (z0 * b.z < 0 && Math.abs(b.x) <= COURT.postX && b.y - BALL_R < netHeight(b.x)) return { x: b.x, z: 0, net: true }; if (b.y <= BALL_R && b.vy < 0) return { x: b.x, z: b.z, net: false, good: inCourt(m, b.x, b.z) }; } return null; }
function fly(b, dt) { b.vy -= G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; }
// Is a first bounce here good? Lines are in, except that a serve must land beyond the kitchen line and in the right half.
function inCourt(m, x, z) { const edge = 0.02, r = m.rally, hitter = r.last, onTheirSide = z * side(hitter) < 0; if (!onTheirSide) return false; if (Math.abs(x) > COURT.halfW + edge || Math.abs(z) > COURT.halfL + edge) return false;
  if (r.serve) { const half = r.half; if (x * half < -edge || Math.abs(z) <= COURT.kitchen + edge) return false; } return true; }

// ---- The rally ----
function fault(m, by, why) { if (m.state !== 'live') return; const server = m.server, x = m.ball.x, z = m.ball.z; m.events.push({ type: 'fault', by, why, x, z }); m.call = { by, why };
  if (by === server) { m.server = other(server); m.events.push({ type: 'sideout', to: m.server }); } else { m.score[server]++; m.events.push({ type: 'point', to: server }); }
  const lead = Math.abs(m.score.p - m.score.r), top = Math.max(m.score.p, m.score.r); if (top >= m.toWin && lead >= 2) { m.winner = m.score.p > m.score.r ? 'p' : 'r'; m.state = 'over'; m.events.push({ type: 'over', winner: m.winner }); } else { m.state = 'dead'; m.timer = 1.9; }
  m.mark = null; for (const w of ['p', 'r']) { m.who[w].swing = 0; m.who[w].think = 0; } }

// Can this player reach the ball now, and how cleanly? 1 is a ball in the middle of the paddle, 0 is a fingertip.
export function reach(m, who) { const b = m.ball, me = m.who[who], d = Math.hypot(b.x - me.x, b.z - me.z); if (b.held || b.z * side(who) <= 0 || d > REACH || b.y < 0.12 || b.y > 2.45) return -1; return clamp(1 - Math.max(0, d - 0.35) / (REACH - 0.35) * 0.8 - (b.y < 0.3 ? 0.2 : 0), 0, 1); }
function tryHit(m, who, wildness) { const me = m.who[who], r = m.rally; if (m.state !== 'live' || r.last === who || me.cool > 0) return false; const q = reach(m, who); if (q < 0) return false;
  if (r.bounces === 0) { // a volley: not before the ball has bounced once on each side, and never from the kitchen
    if (r.hits < 3) { me.swing = 0; fault(m, who, 'twobounce'); return true; } if (Math.abs(me.z) <= COURT.kitchen) { me.swing = 0; fault(m, who, 'kitchen'); return true; } }
  const b = m.ball, pace = Math.hypot(b.vx, b.vy, b.vz), press = 1 + clamp((pace - 9) / 7, 0, 1) * 0.9 + clamp((0.75 - r.since) / 0.75, 0, 1) * 1.6 + Math.min(2.6, r.volleys * 0.32); // a fast ball, one that comes back almost at once, or the sixth volley in a row: each is harder to place than the last
  const kind = (me.shot || 'drive') === 'drive' && b.y > 1.55 && Math.abs(b.z) < 5 ? 'smash' : me.shot || 'drive'; r.volleys = r.bounces === 0 ? r.volleys + 1 : 0; // a drive at a ball above the shoulder is a smash
  strike(m, who, kind, me.aim, wildness(q) * press); return true; }

// ---- A player's brain: where to run and when to swing. Used for the rival, and for you when the game plays itself. ----
function think(m, who, lv) { const me = m.who[who], foe = m.who[other(who)], s = side(who), b = m.ball, r = m.rally, out = { mx: 0, mz: 0, swing: null, aim: 0 };
  const go = (x, z) => { const dx = x - me.x, dz = z - me.z, d = Math.hypot(dx, dz); if (d > 0.08) { out.mx = dx / d * Math.min(1, d * 3); out.mz = dz / d * Math.min(1, d * 3); } };
  if (m.state === 'serve') { if (m.server === who && m.timer <= 0) { out.swing = 'serve'; out.aim = m.rng() * 2 - 1; } return out; }
  if (m.state !== 'live') return out;
  const mine = r.last !== who && (b.z * s > 0 || b.vz * s > 0); // the ball is coming to me, or is already on my side
  if (!mine) { const up = r.hits >= 2; go(clamp(b.x * 0.35, -1.6, 1.6), s * (up ? COURT.kitchen + 0.55 : COURT.halfL - 0.2)); return out; } // after the two bounces, come up to the kitchen line; before, stay back
  if (me.think > 0) return out; // still reading the shot
  let plan = m.plan[who]; if (!plan || plan.stamp !== r.hits * 10 + r.bounces) plan = m.plan[who] = intercept(m, who, lv);
  if (plan.leave) { go(clamp(b.x * 0.3, -1.5, 1.5), me.z); return out; } // judged to be going out: let it go
  go(plan.x, plan.z);
  const q = reach(m, who); if (q >= 0 && me.cool <= 0) { const legal = r.bounces > 0 || (r.hits >= 3 && Math.abs(me.z) > COURT.kitchen); // never volley unlawfully
    if (legal && (q > 0.55 || b.y < 0.75 && b.vy < 0 || r.bounces > 0 && b.vy < -0.5)) { const far = Math.abs(foe.z) > 4.4, near = Math.abs(foe.z) < 3.1, high = b.y > 1.35 || r.bounces === 0, roll = m.rng();
      out.swing = high ? 'drive' : far && roll < 0.45 ? 'dink' : near && roll < 0.3 ? 'lob' : Math.abs(b.z) < 3 && roll < 0.5 ? 'dink' : 'drive'; out.aim = clamp(-Math.sign(foe.x || (m.rng() - 0.5)) * (0.45 + m.rng() * 0.55) + m.rng.bell() * 0.2, -1, 1); } }
  return out; }
// Where to meet the ball: on the volley if that is lawful and comfortable, otherwise after its bounce, a little before it starts to fall away.
function intercept(m, who, lv) { const s = side(who), r = m.rally, b = { ...m.ball }, plan = { stamp: r.hits * 10 + r.bounces, x: b.x, z: s * 4, leave: false }; let bounced = r.bounces > 0, best = null;
  if (!bounced) { const land = landing(m); if (land && !land.net && !land.good) { const close = Math.max(Math.abs(land.x) - COURT.halfW, Math.abs(land.z) - COURT.halfL), sure = close > 0.5 ? 1 : close > 0.15 ? 0.85 : 0.5; plan.leave = m.rng() < lv.leave * sure; if (plan.leave) return plan; } } // a ball judged to be going out is left alone; the nearer the line, the harder the call
  for (let i = 0; i < 420; i++) { const z0 = b.z; fly(b, 1 / 120); if (z0 * b.z < 0 && Math.abs(b.x) <= COURT.postX && b.y - BALL_R < netHeight(b.x)) break; // it will hit the net
    if (b.y <= BALL_R && b.vy < 0) { if (bounced) break; bounced = true; b.y = BALL_R; b.vy = -b.vy * BOUNCE; b.vx *= SKID; b.vz *= SKID; continue; }
    if (b.z * s <= 0.2) continue; const volley = !bounced, lawful = bounced || (r.hits >= 3 && Math.abs(b.z) > COURT.kitchen + 0.5);
    if (!lawful || b.y < 0.45 || b.y > (volley ? 1.7 : 1.5)) continue; const cost = Math.hypot(b.x - m.who[who].x, b.z - m.who[who].z) / lv.speed - i / 120; // can I get there before the ball does?
    if (!best || (cost < 0 && (best.cost >= 0 || volley === best.volley && Math.abs(b.y - 0.95) < Math.abs(best.y - 0.95))) || (best.cost >= 0 && cost < best.cost)) best = { x: b.x, y: b.y, z: b.z, cost, volley }; if (best && best.cost < 0 && volley && b.y < 1.2) break; }
  if (best) { plan.x = best.x; plan.z = best.z + s * 0.25; } return plan; }

// ---- One step of the match. input is what you are doing: { mx, mz } from -1 to 1, swing: 'drive' | 'dink' | 'lob' when pressed, aim from -1 to 1, or auto: true to let the game play your side. ----
export function step(m, dt, input = {}) { m.events = []; if (m.state === 'over') return m; m.t += dt; m.timer -= dt; const youLv = LEVELS[m.youLevel] || null;
  const act = { p: input.auto || youLv ? think(m, 'p', youLv || LEVELS.club) : { mx: clamp(input.mx || 0, -1, 1), mz: clamp(input.mz || 0, -1, 1), swing: input.swing || null, aim: input.aim || 0 }, r: think(m, 'r', LEVELS[m.level]) };
  const auto = { p: input.auto || !!youLv, r: true }, speed = { p: youLv ? youLv.speed : YOU.speed, r: LEVELS[m.level].speed };
  if (m.state === 'dead') { const spots = serveSpots(m.server, m.score); for (const w of ['p', 'r']) { const me = m.who[w], dx = spots[w].x - me.x, dz = spots[w].z - me.z, d = Math.hypot(dx, dz), v = Math.min(6, d / dt); me.vx = d > 1e-6 ? dx / d * v : 0; me.vz = d > 1e-6 ? dz / d * v : 0; me.x += me.vx * dt; me.z += me.vz * dt; }
    if (m.timer <= 0) { for (const w of ['p', 'r']) Object.assign(m.who[w], spots[w], { vx: 0, vz: 0, swing: 0, cool: 0 }); m.state = 'serve'; m.timer = auto[m.server] ? 0.9 : 0; m.rally = { hits: 0, last: null, bounces: 0, serve: false, since: 0, volleys: 0 }; m.call = null; m.ball.held = true; m.events.push({ type: 'ready', server: m.server }); } }
  else for (const w of ['p', 'r']) { const me = m.who[w], s = side(w), a = act[w], hold = m.state === 'serve'; me.cool = Math.max(0, me.cool - dt); me.think = Math.max(0, me.think - dt); // players stand still for a serve
    const wantX = hold ? 0 : a.mx * speed[w], wantZ = hold ? 0 : a.mz * speed[w], ease = 1 - Math.exp(-dt * 14); me.vx += (wantX - me.vx) * ease; me.vz += (wantZ - me.vz) * ease; me.x = clamp(me.x + me.vx * dt, -5.2, 5.2); me.z = s * clamp((me.z + me.vz * dt) * s, 0.45, 9.2);
    if (a.swing && me.swing <= 0 && me.cool <= 0) { me.swing = 0.24; me.shot = a.swing; me.aim = a.aim; m.events.push({ type: 'swing', by: w }); } else if (me.swing > 0) me.aim = auto[w] ? me.aim : a.aim; }
  if (m.ball.held) { const sv = m.who[m.server], s = side(m.server); Object.assign(m.ball, { x: sv.x - s * 0.35, y: 0.8, z: sv.z, vx: 0, vy: 0, vz: 0 }); }
  if (m.state === 'serve') { const sv = m.who[m.server]; if (sv.swing > 0) { m.state = 'live'; const lv = auto[m.server] ? (m.server === 'p' ? youLv || LEVELS.club : LEVELS[m.level]).wild * 0.5 : 0.22; strike(m, m.server, 'serve', sv.aim, lv); m.who[other(m.server)].think = (auto[other(m.server)] ? (m.server === 'r' ? youLv || LEVELS.club : LEVELS[m.level]).react : 0); } return m; }
  // The ball, in small steps so that it cannot pass through the net or the ground between two of them.
  const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n, b = m.ball; for (let i = 0; i < n && !b.held; i++) {
    for (const w of ['p', 'r']) { const me = m.who[w]; if (me.swing > 0) { const lv = w === 'p' ? youLv : LEVELS[m.level], was = m.rally.hits; tryHit(m, w, q => (auto[w] ? (lv || LEVELS.club).wild * (1.25 - q * 0.6) : 0.12 + (1 - q) * 0.95)); me.swing = Math.max(0, me.swing - h); if (m.rally.hits !== was) m.who[other(w)].think = auto[other(w)] ? ((other(w) === 'p' ? youLv : LEVELS[m.level]) || LEVELS.club).react : 0; else if (me.swing <= 0 && m.state === 'live') m.events.push({ type: 'miss', by: w }); } }
    const z0 = b.z, x0 = b.x, y0 = b.y; fly(b, h); m.rally.since += h;
    if (z0 * b.z < 0 || (z0 !== 0 && b.z === 0)) { const k = z0 / (z0 - b.z), xn = x0 + (b.x - x0) * k, yn = y0 + (b.y - y0) * k; if (Math.abs(xn) <= COURT.postX && yn - BALL_R < netHeight(xn)) { b.x = xn; b.y = yn; b.z = Math.sign(z0) * 0.04; b.vz *= -0.12; b.vx *= 0.3; b.vy = Math.min(b.vy, 0) * 0.3; m.events.push({ type: 'net', x: xn, y: yn }); fault(m, m.rally.last, 'net'); } }
    if (b.y <= BALL_R && b.vy < 0) { b.y = BALL_R; const r = m.rally, live = m.state === 'live'; if (live) { r.bounces++; if (r.bounces === 1) { const good = inCourt(m, b.x, b.z); m.events.push({ type: 'bounce', x: b.x, z: b.z, good }); if (!good) fault(m, r.last, b.z * side(r.last) > 0 ? 'short' : r.serve ? 'serve' : 'out'); else m.mark = null; } else { m.events.push({ type: 'bounce', x: b.x, z: b.z, good: true }); fault(m, other(r.last), 'double'); } } else if (Math.abs(b.vy) > 1.2) m.events.push({ type: 'bounce', x: b.x, z: b.z, good: true, dead: true });
      b.vy = -b.vy * BOUNCE; b.vx *= SKID; b.vz *= SKID; if (b.vy < 0.5) { b.vy = 0; b.vx *= 0.9; b.vz *= 0.9; } } }
  return m; }

// Play a whole match with both sides on their brains. For checks, and for the game's own demonstration.
export function playOut(opts, limit = 600 * 60) { const m = createMatch(opts), log = []; let steps = 0; while (m.state !== 'over' && steps++ < limit) { step(m, 1 / 60, { auto: true }); for (const e of m.events) log.push({ ...e, t: m.t, score: { ...m.score }, server: m.server }); } return { m, log, steps }; }
export const sayScore = m => `${m.score[m.server]} to ${m.score[other(m.server)]}`; // the server's score is called first
