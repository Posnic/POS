'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {readImportStatus}=require('../api/src/services/extension-hktv-import-status');
test('import status is scoped, bounded and never equates saved orders with a current provider import',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hktv-status-'));try{
 await fs.mkdir(path.join(root,'private'));const journal=path.join(root,'journal');await fs.mkdir(journal);
 await fs.writeFile(path.join(root,'private/config.json'),JSON.stringify({tenantDb:'tenant-one',license:'license',branchId:'branch',storeCode:'STORE',journalDirectory:journal,uuid:'secret-never-return'}));
 const args={root,db:{databaseName:'tenant-one'},scope:{license:'license',branchId:'branch'},storeCode:'STORE'};
 assert.equal((await readImportStatus(args)).state,'never-synced');
 await assert.rejects(readImportStatus({...args,db:{databaseName:'tenant-two'}}),/scope_mismatch/);
 await assert.rejects(readImportStatus({...args,scope:{license:'license',branchId:'other'}}),/scope_mismatch/);
 const checkpoint=path.join(journal,'checkpoint.json');await fs.writeFile(checkpoint,JSON.stringify({storeCode:'STORE',total:15}));const completed=Date.parse('2026-10-19T01:00:00Z');await fs.utimes(checkpoint,new Date(completed),new Date(completed));
 await fs.writeFile(path.join(journal,'runs.jsonl'),JSON.stringify({startedAt:'2026-10-19T00:59:30Z',result:'success'})+'\n');
 const recent=await readImportStatus({...args,now:completed+60000});assert.equal(recent.state,'recent');assert.equal(recent.total,15);assert.equal(JSON.stringify(recent).includes('secret'),false);
 assert.equal((await readImportStatus({...args,now:completed+300001})).state,'stale');
 await fs.appendFile(path.join(journal,'runs.jsonl'),JSON.stringify({startedAt:'2026-10-19T01:01:00Z',result:'failed',code:'HKTV_CONNECTION_FAILED'})+'\n'+ '{"partial":');
 assert.equal((await readImportStatus({...args,now:completed+120000})).state,'error');
 await fs.writeFile(checkpoint,JSON.stringify({storeCode:'OTHER',total:15}));await assert.rejects(readImportStatus(args),/checkpoint_invalid/);
 await fs.writeFile(checkpoint,' '.repeat(65537));await assert.rejects(readImportStatus(args),/checkpoint_invalid/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
