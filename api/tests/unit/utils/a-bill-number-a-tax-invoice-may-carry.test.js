'use strict';

/*
 * The year in the bill number, and the sixteen characters it has to live in.
 *
 * Owner, with a photograph of a hotel's tax invoice numbered
 * VR26-27VIR006782: "we need year pattern required in the sales bill number...
 * you suggest per day increase or year wise reset better tell me international
 * standards." Then: "i accept recommandation and may configurable if people
 * from EU and international." And: "Blocker fix that."
 *
 * THE BLOCKER
 *
 * India's CGST Rules 2017, Rule 46(b): a tax invoice number is a consecutive
 * serial, NOT EXCEEDING SIXTEEN CHARACTERS, made only of letters, numerals and
 * the two separators "-" and "/", UNIQUE FOR A FINANCIAL YEAR.
 *
 * Our number is already SB1D14-000051 - thirteen characters of type letter,
 * branch, till and a six digit counter. Adding "26-27" the obvious way gives
 * eighteen, which is not a legal invoice number. That is the blocker, and the
 * reference invoice is exactly sixteen because whoever built it hit the same
 * wall.
 *
 * WHY A YEAR AND NOT A DAY
 *
 * The financial year is the unit of uniqueness the rule names. A daily reset
 * repeats numbers inside the year unless the date is in the number, and a date
 * costs six to eight of the sixteen characters. It also destroys the property
 * an auditor uses: one consecutive run per year shows a gap when a bill is
 * cancelled; three hundred and sixty five short runs show nothing.
 */

const assert = require('node:assert');

const bill = require('../../../src/utils/bill-number');

/* ------------------------------------------------------------ the year */

test('the Indian financial year runs April to March, not January to December', () => {
  const fy = (y, m, d) => bill.periodFor(new Date(y, m - 1, d), { reset: 'financial' });

  assert.strictEqual(fy(2026, 9, 14).key, '2026-2027', 'September 2026 is FY 2026-27');
  assert.strictEqual(
    fy(2027, 3, 31).key,
    '2026-2027',
    'the last day of March is still the old year'
  );
  assert.strictEqual(fy(2027, 4, 1).key, '2027-2028', 'the first of April starts a new one');
});

test('A DATE IN JANUARY BELONGS TO THE YEAR THAT BEGAN LAST APRIL', () => {
  /*
   * The one that would be wrong without thinking about it, and the damage is
   * invisible until an audit: every bill from January to March gets the next
   * year's number, so one financial year holds two series and neither is
   * consecutive.
   */
  for (const month of [1, 2, 3]) {
    const p = bill.periodFor(new Date(2027, month - 1, 15), { reset: 'financial' });
    assert.strictEqual(p.key, '2026-2027', `month ${month} of 2027 is still FY 2026-27`);
    assert.strictEqual(p.label, '27');
  }
});

test('the label is the year it ENDS in, which is what a customer reads', () => {
  /* A bill handed over in February 2027 says 27, the same as one from
     September 2026, because they are the same financial year. */
  assert.strictEqual(bill.periodFor(new Date(2026, 8, 14), { reset: 'financial' }).label, '27');
  assert.strictEqual(bill.periodFor(new Date(2027, 1, 15), { reset: 'financial' }).label, '27');
});

test('a shop outside India can use the calendar year, or none at all', () => {
  /* Owner: "may configurable if people from EU and international." The EU VAT
     Directive asks only for a sequential number that uniquely identifies the
     invoice - no length limit, no prescribed reset. */
  const cal = bill.periodFor(new Date(2027, 0, 1), { reset: 'calendar' });
  assert.strictEqual(cal.key, '2027');
  assert.strictEqual(cal.label, '27');

  const off = bill.periodFor(new Date(2027, 0, 1), { reset: 'off' });
  assert.strictEqual(off.key, '');
  assert.strictEqual(off.label, '', 'a shop that wants no year got one anyway');
});

test('and the financial year start month itself is a setting', () => {
  /* The UK runs April too, Australia July, the US October for federal. */
  const july = bill.periodFor(new Date(2026, 7, 1), {
    reset: 'financial',
    financialYearStartMonth: 7,
  });
  assert.strictEqual(july.key, '2026-2027');
  const june = bill.periodFor(new Date(2026, 5, 1), {
    reset: 'financial',
    financialYearStartMonth: 7,
  });
  assert.strictEqual(june.key, '2025-2026', 'June is before a July year starts');
});

test('rubbish in does not become a confident wrong year', () => {
  assert.strictEqual(bill.periodFor(new Date('nonsense'), { reset: 'financial' }).key, '');
  assert.strictEqual(bill.periodFor(new Date(2026, 1, 1), { reset: 'nonsense' }).key, '');
});

/* ------------------------------------------------- sixteen characters */

test('THE BLOCKER: the real number fits, with the year and six digits', () => {
  /* SB1D14-000051 was thirteen. This is the whole point of the exercise. */
  const r = bill.compose({
    typeLetter: 'S',
    branchCode: 'B1',
    deviceCode: 'D14',
    period: '27',
    sequence: 51,
  });
  assert.strictEqual(r.number, 'SB1D14-27-000051');
  assert.strictEqual(r.number.length, 16);
  assert.ok(r.ok, r.warning);
  assert.ok(bill.validate(r.number).ok);
});

test('NOTHING IT RETURNS IS EVER LONGER THAN SIXTEEN', () => {
  /*
   * The rule this module exists to keep. An over-length number is not a
   * cosmetic problem: it is an invoice somebody else finds months later, on a
   * document that cannot be reissued.
   */
  const codes = ['', 'B1', 'B10', 'B100', 'BRANCH99'];
  const devices = ['', 'D1', 'D14', 'D1000', 'DEVICE99'];
  const periods = ['', '27', '2027'];
  for (const branchCode of codes) {
    for (const deviceCode of devices) {
      for (const period of periods) {
        for (const sequence of [0, 1, 999999, 12345678]) {
          const r = bill.compose({
            typeLetter: 'S',
            branchCode,
            deviceCode,
            period,
            sequence,
          });
          const v = bill.validate(r.number);
          assert.ok(
            v.ok,
            `illegal number ${JSON.stringify(r.number)} (${r.number.length}) from ` +
              `${branchCode}/${deviceCode}/${period}/${sequence}: ${v.reason}`
          );
        }
      }
    }
  }
});

test('when it does not fit, the SEQUENCE narrows before anything else', () => {
  /*
   * The only safe thing to shed. Dropping the year would break uniqueness for
   * the financial year; dropping the till code would let two tills mint the
   * same number.
   */
  const r = bill.compose({
    typeLetter: 'S',
    branchCode: 'B10',
    deviceCode: 'D100',
    period: '27',
    sequence: 51,
  });
  assert.strictEqual(r.number, 'SB10D100-27-0051');
  assert.strictEqual(r.number.length, 16);
  assert.match(r.warning, /shortened to 4 digits/);
  assert.ok(!r.ok, 'a shortened counter should still be reported');
});

test('and if even that will not do, the YEAR goes - never the legality', () => {
  const r = bill.compose({
    typeLetter: 'S',
    branchCode: 'B100',
    deviceCode: 'D1000',
    period: '27',
    sequence: 51,
  });
  assert.ok(bill.validate(r.number).ok, 'returned something illegal');
  assert.ok(!r.number.includes('-27-'), 'kept the year and broke the length');
  assert.match(r.warning, /year was left out/);
});

test('a prefix longer than a whole invoice number is cut, not returned', () => {
  /*
   * This is where the first version recursed until the stack gave out: it
   * handled "too long" by calling itself without the year, and without the
   * year it was still too long.
   */
  let r;
  assert.doesNotThrow(() => {
    r = bill.compose({
      typeLetter: 'S',
      branchCode: 'BRANCH99',
      deviceCode: 'DEVICE99',
      period: '27',
      sequence: 1,
    });
  }, 'composing a long prefix threw');
  assert.ok(bill.validate(r.number).ok);
  assert.match(r.warning, /Set a shorter prefix/);
});

/* --------------------------------------------------------- the charset */

test('only letters, numbers, hyphen and slash - the rule names those two', () => {
  assert.ok(bill.validate('SB1D14-27-000051').ok);
  assert.ok(bill.validate('VR26-27VIR006782').ok, "the owner's own reference invoice");
  assert.ok(bill.validate('INV/2027/00001').ok, 'slash is allowed too');

  for (const bad of ['SB1_D14-000051', 'SB1 D14-000051', 'SB1.D14-000051', 'SB1#14']) {
    assert.ok(!bill.validate(bad).ok, `${bad} should be refused`);
  }
});

test('and the ceiling is checked on anything, not only what we build', () => {
  /* Numbers arrive from imports and from a shop's own prefix too. */
  assert.ok(!bill.validate('SB1D14-2026-2027-000051').ok);
  assert.match(bill.validate('SB1D14-2026-2027-000051').reason, /may not exceed 16/);
  assert.ok(!bill.validate('').ok);
});

test('the reference invoice is exactly at the ceiling, which is the point', () => {
  /* VR26-27VIR006782. Sixteen characters, not a coincidence - it is what a
     shop ends up with when it designs against this rule. */
  assert.strictEqual('VR26-27VIR006782'.length, bill.MAX_LENGTH);
});

/* --------------------------------------- it renamed nothing on the way in */

test('WITH NO YEAR ASKED FOR IT PRODUCES EXACTLY THE OLD NUMBER, 72 times over', () => {
  /*
   * The one that matters on merge day.
   *
   * buildDocNumber used to be a single template literal. Every bill number on
   * ninety shops has its shape, every sales report sorts on it, and the unique
   * index that stops two tills issuing one number is built on it. Routing it
   * through compose() is only safe if, for a shop that has asked for nothing,
   * the answer is the same byte for byte - so it is checked against the
   * expression it replaced rather than against what I meant to write.
   *
   * SALES ONLY. buildDocNumber takes an `isReturn` flag that puts "R-" on the
   * front, and nothing in the product passes it. Writing this test found that
   * the old expression produced R-SB12D999-000001 - SEVENTEEN characters, and
   * not a number a tax invoice may carry. compose() shortens it to fifteen and
   * says why, so that path is now legal where it was not; it is left out of
   * this comparison deliberately rather than pinned to the old wrong answer.
   */
  const theOldWay = (typeLetter, branchCode, deviceCode, n) =>
    `${typeLetter}${branchCode}${deviceCode}-${String(n).padStart(6, '0')}`;

  let checked = 0;
  for (const branchCode of ['B1', 'B2', 'B12']) {
    for (const deviceCode of ['D1', 'D14', 'D999']) {
      for (const n of [1, 7, 42, 999, 1000, 51, 123456, 999999]) {
        const built = bill.compose({
          typeLetter: 'S',
          branchCode,
          deviceCode,
          period: '',
          sequence: n,
          sequenceWidth: 6,
        });
        assert.strictEqual(
          built.number,
          theOldWay('S', branchCode, deviceCode, n),
          `renamed a bill: ${branchCode} ${deviceCode} ${n}`
        );
        assert.strictEqual(built.ok, true, 'the old shape no longer fits');
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 72, `only ${checked} combinations covered`);
});

test('and with a year asked for it stays inside the sixteen', () => {
  /* Same shapes, with two characters of year added. The running number is
     what gives way, and only when it has to. */
  for (const branchCode of ['B1', 'B2', 'B12']) {
    for (const deviceCode of ['D1', 'D14', 'D999']) {
      for (const n of [1, 999999]) {
        const built = bill.compose({
          typeLetter: 'S',
          branchCode,
          deviceCode,
          period: '27',
          sequence: n,
          sequenceWidth: 6,
        });
        assert.ok(
          built.number.length <= bill.MAX_LENGTH,
          `${built.number} is ${built.number.length} characters`
        );
        assert.match(built.number, /^[A-Za-z0-9/-]+$/);
        /* The year is never the thing dropped while anything else can give:
           uniqueness for the financial year is what it is there for. */
        if (built.number.length === bill.MAX_LENGTH || built.ok) {
          assert.match(built.number, /-27-/);
        }
      }
    }
  }
});
