'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { blockAt } = require('./helpers/source-lookup');
const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/modules/js/settings.js'), 'utf8');

function setup() {
    // Bootstrap leaves the selected inner tab active when its parent page hides.
    const dom = new JSDOM('<div id="v-pills-general" style="display:none"><form id="tax_discount_add"><div id="core-tab-print" class="active"></div></form></div><div id="v-pills-modules" class="active"><input id="module_demo_data_enable" type="checkbox" checked></div>', { runScripts: 'outside-only' });
    const w = dom.window;
    const $ = w.$ = w.jQuery = require('jquery')(w);
    $.fn.select2 = () => [];
    $.fn.valid = () => true;
    const requests = [];
    let receiptSaves = 0;
    w.PosnicPro = {
        local: { get: () => 'super_admin' },
        settings: { _moduleToggleIds: ['module_demo_data_enable'], _printDocs: { header: '', footer: '' }, _modulesRemoteBranch: () => null, tableOrderLimitValue: () => 1 },
        receiptDesignerEditor: { save: () => { receiptSaves++; } },
        put: request => requests.push({ url: request.url, data: JSON.parse(request.data) })
    };
    for (const method of ['saveModulesTab', 'updateCommonSetting']) {
        const fn = blockAt(source, '    ' + method + ': function (');
        w.eval('PosnicPro.settings.' + method + ' = ' + fn.slice(fn.indexOf('function')));
    }
    w.eval(blockAt(source, '$("#tax_discount_add").submit(function (event) {') + ');');
    return { dom, w, $, requests, receiptSaves: () => receiptSaves };
}

test('Features save sends the enabled Demo Data switch after visiting Receipt Print', () => {
    const h = setup();
    try {
        h.w.PosnicPro.settings.saveModulesTab();
        assert.equal(h.receiptSaves(), 0);
        assert.equal(h.requests.length, 1);
        assert.equal(h.requests[0].data.module_demo_data_enable, 'true');
        assert.equal(h.requests[0].data.receipt_designs, undefined);
        assert.equal(h.requests[0].data.modules_only, true);
        assert.equal(h.requests[0].data.default_supplier, undefined);
        assert.equal(h.requests[0].data.default_customer, undefined);
        assert.equal(h.requests[0].data.footer_print, undefined);
    } finally { h.dom.window.close(); }
});

test('tax and payment saves are not redirected by a hidden active Receipt Print tab', () => {
    const h = setup();
    try {
        for (const label of ['GST invoicing saved', 'Tax defaults saved', 'Payment settings saved']) {
            h.w.PosnicPro.settings.updateCommonSetting(label);
        }
        assert.equal(h.receiptSaves(), 0);
        assert.equal(h.requests.length, 3);
    } finally { h.dom.window.close(); }
});

test('feature success updates local navigation state; failure preserves unsaved edits', () => {
    const h = setup();
    try {
        const cache = { general_settings: JSON.stringify({ stock_management: true, first_run_done: true }) };
        let complete, failed, refreshes = 0;
        const p = h.w.PosnicPro;
        p.local = { get: key => cache[key], set: (key, value) => { cache[key] = value; } };
        p.alert = () => {};
        p.features = { keepFirstRunFlag: (_data, key = 'first_run_done') => JSON.parse(cache.general_settings)[key] };
        p.i18n = { t: (_key, fallback) => fallback };
        p.applyKotVisibility = () => {};
        p.shiftWidget = { applyEnabled() {} };
        p.settings.applyModuleNav = () => { refreshes++; };
        p.settings.syncDemoDataAfterSave = () => {};
        p.settings._featuresDirty = true;
        p.put = (_request, success, error) => { complete = success; failed = error; };
        p.settings.saveModulesTab();
        failed();
        assert.equal(p.settings._featuresDirty, true);
        assert.equal(refreshes, 0);
        complete({ type: 'success' });
        assert.equal(p.settings._featuresDirty, false);
        const saved = JSON.parse(cache.general_settings);
        assert.equal(saved.module_demo_data_enable, true);
        assert.equal(saved.stock_management, true);
        assert.equal(saved.first_run_done, true);
        assert.equal(refreshes, 1);
        p.settings._modulesRemoteBranch = () => 'other-branch';
        p.settings.saveModulesTab();
        complete({ type: 'success' });
        assert.equal(refreshes, 1, 'another branch must not alter this till navigation');
    } finally { h.dom.window.close(); }
});

test('the Core Settings form still saves the receipt designer when Receipt Print is selected', () => {
    const h = setup();
    try {
        h.$('#v-pills-general').show();
        h.$('#tax_discount_add').triggerHandler('submit');
        assert.equal(h.receiptSaves(), 1);
        assert.equal(h.requests.length, 0);
        h.$('#core-tab-print').removeClass('active');
        h.$('#tax_discount_add').triggerHandler('submit');
        assert.equal(h.requests.length, 1);
    } finally { h.dom.window.close(); }
});

test('the single Core Save includes changed account sharing only after the branch save succeeds', () => {
    const h = setup();
    h.$('#core-tab-print').removeClass('active');
    let next, sharing = 0;
    h.w.PosnicPro.alert = () => {};
    h.w.PosnicPro.i18n = { t: (_key, fallback) => fallback };
    h.w.PosnicPro.settings.updateCommonSetting = (_label, done) => { next = done; };
    h.w.PosnicPro.settings.saveSharing = () => { sharing++; };
    h.w.PosnicPro.settings._sharingLoaded = true;
    h.w.PosnicPro.settings._sharingDirty = true;
    h.$('#tax_discount_add').triggerHandler('submit');
    assert.equal(sharing, 0);
    next();
    assert.equal(sharing, 1);
    h.w.PosnicPro.settings._sharingDirty = false;
    h.$('#tax_discount_add').triggerHandler('submit');
    next();
    assert.equal(sharing, 1, 'unchanged account sharing must not be overwritten');
    h.dom.window.close();
});
