'use strict';
const crypto = require('crypto');
const PAGE_SIZE = 256;
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const factsOf = (row) => ({
  hsncode: row.hsncode || '',
  company_price: Number(row.company_price || 0),
  barcode_id: row.barcode_id || '',
  category_name: row.category_name || '',
  supplier_name: row.supplier_name || '',
});

// Content-addressed pages are immutable. Grants reference only fully persisted pages.
async function prepare(db, scope, mapItem) {
  const pages = [],
    counts = [];
  let items = [],
    facts = {},
    count = 0;
  async function flush() {
    if (!items.length) return;
    const key = digest([String(scope.license), String(scope.branchId), items, facts]);
    await db
      .collection('mobile_catalogue_pages')
      .updateOne(
        { _id: key },
        { $setOnInsert: { items, facts, created: new Date() } },
        { upsert: true }
      );
    pages.push(key);
    counts.push(items.length);
    count += items.length;
    items = [];
    facts = {};
  }
  const cursor = db
    .collection('items')
    .find({ license: scope.license, branch_id: scope.branchId, is_deleted: { $ne: true } })
    .sort({ _id: 1 })
    .batchSize(PAGE_SIZE);
  try {
    for await (const row of cursor) {
      const item = mapItem(row);
      items.push(item);
      facts[item.id] = factsOf(row);
      if (items.length === PAGE_SIZE) await flush();
    }
    await flush();
  } finally {
    await cursor.close();
  }
  return { pages, counts, count, digest: digest(pages) };
}
async function hydrate(db, grant, ids) {
  if (!grant.pages) return grant;
  const wanted = new Set(ids),
    items = [],
    facts = {};
  if (wanted.size) {
    const cursor = db
      .collection('mobile_catalogue_pages')
      .find({ _id: { $in: grant.pages }, 'items.id': { $in: [...wanted] } });
    try {
      for await (const page of cursor)
        for (const item of page.items)
          if (wanted.has(item.id)) {
            items.push(item);
            facts[item.id] = page.facts[item.id];
          }
    } finally {
      await cursor.close();
    }
  }
  return { ...grant, items, facts };
}
module.exports = { prepare, hydrate, factsOf, PAGE_SIZE };
