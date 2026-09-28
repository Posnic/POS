const {test}=require('node:test');
const assert=require('node:assert/strict');
const actor=require('../api/src/helpers/kitchen-actor');
const {runWithRequestContext}=require('../api/src/utils/request-context');
test('ordering identity is request-local and absent for anonymous requests',async()=>{
 assert.deepEqual(actor(),{id:'',name:''});
 const ids=['aaaaaaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbbbbbb'];
 const results=await Promise.all(ids.map((id,i)=>runWithRequestContext({loggedUser:id,loggedUserName:'Captain '+i},async()=>{await new Promise(r=>setImmediate(r));return actor();})));
 assert.deepEqual(results.map(x=>x.id),ids);assert.deepEqual(actor(),{id:'',name:''});
});
