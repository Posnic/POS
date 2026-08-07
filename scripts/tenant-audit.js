#!/usr/bin/env node
'use strict';
/*
 * Find what a tenant database is missing, and optionally fill it in.
 *
 * A tenant is created by running the app's own install against a fresh
 * database. That means a shop provisioned against an older build starts life
 * without whatever was added since - and nothing ever goes back to fix it,
 * because installs only run once.
 *
 * Most such gaps are harmless: branch settings are given defaults when they
 * are read (branch.model.js), so a missing flag reads as false rather than as
 * undefined. The ones that matter are the values with no read-time default,
 * where missing means broken rather than off - a branch with no
 * thermal_body_print prints an empty receipt.
 *
 * So this reports before it touches anything, and when it does act it only
 * ever adds. A shop that has configured something has configured it; a
 * migration that "corrects" a deliberate setting is worse than the gap it
 * closes.
 *
 *   node scripts/tenant-audit.js --db PosnicPro --license <id>
 *   node scripts/tenant-audit.js --db PosnicPro            (every company)
 */

const fs = require('fs');
const path = require('path');

/*
 * What a correctly provisioned branch has.
 *
 * `severity` is the whole point of this table:
 *
 *   breaks   no read-time default exists, so absence is a fault the shop will
 *            see - a blank receipt, a page that cannot render.
 *   cosmetic branch.model.js supplies a default on read, so absence changes
 *            nothing. Listed to be counted, not to be fixed.
 *
 * Only "breaks" rows are ever written, and only when they are absent.
 */
function branchExpectations() {
  const json = path.join(__dirname, '..', 'api', 'src', 'json');
  const read = (f) => {
    try { return fs.readFileSync(path.join(json, f), 'utf8'); } catch (e) { return null; }
  };

  return [
    {
      field: 'thermal_body_print',
      severity: 'breaks',
      why: 'the receipt body; without it a sale prints an empty slip',
      value: () => read('print_standard_html.txt'),
    },
    {
      field: 'print_controls',
      severity: 'breaks',
      why: 'receipt titles and A4 column toggles; without it printing has no titles',
      value: () => ({
        receiving_title: '<span style="font-size: 14px !important;font-weight: 900;">PURCHASE INVOICE</span>',
        receiving_return_title: '<span style="font-size: 14px !important;font-weight: 900;">PURCHASE RETURN INVOICE</span>',
        sale_title: '<span style="font-size: 14px !important;font-weight: 900;">SALES RECEIPT</span>',
        sale_return_title: '<span style="font-size: 14px !important;font-weight: 900;">SALES RETURN RECEIPT</span>',
        a4: {
          lineitem_hsn: 'on', lineitem_price: 'on', lineitem_qty: 'on',
          lineitem_disc: 'on', lineitem_tax: 'on', lineitem_total: 'on',
          print_qty: 'on', print_roundoff: 'on',
        },
      }),
    },
    { field: 'time_zone', severity: 'cosmetic', why: 'defaults to Asia/Calcutta on read' },
    { field: 'time_format', severity: 'cosmetic', why: 'defaults to enable on read' },
    { field: 'currency_value', severity: 'cosmetic', why: 'defaults to INR on read' },
    { field: 'hardware_weight_machine_enable', severity: 'cosmetic', why: 'defaults to false on read' },
    { field: 'till_lock_enable', severity: 'cosmetic', why: 'defaults to false on read' },
    { field: 'till_lock_idle_minutes', severity: 'cosmetic', why: 'defaults to 0 on read' },
    { field: 'enable_notification_reminders', severity: 'cosmetic', why: 'defaults to false on read' },
    { field: 'sms_auto_send_time', severity: 'cosmetic', why: 'defaults to 10:00 am on read' },
  ];
}

// Collections a working shop has. Empty is fine and expected for a new shop;
// absent is what this looks for, because a query against a missing collection
// behaves differently from one against an empty one in some drivers.
const EXPECTED_COLLECTIONS = [
  'branches', 'users', 'items', 'categories', 'customers',
  'suppliers', 'unit', 'grouptax', 'sales', 'receivings',
];

/*
 * The gap between one branch document and a correctly provisioned one.
 *
 * Pure, so it can be tested without a database - which matters here, because
 * the only place to try this for real is a shop's live data.
 */
function auditBranch(branch, expectations) {
  const gaps = [];
  for (const rule of expectations) {
    const value = branch ? branch[rule.field] : undefined;
    const missing = value === undefined || value === null || value === ''
      || (Array.isArray(value) && value.length === 0);
    if (missing) {
      gaps.push({ field: rule.field, severity: rule.severity, why: rule.why });
    }
  }
  return gaps;
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
 * Group branches by the company that owns them.
 *
 * Shops are not one database each: they share a database and are separated by
 * a license id carried on every document. A report that lists branches without
 * saying whose they are is unreadable the moment there is more than one
 * customer in there, and a repair that ignored that boundary would be worse
 * than unreadable.
 */
function groupByLicense(branches) {
  const companies = new Map();
  for (const branch of branches) {
    const key = String(branch.license || 'no-license');
    if (!companies.has(key)) companies.set(key, []);
    companies.get(key).push(branch);
  }
  return companies;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // The connection string carries credentials, so it can come from a file
  // rather than the command line, where it would linger in shell history.
  if (args.uriFile && !args.uri) {
    args.uri = fs.readFileSync(args.uriFile, 'utf8').trim();
  }

  if (!args.uri || !args.db) {
    console.error('Usage: node scripts/tenant-audit.js --db <database> [options]');
    console.error('');
    console.error('  --uri <mongodb-uri>   connection string');
    console.error('  --uri-file <path>     read the connection string from a file');
    console.error('  --license <id>        one company only; omit for every company');
    console.error('  --apply               write missing values (default: report only)');
    process.exit(2);
  }

  let MongoClient, ObjectId;
  try {
    ({ MongoClient, ObjectId } = require('../api/node_modules/mongodb'));
  } catch (e) {
    ({ MongoClient, ObjectId } = require('mongodb'));
  }

  const client = new MongoClient(args.uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(args.db);

  console.log('\n  tenant: ' + args.db + (args.apply ? '   (APPLYING)' : '   (report only)'));

  const present = (await db.listCollections().toArray()).map((c) => c.name);
  const missingCollections = EXPECTED_COLLECTIONS.filter((c) => !present.includes(c));
  console.log('\n  collections: ' + present.length + ' present'
    + (missingCollections.length ? ', missing ' + missingCollections.join(', ') : ', none missing'));

  const expectations = branchExpectations();

  /*
   * One company, or every company in the database.
   *
   * Shops share this database and are separated by a license id, so auditing
   * "the database" means auditing every customer in it at once. That is fine
   * to read and worth pausing over before writing.
   */
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

  const companies = groupByLicense(branches);
  console.log('  branches:    ' + branches.length + ' across ' + companies.size + ' company(ies)'
    + (args.license ? '   (filtered to one license)' : ''));

  let wrote = 0;
  let needingWork = 0;
  for (const [license, owned] of companies) {
    const companyBreaks = owned.some((b) =>
      auditBranch(b, expectations).some((g) => g.severity === 'breaks'));
    if (companyBreaks) needingWork++;
    console.log('\n  ---- license ' + license + '   ' + owned.length + ' branch'
      + (owned.length === 1 ? '' : 'es') + (companyBreaks ? '   NEEDS WORK' : ''));

  for (const branch of owned) {
    const gaps = auditBranch(branch, expectations);
    const breaks = gaps.filter((g) => g.severity === 'breaks');
    const cosmetic = gaps.filter((g) => g.severity === 'cosmetic');

    console.log('\n  ' + (branch.branch_name || String(branch._id)));
    if (!gaps.length) { console.log('    nothing missing'); continue; }
    for (const g of breaks) console.log('    MISSING  ' + g.field + '  - ' + g.why);
    if (cosmetic.length) {
      console.log('    ' + cosmetic.length + ' absent but defaulted on read: '
        + cosmetic.map((g) => g.field).join(', '));
    }

    if (args.apply && breaks.length) {
      const $set = {};
      for (const g of breaks) {
        const rule = expectations.find((e) => e.field === g.field);
        const value = typeof rule.value === 'function' ? rule.value() : rule.value;
        if (value === null || value === undefined) {
          console.log('    could not source a value for ' + g.field + ', left alone');
          continue;
        }
        $set[g.field] = value;
      }
      if (Object.keys($set).length) {
        /*
         * Written one field at a time, each guarded on still being absent.
         *
         * The read that produced this list happened seconds ago and the shop
         * is live: somebody may have set one of these in between. Querying
         * for null also matches a field that is not there at all, so this
         * matches exactly the state the report described and nothing else.
         */
        const filled = [];
        for (const key of Object.keys($set)) {
          const result = await db.collection('branches').updateOne(
            { _id: branch._id, [key]: { $in: [null, ''] } },
            { $set: { [key]: $set[key] } });
          if (result.modifiedCount) { filled.push(key); wrote++; }
          else console.log('    ' + key + ' was set by someone else meanwhile, left alone');
        }
        if (filled.length) console.log('    filled in: ' + filled.join(', '));
      }
    }
  }
  }

  console.log('\n  ' + needingWork + ' of ' + companies.size
    + ' company(ies) have something that breaks.');
  if (!args.apply) {
    console.log('  Nothing was written. Re-run with --apply to fill in the MISSING rows.');
  } else {
    console.log('  branch fields written: ' + wrote);
  }

  await client.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('  failed: ' + err.message);
    process.exit(1);
  });
}

module.exports = { auditBranch, branchExpectations, groupByLicense, EXPECTED_COLLECTIONS };
