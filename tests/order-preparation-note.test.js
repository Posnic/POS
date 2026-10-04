const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const load = Module._load;
let Manager;
try {
  Module._load = function(request) {
    if (request === 'electron') return {app:{getPath:()=>require('node:os').tmpdir(),getName:()=> 'posnic-test'},BrowserWindow:class {}};
    return load.apply(this,arguments);
  };
  Manager = require('../src/kot-manager');
} finally { Module._load = load; }

test('note-only kitchen ticket uses the configured ticket fields without repeating previous food',()=>{
  const ticket={sales_id:'42',table_number:'4',items:[],note_only:true,preparation_note:'Pack separately',changes:[{items:[{item_name:'Rice',item_quantity:3}]}]};
  const fields=Manager.prototype._ticketFields.call(Manager.prototype,ticket,'edit',42);
  assert.equal(fields.orderNote,'Pack separately');
  assert.deepEqual(fields.items,[]);
  assert.equal(fields.tableNo,'4');
  ticket.preparation_note='';
  ticket.notes='Old note';
  assert.equal(Manager.prototype._ticketFields.call(Manager.prototype,ticket,'edit',42).orderNote,'Preparation note cleared');
});

test('kitchen rounds show the latest order note without inventing another food round',()=>{
 const {tickets}=require('../api/src/helpers/kitchen-rounds');
 const dish={item_id:'rice',item_name:'Rice',item_quantity:2,process:'add'};
 const order={_id:'s1',table_number:'4',created_date:'2026-10-04T08:00:00Z',items:[dish],preparation_note:'Serve together',changes:[{timestamp:'2026-10-04T08:00:00Z',items:[dish]},{timestamp:'2026-10-04T08:01:00Z',items:[],note_only:true,preparation_note:'Serve together'}]};
 const shown=tickets(order);
 assert.equal(shown.length,1);
 assert.equal(shown[0].preparationNote,'Serve together');
 assert.equal(shown[0].items[0].qty,2);
});

