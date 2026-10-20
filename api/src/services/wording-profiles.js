'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ObjectId } = require('mongodb');
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const languages = path.resolve(__dirname, '../catalogs');
const placeholders = (value) =>
  (String(value).match(/\{\{?\s*[\w.]+\s*\}?\}|%(?:\d+\$)?[sdif]/g) || []).sort().join('|');

/** Catalogs belong to installed code; tenant overrides never modify these files. */
function createRegistry(core, extensions = []) {
  const labels = new Map();
  for (const [key, value] of Object.entries(core)) {
    if (typeof value === 'string')
      labels.set('posnic.' + key, {
        id: 'posnic.' + key,
        key,
        english: value,
        module: 'Posnic',
        defaults: { en: value },
      });
  }
  for (const manifest of extensions) {
    if (
      !/^[a-z][a-z0-9-]{1,60}$/.test(manifest.extensionId || '') ||
      manifest.labelSchemaVersion !== 1 ||
      !Array.isArray(manifest.labels)
    )
      fail('Invalid extension label manifest');
    for (const label of manifest.labels) {
      if (
        !label.id?.startsWith('ext.' + manifest.extensionId + '.') ||
        !/^[\w.-]{1,180}$/.test(label.id) ||
        labels.has(label.id) ||
        typeof label.defaults?.en !== 'string'
      )
        fail('Invalid or duplicate extension label');
      labels.set(label.id, {
        ...label,
        key: label.id,
        english: label.defaults.en,
        module: manifest.extensionId,
      });
    }
  }
  return labels;
}
function registry() {
  const core = require('../catalogs/wording-core.json').labels;
  const dir = path.join(languages, 'extensions');
  const manifests = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((x) => /^[\w-]+\.json$/.test(x))
        .sort()
        .map((x) => JSON.parse(fs.readFileSync(path.join(dir, x), 'utf8')))
    : [];
  return createRegistry(core, manifests);
}
function supportedLocales() {
  return require('../catalogs/wording-core.json').locales;
}
function validateDraft(input, labels, locales) {
  if (
    !input ||
    typeof input !== 'object' ||
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 100 ||
    !locales.includes(input.locale)
  )
    fail('Choose a profile name and supported base language');
  if (
    !input.overrides ||
    Array.isArray(input.overrides) ||
    typeof input.overrides !== 'object' ||
    Object.keys(input.overrides).length > 2000
  )
    fail('Invalid wording replacements');
  const overrides = Object.create(null);
  for (const [id, value] of Object.entries(input.overrides)) {
    const label = labels.get(id);
    if (
      typeof value !== 'string' ||
      value.length > 2000 ||
      /[<>]/.test(value) ||
      Array.from(value).some(
        (char) => char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0))
      )
    )
      fail('Wording must be plain text, up to 2000 characters');
    if (!value.trim()) continue;
    // Unknown labels are retained through downgrade/uninstall, but never resolved.
    if (label && placeholders(value) !== placeholders(label.english))
      fail('Keep the placeholders in ' + label.english);
    overrides[id] = value.trim();
  }
  return { name: input.name.trim(), locale: input.locale, overrides };
}
function resolveBundle(state, branch, locale, labels) {
  if (state.schemaVersion !== 1)
    throw Object.assign(new Error('This profile requires a newer Posnic version'), { status: 409 });
  const assignment = state.assignments?.[branch]?.[locale];
  const profile = state.profiles?.find((p) => p.id === assignment?.profileId);
  const revision = profile?.revisions.find((r) => r.id === assignment?.revisionId);
  const values = Object.create(null);
  if (revision?.locale === locale)
    for (const [id, value] of Object.entries(revision.overrides)) {
      const label = labels.get(id);
      if (label && typeof value === 'string' && placeholders(value) === placeholders(label.english))
        values[label.key] = value;
    }
  // Compatibility bridge for apps whose bundled translations use English
  // source strings. Never guess when equal source text has different meanings.
  const candidates = new Map();
  for (const label of labels.values()) {
    const candidate = values[label.key] ?? null;
    if (!candidates.has(label.english)) candidates.set(label.english, candidate);
    else if (candidates.get(label.english) !== candidate) candidates.set(label.english, null);
  }
  const sourceValues = Object.create(null);
  for (const [source, value] of candidates)
    if (typeof value === 'string') sourceValues[source] = value;
  return {
    schemaVersion: 1,
    revision: state.revision,
    locale,
    branchId: branch,
    profileId: profile?.id || null,
    profileRevision: revision?.id || null,
    profileName: revision?.name || null,
    values,
    sourceValues,
  };
}

class WordingProfiles {
  constructor(collection, license, labels = registry()) {
    if (!ObjectId.isValid(String(license))) fail('Tenant context required', 403);
    this.collection = collection;
    this.license = new ObjectId(String(license));
    this.labels = labels;
    this.id = new ObjectId(
      crypto
        .createHash('sha256')
        .update('wording-profiles:' + this.license)
        .digest('hex')
        .slice(0, 24)
    );
  }
  async read() {
    return (
      (await this.collection.findOne({
        _id: this.id,
        license: this.license,
        kind: 'wording_profiles',
      })) || {
        _id: this.id,
        license: this.license,
        kind: 'wording_profiles',
        schemaVersion: 1,
        revision: 0,
        profiles: [],
        assignments: {},
      }
    );
  }
  async update(expected, actor, change) {
    const state = await this.read();
    if (state.schemaVersion !== 1) fail('This profile requires a newer Posnic version', 409);
    if (!Number.isSafeInteger(expected) || state.revision !== expected)
      fail('Wording changed. Reload before saving.', 409);
    change(state);
    state.revision++;
    state.updated_date = new Date();
    state.updated_by = String(actor);
    state.created_date ||= state.updated_date;
    if (Buffer.byteLength(JSON.stringify(state)) > 4 * 1024 * 1024)
      fail('Profile storage limit reached. Contact your administrator.');
    try {
      if (expected === 0) await this.collection.insertOne(state);
      else {
        const result = await this.collection.replaceOne(
          { _id: this.id, license: this.license, revision: expected },
          state
        );
        if (!result.matchedCount) fail('Wording changed. Reload before saving.', 409);
      }
    } catch (error) {
      if (error.code === 11000) fail('Wording changed. Reload before saving.', 409);
      throw error;
    }
    return state;
  }
  async save(input, actor) {
    const draft = validateDraft(input, this.labels, supportedLocales());
    return this.update(input.expectedRevision, actor, (state) => {
      let profile = state.profiles.find((p) => p.id === input.id);
      if (!profile) {
        if (input.id || state.profiles.length >= 30)
          fail('Profile not found or profile limit reached');
        profile = { id: crypto.randomUUID(), revisions: [] };
        state.profiles.push(profile);
      }
      profile.draft = draft;
    });
  }
  async publish(input, actor, allowedBranches) {
    return this.update(input.expectedRevision, actor, (state) => {
      const profile = state.profiles.find((p) => p.id === input.id);
      if (!profile?.draft) fail('Save the profile first');
      const draft = validateDraft(profile.draft, this.labels, supportedLocales());
      if (
        !Array.isArray(input.branches) ||
        input.branches.some((b) => !allowedBranches.includes(b))
      )
        fail('Choose authorized branches');
      const revision = {
        ...draft,
        id: crypto.randomUUID(),
        publishedAt: new Date(),
        publishedBy: String(actor),
      };
      profile.revisions.push(revision);
      // Remove prior assignments for this profile, retaining all historic revisions.
      for (const locales of Object.values(state.assignments))
        for (const [locale, assigned] of Object.entries(locales))
          if (assigned.profileId === profile.id) delete locales[locale];
      for (const branch of new Set(input.branches)) {
        state.assignments[branch] ||= {};
        state.assignments[branch][draft.locale] = {
          profileId: profile.id,
          revisionId: revision.id,
        };
      }
    });
  }
}
module.exports = {
  WordingProfiles,
  createRegistry,
  registry,
  supportedLocales,
  validateDraft,
  resolveBundle,
  placeholders,
};
