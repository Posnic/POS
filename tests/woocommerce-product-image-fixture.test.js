
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixtureDir = path.join(
  __dirname,
  'fixtures',
  'woocommerce'
);

function readFixture() {
  return JSON.parse(
    fs.readFileSync(
      path.join(fixtureDir, 'product-images.json'),
      'utf8'
    )
  );
}

test('WooCommerce fixture uses synthetic products and images', () => {
  const fixture = readFixture();

  assert.equal(fixture.provider, 'woocommerce');
  assert.equal(fixture.products.length, 4);

  for (const product of fixture.products) {
    assert.match(product.id, /^SYNTH-WOO-PROD-\d+$/);

    for (const image of product.images) {
      assert.match(image.id, /^SYNTH-WOO-IMG-\d+$/);

      if (image.src !== null) {
        assert.equal(
          new URL(image.src).hostname,
          'example.com'
        );
      }
    }
  }
});

test('primary and gallery image mapping is defined', () => {
  const product = readFixture().products[0];

  assert.deepEqual(
    product.images.map(image => image.expected_role),
    ['primary', 'gallery']
  );

  assert.deepEqual(
    product.images.map(image => image.position),
    [0, 1]
  );

  for (const image of product.images) {
    assert.equal(image.expected_action, 'import_reference');
  }
});

test('missing image references are skipped', () => {
  const product = readFixture().products[1];
  const image = product.images[0];

  assert.equal(image.src, null);
  assert.equal(image.expected_action, 'skip');
});

test('duplicate image references are skipped', () => {
  const product = readFixture().products[2];
  const [first, duplicate] = product.images;

  assert.equal(first.id, duplicate.id);
  assert.equal(first.src, duplicate.src);
  assert.equal(first.expected_action, 'import_reference');
  assert.equal(duplicate.expected_action, 'skip_duplicate');
});

test('oversized image references are flagged for review', () => {
  const fixture = readFixture();
  const image = fixture.products[3].images[0];

  assert.ok(image.size_bytes > fixture.max_image_bytes);
  assert.equal(image.expected_action, 'review_oversized');
});

test('fixture documentation explains integration boundaries', () => {
  const documentation = fs.readFileSync(
    path.join(fixtureDir, 'README.md'),
    'utf8'
  );

  assert.match(documentation, /WooCommerce/i);
  assert.match(documentation, /primary/i);
  assert.match(documentation, /gallery/i);
  assert.match(documentation, /missing/i);
  assert.match(documentation, /duplicate/i);
  assert.match(documentation, /oversized/i);
  assert.match(documentation, /provider-specific/i);
  assert.match(documentation, /synthetic/i);
});
