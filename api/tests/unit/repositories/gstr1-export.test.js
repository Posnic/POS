'use strict';

/*
 * GSTR-1 B2B export shape.
 *
 * This is a FILING artifact: a wrong field name or a duplicated GSTIN is
 * not a cosmetic bug, it is a return the government tool rejects or - worse -
 * accepts with the wrong numbers. The previous builder summed CGST+SGST into
 * `csamt`, which is the CESS field, emitted one b2b entry per aggregation row
 * (so a customer appeared many times and one invoice split across entries),
 * summed the RATE column across items, and hardcoded the place of supply.
 * Every one of those is pinned below.
 */

jest.mock('mongoose', () => ({
  connection: { name: 'test' },
  Types: { ObjectId: jest.fn((id) => ({ toString: () => String(id) })) },
}));

jest.mock('mongodb', () => {
  const m = jest.fn((id) => ({ toString: () => String(id) }));
  m.isValid = jest.fn(() => true);
  return { ObjectId: m };
});

const mockAggregate = jest.fn();
jest.mock('../../../src/db/tenant-context', () => ({
  currentConnection: jest.fn(() => ({
    collection: jest.fn(() => ({
      aggregate: mockAggregate,
    })),
  })),
}));

jest.mock('../../../src/utils/helpers', () => ({ formatDate: jest.fn() }));
jest.mock('../../../src/constants', () => ({ PAYMENT_STATUS: {}, SALE_STATUS: {} }));
jest.mock('../../../src/repositories/stock-log.repository', () => jest.fn());
jest.mock('../../../src/models/sale.model', () => ({}));
jest.mock('../../../src/models/base.model', () => {
  function MockBaseModel() {}
  MockBaseModel.license = null;
  MockBaseModel.currentBranch = null;
  return MockBaseModel;
});

const salesRepository = require('../../../src/repositories/sale.repository');

const BRANCH = '64f9a1c2e3b4d5e6f7000002';
const LICENSE = '64f9a1c2e3b4d5e6f7000003';

const TN = '33AAAAA0000A1Z5'; // Tamil Nadu, state code 33
const MH = '27BBBBB0000B1Z5'; // Maharashtra, state code 27

const rows = (list) => {
  mockAggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue(list) });
};

const run = () =>
  salesRepository.gstOneReportPageJson({
    starting_date: '08/01/2026',
    ending_date: '08/31/2026',
    branch_id: BRANCH,
    license: LICENSE,
  });

describe('GSTR-1 B2B export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('CGST and SGST land in camt/samt - csamt is CESS and stays zero', async () => {
    // The filing bug: cgst+sgst used to be written into csamt, so every
    // intra-state invoice declared state tax as cess and no CGST/SGST at all.
    rows([
      {
        _id: { sales_id: 'INV-1', ctin: TN, rate: 18 },
        date: new Date('2026-08-05T00:00:00Z'),
        customer_state: 'Tamil Nadu',
        invoice_value: 1180,
        items_value: 1180,
        igst: 0,
        cgst: 90,
        sgst: 90,
      },
    ]);

    const res = await run();
    expect(res.status).toBe(true);

    const det = res.data[0].inv[0].itms[0].itm_det;
    expect(det).toEqual({ rt: 18, txval: 1000, iamt: 0, camt: 90, samt: 90, csamt: 0 });
  });

  test('one entry per GSTIN, holding all of that customer invoices', async () => {
    // Previously each row became its own b2b entry, so the same ctin
    // repeated and the tool saw duplicate customers.
    rows([
      {
        _id: { sales_id: 'INV-1', ctin: TN, rate: 18 },
        date: new Date('2026-08-05T00:00:00Z'),
        customer_state: 'Tamil Nadu',
        invoice_value: 1180,
        items_value: 1180,
        igst: 0,
        cgst: 90,
        sgst: 90,
      },
      {
        _id: { sales_id: 'INV-2', ctin: TN, rate: 18 },
        date: new Date('2026-08-09T00:00:00Z'),
        customer_state: 'Tamil Nadu',
        invoice_value: 2360,
        items_value: 2360,
        igst: 0,
        cgst: 180,
        sgst: 180,
      },
      {
        _id: { sales_id: 'INV-3', ctin: MH, rate: 18 },
        date: new Date('2026-08-11T00:00:00Z'),
        customer_state: 'Maharashtra',
        invoice_value: 1180,
        items_value: 1180,
        igst: 180,
        cgst: 0,
        sgst: 0,
      },
    ]);

    const res = await run();
    expect(res.data).toHaveLength(2);

    const tn = res.data.find((r) => r.ctin === TN);
    expect(tn.inv.map((i) => i.inum)).toEqual(['INV-1', 'INV-2']);

    const mh = res.data.find((r) => r.ctin === MH);
    expect(mh.inv).toHaveLength(1);
    expect(mh.inv[0].itms[0].itm_det.iamt).toBe(180);
  });

  test('an invoice with two rates keeps ONE invoice and two numbered item lines', async () => {
    rows([
      {
        _id: { sales_id: 'INV-1', ctin: TN, rate: 18 },
        date: new Date('2026-08-05T00:00:00Z'),
        customer_state: 'Tamil Nadu',
        invoice_value: 1705,
        items_value: 1180,
        igst: 0,
        cgst: 90,
        sgst: 90,
      },
      {
        _id: { sales_id: 'INV-1', ctin: TN, rate: 5 },
        date: new Date('2026-08-05T00:00:00Z'),
        customer_state: 'Tamil Nadu',
        invoice_value: 1705,
        items_value: 525,
        igst: 0,
        cgst: 12.5,
        sgst: 12.5,
      },
    ]);

    const res = await run();
    expect(res.data).toHaveLength(1);
    expect(res.data[0].inv).toHaveLength(1);

    const inv = res.data[0].inv[0];
    // invoice value is the sale's own total, not a sum of the rate groups
    expect(inv.val).toBe(1705);
    expect(inv.itms.map((i) => i.num)).toEqual([1, 2]);
    // rt is each rate itself - the old builder summed them into 23
    expect(inv.itms.map((i) => i.itm_det.rt)).toEqual([18, 5]);
    expect(inv.itms[1].itm_det.txval).toBe(500);
  });

  test('place of supply comes from the customer GSTIN, with the state name as fallback', async () => {
    rows([
      {
        _id: { sales_id: 'INV-1', ctin: TN, rate: 18 },
        date: new Date('2026-08-05T00:00:00Z'),
        customer_state: 'Tamil Nadu',
        invoice_value: 1180,
        items_value: 1180,
        igst: 0,
        cgst: 90,
        sgst: 90,
      },
      {
        _id: { sales_id: 'INV-9', ctin: '', rate: 18 },
        date: new Date('2026-08-06T00:00:00Z'),
        customer_state: 'Punjab',
        invoice_value: 1180,
        items_value: 1180,
        igst: 180,
        cgst: 0,
        sgst: 0,
      },
    ]);

    const res = await run();
    expect(res.data.find((r) => r.ctin === TN).inv[0].pos).toBe('33');
    // no GSTIN on the row: resolved from the stored state name
    expect(res.data.find((r) => r.ctin === '').inv[0].pos).toBe('03');
  });

  test('invoice date is rendered DD-MM-YYYY as the tool expects', async () => {
    rows([
      {
        _id: { sales_id: 'INV-1', ctin: TN, rate: 18 },
        date: new Date(2026, 7, 5), // 5 Aug 2026, local
        customer_state: 'Tamil Nadu',
        invoice_value: 1180,
        items_value: 1180,
        igst: 0,
        cgst: 90,
        sgst: 90,
      },
    ]);

    const res = await run();
    expect(res.data[0].inv[0].idt).toBe('05-08-2026');
  });

  test('rows without an invoice number are skipped rather than filed empty', async () => {
    rows([
      {
        _id: { sales_id: '', ctin: TN, rate: 18 },
        date: new Date('2026-08-05T00:00:00Z'),
        customer_state: 'Tamil Nadu',
        invoice_value: 100,
        items_value: 100,
        igst: 0,
        cgst: 0,
        sgst: 0,
      },
    ]);

    const res = await run();
    expect(res.status).toBe(true);
    expect(res.data).toEqual([]);
  });

  test('missing branch or license is refused, not filed as an empty return', async () => {
    const res = await salesRepository.gstOneReportPageJson({
      starting_date: '08/01/2026',
      ending_date: '08/31/2026',
    });
    expect(res.status).toBe(false);
    expect(mockAggregate).not.toHaveBeenCalled();
  });
});
