const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const settings = read('frontend/static/script/js/modules/js/settings.js');
const branches = read('frontend/static/script/js/modules/js/branches.js');
function method(w, source, name, next) {
  return w.eval('({' + source.slice(source.indexOf(name + ': function'), source.indexOf(next + ': function', source.indexOf(name + ': function'))) + '})')[name];
}
function fixture() {
  const dom = new JSDOM(read('frontend/modules/branchEdit.html'), { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(read('frontend/static/script/js/jquery.min.js'));
  w.eval(read('frontend/static/script/js/jquery.validate.min.js'));
  w.eval(read('frontend/static/script/js/validpassword-showhidepassword.js'));
  const $ = w.jQuery;
  $.fn.select2 = function(action) {
    if (action === 'data') return Array.from(this[0].selectedOptions).map(element => ({ element }));
    return this;
  };
  const calls = [];
  w.PosnicPro = {
    i18n: { t: (key, text) => text }, local: { get: () => 'session-branch' },
    settings: { _refLoaded: {}, _refPending: {}, store_telephone: {
      setNumber: value => $('#store_telephone').val(value),
      getNumber: () => '+919008427482', isValidNumber: () => true, setCountry: () => {}
    }, applyTaxProfile: () => {} }, branches: {}, branchSignature: { mount: () => {} },
    getFormData: form => Object.fromEntries(form.serializeArray().map(x => [x.name, x.value])),
    put: params => calls.push(params), timeZone: () => 'Asia/Calcutta'
  };
  w.PosnicPro.settings.generalSetting = method(w, settings, 'generalSetting', 'emailPhpStoreSettings');
  w.eval(settings.slice(settings.indexOf('$("#setting_add").validate({'), settings.indexOf('$("#setting_image_add").submit')));
  // Avoid jQuery visibility-based focus in the layout-free DOM; validation still runs fully.
  $('#setting_add').validate().settings.focusInvalid = false;
  w.eval(read('frontend/static/script/js/core/record-workspace.js'));
  w.PosnicPro.recordWorkspace.init();
  const values = { store_name: 'Shop', store_email: 'shop+123@example.technology', store_telephone: '9008427482', store_address: 'Shop address', printing_address: 'Receipt address', edit_branch_target: 'edited-branch' };
  for (const [id, value] of Object.entries(values)) $('#' + id).val(value);
  for (const [id, value] of Object.entries({ setting_country: 'India', setting_state: 'Tamil Nadu', currency_setting: 'Indian Rupee', currency_type: 'INR', time_zone: 'Asia/Calcutta' })) {
    const option = new w.Option(value, value, true, true);
    option.setAttribute('data-setting-id', '101'); option.setAttribute('data-timezone-name', value);
    $('#' + id).append(option);
  }
  return { dom, w, $, calls };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
test('branch Save accepts plus-address email, sends the target and phone, and restores tabs', async () => {
  const { dom, $, calls } = fixture();
  $('#setting_add button[type=submit]')[0].click();
  await tick();
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].data);
  assert.equal(payload.store_email, 'shop+123@example.technology');
  assert.equal(payload.store_telephone, '+919008427482');
  assert.equal(payload.target_branch_id, 'edited-branch');
  assert.equal(payload.setting_state, 'Tamil Nadu');
  assert.equal($('.record-form-panel').filter((i, node) => !node.hidden).length, 1);
  dom.window.close();
});
for (const [field, tab] of [['printing_address', 2], ['currency_setting', 1], ['setting_state', 0]]) {
  test('missing ' + field + ' blocks Save with an inline error in the right tab', async () => {
    const { dom, $, calls } = fixture();
    $('#' + field).val('');
    $('#setting_add button[type=submit]')[0].click();
    await tick();
    assert.equal(calls.length, 0);
    assert.ok($('label.error[for="' + field + '"]').text());
    assert.equal($('#setting_add-section-' + tab)[0].hidden, false);
    assert.equal($('.record-form-panel').filter((i, node) => !node.hidden).length, 1);
    if (field === 'printing_address') assert.equal($('#printing_address').closest('details')[0].open, true);
    dom.window.close();
  });
}
test('slow reference lists complete before branch hydration; earlier branch responses cannot overwrite it', () => {
  const { dom, w, $ } = fixture();
  const pending = [];
  w.PosnicPro.get = (params, done) => pending.push({ params, done });
  const s = w.PosnicPro.settings;
  s.loadSelectSettingCountry = method(w, settings, 'loadSelectSettingCountry', 'loadSelectSettingState');
  s.loadSelectSettingCurrency = method(w, settings, 'loadSelectSettingCurrency', 'timeZone');
  s.timeZone = method(w, settings, 'timeZone', 'paymentKey');
  s.loadSelectSettingState = method(w, settings, 'loadSelectSettingState', 'loadSelectSettingCurrency');
  const b = w.PosnicPro.branches;
  b.loadFullEdit = method(w, branches, 'loadFullEdit', 'beAddRegisterRow');
  b.beAddRegisterRow = () => {};
  b.loadFullEdit('first'); b.loadFullEdit('second');
  assert.equal(pending.length, 3);
  assert.equal($('#setting_add button[type=submit]').prop('disabled'), true);
  pending.shift().done({ data: { countries: [{ value: 'India', id: '101' }] } });
  pending.shift().done({ data: { currency: [{ value: 'Indian Rupee', id: '1', text: 'INR', symbol: 'Rs' }] } });
  pending.shift().done({ data: [{ text: 'Asia/Calcutta', value: 'India' }] });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].params.data.id, 'second');
  const data = { branch_name: 'Saved shop', store_email: 'shop+123@example.com', store_telephone: '+919008427482', country: 'India', country_id: '101', state: 'Tamil Nadu', currency_text: 'Indian Rupee', currency_value: [{currency_text: 'INR',currency_sign: 'Rs'}], currency_type: 'INR', time_zone: 'Asia/Calcutta', client_dateformat: 'dd/mm/yyyy' };
  pending.shift().done({ type: 'success', data });
  assert.equal($('#setting_state').val(), 'Tamil Nadu');
  assert.equal($('#store_telephone').val(), data.store_telephone);
  pending.shift().done({ data: { stateJsonArray: ['Tamil Nadu', 'Other'], countrySortName: 'in' } });
  assert.equal($('#setting_state').val(), 'Tamil Nadu');
  assert.equal($('#currency_setting').val(), 'Indian Rupee');
  assert.equal($('#setting_add button[type=submit]').prop('disabled'), false);
  b.loadFullEdit('old'); const old = pending.shift(); b.loadFullEdit('new');
  pending.shift().done({ type: 'success', data: {...data, branch_name: 'Newest'} });
  old.done({ type: 'success', data });
  assert.equal($('#store_name').val(), 'Newest');
  dom.window.close();
});

test('state option refresh preserves the saved phone with the real phone widget', () => {
  const { dom, w, $ } = fixture();
  w.eval(read('frontend/static/script/js/utils.js'));
  w.eval(read('frontend/static/script/js/intlTelInput.min.js'));
  const phone = w.intlTelInput($('#store_telephone')[0], { initialCountry: 'in' });
  w.PosnicPro.settings.store_telephone = phone;
  phone.setNumber('+919008427482');
  let respond;
  w.PosnicPro.get = (params, done) => { respond = done; };
  const s = w.PosnicPro.settings;
  s.loadSelectSettingState = method(w, settings, 'loadSelectSettingState', 'loadSelectSettingCurrency');
  s.loadSelectSettingState('101', 'Tamil Nadu');
  respond({ data: { stateJsonArray: ['Tamil Nadu'], countrySortName: 'in' } });
  assert.equal(phone.getNumber(), '+919008427482');
  assert.equal($('#setting_state').val(), 'Tamil Nadu');
  assert.equal(phone.isValidNumber(), true);
  phone.destroy(); dom.window.close();
});
