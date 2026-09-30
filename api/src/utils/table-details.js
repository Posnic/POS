'use strict';
const shapes = ['square', 'round', 'rectangle'];
function view(row = {}) {
  const capacity = Number.isInteger(row.capacity) && row.capacity > 0 ? row.capacity : 0;
  return {
    capacity,
    max_capacity:
      Number.isInteger(row.max_capacity) && row.max_capacity >= capacity
        ? row.max_capacity
        : capacity,
    area: typeof row.area === 'string' ? row.area : '',
    shape: shapes.includes(row.shape) ? row.shape : 'square',
    ...(Array.isArray(row.adjacent_table_ids)
      ? { adjacent_table_ids: row.adjacent_table_ids.map(String) }
      : {}),
  };
}
function update(data, previous = {}) {
  const next = { ...view(previous) },
    out = {};
  for (const key of ['capacity', 'max_capacity'])
    if (data[key] !== undefined) {
      const value = data[key] === '' ? 0 : Number(data[key]);
      if (!Number.isInteger(value) || value < 0 || value > 1000)
        throw new Error('Enter a seat count between 1 and 1000, or leave it empty.');
      next[key] = value;
      out[key] = value;
    }
  if (data.capacity !== undefined || data.max_capacity !== undefined) {
    if (!next.max_capacity) next.max_capacity = next.capacity;
    if (next.capacity && next.max_capacity < next.capacity)
      throw new Error('Maximum seats cannot be less than normal capacity.');
    out.capacity = next.capacity;
    out.max_capacity = next.max_capacity;
  }
  if (data.area !== undefined) {
    if (
      typeof data.area !== 'string' ||
      data.area.trim().length > 60 ||
      Array.from(data.area).some((c) => c.charCodeAt(0) < 32)
    )
      throw new Error('Enter a dining area of up to 60 characters.');
    out.area = data.area.trim();
  }
  if (data.shape !== undefined) {
    if (!shapes.includes(data.shape)) throw new Error('Choose a table shape.');
    out.shape = data.shape;
  }
  return out;
}
function accommodates(row, guests) {
  const { max_capacity } = view(row);
  return !max_capacity || Number(guests) <= max_capacity;
}
async function adjacentTables(collection, data, scope, ownId) {
  if (data.adjacent_table_ids === undefined) return {};
  const ids = data.adjacent_table_ids;
  if (
    !Array.isArray(ids) ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))
  )
    throw new Error('Choose neighbouring tables from this branch.');
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))].sort();
  if (unique.includes(String(ownId || '').toLowerCase()))
    throw new Error('A table cannot combine with itself.');
  const { ObjectId } = require('mongodb');
  const count = unique.length
    ? await collection.countDocuments({
        ...scope,
        _id: { $in: unique.map((id) => new ObjectId(id)) },
      })
    : 0;
  if (count !== unique.length) throw new Error('Choose neighbouring tables from this branch.');
  return { adjacent_table_ids: unique };
}
async function ensureIdentity(collection) {
  await collection.createIndex(
    { branch_id: 1, license: 1, tableorder_key: 1 },
    { unique: true, partialFilterExpression: { tableorder_key: { $type: 'string' } } }
  );
}
const key = (value) =>
  String(value || '')
    .trim()
    .toUpperCase();
module.exports = { view, update, accommodates, ensureIdentity, key, adjacentTables };
