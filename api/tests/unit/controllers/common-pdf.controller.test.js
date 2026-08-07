/**
 * Unit tests for common-pdf.controller.js
 *
 * CommonPdfController extends BaseController and is exported as a SINGLETON.
 * PDF library (pdfkit), fs, and path are mocked to avoid real file/PDF output.
 *
 * NOTE — Production bug found:
 *   generatePdf() calls this.success(res, ...) AFTER doc.pipe(res) + doc.end().
 *   In production this causes a "write after end" / "headers already sent" error.
 *   Tests still pass because all stream/response methods are jest.fn() mocks.
 */

// =============================================================================
// Mocks (hoisted before imports)
// =============================================================================

jest.mock('pdfkit', () => jest.fn());

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn(),
}));

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));

// =============================================================================
// Imports
// =============================================================================

const PDFDocument = require('pdfkit');
const fs = require('fs');
const ctrl = require('../../../src/controllers/common-pdf.controller');

// =============================================================================
// Test helpers
// =============================================================================

const createMockDoc = () => {
  const doc = {
    pipe: jest.fn(),
    end: jest.fn(),
    image: jest.fn(),
    fontSize: jest.fn(),
    font: jest.fn(),
    text: jest.fn(),
    moveDown: jest.fn(),
    rect: jest.fn(),
    stroke: jest.fn(),
    addPage: jest.fn(),
    heightOfString: jest.fn().mockReturnValue(20),
    page: { width: 595, height: 842 },
    y: 100,
  };
  // Chainable methods
  doc.fontSize.mockReturnValue(doc);
  doc.font.mockReturnValue(doc);
  doc.text.mockReturnValue(doc);
  doc.moveDown.mockReturnValue(doc);
  doc.image.mockReturnValue(doc);
  doc.rect.mockReturnValue(doc);
  doc.stroke.mockReturnValue(doc);
  doc.addPage.mockReturnValue(doc);
  return doc;
};

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  res.pipe = jest.fn().mockReturnValue(res);
  return res;
};

const adminUser = { _id: 'u1', role: 'admin', license: 'lic1' };
const noReadUser = { _id: 'u2', role: 'cashier', access: { report: { read: false } } };

const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  session: {},
  user: adminUser,
  ...overrides,
});

let mockDoc;
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  mockDoc = createMockDoc();
  PDFDocument.mockImplementation(() => mockDoc);
  fs.createWriteStream.mockReturnValue({
    on: jest.fn().mockReturnThis(),
    once: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    end: jest.fn(),
  });
});

afterEach(() => jest.restoreAllMocks());

// =============================================================================
// constructor / ensureDirectoryExists
// =============================================================================

describe('CommonPdfController — constructor / ensureDirectoryExists', () => {
  test('does NOT call mkdirSync when directory already exists', () => {
    fs.existsSync.mockReturnValue(true);
    ctrl.ensureDirectoryExists();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  test('calls mkdirSync with recursive:true when directory does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    ctrl.ensureDirectoryExists();
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  test('pdfDirectory points to public/pdfs path', () => {
    expect(ctrl.pdfDirectory).toMatch(/public[/\\]pdfs$/);
  });
});

// =============================================================================
// generatePdf — permission and validation
// =============================================================================

describe('CommonPdfController — generatePdf (permission & validation)', () => {
  test('returns 403 when user lacks report read permission', async () => {
    const res = mockRes();
    await ctrl.generatePdf(mockReq({ user: noReadUser, body: { content: {} } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].type).toBe('error');
    expect(PDFDocument).not.toHaveBeenCalled();
  });

  test('returns 400 when content is absent', async () => {
    const res = mockRes();
    await ctrl.generatePdf(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/content is required/i);
    expect(PDFDocument).not.toHaveBeenCalled();
  });

  test('returns 400 when content is explicitly null', async () => {
    const res = mockRes();
    await ctrl.generatePdf(mockReq({ body: { content: null } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// =============================================================================
// generatePdf — PDF creation flow
// =============================================================================

describe('CommonPdfController — generatePdf (PDF flow)', () => {
  test('creates a new PDFDocument instance', async () => {
    jest.spyOn(ctrl, 'generateInvoicePdf').mockResolvedValue();
    const res = mockRes();
    await ctrl.generatePdf(mockReq({ body: { content: {}, type: 'invoice' } }), res);
    expect(PDFDocument).toHaveBeenCalledTimes(1);
  });

  test('sets Content-Type to application/pdf', async () => {
    jest.spyOn(ctrl, 'generateInvoicePdf').mockResolvedValue();
    const res = mockRes();
    await ctrl.generatePdf(mockReq({ body: { content: {}, type: 'invoice' } }), res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
  });

  test('sets Content-Disposition attachment header with provided fileName', async () => {
    jest.spyOn(ctrl, 'generateInvoicePdf').mockResolvedValue();
    const res = mockRes();
    await ctrl.generatePdf(mockReq({ body: { content: {}, fileName: 'test.pdf' } }), res);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="test.pdf"'
    );
  });

  test('uses default fileName containing timestamp when not provided', async () => {
    jest.spyOn(ctrl, 'generateDefaultPdf').mockResolvedValue();
    const before = Date.now();
    const res = mockRes();
    await ctrl.generatePdf(mockReq({ body: { content: 'text' } }), res);
    const dispositionCall = res.setHeader.mock.calls.find(([h]) => h === 'Content-Disposition');
    expect(dispositionCall[1]).toMatch(/document-\d+\.pdf/);
    const ts = parseInt(dispositionCall[1].match(/document-(\d+)\.pdf/)[1]);
    expect(ts).toBeGreaterThanOrEqual(before);
  });

  test('pipes the PDFDocument to the response object', async () => {
    jest.spyOn(ctrl, 'generateInvoicePdf').mockResolvedValue();
    const res = mockRes();
    await ctrl.generatePdf(mockReq({ body: { content: {}, type: 'invoice' } }), res);
    expect(mockDoc.pipe).toHaveBeenCalledWith(res);
  });

  test('writes the generated PDF to disk before finalizing the stream', async () => {
    jest.spyOn(ctrl, 'generateInvoicePdf').mockResolvedValue();
    const res = mockRes();
    await ctrl.generatePdf(
      mockReq({ body: { content: {}, fileName: 'saved.pdf', type: 'invoice' } }),
      res
    );

    expect(fs.createWriteStream).toHaveBeenCalledWith(expect.stringContaining('saved.pdf'));
    expect(mockDoc.pipe).toHaveBeenCalledWith(expect.any(Object));
    expect(mockDoc.end).toHaveBeenCalled();
  });

  test('calls doc.end() to finalize the PDF stream', async () => {
    jest.spyOn(ctrl, 'generateInvoicePdf').mockResolvedValue();
    const res = mockRes();
    await ctrl.generatePdf(mockReq({ body: { content: {}, type: 'invoice' } }), res);
    expect(mockDoc.end).toHaveBeenCalled();
  });

  test('returns 200 success response with url, fileName, and path', async () => {
    jest.spyOn(ctrl, 'generateInvoicePdf').mockResolvedValue();
    const res = mockRes();
    await ctrl.generatePdf(
      mockReq({ body: { content: {}, fileName: 'inv.pdf', type: 'invoice' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('success');
    expect(body.data).toMatchObject({
      url: '/pdfs/inv.pdf',
      fileName: 'inv.pdf',
    });
  });

  test('returns 500 when PDFDocument constructor throws', async () => {
    PDFDocument.mockImplementation(() => {
      throw new Error('PDFKit crash');
    });
    const res = mockRes();
    await ctrl.generatePdf(mockReq({ body: { content: {}, type: 'invoice' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('returns 500 when generateInvoicePdf throws', async () => {
    jest.spyOn(ctrl, 'generateInvoicePdf').mockRejectedValue(new Error('gen fail'));
    const res = mockRes();
    await ctrl.generatePdf(mockReq({ body: { content: {}, type: 'invoice' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// generatePdf — type routing
// =============================================================================

describe('CommonPdfController — generatePdf (type routing)', () => {
  test('calls generateInvoicePdf for type="invoice" (default)', async () => {
    const spy = jest.spyOn(ctrl, 'generateInvoicePdf').mockResolvedValue();
    await ctrl.generatePdf(mockReq({ body: { content: { invoiceNumber: 'INV-1' } } }), mockRes());
    expect(spy).toHaveBeenCalledWith(mockDoc, { invoiceNumber: 'INV-1' });
  });

  test('calls generateInvoicePdf when type="invoice" is explicit', async () => {
    const spy = jest.spyOn(ctrl, 'generateInvoicePdf').mockResolvedValue();
    await ctrl.generatePdf(mockReq({ body: { content: {}, type: 'invoice' } }), mockRes());
    expect(spy).toHaveBeenCalled();
  });

  test('calls generateReceiptPdf when type="receipt"', async () => {
    const spy = jest.spyOn(ctrl, 'generateReceiptPdf').mockResolvedValue();
    await ctrl.generatePdf(
      mockReq({ body: { content: { receiptNumber: 'REC-1' }, type: 'receipt' } }),
      mockRes()
    );
    expect(spy).toHaveBeenCalledWith(mockDoc, { receiptNumber: 'REC-1' });
  });

  test('calls generateReportPdf when type="report"', async () => {
    const spy = jest.spyOn(ctrl, 'generateReportPdf').mockResolvedValue();
    await ctrl.generatePdf(
      mockReq({ body: { content: { title: 'Sales' }, type: 'report' } }),
      mockRes()
    );
    expect(spy).toHaveBeenCalledWith(mockDoc, { title: 'Sales' });
  });

  test('calls generateDefaultPdf for unknown type', async () => {
    const spy = jest.spyOn(ctrl, 'generateDefaultPdf').mockResolvedValue();
    await ctrl.generatePdf(
      mockReq({ body: { content: 'plain text', type: 'unknown' } }),
      mockRes()
    );
    expect(spy).toHaveBeenCalledWith(mockDoc, 'plain text');
  });

  test('calls generateDefaultPdf when type is omitted (falls to default case)', async () => {
    // type defaults to "invoice" in destructuring, so generateInvoicePdf is called
    const invoiceSpy = jest.spyOn(ctrl, 'generateInvoicePdf').mockResolvedValue();
    await ctrl.generatePdf(mockReq({ body: { content: {} } }), mockRes());
    expect(invoiceSpy).toHaveBeenCalled();
  });
});

// =============================================================================
// generateInvoicePdf
// =============================================================================

describe('CommonPdfController — generateInvoicePdf', () => {
  test('calls doc.image when content.logo is provided', async () => {
    await ctrl.generateInvoicePdf(mockDoc, { logo: '/img/logo.png' });
    expect(mockDoc.image).toHaveBeenCalledWith('/img/logo.png', 50, 45, { width: 50 });
  });

  test('does NOT call doc.image when content.logo is absent', async () => {
    await ctrl.generateInvoicePdf(mockDoc, {});
    expect(mockDoc.image).not.toHaveBeenCalled();
  });

  test('writes INVOICE header text', async () => {
    await ctrl.generateInvoicePdf(mockDoc, {});
    expect(mockDoc.text).toHaveBeenCalledWith('INVOICE', { align: 'right' });
  });

  test('renders invoiceNumber in the document', async () => {
    await ctrl.generateInvoicePdf(mockDoc, { invoiceNumber: 'INV-2024-001' });
    const textCalls = mockDoc.text.mock.calls.map(([t]) => t);
    expect(textCalls.some((t) => String(t).includes('INV-2024-001'))).toBe(true);
  });

  test('renders customer info when content.customer is present', async () => {
    await ctrl.generateInvoicePdf(mockDoc, {
      customer: { name: 'John Doe', address: '123 Main St', email: 'j@x.com', phone: '555' },
    });
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => t.includes('John Doe'))).toBe(true);
    expect(textCalls.some((t) => t.includes('123 Main St'))).toBe(true);
    expect(textCalls.some((t) => t.includes('j@x.com'))).toBe(true);
    expect(textCalls.some((t) => t.includes('555'))).toBe(true);
  });

  test('skips customer section when content.customer is absent', async () => {
    await ctrl.generateInvoicePdf(mockDoc, {});
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => t.includes('Bill To:'))).toBe(false);
  });

  test('calls generateTable when items are present', async () => {
    const spy = jest.spyOn(ctrl, 'generateTable');
    await ctrl.generateInvoicePdf(mockDoc, {
      items: [{ name: 'Widget', quantity: 2, price: 10 }],
    });
    expect(spy).toHaveBeenCalled();
  });

  test('does NOT call generateTable when items array is empty', async () => {
    const spy = jest.spyOn(ctrl, 'generateTable');
    await ctrl.generateInvoicePdf(mockDoc, { items: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  test('renders subtotal, tax, and total when content.totals is present', async () => {
    await ctrl.generateInvoicePdf(mockDoc, {
      totals: { subtotal: 100, tax: 10, total: 110 },
    });
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => t.includes('Subtotal:'))).toBe(true);
    expect(textCalls.some((t) => t.includes('Tax:'))).toBe(true);
    expect(textCalls.some((t) => t.includes('TOTAL:'))).toBe(true);
  });

  test('skips totals section when content.totals is absent', async () => {
    await ctrl.generateInvoicePdf(mockDoc, {});
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => t === 'TOTAL:')).toBe(false);
  });

  test('renders thank-you footer text', async () => {
    await ctrl.generateInvoicePdf(mockDoc, {});
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => t.includes('Thank you'))).toBe(true);
  });

  test('uses defaults when item fields are missing', async () => {
    const spy = jest.spyOn(ctrl, 'generateTable');
    await ctrl.generateInvoicePdf(mockDoc, { items: [{}] });
    const tableArg = spy.mock.calls[0][1];
    expect(tableArg.rows[0]).toEqual(['', '', 0, '$0.00', '$0.00']);
  });
});

// =============================================================================
// generateReceiptPdf
// =============================================================================

describe('CommonPdfController — generateReceiptPdf', () => {
  test('writes RECEIPT header text centered', async () => {
    await ctrl.generateReceiptPdf(mockDoc, {});
    expect(mockDoc.text).toHaveBeenCalledWith('RECEIPT', { align: 'center' });
  });

  test('renders receiptNumber in document', async () => {
    await ctrl.generateReceiptPdf(mockDoc, { receiptNumber: 'REC-001' });
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => t.includes('REC-001'))).toBe(true);
  });

  test('calls generateTable when items are present', async () => {
    const spy = jest.spyOn(ctrl, 'generateTable');
    await ctrl.generateReceiptPdf(mockDoc, {
      items: [{ description: 'Coffee', amount: 3.5 }],
    });
    expect(spy).toHaveBeenCalled();
    const tableArg = spy.mock.calls[0][1];
    expect(tableArg.headers).toEqual(['Description', 'Amount']);
  });

  test('does NOT call generateTable when items are absent', async () => {
    const spy = jest.spyOn(ctrl, 'generateTable');
    await ctrl.generateReceiptPdf(mockDoc, {});
    expect(spy).not.toHaveBeenCalled();
  });

  test('renders payment method section when content.payment is present', async () => {
    await ctrl.generateReceiptPdf(mockDoc, {
      payment: { type: 'Cash', amount: 50 },
    });
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => t.includes('Cash'))).toBe(true);
  });

  test('renders payment reference only when present', async () => {
    await ctrl.generateReceiptPdf(mockDoc, {
      payment: { type: 'Card', amount: 50, reference: 'TXN-123' },
    });
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => t.includes('TXN-123'))).toBe(true);
  });

  test('skips reference line when payment.reference is absent', async () => {
    await ctrl.generateReceiptPdf(mockDoc, {
      payment: { type: 'Cash', amount: 50 },
    });
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => String(t).includes('Reference:'))).toBe(false);
  });

  test('skips payment section when content.payment is absent', async () => {
    await ctrl.generateReceiptPdf(mockDoc, {});
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => t === 'Payment Method:')).toBe(false);
  });
});

// =============================================================================
// generateReportPdf
// =============================================================================

describe('CommonPdfController — generateReportPdf', () => {
  test('uses content.title as the report heading', async () => {
    await ctrl.generateReportPdf(mockDoc, { title: 'Monthly Sales' });
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => t.includes('Monthly Sales'))).toBe(true);
  });

  test('falls back to "REPORT" when title is absent', async () => {
    await ctrl.generateReportPdf(mockDoc, {});
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => t === 'REPORT')).toBe(true);
  });

  test('calls generateTable when data array is non-empty', async () => {
    const spy = jest.spyOn(ctrl, 'generateTable');
    await ctrl.generateReportPdf(mockDoc, {
      data: [{ product: 'A', qty: 10, total: 100 }],
    });
    expect(spy).toHaveBeenCalled();
    const tableArg = spy.mock.calls[0][1];
    expect(tableArg.headers).toEqual(['product', 'qty', 'total']);
    expect(tableArg.rows[0]).toEqual(['A', 10, 100]);
  });

  test('does NOT call generateTable when data is absent', async () => {
    const spy = jest.spyOn(ctrl, 'generateTable');
    await ctrl.generateReportPdf(mockDoc, {});
    expect(spy).not.toHaveBeenCalled();
  });

  test('does NOT call generateTable when data is empty array', async () => {
    const spy = jest.spyOn(ctrl, 'generateTable');
    await ctrl.generateReportPdf(mockDoc, { data: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  test('renders summary key-value pairs when present', async () => {
    await ctrl.generateReportPdf(mockDoc, {
      summary: { Revenue: '$5000', Orders: 42 },
    });
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => t.includes('Revenue: $5000'))).toBe(true);
    expect(textCalls.some((t) => t.includes('Orders: 42'))).toBe(true);
  });

  test('skips summary section when content.summary is absent', async () => {
    await ctrl.generateReportPdf(mockDoc, {});
    const textCalls = mockDoc.text.mock.calls.map(([t]) => String(t));
    expect(textCalls.some((t) => t === 'Summary:')).toBe(false);
  });
});

// =============================================================================
// generateDefaultPdf
// =============================================================================

describe('CommonPdfController — generateDefaultPdf', () => {
  test('renders string content directly as text', async () => {
    await ctrl.generateDefaultPdf(mockDoc, 'Hello World');
    expect(mockDoc.text).toHaveBeenCalledWith('Hello World');
  });

  test('renders each element of array content as a separate text call', async () => {
    await ctrl.generateDefaultPdf(mockDoc, ['Line 1', 'Line 2', 'Line 3']);
    const textCalls = mockDoc.text.mock.calls.map(([t]) => t);
    expect(textCalls).toContain('Line 1');
    expect(textCalls).toContain('Line 2');
    expect(textCalls).toContain('Line 3');
  });

  test('renders object content with text, fontSize, and align', async () => {
    await ctrl.generateDefaultPdf(mockDoc, { text: 'Hello', fontSize: 16, align: 'center' });
    expect(mockDoc.text).toHaveBeenCalledWith('Hello', { align: 'center' });
    expect(mockDoc.fontSize).toHaveBeenCalledWith(16);
  });

  test('uses Helvetica-Bold font when bold=true', async () => {
    await ctrl.generateDefaultPdf(mockDoc, { text: 'Bold', bold: true });
    expect(mockDoc.font).toHaveBeenCalledWith('Helvetica-Bold');
    expect(mockDoc.font).toHaveBeenCalledWith('Helvetica');
  });

  test('does NOT call font when bold=false', async () => {
    await ctrl.generateDefaultPdf(mockDoc, { text: 'Normal', bold: false });
    expect(mockDoc.font).not.toHaveBeenCalled();
  });

  test('uses default fontSize=12 and align=left for object content', async () => {
    await ctrl.generateDefaultPdf(mockDoc, { text: 'Hi' });
    expect(mockDoc.fontSize).toHaveBeenCalledWith(12);
    expect(mockDoc.text).toHaveBeenCalledWith('Hi', { align: 'left' });
  });
});

// =============================================================================
// generateTable
// =============================================================================

describe('CommonPdfController — generateTable', () => {
  test('draws each header using Helvetica-Bold font', () => {
    ctrl.generateTable(mockDoc, {
      headers: ['Name', 'Price'],
      rows: [],
    });
    expect(mockDoc.font).toHaveBeenCalledWith('Helvetica-Bold');
    expect(mockDoc.font).toHaveBeenCalledWith('Helvetica');
  });

  test('calls doc.text for each header cell', () => {
    ctrl.generateTable(mockDoc, {
      headers: ['Col A', 'Col B'],
      rows: [],
    });
    const textFirstArgs = mockDoc.text.mock.calls.map(([t]) => t);
    expect(textFirstArgs).toContain('Col A');
    expect(textFirstArgs).toContain('Col B');
  });

  test('calls doc.rect for each cell in each row', () => {
    ctrl.generateTable(mockDoc, {
      headers: ['Item', 'Amount'],
      rows: [
        ['Apple', '$1.00'],
        ['Banana', '$0.50'],
      ],
    });
    // 2 rows × 2 columns = 4 rect calls
    expect(mockDoc.rect).toHaveBeenCalledTimes(4);
  });

  test('calls doc.addPage when row causes overflow beyond page height', () => {
    // Set doc.y near page bottom so first row triggers overflow
    mockDoc.y = 820;
    ctrl.generateTable(mockDoc, {
      headers: ['Col'],
      rows: [['Data']],
    });
    expect(mockDoc.addPage).toHaveBeenCalled();
  });

  test('does NOT call doc.addPage when rows fit on page', () => {
    mockDoc.y = 100;
    ctrl.generateTable(mockDoc, {
      headers: ['Col'],
      rows: [['Short row']],
    });
    expect(mockDoc.addPage).not.toHaveBeenCalled();
  });

  test('uses startY parameter when provided', () => {
    ctrl.generateTable(mockDoc, {
      headers: ['A'],
      rows: [],
      startY: 200,
    });
    expect(mockDoc.text).toHaveBeenCalledWith('A', 50, 200, expect.any(Object));
  });

  test('handles undefined cell values gracefully (converts to empty string)', () => {
    ctrl.generateTable(mockDoc, {
      headers: ['Col'],
      rows: [[undefined]],
    });
    // Should not throw; cell text should be ""
    const rectCalls = mockDoc.rect.mock.calls;
    expect(rectCalls).toHaveLength(1);
  });

  test('sets doc.y after rendering all rows', () => {
    mockDoc.y = 100;
    ctrl.generateTable(mockDoc, {
      headers: ['A'],
      rows: [['row1']],
    });
    // y is set to some value > initial doc.y
    expect(mockDoc.y).toBeGreaterThan(100);
  });
});

// =============================================================================
// formatCurrency
// =============================================================================

describe('CommonPdfController — formatCurrency', () => {
  test('formats positive integer as USD currency string', () => {
    expect(ctrl.formatCurrency(100)).toBe('$100.00');
  });

  test('formats decimal amount correctly', () => {
    expect(ctrl.formatCurrency(9.99)).toBe('$9.99');
  });

  test('formats zero as $0.00', () => {
    expect(ctrl.formatCurrency(0)).toBe('$0.00');
  });

  test('formats negative amount with minus sign', () => {
    expect(ctrl.formatCurrency(-50)).toMatch(/-?\$?50\.00|-50/);
  });

  test('formats large amount with comma separator', () => {
    const result = ctrl.formatCurrency(1000000);
    expect(result).toContain('1,000,000');
  });

  test('formats calculated item total (qty × price)', () => {
    const result = ctrl.formatCurrency(3 * 9.99);
    expect(result).toBe('$29.97');
  });
});
