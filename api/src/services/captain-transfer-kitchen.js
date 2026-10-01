'use strict';
const { plan } = require('./captain-transfer-plan');
const { rounds, progress } = require('../helpers/kitchen-rounds');
const orderLine = require('../utils/order-line');
const serviceLine = require('../utils/service-line');
const { BSON } = require('mongodb');
// Native structuredClone drops BSON prototypes, turning ObjectIds in legacy
// item/history records into plain objects. Preserve their database identity.
const clone = (value) => BSON.EJSON.deserialize(BSON.EJSON.serialize(value));
const live = (line) =>
  line &&
  !line.return &&
  !line.cancelled &&
  !['cancelled', 'canceled'].includes(String(line.status || '').toLowerCase()) &&
  Number(line.quantity ?? line.item_quantity ?? line.qty) > 0 &&
  String(line.name || line.item_name || '').trim();
function quantity(line, value) {
  const result = { ...clone(line), item_quantity: value };
  for (const key of ['quantity', 'qty', 'sale_inline_item_qty'])
    if (key in result) result[key] = value;
  return result;
}
// Pure kitchen projection for a NEW destination check. These item copies keep
// original prices, but are not monetary sale projections and must not be saved
// until the durable transfer writer supplies the allocated financial fields.
function project(sale, branch, requested, at) {
  if (!at || !Number.isFinite(new Date(at).getTime()))
    throw new Error('A transfer timestamp is required.');
  const preview = plan(sale, branch, requested),
    timestamp = new Date(at).toISOString();
  const originals = new Map(
    (sale.items || []).filter(live).map((line) => [orderLine.key(line), line])
  );
  const itemViews = (side) =>
    (sale.items || []).flatMap((line) => {
      if (!live(line)) return side === preview.source ? [clone(line)] : [];
      const kept = side.lines.find((row) => row.lineKey === orderLine.key(line));
      return kept ? [quantity(line, kept.quantity)] : [];
    });
  const source = {
    items: itemViews(preview.source),
    changes: clone(sale.changes || []),
    kitchen_service: clone(sale.kitchen_service || {}),
    kitchen_work: clone(sale.kitchen_work || {}),
  };
  const destination = {
    items: itemViews(preview.destination),
    changes: [],
    kitchen_service: {},
    kitchen_work: {},
  };
  const outgoing = [];
  for (const row of preview.destination.rounds)
    outgoing.push({
      ...quantity(originals.get(row.line_key), row.quantity),
      process: 'transfer-out',
      source_round_line: row.id,
    });
  source.changes.push({ timestamp, items: outgoing });
  // Explicit counts override whole-round readiness after a partial transfer.
  for (const group of rounds(sale))
    for (const row of group.items) {
      const kept = preview.source.rounds.find((line) => line.id === row.id);
      source.kitchen_service[row.id] = {
        ...(source.kitchen_service[row.id] || {}),
        quantity: kept?.served || 0,
      };
      const work = (source.kitchen_work[row.round] ||= {});
      work.lines ||= {};
      work.lines[row.id] = {
        ...(work.lines[row.id] || {}),
        ready: kept?.ready || 0,
        collected: kept?.collected || 0,
      };
    }
  const groups = new Map();
  for (const row of preview.destination.rounds) {
    if (!groups.has(row.round)) groups.set(row.round, []);
    groups.get(row.round).push(row);
  }
  for (const [oldRound, rows] of groups) {
    const index = destination.changes.length,
      roundId = `c${index}`;
    const work = clone(sale.kitchen_work?.[oldRound] || {});
    work.lines = {};
    const items = rows.map((row, i) => {
      const id = `c${index}i${i}`;
      destination.kitchen_service[id] = {
        ...clone(sale.kitchen_service?.[row.id] || {}),
        quantity: row.served,
      };
      work.lines[id] = {
        ...clone(sale.kitchen_work?.[oldRound]?.lines?.[row.id] || {}),
        ready: row.ready,
        collected: row.collected,
      };
      return {
        ...quantity(originals.get(row.line_key), row.quantity),
        ...serviceLine.metadata(row),
        item_name: row.name,
        item_note: row.note,
        spice_level: row.spice_level,
        process: 'transfer-in',
        original_ordered_at: row.ordered_at,
        original_fired_at: row.fired_at || null,
        transfer_origin: clone(row.origin),
      };
    });
    destination.changes.push({ timestamp, items });
    destination.kitchen_work[roundId] = work;
  }
  // Verify through the same reader used by Captain and KDS, including legacy
  // rounds whose IDs are derived from the original preparation identity.
  for (const [view, expected] of [
    [source, preview.source],
    [destination, preview.destination],
  ]) {
    const actual = rounds({ ...sale, ...view }).flatMap((group) => group.items);
    if (actual.length !== expected.rounds.length)
      throw new Error('Transfer kitchen history does not match.');
    for (const [index, row] of actual.entries()) {
      const wanted = expected.rounds[index],
        state = progress(row, view.kitchen_work[row.round]);
      if (
        row.line_key !== wanted.line_key ||
        row.quantity !== wanted.quantity ||
        row.served !== wanted.served ||
        state.ready !== wanted.ready ||
        state.collected !== wanted.collected ||
        row.ordered_at !== wanted.ordered_at
      )
        throw new Error('Transfer kitchen history does not match.');
    }
  }
  return { preview, source, destination };
}
module.exports = { project };
