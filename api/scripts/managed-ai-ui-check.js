/* global document, window, innerWidth */
// These globals are used inside browser-evaluated Puppeteer callbacks.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const puppeteer = require('puppeteer');

async function main() {
  const root = process.env.POSNIC_WEB_FRONTEND || path.resolve(__dirname, '../../../web-frontend');
  const account = fs.readFileSync(path.join(root, 'account.html'), 'utf8');
  const pane = account.match(/<div class="card pane" id="pane-managed-ai">[\s\S]*?(?=<div class="card pane" id="pane-orders">)/)[0];
  const styles = account.match(/<style>[\s\S]*?<\/style>/)[0];
  const app = express(); app.use('/assets', express.static(path.join(root, 'assets')));
  app.get('/', (_req, res) => res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/site.css">${styles}</head><body><main class="section"><div class="wrap"><h2>My account</h2>${pane.replace('card pane', 'card pane on')}</div></main><script src="/assets/managed-ai.js"></script></body></html>`));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const output = path.resolve(__dirname, '../../output/ask-posnic-ui'); fs.mkdirSync(output, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
      await page.evaluate(async () => {
        window.calls = []; window.activeAi = false; window.paid = false;
        window.api = async (url, options) => {
          window.calls.push({ url, options });
          if (url.endsWith('/catalog')) return { enabled: true, offers: [{ planId: 'managed_ai_test', name: 'Example AI pack', amountMinor: 9900, currency: 'INR', billingInterval: 'month', allowanceUsdMinor: 100 }], note: 'Synthetic test prices. No real payment.' };
          if (url.endsWith('/status')) return { tenantDb: 'test', active: window.activeAi, allowance_minor: 100, valid_until: '2026-11-01T00:00:00Z', cancel_at_period_end: !!window.cancelled };
          if (url.endsWith('/cancel')) { window.cancelled = true; return { cancelled: true }; }
          if (url.endsWith('/checkout')) return { checkoutAttemptId: 'chk_test', status: 'created', provider: 'razorpay', safeClient: { keyId: 'synthetic', recurring: true, subscriptionId: 'sub_test' } };
          if (url.includes('/checkout/')) return { status: window.paid ? 'paid' : 'created' };
          throw new Error('Unexpected fixture request: ' + url);
        };
        window.Razorpay = class { constructor(options) { window.gatewayOptions = options; } on() {} open() { window.gatewayOptions.modal.ondismiss(); } };
        sessionStorage.clear(); await window.loadManagedAi();
      });
      await page.click('#managedAiOffers button');
      assert.equal(await page.evaluate(() => window.calls.filter((c) => c.url.endsWith('/checkout')).length), 0, 'review must not start payment');
      await page.screenshot({ path: path.join(output, `billing-${name}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' horizontal overflow');
      await page.click('#managedAiReview button');
      await page.waitForFunction(() => document.getElementById('managedAiMessage').textContent.includes('Checkout closed'));
      await page.click('#managedAiReview button');
      const keys = await page.evaluate(() => window.calls.filter((c) => c.url.endsWith('/checkout')).map((c) => c.options.body.idempotencyKey));
      assert.equal(keys.length, 2); assert.equal(keys[0], keys[1], 'retry must keep payment request identity');
      await page.evaluate(async () => { window.activeAi = true; window.paid = true; await window.loadManagedAi(); });
      await page.click('#managedAiCancel');
      assert.equal(await page.evaluate(() => window.calls.filter((c) => c.url.endsWith('/cancel')).length), 0);
      await page.click('#managedAiReview button');
      await page.waitForFunction(() => document.getElementById('managedAiBody').textContent.includes('Renewal is cancelled'));
      await page.evaluate(async () => { window.api = async (url) => url.endsWith('/catalog') ? { enabled: false, offers: [] } : { tenantDb: 'test', active: false }; await window.loadManagedAi(); });
      assert.equal(await page.$('#managedAiOffers button'), null, 'disabled catalog must not sell');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: billing review, repeat checkout identity, cancellation confirmation, disabled catalog, desktop/mobile layout. No real payment calls.');
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
