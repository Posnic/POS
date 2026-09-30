const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('frontend/static/script/js/modules/js/sales.js','utf8');
const start=source.indexOf('                var response = xhr && xhr.responseJSON;');
const end=source.indexOf('\n            });\n            });',start);
const handler=new Function('xhr','$','setTimeout',source.slice(start,end));
function run(xhr){
 const changes=[];
 const $=selector=>({removeAttr(){return this;},addClass(){return this;},removeClass(){return this;},val(value){changes.push({selector,value});return this;}});
 $.each=(rows,fn)=>rows.forEach((row,i)=>fn(i,row));
 handler(xhr,$,fn=>fn());
 return changes;
}
test('offline and proxy failures leave the cart unchanged without throwing',()=>{
 for(const xhr of [undefined,{}, {responseText:''},{responseText:'<html>Bad gateway</html>'},{responseJSON:{message:'offline'}},{responseJSON:{data:{unexpected:true}}}])assert.deepEqual(run(xhr),[]);
});
test('only valid stock corrections update cart quantities, including zero',()=>{
 assert.deepEqual(run({responseJSON:{data:[null,{item_id:'a'},{item_id:'b',item_quantity:'bad'},{item_id:'c',item_quantity:-1},{item_id:'d',item_quantity:0},{item_id:'e',item_quantity:2}]}}),[
  {selector:'#touchsale_item_qtyd',value:0},{selector:'#touchsale_item_qtye',value:2}
 ]);
});
