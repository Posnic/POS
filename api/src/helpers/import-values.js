'use strict';

// Locale-neutral CSV parsing: accept only complete, unambiguous numbers.
// A single separator followed by three digits (1,234 or 1.234) can mean
// either a decimal or thousands. Reject it instead of silently choosing.
// Identifiers/phone numbers must never pass through this parser.
function importNumber(value, fallback = NaN) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const text = value
    .trim()
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\u2019/g, "'");
  if (!text) return fallback;
  const candidates = new Set();
  const add = (text) => {
    const number = Number(text);
    if (Number.isFinite(number)) candidates.add(number);
  };
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) add(text);
  if (/^[+-]?(?:\d+,\d+|,\d+)$/.test(text)) add(text.replace(',', '.'));
  if (
    /^[+-]?[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/.test(text) ||
    /^[+-]?[1-9]\d?(?:,\d{2})*,\d{3}(?:\.\d+)?$/.test(text)
  )
    add(text.replace(/,/g, ''));
  if (/^[+-]?[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?$/.test(text))
    add(text.replace(/\./g, '').replace(',', '.'));
  // French grouping spaces (including NBSP/narrow NBSP), Swiss apostrophes.
  for (const separator of [' ', "'"]) {
    const pattern = new RegExp('^[+-]?[1-9]\\d{0,2}(?:' + separator + '\\d{3})+(?:[.,]\\d+)?$');
    if (pattern.test(text)) add(text.split(separator).join('').replace(',', '.'));
  }
  return candidates.size === 1 ? [...candidates][0] : NaN;
}

function contactRows(rows, requirePhone = false) {
  const result = [],
    errors = [],
    identities = new Map(),
    emails = new Map();
  rows.forEach((raw, index) => {
    const row = {
      ...raw,
      name: String(raw?.name ?? '').trim(),
      phone: String(raw?.phone ?? '').trim(),
      email: String(raw?.email ?? '')
        .trim()
        .toLowerCase(),
    };
    const fail = (status) => errors.push({ row: index + 2, name: row.name, status });
    if (!row.name || (requirePhone && !row.phone)) {
      fail(requirePhone ? 'Name and phone are required' : 'Name is required');
      return;
    }
    if (row.email && !require('validator').isEmail(row.email)) {
      fail('Invalid email address');
      return;
    }
    if (Object.hasOwn(row, 'balance')) {
      row.balance = importNumber(row.balance, 0);
      if (!Number.isFinite(row.balance)) {
        fail(
          'Balance must be an unambiguous number, such as 1234,56 or 1234.56. Write 1234 for a whole number, or 1.2340 for a decimal.'
        );
        return;
      }
    }
    const key = JSON.stringify([row.name, row.phone]);
    const previous = identities.get(key);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(row))
        fail('Conflicting records with the same name and phone');
      return;
    }
    if (row.email && emails.has(row.email)) {
      fail('Email is used by another row in this file');
      return;
    }
    identities.set(key, row);
    if (row.email) emails.set(row.email, true);
    result.push(row);
  });
  return { rows: result, errors };
}

function importFailure(error) {
  const count = Number(error?.result?.insertedCount ?? error?.result?.result?.nInserted ?? 0);
  const reason =
    error?.code === 11000 ? 'A record conflicts with an existing unique value.' : error.message;
  return (
    (count > 0
      ? `${count} records were imported before the failure. Review them before retrying. `
      : '') + reason
  );
}

module.exports = { importNumber, contactRows, importFailure };
