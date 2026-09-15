'use strict';

/*
 * WHAT THE HANDSET'S DOOR ACTUALLY RECORDS, by calling it.
 *
 * Owner: "every order should have some details. example what mobile, user
 * agent, ip address, mobile type or user account whatever infromation app can
 * know do it." And then, fairly: "have you tested ?"
 *
 * The first test written for this read the CONTROLLER'S SOURCE with a regular
 * expression - that `clientIp(req)` appears, that the body is spread before
 * ours. That is not a test of behaviour. It passes if the code is reachable by
 * nobody, it passes if an early return skips the whole block, and it would
 * pass against a file that never ran.
 *
 * So this calls the real handler with a real-shaped request and looks at what
 * reaches the service. The service is the seam, because everything past it is
 * a database; what matters here is precisely the handover.
 */

const controller = require('../../../src/controllers/sales.controller');
const salesService = require('../../../src/services/sale.service');

/** A request the way Express builds one, with the headers that matter. */
function aRequest(body = {}, { user = null, ip = '203.0.113.7', headers = {} } = {}) {
  const all = {
    'user-agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A; wv) Chrome/118',
    referer: 'https://azure.posnic.io/order/',
    ...headers,
  };
  return {
    body,
    ip,
    user,
    headers: all,
    get: (name) => all[String(name).toLowerCase()],
    connection: { remoteAddress: ip },
    socket: { remoteAddress: ip },
  };
}

function aResponse() {
  const sent = {};
  return {
    sent,
    status(code) {
      sent.code = code;
      return this;
    },
    json(payload) {
      sent.body = payload;
      return this;
    },
    send(payload) {
      sent.body = payload;
      return this;
    },
  };
}

describe('the door every handset uses', () => {
  let seen;
  let spy;

  beforeEach(() => {
    seen = null;
    spy = jest.spyOn(salesService, 'createOnlineOrder').mockImplementation(async (data, opts) => {
      seen = { data, opts };
      return { status: true, data: { order_id: 'o-1' }, message: 'Order placed' };
    });
  });

  afterEach(() => spy.mockRestore());

  const place = async (body, options) => {
    await controller.qrOrder(aRequest(body, options), aResponse());
    return seen;
  };

  test('the address and the user agent come from the request', async () => {
    const { data } = await place({ branch: 'b1', items: [] });

    expect(data.client.ip).toBe('203.0.113.7');
    expect(data.client.user_agent).toMatch(/SM-G991B/);
    expect(data.client.referrer).toBe('https://azure.posnic.io/order/');
  });

  test('what the phone says about itself is carried through', async () => {
    const { data } = await place({
      branch: 'b1',
      items: [],
      client: {
        app: 'captain',
        app_version: '1.2.21 (abc1234)',
        device_model: 'SM-G991B',
        device_id: 'fixed-uuid-1111',
        network: 'lan',
      },
    });

    expect(data.client.app).toBe('captain');
    expect(data.client.app_version).toBe('1.2.21 (abc1234)');
    expect(data.client.device_model).toBe('SM-G991B');
    expect(data.client.network).toBe('lan');
  });

  test('a phone cannot name its own address', async () => {
    /*
     * THE ONE THAT MATTERS. A body claiming an address would put a made-up
     * origin on a real order - and an order's provenance is worth nothing if
     * the thing being investigated can write it.
     */
    const { data } = await place({
      branch: 'b1',
      items: [],
      client: { ip: '10.9.9.9', user_agent: 'definitely not me', referrer: 'https://elsewhere' },
    });

    expect(data.client.ip).toBe('203.0.113.7');
    expect(data.client.user_agent).toMatch(/SM-G991B/);
    expect(data.client.referrer).toBe('https://azure.posnic.io/order/');
  });

  test('and cannot name the waiter', async () => {
    /* A phone that can set staff_name can put somebody else's name on an
       order it placed, which is worse than recording nothing. */
    const { data } = await place(
      { branch: 'b1', items: [], client: { staff_id: 'someone', staff_name: 'Not Me' } },
      { user: { _id: '65b0', name: 'Ravi' } }
    );

    expect(data.client.staff_id).toBe('65b0');
    expect(data.client.staff_name).toBe('Ravi');
  });

  test('a signed-in handset is recorded as staff, and an anonymous one is not', async () => {
    const signedIn = await place(
      { branch: 'b1', items: [] },
      { user: { _id: '65b0', name: 'Ravi' } }
    );
    expect(signedIn.data.client.staff_name).toBe('Ravi');
    expect(signedIn.opts.staffOrder).toBe(true);

    const anonymous = await place({ branch: 'b1', items: [] });
    expect(anonymous.data.client.staff_name).toBeUndefined();
    expect(anonymous.opts.staffOrder).toBe(false);
  });

  test('a body with no client block still records what the request proves', async () => {
    /* Every handset in the field today, until it updates. */
    const { data } = await place({ branch: 'b1', items: [] });
    expect(data.client.ip).toBe('203.0.113.7');
    expect(data.client.app).toBeUndefined();
  });

  test('a client block that is not an object is ignored, not spread', async () => {
    const { data } = await place({ branch: 'b1', items: [], client: 'nonsense' });
    expect(data.client.ip).toBe('203.0.113.7');
    expect(data.client.user_agent).toMatch(/SM-G991B/);
  });

  test('the rest of the order is passed through untouched', async () => {
    /* The client block is added beside the order, never instead of part of
       it - a provenance change that quietly dropped the items would be a
       catastrophe with a tidy diff. */
    const { data } = await place({
      branch: 'b1',
      items: [{ item_id: 'i1', item_quantity: 2 }],
      kiosk_table_no: '6A',
      idempotencyKey: 'tap-1',
    });

    expect(data.items).toEqual([{ item_id: 'i1', item_quantity: 2 }]);
    expect(data.kiosk_table_no).toBe('6A');
    expect(data.idempotencyKey).toBe('tap-1');
  });
});
