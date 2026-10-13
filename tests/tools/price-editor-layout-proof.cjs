const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const puppeteer = require("../../api/node_modules/puppeteer");
const root = path.resolve(__dirname, "../..");
const out =
  process.env.PRICE_PROOF_DIR || path.join(root, "output/price-editor-proof");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end("<html><body></body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const html = fs.readFileSync(
      path.join(root, "frontend/modules/priceSettings.html"),
      "utf8",
    );
    for (const [width, height, dark] of [
      [1366, 900, false],
      [1366, 900, true],
      [768, 900, false],
      [390, 844, false],
    ]) {
      await page.setViewport({ width, height });
      await page.setContent(html);
      await page.evaluate((dark) => {
        document.documentElement.setAttribute(
          "data-theme",
          dark ? "dark" : "github",
        );
        document.body.setAttribute("data-theme", dark ? "dark" : "github");
      }, dark);
      for (const file of [
        "bootstrap.min.css",
        "style.css",
        "theme-variables.css",
      ])
        await page.addStyleTag({
          path: path.join(root, "frontend/static/style/css", file),
        });
      await page.addStyleTag({
        content:
          ".page_loader{display:block!important}.contentbar{padding:20px!important}.breadcrumbbar{padding:16px 20px!important}.card-body{padding:20px!important}body{margin:0!important}#containerbar{margin:0!important}",
      });
      if (dark)
        await page.addStyleTag({
          content:
            ":root{--theme-card-bg:#252930;--theme-body-bg:#191d24;--theme-text-primary:#f1f4f9;--theme-text-secondary:#e0e6ef;--theme-text-muted:#b6c1d2;--theme-border-color:#455166;--theme-table-header-bg:#303741}",
        });
      await page.addScriptTag({ path: require.resolve("jquery") });
      await page.evaluate(() => {
        const items = Array.from({ length: 50 }, (_, i) => ({
          _id: String(i + 1).padStart(24, "0"),
          name: [
            "AARVI",
            "ALPHONSO",
            "ALSANA",
            "AMLA",
            "APPLE",
            "ASH GOURD",
            "ATTA 2KG",
            "B GRAPES",
          ][i % 8],
          itemid: String(i + 1).padStart(3, "0"),
          unit: "kg",
          selling_price: 100 + i,
          company_price: 70,
          mrp_price: 150,
        }));
        window.PosnicPro = {
          local: {
            get: (k) =>
              k === "branch_id_set" ? "aaaaaaaaaaaaaaaaaaaaaaaa" : "owner",
          },
          alert() {},
          pricesettings: { showDataTablePage() {} },
          get(r, done) {
            const q = new URLSearchParams(r.data);
            done({
              type: "success",
              data: {
                page: 1,
                total: 167,
                items: items.slice(0, Number(q.get("pageSize")) || 50),
              },
            });
          },
          post(r, done) {
            const b = JSON.parse(r.data);
            window.priceCalls = (window.priceCalls || []).concat(b);
            done({
              type: "success",
              data:
                b.action === "finish"
                  ? {
                      job: {
                        _id: b.jobId,
                        name: "Price grid",
                        status: "review",
                      },
                      counts: { pending: 1, unchanged: 166 },
                      rows: [
                        {
                          number: 1,
                          name: "AARVI",
                          changes: { selling_price: { old: 100, value: 110 } },
                          status: "pending",
                        },
                      ],
                      page: 1,
                      total: 1,
                    }
                  : { _id: b.jobId },
            });
          },
        };
      });
      await page.addScriptTag({
        path: path.join(
          root,
          "frontend/static/script/js/modules/js/price-editor.js",
        ),
      });
      await page.evaluate(() => PosnicPro.pricesettings.gridLoad(1));
      await page.$eval('[data-price-field="selling_price"]', (el) => {
        el.value = "110";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const before = await page.evaluate(() => window.scrollY);
      await page.click("[onclick*=\"sheetOpen('download')\"]");
      const geometry = await page.evaluate(() => {
        const d = document.querySelector("#ps-sheet");
        const r = d.getBoundingClientRect();
        return {
          open: d.open,
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          scroll: scrollY,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.equal(geometry.open, true);
      assert.equal(geometry.scroll, before);
      assert.ok(
        geometry.top >= 0 &&
          geometry.bottom <= height &&
          geometry.left >= 0 &&
          geometry.right <= width,
      );
      assert.equal(geometry.overflow, false);
      assert.equal(
        await page.$eval("#ps-sheet", (d) =>
          d.contains(document.activeElement),
        ),
        true,
      );
      if (width === 1366)
        await page.screenshot({
          path: path.join(out, `download-${dark ? "dark" : "light"}.png`),
        });
      await page.keyboard.press("Escape");
      assert.equal(await page.$eval("#ps-sheet", (d) => d.open), false);
      if (width === 1366 && !dark)
        await page.screenshot({ path: path.join(out, "price-grid.png") });
      await page.click("#ps-grid-review");
      await page.waitForFunction(
        () => document.querySelector("#ps-sheet").open,
      );
      assert.equal(
        await page.$eval('[aria-label="Review status"]', (el) => el.value),
        "changes",
      );
      assert.equal(
        await page.$$eval("#ps-job-view tbody tr", (rows) => rows.length),
        1,
      );
      if (width === 1366 && !dark)
        await page.screenshot({ path: path.join(out, "review-changes.png") });
      await page.evaluate(async () => {
        PosnicPro.post = (request, done) => {
          const b = JSON.parse(request.data);
          done({
            type: "success",
            data: {
              job: { _id: b.jobId, name: "prices.xlsx", status: "complete" },
              counts: { updated: 1, unchanged: 166 },
              rows: [
                {
                  number: 1,
                  name: "AARVI",
                  status: "updated",
                  changes: { selling_price: { old: 100, value: 110 } },
                },
              ],
              page: 1,
              total: 1,
              processed: [
                {
                  id: "000000000000000000000001",
                  changes: { selling_price: { old: 100, value: 110 } },
                },
              ],
            },
          });
        };
        await PosnicPro.pricesettings.sheetProcess(
          document.querySelector("#ps-job-view .btn-primary"),
          false,
        );
      });
      assert.equal(
        await page.$eval("#ps-update-result", (el) => el.textContent),
        "Prices updated successfully.",
      );
      if (width === 1366)
        await page.screenshot({
          path: path.join(
            out,
            `price-update-success-${dark ? "dark" : "light"}.png`,
          ),
        });
    }
    console.log(
      "PASS: dialog viewport bounds, no page jump, focus, Escape, changed-only review and responsive layout at desktop, tablet and phone sizes; light and dark themes.",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
