const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * Every PosnicPro.<name>(...) call must name something that exists.
 *
 * This is the cheapest bug in the codebase to write and among the more
 * expensive to notice. `PosnicPro.toastr(...)` was called eight times in the
 * weight-machine module; it does not exist and never did - the helper is
 * PosnicPro.alert. Every one threw "PosnicPro.toastr is not a function", and
 * because the throw lands mid-handler the rest of the handler never ran: an
 * unavailable weight machine produced silence instead of the warning that
 * would have explained it.
 *
 * The same shape was written twice more in a single session (PosnicPro.confirm
 * and PosnicPro.escapeHtml) and caught only by reading. Nothing else catches
 * it: the file parses, the build passes, and the branch only runs when a
 * particular thing goes wrong - which is precisely when the message mattered.
 *
 * Scope is deliberately the DIRECT call, PosnicPro.foo(). Namespaced calls
 * (PosnicPro.sales.foo()) are left to sales-call-paths.test.js, which can
 * resolve one namespace properly rather than guessing across all of them.
 */

const ROOT = path.join(__dirname, '..', 'frontend', 'static', 'script', 'js');

/* Every hand-written source under the js tree. Vendored libraries are skipped:
   they have their own idea of what globals exist and are not ours to police. */
function sources(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['plugins', 'lib', 'vendor'].includes(entry.name)) continue;
      sources(full, acc);
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.min.js')) {
      acc.push({ file: path.relative(ROOT, full), text: fs.readFileSync(full, 'utf8') });
    }
  }
  return acc;
}

/* Comments are not code. The first pass of this check reported four missing
   members; three were commented-out calls or commented-out definitions, and
   chasing them wasted the time the test was meant to save. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      if (at === -1) return line;
      // don't cut inside a string or a URL like https://
      const before = line.slice(0, at);
      const quotes = (before.match(/['"`]/g) || []).length;
      if (quotes % 2 === 1) return line;
      if (before.endsWith(':')) return line;
      return before;
    })
    .join('\n');
}

const files = sources(ROOT).map((f) => ({ ...f, code: stripComments(f.text) }));

function definedMembers() {
  const defined = new Set();

  /* Members of the one big `PosnicPro = { ... }` literal. Indentation varies
     (some are three spaces, some four), so match on the brace depth instead of
     the leading whitespace - that difference alone caused a false positive. */
  const core = files.find((f) => f.file.endsWith(path.join('core', 'PosnicPro.js')));
  assert.ok(core, 'core/PosnicPro.js not found');
  const start = core.code.indexOf('PosnicPro = {');
  assert.notStrictEqual(start, -1, 'the PosnicPro literal moved');

  let depth = 0;
  for (let i = core.code.indexOf('{', start); i < core.code.length; i++) {
    const c = core.code[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) break;
    } else if (depth === 1 && c === '\n') {
      const end = core.code.indexOf('\n', i + 1);
      const line = core.code.slice(i + 1, end === -1 ? undefined : end);
      const m = line.match(/^\s*([a-zA-Z_$][\w$]*)\s*:/);
      if (m) defined.add(m[1]);
    }
  }

  // ...plus every later `PosnicPro.x = ...`, wherever it lives
  for (const { code } of files) {
    for (const m of code.matchAll(/PosnicPro\.([a-zA-Z_$][\w$]*)\s*=[^=]/g)) defined.add(m[1]);
  }
  return defined;
}

test('the member scan finds the real API surface', () => {
  const defined = definedMembers();
  assert.ok(defined.size > 100, `only found ${defined.size} members - has the scan broken?`);
  for (const known of ['alert', 'get', 'post', 'local', 'sales']) {
    assert.ok(defined.has(known), `${known} should have been found`);
  }
});

test('no call names a PosnicPro member that does not exist', () => {
  const defined = definedMembers();
  const missing = [];

  for (const { file, code } of files) {
    for (const m of code.matchAll(/PosnicPro\.([a-zA-Z_$][\w$]*)\s*\(/g)) {
      if (defined.has(m[1])) continue;
      const line = code.slice(0, m.index).split('\n').length;
      missing.push(`${file}:${line}  PosnicPro.${m[1]}(...)`);
    }
  }

  assert.deepStrictEqual(
    missing,
    [],
    'these call PosnicPro members that are never defined:\n  ' + missing.join('\n  '),
  );
});
