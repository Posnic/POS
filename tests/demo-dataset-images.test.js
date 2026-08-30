'use strict';

/*
 * Staging the demo photographs once, not once per currency.
 *
 * MEASURED, not assumed. Across six currencies of the retail dataset:
 *
 *   252 image slots, 42 distinct images - every photograph byte-identical
 *   3.0MB of images against 472KB of JSON, per trade
 *   the whole published library: 8.8GB
 *
 * The images were staged under the dataset id - "GBP-retail-v1",
 * "INR-retail-v1" - so a box serving shops in six countries held six copies of
 * the same tin of tomatoes, and every install paid 3MB to write bytes that
 * were already on the disk beside it.
 *
 * This is also the answer to "would a direct database import be faster": the
 * documents are ~200KB and writing them is already milliseconds. The images
 * are 85% of the payload, and the way to make them fast is not to write them.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { imageSetKey } = require('../api/src/services/demo-dataset.js');
const source = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'src', 'services', 'demo-dataset.js'), 'utf8');

const imgs = (...ids) => new Map(ids.map((i) => [i, {}]));

test('the same photographs share one directory, whatever the currency', () => {
  /* The point: INR-retail and GBP-retail carry identical images, so the second
     one to install writes nothing. */
  assert.strictEqual(imageSetKey('retail', imgs('a', 'b', 'c')),
                     imageSetKey('retail', imgs('c', 'a', 'b')),
    'the key depends on the order the zip happened to list its entries');
});

test('a different trade never shares with another', () => {
  assert.notStrictEqual(imageSetKey('retail', imgs('a', 'b')),
                        imageSetKey('bakery', imgs('a', 'b')));
});

test('a currency that ships its own photographs gets its own directory', () => {
  /*
   * The assumption "every currency uses the same pictures" holds today and
   * would hold until somebody uploaded a localized product shot, at which
   * point every other country would quietly get it. Keying on the image set
   * means sharing happens because the sets are identical, not because we
   * decided they always would be.
   */
  assert.notStrictEqual(imageSetKey('retail', imgs('a', 'b')),
                        imageSetKey('retail', imgs('a', 'z')));
});

test('the key is safe as a directory name', () => {
  /*
   * The trade comes from a manifest fetched over the network. What makes a
   * key safe is that it cannot contain a separator and cannot BE a traversal
   * component - dots inside a name are harmless, and the appended hash means
   * the key can never be exactly ".." or ".".
   */
  const key = imageSetKey('../../etc/passwd', imgs('a'));
  assert.match(key, /^[A-Za-z0-9._-]+$/, key);
  assert.ok(!key.includes('/') && !key.includes('\\'), key);
  assert.ok(key !== '..' && key !== '.', key);
  assert.match(key, /-[0-9a-f]{12}$/, 'the hash suffix is what makes "." impossible');
});

test('nothing is keyed by the dataset id any more', () => {
  /* datasetId carries the currency - "GBP-retail-v1" - which is exactly what
     made every currency stage its own copy. */
  assert.ok(!/stageImages\(String\(manifest\.datasetId/.test(source),
    'images are still staged per currency');
  assert.match(source, /stageImages\(imageSetKey\(trade, images\), images, uploadsRoot\)/);
});

test('an image already on disk is never rewritten', () => {
  /* The saving only exists if the second install skips the write. */
  assert.match(source, /if \(!fs\.existsSync\(file\)\) \{/);
});

test('images failing never costs the shop its products', () => {
  /* They are the garnish. A photograph that will not stage must not be the
     reason a demo has no stock. */
  const block = source.slice(source.indexOf('staged = await stageImages'), source.indexOf('return toPack'));
  assert.match(block, /catch \(e\)/);
  assert.match(block, /Images are the garnish/);
});
