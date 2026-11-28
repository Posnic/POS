"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),decimal=require('../api/src/utils/wallet-decimal');
const row=(amount,type='in')=>({amount,type});
test('wallet totals retain decimal precision without binary accumulation drift',()=>{
 assert.equal(decimal.balance([row(.1),row(.2)]),.3);
 assert.equal(decimal.balance([row(12.345),row(.0006)]),12.3456);
 assert.equal(decimal.balance([row(.0000001),row(.0000002)]),.0000003);
 assert.equal(decimal.balance([row(12.3456),row(12.3456,'out')]),0);
 assert.equal(decimal.balance([row(.3,'out'),row(.1)]),-.2);
});
test('unrepresentable totals and invalid persisted values are held rather than rounded',()=>{
 assert.throws(()=>decimal.balance([row(.1),row(.00000000000000001)]),/exactly/);
 assert.throws(()=>decimal.balance([row(Number.MAX_SAFE_INTEGER),row(1)]));
 for(const value of [NaN,Infinity,-1,'12.3',null])assert.throws(()=>decimal.amount(value));
 assert.throws(()=>decimal.balance([row(1,'other')]));
});
