'use strict';
/*
 * Recover request shapes from express-validator chains.
 *
 * A chain like
 *
 *   body('name')
 *     .trim()
 *     .notEmpty().withMessage('Category name is required')
 *     .isLength({ min: 2, max: 80 })
 *
 * already states the field, where it lives, whether it is required, its type
 * and its bounds. That is an OpenAPI parameter written in a different notation,
 * so the documentation can be derived instead of hand-written and going stale.
 *
 * This reads source text rather than requiring the modules, because requiring
 * them pulls in database config and constants that have no business running
 * during a docs build.
 */
const fs = require('fs');
const path = require('path');

// Validator method -> the JSON Schema it implies.
const TYPES = [
  [/\.isInt\(/, { type: 'integer' }],
  [/\.isFloat\(|\.isDecimal\(|\.isNumeric\(/, { type: 'number' }],
  [/\.isBoolean\(/, { type: 'boolean' }],
  [/\.isArray\(/, { type: 'array' }],
  [/\.isObject\(/, { type: 'object' }],
  [/\.isEmail\(/, { type: 'string', format: 'email' }],
  [/\.isURL\(/, { type: 'string', format: 'uri' }],
  [/\.isISO8601\(|\.isDate\(/, { type: 'string', format: 'date-time' }],
  [/\.isMongoId\(/, { type: 'string', format: 'objectid' }],
];

/*
 * Split a validator array into one entry per field.
 *
 * Chains are separated by a comma at bracket depth zero; splitting naively on
 * commas would cut through `isLength({ min: 2, max: 80 })` and lose the bounds.
 */
function splitChains(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let inStr = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === inStr && body[i - 1] !== '\\') inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseChain(chain, consts = {}) {
  const head = chain.match(/^(body|query|param|header|cookie)\(\s*["'`]([^"'`]+)["'`]/);
  if (!head) return null;
  const [, where, name] = head;
  const num = (v) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : consts[String(v).split('.').pop()]);

  let schema = { type: 'string' };
  for (const [re, s] of TYPES) if (re.test(chain)) { schema = { ...s }; break; }

  const len = chain.match(/\.isLength\(\s*\{([^}]*)\}/);
  if (len) {
    const min = num((len[1].match(/min\s*:\s*([\w.]+)/) || [])[1]);
    const max = num((len[1].match(/max\s*:\s*([\w.]+)/) || [])[1]);
    if (Number.isFinite(min)) schema.minLength = min;
    if (Number.isFinite(max)) schema.maxLength = max;
  }
  const range = chain.match(/\.(?:isInt|isFloat)\(\s*\{([^}]*)\}/);
  if (range) {
    const min = num((range[1].match(/min\s*:\s*([-\w.]+)/) || [])[1]);
    const max = num((range[1].match(/max\s*:\s*([-\w.]+)/) || [])[1]);
    if (Number.isFinite(min)) schema.minimum = min;
    if (Number.isFinite(max)) schema.maximum = max;
  }
  const inList = chain.match(/\.isIn\(\s*\[([^\]]*)\]/);
  if (inList) {
    const vals = [...inList[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
    if (vals.length) schema.enum = vals;
  }

  // The first withMessage is written for a human and reads as a description.
  const msg = chain.match(/\.withMessage\(\s*["'`]([^"'`]+)["'`]/);

  const optional = /\.optional\(/.test(chain);
  const required = !optional && /\.notEmpty\(|\.exists\(/.test(chain);

  const description = msg ? resolveTemplate(msg[1], consts) : null;

  return {
    in: where === 'param' ? 'path' : where,
    name,
    required: where === 'param' ? true : required,
    schema,
    description: description || undefined,
  };
}

/*
 * Bounds are usually written as constants — isLength({ max: FIELD_LIMITS.NAME_MAX }) —
 * so without resolving them the schema loses its limits and every description
 * publishes a raw ${...} template. Both come from the same place, so both are
 * fixed by reading the constants the validation file imports.
 *
 * The constants are read as text rather than required: requiring them drags in
 * whatever else the constants barrel touches, and a docs build should not need
 * a database.
 */
function loadConstants(validationFile) {
  const text = fs.readFileSync(validationFile, 'utf8');
  const values = {};
  for (const imp of text.matchAll(/require\(\s*["'`]([^"'`]*constants[^"'`]*)["'`]\s*\)/g)) {
    const target = path.resolve(path.dirname(validationFile), imp[1]);
    for (const candidate of [target, target + '.js', path.join(target, 'index.js')]) {
      if (!fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) continue;
      const ct = fs.readFileSync(candidate, 'utf8');
      // NAME_MAX: 80  — flat scan is enough; keys are unique enough in practice
      // and a wrong bound is worse than a missing one, so only numbers are taken.
      for (const m of ct.matchAll(/([A-Z][A-Z0-9_]*)\s*:\s*(-?\d+(?:\.\d+)?)\s*[,}]/g)) {
        if (!(m[1] in values)) values[m[1]] = Number(m[2]);
      }
      break;
    }
  }
  return values;
}

/* Replace ${OBJ.KEY} and ${KEY} with the number behind them, where known. */
function resolveTemplate(str, consts) {
  if (!str || !str.includes('${')) return str;
  const out = str.replace(/\$\{\s*(?:[A-Za-z_$][\w$]*\.)?([A-Z][A-Z0-9_]*)\s*\}/g, (m, key) =>
    key in consts ? String(consts[key]) : m
  );
  // Anything still unresolved would publish as literal source, which is worse
  // than saying nothing.
  return out.includes('${') ? null : out;
}

/* Read one validation file into { exportedName: [field, ...] }. */
function parseFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const consts = loadConstants(file);
  const out = {};
  // const validateCreateCategory = [ ... ];
  const re = /(?:const|let|var)\s+(\w+)\s*=\s*\[/g;
  for (const m of text.matchAll(re)) {
    let i = m.index + m[0].length;
    let depth = 1;
    let inStr = null;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (inStr) { if (c === inStr && text[i - 1] !== '\\') inStr = null; }
      else if (c === '"' || c === "'" || c === '`') inStr = c;
      else if (c === '[' || c === '(' || c === '{') depth++;
      else if (c === ']' || c === ')' || c === '}') depth--;
      i++;
    }
    const fields = splitChains(text.slice(m.index + m[0].length, i - 1))
      .map((c) => parseChain(c, consts))
      .filter(Boolean);
    if (fields.length) out[m[1]] = fields;
  }
  return out;
}

/* Every validator in src/middleware, keyed by its exported name. */
function loadAll(middlewareDir) {
  const all = {};
  if (!fs.existsSync(middlewareDir)) return all;
  for (const f of fs.readdirSync(middlewareDir)) {
    if (!/\.validation\.js$/.test(f)) continue;
    Object.assign(all, parseFile(path.join(middlewareDir, f)));
  }
  return all;
}

module.exports = { loadAll, parseFile, parseChain, splitChains };
