 'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('desktop navigation opens Mobile POS, branch payments and shared filtered devices', { skip: !process.env.MOBILE_PLAYWRIGHT_PATH }, async () => {
  const { chromium } = require(process.env.MOBILE_PLAYWRIGHT_PATH);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.route('**/mobile-pos-setup*', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Settings frame</h1>' }));
    await page.setContent(fs.readFileSync(path.join(root, 'frontend/modules/settings_write.html'), 'utf8'));
    await page.addStyleTag({ path: path.join(root, 'frontend/static/style/css/bootstrap.min.css') });
    await page.addStyleTag({ path: path.join(root, 'frontend/static/style/css/custom.css') });
    await page.addScriptTag({ path: path.join(root, 'frontend/static/script/js/jquery.min.js') });
    await page.evaluate(() => {
      window.API_URL = 'http://127.0.0.1:5555/api';
      window.PosnicPro = { local: { get: () => '' }, i18n: { t: (key, fallback) => fallback }, get: (url, done) => done({ data: [
        { device_id: 'mobile-one', model: 'Sales phone', app: 'mobile-pos', branch_name: 'Main branch' },
        { device_id: 'captain-one', model: 'Waiter phone', app: 'captain', branch_name: 'Main branch' }
      ] }) };
      $('#settings').show();
    });
    const source = fs.readFileSync(path.join(root, 'frontend/static/script/js/modules/js/settings.js'), 'utf8');
    await page.addScriptTag({ content: source.slice(0, source.indexOf('\n};') + 3) });
    await page.addScriptTag({ path: path.join(root, 'frontend/static/script/js/modules/js/handsets.js') });
    await page.evaluate(() => PosnicPro.settings.openSection('mobilepos'));
    assert.equal(await page.locator('#v-pills-mobilepos').isVisible(), true);
    assert.equal(await page.locator('#mobile_pos_frame').getAttribute('src'), 'http://127.0.0.1:5555/api/mobile-pos-setup');
    await page.evaluate(() => PosnicPro.settings.openSection('branchpayments'));
    assert.equal(await page.locator('#v-pills-branchpayments').isVisible(), true);
    assert.equal(await page.locator('#v-pills-mobilepos').isVisible(), false);
    assert.match(await page.locator('#branch_payments_frame').getAttribute('src'), /view=payments$/);
    await page.evaluate(() => PosnicPro.settings.openSection('devices'));
    assert.equal(await page.locator('#v-pills-devices').isVisible(), true);
    assert.equal(await page.locator('#handsets_body tr').count(), 2);
    await page.selectOption('#devices_app_filter', 'mobile-pos');
    assert.equal(await page.locator('#handsets_body tr').count(), 1);
    assert.match(await page.locator('#handsets_body').innerText(), /Sales phone/);
    await page.selectOption('#devices_app_filter', 'captain');
    assert.match(await page.locator('#handsets_body').innerText(), /Waiter phone/);
    await page.locator('#v-pills-devices').screenshot({ path: path.join(root, 'tmp/mobile-pos-devices.png') });
    await page.evaluate(() => PosnicPro.settings.openSection('modules'));
    assert.equal(await page.locator('#module_mobile_pos_enable').count(), 1);
    assert.equal(await page.locator('#module_captain_enable').count(), 1);
    const card = page.locator('.module-card').filter({ has: page.locator('#module_mobile_pos_enable') });
    assert.equal(await card.locator('input, select, textarea, button').count(), 1);
    await page.locator('#v-pills-modules').screenshot({ path: path.join(root, 'tmp/mobile-pos-features.png') });
  } finally { await browser.close(); }
});
