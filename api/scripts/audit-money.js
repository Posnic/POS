#!/usr/bin/env node
"use strict";
/*
 * Check a shop's money, against the shop's actual data.
 *
 *   node scripts/audit-money.js "mongodb://..." [--since 2026-01-01] [--verbose]
 *
 * Runs the same rules the test suite runs, over every sale in a database. The
 * tests prove the arithmetic was right about the cases somebody thought of;
 * this proves the database is right about the ones nobody did - a sale entered
 * by a cashier in a hurry, an edit made three weeks later, a row written by a
 * version of the code that is no longer installed.
 *
 * Read-only. It opens a connection, reads sales, prints, and exits; there is no
 * code path here that writes anything, deliberately, because the thing you run
 * when you are worried about your data should not be able to change it.
 *
 * Exit code is 0 when the money is sound and 1 when it is not, so it can be run
 * from cron and be noticed.
 */

const { MongoClient } = require("mongodb");
const {
  checkSale, checkPurchase, checkReturns, checkStockChain,
} = require("../src/utils/money-invariants");

function parseArgs(argv) {
  const args = { uri: null, since: null, verbose: false, limit: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--verbose" || a === "-v") args.verbose = true;
    else if (a === "--since") args.since = new Date(argv[++i]);
    else if (a === "--limit") args.limit = Number(argv[++i]) || 0;
    else if (!args.uri) args.uri = a;
  }
  return args;
}

function money(n) {
  const sign = n < 0 ? "-" : "+";
  return sign + Math.abs(n).toFixed(2);
}

(async () => {
  const args = parseArgs(process.argv);
  const uri = args.uri || process.env.MONGODB_URI;
  if (!uri) {
    console.error("Usage: node scripts/audit-money.js <mongodb-uri> [--since DATE] [--verbose]");
    process.exit(2);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db();

  const query = args.since ? { updated_date: { $gte: args.since } } : {};
  const cursor = db.collection("sales").find(query, { sort: { updated_date: 1 } });
  if (args.limit) cursor.limit(args.limit);

  let sales = 0;
  let lines = 0;
  let purchases = 0;
  let returns = 0;
  let stockItems = 0;
  let movements = 0;
  const problems = [];
  /* What the discrepancies come to, which is the number somebody will ask for. */
  const exposure = new Map();
  const tally = (p) => exposure.set(p.rule, (exposure.get(p.rule) || 0) + Math.abs(p.difference || 0));

  for await (const sale of cursor) {
    sales++;
    lines += (sale.items || []).length;
    for (const p of checkSale(sale)) { problems.push(p); tally(p); }
    for (const p of checkReturns(sale, { kind: "sale" })) { problems.push(p); tally(p); returns++; }
  }


  // Sale returns ride on the sale document, so they are checked from the same
  // cursor pass above; purchases and stock are their own collections.

  for await (const receiving of db.collection("receivings").find(query)) {
    purchases++;
    for (const p of checkPurchase(receiving)) { problems.push(p); tally(p); }
    for (const p of checkReturns(receiving, { kind: "purchase" })) { problems.push(p); tally(p); returns++; }
  }

  /*
   * Stock, item by item, in the order the movements happened.
   *
   * Grouped rather than streamed because a chain can only be checked whole:
   * the question is whether each movement starts where the last one finished,
   * and a gap is stock that changed without anything being written down.
   */
  const byItem = new Map();
  for await (const entry of db.collection("stocklogs").find({})) {
    movements++;
    const key = String(entry.view_item_id) + "|" + String(entry.branch_id);
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key).push(entry);
  }
  for (const [key, entries] of byItem) {
    stockItems++;
    const itemId = key.split("|")[0];
    let current = null;
    try {
      const { ObjectId } = require("mongodb");
      const item = await db.collection("items").findOne(
        { _id: new ObjectId(itemId) }, { projection: { available_quantity: 1, name: 1 } });
      if (item) current = item.available_quantity;
    } catch (e) { /* an item deleted since; the chain is still worth checking */ }
    const label = entries[0].item_name || itemId;
    for (const p of checkStockChain(entries, current, label)) { problems.push(p); tally(p); }
  }

  console.log(`database        : ${db.databaseName}`);
  console.log(`sales checked   : ${sales}`);
  console.log(`purchases       : ${purchases}`);
  console.log(`stock items     : ${stockItems}  (${movements} movements)`);
  console.log(`lines checked   : ${lines}`);
  console.log(`problems found  : ${problems.length}`);

  if (problems.length) {
    console.log("");
    for (const [rule, total] of exposure) {
      console.log(`  ${rule.padEnd(24)} ${String([...problems].filter((p) => p.rule === rule).length).padStart(5)} sales   ${money(total)}`);
    }
    console.log("");
    const show = args.verbose ? problems : problems.slice(0, 20);
    for (const p of show) console.log(`  ${p.doc || p.sale}  [${p.rule}]  ${p.detail}`);
    if (!args.verbose && problems.length > show.length) {
      console.log(`  ... and ${problems.length - show.length} more (--verbose for all)`);
    }
  } else {
    console.log("");
    console.log("  Every line, every total and every split payment reconciles.");
  }

  await client.close();
  process.exit(problems.length ? 1 : 0);
})().catch((err) => {
  console.error("audit failed:", err.message);
  process.exit(2);
});
