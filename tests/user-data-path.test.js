"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { configure, clearUpgradeReview } = require("../src/user-data-path");

test("custom data path isolates desktop state before startup without changing the default", () => {
  const paths = new Map();
  const app = { setPath: (key, value) => paths.set(key, value) };
  assert.equal(configure(app, {}), false);
  assert.equal(paths.size, 0);
  assert.throws(
    () => configure(app, { POSNIC_USER_DATA: "./relative-shop" }),
    /absolute/,
  );
  assert.equal(paths.size, 0);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "posnic-user-data-"));
  try {
    const directory = path.join(root, "isolated-shop");
    assert.equal(configure(app, { POSNIC_USER_DATA: directory }), true);
    assert.equal(paths.get("userData"), directory);
    assert.equal(paths.get("sessionData"), path.join(directory, "session"));
    assert.ok(fs.statSync(paths.get("sessionData")).isDirectory());
    const marker = path.join(directory, "existing-data");
    fs.writeFileSync(marker, "preserved");
    configure(app, { POSNIC_USER_DATA: directory });
    assert.equal(fs.readFileSync(marker, "utf8"), "preserved");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("manual upgrade clears stale setup review only for a confirmed existing shop", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "posnic-upgrade-"));
  try {
    const marker = path.join(root, ".setup-review");
    const retained = {
      "shop-profiles.json": '{"active":"original","shops":[{"id":"original","name":"Existing shop"}]}',
      "preferences.json": '{"printer":"POS-80C"}',
      "posnic-cloud.json": '{"example":"keep-existing-connection"}',
      "existing-database": "existing sales and stock",
    };
    for (const [name, value] of Object.entries(retained)) fs.writeFileSync(path.join(root, name), value);
    fs.writeFileSync(marker, "manual-install");
    for (const needsWizard of [true, undefined, null]) {
      clearUpgradeReview(root, needsWizard);
      assert.equal(fs.readFileSync(marker, "utf8"), "manual-install");
    }
    clearUpgradeReview(root, false);
    assert.equal(fs.existsSync(marker), false);
    clearUpgradeReview(root, false);
    for (const [name, value] of Object.entries(retained)) assert.equal(fs.readFileSync(path.join(root, name), "utf8"), value);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("installer does not request fresh setup and existing-shop marker clears before sync starts", () => {
  const installer = fs.readFileSync(path.join(__dirname, "../builds/installer.nsh"), "utf8");
  assert.doesNotMatch(installer, /FileOpen[^\r\n]*\.setup-review/);
  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  const clear = main.indexOf("clearUpgradeReview(app.getPath('userData'), result.needsWizard)");
  const sync = main.indexOf("if (!fs.existsSync(path.join(app.getPath('userData'), '.setup-review'))) Promise.resolve(syncAgentManager.start())");
  assert.ok(clear > 0 && sync > clear);
});
