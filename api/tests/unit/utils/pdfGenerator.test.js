'use strict';

const mockDoc = () => {
  const doc = {
    page: { width: 595, height: 842 },
    bufferedPageRange: jest.fn().mockReturnValue({ count: 1 }),
    pipe: jest.fn(),
    end: jest.fn(),
    addPage: jest.fn().mockReturnThis(),
    save: jest.fn().mockReturnThis(),
    restore: jest.fn().mockReturnThis(),
    font: jest.fn().mockReturnThis(),
    fontSize: jest.fn().mockReturnThis(),
    fillColor: jest.fn().mockReturnThis(),
    opacity: jest.fn().mockReturnThis(),
    rotate: jest.fn().mockReturnThis(),
    text: jest.fn().mockReturnThis(),
    rect: jest.fn().mockReturnThis(),
    roundedRect: jest.fn().mockReturnThis(),
    fillAndStroke: jest.fn().mockReturnThis(),
    moveTo: jest.fn().mockReturnThis(),
    lineTo: jest.fn().mockReturnThis(),
    stroke: jest.fn().mockReturnThis(),
    image: jest.fn().mockReturnThis(),
    lineWidth: jest.fn().mockReturnThis(),
    widthOfString: jest.fn().mockReturnValue(30),
    heightOfString: jest.fn().mockReturnValue(12),
  };
  /* doc.y is read and assigned by the flowing layout */
  doc.y = 46;
  return doc;
};

jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => mockDoc());
});

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

const PDFDocument = require('pdfkit');
const { generateInvoicePDF, generateReceivingPDF } = require('../../../src/utils/pdfGenerator');

describe('pdfGenerator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('generateInvoicePDF writes headers, items and ends the document', () => {
    const res = {
      setHeader: jest.fn(),
    };
    const data = {
      sales_id: 'SID001',
      date: '2025-01-01T10:00:00.000Z',
      customer: { customer_name: 'John Doe' },
      items: [
        {
          item_name: 'Item A',
          item_quantity: 2,
          item_price: 50,
          total_amount: 100,
        },
      ],
      items_subtotal: 100,
      items_total: 100,
      payment_mode: 'Cash',
      payment_status: 'Paid',
    };
    const branch = {
      branch_name: 'Main Store',
      currency_type: '$',
      store_address: 'Street 1',
      store_email: 'store@test.com',
      store_telephone: '1234567890',
      logo: 'store.png',
      posnic_logo: 'posnic.png',
    };

    generateInvoicePDF({ data, branch, res });

    expect(PDFDocument).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('SID001_01_01_2025.pdf')
    );
    const doc = PDFDocument.mock.results[0].value;
    expect(doc.pipe).toHaveBeenCalledWith(res);
    /* the q-sheet redesign: letterhead name flows at the top-left margin */
    expect(doc.text).toHaveBeenCalledWith('Main Store', 50, expect.any(Number), expect.any(Object));
    /* no GSTIN on this branch, so the sheet titles itself a receipt */
    expect(doc.text).toHaveBeenCalledWith(
      'SALES RECEIPT',
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ align: 'right' })
    );
    expect(doc.text).toHaveBeenCalledWith(
      'Item A',
      expect.any(Number),
      expect.any(Number),
      expect.any(Object)
    );
    expect(doc.end).toHaveBeenCalled();
  });

  test('generateReceivingPDF writes headers and ends the document', () => {
    const res = {
      setHeader: jest.fn(),
    };
    const data = {
      receiving_id: 'RID001',
      date: '2025-01-01T10:00:00.000Z',
      supplier: { supplier_name: 'Supplier A' },
      items: [
        {
          item_name: 'Item B',
          item_quantity: 3,
          item_price: 25,
          total_amount: 75,
        },
      ],
      subtotal: 75,
      tax: 0,
      items_total: 75,
      payment_mode: 'Cash',
    };
    const branch = {
      branch_name: 'Main Store',
      currency_type: '$',
      store_address: 'Street 1',
      store_email: 'store@test.com',
      store_telephone: '1234567890',
      logo: 'store.png',
      posnic_logo: 'posnic.png',
    };

    generateReceivingPDF({ data, branch, res });

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('RID001_01_01_2025.pdf')
    );
    const doc = PDFDocument.mock.results[0].value;
    expect(doc.pipe).toHaveBeenCalledWith(res);
    expect(doc.text).toHaveBeenCalledWith('Main Store', 50, 40);
    expect(doc.end).toHaveBeenCalled();
  });
});
