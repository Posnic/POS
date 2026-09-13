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

/**
 * The queue, answering with whatever the test wants and recording the asks.
 *
 * A claimed job CARRIES the bill rather than pointing at it. That is the whole
 * reason the queue exists: a cloud-paired till has no copy of the shop's sales
 * and never will, so anything it has to look up first is a bill it cannot
 * print.
 */
function fakeApi(pending, { poll = null, oldShape = false } = {}) {
  const calls = [];
  global.fetch = async (url, options) => {
    const body = options && options.body ? JSON.parse(options.body) : {};
    calls.push({ url: String(url), body, headers: (options && options.headers) || {} });
    if (String(url).includes('/claimPrintJobs')) {
      const jobs = pending.map((sale, i) => ({
        _id: 'job-' + i,
        kind: 'bill',
        label: 'Table 4',
        payload: sale,
      }));
      /* An API from before the queue answered with the list itself. Tills in
         shops are updated when the shopkeeper gets round to it. */
      const data = oldShape ? jobs : { jobs, poll: poll || { nextMs: 60000, reason: 'quiet' } };
      return { json: async () => ({ status: true, data }) };
    }
    return { json: async () => ({ status: true, data: { ok: true } }) };
  };
  return calls;
}

/** The times this till told the queue a job came out on paper. */
const printedOk = (calls) =>
  calls.filter((c) => c.url.includes('/finishPrintJob') && c.body.ok === true);

/** The times it owned up to a job that did not. */
const printedBad = (calls) =>
  calls.filter((c) => c.url.includes('/finishPrintJob') && c.body.ok === false);

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

/** One pass of the FAR door, which is a separate loop with its own switch. */
async function runCloudOnce(bills) {
  bills.polling = true;
  await bills._pollCloud();
  bills.stop();
}

/*
 * A BILL AS THE QUEUE CARRIES IT.
 *
 * Not a sale document. api/src/helpers/bill-payload.js turns one into this
 * before it goes on the queue, and the difference is not cosmetic: the job
 * used to carry the raw document, whose field names the renderer does not
 * know, and what came out of the printer was a header, an empty item table and
 * a total of 0.00. The round trip is pinned further down.
 */
const aSale = (id) => ({
  storeName: 'Kirana Store',
  title: 'BILL',
  billNo: 'INV-' + id,
  date: '13/09/2026 20:41',
  items: [{ name: 'Chicken Biryani', qty: '2', amount: 440 }],
  subTotal: 440,
  total: 440,
  itemCount: 1,
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
  assert.ok(calls.some((c) => c.url.includes('/claimPrintJobs')));
});

test('the job is closed only AFTER the paper came out', async () => {
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

  assert.equal(printedOk(calls).length, 1, 'it never said the bill printed');
  assert.equal(hardware.jobs.length, 1, 'it closed the job without printing');

  const claimedAt = calls.findIndex((c) => c.url.includes('/claimPrintJobs'));
  const closedAt = calls.findIndex((c) => c.url.includes('/finishPrintJob'));
  assert.ok(closedAt > claimedAt, 'it closed a job it had not claimed');
});

test('the reason a bill did not print travels back with the failure', async () => {
  /*
   * "The bill did not come out" with nothing attached is a support call that
   * starts from nothing. The till's own console is a window nobody has open on
   * a shop floor, so the reason has to go somewhere a person can read it later
   * - and the queue, which already knows the job failed, is that place.
   */
  const hardware = fakeHardware({ refuse: true });
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  const owned = printedBad(calls)[0];
  assert.ok(owned, 'the failure was never reported');
  assert.match(String(owned.body.error || ''), /offline/,
    'the job was failed with no reason on it');
});

test('a shop with no printer at all says so, rather than failing silently', async () => {
  const hardware = fakeHardware({ printer: '' });
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1', findReceiptPrinter: async () => '' });

  await runOnce(bills);

  const owned = printedBad(calls)[0];
  assert.ok(owned, 'nobody was told the bill could not print');
  assert.match(String(owned.body.error || ''), /printer/i);
});

test('a bill that printed carries no reason, because there is none', async () => {
  const hardware = fakeHardware();
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  assert.equal(printedOk(calls)[0].body.error, '');
});

test('a printer that refuses puts the bill back, it does not swallow it', async () => {
  /* Closing it as done would lose the bill for good: nothing would ever offer
     it again, and the only person who knows is the guest still waiting. Owning
     up to the failure is what sends it round again on the next pass. */
  const hardware = fakeHardware({ refuse: true });
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  assert.equal(printedOk(calls).length, 0, 'a bill that never printed was closed as printed');
  assert.equal(printedBad(calls).length, 1, 'the failure was never reported, so nobody retries it');
});

test('no default printer is reported, not silently swallowed', async () => {
  const hardware = fakeHardware({ printer: '' });
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  assert.equal(hardware.jobs.length, 0);
  assert.equal(printedOk(calls).length, 0);
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
  assert.ok(!calls.some((c) => c.url.includes('/claimPrintJobs')), 'it asked about no shop');
});

test('the branch is looked up rather than demanded', async () => {
  const hardware = fakeHardware();
  const calls = fakeApi([]);
  const bills = new BillManager(hardware, { findBranchId: async () => 'found-branch' });

  await runOnce(bills);

  const asked = calls.find((c) => c.url.includes('/claimPrintJobs'));
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

  const asked = calls.find((c) => c.url.includes('/claimPrintJobs'));
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

/*
 * WHICH printer, which in a restaurant is the whole question.
 *
 * Owner, from a two-printer site: "usb001 is in reception, usb004 is in
 * kitchen. Receipt print should go to reception... recept print goes not
 * correctly." The bill asked "whatever Windows calls the default", so the
 * customer's bill came out beside the cook. Worse, getDefaultPrinter falls
 * back to the FIRST printer it enumerates when Windows has no default at all,
 * so the answer could change between two boots of the same machine.
 */
test('the bill goes to the receipt printer, not to whatever Windows prefers', async () => {
  const hardware = fakeHardware({ printer: 'USB004 Kitchen' });
  fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, {
    branchId: 'b1',
    findReceiptPrinter: async () => 'USB001 Reception',
  });

  await runOnce(bills);

  assert.equal(hardware.jobs.length, 1, 'nothing was printed');
  assert.equal(hardware.jobs[0].name, 'USB001 Reception',
    'the bill was sent to the Windows default instead of the counter');
});

test('with no receipt printer chosen it still prints, on the Windows default', async () => {
  /* Every shop running today predates the Receipt Printer setting. Refusing
     to print a customer's bill until somebody opens Hardware Manager would be
     worse than printing it in the wrong room. */
  const hardware = fakeHardware({ printer: 'EPSON TM-T82' });
  fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1', findReceiptPrinter: async () => '' });

  await runOnce(bills);

  assert.equal(hardware.jobs.length, 1, 'a shop with no chosen printer lost its bill');
  assert.equal(hardware.jobs[0].name, 'EPSON TM-T82');
});

test('a receipt printer that cannot be read falls back rather than throwing', async () => {
  const hardware = fakeHardware({ printer: 'EPSON TM-T82' });
  fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, {
    branchId: 'b1',
    findReceiptPrinter: async () => { throw new Error('preferences unreadable'); },
  });

  await runOnce(bills);

  assert.equal(hardware.jobs.length, 1, 'an unreadable setting stopped the bill');
  assert.equal(hardware.jobs[0].name, 'EPSON TM-T82');
});

test('with no printer anywhere, nothing is marked printed', async () => {
  const hardware = fakeHardware({ printer: '' });
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1', findReceiptPrinter: async () => '' });

  await runOnce(bills);

  assert.equal(hardware.jobs.length, 0);
  assert.equal(printedOk(calls).length, 0, 'a bill nobody printed was closed as printed');
});

test('the module that answers which printer is in the packaged build', () => {
  /*
   * build.files is an explicit allowlist. A module left out of it works all
   * the way through CI and then throws "Cannot find module" the first time a
   * customer prints - on their counter, not in our tests. It has happened
   * here before, to printer-targets.js.
   */
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/device-preferences.js'),
    'the receipt printer lookup is not shipped; the bill would throw on a real install');
});


/* --------------------------------------- a till that is not on the shop's LAN */

/*
 * Owner: "there should be way to communicate the till via localhos or via
 * cloude. thats the whole point. make it happen. may be seperate collection for
 * print? need solution that which till need to send for bill also there."
 *
 * Two shops, one binary. A local install IS its own server, so it asks
 * localhost. A till paired to a cloud tenant is not: the shop's data lives at
 * that tenant's address, the handsets talk to it, and the queue fills up
 * THERE. Asking localhost in that case is asking a database that has never
 * heard of the bill - which is exactly the shape the old poller had, and
 * exactly why a cloud shop never printed.
 *
 * Nothing can push INTO a shop: a till sits behind the shop's router with no
 * address anybody outside can reach. So the till asks. The only thing that
 * changes between the two shops is who it asks.
 */

test('a cloud-paired till asks its shop, not its own localhost', async () => {
  const hardware = fakeHardware();
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, {
    branchId: 'b1',
    cloudPrint: true,
    cloudApi: 'https://kiranastore.posnic.io/api',
  });

  await runCloudOnce(bills);

  const asked = calls.find((c) => c.url.includes('/claimPrintJobs'));
  assert.ok(asked, 'it never asked anybody');
  assert.match(asked.url, /^https:\/\/kiranastore\.posnic\.io\/api\//,
    'a cloud till asked its own localhost, where the bill does not exist');
  assert.equal(hardware.jobs.length, 1, 'a cloud shop got no paper');
});

test('a trailing slash on the shop address does not double up', async () => {
  /* Owners paste addresses. `.../api/` + `/sales/...` is a 404 and a bill
     nobody prints, which is a silly way to lose one. */
  const hardware = fakeHardware();
  const calls = fakeApi([]);
  const bills = new BillManager(hardware, {
    branchId: 'b1',
    cloudPrint: true,
    cloudApi: 'https://kiranastore.posnic.io/api/',
  });

  await runCloudOnce(bills);

  const asked = calls.find((c) => c.url.includes('/claimPrintJobs'));
  assert.equal(asked.url, 'https://kiranastore.posnic.io/api/sales/claimPrintJobs');
});

/*
 * WHAT IT COSTS A SHOP THAT DOES NOT NEED THE CLOUD.
 *
 * Owner: "print always look for cloud api instead of local. should not give so
 * much load to cloud also... polling should happen only when app connected and
 * logged in corrently acitve. otherwise there is no app and no one going to
 * give anything then its waste of time polling stuff. also its not restaurent
 * business app not there or not logged in so far. its also waste. may be
 * configuration or toggle to poll cloud. it needs to be on only when required."
 *
 * So: nothing. Not a slower poll, not a smaller one - no request at all.
 */

test('with the cloud door shut, nothing leaves the building', async () => {
  const hardware = fakeHardware();
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, {
    branchId: 'b1',
    cloudApi: 'https://kiranastore.posnic.io/api',
    /* the address is known and the switch is off, which is the default */
  });

  await runCloudOnce(bills);

  assert.deepEqual(calls, [], 'a till nobody asked to relay cloud bills polled the cloud');
  assert.equal(bills.getStatus().cloud.status, 'off');
});

test('a grocer with no cloud address never asks anybody', async () => {
  const hardware = fakeHardware();
  const calls = fakeApi([]);
  const bills = new BillManager(hardware, { branchId: 'b1', cloudPrint: true });

  await runCloudOnce(bills);

  assert.deepEqual(calls, [], 'it polled an address it does not have');
});

test('the switch is read on every pass, not captured at startup', async () => {
  /* A shopkeeper turning cloud printing on should not have to restart the
     till, and turning it OFF has to actually stop the requests. */
  const hardware = fakeHardware();
  const calls = fakeApi([]);
  let on = false;
  const bills = new BillManager(hardware, {
    branchId: 'b1',
    findCloudPrint: async () => ({ enabled: on, apiUrl: 'https://shop.posnic.io/api' }),
  });

  await runCloudOnce(bills);
  assert.deepEqual(calls, [], 'it asked while the switch was off');

  on = true;
  await runCloudOnce(bills);
  assert.ok(calls.some((c) => c.url.includes('/claimPrintJobs')), 'the switch did nothing');
});

test('an unreadable switch does not decide a shop\'s printing', async () => {
  const hardware = fakeHardware();
  const calls = fakeApi([]);
  const bills = new BillManager(hardware, {
    branchId: 'b1',
    cloudPrint: true,
    cloudApi: 'https://shop.posnic.io/api',
    findCloudPrint: async () => { throw new Error('preferences unreadable'); },
  });

  await runCloudOnce(bills);

  assert.ok(calls.some((c) => c.url.includes('/claimPrintJobs')),
    'an unreadable preferences file stopped a shop printing');
});

/*
 * THE SERVER SETS THE PACE.
 *
 * The till cannot know whether a waiter has the app open; the API can, because
 * the handset is talking to it. So the answer carries how long to wait before
 * asking again, and this side obeys. The whole estate can be re-paced from
 * api/src/helpers/print-pace.js without shipping a desktop build to anybody.
 */

test('it comes back when the server says to come back', async () => {
  const hardware = fakeHardware();
  fakeApi([], { poll: { nextMs: 5000, reason: 'somebody is on the floor' } });
  const bills = new BillManager(hardware, {
    branchId: 'b1',
    cloudPrint: true,
    cloudApi: 'https://shop.posnic.io/api',
  });

  const waits = [];
  bills._scheduleCloud = (ms) => waits.push(ms);
  bills.polling = true;
  await bills._pollCloud();
  bills.polling = false;

  assert.deepEqual(waits, [5000], 'it ignored the pace the server set');
});

test('a quiet shop is told to wait, and waits', async () => {
  const hardware = fakeHardware();
  fakeApi([], { poll: { nextMs: 60000, reason: 'nobody is on the floor' } });
  const bills = new BillManager(hardware, {
    branchId: 'b1',
    cloudPrint: true,
    cloudApi: 'https://shop.posnic.io/api',
  });

  const waits = [];
  bills._scheduleCloud = (ms) => waits.push(ms);
  bills.polling = true;
  await bills._pollCloud();
  bills.polling = false;

  assert.deepEqual(waits, [60000]);
});

test('a nonsense pace cannot switch a shop off for the day', async () => {
  /* A bug or a mangled reply must not be able to tell a till to come back
     tomorrow. Whatever the server says is clamped before it is believed. */
  const hardware = fakeHardware();
  fakeApi([], { poll: { nextMs: 86400000, reason: 'corrupt' } });
  const bills = new BillManager(hardware, {
    branchId: 'b1',
    cloudPrint: true,
    cloudApi: 'https://shop.posnic.io/api',
  });

  const waits = [];
  bills._scheduleCloud = (ms) => waits.push(ms);
  bills.polling = true;
  await bills._pollCloud();
  bills.polling = false;

  assert.ok(waits[0] <= 15 * 60 * 1000, `it agreed to sleep for ${waits[0]}ms`);
});

test('it asks the cloud to hold rather than asking again', async () => {
  /*
   * A held request is both fewer requests than polling and faster than it: one
   * every twenty seconds instead of one every five, and the bill leaves the
   * moment it is asked for. The near door never asks for this - it is talking
   * to itself and a held call would just block its own API.
   */
  const hardware = fakeHardware();
  const calls = fakeApi([]);
  const bills = new BillManager(hardware, {
    branchId: 'b1',
    cloudPrint: true,
    cloudApi: 'https://shop.posnic.io/api',
  });

  await runCloudOnce(bills);
  const far = calls.find((c) => c.url.includes('/claimPrintJobs'));
  assert.equal(far.body.wait, true, 'the cloud is being polled instead of held');

  const local = fakeApi([]);
  await runOnce(new BillManager(fakeHardware(), { branchId: 'b1' }));
  const near = local.find((c) => c.url.includes('/claimPrintJobs'));
  assert.ok(!near.body.wait, 'the till asked its own API to hold a call open');
});

test('an API that has not been updated yet is still understood', async () => {
  /* Tills are updated when a shopkeeper gets round to it. A desktop that is
     ahead of its own API must not stop printing because of a reply shape. */
  const hardware = fakeHardware();
  fakeApi([aSale('507f1f77bcf86cd799439011')], { oldShape: true });
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  assert.equal(hardware.jobs.length, 1, 'an older reply shape lost the bill');
});

test('a local till still asks the machine it is running on', async () => {
  const hardware = fakeHardware();
  const calls = fakeApi([]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  const asked = calls.find((c) => c.url.includes('/claimPrintJobs'));
  assert.match(asked.url, /^http:\/\/127\.0\.0\.1:/,
    'a local till went out to the internet for its own bill');
});

test('the till says which machine it is', async () => {
  /*
   * Owner: "need solution that which till need to send for bill also there."
   *
   * A shop with a counter till and a first-floor till has two printers in two
   * rooms. A job addressed to one must not come out in the other, so the till
   * has to be able to say who it is when it asks.
   */
  const hardware = fakeHardware();
  const calls = fakeApi([]);
  const bills = new BillManager(hardware, { branchId: 'b1', tillId: 'COUNTER-PC' });

  await runOnce(bills);

  const asked = calls.find((c) => c.url.includes('/claimPrintJobs'));
  assert.equal(asked.body.tillId, 'COUNTER-PC');
  assert.equal(asked.body.kind, 'bill', 'it would claim the kitchen slips too');
});

test('a till nobody named still has a name', async () => {
  /* The hostname is what the shopkeeper already calls that machine, and every
     install has one. A blank till id would claim only unaddressed jobs. */
  const hardware = fakeHardware();
  const calls = fakeApi([]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  const asked = calls.find((c) => c.url.includes('/claimPrintJobs'));
  assert.ok(String(asked.body.tillId || '').trim(), 'the till could not say who it is');
});

test('it prints what the job carried, without looking anything up', async () => {
  /*
   * The reason the job carries the bill instead of its id. A cloud-paired till
   * has no copy of the shop's sales and never will - one round trip to fetch
   * the sale is one more thing to be down, and on a shop wifi it is the slow
   * half of the whole operation.
   */
  const hardware = fakeHardware();
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  assert.equal(hardware.jobs.length, 1);
  const paper = Buffer.from(hardware.jobs[0].bytes).toString('latin1');
  assert.match(paper, /Chicken Biryani/, 'the payload never reached the paper');

  const lookups = calls.filter(
    (c) => !c.url.includes('/claimPrintJobs') && !c.url.includes('/finishPrintJob')
  );
  assert.deepEqual(lookups, [], 'it went back to the API for something it was already handed');
});

test('three rounds on one table come out as three slips', async () => {
  const hardware = fakeHardware();
  const calls = fakeApi([
    aSale('507f1f77bcf86cd799439011'),
    aSale('507f1f77bcf86cd799439012'),
    aSale('507f1f77bcf86cd799439013'),
  ]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  assert.equal(hardware.jobs.length, 3, 'a table lost a round');
  assert.equal(printedOk(calls).length, 3, 'a printed slip was left on the queue');
  const closed = printedOk(calls).map((c) => c.body.id);
  assert.deepEqual(closed, ['job-0', 'job-1', 'job-2'], 'it closed the wrong jobs');
});

test('the job id is what is closed, never the sale id', async () => {
  /*
   * They are different things and mixing them up is silent: the queue would
   * find no job with that id, leave the real one claimed, and print the same
   * bill again two minutes later when it went stale.
   */
  const hardware = fakeHardware();
  const calls = fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  await runOnce(bills);

  assert.equal(printedOk(calls)[0].body.id, 'job-0');
});

test('a queue that cannot be told is logged, not thrown', async () => {
  /* The paper is already out. Failing to close the job costs a duplicate slip
     later; throwing here would take the whole poller down with it. */
  const hardware = fakeHardware();
  fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const honest = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).includes('/finishPrintJob')) throw new Error('wifi dropped');
    return honest(url, options);
  };

  const bills = new BillManager(hardware, { branchId: 'b1' });
  await runOnce(bills);

  assert.equal(hardware.jobs.length, 1, 'the bill never printed');
  assert.equal(bills.getStatus().lastStatus, 'ok', 'a failed close took the poll down with it');
});

/* ------------------------------------------ printing the moment it is asked */

/*
 * Owner: "if app connected via local network then its direct api print. coz
 * desktop send direct print to printer. if app connected with .posnic.io then
 * bit taking time. coz, db sync and print. i want proper and fastest solution."
 *
 * Exactly right, and it is why this is not just a poller. On the shop's own
 * Wi-Fi a handset talks to THIS machine's API, and that API is require()d into
 * this same process - so a bill asked for on the floor arrives as an in-process
 * event and the paper starts in the same tick. Measured end to end: 30ms from
 * the tap, against a 10,000ms poll.
 *
 * A cloud shop cannot be reached from behind its own router, so nothing can
 * push to it; the poll underneath is the only thing that can serve it, and it
 * also catches a request made while the app was starting or a print that
 * failed.
 */

const BILL_EVENT = 'posnic:bill-requested';

test('a bill asked for on the floor prints without waiting for the poll', async () => {
  const hardware = fakeHardware();
  fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1' });

  bills.start();
  await new Promise((r) => setTimeout(r, 60));
  hardware.jobs.length = 0; // ignore the opening poll

  const asked = Date.now();
  process.emit(BILL_EVENT, { branchId: 'b1', table: 'T4', count: 1 });
  for (let i = 0; i < 40 && !hardware.jobs.length; i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  const took = Date.now() - asked;
  bills.stop();

  assert.equal(hardware.jobs.length, 1, 'the event did not reach the printer');
  assert.ok(took < 2000, `it waited ${took}ms, which means it polled instead of listening`);
});

test('a till with no branch yet takes one off the event', async () => {
  /* The same way the KOT manager takes a branch from a sale. A till still
     being set up should not miss the first bill of the day. */
  const hardware = fakeHardware();
  const calls = fakeApi([]);
  const bills = new BillManager(hardware, { branchId: '', findBranchId: async () => '' });

  bills.start();
  await new Promise((r) => setTimeout(r, 60));
  process.emit(BILL_EVENT, { branchId: 'from-the-event', table: 'T1', count: 1 });
  await new Promise((r) => setTimeout(r, 120));
  bills.stop();

  const asked = calls.find((c) => c.url.includes('/claimPrintJobs'));
  assert.ok(asked, 'it never asked about any shop');
  assert.equal(asked.body.branchId, 'from-the-event');
});

test('stopping lets go of the event, so a stopped till prints nothing', async () => {
  /* A listener left on `process` after stop() is a printer that answers to a
     manager nobody is managing - and two of them would print twice. */
  const before = process.listenerCount(BILL_EVENT);

  const hardware = fakeHardware();
  fakeApi([aSale('507f1f77bcf86cd799439011')]);
  const bills = new BillManager(hardware, { branchId: 'b1' });
  bills.start();
  assert.equal(process.listenerCount(BILL_EVENT), before + 1, 'it never subscribed');

  bills.stop();
  assert.equal(process.listenerCount(BILL_EVENT), before, 'it is still listening after stop');

  hardware.jobs.length = 0;
  process.emit(BILL_EVENT, { branchId: 'b1' });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(hardware.jobs.length, 0, 'a stopped till printed');
});

test('starting twice does not subscribe twice', async () => {
  /* Two listeners is two polls is two bills for one table. */
  const before = process.listenerCount(BILL_EVENT);
  const bills = new BillManager(fakeHardware(), { branchId: 'b1' });
  fakeApi([]);

  bills.start();
  bills.start();
  assert.equal(process.listenerCount(BILL_EVENT), before + 1, 'it subscribed twice');
  bills.stop();
});


/* ------------------------------- the sale, all the way to the paper */

/*
 * THE BUG THIS PINS PRINTED PERFECTLY BLANK PAPER.
 *
 * A waiter asked for a bill, the printer ran, a slip came out - with a header,
 * an empty item table and a total of 0.00. Nothing errored anywhere.
 *
 * The queue was carrying the sale DOCUMENT, and src/escpos-receipt.js does not
 * read documents. It reads a view model: `items[].name`, `total`. The document
 * has `items[].item_name` and `sales_total`. Every lookup missed, quietly, and
 * the result looked exactly like a printer fault.
 *
 * On the counter's own screen that view model is scraped out of the shop's
 * rendered receipt template by frontend/.../receipt-data.js. There is no
 * template on the floor, so api/src/helpers/bill-payload.js builds one from
 * the sale, on the server, where the shop's letterhead also lives - a
 * cloud-paired till has no copy of that database and never will.
 *
 * This test walks the whole way: a sale as Mongo holds it, through the
 * builder, through the renderer, to the characters that reach the printer.
 */

const { buildBillPayload } = require(
  path.join(__dirname, '..', 'api', 'src', 'helpers', 'bill-payload.js')
);
const { renderSale } = require(path.join(__dirname, '..', 'src', 'escpos-receipt.js'));

/** The characters of a rendered slip, with the control codes taken out. */
function onPaper(bytes) {
  return Buffer.from(bytes)
    .toString('latin1')
    /* ESC/GS sequences: two bytes of command and, for the ones used here, one
       of argument. Stripped so an assertion reads about words, not bytes. */
    .replace(/\x1B[@EadtV!][\s\S]?/g, '')
    .replace(/\x1D[!V][\s\S]?/g, '');
}

const A_REAL_SALE = {
  _id: '507f1f77bcf86cd799439011',
  sales_id: 'INV-2291',
  date: new Date('2026-09-13T20:41:00'),
  branch_name: 'Kirana Store',
  table_number: 'T4',
  dine_type: 'Dine in',
  person_count: 3,
  customer_name: 'Walk-in',
  items: [
    { name: 'Chicken Biryani', quantity: 2, unit_price: 220, total: 440 },
    { name: 'Butter Naan', quantity: 3, unit_price: 40, total: 120 },
  ],
  sales_sub_total: 560,
  tax: 28,
  discount: 10,
  round_off: 0,
  sales_total: 578,
};

const THE_SHOP = {
  branch_name: 'Kirana Store',
  store_address: '12 Anna Salai',
  store_telephone: '044 2345 6789',
  branch_gstin_number: '33ABCDE1234F1Z5',
};

test('a real sale reaches the paper with its items and its total on it', () => {
  const paper = onPaper(
    renderSale(buildBillPayload(A_REAL_SALE, THE_SHOP), { paperWidth: '48' })
  );

  assert.match(paper, /Chicken Biryani/, 'the items never reached the paper');
  assert.match(paper, /Butter Naan/, 'a line was lost');
  assert.match(paper, /440\.00/, 'a line amount never reached the paper');
  assert.match(paper, /TOTAL\s+578\.00/, 'the total printed as zero - the blank-bill bug');
  assert.match(paper, /Kirana Store/, 'the shop has no name on its own bill');
  assert.match(paper, /INV-2291/, 'the bill has no number to refer to');
});

test('the bill says which table it belongs to', () => {
  /* The waiter carrying it has to know whose it is, and on the floor that is
     the table number, not the invoice number. */
  const paper = onPaper(
    renderSale(buildBillPayload(A_REAL_SALE, THE_SHOP), { paperWidth: '48' })
  );
  assert.match(paper, /Table\s+T4/, 'nothing on the slip says which table');
  assert.match(paper, /Covers\s+3/, 'the cover count was dropped');
});

test('it is a bill, not a receipt and not a tax invoice', () => {
  /* Nobody has paid yet. Calling it either of the others would be a document
     this shop has not issued. */
  const payload = buildBillPayload(A_REAL_SALE, THE_SHOP);
  assert.equal(payload.title, 'BILL');
  assert.deepEqual(payload.payments || [], [], 'a bill nobody has paid carries a payment row');
});

test('a walk-in gets no empty customer line', () => {
  const payload = buildBillPayload(A_REAL_SALE, THE_SHOP);
  assert.deepEqual(payload.customer, [], 'an unnamed guest printed a blank name line');
});

test('a guest who gave a name gets it', () => {
  const payload = buildBillPayload(
    { ...A_REAL_SALE, customer_name: 'Meera', customer_phone: '98400 12345' },
    THE_SHOP
  );
  assert.deepEqual(payload.customer, ['Meera', '98400 12345']);
});

test('a returned line is not billed to the guest', () => {
  const payload = buildBillPayload(
    {
      ...A_REAL_SALE,
      items: [...A_REAL_SALE.items, { name: 'Sent back', quantity: 1, total: 60, return: true }],
    },
    THE_SHOP
  );
  const names = payload.items.map((it) => it.name);
  assert.ok(!names.includes('Sent back'), 'a returned dish was billed to the guest');
});

test('something sold by weight keeps its decimals', () => {
  /* 0.3 of a kilo is what was ordered. Rounding it to zero, or printing
     "0.300" for two plates, are both wrong in different directions. */
  const payload = buildBillPayload(
    { ...A_REAL_SALE, items: [{ name: 'Mutton', quantity: 0.35, unit_price: 900, total: 315 }] },
    THE_SHOP
  );
  assert.equal(payload.items[0].qty, '0.35');
  assert.equal(buildBillPayload(A_REAL_SALE, THE_SHOP).items[0].qty, '2', 'a plate printed as 2.000');
});

test('a shop whose branch row could not be read still gets a bill', () => {
  /* Losing a guest their bill over a missing letterhead would be the wrong
     trade: the items and the total are what the guest is paying against. */
  const paper = onPaper(renderSale(buildBillPayload(A_REAL_SALE, {}), { paperWidth: '48' }));
  assert.match(paper, /Chicken Biryani/);
  assert.match(paper, /578\.00/);
});

test('an Indian shop sees its tax split the way its paper always splits it', () => {
  const payload = buildBillPayload(A_REAL_SALE, { ...THE_SHOP, indian_gst: 'enable' });
  assert.deepEqual(
    payload.taxes.map((t) => t.label),
    ['CGST', 'SGST']
  );
  assert.equal(payload.taxes[0].amount + payload.taxes[1].amount, 28);
});

test('a shop that does not use Indian GST gets one tax row', () => {
  const payload = buildBillPayload(A_REAL_SALE, THE_SHOP);
  assert.deepEqual(payload.taxes, [{ label: 'Tax', amount: 28 }]);
});

test('a sale with no tax prints no tax row at all', () => {
  /* A receipt with an empty tax line reads as broken; one without the line
     simply does not mention tax. */
  const payload = buildBillPayload({ ...A_REAL_SALE, tax: 0 }, THE_SHOP);
  assert.deepEqual(payload.taxes, []);
});
