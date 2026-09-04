const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'fixtures', 'import-mapping');

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

test('product mapping fixture has the expected varied columns', () => {
  const csv = readCsv('products-varied.csv');

  assert.deepStrictEqual(csv.headers, [
    'Product Name',
    'SKU',
    'Barcode',
    'Category',
    'Vendor',
    'MRP',
    'Cost Price',
    'Rate',
    'GST %',
    'Stock',
    'Unit',
  ]);

  assert.ok(csv.rows.length >= 1);
});

test('customer mapping fixture has the expected varied columns', () => {
  const csv = readCsv('customers-varied.csv');

  assert.deepStrictEqual(csv.headers, [
    'Customer Name',
    'Mobile',
    'Email Address',
    'Billing Address',
  ]);

  assert.ok(csv.rows.length >= 1);
});

test('invalid customer fixture is missing the required billing address column', () => {
  const csv = readCsv('invalid-customers.csv');

  assert.ok(!csv.headers.includes('Billing Address'));
  assert.ok(csv.headers.includes('Customer Name'));
  assert.ok(csv.headers.includes('Mobile'));
  assert.ok(csv.headers.includes('Email Address'));
});

test('expected mapping documentation covers the fixtures', () => {
  const documentation = fs.readFileSync(
    path.join(DIR, 'EXPECTED_MAPPINGS.md'),
    'utf8',
  );

  assert.match(documentation, /Product Name -> name/);
  assert.match(documentation, /SKU -> itemid/);
  assert.match(documentation, /Customer Name -> name/);
  assert.match(documentation, /Mobile -> phone/);
  assert.match(documentation, /Billing Address -> address/);
  assert.match(documentation, /Missing required column: Billing Address/);
});
