import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createRequire } from 'node:module';
const { files: audioFiles } = createRequire(import.meta.url)('../public/game-audio.js');
const root=fileURLToPath(new URL('../',import.meta.url)),source=root+'.cache/game-source/assets/',output=root+'public/game/';
await fs.mkdir(output,{recursive:true});
function unpack(bytes){const length=bytes.readUInt32LE(12);return {g:JSON.parse(bytes.toString('utf8',20,20+length)),bin:bytes.subarray(28+length)};}
function pack(g,bin){const text=Buffer.from(JSON.stringify(g)),j=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(j);const b=Buffer.alloc(Math.ceil(bin.length/4)*4);bin.copy(b);const out=Buffer.alloc(28+j.length+b.length);out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(j.length,12);out.writeUInt32LE(0x4e4f534a,16);j.copy(out,20);out.writeUInt32LE(b.length,20+j.length);out.writeUInt32LE(0x004e4942,24+j.length);b.copy(out,28+j.length);return out;}
async function convert(input,name,clipFilter){
 const {g,bin}=unpack(await fs.readFile(source+input));
 if(clipFilter)g.animations=g.animations.filter(a=>clipFilter(a.name));
 const used=new Set();for(const m of g.meshes||[])for(const p of m.primitives){for(const a of Object.values(p.attributes))used.add(a);if(p.indices!==undefined)used.add(p.indices);for(const target of p.targets||[])for(const a of Object.values(target))used.add(a);}
 for(const skin of g.skins||[])if(skin.inverseBindMatrices!==undefined)used.add(skin.inverseBindMatrices);
 for(const animation of g.animations||[])for(const sampler of animation.samplers){used.add(sampler.input);used.add(sampler.output);}
 const accessorMap=new Map([...used].map((v,i)=>[v,i]));
 for(const m of g.meshes||[])for(const p of m.primitives){for(const key of Object.keys(p.attributes))p.attributes[key]=accessorMap.get(p.attributes[key]);if(p.indices!==undefined)p.indices=accessorMap.get(p.indices);for(const target of p.targets||[])for(const key of Object.keys(target))target[key]=accessorMap.get(target[key]);}
 for(const skin of g.skins||[])if(skin.inverseBindMatrices!==undefined)skin.inverseBindMatrices=accessorMap.get(skin.inverseBindMatrices);
 for(const animation of g.animations||[])for(const sampler of animation.samplers){sampler.input=accessorMap.get(sampler.input);sampler.output=accessorMap.get(sampler.output);}
 g.accessors=[...used].map(i=>g.accessors[i]);
 const viewMap=new Map(),parts=[],views=[];let offset=0;
 function append(bytes,original={}){const padded=Buffer.alloc(Math.ceil(bytes.length/4)*4);bytes.copy(padded);const id=views.length;views.push({...original,buffer:0,byteOffset:offset,byteLength:bytes.length});parts.push(padded);offset+=padded.length;return id;}
 for(const accessor of g.accessors){if(accessor.sparse)throw Error('Sparse accessor needs preserving');const id=accessor.bufferView;if(!viewMap.has(id)){const view=g.bufferViews[id];viewMap.set(id,append(bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength),view));}accessor.bufferView=viewMap.get(id);}
 for(const image of g.images||[]){const v=g.bufferViews[image.bufferView];const bytes=await sharp(bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength)).resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).webp({quality:86,effort:5}).toBuffer();image.bufferView=append(bytes);image.mimeType='image/webp';}
 if(g.images?.length){g.extensionsUsed=[...new Set([...(g.extensionsUsed||[]),'EXT_texture_webp'])];g.extensionsRequired=[...new Set([...(g.extensionsRequired||[]),'EXT_texture_webp'])];for(const t of g.textures||[]){t.extensions={...(t.extensions||{}),EXT_texture_webp:{source:t.source}};delete t.source;}}
 g.bufferViews=views;g.buffers=[{byteLength:offset}];g.asset.extras={...(g.asset.extras||{}),textureSizeLimit:512,geometryPreserved:true};
 await fs.writeFile(output+name,pack(g,Buffer.concat(parts)));console.log(name,offset);
}
const weapons={ak47:'ak47-vulcan',awp:'awp-dragon-lore',m4a4:'m4a4-howl',galil:'galilar-sugar-rush',deagle:'deagle-printstream',glock:'pistol-fade',usp:'usp-kill-confirmed',knife:'karambit-sapphire'};
for(const [id,file]of Object.entries(weapons))await convert('weapons/cs2-loadout/'+file+'.glb',id+'.glb');
await convert('weapons/cs2-utility/c4.glb','c4.glb');
await convert('characters-cs2/ct-sas.glb','ct.glb');await convert('characters-cs2/t-phoenix.glb','t.glb');await convert('viewmodel/arms.glb','arms.glb');
await convert('characters-cs2/animations.glb','player-animations.glb',n=>n==='death'||/^(rifle|pistol|knife)\//.test(n));
await convert('viewmodel/animations.glb','weapon-animations.glb',n=>/^(ak47|awp|knife|m4a4|galilar|deagle|pistol|usp|c4)\//.test(n)&&!n.endsWith('/inspect'));
const soundNames=['ak47_01','ak47_02','awp_01','m4a1_01','galil_01','glock_02','usp_01','deagle_01','ak47_clipout_01','ak47_boltpull_01','m4a1_clipout','m4a1_clipin','glock_clipout','glock_clipin','usp_clipout_01','usp_clipin_02','awp_clipout','awp_clipin','awp_boltforward','de_clipout','knife_swish_light_01','knife_hit_01','headshot_armor_e1','kevlar_01','weapons_c4_c4_beep2','weapons_c4_c4_explode_close_01','vo_announcer_cs2_classic_ctwin','vo_announcer_cs2_classic_terwin','vo_announcer_cs2_classic_bombpl','vo_announcer_cs2_classic_bombdef'];
for(const name of soundNames)await fs.copyFile(source+'audio/cs2/'+name+'.mp3',output+name+'.mp3');
for(let i=0;i<5;i++){const name='footstep_concrete_00'+i+'.ogg';await fs.copyFile(source+'audio/'+name,output+name);}
for(const file of audioFiles)await fs.copyFile(source+file.source,output+file.name);
const files=[];for(const name of await fs.readdir(output)){if(name==='assets.json')continue;const b=await fs.readFile(output+name);files.push({name,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
await fs.writeFile(output+'assets.json',JSON.stringify({source:'Valve CS2 assets; see ASSETS.md',weapons:Object.keys(weapons).concat('c4','famas'),files},null,2)+'\n');console.log('Total MiB',files.reduce((n,f)=>n+f.bytes,0)/1048576);
