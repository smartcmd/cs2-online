'use strict';
const fs=require('fs'),crypto=require('crypto'),THREE=require('three');global.THREE=THREE;global.window=global;require('three/examples/js/loaders/OBJLoader.js');require('three/examples/js/exporters/GLTFExporter.js');
global.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(b=>{this.result=b;this.onloadend&&this.onloadend();});}readAsDataURL(blob){blob.arrayBuffer().then(b=>{this.result='data:application/octet-stream;base64,'+Buffer.from(b).toString('base64');this.onloadend&&this.onloadend();});}};
const mesh=new THREE.OBJLoader().parse(fs.readFileSync('.cache/valve-weapons/weapon_rif_famas.obj','utf8'));
mesh.traverse(o=>{if(o.isMesh){o.geometry.scale(.0254,.0254,.0254);o.material=new THREE.MeshStandardMaterial({color:0x3c4144,roughness:.48,metalness:.65});}});
const source=new THREE.Group(),bone=new THREE.Bone();bone.name='weapon';bone.quaternion.set(-.5,-.5,-.5,.5);bone.position.set(0,.075,-.08);source.add(bone,mesh);
const normal=new THREE.Group();normal.name='normalization';normal.rotation.y=Math.PI;normal.add(source);
new THREE.GLTFExporter().parse(normal,result=>{fs.writeFileSync('public/game/famas.glb',Buffer.from(result));const manifest=JSON.parse(fs.readFileSync('public/game/assets.json'));manifest.files=manifest.files.filter(f=>f.name!=='famas.glb');const b=Buffer.from(result);manifest.files.push({name:'famas.glb',bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')});fs.writeFileSync('public/game/assets.json',JSON.stringify(manifest,null,2)+'\n');console.log('FAMAS',b.length);},{binary:true});
