'use strict';
const { ObjectId } = require('mongodb');
const { context, allowed, fail } = require('../utils/branch-access');
const { rounds, progress } = require('../helpers/kitchen-rounds');
const states = ['new', 'preparing', 'ready'];
const filter = (c) => ({
  license: c.license,
  branch_id: c.branchId,
  ...require('../helpers/kitchen-eligibility').kitchenEligibility(),
});
async function scope(req) {
  if (!req.user || !allowed(req.user, 'sales'))
    fail('Sales permission is required for this pilot kitchen screen.', 403);
  return context(req);
}
function project(sale) {
  // Kitchen instructions are not inferred from product marketing descriptions.
  // Keep legacy line IDs identical to Captain, even when descriptions are hidden.
  return rounds(sale, { descriptions: false }).flatMap((round) => {
    const work = sale.kitchen_work?.[round.id] || {};
    const items = round.items
      .filter((i) => !i.held && i.remaining > 0)
      .map((i) => {
        const line = work.lines?.[i.id] || {};
        const quantities = progress(i, work);
        const { ready, collected } = quantities;
        return {
          id: i.id,
          ...quantities,
          name: i.name,
          ...require('../utils/kitchen-amount').snapshot(i),
          qty: i.remaining,
          total: i.quantity,
          served: i.served,
          note: i.note,
          seat: i.seat,
          course: i.course,
          allergies: i.allergies,
          allergy_note: i.allergy_note,
          ready,
          collected,
          collector: line.collector || '',
          collectorName: line.collectorName || '',
          readyVersion: line.readyVersion || 0,
        };
      });
    if (!items.length) return [];
    const change = round.id === 'legacy' ? null : sale.changes?.[Number(round.id.slice(1))];
    const owner =
      change?.kitchen_actor ||
      (round.id === 'legacy' || round.id === 'c0' ? sale.kitchen_actor : null) ||
      {};
    const state = items.every((i) => i.ready >= i.total)
      ? 'ready'
      : work.state === 'preparing' ||
          work.state === 'ready' ||
          items.some((i) => i.ready > i.served)
        ? 'preparing'
        : 'new';
    return [
      {
        id: String(sale._id) + ':' + round.id,
        saleId: String(sale._id),
        roundId: round.id,
        table: String(sale.table_number || ''),
        outlet: String(sale.outlet_snapshot?.name || ''),
        roomReference: String(sale.room_reference || ''),
        placedAt: round.fired_at || round.ordered_at,
        state,
        owner: String(owner.id || ''),
        ownerName: String(owner.name || ''),
        revision: Number(work.revision) || 0,
        items,
      },
    ];
  });
}
async function list(req) {
  const c = await scope(req);
  const cursor = req.db
    .collection('sales')
    .find(
      { ...filter(c), kitchen_closed: { $ne: true } },
      {
        projection: {
          table_number: 1,
          'outlet_snapshot.name': 1,
          room_reference: 1,
          created_date: 1,
          items: 1,
          changes: 1,
          kitchen_service: 1,
          kitchen_work: 1,
          kitchen_actor: 1,
        },
      }
    )
    .sort({ created_date: 1 });
  const tickets = [];
  try {
    for await (const sale of cursor) {
      tickets.push(...project(sale));
      if (tickets.length > 500)
        fail(
          'More than 500 open kitchen tickets. Complete old tickets before using this board.',
          409
        );
    }
  } finally {
    await cursor.close();
  }
  return {
    branch: String(c.branch.branch_name || ''),
    settings: c.branch.kitchen_board_settings || { orangeMinutes: 5, redMinutes: 10, pulse: true },
    serverTime: new Date().toISOString(),
    tickets,
  };
}
async function mutate(req, captain = false) {
  const c = await scope(req),
    b = req.body || {};
  const lineAction = b.operation && ['ready', 'collect', 'serve'].includes(b.operation);
  if (
    typeof b.saleId !== 'string' ||
    !ObjectId.isValid(b.saleId) ||
    !/^(c\d+|legacy)$/.test(b.roundId || '') ||
    !Number.isInteger(b.revision) ||
    b.revision < 0 ||
    !/^[\w-]{16,80}$/.test(b.actionId || '') ||
    (captain
      ? !['collect', 'serve'].includes(b.operation)
      : lineAction
        ? b.operation !== 'ready'
        : !states.includes(b.state))
  )
    fail('Invalid kitchen action.', 400);
  const collection = req.db.collection('sales'),
    where = { ...filter(c), _id: new ObjectId(b.saleId) };
  const sale = await collection.findOne(where);
  if (!sale) fail('This order is no longer open.', 409);
  const current = sale.kitchen_work?.[b.roundId] || {};
  const actor = String(req.user._id || req.user.id);
  const actionKey = JSON.stringify([
    b.operation || b.state,
    b.itemId || null,
    b.quantity ?? null,
    b.revision,
  ]);
  const ticket = project(sale).find((t) => t.roundId === b.roundId);
  if (current.actionId === b.actionId && current.by === actor) {
    if (current.actionKey !== actionKey)
      fail('This action ID was already used. Refresh and try again.', 409);
    return { ticket: ticket || null };
  }
  if (!ticket || ticket.revision !== b.revision)
    fail('Order changed. Refresh before trying again.', 409);
  const lines = { ...(current.lines || {}) },
    service = { ...(sale.kitchen_service || {}) };
  // Materialize legacy round-ready state before updating one line.
  for (const i of ticket.items)
    lines[i.id] = { ...lines[i.id], ready: i.ready, collected: i.collected };
  let state = ticket.state;
  const ready = (i, quantity) => {
    if (!Number.isFinite(quantity) || quantity < i.collected || quantity > i.total)
      fail('Ready quantity must include collected items and cannot exceed this order.', 409);
    const line = lines[i.id];
    if (quantity > i.ready) line.readyVersion = (line.readyVersion || 0) + 1;
    line.ready = quantity;
  };
  if (lineAction) {
    const item = ticket.items.find((i) => i.id === b.itemId);
    if (!item || typeof b.quantity !== 'number' || !Number.isFinite(b.quantity))
      fail('Invalid item quantity.', 400);
    if (b.operation === 'ready') {
      ready(item, b.quantity);
      state = 'preparing';
    }
    if (b.operation === 'collect') {
      if (item.collected > item.served && item.collector && item.collector !== actor)
        fail('Another Captain has already collected these items.', 409);
      if (b.quantity <= item.collected || b.quantity > item.ready)
        fail('Only ready items can be collected.', 409);
      Object.assign(lines[item.id], {
        collected: b.quantity,
        collector: actor,
        collectorName: String(req.user.name || req.user.username || req.user.email || 'Captain'),
      });
    }
    if (b.operation === 'serve') {
      if (item.collector !== actor || b.quantity <= item.served || b.quantity > item.collected)
        fail('Mark only items you have collected as served.', 409);
      service[item.id] = { quantity: b.quantity, at: new Date(), by: actor };
    }
  } else {
    if (Math.abs(states.indexOf(ticket.state) - states.indexOf(b.state)) !== 1)
      fail('Order changed. Refresh before trying again.', 409);
    state = b.state;
    if (state === 'ready') for (const i of ticket.items) ready(i, i.total);
    if (ticket.state === 'ready' && state === 'preparing')
      for (const i of ticket.items) ready(i, i.collected);
    if (state === 'new' && ticket.items.some((i) => i.ready > i.served))
      fail('Undo item readiness first.', 409);
  }
  const work = {
    ...(sale.kitchen_work || {}),
    [b.roundId]: {
      ...current,
      state,
      lines,
      revision: ticket.revision + 1,
      at: new Date(),
      by: actor,
      actionId: b.actionId,
      actionKey,
    },
  };
  const result = await collection.updateOne(
    {
      ...where,
      items: sale.items,
      changes: sale.changes === undefined ? { $exists: false } : sale.changes,
      kitchen_service:
        sale.kitchen_service === undefined ? { $exists: false } : sale.kitchen_service,
      kitchen_work: sale.kitchen_work === undefined ? { $exists: false } : sale.kitchen_work,
    },
    {
      $set: {
        kitchen_required: true,
        kitchen_closed: !rounds({ ...sale, kitchen_work: work, kitchen_service: service }).some(
          (round) => round.items.some((item) => item.remaining > 0)
        ),
        kitchen_work: work,
        ...(b.operation === 'serve' ? { kitchen_service: service } : {}),
      },
    }
  );
  if (!result.matchedCount) fail('Order changed. Refresh before trying again.', 409);
  try {
    process.emit('posnic:kitchen-served', { branchId: String(c.branchId), saleId: b.saleId });
  } catch {
    /* Polling recovers committed state. */
  }
  return {
    ticket:
      project({ ...sale, kitchen_work: work, kitchen_service: service }).find(
        (t) => t.roundId === b.roundId
      ) || null,
  };
}
async function captainList(req) {
  const c = await scope(req);
  if (c.branch.module_captain_enable === false) fail('Captain is disabled.', 403);
  const data = await list(req),
    actor = String(req.user._id || req.user.id);
  return {
    ...data,
    actor,
    scope: String(c.license) + ':' + String(c.branchId) + ':' + actor,
    tickets: data.tickets.filter((t) => t.items.some((i) => i.ready > i.served)),
  };
}
async function captainAction(req) {
  const c = await scope(req);
  if (c.branch.module_captain_enable === false) fail('Captain is disabled.', 403);
  return mutate(req, true);
}
async function saveSettings(req) {
  if (!req.user || !allowed(req.user, 'settings')) fail('Manager access is required.', 403);
  const c = await context(req),
    b = req.body || {};
  if (
    !Number.isInteger(b.orangeMinutes) ||
    !Number.isInteger(b.redMinutes) ||
    b.orangeMinutes < 1 ||
    b.redMinutes <= b.orangeMinutes ||
    b.redMinutes > 240 ||
    typeof b.pulse !== 'boolean'
  )
    fail('Choose orange and red times from 1 to 240 minutes, with red later than orange.', 400);
  const settings = { orangeMinutes: b.orangeMinutes, redMinutes: b.redMinutes, pulse: b.pulse };
  await req.db
    .collection('branches')
    .updateOne(
      { _id: c.branchId, license: c.license },
      { $set: { kitchen_board_settings: settings } }
    );
  return { settings };
}
module.exports = {
  list,
  project,
  transition: (req) => mutate(req),
  captainList,
  captainAction,
  saveSettings,
};
