const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('frontend/static/script/js/core/PosnicPro.js','utf8');
function fixture(){
 const nodes=new Map();const $=selector=>{
  if(!nodes.has(selector)){const n={value:'',handlers:{},val(value){if(value===undefined)return this.value;this.value=value;return this;},off(){this.handlers={};return this;},on(name,fn){this.handlers[name]=fn;return this;},modal(action){if(action==='hide')this.handlers['hidden.bs.modal.orderApproval']?.();return this;},prop(){return this;},text(){return this;},addClass(){return this;},removeClass(){return this;},trigger(){return this;}};nodes.set(selector,n);}return nodes.get(selector);
 };
 let reply;const pro={posCan:()=>true,i18n:{t:(_,fallback)=>fallback},post:(_body,callback)=>reply=callback};
 const methods=source.slice(source.indexOf('    requireManagerApproval: function'),source.indexOf('    /* ----- Shift'));
 Object.assign(pro,vm.runInNewContext('({'+methods+'})',{PosnicPro:pro,$,setTimeout:()=>{}}));
 return {pro,$,reply:value=>reply(value)};
}
test('forced server approval is cancellable and a late PIN response cannot save the order',()=>{
 const f=fixture();let saved=0,cancelled=0;
 f.pro.requireManagerApproval('void_sale',{force:true,saleId:'sale'},()=>saved++,()=>cancelled++);
 f.$('#manager_pin_input').val('1234');f.pro.submitManagerApproval();
 f.$('#manager_pin_modal').modal('hide');
 f.reply({type:'success',data:{approval_token:'token'}});
 assert.equal(saved,0);assert.equal(cancelled,1);assert.equal(f.pro._pendingApproval,null);
});
test('confirmed approval completes once without also cancelling',()=>{
 const f=fixture();let saved=0,cancelled=0;
 f.pro.requireManagerApproval('void_sale',{force:true,saleId:'sale'},()=>saved++,()=>cancelled++);
 f.$('#manager_pin_input').val('1234');f.pro.submitManagerApproval();f.reply({type:'success',data:{approval_token:'token'}});
 assert.equal(saved,1);assert.equal(cancelled,0);
});
