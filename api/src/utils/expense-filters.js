const { ObjectId } = require('mongodb');
const { searchPattern } = require('./safe-search');

const invalid = () => {
  throw new Error('Invalid Cash Book filter');
};

// Accept only the escaped, word-search pattern emitted by the list UI.
// Never pass an arbitrary client query or regular expression to MongoDB.
function textFilter(value) {
  if (typeof value === 'string') return value.length <= 200 ? value : invalid();
  if (
    !value ||
    Object.keys(value).some((k) => !['$regex', '$options'].includes(k)) ||
    typeof value.$regex !== 'string' ||
    value.$regex.length > 500 ||
    (value.$options !== undefined && value.$options !== 'i')
  )
    return invalid();
  const pattern = value.$regex;
  const parts = pattern.match(/\(\?=\.\*(?:\\.|[^\\()])*\)/g);
  if (!parts || parts.join('') !== pattern || parts.length > 20) return invalid();
  const tokens = parts.map((part) => {
    const escaped = part.slice(5, -1);
    const literal = escaped.replace(/\\([.*+?^${}()|[\]\\])/g, '$1');
    if (!literal || searchPattern(literal) !== escaped) return invalid();
    return '(?=.*' + searchPattern(literal) + ')';
  });
  return { $regex: tokens.join(''), $options: 'i' };
}

module.exports = function expenseFilters(filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return invalid();
  const result = {};
  for (const key of Object.keys(filters)) {
    const value = filters[key];
    if (['type', 'category', 'recipientname', 'approvedby', 'description'].includes(key)) {
      result[key] = textFilter(value);
    } else if (key === 'branch_id') {
      if (
        !(value instanceof ObjectId) &&
        (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value))
      )
        return invalid();
      result.branch_id = new ObjectId(value);
    } else if (['date', 'created_date', 'updated_date'].includes(key)) {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some((k) => !['$gte', '$lte'].includes(k))
      )
        return invalid();
      const range = {};
      for (const op of ['$gte', '$lte'])
        if (value[op] !== undefined) {
          if (!(value[op] instanceof Date) && typeof value[op] !== 'string') return invalid();
          const date = new Date(value[op]);
          if (!Number.isFinite(date.getTime())) return invalid();
          range[op] = date;
        }
      result[key] = range;
    } else return invalid();
  }
  return result;
};
