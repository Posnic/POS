const BaseController = require('./base.controller');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class CommonPdfController extends BaseController {
  constructor() {
    super();
    this.pdfDirectory = path.join(__dirname, '../../public/pdfs');
    this.ensureDirectoryExists();
  }

  ensureDirectoryExists() {
    if (!fs.existsSync(this.pdfDirectory)) {
      fs.mkdirSync(this.pdfDirectory, { recursive: true });
    }
  }

  /**
   * Generate PDF document
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async generatePdf(req, res) {
    try {
      if (!this.checkPermission('report', 'read', req.user)) {
        return this.error(res, 'You do not have permission to generate PDFs', 403);
      }

      const { content, type = 'invoice', fileName = `document-${Date.now()}.pdf` } = req.body;

      if (!content) {
        return this.error(res, 'Content is required for PDF generation', 400);
      }

      // Create a new PDF document
      const doc = new PDFDocument();
      const safeFileName = path.basename(fileName);
      const filePath = path.join(this.pdfDirectory, safeFileName);
      const fileStream = fs.createWriteStream(filePath);

      // Set response headers
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);

      // Pipe the PDF to both the response and a file stream so it is saved
      // on disk as well as downloaded by the client.
      doc.pipe(fileStream);
      doc.pipe(res);

      // Add content to PDF based on type
      switch (type) {
        case 'invoice':
          await this.generateInvoicePdf(doc, content);
          break;
        case 'receipt':
          await this.generateReceiptPdf(doc, content);
          break;
        case 'report':
          await this.generateReportPdf(doc, content);
          break;
        default:
          await this.generateDefaultPdf(doc, content);
      }

      fileStream.on('error', (error) => {
        console.error('Error writing PDF to disk:', error);
        if (!res.headersSent) {
          res.setHeader('X-PDF-Write-Error', 'true');
        }
      });

      // Finalize the PDF stream. The document is written to both the client
      // response and the persisted file on disk.
      doc.end();

      return res;
    } catch (error) {
      console.error('Error generating PDF:', error);
      this.error(res, 'Failed to generate PDF: ' + error.message, 500);
    }
  }

  /**
   * Generate invoice PDF
   * @private
   */
  async generateInvoicePdf(doc, content) {
    // Add logo if available
    if (content.logo) {
      doc.image(content.logo, 50, 45, { width: 50 });
    }

    // Add header
    doc.fontSize(20).text('INVOICE', { align: 'right' });
    doc.moveDown();

    // Add invoice details
    doc.fontSize(12);
    doc.text(`Invoice #: ${content.invoiceNumber || ''}`, { align: 'left' });
    doc.text(`Date: ${content.date || new Date().toLocaleDateString()}`, {
      align: 'left',
    });
    doc.moveDown();

    // Add customer information
    if (content.customer) {
      doc.fontSize(14).text('Bill To:', { underline: true });
      doc.fontSize(12);
      doc.text(content.customer.name || '');
      if (content.customer.address) doc.text(content.customer.address);
      if (content.customer.email) doc.text(`Email: ${content.customer.email}`);
      if (content.customer.phone) doc.text(`Phone: ${content.customer.phone}`);
      doc.moveDown();
    }

    // Add items table
    if (content.items && content.items.length > 0) {
      this.generateTable(doc, {
        headers: ['Item', 'Description', 'Quantity', 'Price', 'Total'],
        rows: content.items.map((item) => [
          item.name || '',
          item.description || '',
          item.quantity || 0,
          this.formatCurrency(item.price || 0),
          this.formatCurrency((item.quantity || 0) * (item.price || 0)),
        ]),
      });
    }

    // Add totals
    if (content.totals) {
      const startY = doc.y + 20;
      const startX = 350;

      doc.fontSize(12);

      // Subtotal
      doc.text('Subtotal:', startX, startY, { width: 100, align: 'right' });
      doc.text(this.formatCurrency(content.totals.subtotal || 0), startX + 100, startY);

      // Tax
      doc.text('Tax:', startX, startY + 25, { width: 100, align: 'right' });
      doc.text(this.formatCurrency(content.totals.tax || 0), startX + 100, startY + 25);

      // Total
      doc.font('Helvetica-Bold');
      doc.text('TOTAL:', startX, startY + 50, { width: 100, align: 'right' });
      doc.text(this.formatCurrency(content.totals.total || 0), startX + 100, startY + 50);
      doc.font('Helvetica');
    }

    // Add footer
    doc.fontSize(10).text('Thank you for your business!', 50, 750, { align: 'center' });
  }

  /**
   * Generate receipt PDF
   * @private
   */
  async generateReceiptPdf(doc, content) {
    // Similar structure to invoice but with receipt-specific formatting
    doc.fontSize(20).text('RECEIPT', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12);
    doc.text(`Receipt #: ${content.receiptNumber || ''}`, { align: 'left' });
    doc.text(`Date: ${content.date || new Date().toLocaleDateString()}`, {
      align: 'left',
    });
    doc.moveDown();

    // Add receipt items
    if (content.items && content.items.length > 0) {
      this.generateTable(doc, {
        headers: ['Description', 'Amount'],
        rows: content.items.map((item) => [
          item.description || '',
          this.formatCurrency(item.amount || 0),
        ]),
      });
    }

    // Add payment information
    if (content.payment) {
      doc.moveDown();
      doc.text('Payment Method:', { underline: true });
      doc.text(`Type: ${content.payment.type || ''}`);
      doc.text(`Amount: ${this.formatCurrency(content.payment.amount || 0)}`);
      if (content.payment.reference) {
        doc.text(`Reference: ${content.payment.reference}`);
      }
    }
  }

  /**
   * Generate report PDF
   * @private
   */
  async generateReportPdf(doc, content) {
    doc.fontSize(16).text(content.title || 'REPORT', { align: 'center' });
    doc.moveDown();

    doc.fontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, {
      align: 'right',
    });
    doc.moveDown();

    // Add report data
    if (content.data && content.data.length > 0) {
      const headers = Object.keys(content.data[0]);
      const rows = content.data.map((item) => Object.values(item));

      this.generateTable(doc, {
        headers: headers,
        rows: rows,
      });
    }

    // Add summary if available
    if (content.summary) {
      doc.moveDown();
      doc.fontSize(12).text('Summary:', { underline: true });
      for (const [key, value] of Object.entries(content.summary)) {
        doc.text(`${key}: ${value}`);
      }
    }
  }

  /**
   * Generate default PDF
   * @private
   */
  async generateDefaultPdf(doc, content) {
    if (typeof content === 'string') {
      // Simple text content
      doc.fontSize(12).text(content);
    } else if (Array.isArray(content)) {
      // Array of text lines
      content.forEach((line) => doc.text(line));
    } else if (typeof content === 'object') {
      // Object with content and styles
      const { text, fontSize = 12, align = 'left', bold = false } = content;
      if (bold) doc.font('Helvetica-Bold');
      doc.fontSize(fontSize).text(text, { align });
      if (bold) doc.font('Helvetica');
    }
  }

  /**
   * Generate a table in the PDF
   * @private
   */
  generateTable(doc, { headers, rows, startY = null, startX = 50, cellPadding = 5 }) {
    const tableTop = startY || doc.y;
    const cellWidth = (doc.page.width - 100) / headers.length;

    // Draw headers
    let x = startX;
    doc.font('Helvetica-Bold');
    headers.forEach((header, i) => {
      doc.text(header, x, tableTop, { width: cellWidth, align: 'left' });
      x += cellWidth;
    });
    doc.font('Helvetica');

    // Draw rows
    let y = tableTop + 20;
    rows.forEach((row) => {
      x = startX;
      let rowHeight = 0;

      // Calculate row height (for multi-line cells)
      row.forEach((cell) => {
        const text = cell !== undefined ? String(cell) : '';
        const height = doc.heightOfString(text, { width: cellWidth });
        rowHeight = Math.max(rowHeight, height);
      });

      // Draw cell borders and text
      x = startX;
      row.forEach((cell, i) => {
        const text = cell !== undefined ? String(cell) : '';
        doc.rect(x, y, cellWidth, rowHeight + cellPadding * 2).stroke();
        doc.text(text, x + cellPadding, y + cellPadding, {
          width: cellWidth - cellPadding * 2,
          align: 'left',
          height: rowHeight,
        });
        x += cellWidth;
      });

      y += rowHeight + cellPadding * 2;

      // Add new page if needed
      if (y > doc.page.height - 50) {
        doc.addPage();
        y = 50;
      }
    });

    doc.y = y + 20;
  }

  /**
   * Format currency
   * @private
   */
  formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  }
}

module.exports = new CommonPdfController();
