'use strict';
const {project}=require('../../../src/services/captain-transfer-projection');
const {buildBillPayload}=require('../../../src/helpers/bill-payload');
const {snapshotFrom}=require('../../../src/services/guest-bill.service');
const Money=require('../../../src/utils/currency');
const at='2026-09-30T14:00:00Z';
function sale(){return {_id:'source',table_number:'1',created_date:at,sales_sub_total:100.01,discount:3.17,tax:5.01,sales_total:101.84,
  items:[{item_id:'corn',line_id:'salt',item_name:'Corn',item_quantity:3,item_base_price:33.3366667,item_tax:5.01}],
  changes:[{timestamp:at,items:[{item_id:'corn',line_id:'salt',item_name:'Corn',item_quantity:3,process:'add'}]}]};}
test.each(['JPY','INR','KWD'])('financial projection conserves every component in printed and split bills for %s',currencyCode=>{
  const original=sale(),before=structuredClone(original),branch={currencyCode,indian_gst:'enable'},policy=Money.policy(branch);
  const result=project(original,branch,[{id:'c0i0',quantity:1}],at);
  expect(original).toEqual(before);
  for(const side of ['source','destination']) {
    const projected={...original,...result[side]},expected=result.preview[side];
    const bill=buildBillPayload(projected,branch),snapshot=snapshotFrom([projected],branch,'1');
    expect(Money.toMinor(bill.total,policy)).toBe(expected.totalMinor);
    expect(Money.toMinor(bill.subTotal,policy)).toBe(expected.components.base);
    expect(snapshot.lines.map(row=>row.components)).toEqual(expected.lines.map(row=>row.components));
    expect(snapshot.totalMinor).toBe(expected.totalMinor);
    expect(projected.items.reduce((sum,item)=>sum+Money.toMinor(item.item_tax,policy),0)).toBe(Money.toMinor(projected.tax,policy));
    expect(projected.items[0].item_base_price).toBe(original.items[0].item_base_price);
    for(const tax of bill.taxes)expect(Money.toMinor(tax.amount,policy)).toBe(expected.components['tax:'+tax.label]);
  }
});
test('another transfer keeps the previous allocated pennies instead of repricing reduced quantities',()=>{
  const original=sale(),branch={currencyCode:'INR',indian_gst:'enable'};
  const first=project(original,branch,[{id:'c0i0',quantity:1}],at);
  const second=project({...original,...first.source},branch,[{id:'c0i0',quantity:1}],at);
  expect(second.preview.totalMinor).toBe(first.preview.source.totalMinor);
  for(const [key,minor] of Object.entries(first.preview.source.components))
    expect((second.preview.source.components[key]||0)+(second.preview.destination.components[key]||0)).toBe(minor);
});
test('stale quantity or amount cannot silently reuse a transferred bill allocation',()=>{
  const original=sale(),branch={currencyCode:'INR'};
  const result=project(original,branch,[{id:'c0i0',quantity:1}],at);
  const changed={...original,...structuredClone(result.destination)};
  changed.items[0].item_quantity=2;
  expect(()=>buildBillPayload(changed,branch)).toThrow('bill changed');
  expect(()=>snapshotFrom([{...original,...result.destination,sales_total:100}],branch,'1')).toThrow('bill changed');
  expect(()=>buildBillPayload({...original,...result.destination},{currencyCode:'KWD'})).toThrow('bill changed');
});

test('per-line allocations and tax labels remain exact across multiple preparations',()=>{
  const original=sale(),branch={currencyCode:'INR',indian_gst:'enable'};
  original.items.push({...original.items[0],line_id:'plain',item_name:'Plain corn',item_quantity:2,item_base_price:9.995,item_tax:3.60});
  original.changes.push({timestamp:at,items:[{...original.items[1],process:'add'}]});
  original.sales_sub_total=120;original.tax=8.61;original.sales_total=125.44;
  const result=project(original,branch,[{id:'c0i0',quantity:1},{id:'c1i0',quantity:1}],at);
  for(const side of ['source','destination']) {
    const projected={...original,...result[side]},snapshot=snapshotFrom([projected],branch,'1');
    expect(snapshot.lines.map(line=>line.components)).toEqual(result.preview[side].lines.map(line=>line.components));
    const printed=buildBillPayload(projected,branch);
    expect(printed.items.map(line=>Money.toMinor(line.amount,Money.policy(branch)))).toEqual(result.preview[side].lines.map(line=>line.components.find(component=>component.key==='base').minor));
  }
  const corrupted={...original,...structuredClone(result.destination)};
  corrupted.captain_transfer_allocation.lines[0].name='Changed allocation';
  expect(()=>buildBillPayload(corrupted,branch)).toThrow('bill changed');
});

test('projected per-item tax aliases and components agree with each allocated bill',()=>{
  const original=sale(),branch={currencyCode:'INR',indian_gst:'enable'},policy=Money.policy(branch);
  original.items[0].tax_amount=original.items[0].item_tax;
  original.items[0].tax_components=[{name:'CGST',amount:2.505},{name:'SGST',amount:2.505}];
  const result=project(original,branch,[{id:'c0i0',quantity:1}],at);
  for(const side of ['source','destination']) {
    const item=result[side].items[0];
    expect(item.tax_amount).toBe(item.item_tax);
    expect(item.tax_components.reduce((sum,row)=>sum+Money.toMinor(row.amount,policy),0)).toBe(Money.toMinor(item.item_tax,policy));
  }
  expect(Money.toMinor(result.source.tax,policy)+Money.toMinor(result.destination.tax,policy)).toBe(501);
});

test('seat and language updates refresh guest bills without changing allocated money',()=>{
  const original=sale(),branch={currencyCode:'INR'};
  Object.assign(original.items[0],{seat:1,default_language:'en',translations:[{locale:'ta',name:'Original translation'}]});
  const result=project(original,branch,[{id:'c0i0',quantity:1}],at);
  const changed={...original,...structuredClone(result.source)};
  Object.assign(changed.items[0],{seat:2,translations:[{locale:'ta',name:'Updated translation'}]});
  const snapshot=snapshotFrom([changed],branch,'1');
  expect(snapshot.lines[0].seat).toBe(2);
  expect(snapshot.lines[0].translations).toEqual([{locale:'ta',name:'Updated translation'}]);
  expect(snapshot.lines[0].components).toEqual(result.preview.source.lines[0].components);
  expect(snapshot.totalMinor).toBe(result.preview.source.totalMinor);
  const next=project(changed,branch,[{id:'c0i0',quantity:1}],at);
  expect(next.preview.destination.lines[0].seat).toBe(2);
  delete changed.items[0].seat;
  delete changed.items[0].default_language;
  delete changed.items[0].translations;
  const cleared=snapshotFrom([changed],branch,'1');
  expect(cleared.lines[0].seat).toBe(0);
  expect(cleared.lines[0]).not.toHaveProperty('translations');
  expect(cleared.lines[0]).not.toHaveProperty('default_language');
  expect(cleared.totalMinor).toBe(snapshot.totalMinor);
});
