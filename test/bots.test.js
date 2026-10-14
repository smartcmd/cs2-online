'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Sim=require('../shared/sim'),routes=require('./fixtures/bot-routes.json');
function seeded(seed,fn){const original=Math.random;Math.random=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};try{return fn();}finally{Math.random=original;}}
function game(){const g=Sim.createGame({diff:'normal',target:99});Sim.use(g);Sim.newMatch();g.phase='live';g.roundT=999;return g;}
function single(route){const g=game(),b=g.ents.find(e=>e.team===route.team);g.ents=[b];g.bomb.state='none';g.bomb.carrier=null;b.hasBomb=false;b.think=999;b.startAt=0;b.pos={...route.from};b.vel=Sim.V();b.crouch=0;b.onGround=true;b.task='route';b.wps=route.goals.map(p=>({...p}));b.wpi=0;b.path=null;b.pathKey='';b.repathAt=0;return {g,b};}

test('sixty original-map missions complete without circling or false arrival',()=>seeded(100,()=>{
 for(const route of routes){
  const {g,b}=single(route);let previous={...b.pos},distance=0;
  for(let i=0;i<1800&&b.wpi<b.wps.length;i++){Sim.tick(1/30);distance+=Sim.dist2D(previous,b.pos);previous={...b.pos};g.events.length=0;}
  assert.equal(b.wpi,b.wps.length,`seed ${route.run}, bot ${route.slot} stalled at ${JSON.stringify(b.pos)}`);
  assert.ok(Sim.dist2D(b.pos,route.goals.at(-1))<.7);assert.ok(Math.abs(b.pos.y-route.goals.at(-1).y)<.65);
  if((route.run===2&&route.slot===1)||(route.run===3&&route.slot===4))assert.ok(distance<75,`A ramp loop regression: ${distance} m`);
 }
}));

test('an unavailable path never completes a waypoint, and retries are throttled',()=>seeded(2,()=>{
 const {b}=single(routes[0]),original=Sim.World.path;let calls=0;
 Sim.World.path=()=>{calls++;return null;};
 try{for(let i=0;i<150;i++)Sim.tick(1/30);assert.equal(b.wpi,0);assert.ok(calls<=6,`${calls} retries in five seconds`);}finally{Sim.World.path=original;}
}));

test('steady route progress does not reset to the nearest nav centre every four seconds',()=>seeded(2,()=>{
 const {b}=single(routes.find(r=>r.run===2&&r.slot===1)),original=Sim.World.path;let calls=0;
 Sim.World.path=(...args)=>{calls++;return original(...args);};
 try{for(let i=0;i<1500&&b.wpi<b.wps.length;i++)Sim.tick(1/30);assert.equal(b.wpi,b.wps.length);assert.ok(calls<=3,`${calls} unnecessary replans`);}finally{Sim.World.path=original;}
}));

test('one CT handles defusing while teammates cover, and another takes over after death',()=>seeded(8,()=>{
 const g=game(),cts=g.ents.filter(e=>e.team==='CT');for(const e of g.ents){e.think=0;e.startAt=0;if(e.team==='T'){e.human=true;e.pos=Sim.V(150,0,150);}}
 const site=Sim.MAP.sites.B;Object.assign(g.bomb,{state:'planted',site:'B',pos:Sim.V(site.x,site.y,site.z),timer:40,defuser:null,defuseBot:null});
 cts.forEach((b,i)=>{b.pos=Sim.V(site.x+2+i,site.y,site.z+2);b.vel=Sim.V();b.kit=false;});
 cts[0].pos=Sim.V(site.x+.25,site.y,site.z);cts[1].pos=Sim.V(site.x+.9,site.y,site.z);cts[1].kit=true;
 for(let i=0;i<10;i++)Sim.tick(1/30);
 assert.equal(g.bomb.defuser,cts[1]);assert.equal(cts.filter(b=>b.task==='defuse').length,1);assert.ok(cts.filter(b=>b.task==='cover').length>=3);
 cts[1].alive=false;cts[1].hp=0;
 for(let i=0;i<30;i++)Sim.tick(1/30);
 assert.ok(g.bomb.defuseBot&&g.bomb.defuseBot!==cts[1]&&g.bomb.defuseBot.alive);
}));

test('bomb pickup and defusing cannot happen from a different floor',()=>seeded(1,()=>{
 const g=game(),b=g.ents.find(e=>e.team==='T');for(const e of g.ents)e.human=true;
 g.bomb.state='dropped';g.bomb.carrier=null;g.bomb.pos=Sim.V(b.pos.x,b.pos.y+4,b.pos.z);for(const e of g.ents)e.hasBomb=false;
 Sim.tick(1/30);assert.equal(g.bomb.state,'dropped');
 const ct=g.ents.find(e=>e.team==='CT');g.bomb.state='planted';g.bomb.timer=30;g.bomb.pos=Sim.V(ct.pos.x,ct.pos.y+4,ct.pos.z);g.bomb.defuser=ct;g.bomb.defuseT=2;ct.useHeld=true;
 Sim.tick(1/30);assert.equal(g.bomb.defuser,null);assert.equal(g.bomb.defuseT,0);
}));

test('a visible target is retained when a second enemy is only slightly closer',()=>seeded(3,()=>{
 const g=game(),b=g.ents.find(e=>e.team==='CT'),targets=g.ents.filter(e=>e.team==='T').slice(0,2);g.ents=[b,...targets];g.bomb.state='none';
 b.pos=Sim.V(40,1,-25);b.yaw=0;b.pitch=0;b.think=0;b.startAt=0;b.reactAt=999;b.lastSeen=g.T;b.task='hold';
 targets.forEach((e,i)=>{e.human=true;e.pos=Sim.V(40,1,-35+i*.5);});b.target=targets[0];b.targetVisible=true;
 Sim.tick(1/30);assert.equal(b.target,targets[0]);assert.equal(b.targetVisible,true);
}));

test('close nav corners still lead to off-centre tactical positions',()=>seeded(83,()=>{
 const route={team:'CT',from:{x:-45.9896759633,y:.8163342939,z:-66.5896245001},goals:[{x:-47.3176406371,y:.8538415427,z:-66.3926834139}]};
 const {b}=single(route);for(let i=0;i<300&&b.wpi<b.wps.length;i++)Sim.tick(1/30);
 assert.equal(b.wpi,1);assert.ok(Sim.dist2D(b.pos,route.goals[0])<.7);
}));

test('randomised team positions do not collapse onto the same nav centre',()=>seeded(83,()=>{
 const g=game(),attackers=g.ents.filter(e=>e.team==='T'&&!e.hasBomb);
 const goals=attackers.map(e=>e.wps.at(-1));
 for(let i=0;i<goals.length;i++)for(let j=i+1;j<goals.length;j++)assert.ok(Sim.dist2D(goals[i],goals[j])>1,JSON.stringify(goals));
}));

test('a bomb carrier plants inside the legal site without fighting teammates for its centre',()=>seeded(11,()=>{
 const g=game(),b=g.bomb.carrier,s=Sim.MAP.sites.B;g.tSite='B';g.ents=[b];b.think=999;b.startAt=0;b.target=null;b.targetVisible=false;b.task='plant';b.wps=[{x:s.x,y:s.y,z:s.z}];b.wpi=0;
 b.pos=Sim.V(s.x,s.y,s.z+3);b.vel=Sim.V();b.onGround=true;b.path=null;b.pathGoal=null;b.pathKey='';
 for(let i=0;i<130&&g.bomb.state!=='planted';i++)Sim.tick(1/30);
 assert.equal(g.bomb.state,'planted');assert.equal(g.bomb.site,'B');assert.ok(Sim.dist2D(b.pos,s)>1,'planting must not require touching the centre');
}));

test('a bot can recover from the small step at the long-A checkpoint',()=>seeded(47,()=>{
 const route={team:'T',from:{x:41.4369233372,y:1.42935765,z:-13.2829831474},goals:[{x:40.7416,y:2.1336,z:-13.3921}]};
 const {b}=single(route);for(let i=0;i<600&&b.wpi<b.wps.length;i++)Sim.tick(1/30);
 assert.equal(b.wpi,1);assert.ok(Math.abs(b.pos.y-route.goals[0].y)<.65);
}));

test('a bot below the mid ledge reroutes instead of retrying an impossible jump forever',()=>seeded(29,()=>{
 const route={team:'CT',from:{x:-6.8935,y:-1.435,z:-26.0717},goals:[{x:24.3973,y:2.4416,z:-66.2866}]};
 const {b}=single(route);for(let i=0;i<2400&&b.wpi<b.wps.length;i++)Sim.tick(1/30);
 assert.equal(b.wpi,1);assert.ok(Sim.dist2D(b.pos,route.goals[0])<.7);
}));

test('a removed but still-alive objective runner cannot retain the assignment',()=>seeded(8,()=>{
 const g=game(),removed=g.ents.find(e=>e.team==='CT');g.ents=g.ents.filter(e=>e!==removed);for(const e of g.ents){e.think=0;e.startAt=0;if(e.team==='T'){e.human=true;e.pos=Sim.V(150,0,150);}}
 const s=Sim.MAP.sites.B;Object.assign(g.bomb,{state:'planted',site:'B',pos:Sim.V(s.x,s.y,s.z),timer:40,defuser:null,defuseBot:removed});
 Sim.tick(1/30);assert.ok(g.bomb.defuseBot);assert.notEqual(g.bomb.defuseBot,removed);assert.ok(g.ents.includes(g.bomb.defuseBot));
}));
