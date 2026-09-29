# Blank receipt investigation

Reported against 1.8.0: Windows test page and designer sample print, but an actual
sale feeds a short blank strip and cuts. The customer's exact receipt, runtime
logs and printer driver have not been captured, so the customer-specific root
cause remains unconfirmed.

## Reproduced defects

- A real Electron window resolves `loadURL` successfully for an empty HTTP 404
  response. The previous local print-document loader only recovered from thrown
  load errors. It did not verify that the receipt was present before submission.
- The original hidden-window readiness code waits for two animation frames.
  The full hidden-window proof stalled at this step. Readiness now uses document
  loading and bounded asset decoding rather than animation callbacks.

## Changes

`src/hardware-manager.js` verifies the loaded document before submitting a job.
If the local route returns an empty or incorrect designed receipt, it loads the
original HTML and verifies it again. Recovery occurs before printing, so this
does not submit a second job. Failed and completed hidden windows are destroyed.

`src/receipt-page-layout.js` waits up to five seconds for fonts/images and checks
for printable content and the expected receipt element. Truly blank documents
are never submitted. Optional broken images do not block receipt text.

## Verification

68 focused Node tests passed across receipt designs, paper layout, print settings,
document storage and print-window confinement. After the readiness change, the
34 settings/layout/storage/confinement tests passed again.

`tests/tools/receipt-document-proof.cjs` runs the actual printHTML method and
readiness helper inside Electron, replacing only printer submission. Its four
cases pass: empty 404 recovery, wrong-document recovery, normal receipt, and
blank-document rejection. Each successful case submits exactly once, contains
the sale identifier and total, and generates a PDF through Chromium. Blank
input submits zero times. All windows are cleaned up.

Run using Electron, with `ELECTRON_RUN_AS_NODE` unset. The optional first argument
is a JSON results path; the default is the OS temp directory. No physical print
jobs are produced. No CI workflow was added.

These changes are in source only, not released. A client test with the failing
sale is still required; these tests do not prove physical output on that printer.
