// Offline reduction of original map geometry; no source textures ship to players.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import sharp from 'sharp';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = root + '.cache/dust2/assets/map-cs2/';
const output = root + 'public/maps/';
const gltf = JSON.parse(await fs.readFile(source + 'dust2-web.gltf'));
await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const buffers = await Promise.all(gltf.buffers.map(async b => b.uri ? new Uint8Array(await fs.readFile(source + b.uri)) : null));
const views = gltf.bufferViews.map(v => {
  const ext = v.extensions?.EXT_meshopt_compression;
  if (!ext) return buffers[v.buffer].subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
  const decoded = new Uint8Array(ext.count * ext.byteStride);
  MeshoptDecoder.decodeGltfBuffer(decoded, ext.count, ext.byteStride, buffers[ext.buffer].subarray(ext.byteOffset || 0, (ext.byteOffset || 0) + ext.byteLength), ext.mode, ext.filter);
  return decoded;
});
const accessors = new Map();
function attribute(id) {
  if (accessors.has(id)) return accessors.get(id);
  const a = gltf.accessors[id], bytes = views[a.bufferView], v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const info = { 5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255], 5122: [2, 'getInt16', 32767], 5123: [2, 'getUint16', 65535], 5125: [4, 'getUint32', 4294967295], 5126: [4, 'getFloat32', 1] }[a.componentType];
  const stride = gltf.bufferViews[a.bufferView].byteStride || width * info[0];
  const result = new Float32Array(a.count * width);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < width; k++) {
    let n = v[info[1]]((a.byteOffset || 0) + i * stride + k * info[0], true);
    if (a.normalized) n = Math.max(-1, n / info[2]);
    result[i * width + k] = n;
  }
  accessors.set(id, result); return result;
}
const palette = [
  [218, 197, 160], [196, 169, 127], [173, 143, 102], [146, 117, 82], [116, 91, 66],
  [238, 221, 188], [227, 218, 199], [204, 199, 182], [163, 161, 150], [112, 116, 111],
  [65, 75, 72], [41, 52, 52], [51, 94, 107], [74, 128, 143], [116, 155, 164],
  [159, 72, 48], [193, 105, 65], [114, 125, 71], [74, 91, 55], [193, 158, 81],
];
const imageColors = await Promise.all(gltf.images.map(async image => {
  const { data } = await sharp(source + image.uri).resize(1, 1).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}));
const materialColors = gltf.materials.map(m => {
  const texture = gltf.textures?.[m.pbrMetallicRoughness?.baseColorTexture?.index];
  const image = texture?.extensions?.EXT_texture_webp?.source ?? texture?.source;
  const factor = m.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1];
  const color = (image !== undefined ? imageColors[image] : [210, 190, 152]).map((c, k) => Math.pow(Math.pow(c / 255, 2.2) * factor[k], 1 / 2.2) * 255);
  let best = 0, distance = Infinity;
  for (let i = 0; i < palette.length; i++) { const d = palette[i].reduce((sum, c, k) => sum + (c - color[k]) ** 2, 0); if (d < distance) { best = i; distance = d; } }
  return best + 1;
});

const batches = Array.from({ length: 7 }, () => ({ positions: [], colors: [], indices: [] }));
const materialTypes = gltf.materials.map(m => {
  const name = (m.name + ' ' + (m.extras?.vmat?.Name || '')).toLowerCase();
  if (/bark/.test(name)) return 2;
  if (/foliage|leaf|leaves|frond|palm.*branch|plant|grass|weed/.test(name)) return 4;
  if (/glass|window|sign|tile|fabric|cloth|tarp/.test(name)) return 6;
  if (/metal|iron|steel|pipe|barrel|car_|vehicle|vent|wire|ac_unit|cell_tower|pole|electric|satellite|chainlink|wheel|_bars/.test(name)) return 3;
  if (/wood|door|plank|crate|pallet/.test(name)) return 2;
  if (/ground|road|asphalt|pavement|sand|floor|dirt|cobble|sidewalk/.test(name)) return 5;
  if (/plaster|stucco|whitewash|paint/.test(name)) return 1;
  return 0;
});
let sourceTriangles = 0, reducedTriangles = 0;
function addPrimitive(matrix, primitive) {
  const m = gltf.materials[primitive.material], source = m?.extras?.vmat || {}, flags = source.IntParams || {};
  if (flags.F_DEPTH_FEATHER || flags.F_OVERLAY || source.ShaderName === 'csgo_static_overlay.vfx' || /materials\/tools\//.test(source.Name || '')) return;
  if (primitive.mode !== undefined && primitive.mode !== 4) return;
  const type = materialTypes[primitive.material];
  const pos = attribute(primitive.attributes.POSITION);
  const inputIndices = primitive.indices === undefined ? null : attribute(primitive.indices), world = new Float32Array(pos.length);
  const point = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) { point.fromArray(pos, i).applyMatrix4(matrix); point.toArray(world, i); }
  const indices = [], inside = i => world[i] > -80 && world[i] < 70 && world[i + 1] > -12 && world[i + 1] < 33 && world[i + 2] > -105 && world[i + 2] < 52;
  for (let i = 0, count = inputIndices ? inputIndices.length : pos.length / 3; i < count; i += 3) {
    const a = inputIndices ? inputIndices[i] : i, b = inputIndices ? inputIndices[i + 1] : i + 1, c = inputIndices ? inputIndices[i + 2] : i + 2;
    if (inside(a * 3) && inside(b * 3) && inside(c * 3)) indices.push(a, b, c);
  }
  if (!indices.length) return;
  sourceTriangles += indices.length / 3;
  const welded = [], original = [], remapped = [], weld = new Map();
  for (const old of indices) {
    const p = [world[old * 3], world[old * 3 + 1], world[old * 3 + 2]].map(v => Math.round(v * 100));
    const key = p.join(',');
    if (!weld.has(key)) { weld.set(key, welded.length / 3); welded.push(...p.map(v => v / 100)); original.push(old); }
    remapped.push(weld.get(key));
  }
  const vertices = new Float32Array(welded), scale = MeshoptSimplifier.getScale(vertices, 3);
  const [reduced] = MeshoptSimplifier.simplify(new Uint32Array(remapped), vertices, 3, Math.min(indices.length, Math.max(6, Math.floor(indices.length * .035 / 3) * 3)), Math.min(.06, (type === 2 || type === 6 ? .025 : .12) / Math.max(1, scale)), type === 2 || type === 6 ? ['LockBorder'] : []);
  const simplified = reduced.map(i => original[i]);
  reducedTriangles += simplified.length / 3;
  const batch = batches[type], remap = new Map();
  let color = materialColors[primitive.material] - 1;
  if (type === 4) color = /dry|dead/.test(m.name) ? 17 : 18;
  if (type === 2 && color >= 5 && color <= 11) color = /door/.test(m.name) ? 4 : 3;
  for (const oldIndex of simplified) {
    if (!remap.has(oldIndex)) {
      const index = batch.positions.length / 3; remap.set(oldIndex, index);
      batch.positions.push(world[oldIndex * 3], world[oldIndex * 3 + 1], world[oldIndex * 3 + 2]);
      batch.colors.push(color);
    }
    batch.indices.push(remap.get(oldIndex));
  }
}
function visit(index, parent) {
  const n = gltf.nodes[index], matrix = new THREE.Matrix4();
  if (n.matrix) matrix.fromArray(n.matrix);
  else matrix.compose(new THREE.Vector3().fromArray(n.translation || [0, 0, 0]), new THREE.Quaternion().fromArray(n.rotation || [0, 0, 0, 1]), new THREE.Vector3().fromArray(n.scale || [1, 1, 1]));
  matrix.premultiply(parent);
  if (n.mesh !== undefined) for (const p of gltf.meshes[n.mesh].primitives) addPrimitive(matrix, p);
  for (const child of n.children || []) visit(child, matrix);
}
console.time('Map reduction');
for (const index of gltf.scenes[gltf.scene || 0].nodes) visit(index, new THREE.Matrix4().makeRotationY(Math.PI / 2));
const vertices = batches.reduce((n, b) => n + b.colors.length, 0), indexCount = batches.reduce((n, b) => n + b.indices.length, 0);
const bytes = Buffer.alloc(12 + vertices * 10 + indexCount * 4);
bytes.write('D2M1'); bytes.writeUInt32LE(vertices, 4); bytes.writeUInt32LE(indexCount, 8);
let vertexOffset = 0, indexOffset = 0; const groups = [];
for (let type = 0; type < batches.length; type++) {
  const b = batches[type]; groups.push({ start: indexOffset, count: b.indices.length, materialIndex: type });
  for (let i = 0; i < b.colors.length; i++) {
    const offset = 12 + (vertexOffset + i) * 10;
    for (let axis = 0; axis < 3; axis++) {
      bytes.writeInt16LE(Math.round(b.positions[i * 3 + axis] * 100), offset + axis * 2);
    }
    bytes.writeUInt8(b.colors[i], offset + 9);
  }
  for (let i = 0; i < b.indices.length; i++) bytes.writeUInt32LE(b.indices[i] + vertexOffset, 12 + vertices * 10 + (indexOffset + i) * 4);
  vertexOffset += b.colors.length; indexOffset += b.indices.length;
}
await fs.mkdir(output, { recursive: true });
// Coordinate deltas and separate attribute streams compress repeated architecture
// without losing detail. Index deltas use zigzag varints instead of four bytes.
const streams = Buffer.alloc(12 + vertices * 7); bytes.copy(streams, 0, 0, 12); streams.write('D2M3');
let streamOffset = 12;
for (let axis = 0; axis < 3; axis++) {
  let previous = 0;
  for (let i = 0; i < vertices; i++) { const value = bytes.readInt16LE(12 + i * 10 + axis * 2); streams.writeInt16LE(value - previous, streamOffset); streamOffset += 2; previous = value; }
}
for (let i = 0; i < vertices; i++) streams[streamOffset++] = bytes[12 + i * 10 + 9];
const indexBytes = []; let previousIndex = 0;
for (let i = 0; i < indexCount; i++) {
  const value = bytes.readUInt32LE(12 + vertices * 10 + i * 4), delta = value - previousIndex; previousIndex = value;
  let encoded = ((delta << 1) ^ (delta >> 31)) >>> 0;
  do { indexBytes.push((encoded & 127) | (encoded >= 128 ? 128 : 0)); encoded >>>= 7; } while (encoded);
}
await fs.writeFile(output + 'dust2.mesh.gz', gzipSync(Buffer.concat([streams, Buffer.from(indexBytes)]), { level: 9 }));
await sharp(root + '.cache/dust2/assets/valve-dust2/de_dust2_radar_psd.png').resize(512, 512).webp({ quality: 65 }).toFile(output + 'dust2-radar.webp');
const files = [];
for (const name of ['dust2.mesh.gz', 'dust2-radar.webp', 'surface-atlas.webp']) { const content = await fs.readFile(output + name); files.push({ name, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }); }
const meta = { name: 'Dust II', format: 'D2M3', precision: .01, palette, groups, vertices, triangles: indexCount / 3, sourceTriangles, files };
await fs.writeFile(output + 'dust2.json', JSON.stringify(meta) + '\n');
console.timeEnd('Map reduction'); console.log(JSON.stringify({ sourceTriangles, reducedTriangles, vertices, files, totalMiB: files.reduce((n, f) => n + f.bytes, 0) / 1048576 }, null, 2));
