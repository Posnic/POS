'use strict';
const { project } = require('../../../src/services/captain-transfer-projection');
const { buildBillPayload } = require('../../../src/helpers/bill-payload');
const { snapshotFrom } = require('../../../src/services/guest-bill.service');
const Money = require('../../../src/utils/currency');
const { ObjectId, BSON } = require('mongodb');
const transferEdit = require('../../../src/services/captain-transfer-edit');
const at = '2026-09-30T14:00:00Z';
function sale() {
  return {
    _id: 'source',
    table_number: '1',
    created_date: at,
    sales_sub_total: 100.01,
    discount: 3.17,
    tax: 5.01,
    sales_total: 101.84,
    items: [
      {
        item_id: 'corn',
        line_id: 'salt',
        item_name: 'Corn',
        item_quantity: 3,
        item_base_price: 33.3366667,
        item_tax: 5.01,
      },
    ],
    changes: [
      {
        timestamp: at,
        items: [
          { item_id: 'corn', line_id: 'salt', item_name: 'Corn', item_quantity: 3, process: 'add' },
        ],
      },
    ],
  };
}

test.each(['JPY', 'INR', 'KWD'])(
  'metadata edits preserve transferred components despite catalogue recalculation in %s',
  (currencyCode) => {
    const original = sale(),
      branch = { currencyCode },
      split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
    const transferred = { ...original, ...split.destination };
    const proposed = {
      items: transferred.items.map((item) => ({
        ...item,
        item_description: 'Less salt',
        seat: 2,
        item_tax: 999,
        tax: 99,
        total_amount: 999,
        unit_price: 999,
      })),
      sales_total: 999,
      tax: 999,
      items_total: 999,
      sales_sub_total: 999,
      discount: 0,
      changes: [...transferred.changes, { timestamp: at, items: [] }],
    };
    const result = transferEdit.metadata(transferred, proposed, branch);
    expect(result.items[0].item_description).toBe('Less salt');
    expect(result.items[0].seat).toBe(2);
    expect(result.items[0].item_tax).toBe(transferred.items[0].item_tax);
    expect(result.items[0].unit_price).toBe(transferred.items[0].unit_price);
    expect(result.changes).toEqual(proposed.changes);
    const snapshot = snapshotFrom([{ ...transferred, ...result }], branch, '1');
    expect(snapshot.totalMinor).toBe(split.preview.destination.totalMinor);
    expect(snapshot.lines[0].components).toEqual(split.preview.destination.lines[0].components);
    expect(snapshot.lines[0].seat).toBe(2);
  }
);
test.each(['quantity', 'product', 'remove', 'discount'])(
  'metadata reconciliation does not pretend a %s edit is metadata',
  (kind) => {
    const original = sale(),
      branch = { currencyCode: 'INR' },
      split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
    const transferred = { ...original, ...split.destination },
      proposed = { items: structuredClone(transferred.items) };
    if (kind === 'quantity') proposed.items[0].item_quantity = 2;
    if (kind === 'product') proposed.items[0].item_id = 'different';
    if (kind === 'remove') proposed.items = [];
    if (kind === 'discount') proposed.extra_discount = 5;
    expect(transferEdit.metadata(transferred, proposed, branch)).toBeNull();
  }
);
test.each(['JPY', 'INR', 'KWD'])(
  'financial projection conserves every component in printed and split bills for %s',
  (currencyCode) => {
    const original = sale(),
      before = structuredClone(original),
      branch = { currencyCode, indian_gst: 'enable' },
      policy = Money.policy(branch);
    const result = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
    expect(original).toEqual(before);
    for (const side of ['source', 'destination']) {
      const projected = { ...original, ...result[side] },
        expected = result.preview[side];
      const bill = buildBillPayload(projected, branch),
        snapshot = snapshotFrom([projected], branch, '1');
      expect(Money.toMinor(bill.total, policy)).toBe(expected.totalMinor);
      expect(Money.toMinor(bill.subTotal, policy)).toBe(expected.components.base);
      expect(snapshot.lines.map((row) => row.components)).toEqual(
        expected.lines.map((row) => row.components)
      );
      expect(snapshot.totalMinor).toBe(expected.totalMinor);
      expect(
        projected.items.reduce((sum, item) => sum + Money.toMinor(item.item_tax, policy), 0)
      ).toBe(Money.toMinor(projected.tax, policy));
      expect(projected.items[0].item_base_price).toBe(original.items[0].item_base_price);
      for (const tax of bill.taxes)
        expect(Money.toMinor(tax.amount, policy)).toBe(expected.components['tax:' + tax.label]);
    }
  }
);
test('another transfer keeps the previous allocated pennies instead of repricing reduced quantities', () => {
  const original = sale(),
    branch = { currencyCode: 'INR', indian_gst: 'enable' };
  const first = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
  const second = project(
    { ...original, ...first.source },
    branch,
    [{ id: 'c0i0', quantity: 1 }],
    at
  );
  expect(second.preview.totalMinor).toBe(first.preview.source.totalMinor);
  for (const [key, minor] of Object.entries(first.preview.source.components))
    expect(
      (second.preview.source.components[key] || 0) +
        (second.preview.destination.components[key] || 0)
    ).toBe(minor);
});
test('stale quantity or amount cannot silently reuse a transferred bill allocation', () => {
  const original = sale(),
    branch = { currencyCode: 'INR' };
  const result = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
  const changed = { ...original, ...structuredClone(result.destination) };
  changed.items[0].item_quantity = 2;
  expect(() => buildBillPayload(changed, branch)).toThrow('bill changed');
  expect(() =>
    snapshotFrom([{ ...original, ...result.destination, sales_total: 100 }], branch, '1')
  ).toThrow('bill changed');
  expect(() =>
    buildBillPayload({ ...original, ...result.destination }, { currencyCode: 'KWD' })
  ).toThrow('bill changed');
});

test('per-line allocations and tax labels remain exact across multiple preparations', () => {
  const original = sale(),
    branch = { currencyCode: 'INR', indian_gst: 'enable' };
  original.items.push({
    ...original.items[0],
    line_id: 'plain',
    item_name: 'Plain corn',
    item_quantity: 2,
    item_base_price: 9.995,
    item_tax: 3.6,
  });
  original.changes.push({ timestamp: at, items: [{ ...original.items[1], process: 'add' }] });
  original.sales_sub_total = 120;
  original.tax = 8.61;
  original.sales_total = 125.44;
  const result = project(
    original,
    branch,
    [
      { id: 'c0i0', quantity: 1 },
      { id: 'c1i0', quantity: 1 },
    ],
    at
  );
  for (const side of ['source', 'destination']) {
    const projected = { ...original, ...result[side] },
      snapshot = snapshotFrom([projected], branch, '1');
    expect(snapshot.lines.map((line) => line.components)).toEqual(
      result.preview[side].lines.map((line) => line.components)
    );
    const printed = buildBillPayload(projected, branch);
    expect(printed.items.map((line) => Money.toMinor(line.amount, Money.policy(branch)))).toEqual(
      result.preview[side].lines.map(
        (line) => line.components.find((component) => component.key === 'base').minor
      )
    );
  }
  const corrupted = { ...original, ...structuredClone(result.destination) };
  corrupted.captain_transfer_allocation.lines[0].name = 'Changed allocation';
  expect(() => buildBillPayload(corrupted, branch)).toThrow('bill changed');
});

test('projected per-item tax aliases and components agree with each allocated bill', () => {
  const original = sale(),
    branch = { currencyCode: 'INR', indian_gst: 'enable' },
    policy = Money.policy(branch);
  original.items[0].tax_amount = original.items[0].item_tax;
  original.items[0].tax_components = [
    { name: 'CGST', amount: 2.505 },
    { name: 'SGST', amount: 2.505 },
  ];
  const result = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
  for (const side of ['source', 'destination']) {
    const item = result[side].items[0];
    expect(item.tax_amount).toBe(item.item_tax);
    expect(
      item.tax_components.reduce((sum, row) => sum + Money.toMinor(row.amount, policy), 0)
    ).toBe(Money.toMinor(item.item_tax, policy));
  }
  expect(
    Money.toMinor(result.source.tax, policy) + Money.toMinor(result.destination.tax, policy)
  ).toBe(501);
});

test('seat and language updates refresh guest bills without changing allocated money', () => {
  const original = sale(),
    branch = { currencyCode: 'INR' };
  Object.assign(original.items[0], {
    seat: 1,
    default_language: 'en',
    translations: [{ locale: 'ta', name: 'Original translation' }],
  });
  const result = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
  const changed = { ...original, ...structuredClone(result.source) };
  Object.assign(changed.items[0], {
    seat: 2,
    translations: [{ locale: 'ta', name: 'Updated translation' }],
  });
  const snapshot = snapshotFrom([changed], branch, '1');
  expect(snapshot.lines[0].seat).toBe(2);
  expect(snapshot.lines[0].translations).toEqual([{ locale: 'ta', name: 'Updated translation' }]);
  expect(snapshot.lines[0].components).toEqual(result.preview.source.lines[0].components);
  expect(snapshot.totalMinor).toBe(result.preview.source.totalMinor);
  const next = project(changed, branch, [{ id: 'c0i0', quantity: 1 }], at);
  expect(next.preview.destination.lines[0].seat).toBe(2);
  delete changed.items[0].seat;
  delete changed.items[0].default_language;
  delete changed.items[0].translations;
  const cleared = snapshotFrom([changed], branch, '1');
  expect(cleared.lines[0].seat).toBe(0);
  expect(cleared.lines[0]).not.toHaveProperty('translations');
  expect(cleared.lines[0]).not.toHaveProperty('default_language');
  expect(cleared.totalMinor).toBe(snapshot.totalMinor);
});

test.each(['JPY', 'INR', 'KWD'])(
  'desktop amount aliases reflect the allocated quantity in %s',
  (currencyCode) => {
    const original = sale(),
      branch = { currencyCode, indian_gst: 'enable' },
      policy = Money.policy(branch);
    Object.assign(original, {
      subtotal: original.sales_sub_total,
      total: original.sales_total,
      sales_tax: original.tax,
      sales_round_off: 0,
      items_subtotal: 100.01,
      items_total: 101.85,
    });
    Object.assign(original.items[0], {
      item_total: 101.85,
      total: 101.85,
      total_amount: 101.85,
      item_discount: 3.17,
      cgst_tax: 2.505,
      sgst_tax: 2.505,
      igst_tax: 0,
      tax: 5,
    });
    const result = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
    for (const side of ['source', 'destination']) {
      const view = result[side],
        item = view.items[0],
        expected = result.preview[side];
      const lineMinor = expected.totalMinor - (expected.components.adjustment || 0);
      for (const field of ['item_total', 'total', 'total_amount'])
        expect(Money.toMinor(item[field], policy)).toBe(lineMinor);
      expect(Money.toMinor(item.item_discount, policy)).toBe(-expected.components.discount);
      expect(Money.toMinor(item.cgst_tax, policy) + Money.toMinor(item.sgst_tax, policy)).toBe(
        Money.toMinor(item.item_tax, policy)
      );
      expect(item.igst_tax).toBe(0);
      expect(item.tax).toBe(5); // Stored percentage remains a rate.
      expect(view.sales_tax).toBe(view.tax);
      expect(view.sales_round_off).toBe(view.round_off);
      expect(view.items_subtotal).toBe(view.sales_sub_total);
      expect(view.subtotal).toBe(view.sales_sub_total);
      expect(view.total).toBe(view.sales_total);
      expect(Money.toMinor(view.items_total, policy) + Money.toMinor(view.round_off, policy)).toBe(
        expected.totalMinor
      );
      expect(item.item_base_price).toBe(original.items[0].item_base_price);
    }
  }
);

test.each([true, false])(
  'database item identities survive transfer and another transfer (explicit line: %s)',
  (explicit) => {
    const original = sale(),
      branch = { currencyCode: 'INR' },
      productId = new ObjectId();
    original._id = new ObjectId();
    original.items[0].item_id = productId;
    original.changes[0].items[0].item_id = productId;
    original.changes[0].timestamp = new Date(at);
    if (!explicit) {
      delete original.items[0].line_id;
      delete original.changes[0].items[0].line_id;
    }
    const result = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
    for (const side of ['source', 'destination']) {
      const item = result[side].items[0];
      expect(item.item_id).toBeInstanceOf(ObjectId);
      expect(item.item_id.equals(productId)).toBe(true);
      for (const change of result[side].changes)
        expect(change.items[0].item_id.equals(productId)).toBe(true);
      expect(snapshotFrom([{ ...original, ...result[side] }], branch, '1').totalMinor).toBe(
        result.preview[side].totalMinor
      );
      const persisted = BSON.deserialize(BSON.serialize({ ...original, ...result[side] }));
      expect(snapshotFrom([persisted], branch, '1').totalMinor).toBe(
        result.preview[side].totalMinor
      );
    }
    expect(result.source.changes[0].timestamp).toBeInstanceOf(Date);
    const next = project(
      { ...original, ...result.source },
      branch,
      [{ id: 'c0i0', quantity: 1 }],
      at
    );
    expect(next.destination.items[0].item_id.equals(productId)).toBe(true);
    expect(original.items[0].item_quantity).toBe(3);
  }
);

test('substituting a product under the same preparation ID invalidates its financial allocation', () => {
  const original = sale(),
    branch = { currencyCode: 'INR' };
  const result = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
  const changed = { ...original, ...result.destination };
  changed.items[0].item_id = 'another-product';
  expect(() => buildBillPayload(changed, branch)).toThrow('bill changed');
  expect(() => snapshotFrom([changed], branch, '1')).toThrow('bill changed');
});

test.each([
  'qty',
  'unit_price',
  'item_price',
  'item_total',
  'total',
  'total_amount',
  'item_discount',
  'tax_amount',
  'tax',
  'tax_type',
  'cgst_tax',
  'sgst_tax',
  'igst_tax',
  'tax_components',
])('changing desktop item field %s cannot silently reuse allocated amounts', (field) => {
  const original = sale(),
    branch = { currencyCode: 'INR', indian_gst: 'enable' };
  const result = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
  const changed = { ...original, ...result.destination };
  changed.items[0][field] =
    field === 'tax_components'
      ? [{ name: 'Tax', amount: 999 }]
      : field === 'tax_type'
        ? 'changed'
        : 999;
  expect(() => buildBillPayload(changed, branch)).toThrow('bill changed');
  expect(() => snapshotFrom([changed], branch, '1')).toThrow('bill changed');
});

test.each([
  'subtotal',
  'total',
  'items_subtotal',
  'items_total',
  'sales_tax',
  'sales_round_off',
  'extra_discount',
  'sale_extra_discount',
  'extra_discount_type',
])('changing desktop bill field %s invalidates allocated amounts', (field) => {
  const original = sale(),
    branch = { currencyCode: 'INR' };
  const result = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
  expect(() =>
    buildBillPayload({ ...original, ...result.destination, [field]: 999 }, branch)
  ).toThrow('bill changed');
});

test.each(['JPY', 'INR', 'KWD'])(
  'quantity reductions retain exact allocated components in %s',
  (currencyCode) => {
    const original = sale(),
      branch = { currencyCode },
      split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
    const transferred = { ...original, ...split.source };
    const proposed = {
      items: transferred.items.map((item) => ({
        ...item,
        item_quantity: 1,
        item_tax: 999,
        item_base_price: 999,
        total_amount: 999,
        item_description: 'Less salt',
      })),
      sales_total: 999,
    };
    const result = transferEdit.reduce(transferred, proposed, branch);
    const expected = project(transferred, branch, [{ id: 'c0i0', quantity: 1 }], at).preview.source;
    const snapshot = snapshotFrom([{ ...transferred, ...result }], branch, '1');
    expect(snapshot.totalMinor).toBe(expected.totalMinor);
    expect(snapshot.lines[0].components).toEqual(expected.lines[0].components);
    expect(result.items[0].item_base_price).toBe(transferred.items[0].item_base_price);
    expect(result.items[0].item_description).toBe('Less salt');
    expect(transferred.items[0].item_quantity).toBe(2);
    const persisted = BSON.deserialize(BSON.serialize({ ...transferred, ...result }));
    expect(snapshotFrom([persisted], branch, '1').totalMinor).toBe(expected.totalMinor);
  }
);

test('removing all transferred lines clears all allocated monetary components', () => {
  const original = sale(),
    branch = { currencyCode: 'INR' },
    split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
  const transferred = { ...original, ...split.source };
  const result = transferEdit.reduce(transferred, { items: [] }, branch);
  expect(result.sales_total).toBe(0);
  expect(result.tax).toBe(0);
  expect(result.captain_transfer_allocation.lines).toEqual([]);
  expect(result.captain_transfer_allocation.components).toEqual({});
});

test.each(['increase', 'product', 'duplicate', 'discount'])(
  'reduction reconciliation rejects %s',
  (kind) => {
    const original = sale(),
      branch = { currencyCode: 'INR' },
      split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
    const transferred = { ...original, ...split.source },
      proposed = { items: structuredClone(transferred.items) };
    if (kind === 'increase') proposed.items[0].item_quantity = 3;
    if (kind === 'product') proposed.items[0].item_id = 'other';
    if (kind === 'duplicate') proposed.items.push({ ...proposed.items[0] });
    if (kind === 'discount') proposed.extra_discount = 10;
    expect(transferEdit.reduce(transferred, proposed, branch)).toBeNull();
  }
);

test.each(['JPY', 'INR', 'KWD'])(
  'adding a new preparation preserves old allocated pennies in %s',
  (currencyCode) => {
    const original = sale(),
      branch = { currencyCode },
      split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
    const transferred = { ...original, ...split.destination };
    const fresh = {
      item_id: 'soup',
      line_id: 'new-soup',
      item_name: 'Soup',
      item_quantity: 2,
      item_price: 10,
      item_tax: 1,
      item_discount: 0,
      total_amount: 21,
      tax_type: 'exclusive',
      tax: 5,
    };
    const result = transferEdit.additions(
      transferred,
      { items: [fresh, { ...transferred.items[0], item_tax: 999, item_base_price: 999 }] },
      branch
    );
    const saved = result.captain_transfer_allocation;
    expect(saved.lines[1].components).toEqual(
      transferred.captain_transfer_allocation.lines[0].components.map((row) => ({
        ...row,
        minor: row.minor || 0,
      }))
    );
    expect(result.items[1].item_base_price).toBe(transferred.items[0].item_base_price);
    expect(saved.totalMinor).toBe(
      transferred.captain_transfer_allocation.totalMinor + Money.toMinor(21, Money.policy(branch))
    );
    expect(snapshotFrom([{ ...transferred, ...result }], branch, '1').lines[0].name).toBe('Soup');
    expect(result.items[0].item_quantity).toBe(2);
  }
);

test('inclusive tax on a new preparation is not hidden as a negative round-off', () => {
  const original = sale(),
    branch = { currencyCode: 'INR' },
    split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
  const transferred = { ...original, ...split.destination };
  const result = transferEdit.additions(
    transferred,
    {
      items: [
        ...transferred.items,
        {
          item_id: 'soup',
          item_name: 'Soup',
          item_quantity: 1,
          item_price: 105,
          item_tax: 5,
          item_discount: 0,
          total_amount: 105,
          tax_type: 'inclusive',
        },
      ],
    },
    branch
  );
  const parts = Object.fromEntries(
    result.captain_transfer_allocation.lines[1].components.map((row) => [row.key, row.minor])
  );
  expect(parts).toEqual({ base: 10000, discount: 0, 'tax:Tax': 500, adjustment: 0 });
});

test.each(['inclusive', 'exclusive'])(
  'new discounted %s dish keeps the actual GST rate labels',
  (tax_type) => {
    const original = sale(),
      branch = { currencyCode: 'INR', indian_gst: 'enable' },
      split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
    const transferred = { ...original, ...split.destination };
    const fresh = {
      item_id: 'soup',
      item_name: 'Soup',
      item_quantity: 1,
      item_price: tax_type === 'inclusive' ? 105 : 100,
      item_discount: tax_type === 'inclusive' ? 10.5 : 10,
      item_tax: 4.5,
      total_amount: 94.5,
      tax_type,
      tax: 5,
    };
    const result = transferEdit.additions(
      transferred,
      { items: [...transferred.items, fresh] },
      branch
    );
    const parts = Object.fromEntries(
      result.captain_transfer_allocation.lines[1].components.map((row) => [row.key, row.minor])
    );
    expect(parts['tax:CGST 2.5%']).toBe(225);
    expect(parts['tax:SGST 2.5%']).toBe(225);
    expect(parts.adjustment).toBe(0);
    expect(result.items[1].item_price).toBe(fresh.item_price);
  }
);

test.each(['JPY', 'INR', 'KWD'])(
  'quantity increase adds only extra portions to allocated amounts in %s',
  (currencyCode) => {
    const original = sale(),
      branch = { currencyCode },
      split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
    const transferred = { ...original, ...split.destination },
      old = transferred.items[0];
    const proposed = {
      items: [
        {
          ...old,
          item_quantity: 2,
          item_price: old.item_base_price,
          tax: 5,
          tax_type: 'exclusive',
          item_discount: 0,
          item_tax: 4,
          total_amount: 70.67,
        },
      ],
    };
    const result = transferEdit.increases(transferred, proposed, branch),
      policy = Money.policy(branch);
    expect(result.items[0].item_quantity).toBe(2);
    expect(result.captain_transfer_allocation.totalMinor).toBe(
      transferred.captain_transfer_allocation.totalMinor + Money.toMinor(35.335, policy)
    );
    expect(snapshotFrom([{ ...transferred, ...result }], branch, '1').totalMinor).toBe(
      result.captain_transfer_allocation.totalMinor
    );
    expect(transferred.items[0].item_quantity).toBe(1);
  }
);

test('quantity increase rejects changing the price of already allocated portions', () => {
  const original = sale(),
    branch = { currencyCode: 'INR' },
    split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
  const transferred = { ...original, ...split.destination };
  expect(
    transferEdit.increases(
      transferred,
      { items: [{ ...transferred.items[0], item_quantity: 2, item_price: 999 }] },
      branch
    )
  ).toBeNull();
});

test('combined additions, reductions and increases keep each preparation allocation attached to its identity', () => {
  const original = sale(),
    branch = { currencyCode: 'INR' },
    split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
  const transferred = { ...original, ...split.destination };
  const soup = {
    item_id: 'soup',
    line_id: 'soup',
    item_name: 'Soup',
    item_quantity: 2,
    item_price: 10,
    item_tax: 1,
    item_discount: 0,
    total_amount: 21,
    tax_type: 'exclusive',
    tax: 5,
  };
  const withSoup = {
    ...transferred,
    ...transferEdit.additions(transferred, { items: [...transferred.items, soup] }, branch),
  };
  const proposed = {
    items: [
      {
        item_id: 'tea',
        item_name: 'Tea',
        item_quantity: 1,
        item_price: 5,
        item_tax: 0,
        item_discount: 0,
        total_amount: 5,
      },
      { ...withSoup.items[1], item_quantity: 1 },
      {
        ...withSoup.items[0],
        item_quantity: 2,
        item_price: withSoup.items[0].item_base_price,
        item_tax: 4,
        item_discount: 0,
        total_amount: 70.67,
      },
    ],
  };
  const result = transferEdit.increases(withSoup, proposed, branch);
  const amounts = Object.fromEntries(
    result.captain_transfer_allocation.lines.map((line) => [line.lineKey, line.amountMinor])
  );
  expect(amounts.tea).toBe(500);
  expect(amounts.soup).toBe(1050);
  expect(amounts.salt).toBe(transferred.captain_transfer_allocation.totalMinor + 3534);
  expect(result.items.map((item) => item.item_id)).toEqual(['tea', 'soup', 'corn']);
  expect(snapshotFrom([{ ...withSoup, ...result }], branch, '1').totalMinor).toBe(
    Object.values(amounts).reduce((sum, n) => sum + n, 0)
  );
});

test('tracked bill discount follows transferred portions and clearing cannot restore it twice', () => {
  const original = sale(),
    branch = { currencyCode: 'INR' };
  const split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
  const base = { ...original, ...split.source };
  const discounts = require('../../../src/services/captain-transfer-discount');
  const { applyMoney } = require('../../../src/services/captain-transfer-projection');
  const discounted = applyMoney(
    base,
    structuredClone(split.source),
    branch,
    discounts.plan(base.captain_transfer_allocation, 11)
  );
  const next = project({ ...base, ...discounted }, branch, [{ id: 'c0i0', quantity: 1 }], at);
  const left = next.source.captain_transfer_allocation,
    right = next.destination.captain_transfer_allocation;
  expect(left.lines[0].billDiscountMinor).toBe(6);
  expect(right.lines[0].billDiscountMinor).toBe(5);
  expect(discounts.plan(left, 0).totalMinor + discounts.plan(right, 0).totalMinor).toBe(
    base.captain_transfer_allocation.totalMinor
  );
});

test('reducing discounted portions reduces only their tracked bill discount', () => {
  const original = sale(),
    branch = { currencyCode: 'INR' },
    split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
  const base = { ...original, ...split.source };
  const discounts = require('../../../src/services/captain-transfer-discount');
  const { applyMoney } = require('../../../src/services/captain-transfer-projection');
  const discounted = applyMoney(
    base,
    structuredClone(split.source),
    branch,
    discounts.plan(base.captain_transfer_allocation, 11)
  );
  const current = { ...base, ...discounted };
  const reduced = transferEdit.reduce(
    current,
    { items: current.items.map((line) => ({ ...line, item_quantity: 1 })) },
    branch
  );
  expect(reduced.captain_transfer_allocation.lines[0].billDiscountMinor).toBe(6);
  expect(discounts.plan(reduced.captain_transfer_allocation, 0).totalMinor).toBe(
    reduced.captain_transfer_allocation.totalMinor + 6
  );
});

test.each([-1, 0.5, 999999])(
  'allocation sealing rejects an invalid tracked discount %s',
  (minor) => {
    const original = sale(),
      branch = { currencyCode: 'INR' },
      split = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
    const side = structuredClone(split.preview.source);
    side.lines[0].billDiscountMinor = minor;
    expect(() =>
      require('../../../src/utils/transfer-allocation').seal(
        { ...original, ...split.source },
        branch,
        side
      )
    ).toThrow('bill changed');
  }
);

test.each(['separate', 'combined'])(
  'transfer normalizes %s legacy bill discounts without inventing round-off',
  (storage) => {
    const original = sale(),
      branch = { currencyCode: 'INR' };
    Object.assign(original, {
      sales_sub_total: 100,
      discount: storage === 'separate' ? 0 : 10,
      tax: 5,
      sales_total: 95,
      extra_discount: 10,
      sale_extra_discount: 10,
      extra_discount_type: 'amount',
    });
    Object.assign(original.items[0], {
      item_quantity: 2,
      item_base_price: 50,
      item_tax: 5,
      item_discount: 0,
    });
    original.changes[0].items[0].item_quantity = 2;
    const result = project(original, branch, [{ id: 'c0i0', quantity: 1 }], at);
    for (const name of ['source', 'destination']) {
      const view = result[name];
      expect(view.sales_total).toBe(47.5);
      expect(view.discount).toBe(5);
      expect(view.round_off).toBe(0);
      expect(view.extra_discount).toBe(0);
      expect(view.sale_extra_discount).toBe(0);
      expect(view.captain_transfer_allocation.lines[0].billDiscountMinor).toBe(500);
    }
    expect(original.sale_extra_discount).toBe(10);
  }
);
