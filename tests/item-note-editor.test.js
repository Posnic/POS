'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/sales.js'), 'utf8');
const start = source.indexOf('openItemNoteModal: function');
const end = source.indexOf('\n    },', start);
const method = source.slice(start + 'openItemNoteModal: '.length, end + 6);
const menu = 'A whole fish rubbed with red masala and fried on the tawa';

function setup(note = '') {
  const dom = new JSDOM('<span id="addSalesLineItemName_1"></span><span id="addSalesLineItemNote_1"></span><span id="addSalesLineItemId_1">fish</span><a id="item_note_1"></a><button data-id="1"></button>', { runScripts: 'outside-only' });
  const w = dom.window, $ = require('jquery')(w);
  let options, value, requests = 0;
  $.fn.editable = function (action, next) {
    if (typeof action === 'object') options = action;
    if (action === 'setValue') value = next;
    return this;
  };
  $('#addSalesLineItemNote_1').text(note);
  w.$ = $;
  w.PosnicPro = {
    i18n: { t: (_key, fallback) => fallback },
    sales: { SaleTableLineItems: { 1: { item_description: note } } },
    get: (_url, done) => { requests++; done({ type: 'success', data: { description: menu } }); }
  };
  const open = w.eval('(' + method + ')');
  return { dom, $, open: () => open($('button')[0]),
    value: () => value, requests: () => requests,
    note: () => w.PosnicPro.sales.SaleTableLineItems[1].item_description,
    save: text => options.success(null, text) };
}

test('opening and dismissing an empty instruction never fetches or saves menu copy', () => {
  const s = setup();
  try {
    s.open();
    assert.equal(s.requests(), 0);
    assert.equal(s.value(), '');
    assert.equal(s.note(), '');
    s.open();
    assert.equal(s.value(), '');
    assert.equal(s.note(), '');
  } finally { s.dom.window.close(); }
});

test('only an explicitly saved instruction enters the order; clearing it stays cleared', () => {
  const s = setup();
  try {
    s.open();
    s.save('No salt, extra lemon');
    s.open();
    assert.equal(s.value(), 'No salt, extra lemon');
    assert.equal(s.note(), 'No salt, extra lemon');
    s.save('');
    s.open();
    assert.equal(s.value(), '');
    assert.equal(s.note(), '');
    assert.equal(s.requests(), 0);
  } finally { s.dom.window.close(); }
});

test('existing order instructions remain editable without reading the catalogue', () => {
  const s = setup('Less spicy');
  try {
    s.open();
    assert.equal(s.value(), 'Less spicy');
    assert.equal(s.note(), 'Less spicy');
    assert.equal(s.requests(), 0);
  } finally { s.dom.window.close(); }
});
