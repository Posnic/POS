const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

/*
 * Drive the Quick and Bulk item pages in a real DOM.
 *
 * The markup loaded here is the shipped page, so the selectors under test are
 * the ones that exist at runtime - a renamed id fails these tests rather than
 * failing silently in front of a shopkeeper. Only the network is stubbed, and
 * every request is captured so the payload can be checked field by field
 * against what the full form sends.
 */
const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'frontend/modules/quick_items.html');
const MODULE = path.join(ROOT, 'frontend/static/script/js/modules/js/quick_items.js');

const CATEGORY_ID = '65f000000000000000000001';

function boot() {
  const dom = new JSDOM('<!doctype html><html><body>'
    + fs.readFileSync(PAGE, 'utf8') + '</body></html>');
  /* jQuery stays on 3 deliberately: the frontend ships 3.3.1, and the product
     code still calls $.trim, which 4 removed. Testing this markup against 4
     would be testing it against a library it never runs on. */
  const $ = require('jquery')(dom.window);

  const sent = [];
  const alerts = [];
  const PosnicPro = {
    local: { get: () => null },
    alert: (type, message) => alerts.push(type + ': ' + message),
    /* The words a module writes now come through i18n. Answer the way the
       real t() answers with no pack loaded: the English it was handed. */
    i18n: { t: (key, english) => english },

    HideSideBarModal: () => {},
    get: (params, ok) => {
      const url = String(params.url);
      if (url.includes('categories')) {
        return ok({ suggestions: [{ id: CATEGORY_ID, name: 'Grocery' }] });
      }
      if (url.includes('getUnitAjaxList')) {
        return ok({ suggestions: [{ unit_id: 'u1', unit_name: 'Kilogram', unit_value: 'kg' }] });
      }
      return ok({ type: 'success', data: [] });
    },
    request: (params, ok) => {
      sent.push(JSON.parse(params.data));
      ok({ type: 'success', data: { id: 'id' + sent.length } });
    },
  };

  new dom.window.Function('PosnicPro', '$', 'window', 'document',
    fs.readFileSync(MODULE, 'utf8'))(PosnicPro, $, dom.window, dom.window.document);

  return { dom, $, PosnicPro, sent, alerts };
}

function paste($, dom, $cell, text) {
  const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  event.clipboardData = { getData: () => text };
  $cell[0].dispatchEvent(event);
}

test('quick add posts what the full form would post', () => {
  const { $, PosnicPro, sent } = boot();
  PosnicPro.quickitems.showDataTablePage();

  $('#qa_name').val('Sugar 1kg');
  $('#qa_selling_price').val('45.50');
  $('#qa_quantity').val('12');
  PosnicPro.quickitems.save();

  assert.strictEqual(sent.length, 1);
  const item = sent[0];
  assert.strictEqual(item.name, 'Sugar 1kg');
  assert.strictEqual(item.selling_price, 45.5);
  assert.strictEqual(item.available_quantity, 12);
  // The full form ships this checked; an item added quickly must count stock
  // the same way as one added the long way.
  assert.strictEqual(item.inventory, true);
  // No barcode is invented for an item left without one - the full form does
  // not generate them either, and made-up codes are hard to undo.
  assert.strictEqual(item.barcode_id, '');
  assert.strictEqual(item.company_price, 0);
});

test('the form clears and keeps focus for the next item', () => {
  const { $, PosnicPro } = boot();
  PosnicPro.quickitems.showDataTablePage();
  $('#qa_name').val('Tea');
  $('#qa_selling_price').val('10');
  PosnicPro.quickitems.save();

  assert.strictEqual($('#qa_name').val(), '');
  assert.strictEqual($('#qa_selling_price').val(), '');
  assert.strictEqual(PosnicPro.quickitems.added.length, 1);
});

test('an item with no name is refused rather than posted', () => {
  const { $, PosnicPro, sent, alerts } = boot();
  PosnicPro.quickitems.showDataTablePage();
  $('#qa_name').val('   ');
  PosnicPro.quickitems.save();

  assert.strictEqual(sent.length, 0);
  assert.match(alerts.join(' '), /needs a name/);
});

test('the grid grows a row as the last one is filled', () => {
  const { $, PosnicPro } = boot();
  PosnicPro.bulkitems.showDataTablePage();
  const before = $('#bulk_rows tr').length;
  assert.ok(before > 0, 'the grid should open with rows ready');

  $('#bulk_rows tr').last().find('[data-col="name"]').val('Tea').trigger('input');
  assert.strictEqual($('#bulk_rows tr').length, before + 1);
});

test('a block pasted from a spreadsheet lands in the right cells', () => {
  // Excel puts tabs between cells and newlines between rows on the clipboard.
  const { $, dom, PosnicPro } = boot();
  PosnicPro.bulkitems.showDataTablePage();

  paste($, dom, $('#bulk_rows tr').first().find('[data-col="name"]'),
    'Rice 5kg\t480\t410\t20\t8901234567890\tGrocery\n'
    + 'Salt 1kg\t22\t18\t50\t\tGrocery\n'
    + 'Oil 1L\t145\t120\t15\t\tGrocery');

  const row = (n, col) => $('#bulk_rows tr').eq(n).find('[data-col="' + col + '"]').val();
  assert.strictEqual(row(0, 'name'), 'Rice 5kg');
  assert.strictEqual(row(0, 'selling_price'), '480');
  assert.strictEqual(row(0, 'barcode'), '8901234567890');
  assert.strictEqual(row(2, 'name'), 'Oil 1L');
  assert.strictEqual(row(1, 'barcode'), '', 'an empty pasted cell must stay empty');
});

test('the grid shows name and price only until asked for more', () => {
  // CSV import already handles a list that exists as a file, with every field.
  // This page is for typing, where the two things you type are name and price.
  const { $, PosnicPro } = boot();
  PosnicPro.bulkitems.showDataTablePage();

  // jsdom does no layout, so jQuery's :hidden is true for every element here.
  // The display style is what the code actually sets, and what can be checked.
  const shown = ($cell) => $cell.closest('td')[0].style.display !== 'none';

  const $row = $('#bulk_rows tr').first();
  assert.strictEqual(shown($row.find('[data-col="name"]')), true);
  assert.strictEqual(shown($row.find('[data-col="selling_price"]')), true);
  assert.strictEqual(shown($row.find('[data-col="barcode"]')), false);

  PosnicPro.bulkitems.toggleColumns();
  assert.strictEqual(shown($row.find('[data-col="barcode"]')), true);

  // Rows added after the toggle must match the columns already on screen.
  PosnicPro.bulkitems.addRows(1);
  assert.strictEqual(shown($('#bulk_rows tr').last().find('[data-col="barcode"]')), true);
});

test('a paste wider than the visible grid opens the rest of it', () => {
  // Filling a column nobody can see would save data the person pasting never
  // got to check.
  const { $, dom, PosnicPro } = boot();
  PosnicPro.bulkitems.showDataTablePage();
  assert.strictEqual(PosnicPro.bulkitems.extraShown, false);

  paste($, dom, $('#bulk_rows tr').first().find('[data-col="name"]'),
    'Rice 5kg\t480\t410\t20\t8901234567890\tGrocery');

  assert.strictEqual(PosnicPro.bulkitems.extraShown, true, 'hidden columns should have opened');
  const $barcode = $('#bulk_rows tr').eq(0).find('[data-col="barcode"]');
  assert.strictEqual($barcode.val(), '8901234567890');
  assert.notStrictEqual($barcode.closest('td')[0].style.display, 'none');
});

test('a name-and-price paste leaves the extra columns closed', () => {
  const { $, dom, PosnicPro } = boot();
  PosnicPro.bulkitems.showDataTablePage();

  paste($, dom, $('#bulk_rows tr').first().find('[data-col="name"]'),
    'Rice 5kg\t480\nSugar 1kg\t45');

  assert.strictEqual(PosnicPro.bulkitems.extraShown, false);
  assert.strictEqual($('#bulk_rows tr').eq(1).find('[data-col="name"]').val(), 'Sugar 1kg');
});

test('a paste longer than the grid grows it to fit', () => {
  const { $, dom, PosnicPro } = boot();
  PosnicPro.bulkitems.showDataTablePage();
  const lines = [];
  for (let i = 0; i < 40; i++) lines.push('Item ' + i + '\t' + i);

  paste($, dom, $('#bulk_rows tr').first().find('[data-col="name"]'), lines.join('\n'));

  assert.ok($('#bulk_rows tr').length >= 40, 'grid should have grown to hold every pasted row');
  assert.strictEqual($('#bulk_rows tr').eq(39).find('[data-col="name"]').val(), 'Item 39');
});

test('saving the grid posts every named row once', () => {
  const { $, dom, PosnicPro, sent } = boot();
  PosnicPro.bulkitems.showDataTablePage();
  paste($, dom, $('#bulk_rows tr').first().find('[data-col="name"]'),
    'Rice 5kg\t480\t410\t20\t8901234567890\tGrocery\nSalt 1kg\t22\t18\t50\t\tGrocery');

  PosnicPro.bulkitems.saveAll();
  assert.strictEqual(sent.length, 2);

  const rice = sent.find((s) => s.name === 'Rice 5kg');
  assert.strictEqual(rice.company_price, 410);
  // A typed category has to become a real one: the server keeps category_name
  // as given but only sets category_id when it is a valid id, so posting a
  // bare name would file the item under a category nothing else knows about.
  assert.strictEqual(rice.category_id, CATEGORY_ID);
  assert.strictEqual(rice.category_name, 'Grocery');

  // Pressing Save all twice must not enter the shop's stock twice.
  PosnicPro.bulkitems.saveAll();
  assert.strictEqual(sent.length, 2, 'a second press posted rows again');
  assert.strictEqual(
    $('#bulk_rows tr').eq(0).find('[data-col="name"]').prop('readonly'), true,
    'saved rows should be locked');
});

test('a category the shop does not have is reported, not saved as a label', () => {
  const { $, PosnicPro, sent } = boot();
  PosnicPro.bulkitems.showDataTablePage();
  $('#bulk_rows tr').eq(0).find('[data-col="name"]').val('Mystery');
  $('#bulk_rows tr').eq(0).find('[data-col="category"]').val('Nonesuch');

  PosnicPro.bulkitems.saveAll();

  assert.strictEqual(sent.length, 0);
  assert.match($('#bulk_rows tr').eq(0).find('.bulk-status').text(), /no category/);
});

test('clearing the grid leaves saved rows alone', () => {
  const { $, PosnicPro } = boot();
  PosnicPro.bulkitems.showDataTablePage();
  $('#bulk_rows tr').eq(0).find('[data-col="name"]').val('Saved one');
  $('#bulk_rows tr').eq(1).find('[data-col="name"]').val('Not yet');
  PosnicPro.bulkitems.saveAll();

  // Row 0 is now saved; row 1 was saved too, so type into a fresh row.
  $('#bulk_rows tr').last().find('[data-col="name"]').val('Draft');
  PosnicPro.bulkitems.clear();

  assert.strictEqual($('#bulk_rows tr').eq(0).find('[data-col="name"]').val(), 'Saved one',
    'a saved row must not be blanked - that would suggest it was undone');
  assert.strictEqual($('#bulk_rows tr').last().find('[data-col="name"]').val(), '');
});
