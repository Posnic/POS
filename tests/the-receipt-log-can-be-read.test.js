/*
 * THE RECEIPT LOG HAS A SCREEN.
 *
 * Owner: "how can i verif print out ?"
 *
 * He could not. `src/receipt-log.js` has recorded every receipt this till
 * TRIED to print since the day it was written - which printer, how long it
 * took, and what the printer said back - and `receipt:get-logs` hands it over
 * through the preload. Nothing read it.
 *
 * That is the third time this feature has produced a reading that is taken, is
 * correct, and reaches nobody: BillManager.getStatus() was the first, the
 * printing key was the second. A record is only worth keeping if somebody can
 * open it on the machine that has the problem.
 *
 * The functions are read OUT of hardware-manager.html rather than copied, so
 * the test cannot keep passing while the screen does something else.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..', 'src');
const HTML = fs.readFileSync(path.join(ROOT, 'hardware-manager.html'), 'utf8');

/** Lift one function out of the page by brace matching. */
function lift(name) {
  let from = HTML.indexOf(`function ${name}(`);
  assert.notStrictEqual(from, -1, `${name} is gone from Hardware Manager`);
  if (HTML.slice(from - 6, from) === 'async ') from -= 6;
  let depth = 0;
  for (let i = HTML.indexOf('{', from); i < HTML.length; i += 1) {
    if (HTML[i] === '{') depth += 1;
    else if (HTML[i] === '}') {
      depth -= 1;
      if (depth === 0) return HTML.slice(from, i + 1);
    }
  }
  throw new Error(`${name} never closes`);
}

/** The real rlLoad, run against a fake page and a fake day of logs. */
async function show(rows, { date = '2026-09-14' } = {}) {
  const nodes = {
    rlBody: { innerHTML: '' },
    rlTable: { style: { display: 'none' } },
    rlEmpty: { style: { display: 'block' }, textContent: '' },
    rlDate: { value: date },
  };
  const document = {
    getElementById: (id) => nodes[id] || null,
    addEventListener: () => {},
  };
  const window = { electronAPI: { bill: { getReceiptLogs: async () => rows } } };

  const source = `${lift('rlWhen')}\n${lift('rlSafe')}\n${lift('rlLoad')}\nreturn rlLoad;`;
  // eslint-disable-next-line no-new-func
  const fn = new Function('document', 'window', 'Date', 'Math', source)(
    document,
    window,
    Date,
    Math
  );
  await fn();

  return {
    rows: nodes.rlBody.innerHTML,
    showing: nodes.rlTable.style.display !== 'none',
    empty: nodes.rlEmpty.style.display !== 'none' ? nodes.rlEmpty.textContent : '',
  };
}

const printed = {
  id: 'a',
  time: '2026-09-14T10:15:00.000Z',
  kind: 'bill',
  title: 'Table 4',
  total: 440,
  ms: 812,
  status: 'printed',
  printers: [{ name: 'EPSON TM-T82', status: 'success' }],
};

const refused = {
  id: 'b',
  time: '2026-09-14T10:16:00.000Z',
  kind: 'bill',
  title: 'Table 6',
  total: 220,
  status: 'failed',
  printers: [{ name: 'EPSON TM-T82', status: 'error', error: 'out of paper' }],
};

test('a receipt that printed says so, with the printer and how long it took', async () => {
  const seen = await show([printed]);

  assert.ok(seen.showing, 'the table never appeared');
  assert.match(seen.rows, /Table 4/);
  assert.match(seen.rows, /EPSON TM-T82/, 'it does not say which printer');
  assert.match(seen.rows, /printed/);
  assert.match(seen.rows, /812ms/, 'it does not say how long it took');
});

test("a receipt that failed carries the printer's own words", async () => {
  /*
   * The whole point. "Did not print" sends somebody to us; "out of paper"
   * sends them to the roll.
   */
  const seen = await show([refused]);

  assert.match(seen.rows, /did not print/);
  assert.match(seen.rows, /out of paper/, 'the reason was swallowed');
});

test('the newest is first, because that is the one being asked about', async () => {
  const seen = await show([printed, refused]);
  assert.ok(
    seen.rows.indexOf('Table 6') < seen.rows.indexOf('Table 4'),
    'the morning is at the top and the failure that just happened is at the bottom'
  );
});

test('a quiet day says so, naming the day', async () => {
  const seen = await show([], { date: '2026-09-01' });
  assert.ok(!seen.showing, 'an empty table was shown');
  assert.match(seen.empty, /2026-09-01/, 'it does not say which day was empty');
});

test('a bill printed for another machine says where it came from', async () => {
  /* A cloud-relayed bill is the case where "which machine printed this" is
     the question, so the source is on the row rather than in a log file. */
  const seen = await show([{ ...printed, source: 'COUNTER-PC' }]);
  assert.match(seen.rows, /COUNTER-PC/);
});

test('a printer name cannot inject markup into the screen', async () => {
  /*
   * A print job can arrive from another installation over the queue, so the
   * strings on this row are not this machine's to trust. receipt-log.js
   * already strips control characters; this escapes what it stores.
   */
  const seen = await show([
    { ...refused, printers: [{ name: '<img src=x onerror=alert(1)>', status: 'error', error: '<b>no</b>' }] },
  ]);

  assert.ok(!seen.rows.includes('<img'), 'a printer name was rendered as markup');
  assert.ok(!seen.rows.includes('<b>no</b>'), 'an error message was rendered as markup');
  assert.match(seen.rows, /&lt;img/, 'it was dropped rather than escaped');
});

test('the screen exists, and reads through the door the preload opens', () => {
  assert.match(HTML, /id="rlBody"/, 'there is no table to read');
  assert.match(HTML, /onclick="rlLoad\(\)"/, 'nothing loads it');
  assert.match(HTML, /bill\.getReceiptLogs/, 'it does not ask for the log');

  const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  const ipc = fs.readFileSync(path.join(ROOT, 'hardware-ipc.js'), 'utf8');
  assert.match(preload, /getReceiptLogs/, 'the preload does not expose it');
  assert.match(ipc, /ipcMain\.handle\('receipt:get-logs'/, 'no handler answers it');
});

test('the date box starts on today, so Load answers the usual question', () => {
  assert.match(HTML, /rlDate[\s\S]{0,400}?toISOString\(\)\.slice\(0, 10\)/,
    'the date starts empty and Load does nothing until somebody types one');
});
