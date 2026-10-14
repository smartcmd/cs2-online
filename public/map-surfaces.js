(function(root){
'use strict';
// Blend projection directions continuously: a hard X/Z choice flickers on 45-degree faces.
function weights(normal) {
  const values=normal.map(value=>Math.abs(value)**8),sum=values.reduce((a,b)=>a+b,0);
  return sum>0?values.map(value=>value/sum):[0,1,0];
}
const projectionWeightsGLSL=`vec3 projectionWeights=pow(abs(faceNormal),vec3(8.0));
projectionWeights/=max(dot(projectionWeights,vec3(1.0)),1e-8);`;
function atlasSampling(scale,quadrant,gradients,condition=null) {
  const sample=axis=>gradients?`textureGrad(surfaceAtlas, atlas${axis}, ${condition ? 'gradX'+axis : 'dFdx(uv'+axis+')*.492'}, ${condition ? 'gradY'+axis : 'dFdy(uv'+axis+')*.492'})`:`texture2D(surfaceAtlas, atlas${axis})`;
  return `
    ${projectionWeightsGLSL}
    vec2 uvX=vSurface.zy/${scale.toFixed(1)}, uvY=vSurface.xz/${scale.toFixed(1)}, uvZ=vSurface.xy/${scale.toFixed(1)};
    vec2 atlasOrigin=vec2(${quadrant[0].toFixed(1)},${quadrant[1].toFixed(1)})+.004;
    vec2 atlasX=atlasOrigin+fract(uvX)*.492, atlasY=atlasOrigin+fract(uvY)*.492, atlasZ=atlasOrigin+fract(uvZ)*.492;
    ${condition && gradients ? ['X','Y','Z'].map(axis=>`vec2 gradX${axis}=dFdx(uv${axis})*.492, gradY${axis}=dFdy(uv${axis})*.492;`).join('\n') : ''}
    ${condition ? 'vec3 surfaceSample=vec3(1.0); if('+condition+') surfaceSample=' : 'vec3 surfaceSample='}pow(${sample('X')}.rgb,vec3(2.2))*projectionWeights.x
      +pow(${sample('Y')}.rgb,vec3(2.2))*projectionWeights.y
      +pow(${sample('Z')}.rgb,vec3(2.2))*projectionWeights.z;
    float surfaceHeight=dot(surfaceSample,vec3(.299,.587,.114));
  `;
}
function shadowBias(coverage,resolution,depthRange) {
  const texel=coverage/resolution;
  return {normalBias:texel*.4,bias:-texel*.5/depthRange};
}
const api={weights,atlasSampling,projectionWeightsGLSL,shadowBias};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MapSurfaces=api;
})(typeof window!=='undefined'?window:globalThis);
