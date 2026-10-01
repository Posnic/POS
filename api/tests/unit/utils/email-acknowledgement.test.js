'use strict';

const mockSend = jest.fn();
jest.mock('@getbrevo/brevo', () => ({
  BrevoClient: class {
    constructor() {
      this.transactionalEmails = { sendTransacEmail: mockSend };
    }
  },
}));
const { resolveShopTransport } = require('../../../src/utils/email');
const previous = process.env.BREVO_API_KEY;
beforeAll(() => {
  process.env.BREVO_API_KEY = 'synthetic-only';
});
afterAll(() => {
  if (previous === undefined) delete process.env.BREVO_API_KEY;
  else process.env.BREVO_API_KEY = previous;
});

test('Brevo acceptance returns an actual provider ID and the submitted recipients', async () => {
  mockSend.mockResolvedValueOnce({ messageId: 'provider-acknowledgement' });
  const { transporter } = resolveShopTransport({});
  await expect(
    transporter.sendMail({
      from: 'sender@example.invalid',
      to: 'owner@example.invalid',
      subject: 'Synthetic',
      text: 'Synthetic summary',
    })
  ).resolves.toEqual({
    messageId: 'provider-acknowledgement',
    accepted: ['owner@example.invalid'],
    rejected: [],
  });
});

test('a missing Brevo ID cannot be replaced by a fabricated success reference', async () => {
  mockSend.mockResolvedValueOnce({});
  const { transporter } = resolveShopTransport({});
  await expect(
    transporter.sendMail({
      from: 'sender@example.invalid',
      to: 'owner@example.invalid',
      subject: 'Synthetic',
      text: 'Synthetic summary',
    })
  ).rejects.toThrow(/did not acknowledge/);
});

test('scheduled reports disable provider retries and bound the acknowledgement wait', async () => {
  mockSend.mockResolvedValueOnce({ messageId: 'scheduled-acknowledgement' });
  const { transporter } = resolveShopTransport({});
  await transporter.sendMail({
    from: 'sender@example.invalid',
    to: 'owner@example.invalid',
    subject: 'Synthetic',
    text: 'Synthetic summary',
    scheduledReport: true,
  });
  expect(mockSend).toHaveBeenLastCalledWith(expect.objectContaining({ subject: 'Synthetic' }), {
    maxRetries: 0,
    timeoutInSeconds: 30,
  });
});
