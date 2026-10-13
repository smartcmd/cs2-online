(function(root){
'use strict';
const THREE=root.THREE, templates=new Map(), sounds=new Map();
let viewClips=[],playerClips=[],manifest;
const aliases={glock:'pistol',galil:'galilar',famas:'m4a4'};
const api={ready:false,sounds};
api.load=async function(progress){
  const response=await fetch('/game/assets.json');if(!response.ok)throw Error('人物与武器资源清单缺失');manifest=await response.json();
  const loader=new THREE.GLTFLoader(),jobs=manifest.files.slice();let done=0,cursor=0;
  const offline=new (root.OfflineAudioContext||root.webkitOfflineAudioContext)(1,1,44100);
  await Promise.all(Array.from({length:4},async()=>{
    while(cursor<jobs.length){const file=jobs[cursor++],url='/game/'+file.name+'?v='+file.sha256.slice(0,12);
      if(file.name.endsWith('.glb')){const model=await loader.loadAsync(url);if(file.name==='weapon-animations.glb')viewClips=model.animations;else if(file.name==='player-animations.glb')playerClips=model.animations;else templates.set(file.name.slice(0,-4),model.scene);}
      else if(/\.(mp3|ogg)$/.test(file.name)){const r=await fetch(url);if(!r.ok)throw Error('音效加载失败: '+file.name);sounds.set(file.name,await offline.decodeAudioData(await r.arrayBuffer()));}
      progress(++done,jobs.length);
    }
  }));
  api.ready=true;
};
function clone(id,lighting){
  const original=templates.get(id);if(!original)throw Error('模型资源缺失: '+id);
  const model=THREE.SkeletonUtils.clone(original);
  model.traverse(o=>{if(!o.isMesh)return;o.frustumCulled=false;o.castShadow=o.receiveShadow=true;
    const prepare=m=>{m=m.clone();if(lighting)lighting(m);return m;};o.material=Array.isArray(o.material)?o.material.map(prepare):prepare(o.material);
  });return model;
}
function clipsFor(model,clips){
  return clips.map(source=>{const clip=source.clone();clip.tracks=clip.tracks.filter(track=>{
    const name=THREE.PropertyBinding.parseTrackName(track.name).nodeName;
    return name!=='weapon'&&!!model.getObjectByName(name);
  });return clip;});
}
function sourceWeapon(id,parent,lighting){
  const model=clone(id,lighting),normal=model.getObjectByName('normalization');
  if(normal){normal.matrix.identity();normal.matrix.decompose(normal.position,normal.quaternion,normal.scale);normal.matrixAutoUpdate=true;}
  model.updateMatrixWorld(true);
  const attachment=new THREE.Group(),bone=model.getObjectByName('weapon');
  if(bone){attachment.matrix.copy(bone.matrixWorld).invert();attachment.matrix.decompose(attachment.position,attachment.quaternion,attachment.scale);}
  attachment.add(model);parent.add(attachment);return attachment;
}
function dispose(model){model.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.dispose();if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});}
api.gun=function(id,lighting){const model=clone(id,lighting);const box=new THREE.Box3().setFromObject(model);model.userData.assetModel=true;model.userData.muzzle=new THREE.Vector3((box.min.x+box.max.x)/2,(box.min.y+box.max.y)/2,box.min.z);return model;};
api.view=function(id,flashMaterial,slot){
  const model=new THREE.Group(),source=new THREE.Group();source.rotation.y=Math.PI;model.add(source);
  const arms=clone('arms');source.add(arms);const pivot=arms.getObjectByName('wpn')||arms;
  const weapon=sourceWeapon(id,pivot);
  const mixer=new THREE.AnimationMixer(source),prefix=aliases[id]||id;
  const clips=clipsFor(source,viewClips.filter(c=>c.name.startsWith(prefix+'/'))),actions=new Map(clips.map(c=>[c.name.split('/')[1],mixer.clipAction(c)]));
  const flash=new THREE.Sprite(flashMaterial);flash.scale.set(.18,.18,1);flash.visible=false;model.add(flash);
  model.userData={official:true,mixer,actions,flash,slot,weapon,source,action:null};
  mixer.addEventListener('finished',event=>{if(model.userData.action===event.action)api.playView(model,'idle');});
  api.playView(model,'idle');return model;
};
api.playView=function(model,name,duration){
  if(!model?.userData.official)return;
  const data=model.userData;if(!data.actions.has(name))name='idle';const action=data.actions.get(name);if(!action)return;
  if(name==='idle'&&data.action===action)return;
  if(data.action)data.action.fadeOut(.05);
  action.reset().setEffectiveWeight(1).fadeIn(.05);
  action.setLoop(name==='idle'?THREE.LoopRepeat:THREE.LoopOnce,name==='idle'?Infinity:1);action.clampWhenFinished=name!=='idle';
  action.timeScale=duration?action.getClip().duration/Math.max(.05,duration):1;
  data.action=action;action.play();
};
api.updateView=function(model,dt){
  const d=model.userData;d.mixer.update(dt);d.source.updateMatrixWorld(true);
  const tip=d.weapon.getObjectByName('muzzle')||d.source.getObjectByName('wpnTip');
  if(tip){tip.getWorldPosition(d.flash.position);model.worldToLocal(d.flash.position);}
  else d.flash.position.set(.14,-.09,-.75);
};
api.player=function(team,lighting){
  const g=new THREE.Group(),model=clone(team==='CT'?'ct':'t',lighting);model.rotation.y=Math.PI;g.add(model);
  const mixer=new THREE.AnimationMixer(model);g.userData.assetModel=true;g.userData.mixer=mixer;const clips=clipsFor(model,playerClips),actions=new Map(clips.map(c=>[c.name,mixer.clipAction(c)]));
  return {g,model,mixer,actions,official:true,gun:null,gunId:null,lighting,head:model.getObjectByName('head_0'),spine:model.getObjectByName('spine_3'),headPoint:new THREE.Vector3(),action:null,dead:false};
};
api.playerGun=function(player,id){
  if(player.gunId===id)return;player.gunId=id;
  if(player.gun){player.gun.parent.remove(player.gun);dispose(player.gun);}
  player.gun=sourceWeapon(id,player.model.getObjectByName('wpn')||player.model,player.lighting);
};
api.updatePlayer=function(player,state,speed,dt){
  const category=state.wid==='knife'?'knife':['glock','usp','deagle'].includes(state.wid)?'pistol':'rifle';
  const name=!state.alive?'death':(state.arr?.[12]&8)?category+'/reload':category+'/'+(state.crouch>.5?(speed>.3?'crouchMove':'crouchIdle'):speed>3?'run_n':speed>.3?'walk':'idle');
  const action=player.actions.get(name)||player.actions.get(category+'/idle');
  const once=!state.alive||!!(state.arr?.[12]&8);
  if(action&&player.action!==action){if(player.action)player.action.fadeOut(.12);action.reset().setEffectiveWeight(1).fadeIn(.12).setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);action.clampWhenFinished=once;if(state.alive&&once)action.timeScale=action.getClip().duration/(root.Sim.W[state.wid]?.reload||2);else action.timeScale=1;action.play();player.action=action;}
  player.mixer.update(dt);
  if(state.alive){
    if(player.spine)player.spine.rotation.x+=state.pitch*.65;
    player.model.scale.y=1;player.model.position.x=player.model.position.z=0;player.g.updateMatrixWorld(true);
    if(player.head){const head=player.headPoint;player.head.getWorldPosition(head);player.g.worldToLocal(head);if(head.y>.5){player.model.scale.y=1.6*(1-.28*state.crouch)/head.y;player.model.position.x=-head.x;player.model.position.z=-head.z;}}
  }
};
api.dispose=function(model){if(model?.userData?.mixer)model.userData.mixer.stopAllAction();dispose(model);};
root.GameAssets=api;
})(window);
