'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),THREE=require('three');
const World=require('../shared/dust2-world');
const meta=require('../public/maps/dust2.json');
test('transparent ray masks follow glTF V coordinates without a second vertical flip',()=>{
 const g=new THREE.PlaneGeometry(1,1).translate(.5,.5,0);
 g.setAttribute('surface',new THREE.Uint16BufferAttribute(new Uint16Array(4),1));
 g.userData.dust2={meta:{materials:[{visible:true,collidable:true,mask:0,cutoff:.5,wrapS:33071,wrapT:33071}],opacity:{tiles:[{offset:0,width:2,height:2}]}},opacity:new Uint8Array([255,0,0,255])};
 World.init(g);
 assert.ok(World.raycast([.25,.25,1],[0,0,-1],2),'source top-left mask texel must be opaque at V=.25');
 assert.equal(World.raycast([.25,.75,1],[0,0,-1],2),null,'source bottom-left mask texel must be transparent at V=.75');
});
test('opaque source decal surfaces retain collision while receiving distinct depth layers',()=>{
 const layers=meta.materials.filter(m=>!m.overlay&&m.depthLayer>0);
 assert.ok(layers.some(m=>m.depthLayer===1&&m.collidable));
 assert.ok(layers.some(m=>m.depthLayer===2&&m.collidable));
});
