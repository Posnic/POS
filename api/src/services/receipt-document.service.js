'use strict';

// Receipt files are generated from the current tenant's sale. Never accept a
// caller-supplied file URL or filesystem path for a customer document.
async function prepare(saleId, branchId) {
  const sales = require('./sale.service');
  const sale = await sales.getSaleForPdf(saleId);
  const saleBranch = sale && (sale.branch_id || sale.branch || sale.branchId);
  if (!sale || String(saleBranch?._id || saleBranch) !== String(branchId)) {
    throw new Error('Receipt not found in this outlet.');
  }
  const branch = await sales.getBranchById(branchId);
  const { PassThrough } = require('stream');
  const sink = new PassThrough();
  sink.setHeader = () => {};
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    sink.on('data', (chunk) => chunks.push(chunk));
    sink.on('end', resolve);
    sink.on('error', reject);
  });
  require('../utils/pdfGenerator').generateInvoicePDF({
    data: sale,
    branch,
    res: sink,
    config: {
      title: 'Sales Invoice.',
      idField: 'sales_id',
      itemsField: 'items',
      customerField: 'customer',
      dateField: 'date',
    },
  });
  await done;
  const buffer = Buffer.concat(chunks);
  const filename = `invoice-${String(sale.sales_id || 'receipt').replace(/[^\w.-]/g, '_')}.pdf`;
  const { s3Config, getS3Client, publicUrlFor } = require('../utils/s3');
  let url = null;
  if (s3Config().bucket) {
    // Generate a fresh snapshot: a previous invoice_key can predate a payment
    // correction. Do not overwrite a link already sent to another recipient.
    const key = `${process.env.SHARE_LINK_PREFIX || ''}i/${require('crypto').randomBytes(16).toString('base64url')}`;
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: s3Config().bucket,
        Key: key,
        Body: buffer,
        ContentType: 'application/pdf',
        ContentDisposition: `inline; filename="${filename}"`,
      })
    );
    url = publicUrlFor(key);
  }
  return { buffer, filename, url };
}

module.exports = { prepare };
