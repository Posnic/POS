'use strict';
/*
 * The name this installation goes by.
 *
 * Most of this product is sold white-label. A shop trading under its own name
 * should never see ours - not in an error, not on a printed receipt, not on a
 * sign-in failure. It leaked in all three places, and the one that matters
 * most is the receipt, because that is a document the shop hands to its own
 * customers.
 *
 * The name is read from the same brand descriptor app.js serves to the
 * frontend, so there is one answer to "what are we called" rather than two that
 * can disagree.
 *
 * Falling back to an empty string rather than "Posnic" is deliberate: a caller
 * that gets nothing can leave the space blank, which is correct for every
 * brand. A caller that gets "Posnic" would print it for a customer who has
 * never heard of us.
 */

const fs = require('fs');
const path = require('path');

const TTL_MS = 30_000;
let cache = { at: 0, name: null };

/**
 * @returns {string} the brand's display name, or '' when unbranded/unknown
 */
function brandName() {
  if (Date.now() - cache.at < TTL_MS) return cache.name || '';
  let name = '';
  try {
    const dir = process.env.POSNIC_BRAND_DIR;
    if (dir) {
      const file = path.join(dir, 'brand.json');
      if (fs.existsSync(file)) {
        const brand = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (brand && brand.enabled !== false) name = String(brand.name || '').trim();
      }
    }
  } catch (e) {
    /* Branding must never be the reason a till fails to print a receipt. */
    name = '';
  }
  cache = { at: Date.now(), name };
  return name;
}

/**
 * Absolute path to the white-label brand logo, or null when unbranded.
 *
 * Reads the same file-based descriptor as brandName() (POSNIC_BRAND_DIR), so a
 * receipt's footer logo and the name printed beside it always come from one
 * source and cannot disagree. Returns null for an unbranded install and for the
 * Mongo-stored brand (whose logo is raw bytes, not a path) - letting the caller
 * fall back to its own default image. Never throws: branding must not be the
 * reason a till fails to print.
 *
 * @returns {string|null} path to brand-logo.png, or null
 */
function brandLogoPath() {
  try {
    const dir = process.env.POSNIC_BRAND_DIR;
    if (!dir) return null;
    const meta = path.join(dir, 'brand.json');
    if (fs.existsSync(meta)) {
      const brand = JSON.parse(fs.readFileSync(meta, 'utf8'));
      if (brand && brand.enabled === false) return null;
    }
    const logo = path.join(dir, 'brand-logo.png');
    return fs.existsSync(logo) ? logo : null;
  } catch (e) {
    return null;
  }
}

/** Drops the cache so a freshly synced brand applies without a restart. */
function invalidate() {
  cache = { at: 0, name: null };
}

module.exports = { brandName, brandLogoPath, invalidate };
