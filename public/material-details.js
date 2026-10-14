(function(root){
'use strict';
// Appearance data is separate from the source mesh and its gameplay alpha UVs.
function apply(THREE,geometry,buffer,meta){
 const v=new DataView(buffer),vertices=v.getUint32(4,true),runs=v.getUint32(8,true),count=v.getUint32(12,true),unique=v.getUint32(16,true);
 if(v.getUint32(0,false)!==0x44325431||vertices!==meta.vertices||buffer.byteLength!==20+runs*12+unique*8+count*2)throw Error('Invalid map material details');
 const values=new Float32Array(unique*2),bits=new Uint32Array(values.buffer),style=new Uint8Array(geometry.attributes.position.count),uv=geometry.attributes.uv.array;
 let offset=20+runs*12;
 for(let axis=0;axis<2;axis++){let previous=0;for(let i=0;i<unique;i++){let delta=0;for(let byte=0;byte<4;byte++)delta|=v.getUint8(offset+(axis*4+byte)*unique+i)<<(byte*8);previous=(previous^delta)>>>0;bits[i*2+axis]=previous;}}
 offset+=unique*8;let read=0,lastEnd=0;
 for(let i=0;i<runs;i++){
  const at=20+i*12,first=v.getUint32(at,true),length=v.getUint32(at+4,true),kind=v.getUint32(at+8,true);
  if(first<lastEnd||first+length>vertices||kind<1||kind>7)throw Error('Invalid detail range');lastEnd=first+length;
  style.fill(kind,first,lastEnd);
  if(kind<=3)for(let vertex=first;vertex<lastEnd;vertex++){
   if(meta.materials[geometry.attributes.surface.getX(vertex)].mask>=0)throw Error('Detail UV must not replace an opacity mask');
   if(read>=count)throw Error('Incomplete detail UVs');const id=v.getUint16(offset+read++*2,true);if(id>=unique)throw Error('Invalid detail UV');
   uv[vertex*2]=values[id*2];uv[vertex*2+1]=values[id*2+1];
  }
 }
 if(read!==count)throw Error('Unexpected detail UVs');
 geometry.setAttribute('detailStyle',new THREE.BufferAttribute(style,1));geometry.attributes.uv.needsUpdate=true;
}

function createAtlas(THREE){
 const atlas=document.createElement('canvas');atlas.width=atlas.height=1024;const ctx=atlas.getContext('2d');
 let seed=6817;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 function tile(x,y,w,h,sw,sh,draw){ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.translate(x,y);ctx.scale(w/sw,h/sh);draw(ctx);ctx.restore();}
 function wear(g,x,y,w,h,amount=1){
  for(let i=0;i<w*h*.012*amount;i++){const px=x+random()*w,py=y+random()*h;g.fillStyle=random()<.55?'rgba(22,30,25,.09)':'rgba(229,219,188,.10)';g.fillRect(px,py,random()*3+.4,random()*1.7+.3);}
  for(let i=0;i<w*.025*amount;i++){const px=x+random()*w,py=y+random()*h;g.strokeStyle='rgba(33,37,28,.12)';g.lineWidth=.7;g.beginPath();g.moveTo(px,py);g.lineTo(px+(random()-.5)*3,Math.min(y+h,py+12+random()*35));g.stroke();}
 }
 function frame(g,x,y,w,h,width=12,color='#a7b1a2'){
  g.fillStyle='#2f3935';g.fillRect(x,y,w,h);g.fillStyle=color;
  g.fillRect(x+2,y+2,w-4,width);g.fillRect(x+2,y+h-width-2,w-4,width);g.fillRect(x+2,y+2,width,h-4);g.fillRect(x+w-width-2,y+2,width,h-4);
  g.strokeStyle='rgba(233,229,203,.48)';g.lineWidth=2;g.strokeRect(x+4,y+4,w-8,h-8);
  g.strokeStyle='rgba(24,33,29,.55)';g.strokeRect(x+width,y+width,w-width*2,h-width*2);
 }
 function glass(g,x,y,w,h,curtain){
  const shade=g.createLinearGradient(x,y,x+w,y+h);shade.addColorStop(0,'#354647');shade.addColorStop(.55,'#54666a');shade.addColorStop(1,'#293c3f');g.fillStyle=shade;g.fillRect(x,y,w,h);
  if(curtain){for(let i=0;i<w;i+=4){const fold=.5+.5*Math.sin(i*.14);g.fillStyle=`rgba(166,175,150,${.17+fold*.22})`;g.fillRect(x+i,y+2,4,h-3);}}
  g.fillStyle='rgba(166,193,198,.065)';g.beginPath();g.moveTo(x,y+h*.05);g.lineTo(x+w,y+h*.3);g.lineTo(x+w,y+h*.45);g.lineTo(x,y+h*.2);g.fill();
  g.fillStyle='rgba(10,18,19,.25)';g.fillRect(x,y,w,7);g.fillRect(x,y,4,h);wear(g,x,y,w,h,.35);
 }
 function shutter(g,x,y,w,h,vertical=false,color='#7e8d82'){
  g.fillStyle=color;g.fillRect(x,y,w,h);const span=vertical?w:h;
  for(let p=0;p<span;p+=9){const shade=g.createLinearGradient(vertical?x+p:x,vertical?y:y+p,vertical?x+p+9:x,vertical?y:y+p+9);shade.addColorStop(0,'#a1aa94');shade.addColorStop(.25,color);shade.addColorStop(.78,'#5d6b61');shade.addColorStop(1,'#39473f');g.fillStyle=shade;g.fillRect(vertical?x+p:x,vertical?y:y+p,vertical?8:w,vertical?h:8);}
  wear(g,x,y,w,h);
 }
 function windowPanel(g,x,y,w,h,cols=2,rows=2,blind=false,curtain=false){
  frame(g,x,y,w,h);const gap=10,innerW=w-28,innerH=h-28,cw=(innerW-gap*(cols-1))/cols,ch=(innerH-gap*(rows-1))/rows;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
   const px=x+14+c*(cw+gap),py=y+14+r*(ch+gap);if(blind)shutter(g,px,py,cw,ch);else glass(g,px,py,cw,ch,curtain);
   g.strokeStyle='rgba(216,219,190,.3)';g.lineWidth=2;g.strokeRect(px,py,cw,ch);
  }
  g.fillStyle='#899586';for(let c=1;c<cols;c++)g.fillRect(x+14+c*cw+(c-1)*gap,y+12,gap,h-24);
  for(let r=1;r<rows;r++)g.fillRect(x+12,y+14+r*ch+(r-1)*gap,w-24,gap);
  wear(g,x,y,w,h,.5);
  for(let i=0;i<(w+h)/7;i++){
   const edge=Math.floor(random()*4),long=random(),short=3+random()*8;
   const px=edge<2?x+long*(w-8):x+(edge===2?short:w-short),py=edge<2?y+(edge===0?short:h-short):y+long*(h-8);
   g.fillStyle=random()<.6?'rgba(39,49,34,.38)':'rgba(211,210,180,.55)';g.fillRect(px,py,1+random()*4,1+random()*5);
  }
 }
 tile(0,0,512,256,1024,512,g=>{
  g.fillStyle='#6e807e';g.fillRect(0,0,1024,512);windowPanel(g,128,1,297,510,2,3);windowPanel(g,427,1,295,510,2,1,false,true);shutter(g,443,20,110,100);shutter(g,575,20,125,100);g.fillStyle='#9ba696';g.fillRect(439,119,265,13);windowPanel(g,728,1,295,510,1,1,true);
  g.fillStyle='#b6b9a7';g.fillRect(30,148,42,360);g.fillStyle='#374641';g.fillRect(37,160,25,131);g.fillStyle='#b8baa5';g.fillRect(48,193,6,83);
 });
 tile(512,0,512,512,1024,1024,g=>{
  g.fillStyle='#87938a';g.fillRect(0,0,1024,1024);
  windowPanel(g,10,5,271,112,3,1,true);windowPanel(g,290,5,132,112,1,1,true);windowPanel(g,430,1,295,116,1,1,true);windowPanel(g,736,3,283,113,3,1);
  windowPanel(g,10,126,270,119,2,1,true);windowPanel(g,295,125,116,121,1,2);windowPanel(g,427,128,363,116,1,1,true);
  windowPanel(g,9,260,288,285,3,1,true);windowPanel(g,315,270,280,271,3,1,false,true);windowPanel(g,605,269,181,274,2,3);
  frame(g,809,134,194,399,10,'#b4b6a3');g.fillStyle='#a9ad9c';g.fillRect(823,148,165,370);g.fillStyle='#555d51';g.fillRect(976,337,4,36);
  windowPanel(g,12,572,628,430,1,1,true);windowPanel(g,667,565,350,451,2,1,false,true);shutter(g,684,579,314,58);g.fillStyle='#adb5a4';g.fillRect(681,638,317,10);
 });
 tile(0,256,256,512,512,1024,g=>{
  g.fillStyle='#7b8270';g.fillRect(0,0,512,1024);shutter(g,0,0,512,443,false,'#6c7162');
  g.fillStyle='#b5b3a0';g.fillRect(155,447,357,577);frame(g,158,490,182,282,19,'#b9b6a1');glass(g,184,514,126,232,true);g.fillStyle='#777d6c';g.fillRect(242,508,8,243);
  g.fillStyle='#c0bba6';g.fillRect(353,453,157,306);g.fillStyle='#9b9d8c';g.fillRect(387,455,89,275);g.fillStyle='#747d70';g.fillRect(393,459,76,267);
  glass(g,0,678,149,346,true);g.fillStyle='#555e50';g.fillRect(0,677,149,9);
  for(let y=785;y<1024;y+=83){g.fillStyle='#838b7b';g.fillRect(154,y,185,4);g.fillStyle='rgba(220,215,190,.3)';g.fillRect(154,y+4,185,2);}wear(g,0,0,512,1024);
 });
 tile(256,256,256,256,256,256,g=>{
  g.fillStyle='#a3ab9a';g.fillRect(0,0,256,256);for(let x=0;x<256;x+=64){g.fillStyle='#738b82';g.fillRect(x,0,29,256);}
  for(let i=0;i<256;i+=2){g.fillStyle=i%4?'rgba(255,248,207,.08)':'rgba(24,47,42,.1)';g.fillRect(i,0,1,256);g.fillRect(0,i,256,1);}wear(g,0,0,256,256);
 });
 tile(256,512,256,256,256,256,g=>{
  g.fillStyle='#788374';g.fillRect(0,0,256,256);for(let x=0;x<256;x++){g.fillStyle=`rgba(32,45,32,${random()*.16})`;g.fillRect(x,0,1,256);}for(let y=0;y<256;y+=64){g.fillStyle='#364737';g.fillRect(0,y,256,2);}wear(g,0,0,256,256,3);
 });
 const texture=new THREE.CanvasTexture(atlas);texture.flipY=false;texture.anisotropy=4;texture.needsUpdate=true;
 return texture;
}
function fragment(gradients){
 const sample=(uv,dx,dy)=>gradients?`textureGrad(detailAtlas,${uv},${dx},${dy})`:`texture2D(detailAtlas,${uv})`;
 return `
 if(vDetailStyle>.5&&vDetailStyle<3.5){
  vec2 origin=vDetailStyle<1.5?vec2(0.):vDetailStyle<2.5?vec2(.5,0.):vec2(0.,.25);
  vec2 extent=vDetailStyle<1.5?vec2(.5,.25):vDetailStyle<2.5?vec2(.5):vec2(.25,.5);
  vec2 mapped=origin+vec2(.001)+fract(vDetailUv)*(extent-vec2(.002));
  vec3 detailColor=pow(${sample('mapped','dFdx(vDetailUv)*(extent-vec2(.002))','dFdy(vDetailUv)*(extent-vec2(.002))')}.rgb,vec3(2.2));
  diffuseColor.rgb=detailColor;surfaceHeight=dot(detailColor,vec3(.299,.587,.114));
 }else if(vDetailStyle>3.5&&vDetailStyle<4.5){
  diffuseColor.rgb=detailTint*(.88+.18*surfaceHeight);
 }else if(vDetailStyle>4.5&&vDetailStyle<5.5){
  diffuseColor.rgb=surfaceSample*mix(vec3(1.),detailTint*1.5,.2);
 }else if(vDetailStyle>5.5){
  vec2 origin=vDetailStyle<6.5?vec2(.25,.5):vec2(.25);
  vec3 p=vSurface/(vDetailStyle<6.5?.85:1.6),w=pow(abs(faceNormal),vec3(8.));w/=max(dot(w,vec3(1.)),1e-8);
  vec3 detailColor=pow(${sample('origin+vec2(.001)+fract(p.zy)*.248','dFdx(p.zy)*.248','dFdy(p.zy)*.248')}.rgb,vec3(2.2))*w.x
   +pow(${sample('origin+vec2(.001)+fract(p.xz)*.248','dFdx(p.xz)*.248','dFdy(p.xz)*.248')}.rgb,vec3(2.2))*w.y
   +pow(${sample('origin+vec2(.001)+fract(p.xy)*.248','dFdx(p.xy)*.248','dFdy(p.xy)*.248')}.rgb,vec3(2.2))*w.z;
  diffuseColor.rgb=detailColor*mix(vec3(1.),detailTint*3.,.25);surfaceHeight=dot(detailColor,vec3(.299,.587,.114));
 }
 `;
}
const api={apply,createAtlas,fragment};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MaterialDetails=api;
})(typeof window!=='undefined'?window:globalThis);
