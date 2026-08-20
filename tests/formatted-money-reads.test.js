const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * Never read a formatted money display as a number without stripping it.
 *
 * The till writes money into the page with the jQuery Number plugin -
 * `$('#sales_new_subtotal').number(v, 2)` - which inserts thousand separators.
 * Read that back with parseFloat and "1,459.00" becomes 1.
 *
 * That is not hypothetical. It shipped: the discount cap compared a Rs34
 * discount against a subtotal it had parsed as 1, measured it as 3400%, and
 * fired manager approval on every discounted bill over Rs1,000 (c57e23a). The
 * failure is silent - no error, no exception, just a number two orders of
 * magnitude wrong - which is exactly why it needs a guard rather than care.
 *
 * This test finds every element written via .number() and checks that every
 * place reading one back with .text() strips the separators. It is deliberately
 * uniform: no "this use only compares against zero, so it is fine" exceptions,
 * because that reasoning is invisible to whoever edits the line next.
 */

const MODULES = path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js');

const sources = fs
  .readdirSync(MODULES)
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ file: f, text: fs.readFileSync(path.join(MODULES, f), 'utf8') }));

/* ids written as `$('#someId').number(` — those carry thousand separators */
function formattedIds() {
  const ids = new Set();
  for (const { text } of sources) {
    for (const m of text.matchAll(/\$\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)\s*\.number\(/g)) {
      ids.add(m[1]);
    }
  }
  return ids;
}

test('the till really does format money displays with separators', () => {
  const ids = formattedIds();
  assert.ok(
    ids.size > 10,
    `expected many formatted displays, found ${ids.size} - has .number() been replaced?`,
  );
  // the one that caused the production bug must still be in the set
  assert.ok(ids.has('sales_new_subtotal'), 'the subtotal is the canonical case');
});

test('every read of a formatted display strips the separators', () => {
  const ids = formattedIds();
  const offenders = [];

  for (const { file, text } of sources) {
    for (const id of ids) {
      const read = new RegExp(`\\$\\(\\s*['"]#${id}['"]\\s*\\)\\.text\\(\\)`, 'g');
      for (const m of text.matchAll(read)) {
        /* Look at the LINE, not "up to the next semicolon". These reads sit
           inside object literals, where the next semicolon can be dozens of
           lines away - and a window that wide swallows neighbouring lines that
           DO strip, so every read passes whether it strips or not. The first
           version of this test did exactly that and survived its own mutation,
           which is the definition of pinning nothing. */
        const from = text.lastIndexOf('\n', m.index) + 1;
        const nl = text.indexOf('\n', m.index);
        const stmt = text.slice(from, nl === -1 ? text.length : nl);

        // passing through to another element is not a numeric read
        const isPassThrough = /\.text\(\s*\$\(/.test(stmt);
        const strips = /replace\(\s*\/,\/g\s*,\s*['"]{2}\s*\)/.test(stmt);

        if (!isPassThrough && !strips) {
          offenders.push(`${file}: ${stmt.trim().slice(0, 110)}`);
        }
      }
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    'these read a comma-formatted money display without stripping:\n  ' + offenders.join('\n  '),
  );
});
