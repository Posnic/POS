'use strict';
const { runStockBatch } = require('./extension-stock-journal');
async function executeEffect(context, effect) {
  if (effect?.kind === 'payment.prepare')
    return require('./extension-payments').preparePayment(context, effect);
  if (effect?.kind === 'payment.cash')
    return require('./extension-payments').confirmCash(context, effect);
  if (effect?.kind === 'payment.cancel')
    return require('./extension-payments').cancelPayment(context, effect);
  if (['stock.return', 'stock.clear'].includes(effect?.kind)) {
    const lifecycle = require('./extension-stock-lifecycle');
    return (effect.kind === 'stock.return' ? lifecycle.returnStock : lifecycle.clearStockBasket)(
      context.db,
      { ...context.scope, actorId: context.actorId },
      {
        extensionId: context.extensionId,
        operationId: context.operationId,
        stockOperationId: effect.stockOperationId,
        lines: effect.lines,
        stream: { id: context.extensionId, sequence: context.sequence },
      }
    );
  }
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
      stream: { id: context.extensionId, sequence: context.sequence },
    }
  );
  return result.status === 'rejected' ? { rejected: true } : result;
}
module.exports = { executeEffect, prepareContext: require('./extension-catalog').prepareContext };
