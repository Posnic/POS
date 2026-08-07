/*
 * The CSV templates a shop downloads before importing its data.
 *
 * These are the first files a new customer opens, and they were carrying
 * keyboard noise - "arun", "saAS", "qsaas", "szhs@gmail.com" - left over from
 * whoever last tested the importer. Nothing was leaked by it; it simply read as
 * unfinished software in the one place a shop looks before trusting the product
 * with its customer list.
 *
 * suppliers.csv was worse than untidy. Its header named four columns and its
 * example row carried seven, so anyone following the header produced a file
 * that did not match the sample beside it.
 *
 * The checks here are the ones that would have caught both: every row lines up
 * with its header when parsed the way the application parses it, and no address
 * in a shipped template belongs to a real person.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'frontend', 'static', 'Import_sample_files');

/*
 * The parser from PosnicPro.js, copied rather than imported.
 *
 * It lives inside a jQuery ready handler in a browser bundle with no exports,
 * so there is nothing to require. Copying it means this test can drift from the
 * real one - but a template that parses under a stricter parser and fails under
 * the real one is the failure that matters, and a naive split on commas would
 * pass files the application then rejects.
 */
function parseCsvRow(line) {
  const cells = [];
  let value = '';
  let insideQuotes = false;

  for (let idx = 0; idx < line.length; idx++) {
    const ch = line[idx];
    const nextCh = line[idx + 1];

    if (ch === '"') {
      if (insideQuotes && nextCh === '"') {
        value += '"';
        idx++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (ch === ',' && !insideQuotes) {
      cells.push(value);
      value = '';
    } else {
      value += ch;
    }
  }
  cells.push(value);
  return cells;
}

function templates() {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.csv'))
    .map((f) => {
      const lines = fs
        .readFileSync(path.join(DIR, f), 'utf8')
        .split(/\r\n|\n/)
        .filter((l) => l.trim());
      return { name: f, headers: parseCsvRow(lines[0]), rows: lines.slice(1).map(parseCsvRow) };
    });
}

test('there are templates to check', () => {
  assert.ok(templates().length >= 7, 'the import templates have moved or been removed');
});

test('every row lines up with its header, parsed as the app parses it', () => {
  for (const t of templates()) {
    for (const [i, row] of t.rows.entries()) {
      assert.strictEqual(
        row.length,
        t.headers.length,
        `${t.name} row ${i + 1} has ${row.length} values for ${t.headers.length} ` +
          'columns. A shop following the header produces a file that does not ' +
          'match the sample beside it.',
      );
    }
  }
});

test('each template shows at least one example row', () => {
  /* A header with no example is a form with no worked answer. */
  for (const t of templates()) {
    assert.ok(t.rows.length >= 1, `${t.name} has a header and no example row`);
  }
});

test('no blank rows, which import as empty records', () => {
  for (const t of templates()) {
    for (const [i, row] of t.rows.entries()) {
      assert.ok(
        row.some((cell) => cell.trim() !== '') ,
        `${t.name} row ${i + 1} is entirely empty and would import as a blank record`,
      );
    }
  }
});

test('sample email addresses cannot reach a real person', () => {
  /* example.com is reserved for exactly this (RFC 2606). A plausible-looking
     gmail address in a shipped template is somebody's real inbox. */
  for (const t of templates()) {
    for (const [i, row] of t.rows.entries()) {
      for (const cell of row) {
        if (!cell.includes('@')) continue;
        assert.match(
          cell,
          /@example\.(com|org|net)$/,
          `${t.name} row ${i + 1} carries "${cell}". Sample addresses must use ` +
            'example.com, which is reserved for documentation - anything else ' +
            'may be a real mailbox.',
        );
      }
    }
  }
});

test('and the values read as sample data, not as leftover test input', () => {
  /* The templates are the first thing a new shop opens. */
  const noise = /\b(asdf|qwer|sasa|saas|qsaas|szhs|sfs|test123|aaaa+|xxxx+)\b/i;
  for (const t of templates()) {
    for (const [i, row] of t.rows.entries()) {
      for (const cell of row) {
        assert.doesNotMatch(
          cell,
          noise,
          `${t.name} row ${i + 1} contains "${cell}", which looks like leftover ` +
            'test input rather than an example a shop can follow',
        );
      }
    }
  }
});
