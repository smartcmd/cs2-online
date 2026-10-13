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

test('fullscreen toggles, updates labels and reports a denied request', async () => {
  const handlers = {}, button = { addEventListener() {} }, notices = [];
  const document = { fullscreenElement: null, querySelectorAll: () => [button], addEventListener: (name, fn) => handlers[name] = fn };
  document.documentElement = { requestFullscreen: async () => { document.fullscreenElement = document.documentElement; handlers.fullscreenchange(); } };
  document.exitFullscreen = async () => { document.fullscreenElement = null; handlers.fullscreenchange(); };
  const ctx = run(section('async function toggleFullscreen()', '// ---------- input ----------'), { document, inGame: false, banner: (...args) => notices.push(args) });
  await ctx.toggleFullscreen(); assert.match(button.textContent, /退出全屏/);
  await ctx.toggleFullscreen(); assert.match(button.textContent, /全屏游戏/);
  document.documentElement.requestFullscreen = async () => { throw Error('denied'); };
  await ctx.toggleFullscreen(); assert.equal(notices.length, 1); assert.equal(document.fullscreenElement, null);
});

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

test('Escape resumes touch mode but does not recapture a released desktop pointer', () => {
  const handlers = {}, elements = { pause: { hidden: true }, buy: { hidden: true }, over: { hidden: true } };
  const keys = { KeyW: true }, mouse = { left: true };
  const ctx = run(section("\naddEventListener('keydown', e =>", "\naddEventListener('keyup'"), {
    inGame: true, touchControlsActive: true, keys, mouse, P: { alive: true },
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
  ctx.touchControlsActive = false; elements.pause.hidden = false;
  handlers.keydown(escape); assert.equal(elements.pause.hidden, false);
});

function pointerHarness(request) {
  const handlers = {}, elements = { pause: { hidden: true }, buy: { hidden: true }, over: { hidden: true }, pointerHint: { textContent: '' } };
  const canvas = { requestPointerLock: request, focus() {} }, keys = { KeyW: true }, mouse = { left: true };
  const document = { pointerLockElement: null, hidden: false, hasFocus: () => true, body: { classList: { toggle() {} } }, addEventListener: (name, fn) => { handlers[name] = fn; } };
  const ctx = run(section('let touchControlsActive =', "\naddEventListener('keydown', e =>"), { inGame: true, renderer: { domElement: canvas }, document, keys, mouse, $: id => elements[id], chatOpen: () => false });
  return { ctx, document, canvas, handlers, elements, keys, mouse };
}

test('pointer rejection keeps desktop input paused and permits a later successful retry', async () => {
  let calls = 0;
  const h = pointerHarness(() => { calls++; return Promise.reject(new Error('NotAllowedError')); });
  h.ctx.lockPointer(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.elements.pause.hidden, false); assert.equal(vm.runInContext('looking()', h.ctx), false);
  assert.equal(h.keys.KeyW, false); assert.equal(h.mouse.left, false);
  h.canvas.requestPointerLock = () => { calls++; h.document.pointerLockElement = h.canvas; h.handlers.pointerlockchange(); return Promise.resolve(); };
  h.ctx.lockPointer(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2); assert.equal(h.elements.pause.hidden, true); assert.equal(vm.runInContext('looking()', h.ctx), true);
  h.document.pointerLockElement = null; h.keys.KeyW = true; h.mouse.left = true; h.handlers.pointerlockchange();
  assert.equal(h.elements.pause.hidden, false); assert.equal(h.keys.KeyW, false); assert.equal(h.mouse.left, false);
});

test('synchronous capture errors and a different locked element never enable mouse aiming', () => {
  const h = pointerHarness(() => { throw new Error('unsupported'); });
  h.ctx.lockPointer(); h.ctx.lockPointer();
  assert.equal(h.elements.pause.hidden, false); assert.equal(vm.runInContext('looking()', h.ctx), false);
  h.document.pointerLockElement = {}; h.elements.pause.hidden = true;
  assert.equal(vm.runInContext('looking()', h.ctx), false);
  vm.runInContext('touchControlsActive=true', h.ctx); assert.equal(vm.runInContext('looking()', h.ctx), true);
  vm.runInContext('touchControlsActive=false', h.ctx); assert.equal(vm.runInContext('looking()', h.ctx), false);
});

test('unlocked desktop mouse motion cannot rotate the camera even with touch controls enabled', () => {
  const handlers = {}, player = { alive: true, yaw: 0, pitch: 0 };
  run(section("addEventListener('mousemove', e =>", "addEventListener('wheel', e =>"), {
    addEventListener: (name, fn) => { handlers[name] = fn; }, pointerCaptured: () => false, looking: () => true, P: player,
  });
  handlers.mousemove({ movementX: 50, movementY: 50 }); assert.equal(player.yaw, 0); assert.equal(player.pitch, 0);
});

test('a delayed pointer capture cannot trap the cursor after leaving a match', () => {
  const h = pointerHarness(() => undefined);
  h.document.exitPointerLock = () => { h.document.pointerLockElement = null; h.handlers.pointerlockchange(); };
  h.ctx.lockPointer();
  vm.runInContext('captureWanted=false; inGame=false', h.ctx);
  h.document.pointerLockElement = h.canvas; h.handlers.pointerlockchange();
  assert.equal(h.document.pointerLockElement, null);
  assert.equal(vm.runInContext('looking()', h.ctx), false);
});
