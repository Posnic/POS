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
