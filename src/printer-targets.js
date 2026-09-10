'use strict';

/*
 * What to print, where, how many times, and on what paper.
 *
 * Both print paths needed the same answer and neither had it. The receipt path
 * took a single printerName and no copy count; the KOT path took a list of
 * names, printed one each, and hardcoded 80mm regardless of what was attached.
 * A shop that wants two copies to the pass and one to the kitchen, or a
 * thermal ticket to the kitchen and an A4 invoice to the counter, could not
 * say so.
 *
 * So a target is a printer plus its own settings, and both paths read the same
 * shape:
 *
 *   { name: 'Kitchen-80', copies: 2, pageSize: '80mm' }
 *
 * Paper size is per target rather than global because it has to be: once you
 * can select several printers, an 80mm roll and an A4 sheet cannot share one
 * setting, and picking either one silently ruins the other's output.
 *
 * Everything here is defensive. This runs on the sale path, and a malformed
 * saved config must degrade to "print one copy to the default printer" rather
 * than throw, because the customer is standing at the counter either way.
 */

/*
 * Roll and sheet sizes, in microns, as Electron's pageSize wants them.
 *
 * The thermal widths are the ones actually sold: 58mm and 80mm dominate,
 * 57mm is the same roll quoted differently by some vendors, 76mm is the impact
 * kitchen printer still common in Asia, and 112mm is the wide roll used for
 * picking lists. Sheet sizes cover ISO and North America, since an invoice
 * printed to A4 in Chennai and to Letter in Chicago is the same feature.
 *
 * height is left long on rolls on purpose: receipt paper has no page break, so
 * the driver cuts when the content ends rather than at a fixed length.
 */
const ROLL_HEIGHT_MICRONS = 1000000;

const PAPER_SIZES = Object.freeze({
  '44mm': { label: '44mm roll', width: 44000, height: ROLL_HEIGHT_MICRONS, windowWidth: 166, roll: true },
  '50mm': { label: '50mm roll', width: 50000, height: ROLL_HEIGHT_MICRONS, windowWidth: 189, roll: true },
  '57mm': { label: '57mm roll', width: 57000, height: ROLL_HEIGHT_MICRONS, windowWidth: 215, roll: true },
  '58mm': { label: '58mm roll', width: 58000, height: ROLL_HEIGHT_MICRONS, windowWidth: 220, roll: true },
  '76mm': { label: '76mm roll (impact)', width: 76000, height: ROLL_HEIGHT_MICRONS, windowWidth: 287, roll: true },
  '80mm': { label: '80mm roll', width: 80000, height: ROLL_HEIGHT_MICRONS, windowWidth: 302, roll: true },
  '100mm': { label: '100mm roll', width: 100000, height: ROLL_HEIGHT_MICRONS, windowWidth: 378, roll: true },
  '112mm': { label: '112mm roll', width: 112000, height: ROLL_HEIGHT_MICRONS, windowWidth: 423, roll: true },
  a4: { label: 'A4 sheet', width: 210000, height: 297000, windowWidth: 794, roll: false },
  a5: { label: 'A5 sheet', width: 148000, height: 210000, windowWidth: 559, roll: false },
  a6: { label: 'A6 sheet', width: 105000, height: 148000, windowWidth: 397, roll: false },
  letter: { label: 'Letter sheet', width: 216000, height: 279000, windowWidth: 816, roll: false },
  legal: { label: 'Legal sheet', width: 216000, height: 356000, windowWidth: 816, roll: false },
});

const DEFAULT_PAGE_SIZE = '80mm';

/* A shop asking for a hundred copies has mistyped, and a printer that keeps
   going is worse than one that refuses: it empties the roll during service. */
const MAX_COPIES = 20;

/**
 * The character width of a roll, for ESC/POS rendering.
 *
 * The receipt renderer thinks in columns, not microns, and gets this wrong in
 * a way nobody notices until a total wraps onto its own line.
 */
function columnsFor(sizeKey) {
  const key = normalizeSizeKey(sizeKey);
  const size = PAPER_SIZES[key];
  if (!size || !size.roll) return 48;
  if (size.width <= 50000) return 32;
  if (size.width <= 58000) return 32;
  if (size.width <= 76000) return 42;
  if (size.width <= 80000) return 48;
  return 64;
}

/** Accepts '80', '80mm', 'A4', '3inch' and the other spellings in the wild. */
function normalizeSizeKey(value) {
  let key = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (!key) return DEFAULT_PAGE_SIZE;

  /* Legacy spellings that already exist in saved configs and in the UI. */
  const aliases = {
    '2inch': '58mm',
    '3inch': '80mm',
    '4inch': '100mm',
    '58': '58mm',
    '57': '57mm',
    '50': '50mm',
    '76': '76mm',
    '80': '80mm',
    '100': '100mm',
    '112': '112mm',
    a4paper: 'a4',
  };
  if (aliases[key]) key = aliases[key];

  /* Bare numbers arrive from the old radio buttons: value="80". */
  if (/^\d+$/.test(key)) key = key + 'mm';

  return PAPER_SIZES[key] ? key : DEFAULT_PAGE_SIZE;
}

/** The Electron pageSize object for a key, always a valid one. */
function pageSizeFor(sizeKey) {
  const size = PAPER_SIZES[normalizeSizeKey(sizeKey)];
  return { width: size.width, height: size.height };
}

function clampCopies(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_COPIES);
}

/**
 * Read any saved shape - current or legacy - into a list of targets.
 *
 * The shapes that exist in the wild, all of which must keep working because
 * they are already sitting in config files on tills:
 *
 *   { printers: [{ name, copies, pageSize }] }   what this writes now
 *   { printerNames: ['a','b'], pageSize }        the KOT config
 *   { printerName: 'a', paperSize: '3inch' }     the receipt config
 *   { printers: ['a','b'] }                      a list of bare strings
 *
 * An empty result is meaningful and must be preserved as one entry with no
 * name: that is "the system default printer", which is what a shop with a
 * single printer and no configuration should get.
 */
function normalizeTargets(config = {}, fallbackSize) {
  const cfg = config && typeof config === 'object' ? config : {};
  const globalSize = normalizeSizeKey(
    cfg.pageSize !== undefined ? cfg.pageSize
      : cfg.paperSize !== undefined ? cfg.paperSize
        : fallbackSize
  );
  const globalCopies = cfg.copies !== undefined ? clampCopies(cfg.copies) : 1;

  let raw = [];
  if (Array.isArray(cfg.printers) && cfg.printers.length) {
    raw = cfg.printers;
  } else if (Array.isArray(cfg.printerNames) && cfg.printerNames.length) {
    raw = cfg.printerNames;
  } else if (cfg.printerName) {
    raw = [cfg.printerName];
  }

  const targets = [];
  const seen = new Set();
  for (const entry of raw) {
    let name = '';
    let copies = globalCopies;
    let pageSize = globalSize;

    if (typeof entry === 'string') {
      name = entry.trim();
    } else if (entry && typeof entry === 'object') {
      name = String(entry.name || entry.printerName || '').trim();
      if (entry.copies !== undefined) copies = clampCopies(entry.copies);
      if (entry.pageSize !== undefined || entry.paperSize !== undefined) {
        pageSize = normalizeSizeKey(entry.pageSize !== undefined ? entry.pageSize : entry.paperSize);
      }
    }

    /* 'default' is what the receipt dropdown has always used for "whatever the
       operating system picked", and an empty name means the same thing. */
    if (name.toLowerCase() === 'default') name = '';

    /* The same printer twice is a mis-click, not a request for two copies -
       those are asked for by the copies box, which is why this merges rather
       than dropping: the higher count wins, so nothing silently prints less. */
    const key = name.toLowerCase() + '|' + pageSize;
    if (seen.has(key)) {
      const existing = targets.find((t) => t.name.toLowerCase() + '|' + t.pageSize === key);
      if (existing) existing.copies = Math.max(existing.copies, copies);
      continue;
    }
    seen.add(key);
    targets.push({ name, copies, pageSize });
  }

  if (!targets.length) targets.push({ name: '', copies: globalCopies, pageSize: globalSize });
  return targets;
}

/** How many sheets this configuration will actually produce. */
function totalSheets(targets) {
  return (Array.isArray(targets) ? targets : []).reduce((sum, t) => sum + clampCopies(t.copies), 0);
}

module.exports = {
  PAPER_SIZES,
  DEFAULT_PAGE_SIZE,
  MAX_COPIES,
  normalizeSizeKey,
  pageSizeFor,
  columnsFor,
  clampCopies,
  normalizeTargets,
  totalSheets,
};
