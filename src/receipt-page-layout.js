(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PosnicReceiptPage = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  // Self-contained: Electron executes the same function in its print window.
  // Call after fonts and images load, before opening the print dialog/spooler.
  function fitDocument(doc, options) {
    var receipt = doc.querySelector('.rd-document[data-receipt-design]');
    var format = receipt && receipt.getAttribute('data-receipt-design');
    if (format !== '58' && format !== '80') return null;
    // Thermal drivers address the print head, not the edge-to-edge roll.
    // Sending an 80 mm raster to a 72 mm (576-dot) head crops its right edge;
    // centring 72 mm content on that page adds another unwanted 4 mm offset.
    // The printer itself supplies the unprintable sides of the physical roll.
    var width = format === '80' ? 72 : 48;
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
    // A browser cannot set the driver's selected media. Chromium centres a
    // custom short CSS page on that larger sheet (e.g. an 80 x 297 mm form),
    // adding blank paper above the receipt and room for browser headers.
    // Use the selected paper in browser dialogs; only Electron also sends
    // the measured dimensions to the driver and can fit the physical page.
    var pageSize = options && options.usePrinterPaper ? 'auto' : width + 'mm ' + heightMm + 'mm';
    style.textContent = '@page{size:' + pageSize + ';margin:0;}' +
      '@media print{html,body{width:' + width + 'mm!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;}.rd-document{margin:0!important;}}';
    // Rendered receipts carry their base style in the body. Keep the fitted
    // dimensions last so that the base @page size:auto cannot override them.
    (doc.body || doc.head).appendChild(style);
    return { width: width * 1000, height: Math.round(heightMm * 1000) };
  }
  // Serialized into the hidden Electron window. A completed HTTP load can
  // still be an empty 404 response, so readiness must include actual content.
  async function prepareDocument(doc, expectedReceipt) {
    var wait = function (promise) {
      return new Promise(function (resolve) {
        var timer = setTimeout(resolve, 5000);
        Promise.resolve(promise).catch(function () {}).then(function () { clearTimeout(timer); resolve(); });
      });
    };
    await Promise.all([
      wait(doc.fonts ? doc.fonts.ready : Promise.resolve()),
      wait(Promise.all(Array.from(doc.images).map(function (img) {
        return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
      })))
    ]);
    var content = expectedReceipt ? doc.querySelector('.rd-document[data-receipt-design]') : doc.body;
    if (!content) throw new Error('The receipt document did not load.');
    var text = (content.innerText || '').trim();
    var image = Array.from(content.querySelectorAll('img')).some(function (img) {
      var rect = img.getBoundingClientRect();
      return img.naturalWidth > 0 && rect.width > 0 && rect.height > 0;
    });
    if (!text && !image) throw new Error('The print document is blank.');
    if (expectedReceipt && content.getBoundingClientRect().height <= 0) throw new Error('The receipt is not visible.');
  }
  return { fitDocument: fitDocument, prepareDocument: prepareDocument };
}));
