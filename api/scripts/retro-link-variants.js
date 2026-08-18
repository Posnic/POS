#!/usr/bin/env node
'use strict';
/*
 * Retro-link variant families (VARIANT_SYSTEM_RESEARCH V1e).
 *
 * Items created by the old variant flow are named "<Parent> / <Value>" and
 * carry no link. This proposes families from that convention - same name
 * prefix, same category, same branch, two or more members, none already
 * linked - and links them ONLY when told to, family by family or all at
 * once. Preview is the default and writes nothing.
 *
 * NEVER automatic, by design: "Fish / Chips" is a fish dish, not a variant
 * of Fish. A human reads the preview and decides.
 *
 *   MONGODB_URI=... DB_NAME=... node scripts/retro-link-variants.js
 *       preview every proposed family (writes nothing)
 *   ... node scripts/retro-link-variants.js --apply --family "Shirt"
 *       link just the families whose parent name matches exactly
 *   ... node scripts/retro-link-variants.js --apply-all
 *       link every proposal (after you have read the preview!)
 *
 * Linked members get a fresh updated_date so the change syncs to tills.
 */
const { MongoClient, ObjectId } = require('mongodb');

const SEP = ' / ';

/** Group unlinked "<Parent> / <Value>" items into family proposals. Pure. */
function proposeFamilies(items) {
  const groups = new Map();
  for (const it of items || []) {
    if (!it || it.variant_group_id) continue;
    const name = String(it.name || '');
    const i = name.indexOf(SEP);
    if (i <= 0 || i >= name.length - SEP.length) continue;
    const parent = name.slice(0, i).trim();
    const value = name.slice(i + SEP.length).trim();
    if (!parent || !value) continue;
    const key = [
      parent.toLowerCase(),
      String(it.category_id || ''),
      String(it.branch_id || ''),
    ].join('|');
    if (!groups.has(key)) groups.set(key, { parent, members: [] });
    groups.get(key).members.push({ id: it._id, name, value });
  }
  return (
    [...groups.values()]
      .filter((g) => g.members.length >= 2)
      /* A family with the same value twice is ambiguous - two "Shirt / Small"
       rows are duplicates, not variants. Propose nothing rather than guess. */
      .filter((g) => new Set(g.members.map((m) => m.value.toLowerCase())).size === g.members.length)
      .sort((a, b) => a.parent.localeCompare(b.parent))
  );
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const applyAll = args.includes('--apply-all');
  const apply = applyAll || args.includes('--apply');
  const familyFilters = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--family' && args[i + 1]) familyFilters.push(args[i + 1].toLowerCase());
  }
  if (apply && !applyAll && !familyFilters.length) {
    console.error('--apply needs --family "<parent name>" (or use --apply-all)');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(process.env.DB_NAME || undefined);
    const items = await db
      .collection('items')
      .find(
        { name: { $regex: ' \\/ ' }, variant_group_id: { $exists: false } },
        { projection: { name: 1, category_id: 1, branch_id: 1, variant_group_id: 1 } }
      )
      .toArray();

    const proposals = proposeFamilies(items);
    if (!proposals.length) {
      console.log('No unlinked "<Parent> / <Value>" families found. Nothing to do.');
      return;
    }

    console.log(`${proposals.length} proposed famil${proposals.length === 1 ? 'y' : 'ies'}:`);
    for (const p of proposals) {
      console.log(`\n  ${p.parent}  (${p.members.length} members)`);
      for (const m of p.members) console.log(`    - ${m.name}`);
    }

    if (!apply) {
      console.log(
        '\nPreview only - nothing written. Re-run with --apply --family "<name>" or --apply-all.'
      );
      return;
    }

    const chosen = applyAll
      ? proposals
      : proposals.filter((p) => familyFilters.includes(p.parent.toLowerCase()));
    if (!chosen.length) {
      console.error('\nNo proposal matches the requested --family name(s). Nothing written.');
      process.exit(1);
    }

    const now = new Date();
    let linked = 0;
    for (const p of chosen) {
      const groupId = new ObjectId();
      for (const m of p.members) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection('items').updateOne(
          { _id: m.id, variant_group_id: { $exists: false } },
          {
            $set: {
              variant_group_id: groupId,
              variant_axis: 'Variant',
              variant_value: m.value,
              variant_parent_name: p.parent,
              updated_date: now, // so the link syncs down to tills
            },
          }
        );
        linked++;
      }
      console.log(`\nlinked: ${p.parent} (${p.members.length} members, group ${groupId})`);
    }
    console.log(
      `\n${linked} items linked across ${chosen.length} famil${chosen.length === 1 ? 'y' : 'ies'}.`
    );
  } finally {
    await client.close();
  }
}

module.exports = { proposeFamilies, SEP };

if (require.main === module) {
  main().catch((e) => {
    console.error('retro-link failed:', e.message);
    process.exit(1);
  });
}
