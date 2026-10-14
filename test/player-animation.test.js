'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),THREE=require('three');
const ready=require('./helpers/actor-assets.cjs').createAssets();
const state=(wid='usp',flags=64)=>({alive:true,wid,crouch:1,pitch:-.6,arr:Array.from({length:13},(_,i)=>i===12?flags:0)});

test('defusing holds a finite stable authored pose at 30, 60 and 120 FPS for both teams',async()=>{
 const api=await ready;
 for(const team of ['CT','T'])for(const fps of [30,60,120])for(const weapon of ['usp','ak47']){
  const p=api.player(team);api.playerGun(p,weapon);const s=state(weapon);
  for(let i=0;i<fps;i++)api.updatePlayer(p,s,i%2?.35:0,1/fps);
  const pose=p.spine.quaternion.clone(),position=p.model.position.clone(),scale=p.model.scale.clone();
  for(let i=0;i<fps*10;i++)api.updatePlayer(p,s,i%2?.35:0,1/fps);
  assert.ok(Number.isFinite(p.action.time));assert.ok(pose.angleTo(p.spine.quaternion)<1e-6);
  assert.ok(position.distanceTo(p.model.position)<1e-6);assert.ok(scale.distanceTo(p.model.scale)<1e-6);
  assert.ok(p.action.getClip().name.endsWith('/crouchIdle'));api.dispose(p.g);
 }
});
test('aim returns to the same pose after movement, crouching, reload and death transitions',async()=>{
 const api=await ready,p=api.player('CT'),s=state('usp',0);api.playerGun(p,'usp');s.crouch=0;
 for(let i=0;i<90;i++)api.updatePlayer(p,s,0,1/60);const initial=p.spine.quaternion.clone();
 for(const [flags,speed,crouch,pitch]of [[0,5,0,.4],[64,.8,1,-.6],[8,0,1,.5],[0,0,0,0]]){
  Object.assign(s,{crouch,pitch});s.arr[12]=flags;for(let i=0;i<120;i++)api.updatePlayer(p,s,speed,1/60);
 }
 Object.assign(s,{pitch:-.6,crouch:0});for(let i=0;i<90;i++)api.updatePlayer(p,s,0,1/60);assert.ok(initial.angleTo(p.spine.quaternion)<1e-6);
 s.alive=false;for(let i=0;i<180;i++)api.updatePlayer(p,s,0,1/60);assert.ok(Number.isFinite(p.action.time));api.dispose(p.g);
});
test('players share immutable clips and materials but retain separate mixers and bones',async()=>{
 const api=await ready,a=api.player('CT'),b=api.player('CT');assert.equal(a.actions.size,0);assert.equal(b.actions.size,0);
 assert.equal(a.clips.get('pistol/crouchIdle'),b.clips.get('pistol/crouchIdle'));assert.notEqual(a.spine,b.spine);
 let am,bm;a.g.traverse(o=>{if(o.isMesh&&!am)am=o.material;});b.g.traverse(o=>{if(o.isMesh&&!bm)bm=o.material;});assert.equal(am,bm);
 let disposed=false;am.addEventListener('dispose',()=>disposed=true);api.updatePlayer(a,state(),0,.1);assert.equal(a.actions.size,1);assert.equal(b.actions.size,0);
 api.dispose(a.g);assert.equal(disposed,false);api.updatePlayer(b,state(),0,1/60);assert.ok(Number.isFinite(b.action.time));api.dispose(b.g);
});
test('material warmup compiles both lighting environments without leaving preview models in the scene',async()=>{
 const api=await ready,world=new THREE.Scene(),view=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),calls=[];
 const light=material=>{material.userData.lit=true;};
 api.precompile({compile(scene){calls.push(scene);let meshes=0;scene.traverse(o=>{if(o.isMesh){meshes++;assert.equal(o.material.userData.lit,scene===world?true:undefined);}});assert.ok(meshes>0);}},world,camera,view,camera,light);
 assert.equal(calls.length,2);assert.equal(world.children.length,0);assert.equal(view.children.length,0);
 const p=api.player('CT',light);api.updatePlayer(p,state(),0,1/60);assert.ok(Number.isFinite(p.action.time));api.dispose(p.g);
});
