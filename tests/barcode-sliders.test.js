/*
 * The barcode designer's sliders must never be able to kill the boot.
 *
 * Owner, with the watchdog card on every refresh of one shop: "page keeps
 * crashing. every time page refresh" - and the card named it: "Cannot read
 * properties of null (reading 'offsetWidth')". rangeslider measures its
 * input by walking parentNodes until a visible ancestor; a DETACHED input
 * walks off the document into null. Registering every slider at
 * module-ready also armed the plugin's window-resize re-measure for the
 * whole session, over inputs whose panel the SPA may rebuild.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const js = strip(fs.readFileSync(
  path.join(__dirname, '..', 'frontend/static/script/js/modules/js/items.js'), 'utf8'));

test('sliders initialise lazily, never at module-ready', () => {
  /* At ready the designer is closed and its panel may be mid-rebuild; on
     open the inputs exist and are attached, and a shop that never opens the
     designer never runs any of this. */
  const init = js.slice(js.indexOf('initBarcodeSliders = function'), js.indexOf("$(document).on('click focusin'"));
  assert.match(init, /_barcodeSlidersReady/);
  assert.match(init, /document\.contains\(this\)/);
  assert.match(init, /try \{/);
  assert.match(js, /'#barcode-container, \.slider-container'/);

  // and no bare ready-time registration remains
  const bare = js.match(/\$\('\.range-type'\)\.rangeslider\(\{/g) || [];
  assert.strictEqual(bare.length, 0, 'a ready-time rangeslider registration is back');
});

test("the preset loader's five updates are guarded the same way", () => {
  /* 'update' re-measures through the same hidden-parent walk, and the preset
     load can land after a page swap. */
  const upd = js.slice(js.indexOf("[['#bar-height'"), js.indexOf("[['#bar-height'") + 700);
  assert.match(upd, /document\.contains\(\$el\[0\]\)/);
  assert.match(upd, /_barcodeSlidersReady/);
  assert.match(upd, /try \{ \$el\.rangeslider\('update', true\); \}/);
});
