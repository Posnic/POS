jest.mock('../../../src/services/sale.service', () => ({
  getSaleForPdf: jest.fn(),
  getBranchById: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../src/utils/pdfGenerator', () => ({
  generateInvoicePDF: jest.fn(({ res }) => res.end(Buffer.from('%PDF-test'))),
}));
jest.mock('../../../src/utils/s3', () => ({
  s3Config: jest.fn(() => ({})),
  getS3Client: jest.fn(),
  publicUrlFor: jest.fn((key) => 'https://bill.example/' + key),
}));
const sales = require('../../../src/services/sale.service');
const s3 = require('../../../src/utils/s3');
const receipt = require('../../../src/services/receipt-document.service');
beforeEach(() => {
  jest.clearAllMocks();
  s3.s3Config.mockReturnValue({});
  sales.getSaleForPdf.mockResolvedValue({ _id: 'sale', branch_id: 'outlet', sales_id: 'INV/1' });
});
test('rejects another outlet before generating or publishing a PDF', async () => {
  await expect(receipt.prepare('sale', 'other')).rejects.toThrow('not found');
  expect(sales.getBranchById).not.toHaveBeenCalled();
});
test('local sender gets PDF bytes even without cloud sharing configured', async () => {
  const doc = await receipt.prepare('sale', 'outlet');
  expect(doc.buffer.toString()).toBe('%PDF-test');
  expect(doc.filename).toBe('invoice-INV_1.pdf');
  expect(doc.url).toBeNull();
});
test('publishes a fresh PDF snapshot instead of reusing a stale invoice link', async () => {
  sales.getSaleForPdf.mockResolvedValue({
    branch_id: 'outlet',
    sales_id: 'INV1',
    invoice_key: 'old',
  });
  s3.s3Config.mockReturnValue({ bucket: 'test' });
  const send = jest.fn().mockResolvedValue({});
  s3.getS3Client.mockReturnValue({ send });
  const doc = await receipt.prepare('sale', 'outlet');
  expect(send.mock.calls[0][0].input.ContentType).toBe('application/pdf');
  expect(send.mock.calls[0][0].input.Key).not.toBe('old');
  expect(doc.url).toMatch(/^https:\/\/bill.example\//);
});
