const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { JSDOM } = require("jsdom");
function setup() {
  const dom = new JSDOM(
    fs.readFileSync("frontend/modules/dailyReport.html", "utf8"),
    { runScripts: "outside-only", url: "http://localhost/" },
  );
  const w = dom.window;
  w.$ = w.jQuery = require("jquery")(w);
  w.$.fn.validate = function () {
    return this;
  };
  w.setTimeout = () => {};
  const calls = [];
  w.PosnicPro = { i18n: { t: (key, fallback) => fallback }, alert: (...a) => calls.push(a) };
  w.eval(
    fs.readFileSync(
      "frontend/static/script/js/modules/js/report_dailysales.js",
      "utf8",
    ),
  );
  w.PosnicPro.quickreport.salereportTable = () =>
    calls.push(w.PosnicPro.quickreport.periodParams());
  return { w, $: w.$, r: w.PosnicPro.quickreport, calls };
}
test("meal buttons set the request window and pressed state", () => {
  const { w, $, r, calls } = setup();
  r.renderPeriods({
    restaurant_enabled: true,
    serving_periods: [
      {
        id: "lunch",
        name: "Lunch",
        hours: { mon: [{ open: 750, close: 930 }] },
      },
    ],
  });
  $('#dailyreport_new [data-meal="period:lunch"]').trigger("click");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    serving_period: "lunch",
  });
  assert.equal($('[data-meal="period:lunch"]').attr("aria-pressed"), "true");
  assert.equal($('[data-meal="full"]').attr("aria-pressed"), "false");
  r.chooseMeal("full");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), {});
  w.close();
});
test("custom range waits for Apply and supports overnight hours", () => {
  const { w, $, r, calls } = setup();
  r.chooseMeal("custom");
  assert.equal(calls.length, 0);
  $("#daily-meal-from").val("22:00");
  $("#daily-meal-to").val("02:00");
  $("#daily-meal-apply").trigger("click");
  assert.equal(calls[0].end_time, "02:00");
  $("#daily-meal-to").val("22:00");
  assert.equal(r.periodParams(), null);
  w.close();
});
test("exports keep the applied period even after selecting custom", () => {
  const { w, r } = setup();
  r.lastReport = {
    from: "2026/10/01",
    to: "2026/10/01",
    period: "Lunch · 12:00–18:00 · Asia/Kolkata",
    branch: {},
  };
  w.PosnicPro.i18n = { t: (_, s) => s };
  r.chooseMeal("custom");
  assert.match(r._exportMeta().range, /Lunch/);
  w.close();
});

test("period controls are hidden for retail and reset previous selections", () => {
  const { w, $, r } = setup();
  r.meal = "lunch";
  r.renderPeriods({ restaurant_enabled: false });
  assert.equal($("#daily-meal-filter").css("display"), "none");
  assert.equal(r.meal, "full");
  w.close();
});
test("configured names and hours replace hardcoded breakfast timings", () => {
  const { w, $, r } = setup();
  r.renderPeriods({
    restaurant_enabled: true,
    serving_periods: [
      {
        id: "brunch",
        name: "Weekend brunch",
        hours: { sun: [{ open: 600, close: 840 }] },
      },
      { id: "tea", name: "Tea" },
    ],
  });
  assert.equal($('[data-meal="period:breakfast"]').length, 0);
  assert.match($('[data-meal="period:brunch"]').text(), /10:00–14:00/);
  assert.equal($('[data-meal="period:tea"]').prop("disabled"), true);
  w.close();
});
