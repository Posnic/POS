#!/usr/bin/env node
'use strict';

/*
 * Fill the develop sandbox with a shop worth testing.
 *
 * An empty sandbox is barely better than no sandbox: whoever arrives has to
 * walk the setup wizard before they can look at the thing they came to look
 * at, and most will not bother. This gives them a shop with products,
 * customers, suppliers and a history of sales, and four people to sign in as.
 *
 * Run on the sandbox:
 *   node seed.js            install and seed, if it is not already there
 *   node seed.js --force    do it again from scratch
 *
 * The shop is installed through the REAL /api/install/add endpoint - the same
 * path a genuine tenant takes - rather than by writing documents into the
 * database. A fixture that bypasses production code tests the fixture.
 */

const path = require('path');
const fs = require('fs');

const API = process.env.SEED_API || 'http://127.0.0.1:3000';
const APP_DIR = process.env.SEED_APP_DIR || path.join(process.env.HOME || '/home/ubuntu', 'posnic-develop');
const ENV_FILE = path.join(APP_DIR, 'api', '.env');
const CREDS_FILE = path.join(APP_DIR, 'demo-users.json');

/*
 * Everyone a tester might need to be.
 *
 * Different roles on purpose: a contributor changing anything near permissions
 * needs to see the screen as somebody who is NOT an administrator, and the
 * only way to make that easy is to hand them the login.
 *
 * The passwords are deliberately obvious. This is a public box holding demo
 * data that is wiped nightly; pretending its logins are secret would only make
 * them harder to use without making anything safer.
 */
const USERS = [
  { role: 'admin',   usertype: 'super_admin', first: 'Aarti', last: 'Owner',   email: 'admin@develop.posnic.io',   pass: 'Develop@123', note: 'everything' },
  { role: 'manager', usertype: 'manager',     first: 'Mani',  last: 'Manager', email: 'manager@develop.posnic.io', pass: 'Develop@123', note: 'no staff or branch admin' },
  { role: 'cashier', usertype: 'cashier',     first: 'Kavi',  last: 'Cashier', email: 'cashier@develop.posnic.io', pass: 'Develop@123', note: 'the till, and little else' },
  { role: 'staff',   usertype: 'staff',       first: 'Sam',   last: 'Staff',   email: 'staff@develop.posnic.io',   pass: 'Develop@123', note: 'the least access there is' },
];

/*
 * What each demo account can reach.
 *
 * Built by REMOVING modules from the administrator's own map rather than
 * writing one from scratch: whatever shape `access` has on this version, and
 * whatever modules exist by then, the reduced maps stay valid. A hand-written
 * permission object goes stale the first time somebody adds a screen.
 */
const DENIED = {
  manager: ['user', 'branch', 'plan'],
  cashier: ['user', 'branch', 'plan', 'report', 'supplier', 'receiving', 'expense', 'category'],
  staff:   ['user', 'branch', 'plan', 'report', 'supplier', 'receiving', 'expense', 'category', 'item', 'customer'],
};
function permissionsFor(usertype, adminAccess) {
  if (usertype === 'super_admin') return adminAccess;
  const out = JSON.parse(JSON.stringify(adminAccess));
  for (const mod of DENIED[usertype] || []) delete out[mod];
  return out;
}

const say = (m) => console.log('  ' + m);
const die = (m) => { console.error('\n  ' + m + '\n'); process.exit(1); };

function envValue(key) {
  try {
    const m = new RegExp('^' + key + '=(.*)$', 'm').exec(fs.readFileSync(ENV_FILE, 'utf8'));
    return m ? m[1].trim() : null;
  } catch (e) { return null; }
}

async function waitForApi() {
  for (let i = 1; i <= 30; i += 1) {
    try {
      const r = await fetch(API + '/public/login.html', { signal: AbortSignal.timeout(5000) });
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  die('the API never came up at ' + API);
}

async function main() {
  const force = process.argv.includes('--force');

  say('waiting for the API');
  await waitForApi();

  const { MongoClient } = require(path.join(APP_DIR, 'api', 'node_modules', 'mongodb'));
  const bcrypt = require(path.join(APP_DIR, 'api', 'node_modules', 'bcryptjs'));
  const uri = envValue('MONGODB_URI') || 'mongodb://127.0.0.1:27017/PosnicDevelop';
  const client = await MongoClient.connect(uri);
  const db = client.db();

  const existing = await db.collection('branches').countDocuments({});
  if (existing > 0 && !force) {
    say(`already installed (${existing} branch(es)) - use --force to rebuild`);
    await client.close();
    return;
  }
  if (existing > 0 && force) {
    say('--force: dropping the database first');
    await db.dropDatabase();
  }

  /*
   * A fixed license id, so a rebuild lands on the same shop rather than
   * orphaning the previous one's items and settings. install/add is not
   * idempotent: called twice it makes a SECOND branch and the first one's
   * catalogue quietly stops being reachable.
   */
  const license = Buffer.from('developsandbox').toString('hex').slice(0, 24).padEnd(24, '0');
  const owner = USERS[0];

  say('installing the shop through /api/install/add');
  const res = await fetch(API + '/api/install/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: envValue('POSNIC_KEY'),
      secret: envValue('POSNIC_SECRET'),
      register_companyname: 'Develop Sandbox Store',
      register_username: owner.email,
      register_useremail: owner.email,
      register_userphone: '9000000000',
      register_userpassword: owner.pass,
      register_license: license,
      register_firstname: owner.first,
      register_lastname: owner.last,
      register_country: 'India',
      register_countryid: '101',
      register_state: 'Tamil Nadu',
      register_stateid: '4035',
      register_currency: 'INR',
      register_timezone: 'Asia/Kolkata',
      /*
       * register_demo, NOT demo_data. The service reads only the former, and
       * api/scripts/local-dev.js has been sending the latter - which is why
       * the local dev shop has always come up empty.
       */
      register_demo: 'yes',
      /* One of: supermarket, textile, electrical, hardware, cafe, bakery,
         icecream. 'retail' is not on that list and the installer rejects it -
         the demo dataset is picked per trade, so it has to be a real one. */
      businessType: 'supermarket',
    }),
  }).then((r) => r.json()).catch((e) => ({ error: e.message }));

  if (res && (res.error || res.status === false)) {
    await client.close();
    die('install failed: ' + (res.error || res.message));
  }
  say('shop installed: ' + (res.message || 'ok'));

  /* ---- the other three people ------------------------------------------ */

  const users = db.collection('users');
  const admin = await users.findOne({ email: owner.email });
  if (!admin) { await client.close(); die('the installer did not create the owner account'); }

  let made = 0;
  for (const u of USERS.slice(1)) {
    if (await users.findOne({ email: u.email })) continue;
    /*
     * Copied from the account the installer just made, rather than assembled
     * from guesses. Whatever a working user needs on this version - branch
     * access, license, printing design, flags added since - comes along, and
     * only the things that must differ are changed.
     */
    const doc = { ...admin };
    delete doc._id;
    doc.email = u.email;
    doc.username = u.email;
    /*
     * firstname/lastname and usertype - NOT first_name/last_name/role.
     *
     * The first version of this set the underscored names and `role`, which
     * the model itself calls legacy. The result was four accounts that all
     * logged in as "Aarti" with usertype super_admin: four ways to be the
     * administrator, which is the opposite of the point. `access` is what the
     * screens actually read.
     */
    doc.firstname = u.first;
    doc.lastname = u.last;
    doc.usertype = u.usertype;
    doc.role = u.role;
    doc.access = permissionsFor(u.usertype, admin.access || {});
    doc.password = await bcrypt.hash(u.pass, 10);
    doc.created_date = new Date();
    doc.updated_date = new Date();
    await users.insertOne(doc);
    made += 1;
  }
  say(made ? `created ${made} more user(s)` : 'the other users were already there');

  /* ---- a history to test reports against -------------------------------- */

  /*
   * The installer's own demo activity is wrapped in a try/catch that
   * deliberately swallows failures - "a shop with products and no sample sales
   * is a working shop" - and on this box it produced nothing without saying
   * why. For a dev server that is not good enough: reports, returns and the
   * dashboard all read as empty, so the screens most worth testing show
   * nothing at all.
   *
   * So the sales are built here, from the same module the demo shops use.
   * Dated into the past on purpose, which is that module's whole point: a
   * shop's takings must be its own from the first sale it rings up.
   */
  const salesCol = db.collection('sales');
  if (await salesCol.countDocuments({}) === 0) {
    const demoSeed = require(path.join(APP_DIR, 'api', 'src', 'services', 'demo-seed.js'));
    const items = await db.collection('items').find({}).toArray();
    const branchDoc = await db.collection('branches').findOne({});
    const customers = await db.collection('customers').find({}).toArray();
    const suppliers = await db.collection('suppliers').find({}).toArray();

    if (items.length && branchDoc) {
      const branch = { branch_id: branchDoc._id, branch_name: branchDoc.branch_name };
      const pack = items[0].demo_pack || 'develop-sandbox';
      const now = new Date();
      const common = { items, branch, pack, now };

      const sales = demoSeed.buildSales({
        ...common, customers, customer: customers[0], userName: owner.first,
      });
      if (sales.length) await salesCol.insertMany(sales);

      if (suppliers.length) {
        const purchases = demoSeed.buildPurchases({ ...common, suppliers });
        if (purchases.length) await db.collection('receivings').insertMany(purchases);
      }

      const quotes = demoSeed.buildQuotes(common);
      if (quotes.length) await db.collection('quotations').insertMany(quotes).catch(() => {});

      say(`history: ${sales.length} sale(s), and purchases and quotes where the data allowed`);
    }
  }

  /* ---- what is actually in there --------------------------------------- */

  const counts = {};
  for (const c of ['items', 'customers', 'suppliers', 'sales', 'receivings', 'users', 'branches']) {
    counts[c] = await db.collection(c).countDocuments({}).catch(() => 0);
  }
  say('contents: ' + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', '));

  if (!counts.items) {
    say('WARNING: no items were seeded - check that register_demo was honoured');
  }

  /* Written for the login page to read, so the credentials on screen are the
     ones that actually exist rather than something a document claims. */
  fs.writeFileSync(CREDS_FILE, JSON.stringify({
    updated: new Date().toISOString(),
    shop: 'Develop Sandbox Store',
    users: USERS.map((u) => ({ role: u.role, email: u.email, password: u.pass, note: u.note })),
  }, null, 2));

  await client.close();

  console.log('');
  console.log('  ─────────────────────────────────────────────────────────');
  for (const u of USERS) {
    console.log('   ' + u.role.padEnd(9) + u.email.padEnd(32) + u.pass);
  }
  console.log('  ─────────────────────────────────────────────────────────');
  console.log('');
}

main().catch((e) => die(e.stack || e.message));
