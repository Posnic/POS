const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');const {blockAt}=require('./helpers/source-lookup');
function setup(){
 const dom=new JSDOM(fs.readFileSync('frontend/modules/sales_read.html','utf8'),{runScripts:'outside-only'}),w=dom.window,$=w.$=w.jQuery=require('jquery')(w);
 const loads=[];
 w.PosnicPro={i18n:{t:(_k,v)=>v},local:{get:()=>''},listSort:{mount:()=>{}},sales:{loadHistory:p=>{loads.push(p);w.PosnicPro.sales.paintHistoryFilters();}}};
 w.eval(fs.readFileSync('frontend/static/script/js/core/list-filter.js','utf8'));
 const s=fs.readFileSync('frontend/static/script/js/modules/js/sales.js','utf8');
 for(const method of ['mountHistoryFilters','paintHistoryFilters']){const fn=blockAt(s,'    '+method+': function (');w.eval('PosnicPro.sales.'+method+' = '+fn.slice(fn.indexOf('function')));}
 w.PosnicPro.sales.mountHistoryFilters();return{dom,w,$,loads};
}
test('quick dates preserve search and other filters, reset pagination, and synchronize selection',()=>{
 const h=setup();try{const lf=h.w.PosnicPro.listFilter,st=lf.state('sales');st.search='S-123';st.extra={status:'Paid'};
 for(const preset of ['today','yesterday','lastweek','all']){
 h.$('[data-sales-date="'+preset+'"]').trigger('click');assert.equal(st.preset,preset);assert.equal(st.search,'S-123');assert.equal(st.extra.status,'Paid');assert.equal(h.loads.at(-1),1);
 assert.equal(h.$('[data-sales-date="'+preset+'"]').attr('aria-pressed'),'true');assert.equal(h.$('#sales_quick_dates [aria-pressed="true"]').length,1);
 }
 assert.equal(st.from,null);assert.equal(st.to,null);
 h.$('.lf-preset').val('month').trigger('change');assert.equal(h.$('#sales_quick_dates [aria-pressed="true"]').length,0);
 }finally{h.dom.window.close();}
});
test('last week covers the previous Monday through Sunday across year boundaries',()=>{
 const h=setup();try{const lf=h.w.PosnicPro.listFilter;
 for(const now of ['2026-01-01T12:00:00','2025-12-29T12:00:00','2026-01-04T12:00:00']){
 const r=lf.range('lastweek',now);assert.equal(r.from.getFullYear(),2025);assert.equal(r.from.getMonth(),11);assert.equal(r.from.getDate(),22);assert.equal(r.to.getDate(),28);assert.equal(r.from.getHours(),0);assert.equal(r.to.getHours(),23);assert.equal(r.to.getMilliseconds(),999);
 }
 }finally{h.dom.window.close();}
});
