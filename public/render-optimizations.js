(function(root) {
'use strict';
// Keep source buffers intact. Each material region has its own bounds so a distant
// part of a spatial chunk cannot pull all of that chunk into the camera frustum.
function mapMeshes(THREE, geometry, materials) {
  const map=new THREE.Group(); map.name='Dust II';
  const positions=geometry.attributes.position, indices=geometry.index.array;
  const point=new THREE.Vector3(),cameraFrusta=new WeakMap();
  let visibilityReady=false,preparedCamera=null;
  function viewFrustum(camera){
    let entry=cameraFrusta.get(camera);
    if(!entry){entry={world:new THREE.Matrix4(),projection:new THREE.Matrix4(),clip:new THREE.Matrix4(),frustum:new THREE.Frustum(),ready:false};cameraFrusta.set(camera,entry);}
    if(!entry.ready||!entry.world.equals(camera.matrixWorld)||!entry.projection.equals(camera.projectionMatrix)){
      entry.world.copy(camera.matrixWorld);entry.projection.copy(camera.projectionMatrix);entry.clip.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);entry.frustum.setFromProjectionMatrix(entry.clip);entry.ready=true;
    }return entry.frustum;
  }
  for(const group of geometry.userData.dust2.meta.groups) {
    const part=new THREE.BufferGeometry();
    for(const [name,attribute] of Object.entries(geometry.attributes)) part.setAttribute(name,attribute);
    part.setIndex(geometry.index); part.setDrawRange(group.start,group.count);
    const box=new THREE.Box3();
    for(let i=group.start;i<group.start+group.count;i++) box.expandByPoint(point.fromBufferAttribute(positions,indices[i]));
    part.boundingBox=box;part.boundingSphere=box.getBoundingSphere(new THREE.Sphere());
    const mesh=new THREE.Mesh(part,materials[group.materialIndex]);
    mesh.name='Dust II region '+group.chunk+'/'+group.materialIndex;
    mesh.castShadow=mesh.receiveShadow=true;
    // Map vertices and collision data already use world coordinates; this static root stays at identity.
    const bounds=box.clone().expandByScalar(.00001),sphere=part.boundingSphere;
    mesh.userData.inFrustum=frustum=>frustum.intersectsSphere(sphere)&&frustum.intersectsBox(bounds);
    // The renderer's sphere test admits long, narrow regions far outside the
    // image. Refine only the colour pass: shadow rendering bypasses callbacks.
    mesh.onBeforeRender=(renderer,scene,camera)=>{
      part.drawRange.count=visibilityReady&&preparedCamera===camera?group.count:mesh.userData.inFrustum(viewFrustum(camera))?group.count:0;
    };
    mesh.onAfterRender=()=>{part.drawRange.count=group.count;};
    mesh.updateMatrix();mesh.matrixAutoUpdate=false;map.add(mesh);
  }
  const cameraWorld=new THREE.Matrix4(),cameraProjection=new THREE.Matrix4();
  // Shadow rebakes must see every source caster, including regions outside the player view.
  map.userData.restoreVisibility=()=>{if(!visibilityReady)return;for(const mesh of map.children)mesh.visible=true;visibilityReady=false;preparedCamera=null;};
  map.userData.prepareColor=camera=>{
    camera.updateWorldMatrix(true,false);preparedCamera=camera;
    if(visibilityReady&&cameraWorld.equals(camera.matrixWorld)&&cameraProjection.equals(camera.projectionMatrix))return;
    cameraWorld.copy(camera.matrixWorld);cameraProjection.copy(camera.projectionMatrix);visibilityReady=true;
    const frustum=viewFrustum(camera);
    for(const mesh of map.children)mesh.visible=mesh.userData.inFrustum(frustum);
  };
  map.updateMatrix();map.matrixAutoUpdate=false;
  return map;
}

// Restore the static packed depth AND the depth buffer before drawing moving
// casters. PCF then samples a single combined map, with the same depth test and
// filtering as rendering all casters every frame (including off-screen players).
class StaticSunShadow {
  constructor(THREE,renderer,scene,sun,staticRoot) {
    this.renderer=renderer;this.scene=scene;this.sun=sun;this.staticRoot=staticRoot;
    this.supported=renderer.capabilities.isWebGL2 || renderer.extensions.has('EXT_frag_depth');
    this.cache=null;this.staticCasters=[];this.staticCasterSet=new Set();
    this.shadowBounds=new Float64Array(8);this.sunWorld=new THREE.Matrix4();this.targetWorld=new THREE.Matrix4();
    staticRoot.traverse(o=>{if(o.castShadow){this.staticCasters.push(o);this.staticCasterSet.add(o);}});
    if(!this.supported)return;
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
    const material=new THREE.ShaderMaterial({side:THREE.DoubleSide,depthWrite:false,depthTest:false,colorWrite:false,
      vertexShader:'void main(){gl_Position=vec4(2.0,2.0,2.0,1.0);}',fragmentShader:'void main(){gl_FragColor=vec4(0.0);}'});
    const depth=new THREE.ShaderMaterial({side:THREE.DoubleSide,depthTest:true,depthWrite:true,depthFunc:THREE.AlwaysDepth,blending:THREE.NoBlending,
      uniforms:{cachedDepth:{value:null},mapSize:{value:new THREE.Vector2()}},extensions:{fragDepth:true},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:'#include <packing>\nuniform sampler2D cachedDepth; uniform vec2 mapSize;\nvoid main(){vec4 depthSample=texture2D(cachedDepth,gl_FragCoord.xy/mapSize);gl_FragColor=depthSample;gl_FragDepthEXT=unpackRGBAToDepth(depthSample);}'});
    this.restore=new THREE.Mesh(geometry,material);this.restore.customDepthMaterial=depth;
    this.restore.name='Restore static sun depth';this.restore.frustumCulled=false;this.restore.castShadow=true;this.restore.visible=false;
    scene.add(this.restore);
    // WebGLShadowMap traverses children in insertion order, independently of renderOrder.
    scene.children.splice(scene.children.indexOf(this.restore),1);scene.children.unshift(this.restore);
    renderer.domElement.addEventListener('webglcontextrestored',()=>this.invalidate());
  }
  invalidate() {
    this.staticRoot.userData.restoreVisibility?.();
    if(this.cache)this.cache.dispose();this.cache=null;
    if(this.restore)this.restore.visible=false;
    for(const mesh of this.staticCasters)mesh.castShadow=true;
    this.sun.shadow.needsUpdate=true;
  }
  prepare(camera) {
    const {renderer,scene,sun}=this;
    if(!this.supported||!renderer.shadowMap.enabled||!sun.castShadow){this.staticRoot.userData.restoreVisibility?.();return;}
    sun.updateWorldMatrix(true,false);sun.target.updateWorldMatrix(true,false);
    const c=sun.shadow.camera;
    const b=this.shadowBounds;
    if(this.cache&&b[0]===sun.shadow.mapSize.x&&b[1]===sun.shadow.mapSize.y&&b[2]===c.left&&b[3]===c.right&&b[4]===c.top&&b[5]===c.bottom&&b[6]===c.near&&b[7]===c.far&&this.sunWorld.equals(sun.matrixWorld)&&this.targetWorld.equals(sun.target.matrixWorld)){this.staticRoot.userData.prepareColor?.(camera);return;}
    this.invalidate();
    scene.updateMatrixWorld();
    const dynamic=[];
    scene.traverse(o=>{if((o.isMesh||o.isLine||o.isPoints)&&o!==this.restore&&o.castShadow&&!this.staticCasterSet.has(o)){dynamic.push(o);o.castShadow=false;}});
    const oldAuto=renderer.shadowMap.autoUpdate;
    try {
      renderer.shadowMap.autoUpdate=true;sun.shadow.needsUpdate=true;
      renderer.render(scene,camera);
      this.cache=sun.shadow.map;sun.shadow.map=null;
      this.restore.customDepthMaterial.uniforms.cachedDepth.value=this.cache.texture;
      this.restore.customDepthMaterial.uniforms.mapSize.value.copy(sun.shadow.mapSize);
      b[0]=sun.shadow.mapSize.x;b[1]=sun.shadow.mapSize.y;b[2]=c.left;b[3]=c.right;b[4]=c.top;b[5]=c.bottom;b[6]=c.near;b[7]=c.far;
      this.sunWorld.copy(sun.matrixWorld);this.targetWorld.copy(sun.target.matrixWorld);
      for(const mesh of this.staticCasters)mesh.castShadow=false;
      this.restore.visible=true;sun.shadow.needsUpdate=true;
    } finally {
      for(const mesh of dynamic)mesh.castShadow=true;
      renderer.shadowMap.autoUpdate=oldAuto;
      this.staticRoot.userData.prepareColor?.(camera);
    }
  }
}
const api={mapMeshes,StaticSunShadow};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RenderOptimizations=api;
})(typeof window!=='undefined'?window:globalThis);
