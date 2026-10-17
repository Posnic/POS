'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
function fixture(t) {
  const source = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
  const dom = new JSDOM(source('install-wizard.html'), { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.eval(source('setup-region-data.js'));
  dom.window.eval(source('setup-region.js'));
  const doc = dom.window.document;
  const set = (id, value) => { doc.getElementById(id).value = value; };
  const country = value => { set('qCountry', value); doc.getElementById('qCountry').dispatchEvent(new dom.window.Event('change')); };
  return { dom, doc, set, country, api: dom.window.PosnicSetupRegion };
}
test('regional choices supply the selected country, state, city, currency and timezone offline', t => {
  const f = fixture(t);
  f.country('India');
  assert.equal(f.doc.getElementById('qCurrency').value, 'INR');
  f.set('qState', 'Goa'); f.set('qCity', 'Panaji'); f.set('qTimezone', 'Asia/Kolkata');
  f.set('qBusinessName', 'Test shop'); f.set('qEmail', 'owner@example.com'); f.set('qPassword', 'test-pass-123'); f.set('qConfirmPassword', 'test-pass-123');
  assert.equal(f.api.validate(), true);
  assert.equal(f.api.values().register_countryid, '101');
  assert.equal(f.api.values().register_state, 'Goa');
  assert.equal(f.api.values().register_city, 'Panaji');
  f.country('United States');
  assert.equal(f.doc.getElementById('qState').value, '');
  assert.equal(f.doc.getElementById('qCurrency').value, 'USD');
  f.set('qCurrency', 'EUR');
  assert.equal(f.api.values().register_currency, 'EUR');
});
test('invalid fields show individual messages and block submission', t => {
  const f = fixture(t);
  f.set('qBusinessName', ''); f.set('qEmail', 'not-an-email'); f.set('qPassword', 'short'); f.set('qTimezone', 'Invalid/Zone');
  assert.equal(f.api.validate(), false);
  assert.equal(f.doc.activeElement.id, 'qBusinessName');
  for (const id of ['qBusinessName', 'qEmail', 'qPassword', 'qTimezone']) {
    assert.equal(f.doc.getElementById(id).getAttribute('aria-invalid'), 'true');
    assert.equal(f.doc.getElementById(id + 'Error').hidden, false);
  }
});
test('shop details and demo choice are visible and demo remains opt-in', t => {
  const f = fixture(t);
  assert.equal(f.doc.getElementById('offlineDetails').tagName, 'SECTION');
  const demo = f.doc.getElementById('qDemoData');
  assert.equal(demo.closest('[hidden],details'), null);
  assert.equal(demo.checked, false);
});

test('confirmation blocks mismatched passwords and clears after correction', t => {
 const f=fixture(t); f.country('India');
 for(const [id,value] of Object.entries({qBusinessName:'Shop',qEmail:'a@example.com',qPassword:'password123',qConfirmPassword:'different',qState:'Goa',qCity:'Panaji',qTimezone:'Asia/Kolkata'})) f.set(id,value);
 assert.equal(f.api.validate(),false); assert.equal(f.doc.getElementById('qConfirmPasswordError').textContent,'Passwords do not match.');
 f.set('qConfirmPassword','password123'); assert.equal(f.api.validate(),true); assert.equal(f.doc.getElementById('qError').style.display,'none');
});
