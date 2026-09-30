'use strict';
const { plan } = require('../../../src/services/captain-transfer-plan');
const { snapshotFrom } = require('../../../src/services/guest-bill.service');
const branch = { currencyCode: 'INR', currency: '₹' };
function sale() {
  return {
    _id: 'source-sale', table_number: '6', sales_sub_total: 100.01,
    discount: 3.17, tax: 5.01, sales_total: 101.84,
    created_date: '2026-09-30T08:00:00Z',
    items: [{ item_id: 'corn', line_id: 'corn-salt', name: 'Baby corn', quantity: 3,
      unit_price: 33.3366667, item_tax: 5.01, item_description: 'Salt and pepper', seat: 2 }],
    changes: [{timestamp:'2026-09-30T08:00:00Z',items:[{item_id:'corn',line_id:'corn-salt',
      item_name:'Baby corn',item_quantity:2,item_description:'Salt and pepper',seat:2,process:'add'}]},
    {timestamp:'2026-09-30T08:25:00Z',items:[{item_id:'corn',line_id:'corn-salt',
      item_name:'Baby corn',item_quantity:1,item_description:'Salt and pepper',seat:2,process:'add'}]}],
    kitchen_service: {c0i0:{quantity:1,at:'2026-09-30T08:20:00Z'}},
  };
}
test('partial transfer preserves each tax, discount and round-off component and original service round',()=>{
  const original=sale(), before=structuredClone(original);
  const result=plan(original,branch,[{id:'c1i0',quantity:1}]);
  const snapshot=snapshotFrom([original],branch,'6');
  expect(result.source.totalMinor+result.destination.totalMinor).toBe(snapshot.totalMinor);
  const expected=Object.fromEntries(snapshot.lines[0].components.map(row=>[row.key,row.minor]));
  for(const [key,amount] of Object.entries(expected))
    expect((result.source.components[key]||0)+(result.destination.components[key]||0)).toBe(amount);
  expect(result.destination.rounds).toEqual([expect.objectContaining({id:'c1i0',
    ordered_at:'2026-09-30T08:25:00.000Z',quantity:1,served:0,remaining:1,note:'Salt and pepper',seat:2,
    origin:{saleId:'source-sale',roundLineId:'c1i0'}})]);
  expect(result.source.rounds[0]).toMatchObject({quantity:2,served:1,remaining:1});
  expect(original).toEqual(before);
});
test('mixed served and unserved quantities require an explicit choice and conserve both states',()=>{
  expect(()=>plan(sale(),branch,[{id:'c0i0',quantity:1}])).toThrow('served quantity');
  const result=plan(sale(),branch,[{id:'c0i0',quantity:1,servedQuantity:1}]);
  expect(result.destination.rounds[0]).toMatchObject({quantity:1,served:1,remaining:0});
  expect(result.source.rounds[0]).toMatchObject({quantity:1,served:0,remaining:1});
  expect(()=>plan(sale(),branch,[{id:'c0i0',quantity:1,servedQuantity:2}])).toThrow();
});
test('moving all rounds carries the exact bill and leaves no source amount or service rows',()=>{
  const result=plan(sale(),branch,[{id:'c0i0',quantity:2},{id:'c1i0',quantity:1}]);
  expect(result.source).toEqual({lines:[],rounds:[],components:{},totalMinor:0});
  expect(result.destination.totalMinor).toBe(10184);
  expect(result.destination.rounds[0].served).toBe(1);
});
test.each([
  [],[{id:'missing',quantity:1}],[{id:'c1i0',quantity:2}],
  [{id:'c1i0',quantity:1},{id:'c1i0',quantity:1}],
  [{id:'c1i0',quantity:0.0001}],[{id:'c1i0',quantity:NaN}],
].map(selection=>({selection})))('invalid or stale transfer selection is refused: %j',({selection})=>{
  expect(()=>plan(sale(),branch,selection)).toThrow();
});
test('duplicate product preparations retain distinct line identities and notes',()=>{
  const original=sale();
  original.items.push({...original.items[0],line_id:'corn-plain',quantity:1,item_description:'No pepper'});
  original.changes.push({timestamp:'2026-09-30T08:30:00Z',items:[{item_id:'corn',line_id:'corn-plain',
    item_name:'Baby corn',item_quantity:1,item_description:'No pepper',process:'add'}]});
  const result=plan(original,branch,[{id:'c2i0',quantity:1}]);
  expect(result.destination.lines).toHaveLength(1);
  expect(result.destination.lines[0].lineKey).toBe('corn-plain');
  expect(result.destination.rounds[0].note).toBe('No pepper');
  expect(result.source.lines[0].lineKey).toBe('corn-salt');
});
test.each(['JPY','INR','KWD'])('fractional quantities conserve the original minor units for %s',currencyCode=>{
  const original=sale();
  original.items[0].quantity=0.003;
  original.changes=[];original.kitchen_service={};
  const {rounds}=require('../../../src/helpers/kitchen-rounds');
  const id=rounds(original)[0].items[0].id;
  const result=plan(original,{currencyCode},[{id,quantity:0.001}]);
  expect(result.source.lines[0].quantity).toBe(0.002);
  expect(result.destination.lines[0].quantity).toBe(0.001);
  expect(result.source.totalMinor+result.destination.totalMinor).toBe(result.totalMinor);
});
test('large amounts and thousandth quantities retain every minor unit',()=>{
  const original=sale();
  original.sales_total=9999999999.99;original.sales_sub_total=9999999999.99;
  original.discount=0;original.tax=0;original.items[0].quantity=999999.999;
  original.changes=[];original.kitchen_service={};
  const {rounds}=require('../../../src/helpers/kitchen-rounds');
  const id=rounds(original)[0].items[0].id;
  const result=plan(original,branch,[{id,quantity:333333.333}]);
  expect(result.source.totalMinor).toBe(666666666666);
  expect(result.destination.totalMinor).toBe(333333333333);
});
test('serving an item invalidates the preview even without a billing timestamp change',()=>{
  const original=sale();
  const before=plan(original,branch,[{id:'c1i0',quantity:1}]);
  original.kitchen_service.c1i0={quantity:1,at:'2026-09-30T08:40:00Z'};
  const after=plan(original,branch,[{id:'c1i0',quantity:1}]);
  expect(after.revision).not.toBe(before.revision);
  expect(after.destination.rounds[0].served).toBe(1);
});


test('readiness and pickup changes invalidate a transfer preview without changing the bill',()=>{
  const original=sale();
  const before=plan(original,branch,[{id:'c1i0',quantity:1}]);
  original.kitchen_work={c1:{state:'preparing',revision:1,lines:{c1i0:{ready:1,collected:0}}}};
  const ready=plan(original,branch,[{id:'c1i0',quantity:1}]);
  expect(ready.revision).not.toBe(before.revision);
  original.kitchen_work.c1.lines.c1i0.collected=1;
  expect(plan(original,branch,[{id:'c1i0',quantity:1}]).revision).not.toBe(ready.revision);
});


test('partial transfer preserves ready and collected quantities and pickup ownership',()=>{
  const original=sale();
  original.items[0].quantity=5;
  original.changes[0].items[0].item_quantity=4;
  original.kitchen_work={c0:{state:'preparing',lines:{c0i0:{ready:3,collected:2,collector:'staff-4',collectorName:'Priya',readyVersion:2}}}};
  const result=plan(original,branch,[{id:'c0i0',quantity:2,servedQuantity:0}]);
  expect(result.destination.rounds[0]).toMatchObject({quantity:2,served:0,collected:1,ready:2,collector:'staff-4',collectorName:'Priya',readyVersion:2,kitchenState:'preparing'});
  expect(result.source.rounds[0]).toMatchObject({quantity:2,served:1,collected:1,ready:1});
  for(const field of ['ready','collected','served'])
    expect(result.source.rounds[0][field]+result.destination.rounds[0][field]).toBe({ready:3,collected:2,served:1}[field]);
});

test('whole-round transfer carries legacy ready state without losing pending pickup',()=>{
  const original=sale();original.kitchen_work={c1:{state:'ready'}};
  const result=plan(original,branch,[{id:'c1i0',quantity:1}]);
  expect(result.destination.rounds[0]).toMatchObject({ready:1,collected:0,served:0,kitchenState:'ready'});
});

test('all partial selections preserve the service ordering and total counts',()=>{
  for(let quantity=1;quantity<=5;quantity++) for(let served=0;served<=quantity;served++) {
    const original=sale();original.items[0].quantity=5;original.changes=[original.changes[0]];
    original.changes[0].items[0].item_quantity=5;original.kitchen_service.c0i0.quantity=2;
    original.kitchen_work={c0:{state:'preparing',lines:{c0i0:{ready:4,collected:3}}}};
    if(served>2 || quantity-served>3)continue;
    const result=plan(original,branch,[{id:'c0i0',quantity,servedQuantity:served}]);
    const rows=[...result.source.rounds,...result.destination.rounds];
    for(const row of rows){expect(row.served).toBeLessThanOrEqual(row.collected);expect(row.collected).toBeLessThanOrEqual(row.ready);expect(row.ready).toBeLessThanOrEqual(row.quantity);}
    for(const [field,total] of Object.entries({quantity:5,served:2,collected:3,ready:4}))expect(rows.reduce((n,row)=>n+row[field],0)).toBe(total);
  }
});
