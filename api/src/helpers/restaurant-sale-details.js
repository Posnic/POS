'use strict';
const { rounds } = require('./kitchen-rounds');

function date(value) {
  if (value == null || value === '') return null;
  const raw = value?.$date ?? value;
  const parsed = new Date(raw?.$numberLong ? Number(raw.$numberLong) : raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function name(value) {
  if (value && typeof value === 'object') return String(value.name || value.id || '');
  return value == null ? '' : String(value);
}

// A read-only projection of recorded facts. Closing or paying a bill is not proof of service.
module.exports = function restaurantSaleDetails(sale, timeZone) {
  sale = {
    ...sale,
    items: (Array.isArray(sale.items) ? sale.items : []).filter(
      (line) => line && typeof line === 'object'
    ),
    changes: (Array.isArray(sale.changes) ? sale.changes : [])
      .map((change) => (change && typeof change === 'object' ? change : {}))
      .map((change) => ({
        ...change,
        items: (Array.isArray(change.items) ? change.items : []).map((line) =>
          line && typeof line === 'object' ? line : {}
        ),
      })),
  };
  const client = sale.client || {};
  const events = (Array.isArray(sale.changes) ? sale.changes : []).map((change, index) => ({
    kind: 'kot',
    sequence: index + 1,
    at: date(change.timestamp),
    actor: name(change.kitchen_actor || change.actor),
    note: String(change.preparation_note || ''),
    reason: String(change.reason || ''),
    items: (Array.isArray(change.items) ? change.items : []).map((line) => ({
      name: String(line.item_name || line.name || ''),
      quantity: Number(line.item_quantity ?? line.quantity ?? line.sale_inline_item_qty) || 0,
      action: String(line.process || ''),
      note: String(line.item_note || line.item_description || ''),
    })),
  }));
  for (const round of rounds(sale)) {
    for (const line of round.items) {
      if (!line.served || !line.served_at) continue;
      events.push({
        kind: 'served',
        at: line.served_at,
        actor: name(sale.kitchen_service?.[line.id]?.by),
        items: [{ name: line.name, quantity: line.served }],
      });
    }
  }
  for (const [field, kind] of [
    ['bill_requested_at', 'bill_requested'],
    ['bill_printed_at', 'bill_printed'],
  ]) {
    if (date(sale[field])) events.push({ kind, at: date(sale[field]), items: [] });
  }
  for (const entry of Array.isArray(sale.captain_audit) ? sale.captain_audit : []) {
    if (entry.action === 'handover')
      events.push({
        kind: 'handover',
        at: date(entry.at),
        actor: name(entry.actor),
        to: name(entry.to),
        items: [],
      });
  }
  events.sort((a, b) => (a.at || '9999').localeCompare(b.at || '9999'));
  return {
    time_zone: timeZone || 'Asia/Kolkata',
    table: String(sale.table_number || ''),
    covers: sale.person_count ?? null,
    order_type: String(sale.dine_type || sale.fulfilment || ''),
    ordered_at: date(sale.created_date || sale.createdAt),
    taken_by: name(sale.kitchen_actor) || String(client.staff_name || sale.created_by || ''),
    assigned_to: name(sale.assigned_staff),
    device: String(client.device_model || client.device_id || ''),
    device_id: String(client.device_id || ''),
    source: String(client.app || sale.channel || sale.sale_method || ''),
    app_version: String(client.app_version || ''),
    preparation_note: String(sale.preparation_note || ''),
    rounds: rounds(sale),
    events,
  };
};
