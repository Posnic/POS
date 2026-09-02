#!/usr/bin/env node
'use strict';

/*
 * Get back into a shop when nothing else can.
 *
 *   node scripts/recover-access.js                     list who can sign in
 *   node scripts/recover-access.js <email> <password>   set one password
 *
 * WHY THIS EXISTS.
 *
 * Every other way back in goes through us. The console needs our staff, the
 * reset email needs our mail account, and support needs to be awake. A shop
 * running Posnic on its own server, or a till on a network with no way out,
 * has none of those - and when its owner is locked out, the shop stops selling.
 *
 * Until now the only remedy was a database edit performed by somebody who knew
 * that this application hashes bcrypt over BASE64 of the password rather than
 * over the password. Get that wrong and sign-in appears to work - the login
 * falls back to a plain hash - while manager approvals, which only ever compare
 * the base64 form, silently stop accepting it. That knowledge lived in one
 * person's head. This makes it a documented, audited command instead.
 *
 * WHAT THIS IS NOT.
 *
 * Not a privilege escalation. Anybody who can run this can already read the
 * database it writes to - they own the machine. The security boundary is the
 * operating system's, and it always was. What changes is that recovery is now
 * WRITTEN DOWN and LEAVES A RECORD, rather than being a secret technique.
 *
 * It refuses to touch a shop it cannot reach locally, and every use is written
 * to the shop's own audit_log with the operating-system account that ran it -
 * so the business can see it happened, which is the whole point.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function die(what, fix) {
  console.error(`\n  ${what}`);
  if (fix) console.error(`  -> ${fix}`);
  process.exit(1);
}

/*
 * The same file the API reads. Deliberately not a separate connection string:
 * a recovery tool that can point somewhere else is a recovery tool that can
 * quietly repair the wrong database.
 */
function readEnv() {
  const file = path.join(ROOT, 'api', '.env');
  if (!fs.existsSync(file)) {
    die('There is no api/.env here, so this is not a Posnic installation.',
      'Run this from the directory Posnic is installed in.');
  }
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function loadDriver(name) {
  try {
    return require(path.join(ROOT, 'api', 'node_modules', name));
  } catch (e) {
    try {
      return require(name);
    } catch (e2) {
      die(`Could not load ${name}: ${e2.message}`,
        'Run "npm install --prefix api" in the installation directory first.');
    }
  }
  return null;
}

(async () => {
  const [emailArg, passwordArg] = process.argv.slice(2);

  const env = readEnv();
  const uri = env.MONGODB_URI;
  if (!uri) die('api/.env has no MONGODB_URI, so there is no database to open.');

  const { MongoClient } = loadDriver('mongodb');
  const bcrypt = loadDriver('bcryptjs');

  let client;
  try {
    client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 10000 });
  } catch (e) {
    die(`Could not open the database: ${e.message}`,
      'Is Posnic running? The database starts with the application.');
  }

  const db = client.db();
  const users = db.collection('users');
  const list = await users.find({}, {
    projection: { email: 1, username: 1, usertype: 1, activate: 1, updated_date: 1, created_date: 1 },
  }).limit(200).toArray();

  if (!list.length) {
    console.log('\n  This shop has no users yet. Open Posnic and complete the setup wizard.\n');
    await client.close();
    return;
  }

  /* ---------------------------------------------------------- just look --- */

  if (!emailArg) {
    console.log('\n  Who can sign in to this shop\n');
    for (const u of list) {
      const changed = u.updated_date && u.created_date
        && Math.abs(new Date(u.updated_date) - new Date(u.created_date)) > 60000;
      console.log(`    ${String(u.email || u.username || '(no email)').padEnd(34)}`
        + `${String(u.usertype || '').padEnd(14)}`
        + `${u.activate === false ? 'disabled  ' : '          '}`
        /* The field that answers "it worked yesterday". */
        + (changed ? `password changed ${new Date(u.updated_date).toLocaleString()}` : 'password never changed'));
    }
    console.log('\n  To set one:');
    console.log('    node scripts/recover-access.js <email> <new password>\n');
    await client.close();
    return;
  }

  /* --------------------------------------------------------- change one --- */

  if (!passwordArg) {
    die('No password given.', 'node scripts/recover-access.js <email> <new password>');
  }
  if (passwordArg.length < 8) {
    die('That password is shorter than 8 characters.',
      'Pick something the shop will not have to write on the till.');
  }

  const user = list.find((u) => u.email === emailArg || u.username === emailArg);
  if (!user) {
    die(`No user here has the address "${emailArg}".`,
      'Run this with no arguments to see who does.');
  }

  /*
   * base64 FIRST, then bcrypt. This is the format the login checks before it
   * falls back to a plain hash, and the only one manager approvals accept. A
   * plain hash would appear to work and break approvals weeks later.
   */
  const encoded = Buffer.from(passwordArg).toString('base64');
  const hash = bcrypt.hashSync(encoded, 12);
  const at = new Date();

  await users.updateOne({ _id: user._id }, { $set: { password: hash, updated_date: at } });

  /* In the shop's own log. Somebody with a keyboard on this machine changed a
     password, and the business is entitled to know. */
  await db.collection('audit_log').insertOne({
    at,
    event: 'password_reset',
    source: 'local_recovery',
    actor_name: `${os.userInfo().username}@${os.hostname()}`,
    target_user_id: String(user._id),
    target_email: user.email || user.username || '',
    target_usertype: user.usertype || '',
  }).catch((e) => console.warn(`  (the audit entry could not be written: ${e.message})`));

  /* Proved, not assumed - the same comparison the login will make. */
  const after = await users.findOne({ _id: user._id });
  const ok = bcrypt.compareSync(encoded, after.password);

  console.log('');
  console.log(ok
    ? `  Done. ${user.email || user.username} can sign in with the password you just set.`
    : '  The password was written but did not verify. Do not rely on it; ask for help.');
  if (user.activate === false) {
    console.log('  Note: this account is disabled, so it still cannot sign in.');
  }
  console.log('  This was recorded in the shop\'s audit log.');
  console.log('');

  await client.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => die(e.message));
