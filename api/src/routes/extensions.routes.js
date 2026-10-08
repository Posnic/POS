'use strict';
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const access = require('../utils/branch-access');
const namespace = require('../services/extension-namespace');
const runtime = require('../services/extension-runtime');
const effects = require('../services/extension-effects');
const catalogue = require('../services/extension-catalog');

function createRouter({ authenticate = protect, registry = runtime, executor = effects } = {}) {
  const router = express.Router();
  router.use(
    rateLimit({ windowMs: 60000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false })
  );
  router.use(authenticate);
  const installer = express.Router();
  installer.use(async (req, res, next) => {
    try {
      if (req.isApiKey || !access.allowed(req.user, 'extensions', 'manage'))
        access.fail('Extension management permission required.', 403);
      req.installScope = await access.context(req);
      next();
    } catch (error) {
      respondError(res, error);
    }
  });
  installer.get('/status', (req, res) => {
    try {
      const queue = require('../services/extension-install-queue'),
        config = queue.configuration();
      const pending = queue.read(config.root);
      const owned =
        pending &&
        pending.license === String(req.installScope.license) &&
        pending.branchId === String(req.installScope.branchId);
      res.json({
        available: true,
        pending: owned ? { id: pending.id, version: pending.version } : null,
        busy: !!pending,
      });
    } catch {
      res.json({ available: false, pending: null, busy: false });
    }
  });
  installer.post(
    '/stage',
    express.raw({ type: 'application/octet-stream', limit: '24mb' }),
    async (req, res) => {
      try {
        const options = require('../services/extension-install-queue').configuration();
        const staged = await require('../services/extension-installation').stageExtensionArchive(
          req.body,
          options
        );
        res.json({
          id: staged.id,
          version: staged.version,
          packageDigest: staged.packageDigest,
          existing: staged.existing,
        });
      } catch (error) {
        respondError(res, error);
      }
    }
  );
  installer.post('/activate', (req, res) => {
    try {
      const queue = require('../services/extension-install-queue');
      const pending = queue.queue({
        ...queue.configuration(),
        id: req.body?.id,
        version: req.body?.version,
        scope: req.installScope,
      });
      res.json({ id: pending.id, version: pending.version, restartRequired: true });
    } catch (error) {
      respondError(res, error);
    }
  });
  installer.post('/cancel', (req, res) => {
    try {
      const queue = require('../services/extension-install-queue');
      queue.cancel({ ...queue.configuration(), scope: req.installScope });
      res.json({ cancelled: true });
    } catch (error) {
      respondError(res, error);
    }
  });
  router.use('/installation', installer);
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
      const canManage = access.allowed(req.user, 'extensions', 'manage');
      const states = await req.db
        .collection('extension_namespaces')
        .find({
          license: scope.license,
          branch_id: scope.branchId,
          'lifecycle.enabled': false,
        })
        .toArray();
      const disabled = new Set(states.map((row) => row.extensionId));
      const removed = new Set(
        states.filter((row) => row.lifecycle?.installed === false).map((row) => row.extensionId)
      );
      const extensions = registry
        .list()
        .filter(
          (item) =>
            item.view &&
            enabled.get(item.id) === item.packageDigest &&
            (canManage || !disabled.has(item.id)) &&
            access.allowed(req.user, item.permissionModule || 'extensions', 'read')
        )
        .map((item) => ({
          id: item.id,
          displayName: item.displayName || item.id,
          version: item.version,
          ...(item.menu === 'sales' ? { menu: 'sales' } : {}),
          salesWorkspace: item.salesWorkspace || null,
          enabled: !disabled.has(item.id),
          installed: !removed.has(item.id),
        }));
      res.set('Cache-Control', 'no-store').json({ extensions, canManage });
    } catch (error) {
      respondError(res, error);
    }
  });
  router.get('/:extensionId/lifecycle-history', async (req, res) => {
    try {
      if (req.isApiKey || !access.allowed(req.user, 'extensions', 'manage'))
        access.fail('Extension management permission required.', 403);
      const scope = await access.context(req);
      if (
        Object.keys(req.query).some((key) => key !== 'before') ||
        (req.query.before !== undefined && !/^[1-9][0-9]{0,15}$/.test(req.query.before))
      )
        access.fail('Invalid lifecycle history cursor.', 422);
      const events = await namespace.readLifecycleAudit(
        req.db,
        scope,
        { id: req.params.extensionId },
        { permissions: ['manage'] },
        req.query.before === undefined ? undefined : Number(req.query.before)
      );
      res
        .set('Cache-Control', 'no-store')
        .json({ events, next: events.length === 50 ? events[events.length - 1].generation : null });
    } catch (error) {
      respondError(res, error);
    }
  });
  router.post('/:extensionId/installed', async (req, res) => {
    try {
      if (req.isApiKey || !access.allowed(req.user, 'extensions', 'manage'))
        access.fail('Extension management permission required.', 403);
      if (req.body?.retainData !== true)
        access.fail('Removal preserves business data. Confirm retainData.', 422);
      const descriptor = registry.get(req.params.extensionId);
      if (!descriptor) access.fail('Verified package is unavailable on this host.', 404);
      const scope = await access.context(req);
      const approved = await req.db.collection('extension_installations').findOne({
        license: scope.license,
        branch_id: scope.branchId,
        extensionId: descriptor.id,
        packageDigest: descriptor.packageDigest,
        enabled: true,
      });
      if (!approved) access.fail('Extension is not approved for this shop.', 403);
      res
        .set('Cache-Control', 'no-store')
        .json(
          await namespace.setInstalled(
            req.db,
            scope,
            descriptor,
            { userId: String(req.user._id || req.user.id), permissions: ['manage'] },
            req.body?.installed
          )
        );
    } catch (error) {
      respondError(res, error);
    }
  });
  router.post('/:extensionId/enabled', async (req, res) => {
    try {
      if (req.isApiKey || !access.allowed(req.user, 'extensions', 'manage'))
        access.fail('Extension management permission required.', 403);
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
      if (!approved) access.fail('Extension is not approved for this shop.', 403);
      res
        .set('Cache-Control', 'no-store')
        .json(
          await namespace.setEnabled(
            req.db,
            scope,
            descriptor,
            { userId: String(req.user._id || req.user.id), permissions: ['manage'] },
            req.body?.enabled
          )
        );
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
      const state = await req.db.collection('extension_namespaces').findOne({
        license: scope.license,
        branch_id: scope.branchId,
        extensionId: descriptor.id,
      });
      if (state?.lifecycle?.enabled === false)
        access.fail('Extension is disabled for this shop.', 403);
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
  router.get('/:extensionId/sales', async (req, res) => {
    try {
      if (Object.keys(req.query).some((key) => key !== 'after'))
        access.fail('Unsupported history query.', 422);
      res.json(
        await require('../services/extension-sales-history').listSales({
          db: req.db,
          ...req.extension,
          after: req.query.after,
        })
      );
    } catch (error) {
      respondError(res, error);
    }
  });
  router.get('/:extensionId/sales-report', async (req, res) => {
    try {
      if (Object.keys(req.query).some((key) => !['day', 'endDay'].includes(key)))
        access.fail('Unsupported report query.', 422);
      res.json(
        await require('../services/extension-sales-history').dailySales({
          db: req.db,
          ...req.extension,
          day: req.query.day,
          endDay: req.query.endDay,
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
