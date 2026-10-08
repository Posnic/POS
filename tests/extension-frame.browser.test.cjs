"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");

test("signed presentation is isolated from host DOM, network and arbitrary gateway methods", async () => {
  const server = http.createServer((req, res) =>
    res.end('<!doctype html><div id="secret">Host session</div><main></main>'),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addScriptTag({
      path: path.resolve(
        __dirname,
        "../frontend/static/script/js/core/extension-frame.js",
      ),
    });
    await page.evaluate(() => {
      window.calls = [];
      window.mounted = PosnicExtensionFrame.mount({
        container: document.querySelector("main"),
        extensionId: "posnic.example",
        title: "Example extension",
        view: {
          html: '<h1>Extension</h1><output id="result"></output>',
          css: "body { font-family: sans-serif }",
          script: `
            const checks = {};
            try { window.parent.document.querySelector('#secret'); checks.parentBlocked = false; }
            catch { checks.parentBlocked = true; }
            try { localStorage.setItem('token', 'x'); checks.storageBlocked = false; }
            catch { checks.storageBlocked = true; }
            window.addEventListener('message', async event => {
              if (event.source !== window.parent || event.data.type !== 'posnic-extension-connect') return;
              const port = event.ports[0];
              port.onmessage = event => {
                checks[event.data.id] = event.data;
                document.querySelector('#result').textContent = JSON.stringify(checks);
              };
              port.start();
              port.postMessage({ id: 'bootstrap', method: 'bootstrap' });
              port.postMessage({ id: 'forbidden', method: 'fetch', input: { url: '/api/users' } });
              port.postMessage({ id: 'command', method: 'command', input: { command: { type: 'basket.create' } } });
              try { await fetch('http://127.0.0.1:1/private'); checks.networkBlocked = false; }
              catch { checks.networkBlocked = true; }
              document.querySelector('#result').textContent = JSON.stringify(checks);
            });`,
        },
        request: async (method, input) => {
          window.calls.push({ method, input });
          return { actor: "Staff", revision: 1 };
        },
      });
    });
    const frame = page.frameLocator("iframe");
    await frame
      .locator("#result")
      .filter({ hasText: "networkBlocked" })
      .waitFor();
    await frame.locator("#result").filter({ hasText: "forbidden" }).waitFor();
    const result = JSON.parse(await frame.locator("#result").innerText());
    assert.equal(result.parentBlocked, true);
    assert.equal(result.storageBlocked, true);
    assert.equal(result.networkBlocked, true);
    assert.equal(result.bootstrap.ok, true);
    assert.equal(result.command.ok, true);
    assert.equal(result.forbidden.ok, false);
    assert.deepEqual(
      (await page.evaluate(() => window.calls)).map((call) => call.method),
      ["bootstrap", "command"],
    );
    assert.equal(
      await page.locator("iframe").getAttribute("sandbox"),
      "allow-scripts",
    );
    await page.evaluate(() => window.mounted.destroy());
    assert.equal(await page.locator("iframe").count(), 0);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
