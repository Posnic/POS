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
  w.PosnicPro.get = (_params, callback) => callback({type:'success', data: w.periodOptions || {restaurant_enabled:true, serving_periods:[]} });
  const core = fs.readFileSync('frontend/static/script/js/core/PosnicPro.js', 'utf8');
  w.eval(core.slice(core.indexOf('PosnicPro.mountServingPeriodFilter = function')));
  w.$('#dailysale_branch_value').append(w.$('<option>').val('branch-a').text('A')).val('branch-a');
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
test("meal dropdown sets the request window and selected state", () => {
  const { w, $, r, calls } = setup();
  w.periodOptions = {
    restaurant_enabled: true,
    serving_periods: [
      {
        id: "lunch",
        name: "Lunch",
        hours: { mon: [{ open: 750, close: 930 }] },
      },
    ],
  };
  r.loadPeriods();
  $('#daily-serving-period').val('lunch').trigger('change');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    serving_period: "lunch",
  });
  assert.equal($('#daily-serving-period').val(), 'lunch');
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
  w.periodOptions = {
    restaurant_enabled: true,
    serving_periods: [
      {
        id: "brunch",
        name: "Weekend brunch",
        hours: { sun: [{ open: 600, close: 840 }] },
      },
      { id: "tea", name: "Tea" },
    ],
  };
  r.loadPeriods();
  assert.equal($('#daily-serving-period option[value=breakfast]').length, 0);
  assert.equal($('#daily-serving-period option[value=brunch]').text(), 'Weekend brunch');
  assert.equal($('#daily-serving-period option[value=tea]').prop('disabled'), true);
  w.close();
});
