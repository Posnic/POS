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
