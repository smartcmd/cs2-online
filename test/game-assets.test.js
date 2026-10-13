'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const manifest = require('../public/game/assets.json');
const read = name => fs.readFileSync(path.join(__dirname, '../public/game', name));
function gltf(name) {
  const bytes = read(name);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  return JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
}

test('actor assets are complete, self-contained and below the compressed download budget', () => {
  let transfer = 0;
  for (const file of manifest.files) {
    const bytes = read(file.name);
    assert.equal(bytes.length, file.bytes, file.name);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.name);
    transfer += file.name.endsWith('.glb') ? gzipSync(bytes).length : bytes.length;
    if (file.name.endsWith('.glb')) {
      const model = gltf(file.name);
      for (const buffer of model.buffers) assert.equal(buffer.uri, undefined);
      for (const image of model.images || []) assert.ok(Number.isInteger(image.bufferView));
    }
  }
  assert.ok(transfer < 11 * 1048576, `actor resources transfer ${transfer} bytes`);
  for (const id of manifest.weapons) assert.ok(gltf(id + '.glb').meshes.length > 0, id);
});

test('player and viewmodel animation sets include gameplay actions for every weapon family', () => {
  for (const id of ['ct', 't', 'arms']) {
    const model = gltf(id + '.glb');
    assert.ok(model.skins.length > 0, id);
    assert.ok(model.nodes.some(n => n.name === 'wpn'), id);
  }
  const views = new Set(gltf('weapon-animations.glb').animations.map(a => a.name));
  for (const family of ['ak47', 'm4a4', 'galilar', 'awp', 'pistol', 'usp', 'deagle']) {
    for (const action of ['idle', 'draw', 'shoot', 'reload']) assert.ok(views.has(family + '/' + action), family + '/' + action);
  }
  const players = new Set(gltf('player-animations.glb').animations.map(a => a.name));
  for (const family of ['rifle', 'pistol', 'knife']) for (const action of ['idle', 'walk', 'crouchIdle', 'crouchMove']) assert.ok(players.has(family + '/' + action));
  assert.ok(players.has('death'));
});
