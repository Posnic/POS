'use strict';
const access = require('../utils/branch-access');
const runtime = require('./extension-runtime');

const safeKey = (value) =>
  typeof value === 'string' &&
  /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) &&
  !['constructor', 'prototype', '__proto__'].includes(value);
const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value);

// A signed package may expose named fields from its own state. Entry IDs are
// passed to its sandbox as navigation data, never interpreted as commands.
function contribution(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 12) throw Error('Invalid extension search contribution');
  const seen = new Set();
  return raw.map((entry) => {
    if (
      !entry ||
      !safeKey(entry.target) ||
      seen.has(entry.target) ||
      typeof entry.label !== 'string' ||
      !entry.label.trim() ||
      entry.label.length > 80
    )
      throw Error('Invalid extension search destination');
    seen.add(entry.target);
    const keywords = entry.keywords || [];
    if (
      !Array.isArray(keywords) ||
      keywords.length > 16 ||
      keywords.some((k) => typeof k !== 'string' || k.length > 64)
    )
      throw Error('Invalid extension search keywords');
    if (entry.records && !['records', 'id', 'title'].every((key) => safeKey(entry[key])))
      throw Error('Invalid extension search record mapping');
    return {
      target: entry.target,
      label: entry.label,
      keywords,
      action: entry.action === 'create' ? 'create' : 'open',
      ...(entry.records && { records: entry.records, id: entry.id, title: entry.title }),
    };
  });
}

async function lookup(req, query) {
  const descriptors = runtime
    .list()
    .filter(
      (d) =>
        d.view &&
        d.search?.length &&
        access.allowed(req.user, d.permissionModule || 'extensions', 'read')
    );
  if (!descriptors.length) return [];
  const ids = descriptors.map((d) => d.id);
  const scope = { license: req.tenantContext.licenseId, branch_id: req.tenantContext.branchId };
  const installs = await req.db
    .collection('extension_installations')
    .find(
      { ...scope, enabled: true, extensionId: { $in: ids } },
      { projection: { extensionId: 1, packageDigest: 1 } }
    )
    .maxTimeMS(220)
    .toArray();
  const digests = new Map(installs.map((i) => [i.extensionId, i.packageDigest]));
  const found = [];
  for (const descriptor of descriptors) {
    if (digests.get(descriptor.id) !== descriptor.packageDigest) continue;
    const projection = { lifecycle: 1 };
    for (const spec of descriptor.search) if (spec.records) projection['data.' + spec.records] = 1;
    const row = await req.db
      .collection('extension_namespaces')
      .findOne({ ...scope, extensionId: descriptor.id }, { projection, maxTimeMS: 220 });
    if (row?.lifecycle?.enabled === false || row?.lifecycle?.installed === false) continue;
    for (const spec of descriptor.search) {
      const base = 'extensions/' + descriptor.id + '/find/' + spec.target + '/';
      function add(id, label, keywords) {
        if (!safeId(id) || typeof label !== 'string' || !label.trim()) return;
        const text = [id, label, ...keywords].join(' ').toLowerCase();
        if (
          !query
            .toLowerCase()
            .split(/\s+/)
            .every((word) => text.includes(word))
        )
          return;
        found.push({
          name: label.slice(0, 120),
          hash: base + id,
          kind: descriptor.displayName || descriptor.id,
          group: 'Extensions',
          rank: id.toLowerCase() === query.toLowerCase() ? 5 : 2,
        });
      }
      if (!spec.records) add('page', spec.label, spec.keywords);
      else {
        const data = (row?.data || descriptor.initialState)?.[spec.records];
        if (Array.isArray(data))
          for (const r of data) {
            if (r && found.length < 24) add(String(r[spec.id] ?? ''), r[spec.title], []);
          }
      }
      if (found.length >= 24) return found;
    }
  }
  return found;
}
module.exports = { contribution, lookup };
