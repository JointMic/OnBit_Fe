const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const manifest=JSON.parse(fs.readFileSync('public/manifest.webmanifest','utf8'));
assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');
for(const icon of manifest.icons){const png=fs.readFileSync('public'+icon.src);assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,icon.sizes)}
const handlers={};vm.runInNewContext(fs.readFileSync('public/sw.js','utf8'),{self:{location:{origin:'https://onbit-fe.vercel.app'},addEventListener:(type,handler)=>handlers[type]=handler},URL});
for(const [path,method] of [['/api/glucose/infer','POST'],['/api/glucose/health','GET'],['/api/live','GET']]){
 let intercepted=false;handlers.fetch({request:{url:'https://onbit-fe.vercel.app'+path,method},respondWith:()=>intercepted=true});assert.equal(intercepted,false,'API traffic must never use service-worker cache');
}
console.log('PWA manifest/icons and API cache exclusions passed');
