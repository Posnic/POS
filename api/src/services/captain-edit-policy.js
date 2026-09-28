'use strict';
const { ObjectId } = require('mongodb');
const { context, allowed, fail } = require('../utils/branch-access');
const { canPos } = require('../utils/pos-permission.util');
const { verifyApproval } = require('../utils/approval-token.util');
const lineIdentity = require('../utils/order-line');
const quantity = (line) => Number(line.quantity ?? line.item_quantity ?? 0);
async function authorize(req) {
  if (!req.user || !allowed(req.user, 'sales')) fail('Sales permission is required.', 403);
  const c = await context(req),
    body = req.body;
  if (!ObjectId.isValid(String(body.order_id))) fail('Choose an order.');
  const sale = await req.db.collection('sales').findOne({
    _id: new ObjectId(String(body.order_id)),
    license: c.license,
    branch_id: c.branchId,
  });
  if (!sale) fail('Order not found.', 404);
  const incoming = new Map(
    (body.items || []).map((line) => [lineIdentity.key(line), quantity(line)])
  );
  const reduced =
    body.status === 'cancelled' ||
    (sale.items || []).some(
      (line) =>
        (incoming.get(lineIdentity.key(line)) || 0) <
        Number(line.item_quantity ?? line.quantity ?? 0)
    );
  const discount =
    body.extra_discount != null &&
    (Number(body.extra_discount) !== Number(sale.extra_discount || 0) ||
      (Number(body.extra_discount) !== 0 && body.extra_discount_type !== sale.extra_discount_type));
  const reason = String(body.change_reason || body.discount_description || '').trim();
  if ((reduced || discount) && (reason.length < 3 || reason.length > 200))
    fail('Enter a reason for this change.', 422);
  const actions = [...(reduced ? ['void_sale'] : []), ...(discount ? ['discount_apply'] : [])];
  const approved = [];
  for (const action of actions) {
    const cap = Number(req.user.access?.pos?.discount_max_percent) || 0;
    const percentage =
      body.extra_discount_type === 'percent'
        ? Number(body.extra_discount)
        : (Number(body.extra_discount) * 100) /
          Math.max(0.01, Number(sale.sales_sub_total || sale.sales_total));
    if (canPos(req.user, action) && !(action === 'discount_apply' && cap > 0 && percentage > cap))
      continue;
    const proof = verifyApproval(body.approval_tokens?.[action] || body.approval_token);
    if (
      !proof ||
      proof.action !== action ||
      String(proof.cashier_user_id) !== String(req.user._id || req.user.id) ||
      String(proof.entity_id) !== String(sale._id)
    ) {
      fail(
        action === 'void_sale'
          ? 'Manager approval required: cancellation'
          : 'Manager approval required: discount',
        422
      );
    }
    approved.push(String(proof.approved_by_user_id));
  }
  return {
    actor: {
      id: String(req.user._id || req.user.id),
      name: String(req.user.name || req.user.username || ''),
    },
    reason,
    approvedBy: approved,
    expectedItems: sale.items,
    expectedChanges: sale.changes,
    branchId: c.branchId,
    license: c.license,
  };
}
module.exports = { authorize };
