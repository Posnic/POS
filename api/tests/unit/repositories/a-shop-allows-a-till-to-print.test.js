'use strict';

/*
 * A SHOP ALLOWING A TILL TO PRINT ITS BILLS, AND THE DOOR THAT CHECKS.
 *
 * Owner: "there should be way to communicate the till via localhos or via
 * cloude. thats the whole point."
 *
 * The queue made that possible and then could not be used by anybody, for a
 * reason that only shows up on real machines: every Posnic installation
 * generates its own kiosk key the first time it starts, and a cloud tenant IS
 * an installation - the provisioner writes it a random one of its own. So a
 * till presenting its key to its shop's cloud address is refused, every time,
 * for every shop. The queue was correct and no bill ever came out.
 *
 * These tests are about the introduction between the two, and about the two
 * things that must stay true of it: an allowed till can take print jobs, and
 * it can do nothing else.
 */

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const PrintTill = require('../../../src/models/print-till.model');
const tills = require('../../../src/repositories/print-till.repository');
const { ensurePrintDevice, ensureKioskKey } = require('../../../src/middleware/kiosk-key');

/* What a real till holds: 32 random bytes, hex, made at first boot. */
const aKey = () => crypto.randomBytes(32).toString('hex');

const THIS_INSTALL = aKey();

let mem;
let server;

function ask(path, key) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({});
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.address().port,
        path,
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
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('posnic'));

  process.env.KIOSK_API_KEY = THIS_INSTALL;

  const app = express();
  app.use(express.json());
  /* The print queue's door, and an ordinary kiosk door beside it, so the test
     can show that allowing a till opens exactly one of them. */
  app.post('/print', ensurePrintDevice, (req, res) => res.json({ status: true }));
  app.post('/other-kiosk-route', ensureKioskKey, (req, res) => res.json({ status: true }));

  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, '127.0.0.1', resolve);
  });
}, 60000);

afterAll(async () => {
  delete process.env.KIOSK_API_KEY;
  if (server) await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  if (mem) await mem.stop();
});

beforeEach(async () => {
  await PrintTill.deleteMany({});
});

describe('allowing a till', () => {
  test('a pasted key lets that machine print, and nothing else does', async () => {
    const till = aKey();

    const before = await ask('/print', till);
    expect(before.status).toBe(401);

    await tills.allowTill(till, 'Counter PC');

    const after = await ask('/print', till);
    expect(after.status).toBe(200);
  });

  test('the key itself is never stored, only a digest', async () => {
    /*
     * If this collection leaks, nothing in it can be replayed. That is the
     * whole reason the key starts life on the till rather than being handed
     * out by the server.
     */
    const till = aKey();
    await tills.allowTill(till, 'Counter PC');

    const row = await PrintTill.findOne({}).lean();
    const asText = JSON.stringify(row);
    expect(asText).not.toContain(till);
    expect(row.key_hash).toBe(crypto.createHash('sha256').update(till).digest('hex'));
  });

  test('what comes back to the browser has no key in it either', async () => {
    const till = aKey();
    await tills.allowTill(till, 'Counter PC');

    const listed = await tills.listTills();
    expect(JSON.stringify(listed.data)).not.toContain(till);
    expect(listed.data[0].label).toBe('Counter PC');
    /* Enough to tell two tills apart, useless on its own. */
    expect(listed.data[0].hint).toBe(`...${till.slice(-6)}`);
  });

  test('an allowed till may take print jobs and nothing else', async () => {
    /*
     * The blast radius, stated as a test. A leaked till key can claim bills
     * and say they printed. It cannot read the catalogue, rewrite an order, or
     * reach any other kiosk route.
     */
    const till = aKey();
    await tills.allowTill(till, 'Counter PC');

    expect((await ask('/print', till)).status).toBe(200);
    expect((await ask('/other-kiosk-route', till)).status).toBe(401);
  });

  test("this installation's own key still works, without touching the database", async () => {
    /* The overwhelmingly common case: a till on the shop's own Wi-Fi IS this
       installation, because the API runs inside it. */
    await mongoose.connection.db
      .collection('print_tills')
      .drop()
      .catch(() => {});
    expect((await ask('/print', THIS_INSTALL)).status).toBe(200);
  });

  test('pasting the same till twice is not an error', async () => {
    /* A shopkeeper who is not sure whether it worked pastes it again. The
       honest answer is "already allowed", not a red message or a second row. */
    const till = aKey();
    await tills.allowTill(till, 'Counter PC');
    const again = await tills.allowTill(till, 'The one by the door');

    expect(again.status).toBe(true);
    expect(again.data.already).toBe(true);
    expect(await PrintTill.countDocuments({})).toBe(1);

    /* And the new name is taken, which is the useful reading of a re-paste. */
    const listed = await tills.listTills();
    expect(listed.data[0].label).toBe('The one by the door');
  });

  test('a paste that went wrong is refused, not stored', async () => {
    for (const bad of ['', '   ', 'abc123', 'Counter PC']) {
       
      const out = await tills.allowTill(bad, 'Counter PC');
      expect(out.status).toBe(false);
    }
    expect(await PrintTill.countDocuments({})).toBe(0);
  });

  test('a till with no name given still has one', async () => {
    await tills.allowTill(aKey(), '   ');
    const listed = await tills.listTills();
    expect(listed.data[0].label).toBeTruthy();
  });
});

describe('removing a till', () => {
  test('a forgotten till stops printing immediately', async () => {
    const till = aKey();
    const made = await tills.allowTill(till, 'Counter PC');
    expect((await ask('/print', till)).status).toBe(200);

    await tills.forgetTill(made.data.id);

    expect((await ask('/print', till)).status).toBe(401);
  });

  test('removing one till does not remove another', async () => {
    const a = aKey();
    const b = aKey();
    const first = await tills.allowTill(a, 'Counter');
    await tills.allowTill(b, 'Upstairs');

    await tills.forgetTill(first.data.id);

    expect((await ask('/print', a)).status).toBe(401);
    expect((await ask('/print', b)).status).toBe(200);
  });

  test('forgetting something that is not there says so', async () => {
    const out = await tills.forgetTill(new mongoose.Types.ObjectId().toString());
    expect(out.status).toBe(false);
  });
});

describe('what a shopkeeper sees', () => {
  test('a till that has asked for work says when it last did', async () => {
    /*
     * The whole diagnostic. "Last seen 2 seconds ago" and "never" point at
     * completely different problems - a printer, or a key that was never
     * pasted right - and without this line they look identical.
     */
    const till = aKey();
    await tills.allowTill(till, 'Counter PC');

    expect((await tills.listTills()).data[0].last_seen_at).toBeNull();

    await ask('/print', till);

    const seen = (await tills.listTills()).data[0].last_seen_at;
    expect(seen).toBeTruthy();
    expect(Date.now() - new Date(seen).getTime()).toBeLessThan(5000);
  });

  test('the newest till is at the top', async () => {
    await tills.allowTill(aKey(), 'First');
    await new Promise((r) => setTimeout(r, 10));
    await tills.allowTill(aKey(), 'Second');

    const listed = await tills.listTills();
    expect(listed.data[0].label).toBe('Second');
  });
});

describe('when things are wrong', () => {
  test('a database that cannot be read refuses rather than admits', async () => {
    /*
     * Failing open here would turn a momentary outage into an open print
     * queue. The bills carry customer names and totals.
     */
    const broken = {
      findOneAndUpdate: async () => {
        throw new Error('no connection');
      },
    };
    expect(await tills.tillIsAllowed(aKey(), { Model: broken })).toBe(false);
  });

  test('an empty or short key never matches, whatever is in the collection', async () => {
    await tills.allowTill(aKey(), 'Counter PC');
    for (const bad of ['', null, undefined, 'short']) {
       
      expect(await tills.tillIsAllowed(bad)).toBe(false);
    }
  });
});
