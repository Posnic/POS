const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { cssReader } = require('./helpers/source-lookup');

/*
 * The settings content must not run off the right-hand edge.
 *
 * Owner report, with screenshots: the Features cards and the Cash Book card
 * both cut off mid-page, with no scrollbar to reach the rest.
 *
 * A FLEX ITEM WILL NOT SHRINK BELOW ITS CONTENT unless told it may - min-width
 * defaults to `auto` on a flex item, which resolves to the content's minimum.
 * The Features grid is `repeat(auto-fill, minmax(290px, 1fr))`, so its minimum
 * is 290px plus gaps; on a narrow window that exceeds the row, the column
 * refuses to shrink, and everything past the edge is simply unreachable.
 *
 * This is the classic flexbox overflow, and it is invisible on a wide screen -
 * which is why it survived until somebody used a smaller window.
 */

const ROOT = path.join(__dirname, '..');
/*
 * Comments are stripped before anything is asserted.
 *
 * The prose explaining this fix contains the words "min-width: 0", so the
 * first version of these tests passed with the declaration deleted - it was
 * matching its own explanation. Found by mutation, which is the only way that
 * kind of pass ever gets found.
 */
const css = fs
  .readFileSync(path.join(ROOT, 'frontend', 'static', 'style', 'css', 'custom.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const cssRule = cssReader(css);
const html = fs.readFileSync(
  path.join(ROOT, 'frontend', 'modules', 'settings_write.html'),
  'utf8',
);

test('the settings content column is allowed to shrink', () => {
  const rule = cssRule('.settings-nav-col + div {');
  assert.match(rule, /min-width:\s*0/, 'the column cannot shrink below its content');
  assert.match(rule, /max-width:\s*100%/);
});

test('the panes inside it can shrink too', () => {
  /* One level down the same trap waits: grids and tables whose min-content
     width exceeds the pane. */
  assert.match(
    css,
    /\.settings-nav-col \+ div \.tab-pane \{ min-width: 0; \}/,
    'tab panes are not allowed to shrink',
  );
});

test('the feature grid narrows rather than overflowing', () => {
  /*
   * min(290px, 100%) is the whole trick: on a narrow screen the track may go
   * below its nominal width instead of forcing the container wider. Two
   * cramped columns are readable; one column off-screen is not.
   */
  assert.match(css, /minmax\(min\(290px, 100%\), 1fr\)/);
});

test('embedded whole-pages are contained', () => {
  /*
   * Cash Book and Cash Register are entire pages dropped into a settings pane.
   * They bring their own #containerbar and page margins, written for a
   * full-width page and never adjusted for sitting in a column.
   */
  /* With the brace, or this also matches the four descendant rules below it. */
  assert.match(cssRule('.config-embedded-page {'), /min-width:\s*0/);
  assert.match(cssRule('.config-embedded-page > #containerbar'), /margin:\s*0/);
});

test('the duplicate containerbar ids are acknowledged, not ignored', () => {
  /*
   * settings_write.html carries three id="containerbar" elements because it
   * embeds two whole pages. That is invalid, and getElementById returns only
   * the first - so anything reaching for it by id is already reading the wrong
   * element. Left alone deliberately: the embedded pages' own scripts look it
   * up, and renaming is a far bigger change than a clipped card justifies.
   *
   * This test exists so the count cannot grow unnoticed.
   */
  const count = (html.match(/id="containerbar"/g) || []).length;
  assert.strictEqual(
    count,
    3,
    `settings_write.html has ${count} elements with id="containerbar". ` +
      'If a page was embedded, contain it in CSS as the others are; if one was ' +
      'removed, lower this number.',
  );
});
