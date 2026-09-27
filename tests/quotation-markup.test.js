const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/sales.js'), 'utf8');
const start = source.indexOf('PosnicPro.quotes = {');
const quoteCode = source.slice(start, source.indexOf('\n};', start) + 3);
function editor() {
    const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '../frontend/modules/quotes.html'), 'utf8'));
    const $ = require('jquery')(dom.window);
    const PosnicPro = { local: { get: () => '' }, i18n: { t: (_k, fallback) => fallback }, alert: () => {} };
    vm.runInNewContext(quoteCode, { PosnicPro, $, window: dom.window, document: dom.window.document, hasher: { setHash: () => {} } });
    const q = PosnicPro.quotes;
    q._ed = q._edBlank();
    q._ed.pricing_mode = 'markup';
    q._ed.show_markup = true;
    q._ed.lines = [{ kind: 'custom', item_name: 'Installation', qty: 2, unit_price: 100, markup_percent: 20, tax_value: 18, tax_type: 'exclusive' }];
    return { q, $, PosnicPro };
}
test('markup editor previews final price, labels the increase, and hides discount controls', () => {
    const { q, $ } = editor();
    q.edRender();
    assert.equal(q.edRecalc(), 283.2);
    assert.equal($('#qe_price_heading').text(), 'Base unit price');
    assert.equal($('#qe_adjustment_heading').text(), 'Item markup (%)');
    assert.equal($('#qe_discount_fields').css('display'), 'none');
    assert.equal($('.qe-l-dtype').length, 0);
    assert.equal($('.qe-l-markup').val(), '20');
    const preview = $('#qe_preview').text();
    assert.match(preview, /120\.00/);
    assert.match(preview, /20% markup/);
    assert.match(preview, /40\.00 on this line/);
    assert.doesNotMatch(preview, /discount|\boff\b/i);
    q._ed.show_markup = false;
    q.edRecalc();
    assert.doesNotMatch($('#qe_preview').text(), /markup|Base|100\.00/);
    assert.match($('#qe_preview').text(), /283\.20/);
});
test('saving sends base and percentage, and never sends an invisible discount', () => {
    const { q, $, PosnicPro } = editor();
    q.edRender();
    $('#qe_disc_type').val('percent'); $('#qe_disc_value').val('50');
    q._ed.lines[0].dtype = 'amount'; q._ed.lines[0].dval = 99;
    let payload;
    PosnicPro.post = (opts) => { payload = JSON.parse(opts.data); };
    q.edSave();
    assert.equal(payload.pricing_mode, 'markup');
    assert.equal(payload.lines[0].base_unit_price, 100);
    assert.equal(payload.lines[0].markup.value, 20);
    assert.equal(payload.total, 283.2);
    assert.equal(payload.discount, undefined);
    assert.equal(payload.lines[0].discount, undefined);
});
test('invoice and old discount lines retain existing calculations', () => {
    const { q } = editor();
    const line = { qty: 2, unit_price: 100, dtype: 'percent', dval: 10, tax_value: 18, tax_type: 'exclusive' };
    assert.equal(q._edLineTotal(line), 212.4);
    assert.equal(q._edLineTax(line), 32.4);
});
test('editing a stored markup quote restores the base and does not compound the increase', () => {
    const { q, PosnicPro } = editor();
    q._edShell = () => {}; q._loadTaxList = (done) => done(); q._edSigSync = () => {};
    PosnicPro.get = (_opts, done) => done({ data: { _id: 'q1', status: 'open', pricing_mode: 'markup', show_markup: true,
        items: [{ item_name: 'Installation', qty: 2, base_unit_price: 100, unit_price: 120,
            markup: { type: 'percent', value: 20, computed: 40 } }] } });
    q.showEdit('q1');
    assert.equal(q._ed.lines[0].unit_price, 100);
    assert.equal(q.edRecalc(), 240);
    PosnicPro.get = (_opts, done) => done({ data: { _id: 'old', status: 'open', items: [{ item_name: 'Legacy', qty: 1, unit_price: 100, discount: { type: 'percent', value: 10 } }] } });
    q.showEdit('old');
    assert.equal(q._ed.pricing_mode, 'discount');
    assert.equal(q.edRecalc(), 90);
});

test('PDF renders markup with the shop currency, or final price only when hidden', () => {
    const { q, PosnicPro } = editor();
    PosnicPro.local.get = (key) => key === 'currencySign' ? '$' : '';
    const { jsPDF } = require('../frontend/static/script/js/jspdf.umd.min.js');
    let printed;
    function Pdf(options) {
        const doc = new jsPDF(options);
        const original = doc.text.bind(doc);
        printed = [];
        doc.text = (value, ...args) => { printed.push(Array.isArray(value) ? value.join(' ') : String(value)); return original(value, ...args); };
        return doc;
    }
    const doc = { quote_id: 'QUO-001', pricing_mode: 'markup', show_markup: true, items: [
        { item_name: 'Installation', qty: 2, base_unit_price: 100, unit_price: 120,
          markup: { type: 'percent', value: 20, computed: 40 }, line_total: 240 }
    ], total: 240, subtotal: 240 };
    q._buildPdf(Pdf, doc, { name: 'Lira', taxLabel: 'Tax ID' }, null);
    assert.match(printed.join(' '), /Base \$ 100\.00.*20% markup.*\$ 40\.00/);
    assert.doesNotMatch(printed.join(' '), /Rs |Discount|\boff\b/);
    doc.show_markup = false;
    q._buildPdf(Pdf, doc, { name: 'Lira', taxLabel: 'Tax ID' }, null);
    assert.doesNotMatch(printed.join(' '), /markup|100\.00/);
    assert.match(printed.join(' '), /\$ 120\.00/);
});

test('sale conversion uses the saved marked-up price for a valid catalogue quote', () => {
    const { q, PosnicPro } = editor();
    let cart;
    PosnicPro.sales = { loadDocumentIntoCart: (spec) => { cart = spec; } };
    q._current = { _id: 'quote', pricing_mode: 'markup', items: [{ kind: 'item', item_id: 'item',
        qty: 2, base_unit_price: 100, unit_price: 120, markup: { type: 'percent', value: 20 } }] };
    q.convert();
    assert.equal(cart.honour, true);
    assert.equal(cart.lines[0].unit_price, 120);
    assert.equal(cart.lines[0].dval, 0);
});

test('inline header saves retain markup metadata and line tax', () => {
    const { q, PosnicPro } = editor();
    let saved;
    PosnicPro.request = (opts) => { saved = JSON.parse(opts.data); };
    q._current = { _id: 'quote', status: 'open', pricing_mode: 'markup', show_markup: true,
        items: [{ item_name: 'Service', qty: 1, base_unit_price: 100, unit_price: 120,
          markup: { type: 'percent', value: 20 }, tax_value: 18, tax_type: 'exclusive' }] };
    q.saveEdits();
    assert.equal(saved.pricing_mode, 'markup');
    assert.equal(saved.show_markup, true);
    assert.equal(saved.items[0].base_unit_price, 100);
    assert.equal(saved.items[0].markup.value, 20);
    assert.equal(saved.items[0].tax_value, 18);
    assert.equal(saved.items[0].tax_type, 'exclusive');
});
