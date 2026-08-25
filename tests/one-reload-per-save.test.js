'use strict';

/*
 * One save, one reload (the saves patch, list edition).
 *
 * Owner: "every close of pop up or every save of form, some refresh is
 * happening... i think its lazy coding." The list screens' save handlers
 * had a stacked idiom: call the table loader directly AND setHash back to
 * the list - and the hash navigation fires the route, which loads the
 * table again. Two identical network requests and two full re-renders
 * per save. The rule pinned here: a save triggers the reload through
 * EITHER the route (when it navigates) or the direct call (when it is
 * already on the list) - never both.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const js = (f) => fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', f), 'utf8');

test('users: edit reloads through route OR direct call, never both', () => {
  const src = js('users.js');
  const at = src.indexOf("window.location.hash === '#/users'");
  assert.ok(at > -1, 'the either/or guard is gone');
  assert.ok(!/usersTable\('users'\);\s*if \(PosnicPro\.action === 'edit'\)/.test(src),
    'the unconditional pre-branch reload is back');
});

test('expenses: same rule', () => {
  const src = js('expenses.js');
  assert.ok(src.includes("window.location.hash !== '#/expenses'"), 'the guard is gone');
  assert.ok(!/hasher\.setHash\('expenses'\);\s*\}\s*PosnicPro\.expenses\.expensesTable/.test(src),
    'the unconditional post-navigation reload is back');
});

test('categories: the direct load only fires for saves made on the list', () => {
  const src = js('categories.js');
  assert.match(src, /wasOnCategoryList = \(hash === '\/categories'\)/);
  assert.match(src, /if \(wasOnCategoryList\) \{\s*PosnicPro\.categories\.categoriesTable/);
  /* and the edit branch's duplicate navigation is gone - the shared
     setHash above it already navigates */
  const editBranch = src.slice(src.indexOf("if (PosnicPro.action === 'edit') {", src.indexOf('wasOnCategoryList')));
  assert.ok(!editBranch.slice(0, 400).includes("hasher.setHash('categories')"),
    'the edit branch re-navigates - that is the double load again');
});

test('a cancelled add panel closes silently - the list it floats over is not re-fetched', () => {
  /* The close handler's old comment claimed "set hash without dispatching
     changed signal" while dispatching every time: cancelling an empty add
     form re-loaded the whole list. Silence is allow-listed to the modules
     whose add form is an infobar OVER the list; a full-page form (items,
     receivings, sales) must never be listed - its route dispatch is the
     only way back to the list. */
  const core = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js'), 'utf8');
  const at = core.indexOf('PosnicPro.INFOBAR_LIST_ADDS = {');
  assert.ok(at > -1, 'the allow-list is gone');
  const list = core.slice(at, core.indexOf('};', at));
  for (const m of ['customers', 'suppliers', 'users', 'expenses', 'categories', 'customercategory', 'variants']) {
    assert.ok(list.includes(m + ':'), m + ' fell out of the silent-close list');
  }
  for (const never of ['items:', 'receivings:', 'sales:']) {
    assert.ok(!list.includes(never), never.slice(0, -1) + ' is a FULL-PAGE form - silencing strands the user');
  }
  /* the silent branch really is silent, and keeps currentHash honest */
  const branch = core.slice(core.indexOf("PosnicPro.INFOBAR_LIST_ADDS[parts[0]]"), core.indexOf("PosnicPro.INFOBAR_LIST_ADDS[parts[0]]") + 1400);
  assert.match(branch, /hasher\.changed\.active = false;\s*hasher\.setHash\(parts\[0\]\);\s*hasher\.changed\.active = true;\s*currentHash = parts\[0\];/);
  /* deep-link escape: a panel opened over a list that never loaded must
     still dispatch, or cancel strands the user on an empty page */
  assert.match(branch, /\$\('#view_' \+ parts\[0\]\)\.data\('total'\) !== undefined/);
});

test('closing a details panel is silent too - reading a record re-fetches nothing', () => {
  const core = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js'), 'utf8');
  const at = core.indexOf("typeof parts[2] === 'undefined'");
  assert.ok(at > -1, 'the details-silence branch is gone');
  const branch = core.slice(at, at + 900);
  /* pure details only: an edit route may be a full page (items), where the
     dispatch is the only way back to the list */
  assert.match(branch, /INFOBAR_LIST_ADDS\[parts\[0\]\] \|\| parts\[0\] === 'items'/);
  assert.match(branch, /data\('total'\) !== undefined/);
  assert.match(branch, /hasher\.changed\.active = false;/);
});
