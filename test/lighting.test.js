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

test('static sky is seamless in direction space and keeps its six faces within the download budget',()=>{
 const sky=require('../scripts/build-sky.cjs'),a=sky.sample(sky.direction(0,-1,.4)),b=sky.sample(sky.direction(4,1,.4));assert.deepEqual(a,b);
 assert.deepEqual(sky.sample([1,2,3]),sky.sample([2,4,6]));assert.ok(sky.sample(Lighting.sunDirection).every(v=>v>245));
 assert.equal(meta.sky.files.length,6);let bytes=0;for(const name of meta.sky.files){const f=meta.files.find(f=>f.name===name);assert.ok(f&&f.kind==='sky');bytes+=f.bytes;}assert.ok(bytes<65536);
});
test('viewmodel world orientation preserves its screen pose and uses its own reflection intensity',()=>{
 const T=require('three'),material=new T.MeshStandardMaterial({aoMap:new T.Texture()}),materials=new Set();Lighting.viewMaterial(material,materials);assert.ok(materials.has(material));assert.equal(material.envMapIntensity,Lighting.look.viewReflection);assert.equal(material.aoMapIntensity,1.15);
 const camera=new T.PerspectiveCamera(68,16/9,.01,10),rig=new T.Group(),point=new T.Vector3(.2,-.1,-.5),expected=point.clone().project(camera);
 for(const yaw of [-2,-.3,0,1.5]){const q=new T.Quaternion().setFromEuler(new T.Euler(.4,yaw,0,'YXZ'));Lighting.orientView(q,camera,rig);camera.updateMatrixWorld();rig.updateMatrixWorld();assert.ok(point.clone().applyMatrix4(rig.matrixWorld).project(camera).distanceTo(expected)<1e-10);assert.ok(rig.quaternion.equals(q));}
});
test('viewmodel ambient key follows the spatial light gradient with a stable finite direction',()=>{
 for(const point of [[8,-1,-57],[-18,5.5,22],[40,3,-25]]){const p=Lighting.viewProbe(field,point);assert.ok(p.direction.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...p.direction)-1)<1e-10);assert.ok(p.direction[1]>0);assert.deepEqual(p.light,Lighting.sample(field,point));}
});

test('sky diffuse coefficients are finite and glossy map surfaces retain the full reflection sampler',()=>{
 const T=require('three'),coefficients=new Float32Array(meta.sky.diffuse.flat());assert.equal(coefficients.length,15);assert.ok(coefficients.every(Number.isFinite));
 for(const rough of [false,true]){const shader={uniforms:{},fragmentShader:'#include <envmap_physical_pars_fragment>'};Lighting.mapEnvironment(T,shader,coefficients,rough);assert.equal(shader.uniforms.skyDiffuse.value,coefficients);assert.match(shader.fragmentShader,/textureCubeUV/);assert.equal(shader.fragmentShader.includes('if(roughness>=.85)'),rough);assert.ok(!shader.fragmentShader.includes('#include <envmap_physical_pars_fragment>'));}
});
