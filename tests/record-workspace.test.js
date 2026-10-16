const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
function fixture() {
  const files = ['modals/user.html', 'modals/customer.html', 'modals/supplier.html', 'modals/branch.html', 'modals/category_add.html', 'modules/branchEdit.html', 'modules/settings_write.html'];
  const dom = new JSDOM(files.map(p => read('frontend/' + p)).join('\n'), { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(read('frontend/static/script/js/jquery.min.js'));
  w.PosnicPro = { i18n: { t: (key, text) => text } };
  return { dom, w, d: w.document };
}
test('reorganizing retains every control, form owner, current value and submit handler', () => {
  const { w, d, dom } = fixture();
  const controls = Array.from(d.querySelectorAll('input,select,textarea')).map(node => ({ node, owner: node.form, name: node.name, value: node.value }));
  const form = d.querySelector('#customer_add_form');
  let saves = 0;
  form.addEventListener('submit', e => { e.preventDefault(); saves++; });
  w.eval(read('frontend/static/script/js/core/record-workspace.js'));
  w.PosnicPro.recordWorkspace.init();
  for (const { node, owner, name, value } of controls) {
    assert.equal(node.isConnected, true, node.id);
    assert.equal(node.form, owner, node.id + ' form owner');
    assert.equal(node.name, name, node.id);
    assert.equal(node.value, value, node.id);
  }
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(saves, 1);
  assert.ok(d.querySelector('#users_password').closest('.hide_show_user_password'));
  assert.ok(d.querySelector('#customer_name').closest('.record-section'));
  assert.equal(d.querySelectorAll('#category_tile_shapes button').length, 4);
  for (const b of d.querySelectorAll('#category_tile_shapes button')) {
    assert.equal(b.type, 'button');
    assert.ok(b.querySelector('.record-shape-' + b.dataset.shape));
    assert.ok(b.textContent.trim());
  }
  w.PosnicPro.recordWorkspace.init();
  assert.equal(d.querySelectorAll('#core-tab-sale .record-tabs').length, 1);
  dom.window.close();
});
test('sales sections switch locally without changing saved values or control availability', () => {
  const { w, d, dom } = fixture();
  w.eval(read('frontend/static/script/js/core/record-workspace.js'));
  w.PosnicPro.recordWorkspace.init();
  assert.ok(d.querySelector('#sales_search_custom_fields').closest('#record-sales-panel-1'));
  assert.ok(d.querySelector('#allow_payment_correction').closest('#record-sales-panel-3'));
  assert.ok(d.querySelector('#sales_sms').closest('#record-sales-panel-2'));
  assert.ok(d.querySelector('#set_share_customers').closest('#record-sales-panel-2'));
  const field = d.querySelector('#sales_prefix'); field.value = 'ABC';
  d.querySelector('#record-sales-tab-1').click();
  assert.equal(d.querySelector('#record-sales-panel-1').hidden, false);
  assert.equal(d.querySelector('#record-sales-panel-0').hidden, true);
  assert.equal(field.value, 'ABC'); assert.equal(field.disabled, false);
  dom.window.close();
});
test('user sections reveal all inputs before the existing save handler validates', () => {
  const { w, d, dom } = fixture();
  w.eval(read('frontend/static/script/js/core/record-workspace.js'));
  w.PosnicPro.recordWorkspace.init();
  const form = d.querySelector('#user_form_upload');
  const access = d.querySelector('#branchtype').closest('.record-form-panel');
  assert.equal(access.hidden, true);
  const save = d.querySelector('#clicksubmit');
  assert.ok(save.closest('.record-actions'));
  assert.equal(save.closest('form'), form);
  let called = false;
  save.addEventListener('click', () => { called = true; assert.equal(access.hidden, false); });
  save.click();
  assert.equal(called, true);
  d.querySelector('#branchtype').dispatchEvent(new w.Event('invalid'));
  assert.equal(access.hidden, false);
  assert.equal(d.querySelector('#users_firstname').closest('.record-form-panel').hidden, true);
  dom.window.close();
});
for (const kind of ['customer', 'supplier', 'branch']) {
  test(kind + ' uses shop state for new records, saved state on edits, and rejects stale country responses', () => {
    const plural = kind === 'branch' ? 'branches' : kind + 's';
    const cap = kind[0].toUpperCase() + kind.slice(1);
    const source = read('frontend/static/script/js/modules/js/' + plural + '.js');
    const start = source.indexOf('    loadSelect' + cap + 'State: function');
    const end = source.indexOf('    validForm:', start);
    const dom = new JSDOM('<select id="' + kind + '_state"></select>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(read('frontend/static/script/js/jquery.min.js'));
    const callbacks = [];
    const saved = { state_setting: 'Tamil Nadu', ['edit_' + kind + '_state']: 'Karnataka' };
    w.PosnicPro = { local: { get: k => saved[k] }, get: (params, done) => callbacks.push(done), [plural]: {} };
    const method = w.eval('({' + source.slice(start, end) + '})')['loadSelect' + cap + 'State'];
    const result = states => ({ data: { stateJsonArray: states, countrySortName: 'in' } });
    method('IN', 'add'); callbacks.shift()(result(['Andaman', 'Tamil Nadu', 'Karnataka']));
    assert.equal(w.document.querySelector('select').value, 'Tamil Nadu');
    method('IN', 'edit'); callbacks.shift()(result(['Tamil Nadu', 'Karnataka']));
    assert.equal(w.document.querySelector('select').value, 'Karnataka');
    method('IN', 'clear'); method('GB', 'onChange');
    const stale = callbacks.shift(); callbacks.shift()(result(['England'])); stale(result(['Tamil Nadu']));
    assert.equal(w.document.querySelector('select').value, '');
    assert.equal(w.document.querySelectorAll('option').length, 2);
    assert.equal(w.document.querySelectorAll('option')[1].value, 'England');
    dom.window.close();
  });
}
