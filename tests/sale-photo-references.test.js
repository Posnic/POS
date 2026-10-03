'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const ids=['12345678-1234-1234-1234-123456789abc','87654321-1234-1234-1234-123456789abc'];
function setup(get){
  const dom=new JSDOM('<section id="sales_view"><div class="modal-body"></div></section>',{runScripts:'outside-only'});
  dom.window.eval(fs.readFileSync(path.join(root,'frontend/static/script/js/jquery.min.js'),'utf8'));
  dom.window.PosnicPro={sales:{},i18n:{t:(_key,fallback)=>fallback},get};
  const code=fs.readFileSync(path.join(root,'frontend/static/script/js/modules/js/sales_view.js'),'utf8');
  dom.window.eval(code.slice(0,code.indexOf('    viewSale: function'))+'};');
  return dom;
}
test('desktop sale details retain scanned and reference photos independently',()=>{
  const requested=[];
  const dom=setup((request,done)=>{requested.push(request.url);done({data:'data:image/jpeg;base64,/9j/AA=='});});
  dom.window.PosnicPro.sales.view.renderOrderEvidence({paper_order:{id:ids[0]},order_photos:[{id:ids[1]},{id:ids[0]}],origin:{actor_name:'<img src=x onerror=bad()>'}});
  const buttons=dom.window.document.querySelectorAll('button');assert.equal(buttons.length,2);
  buttons.forEach(button=>button.click());
  assert.deepEqual(requested,ids.map(id=>'captain/v1/paper-orders/photos/'+id));
  assert.equal(dom.window.document.querySelectorAll('img').length,2);
  assert.match(dom.window.document.querySelector('p').textContent,/<img src=x/);
  dom.window.PosnicPro.sales.view.renderOrderEvidence({});assert.equal(dom.window.document.querySelector('#sale-origin-details'),null);
  dom.window.close();
});
test('desktop photo failure offers retry and rejects external image URLs',()=>{
  let count=0;
  const dom=setup((_request,done)=>done({data:++count===1?'https://untrusted.invalid/photo':'data:image/jpeg;base64,/9j/AA=='}));
  dom.window.PosnicPro.sales.view.renderOrderEvidence({order_photos:[{id:ids[1]}]});
  const button=dom.window.document.querySelector('button');button.click();
  assert.match(button.textContent,/Retry/);assert.equal(dom.window.document.querySelector('img'),null);
  button.click();assert.ok(dom.window.document.querySelector('img'));
  dom.window.close();
});
