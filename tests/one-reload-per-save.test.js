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
