"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { configure } = require("../src/user-data-path");

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
