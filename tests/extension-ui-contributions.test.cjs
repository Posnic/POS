'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { uiContributions } = require('../api/src/services/extension-ui-contributions');

test('contributions preserve old sales menus and require a signed view for navigation', () => {
  assert.deepEqual(uiContributions({ menu: 'sales' }, true), { menu: 'sales', page: { header: 'host' } });
  assert.equal(uiContributions({ menu: 'inventory' }, true).menu, 'inventory');
  assert.equal(uiContributions({ menu: 'manage' }, true).menu, 'manage');
  assert.equal(uiContributions({ menu: 'sales' }, false).menu, null);
  assert.equal(uiContributions({ menu: '#/sales/new' }, true).menu, null);
});

test('page contributions cannot inject routes, selectors or external URLs', () => {
  for (const page of [null, [], 'full', {}, { header: 'bad' }, { header: 'host', route: '/sales' }, { header: 'extension', url: 'https://example.com' }]) {
    assert.throws(() => uiContributions({ page }, true), /extension_page_contribution_invalid/);
  }
  assert.throws(() => uiContributions({ page: { header: 'extension' } }, false), /invalid/);
});

function harness() {
  const dom = new JSDOM('<ul><li><a id="view_sales_page"></a></li></ul><ul><li><a id="view_items_page"></a></li></ul><ul><li><a id="view_extensions_page"></a></li></ul>' + fs.readFileSync(path.resolve(__dirname, '../frontend/modules/extensions.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://example.test/' });
  const w = dom.window;
  w.$ = () => ({ hide() {}, show() {} });
  let branch = 'one';
  w.PosnicPro = { HideSideBarModal() {}, local: { get: () => branch } };
  w.PosnicExtensionFrame = { mount: () => ({ destroy() {} }) };
  w.eval(fs.readFileSync(path.resolve(__dirname, '../frontend/static/script/js/modules/js/extensions.js'), 'utf8'));
  return { dom, w, changeBranch: () => { branch = 'two'; } };
}

test('menus stay in declared host locations, escape labels and disappear on revoked access', async () => {
  const { dom, w } = harness();
  try {
    const entries = ['sales', 'inventory', 'manage'].map(menu => ({ id: 'example.' + menu, menu, displayName: '<img onerror=alert(1)>' }));
    w.PosnicPro.request = (_, done) => done({ extensions: [...entries, { id: 'example.disabled', menu: 'sales', enabled: false }, { id: 'example.unknown', menu: '__proto__' }] });
    await w.PosnicPro.extensions.refreshMenu();
    assert.equal(w.document.querySelectorAll('[data-extension-menu]').length, 3);
    for (const [menu, anchor] of [['sales', 'view_sales_page'], ['inventory', 'view_items_page'], ['manage', 'view_extensions_page']]) {
      const row = w.document.getElementById(anchor).parentElement.nextElementSibling;
      assert.equal(row.dataset.extensionMenu, 'example.' + menu);
      assert.equal(row.querySelector('a').getAttribute('href'), '#/extensions/example.' + menu);
      assert.equal(row.querySelectorAll('[onerror]').length, 0);
    }
    w.PosnicPro.request = (_, done) => done({ extensions: [] });
    await w.PosnicPro.extensions.refreshMenu();
    assert.equal(w.document.querySelectorAll('[data-extension-menu]').length, 0);
  } finally { dom.window.close(); }
});

test('late menu response cannot cross a branch change', async () => {
  const { dom, w, changeBranch } = harness();
  try {
    let respond;
    w.PosnicPro.request = (_, done) => { respond = done; };
    const pending = w.PosnicPro.extensions.refreshMenu();
    changeBranch();
    respond({ extensions: [{ id: 'example.sales', menu: 'sales', displayName: 'Private' }] });
    await pending;
    assert.equal(w.document.querySelectorAll('[data-extension-menu]').length, 0);
  } finally { dom.window.close(); }
});

test('any authorized extension can own its header and the next page resets it', async () => {
  const { dom, w } = harness();
  try {
    let page = { header: 'extension' };
    w.PosnicPro.request = (_, done) => done({ displayName: 'Example', page, view: {} });
    await w.PosnicPro.extensions.showDetails('example.independent');
    assert.equal(w.document.querySelector('#extensions .crumbbar_padding').style.display, 'none');
    page = { header: 'host' };
    await w.PosnicPro.extensions.showDetails('example.other');
    assert.equal(w.document.querySelector('#extensions .crumbbar_padding').style.display, '');
  } finally { dom.window.close(); }
});
