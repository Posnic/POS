'use strict';

/*
 * What fits on a kitchen screen, and why nobody guesses it right.
 *
 * Owner, asked how far the cook stands from the screen: "around 5 meter."
 *
 * The research this was built from was worked out at 2.5 metres, and five is
 * not "a bit further" - it is a different machine. Legibility depends on how
 * large a letter is ON THE EYE, so doubling the distance doubles the required
 * letter height, and that costs area in BOTH directions:
 *
 *     DOUBLE THE DISTANCE, QUARTER THE ORDERS.
 *
 * That is the single most surprising thing about these screens, and the reason
 * the fit is computed rather than left to whoever writes the CSS. A shop that
 * mounts a 43 inch television five metres from the range gets two orders on it
 * and finds out after paying for the mount.
 *
 * Owner: "make everthing configurable pleaes... dont make everthing fixed."
 * So every constant here has a default and every default can be overridden -
 * including the visual angle, which is the one a shop with older staff or a
 * steamier kitchen would actually want to change.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { fit, advice, panelMm, verdictFor } = require(path.join(ROOT, 'src', 'kitchen-screen-fit.js'));

/* ------------------------------------------------------------- the optics */

test('THE TEXT DOUBLES WHEN THE DISTANCE DOUBLES', () => {
  /* The rule everything else follows from. If this ever stops being true the
     arithmetic has been broken, not tuned. */
  const near = fit({ distanceM: 2.5 });
  const far = fit({ distanceM: 5 });
  assert.ok(
    Math.abs(far.capHeightMm / near.capHeightMm - 2) < 0.01,
    `expected twice the cap height, got ${near.capHeightMm} -> ${far.capHeightMm}`
  );
});

test('AND THAT QUARTERS WHAT FITS, which is what nobody expects', () => {
  const near = fit({ distanceM: 2.5 });
  const far = fit({ distanceM: 5 });
  assert.ok(
    far.cards <= near.cards / 3,
    `43 inches at 5 m should show far fewer than at 2.5 m: ${near.cards} -> ${far.cards}`
  );
});

test("the owner's own kitchen: 43 inches at five metres is not usable", () => {
  /*
   * The number that changes the hardware decision. Two orders is not a kitchen
   * display, and saying so before a television is mounted is the whole point of
   * this module.
   */
  const f = fit({ diagonalInches: 43, distanceM: 5 });
  assert.ok(f.cards <= 3, `expected about two orders, got ${f.cards}`);
  assert.strictEqual(f.verdict, 'unusable');
});

test('a bigger screen at the same distance buys it back', () => {
  const small = fit({ diagonalInches: 43, distanceM: 5 });
  const big = fit({ diagonalInches: 75, distanceM: 5 });
  assert.ok(big.cards >= 8, `75 inches at 5 m should be comfortable, got ${big.cards}`);
  assert.ok(big.cards > small.cards);
  /* The letters are the same physical size on both. Only the room around them
     changed - which is the correct way round and worth pinning. */
  assert.strictEqual(big.capHeightMm, small.capHeightMm);
});

test('A SHARPER SCREEN BUYS NOTHING, and people always ask', () => {
  /*
   * The most common wrong instinct. A 4K panel of the same physical size has
   * the same letter height; the pixels are smaller and so is every letter drawn
   * in them. If this ever passes by accident, somebody has started sizing text
   * in pixels instead of millimetres.
   */
  const hd = fit({ diagonalInches: 43, distanceM: 5, widthPx: 1920, heightPx: 1080 });
  const uhd = fit({ diagonalInches: 43, distanceM: 5, widthPx: 3840, heightPx: 2160 });
  assert.strictEqual(uhd.cards, hd.cards, '4K changed how much fits, which is impossible');
  assert.strictEqual(uhd.capHeightMm, hd.capHeightMm);
  /* In pixels it IS bigger, because the pixels are smaller. Both are true. */
  assert.ok(uhd.fontPx > hd.fontPx);
});

/* --------------------------------------------------- everything configurable */

test('the visual angle is a setting, not a constant in someone head', () => {
  /* The one a real shop would change: older staff, more steam, a darker room. */
  const normal = fit({ distanceM: 3, targetArcmin: 20 });
  const larger = fit({ distanceM: 3, targetArcmin: 30 });
  assert.ok(larger.fontPx > normal.fontPx, 'asking for bigger text did nothing');
  assert.ok(larger.cards < normal.cards, 'bigger text must cost orders, or it is not real');
});

test('so are the safe area, the name length and the card depth', () => {
  const base = { diagonalInches: 55, distanceM: 3 };
  assert.ok(fit({ ...base, safeArea: 0.1 }).cards <= fit({ ...base, safeArea: 0 }).cards);
  assert.ok(fit({ ...base, nameChars: 30 }).columns <= fit({ ...base, nameChars: 10 }).columns);
  assert.ok(fit({ ...base, cardLines: 10 }).rows <= fit({ ...base, cardLines: 3 }).rows);
});

test('compact cards trade detail for count at the same text size', () => {
  const full = fit({ diagonalInches: 43, distanceM: 5 });
  const compact = fit({ diagonalInches: 43, distanceM: 5, compact: true });
  assert.ok(compact.cards > full.cards, 'compact showed no more orders');
  assert.strictEqual(
    compact.fontPx,
    full.fontPx,
    'compact shrank the text, which is the one thing it must never do'
  );
});

/* ------------------------------------------------------------ the geometry */

test('a rotated or ultrawide panel is measured, not assumed to be 16:9', () => {
  const wide = panelMm({ diagonalInches: 43, widthPx: 1920, heightPx: 1080 });
  const portrait = panelMm({ diagonalInches: 43, widthPx: 1080, heightPx: 1920 });
  assert.ok(portrait.heightMm > portrait.widthMm, 'a portrait screen came out landscape');
  assert.ok(Math.abs(wide.widthMm - portrait.heightMm) < 1, 'the same panel measured differently');
});

test('a 43 inch 16:9 panel is about 952 by 535 mm', () => {
  /* A known answer, so a sign error in the diagonal maths cannot hide behind
     numbers that merely look plausible. */
  const p = panelMm({ diagonalInches: 43, widthPx: 1920, heightPx: 1080 });
  assert.ok(Math.abs(p.widthMm - 952) < 3, `width was ${p.widthMm}`);
  assert.ok(Math.abs(p.heightMm - 535) < 3, `height was ${p.heightMm}`);
});

/* ---------------------------------------------------------------- the advice */

test('a bad answer comes with something a shop can do this afternoon', () => {
  const said = advice({ diagonalInches: 43, distanceM: 5 });
  const kinds = said.map((a) => a.kind);
  assert.ok(kinds.includes('move-closer'), 'never suggested the cheapest fix');
  assert.ok(kinds.includes('bigger-screen'));
  assert.ok(kinds.includes('not-resolution'), 'left the 4K instinct uncorrected');

  const closer = said.find((a) => a.kind === 'move-closer');
  assert.ok(closer.distanceM < 5 && closer.distanceM >= 1.5);
  const bigger = said.find((a) => a.kind === 'bigger-screen');
  assert.ok(bigger.diagonalInches > 43);

  /* And the advice has to be true: taking it must actually work. */
  assert.ok(fit({ diagonalInches: bigger.diagonalInches, distanceM: 5 }).cards >= 8,
    'the screen it recommended does not actually fit eight orders');
  assert.ok(fit({ diagonalInches: 43, distanceM: closer.distanceM }).cards >= 8,
    'the distance it recommended does not actually fit eight orders');
});

test('a screen that already works is told nothing', () => {
  assert.deepStrictEqual(advice({ diagonalInches: 43, distanceM: 2.5 }), []);
});

test('the verdict is words, because 6 means nothing on its own', () => {
  assert.strictEqual(verdictFor(12), 'comfortable');
  assert.strictEqual(verdictFor(6), 'tight');
  assert.strictEqual(verdictFor(2), 'unusable');
  assert.strictEqual(verdictFor(0), 'impossible');
});

test('nonsense input does not produce a confident wrong answer', () => {
  /* A settings field is a text box and somebody will empty it. */
  for (const bad of [{ distanceM: 0 }, { distanceM: -3 }, { diagonalInches: null }, {}]) {
    const f = fit(bad);
    assert.ok(Number.isFinite(f.fontPx) && f.fontPx > 0, `font was ${f.fontPx} for ${JSON.stringify(bad)}`);
    assert.ok(f.cards >= 0);
  }
});
