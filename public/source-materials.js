(function(root){
'use strict';
function decode(buffer,geometry,manifest){
 const base=geometry.userData.dust2.meta;if(manifest.geometryHashes.position!==base.positionSHA256||manifest.geometryHashes.index!==base.indexSHA256)throw Error('Source materials do not match map geometry');
 const view=new DataView(buffer),vertices=view.getUint32(4,true),runCount=view.getUint32(8,true),unique=view.getUint32(16,true);
 if(view.getUint32(0,false)!==0x44325331||vertices!==geometry.userData.dust2.meta.vertices||view.getUint32(12,true)!==3||unique>vertices||buffer.byteLength!==20+runCount*12+unique*8+vertices*21)throw Error('Invalid source surface data');
 const materialIds=new Uint16Array(vertices);let end=0;
 for(let i=0;i<runCount;i++){
  const offset=20+i*12,first=view.getUint32(offset,true),count=view.getUint32(offset+4,true),id=view.getUint32(offset+8,true);
  if(first!==end||count===0||first+count>vertices||id>=manifest.materials.length)throw Error('Invalid source material range');
  end=first+count;materialIds.fill(id,first,end);
 }if(end!==vertices)throw Error('Incomplete source materials');
 let offset=20+runCount*12;const total=geometry.attributes.position.count;
 function floats(width,count=vertices,capacity=count){const out=new Float32Array(capacity*width),bits=new Uint32Array(out.buffer);
  for(let axis=0;axis<width;axis++){let previous=0;for(let i=0;i<count;i++){let delta=0;for(let b=0;b<4;b++)delta|=view.getUint8(offset+(axis*4+b)*count+i)<<(b*8);previous=(previous^delta)>>>0;bits[i*width+axis]=previous;}}
  offset+=count*width*4;return out;
 }
 const table=floats(2,unique),references=new Uint32Array(floats(1).buffer),uv=new Float32Array(total*2);
 for(let i=0;i<vertices;i++){const id=references[i];if(id>=unique)throw Error('Invalid source UV reference');uv[i*2]=table[id*2];uv[i*2+1]=table[id*2+1];}
 const normal=new Float32Array(total*3),codes=new Int8Array(buffer,offset,vertices*3);offset+=vertices*3;
 const THREE=root.THREE||require('three'),matrices=geometry.userData.dust2.meta.transforms.map(t=>new THREE.Matrix3().getNormalMatrix(new THREE.Matrix4().fromArray(t.matrix))),point=new THREE.Vector3();
 for(let i=0;i<vertices;i++){const id=view.getUint16(offset+i*2,true);if(id>=matrices.length)throw Error('Invalid normal transform');point.set(Math.fround(Math.max(-1,codes[i*3]/127)),Math.fround(Math.max(-1,codes[i*3+1]/127)),Math.fround(Math.max(-1,codes[i*3+2]/127))).applyNormalMatrix(matrices[id]);point.toArray(normal,i*3);}
 offset+=vertices*2;
 const color=floats(3,vertices,total);
 for(const [name,values,width]of [['uv',uv,2],['normal',normal,3],['color',color,3]]){const old=geometry.attributes[name];for(let i=vertices;i<total;i++)for(let axis=0;axis<width;axis++)values[i*width+axis]=old.array[i*width+axis]/(old.normalized?255:1);}
 return {materialIds,uv,normal,color};
}
function layout(THREE,geometry,data,manifest){
 const meta=geometry.userData.dust2.meta,vertices=geometry.attributes.position.count,index=geometry.index.array,recipes=[],keys=new Map(),groups=[];
 for(const group of meta.groups){
  let start=group.start,last=-1;
  for(let i=group.start;i<group.start+group.count;i+=3){
   const id=index[i]<data.materialIds.length?data.materialIds[index[i]]:-1;
   for(let j=1;j<3;j++)if((index[i+j]<data.materialIds.length?data.materialIds[index[i+j]]:-1)!==id)throw Error('Mixed source material on one triangle');
   const info=id<0||!manifest?null:manifest.materials[id];
   const key=group.materialIndex+':'+(info?JSON.stringify([info.albedo,info.normal,info.orm,info.roughness,info.metalness,info.roughnessMean,info.metalnessMean,info.normalScale]):id);
   if(!keys.has(key)){keys.set(key,recipes.length);recipes.push({surface:group.materialIndex,source:id,bakedColor:!!manifest});}
   const materialIndex=keys.get(key);
   if(last!==materialIndex){if(last!==-1)groups.push({chunk:group.chunk,start,count:i-start,materialIndex:last});start=i;last=materialIndex;}
  }
  if(last!==-1)groups.push({chunk:group.chunk,start,count:group.start+group.count-start,materialIndex:last});
 }
 const render=new THREE.BufferGeometry();
 for(const [name,attribute]of Object.entries(geometry.attributes))render.setAttribute(name,attribute);
 for(const [name,width]of [['uv',2],['normal',3],['color',3]])render.setAttribute(name,new THREE.BufferAttribute(data[name],width));
 if(manifest){
  const color=new Float32Array(data.color);for(let i=0;i<data.materialIds.length;i++){const m=manifest.materials[data.materialIds[i]],factor=m.color;for(let c=0;c<3;c++)color[i*3+c]=(m.vertexColor===false?1:color[i*3+c])*factor[c];}
  render.setAttribute('color',new THREE.BufferAttribute(color,3));
 }
 const buckets=new Map();for(const group of groups){const key=group.chunk+':'+group.materialIndex;if(!buckets.has(key))buckets.set(key,{...group,count:0,ranges:[]});const bucket=buckets.get(key);bucket.count+=group.count;bucket.ranges.push([group.start,group.count]);}
 const renderIndices=new Uint32Array(index.length),batched=[],sourceRanges=[];let cursor=0;
 for(const bucket of buckets.values()){
  batched.push({chunk:bucket.chunk,materialIndex:bucket.materialIndex,start:cursor,count:bucket.count});
  for(const [start,count]of bucket.ranges){renderIndices.set(index.subarray(start,start+count),cursor);sourceRanges.push({source:start,target:cursor,count});cursor+=count;}
 }
 render.setIndex(new THREE.BufferAttribute(renderIndices,1));render.userData.dust2={...geometry.userData.dust2,meta:{...meta,groups:batched}};
 return {geometry:render,recipes,sourceRanges};
}
async function create({THREE,geometry,manifest,buffer,opacity,lighting,registerTexture,detail,progress,isWebGL2,compact=true}){
 const data=decode(buffer,geometry,manifest),useArrays=isWebGL2&&!!root.SourceMaterialArrays,result=useArrays?null:layout(THREE,geometry,data,manifest),cache=new Map(),files=new Map(manifest.files.map(f=>[f.name,f])),alphaCache=new Map();
 const wrapping={10497:THREE.RepeatWrapping,33071:THREE.ClampToEdgeWrapping,33648:THREE.MirroredRepeatWrapping};
 const load=async ref=>{
  if(!ref)return null;const info=manifest.textures[ref.key],key=info.file+':'+ref.wrapS+':'+ref.wrapT;
  if(!cache.has(key))cache.set(key,(async()=>{const file=files.get(info.file),url='/maps/'+file.name+'?v='+file.sha256.slice(0,12);let texture;
   if(useArrays&&typeof root.createImageBitmap==='function'){
    try{const response=await fetch(url);if(!response.ok)throw Error('Texture unavailable: '+info.file);texture=new THREE.Texture(await root.createImageBitmap(await response.blob()));}catch{texture=await new THREE.TextureLoader().loadAsync(url);}
   }else texture=await new THREE.TextureLoader().loadAsync(url);
   texture.flipY=false;texture.encoding=info.kind==='color'?THREE.sRGBEncoding:THREE.LinearEncoding;texture.wrapS=wrapping[ref.wrapS];texture.wrapT=wrapping[ref.wrapT];
   texture.generateMipmaps=true;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;if(!useArrays)registerTexture(texture);progress?.(++done,unique.length);return texture;
  })());return cache.get(key);
 };
 const refs=[];for(const m of manifest.materials){refs.push(m.albedo);if(detail)refs.push(m.normal,m.orm);}
 const unique=[...new Map(refs.filter(Boolean).map(r=>[JSON.stringify(r),r])).values()];let cursor=0,done=0;
 if(!useArrays)await Promise.all(Array.from({length:4},async()=>{while(cursor<unique.length)await load(unique[cursor++]);}));
 const release=ref=>cache.delete(manifest.textures[ref.key].file+':'+ref.wrapS+':'+ref.wrapT);
 function alpha(surface){
  const key=surface.mask+':'+surface.wrapS+':'+surface.wrapT;if(alphaCache.has(key))return alphaCache.get(key);
  const tile=geometry.userData.dust2.meta.opacity.tiles[surface.mask],bytes=opacity.subarray(tile.offset,tile.offset+tile.width*tile.height);
  // AlphaTest continues to read the exact original pixels, independent of the
  // resized albedo. One-channel storage uses red on WebGL 2 and luminance on WebGL 1.
  const texture=new THREE.DataTexture(bytes,tile.width,tile.height,isWebGL2?THREE.RedFormat:THREE.LuminanceFormat);
  texture.flipY=false;texture.wrapS=wrapping[surface.wrapS];texture.wrapT=wrapping[surface.wrapT];texture.magFilter=texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
  alphaCache.set(key,texture);return texture;
 }
 if(useArrays)return root.SourceMaterialArrays.create({THREE,geometry,data,manifest,load,registerTexture,detail,lighting,alpha,release,compact});
 const materials=[];
 for(const {surface:surfaceId,source,bakedColor}of result.recipes){
  const surface=geometry.userData.dust2.meta.materials[surfaceId],m=source<0?{color:[1,1,1],roughness:1,metalness:0}:manifest.materials[source];
  const material=new THREE.MeshStandardMaterial({vertexColors:true,color:new THREE.Color().fromArray(bakedColor?[1,1,1]:m.color),roughness:detail&&m.orm?m.roughness:(m.roughnessMean??m.roughness),metalness:detail&&m.orm?m.metalness:(m.metalnessMean??m.metalness),
   side:surface.collidable||surface.doubleSided?THREE.DoubleSide:THREE.FrontSide,transparent:surface.overlay,depthWrite:!surface.overlay,visible:surface.visible,
   polygonOffset:surface.bias,polygonOffsetFactor:-(surface.depthLayer||1),polygonOffsetUnits:-2*(surface.depthLayer||1)});
  material.map=await load(m.albedo);
  if(detail){material.normalMap=await load(m.normal);material.normalScale.set(m.normalScale??1,m.normalScale??1);material.roughnessMap=material.metalnessMap=await load(m.orm);}
  if(surface.mask>=0){material.alphaMap=alpha(surface);material.alphaTest=surface.overlay?.02:surface.cutoff;}
  material.userData.roughSky=surface.type!==3&&surface.type!==6;lighting(material,source<0);materials.push(material);
 }
 return {...result,materials,textureCount:cache.size};
}
const api={decode,layout,create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SourceMaterials=api;
})(typeof window!=='undefined'?window:globalThis);
