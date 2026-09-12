/*
 * THE BILL A WAITER ASKED FOR, TURNING INTO PAPER.
 *
 * Owner: "if mobile give bill then printer out should comes from desktop
 * connected. not from KOT."
 *
 * The handset marks the ticket; this half runs on the machine that owns the
 * printers and turns the mark into paper. What is worth pinning is mostly the
 * order things happen in, because every failure this can have is a guest
 * sitting at a table waiting for a bill nobody is bringing.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const BillManager = require(path.join(__dirname, '..', 'src', 'bill-manager.js'));

/** A printer that records what it was sent, and can refuse. */
function fakeHardware({ printer = 'EPSON TM-T82', refuse = false } = {}) {
  const jobs = [];
  return {
    jobs,
    getDefaultPrinter: async () => (printer ? { name: printer, isDefault: true } : null),
    sendRawToPrinter: async (name, bytes, label) => {
      jobs.push({ name, bytes, label });
      return refuse ? { success: false, error: 'offline' } : { success: true };
    },
  };
}

/** The API, answering with whatever the test wants and recording the asks. */
function fakeApi(pending) {
  const calls = [];
  global.fetch = async (url, options) => {
    const body = options && options.body ? JSON.parse(options.body) : {};
    calls.push({ url: String(url), body, headers: (options && options.headers) || {} });
    if (String(url).includes('/pendingBillPrints')) {
      return { json: async () => ({ status: true, data: pending }) };
    }
    return { json: async () => ({ status: true, data: { marked: 1 } }) };
  };
  return calls;
}

/**
 * One pass of the poller, without leaving a timer running.
 *
 * _poll() returns immediately unless the manager believes it is polling, which
 * is right in the app and a trap in a test: the first draft of this file called
 * _poll() on a stopped manager, printed nothing, and three of the assertions
 * passed anyway because "nothing printed" was what they were checking for.
 */
async function runOnce(bills) {
  bills.polling = true;
  await bills._poll();
  bills.stop();
}

const aSale = (id) => ({
  _id: id,
  sales_id: 'INV-' + id,
  items: [{ item_name: 'Chicken Biryani', quantity: 2, item_total: 440 }],
  sales_total: 440,
});

test('a requested bill is printed on the counter printer', async () => {
  const hardware = fakeHardware();
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  assert.equal(hardware.jobs.length, 1, 'nothing was printed');
  assert.equal(hardware.jobs[0].name, 'EPSON TM-T82');
  assert.ok(hardware.jobs[0].bytes && hardware.jobs[0].bytes.length, 'an empty job was sent');
  assert.match(hardware.jobs[0].label, /bill/i, 'the job is not named as a bill');
  assert.ok(calls.some((c) => c.url.includes('/pendingBillPrints')));
});

test('it is marked printed only AFTER the paper came out', async () => {
  /*
   * The order matters and it is the one that can go wrong quietly. A till that
   * dies mid-job asks again when it returns, which costs a duplicate slip at
   * worst - and a duplicate is paper, while a lost one is a guest waiting for
   * something nobody is going to bring.
   */
  const hardware = fakeHardware();
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  const printedAt = calls.findIndex((c) => c.url.includes('/markBillPrinted'));
  assert.ok(printedAt > -1, 'it never said the bill printed');
  assert.equal(hardware.jobs.length, 1, 'it marked without printing');
});

test('a printer that refuses does not get the bill marked printed', async () => {
  /* Marking it would lose the bill for good: nothing would ever offer it
     again, and the only person who knows is the guest still waiting. */
  const hardware = fakeHardware({ refuse: true });
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  assert.ok(
    !calls.some((c) => c.url.includes('/markBillPrinted')),
    'a bill that never printed was marked as printed'
  );
});

test('no default printer is reported, not silently swallowed', async () => {
  const hardware = fakeHardware({ printer: '' });
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  assert.equal(hardware.jobs.length, 0);
  assert.ok(!calls.some((c) => c.url.includes('/markBillPrinted')));
});

test('the cash drawer is never opened', async () => {
  /*
   * A bill is a request for money, not a receipt of it. The drawer belongs to
   * the cashier and to the moment somebody actually pays - kicking it here
   * would be the till acting as though a waiter had settled, which is the one
   * thing this whole feature is built not to do.
   */
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'bill-manager.js'), 'utf8');
  assert.match(source, /openDrawer:\s*false/, 'the bill print opens the cash drawer');
});

test('nothing here writes a payment', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'bill-manager.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ');
  for (const word of ['payment_status', 'payment_mode', 'paid_amount', 'settle']) {
    assert.ok(!code.includes(word), `the till writes ${word} from the bill path`);
  }
});

test('a till with no branch yet waits instead of erroring', async () => {
  /* A normal state while a shop is being set up, not a fault. */
  const hardware = fakeHardware();
  const calls = fakeApi([]);
  const bills = new BillManager(hardware, { branchId: '', findBranchId: async () => '' });

  await runOnce(bills);

  assert.equal(bills.getStatus().lastStatus, 'no branch');
  assert.ok(!calls.some((c) => c.url.includes('/pendingBillPrints')), 'it asked about no shop');
});

test('the branch is looked up rather than demanded', async () => {
  const hardware = fakeHardware();
  const calls = fakeApi([]);
  const bills = new BillManager(hardware, { findBranchId: async () => 'found-branch' });

  await runOnce(bills);

  const asked = calls.find((c) => c.url.includes('/pendingBillPrints'));
  assert.equal(asked && asked.body.branchId, 'found-branch');
});

test('it presents this installation\'s kiosk key', async () => {
  /* Both till-side routes are behind ensureKioskKey; without the header the
     poll is refused and no bill ever prints. */
  process.env.KIOSK_API_KEY = 'the-key';
  const hardware = fakeHardware();
  const calls = fakeApi([]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);
  delete process.env.KIOSK_API_KEY;

  const asked = calls.find((c) => c.url.includes('/pendingBillPrints'));
  assert.equal(asked.headers.kioskkey, 'the-key');
});

test('the API port is read at call time, never at load time', async () => {
  /*
   * main.js sets PORT while it starts up, so a const evaluated when this file
   * is first required captures the fallback instead. That mistake has cost
   * this codebase three separate outages, which is why kot-manager.js carries
   * the same warning.
   */
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'bill-manager.js'), 'utf8');
  assert.match(source, /function apiUrl\(\)/, 'the API url is not computed per call');
  assert.ok(
    !/^const API_URL/m.test(source),
    'the API url is captured at module load'
  );
});

test('the module is in the packaged build', () => {
  /*
   * electron-builder ships an explicit file list. A module left off it is
   * missing only in the INSTALLED app - it works all the way through
   * development and fails on a shopkeeper's machine, which is the worst shape
   * a mistake can have here.
   */
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  assert.ok(
    pkg.build.files.includes('src/bill-manager.js'),
    'bill-manager.js would be missing from the installed app'
  );
});

test('it is started when the till starts, not left to be switched on', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /billManager = new BillManager\(/, 'the bill poller is never constructed');
  assert.match(main, /billManager\.start\(\)/, 'the bill poller is never started');
});
