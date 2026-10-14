'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const GraphicsSettings=require('../public/graphics-settings');
const html=fs.readFileSync(require.resolve('../public/index.html'),'utf8'),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const section=(start,end)=>script.slice(script.indexOf(start),script.indexOf(end));
test('graphics settings migrate old presets and reject invalid saved options',()=>{
 const old=GraphicsSettings.normalize({preset:'low',res:'0.75',shadow:'0',aa:'0',fx:'0'},false);assert.equal(old.filter,'1');assert.equal(old.detail,'0');assert.equal(old.preset,'low');
 const bad=GraphicsSettings.normalize({res:Infinity,shadow:'99',filter:'999',limit:'-1',viewmodel:'missing',tsens:999},true);
 assert.equal(bad.res,'1');assert.equal(bad.shadow,'1');assert.equal(bad.limit,'60');assert.equal(bad.viewmodel,'balanced');assert.equal(bad.tsens,3);
 assert.equal(GraphicsSettings.filtering('16',4),4);assert.equal(GraphicsSettings.shadowSize('3'),4096);assert.equal(GraphicsSettings.pixelRatio('native',3),2);
});
test('frame caps hold their target rate without accumulating a render backlog',()=>{
 for(const cap of ['30','60','90','120','0']){const clock=new GraphicsSettings.FrameClock();let frames=0;for(let i=0;i<1200;i++)if(clock.shouldRender(i*1000/120,cap))frames++;assert.ok(Math.abs(frames-(cap==='0'?1200:Number(cap)*10))<=1,cap+': '+frames);}
 const clock=new GraphicsSettings.FrameClock();assert.ok(clock.shouldRender(0,'30'));assert.ok(!clock.shouldRender(8,'30'));assert.ok(clock.shouldRender(9,'0'));assert.ok(clock.shouldRender(10000,'60'));assert.ok(!clock.shouldRender(10001,'60'));
});
test('render capping preserves every local input step and total predicted time',()=>{
 function simulate(limit){const steps=[];let draws=0;const noop=()=>{};
  const context=vm.createContext({last:0,lastRender:0,renderedFrames:0,menuT:0,frameClock:new GraphicsSettings.FrameClock(),settings:{gfx:{limit}},requestAnimationFrame:noop,
   lightingPreview:null,inGame:true,latest:{rd:1,ph:'live',ft:0,rt:100},localStep:dt=>steps.push(dt),renderProfiler:null,
   sample:null,sampleAt:noop,serverNow:()=>1,INTERP:.12,audioDirector:{update:noop},sinceSnap:()=>0,bombState:()=> 'none',bInfo:()=>[],P:{alive:true,plantT:0},
   syncRemotes:noop,updateBombAndItems:noop,updateFx:noop,updateCamera:noop,updateViewModel:noop,updateHud:noop,window:{},staticSunShadow:null,
   renderer:{clear:noop,render:()=>draws++},scene:{},cam:{},vm:null});
  vm.runInContext(section('function frame(nowMs)', 'const TOUCH_API'),context);for(let i=1;i<=120;i++)context.frame(i*1000/120);return {steps,draws};
 }
 const full=simulate('0'),limited=simulate('30');assert.deepEqual(limited.steps,full.steps);assert.equal(full.steps.length,120);assert.ok(limited.draws>=29&&limited.draws<=31);assert.equal(full.draws,120);
});
test('draw visuals keep source timing while client weapon readiness stays unchanged',()=>{
 const calls=[],P={},W={usp:{slot:2},ak47:{slot:1},awp:{slot:1,scope:true},knife:{melee:true}};
 const context=vm.createContext({cancelReloadSounds(){},vm:null,vmId:null,viewRig:{remove(){},add(){}},P,W,lt:10,buildViewModel:()=>({userData:{official:true}}),GameAssets:{dispose(){},playView:(...a)=>calls.push(a)},sfx:{draw(){}}});
 vm.runInContext(section('function onWeaponView(', 'function localSlot('),context);
 for(const [id,duration]of [['usp',.45],['ak47',.8],['awp',1.1],['knife',.3]]){context.onWeaponView(id);assert.equal(P.drawEnd,10+duration);assert.equal(calls.at(-1)[1],'draw');assert.equal(calls.at(-1).length,2);}
});
test('source draw clips use unit playback speed and reloads can still follow gameplay duration',()=>{
 const T=require('three'),root={THREE:T};vm.runInNewContext(fs.readFileSync(require.resolve('../public/game-assets.js'),'utf8'),{window:root,Map,Set});
 const action={timeScale:0,getClip:()=>({duration:1}),fadeOut(){},stop(){},reset(){return this},setEffectiveWeight(){return this},fadeIn(){return this},setLoop(){return this},play(){}};
 const model={userData:{official:true,mixer:{update(){}},actions:new Map([['draw',action],['reload',action]])}};
 root.GameAssets.playView(model,'draw');assert.equal(action.timeScale,1);
 root.GameAssets.playView(model,'reload',2);assert.equal(action.timeScale,.5);
});
test('new draw actions evaluate their first authored pose before a frame can show the bind pose',()=>{
 const T=require('three'),root={THREE:T};vm.runInNewContext(fs.readFileSync(require.resolve('../public/game-assets.js'),'utf8'),{window:root,Map,Set});
 const model=new T.Group(),bone=new T.Bone();bone.name='wpn';bone.position.x=100;model.add(bone);
 const mixer=new T.AnimationMixer(model),idle=new T.AnimationClip('idle',1,[new T.VectorKeyframeTrack('wpn.position',[0,1],[0,0,0,0,0,0])]),draw=new T.AnimationClip('draw',1,[new T.VectorKeyframeTrack('wpn.position',[0,1],[1,0,0,2,0,0])]);
 model.userData={official:true,mixer,actions:new Map([['idle',mixer.clipAction(idle)],['draw',mixer.clipAction(draw)]])};
 root.GameAssets.playView(model,'idle');assert.equal(bone.position.x,0);
 root.GameAssets.playView(model,'draw');assert.equal(bone.position.x,1);mixer.update(.5);assert.equal(bone.position.x,1.5);
});
test('single-frame idle poses remain finite instead of looping a zero-second clip',()=>{
 const T=require('three'),root={THREE:T};vm.runInNewContext(fs.readFileSync(require.resolve('../public/game-assets.js'),'utf8'),{window:root,Map,Set});
 const model=new T.Group(),bone=new T.Bone();bone.name='wpn';model.add(bone);const mixer=new T.AnimationMixer(model);
 const clip=new T.AnimationClip('idle',0,[new T.VectorKeyframeTrack('wpn.position',[0],[.1,.2,.3])]),action=mixer.clipAction(clip);
 model.userData={official:true,mixer,actions:new Map([['idle',action]])};root.GameAssets.playView(model,'idle');
 for(let i=0;i<120;i++)mixer.update(1/60);
 assert.ok(Number.isFinite(action.time));assert.ok(bone.position.toArray().every(Number.isFinite));assert.equal(action.loop,T.LoopOnce);assert.ok(action.clampWhenFinished);
});

test('new mobile settings load colour-only surfaces while explicit saved detail remains enabled',()=>{
 assert.equal(GraphicsSettings.normalize(null,true).detail,'0');
 assert.equal(GraphicsSettings.normalize({detail:'1'},true).detail,'1');
 assert.equal(GraphicsSettings.normalize(null,false).detail,'1');
});

test('mobile balances texture memory while desktop and explicit precision choices retain full colour',()=>{
 assert.equal(GraphicsSettings.normalize(null,true).texture,'compact');assert.equal(GraphicsSettings.normalize(null,false).texture,'full');assert.equal(GraphicsSettings.normalize({texture:'full'},true).texture,'full');assert.equal(GraphicsSettings.normalize({texture:'compact'},false).texture,'compact');
});
