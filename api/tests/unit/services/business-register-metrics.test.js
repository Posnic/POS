'use strict';
const { ObjectId } = require('mongodb');
const { registerSaleContribution } = require('../../../src/services/business-register-metrics');
const branch = {
  id: 'a'.repeat(24),
  license: 'b'.repeat(24),
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  currencyDigits: 2,
};
const close = {
  branchId: branch.id,
  sessionId: 'c'.repeat(24),
  openedAt: '2026-09-29T16:00:00.000Z',
  closedAt: '2026-09-29T20:00:00.000Z',
};
const sale = () => ({
  _id: new ObjectId(),
  branch_id: new ObjectId(branch.id),
  license: new ObjectId(branch.license),
  cashregister_id: close.sessionId,
  date: new Date('2026-09-29T18:00:00Z'),
  updated_date: new Date('2026-09-29T18:00:00Z'),
  sale_process: 'Add',
  sales_total: '100.00',
  items_return_total: 0,
  items_return: [],
});
const refund = (cashregister_id, date = '2026-09-29T19:00:00Z') => ({
  returnArray: {
    returnObjId: new ObjectId(),
    returnDate: new Date(date),
    itemsTotalAmount: '20.00',
    ...(cashregister_id ? { cashregister_id } : {}),
  },
});
describe('register session financial contributions', () => {
  test('includes invoices on both local calendar dates without treating other tills as this session', () => {
    expect(registerSaleContribution(sale(), branch, close)).toEqual({
      billedSalesMinor: 10000,
      refundsMinor: 0,
      completedSales: 1,
    });
    expect(
      registerSaleContribution({ ...sale(), date: new Date('2026-09-29T19:00:00Z') }, branch, close)
        .billedSalesMinor
    ).toBe(10000);
    expect(
      registerSaleContribution({ ...sale(), cashregister_id: 'd'.repeat(24) }, branch, close)
    ).toEqual({ billedSalesMinor: 0, refundsMinor: 0, completedSales: 0 });
  });
  test('attributes a refund from an older invoice by the return session, never by the invoice register', () => {
    const old = {
      ...sale(),
      date: new Date('2026-09-27T10:00:00Z'),
      cashregister_id: 'd'.repeat(24),
      items_return_total: 20,
      items_return: [refund(close.sessionId)],
    };
    expect(registerSaleContribution(old, branch, close)).toEqual({
      billedSalesMinor: 0,
      refundsMinor: 2000,
      completedSales: 0,
    });
    old.items_return = [refund('e'.repeat(24))];
    expect(registerSaleContribution(old, branch, close).refundsMinor).toBe(0);
  });
  test('legacy refunds inside the period are unavailable; later returns do not rewrite the closed period', () => {
    const changed = { ...sale(), items_return_total: 20, items_return: [refund(null)] };
    expect(() => registerSaleContribution(changed, branch, close)).toThrow(
      'return_register_unavailable'
    );
    changed.items_return = [refund(null, '2026-09-30T10:00:00Z')];
    expect(registerSaleContribution(changed, branch, close)).toEqual({
      billedSalesMinor: 10000,
      refundsMinor: 0,
      completedSales: 1,
    });
    changed.updated_date = new Date('2026-09-30T10:00:00Z');
    expect(() => registerSaleContribution(changed, branch, close)).toThrow(
      'session_history_unavailable'
    );
  });
  test('retains canonical exclusion/reconciliation and rejects uncertain invoice settlement timing', () => {
    expect(
      registerSaleContribution({ ...sale(), training: true }, branch, close).completedSales
    ).toBe(0);
    expect(
      registerSaleContribution(
        { ...sale(), sale_process: 'KOT', payment_status: 'Unpaid' },
        branch,
        close
      ).completedSales
    ).toBe(0);
    expect(() =>
      registerSaleContribution({ ...sale(), date: new Date('2026-09-29T15:59:59Z') }, branch, close)
    ).toThrow('invoice_session_time_unavailable');
    expect(() =>
      registerSaleContribution({ ...sale(), items_return_total: 20 }, branch, close)
    ).toThrow('unreconciled_returns');
    expect(() =>
      registerSaleContribution({ ...sale(), branch_id: new ObjectId() }, branch, close)
    ).toThrow('scope_mismatch');
  });
});
