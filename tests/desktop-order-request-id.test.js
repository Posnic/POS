'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('frontend/static/script/js/modules/js/sales.js','utf8');
function state(localHttp = false) {
 let number=0;
 const PosnicPro={sales:{_orderRequestId:null}};
 const window={crypto:localHttp ? {getRandomValues:bytes=>bytes.fill(++number)} : {randomUUID:()=>`request-${++number}`}};
 new Function('PosnicPro','window',source.slice(0,source.indexOf('    SaleDenomination:'))+'};')(PosnicPro,window);
 return PosnicPro.sales;
}
test('repeated sends and failed-request retries keep the same identity',()=>{
 const sales=state();const first=sales.orderRequestId();
 assert.equal(sales.orderRequestId(),first);
 assert.equal(sales.orderRequestId(),first);
 sales.resetOrderRequest();assert.notEqual(sales.orderRequestId(),first);
});
test('new desktop sales clear identity only on confirmation or explicit no-write rejection',()=>{
 const start=source.indexOf('var isKotNewSale =');
 const send=source.slice(start,source.indexOf("url: 'setting/salesSmsReceipt'",start));
 assert.match(send,/idempotencyKey:\s*PosnicPro\.sales\.orderRequestId\(\)/);
 assert.ok(send.indexOf('submissionJournal().confirm(savedSubmission, response)') < send.indexOf('resetOrderRequest()'));
 assert.equal((send.match(/resetOrderRequest\(\)/g)||[]).length,2);
 assert.match(send,/if \(PosnicPro\.sales\.submissionJournal\(\)\.reject\(savedSubmission, response\)\) \{\s*PosnicPro\.sales\.resetOrderRequest\(\)/);
 assert.match(source,/showAdd: function \(\) \{\s*PosnicPro\.sales\.resetOrderRequest\(\);/);
 assert.match(source,/clear\.cartItems = function \(isFalse\) \{\s*PosnicPro\.sales\.resetOrderRequest\(\);/);
});

test('local HTTP uses secure random bytes when randomUUID is unavailable',()=>{
 const sales=state(true);const first=sales.orderRequestId();assert.match(first,/^[a-f0-9]{32}$/);
 assert.equal(sales.orderRequestId(),first);sales.resetOrderRequest();assert.notEqual(sales.orderRequestId(),first);
});
