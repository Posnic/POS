const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
test('stock ledger rows and CSV show three-decimal quantities without floating-point noise', () => {
  const dom = new JSDOM('<div id="stocklogs_list_rows"></div><div id="stocklogs_list_paging"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  try {
    w.eval(fs.readFileSync('frontend/static/script/js/jquery.min.js', 'utf8'));
    const row = { _id: 'test', item_name: 'Onion', count: 98 - 98.395, opening_balance: 98.395, closing_balance: 98, string_date: 'now' };
    w.PosnicPro = { i18n: { t: (k, v) => v }, convertDate: v => v, listDoc: { activeId: () => null }, listFilter: { legacyFilters: () => ({}), request: (k, p, cb) => cb({ data: { list: [row], total: 1 } }) } };
    w.eval(fs.readFileSync('frontend/static/script/js/modules/js/stocklog.js', 'utf8'));
    const logs = w.PosnicPro.stocklogs;
    logs.mountFilters = () => {};
    logs.loadList(1);
    const cells = w.$('#stocklogs_list_rows tbody td');
    assert.equal(cells.eq(5).text(), '98.395');
    assert.equal(cells.eq(6).text(), '-0.395');
    assert.equal(cells.eq(7).text(), '98');
    assert.deepEqual(Array.from(logs._csvSpec().map(row)).slice(6), [98.395, -0.395, 98]);
    assert.equal(logs.quantity('N/A'), 'N/A');
    assert.equal(logs.quantity(null), null);
    assert.equal(logs.quantity(0), 0);
    assert.equal(logs.quantity(1.769000000000001), 1.769);
  } finally { w.close(); }
});
