'use strict';

/*
 * The public demo's collar (DEMO_SHOP_PLAN §4).
 *
 * One env flag, read here and nowhere else. Everything it changes is
 * enforced SERVER-side - hiding a button is a courtesy, not a control -
 * and every install without the flag behaves byte-identically to today:
 * this ships to every till and every tenant, inert.
 *
 * What it collars, and why:
 *   - outbound email / SMS / WhatsApp: the demo holds published logins;
 *     an open relay with a web UI is what spammers dream about at night.
 *   - password and user changes: admin/admin, manager/manager and
 *     cashier/cashier are permanent fixtures - the next visitor needs
 *     them exactly as printed on the login page.
 *
 * Data entry stays OPEN on purpose. Making sales, adding items, breaking
 * the layout - that IS the product tour, and the hourly restore makes the
 * shop whole again.
 */
const isDemoMode = () =>
  ['1', 'true', 'yes', 'on'].includes(String(process.env.DEMO_MODE || '').toLowerCase());

const DEMO_BLOCKED_MESSAGE =
  'This is the public demo, so this action is switched off. Everything here resets on the hour - explore freely.';

/* Route middleware for the endpoints a demo must refuse. 403 with the reason
   in plain words: the person who taps "change password" in a demo deserves
   to know it is the demo saying no, not a bug. */
const demoGuard = (req, res, next) => {
  if (!isDemoMode()) return next();
  return res.status(403).json({ type: 'error', message: DEMO_BLOCKED_MESSAGE });
};

module.exports = { isDemoMode, demoGuard, DEMO_BLOCKED_MESSAGE };
