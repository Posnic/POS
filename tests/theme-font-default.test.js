const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { blockAt, stripComments } = require('./helpers/source-lookup');

/*
 * The font a shop gets before it has chosen anything.
 *
 * Owner report, twice: "default theme font getting applied after i go to theme
 * page and apply default theme. otherwise by default its not getting applied."
 *
 * The font was never missing. It was being CHANGED. theme-variables.css ships
 * a DM Sans / system stack at weight 400; themeManager wrote out its own copy
 * of that default - 'Mukta Vaani' at weight 300 - and the two had drifted a
 * whole typeface apart. So a fresh login rendered with the stylesheet's font,
 * and pressing Default in the picker replaced it with the JS one.
 *
 * Two defaults for one thing is the bug. Nobody can see both at once.
 */

const ROOT = path.join(__dirname, '..');
const themeJs = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'themeManager.js'),
  'utf8',
);
const css = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'style', 'css', 'theme-variables.css'),
  'utf8',
);

const cssVar = (name) => {
  const m = css.match(new RegExp('--' + name + ':\s*([^;]+);'));
  assert.ok(m, `--${name} is not declared in theme-variables.css`);
  return m[1].trim();
};

test('the shipped font is read from the stylesheet, not restated', () => {
  /* One source of truth. Whoever edits the CSS should not have to know this
     file exists. */
  assert.match(themeJs, /readShippedFont: function/, 'nothing reads the stylesheet');
  const fn = blockAt(stripComments(themeJs), 'readShippedFont: function ()');
  for (const v of ['--theme-font-family', '--theme-font-weight', '--theme-font-size-base']) {
    assert.ok(fn.includes(v), `${v} is not read back`);
  }
});

test('it runs before any default can be read', () => {
  /* Reading it after the first applyTheme would leave the first paint on the
     stale value, which is the entire complaint. */
  const init = blockAt(stripComments(themeJs), 'init: function()');
  const at = init.indexOf('readShippedFont()');
  assert.notStrictEqual(at, -1, 'init never reads the shipped font');
  assert.ok(at < init.indexOf('applyTheme'), 'the font is read after the theme is applied');
});

test('the hard-coded fallback agrees with the stylesheet', () => {
  /*
   * It only applies when the stylesheet failed to load - but if it disagrees,
   * that rare case reintroduces exactly this bug, and nobody would be looking.
   */
  const defaults = blockAt(stripComments(themeJs), 'defaults: {');

  const cssFamily = cssVar('theme-font-family');
  const firstFace = cssFamily.split(',')[0].trim();
  assert.ok(
    defaults.includes(firstFace),
    `the JS fallback does not start with ${firstFace}, which the stylesheet ships`,
  );

  const cssWeight = cssVar('theme-font-weight');
  assert.match(
    defaults,
    new RegExp("fontWeight: '" + cssWeight + "'"),
    `the JS fallback weight disagrees with the stylesheet's ${cssWeight}`,
  );
});

test('Mukta Vaani is no longer the JS default', () => {
  /* The specific value that was overwriting the shipped font. It survives in
     the CSS stack as a late fallback, which is correct - it must simply not be
     what the picker writes as "default". */
  const defaults = blockAt(stripComments(themeJs), 'defaults: {');
  assert.doesNotMatch(defaults, /fontFamily: "'Mukta Vaani'/);
});

test('a stylesheet that cannot be read does not break the theme', () => {
  const fn = blockAt(stripComments(themeJs), 'readShippedFont: function ()');
  assert.match(fn, /try \{/, 'the read is unguarded');
  assert.match(fn, /catch/, 'a failure would throw out of init');
});

test('the size is stored without its unit', () => {
  /* CSS declares 16px; the manager stores '16' and re-adds the unit from
     tokenMap. Storing '16px' would produce '16pxpx'. */
  const fn = blockAt(stripComments(themeJs), 'readShippedFont: function ()');
  assert.match(fn, /parseInt\(size, 10\)/);
});
