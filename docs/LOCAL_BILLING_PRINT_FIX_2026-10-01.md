# Local billing print correction — 1 October 2026

Reported: the latest installed release on a Pakistan client's offline till
feeds blank paper for actual receipts. Hardware Manager's sample and the web
demo print. Printer reported as Black Copper BC 88AC. No client log, captured
print document or physical test of this patch is available yet.

## Established source defects and changes

- Hardware Manager's sample uses ESC/POS bytes; the receipt designer forced
  driver-rendered HTML. A successful raw sample did not test that driver path.
  Designed thermal receipts now render to monochrome strips and use the same
  existing raw queue, keeping the saved design, text, totals and images.
  This bypasses driver page rendering, but does not establish the client's
  exact driver as the cause or prove raster compatibility on their device.
- Actual sale printing executed legacy template rendering and barcode-canvas
  access before calling the designer. The designer now receives the saved sale
  directly. The regression test has no legacy DOM and enables receipt barcodes;
  Receipt, Thermal and A4 all reach the designer without touching that DOM.
- Explicit A4 selection previously replaced the paper size while retaining the
  thermal target. It now uses configured sheet sales targets or the invoice
  printer. With no sheet printer configured, it reports what to configure
  without submitting to the thermal queue. No saved printer settings change.
- Raster capture refuses completely white output, not just empty HTML. All
  strips are prepared before any bytes are sent. An uncertain raw submission
  stops further copies and never triggers an HTML/PDF fallback. Intended copies
  receive separate delivery IDs; successful earlier copies are not replayed.

## Local verification

Run with the repository's installed dependencies:

```powershell
node --test tests/local-billing-print.test.js tests/receipt-designer.test.js tests/document-print-settings.test.js tests/receipt-page-layout.test.js tests/escpos-unicode.test.js tests/print-window-hardening.test.js
node tests/tools/designed-thermal-proof.cjs
```

The Electron proof renders the production receipt designer with synthetic saved
sale data, 58/80 mm paper, two/100 items, and mixed English/Urdu names. It checks
non-white raster strips, printable width, receipt length/tail and window cleanup.
Empty and white-on-white receipts are rejected. No printer is contacted.

These checks do not certify glyph appearance, cutting or physical paper output
on the BC 88AC. A4 remains a driver-rendered sheet document; it is not sent as
ESC/POS. Existing browser printing is unchanged.

## Deployment and client verification

This is a source patch, not a published update. Build/sign a new candidate from
the reviewed commit using the release runbook; do not overwrite the published
1.9.0 assets or patch the installed archive. Preserve the existing printer
names, ports and local shop data.

On the affected till, first inspect any pending jobs. Once their outcomes are
known, test one identifiable receipt using Receipt/Thermal, confirming items,
total and cut on physical paper. Test A4 only with an appropriate sheet printer.
If a job's acceptance is uncertain, inspect the queue and paper before another
attempt. Do not reset the spooler or replay real orders automatically.
