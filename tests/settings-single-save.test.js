const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

test('Ask Posnic menu follows its opt-in, even when other AI features are enabled', () => {
  const dom = new JSDOM('<li id="manage_li_ai"></li><a data-ask-entry></a>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.$ = require('jquery')(w);
  w.PosnicPro = { local: { get() {} }, demoSamples: { load() {} } };
  const source = fs.readFileSync('frontend/static/script/js/core/PosnicPro.js', 'utf8');
  const start = source.indexOf('    applyModuleSidebar: function () {');
  const end = source.indexOf('\n    },', start);
  const apply = w.eval('(' + source.slice(start, end + 6).replace('applyModuleSidebar:', '') + ')');
  for (const enabled of [undefined, false, true, false]) {
    w.PosnicPro.local.get = key => key === 'general_settings' ? JSON.stringify({ ai_enabled: true, ask_posnic_enabled: enabled }) : null;
    apply();
    assert.equal(w.$('#manage_li_ai').css('display') !== 'none', enabled === true);
    assert.equal(w.$('[data-ask-entry]').css('display') !== 'none', enabled === true);
  }
  w.close();
});

test('specialised Core Settings views hide only the duplicate outer footer', () => {
  const html = fs.readFileSync('frontend/modules/settings_write.html', 'utf8');
  const css = fs.readFileSync('frontend/static/style/css/receipt-designer.css', 'utf8');
  const dom = new JSDOM('<style>' + css + '</style>' + html);
  const { document, getComputedStyle } = dom.window;
  const footer = document.querySelector('#settings_edit_reset').parentElement;
  for (const [tab, sub] of [['inventory', 'stock'], ['inventory', 'expiry'], ['inventory', 'mobile'], ['payments', 'gateway']]) {
    document.querySelectorAll('[id^="core-tab-"], [id^="inv-sub-"], [id^="pay-sub-"]').forEach(node => node.classList.remove('active'));
    document.querySelector('#core-tab-' + tab).classList.add('active');
    document.querySelector('#' + (tab === 'inventory' ? 'inv' : 'pay') + '-sub-' + sub).classList.add('active');
    assert.equal(getComputedStyle(footer).display, 'none', tab + '/' + sub);
  }
  assert.equal(document.querySelectorAll('#pay-sub-general button').length, 0);
  assert.equal(document.querySelectorAll('#tax-sub-general button').length, 1);
  assert.equal(document.querySelector('#sharing_save_btn'), null);
  assert.equal(document.querySelector('#ai_save'), null);
  dom.window.close();
});
