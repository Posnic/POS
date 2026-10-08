'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {MongoMemoryServer}=require('mongodb-memory-server');
const {MongoClient}=require('mongodb');
const {createExtensionRegistryApp}=require('../src/extension-registry-app');
const {issueSession}=require('../src/services/extension-registry-sessions');
let mongo,client;
before(async()=>{mongo=await MongoMemoryServer.create();client=await MongoClient.connect(mongo.getUri())});
after(async()=>{await client?.close();await mongo?.stop()});
async function fixture(limits={}){
 const db=client.db('app_'+crypto.randomBytes(5).toString('hex'));
 const app=await createExtensionRegistryApp({db,client,readBlob:async()=>{throw Error('private storage secret')},limits});
 await db.collection('registry_accounts').insertOne({_id:'owner',status:'active',authVersion:1,emailVerified:true,email:'owner@example.test'});
 await db.collection('library_memberships').insertOne({organizationId:'org',userId:'owner',role:'owner',status:'active'});
 const {token}=await issueSession(db,'owner');
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});
 return {db,url:'http://127.0.0.1:'+server.address().port,headers:{authorization:'Bearer '+token},close:()=>new Promise(r=>server.close(r))};
}
test('composed library and invitations require registry identity and isolate organizations',async()=>{
 const f=await fixture();try{
 for(const path of ['/v1/library/organizations/org/releases','/v1/invitations/organizations/org/invitations']){
 const r=await fetch(f.url+path);assert.equal(r.status,401);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-powered-by'),null)}
 let r=await fetch(f.url+'/v1/library/organizations/org/releases',{headers:f.headers});assert.equal(r.status,200);assert.deepEqual(await r.json(),{releases:[]});
 r=await fetch(f.url+'/v1/library/organizations/other/releases',{headers:f.headers});assert.equal(r.status,404);
 r=await fetch(f.url+'/v1/invitations/organizations/org/invitations',{method:'POST',headers:{...f.headers,'content-type':'application/json'},body:JSON.stringify({email:'new@example.test',role:'owner',userId:'spoof'})});assert.equal(r.status,201);
 const invite=await f.db.collection('library_invitations').findOne();assert.equal(invite.invitedBy,'owner');assert.equal(invite.recipient,'new@example.test');assert.equal(invite.role,undefined);
 }finally{await f.close()}
});
test('socket-based edge limit cannot be bypassed using forwarded addresses',async()=>{
 const f=await fixture({edge:2});try{
 for(let i=0;i<3;i++){const r=await fetch(f.url+'/v1/library/organizations/org/releases',{headers:{...f.headers,'x-forwarded-for':'192.0.2.'+i}});assert.equal(r.status,i<2?200:429)}
 }finally{await f.close()}
});
test('account limiter and parser failures are enforced by composed routes',async()=>{
 const f=await fixture({library:2});try{
 const url=f.url+'/v1/library/organizations/org/download-tickets';
 let r=await fetch(url,{method:'POST',headers:{...f.headers,'content-type':'application/json'},body:'{secret-invalid'});assert.equal(r.status,400);assert.equal((await r.text()).includes('secret'),false);
 r=await fetch(url,{method:'POST',headers:{...f.headers,'content-type':'application/json'},body:JSON.stringify({padding:'x'.repeat(10000)})});assert.equal(r.status,413);
 r=await fetch(url,{method:'POST',headers:f.headers});assert.equal(r.status,429);
 }finally{await f.close()}
});

test('organization discovery is paginated, account-scoped and reflects revoked membership',async()=>{
 const f=await fixture();try{
 await f.db.collection('library_memberships').insertMany([
 ...Array.from({length:51},(_,i)=>({organizationId:'shop'+String(i).padStart(2,'0'),userId:'owner',role:'member',status:'active'})),
 {organizationId:'foreign',userId:'another',role:'owner',status:'active'},
 {organizationId:'revoked',userId:'owner',role:'owner',status:'revoked'}]);
 const url=f.url+'/v1/session/organizations';
 let r=await fetch(url,{headers:f.headers});assert.equal(r.status,200);const first=await r.json();
 assert.equal(first.organizations.length,50);assert.equal(first.next,'shop48');
 assert.equal(first.organizations.some(o=>['foreign','revoked'].includes(o.organizationId)),false);
 assert.deepEqual(Object.keys(first.organizations[0]).sort(),['organizationId','role']);
 r=await fetch(url+'?after='+first.next,{headers:f.headers});const last=await r.json();assert.equal(last.organizations.length,2);assert.equal(last.next,null);
 await f.db.collection('library_memberships').updateOne({organizationId:'shop50',userId:'owner'},{$set:{status:'revoked'}});
 r=await fetch(url+'?after=shop49',{headers:f.headers});assert.deepEqual(await r.json(),{organizations:[],next:null});
 r=await fetch(url+'?after[$gt]=x',{headers:f.headers});assert.equal(r.status,400);
 }finally{await f.close()}
});
test('sign-out revokes only the authenticated session and does not alter offline entitlements',async()=>{
 const f=await fixture();try{
 const other=await issueSession(f.db,'owner');
 await f.db.collection('library_entitlements').insertOne({organizationId:'org',extensionId:'example',status:'active',releaseIds:['one']});
 let r=await fetch(f.url+'/v1/session/logout',{method:'POST',headers:f.headers});assert.equal(r.status,204);assert.equal(r.headers.get('cache-control'),'private, no-store');
 r=await fetch(f.url+'/v1/session/organizations',{headers:f.headers});assert.equal(r.status,401);
 r=await fetch(f.url+'/v1/session/organizations',{headers:{authorization:'Bearer '+other.token}});assert.equal(r.status,200);
 assert.equal(await f.db.collection('library_entitlements').countDocuments({status:'active'}),1);
 }finally{await f.close()}
});
