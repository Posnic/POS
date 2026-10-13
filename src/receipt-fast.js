'use strict';
const { Receipt, COLUMNS } = require('./escpos-receipt');
// Fast mode accepts printable text only, never embedded printer commands.
function renderFastReceipt(lines, paper) {
  if (!COLUMNS[paper] || !Array.isArray(lines) || !lines.length || lines.length > 5000) throw new Error('Invalid fast receipt');
  const receipt = new Receipt(paper);
  let size = 0;
  for (const value of lines) {
    if (typeof value !== 'string' || /[^\x20-\x7e]/.test(value)) throw new Error('Fast receipt requires printable text');
    size += value.length;
    if (size > 200000) throw new Error('Fast receipt is too long');
    let remaining = value;
    while (remaining.length > receipt.width) {
      let cut = remaining.lastIndexOf(' ', receipt.width);
      if (cut < 1) cut = receipt.width;
      receipt.line(remaining.slice(0, cut));
      remaining = remaining.slice(cut).trimStart();
    }
    receipt.line(remaining);
  }
  receipt.cut();
  return receipt.build();
}
module.exports = { renderFastReceipt };
