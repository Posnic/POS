#!/usr/bin/env node
'use strict';
/*
 * Module-key audit (MODULE_SYSTEM_ROADMAP M5): which branches still ride
 * the defaults for which module_* switches, and which have written values.
 * Read-only - the report that says when the legacy dual-writes can retire
 * (a straggler count of zero is the retirement condition).
 *
 *   MONGODB_URI=... [DB_NAME=...] node scripts/audit-module-keys.js
 *
 * The key list comes from the ONE shared map the write paths use
 * (setting.model moduleToggleMap), so this audit cannot drift from the
 * app: a key added there is a key audited here.
 */
const { MongoClient } = require('mongodb');
const SettingModel = require('../src/models/setting.model');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(process.env.DB_NAME || undefined);
    const keys = Object.keys(SettingModel.moduleToggleMap());
    const branches = await db
      .collection('branches')
      .find({}, { projection: { branch_name: 1, ...Object.fromEntries(keys.map((k) => [k, 1])) } })
      .toArray();

    const perKey = Object.fromEntries(keys.map((k) => [k, { set: 0, absent: 0 }]));
    for (const b of branches) {
      for (const k of keys) {
        if (b[k] === undefined) perKey[k].absent++;
        else perKey[k].set++;
      }
    }

    console.log(`branches: ${branches.length}`);
    console.log('key'.padEnd(34), 'set'.padStart(5), 'absent(=default)'.padStart(18));
    for (const k of keys) {
      console.log(k.padEnd(34), String(perKey[k].set).padStart(5), String(perKey[k].absent).padStart(18));
    }
    const stragglers = branches.filter((b) => keys.every((k) => b[k] === undefined));
    console.log(`\nbranches with NO module keys written at all (pure defaults): ${stragglers.length}`);
    for (const b of stragglers.slice(0, 20)) {
      console.log('  -', b.branch_name || String(b._id));
    }
    if (stragglers.length === 0) {
      console.log('retirement condition met: every branch has written module state.');
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error('audit failed:', e.message);
  process.exit(1);
});
