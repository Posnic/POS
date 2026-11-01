'use strict';
const { ObjectId } = require('mongodb');

// Read the last audited balance before the report boundary. Never substitute
// today's item balance for a historical closing stock. No inventory is written.
async function closingStock(db, { branch, license, end, itemIds }) {
  const result = new Map();
  const ids = [...new Set(itemIds.map(String))].filter((id) => ObjectId.isValid(id));
  if (!ObjectId.isValid(branch) || !ObjectId.isValid(license) || !ids.length) return result;
  const rows = await db
    .collection('stocklogs')
    .aggregate([
      {
        $match: {
          branch_id: new ObjectId(branch),
          license: new ObjectId(license),
          view_item_id: { $in: ids.map((id) => new ObjectId(id)) },
          is_deleted: { $ne: true },
        },
      },
      {
        $addFields: {
          report_date: {
            $convert: {
              input: { $ifNull: ['$date', '$created_date'] },
              to: 'date',
              onError: null,
              onNull: null,
            },
          },
        },
      },
      { $match: { report_date: { $ne: null, $lt: end } } },
      { $sort: { report_date: -1, _id: -1 } },
      { $group: { _id: '$view_item_id', balance: { $first: '$closing_balance' } } },
    ])
    .toArray();
  for (const row of rows) {
    const value = row.balance;
    if (
      value !== null &&
      value !== undefined &&
      String(value).trim() !== '' &&
      Number.isFinite(Number(value))
    )
      result.set(String(row._id), Number(value));
  }
  return result;
}
// Reconcile historical audited movements; never infer history from current stock.
async function reconciliation(db, {branch, license, start, end, itemIds}) {
  const ids=[...new Set(itemIds.map(String))].filter(ObjectId.isValid);
  if(!ids.length || !ObjectId.isValid(branch) || !ObjectId.isValid(license)) return new Map();
  const opening=await closingStock(db,{branch,license,end:start,itemIds:ids});
  const closing=await closingStock(db,{branch,license,end,itemIds:ids});
  const logs=await db.collection('stocklogs').aggregate([
    {$match:{branch_id:new ObjectId(branch),license:new ObjectId(license),view_item_id:{$in:ids.map(v=>new ObjectId(v))},is_deleted:{$ne:true}}},
    {$addFields:{report_date:{$convert:{input:{$ifNull:['$date','$created_date']},to:'date',onError:null,onNull:null}}}},
    {$match:{report_date:{$gte:start,$lt:end}}},{$sort:{report_date:1,_id:1}},{$limit:100001}
  ]).toArray();
  if(logs.length>100000) throw new Error('Narrow the date range for stock reconciliation.');
  const result=new Map(ids.map(id=>[id,{opening:opening.get(id)??null,received:0,sold:0,spoilage:0,otherIn:0,otherOut:0,closing:closing.get(id)??null,complete:true}]));
  const balances=new Map(opening);
  for(const l of logs) {
    const id=String(l.view_item_id),r=result.get(id);
    const number=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
    const before=number(l.opening_balance),after=number(l.closing_balance);
    if(before===null||after===null){r.complete=false;continue;}
    if(r.opening===null)r.opening=before;
    if(balances.has(id)&&Math.abs(balances.get(id)-before)>0.000001)r.complete=false;
    balances.set(id,after);
    const delta=Math.round((after-before)*1000)/1000, process=String(l.process||'').toLowerCase();
    if(l.spoilage_reference)r.spoilage-=delta;
    else if(delta>0 && (/purchase|receiv/.test(process)) && !/void|delete|return|cancel/.test(process))r.received+=delta;
    else if(delta<0 && /sale/.test(process) && !/return|delete|cancel/.test(process))r.sold-=delta;
    else if(delta>0)r.otherIn+=delta;
    else r.otherOut-=delta;
  }
  for(const r of result.values()) {
    for(const k of ['received','sold','spoilage','otherIn','otherOut'])r[k]=Math.round(r[k]*1000)/1000;
    if(r.opening===null||r.closing===null||Math.abs(r.opening+r.received+r.otherIn-r.sold-r.spoilage-r.otherOut-r.closing)>0.000001)r.complete=false;
    if(!r.complete)for(const k of ['received','sold','spoilage','otherIn','otherOut'])r[k]=null;
  }
  return result;
}
module.exports = { closingStock, reconciliation };
