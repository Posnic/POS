const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
test('failed recovery unlocks Close but retains the saved operation',async()=>{
 const dom=new JSDOM('<div id="extensions_title"></div><div id="extensions_status"></div><main></main>');
 let frame,rejectRequest,closed=false;const busy=[];
 const PosnicPro={local:{get:()=> 'branch'},request:(req,ok,fail)=>{if(req.url.endsWith('/view'))ok({displayName:'Basket',view:{}});else if(req.url.endsWith('/recover'))rejectRequest=fail;else throw Error(req.url);}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/static/script/js/modules/js/extensions.js'),'utf8'),{PosnicPro,document:dom.window.document,window:dom.window,setTimeout,console,PosnicExtensionFrame:{mount:args=>{frame=args;return{destroy(){}};}}});
 PosnicPro.extensions.refreshMenu=()=>{};
 await PosnicPro.extensions.showDetails('posnic.example',{container:dom.window.document.querySelector('main'),workspace:{presentation:'compact'},onBusy:value=>busy.push(value),onClose:()=>closed=true});
 const pending=frame.request('recover',{});
 assert.equal(busy.at(-1),true);
 rejectRequest({responseJSON:{error:{code:'stock_effect_superseded',message:'stock_effect_superseded'}}});
 await assert.rejects(pending,/stock_effect_superseded/);assert.equal(busy.at(-1),false);
 assert.deepEqual(JSON.parse(JSON.stringify(await frame.request('closeWorkspace',{}))),{closed:true});
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(closed,true);
});
