'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('header search resolves action wording, settings and role changes through the normal click path', () => {
  const frontend = path.resolve(__dirname, '../frontend');
  const read = (file) => fs.readFileSync(path.join(frontend, file), 'utf8');
  const dom = new JSDOM(
    read('layouts/header.html') + read('layouts/sidebar.html') + read('modules/settings_write.html'),
    { runScripts: 'outside-only', url: 'http://localhost/dashboard.html' },
  );
  const w = dom.window,
    d = w.document;
  const routes = [];
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  w.hasher = { setHash: (hash) => routes.push(hash) };
  w.PosnicPro = {
    local: { get: () => null },
    userACL: {
      sales: { write: true },
      customer: { write: true },
      receiving: { write: true },
      branch: { write: true },
      report: { read: true },
    },
    i18n: { t: (_, s) => s },
    get: (params, done) => {
      if (params.url === 'extensions/v1') done({extensions:[{
        id:'rewards', displayName:'Rewards', searchPages:[
          {target:'ledger', label:'Points history', keywords:['points ledger'], action:'open'},
          {target:'issue', label:'Issue points', keywords:['points'], action:'create'},
        ],
      }]});
    },
    post: () => {},
  };
  w.eval(read('static/script/js/core/command-palette.js'));
  function matches(q) {
    d.getElementById('posnic-header-search').click();
    const input = d.getElementById('cmdk-input');
    input.value = q;
    input.dispatchEvent(new w.Event('input'));
    return [...d.querySelectorAll('#cmdk-list [role=option]')];
  }
  for (const verb of ['add', 'new', 'create'])
    for (const noun of ['sale', 'sales']) {
      matches(verb + ' ' + noun)[0].click();
      assert.equal(routes.at(-1), 'sales/new');
    }
  for (const [q, route] of [
    ['sales create', 'sales/new'],
    ['create a client', 'customers/new'],
    ['new purchase', 'receivings/new'],
    ['configure invoice', 'settings/invoices'],
  ]) {
    matches(q)[0].click();
    assert.equal(routes.at(-1), route);
  }
  for (const phrase of ['view sales','show sale','list the sales','sales view','open sales history']) {
    const rows = matches(phrase);
    assert.equal(rows.length,1,phrase);
    assert.match(rows[0].textContent,/Sales History/i);
    d.getElementById('cmdk-input').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter'}));
    assert.equal(routes.at(-1),'sales');
  }
  for (const [phrase,label] of [['view sales report','Sales Report'],['view points ledger','Points history'],['add points','Issue points']]) {
    const rows = matches(phrase);
    assert.equal(rows.length,1,phrase);
    assert.ok(rows[0].textContent.includes(label),phrase);
    w.PosnicPro.palette.close();
  }
  assert.ok(matches('measurement id').some((r) => /Measurement id/i.test(r.textContent)));
  w.PosnicPro.palette.close();
  w.PosnicPro.userACL.sales.write = false;
  assert.equal(matches('new sales').length, 0);
  dom.window.close();
});
