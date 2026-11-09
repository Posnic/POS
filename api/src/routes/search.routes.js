'use strict';

const express = require('express');
const { ObjectId } = require('mongodb');
const { rateLimit } = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const { resolveAccess } = require('../utils/access-resolver');
const { withBranchScope } = require('../services/branch-scope');
const sharing = require('../services/data-sharing');
const demo = require('../services/demo-data');
const SettingsRepository = require('../repositories/settings.repository');
const countryCode = require('../utils/branch-country');
const dialingCodes = require('../json/search-dialing-codes.json');

const { providers, phoneCollation } = require('../services/search-providers');

function lookupValues(q, dial) {
  const values = new Set([q, q.toUpperCase(), q.toLowerCase()]);
  if (/^[+\d()\s.-]+$/.test(q)) {
    const digits = q.replace(/\D/g, '');
    values.add(digits);
    if (dial && digits.length >= 7) {
      const national =
        q.startsWith('+') && digits.startsWith(dial) ? digits.slice(dial.length) : digits;
      if (!q.startsWith('+') || digits.startsWith(dial)) {
        for (const v of [
          national,
          dial + national,
          '+' + dial + national,
          '+' + dial + ' ' + national,
        ])
          values.add(v);
      }
    }
  }
  return [...values];
}

async function records(req, q, group, refs, page) {
  const { branchId, licenseId } = req.tenantContext;
  const context = { branchId, licenseId };
  const acl = resolveAccess(req.user);
  let selected = providers.filter(
    (p) => acl[p.acl]?.read === true && (!group || group === p.group)
  );
  if (page) selected = selected.filter((p) => p.route === page.type);
  if (refs) selected = selected.filter((p) => refs.some((r) => r.startsWith(p.route + '/')));
  if (selected.some((p) => p.feature)) {
    const features = await new SettingsRepository().resolveGroup('features', context);
    selected = selected.filter(
      (p) =>
        !p.feature ||
        (features.status && ![false, 0, '0', 'false'].includes(features.data.values[p.feature]))
    );
  }
  let dial = '';
  if (!refs && /^[+\d()\s.-]{7,}$/.test(q)) {
    const branch = await req.db
      .collection('branches')
      .findOne(
        { _id: branchId, license: licenseId },
        { projection: { country: 1, country_id: 1, sortname: 1 } }
      );
    dial = dialingCodes[countryCode(branch || {})] || '';
  }
  const exact = lookupValues(q, dial);
  const ordinary = [
    ...new Set([
      q,
      q.toLowerCase(),
      q.toUpperCase(),
      q.replace(/\b\p{L}/gu, (c) => c.toUpperCase()),
    ]),
  ];
  const results = [];
  const more = [];
  let partial = false;
  async function read(p) {
    const collection = p.collection || p.route;
    const filters = [
      { license: licenseId, is_deleted: { $ne: true }, del_status: { $nin: [1, '1', true] } },
      await demo.filterFor(collection, context),
    ];
    if (p.contact)
      filters.push(withBranchScope({}, await sharing.scopeBranch(collection, branchId, context)));
    else if (p.route === 'users') filters.push({ 'branch_access.branch_id': branchId });
    else if (p.route === 'items')
      filters.push({ 'branch_access.branch_id': branchId, item_status: { $ne: 'instant' } });
    else filters.push({ branch_id: branchId });
    if (page) filters.push({ _id: { $gt: new ObjectId(page.after) } });
    const project = { [p.title]: 1 };
    if (p.route === 'users') Object.assign(project, { firstname: 1, lastname: 1, email: 1 });
    if (p.contact) {
      project.phone = 1;
      project.company_name = 1;
    }
    const coll = req.db.collection(collection);
    const fetch = (match, limit, collation) =>
      coll
        .find(
          { $and: [...filters, match] },
          { projection: project, ...(collation && { collation }) }
        )
        .sort({ _id: 1 })
        .maxTimeMS(220)
        .limit(limit)
        .toArray();
    const size = page ? 20 : 5;
    function take(rows, mode) {
      if (!refs && rows.length > size)
        more.push({ type: p.route, mode, after: String(rows[size - 1]._id) });
      return refs ? rows : rows.slice(0, size);
    }
    const raw =
      page && page.mode !== 'exact'
        ? []
        : refs
          ? await fetch(
              {
                _id: {
                  $in: refs
                    .filter((r) => r.startsWith(p.route + '/'))
                    .map((r) => new ObjectId(r.split('/')[1])),
                },
              },
              20
            )
          : await fetch(
              {
                $or: p.keys.map((key) => ({
                  [key]: {
                    $in: p.contact
                      ? exact
                      : [
                          q,
                          q.toLowerCase(),
                          q.toUpperCase(),
                          ...(/^(0|[1-9]\d{0,11})$/.test(q) ? [Number(q)] : []),
                        ],
                  },
                })),
              },
              size + 1,
              p.contact ? phoneCollation : undefined
            );
    const matches = take(raw, 'exact');
    function result(row, rank) {
      const employeeName = p.route === 'users' && [row.firstname, row.lastname].filter(Boolean).join(' ');
      const label = String(employeeName || row[p.title] || row.company_name || row.email || row._id);
      const suffix =
        p.contact && row.phone ? ' · •••• ' + String(row.phone).replace(/\D/g, '').slice(-4) : '';
      results.push({
        hash: p.route + '/' + row._id,
        name: label + suffix,
        group: p.group,
        kind: p.route,
        rank,
      });
    }
    matches.forEach((row) => result(row, 5));
    if (!refs && (!page || page.mode === 'name') && p.names && q.length >= 3) {
      const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const nameFilters = p.names.flatMap((name) =>
        ordinary.map((term) => ({ [name]: new RegExp('^' + escape(term)) })),
      );
      if (p.route === 'users') {
        const words = q.split(/\s+/);
        for (let split = 1; split < words.length; split++) {
          nameFilters.push({
            firstname: new RegExp('^' + escape(words.slice(0, split).join(' ')) + '$', 'i'),
            lastname: new RegExp('^' + escape(words.slice(split).join(' ')), 'i'),
          });
        }
      }
      const names = await fetch({ $or: nameFilters }, size + 1);
      take(names, 'name')
        .filter((row) => !matches.some((m) => String(m._id) === String(row._id)))
        .forEach((row) => result(row, 1));
    }
    if (!refs && (!page || page.mode === 'word') && p.names && q.length >= 3 && /\p{L}/u.test(q)) {
      const tokens = q.match(/[\p{L}\p{M}\p{N}]+/gu) || [];
      if (tokens.length) {
        const rows = await fetch({ $text: { $search: '"' + tokens.join(' ') + '"' } }, size + 1);
        for (const row of take(rows, 'word')) {
          if (!results.some((hit) => hit.hash === p.route + '/' + row._id)) result(row, 1);
        }
      }
    }
  }
  for (let i = 0; i < selected.length; i += 2) {
    const done = await Promise.allSettled(selected.slice(i, i + 2).map(read));
    partial ||= done.some((r) => r.status === 'rejected');
  }
  if (!refs && !page && (!group || group === 'Extensions')) {
    try {
      results.push(...(await require('../services/extension-search').lookup(req, q)));
    } catch {
      partial = true;
    }
  }
  results.sort(
    (a, b) => b.rank - a.rank || a.name.localeCompare(b.name) || a.hash.localeCompare(b.hash)
  );
  return { results, more, partial };
}

function createRouter(authenticate = protect) {
  const router = express.Router();
  router.use(
    authenticate,
    rateLimit({ windowMs: 60000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false })
  );
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (
      req.isApiKey ||
      !req.db ||
      !req.tenantContext?.validated ||
      !req.tenantContext?.branchId ||
      !req.tenantContext?.licenseId ||
      !req.user?._id
    )
      return res.sendStatus(403);
    next();
  });
  router.post('/', async (req, res, next) => {
    try {
      const q = req.body?.q;
      if (typeof q !== 'string' || !q.trim() || q.length > 96) return res.sendStatus(400);
      const page = req.body.page;
      if (
        page &&
        (!providers.some((p) => p.route === page.type) ||
          !['exact', 'name', 'word'].includes(page.mode) ||
          typeof page.after !== 'string' ||
          !/^[a-f0-9]{24}$/.test(page.after))
      )
        return res.sendStatus(400);
      res.json({ type: 'success', data: await records(req, q.trim(), req.body.group, null, page) });
    } catch (e) {
      next(e);
    }
  });

  router.post('/resolve', async (req, res, next) => {
    try {
      const ref = req.body?.ref;
      if (typeof ref !== 'string' || !/^[a-z]+\/[a-f0-9]{24}$/.test(ref))
        return res.sendStatus(400);
      const data = await records(req, '', '', [ref]);
      if (data.partial) return res.sendStatus(503);
      if (!data.results.length) return res.sendStatus(404);
      res.json({ type: 'success', data: data.results[0] });
    } catch (e) {
      next(e);
    }
  });

  // Store destination references only. Current ACL, branch and feature state govern their display.
  function history(req) {
    return req.db.collection('pos_search_history');
  }
  function owner(req) {
    return [req.tenantContext.licenseId, req.tenantContext.branchId, req.user._id].join(':');
  }
  router.get('/history', async (req, res, next) => {
    try {
      const cutoff = Date.now() - 30 * 86400000;
      const doc = await history(req).findOne({ _id: owner(req) });
      const events = (doc?.events || []).filter((e) => e.at > cutoff);
      const refs = [
        ...new Set(events.map((e) => e.hash).filter((hash) => /^[a-z]+\/[a-f0-9]{24}$/.test(hash))),
      ].slice(-20);
      const found = refs.length ? await records(req, '', '', refs) : { results: [] };
      const allowed = new Set(found.results.map((r) => r.hash));
      res.json({
        type: 'success',
        data: {
          generation: doc?.generation || 0,
          events: events.filter((e) => !/\/[a-f0-9]{24}$/.test(e.hash) || allowed.has(e.hash)),
          records: found.results,
        },
      });
    } catch (e) {
      next(e);
    }
  });
  router.post('/history', async (req, res, next) => {
    try {
      const hash = req.body?.hash;
      if (typeof hash !== 'string' || !/^[a-z][\w@./-]{0,160}$/i.test(hash))
        return res.sendStatus(400);
      const eventId = req.body.eventId;
      if (
        eventId !== undefined &&
        (typeof eventId !== 'string' || !/^[a-f\d-]{36}$/i.test(eventId))
      )
        return res.sendStatus(400);
      const collection = history(req),
        _id = owner(req);
      const update = {
        $set: { expiresAt: new Date(Date.now() + 30 * 86400000) },
        $push: {
          events: { $each: [{ hash, at: Date.now(), ...(eventId && { eventId }) }], $slice: -80 },
        },
      };
      const generation = req.body.generation ?? 0;
      if (!Number.isSafeInteger(generation) || generation < 0) return res.sendStatus(400);
      const filter = {
        _id,
        ...(generation
          ? { generation }
          : { $or: [{ generation: 0 }, { generation: { $exists: false } }] }),
        ...(eventId && { 'events.eventId': { $ne: eventId } }),
      };
      try {
        await collection.updateOne(filter, update, { upsert: true });
      } catch (error) {
        if (error.code !== 11000) throw error;
        await collection.updateOne(filter, update);
      }
      res.json({ type: 'success' });
    } catch (e) {
      next(e);
    }
  });
  router.delete('/history', async (req, res, next) => {
    try {
      const doc = await history(req).findOneAndUpdate(
        { _id: owner(req) },
        {
          $inc: { generation: 1 },
          $set: { events: [], expiresAt: new Date(Date.now() + 30 * 86400000) },
        },
        { upsert: true, returnDocument: 'after', includeResultMetadata: false }
      );
      res.json({ type: 'success', data: { generation: doc.generation } });
    } catch (e) {
      next(e);
    }
  });
  return router;
}
module.exports = createRouter();
module.exports.createRouter = createRouter;
