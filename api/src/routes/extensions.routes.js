'use strict';
const express = require('express');
const { protect } = require('../middleware/auth');
const access = require('../utils/branch-access');
const namespace = require('../services/extension-namespace');
const runtime = require('../services/extension-runtime');
const effects = require('../services/extension-effects');
const catalogue = require('../services/extension-catalog');

function createRouter({ authenticate = protect, registry = runtime, executor = effects } = {}) {
  const router = express.Router();
  router.use(authenticate);
  router.get('/', async (req, res) => {
    try {
      if (req.isApiKey) access.fail('Extension staff session required.', 403);
      const scope = await access.context(req);
      const rows = await req.db
        .collection('extension_installations')
        .find({
          license: scope.license,
          branch_id: scope.branchId,
          enabled: true,
        })
        .toArray();
      const enabled = new Map(rows.map((row) => [row.extensionId, row.packageDigest]));
      const extensions = registry
        .list()
        .filter(
          (item) =>
            item.view &&
            enabled.get(item.id) === item.packageDigest &&
            access.allowed(req.user, item.permissionModule || 'extensions', 'read')
        )
        .map((item) => ({
          id: item.id,
          displayName: item.displayName || item.id,
          version: item.version,
        }));
      res.set('Cache-Control', 'no-store').json({ extensions });
    } catch (error) {
      respondError(res, error);
    }
  });
  router.use('/:extensionId', async (req, res, next) => {
    try {
      // Existing generic API keys do not carry an installed extension grant.
      if (req.isApiKey) access.fail('Extension staff session required.', 403);
      const descriptor = registry.get(req.params.extensionId);
      if (!descriptor) access.fail('Extension is not installed on this host.', 404);
      const scope = await access.context(req);
      const approved = await req.db.collection('extension_installations').findOne({
        license: scope.license,
        branch_id: scope.branchId,
        extensionId: descriptor.id,
        packageDigest: descriptor.packageDigest,
        enabled: true,
      });
      if (!approved) access.fail('Extension is not enabled for this shop.', 403);
      const module = descriptor.permissionModule || 'extensions';
      const permissions = ['read', 'write', 'manage'].filter((action) =>
        access.allowed(req.user, module, action)
      );
      if (!permissions.includes('read')) access.fail('Extension read permission required.', 403);
      const actor = { userId: String(req.user._id || req.user.id), permissions };
      req.extension = { descriptor, scope, actor };
      res.set('Cache-Control', 'no-store');
      next();
    } catch (error) {
      respondError(res, error);
    }
  });
  router.get('/:extensionId/capabilities', (req, res) =>
    res.json({
      extensionApiVersion: 1,
      extensionId: req.extension.descriptor.id,
      version: req.extension.descriptor.version,
      capabilities: registry.capabilities,
      permissions: req.extension.actor.permissions,
      actor: req.extension.actor,
    })
  );
  router.get('/:extensionId/view', (req, res) => {
    const descriptor = req.extension.descriptor;
    if (!descriptor.view)
      return res.status(404).json({ error: { code: 'extension_page_unavailable' } });
    res.json({
      extensionId: descriptor.id,
      displayName: descriptor.displayName,
      view: descriptor.view,
    });
  });
  router.get('/:extensionId/state', async (req, res) => {
    try {
      const e = req.extension;
      res.json(await namespace.readNamespace(req.db, e.scope, e.descriptor, e.actor));
    } catch (error) {
      respondError(res, error);
    }
  });
  router.get('/:extensionId/catalogue', async (req, res) => {
    try {
      if (Object.keys(req.query).some((key) => !['q', 'after'].includes(key)))
        access.fail('Unsupported catalogue query.', 422);
      res.json(
        await catalogue.searchProducts({
          db: req.db,
          scope: req.extension.scope,
          query: req.query.q,
          after: req.query.after,
        })
      );
    } catch (error) {
      respondError(res, error);
    }
  });
  router.post('/:extensionId/commands', async (req, res) => {
    try {
      const e = req.extension;
      res.json(
        await namespace.executeNamespace(
          req.db,
          e.scope,
          e.descriptor,
          e.actor,
          {
            requestKey: req.get('Idempotency-Key'),
            expectedRevision: req.body?.expectedRevision,
            command: req.body?.command,
          },
          executor
        )
      );
    } catch (error) {
      respondError(res, error);
    }
  });
  router.post('/:extensionId/recover', async (req, res) => {
    try {
      const e = req.extension;
      res.json(await namespace.recoverNamespace(req.db, e.scope, e.descriptor, e.actor, executor));
    } catch (error) {
      respondError(res, error);
    }
  });
  router.post('/:extensionId/cash-drawer', async (req, res) => {
    try {
      res.json(
        await require('../services/extension-sale-hardware').claimCashDrawer({
          db: req.db,
          ...req.extension,
          saleId: req.body?.saleId,
        })
      );
    } catch (error) {
      respondError(res, error);
    }
  });
  router.post('/:extensionId/receipt', async (req, res) => {
    try {
      const e = req.extension;
      res.json(
        await require('../services/extension-receipts').readReceipt({
          db: req.db,
          scope: e.scope,
          descriptor: e.descriptor,
          actor: e.actor,
          request: req.body,
        })
      );
    } catch (error) {
      respondError(res, error);
    }
  });
  return router;
}
function respondError(res, error) {
  res.status(error.status || 500).json({
    error: {
      code: error.status
        ? error.code || 'extension_access_denied'
        : 'extension_operation_unresolved',
      message: error.status
        ? error.message
        : 'The operation needs recovery. Do not submit another payment.',
    },
  });
}
module.exports = createRouter();
module.exports.createRouter = createRouter;
