// Opt-in, local diagnostics; normal play does not allocate queries or sample arrays.
(function(root) {
'use strict';
root.RenderProfiler = function(renderer, views, selectView) {
  if (!new URLSearchParams(location.search).has('perf')) return null;
  performance.setResourceTimingBufferSize(2000);
  const panel=document.createElement('div');
  panel.style.cssText='position:fixed;right:12px;bottom:12px;z-index:1000;background:#10151eee;color:#e3eef9;padding:12px;max-width:620px;max-height:45vh;overflow:auto;font:12px monospace;white-space:pre-wrap;pointer-events:auto';
  const button=document.createElement('button');button.textContent='运行地图帧耗时测试';panel.appendChild(button);
  const moving=document.createElement('button');moving.textContent='移动视角帧耗时测试';panel.appendChild(moving);
  let movingRun=false;
  const current=document.createElement('button');current.textContent='采样当前画面';panel.appendChild(current);
  const downloads=document.createElement('button');downloads.textContent='下载与缓存统计';panel.appendChild(downloads);
  let activeViews=views,sampleFrames=150;
  let timings={},frameTimings={},slowFrames=[];
  const output=document.createElement('pre');output.id='render-profile';panel.appendChild(output);document.body.appendChild(panel);
  downloads.onclick=()=>{const entries=performance.getEntriesByType('resource').filter(r=>r.name.startsWith(location.origin+'/'));const summary={map:{encoded:0,transferred:0,requests:0},actors:{encoded:0,transferred:0,requests:0},runtime:{encoded:0,transferred:0,requests:0}};for(const r of entries){const path=new URL(r.name).pathname,key=path.startsWith('/maps/')?'map':path.startsWith('/game/')?'actors':'runtime';summary[key].encoded+=r.encodedBodySize;summary[key].transferred+=r.transferSize;summary[key].requests++;}output.textContent=JSON.stringify({resources:summary,entries:entries.map(r=>({path:new URL(r.name).pathname,encoded:r.encodedBodySize,transfer:r.transferSize}))},null,2);};
  const gl=renderer.getContext(), ext=renderer.capabilities.isWebGL2?gl.getExtension('EXT_disjoint_timer_query_webgl2'):null;
  const queries=[],results=[];let frame=0,index=-1,frames=[],cpu=[],gpu=[],calls=[],triangles=[],query=null,start=0,previous=0;
  const summary=a=>{const sorted=a.slice().sort((a,b)=>a-b);return a.length?{median:+sorted[Math.floor(a.length*.5)].toFixed(2),p95:+sorted[Math.floor(a.length*.95)].toFixed(2)}:null;};
  const api={running:false,timing(name,ms){if(api.running){(timings[name] ||= []).push(ms);frameTimings[name]=(frameTimings[name]||0)+ms;}},before(now){
    if(!api.running)return;
    while(queries.length&&gl.getQueryParameter(queries[0].q,gl.QUERY_RESULT_AVAILABLE)){
      const pending=queries.shift();if(!gl.getParameter(ext.GPU_DISJOINT_EXT)&&pending.index===index&&pending.frame>30)gpu.push(gl.getQueryParameter(pending.q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(pending.q);
    }
    if(frame>=sampleFrames){results.push({view:activeViews[index][0],frameMs:summary(frames),cpuMs:summary(cpu),gpuMs:summary(gpu),calls:summary(calls),triangles:summary(triangles),size:[renderer.domElement.width,renderer.domElement.height],stages:Object.fromEntries(Object.entries(timings).map(([name,values])=>[name,{...summary(values),max:+Math.max(...values).toFixed(2)}])),slowFrames});output.textContent=JSON.stringify(results,null,2);frame=0;}
    if(frame===0){index++;if(index>=activeViews.length){api.running=false;button.disabled=false;return;}if(activeViews[index][1])selectView(activeViews[index][1]);frames=[];cpu=[];gpu=[];calls=[];triangles=[];timings={};slowFrames=[];}
    frame++;if(movingRun){const pose=activeViews[index][1],offset=Math.sin(frame*.05)*.35;selectView([[pose[0][0]+offset,pose[0][1],pose[0][2]+offset*.4],pose[1]]);}
    if(previous&&frame>30)frames.push(now-previous);previous=now;
    renderer.info.reset();start=performance.now();frameTimings={};
    if(ext&&queries.length<8){query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query);}
  },after(){
    if(!api.running)return;
    if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push({q:query,index,frame});query=null;}
    if(frame>30){const elapsed=performance.now()-start;cpu.push(elapsed);if(elapsed>16.7){slowFrames.push({frame,cpuMs:+elapsed.toFixed(2),stages:{...frameTimings},calls:renderer.info.render.calls,triangles:renderer.info.render.triangles});slowFrames.sort((a,b)=>b.cpuMs-a.cpuMs);slowFrames.length=Math.min(8,slowFrames.length);}calls.push(renderer.info.render.calls);triangles.push(renderer.info.render.triangles);}
  }};
  function begin(list,motion=false){if(api.running)return;movingRun=motion;activeViews=list;sampleFrames=list.length===1?630:150;results.length=0;index=-1;frame=0;previous=0;output.textContent='测试中：预热 30 帧，'+(sampleFrames-30)+' 帧采样，包含分阶段耗时。';api.running=true;button.disabled=true;}
  button.onclick=()=>begin(views);moving.onclick=()=>begin(views,true);current.onclick=()=>begin([['当前画面',null]]);
  api.setMap=function(map,geometry,materials,cache,scene,camera,sun){
    const compare=document.createElement('button');compare.textContent='检查优化前后画面';panel.insertBefore(compare,output);
    const motion=document.createElement('button');motion.textContent='移动视角遮挡检查';panel.insertBefore(motion,output);
    compare.onclick=()=>check(false);motion.onclick=()=>check(true);
    function check(moving){
      if(api.running)return;
      compare.disabled=true;button.disabled=true;
      const T=root.THREE,reference=new T.Group(),chunks=new Map();
      for(const group of geometry.userData.dust2.meta.groups){if(!chunks.has(group.chunk))chunks.set(group.chunk,[]);chunks.get(group.chunk).push(group);}
      for(const groups of chunks.values()){
        const first=groups[0].start,last=groups.at(-1),part=new T.BufferGeometry();
        for(const [name,attribute] of Object.entries(geometry.attributes))part.setAttribute(name,attribute);
        part.setIndex(new T.BufferAttribute(geometry.index.array.subarray(first,last.start+last.count),1));
        for(const group of groups)part.addGroup(group.start-first,group.count,group.materialIndex);
        const box=new T.Box3(),point=new T.Vector3();for(const vertex of part.index.array)box.expandByPoint(point.fromBufferAttribute(geometry.attributes.position,vertex));
        part.boundingSphere=box.getBoundingSphere(new T.Sphere());
        const mesh=new T.Mesh(part,materials);mesh.castShadow=mesh.receiveShadow=true;reference.add(mesh);
      }
      scene.add(reference);
      const target=new T.WebGLRenderTarget(640,360),a=new Uint8Array(640*360*4),b=new Uint8Array(a.length),checks=[];
      const position=camera.position.clone(),quaternion=camera.quaternion.clone(),aspect=camera.aspect,oldAuto=sun.shadow.autoUpdate;
      renderer.setRenderTarget(target);camera.aspect=640/360;camera.updateProjectionMatrix();sun.shadow.autoUpdate=true;
      for(const [view,pose] of views)for(const offset of (moving?[-.35,-.08,0,.08,.35]:[0])){
        camera.position.fromArray(pose[0]);camera.position.x+=offset;camera.position.z+=offset*.4;camera.lookAt(...pose[1]);
        cache.invalidate();map.visible=false;reference.visible=true;renderer.clear();renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,640,360,a);
        map.visible=true;reference.visible=false;cache.prepare(camera);renderer.clear();renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,640,360,b);
        let changed=0,max=0,total=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d>2)changed++;max=Math.max(max,d);total+=d;}
        checks.push({view,offset,changedChannels:changed,maxError:max,meanError:+(total/a.length).toFixed(5)});
      }
      scene.remove(reference);for(const mesh of reference.children)mesh.geometry.dispose();renderer.setRenderTarget(null);target.dispose();
      camera.position.copy(position);camera.quaternion.copy(quaternion);camera.aspect=aspect;camera.updateProjectionMatrix();sun.shadow.autoUpdate=oldAuto;
      output.textContent=JSON.stringify({comparison:checks},null,2);compare.disabled=false;button.disabled=false;
    };
  };
  renderer.info.autoReset=false;
  return api;
};
})(window);
