'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
if(process.argv.includes('--gpu')){
 const routes={'/':['test/fixtures/projection-gpu.html','text/html'],'/three.min.js':[require.resolve('three/build/three.min.js'),'text/javascript'],'/map-surfaces.js':['public/map-surfaces.js','text/javascript']};
 require('node:http').createServer((req,res)=>{const route=routes[req.url];if(!route){res.writeHead(404);return res.end();}res.setHeader('Content-Type',route[1]);fs.createReadStream(path.resolve(root,route[0])).pipe(res);}).listen(8093,'127.0.0.1',()=>console.log('GPU regression: http://127.0.0.1:8093/'));
}else{
 const meta=require('../public/maps/dust2.json'),bytes=zlib.gunzipSync(fs.readFileSync(path.join(root,'public/maps/dust2.mesh.gz')));
 const g=require('../shared/dust2-mesh').geometry(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),meta,null,true);
 const positions=g.attributes.position.array,index=g.index.array,surface=g.attributes.surface.array,colors=g.attributes.color.array;
 const pointIds=new Uint32Array(positions.length/3),points=new Map();let unique=0;
 for(let i=0;i<pointIds.length;i++){
  const key=positions[i*3]+','+positions[i*3+1]+','+positions[i*3+2];let id=points.get(key);
  if(id===undefined){id=unique++;points.set(key,id);}pointIds[i]=id;
 }
 points.clear();
 const triangles=new Map(),pairs={},ambiguousByMaterial={};let duplicate=0,opposite=0,colorDifferent=0,degenerate=0,axisTies=0;
 for(let i=0;i<index.length;i+=3){
  const ids=[pointIds[index[i]],pointIds[index[i+1]],pointIds[index[i+2]]],sorted=ids.slice().sort((a,b)=>a-b);
  if(sorted[0]===sorted[1]||sorted[1]===sorted[2]){degenerate++;continue;}
  const a=index[i]*3,b=index[i+1]*3,c=index[i+2]*3;
  const ux=positions[b]-positions[a],uy=positions[b+1]-positions[a+1],uz=positions[b+2]-positions[a+2];
  const vx=positions[c]-positions[a],vy=positions[c+1]-positions[a+1],vz=positions[c+2]-positions[a+2];
  const nx=Math.abs(uy*vz-uz*vy),ny=Math.abs(uz*vx-ux*vz),nz=Math.abs(ux*vy-uy*vx),length=Math.hypot(nx,ny,nz);
  const material=surface[index[i]];
  if(length>1e-10&&meta.materials[material].type!==4&&((ny/length<=.7&&Math.abs(nx-nz)/length<.001)||Math.abs(ny/length-.7)<.001)){
   axisTies++;ambiguousByMaterial[material]=(ambiguousByMaterial[material]||0)+1;
  }
  const key=sorted.join(','),previous=triangles.get(key);
  if(previous===undefined){triangles.set(key,i);continue;}
  duplicate++;const old=[pointIds[index[previous]],pointIds[index[previous+1]],pointIds[index[previous+2]]],rotation=ids.indexOf(old[0]);
  if(ids[(rotation+1)%3]!==old[1])opposite++;
  let different=false;for(let k=0;k<3;k++){const at=ids.indexOf(old[k]);for(let channel=0;channel<3;channel++)if(colors[index[previous+k]*3+channel]!==colors[index[i+at]*3+channel])different=true;}
  if(different)colorDifferent++;
  const pair=[surface[index[previous]],material].sort((a,b)=>a-b).join(':');pairs[pair]=(pairs[pair]||0)+1;
 }
 const positionHash=crypto.createHash('sha256').update(new Uint8Array(positions.buffer,0,meta.vertices*12)).digest('hex');
 const indexHash=crypto.createHash('sha256').update(new Uint8Array(index.buffer,0,meta.sourceTriangles*12)).digest('hex');
 if(positionHash!==meta.positionSHA256||indexHash!==meta.indexSHA256)throw Error('Source geometry was modified');
 const report={sourceTriangles:meta.sourceTriangles,renderTriangles:index.length/3,sourceGeometryVerified:true,spatialChunks:new Set(meta.groups.map(g=>g.chunk)).size,materialGroups:meta.groups.length,exactCoincidentTriangles:duplicate,oppositeWinding:opposite,differentVertexColors:colorDifferent,degenerate,axisProjectionBoundaries:axisTies,ambiguousByMaterial,pairs};
 fs.mkdirSync(path.join(root,'.cache'),{recursive:true});fs.writeFileSync(path.join(root,'.cache/surface-audit.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
