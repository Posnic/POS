'use strict';
const { ObjectId } = require('mongodb');
const access = require('../utils/branch-access');
const namespace = require('./extension-namespace');
const catalogue = require('./extension-catalog');

function readerAllowed(req, approval) {
  return (
    req.isApiKey === true &&
    req.method === 'GET' &&
    req.path === '/connector-context' &&
    String(approval?.connectorReaderId || '') === String(req.user?._id || req.user?.id || '') &&
    /^[a-f0-9]{24}$/.test(String(approval?.connectorReaderId || '')) &&
    req.user?.activate === true &&
    req.user?.active !== false &&
    ![1, '1', true].includes(req.user?.del_status) &&
    String(req.user?.status).toLowerCase() !== 'inactive' &&
    req.user?.access?.extensions?.read === true
  );
}

async function readContext({ db, scope, descriptor, actor, query }) {
  if (
    !query ||
    Object.keys(query).some((k) => !['resource', 'ids', 'userId', 'permission'].includes(k))
  )
    access.fail('Invalid connector context request.', 422);
  if (query.resource === 'state') {
    if (Object.keys(query).length !== 1) access.fail('Invalid context request.', 422);
    return namespace.readNamespace(db, scope, descriptor, actor);
  }
  if (query.resource === 'authorization') {
    if (
      !/^[a-f0-9]{24}$/.test(query.userId || '') ||
      !['read', 'write', 'manage'].includes(query.permission) ||
      query.ids !== undefined
    )
      access.fail('Invalid authorization request.', 422);
    const user = await db
      .collection('users')
      .findOne({ _id: new ObjectId(query.userId), license: scope.license });
    if (
      !user ||
      user.activate !== true ||
      user.active === false ||
      [1, '1', true].includes(user.del_status) ||
      String(user.status).toLowerCase() === 'inactive' ||
      !access.allowed(user, descriptor.permissionModule || 'extensions', query.permission) ||
      (String(user.branch_id) !== String(scope.branchId) &&
        !user.branch_access?.some((b) => String(b.branch_id) === String(scope.branchId)))
    )
      access.fail('Extension staff access revoked.', 403);
    return { authorized: true };
  }
  if (
    !['products', 'parcels'].includes(query.resource) ||
    query.userId !== undefined ||
    query.permission !== undefined
  )
    access.fail('Unsupported connector resource.', 422);
  const ids = typeof query.ids === 'string' && query.ids ? query.ids.split(',') : [];
  if (
    ids.length > 200 ||
    ids.some((id) => !/^[a-f0-9]{24}$/.test(id)) ||
    new Set(ids).size !== ids.length
  )
    access.fail('Invalid product selection.', 422);
  if (query.resource === 'products')
    return catalogue.prepareContext({
      db,
      scope,
      state: {},
      command: {},
      resources: ['catalog.products'],
      selection: { productIds: ids },
    });
  const result = await require('./extension-parcel-hints').readParcelHints({
    db,
    scope,
    mappings: ids.map((productId) => ({ productId, sku: productId })),
  });
  return {
    ...result,
    products: result.products.map((p) => ({ productId: p.sku, measurements: p.measurements })),
  };
}
module.exports = { readerAllowed, readContext };
