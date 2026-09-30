const test=require('node:test'), assert=require('node:assert/strict'),fs=require('fs');
const {JSDOM}=require('jsdom'),jquery=require('jquery');
test('refresh is visible, idempotent and keeps current filters and page',()=>{
 const dom=new JSDOM('<button id="filters">Filter</button><div id="panel"></div>',{runScripts:'outside-only'});
 try {
 const w=dom.window;w.$=jquery(w);w.PosnicPro={i18n:{t:(k,f)=>f}};
 w.eval(fs.readFileSync('frontend/static/script/js/core/list-filter.js','utf8'));
 const lf=w.PosnicPro.listFilter;let count=0,page=3;
 const cfg={key:'sales',button:'#filters',container:'#panel',onRefresh:()=>{count++;assert.equal(page,3);}};
 lf._mounted.sales={cfg,state:{search:'customer',extra:{status:'Paid'}}};
 lf.mountRefresh(cfg);lf.mountRefresh(cfg);
 assert.equal(w.document.querySelectorAll('#lf-refresh-sales').length,1);
 w.$('#lf-refresh-sales').trigger('click').trigger('click');assert.equal(count,1);
 assert.equal(lf._mounted.sales.state.search,'customer');assert.equal(lf._mounted.sales.state.extra.status,'Paid');
 } finally {dom.window.close();}
});
test('every shared list-filter mount has an explicit reload callback',()=>{
 const dir='frontend/static/script/js/modules/js';let count=0;
 for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.js'))){const source=fs.readFileSync(dir+'/'+f,'utf8');for(const fragment of source.split('PosnicPro.listFilter.mount({').slice(1)){assert.match(fragment.slice(0,230),/onRefresh: function/ ,f);count++;}}
 assert.equal(count,15);
});
const setupRefresh = () => {
 const dom=new JSDOM('<button id="filters">Filter</button><div id="rows">Existing data</div>',{runScripts:'outside-only'});
 const w=dom.window;w.$=jquery(w);w.PosnicPro={i18n:{t:(k,f)=>f}};
 w.eval(fs.readFileSync('frontend/static/script/js/core/list-filter.js','utf8'));
 const lf=w.PosnicPro.listFilter;const requests=[];
 w.PosnicPro.get=(p,ok,fail)=>requests.push({ok,fail});
 const cfg={key:'sales',button:'#filters',rows:'#rows',onRefresh:()=>lf.request('sales',{},()=>{w.$('#rows').text('Existing data');})};
 lf.mountRefresh(cfg);
 return {dom,w,lf,requests,button:w.document.getElementById('lf-refresh-sales')};
};
const pause=()=>new Promise(resolve=>setTimeout(resolve,450));
test('refresh stays busy until its request renders, including unchanged records',async()=>{
 const {dom,w,requests,button}=setupRefresh();try{
 w.$(button).trigger('click');await pause();
 assert.equal(button.getAttribute('aria-busy'),'true');
 w.$(button).trigger('click');assert.equal(requests.length,1);
 requests[0].ok({type:'success'});await pause();
 assert.equal(button.getAttribute('aria-busy'),null);
 assert.match(button.textContent,/Refreshed/);
 assert.equal(w.$('#rows').text(),'Existing data');
 assert.equal(w.$('#rows').hasClass('lf-refreshed'),true);
 }finally{dom.window.close();}
});
test('failed refresh shows failure and can be retried',async()=>{
 const {dom,w,requests,button}=setupRefresh();try{
 w.$(button).trigger('click');requests[0].fail();await pause();
 assert.match(button.textContent,/Refresh failed/);
 assert.equal(w.$('#rows').hasClass('lf-refreshed'),false);
 w.$(button).trigger('click');assert.equal(requests.length,2);
 requests[1].ok({type:'error'});await pause();
 assert.match(button.textContent,/Refresh failed/);
 }finally{dom.window.close();}
});
test('older background response cannot finish a manual refresh',async()=>{
 const {dom,w,lf,requests,button}=setupRefresh();try{
 lf.request('sales',{},()=>{});
 w.$(button).trigger('click');requests[0].ok({type:'success'});await pause();
 assert.equal(button.getAttribute('aria-busy'),'true');
 requests[1].ok({type:'success'});await pause();
 assert.match(button.textContent,/Refreshed/);
 }finally{dom.window.close();}
});
