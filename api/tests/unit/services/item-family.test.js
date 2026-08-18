'use strict';

/**
 * Variant family creation (VARIANT_SYSTEM_RESEARCH V1, createItemFamily).
 *
 * The promises under test: EVERYTHING validates before ANYTHING is created
 * (the old flow's half-created families were the whole point of building
 * this); every child carries the same variant_group_id and the stamped
 * axis/value/parent; a mid-way failure hard-deletes exactly what was just
 * created and reports which variant failed; and the repository passthrough
 * only links items when a VALID group id is present - absence never clears
 * an existing link.
 */

const ItemService = require('../../../src/services/item.service');

function makeService() {
  const svc = Object.create(ItemService.prototype);
  svc.calls = [];
  svc.deleted = [];
  let counter = 0;
  svc.addItem = async ({ data }) => {
    svc.calls.push(data);
    if (data.__fail) return { status: false, data: null, message: 'boom' };
    counter++;
    return { status: true, data: { id: 'id-' + counter }, message: 'ok' };
  };
  svc.repository = {
    hardDeleteItems: async (ids) => {
      svc.deleted.push(...ids);
      return { deleted: ids.length };
    },
  };
  return svc;
}

const CTX = { branchId: 'B1', licenseId: '64a00000000000000000ccc1', user: { name: 'T' } };

const family = (rows, extra = {}) => ({
  data: {
    items: rows,
    variant_axis: 'Size',
    variant_parent_name: 'Shirt',
    ...extra,
  },
  ...CTX,
});

describe('validation happens before creation', () => {
  test('fewer than two variants is not a family', async () => {
    const svc = makeService();
    const r = await svc.createItemFamily(family([{ name: 'Shirt / S', variant_value: 'S' }]));
    expect(r.status).toBe(false);
    expect(svc.calls).toHaveLength(0);
  });

  test('a row without a name or value stops everything before anything exists', async () => {
    const svc = makeService();
    const r = await svc.createItemFamily(
      family([
        { name: 'Shirt / S', variant_value: 'S' },
        { name: '', variant_value: 'M' },
      ])
    );
    expect(r.status).toBe(false);
    expect(r.message).toContain('Variant 2');
    expect(svc.calls).toHaveLength(0);
  });

  test('duplicate values and duplicate barcodes are refused up front', async () => {
    const svc = makeService();
    const dupValue = await svc.createItemFamily(
      family([
        { name: 'Shirt / S', variant_value: 'S' },
        { name: 'Shirt / s', variant_value: 's' },
      ])
    );
    expect(dupValue.status).toBe(false);
    const dupBarcode = await svc.createItemFamily(
      family([
        { name: 'Shirt / S', variant_value: 'S', barcode_id: '111' },
        { name: 'Shirt / M', variant_value: 'M', barcode_id: '111' },
      ])
    );
    expect(dupBarcode.status).toBe(false);
    expect(svc.calls).toHaveLength(0);
  });
});

describe('creation', () => {
  test('every child carries the same group id and the stamped link fields', async () => {
    const svc = makeService();
    const r = await svc.createItemFamily(
      family([
        { name: 'Shirt / S', variant_value: 'S' },
        { name: 'Shirt / M', variant_value: 'M' },
        { name: 'Shirt / L', variant_value: 'L' },
      ])
    );
    expect(r.status).toBe(true);
    expect(r.data.created).toEqual(['id-1', 'id-2', 'id-3']);
    expect(svc.calls).toHaveLength(3);
    const groupIds = new Set(svc.calls.map((c) => String(c.variant_group_id)));
    expect(groupIds.size).toBe(1);
    expect(svc.calls[0].variant_axis).toBe('Size');
    expect(svc.calls[0].variant_parent_name).toBe('Shirt');
    expect(svc.calls.map((c) => c.variant_value)).toEqual(['S', 'M', 'L']);
    expect(String(r.data.variant_group_id)).toBe([...groupIds][0]);
  });

  test('a mid-way failure rolls back exactly the created children and names the culprit', async () => {
    const svc = makeService();
    const r = await svc.createItemFamily(
      family([
        { name: 'Shirt / S', variant_value: 'S' },
        { name: 'Shirt / M', variant_value: 'M', __fail: true },
        { name: 'Shirt / L', variant_value: 'L' },
      ])
    );
    expect(r.status).toBe(false);
    expect(r.data.failed_variant).toBe('M');
    expect(r.data.rolled_back).toBe(1);
    expect(svc.deleted).toEqual(['id-1']);
    expect(svc.calls).toHaveLength(2); // L was never attempted
  });
});

describe('repository passthrough', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../../../src/repositories/item.repository.js'),
    'utf8'
  );

  test('the link is presence-gated on a VALID group id and absence never clears it', () => {
    // The guard exists...
    expect(src).toContain(
      'data.variant_group_id && ObjectId.isValid(String(data.variant_group_id))'
    );
    // ...and the fields are only ever assigned inside it (no unconditional
    // variant_* keys in the updateData literal that would blank them on
    // every legacy edit).
    const assignments = src.match(/updateData\.variant_group_id/g) || [];
    expect(assignments.length).toBe(1);
    expect(src).not.toMatch(/variant_group_id:\s*(?:''|null)/);
  });
});
