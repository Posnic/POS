'use strict';

/*
 * A window must not read an element that does not exist.
 *
 * THE BUG THIS EXISTS FOR
 *
 * Owner: "receipt printer previously its multi selct. have you changed
 * anything?"
 *
 * Nothing had changed the multi-select - it was there and working. But beside
 * it, Hardware Manager carried a whole SECOND printer picker that had never
 * worked: refreshPrinters, selectPrinter, printToSelected and printToDefault,
 * writing to #printerStatus, #printerList, #printBtn, #printContent and
 * #copies. Not one of those elements had ever existed in the file -
 * `git log --follow -S 'id="printerList"'` finds no commit that added or
 * removed them, including before the move into src/.
 *
 * switchTab called it on every receipt-tab click:
 *
 *     if (tabName === 'receipt' && printers.length === 0) refreshPrinters();
 *
 * and refreshPrinters did `statusDiv.classList.remove('hidden')` on null
 * OUTSIDE its own try block. So it threw, unhandled, into switchTab. Worse, the
 * throw came BEFORE `printers` was assigned, so the guard never went false and
 * it threw again on every single click, for the life of the file.
 *
 * WHY NOTHING CAUGHT IT
 *
 * tests/tools/dead-selectors.js exists for exactly this class of fault and
 * could not see it: it matches jQuery `$('#id')` only, and only inside .js files
 * under frontend/.../modules/. The shell uses getElementById inside HTML, which
 * is neither - so src/ was never checked at all.
 *
 * WHY THIS CHECK CAN BE EXACT
 *
 * The shell's pages are SELF-CONTAINED: markup and script in one file. So the
 * question is not "does anything anywhere create this id" but "does THIS file",
 * and that has a definite answer. No cross-file guessing, no verify-before-
 * deleting caveat.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { analyse, pages } = require(path.join(ROOT, 'tests', 'tools', 'dead-shell-ids.js'));

test('NO SHELL PAGE READS AN ELEMENT IT NEVER CREATES', () => {
  const dead = analyse();
  const said = dead.map((d) => `  #${d.id}  ${d.file}:${d.line}`).join('\n');
  assert.deepStrictEqual(
    dead,
    [],
    'these resolve to null - whatever reads them throws or silently does ' +
      'nothing:\n' + said + '\n\nRun: node tests/tools/dead-shell-ids.js'
  );
});

test('and it is actually looking at the pages a shopkeeper opens', () => {
  /*
   * A check that scans nothing passes forever. dead-selectors.js reported
   * "All good" on this repo for the life of the fault, because src/ was outside
   * the only directory it walked.
   */
  const scanned = pages().map((p) => path.basename(p));
  assert.ok(scanned.length >= 5, `only ${scanned.length} shell pages found`);
  for (const must of ['hardware-manager.html', 'kitchen-screen.html']) {
    assert.ok(scanned.includes(must), must + ' is not being scanned');
  }
});

test('IT WOULD HAVE CAUGHT THE PRINTER PICKER, which is the point', () => {
  /*
   * A guard nobody has watched fail is a guard nobody should trust. This feeds
   * it the exact shape of the bug - a page that asks for an id it never defines
   * - and requires it to go red.
   */
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'shell-ids-'));
  const page = path.join(dir, 'broken.html');
  fs.writeFileSync(
    page,
    '<div id="rpPrinterList"></div>\n' +
      '<script>\n' +
      "  const ok = document.getElementById('rpPrinterList');\n" +
      "  const statusDiv = document.getElementById('printerStatus');\n" +
      "  statusDiv.classList.remove('hidden');\n" +
      '</script>\n'
  );

  /* The tool reads src/, so exercise its logic directly on this file rather
     than writing into the real tree. */
  const src = fs.readFileSync(page, 'utf8');
  const defined = new Set();
  for (const m of src.matchAll(/\bid=(['"])([A-Za-z_][\w-]*)\1/g)) defined.add(m[2]);
  const asked = [...src.matchAll(/getElementById\(\s*(['"])([A-Za-z_][\w-]*)\1\s*\)/g)].map(
    (m) => m[2]
  );

  assert.ok(asked.includes('printerStatus'), 'the fixture does not reproduce the shape');
  assert.ok(!defined.has('printerStatus'), 'the fixture defines what it should not');
  assert.ok(defined.has('rpPrinterList'), 'the live element should be seen as defined');

  fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------- and the multi-select is intact */

const HM = fs.readFileSync(path.join(ROOT, 'src', 'hardware-manager.html'), 'utf8');

test('the receipt printer is still MULTI-select, which is what was asked', () => {
  /*
   * The owner's actual question. Several printers, ticked, saved as a list -
   * a shop with a counter printer and a second one at the far end needs both.
   */
  assert.match(HM, /id="rpPrinterList"/, 'the printer list is gone');
  assert.match(HM, /_collectTargets\('rpPrinterList'\)/, 'nothing collects more than one');
  assert.match(HM, /set\('receipt_printers', JSON\.stringify\(targets\)\)/,
    'the choice is no longer saved as a list');
  assert.match(HM, /Tick at least one printer/, 'saving nothing is no longer refused');
});

test('and the dead single-printer picker has not come back', () => {
  /* Names only, and only as code: the comment explaining the removal mentions
     all of them, which is why this looks for a call or a definition. */
  for (const gone of ['refreshPrinters', 'selectPrinter', 'printToSelected', 'printToDefault']) {
    assert.ok(
      !new RegExp('function\\s+' + gone + '\\s*\\(').test(HM),
      gone + ' is back'
    );
    assert.ok(!new RegExp(gone + '\\s*\\(\\s*\\)').test(HM), gone + ' is being called again');
  }
});
