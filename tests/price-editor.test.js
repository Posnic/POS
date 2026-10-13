const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const jquery = require("jquery");
const html = fs.readFileSync(
  path.join(__dirname, "../frontend/modules/priceSettings.html"),
  "utf8",
);
const source = fs.readFileSync(
  path.join(
    __dirname,
    "../frontend/static/script/js/modules/js/price-editor.js",
  ),
  "utf8",
);
async function fixture() {
  const dom = new JSDOM(html, {
    url: "https://test.example",
    runScripts: "outside-only",
  });
  const w = dom.window,
    $ = jquery(w),
    calls = [],
    queries = [];
  const ids = ["123456789012345678901234", "123456789012345678901235"];
  let branch = "aaaaaaaaaaaaaaaaaaaaaaaa";
  w.$ = $;
  w.confirm = () => true;
  w.HTMLElement.prototype.scrollIntoView = () => {
    throw new Error("Must not scroll the page");
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.PosnicPro = {
    pricesettings: { showDataTablePage() {} },
    local: { get: (k) => (k === "branch_id_set" ? branch : "owner") },
    alert() {},
    get: (r, done) => {
      const q = new URLSearchParams(r.data);
      queries.push(q);
      const index = Number(q.get("page") || 1) - 1;
      done({
        type: "success",
        data: {
          page: index + 1,
          total: 101,
          items: [
            {
              _id: ids[index] || ids[0],
              name: index ? "Mushroom" : "Palak",
              itemid: "001",
              unit: "Kg",
              selling_price: 20,
              company_price: 10,
              mrp_price: 30,
            },
          ],
        },
      });
    },
    post: (r, done) => {
      const b = JSON.parse(r.data);
      calls.push(b);
      const job = {
        _id: b.jobId,
        name: "Price grid",
        status: b.action === "finish" ? "review" : "draft",
      };
      done({
        type: "success",
        data:
          b.action === "finish"
            ? { job, counts: { pending: 1 }, rows: [], page: 1, total: 1 }
            : job,
      });
    },
  };
  w.eval(source);
  await w.PosnicPro.pricesettings.gridLoad(1);
  return {
    w,
    $,
    p: w.PosnicPro.pricesettings,
    calls,
    queries,
    branch: (v) => {
      branch = v;
    },
    close: () => dom.window.close(),
  };
}
test("direct price edits survive pages and selected cost/MRP columns stage only edited fields", async () => {
  const f = await fixture();
  f.$('[data-price-field="selling_price"]').val("25").trigger("input");
  await f.p.gridLoad(2);
  await f.p.gridLoad(1);
  assert.equal(f.$('[data-price-field="selling_price"]').val(), "25");
  f.$("#ps-columns input").eq(3).prop("checked", true).trigger("change");
  f.$('[data-price-field="company_price"]').val("12").trigger("input");
  await f.p.gridReview();
  const row = f.calls.find((c) => c.action === "append").rows[0];
  assert.deepEqual(row.changes, {
    selling_price: { old: 20, value: "25" },
    company_price: { old: 10, value: "12" },
  });
  f.close();
});
test("page size reaches API and changing branch cannot carry an unsaved price into another branch", async () => {
  const f = await fixture();
  f.$('[data-price-field="selling_price"]').val("25").trigger("input");
  f.$("#ps-grid-size").val("100");
  await f.p.gridLoad(1);
  assert.equal(f.queries.at(-1).get("pageSize"), "100");
  f.branch("bbbbbbbbbbbbbbbbbbbbbbbb");
  await f.p.gridLoad(1);
  assert.equal(f.$('[data-price-field="selling_price"]').val(), "20.00");
  assert.equal(f.$("#ps-grid-count").text(), "0 items changed");
  f.close();
});
test("download has its own visible search/category controls and empty edits leave prices unchanged", async () => {
  const f = await fixture();
  f.p.sheetOpen("download");
  assert.equal(f.$("#ps-sheet-download").prop("hidden"), false);
  assert.equal(f.$("#ps-sheet-search").length, 1);
  f.$('[data-price-field="selling_price"]').val("").trigger("input");
  assert.equal(f.$("#ps-grid-count").text(), "0 items changed");
  f.close();
});

test("download and review use a dismissible dialog without scrolling the catalogue", async () => {
  const f = await fixture();
  f.p.sheetOpen("download");
  assert.equal(f.$("#ps-sheet")[0].open, true);
  f.p.sheetClose();
  assert.equal(f.$("#ps-sheet")[0].open, false);
  f.$('[data-price-field="selling_price"]').val("25").trigger("input");
  await f.p.gridReview();
  assert.equal(f.$("#ps-sheet")[0].open, true);
  assert.equal(f.$('[aria-label="Review status"]').val(), "changes");
  f.close();
});
test("explicit zero edits need confirmation and only changed fields are submitted", async () => {
  const f = await fixture();
  f.$('[data-price-field="selling_price"]').val("0").trigger("input");
  f.w.confirm = () => false;
  await f.p.gridReview();
  assert.equal(f.calls.length, 0);
  f.w.confirm = () => true;
  await f.p.gridReview();
  assert.equal(f.calls.find((c) => c.action === "create").allowZero, true);
  assert.deepEqual(f.calls.find((c) => c.action === "append").rows[0].changes, {
    selling_price: { old: 20, value: "0" },
  });
  f.close();
});
test("file picker uploads for review without applying and hides unchanged rows", async () => {
  const f = await fixture();
  f.p.sheetOpen("import");
  const file = new f.w.File(
    ["Branch ID,Item ID,New Selling price"],
    "prices.csv",
    { type: "text/csv" },
  );
  Object.defineProperty(f.$("#ps-sheet-file")[0], "files", { value: [file] });
  let sent;
  f.w.PosnicPro.request = (request, done) => {
    sent = request;
    done({
      type: "success",
      data: {
        job: {
          _id: "123456789012345678901234",
          name: "prices.csv",
          status: "review",
        },
        counts: { pending: 1, unchanged: 5 },
        page: 1,
        total: 1,
        rows: [
          {
            number: 2,
            name: "Palak",
            status: "pending",
            changes: { selling_price: { old: 20, value: 25 } },
          },
        ],
      },
    });
  };
  f.p.sheetImport(f.$("#ps-sheet-import button")[0]);
  assert.equal(sent.url, "items/priceSheetImport");
  assert.equal(sent.data.get("file").name, "prices.csv");
  assert.equal(sent.data.get("allowZero"), "false");
  assert.equal(f.$("#ps-sheet-import").prop("hidden"), true);
  assert.equal(f.$("#ps-job-view tbody tr").length, 1);
  assert.match(f.$("#ps-job-view tbody").text(), /20.00.*25.00/);
  assert.equal(
    f.calls.some((c) => c.action === "process"),
    false,
  );
  f.close();
});
test("confirmed direct updates clear applied drafts and refresh the selected result filter", async () => {
  const f = await fixture();
  f.$('[data-price-field="selling_price"]').val("25").trigger("input");
  await f.p.gridReview();
  const staged = f.calls.find((c) => c.action === "append").rows[0];
  f.w.PosnicPro.post = (request, done) => {
    const b = JSON.parse(request.data);
    f.calls.push(b);
    done({
      type: "success",
      data: {
        job: { _id: b.jobId, name: "Price grid", status: "complete" },
        counts: { updated: 1 },
        page: 1,
        total: 1,
        rows: [
          {
            number: 1,
            name: staged.name,
            status: "updated",
            changes: { selling_price: { old: 20, value: 25 } },
          },
        ],
        processed: [
          { id: staged.id, changes: { selling_price: { old: 20, value: 25 } } },
        ],
      },
    });
  };
  await f.p.sheetProcess(f.$("#ps-job-view button.btn-primary")[0], false);
  assert.equal(f.$("#ps-grid-count").text(), "0 items changed");
  assert.equal(f.calls.at(-1).filter, "changes");
  assert.match(f.$("#ps-job-view tbody").text(), /updated/);
  f.close();
});
