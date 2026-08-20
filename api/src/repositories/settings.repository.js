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
      /* S5. What this branch WOULD show if its own override were removed.
         Without it a screen can say "overridden here" but cannot say what
         "reset to inherited" would actually do - so the one control the whole
         inheritance model exists for would be a leap in the dark. */
      const inherited = {};

      const has = (row, key) => row && row[key] !== undefined && row[key] !== null;

      for (const key of keys) {
        // the value in force below this branch, whatever the branch itself says
        if (has(accountRow, key)) inherited[key] = accountRow[key];
        else if (legacy && legacy[key] !== undefined) inherited[key] = legacy[key];

        // null in a branch row means INHERIT, so it must not shadow the
        // account value the way false would
        if (has(branchRow, key)) {
          values[key] = branchRow[key];
          source[key] = 'branch';
          continue;
        }
        if (has(accountRow, key)) {
          values[key] = accountRow[key];
          source[key] = 'account';
          continue;
        }
        if (legacy && legacy[key] !== undefined) {
          values[key] = legacy[key];
          source[key] = 'legacy';
        }
      }

      return { status: true, data: { group, values, source, inherited }, message: 'success' };
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
  /*
   * S5. The ACCOUNT row on its own, unresolved.
   *
   * resolveGroup answers "what is in force at this branch". Editing the
   * account level needs the opposite: what this level itself says, with
   * nothing merged in - otherwise the form would show a branch's override,
   * and saving it would silently push that one branch's choice onto every
   * other shop. `set` names the keys the account actually decides, so the
   * screen can tell "all shops say false" from "no shop-wide rule".
   */
  async accountGroup(group, context = {}) {
    const collectionName = COLLECTION_OF[group];
    if (!collectionName) {
      return { status: false, data: null, message: 'Unknown settings group' };
    }
    const ids = this._ids(context);
    if (!ids) return { status: false, data: null, message: 'Branch context is required' };

    try {
      const collection = await this.getCollection(collectionName);
      const accountRow = await collection.findOne({ license: ids.license, branch_id: null });
      const values = {};
      const set = [];
      for (const key of GROUPS[group] || []) {
        if (accountRow && accountRow[key] !== undefined && accountRow[key] !== null) {
          values[key] = accountRow[key];
          set.push(key);
        }
      }
      return { status: true, data: { group, level: 'account', values, set }, message: 'success' };
    } catch (error) {
      console.error('Error in SettingsRepository.accountGroup:', error);
      return { status: false, data: null, message: error.message };
    }
  }

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
    /* S5. `null` means INHERIT - "stop deciding this here and take whatever
       the level above says". It is a different instruction from writing a
       value, so it is separated out before anything touches the database.
       The key is UNSET rather than stored as null: undefined and null already
       resolve identically, and an absent key cannot later be mistaken for a
       deliberate blank. */
    const toSet = {};
    const toClear = [];
    for (const [key, value] of Object.entries(accepted)) {
      if (value === null) toClear.push(key);
      else toSet[key] = value;
    }

    if (!Object.keys(toSet).length && !toClear.length) {
      return { status: true, data: { written: [], cleared: [] }, message: 'Nothing to write' };
    }

    try {
      const isAccount = options.level === 'account';
      const collection = await this.getCollection(collectionName);
      const update = {
        $set: { license: ids.license, branch_id: isAccount ? null : ids.branch },
      };
      if (Object.keys(toSet).length) Object.assign(update.$set, toSet);
      if (toClear.length) {
        update.$unset = toClear.reduce((acc, k) => ({ ...acc, [k]: '' }), {});
      }
      await collection.updateOne(
        { license: ids.license, branch_id: isAccount ? null : ids.branch },
        update,
        { upsert: true }
      );

      /* Legacy mirror. An account-level write has no single branch to mirror
         to, so it deliberately does not touch the old document - the resolver
         already falls back to it, and account values are new behaviour that
         no legacy reader knows about.
         ONLY the set keys are mirrored. Mirroring a cleared one would write
         null over the legacy value, destroying the very thing the branch is
         being told to fall back ON - "reset to inherited" would delete what it
         meant to inherit. */
      if (!isAccount && Object.keys(toSet).length) {
        const branches = await this.getCollection('branches');
        await branches.updateOne({ _id: ids.branch, license: ids.license }, { $set: toSet });
      }

      return {
        status: true,
        data: {
          written: Object.keys(toSet),
          cleared: toClear,
          level: isAccount ? 'account' : 'branch',
        },
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
