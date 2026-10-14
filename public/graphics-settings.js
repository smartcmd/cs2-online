(function(root){
'use strict';
const presets={
 low:{res:'0.75',shadow:'0',aa:'0',fx:'0',filter:'1',detail:'0',texture:'compact'},
 mid:{res:'1',shadow:'1',aa:'1',fx:'1',filter:'4',detail:'0',texture:'compact'},
 high:{res:'native',shadow:'2',aa:'1',fx:'1',filter:'8',detail:'1',texture:'full'},
 ultra:{res:'native',shadow:'3',aa:'1',fx:'1',filter:'16',detail:'1',texture:'full'},
};
const choices={texture:['compact','full'],res:['0.5','0.75','1','1.25','1.5','native'],shadow:['0','1','2','3'],aa:['0','1'],fx:['0','1'],filter:['1','4','8','16'],detail:['0','1'],limit:['0','30','60','90','120'],viewmodel:['center','balanced','compact'],fps:['0','1'],touch:['auto','on','off']};
const poses={center:{fov:62,offset:[0,-.015,0]},balanced:{fov:68,offset:[.045,-.055,.015]},compact:{fov:68,offset:[.065,-.065,-.04]}};
function normalize(saved,touch){
 const base=Object.hasOwn(presets,saved?.preset)?presets[saved.preset]:presets[touch?'mid':'high'],g={preset:touch?'mid':'high',...base,fps:'0',touch:'auto',tsens:1,limit:touch?'60':'0',viewmodel:'balanced'};
 if(saved&&typeof saved==='object')for(const [key,values]of Object.entries(choices))if(values.includes(String(saved[key])))g[key]=String(saved[key]);
 if(Number.isFinite(Number(saved?.tsens)))g.tsens=Math.max(.3,Math.min(3,Number(saved.tsens)));
 g.preset=Object.keys(presets).find(p=>Object.keys(base).every(k=>presets[p][k]===g[k]))||'custom';return g;
}
function pixelRatio(res,dpr){return res==='native'?Math.min(Math.max(1,dpr||1),2):Number(res);}
function shadowSize(level){return level==='3'?4096:level==='2'?2048:1024;}
function filtering(value,maximum){return Math.min(Number(value)||1,Math.max(1,maximum||1));}
class FrameClock{
 constructor(){this.next=0;this.limit=null;}
 shouldRender(now,limit){
  if(limit!==this.limit){this.limit=limit;this.next=now;}
  if(!Number(limit))return true;
  if(now+.1<this.next)return false;
  const interval=1000/Number(limit),late=Math.max(0,now-this.next);
  this.next=now+interval-late%interval;return true;
 }
}
const api={presets,choices,poses,normalize,pixelRatio,shadowSize,filtering,FrameClock};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GraphicsSettings=api;
})(typeof window!=='undefined'?window:globalThis);
