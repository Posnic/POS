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
const {
  GROUPS,
  coerceFeatureToggle,
  featureToggleRepairs,
} = require('../services/settings-groups');

/* group -> collection. Named per group so an ACL can be put on secrets
   alone without teaching it about individual keys. */
const COLLECTION_OF = Object.freeze({
  features: 'branch_features',
  preferences: 'branch_preferences',
  documents: 'branch_documents',
  secrets: 'branch_secrets',
  sharing: 'branch_sharing',
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

      /* Rows written before the save path coerced still hold string
         booleans; the resolver answers with the boolean they meant, so a
         poisoned row cannot show a switched-off shop as all-on. */
      if (group === 'features') {
        for (const k of Object.keys(values)) values[k] = coerceFeatureToggle(values[k]);
        for (const k of Object.keys(inherited)) inherited[k] = coerceFeatureToggle(inherited[k]);
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

  /*
   * S6 (D4). Make one branch behave like another.
   *
   * WHAT GETS COPIED is the whole design question. Copying the resolved value
   * of every key would bake the source's entire configuration into the target
   * as explicit overrides - and the target would then never follow an
   * account-level change again. Copying only the target-collection row would
   * copy almost nothing today, because most shops still hold their values in
   * the legacy branches document.
   *
   * So: copy the keys the source branch DECIDES - source 'branch' or 'legacy'
   * - and skip the ones it merely INHERITS. The target ends up behaving like
   * the source, while both keep inheriting the shop-wide rules together. That
   * is the difference the design draws between copying, which drifts, and
   * inheritance, which stays true.
   *
   * Secrets are never copied. Credentials belong to the shop that owns them,
   * and a copy would silently duplicate a password into a branch nobody
   * intended to give it to.
   */
  async copyGroups(groups, fromBranchId, toBranchId, context = {}) {
    const wanted = Array.isArray(groups) ? groups : [];
    if (!wanted.length) {
      return { status: false, data: null, message: 'Pick at least one group to copy' };
    }
    if (wanted.includes('secrets')) {
      return {
        status: false,
        data: { refused: ['secrets'] },
        message: 'Credentials are never copied between branches',
      };
    }
    const unknown = wanted.filter((g) => !COLLECTION_OF[g]);
    if (unknown.length) {
      return {
        status: false,
        data: { unknown },
        message: 'Unknown settings group: ' + unknown.join(', '),
      };
    }
    if (!fromBranchId || !toBranchId || String(fromBranchId) === String(toBranchId)) {
      return { status: false, data: null, message: 'Pick two different branches' };
    }

    const licenseId = context.licenseId;
    const copied = {};
    try {
      for (const group of wanted) {
        const read = await this.resolveGroup(group, { branchId: fromBranchId, licenseId });
        if (!read.status) return read;

        const own = {};
        for (const [key, where] of Object.entries(read.data.source || {})) {
          // 'account' means the source inherits it too - leave the target to
          // inherit it as well rather than freezing today's answer into it
          if (where === 'branch' || where === 'legacy') own[key] = read.data.values[key];
        }

        if (!Object.keys(own).length) {
          copied[group] = [];
          continue;
        }
        const write = await this.saveGroup(group, own, { branchId: toBranchId, licenseId });
        if (!write.status) return write;
        copied[group] = write.data.written;
      }
      return {
        status: true,
        data: { from: String(fromBranchId), to: String(toBranchId), copied },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in SettingsRepository.copyGroups:', error);
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
        /* The welcome (and any checkbox map) sends 'true'/'false' strings.
           Stored verbatim they read as ENABLED through every `!== false`
           gate - the all-toggles-on incident. The boolean is stored, so no
           reader ever meets the string. null still means inherit. */
        if (key === 'analytics_enable') {
          /* same string-boolean trap as the feature toggles */
          accepted[key] = coerceFeatureToggle(value);
        } else if (key === 'analytics_ga_id') {
          const id = String(value == null ? '' : value)
            .trim()
            .toUpperCase();
          if (id !== '' && !require('../services/analytics-config').isPlausibleGaId(id)) {
            return {
              status: false,
              data: null,
              message: 'The Google Analytics id should look like G-XXXXXXXXXX',
            };
          }
          accepted[key] = id;
        } else {
          accepted[key] = group === 'features' ? coerceFeatureToggle(value) : value;
        }
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

      /* the CSP + runtime-info read analytics through a 30s cache - a
         toggle must bite on the very next request */
      if (group === 'preferences') {
        try {
          require('../services/analytics-config').invalidate();
        } catch (e) {
          /* the cache TTL still catches up */
        }
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
