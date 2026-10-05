'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
function setup() {
    const dom = new JSDOM('<button id="dashboard_refresh"></button><span id="dashboard_refresh_status"></span><span id="kpi_sales"></span>', { runScripts: 'outside-only' });
    const w = dom.window, calls = [], renders = [];
    w.$ = require('jquery')(w);
    w.PosnicPro = { local: { get: () => 'branch1' }, i18n: { t: (_, fallback) => fallback }, get: (params, ok, fail) => calls.push({ params, ok, fail }) };
    const source = fs.readFileSync('frontend/static/script/js/modules/js/dashboard.js', 'utf8');
    w.eval(source.slice(0, source.indexOf('\n};') + 3));
    const d = w.PosnicPro.dashboard;
    Object.assign(d, { greeting() {}, money: String, renderBestSellers() {}, renderProfit: (_, period) => renders.push(period), syncDuesHeight() {} });
    return { w, d, calls, renders, close: () => dom.window.close() };
}
const result = value => ({ type: 'success', data: { kpis: { total_sales: value }, profit: {}, topItems: [] } });
test('dashboard refresh preserves the selected period, updates totals and avoids duplicate clicks', () => {
    const h = setup();
    h.d.loadOverview('week');
    h.d.refreshOverview();
    assert.equal(h.calls.length, 1);
    assert.equal(h.w.document.querySelector('button').disabled, true);
    h.calls[0].ok(result(400));
    h.d.refreshOverview();
    assert.equal(h.calls[1].params.data.filter, 'week');
    h.calls[1].ok(result(550));
    assert.equal(h.w.document.querySelector('#kpi_sales').textContent, '550');
    assert.match(h.w.document.querySelector('#dashboard_refresh_status').textContent, /^Refreshed /);
    assert.equal(h.w.document.querySelector('button').disabled, false);
    h.close();
});
test('late dashboard responses cannot overwrite a newer period, and failure permits retry', () => {
    const h = setup();
    h.d.loadOverview('day');
    h.d.loadOverview('month');
    h.calls[1].ok(result(900));
    h.calls[0].ok(result(10));
    assert.equal(h.w.document.querySelector('#kpi_sales').textContent, '900');
    h.d.refreshOverview();
    h.calls[2].fail();
    assert.equal(h.w.document.querySelector('#dashboard_refresh_status').textContent, 'Refresh failed');
    assert.equal(h.w.document.querySelector('button').disabled, false);
    h.d.refreshOverview();
    assert.equal(h.calls[3].params.data.filter, 'month');
    h.close();
});
