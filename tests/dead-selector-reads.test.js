const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { analyse } = require('./tools/dead-selectors');

/*
 * A dead selector that is READ cannot be allowed to appear unnoticed.
 *
 * dead-selectors.js explains why it is a tool and not a gate: ids built by
 * concatenation never appear as literals, so a pass/fail check over all of
 * them would carry a hundred standing exceptions, and a guard people scroll
 * past is worse than none.
 *
 * That argument is about the WRITES. Splitting the list by what the code does
 * with the element changes the size of the problem:
 *
 *   WRITE  $('#gone').html(x), .show(), .addClass() - jQuery no-ops on an
 *          empty set. Invisible and harmless. 102 of the 110.
 *   READ   $('#gone').val(), .is(':checked'), .attr() feeding a condition or
 *          a payload - always undefined or false. A setting that reads as off
 *          forever, or a field posted to the server missing. 8 of the 110.
 *
 * Eight exceptions is a list somebody will actually read. Each one below was
 * traced by hand to see whether the code reading it can run at all - because a
 * read of a missing element is only a bug if something calls the function
 * doing the reading.
 *
 * VERDICTS (all checked, none is a live user-visible defect):
 *
 *   #whatsapp_phone_number    sendMessage() is called from nowhere and none of
 *                             the three fields it reads exist. The send tab was
 *                             never built. Unreachable.
 *   #smtp_php_mail            emailPhpStoreSettings() called from nowhere.
 *   #closingopening_float     cashregisterOpenForm() called from nowhere, and
 *                             #choose_register_model beside it is absent too.
 *                             The live open modal uses #register_open_float.
 *   #sales_new_given_amount   customerBalanceCheck() IS live, but the balance
 *                             it computes is written to #sales_new_balance_amount
 *                             which is equally absent - sub(undefined, total) is
 *                             NaN, .toFixed() makes it a string, and the write
 *                             lands on an empty set. Nothing throws, nothing
 *                             renders. The function's surviving purpose is the
 *                             customerViewDisplay() call at the end.
 *   #tender_amount            written, never read back; #refund_grand_total
 *                             beside it does exist, so nothing throws.
 *   #user_verify_password     a FALLBACK behind #verify_password, which exists
 *                             in delete_collection.html - the branch never runs.
 *   #user_access              read inside errorPlacement, a validator callback.
 *   #customer_sms_message     read in sendWhatsAppReceipt.
 *
 * Eight, not nine: a first pass counted #view_instantdetails_page_perpage_total
 * as a read because `.length` appeared on the line, but that is the length of
 * the RESPONSE and the call itself is an ordinary .text(value) write. The
 * matchers below are argument-shaped for exactly that reason - `.text()` reads,
 * `.text(x)` writes, and a matcher that cannot tell them apart would fill this
 * list with the noise it exists to keep out.
 *
 * A ninth appearing here means someone deleted markup and left a read behind.
 * That is the quotes_search bug, which told anyone whose search found nothing
 * that they had never written a quote.
 */

const ROOT = path.join(__dirname, '..');

/* Reading an element, as opposed to writing to one. Argument-less accessors
   return a value; .attr('x')/.data('x') with one argument do too. */
const READS = [
  /\.val\(\s*\)/,
  /\.is\(\s*['"]:(checked|visible|selected)/,
  /\.prop\(\s*['"]checked['"]\s*\)/,
  /\.text\(\s*\)/,
  /\.html\(\s*\)/,
  /\.attr\(\s*['"][^'"]+['"]\s*\)/,
  /\.data\(\s*['"][^'"]+['"]\s*\)/,
];

const KNOWN = new Set([
  'whatsapp_phone_number',
  'smtp_php_mail',
  'closingopening_float',
  'sales_new_given_amount',
  'tender_amount',
  'user_verify_password',
  'user_access',
  'customer_sms_message',
]);

const readSites = () => {
  const { dead } = analyse();
  const cache = new Map();
  const found = new Map();

  for (const [id, where] of dead) {
    for (const w of where) {
      const at = w.lastIndexOf(':');
      const file = w.slice(0, at);
      const line = Number(w.slice(at + 1));
      if (!cache.has(file)) {
        cache.set(file, fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/));
      }
      const src = cache.get(file)[line - 1] || '';
      /* Only the part of the line from this selector onward - an unrelated
         .val() earlier on the same line is not this id being read. */
      const from = src.indexOf(`#${id}`);
      const frag = from === -1 ? src : src.slice(from);
      if (READS.some((r) => r.test(frag))) {
        if (!found.has(id)) found.set(id, []);
        found.get(id).push(`${file}:${line}  ${src.trim().slice(0, 120)}`);
      }
    }
  }
  return found;
};

test('no NEW dead selector is read anywhere', () => {
  const found = readSites();
  const fresh = [...found.keys()].filter((id) => !KNOWN.has(id));
  assert.deepStrictEqual(
    fresh,
    [],
    'a selector matching no element is being READ - it returns undefined/false ' +
      'forever, so a branch never runs or a value reaches the server missing:\n' +
      fresh.map((id) => `  #${id}\n    ${(found.get(id) || []).join('\n    ')}`).join('\n'),
  );
});

test('the known eight are still only the known eight', () => {
  /* The other direction: fixing one should shrink this list, and the entry
     above should go with it. A verdict for an id nobody reads any more is a
     comment that has stopped being true. */
  const found = readSites();
  const stale = [...KNOWN].filter((id) => !found.has(id));
  assert.deepStrictEqual(
    stale,
    [],
    'these are recorded as dead reads but are no longer read - delete the ' +
      `entry and its verdict from this file: ${stale.join(', ')}`,
  );
});

test('the write-only majority stays out of the gate', () => {
  /* Guarding all 110 is what dead-selectors.js argues against, and it is
     right: the writes are invisible no-ops and a list that long stops being
     read. This asserts the split still holds - if writes ever became the
     minority, the reasoning above would need revisiting rather than the
     number quietly drifting. */
  const { dead } = analyse();
  const reads = readSites().size;
  assert.ok(dead.length > 0, 'the sweep found nothing at all - it is probably broken');
  assert.ok(
    reads * 4 < dead.length,
    `reads are no longer a small minority (${reads} of ${dead.length}) - ` +
      'the case for gating only the reads needs revisiting',
  );
});
