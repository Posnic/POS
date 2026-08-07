const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * Every PosnicPro.sales.* call must name something that exists.
 *
 * A helper was added to PosnicPro.sales.quantity and called as
 * PosnicPro.sales.formatQty - one missing word. Nothing caught it: the unit
 * tests pull the function out of the source text and call it directly, so they
 * exercise the arithmetic and never the name. The till loaded, the item grid
 * drew, and then adding any line to a sale threw
 * "PosnicPro.sales.formatQty is not a function" and the cart stopped working.
 *
 * The whole file is one long chain of object literals and late assignments, so
 * a mistyped path is invisible until the branch actually runs - and the branch
 * that broke was the one every sale goes through.
 *
 * This reads the file the browser loads and checks that each name called is a
 * name defined, on the object it is called on.
 */

const SOURCE = path.join(
  __dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'sales.js',
);
const source = fs.readFileSync(SOURCE, 'utf8');

/* The body of `PosnicPro.sales.quantity = { ... }`, found by matching braces. */
function quantityBlock() {
  const marker = 'PosnicPro.sales.quantity = {';
  const start = source.indexOf(marker);
  assert.notStrictEqual(start, -1, 'PosnicPro.sales.quantity block not found');

  let depth = 0;
  let i = start + marker.length - 1;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return { body: source.slice(start, i + 1), start, end: i + 1 };
}

/* Names defined as `foo: function` or `foo: value` at the top level of a block. */
function membersOf(body) {
  const names = new Set();
  const re = /^\s{4}([A-Za-z_$][\w$]*)\s*:/gm;
  let m;
  while ((m = re.exec(body)) !== null) names.add(m[1]);
  return names;
}

const quantity = quantityBlock();
const quantityMembers = membersOf(quantity.body);

/*
 * Names on PosnicPro.sales itself: the keys of its object literal, plus every
 * later `PosnicPro.sales.foo = ...` assignment. The literal is everything
 * outside the quantity block, which is why that block is cut out first.
 */
function salesMembers() {
  const outside = source.slice(0, quantity.start) + source.slice(quantity.end);
  const names = membersOf(outside);
  const re = /PosnicPro\.sales\.([A-Za-z_$][\w$]*)\s*=[^=]/g;
  let m;
  while ((m = re.exec(source)) !== null) names.add(m[1]);
  return names;
}

/*
 * Every call site, as (path, name) pairs.
 *
 * Commented-out lines are skipped. The file keeps a good deal of disabled
 * markup - an old tax-edit button among it - and a call that cannot run is not
 * a call that can break.
 */
function callSites() {
  const calls = [];
  const re = /PosnicPro\.sales\.(quantity\.)?([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const lineStart = source.lastIndexOf('\n', m.index) + 1;
    const before = source.slice(lineStart, m.index);
    if (before.includes('//')) continue;

    const line = source.slice(0, m.index).split('\n').length;
    calls.push({ onQuantity: Boolean(m[1]), name: m[2], line });
  }
  return calls;
}

test('every PosnicPro.sales.quantity.x call names a member of quantity', () => {
  const missing = callSites()
    .filter((c) => c.onQuantity && !quantityMembers.has(c.name))
    .map((c) => `sales.js:${c.line} calls quantity.${c.name}`);

  assert.deepStrictEqual(missing, [], missing.join('\n'));
});

test('every PosnicPro.sales.x call names a member of sales', () => {
  // This is the one that was broken: formatQty lives on quantity, and the cart
  // called it on sales. Named here so the failure says which line and which
  // object, not just "is not a function" in a browser somebody else is using.
  const members = salesMembers();
  const missing = callSites()
    .filter((c) => !c.onQuantity && !members.has(c.name))
    .map((c) => {
      const hint = quantityMembers.has(c.name)
        ? ` (it is on PosnicPro.sales.quantity - say quantity.${c.name})`
        : '';
      return `sales.js:${c.line} calls sales.${c.name}${hint}`;
    });

  assert.deepStrictEqual(missing, [], missing.join('\n'));
});

test('the quantity helpers are where the cart expects them', () => {
  // A direct statement of the arrangement, so moving one of these between the
  // two objects fails here rather than in a shop.
  for (const name of ['formatQty', 'stepFor', 'qtyIncreaseDecrease', 'textOnChange']) {
    assert.ok(quantityMembers.has(name), `${name} should be on PosnicPro.sales.quantity`);
  }
  assert.ok(salesMembers().has('isWeighedItem'),
    'isWeighedItem should be on PosnicPro.sales');
});
