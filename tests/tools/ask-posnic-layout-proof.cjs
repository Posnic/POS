const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'../..'),puppeteer=require(path.join(ROOT,'api/node_modules/puppeteer'));
(async()=>{const browser=await puppeteer.launch({headless:true});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const html=fs.readFileSync(path.join(ROOT,'frontend/modules/ask_posnic.html'),'utf8');
 await page.setContent('<div class="proof-shell" style="margin-left:256px;padding-top:84px">'+html+'</div>');
 for(const f of ['bootstrap.min.css','custom.css','theme-variables.css','style.css','modules/ask-posnic.css']) await page.addStyleTag({path:path.join(ROOT,'frontend/static/style/css',f)});
 await page.addStyleTag({content:'@media(max-width:767px){.proof-shell{margin-left:0!important;padding-top:64px!important}}'});
 await page.addScriptTag({path:path.join(ROOT,'frontend/static/script/js/jquery.min.js')});
 await page.evaluate(()=>{window.PosnicPro={i18n:{t:(k,f)=>f},get:(url,done)=>done({data:[{_id:'conversation',messages:[{role:'user',payload:{question:'How are sales today?'}},{role:'assistant',payload:{answer:'Sales are ready to review.'}}]}]}),request:()=>{},alert:()=>{}};});
 await page.addScriptTag({path:path.join(ROOT,'frontend/static/script/js/modules/js/ask_posnic.js')});
 await page.evaluate(()=>{ $('#askposnic').show();PosnicPro.askposnic.bind();PosnicPro.askposnic.add('user','Show reorder suggestions for the next 7 days');PosnicPro.askposnic.add('answer','No items currently need reordering.\n\nReorder planning uses the previous 30 complete days of recorded sales to cover the next 7 days. Check supplier lead times and seasonal demand before ordering.',{intent:'reorder',source:'Recorded sales, tracked inventory and open purchase orders',metrics:[{label:'Items needing stock',value:'0'}]});});
 for(const width of [1886,1366,768,390]){
  await page.setViewport({width,height:900});
  for(const history of [false,true]){
   await page.evaluate(open=>{ if ($('#ask_history_panel').prop('hidden') === open) $('#ask_load_history').trigger('click'); },history);
   const box=await page.evaluate(()=>{const bounds=id=>document.querySelector(id).getBoundingClientRect().toJSON();return {header:bounds('.ask-workspace-header'),body:bounds('.ask-workspace-body'),input:bounds('#ask_posnic_form'),chat:bounds('.ask-posnic-card'),thread:bounds('#ask_posnic_thread'),history:bounds('#ask_history_panel'),scroll:document.documentElement.scrollWidth,viewport:innerWidth};});
   assert.ok(box.scroll<=box.viewport+1,JSON.stringify({width,history,box}));assert.ok(Math.abs(box.header.left-box.body.left)<1);assert.ok(box.input.bottom<=box.chat.bottom);assert.ok(box.thread.bottom<=box.input.top+1);
   if(history && width>991)assert.ok(box.history.right<box.chat.left);if(history && width<=991)assert.ok(box.history.bottom<box.chat.top);
   if(width===1366)await page.screenshot({path:'D:/Posnic-builds/ask-layout-'+(history?'history':'chat')+'.png',fullPage:true});
  }
 }
 await page.click('#ask_close_history');assert.equal(await page.evaluate(()=>document.activeElement.id),'ask_load_history');
 await page.click('#ask_new_conversation');assert.equal(await page.$eval('#ask_posnic_welcome',e=>e.hidden),false);
 assert.deepEqual(errors,[]);console.log('PASS: desktop/tablet/phone alignment, separate history pane, no horizontal overflow, composer visible, history close focus and new conversation');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
