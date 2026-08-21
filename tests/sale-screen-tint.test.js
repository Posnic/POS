const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * One meaning per colour on the sale screen (SALE_SCREEN_UX_AUDIT, P2).
 *
 * The owner's answer to "which colour means what" was "you can pick standard
 * stuff", so this is the standard mapping, and it is the same one already
 * shipped when the github theme's green primary button became the blue accent
 * (queue #58): green stopped meaning "main action" so it could mean "succeeded"
 * and nothing else.
 *
 *   red    - destructive, or a required-field marker
 *   green  - succeeded
 *   accent - the main action
 *   grey   - neutral: modes, toggles, secondary controls
 *
 * A colour that means two things means nothing. On a till that costs more than
 * on a website: a cashier reads tint before text, and red on a control that
 * does not destroy anything trains them to ignore red.
 */

const ROOT = path.join(__dirname, '..');
const sale = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'sales_write.html'), 'utf8');

/* The markup for one element, by id. */
const elementFor = (id) => {
  const at = sale.indexOf(`id="${id}"`);
  assert.notStrictEqual(at, -1, `#${id} is not on the sale screen`);
  const start = sale.lastIndexOf('<', at);
  return sale.slice(start, sale.indexOf('>', at) + 1);
};

test('the discount mode toggles are neutral, not destructive', () => {
  /* % and ₹ switch how a discount is EXPRESSED. Nothing is destroyed, so red
     misreads - and it is the colour a cashier needs to trust elsewhere. */
  for (const id of ['percentIcon', 'rupeeIcon']) {
    const el = elementFor(id);
    assert.ok(
      !/text-danger/.test(el),
      `#${id} is red, but switching between percent and rupees destroys nothing`,
    );
    assert.match(el, /text-muted/, `#${id} needs a neutral tint, not no tint at all`);
  }
});

test('the toggles keep the affordance that was doing the work', () => {
  /* The tint was never what said "clickable" - the bordered box and its hover
     border were. Removing the colour must not remove those. */
  const css = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'style', 'css', 'custom.css'),
    'utf8',
  );
  assert.match(css, /\.inline-container \.toggle-icon \{[^}]*border:/, 'the box outline is gone');
  assert.match(css, /\.inline-container \.toggle-icon:hover \{[^}]*border-color:/, 'the hover cue is gone');
  for (const id of ['percentIcon', 'rupeeIcon']) {
    assert.match(elementFor(id), /cursor:\s*pointer/, `#${id} no longer looks clickable`);
  }
});

test('red is still used where red is right', () => {
  /* This is a mapping, not a purge. A required-field asterisk in red is what
     every form on earth does, and removing it would be the opposite mistake. */
  assert.match(
    sale,
    /<span\s+class="text-danger">\*<\/span>/,
    'the required-field marker lost its red - that use is conventional and correct',
  );
});

test('the toggle still works by class, so the tint cannot break it', () => {
  /* Which mode is active is carried by d-none, read in several places as
     `!$('#percentIcon').hasClass('d-none')`. If the tint were ever made
     load-bearing instead, changing a colour would change what gets saved. */
  const salesJs = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js'),
    'utf8',
  );
  assert.match(
    salesJs,
    /!\$\('#percentIcon'\)\.hasClass\('d-none'\)/,
    'the mode must be read from d-none, never from a colour class',
  );
  assert.ok(
    !/percentIcon'\)\.hasClass\('text-/.test(salesJs),
    'a colour class is being read as state - a restyle would change what is saved',
  );
});
