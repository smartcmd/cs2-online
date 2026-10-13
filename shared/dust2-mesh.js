// Compact map geometry is shared by rendering, movement and bullet collision.
(function (root) {
'use strict';
const node = typeof module !== 'undefined' && module.exports;
const THREE = node ? require('three') : root.THREE;
function geometry(buffer, meta) {
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== 0x44324d33) throw new Error('Unsupported Dust II mesh');
  const vertices = view.getUint32(4, true), count = view.getUint32(8, true);
  if (buffer.byteLength < 12 + vertices * 7 + count) throw new Error('Incomplete Dust II mesh');
  const positions = new Float32Array(vertices * 3), colors = new Uint8Array(vertices * 3), indices = new Uint32Array(count);
  const linear = meta.palette.map(rgb => new THREE.Color(...rgb.map(v => v / 255)).convertSRGBToLinear().toArray().map(v => Math.round(v * 255)));
  let offset = 12;
  for (let axis = 0; axis < 3; axis++) {
    let previous = 0;
    for (let i = 0; i < vertices; i++) { previous += view.getInt16(offset, true); offset += 2; positions[i * 3 + axis] = previous * meta.precision; }
  }
  for (let i = 0; i < vertices; i++) colors.set(linear[view.getUint8(offset++)], i * 3);
  let previousIndex = 0;
  for (let i = 0; i < count; i++) {
    let encoded = 0, shift = 0, byte;
    do { if (shift > 28) throw new Error('Invalid mesh index'); byte = view.getUint8(offset++); encoded |= (byte & 127) << shift; shift += 7; } while (byte & 128);
    previousIndex += (encoded >>> 1) ^ -(encoded & 1);
    if (previousIndex < 0 || previousIndex >= vertices) throw new Error('Mesh index out of range');
    indices[i] = previousIndex;
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  result.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
  result.setIndex(new THREE.BufferAttribute(indices, 1));
  for (const group of meta.groups) result.addGroup(group.start, group.count, group.materialIndex);
  result.computeVertexNormals(); result.computeBoundingSphere(); return result;
}
if (node) module.exports = { geometry }; else root.Dust2Mesh = { geometry };
})(typeof window !== 'undefined' ? window : globalThis);
