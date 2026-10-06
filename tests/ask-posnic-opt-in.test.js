'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

function page() {
  const html = fs.readFileSync(path.join(__dirname, '../frontend/modules/ask_posnic.html'), 'utf8');
  const dom = new JSDOM('<a data-ask-entry></a><div id="ask_checkout_payment"></div>' + html);
  const $ = require('jquery')(dom.window);
  let requests = 0;
  const PosnicPro = { request: () => { requests++; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/ask_posnic.js'), 'utf8'), { PosnicPro, $, window: dom.window });
  return { $, app: PosnicPro.askposnic, requests: () => requests };
}

test('Ask Posnic starts off, becomes usable only after opt-in, and clears checkout controls when disabled', () => {
  const { $, app, requests } = page();
  app.ask('show sales');
  assert.equal(requests(), 0);
  app.setEnabled(false);
  assert.equal($('#askposnic .ask-workspace').css('display'), 'none');
  assert.notEqual($('#ask_posnic_disabled').css('display'), 'none');
  assert.equal($('[data-ask-entry]').css('display'), 'none');
  app.setEnabled(true);
  assert.notEqual($('#askposnic .ask-workspace').css('display'), 'none');
  assert.equal($('#ask_posnic_disabled').css('display'), 'none');
  app.checkout = { print: true };
  app.setEnabled(false);
  assert.equal(app.checkout, null);
  assert.equal($('#ask_checkout_payment').length, 0);
});

test('follow-up suggestions render as safe buttons without inserting markup', () => {
  const { $, app } = page();
  app.add('answer', 'Choose a report', { suggestions: ['Show sales yesterday', '<img src=x onerror=alert(1)>'] });
  assert.equal($('.ask-followup').length, 2);
  assert.equal($('.ask-followup').first().attr('data-question'), 'Show sales yesterday');
  assert.equal($('#ask_posnic_thread img').length, 0);
});
