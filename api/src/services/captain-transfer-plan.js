'use strict';
const { snapshotFrom } = require('./guest-bill.service');
const { rounds, progress } = require('../helpers/kitchen-rounds');
const orderLine = require('../utils/order-line');
const { createHash } = require('node:crypto');

function fail(message) {
  throw Object.assign(new Error(message), { status: 409 });
}
function units(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000)
    fail('Invalid transfer quantity.');
  const result = Math.round(value * 1000);
  if (Math.abs(value * 1000 - result) > 0.000001) fail('Invalid transfer quantity.');
  return result;
}
// Exact integer allocation: preserve every minor unit, including negative
// discounts and round-off, without multiplying money by a floating-point ratio.
function divide(amount, left, right) {
  if (!Number.isSafeInteger(amount) || left + right <= 0) fail('Invalid transfer amount.');
  const magnitude = BigInt(Math.abs(amount)), total = BigInt(left + right);
  const a = magnitude * BigInt(left), b = magnitude * BigInt(right);
  let first = a / total, second = b / total;
  if (first + second < magnitude) {
    if (a % total >= b % total) first++;
    else second++;
  }
  const sign = amount < 0 ? -1 : 1;
  return [Number(first) * sign, Number(second) * sign];
}

// Read-only preparation for the durable transfer protocol. These views are
// not sale documents and must not be saved by the ordinary add-order path:
// doing so would cook/print and deduct stock for the same food twice.
function plan(sale, branch, requested) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 200)
    fail('Choose items to transfer.');
  const live = (sale.items || []).filter(line => line && !line.return && !line.cancelled &&
    !['cancelled', 'canceled'].includes(String(line.status || '').toLowerCase()) &&
    Number(line.quantity ?? line.item_quantity ?? line.qty) > 0 && String(line.name || line.item_name || '').trim());
  orderLine.validate(live);
  const snapshot = snapshotFrom([sale], branch, sale.table_number || '', { allowZero: true });
  // Billing excludes cancelled/returned lines; kitchen history must use that
  // same live set or a mixed selection could move non-billable ghost dishes.
  const service = rounds({ ...sale, items: live }).flatMap(round => round.items);
  const serviceTotals = new Map();
  for (const line of service)
    serviceTotals.set(line.line_key, (serviceTotals.get(line.line_key) || 0) + units(line.quantity));
  snapshot.lines.forEach((line, index) => {
    // Legacy aliases may disagree (quantity vs item_quantity). Do not choose
    // one silently and create a bill/service mismatch during a transfer.
    if (serviceTotals.get(orderLine.key(live[index])) !== units(line.quantity))
      fail('Order changed. Refresh before transferring items.');
  });
  const selections = new Map();
  for (const request of requested) {
    if (!request || typeof request.id !== 'string' || selections.has(request.id))
      fail('Choose each item once.');
    const line = service.find(row => row.id === request.id);
    if (!line) fail('Order changed. Refresh before transferring items.');
    const quantity = units(request.quantity), available = units(line.quantity);
    if (!quantity || quantity > available) fail('Order changed. Refresh before transferring items.');
    const alreadyServed = units(line.served);
    // For a partly served round, the staff member must identify which plates
    // move. Guessing would change the kitchen's outstanding quantity.
    let served = request.servedQuantity;
    if (served === undefined) {
      if (quantity === available) served = line.served;
      else if (!alreadyServed) served = 0;
      else if (alreadyServed === available) served = request.quantity;
      else fail('Choose the served quantity to transfer.');
    }
    const servedUnits = units(served);
    if (servedUnits > quantity || servedUnits > alreadyServed || quantity - servedUnits > available - alreadyServed)
      fail('Order changed. Refresh before transferring items.');
    selections.set(request.id, { quantity, served: servedUnits });
  }
  const source = { lines: [], rounds: [], components: {}, totalMinor: 0 };
  const destination = { lines: [], rounds: [], components: {}, totalMinor: 0 };
  const movedByLine = new Map();
  for (const line of service) {
    const selected = selections.get(line.id) || { quantity: 0, served: 0 };
    movedByLine.set(line.line_key, (movedByLine.get(line.line_key) || 0) + selected.quantity);
    const work = sale.kitchen_work?.[line.round] || {};
    const status = work.lines?.[line.id] || {};
    const current = progress(line, work);
    // Within the selected unserved plates, move collected plates first, then
    // ready plates. The preview exposes these counts; no plate goes backwards
    // from collected to preparing and neither table gains new cooked food.
    const collected = units(current.collected), ready = units(current.ready);
    const picked = Math.min(selected.quantity - selected.served, collected - units(line.served));
    const readyOnly = Math.min(selected.quantity - selected.served - picked, ready - collected);
    const movedCollected = selected.served + picked;
    const movedReady = movedCollected + readyOnly;
    for (const [target, quantity, served, readyCount, collectedCount] of [
      [source, units(line.quantity) - selected.quantity, units(line.served) - selected.served, ready - movedReady, collected - movedCollected],
      [destination, selected.quantity, selected.served, movedReady, movedCollected],
    ]) {
      if (!quantity) continue;
      target.rounds.push({ ...structuredClone(line), quantity: quantity / 1000,
        served: served / 1000, remaining: (quantity - served) / 1000,
        ready: readyCount / 1000, collected: collectedCount / 1000,
        collector: status.collector || '', collectorName: status.collectorName || '',
        readyVersion: status.readyVersion || 0, kitchenState: work.state || 'new',
        origin: { saleId: String(sale._id), roundLineId: line.id } });
    }
  }
  snapshot.lines.forEach((line, index) => {
    const key = orderLine.key(live[index]);
    const total = units(line.quantity), moved = movedByLine.get(key) || 0;
    if (moved > total) fail('Order changed. Refresh before transferring items.');
    const views = [source, destination].map(() => ({ ...structuredClone(line), lineKey: key, components: [], amountMinor: 0 }));
    for (const component of line.components) {
      divide(component.minor, total - moved, moved).forEach((minor, side) => {
        views[side].components.push({ key: component.key, minor });
        views[side].amountMinor += minor;
      });
    }
    [total - moved, moved].forEach((quantity, side) => {
      if (!quantity) return;
      const target = side ? destination : source, view = views[side];
      view.quantity = quantity / 1000;
      target.lines.push(view);
      target.totalMinor += view.amountMinor;
      for (const component of view.components)
        target.components[component.key] = (target.components[component.key] || 0) + component.minor;
    });
  });
  if (!destination.lines.length || source.totalMinor < 0 || destination.totalMinor < 0 ||
    source.totalMinor + destination.totalMinor !== snapshot.totalMinor)
    fail('The bill totals do not match. Refresh and try again.');
  const revision = createHash('sha256').update(JSON.stringify({ bill: snapshot.revision, service, work: sale.kitchen_work || {} })).digest('hex');
  return { sourceId: String(sale._id), revision, currencyCode: snapshot.currencyCode,
    currencyDigits: snapshot.currencyDigits, currencySymbol: snapshot.currencySymbol,
    totalMinor: snapshot.totalMinor, source, destination };
}
module.exports = { plan };
