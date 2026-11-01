const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
test('availability explains empty states and reviews only actual edits',()=>{
 const dom=new JSDOM('<body></body>',{runScripts:'outside-only',url:'http://localhost'}),w=dom.window;
 try {
 w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/jquery.min.js'),'utf8'));
 w.$.fn.modal=function(){return this;};let response={rows:[],permissions:{write:true}};
 w.PosnicPro={items:{},i18n:{t:(k,v)=>v},get:(url,cb)=>cb(response)};
 const source=fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/modules/js/items.js'),'utf8');
 w.eval(source.slice(source.indexOf('PosnicPro.items.availability = function')));
 w.PosnicPro.items.availability();const m=w.$('#product-availability-dialog');
 assert.equal(m.find('.availability-review').prop('hidden'),true);
 assert.match(m.find('.availability-status').text(),/get started/);
 m.find('form').trigger('submit');assert.match(m.find('.availability-status').text(),/No products found/);
 response.rows=[{id:'one',name:'Onion',price:5000,taxBps:0,unit:'kg',quantity:1000}];
 m.find('form').trigger('submit');assert.equal(m.find('.availability-review').prop('hidden'),true);
 const checkbox=m.find('input[type=checkbox]');checkbox.prop('checked',false).trigger('change');
 assert.equal(m.find('.availability-review').prop('hidden'),false);
 m.find('.availability-review').trigger('click');assert.equal(m.find('.availability-confirm').prop('hidden'),false);
 checkbox.prop('checked',true).trigger('change');assert.equal(m.find('.availability-review').prop('hidden'),true);assert.equal(m.find('.availability-confirm').prop('hidden'),true);
 }finally{w.close();}
});
