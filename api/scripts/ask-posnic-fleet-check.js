/* global document, window, innerWidth */
'use strict';

// Real Mongo counters -> authenticated Gateway -> Intranet -> shipped browser UI.
// Isolated fixtures only; no customer data, provider calls or messages.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');
const puppeteer = require('puppeteer');
const metrics = require('../src/services/ask-posnic-metrics.service');

async function main() {
  const intranet = process.env.POSNIC_INTRANET_ROOT, gateway = process.env.POSNIC_GATEWAY_ROOT;
  if (!intranet || !gateway) throw new Error('Set POSNIC_INTRANET_ROOT and POSNIC_GATEWAY_ROOT to the release checkouts.');
  const { register, summarize, windowFor } = require(path.join(gateway, 'apps/sync-gateway/src/ask-posnic-metrics'));
  const { createControlAuth } = require(path.join(gateway, 'apps/sync-gateway/src/control-api'));
  const { mount } = require(path.join(intranet, 'ask-posnic-fleet'));
  const mongo = await MongoMemoryServer.create(), client = await MongoClient.connect(mongo.getUri());
  let host, consoleServer, browser;
  const prior = process.env.CONTROL_TOKEN; process.env.CONTROL_TOKEN = 'synthetic-fleet-test';
  try {
    const control = client.db('control'), db = client.db('posnic_t_shop');
    await control.collection('tenants').insertMany([
      { tenantDb: 'posnic_t_shop', instance: 'validation', name: '<img src=x onerror="window.injected=true"> Test shop' },
      { tenantDb: 'posnic_t_empty', instance: 'validation', name: 'No observations shop' },
      { tenantDb: 'posnic_t_remote', instance: 'other-host', name: 'Unavailable shop' },
    ]);
    const now = new Date(), day = 86400000, from = new Date(now.getTime() - 6 * day).toISOString().slice(0, 10), to = new Date(now.getTime() + day).toISOString().slice(0, 10);
    const context = { licenseId: 'synthetic-license', user: 'private-user' };
    await Promise.all(Array.from({ length: 100 }, () => metrics.write(db, context, 'request', { requests: 1, answered: 1, duration_ms: 10, question: 'private-question' }, {}, now)));
    await metrics.write(db, context, 'request', { requests: 1, unanswered: 1, duration_ms: 50 }, {}, now);
    await metrics.write(db, context, 'provider', { calls: 2, succeeded: 1, failed: 1, duration_ms: 100 }, {}, now);
    await metrics.write(db, context, 'quality', { helpful: 3, not_helpful: 1, actions_confirmed: 2 }, {}, now);
    await metrics.write(db, context, 'cost', { calls: 1, tokens_in: 100, tokens_out: 20, cost_microminor: 2000 }, { currency: 'INR', payer: 'posnic' }, now);
    await metrics.write(db, context, 'cost', { calls: 1, tokens_in: 10, tokens_out: 2, cost_microminor: 50 }, { currency: 'USD', payer: 'shop' }, now);
    await metrics.write(db, { licenseId: 'second-license' }, 'request', { requests: 1, failed: 1 }, {}, now);
    await metrics.write(db, context, 'request', { requests: 99999 }, {}, new Date(now.getTime() - 40 * day));
    const stored = await db.collection(metrics.COLLECTION).find({}).toArray();
    assert.equal(stored.length, 7); assert.doesNotMatch(JSON.stringify(stored), /private|question/);
    const indexes = await db.collection(metrics.COLLECTION).indexes();
    assert.ok(indexes.some(index => index.key.expires_at === 1 && index.expireAfterSeconds === 0));
    assert.ok(stored.every(row => row.expires_at - row.day === 91 * day));
    const aggregate = await summarize(db, windowFor(from, to));
    assert.equal(aggregate.request.requests, 102); assert.equal(aggregate.request.answered, 100); assert.equal(aggregate.request.unanswered, 1); assert.equal(aggregate.request.failed, 1);
    assert.equal(aggregate.provider.failed, 1); assert.equal(aggregate.quality.helpful, 3); assert.equal(aggregate.costs.length, 2);
    assert.equal(aggregate.costs.find(row => row.currency === 'INR').cost_microminor, 2000);
    assert.doesNotMatch(JSON.stringify(aggregate), /synthetic-license|second-license|private/);
    const hostApp = express(); hostApp.use(express.json()); const router = express.Router();
    register(router, { client, clusterClient: async () => client, controlDb: 'control', instanceName: 'validation' });
    hostApp.use('/v1/control', createControlAuth(), router);
    host = await new Promise(resolve => { const s = hostApp.listen(0, '127.0.0.1', () => resolve(s)); });
    const app = express(); app.use(express.json());
    app.get('/api/me', (_req, res) => res.json({ email: 'validation@example.invalid', role: 'admin' }));
    mount(app, { control, requireAuth: (_req, _res, next) => next(), requireAdmin: (_req, _res, next) => next(), askInstance: async (tenantDb, route, body) => {
      const response = await fetch(`http://127.0.0.1:${host.address().port}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-fleet-test' }, body: JSON.stringify({ tenantDb, ...body }) });
      if (!response.ok) throw new Error('host unavailable'); return response.json();
    } });
    app.use(express.static(path.join(intranet, 'public')));
    consoleServer = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${consoleServer.address().port}`;
    const result = await (await fetch(`${base}/api/ask-posnic/fleet?from=${from}&to=${to}`)).json();
    assert.equal(result.rows.find(row => row.tenantDb === 'posnic_t_shop').request.requests, 102);
    assert.equal(result.rows.find(row => row.tenantDb === 'posnic_t_remote').state, 'unavailable');
    assert.equal(result.rows.find(row => row.tenantDb === 'posnic_t_empty').state, 'no_observations');
    browser = await puppeteer.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const output = path.resolve(__dirname, '../../output/ask-posnic-ui'); fs.mkdirSync(output, { recursive: true });
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewport({ width, height });
      await page.goto(`${base}/ask-posnic-fleet.html`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => document.querySelectorAll('.fleet-shop').length === 3);
      const state = await page.evaluate(() => ({ text: document.querySelector('#fleet-rows').textContent, overflow: document.documentElement.scrollWidth > innerWidth + 1, injected: !!window.injected }));
      assert.match(state.text, /INR/); assert.match(state.text, /USD/); assert.match(state.text, /Metrics unavailable/); assert.match(state.text, /No observations/);
      assert.equal(state.injected, false); assert.equal(state.overflow, false);
      await page.screenshot({ path: path.join(output, `fleet-${name}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('PASS: 100 concurrent increments, license isolation, 91-day TTL, bounded real Mongo aggregate, separate currencies, authenticated host routing, unavailable and empty states, escaped desktop/mobile UI.');
  } finally {
    await browser?.close();
    if (consoleServer) await new Promise(resolve => consoleServer.close(resolve));
    if (host) await new Promise(resolve => host.close(resolve));
    await client.close(); await mongo.stop();
    if (prior === undefined) delete process.env.CONTROL_TOKEN; else process.env.CONTROL_TOKEN = prior;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
