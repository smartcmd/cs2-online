'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp');
const {sunDirection}=require('../public/lighting');
const clamp=x=>Math.max(0,Math.min(1,x)),smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
function hash(x,y,z){let n=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2147483647);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
function noise(x,y,z){const a=Math.floor(x),b=Math.floor(y),c=Math.floor(z),u=smooth(0,1,x-a),v=smooth(0,1,y-b),w=smooth(0,1,z-c);let n=0;for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)n+=hash(a+dx,b+dy,c+dz)*(dx?u:1-u)*(dy?v:1-v)*(dz?w:1-w);return n;}
function sample(direction){
 const len=Math.hypot(...direction),[x,y,z]=direction.map(v=>v/len),h=clamp(y),sun=Math.max(0,x*sunDirection[0]+y*sunDirection[1]+z*sunDirection[2]);
 const t=Math.pow(h,.45),warp=noise(x*3+7,y*3-2,z*3+13),q=[x*3+z*1.3+4,y*18+warp*2,z*4.5-7];
 const n=noise(...q)*.65+noise(q[0]*2.1,q[1]*2.1,q[2]*2.1)*.25+noise(q[0]*4.3,q[1]*4.3,q[2]*4.3)*.1;
 const cloud=smooth(.54,.79,n)*smooth(.025,.16,h)*.28,glow=Math.pow(sun,12)*.15,disk=smooth(Math.cos(.006),Math.cos(.003),sun);
 const upper=[92,157,215],horizon=[218,230,232],ground=[118,103,81],out=[];
 for(let i=0;i<3;i++){let c=horizon[i]+(upper[i]-horizon[i])*t;c+=(244-c)*cloud;c+=([255,246,223][i]-c)*glow;c+=(255-c)*disk;c+=(ground[i]-c)*smooth(0,.22,-y);out.push(Math.round(c));}return out;
}
function direction(face,u,v){const dirs=[[1,-v,-u],[-1,-v,u],[u,1,v],[u,-1,-v],[u,-v,1],[-u,-v,-1]];const d=dirs[face];d[0]*=-1;return d;}
function diffuseCoefficients(){
 const rays=Array.from({length:2048},(_,i)=>{const y=1-2*(i+.5)/2048,a=i*Math.PI*(3-Math.sqrt(5)),r=Math.sqrt(1-y*y),d=[Math.cos(a)*r,y,Math.sin(a)*r];return {d,c:sample(d).map(v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);})};});
 const average=n=>{const out=[0,0,0];let total=0;for(const r of rays){const w=Math.pow(Math.max(0,n[0]*r.d[0]+n[1]*r.d[1]+n[2]*r.d[2]),3);total+=w;for(let c=0;c<3;c++)out[c]+=r.c[c]*w;}return out.map(v=>v/total);};
 const [up,down,px,nx,pz,nz]=[[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].map(average),a=px.map((v,i)=>(v+nx[i]+pz[i]+nz[i])/4);
 return [a,up.map((v,i)=>(v-down[i])/2),up.map((v,i)=>(v+down[i])/2-a[i]),px.map((v,i)=>(v-nx[i])/2),pz.map((v,i)=>(v-nz[i])/2)];
}
async function build(){const root=path.join(__dirname,'../public/maps'),meta=JSON.parse(fs.readFileSync(path.join(root,'dust2.json'))),files=[],size=512;
 for(let face=0;face<6;face++){const rgb=new Uint8Array(size*size*3);for(let y=0;y<size;y++)for(let x=0;x<size;x++)rgb.set(sample(direction(face,(x+.5)/size*2-1,(y+.5)/size*2-1)),(y*size+x)*3);const bytes=await sharp(rgb,{raw:{width:size,height:size,channels:3}}).webp({quality:95,effort:6}).toBuffer(),name='dust2-sky-'+face+'.webp';fs.writeFileSync(path.join(root,name),bytes);files.push({name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),kind:'sky'});}
 meta.files=meta.files.filter(f=>!f.name.startsWith('dust2-sky-')).concat(files);meta.sky={size,diffuse:diffuseCoefficients(),files:files.map(f=>f.name),source:'Procedural sky matched to Valve CS2 Dust II reference screenshots; not an original Valve sky texture.'};fs.writeFileSync(path.join(root,'dust2.json'),JSON.stringify(meta)+'\n');console.log('Sky bytes',files.reduce((s,f)=>s+f.bytes,0));return meta;}
if(require.main===module)build().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={sample,direction,build,diffuseCoefficients};
