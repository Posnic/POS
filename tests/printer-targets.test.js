'use strict';

/*
 * Per-printer copies and paper size.
 *
 * The shapes below are not hypothetical: every one of them is sitting in a
 * config file on a till right now, written by a build that is still running.
 * A shop upgrades overnight and opens at seven; if normalizeTargets misreads
 * what it finds, the first symptom is a counter that will not print, with a
 * queue in front of it.
 *
 * So the legacy shapes are pinned harder than the new one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeTargets,
  normalizeSizeKey,
  pageSizeFor,
  columnsFor,
  clampCopies,
  totalSheets,
  PAPER_SIZES,
  MAX_COPIES,
} = require('../src/printer-targets');

test('every shape already saved on a till still resolves to a printable target', () => {
  /* The receipt tab, every build up to now. */
  assert.deepEqual(
    normalizeTargets({ printerName: 'HP-Counter', paperSize: '3inch' }),
    [{ name: 'HP-Counter', copies: 1, pageSize: '80mm' }],
    'the single-printer receipt config stopped working'
  );

  /* The KOT tab, every build up to now. */
  assert.deepEqual(
    normalizeTargets({ printerNames: ['Kitchen', 'Pass'] }),
    [
      { name: 'Kitchen', copies: 1, pageSize: '80mm' },
      { name: 'Pass', copies: 1, pageSize: '80mm' },
    ],
    'the KOT printer list stopped working'
  );

  /* Nothing configured at all, which is most shops: one entry, no name, which
     means the system default. Returning an empty list here would be a till
     that silently prints nothing. */
  assert.deepEqual(
    normalizeTargets({}),
    [{ name: '', copies: 1, pageSize: '80mm' }],
    'an unconfigured till lost its default printer'
  );

  /* 'default' is what the old dropdown stored for "let Windows choose". */
  assert.deepEqual(normalizeTargets({ printerName: 'default' })[0].name, '');
});

test('a printer keeps its own copies and its own paper', () => {
  const targets = normalizeTargets({
    printers: [
      { name: 'Kitchen', copies: 1, pageSize: '58mm' },
      { name: 'Pass', copies: 2, pageSize: '80mm' },
      { name: 'Office', copies: 1, pageSize: 'a4' },
    ],
  });
  assert.equal(targets.length, 3);
  assert.equal(targets[1].copies, 2);
  assert.equal(targets[2].pageSize, 'a4');
  /* Four sheets from one sale: this is the number a shop counts on the paper. */
  assert.equal(totalSheets(targets), 4);
});

test('a size the print layer cannot honour never reaches it', () => {
  /* An unknown size must fall back rather than propagate: Electron given a
     bogus pageSize rejects the whole job, so the receipt would not print at
     all rather than print on the wrong paper. */
  assert.equal(normalizeSizeKey('bogus'), '80mm');
  assert.equal(normalizeSizeKey(''), '80mm');
  assert.equal(normalizeSizeKey(null), '80mm');
  assert.equal(normalizeSizeKey(undefined), '80mm');

  /* The spellings that exist in saved configs and in the old radio buttons. */
  assert.equal(normalizeSizeKey('3inch'), '80mm');
  assert.equal(normalizeSizeKey('2inch'), '58mm');
  assert.equal(normalizeSizeKey('80'), '80mm');
  assert.equal(normalizeSizeKey('A4'), 'a4');

  for (const key of Object.keys(PAPER_SIZES)) {
    const size = pageSizeFor(key);
    assert.ok(size.width > 0 && size.height > 0, key + ' has no usable dimensions');
  }
});

test('copies are clamped, because a mistyped number empties the roll', () => {
  assert.equal(clampCopies(0), 1);
  assert.equal(clampCopies(-3), 1);
  assert.equal(clampCopies('abc'), 1);
  assert.equal(clampCopies(undefined), 1);
  assert.equal(clampCopies(3), 3);
  assert.equal(clampCopies(9999), MAX_COPIES, 'an unbounded copy count reached the printer');
});

test('column width follows the roll, so totals do not wrap', () => {
  /* 58mm is 32 columns and 80mm is 48. Rendering 48 onto a 58mm roll pushes
     the amount onto its own line, which reads as a formatting bug on paper. */
  assert.equal(columnsFor('58mm'), 32);
  assert.equal(columnsFor('80mm'), 48);
  assert.equal(columnsFor('76mm'), 42);
});

test('the same printer picked twice prints once, at the higher count', () => {
  /* Ticking a printer twice is a mis-click. Copies is how you ask for two, and
     silently printing fewer than asked is the worse failure, so the larger
     count wins. */
  const targets = normalizeTargets({
    printers: [
      { name: 'Kitchen', copies: 1, pageSize: '80mm' },
      { name: 'Kitchen', copies: 3, pageSize: '80mm' },
    ],
  });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].copies, 3);

  /* The same printer on DIFFERENT paper is a real request, not a duplicate. */
  const twoSizes = normalizeTargets({
    printers: [
      { name: 'Shared', copies: 1, pageSize: '80mm' },
      { name: 'Shared', copies: 1, pageSize: 'a4' },
    ],
  });
  assert.equal(twoSizes.length, 2);
});

test('a corrupt saved config degrades instead of throwing', () => {
  /* This runs on the sale path. A config file damaged by a power cut must not
     stop a customer being served. */
  for (const bad of [null, undefined, 'nonsense', 42, [], { printers: 'not-an-array' }]) {
    const out = normalizeTargets(bad);
    assert.ok(Array.isArray(out) && out.length >= 1, 'no printable target for ' + JSON.stringify(bad));
  }
  assert.deepEqual(
    normalizeTargets({ printers: [null, undefined, '', { name: '' }] })[0],
    { name: '', copies: 1, pageSize: '80mm' }
  );
});

test('the hardcoded POS-80C rewrite is gone from the KOT path', () => {
  /*
   * A printer literally named POS-80C used to be rewritten to '' before
   * printing, which sent the job to the SYSTEM DEFAULT instead of the printer
   * the shop chose. It is the factory name on a great many generic 80mm
   * printers, so any shop that never renamed theirs was printing somewhere
   * else with no way to tell.
   */
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'kot-manager.js'), 'utf8');
  assert.ok(
    !/toUpperCase\(\)\s*===\s*'POS-80C'\s*\?\s*''/.test(src),
    'the POS-80C rewrite is back; a shop with that printer prints to the wrong device'
  );
});

test('the screen offers only sizes the print layer can honour', () => {
  /* The catalogue is sent to the renderer over IPC rather than copied into the
     HTML, because two lists drift and the drifting one is never the tested
     one. This pins that it is still sourced, not duplicated. */
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'hardware-manager.html'), 'utf8');
  assert.match(html, /getPaperSizes\(\)/, 'the screen no longer asks for the catalogue');
  assert.ok(
    !/value="a4"[\s\S]{0,40}A4 sheet[\s\S]{0,200}value="58"/.test(html),
    'the paper sizes look hardcoded in the markup again'
  );
});
