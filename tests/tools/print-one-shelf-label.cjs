const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const ROOT = path.resolve(__dirname, '../..');
const argv = process.argv.slice(2);
const printer = argv[argv.indexOf('--printer') + 1];
const paper = argv.includes('--a4') ? 'a4' : 'roll';
if (!argv.includes('--printer') || !printer) throw Error('Pass --printer with an explicit printer name');
app.setPath('userData', path.join(ROOT, 'qa/shelf-print-runtime'));
app.whenReady().then(async () => {
  const { JSDOM } = require('jsdom');
  const { HardwareManager } = require('../../src/hardware-manager');
  const labels = require('../../frontend/static/script/js/core/shelf-labels');
  const dom = new JSDOM('<html><body></body></html>', {runScripts:'outside-only'});
  dom.window.eval(fs.readFileSync(path.join(ROOT,'frontend/static/script/js/JsBarcode.all.min.js'),'utf8'));
  const barcode=dom.window.JsBarcode;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: String(text).length * 6 }) });
  const s = {paper, width: paper === 'a4' ? 63 : 72, height:33, margin:5, gap:2, start:1,
    font:'Arial',fontSize:12,align:'center',fontOptions:'',ink:'#000000',background:'#ffffff',
    guides:paper==='a4',barcode:true,format:'CODE128',barWidth:1.4,barHeight:38,barMargin:3,top:3,bottom:3,left:3,right:3,
    barText:true,textMargin:2,currency:'GBP',shop:argv.includes('--raw') ? 'DIRECT THERMAL TEST' : 'LOCAL PRINT TEST'};
  const item={name:'Epoxy Fix Lock Stick Bond',barcode_id:'5034753047741',label_price:1.50,label_currency_digits:2};
  const g=labels.geometry(s);
  const count=paper==='a4' ? (argv.includes('--full-sheet') ? g.capacity : 5) : 1;
  const cells=Array(g.capacity).fill(null); for(let i=0;i<count;i++) cells[i]=item;
  console.log('LABELS',JSON.stringify({printer,paper,count,geometry:g}));
  const html='<!doctype html><html><head><meta charset="utf-8"><style>'+labels.css(s,g)+'</style></head><body>'+(argv.includes('--raw') ? '<div class="rd-document" data-receipt-design="80" style="width:72mm">' : '')+labels.sheet(dom.window.document,cells,s,barcode).outerHTML+(argv.includes('--raw') ? '</div>' : '')+'</body></html>';
  const out=path.join(ROOT,'qa/shelf-print-local'); fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,paper+'.html'),html);
  const manager=new HardwareManager();
  manager.setMainWindow(new BrowserWindow({show:false,webPreferences:{sandbox:true}}));
  const send=manager._sendPrintJob.bind(manager);
  manager._sendPrintJob=async (win,opts)=>{
    const pdf=await win.webContents.printToPDF({pageSize:opts.pageSize,preferCSSPageSize:true,printBackground:true,margins:{top:0,bottom:0,left:0,right:0}});
    fs.writeFileSync(path.join(out,paper+'.pdf'),pdf);
    console.log('PRINT OPTIONS',JSON.stringify(opts));
    return send(win,opts);
  };
  const result=await manager.printHTML(html,{printerName:printer,pageSize:argv.includes('--raw')?'80mm':{width:g.width*1000,height:g.height*1000},thermalRaster:argv.includes('--raw'),exactPageSize:true,silent:true,copies:1,landscape:false});
  fs.writeFileSync(path.join(out,paper+'-result.json'),JSON.stringify(result,null,2));
  console.log('RESULT',JSON.stringify(result));
  app.exit(result.success?0:1);
}).catch(e=>{console.error(e);app.exit(1);});
