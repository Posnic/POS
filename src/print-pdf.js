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

/* PDFs made by the invoice, quotation and report screens already have a page
   layout. Print those bytes with a printer chooser instead of turning them
   into a receipt or asking Electron to open a blocked browser popup. */
async function printPdfDocument(bytes, { parent } = {}) {
  const fs = require('fs');
  const path = require('path');
  const { randomUUID } = require('crypto');
  const { app, BrowserWindow } = require('electron');
  let file;
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 25 * 1024 * 1024) {
      throw new Error('Invalid PDF document');
    }
    const pdf = Buffer.from(bytes);
    if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('Invalid PDF document');
    }
    file = path.join(app.getPath('temp'), `posnic-document-${randomUUID()}.pdf`);
    fs.writeFileSync(file, pdf, { flag: 'wx', mode: 0o600 });
    if (process.platform === 'win32') {
      const { print } = require('pdf-to-printer');
      await print(file, { printDialog: true, scale: 'noscale' });
      // The native chooser can be cancelled; returning means it closed, not
      // that paper was confirmed. The frontend must not announce "printed".
      return { success: true };
    }
    return await new Promise((resolve) => {
      const win = new BrowserWindow({
        parent: parent || undefined, width: 900, height: 750, show: false,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false, contextIsolation: true, sandbox: true,
          webSecurity: true, plugins: true,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      const finish = (result) => {
        resolve(result);
        if (!win.isDestroyed()) win.destroy();
      };
      win.once('closed', () => resolve({ cancelled: true }));
      win.loadFile(file).then(() => {
        if (win.isDestroyed()) return;
        win.show();
        win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
          finish(success ? { success: true } : /cancel/i.test(reason || '')
            ? { cancelled: true } : { success: false, error: reason || 'Printing failed' });
        });
      }).catch((err) => finish({ success: false, error: err.message }));
    });
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    if (file) {
      try { fs.unlinkSync(file); } catch (_) { /* a driver may still hold it */ }
    }
  }
}

module.exports = { printPdfFile, printPdfDocument };
