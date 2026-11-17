// Still Water: the walls, floors and ceilings as plain lists of numbers, with the light worked out once for every corner.
// No drawing library is used here, so the result can be checked in Node.
import { CELL, POOL_FLOOR, WATER_Y, PILLAR_R, floorAt } from './world.js';

const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];
export const KIND = { wall: 0, floor: 1, pool: 2, plaster: 3, sky: 4 };

export function buildRooms(world) {
  const pos = [], nor = [], light = [], kind = [], wet = [], idx = [], front = []; // front: a point just inside the room each corner belongs to
  const solid = (x, z) => { const c = world.cellAt(x, z); return !c || (!c.open && !c.pillar); };
  // A flat panel from corner p along u and v, cut into squares so the light can change across it.
  function panel(p, u, v, n, k, su, sv, room, lift) {
    const base = pos.length / 3, cx = u[1] * v[2] - u[2] * v[1], cy = u[2] * v[0] - u[0] * v[2], cz = u[0] * v[1] - u[1] * v[0], flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    for (let j = 0; j <= sv; j++) for (let i = 0; i <= su; i++) { const a = i / su, b = j / sv, x = p[0] + u[0] * a + v[0] * b, z = p[2] + u[2] * a + v[2] * b; let y = p[1] + u[1] * a + v[1] * b; if (lift) y = lift(x, z);
      pos.push(x, y, z); nor.push(n[0], n[1], n[2]); kind.push(k); front.push(x + (room[0] - x) * 0.04 + n[0] * 0.06, z + (room[1] - z) * 0.04 + n[2] * 0.06); }
    for (let j = 0; j < sv; j++) for (let i = 0; i < su; i++) { const a = base + j * (su + 1) + i, b = a + 1, c = a + su + 1, d = c + 1; if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); }
  }
  const h = CELL / 2, rows = hgt => Math.max(1, Math.round(hgt / 0.5));
  for (const c of world.cells) { if (!c.open && !c.pillar) continue; const room = [c.x, c.z], x0 = c.x - h, z0 = c.z - h;
    // Floor: level, or shelving down into a pool.
    if (c.pool) panel([x0, 0, z0], [CELL, 0, 0], [0, 0, CELL], [0, 1, 0], KIND.pool, 4, 4, room, (x, z) => floorAt(world, Math.min(Math.max(x, x0 + 1e-4), x0 + CELL - 1e-4), Math.min(Math.max(z, z0 + 1e-4), z0 + CELL - 1e-4)));
    else panel([x0, 0, z0], [CELL, 0, 0], [0, 0, CELL], [0, 1, 0], KIND.floor, 4, 4, room);
    // Ceiling, or a skylight: a short shaft up to a bright pane.
    if (c.sky) { const top = c.ceil + 0.7; panel([x0, top, z0], [CELL, 0, 0], [0, 0, CELL], [0, -1, 0], KIND.sky, 1, 1, room);
      panel([x0, c.ceil, z0], [CELL, 0, 0], [0, 0.7, 0], [0, 0, 1], KIND.plaster, 4, 2, room); panel([x0, c.ceil, z0 + CELL], [CELL, 0, 0], [0, 0.7, 0], [0, 0, -1], KIND.plaster, 4, 2, room);
      panel([x0, c.ceil, z0], [0, 0, CELL], [0, 0.7, 0], [1, 0, 0], KIND.plaster, 4, 2, room); panel([x0 + CELL, c.ceil, z0], [0, 0, CELL], [0, 0.7, 0], [-1, 0, 0], KIND.plaster, 4, 2, room); }
    else panel([x0, c.ceil, z0], [CELL, 0, 0], [0, 0, CELL], [0, -1, 0], KIND.plaster, 4, 4, room);
    // Walls: wherever the next square is solid, and above a doorway where the next room's ceiling is lower.
    for (const [dr, dc] of DIRS) { const n = world.cell(c.r + dr, c.c + dc), isWall = !n || (!n.open && !n.pillar); let from, to;
      if (isWall) { from = c.pool ? POOL_FLOOR : 0; to = c.ceil; } else if (n.ceil < c.ceil - 1e-6) { from = n.ceil; to = c.ceil; } else continue;
      const bx = c.x + dc * h, bz = c.z + dr * h, p = [bx - (dr ? h : 0), from, bz - (dc ? h : 0)], u = dr ? [CELL, 0, 0] : [0, 0, CELL];
      panel(p, u, [0, to - from, 0], [-dc, 0, -dr], KIND.wall, 4, rows(to - from), room); }
  }
  // Pillars: plain round columns standing in the water.
  for (const pl of world.pillars) { const seg = 20, base = pos.length / 3, tall = pl.top - POOL_FLOOR, rw = rows(tall);
    for (let j = 0; j <= rw; j++) for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a), x = pl.x + nx * PILLAR_R, z = pl.z + nz * PILLAR_R; pos.push(x, POOL_FLOOR + tall * j / rw, z); nor.push(nx, 0, nz); kind.push(KIND.plaster); front.push(x + nx * 0.2, z + nz * 0.2); }
    for (let j = 0; j < rw; j++) for (let i = 0; i < seg; i++) { const a = base + j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1; idx.push(a, c, b, b, c, d); } }

  // ---- Light, worked out once. Daylight falls from the skylights; a small lamp hangs in front of each photograph. ----
  const lamps = [...world.skylights.map(s => ({ x: s.x, y: s.y + 0.3, z: s.z, col: [1.0, 0.97, 0.9], power: 7, reach: 24, down: true })), ...world.photos.map(p => ({ x: p.x + p.nx * 0.9, y: 2.5, z: p.z + p.nz * 0.9, col: [1.0, 0.93, 0.82], power: 1.0, reach: 7, down: false }))];
  const sees = (ax, az, bx, bz) => { const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.45); for (let i = 1; i < n; i++) if (solid(ax + (bx - ax) * i / n, az + (bz - az) * i / n)) return false; return true; };
  const pools = world.cells.filter(c => c.pool), count = pos.length / 3;
  for (let v = 0; v < count; v++) { const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], nx = nor[v * 3], ny = nor[v * 3 + 1], nz = nor[v * 3 + 2], fx = front[v * 2], fz = front[v * 2 + 1];
    let r = 0.3, g = 0.36, b = 0.38; // the light that is everywhere
    for (const l of lamps) { const dx = l.x - x, dy = l.y - y, dz = l.z - z, d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2); if (d > l.reach) continue;
      const facing = Math.max(0, ((dx * nx + dy * ny + dz * nz) / d + 0.3) / 1.3), fall = l.power / (1 + 0.42 * d2) * Math.max(0, 1 - d / l.reach); if (facing * fall < 0.004) continue;
      const open = sees(fx, fz, l.x, l.z) ? 1 : 0.1; // a little light always finds its way round a corner
      const k = facing * fall * open; r += l.col[0] * k; g += l.col[1] * k; b += l.col[2] * k; }
    // Corners gather shadow: where floor or ceiling meets a wall, and where two walls meet.
    let shade = 1; if (Math.abs(ny) > 0.5) { if (solid(x + 0.02, z + 0.02) || solid(x - 0.02, z + 0.02) || solid(x + 0.02, z - 0.02) || solid(x - 0.02, z - 0.02)) shade = 0.74; }
    else if (kind[v] === KIND.wall) { const cell = world.cellAt(fx, fz), low = cell && cell.pool ? POOL_FLOOR : 0, top = cell ? cell.ceil : 3; if (y < low + 0.01 || y > top - 0.01) shade = 0.76; if (solid(fx - nz * 0.3, fz + nx * 0.3) || solid(fx + nz * 0.3, fz - nx * 0.3)) shade *= 0.84; }
    light.push(Math.min(2.2, r * shade), Math.min(2.2, g * shade), Math.min(2.2, b * shade));
    // How much moving water-light reaches this corner: full over a pool, fading across dry floor it can see.
    const own = world.cellAt(fx, fz); let w = own && own.pool ? 1 : 0;
    if (!w) for (const p of pools) { const d = Math.hypot(Math.max(Math.abs(x - p.x) - h, 0), Math.max(Math.abs(z - p.z) - h, 0)); if (d < 5 && 1 - d / 5 > w && sees(fx, fz, p.x, p.z)) w = 1 - d / 5; }
    wet.push(w);
  }
  // The water: one flat sheet over every pool square.
  const wpos = [], widx = []; for (const c of pools) { const b = wpos.length / 3; wpos.push(c.x - h, WATER_Y, c.z - h, c.x + h, WATER_Y, c.z - h, c.x - h, WATER_Y, c.z + h, c.x + h, WATER_Y, c.z + h); widx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
  return { position: new Float32Array(pos), normal: new Float32Array(nor), light: new Float32Array(light), kind: new Float32Array(kind), wet: new Float32Array(wet), index: new Uint32Array(idx), water: { position: new Float32Array(wpos), index: new Uint32Array(widx) }, lamps };
}
