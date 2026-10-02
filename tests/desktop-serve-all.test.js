const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('Serve all locks duplicate taps, uses the active branch and refreshes only after success', () => {
 const calls=[], alerts=[];
 const buttons={filter(){return this;},prop(){return this;},attr(){return this;},removeAttr(){return this;}};
 const P={local:{get:key=>key==='branch_id_set'?'branch-one':null},i18n:{t:(_key,fallback)=>fallback},post:(...args)=>calls.push(args),alert:(...args)=>alerts.push(args)};
 vm.runInNewContext(fs.readFileSync('frontend/static/script/js/modules/js/kot.js','utf8'),{PosnicPro:P,$:()=>buttons,console,setInterval(){},window:{addEventListener(){}},document:{addEventListener(){}}});
 let refreshed=0;P.kot.loadTables=()=>refreshed++;P.kot.loadTableDetails=()=>refreshed++;P.kot.currentTableNumber='6';
 P.kot.serveAll('sale-one');P.kot.serveAll('sale-one');
 assert.equal(calls.length,1);assert.deepEqual(JSON.parse(calls[0][0].data),{saleId:'sale-one',branchId:'branch-one',all:true});
 assert.equal(refreshed,0);calls[0][1]({type:'success'});assert.equal(refreshed,2);
 P.kot.serveAll('sale-one');calls[1][1]({type:'error',message:'Order changed'});assert.equal(refreshed,2);assert.equal(alerts.at(-1)[1],'Order changed');
 P.kot.serveAll('sale-one');calls[2][2]();P.kot.serveAll('sale-one');assert.equal(calls.length,4);
});
