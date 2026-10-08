'use strict';
const crypto = require('node:crypto');
const { ObjectId, BSON } = require('mongodb');
const Money = require('../utils/currency');
const fingerprint = require('../utils/order-request-fingerprint');
const { runStockBatch } = require('./extension-stock-journal');
const { allocateForSale } = require('./extension-stock-allocations');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const dojoAuthorization = Symbol('host-verified-dojo');
const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  error.status = 409;
  throw error;
};
const oid = (value) => {
  if (!/^[a-f\d]{24}$/i.test(String(value ?? ''))) fail('extension_payment_scope_invalid');
  return new ObjectId(String(value));
};
function paymentScope(context) {
  return {
    license: oid(context.scope.license),
    branch_id: oid(context.scope.branchId),
    extensionId: context.extensionId,
    actorId: String(oid(context.actorId)),
  };
}
async function saleContext(db, scope) {
  const branch = await db
    .collection('branches')
    .findOne({ _id: scope.branch_id, license: scope.license });
  const user = await db
    .collection('users')
    .findOne({ _id: oid(scope.actorId), license: scope.license });
  if (!branch || !user) fail('extension_payment_context_unavailable');
  return {
    licenseId: String(scope.license),
    branchId: String(scope.branch_id),
    userId: scope.actorId,
    userName: user.username || user.name || 'Staff',
    branchName: branch.branch_name,
    branchState: String(branch.store_state || branch.state || branch.branch_state || '').trim(),
    printingAddress: branch.printing_address,
    salesPrefix: branch.sales_prefix ?? 'S',
    roundOff: branch.roundOff === true,
    stockManagement: branch.stock_management !== false,
    branchSettings: branch,
  };
}
const publicPayment = (row) => ({
  paymentId: row._id,
  status: row.status,
  ...(row.saleId
    ? {
        saleId: String(row.saleId),
        valueMinor: row.valueMinor,
        quote: row.quote,
        method: row.method,
        currency: row.currency,
      }
    : {}),
});

/** Core-owned payment preparation. The quote is persisted before inventory is
 * reserved, and both stock and quantity allocation are replayable. No provider
 * is contacted and no sale is created by preparation.
 */
async function preparePayment(context, input) {
  const { db } = context,
    scope = paymentScope(context);
  if (
    !['cash', 'card', 'split'].includes(input.method) ||
    !Array.isArray(input.lines) ||
    !input.lines.length ||
    input.lines.length > 100
  )
    fail('extension_payment_invalid');
  if (
    input.customer !== undefined &&
    (typeof input.customer !== 'string' || input.customer.length > 120)
  )
    fail('extension_payment_customer_invalid');
  const lines = input.lines.map((line) => {
    if (!Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0)
      fail('extension_payment_quantity_invalid');
    if (
      line.sellingPrice !== undefined &&
      (typeof line.sellingPrice !== 'number' ||
        !Number.isFinite(line.sellingPrice) ||
        line.sellingPrice < 0)
    )
      fail('extension_payment_price_invalid');
    return {
      itemId: String(oid(line.itemId)),
      quantityMilli: line.quantityMilli,
      ...(line.sellingPrice !== undefined ? { sellingPrice: line.sellingPrice } : {}),
    };
  });
  if (new Set(lines.map((line) => line.itemId)).size !== lines.length)
    fail('extension_payment_duplicate_item');
  if (input.stockOperationId && !/^[a-f\d]{64}$/.test(input.stockOperationId))
    fail('extension_payment_movement_invalid');
  const id = hash(
    `${scope.license}:${scope.branch_id}:${scope.extensionId}:${context.operationId}`
  );
  const digest = hash(
    JSON.stringify({
      actorId: scope.actorId,
      method: input.method,
      lines,
      stockOperationId: input.stockOperationId || null,
      customer: input.customer || '',
    })
  );
  const collection = db.collection('extension_payments');
  try {
    await collection.insertOne({
      _id: id,
      ...scope,
      digest,
      method: input.method,
      lines,
      saleId: new ObjectId(hash(`sale:${id}`).slice(0, 24)),
      status: 'preparing',
      ...(input.stockOperationId ? { stockOperationId: input.stockOperationId } : {}),
      adjusted: Boolean(input.stockOperationId),
      createdAt: new Date(),
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  let row = await collection.findOne({ _id: id, ...scope });
  if (!row || row.digest !== digest) fail('extension_payment_conflict');
  if (row.status === 'rejected') return { rejected: true };
  if (row.status !== 'preparing') return publicPayment(row);
  const ctx = await saleContext(db, scope);
  if (!row.quote) {
    const payload = {
      sale_process: 'add',
      payment_mode: row.method === 'cash' ? 'Cash' : row.method === 'split' ? 'Multiple' : 'Card',
      sales_total: 0,
      customer_name: input.customer || '',
      items: lines.map((line) => ({
        item_id: line.itemId,
        item_quantity: line.quantityMilli / 1000,
        ...(line.sellingPrice !== undefined ? { sale_inline_item_price: line.sellingPrice } : {}),
      })),
    };
    const preview = await require('./sale.service').previewSale(payload, ctx);
    const valueMinor = preview.status
      ? Money.toMinor(preview.data.header.finalSaleTotAmount, ctx.branchSettings)
      : 0;
    if (!preview.status || !Number.isSafeInteger(valueMinor) || valueMinor <= 0) {
      // A preview has no stock/sale effects. Race the quote writer, so one
      // failing preview cannot reject another request's accepted reservation.
      await collection.replaceOne(
        { _id: id, status: 'preparing', quote: { $exists: false } },
        { _id: id, ...scope, digest, status: 'rejected' }
      );
      row = await collection.findOne({ _id: id });
      if (row.status === 'rejected')
        return { rejected: true, failureCode: 'extension_payment_quote_invalid' };
      if (row.status !== 'preparing') return publicPayment(row);
    } else {
      // Bind the cash/card ledger to the quoted total. Core validation refuses a
      // changed payable before inserting the sale, rather than silently charging
      // a different amount when catalogue/configuration changed in the meantime.
      payload.sales_total = Money.fromMinor(valueMinor, ctx.branchSettings);
      payload.multi_payment = { [payload.payment_mode]: payload.sales_total };
      await collection.updateOne(
        { _id: id, status: 'preparing', quote: { $exists: false } },
        {
          $set: {
            quote: preview.data,
            valueMinor,
            payload,
            currency: Money.policy(ctx.branchSettings),
          },
        }
      );
      row = await collection.findOne({ _id: id });
    }
    if (row.status === 'rejected')
      return { rejected: true, failureCode: 'extension_payment_quote_invalid' };
    if (row.status !== 'preparing') return publicPayment(row);
    if (!row.quote) fail('extension_payment_quote_unresolved');
  }
  if (!row.stockOperationId) {
    const movement = await runStockBatch(
      db,
      { license: scope.license, branchId: scope.branch_id, actorId: scope.actorId },
      {
        extensionId: scope.extensionId,
        operationId: `${context.operationId}:payment`,
        lines: row.lines,
        stream: { id: scope.extensionId, sequence: context.sequence },
      }
    );
    if (movement.status === 'rejected') {
      await collection.replaceOne(
        { _id: id, status: 'preparing' },
        { _id: id, ...scope, digest, status: 'rejected' }
      );
      return { rejected: true };
    }
    if (movement.status !== 'committed') fail('extension_payment_stock_unresolved');
    await collection.updateOne(
      { _id: id, status: 'preparing' },
      { $set: { stockOperationId: movement.operationId } }
    );
    row = await collection.findOne({ _id: id });
  }
  await allocateForSale(
    db,
    { license: scope.license, branchId: scope.branch_id, actorId: scope.actorId },
    {
      extensionId: scope.extensionId,
      stockOperationId: row.stockOperationId,
      saleId: row.saleId,
      lines: row.lines,
    }
  );
  await collection.updateOne({ _id: id, status: 'preparing' }, { $set: { status: 'pending' } });
  return publicPayment(await collection.findOne({ _id: id }));
}

const paidResult = (row) => ({
  ...publicPayment(row),
  paidAt: row.paidAt,
  ...(row.method === 'split'
    ? {
        cashMinor: row.confirmation.cashMinor,
        cardMinor: row.confirmation.cardMinor,
        tenderMinor: row.confirmation.tenderMinor,
        changeMinor: row.confirmation.tenderMinor - row.confirmation.cashMinor,
        recording: 'external-terminal',
        reference: row.confirmation.reference,
      }
    : {}),
  ...(row.method === 'cash'
    ? {
        tenderMinor: row.confirmation.tenderMinor,
        changeMinor: row.confirmation.tenderMinor - row.valueMinor,
      }
    : { recording: row.confirmation.recording, reference: row.confirmation.reference }),
});

async function confirmRecordedPayment(context, input, method, options = {}) {
  const { db } = context,
    scope = paymentScope(context),
    collection = db.collection('extension_payments');
  if (!/^[a-f\d]{64}$/.test(input.paymentId || '')) fail('extension_payment_invalid');
  const confirmation =
    method === 'cash'
      ? { method, tenderMinor: input.tenderMinor }
      : {
          method,
          reference: input.reference || '',
          recording: options.authorization === dojoAuthorization ? 'dojo' : 'external-terminal',
        };
  if (method === 'cash' && (!Number.isSafeInteger(input.tenderMinor) || input.tenderMinor < 0))
    fail('extension_cash_confirmation_invalid');
  if (
    method === 'card' &&
    (input.terminalConfirmed !== true ||
      (input.reference !== undefined &&
        (typeof input.reference !== 'string' ||
          input.reference.length > 120 ||
          [...input.reference].some(
            (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
          ))))
  )
    fail('extension_card_confirmation_required');
  if (method === 'split') {
    if (
      ![input.cashMinor, input.cardMinor, input.tenderMinor].every(Number.isSafeInteger) ||
      input.cashMinor <= 0 ||
      input.cardMinor <= 0 ||
      input.tenderMinor < input.cashMinor ||
      input.terminalConfirmed !== true ||
      typeof (input.reference || '') !== 'string' ||
      (input.reference || '').length > 120 ||
      [...(input.reference || '')].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      )
    )
      fail('extension_split_confirmation_invalid');
    Object.assign(confirmation, {
      cashMinor: input.cashMinor,
      cardMinor: input.cardMinor,
      tenderMinor: input.tenderMinor,
    });
  }
  const confirmationDigest = fingerprint(confirmation);
  const attemptId = context.operationId;
  let row = await collection.findOne({ _id: input.paymentId, ...scope });
  if (!row || row.method !== method) fail(`extension_${method}_payment_unavailable`);
  if (method === 'split' && input.cashMinor + input.cardMinor !== row.valueMinor)
    fail('extension_split_total_invalid');
  if (row.provider && options.authorization !== dojoAuthorization)
    fail('extension_provider_payment_in_progress');
  if (method === 'cash' && input.tenderMinor < row.valueMinor)
    fail('extension_cash_tender_insufficient');
  if (row.attempt?.id === attemptId && row.attempt.digest !== confirmationDigest)
    fail('extension_payment_confirmation_conflict');
  if (row.attempt?.id === attemptId && row.attempt.status === 'rejected')
    return { rejected: true, failureCode: row.attempt.failureCode };
  if (row.status === 'paid') {
    if (row.attempt.digest !== confirmationDigest) fail('extension_payment_confirmation_conflict');
    return paidResult(row);
  }
  if (!['pending', 'submitting'].includes(row.status))
    fail(`extension_${method}_payment_unavailable`);
  await collection.updateOne(
    {
      _id: row._id,
      status: 'pending',
      attempt: row.attempt || { $exists: false },
      provider: options.authorization === dojoAuthorization ? row.provider : { $exists: false },
    },
    {
      $set: {
        status: 'submitting',
        ...(method === 'split'
          ? {
              'payload.multi_payment': {
                Cash: Money.fromMinor(input.cashMinor, row.currency),
                Card: Money.fromMinor(input.cardMinor, row.currency),
              },
            }
          : {}),
        confirmation,
        attempt: {
          id: attemptId,
          digest: confirmationDigest,
          status: 'submitting',
          authorized: options.authorization === dojoAuthorization && !!row.providerCommitDocument,
        },
        ...(options.authorization === dojoAuthorization && row.providerCommitDocument
          ? { commitDocument: row.providerCommitDocument }
          : {}),
      },
    }
  );
  row = await collection.findOne({ _id: row._id });
  if (row.attempt?.id === attemptId && row.attempt.digest === confirmationDigest) {
    if (row.status === 'paid') return paidResult(row);
    if (row.attempt.status === 'rejected')
      return { rejected: true, failureCode: row.attempt.failureCode };
  }
  if (
    row.status !== 'submitting' ||
    row.attempt.id !== attemptId ||
    row.attempt.digest !== confirmationDigest
  )
    fail('extension_payment_submission_conflict');
  const saleFilter = {
    _id: row.saleId,
    license: scope.license,
    branch_id: scope.branch_id,
    extension_stock_operation: row.stockOperationId,
  };
  const rejectBeforeCommit = async () => {
    // A stale process can still reach the sale writer after a request fails.
    // Race its durable commit gate, rather than infer "not saved" from a
    // momentarily absent sale. Once authorized, only reconciliation is safe.
    await collection.updateOne(
      {
        _id: row._id,
        status: 'submitting',
        'attempt.id': attemptId,
        'attempt.digest': confirmationDigest,
        'attempt.authorized': false,
      },
      {
        $set: {
          status: 'pending',
          'attempt.status': 'rejected',
          'attempt.failureCode': 'extension_payment_review_required',
        },
        $unset: { confirmation: '' },
      }
    );
    const latest = await collection.findOne({ _id: row._id });
    return latest?.attempt?.id === attemptId && latest.attempt.status === 'rejected';
  };
  let sale = await db.collection('sales').findOne(saleFilter);
  if (!sale) {
    const stockGrant = await allocateForSale(
      db,
      { license: scope.license, branchId: scope.branch_id, actorId: scope.actorId },
      {
        extensionId: scope.extensionId,
        stockOperationId: row.stockOperationId,
        saleId: row.saleId,
        lines: row.lines,
      }
    );
    if (row.attempt.authorized && row.commitDocument) {
      sale = await require('./extension-sale-commit').resumeSaleCommit(
        db,
        {
          license: scope.license,
          branchId: scope.branch_id,
          extensionId: scope.extensionId,
          actorId: scope.actorId,
        },
        row._id,
        stockGrant
      );
    } else {
      const ctx = await saleContext(db, scope);
      const save = options.saveSale || require('./sale.service').processSale;
      const beforeStockCommit = async (pricing, document) => {
        const currency = Money.policy(ctx.branchSettings);
        if (
          currency.currencyCode !== row.currency.currencyCode ||
          currency.currencyDigits !== row.currency.currencyDigits ||
          fingerprint(pricing) !== fingerprint(row.quote) ||
          !document
        )
          fail('extension_payment_review_required');
        await collection.updateOne(
          {
            _id: row._id,
            status: 'submitting',
            'attempt.id': attemptId,
            'attempt.digest': confirmationDigest,
            'attempt.status': 'submitting',
            'attempt.authorized': false,
          },
          {
            $set: {
              'attempt.authorized': true,
              commitDocument: BSON.deserialize(BSON.serialize(document)),
            },
          }
        );
        const authorized = await collection.findOne({
          _id: row._id,
          status: 'submitting',
          'attempt.id': attemptId,
          'attempt.digest': confirmationDigest,
          'attempt.authorized': true,
        });
        if (!authorized?.commitDocument) fail('extension_payment_submission_closed');
        // Every concurrent writer receives the first authorized document, with
        // the same price, timestamp and sale identity. No fresh repricing on
        // recovery after authorisation, even if the catalogue has since changed.
        return authorized.commitDocument;
      };
      let result;
      try {
        result = await save(structuredClone(row.payload), '', 'Add', ctx, {
          stockGrant,
          beforeStockCommit,
        });
      } catch (error) {
        if (await rejectBeforeCommit())
          return { rejected: true, failureCode: 'extension_payment_review_required' };
        throw error;
      }
      sale = await db.collection('sales').findOne(saleFilter);
      if (!sale) {
        if (!result.status && (await rejectBeforeCommit()))
          return { rejected: true, failureCode: 'extension_payment_review_required' };
        fail('extension_payment_sale_unresolved');
      }
    }
  }
  if (
    sale.payment_status !== 'Paid' ||
    sale.payment_mode !== (method === 'cash' ? 'Cash' : method === 'split' ? 'Multiple' : 'Card') ||
    Money.toMinor(sale.sales_total, row.currency) !== row.valueMinor
  )
    fail('extension_payment_sale_mismatch');
  await collection.updateOne(
    { _id: row._id, status: 'submitting' },
    { $set: { status: 'paid', paidAt: sale.date || new Date() } }
  );
  row = await collection.findOne({ _id: row._id });
  return paidResult(row);
}
const confirmSplit = (context, input, options) =>
  confirmRecordedPayment(context, input, 'split', options);
const confirmCash = (context, input, options) =>
  confirmRecordedPayment(context, input, 'cash', options);
// Matches ordinary manual Card entry: staff must explicitly confirm their
// external terminal received the money. This never calls a provider or claims
// a Dojo approval. A future provider adapter must use its own verified journal.
const confirmExternalCard = (context, input, options) =>
  confirmRecordedPayment(context, input, 'card', options);
// Internal host entry point. Provider/configuration are trusted dependencies,
// never supplied by a worker or browser. Claim the SAME payment document used
// by manual confirmation/cancellation before making any provider request.
async function processDojoPayment(context, input, { provider, configurationId, terminalId } = {}) {
  const scope = paymentScope(context),
    collection = context.db.collection('extension_payments');
  if (!/^[a-f\d]{64}$/.test(input.paymentId || '')) fail('extension_payment_invalid');
  const filter = { _id: input.paymentId, ...scope };
  let row = await collection.findOne(filter);
  if (!row || row.method !== 'card' || !['pending', 'submitting', 'paid'].includes(row.status))
    fail('extension_card_payment_unavailable');
  if (
    row.currency?.currencyCode !== 'GBP' ||
    !Number.isSafeInteger(row.valueMinor) ||
    row.valueMinor <= 0
  )
    fail('extension_dojo_amount_invalid');
  if (
    !provider ||
    !['sandbox', 'production'].includes(provider.environment) ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(configurationId || '') ||
    !/^tm_[A-Za-z0-9_-]{1,180}$/.test(terminalId || '')
  )
    fail('extension_dojo_configuration_invalid');
  const binding = { name: 'dojo', configurationId, terminalId, environment: provider.environment };
  await collection.updateOne(
    { ...filter, status: 'pending', provider: { $exists: false } },
    { $set: { provider: binding } }
  );
  row = await collection.findOne(filter);
  if (fingerprint(row.provider || {}) !== fingerprint(binding))
    fail('extension_provider_payment_conflict');
  if (!row.providerCommitDocument) {
    const stockGrant = await allocateForSale(
      context.db,
      { license: scope.license, branchId: scope.branch_id, actorId: scope.actorId },
      {
        extensionId: scope.extensionId,
        stockOperationId: row.stockOperationId,
        saleId: row.saleId,
        lines: row.lines,
      }
    );
    const ctx = await saleContext(context.db, scope);
    const prepared = await require('./sale.service').processSale(
      structuredClone(row.payload),
      '',
      'Add',
      ctx,
      { stockGrant, prepareAllocated: true }
    );
    if (
      !prepared.status ||
      !prepared.document ||
      fingerprint(prepared.data) !== fingerprint(row.quote) ||
      Money.policy(ctx.branchSettings).currencyCode !== row.currency.currencyCode ||
      Money.policy(ctx.branchSettings).currencyDigits !== row.currency.currencyDigits
    ) {
      // No provider request has been made by this path. Allow cancellation if
      // no competing request has frozen a document and advanced to charging.
      await collection.updateOne(
        {
          ...filter,
          status: 'pending',
          provider: binding,
          providerCommitDocument: { $exists: false },
        },
        { $unset: { provider: '' } }
      );
      fail('extension_payment_review_required');
    }
    await collection.updateOne(
      {
        ...filter,
        status: 'pending',
        provider: binding,
        providerCommitDocument: { $exists: false },
      },
      { $set: { providerCommitDocument: BSON.deserialize(BSON.serialize(prepared.document)) } }
    );
    row = await collection.findOne(filter);
    if (!row.providerCommitDocument || fingerprint(row.provider || {}) !== fingerprint(binding))
      fail('extension_provider_payment_conflict');
  }
  const journal = require('./dojo-payment-journal');
  await journal.startPayment(
    context.db,
    context.scope,
    {
      paymentId: row._id,
      valueMinor: row.valueMinor,
      currencyCode: row.currency.currencyCode,
      configurationId,
      terminalId,
    },
    provider
  );
  const result = await journal.pollPayment(
    context.db,
    context.scope,
    row._id,
    configurationId,
    provider
  );
  if (result.status !== 'captured')
    return { paymentId: row._id, status: result.status, provider: 'dojo' };
  const committed = await confirmRecordedPayment(
    { ...context, operationId: 'dojo-confirm:' + row._id },
    { paymentId: row._id, terminalConfirmed: true, reference: result.paymentIntentId },
    'card',
    { authorization: dojoAuthorization }
  );
  // Money is already captured. A failed local validation is a reconciliation
  // problem, never a declined payment or permission to charge another time.
  if (committed.rejected) fail('extension_dojo_sale_reconciliation_required');
  return committed;
}
async function cancelPayment(context, input) {
  const { db } = context,
    scope = paymentScope(context),
    collection = db.collection('extension_payments');
  if (!/^[a-f\d]{64}$/.test(input.paymentId || '')) fail('extension_payment_invalid');
  const { actorId: requestingActor, ...shopScope } = scope;
  let row = await collection.findOne({ _id: input.paymentId, ...shopScope });
  if (!row) fail('extension_payment_unavailable');
  if (row.actorId !== requestingActor && !context.permissions?.includes('manage'))
    fail('extension_payment_owner_required');
  if (row.status === 'cancelled') return { cancelled: true };
  if (row.provider) fail('extension_provider_payment_in_progress');
  if (!['pending', 'cancelling'].includes(row.status)) fail('extension_payment_cannot_cancel');
  await collection.updateOne(
    { _id: row._id, status: 'pending', provider: { $exists: false } },
    {
      $set: {
        status: 'cancelling',
        cancelOperation: {
          actorId: requestingActor,
          operationId: context.operationId,
          sequence: context.sequence,
        },
      },
    }
  );
  row = await collection.findOne({ _id: row._id });
  if (row.status !== 'cancelling') fail('extension_payment_cannot_cancel');
  if (!row.cancelOperation) fail('extension_payment_cancel_recovery_required');
  const funding = await db
    .collection('extension_stock_commands')
    .findOne({ _id: row.stockOperationId, license: scope.license, branch_id: scope.branch_id });
  const stockScope = {
    license: scope.license,
    branchId: scope.branch_id,
    actorId: row.cancelOperation.actorId,
  };
  if (!(funding?.phase === 'cleared' && !row.adjusted)) {
    await require('./extension-stock-allocations').releaseCancelledAllocation(
      db,
      stockScope,
      row._id
    );
    if (!row.adjusted) {
      const lifecycle = require('./extension-stock-lifecycle');
      const action = {
        extensionId: scope.extensionId,
        stockOperationId: row.stockOperationId,
        operationId: `${row.cancelOperation.operationId}:cancel`,
        lines: row.lines,
        stream: { id: scope.extensionId, sequence: row.cancelOperation.sequence },
      };
      await lifecycle.returnStock(db, stockScope, action);
      await lifecycle.clearStockBasket(db, stockScope, action);
    }
  }
  // Keep the closed request identity, not the cancelled unpaid receipt payload.
  await collection.replaceOne(
    { _id: row._id, status: 'cancelling' },
    {
      _id: row._id,
      ...scope,
      actorId: row.actorId,
      digest: row.digest,
      status: 'cancelled',
    }
  );
  return { cancelled: true };
}
module.exports = {
  preparePayment,
  confirmCash,
  confirmSplit,
  confirmExternalCard,
  processDojoPayment,
  cancelPayment,
};
