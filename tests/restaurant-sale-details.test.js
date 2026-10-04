'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const details = require('../api/src/helpers/restaurant-sale-details');
const { render } = require('../frontend/static/script/js/modules/js/restaurant-sale-details');
const { JSDOM } = require('jsdom');
const t = (_, fallback) => fallback;
function sale() {
  return { table_number:'8A', person_count:3, dine_type:'Dine-in', payment_status:'Paid', created_date:'2026-10-05T06:30:00Z', kitchen_actor:{name:'Asha'}, client:{device_model:'Samsung A15',device_id:'captain-7',app:'Captain'}, items:[{item_id:'tea',item_name:'Tea',item_quantity:2}], changes:[{timestamp:'2026-10-05T06:30:00Z',kitchen_actor:{name:'Asha'},items:[{process:'add',item_id:'tea',item_name:'Tea',item_quantity:3}]},{timestamp:'2026-10-05T06:35:00Z',actor:'Manager',reason:'Customer changed order',items:[{process:'cancel',item_id:'tea',item_name:'Tea',item_quantity:1}]}], kitchen_service:{c0i0:{quantity:2,at:'2026-10-05T06:40:00Z',by:'Asha'}} };
}
test('restaurant detail preserves additions, cancellations, serving facts and provenance',()=>{
  const input=sale(),before=JSON.stringify(input),d=details(input,'Asia/Kolkata');
  assert.equal(d.table,'8A');assert.equal(d.covers,3);assert.equal(d.taken_by,'Asha');assert.equal(d.device,'Samsung A15');
  assert.deepEqual(d.events.map(e=>e.kind),['kot','kot','served']);assert.equal(d.events[1].items[0].action,'cancel');assert.equal(d.events[2].items[0].quantity,2);assert.equal(d.events[2].at,'2026-10-05T06:40:00.000Z');assert.equal(JSON.stringify(input),before);
});
test('payment and updated dates never masquerade as serving time',()=>{
  const input=sale();delete input.kitchen_service;input.updated_date='2026-10-05T07:00:00Z';input.bill_printed_at='2026-10-05T06:50:00Z';
  assert.deepEqual(details(input).events.map(e=>e.kind),['kot','kot','bill_printed']);
  const legacy=details({payment_status:'Paid',person_count:0});assert.equal(legacy.ordered_at,null);assert.equal(legacy.covers,0);assert.deepEqual(legacy.events,[]);
});
test('restaurant-only UI renders missing data honestly and escapes all stored text',()=>{
  const d=details(sale(),'Asia/Kolkata');d.taken_by='<img src=x onerror=alert(1)>';d.events[0].items[0].name='<script>alert(1)</script>';
  assert.equal(render(d,false,t),'');assert.equal(render(null,true,t),'');
  const doc=new JSDOM(render(d,true,t)).window.document;
  assert.equal(doc.querySelectorAll('script,img').length,0);assert.match(doc.body.textContent,/12:00:00/);assert.match(doc.body.textContent,/Samsung A15/);assert.match(doc.body.textContent,/Customer changed order/);
  assert.match(render(details({}),true,t),/Not recorded/);
});
