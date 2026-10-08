'use strict';
const express = require('express');
const invitations = require('../services/extension-library-invitations');
// Registry-only. authenticate must verify ACCOUNT identity, not a POS till JWT.
// Token delivery is deliberately the caller's responsibility; this sends no mail.
function createInvitationRouter({ db, client, authenticate } = {}) {
  if (!db || !client || typeof authenticate !== 'function')
    throw new Error('extension_registry_dependencies_required');
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  router.use(authenticate);
  router.use(express.json({ limit: '8kb' }));
  const handle = (action) => async (req, res) => {
    try {
      await action(req, res);
    } catch (error) {
      res.status(error.status === 404 ? 404 : 503).json({ error: 'Invitation is unavailable.' });
    }
  };
  router.post(
    '/organizations/:organizationId/invitations',
    handle(async (req, res) => {
      res
        .status(201)
        .json(
          await invitations.issueInvitation(
            db,
            req.libraryActor,
            req.params.organizationId,
            req.body?.email
          )
        );
    })
  );
  router.post(
    '/organizations/:organizationId/invitations/:invitationId/revoke',
    handle(async (req, res) => {
      await invitations.revokeInvitation(
        db,
        req.libraryActor,
        req.params.organizationId,
        req.params.invitationId
      );
      res.status(204).end();
    })
  );
  router.post(
    '/invitations/accept',
    handle(async (req, res) => {
      res.json(await invitations.acceptInvitation(db, client, req.libraryActor, req.body?.token));
    })
  );
  // Never return parser stacks or echo a body containing an invitation token.
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res
      .status(error.type === 'entity.too.large' ? 413 : 400)
      .json({ error: 'Invalid invitation request.' });
  });
  return router;
}
module.exports = { createInvitationRouter };
