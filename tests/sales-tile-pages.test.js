const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../frontend/static/script/js/modules/js/sales.js'), 'utf8');
function setup() {
    const dom = new JSDOM('<div id="sales_new_productList"><div id="tiles"></div></div>');
    const $ = require('jquery')(dom.window);
    const PosnicPro = { sales: { itemsMenu: { variantPop: { close() {} }, clickEffect() {} } } };
    const start = source.indexOf('PosnicPro.sales.renderTilePages =');
    const end = source.indexOf('PosnicPro.sales.itemsMenu =', start);
    new Function('$', 'PosnicPro', source.slice(start, end))($, PosnicPro);
    return { $, sales: PosnicPro.sales };
}
test('2,053 products remain reachable with at most 48 live tiles, including last page and back', () => {
    const { $, sales } = setup();
    sales.renderTilePages($('#tiles'), Array.from({ length: 2053 }, (_, i) => '<div class="product">' + i + '</div>'));
    assert.equal($('.product').length, 48);
    assert.equal($('button').first().prop('disabled'), true);
    const visited = new Set();
    for (let page = 0; page < 43; page++) {
        $('.product').each((_, element) => visited.add(Number(element.textContent)));
        assert.ok($('.product').length <= 48);
        if (page < 42) $('button').last().trigger('click');
    }
    assert.equal(visited.size, 2053);
    assert.equal($('.product').length, 37);
    assert.equal($('button').last().prop('disabled'), true);
    $('button').first().trigger('click');
    assert.equal($('.product').first().text(), '1968');
});
test('category illustrations preserve custom uploads and replace stock placeholders', () => {
    const { sales } = setup();
    assert.equal(sales.categoryPicture('Baby', '/uploads/own.png'), '/uploads/own.png');
    for (const [name, icon] of [['BABY', 'baby'], ['BATTERY', 'battery'], ['BICYCLE', 'bicycle'], ['CANDLES', 'candle'], ['DIY', 'tools']]) {
        const asset = sales.categoryPicture(name, 'static/images/default/category.svg');
        assert.equal(asset, 'static/images/categories/' + icon + '.svg');
        assert.ok(fs.existsSync(require('node:path').join(__dirname, '../frontend', asset)));
    }
});

test('each client category has a distinct illustration, including similar category names', () => {
    const { sales } = setup();
    const names = require('./fixtures/sales-category-names.json');
    const assets = names.map(name => sales.categoryPicture(name, 'static/images/default/category.svg'));
    assert.equal(new Set(assets).size, names.length);
    const drawings = assets.map(asset => fs.readFileSync(require('node:path').join(__dirname, '../frontend', asset), 'utf8'));
    assert.equal(new Set(drawings).size, names.length);
    assert.equal(sales.categoryPicture(' body   wear ', ''), 'static/images/categories/clothing.svg');
    assert.equal(sales.categoryPicture('Body Wear', '/uploads/clothes.png'), '/uploads/clothes.png');
});

test('remote paging requests only the next page on a tap and prevents duplicate taps', () => {
    const { $, sales } = setup();
    const requests = [];
    sales.renderTilePages($('#tiles'), Array.from({ length: 48 }, (_, i) => '<div class="product">' + i + '</div>'),
        { offset: 0, nextOffset: 48, load: offset => requests.push(offset) });
    assert.deepEqual(requests, []);
    assert.equal($('[role="status"]').text(), '1–48');
    $('button').last().get(0).click();
    $('button').last().get(0).click();
    assert.deepEqual(requests, [48]);
    assert.equal($('.product').length, 48);
    assert.equal($('button').last().prop('disabled'), true);
});
