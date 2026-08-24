#!/usr/bin/env node
'use strict';
/*
 * Keep the deploy smoke's fixture item in stock - forever.
 *
 * The ring-gate smoke (provisioning/smoke.js, server-side) proves each ring
 * by creating a REAL sale of one fixture item in the sbala TEST shop. Every
 * deploy sells one more unit, so a day of heavy shipping drained it to zero
 * and every deploy after that failed its own gate with "quantity is
 * mismatched" - the estate froze on the previous build for a reason that
 * had nothing to do with the code being shipped.
 *
 * This runs on the box right before the smoke (ring-reload.sh), using the
 * api's own env, and tops the fixture back up whenever it runs low. It is
 * deliberately surgical: the fixture is addressed by the first six bytes of
 * its ObjectId (from the failing smoke's own error payload) as an id RANGE
 * scan across the tenant databases - nothing else can match, nothing else
 * is touched, and the write only happens when stock is actually low.
 *
 * Exit code is always 0: a restock helper must never be the reason a
 * deploy fails - the smoke itself remains the gate.
 */
require('dotenv').config({ quiet: true });
const { MongoClient, ObjectId } = require('mongodb');

/* The smoke fixture's id prefix, straight from the smoke's error payload. */
const FIXTURE_ID_PREFIX = '6a769eb950cf';
const RESTOCK_TO = 100000;
const RESTOCK_BELOW = 1000;

async function main() {
  const uri = process.env.MONGODB_URI || process.env.ATLAS_URI;
  if (!uri) {
    console.log('[smoke-restock] no MONGODB_URI in env - nothing to do');
    return;
  }
  const lo = new ObjectId(FIXTURE_ID_PREFIX + '000000000000');
  const hi = new ObjectId(FIXTURE_ID_PREFIX + 'ffffffffffff');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    /*
     * THE WRITE SHOP'S OWN FIXTURE, FIRST.
     *
     * The billing smoke sells whatever item db.items.find().limit(1) returns
     * in SMOKE_WRITE_TENANT's database - not the legacy fixture below. When
     * the write shop moved off the old sbala shop, this helper kept topping
     * up an item nobody was selling any more while the item actually being
     * drained crept toward zero, one unit per deploy, with the freeze
     * arriving weeks later on a commit that had nothing to do with it.
     *
     * The tenant db is derived exactly the way the provisioner names them:
     * posnic_t_<subdomain without dashes>.
     */
    const writeTenant = String(process.env.SMOKE_WRITE_TENANT || '').trim();
    if (writeTenant) {
      const dbName = 'posnic_t_' + writeTenant.replace(/-/g, '');
      const items = client.db(dbName).collection('items');
      const first = await items
        .find({})
        .project({ name: 1, available_quantity: 1 })
        .limit(1)
        .toArray()
        .catch(() => []);
      if (first.length) {
        const qty = Number(first[0].available_quantity) || 0;
        if (qty < RESTOCK_BELOW) {
          await items.updateOne(
            { _id: first[0]._id },
            { $set: { available_quantity: RESTOCK_TO } }
          );
          console.log(
            `[smoke-restock] "${first[0].name}" in ${dbName} topped up ${qty} -> ${RESTOCK_TO}`
          );
        } else {
          console.log(
            `[smoke-restock] "${first[0].name}" in ${dbName} has ${qty} - no top-up needed`
          );
        }
      }
    }

    /* The legacy fixture, kept for as long as the old shop exists: pointing
       SMOKE_WRITE_TENANT back at it must not reopen the drain. */
    const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
    for (const { name } of databases) {
      if (['admin', 'local', 'config'].includes(name)) continue;
      const items = client.db(name).collection('items');
      const hit = await items
        .findOne(
          { _id: { $gte: lo, $lte: hi } },
          { projection: { name: 1, available_quantity: 1 } }
        )
        .catch(() => null);
      if (!hit) continue;
      const qty = Number(hit.available_quantity) || 0;
      if (qty >= RESTOCK_BELOW) {
        console.log(
          `[smoke-restock] fixture "${hit.name}" in ${name} has ${qty} - no top-up needed`
        );
        return;
      }
      await items.updateOne({ _id: hit._id }, { $set: { available_quantity: RESTOCK_TO } });
      console.log(
        `[smoke-restock] fixture "${hit.name}" in ${name} topped up ${qty} -> ${RESTOCK_TO}`
      );
      return;
    }
    console.log('[smoke-restock] fixture item not found in any database - smoke will say why');
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.log('[smoke-restock] helper failed (deploy continues):', e.message);
});
