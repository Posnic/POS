'use strict';

/*
 * A FEATURES CARD IS A SWITCH.
 *
 * The Features list is a row of them. A shopkeeper scans it to see what is on
 * and what is off, and that is the only question it answers. A card that also
 * carries a dropdown, a text field and a Save button is twice the height of
 * its neighbours, breaks the grid it sits in, and makes the person looking for
 * "is Captain on" read past a form to find out.
 *
 * This is stated as prose in AGENTS.md and asserted here, because the mistake
 * was made three times in one afternoon by somebody who had already been told:
 * first under Integrations (filing a thing by how it is BUILT rather than by
 * what it IS), then inside the Captain App card, and it was caught because the
 * card looked wrong on a screenshot rather than because anything failed.
 *
 * A rule nobody can breach by accident is worth more than a rule everybody
 * agrees with.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend', 'modules', 'settings_write.html'), 'utf8');

/** The Features tab's markup, on its own. */
function featuresPane() {
  const start = html.indexOf('id="v-pills-modules"');
  assert.ok(start > -1, 'the Features tab has been renamed - update this test with it');

  /* To the next tab pane, which is where this one certainly ends. */
  const next = html.indexOf('class="tab-pane fade"', start);
  return html.slice(start, next > start ? next : html.length);
}

/**
 * Every module CARD, separately.
 *
 * The cards rather than the whole pane, because the pane also carries the
 * list's own chrome - a branch picker and a search box - and those are
 * navigation for the list, not settings of anything in it. Scoping to the
 * cards is also the rule stated exactly: it is the CARD that must stay a
 * switch.
 *
 * Sliced by nesting depth rather than by the next closing tag, so a card that
 * grows an inner div is still measured to its real end instead of to the first
 * </div> inside it.
 */
function moduleCards() {
  const pane = featuresPane();
  const cards = [];
  let from = 0;

  for (;;) {
    const marker = pane.indexOf('class="module-card"', from);
    if (marker === -1) break;
    const open = pane.lastIndexOf('<div', marker);

    let depth = 0;
    let at = open;
    let end = pane.length;
    while (at < pane.length) {
      const nextOpen = pane.indexOf('<div', at);
      const nextClose = pane.indexOf('</div>', at);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        at = nextOpen + 4;
      } else {
        depth -= 1;
        at = nextClose + 6;
        if (depth === 0) {
          end = at;
          break;
        }
      }
    }
    cards.push(pane.slice(open, end));
    from = end;
  }

  assert.ok(cards.length > 5, 'no module cards were found - has the markup changed shape?');
  return cards;
}

const titleOf = (card) => {
  const found = card.match(/class="module-title"[\s\S]*?>([^<]+)</);
  return found ? found[1].trim() : 'an unnamed card';
};

/* A control that asks a question, as opposed to a switch that answers one.
   Checkboxes and their labels are what the list IS, so they are not here. */
const CONTROLS = [
  ['<select', 'a dropdown'],
  ['<textarea', 'a text box'],
  ['type="text"', 'a text field'],
  ['type="password"', 'a password field'],
  ['type="number"', 'a number field'],
  ['type="email"', 'an email field'],
];

test('no control that asks a question lives in a module card', () => {
  const offenders = [];
  for (const card of moduleCards()) {
    const found = CONTROLS.filter(([needle]) => card.includes(needle)).map(([, name]) => name);
    if (found.length) offenders.push(`${titleOf(card)} (${found.join(', ')})`);
  }

  assert.deepEqual(
    offenders,
    [],
    `A Features card is a switch, and these now carry a form: ${offenders.join('; ')}. ` +
      'Put the setting on the module page instead - see "Where a setting goes" in AGENTS.md.'
  );
});

test('no Save button lives in a module card', () => {
  /* A switch saves itself. A Save button means a form got in, and a form in a
     row of switches is the shape of the mistake this file exists to stop. */
  for (const card of moduleCards()) {
    assert.ok(
      !/<button[^>]*id="[a-z_]*save"/i.test(card),
      `A Save button appeared in the ${titleOf(card)} card. Settings belong on the module page.`
    );
  }
});

test('a card is still a switch and a description', () => {
  /* The other half of the rule: this list must not be emptied out either. It
     is how a shopkeeper turns a module on, and that has to stay here. */
  const pane = featuresPane();
  assert.ok(pane.includes('module_captain_enable'), 'the Captain App switch has gone missing');
  assert.ok(pane.includes('module_kiosk_enable'), 'the Kiosk switch has gone missing');
  assert.ok(pane.includes('class="module-desc"'), 'the cards have lost their descriptions');
});

test('the rule is written down where a contributor will read it', () => {
  /* A test that fails with no explanation teaches nothing. The prose and the
     assertion have to travel together. */
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Where a setting goes/);
  assert.match(agents, /Never put a setting in a Features card/);
});

test('voice ordering ended up on the captain app page', () => {
  /* The specific thing that was wrong twice. Named, so putting it back fails
     loudly rather than quietly. */
  assert.ok(
    !featuresPane().includes('voice_provider'),
    'voice ordering is back in the Features list'
  );
  assert.ok(html.includes('id="captainvoice-line"'), 'the captain app has no voice tab');
});
