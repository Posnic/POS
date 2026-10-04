const test = require('node:test');
const assert = require('node:assert/strict');
const { rounds, tickets } = require('../api/src/helpers/kitchen-rounds');

test('paid takeaway preparation removes only ready quantities while service retains them', () => {
  const order = sale();
  Object.assign(order, { dine_type: 'Take away', sales_id: '104', payment_status: 'Paid',
    kitchen_work: { c0: { state: 'preparing', lines: { c0i0: { ready: 1 } } } } });
  const shown = tickets(order);
  assert.equal(shown[0].takeaway, true);
  assert.equal(shown[0].orderNumber, '104');
  assert.equal(shown[0].items[0].qty, 1);
  assert.equal(rounds(order)[0].items[0].remaining, 2);
  order.kitchen_work.c0.lines.c0i0.ready = 2;
  assert.equal(tickets(order).length, 1);
  assert.equal(tickets(order)[0].id, `${order._id}:c1`);
  order.kitchen_work.c1 = { state: 'ready' };
  assert.deepEqual(tickets(order), []);
  assert.equal(rounds(order).length, 2);
});
const line = (qty, process = 'add') => ({
  item_id: 'rice',
  item_name: 'Rice',
  item_quantity: qty,
  process,
});
const sale = () => ({
  _id: 's1',
  table_number: '6',
  created_date: '2026-09-27T08:00:00Z',
  items: [line(3)],
  changes: [
    { timestamp: '2026-09-27T08:00:00Z', items: [line(2)] },
    { timestamp: '2026-09-27T08:25:00Z', items: [line(1)] },
  ],
});
test('later additions retain their own kitchen clock and service identity', () => {
  const order = sale();
  order.kitchen_service = { c0i0: { quantity: 2, at: '2026-09-27T08:20:00Z' } };
  assert.equal(rounds(order).length, 2);
  assert.equal(tickets(order).length, 1);
  assert.equal(tickets(order)[0].placedAt, '2026-09-27T08:25:00.000Z');
  assert.equal(tickets(order)[0].items[0].qty, 1);
});
test('partial service removes only that quantity; fully served clears display', () => {
  const order = sale();
  order.kitchen_service = { c0i0: { quantity: 1 } };
  assert.equal(tickets(order)[0].items[0].qty, 1);
  order.kitchen_service = { c0i0: { quantity: 2 }, c1i0: { quantity: 1 } };
  assert.deepEqual(tickets(order), []);
});
test('bill request clears existing rounds but later additions return', () => {
  const order = sale();
  order.bill_requested_at = '2026-09-27T08:20:00Z';
  assert.equal(tickets(order).length, 1);
  order.bill_requested_at = '2026-09-27T08:30:00Z';
  assert.deepEqual(tickets(order), []);
});
test('cancelled additions are not displayed and legacy tickets still appear', () => {
  const order = sale();
  order.items = [line(2)];
  order.changes.push({ timestamp: '2026-09-27T08:30:00Z', items: [line(1, 'cancel')] });
  assert.equal(tickets(order).length, 1);
  assert.equal(tickets(order)[0].items[0].qty, 2);
  order.changes = [];
  assert.equal(tickets(order)[0].items[0].qty, 2);
});
test('missing timestamps never become epoch service dates', () => {
  assert.equal(rounds(sale())[0].items[0].served_at, null);
});
const vm = require('node:vm');
const fs = require('node:fs');
test('every dish on a long kitchen ticket stays in one scrollable table box', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(fs.readFileSync('src/kitchen-screen.html', 'utf8'), { runScripts: 'dangerously' });
  try {
    const { window } = dom;
    window.kitchenScreen.setConfig({ visibleDishesPerBox: 3, fontSizePx: 32 });
    window.kitchenScreen.setTickets([{ id: 'sale:0', table: '6', placedAt: new Date().toISOString(),
      items: Array.from({ length: 10 }, (_, i) => ({ qty: 1, name: `Dish ${i}` })) }]);
    assert.equal(window.document.querySelectorAll('.ticket').length, 1);
    assert.equal(window.document.querySelectorAll('.name').length, 10);
    assert.equal(window.document.querySelector('.items').style.maxHeight, '192px');
    assert.equal(window.document.getElementById('count').textContent, '1');
  } finally { dom.window.close(); }
});

test('settled kitchen work disappears even when nobody marked it served', () => {
  const { tickets } = require('../api/src/helpers/kitchen-rounds');
  const sale = {
    _id: 'paid-order',
    kitchen_required: true,
    payment_status: 'Paid',
    created_date: new Date('2026-09-28T10:00:00Z'),
    bill_requested_at: new Date('2026-09-28T10:02:00Z'),
    items: [{ item_id: 'rice', item_name: 'Rice', item_quantity: 2 }],
    changes: [
      {
        timestamp: new Date('2026-09-28T10:00:00Z'),
        items: [{ item_id: 'rice', item_name: 'Rice', item_quantity: 2, process: 'add' }],
      },
    ],
  };
  assert.equal(tickets(sale).length, 0);
  sale.kitchen_service = { c0i0: { quantity: 2 } };
  assert.equal(tickets(sale).length, 0);
});


test('cancelling one preparation never removes another guest preparation of the same product',()=>{
 const dry={...line(1),line_id:'dry',item_description:'No chilli'};
 const gravy={...line(2),line_id:'gravy',item_description:'Extra sauce'};
 const order=sale();order.items=[dry,{...gravy,item_quantity:1}];
 order.changes=[{timestamp:order.created_date,items:[dry,gravy]},
 {timestamp:'2026-09-27T08:30:00Z',items:[{...gravy,item_quantity:1,process:'cancel'}]}];
 order.kitchen_service={c0i0:{quantity:1}};
 const remaining=tickets(order).flatMap(ticket=>ticket.items);
 assert.equal(remaining.length,1);assert.equal(remaining[0].note,'Extra sauce');assert.equal(remaining[0].qty,1);
});


test('held courses do not cook until fired and firing never adds chargeable quantity',()=>{
 const held={...line(2),line_id:'dessert',held:true,seat:2,course:'Dessert',allergies:['milk']};
 const order=sale();order.items=[held];order.changes=[{timestamp:order.created_date,items:[held]}];
 assert.deepEqual(tickets(order),[]);assert.equal(rounds(order)[0].items[0].held,true);
 order.items=[{...held,held:false}];
 order.changes.push({timestamp:'2026-09-27T09:00:00Z',items:[{...held,held:false,process:'fire',source_round_line:'c0i0'}]});
 const rows=rounds(order).flatMap(round=>round.items);
 assert.equal(rows.length,1);assert.equal(rows[0].id,'c0i0');assert.equal(rows[0].quantity,2);
 assert.equal(tickets(order)[0].placedAt,'2026-09-27T09:00:00.000Z');
 assert.deepEqual(tickets(order)[0].items[0].allergies,['milk']);
});

test('tracked bill cutoff keeps only additions after billing and honours the newest collection', () => {
  const order = sale(); order.kitchen_required = true;
  order.bill_requested_at = '2026-09-27T08:20:00Z';
  assert.equal(tickets(order).length, 1);
  assert.equal(tickets(order)[0].items[0].qty, 1);
  order.captain_payments = [{amount: 50, at: '2026-09-27T08:30:00Z'}];
  assert.deepEqual(tickets(order), []);
  assert.equal(rounds(order).length, 2);
  assert.equal(order.kitchen_service, undefined);
});

test('takeaway billing and collection never hide unserved dishes, while dine-in still closes', () => {
 for (const type of [{fulfilment:'takeaway'}, {dine_type:'Take away'}, {dine_type:'Takeaway'}]) {
  const order={...sale(), ...type, kitchen_required:true, payment_status:'Paid', bill_requested_at:'2026-09-27T09:00:00Z', bill_printed_at:'2026-09-27T09:01:00Z', captain_payments:[{amount:50,at:'2026-09-27T09:02:00Z'}]};
  assert.equal(tickets(order).length,2);
  order.kitchen_service={c0i0:{quantity:1}};
  assert.equal(tickets(order)[0].items[0].qty,1);
  order.kitchen_service={c0i0:{quantity:2},c1i0:{quantity:1}};
  assert.deepEqual(tickets(order),[]);
  order.kitchen_service={}; order.payment_status='Cancelled';
  assert.deepEqual(tickets(order),[]);
 }
 const dineIn={...sale(),fulfilment:'dine_in',dine_type:'Takeaway',payment_status:'Paid'};
 assert.deepEqual(tickets(dineIn),[]);
});
