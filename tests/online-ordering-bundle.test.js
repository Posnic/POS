"use strict";

/*
 * The shop's online ordering page, as the shop's own process serves it.
 *
 * Three things here are load-bearing and all three are invisible until a
 * customer hits them:
 *
 * 1. The bundle is mounted BEFORE the API router. That router is mounted at
 *    '/', so it sees every path; mount the bundle after it and `/order`
 *    stops being a page and starts being a 404 from the API.
 *
 * 2. Every page that talks to the API also loads the channel state. Miss one
 *    and that page shows a working cart for a shop that is closed.
 *
 * 3. The rules that hide the cart point at controls that exist. A stylesheet
 *    full of selectors matching nothing is the quietest possible failure:
 *    everything looks right, and the checkout button is still there.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const BUNDLE = path.join(ROOT, "order");
const APP_JS = path.join(ROOT, "api", "app.js");

const readBundle = (f) => fs.readFileSync(path.join(BUNDLE, f), "utf8");
const htmlPages = () =>
  fs.readdirSync(BUNDLE).filter((f) => f.endsWith(".html"));

test("the bundle is present with the pages a customer walks through", () => {
  for (const page of [
    "index.html",
    "home.html",
    "products.html",
    "cart.html",
    "payment.html",
  ]) {
    assert.ok(
      fs.existsSync(path.join(BUNDLE, page)),
      `order/${page} is missing`,
    );
  }
  assert.ok(fs.existsSync(path.join(BUNDLE, "config.js")));
  assert.ok(fs.existsSync(path.join(BUNDLE, "assets", "channel-state.js")));
  assert.ok(fs.existsSync(path.join(BUNDLE, "assets", "channel-state.css")));
});

test("/order and /menu are mounted before the root API router", () => {
  const src = fs.readFileSync(APP_JS, "utf8");

  const orderAt = src.indexOf("app.use('/order'");
  const menuAt = src.indexOf("app.use('/menu'");
  const rootApiAt = src.indexOf("app.use('/', apiRouter)");

  assert.ok(orderAt !== -1, "app.js does not mount '/order'");
  assert.ok(menuAt !== -1, "app.js does not mount '/menu'");
  assert.ok(
    rootApiAt !== -1,
    "the root API router mount moved; this test needs updating",
  );

  assert.ok(
    orderAt < rootApiAt,
    "'/order' is mounted after the root API router, so it will 404 instead of serving the page",
  );
  assert.ok(
    menuAt < rootApiAt,
    "'/menu' is mounted after the root API router, so it will 404 instead of serving the page",
  );
});

test("the bundle ships with the packaged desktop app", () => {
  /* A till serving the shop's own wifi gets online ordering for free, but only
     if the directory is actually packaged. electron-builder copies nothing it
     was not told about. */
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );
  const entry = (pkg.build.extraResources || []).find(
    (e) => e && e.from === "order",
  );
  assert.ok(
    entry,
    "package.json build.extraResources has no entry for the order bundle",
  );
  assert.strictEqual(entry.to, "order");
});

test("the API base is derived from the page origin, not hardcoded", () => {
  /*
   * The whole point of serving this from the shop's own host. A hardcoded
   * host is how one legacy backend came to serve every shop in the estate.
   */
  const config = readBundle("config.js");
  assert.match(
    config,
    /window\.location/,
    "config.js no longer reads the page location",
  );
  assert.match(
    config,
    /\.origin\b/,
    "config.js no longer derives the API base from the page origin",
  );

  /* The legacy host may still appear, but only as the named exception for
     codes already printed and stuck on tables. */
  const legacyMentions = (config.match(/api\.posnic\.io/g) || []).length;
  assert.ok(
    legacyMentions <= 1,
    "api.posnic.io should appear once, as the legacy fallback constant",
  );
  assert.match(
    config,
    /qr\.posnic\.io/,
    "the legacy kiosk host is no longer named",
  );
});

test("every page that reaches the API also loads the channel state", () => {
  /* config.js is what gives a page an API to call. A page that can call the
     API can show a cart, so it must also know whether the shop is open. */
  const missing = [];
  for (const page of htmlPages()) {
    const src = readBundle(page);
    if (!src.includes('src="config.js"')) continue;
    if (!src.includes("assets/channel-state.js")) missing.push(page);
  }
  assert.deepStrictEqual(
    missing,
    [],
    `pages load the API but not the channel state: ${missing}`,
  );
});

test("every control the browse-only rules hide actually exists", () => {
  /*
   * A dead selector hides nothing and says nothing. This walks the rules that
   * hide ordering controls and requires each one to name a class or id that
   * appears somewhere in the bundle - in the static markup, or in the
   * template strings that inject product cards.
   */
  const css = readBundle("assets/channel-state.css");
  const haystack = [
    ...htmlPages().map(readBundle),
    readBundle("indexedDB.js"),
    fs.readFileSync(
      path.join(BUNDLE, "assets", "products", "script.js"),
      "utf8",
    ),
  ].join("\n");

  const selectors = [
    ...css.matchAll(/html\.posnic-browse-only\s+([.#][A-Za-z0-9_-]+)/g),
  ].map((m) => m[1]);

  assert.ok(
    selectors.length >= 5,
    "the browse-only stylesheet stopped hiding things",
  );

  const dead = selectors.filter((sel) => {
    const name = sel.slice(1);
    const needle = sel.startsWith(".") ? `class="` : `id="`;
    /* Loose on purpose: class attributes hold several names, and the product
       card template builds them by concatenation. */
    return !(haystack.includes(name) && haystack.includes(needle));
  });

  assert.deepStrictEqual(
    dead,
    [],
    `browse-only rules match no markup: ${dead.join(", ")}`,
  );
});

test("every local asset a page asks for is in the bundle", () => {
  /*
   * The bundle is served under a subpath now (/order/, /menu/) rather than at
   * a host root, so every reference in it has to be relative. An absolute
   * "/assets/..." resolved fine on qr.posnic.io and resolves to the shop's
   * own app - not this bundle - under /order/, which is a broken page that
   * looks fine in a diff.
   *
   * So: no leading slash, and the file must exist.
   */
  const problems = [];

  for (const page of htmlPages()) {
    const src = readBundle(page);
    const refs = [...src.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );

    for (const ref of refs) {
      if (/^(https?:|data:|blob:|mailto:|#|javascript:)/i.test(ref)) continue;

      if (ref.startsWith("/")) {
        problems.push(
          `${page}: "${ref}" is absolute and will miss the bundle under /order/`,
        );
        continue;
      }

      /* Cache-busting query strings are part of the reference, not the path. */
      const file = ref.split("?")[0].split("#")[0];
      if (!file) continue;
      if (!fs.existsSync(path.join(BUNDLE, file))) {
        problems.push(`${page}: "${file}" does not exist in the bundle`);
      }
    }
  }

  assert.deepStrictEqual(problems, [], problems.join("\n"));
});

test("the order-only pages hand the customer back to the menu", () => {
  const js = readBundle("assets/channel-state.js");
  for (const page of ["cart.html", "payment.html", "home.html"]) {
    assert.ok(
      js.includes(`'${page}'`),
      `${page} is not treated as an order-only page`,
    );
  }
  assert.match(js, /location\.replace\('products\.html'\)/);
});

test("the page fails open, because the server is the control", () => {
  /*
   * With no verdict the page behaves as though ordering is on. Being wrong
   * that way costs one refused checkout with a clear message. Being wrong the
   * other way turns every shop into a menu whenever anything hiccups, and
   * nobody hears about the orders that were never placed.
   */
  const js = readBundle("assets/channel-state.js");
  assert.match(
    js,
    /accepting\s*!==\s*false/,
    "the channel state no longer treats an absent verdict as open",
  );
});
