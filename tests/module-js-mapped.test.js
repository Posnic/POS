const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stripComments } = require('./helpers/source-lookup');

/*
 * Every module script must be in the build manifest, and no two may define the
 * same function.
 *
 * weight-machine-integration.js sat in modules/js for months without appearing
 * in any page's js list. It was never shipped to a browser - and from inside
 * the file that is invisible. It looked like a working feature, it was read as
 * a working feature, and a bug in it was reported as affecting a live till
 * before anyone checked the manifest.
 *
 * Being unused was the smaller half. It defined four of the same function
 * names as the live implementation in sales.js - readWeightFromMachine,
 * checkAutoWeightTrigger, initWeightMachine, isWeighedItem - so adding it to
 * the manifest to "enable the weight machine" would have replaced a version
 * that warns the cashier with an older one that does not. A dead module that
 * shadows a live one is a loaded gun, not clutter.
 *
 * Both halves are checked here: nothing unmapped, and nothing defined twice.
 *
 * CSS is deliberately not covered. Four stylesheets are legitimately outside
 * the manifest - the print sheets are attached when printing, and style.css is
 * a stale artifact of a build that now compiles style.scss - so the same rule
 * there would be four permanent exceptions and no signal.
 */

const ROOT = path.join(__dirname, '..', 'frontend');
const MODULES = path.join(ROOT, 'static', 'script', 'js', 'modules', 'js');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages_css_js_map.json'), 'utf8'));

const moduleFiles = fs.readdirSync(MODULES).filter((f) => f.endsWith('.js'));

function mappedBasenames() {
  const mapped = new Set();
  for (const cfg of Object.values(manifest)) {
    // Pages are { js: [...] }; lazy_reports (bundle-split slice 2) is a bare
    // array that buildLazyReports ships as script/lazy/reports.js - both
    // shapes reach a browser, so both count as "mapped".
    const files = Array.isArray(cfg) ? cfg : cfg.js || [];
    for (const p of files) mapped.add(path.basename(p));
  }
  return mapped;
}


test('the manifest is being read, not silently empty', () => {
  assert.ok(moduleFiles.length > 40, `only ${moduleFiles.length} module files found`);
  assert.ok(mappedBasenames().size > 40, 'the manifest scan found almost nothing');
});

test('every module script is in the build manifest', () => {
  const mapped = mappedBasenames();
  const orphans = moduleFiles.filter((f) => !mapped.has(f));
  assert.deepStrictEqual(
    orphans,
    [],
    'these live in modules/js but no page loads them - they are dead code, and ' +
      'dead code that redefines a live function is worse than dead:\n  ' +
      orphans.join('\n  '),
  );
});

test('no function is defined by two different modules', () => {
  const defs = new Map();
  for (const file of moduleFiles) {
    const code = stripComments(fs.readFileSync(path.join(MODULES, file), 'utf8'));
    const pattern = /PosnicPro\.([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\s*=\s*(?:function|async)/g;
    for (const m of code.matchAll(pattern)) {
      const key = `PosnicPro.${m[1]}.${m[2]}`;
      if (!defs.has(key)) defs.set(key, new Set());
      defs.get(key).add(file);
    }
  }

  const shadowed = [...defs.entries()]
    .filter(([, files]) => files.size > 1)
    .map(([key, files]) => `${key}  defined in: ${[...files].join(', ')}`);

  assert.deepStrictEqual(
    shadowed,
    [],
    'whichever of these loads last silently wins:\n  ' + shadowed.join('\n  '),
  );
});
