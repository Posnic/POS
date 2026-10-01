/* global document, window, innerWidth */
// These globals are used inside browser-evaluated Puppeteer callbacks.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const puppeteer = require('puppeteer');

async function main() {
  const root = path.resolve(__dirname, '../../../Intranet');
  const { mount } = require(path.join(root, 'ask-posnic-preview'));
  const app = express(); app.use(express.json());
  app.get('/api/me', (_req, res) => res.json({ email: 'preview@example.invalid', role: 'admin' }));
  app.get('/api/ask-posnic/knowledge', (_req, res) => res.json([]));
  let writes = 0;
  app.post('/api/ask-posnic/knowledge', (_req, res) => { writes++; res.sendStatus(500); });
  mount(app, { control: { collection: () => ({ find: () => ({ limit: () => ({ toArray: async () => [] }) }) }) }, requireAuth: (_req, _res, next) => next(), requireAdmin: (_req, _res, next) => next() });
  app.use(express.static(path.join(root, 'public')));
  const server = await new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const output = path.resolve(__dirname, '../../output/ask-posnic-ui'); fs.mkdirSync(output, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      await page.goto(`http://127.0.0.1:${server.address().port}/ask-posnic.html`, { waitUntil: 'networkidle0' });
      await page.type('#title', 'How do I open a register?');
      await page.type('#content', 'Open Cash Register and enter the opening float. <img src=x onerror="window.previewInjected=true">');
      await page.type('#preview-questions', 'How do I open a register?\nWhat is the weather forecast?');
      await page.select('#preview-scope', 'editor');
      await page.click('#run-preview');
      await page.waitForFunction(() => document.querySelectorAll('#preview-results article').length === 2);
      const result = await page.evaluate(() => ({ text: document.querySelector('#preview-results').textContent, injected: !!window.previewInjected, images: document.querySelectorAll('#preview-results img').length, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
      assert.match(result.text, /Exact FAQ/); assert.match(result.text, /opening float/); assert.match(result.text, /No source/);
      assert.equal(result.injected, false); assert.equal(result.images, 0); assert.equal(result.overflow, false, `${name} overflow`);
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.screenshot({ path: path.join(output, `knowledge-${name}.png`), fullPage: true });
      await page.select('#preview-scope', 'published'); await page.click('#run-preview');
      await page.waitForFunction(() => document.querySelector('#preview-msg').textContent.includes('Published sources only'));
      assert.doesNotMatch(await page.$eval('#preview-results', (el) => el.textContent), /opening float/);
    }
    assert.equal(writes, 0); assert.deepEqual(errors, []);
    console.log('PASS: real preview endpoint, editor isolation, unsupported questions, escaped content, no writes, desktop/mobile layout.');
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
