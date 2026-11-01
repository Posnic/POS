const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

function fixture() {
  const dom = new JSDOM('<div id="detail"></div>');
  const $ = require('jquery')(dom.window);
  let active = 'size';
  let fields = [{ name: 'Small' }];
  const requests = [];
  const app = {
    i18n: { t: (_, fallback) => fallback },
    ACLForModule() {},
    get(url, done) {
      requests.push(url);
      done({ type: 'success', data: { name: 'Size', fields } });
    },
    listDoc: {
      activeId: () => active,
      open: ({ id }) => { active = id; },
      title() {},
      body: (_, html) => $('#detail').html(html),
      row: (label, value) => label + ': ' + value,
      table: (html) => html,
    },
  };
  const source = fs.readFileSync(path.join(__dirname,
    '../frontend/static/script/js/modules/js/variants.js'), 'utf8');
  vm.runInNewContext(source.slice(0, source.indexOf('\n};') + 3), { PosnicPro: app, $ });
  app.variants._chrome = () => {};
  app.variants.loadList = () => {};
  return { app, requests, text: () => $('#detail').text(),
    saved: () => { fields = [{ name: 'Small' }, { name: 'Large' }]; },
    close: () => { active = null; }, dispose: () => dom.window.close() };
}

test('returning from a variant edit refreshes the already open detail', () => {
  const f = fixture();
  try {
    f.app.variants.openDoc('size');
    assert.doesNotMatch(f.text(), /Large/);
    f.saved();
    f.app.variants.showDataTablePage();
    assert.match(f.text(), /Small/);
    assert.match(f.text(), /Large/);
    assert.deepEqual(f.requests, ['variants/size', 'variants/size']);
  } finally { f.dispose(); }
});

test('refreshing the list does not reopen a closed variant', () => {
  const f = fixture();
  try {
    f.close();
    f.app.variants.variantsTable();
    assert.deepEqual(f.requests, []);
  } finally { f.dispose(); }
});
