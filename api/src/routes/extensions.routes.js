'use strict';
const express = require('express');
const { protect } = require('../middleware/auth');
const access = require('../utils/branch-access');
const namespace = require('../services/extension-namespace');
const runtime = require('../services/extension-runtime');
const effects = require('../services/extension-effects');

function createRouter({ authenticate = protect, registry = runtime, executor = effects } = {}) {
  const router = express.Router();
  router.use(authenticate);
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
    })
  );
  router.get('/:extensionId/state', async (req, res) => {
    try {
      const e = req.extension;
      res.json(await namespace.readNamespace(req.db, e.scope, e.descriptor, e.actor));
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
