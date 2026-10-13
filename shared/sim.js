// Shared game simulation for CS2 网页版 (runs on the server and in the browser for prediction).
(function (root) {
'use strict';
const Sim = {};
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const DEG = Math.PI / 180;
const pick = a => a[Math.floor(Math.random() * a.length)];
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function angDiff(a, b) { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; }
const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function dirFromAngles(yaw, pitch) { const c = Math.cos(pitch); return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c]; }
const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const vset = (v, x, y, z) => { v.x = x; v.y = y; v.z = z; return v; };
const vcopy = (v, o) => { v.x = o.x; v.y = o.y; v.z = o.z; return v; };
const r2 = n => Math.round(n * 100) / 100;
Object.assign(Sim, { rand, clamp, DEG, angDiff, dist2D, dirFromAngles, V, vset, vcopy, pick });

// ---------- map (2m cells) ----------
const CELL = 2, COLS = 50, ROWS = 42, OX = -COLS * CELL / 2, OZ = -ROWS * CELL / 2;
const grid = []; for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill('#'));
function carve(c0, r0, c1, r1, ch) { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r][c] = ch || '.'; }
function put(list, ch) { for (const [c, r] of list) grid[r][c] = ch; }
carve(19, 2, 31, 8); carve(16, 6, 21, 9); carve(2, 2, 15, 13, 'b'); carve(32, 4, 32, 7); carve(33, 2, 47, 13, 'a');
carve(22, 9, 27, 31); carve(28, 16, 32, 18); carve(33, 14, 36, 18); carve(41, 14, 46, 32); carve(36, 30, 40, 33);
carve(14, 32, 38, 39); carve(9, 26, 20, 30); carve(14, 31, 20, 31); carve(3, 14, 8, 30); carve(17, 22, 21, 25);
put([[22, 11], [23, 11], [22, 12], [23, 12], [26, 11], [27, 11], [26, 12], [27, 12]], '#');
put([[39, 6], [40, 6], [39, 7], [40, 7], [45, 3], [46, 3], [44, 11], [3, 11], [12, 10], [13, 10], [5, 5], [6, 5], [5, 6], [6, 6], [43, 23], [44, 23], [18, 35], [32, 36], [28, 3]], 'C');
put([[38, 7], [35, 10], [7, 6], [10, 3], [24, 19], [25, 19], [45, 16], [19, 35], [21, 4], [12, 28], [30, 18]], 'c');
const tile = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS) ? '#' : grid[r][c];
const walkable = (c, r) => { const t = tile(c, r); return t !== '#' && t !== 'C' && t !== 'c'; };
const cellOf = (x, z) => [clamp(Math.floor((x - OX) / CELL), 0, COLS - 1), clamp(Math.floor((z - OZ) / CELL), 0, ROWS - 1)];
const cellPos = (c, r) => ({ x: OX + (c + 0.5) * CELL, z: OZ + (r + 0.5) * CELL });
function siteAt(x, z) { const [c, r] = cellOf(x, z); const t = tile(c, r); return t === 'a' ? 'A' : t === 'b' ? 'B' : null; }
const SPAWN = { CT: [[23, 3], [25, 3], [27, 4], [24, 5], [26, 6]], T: [[22, 36], [24, 37], [26, 36], [28, 37], [30, 36]] };
const SITES = {
  A: { center: [40, 8], plant: [42, 9], guardWatch: [32, 5], holds: [{ c: [45, 6], w: [43, 16] }, { c: [36, 6], w: [34, 16] }, { c: [41, 11], w: [44, 20] }] },
  B: { center: [8, 8], plant: [9, 8], guardWatch: [17, 8], holds: [{ c: [4, 4], w: [5, 16] }, { c: [11, 7], w: [5, 15] }, { c: [14, 12], w: [6, 16] }] },
};
const MID_HOLD = { c: [24, 6], w: [24, 20] };
const ROUTES = {
  A: [[[38, 32], [43, 28], [43, 18], [42, 10]], [[24, 28], [24, 16], [30, 17], [34, 15], [40, 10]]],
  B: [[[17, 30], [11, 28], [5, 22], [6, 14], [8, 8]], [[24, 30], [24, 26], [19, 23], [15, 28], [5, 24], [6, 14], [8, 8]]],
};
// static geometry shared by physics, rays and the client renderer
const colliders = [], rayBoxes = [], wallRects = [], crateBoxes = [];
(function buildGeometry() {
  const used = grid.map(r => r.map(() => false));
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (grid[r][c] !== '#' || used[r][c]) continue;
    let w = 1; while (c + w < COLS && grid[r][c + w] === '#' && !used[r][c + w]) w++;
    let h = 1;
    outer: while (r + h < ROWS) { for (let k = 0; k < w; k++) if (grid[r + h][c + k] !== '#' || used[r + h][c + k]) break outer; h++; }
    for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) used[rr][cc] = true;
    let touches = false;
    for (let rr = r - 1; rr <= r + h && !touches; rr++) for (let cc = c - 1; cc <= c + w; cc++) if (tile(cc, rr) !== '#') { touches = true; break; }
    if (!touches) continue;
    const hgt = 6 + ((c * 31 + r * 17) % 3) * 0.9;
    const b = { min: [OX + c * CELL, 0, OZ + r * CELL], max: [OX + (c + w) * CELL, hgt, OZ + (r + h) * CELL], alt: (c + r) % 2 };
    colliders.push(b); rayBoxes.push(b); wallRects.push(b);
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = grid[r][c]; if (t !== 'c' && t !== 'C') continue;
    const x0 = OX + c * CELL + 0.05, z0 = OZ + r * CELL + 0.05, hh = t === 'c' ? 0.95 : 2.1;
    const b = { min: [x0, 0, z0], max: [x0 + CELL - 0.1, hh, z0 + CELL - 0.1], small: t === 'c' };
    colliders.push(b); rayBoxes.push(b); crateBoxes.push(b);
  }
  rayBoxes.push({ min: [OX, -1, OZ], max: [OX + COLS * CELL, 0, OZ + ROWS * CELL] });
})();
Object.assign(Sim, { CELL, COLS, ROWS, OX, OZ, grid, tile, walkable, cellOf, cellPos, siteAt, SPAWN, SITES, wallRects, crateBoxes, colliders });

// ---------- physics ----------
const PR = 0.36, GRAV = 20;
const entHeight = e => 1.8 - 0.45 * e.crouch;
const eyeH = e => 1.62 - 0.45 * e.crouch;
function collides(x, y, z, h) {
  for (const b of colliders) if (x + PR > b.min[0] && x - PR < b.max[0] && z + PR > b.min[2] && z - PR < b.max[2] && y + h > b.min[1] && y < b.max[1] - 0.001) return b;
  return null;
}
function moveAxis(e, axis, delta, h) {
  if (delta === 0) return;
  const p = e.pos; const nx = axis === 0 ? p.x + delta : p.x, nz = axis === 2 ? p.z + delta : p.z;
  const b = collides(nx, p.y, nz, h);
  if (!b) { p.x = nx; p.z = nz; return; }
  const step = b.max[1] - p.y;
  if (e.onGround && step > 0 && step <= 0.5 && !collides(nx, b.max[1] + 0.001, nz, h)) { p.y = b.max[1]; p.x = nx; p.z = nz; return; }
  if (axis === 0) { p.x = delta > 0 ? b.min[0] - PR - 0.001 : b.max[0] + PR + 0.001; e.vel.x = 0; }
  else { p.z = delta > 0 ? b.min[2] - PR - 0.001 : b.max[2] + PR + 0.001; e.vel.z = 0; }
  if (collides(p.x, p.y, p.z, h)) { if (axis === 0) p.x -= delta; else p.z -= delta; }
}
function physics(e, dt) {
  const h = entHeight(e);
  moveAxis(e, 0, e.vel.x * dt, h); moveAxis(e, 2, e.vel.z * dt, h);
  e.vel.y -= GRAV * dt;
  let ny = e.pos.y + e.vel.y * dt;
  if (ny <= 0) { ny = 0; e.vel.y = 0; e.onGround = true; }
  else {
    const b = collides(e.pos.x, ny, e.pos.z, h);
    if (b) { if (e.vel.y < 0) { ny = b.max[1]; e.onGround = true; } else ny = e.pos.y; e.vel.y = 0; }
    else e.onGround = false;
  }
  e.pos.y = ny;
}
function drive(e, wx, wz, maxSpd, dt) {
  const k = Math.min(1, dt * (e.onGround ? 11 : 1.6));
  e.vel.x += (wx * maxSpd - e.vel.x) * k; e.vel.z += (wz * maxSpd - e.vel.z) * k;
  physics(e, dt);
}
// player movement: identical on server and in client prediction
const K = { W: 1, S: 2, A: 4, D: 8, JUMP: 16, CROUCH: 32, WALK: 64, USE: 128 };
function moveHuman(e, dt, k, locked) {
  const cr = (k & K.CROUCH) || locked === 2 ? 1 : 0;
  e.crouch += (cr - e.crouch) * Math.min(1, dt * 10);
  let f = (k & K.W ? 1 : 0) - (k & K.S ? 1 : 0), s = (k & K.D ? 1 : 0) - (k & K.A ? 1 : 0);
  if (locked) f = s = 0;
  const L = Math.hypot(f, s) || 1; f /= L; s /= L;
  const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw), rx = Math.cos(e.yaw), rz = -Math.sin(e.yaw);
  const w = e.weapons[e.slot];
  const max = (w ? w.def.speed : 6) * (e.scoped ? .5 : 1) * (k & K.WALK ? .52 : 1) * (e.crouch > .5 ? .34 : 1);
  if ((k & K.JUMP) && e.onGround && !locked) { e.vel.y = 7.2; e.onGround = false; }
  drive(e, f * fx + s * rx, f * fz + s * rz, max, dt);
}
Object.assign(Sim, { PR, entHeight, eyeH, collides, physics, drive, moveHuman, K });

// ---------- rays ----------
function rayBox(o, d, b, tMax) {
  let tmin = 0, tmax = tMax, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    const oa = o[a], da = d[a], lo = b.min[a], hi = b.max[a];
    if (Math.abs(da) < 1e-9) { if (oa < lo || oa > hi) return null; continue; }
    let t1 = (lo - oa) / da, t2 = (hi - oa) / da, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis < 0) return null;
  return { t: tmin, axis, sign };
}
function rayWorld(o, d, tMax) {
  let best = null;
  for (const b of rayBoxes) { const h = rayBox(o, d, b, best ? best.t : tMax); if (h && (!best || h.t < best.t)) best = h; }
  return best;
}
function raySphere(o, d, c, r, tMax) {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2], cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc; if (disc < 0) return null;
  const t = -b - Math.sqrt(disc); return t > 0 && t < tMax ? t : null;
}
function rayEntAt(o, d, p, crouch, tMax) {
  const s = 1 - 0.28 * crouch; let best = null;
  const th = raySphere(o, d, [p.x, p.y + 1.6 * s, p.z], 0.16, tMax);
  if (th !== null) best = { t: th, part: 'head' };
  const tb = rayBox(o, d, { min: [p.x - 0.24, p.y + 0.85 * s, p.z - 0.24], max: [p.x + 0.24, p.y + 1.45 * s, p.z + 0.24] }, best ? best.t : tMax);
  if (tb) { const y = o[1] + d[1] * tb.t; best = { t: tb.t, part: y > p.y + 1.15 * s ? 'chest' : 'stomach' }; }
  const tl = rayBox(o, d, { min: [p.x - 0.2, p.y, p.z - 0.2], max: [p.x + 0.2, p.y + 0.85 * s, p.z + 0.2] }, best ? best.t : tMax);
  if (tl) best = { t: tl.t, part: 'legs' };
  return best;
}
function canSee(eye, o) {
  const s = 1 - 0.28 * o.crouch;
  for (const hy of [1.6 * s, 1.2 * s]) {
    const dx = o.pos.x - eye[0], dy = o.pos.y + hy - eye[1], dz = o.pos.z - eye[2];
    const L = Math.hypot(dx, dy, dz); if (L < 0.01) return true;
    if (!rayWorld(eye, [dx / L, dy / L, dz / L], L - 0.2)) return true;
  }
  return false;
}
Object.assign(Sim, { rayWorld, canSee });

// ---------- pathfinding ----------
function nearestWalk(c, r) {
  for (let rad = 1; rad < 6; rad++) for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) if (walkable(c + dc, r + dr)) return [c + dc, r + dr];
  return [c, r];
}
function clearLine(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz); if (L < 0.01) return true;
  const nx = -dz / L * 0.45, nz = dx / L * 0.45, steps = Math.ceil(L / 0.4);
  for (let i = 0; i <= steps; i++) {
    const x = a.x + dx * i / steps, z = a.z + dz * i / steps;
    for (const [ox, oz] of [[0, 0], [nx, nz], [-nx, -nz]]) { const [c, r] = cellOf(x + ox, z + oz); if (!walkable(c, r)) return false; }
  }
  return true;
}
function findPath(x0, z0, x1, z1) {
  let [sc, sr] = cellOf(x0, z0), [gc, gr] = cellOf(x1, z1);
  if (!walkable(sc, sr)) [sc, sr] = nearestWalk(sc, sr);
  const goalOk = walkable(gc, gr); if (!goalOk) [gc, gr] = nearestWalk(gc, gr);
  const N = COLS * ROWS, start = sr * COLS + sc, goal = gr * COLS + gc;
  const g = new Float32Array(N).fill(1e9), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = []; const hf = i => g[i] + Math.hypot((i % COLS) - gc, ((i / COLS) | 0) - gr);
  const push = i => { heap.push([hf(i), i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top[1]; };
  g[start] = 0; push(start);
  while (heap.length) {
    const cur = pop(); if (closed[cur]) continue; closed[cur] = 1; if (cur === goal) break;
    const c = cur % COLS, r = (cur / COLS) | 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue; const nc = c + dc, nr = r + dr;
      if (!walkable(nc, nr)) continue;
      if (dr && dc && (!walkable(c + dc, r) || !walkable(c, r + dr))) continue;
      const ni = nr * COLS + nc, ng = g[cur] + (dr && dc ? 1.414 : 1);
      if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; push(ni); }
    }
  }
  if (!closed[goal]) return null;
  const cells = []; for (let i = goal; i !== -1 && i !== start; i = came[i]) cells.push(i);
  cells.reverse();
  const pts = cells.map(i => cellPos(i % COLS, (i / COLS) | 0));
  if (goalOk && pts.length) pts[pts.length - 1] = { x: x1, z: z1 };
  if (goalOk && !pts.length) pts.push({ x: x1, z: z1 });
  const out = []; let anchor = { x: x0, z: z0 }, i = 0;
  while (i < pts.length) { let j = i; while (j + 1 < pts.length && clearLine(anchor, pts[j + 1])) j++; out.push(pts[j]); anchor = pts[j]; i = j + 1; }
  return out;
}

// ---------- weapons ----------
const W = {
  knife: { name: '刀', slot: 3, melee: true, dmg: 40, speed: 6.35, kill: 1500 },
  c4: { name: 'C4 炸药', slot: 5, c4: true, speed: 6.35 },
  glock: { name: 'Glock-18', slot: 2, team: 'T', price: 200, dmg: 30, pen: .47, rpm: 400, mag: 20, res: 120, reload: 2.2, speed: 6.1, base: .006, move: .03, spray: .004, rangeMod: .85, kill: 300, up: .9, sway: .15, snd: 'pistol' },
  usp: { name: 'USP-S', slot: 2, team: 'CT', price: 200, dmg: 35, pen: .505, rpm: 352, mag: 12, res: 24, reload: 2.2, speed: 6.1, base: .004, move: .028, spray: .004, rangeMod: .91, kill: 300, up: 1.0, sway: .15, snd: 'usp' },
  deagle: { name: '沙漠之鹰', slot: 2, price: 700, dmg: 63, pen: .93, rpm: 267, mag: 7, res: 35, reload: 2.2, speed: 5.84, base: .005, move: .06, spray: .02, rangeMod: .81, kill: 300, up: 2.6, sway: .4, snd: 'deagle' },
  galil: { name: '加利尔 AR', slot: 1, team: 'T', price: 1800, dmg: 30, pen: .775, rpm: 666, mag: 35, res: 90, reload: 3.0, speed: 5.46, auto: true, base: .004, move: .11, spray: .0016, rangeMod: .98, kill: 300, up: .62, sway: .38, snd: 'rifle' },
  famas: { name: '法玛斯', slot: 1, team: 'CT', price: 2050, dmg: 30, pen: .7, rpm: 666, mag: 25, res: 90, reload: 3.3, speed: 5.59, auto: true, base: .004, move: .11, spray: .0016, rangeMod: .96, kill: 300, up: .6, sway: .35, snd: 'rifle' },
  ak47: { name: 'AK-47', slot: 1, team: 'T', price: 2700, dmg: 36, pen: .775, rpm: 600, mag: 30, res: 90, reload: 2.5, speed: 5.46, auto: true, base: .0035, move: .13, spray: .0018, rangeMod: .98, kill: 300, up: .78, sway: .45, snd: 'ak' },
  m4a4: { name: 'M4A4', slot: 1, team: 'CT', price: 2900, dmg: 33, pen: .7, rpm: 666, mag: 30, res: 90, reload: 3.1, speed: 5.72, auto: true, base: .003, move: .12, spray: .0015, rangeMod: .97, kill: 300, up: .66, sway: .38, snd: 'm4' },
  awp: { name: 'AWP', slot: 1, price: 4750, dmg: 115, pen: .975, rpm: 41, mag: 5, res: 30, reload: 3.6, speed: 5.08, scope: true, base: .09, scoped: .0008, move: .25, spray: 0, rangeMod: .99, kill: 100, up: 3, sway: 0, snd: 'awp' },
};
for (const k in W) {
  const d = W[k]; d.id = k; if (!d.rpm) continue;
  const p = [[0, 0]]; let x = 0, y = 0;
  for (let i = 1; i < 36; i++) {
    y += d.up * (i <= 8 ? 1 : i <= 14 ? .4 : .15);
    const dir = i <= 8 ? (i % 2 ? .15 : -.1) : i <= 15 ? -1 : i <= 22 ? 1 : i <= 28 ? -1 : 1;
    x += dir * d.sway; p.push([x * DEG, y * DEG]);
  }
  d.pattern = p;
}
const makeWeapon = id => ({ id, def: W[id], mag: W[id].mag || 0, reserve: W[id].res || 0 });
function recoilAt(d, idx) {
  const p = d.pattern; if (!p) return [0, 0];
  const i = Math.min(Math.floor(idx), p.length - 2), f = Math.min(1, idx - i);
  return [p[i][0] + (p[i + 1][0] - p[i][0]) * f, p[i][1] + (p[i + 1][1] - p[i][1]) * f];
}
const DIFFS = {
  easy: { react: .6, turn: 6, err: .13, settle: 1.5, comp: .3, hs: .12, fov: 65, strafe: false },
  normal: { react: .38, turn: 9, err: .08, settle: 2.6, comp: .6, hs: .28, fov: 78, strafe: true },
  hard: { react: .22, turn: 14, err: .045, settle: 4, comp: .85, hs: .45, fov: 88, strafe: true },
};
const GEAR = { vest: ['防弹衣', 650], vesthelm: ['防弹衣 + 头盔', 1000], kit: ['拆弹器', 400] };
Object.assign(Sim, { W, makeWeapon, recoilAt, DIFFS, GEAR });

// ---------- game state ----------
// All functions below operate on the current room `G`, set with Sim.use(room) before calling.
let G = null;
Sim.use = g => { G = g; };
const TEAM_CN = { CT: '反恐精英', T: '恐怖分子' };
const enemyOf = t => t === 'CT' ? 'T' : 'CT';
const BOT_NAMES = ['Doc', 'Ringo', 'Shark', 'Vinny', 'Wolf', 'Kirby', 'Yanni', 'Dimitri', 'Crusher', 'Zed', 'Moe', 'Ivan', 'Rex', 'Gus'];
Object.assign(Sim, { TEAM_CN, enemyOf });

Sim.createGame = function (opts) {
  return {
    T: 0, ents: [], nextId: 1, items: [], nextItem: 1, events: [], history: [],
    phase: 'freeze', round: 0, freezeT: 0, roundT: 0, elapsed: 0, postT: 0, overT: 0,
    score: { CT: 0, T: 0 }, loss: { CT: 0, T: 0 }, target: opts.target || 8, diff: typeof opts.diff === 'string' && Object.hasOwn(DIFFS, opts.diff) ? opts.diff : 'normal',
    tSite: 'A', ctCall: null, winner: null,
    bomb: { state: 'none', carrier: null, pos: V(), timer: 0, site: null, defuser: null, defuseT: 0, need: 10, plantedBy: null, noPick: null, noPickUntil: 0 },
  };
};
const ev = (e, o) => { o.e = e; G.events.push(o); };
const now = e => e.human ? e.clock : G.T;

function makeEnt(team, name, human) {
  return {
    id: G.nextId++, team, name, human, pos: V(), vel: V(), yaw: 0, pitch: 0, crouch: 0, onGround: true,
    hp: 100, armor: 0, helmet: false, kit: false, money: 800, alive: false, weapons: { 1: null, 2: null, 3: null, 5: null }, slot: 2, lastSlot: 3,
    kills: 0, deaths: 0, hasBomb: false, nextFire: 0, reloadEnd: 0, drawEnd: 0, recoilIdx: 0, lastShot: -9, scoped: 0, planting: 0,
    spot: { CT: 0, T: 0 }, seed: Math.random() * 100, ping: 0,
    // human input state
    clock: 0, lastSeq: 0, viewT: 0, trigPrev: false, useHeld: false, stepT: 0, spotT: 0,
    // bot brain
    target: null, targetVisible: false, lastSeen: -9, lastKnown: V(), reactAt: 0, errYaw: 0, errPitch: 0, aimHead: false,
    burstLeft: 5, burstPause: 0, semiAt: 0, strafeDir: 1, strafeSwitch: 0, think: 0, alertUntil: 0, lookAt: V(), lookUntil: 0,
    hunt: false, huntPos: V(), huntUntil: 0, task: 'idle', wps: [], wpi: 0, face: 0, path: null, pidx: 0, pathKey: '', repathAt: 0,
    startAt: 0, stuckT: 0, lastPos: V(), unstickUntil: 0, unstickDir: 1, holdSite: null, crouchy: Math.random() < .5, route: null, routeIdx: 0,
  };
}
const curW = e => e.weapons[e.slot];
const eyeArr = e => [e.pos.x, e.pos.y + eyeH(e), e.pos.z];

function switchSlot(e, s) {
  if (!e.weapons[s] || (e.slot === s && e.drawEnd < now(e))) return;
  if (e.slot !== s && e.weapons[e.slot]) e.lastSlot = e.slot;
  e.slot = s; e.reloadEnd = 0; e.scoped = 0; e.planting = 0;
  const d = e.weapons[s].def; e.drawEnd = now(e) + (d.melee ? .3 : d.scope ? 1.1 : d.slot === 2 ? .45 : .8);
}
function bestSlot(e) {
  const p = e.weapons[1], s = e.weapons[2];
  if (p && (p.mag > 0 || p.reserve > 0)) return 1;
  if (s && (s.mag > 0 || s.reserve > 0)) return 2;
  return 3;
}
function startReload(e) {
  const w = curW(e); if (!w || !w.def.rpm || e.reloadEnd) return;
  if (w.mag >= w.def.mag || w.reserve <= 0) return;
  e.reloadEnd = now(e) + w.def.reload; e.scoped = 0;
}
function tickWeapon(e, dt) {
  const t = now(e);
  if (e.reloadEnd && t >= e.reloadEnd) { const w = curW(e); if (w) { const n = Math.min(w.def.mag - w.mag, w.reserve); w.mag += n; w.reserve -= n; } e.reloadEnd = 0; }
  const w = curW(e);
  if (w && w.def.rpm && t - e.lastShot > 60 / w.def.rpm * 1.1) e.recoilIdx = Math.max(0, e.recoilIdx - dt * (4 + e.recoilIdx * 3));
}
function inaccuracy(e, d) {
  let a = d.scope ? (e.scoped ? d.scoped : d.base) : d.base;
  const sp = Math.hypot(e.vel.x, e.vel.z), f = clamp((sp - .34 * d.speed) / (.66 * d.speed), 0, 1);
  a += d.move * f; if (!e.onGround) a += .2; if (e.crouch > .5) a *= .75;
  return a + Math.min(e.recoilIdx, 12) * d.spray;
}
Object.assign(Sim, { curW, eyeArr, bestSlot });

// lag compensation: where was entity `id` at server time t?
function histPos(id, t) {
  const H = G.history; if (!H.length) return null;
  if (t >= H[H.length - 1].t) return null;
  for (let i = H.length - 1; i > 0; i--) {
    const a = H[i - 1], b = H[i];
    if (a.t <= t && t <= b.t) {
      const pa = a.p.get(id), pb = b.p.get(id); if (!pa || !pb) return null;
      const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return { x: pa[0] + (pb[0] - pa[0]) * f, y: pa[1] + (pb[1] - pa[1]) * f, z: pa[2] + (pb[2] - pa[2]) * f, crouch: pa[3] + (pb[3] - pa[3]) * f };
    }
  }
  const p = H[0].p.get(id); return p ? { x: p[0], y: p[1], z: p[2], crouch: p[3] } : null;
}
function recordHistory() {
  const p = new Map(); for (const e of G.ents) if (e.alive) p.set(e.id, [e.pos.x, e.pos.y, e.pos.z, e.crouch]);
  G.history.push({ t: G.T, p }); while (G.history.length && G.history[0].t < G.T - 1) G.history.shift();
}

function fire(e, heavy) {
  if (!e.alive || G.phase === 'freeze' || G.phase === 'over') return false;
  const w = curW(e); if (!w) return false; const d = w.def, t = now(e);
  if (t < e.nextFire || e.reloadEnd || t < e.drawEnd || d.c4) return false;
  if (d.melee) {
    e.nextFire = t + (heavy ? 1.0 : .42); e.lastShot = t;
    const eye = eyeArr(e), end = shootRay(e, eye, dirFromAngles(e.yaw, e.pitch), 1.9, d, heavy ? 65 : 40);
    ev('shot', { id: e.id, o: eye.map(r2), p: end.p.map(r2), k: end.k, snd: 'knife' });
    return true;
  }
  if (w.mag <= 0) { startReload(e); e.nextFire = t + .25; return false; }
  w.mag--; e.nextFire = t + 60 / d.rpm; e.lastShot = t;
  const comp = e.human ? 0 : DIFFS[G.diff].comp;
  const [px, py] = recoilAt(d, e.recoilIdx);
  let yaw = e.yaw - px * (1 - comp), pitch = e.pitch + py * (1 - comp);
  const r = inaccuracy(e, d) * Math.sqrt(Math.random()), th = Math.random() * Math.PI * 2;
  yaw += r * Math.cos(th); pitch += r * Math.sin(th);
  e.recoilIdx = Math.min(e.recoilIdx + 1, d.pattern.length - 2);
  const eye = eyeArr(e), res = shootRay(e, eye, dirFromAngles(yaw, pitch), 220, d, d.dmg);
  ev('shot', { id: e.id, o: eye.map(r2), p: res.p.map(r2), k: res.k, ax: res.ax, sg: res.sg, snd: d.snd });
  if (d.scope && e.human) e.scoped = 0;
  if (w.mag === 0 && e.human) e.autoReloadAt = t + .25;
  const R = d.snd === 'usp' ? 14 : d.slot === 2 ? 38 : 60;
  for (const o of G.ents) if (o.alive && !o.human && o.team !== e.team && dist2D(o.pos, e.pos) < R) hear(o, e.pos);
  return true;
}
function shootRay(e, o, d, range, def, dmg) {
  const wh = rayWorld(o, d, range); let tMax = wh ? wh.t : range, hit = null;
  const lag = e.human ? clamp(e.viewT, G.T - .4, G.T) : null;
  for (const t of G.ents) {
    if (t === e || !t.alive || t.team === e.team) continue;
    const hp = lag !== null ? histPos(t.id, lag) : null;
    const h = rayEntAt(o, d, hp || t.pos, hp ? hp.crouch : t.crouch, tMax);
    if (h) { tMax = h.t; hit = { ent: t, part: h.part }; }
  }
  const p = [o[0] + d[0] * tMax, o[1] + d[1] * tMax, o[2] + d[2] * tMax];
  if (hit) { damage(hit.ent, e, def, hit.part, tMax, dmg); return { p, k: hit.part === 'head' ? 3 : 2 }; }
  if (wh) return { p, k: 1, ax: wh.axis, sg: wh.sign };
  return { p, k: 0 };
}
function damage(v, a, def, part, dist, base) {
  if (!v.alive) return;
  const mult = { head: 4, chest: 1, stomach: 1.25, legs: .75 }[part];
  let dmg = def.melee ? base : base * mult * Math.pow(def.rangeMod, dist / 12.7), hp = dmg;
  if (v.armor > 0 && (part !== 'head' || v.helmet) && part !== 'legs') {
    hp = dmg * (def.pen || 1); let ad = (dmg - hp) * .5;
    if (ad > v.armor) { hp += (ad - v.armor) * 2; ad = v.armor; }
    v.armor = Math.max(0, Math.round(v.armor - ad));
  }
  hp = Math.max(1, Math.round(hp)); v.hp -= hp;
  ev('hit', { a: a.id, v: v.id, part, n: hp, ax: r2(a.pos.x), az: r2(a.pos.z) });
  if (v.human) { v.vel.x *= .4; v.vel.z *= .4; }
  else { v.alertUntil = G.T + 1.5; if (!v.targetVisible) { vcopy(v.lookAt, a.pos); v.lookUntil = G.T + 1.5; } }
  if (v.hp <= 0) kill(v, a, def, part === 'head');
}
function kill(v, a, def, hs) {
  v.alive = false; v.hp = 0; v.deaths++; v.planting = 0; v.reloadEnd = 0; v.scoped = 0;
  if (a && a !== v && a.team !== v.team) { a.kills++; const n = def.kill || 300; a.money = Math.min(16000, a.money + n); ev('cash', { id: a.id, n }); }
  if (G.bomb.defuser === v) { G.bomb.defuser = null; G.bomb.defuseT = 0; }
  const drop = v.weapons[1] || v.weapons[2];
  if (drop && (drop.mag + drop.reserve) > 0) spawnItem(drop, v.pos, v.yaw);
  if (v.hasBomb) dropBomb(v);
  v.weapons = { 1: null, 2: null, 3: null, 5: null };
  ev('kill', { a: a ? a.id : 0, v: v.id, w: def.name || '', hs: hs ? 1 : 0, ax: a ? r2(a.pos.x) : r2(v.pos.x), az: a ? r2(a.pos.z) : r2(v.pos.z) });
  for (const o of G.ents) if (o.target === v) { o.target = null; o.targetVisible = false; }
  checkRoundEnd();
}

// ---------- dropped weapons ----------
function spawnItem(w, pos, yaw) {
  const f = dirFromAngles(yaw, 0);
  const it = { id: G.nextItem++, w, x: pos.x, y: pos.y + .9, z: pos.z, yaw, vx: f[0] * 2.5, vy: 1, vz: f[2] * 2.5, noPick: null, noPickUntil: 0 };
  G.items.push(it); return it;
}
function dropCurrent(e) {
  const w = curW(e); if (!w) return;
  if (w.def.c4) { dropBomb(e, true); switchSlot(e, bestSlot(e)); return; }
  if (w.def.melee) return;
  e.weapons[w.def.slot] = null; const it = spawnItem(w, e.pos, e.yaw); it.noPick = e; it.noPickUntil = G.T + 1;
  e.slot = 3; switchSlot(e, bestSlot(e)); e.drawEnd = now(e) + .3;
}
function updateItems(dt) {
  for (const it of G.items) {
    if (it.vy !== 0 || it.vx) {
      it.vy -= GRAV * dt; let nx = it.x + it.vx * dt, nz = it.z + it.vz * dt;
      const [c, r] = cellOf(nx, nz); if (!walkable(c, r)) { nx = it.x; nz = it.z; it.vx = it.vz = 0; }
      it.x = nx; it.z = nz; it.y += it.vy * dt;
      if (it.y <= .04) { it.y = .04; it.vy = 0; it.vx *= .3; it.vz *= .3; if (Math.abs(it.vx) < .05) it.vx = it.vz = 0; }
    }
  }
  for (const e of G.ents) {
    if (!e.alive) continue;
    for (let i = G.items.length - 1; i >= 0; i--) {
      const it = G.items[i]; if (it.noPick === e && G.T < it.noPickUntil) continue;
      if (e.weapons[it.w.def.slot] || Math.hypot(e.pos.x - it.x, e.pos.z - it.z) > 1 || it.y > .5) continue;
      e.weapons[it.w.def.slot] = it.w; G.items.splice(i, 1);
      if (!e.human) switchSlot(e, bestSlot(e));
    }
  }
  const B = G.bomb;
  if (B.state === 'dropped') for (const e of G.ents) if (e.alive && e.team === 'T' && dist2D(e.pos, B.pos) < 1.1 && !(B.noPick === e && G.T < B.noPickUntil)) { pickupBomb(e); break; }
}
function swapNearest(e) {
  let best = null, bd = 1.8;
  for (const it of G.items) { const d = Math.hypot(e.pos.x - it.x, e.pos.z - it.z); if (d < bd) { bd = d; best = it; } }
  if (!best) return false;
  const s = best.w.def.slot, old = e.weapons[s];
  e.weapons[s] = best.w; G.items.splice(G.items.indexOf(best), 1);
  if (old) { const ni = spawnItem(old, e.pos, e.yaw); ni.noPick = e; ni.noPickUntil = G.T + 1; }
  e.slot = 0; switchSlot(e, s); return true;
}

// ---------- bomb ----------
function dropBomb(e, thrown) {
  const B = G.bomb;
  e.hasBomb = false; e.weapons[5] = null; if (e.slot === 5 && e.alive) switchSlot(e, bestSlot(e));
  B.state = 'dropped'; B.carrier = null; vset(B.pos, e.pos.x, e.pos.y, e.pos.z);
  if (thrown) { const f = dirFromAngles(e.yaw, 0); const nx = e.pos.x + f[0] * 1.5, nz = e.pos.z + f[2] * 1.5; const [c, r] = cellOf(nx, nz); if (walkable(c, r)) vset(B.pos, nx, 0, nz); B.noPick = e; B.noPickUntil = G.T + 1.5; }
  ev('bomb', { k: 'dropped', id: e.id });
  for (const b of G.ents) if (!b.human && b.alive && b.team === 'T') assignTask(b);
}
function pickupBomb(e) {
  const B = G.bomb; B.state = 'carried'; B.carrier = e; e.hasBomb = true; e.weapons[5] = makeWeapon('c4');
  ev('bomb', { k: 'picked', id: e.id });
  for (const b of G.ents) if (!b.human && b.alive && b.team === 'T') assignTask(b);
}
function plantBomb(e) {
  const B = G.bomb;
  B.state = 'planted'; B.carrier = null; vset(B.pos, e.pos.x, e.pos.y, e.pos.z); B.timer = 40; B.site = siteAt(e.pos.x, e.pos.z) || 'A';
  B.plantedBy = e; B.defuser = null; B.defuseT = 0; B.yaw = e.yaw;
  e.hasBomb = false; e.weapons[5] = null; e.planting = 0; e.money = Math.min(16000, e.money + 300);
  if (e.slot === 5) switchSlot(e, bestSlot(e));
  ev('bomb', { k: 'planted', id: e.id, site: B.site });
  for (const b of G.ents) if (!b.human && b.alive) { b.hunt = false; assignTask(b); }
}
function updateBomb(dt) {
  const B = G.bomb; if (B.state !== 'planted') return;
  B.timer -= dt;
  if (B.defuser) {
    const d = B.defuser;
    const ok = d.alive && dist2D(d.pos, B.pos) < 1.8 && (!d.human || d.useHeld);
    if (!ok) { B.defuser = null; B.defuseT = 0; }
    else {
      // Only time before detonation can count toward a defuse in this tick.
      B.defuseT += Math.min(dt, Math.max(0, B.timer + dt));
      if (B.defuseT >= B.need) {
        B.state = 'defused'; B.defuser = null; d.money = Math.min(16000, d.money + 300);
        ev('bomb', { k: 'defused', id: d.id });
        if (G.phase === 'live') endRound('CT', 'defuse'); return;
      }
    }
  }
  if (B.timer <= 0) {
    B.state = 'exploded'; B.defuser = null;
    ev('bomb', { k: 'exploded', x: r2(B.pos.x), y: r2(B.pos.y), z: r2(B.pos.z) });
    // Settle the objective before blast deaths can trigger elimination scoring.
    if (G.phase === 'live') endRound('T', 'bomb');
    for (const e of G.ents) {
      if (!e.alive) continue; const dd = dist2D(e.pos, B.pos);
      if (dd < 22) { let dm = 450 * Math.pow(1 - dd / 22, 1.6); if (e.armor > 0) { dm *= .5; e.armor = Math.max(0, e.armor - 30); } e.hp -= Math.round(dm); if (e.hp <= 0) kill(e, null, { name: '炸弹' }, false); }
    }
  }
}

// ---------- buying ----------
const inBuyZone = e => { const sp = SPAWN[e.team][0], c = cellPos(sp[0], sp[1]); return Math.hypot(e.pos.x - c.x, e.pos.z - c.z) < 16; };
function canBuyNow(e) { return e.alive && inBuyZone(e) && (G.phase === 'freeze' || (G.phase === 'live' && G.elapsed < 25)); }
function buyItem(e, id) {
  if (!canBuyNow(e)) return false;
  if (id === 'vest') { if (e.armor >= 100 || e.money < 650) return false; e.money -= 650; e.armor = 100; return true; }
  if (id === 'vesthelm') {
    if (e.armor >= 100 && e.helmet) return false; const price = e.armor >= 100 ? 350 : 1000;
    if (e.money < price) return false; e.money -= price; e.armor = 100; e.helmet = true; return true;
  }
  if (id === 'kit') { if (e.team !== 'CT' || e.kit || e.money < 400) return false; e.money -= 400; e.kit = true; return true; }
  const d = W[id]; if (!d || !d.price || (d.team && d.team !== e.team) || e.money < d.price) return false;
  const old = e.weapons[d.slot]; if (old && old.id === id) return false;
  if (old) spawnItem(old, e.pos, e.yaw);
  e.money -= d.price; e.weapons[d.slot] = makeWeapon(id); e.slot = 0; switchSlot(e, d.slot);
  return true;
}
function botBuy(b) {
  const rifle = b.team === 'T' ? 'ak47' : 'm4a4', cheap = b.team === 'T' ? 'galil' : 'famas';
  if (!b.weapons[1]) {
    const awpTaken = G.ents.some(o => o !== b && o.team === b.team && o.weapons[1] && o.weapons[1].id === 'awp');
    if (b.money >= W.awp.price + 1000 && !awpTaken && Math.random() < .3) buyItem(b, 'awp');
    else if (b.money >= W[rifle].price + 650) buyItem(b, rifle);
    else if (b.money >= W[cheap].price + 650 && G.round > 1) buyItem(b, cheap);
    else if (b.money >= 1350 && Math.random() < .5 && b.weapons[2] && b.weapons[2].id !== 'deagle') buyItem(b, 'deagle');
  }
  if (b.money >= 1000) buyItem(b, 'vesthelm'); else if (b.money >= 650 && b.armor < 50) buyItem(b, 'vest');
  if (b.team === 'CT' && b.money >= 400 && Math.random() < .5) buyItem(b, 'kit');
  switchSlot(b, bestSlot(b));
}
Object.assign(Sim, { canBuyNow, inBuyZone });

// ---------- bot AI ----------
const yawTo = (from, x, z) => Math.atan2(-(x - from.x), -(z - from.z));
function nearCell(c, r, rad) {
  for (let k = 0; k < 20; k++) { const cc = c + randInt(-rad, rad), rr = r + randInt(-rad, rad); if (walkable(cc, rr)) return cellPos(cc, rr); }
  return cellPos(c, r);
}
function setWps(b, cells, faceCell) {
  b.wps = cells.map(([c, r]) => cellPos(c, r)); b.wpi = 0; b.path = null;
  if (faceCell) { const p = cellPos(faceCell[0], faceCell[1]); const last = b.wps[b.wps.length - 1] || b.pos; b.face = Math.atan2(-(p.x - last.x), -(p.z - last.z)); }
}
function assignTask(b) {
  if (!b.alive || b.human) return;
  const B = G.bomb;
  if (b.team === 'T') {
    if (B.state === 'planted') {
      const s = SITES[B.site]; const [c, r] = cellOf(B.pos.x, B.pos.z);
      const p = nearCell(c, r, 3); b.task = 'guard'; b.wps = [p]; b.wpi = 0; b.path = null;
      const w = cellPos(s.guardWatch[0], s.guardWatch[1]); b.face = Math.atan2(-(w.x - p.x), -(w.z - p.z));
    } else if (B.state === 'dropped') {
      const ts = G.ents.filter(o => o.alive && o.team === 'T').sort((x, y) => dist2D(x.pos, B.pos) - dist2D(y.pos, B.pos));
      const bots = ts.filter(o => !o.human);
      const humanCloser = ts.length && ts[0].human && dist2D(ts[0].pos, B.pos) < 12;
      if (bots[0] === b && !humanCloser) { b.task = 'fetch'; b.path = null; }
      else if (b.task === 'fetch' || b.task === 'plant') routeT(b);
    } else if (b.hasBomb) {
      b.task = 'plant'; const s = SITES[G.tSite];
      if (!b.route) b.route = pick(ROUTES[G.tSite]);
      const rest = b.route.slice(Math.min(b.routeIdx || 0, b.route.length - 1));
      setWps(b, [...rest.slice(0, -1), s.plant]);
    } else if (b.task !== 'route') routeT(b);
  } else {
    if (B.state === 'planted') { b.task = 'defuse'; b.path = null; }
    else {
      b.task = 'hold';
      const h = (b.holdSite || 'M') === 'M' ? MID_HOLD : pick(SITES[b.holdSite].holds);
      setWps(b, [h.c], h.w);
    }
  }
}
function routeT(b) {
  b.task = 'route'; b.route = b.route || pick(ROUTES[G.tSite]);
  const s = SITES[G.tSite]; const end = b.route[b.route.length - 1];
  const p = nearCell(end[0], end[1], 2); const [pc, pr] = cellOf(p.x, p.z);
  setWps(b, [...b.route.slice(0, -1), [pc, pr]], s.guardWatch);
}
function planBots() {
  G.tSite = Math.random() < .5 ? 'A' : 'B'; G.ctCall = null;
  const cts = shuffle(G.ents.filter(e => e.team === 'CT' && !e.human));
  const plan = shuffle(['A', 'B', 'A', 'B', 'M']);
  cts.forEach((b, i) => b.holdSite = plan[i % 5]);
  for (const b of G.ents) {
    if (b.human) continue;
    b.route = null; b.routeIdx = 0; b.task = 'idle'; b.hunt = false; b.target = null; b.targetVisible = false;
    b.startAt = G.T + (b.team === 'T' ? (Math.random() < .25 ? rand(3, 10) : rand(0, 1.5)) : rand(0, 1));
    assignTask(b);
  }
}
function rotateCT(site) {
  if (G.ctCall === site) return; G.ctCall = site;
  const others = G.ents.filter(e => e.alive && !e.human && e.team === 'CT' && e.holdSite !== site && !e.targetVisible);
  others.slice(0, Math.max(1, others.length - 1)).forEach(b => { b.holdSite = site; if (G.bomb.state !== 'planted') assignTask(b); });
}
function hear(b, pos) {
  if (b.targetVisible || !b.alive || b.human) return;
  vset(b.lookAt, pos.x + rand(-2, 2), pos.y, pos.z + rand(-2, 2)); b.lookUntil = G.T + 1.6;
  if (b.hasBomb || b.task === 'defuse' || b.task === 'fetch' || G.bomb.defuser === b) return;
  if (dist2D(b.pos, pos) < 22 && Math.random() < (b.task === 'hold' ? .3 : .55)) { b.hunt = true; vcopy(b.huntPos, pos); b.huntUntil = G.T + 6; b.path = null; }
}
const burstSize = d => d > 25 ? randInt(2, 4) : d > 12 ? randInt(4, 8) : randInt(8, 15);
function perceive(b, D) {
  const eye = eyeArr(b); let best = null, bd = 1e9;
  for (const o of G.ents) {
    if (!o.alive || o.team === b.team) continue;
    const dx = o.pos.x - b.pos.x, dz = o.pos.z - b.pos.z, d = Math.hypot(dx, dz); if (d > 95) continue;
    const inFov = Math.abs(angDiff(b.yaw, Math.atan2(-dx, -dz))) < D.fov * DEG || d < 3 || G.T < b.alertUntil;
    if (!inFov || !canSee(eye, o)) continue;
    if (d < bd) { bd = d; best = o; }
  }
  if (best) {
    if (b.target !== best || G.T - b.lastSeen > 1) {
      b.reactAt = G.T + D.react * rand(.8, 1.4); b.errYaw = rand(-1, 1) * D.err; b.errPitch = rand(-.6, .6) * D.err;
      b.aimHead = Math.random() < D.hs; b.burstLeft = burstSize(bd); b.burstPause = 0;
    }
    b.target = best; b.targetVisible = true; b.lastSeen = G.T; vcopy(b.lastKnown, best.pos); best.spot[b.team] = G.T + 1.2;
    if (b.team === 'CT') for (const k of ['A', 'B']) { const c = cellPos(SITES[k].center[0], SITES[k].center[1]); if (Math.hypot(best.pos.x - c.x, best.pos.z - c.z) < 22) rotateCT(k); }
    for (const m of G.ents) if (m !== b && m.alive && !m.human && m.team === b.team && !m.targetVisible && dist2D(m.pos, b.pos) < 25) { vcopy(m.lookAt, best.pos); m.lookUntil = G.T + 1.2; }
  } else {
    b.targetVisible = false;
    if (b.target && G.T - b.lastSeen > .5) {
      const d = dist2D(b.pos, b.lastKnown);
      if (!b.hasBomb && b.task !== 'defuse' && b.task !== 'fetch' && (b.task !== 'hold' || d < 18)) { b.hunt = true; vcopy(b.huntPos, b.lastKnown); b.huntUntil = G.T + 6; b.path = null; }
      b.target = null;
    }
  }
}
function combat(b, D, dt) {
  const t = b.target, w = curW(b), d = w.def, s = 1 - .28 * t.crouch, eye = eyeArr(b);
  const dx = t.pos.x - eye[0], dy = t.pos.y + (b.aimHead ? 1.6 : 1.22) * s - eye[1], dz = t.pos.z - eye[2];
  const hd = Math.max(.01, Math.hypot(dx, dz)), dist = Math.hypot(hd, dy);
  b.errYaw *= Math.exp(-dt * D.settle); b.errPitch *= Math.exp(-dt * D.settle);
  const wy = Math.atan2(-dx, -dz) + b.errYaw, wp = Math.atan2(dy, hd) + b.errPitch;
  const k = 1 - Math.exp(-dt * D.turn);
  b.yaw += angDiff(b.yaw, wy) * k; b.pitch += (wp - b.pitch) * k;
  const off = Math.abs(angDiff(b.yaw, wy)) + Math.abs(wp - b.pitch);
  const mv = { x: 0, z: 0, speed: 0, crouch: false };
  if (d.melee) { mv.x = dx / hd; mv.z = dz / hd; mv.speed = 1; if (dist < 1.9 && off < .3) fire(b); return mv; }
  const tol = d.scope ? .01 : Math.max(.015, Math.atan(.2 / dist));
  if (G.T >= b.reactAt && off < tol && !b.reloadEnd && G.T >= b.burstPause) {
    if (d.auto) { if (fire(b) && --b.burstLeft <= 0) { b.burstPause = G.T + rand(.2, .45); b.burstLeft = burstSize(dist); } }
    else if (G.T >= b.semiAt && fire(b)) b.semiAt = G.T + 60 / d.rpm + (d.scope ? .15 : rand(.1, .3));
  }
  if (d.scope) b.scoped = 1;
  const firing = G.T - b.lastShot < .2;
  if (!firing && D.strafe && !d.scope && dist > 4) {
    if (G.T > b.strafeSwitch) { b.strafeDir = Math.random() < .5 ? -1 : 1; b.strafeSwitch = G.T + rand(.3, .7); }
    mv.x = Math.cos(b.yaw) * b.strafeDir; mv.z = -Math.sin(b.yaw) * b.strafeDir; mv.speed = .9;
  }
  if (firing && dist > 18 && b.crouchy) mv.crouch = true;
  return mv;
}
function navigate(b, dt) {
  const mv = { x: 0, z: 0, speed: 0, crouch: false }, B = G.bomb;
  if (b.hunt && G.T > b.huntUntil) { b.hunt = false; b.path = null; }
  let goal = null;
  if (b.hunt) goal = b.huntPos;
  else if (b.task === 'fetch' && B.state === 'dropped') goal = B.pos;
  else if (b.task === 'defuse' && B.state === 'planted') goal = B.pos;
  else if (b.wpi < b.wps.length) goal = b.wps[b.wpi];
  if (G.T < b.startAt && !b.hunt) goal = null;
  if (goal) {
    const key = goal.x.toFixed(1) + ',' + goal.z.toFixed(1);
    if (!b.path || b.pathKey !== key || G.T > b.repathAt) { b.path = findPath(b.pos.x, b.pos.z, goal.x, goal.z) || []; b.pidx = 0; b.pathKey = key; b.repathAt = G.T + 4; }
    while (b.pidx < b.path.length && dist2D(b.pos, b.path[b.pidx]) < .5) b.pidx++;
    if (b.pidx >= b.path.length) reached(b);
    else {
      const p = b.path[b.pidx], dx = p.x - b.pos.x, dz = p.z - b.pos.z, L = Math.hypot(dx, dz) || 1;
      mv.x = dx / L; mv.z = dz / L; mv.speed = 1;
      if (G.T < b.unstickUntil) { mv.x = -dz / L * b.unstickDir; mv.z = dx / L * b.unstickDir; }
      b.stuckT += dt;
      if (b.stuckT > .8) { if (dist2D(b.pos, b.lastPos) < .3) { b.path = null; b.unstickUntil = G.T + .4; b.unstickDir = Math.random() < .5 ? -1 : 1; } b.stuckT = 0; vcopy(b.lastPos, b.pos); }
    }
  }
  let fy;
  if (G.T < b.lookUntil) fy = yawTo(b.pos, b.lookAt.x, b.lookAt.z);
  else if (mv.speed > 0) fy = Math.atan2(-mv.x, -mv.z);
  else fy = b.face + Math.sin(G.T * .6 + b.seed) * .45;
  b.yaw += angDiff(b.yaw, fy) * Math.min(1, dt * 6); b.pitch *= Math.max(0, 1 - dt * 4);
  return mv;
}
function reached(b) {
  const B = G.bomb;
  if (b.hunt) { b.hunt = false; b.path = null; b.lookUntil = G.T + 1; vset(b.lookAt, b.pos.x - Math.sin(b.yaw) * 5, 0, b.pos.z - Math.cos(b.yaw) * 5); return; }
  if (b.task === 'defuse') {
    if (B.state === 'planted' && !B.defuser && dist2D(b.pos, B.pos) < 1.2) { B.defuser = b; B.need = b.kit ? 5 : 10; B.defuseT = 0; }
    else if (B.defuser && B.defuser !== b) { b.task = 'hold'; const [c, r] = cellOf(B.pos.x, B.pos.z); b.wps = [nearCell(c, r, 2)]; b.wpi = 0; b.face = Math.random() * 6.28; }
    b.path = []; b.pidx = 0; return;
  }
  if (b.task === 'fetch') return;
  if (b.wpi < b.wps.length) { b.wpi++; b.path = null; if (b.task === 'route' || b.task === 'plant') b.routeIdx = b.wpi; }
}
function updateBot(b, dt) {
  if (!b.alive) return;
  const D = DIFFS[G.diff], B = G.bomb;
  tickWeapon(b, dt);
  if (G.phase === 'freeze') { drive(b, 0, 0, 0, dt); return; }
  const bs = bestSlot(b); if (b.slot !== bs) switchSlot(b, bs);
  const w = curW(b);
  if (w.def.rpm && w.mag === 0 && w.reserve > 0) startReload(b);
  b.think -= dt;
  if (b.think <= 0) {
    b.think = .1 + Math.random() * .1; perceive(b, D);
    if (b.team === 'T' && B.state === 'dropped' && b.task !== 'fetch' && !G.ents.some(o => o.alive && !o.human && o.task === 'fetch' && o.team === 'T')) assignTask(b);
  }
  if (b.target && !b.target.alive) { b.target = null; b.targetVisible = false; }
  let mv;
  const defusing = B.defuser === b;
  if (b.target && b.targetVisible && !(defusing && D === DIFFS.hard && B.need - B.defuseT < 2.5)) {
    if (defusing) { B.defuser = null; B.defuseT = 0; }
    b.planting = 0; mv = combat(b, D, dt);
  } else {
    b.scoped = 0;
    if (!b.reloadEnd && w.def.rpm && w.mag < w.def.mag * .4 && w.reserve > 0) startReload(b);
    if (defusing) { mv = { x: 0, z: 0, speed: 0, crouch: true }; b.yaw += angDiff(b.yaw, yawTo(b.pos, B.pos.x, B.pos.z)) * Math.min(1, dt * 5); b.pitch += (-.6 - b.pitch) * Math.min(1, dt * 5); }
    else {
      mv = navigate(b, dt);
      if (b.hasBomb && B.state === 'carried' && b.wpi >= b.wps.length && siteAt(b.pos.x, b.pos.z) && b.onGround) {
        mv = { x: 0, z: 0, speed: 0, crouch: true }; b.planting += dt;
        if (b.planting >= 3.2 && G.phase === 'live') plantBomb(b);
      } else b.planting = 0;
    }
  }
  b.crouch += ((mv.crouch ? 1 : 0) - b.crouch) * Math.min(1, dt * 8);
  drive(b, mv.x, mv.z, w.def.speed * (b.scoped && w.def.scope ? .5 : 1) * (mv.crouch ? .34 : 1) * mv.speed, dt);
}
function separate() {
  const E = G.ents;
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
    const a = E[i], b = E[j]; if (!a.alive || !b.alive) continue;
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
    if (d < .7 && d > .001 && Math.abs(a.pos.y - b.pos.y) < 1.5) {
      const push = (.7 - d) / ((a.human || b.human) ? 1 : 2), nx = dx / d * push, nz = dz / d * push;
      for (const [e, s] of [[a, -1], [b, 1]]) {
        if (e.human) continue; // humans are never moved by the server so client prediction stays exact
        const x = e.pos.x + nx * s, z = e.pos.z + nz * s;
        if (!collides(x, e.pos.y, z, entHeight(e))) { e.pos.x = x; e.pos.z = z; }
      }
    }
  }
}

// ---------- humans ----------
// 0 = free, 1 = frozen, 2 = frozen and crouched (planting / defusing)
function lockState(e, k, btn, frozen, planted, bombPos, defuserOther) {
  if (frozen) return 1;
  const w = e.weapons[e.slot];
  if ((btn & 1) && w && w.def.c4 && e.onGround && siteAt(e.pos.x, e.pos.z)) return 2;
  if ((k & K.USE) && e.team === 'CT' && planted && !defuserOther && dist2D(e.pos, bombPos) < 1.6 && e.onGround) return 2;
  return 0;
}
Sim.lockState = lockState;
function humanStep(e, dt, k, btn) {
  tickWeapon(e, dt);
  if (e.autoReloadAt && now(e) >= e.autoReloadAt) { e.autoReloadAt = 0; startReload(e); }
  const B = G.bomb;
  const lock = lockState(e, k, btn, G.phase === 'freeze', B.state === 'planted', B.pos, !!B.defuser && B.defuser !== e);
  if (lock === 2 && (k & K.USE) && B.state === 'planted' && !B.defuser) { B.defuser = e; B.need = e.kit ? 5 : 10; B.defuseT = 0; }
  const w = curW(e);
  if (lock === 2 && (btn & 1) && w && w.def.c4) { e.planting += dt; if (e.planting >= 3.2 && G.phase === 'live') plantBomb(e); }
  else e.planting = 0;
  moveHuman(e, dt, k, lock);
  if (e.onGround && Math.hypot(e.vel.x, e.vel.z) > 3.3 && !(k & K.WALK)) {
    e.stepT -= dt;
    if (e.stepT <= 0) { e.stepT = .38; for (const o of G.ents) if (!o.human && o.alive && o.team !== e.team && dist2D(o.pos, e.pos) < 16) hear(o, e.pos); }
  }
  const w2 = curW(e);
  if (w2 && !lock && !w2.def.c4 && (btn & 1) && (w2.def.auto || w2.def.melee || !e.trigPrev)) fire(e);
  e.trigPrev = !!(btn & 1);
  e.spotT -= dt;
  if (e.spotT <= 0) {
    e.spotT = .2; const eye = eyeArr(e);
    for (const o of G.ents) if (o.alive && o.team !== e.team && Math.abs(angDiff(e.yaw, yawTo(e.pos, o.pos.x, o.pos.z))) < 55 * DEG && canSee(eye, o)) o.spot[e.team] = G.T + 1.2;
  }
}
Sim.applyCmd = function (e, c) {
  if (!Number.isFinite(c.dt) || !Number.isSafeInteger(c.s) || c.s <= e.lastSeq) return;
  if ((c.k !== undefined && !Number.isInteger(c.k)) || (c.b !== undefined && !Number.isInteger(c.b))) return;
  const dt = clamp(c.dt, 0, .05); if (!dt) return;
  if (e.clock < G.T - .5) e.clock = G.T - .5;
  if (e.clock + dt > G.T + .3) return; // client running faster than real time
  e.clock += dt; e.lastSeq = c.s;
  if (Number.isFinite(c.y)) e.yaw = c.y % (2 * Math.PI);
  if (Number.isFinite(c.p)) e.pitch = clamp(c.p, -89 * DEG, 89 * DEG);
  if (Number.isFinite(c.vt)) e.viewT = c.vt;
  e.useHeld = !!((c.k | 0) & K.USE);
  if (e.alive) humanStep(e, dt, c.k | 0, c.b | 0);
};
Sim.action = function (e, a) {
  if (a.a === 'buy') return typeof a.v === 'string' && buyItem(e, a.v);
  if (!e.alive) return false;
  const w = curW(e);
  switch (a.a) {
    case 'slot': if ([1, 2, 3, 5].includes(a.v)) switchSlot(e, a.v); break;
    case 'last': switchSlot(e, e.weapons[e.lastSlot] ? e.lastSlot : bestSlot(e)); break;
    case 'reload': startReload(e); break;
    case 'drop': dropCurrent(e); break;
    case 'use': if (!(e.team === 'CT' && G.bomb.state === 'planted' && dist2D(e.pos, G.bomb.pos) < 1.6)) swapNearest(e); break;
    case 'alt':
      if (w && w.def.scope && !e.reloadEnd && now(e) >= e.drawEnd) e.scoped = (e.scoped + 1) % 3;
      else if (w && w.def.melee) fire(e, true);
      break;
  }
  return true;
};

// ---------- roster & rounds ----------
function teamCount(t, humansOnly) { return G.ents.filter(e => e.team === t && (!humansOnly || e.human)).length; }
function freeBotName() { const used = new Set(G.ents.map(e => e.name)); return BOT_NAMES.find(n => !used.has(n)) || 'Bot' + G.nextId; }
function fillBots() {
  for (const t of ['CT', 'T']) {
    const want = Math.max(0, 5 - teamCount(t, true));
    let bots = G.ents.filter(e => e.team === t && !e.human);
    while (bots.length > want) { const b = bots.find(x => !x.alive) || bots[bots.length - 1]; G.ents.splice(G.ents.indexOf(b), 1); bots = bots.filter(x => x !== b); }
    while (bots.length < want) { const b = makeEnt(t, freeBotName(), false); G.ents.push(b); bots.push(b); }
  }
}
Sim.teamHumans = t => teamCount(t, true);
Sim.addHuman = function (name, team) {
  const e = makeEnt(team, name, true); e.clock = G.T; G.ents.push(e);
  if (G.phase === 'freeze') {
    const bot = G.ents.find(b => !b.human && b.team === team);
    if (bot) G.ents.splice(G.ents.indexOf(bot), 1);
    spawnEnt(e, true);
    if (bot && G.bomb.carrier === bot) {
      bot.hasBomb = false; bot.weapons[5] = null; pickupBomb(e);
    }
  }
  return e;
};
Sim.removeHuman = function (e) {
  if (e.alive) { if (e.hasBomb) dropBomb(e); const d = e.weapons[1] || e.weapons[2]; if (d) spawnItem(d, e.pos, e.yaw); }
  if (G.bomb.defuser === e) G.bomb.defuser = null;
  if (G.bomb.carrier === e) G.bomb.carrier = null;
  const i = G.ents.indexOf(e); if (i >= 0) G.ents.splice(i, 1);
  for (const o of G.ents) if (o.target === e) { o.target = null; o.targetVisible = false; }
  checkRoundEnd();
};
Sim.setTeam = function (e, team) {
  if (e.team === team) return;
  if (e.alive) { if (e.hasBomb) dropBomb(e); e.alive = false; checkRoundEnd(); }
  e.team = team; e.weapons = { 1: null, 2: null, 3: null, 5: null }; e.armor = 0; e.helmet = false; e.kit = false;
};
function spawnEnt(e, fresh) {
  if (fresh) { e.weapons = { 1: null, 2: makeWeapon(e.team === 'T' ? 'glock' : 'usp'), 3: makeWeapon('knife'), 5: null }; e.armor = 0; e.helmet = false; e.kit = false; }
  else { e.weapons[5] = null; for (const s of [1, 2]) { const w = e.weapons[s]; if (w) { w.mag = w.def.mag; w.reserve = w.def.res; } } e.weapons[3] = e.weapons[3] || makeWeapon('knife'); }
  const mates = G.ents.filter(o => o.team === e.team && o.alive && o !== e).length;
  const sp = SPAWN[e.team], [c, r] = sp[(mates + randInt(0, 4)) % 5], cp = cellPos(c, r);
  let x = cp.x, z = cp.z;
  for (let k = 0; k < 12; k++) { const tx = cp.x + rand(-.7, .7), tz = cp.z + rand(-.7, .7); if (!G.ents.some(o => o.alive && o !== e && Math.hypot(o.pos.x - tx, o.pos.z - tz) < .8)) { x = tx; z = tz; break; } }
  vset(e.pos, x, 0, z); vset(e.vel, 0, 0, 0);
  e.alive = true; e.hp = 100; e.crouch = 0; e.onGround = true; e.hasBomb = false; e.planting = 0; e.scoped = 0;
  e.yaw = e.team === 'CT' ? Math.PI : 0; e.pitch = 0; e.reloadEnd = 0; e.drawEnd = 0; e.recoilIdx = 0; e.nextFire = 0;
  e.slot = 0; switchSlot(e, e.weapons[1] ? 1 : 2); e.lastSlot = 3; e.teleported = (e.teleported || 0) + 1;
}
function startRound() {
  G.round++; G.phase = 'freeze'; G.freezeT = 6; G.roundT = 115; G.elapsed = 0; G.postT = 0; G.items.length = 0;
  Object.assign(G.bomb, { state: 'none', carrier: null, defuser: null, defuseT: 0, site: null, plantedBy: null });
  fillBots();
  const order = shuffle(G.ents);
  for (const e of order) e._fresh = !e.alive;
  for (const e of order) e.alive = false;
  for (const e of order) spawnEnt(e, e._fresh);
  const ts = G.ents.filter(e => e.team === 'T');
  if (ts.length) { const c = pick(ts); c.hasBomb = true; c.weapons[5] = makeWeapon('c4'); G.bomb.state = 'carried'; G.bomb.carrier = c; }
  for (const e of G.ents) if (!e.human) botBuy(e);
  planBots();
  ev('round', { k: 'start', n: G.round, carrier: G.bomb.carrier ? G.bomb.carrier.id : 0 });
}
Sim.newMatch = function () {
  G.round = 0; G.score = { CT: 0, T: 0 }; G.loss = { CT: 0, T: 0 }; G.winner = null; G.items.length = 0;
  for (const e of G.ents) { e.money = 800; e.kills = 0; e.deaths = 0; e.alive = false; }
  startRound();
};
function checkRoundEnd() {
  if (G.phase !== 'live') return;
  const ct = G.ents.some(e => e.alive && e.team === 'CT'), t = G.ents.some(e => e.alive && e.team === 'T');
  if (!ct) endRound('T', 'elim');
  else if (!t && G.bomb.state !== 'planted') endRound('CT', 'elim');
}
function endRound(win, reason) {
  if (G.phase !== 'live') return;
  G.phase = 'post'; G.postT = 6; const lose = enemyOf(win), B = G.bomb;
  G.score[win]++; G.loss[win] = 0; G.loss[lose] = Math.min(4, G.loss[lose] + 1);
  const winCash = reason === 'bomb' || reason === 'defuse' ? 3500 : 3250, loseCash = 1400 + 500 * (G.loss[lose] - 1);
  for (const e of G.ents) {
    if (e.team === win) e.money = Math.min(16000, e.money + winCash);
    else e.money = Math.min(16000, e.money + ((lose === 'T' && reason === 'time' && e.alive) ? 0 : loseCash) + (lose === 'T' && B.plantedBy ? 800 : 0));
  }
  ev('round', { k: 'end', win, reason });
  if (G.score[win] >= G.target) G.winner = win;
}
Sim.tick = function (dt) {
  G.T += dt;
  if (G.phase === 'over') { G.overT -= dt; if (G.overT <= 0) Sim.newMatch(); return; }
  if (G.phase === 'freeze') { G.freezeT -= dt; if (G.freezeT <= 0) { G.phase = 'live'; ev('round', { k: 'live' }); } }
  else if (G.phase === 'live') {
    G.elapsed += dt;
    if (G.bomb.state !== 'planted') { G.roundT -= dt; if (G.roundT <= 0) { G.roundT = 0; endRound('CT', 'time'); } }
  } else if (G.phase === 'post') {
    G.postT -= dt;
    if (G.postT <= 0) { if (G.winner) { G.phase = 'over'; G.overT = 12; ev('over', { win: G.winner }); } else startRound(); }
  }
  for (const e of G.ents) if (!e.human) updateBot(e, dt);
  separate(); updateItems(dt); updateBomb(dt); recordHistory();
};

// ---------- network snapshots ----------
const BSTATE = ['none', 'carried', 'dropped', 'planted', 'defused', 'exploded'];
Sim.BSTATE = BSTATE;
Sim.snapshot = function () {
  const B = G.bomb;
  return {
    T: r2(G.T), ph: G.phase, rd: G.round, rt: r2(G.roundT), ft: r2(G.freezeT), pt: r2(G.postT), ot: r2(G.overT), el: r2(G.elapsed),
    sc: [G.score.CT, G.score.T], tg: G.target, df: G.diff,
    b: [BSTATE.indexOf(B.state), r2(B.pos.x), r2(B.pos.y), r2(B.pos.z), r2(B.timer), B.defuser ? B.defuser.id : 0, r2(B.defuseT), B.need, B.carrier ? B.carrier.id : 0, r2(B.yaw || 0), B.site || ''],
    e: G.ents.map(e => {
      const w = curW(e);
      const fl = (e.hasBomb ? 1 : 0) | (e.scoped ? 2 : 0) | (e.planting > 0 ? 4 : 0) | (e.reloadEnd ? 8 : 0) | (e.helmet ? 16 : 0) | (e.kit ? 32 : 0) | (B.defuser === e ? 64 : 0) | (e.spot.CT > G.T ? 128 : 0) | (e.spot.T > G.T ? 256 : 0) | (e.human ? 512 : 0);
      return [e.id, e.team === 'CT' ? 0 : 1, r2(e.pos.x), r2(e.pos.y), r2(e.pos.z), Math.round(e.yaw * 1000) / 1000, Math.round(e.pitch * 1000) / 1000, r2(e.crouch), e.alive ? 1 : 0, e.hp, e.armor, w ? w.id : '', fl, e.kills, e.deaths, e.money, e.ping, e.name];
    }),
    it: G.items.map(it => [it.id, it.w.id, r2(it.x), r2(it.y), r2(it.z), r2(it.yaw)]),
  };
};
Sim.meState = function (e) {
  const ws = [];
  for (const s of [1, 2, 3, 5]) { const w = e.weapons[s]; if (w) ws.push([s, w.id, w.mag, w.reserve]); }
  return {
    id: e.id, s: e.lastSeq, ck: e.clock, x: e.pos.x, y: e.pos.y, z: e.pos.z, vx: e.vel.x, vy: e.vel.y, vz: e.vel.z, og: e.onGround ? 1 : 0, cr: e.crouch,
    sl: e.slot, ls: e.lastSlot, sc: e.scoped, nf: e.nextFire, re: e.reloadEnd, de: e.drawEnd, ri: e.recoilIdx, pl: e.planting, ws, tp: e.teleported || 0,
    hp: e.hp, ar: e.armor, hm: e.helmet ? 1 : 0, kt: e.kit ? 1 : 0, m: e.money, al: e.alive ? 1 : 0, team: e.team, buy: canBuyNow(e) ? 1 : 0,
  };
};

if (typeof module !== 'undefined' && module.exports) module.exports = Sim; else root.Sim = Sim;
})(typeof self !== 'undefined' ? self : this);
