'use strict';

const path = require('node:path');
const moment = require('moment-timezone');

function periodLabel(schedule, report) {
  const zone = schedule.timezone || 'UTC';
  const format = (date) => moment(date).tz(zone).format('D MMM YYYY, HH:mm');
  return `${format(report.range.starting_date)} to ${format(report.range.ending_date)} (${zone})`;
}

// Input comes only from the authorized report builder, never a caller URL or file.
async function prepare(schedule, report, { share = false } = {}) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.font(path.join(__dirname, '../fonts/DejaVuSansCondensed.ttf'));
  doc.fillColor('#123052').fontSize(22).text('Business summary');
  doc
    .moveDown(0.5)
    .fontSize(12)
    .text(report.branch.branch_name || schedule.branch_id);
  doc.moveDown(0.5).fillColor('#526174').fontSize(9).text(periodLabel(schedule, report));
  doc
    .moveDown(1.5)
    .fillColor('#123052')
    .fontSize(11)
    .text(report.answer || '');
  doc.moveDown();
  for (const metric of report.metrics || []) {
    doc.fontSize(12).text(`${metric.label}: ${metric.value}`).moveDown(0.5);
  }
  doc
    .moveDown()
    .fillColor('#526174')
    .fontSize(9)
    .text(`Source: ${report.source || 'Sales report'}`);
  doc.end();
  const buffer = await complete;
  const filename = `posnic-summary-${moment(report.range.starting_date)
    .tz(schedule.timezone || 'UTC')
    .format('YYYY-MM-DD')}.pdf`;
  let url = null;
  if (share) {
    const { s3Config, uploadObject } = require('../utils/s3');
    if (!s3Config().bucket)
      throw new Error('Configure document sharing before sending report links.');
    // Reuse the receipt sharing path and its unguessable, per-send snapshot keys.
    // No tenant, branch, customer or financial data is exposed in the URL.
    const key = `${process.env.SHARE_LINK_PREFIX || ''}i/${require('node:crypto').randomBytes(24).toString('base64url')}`;
    const uploaded = await uploadObject({
      key,
      body: buffer,
      contentType: 'application/pdf',
      contentDisposition: `inline; filename="${filename}"`,
    });
    url = uploaded.Location;
  }
  return { buffer, filename, url };
}

module.exports = { prepare, periodLabel };
