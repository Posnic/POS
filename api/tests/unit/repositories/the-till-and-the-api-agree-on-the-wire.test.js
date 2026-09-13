'use strict';

/*
 * THE TILL AND THE API, TALKING TO EACH OTHER OVER A REAL SOCKET.
 *
 * Every other test of the print queue holds one end and imagines the other.
 * The desktop tests hand BillManager a hand-written answer; the repository
 * tests call claimPrintJobs directly and never see a route. So the shape that
 * travels BETWEEN them - what `data` contains, what the header is called, where
 * the job id lives - is the one thing nothing checks, and it is the thing that
 * would cost a shop its bills without failing a single build.
 *
 * It nearly did. The controller answers `{ jobs, poll }` while an older API
 * answered with the list itself; the till reads both. Had it read only the
 * older shape, both suites would still be green and no cloud shop would ever
 * have printed anything.
 *
 * So this boots a real Express app on a real port, in front of a real MongoDB,
 * and points a real BillManager at it with a fake printer on the end. The only
 * thing pretending here is the paper.
 */

const http = require('http');
const path = require('path');
const express = require('express');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const Sale = require('../../../src/models/sale.model');
const BaseModel = require('../../../src/models/base.model');
const PrintJob = require('../../../src/models/print-job.model');
const repo = require('../../../src/repositories/sale.repository');
const salesController = require('../../../src/controllers/sales.controller');
const { ensureKioskKey } = require('../../../src/middleware/kiosk-key');

/* The desktop's own file, not a copy of it. Four directories up is the repo
   root: api/tests/unit/repositories -> api/tests/unit -> api/tests -> api. */
const BillManager = require(path.join(__dirname, '..', '..', '..', '..', 'src', 'bill-manager.js'));

const KEY = 'the-installation-key';
const BRANCH = '64b7f1c2a1e2c3d4e5f60001';

let mem;
let server;
let base;

/** A printer that records what it was sent, and can refuse. */
function fakePrinter({ refuse = false } = {}) {
  const jobs = [];
  return {
    jobs,
    getDefaultPrinter: async () => ({ name: 'EPSON TM-T82', isDefault: true }),
    sendRawToPrinter: async (name, bytes, label) => {
      jobs.push({ name, bytes, label, text: Buffer.from(bytes).toString('latin1') });
      return refuse ? { success: false, error: 'offline' } : { success: true };
    },
  };
}

/** A till pointed at that server, with its cloud door open. */
function aTill(hardware, options = {}) {
  return new BillManager(hardware, {
    branchId: BRANCH,
    tillId: 'COUNTER-PC',
    cloudPrint: true,
    cloudApi: base,
    findReceiptPrinter: async () => 'EPSON TM-T82',
    ...options,
  });
}

/** One raw request at the API, the way a till makes it. */
function ask(route, body, key) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.address().port,
        path: `/api${route}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          kioskkey: key,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (d) => {
          data += d;
        });
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** One pass of the cloud door, without leaving a timer running. */
async function oneCloudPass(till) {
  till.polling = true;
  await till._pollCloud();
  till.stop();
}

const openTicket = (table = 'T4') =>
  Sale.create({
    branch_id: BRANCH,
    sale_process: 'KOT',
    table_number: table,
    payment_status: 'Unpaid',
    sales_id: 'INV-9001',
    items: [
      {
        item: new mongoose.Types.ObjectId(),
        name: 'Chicken Biryani',
        quantity: 2,
        unit_price: 220,
        total: 440,
      },
    ],
    sales_total: 440,
  });

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('posnic'));

  process.env.KIOSK_API_KEY = KEY;

  /*
   * The two routes the till calls, mounted the way sales.routes.js mounts
   * them: behind the installation key, with the controller bound so `this`
   * still reaches its own helpers.
   */
  const app = express();
  app.use(express.json());
  app.post(
    '/api/sales/claimPrintJobs',
    ensureKioskKey,
    salesController.claimPrintJobs.bind(salesController)
  );
  app.post(
    '/api/sales/finishPrintJob',
    ensureKioskKey,
    salesController.finishPrintJob.bind(salesController)
  );

  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
}, 60000);

afterAll(async () => {
  delete process.env.KIOSK_API_KEY;
  if (server) await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  if (mem) await mem.stop();
});

beforeEach(async () => {
  await Sale.deleteMany({});
  await PrintJob.deleteMany({});
  BaseModel.license = null;
});

describe('a bill asked for on the floor, printed by a till over the wire', () => {
  test("the paper comes out, and it is the guest's bill on it", async () => {
    await openTicket();
    await repo.requestBillPrintModel(BRANCH, 'T4');

    const hardware = fakePrinter();
    await oneCloudPass(aTill(hardware));

    expect(hardware.jobs).toHaveLength(1);
    /*
     * The contents, not just the fact of a job. escpos-receipt renders a VIEW
     * MODEL - storeName, items[].name, total - and a sale document has none of
     * those field names. Handing the document over prints a header, an empty
     * table and 0.00, with no error anywhere, which reads on the counter as a
     * printer fault. That is what shipped before helpers/bill-payload.js, and
     * it is why this asserts on the characters.
     */
    expect(hardware.jobs[0].text).toContain('Chicken Biryani');
    expect(hardware.jobs[0].text).toContain('440');
    expect(hardware.jobs[0].name).toBe('EPSON TM-T82');
  });

  test('the job is closed, so the same bill is not printed twice', async () => {
    await openTicket();
    await repo.requestBillPrintModel(BRANCH, 'T4');

    const hardware = fakePrinter();
    const till = aTill(hardware);
    await oneCloudPass(till);
    expect(hardware.jobs).toHaveLength(1);

    const after = await PrintJob.findOne({}).lean();
    expect(after.status).toBe('done');

    /* A second pass has nothing to take. A guest handed two identical bills
       asks which one to pay. */
    await oneCloudPass(aTill(hardware));
    expect(hardware.jobs).toHaveLength(1);
  });

  test('a printer that refused leaves the bill on the queue', async () => {
    await openTicket();
    await repo.requestBillPrintModel(BRANCH, 'T4');

    const hardware = fakePrinter({ refuse: true });
    await oneCloudPass(aTill(hardware));

    const after = await PrintJob.findOne({}).lean();
    expect(after.status).toBe('queued');
    expect(after.last_error).toBeTruthy();
  });

  test('a table with three rounds gets three slips, in one pass', async () => {
    await openTicket();
    await openTicket();
    await openTicket();
    await repo.requestBillPrintModel(BRANCH, 'T4');

    const hardware = fakePrinter();
    await oneCloudPass(aTill(hardware));

    expect(hardware.jobs).toHaveLength(3);
    expect(await PrintJob.countDocuments({ status: 'done' })).toBe(3);
  });

  test('a caller without the installation key is refused, and takes nothing', async () => {
    /*
     * Asked of the route rather than through a BillManager: both ends read the
     * same process env for the key, so inside one test process a till and its
     * server cannot disagree about it however hard the test tries. What is
     * worth pinning is that the door is shut, and that a refused claim leaves
     * the bill where it was rather than consuming it.
     */
    await openTicket();
    await repo.requestBillPrintModel(BRANCH, 'T4');

    const refused = await ask(
      '/sales/claimPrintJobs',
      { branchId: BRANCH, tillId: 'X' },
      'wrong-key'
    );
    expect(refused.status).toBe(401);

    expect(await PrintJob.countDocuments({ status: 'queued' })).toBe(1);

    /* And with the right key, the same request is served. */
    const served = await ask('/sales/claimPrintJobs', { branchId: BRANCH, tillId: 'X' }, KEY);
    expect(served.status).toBe(200);
    expect(served.body.data.jobs).toHaveLength(1);
  });

  test('the server sets the pace, and the till comes back when told', async () => {
    /*
     * Owner: "should not give so much load to cloud also... polling should
     * happen only when app connected and logged in corrently acitve."
     *
     * The till cannot know whether a waiter has the app open. This side can,
     * so the answer carries the interval and the till honours it. Nobody is on
     * the floor in this test, so it must be told the idle pace.
     */
    const { IDLE_MS } = require('../../../src/helpers/print-pace');
    const hardware = fakePrinter();
    const till = aTill(hardware);

    let waited = null;
    till._scheduleCloud = (ms) => {
      waited = ms;
    };
    till.polling = true;
    await till._pollCloud();

    expect(waited).toBe(IDLE_MS);
  });

  test('a shop with a waiter on the floor is told to come back quickly', async () => {
    const { seenOnTheFloor, BUSY_MS } = require('../../../src/helpers/print-pace');
    seenOnTheFloor(BRANCH);

    const hardware = fakePrinter();
    const till = aTill(hardware);

    let waited = null;
    till._scheduleCloud = (ms) => {
      waited = ms;
    };
    till.polling = true;
    /* No hold: with nothing queued and the floor active the server would keep
       the socket for twenty seconds, which is the right behaviour and a poor
       test. The till asks without waiting here by taking the drain directly. */
    const out = await till._drain(base, { wait: false });
    expect(out.pace).toBe(BUSY_MS);
    expect(waited).toBeNull();
  });

  test('a till with the cloud door shut sends nothing anywhere', async () => {
    /*
     * Owner: "may be configuration or toggle to poll cloud. it needs to be on
     * only when required. otherwise let app connect via lan and give print."
     *
     * A shop whose handsets are on its own Wi-Fi should put no traffic on the
     * internet for this, ever. Off is the default, and off means silent.
     */
    await openTicket();
    await repo.requestBillPrintModel(BRANCH, 'T4');

    const hardware = fakePrinter();
    const till = aTill(hardware, {
      cloudPrint: false,
      findCloudPrint: async () => ({ enabled: false, apiUrl: base }),
    });
    await oneCloudPass(till);

    expect(hardware.jobs).toHaveLength(0);
    expect(till.getStatus().cloud.status).toBe('off');
    /* The bill is untouched: a shop that turns the switch on later still has
       it, rather than having had it quietly consumed. */
    expect(await PrintJob.countDocuments({ status: 'queued' })).toBe(1);
  });
});
