const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('frontend/static/script/js/modules/js/payment-correction.js', 'utf8');
async function setup() {
    const dom = new JSDOM('<div id="sales_doc"><div class="p-doc-toolbar"><span class="ml-auto"></span></div><div class="doc-scroll"></div></div>', { url:'https://example.test', runScripts:'outside-only' });
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
