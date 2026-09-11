'use strict';

/*
 * The shop's currency, as a customer should read it beside a price.
 *
 * A branch keeps its currency as the LABEL the signup dropdown showed:
 *
 *   "India Rupee / INR or ₹"
 *
 * Keeping the label is right - it is the thing the shopkeeper chose and the
 * thing the settings screen shows back. Printing it beside a price is not, and
 * that is what the public menu did on develop: "India Rupee / INR or ₹ 80"
 * beside every dish, because the page was handed the label and asked to be
 * polite about it.
 *
 * So the label is taken apart here, once, on the server, and the pages are
 * handed the two things they can actually use: the symbol to print and the
 * ISO code for anything that needs to be unambiguous (a receipt, a payment
 * gateway, a spreadsheet).
 *
 * Tolerant on purpose. Older installs and self-hosted ones have stored a bare
 * "INR", a bare "₹", "Rs." and the odd label with no " or " in it, and a menu
 * must never come out blank because a currency string was shaped unusually.
 */

/** Three capital letters, which is what an ISO 4217 code looks like. */
const ISO_CODE = /^[A-Z]{3}$/;

/**
 * @param {string} label  whatever the branch stored
 * @returns {{name: string, code: string, symbol: string}}
 *   `symbol` is what goes beside a price and is never empty when anything at
 *   all was stored: it falls back to the code, and the code to the label.
 */
function parseCurrencyLabel(label) {
  const text = String(label == null ? '' : label).trim();
  if (!text) return { name: '', code: '', symbol: '' };

  let name = '';
  let code = '';
  let symbol = '';

  /* "Name / CODE or SYMBOL" - the shape the dropdown writes. Split on the
     LAST " or " so a name that happens to contain the word is left alone. */
  const orAt = text.lastIndexOf(' or ');
  const head = orAt === -1 ? text : text.slice(0, orAt);
  if (orAt !== -1) symbol = text.slice(orAt + 4).trim();

  const slashAt = head.indexOf('/');
  if (slashAt !== -1) {
    name = head.slice(0, slashAt).trim();
    code = head.slice(slashAt + 1).trim();
  } else if (ISO_CODE.test(head.trim())) {
    code = head.trim();
  } else if (orAt === -1 && head.trim().length <= 4 && !/\s/.test(head.trim())) {
    /* A bare "₹", "$", "Rs." or "kr": a short token on its own is the thing
       people write beside a price, not the name of a currency. */
    symbol = head.trim();
  } else {
    name = head.trim();
  }

  if (!ISO_CODE.test(code)) {
    /* Not a code. Keep it as the name if there was none, never as a code a
       payment gateway would choke on. */
    if (code && !name) name = code;
    code = '';
  }

  if (!symbol) symbol = code || name || text;
  return { name, code, symbol };
}

/** The thing to print beside a price. Never empty when the label was not. */
function currencySymbol(label) {
  return parseCurrencyLabel(label).symbol;
}

/** The ISO code, or '' when the label did not carry one. */
function currencyCode(label) {
  return parseCurrencyLabel(label).code;
}

module.exports = { parseCurrencyLabel, currencySymbol, currencyCode };
