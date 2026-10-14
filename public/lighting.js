(function (root) {
'use strict';
function validate(data, meta) {
  if (data.sourcePositionSHA256 !== meta.positionSHA256 || data.sourceIndexSHA256 !== meta.indexSHA256 || data.sourceRepairSHA256 !== meta.surfaceRepairs.positionSHA256) throw Error('光照数据与地图版本不一致，请重新构建地图');
  if (!data.sun || data.sun.some((v,i)=>Math.abs(v-sunDirection[i])>.00001)) throw Error('光照方向与采样数据不一致');
  if (data.version !== 1 || data.size.length !== 3 || data.step <= 0) throw Error('光照数据格式错误');
}
function sample(field, point) {
  const { origin, size, step, pixels } = field;
  const p = point.map((v, i) => Math.max(0, Math.min(size[i] - 1, (v - origin[i]) / step)));
  const base = p.map(Math.floor), f = p.map((v, i) => v - base[i]);
  const result = [0, 0];
  for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) for (let x = 0; x < 2; x++) {
    const weight = (x ? f[0] : 1-f[0]) * (y ? f[1] : 1-f[1]) * (z ? f[2] : 1-f[2]);
    const i = ((Math.min(base[1]+y,size[1]-1)*size[2]+Math.min(base[2]+z,size[2]-1))*size[0]+Math.min(base[0]+x,size[0]-1))*4;
    result[0] += pixels[i] / 255 * weight; result[1] += pixels[i+1] / 255 * weight;
  }
  return result;
}

function viewProbe(field,point){
 const light=sample(field,point),direction=[0,0,0];
 for(let axis=0;axis<3;axis++){const a=point.slice(),b=point.slice();a[axis]+=field.step*.5;b[axis]-=field.step*.5;direction[axis]=sample(field,a)[0]-sample(field,b)[0];}
 direction[1]=Math.max(.12,direction[1]);const length=Math.hypot(...direction);return {light,direction:direction.map(v=>v/length)};
}
const look={exposure:.9,sunPower:2.4,skyPower:.85,skyColor:0xb8d3ee,groundColor:0xbfa783,mapReflection:.30,actorReflection:.35,viewReflection:.38,viewBounce:.22};
async function installSky(THREE,renderer,scene,viewScene,meta){
 const urls=meta.sky.files.map(name=>{const f=meta.files.find(f=>f.name===name);return '/maps/'+name+'?v='+f.sha256.slice(0,12);});
 const cube=await new THREE.CubeTextureLoader().loadAsync(urls);cube.encoding=THREE.sRGBEncoding;
 const material=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,depthTest:true,toneMapped:false,fog:false,uniforms:{skyCube:{value:cube}},
  vertexShader:'varying vec3 skyDirection;void main(){skyDirection=position;vec4 p=projectionMatrix*mat4(mat3(viewMatrix))*vec4(position,1.);gl_Position=p.xyww;}',
  fragmentShader:'uniform samplerCube skyCube;varying vec3 skyDirection;void main(){gl_FragColor=vec4(textureCube(skyCube,vec3(-skyDirection.x,skyDirection.yz)).rgb,1.);}' });
 const sky=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);sky.name='Dust II static sky';sky.frustumCulled=false;sky.renderOrder=1;scene.add(sky);
 const reflectionScene=new THREE.Scene();reflectionScene.background=cube;
 // The background is camera-centred and the scene path retains the existing RGBE shader decode.
 const pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(reflectionScene,0);scene.environment=viewScene.environment=environment.texture;pmrem.dispose();
 return {sky,cube,environment};
}
// The prefiltered sky fit avoids texture reads on diffuse and rough matte surfaces.
function mapEnvironment(THREE,shader,coefficients,roughReflection){
 shader.uniforms.skyDiffuse={value:coefficients};
 let chunk=THREE.ShaderChunk.envmap_physical_pars_fragment;
 const begin=chunk.indexOf('vec3 getLightProbeIndirectIrradiance'),end=chunk.indexOf('float getSpecularMIPLevel',begin);
 if(begin<0||end<=begin)throw Error('Unsupported environment shader layout');
 chunk=chunk.slice(0,begin)+`vec3 getLightProbeIndirectIrradiance(const in GeometricContext geometry,const in int maxMIPLevel){return PI*roughSky(inverseTransformDirection(geometry.normal,viewMatrix))*envMapIntensity;}
`+chunk.slice(end);
 const signature='const in int maxMIPLevel ) {';const spec=chunk.indexOf('vec3 getLightProbeIndirectRadiance'),brace=chunk.indexOf(signature,spec)+signature.length;
 if(roughReflection)chunk=chunk.slice(0,brace)+'\nif(roughness>=.85)return roughSky(inverseTransformDirection(normal,viewMatrix))*envMapIntensity;\n'+chunk.slice(brace);
 shader.fragmentShader='uniform vec3 skyDiffuse[5];vec3 roughSky(vec3 n){return max(vec3(0.),skyDiffuse[0]+skyDiffuse[1]*n.y+skyDiffuse[2]*n.y*n.y+skyDiffuse[3]*n.x+skyDiffuse[4]*n.z); }\n'+shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>',chunk);
}
// Matching rotations preserve the screen pose while reflections retain world orientation.
function orientView(quaternion,camera,rig){camera.quaternion.copy(quaternion);rig.quaternion.copy(quaternion);}
function viewMaterial(material,materials){
 material.envMapIntensity=look.viewReflection;
 if(material.aoMap)material.aoMapIntensity=Math.min(1.15,material.aoMapIntensity*1.15);
 materials.add(material);
}
const glsl = `
uniform sampler2D irradianceMap;
uniform vec3 irradianceOrigin, irradianceSize;
uniform float irradianceStep;
vec3 mapIrradiance(vec3 worldPosition) {
  vec3 p=clamp((worldPosition-irradianceOrigin)/irradianceStep,vec3(0.0),irradianceSize-1.0);
  float layer=floor(p.y), nextLayer=min(layer+1.0,irradianceSize.y-1.0);
  vec2 a=vec2((p.x+.5)/irradianceSize.x,(layer*irradianceSize.z+p.z+.5)/(irradianceSize.y*irradianceSize.z));
  vec2 b=vec2(a.x,(nextLayer*irradianceSize.z+p.z+.5)/(irradianceSize.y*irradianceSize.z));
  vec2 light=mix(texture2D(irradianceMap,a).rg,texture2D(irradianceMap,b).rg,fract(p.y));
  return mix(vec3(.36,.40,.46),vec3(.90,.98,1.12),light.r)+vec3(.70,.48,.27)*light.g*.65;
}`;
const sunDirection=[-.47010496792184314,.7660445056193499,.4383801299137392];
const sunColor=[1,.73046076,.5088813];
const api={validate,sample,glsl,sunDirection,sunColor,look,installSky,viewMaterial,viewProbe,orientView,mapEnvironment};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MapLighting=api;
})(typeof window!=='undefined'?window:globalThis);
