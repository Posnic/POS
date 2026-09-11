/*
 * Two ways the app left somebody looking at a screen with no answer on it.
 *
 * Neither throws, neither shows in a log, and both are the kind of thing that
 * gets reported as "the app is confusing" rather than as a bug - which is why
 * they are pinned here in the shape a person would describe them.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/* ------------------------------------------------- where you are, in the menu */

test('the left menu is marked from the ROUTE, not from a click', () => {
  /*
   * The highlight was set in exactly one place: a shown.bs.tab handler that
   * fires when somebody clicks a pill. So it was right after a click and wrong
   * every other way a page is reached - a refresh, a bookmark, the back
   * button, a Features switch that routes you to the page it configures, or
   * any hasher.setHash() in the code.
   *
   * parseHash is the one place every route change passes through, whatever
   * caused it. One rule, and no list of callers to keep up to date.
   */
  const routes = read('frontend/static/script/js/routes.js');
  assert.match(routes, /function markSidebar/, 'nothing marks the sidebar');
  assert.match(
    routes,
    /function parseHash[\s\S]{0,600}markSidebar\(/,
    'the sidebar is not marked on a route change'
  );
});

test('the mark is applied after the route, because a route may redirect', () => {
  /* A Features switch lands on #/settings/modules. Marking first would light
     the page nobody ended up on. */
  const routes = read('frontend/static/script/js/routes.js');
  const parse = /function parseHash\([\s\S]*?\n    \}/.exec(routes);
  assert.ok(parse, 'parseHash has changed shape');
  assert.ok(
    parse[0].indexOf('crossroads.parse') < parse[0].indexOf('markSidebar'),
    'the sidebar is marked before the route has run'
  );
});

test('a page below a section still lights the section', () => {
  /* #/settings/tableorder/tables has no menu entry of its own and belongs
     under Restaurant, so the longest matching prefix wins. */
  const routes = read('frontend/static/script/js/routes.js');
  assert.match(routes, /parts\.pop\(\)/, 'there is no fallback to the parent section');
});

test('marking the menu can never stop a page loading', () => {
  const routes = read('frontend/static/script/js/routes.js');
  assert.match(
    routes,
    /try \{\s*markSidebar\(newHash\);\s*\} catch/,
    'a failure in the highlight would take the route down with it'
  );
});

test('the mark does not navigate, so it cannot fight the user', () => {
  /* settings.js writes the hash back on shown.bs.tab. Driving a tab from a
     hash change and a hash from a tab change is a loop waiting to happen. */
  const routes = read('frontend/static/script/js/routes.js');
  const mark = /function markSidebar[\s\S]*?\n    \}/.exec(routes);
  assert.ok(mark, 'markSidebar has changed shape');
  assert.ok(!/setHash|replaceHash/.test(mark[0]), 'marking the sidebar changes the route');
});

test('"you are here" no longer looks the same as "your mouse is here"', () => {
  /*
   * `active` and `:hover` were styled identically - the same primary colour on
   * the same transparent background. On a settings screen, where every page
   * looks like every other settings page, that left the menu saying nothing at
   * the moment it was most needed.
   */
  const css = read('frontend/static/style/css/custom.css');
  assert.match(css, /\.vertical-menu > li > a\.active/, 'the active entry has no style of its own');
  assert.match(css, /a\.active::before/, 'there is no rail to separate active from hover');

  /* custom.css loads BEFORE theme-variables.css, so an override here loses to
     the theme unless it says so. That has bitten this file before. */
  const block = css.slice(css.indexOf('.vertical-menu > li > a.active'));
  assert.match(block, /!important/, 'the theme will win and the highlight will not show');
});

/* ------------------------------------------------- whether the shop has tables */

test('the handset is told whether this shop does table service at all', () => {
  /*
   * An empty floor plan means two completely different things: a restaurant
   * that has not typed its tables in yet, and a shop that does not seat
   * anybody. The handset could not tell them apart, so a waiter signing in at
   * a grocer got the same blank screen as one at a restaurant mid-setup - and
   * neither was told which.
   */
  const repo = read('api/src/repositories/item.repository.js');
  assert.match(
    repo,
    /table_service: branchDoc\.table_options === true/,
    'the storefront does not report whether table service is on'
  );

  const controller = read('api/src/controllers/items.controller.js');
  assert.match(
    controller,
    /table_service: data\.table_service === true/,
    'accessQr does not pass it on to the handset'
  );
});

test('it is the shop\'s own switch, not a guess from the table count', () => {
  /* Inferring it from `tableorders.length` is exactly the conflation this
     exists to end, and it would be wrong for every restaurant mid-setup. */
  const repo = read('api/src/repositories/item.repository.js');
  const line = /table_service:.*/.exec(repo);
  assert.ok(line, 'table_service is gone');
  assert.ok(!/tableorders\.length/.test(line[0]), 'table service is inferred from the table count');
});
