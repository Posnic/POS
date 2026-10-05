'use strict';
// Explicit opt-in AWS check. Uses an isolated MongoDB and deletes its own S3 object.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const { S3Client, DeleteObjectCommand, GetPublicAccessBlockCommand } = require('@aws-sdk/client-s3');

(async () => {
  assert.equal(process.env.CAPTAIN_LIVE_AWS_CHECK, '1', 'Set CAPTAIN_LIVE_AWS_CHECK=1 explicitly');
  assert.ok(process.env.ORDER_PHOTO_BUCKET && process.env.AWS_REGION, 'Set the private bucket and region');
  const fixture = fs.readFileSync(process.argv[2]);
  const expected = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : {
    table: '4', pax: 5, lines: [['CB',5],['MB',2],['PBM',1]],
  };
  const data = 'data:image/png;base64,' + fixture.toString('base64');
  const paper = require('../src/services/paper-order');
  const s3 = new S3Client({region:process.env.AWS_REGION});
  const privacy = await s3.send(new GetPublicAccessBlockCommand({Bucket:process.env.ORDER_PHOTO_BUCKET}));
  for (const key of ['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets'])
    assert.equal(privacy.PublicAccessBlockConfiguration[key], true, key);
  const memory = await MongoMemoryServer.create();
  const license = new ObjectId(), branchId = new ObjectId(), user = new ObjectId(), id = crypto.randomUUID();
  const key = `orders/${license}/${branchId}/${id}`;
  try {
    await mongoose.connect(memory.getUri('captain_live_aws_verification'));
    const db = mongoose.connection.db;
    await db.collection('branches').insertOne({_id:branchId,license,captain_paper_orders:true});
    const req = {db,user:{_id:user,access:{sales:{write:true}}},tenantContext:{branchId,licenseId:license},body:{id,original:data}};
    const result = await paper.recognize(req);
    assert.equal(result.table,expected.table);
    assert.equal(result.pax,expected.pax);
    assert.deepEqual(result.lines.map(line=>[line.name,line.quantity]),expected.lines);
    assert.deepEqual(await paper.recognize(req),result);
    assert.equal((await db.collection('paper_order_usage').findOne({})).count,1,'Retry must not consume another scan');
    const photo = await paper.read({...req,params:{id}});
    assert.equal(photo.data,data,'Photo bytes must survive upload and retrieval');
    await assert.rejects(paper.read({...req,user:{...req.user,_id:new ObjectId()},params:{id}}),{status:404});
    const reference = await paper.reference(db,{license,branchId},id,'verification-order',user);
    assert.equal(reference.id,id);
    assert.equal(reference.uploaded_by,String(user));
    await assert.rejects(paper.reference(db,{license,branchId},id,'another-order',user),{status:409});
    console.log(JSON.stringify({passed:true,privateBucket:true,liveRecognition:true,table:result.table,pax:result.pax,
      lines:result.lines.map(line=>({name:line.name,quantity:line.quantity})),photoRoundtrip:true,retryUsesSavedResult:true,
      draftOwnershipEnforced:true,orderBindingEnforced:true,fixture:'generated handwriting-style sample; not handwriting quality acceptance'}));
  } finally {
    await s3.send(new DeleteObjectCommand({Bucket:process.env.ORDER_PHOTO_BUCKET,Key:key}));
    await mongoose.disconnect();
    await memory.stop();
    s3.destroy();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
