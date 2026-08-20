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
