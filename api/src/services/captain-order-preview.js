'use strict';
const { context, allowed, fail } = require('../utils/branch-access');
const lines = require('../utils/order-line');
const policy = require('./captain-edit-policy');
const sales = require('../repositories/sale.repository');

// Read-only counterpart of the ordinary item editor. Scope and options are
// supplied here, never accepted from the handset's request body.
async function preview(req) {
  if (!req.user?._id || !allowed(req.user, 'sales')) fail('Sales permission is required.', 403);
  const body = req.body || {};
  if (typeof body.order_id !== 'string' || !/^[a-f0-9]{24}$/i.test(body.order_id))
    fail('Choose an order.');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 200)
    fail('Choose items to preview.');
  if (body.status != null && body.status !== 'modified')
    fail('Only item changes can be previewed.');
  if (['table_number', 'table_id', 'dine_type', 'person_count'].some((key) => body[key] != null))
    fail('Preview seating changes separately.');
  for (const line of body.items) {
    if (
      !line ||
      typeof line !== 'object' ||
      !/^[a-f0-9]{24}$/i.test(lines.product(line)) ||
      typeof line.quantity !== 'number' ||
      !Number.isFinite(line.quantity) ||
      line.quantity < 0 ||
      line.quantity > 100000 ||
      typeof line.price !== 'number' ||
      !Number.isFinite(line.price) ||
      line.price < 0 ||
      line.price > 100000000
    )
      fail('Check the item quantity and price.');
  }
  try {
    lines.validate(body.items);
  } catch {
    fail('Choose distinct order items.');
  }
  if (
    body.extra_discount != null &&
    (typeof body.extra_discount !== 'number' ||
      !Number.isFinite(body.extra_discount) ||
      body.extra_discount < 0 ||
      !['amount', 'price', 'fixed', 'percent', 'percentage'].includes(body.extra_discount_type) ||
      body.extra_discount >
        (['percent', 'percentage'].includes(body.extra_discount_type) ? 100 : 100000000))
  )
    fail('Check the discount.');
  if (
    body.seen_at != null &&
    (typeof body.seen_at !== 'string' || !Number.isFinite(Date.parse(body.seen_at)))
  )
    fail('Refresh the order before continuing.', 409);
  const c = await context(req);
  if (c.branch.module_captain_enable === false) fail('Captain is disabled.', 403);
  const editPolicy = await policy.authorize(
    { ...req, body: { ...body, status: 'modified' } },
    { preview: true }
  );
  const result = await sales.updateOrderModel(
    body.order_id,
    body.items.map((line) => ({ ...line })),
    0,
    'modified',
    body.extra_discount_type,
    body.extra_discount,
    body.discount_description,
    null,
    null,
    null,
    {
      preview: true,
      previewContext: { db: req.db, branchId: c.branchId, license: c.license },
      seenAt: body.seen_at,
      editPolicy,
    }
  );
  if (!result.status) fail(result.message || 'Refresh the order before continuing.', 409);
  return result.data;
}
module.exports = { preview };
