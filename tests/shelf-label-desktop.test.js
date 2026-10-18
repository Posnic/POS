const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../src/hardware-manager.js'),'utf8');
function fixture(result = {success:true}) {
  const submitted=[], pdfs=[]; let windows=0;
  class BrowserWindow {
    constructor() { windows++; this.webContents={executeJavaScript:async()=>{},printToPDF:async()=>Buffer.from("%PDF-labels")}; }
    async loadURL() {} isDestroyed(){return false;} destroy(){}
  }
  const method = source.slice(source.indexOf('  async printHTML('),source.indexOf('  async getDefaultPrinter()'));
  const object=vm.runInNewContext('({' + method + '})',{BrowserWindow,Buffer,console:{log(){},warn(){},error(){}},hardenPrintWindow(){},prepareDocument(){},fitDocument(){},require:(name)=>name==='crypto'?{randomUUID:()=> 'test-trace'}:({printPdfDocument:async (bytes,options)=>{pdfs.push({bytes,options});return result;}})});
  object._resolvePrintRoute=()=>({url:'data:text/html,hello',secure:false});
  object._resolvePrinterName=async n=>n;
  object._waitForPrintPage=async()=>{};
  object._sendPrintJob=async (_w,options)=>{submitted.push(options);return result;};
  object._printViaPdfFallback=async()=>{throw Error('Unexpected fallback');};
  return {object,submitted,pdfs,windows:()=>windows};
}
test('exact label driver printing passes micron dimensions and never retries using driver defaults',async()=>{
  const f=fixture({success:false,retryable:true,error:'Unsupported paper'});
  const r=await f.object.printHTML('<p>Label</p>',{printerName:'Labels',pageSize:{width:72000,height:33000},exactPageSize:true,silent:true});
  assert.equal(r.success,false); assert.equal(f.submitted.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.submitted[0].pageSize)),{width:72000,height:33000});
  assert.equal(f.submitted[0].landscape,false); assert.equal(f.submitted[0].deviceName,'Labels');
});
test('invalid custom label sizes and missing printer names fail before opening a print window',async()=>{
  for(const options of [{pageSize:{width:0,height:33000},printerName:'Labels'}, {pageSize:{width:72000,height:33000}}]){
    const f=fixture(); const r=await f.object.printHTML('<p>Label</p>',{...options,exactPageSize:true});
    assert.equal(r.success,false);assert.equal(f.windows(),0);assert.equal(f.submitted.length,0);
  }
});

test('A4 shelf sheets go directly through actual-size PDF printing, without an HTML job first',async()=>{
 const f=fixture();const r=await f.object.printHTML('<p>Labels</p>',{printerName:'Brother',pageSize:{width:210000,height:297000},exactPageSize:true});
 assert.equal(r.success,true);assert.equal(f.submitted.length,0);assert.equal(f.pdfs.length,1);
 assert.equal(f.pdfs[0].options.printerName,'Brother');assert.equal(f.pdfs[0].options.paperSize,'a4');
});

test('diagnostic capture never submits an A4 shelf sheet',async()=>{
 const f=fixture(); f.object.diagnostic=()=>({record(){},holdPrint:()=>true,setPreview(){}});
 const r=await f.object.printHTML('<p>Labels</p>',{printerName:'Brother',pageSize:{width:210000,height:297000},exactPageSize:true});
 assert.equal(r.success,false);assert.equal(f.pdfs.length,0);assert.equal(f.submitted.length,0);
});
