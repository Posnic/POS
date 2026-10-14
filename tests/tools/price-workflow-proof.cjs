const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const puppeteer = require("../../api/node_modules/puppeteer"),
  root = path.resolve(__dirname, "../..");
const out =
  process.env.PRICE_PROOF_DIR || path.join(root, "output/price-workflow");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => res.end("<html></html>"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for (const [width, dark, multi] of [
      [1366, false, false],
      [1366, true, true],
      [768, false, true],
      [390, false, false],
    ]) {
      await page.setViewport({ width, height: 950 });
      await page.setContent(
        fs.readFileSync(
          path.join(root, "frontend/modules/priceSettings.html"),
          "utf8",
        ),
      );
      await page.evaluate((dark) => {
        document.documentElement.dataset.theme = document.body.dataset.theme =
          dark ? "dark" : "github";
      }, dark);
      for (const f of ["bootstrap.min.css", "style.css", "theme-variables.css"])
        await page.addStyleTag({
          path: path.join(root, "frontend/static/style/css", f),
        });
      await page.addStyleTag({
        content:
          ".page_loader{display:block!important}.contentbar,.card-body,.breadcrumbbar{padding:16px!important}body,#containerbar{margin:0!important}",
      });
      if (dark)
        await page.addStyleTag({
          content:
            ":root{--theme-card-bg:#252930;--theme-body-bg:#191d24;--theme-text-primary:#f1f4f9;--theme-text-secondary:#e0e6ef;--theme-border-color:#455166}",
        });
      await page.addScriptTag({ path: require.resolve("jquery") });
      await page.evaluate((multi) => {
        const branch = "aaaaaaaaaaaaaaaaaaaaaaaa";
        const branches = [
          {
            id: branch,
            code: "ABC",
            name: "Main store",
            timezone: "Asia/Kolkata",
          },
          ...(multi
            ? [
                {
                  id: "bbbbbbbbbbbbbbbbbbbbbbbb",
                  code: "MKT",
                  name: "Market store",
                  timezone: "Asia/Kolkata",
                },
              ]
            : []),
        ];
        window.testJob = {
          _id: "123456789012345678901234",
          status: "review",
          name: "GSHCL-Vegetables-2026-10-14-1900.xlsx",
          branchIds: [branch],
        };
        const review = () => ({
          job: testJob,
          counts: { pending: 1, unchanged: 11 },
          rows: [
            {
              number: 1,
              itemId: "000000000000000000000001",
              branch_id: branch,
              name: "AARVI",
              status: "pending",
              changes: { selling_price: { old: 107, value: 110 } },
            },
          ],
          page: 1,
          total: 1,
        });
        window.confirm = () => true;
        window.PosnicPro = {
          i18n: { t: (k, f) => f },
          local: { get: (k) => (k === "branch_id_set" ? branch : "owner") },
          alert() {},
          pricesettings: { showDataTablePage() {} },
          get(r, done) {
            done({
              type: "success",
              data: {
                page: 1,
                total: 12,
                items: Array.from({ length: 8 }, (_, i) => ({
                  _id: String(i + 1).padStart(24, "0"),
                  branch_id: branch,
                  name: ["AARVI", "ALPHONSO", "APPLE", "BEANS"][i % 4],
                  itemid: String(i + 21),
                  unit: "kg",
                  selling_price: 107,
                  company_price: 80,
                  mrp_price: 120,
                })),
              },
            });
          },
          post(r, done) {
            const b = JSON.parse(r.data);
            let data = { _id: b.jobId };
            if (b.action === "branches") data = branches;
            if (["finish", "status"].includes(b.action)) data = review();
            if (b.action === "configure") {
              window.testJob = {
                ...testJob,
                status: "scheduled",
                effectiveAt: "2026-10-14T18:30:00Z",
                note: b.note,
              };
              data = review();
            }
            if (b.action === "list")
              data = { jobs: [testJob], page: 1, pageSize: 10, total: 1 };
            done({ type: "success", data });
          },
        };
      }, multi);
      await page.addScriptTag({
        path: path.join(
          root,
          "frontend/static/script/js/modules/js/price-editor.js",
        ),
      });
      await page.evaluate(() => {
        PosnicPro.pricesettings.showDataTablePage();
        PosnicPro.pricesettings.setPriceCategories([
          { id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Vegetables" },
          { id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "Fruits" },
        ]);
      });
      await page.waitForSelector('[data-price-field="selling_price"]');
      assert.equal(
        await page.$eval("#ps-file-tab", (e) =>
          e.getAttribute("aria-selected"),
        ),
        "true",
      );
      assert.equal(await page.$eval("#ps-direct-panel", (e) => e.hidden), true);
      assert.equal(await page.$eval("#ps-branches", (e) => e.hidden), !multi);
      await page.$eval('[data-price-field="selling_price"]', (e) => {
        e.value = "110";
        e.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.click("#ps-file-tab");
      assert.equal(await page.$eval("#ps-sheet", (e) => e.open), false);
      assert.equal(
        await page.$eval(
          "#ps-file-download",
          (e) => !!e.querySelector("#ps-sheet-prepare"),
        ),
        true,
      );
      assert.equal(
        await page.$eval(
          "#ps-file-upload",
          (e) => !!e.querySelector("#ps-sheet-file"),
        ),
        true,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.waitForFunction(
        () => !document.querySelector("#ps-sheet-prepare").disabled,
      );
      await page.screenshot({
        path: path.join(out, `file-${width}-${dark ? "dark" : "light"}.png`),
        fullPage: true,
      });
      await page.click("#ps-direct-tab");
      await page.click("#ps-grid-review");
      await page.waitForSelector("#ps-sheet.ps-review-screen[open]");
      assert.equal(await page.$eval("#ps-direct-panel", (e) => e.hidden), true);
      await page.select("#ps-when", "tomorrow");
      await page.type("#ps-note", "Diwali offer");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: path.join(out, `review-${width}-${dark ? "dark" : "light"}.png`),
        fullPage: true,
      });
      await page.click("#ps-job-view button.btn-primary");
      await page.waitForFunction(() =>
        $("#ps-job-view").text().includes("Price update scheduled"),
      );
      await page.click("#ps-sheet .ps-dialog-header button");
      await page.click("#ps-schedules-tab");
      await page.waitForSelector("#ps-sheet-history table");
      assert.equal(await page.$eval("#ps-file-panel", (e) => e.hidden), true);
      assert.equal(await page.$eval("#ps-branches", (e) => e.hidden), true);
      await page.screenshot({
        path: path.join(
          out,
          `schedules-${width}-${dark ? "dark" : "light"}.png`,
        ),
        fullPage: true,
      });
      assert.equal(
        await page.$eval("#ps-sheet-history", (e) =>
          e.textContent.includes("Diwali offer"),
        ),
        true,
      );
      assert.equal(
        await page.$eval("#ps-sheet-history", (e) =>
          e.textContent.includes(".xlsx"),
        ),
        false,
      );
      await page.evaluate(() =>
        [...document.querySelectorAll(".ps-job-actions button")]
          .find((e) => e.textContent === "Edit")
          .click(),
      );
      await page.waitForFunction(() => document.activeElement.id === "ps-when");
      assert.equal(
        await page.$eval("#ps-schedules-panel", (e) => e.hidden),
        true,
      );
      await page.click("#ps-sheet .ps-dialog-header button");
      await page.waitForSelector("#ps-sheet-history table");
      assert.equal(
        await page.$eval("#ps-schedules-panel", (e) => e.hidden),
        false,
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS: single/multiple branches; file steps; separate review; scheduling and notes; hidden list filename; light/dark 1366/768/390px",
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
