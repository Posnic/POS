const test = require('node:test');
const assert = require('node:assert/strict');
const {applyRules}=require('../api/src/services/wording-rules');
const {createRegistry,resolveBundle,validateDraft}=require('../api/src/services/wording-profiles');
const rules=[{from:'item',to:'product'},{from:'items',to:'products'}];
test('whole words, plurals and casing are replaced without touching placeholders or substrings',()=>{
 assert.equal(applyRules('Item: {item}. Add item; ITEMS; items; item_code; itemized',rules),'Product: {item}. Add product; PRODUCTS; products; item_code; itemized');
 assert.equal(applyRules('Item item',[{from:'item',to:'product'},{from:'product',to:'goods'}]),'Product product');
});
test('published rules cover new labels and extensions, while explicit exceptions win',()=>{
 const labels=createRegistry({a:'Add item',b:'Items',c:'Search items'},[{extensionId:'demo',labelSchemaVersion:1,labels:[{id:'ext.demo.heading',defaults:{en:'Item details'}}]}]);
 const draft=validateDraft({name:'Shop',locale:'en',overrides:{'posnic.b':'Stock'},rules},labels,['en']);
 const state={schemaVersion:1,revision:1,assignments:{b:{en:{profileId:'p',revisionId:'r'}}},profiles:[{id:'p',revisions:[{...draft,id:'r'}]}]};
 const b=resolveBundle(state,'b','en',labels);
 assert.equal(b.values.a,'Add product');assert.equal(b.values.b,'Stock');assert.equal(b.values.c,'Search products');assert.equal(b.values['ext.demo.heading'],'Product details');
 assert.equal(b.sourceValues['Add item'],'Add product');
 assert.deepEqual({...resolveBundle(state,'other','en',labels).values},{});
 assert.throws(()=>validateDraft({name:'x',locale:'en',overrides:{},rules:[{from:'item',to:'<b>x'}]},labels,['en']));
});
test('simple screen saves rules and publishes with no profile-name or apply step',()=>{
 const {JSDOM}=require('jsdom'), fs=require('node:fs');
 const d=new JSDOM('<div id="wording-editor"></div>',{runScripts:'outside-only'}); const calls=[];
 const state={revision:0,profiles:[],assignments:{}};
 d.window.PosnicPro={local:{get:()=> 'super_admin'},i18n:{t:(_,v)=>v},get:(_,cb)=>cb({type:'success',data:{state,writable:true,locales:['en'],branches:[{id:'b',name:'Shop'}],labels:[]}}),put:(req,cb)=>{calls.push(JSON.parse(req.data));state.profiles=[{id:'p',draft:calls[0]}];state.revision++;cb({type:'success',data:state});},post:(req,cb)=>{calls.push(JSON.parse(req.data));cb({type:'success',data:state});}};
 d.window.eval(fs.readFileSync('frontend/static/script/js/modules/js/wording-editor.js','utf8'));
 d.window.PosnicPro.wordingEditor.open();const doc=d.window.document;
 for(const [field,value] of [['from','Item'],['to','Product']]){const el=doc.querySelector('[data-field="'+field+'"]');el.value=value;el.dispatchEvent(new d.window.Event('input',{bubbles:true}));}
 assert.equal(doc.querySelector('#wording-advanced').open,false);
 assert.equal(doc.querySelector('#wording-group'),null);
 doc.querySelector('#wording-publish').click();
 assert.deepEqual(calls[0].rules,[{from:'Item',to:'Product'}]);assert.equal(calls[0].name,'Shop wording — en');assert.deepEqual(calls[1].branches,['b']);d.window.close();
});
