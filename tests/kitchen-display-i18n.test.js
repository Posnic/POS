'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const root = path.join(__dirname,'../api/src/kitchen-board');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(lang='ta', board=true) {
  const dom = new JSDOM(read('index.html'), {url:'https://example.test/kitchen/?demo=1&lang='+lang,runScripts:'outside-only'});
  const w=dom.window;
  Object.defineProperty(w.document,'currentScript',{value:{src:'https://example.test/kitchen/i18n.js'}});
  w.fetch=async url => {
    const file=path.basename(new URL(url,w.location.href).pathname);
    try {return {ok:true,json:async()=>JSON.parse(read('locales/'+file))};}
    catch {return {ok:false};}
  };
  w.setInterval=()=>0;
  w.HTMLElement.prototype.setPointerCapture=()=>{};
  w.eval(read('i18n.js'));
  if(board) w.eval(read('board.js'));
  return dom;
}
test('AWS display packs cover every source string and preserve placeholders',()=>{
  const source=JSON.parse(read('locales/en.json'));
  const files=fs.readdirSync(path.join(root,'locales')).filter(f=>f.endsWith('.json')&&!['index.json','en.json'].includes(f));
  assert.equal(files.length,56);
  for(const file of files){
    const pack=JSON.parse(read('locales/'+file));
    assert.deepEqual(Object.keys(pack).sort(),Object.keys(source).sort(),file);
    for(const [key,value] of Object.entries(pack)){
      assert.ok(value.trim(),file+' '+key);
      assert.deepEqual((value.match(/\{\w+\}/g)||[]).sort(),(key.match(/\{\w+\}/g)||[]).sort(),file+' '+key);
      assert.ok(!/<(?:span|p|html)\b/i.test(value),file+' leaked HTML');
    }
  }
});
test('Tamil translates settings and actions without translating dish or staff data',async()=>{
  const dom=setup();try {
    await tick();await tick();
    const d=dom.window.document, pack=JSON.parse(read('locales/ta.json'));
    assert.equal(d.querySelector('#setup-toggle').textContent,pack.Settings);
    assert.equal(d.querySelector('#new button.advance').textContent,pack['Start preparing →']);
    assert.ok(d.querySelector('#new').textContent.includes('Chicken biryani'));
    assert.ok(d.querySelector('#new').textContent.includes('Captain Arun'));
    d.querySelector('#new button.advance').click();await tick();
    assert.ok(d.querySelector('#preparing .quantity-input'));
    await dom.window.DisplayI18n.setLanguage('ar');
    assert.equal(d.documentElement.dir,'rtl');
    assert.ok(d.querySelector('#preparing').textContent.includes('Chicken biryani'));
    await dom.window.DisplayI18n.setLanguage('en');
    assert.equal(d.documentElement.dir,'ltr');
    assert.equal(d.querySelector('#setup-toggle').textContent,'Settings');
  } finally {dom.window.close();}
});
test('missing translations fall back and Chinese regional packs resolve',async()=>{
  const dom=setup('ne');try {
    await tick(); assert.equal(dom.window.document.querySelector('#setup-toggle').textContent,'Settings');
    await dom.window.DisplayI18n.setLanguage('zh-tw');
    assert.equal(dom.window.document.querySelector('#setup-toggle').textContent,JSON.parse(read('locales/zh-TW.json')).Settings);
    const value=dom.window.DisplayI18n.t('Taken by {name}',{name:'<script>Captain</script>'});
    assert.ok(value.includes('<script>Captain</script>'));
    const el=dom.window.document.createElement('p');el.textContent=value;
    assert.equal(el.children.length,0);
  }finally{dom.window.close();}
});
test('static translation never overwrites changing branch names or numeric input values',async()=>{
 const dom=setup('ta',false);try{
   await tick();const d=dom.window.document;
   d.querySelector('#branch').textContent='Settings';
   d.querySelector('#orange-minutes').value='17';
   await dom.window.DisplayI18n.setLanguage('de');
   assert.equal(d.querySelector('#branch').textContent,'Settings');
   assert.equal(d.querySelector('#orange-minutes').value,'17');
 }finally{dom.window.close();}
});
test('packaged HDMI windows load bundled locale files without Fetch',async()=>{
 const dom=new JSDOM('<html><body><p>Kitchen Display</p></body></html>',{url:'file:///app/src/kitchen-screen.html?lang=ta',runScripts:'outside-only'});
 try{
  const w=dom.window;
  Object.defineProperty(w.document,'currentScript',{value:{src:'file:///app/api/src/kitchen-board/i18n.js'}});
  w.fetch=()=>{throw Error('File windows must use bundled files');};
  w.XMLHttpRequest=class {
   open(method,url){assert.equal(method,'GET');this.url=url;}
   send(){this.responseText=read('locales/'+path.basename(new URL(this.url).pathname));this.onload();}
  };
  w.eval(read('i18n.js'));await tick();
  assert.equal(w.document.querySelector('p').textContent,JSON.parse(read('locales/ta.json'))['Kitchen Display']);
  const files=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8')).build.files;
  assert.ok(files.includes('api/src/kitchen-board/i18n.js'));
  assert.ok(files.includes('api/src/kitchen-board/locales/*.json'));
 }finally{dom.window.close();}
});
test('API public asset routes serve the runtime and every shipped locale from fixed paths',()=>{
 const vm=require('node:vm');
 const api=path.join(__dirname,'../api');
 const source=fs.readFileSync(path.join(api,'app.js'),'utf8');
 const start=source.indexOf('const kitchenLocaleFiles =');
 const end=source.indexOf("app.use(['/api/mobile/v1'",start);
 assert.ok(start>=0&&end>start);
 const handlers=new Map();
 vm.runInNewContext(source.slice(start,end),{fs,path,__dirname:api,app:{get(routes,handler){for(const route of Array.isArray(routes)?routes:[routes])handlers.set(route,handler);}}});
 const expected=['i18n.js',...fs.readdirSync(path.join(root,'locales')).filter(name=>name.endsWith('.json')).map(name=>'locales/'+name)];
 for(const file of expected){
  const handler=handlers.get('/kitchen/'+file);assert.equal(typeof handler,'function',file);
  let sent=false;
  handler({}, {set(name,value){assert.equal(name,'Cache-Control');assert.equal(value,'no-store');},sendFile(filePath){assert.equal(filePath,path.join(root,file));assert.ok(fs.statSync(filePath).isFile());sent=true;}});
  assert.ok(sent,file);
 }
 assert.equal(handlers.has('/kitchen/locales/../../.env'),false);
 assert.equal(handlers.has('/kitchen/locales/unknown.json'),false);
});
