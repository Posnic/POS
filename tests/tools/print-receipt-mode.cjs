// Explicit physical test: electron tests/tools/print-receipt-mode.cjs --mode exact --printer POS-80C
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const mode = args[args.indexOf('--mode') + 1];
const printer = args[args.indexOf('--printer') + 1];
if (!args.includes('--printer') || !printer || !args.includes('--mode') || !['exact','fast','driver'].includes(mode)) throw Error('Choose an explicit printer and mode');
const packagedArg = args.indexOf('--packaged');
const packaged = packagedArg >= 0 ? path.resolve(args[packagedArg + 1], 'resources') : null;
app.setPath('userData', path.resolve(__dirname, '../../qa/receipt-mode-runtime-' + process.pid));
// Electron may outlive the shell that launched it. Never write diagnostics to
// inherited pipes: a closed stdout caused an EPIPE dialog during a real test.
const logDir = app.getPath('userData');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'print-test.log');
const format = require('node:util').format;
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  console[level] = (...values) => fs.appendFileSync(logFile, level + ' ' + format(...values) + '\n');
}
app.whenReady().then(async () => {
  const { JSDOM } = require('jsdom');
  const { HardwareManager } = require(packaged ? path.join(packaged, 'app.asar/src/hardware-manager.js') : '../../src/hardware-manager');
  const manager = new HardwareManager();
  const originalRaw = manager.sendRawToPrinter.bind(manager);
  manager.sendRawToPrinter = async (...values) => {
    const result = await originalRaw(...values);
    console.log(JSON.stringify({ stage: 'raw-submission', printer: values[0], bytes: values[1].length, result }));
    return result;
  };
  manager.setMainWindow(new BrowserWindow({show:false}));
  const dom = new JSDOM('', {url:'http://localhost/',runScripts:'outside-only'});
  const w = dom.window;
  w.$ = w.jQuery = require('jquery')(w);
  w.PosnicPro = {escapeHtml:v=>w.$('<i>').text(v).html(),local:{get:()=> 'GBP'},i18n:{t:(_k,f)=>f}};
  w.electronAPI = {printer:{print:(html,options)=>manager.printHTML(html,options)}};
  for (const file of ['api/src/helpers/receipt-design.js','api/src/helpers/sale-payment-summary.js','frontend/static/script/js/core/receipt-designer.js']) w.eval(fs.readFileSync(packaged ? path.join(packaged,file) : path.resolve(__dirname,'../..',file),'utf8'));
  const sale = {branch_name:'LOCAL TEST - '+mode.toUpperCase(),sales_id:'PRINT-TEST',items:[{item_name:'Sample item',item_quantity:1,item_price:1.50,total_amount:1.50}],items_subtotal:1.50,items_total:1.50};
  sale.receipt_designs = w.PosnicPro.receiptDesigner.defaults(sale);
  const html = w.PosnicPro.receiptDesigner.render(sale,'80',false);
  const result = await w.PosnicPro.receiptDesigner.print(html,'80',{target:{name:printer,pageSize:'80mm',copies:1,printMode:mode},sample:true});
  console.log(JSON.stringify({mode,result}));
  app.exit(result.success ? 0 : 1);
}).catch(error=>{console.error(error);app.exit(1);});
