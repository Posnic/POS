const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('frontend/static/script/js/core/PosnicPro.js', 'utf8').split('// Select existing numbers once on entry, including dynamically opened dialogs.')[1];
function setup() {
  const dom = new JSDOM('<input id="search"><input id="qty" type="number" value="1"><input id="discount" inputmode="decimal" value="10.50">', { runScripts: 'outside-only' });
  dom.window.eval(source);
  return dom;
}
test('dynamic quantity, discount and legacy decimal fields select on focus; text and readonly do not', () => {
  const dom = setup(), w = dom.window;
  try {
    for (const attrs of ['type="number"', 'inputmode="decimal"', 'inputmode="numeric"', 'class="allow_decimal"']) {
      const el = w.document.createElement('div'); el.innerHTML = `<input ${attrs} value="1">`;
      const input = el.firstChild; w.document.body.append(input);
      let selected = 0; input.select = () => selected++; input.focus();
      assert.equal(selected, 1, attrs);
    }
    for (const attrs of ['type="text"', 'type="tel" inputmode="numeric"', 'type="number" readonly', 'type="number" disabled']) {
      const el = w.document.createElement('div'); el.innerHTML = `<input ${attrs} value="123">`;
      const input = el.firstChild; w.document.body.append(input);
      let selected = 0; input.select = () => selected++; input.focus(); assert.equal(selected, 0, attrs);
    }
  } finally { w.close(); }
});
test('initial pointer click preserves selection after leaving another field, later caret clicks do not reselect', () => {
  const dom = setup(), w = dom.window, d = w.document, input = d.querySelector('#discount');
  try {
    d.querySelector('#search').focus();
    input.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    input.focus(); input.setSelectionRange(2, 2);
    input.click(); assert.equal(input.selectionStart, 0); assert.equal(input.selectionEnd, 5);
    input.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    input.setSelectionRange(2, 2); input.click(); assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 2);
  } finally { w.close(); }
});
test('typing or stepping a number never causes a late click to reselect it', () => {
  const dom = setup(), w = dom.window, input = w.document.querySelector('#qty');
  try {
    let selected = 0; input.select = () => selected++;
    input.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0 })); input.focus();
    input.value = '2'; input.dispatchEvent(new w.Event('input', { bubbles: true })); input.click();
    assert.equal(selected, 1); assert.equal(input.value, '2');
  } finally { w.close(); }
});
