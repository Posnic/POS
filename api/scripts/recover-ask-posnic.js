'use strict';
// Run on the recorded worker host. Inspection and previews are read-only;
// --apply is required for a transition. This tool never calls an AI provider,
// sends a message, or writes a purchase order/inventory/business record.
require('dotenv').config({ quiet: true });
const { readEvidence } = require('./ask-posnic-evidence');
const { MongoClient } = require('mongodb');
const recovery = require('../src/services/ask-posnic-recovery.service');

async function main() {
  const args = process.argv.slice(2), command = args.shift() || 'inspect', values = {};
  for (let i = 0; i < args.length; i++) {
    if (['--apply', '--rebuild-missing'].includes(args[i])) values[args[i].slice(2)] = true;
    else if (['--database', '--license', '--branch', '--id', '--engine', '--operator', '--evidence'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) values[args[i].slice(2)] = args[++i];
    else throw new Error('Unknown or incomplete argument.');
  }
  if (!['inspect', 'action', 'index', 'hold', 'schedule', 'project-usage'].includes(command) || !values.database || !values.license || !values.branch || !process.env.MONGODB_URI) throw new Error('Use inspect|action|index|hold|schedule|project-usage with --database NAME --license ID --branch ID and MONGODB_URI. Mutations also require --id, --operator NAME and --apply.');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db(values.database), context = { licenseId: values.license, branchId: values.branch };
    const options = { apply: values.apply === true, engine: values.engine, operator: values.operator, rebuildMissing: values['rebuild-missing'] === true };
    let result;
    if (command === 'inspect') result = await recovery.inspect(db, context);
    else if (command === 'action') result = await recovery.recoverAction(db, context, values.id, options);
    else if (command === 'index') result = await recovery.recoverIndex(db, context, values.id, options);
    else if (command === 'project-usage') result = await recovery.projectUsage(db, context, values.id, options);
    else {
      const evidence = readEvidence(values.evidence);
      result = command === 'hold' ? await recovery.resolveHold(db, context, values.id, evidence, options) : await recovery.recoverSchedule(db, context, values.id, evidence, options);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally { await client.close(); }
}
main().catch((error) => { console.error(error instanceof SyntaxError ? 'The evidence file is not valid JSON.' : error.name === 'MongoServerError' || error.name === 'MongoServerSelectionError' ? 'The recovery database could not be accessed. Check the explicit database and connection configuration.' : error.message); process.exitCode = 1; });
