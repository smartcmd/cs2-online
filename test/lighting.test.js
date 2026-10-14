'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib');
const Lighting=require('../public/lighting'),meta=require('../public/maps/dust2.json');
const field=JSON.parse(zlib.gunzipSync(fs.readFileSync('public/maps/dust2-lighting.json.gz')));field.pixels=Uint8Array.from(Buffer.from(field.pixels,'base64'));
test('baked lighting matches current geometry and decodes into complete volume slices',()=>{
 Lighting.validate(field,meta);assert.equal(field.pixels.length,field.size.reduce((a,b)=>a*b)*4);
 assert.throws(()=>Lighting.validate({...field,sourcePositionSHA256:'stale'},meta),/地图版本/);
 assert.ok(meta.files.find(f=>f.name==='dust2-lighting.json.gz').bytes<40000);
});
test('irradiance varies with height under a roof and samples remain continuous across cells',()=>{
 const room=Lighting.sample(field,[8,-1,-57]),sky=Lighting.sample(field,[8,16,-57]);assert.ok(sky[0]>room[0]+.3);
 for(const point of [[8,-1,-57],[40,3,-25],[-43,2,-40]]){
  const a=Lighting.sample(field,point),b=Lighting.sample(field,[point[0]+.001,point[1],point[2]]);assert.ok(a.every(v=>v>=0&&v<=1));assert.ok(Math.abs(a[0]-b[0])<.005);
 }
});
