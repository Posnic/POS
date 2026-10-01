'use strict';
const { createHash } = require('crypto');
const orderLine = require('../utils/order-line');
const serviceLine = require('../utils/service-line');
const kitchenAmount = require('../utils/kitchen-amount');

// Change positions are append-only ticket identities, independent of product IDs.
function date(value) {
  if (value == null || value === '') return null;
  const raw = value && value.$date !== undefined ? value.$date : value;
  const parsed = new Date(raw && raw.$numberLong ? Number(raw.$numberLong) : raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function product(line) {
  return String(
    line.item_id || line.item || line.product_id || line._id || line.item_name || line.name || ''
  );
}
function quantity(line) {
  return Math.max(0, Number(line.item_quantity ?? line.quantity ?? line.sale_inline_item_qty) || 0);
}
function rounds(sale, { descriptions = true } = {}) {
  const result = [];
  const current = new Map();
  const items = (sale.items || []).filter(
    (line) =>
      line &&
      !line.return &&
      !line.cancelled &&
      !['cancelled', 'canceled'].includes(String(line.status || '').toLowerCase())
  );
  for (const line of items) {
    const key = orderLine.key(line) || product(line);
    current.set(key, (current.get(key) || 0) + quantity(line));
  }
  const changes = Array.isArray(sale.changes) ? sale.changes : [];
  for (let c = 0; c < changes.length; c++) {
    const change = changes[c];
    for (let i = 0; i < (change.items || []).length; i++) {
      const line = change.items[i];
      const key = orderLine.key(line) || product(line);
      const qty = quantity(line);
      if (String(line.process).toLowerCase() === 'amend') {
        for (const original of result.filter((row) => row.line_key === key)) {
          const held = original.held;
          Object.assign(original, serviceLine.metadata(line), {
            held,
            note: String(line.item_description || ''),
          });
        }
      } else if (String(line.process).toLowerCase() === 'fire') {
        const original = result.find(
          (row) => row.id === line.source_round_line && row.line_key === key
        );
        if (original && original.held) {
          original.held = false;
          original.fired_at = date(change.timestamp);
          original.round = `c${c}`;
        }
      } else if (String(line.process).toLowerCase() === 'transfer-out') {
        // A transfer names the original round; cancelling newest-first would
        // move the wrong plates when the customer orders the same dish again.
        const original = result.find(
          (row) => row.id === line.source_round_line && row.line_key === key
        );
        if (original)
          original.quantity = Math.max(0, Math.round((original.quantity - qty) * 1000) / 1000);
      } else if (String(line.process).toLowerCase() === 'cancel') {
        let remaining = qty;
        // Cancel the newest outstanding additions first, keeping earlier service history.
        for (const previous of [...result].reverse().filter((row) => row.line_key === key)) {
          const removed = Math.min(remaining, previous.quantity);
          previous.quantity -= removed;
          remaining -= removed;
        }
      } else if (['add', 'transfer-in'].includes(String(line.process).toLowerCase()) && qty > 0) {
        const transferred = String(line.process).toLowerCase() === 'transfer-in';
        result.push({
          id: `c${c}i${i}`,
          round: `c${c}`,
          product: product(line),
          line_key: key,
          ...serviceLine.metadata(line),
          ...kitchenAmount.snapshot(line),
          ordered_at:
            (transferred && date(line.original_ordered_at)) ||
            date(change.timestamp) ||
            date(sale.created_date),
          ...(transferred && line.transfer_origin ? { origin: { ...line.transfer_origin } } : {}),
          ...(transferred && date(line.original_fired_at)
            ? { fired_at: date(line.original_fired_at) }
            : {}),
          quantity: qty,
          name: String(line.item_name || line.name || ''),
          note: String(
            line.item_note || ((descriptions || line.line_id) && line.item_description) || ''
          ),
          spice_level: line.spice_level,
        });
      }
    }
  }
  // Legacy tickets without complete change logs still appear and can be served.
  for (let i = 0; i < items.length; i++) {
    const line = items[i],
      key = orderLine.key(line) || product(line);
    const logged = result
      .filter((row) => row.line_key === key)
      .reduce((n, row) => n + row.quantity, 0);
    const missing = Math.min(quantity(line), Math.max(0, (current.get(key) || 0) - logged));
    if (missing)
      result.push({
        id:
          'l' +
          createHash('sha256')
            .update(
              JSON.stringify([
                key,
                line.item_note || line.item_description || '',
                line.spice_level || '',
                line.modifiers || [],
              ])
            )
            .digest('hex')
            .slice(0, 24),
        round: 'legacy',
        product: product(line),
        line_key: key,
        ...serviceLine.metadata(line),
        ...kitchenAmount.snapshot(line),
        ordered_at: date(sale.created_date),
        quantity: missing,
        name: String(line.item_name || line.name || line.sale_inline_item_name || ''),
        note: String(
          line.item_note || ((descriptions || line.line_id) && line.item_description) || ''
        ),
        spice_level: line.spice_level,
      });
  }
  const groups = new Map();
  for (const row of result) {
    row.quantity = Math.min(row.quantity, current.get(row.line_key) || 0);
    current.set(row.line_key, Math.max(0, (current.get(row.line_key) || 0) - row.quantity));
    if (!row.quantity) continue;
    const service = (sale.kitchen_service || {})[row.id] || {};
    row.served = Math.min(row.quantity, Math.max(0, Number(service.quantity) || 0));
    row.served_at = date(service.at);
    row.remaining = row.quantity - row.served;
    if (!groups.has(row.round))
      groups.set(row.round, {
        id: row.round,
        ordered_at: row.ordered_at,
        fired_at: row.fired_at || null,
        items: [],
      });
    groups.get(row.round).items.push(row);
  }
  return [...groups.values()];
}
function tickets(sale) {
  const closed = sale.kitchen_required
    ? null
    : date(sale.bill_requested_at || sale.bill_printed_at);
  return rounds(sale, { descriptions: false }).flatMap((round) => {
    const kitchenTime = round.fired_at || round.ordered_at;
    if (closed && (!kitchenTime || kitchenTime <= closed)) return [];
    const items = round.items
      .filter((line) => !line.held && line.remaining > 0)
      .map((line) => ({
        id: line.id,
        qty: line.remaining,
        ...progress(line, sale.kitchen_work?.[round.id] || {}),
        name: line.name,
        ...kitchenAmount.snapshot(line),
        note: line.note,
        seat: line.seat,
        course: line.course,
        allergies: line.allergies,
        allergy_note: line.allergy_note,
      }));
    return items.length
      ? [
          {
            id: `${sale._id}:${round.id}`,
            table: String(sale.table_number || ''),
            outlet: String(sale.outlet_snapshot?.name || ''),
            roomReference: String(sale.room_reference || ''),
            orderNumber: String(sale.sales_id || sale.token_id || ''),
            placedAt: kitchenTime,
            items,
          },
        ]
      : [];
  });
}
function progress(line, work = {}) {
  const status = work.lines?.[line.id] || {};
  const ready = Math.max(
    line.served,
    Math.min(
      line.quantity,
      Number(status.ready ?? (work.state === 'ready' ? line.quantity : 0)) || 0
    )
  );
  const collected = Math.max(line.served, Math.min(ready, Number(status.collected) || 0));
  return {
    ready,
    collected,
    served: line.served,
    preparing: Math.max(0, line.quantity - ready),
    readyToCollect: Math.max(0, ready - collected),
    pickedUp: Math.max(0, collected - line.served),
    started: work.state === 'preparing' || work.state === 'ready' || ready > line.served,
  };
}
function cancellations(sale, now = Date.now()) {
  return (sale.changes || []).flatMap((change, index) => {
    const at = date(change.timestamp);
    if (!at || now - Date.parse(at) > 300000 || Date.parse(at) > now) return [];
    const items = (change.items || [])
      .filter(
        (line) =>
          String(line.process).toLowerCase() === 'cancel' && !line.held && quantity(line) > 0
      )
      .map((line, itemIndex) => ({
        id: `cancel${index}i${itemIndex}`,
        qty: quantity(line),
        name: String(line.item_name || line.name || ''),
        ...kitchenAmount.snapshot(line),
      }));
    return items.length
      ? [
          {
            id: `${sale._id}:cancel${index}`,
            cancelled: true,
            cancelledAt: at,
            placedAt: at,
            table: String(sale.table_number || ''),
            items,
          },
        ]
      : [];
  });
}
module.exports = { rounds, tickets, cancellations, progress };
