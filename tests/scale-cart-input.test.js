const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
async function fixture(focus, replaceWhileWaiting = false) {
 const dom=new JSDOM('<input id="customer" value="Customer"><table><tbody id="sales_new_items_tbody"><tr id="touch_row_7"><td><input name="addSalesLineItemQty" inputmode="decimal" id="touchsale_item_qty7"></td></tr></tbody></table><span id="trackInventory_7">true</span><span id="negativeStock_7">false</span>',{runScripts:'outside-only'});
 const w=dom.window;w.eval(read('frontend/static/script/js/jquery.min.js'));const alerts=[],changes=[];
 w.PosnicPro={local:{get:()=>JSON.stringify({hardware_weight_machine_enable:true})},alert:(...x)=>alerts.push(x),i18n:{t:(k,v)=>v},sales:{quantity:{textOnChange:(...x)=>changes.push(x)}}};
 w.WeightBridge={isAvailable:()=>true,getCurrentWeight:async()=>{if(replaceWhileWaiting){const old=w.document.getElementById("touch_row_7");old.outerHTML=old.outerHTML;}return 0.305;}};
 const s=read('frontend/static/script/js/modules/js/sales.js'),a=s.indexOf('PosnicPro.sales.readWeightFromMachine = async function');w.eval(s.slice(a,s.indexOf('\n};',a)+3));
 if(focus)w.document.getElementById(focus).focus();
 await w.PosnicPro.sales.readWeightFromMachine();await new Promise(r=>setTimeout(r,130));return {dom,w,alerts,changes};
}
for(const focus of [null,'customer','touchsale_item_qty7'])test('scale fills cart quantity to three decimals with focus '+focus,async()=>{
 const {dom,w,alerts,changes}=await fixture(focus);try{assert.equal(w.document.getElementById('touchsale_item_qty7').value,'0.305');assert.equal(w.document.getElementById('customer').value,'Customer');assert.equal(alerts.some(a=>a[0]==='error'),false);assert.deepEqual(changes.map(x=>Array.from(x)),[['7','true','false']]);}finally{dom.window.close();}
});

test('delayed reading cannot fill a replacement cart row',async()=>{
 const {dom,w,changes}=await fixture(null,true);try{assert.equal(w.document.getElementById('touchsale_item_qty7').value,'');assert.equal(changes.length,0);}finally{dom.window.close();}
});
