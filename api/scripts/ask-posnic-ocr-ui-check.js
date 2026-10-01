/* global document, window, innerWidth, DataTransfer */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const express = require('express');
const puppeteer = require('puppeteer');

async function main() {
  const root = process.env.POSNIC_INTRANET_ROOT ? path.resolve(process.env.POSNIC_INTRANET_ROOT) : path.resolve(__dirname, '../../../Intranet');
  const intranetRequire = createRequire(path.join(root, 'package.json'));
  const { MongoMemoryServer } = intranetRequire('mongodb-memory-server');
  const { MongoClient } = intranetRequire('mongodb');
  const mongo = await MongoMemoryServer.create(), client = await MongoClient.connect(mongo.getUri());
  let browser, server, mounted, writes = 0, starts = 0, uploads = 0;
  let now = new Date();
  const control = client.db('ocr_browser_validation'), app = express();
  const auth = (req, _res, next) => { req.session = { user: { email: 'validation@example.invalid', role: 'admin' } }; next(); };
  const next = (_req, _res, done) => done();
  const provider = { upload: async () => { uploads++; }, remove: async () => {}, start: async () => { starts++; return { JobId: 'synthetic-provider-job' }; },
    read: async () => ({ JobStatus: 'SUCCEEDED', DocumentMetadata: { Pages: 2 }, Blocks: [
      { BlockType: 'PAGE', Page: 1 }, { BlockType: 'LINE', Page: 1, Text: 'Open Sales and select the bill. <img src=x onerror="window.ocrInjected=true">', Confidence: 99 },
      { BlockType: 'PAGE', Page: 2 }, { BlockType: 'LINE', Page: 2, Text: 'Review the refund before confirming.', Confidence: 70 },
    ] }) };
  try {
    app.use(express.json());
    app.get('/api/me', (_req, res) => res.json({ email: 'validation@example.invalid', role: 'admin' }));
    app.get('/api/ask-posnic/knowledge', (_req, res) => res.json([]));
    app.post('/api/ask-posnic/knowledge', (_req, res) => { writes++; res.sendStatus(500); });
    mounted = await intranetRequire('./ask-posnic-ocr').mount(app, { control, config: { enabled: true, region: 'ap-south-1', bucket: 'synthetic-private-bucket', microsPerPage: 1500 }, provider,
      worker: false, parse: async () => ({ pages: 2 }), clock: () => now, requireAuth: auth, requireAdmin: next, audit: async () => {} });
    intranetRequire('./ask-posnic-preview').mount(app, { control, requireAuth: auth, requireAdmin: next });
    app.use(express.static(path.join(root, 'public')));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    browser = await puppeteer.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const output = path.resolve(__dirname, '../../output/ask-posnic-ui'); fs.mkdirSync(output, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      await page.goto(`http://127.0.0.1:${server.address().port}/ask-posnic.html`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => document.querySelector('#ocr-status').textContent.includes('AWS OCR configured'));
      await page.$eval('#ocr-allowance', el => { el.value = '4'; }); await page.click('#ocr-save-allowance');
      await page.waitForFunction(() => document.querySelector('#ocr-message').textContent.includes('allowance saved') && !document.querySelector('#ocr-prepare').disabled);
      await page.evaluate(() => {
        const transfer = new DataTransfer(); transfer.items.add(new File(['%PDF-synthetic-input'], '<img src=x onerror=window.ocrInjected=true>.pdf', { type: 'application/pdf' }));
        document.querySelector('#source-file').files = transfer.files;
      });
      const before = starts;
      await page.click('#ocr-prepare');
      await page.waitForSelector('[data-approve]');
      await page.waitForFunction(() => !document.querySelector('[data-approve]').disabled);
      assert.match(await page.$eval('[data-approve]', el => el.textContent), /USD 0.0030/);
      await mounted.service.tick(); assert.equal(starts, before, 'preview cannot start paid OCR');
      await page.click('[data-approve]');
      await page.waitForFunction(() => document.querySelector('#ocr-message').textContent.includes('Choose the document language'));
      assert.equal(starts, before);
      await page.select('#ocr-language', 'en'); await page.click('[data-approve]');
      await page.waitForFunction(() => document.querySelector('#ocr-jobs').textContent.includes('Checking allowance'));
      await mounted.service.tick(); assert.equal(starts, before + 1);
      now = new Date(now.getTime() + 16000); await mounted.service.tick();
      await page.click('#ocr-refresh'); await page.waitForSelector('[data-load]');
      await page.waitForFunction(() => !document.querySelector('[data-load]').disabled);
      await page.click('[data-load]');
      await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('1 lines may need extra attention'));
      assert.equal(await page.$eval('#kind', el => el.value), 'pdf');
      assert.match(await page.$eval('#content', el => el.value), /<img src=x/);
      await page.select('#preview-scope', 'editor');
      await page.$eval('#preview-questions', el => { el.value = 'How do I open Sales and select the bill?'; });
      await page.click('#run-preview');
      await page.waitForFunction(() => document.querySelector('#preview-results').textContent.includes('PDF 1'));
      const result = await page.evaluate(() => ({ injected: !!window.ocrInjected, images: document.querySelectorAll('#ocr-jobs img, #preview-results img').length, overflow: document.documentElement.scrollWidth > innerWidth + 1 }));
      assert.deepEqual(result, { injected: false, images: 0, overflow: false }, name);
      await page.screenshot({ path: path.join(output, `ocr-${name}.png`), fullPage: true });
      await page.$eval('#content', el => { el.value += ' Edited text.'; }); await page.click('#run-preview');
      await page.waitForFunction(() => !document.querySelector('#run-preview').disabled);
      assert.doesNotMatch(await page.$eval('#preview-results', el => el.textContent), /PDF 1/);
      await page.click('[data-discard]');
      await page.waitForFunction(() => !document.querySelector('[data-load]'));
    }
    assert.equal(uploads, 2); assert.equal(starts, 2); assert.equal(writes, 0); assert.deepEqual(errors, []);
    assert.equal((await mounted.service.status()).approved_pages, 4);
    console.log('PASS: real OCR module and MongoDB, explicit paid approval, language check, review-only import, page references, escaping, editing invalidation and desktop/mobile layout; provider simulated.');
  } finally {
    await browser?.close(); mounted?.close(); if (server) await new Promise(resolve => server.close(resolve));
    await client.close(); await mongo.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
