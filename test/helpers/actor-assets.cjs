'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),THREE=require('three');
global.THREE=THREE;global.self=global;
require('three/examples/js/loaders/GLTFLoader');
require('three/examples/js/utils/SkeletonUtils');

// Keep the actual skeletons, meshes, and animation tracks. Removing image
// references lets the real GLTFLoader exercise animation without a DOM decoder.
async function load(name){
 const bytes=fs.readFileSync(path.join(__dirname,'../../public/game',name+'.glb'));
 const length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.toString('utf8',20,20+length)),binary=bytes.subarray(28+length);
 delete gltf.images;delete gltf.textures;delete gltf.materials;
 gltf.extensionsRequired=[];gltf.extensionsUsed=[];
 for(const mesh of gltf.meshes||[])for(const primitive of mesh.primitives)delete primitive.material;
 const json=Buffer.from(JSON.stringify(gltf)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);
 const out=Buffer.alloc(28+padded.length+binary.length);
 out.writeUInt32LE(0x46546c67);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);
 out.writeUInt32LE(padded.length,12);out.writeUInt32LE(0x4e4f534a,16);padded.copy(out,20);
 out.writeUInt32LE(binary.length,20+padded.length);out.writeUInt32LE(0x004e4942,24+padded.length);binary.copy(out,28+padded.length);
 return new Promise((resolve,reject)=>new THREE.GLTFLoader().parse(out.buffer,'',resolve,reject));
}
async function createAssets(){
 const assets=new Map();
 for(const name of ['ct','t','arms','usp','ak47','player-animations','weapon-animations'])assets.set(name,await load(name));
 const root={
  THREE:{...THREE,GLTFLoader:class{async loadAsync(url){return assets.get(url.split('/').at(-1).split('.')[0]);}}},
  OfflineAudioContext:class{},Sim:{W:{usp:{reload:2.2},ak47:{reload:2.43}}},
 };
 const fetch=async()=>({ok:true,json:async()=>({files:[...assets.keys()].map(name=>({name:name+'.glb',sha256:'test'}))})});
 vm.runInNewContext(fs.readFileSync(require.resolve('../../public/game-assets.js'),'utf8'),{window:root,fetch});
 await root.GameAssets.load(()=>{});return root.GameAssets;
}
module.exports={load,createAssets};
