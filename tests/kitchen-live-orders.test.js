'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { OrderAlert } = require('../src/order-alert');

test('accepted kitchen tickets reach the speaker once; waiting orders never do', () => {
  const calls=[];
  const alert=new OrderAlert({onAccepted: p => {calls.push(p.ticket);return true;}});
  const ticket={table:'23',items:[{item_name:'Rice',item_quantity:2}]};
  try {
    alert.handle({saleId:'one',alert:'waiting',ticket});
    assert.equal(calls.length,0);
    alert.handle({saleId:'one',alert:'received',ticket});
    alert.handle({saleId:'one',alert:'received',ticket});
    assert.deepEqual(calls,[ticket]);
  } finally {alert.dispose();}
});

test('an unavailable speaker does not mark a ticket spoken or fail the order', () => {
  let ready=false,calls=0;
  const alert=new OrderAlert({onAccepted:()=>{calls++;if(!ready)throw new Error('not ready');return true;}});
  try {
    const event={saleId:'one',alert:'received',ticket:{table:'23',items:[]}};
    assert.doesNotThrow(()=>alert.handle(event)); ready=true;
    alert.handle(event);alert.handle(event);
    assert.equal(calls,2);
  }finally{alert.dispose();}
});

test('the API carries an accepted ticket and excludes held orders from speech', () => {
  const helper=require('../api/src/helpers/order-attention');const calls=[];
  const listener=p=>calls.push(p);process.on(helper.ATTENTION_EVENT,listener);
  try {
    const ticket={table:'23',items:[{item_name:'Rice',item_quantity:2}]};
    helper.notifyOrderAttention({saleId:'one',alert:'received',ticket});
    helper.notifyOrderAttention({saleId:'two',alert:'waiting',ticket});
    assert.deepEqual(calls[0].ticket,ticket);assert.equal(calls[1].ticket,undefined);
  }finally{process.off(helper.ATTENTION_EVENT,listener);}
});

test('active tables refresh on an arrival and poll only when visible and not editing', () => {
  const code=fs.readFileSync('frontend/static/script/js/modules/js/kot.js','utf8');
  const footer=code.slice(code.indexOf('/* Refresh arrivals where staff'));
  const events={},docEvents={};let tick,scheduled,calls=0,visible=true,modal=false;
  const document={hidden:false,activeElement:null,addEventListener:(k,fn)=>{docEvents[k]=fn;}};
  vm.runInNewContext(footer,{document,window:{addEventListener:(k,fn)=>{events[k]=fn;}},
    $:s=>({is:()=>visible,length:s==='.modal.show:visible'&&modal?1:0}),
    PosnicPro:{kot:{refreshTables:q=>{assert.equal(q,true);calls++;}}},
    setTimeout:fn=>{scheduled=fn;return 1;},clearTimeout:()=>{},setInterval:(fn,ms)=>{assert.equal(ms,5000);tick=fn;}});
  events['posnic:orders-changed']();assert.equal(calls,0);scheduled();assert.equal(calls,1);
  document.hidden=true;tick();assert.equal(calls,1);
  document.hidden=false;modal=true;tick();assert.equal(calls,1);
  modal=false;document.activeElement={tagName:'INPUT'};tick();assert.equal(calls,1);
  document.activeElement=null;visible=false;tick();assert.equal(calls,1);
  visible=true;tick();assert.equal(calls,2);
});

test('sound save waits for persistence and reports failures instead of claiming success', async () => {
  const html=fs.readFileSync('src/hardware-manager.html','utf8');
  const from=html.indexOf('var save = async function ()');
  const to=html.indexOf('bridge.get().then',from);
  const nodes={};let resolve, saved;
  const at=id=>nodes[id]||(nodes[id]={value:'',checked:true,disabled:false,textContent:'',addEventListener:()=>{}});
  at('kitchenVoice').value='Voice A';
  const context={at,bridge:{set:value=>{saved=value;return new Promise(r=>{resolve=r;});}},Error};
  vm.createContext(context);vm.runInContext(html.slice(from,to),context);
  const first=context.save();assert.equal(at('kitchenSoundSave').disabled,true);
  assert.equal(saved.speak,true);assert.equal(saved.voice,'Voice A');
  resolve(false);assert.equal(await first,false);
  assert.match(at('kitchenSoundSaveResult').textContent,/could not be saved/);
  assert.equal(at('kitchenSoundSave').disabled,false);
  const second=context.save();resolve(true);assert.equal(await second,true);
  assert.equal(at('kitchenSoundSaveResult').textContent,'Saved on this computer');
});

test('background ticket refresh preserves the panel on failure, unchanged data, or a changed selection', () => {
  const code=fs.readFileSync('frontend/static/script/js/modules/js/kot.js','utf8');
  const body=code.slice(code.indexOf('loadTableDetails: function'),code.indexOf('    convertTo24Hour:'));
  let response, writes=0;
  const node={html:()=>{writes++;},find:()=>node,text:()=>node,show:()=>node,hide:()=>node,length:1};
  const PosnicPro={kot:{currentTableNumber:'23',buildTableDetailsPanel:()=>'<p>Two rice</p>',initTooltips:()=>{}},
    get:(_params,ok)=>{response=ok;}};
  const context={PosnicPro,document:{activeElement:null},console:{log:()=>{}},
    $:s=>s==='.modal.show:visible'?{length:0}:node};
  vm.createContext(context);vm.runInContext('var loaded = ({'+body+'});',context);
  const load=()=>context.loaded.loadTableDetails('23',true);
  load();assert.equal(writes,0);response({type:'error'});assert.equal(writes,0);
  const ticket={type:'success',data:{list:[{id:'one'}],total:1}};
  load();response(ticket);assert.equal(writes,1);
  load();response(ticket);assert.equal(writes,1);
  load();PosnicPro.kot.currentTableNumber='24';response({...ticket,data:{list:[{id:'two'}],total:1}});
  assert.equal(writes,1);
});
