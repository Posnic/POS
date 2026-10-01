"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { hardenPrintWindow } = require("./print-window-guard");

// Use the actual desktop designer, not a second implementation of its layout.
async function documentFor(data, paper, baseUrl) {
  const { app, BrowserWindow } = require("electron");
  const root = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..");
  const win = hardenPrintWindow(
    new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    }),
  );
  let timer;
  try {
    return await Promise.race([
      (async () => {
        await win.loadURL(
          "data:text/html;charset=utf-8," +
            encodeURIComponent(
              '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
            ),
        );
        if (baseUrl && /^https?:\/\//i.test(baseUrl))
          await win.webContents.executeJavaScript(
            `{ const base = document.createElement('base'); base.href = ${JSON.stringify(new URL("../", baseUrl.replace(/\/$/, "") + "/").href)}; document.head.appendChild(base); } void 0;`,
          );
        await win.webContents.executeJavaScript(`window.PosnicPro = {
        escapeHtml: value => { const node = document.createElement('span'); node.textContent = value == null ? '' : String(value); return node.innerHTML; },
        local: { get: () => '' }, i18n: { t: (_key, fallback) => fallback }
      }; void 0;`);
        for (const file of [
          "frontend/static/script/js/jquery.min.js",
          "frontend/static/script/js/jquery-barcode.min.js",
          "api/src/helpers/receipt-design.js",
          "frontend/static/script/js/core/receipt-designer.js",
        ]) {
          await win.webContents.executeJavaScript(
            fs.readFileSync(path.join(root, file), "utf8") + "\n;void 0;",
          );
        }
        return await win.webContents.executeJavaScript(`(() => {
        const data = ${JSON.stringify(data)};
        if (!data.receipt_designs) data.receipt_designs = PosnicPro.receiptDesigner.defaults(data);
        return PosnicPro.receiptDesigner.render(data, ${JSON.stringify(paper)}, true);
      })()`);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error("Bill design rendering timed out; nothing submitted"),
            ),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}

async function renderBill(data, paper, baseUrl) {
  const html = await documentFor(data, paper, baseUrl);
  return require("./escpos-unicode").renderDesignedReceipt(html, paper);
}
module.exports = { documentFor, renderBill };
