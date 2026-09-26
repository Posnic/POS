'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {OrderAlert}=require('../src/order-alert');
const {notifyKotReady}=require('../api/src/helpers/kot-notify');
const {notifyOrderAttention}=require('../api/src/helpers/order-attention');
const kitchenCall=require('../src/kitchen-call');

test('a new order and subsequent cancellations each speak once, independently of the sale ID',()=>{
 const spoken=[];const alert=new OrderAlert({onAccepted:p=>{spoken.push(p.ticket);return true;}});
 const item={item_name:'Rice',item_quantity:1,process:'cancel'};
 try {
  notifyOrderAttention({saleId:'one',ticket:{table:'23',items:[item]}});
  const change={saleId:'one',table:'23',reason:'updated',revision:2,items:[item]};
  notifyKotReady(change);notifyKotReady(change);
  notifyKotReady({...change,revision:3});
  assert.equal(spoken.length,3);
  assert.equal(spoken[1].cancelled,true);assert.equal(spoken[1].whole,false);
  assert.match(kitchenCall.say(spoken[1]),/item cancelled/i);
 } finally {alert.dispose();}
});
test('whole cancellation says order cancelled and mixed edits read only the affected quantities',()=>{
 const spoken=[];const alert=new OrderAlert({onAccepted:p=>{spoken.push(p.ticket);return true;}});
 try {
  notifyKotReady({saleId:'two',table:'5',revision:2,whole:true,items:[{item_name:'Tea',item_quantity:2,process:'cancel'}]});
  assert.match(kitchenCall.say(spoken[0]),/order cancelled/i);
  notifyKotReady({saleId:'three',table:'6',revision:2,items:[
   {item_name:'Tea',item_quantity:1,process:'cancel'},
   {item_name:'Rice',item_quantity:2,process:'add'}
  ]});
  assert.equal(spoken.length,3);assert.deepEqual(spoken[1].items.map(i=>i.item_name),['Tea']);
  assert.deepEqual(spoken[2].items.map(i=>i.item_name),['Rice']);assert.equal(spoken[2].changed,true);
 }finally {alert.dispose();}
});
test('a printer notification without committed changes does not invent a spoken ticket',()=>{
 const spoken=[];const alert=new OrderAlert({onAccepted:p=>{spoken.push(p);return true;}});
 try {notifyKotReady({saleId:'one',reason:'updated'});assert.equal(spoken.length,0);}
 finally {alert.dispose();}
});
