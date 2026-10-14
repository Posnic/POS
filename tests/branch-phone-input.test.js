const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
for (const [moduleName, field, validator, key] of [
  ['settings', 'store_telephone', 'setting_phone_number', 'store_telephone'],
  ['branches', 'branch_phone', 'branch_phone_number', 'phone']
]) {
  test(moduleName + ': national display survives validation; save remains international', () => {
    const source = fs.readFileSync('frontend/static/script/js/modules/js/' + moduleName + '.js', 'utf8');
    const dom = new JSDOM('<input id="' + field + '">', { runScripts: 'outside-only' });
    try {
      const w = dom.window;
      w.$ = require('jquery')(w);
      w.eval(fs.readFileSync('frontend/static/script/js/intlTelInput.min.js', 'utf8'));
      w.eval(fs.readFileSync('frontend/static/script/js/utils.js', 'utf8'));
      const input = w.document.getElementById(field);
      const phone = w.intlTelInput(input, { initialCountry: 'in', separateDialCode: true });
      w.PosnicPro = { [moduleName]: { [field]: phone } };
      const start = source.indexOf('function (phone_number, element) {', source.indexOf('addMethod("' + validator + '"'));
      const end = source.indexOf(', "Enter a valid phone number");', start);
      const validate = w.eval('(' + source.slice(start, end) + ')');
      for (const number of ['+919688365318', '9688365318', '+44 7400 123456']) {
        phone.setNumber(number);
        const before = input.value;
        assert.equal(before.includes('+'), false);
        assert.equal(validate(input.value, input), true);
        assert.equal(input.value, before);
        w.formData = {};
        w.eval(source.match(new RegExp('formData\\.' + key + ' = [^;]+;'))[0]);
        assert.equal(w.formData[key], number.startsWith('+44') ? '+447400123456' : '+919688365318');
      }
      phone.setNumber('123');
      assert.equal(validate(input.value, input), false);
    } finally { dom.window.close(); }
  });
}
