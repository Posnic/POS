'use strict';
// Repair only generator-owned records; never reinterpret a customer's edits.
const seed = require('./demo-seed');
const untouched = (row) =>
  row.demo_pack &&
  row.created_by === 'Demo data' &&
  row.demo_seed_version !== 2 &&
  row.created_date &&
  +new Date(row.created_date) === +new Date(row.updated_date) &&
  (!row.updated_by || row.updated_by === 'Demo data') &&
  !(row.items_return || []).length;
const round = (n) => Math.round(n * 100) / 100;
function aliases(row, kind) {
  const items = (row.items || []).map((l) => {
    const qty = Number(l.item_quantity ?? l.qty ?? l.quantity);
    const price = Number(l.item_price ?? l.unit_price ?? l.price);
    const total = Number(l.total_amount ?? l.line_total ?? l.total);
    if (
      !(qty > 0) ||
      !(price >= 0) ||
      !Number.isFinite(total) ||
      Math.abs(round(qty * price) - total) > 0.01
    )
      return null;
    return {
      ...l,
      item_name: l.item_name || l.name,
      item_quantity: qty,
      quantity: qty,
      qty,
      item_price: price,
      unit_price: price,
      item_unit: l.item_unit || l.unit || 'qty',
      total_amount: total,
      line_total: total,
      ...(kind === 'receivings' ? { qty_received: qty } : {}),
    };
  });
  if (!items.length || items.some((l) => !l)) return null;
  const total = round(items.reduce((n, l) => n + l.total_amount, 0));
  const header = Number(row.total_amount ?? row.total ?? row.sales_total);
  if (!Number.isFinite(header) || Math.abs(total - header) > 0.01) return null;
  return {
    items,
    demo_seed_version: 2,
    ...(kind === 'receivings'
      ? {
          subtotal_amount: total,
          items_subtotal: total,
          items_total: total,
          tax: 0,
          items_return_total: 0,
          items_return_subtotal: 0,
          total_items: items.length,
        }
      : {}),
  };
}
async function repairDemoRecords(db) {
  for (const kind of ['sales', 'quotes', 'receivings']) {
    const collection = db.collection(kind);
    const cursor = collection.find({
      demo_pack: { $exists: true },
      created_by: 'Demo data',
      demo_seed_version: { $ne: 2 },
    });
    for await (const row of cursor) {
      if (!untouched(row)) continue;
      let patch = aliases(row, kind);
      if (!patch) continue;
      if (kind === 'receivings' && /^(restaurant|cafe|bakery|coffee)$/i.test(row.demo_pack)) {
        const items = await db
          .collection('items')
          .find({
            demo_pack: row.demo_pack,
            license: row.license,
            'branch_access.branch_id': row.branch_id,
            demo_purchase_supply: { $ne: true },
          })
          .toArray();
        const branch = {
          branch_id: row.branch_id,
          branch_name: row.branch_name,
          license: row.license,
        };
        const now = new Date(row.demo_seeded_at || row.created_date);
        const supplies = seed.buildPurchaseSupplies({ items, branch, pack: row.demo_pack, now });
        if (!supplies.length) continue;
        const index = Number(String(row.receiving_id).match(/R-DEMO-(\d+)$/)?.[1]) - 1;
        if (!(index >= 0 && index < 5)) continue;
        const supplier = {
          _id: row.supplier_id,
          name: row.supplier_name,
          phone: row.supplier_phone,
        };
        const supplierRow = await db
          .collection('suppliers')
          .findOne({
            _id: row.supplier_id,
            license: row.license,
            branch_id: row.branch_id,
            demo_pack: row.demo_pack,
          });
        if (
          supplierRow &&
          supplierRow.created_by === 'Demo data' &&
          +new Date(supplierRow.created_date) === +new Date(supplierRow.updated_date) &&
          (!supplierRow.updated_by || supplierRow.updated_by === 'Demo data')
        ) {
          const name = seed.supplyNames[index] + ' (sample)';
          const changed = await db
            .collection('suppliers')
            .updateOne(
              {
                _id: supplierRow._id,
                name: supplierRow.name,
                updated_date: supplierRow.updated_date,
              },
              {
                $set: {
                  name,
                  demo_original_name: supplierRow.demo_original_name || supplierRow.name,
                },
              }
            );
          if (changed.matchedCount) supplier.name = name;
        }
        const rebuilt = seed.buildPurchases({
          items: supplies,
          suppliers: [supplier],
          branch,
          pack: row.demo_pack,
          now,
        })[index];
        if (!rebuilt) continue;
        for (const supply of supplies)
          await db
            .collection('items')
            .updateOne({ _id: supply._id }, { $setOnInsert: supply }, { upsert: true });
        patch = {
          ...patch,
          supplier_name: supplier.name,
          items: rebuilt.items,
          subtotal_amount: rebuilt.subtotal_amount,
          items_subtotal: rebuilt.items_subtotal,
          items_total: rebuilt.items_total,
          total_amount: rebuilt.total_amount,
          receiving_total: rebuilt.receiving_total,
          paid_amount: rebuilt.paid_amount,
          number_of_items: rebuilt.items.length,
          total_items: rebuilt.items.length,
        };
      }
      await collection.updateOne(
        {
          _id: row._id,
          demo_seed_version: { $ne: 2 },
          updated_date: row.updated_date,
          items: row.items,
        },
        {
          $set: {
            ...patch,
            demo_repair_original: {
              supplier_name: row.supplier_name,
              items: row.items,
              total_amount: row.total_amount,
              paid_amount: row.paid_amount,
              receiving_total: row.receiving_total,
            },
            demo_repaired_at: new Date(),
          },
        }
      );
    }
  }
}
module.exports = { repairDemoRecords, aliases, untouched };
