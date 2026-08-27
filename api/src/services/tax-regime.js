'use strict';

/*
 * The tax regime a shop lives under (PURCHASE_TAX_PLAN §3/G6), resolved on
 * top of the tax-profile registry that T0 shipped - NOT beside it.
 *
 * Division of knowledge, so nothing is stored twice:
 *   - tax_profiles.json (per COUNTRY): label, registration identity,
 *     component structure (India's CGST/SGST/IGST split lives there), and
 *     now `regime` - which of the three families the country runs:
 *       vat_credit  remit output minus input; the credit family
 *       sales_tax   US-style: no credit; resale certificates, use tax
 *       none        no consumption tax
 *   - the `tax` settings group (per SHOP): only the DECISIONS a shop makes
 *     inside its regime - India's GST type and turnover band, the US shop's
 *     resale certificate - plus an explicit regime override for the rare
 *     shop whose situation differs from its flag.
 *
 * Every tax surface calls resolveRegime() and branches on the answer.
 */

const taxProfiles = require('./tax-profiles');

/**
 * The regime and profile in force for a branch, honouring the shop's own
 * override from the Tax Configuration page when present.
 *
 * @param {Object} branch - branch-shaped doc (sortname, tax_profile_override)
 * @param {Object} [taxGroup] - resolved `tax` settings-group values
 * @returns {{regime: string, code: string, profile: Object, decisions: Object}}
 */
function resolveRegime(branch, taxGroup = {}) {
  const { code, profile } = taxProfiles.profileForBranch(branch || {});
  const override = String(taxGroup.tax_regime || '').trim();
  const regime = ['vat_credit', 'sales_tax', 'none'].includes(override)
    ? override
    : profile.regime || 'vat_credit';
  return { regime, code, profile, decisions: taxGroup };
}

/**
 * The per-shop decision defaults the installer seeds for a country. Only
 * countries with real decisions get any - everyone else starts empty and the
 * profile alone answers every question.
 */
function installDecisionsFor(iso2) {
  const cc = String(iso2 || '').toUpperCase();
  if (cc === 'IN') {
    return {
      india_gst_type: 'regular', // regular | composition | unregistered
      india_turnover_above_5cr: false, // >=5cr: 6-digit HSN + e-invoice readiness
      india_qrmp: false, // quarterly filing scheme below 5cr
    };
  }
  return {};
}

/* The credit flag speaks the family language, wherever it appears. */
function creditFlagLabel(regime) {
  return String(regime) === 'sales_tax'
    ? 'Purchased for resale (tax-exempt)'
    : 'Input credit claimable';
}

module.exports = { resolveRegime, installDecisionsFor, creditFlagLabel };
