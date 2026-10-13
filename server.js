'use strict';
// CS2 网页版 online server: serves the client and runs authoritative game rooms over WebSocket.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Sim = require('./shared/sim.js');

const PORT = Number(process.env.PORT ?? 8080);
const TICK = 1 / 30, SNAP_EVERY = 2, MAX_ROOMS = 50, MAX_HUMANS = 10;

// ---------- static files ----------
const FILES = {
  '/': [path.join(__dirname, 'public/index.html'), 'text/html; charset=utf-8'],
  '/index.html': [path.join(__dirname, 'public/index.html'), 'text/html; charset=utf-8'],
  '/sim.js': [path.join(__dirname, 'shared/sim.js'), 'text/javascript; charset=utf-8'],
  '/three.min.js': [require.resolve('three/build/three.min.js'), 'text/javascript; charset=utf-8'],
};
const cache = new Map();
function serveFile(res, file, type) {
  let body = cache.get(file);
  if (!body || process.env.NODE_ENV !== 'production') { body = fs.readFileSync(file); cache.set(file, body); }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': body.length });
  res.end(body);
}
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url === '/rooms') {
    const list = [...rooms.values()].map(r => ({ name: r.name, humans: r.clients.size, diff: r.G.diff, target: r.G.target, round: r.G.round, score: r.G.score }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(list));
  }
  const f = FILES[url];
  if (f && req.method === 'GET') { try { return serveFile(res, f[0], f[1]); } catch (e) { res.writeHead(500); return res.end('error'); } }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('not found');
});

// ---------- rooms ----------
const rooms = new Map();
const cleanName = s => (typeof s === 'string' ? s : '').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').trim().slice(0, 16);
const cleanRoom = s => ((typeof s === 'string' ? s : '').toLowerCase().match(/[a-z0-9_\-一-龥]+/g) || []).join('').slice(0, 16) || 'public';
function getRoom(name, opts) {
  let r = rooms.get(name);
  if (!r) {
    if (rooms.size >= MAX_ROOMS) return null;
    const target = opts.target === 13 || opts.target === '13' ? 13 : 8;
    const G = Sim.createGame({ diff: opts.diff, target });
    r = { name, G, clients: new Set(), tickN: 0 };
    Sim.use(G); Sim.newMatch(); G.events.length = 0;
    rooms.set(name, r);
    console.log(`room "${name}" created (${G.diff}, first to ${G.target})`);
  }
  return r;
}
// optional artificial latency for local testing: CS2_LAG_MS (round trip) and CS2_JITTER_MS
const LAG = (+process.env.CS2_LAG_MS || 0) / 2, JIT = +process.env.CS2_JITTER_MS || 0;
function delayed(ws, key, fn) {
  if (!LAG && !JIT) return fn();
  const due = Math.max(ws[key] || 0, Date.now() + LAG + Math.random() * JIT); ws[key] = due;
  setTimeout(fn, due - Date.now());
}
function send(ws, obj) { const s = typeof obj === 'string' ? obj : JSON.stringify(obj); delayed(ws, '_outDue', () => { if (ws.readyState === 1) ws.send(s); }); }
function broadcast(r, obj, filter) { const s = JSON.stringify(obj); for (const c of r.clients) if (!filter || filter(c)) send(c.ws, s); }

function join(c, msg) {
  if (c.room) return;
  const rname = cleanRoom(msg.room);
  const r = getRoom(rname, msg); if (!r) return send(c.ws, { t: 'err', msg: '服务器房间数已满，请稍后再试' });
  if (r.clients.size >= MAX_HUMANS) return send(c.ws, { t: 'err', msg: '这个房间已经满了（10 人）' });
  Sim.use(r.G);
  let team = msg.team === 'T' || msg.team === 'CT' ? msg.team : (Sim.teamHumans('CT') <= Sim.teamHumans('T') ? 'CT' : 'T');
  if (Sim.teamHumans(team) >= 5) team = Sim.enemyOf(team);
  let name = cleanName(msg.name) || '玩家' + Math.floor(Math.random() * 900 + 100);
  const taken = new Set(r.G.ents.map(e => e.name)); let base = name, n = 2; while (taken.has(name)) name = base.slice(0, 13) + '#' + n++;
  c.ent = Sim.addHuman(name, team); c.room = r; r.clients.add(c);
  send(c.ws, { t: 'welcome', id: c.ent.id, room: r.name, name, team, diff: r.G.diff, target: r.G.target });
  broadcast(r, { t: 'chat', sys: 1, text: `${name} 加入了${Sim.TEAM_CN[team]}` });
  console.log(`[${r.name}] ${name} joined ${team} (${r.clients.size} humans)`);
}
function leave(c) {
  const r = c.room; if (!r) return;
  r.clients.delete(c); Sim.use(r.G); Sim.removeHuman(c.ent);
  broadcast(r, { t: 'chat', sys: 1, text: `${c.ent.name} 离开了游戏` });
  console.log(`[${r.name}] ${c.ent.name} left (${r.clients.size} humans)`);
  if (!r.clients.size) { rooms.delete(r.name); console.log(`room "${r.name}" closed`); }
  c.room = null;
}
function onMessage(c, raw) {
  if (c.ws.readyState !== 1) return; // delayed input must not resurrect a disconnected client
  c.lastMsg = Date.now();
  if (++c.msgCount > 400) return; // per-second flood guard
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'join') return join(c, m);
  if (m.t === 'pong') { if (c.pingSent && m.n === c.pingN) { c.rtt = Date.now() - c.pingSent; if (c.ent) c.ent.ping = Math.round(c.rtt); } return; }
  const r = c.room; if (!r) return;
  Sim.use(r.G);
  if (m.t === 'dbg' && process.env.CS2_DEBUG === '1') { try { const out = new Function('Sim', 'G', 'me', m.code)(Sim, r.G, c.ent); send(c.ws, { t: 'dbg', out: JSON.stringify(out === undefined ? null : out) }); } catch (e) { send(c.ws, { t: 'dbg', out: 'ERR ' + e.message }); } return; }
  if (m.t === 'c' && Array.isArray(m.c)) { for (const cmd of m.c.slice(0, 20)) if (cmd && typeof cmd === 'object') Sim.applyCmd(c.ent, cmd); }
  else if (m.t === 'a' && typeof m.a === 'string') Sim.action(c.ent, m);
  else if (m.t === 'team' && (m.v === 'CT' || m.v === 'T')) {
    if (m.v !== c.ent.team && Sim.teamHumans(m.v) < 5) { Sim.setTeam(c.ent, m.v); broadcast(r, { t: 'chat', sys: 1, text: `${c.ent.name} 加入了${Sim.TEAM_CN[m.v]}` }); }
  } else if (m.t === 'chat') {
    if (typeof m.text !== 'string') return;
    const text = m.text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120); if (!text) return;
    if (Date.now() - (c.lastChat || 0) < 600) return; c.lastChat = Date.now();
    const team = !!m.team, from = c.ent;
    broadcast(r, { t: 'chat', name: from.name, team: from.team, teamOnly: team, alive: from.alive, text }, cl => !team || cl.ent.team === from.team);
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', ws => {
  const c = { ws, room: null, ent: null, msgCount: 0, lastMsg: Date.now(), rtt: 0, pingN: 0, pingSent: 0 };
  ws.on('message', data => { const t = data.toString(); delayed(ws, '_inDue', () => onMessage(c, t)); });
  ws.on('close', () => leave(c));
  ws.on('error', () => {});
  ws._c = c;
});

// ---------- main loop ----------
let last = process.hrtime.bigint(), acc = 0;
setInterval(() => {
  const t = process.hrtime.bigint(); acc += Number(t - last) / 1e9; last = t;
  if (acc > 0.5) acc = 0.5;
  while (acc >= TICK) {
    acc -= TICK;
    for (const r of rooms.values()) {
      Sim.use(r.G); Sim.tick(TICK); r.tickN++;
      if (r.tickN % SNAP_EVERY) continue;
      const base = JSON.stringify(Sim.snapshot()), evs = JSON.stringify(r.G.events); r.G.events.length = 0;
      for (const c of r.clients) send(c.ws, `{"t":"s","b":${base},"ev":${evs},"me":${JSON.stringify(Sim.meState(c.ent))}}`);
    }
  }
}, 1000 / 60);
setInterval(() => {
  const nowMs = Date.now();
  for (const ws of wss.clients) {
    const c = ws._c; if (!c) continue;
    c.msgCount = 0;
    if (nowMs - c.lastMsg > 20000) { ws.terminate(); continue; }
  }
}, 1000);
setInterval(() => {
  for (const ws of wss.clients) { const c = ws._c; if (!c) continue; c.pingN++; c.pingSent = Date.now(); send(ws, { t: 'ping', n: c.pingN }); }
}, 2000);

server.listen(PORT, () => console.log(`CS2 网页版 server listening on http://localhost:${server.address().port}`));
