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

test('exports typed customer references without embedding customer objects or changing source',()=>{
 const id=new ObjectId(),doc={_id:'sale',customer_id:id,customer:String(id),sales_total:105},before=JSON.stringify(doc);
 const value=JSON.parse(exportSale(doc).sourceJson);expect(value.customerReferences).toEqual({version:1,customerId:{kind:'objectId',value:String(id)},legacyCustomer:{kind:'string',value:String(id)}});expect(value.values).not.toHaveProperty('customer_id');expect(value.values).not.toHaveProperty('customer');expect(JSON.stringify(doc)).toBe(before);
 const unsafe=exportSale({_id:'sale',customer_id:{email:'private@example.test'},customer:null});expect(unsafe.sourceJson).not.toContain('private');expect(JSON.parse(unsafe.sourceJson).customerReferences.customerId).toEqual({kind:'unsupported'});
 expect(JSON.parse(exportSale({_id:'sale'}).sourceJson)).not.toHaveProperty('customerReferences');
});

test('settlement projection distinguishes wallet usage and legacy payments without exposing their notes',()=>{
 for(const field of ['wallet_amount','payments.amount','payments.method','payments.date'])expect(projection[field]).toBe(1);
 for(const field of ['payments','payments.reference','payments.notes','payments.origin','payments.order_photos'])expect(projection).not.toHaveProperty(field);
 const original={_id:'wallet-sale',wallet_amount:40,payments:[{amount:40,method:'card',date:'2026-11-12T10:00:00.000Z'}]},before=JSON.stringify(original),value=exportSale(original);
 expect(JSON.stringify(original)).toBe(before);expect(JSON.parse(value.sourceJson).values.wallet_amount).toBe(40);expect(JSON.parse(value.sourceJson).values.payments).toEqual(original.payments);
 expect(exportSale({...original,wallet_amount:0}).revision).not.toBe(value.revision);
});
