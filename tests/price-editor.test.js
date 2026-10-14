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
test("Edit code targets the clicked branch, independently of the selected active branch", async () => {
  const f = await fixture();
  const branches = [
    { id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "Althino", code: "ALT" },
    { id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Admin", code: "ADM" },
    { id: "cccccccccccccccccccccccc", name: "Market", code: "MKT" },
  ];
  f.w.PosnicPro.post = (r, done) => {
    const body = JSON.parse(r.data);
    f.calls.push(body);
    if (body.action === "branchCode") {
      assert.equal(Object.hasOwn(body, "branchId"), false);
      branches.find((b) => b.id === body.targetBranchId).code = body.code;
    }
    done({ type: "success", data: body.action === "branches" ? branches : {} });
  };
  f.p.showDataTablePage();
  await new Promise((r) => setTimeout(r, 0));
  for (const [index, branch] of branches.entries()) {
    const code = "CODE" + index;
    f.w.prompt = (message, current) => {
      assert.ok(message.includes(branch.name));
      assert.equal(current, branch.code);
      return code;
    };
    f.$(".ps-branch-row button").eq(index).trigger("click");
    await new Promise((r) => setTimeout(r, 0));
    const change = f.calls.filter((b) => b.action === "branchCode").at(-1);
    assert.equal(change.targetBranchId, branch.id);
    assert.ok(f.$(".ps-branch-row label").eq(index).text().includes(code));
    assert.equal(f.$("#ps-branches input:checked").val(), branches[1].id);
  }
  f.close();
});
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

test("download stays in the file workflow and review opens a separate screen", async () => {
  const f = await fixture();
  f.p.sheetOpen("download");
  assert.equal(f.$("#ps-sheet")[0].open, false);
  assert.equal(f.$("#ps-file-download #ps-sheet-download").length, 1);
  f.p.sheetClose();
  assert.equal(f.$("#ps-sheet")[0].open, false);
  f.$('[data-price-field="selling_price"]').val("25").trigger("input");
  await f.p.gridReview();
  assert.equal(f.$("#ps-sheet")[0].open, true);
  assert.equal(f.$("#ps-direct-panel").prop("hidden"), true);
  assert.equal(f.$("#ps-sheet").hasClass("ps-review-screen"), true);
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
  assert.deepEqual(
    f
      .$("#ps-when option")
      .map((_, e) => e.value)
      .get(),
    ["now", "tomorrow", "custom"],
  );
  f.w.PosnicPro.post = (r, done) => {
    const b = JSON.parse(r.data);
    f.calls.push(b);
    done({
      type: "success",
      data: {
        job: { _id: "123456789012345678901234", status: "scheduled" },
        counts: { pending: 1 },
        rows: [],
        page: 1,
        total: 1,
      },
    });
  };
  f.$("#ps-when").val("tomorrow").trigger("change");
  f.$("#ps-note").val("Diwali offer");
  await f.p.sheetProcess(
    f.$("#ps-job-view button.btn-primary")[0],
    false,
    "review",
  );
  assert.equal(f.calls.find((c) => c.action === "configure").when, "tomorrow");
  assert.equal(
    f.calls.find((c) => c.action === "configure").note,
    "Diwali offer",
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
  assert.equal(f.$("#ps-update-result").hasClass("ps-update-success"), true);
  assert.equal(f.$("#ps-update-result").text(), "Prices updated successfully.");
  f.close();
});

for (const [name, status, counts, style, message] of [
  [
    "partial update",
    "complete",
    { updated: 1, conflict: 1 },
    "ps-update-warning",
    "Some items need attention",
  ],
  [
    "unchanged sheet",
    "complete",
    { unchanged: 10 },
    "ps-update-neutral",
    "No prices were changed",
  ],
  ["review", "review", { pending: 1 }, null, null],
  ["in progress", "running", { updated: 1, pending: 1 }, null, null],
])
  test("completion feedback for " + name, async () => {
    const f = await fixture();
    f.w.PosnicPro.post = (request, done) =>
      done({
        type: "success",
        data: {
          job: { _id: "123456789012345678901234", name: "prices.xlsx", status },
          counts,
          rows: [],
          page: 1,
          total: 0,
        },
      });
    await f.p.sheetJob("123456789012345678901234");
    if (style) {
      assert.equal(f.$("#ps-update-result").hasClass(style), true);
      assert.ok(f.$("#ps-update-result").text().includes(message));
    } else assert.equal(f.$("#ps-update-result").length, 0);
    f.close();
  });

test("editing methods are separate and switching preserves direct drafts", async () => {
  const f = await fixture();
  f.$('[data-price-field="selling_price"]').val("25").trigger("input");
  f.p.editMode("file");
  assert.equal(f.$("#ps-direct-panel").prop("hidden"), true);
  assert.equal(f.$("#ps-file-panel").prop("hidden"), false);
  assert.equal(f.$("#ps-file-tab").attr("aria-selected"), "true");
  assert.equal(f.$('#ps-direct-panel button[onclick*="sheetOpen"]').length, 0);
  assert.equal(
    f.$('#ps-file-panel button[onclick*="sheetDownload"]').length,
    1,
  );
  assert.equal(f.$('#ps-file-panel button[onclick*="sheetImport"]').length, 1);
  f.p.editMode("direct");
  assert.equal(f.$('[data-price-field="selling_price"]').val(), "25");
  f.close();
});
test("multiple categories reach the grid and file filters stay independent", async () => {
  const f = await fixture();
  const cats = [
    { id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Fruit" },
    { id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "Vegetables" },
  ];
  f.p.setPriceCategories(cats);
  f.$("#ps-grid-category input").prop("checked", true);
  await f.p.gridLoad(1);
  assert.equal(
    f.queries.at(-1).get("category"),
    cats.map((c) => c.id).join(","),
  );
  f.p.sheetOpen("download");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(f.queries.at(-1).get("category"), "");
  f.$("#ps-sheet-category input").prop("checked", true);
  f.p.categoriesChanged("ps-sheet-category");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(
    f.queries.at(-1).get("category"),
    cats.map((c) => c.id).join(","),
  );
  f.p.clearPriceFilters("sheet");
  assert.equal(f.$("#ps-grid-category input:checked").length, 2);
  assert.equal(f.$("#ps-sheet-category input:checked").length, 0);
  f.close();
});
test("empty filters explain the result and prevent an empty download", async () => {
  const f = await fixture();
  f.w.PosnicPro.get = (r, done) =>
    done({ type: "success", data: { page: 1, total: 0, items: [] } });
  await f.p.gridLoad(1);
  assert.equal(f.$("#ps-grid-empty").prop("hidden"), false);
  assert.match(f.$("#ps-grid-empty").text(), /No products match/);
  assert.equal(f.$("#ps-direct-panel .ps-grid-scroll").prop("hidden"), true);
  f.p.sheetOpen("download");
  await new Promise((r) => setTimeout(r, 300));
  assert.match(f.$("#ps-sheet-count").text(), /No products match/);
  assert.equal(f.$("#ps-sheet-prepare").prop("disabled"), true);
  assert.equal(f.$("#ps-sheet-clear").prop("hidden"), false);
  f.close();
});

test("file is first and default; three tabs isolate schedules and support keyboard navigation", async () => {
  const f = await fixture();
  assert.deepEqual(
    f
      .$('.ps-edit-tabs [role="tab"]')
      .map((_, e) => e.id)
      .get(),
    ["ps-file-tab", "ps-direct-tab", "ps-schedules-tab"],
  );
  assert.equal(f.$("#ps-file-panel").prop("hidden"), false);
  assert.equal(f.$("#ps-direct-panel").prop("hidden"), true);
  f.w.PosnicPro.post = (r, done) =>
    done({
      type: "success",
      data: { jobs: [], page: 1, pageSize: 10, total: 0 },
    });
  f.p.editModeKey({ key: "End", preventDefault() {} });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(f.$("#ps-schedules-panel").prop("hidden"), false);
  assert.equal(f.$("#ps-file-panel").prop("hidden"), true);
  assert.equal(f.$("#ps-branches").prop("hidden"), true);
  assert.equal(f.w.document.activeElement.id, "ps-schedules-tab");
  assert.match(f.$("#ps-sheet-history").text(), /No upcoming updates/);
  f.p.editModeKey({ key: "Home", preventDefault() {} });
  assert.equal(f.$("#ps-file-panel").prop("hidden"), false);
  f.$('#ps-sheet-fields input[value="company_price"]').prop("checked", true);
  f.p.editMode("direct");
  f.p.editMode("file");
  assert.equal(
    f.$('#ps-sheet-fields input[value="company_price"]').prop("checked"),
    true,
  );
  f.close();
});
test("schedule views paginate, preserve notes, cancel with revision and exclude edit actions from completed", async () => {
  const f = await fixture(),
    requests = [];
  f.w.PosnicPro.post = (r, done) => {
    const b = JSON.parse(r.data);
    requests.push(b);
    done({
      type: "success",
      data:
        b.action === "list"
          ? {
              jobs: [
                {
                  _id: "123456789012345678901234",
                  note: "Diwali offer",
                  status: b.status === "complete" ? "complete" : "scheduled",
                  revision: 7,
                  effectiveAt: "2026-11-01T00:00:00Z",
                },
              ],
              page: b.page,
              pageSize: b.pageSize,
              total: 26,
            }
          : {},
    });
  };
  f.p.editMode("schedules");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(requests[0].status, "upcoming");
  assert.match(f.$("#ps-sheet-history").text(), /Diwali offer/);
  f.$("#ps-sheet-history .ps-pager button").last().trigger("click");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(requests.at(-1).page, 2);
  f.$("#ps-sheet-history .ps-job-actions button").last().trigger("click");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(requests.find((r) => r.action === "cancel").revision, 7);
  f.$("#ps-jobs-size").val("25");
  f.p.scheduleFilter("complete");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(requests.at(-1).page, 1);
  assert.equal(requests.at(-1).pageSize, 25);
  assert.deepEqual(
    f
      .$(".ps-job-actions button")
      .map((_, e) => e.textContent)
      .get(),
    ["View"],
  );
  assert.equal(
    f.$('[data-job-status="complete"]').attr("aria-pressed"),
    "true",
  );
  f.close();
});

test("category menus close outside and on Escape, but retain multi-select choices", async () => {
  const f = await fixture();
  f.p.setPriceCategories([{ id: "fruit", name: "Fruit" }]);
  const picker = f.$("#ps-sheet-category");
  picker.prop("open", true);
  picker.find("input").trigger("click");
  assert.equal(picker.prop("open"), true);
  assert.equal(picker.find("input").prop("checked"), true);
  f.$("#ps-sheet-search").trigger("click");
  assert.equal(picker.prop("open"), false);
  picker.prop("open", true);
  picker.find("summary").trigger("focus");
  picker.trigger(f.$.Event("keydown", { key: "Escape" }));
  assert.equal(picker.prop("open"), false);
  assert.equal(picker.find("input").prop("checked"), true);
  f.close();
});

test("file filters show immediate progress near controls and ignore outdated counts", async () => {
  const f = await fixture(), responses = [];
  f.w.PosnicPro.get = (_r, done, fail) => responses.push({ done, fail });
  f.p.sheetCount();
  assert.match(f.$("#ps-sheet-count").text(), /Updating/);
  assert.equal(f.$("#ps-sheet-prepare").prop("disabled"), true);
  await new Promise(r => setTimeout(r, 300));
  f.$("#ps-sheet-search").val("apple");
  f.p.sheetCount();
  responses[0].done({ type: "success", data: { total: 30 } });
  assert.match(f.$("#ps-sheet-count").text(), /Updating/);
  await new Promise(r => setTimeout(r, 300));
  responses[1].done({ type: "success", data: { total: 1 } });
  assert.equal(f.$("#ps-sheet-count").text(), "1 matching item across all pages");
  assert.equal(f.$("#ps-sheet-count").attr("aria-busy"), "false");
  assert.equal(f.$("#ps-sheet-prepare").prop("disabled"), false);
  assert.equal(f.$("#ps-sheet-count").prev().find("#ps-sheet-category").length, 1);
  f.p.sheetCount();
  await new Promise(r => setTimeout(r, 300));
  responses[2].fail();
  assert.match(f.$("#ps-sheet-count").text(), /Could not count/);
  assert.equal(f.$("#ps-sheet-prepare").prop("disabled"), true);
  f.close();
});
