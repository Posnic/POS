const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../..');
const puppeteer = require(path.join(ROOT, 'api/node_modules/puppeteer'));
(async () => {
 const browser = await puppeteer.launch({headless:true});
 try {
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.setContent('<div id="newsalespage" style="display:none"></div><div id="sales_new"><input id="sales_new_item_name"><span class="salesBalanceAmount"><a class="custom_balance">PAY</a></span><table><tbody id="sales_new_items_tbody"><tr id="touch_row_one"><td>Item</td></tr></tbody></table></div><div id="infobar-settings-sidebar-tender-details" style="display:none"><input id="tendered_amount"><button id="save_btn">Save</button></div>');
  for (const file of ['frontend/static/script/js/jquery.min.js','frontend/static/script/js/jquery.scannerdetection.js','frontend/static/script/js/jQuery-Autocomplete.min.js']) await page.addScriptTag({path:path.join(ROOT,file)});
  await page.evaluate(()=>{
   window.opens=0; window.saved=0; window.scanned=[];
   window.PosnicPro={sales:{saleProcess:'Add',addByBarcode:code=>window.scanned.push(code),openTenderModel:(ready,focus)=>{
    window.opens++; PosnicPro.sales._loadingPaymentMethods=true;
    setTimeout(()=>{PosnicPro.sales._loadingPaymentMethods=false; $('#sales_new').hide();$('#infobar-settings-sidebar-tender-details').show().addClass('sidebarview');if(focus)$('#tendered_amount').focus();},100);
   }}};
   $('#save_btn').on('click',()=>{window.saved++;PosnicPro.sales.submissionInProgress=true;$('#save_btn').prop('disabled',true);});
   $('#sales_new_item_name').autocomplete({lookup:[{value:'Tea',data:'tea'}]});
  });
  const raw=fs.readFileSync(path.join(ROOT,'frontend/static/script/js/modules/js/sales.js'),'utf8');
  const start=raw.indexOf('if (!PosnicPro.sales._sharedBarcodeEnterBound)');
  const end=raw.indexOf('/*\n * Camera scan',start);
  assert.ok(start>=0 && end>start);
  await page.addScriptTag({content:raw.slice(start,end)});
  await page.focus('#sales_new_item_name'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.activeElement.id==='tendered_amount');
  assert.equal(await page.evaluate(()=>window.opens),1); assert.equal(await page.evaluate(()=>window.saved),0);
  // Holding the opening Enter, modifiers and validation dialogs must not save.
  await page.evaluate(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true})));
  await page.keyboard.down('Shift');await page.keyboard.press('Enter');await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(()=>window.saved),0);
  await page.evaluate(()=>$('#save_btn').prop('disabled',true));await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>window.saved),0);
  await page.evaluate(()=>{$('#save_btn').prop('disabled',false);$('body').append('<div class="swal2-modal">Confirm</div>');});
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.saved),0);
  await page.evaluate(()=>$('.swal2-modal').remove());
  await page.keyboard.press('Enter'); assert.equal(await page.evaluate(()=>window.saved),1);
  await page.keyboard.press('Enter'); assert.equal(await page.evaluate(()=>window.saved),1);
  // No submission is allowed from an inactive payment panel.
  await page.evaluate(()=>{PosnicPro.sales.submissionInProgress=false;$('#save_btn').prop('disabled',false);$('#infobar-settings-sidebar-tender-details').removeClass('sidebarview');});
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.saved),1);
  const reset=async()=>{await page.evaluate(()=>{$('#infobar-settings-sidebar-tender-details').hide().removeClass('sidebarview');PosnicPro.sales.submissionInProgress=false;$('#save_btn').prop('disabled',false);$('#sales_new').show();$('#sales_new_item_name').val('').focus();window.opens=0;PosnicPro.sales._searchScanPending=false;});};
  await reset();
  // A scanner's fast digits are buffered; its Enter adds the barcode, never pays.
  await page.keyboard.type('12345678'); await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.scanned.length===1); assert.equal(await page.evaluate(()=>window.opens),0);
  await reset(); await page.keyboard.type('21');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#sales_new_item_name').value==='21');
  assert.equal(await page.evaluate(()=>window.opens),0);
  await reset(); await page.evaluate(()=>$('#sales_new_items_tbody').empty());await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>window.opens),0);
  await page.evaluate(()=>$('#sales_new_items_tbody').html('<tr id="touch_row_one"><td>Item</td></tr>'));
  await page.keyboard.down('Shift');await page.keyboard.press('Enter');await page.keyboard.up('Shift');assert.equal(await page.evaluate(()=>window.opens),0);
  await page.evaluate(()=>{PosnicPro.sales.saleProcess='KOT';});await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.opens),0);
  await page.evaluate(()=>{PosnicPro.sales.saleProcess='Add';$('.salesBalanceAmount').hide();});await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.opens),0);
  await page.evaluate(()=>{$('.salesBalanceAmount').show();PosnicPro.sales.submissionInProgress=true;});await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.opens),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: empty Enter opens payment once; separate Enter in Tender clicks Save once; repeated/modified Enter, disabled Save, modal and inactive payment panel cannot save; buffered barcode/short code, empty cart, modified Enter, KOT, hidden PAY and active submission do not trigger payment.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
