'use strict';

/*
 * The two print logs escape what they show, because none of it is ours.
 *
 * CodeQL raised "network data written to file" against the receipt log (alert
 * #919), and the write was bounded in response: control bytes stripped, string
 * lengths capped, the printer list limited, the kind checked against a list.
 * All correct, and none of it makes the text safe to paste into markup.
 * `<img src=x onerror=...>` passes every one of those checks intact.
 *
 * Both logs are drawn with innerHTML, and their rows carry values that did not
 * come from this machine:
 *
 *   a bill number and a document title, which travel with the sale
 *   a printer's own error message, which is whatever the driver said
 *   and for a job taken off the cloud print queue, a record written by
 *   another installation entirely
 *
 * The window is sandboxed with contextIsolation on, so injected script cannot
 * reach Node. It CAN call everything preload.js exposes - the printers, the
 * KOT configuration, log deletion - which is not a thing to leave open on the
 * screen a shopkeeper opens when something is already wrong.
 *
 * One helper, used on every value either log renders. The only unescaped
 * markup left in those rows is the fallback text this file writes itself.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'src', 'hardware-manager.html'), 'utf8');

/** The helper, lifted out and run, rather than described. */
function escaper() {
  const at = HTML.indexOf('function logEsc(value) {');
  assert.notStrictEqual(at, -1, 'the escape helper is gone');
  const open = HTML.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < HTML.length; i += 1) {
    if (HTML[i] === '{') depth += 1;
    else if (HTML[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        const body = 'function logEsc(value) ' + HTML.slice(open, i + 1);
        return new Function('return ' + body + ';')();
      }
    }
  }
  throw new Error('unbalanced braces in logEsc');
}

const esc = escaper();

test('markup in a value cannot become markup on the screen', () => {
  assert.strictEqual(
    esc('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;'
  );
  assert.strictEqual(esc('</td><script>bad()</script>'), '&lt;/td&gt;&lt;script&gt;bad()&lt;/script&gt;');
});

test('it closes the attribute route too, not just the element one', () => {
  /* The refusal reason goes into a title attribute. Escaping only < and >
     would leave a quote free to end the attribute and start an event handler. */
  assert.strictEqual(esc('a" onmouseover="bad()'), 'a&quot; onmouseover=&quot;bad()');
  assert.strictEqual(esc("a' onfocus='bad()"), 'a&#39; onfocus=&#39;bad()');
});

test('the ampersand goes first, or the escaping undoes itself', () => {
  /* Replacing & after < would turn an escaped &lt; back into a live one. */
  assert.strictEqual(esc('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
});

test('nothing and undefined render as nothing, not as the word', () => {
  assert.strictEqual(esc(undefined), '');
  assert.strictEqual(esc(null), '');
  assert.strictEqual(esc(0), '0');
});

test('every value the receipt log renders goes through it', () => {
  const fn = HTML.slice(HTML.indexOf('async function rcptLoadLogs'), HTML.indexOf('async function kotLoadLogs'));
  for (const field of ['r.saleId', 'r.title', 'r.source', 'firstWhy']) {
    const uses = [...fn.matchAll(new RegExp(field.replace('.', '\\.'), 'g'))].length;
    assert.ok(uses > 0, field + ' is no longer rendered; check this test still covers the row');
  }
  assert.match(fn, /logEsc\(r\.saleId/, 'the bill number is rendered raw');
  assert.match(fn, /logEsc\(r\.title/, 'the document title is rendered raw');
  assert.match(fn, /logEsc\(r\.source\)/, 'the source is rendered raw');
  assert.match(fn, /logEsc\(firstWhy\)/, 'the printer reason is rendered raw');
  assert.match(fn, /logEsc\(p\.name/, 'printer names are rendered raw');
});

test('and every value the kitchen log renders', () => {
  const fn = HTML.slice(HTML.indexOf('function kotRenderLogs'), HTML.indexOf('function kotViewDetail'));
  assert.match(fn, /logEsc\(log\.source\)/, 'the source is rendered raw');
  assert.match(fn, /logEsc\(log\.saleDisplayId/, 'the bill number is rendered raw');
  assert.match(fn, /logEsc\(log\.table/, 'the table is rendered raw');
  assert.match(fn, /logEsc\(p\.name/, 'printer names are rendered raw');
});

test('the detail panel too, which is the one people open', () => {
  const fn = HTML.slice(HTML.indexOf('function kotViewDetail'));
  assert.match(fn.slice(0, 3000), /logEsc\(log\.saleDisplayId/);
  assert.match(fn.slice(0, 3000), /logEsc\(log\.source\)/);
});

test('our own fallback markup is still markup', () => {
  /*
   * "not recorded" is a span this file writes. Escaping it would print the
   * tags at somebody, which is the mistake that usually follows this one.
   */
  assert.match(HTML, /r\.source \? logEsc\(r\.source\) : '<span[^']*not recorded/,
    'the fallback is escaped, so the screen shows raw tags');
  assert.match(HTML, /log\.source \? logEsc\(log\.source\) : '<span[^']*not recorded/);
});

test('the write is still bounded, because escaping is not a substitute', () => {
  /* Two different jobs. Bounding keeps control bytes and unbounded strings out
     of the file; escaping keeps markup out of the screen. Removing either
     because the other exists would be a mistake. */
  const log = fs.readFileSync(path.join(ROOT, 'src', 'receipt-log.js'), 'utf8');
  assert.match(log, /\\u0000-\\u001f/, 'control characters are no longer stripped on write');
  assert.match(log, /MAX_PRINTERS/, 'the printer list is no longer bounded');
});
