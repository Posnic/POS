const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('../api/src/helpers/billing-search');
const source = fs.readFileSync(require.resolve('../frontend/static/script/js/modules/js/sales.js'), 'utf8');
function section(start,end) { const a=source.indexOf(start), b=source.indexOf(end,a); assert.ok(a>=0&&b>a); return source.slice(a,b); }
test('exact Tea beats variants, codes and initials work across a full catalogue', () => {
 const items=Array.from({length:371},(_,i)=>({name:'Item '+i,item_id:String(i)}));
 items[221]={name:'Tea',item_id:'tea',plu_code:'15',itemid:'SKU-T',barcode_id:'890001'};
 items[0]={name:'Ice Tea'}; items[1]={name:'Chicken Biryani',short_code:'CB'};
 for(const q of ['Tea','15','SKU-T','890001']) assert.equal(engine.search(q,items)[0].item_id,'tea');
 assert.equal(engine.search('CB',items)[0].name,'Chicken Biryani');
 assert.equal(engine.search('biry chi',items)[0].name,'Chicken Biryani');
 assert.equal(engine.search('chickn',items)[0].name,'Chicken Biryani');
 assert.equal(engine.search('briyani',items)[0].name,'Chicken Biryani');
 assert.equal(engine.search('zzzzzz',items).length,0);
 assert.equal(engine.search('[',items).length,0);
});
test('translated names, accents and explicit short codes remain searchable',()=> {
 const item={name:'Coffee',translations:[{name:'காபி'}],short_code:'CFE'};
 assert.equal(engine.search('காபி',[item])[0],item);
 assert.equal(engine.search('cafe',[{name:'Café'}]).length,1);
 assert.equal(engine.search('cfe',[item])[0],item);
});
test('tax is not displayed as a discount',()=> {
 assert.deepEqual(engine.price({selling_price:50,tax:5,tax_type:'exclusive'}),{price:52.5,was:null,tax:5});
 assert.equal(engine.price({selling_price:52.5,tax:5,tax_type:'inclusive'}).price,52.5);
 assert.equal(engine.price({selling_price:50,tax:5,tax_type:'exclusive'},false).price,50);
 assert.deepEqual(engine.price({selling_price:50,tax:5,tax_type:'exclusive',discount_percentage:10}),{price:47.25,was:52.5,tax:5});
});
test('missing expiry and future ISO dates stay visible',()=> {
 const now=Date.UTC(2026,0,1);
 for(const v of [undefined,null,'','2027-01-01',String(now+10000)]) assert.equal(engine.expired(v,now),false);
 assert.equal(engine.expired('2025-01-01',now),true);
});
test('catalogue traverses filtered empty pages and retains Tea after entry 100',()=> {
 const calls=[]; const context={PosnicPro:{sales:{},get(params,done){calls.push(params.data.offset);done({type:'success',data:calls.length===1?{items:[],next_offset:200}:{items:[{name:'Tea'}],next_offset:null}});}}};
 vm.runInNewContext(section('PosnicPro.sales.loadBillingCatalogue =','PosnicPro.sales.itemsMenu ='),context);
 let result;context.PosnicPro.sales.loadBillingCatalogue(r=>result=r);
 assert.deepEqual(calls,[0,200]);assert.equal(result.data[0].name,'Tea');
 assert.equal(context.PosnicPro.sales._billingCatalogue[0].name,'Tea');
});
test('a late catalogue from a previous branch cannot overwrite the new branch',()=>{
 const callbacks=[];const context={PosnicPro:{sales:{},get(p,done){callbacks.push(done);}}};
 vm.runInNewContext(section('PosnicPro.sales.loadBillingCatalogue =','PosnicPro.sales.itemsMenu ='),context);
 context.PosnicPro.sales.loadBillingCatalogue(()=>assert.fail('stale callback'));
 context.PosnicPro.sales._catalogueRefreshing=true;
 context.PosnicPro.sales.loadBillingCatalogue(()=>{});
 callbacks[1]({type:'success',data:{items:[{name:'New shop'}],next_offset:null}});callbacks[0]({type:'success',data:{items:[{name:'Old shop'}],next_offset:null}});
 assert.equal(context.PosnicPro.sales._billingCatalogue[0].name,'New shop');
 assert.equal(context.PosnicPro.sales._catalogueRefreshing,false);
});
test('quantity confirmation validates stock and adds full item details; cancel adds nothing',async()=>{
 let options,resolve;const added=[],alerts=[];let focused=false;
 const item={item_id:'tea',name:'Tea',selling_price:50,track_inventory:true,negative_stock:false,available_quantity:5};
 const context={Number,Object,swal(o){options=o;return new Promise(r=>resolve=r);},$:selector=>({length:0,val:()=>1,focus(){focused=true;}}),PosnicPro:{i18n:{t:(k,f)=>f},alert:(...args)=>alerts.push(args),sales:{itemCache:{get:(id,cb)=>cb(item)},addSalesLineItems:row=>added.push(row)}}};
 vm.runInNewContext(section('PosnicPro.sales.askSearchQuantity =','/* Owner: typing here'),context);
 const ask=()=>context.PosnicPro.sales.askSearchQuantity({name:'Tea'},'tea');
 ask();assert.equal(options.input,'text');await assert.rejects(options.inputValidator('0'));await options.inputValidator('2');
 resolve('2');await new Promise(setImmediate);assert.equal(added[0].item_quantity,2);assert.equal(added[0].selling_price,50);assert.ok(focused);
 ask();resolve({value:'5'});await new Promise(setImmediate);assert.equal(added.length,1);assert.equal(alerts.length,1);
 ask();resolve({dismiss:'cancel'});await new Promise(setImmediate);assert.equal(added.length,1);
});
