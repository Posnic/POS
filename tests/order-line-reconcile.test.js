const {test}=require('node:test');
const assert=require('node:assert/strict');
const lines=require('../api/src/utils/order-line');

test('reconcile accepts a line with its own id when no saved lines are supplied',()=>{
 const incoming=[{item_id:'water',line_id:'guest-1'}];
 assert.deepEqual(lines.reconcile(incoming),incoming);
});

test('reconcile still recovers an id from one unambiguous saved line',()=>{
 const saved=[{item_id:'water',line_id:'guest-1'}];
 assert.deepEqual(lines.reconcile([{item_id:'water'}],saved),[{item_id:'water',line_id:'guest-1'}]);
});
