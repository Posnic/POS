"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");

test("extension page transports idempotent commands and closes access when branch or page changes", async () => {
  const server = http.createServer((req, res) =>
    res.end(
      "<!doctype html>" +
        fs.readFileSync(
          path.resolve(__dirname, "../frontend/modules/extensions.html"),
          "utf8",
        ),
    ),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/#/extensions`);
    await page.evaluate(() => {
      window.$ = () => ({ hide() {}, show() {} });
      window.branch = "first-shop";
      window.requests = [];
      window.PosnicPro = {
        HideSideBarModal() {},
        local: { get: () => window.branch },
        receiptDesigner: {
          printSale: async (document, format, preview, options) => {
            window.lastPrint = { document, options };
            return { success: true };
          },
        },
        request(params, done) {
          window.requests.push(params);
          if (params.url.endsWith("/view"))
            done({
              displayName: "Basket Review",
              view: {
                html: '<output id="ready">Connected</output>',
                css: "",
                script: "",
              },
            });
          else if (params.url.endsWith("/capabilities"))
            done({ actor: { userId: "Staff" } });
          else if (params.url.endsWith("/state"))
            done({ revision: 1, state: {} });
          else if (params.url.endsWith("/receipt"))
            done(
              JSON.parse(params.data).saleId
                ? { kind: "paid", saleId: "a".repeat(24) }
                : {
                    kind: "pending",
                    document: { pending_goods_receipt: true, items_total: 2 },
                  },
            );
          else if (params.url.startsWith("sales/"))
            done({ type: "success", data: { sales_id: "INV-1" } });
          else if (params.url === "extensions/v1")
            done({
              extensions: [
                {
                  id: "posnic.example",
                  displayName: "<script>Example</script>",
                  version: "1.0.0",
                },
              ],
            });
          else done({ result: { saved: true } });
        },
      };
      window.PosnicExtensionFrame = {
        mount(options) {
          window.bridge = options.request;
          options.container.textContent = options.title;
          return {
            destroy() {
              window.destroyed = true;
            },
          };
        },
      };
    });
    await page.addScriptTag({
      path: path.resolve(
        __dirname,
        "../frontend/static/script/js/modules/js/extensions.js",
      ),
    });
    await page.evaluate(() => PosnicPro.extensions.showDataTablePage());
    assert.equal(
      await page.locator("#extensions_content a").innerText(),
      "<script>Example</script> · 1.0.0",
    );
    assert.equal(await page.locator("#extensions_content script").count(), 0);
    await page.evaluate(() =>
      PosnicPro.extensions.showDetails("posnic.example"),
    );
    const bootstrap = await page.evaluate(() => window.bridge("bootstrap", {}));
    assert.equal(bootstrap.namespace.revision, 1);
    await page.evaluate(() =>
      window.bridge("receipt", { adjustmentId: "basket-1" }),
    );
    assert.deepEqual(await page.evaluate(() => window.lastPrint), {
      document: { pending_goods_receipt: true, items_total: 2 },
      options: { preserveWorkspace: true, propagateFailure: true },
    });
    await page.evaluate(() =>
      window.bridge("receipt", { saleId: "a".repeat(24) }),
    );
    assert.equal(
      await page.evaluate(() => window.lastPrint.document.sales_id),
      "INV-1",
    );
    await page.evaluate(() =>
      window.bridge("command", {
        expectedRevision: 1,
        command: { type: "basket.create" },
        requestKey: "saved-operation-0001",
        actor: "Impersonation",
      }),
    );
    const command = await page.evaluate(() => requests.at(-1));
    assert.equal(command.url, "extensions/v1/posnic.example/commands");
    assert.equal(command.idempotencyKey, "saved-operation-0001");
    assert.deepEqual(JSON.parse(command.data), {
      expectedRevision: 1,
      command: { type: "basket.create" },
    });
    await page.evaluate(() => {
      window.branch = "second-shop";
    });
    assert.match(
      await page.evaluate(async () => {
        try {
          await bridge("command", {});
        } catch (error) {
          return error.message;
        }
      }),
      /shop or page changed/,
    );
    assert.equal(await page.evaluate(() => requests.at(-1).url), command.url);
    await page.evaluate(() => {
      location.hash = "/dashboard";
    });
    await page.waitForFunction(() => window.destroyed);
    assert.match(
      await page.evaluate(async () => {
        try {
          await bridge("state", {});
        } catch (error) {
          return error.message;
        }
      }),
      /shop or page changed/,
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
