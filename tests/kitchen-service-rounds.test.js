const test = require('node:test');
const assert = require('node:assert/strict');
const { rounds, tickets } = require('../api/src/helpers/kitchen-rounds');
const line = (qty, process = 'add') => ({
  item_id: 'rice',
  item_name: 'Rice',
  item_quantity: qty,
  process,
});
const sale = () => ({
  _id: 's1',
  table_number: '6',
  created_date: '2026-09-27T08:00:00Z',
  items: [line(3)],
  changes: [
    { timestamp: '2026-09-27T08:00:00Z', items: [line(2)] },
    { timestamp: '2026-09-27T08:25:00Z', items: [line(1)] },
  ],
});
test('later additions retain their own kitchen clock and service identity', () => {
  const order = sale();
  order.kitchen_service = { c0i0: { quantity: 2, at: '2026-09-27T08:20:00Z' } };
  assert.equal(rounds(order).length, 2);
  assert.equal(tickets(order).length, 1);
  assert.equal(tickets(order)[0].placedAt, '2026-09-27T08:25:00.000Z');
  assert.equal(tickets(order)[0].items[0].qty, 1);
});
test('partial service removes only that quantity; fully served clears display', () => {
  const order = sale();
  order.kitchen_service = { c0i0: { quantity: 1 } };
  assert.equal(tickets(order)[0].items[0].qty, 1);
  order.kitchen_service = { c0i0: { quantity: 2 }, c1i0: { quantity: 1 } };
  assert.deepEqual(tickets(order), []);
});
test('bill request clears existing rounds but later additions return', () => {
  const order = sale();
  order.bill_requested_at = '2026-09-27T08:20:00Z';
  assert.equal(tickets(order).length, 1);
  order.bill_requested_at = '2026-09-27T08:30:00Z';
  assert.deepEqual(tickets(order), []);
});
test('cancelled additions are not displayed and legacy tickets still appear', () => {
  const order = sale();
  order.items = [line(2)];
  order.changes.push({ timestamp: '2026-09-27T08:30:00Z', items: [line(1, 'cancel')] });
  assert.equal(tickets(order).length, 1);
  assert.equal(tickets(order)[0].items[0].qty, 2);
  order.changes = [];
  assert.equal(tickets(order)[0].items[0].qty, 2);
});
test('missing timestamps never become epoch service dates', () => {
  assert.equal(rounds(sale())[0].items[0].served_at, null);
});
const vm = require('node:vm');
const fs = require('node:fs');
test('every dish on long kitchen tickets rotates into view, including a busy kitchen', () => {
  const source = fs
    .readFileSync('src/kitchen-screen.html', 'utf8')
    .split('<script>')[1]
    .split('</script>')[0];
  const nodes = {},
    timers = [];
  const node = () => ({
    children: [],
    style: { setProperty() {}, removeProperty() {} },
    setAttribute() {},
    appendChild(child) {
      this.children.push(child);
    },
    set textContent(value) {
      this.text = value;
      this.children = [];
    },
    get textContent() {
      return this.text;
    },
  });
  const document = {
    createElement: node,
    createElementNS: node,
    createTextNode: (text) => {
      const n = node();
      n.textContent = text;
      return n;
    },
    documentElement: node(),
    getElementById: (id) => nodes[id] || (nodes[id] = node()),
  };
  const context = {
    document,
    window: { addEventListener() {} },
    location: { search: '' },
    URLSearchParams,
    Date,
    setInterval: (fn) => timers.push(fn),
  };
  vm.runInNewContext(source, context);
  context.window.kitchenScreen.setConfig({
    _fit: { cards: 1, columns: 1 },
    maxItemsPerCard: 3,
    compactAfter: 1,
  });
  context.window.kitchenScreen.setTickets([
    {
      table: '6',
      placedAt: new Date().toISOString(),
      items: Array.from({ length: 10 }, (_, i) => ({ qty: 1, name: `Dish ${i}` })),
    },
  ]);
  const seen = new Set();
  const collect = (n) => {
    if (n.className === 'name') seen.add(n.textContent);
    n.children.forEach(collect);
  };
  for (let i = 0; i < 4; i++) {
    collect(nodes.board);
    timers.forEach((fn) => fn());
  }
  assert.equal(seen.size, 10);
  assert.equal(nodes.count.textContent, 1);
});

test('tracked kitchen work stays visible after bill printing until physically served', () => {
  const { tickets } = require('../api/src/helpers/kitchen-rounds');
  const sale = {
    _id: 'paid-order',
    kitchen_required: true,
    payment_status: 'Paid',
    created_date: new Date('2026-09-28T10:00:00Z'),
    bill_requested_at: new Date('2026-09-28T10:02:00Z'),
    items: [{ item_id: 'rice', item_name: 'Rice', item_quantity: 2 }],
    changes: [
      {
        timestamp: new Date('2026-09-28T10:00:00Z'),
        items: [{ item_id: 'rice', item_name: 'Rice', item_quantity: 2, process: 'add' }],
      },
    ],
  };
  assert.equal(tickets(sale).length, 1);
  sale.kitchen_service = { c0i0: { quantity: 2 } };
  assert.equal(tickets(sale).length, 0);
});
