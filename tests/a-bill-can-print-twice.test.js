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

/* ------------------------------------------- who decides, and who cannot */

test('the handset decides, and the shop is the fallback', () => {
  /*
   * Owner: "its better two copies from captain itself... configuration change
   * reequired pos guy wont have permission. lets keep in app itself."
   *
   * The person who wants a second copy is the one holding the phone. A request
   * that names a number is honoured; one that says nothing gets the shop's own
   * setting, which is how an older handset keeps working.
   */
  assert.strictEqual(billCopies({ bill_print_copies: 1 }, 2), 2);
  assert.strictEqual(billCopies({ bill_print_copies: 3 }, 1), 1);
  assert.strictEqual(billCopies({ bill_print_copies: 2 }, undefined), 2);
  assert.strictEqual(billCopies({}, undefined), 1);
});

test('a phone cannot spend a roll of paper on one table', () => {
  /* Clamped wherever the number came from. A handset is not more trusted than
     a branch document just because it is closer to the guest. */
  assert.strictEqual(billCopies({}, 40), 3);
  assert.strictEqual(billCopies({}, 'lots'), 1);
  assert.strictEqual(billCopies({}, 0), 1);
  assert.strictEqual(billCopies({}, -2), 1);
});

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

test('a repeated tap does not queue the bill again', () => {
  /*
   * THE THING THAT MADE COPIES DANGEROUS. A waiter walking to the counter taps
   * Print bill again because nothing has come out yet. The queue used to be
   * guarded by how many tickets are OPEN rather than how many this tap marked,
   * so two taps meant two bills - and with copies at two, four.
   *
   * The intent was always in the update, which skips a ticket that already
   * carries a timestamp. Taking the ids FIRST is what joins the two.
   */
  assert.match(SALES, /const askedIds = asking\.map\(\(row\) => row\._id\);/,
    'the tickets this tap marked are not identified');
  assert.match(SALES, /if \(askedIds\.length > 0\) \{/,
    'the queue is still guarded by what is open rather than what changed');
  assert.match(SALES, /Model\.find\(\{ _id: \{ \$in: askedIds \} \}\)/,
    'the queue still reads every open ticket, including ones already asked for');
  assert.ok(
    !/if \(waiting > 0\) \{[\s\S]{0,400}queuePrintJob/.test(SALES),
    'the open-ticket count still guards the queue'
  );
});

test('the count reaches the queue from the request', () => {
  const CONTROLLER = read('api', 'src', 'controllers', 'sales.controller.js');
  const SERVICE = read('api', 'src', 'services', 'sale.service.js');
  assert.match(CONTROLLER, /req\.body\.copies \|\| req\.body\.bill_copies/, 'the route drops it');
  assert.match(SERVICE, /requestBillPrintModel\(branchId, tableNumber, askedBy, \{[\s\S]{0,120}copies,/,
    'the service drops it');
  assert.match(SALES, /const copies = billCopies\(shop, copiesAsked\);/, 'the queue never sees it');
});

test('5. and something actually reads it', () => {
  /*
   * The link that is easiest to forget, and the one that makes the other four
   * worth having. A loop per copy around the job that carries the bill.
   */
  assert.match(SALES, /const copies = billCopies\(shop, copiesAsked\);/, 'the queue never asks');
  assert.match(SALES, /for \(let copy = 1; copy <= copies; copy \+= 1\)/, 'one job however many copies');
  assert.match(SALES, /copies > 1 \? `Table \$\{table\} \(\$\{copy\} of \$\{copies\}\)`/,
    'two identical labels at the counter, with nothing to say they are a pair');
});

test('a handset may name the number, but never how the shop is billed for it', () => {
  /*
   * The owner moved this into the app on purpose: the person who wants a
   * second copy is the one holding the phone, not somebody with access to the
   * till's settings page.
   *
   * What does NOT move is the ceiling. A request is honoured up to three
   * copies and no further, and the shop document it falls back to is read
   * here - the branch this sale belongs to, already loaded for the letterhead,
   * never anything the phone said about which shop it is.
   */
  const where = SALES.indexOf('const copies = billCopies(shop, copiesAsked);');
  const before = SALES.slice(Math.max(0, where - 3000), where);
  assert.match(before, /BranchModel\.findById/, 'the fallback is not the branch document');

  assert.strictEqual(billCopies({ bill_print_copies: 1 }, 99), 3, 'a phone set the ceiling');
  assert.strictEqual(billCopies({ bill_print_copies: 99 }, undefined), 3, 'a branch set the ceiling');
});
