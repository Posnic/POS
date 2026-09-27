'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FIXTURE_PATH = path.join(
  __dirname,
  'fixtures',
  'wix',
  'product-options.json',
);

function readFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

test('Wix fixture contains size and color product options', () => {
  const fixture = readFixture();
  const options = fixture.product.options;

  assert.strictEqual(fixture.provider, 'wix');
  assert.strictEqual(fixture.catalog_version, 'v3');
  assert.strictEqual(fixture.product.name, 'Classic T-Shirt');

  assert.deepStrictEqual(options[0], {
    name: 'Size',
    choices: ['Small', 'Large'],
  });

  assert.deepStrictEqual(options[1], {
    name: 'Color',
    choices: ['Red', 'Blue'],
  });
});

test('Wix fixture contains every size and color combination', () => {
  const fixture = readFixture();
  const variants = fixture.product.variants;

  assert.strictEqual(variants.length, 4);

  const combinations = variants.map(
    (variant) =>
      `${variant.choices.Size} - ${variant.choices.Color}`,
  );

  assert.deepStrictEqual(combinations.sort(), [
    'Large - Blue',
    'Large - Red',
    'Small - Blue',
    'Small - Red',
  ]);
});

test('Wix fixture maps SKU and barcode to Posnic identifiers', () => {
  const fixture = readFixture();

  for (const variant of fixture.product.variants) {
    assert.strictEqual(
      variant.expected_posnic.itemid,
      variant.sku,
    );

    assert.strictEqual(
      variant.expected_posnic.barcode_id,
      variant.barcode,
    );
  }
});
test('Wix variants map option choices to the Posnic variant fields', () => {
  const fixture = readFixture();

  for (const variant of fixture.product.variants) {
    const expectedValue =
      `${variant.choices.Size} - ${variant.choices.Color}`;

    assert.strictEqual(
      variant.expected_posnic.variant_parent_name,
      fixture.product.name,
    );

    assert.strictEqual(
      variant.expected_posnic.variant_axis,
      'Variant',
    );

    assert.strictEqual(
      variant.expected_posnic.variant_value,
      expectedValue,
    );
  }
});

test('Wix fixture covers missing SKU and barcode behavior', () => {
  const fixture = readFixture();

  const missingSku = fixture.product.variants.filter(
    (variant) => variant.sku === null,
  );

  const missingBarcode = fixture.product.variants.filter(
    (variant) => variant.barcode === null,
  );

  assert.strictEqual(missingSku.length, 2);
  assert.strictEqual(missingBarcode.length, 2);

  for (const variant of fixture.product.variants) {
    assert.strictEqual(
      variant.expected_posnic.review,
      variant.sku === null,
    );
  }
});

test('Wix fixture contains only synthetic identifiers', () => {
  const fixture = readFixture();

  assert.match(fixture.product.id, /^SYNTH-WIX-PROD-\d+$/);

  for (const variant of fixture.product.variants) {
    assert.match(variant.id, /^SYNTH-WIX-VAR-\d+$/);

    if (variant.sku !== null) {
      assert.match(variant.sku, /^SYNTH-SKU-\d+$/);
    }

    if (variant.barcode !== null) {
      assert.match(variant.barcode, /^SYNTH-BC-\d+$/);
    }
  }
});

test('Wix fixture documentation describes the integration boundary', () => {
  const documentation = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'wix', 'README.md'),
    'utf8',
  );

  assert.match(documentation, /Official Wix documentation/i);
  assert.match(documentation, /Product options and variants/i);
  assert.match(documentation, /Expected Posnic mapping/i);
  assert.match(documentation, /Missing SKU and barcode behavior/i);
  assert.match(documentation, /Unsupported areas/i);
  assert.match(documentation, /live Wix API calls/i);
  assert.match(documentation, /synthetic/i);
});
