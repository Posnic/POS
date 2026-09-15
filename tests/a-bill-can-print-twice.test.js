/*
 * A BILL ASKED FOR FROM THE FLOOR CAN COME OUT TWICE.
 *
 * Owner: "when captain app send print bill we need to have 2 copies actually.
 * better to keep this as settigs how many copies in the settings page."
 *
 * A restaurant hands one to the guest and keeps one. Until now the second was
 * a second walk to the printer, so the shop either did without it or a waiter
 * lost a minute per table on the busiest night of the week.
 *
 * ONE JOB PER COPY. Every till already on a shop floor drains the print queue
 * and prints what it is handed, so a shop gets its second copy the moment it
 * changes the setting - with no new version of the desktop app. It is also the
 * truer shape: each copy succeeds or fails on its own.
 *
 * A setting on the legacy page is five separate links and any one of them
 * missing drops the value with no error, so this walks all five.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...bits) => fs.readFileSync(path.join(ROOT, ...bits), 'utf8');

const FORM = read('frontend', 'modules', 'settings_write.html');
const PAGE = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js');
const SETTING = read('api', 'src', 'models', 'setting.model.js');
const BRANCH = read('api', 'src', 'models', 'branch.model.js');
const SALES = read('api', 'src', 'repositories', 'sale.repository.js');

/** Lift one `function name(...) {...}` out by brace matching. */
function lift(source, name) {
  const from = source.indexOf(`function ${name}(`);
  assert.notStrictEqual(from, -1, `${name} is gone - renamed, or inlined?`);
  let depth = 0;
  for (let i = source.indexOf('{', from); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  throw new Error(`${name} never closes`);
}

// eslint-disable-next-line no-new-func
const billCopies = new Function(`${lift(SALES, 'billCopies')}\nreturn billCopies;`)();

/* ------------------------------------------------- what the number means */

test('a shop that has never touched it prints one', () => {
  /*
   * The whole safety of shipping this: ninety shops print bills today and
   * none of them asked for a second copy this morning.
   */
  assert.strictEqual(billCopies({}), 1);
  assert.strictEqual(billCopies(undefined), 1);
  assert.strictEqual(billCopies({ bill_print_copies: null }), 1);
});

test('two means two', () => {
  assert.strictEqual(billCopies({ bill_print_copies: 2 }), 2);
});

test('the form posts a string, and a string is a number here', () => {
  /* Every value on that page arrives as text. A setting read with `Number`
     somewhere else in this file is the reason this one is read carefully. */
  assert.strictEqual(billCopies({ bill_print_copies: '2' }), 2);
  assert.strictEqual(billCopies({ bill_print_copies: '3' }), 3);
});

test('nonsense prints one, never none and never NaN', () => {
  assert.strictEqual(billCopies({ bill_print_copies: 'two' }), 1);
  assert.strictEqual(billCopies({ bill_print_copies: 0 }), 1);
  assert.strictEqual(billCopies({ bill_print_copies: -4 }), 1);
  assert.strictEqual(billCopies({ bill_print_copies: '' }), 1);
});

test('a silly number cannot spend a roll of paper on one table', () => {
  /*
   * The page offers 1-3, but a branch document can hold anything - an import,
   * an API call, a finger on a keyboard. The cap is where it is READ, because
   * that is the only place every route passes through.
   */
  assert.strictEqual(billCopies({ bill_print_copies: 40 }), 3);
  assert.strictEqual(billCopies({ bill_print_copies: 2.9 }), 2);
});

/* ------------------------------------------------- the five links, in order */

test('1. the control is on the Receipt Print tab, with an id and a name', () => {
  /* Without BOTH, the page reads it or posts it but never does the pair. */
  assert.match(FORM, /id="bill_print_copies"/, 'no control on the settings page');
  assert.match(FORM, /name="bill_print_copies"/, 'the control has no name, so nothing posts it');
  const tab = FORM.slice(FORM.indexOf('id="core-tab-print"'));
  assert.ok(
    tab.indexOf('bill_print_copies') > -1 && tab.indexOf('bill_print_copies') < 20000,
    'the control is not in the Receipt Print tab, where a shopkeeper would look for it'
  );
});

test('2. the page loads it and posts it', () => {
  assert.match(PAGE, /\$\("#bill_print_copies option\[value='" \+ bill_copies/,
    'the saved value never reaches the control');
  assert.match(PAGE, /bill_print_copies: \$\('#bill_print_copies'\)\.val\(\)/,
    'the chosen value is never posted');
  assert.match(PAGE, /Number\(data\.bill_print_copies\) > 0 \? Number\(data\.bill_print_copies\) : 1/,
    'a branch with no value saved does not fall back to one');
});

test('3. the settings model accepts it and maps it', () => {
  assert.match(SETTING, /bill_print_copies: data\.bill_print_copies/, 'the write object drops it');
  assert.match(SETTING, /bill_print_copies: 'bill_print_copies'/, 'the field map drops it');
});

test('4. the branch carries it, projects it, and defaults it', () => {
  assert.match(BRANCH, /bill_print_copies: \{ type: Number, default: 1 \}/, 'no schema field');
  assert.match(BRANCH, /bill_print_copies: \{ type: 'Number', select: true \}/, 'not projected');
  assert.match(BRANCH, /bill_print_copies: 1,/, 'not in the defaults a new branch is built from');
});

test('5. and something actually reads it', () => {
  /*
   * The link that is easiest to forget, and the one that makes the other four
   * worth having. A loop per copy around the job that carries the bill.
   */
  assert.match(SALES, /const copies = billCopies\(shop\);/, 'the queue never asks');
  assert.match(SALES, /for \(let copy = 1; copy <= copies; copy \+= 1\)/, 'one job however many copies');
  assert.match(SALES, /copies > 1 \? `Table \$\{table\} \(\$\{copy\} of \$\{copies\}\)`/,
    'two identical labels at the counter, with nothing to say they are a pair');
});

test('the copies come from the SHOP, not from the handset', () => {
  /*
   * A phone asking for four copies would be a phone deciding how the shop
   * spends paper. The count is read from the branch the sale belongs to, and
   * `shop` is the branch document this code already loaded for the letterhead.
   */
  const where = SALES.indexOf('const copies = billCopies(shop);');
  const before = SALES.slice(Math.max(0, where - 3000), where);
  assert.match(before, /BranchModel\.findById/, 'the shop is not the branch document');
});
