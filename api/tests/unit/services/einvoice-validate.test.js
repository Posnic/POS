'use strict';

/*
 * E-invoice readiness checks (INDIA_EINVOICING_DESIGN.md PR 2, issue #43).
 *
 * Each test is named for the OPERATOR's problem rather than the rule, because
 * that is how somebody arrives here: they could not export an invoice and
 * want to know why.
 *
 * The single most important assertion in this file is that a walk-in sale is
 * `not_applicable` and carries no blocker. A retail shop's day is mostly
 * walk-ins. If those came back as errors, the readiness page would show nine
 * hundred red rows on the first run, the twelve real problems would be
 * invisible inside them, and the feature would be switched off and never
 * looked at again.
 */

const validate = require('../../../src/services/einvoice/validate');
const profiles = require('../../../src/services/tax-profiles');
const fx = require('../../fixtures/einvoice');

beforeEach(() => {
  profiles.resetForTests();
  validate._resetForTests();
});

/** Run a check with the fixture defaults, overriding only what a test varies. */
const check = (over = {}) =>
  validate.checkSale({
    sale: over.sale || fx.sale(),
    branch: over.branch || fx.branch(),
    customer: over.customer,
    state: over.state || fx.state(),
    now: over.now || fx.NOW,
  });

const codes = (result) => result.findings.map((f) => f.code);
const find = (result, code) => result.findings.find((f) => f.code === code);

/* ------------------------------------------------------------------ *
 * The two cases that must pass
 * ------------------------------------------------------------------ */
describe('invoices that are ready', () => {
  test('a B2B sale to a business in the same state', () => {
    const result = check();
    expect(result.status).toBe('ready');
    expect(result.candidate).toBe(true);
    expect(result.findings.filter((f) => f.severity === 'block')).toEqual([]);
  });

  test('a B2B sale to a business in another state', () => {
    const result = check({ sale: fx.saleInterState() });
    expect(result.status).toBe('ready');
    expect(result.findings.filter((f) => f.severity === 'block')).toEqual([]);
  });

  test('a ready invoice is genuinely clean, not merely unblocked', () => {
    /* A warning left on a passing fixture usually means the fixture is
       wrong rather than the invoice, so this is really a fixture test. */
    expect(check().findings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The case that must NOT look like a failure
 * ------------------------------------------------------------------ */
describe('an ordinary retail bill', () => {
  test('a walk-in sale is not an e-invoice, and that is not an error', () => {
    const result = check({ sale: fx.saleToConsumer() });
    expect(result.status).toBe('not_applicable');
    expect(result.candidate).toBe(false);
    expect(codes(result)).toEqual(['EI-001']);
    expect(find(result, 'EI-001').severity).toBe('info');
  });

  test('the message explains rather than accuses', () => {
    const message = find(check({ sale: fx.saleToConsumer() }), 'EI-001').message;
    expect(message).toMatch(/not an e-invoice/i);
    expect(message).toMatch(/GST-registered businesses/i);
  });

  test('an unregistered buyer is also simply out of scope', () => {
    const result = check({ sale: fx.sale({ customer_gst_type: 'unregistered' }) });
    expect(result.status).toBe('not_applicable');
  });

  test('a walk-in with no other data still raises nothing', () => {
    /* No GSTIN, no PIN, no address. None of it matters, and reporting it
       would be noise on every bill in the shop. */
    const result = check({
      sale: fx.saleToConsumer({
        customer_address: '',
        customer_city: '',
        customer_name: '',
        items: [fx.noHsn()],
      }),
    });
    expect(result.findings.filter((f) => f.severity !== 'info')).toEqual([]);
  });

  test('but a customer MARKED as a registered business is checked, even with the GSTIN blank', () => {
    /* The opposite mistake, and the more damaging one: treating a
       registered buyer with an empty GSTIN as "not applicable" would hide
       exactly the invoice the shop needs to hear about. */
    const result = check({ sale: fx.sale({ customer_gst_number: '' }) });
    expect(result.status).toBe('blocked');
    expect(codes(result)).toContain('EI-002');
  });
});

/* ------------------------------------------------------------------ *
 * Buyer
 * ------------------------------------------------------------------ */
describe('the buyer', () => {
  test('a GSTIN that fails its check digit is refused, and the message says so', () => {
    const result = check({ sale: fx.sale({ customer_gst_number: fx.BAD_CHECKSUM_GSTIN }) });
    expect(codes(result)).toContain('EI-003');
    expect(find(result, 'EI-003').message).toMatch(/does not match the rest/i);
    expect(find(result, 'EI-003').fix).toBe('customer');
  });

  test('a missing PIN code is caught', () => {
    const result = check({ sale: fx.sale({ customer_pincode: '' }) });
    expect(codes(result)).toContain('EI-005');
  });

  test('a PIN that is not six digits is caught, and quoted back', () => {
    const result = check({ sale: fx.sale({ customer_pincode: '60001' }) });
    expect(find(result, 'EI-005').message).toMatch(/"60001"/);
  });

  test('the customer record fills in what the sale does not snapshot yet', () => {
    /* customer_pincode arrives on the sale with the model PR. Until then the
       customer master answers, so the feature is usable before that lands. */
    const result = check({
      sale: fx.sale({ customer_pincode: undefined }),
      customer: fx.buyerSameState(),
    });
    expect(codes(result)).not.toContain('EI-005');
  });

  test('a missing legal name is a warning, not a block - the trade name is used', () => {
    const result = check({ sale: fx.sale({ customer_legal_name: '' }) });
    expect(find(result, 'EI-006').severity).toBe('warn');
    expect(result.status).toBe('ready');
  });

  test('no name at all is a block', () => {
    const result = check({ sale: fx.sale({ customer_name: '', customer_legal_name: '' }) });
    expect(codes(result)).toContain('EI-004');
    expect(result.status).toBe('blocked');
  });

  test('a missing address or town is caught', () => {
    expect(codes(check({ sale: fx.sale({ customer_address: '' }) }))).toContain('EI-007');
    expect(codes(check({ sale: fx.sale({ customer_city: '' }) }))).toContain('EI-007');
  });
});

/* ------------------------------------------------------------------ *
 * Seller
 * ------------------------------------------------------------------ */
describe('the shop itself', () => {
  test('no GSTIN on the branch blocks every invoice', () => {
    const result = check({ branch: fx.branch({ branch_gstin_number: '' }) });
    expect(codes(result)).toContain('EI-011');
    expect(find(result, 'EI-011').fix).toBe('branch');
  });

  test('no legal name on the branch blocks', () => {
    /* Today no branch has one - the field arrives with the model PR. Saying
       so is the honest answer, and it is why that PR is next. */
    const result = check({ branch: fx.branch({ legal_name: '' }) });
    expect(codes(result)).toContain('EI-013');
    expect(find(result, 'EI-013').message).toMatch(/GST registration/i);
  });

  test('a malformed shop PIN blocks', () => {
    expect(codes(check({ branch: fx.branch({ pincode: '60' }) }))).toContain('EI-014');
    expect(codes(check({ branch: fx.branch({ pincode: '' }) }))).toContain('EI-014');
  });

  test('a missing address or town blocks', () => {
    expect(codes(check({ branch: fx.branch({ store_address: '' }) }))).toContain('EI-015');
    expect(codes(check({ branch: fx.branch({ city: '' }) }))).toContain('EI-015');
  });

  test('a shop whose GSTIN and state disagree is warned, not blocked', () => {
    /* The export takes the state from the GSTIN, so it is internally
       consistent either way. What this catches is a data problem worth
       looking at - and EI-108 blocks the case that actually matters. */
    const result = check({ branch: fx.branch({ state: 'Karnataka' }) });
    expect(find(result, 'EI-012').severity).toBe('warn');
    expect(find(result, 'EI-012').message).toMatch(/33/);
    expect(find(result, 'EI-012').message).toMatch(/Karnataka/);
  });
});

/* ------------------------------------------------------------------ *
 * The document
 * ------------------------------------------------------------------ */
describe('the bill number', () => {
  test('a number longer than sixteen characters cannot go on an e-invoice', () => {
    const result = check({ sale: fx.sale({ sales_id: 'SUPERLONGPREFIX-000045' }) });
    expect(codes(result)).toContain('EI-021');
    /* And it names the cause, which is a setting, not the sale. */
    expect(find(result, 'EI-021').message).toMatch(/sales prefix/i);
  });

  test('a character the schema does not allow is caught', () => {
    expect(codes(check({ sale: fx.sale({ sales_id: 'SB1#D1-45' }) }))).toContain('EI-021');
    expect(codes(check({ sale: fx.sale({ sales_id: 'SB1 D1 45' }) }))).toContain('EI-021');
  });

  test('a number starting with 0, / or - is refused', () => {
    for (const bad of ['0SB1D1-45', '/SB1D1-45', '-SB1D1-45']) {
      expect(codes(check({ sale: fx.sale({ sales_id: bad }) }))).toContain('EI-021');
    }
  });

  test('the numbers this application actually mints are accepted', () => {
    /* buildDocNumber produces S<branch><device>-000045, and the fallback is
       <prefix><n>. Both must pass, or the feature blocks every sale. */
    for (const good of ['SB1D1-000045', 'S45', 'SID000005', 'INV/2026/0001']) {
      expect(codes(check({ sale: fx.sale({ sales_id: good }) }))).not.toContain('EI-021');
    }
  });

  test('a sale with no number or no date is blocked', () => {
    expect(codes(check({ sale: fx.sale({ sales_id: '' }) }))).toContain('EI-021');
    expect(codes(check({ sale: fx.sale({ date: null }) }))).toContain('EI-024');
  });
});

describe('the reporting window', () => {
  test('a shop above ten crore is warned when an invoice passes thirty days', () => {
    const result = check({
      sale: fx.sale(),
      state: fx.state({ reportingWindow: true }),
      now: fx.MUCH_LATER,
    });
    expect(find(result, 'EI-022').severity).toBe('warn');
    expect(find(result, 'EI-022').message).toMatch(/30 days/);
  });

  test('a shop below that threshold is not warned - the rule does not apply to them', () => {
    const result = check({ state: fx.state({ reportingWindow: false }), now: fx.MUCH_LATER });
    expect(codes(result)).not.toContain('EI-022');
  });

  test('a fresh invoice is never warned', () => {
    const result = check({ state: fx.state({ reportingWindow: true }), now: fx.NOW });
    expect(codes(result)).not.toContain('EI-022');
  });
});

describe('supplies that cannot be represented yet', () => {
  test('an export or SEZ supply is blocked rather than sent as B2B', () => {
    const result = check({ sale: fx.sale({ supply_type: 'EXPWP' }) });
    expect(codes(result)).toContain('EI-023');
  });

  test('reverse charge is blocked', () => {
    expect(codes(check({ sale: fx.sale({ reverse_charge: true }) }))).toContain('EI-023');
  });

  test('an absent supply type means ordinary B2B and passes', () => {
    expect(codes(check({ sale: fx.sale({ supply_type: undefined }) }))).not.toContain('EI-023');
  });
});

/* ------------------------------------------------------------------ *
 * Lines
 * ------------------------------------------------------------------ */
describe('the lines', () => {
  test('the HSN placeholder the installer seeds is caught', () => {
    /* install.service.js writes hsncode: '0' on demo items, so this is the
       first thing a real shop will hit. */
    const result = check({ sale: fx.sale({ items: [fx.noHsn()] }) });
    expect(codes(result)).toContain('EI-101');
    expect(find(result, 'EI-101').item).toBe('Fixture with no HSN');
    expect(find(result, 'EI-101').line).toBe(1);
    expect(find(result, 'EI-101').fix).toBe('item');
  });

  test('a missing HSN is caught', () => {
    expect(codes(check({ sale: fx.sale({ items: [fx.riceIntra({ hsncode: '' })] }) }))).toContain(
      'EI-101'
    );
  });

  test('an HSN that is not 4, 6 or 8 digits is caught', () => {
    for (const bad of ['100', '10063', '1006300', 'ABCD']) {
      const result = check({ sale: fx.sale({ items: [fx.riceIntra({ hsncode: bad })] }) });
      expect(codes(result)).toContain('EI-102');
    }
  });

  test('a four-digit HSN blocks a shop that must e-invoice', () => {
    const result = check({
      sale: fx.sale({ items: [fx.riceIntra({ hsncode: '1006' })] }),
      state: fx.state({ liable: true }),
    });
    expect(find(result, 'EI-103').severity).toBe('block');
  });

  test('and only warns a shop below the threshold', () => {
    /* The schema allows four digits; the portals refuse them from anyone at
       or above five crore, which is everyone the mandate covers. A smaller
       shop preparing early should hear about it without being stopped. */
    const result = check({
      sale: fx.sale({ items: [fx.riceIntra({ hsncode: '1006' })] }),
      state: fx.state({ liable: false }),
    });
    expect(find(result, 'EI-103').severity).toBe('warn');
    expect(result.status).toBe('ready');
  });

  test('a service needs a six-digit SAC in chapter 99', () => {
    const result = check({
      sale: fx.sale({ items: [fx.service({ hsncode: '85171300' })] }),
    });
    expect(codes(result)).toContain('EI-104');
    expect(find(result, 'EI-104').message).toMatch(/99/);
  });

  test('a proper SAC on a service passes', () => {
    const result = check({ sale: fx.sale({ items: [fx.service()] }) });
    expect(codes(result)).not.toContain('EI-104');
    expect(codes(result)).not.toContain('EI-103');
  });

  test('a unit with no GST code is caught and the unit is named', () => {
    const result = check({ sale: fx.sale({ items: [fx.unmappedUnit()] }) });
    expect(codes(result)).toContain('EI-105');
    expect(find(result, 'EI-105').message).toMatch(/"sheet"/);
    expect(find(result, 'EI-105').fix).toBe('units');
  });

  test('a rate the portal does not carry is blocked', () => {
    const result = check({ sale: fx.sale({ items: [fx.riceIntra({ tax_rate: 17 })] }) });
    expect(find(result, 'EI-106').severity).toBe('block');
  });

  test('a withdrawn slab is a warning - the portal still takes it for older invoices', () => {
    const result = check({ sale: fx.sale({ items: [fx.retiredSlab()] }) });
    expect(find(result, 'EI-111').severity).toBe('warn');
    expect(find(result, 'EI-111').message).toMatch(/22 September 2025/);
    expect(codes(result)).not.toContain('EI-106');
  });

  test('the live GST 2.0 slabs all pass', () => {
    for (const rate of [0, 0.25, 1.5, 3, 5, 18, 40]) {
      const result = check({ sale: fx.sale({ items: [fx.riceIntra({ tax_rate: rate })] }) });
      expect(codes(result)).not.toContain('EI-106');
      expect(codes(result)).not.toContain('EI-111');
    }
  });

  test('a zero or missing quantity is caught', () => {
    expect(codes(check({ sale: fx.sale({ items: [fx.riceIntra({ quantity: 0 })] }) }))).toContain(
      'EI-112'
    );
  });

  test('an empty sale is blocked', () => {
    expect(codes(check({ sale: fx.sale({ items: [] }) }))).toContain('EI-025');
  });

  test('more than a thousand lines is blocked', () => {
    const many = Array.from({ length: 1001 }, () => fx.riceIntra());
    const result = check({ sale: fx.sale({ items: many }) });
    expect(codes(result)).toContain('EI-110');
  });

  test('every line finding names its line and its item', () => {
    /* A fifty-line invoice reporting "invalid HSN" with no further detail is
       not a report, it is a search task. */
    const result = check({
      sale: fx.sale({ items: [fx.riceIntra(), fx.noHsn(), fx.unmappedUnit()] }),
    });
    for (const finding of result.findings.filter((f) => f.line)) {
      expect(typeof finding.item).toBe('string');
      expect(finding.item.length).toBeGreaterThan(0);
      expect(finding.message).toContain(finding.item);
    }
    expect(find(result, 'EI-101').line).toBe(2);
    expect(find(result, 'EI-105').line).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * The check that earns the module
 * ------------------------------------------------------------------ */
describe('the tax split against where the buyer actually is', () => {
  test('IGST charged to a buyer in the same state is blocked', () => {
    /* The split was decided at sale time by comparing two typed state names.
       The portal decides it from the GSTIN and refuses the mismatch, so this
       is a shop billing happily for months and finding out at submission. */
    const result = check({
      sale: fx.sale({ items: [fx.riceInter(), fx.handsetInter()] }),
    });
    expect(find(result, 'EI-108').severity).toBe('block');
    expect(find(result, 'EI-108').message).toMatch(/same state/i);
    expect(find(result, 'EI-108').fix).toBe('customer');
  });

  test('CGST and SGST charged across a state border is blocked', () => {
    const result = check({
      sale: fx.saleInterState({ items: [fx.riceIntra(), fx.handsetIntra()] }),
    });
    expect(find(result, 'EI-108').severity).toBe('block');
    expect(find(result, 'EI-108').message).toMatch(/different states/i);
  });

  test('the message names both state codes, so the wrong one can be found', () => {
    const message = find(
      check({ sale: fx.saleInterState({ items: [fx.riceIntra()] }) }),
      'EI-108'
    ).message;
    expect(message).toMatch(/33/);
    expect(message).toMatch(/29/);
  });

  test('an unreadable GSTIN produces no split finding - it is already reported', () => {
    /* Reporting a split mismatch it cannot justify would be a second,
       misleading error for one underlying problem. */
    const result = check({ sale: fx.sale({ customer_gst_number: 'rubbish' }) });
    expect(codes(result)).toContain('EI-003');
    expect(codes(result)).not.toContain('EI-108');
  });

  test('an untaxed sale raises nothing', () => {
    const result = check({
      sale: fx.sale({
        items: [fx.riceIntra({ tax_rate: 0, tax_amount: 0, cgst_tax: 0, sgst_tax: 0 })],
      }),
    });
    expect(codes(result)).not.toContain('EI-108');
  });
});

/* ------------------------------------------------------------------ *
 * State of the invoice
 * ------------------------------------------------------------------ */
describe('invoices held back', () => {
  test('a sale with a return on it is held until credit notes exist', () => {
    const result = check({
      sale: fx.sale({ items_return: [{ returnArray: [] }], sale_process: 'PartialReturn' }),
    });
    expect(find(result, 'EI-301').severity).toBe('block');
    expect(find(result, 'EI-301').message).toMatch(/credit note/i);
  });

  test('an invoice that already has an IRN is flagged, not silently re-exported', () => {
    const result = check({
      sale: fx.sale({ einvoice: { irn: 'a'.repeat(64) } }),
    });
    expect(find(result, 'EI-302').severity).toBe('warn');
    expect(find(result, 'EI-302').message).toMatch(/credit or debit note/i);
  });
});

/* ------------------------------------------------------------------ *
 * Batch
 * ------------------------------------------------------------------ */
describe('checking a period', () => {
  test('counts split into ready, blocked and not applicable', () => {
    const result = validate.checkMany(
      [fx.sale(), fx.saleInterState(), fx.saleToConsumer(), fx.sale({ items: [fx.noHsn()] })],
      { branch: fx.branch(), state: fx.state(), now: fx.NOW }
    );
    expect(result.counts).toEqual({ ready: 2, blocked: 1, not_applicable: 1 });
    expect(result.examined).toBe(4);
  });

  test('each row carries what the page shows beside the findings', () => {
    const [row] = validate.checkMany([fx.sale()], {
      branch: fx.branch(),
      state: fx.state(),
      now: fx.NOW,
    }).rows;
    expect(row.sales_id).toBe('SB1D1-000045');
    expect(row.customer_name).toBe('Fixture Retail LLP');
    expect(row.total).toBe(12325);
    expect(row.status).toBe('ready');
  });

  test('the customer master is consulted per sale when one is supplied', () => {
    const buyer = fx.buyerSameState();
    const result = validate.checkMany([fx.sale({ customer_pincode: undefined })], {
      branch: fx.branch(),
      customersById: { [buyer._id]: buyer },
      state: fx.state(),
      now: fx.NOW,
    });
    expect(result.counts.ready).toBe(1);
  });

  test('nothing to check is not an error', () => {
    const result = validate.checkMany([], { branch: fx.branch(), state: fx.state() });
    expect(result.counts).toEqual({ ready: 0, blocked: 0, not_applicable: 0 });
  });
});

/* ------------------------------------------------------------------ *
 * Contract of the module itself
 * ------------------------------------------------------------------ */
describe('the module keeps its promises', () => {
  test('it never throws on a malformed sale', () => {
    /* This runs over a shop's whole history, including rows written by
       versions that no longer exist. One bad document must not take the
       readiness page down. */
    const junk = [
      {},
      { customer_gst_type: 'regular' },
      { customer_gst_type: 'regular', items: [{}, null] },
      { customer_gst_type: 'regular', items: [null, undefined, 'a string', 7] },
      { customer_gst_type: 'regular', items: 'not an array', date: 'nonsense' },
    ];
    for (const sale of junk) {
      expect(() => check({ sale })).not.toThrow();
    }
    expect(validate.checkSale({}).status).toBe('blocked');
    expect(() => validate.checkMany(null, {})).not.toThrow();
    expect(() => validate.checkMany([null], { branch: fx.branch() })).not.toThrow();
  });

  test('a damaged line is reported, never silently dropped', () => {
    /* Exporting an invoice with a line quietly missing would file a total
       that does not match the bill the shop printed. Holding it back is the
       only safe answer. */
    const result = check({ sale: fx.sale({ items: [fx.riceIntra(), null] }) });
    expect(find(result, 'EI-113').severity).toBe('block');
    expect(find(result, 'EI-113').line).toBe(2);
    expect(result.status).toBe('blocked');
  });

  test('it writes nothing - the sale it was given is unchanged', () => {
    /* Same discipline as gst-readiness.js: a checker that also corrects is
       one nobody can trust to report honestly. */
    const sale = fx.sale({ items: [fx.noHsn()] });
    const before = JSON.stringify(sale);
    check({ sale });
    expect(JSON.stringify(sale)).toBe(before);
  });

  test('no finding leaks the internal severity override flag', () => {
    const result = check({
      sale: fx.sale({ items: [fx.riceIntra({ hsncode: '1006' })] }),
      state: fx.state({ liable: false }),
    });
    for (const finding of result.findings) {
      expect(finding).not.toHaveProperty('severityOverride');
      expect(['block', 'warn', 'info']).toContain(finding.severity);
    }
  });

  test('every finding carries a code, a severity, a message and a fix slot', () => {
    const result = check({
      sale: fx.sale({ items: [fx.noHsn(), fx.unmappedUnit()], sales_id: 'SUPERLONGPREFIX-000045' }),
      branch: fx.branch({ legal_name: '' }),
    });
    expect(result.findings.length).toBeGreaterThan(3);
    for (const finding of result.findings) {
      expect(finding.code).toMatch(/^EI-\d{3}$/);
      expect(finding.message.length).toBeGreaterThan(10);
      expect(finding).toHaveProperty('fix');
      expect(finding).toHaveProperty('title');
    }
  });

  test('an unknown finding code fails loudly rather than rendering blank', () => {
    const { make } = require('../../../src/services/einvoice/findings');
    expect(() => make('EI-999', 'nope')).toThrow(/Unknown e-invoice finding code/);
  });
});
