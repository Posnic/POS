const test = require('node:test');
const assert = require('node:assert/strict');
const { renderFastReceipt } = require('../src/receipt-fast');
const { validateDocumentPrintSettings, documentPrintSettings } = require('../src/device-preferences');
test('fast receipt prints all money and rejects control bytes', () => {
  for (const paper of ['58','80','112']) {
    const bytes = renderFastReceipt(['Rice 2 499.50', 'Round Off Rs. 0.50', 'Total Rs. 500.00', 'UPI Rs. 300.00', 'Cash Rs. 200.00'], paper).toString('ascii');
    for (const amount of ['499.50','0.50','500.00','300.00','200.00']) assert.ok(bytes.includes(amount));
  }
  assert.throws(() => renderFastReceipt(['hello\x1b@'], '80'));
  assert.throws(() => renderFastReceipt(['தமிழ்'], '80'));
});
test('print modes persist per printer; legacy default stays unchanged', () => {
  const base = documentPrintSettings({});
  assert.equal(base.sales[0].printMode, undefined);
  for (const mode of ['fast','exact','driver']) {
    base.sales[0].printMode = mode;
    assert.equal(validateDocumentPrintSettings(base).sales[0].printMode, mode);
  }
  base.sales[0].printMode = 'invalid';
  assert.throws(() => validateDocumentPrintSettings(base));
  base.sales[0].printMode = 'fast'; base.sales[0].pageSize = 'a4';
  assert.throws(() => validateDocumentPrintSettings(base));
});
