const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../frontend/static/script/js/modules/js/order-journal');
function setup(){
 const data=new Map();let scope={server:'https://shop/api',branch:'branch-1',user:'staff-1'};
 const storage={get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 return {storage,data,scope,open:()=>create(storage,()=>scope)};
}
const payload=()=>({idempotencyKey:'request-1',items:[{id:'dish',quantity:2,note:'no salt'}],sales_total:200});
test('reload recovers the exact order without approval credentials',()=>{
 const a=setup();a.open().save({...payload(),approval_token:'secret',approval_tokens:['secret2']});
 const [entry]=a.open().pending();assert.deepEqual(entry.payload,payload());assert.equal(entry.id,'request-1');
});
test('pending records are isolated by server, branch and staff',()=>{
 const a=setup();a.open().save(payload());
 for(const field of ['server','branch','user']){const old=a.scope[field];a.scope[field]='other';assert.deepEqual(a.open().pending(),[]);a.scope[field]=old;}
 assert.equal(a.open().pending().length,1);
});
test('same request can renew approval but cannot change items or amounts',()=>{
 const a=setup();const journal=a.open();journal.save(payload());
 assert.equal(journal.save({...payload(),approval_token:'renewed'}).id,'request-1');
 assert.throws(()=>journal.save({...payload(),sales_total:201}),/previous submission/);
 assert.throws(()=>journal.save({...payload(),items:[{id:'dish',quantity:3}]}),/previous submission/);
 assert.deepEqual(journal.pending()[0].payload,payload());
});
test('storage failure prevents journaling and does not invent success',()=>{
 const a=setup();a.storage.setItem=()=>{throw new Error('full');};
 assert.throws(()=>a.open().save(payload()),/full/);assert.equal(a.data.size,0);
});
test('only confirmed success clears the pending order',()=>{
 const a=setup();const journal=a.open();const entry=journal.save(payload());
 assert.throws(()=>journal.confirm(entry,{type:'error'}));assert.equal(journal.pending().length,1);
 journal.confirm(entry,{type:'success',data:{_id:'sale-1'}});assert.equal(journal.pending().length,0);
});
test('account switch cannot acknowledge another user order',()=>{
 const a=setup();const journal=a.open();const entry=journal.save(payload());a.scope.user='staff-2';
 assert.throws(()=>journal.confirm(entry,{type:'success',data:{_id:'sale-1'}}));
 a.scope.user='staff-1';assert.equal(journal.pending().length,1);
});
test('failed removal retains a confirmed marker rather than an unsent order',()=>{
 const a=setup();const journal=a.open();const entry=journal.save(payload());a.storage.removeItem=()=>{throw new Error('blocked');};
 journal.confirm(entry,{type:'success',data:{_id:'sale-1'}});assert.equal(a.data.size,1);assert.equal(journal.pending().length,0);
 assert.equal(journal.save(payload()).state,'confirmed');
});

test('desktop submission stores before posting and acknowledges only success',()=>{
 const fs=require('node:fs');const source=fs.readFileSync('frontend/static/script/js/modules/js/sales.js','utf8');
 const start=source.indexOf('            var savedSubmission;');
 const part=source.slice(start,source.indexOf("url: 'setting/salesSmsReceipt'",start));
 assert.ok(part.indexOf('submissionJournal().save(JSON.parse(params.data))') < part.indexOf('PosnicPro.post(params'));
 assert.ok(part.indexOf("if (response.type === 'success')") < part.indexOf('submissionJournal().confirm(savedSubmission, response)'));
 const map=JSON.parse(fs.readFileSync('frontend/pages_css_js_map.json','utf8'));
 assert.ok(JSON.stringify(map).includes('modules/js/order-journal.js'));
});

test('journal validation messages use the supplied translator',()=>{
 const a=setup();const journal=create(a.storage,()=>a.scope,(key)=>'translated:'+key);
 assert.throws(()=>journal.save({}),/translated:lang_submission_id_required/);
});
