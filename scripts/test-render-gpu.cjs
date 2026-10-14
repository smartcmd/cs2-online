'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const routes={
 '/':['test/fixtures/shadow-cache-gpu.html','text/html'],
 '/three.min.js':[require.resolve('three/build/three.min.js'),'text/javascript'],
 '/render-optimizations.js':['public/render-optimizations.js','text/javascript'],
};
const port=Number(process.env.PORT||8096);
http.createServer((req,res)=>{
 const route=routes[req.url.split('?')[0]];if(!route){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',route[1]);fs.createReadStream(path.resolve(__dirname,'..',route[0])).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log(`Shadow regression: http://127.0.0.1:${port}/`));
