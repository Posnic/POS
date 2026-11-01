const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('frontend/static/script/js/modules/js/sales.js', 'utf8');
const jquery = fs.readFileSync('frontend/static/script/js/jquery.min.js', 'utf8');
function fixture() {
  const dom = new JSDOM('<div id="newsalespage"><button class="sale-done-primary">Next sale</button></div><input id="sales_new_item_name"><div id="infobar-settings-sidebar-tender-details"></div><table><tbody><tr id="touch_row_a"><td><button class="sale-weight-amount" data-id="a">By amount</button><input id="touchsale_item_qtya" value="1"></td><td id="addSalesLineItemSellingPrice_a">52</td><td id="addSalesLineItemTax_a">0</td><td id="addSalesLineItemTaxType_a">Inc</td><td id="addSalesLineItemDiscount_a">0</td><td id="discountSigna">%</td></tr></tbody></table>', { runScripts: 'outside-only', url: 'https://test.invalid' });
  const w = dom.window;
  w.eval(jquery);
  w.$.expr.pseudos.visible = n => n.style.display !== 'none';
  w.PosnicPro = { i18n: { t: (key, fallback) => fallback }, local: { get: () => '₹' }, alert() {}, sales: { SaleAction: 'add', quantity: { textOnChange() {} }, saleDoneTimer: { stop() {} } } };
  w.PosnicPro.local.get = key => key === 'general_settings' ? '{}' : key === 'branch_id_set' ? 'branch-a' : '₹';
  const weighStart = source.indexOf('PosnicPro.sales.weighEntry =');
  w.eval(source.slice(weighStart, source.indexOf('PosnicPro.sales.askSearchQuantity =', weighStart)));
  return { dom, w };
}
test('tile entry asks for weight before creating a cart line', () => {
  const { dom, w } = fixture();
  try {
    let selected;
    w.PosnicPro.sales.isWeighedItem = item => item.item_weight_machine_based === true;
    w.PosnicPro.sales.askSearchQuantity = (item, id) => { selected = { item, id }; };
    const start = source.indexOf('    addSalesLineItems: function (params) {');
    const end = source.indexOf('        // Recency', start);
    w.eval('PosnicPro.sales.addSalesLineItems = function (params) {' + source.slice(source.indexOf('\n', start), end) + '};');
    w.PosnicPro.sales.addSalesLineItems({ id: 'a', item_weight_machine_based: true });
    assert.equal(selected.id, 'a');
    assert.equal(selected.item._searchDetailsLoaded, true);
    assert.equal(w.$('#touchsale_item_qtya').val(), '1');
  } finally { dom.window.close(); }
});
for (const accept of [true, false]) test('nearby measured amount requires confirmation: ' + accept, async () => {
  const { dom, w } = fixture(); let calls = [], recalculated = 0;
  w.WeightBridge = { isAvailable: () => true, getCurrentWeight: async () => 1.9 };
  w.PosnicPro.sales.quantity.textOnChange = () => recalculated++;
  w.swal = async options => {
    calls.push(options);
    if (calls.length === 1) {
      w.document.body.insertAdjacentHTML('beforeend', options.html);
      options.onOpen();
      w.$('#weigh_amount').val('100').trigger('input');
      await new Promise(resolve => setTimeout(resolve, 5));
      const value = await options.preConfirm(); options.onClose(); return { value };
    }
    return accept ? { value: true } : { dismiss: 'cancel' };
  };
  const start = source.indexOf("$(document).on('click', '.sale-weight-amount'");
  w.eval(source.slice(start, source.indexOf('\n});', start) + 4));
  w.$('.sale-weight-amount').trigger('click');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.length, 2); assert.match(calls[1].text, /98\.80/);
  assert.equal(recalculated, accept ? 1 : 0);
  assert.equal(w.$('#touchsale_item_qtya').val(), accept ? '1.900' : '1');
  dom.window.close();
});
test('completed-sale return focuses search when already on New Sale', async () => {
  const { dom, w } = fixture();
  const start = source.indexOf("$(document).on('click', '#newsalespage .sale-done-primary'");
  w.eval(source.slice(start, source.indexOf('\n});', start) + 4));
  w.$('.sale-done-primary').trigger('click');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(w.document.activeElement.id, 'sales_new_item_name');
  assert.equal(w.PosnicPro.sales._focusAfterCompletedSale, true);
  dom.window.close();
});
test('bundled SweetAlert accepts Promise confirmation and applies its direct result', async () => {
  const { dom, w } = fixture();
  try {
  w.scrollTo = () => {};
  Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { get() { return this.style.display === 'none' ? 0 : 500; } });
  Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { get() { return this.style.display === 'none' ? 0 : 400; } });
  w.eval(fs.readFileSync('frontend/static/style/plugins/sweet-alert2/sweetalert2.min.js', 'utf8'));
  w.WeightBridge = { isAvailable: () => true, getCurrentWeight: async () => 1.9 };
  const start = source.indexOf("$(document).on('click', '.sale-weight-amount'");
  w.eval(source.slice(start, source.indexOf('\n});', start) + 4));
  w.$('.sale-weight-amount').trigger('click');
  await new Promise(resolve => setTimeout(resolve, 20));
  w.$('#weigh_amount').val('100').trigger('input');
  w.swal.clickConfirm();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(w.document.body.textContent, /Confirm actual amount/);
  w.swal.clickConfirm();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(w.$('#touchsale_item_qtya').val(), '1.900');
  } finally { dom.window.close(); }
});
test('restricted startup skips inventory requests, permitted staff still receive the stock bell', () => {
  const { dom, w } = fixture();
  try {
    const code = fs.readFileSync('frontend/static/script/js/modules/js/stocklog.js', 'utf8');
    const start = code.indexOf('    viewLowStockDashboard: function () {');
    w.eval('PosnicPro.stocklogs = {' + code.slice(start, code.indexOf('\n};', start)) + '\n};');
    let loaded = false, permitted = false, requests = 0;
    w.PosnicPro.aclLoaded = () => loaded;
    w.PosnicPro.checkAccess = () => permitted;
    w.PosnicPro.bellFeed = { setLowStock() {} };
    w.PosnicPro.get = () => requests++;
    w.PosnicPro.stocklogs.viewLowStockDashboard();
    loaded = true; w.PosnicPro.stocklogs.viewLowStockDashboard();
    assert.equal(requests, 0);
    permitted = true; w.PosnicPro.stocklogs.viewLowStockDashboard();
    assert.equal(requests, 1);
  } finally { dom.window.close(); }
});

test('compact weighing popup defaults to scale, supports manual amount and confirms actual total', async () => {
  const { dom, w } = fixture();
  try {
    w.scrollTo = () => {};
    Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', {get(){return 500;}});
    Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', {get(){return 400;}});
    w.eval(fs.readFileSync('frontend/static/style/plugins/sweet-alert2/sweetalert2.min.js','utf8'));
    w.PosnicBillingSearch = require('../api/src/helpers/billing-search');
    w.PosnicPro.local.get = key => key === 'general_settings' ? '{}' : key === 'branch_id_set' ? 'branch-a' : '₹';
    w.WeightBridge={isAvailable:()=>true,getCurrentWeight:async()=>1.9};
    const start=source.indexOf('PosnicPro.sales.weighEntry =');
    w.eval(source.slice(start,source.indexOf('PosnicPro.sales.askSearchQuantity =',start)));
    const pending=w.PosnicPro.sales.weighEntry({name:'Onion',unit:'kg',selling_price:50});
    await new Promise(r=>setTimeout(r,20));
    assert.equal(w.$('#weigh_quantity').prop('readOnly'),true);
    assert.equal(w.$('#weigh_quantity').val(),'1.900');
    assert.match(w.document.body.textContent,/95.00/);
    w.$('[data-weigh-mode="amount"]').click();w.$('#weigh_amount').val('100').trigger('input');
    assert.match(w.$('#weigh_target').text(),/2.000 kg/);
    w.$('[data-weigh-source="manual"]').click();assert.equal(w.$('#weigh_quantity').prop('readOnly'),false);
    w.$('#weigh_quantity').val('1.905').trigger('input');w.swal.clickConfirm();
    await new Promise(r=>setTimeout(r,20));assert.match(w.document.body.textContent,/Confirm actual amount/);assert.match(w.document.body.textContent,/95.25/);
    w.swal.clickConfirm();assert.equal(await pending,1.905);
  } finally {dom.window.close();}
});
