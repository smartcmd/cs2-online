(function(root){
'use strict';
// Separate layers keep mipmaps isolated; repeating within each layer preserves source UV periods.
const sizes=[[256,256],[512,512],[512,256],[1024,1024],[1024,512]];
function colorBucket(width,height){const rotate=width<height,w=Math.max(width,height),h=Math.min(width,height);return {group:w<=256?0:w<=512?(h<=256?2:1):(h<=512?4:3),rotate};}
// Alpha remains in its exact independent mask. Only albedo colour precision is reduced.
function pack565(rgba,out=new Uint16Array(rgba.length/4),offset=0){
 for(let i=0;i<rgba.length;i+=4)out[offset+i/4]=(Math.round(rgba[i]*31/255)<<11)|(Math.round(rgba[i+1]*63/255)<<5)|Math.round(rgba[i+2]*31/255);
 return out;
}
function layout(THREE,geometry,data,manifest){
 const render=new THREE.BufferGeometry();for(const [name,attribute]of Object.entries(geometry.attributes))render.setAttribute(name,attribute);
 render.setIndex(geometry.index);render.userData.dust2=geometry.userData.dust2;
 for(const [name,width]of [['uv',2],['normal',3]])render.setAttribute(name,new THREE.BufferAttribute(data[name],width));
 const colors=new Float32Array(data.color),ids=new Uint16Array(geometry.attributes.position.count);ids.fill(manifest.materials.length);ids.set(data.materialIds);
 for(let i=0;i<data.materialIds.length;i++){const m=manifest.materials[data.materialIds[i]],c=m.color;for(let k=0;k<3;k++)colors[i*3+k]=(m.vertexColor===false?1:colors[i*3+k])*c[k];}
 render.setAttribute('color',new THREE.BufferAttribute(colors,3));render.setAttribute('sourceMaterial',new THREE.BufferAttribute(ids,1));
 return render;
}
async function create({THREE,geometry,data,manifest,load,registerTexture,detail,lighting,alpha,release=()=>{},compact=true}){
 const groups=sizes.map(([width,height])=>({width,height,files:[],ids:new Map()}));
 const normal={width:256,height:256,files:[],ids:new Map()},orm={width:256,height:256,files:[],ids:new Map()};
 function reserve(ref,kind){
  if(!ref)return {layer:0,group:0,sx:1,sy:1};
  const info=manifest.textures[ref.key],choice=kind==='color'?colorBucket(info.width,info.height):{group:0,rotate:false};
  const bucket=kind==='color'?groups[choice.group]:kind==='normal'?normal:orm;
  if(!bucket.ids.has(info.file)){bucket.ids.set(info.file,bucket.files.length+1);bucket.files.push({info,ref,rotate:choice.rotate});}
  const w=choice.rotate?info.height:info.width,h=choice.rotate?info.width:info.height;
  return {layer:bucket.ids.get(info.file),group:choice.group,sx:w/bucket.width*(choice.rotate?-1:1),sy:h/bucket.height};
 }
 const params=new Float32Array((manifest.materials.length+1)*16);
 for(let i=0;i<=manifest.materials.length;i++){
  const m=manifest.materials[i]||{roughness:1,metalness:0},c=reserve(m.albedo,'color'),n=reserve(detail?m.normal:null,'normal'),o=reserve(detail?m.orm:null,'orm');
  params.set([c.layer,c.group,c.sx,c.sy,n.layer,n.sx,n.sy,m.normalScale??1,o.layer,o.sx,o.sy,0,detail&&m.orm?m.roughness:(m.roughnessMean??m.roughness),detail&&m.orm?m.metalness:(m.metalnessMean??m.metalness),0,0],i*16);
 }
 async function texture(bucket,kind){
  const {width,height}=bucket,layers=bucket.files.length+1,packed=compact&&kind==='color';
  const pixels=packed?new Uint16Array(width*height*layers):new Uint8Array(width*height*layers*4);pixels.fill(packed?65535:255,0,width*height*(packed?1:4));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  for(let first=0;first<bucket.files.length;first+=4){
   const batch=bucket.files.slice(first,first+4),sources=await Promise.all(batch.map(f=>load(f.ref)));
   for(let j=0;j<batch.length;j++){
    const i=first+j,f=batch[j],src=sources[j],w=f.rotate?f.info.height:f.info.width,h=f.rotate?f.info.width:f.info.height;
    ctx.clearRect(0,0,width,height);
    for(let y=0;y<height;y+=h)for(let x=0;x<width;x+=w){ctx.save();ctx.translate(x,y);if(f.rotate){ctx.translate(w,0);ctx.rotate(Math.PI/2);}ctx.drawImage(src.image,0,0);ctx.restore();}
    const rgba=ctx.getImageData(0,0,width,height).data;
    if(packed)pack565(rgba,pixels,(i+1)*width*height);else pixels.set(rgba,(i+1)*width*height*4);
    src.image.close?.();release(f.ref);
   }
  }
  const t=new THREE.DataTexture2DArray(pixels,width,height,layers);
  if(packed){t.format=THREE.RGBFormat;t.type=THREE.UnsignedShort565Type;t.internalFormat='RGB565';}
  t.encoding=THREE.LinearEncoding;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;registerTexture(t);return t;
 }
 const colorMaps=[];for(const bucket of groups)colorMaps.push(await texture(bucket,'color'));
 const normalMap=detail?await texture(normal,'normal'):null,ormMap=detail?await texture(orm,'orm'):null;
 const infoMap=new THREE.DataTexture(params,4,manifest.materials.length+1,THREE.RGBAFormat,THREE.FloatType);infoMap.needsUpdate=true;
 const dummy=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);dummy.needsUpdate=true;
 const render=layout(THREE,geometry,data,manifest);
 const materials=geometry.userData.dust2.meta.materials.map(surface=>{
  const material=new THREE.MeshStandardMaterial({map:dummy,normalMap:detail?dummy:null,vertexColors:true,roughness:1,metalness:1,
   side:surface.collidable||surface.doubleSided?THREE.DoubleSide:THREE.FrontSide,transparent:surface.overlay,depthWrite:!surface.overlay,visible:surface.visible,
   polygonOffset:surface.bias,polygonOffsetFactor:-(surface.depthLayer||1),polygonOffsetUnits:-2*(surface.depthLayer||1)});
  if(surface.mask>=0){material.alphaMap=alpha(surface);material.alphaTest=surface.overlay?.02:surface.cutoff;}
  material.userData.sourceArrays=true;
  material.onBeforeCompile=shader=>{
   Object.assign(shader.uniforms,{sourceInfo:{value:infoMap},sourceRows:{value:manifest.materials.length+1},sourceNormals:{value:normalMap},sourceORM:{value:ormMap}});
   for(let i=0;i<5;i++)shader.uniforms['sourceColor'+i]={value:colorMaps[i]};
   const varying='varying vec4 vSourceColorInfo,vSourceNormalInfo,vSourceORMInfo,vSourcePBR;\n';
   shader.vertexShader='attribute float sourceMaterial;uniform sampler2D sourceInfo;uniform float sourceRows;\n'+varying+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
     float row=(sourceMaterial+.5)/sourceRows;
     vSourceColorInfo=texture2D(sourceInfo,vec2(.125,row));vSourceNormalInfo=texture2D(sourceInfo,vec2(.375,row));
     vSourceORMInfo=texture2D(sourceInfo,vec2(.625,row));vSourcePBR=texture2D(sourceInfo,vec2(.875,row));`);
   shader.fragmentShader=varying+`uniform highp sampler2DArray sourceColor0,sourceColor1,sourceColor2,sourceColor3,sourceColor4,sourceNormals,sourceORM;
     vec3 sourceColorSample(vec2 uv){
       vec4 p=vSourceColorInfo;vec2 q=(p.z<0.?vec2(1.-uv.y,uv.x):uv)*abs(p.zw);vec3 at=vec3(q,p.x);vec2 dx=dFdx(q),dy=dFdy(q);
       if(p.y<.5)return textureGrad(sourceColor0,at,dx,dy).rgb;
       if(p.y<1.5)return textureGrad(sourceColor1,at,dx,dy).rgb;
       if(p.y<2.5)return textureGrad(sourceColor2,at,dx,dy).rgb;
       if(p.y<3.5)return textureGrad(sourceColor3,at,dx,dy).rgb;
       return textureGrad(sourceColor4,at,dx,dy).rgb;
     }
     `+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','diffuseColor.rgb *= sRGBToLinear(vec4(sourceColorSample(vUv),1.)).rgb;');
   shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`vec3 sourcePacked=${detail?'texture(sourceORM,vec3(vUv*vSourceORMInfo.yz,vSourceORMInfo.x)).rgb':'vec3(1.)'};float roughnessFactor=vSourcePBR.x*sourcePacked.g;`);
   shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>','float metalnessFactor=vSourcePBR.y*sourcePacked.b;');
   if(detail)shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`if(vSourceNormalInfo.x>.5){
     vec3 mapN=texture(sourceNormals,vec3(vUv*abs(vSourceNormalInfo.yz),vSourceNormalInfo.x)).xyz*2.-1.;mapN.xy*=vSourceNormalInfo.w*surfaceDetail;
     normal=perturbNormal2Arb(-vViewPosition,normal,mapN,faceDirection);
   }`);
  };
  lighting(material);return material;
 });
 return {geometry:render,materials,textureCount:5+(detail?2:0),backend:'arrays',textures:[...colorMaps,normalMap,ormMap,infoMap,dummy].filter(Boolean)};
}
const api={create,colorBucket,layout,pack565};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SourceMaterialArrays=api;
})(typeof window!=='undefined'?window:globalThis);
