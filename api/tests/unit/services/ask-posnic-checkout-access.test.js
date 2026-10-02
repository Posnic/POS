'use strict';
jest.mock('../../../src/controllers/dashboard.controller', () => ({
  ensureContext: jest.fn().mockResolvedValue({ branchId: 'outlet', licenseId: 'shop' }),
}));
jest.mock('../../../src/utils/session-filter.util', () => ({}));
jest.mock('../../../src/services/ask-posnic.service', () => ({}));
jest.mock('../../../src/services/ask-posnic-platform.service', () => ({
  getPreferences: jest.fn(),
  capabilityAllowed: jest.fn(),
  scope: jest.fn().mockReturnValue({ branch_id: 'outlet' }),
}));
jest.mock('../../../src/services/ask-posnic-sale-draft.service', () => ({ prepare: jest.fn() }));
jest.mock('../../../src/services/ai.service', () => ({}));
jest.mock('../../../src/repositories/purchase-order.repository', () => ({}));
jest.mock('../../../src/repositories/inventory-count.repository', () => ({}));
jest.mock('../../../src/repositories/invoice.repository', () => ({}));
jest.mock('../../../src/services/knowledge-document.service', () => ({}));
jest.mock('../../../src/services/managed-ai-credits.service', () => ({}));
jest.mock('../../../src/services/ask-posnic-schedule.service', () => ({}));
jest.mock('../../../src/services/campaign.service', () => ({}));
jest.mock('../../../src/services/ask-posnic-runner.service', () => ({}));
jest.mock('../../../src/services/ask-posnic-outlet-insights.service', () => ({}));
jest.mock('../../../src/services/ask-posnic-reorder.service', () => ({}));
const controller = require('../../../src/controllers/ask-posnic.controller');
const platform = require('../../../src/services/ask-posnic-platform.service');
const sale = require('../../../src/services/ask-posnic-sale-draft.service');
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

describe('sale checkout preview access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    platform.getPreferences.mockResolvedValue({ allowed_actions: ['sale_checkout'] });
    platform.capabilityAllowed.mockReturnValue(true);
    sale.prepare.mockResolvedValue({ lines: [], total: 50 });
  });
  test.each([
    { role: 'staff', access: {} },
    { role: 'cashier', access: { sale: { write: false }, sales: { write: true } } },
    { role: 'cashier', access: { sale: { write: true }, sales: { write: false } } },
  ])('denies catalog preparation without effective sale write permission', async (user) => {
    const res = response();
    await controller.previewSale({ user, body: { lines_text: '1 x Coke' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(sale.prepare).not.toHaveBeenCalled();
  });
  test('owner cannot bypass the shop action switch', async () => {
    platform.getPreferences.mockResolvedValue({ allowed_actions: ['sale_draft'] });
    const res = response();
    await controller.previewSale({ user: { role: 'owner' }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(sale.prepare).not.toHaveBeenCalled();
  });
  test('authorized staff use trusted tenant context and cannot submit prices or another outlet', async () => {
    const res = response();
    await controller.previewSale(
      {
        user: { role: 'cashier', access: { sale: { write: true } } },
        body: { lines_text: '1 x Coke', branch_id: 'other', total: 0, unit_price: 0 },
      },
      res
    );
    expect(sale.prepare).toHaveBeenCalledWith(
      { branchId: 'outlet', licenseId: 'shop' },
      { lines_text: '1 x Coke' }
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });
  test('missing or ambiguous catalog items become correction requests', async () => {
    sale.prepare.mockRejectedValue(
      new Error('Coke matches more than one item. Use its unique barcode or SKU.')
    );
    const res = response();
    await controller.previewSale(
      { user: { role: 'owner' }, body: { lines_text: '1 x Coke' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: null, message: expect.stringContaining('barcode') })
    );
  });
});
