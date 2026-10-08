'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {salesWorkspace}=require('../api/src/services/extension-sales-workspace');
const valid=()=>({version:1,controls:[{id:'quote',label:'Request quote',action:'request-quote',placements:['sale','payment'],tone:'secondary'}],events:{submit:'request-quote'},policies:{useDefaultOpenPrice:true}});
test('sales contributions accept arbitrary extension vocabulary without client assumptions',()=>{
 const result=salesWorkspace(valid());assert.equal(result.controls[0].action,'request-quote');assert(Object.isFrozen(result.controls));assert.equal(salesWorkspace(undefined),null);assert.equal(salesWorkspace(true),null);
});
test('sales contributions reject unsupported contracts, script targets and ambiguous controls',()=>{
 const mutations=[v=>v.version=2,v=>v.controls[0].action='javascript:alert(1)',v=>v.controls[0].placements=['settings'],v=>v.controls[0].tone='evil onclick=',v=>v.controls[0].page='quote',v=>v.controls.push(v.controls[0]),v=>v.events.submit='unknown',v=>v.events.refund='quote',v=>v.policies.useDefaultOpenPrice='true',v=>v.controls[0].label='',v=>v.controls[0].label='x'.repeat(81)];
 for(const mutate of mutations){const v=valid();mutate(v);assert.throws(()=>salesWorkspace(v),/extension_sales_workspace_invalid/);}
});
test('cart transfer commands must belong to the signed extension',()=>{
 const v=valid();v.clearCartOn=['quote.create'];assert.throws(()=>salesWorkspace(v),/extension_sales_workspace_invalid/);assert.deepEqual(salesWorkspace(v,{'quote.create':['write']}).clearCartOn,['quote.create']);
});

test('compact checkout is opt-in and validates its boolean policy',()=>{
 const v=valid();assert.equal(salesWorkspace(v).policies.compactCheckout,false);
 v.policies.compactCheckout=true;assert.equal(salesWorkspace(v).policies.compactCheckout,true);
 v.policies.compactCheckout='true';assert.throws(()=>salesWorkspace(v),/extension_sales_workspace_invalid/);
});

test('native Pay uses the extension only for an eligible new checkout',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const source=fs.readFileSync(require('node:path').join(__dirname,'../frontend/static/script/js/modules/js/sales.js'),'utf8');
 const start=source.indexOf('    openTenderModel: function (methodsReady) {');
 const end=source.indexOf('        // Load methods',start);
 const body=source.slice(source.indexOf('{',start)+1,end);
 for(const scenario of [{enabled:true,paymentOnly:false,kot:false,expected:0},{enabled:false,paymentOnly:false,kot:false,expected:1},{enabled:true,paymentOnly:true,kot:false,expected:1},{enabled:true,paymentOnly:false,kot:true,expected:1}]) {
  let native=0;
  const context={PosnicPro:{sales:{paymentOnlyMode:scenario.paymentOnly,saleProcess:scenario.kot?'KOT':'add'},saleExtensions:{dispatch:event=>{assert.equal(event,'checkout');return scenario.enabled;}}},nativeTender:()=>native++};
  vm.runInNewContext('(function(){'+body+'nativeTender();})()',context);
  assert.equal(native,scenario.expected);
 }
});
