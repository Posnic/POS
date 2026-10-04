'use strict';
// Local-only restaurant for interactive native verification. Never uses an
// existing database: MongoMemoryServer creates and removes its own instance.
const crypto = require('node:crypto');
const path = require('node:path');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY = crypto.randomBytes(16).toString('hex');
process.env.ENCRYPTION_IV = crypto.randomBytes(8).toString('hex');
const mongoose = require('mongoose');
const {MongoMemoryServer} = require('mongodb-memory-server');
const {ObjectId} = require('mongodb');
let mongo, server;
async function stop() {
  server?.closeAllConnections();
  if (server) await new Promise(resolve=>server.close(resolve));
  await require('../src/models/base.model').closeConnection();
  await mongoose.disconnect();
  await mongo?.stop();
  process.exit(0);
}
async function start() {
  const binary=path.resolve(__dirname,'../../mongodb/bin/mongod.exe');
  mongo=await MongoMemoryServer.create({binary:require('node:fs').existsSync(binary)?{systemBinary:binary}:{}});
  process.env.MONGODB_URI=mongo.getUri('captain_native_verification');
  await mongoose.connect(process.env.MONGODB_URI);
  const db=mongoose.connection.db;
  const license=new ObjectId(), branch=new ObjectId(), user=new ObjectId(), category=new ObjectId();
  await db.collection('branches').insertOne({_id:branch,license,branch_name:'Captain Test Kitchen',module_captain_enable:true,table_options:true,online_ordering:{store_id:'captain-native-test'},currency:'INR',currency_symbol:'₹'});
  if(process.env.CAPTAIN_FIXTURE_TAX === '5') {
    const tax=new ObjectId();
    await db.collection('grouptax').insertOne({_id:tax,branch_id:branch,license,name:'GST 5%',rate:5,tax_fields:[]});
    await db.collection('branches').updateOne({_id:branch},{$set:{default_tax:tax}});
  }
  await db.collection('users').insertOne({_id:user,license,branch_id:branch,username:'captain-test',activate:true,usertype:'owner',password:await require('bcryptjs').hash('native-test-only',10),branch_access:[{branch_id:branch,branch_name:'Captain Test Kitchen'}],access:{sales:{write:true,read:true,merge:true}},authVersion:1});
  await db.collection('categories').insertOne({_id:category,license,category_name:'Food',name:'Food',status:'active'});
  for (const [name,price] of [['Chicken Biryani',220],['Coffee',40]]) await db.collection('items').insertOne({_id:new ObjectId(),license,branch_id:branch,category_id:category,category_name:'Food',branch_access:[{branch_id:branch}],name,item_name:name,selling_price:price,price,available_quantity:100,track_inventory:false,tax:0,tax_type:'exclusive',item_status:'active',status:'active'});
  for(let n=1;n<=8;n++)await db.collection('tableorder').insertOne({_id:new ObjectId(),license,branch_id:branch,tableorder_value:String(n),capacity:4,max_capacity:6});
  const port=Number(process.env.CAPTAIN_FIXTURE_PORT || 5198);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid fixture port');
  server=require('../app').listen(port,'127.0.0.1',()=>console.log(`NATIVE_FIXTURE_READY http://127.0.0.1:${port}/api (isolated test database)`));
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
start().catch(async error=>{console.error(error.message);await mongo?.stop();process.exit(1);});
