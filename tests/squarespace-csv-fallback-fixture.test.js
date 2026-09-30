'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'fixtures', 'squarespace');

function readCsv(name) {
  const lines = fs
    .readFileSync(path.join(DIR, name), 'utf8')
    .split(/\r\n|\n/)
    .filter((line) => line.trim());

  return {
    headers: lines[0].split(',').map((header) => header.trim()),
    rows: lines.slice(1),
  };
}

test('Squarespace CSV fixture has the documented required and optional columns', () => {
  const csv = readCsv('orders.csv');

  assert.deepStrictEqual(csv.headers, [
    'Order ID',
    'Order Date',
    'Product Name',
    'Quantity',
    'Unit Price',
    'Currency',
    'Order Status',
    'SKU',
    'Customer Name',
    'Customer Email',
  ]);

  assert.strictEqual(csv.rows.length, 4);
});

test('Squarespace CSV fixture contains synthetic identifiers and test emails', () => {
  const csv = readCsv('orders.csv');

  for (const row of csv.rows) {
    const fields = row.split(',');

    assert.match(fields[0], /^SYNTH-SS-\d+$/);
    assert.match(fields[7], /^SYNTH-/);
    assert.match(fields[9], /@example\.test$/);
  }
});

test('invalid Squarespace CSV fixture covers documented validation cases', () => {
  const csv = readCsv('invalid-orders.csv');

  assert.strictEqual(csv.rows.length, 6);

  assert.strictEqual(csv.rows[0].split(',')[0], '');
  assert.strictEqual(csv.rows[1].split(',')[1], 'not-a-date');
  assert.strictEqual(csv.rows[2].split(',')[3], '0');
  assert.strictEqual(csv.rows[3].split(',')[4], '-5.00');
  assert.strictEqual(csv.rows[4].split(',')[5], '');
  assert.strictEqual(csv.rows[5].split(',')[6], 'unknown');
});

test('Squarespace fixture documentation describes the integration boundary', () => {
  const documentation = fs.readFileSync(
    path.join(DIR, 'README.md'),
    'utf8',
  );

  assert.match(documentation, /Required columns/i);
  assert.match(documentation, /Optional columns/i);
  assert.match(documentation, /Validation errors/i);
  assert.match(documentation, /Privacy and synthetic data/i);
  assert.match(documentation, /API integration versus CSV fallback/i);
  assert.match(documentation, /Storefront scraping/i);
  assert.match(documentation, /Live Squarespace API calls/i);
});
