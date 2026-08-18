'use strict';
/*
 * /api/v1 - the versioned facade (INTEGRATIONS_ROADMAP I4).
 *
 * The promise: this surface is stable. Legacy routes get refactored freely;
 * v1 keeps its shapes, and a contract test pins them. Read-only in v1.0 -
 * writes arrive as deliberate additions, never as leaks from legacy.
 *
 * Auth is whatever passed `protect` upstream - scoped tokens (the intended
 * caller) and sessions both land here as req.user with a resolved ACL, and
 * every entity check goes through the same access matrix the rest of the
 * API enforces. Reads are tenant-scoped by license and, for restricted
 * users, by their branch access.
 */

const ENTITIES = {
  sales: { collection: 'sales', acl: 'sales' },
  items: { collection: 'items', acl: 'item' },
  customers: { collection: 'customers', acl: 'customer' },
  suppliers: { collection: 'suppliers', acl: 'supplier' },
  categories: { collection: 'categories', acl: 'category' },
  receivings: { collection: 'receivings', acl: 'receiving' },
  expenses: { collection: 'expenses', acl: 'expense' },
};

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/* Fields that are ours, not the caller's. */
const INTERNAL_FIELDS = { _syncMeta: 0, password: 0, token_hash: 0 };

function canRead(user, aclModule) {
  return !!(user && user.access && user.access[aclModule] && user.access[aclModule].read === true);
}

/* Cursor = base64url of "isoDate|id". Compound so equal timestamps can
   neither skip nor repeat - the same rule the sync checkpoints use. */
function encodeCursor(doc) {
  const ts = doc.updated_date instanceof Date ? doc.updated_date.toISOString() : '';
  return Buffer.from(ts + '|' + String(doc._id)).toString('base64url');
}

function decodeCursor(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let text;
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8');
  } catch (e) {
    return null;
  }
  const i = text.indexOf('|');
  if (i < 0) return null;
  const ts = new Date(text.slice(0, i));
  if (isNaN(ts.getTime())) return null;
  return { ts, id: text.slice(i + 1) };
}

/*
 * Fixed-window rate limit per principal. In-memory per process - the goal
 * is stopping a runaway integration loop, not billing-grade accounting.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 300;
const windows = new Map(); // principalId -> {start, count}

function rateLimited(principalId, now = Date.now()) {
  const w = windows.get(principalId);
  if (!w || now - w.start >= WINDOW_MS) {
    windows.set(principalId, { start: now, count: 1 });
    return false;
  }
  w.count++;
  return w.count > MAX_PER_WINDOW;
}

function resetRateLimits() {
  windows.clear();
}

function branchFilter(user) {
  const branches = (user && user.branch_access) || [];
  if (!branches.length) return null;
  const ids = [];
  for (const b of branches) {
    if (b && b.branch_id != null) {
      ids.push(b.branch_id, String(b.branch_id));
    }
  }
  if (!ids.length) return null;
  return {
    $or: [{ branch_id: { $exists: false } }, { branch_id: null }, { branch_id: { $in: ids } }],
  };
}

function buildListQuery(user, cursor) {
  const and = [];
  if (user && user.license) {
    and.push({ license: user.license });
  }
  const bf = branchFilter(user);
  if (bf) and.push(bf);
  if (cursor) {
    and.push({
      $or: [
        { updated_date: { $gt: cursor.ts } },
        { updated_date: cursor.ts, _id: { $gt: cursor.id } },
      ],
    });
  }
  return and.length ? { $and: and } : {};
}

function envelope(docs, limit) {
  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  return {
    data: page,
    meta: {
      count: page.length,
      next_cursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
    },
  };
}

function err(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function openapiSpec() {
  const entityNames = Object.keys(ENTITIES);
  return {
    openapi: '3.0.3',
    info: {
      title: 'Posnic API',
      version: '1.0.0',
      description:
        'Read-only v1. Authenticate with a scoped API token (Manage > Integrations) via the Authorization: Bearer header. Lists are cursor-paginated; pass meta.next_cursor back as ?cursor= until it returns null.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: { token: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Envelope: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { type: 'object' } },
            meta: {
              type: 'object',
              properties: {
                count: { type: 'integer' },
                next_cursor: { type: 'string', nullable: true },
              },
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: { code: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
      },
    },
    security: [{ token: [] }],
    paths: {
      '/{entity}': {
        get: {
          summary: 'List records, oldest change first',
          parameters: [
            {
              name: 'entity',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: entityNames },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
            },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'A page plus the cursor for the next one',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Envelope' } },
              },
            },
            403: { description: 'Token lacks the read scope for this entity' },
            429: { description: 'Over ' + MAX_PER_WINDOW + ' requests per minute' },
          },
        },
      },
      '/{entity}/{id}': {
        get: {
          summary: 'Fetch one record by id',
          parameters: [
            {
              name: 'entity',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: entityNames },
            },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'The record, wrapped as {data}' },
            404: { description: 'No such record in this shop' },
          },
        },
      },
    },
  };
}

function registerV1({ app, protect }) {
  const express = require('express');
  const router = express.Router();

  /* The spec is public and must beat the protected mounts, or it 401s. */
  app.get(['/v1/openapi.json', '/api/v1/openapi.json'], (req, res) => res.json(openapiSpec()));

  router.use((req, res, next) => {
    const principal = req.user && (req.user.id || String(req.user._id || 'anon'));
    if (rateLimited(principal)) {
      return err(
        res,
        429,
        'rate_limited',
        'Too many requests - at most ' + MAX_PER_WINDOW + ' per minute per token.'
      );
    }
    next();
  });

  router.get('/:entity', async (req, res) => {
    const def = ENTITIES[req.params.entity];
    if (!def) return err(res, 404, 'unknown_entity', 'No such collection in v1.');
    if (!canRead(req.user, def.acl))
      return err(res, 403, 'forbidden', 'This token has no ' + def.acl + ':read scope.');
    if (!req.db) return err(res, 503, 'no_tenant', 'Tenant context unavailable.');
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
      const cursor = decodeCursor(req.query.cursor);
      if (req.query.cursor && !cursor)
        return err(res, 400, 'bad_cursor', 'The cursor is not one this API issued.');
      const docs = await req.db
        .collection(def.collection)
        .find(buildListQuery(req.user, cursor), { projection: INTERNAL_FIELDS })
        .sort({ updated_date: 1, _id: 1 })
        .limit(limit + 1)
        .toArray();
      res.json(envelope(docs, limit));
    } catch (e) {
      err(res, 500, 'internal', 'Could not list ' + req.params.entity + '.');
    }
  });

  router.get('/:entity/:id', async (req, res) => {
    const def = ENTITIES[req.params.entity];
    if (!def) return err(res, 404, 'unknown_entity', 'No such collection in v1.');
    if (!canRead(req.user, def.acl))
      return err(res, 403, 'forbidden', 'This token has no ' + def.acl + ':read scope.');
    if (!req.db) return err(res, 503, 'no_tenant', 'Tenant context unavailable.');
    try {
      const { ObjectId } = require('mongodb');
      if (!ObjectId.isValid(String(req.params.id))) {
        return err(res, 400, 'bad_id', 'Not a valid id.');
      }
      const and = [{ _id: new ObjectId(String(req.params.id)) }];
      if (req.user && req.user.license) and.push({ license: req.user.license });
      const bf = branchFilter(req.user);
      if (bf) and.push(bf);
      const doc = await req.db
        .collection(def.collection)
        .findOne({ $and: and }, { projection: INTERNAL_FIELDS });
      if (!doc) return err(res, 404, 'not_found', 'No such record in this shop.');
      res.json({ data: doc });
    } catch (e) {
      err(res, 500, 'internal', 'Could not fetch the record.');
    }
  });

  /* Dual-path, always - the proxy keeps /api on this estate. */
  app.use('/v1', protect, router);
  app.use('/api/v1', protect, router);
}

module.exports = {
  ENTITIES,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  MAX_PER_WINDOW,
  canRead,
  encodeCursor,
  decodeCursor,
  rateLimited,
  resetRateLimits,
  branchFilter,
  buildListQuery,
  envelope,
  openapiSpec,
  registerV1,
};
