'use strict';
const namespace = require('./extension-namespace');
const { cloudStore } = require('./extension-hktv-orders');

// Documents load only their selected orders; legacy storage remains readable
// until the reconciled cutover explicitly activates records-v1.
function documentReader({ db, scope, descriptor, actor, readState = namespace.readNamespace, getStore = cloudStore }, keys) {
  return async () => {
    const current = await readState(db, scope, descriptor, actor);
    if (current.busy || current.state.orderStorage !== 'records-v1') return current;
    const store = await getStore({ db, scope, storeCode: current.state.storeCode });
    const records = await Promise.all(keys.map(key => store.read(key)));
    return { ...current, state: { ...current.state, orders: records.filter(Boolean).map(r => r.data) },
      orderRevisions: Object.fromEntries(keys.map((key, index) => [key, records[index]?.revision ?? null])) };
  };
}
function sameDocumentState(before, after) {
  return !after.busy && before.revision === after.revision &&
    before.state.orderStorage === after.state.orderStorage &&
    JSON.stringify(before.orderRevisions) === JSON.stringify(after.orderRevisions);
}
module.exports = { documentReader, sameDocumentState };
