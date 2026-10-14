'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p)),gzip=p=>zlib.gzipSync(read(p)).length;
const map=JSON.parse(read('public/maps/dust2.json')),source=JSON.parse(read('public/maps/dust2-source-materials.json')),actors=JSON.parse(read('public/game/assets.json'));
const coreNames=['dust2.mesh.gz','dust2-opacity.gz','dust2-radar.webp','dust2-lighting.json.gz','dust2-source-surfaces.gz'];
const core=Object.fromEntries(coreNames.map(name=>[name,map.files.find(f=>f.name===name).bytes]));
const metadata=gzip('public/maps/dust2.json')+gzip('public/maps/dust2-source-materials.json');
const decoder=gzip('public/source-materials.js')+gzip('public/source-material-arrays.js');
const arrays=require('../public/source-material-arrays'),sizes=[[256,256],[512,512],[512,256],[1024,1024],[1024,512]];
const variants={};for(const mode of ['color','detail']){
 const tex=source.files.filter(f=>f.kind==='color'||(mode==='detail'&&['normal','orm'].includes(f.kind)));
 const gpuFiles=new Map();for(const t of Object.values(source.textures))if(mode==='detail'||t.kind==='color')gpuFiles.set(t.file,t);
 const textures=tex.reduce((n,f)=>n+f.bytes,0),bytes=Object.values(core).reduce((a,b)=>a+b,0)+metadata+decoder+textures;
 const buckets=sizes.map(()=>new Set()),normals=new Set(),orms=new Set();
 for(const t of gpuFiles.values()){if(t.kind==='color')buckets[arrays.colorBucket(t.width,t.height).group].add(t.file);else if(t.kind==='normal')normals.add(t.file);else orms.add(t.file);}
 const arrayBytes=buckets.reduce((n,b,i)=>n+sizes[i][0]*sizes[i][1]*4*4/3*(b.size+1),0)+(mode==='detail'?(normals.size+orms.size+2)*256*256*4*4/3:0);
 const colorArrayBytes=buckets.reduce((n,b,i)=>n+sizes[i][0]*sizes[i][1]*4*4/3*(b.size+1),0);
 variants[mode]={arrayCompactMipEstimateMiB:(arrayBytes-colorArrayBytes/2)/1048576,arrayRGBAMipEstimateMiB:arrayBytes/1048576,bytes,MiB:bytes/1048576,textures,textureFiles:tex.length,decodedRGBAMipEstimateMiB:[...gpuFiles.values()].reduce((n,t)=>n+t.width*t.height*4*4/3,0)/1048576};
}
const actorCategories={charactersAndArms:0,weaponsAndC4:0,audio:0,manifest:gzip('public/game/assets.json')};for(const f of actors.files){const model=f.name.endsWith('.glb'),character=['ct.glb','t.glb','arms.glb','player-animations.glb'].includes(f.name);actorCategories[model?(character?'charactersAndArms':'weaponsAndC4'):'audio']+=model?gzip('public/game/'+f.name):f.bytes;}
const scripts=[...read('public/index.html').toString().matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);const aliases={'/three.min.js':'node_modules/three/build/three.min.js','/bvh.js':require.resolve('three-mesh-bvh'),'/gltf-loader.js':'node_modules/three/examples/js/loaders/GLTFLoader.js','/skeleton-utils.js':'node_modules/three/examples/js/utils/SkeletonUtils.js'};
let runtime=gzip('public/index.html');for(const url of scripts){if(['/source-materials.js','/source-material-arrays.js'].includes(url))continue;let file=aliases[url]||((/dust2-(mesh|world|data)|\/sim.js/.test(url)?'shared':'public')+url);const b=fs.readFileSync(path.isAbsolute(file)?file:path.join(root,file));runtime+=zlib.gzipSync(b).length;}
const actorTotal=Object.values(actorCategories).reduce((a,b)=>a+b,0),report={core,metadata,additionalDecoderBytes:decoder,additionalDecoderWasmBytes:0,variants,actors:{...actorCategories,totalBytes:actorTotal,MiB:actorTotal/1048576},sharedRuntime:{bytes:runtime,MiB:runtime/1048576},firstVisitTotalMiB:Object.fromEntries(Object.entries(variants).map(([k,v])=>[k,(v.bytes+actorTotal+runtime)/1048576])),notes:['HTTP body bytes with gzip for scripts, HTML, JSON, mesh and GLB. Header overhead excluded.','Includes all source texture files, even if a particular fixed view does not use them.','No original source texture library or development compression tools are served.','RGBA mip memory is a conservative estimate, not a physical-phone memory measurement; geometry, alpha masks, render targets and browser image copies are additional.']};
console.log(JSON.stringify(report,null,2));
