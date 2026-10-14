(function(root){
'use strict';
const weaponFiles={
 ak47:['weapons_ak47_ak47_draw','weapons_ak47_ak47_clipout_01','weapons_ak47_ak47_addammo_02','weapons_ak47_ak47_boltpull_01'],
 m4a4:['weapons_m4a1_m4a1_draw','weapons_m4a1_m4a1_clipout','weapons_m4a1_m4a1_clipin','weapons_m4a1_m4a1_addammo_01'],
 galil:['weapons_galilar_galil_draw','weapons_galilar_galil_clipout','weapons_galilar_galil_clipin','weapons_galilar_galil_boltforward'],
 awp:['weapons_awp_awp_draw','weapons_awp_awp_clipout','weapons_awp_awp_clipin','weapons_awp_awp_boltforward'],
 glock:['weapons_glock18_glock_draw','weapons_glock18_glock_clipout','weapons_glock18_glock_clipin','weapons_glock18_glock_sliderelease'],
 usp:['weapons_usp_usp_draw','weapons_usp_usp_clipout_01','weapons_usp_usp_clipin_02','weapons_usp_usp_sliderelease_01'],
 deagle:['weapons_deagle_de_draw','weapons_deagle_de_clipout','weapons_deagle_deagle_addammo_01','weapons_deagle_de_slideforward'],
 knife:['weapons_knife_weapon_knife_draw_small_clean_01'],c4:['weapons_c4_c4_draw_01'],
};
const extra=['mud_impact_bullet1','mud_impact_bullet2','mud_impact_bullet3','weapons_c4_c4_beep2_10sec','weapons_c4_c4_disarmstart','weapons_c4_c4_disarmfinish','weapons_c4_c4_plant','weapons_c4_key_press1','weapons_c4_key_press2','weapons_c4_key_press3','weapons_knife_knife_swish_heavy_01','weapons_knife_knife_hit_light_01','weapons_awp_awp_boltback'];
const music=['startround_01','bombtenseccount','wonround','lostround','deathcam'];
const files=[...new Set([...Object.values(weaponFiles).flat(),...extra])].map(name=>({source:'audio/cs2/'+name+'.mp3',name:name+'.mp3'})).concat(music.map(name=>({source:'audio/music/optional/valve_cs2_01/'+name+'.mp3',name:'music_'+name+'.mp3'})));
function weapon(id){return weaponFiles[id==='famas'?'galil':id]||weaponFiles.ak47;}
class Director{
 constructor(output){this.output=output;this.reset();}
 reset(){for(const group of ['music','plant','defuse'])this.output.stop(group);this.round=null;this.phase=null;this.tick=Infinity;this.played=new Set();this.defuser=0;this.plantKey=-1;this.alive=null;}
 music(name,offset=0,remaining){if(name==='roundtenseccount')name='bombtenseccount';this.output.stop('music');this.output.play('music_'+name+'.mp3',{group:'music',gain:1,offset,remaining});}
 update(s){
  if(s.round!==this.round){this.reset();this.round=s.round;}
  if(s.phase!==this.phase){
   if(s.phase==='freeze')this.music('startround_01',0,Math.max(0,s.freeze));
   if(s.phase==='live'&&this.phase==='freeze'){this.output.stop('music');this.output.countdown(0);}
   if(s.phase==='post'||s.phase==='over'){this.output.stop('plant');this.output.stop('defuse');}
   this.phase=s.phase;
  }
  if(s.phase==='freeze'){const tick=Math.ceil(s.freeze);if(tick>0&&tick<=5&&tick<this.tick){this.tick=tick;this.output.countdown(tick);}}
  if(s.phase==='live'){
   const bomb=s.bombState==='planted',left=bomb?s.bombLeft:s.roundLeft,key=bomb?'bombtenseccount':'roundtenseccount';
   if(left>0&&left<=10&&!this.played.has(key)){this.played.add(key);this.music(key,Math.max(0,10-left));}
  }
  const planting=s.alive&&s.planting>0;
  if(!planting){if(this.plantKey>=0)this.output.stop('plant');this.plantKey=-1;}
  else {const key=Math.floor(s.planting/.6);if(key!==this.plantKey){this.plantKey=key;this.output.play('weapons_c4_key_press'+(key%3+1)+'.mp3',{group:'plant',gain:.5});}}
  const defuser=s.phase==='live'&&s.bombState==='planted'?s.defuser:0;
  if(defuser!==this.defuser){this.output.stop('defuse');if(defuser)this.output.play('weapons_c4_c4_disarmstart.mp3',{group:'defuse',gain:.7,pos:s.bombPosition,range:22});this.defuser=defuser;}
  if(this.alive===true&&!s.alive&&s.phase==='live')this.music('deathcam');
  this.alive=s.alive;
 }
 endRound(won){this.output.stop('plant');this.output.stop('defuse');this.music(won?'wonround':'lostround');}
}
const api={Director,files,weapon};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GameAudio=api;
})(typeof window!=='undefined'?window:globalThis);
