#!/usr/bin/env node
'use strict';
/*
 * Which t() calls actually run when a module is merely LOADED?
 *
 * Guessing from braces is unreliable here: PosnicPro.js is one object literal
 * thousands of lines long, stuffed with function-valued properties, and a
 * hand-rolled scanner mis-pairs a brace somewhere and calls the dangerous
 * lines safe. So do not guess - run the file and watch.
 *
 * Each t() is replaced by a probe that records itself and returns the English.
 * The file is executed against a Proxy that answers every global (jQuery, the
 * document, moment, Dexie...) with itself, so nothing else throws and no
 * callback is ever invoked. Anything the probe records was evaluated while the
 * file was loading - which for a literal means before its own object exists.
 *
 *   node probe-load-time.js         list them
 *   node probe-load-time.js --write revert those to plain English
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const write = process.argv.includes('--write');
const ROOT = path.resolve(__dirname, '..', '..', 'frontend', 'static', 'script', 'js');
const DIRS = [path.join(ROOT, 'core'), path.join(ROOT, 'modules', 'js')];

function universalStub() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      /* .then/.catch must stay callable: modules chain on fetch() at load.
         They return the stub, so no callback is ever actually invoked. */
      if (prop === Symbol.iterator) return function* () {};
      if (prop === 'length') return 0;
      return proxy;
    },
    set() { return true; },
    has() { return true; },
    apply() { return proxy; },
    construct() { return proxy; },
  });
  return proxy;
}

let total = 0;
const report = [];
const sitesByFile = {};
for (const dir of DIRS) {
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const file = path.join(dir, name);
    const src = fs.readFileSync(file, 'utf8');
    const sites = [];
    const re = /PosnicPro\.i18n\.t\('([^']+)',\s*'((?:[^'\\]|\\.)*)'\)/g;
    let m;
    let instrumented = '';
    let last = 0;
    while ((m = re.exec(src))) {
      sites.push({ index: m.index, whole: m[0], english: m[2], line: src.slice(0, m.index).split('\n').length });
      instrumented += src.slice(last, m.index) + '__probe(' + (sites.length - 1) + ")"; // returns the English
      last = m.index + m[0].length;
    }
    instrumented += src.slice(last);
    if (!sites.length) continue;

    const fired = new Set();
    const stub = universalStub();
    const sandbox = new Proxy({
      __probe: (n) => { fired.add(n); return sites[n].english; },
      console: { log() {}, warn() {}, error() {} },
      Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
      Promise, Set, Map, parseInt, parseFloat, isNaN, encodeURIComponent,
      decodeURIComponent, setTimeout: () => 0, setInterval: () => 0,
      clearTimeout() {}, clearInterval() {},
    }, {
      /* anything the file reaches for that we did not name is the stub, so a
         missing global cannot end the run before the probes are reached */
      has: () => true,
      get: (t, p) => (p in t ? t[p] : stub),
    });

    try {
      vm.runInNewContext(instrumented, sandbox, { filename: name, timeout: 20000 });
    } catch (e) {
      report.push(name.padEnd(26) + ' could not be probed: ' + String(e.message).slice(0, 70));
      continue;
    }
    if (!fired.size) continue;
    total += fired.size;
    sitesByFile[name] = list.map((n) => ({ line: sites[n].line, english: sites[n].english }));
    const list = [...fired].sort((a, b) => a - b);
    report.push(name.padEnd(26) + String(fired.size).padStart(4)
      + '   lines ' + list.slice(0, 4).map((n) => sites[n].line).join(', ') + (list.length > 4 ? ', ...' : ''));
    if (write) {
      let out = src;
      for (const n of list.slice().reverse()) {
        const s = sites[n];
        out = out.slice(0, s.index) + "'" + s.english + "'" + out.slice(s.index + s.whole.length);
      }
      fs.writeFileSync(file, out, 'utf8');
    }
  }
}
if (require.main === module) {
  console.log(report.join('\n'));
  console.log('\nt() calls that run at load:', total,
    write ? '- reverted to plain English.' : '- dry run. Use --write.');
}

/* The test asks for the count; the command line prints the detail. */
module.exports = { report, total, sitesByFile };
