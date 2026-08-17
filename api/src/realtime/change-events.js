'use strict';
/*
 * The write seams, found once instead of maintained forever (S2).
 *
 * Rather than editing every controller that changes data - and quietly
 * missing whichever one is added next - one middleware watches responses:
 * a successful mutating request to a data entity publishes a coarse
 * {type: 'change', entity} signal to the shop's tills. Coarse is the
 * point: the till refreshes the list it is looking at through the same
 * authenticated endpoint it already uses. No payload, no per-route wiring,
 * nothing to forget.
 */
const { publish } = require('./event-bus');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/*
 * Entities worth waking a till for. Deliberately a whitelist: auth, settings
 * writes, uploads and the rest would be noise - and events fire for every
 * till in the shop, so noise multiplies.
 */
const ENTITIES = new Set([
  'sales',
  'items',
  'receivings',
  'customers',
  'suppliers',
  'categories',
  'registers',
  'expenses',
  'shifts',
  'easytables',
]);

/* The API router is mounted at both /api and /; the entity is the first
   meaningful path segment either way. */
function entityFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts[0] === 'api') parts.shift();
  return parts[0] || null;
}

function changeEvents(req, res, next) {
  if (MUTATING.has(req.method)) {
    const entity = entityFromPath(req.path);
    if (entity && ENTITIES.has(entity)) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300 && req.db) {
          try {
            const event = { type: 'change', entity, at: new Date().toISOString() };
            publish(req.db.databaseName, event);
            /* Same signal, outward: registered webhook endpoints hear what
               the shop's own tills hear. Fire-and-forget both halves. */
            const webhooks = require('./webhooks');
            webhooks.publish(req.db, req.db.databaseName, event).catch(() => {});
            webhooks.drainDue(req.db, req.db.databaseName).catch(() => {});
          } catch (e) { /* realtime is an optimisation, never a failure */ }
        }
      });
    }
  }
  next();
}

module.exports = { changeEvents, entityFromPath, ENTITIES };
