'use strict';
/*
 * Country tax profile resolution (TAX_INTERNATIONALIZATION_RESEARCH.md T0).
 *
 * A profile describes how a country PRESENTS and POLICES tax - label,
 * registration identity, component structure, display default, rounding,
 * receipt content, report pack. It never computes tax and never stores
 * rates: rates live in each shop's grouptax collection, exactly as before.
 *
 * Resolution: the branch's ISO sortname picks the profile; an explicit
 * branch.tax_profile_override wins; anything unknown gets _default, which
 * is deliberately a complete, working profile - a shop in a country we
 * have not specialised is generic, never broken.
 *
 * T0 ships the registry and this resolver only. Consumers arrive in later
 * phases (T1 engine policy, T2 registration/receipt, T3 reports), each
 * shipped alone - this module existing changes nothing user-visible.
 */
const fs = require('fs');
const path = require('path');

let registry = null;

function loadRegistry() {
  if (registry) return registry;
  try {
    const file = path.join(__dirname, '..', 'json', 'tax_profiles.json');
    registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    /* A missing/corrupt registry must never break a shop: everyone gets
       the built-in generic profile. */
    registry = {};
  }
  if (!registry._default) {
    registry._default = {
      label: 'Tax',
      registration: { label: 'Tax No.', regex: null, onReceipt: true },
      components: { mode: 'single' },
      display: 'exclusive',
      rounding: { granularity: 'line', mode: 'half-up' },
      receipt: { breakdownPerRate: true, wording: null, itemCode: null },
      reports: ['tax-summary-by-rate'],
    };
  }
  return registry;
}

/** Every profile the registry knows, _default included. */
function allProfiles() {
  const reg = loadRegistry();
  return Object.fromEntries(Object.entries(reg).filter(([k]) => !k.startsWith('_comment')));
}

/**
 * The profile for a branch document (or anything shaped like one).
 * branch.tax_profile_override (ISO code) wins; then branch.sortname;
 * then _default. Always returns a complete profile plus which code
 * resolved, so callers can show "GST (India)" honestly.
 */
function profileForBranch(branch) {
  const reg = loadRegistry();
  const override =
    branch && typeof branch.tax_profile_override === 'string'
      ? branch.tax_profile_override.trim().toUpperCase()
      : '';
  const sortname =
    branch && typeof branch.sortname === 'string' ? branch.sortname.trim().toUpperCase() : '';
  const code =
    (override && reg[override] && override) ||
    (sortname && reg[sortname] && sortname) ||
    '_default';
  return { code, profile: reg[code] };
}

/**
 * Does a registration number satisfy the profile's format? A profile
 * without a regex accepts anything non-empty - format law varies too much
 * to guess, and refusing a real number is worse than accepting a loose one.
 */
function registrationValid(profile, value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return false;
  const regex = profile && profile.registration && profile.registration.regex;
  if (!regex) return true;
  try {
    return new RegExp(regex).test(text);
  } catch (e) {
    return true;
  }
}

/**
 * The generalised component split (T2). The engine computes ONE tax; the
 * profile says how it presents: 'split_equal' halves it intra-place and
 * names the whole of it inter-place (today's CGST/SGST/IGST, exactly);
 * everything else is one component under the profile's label. Amounts in,
 * names out - this never computes tax, only dresses it.
 *
 * @param {object} profile         the resolved country profile
 * @param {number} taxAmount       the line's tax
 * @param {boolean} interPlace     place-of-supply says "across the border"
 * @returns {Array<{name:string, amount:number}>}
 */
function buildTaxComponents(profile, taxAmount, interPlace) {
  const amount = Number(taxAmount) || 0;
  if (amount <= 0) return [];
  const comp = (profile && profile.components) || { mode: 'single' };
  if (comp.mode === 'split_equal') {
    if (interPlace) {
      const name = (comp.inter && comp.inter[0]) || 'Tax';
      return [{ name, amount }];
    }
    const names = comp.intra && comp.intra.length ? comp.intra : ['Tax'];
    const share = amount / names.length;
    return names.map((name) => ({ name, amount: share }));
  }
  return [{ name: (profile && profile.label) || 'Tax', amount }];
}

/* test hook */
function resetForTests() {
  registry = null;
}

module.exports = {
  loadRegistry,
  allProfiles,
  profileForBranch,
  registrationValid,
  buildTaxComponents,
  resetForTests,
};
