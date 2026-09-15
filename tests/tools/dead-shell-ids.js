'use strict';

/*
 * IDS THE DESKTOP SHELL ASKS FOR AND NEVER DEFINES.
 *
 * WHY THIS IS SEPARATE FROM dead-selectors.js
 *
 * That tool answers a genuinely hard question: does any id in the whole
 * frontend get created by anything, anywhere? Markup lives in one file and the
 * code that reads it in another, so it can only count tokens across the tree
 * and report what looks suspicious. Its own header says to verify each hit
 * before deleting, because a dynamically built id is a false positive.
 *
 * The shell's pages are not like that. hardware-manager.html, the install
 * wizard, the backup manager and the kitchen screen are SELF-CONTAINED: markup
 * and script in the same file. So the question collapses to something exact -
 * if a page asks for #x and that same page never writes id="x", then nothing
 * can create it. No cross-file reasoning, no guessing.
 *
 * WHAT IT WOULD HAVE CAUGHT
 *
 * Hardware Manager carried a whole single-printer picker - refreshPrinters,
 * selectPrinter, printToSelected, printToDefault - writing to #printerStatus,
 * #printerList, #printBtn, #printContent and #copies. Not one of those elements
 * had ever existed in the file: `git log --follow -S 'id="printerList"'` finds
 * no commit that added or removed them.
 *
 * So every click on the Receipt Printer tab called refreshPrinters, which did
 * `statusDiv.classList.remove('hidden')` on null OUTSIDE its own try block and
 * threw, unhandled, into switchTab. And because the throw came before `printers`
 * was assigned, the `printers.length === 0` guard never went false: it threw
 * again on every single click, for the life of the file.
 *
 * dead-selectors.js could not see it. It matches jQuery `$('#id')` only, and
 * only inside .js files under modules/ - the shell uses getElementById inside
 * HTML, which is neither.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SHELL = path.join(ROOT, 'src');

/* getElementById('x') and querySelector('#x'), single or double quoted. */
const ASKS = [
  /getElementById\(\s*(['"])([A-Za-z_][\w-]*)\1\s*\)/g,
  /querySelector(?:All)?\(\s*(['"])#([A-Za-z_][\w-]*)\1\s*\)/g,
];

/* id="x" in markup, and the two ways code sets one it just built. */
const DEFINES = [
  /\bid=(['"])([A-Za-z_][\w-]*)\1/g,
  /\.id\s*=\s*(['"])([A-Za-z_][\w-]*)\1/g,
  /setAttribute\(\s*(['"])id\1\s*,\s*(['"])([A-Za-z_][\w-]*)\2\s*\)/g,
];

function pages() {
  if (!fs.existsSync(SHELL)) return [];
  return fs
    .readdirSync(SHELL)
    .filter((f) => f.endsWith('.html'))
    .map((f) => path.join(SHELL, f));
}

/**
 * @returns {Array<{file: string, id: string, line: number}>}
 */
function analyse() {
  const dead = [];

  for (const file of pages()) {
    const src = fs.readFileSync(file, 'utf8');

    const defined = new Set();
    for (const pattern of DEFINES) {
      for (const m of src.matchAll(pattern)) defined.add(m[3] || m[2]);
    }

    /*
     * An id assembled at run time - id="row-" + n - cannot be matched by any
     * pattern, and the page that builds such ids always concatenates. If a file
     * does that at all, only flag ids it never mentions in ANY string, so a
     * page full of generated rows does not light up.
     */
    const builds = /\bid\s*=\s*(['"`])[^'"`]*\1\s*\+|\bid=\\?["']\s*\+/.test(src);

    const seen = new Map();
    for (const pattern of ASKS) {
      for (const m of src.matchAll(pattern)) {
        const id = m[2];
        if (defined.has(id)) continue;
        if (builds && new RegExp('[\'"`]' + id).test(src.replace(pattern, ''))) continue;
        if (!seen.has(id)) seen.set(id, src.slice(0, m.index).split('\n').length);
      }
    }

    for (const [id, line] of seen) {
      dead.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), id, line });
    }
  }

  return dead;
}

module.exports = { analyse, pages };

if (require.main === module) {
  const dead = analyse();
  const scanned = pages().length;
  if (!dead.length) {
    console.log(`${scanned} shell page(s) scanned. Every id asked for is defined.`);
    process.exit(0);
  }
  console.log(`${scanned} shell page(s) scanned. ${dead.length} id(s) asked for and never defined:\n`);
  for (const d of dead) console.log(`  #${d.id}\n      ${d.file}:${d.line}`);
  console.log('\nThese resolve to null. Whatever reads them either throws or silently does nothing.');
  process.exit(1);
}
