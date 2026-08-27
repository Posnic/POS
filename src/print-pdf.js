'use strict';

/*
 * Send a PDF to a printer, whatever the machine is.
 *
 * pdf-to-printer bundles SumatraPDF-3.4.6-32.exe and has no platform branch of
 * its own - it is a Windows library wearing a cross-platform name. Calling it
 * on macOS or Linux fails, because there is no .exe to run.
 *
 * hardware-manager.js already knew that and used CUPS off Windows. kot-manager
 * did not: it called printPdf directly, so on a Mac or a Linux till every
 * kitchen ticket that fell back to PDF printing failed - caught and reported,
 * so nothing crashed and nothing printed. The build targets those platforms
 * (build:mac, build:linux), so that was a real hole rather than a theoretical
 * one.
 *
 * The fix is one function rather than the same branch written twice. This
 * codebase has already paid for the alternative: a helper that existed as five
 * copies, where each fix only ever landed in whichever copy bit that week.
 *
 * SumatraPDF is signed along with everything else in the Windows build. It is
 * third-party software we redistribute, and Windows checks the signature of
 * what actually runs - an unsigned helper launched by a signed application
 * still trips SmartScreen on a locked-down till.
 */

const { execFile } = require('child_process');

/*
 * Print `file` on `printer`, `copies` times.
 *
 * Rejects with a message a shopkeeper could act on. "ENOENT" tells somebody
 * standing at a counter nothing; "CUPS is not available on this computer" tells
 * them who to ask.
 */
async function printPdfFile(file, { printer, copies = 1 } = {}) {
  const count = Math.max(1, Number(copies) || 1);

  if (process.platform === 'win32') {
    /* Required lazily so a Mac or Linux build never loads a Windows-only
       library it will not use - and so a broken install of it cannot stop
       those platforms starting at all. */
    const { print: printPdf } = require('pdf-to-printer');
    const opts = { silent: true, copies: count, scale: 'fit' };
    if (printer) opts.printer = printer;
    await printPdf(file, opts);
    return;
  }

  const args = [];
  if (printer) args.push('-d', String(printer));
  args.push('-n', String(count), file);

  await new Promise((resolve, reject) => {
    execFile('lp', args, { timeout: 30000 }, (err) => {
      if (!err) return resolve();
      reject(
        err.code === 'ENOENT'
          ? new Error('CUPS printing is not available on this computer (the "lp" command is missing)')
          : err
      );
    });
  });
}

module.exports = { printPdfFile };
