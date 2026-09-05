'use strict';
/*
 * Is this sale ready to become an e-invoice? (INDIA_EINVOICING_DESIGN.md, PR 2)
 *
 * WHAT THIS IS FOR
 *
 * Everything an IRP would refuse, found here instead - at the till, in the
 * shop's own time, against the shop's own data, with the screen that fixes it
 * named. The alternative is finding out at submission, which for a small shop
 * means a rejected invoice, a customer who has left, and a correction that is
 * a credit note rather than an edit.
 *
 * THREE RULES THIS FILE OBEYS
 *
 * 1. It reports; it never writes. Nothing here changes a sale, an item or a
 *    setting. Same discipline as gst-readiness.js, for the same reason: a
 *    checker that also corrects is a checker nobody can trust to be honest
 *    about what it found.
 *
 * 2. A retail sale is not a failure. Most bills in a shop are to walk-in
 *    customers, and none of them are e-invoices. That is finding EI-001 at
 *    severity `info`, and it must read as "nothing to do here" rather than as
 *    a red row. Getting this wrong would make the readiness page useless on
 *    day one by burying the twelve real problems under nine hundred
 *    non-problems.
 *
 * 3. It says the value, not just the rule. "HSN 0 on Fixture rice 5 kg" is
 *    actionable; "invalid HSN" is a puzzle.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * The three arithmetic checks - a line's tax against rate times taxable value,
 * a header discount that no line carries, and the invoice total against the
 * sum of its lines - need the amounts restated in the schema's own terms, and
 * restating them is a decision about inclusive pricing and discount
 * allocation that the design has open questions on. They arrive with
 * contract.js. findings.DEFERRED names them so this is a stated gap rather
 * than an oversight.
 */

const gstin = require('./gstin');
const uqc = require('./uqc');
const { make, isBlocked, isNotApplicable } = require('./findings');
const { RETIRED_SLABS, LIVE_SLABS } = require('../gst-readiness');

/* The buyer types that make a sale a B2B candidate. Identical to the filter
   gstOneReportPageJson already uses for the GSTR-1 B2B section, deliberately:
   two different answers to "is this a B2B sale" would be a reconciliation bug
   waiting for somebody to find it at filing time. */
const B2B_BUYER_TYPES = ['regular', 'composite'];

/*
 * Rates the IRP's master accepts. WIDER than the slabs that are current: the
 * portal still takes 12% and 28% because invoices dated before 22 September
 * 2025 legitimately carry them, and tobacco still sits at 28%.
 *
 * So there are two different questions and they get two different findings:
 * EI-106 asks "would the portal take this at all" (a block), and EI-111 asks
 * "is this a slab GST 2.0 withdrew" (a warning, because the answer depends on
 * what is being sold and when).
 *
 * UNCONFIRMED, and recorded as such in INDIA_EINVOICING_RESEARCH.md: the exact
 * current master list. Read it from the portal's Master Codes page before
 * anything relies on a rejection from this set.
 */
const PORTAL_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 7.5, 12, 18, 28, 40];

/* The IRP's own limit on ItemList. */
const MAX_LINES = 1000;

/* Document number: 16 characters, alphanumeric plus / and -, and it may not
   begin with 0, / or -. Straight from the schema. */
const DOC_NO = /^[a-zA-Z1-9][a-zA-Z0-9/-]{0,15}$/;

const PIN = /^[0-9]{6}$/;

/* Services live in chapter 99 and their SAC is six digits. */
const SAC = /^99[0-9]{4}$/;
const HSN = /^(?!0+$)([0-9]{4}|[0-9]{6}|[0-9]{8})$/;

const text = (value) => String(value == null ? '' : value).trim();
const num = (value) => {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

/* State name -> GST state code, for the one check that needs it. The GSTIN is
   always preferred; this only answers "does the shop's typed state agree with
   its own GSTIN", which is a data-quality question. */
let _stateByName = null;
function stateCodeForName(name) {
  const key = text(name).toLowerCase();
  if (!key) return '';
  if (!_stateByName) {
    _stateByName = new Map();
    try {
      const rows = require('../../json/gst_state_code.json').gststate || [];
      for (const row of rows) {
        _stateByName.set(text(row.value).toLowerCase(), text(row.id));
      }
    } catch (e) {
      /* Unreadable table: every GSTIN-derived answer still works. */
    }
  }
  return _stateByName.get(key) || '';
}

/** Test seam; nothing in production calls this. */
function _resetForTests() {
  _stateByName = null;
}

/**
 * Is this sale a B2B e-invoice candidate at all?
 *
 * The buyer type is the question, not the presence of a GSTIN: a customer
 * marked `regular` with the GSTIN field left empty IS a candidate, and the
 * empty field is the finding (EI-002). Treating them as "not applicable"
 * instead would hide exactly the invoice a shop most needs to hear about.
 */
function isCandidate(sale) {
  const type = text(sale && sale.customer_gst_type).toLowerCase();
  return B2B_BUYER_TYPES.includes(type);
}

/* ------------------------------------------------------------------ *
 * The seller - the shop itself. Wrong here means every invoice fails,
 * which makes these the findings worth surfacing first.
 * ------------------------------------------------------------------ */
function checkSeller(branch, out) {
  const number = text(branch && branch.branch_gstin_number);
  const verdict = gstin.explain(number);
  if (!verdict.valid) {
    out.push(
      make('EI-011', `The shop's GSTIN cannot be used: ${verdict.detail}`, {
        field: 'branch_gstin_number',
        value: number,
      })
    );
  } else {
    const fromGstin = gstin.stateCodeOf(number);
    const fromName = stateCodeForName(branch.state);
    if (fromName && fromName !== fromGstin) {
      out.push(
        make(
          'EI-012',
          `The shop's GSTIN begins ${fromGstin}, but the shop's state is set to ${text(branch.state)} (${fromName}). The e-invoice uses the GSTIN, so check which one is wrong.`,
          { field: 'state', value: text(branch.state), expected: fromGstin }
        )
      );
    }
  }

  /* legal_name arrives with the model PR; until then this reports honestly
     that it is absent rather than quietly sending the trade name. */
  if (!text(branch && branch.legal_name)) {
    out.push(
      make(
        'EI-013',
        'The shop has no legal name recorded. An e-invoice needs the name exactly as it appears on the GST registration, which is not always the shop name customers see.',
        { field: 'legal_name' }
      )
    );
  }

  const pin = text(branch && branch.pincode);
  if (!PIN.test(pin)) {
    out.push(
      make(
        'EI-014',
        pin ? `The shop's PIN code "${pin}" is not six digits.` : 'The shop has no PIN code.',
        { field: 'pincode', value: pin }
      )
    );
  }

  const address = text(branch && (branch.store_address || branch.address));
  const city = text(branch && branch.city);
  if (!address || !city) {
    out.push(
      make(
        'EI-015',
        !address && !city
          ? "The shop's address and town are both empty."
          : !address
            ? "The shop's address is empty."
            : "The shop's town is empty.",
        { field: !address ? 'store_address' : 'city' }
      )
    );
  }
}

/* ------------------------------------------------------------------ *
 * The buyer. `customer` is optional: the sale carries a snapshot, and
 * for anything the snapshot does not hold yet (the PIN, until the model
 * PR) the customer record is consulted as a fallback.
 * ------------------------------------------------------------------ */
function checkBuyer(sale, customer, out) {
  const number = text(sale.customer_gst_number || (customer && customer.gst_number));
  if (!number) {
    out.push(
      make(
        'EI-002',
        `${text(sale.customer_name) || 'This customer'} is marked as a registered business but has no GSTIN.`,
        { field: 'customer_gst_number' }
      )
    );
  } else {
    const verdict = gstin.explain(number);
    if (!verdict.valid) {
      out.push(
        make('EI-003', `The buyer's GSTIN ${number} is not valid: ${verdict.detail}`, {
          field: 'customer_gst_number',
          value: number,
        })
      );
    }
  }

  const tradeName = text(sale.customer_name || (customer && customer.name));
  const legalName = text(sale.customer_legal_name || (customer && customer.legal_name));
  if (!tradeName && !legalName) {
    out.push(make('EI-004', 'The buyer has no name on this sale.', { field: 'customer_name' }));
  } else if (!legalName) {
    out.push(
      make(
        'EI-006',
        `No legal name recorded for ${tradeName}; the e-invoice will carry "${tradeName}" as the trade name. A registered buyer's legal name should match their GST registration.`,
        { field: 'customer_legal_name', value: tradeName }
      )
    );
  }

  const pin = text(sale.customer_pincode || (customer && customer.pincode));
  if (!PIN.test(pin)) {
    out.push(
      make(
        'EI-005',
        pin
          ? `The buyer's PIN code "${pin}" is not six digits.`
          : `No PIN code for ${tradeName || 'the buyer'}. An e-invoice needs one.`,
        { field: 'customer_pincode', value: pin }
      )
    );
  }

  const address = text(sale.customer_address || (customer && customer.address));
  const city = text(sale.customer_city || (customer && customer.city));
  if (!address || !city) {
    out.push(
      make(
        'EI-007',
        !address && !city
          ? `No address or town for ${tradeName || 'the buyer'}.`
          : !address
            ? `No address for ${tradeName || 'the buyer'}.`
            : `No town for ${tradeName || 'the buyer'}.`,
        { field: !address ? 'customer_address' : 'customer_city' }
      )
    );
  }
}

/* ------------------------------------------------------------------ *
 * The document itself: its number, its date, and what kind of supply
 * it claims to be.
 * ------------------------------------------------------------------ */
function checkDocument(sale, state, now, out) {
  const no = text(sale.sales_id);
  if (!no || !DOC_NO.test(no)) {
    out.push(
      make(
        'EI-021',
        !no
          ? 'This sale has no bill number.'
          : no.length > 16
            ? `Bill number "${no}" is ${no.length} characters; an e-invoice allows 16. The length comes from the sales prefix in settings.`
            : `Bill number "${no}" contains a character an e-invoice does not allow. Only letters, digits, / and - are allowed, and it may not begin with 0, / or -.`,
        { field: 'sales_id', value: no }
      )
    );
  }

  const date = sale.date ? new Date(sale.date) : null;
  if (!date || Number.isNaN(date.getTime())) {
    out.push(make('EI-024', 'This sale has no usable date.', { field: 'date' }));
  } else if (state.reportingWindow) {
    const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
    if (days > 30) {
      out.push(
        make(
          'EI-022',
          `This invoice is ${days} days old. Shops above 10 crore turnover must report an invoice within 30 days, and the portal will refuse it.`,
          { field: 'date', value: days }
        )
      );
    }
  }

  /* supply_type and reverse_charge arrive with the model PR. Absent means the
     default, which is the only case this can export. */
  const supply = text(sale.supply_type).toUpperCase() || 'B2B';
  if (supply !== 'B2B') {
    out.push(
      make(
        'EI-023',
        `This sale is marked ${supply}. Only ordinary B2B supplies can be exported yet; exports, SEZ and deemed exports need fields Posnic does not collect.`,
        { field: 'supply_type', value: supply }
      )
    );
  }
  if (sale.reverse_charge === true || sale.reverse_charge === 'true') {
    out.push(
      make('EI-023', 'This sale is marked reverse charge, which cannot be exported yet.', {
        field: 'reverse_charge',
      })
    );
  }
}

/* ------------------------------------------------------------------ *
 * The lines. Every finding names the line and the item, because a
 * fifty-line invoice with "invalid HSN" and no further detail is not a
 * report, it is a search task.
 * ------------------------------------------------------------------ */
function checkLines(sale, state, out) {
  const items = Array.isArray(sale.items) ? sale.items : [];
  if (!items.length) {
    out.push(make('EI-025', 'This sale has no items on it.', { field: 'items' }));
    return;
  }
  if (items.length > MAX_LINES) {
    out.push(
      make('EI-110', `This invoice has ${items.length} lines. An e-invoice allows ${MAX_LINES}.`, {
        field: 'items',
        value: items.length,
      })
    );
  }

  items.forEach((item, index) => {
    const line = index + 1;

    /*
     * A line that is not an object at all.
     *
     * This is not hypothetical: the check runs over a shop's whole history,
     * including rows written by versions of this application that no longer
     * exist, and `items` is an array on a schema that does not police its
     * contents. Reported rather than skipped, because an invoice exported
     * with a line quietly missing is worse than one that is held back - the
     * shop would file a total that does not match the bill it printed.
     */
    if (!item || typeof item !== 'object') {
      out.push(
        make('EI-113', `Line ${line} of this sale is empty or damaged and cannot be checked.`, {
          line,
          field: `items[${index}]`,
        })
      );
      return;
    }

    const name = text(item.name || item.item_name) || `line ${line}`;
    const at = { line, field: `items[${index}]`, item: name };

    const isService = item.is_service === true || item.is_service === 'true';
    const code = text(item.hsncode || item.hsn_code);

    if (!code || /^0+$/.test(code)) {
      out.push(
        make('EI-101', `${name} has no HSN code${code ? ` (it is "${code}")` : ''}.`, {
          ...at,
          value: code,
        })
      );
    } else if (!HSN.test(code)) {
      out.push(
        make(
          'EI-102',
          `${name} has HSN "${code}". An HSN code is 4, 6 or 8 digits and nothing else.`,
          { ...at, value: code }
        )
      );
    } else if (isService && !SAC.test(code)) {
      out.push(
        make(
          'EI-104',
          `${name} is a service, so it needs a six-digit SAC code beginning 99. It currently has "${code}".`,
          { ...at, value: code }
        )
      );
    } else if (code.length < 6) {
      /* Four digits satisfies the schema but not the taxpayer: the portals
         have refused 4-digit codes from shops at or above 5 crore since
         December 2023, and that is everyone the mandate covers. A shop that
         has not ticked the turnover box still hears about it, as a warning. */
      out.push(
        make(
          'EI-103',
          `${name} has a four-digit HSN ("${code}"). Shops that must e-invoice have to report at least six digits.`,
          { ...at, value: code, severityOverride: !state.liable }
        )
      );
    }

    const unitValue = item.uqc || item.item_unit || item.unit;
    if (!uqc.unitToUqc(unitValue)) {
      out.push(
        make(
          'EI-105',
          text(unitValue)
            ? `${name} is sold in "${text(unitValue)}", which has no GST unit code. Set one on the Units screen.`
            : `${name} has no unit. An e-invoice needs a GST unit code for goods.`,
          { ...at, value: text(unitValue) }
        )
      );
    }

    if (num(item.quantity) <= 0) {
      out.push(
        make('EI-112', `${name} has a quantity of ${num(item.quantity)}.`, {
          ...at,
          value: num(item.quantity),
        })
      );
    }

    const rate = num(item.tax_rate ?? item.tax);
    if (!PORTAL_RATES.includes(rate)) {
      out.push(
        make(
          'EI-106',
          `${name} is taxed at ${rate}%, which the portal's rate list does not contain.`,
          { ...at, value: rate }
        )
      );
    } else if (RETIRED_SLABS.includes(rate)) {
      out.push(
        make(
          'EI-111',
          `${name} is at ${rate}%, a slab withdrawn on 22 September 2025. The portal still accepts it for older invoices, but check the rate before filing.`,
          { ...at, value: rate }
        )
      );
    } else if (rate === 28 && !LIVE_SLABS.includes(28)) {
      /* Defensive: if the reference ever retires 28 entirely, say so rather
         than silently passing it. */
      out.push(make('EI-111', `${name} is at 28%.`, { ...at, value: rate }));
    }
  });
}

/* ------------------------------------------------------------------ *
 * Does the tax split agree with where the buyer actually is?
 *
 * This is the check that earns the whole module. The split was decided at
 * sale time by comparing two typed state NAMES (sale.service.js), and the
 * shipped India state list spells Puducherry "Pondicherry" and contains
 * five entries that are not states. The IRP decides the same question from
 * the GSTIN and refuses the invoice when the two disagree (errors 2172 and
 * 2174) - so a shop can bill happily for months and discover it only at
 * submission.
 * ------------------------------------------------------------------ */
function checkSplit(sale, branch, out) {
  const buyer = text(sale.customer_gst_number);
  const seller = text(branch && branch.branch_gstin_number);
  const same = gstin.sameState(seller, buyer);
  if (same === null) return; /* one of them is unreadable; already reported */

  /* Damaged lines are reported by checkLines and skipped here - summing tax
     over a row that is not an object would take the whole page down. */
  const items = (Array.isArray(sale.items) ? sale.items : []).filter(
    (i) => i && typeof i === 'object'
  );
  const igst = items.reduce((sum, i) => sum + num(i.igst_tax), 0);
  const cgst = items.reduce((sum, i) => sum + num(i.cgst_tax), 0);
  const sgst = items.reduce((sum, i) => sum + num(i.sgst_tax), 0);
  if (igst === 0 && cgst === 0 && sgst === 0) return; /* nothing taxed */

  const sellerState = gstin.stateCodeOf(seller);
  const buyerState = gstin.stateCodeOf(buyer);

  if (same && igst > 0) {
    out.push(
      make(
        'EI-108',
        `This sale charged IGST, but the shop (${sellerState}) and the buyer (${buyerState}) are in the same state, so it should be CGST and SGST. The buyer's state on the customer record is probably wrong.`,
        { field: 'customer_state', value: 'IGST', expected: 'CGST+SGST' }
      )
    );
  } else if (!same && (cgst > 0 || sgst > 0)) {
    out.push(
      make(
        'EI-108',
        `This sale charged CGST and SGST, but the shop (${sellerState}) and the buyer (${buyerState}) are in different states, so it should be IGST. The buyer's state on the customer record is probably wrong.`,
        { field: 'customer_state', value: 'CGST+SGST', expected: 'IGST' }
      )
    );
  }
}

/* ------------------------------------------------------------------ *
 * The state of the invoice itself.
 * ------------------------------------------------------------------ */
function checkInvoiceState(sale, out) {
  const returns = Array.isArray(sale.items_return) ? sale.items_return : [];
  const process = text(sale.sale_process);
  if (returns.length || /return/i.test(process)) {
    out.push(
      make(
        'EI-301',
        'This invoice has a return against it. A return has to be reported as a credit note with its own number, which Posnic does not produce yet, so the invoice is held back rather than filed without it.',
        { field: 'items_return' }
      )
    );
  }

  const existing = sale.einvoice && text(sale.einvoice.irn);
  if (existing) {
    out.push(
      make(
        'EI-302',
        'This invoice already has an IRN. Anything changed on it since then has not been reported to the portal, and cannot be - a registered invoice is corrected with a credit or debit note.',
        { field: 'einvoice.irn', value: existing }
      )
    );
  }
}

/**
 * Check one sale.
 *
 * @param {object}  input
 * @param {object}  input.sale      the sale document
 * @param {object}  input.branch    the selling branch
 * @param {object}  [input.customer] the customer record, for fields the sale
 *                                   does not snapshot yet
 * @param {object}  [input.state]   applicability.status() output; supplies the
 *                                  turnover flags. Defaults are the safe ones
 *                                  (not liable, no reporting window).
 * @param {Date}    [input.now]     injected so tests are deterministic
 * @returns {{status: string, candidate: boolean, findings: Array}}
 */
function checkSale({ sale, branch, customer, state, now } = {}) {
  const findings = [];
  if (!sale) {
    return { status: 'blocked', candidate: false, findings: [] };
  }

  const flags = state || {};
  const asOf = now instanceof Date ? now : new Date();

  if (!isCandidate(sale)) {
    const type = text(sale.customer_gst_type).toLowerCase() || 'walk-in';
    findings.push(
      make(
        'EI-001',
        `${text(sale.customer_name) || 'This customer'} is ${type === 'walk-in' ? 'a walk-in customer' : `marked "${type}"`}, so this bill is not an e-invoice. Only sales to GST-registered businesses are reported.`,
        { field: 'customer_gst_type', value: type }
      )
    );
    return { status: 'not_applicable', candidate: false, findings };
  }

  checkSeller(branch, findings);
  checkBuyer(sale, customer, findings);
  checkDocument(sale, flags, asOf, findings);
  checkLines(sale, flags, findings);
  checkSplit(sale, branch, findings);
  checkInvoiceState(sale, findings);

  /* EI-103 is the one finding whose severity depends on the shop rather than
     on the invoice: below the threshold a four-digit HSN is a warning, at or
     above it the portal refuses the invoice. Resolved here so the catalogue
     keeps one entry per code. */
  for (const finding of findings) {
    if (finding.severityOverride) finding.severity = 'warn';
    delete finding.severityOverride;
  }

  return {
    status: isBlocked(findings) ? 'blocked' : 'ready',
    candidate: true,
    findings,
  };
}

/**
 * Check many sales and summarise. The shape the readiness page renders.
 *
 * @param {Array}  sales
 * @param {object} context  { branch, customersById, state, now }
 */
function checkMany(sales = [], context = {}) {
  const { branch, customersById = {}, state, now } = context;
  const rows = [];
  const counts = { ready: 0, blocked: 0, not_applicable: 0 };

  for (const sale of Array.isArray(sales) ? sales : []) {
    const customer = sale && sale.customer_id ? customersById[String(sale.customer_id)] : null;
    const result = checkSale({ sale, branch, customer, state, now });
    counts[result.status] += 1;
    rows.push({
      sales_id: text(sale && sale.sales_id),
      date: sale && sale.date ? new Date(sale.date).toISOString() : null,
      customer_name: text(sale && sale.customer_name),
      total: num(sale && sale.sales_total),
      ...result,
    });
  }

  return { rows, counts, examined: rows.length };
}

module.exports = {
  B2B_BUYER_TYPES,
  PORTAL_RATES,
  MAX_LINES,
  DOC_NO,
  isCandidate,
  checkSale,
  checkMany,
  stateCodeForName,
  isBlocked,
  isNotApplicable,
  _resetForTests,
};
