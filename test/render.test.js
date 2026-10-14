'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),zlib=require('node:zlib'),crypto=require('node:crypto');
const THREE=require('three');
const {mapMeshes,StaticSunShadow}=require('../public/render-optimizations');

test('render regions reference every exact source index once and contain all of their vertices',()=>{
 const meta=require('../public/maps/dust2.json');
 const bytes=zlib.gunzipSync(fs.readFileSync(require.resolve('../public/maps/dust2.mesh.gz')));
 const geometry=require('../shared/dust2-mesh').geometry(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),meta,null,true);
 const hash=()=>crypto.createHash('sha256').update(Buffer.from(geometry.index.array.buffer)).update(Buffer.from(geometry.attributes.position.array.buffer)).digest('hex');
 const before=hash(),materials=meta.materials.map(()=>new THREE.MeshStandardMaterial()),map=mapMeshes(THREE,geometry,materials);
 let end=0;const point=new THREE.Vector3();
 for(const mesh of map.children){
  const part=mesh.geometry,{start,count}=part.drawRange;
  assert.equal(start,end);end+=count;
  assert.equal(part.index,geometry.index);assert.equal(part.attributes.position,geometry.attributes.position);
  const sphere=part.boundingSphere.clone();sphere.radius+=.00001;
  for(let i=start;i<end;i++){point.fromBufferAttribute(part.attributes.position,part.index.getX(i));assert.ok(part.boundingBox.containsPoint(point)&&sphere.containsPoint(point));}
 }
 assert.equal(end,geometry.index.count);assert.equal(hash(),before);
});

function shadowFixture(supported=true){
 const scene=new THREE.Scene(),sun=new THREE.DirectionalLight(),staticRoot=new THREE.Group(),actor=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
 const wall=actor.clone();wall.castShadow=actor.castShadow=true;staticRoot.add(wall);scene.add(staticRoot,actor,sun,sun.target);sun.castShadow=true;
 let renders=0,disposals=0;const events={};
 const renderer={capabilities:{isWebGL2:supported},extensions:{has:()=>false},shadowMap:{enabled:true,autoUpdate:true},domElement:{addEventListener:(name,fn)=>events[name]=fn},render(){
  renders++;assert.ok(sun.castShadow,'baking must not disable the light');assert.ok(wall.castShadow);assert.equal(actor.castShadow,false);
  sun.shadow.map={texture:{},dispose(){disposals++;}};
 }};
 const cache=new StaticSunShadow(THREE,renderer,scene,sun,staticRoot),camera=new THREE.PerspectiveCamera();
 return {cache,camera,sun,wall,actor,renderer,events,renders:()=>renders,disposals:()=>disposals};
}
test('static depth is baked once while every moving caster remains eligible for real-time shadows',()=>{
 const f=shadowFixture();f.cache.prepare(f.camera);f.cache.prepare(f.camera);
 assert.equal(f.renders(),1);assert.equal(f.wall.castShadow,false);assert.ok(f.actor.castShadow);assert.ok(f.sun.castShadow);
 assert.equal(f.cache.scene.children[0],f.cache.restore);
 f.actor.position.x=3;f.cache.prepare(f.camera);assert.equal(f.renders(),1);
 f.sun.shadow.mapSize.set(1024,1024);f.cache.prepare(f.camera);assert.equal(f.renders(),2);assert.equal(f.disposals(),1);
 f.sun.position.x=4;f.cache.prepare(f.camera);assert.equal(f.renders(),3);
 f.events.webglcontextrestored();assert.equal(f.cache.cache,null);assert.ok(f.wall.castShadow);assert.equal(f.cache.restore.visible,false);
});
test('unsupported fragment depth and disabled shadows retain the ordinary renderer path',()=>{
 const f=shadowFixture(false);f.cache.prepare(f.camera);assert.equal(f.renders(),0);assert.ok(f.wall.castShadow);assert.ok(f.actor.castShadow);
 const enabled=shadowFixture();enabled.renderer.shadowMap.enabled=false;enabled.cache.prepare(enabled.camera);assert.equal(enabled.renders(),0);
});

test('box refinement skips only off-camera colour work and restores the full shadow draw range',()=>{
 const geometry=new THREE.BoxGeometry(.2,20,.2);geometry.translate(8,0,-5);
 geometry.userData.dust2={meta:{groups:[{start:0,count:geometry.index.count,chunk:'test',materialIndex:0}]}};
 const map=mapMeshes(THREE,geometry,[new THREE.MeshBasicMaterial()]),mesh=map.children[0],camera=new THREE.PerspectiveCamera(60,1,.1,100);
 camera.updateMatrixWorld();map.updateMatrixWorld();const count=mesh.geometry.drawRange.count;
 const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 assert.ok(frustum.intersectsObject(mesh),'baseline sphere admits the long region');
 mesh.onBeforeRender({},null,camera);assert.equal(mesh.geometry.drawRange.count,0);mesh.onAfterRender();assert.equal(mesh.geometry.drawRange.count,count);assert.ok(mesh.castShadow);
 camera.lookAt(8,0,-5);camera.updateMatrixWorld();mesh.onBeforeRender({},null,camera);assert.equal(mesh.geometry.drawRange.count,count);mesh.onAfterRender();
});

test('early colour culling restores all map casters before rebuilding the shadow cache',()=>{
 const g=new THREE.BoxGeometry(.2,20,.2);g.translate(8,0,-5);g.userData.dust2={meta:{groups:[{start:0,count:g.index.count,chunk:'edge',materialIndex:0}]}};
 const map=mapMeshes(THREE,g,[new THREE.MeshStandardMaterial()]),camera=new THREE.PerspectiveCamera(60,1,.1,100);map.updateMatrixWorld();camera.updateMatrixWorld();
 const mesh=map.children[0];map.userData.prepareColor(camera);assert.equal(mesh.visible,false);assert.equal(mesh.castShadow,true);
 map.userData.restoreVisibility();assert.equal(mesh.visible,true);camera.lookAt(8,0,-5);map.userData.prepareColor(camera);assert.equal(mesh.visible,true);
 camera.lookAt(0,0,-1);map.userData.prepareColor(camera);assert.equal(mesh.visible,false);
 const scene=new THREE.Scene(),sun=new THREE.DirectionalLight();sun.castShadow=true;scene.add(map,sun,sun.target);
 let baked=0;const renderer={capabilities:{isWebGL2:true},shadowMap:{enabled:true},domElement:{addEventListener(){}},render(){assert.ok(mesh.visible);baked++;sun.shadow.map={texture:{},dispose(){}};}};
 const cache=new StaticSunShadow(THREE,renderer,scene,sun,map);cache.prepare(camera);assert.equal(baked,1);assert.equal(mesh.visible,false);cache.prepare(camera);assert.equal(baked,1);
 sun.shadow.mapSize.set(2048,2048);cache.prepare(camera);assert.equal(baked,2);assert.equal(mesh.visible,false);cache.invalidate();assert.equal(mesh.visible,true);assert.equal(mesh.castShadow,true);
});
