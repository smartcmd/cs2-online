'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Sim = require('../shared/sim');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function section(start, end) { return script.slice(script.indexOf(start), script.indexOf(end)); }
function run(source, globals) { const context = vm.createContext(globals); vm.runInContext(source, context); return context; }

test('client script parses', () => { new vm.Script(script); });

test('menus suppress held movement keys', () => {
  const ctx = run(section('function keyBits()', 'function localStep('), {
    keys: { KeyW: true, KeyE: true }, K: Sim.K, chatOpen: () => false, looking: () => false,
  });
  assert.equal(ctx.keyBits(), 0);
  ctx.looking = () => true;
  assert.equal(ctx.keyBits(), Sim.K.W | Sim.K.USE);
});

test('pending shots from another weapon do not lower the selected magazine', () => {
  const ctx = run(section('const pendingShots =', '// ---------- local prediction'), {
    pending: [{ shot: 'usp' }, { shot: 'usp' }, { shot: 'm4a4' }],
  });
  assert.equal(vm.runInContext('predMag({ id: "m4a4", mag: 30 })', ctx), 29);
  assert.equal(vm.runInContext('predMag({ id: "usp", mag: 12 })', ctx), 10);
});

test('a stale socket close or message cannot affect a newer connection', () => {
  const sockets = [], sent = [], messages = [], errors = [];
  class Socket { constructor() { sockets.push(this); } }
  const ctx = run(section('function connect()', 'function onMsg('), {
    ws: null, errShown: false, inGame: false, WebSocket: Socket,
    location: { protocol: 'http:', host: 'localhost' }, settings: {},
    sendRaw: m => sent.push(m), onMsg: m => messages.push(m),
    showMenuErr: m => errors.push(m), leaveToMenu: m => errors.push(m),
  });
  ctx.connect(); ctx.connect();
  sockets[0].onopen(); sockets[0].onmessage({ data: '{"t":"welcome"}' }); sockets[0].onclose();
  assert.equal(ctx.ws, sockets[1]); assert.equal(sent.length, 0); assert.equal(messages.length, 0); assert.equal(errors.length, 0);
  sockets[1].onopen(); assert.equal(sent.length, 1);
});

test('Escape opens and resumes pause when pointer lock is unavailable', () => {
  const handlers = {}, elements = { pause: { hidden: true }, buy: { hidden: true }, over: { hidden: true } };
  const keys = { KeyW: true }, mouse = { left: true };
  const ctx = run(section("\naddEventListener('keydown', e =>", "\naddEventListener('keyup'"), {
    inGame: true, noLock: true, keys, mouse, P: { alive: true },
    $: id => elements[id], chatOpen: () => false,
    document: { pointerLockElement: null },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    lockPointer: () => { elements.pause.hidden = true; },
  });
  const escape = { code: 'Escape', preventDefault() {} };
  handlers.keydown(escape);
  assert.equal(elements.pause.hidden, false); assert.equal(keys.KeyW, false); assert.equal(mouse.left, false);
  handlers.keydown(escape); assert.equal(elements.pause.hidden, true);
  // A native Escape may unlock the pointer before its keydown is delivered.
  ctx.noLock = false; elements.pause.hidden = false;
  handlers.keydown(escape); assert.equal(elements.pause.hidden, false);
});
