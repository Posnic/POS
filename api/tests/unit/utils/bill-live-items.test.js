'use strict';
const {buildBillPayload}=require('../../../src/helpers/bill-payload');
const {snapshotFrom}=require('../../../src/services/guest-bill.service');
const branch={currencyCode:'INR',indian_gst:'enable',bill_print_total_qty:true};
const active={item_id:'corn',item_name:'Baby corn',item_quantity:2,item_base_price:100,item_tax:10};
test.each([{cancelled:true},{return:true},{status:'cancelled'},{status:'CANCELED'},{item_quantity:0}])(
  'inactive historical line %j cannot appear on a bill or alter its tax rate label',flags=>{
    const sale={_id:'source',sales_sub_total:200,sales_total:210,tax:10,items:[active,
      {...active,item_id:'old',item_name:'Cancelled dish',item_quantity:4,item_tax:72,...flags}]};
    const bill=buildBillPayload(sale,branch);
    expect(bill.items).toHaveLength(1);expect(bill.items[0].name).toBe('Baby corn');
    expect(bill.totalQty).toBe('2');expect(bill.subTotal).toBe(200);expect(bill.total).toBe(210);
    expect(bill.taxes).toEqual([{label:'CGST 2.5%',amount:5},{label:'SGST 2.5%',amount:5}]);
    const snapshot=snapshotFrom([sale],branch,'1');
    expect(snapshot.lines.map(line=>line.name)).toEqual(bill.items.map(line=>line.name));
    expect(snapshot.totalMinor).toBe(21000);
  }
);
test('subtotal fallback and quantity count use only active items without changing recorded money',()=>{
  const bill=buildBillPayload({sales_total:195,discount:5,items:[active,{...active,cancelled:true}]},branch);
  expect(bill.subTotal).toBe(200);expect(bill.totalQty).toBe('2');
  expect(bill.total).toBe(195);expect(bill.discount).toBe(5);
});
