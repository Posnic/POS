/*
 * WHAT HARDWARE MANAGER TELLS A SHOPKEEPER ABOUT BILLS.
 *
 * A waiter taps Print bill and nothing comes out. Before this, the reason
 * lived in a console window nobody has open on a shop floor, so "it is not
 * printing" and "no receipt printer is set on this till" were the same
 * sentence to the person standing at the counter - and one of those they can
 * fix in ten seconds.
 *
 * BillManager had kept a status object since it was written and nothing ever
 * asked for it. That is the shape of bug this file exists to stop: a reading
 * that is taken, is correct, and reaches nobody.
 *
 * The functions are read OUT of hardware-manager.html rather than copied, so
 * the test cannot keep passing while the screen does something else.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const HTML = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'hardware-manager.html'),
  'utf8'
);

/** Lift one `function name(...) {...}` out of the page by brace matching. */
function lift(name) {
  let from = HTML.indexOf(`function ${name}(`);
  assert.notStrictEqual(from, -1, `${name} is gone from Hardware Manager`);
  /* Take the `async` with it. Without this the lifted source is a plain
     function containing `await`, which will not parse - and the failure reads
     as a bug in the page rather than in this helper. */
  if (HTML.slice(from - 6, from) === 'async ') from -= 6;
  let depth = 0;
  let end = -1;
  for (let i = HTML.indexOf('{', from); i < HTML.length; i += 1) {
    if (HTML[i] === '{') depth += 1;
    else if (HTML[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  assert.notStrictEqual(end, -1, `${name} never closes`);
  return HTML.slice(from, end);
}

/**
 * The real bpRefresh, run against a fake document and a fake status.
 *
 * Returns what a person would actually see: the two rows, the counter line,
 * and whether the trouble box is showing and what it says.
 */
async function render(status) {
  const nodes = {
    bpRows: { innerHTML: '', style: {} },
    bpPrinted: { textContent: '', style: {} },
    bpTrouble: { textContent: '', style: { display: 'none' } },
  };

  const document = { getElementById: (id) => nodes[id] || null };
  const window = { electronAPI: { bill: { getStatus: async () => status } } };

  const source = `${lift('bpWhen')}\n${lift('bpRow')}\n${lift('bpRefresh')}\nreturn bpRefresh;`;
  // eslint-disable-next-line no-new-func
  const fn = new Function('document', 'window', 'Date', source)(document, window, Date);
  await fn();

  return {
    rows: nodes.bpRows.innerHTML,
    printed: nodes.bpPrinted.textContent,
    trouble: nodes.bpTrouble.style.display === 'block' ? nodes.bpTrouble.textContent : '',
  };
}

const healthy = {
  isPolling: true,
  lastPollAt: new Date().toISOString(),
  lastStatus: 'ok',
  printed: 3,
  lastPrintedAt: new Date().toISOString(),
  lastPrintError: '',
  cloud: { status: 'off', lastPollAt: null },
};

test('a working till says so, on the near door, without mentioning the internet', async () => {
  const seen = await render(healthy);

  assert.match(seen.rows, /On the shop Wi-Fi/);
  assert.match(seen.rows, /ready/);
  assert.match(seen.rows, /Over the internet/);
  assert.match(seen.rows, /Nothing is sent outside the shop/,
    'a shop with the cloud door shut is not told that it is shut');
  assert.match(seen.printed, /3 printed/);
  assert.equal(seen.trouble, '', 'a healthy till is showing an alarm');
});

test("a printer that refused says what the printer said", async () => {
  /*
   * The one line here a shopkeeper can act on. "Bills are not printing" sends
   * them to us; "EPSON TM-T82: out of paper" sends them to the roll.
   */
  const seen = await render({
    ...healthy,
    printed: 0,
    lastPrintError: 'EPSON TM-T82: out of paper',
  });

  assert.match(seen.trouble, /out of paper/, 'the reason never reached the screen');
  assert.match(seen.trouble, /EPSON TM-T82/, 'it does not say which printer refused');
});

test('a till with no receipt printer chosen is told that, not "not printing"', async () => {
  const seen = await render({
    ...healthy,
    lastPrintError: 'No receipt printer is set on this till and Windows has no default.',
  });

  assert.match(seen.trouble, /No receipt printer is set/);
});

test('a near door that cannot reach its own API shows the reason', async () => {
  const seen = await render({
    ...healthy,
    lastStatus: 'error: fetch failed',
  });

  assert.match(seen.rows, /not answering/);
  assert.match(seen.rows, /fetch failed/, 'the error was swallowed');
  assert.doesNotMatch(seen.rows, /error: fetch failed/,
    'the raw status string is shown to a shopkeeper');
});

test('a cloud address that is wrong is reported separately from the counter', async () => {
  /*
   * Two doors, two lines. A shop can have a perfectly working counter printer
   * and a cloud address with a typo in it, and one status line would hide it.
   */
  const seen = await render({
    ...healthy,
    lastStatus: 'ok',
    cloud: { status: 'error: getaddrinfo ENOTFOUND kiranastore.posnic.ioo', lastPollAt: null },
  });

  assert.match(seen.rows, /On the shop Wi-Fi <span[^>]*>ready/,
    'a broken cloud address made the working near door look broken');
  assert.match(seen.rows, /ENOTFOUND/);
});

test('a till that does not know its shop is NOT called ready', async () => {
  /*
   * The state this panel exists for. "no branch" means the till has not worked
   * out which shop it is, so no bill can ever be matched to it - and it sits
   * there answering nobody, looking perfectly healthy. The first draft of this
   * screen called it "ready", which is worse than no screen at all: it would
   * have sent somebody hunting the printer.
   */
  const seen = await render({ ...healthy, lastStatus: 'no branch' });

  assert.doesNotMatch(seen.rows, /Wi-Fi <span[^>]*>ready/,
    'a till that cannot name its shop was reported as ready');
  assert.match(seen.rows, /waiting for the shop/);
  assert.match(seen.rows, /which branch it is/, 'it does not say what is wrong');
});

test('a poller that never started says so, rather than looking idle', async () => {
  const seen = await render({ ...healthy, isPolling: false });

  assert.match(seen.rows, /not running/);
  assert.match(seen.rows, /Restarting it/, 'it does not say what to do');
});

test('the first few seconds after opening are not reported as a fault', async () => {
  const seen = await render({ ...healthy, lastStatus: 'idle', lastPollAt: null });

  assert.match(seen.rows, /starting up/);
  assert.doesNotMatch(seen.rows, /not answering/);
});

test('a cloud door that is on but shopless says that too', async () => {
  const seen = await render({
    ...healthy,
    cloud: { status: 'no branch', lastPollAt: null },
  });

  assert.match(seen.rows, /Over the internet <span[^>]*>waiting for the shop/);
});

test('a till the shop turned away is told to paste the key, not to check its wiring', async () => {
  /*
   * The one cloud failure with an exact remedy. Filed under "not answering" it
   * sends somebody to look at their internet; named properly it is one copy
   * and paste.
   */
  const seen = await render({
    ...healthy,
    cloud: {
      status: 'error: refused by https://kiranastore.posnic.io/api: this till is presenting a key '
        + 'that server does not accept. Copy the printing key from your shop and paste it into '
        + 'Hardware Manager.',
      lastPollAt: null,
    },
  });

  assert.match(seen.rows, /turned away/);
  assert.match(seen.rows, /printing key/, 'it does not say what to paste');
  assert.doesNotMatch(seen.rows, /not answering/,
    'a refusal was filed as an unreachable server');
});

test('a till that has printed nothing yet says so rather than showing a zero', async () => {
  const seen = await render({ ...healthy, printed: 0, lastPrintedAt: null });
  assert.match(seen.printed, /none printed yet/);
});

test('the times read as a person would say them', async () => {
  const source = `${lift('bpWhen')}\nreturn bpWhen;`;
  // eslint-disable-next-line no-new-func
  const bpWhen = new Function(source)();

  assert.equal(bpWhen(null), 'not yet');
  assert.equal(bpWhen(new Date().toISOString()), 'just now');
  assert.equal(bpWhen(new Date(Date.now() - 30000).toISOString()), '30 seconds ago');
  assert.equal(bpWhen(new Date(Date.now() - 120000).toISOString()), '2 minutes ago');
  /*
   * The singular has to be reachable. It was not: the seconds band ran to 90
   * and the minutes were rounded, so 90 seconds became "2 minutes ago" and
   * "1 minute ago" was a line that could never run - the quiet kind of dead
   * code, correct-looking and never executed.
   */
  assert.equal(bpWhen(new Date(Date.now() - 60000).toISOString()), '1 minute ago',
    'it says "1 minutes ago", or skips the singular entirely');
});

test('the reading is actually taken, and on a timer', async () => {
  /*
   * The bug this whole file is about: BillManager kept getStatus() from the
   * day it was written and nothing called it. A panel that renders once on
   * open and never again is the same bug with a longer fuse.
   */
  assert.match(HTML, /bpRefresh\(\);/, 'the panel is never drawn');
  assert.match(HTML, /setInterval\(bpRefresh,\s*\d+\)/, 'the panel is drawn once and left stale');
});

test('the door it reads through exists all the way to the poller', () => {
  /* Three files have to agree or the panel shows nothing for ever. */
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const ipc = fs.readFileSync(path.join(__dirname, '..', 'src', 'hardware-ipc.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

  assert.match(preload, /bill:\s*\{[\s\S]{0,200}getStatus/, 'preload does not expose it');
  assert.match(ipc, /ipcMain\.handle\('bill:get-status'/, 'no handler answers it');
  assert.match(main, /setupHardwareIPC\(hardwareManager,\s*kotManager,\s*billManager\)/,
    'the handler is registered without a bill manager, so it always answers "not running"');
});

test('the poller reports the last failure and the last success', () => {
  /* The panel can only say what BillManager remembers. */
  const BillManager = require(path.join(__dirname, '..', 'src', 'bill-manager.js'));
  const status = new BillManager({}, {}).getStatus();

  for (const key of ['lastPrintError', 'lastPrintedAt', 'printed', 'lastStatus', 'cloud']) {
    assert.ok(key in status, `getStatus does not report ${key}`);
  }
});
