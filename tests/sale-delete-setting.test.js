'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/sales.js'), 'utf8');

for (const setting of [undefined, 'false', 'true']) {
 for (const role of ['super_admin', 'admin', 'owner', 'manager', 'cashier']) {
  test('sale delete is opt-in and super-admin-only: ' + role + '/' + setting, () => {
    const dom = new JSDOM('<div id="sales_doc"></div><div class="removeText"></div>', { runScripts: 'outside-only' });
    const win = dom.window;
    win.$ = require('jquery')(win);
    let confirmations = 0;
    win.PosnicPro = {
      local: { get: key => key === 'usertype' ? role : setting },
      i18n: { t: (_key, fallback) => fallback },
      sales: { buildSaleSheet: () => '' },
      restaurantSaleDetails: { render: () => '' },
      alert: () => {},
      deleteTableRowData: () => { confirmations++; }
    };
    for (const name of ['renderSaleDoc', 'showDelete']) {
      const start = source.indexOf('    ' + name + ': function');
      const end = source.indexOf('\n    },', start);
      win.eval('PosnicPro.sales.' + name + ' = ' + source.slice(source.indexOf('function', start), end + 6) + ';');
    }
    win.PosnicPro.sales.renderSaleDoc({ _id: 'abc', sales_id: 'S1', payment_status: 'Paid' });
    const allowed = role === 'super_admin' && setting === 'true';
    assert.equal(win.document.querySelectorAll('[data-access="delete"]').length, allowed ? 1 : 0);
    win.PosnicPro.sales.showDelete('abc');
    assert.equal(confirmations, allowed ? 1 : 0);
    if (allowed) assert.match(win.document.querySelector('.removeText').textContent, /Recycle Bin/);
    dom.window.close();
  });
 }
}
