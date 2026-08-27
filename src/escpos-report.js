'use strict';
/*
 * Reports on a roll.
 *
 * A report printed on 80mm paper is not the A4 report with columns removed.
 * It is a different document with a different job: the A4 daily report is an
 * accounting record, read at a desk and filed, and it wants every line. The
 * roll version is the slip somebody tears off at closing, counts the drawer
 * against, signs, and puts in the cash bag.
 *
 * That difference decides the content. A grocery sells four hundred lines a
 * day; printing them costs several feet of paper that nobody reads, and it is
 * the reason "print report" feels broken on a till. What the person holding
 * the slip needs is what was sold, what of it was cash, what was UPI, and
 * somewhere to write the count.
 *
 * So this renders a declared document rather than a fixed report. A report
 * says what its sections are and the renderer decides how they land on the
 * paper - which keeps twenty-two reports from becoming twenty-two printers.
 */

const { Receipt, COLUMNS } = require('./escpos-receipt');

/*
 * Section kinds:
 *
 *   pairs   a label on the left, a figure hard right
 *   items   a name with a quantity and an amount, wrapping if it must
 *   total   the same as a pair, in double height between rules
 *   blanks  a label and a ruled line to write on
 *   note    centred free text
 *
 * Anything unrecognised is skipped rather than throwing: a report that prints
 * without one section beats a till that cannot print at all.
 */
function renderReport(doc, options = {}) {
  const r = new Receipt(options.paperWidth || '80');
  const width = r.width;

  if (doc.shop) r.centre(doc.shop, { bold: true, size: 1 });
  if (doc.title) r.centre(doc.title, { bold: true });
  if (doc.subtitle) r.centre(doc.subtitle);
  r.rule();

  for (const row of doc.meta || []) {
    if (row && row.value) r.pair(row.label, row.value);
  }
  if ((doc.meta || []).length) r.rule();

  for (const section of doc.sections || []) {
    if (!section) continue;

    switch (section.type) {
      case 'pairs': {
        // A section whose rows are all empty is not printed at all - an
        // empty "PAYMENTS" heading reads as a fault rather than as a day
        // with no card sales.
        const rows = (section.rows || []).filter((x) => x && x.label);
        if (!rows.length) break;
        if (section.name) r.bold(true).line(section.name).bold(false);
        for (const row of rows) r.pair(row.label, row.value, { bold: !!row.strong });
        if (section.total) {
          r.line('-'.repeat(width));
          r.pair(section.total.label, section.total.value, { bold: true });
        }
        // A total section opens with its own rule, so closing this one too
        // would print two rules with nothing between them.
        if (!isTotalNext(doc.sections, section)) r.rule();
        break;
      }

      case 'items': {
        const rows = (section.rows || []).filter((x) => x && x.name);
        if (!rows.length) break;
        if (section.name) r.bold(true).line(section.name).bold(false);
        for (const row of rows) r.item(row.name, row.qty, row.amount);
        r.rule();
        break;
      }

      case 'total': {
        r.rule('=');
        r.size(0, 1).pair(section.label, section.value, { bold: true }).size(0, 0);
        r.rule('=');
        break;
      }

      case 'blanks': {
        /*
         * Somewhere to write, which is the whole point of a cash-up slip.
         *
         * The app cannot know what is physically in the drawer, and across a
         * date range it cannot honestly compute what ought to be - a range
         * can span several register sessions with their own floats. So the
         * slip prints what it does know and leaves a ruled line for the rest,
         * which is what the person signing it expects to find.
         *
         * A row can carry a value, and then it is printed rather than left
         * blank: the cash figure belongs at the head of this block, directly
         * above the line where the count goes, because that is the comparison
         * the person is making.
         */
        if (section.name) r.bold(true).line(section.name).bold(false);
        for (const row of section.rows || []) {
          if (row && typeof row === 'object' && row.value != null) {
            r.pair(row.label, row.value);
            continue;
          }
          const label = String(row);
          const room = width - label.length - 2;
          r.line(label + '  ' + '.'.repeat(Math.max(0, room)));
          r.feed(1);
        }
        r.rule();
        break;
      }

      case 'note': {
        if (section.text) {
          for (const line of wrapText(section.text, width)) r.centre(line);
        }
        break;
      }

      default:
        break;
    }
  }

  if (doc.footer) {
    r.feed(1);
    for (const line of wrapText(doc.footer, width)) r.centre(line);
  }

  if (options.cut !== false) r.cut();
  return r.build();
}

/* Whether the section after this one opens with a rule of its own. */
function isTotalNext(sections, section) {
  const at = (sections || []).indexOf(section);
  const next = at === -1 ? null : (sections || [])[at + 1];
  return !!next && next.type === 'total';
}

/* Break on words; a word longer than the paper is cut, having no boundary. */
function wrapText(text, width) {
  const out = [];
  let line = '';
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (line) { out.push(line); line = ''; }
      out.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

module.exports = { renderReport, COLUMNS };
