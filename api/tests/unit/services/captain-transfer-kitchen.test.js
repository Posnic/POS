'use strict';
const {project}=require('../../../src/services/captain-transfer-kitchen');
const {rounds,tickets,cancellations}=require('../../../src/helpers/kitchen-rounds');
const branch={currencyCode:'INR'},at='2026-09-30T14:00:00Z';
const dish={item_id:'corn',line_id:'salt',item_name:'Corn',item_quantity:4,item_price:25,item_note:'Less salt',seat:2};
function sale(){return {_id:'source',created_date:'2026-09-30T13:00:00Z',table_number:'1',items:[dish],sales_sub_total:100,sales_total:100,
  changes:[{timestamp:'2026-09-30T13:00:00Z',items:[{...dish,item_quantity:2,process:'add'}]},
    {timestamp:'2026-09-30T13:30:00Z',items:[{...dish,item_quantity:2,process:'add'}]}],
  kitchen_service:{c0i0:{quantity:1,at:'2026-09-30T13:20:00Z'}},
  kitchen_work:{c0:{state:'ready',lines:{c0i0:{ready:2,collected:2,collector:'staff',readyVersion:7}}},c1:{state:'preparing'}}};}
test('projection preserves service quantities, collector, notes and both original rounds without mutation',()=>{
  const original=sale(),before=structuredClone(original);
  const result=project(original,branch,[{id:'c0i0',quantity:1,servedQuantity:1},{id:'c1i0',quantity:1}],at);
  expect(original).toEqual(before);
  expect(result.source.items[0].item_quantity).toBe(2);expect(result.destination.items[0].item_quantity).toBe(2);
  expect(result.source.kitchen_work.c0.lines.c0i0).toMatchObject({ready:1,collected:1});
  expect(result.destination.kitchen_work.c0.lines.c0i0).toMatchObject({ready:1,collected:1,collector:'staff',readyVersion:7});
  expect(result.destination.kitchen_service.c0i0.quantity).toBe(1);
  expect(result.destination.changes[0].items[0]).toMatchObject({item_note:'Less salt',seat:2,process:'transfer-in'});
  expect(cancellations({...original,...result.source},Date.parse(at))).toEqual([]);
});
test('legacy round IDs and remaining service are retained after a partial transfer',()=>{
  const original=sale();original.changes=[];original.kitchen_service={};original.kitchen_work={};
  const id=rounds(original)[0].items[0].id;
  original.kitchen_service[id]={quantity:2,at};
  const result=project(original,branch,[{id,quantity:1,servedQuantity:1}],at);
  const remaining=rounds({...original,...result.source})[0].items[0];
  expect(remaining).toMatchObject({id,quantity:3,served:1});
  expect(result.destination.changes[0].items[0].transfer_origin).toEqual({saleId:'source',roundLineId:id});
});
test('moving all items empties source kitchen tickets without producing cancellation tickets',()=>{
  const original=sale(),result=project(original,branch,[{id:'c0i0',quantity:2},{id:'c1i0',quantity:2}],at);
  expect(result.source.items).toEqual([]);
  expect(tickets({...original,...result.source})).toEqual([]);
  expect(cancellations({...original,...result.source},Date.parse(at))).toEqual([]);
  expect(rounds({...original,...result.destination}).flatMap(group=>group.items).reduce((sum,row)=>sum+row.quantity,0)).toBe(4);
});

test.each([{cancelled:true},{return:true},{status:'cancelled'}])('inactive historical items stay recorded without becoming kitchen work: %j',flags=>{
  const original=sale();
  original.items.push({...dish,line_id:'old-corn',...flags});
  original.changes.push({timestamp:at,items:[{...dish,line_id:'old-corn',process:'add'}]});
  const result=project(original,branch,[{id:'c1i0',quantity:1}],at);
  expect(result.source.items.find(line=>line.line_id==='old-corn')).toMatchObject(flags);
  for(const view of [result.source,result.destination])
    expect(rounds({...original,...view}).flatMap(group=>group.items).some(row=>row.line_key==='old-corn')).toBe(false);
});

test('held transfer does not appear on KDS and fired transfer retains its original kitchen time',()=>{
  const original=sale();original.changes[1].items[0].held=true;
  let result=project(original,branch,[{id:'c1i0',quantity:1}],at);
  expect(tickets({...original,...result.destination})).toEqual([]);
  original.changes.push({timestamp:'2026-09-30T13:45:00Z',items:[{...dish,process:'fire',source_round_line:'c1i0'}]});
  result=project(original,branch,[{id:'c1i0',quantity:1}],at);
  expect(tickets({...original,...result.destination})[0].placedAt).toBe('2026-09-30T13:45:00.000Z');
});

test('thousandth quantities remain exact when subtracting a partial round',()=>{
  const original=sale();original.items=[{...dish,item_quantity:1.001}];
  original.changes=[{timestamp:at,items:[{...dish,item_quantity:1.001,process:'add'}]}];
  original.kitchen_service={};original.kitchen_work={};
  const result=project(original,branch,[{id:'c0i0',quantity:0.001}],at);
  expect(rounds({...original,...result.source})[0].items[0].quantity).toBe(1);
  expect(rounds({...original,...result.destination})[0].items[0].quantity).toBe(0.001);
});
