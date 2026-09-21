const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const jquery = require('jquery');

test('item import errors remain visible with row numbers and inert product names', () => {
  const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/core/PosnicPro.js'), 'utf8');
  const start = source.indexOf('showItemImportErrors: function (response)');
  const method = source.slice(start, source.indexOf('    /*Images view*/', start)).trim().replace(/,$/, '');
  const dom = new JSDOM('<div id="errorMessages"></div><table id="errorTable" style="display:none"><tbody></tbody></table>', { runScripts: 'outside-only' });
  try {
    const w = dom.window; w.$ = jquery(w);
    w.eval('window.PosnicPro = { importAction: "items", ' + method + ' };');
    w.PosnicPro.showItemImportErrors({ type: 'error', message: 'Nothing was imported.', data: [
      { row: 3, name: '<img src=x onerror=alert(1)>', status: 'Barcode "6223014652308" is already used by "Milk &amp; cream".' },
      { row: 5, name: 'حليب', status: 'Barcode "ALT" is already used by another item.' },
    ] });
    assert.equal(w.document.querySelector('#errorMessages').textContent, 'Nothing was imported.');
    assert.equal(w.document.querySelectorAll('#errorTable tbody tr').length, 2);
    assert.equal(w.document.querySelector('#errorTable td').textContent, '3');
    assert.match(w.document.querySelector('#errorTable').textContent, /Milk & cream/);
    assert.equal(w.document.querySelector('img'), null);
    assert.notEqual(w.document.querySelector('#errorTable').style.display, 'none');
    assert.match(source, /PosnicPro\.showItemImportErrors\(response\);/);
  } finally { dom.window.close(); }
});
