const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('frontend/modules/items_v2.html','utf8');
for(const cached of [false,true])test('parcel editor initializes and preserves omitted measurements with '+(cached?'cached':'current')+' form',()=>{
 const d=new JSDOM(html,{runScripts:'outside-only'}),w=d.window;
 if(cached)w.document.querySelectorAll('[id^="iv2-parcel-"]').forEach(x=>x.remove());
 w.PosnicPro={local:{get(){return '';}},i18n:{t(k,f){return f;}},get(o,cb){cb({suggestions:[],data:[]});},itemTranslationsV2:{reset(){},data(){return {};}}};
 w.eval(fs.readFileSync('frontend/static/script/js/modules/js/items-v2-details.js','utf8'));
 assert.doesNotThrow(()=>w.PosnicPro.itemsV2Details.init());
 assert.doesNotThrow(()=>w.PosnicPro.itemsV2Details.load({parcel_details:{weightKg:0.5}}));
 const result=w.PosnicPro.itemsV2Details.data();
 if(cached)assert.equal(Object.hasOwn(result,'parcel_details'),false);else assert.equal(result.parcel_details.weightKg,'0.5');
 assert.equal(w.document.querySelector('#iv2-tab-restaurant').hidden,true);
 assert.equal(w.document.querySelector('[value="dish"]').closest('label').hidden,true);
 assert.equal(w.document.querySelectorAll('.iv2-tab-panel:not([hidden])').length,1);
 d.window.close();
});
