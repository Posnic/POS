'use strict';
const express = require('express');
const library = require('../services/extension-private-library');
// Mounted only by a registry server with verified ACCOUNT authentication and
// a dedicated registry database. Never inherit a local till JWT as authority.
function createLibraryRouter({ db, authenticate, readBlob } = {}) {
  if (!db || typeof authenticate !== 'function' || typeof readBlob !== 'function')
    throw new Error('extension_registry_dependencies_required');
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  router.use(authenticate);
  router.use(express.json({ limit: '8kb' }));
  const handle = (action) => async (req, res) => {
    try {
      await action(req, res);
    } catch (error) {
      res
        .status(error.status === 404 ? 404 : 503)
        .json({ error: 'Extension library is unavailable.' });
    }
  };
  router.get(
    '/organizations/:organizationId/releases',
    handle(async (req, res) => {
      res.json({
        releases: await library.listReleases(db, req.libraryActor, req.params.organizationId),
      });
    })
  );
  router.post(
    '/organizations/:organizationId/download-tickets',
    handle(async (req, res) => {
      res.json(
        await library.issueDownload(
          db,
          req.libraryActor,
          req.params.organizationId,
          req.body?.releaseId,
          req.body?.kind
        )
      );
    })
  );
  router.post(
    '/downloads',
    handle(async (req, res) => {
      const result = await library.download(db, req.libraryActor, req.body?.token, readBlob);
      res.set('Content-Type', result.contentType);
      res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.set('X-Content-Type-Options', 'nosniff');
      res.send(result.bytes);
    })
  );
  return router;
}
module.exports = { createLibraryRouter };
