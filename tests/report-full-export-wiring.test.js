/*
 * Full-duration report export wiring guard.
 *
 * The owner's original report was "pdf reports are taking first records
 * only". The fix gives each report page a `full` spec naming three things:
 * the table, its per-page selector, and the loader that re-renders it.
 *
 * The failure mode worth guarding is that _fullExportRun is DELIBERATELY
 * forgiving - a missing table, per-page selector or loader makes it call
 * fallback() and export whatever is on screen. That is right at runtime (an
 * export that works beats an export that throws) but it means a typo in any
 * of those three strings brings the original bug straight back, silently,
 * with no error anywhere. Nothing else would catch it, so this does: every
 * id and every loader path a `full` spec names must actually exist in the
 * frontend sources.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', 'frontend', 'static', 'script', 'js');
const CORE = path.join(FRONTEND, 'core', 'PosnicPro.js');
const MODULES_DIR = path.join(FRONTEND, 'modules', 'js');

const core = fs.readFileSync(CORE, 'utf8');

const moduleSources = fs
  .readdirSync(MODULES_DIR)
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(MODULES_DIR, f), 'utf8'))
  .join('\n');

/* Pull every `full: [ ... ]` spec out of the registry literal. */
const specs = [];
const specRe = /\{\s*(?:when:\s*'([^']+)',\s*)?table:\s*'([^']+)',\s*per:\s*'([^']+)',\s*load:\s*'([^']+)'\s*\}/g;
let m;
while ((m = specRe.exec(core)) !== null) {
  specs.push({ when: m[1] || null, table: m[2], per: m[3], load: m[4] });
}

test('the registry actually declares full-range specs', () => {
  // If this ever hits zero the regex stopped matching the registry's shape
  // and every assertion below would vacuously pass.
  assert.ok(specs.length >= 12, `expected the full-export specs to be found, got ${specs.length}`);
});

test('every full-export table and per-page selector exists in the frontend sources', () => {
  const missing = [];
  for (const s of specs) {
    // ids are used as jQuery selectors; the sources build them as markup or
    // select them, so the bare id must appear somewhere.
    const tableId = s.table.replace(/^#/, '');
    const perId = s.per.replace(/^#/, '');
    if (!moduleSources.includes(tableId)) {
      missing.push(`${s.load}: table ${s.table} appears in no module source`);
    }
    if (!moduleSources.includes(perId)) {
      missing.push(`${s.load}: per-page selector ${s.per} appears in no module source`);
    }
  }
  assert.deepStrictEqual(
    missing,
    [],
    `full-range export would silently fall back to the on-screen rows:\n${missing.join('\n')}`
  );
});

test('every full-export loader function exists', () => {
  const missing = [];
  for (const s of specs) {
    const parts = s.load.split('.');
    const fn = parts[parts.length - 1];
    const ns = parts[parts.length - 2];
    // e.g. 'itemreport.itemreportTable' -> PosnicPro.itemreport = { itemreportTable: function
    if (!new RegExp(`${fn}\\s*[:=]\\s*function`).test(moduleSources)) {
      missing.push(`${s.load}: no function named ${fn}`);
    }
    if (ns && !new RegExp(`PosnicPro\\.${ns}\\s*=`).test(moduleSources)) {
      missing.push(`${s.load}: no PosnicPro.${ns} namespace`);
    }
  }
  assert.deepStrictEqual(
    missing,
    [],
    `full-range export would silently fall back to the on-screen rows:\n${missing.join('\n')}`
  );
});

test('a page never declares two specs that could both claim the same tab', () => {
  // Within one page the first matching spec wins, so at most ONE spec may be
  // unconditional - a second would be unreachable.
  const byTable = new Map();
  for (const s of specs) {
    const key = s.table;
    if (!byTable.has(key)) byTable.set(key, []);
    byTable.get(key).push(s);
  }
  for (const [table, list] of byTable) {
    const unconditional = list.filter((s) => !s.when);
    assert.ok(
      unconditional.length <= 1,
      `${table} has ${unconditional.length} unconditional specs; all but the first are dead`
    );
  }
});
