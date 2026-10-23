"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const read = (name) => fs.readFileSync(name, "utf8");
const settings = read("frontend/static/script/js/modules/js/settings.js");
function fixture() {
  const dom = new JSDOM(
    '<div id="one"><section class="india-only" hidden><input value="saved@bank"></section></div><div id="two"><section class="india-only" hidden></section></div>',
    { runScripts: "outside-only" },
  );
  const w = dom.window;
  w.eval(read("frontend/static/script/js/jquery.min.js"));
  const begin = settings.indexOf("    applyCountryFields: function");
  const end = settings.indexOf("    applyTaxProfile:", begin);
  w.eval("window.gates = ({" + settings.slice(begin, end) + "});");
  return { dom, w };
}
test("India fields follow the edited branch, preserve saved values and never leak across forms", () => {
  const { dom, w } = fixture();
  const first = w.document.querySelector("#one section");
  for (const country of ["India", "IN", "ind"]) {
    w.gates.applyCountryFields(country, "#one");
    assert.equal(first.hidden, false);
    assert.notEqual(first.style.display, "none");
  }
  for (const country of [
    "Hong Kong",
    "HK",
    "United Kingdom",
    "GB",
    "",
    undefined,
  ]) {
    w.gates.applyCountryFields(country, "#one");
    assert.equal(first.hidden, true, String(country));
    assert.equal(first.querySelector("input").value, "saved@bank");
  }
  w.gates.applyCountryFields("India", "#two");
  assert.equal(first.hidden, true);
  assert.equal(w.document.querySelector("#two section").hidden, false);
  dom.window.close();
});
test("UPI configuration and receipt HSN option start hidden before branch data arrives", () => {
  for (const [file, selector] of [
    ["branchEdit.html", "#branch_upi_id"],
    ["settings_write.html", "#payment_upi_id"],
    ["settings_write.html", "#bill_print_hsn"],
  ]) {
    const dom = new JSDOM(read("frontend/modules/" + file));
    assert.equal(
      dom.window.document.querySelector(selector).closest(".india-only").hidden,
      true,
      file + selector,
    );
    dom.window.close();
  }
});
test("legacy HSN gate refreshes after country load without hiding ordinary tax", () => {
  const dom = new JSDOM(
    '<div class="card"><div class="custom-control" hidden><input id="item_tax_hsncode" name="hsntax_radio_value" type="radio" checked></div><input id="item_tax_default" name="hsntax_radio_value" type="radio"><div id="hsn_code_show"></div><input id="hsn_tax"><div id="default_tax"></div></div>',
    { runScripts: "outside-only" },
  );
  const w = dom.window;
  w.eval(read("frontend/static/script/js/jquery.min.js"));
  let country = "India";
  w.PosnicPro = {
    local: { get: (key) => (key === "country_setting" ? country : "{}") },
  };
  const source = read("frontend/static/script/js/modules/js/items.js");
  w.eval(source.slice(0, source.indexOf("PosnicPro.items =")));
  const start = source.indexOf("    applyTaxGate: function");
  const end = source.indexOf("    /* The weight-scale", start);
  w.eval("window.gates=({" + source.slice(start, end) + "});");
  w.gates.applyTaxGate();
  assert.equal(w.document.querySelector(".custom-control").hidden, false);
  country = "United Kingdom";
  w.gates.applyTaxGate();
  assert.equal(w.document.querySelector(".custom-control").hidden, true);
  assert.equal(w.document.querySelector("#item_tax_default").checked, true);
  assert.notEqual(w.document.querySelector(".card").style.display, "none");
  assert.notEqual(
    w.document.querySelector("#default_tax").style.display,
    "none",
  );
  dom.window.close();
});

test("Indian GST cannot be activated by a saved flag outside India", () => {
  const { dom, w } = fixture();
  const start = settings.indexOf("    indianGstEnabled: function");
  const end = settings.indexOf("    applyCountryFields:", start);
  w.eval("window.taxGate=({" + settings.slice(start, end) + "});");
  for (const country of [
    "India",
    "IN",
    "ind",
    "Hong Kong",
    "HK",
    "GB",
    "United Kingdom",
    "Australia",
    "",
    undefined,
  ]) {
    assert.equal(
      w.taxGate.indianGstEnabled(country, "gst_on"),
      ["India", "IN", "ind"].includes(country),
    );
    assert.equal(w.taxGate.indianGstEnabled(country, "gst_off"), false);
  }
  dom.window.close();
});
test("changing branch country preserves a VAT or other saved tax number", () => {
  const { dom, w } = fixture();
  w.document.body.innerHTML =
    '<select id="setting_country"><option>India</option><option>United Kingdom</option></select><input id="branch_gstin_number" value="GB123456789">';
  const calls = [];
  w.PosnicPro = { settings: { applyTaxProfile: (c) => calls.push(c) } };
  const start = settings.indexOf(
    '    $("#setting_country").change(function () {',
  );
  const end = settings.indexOf("\n    });", start) + 8;
  w.eval(settings.slice(start, end));
  w.jQuery("#setting_country").val("United Kingdom").trigger("change");
  assert.equal(
    w.document.querySelector("#branch_gstin_number").value,
    "GB123456789",
  );
  assert.deepEqual(calls, ["United Kingdom"]);
  dom.window.close();
});
test("FSSAI setup and customer GST advice are country-gated before settings load", () => {
  const dom = new JSDOM(read("frontend/modules/settings_write.html"));
  for (const selector of [
    "#bill_print_fssai",
    "#branch_fssai_number",
    ".lang_customer_gstin_always_prints",
  ]) {
    assert.equal(
      dom.window.document.querySelector(selector).closest(".india-only").hidden,
      true,
      selector,
    );
  }
  dom.window.close();
});

test("US resale fields require the US, not just a sales-tax regime", () => {
  const { dom, w } = fixture();
  w.document.body.innerHTML =
    '<select id="tax_regime_override"><option value=""></option></select><span id="tax_system_summary"></span><div id="tax_system_india"></div><div id="tax_system_us"></div>';
  const start = settings.indexOf("    taxSystemRegimeChanged: function");
  const end = settings.indexOf("    taxSystemSave:", start);
  w.eval("window.PosnicPro={settings:({" + settings.slice(start, end) + "})};");
  for (const [country, code, shown] of [
    ["United States", "US", true],
    ["United Kingdom", "GB", false],
    ["Canada", "CA", false],
    ["Hong Kong", "_default", false],
  ]) {
    w.PosnicPro.settings._taxSystem = { country, code, regime: "sales_tax" };
    w.PosnicPro.settings.taxSystemRegimeChanged();
    assert.equal(
      w.jQuery("#tax_system_us").css("display") !== "none",
      shown,
      country,
    );
  }
  dom.window.close();
});

test("the Money report tabs do not offer Indian GST readiness abroad", () => {
  const { dom, w } = fixture();
  w.document.body.innerHTML =
    '<div class="page_loader"><div class="breadcrumbbar"><div class="row"></div></div></div>';
  w.location.hash = "#/taxreport";
  w.jQuery.expr.pseudos.visible = () => true;
  const core = read("frontend/static/script/js/core/PosnicPro.js");
  const start = core.indexOf("    injectReportGroupTabs: function");
  const end = core.indexOf("    applyModuleSidebar:", start);
  let country = "Hong Kong";
  w.eval("window.PosnicPro=({" + core.slice(start, end) + "});");
  const P = w.PosnicPro;
  P.local = { get: (k) => (k === "country_setting" ? country : "{}") };
  P.REPORT_GROUPS = [
    {
      name: "Money",
      items: [
        { hash: "taxreport", label: "Tax" },
        { hash: "gstreadiness", label: "GST readiness", country: "IN" },
      ],
    },
  ];
  P.injectReportGroupTabs();
  assert.equal(
    w.document.querySelectorAll('a[href="#/gstreadiness"]').length,
    0,
  );
  assert.equal(w.document.querySelectorAll('a[href="#/taxreport"]').length, 1);
  country = "India";
  P.injectReportGroupTabs();
  assert.equal(
    w.document.querySelectorAll('a[href="#/gstreadiness"]').length,
    1,
  );
  dom.window.close();
});

test('direct Indian report URLs are country-gated before loading report code', () => {
  const vm=require('node:vm');
  const source=read('frontend/static/script/js/routes.js').split('$(document).ready')[0];
  for(const country of ['India','IN','Hong Kong','United Kingdom','Australia','']) {
    for(const module of ['gstrOne','gstrTwo','gstrTwob','gstrThree','gstrNine','gstreadiness','taxsummaryreport']) {
      let opened=0;const redirects=[];
      const P={local:{get:()=>country},[module]:{}};
      const ctx={PosnicPro:P,hasher:{setHash:x=>redirects.push(x)},console};
      vm.runInNewContext(source,ctx);
      ctx.withModule(module,()=>opened++);
      const allowed=['India','IN'].includes(country)||module==='taxsummaryreport';
      assert.equal(opened,allowed?1:0,country+module);
      assert.deepEqual(redirects,allowed?[]:['taxsummaryreport']);
    }
  }
});
