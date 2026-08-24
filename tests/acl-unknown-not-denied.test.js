const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { blockAt, stripComments } = require('./helpers/source-lookup');

/*
 * An unloaded permission list must not look like a withheld one.
 *
 * Owner report: "cashbook page no option to add or edit expenses." The button
 * was not hidden by a rule - it was DELETED from the page because the rules
 * had not arrived.
 *
 * PosnicPro.userACL starts as an empty string and becomes an object when
 * users/getUserAccessDetails answers. Until then every lookup missed,
 * checkAccess said no to everything, and ACLApply removed each control from
 * the DOM. To a shopkeeper that is indistinguishable from a feature their plan
 * does not include, and there is nothing on screen to argue with.
 */

const ROOT = path.join(__dirname, '..');
const src = stripComments(
  fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js'),
    'utf8',
  ),
);

/* The real predicate, lifted out. */
const aclLoaded = (() => {
  const fn = blockAt(src, 'aclLoaded: function ()');
  // eslint-disable-next-line no-new-func
  return new Function(
    'PosnicPro',
    'return (' + fn.replace('aclLoaded: function ()', 'function ()') + ')',
  );
})();

const loadedWith = (acl) => aclLoaded({ userACL: acl })();

test('an ACL that never loaded is not treated as loaded', () => {
  /* The initial value is a string, and `'' [module]` misses silently. */
  assert.strictEqual(loadedWith(''), false);
  assert.strictEqual(loadedWith(null), false);
  assert.strictEqual(loadedWith(undefined), false);
  assert.strictEqual(loadedWith({}), false, 'an empty object is not a permission list');
});

test('a real permission list counts as loaded', () => {
  assert.strictEqual(loadedWith({ expense: { read: true, write: true } }), true);
});

test('a list that genuinely denies everything still counts as loaded', () => {
  /*
   * The distinction that matters. This user really has no access and the
   * controls SHOULD go - which is only possible because "denied" and "not yet
   * known" are now different states.
   */
  assert.strictEqual(loadedWith({ expense: { read: false, write: false } }), true);
});

test('nothing is removed while the list is unknown', () => {
  const fn = blockAt(src, 'ACLApply: function (element)');
  const guard = fn.indexOf('aclLoaded()');
  const remove = fn.indexOf('.remove()');
  assert.notStrictEqual(guard, -1, 'ACLApply does not check whether the ACL loaded');
  assert.ok(guard < remove, 'the guard comes after the removal, which is no guard at all');
});

test('the guard returns rather than falling through', () => {
  const fn = blockAt(src, 'ACLApply: function (element)');
  assert.match(fn, /if \(!PosnicPro\.aclLoaded\(\)\) \{ return; \}/);
});

test('boot does not throw when the permission call fails', () => {
  /*
   * redirectPage reads userACL.dashboard.read directly. On an empty ACL that
   * throws, during boot - so one failed request took the whole dashboard down
   * rather than one button.
   */
  const fn = blockAt(src, 'redirectPage: function ()');
  const at = fn.indexOf('aclLoaded()');
  assert.notStrictEqual(at, -1, 'redirectPage does not guard an unloaded ACL');
  assert.ok(at < fn.indexOf('.dashboard.read'), 'the guard comes after the throw');
});

test('the server is still the authority', () => {
  /*
   * This makes the CLIENT permissive when it does not know. That is only safe
   * because every one of these operations is checked again server-side - the
   * controllers gate on req.user.access - so the worst case is a button that
   * answers "unauthorised".
   */
  const controller = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'controllers', 'items.controller.js'),
    'utf8',
  );
  assert.match(controller, /req\.user\?\.access\?\.item\?\.(write|delete|read) === false/);
});
