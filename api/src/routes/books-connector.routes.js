"use strict";
const express = require('express');
const settings = require('../services/books-connector-settings');
function register({ app, protect }) {
  const router = express.Router();
  router.use(protect, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const handle = operation => async (req, res) => {
    try {
      const context = await settings.context(req);
      const service = settings.create({ db: req.db });
      res.json({ type: 'success', data: { ...await operation(service, context, req), scopeId: service.scopeId(context) } });
    } catch (error) {
      const status = [400, 401, 403, 409, 503].includes(error.status) ? error.status : 500;
      const code = typeof error.code === 'string' && /^books_[a-z_]+$/.test(error.code)
        ? error.code : status === 403 ? 'books_connection_forbidden' : 'books_connection_unavailable';
      res.status(status).json({ type: 'error', code,
        message: 'Check the original connection status before trying again.' });
    }
  };
  router.get('/', handle(async (service, context) => ({ ...await service.read(context), scopeId: service.scopeId(context) })));
  router.get('/changes/:requestId', handle((service, context, req) => service.outcome(context, req.params.requestId)));
  router.post('/changes', express.json({ limit: '2kb' }), handle((service, context, req) => {
    const body = req.body;
    if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'confirmed,enabled,expectedRevision,requestId,scopeId') {
      throw Object.assign(new Error('Invalid connection change'), { status: 400, code: 'books_connection_request_invalid' });
    }
    if (body.scopeId !== service.scopeId(context)) {
      throw Object.assign(new Error('Connection scope changed'), { status: 409, code: 'books_connection_scope_changed' });
    }
    return service.change(context, body);
  }));
  app.use(['/books-connector', '/api/books-connector'], router);
}
module.exports = { register };
