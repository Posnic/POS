'use strict';
const { ObjectId } = require('mongodb');
const inventory = require('./mobile-inventory');
const mobile = require('./mobile-pos');

// Audit and availability are one atomic item write, replicated with the item.
// No stock effect, deletion, approval workflow or offline command replay.
async function change(req) {
  const c = await inventory.access(req, true);
  const { id, changes } = req.body || {};
  if (
    !/^[a-zA-Z0-9_-]{12,80}$/.test(id || '') ||
    !Array.isArray(changes) ||
    !changes.length ||
    changes.length > 100 ||
    new Set(changes.map((x) => String(x?.itemId).toLowerCase())).size !== changes.length
  )
    mobile.fail('Review between 1 and 100 distinct products.', 400);
  for (const x of changes) {
    if (
      !/^[a-f0-9]{24}$/i.test(x?.itemId || '') ||
      typeof x.available !== 'boolean' ||
      typeof x.revision !== 'string' ||
      x.revision.length > 80
    )
      mobile.fail('Invalid availability change.', 400);
  }
  const items = req.db.collection('items');
  const results = [];
  for (const x of changes) {
    const scope = {
      _id: new ObjectId(x.itemId),
      license: c.license,
      branch_id: c.branchId,
      is_deleted: { $ne: true },
      del_status: { $nin: [1, '1', true] },
    };
    let row = await items.findOne(scope);
    if (!row) {
      results.push({ itemId: x.itemId, state: 'conflict' });
      continue;
    }
    const replay = row.availability_history?.find((e) => e.id === id);
    if (replay) {
      if (replay.to !== x.available || replay.actor !== String(c.userId))
        mobile.fail('Change identity already used.', 409);
      if (row.availability_revision !== id) {
        results.push({ itemId: x.itemId, state: 'conflict', item: inventory.item(row) });
        continue;
      }
    } else {
      if ((row.availability_revision || '') !== x.revision) {
        results.push({ itemId: x.itemId, state: 'conflict', item: inventory.item(row) });
        continue;
      }
      const lastAt = Math.max(0, ...(row.availability_history || []).map(e => +new Date(e.at) || 0));
      const at = new Date(Math.max(Date.now(), lastAt + 1));
      const result = await items.updateOne(
        {
          ...scope,
          ...(x.revision
            ? { availability_revision: x.revision }
            : {
                $or: [{ availability_revision: { $exists: false } }, { availability_revision: '' }],
              }),
        },
        {
          $set: { available_for_sale: x.available, availability_revision: id, updated_date: at },
          $push: {
            availability_history: {
              id,
              actor: String(c.userId),
              at,
              from: row.available_for_sale !== false,
              to: x.available,
            },
          },
        }
      );
      if (!result.matchedCount) {
        results.push({ itemId: x.itemId, state: 'conflict' });
        continue;
      }
      row = await items.findOne(scope);
    }
    results.push({ itemId: x.itemId, state: 'confirmed', item: inventory.item(row) });
  }
  return { results, confirmedAt: new Date().toISOString() };
}
async function status(req) {
  const c = await mobile.context(req, Boolean(req.handsetDevice));
  if (!mobile.allowed(req.user, 'sales') && !mobile.allowed(req.user, 'item', 'read'))
    mobile.fail('Catalogue access required.', 403);
  const rows = await req.db
    .collection('items')
    .find(
      { license: c.license, branch_id: c.branchId, availability_revision: { $exists: true } },
      { projection: { _id: 1, available_for_sale: 1, availability_revision: 1 } }
    )
    .sort({ _id: 1 })
    .toArray();
  return {
    revision: mobile.hash(mobile.canonical(rows)),
    hidden: rows.filter((r) => r.available_for_sale === false).map((r) => String(r._id)),
  };
}
module.exports = { change, status };
