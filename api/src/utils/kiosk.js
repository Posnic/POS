/*
 * Does this branch run a kiosk?
 *
 * Asked by the Item List, which carries a per-item Kiosk toggle. On a shop with
 * no kiosk that column is a switch that does nothing anybody can see, taking
 * width from Quantity and Price on the page staff are in all day.
 *
 * A branch document gets its `kiosk` entry the moment any kiosk field is saved
 * - an image, a payment option - so the entry existing answers nothing. The
 * store id is the question: it is what a kiosk uses to identify itself, and
 * everything else in Kiosk Settings has a working default. No store id, no
 * kiosk.
 *
 * Kept apart from the controller so the rule can be read and tested without
 * standing up a database.
 */

function isKioskConfigured(branch) {
  const kiosk = Array.isArray(branch?.kiosk) ? branch.kiosk[0] : null;
  if (!kiosk) return false;

  // Trimmed: a field holding spaces was never filled in.
  return String(kiosk.store_id || '').trim().length > 0;
}

module.exports = { isKioskConfigured };
