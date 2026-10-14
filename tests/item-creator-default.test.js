const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/static/script/js/modules/js/items.js', 'utf8');
function method(name) {
  const start = source.indexOf('    ' + name + ': function');
  const end = source.indexOf('\n    },', start);
  return source.slice(source.indexOf('function', start), end + 6);
}
for (const preference of [undefined, false, true]) {
  test('new items always use the new creator with old preference ' + preference, () => {
    let opened = 0;
    const PosnicPro = { local: { get: () => JSON.stringify({ item_editor_v2: preference }) }, items_v2: { showAdd: () => opened++ } };
    vm.runInNewContext('(' + method('showAdd') + ')()', { PosnicPro });
    assert.equal(opened, 1);
  });
}
for (const origin of ['sales', 'receiving']) {
  test(origin + ' shortcut passes the item name to the new creator', () => {
    let name;
    const PosnicPro = { items_v2: { showAdd: value => { name = value; } } };
    const $ = selector => ({ val: () => selector.includes(origin) ? 'Fresh item' : '' });
    vm.runInNewContext('(' + method('triggerAddNew') + ')()', { PosnicPro, $ });
    assert.equal(name, 'Fresh item');
  });
}
test('the obsolete editor setting is absent from the UI and settings payload', () => {
  for (const file of ['frontend/modules/settings_write.html', 'frontend/static/script/js/modules/js/settings.js']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /item_editor_v2/);
  }
});
