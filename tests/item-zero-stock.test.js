const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const jquery = require('jquery');

const source = fs.readFileSync('frontend/static/script/js/modules/js/items.js', 'utf8');
const method = source.slice(source.indexOf('    confirmOpeningStock: function'), source.indexOf('    /*'));
const markup = fs.readFileSync('frontend/modules/items_write.html', 'utf8');

function setup() {
  const dom = new JSDOM(markup);
  const $ = jquery(dom.window);
  $.fn.modal = function (action) {
    this.toggleClass('show', action === 'show');
    if (action === 'hide') this.trigger('hidden.bs.modal');
    return this;
  };
  const app = { items: { goToTab() {} } };
  const guard = new Function('$', 'PosnicPro', 'return ({' + method + '}).confirmOpeningStock;')($, app);
  let saves = 0;
  const save = () => saves++;
  const open = () => guard(save);
  const choose = (value) => {
    $('input[name="item_zero_choice"][value="' + value + '"]').prop('checked', true);
    $('[data-zero-continue]').trigger('click');
  };
  return { $, open, choose, saves: () => saves, close: () => dom.window.close() };
}

for (const choice of ['negative', 'untracked', 'out']) {
  test('zero opening stock waits for explicit ' + choice + ' choice', () => {
    const s = setup();
    s.open();
    s.open();
    assert.equal(s.saves(), 0);
    assert.equal(s.$('#item_zero_stock_modal').hasClass('show'), true);
    s.choose(choice);
    s.choose(choice);
    assert.equal(s.saves(), 1);
    assert.equal(s.$('#item_track_inventory').is(':checked'), choice !== 'untracked');
    assert.equal(s.$('#item_negative_stock').is(':checked'), choice === 'negative');
    s.close();
  });
}

test('enter stock and dismiss never save or change tracking; next save asks again', () => {
  const s = setup();
  s.open();
  s.$('#item_zero_stock_modal').modal('hide');
  assert.equal(s.saves(), 0);
  s.open();
  s.choose('enter');
  assert.equal(s.saves(), 0);
  assert.equal(s.$('#item_track_inventory').is(':checked'), true);
  assert.equal(s.$('#item_negative_stock').is(':checked'), false);
  s.$('#items_available_quantity').val(5);
  s.open();
  assert.equal(s.saves(), 1);
  s.close();
});

for (const [selector, property, value] of [
  ['#itemid', 'value', 'existing'],
  ['#item_is_service', 'checked', true],
  ['#item_track_inventory', 'checked', false],
  ['#item_negative_stock', 'checked', true],
  ['#items_available_quantity', 'value', '2.5'],
]) {
  test('does not interrupt save for ' + selector, () => {
    const s = setup();
    s.$(selector).prop(property, value);
    s.open();
    assert.equal(s.saves(), 1);
    s.close();
  });
}

test('blank quantity is zero; mixed variants preserve positive opening stock', () => {
  const s = setup();
  s.$('#product_with_variant').prop('checked', true);
  s.$('#load_price_fields').html('<input id="items_available_quantity_0" value=""><input id="items_available_quantity_1" value="4">');
  s.open();
  assert.equal(s.saves(), 0);
  assert.equal(s.$('[data-zero-untracked]')[0].style.display, 'none');
  s.choose('negative');
  assert.equal(s.saves(), 1);
  assert.equal(s.$('#items_available_quantity_1').val(), '4');
  assert.equal(s.$('#item_track_inventory').is(':checked'), true);
  s.close();
});
