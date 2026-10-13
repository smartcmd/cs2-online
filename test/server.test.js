'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const WebSocket = require('ws');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function start(t, env = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '0', CS2_DEBUG: '0', CS2_LAG_MS: '0', CS2_JITTER_MS: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill(); await exited;
    }
  });
  for (let i = 0; i < 1500; i++) {
    const m = output.match(/http:\/\/localhost:(\d+)/);
    if (m) return { url: `http://127.0.0.1:${m[1]}`, child, output: () => output };
    if (child.exitCode !== null) throw new Error(output);
    await delay(20);
  }
  throw new Error('server startup timeout: ' + output);
}
async function client(t, server) {
  const ws = new WebSocket(server.url.replace('http:', 'ws:') + '/ws');
  const messages = []; ws.on('message', b => {
    const m = JSON.parse(b); messages.push(m);
    if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', n: m.n }));
  });
  ws.on('error', () => {});
  t.after(() => ws.terminate());
  await once(ws, 'open');
  return {
    ws, messages,
    send: m => ws.send(JSON.stringify(m)),
    async wait(predicate) {
      for (let i = 0; i < 200; i++) {
        const m = messages.find(predicate); if (m) return m;
        if (ws.readyState === WebSocket.CLOSED) throw new Error('socket closed: ' + server.output());
        await delay(10);
      }
      throw new Error('message timeout: ' + server.output());
    },
  };
}
const rooms = async s => (await fetch(s.url + '/rooms')).json();

test('HTTP serves the client, shared simulation and health endpoint', async t => {
  const s = await start(t);
  for (const [route, content] of [['/', 'CS2'], ['/sim.js', 'createGame'], ['/three.min.js', 'THREE'], ['/healthz', 'ok']]) {
    const res = await fetch(s.url + route); assert.equal(res.status, 200);
    assert.ok((await res.text()).includes(content));
  }
  assert.equal((await fetch(s.url + '/missing')).status, 404);
  assert.deepEqual(await rooms(s), []);
});

test('map transfers compressed geometry and never serves the source texture library', async t => {
  const s = await start(t);
  const info = await (await fetch(s.url + '/maps/dust2.json')).json();
  const file = info.files.find(f => f.name === 'dust2.mesh.gz');
  const res = await fetch(s.url + '/maps/' + file.name);
  assert.equal(res.status, 200); assert.equal(res.headers.get('content-encoding'), 'gzip');
  assert.equal(Number(res.headers.get('content-length')), file.bytes);
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString(), 'D2L1');
  assert.equal((await fetch(s.url + '/assets/map-cs2/dust2-web.gltf')).status, 404);
  for (const route of ['/dust2-world.js', '/dust2-mesh.js', '/dust2-data.js', '/bvh.js']) assert.equal((await fetch(s.url + route)).status, 200);
});

test('ten players join, teams cap at five, eleventh is rejected, empty room is removed', async t => {
  const s = await start(t), clients = [], teams = [];
  for (let i = 0; i < 11; i++) {
    const c = await client(t, s); clients.push(c);
    c.send({ t: 'join', room: 'capacity', name: 'same', team: 'T' });
    const m = await c.wait(m => m.t === 'welcome' || m.t === 'err');
    if (i < 10) { assert.equal(m.t, 'welcome'); teams.push(m.team); }
    else assert.equal(m.t, 'err');
  }
  assert.equal(teams.filter(v => v === 'T').length, 5);
  assert.equal(teams.filter(v => v === 'CT').length, 5);
  const snap = await clients[0].wait(m => m.t === 's' && m.b.e.filter(e => e[12] & 512).length === 10);
  assert.equal(new Set(snap.b.e.map(e => e[17])).size, 10);
  assert.equal((await rooms(s))[0].humans, 10);
  for (const c of clients) c.ws.close();
  for (let i = 0; i < 100 && (await rooms(s)).length; i++) await delay(10);
  assert.deepEqual(await rooms(s), []);
});

test('malformed join, command, action and chat payloads cannot crash the server', async t => {
  const s = await start(t), c = await client(t, s);
  const bad = { toString: null, valueOf: null };
  c.send({ t: 'join', room: bad, name: bad, diff: bad, target: bad });
  const welcome = await c.wait(m => m.t === 'welcome');
  assert.equal(welcome.diff, 'normal'); assert.equal(welcome.target, 8);
  c.ws.send('{invalid json'); c.send(null); c.send([]);
  for (const field of ['dt', 's', 'k', 'b']) c.send({ t: 'c', c: [{ s: 1, dt: .03, [field]: bad }] });
  c.send({ t: 'a', a: 'buy', v: bad }); c.send({ t: 'chat', text: bad });
  c.send({ t: 'c', c: [{ s: 2, dt: .03, k: 0, b: 0, y: 1e308 }] });
  const snap = await c.wait(m => m.t === 's' && m.me.s === 2);
  assert.ok(Number.isFinite(snap.b.e.find(e => e[0] === welcome.id)[5]));
  assert.equal((await fetch(s.url + '/healthz')).status, 200);
  assert.equal(s.child.exitCode, null);
});

test('team chat stays in the team and rooms stay isolated', async t => {
  const s = await start(t), clients = [];
  for (const [room, team] of [['one', 'CT'], ['one', 'CT'], ['one', 'T'], ['two', 'CT']]) {
    const c = await client(t, s); clients.push(c); c.send({ t: 'join', room, team });
    await c.wait(m => m.t === 'welcome');
  }
  clients[0].send({ t: 'chat', text: 'team-only-test', team: true });
  await clients[1].wait(m => m.t === 'chat' && m.text === 'team-only-test');
  await delay(100);
  for (const c of clients.slice(2)) assert.equal(c.messages.some(m => m.text === 'team-only-test'), false);
  assert.equal((await rooms(s)).length, 2);
});

test('disconnect before delayed join does not leave a ghost room', async t => {
  const s = await start(t, { CS2_LAG_MS: '300' }), c = await client(t, s);
  c.send({ t: 'join', room: 'ghost' });
  const closed = once(c.ws, 'close'); c.ws.close(); await closed;
  await delay(350);
  assert.deepEqual(await rooms(s), []);
});
