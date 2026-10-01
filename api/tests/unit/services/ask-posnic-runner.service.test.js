'use strict';
jest.mock('../../../src/models/base.model', () => function MockBaseModel() {});
const mockSendMail = jest.fn();
const mockSendWhatsapp = jest.fn();
jest.mock('../../../src/utils/email', () => ({
  resolveShopTransport: () => ({
    transporter: { options: {}, sendMail: mockSendMail },
    from: 'sender@example.invalid',
  }),
}));
jest.mock(
  '../../../src/services/messaging.service',
  () =>
    class {
      sendWhatsapp(...args) {
        return mockSendWhatsapp(...args);
      }
    }
);
const runner = require('../../../src/services/ask-posnic-runner.service');
const assistant = require('../../../src/services/ask-posnic.service');

test('daily and weekly reports use complete days in the selected timezone', () => {
  const at = new Date('2026-10-01T03:00:00Z');
  const daily = runner.reportRange({ timezone: 'Asia/Kolkata', frequency: 'daily' }, at);
  const weekly = runner.reportRange({ timezone: 'Asia/Kolkata', frequency: 'weekly' }, at);
  expect(daily.starting_date.toISOString()).toBe('2026-09-29T18:30:00.000Z');
  expect(daily.ending_date.toISOString()).toBe('2026-09-30T18:29:59.999Z');
  expect(weekly.starting_date.toISOString()).toBe('2026-09-23T18:30:00.000Z');
});

test('profit comparison uses profit and explains a zero baseline', () => {
  const result = assistant.answerComparison(
    { profit: { net_profit: 30 }, totals: { sales_amount: 900 } },
    { profit: { net_profit: 0 }, totals: { sales_amount: 300 } },
    'profit'
  );
  expect(result.metrics).toEqual([
    { label: 'Current profit', value: '30.00' },
    { label: 'Previous profit', value: '0.00' },
    { label: 'Change', value: 'N/A' },
  ]);
  expect(result.answer).toContain('previous total was zero');
});

test('a loss becoming a smaller loss is an improvement', () => {
  expect(
    assistant.answerComparison(
      { profit: { net_profit: -25 } },
      { profit: { net_profit: -50 } },
      'profit'
    ).answer
  ).toContain('increased 50.0%');
});

const report = {
  answer: 'Sales are 10.',
  metrics: [],
  branch: { branch_name: 'Synthetic outlet' },
  source: 'Sales report',
  range: { starting_date: new Date(0), ending_date: new Date(1000) },
};
const schedule = {
  _id: '64a000000000000000000001',
  report: 'sales',
  destination: 'owner@example.invalid',
  license: 'shop',
  branch_id: 'outlet',
  user_id: 'owner',
  running_claim: 'claim',
};

test.each([
  { messageId: 'id', accepted: [] },
  { messageId: 'id', accepted: ['someone-else@example.invalid'] },
  { accepted: ['owner@example.invalid'] },
  { messageId: 'id', accepted: ['owner@example.invalid'], rejected: ['owner@example.invalid'] },
])('requires an explicit email acknowledgement for the intended recipient', async (info) => {
  mockSendMail.mockResolvedValueOnce(info);
  await expect(runner.deliver(schedule, report)).rejects.toThrow(/did not acknowledge/);
});

test('returns only the provider reference after acknowledged email acceptance', async () => {
  mockSendMail.mockResolvedValueOnce({
    messageId: 'mail-id',
    accepted: ['owner@example.invalid'],
    rejected: [],
    secret: 'not-for-storage',
  });
  await expect(runner.deliver(schedule, report)).resolves.toEqual({
    status: 'sent',
    provider: 'smtp',
    reference: 'mail-id',
  });
});

test('distinguishes queued WhatsApp from a sent message and passes the execution scope', async () => {
  mockSendWhatsapp.mockResolvedValueOnce({
    ok: true,
    queued: true,
    provider: 'whatsapp_connector',
    messageId: '64a000000000000000000002',
  });
  await expect(runner.deliver({ ...schedule, channel: 'whatsapp' }, report)).resolves.toMatchObject(
    { status: 'queued', provider: 'whatsapp_connector' }
  );
  expect(mockSendWhatsapp.mock.calls.at(-1)[3]).toEqual({
    scheduled: {
      id: schedule._id,
      license: 'shop',
      branch_id: 'outlet',
      user_id: 'owner',
      claim: 'claim',
    },
  });
  mockSendWhatsapp.mockResolvedValueOnce({ ok: true });
  await expect(runner.deliver({ ...schedule, channel: 'whatsapp' }, report)).rejects.toThrow(
    /not acknowledged/
  );
});
