const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(
  path.join(__dirname, "../src/splash.js"),
  "utf8",
);
function render({ cached, seed, entry = "showSplash" } = {}) {
  const module = { exports: {} };
  const cacheFile = path.join("/profile", "brand", "brand.json");
  const seedFile = path.join("/resources", "brand-seed", "brand.json");
  const files = new Map([
    [cacheFile, cached],
    [seedFile, seed],
  ]);
  const fakeFs = {
    existsSync: () => false,
    readFileSync(file) {
      const data = files.get(file);
      if (data === undefined) throw new Error("missing");
      return typeof data === "string" ? data : JSON.stringify(data);
    },
  };
  vm.runInNewContext(source, {
    module,
    __dirname: "/application/src",
    process: { resourcesPath: "/resources" },
    console,
    require: (id) => (id === "fs" ? fakeFs : require(id)),
  });
  let options, html;
  class BrowserWindow {
    constructor(value) {
      options = value;
      this.webContents = { isLoading: () => true, once() {} };
    }
    center() {}
    loadURL(url) {
      html = decodeURIComponent(url.split(",").slice(1).join(","));
    }
    once() {}
  }
  module.exports[entry]({
    BrowserWindow,
    app: { isPackaged: true, getPath: () => "/profile" },
  });
  return { options, html };
}
for (const entry of ["showSplash", "showShutdown", "showWaitingForPrevious"]) {
  test(`${entry} uses the installer brand before first-launch seeding`, () => {
    const result = render({
      seed: { enabled: true, name: "Example Stores" },
      entry,
    });
    assert.equal(result.options.title, "Example Stores");
    assert.match(result.html, /<h1>Example Stores<\/h1>/);
    assert.doesNotMatch(result.html, /<h1>Posnic<\/h1>/);
  });
}
test("saved cloud branding takes precedence; a newer installer replaces an old seed", () => {
  const seed = { enabled: true, name: "New Brand" };
  assert.equal(
    render({ seed, cached: { enabled: true, name: "Cloud Brand", version: 2 } })
      .options.title,
    "Cloud Brand",
  );
  assert.equal(
    render({
      seed,
      cached: { enabled: true, name: "Old Brand", version: "seed-old" },
    }).options.title,
    "New Brand",
  );
  assert.equal(
    render({ seed, cached: { enabled: false, version: 3 } }).options.title,
    "Posnic",
  );
});
test("missing or corrupt descriptors do not prevent ordinary startup", () => {
  assert.equal(render().options.title, "Posnic");
  assert.equal(
    render({ seed: "{broken", cached: "{broken" }).options.title,
    "Posnic",
  );
});
test("brand names are rendered as text, not HTML", () => {
  const result = render({
    seed: { enabled: true, name: "Shop <img src=x> & Co" },
  });
  assert.match(result.html, /Shop &lt;img src=x&gt; &amp; Co/);
  assert.doesNotMatch(result.html, /<img src=x>/);
});
