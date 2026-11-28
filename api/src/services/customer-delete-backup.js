"use strict";
const {isDeepStrictEqual}=require('node:util');
const {BSON}=require('mongodb');
const metadata=['deleted_date','deleted_by'];
function original(backup){
 const value={...backup};for(const key of metadata)delete value[key];return value;
}
function same(left,right){
 return isDeepStrictEqual(BSON.EJSON.serialize(left,{relaxed:false}),BSON.EJSON.serialize(right,{relaxed:false}));
}
async function verifyOrInsert(collection, source, actor){
 if(metadata.some(key=>Object.hasOwn(source,key)))throw new Error('Customer contains deletion metadata; review its original backup before deleting.');
 const backup={...source,deleted_date:new Date(),deleted_by:actor||'system'};
 try {await collection.insertOne(backup);return;}
 catch(error){if(error.code!==11000)throw error;}
 const saved=await collection.findOne({_id:source._id,license:source.license});
 if(!saved||!same(original(saved),source))throw new Error('Customer deletion backup differs from the current customer. Keep both records for review.');
 // A previous acknowledged or lost-reply insert already saved this exact source.
 // Retain its original deletion metadata; never overwrite a different backup.
}
async function saveMany(collection,sources,actor){
 if(sources.some(source=>metadata.some(key=>Object.hasOwn(source,key))))throw new Error('Customer contains deletion metadata; review its original backup before deleting.');
 try {
  await collection.insertMany(sources.map(source=>({...source,deleted_date:new Date(),deleted_by:actor||'system'})));
 }catch(error){
  if(error.code!==11000)throw error;
  // Ordered inserts can stop after a partial write. Verify existing originals
  // and fill missing backups before the caller attempts any customer deletion.
  for(const source of sources)await verifyOrInsert(collection,source,actor);
 }
}
module.exports={save:verifyOrInsert,saveMany};
