'use strict';

jest.mock('../../../src/controllers/dashboard.controller', () => ({
  canSeeFinancials: jest.fn().mockReturnValue(false),
  ensureContext: jest.fn(),
}));
jest.mock('../../../src/utils/session-filter.util', () => ({}));
jest.mock('../../../src/services/ask-posnic-platform.service', () => ({
  getPreferences: jest.fn(),
  capabilityAllowed: jest.fn(),
  previousAnswer: jest.fn(),
  saveMessage: jest.fn(),
  retrieve: jest.fn(),
  currentMatches: jest.fn(),
  audit: jest.fn(),
  scope: () => ({ license: 'shop', branch_id: 'outlet', user_id: 'user' }),
}));
jest.mock('../../../src/services/ai.service', () => ({ available: jest.fn() }));
jest.mock('../../../src/services/ask-posnic-knowledge-sync.service', () => ({ sync: jest.fn() }));
jest.mock('../../../src/services/ask-posnic-grounding.service', () => ({ answer: jest.fn() }));
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

const platform = require('../../../src/services/ask-posnic-platform.service');
const ai = require('../../../src/services/ai.service');
const grounding = require('../../../src/services/ask-posnic-grounding.service');
const sync = require('../../../src/services/ask-posnic-knowledge-sync.service');
const dashboard = require('../../../src/controllers/dashboard.controller');
const controller = require('../../../src/controllers/ask-posnic.controller');
const request = (question) => ({
  body: { question, conversation_id: '012345678901234567890123' },
  user: { role: 'cashier' },
});
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks();
  platform.getPreferences.mockResolvedValue({ default_period: 'today' });
  platform.capabilityAllowed.mockReturnValue(true);
  platform.saveMessage.mockResolvedValue('conversation');
  platform.audit.mockResolvedValue();
  platform.retrieve.mockResolvedValue([]);
  platform.currentMatches.mockImplementation(async (_req, matches) => matches);
  sync.sync.mockResolvedValue();
});

test('a greeting needs no provider or knowledge synchronization', async () => {
  const res = response();
  await controller.ask(request('Hello'), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        answer: expect.stringContaining('Hello!'),
        suggestions: expect.any(Array),
      }),
    })
  );
  expect(sync.sync).not.toHaveBeenCalled();
  expect(ai.available).not.toHaveBeenCalled();
});

test('an irrelevant source rejected by grounding becomes an unverified clarification', async () => {
  platform.retrieve.mockResolvedValue([
    {
      title: 'General boundaries',
      text: 'unrelated policy',
      document_id: 'abc',
      revision: '1',
      chunk: 0,
    },
  ]);
  ai.available.mockResolvedValue(true);
  grounding.answer.mockResolvedValue({
    text: 'Repeated generic refusal',
    mode: 'refusal',
    reason: 'unsupported',
  });
  const res = response();
  await controller.ask(request('Why is my terminal broken?'), res);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        mode: 'clarification',
        verified: false,
        citations: [],
        suggestions: expect.any(Array),
        answer: expect.stringContaining('specific question'),
      }),
    })
  );
});

test('a report follow-up must pass the current insights policy before reading data', async () => {
  platform.previousAnswer.mockResolvedValue({ intent: 'profit' });
  platform.capabilityAllowed.mockReturnValue(false);
  const res = response();
  await controller.ask(request('What about yesterday?'), res);
  expect(platform.capabilityAllowed).toHaveBeenCalledWith(
    expect.any(Object),
    'insights',
    expect.any(Object)
  );
  expect(res.status).toHaveBeenCalledWith(403);
  expect(dashboard.ensureContext).not.toHaveBeenCalled();
  expect(platform.saveMessage).not.toHaveBeenCalled();
});
