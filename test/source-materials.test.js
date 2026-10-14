'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),zlib=require('node:zlib'),THREE=require('three');
const meta=require('../public/maps/dust2.json'),manifest=require('../public/maps/dust2-source-materials.json'),source=require('../public/source-materials');
const read=name=>fs.readFileSync(require.resolve('../public/maps/'+name));
const unpack=name=>{const b=zlib.gunzipSync(read(name));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const hash=array=>crypto.createHash('sha256').update(Buffer.from(array.buffer,array.byteOffset,array.byteLength)).digest('hex');
let fixture;
function data(){if(!fixture){const geometry=require('../shared/dust2-mesh').geometry(unpack('dust2.mesh.gz'),meta,null,true);fixture={geometry,decoded:source.decode(unpack('dust2-source-surfaces.gz'),geometry,manifest)};}return fixture;}
test('source surface attributes round-trip exactly and gameplay geometry remains the established map',()=>{
 const {geometry:g,decoded:d}=data();
 assert.equal(meta.sourceTriangles,4542407);assert.equal(meta.positionSHA256,'0f352286f9a412bcee9a6b9e8f787ea625f1d8692b1dd608d9e2d28a464a784f');
 assert.equal(meta.indexSHA256,'47d347be36aed61acf7ede883dc64a0be05e73ebf4849682fd94149a3b08caf4');
 assert.equal(hash(g.attributes.position.array.subarray(0,meta.vertices*3)),meta.positionSHA256);assert.equal(hash(g.index.array.subarray(0,meta.sourceTriangles*3)),meta.indexSHA256);
 assert.equal(hash(d.uv.subarray(0,meta.vertices*2)),manifest.uvSHA256);assert.equal(hash(d.normal.subarray(0,meta.vertices*3)),manifest.normalSHA256);assert.equal(hash(d.color.subarray(0,meta.vertices*3)),manifest.colorSHA256);
 assert.equal(hash(new Uint8Array(unpack('dust2-opacity.gz'))),'dfea8f4a8d9955bb81a7be0c5fb68010ea8d2a0079b22ff0c9f00df95d76c56f');
 for(const group of meta.groups)if(meta.materials[group.materialIndex].mask>=0){const a=group.firstVertex*2,b=(group.firstVertex+group.vertices)*2;assert.equal(hash(d.uv.subarray(a,b)),hash(g.attributes.uv.array.subarray(a,b)));}
});
test('render material ranges preserve all indices, cutout flags and source repair faces',()=>{
 const {geometry:g,decoded:d}=data(),before=hash(g.attributes.uv.array),r=source.layout(THREE,g,d,manifest);
 assert.equal(r.geometry.index.count,g.index.count);
 const ordered=r.sourceRanges.slice().sort((a,b)=>a.source-b.source);let next=0;
 for(const range of ordered){assert.equal(range.source,next);assert.equal(hash(r.geometry.index.array.subarray(range.target,range.target+range.count)),hash(g.index.array.subarray(range.source,range.source+range.count)));next+=range.count;}assert.equal(next,g.index.count);assert.equal(r.geometry.attributes.position,g.attributes.position);assert.equal(hash(g.attributes.uv.array),before);
 assert.equal(r.geometry.attributes.uv.array,d.uv);assert.equal(r.geometry.attributes.normal.array,d.normal);
 let end=0;for(const range of r.geometry.userData.dust2.meta.groups){assert.equal(range.start,end);end+=range.count;const recipe=r.recipes[range.materialIndex],flags=meta.materials[recipe.surface];assert.ok(flags);if(recipe.source>=0)assert.ok(manifest.materials[recipe.source]);}
 assert.equal(end,g.index.count);assert.equal(end,4542407*3+330);
});
test('source textures use tiered resolutions and explicit colour/normal/ORM conventions',()=>{
 const levels=new Set();for(const texture of Object.values(manifest.textures)){levels.add(Math.max(texture.width,texture.height));if(texture.kind!=='color')assert.ok(texture.width<=256&&texture.height<=256);}
 for(const size of [256,512,1024])assert.ok(levels.has(size));
 assert.match(manifest.policy.colorSpace,/sRGB.*linear.*\+Y.*G roughness B metalness/);
 for(const m of manifest.materials){assert.ok(m.metalnessMean>=0&&m.metalnessMean<=1);assert.ok(m.roughnessMean>=0&&m.roughnessMean<=1);}
 assert.ok(manifest.materials.some(m=>m.names.includes('dust_windows_01')));
});
test('both material packages include mappings and fit the 50 MiB target without counting unused legacy surfaces',()=>{
 const shared=meta.files.filter(f=>!f.kind||f.kind==='mapping'||f.kind==='sky').reduce((n,f)=>n+f.bytes,0),runtime=zlib.gzipSync(fs.readFileSync(require.resolve('../public/source-materials.js'))).length;
 for(const variant of Object.values(manifest.variants))assert.ok(shared+variant.textures+runtime<50*1048576);
 assert.ok(!meta.files.some(f=>['surface-atlas.webp','dust2-details.gz'].includes(f.name)));
});

test('texture arrays reuse every gameplay index and preserve per-triangle source material IDs',()=>{
 const {geometry:g,decoded:d}=data(),arrays=require('../public/source-material-arrays'),render=arrays.layout(THREE,g,d,manifest);
 assert.equal(render.index,g.index);assert.equal(render.attributes.position,g.attributes.position);assert.equal(render.userData.dust2,g.userData.dust2);
 assert.equal(render.attributes.uv.array,d.uv);assert.equal(render.attributes.normal.array,d.normal);
 const ids=render.attributes.sourceMaterial.array,indices=g.index.array;
 for(let i=0;i<indices.length;i+=3){assert.equal(ids[indices[i]],ids[indices[i+1]]);assert.equal(ids[indices[i]],ids[indices[i+2]]);}
 let windVertices=0;for(let i=0;i<meta.vertices;i++){const m=manifest.materials[ids[i]];if(m.vertexColor===false){windVertices++;for(let c=0;c<3;c++)assert.equal(render.attributes.color.array[i*3+c],Math.fround(m.color[c]));}}assert.ok(windVertices>1000);
 for(let i=meta.vertices;i<ids.length;i++)assert.equal(ids[i],manifest.materials.length);
 const sizes=[[256,256],[512,512],[512,256],[1024,1024],[1024,512]],layers=sizes.map(()=>new Set());
 for(const m of manifest.materials)for(const ref of [m.albedo,m.normal,m.orm].filter(Boolean)){
  assert.equal(ref.wrapS,10497);assert.equal(ref.wrapT,10497);
  const t=manifest.textures[ref.key];if(t.kind!=='color')continue;
  const b=arrays.colorBucket(t.width,t.height),[w,h]=sizes[b.group];layers[b.group].add(t.file);
  assert.equal(w%(b.rotate?t.height:t.width),0);assert.equal(h%(b.rotate?t.width:t.height),0);
 }
 for(const layer of layers)assert.ok(layer.size+1<=256,'WebGL 2 minimum array layer limit');
});

test('packed albedo halves storage with bounded error and ignores the separate opacity channel',()=>{
 const {pack565}=require('../public/source-material-arrays'),rgba=new Uint8Array(256*4);
 for(let n=0;n<256;n++)rgba.set([n,255-n,n,n],n*4);
 const packed=pack565(rgba);assert.equal(packed.byteLength,rgba.byteLength/2);
 for(let n=0;n<256;n++){const v=packed[n];assert.ok(Math.abs((v>>11)*255/31-n)<=255/62);assert.ok(Math.abs(((v>>5)&63)*255/63-(255-n))<=255/126);assert.ok(Math.abs((v&31)*255/31-n)<=255/62);}
 const transparent=rgba.slice();for(let i=3;i<transparent.length;i+=4)transparent[i]=0;assert.deepEqual(pack565(transparent),packed);
});
