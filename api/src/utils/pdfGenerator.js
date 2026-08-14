const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Reuse the same DejaVuSansCondensed font that legacy PHP mPDF uses, so
// icons and watermark look identical across both systems.
const dejavuSansCondensedPath = path.join(
  __dirname,
  '../../../Api/src/vendor/mpdf/mpdf/ttfonts/DejaVuSansCondensed.ttf'
);

function registerDejaVuSansCondensed(doc) {
  if (!fs.existsSync(dejavuSansCondensedPath)) {
    console.log(
      'DejaVuSansCondensed font not found, using Helvetica fallback:',
      dejavuSansCondensedPath
    );
    return false;
  }

  try {
    doc.registerFont('DejaVuSansCondensed', dejavuSansCondensedPath);
    return true;
  } catch (err) {
    // If font loading fails we silently fall back to built-in Helvetica.
    console.log('DejaVuSansCondensed font load failed:', err.message);
    return false;
  }
}

function addWatermark(doc, text, options = {}) {
  if (!text) {
    return;
  }
  const pageWidth = doc.page && doc.page.width ? doc.page.width : 595;
  const pageHeight = doc.page && doc.page.height ? doc.page.height : 842;
  const { fontName = 'Helvetica', fontSize = 50, characterSpacing = 1.1 } = options;

  doc.save();
  // Light, diagonal watermark similar to PHP output
  doc.font(fontName);
  doc.fontSize(fontSize);
  doc.fillColor('#000000');
  doc.opacity(0.06);
  doc.rotate(-45, { origin: [pageWidth / 2, pageHeight / 2] });
  doc.text(text, -pageWidth, pageHeight / 2, {
    width: pageWidth * 3,
    align: 'center',
    characterSpacing,
  });
  doc.restore();
  doc.opacity(1);
  doc.fillColor('#000000');
}

/**
 * Generate a sales/invoice PDF with table layout
 * @param {Object} options - PDF generation options
 * @param {Object} options.data - Invoice data (sale/purchase/etc)
 * @param {Object} options.branch - Branch/store data
 * @param {Object} options.res - Express response object
 * @param {Object} options.config - PDF configuration
 * @returns {void}
 */
function generateInvoicePDF(options) {
  const { data, branch, res, config = {} } = options;

  const {
    title = 'Sales Invoice.',
    idField = 'sales_id',
    itemsField = 'items',
    customerField = 'customer',
    dateField = 'date',
    filename = 'invoice.pdf',
  } = config;

  const doc = new PDFDocument({ margin: 50 });
  const hasDejavu = registerDejaVuSansCondensed(doc);

  // Get data
  const currency = branch?.currency_type || '₹';
  const storeName = branch?.branch_name || 'Store';
  const storeAddress = branch?.store_address || '';
  const storeEmail = branch?.store_email || '';
  const storePhone = branch?.store_telephone || '';
  // Prefer GSTIN from branch document, but fall back to any branch_gstin_number
  // carried on the sale payload. This mirrors the frontend behaviour where
  // Settings and branch configuration drive GST visibility.
  const storeGstinRaw =
    typeof branch?.branch_gstin_number === 'string' && branch.branch_gstin_number.trim()
      ? branch.branch_gstin_number.trim()
      : typeof data.branch_gstin_number === 'string'
        ? data.branch_gstin_number.trim()
        : '';

  const customer = data[customerField];
  const customerName = customer?.customer_name || data.customer_name || 'Walk-in Customer';
  const customerPhone = customer?.customer_phone || data.customer_phone || '';
  const customerEmail = customer?.customer_email || data.customer_email || '';
  const customerAddress = customer?.customer_address || data.customer_address || '';

  const saleDate = data[dateField] || data.createdAt;
  let formattedDate = '';
  let filenameDatePart = '';
  if (saleDate) {
    const date = new Date(saleDate);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    const hoursStr = String(hours).padStart(2, '0');
    formattedDate = `${month}/${day}/${year} ${hoursStr}:${minutes} ${ampm}`;
    filenameDatePart = `${month}_${day}_${year}`;
  }

  // Set response headers for PDF download
  // Generate filename in format: SID000001_02_17_2026.pdf
  const salesId = data[idField] || 'invoice';
  const pdfFilename = filenameDatePart ? `${salesId}_${filenameDatePart}` : salesId;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}.pdf"`);

  // Optionally save a server-side copy. Saving is enabled when either
  // `config.saveToFile` is truthy or the environment variable
  // `PDF_SAVE_DIR` is defined. Default save location is
  // ApiV2/public/pdfs relative to this file when saving is enabled.
  const shouldSave = !!(config && config.saveToFile) || !!process.env.PDF_SAVE_DIR;
  if (shouldSave) {
    try {
      const saveDir =
        config.savePath ||
        process.env.PDF_SAVE_DIR ||
        path.join(__dirname, '..', '..', 'public', 'pdfs');
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
      const filePath = path.join(saveDir, `${pdfFilename}.pdf`);
      const fileStream = fs.createWriteStream(filePath);
      // Pipe to file as well as to response
      doc.pipe(fileStream);
      // Expose saved path on response header for debugging/verification
      try {
        res.setHeader('X-Saved-File-Path', filePath);
      } catch (e) {
        /* ignore */
      }
    } catch (err) {
      console.error('Failed to create PDF save stream:', err && err.message);
    }
  }

  // Pipe PDF to response
  doc.pipe(res);

  // Header Layout matching design

  // Store logo on top right corner. Resolve the stored branch.logo the same way
  // the receiving invoice does: a value like '/uploads/x.png' is relative to the
  // api src dir, so pass it as an absolute path (or a URL) rather than handing
  // doc.image() a bare relative string it cannot find - which silently dropped
  // tenant logos from sales invoices.
  const defaultStoreLogo = path.join(__dirname, '../img/store.png');
  let branchImage = defaultStoreLogo;
  if (branch && typeof branch.logo === 'string' && branch.logo.trim() !== '') {
    const rawLogo = branch.logo.trim();
    if (rawLogo !== 'store.png') {
      if (
        rawLogo.startsWith('http://') ||
        rawLogo.startsWith('https://') ||
        path.isAbsolute(rawLogo)
      ) {
        branchImage = rawLogo;
      } else {
        branchImage = path.join(__dirname, '..', rawLogo);
      }
    }
  }

  try {
    doc.image(branchImage, 520, 40, { width: 40, height: 40 });
  } catch (err) {
    try {
      doc.image(defaultStoreLogo, 520, 40, { width: 40, height: 40 });
    } catch (fallbackErr) {
      console.log('Branch logo failed to load:', err.message);
    }
  }

  // Store info on left side
  doc.fontSize(16).font('Helvetica-Bold').text(storeName, 50, 40);
  doc.fontSize(9).font('Helvetica').text(storeAddress, 50, doc.y);

  // Phone with icon
  if (storePhone) {
    const phoneY = doc.y;
    doc.fontSize(9);
    doc.text('☎', 50, phoneY);
    doc.text(storePhone, 65, phoneY);
  }

  // Email
  if (storeEmail) {
    const emailY = doc.y;
    doc.fontSize(9);
    doc.text('@', 50, emailY);
    doc.text(storeEmail, 65, emailY);
  }

  // GSTIN (only when configured for the branch)
  if (storeGstinRaw) {
    doc.fontSize(9).font('Helvetica').text(`GSTIN: ${storeGstinRaw}`, 50, doc.y);
  }

  // Sales Invoice title and ID (right side, below logo)
  doc.fontSize(11).font('Helvetica').text(title, 400, 90, { align: 'right' });
  doc
    .fontSize(16)
    .font('Helvetica-Bold')
    .text(`#${data[idField] || 'N/A'}`, 400, 105, { align: 'right' });

  // Date (right side, below invoice ID)
  doc.fontSize(9).font('Helvetica').text(`Date: ${formattedDate}`, 400, 130, { align: 'right' });

  // Customer Details (left side)
  doc.fontSize(11).font('Helvetica-Bold').text('Customer Details:', 50, 130);
  doc.fontSize(9).font('Helvetica');
  doc.fillColor('#8B0000'); // Dark red/maroon for customer name
  doc.text(customerName, 50, 148);
  doc.fillColor('#000000'); // Reset to black
  if (customerAddress) doc.text(customerAddress, 50, doc.y);
  if (customerPhone) doc.text(customerPhone, 50, doc.y);
  if (customerEmail) doc.text(customerEmail, 50, doc.y);

  // Set Y position for table
  doc.y = 200;

  // Items Table with borders
  const tableTop = doc.y;
  const tableLeft = 45;
  const tableWidth = 520;
  // Use slightly thinner lines to match mPDF 0.1mm borders
  doc.lineWidth(0.5);
  const col1Width = 40;
  const col2Width = 260;
  const col3Width = 60;
  const col4Width = 70;
  const col5Width = 90;

  const col1 = tableLeft;
  const col2 = col1 + col1Width;
  const col3 = col2 + col2Width;
  const col4 = col3 + col3Width;
  const col5 = col4 + col4Width;

  // Draw table header with gray background
  doc.rect(tableLeft, tableTop, tableWidth, 20).fillAndStroke('#f0f0f0', '#000000');

  // Draw vertical lines for header
  doc
    .moveTo(col2, tableTop)
    .lineTo(col2, tableTop + 20)
    .stroke();
  doc
    .moveTo(col3, tableTop)
    .lineTo(col3, tableTop + 20)
    .stroke();
  doc
    .moveTo(col4, tableTop)
    .lineTo(col4, tableTop + 20)
    .stroke();
  doc
    .moveTo(col5, tableTop)
    .lineTo(col5, tableTop + 20)
    .stroke();

  // Table Header text
  doc.fillColor('#000000');
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('S.No.', col1 + 5, tableTop + 5, { width: col1Width - 10 });
  doc.text('Description', col2 + 5, tableTop + 5, { width: col2Width - 10 });
  doc.text('Quantity', col3 + 5, tableTop + 5, { width: col3Width - 10, align: 'center' });
  doc.text('Price', col4 + 5, tableTop + 5, { width: col4Width - 10, align: 'right' });
  doc.text('Amount', col5 + 5, tableTop + 5, { width: col5Width - 10, align: 'right' });

  // Table Rows
  let y = tableTop + 20;
  const items = data[itemsField] || [];

  doc.font('Helvetica');
  items.forEach((item, index) => {
    const itemName = item.item_name || item.name || 'Item';
    const quantity = parseFloat(item.item_quantity || 0);
    const price = parseFloat(item.item_price || 0);
    const total = parseFloat(item.total_amount || 0);

    // Slightly taller row so that price, discount and tax have enough
    // breathing room inside the Price cell.
    const rowHeight = 32;

    // Draw row border
    doc.rect(tableLeft, y, tableWidth, rowHeight).stroke();

    // Draw vertical lines
    doc
      .moveTo(col2, y)
      .lineTo(col2, y + rowHeight)
      .stroke();
    doc
      .moveTo(col3, y)
      .lineTo(col3, y + rowHeight)
      .stroke();
    doc
      .moveTo(col4, y)
      .lineTo(col4, y + rowHeight)
      .stroke();
    doc
      .moveTo(col5, y)
      .lineTo(col5, y + rowHeight)
      .stroke();

    // Draw cell content
    doc.fontSize(9);
    doc.text(String(index + 1), col1 + 5, y + 7, { width: col1Width - 10 });
    doc.text(itemName, col2 + 5, y + 7, { width: col2Width - 10 });
    doc.text(`${quantity} qty`, col3 + 5, y + 7, { width: col3Width - 10, align: 'center' });

    // Calculate discount and tax display (matching PHP logic)
    let discountDisplay = '-';
    let discountSign = '-';
    if (item.item_discount > 0) {
      discountDisplay = item.item_discount;
      discountSign = currency;
    } else if (item.item_discount_percentage > 0) {
      discountDisplay = item.item_discount_percentage;
      discountSign = '%';
    }
    const discountText =
      discountSign === '%'
        ? `${discountDisplay}${discountSign}`
        : `${discountSign}${discountDisplay}`;

    let taxDisplay = '-';
    let taxSign = '-';
    if (item.tax > 0) {
      taxDisplay = item.tax;
      taxSign = '%';
    }

    const taxText = `${taxDisplay}${taxSign}`;

    // Price with discount and tax info rendered as two separate lines
    // inside the Price column, right-aligned and clearly spaced so they
    // never overlap table borders.
    doc
      .fontSize(9)
      .fillColor('#000000')
      .text(`${currency} ${price.toFixed(2)}`, col4 + 5, y + 4, {
        width: col4Width - 10,
        align: 'right',
      });

    // Discount and tax: slightly larger and darker so they remain readable
    // but still secondary to the main unit price. Stacked neatly one under
    // the other inside the Price box.
    doc
      .fontSize(8)
      .fillColor('#333333')
      .text(`Dis : ${discountText}`, col4 + 5, y + 14, { width: col4Width - 10, align: 'right' });

    doc.text(`Tax : ${taxText}`, col4 + 5, y + 22, { width: col4Width - 10, align: 'right' });

    // Reset for following cells
    doc.fontSize(9).fillColor('#000000');

    doc.text(`${currency} ${total.toFixed(2)}`, col5 + 5, y + 7, {
      width: col5Width - 10,
      align: 'right',
    });

    y += rowHeight;

    // Add new page if needed
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
  });

  // Totals section - only in Price and Amount columns
  const subtotal = parseFloat(data.items_subtotal || 0);
  const grandTotal = parseFloat(data.items_total || data.grand_total || 0);
  const totalQty = items.reduce((sum, item) => sum + parseFloat(item.item_quantity || 0), 0);

  // Extra discount amount (in currency). We prefer the computed
  // sale_extra_discount field, which already converts percentage
  // discounts into a rupee amount. Fall back to 0 when missing.
  const saleExtraDiscount = Math.abs(parseFloat(data.sale_extra_discount || 0));

  // Base row height for single-line totals rows. Some rows such as the
  // multi-payment breakdown will grow taller to avoid text wrapping into
  // neighbouring rows (which previously caused the visual "collapse" of
  // the Payment/Status fields in the PDF).
  const baseRowHeight = 20;
  const totalsStartX = col4;
  const totalsWidth = col4Width + col5Width;

  // Total Qty row
  doc.rect(totalsStartX, y, totalsWidth, baseRowHeight).stroke();
  doc
    .moveTo(col5, y)
    .lineTo(col5, y + baseRowHeight)
    .stroke();
  doc.fontSize(9).font('Helvetica');
  doc.text('Total Qty:', col4 + 5, y + 5, { width: col4Width - 10, align: 'right' });
  doc.text(String(totalQty), col5 + 5, y + 5, { width: col5Width - 10, align: 'right' });
  y += baseRowHeight;

  // Subtotal row
  doc.rect(totalsStartX, y, totalsWidth, baseRowHeight).stroke();
  doc
    .moveTo(col5, y)
    .lineTo(col5, y + baseRowHeight)
    .stroke();
  doc.text('Subtotal:', col4 + 5, y + 5, { width: col4Width - 10, align: 'right' });
  doc.text(`${currency} ${subtotal.toFixed(2)}`, col5 + 5, y + 5, {
    width: col5Width - 10,
    align: 'right',
  });
  y += baseRowHeight;

  // Extra Discount row - only when there is a non-zero extra
  // discount on the sale. This keeps the layout clean when no
  // extra discount is applied.
  if (saleExtraDiscount > 0) {
    doc.rect(totalsStartX, y, totalsWidth, baseRowHeight).stroke();
    doc
      .moveTo(col5, y)
      .lineTo(col5, y + baseRowHeight)
      .stroke();

    // Match font family, weight and color with other totals
    // rows while ensuring the label fits entirely on a single
    // line. We give the text a slightly larger effective width
    // to avoid wrapping "Extra Discount".
    doc.fontSize(9).font('Helvetica').fillColor('#000000');
    doc.text('Extra Discount:', col4, y + 5, {
      width: col4Width,
      align: 'right',
    });
    doc.text(`${currency} ${saleExtraDiscount.toFixed(2)}`, col5 + 5, y + 5, {
      width: col5Width - 10,
      align: 'right',
    });
    y += baseRowHeight;
  }

  // TOTAL row (bold)
  doc.rect(totalsStartX, y, totalsWidth, baseRowHeight).stroke();
  doc
    .moveTo(col5, y)
    .lineTo(col5, y + baseRowHeight)
    .stroke();
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('TOTAL:', col4 + 5, y + 5, { width: col4Width - 10, align: 'right' });
  doc.text(`${currency} ${grandTotal.toFixed(2)}`, col5 + 5, y + 5, {
    width: col5Width - 10,
    align: 'right',
  });
  y += baseRowHeight;

  // Payment/credit row (for partial payments)
  const partialBalance = parseFloat(data.partial_balance || 0);
  const paymentPending = parseFloat(data.payment_pending || 0);
  const isPartialPayment = data.partial_check === 'true' || data.partial_check === true;

  if (isPartialPayment && partialBalance > 0) {
    const paymentCreditRowHeight = baseRowHeight * 1.5;
    doc.rect(totalsStartX, y, totalsWidth, paymentCreditRowHeight).stroke();
    doc
      .moveTo(col5, y)
      .lineTo(col5, y + paymentCreditRowHeight)
      .stroke();
    doc.fontSize(9).font('Helvetica');
    doc.text('Payment/credit:', col4 + 5, y + 5, { width: col4Width - 10, align: 'right' });
    doc.text(`${currency} ${partialBalance.toFixed(2)}`, col5 + 5, y + 5, {
      width: col5Width - 10,
      align: 'right',
    });
    y += paymentCreditRowHeight;

    // Balance Due row
    doc.rect(totalsStartX, y, totalsWidth, baseRowHeight).stroke();
    doc
      .moveTo(col5, y)
      .lineTo(col5, y + baseRowHeight)
      .stroke();
    doc.text('Balance Due:', col4 + 5, y + 5, { width: col4Width - 10, align: 'right' });
    doc.text(`${currency} ${paymentPending.toFixed(2)}`, col5 + 5, y + 5, {
      width: col5Width - 10,
      align: 'right',
    });
    y += baseRowHeight;
  }

  // Payment row - show multi-payment breakdown or single payment mode
  const multiPayment = data.multi_payment || {};
  const hasMultiPayment = Object.keys(multiPayment).length > 0;

  if (hasMultiPayment && isPartialPayment) {
    // Show multi-payment breakdown. Render each method on its own line
    // and grow the row height accordingly so that the text never wraps
    // into the Status row or outside the table borders.
    const paymentLines = Object.entries(multiPayment)
      .filter(([_, amount]) => parseFloat(amount) > 0)
      .map(([method, amount]) => `${method} ${currency} ${parseFloat(amount).toFixed(2)}`);

    const effectiveLines = paymentLines.length > 0 ? paymentLines.length : 1;
    const paymentRowHeight = baseRowHeight * effectiveLines;
    const paymentText = paymentLines.join('\n');

    doc.rect(totalsStartX, y, totalsWidth, paymentRowHeight).stroke();
    doc
      .moveTo(col5, y)
      .lineTo(col5, y + paymentRowHeight)
      .stroke();
    doc.fontSize(9).font('Helvetica');
    doc.text('Payment:', col4 + 5, y + 5, { width: col4Width - 10, align: 'right' });
    doc.text(paymentText, col5 + 5, y + 5, { width: col5Width - 10, align: 'right' });
    y += paymentRowHeight;
  } else {
    // Show single payment mode
    const paymentMode = data.payment_mode || 'Cash';
    doc.rect(totalsStartX, y, totalsWidth, baseRowHeight).stroke();
    doc
      .moveTo(col5, y)
      .lineTo(col5, y + baseRowHeight)
      .stroke();
    doc.fontSize(9).font('Helvetica');
    doc.text('Payment:', col4 + 5, y + 5, { width: col4Width - 10, align: 'right' });
    doc.text(paymentMode, col5 + 5, y + 5, { width: col5Width - 10, align: 'right' });
    y += baseRowHeight;
  }

  // Status row
  const paymentStatus = data.payment_status || 'Paid';
  doc.rect(totalsStartX, y, totalsWidth, baseRowHeight).stroke();
  doc
    .moveTo(col5, y)
    .lineTo(col5, y + baseRowHeight)
    .stroke();
  doc.fontSize(9).font('Helvetica');
  doc.text('Status:', col4 + 5, y + 5, { width: col4Width - 10, align: 'right' });
  doc.text(paymentStatus, col5 + 5, y + 5, { width: col5Width - 10, align: 'right' });
  y += baseRowHeight;

  // Footer - dynamic spacing based on page height
  const pageHeight = 792; // Standard letter size height
  const footerHeight = 30; // Space needed for footer content
  const minSpacing = 20; // Minimum spacing after content
  const bottomMargin = 80; // Bottom page margin
  const targetFooterY = pageHeight - bottomMargin; // Target position at bottom

  // Calculate footer position: use bottom of page if content fits, otherwise place after content
  let footerY;
  if (y + minSpacing + footerHeight <= targetFooterY) {
    // Content fits, place footer at bottom
    footerY = targetFooterY;
  } else {
    // Content too long, place footer after content
    footerY = y + minSpacing;
  }

  // Horizontal line above footer
  doc.moveTo(50, footerY).lineTo(545, footerY).stroke();

  // Footer branding logo (left side). Prefer the white-label brand logo so a
  // shop trading under its own brand never hands its customer a bill stamped
  // with ours; fall back to the posnic mark only when nothing is configured.
  const defaultLogoPath = path.join(__dirname, '../img/posnicicon.png');
  const posnicLogoPath =
    config.posnicLogo ||
    branch?.posnic_logo ||
    require('../helpers/brand').brandLogoPath() ||
    defaultLogoPath;

  // Logo on left and page number on right - same line
  const footerTextY = footerY + 10;
  const currentPage = doc.bufferedPageRange().count;

  // Posnic logo on left
  try {
    doc.image(posnicLogoPath, 50, footerY + 8, { width: 35, height: 15 });
  } catch (err) {
    // Fallback to text only if image fails
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#0066CC')
      .text(require('../helpers/brand').brandName(), 50, footerTextY);
  }

  // Page number on right corner - same line
  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#000000')
    .text(`Page ${currentPage} of ${currentPage}`, 400, footerTextY, { align: 'right' });

  // Finalize PDF
  doc.end();
}

/**
 * Generate Receiving/Purchase Invoice PDF
 * @param {Object} options - PDF generation options
 * @param {Object} options.data - Receiving order data
 * @param {Object} options.branch - Branch details
 * @param {Object} options.res - Express response object
 * @param {Object} options.config - Configuration options
 */
function generateReceivingPDF(options) {
  const { data, branch, res, config = {} } = options;
  const {
    title = 'Purchase Invoice.',
    idField = 'receiving_id',
    itemsField = 'items',
    supplierField = 'supplier',
    dateField = 'date',
    filename = 'receiving.pdf',
  } = config;

  const doc = new PDFDocument({ margin: 50 });
  const hasDejavu = registerDejaVuSansCondensed(doc);

  // Get data
  const currency = branch?.currency_type || '₹';
  const storeName = branch?.branch_name || 'Store';
  const storeAddress = branch?.store_address || '';
  const storeEmail = branch?.store_email || '';
  const storePhone = branch?.store_telephone || '';
  // Prefer GSTIN from branch document, but fall back to any branch_gstin_number
  // carried on the receiving payload (for maximum compatibility with legacy data).
  const storeGstinRaw =
    typeof branch?.branch_gstin_number === 'string' && branch.branch_gstin_number.trim()
      ? branch.branch_gstin_number.trim()
      : typeof data.branch_gstin_number === 'string'
        ? data.branch_gstin_number.trim()
        : '';

  const supplier = data[supplierField];
  const supplierName = supplier?.supplier_name || data.supplier_name || 'Supplier';
  const supplierPhone = supplier?.supplier_phone || data.supplier_phone || '';
  const supplierEmail = supplier?.supplier_email || data.supplier_email || '';
  const supplierAddress = supplier?.supplier_address || data.supplier_address || '';

  const receivingDate = data[dateField] || data.createdAt;
  let formattedDate = '';
  let filenameDatePart = '';
  if (receivingDate) {
    const date = new Date(receivingDate);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    const hoursStr = String(hours).padStart(2, '0');
    formattedDate = `${month}/${day}/${year} ${hoursStr}:${minutes} ${ampm}`;
    filenameDatePart = `${month}_${day}_${year}`;
  }

  // Set response headers for PDF download
  const receivingId = data[idField] || 'receiving';
  const pdfFilename = filenameDatePart ? `${receivingId}_${filenameDatePart}` : receivingId;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}.pdf"`);

  // Optionally save a server-side copy. Saving is enabled when either
  // `config.saveToFile` is truthy or the environment variable
  // `PDF_SAVE_DIR` is defined. Default save location is
  // ApiV2/public/pdfs relative to this file when saving is enabled.
  const shouldSaveRecv = !!(config && config.saveToFile) || !!process.env.PDF_SAVE_DIR;
  if (shouldSaveRecv) {
    try {
      const saveDir =
        config.savePath ||
        process.env.PDF_SAVE_DIR ||
        path.join(__dirname, '..', '..', 'public', 'pdfs');
      if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
      const filePath = path.join(saveDir, `${pdfFilename}.pdf`);
      const fileStream = fs.createWriteStream(filePath);
      doc.pipe(fileStream);
      try {
        res.setHeader('X-Saved-File-Path', filePath);
      } catch (e) {
        /* ignore */
      }
    } catch (err) {
      console.error('Failed to create PDF save stream:', err && err.message);
    }
  }

  // Pipe PDF to response
  doc.pipe(res);

  // Header Layout matching design

  // Add watermark text. A white-label reseller gets their own brand name; every
  // other install shows the short mark "Posnic" (never the full "Posnic
  // Innovations Pvt ltd" company name).
  const watermarkFontName = hasDejavu ? 'DejaVuSansCondensed' : 'Helvetica';
  const watermarkText =
    config.watermarkText || require('../helpers/brand').brandName() || 'Posnic';
  addWatermark(doc, watermarkText, {
    fontName: watermarkFontName,
    fontSize: hasDejavu ? 52 : 50,
    characterSpacing: 1.1,
  });

  // Store logo on top right corner
  const defaultStoreLogo = path.join(__dirname, '../img/store.png');
  let branchImagePath = defaultStoreLogo;
  if (branch && typeof branch.logo === 'string' && branch.logo.trim() !== '') {
    const rawLogo = branch.logo.trim();
    if (rawLogo !== 'store.png') {
      if (rawLogo.startsWith('http://') || rawLogo.startsWith('https://')) {
        branchImagePath = rawLogo;
      } else if (path.isAbsolute(rawLogo)) {
        branchImagePath = rawLogo;
      } else {
        branchImagePath = path.join(__dirname, '..', rawLogo);
      }
    }
  }

  try {
    doc.image(branchImagePath, 520, 40, { width: 40, height: 40 });
  } catch (err) {
    try {
      doc.image(defaultStoreLogo, 520, 40, { width: 40, height: 40 });
    } catch (fallbackErr) {
      console.log(
        'Branch logo failed to load:',
        err.message,
        'Fallback error:',
        fallbackErr.message
      );
    }
  }

  // Store info on left side
  doc.fontSize(16).font('Helvetica-Bold').text(storeName, 50, 40);
  doc.fontSize(9).font('Helvetica').text(storeAddress, 50, doc.y);

  // Phone with icon
  if (storePhone) {
    const phoneY = doc.y;
    // Use the same DejaVuSansCondensed phone glyph as legacy PHP mPDF
    doc.fontSize(9).font(hasDejavu ? 'DejaVuSansCondensed' : 'Helvetica');
    doc.text('\u260E', 50, phoneY);
    // Phone number itself remains in the regular body font
    doc.fontSize(9).font('Helvetica');
    doc.text(storePhone, 65, phoneY);
  }

  // Email
  if (storeEmail) {
    const emailY = doc.y;
    doc.fontSize(9).font(hasDejavu ? 'DejaVuSansCondensed' : 'Helvetica');
    doc.text('@', 50, emailY);
    doc.fontSize(9).font('Helvetica');
    doc.text(storeEmail, 65, emailY);
  }

  // GSTIN (only when configured for the branch)
  if (storeGstinRaw) {
    doc.fontSize(9).font('Helvetica').text(`GSTIN: ${storeGstinRaw}`, 50, doc.y);
  }

  // Purchase Invoice title and ID (right side, below logo)
  doc.fontSize(11).font('Helvetica').text(title, 400, 90, { align: 'right' });
  doc
    .fontSize(16)
    .font('Helvetica-Bold')
    .text(`#${data[idField] || 'N/A'}`, 400, 105, { align: 'right' });

  // Date (right side, below invoice ID)
  doc.fontSize(9).font('Helvetica').text(`Date: ${formattedDate}`, 400, 130, { align: 'right' });

  // Supplier Details (left side)
  doc.fontSize(11).font('Helvetica-Bold').text('Supplier Details:', 50, 130);
  doc.fontSize(9).font('Helvetica');
  doc.fillColor('#8B0000'); // Dark red/maroon for supplier name
  doc.text(supplierName, 50, 148);
  doc.fillColor('#000000'); // Reset to black
  if (supplierAddress) doc.text(supplierAddress, 50, doc.y);
  if (supplierPhone) doc.text(supplierPhone, 50, doc.y);
  if (supplierEmail) doc.text(supplierEmail, 50, doc.y);

  // Set Y position for table
  doc.y = 200;

  // Items Table with borders
  const tableTop = doc.y;
  const tableLeft = 45;
  const tableWidth = 520;

  const col1 = tableLeft;
  // Widen S.No column slightly so "S.No." fits on one line
  const col1Width = 40;
  const col2 = col1 + col1Width;
  // Shrink Description column a bit to keep total width unchanged
  const col2Width = 270;
  const col3 = col2 + col2Width;
  const col3Width = 70;
  const col4 = col3 + col3Width;
  const col4Width = 70;
  const col5 = col4 + col4Width;
  const col5Width = 70;

  // Table Header with gray background
  doc.rect(tableLeft, tableTop, tableWidth, 20).fillAndStroke('#f0f0f0', '#000000');

  // Draw vertical lines for header
  doc
    .moveTo(col2, tableTop)
    .lineTo(col2, tableTop + 20)
    .stroke();
  doc
    .moveTo(col3, tableTop)
    .lineTo(col3, tableTop + 20)
    .stroke();
  doc
    .moveTo(col4, tableTop)
    .lineTo(col4, tableTop + 20)
    .stroke();
  doc
    .moveTo(col5, tableTop)
    .lineTo(col5, tableTop + 20)
    .stroke();

  // Table Header text
  doc.fillColor('#000000');
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('S.No.', col1 + 5, tableTop + 5, { width: col1Width - 10 });
  doc.text('Description', col2 + 5, tableTop + 5, { width: col2Width - 10 });
  doc.text('Quantity', col3 + 5, tableTop + 5, { width: col3Width - 10, align: 'center' });
  doc.text('Price', col4 + 5, tableTop + 5, { width: col4Width - 10, align: 'right' });
  doc.text('Amount', col5 + 5, tableTop + 5, { width: col5Width - 10, align: 'right' });

  // Table Rows
  let y = tableTop + 20;
  const items = data[itemsField] || [];

  doc.font('Helvetica');
  items.forEach((item, index) => {
    const itemName = item.item?.item_name || item.item_name || 'Item';
    const quantity = parseFloat(item.item_quantity || item.quantity || 0);
    const price = parseFloat(item.item_price || item.cost_price || 0);
    const total = parseFloat(item.total_amount || item.total || 0);
    const itemUnit = item.item?.item_unit || item.item_unit || 'qty';

    // Slightly taller row for better spacing between price and tax lines
    const rowHeight = 32;

    // Draw row border
    doc.rect(tableLeft, y, tableWidth, rowHeight).stroke();

    // Draw vertical lines
    doc
      .moveTo(col2, y)
      .lineTo(col2, y + rowHeight)
      .stroke();
    doc
      .moveTo(col3, y)
      .lineTo(col3, y + rowHeight)
      .stroke();
    doc
      .moveTo(col4, y)
      .lineTo(col4, y + rowHeight)
      .stroke();
    doc
      .moveTo(col5, y)
      .lineTo(col5, y + rowHeight)
      .stroke();

    // Draw cell content
    doc.fontSize(9);
    doc.text(String(index + 1), col1 + 5, y + 7, { width: col1Width - 10 });
    doc.text(itemName, col2 + 5, y + 7, { width: col2Width - 10 });
    doc.text(`${quantity} ${itemUnit}`, col3 + 5, y + 7, {
      width: col3Width - 10,
      align: 'center',
    });

    // Calculate tax display
    const tax = item.tax || 0;
    let taxDisplay = '-';
    let taxSign = '-';
    if (tax > 0) {
      taxDisplay = tax;
      taxSign = '%';
    }

    const taxText = `${taxDisplay}${taxSign}`;

    // Price with tax info below, matching sales PDF style
    doc
      .fontSize(9)
      .fillColor('#000000')
      .text(`${currency} ${price.toFixed(2)}`, col4 + 5, y + 4, {
        width: col4Width - 10,
        align: 'right',
      });

    // Tax line, slightly smaller and darker, right-aligned inside Price box
    doc
      .fontSize(8)
      .fillColor('#333333')
      .text(`Tax : ${taxText}`, col4 + 5, y + 18, { width: col4Width - 10, align: 'right' });

    // Reset
    doc.fontSize(9).fillColor('#000000');

    doc.text(`${currency} ${total.toFixed(2)}`, col5 + 5, y + 7, {
      width: col5Width - 10,
      align: 'right',
    });

    y += rowHeight;

    // Add new page if needed
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
  });

  // Totals Section (right columns only)
  const subtotal = parseFloat(data.subtotal || data.sub_total || 0);
  const tax = parseFloat(data.tax || 0);
  const grandTotal = parseFloat(data.items_total || data.grand_total || data.total_amount || 0);
  const totalQty = items.reduce(
    (sum, item) => sum + parseFloat(item.item_quantity || item.quantity || 0),
    0
  );

  const rowHeight = 20;
  const totalsStartX = col4;
  const totalsWidth = col4Width + col5Width;

  // Total Qty row
  doc.rect(totalsStartX, y, totalsWidth, rowHeight).stroke();
  doc
    .moveTo(col5, y)
    .lineTo(col5, y + rowHeight)
    .stroke();
  doc.fontSize(9).font('Helvetica');
  doc.text('Total Qty:', col4 + 5, y + 5, { width: col4Width - 10, align: 'right' });
  doc.text(String(totalQty), col5 + 5, y + 5, { width: col5Width - 10, align: 'right' });
  y += rowHeight;

  // Subtotal row
  doc.rect(totalsStartX, y, totalsWidth, rowHeight).stroke();
  doc
    .moveTo(col5, y)
    .lineTo(col5, y + rowHeight)
    .stroke();
  doc.text('Subtotal:', col4 + 5, y + 5, { width: col4Width - 10, align: 'right' });
  doc.text(`${currency} ${subtotal.toFixed(2)}`, col5 + 5, y + 5, {
    width: col5Width - 10,
    align: 'right',
  });
  y += rowHeight;

  // Tax row (if applicable)
  if (tax > 0) {
    doc.rect(totalsStartX, y, totalsWidth, rowHeight).stroke();
    doc
      .moveTo(col5, y)
      .lineTo(col5, y + rowHeight)
      .stroke();
    doc.text('Tax:', col4 + 5, y + 5, { width: col4Width - 10, align: 'right' });
    doc.text(`${currency} ${tax.toFixed(2)}`, col5 + 5, y + 5, {
      width: col5Width - 10,
      align: 'right',
    });
    y += rowHeight;
  }

  // TOTAL row (bold)
  doc.rect(totalsStartX, y, totalsWidth, rowHeight).stroke();
  doc
    .moveTo(col5, y)
    .lineTo(col5, y + rowHeight)
    .stroke();
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('TOTAL:', col4 + 5, y + 5, { width: col4Width - 10, align: 'right' });
  doc.text(`${currency} ${grandTotal.toFixed(2)}`, col5 + 5, y + 5, {
    width: col5Width - 10,
    align: 'right',
  });
  y += rowHeight;

  // Payment row
  const paymentMode = data.payment_mode || 'Cash';

  doc.rect(totalsStartX, y, totalsWidth, rowHeight).stroke();
  doc
    .moveTo(col5, y)
    .lineTo(col5, y + rowHeight)
    .stroke();
  doc.fontSize(9).font('Helvetica');
  doc.text('Payment:', col4 + 5, y + 5, { width: col4Width - 10, align: 'right' });
  doc.text(paymentMode, col5 + 5, y + 5, { width: col5Width - 10, align: 'right' });
  y += rowHeight;

  // Footer - dynamic spacing based on page height
  const pageHeight = 792;
  const footerHeight = 30;
  const minSpacing = 20;
  const bottomMargin = 80;
  const targetFooterY = pageHeight - bottomMargin;

  let footerY;
  if (y + minSpacing + footerHeight <= targetFooterY) {
    footerY = targetFooterY;
  } else {
    footerY = y + minSpacing;
  }

  // Horizontal line above footer
  doc.moveTo(50, footerY).lineTo(545, footerY).stroke();

  // Footer branding logo (left side). White-label brand logo first, posnic mark
  // only as a last resort - see generateInvoicePDF footer for the rationale.
  const defaultLogoPath = path.join(__dirname, '../img/posnicicon.png');
  const posnicLogoPath =
    config.posnicLogo ||
    branch?.posnic_logo ||
    require('../helpers/brand').brandLogoPath() ||
    defaultLogoPath;

  // Logo on left and page number on right - same line
  const footerTextY = footerY + 10;
  const currentPage = doc.bufferedPageRange().count;

  // Posnic logo on left
  try {
    doc.image(posnicLogoPath, 50, footerY + 8, { width: 35, height: 15 });
  } catch (err) {
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#0066CC')
      .text(require('../helpers/brand').brandName(), 50, footerTextY);
  }

  // Page number on right corner - same line
  doc
    .fontSize(9)
    .font('Helvetica')
    .fillColor('#000000')
    .text(`Page ${currentPage} of ${currentPage}`, 400, footerTextY, { align: 'right' });

  // Finalize PDF
  doc.end();
}

module.exports = {
  generateInvoicePDF,
  generateReceivingPDF,
};
