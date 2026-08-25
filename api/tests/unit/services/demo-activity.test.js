'use strict';

/*
 * The demo history has to read like a real week of trading.
 *
 * Owner, looking at his own demo shop: "demo history date should be last one
 * week. same day should be atleast 3 records. id also not generated
 * properly. similar tor purchase entries. proper entries." Each sentence was
 * a defect on his screen: sales stretched thin over a fortnight, one row per
 * day like a dying shop, a BLANK id column beside real sales showing
 * S-<token>-000001, and no purchases at all - a Purchase History that opens
 * empty says the product does not do purchasing.
 */
const demoSeed = require('../../../src/services/demo-seed');

const branch = { branch_id: 'B1', branch_name: 'Shop', license: 'L1' };
const items = [
  { _id: 'i1', name: 'Espresso', selling_price: 2.5, unit: 'cup' },
  { _id: 'i2', name: 'Latte', selling_price: 3.5, unit: 'cup' },
  { _id: 'i3', name: 'Bun', selling_price: 1.5, unit: 'qty' },
];
const customers = [
  { _id: 'c1', name: 'Meera' },
  { _id: 'c2', name: 'Anand' },
];
const suppliers = [
  { _id: 's1', name: 'Balaji Distributors', phone: '9445022334' },
  { _id: 's2', name: 'Metro Supply Co', phone: '9445044556' },
];
const now = new Date('2026-08-24T12:00:00Z');

/* Calendar days, not 24h buckets: a sale stamped "yesterday" whose shop-hours
   time lands at 18:00 is still yesterday, even when fewer than 24 hours ago. */
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const startOfToday = new Date(now);
startOfToday.setUTCHours(0, 0, 0, 0);
const calDaysAgo = (d) => Math.round((startOfToday - new Date(dayKey(d) + 'T00:00:00Z')) / 864e5);

describe('demo sales look like last week, not last fortnight', () => {
  const sales = demoSeed.buildSales({ items, customers, branch, pack: 'cafe', now });

  test('sales cover today through the past week - TODAY included', () => {
    /*
     * The owner's revision: "there is no sale added same day of created...
     * i dont see any count in dashboard." The dashboard's big number is
     * today's takings, and a zero there on first login reads as a dead
     * shop. So a couple of sales land today - stamped HOURS before now,
     * never at clock-hours, so they are today in any timezone the shop
     * resolves - and the rest cluster over the past week.
     */
    let today = 0;
    for (const s of sales) {
      const d = calDaysAgo(s.date);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(7);
      expect(new Date(s.date) <= now).toBe(true);
      if (d === 0) today += 1;
    }
    expect(today).toBeGreaterThanOrEqual(1);
    expect(demoSeed.SALES_PER_DAY[0]).toBeGreaterThanOrEqual(2);
  });

  test('at least one day carries three or more sales', () => {
    /* A flat one-a-day spread reads as a dying shop; real days cluster. */
    const byDay = {};
    for (const s of sales) {
      const k = dayKey(s.date);
      byDay[k] = (byDay[k] || 0) + 1;
    }
    expect(Math.max(...Object.values(byDay))).toBeGreaterThanOrEqual(3);
    // and the plan itself says so, so a re-tuned distribution keeps the rule
    expect(Math.max(...demoSeed.SALES_PER_DAY)).toBeGreaterThanOrEqual(3);
    expect(demoSeed.SALES_PER_DAY.length).toBe(7);
    expect(demoSeed.SALES_PER_DAY.reduce((a, b) => a + b, 0)).toBe(demoSeed.SALE_COUNT);
  });

  test('every sale carries a unique DEMO-tokenised id', () => {
    /*
     * The history column showed BLANK beside real sales' S-<token>-000001.
     * DEMO as the token says what the row is, and can never collide with a
     * live id, whose token is the shop's own and never the word DEMO.
     */
    const ids = sales.map((s) => s.sales_id);
    for (const id of ids) expect(id).toMatch(/^S-DEMO-\d{6}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('demo purchases are proper entries', () => {
  const purchases = demoSeed.buildPurchases({ items, suppliers, branch, pack: 'cafe', now });

  test('they exist, dated inside the same week, never today', () => {
    expect(purchases.length).toBe(demoSeed.PURCHASE_COUNT);
    for (const p of purchases) {
      const d = calDaysAgo(p.date);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(7);
    }
  });

  test('each carries a unique R-DEMO id and a real supplier', () => {
    const ids = purchases.map((p) => p.receiving_id);
    for (const id of ids) expect(id).toMatch(/^R-DEMO-\d{6}$/);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of purchases) {
      expect(suppliers.map((s) => s.name)).toContain(p.supplier_name);
      expect(p.supplier_id).toBeTruthy();
    }
  });

  test('bought below retail, so the margin reports are not zero', () => {
    for (const p of purchases) {
      for (const line of p.items) {
        const item = items.find((i) => String(i._id) === line.item_id);
        expect(line.unit_price).toBeLessThan(item.selling_price);
        expect(line.unit_price).toBeGreaterThan(0);
      }
      expect(p.total_amount).toBeCloseTo(
        p.items.reduce((a, l) => a + l.total, 0),
        2
      );
    }
  });

  test('every row is demo-tagged, or the purge cannot find it', () => {
    for (const p of purchases) {
      expect(p.demo_pack).toBe('cafe');
      expect(p.demo_seeded_at).toBe(now);
    }
  });

  test('the rows speak the LIST’S vocabulary - Received, a phone, an empty return', () => {
    /*
     * The owner's screenshot: every demo purchase wearing a PartialReturn
     * badge over a phone column reading "undefined". The seed had invented
     * receiving_status 'completed' (the renderer knows Open / Received /
     * Cancelled; anything else fell through its else into PartialReturn),
     * omitted supplier_phone (rendered raw), and omitted items_return
     * (whose SHAPE derives the return states).
     */
    for (const p of purchases) {
      expect(p.receiving_status).toBe('Received');
      expect(p.supplier_phone).toBeTruthy();
      expect(Array.isArray(p.items_return)).toBe(true);
      expect(p.items_return).toHaveLength(0);
    }
  });

  test('no suppliers means no purchases, never a throw', () => {
    expect(demoSeed.buildPurchases({ items, suppliers: [], branch, pack: 'cafe', now })).toEqual(
      []
    );
    expect(demoSeed.buildPurchases({ items: [], suppliers, branch, pack: 'cafe', now })).toEqual(
      []
    );
  });
});

describe('the demo endpoints stay wired - the CI check the owner asked for', () => {
  /*
   * "better add these into REST api for demo products fill up. same end
   * points make sure its into CI check." The fill, the removal and the pack
   * list ARE the REST api - this pins the routes and the purge's reach so a
   * refactor cannot quietly orphan one of them.
   */
  const fs = require('fs');
  const path = require('path');
  const routes = fs.readFileSync(
    path.join(__dirname, '../../../src/routes/items.routes.js'),
    'utf8'
  );

  test('fill, remove and pack list are all routed', () => {
    expect(routes).toMatch(/router\.post\('\/demo'/);
    expect(routes).toMatch(/router\.delete\('\/demo'/);
    expect(routes).toMatch(/router\.get\('\/demo\/packs'/);
  });

  test('the purge reaches every collection the seed writes', () => {
    const repo = fs
      .readFileSync(path.join(__dirname, '../../../src/repositories/item.repository.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const purge = repo.slice(repo.indexOf('async purgeDemoData'));
    for (const col of ['sales', 'quotes', 'receivings', 'customers', 'suppliers', 'unit']) {
      expect(purge.includes(`getCollection('${col}')`)).toBe(true);
    }
    /* Reaching receivings is not enough - the purge also READS receivings to
       refuse received items, so a deleted deleteMany still left this test
       green. It must DELETE there. Found surviving mutation. */
    expect(purge).toMatch(/purchasesRemoved = \(await receivingsCol\.deleteMany\(demoScope\)\)/);
    /* Same lesson for units: reading the collection is not removing from it. */
    expect(purge).toMatch(/unitsCol\.deleteOne\(/);
  });

  test('the seed writes the units master, tagged so the purge can find them', () => {
    /* Owner: "different unit products are created. but unit section not
       created. when demo product created handle other master records also
       properly created." The items carried unit STRINGS while unit_id
       pointed everything at the one default Quantity - the Units screen
       never learned the units the catalogue was visibly using. */
    const fsSvc = fs
      .readFileSync(path.join(__dirname, '../../../src/services/install.service.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const seed = fsSvc.slice(
      fsSvc.indexOf('async _insertBusinessTypeDemoData'),
      fsSvc.indexOf('async _insertDemoActivity')
    );
    expect(seed).toMatch(/findUnitsByBranch/);
    expect(seed).toMatch(/insertUnit\(\{\s*demo_pack: packTag/);
    /* and the item rows point at the unit they claim, not the default */
    expect(seed).toMatch(/unit_id:\s*unitMap\[/);
  });

  test('the installer writes every collection the purge expects', () => {
    const svc = fs
      .readFileSync(path.join(__dirname, '../../../src/services/install.service.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const act = svc.slice(svc.indexOf('async _insertDemoActivity'));
    for (const col of ['sales', 'quotes', 'receivings', 'customers', 'suppliers']) {
      expect(act.includes(`collection('${col}')`)).toBe(true);
    }
  });
});
