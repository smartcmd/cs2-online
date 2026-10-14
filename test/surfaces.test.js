'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {weights,atlasSampling}=require('../public/map-surfaces');
test('projection weights remain continuous when a diagonal face crosses an axis tie',()=>{
 for(const normal of [[1,0,1],[1,1,0],[0,1,1],[1,1,1]]){
  const a=weights(normal.map((v,i)=>v+(i===0?.00001:0))),b=weights(normal.map((v,i)=>v-(i===0?.00001:0)));
  assert.ok(Math.max(...a.map((v,i)=>Math.abs(v-b[i])))<.0001);
  assert.ok(Math.abs(a.reduce((x,y)=>x+y,0)-1)<1e-10);
 }
});
test('axis-aligned and mirrored surfaces keep their expected texture direction',()=>{
 assert.deepEqual(weights([1,0,0]),[1,0,0]);assert.deepEqual(weights([0,-1,0]),[0,1,0]);
 assert.deepEqual(weights([0,0,1]),[0,0,1]);assert.deepEqual(weights([-1,0,-1]),weights([1,0,1]));
 assert.deepEqual(weights([0,0,0]),[0,1,0]);
});
test('all atlas projections use unwrapped gradients on WebGL2 and retain a WebGL1 path',()=>{
 const shader=atlasSampling(2.4,[.5,0],true);
 assert.equal((shader.match(/textureGrad\(/g)||[]).length,3);
 assert.ok(shader.includes('dFdx(uvX)*.492'));assert.ok(shader.includes('dFdy(uvZ)*.492'));
 assert.equal((atlasSampling(2.4,[.5,0],false).match(/texture2D\(/g)||[]).length,3);
 assert.ok(!shader.includes('surfaceNormal.x > surfaceNormal.z'));
});
test('shadow bias tracks world-space texel size for both quality levels',()=>{
 const {shadowBias}=require('../public/map-surfaces'),high=shadowBias(148,2048,229),medium=shadowBias(148,1024,229);
 assert.ok(high.bias<-.0001&&high.normalBias>.02);
 assert.equal(medium.normalBias,high.normalBias*2);assert.equal(medium.bias,high.bias*2);
 assert.ok(high.normalBias+Math.abs(high.bias)*229<148/2048,'offset remains below one shadow texel');
});
