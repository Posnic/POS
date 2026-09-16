'use strict';
/*
 * THE DEMO PHOTOGRAPHS: LICENSED, PRESENT, AND OF THE RIGHT THING.
 *
 * Owner, asked to source pictures for the 22 restaurant dishes: "i cnat do.
 * download from internet."
 *
 * The part that cannot be hand-waved is the licence. These images ship inside
 * a commercial product, to every customer, in every country. A photograph
 * lifted from a search engine is somebody's copyright whatever the intention,
 * so scripts/fetch-demo-images.js takes public-domain and Creative Commons
 * work from Wikimedia Commons only, refuses everything else, and records the
 * author and the licence for every file it keeps.
 *
 * This is the test that the record and the files cannot drift apart: a credit
 * with no file, or a file with no credit, is how attribution quietly stops
 * being true.
 *
 * AND A PRODUCT WITH NO PHOTOGRAPH IS A FINISHED STATE. PosnicPro.autoTile
 * gives it a coloured tile from its own name, which is a real answer on a sale
 * grid. Four of the restaurant dishes have none, because the search returned a
 * leaf-wrapped parcel, a stack of flatbread and a close-up of ribbed plastic -
 * a wrong picture is read as fact, an absent one is read as absent.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const IMAGES = path.join(ROOT, 'frontend', 'static', 'images', 'demo');
const CREDITS = path.join(IMAGES, 'credits.json');

const credits = JSON.parse(fs.readFileSync(CREDITS, 'utf8'));
const demo = require(path.join(ROOT, 'api', 'utils', 'demoData.js'));

/*
 * The licences a commercial product may ship.
 *
 * Public domain and the CC family. Anything with NC (non-commercial) or ND (no
 * derivatives) is refused: this product is sold, and the images are resized,
 * which is a derivative.
 */
const ALLOWED = /^(public domain|cc0|cc by(-sa)?[\s-]?[\d.]*( [a-z]{2})?)$/i;

test('every credit names a file that is really there', () => {
  for (const [key, entry] of Object.entries(credits)) {
    const file = path.join(IMAGES, entry.file.split('/').pop());
    assert.ok(fs.existsSync(file), key + ' is credited but its file is missing: ' + entry.file);
    assert.ok(fs.statSync(file).size > 0, key + ' is an empty file');
  }
});

test('every file on disk is credited, so no picture ships unattributed', () => {
  /* The direction that actually protects somebody: a file nobody recorded is a
     photograph shipping with its author's name lost. */
  const known = new Set(Object.values(credits).map((e) => e.file.split('/').pop()));
  for (const name of fs.readdirSync(IMAGES)) {
    if (!/\.(webp|jpg|jpeg|png)$/i.test(name)) continue;
    assert.ok(known.has(name), name + ' ships with no credit recorded for it');
  }
});

test('every licence is one a sold product may carry', () => {
  for (const [key, entry] of Object.entries(credits)) {
    assert.ok(entry.licence, key + ' has no licence recorded');
    assert.match(
      String(entry.licence),
      ALLOWED,
      key + ' carries a licence this product cannot ship: ' + entry.licence
    );
    /* NC forbids selling it, ND forbids the resize the script performs. */
    assert.doesNotMatch(String(entry.licence), /\bNC\b|\bND\b/i, key + ' is NC or ND');
  }
});

test('every credit names an author and where it came from', () => {
  for (const [key, entry] of Object.entries(credits)) {
    assert.ok(String(entry.author || '').trim(), key + ' has no author');
    assert.ok(/wikimedia|wikipedia/i.test(String(entry.source || '')), key + ' has no source');
  }
});

/* ------------------------------------------------- and the dishes themselves */

test('the restaurant dishes carry the photographs that exist for them', () => {
  const dishes = demo.restaurantDemoData.products;
  assert.strictEqual(dishes.length, 22, 'the restaurant pack changed size');

  const withPhoto = dishes.filter((one) => one.image);
  assert.ok(withPhoto.length >= 18, 'only ' + withPhoto.length + ' dishes have a photograph');

  for (const dish of withPhoto) {
    const file = path.join(IMAGES, dish.image.split('/').pop());
    assert.ok(fs.existsSync(file), dish.name + ' names an image that is not there: ' + dish.image);
  }
});

test('a dish with no photograph is left alone rather than given a wrong one', () => {
  /*
   * Named, so that turning one of these into a picture is a decision somebody
   * makes rather than something a re-run does. The reasons live in
   * scripts/demo-image-rejects.json.
   */
  const rejects = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'scripts', 'demo-image-rejects.json'), 'utf8')
  );
  const without = demo.restaurantDemoData.products.filter((one) => !one.image).map((o) => o.name);

  for (const name of without) {
    const key = 'restaurant-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    assert.ok(
      rejects[key],
      name + ' has no photograph and no recorded reason - a silent gap, not a decision'
    );
    assert.ok(String(rejects[key]).length > 8, key + ' has a reason too short to be one');
  }
});

test('the images are attached from the manifest, never pasted into the products', () => {
  /*
   * A path written into a product literal can name a file that is not there,
   * and a file can sit unused - neither says so. Reading the manifest means
   * the two cannot disagree.
   */
  const source = fs.readFileSync(path.join(ROOT, 'api', 'utils', 'demoData.js'), 'utf8');
  assert.match(source, /restaurant: restaurantDemoData,\s*\n\s*\};/);
  assert.ok(
    !/image:\s*'static\/images\/demo\//.test(source),
    'an image path was pasted into a product literal'
  );
});

test('the fetcher keeps a person in the loop', () => {
  /* Automated search is right most of the time and confidently wrong the rest.
     Both files are what makes the review survive a re-run. */
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'fetch-demo-images.js'), 'utf8');
  assert.match(script, /demo-image-rejects\.json/);
  assert.match(script, /demo-image-terms\.json/);
  assert.match(script, /TERMS\[key\] \|\| searchTerm\(product\.name\)/);
});
