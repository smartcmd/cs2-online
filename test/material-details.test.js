'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib'),crypto=require('node:crypto');
const THREE=require('three'),details=require('../public/material-details'),{detailStyle}=require('../scripts/dust2-detail-styles.cjs');
const meta=require('../public/maps/dust2.json');
const unpack=name=>{const b=zlib.gunzipSync(fs.readFileSync(require.resolve('../public/maps/'+name)));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const hash=a=>crypto.createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
test('detail materials preserve geometry, colours, and every gameplay opacity UV',()=>{
 const geometry=require('../shared/dust2-mesh').geometry(unpack('dust2.mesh.gz'),meta,null,true);
 const fixed=[geometry.index.array,...['position','normal','color','surface'].map(k=>geometry.attributes[k].array)],before=fixed.map(hash);
 const opacityUv=()=>{const h=crypto.createHash('sha256');for(const g of meta.groups)if(meta.materials[g.materialIndex].mask>=0)h.update(Buffer.from(geometry.attributes.uv.array.buffer,g.firstVertex*8,g.vertices*8));return h.digest('hex');};
 const oldOpacity=opacityUv();details.apply(THREE,geometry,unpack('dust2-details.gz'),meta);
 assert.deepEqual(fixed.map(hash),before);assert.equal(opacityUv(),oldOpacity);
 const counts=new Map();for(let i=0;i<meta.vertices;i++){const style=geometry.attributes.detailStyle.getX(i);if(style){counts.set(style,(counts.get(style)||0)+1);assert.equal(meta.materials[geometry.attributes.surface.getX(i)].type,6);}}
 assert.deepEqual([...counts.keys()].sort(),[1,2,3,4,5,6,7]);
 const ids=geometry.index.array,styles=geometry.attributes.detailStyle.array;
 for(let i=0;i<ids.length;i+=3)assert.ok(styles[ids[i]]===styles[ids[i+1]]&&styles[ids[i]]===styles[ids[i+2]],'styles must remain constant across each source triangle');
 assert.equal(counts.get(1),58999);assert.equal(counts.get(2),1208);assert.equal(counts.get(3),69215);
 assert.throws(()=>details.apply(THREE,geometry,unpack('dust2-details.gz'),{...meta,vertices:meta.vertices-1}),/Invalid/);
});
test('appearance classification distinguishes window panes, bars, plaster surrounds, and fabric',()=>{
 assert.equal(detailStyle('dust_windows_01'),1);assert.equal(detailStyle('dust_windows_low'),2);assert.equal(detailStyle('dust_kasbah_windows_01'),3);
 assert.equal(detailStyle('dust_window_bars_metal_01_alpha'),4);assert.equal(detailStyle('dust_kasbah_window_insets_01'),5);assert.equal(detailStyle('dust_window_frame_wood_01'),6);
 assert.equal(detailStyle('dust_awning_fabric_01'),7);assert.equal(detailStyle('dust_awning_fabric_frame_01'),4);assert.equal(detailStyle('hr_dust_overlay_sign_01'),0);
});
test('detail shaders sample colour only and keep explicit gradients on wrapped UVs',()=>{
 const shader=details.fragment(true);assert.ok(shader.includes('textureGrad('));assert.ok(shader.includes('dFdx(vDetailUv)'));
 assert.doesNotMatch(shader,/discard|diffuseColor\.a\s*=|gl_FragDepth/);
 assert.ok(!details.fragment(false).includes('textureGrad('));
});
test('legacy procedural mapping retains identical opacity pixels',()=>{
 const opacity=new Uint8Array(unpack('dust2-opacity.gz'));
 assert.equal(hash(opacity),'dfea8f4a8d9955bb81a7be0c5fb68010ea8d2a0079b22ff0c9f00df95d76c56f');
 const materialCode=zlib.gzipSync(fs.readFileSync(require.resolve('../public/material-details.js'))).length;
 assert.ok(materialCode<10000);
 assert.ok(meta.files.some(f=>f.name==='dust2-radar.webp'));
});
