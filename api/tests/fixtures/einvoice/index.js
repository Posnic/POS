'use strict';
/*
 * Synthetic e-invoice fixtures (INDIA_EINVOICING_DESIGN.md, "Test plan and
 * fixtures"; issue #43).
 *
 * EVERYTHING HERE IS INVENTED. No real taxpayer, shop, customer, address or
 * bill number appears in this file, and none may ever be added to it - issue
 * #29 makes that a condition of the work, and a repository is forever.
 *
 * The GSTINs are constructed rather than made up: each carries a PAN segment
 * of the obviously-fake AAAAA0000A shape, and each has a REAL mod-36 check
 * digit. That matters more than it looks. A fixture with a random last
 * character would pass a checksum test that was quietly broken, because
 * everything would be invalid and the "rejects a bad GSTIN" assertion would
 * pass for the wrong reason. Valid fixtures make the invalid one meaningful.
 *
 * Builders rather than constants, so a test can vary exactly one thing and
 * the reader can see what it varied.
 */

/* ------------------------------------------------------------------ *
 * Identities
 * ------------------------------------------------------------------ */

/* Tamil Nadu, state code 33. */
const SELLER_GSTIN = '33AAAAA0000A1Z9';
/* Tamil Nadu too - the intra-state buyer. */
const BUYER_SAME_STATE_GSTIN = '33DDDDD3333D1Z0';
/* Karnataka, state code 29 - the inter-state buyer. */
const BUYER_OTHER_STATE_GSTIN = '29BBBBB1111B1ZJ';
/* The seller's GSTIN with its last character changed: correctly shaped,
   wrong check digit. The whole point of the checksum check. */
const BAD_CHECKSUM_GSTIN = '33AAAAA0000A1Z0';

/** The shop. Complete: this branch should produce no seller findings. */
function branch(over = {}) {
  return {
    _id: 'branch-fixture-1',
    branch_name: 'Fixture Stores',
    legal_name: 'Synthetic Traders Private Limited',
    branch_gstin_number: SELLER_GSTIN,
    store_address: '1 Test Street',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600001',
    country: 'India',
    sortname: 'IN',
    indian_gst: 'gst_on',
    sales_prefix: 'S',
    ...over,
  };
}

/** A registered business buyer in the same state as the shop. */
function buyerSameState(over = {}) {
  return {
    _id: 'customer-fixture-1',
    name: 'Fixture Retail LLP',
    legal_name: 'Fixture Retail LLP',
    gst: 'enabled',
    gst_type: 'regular',
    gst_number: BUYER_SAME_STATE_GSTIN,
    address: '2 Sample Road',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600002',
    ...over,
  };
}

/** A registered business buyer in another state. */
function buyerOtherState(over = {}) {
  return {
    _id: 'customer-fixture-2',
    name: 'Placeholder Enterprises',
    legal_name: 'Placeholder Enterprises',
    gst: 'enabled',
    gst_type: 'regular',
    gst_number: BUYER_OTHER_STATE_GSTIN,
    address: '3 Example Avenue',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    ...over,
  };
}

/* ------------------------------------------------------------------ *
 * Lines
 *
 * Tax amounts are STORED values, written the way sale.service.js writes
 * them, because that is what the validator reads. The passing cases are
 * arithmetically correct so that the split check has something true to
 * agree with; the failing ones are wrong in exactly one named way.
 * ------------------------------------------------------------------ */

/** 2 x 250.00 rice at 5%, intra-state: 500.00 taxable, 12.50 + 12.50. */
function riceIntra(over = {}) {
  return {
    name: 'Fixture rice 5 kg',
    hsncode: '100630',
    item_unit: 'Kilogram',
    quantity: 2,
    unit_price: 250,
    tax_rate: 5,
    tax_type: 'exclusive',
    tax_amount: 25,
    discount: 0,
    total: 525,
    igst_tax: 0,
    cgst_tax: 12.5,
    sgst_tax: 12.5,
    ...over,
  };
}

/** The same line billed across a state border: 25.00 of IGST. */
function riceInter(over = {}) {
  return riceIntra({ igst_tax: 25, cgst_tax: 0, sgst_tax: 0, ...over });
}

/** 1 x 10000.00 handset at 18%, intra-state: 900.00 + 900.00. */
function handsetIntra(over = {}) {
  return {
    name: 'Fixture handset',
    hsncode: '85171300',
    item_unit: 'Pieces',
    quantity: 1,
    unit_price: 10000,
    tax_rate: 18,
    tax_type: 'exclusive',
    tax_amount: 1800,
    discount: 0,
    total: 11800,
    igst_tax: 0,
    cgst_tax: 900,
    sgst_tax: 900,
    ...over,
  };
}

function handsetInter(over = {}) {
  return handsetIntra({ igst_tax: 1800, cgst_tax: 0, sgst_tax: 0, ...over });
}

/** A service. Needs a six-digit SAC in chapter 99, not an HSN. */
function service(over = {}) {
  return {
    name: 'Fixture repair service',
    hsncode: '998719',
    is_service: true,
    item_unit: 'Others',
    quantity: 1,
    unit_price: 1000,
    tax_rate: 18,
    tax_type: 'exclusive',
    tax_amount: 180,
    discount: 0,
    total: 1180,
    igst_tax: 0,
    cgst_tax: 90,
    sgst_tax: 90,
    ...over,
  };
}

/** What the installer actually seeds: an HSN of '0'. */
function noHsn(over = {}) {
  return riceIntra({ name: 'Fixture with no HSN', hsncode: '0', ...over });
}

/** A unit with no GST unit code. 'sheet' is genuinely uncodeable. */
function unmappedUnit(over = {}) {
  return riceIntra({ name: 'Fixture sheet goods', item_unit: 'sheet', ...over });
}

/** Still on a slab GST 2.0 withdrew. */
function retiredSlab(over = {}) {
  return riceIntra({ name: 'Fixture at old rate', tax_rate: 12, ...over });
}

/* ------------------------------------------------------------------ *
 * Sales
 * ------------------------------------------------------------------ */

/* One fixed instant, so nothing in these tests depends on the day they run.
   Written as an explicit offset because the shop's clock is IST and a bare
   date string would mean something different on a CI machine in UTC. */
const SALE_DATE = new Date('2026-08-14T10:30:00+05:30');
/* Far enough after SALE_DATE to be inside the 30-day window. */
const NOW = new Date('2026-08-20T10:30:00+05:30');
/* Far enough after it to be outside. */
const MUCH_LATER = new Date('2026-10-01T10:30:00+05:30');

/**
 * A sale, defaulting to the passing intra-state B2B case.
 * Pass `items` to change the lines, or any header field to change one thing.
 */
function sale(over = {}) {
  const buyer = buyerSameState();
  return {
    _id: 'sale-fixture-1',
    sales_id: 'SB1D1-000045',
    date: SALE_DATE,
    sale_process: 'Add',
    customer_id: buyer._id,
    customer_name: buyer.name,
    customer_legal_name: buyer.legal_name,
    customer_address: buyer.address,
    customer_city: buyer.city,
    customer_state: buyer.state,
    customer_pincode: buyer.pincode,
    customer_gst_type: 'regular',
    customer_gst_number: buyer.gst_number,
    items: [riceIntra(), handsetIntra()],
    items_return: [],
    sales_sub_total: 10500,
    tax: 1825,
    discount: 0,
    round_off: 0,
    sales_total: 12325,
    ...over,
  };
}

/** The passing inter-state case: same goods, a Karnataka buyer, IGST. */
function saleInterState(over = {}) {
  const buyer = buyerOtherState();
  return sale({
    _id: 'sale-fixture-2',
    sales_id: 'SB1D1-000046',
    customer_id: buyer._id,
    customer_name: buyer.name,
    customer_legal_name: buyer.legal_name,
    customer_address: buyer.address,
    customer_city: buyer.city,
    customer_state: buyer.state,
    customer_pincode: buyer.pincode,
    customer_gst_number: buyer.gst_number,
    items: [riceInter(), handsetInter()],
    ...over,
  });
}

/** A walk-in bill. Not an e-invoice, and not an error. */
function saleToConsumer(over = {}) {
  return sale({
    _id: 'sale-fixture-3',
    sales_id: 'SB1D1-000047',
    customer_id: null,
    customer_name: 'Walk-in',
    customer_legal_name: '',
    customer_gst_type: 'consumer',
    customer_gst_number: '',
    customer_pincode: '',
    ...over,
  });
}

/* The shop state a validator expects: Indian, GST on, feature on, and over
   the turnover threshold so the six-digit HSN rule bites. */
function state(over = {}) {
  return {
    indian: true,
    gstOn: true,
    available: true,
    enabled: true,
    reason: null,
    liable: true,
    reportingWindow: false,
    einvoiceFrom: '',
    ...over,
  };
}

module.exports = {
  SELLER_GSTIN,
  BUYER_SAME_STATE_GSTIN,
  BUYER_OTHER_STATE_GSTIN,
  BAD_CHECKSUM_GSTIN,
  SALE_DATE,
  NOW,
  MUCH_LATER,
  branch,
  buyerSameState,
  buyerOtherState,
  riceIntra,
  riceInter,
  handsetIntra,
  handsetInter,
  service,
  noHsn,
  unmappedUnit,
  retiredSlab,
  sale,
  saleInterState,
  saleToConsumer,
  state,
};
