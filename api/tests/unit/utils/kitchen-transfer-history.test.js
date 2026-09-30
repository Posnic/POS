'use strict';
const {rounds,tickets,cancellations}=require('../../../src/helpers/kitchen-rounds');
const {plan}=require('../../../src/services/captain-transfer-plan');
const dish={item_id:'corn',line_id:'corn-salt',item_name:'Baby corn',item_quantity:2,item_price:50,item_note:'Less salt'};
const early='2026-09-30T13:30:00Z',late='2026-09-30T13:55:00Z';
test('transfer out removes the selected older round rather than the latest same-dish order',()=>{
  const sale={_id:'source',items:[{...dish,item_quantity:3}],changes:[
    {timestamp:early,items:[{...dish,process:'add'}]},
    {timestamp:late,items:[{...dish,process:'add'}]},
    {timestamp:late,items:[{...dish,item_quantity:1,process:'transfer-out',source_round_line:'c0i0'}]},
  ]};
  const lines=rounds(sale).flatMap(round=>round.items);
  expect(lines.map(line=>[line.id,line.quantity])).toEqual([['c0i0',1],['c1i0',2]]);
  expect(cancellations(sale,Date.parse(late))).toEqual([]);
});
test('incoming transfer retains origin, preparation notes and original order time through another preview',()=>{
  const origin={saleId:'original',roundLineId:'c2i1'};
  const sale={_id:'destination',table_number:'9',items:[dish],sales_sub_total:100,sales_total:100,changes:[
    {timestamp:late,items:[{...dish,process:'transfer-in',original_ordered_at:early,transfer_origin:origin}]},
  ],kitchen_service:{c0i0:{quantity:1,at:late}},kitchen_work:{c0:{lines:{c0i0:{ready:2,collected:1}}}}};
  const line=rounds(sale)[0].items[0];
  expect(line).toMatchObject({origin,quantity:2,served:1,note:'Less salt',ordered_at:new Date(early).toISOString()});
  expect(tickets(sale)[0]).toMatchObject({placedAt:new Date(early).toISOString(),items:[expect.objectContaining({qty:1,ready:2,collected:1})]});
  expect(cancellations(sale,Date.parse(late))).toEqual([]);
  const next=plan(sale,{currencyCode:'INR'},[{id:'c0i0',quantity:1,servedQuantity:0}]);
  expect(next.destination.rounds[0].origin).toEqual(origin);
});
test('held and fired transfer history preserves kitchen visibility and original fire time',()=>{
  const sale={_id:'destination',items:[dish],changes:[{timestamp:late,items:[{
    ...dish,process:'transfer-in',held:true,original_ordered_at:early,
  }]}]};
  expect(tickets(sale)).toEqual([]);
  sale.changes[0].items[0].held=false;
  sale.changes[0].items[0].original_fired_at='2026-09-30T13:40:00Z';
  expect(tickets(sale)[0].placedAt).toBe('2026-09-30T13:40:00.000Z');
});
