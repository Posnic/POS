'use strict';

/*
 * One door for purchasing.
 *
 * Owner: "i see new purchase, purchase history duplicated in purchase order
 * page... have only one option... options like quote we need filter
 * typeahead and etc you need improve and then remove old add purchase
 * purchase history."
 *
 * The system: the sidebar carries ONE entry (Purchases). The page behind it
 * reaches every flow - ordering, receiving stock, the history - and the
 * history's filter bar offers this shop's own suppliers, the same way the
 * quotes bar offers customers. The old ROUTES stay alive (deep links, the
 * desktop), only the duplicate menu doors are gone.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'frontend', rel), 'utf8');
const sidebar = read('layouts/sidebar.html');
const poPage = read('modules/purchaseOrders.html');
const receivingJs = read('static/script/js/modules/js/receiving_add.js');

test('the sidebar has exactly ONE purchasing entry', () => {
    assert.ok(sidebar.includes('id="view_purchaseorders_page"'), 'the Purchases entry is gone');
    assert.ok(!sidebar.includes('id="view_receiving_page"'), 'the New Purchase menu entry is back');
    assert.ok(!sidebar.includes('id="view_receivings_page"'), 'the Purchase History menu entry is back');
});

test('the one door reaches every flow the old doors reached', () => {
    assert.match(poPage, /href="#\/receivings\/new"/);
    assert.match(poPage, /href="#\/receivings"/);
    /* and the old routes still have their handlers - removing a menu entry
       must never remove a page */
    assert.match(receivingJs, /showDataTablePage: function/);
});

test('the history filter offers suppliers, like quotes offers customers', () => {
    const mount = receivingJs.slice(
        receivingJs.indexOf("key: 'receivings'"),
        receivingJs.indexOf('onChange', receivingJs.indexOf("key: 'receivings'"))
    );
    assert.match(mount, /typeahead: 'supplier'/);
    assert.match(mount, /typeaheadField: 'supplier_name'/);
});

test('nothing still lights the removed menu ids', () => {
    for (const f of ['items.js', 'receiving_add.js']) {
        const src = read('static/script/js/modules/js/' + f);
        assert.ok(!src.includes("a#view_receiving_page')"), f + ' still targets the removed entry');
        assert.ok(!src.includes(".view_receivings_page')"), f + ' still targets the removed class');
    }
});
