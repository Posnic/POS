'use strict';
const mockUpload = jest.fn();
let mockBucket = 'test';
jest.mock('../../../src/utils/s3', () => ({
  s3Config: () => ({ bucket: mockBucket }),
  uploadObject: (...args) => mockUpload(...args),
}));
const documents = require('../../../src/services/report-document.service');
const schedule = { timezone: 'Asia/Kolkata', branch_id: 'branch' };
const report = {
  branch: { branch_name: 'Test shop' }, answer: 'Sales summary',
  metrics: [{ label: 'Sales', value: '₹420.00' }], source: 'Sales report',
  range: { starting_date: new Date('2026-10-19T18:30:00Z'), ending_date: new Date('2026-10-20T18:29:59.999Z') },
};
beforeEach(() => { mockBucket = 'test'; mockUpload.mockReset(); });
test('email PDF is generated without publishing financial data', async () => {
  const result = await documents.prepare(schedule, report);
  expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  expect(result.filename).toBe('posnic-summary-2026-10-20.pdf');
  expect(result.url).toBeNull();
  expect(mockUpload).not.toHaveBeenCalled();
  expect(documents.periodLabel(schedule, report)).toBe('20 Oct 2026, 00:00 to 20 Oct 2026, 23:59 (Asia/Kolkata)');
});
test('links use fresh opaque snapshot keys and PDF content metadata', async () => {
  mockUpload.mockResolvedValue({ Location: 'https://example.invalid/shared' });
  const first = await documents.prepare(schedule, report, { share: true });
  await documents.prepare(schedule, report, { share: true });
  expect(first.url).toBe('https://example.invalid/shared');
  const uploads = mockUpload.mock.calls.map(([input]) => input);
  expect(uploads[0].key).not.toBe(uploads[1].key);
  expect(uploads[0].key).toMatch(/i\/[A-Za-z0-9_-]{32}$/);
  expect(uploads[0].contentType).toBe('application/pdf');
  expect(uploads[0].contentDisposition).toContain('.pdf');
});
test('missing sharing configuration fails instead of sending a broken link', async () => {
  mockBucket = '';
  await expect(documents.prepare(schedule, report, { share: true })).rejects.toThrow('Configure document sharing');
  expect(mockUpload).not.toHaveBeenCalled();
});
