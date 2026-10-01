/* global document, window, innerWidth, getComputedStyle, PosnicPro, $ */
// These globals are used inside browser-evaluated Puppeteer callbacks.
'use strict';

// Visual regression harness using the shipped Posnic styles and module.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const puppeteer = require('puppeteer');

async function main() {
  const root = path.resolve(__dirname, '../../frontend');
  const app = express();
  app.use('/static', express.static(path.join(root, 'static')));
  app.use('/built', express.static(path.join(root, 'public')));
  const css = fs.readdirSync(path.join(root, 'public/style')).find((file) => /^dashboard\..*\.css$/.test(file));
  const core = fs.readFileSync(path.join(root, 'static/script/js/core/PosnicPro.js'), 'utf8');
  const i18nStart = core.indexOf('PosnicPro.i18n = {');
  const i18nEnd = core.indexOf('\nPosnicPro.i18n.load()', i18nStart);
  assert.ok(i18nStart > 0 && i18nEnd > i18nStart, 'Use the shipped translation runtime');
  app.get('/i18n.js', (_req, res) => res.type('js').send(core.slice(i18nStart, i18nEnd)));
  app.get('/', (_req, res) => res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/built/style/${css}"><link rel="stylesheet" href="/static/style/css/modules/ask-posnic.css"></head><body>${fs.readFileSync(path.join(root, 'modules/ask_posnic.html'), 'utf8')}<script src="/static/style/js/jquery.min.js"></script><script>window.PosnicPro={HideSideBarModal:function(){},get:function(){},request:function(){},alert:function(){}};</script><script src="/i18n.js"></script><script src="/static/script/js/modules/js/ask_posnic.js"></script><script>document.querySelector('#askposnic').style.display='block';document.querySelector('#ask_posnic_admin').style.display='block';PosnicPro.askposnic.bind();PosnicPro.askposnic.add('user','How are sales today?');PosnicPro.askposnic.add('answer','Sales today are 12,450.00 across 37 transactions.',{intent:'sales',source:'Live sales dashboard',metrics:[{label:'Sales',value:'12,450.00'},{label:'Transactions',value:37}],scope:{outlet:'Main outlet'}});</script></body></html>`));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const output = path.resolve(__dirname, '../../output/ask-posnic-ui');
    fs.mkdirSync(output, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => PosnicPro.askposnic.add('answer', 'Sales by authorized outlet. Amounts retain their configured currency.', { intent: 'outlet_comparison', source: 'Sales records by authorized outlet', metrics: [{ label: 'Main (USD)', value: '42.50' }, { label: 'Second (INR)', value: '81.75' }], scope: { outlets: [{ outlet: 'Main' }, { outlet: 'Second <img src=x>' }], as_of: '2026-10-01T00:00:00Z' } }));
      assert.match(await page.$eval('#ask_posnic_thread', (element) => element.textContent), /Outlets: Main, Second/);
      assert.equal(await page.$$eval('#ask_posnic_thread img', (elements) => elements.length), 0);
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
      const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, missing: ['ask_schedule_channel', 'ask_schedule_destination', 'ask_schedule_timezone', 'ask_schedule_weekday'].filter((id) => !document.getElementById(id)) }));
      assert.ok(layout.width <= layout.viewport + 1, `${name} horizontal overflow: ${JSON.stringify(layout)}`);
      assert.deepEqual(layout.missing, []);
      await page.evaluate(() => {
        PosnicPro.request = (options, done) => { window.savedAskPreferences = JSON.parse(options.data); done({ type: 'success', message: 'Saved' }); };
        document.querySelector('#ask_pref_own_semantic').checked = true;
        document.querySelector('#ask_pref_embedding_budget').value = '2.50';
        document.querySelector('#ask_pref_retention').value = '90';
      });
      await page.click('#ask_posnic_preferences_form button[type="submit"]');
      const savedPreferences = await page.evaluate(() => window.savedAskPreferences);
      assert.equal(savedPreferences.own_key_semantic, true);
      assert.equal(savedPreferences.own_key_semantic_budget, 2.5);
      assert.equal(savedPreferences.retention_days, 90);
      await page.evaluate(() => {
        PosnicPro.get = (url, done) => {
          if (url === 'ask-posnic/recovery') return done({ data: { rows: [{ id: 'review-test', type: 'Knowledge indexing', label: 'Source <img src=x>', state: 'needs_review' }] } });
          if (url === 'ask-posnic/schedules') return done({ data: [{ _id: 'schedule-test', report: 'sales', frequency: 'daily', hour: 8, timezone: 'UTC', channel: 'email', destination: 'nobody@example.invalid', enabled: false, last_status: 'reviewed' }] });
        };
        PosnicPro.askposnic.loadRecovery(); PosnicPro.askposnic.loadSchedules();
        window.resumeCalls = 0;
        PosnicPro.request = (options, done) => {
          if (options.url !== 'ask-posnic/schedules/schedule-test/resume') throw new Error('Unexpected schedule recovery request');
          window.resumeCalls++; done({ type: 'success' });
        };
      });
      assert.equal(await page.$$eval('#ask_posnic_recovery img', (nodes) => nodes.length), 0);
      assert.match(await page.$eval('#ask_posnic_recovery', (element) => element.textContent), /needs review/);
      await page.click('.ask-schedule-resume');
      assert.equal(await page.evaluate(() => window.resumeCalls), 1);
      await page.addScriptTag({ url: `http://127.0.0.1:${server.address().port}/static/style/js/popper.min.js` });
      await page.addScriptTag({ url: `http://127.0.0.1:${server.address().port}/static/style/js/bootstrap.min.js` });
      await page.evaluate(() => {
        PosnicPro.askposnic.add('answer', 'Printer instructions.', { intent: 'help', citations: [{ document_id: 'pdf-check', revision: 'r1', title: 'PDF manual', chunk: 0, pages: [2, 3] }] });
        PosnicPro.get = (url, done) => {
          window.citationRequest = url;
          done({ data: { title: 'PDF manual', revision: 'r1', sections: [{ page: 2, text: 'Connect printer <img src=x>' }, { page: 3, text: 'Review printer settings.' }] } });
        };
      });
      await page.click('.ask-citation');
      await page.waitForFunction(() => document.querySelector('#ask_source_modal').classList.contains('show'));
      assert.equal(await page.evaluate(() => window.citationRequest), 'ask-posnic/documents/pdf-check?revision=r1&chunk=0');
      assert.match(await page.$eval('.ask-citation', element => element.textContent), /PDF 2, 3/);
      assert.match(await page.$eval('#ask_source_content', element => element.textContent), /PDF · 2[\s\S]*Connect printer[\s\S]*PDF · 3/);
      assert.equal(await page.$$eval('#ask_source_content img', elements => elements.length), 0);
      await page.waitForFunction(() => !$('#ask_source_modal').data('bs.modal')._isTransitioning);
      await page.screenshot({ path: path.join(output, `pdf-pages-${name}.png`) });
      await page.evaluate(() => $('#ask_source_modal').modal('hide'));
      await page.waitForFunction(() => !document.querySelector('.modal-backdrop'));
      await page.evaluate(() => {
        window.confirmCalls = 0;
        PosnicPro.request = (options, done) => {
          if (options.url !== 'ask-posnic/actions/confirm') throw new Error('Unexpected UI mutation');
          window.confirmCalls++;
          done({ type: 'success', data: { output: { quotation: { quote_id: 'QUO-TEST' } } } });
        };
        PosnicPro.askposnic.reviewDraft({ type: 'sale_draft', token: 'synthetic-only', payload: { customer_name: 'Review customer', total: 5.5, tax_total: 0.5, lines: [{ item_name: 'Tea <img src=x>', qty: 0.5, unit_price: 10, tax_value: 10, tax_type: 'Exc' }] } });
      });
      await page.waitForFunction(() => document.querySelector('#ask_draft_modal').classList.contains('show'));
      await page.evaluate(async () => { await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
      assert.equal(await page.evaluate(() => window.confirmCalls), 0);
      assert.match(await page.$eval('#ask_draft_content', (element) => element.textContent), /5\.50/);
      assert.equal(await page.$$eval('#ask_draft_content img', (elements) => elements.length), 0);
      await page.screenshot({ path: path.join(output, `sale-draft-${name}.png`) });
      await page.click('#ask_draft_confirm');
      await page.waitForFunction(() => document.querySelector('#ask_posnic_thread').textContent.includes('QUO-TEST'));
      assert.equal(await page.evaluate(() => window.confirmCalls), 1);
      assert.ok(await page.$('#ask_posnic_thread a[href="#/quotes"]'));
      await page.evaluate(async () => { await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
      await page.evaluate(() => {
        window.recoveryCalls = 0;
        PosnicPro.request = (options, done) => {
          if (options.url === 'ask-posnic/actions/partial-test') return done({ data: { status: 'partial', resumable: true, expected: 2, saved: [{ id: 'saved-one', po_id: 'PO-000001' }] } });
          if (options.url === 'ask-posnic/actions/partial-test/resume') {
            window.recoveryCalls++;
            return done({ data: { id: 'partial-test', type: 'purchase_order', token: 'recovery-only', recovery: { saved: [{}], remaining: 1 }, payload: { orders: [{ supplier_name: 'Remaining supplier <img src=x>', items: [{ item_name: 'Tea', qty_ordered: 3, unit_cost: 4 }] }] } } });
          }
          if (options.url === 'ask-posnic/actions/confirm') {
            if (JSON.parse(options.data).token !== 'recovery-only') throw new Error('Recovery used the wrong confirmation');
            window.confirmCalls++;
            return done({ type: 'success', data: { output: { purchase_orders: [{ po_id: 'PO-000002' }] } } });
          }
          throw new Error('Unexpected recovery request');
        };
        PosnicPro.askposnic.checkActionOutcome({ id: 'partial-test', type: 'purchase_order' });
      });
      await page.evaluate(() => Array.from(document.querySelectorAll('#ask_posnic_thread button')).find((button) => button.textContent === 'Review remaining work').click());
      await page.waitForFunction(() => document.querySelector('#ask_draft_modal').classList.contains('show'), { timeout: 5000 }).catch(async (error) => { console.error(await page.evaluate(() => ({ recoveryCalls: window.recoveryCalls, content: $('#ask_draft_content').text(), modal: $('#ask_draft_modal').attr('style'), classes: $('#ask_draft_modal').attr('class'), transitioning: $('#ask_draft_modal').data('bs.modal')._isTransitioning })), errors); throw error; });
      await page.evaluate(async () => { await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
      assert.equal(await page.evaluate(() => window.confirmCalls), 1);
      assert.equal(await page.evaluate(() => window.recoveryCalls), 1);
      assert.match(await page.$eval('#ask_draft_content', (element) => element.textContent), /Remaining orders to review: 1/);
      assert.equal(await page.$$eval('#ask_draft_content img', (elements) => elements.length), 0);
      await page.screenshot({ path: path.join(output, `recovery-${name}.png`) });
      await page.click('#ask_draft_confirm');
      assert.equal(await page.evaluate(() => window.confirmCalls), 2);
      await page.waitForFunction(() => !document.querySelector('.modal-backdrop'));
      await page.evaluate(() => {
        window.supplierDraftCalls = 0;
        window.supplierSaved = false;
        window.copiedSupplierMessage = '';
        const message = { subject: 'Availability request: PO-000001', supplier_name: 'Supplier <img src=x>', body: 'Hello Supplier <img src=x>,\n\nPlease confirm availability.\n- Tea: 3.5' };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copiedSupplierMessage = text; } } });
        PosnicPro.request = (options, done) => {
          if (options.url === 'ask-posnic/actions/draft') {
            if (JSON.parse(options.data).type !== 'supplier_message') throw new Error('Wrong supplier draft type');
            window.supplierDraftCalls++;
            return done({ data: { id: 'supplier-test', type: 'supplier_message', token: 'supplier-only', payload: message } });
          }
          if (options.url === 'ask-posnic/actions/confirm') {
            if (JSON.parse(options.data).token !== 'supplier-only') throw new Error('Wrong supplier confirmation');
            window.confirmCalls++;
            window.supplierSaved = true;
            return done({ type: 'success', data: { output: { supplier_message: { id: 'saved-supplier' } } } });
          }
          if (options.url === 'ask-posnic/supplier-messages') return done({ data: window.supplierSaved ? [message] : [] });
          throw new Error('Unexpected supplier request');
        };
        PosnicPro.askposnic.prepareAction('supplier_message');
      });
      await page.waitForFunction(() => document.querySelector('#ask_supplier_modal').classList.contains('show'));
      await page.evaluate(async () => { await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
      await page.type('#ask_supplier_po', 'PO-000001');
      await page.click('#ask_supplier_form button[type="submit"]');
      await page.waitForFunction(() => document.querySelector('#ask_draft_modal').classList.contains('show'));
      await page.evaluate(async () => { await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
      assert.equal(await page.evaluate(() => window.supplierSaved), false);
      assert.equal(await page.evaluate(() => window.supplierDraftCalls), 1);
      assert.equal(await page.$$eval('#ask_draft_content img', (elements) => elements.length), 0);
      await page.screenshot({ path: path.join(output, `supplier-review-${name}.png`) });
      await page.click('#ask_draft_confirm');
      await page.waitForFunction(() => document.querySelector('#ask_supplier_messages summary'));
      assert.equal(await page.evaluate(() => window.confirmCalls), 3);
      assert.equal(await page.$$eval('#ask_supplier_messages img', (elements) => elements.length), 0);
      await page.waitForFunction(() => !document.querySelector('.modal-backdrop'));
      await page.click('#ask_supplier_messages summary');
      await page.click('#ask_supplier_messages button');
      assert.match(await page.evaluate(() => window.copiedSupplierMessage), /Tea: 3\.5/);
      await page.evaluate(() => {
        window.reorderPayload = null;
        PosnicPro.i18n._dict = { lang_order_quantity: '<img src=x onerror=alert(1)>' };
        PosnicPro.request = (options, done) => {
          if (options.url === 'ask-posnic/actions/draft') {
            window.reorderPayload = JSON.parse(options.data);
            return done({ data: { id: 'reorder-test', type: 'purchase_order', token: 'reorder-only', payload: { source: 'demand', planned_count: 1, eligible_count: 1, plan: { lookback_days: 30, coverage_days: 14 }, orders: [{ supplier_name: 'Tea supplier', items: [{ item_name: 'Tea', qty_ordered: 7, unit_cost: 3 }] }] } } });
          }
          if (options.url === 'ask-posnic/actions/confirm' && JSON.parse(options.data).token === 'reorder-only') {
            window.confirmCalls++;
            return done({ type: 'success', data: { output: { purchase_orders: [{ po_id: 'PO-000003' }] } } });
          }
          throw new Error('Unexpected reorder request');
        };
        PosnicPro.askposnic.add('answer', 'Reorder suggestions use current stock and incoming orders.', { action: { type: 'purchase_order', source: 'demand', label: 'Review suggested purchase orders', lookback_days: 30, coverage_days: 14 } });
      });
      await page.click('.ask-posnic-draft-action[data-source="demand"]');
      await page.waitForFunction(() => document.querySelector('#ask_draft_modal').classList.contains('show'));
      await page.evaluate(async () => { await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))); });
      assert.deepEqual(await page.evaluate(() => window.reorderPayload), { type: 'purchase_order', payload: { source: 'demand', lookback_days: 30, coverage_days: 14 } });
      assert.equal(await page.evaluate(() => window.confirmCalls), 3);
      assert.match(await page.$eval('#ask_draft_content', (element) => element.textContent), /covering 14 days/);
      assert.equal(await page.$$eval('#ask_draft_content img', (elements) => elements.length), 0);
      assert.match(await page.$eval('#ask_draft_content', (element) => element.textContent), /<img src=x onerror=alert\(1\)>/);
      await page.screenshot({ path: path.join(output, `reorder-review-${name}.png`) });
      await page.click('#ask_draft_confirm');
      assert.equal(await page.evaluate(() => window.confirmCalls), 4);
    }
    for (const code of ['ta', 'nl', 'ar']) {
      const dictionary = JSON.parse(fs.readFileSync(path.join(root, '../languages', code + '.json'), 'utf8'));
      await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
      await page.evaluate((dict, language) => {
        PosnicPro.i18n._dict = dict;
        document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.lang = language;
        PosnicPro.i18n.apply(document);
        PosnicPro.i18n.watch(document.body);
        window.localizedQuestions = [];
        PosnicPro.request = (options, done) => {
          if (options.url !== 'ask-posnic/ask') throw new Error('Unexpected translated suggestion request');
          window.localizedQuestions.push(JSON.parse(options.data).question);
          done({ type: 'success', data: { answer: 'Source text', intent: 'help' } });
        };
      }, dictionary, code);
      assert.equal(await page.$eval('#ask_posnic_question', (element) => element.placeholder), dictionary.lang_ask_posnic_about_your_shop);
      assert.equal(await page.$eval('#ask_posnic_suggestions button', (element) => element.textContent), dictionary.lang_how_are_sales_today);
      await page.click('#ask_posnic_suggestions button');
      assert.deepEqual(await page.evaluate(() => window.localizedQuestions), ['How are sales today?']);
      assert.equal(await page.$eval('#ask_pref_period option[value="today"]', (element) => element.value), 'today');
      await page.screenshot({ path: path.join(output, `translated-${code}-mobile.png`), fullPage: true });
      const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, elements: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(element).position !== 'fixed').slice(0, 12).map(element => ({ tag: element.tagName, id: element.id, className: element.className, width: element.getBoundingClientRect().width })) }));
      assert.ok(overflow.width <= overflow.viewport + 1, code + ' overflows the mobile viewport: ' + JSON.stringify(overflow));
      await page.evaluate(() => {
        PosnicPro.i18n.restore(document);
        PosnicPro.i18n._dict = null;
      });
      assert.equal(await page.$eval('#ask_posnic_suggestions button', (element) => element.textContent), 'How are sales today?');
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: desktop and mobile layout; screenshots in ${output}`);
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
