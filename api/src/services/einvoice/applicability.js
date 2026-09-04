'use strict';
/*
 * Whether e-invoicing exists at all for this shop (INDIA_EINVOICING_DESIGN.md).
 *
 * THE RULE THE OWNER SET: "make sure this feature shows only shop is in
 * india." Everything in this directory is Indian tax law. A shop in Kenya or
 * Brazil must never see the switch, the sidebar entry, the readiness page or
 * the export - not greyed out, not empty, absent. So the gate lives in ONE
 * function that every surface calls, rather than as an `if` repeated in a
 * route, a controller and a template, where the fourth copy is the one
 * somebody forgets.
 *
 * FOUR CONDITIONS, AND THEY ARE NOT THE SAME KIND OF THING
 *
 *   country   - is this an Indian shop? A hard gate. Nothing else is even
 *               offered. Resolved through the existing tax-profile registry
 *               (branch.sortname, or an explicit tax_profile_override), so
 *               there is one answer to "which country's tax is this shop
 *               under" and this is not a second one.
 *   gst on    - has the shop switched Indian GST on? Also hard: without it no
 *               sale carries a CGST/SGST/IGST split, so there is nothing to
 *               report.
 *   feature   - has the shop switched e-invoicing on? Off by default. This is
 *               the ordinary Manage > Features toggle.
 *   liable    - is the shop over the turnover threshold? NOT a gate. It is
 *               reported, because a shop may register voluntarily, the
 *               threshold has only ever moved downwards, and refusing to let
 *               somebody prepare early would be the software second-guessing
 *               their accountant.
 *
 * The first two decide whether the switch is VISIBLE. The third decides
 * whether the feature is ON. Keeping those separate is what lets an Indian
 * shop find the feature before they need it.
 */

const taxProfiles = require('../tax-profiles');

/** The ISO code whose tax law this whole directory implements. */
const COUNTRY = 'IN';

const isTrue = (value) => value === true || value === 'true';

/**
 * Is this an Indian shop?
 *
 * Asked through the tax-profile resolver rather than by reading `sortname`
 * directly, so a shop that set tax_profile_override to IN - the documented way
 * to say "tax me as India" - is treated as Indian here too.
 */
function isIndianShop(branch) {
  if (!branch) return false;
  const { code } = taxProfiles.profileForBranch(branch);
  return code === COUNTRY;
}

/** Has the shop switched Indian GST on? The branch stores 'gst_on'/'gst_off'. */
function isGstOn(branch) {
  return String((branch && branch.indian_gst) || '').trim() === 'gst_on';
}

/**
 * Should the e-invoicing feature card be OFFERED to this shop at all?
 * India plus GST on. False means the switch does not exist for them.
 */
function isAvailable(branch) {
  return isIndianShop(branch) && isGstOn(branch);
}

/**
 * Is the feature switched ON for this shop right now?
 *
 * Availability is checked first and deliberately: a stale
 * module_einvoice_enable left behind by a shop that changed country must not
 * keep an Indian-only feature alive. The switch alone is never the answer.
 *
 * @param {object} branch    branch-shaped document
 * @param {object} features  resolved `features` settings group
 */
function isEnabled(branch, features = {}) {
  if (!isAvailable(branch)) return false;
  return isTrue(features && features.module_einvoice_enable);
}

/**
 * Everything a caller needs to explain itself, in one read.
 *
 * `reason` is why the feature is not usable, in the order the shop would fix
 * it, so a screen can say the one true sentence instead of a generic refusal.
 *
 * @param {object} branch
 * @param {object} features  the `features` settings group
 * @param {object} tax       the `tax` settings group
 */
function status(branch, features = {}, tax = {}) {
  const indian = isIndianShop(branch);
  const gstOn = isGstOn(branch);
  const available = indian && gstOn;
  const enabled = available && isTrue(features && features.module_einvoice_enable);

  let reason = null;
  if (!indian) reason = 'not_india';
  else if (!gstOn) reason = 'gst_off';
  else if (!enabled) reason = 'feature_off';

  return {
    indian,
    gstOn,
    available,
    enabled,
    reason,
    /* Reported, never enforced - see the header. */
    liable: isTrue(tax && tax.india_turnover_above_5cr),
    /* Drives the 30-day reporting warning, not a block. */
    reportingWindow: isTrue(tax && tax.india_turnover_above_10cr),
    /* '' when the shop has not set one; the readiness check reports that. */
    einvoiceFrom: String((tax && tax.india_einvoice_from) || '').trim(),
  };
}

/** What to tell a shop that cannot use the feature. Null when they can. */
function unavailableMessage(state) {
  switch (state && state.reason) {
    case 'not_india':
      return 'E-invoicing is part of Indian GST. This shop is not set to India.';
    case 'gst_off':
      return 'Switch Indian GST on under Tax Configuration before using e-invoicing.';
    case 'feature_off':
      return 'E-invoicing is switched off. Turn it on under Manage > Features.';
    default:
      return null;
  }
}

module.exports = {
  COUNTRY,
  isIndianShop,
  isGstOn,
  isAvailable,
  isEnabled,
  status,
  unavailableMessage,
};
