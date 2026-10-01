const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
function boot() {
  const dom = new JSDOM(fs.readFileSync('frontend/modals/tableorder.html', 'utf8'));
  const $ = require('jquery')(dom.window);
  $.fn.tooltip = function () { return this; };
  const sent = [];
  const PosnicPro = {
    showAddModal() {}, i18n: {t: (_, fallback) => fallback},
    getFormData: form => Object.fromEntries(form.serializeArray().map(x => [x.name, x.value])),
    post: params => sent.push(JSON.parse(params.data)),
    put: params => sent.push(JSON.parse(params.data)),
  };
  const source = fs.readFileSync('frontend/static/script/js/modules/js/settings.js', 'utf8');
  new Function('PosnicPro', '$', source.slice(source.indexOf('PosnicPro.tableOrders ='), source.indexOf('PosnicPro.tableorder =')))(PosnicPro, $);
  const module = PosnicPro.tableOrders;
  module.allData = [
    {tableorder_id:'a',tableorder_value:'T1',adjacent_table_ids:['b']},
    {tableorder_id:'b',tableorder_value:'T2',area:'Garden'},
    {tableorder_id:'c',tableorder_value:'<img src=x onerror=alert(1)>'},
  ];
  $('<button id="setting_tableorder_edit_a">').data('tableordervalue','T1').appendTo(dom.window.document.body);
  return {dom, $, module, sent};
}
test('desktop table edit excludes itself, restores neighbours, and submits all selected identities', () => {
  const {$, module, sent, dom} = boot();
  module.triggerTaxEdit('a');
  assert.equal($('#table_neighbours input').length,2);
  assert.equal($('#table_neighbours input[value=b]').prop('checked'),true);
  assert.equal($('#table_neighbours img').length,0);
  $('#table_neighbours input[value=c]').prop('checked',true);
  module.editTableOrderField();
  assert.deepEqual(sent[0].adjacent_table_ids,['b','c']);
  $('#table_neighbours input').prop('checked',false);
  module.editTableOrderField();
  assert.deepEqual(sent[1].adjacent_table_ids,[]);
  dom.window.close();
});
test('desktop add and clear do not inherit the previously edited neighbours', () => {
  const {$, module, sent, dom} = boot();
  module.triggerTaxEdit('a');
  module.triggerModules();
  assert.equal($('#table_neighbours input').length,3);
  assert.equal($('#table_neighbours input:checked').length,0);
  $('#tableorder_value').val('T4');
  $('#table_neighbours input[value=b]').prop('checked',true);
  module.addTableOrderField();
  assert.deepEqual(sent[0].adjacent_table_ids,['b']);
  module.tableOrdersClearForm();
  assert.equal($('#table_neighbours input:checked').length,0);
  dom.window.close();
});
