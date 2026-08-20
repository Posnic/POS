'use strict';

/*
 * Settings read path (SETTINGS_AND_BRANCH_SCOPE_DESIGN, step S1).
 *
 * Reads the four new per-group collections and falls back to the legacy
 * `branches` document for anything not stored there yet. NOTHING writes
 * through here: while the migration runs, the branches document stays the
 * source of truth and these collections are additive, so rolling back is
 * deleting rows rather than restoring data.
 *
 * Resolution order for every key, most specific first:
 *
 *   branch row  ->  account row  ->  legacy branches doc  ->  absent
 *
 * The account row is the level the design calls for and every comparable
 * product has: change a policy once and it lands everywhere that has not
 * deliberately diverged. That is why `null` in a branch row means INHERIT
 * and is not the same as `false` - a distinction a flat copy cannot make,
 * and the reason copying settings between branches drifts while inheriting
 * them does not.
 */

const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');
const { GROUPS } = require('../services/settings-groups');

/* group -> collection. Named per group so an ACL can be put on secrets
   alone without teaching it about individual keys. */
const COLLECTION_OF = Object.freeze({
  features: 'branch_features',
  preferences: 'branch_preferences',
  documents: 'branch_documents',
  secrets: 'branch_secrets',
});

class SettingsRepository extends BaseModel {
  constructor() {
    super('branches');
  }

  _ids(context) {
    const branchId = context && context.branchId;
    const licenseId = context && context.licenseId;
    if (!branchId || !ObjectId.isValid(String(branchId))) return null;
    if (!licenseId || !ObjectId.isValid(String(licenseId))) return null;
    return {
      branch: new ObjectId(String(branchId)),
      license: new ObjectId(String(licenseId)),
    };
  }

  /*
   * One group, resolved. `values` carries only keys that group owns, so a
   * caller handed `secrets` cannot accidentally read a printing preference
   * and vice versa.
   */
  async resolveGroup(group, context = {}) {
    const collectionName = COLLECTION_OF[group];
    if (!collectionName) {
      return { status: false, data: null, message: 'Unknown settings group' };
    }
    const ids = this._ids(context);
    if (!ids) return { status: false, data: null, message: 'Branch context is required' };

    try {
      const collection = await this.getCollection(collectionName);
      const [accountRow, branchRow] = await Promise.all([
        collection.findOne({ license: ids.license, branch_id: null }),
        collection.findOne({ license: ids.license, branch_id: ids.branch }),
      ]);

      const legacy = await this._legacyBranchDoc(ids);
      const keys = GROUPS[group] || [];
      const values = {};
      const source = {};

      for (const key of keys) {
        // null in a branch row means INHERIT, so it must not shadow the
        // account value the way false would
        if (branchRow && branchRow[key] !== undefined && branchRow[key] !== null) {
          values[key] = branchRow[key];
          source[key] = 'branch';
          continue;
        }
        if (accountRow && accountRow[key] !== undefined && accountRow[key] !== null) {
          values[key] = accountRow[key];
          source[key] = 'account';
          continue;
        }
        if (legacy && legacy[key] !== undefined) {
          values[key] = legacy[key];
          source[key] = 'legacy';
        }
      }

      return { status: true, data: { group, values, source }, message: 'success' };
    } catch (error) {
      console.error('Error in SettingsRepository.resolveGroup:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async _legacyBranchDoc(ids) {
    const branches = await this.getCollection('branches');
    return branches.findOne({ _id: ids.branch, license: ids.license });
  }

  /*
   * Write one group (S2 - dual write).
   *
   * Only the keys ACTUALLY SENT are written, and only those belonging to this
   * group. That is the whole point of the split: the old path built one $set
   * from the entire settings form, so a four-key payload wrote undefined over
   * every control the caller never showed. Here a key that was not sent
   * cannot appear in the update at all, so that bug is not merely fixed - it
   * is unsayable.
   *
   * Dual write: the same keys also go to the legacy branches document, which
   * stays the source of truth until the migration finishes. Both stores are
   * true at once, so rolling back means deleting the new rows and nothing is
   * lost. `level: 'account'` writes the inherited row (branch_id null).
   */
  async saveGroup(group, values = {}, context = {}, options = {}) {
    const collectionName = COLLECTION_OF[group];
    if (!collectionName) {
      return { status: false, data: null, message: 'Unknown settings group' };
    }
    const ids = this._ids(context);
    if (!ids) return { status: false, data: null, message: 'Branch context is required' };

    const owned = new Set(GROUPS[group] || []);
    const accepted = {};
    const rejected = [];
    for (const [key, value] of Object.entries(values || {})) {
      if (owned.has(key)) {
        accepted[key] = value;
      } else {
        rejected.push(key);
      }
    }
    if (rejected.length) {
      // refused, not ignored - a setting that vanishes without a word is the
      // failure mode this whole design exists to end
      return {
        status: false,
        data: { rejected },
        message: 'These keys do not belong to ' + group + ': ' + rejected.join(', '),
      };
    }
    if (!Object.keys(accepted).length) {
      return { status: true, data: { written: [] }, message: 'Nothing to write' };
    }

    try {
      const isAccount = options.level === 'account';
      const collection = await this.getCollection(collectionName);
      await collection.updateOne(
        { license: ids.license, branch_id: isAccount ? null : ids.branch },
        { $set: { ...accepted, license: ids.license, branch_id: isAccount ? null : ids.branch } },
        { upsert: true }
      );

      /* Legacy mirror. An account-level write has no single branch to mirror
         to, so it deliberately does not touch the old document - the resolver
         already falls back to it, and account values are new behaviour that
         no legacy reader knows about. */
      if (!isAccount) {
        const branches = await this.getCollection('branches');
        await branches.updateOne({ _id: ids.branch, license: ids.license }, { $set: accepted });
      }

      return {
        status: true,
        data: { written: Object.keys(accepted), level: isAccount ? 'account' : 'branch' },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in SettingsRepository.saveGroup:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /* Every group at once, for the screens that still show all of it. */
  async resolveAll(context = {}) {
    const out = {};
    for (const group of Object.keys(COLLECTION_OF)) {
      const r = await this.resolveGroup(group, context);
      if (!r.status) return r;
      out[group] = r.data.values;
    }
    return { status: true, data: out, message: 'success' };
  }
}

module.exports = SettingsRepository;
module.exports.COLLECTION_OF = COLLECTION_OF;
