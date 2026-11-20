'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {signMacApiArchive,nativeFiles} = require('../scripts/sign-mac-api-archive.cjs');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'posnic-sign-test-'));
  const archive = path.join(root,'Posnic.app','Contents','Resources','api','node_modules.zip');
  fs.mkdirSync(path.dirname(archive),{recursive:true});
  fs.writeFileSync(archive,'original');
  return {root,archive,context:{electronPlatformName:'darwin',appOutDir:root,packager:{
    appInfo:{productFilename:'Posnic'},config:{mac:{identity:'Developer ID'}},
    codeSigningInfo:{value:Promise.resolve({keychainFile:'test.keychain'})},
    helper:{findSigningIdentity:async()=>({hash:'identity-hash'})}
  }}};
}
test('archived Mach-O is signed and verified before replacement; cache identity follows signed bytes',async()=>{
  const f=fixture(); const calls=[];
  try {
    await signMacApiArchive(f.context,(command,args)=>{
      calls.push([command,args]);
      if(args[0]==='x') {
        const dir=args.find(a=>a.startsWith('-o')).slice(2);
        fs.writeFileSync(path.join(dir,'addon.node'),Buffer.from('cffaedfe01020304','hex'));
        fs.writeFileSync(path.join(dir,'plain.js'),'module.exports = 1;');
      }
      if(args[0]==='a') fs.writeFileSync(args[3],'signed archive');
    });
    const signing=calls.find(c=>c[1].includes('--sign'));
    assert.ok(signing[1].includes('--timestamp'));
    assert.ok(signing[1].includes('identity-hash'));
    assert.ok(signing[1].includes('test.keychain'));
    assert.ok(calls.findIndex(c=>c[1].includes('--verify')) < calls.findIndex(c=>c[1][0]==='a'));
    assert.equal(fs.readFileSync(f.archive,'utf8'),'signed archive');
    assert.equal(fs.readFileSync(f.archive+'.id','utf8'),crypto.createHash('sha256').update('signed archive').digest('hex'));
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});
test('failed native signature verification aborts without replacing archive',async()=>{
  const f=fixture();
  try {
    await assert.rejects(signMacApiArchive(f.context,(command,args)=>{
      if(args[0]==='x') fs.writeFileSync(path.join(args.find(a=>a.startsWith('-o')).slice(2),'addon.node'),Buffer.from('cffaedfe','hex'));
      if(args.includes('--verify')) throw new Error('invalid signature');
    }),/invalid signature/);
    assert.equal(fs.readFileSync(f.archive,'utf8'),'original');
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});
test('non-Mac builds do not invoke signing tools',async()=>{
  await signMacApiArchive({electronPlatformName:'linux'},()=>assert.fail('unexpected signing'));
});
test('native file discovery handles nested modules and skips ordinary files',()=>{
  const f=fixture();
  try {
    fs.writeFileSync(path.join(f.root,'fat.node'),Buffer.from('cafebabe00000002','hex'));
    assert.deepEqual(nativeFiles(f.root),[path.join(f.root,'fat.node')]);
  } finally {fs.rmSync(f.root,{recursive:true,force:true});}
});
