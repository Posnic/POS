'use strict';

/*
 * The AI endpoints call functions that exist.
 *
 * This is here because one of them did not, and it cost four rounds of
 * testing to find. aiAvailability called ai.availability(); the service
 * exports available(). So every request threw a TypeError, and the catch
 * turned it into { available: false } - which is byte-identical to the honest
 * answer for a shop that has not configured AI.
 *
 * Nothing looked wrong anywhere. The settings were saved correctly, the
 * service answered true when called directly, the endpoint returned HTTP 200,
 * and the button simply never appeared. A typo in a method name presented as
 * "the feature does not exist".
 *
 * A unit test could not catch it because nothing unit-tests a catch block
 * that turns every failure into a plausible answer. What catches it is
 * checking the call sites against the real exports, which is what this does.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'src');
const controller = fs.readFileSync(path.join(SRC, 'controllers', 'items.controller.js'), 'utf8');

const MODULES = {
  ai: require(path.join(SRC, 'services', 'ai.service')),
  budget: require(path.join(SRC, 'services', 'ai-budget')),
  itemDescription: require(path.join(SRC, 'services', 'ai-item-description')),
};

describe('the AI endpoints call functions that exist', () => {
  for (const [alias, mod] of Object.entries(MODULES)) {
    test(`every ${alias}.* the controller calls is exported`, () => {
      const called = [
        ...controller.matchAll(
          new RegExp('\\b' + alias + '\\.([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(', 'g')
        ),
      ].map((m) => m[1]);

      /* If the controller stops calling a module entirely this test would pass
         by checking nothing, which is the failure mode it exists to prevent. */
      expect(called.length).toBeGreaterThan(0);

      for (const name of new Set(called)) {
        expect(typeof mod[name]).toBe('function');
      }
    });
  }

  test('a failure and "not configured" do not answer the same way', () => {
    /*
     * The reason this hid. Both paths returned available:false, so a thrown
     * error was indistinguishable from a shop that had set nothing up - in the
     * response, in the logs, and on the screen.
     */
    expect(controller).toMatch(/reason: 'no_branch'/);
    expect(controller).toMatch(/reason: 'error'/);
    expect(controller).not.toMatch(/reason: 'unavailable'/);
  });
});
