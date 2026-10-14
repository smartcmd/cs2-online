'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');const root=path.join(__dirname,'..');
const routes={'/':['test/fixtures/source-array-gpu.html','text/html'],'/three.min.js':[require.resolve('three/build/three.min.js'),'text/javascript'],'/source-material-arrays.js':['public/source-material-arrays.js','text/javascript']};
http.createServer((req,res)=>{const route=routes[req.url.split('?')[0]];if(!route){res.writeHead(404);return res.end();}res.setHeader('Content-Type',route[1]);fs.createReadStream(path.resolve(root,route[0])).pipe(res);}).listen(Number(process.env.PORT||8096),'127.0.0.1',()=>console.log('Source material GPU test: 8096'));
