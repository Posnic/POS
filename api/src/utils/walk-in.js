'use strict';

/*
 * THE CUSTOMER WHO DID NOT GIVE A NAME, AND THE ONE NAME FOR THEM.
 *
 * Owner: "if walk in customer no need to show. (remove it)" - about a bill
 * printing "Walk-in Customer" under the customer line.
 *
 * It was supposed to have been removed already. `bill-payload.js` had this:
 *
 *     if (name && !/^walk[\s-]?in$/i.test(name)) out.push(name);
 *
 * which matches "walkin", "walk in" and "walk-in", and does NOT match
 * "Walk-in Customer" - the name every one of this system's five install paths
 * actually writes. So the guard was real, the intent was right, and it had
 * never once matched the thing it existed to catch. A shop read the name of a
 * customer who does not exist on every cash bill it printed.
 *
 * The writer and the reader each knew a string, and the strings were not the
 * same string. So there is one here now, and `isWalkIn` is what asks.
 *
 * It stays tolerant on purpose: a shop may have typed its own version into the
 * customer record years ago, and the cost of a false positive is one bill not
 * printing a name nobody gave, while a false negative is the bug above.
 */

/** What a sale with no named customer is recorded against. */
const WALK_IN_NAME = 'Walk-in Customer';

/*
 * walk in / walkin / walk-in, on its own or followed by a word like customer
 * or guest. Anchored at the front so a real person called "Walkinshaw" is not
 * quietly erased from their own bill.
 */
const WALK_IN = /^walk[\s._-]?in\b[\s._-]*(customer|guest|client)?$/i;

/**
 * Is this the placeholder rather than a person?
 *
 * @param {unknown} name
 * @returns {boolean}
 */
function isWalkIn(name) {
  const text = String(name == null ? '' : name).trim();
  if (!text) return false;
  return WALK_IN.test(text);
}

module.exports = { WALK_IN_NAME, isWalkIn };
