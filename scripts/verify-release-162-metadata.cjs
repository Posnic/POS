const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js');
async function hash(file, alg, encoding='hex') {
  const h=crypto.createHash(alg);
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest(encoding);
}
(async()=>{
  const release=JSON.parse(execFileSync('gh',['api','repos/Posnic/POS/releases/391685875'],{encoding:'utf8'}));
  assert.equal(release.tag_name,'v1.6.2');assert.equal(release.draft,true);
  const sums=new Map(fs.readFileSync('verified/SHA256SUMS.txt','utf8').trim().split(/\r?\n/).map(line=>{const m=line.match(/^([a-f0-9]{64})\s+(.+)$/i);assert(m);return [m[2],m[1]];}));
  const manifest=yaml.load(fs.readFileSync('verified/latest-mac.yml','utf8'));
  assert.equal(manifest.version,'1.6.2');assert.equal(manifest.files.length,4);
  fs.mkdirSync('corrected',{recursive:true});
  const report={tag:'v1.6.2',sourceCommit:'d358ae00b5671ea4e7e6768a64c97749a187f914',provenanceWorkflowCommit:'7ba57b5d7d7e7a312ac9a4f2b2b646f8a130b105',packages:[]};
  for(const item of manifest.files){
    assert(/^Posnic-1\.6\.2-macos-(arm64|x64)\.(dmg|zip)$/.test(item.url));
    const file=path.join('verified',item.url);
    const digest=await hash(file,'sha256');
    const remote=release.assets.find(a=>a.name===item.url);assert(remote);
    assert.equal(digest,sums.get(item.url));assert.equal(remote.digest,'sha256:'+digest);assert.equal(fs.statSync(file).size,remote.size);
    const bomName=item.url+'.cdx.json';
    const bomDigest=await hash(path.join('verified',bomName),'sha256');assert.equal(bomDigest,sums.get(bomName));
    assert.equal(release.assets.find(a=>a.name===bomName).digest,'sha256:'+bomDigest);
    const c=JSON.parse(fs.readFileSync(path.join('verified',bomName),'utf8')).metadata.component;
    assert.equal(c.hashes.find(h=>h.alg==='SHA-256').content,digest);
    assert.equal(c.properties.find(p=>p.name==='posnic:artifact:file-name').value,item.url);
    assert.equal(c.properties.find(p=>p.name==='posnic:source:commit').value,report.sourceCommit);
    const sha512=await hash(file,'sha512','base64');
    if(item.url.endsWith('.dmg')){
      const out=path.join('corrected',item.url+'.blockmap');
      const result=await buildBlockMap(file,'gzip',out);
      assert.equal(result.sha512,sha512);assert.equal(result.size,remote.size);
      assert.equal(await hash(file,'sha256'),digest,'Package changed');
      const blockmap=JSON.parse(zlib.gunzipSync(fs.readFileSync(out)));
      assert.equal(blockmap.files[0].sizes.reduce((a,b)=>a+b,0),remote.size);
      item.sha512=sha512;item.size=remote.size;
    }else{
      assert.equal(item.sha512,sha512);assert.equal(item.size,remote.size);
    }
    report.packages.push({name:item.url,sha256:digest,sha512,bytes:remote.size,sbomSha256:bomDigest});
    console.log('Verified checksum, inventory, source and update metadata: '+item.url);
  }
  assert.equal(manifest.sha512,manifest.files.find(f=>f.url===manifest.path).sha512);
  fs.writeFileSync('corrected/latest-mac.yml',yaml.dump(manifest,{lineWidth:-1}));
  report.metadata=[];
  for(const name of fs.readdirSync('corrected'))report.metadata.push({name,bytes:fs.statSync(path.join('corrected',name)).size,sha256:await hash(path.join('corrected',name),'sha256')});
  fs.writeFileSync('corrected/verification-report.json',JSON.stringify(report,null,2)+'\n');
  console.log('All four macOS packages verified. Final DMG hashes and blockmaps refreshed without changing packages.');
})().catch(error=>{console.error(error);process.exitCode=1;});
