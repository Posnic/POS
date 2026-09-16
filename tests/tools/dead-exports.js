#!/usr/bin/env node
'use strict';

/*
 * WHAT THIS CODEBASE EXPORTS AND NEVER CALLS.
 *
 * The recurring failure here is not a crash, it is a line that does nothing
 * and looks fine. The most expensive shape of it is a whole capability that
 * was written, tested, reviewed and merged, and that nothing ever calls:
 *
 *   createReporter        0 of 52 devices had ever reported
 *   setPolicy             so "auto cancel after ten minutes" never happened
 *   jobsNeedingAttention  a bill that failed three times waits for a person
 *                         who has no screen to see it on
 *
 * Every one of those passed its own tests. A feature test proves the code
 * works; it cannot prove anybody calls it. This is the other half.
 *
 * WHAT IT DOES. Reads every `module.exports` name out of api/src and src, then
 * looks for anywhere else that uses that name. A name used nowhere but its own
 * file is reported.
 *
 * WHAT IT CANNOT KNOW, and why it is a tool with an allowlist rather than a
 * gate with none:
 *
 *   - a name reached dynamically (`repo[action]()`) is invisible here;
 *   - a name a TEST calls and nothing else is still dead in the product, but
 *     it is a deliberate seam often enough to be worth saying separately;
 *   - a public API meant for a caller outside this repository is not dead.
 *
 * So it separates "used only by tests" from "used nowhere at all", and the
 * companion test pins a named list rather than demanding zero.
 *
 *   node tests/tools/dead-exports.js           # everything
 *   node tests/tools/dead-exports.js --json    # for the test
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/* Where the product's own code lives. Not tests, not builds, not vendored. */
const SOURCES = ['api/src', 'src'];
const SKIP = new Set(['node_modules', 'dist', 'build', 'builds', '.git', 'public']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const read = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return '';
  }
};

/**
 * The names a file hands out.
 *
 * Only the shorthand and `name: value` forms of an object literal export are
 * read. A class or a bare function assigned to module.exports has no name to
 * look for, and a spread could be anything - both are simply not this tool's
 * business rather than a guess.
 */
function exportsOf(source) {
  const at = source.lastIndexOf('module.exports');
  if (at === -1) return [];
  const open = source.indexOf('{', at);
  if (open === -1 || open > at + 40) return [];

  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];

  const body = source.slice(open + 1, end);
  const names = new Set();
  /* `foo,` and `foo: bar` at the top level of the literal. Nested objects are
     values, not exported names, so depth is tracked. */
  let level = 0;
  for (const part of body.split('\n')) {
    const line = part.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '');
    const before = level;
    level += (line.match(/[{[(]/g) || []).length - (line.match(/[}\])]/g) || []).length;
    if (before !== 0) continue;
    const m = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,|:|$)/.exec(line);
    if (m) names.add(m[1]);
  }
  return [...names];
}

function main() {
  const files = SOURCES.flatMap((dir) => walk(path.join(ROOT, dir)));
  const everywhere = walk(ROOT).filter((f) => !f.includes('tests' + path.sep + 'tools'));

  /* Read once. This walks a few thousand files and every name is looked for
     in all of them, so re-reading per name turns seconds into minutes. */
  const corpus = everywhere.map((file) => ({ file, text: read(file) }));
  const isTest = (file) =>
    /(^|[\\/])tests?[\\/]/.test(file) || /\.test\.js$|\.spec\.js$/.test(file);

  const dead = [];
  const testOnly = [];

  for (const file of files) {
    const source = read(file);
    const names = exportsOf(source);
    if (!names.length) continue;

    for (const name of names) {
      /* A word boundary either side, so `decide` does not match `decideOnOrder`
         and a rename that only half happened is still reported. */
      const used = new RegExp(`\\b${name}\\b`);
      let inProduct = false;
      let inTests = false;

      for (const other of corpus) {
        if (other.file === file) continue;
        if (!used.test(other.text)) continue;
        if (isTest(other.file)) inTests = true;
        else inProduct = true;
        if (inProduct) break;
      }

      const where = path.relative(ROOT, file).replace(/\\/g, '/');
      if (!inProduct && !inTests) dead.push({ file: where, name });
      else if (!inProduct) testOnly.push({ file: where, name });
    }
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ dead, testOnly }, null, 2));
    return;
  }

  console.log(`Scanned ${files.length} source files.\n`);
  console.log(`NOTHING CALLS THESE (${dead.length}):`);
  for (const row of dead) console.log(`  ${row.file}  ${row.name}`);
  console.log(`\nONLY TESTS CALL THESE (${testOnly.length}):`);
  for (const row of testOnly) console.log(`  ${row.file}  ${row.name}`);
  console.log(
    '\nA name here is not automatically a bug: it may be reached dynamically,' +
      '\nor be a seam a test stands in for. Read each one before deleting it.'
  );
}

main();
