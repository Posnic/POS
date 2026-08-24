const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * The sale grid in a dark theme.
 *
 * Owner report: "vs code and dark themes showing items very weird now. white
 * borders make very bad. all dark theme very weird."
 *
 * TWO CAUSES.
 *
 * The card rules are written as `#sales_new .wsk-cp …` with fixed light
 * colours - white cards, #f0f2f5 hairlines, #1f2328 text - from when the till
 * was light-only. An ID selector outranks the `[data-theme] .wsk-cp-product`
 * rules in theme-variables.css, so a dark theme could never override them,
 * however many themes were added.
 *
 * And product photographs are shot on white. Dropped straight onto a black
 * card they read as glaring white rectangles: the eye sees the paper, not the
 * product.
 */

const ROOT = path.join(__dirname, '..');
/* Comments carry these hex values in their explanations, so they are stripped
   before anything is asserted - the usual trap of matching one's own prose. */
const raw = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'style', 'css', 'custom.css'), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const css = strip(raw);

const block = (() => {
  /*
   * Bounded to the sale-grid section, not to the end of the file.
   *
   * This used to slice to EOF, which made the no-hard-coded-colour check below
   * police every rule anybody appended to custom.css afterwards - a guard about
   * the sale grid failing over a dialog somewhere else. The section ends where
   * the next banner comment starts.
   *
   * Cut from the RAW source, then stripped. Cutting from the stripped copy
   * cannot work: the boundary IS a comment, so nothing is left to cut at and
   * the block silently runs to the end of the file again - which is the exact
   * bug this bounding was added to fix, reintroduced by the fix itself.
   * Bounding by "the last rule mentioning #sales_new" fails too, because later
   * sections legitimately mention it.
   */
  const at = raw.indexOf('[data-theme] #sales_new .wsk-cp .wsk-cp-product');
  assert.notStrictEqual(at, -1, 'the dark-theme sale grid rules are gone');
  const next = raw.indexOf('/* ====', at);
  assert.notStrictEqual(next, -1, 'the sale-grid section has no section after it to end at');
  return strip(raw.slice(at, next));
})();

test('the card follows the theme rather than a fixed white', () => {
  assert.match(block, /background: var\(--theme-card-bg\)/);
  assert.match(block, /border-color: var\(--theme-border-color\)/);
});

test('the hairline under the name follows the theme', () => {
  /* This was the "white border": a #f0f2f5 divider on a black card. */
  assert.match(block, /border-bottom-color: var\(--theme-border-color\)/);
});

test('the name, price and stock all follow the theme', () => {
  assert.match(block, /\.description-prod p \{ color: var\(--theme-text-primary\)/);
  assert.match(block, /\.price-text-color \{ color: var\(--theme-primary-color\)/);
  assert.match(block, /\.wsk-cp-stock \{ color: var\(--theme-text-secondary\)/);
});

test('the overrides can actually win', () => {
  /*
   * The originals are `#sales_new .wsk-cp …`. An override needs at least that
   * specificity - an id, and the same class depth - or it loses silently and
   * looks like the fix was never applied.
   */
  for (const line of block.split('\n').filter((l) => l.startsWith('[data-theme]'))) {
    assert.match(line, /#sales_new/, `override lacks the id and will lose: ${line.trim()}`);
  }
});

test('photographs sit on a plate, and coloured tiles do not', () => {
  /*
   * An item with no photograph renders a coloured letter tile in the same box.
   * A white plate behind that would frame something that needs no framing, so
   * the plate applies only where there is a real image.
   */
  assert.match(css, /\.wsk-cp-img:has\(img\)/, 'the plate is not scoped to real images');
  const plate = css.slice(css.indexOf('#sales_new .wsk-cp .wsk-cp-img:has(img)'));
  assert.match(plate, /border-radius/, 'the plate has hard corners');
  assert.match(plate, /padding/, 'the photograph touches the plate edge');
});

test('dark themes get a softened plate, not a lamp', () => {
  /* Pure white at tile size on an otherwise dark screen is a light source,
     and this till is open all day. */
  assert.match(css, /\[data-theme="dark"\][\s\S]*?background: #e8eaed/);
  for (const t of ['dark', 'terminal', 'dosblue']) {
    assert.ok(css.includes(`[data-theme="${t}"] #sales_new`), `${t} is not covered`);
  }
});

test('the fix is token-based, so a new theme needs no new rule', () => {
  /* One block for every preset, rather than one block per preset - which is
     how this drifted in the first place. */
  const hardCoded = block.match(/#[0-9a-fA-F]{6}/g) || [];
  const allowed = new Set(['#ffffff', '#e8eaed']);
  const stray = hardCoded.filter((h) => !allowed.has(h.toLowerCase()));
  assert.deepStrictEqual(stray, [], `hard-coded colours crept back in: ${stray.join(', ')}`);
});

/*
 * The three surfaces that were STILL light after the cards were fixed.
 *
 * Reported against a screenshot of the sale screen in a dark preset: "new sales
 * dark themes product boxes background color looks light light or gray. it does
 * not suit and not looking good."
 *
 * The cards themselves had been corrected. What had not been touched was
 * everything AROUND and INSIDE them, which between them is most of what the
 * screen actually shows - and each one was a fixed hex written when the till was
 * light-only.
 *
 * These are asserted individually rather than by scanning the section, because
 * the section scan above stops at the next banner comment and would not reach
 * them - a guard that silently covers nothing.
 */
const laterBlock = (() => {
  const at = raw.indexOf('THE THREE THINGS THAT WERE STILL LIGHT');
  assert.notStrictEqual(at, -1, 'the later dark-theme fixes are gone');
  /* Bounded at the next banner, exactly like `block` above and for exactly the
     same reason: slicing to EOF makes the no-hard-coded-colour check below
     police every unrelated section that happens to come after. Written out a
     second time rather than shared, because the two sections end at different
     places and a helper would hide that. */
  const next = raw.indexOf('/* ====', at);
  assert.notStrictEqual(next, -1, 'this section has no section after it to end at');
  return strip(raw.slice(at, next));
})();

test('the canvas behind the tiles follows the theme', () => {
  /*
   * #f6f8fa in every theme: the large pale panel behind and below every tile,
   * and the single biggest light area on a dark sale screen. It kept its light
   * value because the base rule had no dark counterpart at all.
   */
  assert.match(laterBlock, /\[data-theme\] #sales_new \.sale-tile-grid \{ background: var\(--theme-body-bg\); \}/);
});

test('hovering a tile does not put a light box on a dark card', () => {
  /*
   * `.wsk-cp:hover .wsk-cp-img { background: #f6f8fa }` painted a pale grey
   * rectangle behind whatever was in the image slot. Invisible on a card with a
   * photograph - the plate covers it - but on a coloured letter tile it lit up
   * under the pointer, which is exactly where somebody is looking.
   */
  assert.match(laterBlock, /\[data-theme\] #sales_new \.wsk-cp:hover \.wsk-cp-img \{ background: transparent; \}/);
});

test('a real photograph still keeps its plate on hover', () => {
  /*
   * The transparent rule above must NOT win for a card with a photograph, or
   * the white-shot glare it exists to prevent comes straight back on hover.
   * :has(img) carries the specificity of its argument, so the plate rules
   * outrank it - this asserts they are still written that way.
   */
  assert.match(block, /:hover \.wsk-cp-img:has\(img\):not\(\.wsk-cp-img-placeholder\)/);
});

test('EVERY plate selector excludes the placeholder, not just most of them', () => {
  /*
   * There are six of these - the base rule, its hover, and one line per dark
   * preset for each. Asserting that the exclusion appears SOMEWHERE passes with
   * five of the six correct, and the sixth is a preset where the placeholder is
   * still framed. Whoever is using that preset sees it; nobody else does, and
   * nothing reports it.
   *
   * Found by mutation: dropping the exclusion from one selector left this file
   * green.
   */
  const plates = css.match(/\.wsk-cp-img:has\(img\)(:not\(\.wsk-cp-img-placeholder\))?/g) || [];
  assert.ok(plates.length >= 6, `expected every plate selector, found ${plates.length}`);
  const bare = plates.filter((p) => !p.includes(':not('));
  assert.deepStrictEqual(bare, [],
    `${bare.length} plate selector(s) still frame the placeholder`);
});

test('the shipped placeholder is not framed like a photograph', () => {
  /*
   * The plate exists so a product shot on white does not glare against a dark
   * card. The placeholder is a line drawing on transparency, so framing it puts
   * a large pale panel on a tile with nothing to show - four of them were on
   * the reported screen at once.
   */
  assert.match(block, /\.wsk-cp-img:has\(img\):not\(\.wsk-cp-img-placeholder\)/);
  assert.match(laterBlock, /\.wsk-cp-img-placeholder[\s\S]*?background: transparent/);
});

test('the placeholder is excluded by a class, not by sniffing the src', () => {
  /*
   * A rule keyed on "/default/" in the path would one day un-frame a real
   * photograph whose URL happened to contain it, with nothing to say why. The
   * renderer knows which one it drew; it says so.
   */
  const salesJs = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  // Both renderers: the single item and the variant family tile.
  assert.match(salesJs, /_isPlaceholder = getItemdata\[i\]\['image'\] === 'item\.svg'/);
  assert.match(salesJs, /placeholderClass = rows\[0\]\['image'\] === 'item\.svg'/);
  assert.match(salesJs, /wsk-cp-img' \+ \(_isPlaceholder \? ' wsk-cp-img-placeholder' : ''\)/);
  assert.match(salesJs, /wsk-cp-img' \+ placeholderClass/);

  assert.ok(!/wsk-cp-img\[src\*=|src\*="\/default\//.test(laterBlock),
    'the placeholder must not be detected by sniffing the image path');
});

test('the placeholder drawing stays visible on a dark card', () => {
  /* It is dark-on-transparent, so unplating it alone would leave a shape
     nobody can see - which reads as a broken image, not as "no picture". */
  assert.match(laterBlock, /\.wsk-cp-img-placeholder img[\s\S]*?filter: invert\(1\)/);
  assert.match(laterBlock, /opacity: 0\.45/);
});

test('these fixes are token-based or deliberate, not a new set of fixed colours', () => {
  const hardCoded = laterBlock.match(/#[0-9a-fA-F]{6}/g) || [];
  assert.deepStrictEqual(hardCoded, [],
    `the later fixes hard-code colours: ${hardCoded.join(', ')}`);
});
