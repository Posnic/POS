'use strict';

/*
 * Invoices: the invariant worth pinning is the one the design is built on -
 * AN INVOICE NEVER HOLDS MONEY. The mock records every collection name the
 * repository opens; every WRITE must land in 'invoices' and nothing else.
 * `branches` may be READ for the shop's defaults, exactly as quotes do.
 *
 * The lifecycle it pins is the international one: a draft is a proforma
 * (editable, deletable, cancellable, never overdue); issuing books a sale
 * (elsewhere) and from then on the document mirrors that sale.
 */

const mockRequestedCollections = [];
const mockCollection = {
  find: jest.fn(),
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  aggregate: jest.fn(),
};

jest.mock('../../../src/models/base.model', () => {
  return class MockBaseModel {
    constructor(name) {
      this.collectionName = name;
    }

    async getCollection(name) {
      mockRequestedCollections.push(name);
      return mockCollection;
    }
  };
});

const InvoiceRepository = require('../../../src/repositories/invoice.repository');
const { ObjectId } = require('mongodb');

const BRANCH = '64b000000000000000000001';
const LICENSE = '64b000000000000000000002';
const INVOICE = '64b000000000000000000003';
const ITEM = '64b000000000000000000004';
const SALE = '64b000000000000000000005';
const OTHER_SALE = '64b000000000000000000006';
const QUOTE = '64b000000000000000000007';
const ctx = { branchId: BRANCH, licenseId: LICENSE, userName: 'tester' };

const mkFindChain = (rows, calls = {}) => ({
  find: () => mkFindChain(rows, calls),
  sort: (s) => {
    calls.sort = s;
    return mkFindChain(rows, calls);
  },
  skip: (n) => {
    calls.skip = n;
    return mkFindChain(rows, calls);
  },
  limit: (n) => {
    calls.limit = n;
    return mkFindChain(rows, calls);
  },
  project: () => mkFindChain(rows, calls),
  toArray: async () => rows,
});

const writes = () =>
  ['insertOne', 'updateOne', 'deleteOne'].reduce(
    (n, m) => n + mockCollection[m].mock.calls.length,
    0
  );

describe('InvoiceRepository', () => {
  let repo;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestedCollections.length = 0;
    repo = new InvoiceRepository();
    mockCollection.find.mockReturnValue(mkFindChain([]));
    mockCollection.findOne.mockResolvedValue(null);
    mockCollection.countDocuments = jest.fn().mockResolvedValue(0);
    mockCollection.createIndex = jest.fn().mockResolvedValue('invoice_list_by_branch');
    require('../../../src/db/ensure-index')._reset();
  });

  test('create writes only the invoices collection, numbers INV-000001 and starts from the shop defaults', async () => {
    mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId(INVOICE) });
    mockCollection.findOne.mockResolvedValue({
      invoice_due_days: 15,
      invoice_terms: 'Payment within 15 days.',
      quote_default_bank_details: 'HDFC0001234 / 50100234567890',
    });
    const before = Date.now();
    const r = await repo.upsertInvoice(
      { items: [{ item_id: ITEM, item_name: 'Rice', qty: 2, unit_price: 50 }] },
      '',
      ctx
    );
    expect(r.status).toBe(true);
    expect(r.data.invoice_id).toBe('INV-000001');
    expect([...new Set(mockRequestedCollections)]).toEqual(['invoices', 'branches']);
    expect(mockCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(mockCollection.updateOne).not.toHaveBeenCalled();
    const doc = mockCollection.insertOne.mock.calls[0][0];
    expect(doc.status).toBe('draft');
    expect(doc.total).toBe(100);
    expect(doc.balance).toBe(100);
    expect(doc.paid_amount).toBe(0);
    expect(doc.sale_id).toBeNull();
    expect(doc.terms).toBe('Payment within 15 days.');
    expect(doc.bank_details).toBe('HDFC0001234 / 50100234567890');
    const days = (doc.due_date.getTime() - before) / 86400000;
    expect(days).toBeGreaterThan(14.9);
    expect(days).toBeLessThan(15.1);
    expect(String(doc.branch_id)).toBe(BRANCH);
    expect(String(doc.license)).toBe(LICENSE);
  });

  test('a prefix change continues the sequence instead of restarting it', async () => {
    mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId(INVOICE) });
    mockCollection.find.mockReturnValue(
      mkFindChain([
        { invoice_id: 'INV-000007' },
        { invoice_id: 'BILL-000009' },
        { invoice_id: 'junk' },
      ])
    );
    mockCollection.findOne.mockResolvedValue({ invoice_prefix: 'BILL-' });
    const r = await repo.upsertInvoice(
      { items: [{ item_id: ITEM, item_name: 'Rice', qty: 1, unit_price: 10 }] },
      '',
      ctx
    );
    expect(r.data.invoice_id).toBe('BILL-000010');
  });

  test('server math is the stored truth - the same rules quotes run', async () => {
    mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId(INVOICE) });
    const r = await repo.upsertInvoice(
      {
        items: [
          {
            item_id: ITEM,
            item_name: 'Rice',
            qty: 2,
            unit_price: 50,
            discount: { type: 'percent', value: 10 },
          },
          {
            kind: 'custom',
            item_name: 'Install',
            qty: 1,
            unit_price: 100,
            discount: { type: 'amount', value: 20 },
          },
        ],
        discount: { type: 'amount', value: 5 },
        charges: [
          { name: 'CGST 9%', type: 'percent', value: 9 },
          { name: 'Freight', type: 'amount', value: 40 },
          { name: 'Rebate', type: 'amount', value: 10, sign: -1 },
        ],
        total: 999999,
      },
      '',
      ctx
    );
    expect(r.status).toBe(true);
    const doc = mockCollection.insertOne.mock.calls[0][0];
    expect(doc.subtotal).toBe(170);
    expect(doc.charges_total).toBe(44.85);
    expect(doc.total).toBe(209.85);
    expect(doc.balance).toBe(209.85);
  });

  test('only a draft can be edited or deleted - an issued invoice is frozen', async () => {
    mockCollection.updateOne.mockResolvedValue({ matchedCount: 0 });
    const edit = await repo.upsertInvoice(
      { items: [{ item_id: ITEM, item_name: 'Rice', qty: 1, unit_price: 10 }] },
      INVOICE,
      ctx
    );
    expect(edit.status).toBe(false);
    expect(edit.message).toMatch(/issued/);
    expect(mockCollection.updateOne.mock.calls[0][0].status).toEqual({ $in: ['draft'] });

    mockCollection.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const del = await repo.deleteInvoice(INVOICE, ctx);
    expect(del.status).toBe(false);
    expect(mockCollection.deleteOne.mock.calls[0][0].status).toEqual({ $in: ['draft'] });
  });

  describe('the sale mirror', () => {
    const invoice = (extra = {}) => ({
      _id: new ObjectId(INVOICE),
      status: 'draft',
      total: 200,
      sale_id: null,
      ...extra,
    });

    test('an unpaid sale makes the invoice unpaid, a part payment partial, and full payment paid', async () => {
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      for (const [paid, status] of [
        [0, 'unpaid'],
        [50, 'partial'],
        [200, 'paid'],
      ]) {
        mockCollection.updateOne.mockClear();
        mockCollection.findOne.mockResolvedValue(invoice());
        const r = await repo.applySaleSnapshot(
          INVOICE,
          {
            sale_id: SALE,
            sale_number: 'S000042',
            total: 200,
            paid_amount: paid,
            payment_status: 'x',
          },
          ctx
        );
        expect(r.status).toBe(true);
        const set = mockCollection.updateOne.mock.calls[0][1].$set;
        expect(set.status).toBe(status);
        expect(set.paid_amount).toBe(paid);
        expect(set.balance).toBe(200 - paid);
        expect(String(set.sale_id)).toBe(SALE);
        expect(set.sale_number).toBe('S000042');
        expect(set.issued_date).toBeInstanceOf(Date);
        if (status === 'paid') expect(set.paid_date).toBeInstanceOf(Date);
      }
    });

    test('what is owed is what the SALE says - a rounded-off booking is not clamped to the paper', async () => {
      /* a 209.85 document booked with round-off on becomes a 210 sale */
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      mockCollection.findOne.mockResolvedValue(invoice({ total: 209.85 }));
      const r = await repo.applySaleSnapshot(
        INVOICE,
        { sale_id: SALE, total: 210, paid_amount: 100, payment_status: 'Partialy Paid' },
        ctx
      );
      expect(r.status).toBe(true);
      const set = mockCollection.updateOne.mock.calls[0][1].$set;
      expect(set.sale_total).toBe(210);
      expect(set.balance).toBe(110);
      expect(set.status).toBe('partial');
    });

    test('one invoice, one sale: a different sale is refused, the same one replays', async () => {
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      mockCollection.findOne.mockResolvedValue(
        invoice({ status: 'unpaid', sale_id: new ObjectId(SALE) })
      );
      const other = await repo.applySaleSnapshot(
        INVOICE,
        { sale_id: OTHER_SALE, paid_amount: 0 },
        ctx
      );
      expect(other.status).toBe(false);
      expect(mockCollection.updateOne).not.toHaveBeenCalled();

      const same = await repo.applySaleSnapshot(
        INVOICE,
        { sale_id: SALE, total: 200, paid_amount: 200 },
        ctx
      );
      expect(same.status).toBe(true);
      const set = mockCollection.updateOne.mock.calls[0][1].$set;
      expect(set.status).toBe('paid');
      /* the issue date was stamped the first time - not rewritten */
      expect(set.issued_date).toBeUndefined();
    });

    test('a cancelled invoice is left alone', async () => {
      mockCollection.findOne.mockResolvedValue(invoice({ status: 'cancelled' }));
      const r = await repo.applySaleSnapshot(INVOICE, { sale_id: SALE, paid_amount: 200 }, ctx);
      expect(r.status).toBe(false);
      expect(mockCollection.updateOne).not.toHaveBeenCalled();
    });

    test('nothing the mirror does touches any collection but invoices', async () => {
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      mockCollection.findOne.mockResolvedValue(invoice());
      await repo.applySaleSnapshot(INVOICE, { sale_id: SALE, paid_amount: 200 }, ctx);
      expect([...new Set(mockRequestedCollections)]).toEqual(['invoices']);
    });
  });

  describe('transitions', () => {
    test('a draft can be cancelled, with a reason kept on the record', async () => {
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
      mockCollection.findOne.mockResolvedValue({ _id: new ObjectId(INVOICE), status: 'draft' });
      const ok = await repo.transition(INVOICE, 'cancel', { reason: 'duplicate' }, ctx);
      expect(ok.status).toBe(true);
      const set = mockCollection.updateOne.mock.calls[0][1].$set;
      expect(set.status).toBe('cancelled');
      expect(set.cancel_reason).toBe('duplicate');
    });

    test('an issued invoice cannot be cancelled - the reversal is a return on its sale', async () => {
      for (const status of ['unpaid', 'partial', 'paid']) {
        mockCollection.findOne.mockResolvedValue({
          _id: new ObjectId(INVOICE),
          status,
          sale_number: 'S000042',
        });
        const r = await repo.transition(INVOICE, 'cancel', {}, ctx);
        expect(r.status).toBe(false);
        expect(r.message).toMatch(/return on sale S000042/);
      }
      expect(writes()).toBe(0);
    });

    test('there is no send state any more - sharing is a fact, not a status', async () => {
      mockCollection.findOne.mockResolvedValue({ _id: new ObjectId(INVOICE), status: 'draft' });
      const r = await repo.transition(INVOICE, 'send', {}, ctx);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Unknown action');
    });
  });

  test('sharing records the newest revision and the first time it left the shop, changing no status', async () => {
    mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    const r = await repo.recordShare(
      INVOICE,
      { key: 'b/abc', url: 'https://x/b/abc', rev: 2 },
      ctx
    );
    expect(r.status).toBe(true);
    expect(mockCollection.updateOne.mock.calls[0][1].$set.share.rev).toBe(2);
    const sent = mockCollection.updateOne.mock.calls[1];
    expect(sent[0].sent_date).toEqual({ $exists: false });
    expect(sent[1].$set.sent_date).toBeInstanceOf(Date);
    expect(sent[1].$set.status).toBeUndefined();
  });

  test('overdue is read off the due date of an ISSUED invoice, never stored - a proforma is not a receivable', () => {
    const now = new Date('2026-09-02T12:00:00Z');
    const past = new Date('2026-08-01T00:00:00Z');
    expect(InvoiceRepository.isOverdue({ status: 'unpaid', due_date: past }, now)).toBe(true);
    expect(InvoiceRepository.isOverdue({ status: 'partial', due_date: past }, now)).toBe(true);
    expect(InvoiceRepository.isOverdue({ status: 'draft', due_date: past }, now)).toBe(false);
    expect(InvoiceRepository.isOverdue({ status: 'paid', due_date: past }, now)).toBe(false);
    expect(InvoiceRepository.isOverdue({ status: 'cancelled', due_date: past }, now)).toBe(false);
    expect(InvoiceRepository.isOverdue({ status: 'unpaid', due_date: null }, now)).toBe(false);
    expect(
      InvoiceRepository.isOverdue({ status: 'unpaid', due_date: new Date('2026-12-01') }, now)
    ).toBe(false);
  });

  test('the list answers Overdue as a query on issued + owed + due date, and only whitelisted sorts reach Mongo', async () => {
    const calls = {};
    mockCollection.find.mockReturnValue(mkFindChain([], calls));
    const r = await repo.listInvoices({ status: 'overdue', sort: 'due_asc' }, ctx);
    expect(r.status).toBe(true);
    const filter = mockCollection.find.mock.calls[0][0];
    expect(filter.status).toEqual({ $in: ['unpaid', 'partial'] });
    expect(filter.due_date.$lt).toBeInstanceOf(Date);
    expect(calls.sort).toEqual({ due_date: 1, _id: -1 });

    const calls2 = {};
    mockCollection.find.mockReturnValue(mkFindChain([], calls2));
    await repo.listInvoices({ sort: 'created_by' }, ctx);
    expect(calls2.sort).toEqual({ created_date: -1 });
  });

  test('a quote becomes a draft invoice at the quoted numbers, remembering where it came from', async () => {
    mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId(INVOICE) });
    mockCollection.findOne.mockResolvedValue({ invoice_terms: 'Pay in 30 days.' });
    const quote = {
      _id: new ObjectId(QUOTE),
      quote_id: 'QUO-000012',
      customer_id: new ObjectId(ITEM),
      customer_name: 'Acme Traders',
      payment_method: 'NEFT',
      terms: 'Prices valid till the date above.',
      items: [
        {
          kind: 'item',
          item_id: new ObjectId(ITEM),
          item_name: 'Rice',
          qty: 2,
          unit_price: 50,
          discount: { type: 'percent', value: 10, computed: 10 },
          tax_name: 'GST 5%',
          tax_value: 5,
          tax_type: 'inclusive',
        },
      ],
      charges: [{ name: 'Freight', type: 'amount', value: 40, sign: 1, computed: 40 }],
      discount: { type: 'amount', value: 5, computed: 5 },
      total: 125,
    };
    const r = await repo.createFromQuote(quote, ctx);
    expect(r.status).toBe(true);
    const doc = mockCollection.insertOne.mock.calls[0][0];
    expect(doc.status).toBe('draft');
    expect(doc.items[0].line_total).toBe(90);
    expect(doc.items[0].tax_value).toBe(5);
    expect(doc.charges[0].computed).toBe(40);
    expect(doc.discount.computed).toBe(5);
    expect(doc.total).toBe(125);
    expect(doc.customer_name).toBe('Acme Traders');
    expect(doc.payment_method).toBe('NEFT');
    /* a quotation's wording has no place on a bill: the shop's invoice terms */
    expect(doc.terms).toBe('Pay in 30 days.');
    expect(String(doc.source_quote_id)).toBe(QUOTE);
    expect(doc.source_quote_number).toBe('QUO-000012');
  });

  test('a quote with no lines cannot become an invoice', async () => {
    const r = await repo.createFromQuote({ _id: new ObjectId(QUOTE), items: [] }, ctx);
    expect(r.status).toBe(false);
    expect(writes()).toBe(0);
  });
});
