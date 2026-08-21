const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { cssReader } = require('./helpers/source-lookup');

/*
 * P2, the part that was held back.
 *
 * Queue #98 shipped the tint mapping and stopped there, because the rest is a
 * restyle of the owner's most-guarded screen and was not going to happen
 * unprompted. This is that rest: the dead .seven family, and the outline
 * buttons.
 *
 * The outline rules are the interesting half. They removed the focus ring from
 * every state to be rid of Bootstrap's heavy shadow after a click - a fair
 * thing to want - and took the keyboard's only position signal with it, on a
 * device that is driven by keyboard.
 */

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'style', 'css', 'custom.css'),
  'utf8',
);
const theme = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'style', 'css', 'theme-variables.css'),
  'utf8',
);
const cssRule = cssReader(css);

test('the dead .seven family is gone, both themes', () => {
  /* A print button in the CSS named colour `darkblue`, belonging to no palette
     and following no theme, worn by nothing. A dead RULE costs nothing at
     runtime, which is exactly why it survives - but it still claims the print
     button looks like this, and no print button has for a long time. */
  assert.ok(!/^\.seven\b/m.test(css), '.seven is back in custom.css');
  assert.ok(!/\.seven:hover/.test(css), 'the .seven hover survived');
  assert.ok(
    !/\[data-theme="dark"\]\s*\.seven/.test(theme),
    'the dark override for a rule that no longer exists survived - worse than either alone',
  );
  // and nothing may start wearing it again
  const markupDirs = ['modules', 'modals', 'layouts'];
  for (const dir of markupDirs) {
    const base = path.join(ROOT, 'frontend', dir);
    if (!fs.existsSync(base)) continue;
    for (const f of fs.readdirSync(base).filter((n) => n.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(base, f), 'utf8');
      assert.ok(
        !/class="(?:[^"]*\s)?seven(?:\s[^"]*)?"/.test(html),
        `${dir}/${f} wears .seven, which no longer has a rule`,
      );
    }
  }
});

test('one rule covers every outline button, not three covering some', () => {
  /* secondary, danger and primary each had their own identical rule; the sale
     screen also uses outline-success and outline-info, which got neither. */
  for (const variant of ['secondary', 'danger', 'primary']) {
    assert.ok(
      !new RegExp(`^\\.btn-outline-${variant}\\s*\\{`, 'm').test(css),
      `.btn-outline-${variant} still has its own copy of the shared rule`,
    );
  }
  const shared = cssRule('[class*="btn-outline-"] {');
  assert.match(shared, /box-shadow:\s*none/, 'the resting state is not quietened');
});

test('the keyboard keeps its focus ring', () => {
  /* This is a till. It is driven tab by tab, and a control you cannot see the
     focus on is one you cannot safely press. */
  const visible = cssRule('[class*="btn-outline-"]:focus-visible {');
  assert.match(visible, /outline:\s*2px/, 'keyboard focus draws no ring');
  assert.match(visible, /outline-offset/, 'the ring sits on the border and is hard to see');
  assert.ok(
    !/outline:\s*none/.test(visible),
    'the focus-visible rule removes the very ring it exists to draw',
  );

  /* And the mouse still gets the clean look the old rules wanted - that is
     what makes this an improvement rather than a reversal. */
  const mouse = cssRule('[class*="btn-outline-"]:focus:not(:focus-visible) {');
  assert.match(mouse, /outline:\s*none/, 'a click brings back the heavy focus ring');
});

test('the ring follows the theme instead of naming a colour', () => {
  /* darkblue is what .seven did, and why it could not follow a theme. */
  const visible = cssRule('[class*="btn-outline-"]:focus-visible {');
  assert.match(visible, /var\(--theme-[a-z-]+/, 'the ring colour is hardcoded');
  assert.match(visible, /var\([^)]*,\s*#/, 'no fallback - the ring vanishes if the token is missing');
});
