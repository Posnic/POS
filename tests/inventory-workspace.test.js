const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');
const {JSDOM}=require('jsdom');
test('logs and low stock mount within Stock Counts and overview restores its workspace',()=>{
  const dom=new JSDOM('<div id="inventorycounts" class="page_loader"><div class="contentbar"><div class="count-workspace"></div></div></div><div id="stocklogs" class="page_loader"></div><div id="lowstockitems" class="page_loader"></div><a id="view_inventorycounts_page"></a>',{runScripts:'outside-only',url:'http://localhost'});
  const w=dom.window;
  try {
    w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/jquery.min.js'),'utf8'));
    w.PosnicPro={HideSideBarModal(){},ACLForModule(){},i18n:{t:(k,v)=>v},local:{get:()=>''}};
    for(const file of ['inventory_counts.js','stocklog.js','lowstock.js'])w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/modules/js',file),'utf8'));
    w.PosnicPro.stocklogs._chrome();
    assert.equal(w.$('#stocklogs').parent().attr('id'),'inventory_section_host');
    assert.equal(w.$('#inventorycounts').attr('data-section'),'logs');
    assert.notEqual(w.$('#inventorycounts').css('display'),'none');
    w.PosnicPro.lowstockitems._chrome();
    assert.equal(w.$('#lowstockitems').parent().attr('id'),'inventory_section_host');
    assert.equal(w.$('#stocklogs').css('display'),'none');
    assert.equal(w.$('#inventorycounts').attr('data-section'),'lowstock');
    w.PosnicPro.inventorycounts.load=()=>{};
    w.PosnicPro.inventorycounts.showDataTablePage();
    assert.equal(w.$('#inventory_section_host').css('display'),'none');
    assert.notEqual(w.$('.count-workspace').css('display'),'none');
    assert.equal(w.$('#inventorycounts').hasClass('count-section'),false);
  } finally {w.close();}
});

test('stock audit pages preserve edits across pages, page sizes and search filters',async()=>{
 const dom=new JSDOM('<div id="inventorycounts"><div class="contentbar"><div class="count-workspace"><div id="inventory_count_detail"></div></div></div></div>',{runScripts:'outside-only',url:'http://localhost'}),w=dom.window;
 try{
 w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/jquery.min.js'),'utf8'));
 const items=Array.from({length:61},(_,i)=>({id:String(i+1),name:'Product '+(i+1),sku:String(i+1),unit:'kg',quantity:1000,tracked:true,categoryId:'c',revision:'r'}));
 w.PosnicPro={i18n:{t:(k,v)=>v},local:{get:()=> 'b'},request(o,ok){ok({data:o.url.includes('priceSheet')?[{id:'b',name:'Shop'}]:o.url.includes('kind=categories')?{rows:[{id:'c',name:'Category',sortOrder:1}]}:{rows:items}});}};
 w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/modules/js/inventory_counts.js'),'utf8'));
 await w.PosnicPro.inventorycounts.startAudit();const $=w.$;
 assert.equal($('#audit_rows tr').length,25);assert.equal($('#audit_prev').prop('disabled'),true);
 $('.audit-new[data-id="1"]').val('2.125').trigger('input');$('.audit-reason[data-id="1"]').val('Monthly stock count').trigger('input');
 $('#audit_next').trigger('click');assert.equal($('#audit_rows tr').length,25);assert.equal($('.audit-new').first().attr('data-id'),'26');
 $('.audit-new[data-id="26"]').val('0').trigger('input');$('.audit-reason[data-id="26"]').val('Count correction').trigger('input');
 $('#audit_next').trigger('click');assert.equal($('#audit_rows tr').length,11);assert.equal($('#audit_next').prop('disabled'),true);
 $('#audit_prev').trigger('click');assert.equal($('.audit-new[data-id="26"]').val(),'0');
 $('#audit_search').val('Product 1').trigger('input');assert.match($('#audit_page_info').text(),/Page 1/);assert.equal($('.audit-new[data-id="1"]').val(),'2.125');assert.equal($('.audit-reason[data-id="1"]').val(),'Monthly stock count');
 $('#audit_search').val('').trigger('input');$('#audit_page_size').val('50').trigger('change');assert.equal($('#audit_rows tr').length,50);assert.equal($('.audit-new[data-id="26"]').val(),'0');
 $('#audit_page_size').val('100').trigger('change');assert.equal($('#audit_rows tr').length,61);
 $('#audit_search').val('absent').trigger('input');assert.equal($('#audit_rows tr').length,0);assert.equal($('#audit_next').prop('disabled'),true);
 }finally{w.close();}
});

test('popup restores hidden content and tabs dispatch even with an unchanged route',async()=>{
 const dom=new JSDOM('<div id="inventory_count_detail"><div id="sp_detail">Details</div><div id="sp_picker">Products</div></div>',{runScripts:'outside-only',url:'http://localhost/#/stocklogs'}),w=dom.window;
 try {
 w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/jquery.min.js'),'utf8'));
 let opened=0;w.PosnicPro={i18n:{t:(k,v)=>v},stocklogs:{showDataTablePage(){opened++;}}};
 w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/modules/js/inventory_counts.js'),'utf8'));
 const p=w.PosnicPro.inventorycounts,$=w.$;
 p.popup('sp_detail','Details');assert.equal($('#sp_detail').parent().hasClass('modal-body'),true);
 p.closePopup();assert.equal($('#sp_detail').parent().attr('id'),'inventory_count_detail');assert.equal($('#sp_detail').text(),'');
 p.popup('sp_picker','Products');p.closePopup();assert.equal($('#sp_picker').text(),'Products');assert.equal($('#sp_picker').css('display'),'none');
 await p.navigate('logs');await p.navigate('logs');assert.equal(opened,2);
 $('#inventory_count_detail').html('<table id="sp_entry_rows"><tr><td>Unsaved</td></tr></table>');
 w.swal=async()=>({dismiss:'cancel'});await p.navigate('logs');assert.equal(opened,2);assert.equal($('#sp_entry_rows').length,1);
 w.swal=async()=>({value:true});await p.navigate('logs');assert.equal(opened,3);
 }finally{w.close();}
});

test('damage history replaces each page and Previous restores its cursor',async()=>{
 const dom=new JSDOM('<div id="inventorycounts"><div class="count-workspace"><div id="inventory_count_detail"></div></div></div>',{runScripts:'outside-only',url:'http://localhost'}),w=dom.window;
 try {
 w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/jquery.min.js'),'utf8'));
 const urls=[];w.PosnicPro={i18n:{t:(k,v)=>v},local:{get:()=> 'b'},request(o,ok){urls.push(o.url);const second=o.url.includes('after=cursor25');ok({data:o.url.includes('spoilage?')?{rows:Array.from({length:second?2:25},(_,i)=>({_id:String(i),reference:'Page '+(second?2:1)+' item '+i,occurredOn:'2026-11-01',state:'accepted',createdByName:'Tester'})),next:second?null:'cursor25',canWrite:true,reasons:[],today:'2026-11-01'}:[{id:'b',name:'Shop'}]});}};
 w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/modules/js/inventory_counts.js'),'utf8'));
 await w.PosnicPro.inventorycounts.openSpoilage();const $=w.$,tick=()=>new Promise(r=>setImmediate(r));
 assert.equal($('#sp_list tbody tr').length,25);assert.equal($('#sp_prev').prop('disabled'),true);
 $('#sp_more').trigger('click');await tick();assert.equal($('#sp_list tbody tr').length,2);assert.equal($('#sp_more').prop('disabled'),true);assert.match($('#sp_page_info').text(),/Page 2/);
 $('#sp_prev').trigger('click');await tick();assert.equal($('#sp_list tbody tr').length,25);assert.match($('#sp_list').text(),/Page 1 item/);assert(!urls.at(-1).includes('after='));
 }finally{w.close();}
});

test('nested reason dialog yields Bootstrap focus trap and restores it after cancel or failure',async()=>{
 const dom=new JSDOM('<div id="inventory_popup" class="modal show"><button id="reason">Reason</button></div>',{runScripts:'outside-only',url:'http://localhost'}),w=dom.window;
 try {
 w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/jquery.min.js'),'utf8'));w.PosnicPro={i18n:{t:(k,v)=>v}};
 w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/modules/js/inventory_counts.js'),'utf8'));
 const $=w.$;let restored=0;
 const enforce=()=>{$(w.document).on('focusin.bs.modal',e=>{if(!$('#inventory_popup')[0].contains(e.target))$('#reason')[0].focus();});};
 $('#inventory_popup').data('bs.modal',{_enforceFocus(){restored++;enforce();}});enforce();$('#reason')[0].focus();
 w.swal=async()=>{const input=$('<input id="nested-reason">').appendTo('body')[0];input.focus();input.value='Test cancellation reason';assert.equal(w.document.activeElement,input);assert.equal(input.value,'Test cancellation reason');$(input).remove();return {dismiss:'cancel'};};
 await w.PosnicPro.inventorycounts.dialog({input:'text'});assert.equal(restored,1);assert.equal(w.document.activeElement.id,'reason');
 w.swal=async()=>{throw new Error('dialog failed');};await assert.rejects(w.PosnicPro.inventorycounts.dialog({}),/dialog failed/);assert.equal(restored,2);
 }finally{w.close();}
});

test('damage details load audit only on demand and cache it until reopened',async()=>{
 const dom=new JSDOM('<div id="inventorycounts"><div class="count-workspace"><div id="inventory_count_detail"></div></div></div>',{runScripts:'outside-only',url:'http://localhost'}),w=dom.window;
 try{
 w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/jquery.min.js'),'utf8'));
 const urls=[],entry={id:'entry',reference:'SP-1',state:'accepted',occurredOn:'2026-11-01',created_date:'2026-11-01',createdByName:'Tester',local:true,lines:[],applied:[]};
 w.PosnicPro={i18n:{t:(k,v)=>v},local:{get:()=> 'b'},request(o,ok){urls.push(o.url);ok({data:o.url.includes('view=audit')?{audit:[{action:'Created',user:'Tester',at:'2026-11-01',note:'Checked'}]}:o.url.includes('view=details')?entry:o.url.includes('spoilage?')?{rows:[{...entry,_id:'entry'}],reasons:[],today:'2026-11-01'}:[{id:'b',name:'Shop'}]});}};
 w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/modules/js/inventory_counts.js'),'utf8'));
 const p=w.PosnicPro.inventorycounts;p.popup=()=>{};await p.openSpoilage();const $=w.$,tick=()=>new Promise(r=>setImmediate(r));
 $('.sp_open').trigger('click');await tick();assert.equal($('#sp_details_tab').attr('aria-selected'),'true');assert.equal($('#sp_audit_panel').prop('hidden'),true);assert.equal(urls.filter(x=>x.includes('view=audit')).length,0);
 $('#sp_audit_tab').trigger('click');await tick();assert.equal($('#sp_details_panel').prop('hidden'),true);assert.match($('#sp_audit_panel').text(),/Checked/);
 $('#sp_details_tab').trigger('click');$('#sp_audit_tab').trigger('click');await tick();assert.equal(urls.filter(x=>x.includes('view=audit')).length,1);
 $('.sp_open').trigger('click');await tick();assert.equal($('#sp_audit_panel').prop('hidden'),true);$('#sp_audit_tab').trigger('click');await tick();assert.equal(urls.filter(x=>x.includes('view=audit')).length,2);
 }finally{w.close();}
});
