'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Sim = require('../shared/sim');
const manifest = require('../public/maps/dust2.json');

test('map assets match their manifest and surface textures stay lightweight', () => {
  let bytes = 0;
  for (const file of manifest.files) {
    const content = fs.readFileSync(path.join(__dirname, '../public/maps', file.name));
    assert.equal(content.length, file.bytes);
    assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256);
    if (file.name.endsWith('.webp')) bytes += content.length;
  }
  assert.ok(bytes < 1024 * 1024, `map assets grew to ${bytes} bytes`);
});

test('original spawn positions have standing clearance on the source-map floor', () => {
  for (const team of ['CT', 'T']) for (const spawn of Sim.MAP.spawns[team]) {
    const floor = Sim.World.floor(spawn.x, spawn.z, spawn.y + .6, 2);
    assert.notEqual(floor, null, team);
    assert.equal(Sim.collides(spawn.x, floor + .005, spawn.z, 1.8), false, team);
  }
});

test('both teams can physically navigate from spawn to both bombsites', () => {
  for (const team of ['CT', 'T']) for (const id of ['A', 'B']) {
    const start = Sim.MAP.spawns[team][0], target = Sim.MAP.sites[id];
    const route = Sim.findPath(start.x, start.z, target.x, target.z, start.y, target.y);
    assert.ok(route && route.length, `${team} → ${id} must have a route`);
    const player = { pos: { x: start.x, y: Sim.World.floor(start.x, start.z, start.y + .5) + .003, z: start.z }, vel: Sim.V(), crouch: 0, onGround: true };
    let waypoint = 0;
    for (let tick = 0; tick < 7200 && waypoint < route.length; tick++) {
      const next = route[waypoint], distance = Sim.dist2D(player.pos, next);
      if (distance < .55 && Math.abs(player.pos.y - next.y) < 1) { waypoint++; continue; }
      if (player.onGround && next.y - player.pos.y > .5 && distance < 3) { player.vel.y = 7.2; player.onGround = false; }
      Sim.drive(player, (next.x - player.pos.x) / distance, (next.z - player.pos.z) / distance, 5, 1 / 60);
      assert.ok(player.pos.y > -10, 'must not fall through the map');
    }
    assert.equal(waypoint, route.length, `${team} → ${id} got stuck at ${waypoint}`);
    assert.equal(Sim.siteAt(player.pos.x, player.pos.z, player.pos.y), id);
  }
});

test('ground rays agree with the same mesh used for movement', () => {
  const spawn = Sim.MAP.spawns.T[0], floor = Sim.World.floor(spawn.x, spawn.z, spawn.y + .6);
  const hit = Sim.rayWorld([spawn.x, floor + 1.6, spawn.z], [0, -1, 0], 3);
  assert.ok(hit); assert.ok(Math.abs(hit.t - 1.6) < .001);
  assert.equal(hit.axis, 1);
  assert.equal(Sim.siteAt(30, -67, -3), null, 'CT underpass is not the elevated A plant zone');
});

test('A-site crate sides retain both movement and bullet cover', () => {
  const hit = Sim.rayWorld([29, 3.2, -63], [1, 0, 0], 3);
  assert.ok(hit && hit.t < 2, 'the wooden sides must remain below the crate cover');
  const player = { pos: { x: 29, y: Sim.World.floor(29, -63, 3), z: -63 }, vel: Sim.V(), crouch: 0, onGround: true };
  for (let i = 0; i < 20; i++) Sim.drive(player, 1, 0, 5, 1 / 60);
  assert.ok(player.pos.x < 30, 'walking must not pass through the crate');
});

test('map packing preserves every source triangle and the exact decoded positions and indices', () => {
  const zlib = require('node:zlib');
  const bytes = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, '../public/maps/dust2.mesh.gz')));
  const geometry = require('../shared/dust2-mesh').geometry(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), manifest);
  assert.equal(manifest.positionEncoding, 'source-accessors-lossless');
  assert.equal(manifest.sourceTriangles, 4542407);
  assert.equal(geometry.index.count / 3, manifest.sourceTriangles);
  assert.equal(createHash('sha256').update(new Uint8Array(geometry.attributes.position.array.buffer)).digest('hex'), manifest.positionSHA256);
  assert.equal(createHash('sha256').update(new Uint8Array(geometry.index.array.buffer)).digest('hex'), manifest.indexSHA256);
  geometry.dispose();
});
