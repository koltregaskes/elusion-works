// Still Water: the place itself. A plan of the rooms, where the photographs hang, and the rules for walking about.
// Nothing here draws or touches the page, so all of it can be checked without a screen.
export const CELL = 2; // metres to a square of the plan
export const SLOPE = 1.2; // metres over which a pool shelves down from dry floor
export const EYE = 1.62, RADIUS = 0.32, POOL_FLOOR = -0.7, WATER_Y = -0.25, PILLAR_R = 0.5;

// # wall   . floor   , low passage   ~ pool   * skylight over floor   % skylight over pool   o pillar standing in a pool
// S where you come in   a to l: a photograph hangs on this piece of wall
export const PLAN = [
  '############################',
  '#####a###b###c##############',
  '####.............###########',
  '####.S..*...*....d##########',
  '####.............###########',
  '######,#######,#############',
  '######,#######,#############',
  '#........#~~~~~~~~~~~~..e###',
  'h....*...#~~~%~~~~%~~~..####',
  '#........,~~~~~~~~~~~~..####',
  'i........#~~o~~~~~~o~~..f###',
  '#....*...,~~~~~~~~~~~~..####',
  'j........#~~~%~~~~%~~~..####',
  '#........#~~~~~~~~~~~~..g###',
  '######,#######~~######,#####',
  '######,#######~~######,#####',
  '####.......###~~###......###',
  '###k...*...###~~###..*...###',
  '####.......###~~###......###',
  '###########~~~~~~~~#########',
  '###########~~~%%~~~#########',
  '###########~~~~~~~~#########',
  '##############l#############',
  '############################',
];
// Ceiling heights in metres by block of the plan: [first row, first column, last row, last column, height]. Later blocks win.
const CEILINGS = [[0, 0, 23, 27, 3.0], [7, 0, 13, 8, 3.4], [7, 10, 13, 23, 5.2], [14, 14, 18, 15, 2.5], [19, 11, 21, 18, 4.2]];
export const ORDER = 'abcdefglkjih'; // the walk round: plate 1 is a, plate 12 is h

const ROWS = PLAN.length, COLS = PLAN[0].length;
const at = (r, c) => (r < 0 || c < 0 || r >= ROWS || c >= COLS ? '#' : PLAN[r][c]);
const isPool = ch => ch === '~' || ch === '%' || ch === 'o';
const isOpen = ch => ch === '.' || ch === ',' || ch === 'S' || ch === '*' || ch === '~' || ch === '%'; // a square you can stand in
const DIRS = [[-1, 0, 'n'], [0, 1, 'e'], [1, 0, 's'], [0, -1, 'w']];

export function makeWorld() {
  for (const row of PLAN) if (row.length !== COLS) throw new Error('the plan has a ragged row');
  const cells = [], photos = [], skylights = [], pillars = []; let start = null;
  const ceil = (r, c) => { let h = 3; for (const [r0, c0, r1, c1, v] of CEILINGS) if (r >= r0 && r <= r1 && c >= c0 && c <= c1) h = v; return at(r, c) === ',' ? 2.4 : h; };
  const centre = (r, c) => [(c + 0.5 - COLS / 2) * CELL, (r + 0.5 - ROWS / 2) * CELL];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ch = at(r, c), [x, z] = centre(r, c), cell = { r, c, ch, x, z, open: isOpen(ch), pool: isPool(ch), floor: isPool(ch) ? POOL_FLOOR : 0, ceil: ceil(r, c), pillar: ch === 'o', sky: ch === '*' || ch === '%' };
    cells.push(cell);
    if (ch === 'S') start = cell; if (cell.sky) skylights.push({ x, z, y: cell.ceil, r, c }); if (cell.pillar) pillars.push({ x, z, r: PILLAR_R, top: cell.ceil });
    if (ch >= 'a' && ch <= 'l') { // a photograph: it faces the one open square beside its piece of wall
      const faces = DIRS.filter(([dr, dc]) => isOpen(at(r + dr, c + dc))); if (faces.length !== 1) throw new Error(`photograph ${ch} must face exactly one open square, not ${faces.length}`);
      const [dr, dc] = faces[0]; let free = 0; while (isOpen(at(r + dr * (free + 1), c + dc * (free + 1)))) free++;
      photos.push({ id: ch, r, c, nx: dc, nz: dr, x: x + dc * CELL / 2, z: z + dr * CELL / 2, y: 1.55, front: { r: r + dr, c: c + dc }, free: free * CELL, yaw: Math.atan2(dc, dr) }); // yaw: the way you face to look at it
    }
  }
  if (!start) throw new Error('the plan has no way in');
  photos.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id)); photos.forEach((p, i) => { p.plate = i + 1; });
  if (photos.length !== ORDER.length) throw new Error('the walk round and the plan disagree about the photographs');
  const world = { rows: ROWS, cols: COLS, cells, photos, skylights, pillars, start, width: COLS * CELL, depth: ROWS * CELL };
  world.cell = (r, c) => (r < 0 || c < 0 || r >= ROWS || c >= COLS ? null : cells[r * COLS + c]);
  world.cellAt = (x, z) => world.cell(Math.floor(z / CELL + ROWS / 2), Math.floor(x / CELL + COLS / 2));
  return world;
}

// Is a body of this radius clear of every wall and pillar here?
export function clear(world, x, z, rad = RADIUS) {
  const r0 = Math.floor((z - rad) / CELL + world.rows / 2), r1 = Math.floor((z + rad) / CELL + world.rows / 2), c0 = Math.floor((x - rad) / CELL + world.cols / 2), c1 = Math.floor((x + rad) / CELL + world.cols / 2);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const cell = world.cell(r, c);
    if (!cell) return false;
    if (cell.pillar) { if (Math.hypot(x - cell.x, z - cell.z) < PILLAR_R + rad) return false; continue; }
    if (cell.open) continue;
    const dx = Math.max(Math.abs(x - cell.x) - CELL / 2, 0), dz = Math.max(Math.abs(z - cell.z) - CELL / 2, 0); if (dx * dx + dz * dz < rad * rad) return false; }
  return true;
}
// The height of the floor under a point: level ground, or the bottom of a pool, with a short slope where they meet so you wade in.
export function floorAt(world, x, z) {
  const cell = world.cellAt(x, z); if (!cell || (!cell.open && !cell.pillar)) return 0; if (!cell.pool) return 0;
  let edge = Infinity; // distance to the nearest dry square, corners included, so the slope has no steps in it
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const n = world.cell(cell.r + dr, cell.c + dc); if (!n || !n.open || n.pool) continue; edge = Math.min(edge, Math.hypot(Math.max(Math.abs(x - n.x) - CELL / 2, 0), Math.max(Math.abs(z - n.z) - CELL / 2, 0))); }
  return edge < SLOPE ? POOL_FLOOR * (edge / SLOPE) : POOL_FLOOR;
}

// The eye follows the floor smoothly, and never faster than 1.8 m a second, so a slow frame cannot jolt the view.
function settle(me, floor, dt) { const dy = floor + EYE - me.y; me.y += Math.sign(dy) * Math.min(Math.abs(dy) * Math.min(1, dt * 9), 1.8 * dt); }
export function newWalker(world) { const s = world.start; return { x: s.x, z: s.z, y: EYE, yaw: -Math.PI / 2, pitch: 0, wade: 0, moved: 0 }; } // facing east down the lobby
// One step of walking. input: forward and strafe from -1 to 1, turn in radians a second. Walls stop you; you slide along them.
export function walk(world, me, input, dt) {
  dt = Math.min(Math.max(dt, 0), 0.1);
  me.yaw += (input.turn || 0) * dt; me.yaw = Math.atan2(Math.sin(me.yaw), Math.cos(me.yaw));
  let f = Math.max(-1, Math.min(1, input.forward || 0)), s = Math.max(-1, Math.min(1, input.strafe || 0)); const len = Math.hypot(f, s); if (len > 1) { f /= len; s /= len; }
  const speed = (2.7 - 1.2 * me.wade) * dt, fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw); // yaw 0 looks north, up the plan
  const dx = (fx * f - fz * s) * speed, dz = (fz * f + fx * s) * speed, x0 = me.x, z0 = me.z;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1)); // small moves, so nothing thin is ever stepped through
  for (let i = 0; i < n; i++) { if (clear(world, me.x + dx / n, me.z)) me.x += dx / n; if (clear(world, me.x, me.z + dz / n)) me.z += dz / n; }
  me.moved = Math.hypot(me.x - x0, me.z - z0);
  const floor = floorAt(world, me.x, me.z); settle(me, floor, dt); me.wade = Math.max(0, Math.min(1, (WATER_Y - floor) / (WATER_Y - POOL_FLOOR)));
  return me;
}

// Where to stand to look at a photograph from `dist` metres, kept inside the room.
export function viewPoint(world, photo, dist = 1.7) { const d = Math.max(0.9, Math.min(dist, 5, photo.free - RADIUS - 0.15)); return { x: photo.x + photo.nx * d, z: photo.z + photo.nz * d, yaw: photo.yaw, dist: d }; }
// Is the straight line between two points clear to walk?
export function clearLine(world, ax, az, bx, bz, rad = RADIUS + 0.08) { const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2)); for (let i = 0; i <= n; i++) if (!clear(world, ax + (bx - ax) * i / n, az + (bz - az) * i / n, rad)) return false; return true; }
// A walking route from a point to a point: across the squares of the plan, then straightened wherever a straight line is clear.
export function route(world, ax, az, bx, bz) {
  let a = world.cellAt(ax, az); const b = world.cellAt(bx, bz); if (!a || !b || !b.open) return null;
  if (!a.open) { let near = null, nd = Infinity; for (const [dr, dc] of DIRS) { const n = world.cell(a.r + dr, a.c + dc); if (n && n.open && Math.hypot(n.x - ax, n.z - az) < nd) { nd = Math.hypot(n.x - ax, n.z - az); near = n; } } if (!near) return null; a = near; } // beside a pillar: start from the next square
  const prev = new Map([[a, null]]), queue = [a];
  for (let q = 0; q < queue.length && !prev.has(b); q++) { const cur = queue[q]; for (const [dr, dc] of DIRS) { const n = world.cell(cur.r + dr, cur.c + dc); if (n && n.open && !prev.has(n)) { prev.set(n, cur); queue.push(n); } } }
  if (!prev.has(b)) return null;
  const mid = []; for (let cur = b; cur; cur = prev.get(cur)) mid.push([cur.x, cur.z]); mid.reverse();
  const pts = [[ax, az], ...mid, [bx, bz]], out = [pts[0]];
  for (let i = 0; i < pts.length - 1;) { let j = pts.length - 1; while (j > i + 1 && !clearLine(world, pts[i][0], pts[i][1], pts[j][0], pts[j][1])) j--; out.push(pts[j]); i = j; }
  return out;
}
// Follow a route: move `me` along it at walking pace and turn to face the way you are going, then the photograph at the end.
// Returns true when you have arrived.
export function follow(world, me, path, endYaw, dt, pace = 3.2) {
  dt = Math.min(Math.max(dt, 0), 0.1); let left = pace * (1 - 0.35 * me.wade) * dt, look = null;
  while (left > 0 && path.length) { const [tx, tz] = path[0], d = Math.hypot(tx - me.x, tz - me.z); if (d <= left) { me.x = tx; me.z = tz; left -= d; path.shift(); } else { look = Math.atan2(-(tx - me.x), -(tz - me.z)); me.x += (tx - me.x) / d * left; me.z += (tz - me.z) / d * left; left = 0; } }
  let remain = 0, px = me.x, pz = me.z; for (const [tx, tz] of path) { remain += Math.hypot(tx - px, tz - pz); px = tx; pz = tz; }
  const want = remain < 2.2 || look === null ? endYaw : look, turn = Math.atan2(Math.sin(want - me.yaw), Math.cos(want - me.yaw)), most = 2.6 * dt;
  me.yaw += Math.max(-most, Math.min(most, turn)); me.pitch += (0 - me.pitch) * Math.min(1, dt * 4);
  const floor = floorAt(world, me.x, me.z); settle(me, floor, dt); me.wade = Math.max(0, Math.min(1, (WATER_Y - floor) / (WATER_Y - POOL_FLOOR)));
  return !path.length && Math.abs(Math.atan2(Math.sin(endYaw - me.yaw), Math.cos(endYaw - me.yaw))) < 0.01;
}
// The photograph you are standing in front of and looking at, if any.
export function facing(world, me) {
  let best = null, score = Infinity;
  for (const p of world.photos) { const dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz); if (d > 6 || dx * p.nx + dz * p.nz > -0.3) continue; // too far, or beside or behind its wall
    const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(-dx, -dz) - me.yaw), Math.cos(Math.atan2(-dx, -dz) - me.yaw))); if (turn > 0.6) continue; if (!clearLine(world, me.x, me.z, p.x + p.nx * 0.45, p.z + p.nz * 0.45, 0.05)) continue;
    const s = d + turn * 3; if (s < score) { score = s; best = p; } }
  return best;
}
