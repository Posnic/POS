'use strict';

/*
 * The website's dataset zips feed every demo-data door - and posnic.com
 * being down must never cost a shop its existence.
 *
 * Owner: "demo data ready from website. when demo data install in pos you
 * can download zip and use it. this functionality is common for both from
 * website and as well from app... i want this demo data should be very good
 * and useful."
 *
 * The fixture is three products CUT FROM THE REAL SHIPPED ZIP
 * (dataset/INR/auto_parts.zip), so the mapping is tested against what the
 * website actually publishes, not against a shape remembered from reading it
 * once.
 */
const path = require('path');
const ds = require('../../../src/services/demo-dataset');
const fixture = require('../../fixtures/dataset-auto-parts.json');

describe('the dataset maps to the installer pack shape', () => {
  const pack = ds.toPack(fixture, (id) => `/uploads/demo/x/${id}.jpg`);

  test('products carry real pricing, not the invented 30% margin', () => {
    expect(pack.products.length).toBe(3);
    for (const p of pack.products) {
      expect(p.price).toBeGreaterThan(0);
      expect(p.cost_price).toBeGreaterThan(0);
      expect(p.cost_price).toBeLessThan(p.price);
      expect(p.mrp).toBeGreaterThanOrEqual(p.price);
    }
  });

  test('opening stock and inventory tracking come from the dataset', () => {
    for (const p of pack.products) {
      expect(p.stock).toBeGreaterThan(0);
      expect(typeof p.track_inventory).toBe('boolean');
    }
  });

  test('every product gets its staged image path', () => {
    for (const p of pack.products) {
      expect(p.image).toMatch(/^\/uploads\/demo\//);
    }
  });

  test('barcodes are never invented', () => {
    /* The dataset's own policy, kept: an invented barcode silently claims to
       be a product it is not, and poisons every later join against it. */
    for (const p of pack.products) expect(p.barcode).toBeNull();
  });

  test('an empty or junk manifest is null, never a throw', () => {
    expect(ds.toPack(null)).toBeNull();
    expect(ds.toPack({})).toBeNull();
    expect(ds.toPack({ products: [] })).toBeNull();
    expect(ds.toPack({ products: [{ name: 'x' }] })).toBeNull(); // no pricing
  });
});

describe('trade vocabulary and URLs', () => {
  test('the spoken names of the trade all land on one key', () => {
    for (const t of ['auto_parts', 'auto parts', 'AutoParts', 'garage', 'automobile']) {
      expect(ds.datasetKeyFor(t)).toBe('auto_parts');
    }
    expect(ds.datasetKeyFor('bakery')).toBeNull();
    expect(ds.datasetKeyFor('')).toBeNull();
    expect(ds.datasetKeyFor(null)).toBeNull();
  });

  test('the URL is currency-first, matching what the website serves', () => {
    expect(ds.datasetUrl('INR', 'auto_parts')).toMatch(/\/dataset\/INR\/auto_parts\.zip$/);
  });
});

describe('the availability rule: posnic.com is optional', () => {
  const fs = require('fs');
  const src = fs
    .readFileSync(path.join(__dirname, '../../../src/services/demo-dataset.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  test('every network failure resolves to null - nothing throws upward', () => {
    /* Provisioning a shop must never wait on a marketing site. The fetch
       resolves null on non-200, on error, on timeout and on the size cap -
       and loadDatasetPack catches whatever is left. */
    const fetchFn = src.slice(src.indexOf('function fetchBuffer'), src.indexOf('function toPack'));
    expect((fetchFn.match(/resolve\(null\)/g) || []).length).toBeGreaterThanOrEqual(4);
    const load = src.slice(src.indexOf('async function loadDatasetPack'));
    expect(load).toMatch(/catch \(e\)/);
    expect(load).toMatch(/return null/);
  });

  test('the installer keeps the built-in floor', () => {
    const svc = fs
      .readFileSync(path.join(__dirname, '../../../src/services/install.service.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const at = svc.indexOf('loadDatasetPack');
    expect(at).toBeGreaterThan(-1);
    const after = svc.slice(at, at + 1200);
    expect(after).toMatch(/getDemoDataByType\(businessType\)/);
    /* and rows are tagged with the CANONICAL key, which the purge and the
       chooser's current-pack read back */
    expect(after).toMatch(/packTag = demoDatasetSvc\.datasetKeyFor\(businessType\)/);
  });

  test('the chooser can only gain rows from the probe, never lose the page', () => {
    const ctrl = fs
      .readFileSync(path.join(__dirname, '../../../src/controllers/items.controller.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const at = ctrl.indexOf('listDatasetPacks');
    expect(at).toBeGreaterThan(-1);
    const around = ctrl.slice(at - 600, at + 600);
    expect(around).toMatch(/catch \(e\)/);
  });

  test('the probe is remembered, because the page is where impatience lives', () => {
    expect(src).toMatch(/AVAILABILITY_TTL_MS/);
    expect(src).toMatch(/availability\.set/);
  });
});
