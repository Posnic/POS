const { readWaybill } = require('../../../src/services/extension-hktv-waybill');
function setup() {
  const order = {
    key: 'a'.repeat(64),
    orderId: 'H123-STORE',
    trackingId: '00123',
    status: 'CONFIRMED',
    commercialHash: 'hash',
  };
  const state = { state: { storeCode: 'STORE', orders: [order] }, busy: false };
  const reader = {
    storeCode: 'STORE',
    printWaybills: jest
      .fn()
      .mockResolvedValue({ code: 'success', data: '<html><body>Original</body></html>' }),
  };
  return {
    order,
    state,
    reader,
    args: {
      db: {},
      scope: {},
      descriptor: { id: 'posnic.hktvmall-gogox' },
      actor: { permissions: ['read'] },
      input: { orderKey: order.key, paperSize: 'A5' },
      readState: jest.fn().mockResolvedValue(state),
      getProvider: jest.fn().mockResolvedValue(reader),
    },
  };
}
test('original document is retrieved only for a current authorized order', async () => {
  const x = setup();
  const r = await readWaybill(x.args);
  expect(r.trackingId).toBe('00123');
  expect(r.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(x.reader.printWaybills).toHaveBeenCalledWith([x.order], 'A5');
});
test('different extension, missing permission, unknown key and cross-store connection fail closed', async () => {
  for (const mutate of [
    (x) => (x.args.descriptor.id = 'other.extension'),
    (x) => (x.args.actor.permissions = []),
    (x) => (x.args.input.orderKey = 'b'.repeat(64)),
    (x) => (x.reader.storeCode = 'OTHER'),
  ]) {
    const x = setup();
    mutate(x);
    await expect(readWaybill(x.args)).rejects.toThrow();
    expect(x.reader.printWaybills).not.toHaveBeenCalled();
  }
});
test('changed tracking reference during retrieval refuses a stale label', async () => {
  const x = setup();
  x.args.readState.mockResolvedValueOnce(x.state).mockResolvedValueOnce({
    state: { ...x.state.state, orders: [{ ...x.order, trackingId: '999' }] },
    busy: false,
  });
  await expect(readWaybill(x.args)).rejects.toThrow('changed_refresh_required');
});
test('cancelled orders and oversized provider HTML are not returned', async () => {
  const x = setup();
  x.order.status = 'CANCELLED';
  await expect(readWaybill(x.args)).rejects.toThrow();
  x.order.status = 'CONFIRMED';
  x.reader.printWaybills.mockResolvedValue({
    code: 'success',
    data: '<html>' + '.'.repeat(2 * 1024 * 1024),
  });
  await expect(readWaybill(x.args)).rejects.toThrow('response_invalid');
});

test('records waybill rejects a revision change during retrieval', async () => {
  const x = setup();
  x.state.state.orderStorage = 'records-v1';
  x.state.state.orders = [];
  const read = jest
    .fn()
    .mockResolvedValueOnce({ data: x.order, revision: 7 })
    .mockResolvedValueOnce({ data: x.order, revision: 8 });
  x.args.getStore = jest.fn().mockResolvedValue({ read });
  await expect(readWaybill(x.args)).rejects.toThrow('changed_refresh_required');
  expect(read).toHaveBeenCalledWith(x.order.key);
  expect(x.args.getStore).toHaveBeenCalledWith({
    db: x.args.db,
    scope: x.args.scope,
    storeCode: 'STORE',
  });
});
test('provider proposal arriving during label generation invalidates old label', async () => {
  const x = setup();
  x.args.readState.mockResolvedValueOnce(x.state).mockResolvedValueOnce({
    state: {
      ...x.state.state,
      orders: [{ ...x.order, proposed: { trackingId: 'replacement' } }],
    },
  });
  await expect(readWaybill(x.args)).rejects.toThrow('changed_refresh_required');
});
