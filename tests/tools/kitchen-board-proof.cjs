'use strict';
// Isolated sample-only page proof. Never connects to the POS API or shop data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-kitchen-board-'));
app.setPath('userData', path.join(output, 'profile'));
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      show: false,
      useContentSize: true,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    win.removeMenu();
    await win.loadFile(path.resolve(__dirname, '../../api/src/kitchen-board/index.html'), {
      query: { demo: '1' },
    });
    for (const [name, width, height] of [
      ['landscape', 1440, 900],
      ['portrait', 800, 1280],
      ['tablet', 1024, 768],
    ]) {
      win.setContentSize(width, height);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const metrics = await win.webContents.executeJavaScript(
        `({cards:document.querySelectorAll('.ticket').length,scroll:document.documentElement.scrollWidth,view:innerWidth,columns:getComputedStyle(document.querySelector('main')).gridTemplateColumns})`,
      );
      assert.equal(metrics.cards, 4);
      assert.ok(metrics.scroll <= metrics.view, `${name} horizontal overflow`);
      fs.writeFileSync(
        path.join(output, name + '.png'),
        (await win.webContents.capturePage()).toPNG(),
      );
      console.log(name, JSON.stringify(metrics));
    }
    await win.webContents.executeJavaScript("document.querySelector('#new button').click()");
    assert.equal(
      await win.webContents.executeJavaScript(
        "document.querySelectorAll('#preparing .ticket').length",
      ),
      2,
    );
    console.log('PASS: layout sizes and real Chromium action. Screenshots:', output);
    if (process.argv.includes('--show')) {
      win.setContentSize(1280, 850);
      win.show();
    } else app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
