const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../api/scripts/smoke-restock.js'), 'utf8');
test('restock selects the same live fixture as billing smoke, preserving removed stock', async () => {
 const records=[{_id:'removed',name:'Notebook',del_status:1,available_quantity:99944},{_id:'live',name:'Pen',available_quantity:0}];
 const writes=[];
 const collection={find(filter){assert.deepEqual(Array.from(filter.del_status.$nin),[1,'1',true]);return {project(){return this},limit(){return this},async toArray(){return records.filter(r=>!filter.del_status.$nin.includes(r.del_status)).slice(0,1)}}},async updateOne(filter,update){writes.push({filter,update})},async findOne(){return null}};
 let finish;const done=new Promise(r=>finish=r);
 class MongoClient {async connect(){} db(){return {collection:()=>collection,admin:()=>({listDatabases:async()=>({databases:[]})})}} async close(){finish()}}
 vm.runInNewContext(source,{require:name=>name==='dotenv'?{config(){}}:{MongoClient,ObjectId:class{constructor(id){this.id=id}}},process:{env:{MONGODB_URI:'fixture',SMOKE_WRITE_TENANT:'sridhar'}},console:{log(){}}});
 await done;
 assert.equal(writes.length,1); assert.equal(writes[0].filter._id,'live'); assert.equal(writes[0].update.$set.available_quantity,100000);
});
