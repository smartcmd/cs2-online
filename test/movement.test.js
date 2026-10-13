'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const THREE = require('three');
const World = require('../shared/dust2-world');
function world(positions) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('surface', new THREE.Uint16BufferAttribute(new Uint16Array(positions.length / 3), 1));
  g.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i));
  g.userData.dust2 = { meta: { materials: [{ visible: true, collidable: true, mask: -1 }] }, opacity: null };
  World.init(g);
}
function ramp(slope) { world([-10,-10*slope,-10,10,10*slope,10,10,10*slope,-10,-10,-10*slope,-10,-10,-10*slope,10,10,10*slope,10]); }
const player = (x,y,z=0) => ({ pos:{x,y,z}, vel:{x:0,y:0,z:0}, onGround:true });
test('standing on an inclined surface does not slide or oscillate', () => {
  for (const slope of [.08,.25,.5]) {
    ramp(slope); const p=player(0,0); World.move(p,1/60,1.8); const rest={...p.pos};
    for(let i=0;i<600;i++) World.move(p,1/60,1.8);
    assert.ok(Math.hypot(p.pos.x-rest.x,p.pos.z-rest.z)<.0001,`slope ${slope}`);
    assert.ok(Math.abs(p.pos.y-rest.y)<.0001);assert.ok(p.onGround);
  }
});
test('uphill and downhill movement follow the ramp continuously at 30, 60 and 120 Hz', () => {
  for(const fps of [30,60,120])for(const direction of [-1,1]) {
    ramp(.25);const p=player(-direction*4,-direction);p.vel.x=direction*2;
    let previous=p.pos.y;
    for(let i=0;i<fps*4;i++) { World.move(p,1/fps,1.8); assert.ok(Math.abs(p.pos.y-previous)<.07,`vertical jump at ${fps} Hz`);previous=p.pos.y;assert.ok(p.onGround); }
    assert.ok(Math.abs(p.pos.x-direction*4)<.001);
    assert.ok(Math.abs(p.pos.y-(p.pos.x*.25+.34*(Math.sqrt(1+.25**2)-1)+.001))<.002);
  }
});
test('jumping leaves the slope and lands without changing horizontal position', () => {
  ramp(.3);const p=player(0,0);World.move(p,1/60,1.8);const floor=p.pos.y;p.vel.y=7.2;p.onGround=false;
  let peak=floor;for(let i=0;i<180;i++){World.move(p,1/60,1.8);peak=Math.max(peak,p.pos.y);}
  assert.ok(peak>floor+1);assert.ok(p.onGround);assert.ok(Math.abs(p.pos.y-floor)<.003);assert.ok(Math.abs(p.pos.x)<.015);
});

test('stairs use their actual support height rather than an unconditional upward teleport',()=>{
  const floor=new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2).toNonIndexed();
  const parts=[...floor.attributes.position.array];
  for(let i=0;i<5;i++){const g=new THREE.BoxGeometry(.6,(i+1)*.18,4).translate(.3+i*.6,(i+1)*.09,0).toNonIndexed();parts.push(...g.attributes.position.array);}
  world(parts);const p=player(-1,0);p.vel.x=1.2;let last=0;
  for(let i=0;i<180;i++){World.move(p,1/60,1.8);assert.ok(Math.abs(p.pos.y-last)<.2,'step must not use the old 0.42 m lift');last=p.pos.y;}
  assert.ok(p.pos.x>2.5);assert.ok(p.pos.y>.85);assert.ok(p.onGround);
});
test('a fast fall cannot tunnel through a thin floor',()=>{
  ramp(0);const p=player(0,5);p.onGround=false;p.vel.y=-30;
  for(let i=0;i<60;i++)World.move(p,1/30,1.8);
  assert.ok(p.pos.y>=0&&p.pos.y<.01);assert.ok(p.onGround);
});
test('pushing into a wall stops normal velocity and preserves movement along it',()=>{
  const parts=[];for(const g of [new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2),new THREE.PlaneGeometry(20,10).rotateY(Math.PI/2).translate(0,5,0)])parts.push(...g.toNonIndexed().attributes.position.array);
  world(parts);const p=player(-.4,.001);p.vel.x=3;p.vel.z=1;
  for(let i=0;i<120;i++)World.move(p,1/60,1.8);
  assert.ok(p.pos.x<-.33);assert.ok(Math.abs(p.vel.x)<.01);assert.ok(p.pos.z>1.9);assert.ok(p.onGround);
});
test('low head clearance prevents stepping through a ceiling',()=>{
  const parts=[];
  for(const g of [new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2),new THREE.PlaneGeometry(20,20).rotateX(Math.PI/2).translate(0,1.9,0),new THREE.BoxGeometry(3,.4,4).translate(1.5,.2,0)])parts.push(...g.toNonIndexed().attributes.position.array);
  world(parts);const p=player(-1,0);p.vel.x=2;
  for(let i=0;i<180;i++)World.move(p,1/60,1.8);
  assert.ok(p.pos.x<.2);assert.ok(p.pos.y+1.8<1.91);
});
test('releasing crouch under a low ceiling cannot push the player through the floor',()=>{
  const parts=[];for(const g of [new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2),new THREE.PlaneGeometry(20,20).rotateX(Math.PI/2).translate(0,1.48,0)])parts.push(...g.toNonIndexed().attributes.position.array);
  world(parts);const Sim=require('../shared/sim'),p={...player(0,.001),crouch:1,yaw:0,weapons:{},slot:2,scoped:0};
  for(let i=0;i<300;i++){Sim.moveHuman(p,1/60,0,0);assert.ok(p.pos.y>=-.002);assert.ok(Sim.entHeight(p)+p.pos.y<=1.485);}
  assert.ok(p.crouch>.6);assert.ok(p.onGround);
});
