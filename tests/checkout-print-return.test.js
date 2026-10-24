const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/core/PosnicPro.js'),'utf8');
for(const hash of ['sales/new','kot/6','sales/0123456789abcdef01234567'])test('print completion preserves appropriate workspace: '+hash,()=>{
 const dom=new JSDOM('<div id="infobar-settings-sidebar-tender-details" class="sidebarview sidebarshow"></div>',{runScripts:'outside-only'}),w=dom.window;w.eval(fs.readFileSync(path.join(__dirname,'../frontend/static/script/js/jquery.min.js'),'utf8'));let route,stopped=false;
 w.currentHash=hash;w.hasher={setHash:v=>route=v};w.PosnicPro={sales:{saleDoneTimer:{stop:()=>stopped=true}}};w.setTimeout=f=>f();
 const a=source.indexOf('afterPrint: function'),b=source.indexOf('}, 800);',a);w.eval('({'+source.slice(a,b)+'}, 800); }}).afterPrint()');
 assert.equal(route,hash==='sales/new'?hash:undefined);assert.equal(stopped,hash==='sales/new');if(hash==='sales/new')assert.equal(w.$('#infobar-settings-sidebar-tender-details').hasClass('sidebarview'),false);dom.window.close();
});
