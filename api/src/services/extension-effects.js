'use strict';
const { runStockBatch } = require('./extension-stock-journal');
async function executeEffect(context, effect) {
  if (effect?.kind !== 'stock.debit') {
    const error = new Error('extension_effect_unsupported');
    error.code = 'extension_effect_unsupported';
    error.status = 422;
    throw error;
  }
  const result = await runStockBatch(
    context.db,
    { ...context.scope, actorId: context.actorId },
    {
      extensionId: context.extensionId,
      operationId: context.operationId,
      lines: effect.lines,
    }
  );
  return result.status === 'rejected' ? { rejected: true } : result;
}
module.exports = { executeEffect, prepareContext: require('./extension-catalog').prepareContext };
