#!/usr/bin/env node
'use strict';
/*
 * Give existing shops the explicit feature settings that new shops now get -
 * without switching off anything a shop is actually using.
 *
 * WHAT THIS IS FOR
 *
 * "why these many activated already. this is not i wanted."
 *
 * A module is read as ON unless a branch document explicitly says false
 * (PosnicPro.js: `s[k] !== false`). A shop that has never touched Settings has
 * no module_* keys at all, so every feature reads as enabled. Nobody chose
 * that; it is what "absent" happens to mean. A new shop is now created with
 * four features on and the rest off, but defaults only apply at creation, so
 * every shop that already exists still shows the full menu.
 *
 * WHY THE CONVENTION IS NOT SIMPLY FLIPPED
 *
 * Because absent-means-on is load-bearing for every shop already running. A
 * shop that has been taking credit sales for a year has no module_credit_enable
 * key either - it never needed one. Change what absent means, deploy, and that
 * shop's Credit menu disappears overnight, its outstanding balances become
 * unreachable, and nothing anywhere reports an error. The data is all still
 * there, which is what makes it so hard to diagnose: it looks like the feature
 * was removed from the product.
 *
 * So this writes EXPLICIT values instead, and decides each one from evidence.
 *
 * THE RULE
 *
 *   in use            -> true    the shop has records for it. Never taken away.
 *   never used, core  -> true    Tax, Quick sale, Themes: the new-shop defaults.
 *   never used, other -> false   off, and one click from on.
 *
 * "In use" is counted from the shop's own data, not from a settings flag,
 * because the settings flag is the thing that is missing. A single record is
 * enough: somebody who wrote one expense is using the cash book, and being
 * wrong in that direction costs a menu entry, while being wrong in the other
 * direction hides their work.
 *
 * REPORTS BEFORE IT TOUCHES ANYTHING. --apply is required to write, and even
 * then it only ever fills in keys that are absent: a shop that has switched
 * something off has decided, and a migration that "corrects" a deliberate
 * setting is worse than the gap it closes.
 *
 *   node scripts/module-defaults-backfill.js --db PosnicPro --uri-file .uri
 *   node scripts/module-defaults-backfill.js --db PosnicPro --uri-file .uri --apply
 */

const fs = require('fs');

/*
 * One row per feature: the key, whether a shop with no history should get it,
 * and how to tell whether this shop is already using it.
 *
 * `evidence` is a list of [collection, extraQuery] pairs, all scoped to the
 * branch and licence by the caller. An empty list means there is nothing to
 * count - the feature leaves no records of its own - and those rows fall back
 * to `dflt` alone.
 *
 * WHY EVIDENCE AND NOT "did they open the page". Nothing records that. Records
 * are what a shop has to show for a feature, and they are the only honest
 * answer to "would switching this off take something away".
 */
const FEATURES = [
  {
    key: 'module_tax_enable',
    dflt: true,
    why: 'a new shop gets this on; tax applies to sales everywhere',
    evidence: [],
  },
  {
    key: 'quick_sale_enable',
    dflt: true,
    why: 'a new shop gets this on; it is the busy-counter pad, not a menu',
    evidence: [],
  },
  {
    key: 'module_themes_enable',
    dflt: true,
    why: 'a new shop gets this on; it only changes how the till looks',
    evidence: [],
  },
  {
    key: 'module_demo_data_enable',
    dflt: false,
    why: 'sample data, which a shop either has or does not',
    /* The samples themselves. A shop that still has them wants the switch that
       hides them; a shop that removed them has no use for it. */
    evidence: [['items', { demo_pack: { $exists: true } }]],
  },
  {
    key: 'module_cashbook_enable',
    dflt: false,
    why: 'expenses and cash movements',
    evidence: [['expenses', {}]],
  },
  {
    key: 'module_recyclebin_enable',
    dflt: false,
    why: 'deleted records kept for restore',
    /* Anything already in the bin. Switching this off does not destroy what is
       there, but it does hide the only way back to it. */
    evidence: [['recycle_bin', {}]],
  },
  {
    key: 'module_credit_enable',
    dflt: false,
    why: 'selling on account',
    evidence: [
      ['customers', { credit_limit: { $gt: 0 } }],
      ['customers', { balance: { $gt: 0 } }],
    ],
  },
  {
    key: 'module_marketing_enable',
    dflt: false,
    why: 'loyalty, coupons, cashback and campaigns',
    evidence: [
      ['coupons', {}],
      ['campaigns', {}],
      ['loyalty_ledger', {}],
      ['cashback_issues', {}],
    ],
  },
  {
    key: 'module_messaging_enable',
    dflt: false,
    why: 'receipts and notices by WhatsApp or SMS',
    evidence: [['reminder_sends', {}], ['campaign_sends', {}]],
  },
  {
    key: 'module_channels_enable',
    dflt: false,
    why: 'kiosk, QR ordering and online lists',
    evidence: [['kiosk_updates', {}], ['tableorder', {}]],
  },
  {
    key: 'module_channels_kiosk_enable',
    dflt: false,
    why: 'the kiosk specifically',
    evidence: [['kiosk_updates', {}]],
  },
  {
    key: 'quotes_enable',
    dflt: false,
    why: 'quotations',
    evidence: [['quotes', {}]],
  },
  {
    key: 'invoices_enable',
    dflt: false,
    why: 'invoices billed and chased before the sale',
    evidence: [['invoices', {}]],
  },
  {
    key: 'cash_register_enable',
    dflt: false,
    why: 'till openings, closings and counts',
    evidence: [['cashregister', {}]],
  },
  {
    key: 'staff_shifts_enable',
    dflt: false,
    why: 'clock-in and the labour report',
    evidence: [['shifts', {}]],
  },
  {
    key: 'staff_roster_enable',
    dflt: false,
    why: 'planning the week ahead',
    evidence: [['shift_schedules', {}]],
  },
  /*
   * NOT HERE, deliberately: staff_tips_enable and till_lock_enable.
   *
   * Both are onOnly - absent already parses as FALSE - so they are off in every
   * shop today and there is nothing to correct. Writing an explicit false would
   * be a migration that changes nothing, and every row it touched would have to
   * be explained to whoever reads the audit log next.
   */
];

/*
 * Which branch fields a shop already decided for itself.
 *
 * `false` and `true` are both decisions. Only undefined/null is a gap, and only
 * gaps are ever filled - otherwise this would overwrite the choices of exactly
 * the shops that took the trouble to make them.
 */
function isUnset(value) {
  return value === undefined || value === null || value === '';
}

/*
 * The decision for one branch, given what its data shows.
 *
 * Pure, so it can be tested without a database - which matters more than usual
 * here, because the only place to try this for real is a customer's live shop.
 *
 * `usage` maps a feature key to a count of the records found for it.
 */
function planBranch(branch, usage, features) {
  const plan = [];
  for (const feature of features || FEATURES) {
    const current = branch ? branch[feature.key] : undefined;
    if (!isUnset(current)) {
      plan.push({ key: feature.key, action: 'keep', value: current, reason: 'the shop has already decided' });
      continue;
    }
    const used = Number(usage[feature.key] || 0) > 0;
    if (used) {
      plan.push({
        key: feature.key,
        action: 'set',
        value: true,
        reason: 'in use (' + usage[feature.key] + ' record' + (usage[feature.key] === 1 ? '' : 's') + ')',
      });
      continue;
    }
    plan.push({
      key: feature.key,
      action: 'set',
      value: feature.dflt,
      reason: feature.dflt ? 'a new shop gets this on' : 'no records, and a new shop starts with it off',
    });
  }
  return plan;
}

/* Only the writes, in the shape updateOne wants. */
function writesOf(plan) {
  const set = {};
  for (const row of plan) {
    if (row.action === 'set') set[row.key] = row.value;
  }
  return set;
}

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--uri') args.uri = argv[++i];
    else if (argv[i] === '--uri-file') args.uriFile = argv[++i];
    else if (argv[i] === '--db') args.db = argv[++i];
    else if (argv[i] === '--license') args.license = argv[++i];
    else if (argv[i] === '--apply') args.apply = true;
  }
  return args;
}

/*
 * Count what a branch has to show for each feature.
 *
 * Every query is scoped to the branch AND the licence. Both, always: a query
 * missing the licence would count another company's records and switch a
 * feature on for a shop that has never used it - visible only as a menu entry
 * nobody asked for, which is the kind of thing that is never traced back.
 *
 * A missing collection counts zero rather than throwing. Shops provisioned by
 * older builds simply do not have some of these, and that is a fact about the
 * shop, not a failure to report.
 */
async function measure(db, branch, features) {
  const usage = {};
  for (const feature of features || FEATURES) {
    let total = 0;
    for (const [collection, extra] of feature.evidence) {
      try {
        /*
         * Branch scoping differs by collection - items carry branch_access,
         * everything else a branch_id - so both are offered and either
         * matching is enough. Getting this wrong in the strict direction
         * would count zero and switch a live feature off.
         */
        const scope = {
          $and: [
            { $or: [{ branch_id: branch._id }, { 'branch_access.branch_id': branch._id }] },
            extra,
          ],
        };
        if (branch.license) scope.$and.push({ license: branch.license });
        total += await db.collection(collection).countDocuments(scope, { limit: 1 });
      } catch (e) {
        /* No such collection in this shop. Nothing to count. */
      }
      if (total > 0) break;   // one record is enough; stop paying for the rest
    }
    usage[feature.key] = total;
  }
  return usage;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // The connection string carries credentials, so it can come from a file
  // rather than the command line, where it would linger in shell history.
  if (args.uriFile && !args.uri) {
    args.uri = fs.readFileSync(args.uriFile, 'utf8').trim();
  }

  if (!args.uri || !args.db) {
    console.error('Usage: node scripts/module-defaults-backfill.js --db <database> [options]');
    console.error('');
    console.error('  --uri <mongodb-uri>   connection string');
    console.error('  --uri-file <path>     read the connection string from a file');
    console.error('  --license <id>        one company only; omit for every company');
    console.error('  --apply               write the plan (default: report only)');
    process.exit(2);
  }

  let MongoClient;
  let ObjectId;
  try {
    ({ MongoClient, ObjectId } = require('../api/node_modules/mongodb'));
  } catch (e) {
    ({ MongoClient, ObjectId } = require('mongodb'));
  }

  const client = new MongoClient(args.uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(args.db);

  console.log('\n  tenant: ' + args.db + (args.apply ? '   (APPLYING)' : '   (report only)'));

  const query = {};
  if (args.license) {
    query.license = ObjectId.isValid(args.license) ? new ObjectId(args.license) : args.license;
  }
  const branches = await db.collection('branches').find(query).toArray();
  if (!branches.length) {
    console.log('\n  Nothing matched. Check the database name'
      + (args.license ? ' and the license id.' : '.'));
    await client.close();
    return;
  }

  console.log('  branches: ' + branches.length + '\n');

  let touched = 0;
  let already = 0;
  for (const branch of branches) {
    const usage = await measure(db, branch, FEATURES);
    const plan = planBranch(branch, usage, FEATURES);
    const set = writesOf(plan);
    const name = branch.branch_name || String(branch._id);

    if (!Object.keys(set).length) {
      already++;
      console.log('  ' + name + ' - every switch already decided, nothing to write');
      continue;
    }

    touched++;
    const on = plan.filter((p) => p.action === 'set' && p.value === true);
    const off = plan.filter((p) => p.action === 'set' && p.value === false);
    console.log('  ' + name);
    for (const row of on) {
      console.log('      ON   ' + row.key + '   (' + row.reason + ')');
    }
    for (const row of off) {
      console.log('      off  ' + row.key + '   (' + row.reason + ')');
    }

    if (args.apply) {
      await db.collection('branches').updateOne({ _id: branch._id }, { $set: set });
      console.log('      written');
    }
  }

  console.log('\n  ' + touched + ' branch(es) to change, ' + already + ' already explicit');
  if (!args.apply && touched) {
    console.log('  Report only. Re-run with --apply to write.');
  }
  await client.close();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { FEATURES, planBranch, writesOf, isUnset, measure };
