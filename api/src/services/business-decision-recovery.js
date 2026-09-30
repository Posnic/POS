'use strict';
const { ObjectId } = require('mongodb');
const { isMultiTenant } = require('../db/tenant-context');
const { createCheckoutTransport } = require('./business-checkout-transport');

/** Bounded receipt-only recovery. This module has no financial writer and
 * never issues another execution claim, even if no receipt can be found. */
function createDecisionRecovery(db, { now = Date.now, transport } = {}) {
  const local = db.collection('business_decision_local');
  let running = false,
    indexed = false;
  return {
    async tick() {
      if (
        running ||
        process.env.POSNIC_DESKTOP !== '1' ||
        isMultiTenant() ||
        process.env.POSNIC_BUSINESS_DECISIONS !== '1' ||
        (process.env.POSNIC_SYNC_PAIRED !== '1' &&
          process.env.POSNIC_BUSINESS_LOCAL_DECISIONS !== '1')
      )
        return;
      running = true;
      try {
        if (!indexed) {
          await local.createIndex({ kind: 1, action: 1, executionState: 1, recoveryAt: 1 });
          await db.collection('sales').createIndex(
            {
              'business_decision_receipt.decisionId': 1,
              'business_decision_receipt.executionId': 1,
            },
            { partialFilterExpression: { 'business_decision_receipt.version': 1 } }
          );
          indexed = true;
        }
        const rows = await local
          .find({
            kind: 'command',
            protocolVersion: 1,
            action: 'claim',
            executionState: { $ne: 'applied' },
            $or: [{ recoveryAt: { $exists: false } }, { recoveryAt: { $lte: new Date(now()) } }],
          })
          .sort({ recoveryAt: 1, _id: 1 })
          .limit(4)
          .maxTimeMS(250)
          .toArray();
        const channel = transport || createCheckoutTransport(db, { now });
        for (const row of rows) {
          const nextAt = new Date(now() + 30000);
          // Fairness survives errors and process restart. Taking another pass
          // over the same receipt is safe; taking another sale is never allowed.
          await local.updateOne({ _id: row._id }, { $set: { recoveryAt: nextAt } });
          const body = row.body;
          if (
            !body ||
            !/^[a-f\d]{24}$/.test(body.branchId || '') ||
            !/^[a-f\d]{24}$/.test(body.requestId || '')
          )
            continue;
          try {
            const sale = await db.collection('sales').findOne(
              {
                branch_id: new ObjectId(body.branchId),
                'business_decision_receipt.version': 1,
                'business_decision_receipt.decisionId': body.requestId,
                'business_decision_receipt.executionId': body.executionId,
                'business_decision_receipt.revisionHash': body.revisionHash,
                'business_decision_receipt.requesterId': body.requesterId,
                'business_decision_receipt.deviceId': row.deviceId,
              },
              { projection: { _id: 1 }, maxTimeMS: 250 }
            );
            if (!sale) {
              if (row.consumedAt || row.response?.record?.state === 'applying')
                await local.updateOne(
                  { _id: row._id, executionState: { $ne: 'applied' } },
                  { $set: { recoveryStatus: 'receipt_not_found' } }
                );
              continue;
            }
            const response = await channel.recover({
              branchId: body.branchId,
              requesterId: body.requesterId,
              requestId: body.requestId,
              executionId: body.executionId,
              saleId: String(sale._id),
            });
            const applied =
              response?.state === 'applied' &&
              response.id === body.requestId &&
              response.saleId === String(sale._id);
            await local.updateOne(
              { _id: row._id },
              {
                $set: {
                  saleId: String(sale._id),
                  recoveryStatus: applied ? 'confirmed' : 'waiting_for_sync',
                  ...(applied ? { executionState: 'applied', confirmedAt: new Date(now()) } : {}),
                },
                $unset: { recoveryError: '' },
              }
            );
          } catch (error) {
            await local.updateOne(
              { _id: row._id },
              { $set: { recoveryError: error.code || 'decision_transport_unavailable' } }
            );
          }
        }
      } finally {
        running = false;
      }
    },
  };
}
module.exports = { createDecisionRecovery };
