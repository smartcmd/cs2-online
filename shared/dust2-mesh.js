// Lossless Float32 decoding; packing must never move a map vertex or remove a face.
(function(root){
'use strict';
const node=typeof module!=='undefined'&&module.exports;
const THREE=node?require('three'):root.THREE;
function geometry(buffer,meta,opacity=null){
  const view=new DataView(buffer);
  if(view.getUint32(0,false)!==0x44324c31)throw new Error('Unsupported Dust II mesh');
  const vertices=view.getUint32(4,true),count=view.getUint32(8,true),uvCount=view.getUint32(12,true);
  if(buffer.byteLength<16+vertices*9+uvCount*8+count)throw new Error('Incomplete Dust II mesh');
  let offset=16;
  function floats(length,components){
    const result=new Float32Array(length*components),bits=new Uint32Array(result.buffer);
    for(let axis=0;axis<components;axis++){
      let previous=0;
      for(let i=0;i<length;i++){
        let delta=0;for(let byte=0;byte<4;byte++)delta|=view.getUint8(offset+(axis*4+byte)*length+i)<<(byte*8);
        previous=(previous^delta)>>>0;bits[i*components+axis]=previous;
      }
    }
    offset+=result.byteLength;return result;
  }
  function shorts(components){
    const out=new Uint16Array(vertices*components);
    for(let axis=0;axis<components;axis++){let previous=0;for(let i=0;i<vertices;i++){const delta=view.getUint8(offset+axis*2*vertices+i)|(view.getUint8(offset+(axis*2+1)*vertices+i)<<8);previous^=delta;out[i*components+axis]=previous;}}
    offset+=out.byteLength;return out;
  }
  const codeBits=shorts(3),codes=new Int16Array(codeBits.buffer),matrixIds=shorts(1),positions=new Float32Array(vertices*3);
  const matrices=meta.transforms.map(t=>new THREE.Matrix4().fromArray(t.matrix)),point=new THREE.Vector3();
  for(let i=0;i<vertices;i++){
    const id=matrixIds[i],normalized=meta.transforms[id].normalized;
    const component=axis=>normalized?Math.fround(Math.max(-1,codes[i*3+axis]/32767)):codes[i*3+axis];
    point.set(component(0),component(1),component(2)).applyMatrix4(matrices[id]);point.toArray(positions,i*3);
  }
  const colors=new Uint8Array(vertices*3),indices=new Uint32Array(count);
  const linear=meta.palette.map(rgb=>new THREE.Color(...rgb.map(v=>v/255)).convertSRGBToLinear().toArray().map(v=>Math.round(v*255)));
  for(let i=0;i<vertices;i++)colors.set(linear[view.getUint8(offset++)],i*3);
  const packedUvs=floats(uvCount,2),uvs=new Float32Array(vertices*2),surfaces=new Uint16Array(vertices);
  for(const group of meta.groups){
    surfaces.fill(group.materialIndex,group.firstVertex,group.firstVertex+group.vertices);
    if(group.uvOffset>=0)uvs.set(packedUvs.subarray(group.uvOffset*2,(group.uvOffset+group.vertices)*2),group.firstVertex*2);
  }
  let previousIndex=0;
  for(let i=0;i<count;i++){
    let encoded=0,shift=0,byte;
    do{if(shift>28)throw new Error('Invalid mesh index');byte=view.getUint8(offset++);encoded|=(byte&127)<<shift;shift+=7;}while(byte&128);
    previousIndex+=(encoded>>>1)^-(encoded&1);
    if(previousIndex<0||previousIndex>=vertices)throw new Error('Mesh index out of range');indices[i]=previousIndex;
  }
  if(offset!==buffer.byteLength)throw new Error('Unexpected trailing map data');
  const result=new THREE.BufferGeometry();
  result.setAttribute('position',new THREE.BufferAttribute(positions,3));
  result.setAttribute('color',new THREE.BufferAttribute(colors,3,true));
  result.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
  result.setAttribute('surface',new THREE.BufferAttribute(surfaces,1));
  result.setIndex(new THREE.BufferAttribute(indices,1));
  for(const group of meta.groups)result.addGroup(group.start,group.count,group.materialIndex);
  result.userData.dust2={meta,opacity};result.computeVertexNormals();result.computeBoundingSphere();return result;
}
if(node)module.exports={geometry};else root.Dust2Mesh={geometry};
})(typeof window!=='undefined'?window:globalThis);
