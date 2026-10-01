'use strict';

const service = require('../../../src/services/ask-posnic.service');

describe('Ask Posnic service', () => {
  test('last month uses the complete previous calendar month in the shop timezone', () => {
    expect(service.periodFrom('What were sales last month?')).toBe('last_month');
    expect(service.periodFrom('Compare sales this month versus last month')).toBe('month');
    const range = service.dateRange('last_month', 'Asia/Kolkata', new Date('2026-10-01T03:00:00Z'));
    expect(range.start_date.toISOString()).toBe('2026-08-31T18:30:00.000Z');
    expect(range.end_date.toISOString()).toBe('2026-09-30T18:29:59.999Z');
  });
  test('today and last week use outlet midnight rather than server midnight', () => {
    const at = new Date('2026-10-01T03:00:00Z');
    expect(service.dateRange('today', 'Asia/Kolkata', at).start_date.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    const week = service.dateRange('last_week', 'Asia/Kolkata', at);
    expect(week.start_date.toISOString()).toBe('2026-09-19T18:30:00.000Z');
    expect(week.end_date.toISOString()).toBe('2026-09-26T18:29:59.999Z');
    expect(service.periodFrom('profit last year')).toBe('last_year');
  });
  test('explicit question periods override shop defaults and help does not become a sales report', () => {
    expect(service.periodFrom('profit this month', undefined, 'today')).toBe('month');
    expect(service.periodFrom('sales today', undefined, 'month')).toBe('today');
    expect(service.periodFrom('sales', undefined, 'week')).toBe('week');
    expect(service.intentFrom('How do I return a sale?')).toBe('refund_help');
    expect(service.intentFrom('How do I create a purchase order?')).toBe('unknown');
    expect(service.intentFrom('Where can I view sales reports?')).toBe('unknown');
    expect(service.intentFrom('Explain profit margins')).toBe('unknown');
  });
  test('routes common shop questions to trusted tools', () => {
    expect(service.intentFrom('How are sales today?')).toBe('sales');
    expect(service.intentFrom('What needs restocking?')).toBe('low_stock');
    expect(service.periodFrom('Show sales this month')).toBe('month');
    expect(service.intentFrom('Compare sales with the previous period')).toBe('comparison');
    expect(service.intentFrom('Show cash vs card payment mix')).toBe('payment_mix');
    expect(service.intentFrom('How much is overdue?')).toBe('receivables');
    expect(service.intentFrom('Prepare a stock count')).toBe('stock_count_action');
    expect(service.intentFrom('Create a WhatsApp campaign')).toBe('campaign_action');
    expect(service.intentFrom('How much GST was collected?')).toBe('tax');
    expect(service.intentFrom('Show hourly sales today')).toBe('hourly_sales');
    expect(service.intentFrom('Show daily sales this month')).toBe('daily_sales');
    expect(service.intentFrom('Show slow-moving products this month')).toBe('slow_items');
    expect(service.intentFrom('Which products have not sold this month?')).toBe('no_sale_items');
    expect(service.intentFrom('Show category performance')).toBe('category_performance');
    expect(service.intentFrom('Show customer segments this month')).toBe('customer_segments');
    expect(service.intentFrom('What should I reorder this week?')).toBe('reorder_suggestions');
    expect(service.intentFrom('Show reorder suggestions for next 14 days')).toBe('reorder_suggestions');
    expect(service.intentFrom('Show coupon promotion performance this month')).toBe('promotion_performance');
    expect(service.intentFrom('Coupon usage this week')).toBe('promotion_performance');
    expect(service.intentFrom('How do I create a coupon?')).toBe('unknown');
    expect(service.intentFrom('Prepare a sales draft')).toBe('sale_draft_action');
    expect(service.intentFrom('Prepare a supplier message')).toBe('supplier_message_action');
    expect(service.intentFrom('Draft a message to my supplier')).toBe('supplier_message_action');
    expect(service.intentFrom('Create a sale')).toBe('sale_draft_action');
    expect(service.intentFrom('How do I create a sale?')).toBe('unknown');
  });

  test('formats sales from report values', () => {
    const result = service.answerOverview(
      'sales',
      { totals: { sales_amount: 123.45, sales_count: 3 }, topItems: [{ name: 'Tea' }] },
      'today'
    );
    expect(result.answer).toContain('123.45');
    expect(result.metrics).toContainEqual({ label: 'Top item', value: 'Tea' });
  });

  test('uses the complete low-stock count and previews items', () => {
    const result = service.answerOverview(
      'low_stock',
      { lowStock: { count: 7, items: [{ name: 'Milk', qty: 2 }] } },
      'today'
    );
    expect(result.answer).toContain('7 items');
    expect(result.metrics).toEqual([{ label: 'Milk', value: 2 }]);
  });

  test('does not reveal profit without the dashboard financial permission', () => {
    const result = service.answerOverview('profit', { financials: false }, 'month');
    expect(result.answer).toMatch(/does not have permission/i);
    expect(result.metrics).toEqual([]);
  });

  test('formats payment mix and top products from report output', () => {
    const overview = { paymentMix: [{ mode: 'Cash', pct: 60 }], topItems: [{ item_name: 'Tea', total_qty: 9 }] };
    expect(service.answerOverview('payment_mix', overview, 'today').metrics[0]).toEqual({ label: 'Cash', value: '60.00%' });
    expect(service.answerOverview('top_items', overview, 'today').metrics[0]).toEqual({ label: 'Tea', value: 9 });
  });

  test('formats tax only from the report total', () => {
    expect(service.answerOverview('tax', { kpis: { total_tax: 42.25 } }, 'today').metrics[0]).toEqual({ label: 'Tax collected', value: '42.25' });
  });
});
