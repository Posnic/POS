const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const os = require('os');

// DejaVuSansCondensed ships WITH the api now (src/fonts, Bitstream Vera
// licence alongside). It exists for one load-bearing reason: the built-in
// Helvetica has no rupee glyph, so every Indian invoice printed its amounts
// as garbage until the first shop noticed. The legacy mPDF copy is kept as
// a fallback for installs that still carry the old PHP tree.
const dejavuRegularPath = (() => {
  const local = path.join(__dirname, '../fonts/DejaVuSansCondensed.ttf');
  if (fs.existsSync(local)) return local;
  return path.join(__dirname, '../../../Api/src/vendor/mpdf/mpdf/ttfonts/DejaVuSansCondensed.ttf');
})();
const dejavuBoldPath = path.join(__dirname, '../fonts/DejaVuSansCondensed-Bold.ttf');
const dejavuSansCondensedPath = dejavuRegularPath;

function registerDejaVuSansCondensed(doc) {
  if (!fs.existsSync(dejavuRegularPath)) {
    console.log('DejaVuSansCondensed font not found, using Helvetica fallback:', dejavuRegularPath);
    return false;
  }
  try {
    doc.registerFont('DejaVuSansCondensed', dejavuRegularPath);
    if (fs.existsSync(dejavuBoldPath)) {
      doc.registerFont('DejaVuSansCondensed-Bold', dejavuBoldPath);
    }
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

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
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

  /*
   * The render speaks the app's q-sheet language: letterhead left, the
   * document's identity right, one dark rule under the head, an OPEN items
   * table (hairline separators, never a grid of boxes), totals as a right
   * column with a heavy rule before TOTAL, and a payment block. The owner
   * rejected the boxed-grid original as "very bad" - this is the invoice a
   * customer keeps, so it wears the sheet design the app itself shows.
   */
  const F = hasDejavu ? 'DejaVuSansCondensed' : 'Helvetica';
  const FB =
    hasDejavu && fs.existsSync(dejavuBoldPath) ? 'DejaVuSansCondensed-Bold' : 'Helvetica-Bold';
  // Helvetica has no rupee glyph - without DejaVu a non-ASCII currency
  // renders as garbage, and "Rs." beats garbage on a customer's bill.
  const cur = hasDejavu || /^[\x20-\x7E]*$/.test(currency) ? currency : 'Rs.';
  const money = (n) => `${cur} ${(Number(n) || 0).toFixed(2)}`;

  const INK = '#1f2328';
  const MUTED = '#57606a';
  const HAIR = '#d0d7de';
  const xL = 50;
  const xR = 545;
  const W = xR - xL;

  // ---- letterhead ----
  let y = 46;
  doc
    .fillColor(INK)
    .font(FB)
    .fontSize(19)
    .text(storeName, xL, y, { width: W - 160 });
  y = doc.y + 2;
  doc.font(F).fontSize(9).fillColor(MUTED);
  if (storeAddress) {
    doc.text(storeAddress, xL, y, { width: W - 200 });
    y = doc.y;
  }
  const contact = [storePhone, storeEmail].filter(Boolean).join('  ·  ');
  if (contact) {
    doc.text(contact, xL, y, { width: W - 200 });
    y = doc.y;
  }
  if (storeGstinRaw) {
    doc.text(`GSTIN ${storeGstinRaw}`, xL, y, { width: W - 200 });
    y = doc.y;
  }

  // A real shop logo earns its corner; the generic placeholder icon never
  // renders again - an empty corner beats a stock clip-art store.
  if (
    branch &&
    typeof branch.logo === 'string' &&
    branch.logo.trim() &&
    branch.logo.trim() !== 'store.png'
  ) {
    const rawLogo = branch.logo.trim();
    const logoPath =
      rawLogo.startsWith('http://') || rawLogo.startsWith('https://') || path.isAbsolute(rawLogo)
        ? rawLogo
        : path.join(__dirname, '..', rawLogo);
    try {
      doc.image(logoPath, xR - 44, 46, { fit: [44, 44] });
    } catch (err) {
      /* a broken logo file is not worth a broken invoice */
    }
  }

  // ---- the document's identity, right-aligned ----
  // TAX INVOICE where GST runs, SALES RECEIPT everywhere else - the same
  // rule the on-screen sheet applies. config.title still wins when a
  // caller passes something deliberate.
  const docTitle =
    config.title && config.title !== 'Sales Invoice.'
      ? config.title
      : storeGstinRaw
        ? 'TAX INVOICE'
        : 'SALES RECEIPT';
  let ry = 96;
  doc.font(FB).fontSize(14).fillColor(INK).text(docTitle, xL, ry, {
    width: W,
    align: 'right',
    characterSpacing: 1.5,
  });
  ry = doc.y + 2;
  doc
    .font(FB)
    .fontSize(11)
    .text(`#${data[idField] || 'N/A'}`, xL, ry, { width: W, align: 'right' });
  ry = doc.y + 2;
  if (formattedDate) {
    doc
      .font(F)
      .fontSize(9)
      .fillColor(MUTED)
      .text(formattedDate, xL, ry, { width: W, align: 'right' });
    ry = doc.y + 4;
  }

  // status pill - outline, so it stays legible on any printer
  const statusRaw = String(data.payment_status || 'Paid');
  const isPaidPill = statusRaw.toLowerCase() === 'paid';
  const pillColor = isPaidPill ? '#1a7f37' : '#c0392b';
  doc.font(FB).fontSize(8);
  const pillText = statusRaw.toUpperCase();
  const pillW = doc.widthOfString(pillText, { characterSpacing: 1 }) + 16;
  doc
    .roundedRect(xR - pillW, ry, pillW, 16, 3)
    .lineWidth(0.8)
    .stroke(pillColor);
  doc.fillColor(pillColor).text(pillText, xR - pillW, ry + 4.5, {
    width: pillW,
    align: 'center',
    characterSpacing: 1,
  });

  // one dark rule closes the head - the q-head border
  y = Math.max(y, ry + 26, 150);
  doc.moveTo(xL, y).lineTo(xR, y).lineWidth(1.2).stroke(INK);
  y += 14;

  // ---- BILL TO ----
  doc.font(FB).fontSize(7.5).fillColor(MUTED).text('BILL TO', xL, y, { characterSpacing: 1.2 });
  y = doc.y + 3;
  doc.font(FB).fontSize(10.5).fillColor(INK).text(customerName, xL, y, { width: W });
  y = doc.y;
  doc.font(F).fontSize(9).fillColor(MUTED);
  [customerAddress, customerPhone, customerEmail].filter(Boolean).forEach((line) => {
    doc.text(line, xL, y, { width: W });
    y = doc.y;
  });
  y += 12;

  // ---- items ----
  const col = {
    no: { x: xL, w: 22, align: 'left' },
    item: { x: xL + 28, w: 244, align: 'left' },
    qty: { x: 322, w: 53, align: 'right' },
    price: { x: 380, w: 75, align: 'right' },
    amount: { x: 460, w: 85, align: 'right' },
  };

  const drawItemsHead = (top) => {
    doc.font(FB).fontSize(7.5).fillColor(MUTED);
    doc.text('#', col.no.x, top, { width: col.no.w, characterSpacing: 0.8 });
    doc.text('ITEM', col.item.x, top, { width: col.item.w, characterSpacing: 0.8 });
    doc.text('QTY', col.qty.x, top, { width: col.qty.w, align: 'right', characterSpacing: 0.8 });
    doc.text('PRICE', col.price.x, top, {
      width: col.price.w,
      align: 'right',
      characterSpacing: 0.8,
    });
    doc.text('AMOUNT', col.amount.x, top, {
      width: col.amount.w,
      align: 'right',
      characterSpacing: 0.8,
    });
    const under = top + 12;
    doc.moveTo(xL, under).lineTo(xR, under).lineWidth(1).stroke(INK);
    return under + 8;
  };

  y = drawItemsHead(y);

  const items = data[itemsField] || [];
  items.forEach((item, index) => {
    const itemName = item.item_name || item.name || 'Item';
    const quantity = parseFloat(item.item_quantity || 0);
    const unit = item.unit || item.item_unit || '';
    const price = parseFloat(item.item_price || 0);
    const total = parseFloat(item.total_amount || 0);

    // discount / tax ride UNDER the name as a quiet meta line, instead of
    // being crammed into the price cell of a boxed grid
    const meta = [];
    if (item.item_discount > 0) meta.push(`Disc ${money(item.item_discount)}`);
    else if (item.item_discount_percentage > 0) meta.push(`Disc ${item.item_discount_percentage}%`);
    if (item.tax > 0) meta.push(`Tax ${item.tax}%`);

    const nameH = doc.font(F).fontSize(9.5).heightOfString(itemName, { width: col.item.w });
    const rowH = Math.max(16, nameH + (meta.length ? 11 : 0) + 6);

    // room for the row, the totals to come, and the footer
    if (y + rowH > doc.page.height - 160) {
      doc.addPage();
      y = drawItemsHead(50);
    }

    doc
      .font(F)
      .fontSize(9)
      .fillColor(MUTED)
      .text(String(index + 1), col.no.x, y, { width: col.no.w });
    doc.font(F).fontSize(9.5).fillColor(INK).text(itemName, col.item.x, y, { width: col.item.w });
    if (meta.length) {
      doc
        .font(F)
        .fontSize(8)
        .fillColor(MUTED)
        .text(meta.join('  ·  '), col.item.x, doc.y + 1, { width: col.item.w });
    }
    doc.font(F).fontSize(9.5).fillColor(INK);
    doc.text(`${quantity}${unit ? ' ' + unit : ''}`, col.qty.x, y, {
      width: col.qty.w,
      align: 'right',
    });
    doc.text(money(price), col.price.x, y, { width: col.price.w, align: 'right' });
    doc.font(FB).text(money(total), col.amount.x, y, { width: col.amount.w, align: 'right' });

    y += rowH;
    doc
      .moveTo(xL, y - 4)
      .lineTo(xR, y - 4)
      .lineWidth(0.4)
      .stroke(HAIR);
  });

  // ---- totals, right column ----
  const subtotal = parseFloat(data.items_subtotal || 0);
  const grandTotal = parseFloat(data.items_total || data.grand_total || 0);
  const totalQty = items.reduce((sum, item) => sum + parseFloat(item.item_quantity || 0), 0);
  const saleExtraDiscount = Math.abs(parseFloat(data.sale_extra_discount || 0));

  const labelX = 330;
  const labelW = 120;
  const valueX = 455;
  const valueW = 90;

  y += 6;
  const totalRow = (label, value, opts = {}) => {
    if (y > doc.page.height - 120) {
      doc.addPage();
      y = 50;
    }
    doc
      .font(opts.bold ? FB : F)
      .fontSize(opts.bold ? 10.5 : 9)
      .fillColor(opts.color || (opts.bold ? INK : MUTED));
    doc.text(label, labelX, y, { width: labelW, align: 'right' });
    doc.fillColor(opts.color || INK).text(value, valueX, y, { width: valueW, align: 'right' });
    y += opts.bold ? 18 : 15;
  };

  totalRow('Total qty', String(totalQty));
  totalRow('Subtotal', money(subtotal));
  if (saleExtraDiscount > 0) totalRow('Extra discount', `- ${money(saleExtraDiscount)}`);

  // the heavy rule before TOTAL - the q-grand border
  doc
    .moveTo(labelX, y + 1)
    .lineTo(xR, y + 1)
    .lineWidth(1.2)
    .stroke(INK);
  y += 7;
  totalRow('TOTAL', money(grandTotal), { bold: true });

  const partialBalance = parseFloat(data.partial_balance || 0);
  const paymentPending = parseFloat(data.payment_pending || 0);
  const isPartialPayment = data.partial_check === 'true' || data.partial_check === true;
  if (isPartialPayment && partialBalance > 0) {
    totalRow('Paid', money(partialBalance));
    totalRow('Balance due', money(paymentPending), { color: '#c0392b' });
  }

  // ---- payment, quiet block on the left ----
  const multiPayment = data.multi_payment || {};
  const paymentLines = Object.entries(multiPayment)
    .filter(([, amount]) => parseFloat(amount) > 0)
    .map(([method, amount]) => `${method}  ${money(amount)}`);
  const payY = y + 6;
  doc.font(FB).fontSize(7.5).fillColor(MUTED).text('PAYMENT', xL, payY, { characterSpacing: 1.2 });
  doc
    .font(F)
    .fontSize(9)
    .fillColor(INK)
    .text(
      paymentLines.length ? paymentLines.join('\n') : data.payment_mode || 'Cash',
      xL,
      doc.y + 3,
      { width: 220 }
    );
  y = Math.max(y, doc.y) + 10;

  // ---- footer ----
  const pageHeight = doc.page.height;
  const targetFooterY = pageHeight - 80;
  const footerY = y + 20 <= targetFooterY ? targetFooterY : y + 20;

  doc.moveTo(xL, footerY).lineTo(xR, footerY).lineWidth(0.4).stroke(HAIR);

  // Footer branding logo (left side). Prefer the white-label brand logo so a
  // shop trading under its own brand never hands its customer a bill stamped
  // with ours; fall back to the posnic mark only when nothing is configured.
  const defaultLogoPath = path.join(__dirname, '../img/posnicicon.png');
  const posnicLogoPath =
    config.posnicLogo ||
    branch?.posnic_logo ||
    require('../helpers/brand').brandLogoPath() ||
    defaultLogoPath;

  const footerTextY = footerY + 10;
  const currentPage = doc.bufferedPageRange().count;

  try {
    doc.image(posnicLogoPath, xL, footerY + 8, { width: 35, height: 15 });
  } catch (err) {
    doc
      .fontSize(9)
      .font(F)
      .fillColor(MUTED)
      .text(require('../helpers/brand').brandName(), xL, footerTextY);
  }

  doc
    .font(F)
    .fontSize(8.5)
    .fillColor(MUTED)
    .text('Thank you for your business.', xL, footerTextY, { width: W, align: 'center' });

  doc
    .fontSize(8.5)
    .fillColor(MUTED)
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
  const watermarkText = config.watermarkText || require('../helpers/brand').brandName() || 'Posnic';
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
