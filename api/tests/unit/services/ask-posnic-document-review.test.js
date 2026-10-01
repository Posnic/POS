'use strict';
jest.mock('../../../src/controllers/dashboard.controller', () => ({}));
jest.mock('../../../src/utils/session-filter.util', () => ({}));
jest.mock('../../../src/services/ask-posnic.service', () => ({}));
jest.mock('../../../src/services/ask-posnic-platform.service', () => ({
  getPreferences: jest.fn().mockResolvedValue({}),
  capabilityAllowed: jest.fn().mockReturnValue(true),
  getDocument: jest.fn().mockResolvedValue(null),
}));
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
describe('source review authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    platform.capabilityAllowed.mockReturnValue(true);
  });
  test.each(['owner', 'admin', 'super_admin', 'manager', 'cashier', 'staff'])(
    '%s cannot promote a query flag into owner access',
    async (role) => {
      const req = { user: { role }, params: { id: 'draft' }, query: { review: '1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await controller.document(req, res);
      expect(platform.getDocument).toHaveBeenCalledWith(
        req,
        'draft',
        expect.objectContaining({ review: ['owner', 'admin', 'super_admin'].includes(role) })
      );
    }
  );
  test('disabled help blocks a staff review request but owners can still administer sources', async () => {
    platform.capabilityAllowed.mockReturnValue(false);
    const req = { user: { role: 'staff' }, params: { id: 'draft' }, query: { review: '1' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await controller.document(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(platform.getDocument).not.toHaveBeenCalled();
    req.user.role = 'owner';
    await controller.document(req, res);
    expect(platform.getDocument).toHaveBeenCalledWith(
      req,
      'draft',
      expect.objectContaining({ review: true })
    );
  });
});
