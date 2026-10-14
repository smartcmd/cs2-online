'use strict';
const fs=require('node:fs'),path=require('node:path');
const Sim=require(process.env.BOT_SIM ? path.resolve(process.env.BOT_SIM) : '../shared/sim');
const results=[];
for(const difficulty of (process.env.BOT_DIFF?[process.env.BOT_DIFF]:['easy','normal','hard']))for(const initial of (process.env.BOT_SEED?[Number(process.env.BOT_SEED)]:[11,29,47,83])){
 let seed=initial;Math.random=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
 const g=Sim.createGame({diff:difficulty,target:3});Sim.use(g);Sim.newMatch();
 const watch=new Map(),circles=[],stalls=[],events={},durations=[];
 for(let tick=0;tick<9000;tick++){
  const start=performance.now();Sim.tick(1/30);durations.push(performance.now()-start);
  for(const event of g.events){const key=event.e+':'+(event.k||event.reason||'');events[key]=(events[key]||0)+1;}g.events.length=0;
  for(const b of g.ents){
   if(!Number.isFinite(b.pos.x+b.pos.y+b.pos.z+b.yaw)||b.pos.y < -8)throw Error('Invalid bot state '+JSON.stringify({time:g.T,id:b.id,task:b.task,pos:b.pos,vel:b.vel,onGround:b.onGround,pidx:b.pidx,path:b.path?.slice(Math.max(0,b.pidx-1),b.pidx+2)}));
   const goal=b.hunt?b.huntPos:b.task==='fetch'&&g.bomb.state==='dropped'||b.task==='defuse'&&g.bomb.state==='planted'?g.bomb.pos:b.wps[b.wpi];
   if(!b.alive||g.phase!=='live'||b.targetVisible||g.bomb.defuser===b||g.T<b.startAt||!goal){watch.delete(b.id);continue;}
   let old=watch.get(b.id);
   if(!old||old.task!==b.task||Sim.dist2D(old.goal,goal)>1||Math.abs(old.goal.y-goal.y)>1){old={t:g.T,task:b.task,goal:{...goal},from:{...b.pos},last:{...b.pos},yaw:b.yaw,travel:0,turn:0};watch.set(b.id,old);}
   old.travel+=Sim.dist2D(old.last,b.pos);old.turn+=Math.abs(Sim.angDiff(old.yaw,b.yaw));old.last={...b.pos};old.yaw=b.yaw;
   if(g.T-old.t>=8){
    const displacement=Sim.dist2D(old.from,b.pos),entry={time:+g.T.toFixed(1),id:b.id,task:b.task,pos:{...b.pos},goal:{...goal},travel:+old.travel.toFixed(2),turns:+(old.turn/6.283).toFixed(2),path:b.path?.slice(Math.max(0,b.pidx-1),b.pidx+3),pidx:b.pidx,navStall:b.navStall,blocked:[...(b.blockedEdges||new Map()).keys()],neighbors:g.ents.filter(o=>o!==b&&o.alive&&Sim.dist2D(o.pos,b.pos)<3).map(o=>({id:o.id,team:o.team,task:o.task,pos:{...o.pos},goal:o.wps[o.wpi]}))};
    if(displacement<1&&old.travel>8&&old.turn>Math.PI*2)circles.push(entry);
    if(displacement<.5&&old.travel<1)stalls.push(entry);
    watch.delete(b.id);
   }
  }
 }
 durations.sort((a,b)=>a-b);
 const result={difficulty,seed:initial,simulatedSeconds:300,rounds:g.round,events,circles,stalls,p95TickMs:+durations[Math.floor(durations.length*.95)].toFixed(3),maxTickMs:+durations.at(-1).toFixed(3)};
 results.push(result);console.log(JSON.stringify({difficulty,seed:initial,rounds:g.round,circles:circles.length,stalls:stalls.length,p95TickMs:result.p95TickMs}));
}
fs.mkdirSync('.cache/bot-review',{recursive:true});const output=process.env.BOT_AUDIT_OUTPUT||'.cache/bot-review/match-audit.json';fs.writeFileSync(output,JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({simulatedMinutes:results.length*5,circles:results.reduce((n,r)=>n+r.circles.length,0),stalls:results.reduce((n,r)=>n+r.stalls.length,0),output}));
