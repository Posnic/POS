#!/usr/bin/env node
'use strict';

/*
 * Find jQuery selectors pointing at ids that do not exist.
 *
 * WHY THIS EXISTS
 *
 * The quotes list carried `$('#quotes_search').val()` after the shared filter
 * bar replaced that input. It read '' forever, so the empty-state message told
 * anyone whose SEARCH found nothing that they had never written a quote. A
 * handler was bound to the same removed element and never fired.
 *
 * That is the worst shape of bug in this codebase: it does not throw, it does
 * not log, and it reads as working code. `PosnicPro.<name>()` calls and unmapped
 * modules already have repo guards for the same reason (queue #74, #75); this
 * is the same idea one level down.
 *
 * WHY IT IS A TOOL AND NOT A TEST
 *
 * It cannot be trusted as a pass/fail gate yet. Ids built by string
 * concatenation - `id="items_itemid_' + i + '"` - never appear as a literal, so
 * the tool reports them as missing when they are fine. A guard with a hundred
 * standing exceptions is one people learn to scroll past, which is worse than
 * no guard at all.
 *
 * So: run it, read the list, verify case by case. Every one that turns out to
 * be real gets fixed and pinned by a normal test.
 *
 *   node tests/tools/dead-selectors.js            # module files
 *   node tests/tools/dead-selectors.js --all      # every script we own
 *
 * THE PART THAT *IS* A GATE
 *
 * All 110 were verified once (queue #110). The split that matters is not how
 * many there are but what the code DOES with them:
 *
 *   WRITE  $('#gone').html(x)  - jQuery no-ops on an empty set. Invisible,
 *          harmless, deletable at leisure. 101 of them.
 *   READ   $('#gone').val() / .is(':checked') feeding a condition - always
 *          undefined or false, so a branch never runs or a value goes to the
 *          server missing. 9 of them, every one checked by hand.
 *
 * A hundred standing exceptions get scrolled past; nine do not. So the reads
 * are pinned by dead-selector-reads.test.js, and analyse() is exported for it.
 *
 * HOW TO READ A HIT
 *
 * Search the whole repo for the bare id first. If it appears only inside
 * `$('#id')`, nothing creates it and the selector matches nothing. If it appears
 * in an HTML file or inside a JS string that builds markup, the hit is noise.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FRONTEND = path.join(ROOT, 'frontend');

/* public/ holds BUILT bundles - the same source concatenated, so counting it
   would make every id look defined by itself. plugins/ and vendor/ are not
   ours to fix. */
const SKIP = new Set(['public', 'plugins', 'vendor', 'node_modules']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (/\.(html|js|css|scss)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const TOKEN = /[A-Za-z_][\w-]*/g;
/*
 * `$('#id')` AND `$('#id .child')`.
 *
 * The first version required the quote to close immediately after the id, so a
 * compound selector was invisible to it. That is not a rare shape: twenty
 * modules read the sales page's date range as
 * `$('#view_sales_daterange span span[data-toggle="tooltip"]')`, and when that
 * element was removed during the filter-bar migration the sweep reported
 * nothing at all - the reads that were about to start returning undefined were
 * exactly the ones it could not see.
 *
 * The trailing part is not captured; only the id matters, because the id is
 * what does or does not exist.
 *
 * The quote is captured and back-referenced rather than written as [^'"], for
 * the same reason: attribute selectors carry the OTHER quote inside them, as in
 * `$('#id span[data-toggle="tooltip"]')`. A class excluding both stops at that
 * inner quote and the match fails - which is precisely how the example above
 * stayed invisible on the first attempt at widening this.
 */
const SELECTOR = /\$\(\s*(['"])#([A-Za-z_][\w-]*)(?:[\s>+~.[][^\n]*?)?\1\s*\)/g;

/* The analysis, without the printing - so the reads guard can use exactly the
   same definition of "dead" that this tool reports. */
function analyse({ all = false } = {}) {
  const files = walk(FRONTEND);

  /* One pass. Counting every identifier token in every file, then comparing
     against how many times it appeared as a selector, is the whole trick: an
     id that appears ONLY as a selector is created by nothing. */
  const total = new Map();
  const asSelector = new Map();
  const hits = new Map();

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const t of src.match(TOKEN) || []) total.set(t, (total.get(t) || 0) + 1);

    const inScope = all
      ? file.endsWith('.js')
      : file.endsWith('.js') && file.includes(`${path.sep}modules${path.sep}`);

    for (const m of src.matchAll(SELECTOR)) {
      /* [1] is the quote, back-referenced to close the string; [2] is the id. */
      const id = m[2];
      asSelector.set(id, (asSelector.get(id) || 0) + 1);
      if (!inScope) continue;
      const line = src.slice(0, m.index).split('\n').length;
      if (!hits.has(id)) hits.set(id, []);
      hits.get(id).push(`${path.relative(ROOT, file)}:${line}`);
    }
  }

  const dead = [...hits.entries()]
    .filter(([id]) => total.get(id) === asSelector.get(id))
    .sort((a, b) => b[1].length - a[1].length);

  return { dead, examined: hits.size };
}

function main() {
  const { dead, examined } = analyse({ all: process.argv.includes('--all') });

  console.log(`selectors examined: ${examined}`);
  console.log(`ids that appear ONLY as a selector: ${dead.length}\n`);
  for (const [id, where] of dead) {
    console.log(`#${id}  (${where.length})`);
    for (const w of where) console.log(`    ${w}`);
  }
  console.log('\nVerify each before deleting - a dynamically built id is a false positive.');
}

module.exports = { analyse };

/* Only print when run directly - requiring it from the guard must stay silent. */
if (require.main === module) main();
