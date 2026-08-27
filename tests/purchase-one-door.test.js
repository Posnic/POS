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
    /* Purchase History is RETIRED (owner, 2026-08-27: "delete existing
       routes and html and etc") - nothing may link to it, and the old route
       redirects to the one surface instead of a page that no longer exists. */
    assert.ok(!poPage.includes('href="#/receivings"'), 'a link points at the retired archive');
    const shower = receivingJs.slice(
        receivingJs.indexOf('showDataTablePage: function'),
        receivingJs.indexOf('},', receivingJs.indexOf('showDataTablePage: function')),
    );
    assert.match(shower, /setHash\('purchaseorders'\)/, 'the old route must redirect, not 404');
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

test('receive happens IN the purchases page - the old-design detour is gone', () => {
    /* Owner: "while click on receive items its going old design." The
       Receive action now opens a panel in the same page, posts the same
       receivings payload the old screen posted (status Received, the PO id
       riding as source_po_id so the mirror syncs), and reopens the order.
       The old screen stays reachable for manual purchases - but nothing
       routes to it from a purchase order any more. */
    const html = read('modules/purchaseOrders.html');
    assert.match(html, /id="po_receive_section"/);
    assert.match(html, /Receive into stock/);
    assert.match(html, /table-borderless m-cards/, 'the receive lines must be card-ready on phones');

    const receive = receivingJs.slice(
        receivingJs.indexOf('receive: function (id)'),
        receivingJs.indexOf('saveReceive:'));
    assert.ok(!receive.includes("hasher.setHash('receivings/new')"),
        'Receive still detours to the old screen');
    assert.match(receivingJs, /openReceive: function/);
    assert.match(receivingJs, /saveReceive: function/);
    const save = receivingJs.slice(receivingJs.indexOf('saveReceive: function'));
    assert.match(save, /status: 'Received'/);
    assert.match(save, /source_po_id: String\(po\._id\)/);
    /* the dead prefill bridge went with the detour */
    assert.ok(!receivingJs.includes('_poPrefill'), 'the prefill bridge is dead code now');
    /* every sibling section hides the panel, so it cannot linger */
    assert.match(receivingJs, /#po_form_section,#po_view_section,#po_receive_section'\)\.hide/);
});
