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
