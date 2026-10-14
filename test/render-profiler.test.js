'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('diagnostic previews advance renderer frames so GPU skeleton buffers do not freeze between benchmarks',()=>{
 const root={},element=()=>({style:{},appendChild(){},insertBefore(){}}),document={createElement:element,body:element()};let resets=0;
 const renderer={getContext:()=>({}),capabilities:{isWebGL2:false},info:{autoReset:true,reset(){resets++;}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/render-profiler.js'),'utf8'),{window:root,document,location:{search:'?perf'},URLSearchParams,performance:{setResourceTimingBufferSize(){}},addEventListener(){}});
 const profiler=root.RenderProfiler(renderer,[],()=>{});assert.equal(renderer.info.autoReset,false);profiler.before(0);profiler.before(16);profiler.before(32);assert.equal(resets,3);assert.equal(profiler.running,false);
});
