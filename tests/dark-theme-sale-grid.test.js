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
const css = fs
  .readFileSync(path.join(ROOT, 'frontend', 'static', 'style', 'css', 'custom.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const block = (() => {
  const at = css.indexOf('[data-theme] #sales_new .wsk-cp .wsk-cp-product');
  assert.notStrictEqual(at, -1, 'the dark-theme sale grid rules are gone');
  /*
   * Bounded to the sale-grid rules, not to the end of the file.
   *
   * This used to slice to EOF, which made the no-hard-coded-colour check below
   * police every rule anybody appended to custom.css afterwards - a guard about
   * the sale grid failing over a dialog somewhere else. Every rule in this
   * section names #sales_new, so the section ends with the closing brace of the
   * last rule that does.
   */
  const lastRule = css.lastIndexOf('#sales_new');
  assert.ok(lastRule >= at, 'the sale grid rules are gone');
  const close = css.indexOf('}', lastRule);
  assert.notStrictEqual(close, -1, 'the last sale grid rule is unterminated');
  return css.slice(at, close + 1);
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
