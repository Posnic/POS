const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('frontend/static/script/js/modules/js/payment-correction.js', 'utf8');
async function setup() {
    const dom = new JSDOM('<div id="sales_doc"><div class="p-doc-toolbar"><span class="ml-auto"></span><div data-sale-edit-actions class="dropdown-menu"></div></div><div class="doc-scroll"></div></div>', { url:'https://example.test', runScripts:'outside-only' });
    const w=dom.window, $=require('jquery')(w); w.jQuery=$;
    $.fn.modal=function(action){ if(action==='hide') this.trigger('hidden.bs.modal'); return this; };
    const sent=[];
    w.PosnicPro={ i18n:{t:(_key,fallback)=>fallback}, local:{get:()=> '₹'}, alert:()=>{}, sales:{_correctionSaleId:'sale1',openDoc:()=>{}},
        get:(_options,done)=>done({enabled:true,bill:'S1',payments:[{method:'Cash',amount:500}],methods:['Cash','UPI','Card','Bank transfer'],money:{factor:100,currencyDigits:2},history:[],revision:'v1'}),
        post: (options,done)=>{sent.push(JSON.parse(options.data));done({saved:true});} };
    w.eval(source); w.PosnicPaymentCorrection.open('sale1'); await Promise.resolve();
    return {dom,w,$,sent};
}
test('single method allocates full total, reason is required, and save sends reviewed data',async()=>{
    const {dom,$,sent}=await setup();
    $('[data-method="1"]').trigger('click'); assert.equal($('.pc-next').prop('disabled'),true);
    $('[data-reason="0"]').trigger('click'); assert.equal($('.pc-next').prop('disabled'),false);
    $('.pc-next').trigger('click'); assert.match($('.pc-review').text(),/UPI.*500.00/);
    $('.pc-save').trigger('click'); await Promise.resolve();
    assert.deepEqual(sent[0].payments,[{method:'UPI',amount:500}]);assert.equal(sent[0].reason,'Wrong method selected');dom.window.close();
});
test('mixed validates exact total, precision, two methods and custom reason',async()=>{
    const {dom,$,sent}=await setup();
    $('[data-method="4"]').trigger('click'); $('[data-reason="6"]').trigger('click');
    $('[data-amount="0"]').val('200').trigger('input');$('[data-amount="1"]').val('300.001').trigger('input');
    $('textarea').val('Actual split confirmed').trigger('input');assert.equal($('.pc-next').prop('disabled'),true);
    $('[data-amount="1"]').val('300').trigger('input');assert.equal($('.pc-next').prop('disabled'),false);
    $('.pc-next').trigger('click');$('.pc-save').trigger('click');await Promise.resolve();
    assert.deepEqual(sent[0].payments,[{method:'Cash',amount:200},{method:'UPI',amount:300}]);dom.window.close();
});
test('uncertain retry retains request id and payload; no duplicate submissions while saving',async()=>{
    const {dom,w,$,sent}=await setup();let reject;
    w.PosnicPro.post=(options,_done,fail)=>{sent.push(JSON.parse(options.data));reject=fail;};
    $('[data-method="2"]').trigger('click');$('[data-reason="3"]').trigger('click');$('.pc-next').trigger('click');
    $('.pc-save').trigger('click');$('.pc-save').trigger('click');assert.equal(sent.length,1);
    reject({responseJSON:{message:'Temporary failure'}});await Promise.resolve();await Promise.resolve();
    $('.pc-save').trigger('click');assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);dom.window.close();
});


test('payment correction appears inside Edit and opens the existing correction dialog', async () => {
    const { dom, w, $ } = await setup();
    $('.modal').remove();
    w.PosnicPaymentCorrection.attach('sale1', { payment_status: 'Paid' });
    await Promise.resolve();
    assert.equal($('#sales_doc [data-sale-edit-actions] [data-correct-payment]').length, 1);
    assert.equal($('#sales_doc .p-doc-toolbar > [data-correct-payment]').length, 0);
    $('[data-correct-payment]').trigger('click');
    await Promise.resolve();
    assert.equal($('#pc-title').text(), 'Correct payment method');
    dom.window.close();
});

test('disabled setting and permission errors never expose correction', async () => {
    for (const forbidden of [false, true]) {
        const { dom, w, $ } = await setup();
        w.PosnicPro.get = (_options, done, fail) => forbidden ? fail({responseJSON:{message:'Forbidden'}}) : done({enabled:false,history:[]});
        w.PosnicPaymentCorrection.attach('sale1', {payment_status:'Paid'});
        await Promise.resolve(); await Promise.resolve();
        assert.equal($('[data-correct-payment]').length, 0);
        dom.window.close();
    }
});

test('unpaid, cancelled and returned bills cannot offer correction', async () => {
    const { dom, w, $ } = await setup();
    w.PosnicPro.get = () => assert.fail('Ineligible bill queried payment correction');
    for (const sale of [{payment_status:'Unpaid'}, {payment_status:'Paid',sale_process:'Cancelled'}, {payment_status:'Paid',sale_process:'Return'}]) {
        w.PosnicPaymentCorrection.attach('sale1', sale);
        assert.equal($('[data-correct-payment]').length, 0);
    }
    dom.window.close();
});

test('a slow previous bill response cannot add an action to another bill', async () => {
    const { dom, w, $ } = await setup();
    let answer;
    w.PosnicPro.get = (_options, done) => { answer = done; };
    w.PosnicPaymentCorrection.attach('sale1', {payment_status:'Paid'});
    w.PosnicPro.sales._correctionSaleId = 'sale2';
    answer({enabled:true,history:[]});
    await Promise.resolve();
    assert.equal($('[data-correct-payment]').length, 0);
    dom.window.close();
});


test('a direct Sales visit loads payment correction without opening Reports', () => {
    const manifest = JSON.parse(fs.readFileSync('frontend/pages_css_js_map.json', 'utf8'));
    const module = 'static/script/js/modules/js/payment-correction.js';
    assert.equal(manifest.dashboard.js.filter(file => file === module).length, 1);
    assert.ok(!manifest.lazy_reports.includes(module), 'Reports must not recreate the correction module');
});


test('paid bill edit reviews the changed total and requires a reason before submitting',async()=>{
 const {dom,w,$}=await setup();$('.modal').remove();let submitted;
 const editingBill = {sales_total:357,recorded_bill:Object.freeze({sales_total:357,updated_date:'2026-10-14T01:30:00Z'})};
 editingBill.sales_total = 168; // The existing cart recalculates this field when a line is removed.
 w.PosnicPaymentCorrection.reviewBillEdit(editingBill, {sales_total:168,payment_mode:'UPI'}, value=>submitted=value);
 assert.match($('#paid-bill-review').text(),/357.00/);assert.match($('#paid-bill-review').text(),/168.00.*UPI/);
 assert.match($('#paid-bill-review').text(),/No money is collected or refunded/);
 assert.equal($('[data-save-correction]').prop('disabled'),true);
 $('#paid-bill-reason').val('Wrong item and payment recorded').trigger('input');
 assert.equal($('[data-save-correction]').prop('disabled'),false);
 $('[data-save-correction]').trigger('click');
 assert.equal(submitted.originalTotal,357);assert.equal(submitted.reason,'Wrong item and payment recorded');
 assert.ok(submitted.id);dom.window.close();
});
