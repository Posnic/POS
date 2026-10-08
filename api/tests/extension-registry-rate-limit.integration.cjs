'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { initializeRateLimits, createRegistryRateLimit } = require('../src/services/extension-registry-rate-limit');
let mongo, client, db;
before(async()=>{mongo=await MongoMemoryServer.create();client=await MongoClient.connect(mongo.getUri());db=client.db('limits');await initializeRateLimits(db)});
after(async()=>{await client?.close();await mongo?.stop()});
async function request(middleware,id='account') {
  const result={headers:{},status:200};
  const res={set:(k,v)=>result.headers[k]=v,status:n=>{result.status=n;return res},json:body=>{result.body=body}};
  await middleware({libraryActor:{id}},res,()=>{result.allowed=true});return result;
}
const options={bucket:'downloads',limit:5,windowMs:10000,subject:req=>req.libraryActor.id};
test('concurrent processes share an atomic limit, without storing account identity',async()=>{
  const a=createRegistryRateLimit({...options,db,clock:()=>1000}),b=createRegistryRateLimit({...options,db,clock:()=>1000});
  const results=await Promise.all(Array.from({length:24},(_,i)=>request(i%2?a:b)));
  assert.equal(results.filter(r=>r.allowed).length,5);
  for(const r of results.filter(r=>!r.allowed)){assert.equal(r.status,429);assert.equal(r.headers['Retry-After'],'9');assert.equal(r.headers['Cache-Control'],'private, no-store')}
  const rows=await db.collection('registry_rate_limits').find().toArray();assert.equal(rows.length,1);assert.equal(rows[0].count,24);assert.equal(JSON.stringify(rows).includes('account'),false);
  assert.equal((await request(a,'other-account')).allowed,true);
});
test('new windows do not depend on TTL cleanup; separate operations have separate budgets',async()=>{
  const next=createRegistryRateLimit({...options,db,clock:()=>10000});assert.equal((await request(next)).allowed,true);
  const other=createRegistryRateLimit({...options,db,bucket:'invitations',clock:()=>1000});assert.equal((await request(other)).allowed,true);
});
test('bad subjects and database failure fail closed without leaking details',async()=>{
  const bad=createRegistryRateLimit({...options,db,subject:()=>undefined});assert.equal((await request(bad)).status,503);
  const broken=createRegistryRateLimit({...options,db:{collection:()=>{throw Error('secret database address')}}});
  const r=await request(broken);assert.equal(r.status,503);assert.equal(JSON.stringify(r).includes('secret'),false);assert.equal(r.allowed,undefined);
  assert.throws(()=>createRegistryRateLimit({...options,db,limit:0}),/configuration/);
});
