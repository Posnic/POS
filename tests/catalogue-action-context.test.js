const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/modules/js/items.js'),'utf8');
const methods=source.slice(source.indexOf('    catalogueSharingLocal:'),source.indexOf('    shareCatalogue:'));
test('catalogue copy is hidden on local tills and accounts without another accessible branch',()=>{
 for(const scenario of ['desktop','localhost','single','multiple','denied']){
  const dom=new JSDOM('<a id="items_share_catalogue" hidden></a>',{runScripts:'outside-only',url:scenario==='localhost'?'http://localhost:5555':'https://example.test'}),w=dom.window;
  try{w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/jquery.min.js'),'utf8'));let calls=0;
   if(scenario==='desktop')w.electronAPI={};
   w.PosnicPro={get(url,cb){calls++;cb({type:scenario==='denied'?'error':'success',data:{currentBranch:'a',branches:scenario==='multiple'?[{id:'a'},{id:'b'}]:[{id:'a'}]}});}};
   const tools=w.eval('({'+methods+'})');tools.refreshCatalogueTools();
   assert.equal(w.$('#items_share_catalogue').prop('hidden'),scenario!=='multiple',scenario);
   assert.equal(calls,['desktop','localhost'].includes(scenario)?0:1);
  }finally{w.close();}
 }
});
