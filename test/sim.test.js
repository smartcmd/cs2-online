'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../shared/sim');

function game() {
  const g = Sim.createGame({}); Sim.use(g); Sim.newMatch();
  return g;
}
function isolatedPair(g) {
  const t = Sim.addHuman('attacker', 'T'), ct = Sim.addHuman('defender', 'CT');
  g.ents = [t, ct];
  for (const e of g.ents) { e.hasBomb = false; e.weapons[5] = null; }
  Object.assign(t.pos, { x: 0, y: 0, z: 30 });
  Object.assign(ct.pos, { x: 0, y: 0, z: -30 });
  return { t, ct };
}

test('joining during freeze preserves a valid bomb carrier through all five replacements', () => {
  const g = game();
  for (let i = 0; i < 5; i++) {
    Sim.addHuman('player' + i, 'T');
    assert.ok(g.ents.includes(g.bomb.carrier), 'carrier must still be in the room');
    assert.equal(g.ents.filter(e => e.hasBomb).length, 1);
    assert.ok(g.bomb.carrier.weapons[5]);
    assert.equal(g.ents.filter(e => e.team === 'T').length, 5);
  }
});

test('bomb explosion awards T even if the last terrorist dies and a CT survives', () => {
  const g = game(), { t, ct } = isolatedPair(g);
  g.phase = 'live';
  Object.assign(g.bomb, { state: 'planted', carrier: null, pos: { ...t.pos }, timer: .01, plantedBy: t });
  Sim.tick(1 / 30);
  assert.equal(t.alive, false); assert.equal(ct.alive, true);
  assert.deepEqual(g.score, { CT: 0, T: 1 });
  assert.equal(g.events.find(e => e.e === 'round' && e.k === 'end').reason, 'bomb');
});

test('bomb explosion always uses bomb payout when the last CT dies', () => {
  const g = game(), { t, ct } = isolatedPair(g);
  g.phase = 'live';
  Object.assign(g.bomb, { state: 'planted', carrier: null, pos: { ...ct.pos }, timer: .01, plantedBy: t });
  const money = t.money;
  Sim.tick(1 / 30);
  assert.equal(t.money - money, 3500);
  assert.equal(g.events.find(e => e.e === 'round' && e.k === 'end').reason, 'bomb');
});

test('a defuse completed after the detonation deadline cannot save the bomb', () => {
  const g = game(), { t, ct } = isolatedPair(g);
  g.phase = 'live'; ct.useHeld = true;
  Object.assign(g.bomb, { state: 'planted', pos: { ...ct.pos }, timer: .01, defuser: ct, need: 5, defuseT: 4.98, plantedBy: t });
  Sim.tick(1 / 30);
  assert.equal(g.bomb.state, 'exploded');
  assert.equal(g.score.T, 1);
});

test('a defuse completed before detonation wins even when both finish in one tick', () => {
  const g = game(), { t, ct } = isolatedPair(g);
  g.phase = 'live'; ct.useHeld = true;
  Object.assign(g.bomb, { state: 'planted', pos: { ...ct.pos }, timer: .025, defuser: ct, need: 5, defuseT: 4.99, plantedBy: t });
  Sim.tick(1 / 30);
  assert.equal(g.bomb.state, 'defused'); assert.equal(g.score.CT, 1);
});

test('heavy knife attack cannot damage another player during freeze', () => {
  const g = game(), { t, ct } = isolatedPair(g);
  Object.assign(ct.pos, { x: t.pos.x, y: 0, z: t.pos.z - 1 });
  t.slot = 3; t.yaw = 0; t.pitch = 0; t.drawEnd = 0;
  Sim.action(t, { a: 'alt' });
  assert.equal(ct.hp, 100);
  assert.equal(g.events.filter(e => e.e === 'shot').length, 0);
});

test('invalid difficulty values fall back to normal', () => {
  for (const diff of ['__proto__', 'constructor', 'toString', { toString: null }, null]) {
    assert.equal(Sim.createGame({ diff }).diff, 'normal');
  }
});

test('malformed commands and buy values do not throw or corrupt state', () => {
  const g = game(), p = Sim.addHuman('player', 'CT');
  for (const dt of [{ toString: null }, '0.05', Infinity, NaN, -1]) {
    assert.doesNotThrow(() => Sim.applyCmd(p, { s: 1, dt }));
    assert.equal(p.lastSeq, 0);
  }
  assert.doesNotThrow(() => Sim.action(p, { a: 'buy', v: { toString: null } }));
  assert.ok(Number.isFinite(p.money));
});

test('duplicate or out-of-order commands cannot advance movement or clock', () => {
  const g = game(), p = Sim.addHuman('player', 'CT'); g.phase = 'live';
  const c = { s: 2, dt: .03, k: Sim.K.W, y: 0 };
  Sim.applyCmd(p, c);
  const before = Sim.meState(p);
  Sim.applyCmd(p, c); Sim.applyCmd(p, { ...c, s: 1 });
  assert.deepEqual(Sim.meState(p), before);
});

test('planting clears the bomb carrier reference', () => {
  const g = game(), p = Sim.addHuman('planter', 'T');
  for (const e of g.ents) { e.hasBomb = false; e.weapons[5] = null; }
  p.hasBomb = true; p.weapons[5] = Sim.makeWeapon('c4'); p.slot = 5;
  Object.assign(p.pos, Sim.cellPos(...Sim.SITES.A.plant));
  Object.assign(g.bomb, { state: 'carried', carrier: p }); g.phase = 'live';
  for (let s = 1; s <= 66; s++) { g.T += .05; Sim.applyCmd(p, { s, dt: .05, b: 1 }); }
  assert.equal(g.bomb.state, 'planted'); assert.equal(g.bomb.carrier, null);
  assert.equal(p.hasBomb, false); assert.equal(p.weapons[5], null);
});

test('buying enforces team, money and buy phase', () => {
  const g = game(), p = Sim.addHuman('buyer', 'CT'); p.money = 5000;
  assert.equal(Sim.action(p, { a: 'buy', v: 'ak47' }), false);
  assert.equal(Sim.action(p, { a: 'buy', v: 'm4a4' }), true);
  assert.equal(p.money, 2100);
  assert.equal(Sim.action(p, { a: 'buy', v: 'awp' }), false);
  g.phase = 'live'; g.elapsed = 26;
  assert.equal(Sim.action(p, { a: 'buy', v: 'kit' }), false);
});

test('human shooting enforces fire cooldown and reloading consumes reserve ammo', () => {
  const g = game(), { ct } = isolatedPair(g); g.phase = 'live'; ct.drawEnd = 0;
  const w = ct.weapons[2];
  Sim.applyCmd(ct, { s: 1, dt: .03, b: 1 });
  assert.equal(w.mag, 11);
  Sim.applyCmd(ct, { s: 2, dt: .03, b: 0 });
  Sim.applyCmd(ct, { s: 3, dt: .03, b: 1 });
  assert.equal(w.mag, 11, 'second shot is still on cooldown');
  w.mag = 0; Sim.action(ct, { a: 'reload' });
  for (let s = 4; s <= 64; s++) { g.T += .05; Sim.applyCmd(ct, { s, dt: .05 }); }
  assert.equal(w.mag, 12); assert.equal(w.reserve, 12); assert.equal(ct.reloadEnd, 0);
});

test('flooding commands cannot advance the player beyond the server time budget', () => {
  const g = game(), p = Sim.addHuman('player', 'CT'); g.phase = 'live';
  const initial = { ...p.pos };
  for (let s = 1; s <= 1000; s++) Sim.applyCmd(p, { s, dt: .05, k: Sim.K.W });
  assert.ok(p.clock <= g.T + .3);
  assert.ok(Sim.dist2D(p.pos, initial) <= 6.1 * .3);
});

test('bots complete and restart matches without invalid state on every difficulty', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    const g = Sim.createGame({ diff, target: 1 }); Sim.use(g); Sim.newMatch();
    let completed = 0, restarted = 0;
    for (let tick = 0; tick < 18000; tick++) {
      Sim.tick(1 / 30);
      for (const event of g.events) {
        if (event.e === 'over') completed++;
        if (completed && event.e === 'round' && event.k === 'start') restarted++;
      }
      g.events.length = 0;
      if (tick % 30) continue;
      assert.equal(g.ents.length, 10);
      for (const e of g.ents) {
        for (const v of [e.pos.x, e.pos.y, e.pos.z, e.yaw, e.pitch, e.hp, e.money]) assert.ok(Number.isFinite(v), diff);
        assert.ok(e.money >= 0 && e.money <= 16000);
      }
      if (g.bomb.state === 'carried') {
        assert.ok(g.ents.includes(g.bomb.carrier)); assert.ok(g.bomb.carrier.hasBomb);
      }
    }
    assert.ok(completed > 0, diff + ' must finish a match');
    assert.ok(restarted > 0, diff + ' must restart after the match');
  }
});
