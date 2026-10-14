'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const Sim = require('../shared/sim');
const meta = require('../public/maps/dust2.json');
const step = 3, origin = [-60, -5, -83], size = [37, 8, 40];
const sun = require('../public/lighting').sunDirection;
const THREE = require('three'), source = JSON.parse(fs.readFileSync('.cache/dust2/assets/map-cs2/dust2-web.gltf'));
const sourceSun = source.nodes.find(node => node.name === 'light_environment');
const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().fromArray(sourceSun.rotation)).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
if (direction.distanceTo(new THREE.Vector3(...sun)) > .00001) throw Error('Source sunlight changed; update the shared light direction before baking');
const directions = Array.from({ length: 16 }, (_, i) => {
  const y = (i + .5) / 16, a = i * Math.PI * (3 - Math.sqrt(5)), r = Math.sqrt(1 - y * y);
  return [Math.cos(a) * r, y, Math.sin(a) * r];
});
// X/Z slices stacked vertically. Sampling interpolates X/Z in hardware and Y in the shader.
const pixels = new Uint8Array(size[0] * size[1] * size[2] * 4);
for (let y = 0; y < size[1]; y++) {
  for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
    const point = [origin[0] + x * step, origin[1] + y * step, origin[2] + z * step];
    let sky = 0, bounce = 0;
    for (const direction of directions) {
      const hit = Sim.World.raycast(point, direction, 80);
      if (!hit) { sky++; continue; }
      const n = hit.normal.clone(); if (n.x * direction[0] + n.y * direction[1] + n.z * direction[2] > 0) n.negate();
      const incidence = Math.max(0, n.x * sun[0] + n.y * sun[1] + n.z * sun[2]);
      if (incidence > .02 && hit.t < 18) {
        const p = hit.point.clone().addScaledVector(n, .035);
        if (!Sim.World.raycast(p.toArray(), sun, 100)) bounce += incidence * Math.exp(-hit.t / 14);
      }
    }
    const i = ((y * size[2] + z) * size[0] + x) * 4;
    pixels[i] = Math.round(sky / directions.length * 255);
    pixels[i + 1] = Math.round(Math.min(1, bounce / directions.length * 3) * 255);
    pixels[i + 3] = 255;
  }
  console.log(`Lighting slices ${y + 1}/${size[1]}`);
}
const data = { version: 1, origin, step, size, sun, sourcePositionSHA256: meta.positionSHA256, sourceIndexSHA256: meta.indexSHA256, sourceRepairSHA256: meta.surfaceRepairs.positionSHA256, pixels: Buffer.from(pixels).toString('base64') };
const bytes = zlib.gzipSync(JSON.stringify(data), { level: 9 });
fs.writeFileSync('public/maps/dust2-lighting.json.gz', bytes);
meta.files = meta.files.filter(file => file.name !== 'dust2-lighting.json.gz');
meta.files.push({ name: 'dust2-lighting.json.gz', bytes: bytes.length, raw: bytes.readUInt32LE(bytes.length - 4), sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
fs.writeFileSync('public/maps/dust2.json', JSON.stringify(meta) + '\n');
console.log('Lighting transfer bytes', bytes.length, 'sha256', crypto.createHash('sha256').update(bytes).digest('hex'));
