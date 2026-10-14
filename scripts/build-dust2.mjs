// Lossless packaging of source geometry with independent compressed surface resources.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { gzipAsync } from '@gfx/zopfli';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import sharp from 'sharp';
import detailStyles from './dust2-detail-styles.cjs';
import {buildSourceMaterials} from './build-source-materials.mjs';
import skyBuilder from './build-sky.cjs';
import { MeshoptDecoder } from 'meshoptimizer';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = root + '.cache/dust2/assets/map-cs2/';
const output = root + 'public/maps/';
const gltf = JSON.parse(await fs.readFile(source + 'dust2-web.gltf'));
await MeshoptDecoder.ready;
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
const transforms = [], transformIds = new Map();
const descriptors = [], descriptorIds = new Map(), batches = new Map(), masks = [], maskIds = new Map();

for (const m of gltf.materials) {
  const textureInfo = m.pbrMetallicRoughness?.baseColorTexture;
  const texture = gltf.textures?.[textureInfo?.index];
  const image = texture?.extensions?.EXT_texture_webp?.source ?? texture?.source;
  if (!['MASK', 'BLEND'].includes(m.alphaMode) || image === undefined || maskIds.has(image)) continue;
  const alpha = await sharp(source + gltf.images[image].uri).ensureAlpha().extractChannel(3).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
  maskIds.set(image, masks.length); masks.push({ pixels: alpha.data, width: alpha.info.width, height: alpha.info.height });
}
function descriptor(material) {
  const m = gltf.materials[material], vmat = m.extras?.vmat || {}, flags = vmat.IntParams || {};
  const texture = gltf.textures?.[m.pbrMetallicRoughness?.baseColorTexture?.index];
  const image = texture?.extensions?.EXT_texture_webp?.source ?? texture?.source;
  const overlay = m.alphaMode === 'BLEND' || !!flags.F_OVERLAY || vmat.ShaderName === 'csgo_static_overlay.vfx';
  const visible = !flags.F_DEPTH_FEATHER && !/materials\/tools\//.test(vmat.Name || '');
  const sampler = gltf.samplers?.[texture?.sampler] || {};
  const depthLayer = overlay ? 4 : flags.F_DEPTH_BIAS ? 3 : flags.F_DECAL_TEXTURE ? (materialTypes[material] === 1 ? 2 : 1) : 0;
  const value = { depthLayer, wrapS: sampler.wrapS || 10497, wrapT: sampler.wrapT || 10497, type: materialTypes[material], mask: ['MASK', 'BLEND'].includes(m.alphaMode) ? (maskIds.get(image) ?? -1) : -1, cutoff: m.alphaCutoff ?? .5, doubleSided: !!m.doubleSided, overlay, bias: depthLayer > 0, visible, collidable: visible && !overlay && materialTypes[material] !== 4 };
  const key = JSON.stringify(value);
  if (!descriptorIds.has(key)) { descriptorIds.set(key, descriptors.length); descriptors.push(value); }
  return descriptorIds.get(key);
}
let sourceTriangles = 0;
function addPrimitive(matrix, primitive) {
  if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error('Unexpected non-triangle map primitive');
  const material = descriptor(primitive.material), surface = descriptors[material], m = gltf.materials[primitive.material];
  const accessor = gltf.accessors[primitive.attributes.POSITION];
  if (accessor.componentType !== 5122) throw new Error('Preserve unsupported source position encoding before building this map');
  const raw = views[accessor.bufferView], rawView = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), stride = gltf.bufferViews[accessor.bufferView].byteStride || 6;
  const transform = { matrix: matrix.toArray(), normalized: !!accessor.normalized }, transformKey = JSON.stringify(transform);
  if (!transformIds.has(transformKey)) { transformIds.set(transformKey, transforms.length); transforms.push(transform); }
  const transformId = transformIds.get(transformKey);
  const pos = attribute(primitive.attributes.POSITION), world = new Float32Array(pos.length), point = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) { point.fromArray(pos, i).applyMatrix4(matrix); point.toArray(world, i); }
  const ids = primitive.indices === undefined ? null : attribute(primitive.indices);
  const uvInfo = m.pbrMetallicRoughness?.baseColorTexture;
  const uvTransform = uvInfo?.extensions?.KHR_texture_transform || {};
  const uv = surface.mask < 0 ? null : attribute(primitive.attributes['TEXCOORD_' + (uvTransform.texCoord ?? uvInfo.texCoord ?? 0)]);
  const detailStyle = detailStyles.detailStyle(m.name || ''), detailUv = detailStyle >= 1 && detailStyle <= 3 ? attribute(primitive.attributes['TEXCOORD_' + (uvTransform.texCoord ?? uvInfo?.texCoord ?? 0)]) : null;
  const sourceUv=primitive.attributes.TEXCOORD_0===undefined?null:attribute(primitive.attributes.TEXCOORD_0), sourceNormal=attribute(primitive.attributes.NORMAL), sourceColor=primitive.attributes.COLOR_0===undefined?null:attribute(primitive.attributes.COLOR_0);
  const na=gltf.accessors[primitive.attributes.NORMAL];if(na.componentType!==5120||!na.normalized)throw Error('Preserve unsupported source normal encoding');
  const nb=views[na.bufferView],nv=new DataView(nb.buffer,nb.byteOffset,nb.byteLength),ns=gltf.bufferViews[na.bufferView].byteStride||3;
  const colorWidth=sourceColor?sourceColor.length/(pos.length/3):3,normalMatrix=new THREE.Matrix3().getNormalMatrix(matrix),normalVector=new THREE.Vector3();
  const localMaps = new Map(), mirrored = matrix.determinant() < 0;
  const count = ids ? ids.length : pos.length / 3;
  for (let i = 0; i < count; i += 3) {
    const face = [ids ? ids[i] : i, ids ? ids[i + 1] : i + 1, ids ? ids[i + 2] : i + 2];
    if (mirrored) [face[1], face[2]] = [face[2], face[1]];
    const cx = Math.floor((world[face[0]*3] + world[face[1]*3] + world[face[2]*3]) / 48), cz = Math.floor((world[face[0]*3+2] + world[face[1]*3+2] + world[face[2]*3+2]) / 48);
    const key = `${cx},${cz}:${material}`;
    if (!batches.has(key)) batches.set(key, { chunk: `${cx},${cz}`, material, positions: [], codes: [], transforms: [], colors: [], uvs: [], indices: [], detailRuns: [], detailUvs: [], sourceIds: [], sourceUvs: [], sourceNormals: [], sourceColors: [], sourceNormalCodes: [], sourceNormalIds: [] });
    const batch = batches.get(key);
    if (!localMaps.has(key)) localMaps.set(key, new Map());
    const remap = localMaps.get(key);
    for (const old of face) {
      if (!remap.has(old)) {
        if (detailStyle) {
          let run = batch.detailRuns.at(-1);
          if (!run || run[0] + run[1] !== batch.colors.length || run[2] !== detailStyle) { run = [batch.colors.length, 0, detailStyle]; batch.detailRuns.push(run); }
          run[1]++;
          if (detailUv) {
            const x = detailUv[old*2] * (uvTransform.scale?.[0] ?? 1), y = detailUv[old*2+1] * (uvTransform.scale?.[1] ?? 1), angle = uvTransform.rotation || 0;
            batch.detailUvs.push(Math.cos(angle)*x-Math.sin(angle)*y+(uvTransform.offset?.[0] || 0),Math.sin(angle)*x+Math.cos(angle)*y+(uvTransform.offset?.[1] || 0));
          }
        }
        batch.sourceIds.push(primitive.material);
        for(let axis=0;axis<3;axis++)batch.sourceNormalCodes.push(nv.getInt8((na.byteOffset||0)+old*ns+axis));batch.sourceNormalIds.push(transformId);
        batch.sourceUvs.push(sourceUv?sourceUv[old*2]:0,sourceUv?sourceUv[old*2+1]:0);
        normalVector.fromArray(sourceNormal,old*3).applyNormalMatrix(normalMatrix);batch.sourceNormals.push(normalVector.x,normalVector.y,normalVector.z);
        batch.sourceColors.push(...(sourceColor?Array.from(sourceColor.subarray(old*colorWidth,old*colorWidth+3)):[1,1,1]));
        remap.set(old, batch.colors.length);
        batch.positions.push(world[old*3], world[old*3+1], world[old*3+2]);
        for(let axis=0;axis<3;axis++)batch.codes.push(rawView.getInt16((accessor.byteOffset || 0)+old*stride+axis*2,true));
        batch.transforms.push(transformId);
        let color = materialColors[primitive.material] - 1;
        if (surface.type === 4) color = /dry|dead/.test(m.name) ? 17 : 18;
        if (surface.type === 2 && color >= 5 && color <= 11) color = /door/.test(m.name) ? 4 : 3;
        batch.colors.push(color);
        if (uv) {
          const x = uv[old*2] * (uvTransform.scale?.[0] ?? 1), y = uv[old*2+1] * (uvTransform.scale?.[1] ?? 1), angle = uvTransform.rotation || 0;
          batch.uvs.push(Math.cos(angle)*x - Math.sin(angle)*y + (uvTransform.offset?.[0] || 0), Math.sin(angle)*x + Math.cos(angle)*y + (uvTransform.offset?.[1] || 0));
        }
      }
      batch.indices.push(remap.get(old));
    }
    sourceTriangles++;
  }
}
function visit(index, parent) {
  const node = gltf.nodes[index], matrix = new THREE.Matrix4();
  if (node.matrix) matrix.fromArray(node.matrix);
  else matrix.compose(new THREE.Vector3().fromArray(node.translation || [0,0,0]), new THREE.Quaternion().fromArray(node.rotation || [0,0,0,1]), new THREE.Vector3().fromArray(node.scale || [1,1,1]));
  matrix.premultiply(parent);
  if (node.mesh !== undefined) for (const primitive of gltf.meshes[node.mesh].primitives) addPrimitive(matrix, primitive);
  for (const child of node.children || []) visit(child, matrix);
}
console.time('Lossless map packaging');
for (const index of gltf.scenes[gltf.scene || 0].nodes) visit(index, new THREE.Matrix4().makeRotationY(Math.PI/2));
const ordered = [...batches.values()].sort((a,b) => a.chunk.localeCompare(b.chunk) || a.material-b.material);
const vertices = ordered.reduce((n,b) => n+b.colors.length,0), indexCount = ordered.reduce((n,b) => n+b.indices.length,0), uvCount = ordered.reduce((n,b) => n+b.uvs.length/2,0);
const codes = new Int16Array(vertices*3), matrixIds = new Uint16Array(vertices);
const positions = new Float32Array(vertices*3), indices = new Uint32Array(indexCount), uvs = new Float32Array(uvCount*2), colors = new Uint8Array(vertices), groups = [];
const detailRuns = [], detailUvs = [];
const sourceNormalCodes=new Int8Array(vertices*3),sourceNormalIds=new Uint16Array(vertices);
const sourceIds=new Uint16Array(vertices),sourceUvs=new Float32Array(vertices*2),sourceNormals=new Float32Array(vertices*3),sourceColors=new Float32Array(vertices*3);
let v = 0, ix = 0, uvOffset = 0;
for (const batch of ordered) {
  groups.push({ start: ix, count: batch.indices.length, materialIndex: batch.material, chunk: batch.chunk, firstVertex: v, vertices: batch.colors.length, uvOffset: batch.uvs.length ? uvOffset : -1 });
  for (const [first,count,style] of batch.detailRuns) detailRuns.push(first+v,count,style);
  for (const uv of batch.detailUvs) detailUvs.push(uv);
  sourceNormalCodes.set(batch.sourceNormalCodes,v*3);sourceNormalIds.set(batch.sourceNormalIds,v);
  sourceIds.set(batch.sourceIds,v);sourceUvs.set(batch.sourceUvs,v*2);sourceNormals.set(batch.sourceNormals,v*3);sourceColors.set(batch.sourceColors,v*3);
  codes.set(batch.codes,v*3); matrixIds.set(batch.transforms,v);
  positions.set(batch.positions,v*3); colors.set(batch.colors,v); uvs.set(batch.uvs,uvOffset*2);
  for(let i=0;i<batch.indices.length;i++)indices[ix+i]=batch.indices[i]+v;
  v+=batch.colors.length; ix+=batch.indices.length; uvOffset+=batch.uvs.length/2;
}
// Byte-plane XOR coding changes storage only; every Float32 coordinate round-trips bit-for-bit.
function floatBytes(values, components) {
  const bits = new Uint32Array(values.buffer), count=values.length/components, output=Buffer.alloc(values.byteLength);
  for(let axis=0;axis<components;axis++) {
    let previous=0;
    for(let i=0;i<count;i++) { const current=bits[i*components+axis], delta=current^previous; previous=current; for(let byte=0;byte<4;byte++)output[(axis*4+byte)*count+i]=(delta>>>(byte*8))&255; }
  }
  return output;
}
function shortBytes(values, components) {
  const bits=new Uint16Array(values.buffer),count=values.length/components,out=Buffer.alloc(values.byteLength);
  for(let axis=0;axis<components;axis++){let last=0;for(let i=0;i<count;i++){const value=bits[i*components+axis],delta=value^last;last=value;out[(axis*2)*count+i]=delta&255;out[(axis*2+1)*count+i]=delta>>>8;}}return out;
}
const indexBytes=[]; let last=0;
for(const value of indices) { const delta=value-last; last=value; let encoded=((delta<<1)^(delta>>31))>>>0; do { indexBytes.push((encoded&127)|(encoded>=128?128:0)); encoded>>>=7; }while(encoded); }
const header=Buffer.alloc(16);header.write('D2L1');header.writeUInt32LE(vertices,4);header.writeUInt32LE(indexCount,8);header.writeUInt32LE(uvCount,12);
await fs.mkdir(output,{recursive:true});
await fs.writeFile(output+'dust2.mesh.gz',gzipSync(Buffer.concat([header,shortBytes(codes,3),shortBytes(matrixIds,1),colors,floatBytes(uvs,2),Buffer.from(indexBytes)]),{level:9}));
let maskOffset=0;const maskTiles=masks.map(mask=>{const tile={offset:maskOffset,width:mask.width,height:mask.height};maskOffset+=mask.pixels.length;return tile;});
const opacityPixels=Buffer.concat(masks.map(m=>m.pixels)),opacityHash=createHash('sha256').update(opacityPixels).digest('hex');
const opacityCache=root+'.cache/dust2/opacity-'+opacityHash+'.gz';
let packedOpacity;
try { const cached=await fs.readFile(opacityCache);if(gunzipSync(cached).equals(opacityPixels))packedOpacity=cached; } catch {}
if(!packedOpacity){
  packedOpacity=Buffer.from(await gzipAsync(opacityPixels,{numiterations:3}));
  if(!gunzipSync(packedOpacity).equals(opacityPixels))throw Error('Opacity compression changed source pixels');
  await fs.writeFile(opacityCache,packedOpacity);
}
await fs.writeFile(output+'dust2-opacity.gz',packedOpacity);
await sharp(root+'.cache/dust2/assets/valve-dust2/de_dust2_radar_psd.png').resize(512,512).webp({quality:65}).toFile(output+'dust2-radar.webp');
const detailValues=new Float32Array(detailUvs),detailBits=new Uint32Array(detailValues.buffer),uvIds=new Map(),uvTable=[],uvRefs=new Uint16Array(detailUvs.length/2);
for(let i=0;i<uvRefs.length;i++){
  const key=detailBits[i*2]+':'+detailBits[i*2+1];
  if(!uvIds.has(key)){uvIds.set(key,uvIds.size);uvTable.push(detailValues[i*2],detailValues[i*2+1]);}
  uvRefs[i]=uvIds.get(key);
}
if(uvIds.size>65535)throw Error('Detail UV dictionary exceeds uint16');
const detailHeader=Buffer.alloc(20);detailHeader.write('D2T1');detailHeader.writeUInt32LE(vertices,4);detailHeader.writeUInt32LE(detailRuns.length/3,8);detailHeader.writeUInt32LE(uvRefs.length,12);detailHeader.writeUInt32LE(uvIds.size,16);
await fs.writeFile(output+'dust2-details.gz',gzipSync(Buffer.concat([detailHeader,Buffer.from(new Uint32Array(detailRuns).buffer),floatBytes(new Float32Array(uvTable),2),Buffer.from(uvRefs.buffer)]),{level:9}));
const files=[];for(const name of ['dust2-details.gz','dust2.mesh.gz','dust2-opacity.gz','dust2-radar.webp','surface-atlas.webp']){const content=await fs.readFile(output+name);files.push({name,bytes:content.length,...(name.endsWith('.gz')?{raw:content.readUInt32LE(content.length-4)}:{}),sha256:createHash('sha256').update(content).digest('hex')});}
const meta={name:'Dust II',format:'D2L1',positionEncoding:'source-accessors-lossless',transforms,palette,groups,materials:descriptors,opacity:{tiles:maskTiles,count:masks.length,decodedSHA256:opacityHash},vertices,triangles:indexCount/3,sourceTriangles,positionSHA256:createHash('sha256').update(new Uint8Array(positions.buffer)).digest('hex'),indexSHA256:createHash('sha256').update(new Uint8Array(indices.buffer)).digest('hex'),files};
const repairConfig=JSON.parse(await fs.readFile(root+'config/dust2-surface-repairs.json'));
const collisionBytes=await fs.readFile(root+'.cache/dust2/'+repairConfig.source.path);
if(collisionBytes.length!==repairConfig.source.bytes||createHash('sha256').update(collisionBytes).digest('hex')!==repairConfig.source.sha256)throw Error('Reference collision mesh checksum mismatch');
const collisionPositions=JSON.parse(collisionBytes).positions;
const repairPositions=repairConfig.triangles.flatMap(index=>{
  const face=collisionPositions.slice(index*9,index*9+9);
  if(face.length!==9||!face.every(Number.isFinite))throw Error('Invalid source repair triangle');
  return face;
});
meta.surfaceRepairs={source:repairConfig.source,sourceTriangles:repairConfig.triangles,positions:repairPositions,paletteIndex:6,materialIndex:descriptors.findIndex(m=>m.type===1&&m.visible&&m.collidable&&m.mask<0&&!m.bias),positionSHA256:createHash('sha256').update(new Uint8Array(new Float32Array(repairPositions).buffer)).digest('hex')};
try { const old=JSON.parse(await fs.readFile(output+'dust2.json'));const lighting=old.files.find(f=>f.name==='dust2-lighting.json.gz');if(lighting&&old.positionSHA256===meta.positionSHA256&&old.indexSHA256===meta.indexSHA256&&old.surfaceRepairs?.positionSHA256===meta.surfaceRepairs.positionSHA256)meta.files.push(lighting); } catch {}
const sourceMaterialMeta=await buildSourceMaterials({gltf,source,output,ids:sourceIds,uvs:sourceUvs,normals:sourceNormals,colors:sourceColors,groups,floatBytes,normalCodes:sourceNormalCodes,normalIds:sourceNormalIds,geometryHashes:{position:meta.positionSHA256,index:meta.indexSHA256}});
meta.sourceMaterials={manifest:'dust2-source-materials.json'};
meta.files=meta.files.filter(file=>!['surface-atlas.webp','dust2-details.gz'].includes(file.name));
for(const file of sourceMaterialMeta.files)meta.files.push(file);
const sourceManifest=await fs.readFile(output+'dust2-source-materials.json');meta.files.push({name:'dust2-source-materials.json',bytes:sourceManifest.length,sha256:createHash('sha256').update(sourceManifest).digest('hex')});
await fs.writeFile(output+'dust2.json',JSON.stringify(meta)+'\n');
Object.assign(meta,await skyBuilder.build());
console.timeEnd('Lossless map packaging');console.log(JSON.stringify({sourceTriangles,vertices,groups:groups.length,materials:descriptors.length,files:meta.files,totalMiB:meta.files.reduce((n,f)=>n+f.bytes,0)/1048576},null,2));
