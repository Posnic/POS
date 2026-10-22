'use strict';
jest.mock('../../../src/models/base.model', () => function MockBaseModel() {});
const mockSendMail = jest.fn();
const mockSendWhatsapp = jest.fn();
const mockSendSms = jest.fn();
jest.mock('../../../src/services/report-document.service', () => ({
  prepare: jest.fn().mockResolvedValue({
    buffer: Buffer.from('pdf'),
    filename: 'summary.pdf',
    url: 'https://example.invalid/report.pdf',
  }),
  periodLabel: () => '20 Oct 2026 (Asia/Kolkata)',
}));
jest.mock('../../../src/utils/email', () => ({
  resolveConfiguredShopTransport: () => ({
    transporter: { options: {}, sendMail: mockSendMail },
    from: 'sender@example.invalid',
  }),
}));
jest.mock(
  '../../../src/services/messaging.service',
  () =>
    class {
      sendSms(...args) {
        return mockSendSms(...args);
      }
      sendWhatsapp(...args) {
        return mockSendWhatsapp(...args);
      }
    }
);
const runner = require('../../../src/services/ask-posnic-runner.service');
const assistant = require('../../../src/services/ask-posnic.service');

test('sales report includes card and all other tenders without mixing them into cash', () => {
  const metrics = runner.paymentMetrics({
    paymentMix: [
      { mode: 'Cash', amount: 15980 },
      { mode: 'Upi', amount: 16477 },
      { mode: 'Card', amount: 7000 },
      { mode: ' card ', amount: 467 },
      { mode: 'Voucher', amount: 0 },
      { mode: 'Unknown' },
    ],
  });
  expect(metrics).toEqual([
    { label: 'Cash', value: '15980.00' },
    { label: 'Upi', value: '16477.00' },
    { label: 'Card', value: '7467.00' },
    { label: 'Voucher', value: '0.00' },
  ]);
  expect(metrics.reduce((total, item) => total + Number(item.value), 0)).toBe(39924);
});

test('payment summary preserves decimal and refund amounts', () => {
  expect(
    runner.paymentMetrics({
      paymentMix: [
        { mode: 'Card', amount: 0.1 },
        { mode: 'Card', amount: 0.2 },
        { mode: 'Cash', amount: -20.25 },
      ],
    })
  ).toEqual([
    { label: 'Card', value: '0.30' },
    { label: 'Cash', value: '-20.25' },
  ]);
});

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
    document: expect.objectContaining({
      filename: 'summary.pdf',
      url: 'https://example.invalid/report.pdf',
    }),
    purpose: 'Scheduled report',
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

test('monthly report covers the complete previous month including leap day', () => {
  const range = runner.reportRange(
    { frequency: 'monthly', timezone: 'Asia/Kolkata' },
    new Date('2028-03-01T03:00:00Z')
  );
  expect(range.starting_date.toISOString()).toBe('2028-01-31T18:30:00.000Z');
  expect(range.ending_date.toISOString()).toBe('2028-02-29T18:29:59.999Z');
});
test('background delivery keeps its shop context across awaits and restores the caller', async () => {
  const {
    getRequestContext,
    runWithRequestContext,
  } = require('../../../src/utils/request-context');
  mockSendWhatsapp.mockImplementationOnce(async () => {
    await Promise.resolve();
    expect(getRequestContext()).toMatchObject({
      license: 'shop',
      currentBranch: 'outlet',
      loggedUser: 'owner',
    });
    return { ok: true, messageId: 'scheduled-reference', provider: 'whatsapp_web' };
  });
  await runWithRequestContext({ license: 'different-shop' }, async () => {
    await runner.deliver({ ...schedule, channel: 'whatsapp' }, report);
    expect(getRequestContext()).toEqual({ license: 'different-shop' });
  });
});
test('scheduled delivery uses the BSON license type used by messaging settings', async () => {
  const { getRequestContext } = require('../../../src/utils/request-context');
  mockSendWhatsapp.mockImplementationOnce(async () => {
    expect(getRequestContext().license._bsontype).toBe('ObjectId');
    expect(String(getRequestContext().license)).toBe('64a000000000000000000003');
    return { ok: true, messageId: 'scheduled-reference', provider: 'whatsapp_web' };
  });
  await runner.deliver(
    { ...schedule, license: '64a000000000000000000003', channel: 'whatsapp' },
    report
  );
});
test('messaging reports still require an active owner with outlet access', async () => {
  const schedule = {
    source: 'messaging',
    channel: 'email',
    license: 'shop',
    branch_id: 'outlet',
    user_id: 'owner',
  };
  const lookup = jest.fn(async () => ({
    _id: 'owner',
    role: 'cashier',
    branch_access: [{ branch_id: 'outlet' }],
  }));
  const db = { collection: () => ({ findOne: lookup }) };
  await expect(runner.authorize(db, schedule)).rejects.toThrow(/owner no longer/);
  lookup.mockResolvedValue({ role: 'super_admin', branch_access: [{ branch_id: 'other' }] });
  await expect(runner.authorize(db, schedule)).rejects.toThrow(/owner no longer/);
  lookup
    .mockResolvedValueOnce({ role: 'super_admin', branch_access: [{ branch_id: 'outlet' }] })
    .mockResolvedValueOnce({ _id: 'outlet', branch_name: 'Test' });
  await expect(runner.authorize(db, schedule)).resolves.toHaveProperty(
    'branch.branch_name',
    'Test'
  );
  expect(lookup.mock.calls[0][0]).toHaveProperty('status', {
    $nin: ['inactive', 'suspended', 'pending'],
  });
});

test('SMS reports use the scoped branch and preserve provider acknowledgement', async () => {
  mockSendSms.mockResolvedValueOnce({ ok: true, messageId: 'sms-provider-id' });
  await expect(
    runner.deliver(
      { ...schedule, channel: 'sms', destination: '+919494111161', test: true },
      report
    )
  ).resolves.toEqual({ status: 'sent', provider: 'sms', reference: 'sms-provider-id' });
  expect(mockSendSms.mock.calls.at(-1)).toEqual([
    'outlet',
    '+919494111161',
    expect.stringContaining('Sales are 10.'),
    { purpose: 'Report test' },
  ]);
});

test('SMS report failure does not claim successful delivery', async () => {
  mockSendSms.mockResolvedValueOnce({ ok: false, error: 'SMS is not configured for this branch' });
  await expect(runner.deliver({ ...schedule, channel: 'sms' }, report)).rejects.toThrow(
    'SMS is not configured'
  );
});

test.each(['sms', 'whatsapp', 'email'])(
  '%s does not submit a report when document preparation fails',
  async (channel) => {
    mockSendSms.mockClear();
    mockSendWhatsapp.mockClear();
    mockSendMail.mockClear();
    require('../../../src/services/report-document.service').prepare.mockRejectedValueOnce(
      new Error('Report document storage unavailable')
    );
    await expect(runner.deliver({ ...schedule, channel }, report)).rejects.toThrow(
      'Report document storage unavailable'
    );
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockSendWhatsapp).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  }
);
