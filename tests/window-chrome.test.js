const test = require('node:test');
const assert = require('node:assert');

const { chromeFor, luminance, contrast, CHROME_FALLBACK, MIN_ICON_CONTRAST } =
  require('../window-chrome');

/*
 * The window controls have to stay visible on whatever the shop picked.
 *
 * A shop can choose any colours it likes, including combinations nobody would
 * choose deliberately, and the minimise/maximise/close glyphs are drawn by
 * Windows on top of them. Getting this wrong does not throw and does not fail a
 * build: it produces a close button somebody cannot see, on a counter, in
 * daylight. So the rule is checked rather than trusted.
 */

test('luminance follows the eye, not the arithmetic mean', () => {
  // Pure green reads far lighter than pure blue at identical channel values;
  // an averaging formula would call them the same and put black on both.
  assert.ok(luminance('#00ff00') > luminance('#0000ff') * 5);
  assert.strictEqual(Math.round(luminance('#ffffff') * 100) / 100, 1);
  assert.strictEqual(luminance('#000000'), 0);
});

test('contrast matches the known extremes', () => {
  assert.strictEqual(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.strictEqual(Math.round(contrast('#777777', '#777777')), 1);
});

test('the bar takes the shop top bar, so the two read as one surface', () => {
  const c = chromeFor({ topbarBg: '#21252b', bodyBg: '#282c34', textPrimary: '#ffffff' });
  assert.strictEqual(c.color, '#21252b');
  assert.strictEqual(c.background, '#282c34');
});

test("the shop's own text colour is used when it is legible", () => {
  // Matching the app looks deliberate in a way a generic grey does not.
  const c = chromeFor({ topbarBg: '#21252b', textPrimary: '#e0e0e0' });
  assert.strictEqual(c.symbolColor, '#e0e0e0');
  assert.ok(contrast(c.color, c.symbolColor) >= MIN_ICON_CONTRAST);
});

test('an illegible text colour is overridden rather than honoured', () => {
  // Dark grey text on a near-black bar is a close button nobody can find.
  const c = chromeFor({ topbarBg: '#21252b', textPrimary: '#2a2e34' });
  assert.notStrictEqual(c.symbolColor, '#2a2e34');
  assert.ok(contrast(c.color, c.symbolColor) >= MIN_ICON_CONTRAST);
});

test('every preset in the app clears the icon contrast minimum', () => {
  /*
   * The real test. These are the themes a shop can actually pick, run through
   * the same function the window uses, and each one has to produce controls
   * that meet WCAG 2.1's 3:1 for non-text.
   */
  const presets = {
    default:   { topbarBg: '#ffffff', bodyBg: '#f2f3f7', textPrimary: '#000000' },
    dark:      { topbarBg: '#1e1e2d', bodyBg: '#151521', textPrimary: '#ffffff' },
    onedark:   { topbarBg: '#21252b', bodyBg: '#282c34', textPrimary: '#ffffff' },
    material:  { topbarBg: '#263238', bodyBg: '#1e272c', textPrimary: '#ffffff' },
    midnight:  { topbarBg: '#0f1420', bodyBg: '#0b0f18', textPrimary: '#e8ecf5' },
    solarized: { topbarBg: '#073642', bodyBg: '#002b36', textPrimary: '#eee8d5' },
    light:     { topbarBg: '#ffffff', bodyBg: '#fafafa', textPrimary: '#212121' },
  };

  for (const [name, theme] of Object.entries(presets)) {
    const c = chromeFor(theme);
    const ratio = contrast(c.color, c.symbolColor);
    assert.ok(ratio >= MIN_ICON_CONTRAST,
      `${name}: window controls at ${ratio.toFixed(2)}:1 on ${c.color}`);
  }
});

test('a mid-grey bar, which defeats both defaults, still gets legible controls', () => {
  // #808080 is the awkward one: near-white and near-black both sit close to
  // the 3:1 line, so the fallback has to have a fallback.
  for (const bar of ['#808080', '#7f7f7f', '#999999', '#6b6b6b']) {
    const c = chromeFor({ topbarBg: bar });
    const ratio = contrast(c.color, c.symbolColor);
    assert.ok(ratio >= MIN_ICON_CONTRAST,
      `${bar}: controls at only ${ratio.toFixed(2)}:1`);
  }
});

test('nonsense in gives the safe default out, never a crash', () => {
  // This runs on every theme change, including from a settings record written
  // by an older version. A bad colour must not be able to stop the app.
  for (const bad of [undefined, null, {}, { topbarBg: 'rebeccapurple' },
    { topbarBg: '#12' }, { topbarBg: 12345 }, { topbarBg: '#zzzzzz' }]) {
    const c = chromeFor(bad || {});
    assert.strictEqual(c.color, CHROME_FALLBACK.color);
    assert.ok(contrast(c.color, c.symbolColor) >= MIN_ICON_CONTRAST);
  }
});

test('colours are normalised, because Windows wants a leading hash', () => {
  const c = chromeFor({ topbarBg: '21252B', bodyBg: 'FFFFFF', textPrimary: 'FFFFFF' });
  assert.strictEqual(c.color, '#21252b');
  assert.strictEqual(c.background, '#ffffff');
  assert.ok(c.symbolColor.startsWith('#'));
});

test('the window paint follows the page, not the bar', () => {
  // It is the larger area and the one the eye settles on during the instant
  // between the window appearing and the page drawing.
  const c = chromeFor({ topbarBg: '#21252b', bodyBg: '#282c34' });
  assert.strictEqual(c.background, '#282c34');

  // With no page colour given, the bar is a better guess than white.
  assert.strictEqual(chromeFor({ topbarBg: '#21252b' }).background, '#21252b');
});

/*
 * The three buttons the page draws for itself.
 *
 * Windows used to draw these. It painted them into its own overlay surface,
 * which never matched the title bar's colour no matter what hex it was handed,
 * so the page took the job over and the overlay was removed. Which means their
 * appearance is now ours to get wrong, and it was: the minimise bar shipped as
 * a black line on a dark title bar while maximise and close were correctly
 * white, because an SVG shape with no fill defaults to black and only those two
 * were drawn with stroke.
 */
const fs = require('node:fs');
const path = require('node:path');

const CORE = fs.readFileSync(
  path.join(__dirname, '..', 'frontend/static/script/js/core/PosnicPro.js'), 'utf8');

/* The button definitions, as the page builds them. */
function controlShapes() {
  const block = CORE.slice(CORE.indexOf("controls.className = 'posnic-window-controls'"));
  const defs = block.slice(0, block.indexOf('];'));
  const out = [];
  const rx = /\{\s*name:\s*'(\w+)'[\s\S]*?path:\s*'([^']+)'/g;
  let m;
  while ((m = rx.exec(defs)) !== null) out.push({ name: m[1], svg: m[2] });
  return out;
}

test('the page draws all three window buttons', () => {
  assert.deepStrictEqual(controlShapes().map((c) => c.name),
    ['minimize', 'maximize', 'close']);
});

test('every button icon takes its colour from the title bar text', () => {
  /* Not "looks white": the title bar follows the shop's theme, so the icons
     have to follow the text colour rather than any fixed value. What must
     never happen is a shape falling through to the SVG default of black. */
  for (const { name, svg } of controlShapes()) {
    const shapes = svg.match(/<(rect|path|line|polygon|circle)\b[^>]*>/g) || [];
    assert.ok(shapes.length > 0, `${name} has no drawable shape`);

    for (const shape of shapes) {
      const fill = (shape.match(/fill="([^"]*)"/) || [])[1];
      const stroke = (shape.match(/stroke="([^"]*)"/) || [])[1];

      const painted =
        fill === 'currentColor' ? 'fill'
        : (stroke === 'currentColor' && (fill === 'none' || fill === undefined)) ? 'stroke'
        : null;

      assert.ok(painted,
        `${name}: ${shape} is neither filled nor stroked with currentColor. ` +
        `An SVG shape with no fill defaults to black, which is invisible on a ` +
        `dark title bar - this is exactly how the minimise icon shipped dark.`);

      /* A shape relying on stroke must say so, or it draws as a filled blob. */
      if (painted === 'stroke') {
        assert.strictEqual(fill, 'none',
          `${name}: ${shape} strokes in currentColor but does not set fill="none"`);
      }
    }
  }
});

test('the rail marks the current section with a highlight and nothing else', () => {
  /* A rotated square once sat at the rail's right edge as a "notch". On screen
     it read as an arrow pointing away from the icon. The bar and wash stay. */
  const scss = fs.readFileSync(
    path.join(__dirname, '..', 'frontend/static/style/scss/_custom-general.scss'), 'utf8');

  assert.ok(!/\.nav-link\.active:before\s*\{[^}]*rotate\(45deg\)/.test(scss),
    'the rotated-square arrow is back on the icon rail');

  assert.match(scss, /inset 3px 0 0 rgba\(255,\s*255,\s*255,\s*\.95\)/,
    'the white leading-edge bar is the marker and must stay');
});
