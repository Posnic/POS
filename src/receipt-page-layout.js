(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PosnicReceiptPage = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  // Self-contained: Electron executes the same function in its print window.
  // Call after fonts and images load, before opening the print dialog/spooler.
  function fitDocument(doc) {
    var receipt = doc.querySelector('.rd-document[data-receipt-design]');
    var format = receipt && receipt.getAttribute('data-receipt-design');
    if (format !== '58' && format !== '80') return null;
    var width = Number(format);
    // Never measure body.scrollHeight: it includes the preview/window height.
    var height = receipt.getBoundingClientRect().height;
    if (!Number.isFinite(height) || height <= 0) throw new Error('The receipt could not be measured.');
    // One CSS pixel of rounding tolerance; the receipt includes its own small
    // top/bottom padding. Keep long receipts paginated instead of clipping them.
    var heightMm = Math.min(3000, Math.max(20, Math.ceil((height + 1) * 25.4 / 96 * 10) / 10));
    var style = doc.getElementById('rd-fitted-paper');
    if (!style) {
      style = doc.createElement('style');
      style.id = 'rd-fitted-paper';
    }
    style.textContent = '@page{size:' + width + 'mm ' + heightMm + 'mm;margin:0;}' +
      '@media print{html,body{width:' + width + 'mm!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;}}';
    // Rendered receipts carry their base style in the body. Keep the fitted
    // dimensions last so that the base @page size:auto cannot override them.
    (doc.body || doc.head).appendChild(style);
    return { width: width * 1000, height: Math.round(heightMm * 1000) };
  }
  return { fitDocument: fitDocument };
}));
