'use strict';
const {createHash}=require('node:crypto');
const {ObjectId}=require('mongodb');
const {exportSale,projection}=require('../../../src/v1/accounting-source');

describe('accounting source snapshots',()=>{
  test('does not conflate a native ID and its legacy string spelling',()=>{
    const id=new ObjectId();
    const native=exportSale({_id:id,sales_total:105});
    const legacy=exportSale({_id:String(id),sales_total:105});
    expect(native.sourceId).toEqual({kind:'objectId',value:String(id)});
    expect(legacy.sourceId).toEqual({kind:'string',value:String(id)});
    expect(native.revision).not.toBe(legacy.revision);
  });
  test('stable bytes survive field ordering without rewriting saved values',()=>{
    const doc={_id:'one',sales_total:'105.00',currencyCode:'AED',payment_mode:'Cash'};
    const before=JSON.stringify(doc);
    const first=exportSale(doc);
    const reordered=exportSale({payment_mode:'Cash',currencyCode:'AED',sales_total:'105.00',_id:'one'});
    expect(first).toEqual(reordered);
    expect(JSON.stringify(doc)).toBe(before);
    expect(JSON.parse(first.sourceJson).values.sales_total).toBe('105.00');
    expect(first.revision).toBe(createHash('sha256').update(first.sourceJson,'utf8').digest('hex'));
    expect(exportSale({...doc,sales_total:'110.00'}).revision).not.toBe(first.revision);
  });
  test('keeps missing currency missing and excludes contact fields from the database projection',()=>{
    const source=JSON.parse(exportSale({_id:'one',sales_total:0}).sourceJson);
    expect(source.values).not.toHaveProperty('currencyCode');
    expect(source.values.sales_total).toBe(0);
    expect(projection).not.toHaveProperty('customer_email');
    expect(projection).not.toHaveProperty('customer_phone');
    expect(Object.values(projection).every(value=>value===1)).toBe(true);
  });
});
