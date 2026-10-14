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
  assert.ok(bytes < 10 * 1024 * 1024, `map assets grew to ${bytes} bytes`);
});

test('original spawn positions have standing clearance on the source-map floor', () => {
  for (const team of ['CT', 'T']) for (const spawn of Sim.MAP.spawns[team]) {
    const floor = Sim.World.floor(spawn.x, spawn.z, spawn.y + .6, 2);
    assert.notEqual(floor, null, team);
    const support = Sim.World.support(spawn.x, spawn.z, floor, .5, .05);
    assert.notEqual(support, null, team);
    assert.equal(Sim.collides(spawn.x, support, spawn.z, 1.8), false, team);
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

test('standing still on source-map ramps preserves position at different tick rates', () => {
  for (const [x, z] of [[18.0149, -56.2356], [36.8268, -10.4013]]) for (const fps of [30, 60, 120]) {
    const floor = Sim.World.floor(x, z, 10, 25);
    assert.notEqual(floor, null);
    const p = { pos: { x, y: floor, z }, vel: Sim.V(), onGround: true };
    for (let i = 0; i < 5; i++) Sim.World.move(p, 1 / fps, 1.8);
    const rest = { ...p.pos };
    for (let i = 0; i < fps * 5; i++) Sim.World.move(p, 1 / fps, 1.8);
    assert.ok(Math.hypot(p.pos.x - rest.x, p.pos.y - rest.y, p.pos.z - rest.z) < .001);
    assert.ok(p.onGround);
  }
});

test('A-site crate sides retain both movement and bullet cover', () => {
  const hit = Sim.rayWorld([29, 3.2, -63], [1, 0, 0], 3);
  assert.ok(hit && hit.t < 2, 'the wooden sides must remain below the crate cover');
  const player = { pos: { x: 29, y: Sim.World.floor(29, -63, 3), z: -63 }, vel: Sim.V(), crouch: 0, onGround: true };
  for (let i = 0; i < 20; i++) Sim.drive(player, 1, 0, 5, 1 / 60);
  assert.ok(player.pos.x < 30, 'walking must not pass through the crate');
});

test('CT spawn window gaps are occluded at the original collision surface', () => {
  const hit = Sim.World.raycast([8, -1.2, -54], [.3553876608820764, .3215357739068369, .8776755417527012], 5, true);
  assert.ok(hit, 'the window border must not expose the far side of the building');
  assert.ok(Math.abs(hit.t - 2.7128482059) < .0001);
  assert.ok(Math.abs(hit.point.z + 51.619) < .0001);
  for (const [x, y] of [[8.95, -.32], [9.75, -.32], [5.72, 0], [6.36, 0]]) {
    const forward = Sim.World.raycast([x, y, -53], [0, 0, 1], 2, true);
    const backward = Sim.World.raycast([x, y, -50], [0, 0, -1], 2, true);
    assert.ok(forward && backward, `window surround ${x},${y} must block in both directions`);
  }
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
  const repaired = require('../shared/dust2-mesh').geometry(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), manifest, null, true);
  const extra = manifest.surfaceRepairs.positions.length / 3;
  assert.equal(extra / 3, 110);
  assert.equal(repaired.index.count, geometry.index.count + extra);
  assert.equal(createHash('sha256').update(new Uint8Array(repaired.attributes.position.array.buffer, 0, geometry.attributes.position.array.byteLength)).digest('hex'), manifest.positionSHA256);
  assert.equal(createHash('sha256').update(new Uint8Array(repaired.index.array.buffer, 0, geometry.index.array.byteLength)).digest('hex'), manifest.indexSHA256);
  assert.equal(createHash('sha256').update(new Uint8Array(repaired.attributes.position.array.buffer, geometry.attributes.position.array.byteLength)).digest('hex'), manifest.surfaceRepairs.positionSHA256);
  assert.deepEqual(manifest.surfaceRepairs.sourceTriangles, require('../config/dust2-surface-repairs.json').triangles);
  assert.equal(repaired.userData.dust2.meta.groups.at(-1).count, extra);
  repaired.dispose();
  geometry.dispose();
});
