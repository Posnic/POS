"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom'),jquery=require('jquery'),{randomUUID}=require('node:crypto');
const install=require('../frontend/static/script/js/modules/js/customer-wallet-page'),createStore=require('../frontend/static/script/js/modules/js/customer-wallet-requests'),createRecovery=require('../frontend/static/script/js/modules/js/customer-wallet-recovery');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(){
 const dom=new JSDOM(fs.readFileSync('frontend/modals/customer.html','utf8'),{runScripts:'outside-only',url:'http://localhost'}),w=dom.window,$=jquery(w),data=new Map();
 w.$=$;$.fn.autocomplete=function(){return this;};w.PosnicPro={lazyPhoneInput:()=>{},local:{get:key=>key==='userid'?'cashier':key==='branch_id'?'branch':''},i18n:{t:(_key,fallback)=>fallback}};
 // Actual page methods and actual modal markup; transport and unrelated plugins are fixtures.
 w.eval(fs.readFileSync('frontend/static/script/js/modules/js/customers.js','utf8'));const P=w.PosnicPro;P.record_id='abcdef0123456789abcdef01';
 const customer={_id:P.record_id,license:'shop',branch_id:'branch',balance:7};let requests=[],reads=[],alerts=[],refreshes=0,network;
 P.get=(options,ok)=>{const url=typeof options==='string'?options:options.url;reads.push(url);if(url.includes('wallet-requests'))return ok(network);ok({type:'success',data:customer});};
 P.request=(options,ok,fail)=>{requests.push(options);if(network)ok(network);else fail({});};P.alert=(...args)=>alerts.push(args);
 P.getFormData=form=>Object.fromEntries(form.serializeArray().map(row=>[row.name,row.value]));P.transactiondetails.transactiondetailsTable=()=>refreshes++;
 $.fn.modal=()=>{};let tail=Promise.resolve();const store=createStore({storage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)},locks:{request(_key,_options,fn){const next=tail.then(fn);tail=next.catch(()=>{});return next;}},randomUUID});
 const installed=install({P,$,document:w.document,store,createRecovery});
 return {dom,w,$,P,customer,requests,reads,alerts,store,installed,setNetwork:value=>network=value,refreshes:()=>refreshes};
}
test('normal customer form retains original after failed response and refreshes current balance on check',async()=>{
 const f=fixture();try{
 await f.P.customers.showTransaction(f.customer._id);
 f.$('#transaction_amount').val('12.3456');f.$('#transaction_type').val('in');f.$('#transaction_date').val('2026-11-28');
 await f.P.customers.transaction();assert.equal(f.requests.length,1);const sent=JSON.parse(f.requests[0].data);assert.equal(sent.request.amount,12.3456);
 assert.equal(f.$('#transaction_amount').prop('disabled'),true);
 await f.P.customers.showTransaction(f.customer._id);assert.equal(f.requests.length,1);assert.equal(f.$('#transaction_amount').val(),'12.3456');
 const command=f.requests[0].url.split('/').at(-1);f.setNetwork({type:'success',data:{state:'saved',commandId:command,kind:'add',request:sent.request,entryId:'abcdef0123456789abcdef02',balance:999}});
 f.w.document.querySelector('[data-action=check]').click();await tick();await tick();
 assert.equal(f.$('#transaction_amount').prop('disabled'),false);assert.equal(f.refreshes(),1);
 assert.equal(f.reads.at(-1),'customers/'+f.customer._id);
 }finally{f.installed.uninstall();f.dom.window.close();}
});
test('confirmed manual deletion uses recovery and a stale customer confirmation sends nothing',async()=>{
 const f=fixture();try{
 const entry='abcdef0123456789abcdef02';f.P.transactiondetails.removeTransactionDetails(entry);assert.equal(f.requests.length,0);
 f.P.record_id='abcdef0123456789abcdef03';f.P.transactiondetails.deleteConfirmation=true;await f.P.transactiondetails.removeTransactionDetails(entry);assert.equal(f.requests.length,0);
 f.P.record_id=f.customer._id;f.P.transactiondetails.removeTransactionDetails(entry);f.P.transactiondetails.deleteConfirmation=true;
 await f.P.transactiondetails.removeTransactionDetails(entry);assert.equal(f.requests.length,1);
 assert.deepEqual(JSON.parse(f.requests[0].data).request,{kind:'remove',entryId:entry});
 }finally{f.installed.uninstall();f.dom.window.close();}
});

test('branch switches refuse stale form submission and invalid input stays editable',async()=>{
 const f=fixture();try{
 await f.P.customers.showTransaction(f.customer._id);
 f.$('#transaction_amount').val('-5');f.$('#transaction_type').val('in');f.$('#transaction_date').val('2026-11-28');
 await f.P.customers.transaction();assert.equal(f.requests.length,0);assert.equal(f.$('#transaction_amount').prop('disabled'),false);
 f.P.local.get=key=>key==='userid'?'cashier':key==='branch_id'?'other-branch':'';
 f.$('#transaction_amount').val('10');await f.P.customers.transaction();assert.equal(f.requests.length,0);
 }finally{f.installed.uninstall();f.dom.window.close();}
});
