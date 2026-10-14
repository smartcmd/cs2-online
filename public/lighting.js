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
  return mix(vec3(.32,.35,.40),vec3(.90,.98,1.12),sqrt(light.r))+vec3(.70,.48,.27)*light.g*.55;
}`;
const sunDirection=[-.47010496792184314,.7660445056193499,.4383801299137392];
const sunColor=[1,.73046076,.5088813];
const api={validate,sample,glsl,sunDirection,sunColor};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MapLighting=api;
})(typeof window!=='undefined'?window:globalThis);
