/*
 * Confining the hidden windows that render things for the printer.
 *
 * Printing a receipt or a kitchen ticket means loading HTML into an offscreen
 * BrowserWindow and calling print() on it. Those windows are short-lived and
 * never seen, which is exactly why they are easy to forget: they are real
 * Chromium windows with a real network stack, built from a string that came
 * from a page.
 *
 * They already cannot reach IPC - ipc-guard refuses any frame whose origin is
 * not one of the application's own pages, and a data: URL is not one. What they
 * could still do is open another window, or navigate somewhere and keep
 * running. Neither is ever wanted while rendering a receipt, so both are
 * refused here.
 *
 * This is deliberately not a network filter. Scoping one to a single window
 * needs a separate session partition, and the receipt path loads its stylesheet
 * and the shop's logo from the local API - a partition change risks breaking
 * printing to close a hole that requires an XSS in the till's own pages to
 * reach. The two rules below cost nothing and break nothing.
 */

/**
 * Refuse the two things a print window should never do.
 *
 * @param {import('electron').BrowserWindow} win an offscreen render-and-print window
 */
function hardenPrintWindow(win) {
  if (!win || win.isDestroyed?.()) return win;

  try {
    /* A receipt never opens a second window. window.open, target=_blank and
       anything else that would spawn one is refused rather than allowed and
       then closed, so nothing is ever created. */
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    /* Nor does it navigate. The document is loaded once, printed, and the
       window is destroyed - so any navigation is something the page decided to
       do on its own. */
    const stop = (event) => event.preventDefault();
    win.webContents.on('will-navigate', stop);
    /* Frames inside the document, which will-navigate does not cover. */
    if (typeof win.webContents.on === 'function') {
      win.webContents.on('will-frame-navigate', stop);
    }
  } catch (e) {
    /* Hardening must never be the reason a shop cannot print. */
    console.warn('[print] could not confine the print window:', e.message);
  }

  return win;
}

module.exports = { hardenPrintWindow };
