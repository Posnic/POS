'use strict';

/**
 * M4 branch selector: Module On/Off for another branch of the same license
 * (setting.model updateBranchModules / getBranchModules / the remote-target
 * dispatch inside updateCommonSettings).
 *
 * The rules that must hold, learned the hard way on this exact seam:
 *  - presence-gating: a payload that omits a toggle leaves it untouched
 *    (the "switched off all, refreshed, all on" incident was a write path
 *    silently dropping keys);
 *  - a remote target writes TOGGLES ONLY - the rest of the common-settings
 *    surface reads controls still showing the session branch's values, and
 *    writing them would clobber the target's real settings;
 *  - the license filter is the wall: a foreign branch id matches nothing;
 *  - reads parse with the same defaults the whole app gates on (offOnly
 *    keys absent = ON, onOnly keys absent = OFF).
 */

const SettingModel = require('../../../src/models/setting.model');

function makeModel(branchRows) {
  const model = Object.create(SettingModel.prototype);
  model.branchId = '64a000000000000000000aaa';
  model.licenseId = '64a00000000000000000ccc1';
  model.user = { _id: '64a00000000000000000eee1', access: {} };
  model.normalizeId = (v) => String(v);
  const collection = {
    rows: branchRows,
    findOne: async (q) =>
      branchRows.find(
        (r) => String(r._id) === String(q._id) && String(r.license) === String(q.license)
      ) || null,
    updateOne: async (q, u) => {
      const row = branchRows.find(
        (r) => String(r._id) === String(q._id) && String(r.license) === String(q.license)
      );
      if (row) Object.assign(row, u.$set);
      return { matchedCount: row ? 1 : 0 };
    },
  };
  model.getCollection = async () => collection;
  return model;
}

const TARGET = '64a000000000000000000bbb';
const LICENSE = '64a00000000000000000ccc1';

describe('updateBranchModules', () => {
  test('writes only the sent toggles, parsed by each key`s own rule', async () => {
    const rows = [{ _id: TARGET, license: LICENSE, module_tax_enable: true, sales_prefix: 'SAL' }];
    const model = makeModel(rows);
    const r = await model.updateBranchModules(TARGET, {
      module_tax_enable: 'false',
      staff_tips_enable: 'true',
      receiving_prefix: 'REC', // non-toggle: must NOT write
      sales_prefix: 'XXX',
    });
    expect(r.status).toBe(true);
    expect(rows[0].module_tax_enable).toBe(false);
    expect(rows[0].staff_tips_enable).toBe(true);
    expect(rows[0].sales_prefix).toBe('SAL');
    expect(rows[0].receiving_prefix).toBeUndefined();
  });

  test('presence-gating: omitted toggles stay untouched', async () => {
    const rows = [{ _id: TARGET, license: LICENSE, module_cashbook_enable: false }];
    const model = makeModel(rows);
    await model.updateBranchModules(TARGET, { module_tax_enable: 'false' });
    expect(rows[0].module_cashbook_enable).toBe(false);
    expect(rows[0].module_tax_enable).toBe(false);
  });

  test('clamps the idle minutes like the session path does', async () => {
    const rows = [{ _id: TARGET, license: LICENSE }];
    const model = makeModel(rows);
    await model.updateBranchModules(TARGET, { till_lock_idle_minutes: '9999' });
    expect(rows[0].till_lock_idle_minutes).toBe(120);
  });

  test('a branch outside this license is not-found, never a write', async () => {
    const rows = [{ _id: TARGET, license: 'OTHER-LICENSE', module_tax_enable: true }];
    const model = makeModel(rows);
    const r = await model.updateBranchModules(TARGET, { module_tax_enable: 'false' });
    expect(r.status).toBe(false);
    expect(rows[0].module_tax_enable).toBe(true);
  });
});

describe('getBranchModules', () => {
  test('parses stored values and fills absent keys with the app`s defaults', async () => {
    const rows = [
      { _id: TARGET, license: LICENSE, branch_name: 'Anna Nagar', module_tax_enable: 'false' },
    ];
    const model = makeModel(rows);
    const r = await model.getBranchModules(TARGET);
    expect(r.status).toBe(true);
    expect(r.data.branch_name).toBe('Anna Nagar');
    expect(r.data.modules.module_tax_enable).toBe(false); // stored off
    expect(r.data.modules.module_cashbook_enable).toBe(true); // absent, offOnly => ON
    expect(r.data.modules.staff_tips_enable).toBe(false); // absent, onOnly => OFF
    expect(r.data.modules.till_lock_idle_minutes).toBe(0);
  });

  test('foreign branch answers not-found, never data', async () => {
    const model = makeModel([{ _id: TARGET, license: 'OTHER' }]);
    const r = await model.getBranchModules(TARGET);
    expect(r.status).toBe(false);
    expect(r.data).toBe(null);
  });
});

describe('updateCommonSettings remote-target dispatch', () => {
  test('a different target_branch_id routes to the modules-only path', async () => {
    const rows = [{ _id: TARGET, license: LICENSE, print_url: true }];
    const model = makeModel(rows);
    const r = await model.updateCommonSettings({
      target_branch_id: TARGET,
      module_themes_enable: 'false',
      print_url: 'false', // session-surface field: must NOT write remotely
      receiving_prefix: 'REC',
    });
    expect(r.status).toBe(true);
    expect(r.data.target_branch_id).toBe(TARGET);
    expect(rows[0].module_themes_enable).toBe(false);
    expect(rows[0].print_url).toBe(true);
  });

  test('the session branch as target follows the normal full path, not the remote one', async () => {
    const model = makeModel([]);
    // Force the full path to fail fast at its collection access so we can
    // tell which path ran: the remote path would have succeeded quietly.
    model.getCollection = async () => {
      throw new Error('full-path-marker');
    };
    const r = await model.updateCommonSettings({
      target_branch_id: model.branchId,
      module_themes_enable: 'false',
    });
    expect(r.status).toBe(false);
    expect(r.message).toContain('full-path-marker');
  });
});
