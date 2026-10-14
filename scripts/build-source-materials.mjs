import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import sharp from 'sharp';
const digest=b=>createHash('sha256').update(b).digest('hex');
export function resolutionFor(name){
 if(/overlay_sign|signage|(?:^|_)sign(?:_|[0-9])|dust_windows|kasbah_windows|door_(46|80)|door_arch/.test(name)&&!/bracket/.test(name))return 1024;
 if(/debris|garbage|rubble|bottle|can_|cable|wire|small|satellite|antenna|electric|access_panel|hanging_light|street_lamp|lantern|pottery|terracotta|bicycle|chair|rope|wheel|propane|basket|weeds|trash_bag|soccerball|sacks|shelf|insulator|pole|bracket/.test(name))return 256;
 return 512;
}
export async function buildSourceMaterials({gltf,source,output,ids,uvs,normals,colors,groups,floatBytes,normalCodes,normalIds,geometryHashes}){
 let previous;try{previous=JSON.parse(await fs.readFile(path.join(output,'dust2-source-materials.json')));}catch{}
 const ormMeans=new Map();
 async function meanOrm(info){if(!info)return [1,1];const tex=gltf.textures[info.index],image=tex.extensions?.EXT_texture_webp?.source??tex.source;if(!ormMeans.has(image)){const stats=await sharp(path.join(source,gltf.images[image].uri)).stats();ormMeans.set(image,[stats.channels[1].mean/255,stats.channels[2].mean/255]);}return ormMeans.get(image);}
 const requests=new Map(),materials=[],keys=new Map(),mapIds=new Map();
 const ref=(info,kind,size)=>{
  if(!info)return null;
  if((info.texCoord||0)!==0||info.extensions?.KHR_texture_transform)throw Error('Unimplemented texture coordinate transform');
  const tex=gltf.textures[info.index],image=tex.extensions?.EXT_texture_webp?.source??tex.source;
  const key=kind+':'+image,sampler=gltf.samplers?.[tex.sampler]||{};
  if(!requests.has(key))requests.set(key,{kind,image,size,names:[]});requests.get(key).size=Math.max(requests.get(key).size,size);
  return {key,wrapS:sampler.wrapS||10497,wrapT:sampler.wrapT||10497};
 };
 for(const sourceId of new Set(ids)){
  const m=gltf.materials[sourceId],p=m.pbrMetallicRoughness||{},name=m.name||'',size=resolutionFor(name);
  const normalUseful=/plaster|stucco|stone|brick|ground|road|wood|door|crate|window|fabric|tarp|metal|barrel/.test(name)&&!/foliage|leaf|grass|overlay|_bars|insets/.test(name);
  const mean=await meanOrm(p.metallicRoughnessTexture);
  // Foliage vertex RGB encodes wind controls, including fabric using that shader.
  const surface={vertexColor:m.extras?.vmat?.ShaderName!=='csgo_foliage.vfx',roughnessMean:(p.roughnessFactor??1)*mean[0],metalnessMean:(p.metallicFactor??1)*mean[1],color:p.baseColorFactor?.slice(0,3)||[1,1,1],roughness:p.roughnessFactor??1,metalness:p.metallicFactor??1,
   albedo:ref(p.baseColorTexture,'color',size),normal:normalUseful?ref(m.normalTexture,'normal',256):null,
   orm:normalUseful?ref(p.metallicRoughnessTexture,'orm',256):null,normalScale:m.normalTexture?.scale??1};
  const key=JSON.stringify(surface);
  if(!keys.has(key)){keys.set(key,materials.length);materials.push({...surface,names:[]});}
  const id=keys.get(key);materials[id].names.push(name);mapIds.set(sourceId,id);
 }
 await fs.mkdir(path.join(output,'source'),{recursive:true});
 const files=[],textures={};
 for(const [key,request]of requests){
  const input=await fs.readFile(path.join(source,gltf.images[request.image].uri)),image=sharp(input),meta=await image.metadata();
  const size=Math.min(request.size,Math.max(meta.width,meta.height));
  const old=previous?.textures[key];
  let imageOut;if(previous?.encodingVersion===2&&old&&old.sourceSHA256===digest(input)&&Math.max(old.width,old.height)===size){try{imageOut=await fs.readFile(path.join(output,old.file));}catch{}}
  imageOut=imageOut||await image.resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).removeAlpha().webp({quality:request.kind==='color'?82:request.kind==='normal'?88:82,effort:6}).toBuffer();
  const hash=digest(imageOut),name='source/'+request.kind+'-'+hash.slice(0,16)+'.webp';
  if(!files.some(f=>f.name===name)){await fs.writeFile(path.join(output,name),imageOut);files.push({name,bytes:imageOut.length,sha256:hash,kind:request.kind});}
  const result=await sharp(imageOut).metadata();
  textures[key]={file:name,width:result.width,height:result.height,sourceImage:gltf.images[request.image].uri,sourceSHA256:digest(input),kind:request.kind};
 }
 const runs=[];for(let i=0;i<ids.length;){const material=mapIds.get(ids[i]);let end=i+1;while(end<ids.length&&mapIds.get(ids[end])===material)end++;runs.push(i,end-i,material);i=end;}
 const uvBits=new Uint32Array(uvs.buffer),dictionary=new Map(),uvTable=[],uvReferences=new Uint32Array(ids.length);
 for(let i=0;i<ids.length;i++){
  const key=uvBits[i*2]+':'+uvBits[i*2+1];let id=dictionary.get(key);
  if(id===undefined){id=dictionary.size;dictionary.set(key,id);uvTable.push(uvBits[i*2],uvBits[i*2+1]);}uvReferences[i]=id;
 }
 const uvWords=new Uint32Array(uvTable),header=Buffer.alloc(20);header.write('D2S1');header.writeUInt32LE(ids.length,4);header.writeUInt32LE(runs.length/3,8);header.writeUInt32LE(3,12);header.writeUInt32LE(dictionary.size,16);
 const raw=Buffer.concat([header,Buffer.from(new Uint32Array(runs).buffer),floatBytes(new Float32Array(uvWords.buffer),2),floatBytes(new Float32Array(uvReferences.buffer),1),Buffer.from(normalCodes.buffer),Buffer.from(normalIds.buffer),floatBytes(colors,3)]),packed=gzipSync(raw,{level:9});
 const name='dust2-source-surfaces.gz';await fs.writeFile(path.join(output,name),packed);files.push({name,bytes:packed.length,raw:raw.length,sha256:digest(packed),kind:'mapping'});
 const meta={version:1,encodingVersion:2,geometryHashes,materials,textures,files,uvSHA256:digest(Buffer.from(uvs.buffer)),normalSHA256:digest(Buffer.from(normals.buffer)),colorSHA256:digest(Buffer.from(colors.buffer)),mappingSHA256:digest(raw),policy:{colorDefault:512,important:1024,small:256,normal:256,orm:256,alpha:'existing full-resolution mask, unchanged',colorSpace:'sRGB albedo; linear normal and ORM; glTF normal +Y; ORM G roughness B metalness'},variants:{color:{textures:files.filter(f=>f.kind==='color').reduce((n,f)=>n+f.bytes,0)},detail:{textures:files.filter(f=>['color','normal','orm'].includes(f.kind)).reduce((n,f)=>n+f.bytes,0)}}};
 await fs.writeFile(path.join(output,'dust2-source-materials.json'),JSON.stringify(meta)+'\n');
 console.log('Source materials',JSON.stringify({uniqueMaterials:materials.length,uniqueTextures:files.length-1,mappingMiB:packed.length/1048576,variants:meta.variants}));return meta;
}
